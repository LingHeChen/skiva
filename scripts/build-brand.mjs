// Run from any directory: node scripts/build-brand.mjs
// All artwork is paths; no font or remote service is required.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const sharp = require("sharp");
const { mark, wordmark } = JSON.parse(
  readFileSync(
    resolve(root, "apps/web/components/brand-geometry.json"),
    "utf8",
  ),
);
const destination = resolve(root, "apps/web/public/brand");
mkdirSync(destination, { recursive: true });
const svg = (body, viewBox) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Skiva">${body}</svg>\n`;
for (const [name, color] of [
  ["light", "#20251d"],
  ["dark", "#f1f3ea"],
]) {
  writeFileSync(
    resolve(destination, `skiva-${name}.svg`),
    svg(
      `<path fill="#7d8f59" d="${mark}"/><path fill="${color}" fill-rule="evenodd" transform="translate(35 0)" d="${wordmark}"/>`,
      "-8 -12 496 148",
    ),
  );
}
writeFileSync(
  resolve(destination, "skiva-mark.svg"),
  svg(`<path fill="#7d8f59" d="${mark}"/>`, "-8 -4 110 132"),
);
const icon = svg(
  `<rect width="128" height="128" rx="26" fill="#637447"/><path fill="#fff" transform="translate(26 14) scale(.8)" d="${mark}"/>`,
  "0 0 128 128",
);
writeFileSync(resolve(root, "apps/web/app/icon.svg"), icon);
await sharp(Buffer.from(icon))
  .resize(180, 180)
  .png()
  .toFile(resolve(root, "apps/web/app/apple-icon.png"));
const sizes = [16, 32, 48];
const images = await Promise.all(
  sizes.map((size) =>
    sharp(Buffer.from(icon)).resize(size, size).png().toBuffer(),
  ),
);
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((image, i) => {
  const at = 6 + i * 16;
  header[at] = sizes[i];
  header[at + 1] = sizes[i];
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(image.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += image.length;
});
writeFileSync(
  resolve(root, "apps/web/app/favicon.ico"),
  Buffer.concat([header, ...images]),
);
console.log(
  "Generated SVG logos, favicon.ico (16/32/48px), and apple-icon.png (180px).",
);
