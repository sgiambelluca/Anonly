import { defineConfig } from "@playwright/test";

/**
 * **Alcance de `pnpm test:perf` (decisión del humano, 2026-09-29).** El gate es
 * **solo** `tests/perf/pipeline-timing.spec.ts`: el script lo nombra
 * explícitamente. El resto de `tests/perf/` son campañas y arneses de
 * medición (decenas de specs, muchas con variables de entorno obligatorias,
 * horas de corrida) que se corren **por archivo explícito** con sus `run-*.sh`
 * o con `playwright test --config=playwright.perf.config.ts <archivo>`; este
 * config sirve a las dos cosas y por eso no fija `testMatch` a un solo
 * archivo. Ningún `run-*.sh` pasa por `pnpm test:perf`: si alguno lo hiciera,
 * el argumento se sumaría al spec del gate en vez de reemplazarlo. El umbral
 * de tiempo del gate solo se aplica con `ANONLY_PERF_ENFORCE_BUDGET=1`
 * (`tests/perf/support/pipelineTiming.ts`); sin la variable mide y reporta.
 *
 * Config del gate `pnpm test:perf` (H-07, ADR-149 §3/§4, ADR-153), separada
 * de `playwright.electron.config.ts` (E2E) por las mismas razones que
 * `playwright.measure.config.ts` está separada de la suya: `retries: 0` (un
 * reintento silencioso escondería una regresión de tiempos detrás de un
 * segundo intento con cache tibia — el config de E2E sí reintenta en CI, para
 * flakiness de flujo, que es una propiedad distinta) y sin paralelismo (dos
 * documentos midiéndose a la vez compiten por los mismos núcleos, la
 * variable bajo estudio).
 *
 * **Corre sobre el shell de Electron empaquetado, no un servidor HTTP**
 * (ADR-153): `vite preview` medía ~5 s más lento que el producto real para
 * el mismo trabajo —causa sin identificar, no era compresión, MIME,
 * aislamiento, caché ni tamaño de chunk— y el dev server nunca fue el
 * artefacto que se instala (ADR-130). `pnpm test:perf` construye las dos
 * mitades primero (`VITE_E2E=1 react-client build` + `desktop-shell build`,
 * igual que `test:e2e`) y este config no levanta ningún `webServer`: usa el
 * mismo arnés que los E2E (`tests/e2e/support/electronApp.ts`,
 * `_electron.launch()` con un `--user-data-dir` propio por test).
 *
 * `globalSetup` (`support/globalSetup.config.ts` → `support/checkFreshBuild.ts`):
 * revienta si alguien corre este config directo, sin pasar por
 * `pnpm test:perf` (que reconstruye antes de medir) — Task 4 de H-10 perdió
 * una tanda entera de mediciones así, con los gates en verde porque ninguno
 * depende del build empaquetado.
 *
 * `testMatch` explícito a `*.spec.ts`: el default de Playwright también
 * matchea `*.test.ts`, y `support/` (ADR-159 §2, `cdpHeap.ts`) tiene sus
 * propios tests de Vitest (`cdpHeap.test.ts`, `aggregateMemoryReports.test.ts`)
 * colocados junto al código que prueban — convención ya establecida en el
 * resto del repo (`.test.ts` es de Vitest, `.spec.ts` es de Playwright;
 * `vitest.config.ts` incluye todo `.test.ts` bajo `tests/`, recursivo). Sin
 * esto Playwright intenta correr un archivo de Vitest como si fuera un test
 * propio y revienta con "Vitest failed to access its internal state" — no es
 * un caso hipotético, es lo que pasaba antes de esta línea.
 */
export default defineConfig({
  testDir: "./tests/perf",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./tests/perf/support/globalSetup.config.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // ADR-149 §1: con `PLAYWRIGHT_JSON_OUTPUT_NAME` (lo pone CI) además del listado
  // se escribe el reporte JSON que lee `scripts/ci/assert-min-tests.mjs`. Va por
  // variable y no por `--reporter`: `pnpm` tiene su propio `--reporter`.
  reporter: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ? [["list"], ["json"]] : "list",
  timeout: 180_000,
  use: {
    baseURL: "app://local",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  // Sin `webServer`: no hay servidor. El shell sirve su propio origen.
});
