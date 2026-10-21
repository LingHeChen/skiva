# Skiva

Git-backed Skills Delivery Platform。

企业内部 Skills 交付平台。外部 Git 是唯一内容来源；Go 后端完成静态校验、不可变快照、渠道发布与权限校验；Next.js 管理端操作真实 API；Linux 客户端通过只读 FUSE 向 Agent 暴露文件。

## 本地运行

要求 Docker、Node 24、Git、Python 3。Makefile 使用 Go **1.26.10** 工具链（自动下载，不修改全局 Go 安装）。

```bash
cp .env.example .env.local
# 将 SKIVA_ADMIN_PASSWORD 改为至少 14 字符的独立密码
make deps
make dev
```

默认 UI `http://localhost:3000`，API `http://localhost:8080`，PostgreSQL `localhost:55432`。如果 3000 被占用，设置 Web 启动端口并将 `SKIVA_WEB_ORIGIN` 同步为实际地址。开发管理员邮箱默认 `admin@localhost`；密码从 `.env.local` 读取。生产环境禁止本地密码登录，使用 OIDC。

本次工作区预览使用 `http://localhost:3001`。开发密码只用于本地测试，不可用于生产。

## 完整功能

- Git 仓库创建/配置/连接测试/同步/停用/软删除，GitHub/GitLab/Gitea Webhook、定期 reconcile。
- PostgreSQL 租约任务、固定 Commit 构建、版本化校验、引用诊断、SSRF/路径/特殊 inode/密钥检查，不运行来源脚本。
- Skill 版本、文件树、只读安全 Markdown、内容差异；发布组合预览、不可变 Snapshot、Canary/Stable、并发冲突与回滚。
- Profile Skill 授权、dynamic/pinned、离线策略；客户端注册、轮换、吊销、心跳和一次性令牌。
- Manifest/CAS Blob/Range/SSE；每次取内容先校验身份、快照与对象成员关系。
- Linux FUSE、旧句柄稳定性、持久化哈希缓存、断网策略、在线撤权、SSE+轮询、本地控制接口。
- 成员角色、账户停用、组织/安全设置、Secret 引用、站内通知、审计、响应式管理端和明暗主题。
- OpenAPI/TS SDK、SQL 迁移/sqlc、Prometheus、OTLP、Grafana、备份恢复、完整性巡检、安全 GC、CI。

## 真实演示数据

```bash
python3 scripts/demo-source.py
# 新终端：根据脚本输出配置 SKIVA_GIT_CA_BUNDLE、SKIVA_GIT_ALLOWLIST，启动 API
SKIVA_ADMIN_PASSWORD='你的开发密码' python3 scripts/seed-demo.py
```

脚本创建真实工作树和 bare Git 仓库，用本地 HTTPS 供平台 fetch。不是直接向数据库插入 Registry 假数据。`--broken` 可创建缺失引用的初始仓库；修复、commit、push 后重新同步。

## 验证

```bash
make test-db                      # 创建并迁移独立测试库
make lint test build
make openapi-generate sqlc-generate
make test-e2e                      # API 和 Web 已启动
cd apps/web && SKIVA_DEMO_E2E=1 npx playwright test delivery.spec.ts
```

`make test` 通过 `TEST_DATABASE_URL` 指定专用测试库；直接运行 `go test` 时使用 `SKIVA_TEST_DATABASE_URL`。集成测试会创建持久测试组织及元数据，但对象使用临时目录；不要对生产数据库运行。

API 契约校验：`make validation-deps` 后，在设置 `SKIVA_ADMIN_PASSWORD` 的环境运行 `make contract-check`。

## 客户端

```bash
make build-mount
chmod 600 client.token
skills-mount login --server https://skills.example.internal --token-file client.token
skills-mount mount --profile PROFILE_ID --mode dynamic --path ~/agent-skills
skills-mount status
skills-mount refresh
skills-mount refresh --repin        # 仅在任务之间重新绑定 pinned 快照
skills-mount unmount --path ~/agent-skills
```

每个挂载使用独立 `--cache` 目录。Profile 由服务端决定渠道与模式，客户端不能越权覆盖渠道。敏感 Profile 默认租约到期后拒绝读取。Linux FUSE 环境及测试边界见 [验收报告](docs/ACCEPTANCE.md)。

## 文档

在线文档：**https://linghechen.github.io/skiva/**。推送到 `main` 后，文档相关变更通过 GitHub Actions 自动构建发布。

本地静态构建：`npm run build:docs --prefix apps/web`，产物为 `.pages-build/out`，默认子路径 `/skiva`。该产物只包含文档，不包含管理端或 API。

启动 Web 后访问 `/docs`，或从管理端侧栏「使用文档」进入中文文档站。包含快速上手、发布更新、流水线配置、Agent 接入和运维指南，支持全文搜索、代码复制、深色主题和手机阅读。当前预览：http://localhost:3001/docs。

文档正文维护在 `apps/web/content/docs.ts`，每篇使用 Markdown 内容；新增条目会自动进入导航、搜索、静态页面和翻页链接。

- 原始需求：[文档包](docs/enterprise-skills-docs/README.md)
- 当前完成度与真实限制：[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)
- 部署/恢复：[运维手册](docs/OPERATIONS.md)
- Agent 集成：[适配说明](docs/AGENT_INTEGRATION.md)
- API：[OpenAPI 3.1](packages/openapi/openapi.yaml)
- 测试：[验收报告](docs/ACCEPTANCE.md)
- 交付源文件：[文件清单](docs/DELIVERY_FILES.md)

## Native managed Git hosting

Skiva can host private Skills repositories alongside existing external Git sources. After migration, enable `SKIVA_MANAGED_GIT_ENABLED`, `SKIVA_MANAGED_GIT_WRITE_ENABLED`, and `SKIVA_MANAGED_GIT_AUTO_CI_ENABLED` gradually. All default to `false`. Configure `SKIVA_GIT_PUBLIC_URL` and route `/git/` directly to the Go service behind TLS.

Create a managed repository in the console, issue a repository-scoped Git PAT, then use standard HTTPS clone/fetch/push. Accepted refs enter the existing fixed-commit pipeline; Git push never promotes Stable automatically. Published artifacts and existing delivery clients remain compatible.

See [managed Git guide](docs/hosting/managed-git.md), [pre-change audit](docs/hosting/CurrentStateAudit.md), and [acceptance record](docs/hosting/ACCEPTANCE.md). Bare repositories and durable event spool reside in the existing data volume and must be restored together with PostgreSQL and CAS.
