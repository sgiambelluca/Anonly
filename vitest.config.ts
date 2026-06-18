import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

/**
 * Vitest config del monorepo.
 *
 * Cobertura:
 * - packages: src/__tests__/*.test.ts (tests de paquetes)
 * - tests: *.test.ts (tests globales: integration, perf, leak, cancel, security, stress)
 *
 * Environment: node (los tests del Core no necesitan DOM).
 * Los tests E2E corren con Playwright, no con Vitest.
 *
 * Notas:
 * - `deps.moduleDirectories` evita que Vitest siga symlinks de pnpm y duplique tests.
 * - `resolve.alias` fuerza a que @anonly/shared y @anonly/event-system siempre
 *   resuelvan al workspace real (no al symlink dentro de node_modules).
 * - `exclude` explícitamente excluye node_modules para que los tests dentro de
 *   symlinks no se dupliquen.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@anonly/shared": resolve(rootDir, "packages/anonymization-core/shared/src/index.ts"),
      "@anonly/event-system": resolve(
        rootDir,
        "packages/anonymization-core/event-system/src/index.ts",
      ),
      "@anonly/anonymization-core": resolve(rootDir, "packages/anonymization-core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/src/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules/**", "**/node_modules/**", "dist/**", "tests/e2e/**"],
    globals: false,
    reporters: ["default"],
    deps: {
      moduleDirectories: ["node_modules"],
      fallbackCjs: false,
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["packages/**/src/**/*.ts"],
      exclude: [
        "packages/**/src/**/__tests__/**",
        "packages/**/src/index.ts",
        "packages/**/*.d.ts",
        "packages/anonymization-core/src/index.ts",
      ],
      // Gate de cobertura: se activa por paquete en hitos posteriores.
      // Hito 1: sin thresholds globales (los paquetes aún no tienen implementación).
      // thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
    pool: "forks",
    restoreMocks: true,
    mockReset: true,
  },
});
