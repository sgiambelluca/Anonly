/**
 * Entrada de línea de comandos del agregador de M-O3. Uso: `tsx summarizeOsdVerdictM3Cli.ts <carpeta>`.
 * Lee `manifest.json` y las corridas que dejó `osd-verdict-m3.spec.ts` (`<doc>-<brazo>-r<n>.json`) y escribe
 * `summary.json` y `summary-tables.txt` en la misma carpeta. Sale con 0 si las corridas esperadas están y son
 * coherentes, 1 si no, y 2 si no pudo agregar. Que el resultado no sea el que se quería (un pico sobre el
 * techo, una importación fallida) no es un error del instrumento: se informa.
 *
 * Privacidad: una corrida de un documento real no lleva texto, así que nada de eso puede llegar acá.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

import type { M3Doc, M3Run } from "./osdVerdictM3.js";
import { m3ResultLine, summarizeM3 } from "./osdVerdictM3Campaign.js";

interface Manifest {
  readonly docs?: ReadonlyArray<M3Doc>;
}

const RUN_FILE = /^(R1|R4|P2N|P2)-(A0|A|B|C)-r\d+\.json$/;

function readOptional(dir: string, name: string): unknown {
  const file = join(dir, name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as unknown) : null;
}

function main(): number {
  const [outputArg] = process.argv.slice(2);
  if (outputArg === undefined) throw new Error("Uso: summarizeOsdVerdictM3Cli.ts <output-dir>");
  const dir = resolve(outputArg);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("Falta manifest.json en la carpeta de salida.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const runs = readdirSync(dir)
    .filter((name) => RUN_FILE.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as M3Run)
    .filter((run) => run.schema === 3);
  const { check, summary, text } = summarizeM3(runs, manifest.docs ?? []);
  writeFileSync(
    join(dir, "summary.json"),
    `${JSON.stringify(
      {
        generatedAtUtc: new Date().toISOString(),
        check,
        ...summary,
        validity: readOptional(dir, "validity.json"),
        sleepDetection: readOptional(dir, "sleep-detection.json"),
        caveats: readOptional(dir, "caveats.json"),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, "summary-tables.txt"), text);
  writeSync(1, `${text}\n${m3ResultLine(check)}\n`);
  return check.complete ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
