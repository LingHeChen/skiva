"use client";
import { BrandLogo } from "./brand";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  isValidElement,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Menu,
  Moon,
  Search,
  Sun,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { docs, docHref } from "@/content/docs";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}
const docsOnly = process.env.NEXT_PUBLIC_DOCS_ONLY === "true";

const anchor = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");

function CodeBlock({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState("");
  const code = textOf(children).replace(/\n$/, "");
  return (
    <div className="docs-code">
      <button
        type="button"
        aria-label="复制代码"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setStatus("已复制");
          } catch {
            setStatus("复制失败，请手动选择代码");
          }
        }}
      >
        {status === "已复制" ? <Check size={14} /> : <Copy size={14} />}
        <span>{status || "复制"}</span>
      </button>
      <pre>{children}</pre>
      <span className="docs-sr" role="status">
        {status}
      </span>
    </div>
  );
}

export function Documentation({ slug }: { slug: string }) {
  const pageIndex = docs.findIndex((doc) => doc.slug === slug);
  const doc = docs[pageIndex];
  const [query, setQuery] = useState("");
  const [mobile, setMobile] = useState(false);
  const [ready, setReady] = useState(false);
  const [dark, setDark] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const sections = doc.body
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3));
  const matches = query.trim()
    ? docs.filter((item) =>
        `${item.title} ${item.description} ${item.body}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : [];
  useEffect(() => {
    setReady(true);
    const saved = localStorage.getItem("skiva-theme");
    const isDark =
      saved && saved !== "system"
        ? saved === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    setDark(isDark);
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setQuery("");
        setMobile(false);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const oldOverflow = document.body.style.overflow;
    const menuButton = menuRef.current;
    document.body.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const links =
        drawerRef.current?.querySelectorAll<HTMLElement>("a,button");
      if (!links?.length) return;
      const first = links[0],
        last = links[links.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", trap);
      menuButton?.focus();
    };
  }, [mobile]);

  const navigation = (
    <>
      {[...new Set(docs.map((item) => item.group))].map((group) => (
        <div className="docs-nav-group" key={group}>
          <p>{group}</p>
          {docs
            .filter((item) => item.group === group)
            .map((item) => (
              <Link
                key={item.slug}
                href={docHref(item.slug)}
                aria-current={item.slug === slug ? "page" : undefined}
                onClick={() => setMobile(false)}
              >
                {item.slug === "" && <BookOpen size={15} />}
                {item.slug === "" ? "文档概览" : item.title}
              </Link>
            ))}
        </div>
      ))}
      <div className="docs-nav-note">
        <span className="docs-dot" />
        首发版本指南
        <br />
        <small>以当前实现为准 · 中文</small>
      </div>
    </>
  );

  return (
    <div className="docs-site">
      <a className="docs-skip" href="#docs-content">
        跳转到正文
      </a>
      <header className="docs-header">
        <button
          ref={menuRef}
          type="button"
          className="docs-menu"
          aria-label="打开文档导航"
          disabled={!ready}
          aria-expanded={mobile}
          onClick={() => setMobile(true)}
        >
          <Menu size={20} />
        </button>
        <Link href="/docs" className="docs-brand">
          <BrandLogo />
          <span className="docs-brand-divider" />
          <span>文档</span>
        </Link>
        <div className="docs-search">
          <Search size={16} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文档…"
            aria-label="搜索文档"
            aria-controls={query ? "docs-results" : undefined}
          />
          <kbd>⌘ K</kbd>
          {query && (
            <button aria-label="清空搜索" onClick={() => setQuery("")}>
              <X size={15} />
            </button>
          )}
          {query && (
            <div className="docs-results" id="docs-results">
              <p role="status">
                {matches.length
                  ? `找到 ${matches.length} 篇文档`
                  : "没有匹配结果，试试“快照”或“流水线”"}
              </p>
              {matches.map((item) => (
                <Link
                  key={item.slug}
                  href={docHref(item.slug)}
                  onClick={() => setQuery("")}
                >
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                  <small>
                    {(() => {
                      const i = item.body
                        .toLowerCase()
                        .indexOf(query.trim().toLowerCase());
                      return i < 0
                        ? item.group
                        : `…${item.body.slice(Math.max(0, i - 25), i + 75).replace(/[#`*\n]/g, " ")}…`;
                    })()}
                  </small>
                </Link>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="docs-theme"
          aria-label={dark ? "切换浅色主题" : "切换深色主题"}
          onClick={() => {
            const next = !dark;
            setDark(next);
            document.documentElement.dataset.theme = next ? "dark" : "light";
            localStorage.setItem("skiva-theme", next ? "dark" : "light");
          }}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <Link
          className="docs-console-link"
          href={docsOnly ? "https://github.com/LingHeChen/skiva" : "/dashboard"}
        >
          {docsOnly ? "GitHub" : "控制台"} <ArrowRight size={15} />
        </Link>
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <nav aria-label="文档章节">{navigation}</nav>
        </aside>
        {mobile && (
          <>
            <div className="docs-backdrop" onClick={() => setMobile(false)} />
            <aside
              ref={drawerRef}
              className="docs-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="文档导航"
            >
              <button
                aria-label="关闭文档导航"
                onClick={() => setMobile(false)}
              >
                <X size={20} />
              </button>
              <nav>{navigation}</nav>
            </aside>
          </>
        )}
        <main id="docs-content" className="docs-main">
          <div className="docs-eyebrow">
            SKIVA HANDBOOK <span>/</span> {doc.group}
          </div>
          <h1>{doc.title}</h1>
          <p className="docs-lead">{doc.description}</p>
          {!slug && (
            <div className="docs-start">
              <Link href="/docs/quickstart">
                开始第一次发布 <ArrowRight size={17} />
              </Link>
              <Link href="/docs/pipelines">
                了解流水线配置 <ArrowRight size={15} />
              </Link>
            </div>
          )}
          {!slug && (
            <div className="docs-delivery" aria-label="交付流程">
              <div>
                <small>01 / SOURCE</small>
                <strong>Git 提交</strong>
                <span>可追溯的内容来源</span>
              </div>
              <ArrowRight size={20} />
              <div>
                <small>02 / VERIFY</small>
                <strong>校验与快照</strong>
                <span>固定、完整、不可变</span>
              </div>
              <ArrowRight size={20} />
              <div>
                <small>03 / DELIVER</small>
                <strong>渠道与 Agent</strong>
                <span>按授权交付与回滚</span>
              </div>
            </div>
          )}
          <details className="docs-inline-toc">
            <summary>本页目录</summary>
            {sections.map((title) => (
              <a key={title} href={`#${anchor(title)}`}>
                {title}
              </a>
            ))}
          </details>
          <article className="docs-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={{
                h2: ({ children }) => (
                  <h2 id={anchor(textOf(children))}>
                    <a href={`#${anchor(textOf(children))}`}>{children}</a>
                  </h2>
                ),
                pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
                a: ({ href, children }) =>
                  docsOnly &&
                  href?.startsWith("/") &&
                  !href.startsWith("/docs") ? (
                    <span title="在自部署的 Skiva 管理端中打开">
                      {children}（管理端）
                    </span>
                  ) : href?.startsWith("/") ? (
                    <Link href={href}>{children}</Link>
                  ) : (
                    <a href={href}>{children}</a>
                  ),
                table: ({ children }) => (
                  <div
                    className="docs-table"
                    tabIndex={0}
                    role="region"
                    aria-label="参考表格"
                  >
                    <table>{children}</table>
                  </div>
                ),
              }}
            >
              {doc.body}
            </ReactMarkdown>
          </article>
          <div className="docs-page-footer">
            <span>SKIVA · 操作手册</span>
            <a href="#docs-content">回到顶部 ↑</a>
          </div>
          <nav className="docs-pagination" aria-label="文档翻页">
            {pageIndex > 0 ? (
              <Link href={docHref(docs[pageIndex - 1].slug)}>
                <small>
                  <ArrowLeft size={13} /> 上一篇
                </small>
                <strong>{docs[pageIndex - 1].title}</strong>
              </Link>
            ) : (
              <span />
            )}
            {pageIndex < docs.length - 1 && (
              <Link href={docHref(docs[pageIndex + 1].slug)}>
                <small>
                  下一篇 <ArrowRight size={13} />
                </small>
                <strong>{docs[pageIndex + 1].title}</strong>
              </Link>
            )}
          </nav>
        </main>
        <aside className="docs-toc">
          <p>本页目录</p>
          <nav aria-label="本页目录">
            {sections.map((title) => (
              <a key={title} href={`#${anchor(title)}`}>
                {title}
              </a>
            ))}
          </nav>
          <div className="docs-toc-note">
            先验证，再交付。
            <br />
            每次发布都可以追溯。
          </div>
        </aside>
      </div>
    </div>
  );
}
