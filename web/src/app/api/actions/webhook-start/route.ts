import { NextRequest, NextResponse } from 'next/server';
import { startWorkflowRun } from '@/lib/workflow/engine';
import { assertQuotaAvailable } from '@/lib/workflow/permissions';
import { ActionError, adminGraphql } from '@/lib/workflow/types';

/**
 * Hasura Action / public webhook entry: webhookStartWorkflow
 * Authenticates via per-workflow webhook_secret (not user JWT).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const workflowId: string =
      body?.input?.workflow_id || body?.workflow_id;
    const secret: string = body?.input?.secret || body?.secret || '';
    const input = (body?.input?.input || body?.payload || {}) as Record<
      string,
      unknown
    >;

    if (!workflowId) throw new ActionError('workflow_id is required');
    if (!secret) throw new ActionError('secret is required', 401);

    const data = await adminGraphql<{
      workflow_triggers: Array<{
        id: string;
        webhook_secret: string | null;
        is_active: boolean;
        workflow: { id: string; org_id: string; is_active: boolean };
      }>;
    }>(
      `query Webhook($workflowId: uuid!) {
        workflow_triggers(
          where: {
            workflow_id: { _eq: $workflowId }
            trigger_type: { _eq: webhook }
            is_active: { _eq: true }
          }
        ) {
          id
          webhook_secret
          is_active
          workflow { id org_id is_active }
        }
      }`,
      { workflowId }
    );

    const trigger = data.workflow_triggers[0];
    if (!trigger || !trigger.workflow.is_active) {
      throw new ActionError('Webhook trigger not found or inactive', 404);
    }
    if (!trigger.webhook_secret || trigger.webhook_secret !== secret) {
      throw new ActionError('Invalid webhook secret', 403);
    }

    await assertQuotaAvailable(trigger.workflow.org_id);

    const result = await startWorkflowRun({
      workflowId,
      orgId: trigger.workflow.org_id,
      triggeredBy: null,
      triggerType: 'webhook',
      input,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = err instanceof ActionError ? err.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
