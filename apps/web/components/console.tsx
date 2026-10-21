"use client";
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
  ChevronsUpDown,
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
import { ManagedRepository } from "./managed-repository";
import { ConfirmDialog } from "./ui/dialog";
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
function date(v: any) {
  return v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "—";
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
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const section = parts[0] || "dashboard";
  const me = useData("/me", section !== "login");
  const [mobile, setMobile] = useState(false);
  const [theme, setTheme] = useState("system");
  const [notify, setNotify] = useState(false);
  const [search, setSearch] = useState("");
  const notices = useData("/notifications", !!me.data);
  const router = useRouter();
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>('[aria-label="全局搜索 Skills"]')
          ?.focus();
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
  return (
    <div className="app">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <Link href="/dashboard" className="brand">
          <div className="brand-mark">
            <Layers size={22} />
          </div>
          <span>
            skills<span className="brand-light"> / enterprise</span>
          </span>
        </Link>
        <div className="workspace">
          <div className="workspace-icon">E</div>
          <div>
            <strong>Enterprise workspace</strong>
            <small>PRIVATE ORGANIZATION</small>
          </div>
          <ChevronsUpDown size={14} />
        </div>
        <div className="nav-label">CONTROL PLANE</div>
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
                <span>{label}</span>
                {section === key && <span className="active-dot" />}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <Link className="nav-item" href="/docs">
            <BookOpen size={18} />
            使用文档
          </Link>
          {permitted("org_admin") && (
            <Link
              className={
                section === "settings" ? "nav-item active" : "nav-item"
              }
              href="/settings/general"
            >
              <Settings size={18} />
              组织设置
            </Link>
          )}
          <div className="system-state">
            <span className="dot" /> 已连接控制平面 <code>v1</code>
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
      {mobile && (
        <button
          className="scrim"
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main">
        <header className="topbar">
          <button
            className="icon mobile-menu"
            aria-label="打开导航"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            {parts.map((p, i) => (
              <span key={i}>
                <ChevronRight size={13} />
                {labels[p] || short(p)}
              </span>
            ))}
          </div>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              router.push("/skills?query=" + encodeURIComponent(search));
            }}
          >
            <Search size={15} />
            <input
              aria-label="全局搜索 Skills"
              placeholder="搜索 Skills…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>↵</kbd>
          </form>
          <button
            className="icon"
            aria-label="切换主题"
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
          </button>
          <button
            className="icon notification"
            aria-label="通知中心"
            onClick={() => setNotify(!notify)}
          >
            <Bell size={18} />
            {notices.data?.items.some((n: any) => !n.read) && <i />}
          </button>
          {notify && (
            <div className="notifications panel">
              <h3>通知中心</h3>
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
                    <small>{date(n.createdAt)}</small>
                  </Link>
                ))
              ) : (
                <p className="muted">暂无通知</p>
              )}
            </div>
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
            <ErrorState error={new ApiError(403, "当前角色没有访问权限")} />
          ) : section === "error" ? (
            <ErrorState
              error={new Error("服务暂时不可用")}
              retry={() => router.push("/dashboard")}
            />
          ) : endpoints[section] ? (
            <Resource section={section} parts={parts} allowed={permitted} />
          ) : (
            <Empty
              title="404 · 页面不存在"
              description="检查地址，或返回工作区概览。"
              href="/dashboard"
              action="返回概览"
            />
          )}
        </main>
        <footer>
          SKIVA <span>不可变快照 · 可追溯发布 · 只读分发</span>
          <span>Enterprise Skills Delivery Platform</span>
        </footer>
      </div>
    </div>
  );
}
const loginSchema = z.object({
  email: z.string().regex(/^[^\s@]+@[^\s@]+$/, "请输入有效邮箱"),
  password: z.string().min(1, "请输入密码"),
});
function Login() {
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
        <div className="brand">
          <Layers /> skills / enterprise
        </div>
        <p className="eyebrow">ONE SOURCE. EVERY AGENT.</p>
        <h1>
          知识持续演进。
          <br />
          交付始终可信。
        </h1>
        <p>
          从 Git 提交到不可变发布，
          <br />
          让每一个 Agent 使用正确的 Skills。
        </p>
        <div className="login-flow">
          <GitBranch /> Git <ChevronRight />
          <Layers /> Snapshot <ChevronRight />
          <Terminal /> Agent
        </div>
        <small>ENTERPRISE SKILLS DELIVERY PLATFORM</small>
      </div>
      <div className="login-form">
        <div className="eyebrow">WELCOME BACK</div>
        <h2>登录工作区</h2>
        <p className="muted">使用企业身份或开发环境账户继续。</p>
        <a className="btn btn-outline full" href="/api/v1/auth/oidc">
          <Shield size={17} />
          企业 SSO 登录
        </a>
        <div className="divider">开发环境账户</div>
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <label>
            邮箱
            <input autoComplete="username" {...form.register("email")} />
          </label>
          {form.formState.errors.email && (
            <p className="danger">{form.formState.errors.email.message}</p>
          )}
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              {...form.register("password")}
            />
          </label>
          {m.error && (
            <p role="alert" className="danger">
              {m.error.message}
            </p>
          )}
          <Button className="full" disabled={m.isPending}>
            {m.isPending ? "正在验证…" : "登录工作区"}
            <ArrowUpRight size={17} />
          </Button>
        </form>
        <p className="fine">
          生产环境使用企业 OIDC。需要访问权限？请联系组织管理员。
        </p>
      </div>
    </div>
  );
}

function QueryNotice({ queries }: { queries: any[] }) {
  return (
    <>
      {queries.map((q, i) =>
        q.error ? (
          <div key={i}>
            {q.data ? (
              <div className="info-note">
                数据可能延迟。
                <Button variant="ghost" onClick={() => q.refetch()}>
                  重试刷新
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
  return (
    <div aria-label="正在加载" className="skeleton-wrap">
      <div className="skeleton title" />
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <Shield size={30} />
      <h2>
        {error instanceof ApiError && error.status === 403
          ? "权限不足"
          : "暂时无法完成请求"}
      </h2>
      <p>{error.message}</p>
      {error instanceof ApiError && error.requestId && (
        <code>Request ID: {error.requestId}</code>
      )}
      {retry && (
        <Button variant="outline" onClick={retry}>
          <RefreshCw size={15} />
          重试
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
  return (
    <div className="page-header">
      <div>
        <p className="eyebrow">{kicker || "WORKSPACE / CONTROL PLANE"}</p>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
function Badge({ value }: { value: string }) {
  return (
    <span
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
      {value}
    </span>
  );
}
function Copy({ value }: { value: string }) {
  const [ok, setOK] = useState(false);
  return (
    <button
      className="icon"
      aria-label="复制"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setOK(true);
        setTimeout(() => setOK(false), 1500);
      }}
    >
      {ok ? <Check size={15} /> : <Clipboard size={15} />}
    </button>
  );
}
function Dashboard() {
  const q = useData("/dashboard");
  const pipelines = useData("/pipelines");
  const channels = useData("/channels");
  if (q.isPending) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <Header
        title="交付概览"
        kicker="WORKSPACE OVERVIEW"
        description="从内容来源到 Agent 终端，每一次交付都有据可循。"
      >
        <Button variant="outline" onClick={() => q.refetch()}>
          <RefreshCw size={15} />
          刷新
        </Button>
        <Button asChild>
          <Link href="/repositories/new">
            <Plus size={16} />
            接入仓库
          </Link>
        </Button>
      </Header>
      <div className="metrics">
        {[
          ["repositories", "Git 仓库", GitBranch, "repositories"],
          ["skills", "已发现 Skills", BookOpen, "skills"],
          ["releases", "不可变快照", Layers, "releases"],
          ["clients", "授权终端", Monitor, "clients"],
        ].map(([key, label, Icon, href]: any) => (
          <Link key={key} href={"/" + href} className="metric">
            <div>
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{q.data[key]}</strong>
            <small>
              查看详情 <ArrowUpRight size={13} />
            </small>
          </Link>
        ))}
      </div>
      <div className="section-heading">
        <h2>发布渠道</h2>
        <Link href="/channels">
          管理渠道 <ArrowUpRight size={14} />
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
                ? "经过验证的正式发布视图"
                : "在小范围 Profile 中验证新版本"}
            </p>
            <div className="channel-info">
              <span>SNAPSHOT</span>
              <Link
                href={
                  c.snapshotId ? "/releases/" + c.snapshotId : "/releases/new"
                }
              >
                <code>
                  {c.snapshotId ? short(c.snapshotId) : "等待首次发布"}
                </code>
              </Link>
              <span>GENERATION</span>
              <strong>{c.generation}</strong>
            </div>
            <div className="card-foot">
              <span>{date(c.updatedAt)}</span>
              <Link href="/channels">
                查看发布历史 <ChevronRight size={13} />
              </Link>
            </div>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h2>
          最近流水线{" "}
          <span className="count">{pipelines.data?.items.length || 0}</span>
        </h2>
        <Link href="/pipelines">
          全部流水线 <ArrowUpRight size={14} />
        </Link>
      </div>
      <div className="panel">
        {pipelines.data?.items.length ? (
          <Table
            items={pipelines.data.items.slice(0, 6)}
            columns={["repositoryName", "commitSha", "status", "createdAt"]}
            section="pipelines"
          />
        ) : (
          <Empty
            title="从第一次提交开始"
            description="接入 Git 仓库，平台会校验内容并生成不可变 Skill 版本。"
            href="/repositories/new"
            action="接入 Git 仓库"
          />
        )}
      </div>
      <div className="health-strip">
        <Activity size={17} />
        <span>需要关注</span>
        <Link href="/pipelines?status=failed">
          {q.data.failedPipelines} 个失败流水线
        </Link>
        <Link href="/clients">{q.data.offlineClients} 个离线终端</Link>
        <span className="muted">数据每 30 秒刷新</span>
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
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{columnLabels[c] || c}</th>
            ))}
            {(section || onSelect) && <th />}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id || i}>
              {columns.map((c, j) => (
                <td key={c}>
                  {c === "status" ? (
                    <Badge value={item[c]} />
                  ) : c.endsWith("At") ? (
                    date(item[c])
                  ) : typeof item[c] === "boolean" ? (
                    item[c] ? (
                      "已启用"
                    ) : (
                      "已停用"
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
                </td>
              ))}
              {(section || onSelect) && (
                <td>
                  {onSelect ? (
                    <Button variant="ghost" onClick={() => onSelect(item)}>
                      管理
                    </Button>
                  ) : (
                    <Link
                      aria-label="查看详情"
                      href={"/" + section + "/" + item.id}
                    >
                      <ChevronRight size={16} />
                    </Link>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
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
      <Empty title="页面不存在" description="返回列表选择资源。" />
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
    repositories:
      "外部 Git 是唯一内容来源。配置同步与校验，保持发布内容可追溯。",
    skills: "发现并管理经过静态校验的 Skill。所有版本均绑定完整 Commit。",
    pipelines: "从 Git Tree 到不可变产物，追踪每一次校验和诊断。",
    releases: "组合完整 Skill 视图，预览变更，再推进到发布渠道。",
    profiles: "定义 Agent 可见的 Skills、发布渠道与一致性策略。",
    clients: "管理工作负载身份、在线状态和只读挂载凭据。",
    audit: "检索敏感操作的操作者、对象和变更记录。",
  };
  let items = q.data?.items || [];
  items = items.filter((v: any) =>
    JSON.stringify(v).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Header
        title={labels[section]}
        kicker={"CONTROL PLANE / " + section.toUpperCase()}
        description={descriptions[section]}
      >
        <Button variant="outline" onClick={() => q.refetch()}>
          <RefreshCw size={15} />
          刷新
        </Button>
        {create && (
          <Button asChild>
            <Link href={"/" + section + "/new"}>
              <Plus size={16} />
              {section === "repositories"
                ? "接入仓库"
                : section === "releases"
                  ? "创建快照"
                  : section === "profiles"
                    ? "新建 Profile"
                    : "注册终端"}
            </Link>
          </Button>
        )}
      </Header>
      <div className="panel">
        {q.data && q.error && <QueryNotice queries={[q]} />}
        <div className="filterbar">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="筛选列表"
              value={search}
              placeholder="按名称、来源或标识搜索…"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          {section === "pipelines" && (
            <select
              aria-label="流水线状态"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">全部状态</option>
              {["queued", "running", "succeeded", "failed", "cancelled"].map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
            </select>
          )}
          {(section === "pipelines" || section === "skills") && (
            <select
              aria-label="来源仓库筛选"
              value={filters.repoId || ""}
              onChange={(e) => {
                setFilters({ ...filters, repoId: e.target.value });
                setPage(0);
              }}
            >
              <option value="">全部仓库</option>
              {repos.data?.items.map((repo: any) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name}
                </option>
              ))}
            </select>
          )}
          <span className="muted">{items.length} 条记录</span>
        </div>
        {section === "audit" && (
          <div className="filterbar audit-filters">
            {[
              ["actor", "操作者 ID"],
              ["action", "操作"],
              ["target", "对象 ID"],
            ].map(([key, label]) => (
              <input
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
              ["from", "开始时间"],
              ["until", "结束时间"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
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
              </label>
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
            title={search ? "没有匹配结果" : "还没有" + labels[section]}
            description={search ? "尝试其他关键词。" : descriptions[section]}
            href={create ? "/" + section + "/new" : undefined}
            action="开始创建"
          />
        )}
        <div className="pagination">
          <span>第 {page + 1} 页 · 每页 20 条</span>
          <Button
            variant="ghost"
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            variant="ghost"
            disabled={(page + 1) * 20 >= items.length}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
      {selected && (
        <div className="panel detail-panel">
          <div className="section-heading">
            <h2>审计变更 · {selected.action}</h2>
            <button
              className="icon"
              onClick={() => setSelected(null)}
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </div>
          <div className="diff-grid">
            <div>
              <h4>Before</h4>
              <pre>{JSON.stringify(selected.before, null, 2)}</pre>
            </div>
            <div>
              <h4>After</h4>
              <pre>{JSON.stringify(selected.after, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function useAction() {
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
            {message}
          </div>
        )}
        {error && (
          <div className="error-note" role="alert">
            {error}
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
  return (
    <>
      <Header
        title={v.name || v.commitSha?.slice(0, 12) || short(id)}
        kicker={labels[section] + " / DETAIL"}
        description={v.description}
      >
        <Button variant="outline" asChild>
          <Link href={"/" + section}>返回列表</Link>
        </Button>
        {((section === "repositories" &&
          (allowed("repo_maintainer") || v.accessRole === "maintainer")) ||
          (section === "profiles" && allowed("agent_manager"))) && (
          <Button onClick={() => setEdit(true)}>编辑配置</Button>
        )}
        {section === "repositories" &&
          (allowed("repo_maintainer") || v.accessRole === "maintainer") && (
            <Button
              disabled={a.busy}
              onClick={() => a.run("/repositories/" + id + "/sync")}
            >
              立即同步
            </Button>
          )}
        {section === "pipelines" &&
          v.status === "failed" &&
          allowed("repo_maintainer") && (
            <Button
              disabled={a.busy}
              onClick={() => a.run("/pipelines/" + id + "/retry")}
            >
              重试校验
            </Button>
          )}
      </Header>
      {a.feedback}
      <div className="panel detail-panel">
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
                <dt>{columnLabels[k] || k}</dt>
                <dd>
                  {k === "status" ? (
                    <Badge value={String(val)} />
                  ) : typeof val === "boolean" ? (
                    val ? (
                      "是"
                    ) : (
                      "否"
                    )
                  ) : (
                    <span>{k.endsWith("At") ? date(val) : String(val)}</span>
                  )}
                  {typeof val === "string" && val.length > 20 && (
                    <Copy value={val} />
                  )}
                </dd>
              </div>
            ))}
        </div>
      </div>
      {section === "repositories" && v.sourceType === "managed" && (
        <ManagedRepository id={id} />
      )}
      {section === "repositories" && v.sourceType !== "managed" && (
        <div className="panel detail-panel">
          <h2>Webhook 与同步</h2>
          {v.syncJobs?.map((job: any) => (
            <div className="history-row" key={job.id}>
              <Badge value={job.status} />
              <span className="muted">{job.error || "同步任务"}</span>
              <small>尝试 {job.attempts}</small>
            </div>
          ))}
          <p className="muted">
            选择 Git 服务提供商，配置 Push 事件与服务器 Secret
            引用。轮询每分钟补偿遗漏事件。
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
            GitHub：X-Hub-Signature-256；Gitea：X-Gitea-Signature；GitLab：X-Gitlab-Token。Secret
            仅保存在服务器。
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
                测试连接
              </Button>
              <Button
                variant="destructive"
                onClick={() => setConfirm("delete")}
              >
                软删除仓库
              </Button>
            </div>
          )}
        </div>
      )}
      {section === "pipelines" && (
        <div className="panel detail-panel">
          <h2>构建阶段与诊断</h2>
          {v.steps.map((s: any) => (
            <div className="pipeline-step" key={s.key}>
              <div className="step-dot">
                <Check size={15} />
              </div>
              <div>
                <div className="section-heading">
                  <h3>{s.key}</h3>
                  <Badge value={s.status} />
                </div>
                <p className="fine">
                  {date(s.startedAt)} → {date(s.endedAt)}
                </p>
                {s.diagnostics.map((d: any, i: number) => (
                  <div
                    className={
                      d.severity === "blocker" ? "diagnostic bad" : "diagnostic"
                    }
                    key={i}
                  >
                    <strong>{d.ruleId}</strong>
                    <code>
                      {d.path}:{d.line}
                    </code>
                    <p>{d.message}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
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
        <div className="panel detail-panel">
          <h2>完整发布视图</h2>
          <Table items={v.items || []} columns={["name", "versionId"]} />
          <p className="muted">该快照不可修改。请在发布渠道页面预览并推进。</p>
          <Button asChild>
            <Link href="/channels">
              管理发布渠道 <ArrowUpRight size={15} />
            </Link>
          </Button>
        </div>
      )}
      {section === "profiles" && (
        <div className="panel detail-panel">
          <h2>授权 Skills</h2>
          <div className="tags">
            {v.skills.map((s: string) => (
              <span className="tag" key={s}>
                {s}
              </span>
            ))}
          </div>
          <h2>只读挂载指引</h2>
          <p className="muted">
            {v.consistencyMode === "pinned"
              ? "Pinned 固定任务快照，任务期间不会自动切换。"
              : "Dynamic 的新 open 可读取新版本；已打开句柄保持旧内容。多次 open 不保证任务级一致性。"}
          </p>
          <pre>
            skills-mount login --server https://YOUR_SERVER --token-file
            ./client.token{"\n"}skills-mount mount --profile {id} --mode{" "}
            {v.consistencyMode} --path ~/agent-skills
          </pre>
          <p className="fine">
            Linux FUSE 首发。macOS / Windows 尚未完成兼容验收。离线策略：
            {v.offlinePolicy}。
          </p>
          <Button asChild>
            <Link href="/clients/new">注册挂载终端</Link>
          </Button>
        </div>
      )}
      {section === "clients" && (
        <div className="panel detail-panel">
          <h2>工作负载凭据</h2>
          <p className="muted">
            凭据仅授权此终端所属 Profile。轮换后旧凭据立即失效。
          </p>
          {allowed("agent_manager") && (
            <div className="actions">
              <Button
                variant="outline"
                disabled={v.status === "revoked"}
                onClick={() => setConfirm("rotate")}
              >
                轮换凭据
              </Button>
              <Button
                variant="destructive"
                disabled={v.status === "revoked"}
                onClick={() => setConfirm("revoke")}
              >
                吊销终端
              </Button>
            </div>
          )}
          {token && <TokenReveal token={token} close={() => setToken("")} />}
          <h3>最近遥测</h3>
          <pre>{JSON.stringify(v.telemetry || {}, null, 2)}</pre>
        </div>
      )}
      <ConfirmDialog
        open={!!confirm}
        title={
          confirm === "delete"
            ? "软删除此仓库？"
            : confirm === "rotate"
              ? "轮换终端凭据？"
              : "吊销终端授权？"
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
        此操作会影响后续同步或客户端访问。已发布快照仍保留用于审计和回滚。
      </ConfirmDialog>
    </>
  );
}
function TokenReveal({ token, close }: { token: string; close: () => void }) {
  return (
    <div className="token-reveal">
      <h3>凭据仅显示一次</h3>
      <p>现在复制并保存到权限为 0600 的文件。请勿将令牌写入日志或仓库。</p>
      <div className="code-row">
        <code>{token}</code>
        <Copy value={token} />
      </div>
      <Button variant="outline" onClick={close}>
        已安全保存
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
    <div className="panel detail-panel">
      <div className="section-heading">
        <h2>版本与内容</h2>
        <select
          aria-label="当前版本"
          value={vid}
          onChange={(e) => setVid(e.target.value)}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.commitSha.slice(0, 12)} · {date(v.createdAt)}
            </option>
          ))}
        </select>
      </div>
      <div className="file-browser">
        <div className="file-tree">
          {tree.data?.items.map((f: any) => (
            <button
              className={file === f.path ? "selected" : ""}
              key={f.path}
              onClick={() => setFile(f.path)}
            >
              {f.path}
            </button>
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
                    <span className="muted">[图片：{alt || "附件"}]</span>
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
        <h3>比较历史版本</h3>
        <select
          aria-label="比较版本"
          value={against}
          onChange={(e) => setAgainst(e.target.value)}
        >
          <option value="">选择对比版本</option>
          {versions
            .filter((v) => v.id !== vid)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.commitSha.slice(0, 12)}
              </option>
            ))}
        </select>
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
    </div>
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
        !window.confirm("有未保存的更改。确认离开？")
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
  }, [dirty, changed]);
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
          <span className="fine">所有变更在服务端校验并记录审计。</span>
          <Button disabled={busy}>
            {busy ? "正在保存…" : "保存配置"}
            <ArrowUpRight size={15} />
          </Button>
        </div>
      </form>
    </>
  );
}
function RepositoryForm({ initial }: { initial?: any }) {
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
    ["name", "仓库名称", "例如 engineering-skills"],
    ["remoteUrl", "Git URL", "https://git.example.com/team/skills.git"],
    ["defaultRef", "默认分支 / Ref", "refs/heads/main"],
    ["skillRoot", "扫描根目录", "单 Skill 根仓库留空；Monorepo 填 skills"],
    ["credentialId", "凭据引用 ID（可选）", "组织设置中配置的凭据 ID"],
    [
      "webhookSecretRef",
      "Webhook Secret 环境变量（可选）",
      "SKIVA_WEBHOOK_SECRET",
    ],
  ].filter(
    ([key]) =>
      !managed ||
      !["remoteUrl", "credentialId", "webhookSecretRef"].includes(key),
  );
  return (
    <FormBox
      title={initial ? "编辑仓库" : "接入 Git 仓库"}
      description="选择平台托管或外部 Git 来源。平台静态校验 Skills，不执行仓库内容。"
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
        <label>
          仓库来源
          <select
            aria-label="仓库来源"
            value={v.sourceType}
            onChange={(e) => setV({ ...v, sourceType: e.target.value })}
          >
            <option value="managed" disabled={!feature.data?.managedGitEnabled}>
              平台托管 · 直接 Clone / Push
              {!feature.data?.managedGitEnabled ? "（尚未启用）" : ""}
            </option>
            <option value="external">外部关联 · GitHub / GitLab / Gitea</option>
          </select>
        </label>
      )}
      {managed && !initial && (
        <>
          <label>
            团队命名空间
            <input
              required
              pattern="[a-z0-9][a-z0-9-]{0,62}"
              value={v.namespace}
              onChange={(e) => setV({ ...v, namespace: e.target.value })}
            />
          </label>
          <label>
            仓库路径
            <input
              required
              pattern="[a-z0-9][a-z0-9-]{0,62}"
              placeholder="sql-query"
              value={v.slug}
              onChange={(e) => setV({ ...v, slug: e.target.value })}
            />
          </label>
          <label>
            初始模板
            <select
              aria-label="初始模板"
              value={v.template}
              onChange={(e) =>
                setV({
                  ...v,
                  template: e.target.value,
                  skillRoot: e.target.value === "monorepo" ? "skills" : "",
                })
              }
            >
              <option value="single">单 Skill</option>
              <option value="monorepo">Monorepo</option>
              <option value="empty">空仓库</option>
            </select>
          </label>
          <p className="info-note">
            Clone 路径：/git/{v.namespace}/{v.slug || "仓库路径"}.git
            <br />
            main 默认禁止强推和删除。创建后配置 Git Token 即可推送；Push
            不会自动发布 Stable。
          </p>
        </>
      )}
      {fields.map(([k, label, placeholder]) => (
        <label key={k}>
          {label}
          <input
            required={["name", "remoteUrl", "defaultRef"].includes(k)}
            value={v[k] || ""}
            placeholder={placeholder}
            onChange={(e) => setV({ ...v, [k]: e.target.value })}
          />
        </label>
      ))}
      <label>
        状态
        <select
          value={v.status}
          onChange={(e) => setV({ ...v, status: e.target.value })}
        >
          <option value="active">启用</option>
          <option value="disabled">停用</option>
        </select>
      </label>
      {!managed && (
        <p className="info-note">
          私网 Git 需在服务端 SKIVA_GIT_ALLOWLIST 中明确配置主机名。Secret
          只引用服务端环境变量。
        </p>
      )}
    </FormBox>
  );
}
function ProfileForm({ initial }: { initial?: any }) {
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
      title={initial ? "编辑 Agent Profile" : "新建 Agent Profile"}
      description="明确授权视图与离线行为，为不同 Agent 分配独立配置。"
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
      <label>
        Profile 名称
        <input
          required
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
      </label>
      <div className="form-grid">
        <label>
          发布渠道
          <select
            required
            value={v.channelId}
            onChange={(e) => setV({ ...v, channelId: e.target.value })}
          >
            <option value="">选择渠道</option>
            {channels.data?.items.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          一致性模式
          <select
            value={v.consistencyMode}
            onChange={(e) => setV({ ...v, consistencyMode: e.target.value })}
          >
            <option value="dynamic">Dynamic · 新打开可见更新</option>
            <option value="pinned">Pinned · 任务固定快照</option>
          </select>
        </label>
      </div>
      <label>
        离线策略
        <select
          value={v.offlinePolicy}
          onChange={(e) => setV({ ...v, offlinePolicy: e.target.value })}
        >
          <option value="deny_on_disconnect">
            租约超时后拒绝读取（敏感内容）
          </option>
          <option value="allow_cached">离线允许读取已验证缓存</option>
        </select>
      </label>
      {v.consistencyMode === "pinned" && (
        <label>
          固定快照（留空使用首次挂载时的渠道快照）
          <select
            value={v.pinnedSnapshotId || ""}
            onChange={(e) => setV({ ...v, pinnedSnapshotId: e.target.value })}
          >
            <option value="">首次挂载时固定</option>
            {releases.data?.items.map((r: any) => (
              <option key={r.id} value={r.id}>
                {short(r.id)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        授权 Skills
        <input
          placeholder="搜索 Skills"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="multi-list">
        {Array.from(
          new Set<string>(skills.data?.items.map((s: any) => s.name) || []),
        )
          .filter((n) => n.includes(search))
          .map((name) => (
            <label className="check-row" key={name}>
              <input
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
            </label>
          ))}
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={v.enabled}
          onChange={(e) => setV({ ...v, enabled: e.target.checked })}
        />
        启用此 Profile
      </label>
      <p className="info-note">
        allow_cached 无法同时保证断网期间即时撤权。dynamic 不保证跨多次 open
        的任务级一致性。
      </p>
    </FormBox>
  );
}
function ClientForm() {
  const p = useData("/agent-profiles");
  const [v, setV] = useState({ name: "", profileId: "" });
  const [token, setToken] = useState("");
  const a = useAction();
  return (
    <FormBox
      title="注册挂载终端"
      description="为每个终端签发独立、限定 Profile 的工作负载凭据。"
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
      <label>
        终端名称
        <input
          required
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
      </label>
      <label>
        所属 Profile
        <select
          required
          value={v.profileId}
          onChange={(e) => setV({ ...v, profileId: e.target.value })}
        >
          <option value="">选择 Profile</option>
          {p.data?.items
            .filter((p: any) => p.enabled)
            .map((p: any) => (
              <option value={p.id} key={p.id}>
                {p.name} · {p.channel}
              </option>
            ))}
        </select>
      </label>
      {token && <TokenReveal token={token} close={() => setToken("")} />}
    </FormBox>
  );
}
function ReleaseForm() {
  const skills = useData("/skills");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [ack, setAck] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [confirm, setConfirm] = useState(false);
  const a = useAction();
  const router = useRouter();
  const body = {
    versionIds: Object.values(selected).filter(Boolean),
    acknowledgeWarnings: ack,
  };
  return (
    <>
      <Header
        title="创建发布快照"
        kicker="RELEASE / COMPOSE"
        description="选择完整的 Skill 版本集合。创建快照后，再选择 Canary 或 Stable 渠道推进。"
      />
      <div className="panel detail-panel">
        {a.feedback}
        <QueryNotice queries={[skills]} />
        <div className="filterbar">
          <div className="search-input">
            <Search size={16} />
            <input
              placeholder="搜索 Skills"
              aria-label="搜索候选 Skills"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span>{body.versionIds.length} 个版本已选</span>
        </div>
        {skills.data?.items
          .filter((s: any) => s.name.includes(search))
          .map((s: any) => (
            <ReleaseChoice
              key={s.id}
              skill={s}
              value={selected[s.id] || ""}
              onChange={(v) => {
                setSelected({ ...selected, [s.id]: v });
                setPreview(null);
              }}
            />
          ))}
        {skills.data?.items.length === 0 && (
          <Empty
            title="还没有可发布版本"
            description="接入仓库并完成一次成功的校验后，版本将出现在这里。"
            href="/repositories/new"
            action="接入仓库"
          />
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => {
              setAck(e.target.checked);
              setPreview(null);
            }}
          />
          我已审阅所选版本的安全诊断并接受脚本内容风险。
        </label>
        <div className="actions">
          <Button
            variant="outline"
            disabled={a.busy || !body.versionIds.length}
            onClick={async () => {
              const out = await a.run("/releases/preview", body);
              if (out) setPreview(out);
            }}
          >
            预览完整视图
          </Button>
          <Button
            disabled={!preview || a.busy}
            onClick={() => setConfirm(true)}
          >
            创建不可变快照
          </Button>
        </div>
      </div>
      {preview && (
        <div className="panel detail-panel">
          <h2>发布预览</h2>
          <p>
            {preview.files.length} 个文件 · {preview.items.length} 个 Skill
          </p>
          <Table items={preview.items} columns={["name", "versionId"]} />
          <h3>关联 Profiles</h3>
          <div className="tags">
            {preview.affectedProfiles.map((p: any) => (
              <Link key={p.id} className="tag" href={"/profiles/" + p.id}>
                {p.name}
              </Link>
            ))}
          </div>
          <p className="fine">
            创建快照本身不会修改渠道。渠道推进时会原子更新 generation。
          </p>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title="创建此不可变快照？"
        busy={a.busy}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          const out = await a.run("/releases", body);
          if (out) router.push("/releases/" + out.id);
        }}
      >
        确认所选版本组成完整发布视图，且已审阅全部安全风险。
      </ConfirmDialog>
    </>
  );
}
function ReleaseChoice({
  skill,
  value,
  onChange,
}: {
  skill: any;
  value: string;
  onChange: (v: string) => void;
}) {
  const versions = useData("/skills/" + skill.id + "/versions");
  return (
    <div className="release-choice">
      <label className="check-row">
        <input
          type="checkbox"
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
      </label>
      <select
        aria-label={skill.name + "版本"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">未选择</option>
        {versions.data?.items.map((v: any) => (
          <option key={v.id} value={v.id}>
            {v.commitSha.slice(0, 12)} · {date(v.createdAt)}
          </option>
        ))}
      </select>
    </div>
  );
}
function Channels({ allowed }: { allowed: boolean }) {
  const q = useData("/channels");
  const releases = useData("/releases");
  const [target, setTarget] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<any>(null);
  const a = useAction();
  return (
    <>
      <Header
        title="发布渠道"
        kicker="DELIVERY / CHANNELS"
        description="使用同一快照从 Canary 提升到 Stable。回滚仅切换指针，不重新构建。"
      />
      {a.feedback}
      {q.isPending ? (
        <Skeleton />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="channel-grid">
          {q.data.items.map((c: any) => (
            <div className="panel detail-panel" key={c.id}>
              <div className="section-heading">
                <h2>{c.name}</h2>
                <Badge value={c.snapshotId ? "published" : "empty"} />
              </div>
              <p className="fine">GENERATION {c.generation}</p>
              <div className="code-row">
                <code>{c.snapshotId || "尚未发布"}</code>
                {c.snapshotId && <Copy value={c.snapshotId} />}
              </div>
              {allowed && (
                <>
                  <label>
                    目标快照
                    <select
                      value={target[c.id] || ""}
                      onChange={(e) =>
                        setTarget({ ...target, [c.id]: e.target.value })
                      }
                    >
                      <option value="">选择已验证快照</option>
                      {releases.data?.items.map((s: any) => (
                        <option value={s.id} key={s.id}>
                          {short(s.id)} · {s.skillCount} Skills
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    disabled={!target[c.id] || a.busy}
                    onClick={() =>
                      setAction({
                        channel: c,
                        snapshotId: target[c.id],
                        type: "promote",
                      })
                    }
                  >
                    预览并推进 <ArrowUpRight size={15} />
                  </Button>
                </>
              )}
              <h3>发布历史</h3>
              {c.history.length ? (
                c.history.map((h: any) => (
                  <div className="history-row" key={h.id}>
                    <div>
                      <Link href={"/releases/" + h.snapshotId}>
                        <code>{short(h.snapshotId)}</code>
                      </Link>
                      <p>{h.reason}</p>
                      <small>
                        {date(h.createdAt)} · generation {h.generation}
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
                        回滚
                      </Button>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted">
                  发布后将在这里记录操作者、原因和历史快照。
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {action && (
        <ConfirmDialog
          open
          title={
            action.type === "rollback"
              ? "回滚 " + action.channel.name
              : "推进 " + action.channel.name
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
          <label>
            变更原因（必填）
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="说明验证结果或回滚原因"
              required
            />
          </label>
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
        当前 {short(current)} → 目标 {short(next)}
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
        目标将替换此渠道的完整视图，影响所有绑定此渠道的动态 Profile。
      </p>
    </div>
  );
}
function SettingsPage({ tab }: { tab: string }) {
  const q = useData("/settings");
  const members = useData("/members", tab === "members");
  const credentials = useData("/credentials", tab === "credentials");
  const a = useAction();
  const [edit, setEdit] = useState<any>(null);
  const [v, setV] = useState<any>({});
  return (
    <>
      <Header
        title="组织设置"
        description="集中管理成员权限、身份提供商与服务端凭据引用。"
      />
      <div className="tabs">
        {["general", "members", "credentials", "security"].map((t) => (
          <Link
            className={t === tab ? "active" : ""}
            key={t}
            href={"/settings/" + t}
          >
            {labels[t]}
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
          <h2>{labels[tab]}</h2>
          <label>
            组织名称
            <input
              required
              value={v.name ?? q.data.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
            />
          </label>
          <div className="properties">
            <div>
              <dt>OIDC</dt>
              <dd>
                {q.data.oidcConfigured
                  ? "已配置"
                  : "未配置 · 通过服务器环境变量配置"}
              </dd>
            </div>
            <div>
              <dt>环境</dt>
              <dd>
                {q.data.production
                  ? "Production · 强制 SSO"
                  : "Development · 本地账号可用"}
              </dd>
            </div>
          </div>
          <p className="info-note">
            OIDC 使用 Authorization Code + PKCE。离线策略在每个 Profile
            中显式配置；Git 网络允许列表由服务器环境管理。
          </p>
          {tab === "security" && (
            <>
              <h3>静态校验阈值</h3>
              {[
                ["maxFileBytes", "单文件字节上限", 8388608],
                ["maxTotalBytes", "仓库总字节上限", 67108864],
                ["maxFiles", "最大文件数量", 10000],
              ].map(([k, label, defaultValue]) => (
                <label key={String(k)}>
                  {label}
                  <input
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
                </label>
              ))}
              {[
                ["blockScripts", "禁止分发脚本文件"],
                ["blockExternalLinks", "禁止 Markdown 外链"],
              ].map(([k, label]) => (
                <label className="check-row" key={k}>
                  <input
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
                </label>
              ))}
            </>
          )}
          <Button disabled={a.busy}>保存组织设置</Button>
        </form>
      ) : tab === "members" ? (
        <div className="panel detail-panel">
          <div className="section-heading">
            <h2>成员与角色</h2>
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
              添加成员
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
        </div>
      ) : tab === "credentials" ? (
        <div className="panel detail-panel">
          <div className="section-heading">
            <h2>服务端 Secret 引用</h2>
            <Button
              onClick={() => {
                setEdit({ kind: "credential" });
                setV({ name: "", secretRef: "" });
              }}
            >
              新增引用
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
            这里只保存引用，不保存或显示 Secret 明文。轮换服务器 Secret
            后，可更新引用名称。
          </p>
        </div>
      ) : (
        <Empty title="设置页面不存在" description="请选择上方设置分类。" />
      )}
      {edit && (
        <ConfirmDialog
          open
          title="保存管理配置"
          busy={a.busy}
          onClose={() => setEdit(null)}
          onConfirm={async () => {
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
          {edit.kind === "credential" ? (
            <>
              <label>
                引用名称
                <input
                  value={v.name}
                  onChange={(e) => setV({ ...v, name: e.target.value })}
                />
              </label>
              <label>
                环境变量名
                <input
                  value={v.secretRef}
                  onChange={(e) => setV({ ...v, secretRef: e.target.value })}
                />
              </label>
            </>
          ) : (
            <>
              {edit.kind === "roles" && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={v.active}
                    onChange={(e) => setV({ ...v, active: e.target.checked })}
                  />
                  启用账户
                </label>
              )}
              {edit.kind === "member" && (
                <>
                  {["email", "displayName", "password"].map((k) => (
                    <label key={k}>
                      {k}
                      <input
                        type={k === "password" ? "password" : "text"}
                        value={v[k]}
                        onChange={(e) => setV({ ...v, [k]: e.target.value })}
                      />
                    </label>
                  ))}
                  <p className="fine">
                    开发密码至少 14 个字符。企业 SSO
                    使用已预置成员的已验证邮箱绑定身份。
                  </p>
                </>
              )}
              {[
                "org_admin",
                "repo_maintainer",
                "release_manager",
                "agent_manager",
                "auditor",
              ].map((role) => (
                <label className="check-row" key={role}>
                  <input
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
                  {role}
                </label>
              ))}
            </>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
function Account({ me }: { me: any }) {
  const a = useAction();
  const [name, setName] = useState(me.displayName);
  const router = useRouter();
  return (
    <>
      <Header title="个人账户" description="查看组织身份、权限与当前会话。" />
      <form
        className="panel form-panel"
        onSubmit={(e) => {
          e.preventDefault();
          a.run("/me", { displayName: name }, "PATCH");
        }}
      >
        {a.feedback}
        <label>
          显示名称
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          邮箱
          <input disabled value={me.email} />
        </label>
        <div className="tags">
          {me.roles.map((r: string) => (
            <span className="tag" key={r}>
              {r}
            </span>
          ))}
        </div>
        <div className="actions">
          <Button disabled={a.busy}>保存资料</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => a.run("/auth/refresh")}
          >
            续期会话
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
            登出
          </Button>
        </div>
      </form>
    </>
  );
}
