# 使用 Docker Compose 启动

[English](COMPOSE.md) · 简体中文

根目录 compose.yaml 用于单机本地试用：从源码构建前后端，启动 PostgreSQL，自动迁移，再等待后端健康后启动前端。宿主机只需要 Docker Compose v2 和 OpenSSL，Go/Node 构建在容器内完成。

## 启动

在项目根目录执行：

```bash
./scripts/setup-compose.sh
docker compose up --build -d --wait
```

访问 <http://localhost:3000>。邮箱默认 admin@localhost，密码查看 `.env` 的 SKIVA_ADMIN_PASSWORD。初始化脚本生成随机数据库和管理员密码，文件权限为 0600，不覆盖已有 .env。源码开发使用的 .env.local 不会被此入口加载。

首次下载镜像和构建可能需要数分钟。端口冲突时先在 .env 修改 SKIVA_WEB_PORT 和 SKIVA_API_PORT，Web 来源会自动跟随前端端口；浏览器使用 localhost，不要随意替换主机名。

对外端口仅绑定 127.0.0.1，数据库不发布端口。此模板使用开发密码登录和 HTTP，不用于公开生产部署。Git 托管需要 HTTPS，Docker 网络不属于 loopback，因此本模板明确关闭托管功能；本地试用可连接外部 Git。需要托管 Git、域名、TLS 和企业 OIDC 时使用[预生产模板](preproduction/README.zh-CN.md)。

SKIVA_GIT_ALLOWLIST 可允许指定私网来源主机，公网来源仍受后端校验策略约束。容器 localhost 指容器本身，不是宿主机。企业 CA、凭据 Secret 引用和网络配置见[运维说明](../docs/OPERATIONS.zh-CN.md)。

## 检查与停止

```bash
docker compose ps
docker compose logs --tail=100 migrate server web
docker compose stop
docker compose start
```

迁移容器应以 code 0 退出，不需要持续运行。配置变更后可使用 docker compose up -d --wait 对账。

## 升级

先备份，迁移前停止应用写入，再更新源码并重建：

```bash
docker compose stop web server
git pull --ff-only
docker compose up --build -d --wait
```

新迁移容器完成后才启动服务。失败时先检查日志，不运行破坏性回退。备份应在 API/Worker 停止写入时同时包含 PostgreSQL 和完整 artifacts 卷，具体见[备份恢复](../docs/OPERATIONS.zh-CN.md#备份与恢复)。

## 数据与凭据

postgres 和 artifacts 命名卷保留数据库、CAS/Git 数据，重建容器不会清空。默认项目名前缀 skiva-compose，与源码开发栈隔离；更改项目名会选择不同数据卷。

docker compose down 删除容器和网络，保留数据卷。**docker compose down -v 会删除数据库和内容卷**，不要用于升级或修复启动失败。

保管好 .env。数据库初始化后修改 SKIVA_DB_PASSWORD 不会轮换 PostgreSQL 已保存的密码；修改初始管理员密码也不会重置已有账户。应通过对应数据库/账户管理流程轮换，不要靠删除数据重置密码。
