/**
 * Entrada de línea de comandos del agregador de M-D2 y M-D3. Uso: `tsx summarizeAddressKeywordCli.ts <carpeta>
 * [carpeta-de-línea-de-base]`; la línea de base también puede venir en `ANONLY_ADDRESS_KEYWORD_BASELINE_DIR`.
 * Con ella, además se compara la primera repetición válida página por página contra la primera de la línea de
 * base (M-D3).
 * Escribe `summary.json`, `summary-table.txt` y, por repetición válida, `pages-table-r<n>.txt` (una línea
 * por página) en la carpeta de salida del runner. Sale con 0 si las corridas esperadas están presentes y
 * son válidas, 1 si no, y 2 si no pudo agregar. Que el resultado no sea el que se quería, que haya páginas
 * inválidas o que las repeticiones difieran no es un error del instrumento: se informa.
 */

import { existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

import { compareWithBaseline } from "./addressKeywordExpectation.js";
import type { AddressKeywordRunRecord } from "./addressKeywordRun.js";
import {
  addressKeywordRunFileName,
  formatBaselineComparison,
  formatPagesTable,
  formatSummaryTable,
  resultLine,
  summarizeAddressKeyword,
} from "./addressKeywordSummary.js";

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
  const [outputArg, baselineArg] = process.argv.slice(2);
  const baselineDirArg = baselineArg ?? process.env.ANONLY_ADDRESS_KEYWORD_BASELINE_DIR;
  if (outputArg === undefined) throw new Error("Uso: summarizeAddressKeywordCli.ts <output-dir>");
  const dir = resolve(outputArg);
  const run = readJson<RunFile>(dir, "address-keyword-run.json");
  if (run === undefined) throw new Error("Falta address-keyword-run.json en la carpeta de salida.");
  const validity = readJson<ValidityFile>(dir, "validity.json") ?? {};
  const affected = new Set(validity.affectedRunIds ?? []);
  const records = Array.from({ length: run.repetitions }, (_, index) => {
    const repetition = index + 1;
    const record = readJson<AddressKeywordRunRecord>(dir, addressKeywordRunFileName(repetition));
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
  const summary = summarizeAddressKeyword({ expectedRepetitions: run.repetitions, records });
  const baselineRecord =
    baselineDirArg === undefined || baselineDirArg === ""
      ? undefined
      : readJson<AddressKeywordRunRecord>(resolve(baselineDirArg), addressKeywordRunFileName(1));
  if (baselineDirArg !== undefined && baselineDirArg !== "" && baselineRecord === undefined)
    throw new Error("Falta address-keyword-run-r1.json en la carpeta de la línea de base.");
  const currentRecord = records.find(
    (record): record is AddressKeywordRunRecord => record !== undefined && record.valid,
  );
  const comparison =
    baselineRecord === undefined || currentRecord === undefined
      ? null
      : compareWithBaseline(currentRecord.pages, baselineRecord.pages);
  const table =
    comparison === null
      ? formatSummaryTable(summary)
      : `${formatSummaryTable(summary)}\n${formatBaselineComparison(comparison).join("\n")}\n`;
  writeFileSync(
    join(dir, "summary.json"),
    `${JSON.stringify(
      {
        generatedAtUtc: new Date().toISOString(),
        ...summary,
        baselineDir: baselineDirArg === undefined || baselineDirArg === "" ? null : baselineDirArg,
        baselineComparison: comparison,
        sleepDetection: readJson<unknown>(dir, "sleep-detection.json") ?? null,
        caveats: readJson<{ items?: ReadonlyArray<unknown> }>(dir, "caveats.json")?.items ?? [],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, "summary-table.txt"), table);
  for (const record of records) {
    if (record !== undefined && record.valid)
      writeFileSync(
        join(dir, `pages-table-r${record.repetition}.txt`),
        formatPagesTable(record.pages),
      );
  }
  writeSync(1, `${table}${resultLine(summary)}\n`);
  return summary.complete ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
