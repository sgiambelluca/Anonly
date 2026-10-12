/**
 * M-O1 (`docs/roadmap/hardening/Confianza_Cierre_2026-10-08.md`, Frente 3): ¿qué entrega la cadena de ADR-190
 * cuando el OSD afirma un ángulo equivocado sobre una página con poco texto? Opt-in: la lanza
 * `run-osd-verdict.sh`. No cambia producto.
 *
 * 140 PDF escaneados sintéticos (`osdVerdictCorpus.ts`): los 76 de la campaña de recuperación de ADR-190
 * y 64 de página escasa (N1 a N8). Cinco observaciones por PDF, cada una en una instancia fría de la
 * aplicación empaquetada con el worker y los modelos reales:
 *
 * - `production`: la cadena sin forzar nada;
 * - `forced-<ángulo>` (0, 90, 180, 270): el resultado de la detección de orientación se reemplaza, en el
 *   transporte y antes de que lo lea el host, por un veredicto válido (`osdHadVerdict: true`) en ese
 *   ángulo (`forceOrientationVerdict` de `adr190Browser.ts`). Es la diferencia con la campaña de
 *   recuperación, que cambiaba el payload del primer reconocimiento y dejaba el `osdHadVerdict` real.
 *
 * Los 700 registros no caben en una llamada: el spec es reanudable. Registra solo las observaciones que
 * todavía no tienen su archivo en la carpeta de salida (`ANONLY_OSD_VERDICT_OUTPUT_DIR`), hasta
 * `ANONLY_OSD_VERDICT_LIMIT` por tanda, y `ANONLY_OSD_VERDICT_ONLY` las filtra por la clave del PDF
 * (expresión regular). Una observación que falla deja `<archivo>-failure-<n>.json` y se reintenta una vez.
 * El resumen lo arma `summarizeOsdVerdictCli.ts`, sin volver a correr nada.
 *
 * Solo sintéticos: nada de `ANONLY_REAL_DOC_*`.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test } from "../e2e/support/electronApp.js";

import { DENSITIES, SOURCE_DPIS, type Cell } from "./support/adr190Dpi.js";
import {
  generateCampaignFixtures,
  hashBytes,
  type CampaignFixture,
} from "./support/adr190Fixtures.js";
import {
  OLD_CONTROL_DENSITIES,
  PHYSICAL_ANGLES,
  corpusEntries,
  type PhysicalAngle,
} from "./support/osdVerdictCorpus.js";
import { generateSparseFixtures } from "./support/osdVerdictFixtures.js";
import { observePage } from "./support/osdVerdictObserve.js";
import {
  buildObservation,
  observationFileName,
  type ObservationRecord,
} from "./support/osdVerdictRun.js";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const OPT_IN = process.env.ANONLY_OSD_VERDICT === "1";
const OUTPUT_DIR = process.env.ANONLY_OSD_VERDICT_OUTPUT_DIR ?? "";
const ONLY = process.env.ANONLY_OSD_VERDICT_ONLY ?? "";
const LIMIT = Number(process.env.ANONLY_OSD_VERDICT_LIMIT ?? "0");
const MAX_ATTEMPTS = 2;
/** El manifiesto de la campaña de recuperación de ADR-190: de ahí salen los hashes de sus 76 PDF. */
const RECOVERY_MANIFEST = resolve(
  ".measure/adr190-osd-recovery/2026-09-28T05-33-21-860Z-campaign-20508/manifest.json",
);

if (!Number.isInteger(LIMIT) || LIMIT < 0) throw new Error(`Tope inválido: ${LIMIT}`);

const entries = corpusEntries();
const modes: ReadonlyArray<PhysicalAngle | null> = [null, ...PHYSICAL_ANGLES];

function failureCount(file: string): number {
  if (!existsSync(OUTPUT_DIR)) return 0;
  const prefix = file.replace(/\.json$/, "-failure-");
  return readdirSync(OUTPUT_DIR).filter((name) => name.startsWith(prefix)).length;
}

/** Las observaciones que faltan, en el orden del corpus, con el filtro y el tope de esta tanda. */
const pending = (() => {
  if (!OPT_IN || OUTPUT_DIR === "") return [];
  const only = ONLY === "" ? null : new RegExp(ONLY);
  const list = entries.flatMap((entry) =>
    modes.flatMap((forcedAngle) => {
      const file = observationFileName(entry.key, forcedAngle);
      if (only !== null && !only.test(entry.key)) return [];
      if (existsSync(join(OUTPUT_DIR, file))) return [];
      if (failureCount(file) >= MAX_ATTEMPTS) return [];
      return [{ entry, forcedAngle, file }];
    }),
  );
  return LIMIT === 0 ? list : list.slice(0, LIMIT);
})();

const fixtures = new Map<string, CampaignFixture>();

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

interface RecoveryManifest {
  readonly qualityFixtures: ReadonlyArray<{ key: string; pdfSha256: string }>;
  readonly controlFixtures: ReadonlyArray<{ key: string; pdfSha256: string }>;
}

test.describe("Veredicto de orientación equivocado (M-O1)", () => {
  test.skip(!OPT_IN, "Campaña opt-in: la lanza run-osd-verdict.sh");
  test.setTimeout(240_000);

  test.beforeAll(async () => {
    if (OUTPUT_DIR === "") throw new Error("ANONLY_OSD_VERDICT_OUTPUT_DIR no definido.");
    await mkdir(OUTPUT_DIR, { recursive: true });
    const needed = new Set(pending.map((item) => item.entry.key));
    if (needed.size === 0) return;

    // Corpus viejo: las mismas celdas de ADR-190, con el mismo cache de fixtures.
    const oldCells: Cell[] = [
      ...DENSITIES.flatMap((density) =>
        SOURCE_DPIS.flatMap((sourceDpi) =>
          PHYSICAL_ANGLES.map((angle) => ({
            sourceDpi,
            density,
            angle,
            arm: "native" as const,
            repetition: 1,
          })),
        ),
      ),
      ...OLD_CONTROL_DENSITIES.flatMap((density) =>
        SOURCE_DPIS.map((sourceDpi) => ({
          sourceDpi,
          density,
          angle: 0 as const,
          arm: "native" as const,
          repetition: 1,
        })),
      ),
    ];
    const neededOld = oldCells.filter((cell) =>
      needed.has(`${cell.density}-${cell.sourceDpi}-${cell.angle}`),
    );
    if (neededOld.length > 0) {
      const generated = await generateCampaignFixtures(neededOld, join(OUTPUT_DIR, "fixtures"));
      for (const [key, fixture] of generated) fixtures.set(key, fixture);
    }
    const neededSparse = entries.filter((entry) => entry.set === "sparse" && needed.has(entry.key));
    if (neededSparse.length > 0) {
      const generated = await generateSparseFixtures(neededSparse, join(OUTPUT_DIR, "fixtures"));
      for (const [key, fixture] of generated) fixtures.set(key, fixture);
    }
    for (const key of needed)
      if (!fixtures.has(key)) throw new Error(`fixture sin generar: ${key}`);

    // «Sin cambios»: los 76 PDF viejos tienen que ser byte a byte los de la campaña de recuperación.
    const recovery = JSON.parse(await readFile(RECOVERY_MANIFEST, "utf8")) as RecoveryManifest;
    const recoveryHashes = new Map(
      [...recovery.qualityFixtures, ...recovery.controlFixtures].map((item) => [
        item.key,
        item.pdfSha256,
      ]),
    );
    let oldCompared = 0;
    for (const [key, fixture] of fixtures) {
      const entry = entries.find((candidate) => candidate.key === key);
      if (entry === undefined || entry.set === "sparse") continue;
      if (recoveryHashes.get(key) !== fixture.hash)
        throw new Error(`el PDF ${key} difiere del de la campaña de recuperación de ADR-190`);
      oldCompared += 1;
    }

    const buildFiles = [
      ...(await hashTree(resolve("apps/react-client/dist"))),
      ...(await hashTree(resolve("apps/desktop-shell/dist"))),
    ];
    const buildHash = hashBytes(Buffer.from(JSON.stringify(buildFiles)));
    const manifestPath = join(OUTPUT_DIR, "manifest.json");
    const previous = existsSync(manifestPath)
      ? (JSON.parse(await readFile(manifestPath, "utf8")) as {
          createdAt: string;
          buildHash: string;
          pdfHashes: Record<string, string>;
          tandas: unknown[];
        })
      : null;
    if (previous !== null && previous.buildHash !== buildHash)
      throw new Error("el build difiere del de la primera tanda; la campaña no es comparable");
    const pdfHashes: Record<string, string> = { ...previous?.pdfHashes };
    for (const [key, fixture] of fixtures) {
      const before = pdfHashes[key];
      if (before !== undefined && before !== fixture.hash)
        throw new Error(`el PDF ${key} cambió entre tandas`);
      pdfHashes[key] = fixture.hash;
    }
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          phase: "M-O1 veredicto de orientación equivocado",
          createdAt: previous?.createdAt ?? new Date().toISOString(),
          buildHash,
          expectedPdfs: entries.length,
          expectedObservations: entries.length * modes.length,
          recoveryManifest: RECOVERY_MANIFEST,
          forcedPath:
            "Worker 'message' listener del arnés cambia, en el objeto que recibe el host, el resultado de ocr-orient a { orientation: ángulo, osdHadVerdict: true } con el inkRatio medido; el host toma ese resultado como un veredicto y sigue su cadena.",
          pdfHashes,
          tandas: [
            ...(previous?.tandas ?? []),
            {
              startedAtUtc: new Date().toISOString(),
              pending: pending.length,
              // Los PDF viejos de esta tanda se compararon, uno por uno, con los de la campaña de recuperación.
              oldPdfsComparedWithRecovery: oldCompared,
            },
          ],
        },
        null,
        2,
      ),
    );
    console.log(`M-O1: carpeta ${OUTPUT_DIR}; pendientes en esta tanda ${pending.length}`);
  });

  for (const { entry, forcedAngle, file } of pending) {
    test(`${entry.key} ${forcedAngle === null ? "production" : `forced-${forcedAngle}`}`, async ({
      page,
      electronUserDataDir,
    }) => {
      const fixture = fixtures.get(entry.key);
      if (fixture === undefined) throw new Error(`fixture missing: ${entry.key}`);
      const pdfBytes = await readFile(fixture.path);
      const fixtureHash = hashBytes(pdfBytes);
      expect(fixtureHash, `${entry.key} immutable PDF hash`).toBe(fixture.hash);
      // El registro incoherente se guarda en el archivo de falla: la evidencia no se tira.
      let rejected: ObservationRecord | null = null;
      try {
        const observed = await observePage({
          page,
          electronUserDataDir,
          name: `${entry.key}.pdf`,
          pdfBytes,
          forcedAngle,
        });
        const record = buildObservation({
          entry,
          fixture,
          forcedAngle,
          attempts: observed.attempts,
          orientationJob: observed.orientationJob,
          rawOsd: observed.rawOsd,
          run: observed.run,
          readyMs: observed.readyMs,
        });
        if (record.issues.length > 0) {
          rejected = record;
          throw new Error(`${file}: ${record.issues.join("; ")}`);
        }
        await writeFile(join(OUTPUT_DIR, file), JSON.stringify(record, null, 2));
      } catch (error: unknown) {
        const attemptNumber = failureCount(file) + 1;
        const failurePath = join(
          OUTPUT_DIR,
          file.replace(/\.json$/, `-failure-${attemptNumber}.json`),
        );
        if (!existsSync(failurePath))
          await writeFile(
            failurePath,
            JSON.stringify(
              {
                key: entry.key,
                forcedAngle,
                fixtureHash,
                error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
                record: rejected,
              },
              null,
              2,
            ),
          );
        throw error;
      }
    });
  }
});
