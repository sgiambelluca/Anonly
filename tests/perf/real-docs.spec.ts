/**
 * T-10 (`docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §3): dos documentos
 * reales contra sus fixtures, intercalados en una sola sesión por
 * `run-documentos-reales.sh`. Una invocación = un perfil, una ronda.
 *
 * **Confidencialidad (plan §3.1).** R1 y R2 llegan solo como rutas en
 * `ANONLY_REAL_DOC_R1`/`ANONLY_REAL_DOC_R2`; no se copian a ningún lado y la app
 * los recibe con un nombre neutro. El colector corre con `captureOcrWords: false`
 * en **los cuatro** perfiles —no solo en los reales— para que el instrumento sea
 * el mismo en todas las condiciones (`Optimizacion_De_Memoria_Plan.md` §2bis
 * punto 4). Del documento sale solo lo que se puede contar: páginas, tipo de
 * fuente, entidades y grupos, tiempos y memoria.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile, type E2eFilePayload } from "../e2e/support/fixtures.js";
import { generateText50p } from "../fixtures/generate.js";

import { measureProfile, printReport, type ProfileReport } from "./support/memoryProfile.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";

declare global {
  var __anonlyDocMeta:
    | {
        pageCount: number | null;
        textlessPageCount: number | null;
        sourceKind: string | null;
        regexEntityCount: number;
        nerEntityCount: number;
      }
    | undefined;
}

type DocMeta = NonNullable<typeof globalThis.__anonlyDocMeta>;

interface RealDocsProfile {
  readonly profileId: string;
  readonly file: () => Promise<E2eFilePayload>;
  readonly importTimeoutMs: number;
  readonly testTimeoutMs: number;
}

async function realDocFile(envName: string, neutralName: string): Promise<E2eFilePayload> {
  const path = process.env[envName];
  if (path === undefined || path === "") {
    throw new Error(`${envName} no está definido: la ruta del documento real se pasa por entorno.`);
  }
  return { name: neutralName, mimeType: "application/pdf", buffer: await readFile(path) };
}

const PROFILES: Readonly<Record<string, RealDocsProfile>> = {
  P1: {
    profileId: "p1-native-10p",
    file: textTenPagesFile,
    importTimeoutMs: 180_000,
    testTimeoutMs: 300_000,
  },
  P2: {
    profileId: "p2-scanned-50p",
    file: async () =>
      getOrGenerateScannedFixture("p2-scanned-50p", new Uint8Array(await generateText50p())),
    importTimeoutMs: 300_000,
    testTimeoutMs: 900_000,
  },
  R1: {
    profileId: "r1-real-native",
    file: () => realDocFile("ANONLY_REAL_DOC_R1", "r1.pdf"),
    importTimeoutMs: 600_000,
    testTimeoutMs: 1_800_000,
  },
  R2: {
    profileId: "r2-real-scanned",
    file: () => realDocFile("ANONLY_REAL_DOC_R2", "r2.pdf"),
    importTimeoutMs: 600_000,
    testTimeoutMs: 1_800_000,
  },
};

/** Contadores propios de cada import: un objeto nuevo por instalación, así el listener del frío no suma en el caliente. */
async function installDocMetaCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente: ¿VITE_E2E=1 en el build?");
    const meta: NonNullable<typeof globalThis.__anonlyDocMeta> = {
      pageCount: null,
      textlessPageCount: null,
      sourceKind: null,
      regexEntityCount: 0,
      nerEntityCount: 0,
    };
    globalThis.__anonlyDocMeta = meta;
    core.bus.on("pdf", "DOCUMENT_PARSED", (payload: unknown) => {
      const p = payload as { pageCount?: unknown; textlessPages?: unknown; sourceKind?: unknown };
      if (typeof p.pageCount === "number") meta.pageCount = p.pageCount;
      if (Array.isArray(p.textlessPages)) meta.textlessPageCount = p.textlessPages.length;
      if (typeof p.sourceKind === "string") meta.sourceKind = p.sourceKind;
    });
    core.bus.on("regex", "ENTITY_FOUND", () => {
      meta.regexEntityCount += 1;
    });
    core.bus.on("ner", "ENTITY_FOUND", () => {
      meta.nerEntityCount += 1;
    });
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} no está definido: esta spec se lanza desde run-documentos-reales.sh.`);
  }
  return value;
}

test("T-10 — un perfil, una ronda", async ({ page, electronApp, electronUserDataDir }) => {
  const profileKey = requireEnv("ANONLY_REAL_DOCS_PROFILE");
  const round = requireEnv("ANONLY_REAL_DOCS_ROUND");
  const outputDir = requireEnv("ANONLY_REAL_DOCS_OUTPUT_DIR");
  const profile = PROFILES[profileKey];
  if (profile === undefined)
    throw new Error(`Perfil desconocido: ${profileKey} (P1, P2, R1 o R2).`);
  test.setTimeout(profile.testTimeoutMs);

  const file = await profile.file();
  await openApp(page, "networkidle");

  const docMeta: Partial<Record<"cold" | "hot", DocMeta>> = {};
  const report: ProfileReport = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    profile.profileId,
    file,
    profile.importTimeoutMs,
    [installDocMetaCollector],
    async (p, temperature) => {
      const meta = await p.evaluate(() => globalThis.__anonlyDocMeta);
      if (meta !== undefined) docMeta[temperature] = meta;
    },
    undefined,
    { captureOcrWords: false },
  );

  printReport(report);
  for (const temperature of ["cold", "hot"] as const) {
    const m = docMeta[temperature];
    const run = report[temperature];
    process.stdout.write(
      `  ${temperature}: páginas=${m?.pageCount ?? "?"} fuente=${m?.sourceKind ?? "?"} ` +
        `sin texto=${m?.textlessPageCount ?? "?"} páginas con OCR=${run.ocrPages?.length ?? 0} ` +
        `entidades regex=${m?.regexEntityCount ?? "?"} ner=${m?.nerEntityCount ?? "?"} ` +
        `grupos=${run.groupCount}\n`,
    );
  }

  // Antes de escribir nada: con la captura apagada, ni una palabra del documento
  // puede llegar al disco.
  expect(report.cold.ocrWords ?? []).toHaveLength(0);
  expect(report.hot.ocrWords ?? []).toHaveLength(0);

  await mkdir(outputDir, { recursive: true });
  const outFile = resolve(outputDir, `real-docs-${profileKey}-round${round}.json`);
  const payload = {
    profileKey,
    round: Number(round),
    fileBytes: file.buffer.byteLength,
    docMeta,
    report,
  };
  await writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`Medición escrita en ${outFile}\n`);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
});
