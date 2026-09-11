import { defineConfig } from "@playwright/test";

/**
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
 */
export default defineConfig({
  testDir: "./tests/perf",
  globalSetup: "./tests/perf/support/globalSetup.config.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 180_000,
  use: {
    baseURL: "app://local",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  // Sin `webServer`: no hay servidor. El shell sirve su propio origen.
});
