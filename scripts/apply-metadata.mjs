#!/usr/bin/env node
/**
 * Applies tracking, relationships, permissions, actions, event triggers, and cron
 * to a running Hasura instance via the metadata API.
 */
const ENDPOINT = process.env.HASURA_GRAPHQL_ENDPOINT || 'http://localhost:8080';
const SECRET = process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'workflow-builder-admin-secret';
const ACTION_BASE =
  process.env.ACTION_BASE_URL || 'http://host.docker.internal:3000/api/actions';
const WEBHOOK_SECRET =
  process.env.NHOST_WEBHOOK_SECRET || 'workflow-builder-webhook-secret';

async function meta(type, args) {
  const res = await fetch(`${ENDPOINT}/v1/metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': SECRET,
    },
    body: JSON.stringify({ type, args }),
  });
  const json = await res.json().catch(() => ({}));
  const msg = json.error || json.message || '';
  if (
    msg &&
    !String(msg).includes('already') &&
    json.code !== 'already-exists' &&
    json.code !== 'already-tracked' &&
    json.code !== 'not-exists'
  ) {
    if (!res.ok || json.error) {
      console.warn(`⚠ ${type}:`, msg || JSON.stringify(json));
    }
  }
  return json;
}

const memberFilter = {
  organization: { members: { user_id: { _eq: 'X-Hasura-User-Id' } } },
};
const ownerFilter = {
  organization: {
    members: {
      _and: [
        { user_id: { _eq: 'X-Hasura-User-Id' } },
        { role: { _eq: 'owner' } },
      ],
    },
  },
};
const editorFilter = {
  organization: {
    members: {
      _and: [
        { user_id: { _eq: 'X-Hasura-User-Id' } },
        { role: { _in: ['owner', 'editor'] } },
      ],
    },
  },
};
const wfMemberFilter = { workflow: memberFilter };
const wfEditorFilter = { workflow: editorFilter };

const stepInsertCheck = {
  _and: [
    wfEditorFilter,
    {
      _or: [
        { step_type: { _nin: ['db_write', 'notify'] } },
        {
          workflow: {
            organization: {
              members: {
                _and: [
                  { user_id: { _eq: 'X-Hasura-User-Id' } },
                  { role: { _eq: 'owner' } },
                ],
              },
            },
          },
        },
      ],
    },
  ],
};

const triggerInsertCheck = {
  _and: [
    wfEditorFilter,
    {
      _or: [
        { trigger_type: { _neq: 'webhook' } },
        {
          workflow: {
            organization: {
              members: {
                _and: [
                  { user_id: { _eq: 'X-Hasura-User-Id' } },
                  { role: { _eq: 'owner' } },
                ],
              },
            },
          },
        },
      ],
    },
  ],
};

async function objRel(table, name, remote, fromCol, toCol) {
  await meta('pg_create_object_relationship', {
    source: 'default',
    table: { schema: 'public', name: table },
    name,
    using: {
      manual_configuration: {
        remote_table: { schema: 'public', name: remote },
        column_mapping: { [fromCol]: toCol },
      },
    },
  });
}

async function arrRel(table, name, remote, fromCol, toCol) {
  await meta('pg_create_array_relationship', {
    source: 'default',
    table: { schema: 'public', name: table },
    name,
    using: {
      manual_configuration: {
        remote_table: { schema: 'public', name: remote },
        column_mapping: { [fromCol]: toCol },
      },
    },
  });
}

async function main() {
  console.log('→ Tracking tables');
  for (const name of [
    'organizations',
    'org_members',
    'workflows',
    'workflow_steps',
    'workflow_triggers',
    'workflow_runs',
    'step_runs',
    'workflow_data',
    'notification_outbox',
    'org_usage_stats',
  ]) {
    await meta('pg_track_table', {
      source: 'default',
      table: { schema: 'public', name },
    });
  }

  console.log('→ Relationships');
  await arrRel('organizations', 'members', 'org_members', 'id', 'org_id');
  await arrRel('organizations', 'workflows', 'workflows', 'id', 'org_id');
  await objRel('org_members', 'organization', 'organizations', 'org_id', 'id');
  await objRel('workflows', 'organization', 'organizations', 'org_id', 'id');
  await arrRel('workflows', 'steps', 'workflow_steps', 'id', 'workflow_id');
  await arrRel('workflows', 'triggers', 'workflow_triggers', 'id', 'workflow_id');
  await arrRel('workflows', 'runs', 'workflow_runs', 'id', 'workflow_id');
  await objRel('workflow_steps', 'workflow', 'workflows', 'workflow_id', 'id');
  await objRel('workflow_triggers', 'workflow', 'workflows', 'workflow_id', 'id');
  await objRel('workflow_runs', 'workflow', 'workflows', 'workflow_id', 'id');
  await arrRel('workflow_runs', 'step_runs', 'step_runs', 'id', 'workflow_run_id');
  await objRel('step_runs', 'workflow_run', 'workflow_runs', 'workflow_run_id', 'id');
  await objRel('step_runs', 'workflow_step', 'workflow_steps', 'workflow_step_id', 'id');
  await objRel('workflow_data', 'organization', 'organizations', 'org_id', 'id');
  await objRel('notification_outbox', 'organization', 'organizations', 'org_id', 'id');
  await objRel('org_usage_stats', 'organization', 'organizations', 'org_id', 'id');

  console.log('→ Permissions (Layer 1 + Layer 2 checks)');
  await meta('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'organizations' },
    role: 'user',
    permission: {
      columns: '*',
      filter: { members: { user_id: { _eq: 'X-Hasura-User-Id' } } },
      allow_aggregations: true,
    },
  });

  await meta('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'org_members' },
    role: 'user',
    permission: { columns: '*', filter: memberFilter },
  });
  await meta('pg_create_insert_permission', {
    source: 'default',
    table: { schema: 'public', name: 'org_members' },
    role: 'user',
    permission: {
      columns: ['org_id', 'user_id', 'role'],
      check: ownerFilter,
    },
  });

  await meta('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflows' },
    role: 'user',
    permission: { columns: '*', filter: memberFilter, allow_aggregations: true },
  });
  await meta('pg_create_insert_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflows' },
    role: 'user',
    permission: {
      columns: ['org_id', 'name', 'description', 'is_active'],
      check: editorFilter,
      set: { created_by: 'x-hasura-User-Id' },
    },
  });
  await meta('pg_create_update_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflows' },
    role: 'user',
    permission: {
      columns: ['name', 'description', 'is_active'],
      filter: editorFilter,
      check: null,
    },
  });

  await meta('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_steps' },
    role: 'user',
    permission: { columns: '*', filter: wfMemberFilter },
  });
  await meta('pg_create_insert_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_steps' },
    role: 'user',
    permission: {
      columns: ['workflow_id', 'name', 'step_type', 'config', 'position'],
      check: stepInsertCheck,
    },
  });
  await meta('pg_create_update_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_steps' },
    role: 'user',
    permission: {
      columns: ['name', 'step_type', 'config', 'position'],
      filter: wfEditorFilter,
      check: stepInsertCheck,
    },
  });
  await meta('pg_create_delete_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_steps' },
    role: 'user',
    permission: { filter: wfEditorFilter },
  });

  await meta('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_triggers' },
    role: 'user',
    permission: {
      columns: ['id', 'workflow_id', 'trigger_type', 'config', 'is_active', 'created_at', 'webhook_secret'],
      filter: wfMemberFilter,
    },
  });
  await meta('pg_create_insert_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_triggers' },
    role: 'user',
    permission: {
      columns: ['workflow_id', 'trigger_type', 'config', 'webhook_secret', 'is_active'],
      check: triggerInsertCheck,
    },
  });
  await meta('pg_create_delete_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_triggers' },
    role: 'user',
    permission: { filter: wfEditorFilter },
  });

  await meta('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_runs' },
    role: 'user',
    permission: { columns: '*', filter: wfMemberFilter, allow_aggregations: true },
  });

  await meta('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'step_runs' },
    role: 'user',
    permission: {
      columns: '*',
      filter: { workflow_run: wfMemberFilter },
    },
  });

  await meta('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_data' },
    role: 'user',
    permission: { columns: '*', filter: memberFilter },
  });
  await meta('pg_create_insert_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_data' },
    role: 'user',
    permission: {
      columns: ['org_id', 'key', 'value'],
      check: editorFilter,
    },
  });

  await meta('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'notification_outbox' },
    role: 'user',
    permission: { columns: '*', filter: memberFilter },
  });

  await meta('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'org_usage_stats' },
    role: 'user',
    permission: { columns: '*', filter: memberFilter },
  });

  console.log('→ Custom types + actions');
  await meta('set_custom_types', {
    scalars: [],
    enums: [],
    input_objects: [],
    objects: [
      {
        name: 'TriggerWorkflowRunOutput',
        fields: [
          { name: 'workflow_run_id', type: 'uuid!' },
          { name: 'status', type: 'String!' },
          { name: 'message', type: 'String' },
        ],
      },
      {
        name: 'ApproveStepOutput',
        fields: [
          { name: 'workflow_run_id', type: 'uuid!' },
          { name: 'status', type: 'String!' },
          { name: 'message', type: 'String' },
        ],
      },
    ],
  });

  const actions = [
    {
      name: 'triggerWorkflowRun',
      handler: `${ACTION_BASE}/trigger-workflow-run`,
      roles: ['user'],
      forward: true,
      arguments: [
        { name: 'workflow_id', type: 'uuid!' },
        { name: 'input', type: 'jsonb' },
        { name: 'trigger_type', type: 'String' },
      ],
      output_type: 'TriggerWorkflowRunOutput!',
    },
    {
      name: 'approveStep',
      handler: `${ACTION_BASE}/approve-step`,
      roles: ['user'],
      forward: true,
      arguments: [{ name: 'step_run_id', type: 'uuid!' }],
      output_type: 'ApproveStepOutput!',
    },
    {
      name: 'webhookStartWorkflow',
      handler: `${ACTION_BASE}/webhook-start`,
      roles: ['user', 'anonymous'],
      forward: false,
      arguments: [
        { name: 'workflow_id', type: 'uuid!' },
        { name: 'secret', type: 'String!' },
        { name: 'input', type: 'jsonb' },
      ],
      output_type: 'TriggerWorkflowRunOutput!',
    },
  ];

  for (const a of actions) {
    await meta('drop_action', { name: a.name, clear_data: true });
    await meta('create_action', {
      name: a.name,
      definition: {
        kind: 'synchronous',
        handler: a.handler,
        forward_client_headers: a.forward,
        timeout: 300,
        arguments: a.arguments,
        output_type: a.output_type,
      },
    });
    for (const role of a.roles) {
      await meta('create_action_permission', { action: a.name, role });
    }
  }

  console.log('→ Event triggers + cron');
  await meta('pg_create_event_trigger', {
    name: 'notify_outbox_deliver',
    table: { schema: 'public', name: 'notification_outbox' },
    webhook: `${ACTION_BASE}/notify-handler`,
    insert: { columns: '*' },
    headers: [{ name: 'x-nhost-webhook-secret', value: WEBHOOK_SECRET }],
    replace: true,
  });
  await meta('pg_create_event_trigger', {
    name: 'workflow_data_insert_start_run',
    table: { schema: 'public', name: 'workflow_data' },
    webhook: `${ACTION_BASE}/db-event-handler`,
    insert: { columns: '*' },
    headers: [{ name: 'x-nhost-webhook-secret', value: WEBHOOK_SECRET }],
    replace: true,
  });
  await meta('delete_cron_trigger', { name: 'run_scheduled_workflows' });
  await meta('create_cron_trigger', {
    name: 'run_scheduled_workflows',
    webhook: `${ACTION_BASE}/scheduled-runner`,
    schedule: '*/5 * * * *',
    payload: {},
    headers: [{ name: 'x-nhost-webhook-secret', value: WEBHOOK_SECRET }],
    include_in_metadata: true,
  });

  console.log('✓ Metadata applied →', ENDPOINT);
  console.log('  Action base:', ACTION_BASE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
