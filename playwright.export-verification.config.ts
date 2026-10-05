import { defineConfig } from "@playwright/test";

const reportPath =
  process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? "test-results/export-verification.json";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["export-verification.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 300_000,
  reporter: [["list"], ["json", { outputFile: reportPath }]],
  outputDir: "test-results/export-verification-artifacts",
  use: {
    baseURL: "app://local",
    trace: "off",
    screenshot: "off",
  },
});
