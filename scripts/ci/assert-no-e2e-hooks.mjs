#!/usr/bin/env node
/**
 * Release: el build del renderer que se empaqueta no puede llevar los ganchos de
 * medición de los E2E (ADR-155, `React_Client.md` §3.7 y §4).
 *
 * `core-adapter/index.ts` expone `__anonlyCore` (la instancia del Core, con su
 * bus) y lee el canal de overrides `anonly:engine-overrides` solo bajo
 * `import.meta.env.DEV || import.meta.env.VITE_E2E === "1"`. En un build de
 * producción Vite reemplaza esa condición por una constante y elimina el
 * cuerpo; con `VITE_E2E=1` (el build de `pnpm test:e2e`) los ganchos quedan en
 * el bundle. Si un release se construyera con esa variable puesta, el
 * instalador que baja un usuario expondría el Core: este script lo detecta
 * leyendo el resultado, no confiando en que el workflow no defina la variable.
 *
 * Falla (`process.exitCode = 1`) si alguno de los marcadores aparece en algún
 * archivo de texto bajo el directorio, o si el directorio no existe o está
 * vacío ("no se miró nada" no es "no hay nada").
 *
 * Uso: node scripts/ci/assert-no-e2e-hooks.mjs [directorio]
 * (default `apps/react-client/dist`).
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Marcadores que no pueden existir en el bundle de un release. */
const FORBIDDEN_MARKERS = ["anonly:engine-overrides", "__anonlyCore", "VITE_E2E"];

// Sin `.map`: un sourcemap lleva el TEXTO FUENTE (`sourcesContent`), que contiene los
// marcadores aunque el código empaquetado ya no. Lo que se ejecuta es el `.js`.
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".html", ".css", ".json"]);

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files;
}

/**
 * @param {string} dir
 * @returns {Promise<{ readonly scanned: number; readonly hits: ReadonlyArray<{ readonly file: string; readonly marker: string }> }>}
 */
async function scanForMarkers(dir) {
  const files = (await listFiles(dir)).filter((file) =>
    TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf(".")).toLowerCase()),
  );
  /** @type {Array<{ file: string; marker: string }>} */
  const hits = [];
  for (const file of files) {
    const text = await readFile(file, "utf-8");
    for (const marker of FORBIDDEN_MARKERS) {
      if (text.includes(marker)) hits.push({ file, marker });
    }
  }
  return { scanned: files.length, hits };
}

async function main() {
  const dir = resolve(process.argv[2] ?? "apps/react-client/dist");
  /** @type {Awaited<ReturnType<typeof scanForMarkers>>} */
  let result;
  try {
    result = await scanForMarkers(dir);
  } catch (err) {
    console.error(
      `INCONCLUSO: no se pudo leer "${dir}" (${err instanceof Error ? err.message : String(err)}). ` +
        "¿Corrió el build del renderer antes de este paso?",
    );
    process.exitCode = 1;
    return;
  }
  if (result.scanned === 0) {
    console.error(`INCONCLUSO: "${dir}" no tiene ningún archivo de texto que revisar.`);
    process.exitCode = 1;
    return;
  }
  if (result.hits.length > 0) {
    for (const { file, marker } of result.hits) {
      console.error(`PROHIBIDO: "${marker}" aparece en ${file}`);
    }
    console.error(
      "El build del release tiene ganchos de los E2E (VITE_E2E=1). " +
        "Reconstruir el renderer sin esa variable.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `OK: ${result.scanned} archivo(s) revisado(s) en "${dir}", sin ${FORBIDDEN_MARKERS.join(", ")}.`,
  );
}

await main();
