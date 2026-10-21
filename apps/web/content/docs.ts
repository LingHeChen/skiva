export type DocPage = {
  slug: string;
  title: string;
  description: string;
  group: string;
  body: string;
};

export const docs: DocPage[] = [
  {
    slug: "",
    title: "让 Skills 从提交走到交付",
    description:
      "从第一次发布，到可控更新。把团队的 Skills 变成可以验证、分发和回滚的能力。",
    group: "开始使用",
    body: "## 一条完整的交付路径\n\nGit 是内容来源。平台校验固定提交，保存不可变版本，再通过渠道将完整快照交付给 Agent。\n\n**提交 Git → 流水线校验 → Skill 版本 → 发布快照 → Canary 验证 → Stable → Agent**\n\n构建成功不会自动上线；创建快照也不会修改渠道。只有推进渠道，跟随该渠道的客户端才会发现新版本。\n\n## 从哪里开始\n\n| 你想做什么 | 阅读指南 |\n| --- | --- |\n| 第一次操作平台 | [快速上手](/docs/quickstart) |\n| 理解版本、快照和渠道 | [核心概念](/docs/concepts) |\n| 发布、更新或回滚 Skills | [发布与更新](/docs/releases) |\n| 配置扫描目录和校验规则 | [流水线配置](/docs/pipelines) |\n| 让 Agent 使用发布的内容 | [客户端与 Agent](/docs/clients) |\n| 管理权限和凭据 | [权限与安全](/docs/security) |\n| 部署、备份和排查问题 | [部署与排障](/docs/operations) |\n\n## 当前支持范围\n\n管理端、Git 静态校验、不可变发布、Canary / Stable、Profile 授权和 Linux 只读 FUSE 挂载已实现。流水线不执行仓库脚本；原生 macOS / Windows 挂载属于后续里程碑。\n\n> 这份手册描述当前实现。Agent 的内部上下文缓存与文件系统更新是两件事；切换文件版本后，仍可能需要重新加载 Skills 或开启新任务。",
  },
  {
    slug: "quickstart",
    title: "完成第一次发布",
    description: "沿着现有演示仓库走一遍，理解每一步为什么需要确认。",
    group: "开始使用",
    body: "## 开始前\n\n打开 [管理控制台](/dashboard) 并登录。自建环境的管理员邮箱与密码由部署配置决定。本地首次启动方式见 [部署指南](/docs/operations)。\n\n如果列表里已有 enterprise-demo，可以直接使用其中的 sql-query 和 code-review。没有演示数据时，先按下一节接入自己的 Git 仓库。\n\n## 1. 接入并同步仓库\n\n进入 [Git 仓库](/repositories)，添加仓库地址、凭据引用、默认 Ref（例如 refs/heads/main），并设置 Skill 根目录 skills。私有 Git 主机必须符合部署的允许列表和网络策略。\n\n先测试连接，再执行同步。在 [流水线](/pipelines) 查看结果；失败时按诊断中的文件、规则和行号修复，提交后重新同步。\n\n## 2. 查看候选版本\n\n进入 [Skills Registry](/skills)，确认名称、描述、来源提交和文件树。打开 SKILL.md，检查引用文件是否完整。\n\n校验成功只说明候选内容已准备好，此时不会修改线上渠道。\n\n## 3. 创建完整快照\n\n进入 [创建发布](/releases/new)，勾选本次需要交付的全部 Skills，并选择各自版本。点击“预览完整视图”，审阅警告和影响范围，再创建不可变快照。\n\n> 快照是完整集合，不是补丁。线上若包含 A、B、C，只更新 A 时也要选择 A 新版、B 原版和 C 原版。当前表单需要显式选择完整集合。\n\n## 4. 先推进 Canary\n\n进入 [发布渠道](/channels)，在 Canary 选择刚创建的快照，检查差异、填写原因并确认。记下快照 ID，验证通过后将同一个快照推进 Stable。\n\n## 5. 连接测试 Agent\n\n在 [Agent Profiles](/profiles) 创建测试 Profile：渠道 canary，选择允许访问的 Skills，模式 dynamic。再到 [挂载终端](/clients) 注册客户端，保存仅展示一次的 Token。\n\n按 [客户端指南](/docs/clients) 在 Linux 挂载并接入 Agent。确认文件内容和预期行为后，再推进 Stable。\n\n## 完成标准\n\n- 流水线成功，Registry 中能看到预期提交的版本。\n- Canary 指向新快照，Stable 在确认发布前保持不变。\n- 测试客户端只能读取 Profile 授权的 Skills。\n- 推进 Stable 后，dynamic 客户端的新文件打开看到新内容。\n- [审计日志](/audit) 能找到本次发布记录。",
  },
  {
    slug: "concepts",
    title: "理解版本与交付关系",
    description: "区分六个对象，就能判断一次修改会影响谁。",
    group: "开始使用",
    body: "## 六个核心对象\n\n| 对象 | 它负责什么 | 举例 |\n| --- | --- | --- |\n| Repository | Git 内容来源与同步配置 | 团队 skills 仓库 |\n| Skill Version | 某个 Skill 的不可变内容版本 | sql-query 的新查询规范 |\n| Release Snapshot | 一组 Skill 版本构成的完整视图 | A 新版 + B 原版 + C 原版 |\n| Channel | 指向某个快照的可变发布入口 | canary、stable |\n| Agent Profile | 选择渠道、允许的 Skills、模式与离线策略 | 研发测试助手 |\n| Mount Client | 一个终端的独立身份与凭据 | 构建机上的某个 Agent |\n\n## 为什么需要快照\n\n一个 Agent 可能同时使用多个 Skills。快照把版本组合固定下来，便于复现和整体回滚。相同集合可以去重；创建后不能直接编辑快照内容。\n\n更新时创建新快照，再改变渠道指向。旧快照保留，不依赖 Git 远端继续在线才能读取。\n\n## Profile 决定可见范围\n\n渠道提供版本集合，Profile 从中授权具体的 Skills，客户端只能读取授权文件。Profile 选中的 Skill 如果没有包含在渠道快照中，不会凭空出现。\n\n建议先建立两个 Profile：测试助手跟随 canary，生产助手跟随 stable。它们可以选择不同的 Skill 集合。\n\n## dynamic 与 pinned\n\n| 模式 | 更新行为 | 适用场景 |\n| --- | --- | --- |\n| dynamic | 渠道更新后刷新索引，新打开的文件使用新版本 | 持续运行的交互助手 |\n| pinned | 保持绑定快照，显式 repin 才重新绑定 | 需要任务期间版本稳定的作业 |\n\n旧的打开句柄保留旧内容。dynamic 不保证一个长任务的多次文件打开都来自同一快照；这类任务应使用 pinned。\n\n## 渠道 generation\n\n每次成功推进或回滚渠道，generation 都会递增。平台用它避免两个管理员的发布相互覆盖。遇到并发冲突时刷新页面，重新审阅当前差异后再操作。",
  },
  {
    slug: "releases",
    title: "发布、更新与回滚",
    description: "用 Canary 验证新内容，再把同一个快照交给生产终端。",
    group: "操作指南",
    body: "## 准备 Skill 内容\n\n推荐一个仓库存放多个 Skills：\n\n```text\nrepository/\n├── .skills-platform.yaml\n└── skills/\n    ├── sql-query/\n    │   ├── SKILL.md\n    │   └── references/guide.md\n    └── code-review/\n        └── SKILL.md\n```\n\nSKILL.md 示例：\n\n```markdown\n---\nname: sql-query\ndescription: 分析数据库结构并编写只读查询。\n---\n\n查询前先阅读 [查询规范](references/guide.md)。\n```\n\n将 SKILL.md 与引用文件一起提交。平台不跟随符号链接，也不会自动递归 submodule。\n\n## 更新一个已有 Skill\n\n1. 在 Git 中修改内容，commit 并 push 到仓库配置的 Ref。\n2. Webhook 触发同步，或在仓库页面手动同步；后台每分钟还会定期检查。\n3. 在流水线查看诊断，在 Registry 查看新版本和文件 Diff。\n4. 创建完整快照：更新目标 Skill，其他 Skills 保持原版本。\n5. 推进 Canary，检查测试终端文件和 Agent 行为。\n6. 将同一个快照推进 Stable，填写发布原因。\n\n> 仅修改仓库配置或校验规则，可能重新校验同一个提交。内容没有变化时，不一定产生一个新的 Skill 内容版本。\n\n## 发布前检查\n\n- 完整集合中是否误删了其他 Skills？\n- 相对引用文件是否齐全？\n- 安全警告是否已审阅？Blocker 必须先修复，不能通过勾选绕过。\n- 受影响的 Profiles 是否符合预期？\n- 是否有 pinned 客户端需要安排任务间重新绑定？\n\n## 回滚到历史快照\n\n在渠道页面查看历史，选择该渠道曾经使用的目标快照，填写回滚原因并确认。回滚会创建新的历史记录和 generation，不会重新构建 Git。\n\ndynamic 客户端跟随回滚后的渠道；pinned 客户端仍保留绑定快照，需要在任务之间显式 repin。已读入 Agent 上下文的内容不会因为回滚自动消失。\n\n## 如何确认更新已到达\n\n在挂载终端页面检查最近心跳和 Snapshot ID；在客户端运行 status。需要主动刷新时运行 refresh。SSE 提供更新提示，轮询负责兜底，因此不承诺所有终端瞬时切换。\n\n```bash\nskills-mount status\nskills-mount refresh\n# pinned：仅在任务之间执行\nskills-mount refresh --repin\n```\n\n如果挂载使用了自定义 --cache，这些控制命令也要传相同的 --cache。",
  },
  {
    slug: "pipelines",
    title: "配置你的流水线",
    description: "配置扫描范围和校验策略，了解固定流水线与外部 CI 的分工。",
    group: "操作指南",
    body: "## 当前流水线能做什么\n\n平台使用固定阶段：安全拉取 Git、发现 SKILL.md、静态校验、保存内容与版本。构建绑定固定 Commit SHA，Webhook、手动同步和定期检查都进入相同任务队列。\n\n目前不提供任意步骤编排、Shell 执行或自定义测试插件。仓库里的 scripts 可以被检查，但平台不会执行它们。\n\n## 仓库配置文件\n\n在仓库根目录提交 .skills-platform.yaml：\n\n```yaml\nversion: 1\n\nskills:\n  root: skills\n\npipeline:\n  trigger:\n    branches:\n      - main\n\nvalidate:\n  blockScripts: true\n  blockExternalLinks: true\n```\n\n| 配置 | 当前行为 |\n| --- | --- |\n| version | 当前只接受 1 |\n| skills.root | 指定扫描目录，覆盖仓库页面配置的根目录 |\n| pipeline.trigger.branches | 校验配置的分支是否在允许列表中 |\n| pipeline.trigger.tags | 默认 Ref 指向标签时校验允许的标签 |\n| validate.blockScripts | 阻断检测到的脚本内容 |\n| validate.blockExternalLinks | 阻断检测到的外部链接 |\n\n分支与标签精确匹配，例如 main 或 refs/heads/main；不支持 release/* 通配符。列出多个分支不会自动创建多分支监听；实际同步目标仍由仓库默认 Ref 决定。不匹配会产生配置诊断。省略相应列表表示不额外限制该类型的 Ref。\n\n未知字段会被拒绝，不能在配置中添加 steps 或 run 来执行命令。\n\n## 组织级校验策略\n\n在 [安全设置](/settings/security) 配置单文件大小、总大小和文件数上限，以及脚本和外链策略。默认资源限制为单文件 8 MiB、总大小 64 MiB、10,000 个文件；树扫描的资源限制可能覆盖所取仓库树中的文件，应保持仓库精简。\n\n仓库配置只能收紧组织策略，不能用 false 解除组织级阻断。静态检测不能保证内容绝对安全；发布者仍需要审阅警告。\n\n## Webhook 与定期检查\n\n在仓库详情查看 Webhook 地址和配置步骤。支持 GitHub、GitLab、Gitea，通过对应签名或共享令牌验证来源，并按 delivery ID 去重。\n\nWebhook 丢失时，后台每分钟检查远端；没有新提交或有效配置变化时，构建会去重。Git 凭据失效会影响后续同步，已发布快照仍可读取。\n\n## 如何加入测试或模型评测\n\n将自定义测试放在独立的外部 CI，检查通过后把批准的提交合并到平台跟踪的分支，再由本平台校验和交付。\n\n```text\n功能分支 → 外部 CI 测试 / 评测 → 合并 main\n         → 平台同步与静态校验 → Canary → Stable\n```\n\n当前平台没有实现对外部 CI 结果的强制发布门禁。若要求必须通过评测才能合并，需要在 Git 服务侧设置分支保护与必需检查。\n\n## 读懂失败诊断\n\n诊断提供 ruleId、严重度、文件路径、行号和说明。Blocker 修复后提交重试；Warning 需要审阅后才能确认发布。Git 拉取失败可能只有仓库同步任务错误，因为此时尚未解析出可构建的提交。\n\n发现、校验和内容写入在同一次静态扫描中完成，界面对应阶段时间可能重叠，不应相加当作总耗时。",
  },
  {
    slug: "clients",
    title: "连接客户端与 Agent",
    description: "让终端通过只读目录读取被授权的 Skills。",
    group: "操作指南",
    body: '## 创建 Profile 和终端身份\n\n先创建 Profile，选择渠道、Skills、dynamic 或 pinned 模式和离线策略。确保渠道已有可用快照。注册挂载终端时选择该 Profile，保存仅展示一次的 Token；丢失时轮换，平台不会再次显示原值。\n\n每个终端使用独立凭据。模式由服务端 Profile 决定，客户端不能自行切换渠道或扩大权限。\n\n## 在 Linux 上挂载\n\n需要 Linux FUSE 环境、可访问的 /dev/fuse 和相应挂载权限。将对应架构的 skills-mount 可执行文件放入 PATH。当前原生 macOS / Windows 挂载不在已交付范围内。\n\n以下为 dynamic Profile 的示例，将域名和 PROFILE_ID 替换为真实值；Token 保存到本地 client.token 文件：\n\n```bash\nchmod 600 client.token\nskills-mount login \\\n  --server https://skills.example.internal \\\n  --token-file client.token\n\nskills-mount mount \\\n  --profile PROFILE_ID \\\n  --mode dynamic \\\n  --path "$HOME/agent-skills"\n```\n\nmount 在前台运行；从另一个终端执行 status、refresh 或 unmount。每个同时运行的挂载使用不同 --cache 目录，控制命令也要传入对应 --cache。\n\n## 接入 Agent 的项目目录\n\n在平台项目根目录运行适配脚本，将已挂载目录链接到目标项目：\n\n```bash\npython3 scripts/agent-link.py \\\n  --source-mount-path /srv/agent-skills \\\n  --project /workspace/my-project \\\n  --agent codex\n```\n\n| Agent 参数 | 项目搜索目录 |\n| --- | --- |\n| codex | .agents/skills |\n| claude | .claude/skills |\n| opencode | .opencode/skills |\n\n脚本拒绝覆盖已有路径，也不修改全局 Agent 配置。沙箱不允许符号链接时，可在允许的搜索目录直接挂载，或由管理员配置只读 bind mount。\n\n## 日常控制命令\n\n```bash\nskills-mount status\nskills-mount refresh\n# pinned 任务结束后才重新绑定\nskills-mount refresh --repin\nskills-mount unmount --path "$HOME/agent-skills"\n```\n\n若 Profile 设置了固定 pinnedSnapshotId，需要先调整该服务端绑定，客户端 repin 才能切换到新的授权目标。\n\n## 离线与撤权\n\n- deny_on_disconnect：授权租约到期后拒绝读取，适用于敏感内容。\n- allow_cached：断网时可以继续读取已缓存且验证通过的内容，未缓存内容无法凭空读取。\n- 在线发现凭据撤销后停止授权读取；断网期间无法保证即时发现撤销。\n\n缓存不会提前下载所有内容。首次使用前若需要离线，应先实际读取所需文件，并验证断网行为。\n\n## 文件更新不等于上下文更新\n\ndynamic 保留旧文件句柄，新的 open 使用新索引；pinned 固定任务快照。Agent 还可能维护自己的 Skills 索引或提示词缓存，需要重新加载或开启新会话。\n\nCodex、Claude Code、OpenCode 的主机级 Skill 发现已做过验证，Linux FUSE 也单独验证过；具体 Linux Agent 沙箱组合仍需在部署环境联调。',
  },
  {
    slug: "security",
    title: "权限、凭据与发布责任",
    description: "把维护、发布、客户端管理和审计分配给适当的成员。",
    group: "参考与运维",
    body: "## 角色分工\n\n| 角色 | 主要职责 |\n| --- | --- |\n| org_admin | 组织管理、成员与策略配置 |\n| repo_maintainer | 仓库维护、同步与构建诊断 |\n| release_manager | 创建快照、推进和回滚渠道 |\n| agent_manager | 管理 Profiles 与终端凭据 |\n| auditor | 阅读审计记录 |\n\n成员可分配多个角色。服务端会检查权限，不能仅依赖前端按钮是否显示判断授权范围。\n\n## 三种不同的身份\n\n管理端会话用于人员操作；Git 凭据用于读取来源仓库；客户端 Token 用于读取 Profile 授权内容。不要混用它们。\n\nGit 凭据通过受保护的环境变量或部署 Secret 注入，管理页面保存引用。仓库地址里不要嵌入用户名密码。Webhook 使用单独的 Secret 引用。\n\n## 客户端 Token\n\n注册或轮换时仅返回一次明文，数据库存储哈希。若响应丢失，幂等重放不会重新显示 Token，应轮换后重新配置终端。客户端凭据有有效期，应监控并安排轮换。\n\n吊销后不能继续刷新授权。离线读取遵循 Profile 策略；允许离线缓存与断网即时撤权不能同时保证。\n\n## 生产登录\n\n生产模式使用 OIDC，禁止本地密码登录。管理员预先创建成员并分配角色，用户通过已验证的企业邮箱完成首次身份绑定。MFA 在企业 IdP 配置。\n\n## 审计与发布确认\n\n在 [审计日志](/audit) 按 Actor、Action、Target 和时间检索。重要更新记录前后状态，发布与回滚记录原因和渠道变化。\n\n发布渠道采用并发控制；遇到冲突，刷新后重新审阅。不要通过直接修改数据库来绕开发布事务或审计。",
  },
  {
    slug: "operations",
    title: "部署、维护与排障",
    description: "从本地启动到常见问题，找到下一步可执行的操作。",
    group: "参考与运维",
    body: "## 本地启动\n\n准备 Docker、Node 24、Git 和 Python 3。Makefile 使用 Go 1.26.10 工具链。在项目根目录执行：\n\n```bash\ncp .env.example .env.local\n# 编辑 .env.local，设置独立的管理员密码（至少 14 字符）\nchmod 600 .env.local\nmake deps\nmake dev\n```\n\n默认管理端端口 3000，API 8080，PostgreSQL 55432。若 3000 已占用，在配置中同时设置 ESDP_WEB_PORT 和 ESDP_WEB_ORIGIN。当前开发工作区预览使用 3001。\n\n## 生产部署检查\n\n配置 TLS、PostgreSQL 与内容目录持久化、OIDC、Git 主机允许列表、Secret 引用和备份。迁移数据库后再启动 API / Worker。部署模板位于 deployments/compose.yaml 和 deployments/docker/。\n\n/distribution/ 请求应直接转发到 Go 服务；/metrics 只对监控网络开放。Docker 基础镜像下载曾在开发环境停滞，镜像构建仍需在实际部署环境完成验证。\n\n详细安装、OIDC、SSH、备份恢复说明保存在项目 docs/OPERATIONS.md。\n\n## 备份与恢复\n\n备份需要同时包含数据库和 Git / CAS 数据目录。先停止 API / Worker 写入，再运行备份脚本，保证恢复点一致；将备份放在受保护且不位于数据目录内的位置。\n\n```bash\n# 先配置数据库连接、数据目录和备份目录\nexport ESDP_BACKUP_DIR=/secure-backups/esdp\n./scripts/backup.sh\n```\n\n恢复应使用新的空数据库和数据目录，按运维手册校验备份校验和与全部引用对象后再切换服务。不要用生产库执行测试迁移回滚。\n\n## 常见问题\n\n| 现象 | 检查顺序 |\n| --- | --- |\n| Git 连接失败 | 地址与 Ref → 允许列表 / DNS → Secret 引用 → CA 或 SSH known_hosts |\n| 同步后没有新版本 | 流水线诊断 → 来源 Commit → 内容是否实际变化 → 扫描目录 |\n| 构建成功但客户端未更新 | 是否创建新快照 → 是否推进正确渠道 → Profile → dynamic / pinned |\n| 某个 Skill 消失 | 快照是否包含该 Skill → Profile 是否授权 |\n| Blob 返回 403 | 客户端身份 → Profile → 快照授权 → 文件成员关系 |\n| Blob 返回 503 | 对象是否缺失或损坏，运行完整性巡检 |\n| 发布返回 409 | generation 是否已被其他发布修改，刷新并重新确认 |\n| 挂载目录变了但 Agent 没变 | Agent 索引、已加载上下文、旧句柄或 pinned 模式 |\n| Token 丢失 | 轮换凭据，重新登录客户端 |\n\n## 验证与巡检\n\n```bash\nmake test-db\nmake lint test build\n# 配置正确的 ESDP_DATABASE_URL 和 ESDP_DATA_DIR 后巡检\nmake verify-artifacts\n```\n\n测试库与应用库必须分开。维护命令、验收证据和部署边界分别见项目 docs/OPERATIONS.md、docs/ACCEPTANCE.md 和 IMPLEMENTATION_STATUS.md。生产 SLO、企业 IdP 与真实网络故障恢复需要部署环境验收。",
  },
];

export const docHref = (slug: string) => (slug ? `/docs/${slug}` : "/docs");
