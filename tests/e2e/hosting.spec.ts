import { test, expect } from "../../apps/web/node_modules/@playwright/test";
test("managed repository creation, history, token lifecycle, policies and mobile", async ({
  page,
}) => {
  test.skip(
    process.env.SKIVA_MANAGED_GIT_ENABLED !== "true",
    "Hosting feature explicitly disabled",
  );
  await page.goto("/login");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill(process.env.SKIVA_ADMIN_EMAIL || "admin@localhost");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.SKIVA_ADMIN_PASSWORD || "local-skiva-development-2026");
  await page.getByRole("button", { name: "登录工作区", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/repositories/new");
  const slug = "browser-" + Date.now();
  await page.getByLabel("团队命名空间", { exact: true }).fill("browser-team");
  await page.getByLabel("仓库路径", { exact: true }).fill(slug);
  await page.getByLabel("仓库名称", { exact: true }).fill(slug);
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page).toHaveURL(/repositories\/[a-f0-9-]+$/);
  const panel = page.locator(".hosting-panel");
  await expect(
    panel.getByRole("heading", { name: "平台托管 · Git" }),
  ).toBeVisible();
  await expect(panel).toContainText("/git/browser-team/" + slug + ".git");
  await panel.getByRole("button", { name: "Commits", exact: true }).click();
  await expect(panel).toContainText("Initialize skill", { timeout: 20000 });
  await panel.getByRole("button", { name: "Files", exact: true }).click();
  await expect(panel).toContainText("SKILL.md");
  await panel.getByRole("button", { name: "Diff", exact: true }).click();
  await expect(panel.locator("pre")).toContainText("SKILL.md");
  await panel.getByRole("button", { name: "Git Token", exact: true }).click();
  await panel
    .getByRole("button", { name: "创建 Git Token", exact: true })
    .click();
  await expect(panel).toContainText("只展示这一次");
  const secret = await panel.locator(".info-note code").innerText();
  await panel
    .getByRole("button", { name: "已保存，隐藏 Token", exact: true })
    .click();
  await expect(panel).not.toContainText(secret);
  await panel.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(panel).toContainText("已撤销");
  await panel.getByRole("button", { name: "仓库策略", exact: true }).click();
  await panel
    .getByRole("button", { name: "保存仓库策略", exact: true })
    .click();
  await expect(
    panel.getByRole("status", { name: "托管操作结果" }),
  ).toContainText("操作成功");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  await expect(page.locator("aside.sidebar")).not.toBeInViewport();
  await page.screenshot({
    path: "../../test-results/screenshots/managed-git-mobile.png",
    fullPage: true,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
  await page.goto("/docs/managed-git");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "托管 Git",
  );
});
