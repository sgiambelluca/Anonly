/**
 * `margin-ink.spec.ts` — análisis de tinta residual de márgenes
 * (`docs/roadmap/Margenes_Menos_Pixeles_Handoff.md`, M-1 + M-2).
 *
 * Este archivo hoy contiene solo el caso de humo del §2.1 del Handoff:
 * probar, con el fixture chico de qa-stamp (una página, no la campaña
 * completa de los cuatro fixtures), que el registro crudo por TIRA sale
 * efectivamente del worker de OCR y llega a
 * `globalThis.__anonlyMarginInkAnalysis` en el host — antes de correr
 * cualquier campaña de medición real (Handoff §4, cuatro fixtures + la
 * segunda corrida de P2). Esa campaña se agrega en una etapa posterior, ya
 * autorizada por separado.
 *
 * Requiere el patch descartable `instrument.patch` aplicado sobre
 * `ocr-engine/src/worker/kernel.ts` + `ocr.engine.ts` (Handoff §2.1): sin
 * él, `ctx.cache` nunca tiene la clave `margin-ink:...` y este test falla al
 * no ver ningún registro.
 */
import { readFile, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { rasterizeToScannedPdf } from "../e2e/support/scannedPdf.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import {
  analyzeMarginInk,
  installMarginInkCollector,
  readMarginInkAnalysis,
} from "./support/marginInk.js";

const QA_STAMP_PATH = resolve(process.cwd(), "tests/fixtures/qa-stamp.pdf");
const SMOKE_OUTPUT_DIR = resolve(process.cwd(), ".measure/margenes-tinta/20260916-351fc4d3/smoke");

test.setTimeout(120_000);

test("humo — un registro de tinta de margen llega de worker a host", async ({ page }) => {
  test.skip(
    process.env.ANONLY_MARGIN_INK_ENABLED !== "1",
    "Análisis de tinta de márgenes opt-in: use ANONLY_MARGIN_INK_ENABLED=1 (instrument.patch debe estar aplicado).",
  );

  // Pools chicos a propósito: es un fixture de una sola página, no la
  // campaña de medición real (esa fija los tamaños del Handoff §4.1).
  await installEngineOverrides(page, {
    workerPool: { pdfPoolSize: 1, ocrPoolSize: 1, nerPoolSize: 1, renderPoolSize: 1 },
  });
  await openApp(page, "networkidle");

  const qaStampBytes = await readFile(QA_STAMP_PATH);
  const scanned = await rasterizeToScannedPdf(page, qaStampBytes);

  await installMarginInkCollector(page);

  await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
  await page.locator('input[type="file"]').setInputFiles(scanned);

  // qa-stamp tiene una sola página con las dos tiras activas (ADR-121): no
  // hace falta esperar PIPELINE_READY completo (NER/grouping no importan
  // acá), alcanza con que el worker haya despachado los dos registros.
  await page.waitForFunction(
    () => (globalThis.__anonlyMarginInkAnalysis?.length ?? 0) >= 2,
    undefined,
    { timeout: 60_000 },
  );

  const records = await readMarginInkAnalysis(page);
  expect(records.length).toBeGreaterThanOrEqual(2);

  // La agregación no debe lanzar: si el registro real violara algún
  // invariante del Handoff §2.4, esto es exactamente lo que tiene que
  // fallar acá, antes de confiar en cualquier corrida de campaña.
  const analysis = analyzeMarginInk(records);

  // Handoff §2.3: el contador de desajustes de proyección tiene que dar 0 en
  // una corrida con el instrumento correcto — es la verificación de la
  // transformación inversa, y va en el reporte aunque dé 0.
  expect(analysis.totalProjectionMismatches).toBe(0);

  // Ground truth de ADR-121 (qa-stamp): el sello vive en el margen y aporta
  // palabras reales — al menos una de las dos tiras tiene que reflejarlo.
  expect(records.some((r) => r.wordsAddedByThisStrip > 0)).toBe(true);

  await mkdir(SMOKE_OUTPUT_DIR, { recursive: true });
  await writeFile(
    resolve(SMOKE_OUTPUT_DIR, "smoke-record.json"),
    JSON.stringify({ records, analysis }, null, 2),
    "utf8",
  );
});
