# 验收证据与边界

[English](ACCEPTANCE.md) · 简体中文

证据来自已交付源码。测试 mock 只用于传输故障和身份提供商控制，不当作生产功能。演示 Registry 由真实本地 HTTPS Git 仓库和 Worker 生成。

## 验证环境

- macOS ARM64、Apple M4、Go 1.26.10、Node 24、Next.js 16.4.2。
- Docker PostgreSQL 17。应用库、集成测试库、迁移和恢复数据库彼此隔离。
- LinuxKit 6.10.14 aarch64、FUSE3、受控 /dev/fuse + SYS_ADMIN 容器。ARM64 原生测试通过，amd64 通过宿主机模拟执行，不等于原生 x86_64 硬件验收。

## 基线场景

| ID | 自动化证据 | 结果 |
| --- | --- | --- |
| E01 | TestE01E02E05E17TreeScan、实际 Git 来源 | 单 Skill 发现通过 |
| E02 | 同扫描套件、双 Skill 演示 | Monorepo 发现通过 |
| E03 | TestIntegrationE03E04E06RealHTTPSGit | Webhook/构建去重通过 |
| E04 | 同 HTTPS Git 测试 | 无 Webhook 的新提交发现通过 |
| E05 | 缺失引用扫描 | 规则/路径诊断通过 |
| E06 | HTTPS Git 校验器版本测试 | 同 SHA 规则升级后重校验通过 |
| E07 | TestIntegrationCanaryOfflineAndCorruption | Canary 不修改 Stable |
| E08 | 发布集成及浏览器交付 | generation/历史/审计通过 |
| E09 | 并发发布 | 一次成功、一次 409 |
| E10 | 发布回滚 | 不重建的历史指针回滚通过 |
| E11 | TestE11DynamicHandles、TestLinuxFUSERealMount | 实际新旧句柄通过 |
| E12 | TestE12Pinned | 显式 repin 前保持固定 |
| E13 | TestE13Offline、TestCacheRestartAndCorruption | 缓存/拒绝策略、重启与持久撤销通过 |
| E14 | API/VFS 撤销测试 | 在线请求及旧句柄权限拒绝通过 |
| E15 | Canary/离线测试软删除来源 | 无 Git 来源仍可读已发布内容 |
| E16 | CAS/分发损坏测试 | 拒绝损坏内容并阻止推进 |
| E17 | 路径、特殊 inode、Secret/资源限制 | 遍历和符号链接拒绝通过 |
| E18 | TestIntegrationRBACOrganizationsPaginationAndIdempotency | 后端 RBAC 与跨组织数据库约束通过 |
| E19 | Playwright 管理套件 | 导航、主题、移动端、重试、权限与空状态通过 |
| E20 | API 与浏览器交付 | 注册/轮换/撤销、一次性令牌与审计通过 |

另验证了 OIDC Authorization Code + PKCE、签名测试 IdP 和错误 audience 拒绝、生产本地登录拒绝、游标分页、事务幂等、Range、不可变审计触发器、规范 manifest 哈希与路径冲突、race 下并发 VFS 访问、只读内核挂载与卸载。

## 执行命令

```bash
make lint test build-server build-mount openapi-generate sqlc-generate
npm run build --prefix apps/web
cd apps/web && SKIVA_DEMO_E2E=1 npx playwright test
GOTOOLCHAIN=go1.26.10 go run golang.org/x/vuln/cmd/govulncheck@latest ./apps/server/... ./apps/mount/... ./packages/...
npm audit --prefix apps/web --omit=dev --audit-level=high --registry=https://registry.npmjs.org
./scripts/test-linux-fuse.sh arm64
./scripts/test-linux-fuse.sh amd64
SKIVA_ADMIN_PASSWORD=... .data/validation-venv/bin/python scripts/contract-check.py
```

基线 Go 单元/集成/race、Profile PATCH 保留字段、审计前后状态、manifest 固定样例和 Schema、TypeScript、ESLint、Go vet、Next 构建通过。当时四个浏览器场景涵盖真实 Git→发布→Canary→Profile→客户端；29 个实际 API 响应通过 OpenAPI 校验。Go 扫描无受影响调用路径（一个依赖报告了未调用漏洞）；当时 npm 生产依赖审计为零。独立库的首次迁移及 00002 回退/重放通过。备份校验、独立恢复及全部三个去重对象完整性检查通过。这些是记录时结果，不代替后续版本检查。

## 性能

本地 test-results/benchmarks.txt 记录 1/100/1000 Skill manifest 和 10/100 并发缓存读取微基准。读取样例只有 3 字节，不代表网络吞吐、大文件延迟或生产 SLO。实际容量规划需服务级负载验证。

## Agent 验证

agent-link.py 验证 Codex、Claude Code、OpenCode 的项目路径读取。Codex CLI 0.163.0 skills/list 和 forceReload、Claude Code 2.1.236 初始化发现、OpenCode 1.19.3 debug skill --pure 通过，均未调用模型。主机发现与 Linux FUSE 测试分别执行，组合沙箱需目标环境验收。

## 仍需外部验收

- 企业 IdP/MFA、实际 SSH/Git 凭据。
- 原生 x86_64、目标内核/容器策略与 Agent 沙箱、已加载上下文行为。
- PostgreSQL 主备故障、磁盘耗尽和生产网络/DNS 故障注入。
- 生产负载、可用性和恢复时间目标，不承诺未经测量的 SLO。
- 服务端镜像和迁移命令后续已本地验证；目标 TLS、企业身份和告警仍需验收。
- 原生 macOS/Windows 挂载未实现，客户端需要 Linux FUSE。

截图和日志在忽略的 test-results/ 中；失败跟踪可能包含临时身份和一次性凭据。

## 功能边界

- 托管 Git 接受来源写入，分发客户端与挂载文件仍只读，见[托管 Git 验收](hosting/ACCEPTANCE.zh-CN.md)。
- 未实现百分比发布、任意脚本 CI、在线编辑器或计费。
- 离线缓存不能保证断网期间即时撤销，Profile 必须明确策略。
- 工作负载凭据仅展示一次并保存哈希；幂等重放不重显，丢失需轮换。
- 列表获取全部游标页后本地筛选分页，大规模 Registry 需要实测内存/延迟。
- 发现、校验和产物阶段共享一次扫描，时间重叠，不应相加。

## 本地 Pydantic AI 试点

真实模型通过 ARM64 Linux FUSE 读取托管 Git Skill，两次本地运行覆盖初始内容、动态更新、固定版本、回滚和撤销。模型在 macOS 宿主机，工具读取容器挂载，不证明所有沙箱或长期上下文缓存。见[示例](../examples/pydantic-agent/README.zh-CN.md)。

[预生产模板](../deployments/preproduction/README.zh-CN.md)提供单机 Compose、文件 Secret 和迁移命令。本地检查不替代生产负载、恢复和身份提供商验收。
