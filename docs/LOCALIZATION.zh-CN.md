# 国际化维护

[English](LOCALIZATION.md) · 简体中文

默认语言为英文。控制台将显式选择存入 localStorage 的 skiva-locale。切换时通过 React 更新界面，不改写用户内容或清空表单。仓库名称、Skill 文件、原始诊断、API 标识、命令参数和结构化日志保持原值。

## 界面文案

组件通过 apps/web/lib/i18n 的 useI18n() 获取 t(message, values)。en.json 将中文源文案映射为英文；中文使用源文案。完整句子一起翻译，动态值使用 `{name}` 占位符。不要翻译业务数据，也不要把翻译标签作为 API 枚举值。日期跟随语言设置。

Git、Skills、Agent、Profile、SHA、API 路径等技术名称可以保持不变。后端原始校验和诊断保留原文便于排查，外围界面提供翻译。法律许可正文逐字保留，说明文档提供双语版本。

## 文档

- docs.en.json 与 docs.zh.json 保存英文和中文文章，slug 与顺序一致。
- `/docs/<slug>` 为英文，`/docs/zh/<slug>` 为中文。
- 语言入口保持当前文章；搜索、目录、上下篇使用当前语言。
- Markdown 中的 `/docs/...` 链接在渲染时切换语言。控制台链接不改路径，静态站标记为仅管理端可用。
- scripts/build-docs.mjs 同时导出两种语言，保留 GitHub Pages 子路径。

README.md 与 README.zh-CN.md 同步维护；其他面向用户的 Markdown 使用相同后缀，互相添加语言链接，中文版本链接到对应中文指南。AGENTS.md 是工具指导，不属于产品公开文档。

## 验证

```bash
node scripts/check-i18n.mjs
npm run lint --prefix apps/web
npm run build --prefix apps/web
npm run build:docs --prefix apps/web
npm run test:docs --prefix apps/web
```

浏览器测试覆盖语言持久化、切换不丢表单、文章切换、搜索、深链接、移动导航和静态资源。原中文流程测试显式选择中文。
