# 09 · 测试计划和最终验收

## 1. 自动化分层
- Go unit：Git ref 解析、路径规范化、规则验证、Snapshot canonical hashing、RBAC、发布 Generation CAS、错误映射。
- Go integration：PostgreSQL Testcontainers/容器数据库，真实 Git bare 测试仓库，Repo 凭据、Job lease、Artifacts CAS。
- Contract：OpenAPI 生成类型与 Handler response 一致；Manifest schema golden fixtures；向后兼容测试。
- Next.js unit：表单、组件、状态、权限视图；Playwright E2E 覆盖全局导航和关键事务。
- VFS tests：小文件、目录、并发读取、缓存冷热、断网、inode/句柄稳定性、目录更新、fs 事件。
- Security：SSRF、路径穿越、跨组织授权、假 webhook、盗用 digest、签名失败、缓存未授权、恶意 Markdown、限流。
- 性能：1/100/1000 Skill 的 Manifest、10/100 并发 Client、冷热打开和缓存命中；基准保留环境说明，不虚构性能数字。

## 2. E2E 核心用例
| ID | 过程 | 期望 |
|---|---|---|
| E01 | 接入单 Skill Git 仓库 | 识别 `SKILL.md` 并产出 Version |
| E02 | 接入 Monorepo | 多 Skill 独立列表与来源，重复冲突在 Release 阶段发现 |
| E03 | Push 同一 Webhook 两次 | 构建幂等，无重复发布 |
| E04 | 漏掉 Webhook | Reconcile 补发现新的 Commit |
| E05 | 引用文件不存在 | Pipeline failed，错误含 path/ruleId |
| E06 | 同一提交规则升级 | validator_version 改变会重新校验 |
| E07 | 发布 Canary | Canary Profile 变化，Stable 不变化 |
| E08 | 发布 Stable | generation+1，有准确历史和 Audit |
| E09 | 并发发布不同 Snapshot | 一方成功、一方 409 冲突 |
| E10 | 回滚 Stable | 不构建，指针回历史 Snapshot |
| E11 | 已打开旧文件，发布新版 | 老句柄字节一致，新 open 按动态策略更新 |
| E12 | Pinned 运行时发布新版 | 不变化，显式重新绑定才改变 |
| E13 | 离线缓存命中/未命中 | 遵循 allow_cached/fail-closed 策略 |
| E14 | Client Token 撤销 | 在线后续请求 403；离线行为受租约限制 |
| E15 | Git Source 离线 | 仍可读取历史已发布 Artifact |
| E16 | Blob 缺失/损坏 | 不交付错误字节，有告警和重试 |
| E17 | 恶意路径/子模块/链接 | 阻止越界读取与危险解析 |
| E18 | 无权限用户直接调用 Go API | 403，不因 UI 隐藏而放行 |
| E19 | 后台所有页面加载/空/失败/无权 | 可使用，有重试和错误说明 |
| E20 | 创建/停用/轮换 mount 客户端 | 令牌一次显示，旧凭据失效，审计齐全 |

## 3. 质量门禁
编译/Lint/Typecheck、迁移测试、核心单元与集成通过、OpenAPI 匹配、Playwright 核心流程、端到端发布与回滚通过、已知高危漏洞阻断、敏感字段无泄漏、可恢复备份演练。

## 4. 客户端专项矩阵
Linux x86_64/arm64 + FUSE3；不同内核缓存 TTL；挂载/卸载异常；现有 Agent 的目录发现与真实读取；macOS/Windows 在各自验证完前不声明支持。容器部署验证宿主预挂载，而不是默认给 Pod privileged。

## 5. 灾难恢复
数据库备份 + Git bare/object CAS 持久卷一致性快照；恢复后重建索引并验证 Snapshot→Blob 引用；按渠道历史生成巡检报告。故障注入包括 Go 宕机、PG 切主、磁盘满、DNS 改变、慢链路、重复 SSE 和客户端突然断电。
