import { NextRequest, NextResponse } from 'next/server';
import { startWorkflowRun } from '@/lib/workflow/engine';
import { assertQuotaAvailable } from '@/lib/workflow/permissions';
import { ActionError, adminGraphql } from '@/lib/workflow/types';

function authorize(req: NextRequest) {
  const secret =
    req.headers.get('x-nhost-webhook-secret') ||
    req.headers.get('x-hasura-webhook-secret');
  const expected =
    process.env.NHOST_WEBHOOK_SECRET || 'workflow-builder-webhook-secret';
  if (secret !== expected) {
    throw new ActionError('Unauthorized webhook', 401);
  }
}

export async function POST(req: NextRequest) {
  try {
    authorize(req);

    const data = await adminGraphql<{
      workflow_triggers: Array<{
        id: string;
        config: { cron?: string };
        workflow: { id: string; org_id: string; is_active: boolean };
      }>;
    }>(
      `query Scheduled {
        workflow_triggers(
          where: {
            trigger_type: { _eq: scheduled }
            is_active: { _eq: true }
            workflow: { is_active: { _eq: true } }
          }
        ) {
          id
          config
          workflow { id org_id is_active }
        }
      }`
    );

    const started: string[] = [];
    for (const t of data.workflow_triggers) {
      try {
        await assertQuotaAvailable(t.workflow.org_id);
        const result = await startWorkflowRun({
          workflowId: t.workflow.id,
          orgId: t.workflow.org_id,
          triggeredBy: null,
          triggerType: 'scheduled',
          input: { scheduled_at: new Date().toISOString() },
        });
        started.push(result.workflow_run_id);
      } catch {
      }
    }

    return NextResponse.json({
      ok: true,
      started_count: started.length,
      workflow_run_ids: started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = err instanceof ActionError ? err.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
