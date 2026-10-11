/**
 * Entrada de línea de comandos del agregador de M-O1. Uso: `tsx summarizeOsdVerdictCli.ts <carpeta>`.
 * Lee `manifest.json` y las observaciones que dejó `osd-verdict.spec.ts` y escribe, en la misma carpeta,
 * `summary.json`, `summary-tables.txt` y `leaks-table.txt`. Sale con 0 si las 700 observaciones están y son
 * coherentes, 1 si no, y 2 si no pudo agregar. Que el resultado no sea el que se quería no es un error del
 * instrumento: se informa.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

import { summarizeCampaign } from "./osdVerdictCampaign.js";
import { corpusEntries } from "./osdVerdictCorpus.js";
import type { ObservationRecord } from "./osdVerdictRun.js";
import { formatLeaks, formatSummary, resultLine } from "./osdVerdictTables.js";

interface Manifest {
  readonly pdfHashes?: Readonly<Record<string, string>>;
}

function readOptional(dir: string, name: string): unknown {
  const file = join(dir, name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as unknown) : null;
}

const OBSERVATION_FILE = /-(production|forced-(0|90|180|270))\.json$/;

function main(): number {
  const [outputArg] = process.argv.slice(2);
  if (outputArg === undefined) throw new Error("Uso: summarizeOsdVerdictCli.ts <output-dir>");
  const dir = resolve(outputArg);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("Falta manifest.json en la carpeta de salida.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const observations = readdirSync(dir)
    .filter((name) => OBSERVATION_FILE.test(name))
    .sort()
    .map((name): ObservationRecord => {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as ObservationRecord;
      if (parsed.schema !== 1) throw new Error(`Esquema desconocido en ${name}`);
      return parsed;
    });
  const summary = summarizeCampaign(observations, corpusEntries(), manifest.pdfHashes ?? {});
  const tables = formatSummary(summary);
  writeFileSync(
    join(dir, "summary.json"),
    `${JSON.stringify(
      {
        generatedAtUtc: new Date().toISOString(),
        ...summary,
        // Una tanda invalidada por una suspensión del equipo queda a la vista, sin quitarle observaciones.
        validity: readOptional(dir, "validity.json"),
        sleepDetection: readOptional(dir, "sleep-detection.json"),
        caveats: readOptional(dir, "caveats.json"),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, "summary-tables.txt"), tables);
  writeFileSync(join(dir, "leaks-table.txt"), formatLeaks(summary));
  writeSync(1, `${tables}\n${resultLine(summary)}\n`);
  return summary.check.complete ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
