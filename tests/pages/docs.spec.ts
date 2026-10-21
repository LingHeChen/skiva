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
  await page.goto("/skiva/docs/zh/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Skills");
  await expect(page.locator(".docs-console-link")).toHaveAttribute(
    "href",
    "https://github.com/LingHeChen/skiva",
  );
  await page.getByRole("link", { name: "开始第一次发布" }).click();
  await expect(page).toHaveURL(/\/skiva\/docs\/zh\/quickstart\/$/);
  await expect(page.locator('a[href="/skiva/dashboard/"]')).toHaveCount(0);
  await page.getByRole("textbox", { name: "搜索文档" }).fill("blockScripts");
  await page
    .locator("#docs-results")
    .getByRole("link", { name: /配置你的流水线/ })
    .click();
  await expect(page).toHaveURL(/\/skiva\/docs\/zh\/pipelines\/$/);
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
  await expect(page).toHaveURL(/\/skiva\/docs\/zh\/clients\/$/);
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

test("English and Chinese articles retain language across search, links and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/skiva/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "From Skill commits to Agent delivery",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page
    .getByRole("textbox", { name: "Search documentation", exact: true })
    .fill("blockScripts");
  await page
    .locator("#docs-results")
    .getByRole("link", { name: /Configure validation pipelines/ })
    .click();
  await expect(page).toHaveURL(/\/skiva\/docs\/pipelines\/$/);
  await page.getByRole("link", { name: "Switch to Chinese" }).click();
  await expect(page).toHaveURL(/\/skiva\/docs\/zh\/pipelines\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "配置你的流水线",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.locator('.docs-prose a[href="/skiva/docs/zh/pipelines/"]'),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "切换为英文" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Configure validation pipelines",
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const logo = await page.locator(".docs-header .docs-brand").boundingBox();
    const language = await page
      .locator(".docs-header .language-switch")
      .boundingBox();
    const search = await page
      .locator(".docs-header .docs-search")
      .boundingBox();
    expect(logo!.x + logo!.width).toBeLessThanOrEqual(language!.x);
    expect(language!.x + language!.width).toBeLessThanOrEqual(search!.x);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page
    .getByRole("button", { name: "Open documentation navigation" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Connect clients and Agents" })
    .click();
  await expect(page).toHaveURL(/\/skiva\/docs\/clients\/$/);
  await page.getByRole("link", { name: "Switch to Chinese" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "连接客户端与 Agent",
  );
  for (const asset of ["icon.svg", "favicon.ico", "apple-icon.png"]) {
    expect((await page.request.get(`/skiva/${asset}`)).status()).toBe(200);
  }
  expect(errors).toEqual([]);
});
