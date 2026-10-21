import { test, expect } from "../../apps/web/node_modules/@playwright/test";

test("language changes persist without losing form input", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("test@example.com");
  await page.getByRole("button", { name: "Switch to Chinese" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("textbox", { name: "邮箱", exact: true }),
  ).toHaveValue("test@example.com");
  await page.reload();
  await expect(page.getByRole("heading", { name: "登录工作区" })).toBeVisible();
  await page.getByRole("button", { name: "切换为英文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill(process.env.SKIVA_ADMIN_EMAIL || "admin@localhost");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(process.env.SKIVA_ADMIN_PASSWORD || "local-skiva-development-2026");
  await page
    .getByRole("button", { name: "Sign in to your workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(
    page.getByRole("heading", { name: "Delivery overview" }),
  ).toBeVisible();
  await page.goto("/repositories/new");
  const input = page.getByRole("textbox", {
    name: "Repository name",
    exact: true,
  });
  await input.fill("测试-repository-kept");
  await page.getByRole("button", { name: "Switch to Chinese" }).click();
  await expect(
    page.getByRole("textbox", { name: "仓库名称", exact: true }),
  ).toHaveValue("测试-repository-kept");
  await page.getByRole("button", { name: "切换为英文" }).click();
  await expect(input).toHaveValue("测试-repository-kept");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
