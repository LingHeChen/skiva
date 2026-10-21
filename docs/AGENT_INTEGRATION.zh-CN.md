# Agent 集成

[English](AGENT_INTEGRATION.md) · 简体中文

客户端提供文件系统。Agent 可以维护自己的发现索引和已加载提示词，因此 FUSE 刷新成功不代表运行中的 Agent 已刷新内部状态。

## 项目适配器

| Agent | 项目搜索路径 | 参数 |
| --- | --- | --- |
| Codex CLI | `.agents/skills/<skill>/SKILL.md` | `--agent codex` |
| Claude Code | `.claude/skills/<skill>/SKILL.md` | `--agent claude` |
| OpenCode | `.opencode/skills/<skill>/SKILL.md` | `--agent opencode` |

```bash
python3 scripts/agent-link.py \
  --source-mount-path /srv/agent-skills \
  --project /workspace/project \
  --agent codex
python3 scripts/agent-link.py --source-mount-path /srv/agent-skills --project /workspace/project --agent codex --check
```

适配器拒绝覆盖已有路径，不修改全局配置，并检查目录/文件可读性。Linux 沙箱禁止符号链接时，直接挂载到 Agent 搜索目录或使用管理员配置的只读 bind mount。不要默认授予应用容器广泛特权。

## 运行时验收

针对确切 Agent 版本和沙箱策略记录：

1. 使用独立测试项目和已验证挂载启动，确认发现两个预期 Skill。
2. 调用无害 Skill，确认沙箱可以读取 SKILL.md 与引用文件。
3. 发布新 Canary，验证新 open 内容变化，确定是否需要新任务、会话或重启刷新索引。
4. 使用 pinned 启动任务，发布新快照，验证任务仍读取原快照。
5. 吊销客户端，检查在线读取失败，离线行为符合策略。
6. 对实际符号链接或 bind mount 路径重复验证并记录差异。

已执行的发现检查（不调用模型）：

- Codex CLI 0.163.0：app-server skills/list 发现项目链接 Skill；forceReload 刷新元数据。
- Claude Code 2.1.236：初始化流的命令元数据中返回项目 Skill。
- OpenCode 1.19.3：debug skill --pure 发现项目链接 Skill。旧 1.1.20 无法正常运行，因此使用项目本地可执行文件，未改全局安装。

脚本：`scripts/check-codex-discovery.py`、`check-claude-discovery.py`、`check-opencode-discovery.py`（可设 SKIVA_OPENCODE_BIN）。日志位于 test-results/agent-adapters/。

这些发现检查在 macOS 宿主机执行，与 Linux FUSE 检查独立，不证明组合沙箱、模型调用或任务内缓存刷新。上线前完成目标环境验收。

## 兼容性资料

查看所部署版本的官方文档：[Codex Skills](https://developers.openai.com/codex/skills/)、[Claude Code Skills](https://code.claude.com/docs/en/skills)、[OpenCode Skills](https://opencode.ai/docs/skills/)。

这些资料描述配置约定，不是运行时验收证据。符号链接行为可能随版本变化，允许时优先直接挂载。dynamic 文件更新不保证 Agent 内存索引自动更新。

## 本地真实 Pydantic AI 验收

参见[可运行示例](../examples/pydantic-agent/README.zh-CN.md)。它通过原生 Git 发布报销审批 Skill，由真实模型经 Linux FUSE 读取规则，验证动态更新、固定版本、回滚与撤销。结果和 OpenTelemetry 记录保存在 .data/agent-pilot/。
