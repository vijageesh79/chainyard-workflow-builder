# Final Task — recording script (~3–4 min)

Record your screen while doing exactly this. Narrate briefly.

## Prep
```bash
docker compose up -d
node scripts/apply-metadata.mjs
node scripts/provision-demo-users.mjs
cd web && npm run dev
```
Open http://localhost:3000 (or your hosted URL).

## Scene 1 — Org A owner builds / opens workflow (0:00–0:40)
1. Sign in as `owner-a@acme.test` / `password`
2. Show **Sentiment Gate Pipeline** with steps: `llm_call`, `http_request`, `conditional_branch`, `approval_gate`, `db_write`, `notify`
3. Point at triggers: **manual** + **webhook** (+ database_event)
4. Show usage quota indicator

## Scene 2 — Manual run + live subscription (0:40–1:40)
1. Click **Run**
2. Watch step statuses update live (no refresh): running → completed → … → **paused**
3. Call out the paused approval gate UI

## Scene 3 — Approval Layer 2 (1:40–2:10)
1. Click **Approve & resume**
2. Show remaining steps complete (`db_write`, `notify`)
3. Show quota incremented

## Scene 4 — Second start path: webhook (2:10–2:40)
Run in terminal (keep browser visible afterward on a new paused run):
```bash
curl -s http://localhost:3000/api/actions/webhook-start \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {
      "workflow_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
      "secret": "org-a-webhook-secret",
      "input": { "text": "Absolutely wonderful launch." }
    }
  }'
```
Open the new run in the UI and show it paused awaiting approval.

## Scene 5 — Cross-org isolation (2:40–3:30)
1. Sign out → sign in as `owner-b@beta.test`
2. Show empty Org B workflows list
3. Paste Org A workflow URL `/app/workflows/cccccccc-cccc-cccc-cccc-cccccccccccc` → no data
4. Attempt approve with Org B user against Org A `step_run_id` → **403 / Not a member**

## Optional (if time)
- Sign in as `viewer-a@acme.test` → **Run** button hidden; trigger fails if forced
- Insert `workflow_data` with key `demo_event` to show database_event auto-start

Stop recording. Upload unlisted YouTube/Loom and link it in the README.
