#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ -f .env.local ]]; then set -a; source .env.local; set +a; fi
: "${SKIVA_ADMIN_PASSWORD:?Configure .env.local with administrator password}"
: "${MINIMAX_M2_AUTH_TOKEN:?Set model credential in environment}"
: "${MINIMAX_M2_BASE_URL:?Set Anthropic-compatible model endpoint}"
export SKIVA_PILOT_ARCH="$(docker info --format '{{.Architecture}}')"
case "$SKIVA_PILOT_ARCH" in aarch64|arm64) SKIVA_PILOT_ARCH=arm64;; x86_64|amd64) SKIVA_PILOT_ARCH=amd64;; *) exit 1;; esac
export GOTOOLCHAIN=go1.26.10
mkdir -p .data/agent-pilot
uv venv --python 3.12 --allow-existing .data/agent-pilot-venv
uv pip sync --python .data/agent-pilot-venv/bin/python examples/pydantic-agent/requirements.txt
make db
for ((i=0; i<60; i++)); do
  if docker exec skiva-postgres pg_isready -U skiva >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! docker exec skiva-postgres psql -U skiva -d skiva_agent_pilot -c 'SELECT 1' >/dev/null 2>&1; then
  docker exec skiva-postgres createdb -U skiva skiva_agent_pilot
fi
export SKIVA_DATABASE_URL='postgres://skiva:skiva-dev@localhost:55432/skiva_agent_pilot?sslmode=disable'
make migrate-up build-server
GOOS=linux GOARCH="$SKIVA_PILOT_ARCH" go build -o "bin/skills-mount-linux-$SKIVA_PILOT_ARCH" ./apps/mount/cmd/skills-mount
export SKIVA_ENV=development
export SKIVA_DATA_DIR="$PWD/.data/agent-pilot/server" SKIVA_LISTEN=127.0.0.1:8083
export SKIVA_MANAGED_GIT_ENABLED=true SKIVA_MANAGED_GIT_WRITE_ENABLED=true SKIVA_MANAGED_GIT_AUTO_CI_ENABLED=true
export SKIVA_GIT_ALLOW_LOOPBACK_HTTP=true SKIVA_GIT_PUBLIC_URL=http://127.0.0.1:8083
if ! curl --noproxy '*' -fsS http://127.0.0.1:8083/healthz >/dev/null; then
  nohup bin/skiva-server > .data/agent-pilot/server.log 2>&1 &
  echo $! > .data/agent-pilot/server.pid
fi
if ! docker inspect skiva-agent-fuse >/dev/null 2>&1; then
  docker run -d --name skiva-agent-fuse --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor=unconfined \
    -v "$PWD/bin:/opt/skiva:ro" -v "$PWD/.data/agent-pilot:/pilot:ro" postgres:17 \
    sh -c 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fuse3 socat >/dev/null && exec socat TCP-LISTEN:8080,bind=127.0.0.1,reuseaddr,fork TCP:host.docker.internal:8083'
else
  docker start skiva-agent-fuse >/dev/null
fi
# Docker Desktop supplies host.docker.internal; the host server stays loopback-only.
for ((i=0; i<120; i++)); do
  if docker exec skiva-agent-fuse sh -c 'command -v fusermount3 >/dev/null && pgrep socat >/dev/null' && curl --noproxy '*' -fsS http://127.0.0.1:8083/healthz >/dev/null; then break; fi
  sleep 1
done
exec .data/agent-pilot-venv/bin/python examples/pydantic-agent/pilot.py
