# Architecture write-up

## Schema reasoning

The tenant root is `organizations`, with usage quota (`quota_used` / `quota_limit` / `quota_period_start`) stored on the org so every completed run can increment a single counter under admin privileges. Membership lives in `org_members` (`owner` | `editor` | `viewer`) and is the join key for **all** Hasura permission filters — role alone is never enough.

`workflows` belong to an org; `workflow_steps` are ordered by `position` with JSONB `config`; `workflow_triggers` attach start mechanisms (manual, webhook, scheduled, database_event). Executions are `workflow_runs` (including explicit `paused`) and `step_runs` (per-step status, I/O, attempts, `approved_by` / `approved_at`).

Side tables close the loop for two step types:

- `workflow_data` — target of `db_write`, and the watched table for `database_event` triggers.
- `notification_outbox` — `notify` inserts a row; a Hasura **Event Trigger** delivers Slack/email asynchronously.

Aggregation is the Postgres view `org_usage_stats` (quota remaining, runs this month, average completed-run duration), tracked in Hasura with the same org-member filter.

## Two permission layers

### Layer 1 — org + role scoping (Hasura)

Every select/insert/update/delete permission for business tables nests through `organization.members` (or `workflow.organization.members`) with `user_id = X-Hasura-User-Id`. That means an editor in Org A and an editor in Org B share a Hasura role name (`user`) but never share rows. Role checks are layered on top (`owner` for member management, `owner|editor` for edits/triggers, viewers read-only and blocked from `triggerWorkflowRun` in the Action).

### Layer 2 — step-level gating (Hasura checks + Action handler)

Some capabilities leave the sandbox:

- **Creating** `db_write` / `notify` steps, or a **webhook** trigger, requires `role = owner` in the Hasura insert `check` (editors can create other step types).
- **Clearing an `approval_gate`** cannot be a plain row update: it is a mid-execution decision. `approveStep` loads the paused step, verifies the caller is `owner` or `editor` **in that workflow’s org**, then marks the step approved and resumes the engine. A guessed foreign `step_run_id` fails membership and returns 403.

## Approval-gate pause / resume

`triggerWorkflowRun` verifies membership + quota, inserts a `workflow_runs` row, then executes steps in order via the Action handler (admin secret). On `approval_gate`, the current `step_runs` row and parent run are set to `paused` and execution returns. The UI subscription on `step_runs(where: { workflow_run_id })` surfaces that state live. `approveStep` performs the Layer-2 role check, writes `approved_by` / `approved_at`, and continues from the next position — including remaining steps such as `db_write`. Successful completion increments org quota.

LLM and HTTP steps use at least one retry on failure. Without an API key, `llm_call` uses a disclosed stub with an artificial delay so the Final Task remains demoable.
