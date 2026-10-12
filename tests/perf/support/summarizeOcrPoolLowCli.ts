/**
 * Entrada de línea de comandos del agregador de la fase `low-memory` (memoria del perfil Bajo).
 * Uso: `tsx summarizeOcrPoolLowCli.ts <carpeta-de-salida>`. Sale con 0 si la tanda está completa
 * (el humo, con su única corrida, también), 1 si no, y 2 si no pudo agregar. Que el máximo supere
 * el techo no es un error del instrumento: se informa y lo decide el humano.
 */

import { existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  lowArtifactName,
  lowResultLine,
  summarizeLow,
  type LowRunData,
} from "./ocrPoolLowSummary.js";
import type { UltraCaveat, UltraSleepDetection } from "./ocrPoolUltraSummary.js";

interface LowRunFile {
  readonly smoke?: boolean;
  readonly rounds: ReadonlyArray<number>;
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
  const [outputArg] = process.argv.slice(2);
  if (outputArg === undefined) throw new Error("Uso: summarizeOcrPoolLowCli.ts <output-dir>");
  const dir = resolve(outputArg);
  const run = readJson<LowRunFile>(dir, "ocr-pool-low-run.json");
  if (run === undefined) throw new Error("Falta ocr-pool-low-run.json en la carpeta de salida.");
  const validity = readJson<ValidityFile>(dir, "validity.json") ?? {};
  const invalid = new Set(validity.affectedRunIds ?? []);
  const sleepDetection = readJson<UltraSleepDetection>(dir, "sleep-detection.json");
  const summary = summarizeLow({
    rounds: run.rounds,
    smoke: run.smoke === true,
    validity,
    ...(sleepDetection === undefined ? {} : { sleepDetection }),
    caveats: readJson<{ items?: ReadonlyArray<UltraCaveat> }>(dir, "caveats.json")?.items ?? [],
    // Una corrida que el runner invalidó (fallo de Playwright o suspensión) no se lee aunque haya JSON.
    readRun: (round) =>
      invalid.has(`memory-low-P2H-r${round}`)
        ? null
        : (readJson<LowRunData>(dir, lowArtifactName(round)) ?? null),
  });
  const output = join(dir, "summary.json");
  writeFileSync(
    output,
    `${JSON.stringify({ generatedAtUtc: new Date().toISOString(), ...summary }, null, 2)}\n`,
  );
  writeSync(
    1,
    `${JSON.stringify({ summaryPath: output, complete: summary.complete, missingRuns: summary.missingRuns.length, invalidRuns: summary.invalidRuns.length, maxRssPeakBytes: summary.maxRssPeakBytes, validityCaveats: summary.validityCaveats }, null, 2)}\n${lowResultLine(summary)}\n`,
  );
  return summary.complete ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
