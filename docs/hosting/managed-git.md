# Hosted Git operations

English · [简体中文](managed-git.zh-CN.md)

## Create a repository and push

Choose Hosted in Git repositories → New. Enter namespace, slug, and display name; choose a single-Skill, monorepo, or empty template. Creation returns provisioning; the worker changes it to active when ready and retains errors for retry on failure.

A namespace belongs to one organization. namespace/slug is unique within it and stays reserved after soft deletion. Physical storage uses an immutable UUID. Display name and API namespace/slug can change without moving storage; old clone URLs return 404 rather than redirecting reads or writes. Update your remote. External repositories are not automatically converted to hosted ones.

Create a repository Git Token. Read-only tokens allow clone/fetch; enable repo:write for pushes. Maximum lifetime is 90 days. Plaintext is shown once: store it in your OS credential manager, never in repositories, URLs, or logs. Git tokens differ from mount credentials.

```bash
git clone https://skills.example.internal/git/engineering/sql-query.git
cd sql-query
# Supply the Git Token when Git requests a password
# Edit SKILL.md and referenced files
git add .
git commit -m 'Improve instructions'
git push origin main
```

The first push to an empty repository must include SKILL.md. Monorepos default to skills/<skill-name>/SKILL.md. Standard Git HTTPS is supported; SSH, LFS, pull requests, and issues are not.

## Push, build, and release are separate

A successful push means Git accepted the update. Activity records the actual ref and SHA; the worker hands a fixed commit to the existing pipeline. The default branch and refs/tags/v* build automatically by default. Other branches only record activity.

A successful pipeline creates candidate Skill versions. Follow [Releases](https://linghechen.github.io/skiva/docs/releases/) to create a complete snapshot, validate Canary, and promote Stable with release permission. Push and repository maintenance permissions do not grant release permission. Existing delivery clients and tokens remain compatible.

Inspect Push → Pipeline, Commits, Branches / Tags, Files, and Diff. Clicking a commit SHA shows fixed-version files. Diff display/download is capped at 256 KiB with explicit truncation; use local git diff for the full result. Filenames and differences are rendered as text, not executable HTML.

## Membership and protection

| Repository role | Read | Push unprotected branches | Protected main | Configure |
| --- | --- | --- | --- | --- |
| Viewer | Yes | No | No | No |
| Contributor | Yes | Yes | No | No |
| Maintainer / Org Admin | Yes | Yes | Per policy | Yes |

The organization-level repo_maintainer role does not grant all hosted repositories. Creators become repository Maintainers; only Org Admin can administer across repositories. Add same-organization members by user UUID. Database constraints reject cross-organization grants.

Tokens are scoped to one repository. Every request checks expiry, scope, current user state, and current membership. Permission changes and revocation affect new requests immediately; an existing transfer may run until its 120-second timeout. Rotate by creating a token, updating and verifying the client, then revoking the old token.

By default, main blocks force pushes and deletion. Only Maintainers can create protected tags; overwriting/deleting them is forbidden. pre-receive rejects the entire invalid batch and supports git push --atomic. Limits cover file count, object size, push size, repository size, and global capacity. Symlinks, submodules, dangerous binaries, and sensitive paths are forbidden. scripts/ can be stored but never executed by the server. CI independently checks content, references, and secrets.

Defaults: 64 MiB per push, 512 MiB per repository, 4 MiB per object, 10,000 files, 1,000 repositories per organization, 20 GiB global hosted storage. Git response buffering is capped at 32 MiB. Oversized clones return a gateway error; changes require capacity and load qualification, not an assumption of unlimited storage.

## Operations and rollback

Apply additive migration 00003 first. Existing rows become external; historical SHAs, versions, and snapshots remain unchanged. All three flags default to false:

```bash
SKIVA_MANAGED_GIT_ENABLED=true
SKIVA_MANAGED_GIT_WRITE_ENABLED=true
SKIVA_MANAGED_GIT_AUTO_CI_ENABLED=true
SKIVA_GIT_PUBLIC_URL=https://skills.example.internal
```

Enable creation/reads, then writes, then automatic CI. Production requires HTTPS. Set SKIVA_GIT_TRUST_PROXY=true only behind a trusted proxy that overwrites X-Forwarded-Proto and prevents direct backend access. Route /git/ directly to Go, not the Next.js BFF. See deployments/nginx-git.conf.

Local development can explicitly enable SKIVA_GIT_ALLOW_LOOPBACK_HTTP=true; production ignores it. The public URL is display configuration, not a request-supplied disk path.

Disabling WRITE_ENABLED rejects new pushes. Disabling AUTO_CI_ENABLED pauses event enqueueing. Disabling ENABLED hides the capability and stops Git ingress. Retain database columns, bare repositories, and events; re-enable after repair. Already-queued jobs continue on fixed SHAs and published distribution content remains readable. Do not run destructive down migrations.

Sources live at SKIVA_DATA_DIR/managed-git/<storage-id>.git; durable events at git-spool/. Back up both with PostgreSQL, objects/, and configuration/Secret references. Stop writes and workers before scripts/backup.sh. Restore into a new database/directory with scripts/restore.sh, which checks CAS and git fsck. Then verify fetch/push, rebuild, snapshots, and authorized client reads. File counts alone do not prove recovery. Soft-deleted repository storage remains by default without automatic GC.

post-receive atomically writes events; it does not run CI. The worker imports events into the database/queue and reconciles refs/reflogs. Do not delete reflogs or run destructive Git GC. Provisioning/failed metadata is also reconciled and retried.

## Troubleshooting

- 401: check Git PAT expiry/revocation and remove stale credential-manager passwords.
- 404: incorrect path, missing permission, or absent repository; the API intentionally does not distinguish them.
- 403: HTTPS required, writes disabled, or repository disabled.
- Rejected push: inspect main/tag protection, force push, deletion, file types, and quotas. Git displays the server reason.
- Push succeeds without a build: check automatic CI, trigger refs, activity errors, and queue backlog. Some refs only record activity.
- 502: process failure, 120-second timeout, or output limit. Fetch to verify remote state before retrying a push.
- 507: disk/global quota exhausted. Preserve published reads, expand capacity, then resume pushes.
- Provisioning failure: inspect volume permissions, disk, and the Git executable. The worker retries after repair; do not delete logical IDs to bypass errors.

Monitor git_http_requests_total, git_receive_bytes_total, git_push_rejected_total, git_ref_event_pending, git_ref_reconcile_lag_seconds, git_process_duration_seconds_*, and managed_repository_provision_failures_total under /metrics. Run make verify-artifacts during quiet periods for CAS and git fsck.

Actual enterprise IdP, target TLS proxy, Linux FUSE + Agent sandbox, capacity, and disk/power-loss drills remain deployment gates. Developer-machine and CI results do not certify production acceptance.
