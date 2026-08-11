import { NextRequest, NextResponse } from 'next/server';
import { startWorkflowRun } from '@/lib/workflow/engine';
import { assertCanTrigger } from '@/lib/workflow/permissions';
import {
  ActionError,
  extractUserIdFromAuthHeader,
} from '@/lib/workflow/types';

/**
 * Hasura Action: triggerWorkflowRun
 * Payload shape: { action, input: { workflow_id, input, trigger_type }, session_variables }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const workflowId: string =
      body?.input?.workflow_id || body?.workflow_id;
    const input = (body?.input?.input || body?.input_payload || {}) as Record<
      string,
      unknown
    >;
    const triggerType =
      (body?.input?.trigger_type as string) || 'manual';

    const userId =
      body?.session_variables?.['x-hasura-user-id'] ||
      extractUserIdFromAuthHeader(req.headers);

    if (!workflowId) throw new ActionError('workflow_id is required');
    if (!userId) throw new ActionError('Unauthenticated', 401);

    const { orgId } = await assertCanTrigger(workflowId, userId);
    const result = await startWorkflowRun({
      workflowId,
      orgId,
      triggeredBy: userId,
      triggerType: triggerType as 'manual' | 'webhook' | 'scheduled' | 'database_event',
      input,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = err instanceof ActionError ? err.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
