/**
 * M-E1 (`docs/roadmap/hardening/Confianza_1.0.x_Plan.md`, Frente 2): ¿se pierden emails en un
 * escaneo cuya resolución NATIVA ya es baja? Opt-in: la lanza `run-ocr-emails-native.sh`. Los
 * sintéticos de la campaña de DPI descendente (`SR`, `S12`, `S10`, `S8`) se rasterizan a 300 (control),
 * 200 y 150 dpi nativos y se leen con la configuración POR DEFECTO: a diferencia de aquella campaña, no
 * se fuerza `ocr.dpi`; el Core lee a `min(ocr.dpi, tope nativo de la página)` (ADR-163). Una instancia
 * fría de Electron por celda, un reconocedor, NER activado, igual que en la campaña anterior para que
 * los números se puedan comparar. Solo sintéticos: nada de `ANONLY_REAL_DOC_*`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openApp, test } from "../e2e/support/electronApp.js";

import { installTransportObserver } from "./support/adr190Browser.js";
import { installEngineOverrides } from "./support/engineOverrides.js";
import { installDpiDownObserver, readDpiDownRun } from "./support/ocrDpiDownBrowser.js";
import { isSyntheticCorpus, type SyntheticCorpusId } from "./support/ocrDpiDownCorpus.js";
import { prepareSynthetic, type PreparedCorpus } from "./support/ocrDpiDownFixtures.js";
import {
  buildNativeCellRecord,
  type NativeCellObservation,
} from "./support/ocrEmailsNativeCell.js";
import {
  NATIVE_CORPORA,
  NATIVE_DPIS,
  NATIVE_REPETITIONS,
  nativeCellFileName,
  nativeCellId,
} from "./support/ocrEmailsNativeSummary.js";
import { DEFAULT_MAX_LIVE_IMAGE_BYTES } from "./support/ocrPoolArms.js";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const OPT_IN = process.env.ANONLY_OCR_EMAILS_NATIVE === "1";
const OUTPUT_DIR = process.env.ANONLY_OCR_EMAILS_NATIVE_OUTPUT_DIR ?? "";

function listFromEnv(name: string): ReadonlyArray<string> | null {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? null : value.split(/[\s,]+/).filter(Boolean);
}

const corpora: ReadonlyArray<SyntheticCorpusId> = (
  listFromEnv("ANONLY_OCR_EMAILS_NATIVE_CORPUS") ?? NATIVE_CORPORA
).map((id) => {
  if (!isSyntheticCorpus(id)) throw new Error(`Corpus no sintético o desconocido: ${id}`);
  return id;
});
const dpis: ReadonlyArray<number> = (
  listFromEnv("ANONLY_OCR_EMAILS_NATIVE_DPIS")?.map(Number) ?? NATIVE_DPIS
).map((dpi) => {
  if (!Number.isInteger(dpi) || dpi < 72 || dpi > 600) throw new Error(`DPI inválido: ${dpi}`);
  return dpi;
});
const repetitions = Number(process.env.ANONLY_OCR_EMAILS_NATIVE_REPS ?? String(NATIVE_REPETITIONS));
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 9)
  throw new Error(`Repeticiones inválidas: ${repetitions}`);

for (const corpus of corpora) {
  for (const nativeDpi of dpis) {
    test.describe(`Emails nativos ${corpus} a ${nativeDpi} dpi`, () => {
      test.skip(!OPT_IN, "Campaña opt-in: la lanza run-ocr-emails-native.sh");
      let prepared: PreparedCorpus | undefined;

      test.beforeAll(async () => {
        if (!OPT_IN) return;
        if (OUTPUT_DIR === "") throw new Error("ANONLY_OCR_EMAILS_NATIVE_OUTPUT_DIR no definido.");
        await mkdir(resolve(OUTPUT_DIR), { recursive: true });
        // El fixture se rasteriza (o se lee del cache) en un Chromium aparte que se cierra antes de lanzar Electron.
        prepared = await prepareSynthetic(corpus, nativeDpi);
      });

      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const id = nativeCellId(corpus, nativeDpi, repetition);
        test(id, async ({ page }) => {
          const slow = corpus === "SR";
          test.setTimeout(slow ? 1_800_000 : 600_000);
          const waitMs = slow ? 1_700_000 : 540_000;
          if (prepared === undefined) throw new Error("corpus no preparado");
          const corpusInfo = prepared;
          const truth = corpusInfo.truth;
          if (truth === null) throw new Error("un sintético siempre tiene verdad");
          const startedAtUtc = new Date().toISOString();
          const write = async (record: unknown): Promise<void> => {
            await writeFile(
              resolve(OUTPUT_DIR, nativeCellFileName(id)),
              `${JSON.stringify({ ...(record as Record<string, unknown>), startedAtUtc, completedAtUtc: new Date().toISOString() }, null, 2)}\n`,
              { flag: "wx" },
            );
          };

          await installTransportObserver(page);
          // Pool, tope de imágenes vivas y NER fijos (ADR-194 §8). El DPI NO se fuerza: es lo que se estudia.
          await installEngineOverrides(page, {
            ner: { enabled: true },
            ocr: { maxLiveImageBytes: DEFAULT_MAX_LIVE_IMAGE_BYTES },
            workerPool: { ocrPoolSize: 1 },
          });
          try {
            await openApp(page, "networkidle");
            await page.waitForFunction(() => globalThis.__anonlyCore !== undefined);
            const config = await installDpiDownObserver(page);
            await page.locator('input[type="file"]').setInputFiles(corpusInfo.file);
            await page.waitForFunction(
              () => {
                const run = globalThis.__adr190;
                return run !== undefined && (run.ready || run.failure !== null);
              },
              undefined,
              { timeout: waitMs },
            );
            const observed = await readDpiDownRun(page);
            const observation: NativeCellObservation = {
              ready: observed.run.ready,
              pipelineFailure: observed.run.failure,
              capture: observed.run.capture,
              caps: observed.run.caps.map((cap) => ({
                pageIndex: cap.pageIndex,
                originalCap: cap.originalCap,
              })),
              ocrPageEvents: observed.run.ocrPages,
              entities: [...observed.regexEntities, ...observed.nerEntities],
              words: observed.run.words.map((word) => ({
                pageIndex: word.pageIndex,
                text: word.text,
              })),
              nerFinished: observed.nerFinished,
              config,
            };
            const record = buildNativeCellRecord({
              corpus,
              sha256: corpusInfo.sha256,
              truth,
              nativeDpi,
              repetition,
              observation,
            });
            await write(record);
            console.log(
              JSON.stringify({
                cell: id,
                valid: record.valid,
                invalidReasons: record.invalidReasons,
                effectiveDpis: record.nativeDpiEvidence.effectiveDpis,
                pageCaps: record.nativeDpiEvidence.pageCaps,
                emails: {
                  expected: record.emails.expected,
                  detected: record.emails.detected,
                  missed: record.emails.missed,
                  added: record.emails.added,
                },
                readingCounts: record.emails.readingCounts,
                tolerantRule: record.tolerantRule.counts,
              }),
            );
            // No se relanza: una celda inválida queda escrita y el agregador la reporta.
            if (!record.valid)
              test.info().annotations.push({ type: "celda-invalida", description: id });
          } catch (error: unknown) {
            await write({
              schema: 1,
              corpus,
              nativeDpi,
              repetition,
              valid: false,
              invalidReasons: [`spec-error: ${String(error).slice(0, 300)}`],
              fixtureSha256: corpusInfo.sha256,
            }).catch(() => undefined);
            test.info().annotations.push({ type: "celda-invalida", description: id });
          }
        });
      }
    });
  }
}
