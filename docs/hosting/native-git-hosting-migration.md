# Enterprise Skills Platform · 原生 Git Hosting 增量开发迁移方案

> 状态：实施设计 / 待代码库核对 · 2026-10-21  
> 适用基线：已有可运行 Next.js + Go + PostgreSQL 管理平台、外部 Git 同步/CI/CD、Snapshot/Channel/Profile、Linux FUSE 客户端与文档站。  
> 原则：**只增加 Skills 专用轻量 Git 托管；不替换已经验收的交付链路，不演变成通用 GitLab。**

## 0. 文档使用方式与事实边界

本方案基于项目现状说明及此前开发设计文档撰写，**没有读取当前项目最新源码、数据库实际迁移或生产配置**。本文的 SQL/API 是目标契约草案，Codex 必须先核对现有实现，使用新增 migration 与兼容式修改，不得根据示例直接覆盖生产表、路径或 API。尤其要验证现有仓库模型、流水线入队接口、审计与发布事件的实际结构。

### 0.1 目标

1. 管理员在平台直接创建和管理 Skills 专用 Git 仓库。
2. 开发者通过标准 Git HTTPS `clone/fetch/push` 操作，无需先配置 GitLab/GitHub、外部 Webhook 或令牌。
3. 成功 Push 后按 **实际接受的 Ref 更新及 Commit** 自动入队现有 CI，沿用 Skill 版本、完整 Snapshot、Canary/Stable、回滚、Profile 和授权交付。
4. 保留外部 Git 仓库接入及现有数据，双方共享验证/制品/发布流程。
5. 不破坏既有 FUSE Dynamic/Pinned、缓存、离线与凭据撤销语义；不扩增 Agent 侧协议要求。

### 0.2 非目标

不做 Pull/Merge Request、Issues、Wiki、在线编辑、通用 DevOps Pipeline、SSH Git（首期）、Git LFS（首期）、Git 仓库间镜像双向同步、任意服务端 Hooks、通用仓库托管、通用代码搜索。仓库只能用于 Skills；初版可允许仓库内 `references/ scripts/ assets/`，但必须执行类型/大小/路径策略。**发布审批不是 Git 提交代码评审的替代品。**

### 0.3 必须保持不变的系统契约

| 现有模块 | 迁移要求 |
|---|---|
| Pipeline | 固定 Commit + validatorVersion + configDigest 的幂等键和重试语义保留 |
| Registry/SkillVersion | 版本仍不可变，来源可追溯到仓库/路径/Commit |
| Release/Channel | 原子发布、乐观并发保护、历史回滚完全不变 |
| Profile/Distribution | Manifest/Blob/授权令牌/缓存策略与已有客户端兼容 |
| External Git | Webhook + 手动 Sync + 定期巡检全部继续可用 |
| 审计/监控/备份 | 新增 Hosting 操作，不能减少当前能力 |

## 1. 目标架构与所有权

```text
Developer Git CLI
  └── HTTPS /git/{namespace}/{repo}.git
       └── Reverse proxy (TLS, body/time limits)
            └── Go Git Gateway
                 ├── Authenticate (user or PAT)
                 ├── Repository ACL + service authorization
                 ├── Resolve opaque repo ID → controlled bare path
                 └── git-http-backend / receive-pack
                         └── pre-receive / update: branch/tag rules, quota
                         └── post-receive: durable ref-event outbox
                                         └── Pipeline Dispatcher
                                                └── EXISTING Discover→Validate→Artifact→Release

Next.js Console ── Go Repository API ── PostgreSQL + Bare Repo Volume
External Git Adapter ──────────────────┘ existing pipeline
FUSE / Delivery Client ──────────────── EXISTING Distribution API
```

**双平面隔离：** Git Transport 是源码写入入口；Skills Distribution 是只读、已发布的产物入口。未经 CI 通过、未发布的 Git 内容绝不直接暴露为 Agent 的生产 Skill。Git 的物理目录不对浏览器静态服务公开。

**现有仓库适配层**：抽象 `RepositorySource`（`external`/`managed`）及读取指定 Commit 的接口。不要重写发现、校验与构建器；先复用现有 Git 镜像/读取逻辑，再让 Managed 指向本地 bare repository。不要让发行流水线依赖 HTTP 回环 Fetch。

## 2. 技术选择与可替换边界

- 前端：沿用 Next.js + shadcn/ui + Tailwind CSS。
- 后端：现有 Go 模块化单体；新增 `git/hosting`, `git/transport`, `git/policy`, `git/events` 与管理 API。
- 传输：首期 **Git Smart HTTP(S)**；Git 官方 `git-http-backend` 作为 CGI 后端，经可信 Go Gateway/受控 CGI Adapter 调用。实际进程边界必须隔离并限制执行身份、环境变量、超时与标准输出长度；不得拼接 Shell 命令。
- 存储：本地 POSIX 持久卷承载 `git init --bare` 创建的仓库；PostgreSQL 保存仓库元数据、ACL、凭据哈希和事件状态。
- 身份：浏览器登录继续复用现有 IdP；Git CLI 使用短期或可轮换的 HTTPS PAT（Basic over TLS，用户名是标识，不作为授权依据）；PAT 与 FUSE 工作负载令牌隔离。
- CI 触发：Git Hook 产生最小且可重放的 Ref Update 事件，Worker 按提交入队。**不要在 Hook 中运行 CI**。
- 备选：当 SSH、复杂分支保护、多节点托管或海量仓库成为刚需时，优先评估内置 Forgejo/Gitea 作为 Git 数据平面，但仍保持同一 Registry/Release/Distribution 接口。

## 3. Repository 生命周期与用户体验

### 3.1 创建

Console「新建仓库」→ 选择 `Managed` / `External` → 命名空间（Team）、仓库 slug、默认分支、单 Skill 或 Monorepo 模板 → 预览 Clone URL → Create。

Managed 创建事务流程：

1. DB 插入 `provisioning` 的逻辑仓库 ID，检查组织与命名空间配额、名称唯一性。
2. 在 staging 路径创建 **bare** Git Repository（默认分支明确指定）；按服务器策略创建 `HEAD`、受控 hooks；设置文件权限。
3. 原子重命名至基于不可变 ID 的物理路径；写 DB `active`。
4. 如选择模板，推荐在受控临时工作树提交初始 `SKILL.md` 并推动默认分支；失败时标记可重试，不留下假成功。
5. 记录 `repository.created` 审计及创建操作的 idempotencyKey。

**崩溃恢复**：`provisioning/failed` 的对账 Worker 检查 DB ↔ FS，完成创建或安全清理。避免 DB 成功而目录不存在、或目录存在而 DB 无记录。

### 3.2 Clone / Push 体验

```bash
git clone https://skills.example.internal/git/engineering/sql-query.git
cd sql-query
# 直接编辑本地 SKILL.md、references/ 等
git add . && git commit -m 'Improve SQL skill'
git push origin main
```

首次 Push 触发 CI，开发者在「仓库 → 活动/流水线」可查看当前 Commit 的处理状态。Git Push 成功**仅代表代码被接收**，不代表 CI 已通过或 Stable 已发布。

### 3.3 修改/停用/删除

- 仓库重命名只变更逻辑路由，物理路径保持；旧 Clone URL 是否重定向应明确策略（建议临时 301/308 仅对读取，不默默重定向写入）。
- 停用禁用写入、可配置禁止读取；不触及历史 Snapshot 的已发布制品。
- 删除为软删除+保留期；物理 GC 必须检查构建任务、引用版本、渠道和审计保持要求。禁止默认级联删 Git Repo 及 CAS。
- 外部仓库不得自动转换为 Managed；如提供迁移功能，必须是显式复制并记录源映射与核验结果。

## 4. Git HTTP 网关与安全控制

### 4.1 可信边界

`/git/*` 与 `/api/*`、`/distribution/*` 路由分离：不允许 Go 管理 BFF 替 Git 传输解析 Packfile。Gateway 从路由确定 repository ID，并使用**数据库映射的规范化受控路径**；不允许请求传入文件系统绝对路径、`GIT_PROJECT_ROOT` 或任意环境变量。

`git-http-backend` 接口需严格处理 CGI `PATH_INFO`, `QUERY_STRING`, `REQUEST_METHOD`, `CONTENT_TYPE`, `CONTENT_LENGTH`, `REMOTE_USER` 等必要字段。避免将 `Authorization`、Token 原文泄漏到 CGI 环境、日志、进程列表或远端 URL；对 `receive-pack` 和 `upload-pack` 分别授权。不要把 `GIT_HTTP_EXPORT_ALL` 当作授权机制。

**重要：** `git-http-backend` 默认服务开关与仓库配置需按服务单独设置，并经集成测试验证 `git clone`, `fetch`, `push`；不得用只读 HTTP 文件服务替代 Smart HTTP。

### 4.2 Git 认证/授权矩阵

| 角色 | Clone/Fetch | Push 非保护分支 | Push `main` | 修改配置 | Publish Stable |
|---|---|---|---|---|---|
| Org Admin | 按仓库权限 | 可 | 依策略 | 可 | 需 Release 权限 |
| Repo Maintainer | 可 | 可 | 依保护策略 | 可 | 默认不可 |
| Contributor | 可 | 可 | 默认拒绝 | 不可 | 不可 |
| Viewer/Auditor | 只读 | 不可 | 不可 | 不可 | 不可 |
| Agent Delivery Credential | **不可访问 Git API** | 不可 | 不可 | 不可 | 不可 |

PAT：仅存不可逆哈希（采用可安全校验的高熵 token 存储方式）、scope（`repo:read`, `repo:write`）、repository/org 约束、过期、revokedAt、lastUsedAt；仅创建时展示原文，支持轮换、撤销、速率限制。错误认证不泄露仓库存在性。强制 HTTPS、默认无匿名访问。

### 4.3 Push 校验

- `pre-receive`: 禁止非授权 Ref 更新、强制 protected branch/tag 规则、限制 force push/删除、限制 Pack/对象大小、仓库配额和禁用危险文件类型；失败拒绝整个 Push（区分多 Ref 场景）。
- `update`: 对单个 Ref 执行细粒度约束；多 Ref 接收是否原子应依赖 `receive.advertiseAtomic` 与客户端协商，并有测试。
- `post-receive`: 按已接受 Ref 输出事件，避免阻塞/运行大量工作。**Hook 不可靠作为唯一持久化途径**：事件必须在持久 outbox / spool 内原子落盘或通过可靠接收方确认；另以定期 Ref reconciliation 兜底。Hook 失败不能假装取消已成功的 Git Push。
- 对 Hook 代码严格受控，仓库作者不能上传自定义服务端 Hook；安全检查不能执行仓库中的任意 `scripts/`。
- 服务进程禁高权限运行，Git 运行用户与 Web/Worker 权限最小化；物理目录隔离、不执行仓库内容、资源限额、禁危险 `git -c` 或外部进程环境注入。

**Git 原生语义注意**：pre-receive 在接收对象 quarantine 阶段运行，拒绝可以阻断 Ref 更新；post-receive 位于接受之后，不能用于撤销 Push。<https://git-scm.com/docs/git-receive-pack.html>

## 5. 从 Push 到现有 CI 的适配

### 5.1 事件模型（建议）

```json
{
  "source": "managed_git",
  "repositoryId": "uuid",
  "ref": "refs/heads/main",
  "oldOid": "<git-object-id>",
  "newOid": "<git-object-id>",
  "deliveryId": "event-uuid",
  "observedAt": "2026-10-21T00:00:00Z"
}
```

- 只对仓库配置选中的分支/Tag 触发自动 Build；其他 Push 记录活动，不自动发布。
- 对被删除的 Ref（全 0 OID）不创建 Skill Version；记录审计。
- Worker 读取 `newOid` 对应 Commit，不能再解析移动中的 `main` 头，以免混淆多次 Push。
- 复用现有 `pipeline_runs(repository_id,commit_sha,config_digest,validator_version)` 幂等键；同一 Commit 的多次通知不重复构建，但必要时保留触发关系。
- CI 校验、Artifact 生成、Release Preview、Canary/Stable Promotion、审计及终端 SSE 全部沿用旧代码。
- 增加定时 Ref reconciler：以仓库最新 refs 与数据库的已观察 OID 比较，回补遗漏事件；避免仅依赖 `post-receive`。

### 5.2 不变量

1. **Git Push 成功 ≠ Pipeline 成功 ≠ Channel 发布成功**。
2. Pipeline 失败不得污染已发布 Release；Release Snapshot 不得绑定浮动 Ref。
3. 同一 Snapshot 的 Manifest 与 Blob 一致且不可变。
4. 发布授权仍以 Release Manager 决定，不因拥有仓库写权限而自动获得稳定渠道发布权。
5. 原有终端既不必更换 Token，也不必改变挂载路径或 API。

## 6. 数据库增量迁移设计

现有 `repositories.remote_url NOT NULL` 是外部 Git 的假设；新增 Managed 类型时须先解除该约束或引入统一的 `source_config`，**不能用假 URL 填充**。

### 6.1 Expand 阶段（建议 SQL，须据真实 schema 修订）

```sql
ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS namespace_slug text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS provision_state text,
  ADD COLUMN IF NOT EXISTS storage_id uuid;

UPDATE repositories
  SET source_type = 'external'
  WHERE source_type IS NULL;

ALTER TABLE repositories
  ALTER COLUMN source_type SET DEFAULT 'external';

-- 单独在审计现有读取路径后再修改：
-- ALTER TABLE repositories ALTER COLUMN remote_url DROP NOT NULL;

-- 下一次迁移添加 CHECK(source_type IN ('external','managed'))
-- 以及 managed/external 的互斥必填约束；避免一次性上线强 NOT NULL。

CREATE TABLE IF NOT EXISTS repository_ref_events (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES repositories(id),
  refname text NOT NULL,
  old_oid text NOT NULL,
  new_oid text NOT NULL,
  source text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  error_text text,
  UNIQUE(repository_id, refname, old_oid, new_oid)
);

CREATE TABLE IF NOT EXISTS git_access_tokens (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS repository_members (
  repository_id uuid NOT NULL REFERENCES repositories(id),
  user_id uuid NOT NULL REFERENCES users(id),
  access_role text NOT NULL CHECK(access_role IN ('viewer','contributor','maintainer')),
  PRIMARY KEY(repository_id,user_id)
);
```

注意：Token scope 若需要更精细的仓库级授权，可增加 Token→仓库授权关联表或在 JWT/DB 权限规则里绑定；不要把 scopes 单独当成全部访问判定。

### 6.2 Contract 阶段

所有现有读取路径已适配 `source_type` 后，才添加严格 `CHECK`、`NOT NULL`、命名空间唯一索引及必要的跨组织复合外键。必要时使用 `CREATE INDEX CONCURRENTLY`，避免阻塞现有表。新的 `source_type` 必须默认 external 以保障旧客户端/脚本兼容。

### 6.3 数据一致性

- 物理 storage ID 使用 UUID，且仓库对象与 DB ID 永不复用。
- 名称唯一范围为 `(org_id, namespace_slug, slug)`；删除仓库保留命名冲突的策略需明确定义。
- DB 事务无法原子包裹 Git 文件操作；使用状态机 + 对账/修复 Worker，写清重试与幂等。
- 外部 repo 的历史记录不回填/修改 Commit SHA，原有 SkillVersion 与 Snapshot 全部保留。

## 7. 新增 API 合约

管理 API 仍以 `/api/v1` 命名、统一响应包装和 OpenAPI 为准；建议最小新增/扩展如下：

| Method | Path | 说明 |
|---|---|---|
| `POST` | `/repositories` | 既有接口新增 `sourceType: managed/external`；保持 external 兼容 |
| `GET` | `/repositories/{id}/git` | Clone URL、默认分支、Git 访问说明 |
| `GET` | `/repositories/{id}/refs` | Branch/Tag 列表；严格分页/排序 |
| `GET` | `/repositories/{id}/commits` | Commit 列表；可指定固定 Ref |
| `GET` | `/repositories/{id}/tree` | 指定 Commit 的只读树 |
| `GET` | `/repositories/{id}/diff` | Commit 范围 Diff；大小/行数限制 |
| `PATCH` | `/repositories/{id}/policies` | 保护分支、容量和触发 Ref |
| `POST` | `/git-tokens` | 创建仓库 Token，原文仅返回一次 |
| `GET` | `/git-tokens` | 仅返回脱敏记录 |
| `POST` | `/git-tokens/{id}/revoke` | 撤销 Git Token |
| `GET` | `/repositories/{id}/events` | Push → Pipeline 映射与错误状态 |

Git 协议入口：`GET/POST /git/{namespace}/{slug}.git/*`（受控路由映射到真实 ID，明确允许的 Smart HTTP 路径和方法）。请求/响应必须由真实 Git CLI 兼容性测试覆盖，不能仅通过 Postman 测试。

管理 API `Repository` 响应建议新增 `sourceType, cloneUrl?, defaultRef, provisionState, lastPushAt, hostingPolicy`，旧字段保持序列化兼容。禁止把 PAT 嵌入可复制的 Clone URL 示例。

## 8. UI/UX 改动范围

保留所有既有页面。新增如下能力，不改版为通用代码托管 UI：

1. **新建仓库向导**：选择平台托管（默认）/外部关联；仓库命名、Skill 模板、仓库路径；权限/分支默认策略说明。
2. **仓库详情**：Clone URL 一键复制；`git clone`, `git push` 示例；最近 Push→Pipeline 状态；Commit、Branches、Tags、Files、Diff 只读页签。
3. **访问凭据**：Git Token 创建、过期、权限范围、轮换、撤销；创建成功时唯一一次显示。
4. **仓库策略**：受保护分支、触发规则、容量/文件限制、禁止 Force Push 默认开关。
5. **导入外部仓库（后续增量）**：只读镜像迁移预览，不作为首批上线硬依赖。
6. **文档站**：新增托管仓库创建、Git CLI 操作、Token 使用、CI 与 Git Push 区别、故障排查、备份恢复及权限策略指南；保留原 8 篇且更新导航搜索索引。

商业化后台完整体验要求：加载/空/失败/权限不足/重试状态、危险操作二次确认、移动端可用、键盘访问、深浅主题、代码复制反馈、长 Diff 截断/下载与安全展示，不渲染未清洗的仓库 HTML。

## 9. 数据安全、备份与灾备

- 源仓库 bare volume 是**新的关键持久状态**，加入现有备份体系；只备 PostgreSQL 不够。
- 至少定期备份 DB + Bare Repositories + 已发布 Artifact/CAS + 配置/密钥引用；备份必须能够与一致性检查和恢复点关联。
- 恢复演练：在隔离环境恢复 DB 和所有仓库，验证 refs、`git fsck`、CI 构建、Snapshot Manifest/Blob、Git fetch/push、FUSE 旧终端分发；不要只验证文件数量。
- Git 对象完整性巡检：`git fsck`、引用是否可达、对象数量和磁盘占用；用限速后台任务运行，不在每个请求同步执行。
- 磁盘容量保护：单仓库、单 Push、全局配额；磁盘接近阈值时优先拒绝新 Push，不影响既有发布读取。
- 安全事件：PAT 泄漏、拒绝访问、受保护分支拒绝、超限 Push、仓库删除、Hook 失败均入安全审计。
- 不得直接允许外部仓库配置任意本机路径或内网地址；原有外部 Git 的 SSRF / egress allowlist 防护继续适用。

## 10. 实施计划（带迁移门禁）

| 阶段 | 工作 | 放行条件 | 可回滚手段 |
|---|---|---|---|
| M0 基线冻结 | 备份 DB/仓库/制品，记录当前 CI 29 API 契约、6 浏览器场景、FUSE 及生产构建；补现有 repository schema/业务入口清单 | 现状可重复验收 | 不改动生产 |
| M1 数据 Expand | `source_type`、托管状态、Token、事件表、ACL；API 响应兼容 | 旧 external 全部自动标注、旧流程测试无回归 | 保持 feature off；回滚代码，不删列 |
| M2 Bare Repo Provisioner | 创建/命名/停用、幂等与磁盘一致性修复 | 并发创建、崩溃恢复、配额测试通过 | 停止新建，旧仓库不删 |
| M3 Git Smart HTTP | Clone/Fetch/Push + PAT + ACL + refs policy | 原生 Git CLI E2E 与权限负测通过 | 禁用 Git Gateway 写入 |
| M4 CI 事件集成 | 持久 Hook/Ref 事件、幂等流水线入队、定期 Reconciliation | Push 到固定 SHA 构建，无重复/丢事件 | 手动补队列与停止 Hook 自动触发 |
| M5 Console/Docs | 新建托管 UI、仓库详情、Token、文档站更新 | 浏览器 E2E、移动体验、易用性验收 | 隐藏 Managed 创建开关 |
| M6 端到端/预生产 | 完整发布、回滚、FUSE、备份恢复、负载/故障演练 | 新链路全部通过，无旧链路回归 | 切回 External-only，保留数据以修复 |
| M7 灰度上线 | 内部少量项目/仓库先用 Managed，观察事件积压、Push 失败、磁盘、授权 | 观察指标达阈值并签署验收 | Feature flag 关闭新建及 Push，原有 Distribution 不回滚 |

明确 feature flags：`managed_git_enabled`, `managed_git_write_enabled`, `managed_git_auto_ci_enabled`。部署前先关，允许逐级启用。

## 11. 测试矩阵与定量建议

### 11.1 Git 协议

- HTTPS Git clone/fetch/push、初次 Push、Tag Push、多个 Ref Push、大/空 Commit、快速连续 Push、Push 和定时 Reconcile 并发。
- 未认证 401、无权限 403/404 策略、过期/撤销 Token、repo 读写 scope 分离。
- Force Push、删除 main、受保护标签、错误 namespace、路径穿越、编码后的 `/../`、非法 Ref、Git 进程异常退出与超时。
- 超限 pack/对象/文件、磁盘不足、Hook 异常、网络断开中途 Push、Git 客户端重试。
- 正确 `git push --atomic` 行为由实测确认；不支持则文档如实说明。

### 11.2 CI/CD 与既有发布

- Push A 和 Push B 在短时间内先后到来，两个 Commit 分别可追踪；只构建被固定引用的 SHA。
- 重复 Push 事件 + 定时巡检不会创建重复 SkillVersion；不同 Config/ValidatorVersion 正常区分。
- CI 失败 Stable 不变；Canary 与 Stable 并发发布仍使用 generation CAS；回滚保留审计和内容一致性。
- External Git Webhook/Sync/轮询不受影响；FUSE Dynamic/Pinned、离线、Token 撤销仍按此前行为。
- Agent 完整生产沙箱联调和原生 Linux FUSE 再次执行；以前的 amd64 仿真测试不能替代生产架构实测。

### 11.3 生产前必做

- Docker 镜像能够在目标 CI 环境稳定构建并固定依赖；不可复用过去未验证的镜像构建结果。
- 真实企业 IdP、TLS 证书、反向代理、目标内网和最低权限配置验证。
- 冷启动与持续运行负载：按预期最大仓库数量、仓库大小、同时 Push/Clone、CI 队列峰值测试；指标用企业实测 SLO 决定，不能捏造性能承诺。
- 故障演练：DB 短故障、仓库卷只读/损坏、磁盘满、Hook Outbox 积压、Worker 重启、负载均衡器超时、恢复后对账。

### 11.4 验收用例（最低集）

| ID | 场景 | 合格判断 |
|---|---|---|
| GIT-01 | 新建 Managed | URL 可见、物理 ID 路径存在、DB 状态 active |
| GIT-02 | Git CLI 克隆/推送 | 标准 Git 客户端成功，无特殊插件 |
| GIT-03 | Push 触发流水线 | Pipeline 绑定 `newOid` 而非移动的 `main` |
| GIT-04 | Push 失败校验 | 不创建已发布 SkillVersion、不修改 Stable |
| GIT-05 | Stable 发布与回滚 | 原有 generation/audit/完整 Snapshot 规则通过 |
| GIT-06 | Protected main | Contributor 被拒绝写；Maintainer 遵循策略 |
| GIT-07 | 凭据撤销 | 新请求立即拒绝，旧连接按服务限制完成或断开策略明示 |
| GIT-08 | Hook 事件丢失 | 周期 Reconcile 可自动补齐 |
| GIT-09 | 断电/中途崩溃 | Provisioning 对账恢复，无幽灵仓库 |
| GIT-10 | 备份恢复 | 源仓库/DB/CAS/FUSE 全路径完成恢复验证 |
| REG-01 | External 仓库 | 同步、Webhook、CI、发布完全无回归 |
| REG-02 | 旧客户端 | Distribution/FUSE 接口和行为兼容 |
| REG-03 | 管理 UI | 建仓、凭据、历史/Diff、状态和错误提示完整 |
| REG-04 | 生产沙箱 | 真实 Agent 发现、挂载、任务内版本表现验证 |

## 12. 部署方案与运维清单

建议新增持久卷 `/var/lib/skills-platform/git`，运行 Git Gateway 采用独立非特权 UID；只对受控服务提供必要写权限。Next.js 管理端和 Git Gateway 可共用域名不同路径，但必须保证 Git 长连接/大 body 的代理参数专门配置。Git Hook 的系统环境完全由服务管理，**不允许仓库写入者替换 Hook 文件**。

新增监控：`git_http_requests_total{service,status}`、`git_receive_bytes_total`、`git_push_rejected_total{reason}`、`git_repo_disk_bytes`、`git_ref_event_pending`、`git_ref_reconcile_lag_seconds`、`git_process_duration_seconds`、`managed_repository_provision_failures_total`。不要把 Token、含口令的远端 URL 或敏感仓库内容写到日志标签。

需要同步更新：Dockerfile（安装固定 Git 版本及必要执行器）、Compose 持久卷与健康检查、CI 构建缓存、备份工具、完整性巡检、恢复 Runbook、API OpenAPI/TS SDK、文档站导航与部署指南。

## 13. 文档一致性与代码验收门禁

实施前由 Codex 输出 `CurrentStateAudit.md`（现有代码目录与此文档的逐项差异）及修改清单；实施后必须检查：

- `repositories.source_type` 数据/后端/API/UI 名称统一，旧 external 行为兼容。
- Git Token 与 Agent Delivery 凭据完全分离，组织/仓库 ACL 在所有读取/推送入口生效。
- Git Hook 只做快速校验/入队；Git Commit / SkillVersion / ReleaseSnapshot / Channel 概念不混用。
- 新增的事件处理、错误码、OpenAPI schema 与前端错误状态保持一致。
- 数据迁移可在现有数据上前向执行；不通过删除旧表、强制重建数据库“解决”兼容问题。
- 文档中不能写“macOS/Windows 支持”或“已生产验证”；这些能力仍属未完成边界。
- 版本发布走旧 Pipeline/Registry/Release 链路，不复制第二套业务逻辑。
- 之前通过的单元、集成、竞态、API 契约、浏览器/FUSE/恢复测试继续通过，并补新增场景。

## 14. Codex 执行指令（可直接引用）

> 先审计现有仓库与数据库迁移，记录现状；严禁按此设计推倒重写。以 feature flag 方式增量加入 Managed Git 仓库，并保留 External 仓库的全部能力。首先补持久化模型与 Provider 适配，再实现 bare repository provisioner、受控 Smart HTTP Gateway、PAT/ACL、Push 事件对账与现有 CI 入队，最后补仓库 UI、文档及部署工具。每阶段提供对应自动化测试、兼容性证明、迁移/回滚说明。不要默认执行仓库中任意命令，不实现非目标功能，不修改发布/分发协议，最终运行所有旧回归以及 Git CLI E2E、备份恢复与真实 Agent 沙箱测试。

## 15. 进一步需要产品决策（给 Codex 的默认值）

| 决策 | 建议默认 |
|---|---|
| Git 访问方式 | HTTPS + PAT；SSH 后续 |
| 仓库模板 | 单 Skill 默认，Monorepo 可选 |
| 自动构建 | 主分支和符合规则的 Tags；Push 不自动发 Stable |
| 分支保护 | main 默认禁止 Force Push 和删除；发布权独立 |
| 仓库公开性 | 企业内私有；禁止匿名 Git HTTP |
| 托管仓库路径 | 不可变 ID 物理存储 + 逻辑 namespace/slug URL |
| 现有 External 仓库 | 全量保留；可并行使用 |
| 旧生产链路 | Release/Channels/Profile/Distribution 完全复用 |
| 网络挂载 | 维持 Linux FUSE，暂不追加新客户端 |
| 通用 Git Hosting 功能 | 不引入 PR/Issues/SSH/LFS 作为首版门槛 |

---

### 参考依据

- Git Smart HTTP 与服务配置：<https://git-scm.com/docs/git-http-backend>
- Git receive-pack 与 quarantine/Hook 顺序：<https://git-scm.com/docs/git-receive-pack.html>
- Git Hooks：<https://git-scm.com/docs/githooks>

本文件是 **目标迁移规范**，不是“已实现/已通过生产验收”的声明。
