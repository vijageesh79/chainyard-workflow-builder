# How Chainyard is put together

## Database

`organizations` is the tenant. Quota (`quota_used` / `quota_limit` / `quota_period_start`) lives on the org so a finished run can increment one counter. People belong to orgs through `org_members` (`owner`, `editor`, `viewer`). Every Hasura permission filter goes through that membership. A role name by itself is never enough.

`workflows` belong to an org. `workflow_steps` are ordered by `position` and store JSON `config`. `workflow_triggers` attach how a run can start: manual, webhook, scheduled, or database event.

A run is a `workflow_runs` row (including `paused`). Each step gets a `step_runs` row with status, input/output, attempts, and optional `approved_by` / `approved_at`.

Two side tables close the loop:

- `workflow_data` — where `db_write` saves, and what a `database_event` trigger watches
- `notification_outbox` — `notify` inserts a row; a Hasura event trigger sends Slack or email later

`org_usage_stats` is a Postgres view (quota left, runs this month, average completed-run time). Hasura tracks it with the same membership filter.

## Permissions

### Company and role

Every select / insert / update / delete on business tables goes through `organization.members` (or `workflow.organization.members`) with `user_id = X-Hasura-User-Id`. An editor in Org A and an editor in Org B share the Hasura role `user` but never share rows.

On top of that:

- owners manage members
- owners and editors edit workflows and start runs
- viewers are read-only, and `triggerWorkflowRun` rejects them

### Extra locks on dangerous steps

- Creating a `db_write` or `notify` step, or a webhook trigger, requires `role = owner` in the Hasura insert check. Editors can still add the other step types.
- Clearing an approval gate is not a plain row update. `approveStep` loads the paused step, checks the caller is an owner or editor **in that workflow’s org**, then marks it approved and resumes. A guessed foreign `step_run_id` fails membership and returns 403.

## Pause and resume

`triggerWorkflowRun` checks membership and quota, inserts a `workflow_runs` row, then runs steps in order (admin secret). On `approval_gate`, the current `step_runs` row and parent run become `paused` and execution returns.

The live page subscribes to `step_runs` for that run, so the pause shows up without a refresh. `approveStep` checks the role again, writes `approved_by` / `approved_at`, and continues from the next step (including `db_write` and `notify`). A successful finish increments org quota.

LLM and HTTP steps retry once on failure. With no API key, `llm_call` waits about a second and returns a fake positive result so the demo still runs.
