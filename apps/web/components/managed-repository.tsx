"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/dialog";

type Policy = {
  protectedBranches: string[];
  triggerRefs: string[];
  denyForcePush: boolean;
  protectTags: boolean;
  maxPushBytes: number;
  maxRepoBytes: number;
  maxFileBytes: number;
  maxFiles: number;
};
function CopyText({ value }: { value: string }) {
  const [note, setNote] = useState("");
  return (
    <span className="hosting-copy">
      <code>{value}</code>
      <Button
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setNote("已复制");
          } catch {
            setNote("复制失败，请手动选择文本");
          }
        }}
      >
        复制
      </Button>
      <span role="status">{note}</span>
    </span>
  );
}
export function ManagedRepository({ id }: { id: string }) {
  const router = useRouter();
  const [danger, setDanger] = useState("");
  const root = "/repositories/" + id,
    qc = useQueryClient();
  const [tab, setTab] = useState("events"),
    [offset, setOffset] = useState(0),
    [commit, setCommit] = useState(""),
    [base, setBase] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [secret, setSecret] = useState("");
  const [revoke, setRevoke] = useState(""),
    [name, setName] = useState("我的开发电脑"),
    [days, setDays] = useState(30),
    [write, setWrite] = useState(false);
  const [policy, setPolicy] = useState<Policy | null>(null),
    [userId, setUserId] = useState(""),
    [role, setRole] = useState("viewer");
  const info = useQuery({
    queryKey: [root + "/git"],
    queryFn: () => api(root + "/git"),
    refetchInterval: 5000,
  });
  const data = useQuery({
    queryKey: [root, tab, offset, commit, base],
    queryFn: () =>
      api(
        root +
          "/" +
          tab +
          "?offset=" +
          offset +
          "&commit=" +
          encodeURIComponent(commit) +
          "&from=" +
          encodeURIComponent(base),
      ),
    enabled:
      info.data?.provisionState === "active" &&
      !["tokens", "policies"].includes(tab),
    retry: 1,
    refetchInterval: tab === "events" ? 5000 : false,
  });
  const tokens = useQuery({
    queryKey: ["/git-tokens"],
    queryFn: () => api("/git-tokens"),
    enabled: tab === "tokens",
  });
  async function act(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setMessage("");
    try {
      const result = await api(path, body, method);
      await qc.invalidateQueries();
      setMessage("操作成功");
      return result;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  if (info.isPending)
    return (
      <section className="panel detail-panel" aria-busy="true">
        正在读取托管仓库…
      </section>
    );
  if (info.error)
    return (
      <section className="panel detail-panel">
        <p role="alert">{info.error.message}</p>
        <Button onClick={() => info.refetch()}>重试</Button>
      </section>
    );
  const git = info.data,
    maintainer = git.accessRole === "maintainer",
    p = policy || git.hostingPolicy;
  return (
    <section className="panel detail-panel hosting-panel">
      <div className="section-heading">
        <div>
          <h2>平台托管 · Git</h2>
          <p className="muted">
            Push 接收代码，流水线校验内容，发布快照决定 Agent 使用的版本。
          </p>
        </div>
        <Link href="/docs/managed-git">操作指南 →</Link>
      </div>
      <CopyText value={git.cloneUrl} />
      <CopyText value={"git clone " + git.cloneUrl} />
      <CopyText value="git push origin main" />
      <p className="info-note">
        使用 Git Token 作为 HTTPS 密码。用户名可以填写你的账号；权限由 Token
        所属用户和仓库成员身份决定。
      </p>
      {git.provisionState !== "active" && (
        <p role="status">
          仓库准备状态：{git.provisionState}。后台会自动重试，页面会更新状态。
        </p>
      )}
      {!git.writeEnabled && <p role="status">管理员尚未启用 Git 写入。</p>}
      <nav className="hosting-tabs" aria-label="托管仓库视图">
        {[
          ["events", "Push 活动"],
          ["commits", "Commits"],
          ["refs", "Branches / Tags"],
          ["tree", "Files"],
          ["diff", "Diff"],
          ["tokens", "Git Token"],
          ["members", "仓库成员"],
          ["policies", "仓库策略"],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? "default" : "outline"}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setOffset(0);
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      <p role="status" aria-label="托管操作结果">
        {message}
      </p>
      {["commits", "tree", "diff"].includes(tab) && (
        <div className="hosting-fields">
          <label>
            Commit SHA 或 refs/heads/main
            <input
              value={commit}
              onChange={(e) => {
                setCommit(e.target.value);
                setOffset(0);
              }}
              placeholder="留空使用默认分支"
            />
          </label>
          {tab === "diff" && (
            <label>
              对比起点（完整 SHA）
              <input
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="留空显示该提交的改动"
              />
            </label>
          )}
        </div>
      )}
      {!["tokens", "policies"].includes(tab) && (
        <>
          {data.isPending && <p aria-busy="true">正在加载…</p>}
          {data.error && (
            <div role="alert">
              <p>{data.error.message}</p>
              <Button onClick={() => data.refetch()}>重试</Button>
            </div>
          )}
          {data.data?.items?.length === 0 && (
            <p className="muted">
              暂无记录。空仓库需要先提交一个包含 SKILL.md 的版本。
            </p>
          )}
          {tab === "events" &&
            data.data?.items?.map((v: any) => (
              <div className="history-row" key={v.id}>
                <code>{v.ref}</code>
                <code>{v.newOid.slice(0, 12)}</code>
                <span>
                  {v.error ||
                    v.jobStatus ||
                    (v.processedAt ? "已记录，不触发构建" : "等待自动构建")}
                </span>
                {v.pipelines?.map((run: any) => (
                  <Link key={run.id} href={"/pipelines/" + run.id}>
                    {run.status} →
                  </Link>
                ))}
              </div>
            ))}
          {tab === "commits" &&
            data.data?.items?.map((v: any) => (
              <div className="history-row" key={v.oid}>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCommit(v.oid);
                    setTab("tree");
                    setOffset(0);
                  }}
                >
                  {v.oid.slice(0, 12)}
                </Button>
                <span>{v.subject}</span>
                <small>
                  {v.author} · {new Date(v.date).toLocaleString()}
                </small>
              </div>
            ))}
          {tab === "refs" &&
            data.data?.items?.map((v: any) => (
              <div className="history-row" key={v.ref}>
                <code>{v.ref}</code>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCommit(v.oid);
                    setTab("commits");
                    setOffset(0);
                  }}
                >
                  {v.oid.slice(0, 12)}
                </Button>
              </div>
            ))}
          {tab === "tree" &&
            data.data?.items?.map((v: any) => (
              <div className="history-row" key={v.path}>
                <code>{v.path}</code>
                <span>{v.size} bytes</span>
              </div>
            ))}
          {tab === "diff" && data.data && (
            <>
              <p>
                固定提交：<code>{data.data.commit}</code>
              </p>
              {data.data.truncated && (
                <p role="status">
                  Diff 超过 256 KiB，已截断。完整差异请在本地执行 git diff。
                </p>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([data.data.diff], { type: "text/plain" }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "skiva-diff.txt";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                下载当前 Diff
              </Button>
              <pre className="hosting-diff">
                {data.data.diff || "没有文本差异"}
              </pre>
            </>
          )}
          {data.data?.nextOffset != null && (
            <Button
              variant="outline"
              onClick={() => setOffset(data.data.nextOffset)}
            >
              下一页
            </Button>
          )}
          {offset > 0 && (
            <Button
              variant="outline"
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              上一页
            </Button>
          )}
        </>
      )}
      {tab === "tokens" && (
        <div className="hosting-fields">
          <h3>创建专用于此仓库的 Git Token</h3>
          <label>
            名称
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            有效天数（1–90）
            <input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={write}
              disabled={git.accessRole === "viewer"}
              onChange={(e) => setWrite(e.target.checked)}
            />
            允许 Push（repo:write）
          </label>
          <Button
            disabled={busy || !name || days < 1 || days > 90}
            onClick={async () => {
              setSecret("");
              const result = await act("/git-tokens", {
                name,
                repositoryId: id,
                scopes: write ? ["repo:read", "repo:write"] : ["repo:read"],
                expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
              });
              if (result?.token) setSecret(result.token);
            }}
          >
            创建 Git Token
          </Button>
          {secret && (
            <div className="info-note">
              <strong>只展示这一次，请立即保存。</strong>
              <CopyText value={secret} />
              <Button variant="outline" onClick={() => setSecret("")}>
                已保存，隐藏 Token
              </Button>
            </div>
          )}
          {tokens.error && <p role="alert">{tokens.error.message}</p>}
          {tokens.data?.items
            ?.filter((v: any) => v.repositoryId === id)
            .map((v: any) => (
              <div className="history-row" key={v.id}>
                <span>{v.name}</span>
                <code>{v.tokenPrefix}…</code>
                <span>{v.scopes.join(", ")}</span>
                <span>
                  {v.revokedAt
                    ? "已撤销"
                    : "到期 " + new Date(v.expiresAt).toLocaleDateString()}
                </span>
                {!v.revokedAt && (
                  <Button variant="destructive" onClick={() => setRevoke(v.id)}>
                    撤销
                  </Button>
                )}
              </div>
            ))}
          <p className="muted">
            轮换：创建新 Token，更新 Git 凭据管理器，验证后撤销旧 Token。Agent
            交付凭据不能访问 Git。
          </p>
        </div>
      )}
      {tab === "members" && (
        <>
          {data.data?.items?.map((v: any) => (
            <div className="history-row" key={v.id}>
              <span>{v.email || v.id}</span>
              <span>{v.accessRole}</span>
            </div>
          ))}
          {maintainer && (
            <div className="hosting-fields">
              <label>
                用户 ID
                <input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="组织成员的用户 UUID"
                />
              </label>
              <label>
                仓库角色
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="viewer">Viewer · 只读</option>
                  <option value="contributor">Contributor · 非保护分支</option>
                  <option value="maintainer">Maintainer · 仓库管理</option>
                  <option value="none">移除成员</option>
                </select>
              </label>
              <Button
                disabled={busy || !userId}
                onClick={() =>
                  role === "none"
                    ? setDanger("member")
                    : act(
                        root + "/members",
                        { userId, accessRole: role },
                        "PUT",
                      )
                }
              >
                保存成员权限
              </Button>
            </div>
          )}
        </>
      )}
      {tab === "policies" && (
        <div className="hosting-fields">
          <p>
            默认禁止强推和删除受保护分支。仓库写权限不授予发布 Stable 的权限。
          </p>
          {[
            ["protectedBranches", "保护分支"],
            ["triggerRefs", "自动构建 Ref"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}（逗号分隔，支持 *）
              <input
                disabled={!maintainer}
                value={(p[key] as string[]).join(",")}
                onChange={(e) =>
                  setPolicy({
                    ...p,
                    [key]: e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          ))}
          {[
            ["maxPushBytes", "单次 Push 字节上限"],
            ["maxRepoBytes", "仓库字节上限"],
            ["maxFileBytes", "单文件字节上限"],
            ["maxFiles", "文件数量上限"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                disabled={!maintainer}
                value={p[key]}
                onChange={(e) =>
                  setPolicy({ ...p, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
          {[
            ["denyForcePush", "禁止 Force Push"],
            ["protectTags", "保护 Tags"],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                disabled={!maintainer}
                checked={p[key]}
                onChange={(e) => setPolicy({ ...p, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          {maintainer && (
            <Button
              disabled={busy}
              onClick={() => act(root + "/policies", p, "PATCH")}
            >
              保存仓库策略
            </Button>
          )}
        </div>
      )}
      {maintainer && (
        <div className="actions">
          <Button variant="destructive" onClick={() => setDanger("delete")}>
            软删除仓库
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={!!danger}
        title={danger === "delete" ? "软删除此托管仓库？" : "移除此仓库成员？"}
        onClose={() => setDanger("")}
        busy={busy}
        onConfirm={async () => {
          const result =
            danger === "delete"
              ? await act(root, {}, "DELETE")
              : await act(
                  root + "/members",
                  { userId, accessRole: "none" },
                  "PUT",
                );
          if (result) {
            if (danger === "delete") router.push("/repositories");
            setDanger("");
          }
        }}
      >
        {danger === "delete"
          ? "新的 Git 访问将停止。源仓库、历史快照和已发布制品会保留，名称继续保留。"
          : "该成员的新 Git 请求将按剩余权限重新授权；现有 Token 不再授予已移除的仓库权限。"}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!revoke}
        title="撤销 Git Token？"
        onClose={() => setRevoke("")}
        busy={busy}
        onConfirm={async () => {
          await act("/git-tokens/" + revoke + "/revoke", {});
          setRevoke("");
        }}
      >
        新 Git 请求会立即被拒绝。已开始的传输最多运行至 120 秒超时。
      </ConfirmDialog>
    </section>
  );
}
