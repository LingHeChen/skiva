#!/usr/bin/env bash
set -euo pipefail
: "${ESDP_RESTORE_DATABASE_URL:?Set a NEW EMPTY restore database URL}"
: "${ESDP_RESTORE_DATA_DIR:?Set a NEW EMPTY restore data directory}"
backup_path="${1:?Usage: restore.sh BACKUP_DIRECTORY}"
if [[ -e "$ESDP_RESTORE_DATA_DIR" ]]; then echo 'Restore data directory must not already exist' >&2; exit 1; fi
(cd "$backup_path" && shasum -a 256 -c SHA256SUMS)
mkdir -p "$ESDP_RESTORE_DATA_DIR"
if [[ -n "${ESDP_PG_CONTAINER:-}" ]]; then
  restore_db=$(python3 -c 'import os,urllib.parse;print(urllib.parse.urlparse(os.environ["ESDP_RESTORE_DATABASE_URL"]).path.lstrip("/"))')
  docker exec -i "$ESDP_PG_CONTAINER" pg_restore --exit-on-error --no-owner -U esdp --dbname="$restore_db" < "$backup_path/database.dump"
else
  pg_restore --exit-on-error --no-owner --dbname="$ESDP_RESTORE_DATABASE_URL" "$backup_path/database.dump"
fi
tar -xzf "$backup_path/objects.tar.gz" -C "$ESDP_RESTORE_DATA_DIR"
ESDP_DATABASE_URL="$ESDP_RESTORE_DATABASE_URL" ESDP_DATA_DIR="$ESDP_RESTORE_DATA_DIR" GOTOOLCHAIN=go1.26.10 go run ./apps/server/cmd/maintenance verify
