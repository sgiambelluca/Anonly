import { defineConfig } from "@playwright/test";

/** Serial Electron stress gate; `pnpm test:stress` rebuilds the packaged app first. Default export: ADR-185 §6. */
export default defineConfig({
  testDir: "./tests/stress",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./tests/perf/support/globalSetup.config.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 600_000,
  use: {
    baseURL: "app://local",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
