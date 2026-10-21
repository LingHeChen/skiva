import { test, expect } from "../../apps/web/node_modules/@playwright/test";
async function login(page: any) {
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "邮箱", exact: true })
    .fill(process.env.ESDP_ADMIN_EMAIL || "admin@localhost");
  await page
    .getByRole("textbox", { name: "密码", exact: true })
    .fill(process.env.ESDP_ADMIN_PASSWORD || "local-esdp-development-2026");
  await page.getByRole("button", { name: "登录工作区", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
}
test("E19 complete navigation, light/dark/mobile and real profile settings", async ({
  page,
}) => {
  await login(page);
  for (const route of [
    "dashboard",
    "repositories",
    "repositories/new",
    "skills",
    "pipelines",
    "releases",
    "releases/new",
    "channels",
    "profiles",
    "profiles/new",
    "clients",
    "clients/new",
    "audit",
    "settings/general",
    "settings/members",
    "settings/credentials",
    "settings/security",
    "account",
    "403",
    "not-found",
    "error",
  ]) {
    await page.goto("/" + route);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Application error");
    await page.screenshot({
      path:
        "../../test-results/screenshots/" + route.replaceAll("/", "-") + ".png",
      fullPage: true,
    });
  }
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "切换主题" }).click();
  await page.screenshot({
    path: "../../test-results/screenshots/dashboard-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(page.locator("aside")).toHaveClass(/open/);
  await page.getByRole("link", { name: "Git 仓库", exact: true }).click();
  await expect(page).toHaveURL(/repositories/);
  await page.screenshot({
    path: "../../test-results/screenshots/mobile.png",
    fullPage: true,
  });
  await page.goto("/account");
  await page.getByRole("button", { name: "续期会话" }).click();
  await expect(page.getByRole("status")).toContainText("操作已完成");
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page).toHaveURL(/login/);
});
test("repository form rejects private URL through authoritative API", async ({
  page,
}) => {
  await login(page);
  await page.goto("/repositories/new");
  await page.getByLabel("仓库名称", { exact: true }).fill("unsafe-repo");
  await page.getByLabel("Git URL", { exact: true }).fill("file:///etc/passwd");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Only HTTPS or SSH",
  );
});
test("remote failure and no permission are recoverable", async ({ page }) => {
  await login(page);
  await page.route("**/api/v1/skills", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "TEST_UNAVAILABLE", message: "Injected outage" },
      }),
    }),
  );
  await page.goto("/skills");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Injected outage",
  );
  await expect(
    page.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/v1/skills");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});
