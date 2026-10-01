/**
 * Entrada de línea de comandos del agregador de la fase 2 (tiempo y memoria) de la campaña de DPI
 * descendente. Uso: `tsx summarizeOcrPoolDpiCli.ts <carpeta-de-salida> <carpeta-fuente>...`.
 * Sale con 0 si la tanda está completa, 1 si no, y 2 si no pudo agregar.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { mergeCaveats, mergeSleepDetection } from "./campaignDetection.js";
import {
  dpiArtifactName,
  dpiPoolResultLine,
  dpiRunId,
  summarizeDpiPool,
  type DpiRunData,
} from "./ocrPoolDpiSummary.js";
import type { UltraCaveat, UltraSleepDetection } from "./ocrPoolUltraSummary.js";

interface DpiRunFile {
  readonly smoke?: boolean;
  readonly profiles: ReadonlyArray<string>;
  readonly profileNotes?: ReadonlyArray<{ readonly profile: string; readonly note: string }>;
  readonly arms: ReadonlyArray<string>;
  readonly dpis: ReadonlyArray<number>;
}
interface ValidityFile {
  readonly affectedRunIds?: ReadonlyArray<string>;
  readonly reasonsByRunId?: Readonly<Record<string, ReadonlyArray<string>>>;
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
    throw new Error("Uso: summarizeOcrPoolDpiCli.ts <output-dir> <source-dir> [source-dir ...]");
  const outputDir = resolve(outputArg);
  const sources = sourceArgs.map((dir) => resolve(dir));
  const run = readJson<DpiRunFile>(outputDir, "ocr-pool-dpi-run.json");
  if (run === undefined) throw new Error("Falta ocr-pool-dpi-run.json en la carpeta de salida.");
  const invalidBySource = new Map(
    sources.map((dir) => [
      dir,
      new Set(readJson<ValidityFile>(dir, "validity.json")?.affectedRunIds ?? []),
    ]),
  );
  const affected = new Set<string>();
  const reasons: Record<string, ReadonlyArray<string>> = {};
  for (const dir of sources) {
    for (const id of invalidBySource.get(dir) ?? []) affected.add(id);
    Object.assign(reasons, readJson<ValidityFile>(dir, "validity.json")?.reasonsByRunId ?? {});
  }
  // Detección de suspensión y salvedades de TODAS las carpetas que aportan corridas.
  const detections = sources.map((dir) => ({
    name: basename(dir),
    contributes: readdirSync(dir).some(
      (name) => name.startsWith("ocr-pool-") && name !== "ocr-pool-dpi-run.json",
    ),
    detection: readJson<UltraSleepDetection>(dir, "sleep-detection.json"),
    caveats: readJson<{ items?: ReadonlyArray<UltraCaveat> }>(dir, "caveats.json")?.items ?? [],
  }));
  const sleepDetection = mergeSleepDetection(detections);
  const summary = summarizeDpiPool({
    profiles: run.profiles,
    profileNotes: run.profileNotes ?? [],
    arms: run.arms,
    dpis: run.dpis,
    validity: { affectedRunIds: [...affected], reasonsByRunId: reasons },
    ...(sleepDetection === undefined ? {} : { sleepDetection }),
    caveats: mergeCaveats(detections),
    readRun: (kind, arm, profile, dpi, round) => {
      const id = dpiRunId(kind, arm, profile, dpi, round);
      for (const dir of sources) {
        if (invalidBySource.get(dir)?.has(id)) continue;
        const data = readJson<DpiRunData>(dir, dpiArtifactName(kind, id));
        if (data !== undefined) return { data, source: basename(dir) };
      }
      return null;
    },
  });
  const output = join(outputDir, "summary.json");
  writeFileSync(
    output,
    `${JSON.stringify({ generatedAtUtc: new Date().toISOString(), sources: sources.map((dir) => basename(dir)), ...summary }, null, 2)}\n`,
  );
  writeSync(
    1,
    `${JSON.stringify({ summaryPath: output, complete: summary.complete, missingRuns: summary.missingRuns.length, invalidRuns: summary.invalidRuns.length, qualityExactAtControlDpi: summary.qualityExactAtControlDpi, validityCaveats: summary.validityCaveats }, null, 2)}\n${dpiPoolResultLine(summary, run.smoke === true)}\n`,
  );
  return summary.complete || run.smoke === true ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
