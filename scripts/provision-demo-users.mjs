#!/usr/bin/env node
const AUTH = process.env.NHOST_AUTH_URL || 'http://localhost:4000/v1';
const HASURA = process.env.HASURA_GRAPHQL_ENDPOINT || 'http://localhost:8080/v1/graphql';
const SECRET = process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'workflow-builder-admin-secret';

const USERS = [
  {
    email: 'owner-a@acme.test',
    password: 'password',
    displayName: 'Ava Owner',
    orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    role: 'owner',
  },
  {
    email: 'editor-a@acme.test',
    password: 'password',
    displayName: 'Ed Editor',
    orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    role: 'editor',
  },
  {
    email: 'viewer-a@acme.test',
    password: 'password',
    displayName: 'Vera Viewer',
    orgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    role: 'viewer',
  },
  {
    email: 'owner-b@beta.test',
    password: 'password',
    displayName: 'Ben Owner',
    orgId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    role: 'owner',
  },
];

async function gql(query, variables) {
  const res = await fetch(HASURA, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

async function signupOrSignin(user) {
  const signup = await fetch(`${AUTH}/signup/email-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      options: { displayName: user.displayName },
    }),
  });
  const signupJson = await signup.json().catch(() => ({}));
  if (signup.ok && signupJson?.session?.user?.id) {
    return signupJson.session.user.id;
  }

  const signin = await fetch(`${AUTH}/signin/email-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const signinJson = await signin.json();
  if (!signin.ok || !signinJson?.session?.user?.id) {
    throw new Error(
      `Auth failed for ${user.email}: ${JSON.stringify(signupJson)} / ${JSON.stringify(signinJson)}`
    );
  }
  return signinJson.session.user.id;
}

async function main() {
  console.log('Provisioning demo users via', AUTH);
  const mapped = [];

  for (const u of USERS) {
    const id = await signupOrSignin(u);
    mapped.push({ ...u, id });
    console.log(`  ${u.email} ${id} (${u.role})`);
  }

  const fs = await import('fs');
  const path = await import('path');
  const out = path.join(process.cwd(), 'scripts', 'demo-users.json');
  fs.writeFileSync(
    out,
    JSON.stringify(
      Object.fromEntries(
        mapped.map((u) => [
          u.email,
          {
            id: u.id,
            password: u.password,
            email: u.email,
            displayName: u.displayName,
            org: u.orgId,
            role: u.role,
          },
        ])
      ),
      null,
      2
    )
  );

  await gql(
    `mutation Clear {
      delete_org_members(where: {}) { affected_rows }
    }`
  );

  await gql(
    `mutation InsertMembers($objects: [org_members_insert_input!]!) {
      insert_org_members(objects: $objects) { affected_rows }
    }`,
    {
      objects: mapped.map((u) => ({
        org_id: u.orgId,
        user_id: u.id,
        role: u.role,
      })),
    }
  );

  await gql(`
    mutation EnsureSteps {
      delete_workflow_steps(where: { workflow_id: { _eq: "cccccccc-cccc-cccc-cccc-cccccccccccc" }, name: { _eq: "Notify ops" } }) { affected_rows }
      insert_workflow_steps_one(object: {
        id: "d6666666-6666-6666-6666-666666666666"
        workflow_id: "cccccccc-cccc-cccc-cccc-cccccccccccc"
        name: "Notify ops"
        step_type: notify
        position: 5
        config: {
          channel: "email"
          message: "Sentiment pipeline finished: {{previous}}"
          to: "ops@acme.test"
        }
      }) { id }
    }
  `).catch(async () => {
    await gql(`
      mutation UpsertNotify {
        insert_workflow_steps_one(
          object: {
            id: "d6666666-6666-6666-6666-666666666666"
            workflow_id: "cccccccc-cccc-cccc-cccc-cccccccccccc"
            name: "Notify ops"
            step_type: notify
            position: 5
            config: { channel: "email", message: "Done: {{previous}}", to: "ops@acme.test" }
          }
          on_conflict: { constraint: workflow_steps_pkey, update_columns: [config, name, step_type, position] }
        ) { id }
      }
    `);
  });

  await gql(`
    mutation EnsureDbEventTrigger {
      insert_workflow_triggers_one(
        object: {
          id: "e3333333-3333-3333-3333-333333333333"
          workflow_id: "cccccccc-cccc-cccc-cccc-cccccccccccc"
          trigger_type: database_event
          is_active: true
          config: { watch_key: "demo_event" }
        }
        on_conflict: { constraint: workflow_triggers_pkey, update_columns: [config, is_active] }
      ) { id }
    }
  `).catch(() => undefined);

  await gql(`
    mutation EnsureScheduled {
      insert_workflow_triggers_one(
        object: {
          id: "e4444444-4444-4444-4444-444444444444"
          workflow_id: "cccccccc-cccc-cccc-cccc-cccccccccccc"
          trigger_type: scheduled
          is_active: false
          config: { cron: "*/5 * * * *" }
        }
        on_conflict: { constraint: workflow_triggers_pkey, update_columns: [config] }
      ) { id }
    }
  `).catch(() => undefined);

  console.log('Demo users ready');
  console.log(
    JSON.stringify(
      Object.fromEntries(
        mapped.map((u) => [u.email, { id: u.id, org: u.orgId, role: u.role }])
      ),
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
