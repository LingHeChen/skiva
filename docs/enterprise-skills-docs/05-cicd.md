# 05 · Git CI/CD 与 Release 状态机

## 1. 仓库约定
单 Skill：根目录 `SKILL.md`；Monorepo：默认 `skills/*/SKILL.md`；自定义 `skill_root` 可配置。仓库根可选 `.skills-platform.yaml`，包含 `version: 1, skills.root, pipeline.trigger.branches/tags, validate`。不允许通过仓库 YAML 指定任意 shell。Skill 内保持原有 name/description 等元数据；`SKILL.md` 格式以组织当前适配 Agent 的目标规范做校验，项目提供版本化规则集。

## 2. Job 状态
queued → running → succeeded/failed/cancelled；崩溃超时通过租约回收后重试。Pipeline 每一步诊断含 ruleId/severity/path/line/message，便于后台定位。

## 3. 构建阶段
1. 接收 Webhook/手动同步/定期 Reconcile，验证调用方并幂等入队。
2. 安全 Fetch 到允许仓库并解析提交（以提交为单次构建唯一版本；拒绝未解析 ref）。
3. 读取有限路径下的 Git Tree，限制大小、文件数、Git LFS 指针处理、深度、符号链接与 submodule；默认不跟随 Symlink，不自动递归 submodule。
4. Discover `SKILL.md`，校验元数据及名称规范，计算每个 Skill 所有文件内容摘要。
5. 校验引用路径，禁用特殊文件、禁止路径穿越、检测高风险内容（脚本/秘钥/外链），区分 Blocker/Warning；静态检测不是安全保证。
6. 构造 Skill Version 和 Registry Manifest；严格记录构建规则版本。
7. 将 Blob 存入 CAS/保留 Git 对象可读，校验完整性后提交版本元数据。构建成功不等于自动 Stable 发布。

## 4. Release
- `POST /releases/preview` 校验最终 Skill 名称唯一、所有 Version 均通过、安全政策、Blob 完整性、对应 Profile 的影响范围。
- 创建 Snapshot 时按 Skill 名称规范排序并哈希；同集合天然去重。
- 推进 Channel：对 `channels.generation` 乐观并发控制，事务内更新指针、历史、审计、Outbox 事件。只有事务提交后广播。
- rollback 与 promote 使用相同事务，只是目标是历史 Snapshot；原因必填。
- 删除 Repo 不得破坏历史 Snapshot；Artifact/Blob 设长期保留与安全 GC。

## 5. Canary / Stable
建议渠道 `canary` 与 `stable`；Profile 选择其一。Canary 无需强制自动升 Stable；人工验证后 Promote。可以后续增加百分比灰度，但 Profile 路由已足够早期需要。禁止将不完整的单 Skill 发布导致其他 Profile 的 Skill 消失；Release 是完整视图，替换策略需先做 Diff 预览。

## 6. 幂等与错误恢复
- 事件唯一 `(repository_id,provider,delivery_id)`；Build 唯一 `(repo,commit,config_digest,validator_version)`。
- Webhook 丢失：Reconcile 发现远端新 Commit 并构建；乱序事件允许构建历史 Commit，但不会自动覆盖 Channel。
- 构建半途中进程退出：未引用 CAS Blob 允许 GC；数据库状态通过 lease 重新入队。
- 发布事务失败：Channel 不变化，客户端视图维持旧版。
- SSE 推送失败：由客户端下次 Poll 兜底。
- 凭据失效：Repo 标为 error，保留上次成功快照并告警。

## 7. 供应链和可执行脚本
默认 CI 永不执行仓库 scripts；仅扫描内容与文件元数据。未来确需执行测试时，必须隔离容器、无特权、禁 Host Mount/Secrets、限制网络、CPU、内存、时间和文件系统写入范围，并与发布审批分离。管理员看到安全警告必须明确处置。
