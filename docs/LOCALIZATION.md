# Localization

English · [简体中文](LOCALIZATION.zh-CN.md)

English is the default language. The console stores an explicit choice in `localStorage["skiva-locale"]`. Switching language updates React-rendered interface text without rewriting user content or clearing forms. Repository names, Skill files, raw diagnostics, API identifiers, command flags, and structured logs retain their original values.

## Interface messages

Use `useI18n()` from `apps/web/lib/i18n` and `t(message, values)` in React components. `en.json` maps the source Chinese message to English; Chinese uses the source message. Keep complete sentences together and use `{name}` placeholders for dynamic values. Do not translate business data or use localized labels as API enum values. Date formatting follows the selected language.

Language-neutral technical names (Git, Skills, Agent, Profile, SHA, API paths) may remain unchanged. Raw backend validation and diagnostic messages retain their source text for troubleshooting; the surrounding interface is localized. Legal license text remains verbatim; explanatory documents have language pairs.

## Documentation

- `apps/web/content/docs.en.json`: English articles.
- `apps/web/content/docs.zh.json`: Chinese articles with matching slugs and order.
- `/docs/<slug>`: English; `/docs/zh/<slug>`: Chinese.
- Switching language links to the same article. Search, table of contents, and previous/next navigation use the current language.
- Markdown `/docs/...` links are localized during rendering. Console links remain unchanged; the public static site identifies them as console-only destinations.
- Both languages are exported by `scripts/build-docs.mjs`, including the GitHub Pages base path.

Keep `README.md` and `README.zh-CN.md` synchronized. Other human-facing Markdown guides use the same `.zh-CN.md` suffix. Retain reciprocal language links and language-matched relative links. `AGENTS.md` is tooling guidance and is not a public product document.

## Checks

```bash
node scripts/check-i18n.mjs
npm run lint --prefix apps/web
npm run build --prefix apps/web
npm run build:docs --prefix apps/web
npm run test:docs --prefix apps/web
```

Browser tests cover persistence, live switching without form loss, article language switching, localized search, deep links, mobile navigation, and static assets. Existing Chinese workflow tests explicitly choose Chinese.
