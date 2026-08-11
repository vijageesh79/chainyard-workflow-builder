import { ActionError, adminGraphql, type MemberRole } from './types';

const MEMBERSHIP_QUERY = `
  query Membership($workflowId: uuid!, $userId: uuid!) {
    workflows_by_pk(id: $workflowId) {
      id
      org_id
      is_active
      organization {
        id
        quota_used
        quota_limit
        quota_period_start
        members(where: { user_id: { _eq: $userId } }) {
          role
        }
      }
    }
  }
`;

export async function assertCanTrigger(
  workflowId: string,
  userId: string
): Promise<{ orgId: string; role: MemberRole }> {
  const data = await adminGraphql<{
    workflows_by_pk: {
      id: string;
      org_id: string;
      is_active: boolean;
      organization: {
        id: string;
        quota_used: number;
        quota_limit: number;
        members: Array<{ role: MemberRole }>;
      };
    } | null;
  }>(MEMBERSHIP_QUERY, { workflowId, userId });

  const wf = data.workflows_by_pk;
  if (!wf) throw new ActionError('Workflow not found', 404);
  if (!wf.is_active) throw new ActionError('Workflow is inactive', 400);

  const member = wf.organization.members[0];
  if (!member) {
    throw new ActionError('Not a member of this organization', 403);
  }
  if (member.role === 'viewer') {
    throw new ActionError('Viewers cannot trigger workflow runs', 403);
  }

  await assertQuotaAvailable(wf.org_id);
  return { orgId: wf.org_id, role: member.role };
}

export async function assertQuotaAvailable(orgId: string): Promise<void> {
  const data = await adminGraphql<{
    organizations_by_pk: {
      quota_used: number;
      quota_limit: number;
      quota_period_start: string;
    } | null;
  }>(
    `query Q($id: uuid!) {
      organizations_by_pk(id: $id) {
        quota_used
        quota_limit
        quota_period_start
      }
    }`,
    { id: orgId }
  );

  const org = data.organizations_by_pk;
  if (!org) throw new ActionError('Organization not found', 404);

  const periodStart = new Date(org.quota_period_start);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  let used = org.quota_used;
  if (periodStart < monthStart) {
    await adminGraphql(
      `mutation Reset($id: uuid!, $start: timestamptz!) {
        update_organizations_by_pk(
          pk_columns: { id: $id }
          _set: { quota_used: 0, quota_period_start: $start }
        ) { id }
      }`,
      { id: orgId, start: monthStart.toISOString() }
    );
    used = 0;
  }

  if (used >= org.quota_limit) {
    throw new ActionError('Organization quota exhausted for this period', 429);
  }
}

export async function incrementQuota(orgId: string): Promise<void> {
  await adminGraphql(
    `mutation Inc($id: uuid!) {
      update_organizations_by_pk(pk_columns: { id: $id }, _inc: { quota_used: 1 }) {
        id
        quota_used
      }
    }`,
    { id: orgId }
  );
}

export async function assertCanApprove(
  stepRunId: string,
  userId: string
): Promise<{
  orgId: string;
  workflowRunId: string;
  role: MemberRole;
}> {
  const data = await adminGraphql<{
    step_runs_by_pk: {
      id: string;
      status: string;
      workflow_run_id: string;
      workflow_step: { step_type: string };
      workflow_run: {
        id: string;
        status: string;
        workflow: {
          org_id: string;
          organization: {
            members: Array<{ role: MemberRole }>;
          };
        };
      };
    } | null;
  }>(
    `query ApproveCheck($stepRunId: uuid!, $userId: uuid!) {
      step_runs_by_pk(id: $stepRunId) {
        id
        status
        workflow_run_id
        workflow_step { step_type }
        workflow_run {
          id
          status
          workflow {
            org_id
            organization {
              members(where: { user_id: { _eq: $userId } }) {
                role
              }
            }
          }
        }
      }
    }`,
    { stepRunId, userId }
  );

  const stepRun = data.step_runs_by_pk;
  if (!stepRun) throw new ActionError('Step run not found', 404);
  if (stepRun.workflow_step.step_type !== 'approval_gate') {
    throw new ActionError('Step is not an approval_gate', 400);
  }
  if (stepRun.status !== 'paused' || stepRun.workflow_run.status !== 'paused') {
    throw new ActionError('Run is not awaiting approval', 400);
  }

  const member = stepRun.workflow_run.workflow.organization.members[0];
  if (!member) {
    throw new ActionError('Not a member of this organization', 403);
  }
  if (member.role !== 'owner' && member.role !== 'editor') {
    throw new ActionError('Only owners and editors can approve this step', 403);
  }

  return {
    orgId: stepRun.workflow_run.workflow.org_id,
    workflowRunId: stepRun.workflow_run_id,
    role: member.role,
  };
}
