import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Assemble only public documentation. The management application and local
// configuration never enter the static export or Pages artifact.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps/web");
const stage = join(root, ".pages-build");
const basePath = process.env.SKIVA_DOCS_BASE_PATH || "/skiva";
if (!/^\/[a-zA-Z0-9_-]+$/.test(basePath))
  throw new Error("Expected a single repository base path, e.g. /skiva");
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "app"), { recursive: true });
for (const entry of [
  "content",
  "lib/i18n",
  "public",
  "app/favicon.ico",
  "app/icon.svg",
  "app/apple-icon.png",
  "app/docs",
  "app/globals.css",
  "app/layout.tsx",
  "postcss.config.mjs",
  "tsconfig.json",
  "package.json",
]) {
  cpSync(join(web, entry), join(stage, entry), { recursive: true });
}
const docsRoute = join(stage, "app/docs/[[...slug]]/page.tsx");
writeFileSync(
  docsRoute,
  readFileSync(docsRoute, "utf8") + "\nexport const dynamicParams = false;\n",
);
mkdirSync(join(stage, "components"));
cpSync(
  join(web, "components/documentation.tsx"),
  join(stage, "components/documentation.tsx"),
);
for (const entry of ["brand.tsx", "brand-geometry.json"]) {
  cpSync(join(web, "components", entry), join(stage, "components", entry));
}
symlinkSync(join(web, "node_modules"), join(stage, "node_modules"), "dir");
writeFileSync(
  join(stage, "app/page.tsx"),
  `import { Documentation } from "@/components/documentation";
import "./docs/docs.css";
export const metadata = { title: "Skiva · Skills management and delivery" };
export default function Page() { return <Documentation slug="" />; }
`,
);
writeFileSync(
  join(stage, "app/not-found.tsx"),
  `import Link from "next/link";
export default function NotFound() { return <main className="standalone"><p>404</p><h1>Page not found / 文档不存在</h1><Link href="/docs">Documentation / 文档首页</Link></main>; }
`,
);
writeFileSync(
  join(stage, "next.config.mjs"),
  `export default ${JSON.stringify({
    output: "export",
    basePath,
    trailingSlash: true,
    turbopack: { root },
    images: { unoptimized: true },
    env: { NEXT_PUBLIC_DOCS_ONLY: "true" },
  })};\n`,
);
const build = spawnSync(
  process.execPath,
  [join(web, "node_modules/next/dist/bin/next"), "build"],
  {
    cwd: stage,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  },
);
if (build.status !== 0) process.exit(build.status || 1);
writeFileSync(join(stage, "out/.nojekyll"), "");
const home = readFileSync(join(stage, "out/index.html"), "utf8");
if (!home.includes(`${basePath}/_next/`))
  throw new Error("Static asset base path missing");
console.log(`Documentation exported to ${stage}/out (base path ${basePath})`);

const preview = join(root, ".pages-preview");
rmSync(preview, { recursive: true, force: true });
mkdirSync(preview);
symlinkSync(join(stage, "out"), join(preview, basePath.slice(1)), "dir");
