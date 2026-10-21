import { test, expect } from "../../apps/web/node_modules/@playwright/test";
test("real Git build → immutable release → canary → profile → credential rotation", async ({
  page,
}) => {
  test.skip(process.env.ESDP_DEMO_E2E !== "1", "Run seed-demo.py first");
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("admin@localhost");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.ESDP_ADMIN_PASSWORD || "local-esdp-development-2026");
  await page.getByRole("button", { name: "登录工作区", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/skills");
  await expect(
    page.getByRole("link", { name: "code-review", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "code-review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "版本与内容" })).toBeVisible();
  await expect(page.locator(".markdown")).toContainText("code-review");
  await page.goto("/releases/new");
  await page.getByRole("checkbox", { name: /code-review/ }).check();
  await page.getByRole("checkbox", { name: /sql-query/ }).check();
  await page.getByRole("button", { name: "预览完整视图" }).click();
  await expect(page.getByRole("heading", { name: "发布预览" })).toBeVisible();
  await page.getByRole("button", { name: "创建不可变快照" }).click();
  await page.getByRole("button", { name: "确认操作" }).click();
  await expect(page).toHaveURL(/releases\/[0-9a-f-]+$/);
  const snapshot = page.url().split("/").pop()!;
  await page.goto("/channels");
  const canary = page
    .locator(".detail-panel")
    .filter({
      has: page.getByRole("heading", { name: "canary", exact: true }),
    });
  await canary.getByLabel("目标快照").selectOption(snapshot);
  await canary.getByRole("button", { name: "预览并推进" }).click();
  await page
    .getByLabel("变更原因（必填）")
    .fill("Browser acceptance verified Git artifacts");
  await page.getByRole("button", { name: "确认操作" }).click();
  await expect(page.getByRole("status")).toContainText("操作已完成");
  await page.goto("/profiles/new");
  const name = "browser-agent-" + Date.now();
  await page.getByLabel("Profile 名称").fill(name);
  await page
    .getByRole("combobox", { name: "发布渠道", exact: true })
    .selectOption({ label: "canary" });
  await page
    .getByRole("checkbox", { name: "code-review", exact: true })
    .check();
  await page.getByRole("checkbox", { name: "sql-query", exact: true }).check();
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page).toHaveURL(/profiles\/[0-9a-f-]+$/);
  await page.goto("/clients/new");
  await page.getByLabel("终端名称").fill(name);
  await page
    .getByRole("combobox", { name: "所属 Profile", exact: true })
    .selectOption({ label: name + " · canary" });
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(
    page.getByRole("heading", { name: "凭据仅显示一次" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "已安全保存" }).click();
  await page.goto("/clients");
  await page.getByRole("link", { name, exact: true }).click();
  await page.getByRole("button", { name: "轮换凭据" }).click();
  await page.getByRole("button", { name: "确认操作" }).click();
  await expect(
    page.getByRole("heading", { name: "凭据仅显示一次" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "已安全保存" }).click();
  await page.getByRole("button", { name: "吊销终端" }).click();
  await page.getByRole("button", { name: "确认操作" }).click();
  await expect(page.getByText("revoked", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "../../test-results/screenshots/client-revoked.png",
    fullPage: true,
  });
});
