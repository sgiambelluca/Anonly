/**
 * `globalSetup` de `playwright.perf.config.ts` — revienta temprano y con
 * mensaje claro si `apps/react-client/dist` es más viejo que el fuente más
 * nuevo de `apps/react-client/src`, en vez de medir en silencio una app
 * vieja.
 *
 * Motivo concreto (H-10, Task 4): la primera corrida de atribución de
 * `renderPoolSize` (canal de overrides, ADR-155) dio el mismo conteo de
 * workers en las 6 corridas, como si el override nunca se aplicara. La
 * causa no fue el canal: `apps/react-client/dist` tenía ~5,7 h de
 * antigüedad, de antes del commit que agregó el canal a
 * `core-adapter/index.ts`. Los gates de esa tarea (typecheck/lint/unit con
 * `createCore` mockeado) habían pasado igual, porque ninguno depende del
 * build empaquetado (ADR-153 exige medir sobre el build, no sobre el
 * fuente) — el error solo se notó revisando a mano un número que no debía
 * repetirse. Este guard lo hace estructural: `playwright test
 * --config=playwright.perf.config.ts` sin pasar antes por `pnpm test:perf`
 * (que reconstruye las dos mitades) ahora falla en vez de medir en
 * silencio.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REACT_CLIENT_DIR = resolve(HERE, "../../../apps/react-client");
const SRC_DIR = join(REACT_CLIENT_DIR, "src");
const DIST_DIR = join(REACT_CLIENT_DIR, "dist");

function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtimeMs(path));
    } else if (entry.isFile()) {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

const REBUILD_HINT =
  "VITE_E2E=1 pnpm --filter @anonly/react-client build && pnpm --filter @anonly/desktop-shell build " +
  "(pnpm test:perf ya hace las dos cosas antes de correr Playwright).";

export function checkFreshBuild(): void {
  let distNewest: number;
  try {
    distNewest = newestMtimeMs(DIST_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `apps/react-client/dist no existe. Este gate mide el build empaquetado (ADR-153), ` +
          `no el código fuente. Construí antes de medir: ${REBUILD_HINT}`,
      );
    }
    throw err;
  }

  const srcNewest = newestMtimeMs(SRC_DIR);
  if (distNewest < srcNewest) {
    const staleHours = ((srcNewest - distNewest) / 3_600_000).toFixed(1);
    throw new Error(
      `apps/react-client/dist tiene ${staleHours} h más de antigüedad que el archivo más nuevo ` +
        `de apps/react-client/src — vas a medir una app vieja en silencio si seguís. Reconstruí ` +
        `antes de medir: ${REBUILD_HINT}`,
    );
  }
}
