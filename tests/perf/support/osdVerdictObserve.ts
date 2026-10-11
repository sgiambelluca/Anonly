/**
 * M-O1 y M-O2: una observación contra la aplicación empaquetada. Impura (Electron, CDP, worker real):
 * la usan `osd-verdict.spec.ts` y `osd-verdict-m2.spec.ts`; no tiene test propio. Importa un PDF de una página
 * en una instancia fría, con NER apagado y el OCR a 300 dpi con el tope por página de ADR-163 (la configuración
 * de la campaña de recuperación de ADR-190), y devuelve lo que capturó el transporte del arnés.
 *
 * Con `forcedAngle` el resultado de la primera detección de orientación se reemplaza por un veredicto
 * válido en ese ángulo (`forceOrientationVerdict`); sin él, la cadena corre sin forzar nada.
 */

import type { Word } from "@anonly/shared";
import type { Page } from "@playwright/test";

import { openApp } from "../../e2e/support/electronApp.js";
import { installSettingsOverride } from "../../e2e/support/settingsOverride.js";

import {
  installDocumentControl,
  installTransportObserver,
  readDocumentRun,
  type BrowserRun,
} from "./adr190Browser.js";
import type { Job } from "./adr190Dpi.js";
import { validateCapture } from "./adr190Dpi.js";
import { correlateRawOsd, OsdProbe, type RawOsd } from "./adr190OsdProbe.js";
import { correlateOcrAttempts, type OcrAttempt } from "./adr190Recovery.js";
import { installEngineOverrides } from "./engineOverrides.js";
import type { PhysicalAngle } from "./osdVerdictCorpus.js";

export interface Observed {
  readonly attempts: ReadonlyArray<OcrAttempt>;
  readonly orientationJob: Job;
  readonly rawOsd: RawOsd;
  readonly run: BrowserRun & { words: ReadonlyArray<Word> };
  readonly readyMs: number;
}

export async function observePage(args: {
  readonly page: Page;
  readonly electronUserDataDir: string;
  readonly name: string;
  readonly pdfBytes: Uint8Array;
  readonly forcedAngle: PhysicalAngle | null;
}): Promise<Observed> {
  const { page, electronUserDataDir, name, pdfBytes, forcedAngle } = args;
  await installTransportObserver(page, {
    retainOcrPageInputs: true,
    ...(forcedAngle === null ? {} : { forceOrientationVerdict: forcedAngle }),
  });
  await installSettingsOverride(page, { nerEnabled: false });
  await installEngineOverrides(page, {
    ner: { enabled: false },
    ocr: { dpi: 300 },
    workerPool: { ocrPoolSize: 2, pdfPoolSize: 2, renderPoolSize: 2 },
  });
  let probe: OsdProbe | null = null;
  try {
    probe = await OsdProbe.connect(electronUserDataDir);
    await openApp(page, "networkidle");
    await page.waitForFunction(() => globalThis.__anonlyCore !== undefined);
    await installDocumentControl(page, "native");
    const startedAt = Date.now();
    await page.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: "application/pdf",
      buffer: Buffer.from(pdfBytes),
    });
    await page.waitForFunction(
      () => globalThis.__adr190?.ready || globalThis.__adr190?.failure !== null,
      undefined,
      { timeout: 180_000 },
    );
    const readyMs = Date.now() - startedAt;
    const run = await readDocumentRun(page);
    await probe.drain();
    if (!run.ready || run.failure !== null)
      throw new Error(`pipeline failed: ${JSON.stringify(run.failure)}`);
    if (probe.issues.length > 0) throw new Error(probe.issues.join("; "));
    validateCapture(run.capture);
    const attempts = correlateOcrAttempts(run.capture);
    const orientationJob = run.capture.jobs
      .filter((job) => job.jobType === "ocr-orient")
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (orientationJob === undefined) throw new Error("sin detección de orientación");
    const rawOsd = correlateRawOsd(run.capture.jobs, probe.readings).find(
      (reading) => reading.hostJobId === orientationJob.jobId,
    );
    if (rawOsd === undefined) throw new Error("sin OSD crudo para la primera detección");
    return { attempts, orientationJob, rawOsd, run, readyMs };
  } finally {
    if (probe) await probe.close().catch(() => undefined);
  }
}
