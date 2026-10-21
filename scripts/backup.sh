#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SKIVA_DATABASE_URL:?Set SKIVA_DATABASE_URL}"
: "${SKIVA_BACKUP_DIR:?Set a protected SKIVA_BACKUP_DIR}"
# Stop API/Worker writes before running this command for a consistent recovery point.
umask 077
backup_path="$SKIVA_BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_path"
if [[ -n "${SKIVA_PG_CONTAINER:-}" ]]; then
  backup_db=$(python3 -c 'import os,urllib.parse;print(urllib.parse.urlparse(os.environ["SKIVA_DATABASE_URL"]).path.lstrip("/"))')
  docker exec "$SKIVA_PG_CONTAINER" pg_dump -U skiva -d "$backup_db" -Fc > "$backup_path/database.dump"
else
  pg_dump "$SKIVA_DATABASE_URL" -Fc -f "$backup_path/database.dump"
fi
tar -czf "$backup_path/objects.tar.gz" -C "${SKIVA_DATA_DIR:-.data}" .
(cd "$backup_path" && shasum -a 256 database.dump objects.tar.gz > SHA256SUMS)
printf 'Backup created: %s\n' "$backup_path"
