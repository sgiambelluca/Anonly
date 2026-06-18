import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config del monorepo.
 *
 * Tests E2E en `tests/e2e/`. Se activan en Hito 10 (React Client).
 * Antes de Hito 10, no hay tests E2E y el workflow de CI los saltea
 * (ver .github/workflows/ci.yml → job `test-e2e` con `if: hashFiles(...)`).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm --filter @anonly/react-client dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
