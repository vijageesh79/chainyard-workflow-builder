#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Starting Postgres + Hasura..."
docker compose up -d

echo "→ Waiting for Hasura..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:8080/healthz >/dev/null; then
    break
  fi
  sleep 1
done

echo "→ Applying Hasura metadata..."
docker run --rm --network host \
  -v "$ROOT/nhost/metadata:/hasura-metadata" \
  -e HASURA_GRAPHQL_ENDPOINT=http://localhost:8080 \
  -e HASURA_GRAPHQL_ADMIN_SECRET=workflow-builder-admin-secret \
  hasura/graphql-engine:v2.36.0 \
  hasura metadata apply --project /hasura-metadata 2>/dev/null || true

# Prefer hasura-cli image for metadata apply
if command -v hasura >/dev/null 2>&1; then
  hasura metadata apply \
    --endpoint http://localhost:8080 \
    --admin-secret workflow-builder-admin-secret \
    --project "$ROOT/nhost" || \
  (cd "$ROOT" && npx --yes hasura-cli metadata apply \
    --endpoint http://localhost:8080 \
    --admin-secret workflow-builder-admin-secret \
    --project nhost)
else
  npx --yes hasura-cli@2.36.0 metadata apply \
    --endpoint http://localhost:8080 \
    --admin-secret workflow-builder-admin-secret \
    --project "$ROOT/nhost"
fi

# Point actions at local Next.js
echo "→ Patching action handler URLs to localhost:3000..."
curl -s http://localhost:8080/v1/metadata \
  -H 'x-hasura-admin-secret: workflow-builder-admin-secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "bulk",
    "args": [
      {
        "type": "create_action",
        "args": {
          "name": "triggerWorkflowRun",
          "definition": {
            "kind": "synchronous",
            "handler": "http://host.docker.internal:3000/api/actions/trigger-workflow-run",
            "forward_client_headers": true,
            "timeout": 300
          }
        }
      }
    ]
  }' >/dev/null 2>&1 || true

node "$ROOT/scripts/apply-metadata.mjs"

echo "✓ Backend ready"
echo "  Hasura console: http://localhost:8080/console"
echo "  Admin secret:   workflow-builder-admin-secret"
echo "  Next:           cd web && npm run dev"
