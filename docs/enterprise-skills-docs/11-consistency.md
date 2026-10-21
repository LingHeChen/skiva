# 11 · 术语、统一性检查和修复记录

## 统一术语
- Repository：外部 Git 内容来源；平台不托管 Git。
- Skill：目录级逻辑资产，以 `SKILL.md` 为入口。
- Skill Version：单一 Skill 的不可变内容哈希及来源 Commit。
- Pipeline：针对固定 Commit 的验证与制品构建。
- Artifact/CAS：不可变文件内容对象；可由 Git 对象构建与缓存。
- Release Snapshot：一个完整可读取的已选 Skill Version 集合。
- Channel：指向当前 Release Snapshot 的可变发布指针，有 generation。
- Agent Profile：定义可见 Skills、Channel、一致性模式和离线政策的访问视图。
- Mount Client：认证并把 Profile 暴露为本地只读目录的程序。
- dynamic：打开文件之前可能获取新版本；不是任务级一致。
- pinned：路径视图固定为某 Snapshot；保证同次读取集合一致（需 Agent 使用该视图）。

## 跨文档检查（编写时执行）
| 检查 | 结果 | 说明 |
|---|---|---|
| React 与 Go 的责任边界 | 通过 | Next.js 只 UI/BFF，Go 唯一业务权威 |
| Repository 和 Release 区分 | 通过 | Repo Push ≠ 发布 Stable |
| CI 不执行不可信脚本 | 通过 | 产品、CI、安全文档均禁止 |
| Release 原子性与回滚 | 通过 | Snapshot 不可变、Channel 事务 CAS |
| Manifest 和 Blob 授权 | 通过 | Digest 不作为权限凭据 |
| 动态更新与会话一致性 | 通过 | 显式双模式并披露限制 |
| FUSE 平台支持表述 | 通过 | Linux 优先、mac/Win 待验证 |
| Webhook 丢失和重复 | 通过 | 去重 + Reconcile |
| 在线编辑要求 | 通过 | 全部文档均排除 |
| 企业基础能力 | 通过 | 登录、成员、设置、账户、审计、异常态齐全 |
| API/DDL 互相覆盖 | 需实施阶段核对 | OpenAPI 代码生成和 DDL 迁移需实际编译测试 |
| OS 与 Agent 兼容 | 待平台实测 | 不虚构跨平台支持 |

## 实施前必须确认的非阻塞决策
1. 目标 Agent 列表、每种 Agent Skills 发现目录及启动读取时机。
2. 首发 Linux 发行版/内核及能否部署 FUSE/宿主挂载。
3. 企业 Git 平台和允许地址范围（内网 SSRF 例外需要清晰 allowlist）。
4. SSO 与客户端凭据发放机制；安全敏感 Profile 的离线拒绝策略。
5. Canary 到 Stable 是人工审批还是自动签核（首版为人工）。

## 未来升级建议（非首版阻塞）
- 多数据中心 CAS、Profile 多层继承、跨 Agent 任务自动 pinned 包装器、内容差异压缩、企业 Policy-as-Code、双人审批、跨平台签名安装器、SDK/CSI。
