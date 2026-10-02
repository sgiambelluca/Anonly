/**
 * `imagedata-profile.spec.ts` — perfilado de ImageData
 * (`docs/roadmap/ImageData_Perfilado_Handoff.md`, pasos 1-4).
 *
 * Este archivo hoy contiene solo el caso de humo del §2 del Handoff: probar,
 * con un fixture chico (no P2 completo), que el registro crudo por página
 * efectivamente sale del worker de OCR y llega a
 * `globalThis.__anonlyImageDataProfile` en el host — antes de correr
 * cualquier campaña de medición real (§4, casos 1-4, pares alternados). Los
 * cuatro casos mínimos y el protocolo de pares se agregan en una etapa
 * posterior, ya autorizada por separado.
 *
 * Requiere el patch descartable `instrument.patch` aplicado sobre
 * `ocr-engine/src/worker/kernel.ts` + `ocr.engine.ts` (Handoff §2.1): sin él,
 * `ctx.cache` nunca tiene la clave `imagedata-profile:...` y este test falla
 * al no ver ningún registro.
 */
import { readFile, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { rasterizeToScannedPdf } from "../e2e/support/scannedPdf.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import {
  aggregateImageDataProfile,
  installImageDataProfileCollector,
  readImageDataProfile,
} from "./support/imageDataProfile.js";

const QA_STAMP_PATH = resolve(process.cwd(), "tests/fixtures/qa-stamp.pdf");
const SMOKE_OUTPUT_DIR = resolve(
  process.cwd(),
  ".measure/imagedata-profile/20260915-351fc4d3/smoke",
);

test.setTimeout(120_000);

test("humo — un registro de ImageData profile llega de worker a host", async ({ page }) => {
  test.skip(
    process.env.ANONLY_IMAGEDATA_PROFILE_ENABLED !== "1",
    "Perfilado de ImageData opt-in: use ANONLY_IMAGEDATA_PROFILE_ENABLED=1 (instrument.patch debe estar aplicado).",
  );

  // Pools chicos a propósito: es un fixture de una sola página, no la
  // campaña de medición real (esa fija los tamaños del Handoff §4.1).
  await installEngineOverrides(page, {
    workerPool: { pdfPoolSize: 1, ocrPoolSize: 1, nerPoolSize: 1, renderPoolSize: 1 },
  });
  await openApp(page, "networkidle");

  const qaStampBytes = await readFile(QA_STAMP_PATH);
  const scanned = await rasterizeToScannedPdf(page, qaStampBytes);

  await installImageDataProfileCollector(page);

  await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
  await page.locator('input[type="file"]').setInputFiles(scanned);

  // No hace falta esperar PIPELINE_READY completo (NER/grouping no importan
  // acá): alcanza con que el worker de OCR haya despachado al menos un
  // registro de perfil para esa única página.
  await page.waitForFunction(
    () => (globalThis.__anonlyImageDataProfile?.length ?? 0) >= 1,
    undefined,
    { timeout: 60_000 },
  );

  const records = await readImageDataProfile(page);
  expect(records.length).toBeGreaterThanOrEqual(1);

  const record = records[0];
  if (record === undefined) throw new Error("registro ausente pese a la espera anterior");

  const stagesSeen = new Set(record.intervals.map((interval) => interval.stage));
  // qa-stamp.pdf es el caso positivo de ADR-121: debería ejercitar tanto el
  // reconocimiento principal como al menos una pasada de margen completa.
  expect(stagesSeen.has("recognizeCall")).toBe(true);
  expect(stagesSeen.has("stripDecode")).toBe(true);
  expect(stagesSeen.has("whiteGate")).toBe(true);

  // La agregación no debe lanzar: si el registro real violara algún
  // invariante del §5, esto es exactamente lo que tiene que fallar acá,
  // antes de confiar en cualquier corrida de campaña.
  const aggregate = aggregateImageDataProfile(records);

  await mkdir(SMOKE_OUTPUT_DIR, { recursive: true });
  await writeFile(
    resolve(SMOKE_OUTPUT_DIR, "smoke-record.json"),
    JSON.stringify({ records, aggregate }, null, 2),
    "utf8",
  );
});
