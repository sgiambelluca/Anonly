/**
 * T-13 (`docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §4ter): el tiempo del
 * producto sobre los documentos reales, **sin instrumento de memoria**. Los tiempos
 * de T-10 salieron con un GC forzado por segundo en cada target (ADR-159); acá no
 * hay sampler de RSS ni lecturas por CDP, solo los eventos de fase de la app.
 *
 * Por instancia: el primer documento después de abrir la app (lo que ve quien abre
 * la app para procesar un expediente) y el mismo documento reabierto a los 5 s de
 * cerrarlo. Mismas reglas de confidencialidad que T-10 (plan §3.1).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";

import {
  closeDocument,
  installRunCollector,
  readRun,
  waitForRunSettled,
} from "./support/memoryProfile.js";

const DOCS: Readonly<Record<string, { readonly envName: string; readonly neutralName: string }>> = {
  R1: { envName: "ANONLY_REAL_DOC_R1", neutralName: "r1.pdf" },
  R2: { envName: "ANONLY_REAL_DOC_R2", neutralName: "r2.pdf" },
};

const REOPEN_GAP_MS = 5_000;
const IMPORT_TIMEOUT_MS = 600_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} no está definido: esta spec se lanza desde run-tiempos-reales.sh.`);
  }
  return value;
}

async function timeOneImport(
  page: Page,
  file: E2eFilePayload,
): Promise<{ readonly ok: boolean; readonly phasesEpochMs: Readonly<Record<string, number>> }> {
  await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
  await installRunCollector(page, { captureOcrWords: false });
  await page.locator('input[type="file"]').setInputFiles(file);
  await waitForRunSettled(page, IMPORT_TIMEOUT_MS);
  const run = await readRun(page);
  return { ok: run.failedAt === undefined, phasesEpochMs: run.phasesEpochMs };
}

test("T-13 — tiempo real sobre un documento real", async ({ page }) => {
  test.setTimeout(1_800_000);
  const docKey = requireEnv("ANONLY_REAL_TIMING_DOC");
  const round = requireEnv("ANONLY_REAL_TIMING_ROUND");
  const outputDir = requireEnv("ANONLY_REAL_TIMING_OUTPUT_DIR");
  const doc = DOCS[docKey];
  if (doc === undefined) throw new Error(`Documento desconocido: ${docKey} (R1 o R2).`);
  const file: E2eFilePayload = {
    name: doc.neutralName,
    mimeType: "application/pdf",
    buffer: await readFile(requireEnv(doc.envName)),
  };

  await openApp(page, "networkidle");
  const first = await timeOneImport(page, file);
  await closeDocument(page);
  await page.waitForTimeout(REOPEN_GAP_MS);
  const reopened = await timeOneImport(page, file);

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    resolve(outputDir, `timing-${docKey}-round${round}.json`),
    `${JSON.stringify({ docKey, round: Number(round), reopenGapMs: REOPEN_GAP_MS, first, reopened }, null, 2)}\n`,
  );

  expect(first.ok, "la primera importación terminó en PIPELINE_FAILED").toBe(true);
  expect(reopened.ok, "la reapertura terminó en PIPELINE_FAILED").toBe(true);
});
