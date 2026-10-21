#!/usr/bin/env bash
set -euo pipefail
if docker inspect esdp-postgres >/dev/null 2>&1; then
  docker start esdp-postgres >/dev/null
else
  docker compose -f deployments/compose.yaml up -d postgres
fi
