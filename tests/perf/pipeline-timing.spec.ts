/**
 * H-07 (ADR-149 §3, ADR-153): gate real de Performance — mide con NER/OCR
 * reales, sobre el **shell de Electron empaquetado** (ver
 * `playwright.perf.config.ts` para por qué este runner y no Vitest/Node ni
 * un servidor HTTP: ADR-153 midió `vite preview` ~5 s más lento que el
 * producto real para el mismo trabajo, causa sin identificar, y el dev
 * server nunca fue el artefacto que se instala), los presupuestos
 * contractuales de `00_Project_Vision.md` §7 y `07_Performance_Strategy.md`
 * §1/ADR-151 §3 que hoy ningún test numérico verifica:
 * `tests/e2e/scenario-1-import-edit-export.spec.ts` y
 * `scenario-2-scanned-ocr.spec.ts` ejercitan el FLUJO (se llega a Ready), no
 * el tiempo — exactamente la distinción que ADR-149 §1 exige no confundir.
 *
 * Mismo arnés que los E2E (`tests/e2e/support/electronApp.ts`): una
 * instancia de Electron por test, con `--user-data-dir` propio.
 *
 * Frío/caliente (ADR-149 §3, ADR-146 §4): cada `test()` lanza su propia
 * instancia de Electron (ver el fixture `electronApp`), así que todas las
 * corridas de este archivo son en frío — ningún modelo queda cargado de un
 * test al siguiente. Medir "caliente" (con NER/OCR ya cargados) es una
 * corrida separada, no incluida acá: se deja para cuando H-10 fije el
 * instrumento y el criterio de comparación frío/caliente (ADR-146 §6/§4).
 */
import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile } from "../e2e/support/fixtures.js";
import { rasterizeToScannedPdf } from "../e2e/support/scannedPdf.js";

/** `00_Project_Vision.md` §7 — objetivos contractuales del MVP. */
const BUDGETS_MS = {
  nativeTextEndToEnd: 8_000,
  scannedOcrEndToEnd: 60_000,
} as const;

test.setTimeout(180_000);

declare global {
  var __anonlyPerf:
    | {
        startedAt: number;
        readyAt?: number;
        failedAt?: number;
        /** `RENDER_REQUESTED` con `pageIndices` incluyendo 0 y `kind: "original"` — ver ADR-151 §3/§4. */
        renderRequestedForFirstOriginalPage: boolean;
      }
    | undefined;
}

/** Instala el recolector ANTES de soltar el archivo — mismo orden que `tests/measure/baseline.spec.ts`. */
async function installCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) {
      throw new Error(
        "__anonlyCore ausente: ¿el build corrió con VITE_E2E=1? (core-adapter/index.ts:169)",
      );
    }

    const perf: NonNullable<typeof globalThis.__anonlyPerf> = {
      startedAt: performance.now(),
      renderRequestedForFirstOriginalPage: false,
    };
    globalThis.__anonlyPerf = perf;

    core.bus.on("pipeline", "PIPELINE_READY", () => {
      perf.readyAt = performance.now();
    });
    core.bus.on("pipeline", "PIPELINE_FAILED", () => {
      perf.failedAt = performance.now();
    });
    core.bus.on("render", "RENDER_REQUESTED", (payload: unknown) => {
      const { pageIndices, kind } = payload as { pageIndices: ReadonlyArray<number>; kind: string };
      if (kind === "original" && pageIndices.includes(0)) {
        perf.renderRequestedForFirstOriginalPage = true;
      }
    });
  });
}

async function waitForSettled(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const p = globalThis.__anonlyPerf;
      return p !== undefined && (p.readyAt !== undefined || p.failedAt !== undefined);
    },
    undefined,
    { timeout: timeoutMs },
  );
}

async function readPerf(page: Page): Promise<{
  startedAt: number;
  readyAt?: number;
  failedAt?: number;
  renderRequestedForFirstOriginalPage: boolean;
}> {
  return page.evaluate(() => {
    const p = globalThis.__anonlyPerf;
    if (p === undefined) throw new Error("__anonlyPerf ausente");
    return { ...p };
  });
}

test("PDF 10 páginas con texto: import -> Ready en menos de 8s (Vision §7)", async ({ page }) => {
  await openApp(page, "networkidle");
  await installCollector(page);

  const file = await textTenPagesFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  await waitForSettled(page, BUDGETS_MS.nativeTextEndToEnd + 30_000);
  const perf = await readPerf(page);

  expect(perf.failedAt, "el pipeline terminó en PIPELINE_FAILED, no en Ready").toBeUndefined();
  expect(perf.readyAt).toBeDefined();
  const elapsedMs = perf.readyAt! - perf.startedAt;
  expect(elapsedMs).toBeLessThan(BUDGETS_MS.nativeTextEndToEnd);
});

test("PDF 10 páginas escaneadas: import -> Ready (vía OCR real) en menos de 60s (Vision §7)", async ({
  page,
}) => {
  await openApp(page, "networkidle");
  await installCollector(page);

  const textFile = await textTenPagesFile();
  // Mismo método que tests/measure/baseline.spec.ts (MEASURE_SCAN) y
  // tests/e2e/ escenario 2: rasteriza el PDF de texto DENTRO del browser
  // para producir un PDF de solo imágenes — así se ejercita el camino OCR
  // real, no la capa textual del PDF de entrada.
  const scannedFile = await rasterizeToScannedPdf(page, new Uint8Array(textFile.buffer));

  await page.locator('input[type="file"]').setInputFiles(scannedFile);

  await waitForSettled(page, BUDGETS_MS.scannedOcrEndToEnd + 60_000);
  const perf = await readPerf(page);

  expect(perf.failedAt, "el pipeline terminó en PIPELINE_FAILED, no en Ready").toBeUndefined();
  expect(perf.readyAt).toBeDefined();
  const elapsedMs = perf.readyAt! - perf.startedAt;
  expect(elapsedMs).toBeLessThan(BUDGETS_MS.scannedOcrEndToEnd);
});

test("al abrir el panel de trabajo, la página 1 ya está en el store, sin RENDER_REQUESTED de por medio (ADR-151 §3/§4)", async ({
  page,
}) => {
  await openApp(page, "networkidle");
  await installCollector(page);

  const file = await textTenPagesFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  // El botón "Exportar" solo monta con stage ∈ {Ready, Done} — es la señal
  // de que ②b (el panel de trabajo) ya está abierto (mismo locator que
  // tests/e2e/scenario-1-import-edit-export.spec.ts). ADR-150 hace que el
  // pase espere además a que la página 1 esté dibujada (o venza su gracia),
  // así que para cuando este locator resuelve, el precalentado de ADR-151
  // §1 ya tuvo su oportunidad.
  await page.getByRole("button", { name: "Exportar" }).waitFor({ timeout: 30_000 });

  const perf = await readPerf(page);
  expect(perf.failedAt).toBeUndefined();
  // La propiedad exacta que promete ADR-151 §3: el panel se abrió sin que la
  // UI tuviera que pedir el render de la página 1 — ya estaba precalentado
  // en el store desde Ready (ADR-151 §1), vía bus-bridge.ts, sin visor
  // montado todavía.
  expect(perf.renderRequestedForFirstOriginalPage).toBe(false);

  // Y la página 1 del lado original está montada en el primer frame de ②b
  // (`PageCanvas`, `role="img"` + `aria-label` propio) — no alcanza con que
  // nadie haya pedido el render si el panel ni siquiera llegó a montar esa
  // página.
  await expect(page.getByRole("img", { name: "Página 1, original" })).toBeVisible();
});

test("control discriminante (ADR-149 §2): la misma metodología detecta una violación del presupuesto", async ({
  page,
}) => {
  // Mide con el mismo patrón (marca de inicio -> espera -> resta) un trabajo
  // sintético que excede a propósito un presupuesto arbitrario de 50 ms —
  // no toca ninguno de los 7 motores reales (mismo criterio que el control
  // discriminante de tests/cancel/pipeline-cancel.test.ts) — para demostrar
  // que esta forma de medir SÍ reporta una violación cuando existe.
  await openApp(page, "networkidle");
  const startedAt = await page.evaluate(() => performance.now());
  await page.waitForTimeout(120);
  const elapsedMs = (await page.evaluate(() => performance.now())) - startedAt;

  expect(elapsedMs).toBeGreaterThanOrEqual(50);
});
