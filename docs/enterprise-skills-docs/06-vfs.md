# 06 · Remote VFS 客户端与一致性

## 1. 目标与非目标
目标：已授权客户端只需执行一次挂载配置，通过标准文件系统调用访问指定 Profile 的 Skills；服务端发布后，dynamic 模式在缓存同步后对新的 lookup/open 可见。客户端不执行 Git、不自行拉 Git 仓库、不写远端目录。
非目标：全量 POSIX、客户端上传/修改、所有第三方 Agent 立即热重载内存上下文、跨多次 open 的 dynamic 会话强一致。

## 2. Go Client 模块
`cmd/skills-mount` CLI；`pkg/protocol` 生成的 HTTP 客户端；`internal/mountfs` 实现 Getattr/Readdir/Open/Read/Release/Readlink（首版拒绝 symlink）；`cache` CAS 本地磁盘 + 内存元数据；`updater` SSE/轮询；`auth` 设备工作负载凭据；`platform` Linux FUSE + 未来 Windows/macOS 驱动适配。

CLI 草案：
```bash
skills-mount login --server https://skills.example.internal
skills-mount mount --profile development-agent --channel stable --path ~/agent-skills --mode dynamic
skills-mount status
skills-mount refresh
skills-mount unmount --path ~/agent-skills
```
`--channel` 只能在 Profile 允许的范围内使用；服务端 Profile 绑定是权威来源。非交互容器使用短期工作负载令牌/密钥文件，禁止 CLI 将令牌写入日志。

## 3. 版本树与句柄
VFS 内部维护 `AtomicReference<DirectoryIndex>`（Go `atomic.Pointer` 或 RW lock），每个 `DirectoryIndex` 对应不可变 `snapshot_id`。 `Open` 将 inode/path 解析成 `(snapshot_id,digest)`，保持 handle 引用，`Read` 始终读取同一 Blob。目录枚举如果被跨版本更新打断，返回一致的目录快照索引，不原地修改结构。

`dynamic`：发现新 Manifest 后准备完整目录索引，在检查 Manifest Digest、必要文件有效性后交换引用；已打开句柄仍读旧内容。**不同时间先后打开的多个文件可能跨版本**。缓存失效要考虑内核 dentry/attr；切换后调用平台允许的 invalidate notification，或使用短 TTL 并告知延迟上界。

`pinned`：启动挂载时请求指定 Snapshot（或由运行时启动器选定）；直到显式 re-pin 都不切换路径视图。同一次 Agent Task 的强一致性只有在其运行上下文确定并使用 pinned mount 时成立。

## 4. 内容缓存
- 本地 CAS Key=`sha256`；落盘采用 temp-file + fsync + atomic rename，下载完成后核验 Hash/Size。
- Manifest Metadata 单独保存 snapshot/generation/ETag/time；索引切换采用内存原子交换，重启可以加载最后已验证快照。
- 读取缓存未命中：可从 `/objects/{digest}?snapshotId=...` 下载，避免重复下载；支持并发请求折叠、限速与指数退避。
- 释放旧 handle 后旧 Snapshot 可进入候选 GC；不删仍被 pinned/活跃 handle 使用的 Blob。
- 文件读取高频：分发服务不逐次调用 Git 命令；CAS 可用只读 mmap/stream，避免内存全文件加载。

## 5. 离线/撤权策略
`allow_cached`：断线后可读取已验证缓存（只适合非敏感 Skills），缓存缺失报网络错误；旧授权令牌撤销在断线时无法即时生效。`deny_on_disconnect`：授权/租约超时后拒绝所有读取（敏感 Profile 默认）。在线收到 401/403/撤销事件必须清除当前授权并停止读取；磁盘缓存的敏感数据是否擦除由企业政策决定。禁止无限期离线+即时吊销的互斥承诺。

## 6. 首发平台与环境
Linux：FUSE3，运行在宿主机或具备受控 FUSE 权限的环境；避免默认向普通 Kubernetes Pod 提供 `--privileged`。Mac：需 macFUSE 安装与签名策略；Windows：需 WinFsp 与可交付安装包，能力在测试通过前标记实验性。无 FUSE 权限的企业容器可采用宿主机预挂载、CSI 适配或本地只读同步 fallback，但这属于单独兼容路径，不能假定全环境透明挂载。

## 7. Agent 可发现性
各 Agent 的 Skills 搜索路径与启动缓存行为不同。提供适配器配置：`source_mount_path` + `agent_skills_path`（可选 symlink/目录绑定）。文档需逐项验证 Codex、Claude Code、OpenCode 的目录识别、软链接、安全沙箱和运行时缓存，而不能只以挂载成功作为兼容验收。

## 8. 失效场景
Manifest 可用、Blob 不可用→保留旧视图/文件缺失报 EIO，决不返回错误内容；网络间断→退避/状态提示；新的发布被撤回→新 Manifest 发布回退指针；本地缓存损坏→重拉；授权失效→不继续访问在线新 Blob；客户端版本不兼容→明确报协议错误。
