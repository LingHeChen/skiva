# 10 · 工程实施、部署、可观测性

## 1. Monorepo
```
skiva/
  apps/web/                       # Next.js App Router
  apps/server/cmd/server/         # Go 二进制
  apps/server/internal/{auth,repository,pipeline,registry,release,distribution,profile,audit}/
  apps/mount/cmd/skills-mount/     # Go 挂载 CLI
  apps/mount/internal/{mountfs,cache,updater,auth,platform}/
  packages/openapi/               # openapi.yaml, generated clients
  packages/schemas/               # JSON Schema, golden manifest fixtures
  migrations/                     # goose SQL
  tests/e2e/                       # 端到端场景
  deployments/compose.yaml
  deployments/docker/
  docs/
```
建议 Go workspace 管理 Server/Mount 模块；共享协议以 OpenAPI/Go package 方式版本化，避免从 Node 直接依赖 Go 代码。

## 2. 开发环境
`make dev` 启动 Postgres + Go + Next.js；测试 Git 仓库与演示数据需 seed；Makefile 提供 `lint`, `test`, `test-e2e`, `migrate-up`, `migrate-down`, `openapi-generate`, `build-server`, `build-mount`。敏感环境变量放 `.env.local` 且不提交。

## 3. 阶段划分（全产品范围保持固定）
- P0 基础设施：Repo scaffold、Go/TS lint/test、Postgres migration、Auth/RBAC、OpenAPI、完整导航与设计 tokens。
- P1 Git CI/Registry：仓库连接、Webhook+Reconcile、Job、Pipeline、Skill Versions、Markdown/Diff 只读预览、错误态。
- P2 CD：Release Snapshot、Channels、Profile、权限与审计、Manifest/Blob API、回滚及管理 UI。
- P3 Client：Linux 只读 FUSE、HTTP 缓存、SSE+Poll、dynamic/pinned、凭据轮换与离线策略、挂载管理页面。
- P4 完整性与企业化：成员设置、全部页面状态、SSO/OIDC、可观测性、备份恢复、安全和性能、各 Agent 适配验收；macOS/Windows 平台实现属于后续独立交付里程碑。

每个阶段验收必须包括对应文档 API/测试/UI，而不是“后端能跑就结束”。优先单人可交付的顺序：迁移/API contract → 后端领域逻辑 → Worker → 前端页面 → 协议 → 挂载客户端 → 测试硬化。

## 4. 环境与配置
环境：local / staging / production。环境变量按 `SKIVA_` 前缀配置域名、数据库、Git allowlist、对象目录、OIDC、审计日志、缓存参数。运行环境不得使用管理员 Git SSH key；Secrets 通过 Kubernetes Secrets/HashiCorp Vault/企业 KMS 或受保护环境注入。

## 5. 监控
OpenTelemetry trace 串起 requestId→Webhook→Job→Release；Prometheus 指标：pipeline_duration_seconds、pipeline_failures_total、content_requests_total{status}、manifest_generation、client_staleness_seconds、mount_cache_hit_ratio、channel_promote_conflicts_total、audit_write_failures_total。Grafana Dashboard + 告警：Blob 数据缺失、发布失败、Worker 积压、客户端大面积落后、Git 同步持续报错、凭据快过期。

## 6. 运维 SOP
- 首次安装：迁移、创建组织管理员、配置 OIDC、配置 Git 允许列表、持久化 Volume、TLS、健康探针与备份。
- 发布异常：检查 Pipeline diag → Artifact 完整性 → Release 审核 → Channel generation；不得直接改线上挂载目录。
- 回滚：管理员以历史快照创建新的 Channel history 记录，验证目标 Blob 完整且客户端刷新成功。
- 升级：数据库迁移向后兼容优先，内容 API 做版本化；先升级 server 后 client。
- 备份：同时保护 PostgreSQL 和 Git/CAS；定期做真实恢复验证，定义企业自己的 RPO/RTO。

## 7. 防止项目只做成 MVP 的实施约束
项目文档定义完整首发能力；迭代只安排开发顺序，不删除基础路由、设置、个人页、鉴权、空态、错误态、审计、回滚、离线失败策略。若功能延期，必须在 Roadmap 明确标为未交付、给出替代操作与可测边界，不能在 UI 中做假按钮。
