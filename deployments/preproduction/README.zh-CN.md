# 单机预生产部署模板

[English](README.md) · 简体中文

此模板提供 PostgreSQL、独立迁移任务、后端、前端、Caddy TLS 和可选 Prometheus。当前完成 Compose 配置校验；企业 OIDC、实际域名证书和告警接收方需要部署环境验证。当前本地 Agent 试点使用 `examples/pydantic-agent`，不依赖此模板。

设置 Compose 插值环境：`SKIVA_SERVER_IMAGE`、`SKIVA_WEB_IMAGE`（使用不可变镜像版本）、`SKIVA_DOMAIN`、`SKIVA_ACME_EMAIL`、`SKIVA_ADMIN_EMAIL`、`SKIVA_OIDC_ISSUER`、`SKIVA_OIDC_CLIENT_ID`、`SKIVA_SECRETS_DIR`（绝对路径）。

密钥目录包含四个文件：`db_password`、`database_url`（指向 Compose 内 postgres:5432/skiva）、`bootstrap_password`、`oidc_secret`。目录只允许部署管理员访问；文件需允许容器 UID 10001 读取。不要提交密钥。后端支持相应环境变量的 `_FILE` 形式，同时配置明文与文件会拒绝启动。

```bash
docker compose -f deployments/preproduction/compose.yaml config --quiet
docker compose -f deployments/preproduction/compose.yaml up -d
```

数据库迁移成功且后端健康后才启动后续服务。Caddy 对外公开 80/443；数据库、后端不发布端口，公网不提供 `/metrics`。前端镜像应按 `deployments/docker/web.Dockerfile` 构建。OIDC 回调、授权用户和浏览器登录必须在目标 IdP 上验证后开放使用。

Git 托管三个功能开关默认关闭。依次设置 `SKIVA_MANAGED_GIT_ENABLED`、`SKIVA_MANAGED_GIT_WRITE_ENABLED`、`SKIVA_MANAGED_GIT_AUTO_CI_ENABLED=true` 启用。`SKIVA_GIT_TRUST_PROXY=true` 仅适用于后端不直接对外暴露的当前拓扑。

使用 `--profile monitoring` 启动本机 127.0.0.1:9090 的 Prometheus。配置真实 Alertmanager 才会发送告警。此模板不自动执行备份；正式试点前按 `docs/OPERATIONS.md` 做数据库、CAS、Git 裸仓库的一致备份与恢复演练。
