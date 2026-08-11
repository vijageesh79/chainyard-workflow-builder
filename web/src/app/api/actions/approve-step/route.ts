import { NextRequest, NextResponse } from 'next/server';
import { resumeAfterApproval } from '@/lib/workflow/engine';
import { assertCanApprove } from '@/lib/workflow/permissions';
import {
  ActionError,
  extractUserIdFromAuthHeader,
} from '@/lib/workflow/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const stepRunId: string = body?.input?.step_run_id || body?.step_run_id;
    const userId =
      body?.session_variables?.['x-hasura-user-id'] ||
      extractUserIdFromAuthHeader(req.headers);

    if (!stepRunId) throw new ActionError('step_run_id is required');
    if (!userId) throw new ActionError('Unauthenticated', 401);

    const { orgId, workflowRunId } = await assertCanApprove(stepRunId, userId);
    const result = await resumeAfterApproval({
      stepRunId,
      userId,
      orgId,
      workflowRunId,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = err instanceof ActionError ? err.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
