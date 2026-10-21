# 03 · PostgreSQL 数据模型与初始 DDL

主键使用 UUIDv7（应用生成，数据库用 uuid 类型）；时间 UTC timestamptz；审计追加写。以下是首期核心逻辑 DDL 草案，迁移代码需添加完整 index、触发器和种子角色。

```sql
CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), subject text NOT NULL, email text, display_name text, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,subject));
CREATE TABLE role_bindings (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL CHECK(role IN ('org_admin','repo_maintainer','release_manager','agent_manager','auditor')), UNIQUE(org_id,user_id,role));
CREATE TABLE repository_credentials (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, secret_ref text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE repositories (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, remote_url text NOT NULL, credential_id uuid REFERENCES repository_credentials(id), default_ref text NOT NULL DEFAULT 'refs/heads/main', skill_root text NOT NULL DEFAULT 'skills', status text NOT NULL DEFAULT 'active', last_commit_sha text, last_sync_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,name));
CREATE TABLE webhook_deliveries (id uuid PRIMARY KEY, repository_id uuid NOT NULL REFERENCES repositories(id), provider text NOT NULL, delivery_id text NOT NULL, payload_sha256 text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), UNIQUE(repository_id,provider,delivery_id));
CREATE TABLE pipeline_runs (id uuid PRIMARY KEY, repository_id uuid NOT NULL REFERENCES repositories(id), commit_sha text NOT NULL, config_digest text NOT NULL, validator_version text NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','failed','succeeded','cancelled')), attempt integer NOT NULL DEFAULT 0, error_summary text, started_at timestamptz, ended_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(repository_id,commit_sha,config_digest,validator_version));
CREATE TABLE pipeline_steps (id uuid PRIMARY KEY, pipeline_id uuid NOT NULL REFERENCES pipeline_runs(id), step_key text NOT NULL, status text NOT NULL, diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb, started_at timestamptz, ended_at timestamptz, UNIQUE(pipeline_id,step_key));
CREATE TABLE skills (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), repository_id uuid NOT NULL REFERENCES repositories(id), relative_path text NOT NULL, canonical_name text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(repository_id,relative_path));
CREATE TABLE skill_versions (id uuid PRIMARY KEY, skill_id uuid NOT NULL REFERENCES skills(id), pipeline_id uuid NOT NULL REFERENCES pipeline_runs(id), commit_sha text NOT NULL, content_digest text NOT NULL, manifest_digest text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(skill_id,content_digest));
CREATE TABLE artifacts (digest text PRIMARY KEY, byte_size bigint NOT NULL CHECK(byte_size>=0), storage_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE release_snapshots (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), manifest_digest text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,manifest_digest));
CREATE TABLE release_items (snapshot_id uuid NOT NULL REFERENCES release_snapshots(id), skill_name text NOT NULL, skill_version_id uuid NOT NULL REFERENCES skill_versions(id), PRIMARY KEY(snapshot_id,skill_name));
CREATE TABLE channels (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, active_snapshot_id uuid REFERENCES release_snapshots(id), generation bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,name));
CREATE TABLE agent_profiles (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, channel_id uuid NOT NULL REFERENCES channels(id), consistency_mode text NOT NULL CHECK(consistency_mode IN ('dynamic','pinned')), enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,name));
CREATE TABLE profile_skills (profile_id uuid NOT NULL REFERENCES agent_profiles(id), skill_name text NOT NULL, enabled boolean NOT NULL DEFAULT true, PRIMARY KEY(profile_id,skill_name));
CREATE TABLE mount_clients (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), profile_id uuid NOT NULL REFERENCES agent_profiles(id), name text NOT NULL, credential_hash text NOT NULL, revoked_at timestamptz, last_seen_at timestamptz, last_snapshot_id uuid REFERENCES release_snapshots(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE channel_history (id uuid PRIMARY KEY, channel_id uuid NOT NULL REFERENCES channels(id), before_snapshot_id uuid REFERENCES release_snapshots(id), after_snapshot_id uuid NOT NULL REFERENCES release_snapshots(id), generation bigint NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_logs (id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), actor_type text NOT NULL, actor_id text NOT NULL, action text NOT NULL, target_type text NOT NULL, target_id text NOT NULL, request_id text, before_state jsonb, after_state jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE job_queue (id uuid PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0, run_after timestamptz NOT NULL DEFAULT now(), leased_until timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now());
```

## 数据约束与迁移细化
- 应用层及 SQL 策略强制组织边界；跨组织 FK 存在潜在引用风险，应在实际迁移中使用复合 `org_id,id` 外键或事务校验，不依赖前端过滤。
- `skills.canonical_name` 允许跨来源同名，但 `release_items(snapshot_id, skill_name)` 禁止同一发布视图冲突。
- `skill_versions` 存不可变版本；`manifest_digest` 是规范化序列化后的 SHA-256，CAS 按 digest 内容寻址。Snapshot 的规范化顺序必须固定，避免相同内容生成不同哈希。
- `channels` 的 `generation` 递增更新，使用 `UPDATE ... WHERE generation=$expected` 实现 CAS；同时插入 `channel_history` 与 `audit_logs`，事务成功后再发送通知。
- `mount_clients.credential_hash` 只存单向校验值，原始 Token 一次性展示；若采用 OIDC 工作负载身份则换成 `subject`，不得存可逆明文。
- `job_queue` 以 lease 避免僵尸 Worker；超时重试必须幂等。
- 大规模日志应保留期限与清理策略；审计单独长期保留并考虑追加日志出口。

## 索引建议
`pipeline_runs(repository_id,created_at DESC)`；`skill_versions(skill_id,created_at DESC)`；`audit_logs(org_id,created_at DESC)`；`mount_clients(profile_id,revoked_at)`；`job_queue(status,run_after)`；`channels(org_id,name)`；`webhook_deliveries(repository_id,received_at)`。

## 删除语义
Repo 默认停用/软删除，不能级联删除已被 Snapshot 引用的版本。GC 只回收“未被任何保留快照、构建保留策略、在线租约引用”的 CAS 对象。任何渠道回滚目标必须存在完整 Blob。
