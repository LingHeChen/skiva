# Single-host preproduction deployment

English · [简体中文](README.zh-CN.md)

This template provides PostgreSQL, a separate migration job, backend, frontend, Caddy TLS, and optional Prometheus. Compose configuration has been validated locally. Enterprise OIDC, actual domain certificates, and alert delivery require deployment-specific verification. The local Agent pilot in `examples/pydantic-agent` does not depend on this template.

Set Compose variables: `SKIVA_SERVER_IMAGE`, `SKIVA_WEB_IMAGE` (immutable image versions), `SKIVA_DOMAIN`, `SKIVA_ACME_EMAIL`, `SKIVA_ADMIN_EMAIL`, `SKIVA_OIDC_ISSUER`, `SKIVA_OIDC_CLIENT_ID`, and `SKIVA_SECRETS_DIR` (absolute path).

The secrets directory contains `db_password`, `database_url` (targeting Compose postgres:5432/skiva), `bootstrap_password`, and `oidc_secret`. Restrict directory access to deployment administrators and allow container UID 10001 to read the files. Do not commit secrets. The server supports corresponding `_FILE` environment variables and rejects conflicting plaintext/file configuration.

```bash
docker compose -f deployments/preproduction/compose.yaml config --quiet
docker compose -f deployments/preproduction/compose.yaml up -d
```

Frontend and dependent services start after successful migration and a healthy backend. Caddy exposes 80/443; PostgreSQL and backend ports are not published, and /metrics is not public. Build the frontend with `deployments/docker/web.Dockerfile`. Verify OIDC callbacks, authorized users, and browser sign-in against the actual IdP before opening access.

Git hosting flags are disabled by default. Gradually enable `SKIVA_MANAGED_GIT_ENABLED`, `SKIVA_MANAGED_GIT_WRITE_ENABLED`, and `SKIVA_MANAGED_GIT_AUTO_CI_ENABLED=true`. `SKIVA_GIT_TRUST_PROXY=true` assumes this topology prevents direct backend access.

Use `--profile monitoring` to start Prometheus at local 127.0.0.1:9090. Configure a real Alertmanager to deliver alerts. Backups are not scheduled automatically: before a formal pilot, follow [Operations](../../docs/OPERATIONS.md) to back up and restore PostgreSQL, CAS, and bare Git repositories consistently.
