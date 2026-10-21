# 08 · 管理端完整 UX / UI 规范

## 1. 技术与视觉设计
Next.js App Router + TypeScript + shadcn/ui + Tailwind CSS + lucide-react；TanStack Query 管理客户端状态，React Hook Form + Zod 表单校验，OpenAPI 生成 API Client。推荐使用 Inter/系统字体与等宽代码字体、8pt 间距网格，简洁紧凑的企业级信息密度；禁止默认套用廉价“AI 紫色渐变卡片”风格。强调可读性、层次、清晰状态、可解释的风险与审计。

配色建议：中性灰/黑白底，青绿或蓝色作为单一品牌强调色（禁止紫色作为品牌主题）；成功/警告/危险按语义使用。支持 Light/Dark + 系统跟随，配色满足 WCAG AA 对比度；动效 120–220ms，prefers-reduced-motion 下禁用非必要动画；大量日志避免装饰动效。

## 2. 全局导航路由
```
/login                       登录 / SSO
/dashboard                   概览
/repositories                仓库列表
/repositories/new            添加仓库
/repositories/[id]           仓库详情 / Webhook / 配置
/skills                      Skills Registry
/skills/[id]                 Skill 详情
/skills/[id]/versions/[vid]  文件树、SKILL.md 预览、版本 Diff
/pipelines                   CI 列表
/pipelines/[id]              阶段耗时 / 日志 / 诊断
/releases                    历史与创建发布
/releases/new                版本组合预览 / 发布确认
/releases/[id]               Snapshot / 影响范围
/channels                    Stable / Canary 对比与回滚
/profiles                    Agent Profiles
/profiles/[id]               Skill 选择、渠道、挂载说明
/clients                     挂载终端列表
/clients/[id]                状态 / 版本 / 凭据轮换与吊销
/audit                       审计检索
/settings/general            组织设置
/settings/members            成员/角色
/settings/credentials        凭据引用、Webhook secret 管理
/settings/security           安全策略与离线政策
/account                     个人资料与登出
/403                         无权
/not-found                   404
/error                       500 恢复
```

## 3. 导航与通用组件
桌面固定侧栏 + 可折叠；移动端抽屉，顶部全局搜索与用户菜单、通知。通用组件：PageHeader、Breadcrumb、StatusBadge、DataTable、FilterBar、DateRangePicker、ConfirmDialog、DiffViewer、MarkdownPreview（严格清理 HTML）、FileTree、CodeViewer、PipelineStepper、ActivityTimeline、AuditEvent、EmptyState、ErrorState、Skeleton、Toast、CopyButton、HelpTooltip、CredentialRevealOnce、UnsavedChangesGuard。长表格分页或虚拟滚动。勿将 Select 用作复杂的 Skill 多选器，采用带搜索/分组/版本信息的 Command+Popover 或多选列表。

## 4. 逐页交互验收
- Dashboard：指标和最近事件、失败流水线、客户端离线、快捷操作；指标可点击下钻。
- Repositories：创建时 URL/权限校验和测试连接；详情包括最后 Commit、Webhook 配置步骤、最近同步、失败诊断；禁用有影响范围确认。
- Skills：按源、状态、名称搜索；详情展示描述、来源、提交、文件树、只读 Markdown 渲染、版本比较；任何 Markdown HTML 消毒处理。
- Pipelines：列表按状态/时间/仓库过滤，详情纵向阶段时间线，日志可复制、自动滚动可关闭；失败规则指向具体文件。
- Releases：预览选中 Skill 版本的变更/新增/移除，显示受影响 Profiles，确认发布；Stable 必须展示差异和危险操作确认。
- Channels：Stable/Canary 两列或对比表，明确 active snapshot、generation、发布人和时间；历史版本回滚带 reason。
- Profiles：关联 Skills 集合、版本渠道、dynamic/pinned 说明、生成安装指引；检查非法/不可用 Skill。
- Clients：连接状态、最近心跳、当前 Snapshot、缓存信息；提供复制 CLI、轮换时仅一次展示新 Token、吊销确认。
- Audit：可筛选 Actor/Action/Target/时间，展示 before/after Diff，敏感字段自动脱敏。
- Settings：角色分配、SSO 状态、凭据创建/轮换、离线策略、安全校验阈值。账户菜单：个人资料、当前组织、登出。

## 5. 关键交互示意（文本线框）
```
┌──────── Sidebar ────────┬──────────────────────────────────────┐
│ Overview               │ Releases / stable                    │
│ Repositories           │ active: snapshot a8...  gen: 12     │
│ Skills                 │ [Compare Changes] [Promote] [Rollback]│
│ Pipelines              ├──────────────────────────────────────┤
│ Releases ●             │ Skill        current      candidate   │
│ Profiles               │ sql-query    2.1          2.2         │
│ Mount Clients          │ policy       1.0          unchanged   │
│ Audit / Settings       │ [Impact: 8 Profiles] [Diff Details]  │
└────────────────────────┴──────────────────────────────────────┘
```

## 6. 状态规范
每页必须实现：初始 Loading Skeleton、无数据 Empty（带下一步 CTA）、无匹配 Search Empty、成功、权限不足、远端不可达、服务错误、部分数据过期（stale）与重试。所有按钮 loading 防双击，危险操作 confirm。SSE 状态丢失要有“数据可能延迟，点击刷新”；触屏可访问，响应式不只缩小表格。

## 7. 交付给设计/前端的素材要求
Design tokens（颜色/排版/阴影/圆角/间距/动效）、全部路由页面截图/原型、通用组件示意图、重点流程交互 HTML/React 参考、Light/Dark/移动断点示意、异常态、键盘快捷键与无障碍验收。**不能只给 Dashboard mockup 就视为 UI 完成。**
