<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/brand/skiva-dark.svg">
    <img src="apps/web/public/brand/skiva-light.svg" alt="Skiva" width="360">
  </picture>
</p>

<p align="center"><a href="README.md">English</a> · 简体中文</p>

<p align="center">基于 Git 的 Skills 管理、发布与 Agent 交付平台</p>

<p align="center">
  <a href="https://linghechen.github.io/skiva/docs/zh/">在线文档</a> ·
  <a href="https://linghechen.github.io/skiva/docs/zh/quickstart/">快速上手</a> ·
  <a href="docs/OPERATIONS.zh-CN.md">部署指南</a> ·
  <a href="LICENSE">Apache 2.0</a>
</p>

## Skiva 是什么

Skiva 帮助团队将 Git 中的 Skills 校验、组合为不可变快照，再通过发布渠道交付给 Agent。支持连接外部 Git 仓库，也支持自建托管仓库，适合企业内部自部署。

你可以在控制台查看源码与版本差异、配置流水线、审核发布内容和回滚版本。Agent 通过 Linux 只读文件挂载使用获得授权的 Skills。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| Git 仓库 | 外部仓库同步、Webhook、定期同步，以及原生 HTTPS Git 托管 |
| 校验流水线 | 基于固定 Commit 构建，检查内容、引用、路径与密钥，不执行仓库脚本 |
| 版本与发布 | Skill 版本、文件浏览与差异、发布预览、不可变快照、Canary / Stable 渠道与回滚 |
| Agent 交付 | Profile 授权、动态更新或固定版本、Linux FUSE 挂载与离线缓存策略 |
| 权限与审计 | 成员角色、仓库权限、客户端凭据轮换与吊销、发布操作审计 |
| 运维与集成 | OpenAPI、Prometheus、OTLP、备份恢复、数据完整性巡检与部署模板 |

## 一次发布如何完成

1. **准备来源**：连接外部 Git 仓库，或创建 Skiva 托管仓库并推送 Skills。
2. **构建版本**：流水线读取固定 Commit，完成发现、校验与产物构建。
3. **组合快照**：选择 Skill 版本，预览变化并创建不可变快照。
4. **推进渠道**：先发布到 Canary 验证，再推进 Stable；需要时回滚到历史快照。
5. **交付 Agent**：通过 Profile 指定渠道、Skills 与更新模式，客户端读取授权内容。

Git 推送只触发来源更新与构建，不会自动推进 Stable。详细步骤见[第一次发布](https://linghechen.github.io/skiva/docs/zh/quickstart/)和[发布与回滚](https://linghechen.github.io/skiva/docs/zh/releases/)。

## 使用 Docker Compose

本地自部署试用可使用根目录 Compose，自动构建镜像、迁移数据库并持久化数据。

```bash
./scripts/setup-compose.sh
docker compose up --build -d --wait
```

访问 <http://localhost:3000>，邮箱为 admin@localhost，密码在生成的 .env 中。详见[启动与升级说明](deployments/COMPOSE.zh-CN.md)。此 HTTP 模板仅限本地；HTTPS/OIDC 和托管 Git 使用[预生产模板](deployments/preproduction/README.zh-CN.md)。

## 本地启动

准备 Go（支持工具链自动下载）、Node.js 24、Docker、Git 和 Python 3。Makefile 使用 Go 1.26.10 工具链；启动前确保 Docker 已运行。

```bash
git clone https://github.com/LingHeChen/skiva.git
cd skiva
cp .env.example .env.local
```

编辑 `.env.local`，将 `SKIVA_ADMIN_PASSWORD` 改为至少 14 个字符的独立密码，然后运行：

```bash
make deps
make dev
```

| 服务 | 默认地址 |
| --- | --- |
| 管理控制台 | <http://localhost:3000> |
| 使用文档 | <http://localhost:3000/docs> |
| 后端 API | <http://localhost:8080> |
| PostgreSQL | `localhost:55432` |

开发管理员邮箱默认为 `admin@localhost`，密码使用 `.env.local` 中的配置。如果需要修改前端端口，同时设置 `SKIVA_WEB_PORT` 和 `SKIVA_WEB_ORIGIN`。

本地密码登录仅用于开发环境。部署到正式环境需要配置 OIDC、TLS、持久化存储和备份，参见[运维手册](docs/OPERATIONS.zh-CN.md)与[单机预生产部署模板](deployments/preproduction/README.zh-CN.md)。

## 启用 Git 托管

原生 Git 托管默认关闭。完成数据库迁移后，按部署需要逐步启用：

```dotenv
SKIVA_MANAGED_GIT_ENABLED=true
SKIVA_MANAGED_GIT_WRITE_ENABLED=true
SKIVA_MANAGED_GIT_AUTO_CI_ENABLED=true
SKIVA_GIT_PUBLIC_URL=https://skills.example.internal
```

在控制台创建托管仓库并签发仓库访问令牌后，即可使用标准 Git HTTPS clone、fetch 和 push。反向代理需要将 `/git/` 转发到 Go 服务。

具体配置、权限与备份要求见 [Git 托管指南](docs/hosting/managed-git.zh-CN.md)。

## 接入 Agent

Linux 客户端将获得授权的 Skills 挂载为只读目录。Profile 决定发布渠道、允许访问的 Skills 和更新模式：

- `dynamic`：跟随渠道更新。
- `pinned`：固定快照，在任务之间显式重新绑定。

客户端构建命令为 `make build-mount`，产物位于 `bin/`，提供 Linux amd64 和 arm64 版本。挂载需要 Linux FUSE；每个挂载应使用独立缓存目录。

接入步骤见 [Agent 适配说明](docs/AGENT_INTEGRATION.zh-CN.md)，可运行的示例见 [Pydantic AI Agent](examples/pydantic-agent/README.zh-CN.md)。

## 开发与验证

```bash
make test-db                       # 创建并迁移独立测试库
make lint test build               # 静态检查、测试与构建
make openapi-generate sqlc-generate # 生成 API 与数据库代码
make test-e2e                      # 需先启动 API 和 Web
```

`make test` 使用 `TEST_DATABASE_URL` 指定测试库；直接执行 Go 测试时使用 `SKIVA_TEST_DATABASE_URL`。集成测试会写入数据，应使用独立测试库。

本地 Git 演示来源可通过 `python3 scripts/demo-source.py` 创建，再按照脚本提示配置 HTTPS 证书和允许列表，使用 `scripts/seed-demo.py` 导入演示场景。验证覆盖与部署限制见[验收说明](docs/ACCEPTANCE.zh-CN.md)。

## 文档与项目结构

完整指南见 [Skiva 在线文档](https://linghechen.github.io/skiva/docs/zh/)。

| 目录 | 内容 |
| --- | --- |
| `apps/server` | Go API、Git 托管、构建与分发服务 |
| `apps/web` | Next.js 控制台与文档站 |
| `apps/mount` | Linux FUSE 客户端 |
| `packages` | OpenAPI、分发协议与数据 Schema |
| `migrations` | 数据库迁移 |
| `deployments` | 容器、部署与监控配置 |
| `examples` | Agent 集成示例 |
| `docs` | 运维、集成与验收说明 |
| `tests` | 浏览器与静态站测试 |
| `scripts` | 开发、构建、备份与验证工具 |

文档正文位于 `apps/web/content/docs.en.json` 和 `docs.zh.json`。控制台默认英文，可切换中文并保存偏好；文档站通过语言入口跳转到同一篇文章的另一语言版本。翻译维护见[国际化说明](docs/LOCALIZATION.zh-CN.md)。运行 `npm run build:docs --prefix apps/web` 可生成静态站，产物位于 `.pages-build/out`；推送到 `main` 的文档相关变更由 GitHub Actions 自动发布到 GitHub Pages。

## 许可证

Skiva 使用 [Apache License 2.0](LICENSE)，允许商业使用、修改与分发。相关要求见[中文许可说明](LICENSE-FAQ.zh-CN.md)、[NOTICE](NOTICE) 和[第三方声明](THIRD_PARTY_NOTICES.zh-CN.md)。
