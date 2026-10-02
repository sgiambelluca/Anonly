/**
 * Entrada de línea de comandos del agregador de la fase 1 (calidad) de la campaña de DPI
 * descendente. Uso: `tsx summarizeOcrDpiDownCli.ts <carpeta-de-salida> <carpeta-fuente>...`; las
 * carpetas fuente se buscan en orden (una continuación puede traer celdas que faltan en la primera).
 * Sale con 0 si la tanda está completa, 1 si no, y 2 si no pudo agregar.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { mergeCaveats, mergeSleepDetection } from "./campaignDetection.js";
import type { CorpusId } from "./ocrDpiDownCorpus.js";
import {
  createSourcedReader,
  invalidatedCorporaOf,
  type ValidityLike,
} from "./ocrDpiDownSources.js";
import { dpiDownResultLine, summarizeDpiDown, type CellRecord } from "./ocrDpiDownSummary.js";
import type { UltraCaveat, UltraSleepDetection } from "./ocrPoolUltraSummary.js";

interface RunFile {
  readonly smoke?: boolean;
  readonly corpora: ReadonlyArray<CorpusId>;
  readonly arms: ReadonlyArray<number>;
  readonly skippedCorpora?: ReadonlyArray<{ readonly corpus: CorpusId; readonly reason: string }>;
  /** Valor crudo del umbral con que se lanzó el runner (puede ser inválido: lo valida el agregador). */
  readonly minCoverageRaw?: string | null;
}

function readJson<T>(dir: string, name: string): T | undefined {
  const file = join(dir, name);
  if (!existsSync(file)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return parsed as T;
}

function main(): number {
  const [outputArg, ...sourceArgs] = process.argv.slice(2);
  if (outputArg === undefined || sourceArgs.length === 0)
    throw new Error("Uso: summarizeOcrDpiDownCli.ts <output-dir> <source-dir> [source-dir ...]");
  const outputDir = resolve(outputArg);
  const sources = sourceArgs.map((dir) => resolve(dir));
  const run = readJson<RunFile>(outputDir, "ocr-dpi-down-run.json");
  if (run === undefined) throw new Error("Falta ocr-dpi-down-run.json en la carpeta de salida.");
  const reader = createSourcedReader(
    sources.map((dir) => ({
      name: basename(dir),
      invalidatedCorpora: invalidatedCorporaOf(readJson<ValidityLike>(dir, "validity.json")),
      readCell: (fileName) => readJson<CellRecord>(dir, fileName),
    })),
    run.arms,
  );
  // Detección de suspensión y salvedades de TODAS las carpetas, no solo de la de salida.
  const detections = sources.map((dir) => ({
    name: basename(dir),
    contributes: readdirSync(dir).some((name) => name.startsWith("ocr-dpi-down-cell-")),
    detection: readJson<UltraSleepDetection>(dir, "sleep-detection.json"),
    caveats: readJson<{ items?: ReadonlyArray<UltraCaveat> }>(dir, "caveats.json")?.items ?? [],
  }));
  // El valor del entorno manda sobre el de la corrida original; se pasa crudo, sin convertir.
  const envRaw = process.env.ANONLY_OCR_DPI_DOWN_MIN_COVERAGE;
  const minCoverageRaw =
    envRaw !== undefined && envRaw !== "" ? envRaw : (run.minCoverageRaw ?? null);
  const sleepDetection = mergeSleepDetection(detections);
  const summary = summarizeDpiDown({
    corpora: run.corpora,
    arms: run.arms,
    skippedCorpora: run.skippedCorpora ?? [],
    smoke: run.smoke === true,
    minCoverageRaw,
    ...(sleepDetection === undefined ? {} : { sleepDetection }),
    caveats: mergeCaveats(detections),
    readCell: reader,
  });
  const output = join(outputDir, "summary.json");
  writeFileSync(
    output,
    `${JSON.stringify({ generatedAtUtc: new Date().toISOString(), sources: sources.map((dir) => basename(dir)), ...summary }, null, 2)}\n`,
  );
  const verdicts = Object.fromEntries(
    Object.values(summary.arms)
      .filter((arm) => arm.verdict !== null)
      .map((arm) => [arm.dpi, arm.verdict]),
  );
  writeSync(
    1,
    `${JSON.stringify({ summaryPath: output, complete: summary.complete, verdicts, discriminantControlFailed: summary.discriminantControlFailed, campaignShouldStop: summary.campaignShouldStop, missingCells: summary.missingCells.length, invalidCells: summary.invalidCells.length }, null, 2)}\n${dpiDownResultLine(summary)}\n`,
  );
  return summary.complete ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
