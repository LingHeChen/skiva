#!/usr/bin/env bash
set -euo pipefail
if docker inspect skiva-postgres >/dev/null 2>&1; then
  docker start skiva-postgres >/dev/null
else
  docker compose -f deployments/compose.yaml up -d postgres
fi
