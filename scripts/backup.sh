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
python3 - "$backup_path" <<'PYMETA'
import datetime,json,os,pathlib,subprocess,sys
keys=['SKIVA_MANAGED_GIT_ENABLED','SKIVA_MANAGED_GIT_WRITE_ENABLED','SKIVA_MANAGED_GIT_AUTO_CI_ENABLED','SKIVA_GIT_PUBLIC_URL','SKIVA_GIT_TRUST_PROXY','SKIVA_ENV']
try: revision=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
except subprocess.CalledProcessError: revision='unknown'
metadata={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'revision':revision,'configuration':{k:os.environ[k] for k in keys if k in os.environ},'storage':['objects','git','managed-git','git-spool'],'secretReferences':'Restore secret values separately from the deployment secret manager; database stores references/hashes only.'}
pathlib.Path(sys.argv[1],'recovery-point.json').write_text(json.dumps(metadata,indent=2)+'\n')
PYMETA
(cd "$backup_path" && shasum -a 256 database.dump objects.tar.gz recovery-point.json > SHA256SUMS)
printf 'Backup created: %s\n' "$backup_path"
