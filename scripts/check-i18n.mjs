import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/web/package.json"));
const ts = require("typescript");
const read = (file) => readFileSync(join(root, file), "utf8");
const en = JSON.parse(read("apps/web/lib/i18n/en.json"));
const english = JSON.parse(read("apps/web/content/docs.en.json"));
const chinese = JSON.parse(read("apps/web/content/docs.zh.json"));
assert.deepEqual(
  english.map((d) => d.slug),
  chinese.map((d) => d.slug),
);
for (const doc of english) {
  assert(doc.title && doc.description && doc.body);
  assert(
    !/\p{Script=Han}/u.test(doc.body),
    `Untranslated English article: ${doc.slug}`,
  );
}
for (const doc of [...english, ...chinese]) {
  for (const match of doc.body.matchAll(
    /\]\(\/docs(?:\/([^)#]*))?(?:#[^)]*)?\)/g,
  )) {
    assert(
      english.some((d) => d.slug === (match[1] || "")),
      `Broken article link: ${match[0]}`,
    );
  }
}
function files(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
}
for (const file of [
  ...files("apps/web/components"),
  ...files("apps/web/app"),
].filter((f) => f.endsWith(".tsx"))) {
  const tree = ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "t" &&
      ts.isStringLiteral(node.arguments[0]) &&
      /\p{Script=Han}/u.test(node.arguments[0].text)
    ) {
      const key = node.arguments[0].text;
      assert(en[key], `Missing English message in ${file}: ${key}`);
      const placeholders = (text) =>
        [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(
        placeholders(key),
        placeholders(en[key]),
        `Placeholder mismatch: ${key}`,
      );
    }
    if (ts.isJsxText(node))
      assert(
        !/\p{Script=Han}/u.test(node.text),
        `Unlocalized JSX in ${file}: ${node.text.trim()}`,
      );
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
const guides = [
  "README.md",
  "LICENSE-FAQ.md",
  "THIRD_PARTY_NOTICES.md",
  "deployments/COMPOSE.md",
  "deployments/COMPOSE.zh-CN.md",
  ...files("docs"),
  "deployments/preproduction/README.md",
  "examples/pydantic-agent/README.md",
].filter((f) => f.endsWith(".md"));
for (const file of guides) {
  const pair = file.endsWith(".zh-CN.md")
    ? file.replace(".zh-CN.md", ".md")
    : file.replace(/\.md$/, ".zh-CN.md");
  assert(existsSync(join(root, pair)), `Missing language pair: ${pair}`);
  for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:/.test(target)) continue;
    assert(
      existsSync(resolve(root, dirname(file), target)),
      `Broken guide link: ${file} -> ${target}`,
    );
  }
}
console.log(
  `Localization checks passed: ${Object.keys(en).length} messages, ${english.length} paired articles, ${guides.length} guide files.`,
);
