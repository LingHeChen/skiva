#!/usr/bin/env bash
set -euo pipefail
: "${SKIVA_RESTORE_DATABASE_URL:?Set a NEW EMPTY restore database URL}"
: "${SKIVA_RESTORE_DATA_DIR:?Set a NEW EMPTY restore data directory}"
backup_path="${1:?Usage: restore.sh BACKUP_DIRECTORY}"
if [[ -e "$SKIVA_RESTORE_DATA_DIR" ]]; then echo 'Restore data directory must not already exist' >&2; exit 1; fi
(cd "$backup_path" && shasum -a 256 -c SHA256SUMS)
mkdir -p "$SKIVA_RESTORE_DATA_DIR"
if [[ -n "${SKIVA_PG_CONTAINER:-}" ]]; then
  restore_db=$(python3 -c 'import os,urllib.parse;print(urllib.parse.urlparse(os.environ["SKIVA_RESTORE_DATABASE_URL"]).path.lstrip("/"))')
  docker exec -i "$SKIVA_PG_CONTAINER" pg_restore --exit-on-error --no-owner -U skiva --dbname="$restore_db" < "$backup_path/database.dump"
else
  pg_restore --exit-on-error --no-owner --dbname="$SKIVA_RESTORE_DATABASE_URL" "$backup_path/database.dump"
fi
tar -xzf "$backup_path/objects.tar.gz" -C "$SKIVA_RESTORE_DATA_DIR"
SKIVA_DATABASE_URL="$SKIVA_RESTORE_DATABASE_URL" SKIVA_DATA_DIR="$SKIVA_RESTORE_DATA_DIR" GOTOOLCHAIN=go1.26.10 go run ./apps/server/cmd/maintenance verify
