import { defineConfig, devices } from "@playwright/test";

/**
 * Config del **harness de medición** (`tests/measure/`), separada de la de
 * los E2E a propósito.
 *
 * Por qué no es un spec más de `tests/e2e/`:
 *
 * - `fullyParallel` falsearía los números. Dos documentos midiéndose a la vez
 *   compiten por los mismos núcleos, que es justo la variable bajo estudio
 *   (`roadmap/Optimizacion_De_Rendimiento.md`, puntos A/B/C).
 * - `retries` promediaría corridas frías y calientes.
 * - Medir tarda; la suite E2E es un gate y tiene que seguir siendo rápida.
 *
 * Comparte el `webServer` con la config E2E (`reuseExistingServer` fuera de
 * CI), así que las dos pueden convivir sin levantar dos dev servers.
 */
export default defineConfig({
  testDir: "./tests/measure",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 300_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @anonly/react-client dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
