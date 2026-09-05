import { defineConfig } from "@playwright/test";

/**
 * Config E2E contra el contenedor de escritorio (ADR-130).
 *
 * Reemplaza a `playwright.config.ts`, que corría contra un navegador — un
 * target que el 1.0 ya no publica.
 *
 * **`pnpm test:e2e` construye el renderer y el shell antes de correr, y no es
 * opcional.** El config de navegador levantaba un dev server, así que siempre
 * probaba el código vivo. Acá el shell sirve un `dist` **estático**
 * (`rendererRoot`): correr `playwright test` a mano contra un build viejo
 * prueba una versión de la app que ya no existe, y los fallos apuntan a bugs
 * que se arreglaron hace rato. Pasó: seis specs fallaron contra un `dist`
 * anterior a un arreglo del diálogo de Configuración.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  /*
   * Sin paralelismo. Cada test levanta un proceso de Electron completo —
   * Chromium más los ~243 MB de assets del renderer—, así que correr varios a
   * la vez satura la memoria antes que los cores.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    // `page.goto("/")` de los specs resuelve contra el origen del shell.
    baseURL: "app://local",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Sin `webServer`: no hay servidor. La app sirve su propio origen.
});
