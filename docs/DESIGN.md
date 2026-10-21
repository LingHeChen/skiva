# Admin design contract

The UI uses Next.js App Router, TanStack Query, React Hook Form/Zod for login validation, Radix-backed shadcn-style Button/ConfirmDialog primitives and Tailwind 4. All business writes go to Go APIs.

## Tokens

| Token | Light | Dark |
|---|---|---|
| Background | #f5f7f7 | #111a1a |
| Surface | #ffffff | #182323 |
| Text | #172b2b | #e2eeee |
| Muted | #697b7a | #9bafad |
| Border | #e0e7e5 | #2c3c3b |
| Accent | #087f73 | #60c8b6 |

Typography: Avenir Next / PingFang SC / Microsoft Yahei; code uses SFMono-Regular/Menlo. Base content 14px; body tables 11–12px; page titles 29px. Panels use 8px radii, compact spacing with 16/24/32px rhythm. Motion is 160–180ms and disabled under prefers-reduced-motion. Focus indicators are browser-visible with 4px offset. Dialog uses Radix focus trapping and keyboard dismissal.

Desktop fixed sidebar; 760px mobile drawer breakpoint; horizontally scrollable tables; stacked channels/forms on narrow screens. Light/dark/system theme selection is persisted locally. Screenshot evidence covers all navigation routes, dark dashboard and mobile navigation. Core forms use explicit labels; icons have accessible names; destructive operations confirm; busy mutation buttons disable.

Shared UI includes page header/breadcrumbs, tables/filters/pagination, status badges, empty/error/loading states, confirmation dialogs, safe Markdown, file tree, diff columns, pipeline stages, audit before/after, credential reveal, copy button, notification dropdown and unsaved-change guard. Search and filters operate on real results; server uses keyset cursors and the UI collects paged data before local table pagination.

Current caveat: the list UI loads all API pages before rendering its local 20-row pages; this is functional for baseline deployments but a virtualized/infinite page reader should replace it for very large registries. No synthetic metrics or demo-only buttons are used.
