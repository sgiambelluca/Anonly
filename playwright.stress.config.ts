import { defineConfig } from "@playwright/test";

/** Serial Electron stress gate; `pnpm test:stress` rebuilds the packaged app first. Default export: ADR-185 §6. */
export default defineConfig({
  testDir: "./tests/stress",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./tests/perf/support/globalSetup.config.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // ADR-149 §1: con `PLAYWRIGHT_JSON_OUTPUT_NAME` (lo pone CI) además del listado
  // se escribe el reporte JSON que lee `scripts/ci/assert-min-tests.mjs`. Va por
  // variable y no por `--reporter`: `pnpm` tiene su propio `--reporter`.
  reporter: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ? [["list"], ["json"]] : "list",
  timeout: 600_000,
  use: {
    baseURL: "app://local",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
