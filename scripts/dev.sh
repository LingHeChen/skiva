#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env.local ]]; then set -a; source .env.local; set +a; fi
: "${ESDP_ADMIN_PASSWORD:?Set ESDP_ADMIN_PASSWORD (at least 14 characters) in .env.local}"
make db migrate-up
go run ./apps/server/cmd/server &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM
npm run dev --prefix apps/web -- --port "${ESDP_WEB_PORT:-3000}"
