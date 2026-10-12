/**
 * Entrada de línea de comandos del agregador de la campaña de emails en escaneos de DPI nativo bajo
 * (M-E1). Uso: `tsx summarizeOcrEmailsNativeCli.ts <carpeta-de-salida>`. Escribe `summary.json` y
 * `summary-table.txt`. Sale con 0 si la tanda está completa (celdas presentes y válidas), 1 si no, y
 * 2 si no pudo agregar. Que las repeticiones no coincidan o que haya emails perdidos no es un error
 * del instrumento: se informa.
 */

import { existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

import type { NativeCellRecord } from "./ocrEmailsNativeCell.js";
import {
  nativeCellFileName,
  nativeCellId,
  nativeResultLine,
  summarizeNative,
} from "./ocrEmailsNativeSummary.js";
import type { UltraCaveat, UltraSleepDetection } from "./ocrPoolUltraSummary.js";

interface NativeRunFile {
  readonly smoke?: boolean;
  readonly corpora: ReadonlyArray<string>;
  readonly dpis: ReadonlyArray<number>;
  readonly repetitions: number;
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
  if (outputArg === undefined) throw new Error("Uso: summarizeOcrEmailsNativeCli.ts <output-dir>");
  const dir = resolve(outputArg);
  const run = readJson<NativeRunFile>(dir, "ocr-emails-native-run.json");
  if (run === undefined)
    throw new Error("Falta ocr-emails-native-run.json en la carpeta de salida.");
  const validity = readJson<ValidityFile>(dir, "validity.json") ?? {};
  const affected = new Set(validity.affectedRunIds ?? []);
  const sleepDetection = readJson<UltraSleepDetection>(dir, "sleep-detection.json");
  const summary = summarizeNative({
    corpora: run.corpora,
    dpis: run.dpis,
    repetitions: run.repetitions,
    smoke: run.smoke === true,
    validity,
    ...(sleepDetection === undefined ? {} : { sleepDetection }),
    caveats: readJson<{ items?: ReadonlyArray<UltraCaveat> }>(dir, "caveats.json")?.items ?? [],
    readCell: (corpus, nativeDpi, repetition) => {
      const record = readJson<NativeCellRecord>(
        dir,
        nativeCellFileName(nativeCellId(corpus, nativeDpi, repetition)),
      );
      if (record === undefined) return null;
      // El runner invalida por corpus (una suspensión durante la tanda de ese corpus): sus celdas no valen.
      const corpusUnit = `corpus-${corpus}`;
      if (!affected.has(corpusUnit)) return record;
      return {
        ...record,
        valid: false,
        invalidReasons: [
          ...record.invalidReasons,
          ...(validity.reasonsByRunId?.[corpusUnit] ?? [`runner-invalidated ${corpusUnit}`]),
        ],
      };
    },
  });
  const { tableLines, ...jsonSummary } = summary;
  writeFileSync(
    join(dir, "summary.json"),
    `${JSON.stringify({ generatedAtUtc: new Date().toISOString(), ...jsonSummary }, null, 2)}\n`,
  );
  writeFileSync(join(dir, "summary-table.txt"), `${tableLines.join("\n")}\n`);
  writeSync(1, `${tableLines.join("\n")}\n${nativeResultLine(summary)}\n`);
  return summary.complete ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
