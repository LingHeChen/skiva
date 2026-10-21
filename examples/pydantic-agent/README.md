# 本地 Pydantic AI 试点

这个可重复运行的示例用真实 MiniMax 模型判断一笔 **150 元**的模拟报销。Agent 的 `read_skill` 工具通过 `docker exec cat` 读取 **Linux 内核 FUSE 挂载**；Skill 从 Skiva 原生 Git 仓库经过流水线、不可变版本、发布快照、渠道和 Profile 交付。模型本身在宿主机 Python 进程运行。

## 启动

已验证环境：macOS ARM64、Docker Desktop、Go 1.26.10、uv / Python 3.12。需要 Docker 的 `/dev/fuse`，示例容器拥有 FUSE 必需的 `SYS_ADMIN` 能力，仅用于本地受控试点。此脚本依赖 Docker Desktop 的 `host.docker.internal`，不是 Linux 服务器部署脚本。

在项目根目录的 `.env.local` 设置现有管理员配置（`SKIVA_ADMIN_EMAIL`、`SKIVA_ADMIN_PASSWORD`）；模型凭据通过环境提供：

- `MINIMAX_M2_BASE_URL`：Anthropic 兼容端点。
- `MINIMAX_M2_AUTH_TOKEN`：模型密钥。
- `MINIMAX_M2_MODEL`：模型名，默认 `MiniMax-M2`。

```bash
./examples/pydantic-agent/run.sh
```

脚本复用开发 PostgreSQL 容器，创建独立数据库 `skiva_agent_pilot`，使用 `.data/agent-pilot/server` 和 `127.0.0.1:8083`。**8083 必须只由此试点后端占用**。管理页面原有的 3001 / 8080 服务仍连接原开发数据库。每次运行创建带随机后缀的独立仓库和 Profile，只操作试点数据库中的 canary 渠道。

首次准备需要下载依赖和安装容器内 fuse3。模型调用会使用已有账户额度。示例仅发送模拟报销规则与金额。

## 验收场景

| 场景 | Agent 应读取 | 150 元结果 |
| --- | --- | --- |
| 首次发布 | v1：限额 100 元 | 拒绝 |
| 推送并发布更新 | dynamic 更新到 v2：限额 200 元 | 通过 |
| 已固定的任务 | pinned 保持 v1 | 拒绝 |
| 渠道回滚 | dynamic 回到 v1 | 拒绝 |
| 撤销客户端凭据 | dynamic、pinned 均拒绝文件读取 | 不再调用模型 |

每次发布都走 Git push、固定 SHA 流水线和发布 API；渠道写入带 generation 和幂等键。模型结果由 Pydantic 校验，并由脚本断言策略版本、限额和审批结果。结束时撤销测试 Git PAT 和客户端凭据、删除临时令牌文件；挂载因此不再可读。

结果保存在 `.data/agent-pilot/results.json`，本地 OpenTelemetry spans 保存在 `.data/agent-pilot/traces.jsonl`（不记录提示词正文，不发送至托管追踪服务）。依赖版本锁定在 `requirements.txt`。

重新运行即可再次演示。停止 FUSE 容器：`docker stop skiva-agent-fuse`；再次运行脚本会自动恢复。后端由脚本首次启动时，其 PID 写在 `.data/agent-pilot/server.pid`，确认进程后可停止。数据库与发布历史保留用于检查，不自动删除。

这项验收覆盖单机、单 Agent 的发布消费闭环。它不代表企业 SSO、长期运行、多租户负载或故障恢复已经完成生产验收。
