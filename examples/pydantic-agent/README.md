# Local Pydantic AI pilot

English · [简体中文](README.zh-CN.md)

This repeatable example uses a real MiniMax model to decide a simulated **150-unit reimbursement**. The Agent's `read_skill` tool uses `docker exec cat` to read a **Linux kernel FUSE mount**. The Skill travels through hosted Git, validation, immutable versions, snapshots, a channel, and a Profile. The model runs in a Python process on the host.

## Start

Verified environment: macOS ARM64, Docker Desktop, Go 1.26.10, uv / Python 3.12. Docker must provide `/dev/fuse`. The example container gets `SYS_ADMIN` for FUSE and is intended only for a controlled local pilot. It depends on Docker Desktop's `host.docker.internal`; it is not a Linux server deployment script.

Set administrator configuration (`SKIVA_ADMIN_EMAIL`, `SKIVA_ADMIN_PASSWORD`) in the root `.env.local`. Supply model credentials through environment variables:

- `MINIMAX_M2_BASE_URL`: Anthropic-compatible endpoint.
- `MINIMAX_M2_AUTH_TOKEN`: model API key.
- `MINIMAX_M2_MODEL`: model name; defaults to `MiniMax-M2`.

```bash
./examples/pydantic-agent/run.sh
```

The script reuses the development PostgreSQL container, creates an isolated `skiva_agent_pilot` database, and uses `.data/agent-pilot/server` and `127.0.0.1:8083`. **Port 8083 must belong exclusively to this pilot backend.** Existing development services keep their original database. Each run creates randomly suffixed repositories and Profiles and modifies only the pilot database's canary channel.

First-time setup downloads dependencies and installs fuse3 in the container. Model requests use your account quota and send only simulated reimbursement rules and amounts.

## Scenarios

| Scenario | Content read by the Agent | Result for 150 units |
| --- | --- | --- |
| Initial publication | v1: limit 100 | Reject |
| Push and publish update | dynamic follows v2: limit 200 | Approve |
| Already pinned task | pinned retains v1 | Reject |
| Channel rollback | dynamic returns to v1 | Reject |
| Credential revocation | Both mounts deny file reads | No further model call |

Every release uses Git push, a fixed-SHA pipeline, and the release API. Channel writes include generation and idempotency keys. Pydantic validates model output; the script asserts policy version, limit, and decision. At completion it revokes the test Git PAT and client credentials and deletes temporary token files; mounts can no longer read.

Results are written to `.data/agent-pilot/results.json`. Local OpenTelemetry spans go to `.data/agent-pilot/traces.jsonl` without prompt bodies or hosted tracing. Dependencies are pinned in `requirements.txt`.

Rerun the script to repeat the demonstration. Stop FUSE with `docker stop skiva-agent-fuse`; the next run restores it. If the script starts the backend, its PID is recorded in `.data/agent-pilot/server.pid`; verify the process before stopping it. The database and release history remain for inspection.

This qualifies a single-host, single-Agent release/consumption workflow. It does not qualify enterprise SSO, long-running behavior, multi-tenant load, or production disaster recovery.
