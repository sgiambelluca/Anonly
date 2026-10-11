/**
 * M-O2 (`docs/roadmap/hardening/Confianza_Cierre_2026-10-08.md`, Frente 3, «M-O2 — lo que falta medir antes de
 * enmendar ADR-190»). Opt-in: la lanza `run-osd-verdict.sh` con `ANONLY_OSD_VERDICT_SET=m2`. No cambia producto.
 *
 * Tres conjuntos nuevos del arnés `osd-verdict`, con cinco observaciones por página (producción y un veredicto
 * forzado a cada ángulo, como en M-O1) en la aplicación empaquetada con el OCR real:
 *
 * - **ruido** (24 PDF sintéticos): hojas A4 sin texto con seis tipos de ruido de escáner;
 * - **margen** (24 PDF sintéticos): un sello vertical en el margen derecho, solo o con cuerpo;
 * - **reales** (hasta 81 páginas): cada página de los documentos de `ANONLY_REAL_DOC_R1` a `R4`, armada en
 *   memoria. R1 va a su resolución nativa; R2 a R4 se rasterizan a 150 dpi. **Nada de eso se escribe a disco**:
 *   ni el PDF de una página, ni el ráster; y el registro de una página real no lleva texto (`osdVerdictM2Run.ts`).
 *   Si una variable no está definida, ese documento no se mide y el manifiesto lo dice.
 *
 * Reanudable como M-O1: registra solo las observaciones que todavía no tienen su archivo en la carpeta de
 * salida (`ANONLY_OSD_VERDICT_OUTPUT_DIR`), hasta `ANONLY_OSD_VERDICT_LIMIT` por tanda, filtradas por
 * `ANONLY_OSD_VERDICT_ONLY` (expresión regular sobre la clave). El resumen lo arma
 * `summarizeOsdVerdictM2Cli.ts`, sin volver a correr nada.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test } from "../e2e/support/electronApp.js";

import { hashBytes } from "./support/adr190Fixtures.js";
import { PHYSICAL_ANGLES, type PhysicalAngle } from "./support/osdVerdictCorpus.js";
import {
  REAL_DOC_IDS,
  REAL_DOC_PAGES,
  corpusEntriesM2,
  envVarOf,
  type RealDocId,
} from "./support/osdVerdictCorpusM2.js";
import {
  buildRealPages,
  generateSyntheticFixtures,
  readRealDocument,
} from "./support/osdVerdictFixturesM2.js";
import { buildM2Observation, m2FileName, type M2Observation } from "./support/osdVerdictM2Run.js";
import { observePage } from "./support/osdVerdictObserve.js";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const OPT_IN = process.env.ANONLY_OSD_VERDICT_M2 === "1";
const OUTPUT_DIR = process.env.ANONLY_OSD_VERDICT_OUTPUT_DIR ?? "";
const ONLY = process.env.ANONLY_OSD_VERDICT_ONLY ?? "";
const LIMIT = Number(process.env.ANONLY_OSD_VERDICT_LIMIT ?? "0");
const MAX_ATTEMPTS = 2;

if (!Number.isInteger(LIMIT) || LIMIT < 0) throw new Error(`Tope inválido: ${LIMIT}`);

/** Los documentos reales con la variable definida y un archivo legible (la ruta no se informa). */
const availableDocs: ReadonlyArray<RealDocId> = REAL_DOC_IDS.filter((doc) => {
  const path = process.env[envVarOf(doc)];
  return path !== undefined && path !== "" && existsSync(path);
});

const entries = corpusEntriesM2(availableDocs);
const modes: ReadonlyArray<PhysicalAngle | null> = [null, ...PHYSICAL_ANGLES];

function failureCount(file: string): number {
  if (!existsSync(OUTPUT_DIR)) return 0;
  const prefix = file.replace(/\.json$/, "-failure-");
  return readdirSync(OUTPUT_DIR).filter((name) => name.startsWith(prefix)).length;
}

const pending = (() => {
  if (!OPT_IN || OUTPUT_DIR === "") return [];
  const only = ONLY === "" ? null : new RegExp(ONLY);
  const list = entries.flatMap((entry) =>
    modes.flatMap((forcedAngle) => {
      const file = m2FileName(entry.key, forcedAngle);
      if (only !== null && !only.test(entry.key)) return [];
      if (existsSync(join(OUTPUT_DIR, file))) return [];
      if (failureCount(file) >= MAX_ATTEMPTS) return [];
      return [{ entry, forcedAngle, file }];
    }),
  );
  return LIMIT === 0 ? list : list.slice(0, LIMIT);
})();

/** PDF de cada página, en memoria. Los reales no pasan por disco. */
const pdfs = new Map<string, Uint8Array>();

async function hashTree(directoryPath: string) {
  const files: Array<{ path: string; hash: string; bytes: number }> = [];
  for (const item of await readdir(directoryPath, { withFileTypes: true })) {
    const path = join(directoryPath, item.name);
    if (item.isDirectory()) files.push(...(await hashTree(path)));
    else {
      const bytes = await readFile(path);
      files.push({ path, hash: hashBytes(bytes), bytes: bytes.length });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

interface Manifest {
  readonly createdAt: string;
  readonly buildHash: string;
  readonly pdfHashes: Record<string, string>;
  readonly realDocs: Record<string, number>;
  readonly tandas: unknown[];
}

test.describe("M-O2: ruido, margen y páginas reales", () => {
  test.skip(!OPT_IN, "Campaña opt-in: la lanza run-osd-verdict.sh con ANONLY_OSD_VERDICT_SET=m2");
  test.setTimeout(240_000);

  test.beforeAll(async () => {
    if (OUTPUT_DIR === "") throw new Error("ANONLY_OSD_VERDICT_OUTPUT_DIR no definido.");
    await mkdir(OUTPUT_DIR, { recursive: true });
    const manifestPath = join(OUTPUT_DIR, "manifest.json");
    const previous = existsSync(manifestPath)
      ? (JSON.parse(await readFile(manifestPath, "utf8")) as Manifest)
      : null;
    // La disponibilidad de los reales tiene que ser la de la primera tanda.
    const realDocs: Record<string, number> = Object.fromEntries(
      availableDocs.map((doc) => [doc, REAL_DOC_PAGES[doc]]),
    );
    if (previous !== null && JSON.stringify(previous.realDocs) !== JSON.stringify(realDocs))
      throw new Error("los documentos reales disponibles difieren de los de la primera tanda");

    const needed = new Set(pending.map((item) => item.entry.key));
    if (needed.size === 0) return;

    const synthetic = entries.filter((entry) => entry.kind !== "real" && needed.has(entry.key));
    if (synthetic.length > 0) {
      const generated = await generateSyntheticFixtures(synthetic, join(OUTPUT_DIR, "fixtures"));
      for (const [key, fixture] of generated) pdfs.set(key, fixture.bytes);
    }
    for (const doc of availableDocs) {
      const pages = entries
        .filter((entry) => entry.realDoc === doc && needed.has(entry.key))
        .flatMap((entry) => (entry.realPage === null ? [] : [entry.realPage]));
      if (pages.length === 0) continue;
      const bytes = await readRealDocument(process.env[envVarOf(doc)] ?? "");
      const built = await buildRealPages(doc, bytes, pages);
      for (const entry of entries) {
        if (entry.realDoc !== doc || entry.realPage === null) continue;
        const pdf = built.pdfs.get(entry.realPage);
        if (pdf !== undefined) pdfs.set(entry.key, pdf);
      }
    }
    for (const key of needed) if (!pdfs.has(key)) throw new Error(`PDF sin generar: ${key}`);

    const buildFiles = [
      ...(await hashTree(resolve("apps/react-client/dist"))),
      ...(await hashTree(resolve("apps/desktop-shell/dist"))),
    ];
    const buildHash = hashBytes(Buffer.from(JSON.stringify(buildFiles)));
    if (previous !== null && previous.buildHash !== buildHash)
      throw new Error("el build difiere del de la primera tanda; la campaña no es comparable");
    const pdfHashes: Record<string, string> = { ...previous?.pdfHashes };
    for (const key of needed) {
      const hash = hashBytes(pdfs.get(key) ?? new Uint8Array());
      const before = pdfHashes[key];
      if (before !== undefined && before !== hash)
        throw new Error(`el PDF ${key} cambió entre tandas`);
      pdfHashes[key] = hash;
    }
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          phase: "M-O2 ruido, margen y páginas reales",
          createdAt: previous?.createdAt ?? new Date().toISOString(),
          buildHash,
          expectedPages: entries.length,
          expectedObservations: entries.length * modes.length,
          // Solo qué documentos estuvieron y cuántas páginas tienen: nada de su contenido ni de su ruta.
          realDocs,
          realDocsMissing: REAL_DOC_IDS.filter((doc) => !availableDocs.includes(doc)),
          forcedPath:
            "igual que M-O1: el listener del Worker del arnés cambia el resultado de ocr-orient a { orientation, osdHadVerdict: true } antes de que lo lea el host",
          pdfHashes,
          tandas: [
            ...(previous?.tandas ?? []),
            { startedAtUtc: new Date().toISOString(), pending: pending.length },
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      `M-O2: carpeta ${OUTPUT_DIR}; pendientes en esta tanda ${pending.length}; reales: ${availableDocs.join(",") || "ninguno"}`,
    );
  });

  for (const { entry, forcedAngle, file } of pending) {
    test(`${entry.key} ${forcedAngle === null ? "production" : `forced-${forcedAngle}`}`, async ({
      page,
      electronUserDataDir,
    }) => {
      const pdfBytes = pdfs.get(entry.key);
      if (pdfBytes === undefined) throw new Error(`PDF missing: ${entry.key}`);
      const fixtureHash = hashBytes(pdfBytes);
      const manifest = JSON.parse(
        await readFile(join(OUTPUT_DIR, "manifest.json"), "utf8"),
      ) as Manifest;
      expect(fixtureHash, `${entry.key} immutable PDF hash`).toBe(manifest.pdfHashes[entry.key]);
      // El registro incoherente de un sintético se guarda en el archivo de falla; el de un real no.
      let rejected: M2Observation | null = null;
      try {
        const observed = await observePage({
          page,
          electronUserDataDir,
          name: `${entry.key}.pdf`,
          pdfBytes,
          forcedAngle,
        });
        const record = buildM2Observation({
          entry,
          fixtureSha256: fixtureHash,
          forcedAngle,
          attempts: observed.attempts,
          orientationJob: observed.orientationJob,
          rawOsd: observed.rawOsd,
          run: observed.run,
          readyMs: observed.readyMs,
        });
        if (record.issues.length > 0) {
          if (entry.kind !== "real") rejected = record;
          throw new Error(`${file}: ${record.issues.join("; ")}`);
        }
        await writeFile(join(OUTPUT_DIR, file), JSON.stringify(record, null, 2));
      } catch (error: unknown) {
        const attemptNumber = failureCount(file) + 1;
        const failurePath = join(
          OUTPUT_DIR,
          file.replace(/\.json$/, `-failure-${attemptNumber}.json`),
        );
        // De una página real solo se guarda el nombre del error: nada que pueda llevar su contenido.
        const message =
          entry.kind === "real"
            ? error instanceof Error
              ? error.name
              : "error"
            : error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error);
        if (!existsSync(failurePath))
          await writeFile(
            failurePath,
            JSON.stringify(
              { key: entry.key, forcedAngle, fixtureHash, error: message, record: rejected },
              null,
              2,
            ),
          );
        throw entry.kind === "real" ? new Error(`fallo en ${entry.key}: ${message}`) : error;
      }
    });
  }
});
