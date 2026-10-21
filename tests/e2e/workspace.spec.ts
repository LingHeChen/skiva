import { test, expect } from "../../apps/web/node_modules/@playwright/test";
async function login(page: any) {
  await page.goto("/login");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill(process.env.SKIVA_ADMIN_EMAIL || "admin@localhost");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.SKIVA_ADMIN_PASSWORD || "local-skiva-development-2026");
  await page.getByRole("button", { name: "登录工作区", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
}
test("workspace Git browser, source, history, command palette and mobile", async ({
  page,
}) => {
  await login(page);
  const response = await page.request.get("/api/v1/repositories");
  const repos = await response.json();
  const repo = repos.items.find(
    (r: any) => r.sourceType === "managed" && r.provisionState === "active",
  );
  test.skip(!repo, "Requires a provisioned managed repository");
  await page.goto("/repositories/" + repo.id);
  await expect(
    page.getByRole("combobox", { name: "Git 引用", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".skill-markdown")).toBeVisible();
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await expect(page.locator(".source-lines")).toContainText("---");
  await page.getByRole("button", { name: "提交历史", exact: true }).click();
  await expect(page.locator(".repo-editor .object-row").first()).toBeVisible();
  await page.getByRole("button", { name: "返回文件", exact: true }).click();
  await page.getByRole("tab", { name: "Skills", exact: true }).click();
  await expect(page).toHaveURL(/tab=skills/);
  await page.goBack();
  await expect(
    page.getByRole("tab", { name: "文件", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByPlaceholder("搜索仓库、页面或操作…").fill("发布渠道");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/channels/);
  await page.goto("/repositories/" + repo.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("combobox", { name: "Git 引用", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
});
test("release composer inherits Stable full set and invalidates preview after changes", async ({
  page,
}) => {
  await login(page);
  const fixture = (body: any) => ({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/api/v1/skills", (r) =>
    r.fulfill(
      fixture({
        items: [
          {
            id: "s1",
            name: "alpha",
            latestVersionId: "v2",
            repositoryName: "repo-a",
          },
          {
            id: "s2",
            name: "beta",
            latestVersionId: "v3",
            repositoryName: "repo-b",
          },
        ],
      }),
    ),
  );
  await page.route("**/api/v1/channels", (r) =>
    r.fulfill(
      fixture({
        items: [
          {
            id: "stable",
            name: "stable",
            snapshotId: "baseline",
            generation: 1,
            history: [],
          },
        ],
      }),
    ),
  );
  await page.route("**/api/v1/releases/baseline", (r) =>
    r.fulfill(
      fixture({
        id: "baseline",
        items: [
          { name: "alpha", versionId: "v1" },
          { name: "beta", versionId: "v3" },
        ],
      }),
    ),
  );
  await page.route("**/api/v1/skills/*/versions", (r) =>
    r.fulfill(
      fixture({
        items: [
          { id: "v1", commitSha: "111111111111", createdAt: "2026-10-01" },
          { id: "v2", commitSha: "222222222222", createdAt: "2026-10-02" },
          { id: "v3", commitSha: "333333333333", createdAt: "2026-10-03" },
        ],
      }),
    ),
  );
  let previewBody: any;
  await page.route("**/api/v1/releases/preview", (r) => {
    previewBody = r.request().postDataJSON();
    return r.fulfill(
      fixture({
        items: [{ name: "alpha", versionId: "v2" }],
        files: [],
        affectedProfiles: [],
      }),
    );
  });
  await page.goto("/releases/new");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /alpha/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /beta/ })).toBeChecked();
  await expect(dialog.getByRole("combobox", { name: "alpha版本" })).toHaveValue(
    "v1",
  );
  await dialog.getByRole("combobox", { name: "alpha版本" }).selectOption("v2");
  await dialog.getByRole("checkbox", { name: /beta/ }).uncheck();
  await expect(dialog.getByRole("alert")).toContainText("beta");
  await dialog
    .getByRole("button", { name: "预览完整视图", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "创建不可变快照", exact: true }),
  ).toBeEnabled();
  expect(previewBody.versionIds).toEqual(["v2"]);
  await dialog.getByRole("combobox", { name: "alpha版本" }).selectOption("v1");
  await expect(
    dialog.getByRole("button", { name: "创建不可变快照", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/releases$/);
});
