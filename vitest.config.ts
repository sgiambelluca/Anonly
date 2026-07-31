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
 * - apps: src/__tests__/*.test.ts (tests de apps, p. ej. react-client/core-adapter,
 *   Hito 10 PR5 — mismo patrón que packages, sin el mismo régimen de
 *   contract/edge ni gate de cobertura por thresholds, ai/AI_Development_Guide.md)
 *
 * Environment: node (los tests del Core no necesitan DOM; los de
 * apps/react-client/core-adapter tampoco: ejercitan Zustand + un IEventBus
 * real de node, sin renderizar componentes React).
 * Los tests E2E corren con Playwright, no con Vitest.
 *
 * Notas:
 * - `deps.moduleDirectories` evita que Vitest siga symlinks de pnpm y duplique tests.
 * - `resolve.alias` fuerza a que @anonly/shared y @anonly/event-system siempre
 *   resuelvan al workspace real (no al symlink dentro de node_modules).
 * - `resolve.alias` es un ARRAY (no el objeto `{ find: replacement }` más
 *   simple) porque `@anonly/ner-engine` y `@anonly/export-engine` necesitan
 *   un `find` como RegExp anclado (`^...$`), no un string: el alias de Vite
 *   con `find` string matchea por PREFIJO (`id === find || id.startsWith(find
 *   + "/")`) y reemplaza solo esa porción, concatenando el resto tal cual
 *   sobre el `replacement` — que acá es un ARCHIVO (`.../<engine>/src/index.ts`),
 *   no un directorio. Desde que `ner-engine` (PR15, ADR-046) y
 *   `export-engine` (PR16, ADR-047) ganaron el subpath `"./worker"` en su
 *   `package.json`, un import `@anonly/<engine>/worker` bajo este mismo
 *   config (p. ej. `apps/react-client/src/__tests__/core-adapter.test.ts`,
 *   que corre bajo el `vitest.config.ts` raíz) caía en ese alias de prefijo y
 *   resolvía a `.../src/index.ts/worker` (inexistente) en vez de dejar que
 *   Node/Vite resuelvan la subpath real vía `exports`. El resto de las
 *   entradas queda con `find` string (comportamiento idéntico al objeto
 *   previo): ninguna otra expone subpaths propios hoy.
 * - `exclude` explícitamente excluye node_modules para que los tests dentro de
 *   symlinks no se dupliquen.
 * - `ortUrlAssetStub` (ver abajo) desacopla la suite unitaria de los assets
 *   mirroreados de `assets.lock.json`.
 */

/*
 * Los dos assets de onnxruntime que `apps/react-client/src/core-adapter/index.ts`
 * importa con `?url` (ADR-039 §3) NO se commitean: los produce `pnpm
 * assets:mirror` en `apps/react-client/src/assets/onnxruntime/`, que está en
 * `.gitignore`. En una checkout limpia esos archivos no existen, y Vite
 * rechaza el id (`Denied ID ...?url`) al CARGAR las dos suites que importan
 * el `core-adapter` — falla de colección, no de aserción: los tests ni
 * llegan a correr.
 *
 * El job `e2e` de CI resuelve eso corriendo `assets:mirror` (necesita la app
 * de verdad); el job `test` no puede: mirrorear 219 MB —de los cuales 178 MB
 * son el modelo NER, que ninguna suite unitaria carga— para resolver dos
 * imports es desproporcionado, y ataría el gate más caliente del repo a una
 * descarga de red.
 *
 * Este plugin corta esa dependencia en la raíz: intercepta el id ANTES que
 * `vite:resolve` (`enforce: "pre"`) y lo sirve como un módulo virtual cuyo
 * default export es una URL de juguete. Es exactamente lo que las suites
 * necesitan — la única aserción sobre estos valores es
 * `expect(receivedConfig?.ner?.wasmPaths).toBeDefined()`
 * (`core-adapter-init-precedence.test.ts:83`): les importa que la inyección
 * de ADR-039 ocurra, no qué URL concreta produjo el bundler (que en un build
 * real es un nombre hasheado, no asertable de todos modos).
 *
 * Alcance: solo este config, o sea solo `vitest`. El build de la app
 * (`apps/react-client/vite.config.ts`) y el job `e2e` siguen usando los
 * archivos reales, así que el camino de producción no queda sin cubrir.
 *
 * El `export default` del módulo generado no viola Code_Standards.md §3: es
 * código emitido por el plugin, no fuente del repo, y un import `?url` es
 * por definición un default import — no hay forma alternativa de expresarlo.
 */
const ORT_URL_ASSET_RE = /\/assets\/onnxruntime\/[^/]+\?url$/;
const ORT_URL_STUB_PREFIX = "\0anonly-ort-url-stub:";

const ortUrlAssetStub = {
  name: "anonly:ort-url-asset-stub",
  enforce: "pre" as const,
  resolveId(id: string): string | null {
    return ORT_URL_ASSET_RE.test(id) ? `${ORT_URL_STUB_PREFIX}${id}` : null;
  },
  load(id: string): string | null {
    if (!id.startsWith(ORT_URL_STUB_PREFIX)) return null;
    const source = id.slice(ORT_URL_STUB_PREFIX.length);
    const fileName = source.slice(source.lastIndexOf("/") + 1).replace("?url", "");
    return `export default ${JSON.stringify(`/__vitest_stub__/${fileName}`)};`;
  },
};

export default defineConfig({
  plugins: [ortUrlAssetStub],
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
      {
        find: "@anonly/anonymization-core",
        replacement: resolve(rootDir, "packages/anonymization-core/src/index.ts"),
      },
      // tests/security/security.test.ts (fuera del paquete) importa
      // @anonly/export-engine por contrato público; este alias lo resuelve al
      // workspace real, mismo criterio que las tres entradas de arriba.
      // RegExp anclado (no string, PR16/ADR-047): export-engine ganó el
      // subpath "./worker" en su package.json (mismo motivo que
      // @anonly/ner-engine más abajo) — apps/react-client/src/core-adapter/
      // index.ts (corre bajo este mismo config, ver `include`) importa
      // "@anonly/export-engine/worker?worker"; con `find` string el alias de
      // prefijo lo reescribiría a `.../export-engine/src/index.ts/worker`
      // (inexistente) en vez de dejar que Node/Vite resuelvan la subpath real
      // vía `exports`.
      {
        find: /^@anonly\/export-engine$/,
        replacement: resolve(rootDir, "packages/anonymization-core/export-engine/src/index.ts"),
      },
      // tests/integration/ (Hito 9, ADR-034 §6) importa estos motores
      // directamente para el par crítico "Regex + NER → Grouping vía
      // ENTITY_FOUND" con motores reales; mismo criterio que export-engine.
      {
        find: "@anonly/regex-engine",
        replacement: resolve(rootDir, "packages/anonymization-core/regex-engine/src/index.ts"),
      },
      // RegExp anclado (no string): ver nota de cabecera — evita que
      // `@anonly/ner-engine/worker` (PR15, ADR-046) caiga en este alias.
      {
        find: /^@anonly\/ner-engine$/,
        replacement: resolve(rootDir, "packages/anonymization-core/ner-engine/src/index.ts"),
      },
      {
        find: "@anonly/grouping-engine",
        replacement: resolve(rootDir, "packages/anonymization-core/grouping-engine/src/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: [
      // `src/**/__tests__/` (no `src/__tests__/` literal): PR15/ADR-046 es el
      // primer motor con tests anidados junto a un subdirectorio de código
      // (`src/worker/__tests__/`, NER_Engine.md §14) — el `**` extra entre
      // `src` y `__tests__` sigue matcheando el layout plano de todos los
      // demás paquetes (`src/__tests__/*.test.ts`), verificado con picomatch.
      "packages/**/src/**/__tests__/**/*.test.ts",
      "tests/**/*.test.ts",
      "apps/**/src/__tests__/**/*.test.ts",
    ],
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
