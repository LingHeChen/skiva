"use client";
import { useI18n, translate, LanguageSwitch, type Translate } from "@/lib/i18n";

import { BrandLogo } from "./brand";
import { Skeleton as LoadingSkeleton } from "./ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import { Card } from "./ui/card";
import { FormInput } from "./ui/form-input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import {
  Table as ShadTable,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./ui/table";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  BookOpen,
  Box,
  Check,
  ChevronRight,
  Clipboard,
  GitBranch,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sun,
  Moon,
  Terminal,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "./ui/button";
import {
  CommandMenu,
  RepositoryWorkspace,
  PipelineDiagnostics,
  ReleaseSheet,
  ReleaseReview,
  VersionDifference,
  AgentDeliveryOverview,
} from "./workspaces";
import { Badge as ShadBadge } from "./ui/badge";
import { ManagedRepository } from "./managed-repository";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { api, apiList, ApiError } from "@/lib/api";
import { createClient } from "../../../packages/openapi/client";
const links = [
  ["dashboard", "概览", LayoutDashboard],
  ["repositories", "Git 仓库", GitBranch],
  ["skills", "Skills Registry", BookOpen],
  ["pipelines", "流水线", Activity],
  ["releases", "发布快照", Layers],
  ["channels", "发布渠道", ArrowUpRight],
  ["profiles", "Agent Profiles", Box],
  ["clients", "挂载终端", Monitor],
  ["audit", "审计日志", Shield],
] as const;
const labels: Record<string, string> = {
  dashboard: "概览",
  repositories: "Git 仓库",
  skills: "Skills Registry",
  pipelines: "流水线",
  releases: "发布快照",
  channels: "发布渠道",
  profiles: "Agent Profiles",
  clients: "挂载终端",
  audit: "审计日志",
  settings: "组织设置",
  account: "个人账户",
  new: "新建",
  general: "基本设置",
  members: "成员与角色",
  credentials: "凭据引用",
  security: "安全策略",
};
const endpoints: Record<string, string> = {
  repositories: "repositories",
  skills: "skills",
  pipelines: "pipelines",
  releases: "releases",
  channels: "channels",
  profiles: "agent-profiles",
  clients: "mount-clients",
  audit: "audit-logs",
};
function useData(path: string, enabled = true) {
  return useQuery({
    queryKey: [path],
    queryFn: () => apiList(path),
    enabled,
    retry: 1,
    refetchInterval: 30000,
  });
}
function date(v: any, locale: "en" | "zh") {
  return v
    ? new Date(v).toLocaleString(locale === "zh" ? "zh-CN" : "en", {
        hour12: false,
      })
    : "—";
}
function short(v: any) {
  return typeof v === "string" && v.length > 24
    ? v.slice(0, 12) + "…"
    : (v ?? "—");
}
export function Console() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>
  );
}
function Shell() {
  const { t, locale } = useI18n();

  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const section = parts[0] || "dashboard";
  const me = useData("/me", section !== "login");
  const [mobile, setMobile] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [theme, setTheme] = useState("system");
  const [notify, setNotify] = useState(false);
  const [search, setSearch] = useState("");
  const notices = useData("/notifications", !!me.data);
  const router = useRouter();
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setCommandOpen((v) => !v);
      }
      if (event.key === "Escape") {
        setMobile(false);
        setNotify(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const t = localStorage.getItem("skiva-theme") || "system";
    setTheme(t);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme =
      theme === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    localStorage.setItem("skiva-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401)
      router.replace("/login");
  }, [me.error, router]);
  if (section === "login") return <Login />;
  if (me.isPending)
    return (
      <div className="standalone">
        <Skeleton />
      </div>
    );
  if (me.error)
    return <ErrorState error={me.error} retry={() => me.refetch()} />;
  const permitted = (role: string) =>
    me.data.roles.includes("org_admin") || me.data.roles.includes(role);
  const sidebar = (
    <aside className={mobile ? "sidebar open" : "sidebar"}>
      <Link href="/dashboard" className="brand">
        <BrandLogo />
        <span className="brand-light">/ console</span>
      </Link>
      <div className="workspace">
        <div className="workspace-icon" aria-hidden="true">
          {me.data.orgName?.slice(0, 1) || "S"}
        </div>
        <div>
          <strong title={me.data.orgName}>
            {me.data.orgName || t("当前组织")}
          </strong>
          <small>{t("自部署 · 单组织")}</small>
        </div>
      </div>
      <div className="nav-label">{t("组织资源")}</div>
      <nav>
        {links
          .filter(([key]) => key !== "audit" || permitted("auditor"))
          .map(([key, label, Icon]) => (
            <Link
              onClick={() => setMobile(false)}
              key={key}
              className={section === key ? "nav-item active" : "nav-item"}
              href={"/" + key}
            >
              <Icon size={18} />
              <span>{t(label)}</span>
              {section === key && <span className="active-dot" />}
            </Link>
          ))}
      </nav>
      <div className="sidebar-bottom">
        <Link
          className="nav-item"
          href={locale === "zh" ? "/docs/zh" : "/docs"}
        >
          <BookOpen size={18} />
          {t("使用文档")}
        </Link>
        {permitted("org_admin") && (
          <Link
            className={section === "settings" ? "nav-item active" : "nav-item"}
            href="/settings/general"
          >
            <Settings size={18} />
            {t("组织设置")}
          </Link>
        )}
        <div className="system-state">
          <span className="dot" />
          {t("已连接控制平面")}
          <code>v1</code>
        </div>
        <Link className="user-card" href="/account">
          <div className="avatar">{me.data.displayName?.slice(0, 1)}</div>
          <div>
            <strong>{me.data.displayName}</strong>
            <small>{me.data.roles.join(" · ")}</small>
          </div>
          <ChevronRight size={16} />
        </Link>
      </div>
    </aside>
  );
  return (
    <div className="app">
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
      {mobile ? (
        <Sheet open={mobile} onOpenChange={setMobile}>
          <SheetContent side="left" className="mobile-nav-sheet">
            <SheetHeader className="sr-only">
              <SheetTitle>{t("工作区导航")}</SheetTitle>
              <SheetDescription>
                {t("选择仓库、发布或管理页面")}
              </SheetDescription>
            </SheetHeader>
            {sidebar}
          </SheetContent>
        </Sheet>
      ) : (
        sidebar
      )}
      <div className="main">
        <header className="topbar">
          <Button
            variant="ghost"
            className="icon mobile-menu"
            aria-label={t("打开导航")}
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </Button>
          <Link href="/repositories" className="topbar-brand">
            <BrandLogo />
          </Link>
          <div className="breadcrumbs">
            <span className="organization-crumb" title={me.data.orgName}>
              {me.data.orgName || t("当前组织")}
            </span>
            {parts.map((p, i) => (
              <span key={i}>
                <ChevronRight size={13} />
                {t(labels[p] || short(p))}
              </span>
            ))}
          </div>
          <Button
            className="command-trigger"
            variant="outline"
            onClick={() => setCommandOpen(true)}
          >
            <Search size={14} />
            {t("搜索或跳转…")}
            <kbd>⌘ K</kbd>
          </Button>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              router.push("/skills?query=" + encodeURIComponent(search));
            }}
          >
            <Search size={15} />
            <FormInput
              aria-label={t("全局搜索 Skills")}
              placeholder={t("搜索 Skills…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>↵</kbd>
          </form>
          <LanguageSwitch />
          <Button
            variant="ghost"
            className="icon"
            aria-label={t("切换主题")}
            onClick={() =>
              setTheme(
                theme === "dark"
                  ? "light"
                  : theme === "light"
                    ? "system"
                    : "dark",
              )
            }
          >
            {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
          </Button>
          <Button
            variant="ghost"
            className="icon notification"
            aria-label={t("通知中心")}
            onClick={() => setNotify(!notify)}
          >
            <Bell size={18} />
            {notices.data?.items.some((n: any) => !n.read) && <i />}
          </Button>
          {notify && (
            <Card className="notifications panel">
              <h3>{t("通知中心")}</h3>
              {notices.data?.items.length ? (
                notices.data.items.map((n: any) => (
                  <Link
                    href={n.href}
                    key={n.id}
                    onClick={() => {
                      api("/notifications/" + n.id + "/read", {});
                      setNotify(false);
                    }}
                  >
                    {n.title}
                    <small>{date(n.createdAt, locale)}</small>
                  </Link>
                ))
              ) : (
                <p className="muted">{t("暂无通知")}</p>
              )}
            </Card>
          )}
        </header>
        <main className="content">
          {section === "dashboard" ? (
            <Dashboard />
          ) : section === "settings" ? (
            <SettingsPage tab={parts[1] || "general"} />
          ) : section === "account" ? (
            <Account me={me.data} />
          ) : section === "403" ? (
            <ErrorState error={new ApiError(403, t("当前角色没有访问权限"))} />
          ) : section === "error" ? (
            <ErrorState
              error={new Error(t("服务暂时不可用"))}
              retry={() => router.push("/dashboard")}
            />
          ) : endpoints[section] ? (
            <Resource section={section} parts={parts} allowed={permitted} />
          ) : (
            <Empty
              title={t("404 · 页面不存在")}
              description={t("检查地址，或返回工作区概览。")}
              href="/dashboard"
              action={t("返回概览")}
            />
          )}
        </main>
        <footer>
          SKIVA <span>{t("不可变快照 · 可追溯发布 · 只读分发")}</span>
          <span>{t("Enterprise Skills Delivery Platform")}</span>
        </footer>
      </div>
    </div>
  );
}
const makeLoginSchema = (t: Translate) =>
  z.object({
    email: z.string().regex(/^[^\s@]+@[^\s@]+$/, t("请输入有效邮箱")),
    password: z.string().min(1, t("请输入密码")),
  });
function Login() {
  const { t } = useI18n();

  const loginSchema = makeLoginSchema(t);
  const router = useRouter();
  const cache = useQueryClient();
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });
  const m = useMutation({
    mutationFn: (v: z.infer<typeof loginSchema>) => createClient("").login(v),
    onSuccess: () => {
      cache.clear();
      router.replace("/dashboard");
    },
  });
  return (
    <div className="login-page">
      <div className="login-story">
        <LanguageSwitch />
        <div className="brand">
          <BrandLogo /> <span className="brand-light">/ console</span>
        </div>
        <p className="eyebrow">{t("ONE SOURCE. EVERY AGENT.")}</p>
        <h1>
          {t("知识持续演进。")}
          <br />
          {t("交付始终可信。")}
        </h1>
        <p>
          {t("从 Git 提交到不可变发布，")}
          <br />
          {t("让每一个 Agent 使用正确的 Skills。")}
        </p>
        <div className="login-flow">
          <GitBranch /> Git <ChevronRight />
          <Layers /> Snapshot <ChevronRight />
          <Terminal /> Agent
        </div>
        <small>{t("ENTERPRISE SKILLS DELIVERY PLATFORM")}</small>
      </div>
      <div className="login-form">
        <div className="eyebrow">{t("WELCOME BACK")}</div>
        <h2>{t("登录工作区")}</h2>
        <p className="muted">{t("使用企业身份或开发环境账户继续。")}</p>
        <a className="btn btn-outline full" href="/api/v1/auth/oidc">
          <Shield size={17} />
          {t("企业 SSO 登录")}
        </a>
        <div className="divider">{t("开发环境账户")}</div>
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <Label>
            {t("邮箱")}
            <FormInput autoComplete="username" {...form.register("email")} />
          </Label>
          {form.formState.errors.email && (
            <p className="danger">{form.formState.errors.email.message}</p>
          )}
          <Label>
            {t("密码")}
            <FormInput
              type="password"
              autoComplete="current-password"
              {...form.register("password")}
            />
          </Label>
          {m.error && (
            <p role="alert" className="danger">
              {m.error.message}
            </p>
          )}
          <Button className="full" disabled={m.isPending}>
            {m.isPending ? t("正在验证…") : t("登录工作区")}
            <ArrowUpRight size={17} />
          </Button>
        </form>
        <p className="fine">
          {t("生产环境使用企业 OIDC。需要访问权限？请联系组织管理员。")}
        </p>
      </div>
    </div>
  );
}

function QueryNotice({ queries }: { queries: any[] }) {
  const { t } = useI18n();

  return (
    <>
      {queries.map((q, i) =>
        q.error ? (
          <div key={i}>
            {q.data ? (
              <div className="info-note">
                {t("数据可能延迟。")}
                <Button variant="ghost" onClick={() => q.refetch()}>
                  {t("重试刷新")}
                </Button>
              </div>
            ) : (
              <ErrorState error={q.error} retry={() => q.refetch()} />
            )}
          </div>
        ) : q.isPending ? (
          <Skeleton key={i} />
        ) : null,
      )}
    </>
  );
}

function Skeleton() {
  const { t } = useI18n();

  return (
    <div aria-label={t("正在加载")} className="skeleton-wrap">
      <LoadingSkeleton className="skeleton title" />
      <LoadingSkeleton className="skeleton" />
      <LoadingSkeleton className="skeleton" />
      <LoadingSkeleton className="skeleton" />
    </div>
  );
}
function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  const { t } = useI18n();

  return (
    <div className="error-state" role="alert">
      <Shield size={30} />
      <h2>
        {error instanceof ApiError && error.status === 403
          ? t("权限不足")
          : t("暂时无法完成请求")}
      </h2>
      <p>{t(error.message)}</p>
      {error instanceof ApiError && error.requestId && (
        <code>
          {t("Request ID:")}
          {error.requestId}
        </code>
      )}
      {retry && (
        <Button variant="outline" onClick={retry}>
          <RefreshCw size={15} />
          {t("重试")}
        </Button>
      )}
    </div>
  );
}
function Empty({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Box size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {href && (
        <Button asChild>
          <Link href={href}>
            <Plus size={15} />
            {action}
          </Link>
        </Button>
      )}
    </div>
  );
}
function Header({
  title,
  kicker,
  description,
  children,
}: {
  title: string;
  kicker?: string;
  description?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className="page-header">
      <div>
        <p className="eyebrow">{kicker || t("WORKSPACE / 工作空间")}</p>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
function Badge({ value }: { value: string }) {
  const { t } = useI18n();

  return (
    <ShadBadge
      variant="outline"
      className={
        "badge " +
        (["active", "succeeded", "online", "published", "validated"].includes(
          value,
        )
          ? "good"
          : ["failed", "error", "revoked", "rejected"].includes(value)
            ? "bad"
            : ["running", "queued", "stale", "draft"].includes(value)
              ? "warn"
              : "neutral")
      }
    >
      <i />
      {t(value)}
    </ShadBadge>
  );
}
function Copy({ value }: { value: string }) {
  const { t } = useI18n();

  const [ok, setOK] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="icon"
      aria-label={t("复制")}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setOK(true);
        setTimeout(() => setOK(false), 1500);
      }}
    >
      {ok ? <Check size={15} /> : <Clipboard size={15} />}
    </Button>
  );
}
function Dashboard() {
  const { t, locale } = useI18n();

  const q = useData("/dashboard");
  const pipelines = useData("/pipelines");
  const channels = useData("/channels");
  if (q.isPending) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <Header
        title={t("交付概览")}
        kicker="WORKSPACE OVERVIEW"
        description={t("从内容来源到 Agent 终端，每一次交付都有据可循。")}
      >
        <Button variant="outline" onClick={() => q.refetch()}>
          <RefreshCw size={15} />
          {t("刷新")}
        </Button>
        <Button asChild>
          <Link href="/repositories/new">
            <Plus size={16} />
            {t("接入仓库")}
          </Link>
        </Button>
      </Header>
      <div className="metrics">
        {[
          ["repositories", t("Git 仓库"), GitBranch, "repositories"],
          ["skills", t("已发现 Skills"), BookOpen, "skills"],
          ["releases", t("不可变快照"), Layers, "releases"],
          ["clients", t("授权终端"), Monitor, "clients"],
        ].map(([key, label, Icon, href]: any) => (
          <Link key={key} href={"/" + href} className="metric">
            <div>
              <span>{t(label)}</span>
              <Icon size={18} />
            </div>
            <strong>{q.data[key]}</strong>
            <small>
              {t("查看详情")}
              <ArrowUpRight size={13} />
            </small>
          </Link>
        ))}
      </div>
      <div className="section-heading">
        <h2>{t("发布渠道")}</h2>
        <Link href="/channels">
          {t("管理渠道")}
          <ArrowUpRight size={14} />
        </Link>
      </div>
      <div className="channel-grid">
        {channels.data?.items.map((c: any) => (
          <div className="channel-card" key={c.id}>
            <div className="section-heading">
              <h3>
                <span className={"channel-icon " + c.name}>
                  <Layers size={18} />
                </span>
                {c.name}
              </h3>
              <Badge value={c.snapshotId ? "published" : "empty"} />
            </div>
            <p className="muted">
              {c.name === "stable"
                ? t("经过验证的正式发布视图")
                : t("在小范围 Profile 中验证新版本")}
            </p>
            <div className="channel-info">
              <span>{t("SNAPSHOT")}</span>
              <Link
                href={
                  c.snapshotId ? "/releases/" + c.snapshotId : "/releases/new"
                }
              >
                <code>
                  {c.snapshotId ? short(c.snapshotId) : t("等待首次发布")}
                </code>
              </Link>
              <span>{t("GENERATION")}</span>
              <strong>{c.generation}</strong>
            </div>
            <div className="card-foot">
              <span>{date(c.updatedAt, locale)}</span>
              <Link href="/channels">
                {t("查看发布历史")}
                <ChevronRight size={13} />
              </Link>
            </div>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h2>
          {t("最近流水线")}{" "}
          <span className="count">{pipelines.data?.items.length || 0}</span>
        </h2>
        <Link href="/pipelines">
          {t("全部流水线")}
          <ArrowUpRight size={14} />
        </Link>
      </div>
      <Card className="panel">
        {pipelines.data?.items.length ? (
          <Table
            items={pipelines.data.items.slice(0, 6)}
            columns={["repositoryName", "commitSha", "status", "createdAt"]}
            section="pipelines"
          />
        ) : (
          <Empty
            title={t("从第一次提交开始")}
            description={t(
              "接入 Git 仓库，平台会校验内容并生成不可变 Skill 版本。",
            )}
            href="/repositories/new"
            action={t("接入 Git 仓库")}
          />
        )}
      </Card>
      <div className="health-strip">
        <Activity size={17} />
        <span>{t("需要关注")}</span>
        <Link href="/pipelines?status=failed">
          {t("{count} 个失败流水线", { count: q.data.failedPipelines })}
        </Link>
        <Link href="/clients">
          {t("{count} 个离线终端", { count: q.data.offlineClients })}
        </Link>
        <span className="muted">{t("数据每 30 秒刷新")}</span>
      </div>
    </>
  );
}
const columnLabels: Record<string, string> = {
  sourceType: "仓库来源",
  namespace: "团队命名空间",
  slug: "仓库路径",
  provisionState: "准备状态",
  provisionError: "准备错误",
  lastPushAt: "最近推送",
  skillRoot: "扫描目录",
  defaultRef: "默认 Ref",
  name: "名称",
  repositoryName: "来源仓库",
  remoteUrl: "远程地址",
  status: "状态",
  lastCommitSha: "最近提交",
  lastSyncAt: "最近同步",
  description: "描述",
  relativePath: "目录",
  commitSha: "Commit",
  createdAt: "创建时间",
  attempt: "尝试",
  manifestDigest: "内容摘要",
  skillCount: "Skills",
  createdBy: "创建人",
  channel: "渠道",
  consistencyMode: "一致性",
  offlinePolicy: "离线策略",
  enabled: "启用",
  profileName: "Profile",
  lastSeenAt: "最近心跳",
  snapshotId: "快照",
  generation: "Generation",
  action: "操作",
  actorId: "操作者",
  targetType: "对象类型",
  targetId: "对象",
  displayName: "姓名",
  email: "邮箱",
  roles: "角色",
  secretRef: "Secret 引用",
};
function Table({
  items,
  columns,
  section,
  onSelect,
}: {
  items: any[];
  columns: string[];
  section?: string;
  onSelect?: (v: any) => void;
}) {
  const { t, locale } = useI18n();

  return (
    <div className="table-scroll">
      <ShadTable>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c}>{t(columnLabels[c] || c)}</TableHead>
            ))}
            {(section || onSelect) && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, i) => (
            <TableRow key={item.id || i}>
              {columns.map((c, j) => (
                <TableCell key={c}>
                  {c === "status" ? (
                    <Badge value={item[c]} />
                  ) : c.endsWith("At") ? (
                    date(item[c], locale)
                  ) : typeof item[c] === "boolean" ? (
                    item[c] ? (
                      t("已启用")
                    ) : (
                      t("已停用")
                    )
                  ) : Array.isArray(item[c]) ? (
                    item[c].join(", ")
                  ) : j === 0 && section ? (
                    <Link
                      className="table-link"
                      href={"/" + section + "/" + item.id}
                    >
                      {[
                        "id",
                        "commitSha",
                        "lastCommitSha",
                        "manifestDigest",
                        "snapshotId",
                      ].includes(c)
                        ? short(item[c])
                        : (item[c] ?? "—")}
                    </Link>
                  ) : (
                    <span title={String(item[c] ?? "")}>
                      {[
                        "id",
                        "commitSha",
                        "lastCommitSha",
                        "manifestDigest",
                        "snapshotId",
                      ].includes(c)
                        ? short(item[c])
                        : (item[c] ?? "—")}
                    </span>
                  )}
                </TableCell>
              ))}
              {(section || onSelect) && (
                <TableCell>
                  {onSelect ? (
                    <Button variant="ghost" onClick={() => onSelect(item)}>
                      {t("管理")}
                    </Button>
                  ) : (
                    <Link
                      aria-label={t("查看详情")}
                      href={"/" + section + "/" + item.id}
                    >
                      <ChevronRight size={16} />
                    </Link>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </ShadTable>
    </div>
  );
}
const columns: Record<string, string[]> = {
  repositories: ["name", "remoteUrl", "status", "lastCommitSha", "lastSyncAt"],
  skills: ["name", "description", "repositoryName", "relativePath"],
  pipelines: ["repositoryName", "commitSha", "status", "attempt", "createdAt"],
  releases: ["id", "skillCount", "status", "createdBy", "createdAt"],
  profiles: ["name", "channel", "consistencyMode", "offlinePolicy", "enabled"],
  clients: ["name", "profileName", "status", "lastSeenAt", "snapshotId"],
  audit: ["action", "actorId", "targetType", "targetId", "createdAt"],
};
function Resource({
  section,
  parts,
  allowed,
}: {
  section: string;
  parts: string[];
  allowed: (r: string) => boolean;
}) {
  const { t } = useI18n();

  const id = parts[1];
  if (section === "channels")
    return <Channels allowed={allowed("release_manager")} />;
  if (id === "new")
    return section === "repositories" ? (
      <RepositoryForm />
    ) : section === "releases" ? (
      <ReleaseForm />
    ) : section === "profiles" ? (
      <ProfileForm />
    ) : section === "clients" ? (
      <ClientForm />
    ) : (
      <Empty title={t("页面不存在")} description={t("返回列表选择资源。")} />
    );
  if (id)
    return <Detail section={section} id={id} parts={parts} allowed={allowed} />;
  return <Listing section={section} allowed={allowed} />;
}
function Listing({
  section,
  allowed,
}: {
  section: string;
  allowed: (r: string) => boolean;
}) {
  const { t } = useI18n();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<any>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const repos = useData(
    "/repositories",
    section === "pipelines" || section === "skills",
  );
  const params = new URLSearchParams(
    Object.fromEntries(
      Object.entries({ ...filters, ...(status ? { status } : {}) }).filter(
        ([, value]) => value,
      ),
    ),
  );
  const q = useData(
    "/" + endpoints[section] + (params.size ? "?" + params.toString() : ""),
  );
  const create =
    section === "repositories"
      ? allowed("repo_maintainer")
      : section === "releases"
        ? allowed("release_manager")
        : ["profiles", "clients"].includes(section)
          ? allowed("agent_manager")
          : false;
  const descriptions: Record<string, string> = {
    repositories: t("管理托管与外部 Git 仓库，浏览内容、检查校验并准备发布。"),
    skills: t("发现并管理经过静态校验的 Skill。所有版本均绑定完整 Commit。"),
    pipelines: t("从 Git Tree 到不可变产物，追踪每一次校验和诊断。"),
    releases: t("组合完整 Skill 视图，预览变更，再推进到发布渠道。"),
    profiles: t("定义 Agent 可见的 Skills、发布渠道与一致性策略。"),
    clients: t("管理工作负载身份、在线状态和只读挂载凭据。"),
    audit: t("检索敏感操作的操作者、对象和变更记录。"),
  };
  let items = q.data?.items || [];
  items = items.filter((v: any) =>
    JSON.stringify(v).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      {section === "clients" && <AgentDeliveryOverview />}
      <Header
        title={t(labels[section])}
        kicker={t("工作空间 / ") + section.toUpperCase()}
        description={descriptions[section]}
      >
        <Button variant="outline" onClick={() => q.refetch()}>
          <RefreshCw size={15} />
          {t("刷新")}
        </Button>
        {create && (
          <Button asChild>
            <Link href={"/" + section + "/new"}>
              <Plus size={16} />
              {section === "repositories"
                ? t("接入仓库")
                : section === "releases"
                  ? t("创建快照")
                  : section === "profiles"
                    ? t("新建 Profile")
                    : t("注册终端")}
            </Link>
          </Button>
        )}
      </Header>
      <Card className="panel">
        {q.data && q.error && <QueryNotice queries={[q]} />}
        <div className="filterbar">
          <div className="search-input">
            <Search size={16} />
            <FormInput
              aria-label={t("筛选列表")}
              value={search}
              placeholder={t("按名称、来源或标识搜索…")}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          {section === "pipelines" && (
            <NativeSelect
              wrapperClassName="filter-status"
              aria-label={t("流水线状态")}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <NativeSelectOption value="">{t("全部状态")}</NativeSelectOption>
              {["queued", "running", "succeeded", "failed", "cancelled"].map(
                (v) => (
                  <NativeSelectOption key={v}>{v}</NativeSelectOption>
                ),
              )}
            </NativeSelect>
          )}
          {(section === "pipelines" || section === "skills") && (
            <NativeSelect
              wrapperClassName="filter-repository"
              aria-label={t("来源仓库筛选")}
              value={filters.repoId || ""}
              onChange={(e) => {
                setFilters({ ...filters, repoId: e.target.value });
                setPage(0);
              }}
            >
              <NativeSelectOption value="">{t("全部仓库")}</NativeSelectOption>
              {repos.data?.items.map((repo: any) => (
                <NativeSelectOption key={repo.id} value={repo.id}>
                  {repo.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          <span className="muted">
            {t("{count} 条记录", { count: items.length })}
          </span>
        </div>
        {section === "audit" && (
          <div className="filterbar audit-filters">
            {[
              ["actor", t("操作者 ID")],
              ["action", t("操作")],
              ["target", t("对象 ID")],
            ].map(([key, label]) => (
              <FormInput
                key={key}
                aria-label={label}
                placeholder={label}
                value={filters[key] || ""}
                onChange={(e) =>
                  setFilters({ ...filters, [key]: e.target.value })
                }
              />
            ))}
            {[
              ["from", t("开始时间")],
              ["until", t("结束时间")],
            ].map(([key, label]) => (
              <Label key={key}>
                {label}
                <FormInput
                  type="datetime-local"
                  aria-label={label}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      [key]: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : "",
                    })
                  }
                />
              </Label>
            ))}
          </div>
        )}
        {q.isPending ? (
          <Skeleton />
        ) : q.error && !q.data ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : items.length ? (
          <Table
            items={items.slice(page * 20, page * 20 + 20)}
            columns={columns[section]}
            section={section === "audit" ? undefined : section}
            onSelect={section === "audit" ? setSelected : undefined}
          />
        ) : (
          <Empty
            title={
              search
                ? t("没有匹配结果")
                : t("还没有{resource}", { resource: t(labels[section]) })
            }
            description={search ? t("尝试其他关键词。") : descriptions[section]}
            href={create ? "/" + section + "/new" : undefined}
            action={t("开始创建")}
          />
        )}
        <div className="pagination">
          <span>{t("第 {page} 页 · 每页 20 条", { page: page + 1 })}</span>
          <Button
            variant="ghost"
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            {t("上一页")}
          </Button>
          <Button
            variant="ghost"
            disabled={(page + 1) * 20 >= items.length}
            onClick={() => setPage(page + 1)}
          >
            {t("下一页")}
          </Button>
        </div>
      </Card>
      {selected && (
        <Card className="panel detail-panel">
          <div className="section-heading">
            <h2>
              {t("审计变更 ·")}
              {selected.action}
            </h2>
            <Button
              className="icon"
              onClick={() => setSelected(null)}
              aria-label={t("关闭")}
            >
              <X size={18} />
            </Button>
          </div>
          <div className="diff-grid">
            <div>
              <h4>{t("Before")}</h4>
              <pre>{JSON.stringify(selected.before, null, 2)}</pre>
            </div>
            <div>
              <h4>{t("After")}</h4>
              <pre>{JSON.stringify(selected.after, null, 2)}</pre>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
function useAction() {
  const { t } = useI18n();

  const cache = useQueryClient();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (path: string, body: any = {}, method?: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const v = await api(path, body, method);
      cache.invalidateQueries();
      setMessage("操作已完成");
      return v;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return {
    run,
    busy,
    feedback: (
      <>
        {message && (
          <div className="success-note" role="status">
            <Check size={16} />
            {t(message)}
          </div>
        )}
        {error && (
          <div className="error-note" role="alert">
            {t(error)}
          </div>
        )}
      </>
    ),
  };
}
function Detail({
  section,
  id,
  parts,
  allowed,
}: {
  section: string;
  id: string;
  parts: string[];
  allowed: (r: string) => boolean;
}) {
  const { t, locale } = useI18n();

  const q = useData("/" + endpoints[section] + "/" + id);
  const versions = useData("/skills/" + id + "/versions", section === "skills");
  const a = useAction();
  const [confirm, setConfirm] = useState("");
  const [token, setToken] = useState("");
  const [edit, setEdit] = useState(false);
  if (q.isPending) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const v = q.data;
  if (edit && section === "repositories") return <RepositoryForm initial={v} />;
  if (edit && section === "profiles") return <ProfileForm initial={v} />;
  const detail = (
    <>
      <Header
        title={v.name || v.commitSha?.slice(0, 12) || short(id)}
        kicker={t(labels[section]) + " / DETAIL"}
        description={v.description}
      >
        <Button variant="outline" asChild>
          <Link href={"/" + section}>{t("返回列表")}</Link>
        </Button>
        {((section === "repositories" &&
          (allowed("repo_maintainer") || v.accessRole === "maintainer")) ||
          (section === "profiles" && allowed("agent_manager"))) && (
          <Button onClick={() => setEdit(true)}>{t("编辑配置")}</Button>
        )}
        {section === "repositories" &&
          (allowed("repo_maintainer") || v.accessRole === "maintainer") && (
            <Button
              disabled={a.busy}
              onClick={() => a.run("/repositories/" + id + "/sync")}
            >
              {t("立即同步")}
            </Button>
          )}
        {section === "pipelines" &&
          v.status === "failed" &&
          allowed("repo_maintainer") && (
            <Button
              disabled={a.busy}
              onClick={() => a.run("/pipelines/" + id + "/retry")}
            >
              {t("重试校验")}
            </Button>
          )}
      </Header>
      {a.feedback}
      <Card className="panel detail-panel">
        <div className="properties">
          {Object.entries(v)
            .filter(
              ([k, val]) =>
                ![
                  "steps",
                  "items",
                  "metadata",
                  "skills",
                  "telemetry",
                  "syncJobs",
                  "hostingPolicy",
                  "accessRole",
                  "description",
                ].includes(k) && val !== null,
            )
            .map(([k, val]) => (
              <div key={k}>
                <dt>{t(columnLabels[k] || k)}</dt>
                <dd>
                  {k === "status" ? (
                    <Badge value={String(val)} />
                  ) : typeof val === "boolean" ? (
                    val ? (
                      t("是")
                    ) : (
                      t("否")
                    )
                  ) : (
                    <span>
                      {k.endsWith("At") ? date(val, locale) : String(val)}
                    </span>
                  )}
                  {typeof val === "string" && val.length > 20 && (
                    <Copy value={val} />
                  )}
                </dd>
              </div>
            ))}
        </div>
      </Card>
      {section === "repositories" && v.sourceType === "managed" && (
        <ManagedRepository id={id} />
      )}
      {section === "repositories" && v.sourceType !== "managed" && (
        <Card className="panel detail-panel">
          <h2>{t("Webhook 与同步")}</h2>
          {v.syncJobs?.map((job: any) => (
            <div className="history-row" key={job.id}>
              <Badge value={job.status} />
              <span className="muted">{job.error || t("同步任务")}</span>
              <small>
                {t("尝试")}
                {job.attempts}
              </small>
            </div>
          ))}
          <p className="muted">
            {t(
              "选择 Git 服务提供商，配置 Push 事件与服务器 Secret 引用。轮询每分钟补偿遗漏事件。",
            )}
          </p>
          {["github", "gitlab", "gitea"].map((p) => (
            <div className="code-row" key={p}>
              <code>
                /api/v1/webhooks/{p}/{id}
              </code>
              <Copy
                value={location.origin + "/api/v1/webhooks/" + p + "/" + id}
              />
            </div>
          ))}
          <p className="fine">
            {t(
              "GitHub：X-Hub-Signature-256；Gitea：X-Gitea-Signature；GitLab：X-Gitlab-Token。Secret 仅保存在服务器。",
            )}
          </p>
          {allowed("repo_maintainer") && (
            <div className="actions">
              <Button
                variant="outline"
                disabled={a.busy}
                onClick={() =>
                  a.run("/repositories/" + id + "/test-connection")
                }
              >
                {t("测试连接")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setConfirm("delete")}
              >
                {t("软删除仓库")}
              </Button>
            </div>
          )}
        </Card>
      )}
      {section === "pipelines" && <PipelineDiagnostics run={v} />}
      {section === "skills" &&
        (versions.isPending ? (
          <Skeleton />
        ) : (
          <SkillVersions
            versions={versions.data?.items || []}
            selected={parts[3]}
          />
        ))}
      {section === "releases" && (
        <ReleaseReview
          release={v}
          channelsPanel={
            <Channels
              allowed={allowed("release_manager")}
              initialSnapshot={id}
            />
          }
        />
      )}
      {section === "profiles" && (
        <Card className="panel detail-panel">
          <h2>{t("授权 Skills")}</h2>
          <div className="tags">
            {v.skills.map((s: string) => (
              <span className="tag" key={s}>
                {s}
              </span>
            ))}
          </div>
          <h2>{t("只读挂载指引")}</h2>
          <p className="muted">
            {v.consistencyMode === "pinned"
              ? t("Pinned 固定任务快照，任务期间不会自动切换。")
              : t(
                  "Dynamic 的新 open 可读取新版本；已打开句柄保持旧内容。多次 open 不保证任务级一致性。",
                )}
          </p>
          <pre>
            skills-mount login --server https://YOUR_SERVER --token-file
            ./client.token{"\n"}skills-mount mount --profile {id} --mode{" "}
            {v.consistencyMode} --path ~/agent-skills
          </pre>
          <p className="fine">
            {t("Linux FUSE 首发。macOS / Windows 尚未完成兼容验收。离线策略：")}
            {v.offlinePolicy}。
          </p>
          <Button asChild>
            <Link href="/clients/new">{t("注册挂载终端")}</Link>
          </Button>
        </Card>
      )}
      {section === "clients" && (
        <Card className="panel detail-panel">
          <h2>{t("工作负载凭据")}</h2>
          <p className="muted">
            {t("凭据仅授权此终端所属 Profile。轮换后旧凭据立即失效。")}
          </p>
          {allowed("agent_manager") && (
            <div className="actions">
              <Button
                variant="outline"
                disabled={v.status === "revoked"}
                onClick={() => setConfirm("rotate")}
              >
                {t("轮换凭据")}
              </Button>
              <Button
                variant="destructive"
                disabled={v.status === "revoked"}
                onClick={() => setConfirm("revoke")}
              >
                {t("吊销终端")}
              </Button>
            </div>
          )}
          {token && <TokenReveal token={token} close={() => setToken("")} />}
          <h3>{t("最近遥测")}</h3>
          <pre>{JSON.stringify(v.telemetry || {}, null, 2)}</pre>
        </Card>
      )}
      <ConfirmDialog
        open={!!confirm}
        title={
          confirm === "delete"
            ? t("软删除此仓库？")
            : confirm === "rotate"
              ? t("轮换终端凭据？")
              : t("吊销终端授权？")
        }
        busy={a.busy}
        onClose={() => setConfirm("")}
        onConfirm={async () => {
          const out = await a.run(
            section === "repositories"
              ? "/repositories/" + id
              : "/mount-clients/" + id + "/" + confirm,
            {},
            confirm === "delete" ? "DELETE" : undefined,
          );
          if (out) {
            setConfirm("");
            if (out.token) setToken(out.token);
          }
        }}
      >
        {t(
          "此操作会影响后续同步或客户端访问。已发布快照仍保留用于审计和回滚。",
        )}
      </ConfirmDialog>
    </>
  );
  if (section === "repositories")
    return (
      <RepositoryWorkspace
        repo={v}
        settings={detail}
        canRelease={allowed("release_manager")}
        canMaintain={
          allowed("repo_maintainer") || v.accessRole === "maintainer"
        }
        onEdit={() => setEdit(true)}
        onSync={() => a.run("/repositories/" + id + "/sync")}
      />
    );
  return detail;
}
function TokenReveal({ token, close }: { token: string; close: () => void }) {
  const { t } = useI18n();

  return (
    <div className="token-reveal">
      <h3>{t("凭据仅显示一次")}</h3>
      <p>
        {t("现在复制并保存到权限为 0600 的文件。请勿将令牌写入日志或仓库。")}
      </p>
      <div className="code-row">
        <code>{token}</code>
        <Copy value={token} />
      </div>
      <Button variant="outline" onClick={close}>
        {t("已安全保存")}
      </Button>
    </div>
  );
}
function SkillVersions({
  versions,
  selected,
}: {
  versions: any[];
  selected?: string;
}) {
  const { t, locale } = useI18n();

  const [vid, setVid] = useState(selected || versions[0]?.id || "");
  const [file, setFile] = useState("SKILL.md");
  const [against, setAgainst] = useState("");
  const tree = useData("/skill-versions/" + vid + "/tree", !!vid);
  const content = useData(
    "/skill-versions/" + vid + "/file?path=" + encodeURIComponent(file),
    !!vid,
  );
  const diff = useData(
    "/skill-versions/" + vid + "/diff?against=" + against,
    !!vid && !!against,
  );
  return (
    <Card className="panel detail-panel">
      <div className="section-heading">
        <h2>{t("版本与内容")}</h2>
        <NativeSelect
          aria-label={t("当前版本")}
          value={vid}
          onChange={(e) => setVid(e.target.value)}
        >
          {versions.map((v) => (
            <NativeSelectOption key={v.id} value={v.id}>
              {v.commitSha.slice(0, 12)} · {date(v.createdAt, locale)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="file-browser">
        <div className="file-tree">
          {tree.data?.items.map((f: any) => (
            <Button
              className={file === f.path ? "selected" : ""}
              key={f.path}
              onClick={() => setFile(f.path)}
            >
              {f.path}
            </Button>
          ))}
        </div>
        <div className="file-content">
          <div className="code-row">
            <code>{file}</code>
            <Copy value={content.data?.content || ""} />
          </div>
          {content.isPending ? (
            <Skeleton />
          ) : content.error ? (
            <ErrorState error={content.error} retry={() => content.refetch()} />
          ) : file.endsWith(".md") ? (
            <article className="markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                  img: ({ alt }) => (
                    <span className="muted">
                      {t("[图片：")}
                      {alt || t("附件")}]
                    </span>
                  ),
                }}
              >
                {content.data?.content}
              </ReactMarkdown>
            </article>
          ) : (
            <pre>{content.data?.content}</pre>
          )}
        </div>
      </div>
      <div className="section-heading">
        <h3>{t("比较历史版本")}</h3>
        <NativeSelect
          aria-label={t("比较版本")}
          value={against}
          onChange={(e) => setAgainst(e.target.value)}
        >
          <NativeSelectOption value="">{t("选择对比版本")}</NativeSelectOption>
          {versions
            .filter((v) => v.id !== vid)
            .map((v) => (
              <NativeSelectOption key={v.id} value={v.id}>
                {v.commitSha.slice(0, 12)}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      </div>
      {against &&
        (diff.isPending ? (
          <Skeleton />
        ) : diff.error ? (
          <ErrorState error={diff.error} />
        ) : (
          diff.data?.items.map((d: any) => (
            <div key={d.path}>
              <h4>
                {d.path} · {d.status}
              </h4>
              <div className="diff-grid">
                <pre>{d.before}</pre>
                <pre>{d.after}</pre>
              </div>
            </div>
          ))
        ))}
    </Card>
  );
}
function FormBox({
  title,
  description,
  children,
  onSubmit,
  busy,
  feedback,
  dirty,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  feedback: ReactNode;
  dirty?: boolean;
}) {
  const { t } = useI18n();

  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (!dirty || !changed) return;
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", f);
    const navigate = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("a");
      if (
        target?.href &&
        target.href !== location.href &&
        !window.confirm(t("有未保存的更改。确认离开？"))
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", f);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, changed, t]);
  return (
    <>
      <Header title={title} description={description} />
      <form
        className="panel form-panel"
        onChange={() => setChanged(true)}
        onSubmit={onSubmit}
      >
        {feedback}
        {children}
        <div className="form-footer">
          <span className="fine">{t("所有变更在服务端校验并记录审计。")}</span>
          <Button disabled={busy}>
            {busy ? t("正在保存…") : t("保存配置")}
            <ArrowUpRight size={15} />
          </Button>
        </div>
      </form>
    </>
  );
}
function RepositoryForm({ initial }: { initial?: any }) {
  const { t } = useI18n();

  const feature = useData("/me");
  const a = useAction();
  const router = useRouter();
  const [v, setV] = useState(
    initial || {
      sourceType: feature.data?.managedGitEnabled ? "managed" : "external",
      namespace: "engineering",
      slug: "",
      template: "single",
      name: "",
      remoteUrl: "",
      defaultRef: "refs/heads/main",
      skillRoot: "",
      status: "active",
      credentialId: "",
      webhookSecretRef: "",
    },
  );
  const managed = v.sourceType === "managed";
  const fields = [
    ["name", t("仓库名称"), t("例如 engineering-skills")],
    ["remoteUrl", "Git URL", "https://git.example.com/team/skills.git"],
    ["defaultRef", t("默认分支 / Ref"), "refs/heads/main"],
    [
      "skillRoot",
      t("扫描根目录"),
      t("单 Skill 根仓库留空；Monorepo 填 skills"),
    ],
    ["credentialId", t("凭据引用 ID（可选）"), t("组织设置中配置的凭据 ID")],
    [
      "webhookSecretRef",
      t("Webhook Secret 环境变量（可选）"),
      "SKIVA_WEBHOOK_SECRET",
    ],
  ].filter(
    ([key]) =>
      !managed ||
      !["remoteUrl", "credentialId", "webhookSecretRef"].includes(key),
  );
  return (
    <FormBox
      title={initial ? t("编辑仓库") : t("接入 Git 仓库")}
      description={t(
        "选择平台托管或外部 Git 来源。平台静态校验 Skills，不执行仓库内容。",
      )}
      feedback={a.feedback}
      busy={a.busy}
      dirty
      onSubmit={async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(
          fields.map(([k]) => [
            k,
            v[k] ||
              (["credentialId", "webhookSecretRef"].includes(k) ? null : ""),
          ]),
        );
        body.status = v.status;
        body.sourceType = v.sourceType || "external";
        if (managed) {
          body.namespace = v.namespace;
          body.slug = v.slug;
          body.template = v.template || "empty";
        }
        const res = await a.run(
          "/repositories" + (initial ? "/" + initial.id : ""),
          body,
          initial ? "PATCH" : "POST",
        );
        if (res) router.push("/repositories/" + res.id);
      }}
    >
      {!initial && (
        <Label>
          {t("仓库来源")}
          <NativeSelect
            aria-label={t("仓库来源")}
            value={v.sourceType}
            onChange={(e) => setV({ ...v, sourceType: e.target.value })}
          >
            <NativeSelectOption
              value="managed"
              disabled={!feature.data?.managedGitEnabled}
            >
              {t("平台托管 · 直接 Clone / Push")}
              {!feature.data?.managedGitEnabled ? t("（尚未启用）") : ""}
            </NativeSelectOption>
            <NativeSelectOption value="external">
              {t("外部关联 · GitHub / GitLab / Gitea")}
            </NativeSelectOption>
          </NativeSelect>
        </Label>
      )}
      {managed && !initial && (
        <>
          <Label>
            {t("团队命名空间")}
            <FormInput
              required
              pattern="[a-z0-9][a-z0-9-]{0,62}"
              value={v.namespace}
              onChange={(e) => setV({ ...v, namespace: e.target.value })}
            />
          </Label>
          <Label>
            {t("仓库路径")}
            <FormInput
              required
              pattern="[a-z0-9][a-z0-9-]{0,62}"
              placeholder="sql-query"
              value={v.slug}
              onChange={(e) => setV({ ...v, slug: e.target.value })}
            />
          </Label>
          <Label>
            {t("初始模板")}
            <NativeSelect
              aria-label={t("初始模板")}
              value={v.template}
              onChange={(e) =>
                setV({
                  ...v,
                  template: e.target.value,
                  skillRoot: e.target.value === "monorepo" ? "skills" : "",
                })
              }
            >
              <NativeSelectOption value="single">
                {t("单 Skill")}
              </NativeSelectOption>
              <NativeSelectOption value="monorepo">Monorepo</NativeSelectOption>
              <NativeSelectOption value="empty">
                {t("空仓库")}
              </NativeSelectOption>
            </NativeSelect>
          </Label>
          <p className="info-note">
            {t("Clone 路径：/git/")}
            {v.namespace}/{v.slug || t("仓库路径")}.git
            <br />
            {t(
              "main 默认禁止强推和删除。创建后配置 Git Token 即可推送；Push 不会自动发布 Stable。",
            )}
          </p>
        </>
      )}
      {fields.map(([k, label, placeholder]) => (
        <Label key={k}>
          {label}
          <FormInput
            required={["name", "remoteUrl", "defaultRef"].includes(k)}
            value={v[k] || ""}
            placeholder={placeholder}
            onChange={(e) => setV({ ...v, [k]: e.target.value })}
          />
        </Label>
      ))}
      <Label>
        {t("状态")}
        <NativeSelect
          value={v.status}
          onChange={(e) => setV({ ...v, status: e.target.value })}
        >
          <NativeSelectOption value="active">{t("启用")}</NativeSelectOption>
          <NativeSelectOption value="disabled">{t("停用")}</NativeSelectOption>
        </NativeSelect>
      </Label>
      {!managed && (
        <p className="info-note">
          {t(
            "私网 Git 需在服务端 SKIVA_GIT_ALLOWLIST 中明确配置主机名。Secret 只引用服务端环境变量。",
          )}
        </p>
      )}
    </FormBox>
  );
}
function ProfileForm({ initial }: { initial?: any }) {
  const { t } = useI18n();

  const a = useAction();
  const router = useRouter();
  const channels = useData("/channels");
  const skills = useData("/skills");
  const releases = useData("/releases");
  const [search, setSearch] = useState("");
  const [v, setV] = useState(
    initial || {
      name: "",
      channelId: "",
      consistencyMode: "dynamic",
      offlinePolicy: "deny_on_disconnect",
      pinnedSnapshotId: "",
      skills: [],
      enabled: true,
    },
  );
  return (
    <FormBox
      title={initial ? t("编辑 Agent Profile") : t("新建 Agent Profile")}
      description={t("明确授权视图与离线行为，为不同 Agent 分配独立配置。")}
      busy={a.busy}
      feedback={
        <>
          {a.feedback}
          <QueryNotice queries={[channels, skills, releases]} />
        </>
      }
      dirty
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await a.run(
          "/agent-profiles" + (initial ? "/" + initial.id : ""),
          {
            name: v.name,
            channelId: v.channelId,
            consistencyMode: v.consistencyMode,
            offlinePolicy: v.offlinePolicy,
            pinnedSnapshotId: v.pinnedSnapshotId || null,
            skills: v.skills,
            enabled: v.enabled,
          },
          initial ? "PATCH" : "POST",
        );
        if (res) router.push("/profiles/" + res.id);
      }}
    >
      <Label>
        {t("Profile 名称")}
        <FormInput
          required
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
      </Label>
      <div className="form-grid">
        <Label>
          {t("发布渠道")}
          <NativeSelect
            required
            value={v.channelId}
            onChange={(e) => setV({ ...v, channelId: e.target.value })}
          >
            <NativeSelectOption value="">{t("选择渠道")}</NativeSelectOption>
            {channels.data?.items.map((c: any) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label>
          {t("一致性模式")}
          <NativeSelect
            value={v.consistencyMode}
            onChange={(e) => setV({ ...v, consistencyMode: e.target.value })}
          >
            <NativeSelectOption value="dynamic">
              {t("Dynamic · 新打开可见更新")}
            </NativeSelectOption>
            <NativeSelectOption value="pinned">
              {t("Pinned · 任务固定快照")}
            </NativeSelectOption>
          </NativeSelect>
        </Label>
      </div>
      <Label>
        {t("离线策略")}
        <NativeSelect
          value={v.offlinePolicy}
          onChange={(e) => setV({ ...v, offlinePolicy: e.target.value })}
        >
          <NativeSelectOption value="deny_on_disconnect">
            {t("租约超时后拒绝读取（敏感内容）")}
          </NativeSelectOption>
          <NativeSelectOption value="allow_cached">
            {t("离线允许读取已验证缓存")}
          </NativeSelectOption>
        </NativeSelect>
      </Label>
      {v.consistencyMode === "pinned" && (
        <Label>
          {t("固定快照（留空使用首次挂载时的渠道快照）")}
          <NativeSelect
            value={v.pinnedSnapshotId || ""}
            onChange={(e) => setV({ ...v, pinnedSnapshotId: e.target.value })}
          >
            <NativeSelectOption value="">
              {t("首次挂载时固定")}
            </NativeSelectOption>
            {releases.data?.items.map((r: any) => (
              <NativeSelectOption key={r.id} value={r.id}>
                {short(r.id)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
      )}
      <Label>
        {t("授权 Skills")}
        <FormInput
          placeholder={t("搜索 Skills")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Label>
      <div className="multi-list">
        {Array.from(
          new Set<string>(skills.data?.items.map((s: any) => s.name) || []),
        )
          .filter((n) => n.includes(search))
          .map((name) => (
            <Label className="check-row" key={name}>
              <FormInput
                type="checkbox"
                checked={v.skills.includes(name)}
                onChange={(e) =>
                  setV({
                    ...v,
                    skills: e.target.checked
                      ? [...v.skills, name]
                      : v.skills.filter((n: string) => n !== name),
                  })
                }
              />
              <span>{name}</span>
            </Label>
          ))}
      </div>
      <Label className="check-row">
        <FormInput
          type="checkbox"
          checked={v.enabled}
          onChange={(e) => setV({ ...v, enabled: e.target.checked })}
        />
        {t("启用此 Profile")}
      </Label>
      <p className="info-note">
        {t(
          "allow_cached 无法同时保证断网期间即时撤权。dynamic 不保证跨多次 open 的任务级一致性。",
        )}
      </p>
    </FormBox>
  );
}
function ClientForm() {
  const { t } = useI18n();

  const p = useData("/agent-profiles");
  const [v, setV] = useState({ name: "", profileId: "" });
  const [token, setToken] = useState("");
  const a = useAction();
  return (
    <FormBox
      title={t("注册挂载终端")}
      description={t("为每个终端签发独立、限定 Profile 的工作负载凭据。")}
      busy={a.busy}
      feedback={
        <>
          {a.feedback}
          <QueryNotice queries={[p]} />
        </>
      }
      onSubmit={async (e) => {
        e.preventDefault();
        const out = await a.run("/mount-clients", v);
        if (out) setToken(out.token);
      }}
    >
      <Label>
        {t("终端名称")}
        <FormInput
          required
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
      </Label>
      <Label>
        {t("所属 Profile")}
        <NativeSelect
          required
          value={v.profileId}
          onChange={(e) => setV({ ...v, profileId: e.target.value })}
        >
          <NativeSelectOption value="">{t("选择 Profile")}</NativeSelectOption>
          {p.data?.items
            .filter((p: any) => p.enabled)
            .map((p: any) => (
              <NativeSelectOption value={p.id} key={p.id}>
                {p.name} · {p.channel}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      </Label>
      {token && <TokenReveal token={token} close={() => setToken("")} />}
    </FormBox>
  );
}
function ReleaseForm() {
  const { t } = useI18n();

  const skills = useData("/skills");
  const channels = useData("/channels");
  const stableId = channels.data?.items.find(
    (c: any) => c.name.toLowerCase() === "stable",
  )?.snapshotId;
  const baseline = useData("/releases/" + stableId, !!stableId);
  const [initialized, setInitialized] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [reviewSkill, setReviewSkill] = useState("");
  const [ack, setAck] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [confirm, setConfirm] = useState(false);
  const a = useAction();
  const router = useRouter();
  useEffect(() => {
    if (
      initialized ||
      !skills.data ||
      !channels.data ||
      (stableId && !baseline.data)
    )
      return;
    const next: Record<string, string> = {};
    for (const item of baseline.data?.items || []) {
      const skill = skills.data.items.find((s: any) => s.name === item.name);
      // Preserve inherited versions even if the originating repository is no longer visible.
      next[skill?.id || "inherited:" + item.name] = item.versionId;
    }
    setSelected(next);
    setInitialized(true);
  }, [initialized, skills.data, channels.data, stableId, baseline.data]);
  const removed = (baseline.data?.items || []).filter(
    (item: any) =>
      !Object.values(selected).includes(item.versionId) &&
      !skills.data?.items.some(
        (s: any) => s.name === item.name && selected[s.id],
      ),
  );
  const body = {
    versionIds: Object.values(selected).filter(Boolean),
    acknowledgeWarnings: ack,
  };
  return (
    <ReleaseSheet>
      <Header
        title={t("创建发布快照")}
        kicker="RELEASE / COMPOSE"
        description={t(
          "选择完整的 Skill 版本集合。创建快照后，再选择 Canary 或 Stable 渠道推进。",
        )}
      />
      <Card className="panel detail-panel">
        {a.feedback}
        <QueryNotice
          queries={[skills, channels, ...(stableId ? [baseline] : [])]}
        />
        <div className="release-baseline">
          <strong>{t("完整集合基线")}</strong>
          <code>
            {stableId
              ? "Stable · " + stableId.slice(0, 12)
              : t("首次发布 · 空集合")}
          </code>
          <p className="fine">
            {t("默认继承 Stable 中所有 Skills，替换版本后重新预览。")}
          </p>
        </div>
        {removed.length > 0 && (
          <div className="diagnostic bad" role="alert">
            {t("将从完整集合移除：")}
            {removed.map((v: any) => v.name).join("、")}
          </div>
        )}
        <div className="filterbar">
          <div className="search-input">
            <Search size={16} />
            <FormInput
              placeholder={t("搜索 Skills")}
              aria-label={t("搜索候选 Skills")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span>
            {t("已选择 {count} 个版本", { count: body.versionIds.length })}
          </span>
        </div>
        {Object.entries(selected)
          .filter(([key, value]) => key.startsWith("inherited:") && value)
          .map(([key, value]) => (
            <div className="release-choice" key={key}>
              <div>
                <strong>{key.slice(10)}</strong>
                <p className="fine">
                  {t("从 Stable 继承 · 来源仓库当前不可见 ·")}
                  {value}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected({ ...selected, [key]: "" });
                  setPreview(null);
                }}
              >
                {t("从本次快照移除")}
              </Button>
            </div>
          ))}
        {skills.data?.items
          .filter((s: any) => s.name.includes(search))
          .map((s: any) => (
            <ReleaseChoice
              key={s.id}
              skill={s}
              value={selected[s.id] || ""}
              disabled={!initialized}
              onChange={(v) => {
                setSelected({ ...selected, [s.id]: v });
                setPreview(null);
              }}
            />
          ))}
        {skills.data?.items.length === 0 && (
          <Empty
            title={t("还没有可发布版本")}
            description={t(
              "接入仓库并完成一次成功的校验后，版本将出现在这里。",
            )}
            href="/repositories/new"
            action={t("接入仓库")}
          />
        )}
        {initialized && skills.data?.items.length > 0 && (
          <section className="composer-review">
            <div className="section-heading">
              <h3>{t("审阅版本差异")}</h3>
              <NativeSelect
                aria-label={t("审阅 Skill")}
                value={reviewSkill}
                onChange={(e) => setReviewSkill(e.target.value)}
              >
                <NativeSelectOption value="">
                  {t("选择要审阅的 Skill")}
                </NativeSelectOption>
                {skills.data.items.map((s: any) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            {reviewSkill && (
              <VersionDifference
                before={
                  baseline.data?.items.find(
                    (i: any) =>
                      i.name ===
                      skills.data.items.find((s: any) => s.id === reviewSkill)
                        ?.name,
                  )?.versionId
                }
                after={selected[reviewSkill]}
              />
            )}
          </section>
        )}
        <Label className="check-row">
          <FormInput
            type="checkbox"
            checked={ack}
            onChange={(e) => {
              setAck(e.target.checked);
              setPreview(null);
            }}
          />
          {t("我已审阅所选版本的安全诊断并接受脚本内容风险。")}
        </Label>
        <div className="actions">
          <Button
            variant="outline"
            disabled={!initialized || a.busy || !body.versionIds.length}
            onClick={async () => {
              const out = await a.run("/releases/preview", body);
              if (out) setPreview(out);
            }}
          >
            {t("预览完整视图")}
          </Button>
          <Button
            disabled={!preview || a.busy}
            onClick={() => setConfirm(true)}
          >
            {t("创建不可变快照")}
          </Button>
        </div>
      </Card>
      {preview && (
        <Card className="panel detail-panel">
          <h2>{t("发布预览")}</h2>
          <p>
            {t("{files} 个文件 · {skills} 个 Skill", {
              files: preview.files.length,
              skills: preview.items.length,
            })}
          </p>
          <Table items={preview.items} columns={["name", "versionId"]} />
          <h3>{t("关联 Profiles")}</h3>
          <div className="tags">
            {preview.affectedProfiles.map((p: any) => (
              <Link key={p.id} className="tag" href={"/profiles/" + p.id}>
                {p.name}
              </Link>
            ))}
          </div>
          <p className="fine">
            {t("创建快照本身不会修改渠道。渠道推进时会原子更新 generation。")}
          </p>
        </Card>
      )}
      <ConfirmDialog
        open={confirm}
        title={t("创建此不可变快照？")}
        busy={a.busy}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          const out = await a.run("/releases", body);
          if (out) router.push("/releases/" + out.id);
        }}
      >
        {t("确认所选版本组成完整发布视图，且已审阅全部安全风险。")}
      </ConfirmDialog>
    </ReleaseSheet>
  );
}
function ReleaseChoice({
  skill,
  disabled,
  value,
  onChange,
}: {
  skill: any;
  disabled?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t, locale } = useI18n();

  const versions = useData("/skills/" + skill.id + "/versions");
  return (
    <div className="release-choice">
      <Label className="check-row">
        <FormInput
          type="checkbox"
          disabled={disabled}
          checked={!!value}
          onChange={(e) =>
            onChange(e.target.checked ? skill.latestVersionId : "")
          }
        />
        <div>
          <strong>{skill.name}</strong>
          <small>
            {skill.repositoryName} / {skill.relativePath}
          </small>
        </div>
      </Label>
      <NativeSelect
        disabled={disabled}
        aria-label={skill.name + t("版本")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <NativeSelectOption value="">{t("未选择")}</NativeSelectOption>
        {versions.data?.items.map((v: any) => (
          <NativeSelectOption key={v.id} value={v.id}>
            {v.commitSha.slice(0, 12)} · {date(v.createdAt, locale)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
function Channels({
  allowed,
  initialSnapshot = "",
}: {
  allowed: boolean;
  initialSnapshot?: string;
}) {
  const { t, locale } = useI18n();

  const q = useData("/channels");
  const releases = useData("/releases");
  const [target, setTarget] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<any>(null);
  const a = useAction();
  return (
    <>
      <Header
        title={t("发布渠道")}
        kicker="DELIVERY / CHANNELS"
        description={t(
          "使用同一快照从 Canary 提升到 Stable。回滚仅切换指针，不重新构建。",
        )}
      />
      {a.feedback}
      {q.isPending ? (
        <Skeleton />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="channel-grid">
          {q.data.items.map((c: any) => (
            <Card className="panel detail-panel" key={c.id}>
              <div className="section-heading">
                <h2>{c.name}</h2>
                <Badge value={c.snapshotId ? "published" : "empty"} />
              </div>
              <p className="fine">
                {t("GENERATION")}
                {c.generation}
              </p>
              <div className="code-row">
                <code>{c.snapshotId || t("尚未发布")}</code>
                {c.snapshotId && <Copy value={c.snapshotId} />}
              </div>
              {allowed && (
                <>
                  <Label>
                    {t("目标快照")}
                    <NativeSelect
                      value={target[c.id] ?? initialSnapshot}
                      onChange={(e) =>
                        setTarget({ ...target, [c.id]: e.target.value })
                      }
                    >
                      <NativeSelectOption value="">
                        {t("选择已验证快照")}
                      </NativeSelectOption>
                      {releases.data?.items.map((s: any) => (
                        <NativeSelectOption value={s.id} key={s.id}>
                          {short(s.id)} · {s.skillCount} Skills
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Label>
                  <Button
                    disabled={!(target[c.id] ?? initialSnapshot) || a.busy}
                    onClick={() =>
                      setAction({
                        channel: c,
                        snapshotId: target[c.id] ?? initialSnapshot,
                        type: "promote",
                      })
                    }
                  >
                    {t("预览并推进")}
                    <ArrowUpRight size={15} />
                  </Button>
                </>
              )}
              <h3>{t("发布历史")}</h3>
              {c.history.length ? (
                c.history.map((h: any) => (
                  <div className="history-row" key={h.id}>
                    <div>
                      <Link href={"/releases/" + h.snapshotId}>
                        <code>{short(h.snapshotId)}</code>
                      </Link>
                      <p>{h.reason}</p>
                      <small>
                        {date(h.createdAt, locale)} · generation {h.generation}
                      </small>
                    </div>
                    {allowed && h.snapshotId !== c.snapshotId && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setAction({
                            channel: c,
                            snapshotId: h.snapshotId,
                            type: "rollback",
                          })
                        }
                      >
                        <ArrowDownLeft size={14} />
                        {t("回滚")}
                      </Button>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted">
                  {t("发布后将在这里记录操作者、原因和历史快照。")}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
      {action && (
        <ConfirmDialog
          open
          title={
            action.type === "rollback"
              ? t("回滚 ") + action.channel.name
              : t("推进 ") + action.channel.name
          }
          busy={a.busy}
          onClose={() => {
            setAction(null);
            setReason("");
          }}
          onConfirm={async () => {
            if (!reason.trim()) return;
            const out = await a.run(
              "/channels/" + action.channel.id + "/" + action.type,
              {
                snapshotId: action.snapshotId,
                expectedGeneration: action.channel.generation,
                reason,
              },
            );
            if (out) {
              setAction(null);
              setReason("");
            }
          }}
        >
          <ChannelComparison
            current={action.channel.snapshotId}
            next={action.snapshotId}
          />
          <Label>
            {t("变更原因（必填）")}
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("说明验证结果或回滚原因")}
              required
            />
          </Label>
        </ConfirmDialog>
      )}
    </>
  );
}
function ChannelComparison({
  current,
  next,
}: {
  current: string;
  next: string;
}) {
  const { t } = useI18n();

  const before = useData("/releases/" + current, !!current);
  const after = useData("/releases/" + next);
  if (after.isPending || (current && before.isPending)) return <Skeleton />;
  const old: Record<string, string> = {};
  before.data?.items.forEach((i: any) => (old[i.name] = i.versionId));
  const changes = (after.data?.items || []).map((i: any) => ({
    name: i.name,
    status: old[i.name]
      ? old[i.name] === i.versionId
        ? "unchanged"
        : "changed"
      : "added",
  }));
  for (const name of Object.keys(old)) {
    if (!changes.some((i: any) => i.name === name))
      changes.push({ name, status: "removed" });
  }
  return (
    <div>
      <p>
        {t("当前")}
        {short(current)}
        {t("→ 目标")}
        {short(next)}
      </p>
      <div className="change-preview">
        {changes.map((c: any) => (
          <div key={c.name}>
            <code>{c.name}</code>
            <Badge value={c.status} />
          </div>
        ))}
      </div>
      <p className="fine">
        {t("目标将替换此渠道的完整视图，影响所有绑定此渠道的动态 Profile。")}
      </p>
    </div>
  );
}
function SettingsPage({ tab }: { tab: string }) {
  const { t, locale } = useI18n();

  const q = useData("/settings");
  const members = useData("/members", tab === "members");
  const credentials = useData("/credentials", tab === "credentials");
  const a = useAction();
  const [edit, setEdit] = useState<any>(null);
  const [v, setV] = useState<any>({});
  return (
    <>
      <Header
        title={t("组织设置")}
        description={t("集中管理成员权限、身份提供商与服务端凭据引用。")}
      />
      <div className="tabs">
        {["general", "members", "credentials", "security"].map((t) => (
          <Link
            className={t === tab ? "active" : ""}
            key={t}
            href={"/settings/" + t}
          >
            {translate(locale, labels[t])}
          </Link>
        ))}
      </div>
      {a.feedback}
      {tab === "members" && <QueryNotice queries={[members]} />}
      {tab === "credentials" && <QueryNotice queries={[credentials]} />}
      {q.isPending ? (
        <Skeleton />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : tab === "general" || tab === "security" ? (
        <form
          className="panel form-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            await a.run(
              "/settings",
              {
                name: v.name ?? q.data.name,
                policy: v.policy ?? q.data.policy,
              },
              "PATCH",
            );
          }}
        >
          <h2>{t(labels[tab])}</h2>
          <Label>
            {t("组织名称")}
            <FormInput
              required
              value={v.name ?? q.data.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
            />
          </Label>
          <div className="properties">
            <div>
              <dt>OIDC</dt>
              <dd>
                {q.data.oidcConfigured
                  ? t("已配置")
                  : t("未配置 · 通过服务器环境变量配置")}
              </dd>
            </div>
            <div>
              <dt>{t("环境")}</dt>
              <dd>
                {q.data.production
                  ? t("Production · 强制 SSO")
                  : t("Development · 本地账号可用")}
              </dd>
            </div>
          </div>
          <p className="info-note">
            {t(
              "OIDC 使用 Authorization Code + PKCE。离线策略在每个 Profile 中显式配置；Git 网络允许列表由服务器环境管理。",
            )}
          </p>
          {tab === "security" && (
            <>
              <h3>{t("静态校验阈值")}</h3>
              {[
                ["maxFileBytes", t("单文件字节上限"), 8388608],
                ["maxTotalBytes", t("仓库总字节上限"), 67108864],
                ["maxFiles", t("最大文件数量"), 10000],
              ].map(([k, label, defaultValue]) => (
                <Label key={String(k)}>
                  {label}
                  <FormInput
                    type="number"
                    min="1"
                    value={
                      (v.policy ?? q.data.policy)[String(k)] ?? defaultValue
                    }
                    onChange={(e) =>
                      setV({
                        ...v,
                        policy: {
                          ...(v.policy ?? q.data.policy),
                          [String(k)]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </Label>
              ))}
              {[
                ["blockScripts", t("禁止分发脚本文件")],
                ["blockExternalLinks", t("禁止 Markdown 外链")],
              ].map(([k, label]) => (
                <Label className="check-row" key={k}>
                  <FormInput
                    type="checkbox"
                    checked={!!(v.policy ?? q.data.policy)[k]}
                    onChange={(e) =>
                      setV({
                        ...v,
                        policy: {
                          ...(v.policy ?? q.data.policy),
                          [k]: e.target.checked,
                        },
                      })
                    }
                  />
                  {label}
                </Label>
              ))}
            </>
          )}
          <Button disabled={a.busy}>{t("保存组织设置")}</Button>
        </form>
      ) : tab === "members" ? (
        <Card className="panel detail-panel">
          <div className="section-heading">
            <h2>{t("成员与角色")}</h2>
            <Button
              onClick={() => {
                setEdit({ kind: "member" });
                setV({
                  email: "",
                  displayName: "",
                  password: "",
                  roles: ["auditor"],
                });
              }}
            >
              <Plus size={15} />
              {t("添加成员")}
            </Button>
          </div>
          {members.data && (
            <Table
              items={members.data.items}
              columns={["displayName", "email", "roles"]}
              onSelect={(m) => {
                setEdit({ kind: "roles", id: m.id });
                setV({ roles: m.roles, active: m.active });
              }}
            />
          )}
        </Card>
      ) : tab === "credentials" ? (
        <Card className="panel detail-panel">
          <div className="section-heading">
            <h2>{t("服务端 Secret 引用")}</h2>
            <Button
              onClick={() => {
                setEdit({ kind: "credential" });
                setV({ name: "", secretRef: "" });
              }}
            >
              {t("新增引用")}
            </Button>
          </div>
          {credentials.data && (
            <Table
              items={credentials.data.items}
              columns={["name", "secretRef", "createdAt"]}
              onSelect={(c) => {
                setEdit({ kind: "credential", id: c.id });
                setV({ name: c.name, secretRef: c.secretRef });
              }}
            />
          )}
          <p className="fine">
            {t(
              "这里只保存引用，不保存或显示 Secret 明文。轮换服务器 Secret 后，可更新引用名称。",
            )}
          </p>
        </Card>
      ) : (
        <Empty
          title={t("设置页面不存在")}
          description={t("请选择上方设置分类。")}
        />
      )}
      {edit && (
        <Dialog open onOpenChange={(open) => !open && setEdit(null)}>
          <DialogContent className="member-dialog">
            <DialogHeader>
              <div className="member-dialog-eyebrow">
                <Shield size={13} />
                {t("组织管理")}
              </div>
              <DialogTitle>
                {edit.kind === "member"
                  ? t("添加组织成员")
                  : edit.kind === "roles"
                    ? t("管理成员权限")
                    : edit.id
                      ? t("编辑凭据引用")
                      : t("添加凭据引用")}
              </DialogTitle>
              <DialogDescription>
                {edit.kind === "credential"
                  ? t("关联服务器上的 Secret，平台只保存引用名称。")
                  : edit.kind === "member"
                    ? t("填写成员信息，并分配其在组织中的职责。")
                    : t("调整角色与账户状态，保存后生效。")}
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (a.busy) return;
                const p =
                  edit.kind === "roles"
                    ? "/members/" + edit.id + "/roles"
                    : edit.kind === "member"
                      ? "/members"
                      : "/credentials" + (edit.id ? "/" + edit.id : "");
                const out = await a.run(
                  p,
                  edit.kind === "roles" ? { roles: v.roles } : v,
                  edit.kind === "credential" && edit.id ? "PATCH" : "POST",
                );
                if (out && edit.kind === "roles") {
                  const status = await a.run(
                    "/members/" + edit.id,
                    { active: v.active },
                    "PATCH",
                  );
                  if (!status) return;
                }
                if (out) setEdit(null);
              }}
            >
              <div className="member-dialog-body">
                {a.feedback}

                {edit.kind === "credential" ? (
                  <>
                    <Label>
                      {t("引用名称")}
                      <FormInput
                        value={v.name}
                        onChange={(e) => setV({ ...v, name: e.target.value })}
                      />
                    </Label>
                    <Label>
                      {t("环境变量名")}
                      <FormInput
                        value={v.secretRef}
                        onChange={(e) =>
                          setV({ ...v, secretRef: e.target.value })
                        }
                      />
                    </Label>
                  </>
                ) : (
                  <>
                    {edit.kind === "roles" && (
                      <Label className="check-row">
                        <FormInput
                          type="checkbox"
                          checked={v.active}
                          onChange={(e) =>
                            setV({ ...v, active: e.target.checked })
                          }
                        />
                        {t("启用账户")}
                      </Label>
                    )}
                    {edit.kind === "member" && (
                      <>
                        <div className="member-fields">
                          {[
                            {
                              key: "email",
                              label: t("邮箱"),
                              placeholder: "name@company.com",
                              type: "email",
                            },
                            {
                              key: "displayName",
                              label: t("显示名称"),
                              placeholder: t("成员姓名"),
                              type: "text",
                            },
                            {
                              key: "password",
                              label: t("初始密码"),
                              placeholder: t("至少 14 个字符"),
                              type: "password",
                            },
                          ].map(({ key: k, label, placeholder, type }) => (
                            <Label
                              key={k}
                              className={
                                k === "password" ? "member-password" : ""
                              }
                            >
                              {label}
                              <FormInput
                                type={type}
                                placeholder={placeholder}
                                required
                                minLength={k === "password" ? 14 : undefined}
                                autoComplete={
                                  k === "password" ? "new-password" : "off"
                                }
                                value={v[k]}
                                onChange={(e) =>
                                  setV({ ...v, [k]: e.target.value })
                                }
                              />
                            </Label>
                          ))}
                        </div>
                        <p className="member-field-hint">
                          {t(
                            "初始密码用于本地登录；企业 SSO 通过已验证的邮箱匹配成员身份。",
                          )}
                        </p>
                      </>
                    )}
                    <div className="member-role-heading">
                      <h3>{t("角色与权限")}</h3>
                      <span>
                        {t("可多选 · 已选 {count} 项", {
                          count: v.roles?.length || 0,
                        })}
                      </span>
                    </div>
                    <div className="member-roles">
                      {[
                        [
                          "org_admin",
                          t("组织管理员"),
                          t("管理全部资源、成员与组织设置"),
                        ],
                        [
                          "repo_maintainer",
                          t("仓库维护者"),
                          t("维护仓库配置、同步内容与重试校验"),
                        ],
                        [
                          "release_manager",
                          t("发布管理员"),
                          t("创建发布快照，推进或回滚渠道"),
                        ],
                        [
                          "agent_manager",
                          t("Agent 管理员"),
                          t("管理 Profiles、终端及访问凭据"),
                        ],
                        ["auditor", t("审计员"), t("查看审计日志与变更记录")],
                      ].map(([role, name, description]) => (
                        <Label
                          className={
                            v.roles?.includes(role)
                              ? "member-role selected"
                              : "member-role"
                          }
                          key={role}
                        >
                          <FormInput
                            type="checkbox"
                            checked={v.roles?.includes(role)}
                            onChange={(e) =>
                              setV({
                                ...v,
                                roles: e.target.checked
                                  ? [...v.roles, role]
                                  : v.roles.filter((r: string) => r !== role),
                              })
                            }
                          />
                          <span className="member-role-copy">
                            <strong>{name}</strong>
                            <small>{description}</small>
                          </span>
                          {role === "org_admin" && (
                            <ShadBadge variant="outline">
                              {t("全部权限")}
                            </ShadBadge>
                          )}
                        </Label>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEdit(null)}
                >
                  {t("取消")}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    a.busy || (edit.kind !== "credential" && !v.roles?.length)
                  }
                >
                  {a.busy
                    ? t("正在保存…")
                    : edit.kind === "member"
                      ? t("添加成员")
                      : t("保存更改")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
function Account({ me }: { me: any }) {
  const { t } = useI18n();

  const a = useAction();
  const [name, setName] = useState(me.displayName);
  const router = useRouter();
  return (
    <>
      <Header
        title={t("个人账户")}
        description={t("查看组织身份、权限与当前会话。")}
      />
      <form
        className="panel form-panel"
        onSubmit={(e) => {
          e.preventDefault();
          a.run("/me", { displayName: name }, "PATCH");
        }}
      >
        {a.feedback}
        <Label>
          {t("显示名称")}
          <FormInput
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Label>
        <Label>
          {t("邮箱")}
          <FormInput disabled value={me.email} />
        </Label>
        <div className="tags">
          {me.roles.map((r: string) => (
            <span className="tag" key={r}>
              {r}
            </span>
          ))}
        </div>
        <div className="actions">
          <Button disabled={a.busy}>{t("保存资料")}</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => a.run("/auth/refresh")}
          >
            {t("续期会话")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={async () => {
              await api("/auth/logout", {});
              router.replace("/login");
            }}
          >
            <LogOut size={15} />
            {t("登出")}
          </Button>
        </div>
      </form>
    </>
  );
}
