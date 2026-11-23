import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Config propia de la medición de la tanda 1 (Plan_1.1.1.md §2, paso 2).
 *
 * No entra en los gates: el `vitest.config.ts` de la raíz solo incluye
 * `tests/**\/*.test.ts`, y la medición es `medicion.spec.ts`. Se corre aparte:
 *
 *   pnpm exec vitest run --config tests/paises/vitest.paises.config.ts
 *
 * Reusa del config de la raíz solo los alias de `@anonly/shared` y
 * `@anonly/event-system` (los motores se importan por ruta relativa).
 */
const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: [
      {
        find: "@anonly/shared",
        replacement: resolve(rootDir, "packages/anonymization-core/shared/src/index.ts"),
      },
      {
        find: "@anonly/event-system",
        replacement: resolve(rootDir, "packages/anonymization-core/event-system/src/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/paises/medicion.spec.ts"],
    globals: false,
    reporters: ["default"],
    pool: "forks",
    testTimeout: 600_000,
  },
});
