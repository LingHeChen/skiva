# SDK and server runtime behavior

English · [简体中文](SDK_RUNTIME.zh-CN.md)

## Public interfaces

`client.bind()` follows the current authorized target (default refresh interval 0). `client.snapshot()` fixes the target on entry. `client.snapshot(id)` remembers it by an application binding ID; `client.snapshot(source=ref)` selects an actual snapshot reference. `task(id)` is an alias. Low-level `consistency="pinned"` remains compatible. A server Profile pin controls target selection; it does not change these client-side lifetimes.

The Python SDK 0.3.0 changes are available in the source repository, not yet published to PyPI. See the SDK README for usage and Pydantic AI `SnapshotView` dependencies.

## Persistence and recovery

Default bindings live in one client. Optional `SQLiteBindingStore(path, namespace=...)` stores references across local processes/restarts. Its compare-and-set publication prevents overwriting competing changes, but it is not an execution lock or distributed scheduler. Already opened views are immutable. Coordinate cleanup with other workers; SQLite is for local disk, not multi-host network filesystems. Bindings have no silent eviction or expiry and never authorize access by themselves.

## Authorization and outages

Missing, expired, disabled or revoked client credentials return 403 `CLIENT_FORBIDDEN`. Database failures return 503 `DISTRIBUTION_UNAVAILABLE` with `Retry-After: 1`; callers decide their retry boundary. SSE emits `unavailable` and closes on database failure, allowing reconnection; only actual credential denial emits `revoked`. No database details are exposed. An already delivered Skill or model context cannot be recalled.

Successful client authentication updates activity at most once per 30 seconds, including ordinary SDK requests. This is request activity, not proof an Agent task is healthy. It does not fabricate mount cache telemetry or a reported active snapshot.

## Historical grant retention

Apply migration `00004_snapshot_grant_retention.sql` before running the updated server. `SKIVA_SNAPSHOT_GRANT_TTL_SECONDS` is optional: unset or 0 preserves unlimited historical grants; a positive integer (maximum 315360000) gives newly created grants a fixed lifetime from first authorization. Reading a historical grant does not extend it. Existing unlimited grants are not retroactively shortened. Invalid configuration fails closed with 503.

An expired historical grant denies both manifest and object reads. Current channel targets and configured Profile pins remain authorized and can receive a new grant. Thus this is historical retention, not an administrative ban on a release. Rollback does not revoke previous grants. Remove profile permissions or revoke a client credential to stop further authorized reads. No grant garbage collection, snapshot deletion, or exported-file recall is implied. A stored SDK binding whose grant expires fails explicitly instead of falling back to latest.

## Performance without stale authorization

The SDK sends `If-None-Match` using a bounded metadata cache. Server authorization and permission-filtered manifests are checked before 304. ETags include snapshot ID, manifest digest and channel generation, so equal-content snapshots cannot be confused. Object authorization uses an SQL membership query instead of reconstructing/canonicalizing the entire manifest per file. It still checks current profile permissions. These reduce redundant work; no throughput improvement is claimed without a benchmark.

## Real integration checks

`TestPythonSDKDistribution` starts the actual Go router and uses PostgreSQL plus an installed Python SDK over HTTP. It exercises publication, update, rollback, fixed refs, permission removal, online activity, credential rotation and revocation. `TestDistributionDatabaseFailureIsTransient` checks unavailable database responses and SSE classification. `TestSnapshotGrantRetention` checks 304 authorization and grant expiry. CI checks out the SDK repository and runs this integration in addition to ordinary server tests. Local command:

```bash
SKIVA_SDK_PYTHON=/absolute/path/to/sdk/.venv/bin/python \
SKIVA_TEST_DATABASE_URL='postgres://skiva:skiva-dev@localhost:55432/skiva_test?sslmode=disable' \
GOTOOLCHAIN=go1.26.10 go test ./apps/server/internal/platform \
  -run 'TestPythonSDKDistribution|TestDistributionDatabaseFailure|TestSnapshotGrantRetention' -count=1
```

The SDK's simulated failure and real Pydantic AI FunctionModel tests remain complementary. No actual model provider or multi-host persistence guarantee is asserted.
