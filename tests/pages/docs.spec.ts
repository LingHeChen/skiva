import { test, expect } from "../../apps/web/node_modules/@playwright/test";

test("Pages export works at the repository subpath without application services", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const broken: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) broken.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => broken.push(e.message));
  await page.goto("/skiva/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Skills");
  await expect(page.locator(".docs-console-link")).toHaveAttribute(
    "href",
    "https://github.com/LingHeChen/skiva",
  );
  await page.getByRole("link", { name: "开始第一次发布" }).click();
  await expect(page).toHaveURL(/\/skiva\/docs\/quickstart\/$/);
  await expect(page.locator('a[href="/skiva/dashboard/"]')).toHaveCount(0);
  await page.getByRole("textbox", { name: "搜索文档" }).fill("blockScripts");
  await page
    .locator("#docs-results")
    .getByRole("link", { name: /配置你的流水线/ })
    .click();
  await expect(page).toHaveURL(/\/skiva\/docs\/pipelines\/$/);
  await page
    .getByRole("button", { name: "复制代码", exact: true })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("blockScripts: true");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "配置你的流水线",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开文档导航" }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "连接客户端与 Agent" })
    .click();
  await expect(page).toHaveURL(/\/skiva\/docs\/clients\/$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "../../test-results/screenshots/skiva-pages-mobile.png",
    fullPage: true,
  });
  expect(broken).toEqual([]);
});
