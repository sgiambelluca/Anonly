/**
 * Entrada de línea de comandos del agregador de M-O2. Uso:
 * `tsx summarizeOsdVerdictM2Cli.ts <carpeta-de-m-o2> [carpeta-de-m-o1]` (la de M-O1 por defecto es
 * `.measure/osd-verdict/campana-m-o1`, que se lee y no se toca). Escribe `summary.json` y `summary-tables.txt` en
 * la carpeta de M-O2. Sale con 0 si las observaciones esperadas están y son coherentes, 1 si no, y 2 si no pudo
 * agregar. Que el resultado no sea el que se quería no es un error del instrumento: se informa.
 *
 * Privacidad: el resumen de las páginas reales son agregados; ningún registro con texto de un documento real
 * existe (el registro de una página real no lo lleva), así que nada de eso puede llegar acá.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

import { corpusEntriesM2, REAL_DOC_IDS, type RealDocId } from "./osdVerdictCorpusM2.js";
import { summarizeM2 } from "./osdVerdictM2Campaign.js";
import type { M2Observation } from "./osdVerdictM2Run.js";
import { formatM2, m2ResultLine } from "./osdVerdictM2Tables.js";
import type { ObservationRecord } from "./osdVerdictRun.js";

interface Manifest {
  readonly pdfHashes?: Readonly<Record<string, string>>;
  readonly realDocs?: Readonly<Record<string, number>>;
}

const OBSERVATION_FILE = /-(production|forced-(0|90|180|270))\.json$/;

function readObservations<T extends { readonly schema: number }>(dir: string, schema: number): T[] {
  return readdirSync(dir)
    .filter((name) => OBSERVATION_FILE.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as T)
    .filter((record) => record.schema === schema);
}

function readOptional(dir: string, name: string): unknown {
  const file = join(dir, name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as unknown) : null;
}

function main(): number {
  const [outputArg, m1Arg] = process.argv.slice(2);
  if (outputArg === undefined)
    throw new Error("Uso: summarizeOsdVerdictM2Cli.ts <carpeta-m-o2> [carpeta-m-o1]");
  const dir = resolve(outputArg);
  const m1Dir = resolve(m1Arg ?? ".measure/osd-verdict/campana-m-o1");
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("Falta manifest.json en la carpeta de M-O2.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const available = REAL_DOC_IDS.filter((doc: RealDocId) => manifest.realDocs?.[doc] !== undefined);
  const entries = corpusEntriesM2(available);
  const m2 = readObservations<M2Observation>(dir, 2);
  const m1 = readObservations<ObservationRecord>(m1Dir, 1);
  const summary = summarizeM2({ m1, m2, entries, pdfHashes: manifest.pdfHashes ?? {} });
  const tables = formatM2(summary);
  writeFileSync(
    join(dir, "summary.json"),
    `${JSON.stringify(
      {
        generatedAtUtc: new Date().toISOString(),
        m1Observations: m1.length,
        ...summary,
        validity: readOptional(dir, "validity.json"),
        sleepDetection: readOptional(dir, "sleep-detection.json"),
        caveats: readOptional(dir, "caveats.json"),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, "summary-tables.txt"), tables);
  writeSync(1, `${tables}\n${m2ResultLine(summary)}\n`);
  return summary.check.complete ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
