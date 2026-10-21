# 平台托管 Git 仓库

[English](managed-git.md) · 简体中文

## 创建和第一次推送

在 Git 仓库 → 新建中选择「平台托管」，填写团队命名空间、仓库路径和名称。选择单 Skill、Monorepo 或空仓库模板。创建返回 provisioning，后台准备完成后变为 active；失败会保留错误状态并重试。

命名空间由一个组织独占；同一组织内 namespace/slug 唯一，软删除后继续保留名称。物理路径使用不可变 UUID，不使用用户输入的目录。显示名称可修改；API 也支持修改 namespace/slug，物理 UUID 路径保持不变。旧 Clone URL 返回 404，不重定向读取或写入，调用方必须更新 remote。External 不会自动转为 Managed。

仓库详情 → Git Token → 创建。只读 Token 可 Clone / Fetch；需要推送时勾选 repo:write。有效期最长 90 天，原文只展示一次。保存到操作系统 Git 凭据管理器，不要写入仓库、URL 或日志。Git Token 不等同于 Agent 挂载凭据。

```bash
git clone https://skills.example.internal/git/engineering/sql-query.git
cd sql-query
# Git 提示密码时填写 Git Token
# 修改 SKILL.md 和 references/ 等文件
git add .
git commit -m 'Improve instructions'
git push origin main
```

空仓库首次推送也必须包含 SKILL.md。Monorepo 默认 skills/<skill-name>/SKILL.md。支持标准 Git HTTPS；不提供 SSH、LFS、PR 或 Issues。

## Push、流水线、发布是三件事

Push 成功表示 Git 接受了更新。活动页记录实际 Ref 和新 SHA，后台将固定 Commit 交给既有流水线。默认主分支和 refs/tags/v* 自动构建；其他分支仅记录活动。

流水线成功产生候选 Skill 版本。按[发布与更新](https://linghechen.github.io/skiva/docs/zh/releases/)创建完整快照，验证 Canary，再由有发布权限的人推进 Stable。Push 和仓库维护权限不会自动授予发布权限，现有客户端和交付 Token 无需更换。

查看最近 Push → Pipeline、Commits、Branches / Tags、Files、Diff。提交列表点击 SHA 可查看固定版本文件。Diff 最多展示/下载 256 KiB，超过部分明确截断；完整差异在本地使用 git diff。文件名与差异按文本显示，不执行 HTML。

## 成员和保护策略

| 仓库角色 | 读取 | 非保护分支推送 | 受保护主分支 | 配置 |
| --- | --- | --- | --- | --- |
| Viewer | 可 | 不可 | 不可 | 不可 |
| Contributor | 可 | 可 | 不可 | 不可 |
| Maintainer / Org Admin | 可 | 可 | 依策略 | 可 |

组织全局 Repo Maintainer 不自动获得所有托管仓库权限；创建者成为该仓库 Maintainer。只有 Org Admin 可跨仓库管理。仓库详情按用户 UUID 增加或移除同组织成员，跨组织授权由数据库约束拒绝。

Token 始终限制到单个仓库，并同时检查有效期、scope、当前用户状态和当前成员角色。修改成员权限或撤销 Token 对新请求立即生效；已开始的传输最多运行至 120 秒超时。轮换时先创建新 Token，更新客户端并验证，再撤销旧 Token。

默认保护 main：禁止强推、删除；受保护 Tags 仅 Maintainer 可创建，禁止覆盖/删除。服务端 pre-receive 拒绝整个不合规批次，支持 git push --atomic。文件数、对象大小、单次 Push、仓库/全局容量都有上限；禁止符号链接、子模块、危险二进制和敏感文件路径。scripts/ 可以保存，但服务器从不执行它们。CI 会继续执行独立的内容、引用与秘密检测。

默认：单 Push 64 MiB，仓库 512 MiB，单对象 4 MiB，文件数 10000，组织最多 1000 仓库，全局 managed 存储 20 GiB。Git 响应缓冲上限 32 MiB；大型 Clone 超限时返回网关错误，应在扩容和负载验收后调整实现，不能承诺无限容量。

## 运维与回滚

新版本先执行新增 migration 00003，旧行自动为 external，历史 SHA/版本/快照不修改。三个开关默认 false：

```bash
SKIVA_MANAGED_GIT_ENABLED=true
SKIVA_MANAGED_GIT_WRITE_ENABLED=true
SKIVA_MANAGED_GIT_AUTO_CI_ENABLED=true
SKIVA_GIT_PUBLIC_URL=https://skills.example.internal
```

按创建/读取 → 写入 → 自动 CI 逐步启用。生产必须 HTTPS；可信 TLS 反向代理可配置 SKIVA_GIT_TRUST_PROXY=true，并由代理覆盖 X-Forwarded-Proto，禁止绕过代理直连后端。/git/ 应直达 Go 服务，不经 Next.js BFF；参考 deployments/nginx-git.conf。

本地开发仅可显式开启 SKIVA_GIT_ALLOW_LOOPBACK_HTTP=true；生产环境忽略此例外。公开 URL 只用于展示，不接受请求提供的磁盘路径。

关闭 WRITE_ENABLED 立即拒绝新的推送；关闭 AUTO_CI_ENABLED 暂停事件入队；关闭 ENABLED 隐藏能力并停止 Git 入口。保留数据库列、bare 仓库和事件，修复后恢复开关。已入队任务继续按固定 SHA 运行，既有 Distribution/发布内容保持可读。不执行破坏性 Down migration。

源码位于 SKIVA_DATA_DIR/managed-git/<storage-id>.git；持久事件位于 git-spool/。必须和数据库、objects/、配置/密钥引用一起备份。备份前停止写入与 Worker；使用 scripts/backup.sh。恢复到全新数据库/目录后执行 scripts/restore.sh，它校验 CAS 与托管仓库 git fsck。再验证 Git fetch/push、重建、快照内容、授权终端读取。不要仅凭文件数量判定恢复成功。旧软删除仓库物理数据默认保留，不自动 GC。

post-receive 只原子落盘事件，不运行 CI。Worker 将事件转入数据库/队列，并用 refs/reflog 补偿；不要手动删除 reflogs 或运行破坏性 Git GC。provisioning/failed 元数据也会重试对账。

## 故障排查

- 401：检查是否使用 Git PAT、是否过期/撤销；清理凭据管理器中的旧密码。
- 404：路径不正确、无仓库权限或仓库不存在。接口有意不区分这些情况。
- 403：未使用 HTTPS、写入开关关闭，或仓库停用。
- Push 被拒绝：检查 main/Tag 保护、强推、删除、文件类型和配额；Git 客户端会显示服务端拒绝原因。
- Push 成功但未构建：检查自动 CI 开关、Trigger Ref、活动页错误与队列积压。其他分支可能仅记录活动。
- 502：进程异常、120 秒超时或输出超限。先 Fetch 确认远端状态，再决定是否重试 Push。
- 507：磁盘空间/全局配额不足。优先保留已发布制品读取，扩容后恢复推送。
- 创建失败：检查卷权限、磁盘、Git 可执行文件；修复后 Worker 重试，不能删除已有逻辑 ID 来规避错误。

监控 /metrics 中的 git_http_requests_total、git_receive_bytes_total、git_push_rejected_total、git_ref_event_pending、git_ref_reconcile_lag_seconds、git_process_duration_seconds_* 和 managed_repository_provision_failures_total；定期低峰执行 make verify-artifacts 检查 CAS 和 git fsck。

真实企业 IdP、目标 TLS 代理、生产 Linux FUSE + Agent 沙箱、目标容量负载和磁盘/断电故障演练仍是生产上线门禁。开发机和 CI 的自动化结果不等于已通过生产验收。
