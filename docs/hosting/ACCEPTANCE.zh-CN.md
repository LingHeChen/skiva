# 托管 Git 验收记录

[English](ACCEPTANCE.md) · 简体中文

记录日期：2026-10-21。功能增量实现，生产上线仍取决于目标部署环境。

| 阶段 | 本地执行证据 |
| --- | --- |
| M0 基线 | 原 Go race 测试通过，迁移前备份本地数据库与完整数据卷 |
| M1 兼容 | 00003 正向迁移已有数据的应用库与测试库，保留 external 记录，原 Go/API/浏览器交付回归通过 |
| M2 准备仓库 | 创建、幂等重放、文件系统失败重试、原子重命名后恢复、软删除保留来源、拒绝来源类型转换 |
| M3 传输 | 可信测试 CA 下真实 HTTPS clone/fetch/push；明文 loopback 仅限显式开发开关；匿名、无效/撤销/过期/会话 Token、scope、成员降权与非成员检查；main 保护、强推/删除、tag、原子多 Ref 拒绝、符号链接、超大对象和无效路径 |
| M4 CI | 顺序 A/B 推送记录与固定 SHA 构建；去重；丢失 spool 通过 refs/reflog 恢复；保留发布 CAS/回滚/客户端兼容 |
| M5 控制台/文档 | 7 个浏览器场景，涵盖创建、历史/文件/diff、Token 签发/隐藏/撤销、策略和手机；当时 9 篇文档；静态子路径导航 |
| M6 恢复 | 数据库和完整数据恢复到独立位置，CAS 摘要与 git fsck，通过恢复后的 clone/fetch/push → 固定 SHA 构建 → Canary 快照 → Profile → 授权 manifest/blob 哈希校验 |
| 现有客户端 | Linux ARM64 FUSE 内核测试及 Go mount/protocol race 测试通过 |

复现命令：

```bash
make test-db
make lint test build-server openapi-generate sqlc-generate
npm run build --prefix apps/web
SKIVA_MANAGED_GIT_ENABLED=true SKIVA_DEMO_E2E=1 make test-e2e
npm run build:docs --prefix apps/web
npm run test:docs --prefix apps/web
make contract-check verify-artifacts
./scripts/test-linux-fuse.sh arm64
# 仅在恢复到独立服务之后执行
SKIVA_RESTORE_API_URL=http://127.0.0.1:8082 python3 scripts/verify-managed-restore.py
```

日志保存在忽略的 test-results/hosting-*，测试代码已提交。Docker 锁定 Debian Git 包，服务端 UID 为 10001。CI 包含全新 Docker 构建，镜像下载进度不能作为成功构建证据。

## 仍需目标环境验收

- 企业 IdP/MFA、真实 HTTPS 证书、可信代理及禁止直连后端。
- 生产 Linux 架构、真实 Agent 沙箱、Skill 发现和任务缓存。
- 仓库大小/并发负载、实测 SLO、磁盘满/只读/损坏、断网、数据库故障和进程终止。
- 不支持多节点托管，POSIX 数据卷为单写者。服务端、Git 子进程与 Worker 共用非特权身份；独立网关 UID/容器隔离需单独验收。
- 不提供托管源码物理 GC。软删除保留名称、源码和历史，直到制定明确保留流程。
- Reflog 对账每文件读取上限 8 MiB。事件处理完成前不要过期清除 reflog。Git 响应默认上限 32 MiB。这些是容量限制，不是吞吐保证。

回退时关闭托管/写入/自动 CI 开关，保留新表列与来源卷。Down 迁移拒绝破坏性回退。已有 Distribution 与快照继续通过原协议提供服务。
