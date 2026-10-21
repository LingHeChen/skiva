#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ESDP_DATABASE_URL:?Set ESDP_DATABASE_URL}"
: "${ESDP_BACKUP_DIR:?Set a protected ESDP_BACKUP_DIR}"
# Stop API/Worker writes before running this command for a consistent recovery point.
umask 077
backup_path="$ESDP_BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_path"
if [[ -n "${ESDP_PG_CONTAINER:-}" ]]; then
  backup_db=$(python3 -c 'import os,urllib.parse;print(urllib.parse.urlparse(os.environ["ESDP_DATABASE_URL"]).path.lstrip("/"))')
  docker exec "$ESDP_PG_CONTAINER" pg_dump -U esdp -d "$backup_db" -Fc > "$backup_path/database.dump"
else
  pg_dump "$ESDP_DATABASE_URL" -Fc -f "$backup_path/database.dump"
fi
tar -czf "$backup_path/objects.tar.gz" -C "${ESDP_DATA_DIR:-.data}" .
(cd "$backup_path" && shasum -a 256 database.dump objects.tar.gz > SHA256SUMS)
printf 'Backup created: %s\n' "$backup_path"
