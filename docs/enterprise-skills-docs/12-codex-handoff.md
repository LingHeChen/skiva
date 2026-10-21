# 12 · 给 Codex 的执行说明

## 工作指令（可直接复制）
> 请阅读 `README.md` 与 `01`～`11` 全部文档后开始实施 Enterprise Skills Delivery Platform。采用 Next.js App Router + TypeScript + shadcn/ui + Tailwind、Go/Chi/pgx/sqlc、PostgreSQL、原生 Git CLI。完整交付设计要求而不是只做 MVP 主流程。阶段实施顺序按 `10-implementation.md`，每完成一个阶段必须运行测试、更新 OpenAPI/迁移/文档，并在 `IMPLEMENTATION_STATUS.md` 标记已完成、未完成和风险。严禁实现有按钮无后台行为的伪功能。严格坚持 Git 不可信、CAS 不可变、Channel 原子发布、Profile 授权、dynamic/pinned 差异及客户端只读。缺少 Linux FUSE 环境时先交付可测试协议和文件系统模拟层，不得声称真实挂载已通过验收。

## 首次任务建议
1. 初始化 Monorepo、服务健康检查、DB 容器、迁移工具、OpenAPI 3.1、日志 requestId 和测试框架。
2. 完成 Auth/RBAC 数据模型、Go middleware 和登录/账户/成员基础 UI。
3. 实现 Repository CRUD、URL/SSRF 策略、Webhook 收取+去重+Reconcile、Go Job Queue。
4. 实现 Git Tree Scan、Skill Version、规则诊断、Registry 页面和 Pipeline 页面。
5. 实现 Release/Channel/Profile/Snapshot/Blob API，并编写并发更新/鉴权测试。
6. 实现 VFS 客户端先抽象目录索引/句柄与缓存，再接 Linux FUSE，补全 Agent 集成验收。
7. 完善全部页面、暗亮主题、设置与审计、异常态、运维文档、安全测试。

## 提交时必须提供的证据
- 变更文件清单、命令行执行记录、单元/集成/E2E 结果。
- 若触及 API，提交最新 `openapi.yaml` 和生成的 TS 类型；若触及模型，提交迁移与回滚说明。
- 若触及文件系统，提交 Linux 环境版本、挂载方式、打开句柄/更新一致性测试。
- 对未完成项使用真实 TODO/Issue 和适用范围，不用假数据/模拟交互冒充生产能力。

## 核心验收脚本
见 `README.md` 的六步标准演示及 `09-testing.md` 的 E01–E20；验收全部基础页面、真实权限、发布回滚、审计和客户端失联行为。
