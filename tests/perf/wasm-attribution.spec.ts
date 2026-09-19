/**
 * T-11 (`docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §4): el heap de
 * WASM por worker, vía CDP. Cada corrida es una instancia nueva de Electron
 * (plan §4.4: "una importación en frío por instancia") — `run-wasm.sh` las
 * lanza una por vez, seleccionando con `ANONLY_WASM_RUN`.
 *
 * `step0` es la verificación ejecutable de plan §4.3. Si falla, el script no
 * sigue con el resto de las corridas — es la condición de parada del plan,
 * no algo que esta spec decida por sí sola.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";
import {
  generateText200p,
  generateText50p,
  TEXT_50P_ENTITY_PAGE_INDICES,
  TEXT_200P_ENTITY_PAGE_INDICES,
} from "../fixtures/generate.js";

import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";
import {
  printWasmAttributionReport,
  printWasmStep0Report,
  runWasmAttribution,
  runWasmStep0,
  writeWasmAttributionReport,
  writeWasmStep0Report,
} from "./support/wasmMemory.js";

async function p2File(): Promise<E2eFilePayload> {
  const textSource = await generateText50p();
  return getOrGenerateScannedFixture("p2-scanned-50p", new Uint8Array(textSource));
}

async function p2_200pFile(): Promise<E2eFilePayload> {
  const textSource = await generateText200p();
  return getOrGenerateScannedFixture("p2-scanned-200p", new Uint8Array(textSource));
}

interface WasmMeasuredRun {
  readonly profile: string;
  readonly file: () => Promise<E2eFilePayload>;
  readonly importTimeoutMs: number;
  readonly testTimeoutMs: number;
  readonly minGroupCount: number;
}

const MEASURED_RUNS: Readonly<Record<string, WasmMeasuredRun>> = {
  "p2-run0": {
    profile: "p2-scanned-50p-run0",
    file: p2File,
    importTimeoutMs: 180_000,
    testTimeoutMs: 600_000,
    minGroupCount: TEXT_50P_ENTITY_PAGE_INDICES.length,
  },
  "p2-run1": {
    profile: "p2-scanned-50p-run1",
    file: p2File,
    importTimeoutMs: 180_000,
    testTimeoutMs: 600_000,
    minGroupCount: TEXT_50P_ENTITY_PAGE_INDICES.length,
  },
  "p2-run2": {
    profile: "p2-scanned-50p-run2",
    file: p2File,
    importTimeoutMs: 180_000,
    testTimeoutMs: 600_000,
    minGroupCount: TEXT_50P_ENTITY_PAGE_INDICES.length,
  },
  "p2-200p": {
    // 900s de tope por import (plan §4.4, mismo que T-3 en memory.spec.ts).
    profile: "p2-scanned-200p",
    file: p2_200pFile,
    importTimeoutMs: 900_000,
    testTimeoutMs: 1_200_000,
    minGroupCount: TEXT_200P_ENTITY_PAGE_INDICES.length,
  },
};

const SELECTED_RUN_ID = process.env.ANONLY_WASM_RUN;

/**
 * T-12 (`Ciclos_Y_Documentos_Reales_Plan.md` §4bis): los documentos reales llegan
 * solo como ruta por entorno y con nombre neutro (plan §3.1). `ANONLY_WASM_LABEL`
 * distingue brazo y ronda en el nombre del reporte, que si no se pisarían.
 */
const REAL_DOC_RUNS: Readonly<
  Record<string, { readonly envName: string; readonly neutralName: string }>
> = {
  r1: { envName: "ANONLY_REAL_DOC_R1", neutralName: "r1.pdf" },
  r2: { envName: "ANONLY_REAL_DOC_R2", neutralName: "r2.pdf" },
};

declare global {
  var __anonlyNerFingerprint: { spans: string[]; confidenceSum: number } | undefined;
}

/**
 * Huella de lo que NER detectó, calculada dentro de la app: solo sale el hash, la
 * cantidad y la suma de confianzas, nunca el texto. La caja se redondea a 0,1 pt
 * para que la huella compare ubicaciones y no ruido de coma flotante.
 */
async function installNerFingerprint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente: ¿VITE_E2E=1 en el build?");
    const state = { spans: [] as string[], confidenceSum: 0 };
    globalThis.__anonlyNerFingerprint = state;
    core.bus.on("ner", "ENTITY_FOUND", (payload: unknown) => {
      const o = (payload as { occurrence?: Record<string, unknown> }).occurrence;
      if (o === undefined) return;
      const bbox = o.bbox as { x: number; y: number; width: number; height: number } | undefined;
      const r = (v: number | undefined): string => (v === undefined ? "?" : v.toFixed(1));
      state.spans.push(
        [o.pageIndex, o.entityType, r(bbox?.x), r(bbox?.y), r(bbox?.width), r(bbox?.height)].join(
          "|",
        ),
      );
      if (typeof o.confidence === "number") state.confidenceSum += o.confidence;
    });
  });
}

async function readNerFingerprint(
  page: Page,
): Promise<{ readonly sha256: string; readonly count: number; readonly confidenceSum: number }> {
  return page.evaluate(async () => {
    const state = globalThis.__anonlyNerFingerprint;
    if (state === undefined) throw new Error("huella de NER no instalada");
    const canonical = [...state.spans].sort().join("\n");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { sha256, count: state.spans.length, confidenceSum: state.confidenceSum };
  });
}

function requireOutputDir(): string {
  const value = process.env.ANONLY_WASM_OUTPUT_DIR;
  if (value === undefined || value === "") {
    throw new Error(
      "ANONLY_WASM_OUTPUT_DIR no está definido: esta spec se lanza desde run-wasm.sh.",
    );
  }
  return value;
}

test("T-11 — Paso 0: verificar el instrumento, ejecutándolo (plan §4.3)", async ({
  page,
  electronUserDataDir,
}) => {
  test.skip(SELECTED_RUN_ID !== "step0", "seleccionado por ANONLY_WASM_RUN=step0");
  test.setTimeout(300_000);
  const outputDir = requireOutputDir();

  const file = await p2File();
  await openApp(page, "networkidle");

  const result = await runWasmStep0(page, electronUserDataDir, file, 180_000);
  printWasmStep0Report(result);
  await writeWasmStep0Report(result, outputDir);

  expect(
    result.passed,
    `Paso 0 no pasó (plan §4.3, condición de parada): ${result.failures.join(" | ")}`,
  ).toBe(true);
});

for (const [runId, run] of Object.entries(MEASURED_RUNS)) {
  test(`T-11 — corrida de atribución: ${runId} (plan §4.4)`, async ({
    page,
    electronApp,
    electronUserDataDir,
  }) => {
    test.skip(SELECTED_RUN_ID !== runId, `seleccionado por ANONLY_WASM_RUN=${runId}`);
    test.setTimeout(run.testTimeoutMs);
    const outputDir = requireOutputDir();

    // Fuera de la instancia medida, como P2 en el resto de la campaña.
    const file = await run.file();
    await openApp(page, "networkidle");

    const report = await runWasmAttribution(
      page,
      electronApp,
      electronUserDataDir,
      runId,
      run.profile,
      file,
      run.importTimeoutMs,
    );
    printWasmAttributionReport(report);
    await writeWasmAttributionReport(report, outputDir);

    expect(report.ok, "la corrida terminó en PIPELINE_FAILED").toBe(true);
    expect(report.groupCount).toBeGreaterThanOrEqual(run.minGroupCount);
  });
}

for (const [runId, doc] of Object.entries(REAL_DOC_RUNS)) {
  test(`T-12 — documento real: ${runId} (plan §4bis)`, async ({
    page,
    electronApp,
    electronUserDataDir,
  }) => {
    test.skip(SELECTED_RUN_ID !== runId, `seleccionado por ANONLY_WASM_RUN=${runId}`);
    test.setTimeout(1_800_000);
    const outputDir = requireOutputDir();
    const label = process.env.ANONLY_WASM_LABEL ?? runId;
    const path = process.env[doc.envName];
    if (path === undefined || path === "") {
      throw new Error(
        `${doc.envName} no está definido: la ruta del documento real se pasa por entorno.`,
      );
    }
    const file: E2eFilePayload = {
      name: doc.neutralName,
      mimeType: "application/pdf",
      buffer: await readFile(path),
    };

    await openApp(page, "networkidle");
    await installNerFingerprint(page);

    const report = await runWasmAttribution(
      page,
      electronApp,
      electronUserDataDir,
      label,
      runId,
      file,
      600_000,
    );
    const nerFingerprint = await readNerFingerprint(page);
    printWasmAttributionReport(report);
    process.stdout.write(
      `  huella NER: ${nerFingerprint.sha256.slice(0, 16)} n=${nerFingerprint.count} ` +
        `Σconfianza=${nerFingerprint.confidenceSum.toFixed(4)}\n`,
    );
    await writeWasmAttributionReport(report, outputDir);
    await writeFile(
      resolve(outputDir, `ner-fingerprint-${label}.json`),
      `${JSON.stringify({ label, ...nerFingerprint }, null, 2)}\n`,
    );

    expect(report.ok, "la corrida terminó en PIPELINE_FAILED").toBe(true);
  });
}
