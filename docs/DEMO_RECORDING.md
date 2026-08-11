# How to record the demo (about 3–4 minutes)

Start the stack, then record your screen and talk through what you are doing.

```bash
docker compose up -d
node scripts/apply-metadata.mjs
node scripts/provision-demo-users.mjs
cd web && npm run dev
```

Open http://localhost:3000.

## 1. Open the Org A workflow (about 40 seconds)

Sign in as `owner-a@acme.test` / `password`.

Show the **Sentiment Gate Pipeline** and its steps: AI call, HTTP request, branch, approval, database write, notify. Mention that it can be started from the **Run** button or a webhook. Point at the usage quota.

## 2. Run it and watch it update live (about 1 minute)

Click **Run**. Leave the page open and show statuses changing on their own until the run **pauses** on the approval step.

## 3. Approve and finish (about 30 seconds)

Click **Approve & resume**. Show the remaining steps finish and the quota go up by one.

## 4. Start the same workflow with a webhook (about 30 seconds)

Keep the browser visible, then run:

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

Open the new run and show that it also pauses for approval.

## 5. Prove Org B cannot see Org A (about 50 seconds)

Sign out. Sign in as `owner-b@beta.test` / `password`.

Show an empty workflow list. Paste Org A’s workflow URL (`/app/workflows/cccccccc-cccc-cccc-cccc-cccccccccccc`) and show nothing comes back. If you try to approve an Org A step as this user, you get denied.

## If you still have time

- Sign in as `viewer-a@acme.test` / `password`. The **Run** button should not appear.
- Insert a `workflow_data` row with key `demo_event` to show a database event starting a run (command is in the README).

Stop recording. Upload to Loom or unlisted YouTube, then paste the link in the README under **Recording**.
