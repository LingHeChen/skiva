"use client";
import { useI18n } from "@/lib/i18n";

import { Card } from "./ui/card";
import { FormInput } from "./ui/form-input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Label } from "./ui/label";

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
  const { t } = useI18n();

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
        {t("复制")}
      </Button>
      <span role="status">{t(note)}</span>
    </span>
  );
}
export function ManagedRepository({ id }: { id: string }) {
  const { t, locale } = useI18n();

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
    [name, setName] = useState(t("我的开发电脑")),
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
      setMessage(e instanceof Error ? e.message : t("操作失败，请重试"));
    } finally {
      setBusy(false);
    }
  }
  if (info.isPending)
    return (
      <Card className="panel detail-panel" aria-busy="true">
        {t("正在读取托管仓库…")}
      </Card>
    );
  if (info.error)
    return (
      <Card className="panel detail-panel">
        <p role="alert">{t(info.error.message)}</p>
        <Button onClick={() => info.refetch()}>{t("重试")}</Button>
      </Card>
    );
  const git = info.data,
    maintainer = git.accessRole === "maintainer",
    p = policy || git.hostingPolicy;
  return (
    <Card className="panel detail-panel hosting-panel">
      <div className="section-heading">
        <div>
          <h2>{t("平台托管 · Git")}</h2>
          <p className="muted">
            {t(
              "Push 接收代码，流水线校验内容，发布快照决定 Agent 使用的版本。",
            )}
          </p>
        </div>
        <Link href="/docs/managed-git">{t("操作指南 →")}</Link>
      </div>
      <CopyText value={git.cloneUrl} />
      <CopyText value={"git clone " + git.cloneUrl} />
      <CopyText value="git push origin main" />
      <p className="info-note">
        {t(
          "使用 Git Token 作为 HTTPS 密码。用户名可以填写你的账号；权限由 Token 所属用户和仓库成员身份决定。",
        )}
      </p>
      {git.provisionState !== "active" && (
        <p role="status">
          {t("仓库准备状态：")}
          {t(git.provisionState)}
          {t("。后台会自动重试，页面会更新状态。")}
        </p>
      )}
      {!git.writeEnabled && (
        <p role="status">{t("管理员尚未启用 Git 写入。")}</p>
      )}
      <nav className="hosting-tabs" aria-label={t("托管仓库视图")}>
        {[
          ["events", t("Push 活动")],
          ["commits", "Commits"],
          ["refs", "Branches / Tags"],
          ["tree", "Files"],
          ["diff", "Diff"],
          ["tokens", "Git Token"],
          ["members", t("仓库成员")],
          ["policies", t("仓库策略")],
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
            {t(label)}
          </Button>
        ))}
      </nav>
      <p role="status" aria-label={t("托管操作结果")}>
        {t(message)}
      </p>
      {["commits", "tree", "diff"].includes(tab) && (
        <div className="hosting-fields">
          <Label>
            {t("Commit SHA 或 refs/heads/main")}
            <FormInput
              value={commit}
              onChange={(e) => {
                setCommit(e.target.value);
                setOffset(0);
              }}
              placeholder={t("留空使用默认分支")}
            />
          </Label>
          {tab === "diff" && (
            <Label>
              {t("对比起点（完整 SHA）")}
              <FormInput
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder={t("留空显示该提交的改动")}
              />
            </Label>
          )}
        </div>
      )}
      {!["tokens", "policies"].includes(tab) && (
        <>
          {data.isPending && <p aria-busy="true">{t("正在加载…")}</p>}
          {data.error && (
            <div role="alert">
              <p>{t(data.error.message)}</p>
              <Button onClick={() => data.refetch()}>{t("重试")}</Button>
            </div>
          )}
          {data.data?.items?.length === 0 && (
            <p className="muted">
              {t("暂无记录。空仓库需要先提交一个包含 SKILL.md 的版本。")}
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
                    (v.processedAt
                      ? t("已记录，不触发构建")
                      : t("等待自动构建"))}
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
                  {v.author} ·{" "}
                  {new Date(v.date).toLocaleString(
                    locale === "zh" ? "zh-CN" : "en",
                  )}
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
                <span>
                  {v.size}
                  {t("bytes")}
                </span>
              </div>
            ))}
          {tab === "diff" && data.data && (
            <>
              <p>
                {t("固定提交：")}
                <code>{data.data.commit}</code>
              </p>
              {data.data.truncated && (
                <p role="status">
                  {t(
                    "Diff 超过 256 KiB，已截断。完整差异请在本地执行 git diff。",
                  )}
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
                {t("下载当前 Diff")}
              </Button>
              <pre className="hosting-diff">
                {data.data.diff || t("没有文本差异")}
              </pre>
            </>
          )}
          {data.data?.nextOffset != null && (
            <Button
              variant="outline"
              onClick={() => setOffset(data.data.nextOffset)}
            >
              {t("下一页")}
            </Button>
          )}
          {offset > 0 && (
            <Button
              variant="outline"
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              {t("上一页")}
            </Button>
          )}
        </>
      )}
      {tab === "tokens" && (
        <div className="hosting-fields">
          <h3>{t("创建专用于此仓库的 Git Token")}</h3>
          <Label>
            {t("名称")}
            <FormInput value={name} onChange={(e) => setName(e.target.value)} />
          </Label>
          <Label>
            {t("有效天数（1–90）")}
            <FormInput
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </Label>
          <Label>
            <FormInput
              type="checkbox"
              checked={write}
              disabled={git.accessRole === "viewer"}
              onChange={(e) => setWrite(e.target.checked)}
            />
            {t("允许 Push（repo:write）")}
          </Label>
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
            {t("创建 Git Token")}
          </Button>
          {secret && (
            <div className="info-note">
              <strong>{t("只展示这一次，请立即保存。")}</strong>
              <CopyText value={secret} />
              <Button variant="outline" onClick={() => setSecret("")}>
                {t("已保存，隐藏 Token")}
              </Button>
            </div>
          )}
          {tokens.error && <p role="alert">{t(tokens.error.message)}</p>}
          {tokens.data?.items
            ?.filter((v: any) => v.repositoryId === id)
            .map((v: any) => (
              <div className="history-row" key={v.id}>
                <span>{v.name}</span>
                <code>{v.tokenPrefix}…</code>
                <span>{v.scopes.join(", ")}</span>
                <span>
                  {v.revokedAt
                    ? t("已撤销")
                    : t("到期 ") +
                      new Date(v.expiresAt).toLocaleDateString(
                        locale === "zh" ? "zh-CN" : "en",
                      )}
                </span>
                {!v.revokedAt && (
                  <Button variant="destructive" onClick={() => setRevoke(v.id)}>
                    {t("撤销")}
                  </Button>
                )}
              </div>
            ))}
          <p className="muted">
            {t(
              "轮换：创建新 Token，更新 Git 凭据管理器，验证后撤销旧 Token。Agent 交付凭据不能访问 Git。",
            )}
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
              <Label>
                {t("用户 ID")}
                <FormInput
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder={t("组织成员的用户 UUID")}
                />
              </Label>
              <Label>
                {t("仓库角色")}
                <NativeSelect
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <NativeSelectOption value="viewer">
                    {t("Viewer · 只读")}
                  </NativeSelectOption>
                  <NativeSelectOption value="contributor">
                    {t("Contributor · 非保护分支")}
                  </NativeSelectOption>
                  <NativeSelectOption value="maintainer">
                    {t("Maintainer · 仓库管理")}
                  </NativeSelectOption>
                  <NativeSelectOption value="none">
                    {t("移除成员")}
                  </NativeSelectOption>
                </NativeSelect>
              </Label>
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
                {t("保存成员权限")}
              </Button>
            </div>
          )}
        </>
      )}
      {tab === "policies" && (
        <div className="hosting-fields">
          <p>
            {t(
              "默认禁止强推和删除受保护分支。仓库写权限不授予发布 Stable 的权限。",
            )}
          </p>
          {[
            ["protectedBranches", t("保护分支")],
            ["triggerRefs", t("自动构建 Ref")],
          ].map(([key, label]) => (
            <Label key={key}>
              {t(label)}
              {t("（逗号分隔，支持 *）")}
              <FormInput
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
            </Label>
          ))}
          {[
            ["maxPushBytes", t("单次 Push 字节上限")],
            ["maxRepoBytes", t("仓库字节上限")],
            ["maxFileBytes", t("单文件字节上限")],
            ["maxFiles", t("文件数量上限")],
          ].map(([key, label]) => (
            <Label key={key}>
              {t(label)}
              <FormInput
                type="number"
                disabled={!maintainer}
                value={p[key]}
                onChange={(e) =>
                  setPolicy({ ...p, [key]: Number(e.target.value) })
                }
              />
            </Label>
          ))}
          {[
            ["denyForcePush", t("禁止 Force Push")],
            ["protectTags", t("保护 Tags")],
          ].map(([key, label]) => (
            <Label key={key}>
              <FormInput
                type="checkbox"
                disabled={!maintainer}
                checked={p[key]}
                onChange={(e) => setPolicy({ ...p, [key]: e.target.checked })}
              />
              {t(label)}
            </Label>
          ))}
          {maintainer && (
            <Button
              disabled={busy}
              onClick={() => act(root + "/policies", p, "PATCH")}
            >
              {t("保存仓库策略")}
            </Button>
          )}
        </div>
      )}
      {maintainer && (
        <div className="actions">
          <Button variant="destructive" onClick={() => setDanger("delete")}>
            {t("软删除仓库")}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={!!danger}
        title={
          danger === "delete" ? t("软删除此托管仓库？") : t("移除此仓库成员？")
        }
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
          ? t(
              "新的 Git 访问将停止。源仓库、历史快照和已发布制品会保留，名称继续保留。",
            )
          : t(
              "该成员的新 Git 请求将按剩余权限重新授权；现有 Token 不再授予已移除的仓库权限。",
            )}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!revoke}
        title={t("撤销 Git Token？")}
        onClose={() => setRevoke("")}
        busy={busy}
        onConfirm={async () => {
          await act("/git-tokens/" + revoke + "/revoke", {});
          setRevoke("");
        }}
      >
        {t("新 Git 请求会立即被拒绝。已开始的传输最多运行至 120 秒超时。")}
      </ConfirmDialog>
    </Card>
  );
}
