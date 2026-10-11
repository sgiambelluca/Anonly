/**
 * M-O3 (`docs/roadmap/hardening/Confianza_Cierre_2026-10-08.md`, Frente 3, «M-O3 — el peor caso, con documentos
 * reales»): el tiempo y el pico de memoria M2 si todas las páginas de un escaneo se leen en los cuatro ángulos, y
 * si eso cambia lo que se entrega. Opt-in: la lanza `run-osd-verdict.sh` con `ANONLY_OSD_VERDICT_SET=m3`. No
 * cambia producto.
 *
 * **El instrumento es el de `memory.spec.ts`**: `measureProfile` (`support/memoryProfile.ts`), una instancia fría
 * de Electron por corrida, importación en frío, `closeDocument` e importación en caliente del mismo archivo, con
 * el nivel `medium` que fija la suite de medición (ADR-194 §8), NER activo y la misma cadencia de muestreo.
 * `memory.spec.ts` no se toca. Lo que se suma, en cada importación: un observador de transporte
 * (`installTransportObserver`, sin retener texto ni rásteres) y un colector de lo entregado por página
 * (`osdVerdictM3Collector.ts`, solo cantidades y hashes).
 *
 * Brazos: `A` control con el observador instalado y sin forzar nada; `A0` sin observador (solo P2); `B` «sin
 * veredicto» forzado en todas las páginas (`forceNoVerdict`); `C` además la tinta informada sube al umbral
 * cuando quedó debajo. Documentos: R1 y R4 (reales, `ANONLY_REAL_DOC_R1` y `R4`), P2 y P2 con ruido.
 *
 * **Privacidad de los reales.** R1 se importa entera tal cual (en memoria); R4 se rasteriza a 300 dpi en un
 * Chromium aparte y se une en un solo PDF, también en memoria. Nada derivado de esos documentos se escribe a
 * disco, y el registro de una corrida no lleva texto. Los errores de lectura no informan la ruta.
 *
 * Reanudable: registra solo las corridas que todavía no tienen su archivo en la carpeta de salida
 * (`ANONLY_OSD_VERDICT_OUTPUT_DIR`), hasta `ANONLY_OSD_VERDICT_LIMIT` por llamada, filtradas por
 * `ANONLY_OSD_VERDICT_ONLY` (expresión regular sobre `<doc>-<brazo>-r<n>`).
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { PDFDocument } from "pdf-lib";

import { openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";
import { generateText50p } from "../fixtures/generate.js";

import { installTransportObserver } from "./support/adr190Browser.js";
import { hashBytes } from "./support/adr190Fixtures.js";
import { measureProfile, type RunCollectorOptions } from "./support/memoryProfile.js";
import { envVarOf, REAL_DOC_PAGES, type RealDocId } from "./support/osdVerdictCorpusM2.js";
import { readRealDocument } from "./support/osdVerdictFixturesM2.js";
import {
  M3_PAGES,
  M3_R4_DPI,
  M3_REAL_DOCS,
  buildM3Run,
  m3FileName,
  m3Key,
  m3Plan,
  type M3Doc,
  type M3Run,
  type M3RunId,
} from "./support/osdVerdictM3.js";
import {
  captureM3Run,
  installM3Collector,
  type RunSnapshot,
} from "./support/osdVerdictM3Collector.js";
import {
  buildP2WithNoise,
  loadNoiseSheets,
  rasterizeWholeDocument,
} from "./support/osdVerdictM3Fixtures.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const OPT_IN = process.env.ANONLY_OSD_VERDICT_M3 === "1";
const OUTPUT_DIR = process.env.ANONLY_OSD_VERDICT_OUTPUT_DIR ?? "";
const ONLY = process.env.ANONLY_OSD_VERDICT_ONLY ?? "";
const LIMIT = Number(process.env.ANONLY_OSD_VERDICT_LIMIT ?? "0");
const MAX_ATTEMPTS = 2;
/** Una importación de R4 con las cuatro lecturas en todas las páginas puede tardar varios minutos. */
const RUN_TIMEOUT_MS = 1_200_000;

if (!Number.isInteger(LIMIT) || LIMIT < 0) throw new Error(`Tope inválido: ${LIMIT}`);

/** Los reales con la variable definida y un archivo legible (la ruta no se informa). */
const availableReal: ReadonlyArray<M3Doc> = M3_REAL_DOCS.filter((doc) => {
  const path = process.env[envVarOf(doc as RealDocId)];
  return path !== undefined && path !== "" && existsSync(path);
});
const docs: ReadonlyArray<M3Doc> = [...availableReal, "P2", "P2N"];

function failureCount(file: string): number {
  if (!existsSync(OUTPUT_DIR)) return 0;
  const prefix = file.replace(/\.json$/, "-failure-");
  return readdirSync(OUTPUT_DIR).filter((name) => name.startsWith(prefix)).length;
}

const pending: ReadonlyArray<M3RunId> = (() => {
  if (!OPT_IN || OUTPUT_DIR === "") return [];
  const only = ONLY === "" ? null : new RegExp(ONLY);
  const list = m3Plan().filter((id) => {
    if (!docs.includes(id.doc)) return false;
    if (only !== null && !only.test(m3Key(id))) return false;
    if (existsSync(join(OUTPUT_DIR, m3FileName(id)))) return false;
    return failureCount(m3FileName(id)) < MAX_ATTEMPTS;
  });
  return LIMIT === 0 ? list : list.slice(0, LIMIT);
})();

/** Los documentos, en memoria. */
const payloads = new Map<M3Doc, E2eFilePayload>();

async function pageCountOf(buffer: Uint8Array): Promise<number> {
  return (await PDFDocument.load(buffer, { updateMetadata: false })).getPageCount();
}

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
  readonly fixtureHashes: Record<string, string>;
  readonly docs: ReadonlyArray<M3Doc>;
  readonly tandas: unknown[];
}

async function buildDocument(doc: M3Doc): Promise<E2eFilePayload> {
  if (doc === "R1") {
    const buffer = Buffer.from(await readRealDocument(process.env[envVarOf("R1")] ?? ""));
    const pages = await pageCountOf(buffer);
    if (pages !== REAL_DOC_PAGES.R1)
      throw new Error(`R1: tiene ${pages} páginas y el plan dice ${REAL_DOC_PAGES.R1}`);
    return { name: "R1.pdf", mimeType: "application/pdf", buffer };
  }
  if (doc === "R4") {
    const source = await readRealDocument(process.env[envVarOf("R4")] ?? "");
    const merged = await rasterizeWholeDocument(source, M3_R4_DPI, REAL_DOC_PAGES.R4);
    return { name: "R4.pdf", mimeType: "application/pdf", buffer: Buffer.from(merged) };
  }
  // P2: el fixture normativo de memory.spec.ts, sin cambios.
  const textSource = await generateText50p();
  const p2 = await getOrGenerateScannedFixture("p2-scanned-50p", new Uint8Array(textSource));
  if (doc === "P2") return p2;
  const sheets = await loadNoiseSheets(join(OUTPUT_DIR, "fixtures"));
  const merged = await buildP2WithNoise(p2.buffer, sheets);
  return { name: "p2-con-ruido.pdf", mimeType: "application/pdf", buffer: Buffer.from(merged) };
}

test.describe("M-O3: el peor caso de tiempo y memoria", () => {
  test.skip(!OPT_IN, "Campaña opt-in: la lanza run-osd-verdict.sh con ANONLY_OSD_VERDICT_SET=m3");

  test.beforeAll(async () => {
    if (OUTPUT_DIR === "") throw new Error("ANONLY_OSD_VERDICT_OUTPUT_DIR no definido.");
    await mkdir(OUTPUT_DIR, { recursive: true });
    const manifestPath = join(OUTPUT_DIR, "manifest.json");
    const previous = existsSync(manifestPath)
      ? (JSON.parse(await readFile(manifestPath, "utf8")) as Manifest)
      : null;
    if (previous !== null && JSON.stringify(previous.docs) !== JSON.stringify(docs))
      throw new Error("los documentos disponibles difieren de los de la primera tanda");
    const needed = new Set(pending.map((id) => id.doc));
    if (needed.size === 0) return;
    for (const doc of docs) {
      if (!needed.has(doc)) continue;
      payloads.set(doc, await buildDocument(doc));
    }
    const buildFiles = [
      ...(await hashTree(resolve("apps/react-client/dist"))),
      ...(await hashTree(resolve("apps/desktop-shell/dist"))),
    ];
    const buildHash = hashBytes(Buffer.from(JSON.stringify(buildFiles)));
    if (previous !== null && previous.buildHash !== buildHash)
      throw new Error("el build difiere del de la primera tanda; la campaña no es comparable");
    const fixtureHashes: Record<string, string> = { ...previous?.fixtureHashes };
    for (const [doc, payload] of payloads) {
      const hash = hashBytes(payload.buffer);
      const before = fixtureHashes[doc];
      if (before !== undefined && before !== hash)
        throw new Error(`el documento ${doc} cambió entre tandas`);
      fixtureHashes[doc] = hash;
    }
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          phase: "M-O3 el peor caso de tiempo y memoria",
          createdAt: previous?.createdAt ?? new Date().toISOString(),
          buildHash,
          docs,
          docsMissing: M3_REAL_DOCS.filter((doc) => !availableReal.includes(doc)),
          pages: M3_PAGES,
          // Solo el SHA-256 de cada documento armado: ni rutas ni contenido.
          fixtureHashes,
          instrument:
            "measureProfile de memory.spec.ts (ADR-146): pico M2 en frío y en caliente, nivel medium, NER activo",
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
      `M-O3: carpeta ${OUTPUT_DIR}; corridas pendientes ${pending.length}; reales: ${availableReal.join(",") || "ninguno"}`,
    );
  });

  for (const id of pending) {
    test(m3Key(id), async ({ page, electronApp, electronUserDataDir }) => {
      test.setTimeout(RUN_TIMEOUT_MS * 3);
      const file = payloads.get(id.doc);
      if (file === undefined) throw new Error(`documento sin armar: ${id.doc}`);
      const real = id.doc === "R1" || id.doc === "R4";
      const emptySnapshot: RunSnapshot = { observer: id.arm !== "A0", pages: [], ocrPageJobs: 0 };
      const snapshots: Record<"cold" | "hot", RunSnapshot> = {
        cold: emptySnapshot,
        hot: emptySnapshot,
      };
      const captureErrors: string[] = [];
      let recorded = false;
      try {
        if (id.arm !== "A0")
          await installTransportObserver(page, {
            lightweightResults: true,
            ...(id.arm === "B" ? { forceNoVerdict: { raiseInkToThreshold: false } } : {}),
            ...(id.arm === "C" ? { forceNoVerdict: { raiseInkToThreshold: true } } : {}),
          });
        await openApp(page, "networkidle");
        // Los reales no sacan palabras del renderer (T-10); P2 y P2N, como memory.spec.ts.
        const collectorOptions: RunCollectorOptions | undefined = real
          ? { captureOcrWords: false }
          : undefined;
        const report = await measureProfile(
          page,
          electronApp,
          electronUserDataDir,
          `m3-${id.doc.toLowerCase()}`,
          file,
          RUN_TIMEOUT_MS,
          [installM3Collector],
          async (inPage, temperature) => {
            try {
              snapshots[temperature] = await captureM3Run(inPage);
            } catch (error: unknown) {
              captureErrors.push(
                `${temperature}: ${error instanceof Error ? error.name : "error"}`,
              );
            }
          },
          undefined,
          collectorOptions,
        );
        const run: M3Run = buildM3Run({
          id,
          fixtureSha256: hashBytes(file.buffer),
          pageCount: M3_PAGES[id.doc],
          report,
          cold: snapshots.cold,
          hot: snapshots.hot,
        });
        const issues = [...run.issues, ...captureErrors.map((e) => `captura: ${e}`)];
        if (issues.length > 0) {
          await writeFile(
            join(
              OUTPUT_DIR,
              m3FileName(id).replace(
                /\.json$/,
                `-failure-${failureCount(m3FileName(id)) + 1}.json`,
              ),
            ),
            JSON.stringify({ ...run, issues }, null, 2),
          );
          recorded = true;
          throw new Error(`${m3Key(id)}: ${issues.join("; ")}`);
        }
        await writeFile(join(OUTPUT_DIR, m3FileName(id)), JSON.stringify(run, null, 2));
        console.log(
          `M-O3 ${m3Key(id)}: frío ${((run.cold.peakSumBytes ?? 0) / 1e6).toFixed(0)} MB / ${((run.cold.readyDurationMs ?? 0) / 1000).toFixed(1)} s; caliente ${((run.hot.peakSumBytes ?? 0) / 1e6).toFixed(0)} MB / ${((run.hot.readyDurationMs ?? 0) / 1000).toFixed(1)} s; reconocimientos ${run.cold.ocrPageDispatches}`,
        );
      } catch (error: unknown) {
        // De un documento real solo se guarda el nombre del error: nada que pueda llevar su contenido.
        const message = real
          ? error instanceof Error
            ? error.name
            : "error"
          : error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
        const failurePath = join(
          OUTPUT_DIR,
          m3FileName(id).replace(/\.json$/, `-failure-${failureCount(m3FileName(id)) + 1}.json`),
        );
        if (!recorded && !existsSync(failurePath))
          await writeFile(failurePath, JSON.stringify({ run: m3Key(id), error: message }, null, 2));
        throw real ? new Error(`fallo en ${m3Key(id)}: ${message}`) : error;
      }
    });
  }
});
