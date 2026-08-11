import { ActionError, adminGraphql, type WorkflowStep } from './types';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function interpolate(
  template: string,
  ctx: { previousOutput: unknown; input: Record<string, unknown>; variables: Record<string, unknown> }
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const parts = path.split('.');
    let cur: unknown =
      parts[0] === 'previous'
        ? ctx.previousOutput
        : parts[0] === 'input'
          ? ctx.input
          : parts[0] === 'vars'
            ? ctx.variables
            : undefined;
    for (const p of parts.slice(1)) {
      if (cur && typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        cur = undefined;
        break;
      }
    }
    if (cur === undefined || cur === null) return '';
    return typeof cur === 'string' ? cur : JSON.stringify(cur);
  });
}

async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  maxAttempts = 2
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(400 * attempt);
      }
    }
  }
  throw lastError;
}

async function callLlm(prompt: string): Promise<{ text: string; provider: string; stubbed: boolean }> {
  const groqKey = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (groqKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return {
      text: json.choices[0]?.message?.content ?? '',
      provider: 'groq',
      stubbed: false,
    };
  }

  if (openRouterKey) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return {
      text: json.choices[0]?.message?.content ?? '',
      provider: 'openrouter',
      stubbed: false,
    };
  }

  if (geminiKey) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    return {
      text: json.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
      provider: 'gemini',
      stubbed: false,
    };
  }

  await sleep(800);
  const lower = prompt.toLowerCase();
  const positive =
    lower.includes('approve') ||
    lower.includes('yes') ||
    lower.includes('positive') ||
    !lower.includes('reject');
  return {
    text: positive
      ? 'SENTIMENT: positive — The content looks good to proceed.'
      : 'SENTIMENT: negative — The content should be rejected.',
    provider: 'stub',
    stubbed: true,
  };
}

export interface StepExecResult {
  output: unknown;
  pause?: boolean;
  skipRemaining?: boolean;
  branch?: 'then' | 'else';
}

export async function executeStep(
  step: WorkflowStep,
  ctx: {
    runId: string;
    orgId: string;
    input: Record<string, unknown>;
    previousOutput: unknown;
    variables: Record<string, unknown>;
  }
): Promise<StepExecResult> {
  const config = step.config || {};

  switch (step.step_type) {
    case 'llm_call': {
      const promptTemplate =
        (config.prompt as string) ||
        'Summarize this input and reply with SENTIMENT: positive or SENTIMENT: negative.\n\n{{previous}}';
      const prompt = interpolate(promptTemplate, ctx);
      const result = await withRetry(() => callLlm(prompt), 2);
      return { output: result };
    }

    case 'http_request': {
      const url = interpolate((config.url as string) || 'https://postman-echo.com/post', ctx);
      const method = ((config.method as string) || 'POST').toUpperCase();
      const headers = (config.headers as Record<string, string>) || {
        'Content-Type': 'application/json',
      };
      const bodyTemplate = config.body as string | undefined;
      const body = bodyTemplate
        ? interpolate(bodyTemplate, ctx)
        : JSON.stringify({
            previous: ctx.previousOutput,
            input: ctx.input,
          });

      const result = await withRetry(async () => {
        const res = await fetch(url, {
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? undefined : body,
        });
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
        }
        return { status: res.status, body: parsed, url };
      }, 2);

      return { output: result };
    }

    case 'db_write': {
      const key =
        interpolate((config.key as string) || 'result', ctx) ||
        `run-${ctx.runId}`;
      const value = config.value_from_previous
        ? ctx.previousOutput
        : config.value ?? ctx.previousOutput;

      const data = await adminGraphql<{
        insert_workflow_data_one: { id: string };
      }>(
        `mutation Write($orgId: uuid!, $runId: uuid!, $key: String!, $value: jsonb!) {
          insert_workflow_data_one(object: {
            org_id: $orgId
            workflow_run_id: $runId
            key: $key
            value: $value
          }) { id }
        }`,
        {
          orgId: ctx.orgId,
          runId: ctx.runId,
          key,
          value: value ?? {},
        }
      );
      return {
        output: {
          workflow_data_id: data.insert_workflow_data_one.id,
          key,
          value,
        },
      };
    }

    case 'notify': {
      const channel = ((config.channel as string) || 'email') as 'slack' | 'email';
      const message = interpolate(
        (config.message as string) ||
          'Workflow {{input}} completed a notify step. Previous: {{previous}}',
        ctx
      );
      const payload = {
        message,
        to: config.to || process.env.NOTIFY_DEFAULT_TO || 'ops@example.com',
        webhook_url: config.webhook_url,
        previous: ctx.previousOutput,
      };

      const data = await adminGraphql<{
        insert_notification_outbox_one: { id: string };
      }>(
        `mutation Notify($orgId: uuid!, $runId: uuid!, $channel: String!, $payload: jsonb!) {
          insert_notification_outbox_one(object: {
            org_id: $orgId
            workflow_run_id: $runId
            channel: $channel
            payload: $payload
            status: "pending"
          }) { id }
        }`,
        {
          orgId: ctx.orgId,
          runId: ctx.runId,
          channel,
          payload,
        }
      );
      return {
        output: {
          notification_id: data.insert_notification_outbox_one.id,
          channel,
          queued: true,
        },
      };
    }

    case 'conditional_branch': {
      const field = (config.field as string) || 'text';
      const contains = (config.contains as string) || 'positive';
      const source =
        typeof ctx.previousOutput === 'object' && ctx.previousOutput !== null
          ? (ctx.previousOutput as Record<string, unknown>)
          : { value: ctx.previousOutput };
      const haystack = String(source[field] ?? source.text ?? JSON.stringify(ctx.previousOutput));
      const matched = haystack.toLowerCase().includes(contains.toLowerCase());
      return {
        output: {
          matched,
          field,
          contains,
          evaluated: haystack.slice(0, 500),
          branch: matched ? 'then' : 'else',
        },
        branch: matched ? 'then' : 'else',
      };
    }

    case 'approval_gate': {
      return {
        output: {
          awaiting_approval: true,
          message: (config.message as string) || 'Waiting for owner/editor approval',
        },
        pause: true,
      };
    }

    default:
      throw new ActionError(`Unknown step type: ${step.step_type}`, 400);
  }
}
