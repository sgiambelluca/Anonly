/**
 * Entrada de línea de comandos del agregador de M-D1. Uso: `tsx summarizeAddressHeightCli.ts <carpeta>`.
 * Escribe `summary.json` y `summary-table.txt` en la carpeta de salida del runner. Sale con 0 si las
 * corridas esperadas están presentes y son válidas, 1 si no, y 2 si no pudo agregar. Que el resultado no
 * sea el esperado por ADR-212, o que las repeticiones difieran, no es un error del instrumento: se informa.
 */

import { existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

import type { AddressHeightRunRecord } from "./addressHeightRun.js";
import {
  addressHeightRunFileName,
  formatSummaryTable,
  resultLine,
  summarizeAddressHeight,
} from "./addressHeightSummary.js";

interface RunFile {
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
  if (outputArg === undefined) throw new Error("Uso: summarizeAddressHeightCli.ts <output-dir>");
  const dir = resolve(outputArg);
  const run = readJson<RunFile>(dir, "address-height-run.json");
  if (run === undefined) throw new Error("Falta address-height-run.json en la carpeta de salida.");
  const validity = readJson<ValidityFile>(dir, "validity.json") ?? {};
  const affected = new Set(validity.affectedRunIds ?? []);
  const records = Array.from({ length: run.repetitions }, (_, index) => {
    const repetition = index + 1;
    const record = readJson<AddressHeightRunRecord>(dir, addressHeightRunFileName(repetition));
    if (record === undefined) return undefined;
    const unit = `rep-${repetition}`;
    if (!affected.has(unit)) return record;
    // El runner invalida por repetición (una suspensión durante la corrida): no vale.
    return {
      ...record,
      valid: false,
      invalidReasons: [
        ...record.invalidReasons,
        ...(validity.reasonsByRunId?.[unit] ?? [`runner-invalidated ${unit}`]),
      ],
    };
  });
  const summary = summarizeAddressHeight({ expectedRepetitions: run.repetitions, records });
  const table = formatSummaryTable(summary);
  writeFileSync(
    join(dir, "summary.json"),
    `${JSON.stringify(
      {
        generatedAtUtc: new Date().toISOString(),
        ...summary,
        sleepDetection: readJson<unknown>(dir, "sleep-detection.json") ?? null,
        caveats: readJson<{ items?: ReadonlyArray<unknown> }>(dir, "caveats.json")?.items ?? [],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, "summary-table.txt"), table);
  writeSync(1, `${table}${resultLine(summary)}\n`);
  return summary.complete ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
