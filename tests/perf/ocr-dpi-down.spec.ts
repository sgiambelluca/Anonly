/**
 * Fase 1 (calidad) de la campaña de DPI descendente
 * (docs/roadmap/OCR_DPI_Descendente_Campana_Plan.md §5.1). Opt-in: la lanza
 * `run-ocr-dpi-down.sh`. Una instancia fría de Electron por celda (corpus x brazo de DPI), un
 * reconocedor, NER activado. Los datos de los corpus reales no salen de este proceso: los
 * registros llevan conteos por tipo, distribuciones y huellas, nunca texto ni valores.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openApp, test } from "../e2e/support/electronApp.js";

import { installTransportObserver } from "./support/adr190Browser.js";
import { installEngineOverrides } from "./support/engineOverrides.js";
import { installDpiDownObserver, readDpiDownRun } from "./support/ocrDpiDownBrowser.js";
import {
  buildCellRecord,
  type CellObservation,
  type ReferenceData,
} from "./support/ocrDpiDownCell.js";
import { ALL_CORPUS_IDS, isRealCorpus, type CorpusId } from "./support/ocrDpiDownCorpus.js";
import { prepareCorpus, type PreparedCorpus } from "./support/ocrDpiDownFixtures.js";
import {
  CONTROL_DPI,
  CONTROL_REPETITIONS,
  DEFAULT_ARM_DPIS,
  cellId,
  expectedCellKeys,
  invalidatedCell,
  type CellRecord,
} from "./support/ocrDpiDownSummary.js";
import { DEFAULT_MAX_LIVE_IMAGE_BYTES } from "./support/ocrPoolArms.js";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const OPT_IN = process.env.ANONLY_OCR_DPI_DOWN === "1";
const OUTPUT_DIR = process.env.ANONLY_OCR_DPI_DOWN_OUTPUT_DIR ?? "";

function listFromEnv(name: string): ReadonlyArray<string> | null {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? null : value.split(/[\s,]+/).filter(Boolean);
}

const requestedCorpora = listFromEnv("ANONLY_OCR_DPI_DOWN_CORPUS") ?? ALL_CORPUS_IDS;
const corpora: ReadonlyArray<CorpusId> = requestedCorpora.map((id) => {
  const found = ALL_CORPUS_IDS.find((candidate) => candidate === id);
  if (found === undefined) throw new Error(`Corpus desconocido: ${id}`);
  return found;
});
const arms: ReadonlyArray<number> = (
  listFromEnv("ANONLY_OCR_DPI_DOWN_ARMS")?.map(Number) ?? DEFAULT_ARM_DPIS
)
  .map((dpi) => {
    if (!Number.isInteger(dpi) || dpi < 72 || dpi > 600) throw new Error(`DPI inválido: ${dpi}`);
    return dpi;
  })
  // El brazo 300 va primero: sus dos repeticiones son la referencia de las demás.
  .sort((a, b) => (a === CONTROL_DPI ? -1 : b === CONTROL_DPI ? 1 : 0));

const references = new Map<string, ReferenceData | null>();

/**
 * Referencia (brazo 300, repetición 1) del corpus. Los reales solo viven en la memoria de este
 * proceso (no se escriben valores). Los sintéticos se rehidratan del JSON de la celda si el
 * worker se reinició y perdió el mapa.
 */
async function loadReference(
  corpus: CorpusId,
  kind: "synthetic" | "real",
): Promise<ReferenceData | null> {
  if (references.has(corpus)) return references.get(corpus) ?? null;
  if (kind !== "synthetic") return null;
  try {
    const raw = await readFile(
      resolve(OUTPUT_DIR, `ocr-dpi-down-cell-${cellId(corpus, CONTROL_DPI, 1)}.json`),
      "utf8",
    );
    const parsed = JSON.parse(raw) as {
      valid?: boolean;
      syntheticDetail?: { detected?: ReferenceData["entities"]; observedText?: string } | null;
    };
    const detail = parsed.syntheticDetail;
    if (parsed.valid !== true || !detail?.detected || detail.observedText === undefined)
      return null;
    const rehydrated = { entities: detail.detected, text: detail.observedText };
    references.set(corpus, rehydrated);
    return rehydrated;
  } catch {
    return null;
  }
}

for (const corpus of corpora) {
  test.describe(`DPI descendente ${corpus}`, () => {
    test.skip(!OPT_IN, "Campaña opt-in: la lanza run-ocr-dpi-down.sh");
    let prepared: PreparedCorpus | { readonly skipped: string } | undefined;

    test.beforeAll(async () => {
      if (!OPT_IN) return;
      if (OUTPUT_DIR === "") throw new Error("ANONLY_OCR_DPI_DOWN_OUTPUT_DIR no definido.");
      await mkdir(resolve(OUTPUT_DIR), { recursive: true });
      // Los fixtures se generan en un Chromium aparte que se cierra antes de lanzar Electron.
      prepared = await prepareCorpus(corpus, process.env);
      if ("skipped" in prepared) {
        await writeFile(
          resolve(OUTPUT_DIR, `ocr-dpi-down-skipped-${corpus}.json`),
          `${JSON.stringify({ corpus, skipped: prepared.skipped }, null, 2)}\n`,
          { flag: "wx" },
        );
      }
    });

    for (const key of expectedCellKeys([corpus], arms)) {
      const id = cellId(corpus, key.dpi, key.repetition);
      test(id, async ({ page }) => {
        test.setTimeout(isRealCorpus(corpus) || corpus === "SR" ? 1_800_000 : 600_000);
        const waitMs = isRealCorpus(corpus) || corpus === "SR" ? 1_700_000 : 540_000;
        if (prepared === undefined) throw new Error("corpus no preparado");
        test.skip("skipped" in prepared, "corpus saltado (variable de entorno ausente o ilegible)");
        if ("skipped" in prepared) return;
        const corpusInfo = prepared;
        const startedAtUtc = new Date().toISOString();

        const write = async (record: CellRecord, extra: Record<string, unknown>): Promise<void> => {
          await writeFile(
            resolve(OUTPUT_DIR, `ocr-dpi-down-cell-${id}.json`),
            `${JSON.stringify({ ...record, startedAtUtc, completedAtUtc: new Date().toISOString(), ...extra }, null, 2)}\n`,
            { flag: "wx" },
          );
        };

        await installTransportObserver(page);
        await installEngineOverrides(page, {
          ner: { enabled: true },
          // Pool y tope fijos: no depende del nivel vigente (ADR-194 §8).
          ocr: { dpi: key.dpi, maxLiveImageBytes: DEFAULT_MAX_LIVE_IMAGE_BYTES },
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
          const observation: CellObservation = {
            ready: observed.run.ready,
            pipelineFailure: observed.run.failure,
            capture: observed.run.capture,
            caps: observed.run.caps.map((cap) => ({
              pageIndex: cap.pageIndex,
              originalCap: cap.originalCap,
            })),
            ocrPageEvents: observed.run.ocrPages,
            entities: [...observed.regexEntities, ...observed.nerEntities],
            text: observed.run.words.map((word) => word.text).join(" "),
            nerFinished: observed.nerFinished,
            overrideEffective:
              config.ocrDpi === key.dpi &&
              config.ocrPoolSize === 1 &&
              config.maxLiveImageBytes === DEFAULT_MAX_LIVE_IMAGE_BYTES &&
              config.nerEnabled === true,
          };
          const isReference = key.dpi === CONTROL_DPI && key.repetition === 1;
          const result = buildCellRecord({
            corpus: {
              id: corpus,
              kind: corpusInfo.kind,
              sha256: corpusInfo.sha256,
              truth: corpusInfo.truth,
            },
            dpi: key.dpi,
            repetition: key.repetition,
            observation,
            reference: isReference ? null : await loadReference(corpus, corpusInfo.kind),
          });
          if (isReference) references.set(corpus, result.record.valid ? result.asReference : null);
          await write(result.record, {
            syntheticDetail: result.syntheticDetail,
            expectedRepetitions: CONTROL_REPETITIONS,
          });
          console.log(
            JSON.stringify({
              cell: id,
              valid: result.record.valid,
              invalidReasons: result.record.invalidReasons,
              effectiveDpis: result.record.dispatch?.effectiveDpis,
              armEffective: result.record.armEffective,
              detectedByType: result.record.detectedByType,
              lostVsTruth: result.record.entitiesVsTruth?.totals.missed ?? null,
              lostVsReference: result.record.entitiesVsReference?.totals.missed ?? null,
              tokenRecallVsTruth: result.record.tokensVsTruth?.recall ?? null,
              recoverySteps: result.record.chain?.recoverySteps,
              unreadableInkPages: result.record.chain?.unreadableInkPages,
            }),
          );
          // No se relanza: una celda inválida queda escrita y el agregador la reporta; relanzar haría
          // que Playwright descarte el worker y se pierda la referencia en memoria de los reales.
          if (!result.record.valid)
            test.info().annotations.push({ type: "celda-invalida", description: id });
        } catch (error: unknown) {
          if (isReferenceKey(key)) references.set(corpus, null);
          const detail =
            corpusInfo.kind === "synthetic"
              ? String(error).slice(0, 300)
              : error instanceof Error
                ? error.name
                : "error";
          await write(invalidatedCell(corpus, key.dpi, key.repetition, [`spec-error: ${detail}`]), {
            fixtureSha256: corpusInfo.sha256,
          }).catch(() => undefined);
          test.info().annotations.push({ type: "celda-invalida", description: id });
        }
      });
    }
  });
}

function isReferenceKey(key: { readonly dpi: number; readonly repetition: number }): boolean {
  return key.dpi === CONTROL_DPI && key.repetition === 1;
}
