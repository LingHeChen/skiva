"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  GitBranch,
  BookOpen,
  Layers,
  Activity,
  Box,
  Monitor,
  FileText,
  Copy,
  Check,
  Search,
  ArrowUpRight,
  Terminal,
  FolderGit2,
  Folder,
  ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiList } from "@/lib/api";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Skeleton } from "./ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";

type RecordData = Record<string, any>;
function useResource(path: string, enabled = true) {
  return useQuery({
    queryKey: [path],
    queryFn: () => apiList(path),
    enabled,
    retry: 1,
  });
}
function State({ q }: { q: ReturnType<typeof useResource> }) {
  if (q.isPending)
    return (
      <div className="workspace-loading">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (q.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>无法载入</AlertTitle>
        <AlertDescription>
          {q.error.message}
          <Button variant="outline" onClick={() => q.refetch()}>
            重试
          </Button>
        </AlertDescription>
      </Alert>
    );
  return null;
}
export function ClipboardButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? "已复制" : "复制内容"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setError(false);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setError(true);
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {error && <span role="status">复制失败</span>}
    </Button>
  );
}
export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const repos = useResource("/repositories", open);
  const go = (path: string) => {
    onOpenChange(false);
    router.push(path);
  };
  const pageIcons: Record<string, typeof GitBranch> = {
    repositories: FolderGit2,
    skills: BookOpen,
    releases: Layers,
    channels: GitBranch,
    pipelines: Activity,
    profiles: Box,
    clients: Monitor,
    docs: BookOpen,
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="前往工作区"
      description="搜索仓库、页面和操作"
    >
      <CommandInput placeholder="搜索仓库、页面或操作…" />
      <CommandList>
        <CommandEmpty>没有匹配的结果</CommandEmpty>
        <CommandGroup heading="工作区">
          {[
            ["repositories", "Git 仓库"],
            ["skills", "Skills Registry"],
            ["releases", "发布快照"],
            ["channels", "发布渠道"],
            ["pipelines", "流水线"],
            ["profiles", "Agent Profiles"],
            ["clients", "挂载终端"],
            ["docs", "使用文档"],
          ].map(([path, name]) => {
            const Icon = pageIcons[path];
            return (
              <CommandItem key={path} onSelect={() => go("/" + path)}>
                <Icon />
                <span className="command-item-label">{name}</span>
                <span className="command-item-hint" aria-hidden="true">
                  ↵
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandGroup heading="仓库">
          {repos.data?.items.map((r: RecordData) => (
            <CommandItem
              key={r.id}
              onSelect={() => go("/repositories/" + r.id)}
            >
              <FolderGit2 />
              <span className="command-item-label">{r.name}</span>
              <span className="command-item-hint" aria-hidden="true">
                ↵
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
export function ReleaseSheet({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">ORGANIZATION / RELEASES</span>
          <h1>准备发布</h1>
          <p className="muted">组合完整版本集合，审阅后创建不可变快照。</p>
        </div>
      </div>
      <Sheet open onOpenChange={(v) => !v && router.push("/releases")}>
        <SheetContent className="release-sheet">
          <SheetHeader>
            <SheetTitle>准备发布</SheetTitle>
            <SheetDescription>
              组织级完整快照 · 创建后不会自动推进渠道
            </SheetDescription>
          </SheetHeader>
          <div className="release-sheet-body">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
export function RepositoryWorkspace({
  repo,
  settings,
  canRelease,
  canMaintain,
  onEdit,
  onSync,
}: {
  repo: RecordData;
  settings: ReactNode;
  canRelease: boolean;
  canMaintain: boolean;
  onEdit: () => void;
  onSync: () => void;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") || "files";
  const skills = useResource("/skills?repoId=" + repo.id);
  const pipelines = useResource("/pipelines?repoId=" + repo.id);
  const channels = useResource("/channels");
  const [skillId, setSkillId] = useState("");
  const skill =
    skills.data?.items.find((s: RecordData) => s.id === skillId) ||
    skills.data?.items[0];
  const git = useResource(
    "/repositories/" + repo.id + "/git",
    repo.sourceType === "managed",
  );
  const selectedPipelines = (pipelines.data?.items || []).filter(
    (p: RecordData) =>
      p.repositoryId === repo.id || p.repositoryName === repo.name,
  );
  return (
    <div className="repository-workspace">
      <div className="repo-heading">
        <div>
          <div className="eyebrow">
            <GitBranch size={13} /> REPOSITORY
          </div>
          <h1>
            {repo.name}{" "}
            <Badge variant="outline">
              {repo.sourceType === "managed" ? "托管 Git" : "外部 Git"}
            </Badge>
          </h1>
          <p className="muted">
            {repo.description || "版本化管理 Skills，通过校验后交付给 Agent。"}
          </p>
        </div>
        <div className="actions">
          {(git.data?.cloneUrl || repo.remoteUrl) && (
            <div className="clone-control">
              <code title={git.data?.cloneUrl || repo.remoteUrl}>
                Git clone
              </code>
              <ClipboardButton
                value={"git clone " + (git.data?.cloneUrl || repo.remoteUrl)}
              />
            </div>
          )}
          {canRelease && (
            <Button asChild>
              <Link href="/releases/new">
                准备发布 <ArrowUpRight size={14} />
              </Link>
            </Button>
          )}
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => router.push(pathname + "?tab=" + v)}
        className="repo-tabs"
      >
        <TabsList className="workspace-tabs">
          {[
            ["overview", "概览"],
            ["files", "文件"],
            ["skills", "Skills"],
            ["pipelines", "流水线"],
            ["settings", "设置"],
          ].map(([v, l]) => (
            <TabsTrigger value={v} key={v}>
              {l}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <div className="workspace-overview">
            <Card>
              <h2>内容与版本</h2>
              <p>
                {skills.data?.items.length ?? "—"} 个 Skills · 引用{" "}
                <code>{repo.defaultRef || "—"}</code>
              </p>
              <p className="muted">
                {repo.sourceType === "managed"
                  ? "在文件页检查已构建内容，在设置中浏览 Git 引用、提交与完整仓库树。"
                  : "文件页展示通过构建保存的 Skill 内容，外部 Git 原始文件请在源仓库浏览。"}
              </p>
              <Button
                variant="outline"
                onClick={() => router.push(pathname + "?tab=files")}
              >
                浏览内容
              </Button>
            </Card>
            <Card>
              <h2>交付流程</h2>
              <p>推送 Git → 静态校验 → 选择版本 → 创建快照 → 推进渠道</p>
              <Button variant="outline" asChild>
                <Link href="/docs">查看使用文档</Link>
              </Button>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="files">
          <div className="repo-workbench">
            <section className="repo-editor">
              {repo.sourceType === "managed" ? (
                <GitFileBrowser repo={repo} />
              ) : (
                <>
                  <div className="file-toolbar">
                    <GitBranch size={14} />
                    <span title={repo.defaultRef}>
                      {repo.defaultRef?.replace("refs/heads/", "") ||
                        "默认引用"}
                    </span>
                    <span className="toolbar-divider" />
                    <NativeSelect
                      aria-label="选择 Skill"
                      value={skill?.id || ""}
                      onChange={(e) => setSkillId(e.target.value)}
                    >
                      {skills.data?.items.map((s: RecordData) => (
                        <NativeSelectOption key={s.id} value={s.id}>
                          {s.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Badge variant="outline">构建产物</Badge>
                  </div>
                  <State q={skills} />
                  {skill ? (
                    <VersionBrowser key={skill.id} skill={skill} />
                  ) : (
                    !skills.isPending &&
                    !skills.error && (
                      <div className="workspace-empty">
                        <FileText />
                        <h3>还没有构建内容</h3>
                        <p>
                          推送包含 SKILL.md 的提交并完成校验后，在这里检查文件。
                        </p>
                        <Button
                          variant="outline"
                          onClick={() =>
                            router.push(pathname + "?tab=settings")
                          }
                        >
                          查看仓库配置与提交
                        </Button>
                      </div>
                    )
                  )}
                </>
              )}
            </section>
            <aside className="context-rail">
              <section>
                <h3>仓库信息</h3>
                <dl>
                  <dt>来源</dt>
                  <dd>
                    {repo.sourceType === "managed" ? "Skiva Git" : "外部仓库"}
                  </dd>
                  <dt>扫描范围</dt>
                  <dd>
                    <code>
                      {repo.skillsRoot || repo.rootPath || "以仓库配置为准"}
                    </code>
                  </dd>
                  <dt>Skills</dt>
                  <dd>{skills.data?.items.length ?? "—"}</dd>
                </dl>
              </section>
              <section>
                <h3>最近校验</h3>
                {selectedPipelines.slice(0, 3).map((p: RecordData) => (
                  <Link
                    className="rail-record"
                    key={p.id}
                    href={"/pipelines/" + p.id}
                  >
                    <Badge variant="outline">{p.status}</Badge>
                    <code>{p.commitSha?.slice(0, 7)}</code>
                  </Link>
                ))}
                {!selectedPipelines.length && (
                  <p className="muted">暂无校验记录</p>
                )}
              </section>
              <section>
                <h3>组织发布渠道</h3>
                <State q={channels} />
                {channels.data?.items.map((c: RecordData) => (
                  <Link
                    className="rail-record"
                    key={c.id || c.name}
                    href="/channels"
                  >
                    <span>{c.name}</span>
                    <code>{c.snapshotId?.slice(0, 8) || "尚未发布"}</code>
                  </Link>
                ))}
                <p className="fine">渠道包含组织内的完整 Skill 集合。</p>
              </section>
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="skills">
          <State q={skills} />
          <div className="object-list">
            {skills.data?.items.map((s: RecordData) => (
              <Link className="object-row" href={"/skills/" + s.id} key={s.id}>
                <FileText />
                <div>
                  <strong>{s.name}</strong>
                  <p>{s.description || s.relativePath}</p>
                </div>
                <code>{s.relativePath}</code>
                <ArrowUpRight size={16} />
              </Link>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="pipelines">
          <State q={pipelines} />
          <div className="object-list">
            {selectedPipelines.map((p: RecordData) => (
              <Link
                className="object-row"
                href={"/pipelines/" + p.id}
                key={p.id}
              >
                <Badge variant="outline">{p.status}</Badge>
                <code>{p.commitSha?.slice(0, 12)}</code>
                <span>{new Date(p.createdAt).toLocaleString("zh-CN")}</span>
                <ArrowUpRight size={16} />
              </Link>
            ))}
            {!selectedPipelines.length && !pipelines.isPending && (
              <p className="workspace-empty">暂无校验记录</p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="settings">
          <div className="actions settings-actions">
            {canMaintain && (
              <>
                <Button variant="outline" onClick={onEdit}>
                  编辑配置
                </Button>
                <Button variant="outline" onClick={onSync}>
                  立即同步
                </Button>
              </>
            )}
          </div>
          {settings}
        </TabsContent>
      </Tabs>
    </div>
  );
}
function VersionBrowser({ skill }: { skill: RecordData }) {
  const versions = useResource("/skills/" + skill.id + "/versions");
  const [selected, setSelected] = useState("");
  const version =
    versions.data?.items.find((v: RecordData) => v.id === selected) ||
    versions.data?.items[0];
  const tree = useResource(
    "/skill-versions/" + version?.id + "/tree",
    !!version,
  );
  const [path, setPath] = useState("");
  const file =
    path ||
    tree.data?.items.find((f: RecordData) => f.path === "SKILL.md")?.path ||
    tree.data?.items[0]?.path;
  const content = useResource(
    "/skill-versions/" +
      version?.id +
      "/file?path=" +
      encodeURIComponent(file || ""),
    !!version && !!file,
  );
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("preview");
  return (
    <>
      <State q={versions} />
      {version && (
        <>
          <div className="commit-strip">
            <Badge variant="outline">已构建</Badge>
            <NativeSelect
              aria-label="构建版本"
              value={version.id}
              onChange={(e) => {
                setSelected(e.target.value);
                setPath("");
              }}
            >
              {versions.data.items.map((v: RecordData) => (
                <NativeSelectOption key={v.id} value={v.id}>
                  {v.commitSha?.slice(0, 12)} ·{" "}
                  {new Date(v.createdAt).toLocaleDateString()}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <ClipboardButton value={version.commitSha || version.id} />
            <span className="muted">内容固定于此版本</span>
          </div>
          <div className="workspace-files">
            <div className="workspace-tree">
              <div className="tree-search">
                <Search size={13} />
                <Input
                  placeholder="查找文件…"
                  aria-label="查找文件"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <State q={tree} />
              <FileTree
                files={tree.data?.items || []}
                query={query}
                selected={file}
                onSelect={setPath}
              />
            </div>
            <div className="workspace-document">
              <div className="document-toolbar">
                <code>{file || "选择文件"}</code>
                <Tabs value={mode} onValueChange={setMode}>
                  <TabsList>
                    <TabsTrigger value="preview">预览</TabsTrigger>
                    <TabsTrigger value="source">源码</TabsTrigger>
                  </TabsList>
                </Tabs>
                <ClipboardButton value={content.data?.content || ""} />
              </div>
              {file && <State q={content} />}{" "}
              {content.data &&
                (mode === "preview" && /\.md$/i.test(file) ? (
                  <article className="markdown skill-markdown">
                    <Frontmatter content={content.data.content} />
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      skipHtml
                      components={{
                        img: ({ alt }) => <span>[图片：{alt || "附件"}]</span>,
                      }}
                    >
                      {withoutFrontmatter(content.data.content)}
                    </ReactMarkdown>
                  </article>
                ) : (
                  <div className="source-lines">
                    {String(content.data.content)
                      .split("\n")
                      .map((line, i) => (
                        <div key={i}>
                          <span>{i + 1}</span>
                          <code>{line || " "}</code>
                        </div>
                      ))}
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
export function PipelineDiagnostics({ run }: { run: RecordData }) {
  const [step, setStep] = useState("");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const current =
    run.steps?.find((s: RecordData) => s.key === step) ||
    run.steps?.find((s: RecordData) => s.status === "failed") ||
    run.steps?.[0];
  const diagnostics = (current?.diagnostics || []).filter(
    (d: RecordData) =>
      (severity === "all" ||
        d.severity === "blocker" ||
        d.severity === "error") &&
      JSON.stringify(d).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="pipeline-workspace">
      <Tabs value={current?.key || ""} onValueChange={setStep}>
        <TabsList className="pipeline-stages">
          {run.steps?.map((s: RecordData, i: number) => (
            <TabsTrigger key={s.key} value={s.key}>
              <span className={"stage-indicator " + s.status}>{i + 1}</span>
              <span>
                {s.key}
                <small>{s.status}</small>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="diagnostic-console">
        <div className="diagnostic-toolbar">
          <Terminal size={16} />
          <strong>{current?.key || "尚未开始"} · 校验诊断</strong>
          <Input
            aria-label="搜索诊断"
            placeholder="搜索规则、文件、消息…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <NativeSelect
            aria-label="诊断级别"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <NativeSelectOption value="all">全部级别</NativeSelectOption>
            <NativeSelectOption value="errors">仅错误</NativeSelectOption>
          </NativeSelect>
          <ClipboardButton
            value={diagnostics
              .map(
                (d: RecordData) =>
                  `${d.severity} ${d.ruleId} ${d.path}:${d.line} ${d.message}`,
              )
              .join("\n")}
          />
        </div>
        <div className="diagnostic-meta">
          {current?.startedAt
            ? new Date(current.startedAt).toLocaleString("zh-CN")
            : "等待开始"}{" "}
          →{" "}
          {current?.endedAt
            ? new Date(current.endedAt).toLocaleString("zh-CN")
            : "尚未结束"}
          <span>后端校验器记录</span>
        </div>
        <div className="diagnostic-output">
          {diagnostics.map((d: RecordData, i: number) => (
            <div className={"diagnostic-line " + d.severity} key={i}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <Badge variant="outline">{d.severity}</Badge>
              <div>
                <strong>{d.ruleId}</strong>{" "}
                <code>
                  {d.path}
                  {d.line ? ":" + d.line : ""}
                </code>
                <p>{d.message}</p>
              </div>
            </div>
          ))}
          {!diagnostics.length && (
            <p className="diagnostic-empty">
              {query || severity !== "all"
                ? "没有匹配的诊断。"
                : "此阶段没有记录诊断。"}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

async function gitPages(
  path: string,
): Promise<RecordData & { items: RecordData[] }> {
  let offset = 0;
  const items: RecordData[] = [];
  let result: RecordData = {};
  const [endpoint, initialQuery] = path.split("?");
  const params = new URLSearchParams(initialQuery);
  params.set("limit", "200");
  do {
    params.set("offset", String(offset));
    result = await apiList(endpoint + "?" + params.toString());
    items.push(...result.items);
    if (result.commit) params.set("commit", result.commit);
    offset = result.nextOffset;
  } while (offset !== null && offset !== undefined);
  return { ...result, items };
}
function GitFileBrowser({ repo }: { repo: RecordData }) {
  const root = "/repositories/" + repo.id;
  const [reference, setReference] = useState(
    repo.defaultRef || "refs/heads/main",
  );
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("preview");
  const [history, setHistory] = useState(false);
  const refs = useQuery({
    queryKey: [root + "/refs"],
    queryFn: () => gitPages(root + "/refs"),
    retry: 1,
  });
  const treePath = root + "/tree?ref=" + encodeURIComponent(reference);
  const tree = useQuery({
    queryKey: [treePath],
    queryFn: () => gitPages(treePath),
    retry: 1,
  });
  const file =
    path ||
    tree.data?.items.find((f: RecordData) => f.path === "README.md")?.path ||
    tree.data?.items.find((f: RecordData) => f.path.endsWith("SKILL.md"))
      ?.path ||
    tree.data?.items[0]?.path;
  // Pin file reads to the tree's resolved commit, never a moving ref.
  const commit = tree.data?.commit;
  const content = useResource(
    root + "/file?commit=" + commit + "&path=" + encodeURIComponent(file || ""),
    !!file && !!commit && !tree.isFetching,
  );
  const commits = useResource(
    root + "/commits?ref=" + encodeURIComponent(reference),
    history,
  );
  return (
    <>
      <div className="file-toolbar">
        <GitBranch size={14} />
        <NativeSelect
          aria-label="Git 引用"
          value={reference}
          onChange={(e) => {
            setReference(e.target.value);
            setPath("");
          }}
        >
          {!(refs.data?.items || []).some(
            (r: RecordData) => r.ref === reference,
          ) && (
            <NativeSelectOption value={reference}>
              {reference.replace("refs/heads/", "")}
            </NativeSelectOption>
          )}
          {refs.data?.items.map((r: RecordData) => (
            <NativeSelectOption key={r.ref} value={r.ref}>
              {r.ref.replace("refs/heads/", "")}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span className="toolbar-divider" />
        <code>{commit?.slice(0, 12) || "—"}</code>
        <Button variant="ghost" onClick={() => setHistory(!history)}>
          {history ? "返回文件" : "提交历史"}
        </Button>
      </div>
      <State q={refs} />
      {history ? (
        <>
          <State q={commits} />
          {commits.data?.items.map((c: RecordData) => (
            <div className="object-row" key={c.oid}>
              <div>
                <strong>{c.subject}</strong>
                <p>
                  {c.author} · {new Date(c.date).toLocaleString("zh-CN")}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setReference(c.oid);
                  setPath("");
                  setHistory(false);
                }}
              >
                <code>{c.oid.slice(0, 8)}</code>
              </Button>
            </div>
          ))}
          {commits.data?.nextOffset != null && (
            <p className="fine">
              显示最近 50 次提交；完整历史见设置 → Commits。
            </p>
          )}
        </>
      ) : (
        <>
          <State q={tree} />
          {tree.data && (
            <div className="workspace-files">
              <div className="workspace-tree">
                <div className="tree-search">
                  <Search size={13} />
                  <Input
                    aria-label="查找仓库文件"
                    placeholder="查找文件…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <FileTree
                  files={tree.data?.items || []}
                  query={query}
                  selected={file}
                  onSelect={setPath}
                />
              </div>
              <div className="workspace-document">
                <div className="document-toolbar">
                  <code>{file || "空目录"}</code>
                  <Tabs value={mode} onValueChange={setMode}>
                    <TabsList>
                      <TabsTrigger value="preview">预览</TabsTrigger>
                      <TabsTrigger value="source">源码</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <ClipboardButton value={content.data?.content || ""} />
                </div>
                {file && <State q={content} />}{" "}
                {content.data &&
                  (mode === "preview" && /\.md$/i.test(file) ? (
                    <article className="markdown skill-markdown">
                      <Frontmatter content={content.data.content} />
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        skipHtml
                        components={{
                          img: ({ alt }) => (
                            <span>[图片：{alt || "附件"}]</span>
                          ),
                          a: ({ href, children }) => {
                            const relative =
                              href && !/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(href);
                            const target = relative
                              ? new URL(
                                  href,
                                  "https://repository.local/" + file,
                                ).pathname.slice(1)
                              : "";
                            return relative &&
                              tree.data.items.some(
                                (f: RecordData) => f.path === target,
                              ) ? (
                              <Button
                                variant="link"
                                onClick={() => setPath(target)}
                              >
                                {children}
                              </Button>
                            ) : (
                              <a
                                href={relative ? undefined : href}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {children}
                              </a>
                            );
                          },
                        }}
                      >
                        {withoutFrontmatter(content.data.content)}
                      </ReactMarkdown>
                    </article>
                  ) : (
                    <div className="source-lines">
                      {String(content.data.content)
                        .split("\n")
                        .map((line, i) => (
                          <div key={i}>
                            <span>{i + 1}</span>
                            <code>{line || " "}</code>
                          </div>
                        ))}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

export function ReleaseReview({
  release,
  channelsPanel,
}: {
  release: RecordData;
  channelsPanel: ReactNode;
}) {
  const channels = useResource("/channels");
  const snapshots = useResource("/releases");
  const [against, setAgainst] = useState("");
  const stable = channels.data?.items.find(
    (c: RecordData) => c.name.toLowerCase() === "stable",
  )?.snapshotId;
  const baseline = against || (stable !== release.id ? stable : "");
  const before = useResource("/releases/" + baseline, !!baseline);
  const names = Array.from(
    new Set<string>([
      ...(before.data?.items || []).map((s: RecordData) => s.name),
      ...(release.items || []).map((s: RecordData) => s.name),
    ]),
  );
  const [selected, setSelected] = useState("");
  const name = selected || names[0];
  const old = before.data?.items.find((s: RecordData) => s.name === name);
  const next = release.items?.find((s: RecordData) => s.name === name);
  return (
    <Tabs defaultValue="contents">
      <TabsList className="workspace-tabs">
        <TabsTrigger value="contents">完整内容</TabsTrigger>
        <TabsTrigger value="diff">版本差异</TabsTrigger>
        <TabsTrigger value="channels">渠道与记录</TabsTrigger>
      </TabsList>
      <TabsContent value="contents">
        <div className="object-list">
          {release.items?.map((s: RecordData) => (
            <div className="object-row" key={s.name}>
              <FileText size={16} />
              <div>
                <strong>{s.name}</strong>
              </div>
              <code>{s.versionId}</code>
              <ClipboardButton value={s.versionId} />
            </div>
          ))}
        </div>
        <p className="fine">
          不可变快照 · {release.items?.length || 0} 个 Skills ·
          渠道推进在「渠道与记录」中完成。
        </p>
      </TabsContent>
      <TabsContent value="diff">
        <div className="filterbar">
          <NativeSelect
            aria-label="对比快照"
            value={baseline || ""}
            onChange={(e) => setAgainst(e.target.value)}
          >
            <NativeSelectOption value="">选择基线快照</NativeSelectOption>
            {snapshots.data?.items
              .filter((r: RecordData) => r.id !== release.id)
              .map((r: RecordData) => (
                <NativeSelectOption value={r.id} key={r.id}>
                  {r.id.slice(0, 12)} ·{" "}
                  {new Date(r.createdAt).toLocaleDateString()}
                </NativeSelectOption>
              ))}
          </NativeSelect>
          <NativeSelect
            aria-label="对比 Skill"
            value={name || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {names.map((n) => (
              <NativeSelectOption key={n}>{n}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {baseline ? (
          <>
            <State q={before} />
            {before.data && (
              <VersionDifference
                before={old?.versionId}
                after={next?.versionId}
              />
            )}
          </>
        ) : (
          <p className="workspace-empty">选择一个已有快照作为对比基线。</p>
        )}
      </TabsContent>
      <TabsContent value="channels">{channelsPanel}</TabsContent>
    </Tabs>
  );
}
export function VersionDifference({
  before,
  after,
}: {
  before?: string;
  after?: string;
}) {
  const comparison = useResource(
    "/skill-versions/" + after + "/diff?against=" + before,
    !!before && !!after && before !== after,
  );
  const tree = useResource(
    "/skill-versions/" + (after || before) + "/tree",
    (!before || !after) && !!(after || before),
  );
  if (before === after)
    return <div className="release-baseline">此 Skill 的版本没有变化。</div>;
  if (!before || !after)
    return (
      <>
        <div className={after ? "release-baseline" : "diagnostic bad"}>
          {after
            ? "新增 Skill，包含以下文件"
            : "此 Skill 将被移除，包含以下文件"}
        </div>
        <State q={tree} />
        {tree.data?.items.map((f: RecordData) => (
          <SingleFileReview
            key={f.path}
            version={after || before || ""}
            path={f.path}
            removed={!after}
          />
        ))}
      </>
    );
  return (
    <>
      <State q={comparison} />
      {comparison.data?.items.map((f: RecordData) => (
        <div className="version-difference" key={f.path}>
          <div className="document-toolbar">
            <code>{f.path}</code>
            <Badge variant="outline">{f.status}</Badge>
          </div>
          <div className="diff-grid">
            <div>
              <div className="diff-label">基线 · {before.slice(0, 8)}</div>
              <pre className="diff-before">{f.before || "（无内容）"}</pre>
            </div>
            <div>
              <div className="diff-label">候选 · {after.slice(0, 8)}</div>
              <pre className="diff-after">{f.after || "（无内容）"}</pre>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
function SingleFileReview({
  version,
  path,
  removed,
}: {
  version: string;
  path: string;
  removed: boolean;
}) {
  const q = useResource(
    "/skill-versions/" + version + "/file?path=" + encodeURIComponent(path),
  );
  return (
    <div className="version-difference">
      <div className="document-toolbar">
        <code>{path}</code>
        <Badge variant="outline">{removed ? "removed" : "added"}</Badge>
      </div>
      <State q={q} />
      {q.data && (
        <pre className={removed ? "diff-before" : "diff-after"}>
          {q.data.content}
        </pre>
      )}
    </div>
  );
}
export function AgentDeliveryOverview() {
  const clients = useResource("/mount-clients");
  const profiles = useResource("/agent-profiles");
  const channels = useResource("/channels");
  return (
    <section className="agent-delivery">
      <div className="section-heading">
        <h2>Agent 交付状态</h2>
        <Button asChild variant="outline">
          <Link href="/profiles">管理 Profiles</Link>
        </Button>
      </div>
      <State q={clients} />
      <div className="object-list">
        {clients.data?.items.map((c: RecordData) => {
          const p = profiles.data?.items.find(
            (p: RecordData) => p.id === c.profileId,
          );
          const channel = channels.data?.items.find(
            (ch: RecordData) => ch.name === p?.channel,
          );
          return (
            <Link className="object-row" href={"/clients/" + c.id} key={c.id}>
              <Terminal size={16} />
              <div>
                <strong>{c.name}</strong>
                <p>
                  {c.profileName || p?.name} · {p?.consistencyMode || "—"} ·{" "}
                  {p?.channel || "未绑定渠道"}
                </p>
              </div>
              <div>
                <small className="muted">最近上报快照</small>
                <p>
                  <code>{c.snapshotId?.slice(0, 12) || "尚未上报"}</code>
                </p>
              </div>
              <div>
                <small className="muted">
                  {p?.consistencyMode === "pinned"
                    ? "固定任务，不自动跟随"
                    : "渠道目标快照"}
                </small>
                <p>
                  <code>
                    {p?.consistencyMode === "pinned"
                      ? "由任务固定"
                      : channel?.snapshotId?.slice(0, 12) || "尚未发布"}
                  </code>
                </p>
              </div>
              <Badge variant="outline">{c.status}</Badge>
            </Link>
          );
        })}
        {clients.data?.items.length === 0 && (
          <p className="workspace-empty">
            创建 Profile 后注册终端，连接 Agent 查看真实上报。
          </p>
        )}
      </div>
    </section>
  );
}

function withoutFrontmatter(content: string) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
}
function Frontmatter({ content }: { content: string }) {
  const metadata = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!metadata) return null;
  return (
    <Collapsible className="file-metadata">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm">
          元数据 <Badge variant="outline">YAML</Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre>{metadata}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FileTree({
  files,
  query,
  selected,
  onSelect,
  prefix = "",
}: {
  files: RecordData[];
  query: string;
  selected?: string;
  onSelect: (path: string) => void;
  prefix?: string;
}) {
  const visible = files.filter(
    (f) =>
      f.path.toLowerCase().includes(query.toLowerCase()) &&
      f.path.startsWith(prefix),
  );
  const entries = Array.from(
    new Set<string>(
      visible.map((f) => f.path.slice(prefix.length).split("/")[0]),
    ),
  ).sort();
  return (
    <>
      {entries.map((name) => {
        const path = prefix + name;
        const directory = visible.some((f) => f.path.startsWith(path + "/"));
        return directory ? (
          <Collapsible defaultOpen key={path}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="tree-folder">
                <ChevronRight size={12} />
                <Folder size={14} />
                {name}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="tree-children">
              <FileTree
                files={visible}
                query={query}
                selected={selected}
                onSelect={onSelect}
                prefix={path + "/"}
              />
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <Button
            key={path}
            variant="ghost"
            className={selected === path ? "tree-file active" : "tree-file"}
            title={path}
            onClick={() => onSelect(path)}
          >
            <FileText size={14} />
            <span>{name}</span>
          </Button>
        );
      })}
      {!prefix && !entries.length && <p className="fine">没有匹配的文件</p>}
    </>
  );
}
