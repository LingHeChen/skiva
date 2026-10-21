import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../../tests/e2e",
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.SKIVA_WEB_URL || "http://localhost:3001",
    browserName: "chromium",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    [
      "html",
      { outputFolder: "../../test-results/browser-report", open: "never" },
    ],
  ],
  outputDir: "../../test-results/browser",
});
