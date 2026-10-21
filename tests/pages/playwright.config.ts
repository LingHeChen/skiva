import { defineConfig } from "../../apps/web/node_modules/@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: ".",
  testMatch: "docs.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3102", channel: "chrome" },
  outputDir: "../../test-results/pages-browser",
  webServer: {
    command:
      "python3 -m http.server 3102 --bind 127.0.0.1 --directory .pages-preview",
    cwd: path.resolve(__dirname, "../.."),
    url: "http://127.0.0.1:3102/skiva/",
    reuseExistingServer: !process.env.CI,
  },
});
