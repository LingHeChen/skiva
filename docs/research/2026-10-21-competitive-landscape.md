# SKIVA 产品重叠与定位初步调研

调研日期：2026-10-21。范围：公开官方文档与项目仓库说明，对照本地实现。未安装竞品、未执行竞品验收测试，也未核实付费版本的实际可用性；“官方描述”不等于已验证的生产能力。本报告分析功能与定位重叠，不判断代码来源或法律意义上的侵权。

## 判断

有实质重叠。Skills 注册、版本、私有分发、安全检查、权限和审计已有直接竞品；FUSE + Skills 也已有实现。不能以这些单项能力宣称首创。

SKIVA 仍可验证一个更窄的方向：为使用多种 Agent 的团队，提供完整 Skill 组合的可控发布与终端版本可见性。现有实现是这一方向的基础，但还没有用户证据证明客户愿意为它增加一套控制台和客户端。

## 主要对象

| 对象 | 已查到的能力及交付方式 | 与 SKIVA 的关系 |
| --- | --- | --- |
| [Skilly](https://github.com/scalefocus/skilly) | 官方列出自托管、不可变版本、beta/stable、回滚、审计和安装凭据；以认证 Git 仓库供 npx skills 安装 | 本轮最接近的开源产品，不能把它视为普通目录网站 |
| [JFrog Skills Registry](https://docs.jfrog.com/ai-ml/docs/skills-registry) | 版本化 Bundle、Xray 检查、策略与 CLI 安装；文档说明扫描仅 SaaS 可用且需启用 | 直接覆盖企业制品与安全治理；客户已有 JFrog 时需优先比较增量价值 |
| [TrueFoundry Skills Registry](https://www.truefoundry.com/docs/ai-gateway/skills/skills-registry) | Skills 继承 Repository 的版本、RBAC 和审计，提供发现、固定版本和 Agent 使用入口 | 企业级 Skills 管理存在直接重叠，不能主张“跨 Agent”即唯一优势 |
| [Google Cloud Agent Registry](https://docs.cloud.google.com/agent-registry/register-skills) | 注册独立 Skills、多个 revision 与默认 revision；页面标记 Preview | 云端注册与版本治理方向的替代方案，实际交付细节需继续验证 |
| [Claude 私有 Marketplace](https://code.claude.com/docs/en/plugin-marketplaces) / [Plugins API](https://platform.claude.com/docs/en/manage-claude/plugins-api) | 私有插件目录、组织分发、版本与组级安装设置 | 单一 Claude 生态客户可能用原生机制满足需求 |
| [Vercel Skills](https://github.com/vercel-labs/skills) | 安装、发现、检查更新和更新 CLI | 安装使用门槛的基准；潜在兼容入口，不应仅当竞争对手 |
| [agentregistry](https://aregistry.ai/docs/skills/publish/) | Skills 版本登记与发布；[pull 文档](https://aregistry.ai/docs/skills/pull/)说明本地拉取方式 | 注册和下载层重叠；文档提醒分支 pull 不等于固定提交，需显式 commit 才可复现 |
| [阿里云 SkillFS](https://www.alibabacloud.com/help/en/alinux/how-to-use-skillfs) / [ANOLISA SkillFS](https://agentic-os.sh/docs/user-guide/runtime/skillfs/) | 面向 Agent 的 FUSE 视图；ANOLISA 文档还描述激活状态与回退快照 | 技术路线有直接重叠。二者作为相关 SkillFS 路线比较，未据此认定发行版完全等同 |
| [CernVM-FS](https://cvmfs.readthedocs.io/en/2.14/cpt-overview/) | HTTP 按需分发、内容寻址、只读文件系统、缓存、版本与原子发布 | 非 Skills 专项竞品，但证明底层分发组合不是新发明 |

JFrog 的 [Skills Repository 文档](https://docs.jfrog.com/artifactory/docs/skills-repositories)将该仓库类型标记为 Open Beta。不要混淆仓库存储能力、扫描能力和运行期执行策略的可用范围。

TrueFoundry 公告页面的 Published / Updated 时间顺序不一致；本报告以产品文档为依据，不以公告时间推断首发先后。搜索没有找到某项能力，不代表对方一定没有。

## 差异需要精确到交付语义

| 问题 | SKIVA 当前实现 | 对比判断 |
| --- | --- | --- |
| 交付的是单个 Skill 还是完整组合？ | 多 Skill 版本组成不可变快照，再推进渠道 | 可作为重点演示，但本轮未证明其他产品无法用插件、包或其他组合表达同一需求 |
| 如何更新客户端？ | Linux FUSE，SSE + 轮询，dynamic / pinned | 与 Git / Bundle 安装的运行方式不同；SkillFS 已覆盖虚拟文件系统路线 |
| 更新会不会改变正在读取的内容？ | 已打开句柄保留旧内容；pinned 固定任务快照 | 有可测试的语义，不应扩大为 Agent 已加载上下文自动刷新 |
| 能知道终端用到哪个版本吗？ | 心跳、Snapshot ID、缓存信息 | 是交付状态观察，尚不是完整的 Skill 调用与模型行为遥测 |
| 撤销凭据能否收回内容？ | 在线授权拒绝；离线按策略；已读取内容无法收回 | 不能宣传成远程抹除用户已复制文件，也不能保证断网即时撤权 |
| 谁能证明发布内容可信？ | SHA 摘要和服务端授权、静态检测 | 摘要完整性不等于发布者数字签名或独立来源证明 |

ANOLISA [文档](https://agentic-os.sh/docs/user-guide/runtime/skillfs/)明确区分 live / fallback / hidden 视图，并说明相应配置场景下不是不可变内容快照。SKIVA 的完整远程快照与任务绑定值得比较，但两者目标范围不同，不能据此宣称全面领先。

## 我们当前的不足

依据本地源码、IMPLEMENTATION_STATUS.md 与验收报告：

- 没有 SCIM 自动入离职、组同步。Skilly 官方描述中已有此类组织身份集成。
- 审计由数据库不可变触发器保护，尚无密码学哈希链或外部签名见证。
- 没有制品签名和发布证明；SHA-256 只解决相应完整性问题。
- 只有静态校验，没有模型效果评测、外部测试结果的强制门禁或多人审批规则。角色分工不等于审批工作流。
- 挂载面向 Linux。主机级 Agent 发现与 Linux FUSE 分别通过，并不等于全平台 Agent 联调通过。
- 需要安装自有客户端和 FUSE；对于只想同步几个文件的团队，这可能是明显负担。
- 尚未完成真实生产负载、企业 IdP 和完整故障矩阵验收，不能用“企业级”措辞替代这些证据。

## 建议的定位与优先级

以下是产品判断，尚未经过客户验证。

建议定位：**面向多 Agent 团队的 Skills 发布与交付管理：固定版本组合，先验证后发布，能观察终端是否收到正确版本。**

1. 先验证发布问题是否真实存在。找到三个有多团队、多 Agent 的使用方，让他们用同一场景比较现有 Git 安装、Skilly 与 SKIVA。
2. 演示 A 新版 + B 原版 + C 原版整体发布、Canary 验证、Stable 推进、终端漂移和回滚，不只演示目录与 CRUD。
3. 优先降低接入成本。评估增加免 FUSE 的拉取/同步方式，保留同一快照与授权模型；明确落盘文件无法持续强制撤权，不能声称与挂载完全等价。
4. 兼容常用安装入口或提供导出，避免要求用户完全迁移生态。
5. 在确认需求后，再补评测报告、强制发布门禁、审批和签名；优先集成外部 CI，不急于自建任意脚本流水线平台。
6. 使用真实任务验证改动收益：首次成功接入时间、发布遗漏率、客户端收敛时间、回滚恢复时间、跨 Agent 成功率、运维成本。

如果客户主要需要公司内的搜索、安装、简单更新，应先评估复用现有产品。只有完整组合、一致性、终端状态和统一发布责任带来可证明的额外价值，继续投入独立平台才更有依据。

## 下一轮实测清单

- 隔离部署 Skilly，使用与 SKIVA 相同的两个 Skills 和两个消费组；比较安装、更新、回滚和撤权边界。
- 对比 SKIVA / SkillFS 的任务中更新、旧句柄、源不可达、离线缓存和挂载运维要求。
- 如目标客户已有 JFrog / TrueFoundry，核实其现有许可证和可用功能，再评估集成而非替换。
- 以上尚未执行；本轮没有改动产品架构或对外发布竞品结论。
