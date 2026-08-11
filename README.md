# Chainyard — AI Agent Workflow Builder

A small app where people in a company can build **AI workflows** (like a mini n8n).

You drag together steps: ask an AI, call a website, wait for a human to approve, then save or send a notification. Everything is locked to **your company**. Someone from another company cannot see or run your stuff — even if they guess the ID.

---

## Links (for submission)

| What | Where |
|------|--------|
| This GitHub repo | https://github.com/vijageesh79/chainyard-workflow-builder |
| Hosted website | https://chainyard.vercel.app |
| Longer technical write-up | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Screen-recording script | [docs/DEMO_RECORDING.md](docs/DEMO_RECORDING.md) |

**Best way to try it:** run it on your own computer (below).  
The hosted site only works if the laptop that owns the database is on and tunnels are running. Local is the reliable demo.

---

## What this app does (in plain English)

Imagine two companies: **Org A** and **Org B**.

- People in Org A can build a pipeline: “Read this text → ask AI if it is positive → call an API → **pause for a manager** → save the result → email ops.”
- They can start that pipeline by clicking **Run**, or by an outside system calling a **webhook** (no button click).
- While it runs, the screen updates **live** — you do not refresh the page.
- When it hits “needs approval”, it **pauses**. Only an owner or editor **in that same company** can click Approve.
- If you log in as Org B, you see **nothing** from Org A.

That one walkthrough proves the database, permissions, backend, and live updates all work together.

---

## What you need on your computer

1. **Docker Desktop** — install it and **leave it running** (whale icon in the menu bar).  
   If Docker is off, login will fail.
2. **Node.js 18 or newer** — so you can run the website.
3. That’s it. An AI API key is optional.

---

## How to run it locally (copy-paste)

Open Terminal, go to this folder, then run:

```bash
# 1. Start the database, login service, and GraphQL API
docker compose up -d

# 2. Wait ~15 seconds, then wire up permissions and demo users
node scripts/apply-metadata.mjs
node scripts/provision-demo-users.mjs

# 3. Start the website
cd web
cp .env.example .env.local
npm install
npm run dev
```

Open your browser: **http://localhost:3000**

You should see a **Sign in** screen (not “Connecting to auth…”).

### If something is already running

You can skip `npm install` next time. Just:

```bash
docker compose up -d
node scripts/apply-metadata.mjs
node scripts/provision-demo-users.mjs
cd web && npm run dev
```

### What each piece is (you don’t need to memorize this)

| Address | What it is |
|---------|------------|
| http://localhost:3000 | The website you click around in |
| http://localhost:8080 | Hasura (the GraphQL API / “brain” for data) |
| http://localhost:4000 | Login service (nhost Auth) |
| http://localhost:8025 | Fake inbox for “notify” emails (Mailhog) |

---

## Demo logins (all passwords are `password`)

Click a demo account on the login page, or type:

| Email | Company | What they can do |
|-------|---------|------------------|
| `owner-a@acme.test` | Org A | Full control. Build workflows. Run. Approve. Add “dangerous” steps. |
| `editor-a@acme.test` | Org A | Edit and run workflows. Approve. **Cannot** add db_write / notify / webhook. |
| `viewer-a@acme.test` | Org A | Look only. **No Run button.** Cannot approve. |
| `owner-b@beta.test` | Org B | Owner of a **different** company. Cannot see Org A at all. |

---

## The demo workflow (already created for you)

**Name:** Sentiment Gate Pipeline (Org A)

It runs in this order:

1. **llm_call** — ask an AI: is this text positive or negative?  
   *(If you didn’t add an AI key, it still works. It waits ~1 second and returns a fake “positive” answer. That is on purpose.)*
2. **http_request** — send that result to a public test API.
3. **conditional_branch** — if the AI said “positive”, take the “yes” path.
4. **approval_gate** — **stop and wait** for a human.
5. **db_write** — save the result in our database.
6. **notify** — queue an email/Slack-style alert.

It can be started two ways:

- **Manual** — the **Run** button
- **Webhook** — a secret URL/API call (no button)

There are also scheduled (cron) and database-event triggers wired up.

---

## Try it yourself (same path as the recording)

Do this in order. The screen-recording script is the same walkthrough: [docs/DEMO_RECORDING.md](docs/DEMO_RECORDING.md).

### 1. Two companies already exist

Org A has three people. Org B has one. Sign in as each if you want to see the difference.

### 2. Open the Org A workflow

1. Sign in as `owner-a@acme.test` / `password`
2. You should see **Sentiment Gate Pipeline**
3. Check the step tags and the **usage** box on the right

### 3. Start it with Run and watch it live

1. Click **Run**
2. A **Live run** page opens
3. Steps flip from running to completed **without refreshing**
4. It **pauses** at human approval
5. On the right: **Approve & resume**

### 4. Approve (only the right people)

- Owner or `editor-a@acme.test` can approve
- After approve: remaining steps finish, status is **completed**, quota goes up by 1
- A viewer cannot approve
- Someone from Org B cannot approve either (see step 6)

### 5. Start it again with a webhook (no button)

Keep the site open. In Terminal:

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

You should get a new run id and `"status": "paused"`.  
Open **Latest run** — same pause, but nobody clicked Run.

### 6. Prove Org B is locked out

1. Sign out
2. Sign in as `owner-b@beta.test` / `password`
3. The workflow list should be empty
4. Paste this Org A link:  
   http://localhost:3000/app/workflows/cccccccc-cccc-cccc-cccc-cccccccccccc  
   You should **not** see the Org A workflow
5. Approving an Org A paused step as this user is denied

### Extra things to try

- `viewer-a@acme.test` — **Run** is hidden
- **New workflow** — add and reorder steps, attach a trigger, Save
- Only an **owner** can add `db_write`, `notify`, or a **webhook** trigger

---

## How security works (simply)

**Company first**  
Every piece of data is filtered by membership. Role names like “editor” are not enough. An editor in Org A and an editor in Org B never see each other’s rows.

| Role | Can see their org | Can edit workflows | Can click Run | Can manage members | Can add db_write / notify / webhook |
|------|-------------------|--------------------|---------------|--------------------|-------------------------------------|
| Owner | Yes | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | Yes | No | No |
| Viewer | Yes | No | No | No | No |

**Some steps are extra locked**  
- Adding a step that writes to the database, sends a notify, or opens a webhook is **owner-only** (checked in the database rules).  
- **Approving a paused run** is checked again in the backend (`approveStep`), not only in the database. Guessing another company’s step ID still fails.

---

## How a run actually works

1. App calls `triggerWorkflowRun`
2. Server checks: are you owner/editor in that org? Is quota left?
3. It creates a run, then executes steps one by one
4. AI and HTTP steps **retry once** if they fail
5. On approval_gate: run status = **paused**, live UI shows it
6. `approveStep` checks role again, then continues
7. When everything finishes: quota +1

---

## Login failed? Site stuck? Read this first

| What you see | Likely cause | What to do |
|--------------|--------------|------------|
| Login failed / cannot sign in | Docker is not running | Open **Docker Desktop**, wait until it is ready, then `docker compose up -d` and `node scripts/provision-demo-users.mjs` |
| “Connecting to auth…” forever | Auth service not up | `curl http://localhost:4000/healthz` should say ok. Then restart `cd web && npm run dev` |
| “internal error” on **Run** (especially on Vercel) | Website cannot reach the database/API | Use **http://localhost:3000**, or bring Docker + tunnels back |
| “subscriptions must select one top level field” | Old bug | Already fixed. Hard-refresh. If you still see it, you’re on an old tab. |
| Vercel site loads but login/run dies | Hosted UI is live; database is on your laptop | Start Docker locally. Prefer localhost for the demo. |
| Port 3000 already in use | Another Node process | Stop it or use the URL Terminal prints (sometimes `:3001`) |

Health checks:

```bash
curl http://localhost:3000          # website
curl http://localhost:8080/healthz  # Hasura
curl http://localhost:4000/healthz  # login
```

---

## Optional: real AI instead of the fake delay

Create `web/.env.local` (copy from `web/.env.example`) and add **one** of:

```
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
GEMINI_API_KEY=...
```

Restart `npm run dev`. If none are set, the app still runs with a short wait and a fake “positive” answer. That is on purpose so the demo works without a paid key.

---

## Start a run without the UI (other triggers)

**Webhook** — see walkthrough above. Secret: `org-a-webhook-secret`

**Database event** — inserting a row with key `demo_event` can auto-start a run:

```bash
curl -s http://localhost:8080/v1/graphql \
  -H 'x-hasura-admin-secret: workflow-builder-admin-secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation { insert_workflow_data_one(object:{ org_id:\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\", key:\"demo_event\", value:{ ping:true } }) { id } }"
  }'
```

**Scheduled** — Hasura cron hits the scheduled runner every 5 minutes for workflows that have an **active** scheduled trigger (the demo one is off by default so it does not surprise you).

---

## Where the code lives (if you want to poke around)

| Folder / file | Meaning |
|---------------|---------|
| `nhost/migrations/` | Database tables (orgs, workflows, runs, …) |
| `nhost/metadata/` + `scripts/apply-metadata.mjs` | Hasura relationships and permissions |
| `web/src/lib/workflow/` | Engine: run steps, retry, pause, resume, quota |
| `web/src/app/api/actions/` | Hasura Actions (start run, approve, webhook, cron, notify, db event) |
| `web/src/app/` | Website: login, builder, live run page |
| `functions/` | Thin nhost Function wrappers (same handlers as Next.js) |
| `scripts/seed.sql` | Starting demo workflow |
| `scripts/provision-demo-users.mjs` | Creates the four demo logins |

---

## Hosted site (Vercel) — honest note

- **Frontend:** https://chainyard.vercel.app  
- **Backend** (database + login) still runs in Docker on the developer’s machine.

So:

- Clone this repo and run it locally (about 15 minutes). That is the reliable demo.
- The Vercel URL is the public website. Login and runs only work if Docker and tunnels are up on the machine that hosts the database.

To redeploy only the website after a code change:

```bash
cd web
npx vercel --prod
```

---

## Screen recording (strongly recommended)

Record ~3–4 minutes while doing the walkthrough above. Full shot list: [docs/DEMO_RECORDING.md](docs/DEMO_RECORDING.md).  
Upload to Loom or unlisted YouTube and add the link here when you have it:

**Recording:** _(paste link)_

---

## Contributors

- **[Vijageesh Oruganti](https://github.com/vijageesh79)** — Author & Developer

---

## That’s the whole product

If the walkthrough works — two companies, AI + HTTP + branch + approval, two ways to start a run, live updates, Org B isolation — then the database, permissions, backend, and live subscriptions are all doing their job.

