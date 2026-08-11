import { NextRequest, NextResponse } from 'next/server';
import { startWorkflowRun } from '@/lib/workflow/engine';
import { assertQuotaAvailable } from '@/lib/workflow/permissions';
import { ActionError, adminGraphql } from '@/lib/workflow/types';

export async function POST(req: NextRequest) {
  try {
    const secret =
      req.headers.get('x-nhost-webhook-secret') ||
      req.headers.get('x-hasura-webhook-secret');
    const expected =
      process.env.NHOST_WEBHOOK_SECRET || 'workflow-builder-webhook-secret';
    if (secret !== expected) throw new ActionError('Unauthorized', 401);

    const body = await req.json();
    const row = body?.event?.data?.new as {
      id: string;
      org_id: string;
      key: string;
      value: unknown;
      workflow_run_id: string | null;
    };

    if (!row?.id) return NextResponse.json({ ok: true, skipped: true });

    const data = await adminGraphql<{
      workflow_triggers: Array<{
        id: string;
        config: { watch_key?: string };
        workflow: { id: string; org_id: string; is_active: boolean };
      }>;
    }>(
      `query DbEvents($orgId: uuid!) {
        workflow_triggers(
          where: {
            trigger_type: { _eq: database_event }
            is_active: { _eq: true }
            workflow: {
              org_id: { _eq: $orgId }
              is_active: { _eq: true }
            }
          }
        ) {
          id
          config
          workflow { id org_id is_active }
        }
      }`,
      { orgId: row.org_id }
    );

    const started: string[] = [];
    for (const t of data.workflow_triggers) {
      const watchKey = t.config?.watch_key || 'demo_event';
      if (watchKey !== row.key) continue;
      if (row.workflow_run_id) continue;

      try {
        await assertQuotaAvailable(t.workflow.org_id);
        const result = await startWorkflowRun({
          workflowId: t.workflow.id,
          orgId: t.workflow.org_id,
          triggeredBy: null,
          triggerType: 'database_event',
          input: {
            event_key: row.key,
            event_value: row.value,
            workflow_data_id: row.id,
          },
        });
        started.push(result.workflow_run_id);
      } catch {
      }
    }

    return NextResponse.json({ ok: true, started_count: started.length, started });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = err instanceof ActionError ? err.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
