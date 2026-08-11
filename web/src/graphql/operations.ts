import { gql } from '@apollo/client';

export const GET_MY_ORGS = gql`
  query GetMyOrgs {
    organizations {
      id
      name
      quota_used
      quota_limit
      members {
        id
        user_id
        role
      }
    }
    org_usage_stats {
      org_id
      quota_used
      quota_limit
      quota_remaining
      avg_run_duration_seconds
      runs_this_month
    }
  }
`;

export const GET_ORG_WORKFLOWS = gql`
  query GetOrgWorkflows($orgId: uuid!) {
    workflows(
      where: { org_id: { _eq: $orgId } }
      order_by: { updated_at: desc }
    ) {
      id
      name
      description
      is_active
      updated_at
      steps(order_by: { position: asc }) {
        id
        name
        step_type
        config
        position
      }
      triggers {
        id
        trigger_type
        config
        is_active
      }
      runs(order_by: { created_at: desc }, limit: 1) {
        id
        status
        trigger_type
        created_at
        error
      }
    }
  }
`;

export const GET_WORKFLOW = gql`
  query GetWorkflow($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      org_id
      name
      description
      is_active
      steps(order_by: { position: asc }) {
        id
        name
        step_type
        config
        position
      }
      triggers {
        id
        trigger_type
        config
        is_active
        webhook_secret
      }
      runs(order_by: { created_at: desc }, limit: 10) {
        id
        status
        trigger_type
        created_at
        started_at
        completed_at
        error
        output
      }
    }
  }
`;

export const TRIGGER_RUN = gql`
  mutation TriggerRun($workflowId: uuid!, $input: jsonb) {
    triggerWorkflowRun(workflow_id: $workflowId, input: $input, trigger_type: "manual") {
      workflow_run_id
      status
      message
    }
  }
`;

export const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(step_run_id: $stepRunId) {
      workflow_run_id
      status
      message
    }
  }
`;

export const WEBHOOK_START = gql`
  mutation WebhookStart($workflowId: uuid!, $secret: String!, $input: jsonb) {
    webhookStartWorkflow(workflow_id: $workflowId, secret: $secret, input: $input) {
      workflow_run_id
      status
      message
    }
  }
`;

export const STEP_RUNS_SUB = gql`
  subscription StepRuns($runId: uuid!) {
    step_runs(
      where: { workflow_run_id: { _eq: $runId } }
      order_by: { created_at: asc }
    ) {
      id
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      completed_at
      workflow_step {
        id
        name
        step_type
        position
      }
    }
  }
`;

export const WORKFLOW_RUN_SUB = gql`
  subscription WorkflowRun($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id
      status
      error
      output
      current_step_position
    }
  }
`;

export const INSERT_WORKFLOW = gql`
  mutation InsertWorkflow($object: workflows_insert_input!) {
    insert_workflows_one(object: $object) {
      id
    }
  }
`;

export const UPDATE_WORKFLOW = gql`
  mutation UpdateWorkflow($id: uuid!, $set: workflows_set_input!) {
    update_workflows_by_pk(pk_columns: { id: $id }, _set: $set) {
      id
    }
  }
`;

export const DELETE_STEPS = gql`
  mutation DeleteSteps($workflowId: uuid!) {
    delete_workflow_steps(where: { workflow_id: { _eq: $workflowId } }) {
      affected_rows
    }
  }
`;

export const INSERT_STEPS = gql`
  mutation InsertSteps($objects: [workflow_steps_insert_input!]!) {
    insert_workflow_steps(objects: $objects) {
      affected_rows
    }
  }
`;

export const DELETE_TRIGGERS = gql`
  mutation DeleteTriggers($workflowId: uuid!) {
    delete_workflow_triggers(where: { workflow_id: { _eq: $workflowId } }) {
      affected_rows
    }
  }
`;

export const INSERT_TRIGGERS = gql`
  mutation InsertTriggers($objects: [workflow_triggers_insert_input!]!) {
    insert_workflow_triggers(objects: $objects) {
      affected_rows
    }
  }
`;
