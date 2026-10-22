# SDK 与服务端运行语义

[English](SDK_RUNTIME.md) · 简体中文

## 公开接口

`client.bind()` 默认跟随当前授权目标，每次访问检查更新；`client.snapshot()` 固定进入时的目标；`client.snapshot(id)` 按业务 ID 记住并复用快照；`client.snapshot(source=ref)` 指定实际快照引用。`task(id)` 仅为别名，底层 `consistency="pinned"` 保留兼容。服务端 Profile 的 pin 决定目标选择，与客户端视图的生命周期是两个维度。

Python SDK 0.3.0 改动已提供源码，尚未发布至 PyPI。用法与 Pydantic AI 的 `SnapshotView` 依赖示例见 SDK README。

## 持久化与恢复

默认绑定只保存在一个 client 中。可选 `SQLiteBindingStore(path, namespace=...)` 将引用保存在本地磁盘，支持跨实例、进程和重启恢复。发布时原子比较更新，避免覆盖并发改动；它不是任务执行锁或分布式调度器。已打开视图保持不变，清理前需要与其他执行协调。本地 SQLite 不用于多主机网络文件系统。绑定不会自动淘汰或过期，也不授予权限。

## 授权与暂时故障

凭据缺失、过期、Profile 禁用或撤销返回 403 `CLIENT_FORBIDDEN`；数据库故障返回 503 `DISTRIBUTION_UNAVAILABLE`，附带 `Retry-After: 1`，由应用决定重试边界。SSE 在数据库故障时发出 `unavailable` 并关闭以便重连；只有确实拒绝凭据时才发出 `revoked`。响应不暴露数据库细节。已交付的 Skill 或模型上下文无法撤回。

成功认证的请求最多每 30 秒更新一次活动时间，普通 SDK 请求也能显示在线。这表示请求活动，不保证 Agent 任务健康；不会伪造挂载缓存指标或上报快照。

## 历史授权保留

运行新版服务端前执行 `00004_snapshot_grant_retention.sql` 迁移。可选 `SKIVA_SNAPSHOT_GRANT_TTL_SECONDS`：不配置或 0 保持历史授权无限期；正整数（最大 315360000）使新授权从首次授权时起按固定期限有效，后续读取不会续期。已有无限期授权不会追溯缩短。无效配置返回 503，拒绝发放授权。

过期的历史授权会拒绝清单与对象读取。当前通道目标、Profile 配置的固定目标仍可访问并重新授权。因此它是历史版本保留策略，不是对某个发布的管理封禁。回滚不会撤销此前授权；停止后续读取可以移除 Profile 的 Skill 权限或撤销客户端凭据。不会自动回收授权记录、删除快照或撤回导出文件。SDK 持久化绑定遇到授权过期时明确失败，不改用最新版本。

## 保持在线授权的性能优化

SDK 使用有界元数据缓存发送 `If-None-Match`。服务器在返回 304 前仍检查授权与当前权限过滤后的清单。ETag 包含快照 ID、清单摘要与通道 generation，避免相同内容的不同快照被混淆。对象授权改用 SQL 成员查询，无需每个文件都重新生成完整清单，仍检查当前 Profile 权限。这减少重复工作；尚未通过基准测试量化吞吐提升。

## 真实联调验证

`TestPythonSDKDistribution` 启动实际 Go 路由，通过 PostgreSQL 和已安装的 Python SDK 发起 HTTP 请求，覆盖发布、更新、回滚、固定引用重试、权限移除、在线状态、凭据轮换及撤销。`TestDistributionDatabaseFailureIsTransient` 检查数据库故障与 SSE 分类；`TestSnapshotGrantRetention` 检查 304 前授权与历史授权到期。CI 检出 SDK 仓库并运行联调。执行方式见英文版中的本地命令；需设置 SDK Python 路径与测试数据库。

SDK 的故障模拟与真实 Pydantic AI FunctionModel 测试继续提供补充覆盖。未声称验证外部模型服务或多主机持久化。
