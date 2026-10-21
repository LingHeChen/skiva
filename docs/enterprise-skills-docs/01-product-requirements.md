# 01 · 产品需求（PRD）

## 1. 目标与指标
目标：Skill 作者只在现有 Git 仓库迭代；平台完成 CI、审批/发布、可观测分发；Agent/业务服务只挂载稳定路径。衡量：新 Commit 到可发布产物的耗时、发布到客户端检测的延迟、版本追溯完整率、回滚完成率、挂载读取可用率、缓存命中率、CI 错误可定位率。

首发推荐 SLO（初始目标，不视作已测量承诺）：本地缓存命中读取无需网络；在线通知 30 秒内多数客户端感知（以实验结果校准）；控制面可用性 99.9% 为中期目标；成功构建的文件哈希校验率 100%。不得以不可信估算替代压测结果。

## 2. 角色
- 平台管理员：组织设置、OIDC、成员角色、仓库凭据、挂载政策、审计检索。
- Skill 维护者：接入仓库、查看 CI、查看产物及 Diff；没有默认 Stable 发布权限。
- 发布管理员：创建 Release、审核、安全风险处理、Canary/Stable 推进与回滚。
- Agent 管理员：管理 Profile、指定渠道、签发/撤销挂载身份；不能越权访问仓库秘密。
- 审计员：只读访问审计、发布、访问记录；不暴露 Secrets。
- 挂载客户端：非人类主体，按 Profile 授权读取清单和 Blob，不能修改 Registry。

权限最小矩阵：Repo Maintainer=接入/编辑仓库/查看流水线；Release Manager=发布/回滚；Agent Manager=维护 Profile/Client；Auditor=只读；Org Admin=全部。实际服务端每个操作鉴权，前端隐藏按钮不是权限控制。

## 3. 功能完整性（第一版基线）
### 基础产品能力
登录、登出、会话续期、无权访问页、个人资料与凭据状态、组织设置、成员和角色、审计列表、通知中心（至少站内）、全局错误/空状态/404/500、暗/亮色模式、响应式导航、搜索及过滤、分页、危险操作确认。

### 仓库
新增 HTTPS/SSH 仓库、配置 Secret 引用、默认分支、扫描根目录、Webhook 验签说明、测试连接、手动同步、停用/删除（软删除）、同步状态、最后成功 Commit、错误诊断、轮询兜底。

### Registry
Skill 自动发现、唯一名称规范、来源仓库、目录、版本时间线、SKILL.md 只读预览、附件树、内容 Diff、版本来源和校验结果，筛选搜索。重复命名不能在一个最终发布视图中共存；可在 Registry 中存在不同来源的同名 Skill。

### Pipeline
Webhook 自动触发、手动触发、去重、状态机、步骤日志与校验结果、失败重试、历史查询。默认安全静态分析，绝不执行仓库自带脚本。失败时保留可定位的路径、规则 ID、错误说明。

### Release / Channels
从成功构建版本集合创建快照、变更预览、可选审批、Stable/Canary、发布历史、原子推进、原因必填的回滚、与 Profile 的影响范围预览。不能发布校验不通过的 Artifact。

### Agent Profiles / Mount Clients
Profile 命名、授权 Skills 集合、channel、dynamic/pinned 模式、客户端注册、凭据轮换/吊销、在线心跳、当前快照、缓存状态、连接故障提示、平台特定挂载指引、最小可用 CLI。

### 交付运行
提供 `manifest`、Blob、事件订阅、指数退避、断线重连、缓存、原子视图、权限失效；服务端仅发文件内容，不提供对 Skill 的脚本执行服务。

## 4. 核心用户故事
- 作为维护者，我 push 新提交后可以看到扫描结果和失败规则，且旧版本不被污染。
- 作为发布者，我能查看此次 Release 相对现网变化并先在 Canary 验证再升 Stable。
- 作为 Agent 管理员，我无需修改 Agent 仓库即可更新 Profile/Channel 的可见 Skill。
- 作为审计员，我能以时间、操作者、仓库、Profile、Release 检索每次变更。
- 作为运维，我能在 Git、控制面或网络异常时恢复且不丢失已发布产物。

## 5. 明确不做
在线 Markdown 编辑、协同编辑、仓库托管、公共技能商店、自动写 Skill、调用大模型评估效果、可执行的任意 CI Pipeline DSL、企业账单、跨云多活、客户端远程写入、保证任意第三方 Agent 进程无须重启即重载内存中的技能索引。

## 6. 状态和通知
关键状态：Repository=active/disabled/error；Pipeline=queued/running/failed/succeeded/cancelled；Artifact=validated/rejected；Release=draft/published/superseded；Client=online/stale/offline/revoked。构建失败与发布失败提示支持重试和链接诊断；用户可从通知跳到对应详情。

## 7. Definition of Done
所有路由、列表/详情/创建/修改/禁用、成功/失败/空/加载/无权态完整；OpenAPI 与数据库迁移同步；发布与回滚端到端验收；缓存一致性测试通过；所有敏感动作均审计；部署、备份、恢复和监控文档可执行。
