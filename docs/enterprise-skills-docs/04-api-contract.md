# 04 · API 与远程分发协议

## 1. 统一规则
HTTPS；JSON 使用 camelCase；UTC RFC3339 时间；UUID 资源 ID。OpenAPI 3.1 作为权威契约并生成 TS SDK。`Authorization: Bearer`；管理端使用 OIDC 登录会话，Go 校验访问令牌及 RBAC；客户端使用限定 Profile 的工作负载凭据（可轮换），不得共享管理员凭据。写入类请求支持 `Idempotency-Key`，返回 `requestId`。

统一错误结构：
```json
{"error":{"code":"RELEASE_CONFLICT","message":"Channel generation changed","details":{"expected":4,"actual":5},"requestId":"..."}}
```
HTTP: 400 参数、401 未认证、403 禁止、404 隐藏或不存在、409 版本冲突、422 校验失败、429 限流、503 下游不可用；401/403 不用缓存。

## 2. 管理 API（`/api/v1`）
| Method | URI | 描述 / 权限 |
|---|---|---|
| GET | `/me` | 当前用户/权限 |
| GET/POST | `/repositories` | 列表/新建，Maintainer+ |
| GET/PATCH | `/repositories/{id}` | 详情/修改，Maintainer+ |
| POST | `/repositories/{id}/test-connection` | 测试连通及凭据 |
| POST | `/repositories/{id}/sync` | 手动入队并返回 runId |
| POST | `/webhooks/{provider}/{repositoryId}` | 验签后的系统 Webhook |
| GET | `/skills?query=&repoId=&page=` | Skills 列表 |
| GET | `/skills/{id}` | Skill 详情及 metadata |
| GET | `/skills/{id}/versions` | 版本历史 |
| GET | `/skill-versions/{id}/tree` | 目录树，路径安全校验 |
| GET | `/skill-versions/{id}/file?path=` | 只读文件预览 |
| GET | `/skill-versions/{id}/diff?against=` | Diff |
| GET | `/pipelines?repoId=&status=` | 流水线列表 |
| GET | `/pipelines/{id}` | 步骤与诊断 |
| POST | `/pipelines/{id}/retry` | 失败重试（新 attempt） |
| POST | `/releases/preview` | 版本集合冲突/依赖/变更预览 |
| POST | `/releases` | 创建不可变 Snapshot |
| GET | `/releases/{id}` | Snapshot 详情 |
| GET | `/channels` | stable/canary 列表 |
| POST | `/channels/{id}/promote` | 原子推进 |
| POST | `/channels/{id}/rollback` | 原子回滚，reason 必填 |
| GET/POST | `/agent-profiles` | 列表/创建 |
| GET/PATCH | `/agent-profiles/{id}` | 关联 Channel/Skills |
| GET/POST | `/mount-clients` | 列表/注册 |
| POST | `/mount-clients/{id}/rotate` | 凭据轮换 |
| POST | `/mount-clients/{id}/revoke` | 吊销客户端 |
| GET | `/audit-logs` | 审计检索，Auditor+ |
| GET | `/members` | 成员 |
| POST | `/members/{id}/roles` | 修改角色，Org Admin |
| GET/PATCH | `/settings` | 组织设置，Org Admin |

分页统一 `{items, nextCursor, total?}`；服务端游标而非无限 OFFSET；管理员筛选、排序必须白名单。

## 3. 发布请求示例
```http
POST /api/v1/channels/stable/promote
Idempotency-Key: 891...
Content-Type: application/json
```
```json
{"snapshotId":"019a...","expectedGeneration":5,"reason":"Verified on canary"}
```
返回：
```json
{"channel":"stable","snapshotId":"019a...","generation":6,"publishedAt":"2026-10-21T04:00:00Z"}
```
同请求幂等返回相同结果；Generation 冲突返回 409。

## 4. 客户端协议（`/distribution/v1`）
- `GET /profile`: 当前客户端可用 Profile、consistencyMode、policy、当前 activeSnapshot/generation。
- `GET /manifest?profileId=...&snapshotId=...`：返回**已授权**快照 Manifest；若省略 snapshotId 则解析当前 channel。
- `GET /objects/{digest}?snapshotId=...`：验证客户端对 snapshot 的授权与对象成员关系后返回内容；`ETag` 为 digest，支持 `If-None-Match`、只读 `Range`。
- `GET /events?profileId=...`：SSE 只发送 generation、snapshotId、eventId，客户端收到后重新读取 manifest；支持 `Last-Event-ID`，但断线后最终以 Profile 拉取为准。
- `POST /clients/heartbeat`：客户端版本、当前 snapshot、已知 generation、缓存规模和简要状态（不上传敏感目录内容）。

Manifest 示例（规范化 JSON/CBOR 可二选一，首发 JSON）：
```json
{
  "schemaVersion":1,
  "snapshotId":"019a...",
  "manifestDigest":"sha256:abcd...",
  "generation":6,
  "profileId":"019b...",
  "files":[
    {"path":"sql-query/SKILL.md","type":"file","size":2172,"digest":"sha256:1234...","mode":292},
    {"path":"sql-query/references/index.md","type":"file","size":4631,"digest":"sha256:5678...","mode":292}
  ]
}
```
`mode=292` 十进制等于 0444。允许受审查的脚本具有只读并可执行的 `0555` 权限；Skill 运行时代码执行与内容发布互不等价。目录通过路径层级推导或显式条目；路径 UTF-8 NFC 规范化，排序稳定；首版禁止 Symlink、设备文件及特殊 inode。

## 5. 客户端缓存语义
- Manifest `Cache-Control: no-cache`，ETag/Last-Modified 可供重新验证；CAS Blob 可设置 immutable + 长缓存，但必须先授权再返回。
- SSE 是提示而不是真相；任何 SSE 丢失，下一轮 Poll 仍得到正确 active generation。
- blob response 的摘要由客户端 SHA256 校验；失败则丢弃并重试，达到上限报损坏。
- 不允许由客户端传入任意文件系统路径供服务端读取，不允许任意 git object ID 跨租户访问。
- 协议兼容：Server 新增字段可忽略，破坏性变更升级 `/distribution/v2` 与 `schemaVersion`。

## 6. Webhook
平台按供应商签名规则验证原始 body、时间窗口、防重放 deliveryId；匹配库内仓库与允许的 ref；先持久化事件及 enqueue，再响应 202。Job 以固定 Commit 执行；重复投递不重复构建；定时 reconcile Git refs 补漏。
