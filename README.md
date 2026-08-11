# Chainyard — AI Agent Workflow Builder

Mini n8n for chaining AI agent steps. **nhost/hasura-auth + Hasura + Postgres + Next.js**.

## Deliverables

| Item | Status |
|------|--------|
| Schema, relationships, both permission layers | ✅ `nhost/migrations`, `nhost/metadata`, `scripts/apply-metadata.mjs` |
| Actions: `triggerWorkflowRun`, `approveStep`, webhook | ✅ `web/src/app/api/actions/*` |
| Step types incl. LLM / HTTP / branch / approval / db_write / notify | ✅ |
| Triggers: manual, webhook, scheduled cron, database_event | ✅ |
| Live subscriptions + quota | ✅ |
| Auth via nhost (hasura-auth) + `@nhost/nextjs` | ✅ |
| Architecture write-up | ✅ `docs/ARCHITECTURE.md` |
| Recording script | ✅ `docs/DEMO_RECORDING.md` |
| GitHub repo | ⏳ push after `gh auth login` |
| Hosted Next.js URL | ⏳ deploy after `npx vercel login` |

## Quick start (local)

### Prerequisites
- Docker Desktop
- Node 18+
- Optional LLM key: `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY`  
  *(without a key, `llm_call` uses a **disclosed stub** with ~800ms delay)*

### Boot

```bash
docker compose up -d
# wait for http://localhost:8080/healthz and http://localhost:4000/healthz

node scripts/apply-metadata.mjs
node scripts/provision-demo-users.mjs   # nhost signup + org memberships

cd web
cp .env.example .env.local
npm install
npm run dev
```

Open **http://localhost:3000**

Services:
- Next.js UI + Action handlers → `:3000`
- Hasura → `:8080` (admin secret `workflow-builder-admin-secret`)
- **nhost/hasura-auth** → `:4000`
- Mailhog (notify emails) → `:8025`

### Demo accounts (password: `password`)

| Email | Org | Role |
|-------|-----|------|
| `owner-a@acme.test` | Org A | owner |
| `editor-a@acme.test` | Org A | editor |
| `viewer-a@acme.test` | Org A | viewer |
| `owner-b@beta.test` | Org B | owner |

Seeded workflow **Sentiment Gate Pipeline**:  
`llm_call` → `http_request` → `conditional_branch` → `approval_gate` → `db_write` → `notify`  
Triggers: manual + webhook (+ database_event / scheduled available).

### Webhook start

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

### Database-event start

```bash
# as Org A editor/owner JWT, or via admin:
curl -s http://localhost:8080/v1/graphql \
  -H 'x-hasura-admin-secret: workflow-builder-admin-secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation { insert_workflow_data_one(object:{ org_id:\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\", key:\"demo_event\", value:{ ping:true } }) { id } }"
  }'
```

## Final Task walkthrough

Follow **[docs/DEMO_RECORDING.md](docs/DEMO_RECORDING.md)** — covers all six acceptance points for the live scenario / screen recording.

## Auth model

- Primary: **`@nhost/nextjs`** → `nhost/hasura-auth` (`NEXT_PUBLIC_NHOST_AUTH_URL`)
- Fallback: local JWT bridge (`/api/auth/login`) with identical Hasura claims if auth is down
- Cloud: set `NEXT_PUBLIC_NHOST_SUBDOMAIN` + `NEXT_PUBLIC_NHOST_REGION` and point Hasura JWT at your nhost project

## Deploy (hosted URL)

### 1. GitHub
```bash
gh auth login
git add -A && git commit -m "feat: Chainyard AI agent workflow builder"
gh repo create chainyard-workflow-builder --public --source=. --remote=origin --push
```

### 2. Backend
Use this docker stack on a VM **or** create an [nhost.io](https://nhost.io) project and apply `nhost/` migrations + metadata. Set `ACTION_BASE_URL` to your Vercel origin + `/api/actions`.

### 3. Vercel frontend
```bash
cd web
npx vercel login
npx vercel --prod
```
Set env vars from `.env.example` to your hosted Hasura/Auth URLs.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Submission checklist

- [ ] GitHub repo URL
- [ ] Hosted app URL
- [ ] Loom/YouTube of Final Task (script in `docs/DEMO_RECORDING.md`)
- [ ] Optional: real LLM API key in production env
