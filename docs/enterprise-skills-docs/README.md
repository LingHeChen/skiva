# Enterprise Skills Delivery Platform（SKIVA）开发文档

版本：1.0 / 需求基线：2026-10-21 / 状态：可启动工程实施（有显式待决项）

> **定位**：企业内部以外部 Git 仓库为唯一内容来源、以不可变构建产物为发布单元、以 Agent Profile/Release Channel 组织可见性，通过 HTTPS 内容协议 + 本地只读 VFS 挂载向 Agent 分发 Skills。Agent 业务代码与 Skills 发布周期解耦。

## 阅读顺序与文档索引
1. [01 产品需求与范围](01-product-requirements.md)：角色、能力、完整页面、业务流程、验收定义。
2. [02 系统架构与技术决策](02-architecture.md)：模块、数据流、部署拓扑、边界、ADR。
3. [03 数据模型与 DDL](03-data-model.md)：PostgreSQL、约束、幂等和事务。
4. [04 API 与协议](04-api-contract.md)：REST、错误模型、Manifest、事件协议、示例。
5. [05 Git CI/CD](05-cicd.md)：事件处理、校验、构建、发布、灰度、回滚、保留。
6. [06 VFS 客户端与一致性](06-vfs.md)：挂载语义、缓存、断网、客户端安全、平台差异。
7. [07 权限与供应链安全](07-security.md)：OIDC/RBAC、凭据、恶意仓库防护、审计。
8. [08 管理端 UX/UI](08-admin-ui.md)：完整路由、页面状态、组件、设计系统、交互验收。
9. [09 测试与验收](09-testing.md)：分层测试、端到端演练、故障注入和发布门禁。
10. [10 工程实施与运维](10-implementation.md)：Monorepo、分阶段开发、环境、迁移、运维。
11. [11 术语与统一性检查](11-consistency.md)：术语、决策追踪、边界和交叉审计。
12. [12 Codex 执行指引](12-codex-handoff.md)：任务顺序、DoD 与防止只实现主链路。

## 已冻结决策
- 管理端 Next.js（App Router）+ TypeScript + shadcn/ui + Tailwind CSS；Go 为唯一业务权威后端。
- PostgreSQL 持久化。首发单组织私有部署，数据模型仍保留组织 ID；不做公网多租户计费。
- 不提供在线编辑、Git 托管或任意用户提供的 CI 脚本；对接 GitLab/GitHub/Gitea 等现有 Git 服务。
- 默认仓库内扫描 `SKILL.md`；支持单 Skill 仓库及 `skills/` Monorepo。
- 发布以不可变 Snapshot + 可变 Channel 指针完成；回滚是指针操作，而不是重新构建。
- Go 本地客户端将指定 Profile 挂载为只读文件系统；通过 Manifest + CAS Blob + SSE/轮询分发。
- 两种可见性：`dynamic`（无侵入近实时，不能承诺任务级原子性）与 `pinned`（固定快照，严格一致）。
- 首发优先 Linux FUSE；macOS/Windows 需要独立平台验收，不把“跨平台预期”写成已实现支持。
- CI 默认**不执行**来源仓库脚本；上线前做安全检测。凭据只能由服务端持有。

## 不确定但不阻碍实现的选项
- 企业 SSO 选择具体 IdP、私有部署时的网络拓扑与主机挂载权限；默认开发环境本地账号，正式环境 OIDC。
- 组织审查是否需要双人审批：模型和审计接口预留，首版可启用单人发布权限，正式生产可按政策启用双人审批。
- macOS 使用 macFUSE 类运行时，Windows 使用 WinFsp：需目标版本兼容测试和驱动分发策略。

## 核心不变量
1. Git `ref` 只用于解析 Commit；构建与发布始终绑定**完整 Commit SHA**。
2. Artifact/Snapshot 不可原地修改；Channel 指针可修改且写入审计。
3. 任何可执行任务的 Pinned Snapshot ID 在该任务生命周期不改变。
4. Manifest 中的文件路径为受控相对路径，不能遍历根目录或跟随越界符号链接。
5. 服务端对所有管理请求、Manifest 请求与 Blob 获取都要做权限验证；知道哈希不等于被授权。
6. 客户端缓存以内容哈希为键并校验下载；切换 `dynamic` 视图不会改变既有 open handle 指向的内容。
7. Git webhook 丢失、重复、乱序都不能导致错误发布；定期 Git reconciliation 弥补丢失。
8. 故障或权限撤销的离线安全策略由企业配置，不能同时承诺无限期离线使用和即时撤权。

## 标准演示脚本
1. 接入 Git 仓库并验证凭据，Webhook push `main`。
2. Pipeline 识别 2 个 Skill，其中一个引用缺失导致失败，并展示可定位的错误。
3. 修复 Git 后再次 push，Pipeline 通过，生成不可变 Artifact。
4. 管理员创建 Release，发布到 `canary`；Canary Profile 挂载客户端得到新文件。
5. 将同一 Release 提升到 `stable`，Stable 客户端无安装操作更新目录；旧 open handle 仍读旧内容。
6. 人工回滚到前一 Release；可见目录回退；审计显示操作者及原因。
7. 禁用某客户端授权，在线请求被拒绝；断网行为符合其被配置的 fail-open/fail-closed 策略。
