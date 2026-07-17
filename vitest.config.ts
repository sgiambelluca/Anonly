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
      // export-engine no es dependencia de ningún package.json de la raíz ni de
      // otro motor (P-2): pnpm no lo enlaza en node_modules/@anonly desde la
      // raíz. tests/security/security.test.ts (fuera del paquete) lo importa
      // por contrato público; este alias lo resuelve al workspace real, mismo
      // criterio que las tres entradas de arriba.
      "@anonly/export-engine": resolve(
        rootDir,
        "packages/anonymization-core/export-engine/src/index.ts",
      ),
      // tests/integration/ (Hito 9, ADR-034 §6) importa estos motores
      // directamente para el par crítico "Regex + NER → Grouping vía
      // ENTITY_FOUND" con motores reales; mismo criterio que export-engine.
      "@anonly/regex-engine": resolve(
        rootDir,
        "packages/anonymization-core/regex-engine/src/index.ts",
      ),
      "@anonly/ner-engine": resolve(rootDir, "packages/anonymization-core/ner-engine/src/index.ts"),
      "@anonly/grouping-engine": resolve(
        rootDir,
        "packages/anonymization-core/grouping-engine/src/index.ts",
      ),
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
      // Gate de cobertura por paquete implementado (ai/Code_Standards.md §10: ≥ 85%
      // líneas por motor). branches/functions en 80 como piso de seguridad (el gate
      // documentado es solo de líneas). Al implementar un motor nuevo (Hito 3+),
      // agregar su glob acá en el mismo PR.
      thresholds: {
        "packages/anonymization-core/shared/src/**": {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 80,
        },
        "packages/anonymization-core/event-system/src/**": {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 80,
        },
        "packages/anonymization-core/pdf-engine/src/**": {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 80,
        },
        "packages/anonymization-core/ocr-engine/src/**": {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 80,
        },
        "packages/anonymization-core/regex-engine/src/**": {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 80,
        },
        "packages/anonymization-core/ner-engine/src/**": {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 80,
        },
        "packages/anonymization-core/grouping-engine/src/**": {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 80,
        },
        "packages/anonymization-core/render-engine/src/**": {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 80,
        },
        "packages/anonymization-core/export-engine/src/**": {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 80,
        },
        "packages/anonymization-core/src/**": {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 80,
        },
      },
    },
    pool: "forks",
    restoreMocks: true,
    mockReset: true,
  },
});
