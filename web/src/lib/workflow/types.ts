export type MemberRole = 'owner' | 'editor' | 'viewer';
export type StepType =
  | 'llm_call'
  | 'http_request'
  | 'db_write'
  | 'notify'
  | 'conditional_branch'
  | 'approval_gate';
export type TriggerType = 'manual' | 'webhook' | 'scheduled' | 'database_event';
export type RunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type StepRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface WorkflowStep {
  id: string;
  name: string;
  step_type: StepType;
  config: Record<string, unknown>;
  position: number;
}

export interface WorkflowRunContext {
  runId: string;
  workflowId: string;
  orgId: string;
  input: Record<string, unknown>;
  previousOutput: unknown;
  variables: Record<string, unknown>;
}

export class ActionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function getHasuraConfig() {
  const endpoint =
    process.env.HASURA_GRAPHQL_ENDPOINT ||
    process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL ||
    'http://localhost:8080/v1/graphql';
  const adminSecret =
    process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'workflow-builder-admin-secret';
  return { endpoint, adminSecret };
}

export async function adminGraphql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const { endpoint, adminSecret } = getHasuraConfig();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': adminSecret,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new ActionError(json.errors.map((e) => e.message).join('; '), 500);
  }
  if (!json.data) {
    throw new ActionError('Empty GraphQL response', 500);
  }
  return json.data;
}

export function extractUserId(headers: Headers): string | null {
  return (
    headers.get('x-hasura-user-id') ||
    headers.get('X-Hasura-User-Id') ||
    null
  );
}

export function extractUserIdFromAuthHeader(headers: Headers): string | null {
  const fromSession = extractUserId(headers);
  if (fromSession) return fromSession;

  const auth = headers.get('authorization') || headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const token = auth.slice(7);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    ) as {
      'https://hasura.io/jwt/claims'?: { 'x-hasura-user-id'?: string };
      sub?: string;
    };
    return (
      payload['https://hasura.io/jwt/claims']?.['x-hasura-user-id'] ||
      payload.sub ||
      null
    );
  } catch {
    return null;
  }
}
