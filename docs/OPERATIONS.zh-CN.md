# 部署与运维

[English](OPERATIONS.md) · 简体中文

## 安装

仅使用容器进行本地试用时，执行 `./scripts/setup-compose.sh`，再执行 `docker compose up --build -d --wait`。根目录 Compose 包含自动迁移和持久化卷，详见 [Compose 运维说明](../deployments/COMPOSE.zh-CN.md)。以下步骤适用于源码开发及其他部署模板。

1. 准备 Node 24、Git 和 Go 1.26.10 工具链，`make deps` 下载锁定的依赖。
2. 将 `.env.example` 复制为 `.env.local`，权限设为 0600，配置至少 14 字符的独立初始管理员密码、数据库地址和 Web 来源。`SKIVA_ORG_ID` 可指定单组织部署的组织 ID，升级时保持不变。
3. `make db` 启动本地 PostgreSQL，`make migrate-up` 执行 goose 迁移。其他数据库使用 `DATABASE_URL=...`；`scripts/dev.sh` 会先加载 `.env.local`。
4. `make dev` 启动 Go API/Worker 和 Next.js。`SKIVA_WEB_PORT` 必须与 `SKIVA_WEB_ORIGIN` 一致。
5. 打包部署使用 `docker compose -f deployments/compose.yaml --profile full up --build -d`。启动服务前先迁移，持久化 PostgreSQL 和内容卷，显式配置凭据。API 拒绝缺失或过短的初始密码。
6. 使用 `deployments/Caddyfile` 作为 TLS 代理模板。`/distribution/*` 直接转发 Go；`/metrics` 仅限监控网络。设置生产模式和准确的外部 HTTPS 来源。

开发、集成测试和生产使用独立数据库，不要把测试数据作为部署数据。

## OIDC 与 RBAC

设置 `SKIVA_ENV=production`、`SKIVA_OIDC_ISSUER`、`SKIVA_OIDC_CLIENT_ID`、`SKIVA_OIDC_CLIENT_SECRET`、`SKIVA_WEB_ORIGIN`。在 IdP 注册 `${SKIVA_WEB_ORIGIN}/api/v1/auth/oidc/callback`。MFA 和企业策略在 IdP 配置。Go 验证 issuer、签名、audience、有效期和 nonce；Authorization Code 使用 PKCE S256。生产环境拒绝本地密码登录。

提前创建使用已验证企业邮箱的成员并分配角色。首次登录将 issuer/subject 绑定到预建成员并清除本地密码哈希；未预建身份被拒绝。后续使用已绑定 subject。会话有效期为 8 小时，显式续期会轮换会话。停用成员后权限检查会拒绝访问。

## Git 凭据与策略

- HTTPS Secret 保存 HTTP Authorization 值（`Bearer ...` 或 `Basic ...`），通过受保护环境或 KMS 注入，在设置中保存环境变量引用。禁止 URL 内嵌密码。
- SSH Secret 保存私钥。Worker 使用短期 0600 文件和严格主机校验，结束后删除。配置 `SKIVA_SSH_KNOWN_HOSTS`，不使用管理员个人私钥。
- `SKIVA_GIT_ALLOWLIST` 显式允许私网主机。校验 DNS 后，将 HTTPS resolve 或 SSH HostName 固定到已校验地址。禁止重定向、file/ext 协议、来源 hooks、submodule 和来源 CI 脚本。
- `SKIVA_GIT_CA_BUNDLE` 添加企业 CA，不关闭 TLS 校验。双栈优先 IPv4，也支持仅 IPv6 的仓库。
- 安全设置控制单文件、总大小、文件数、脚本和 Markdown 外链。`.skills-platform.yaml` 可指定根目录、触发策略并收紧检查。未知字段（包括任意 shell 步骤）会失败。
- Git fetch 有超时和输出上限。生产还需要限制 Worker 卷容量、CPU 和内存：恶意 Git pack 可能在树校验前消耗资源。静态检查不证明 Skill 绝对安全。

```yaml
version: 1
skills:
  root: skills
pipeline:
  trigger:
    branches: [main]
validate:
  blockScripts: true
  blockExternalLinks: false
```

## 发布与回滚

选择成功版本、预览完整集合并审阅警告。创建快照，先 Canary 验证，再将同一个快照推进 Stable。推进会锁定渠道、检查 generation 和产物完整性，并原子提交渠道、历史、审计和 outbox。同一 Idempotency-Key 返回原操作结果；冲突时刷新 generation 并重新审阅。

回滚必须选择该渠道历史中的快照并填写原因，不重建或编辑对象。后端重新检查目标 Blob。删除或停用来源仓库不会删除历史快照。

带 Idempotency-Key 的创建请求串行处理并缓存事务结果。一次性凭据在重放记录中被遮蔽，明文只出现在首次响应；响应丢失时应轮换。数据库只存哈希。

## Worker 与故障

每个服务进程包含一个 Worker，轮询 PostgreSQL 租约队列。任务领取使用 `FOR UPDATE SKIP LOCKED`；仓库 advisory lock 串行保护裸仓库修改。构建父超时 4 分钟，租约 5 分钟。超时任务可重新领取；固定 commit/config/validator 幂等性防止重复版本。普通故障最多尝试三次并延迟重试。每分钟对账；Webhook 不会自动发布渠道。

同步失败时检查同步任务和流水线诊断，修复来源元数据、引用、凭据或网络后重试。不要修改挂载目录。数据库或审计提交失败会回滚修改；SSE 失败由客户端轮询补偿。

## 监控

`/healthz` 检查 PostgreSQL。`/metrics` 包含 HTTP/内容状态、队列积压、过期客户端、流水线时间与失败、渠道 generation、发布冲突和审计失败。`OTEL_EXPORTER_OTLP_ENDPOINT` 启用 OTLP；JSON 日志和审计包含 request ID。使用 `deployments/grafana-dashboard.json` 和 `prometheus-alerts.yaml`。指标不是 SLO 保证，应在代理/网络限制访问。

## 备份与恢复

停止 API/Worker 写入和演示 Git 来源写入，取得一致 DB/CAS/Git 恢复点。使用受保护的加密备份存储，并定义 RPO/RTO。

```bash
SKIVA_DATABASE_URL='postgres://...' SKIVA_DATA_DIR=/srv/skiva \
SKIVA_BACKUP_DIR=/secure/backups ./scripts/backup.sh
```

PostgreSQL 客户端主版本应与服务端一致。本地 Docker 可设 `SKIVA_PG_CONTAINER=skiva-postgres`，使用容器内匹配的 pg_dump/pg_restore；此模式假设本地 DB 用户为 skiva。

恢复到全新空数据库和不存在的数据目录：

```bash
SKIVA_RESTORE_DATABASE_URL='postgres://.../new_database' \
SKIVA_RESTORE_DATA_DIR=/srv/skiva-restored \
./scripts/restore.sh /secure/backups/TIMESTAMP
```

脚本校验备份、恢复数据库与文件，再验证每个版本引用的 Blob 摘要和大小。全部通过且渠道/Profile 状态符合预期后再切换服务。

## 保留策略与审计导出

`go run ./apps/server/cmd/maintenance verify` 检查引用。`gc` 保留所有版本/快照对象，仅删除超过 24 小时且无引用的 CAS 文件。离线或维护窗口执行，不直接删对象；当前优先保证回滚安全。

`audit-export` 向 stdout 输出 NDJSON，只追加审计应接入企业不可变日志存储。数据库触发器阻止普通修改/删除，但超级用户可绕过，强防篡改需要外部保留。

## 迁移与升级

00001 初始化数据和审计触发器，其 Down 删除项目表，具有破坏性。00002 增加跨组织组合外键与保护，Down 仅移除这些约束。任何 Down 前都应备份。全新 Up 与 00002 Down/Up 已在独立测试库验证。先升级服务端，再升级客户端，保持 `/distribution/v1` 向后兼容。

## Linux 挂载

安装 FUSE3，尽量使用非特权宿主机用户。仅受控测试容器授予 `/dev/fuse` 和挂载能力，不要默认给 Agent 容器 privileged 权限，优先预挂载宿主机卷。测试使用只读挂载、零元数据 TTL 和直接文件 IO，保证新 open 可见更新，旧句柄保留不可变 Blob。需要任务一致性时使用 pinned。

## 命名与 GitHub Pages

环境变量前缀为 `SKIVA_`，Go module 为 skiva，服务端为 `bin/skiva-server`。从更名前版本升级时迁移变量、服务名称和客户端配置/缓存路径，保留凭据和数据；数据库名称可通过连接串保持不变。客户端命令仍为 skills-mount。

[在线文档](https://linghechen.github.io/skiva/docs/zh/) 由 `.github/workflows/pages.yml` 发布，隔离构建只包含文档所需组件、内容与样式。完整管理应用仍需要 Next.js 与 Go。Pages 来源使用 GitHub Actions。

`npm run build:docs --prefix apps/web` 导出静态站，`npm run test:docs --prefix apps/web` 验证子路径资源、深链接、搜索、复制和移动导航。
