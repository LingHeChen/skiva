# Run with Docker Compose

English · [简体中文](COMPOSE.zh-CN.md)

The root `compose.yaml` is a local, single-host evaluation stack. It builds the backend and console from source, starts PostgreSQL, runs migrations automatically, then waits for backend health before starting the console. Only Docker Compose v2 and OpenSSL are needed on the host; Go and Node build inside containers.

## Start

From the repository root:

```bash
./scripts/setup-compose.sh
docker compose up --build -d --wait
```

Open <http://localhost:3000>. Sign in as `admin@localhost` using `SKIVA_ADMIN_PASSWORD` from `.env`. The setup script creates random database and administrator passwords with file mode 0600 and never overwrites an existing `.env`. `.env.local` belongs to source development and is not loaded by this Compose entry point.

First-time image downloads/builds may take several minutes. If ports are occupied, change `SKIVA_WEB_PORT` and `SKIVA_API_PORT` in `.env` before starting. The Web origin automatically follows the selected Web port; use `localhost`, not a different hostname, in the browser.

Both published ports bind only to 127.0.0.1. PostgreSQL is internal. This template uses development password sign-in and HTTP: it is not a public production deployment. Hosted Git is deliberately disabled because it requires HTTPS and the Docker network is not a loopback transport. Use external Git sources for local evaluation. For hosted Git, public domains, TLS, and enterprise OIDC, use the [preproduction template](preproduction/README.md).

`SKIVA_GIT_ALLOWLIST` can authorize specific private source hosts; public Git sources still follow the backend's validation policy. Container `localhost` is the container itself, not your host machine. Configure corporate CAs, credential Secret references, and network reachability as described in [Operations](../docs/OPERATIONS.md).

## Check and stop

```bash
docker compose ps
docker compose logs --tail=100 migrate server web
docker compose stop
docker compose start
```

The migration service should exit successfully (code 0); it is not a continuously running service. `docker compose up -d --wait` can reconcile configuration changes.

## Upgrade

Back up first. Stop application writes before migration, then update source and rebuild:

```bash
docker compose stop web server
git pull --ff-only
docker compose up --build -d --wait
```

The new migration container must complete before the server starts. If migration fails, inspect its logs before retrying; do not use a destructive down migration. Back up PostgreSQL and the entire artifacts volume together while API/worker writes are stopped; see [backup and recovery](../docs/OPERATIONS.md#backup-and-recovery).

## Data and credentials

Named volumes `postgres` and `artifacts` persist database and CAS/Git data across container recreation. The default project prefix is `skiva-compose`, separate from the source-development stack. Changing the Compose project name selects different volumes.

`docker compose down` removes containers/networks but retains named volumes. **`docker compose down -v` deletes the database and artifact volumes.** Do not use it to upgrade or repair startup failures.

Keep `.env` with the deployment. Changing `SKIVA_DB_PASSWORD` after PostgreSQL initializes does not rotate its stored password. Changing the bootstrap administrator password in `.env` does not reset an existing account. Rotate existing credentials through the appropriate database/account administration process; never delete persistent data to reset a password.
