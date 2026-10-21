import { test, expect } from "../../apps/web/node_modules/@playwright/test";

test("documentation is public, searchable and navigable with copyable examples", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "让 Skills 从提交走到交付",
  );
  await page.screenshot({
    path: "../../test-results/screenshots/docs-home.png",
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "搜索文档" }).fill("blockScripts");
  await expect(page.locator("#docs-results")).toContainText("配置你的流水线");
  await page
    .locator("#docs-results")
    .getByRole("link", { name: /配置你的流水线/ })
    .click();
  await expect(page).toHaveURL(/\/docs\/pipelines$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "配置你的流水线",
  );
  await page
    .getByRole("button", { name: "复制代码", exact: true })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("blockScripts: true");
  await page
    .getByRole("navigation", { name: "本页目录", exact: true })
    .getByRole("link", { name: "仓库配置文件" })
    .click();
  await expect(page).toHaveURL(/#/);
  await page.getByRole("button", { name: "切换深色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "../../test-results/screenshots/docs-pipeline-dark.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("textbox", { name: "搜索文档" })
    .fill("no-such-doc-897123");
  await expect(page.locator("#docs-results")).toContainText("没有匹配结果");
  await page.keyboard.press("Escape");
  await expect(page.locator("#docs-results")).toHaveCount(0);
  for (const slug of [
    "quickstart",
    "concepts",
    "releases",
    "clients",
    "security",
    "operations",
  ]) {
    const response = await page.goto(`/docs/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator(".docs-prose h2").first()).toBeVisible();
  }
  const missing = await page.goto("/docs/not-a-real-guide");
  expect(missing?.status()).toBe(404);
  expect(errors).toEqual([]);
});

test("documentation mobile drawer, headings and tables remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs");
  await page.getByRole("button", { name: "打开文档导航" }).click();
  const drawer = page.getByRole("dialog", { name: "文档导航" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "连接客户端与 Agent" }).click();
  await expect(page).toHaveURL(/\/docs\/clients$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".docs-inline-toc summary").click();
  await page
    .locator(".docs-inline-toc")
    .getByRole("link", { name: "在 Linux 上挂载" })
    .click();
  await expect(page).toHaveURL(/#/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("heading", { level: 1 }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../../test-results/screenshots/docs-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "打开文档导航" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开文档导航" }),
  ).toBeFocused();
});
