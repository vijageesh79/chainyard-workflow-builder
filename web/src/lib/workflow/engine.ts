import { incrementQuota } from './permissions';
import { executeStep } from './executors';
import {
  ActionError,
  adminGraphql,
  type TriggerType,
  type WorkflowStep,
} from './types';

async function loadSteps(workflowId: string): Promise<WorkflowStep[]> {
  const data = await adminGraphql<{
    workflow_steps: WorkflowStep[];
  }>(
    `query Steps($workflowId: uuid!) {
      workflow_steps(
        where: { workflow_id: { _eq: $workflowId } }
        order_by: { position: asc }
      ) {
        id
        name
        step_type
        config
        position
      }
    }`,
    { workflowId }
  );
  return data.workflow_steps;
}

async function createRun(params: {
  workflowId: string;
  triggerType: TriggerType;
  triggeredBy: string | null;
  input: Record<string, unknown>;
}): Promise<string> {
  const data = await adminGraphql<{
    insert_workflow_runs_one: { id: string };
  }>(
    `mutation CreateRun(
      $workflowId: uuid!
      $triggerType: trigger_type!
      $triggeredBy: uuid
      $input: jsonb!
      $startedAt: timestamptz!
    ) {
      insert_workflow_runs_one(object: {
        workflow_id: $workflowId
        status: running
        trigger_type: $triggerType
        triggered_by: $triggeredBy
        input: $input
        started_at: $startedAt
      }) { id }
    }`,
    {
      workflowId: params.workflowId,
      triggerType: params.triggerType,
      triggeredBy: params.triggeredBy,
      input: params.input,
      startedAt: new Date().toISOString(),
    }
  );
  return data.insert_workflow_runs_one.id;
}

async function createStepRun(params: {
  runId: string;
  stepId: string;
}): Promise<string> {
  const data = await adminGraphql<{
    insert_step_runs_one: { id: string };
  }>(
    `mutation CreateStepRun($runId: uuid!, $stepId: uuid!) {
      insert_step_runs_one(object: {
        workflow_run_id: $runId
        workflow_step_id: $stepId
        status: pending
      }) { id }
    }`,
    { runId: params.runId, stepId: params.stepId }
  );
  return data.insert_step_runs_one.id;
}

async function updateStepRun(
  stepRunId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await adminGraphql(
    `mutation UpdateStepRun($id: uuid!, $patch: step_runs_set_input!) {
      update_step_runs_by_pk(pk_columns: { id: $id }, _set: $patch) { id }
    }`,
    { id: stepRunId, patch }
  );
}

async function updateRun(
  runId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await adminGraphql(
    `mutation UpdateRun($id: uuid!, $patch: workflow_runs_set_input!) {
      update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: $patch) { id }
    }`,
    { id: runId, patch }
  );
}

/**
 * Execute steps starting from `fromPosition` (inclusive).
 * Used both for fresh runs and for resume-after-approval.
 */
export async function executeFromPosition(params: {
  runId: string;
  workflowId: string;
  orgId: string;
  input: Record<string, unknown>;
  fromPosition: number;
  previousOutput?: unknown;
  skipFirstIfApprovalAlreadyCleared?: boolean;
}): Promise<{ status: string; message: string }> {
  const steps = await loadSteps(params.workflowId);
  let previousOutput: unknown = params.previousOutput ?? params.input;
  const variables: Record<string, unknown> = {};
  let branchTaken: 'then' | 'else' | null = null;

  const ordered = steps.filter((s) => s.position >= params.fromPosition);

  for (let i = 0; i < ordered.length; i++) {
    const step = ordered[i];

    // After conditional_branch, optionally skip steps tagged for the other branch
    if (branchTaken && step.config?.branch && step.config.branch !== branchTaken) {
      const skipId = await createStepRun({ runId: params.runId, stepId: step.id });
      await updateStepRun(skipId, {
        status: 'skipped',
        output: { reason: `Skipped — branch ${branchTaken} taken` },
        completed_at: new Date().toISOString(),
      });
      continue;
    }

    // On resume, the approval_gate step_run already exists and was approved
    if (
      params.skipFirstIfApprovalAlreadyCleared &&
      i === 0 &&
      step.step_type === 'approval_gate'
    ) {
      previousOutput = {
        approved: true,
        ...(typeof previousOutput === 'object' && previousOutput ? previousOutput : {}),
      };
      params.skipFirstIfApprovalAlreadyCleared = false;
      continue;
    }

    await updateRun(params.runId, {
      status: 'running',
      current_step_position: step.position,
    });

    const stepRunId = await createStepRun({
      runId: params.runId,
      stepId: step.id,
    });

    await updateStepRun(stepRunId, {
      status: 'running',
      input: { previous: previousOutput, run_input: params.input },
      started_at: new Date().toISOString(),
      attempt_count: 1,
    });

    try {
      const result = await executeStep(step, {
        runId: params.runId,
        orgId: params.orgId,
        input: params.input,
        previousOutput,
        variables,
      });

      if (result.pause) {
        await updateStepRun(stepRunId, {
          status: 'paused',
          output: result.output,
          attempt_count: 1,
        });
        await updateRun(params.runId, {
          status: 'paused',
          current_step_position: step.position,
          output: { paused_at_step: step.name, step_run_id: stepRunId },
        });
        return {
          status: 'paused',
          message: `Paused at approval_gate "${step.name}"`,
        };
      }

      if (result.branch) {
        branchTaken = result.branch;
        variables.last_branch = result.branch;
      }

      previousOutput = result.output;
      await updateStepRun(stepRunId, {
        status: 'completed',
        output: result.output,
        completed_at: new Date().toISOString(),
      });
    } catch (err) {
      // One automatic retry for transient failures
      try {
        await updateStepRun(stepRunId, { attempt_count: 2 });
        const result = await executeStep(step, {
          runId: params.runId,
          orgId: params.orgId,
          input: params.input,
          previousOutput,
          variables,
        });
        if (result.pause) {
          await updateStepRun(stepRunId, {
            status: 'paused',
            output: result.output,
          });
          await updateRun(params.runId, {
            status: 'paused',
            current_step_position: step.position,
          });
          return {
            status: 'paused',
            message: `Paused at approval_gate "${step.name}"`,
          };
        }
        if (result.branch) branchTaken = result.branch;
        previousOutput = result.output;
        await updateStepRun(stepRunId, {
          status: 'completed',
          output: result.output,
          completed_at: new Date().toISOString(),
        });
      } catch (retryErr) {
        const message =
          retryErr instanceof Error
            ? retryErr.message
            : err instanceof Error
              ? err.message
              : 'Step failed';
        await updateStepRun(stepRunId, {
          status: 'failed',
          error: message,
          completed_at: new Date().toISOString(),
        });
        await updateRun(params.runId, {
          status: 'failed',
          error: message,
          completed_at: new Date().toISOString(),
        });
        throw new ActionError(message, 500);
      }
    }
  }

  await updateRun(params.runId, {
    status: 'completed',
    output: previousOutput ?? {},
    completed_at: new Date().toISOString(),
  });
  await incrementQuota(params.orgId);

  return { status: 'completed', message: 'Workflow completed successfully' };
}

export async function startWorkflowRun(params: {
  workflowId: string;
  orgId: string;
  triggeredBy: string | null;
  triggerType: TriggerType;
  input?: Record<string, unknown>;
}): Promise<{ workflow_run_id: string; status: string; message: string }> {
  const input = params.input ?? {};
  const runId = await createRun({
    workflowId: params.workflowId,
    triggerType: params.triggerType,
    triggeredBy: params.triggeredBy,
    input,
  });

  const result = await executeFromPosition({
    runId,
    workflowId: params.workflowId,
    orgId: params.orgId,
    input,
    fromPosition: 0,
  });

  return {
    workflow_run_id: runId,
    status: result.status,
    message: result.message,
  };
}

export async function resumeAfterApproval(params: {
  stepRunId: string;
  userId: string;
  orgId: string;
  workflowRunId: string;
}): Promise<{ workflow_run_id: string; status: string; message: string }> {
  const data = await adminGraphql<{
    step_runs_by_pk: {
      id: string;
      output: unknown;
      workflow_step: { position: number; id: string };
      workflow_run: {
        id: string;
        input: Record<string, unknown>;
        workflow_id: string;
        current_step_position: number | null;
      };
    } | null;
  }>(
    `query Resume($id: uuid!) {
      step_runs_by_pk(id: $id) {
        id
        output
        workflow_step { position id }
        workflow_run {
          id
          input
          workflow_id
          current_step_position
        }
      }
    }`,
    { id: params.stepRunId }
  );

  const stepRun = data.step_runs_by_pk;
  if (!stepRun) throw new ActionError('Step run not found', 404);

  await updateStepRun(params.stepRunId, {
    status: 'completed',
    approved_by: params.userId,
    approved_at: new Date().toISOString(),
    output: {
      ...(typeof stepRun.output === 'object' && stepRun.output
        ? (stepRun.output as object)
        : {}),
      approved: true,
      approved_by: params.userId,
    },
    completed_at: new Date().toISOString(),
  });

  await updateRun(params.workflowRunId, { status: 'running' });

  const nextPosition = stepRun.workflow_step.position + 1;
  const result = await executeFromPosition({
    runId: params.workflowRunId,
    workflowId: stepRun.workflow_run.workflow_id,
    orgId: params.orgId,
    input: stepRun.workflow_run.input || {},
    fromPosition: nextPosition,
    previousOutput: {
      approved: true,
      approved_by: params.userId,
    },
  });

  return {
    workflow_run_id: params.workflowRunId,
    status: result.status,
    message: result.message,
  };
}
