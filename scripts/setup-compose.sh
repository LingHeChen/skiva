#!/usr/bin/env bash
# Generate local Compose configuration without replacing existing credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v openssl >/dev/null || { echo 'openssl is required / 需要 openssl' >&2; exit 1; }
if [[ -e .env || -L .env ]]; then
  echo '.env already exists; left unchanged / .env 已存在，未修改'
  exit 0
fi
umask 077
compose_db_password=$(openssl rand -hex 24)
compose_admin_password=$(openssl rand -hex 24)
# noclobber also prevents overwriting a file created concurrently.
(set -o noclobber
cat > .env <<ENV
# Local Docker Compose / 本地 Docker Compose
SKIVA_DB_PASSWORD=$compose_db_password
SKIVA_ADMIN_EMAIL=admin@localhost
SKIVA_ADMIN_PASSWORD=$compose_admin_password
SKIVA_WEB_PORT=3000
SKIVA_API_PORT=8080
SKIVA_GIT_ALLOWLIST=
ENV
)
echo 'Created .env (0600). Read the administrator password there; keep this file private.'
echo '已创建 .env（0600）。管理员密码在该文件内，请妥善保存。'
echo 'Next / 下一步: docker compose up --build -d --wait'
