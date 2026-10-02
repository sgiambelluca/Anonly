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
 * **Qué se exige y qué solo se reporta** (decisión del humano, 2026-09-29;
 * `support/pipelineTiming.ts`, `07_Performance_Strategy.md` §11.4):
 *
 * - **Siempre** (también en CI): que el pipeline llegue a `Ready`, sin
 *   `PIPELINE_FAILED`, y que se haya medido un trabajo real (tiempo > 0).
 *   Cada test mide y reporta su tiempo; ninguno se saltea.
 * - **Solo con `ANONLY_PERF_ENFORCE_BUDGET=1`** (local, antes de cada
 *   release): además, los presupuestos de `00_Project_Vision.md` §7 (8 s
 *   nativo, 60 s escaneado) y la primera fila de ADR-151 §3. El runner de CI
 *   no es el hardware de referencia del objetivo de 8 s (sigue sin decidir,
 *   Hito 11), así que ahí no se aplica el umbral.
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
import { corruptFile, textTenPagesFile } from "../e2e/support/fixtures.js";
import { rasterizeToScannedPdf } from "../e2e/support/scannedPdf.js";

import {
  ENFORCE_BUDGET_ENV,
  evaluateFirstPageWarm,
  evaluatePipelineTiming,
  isBudgetEnforced,
  type TimingVerdict,
} from "./support/pipelineTiming.js";

/** `00_Project_Vision.md` §7 — objetivos contractuales del MVP. */
const BUDGETS_MS = {
  nativeTextEndToEnd: 8_000,
  scannedOcrEndToEnd: 60_000,
} as const;

test.setTimeout(180_000);

/** ¿Este run aplica el umbral? Solo con `ANONLY_PERF_ENFORCE_BUDGET=1`. */
const ENFORCE_BUDGET = isBudgetEnforced(process.env);

/** Reporta el tiempo medido (consola + anotación del reporte JSON) aunque no se aplique umbral. */
function reportTiming(label: string, verdict: TimingVerdict, budgetMs: number): void {
  const elapsed = verdict.elapsedMs === null ? "n/d" : `${Math.round(verdict.elapsedMs)} ms`;
  const mode = ENFORCE_BUDGET ? `umbral ${budgetMs} ms aplicado` : "sin umbral (medición)";
  const line = `[perf] ${label}: import -> Ready ${elapsed}; ${mode}`;
  console.log(line);
  test.info().annotations.push({ type: "perf", description: line });
}

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

test("PDF 10 páginas con texto: import -> Ready se mide; menos de 8s con ANONLY_PERF_ENFORCE_BUDGET=1 (Vision §7)", async ({
  page,
}) => {
  await openApp(page, "networkidle");
  const file = await textTenPagesFile();
  // El SLA empieza justo antes de importar: generar el fixture es preparación
  // del test, no trabajo del producto (ADR-153).
  await installCollector(page);
  await page.locator('input[type="file"]').setInputFiles(file);

  await waitForSettled(page, BUDGETS_MS.nativeTextEndToEnd + 30_000);
  const perf = await readPerf(page);

  const verdict = evaluatePipelineTiming(perf, BUDGETS_MS.nativeTextEndToEnd, ENFORCE_BUDGET);
  reportTiming("texto 10 páginas", verdict, BUDGETS_MS.nativeTextEndToEnd);
  expect(verdict.failures).toEqual([]);
});

test("PDF 10 páginas escaneadas: import -> Ready (vía OCR real) se mide; menos de 60s con ANONLY_PERF_ENFORCE_BUDGET=1 (Vision §7)", async ({
  page,
}) => {
  await openApp(page, "networkidle");

  const textFile = await textTenPagesFile();
  // Mismo método que tests/measure/baseline.spec.ts (MEASURE_SCAN) y
  // tests/e2e/ escenario 2: rasteriza el PDF de texto DENTRO del browser
  // para producir un PDF de solo imágenes — así se ejercita el camino OCR
  // real, no la capa textual del PDF de entrada.
  const scannedFile = await rasterizeToScannedPdf(page, new Uint8Array(textFile.buffer));

  // El PDF de entrada y la rasterización son preparación del fixture, no
  // parte del SLA import → Ready. Instalar el recolector acá deja el archivo
  // listo y todavía precede a la importación real.
  await installCollector(page);
  await page.locator('input[type="file"]').setInputFiles(scannedFile);

  await waitForSettled(page, BUDGETS_MS.scannedOcrEndToEnd + 60_000);
  const perf = await readPerf(page);

  const verdict = evaluatePipelineTiming(perf, BUDGETS_MS.scannedOcrEndToEnd, ENFORCE_BUDGET);
  reportTiming("escaneado 10 páginas", verdict, BUDGETS_MS.scannedOcrEndToEnd);
  expect(verdict.failures).toEqual([]);
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
  // Siempre: el panel llegó a abrirse sin que el pipeline fallara.
  expect(perf.failedAt, "el pipeline terminó en PIPELINE_FAILED, no en Ready").toBeUndefined();

  const line = `[perf] página 1 precalentada: RENDER_REQUESTED para la página 1 = ${String(
    perf.renderRequestedForFirstOriginalPage,
  )}; ${ENFORCE_BUDGET ? "exigido" : "sin umbral (medición)"}`;
  console.log(line);
  test.info().annotations.push({ type: "perf", description: line });

  // Con ANONLY_PERF_ENFORCE_BUDGET=1 — la propiedad exacta que promete ADR-151
  // §3: el panel se abrió sin que la UI tuviera que pedir el render de la
  // página 1 — ya estaba precalentado en el store desde Ready (ADR-151 §1),
  // vía bus-bridge.ts, sin visor montado todavía.
  expect(evaluateFirstPageWarm(perf.renderRequestedForFirstOriginalPage, ENFORCE_BUDGET)).toEqual(
    [],
  );

  // Y la página 1 del lado original está montada en el primer frame de ②b
  // (`PageCanvas`, `role="img"` + `aria-label` propio) — no alcanza con que
  // nadie haya pedido el render si el panel ni siquiera llegó a montar esa
  // página.
  if (ENFORCE_BUDGET) {
    await expect(page.getByRole("img", { name: "Página 1, original" })).toBeVisible();
  }
});

test("control discriminante (ADR-149 §2): el gate se pone rojo con el mismo método que lo mide", async ({
  page,
}) => {
  // Antes esto medía `waitForTimeout(120) >= 50`: nunca tocaba el recolector
  // ni `PIPELINE_READY`, así que no probaba nada del gate (tautología). Ahora
  // corre el método REAL — `installCollector` -> import -> `waitForSettled` ->
  // `readPerf` -> `evaluatePipelineTiming` — sobre el producto, y demuestra
  // las dos formas de romperlo:
  //
  // 1. un presupuesto que la corrida no puede cumplir, con el umbral aplicado,
  //    da rojo por tiempo (y sin umbral, la misma corrida da verde);
  // 2. un PDF corrupto no llega a `Ready` y da rojo con o sin umbral.
  await openApp(page, "networkidle");
  const file = await textTenPagesFile();
  await installCollector(page);
  await page.locator('input[type="file"]').setInputFiles(file);
  await waitForSettled(page, BUDGETS_MS.nativeTextEndToEnd + 30_000);
  const perf = await readPerf(page);

  const impossibleBudgetMs = 1;
  const enforced = evaluatePipelineTiming(perf, impossibleBudgetMs, true);
  expect(enforced.failures, "con umbral, un presupuesto imposible tiene que dar rojo").toHaveLength(
    1,
  );
  expect(enforced.failures[0]).toContain(ENFORCE_BUDGET_ENV);
  expect(
    evaluatePipelineTiming(perf, impossibleBudgetMs, false).failures,
    "sin umbral, la misma corrida no falla por tiempo",
  ).toEqual([]);

  // Segundo documento: corrupto, en una página limpia (el pipeline anterior
  // terminó en Ready y el recolector viejo ya disparó).
  await page.reload();
  await page.waitForLoadState("networkidle");
  await installCollector(page);
  const corrupt = await corruptFile();
  await page.locator('input[type="file"]').setInputFiles(corrupt);
  await waitForSettled(page, 60_000);
  const broken = await readPerf(page);
  for (const enforce of [false, true]) {
    expect(
      evaluatePipelineTiming(broken, BUDGETS_MS.nativeTextEndToEnd, enforce).failures.length,
      `un PDF corrupto no llega a Ready (umbral ${String(enforce)})`,
    ).toBeGreaterThan(0);
  }
});
