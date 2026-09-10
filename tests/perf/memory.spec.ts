/**
 * H-10 (ADR-146): instrumento de medición de memoria M1/M2, sobre el shell
 * de Electron empaquetado — mismo arnés que `pipeline-timing.spec.ts`
 * (ADR-153 §2: tiempos y memoria salen del mismo proceso, mismo
 * instrumento, se pueden leer juntos).
 *
 * **No es un gate** (ADR-146, "en contra": "no fija los números finales del
 * gate... primero H-10 mide"). Mide y reporta — mismo criterio que
 * `tests/measure/baseline.spec.ts` — y escribe el resultado en `.measure/`
 * para comparar corridas.
 *
 * Perfiles (ADR-146 §4): P1 (10 páginas de texto nativo, control), P2 (50
 * páginas escaneadas, el fixture de H-10) y P2-dense (mismas 50 páginas,
 * entidad en las 50 en vez de 5, párrafo más largo — control de densidad
 * pedido para separar "más páginas" de "más carga por página" como
 * variables de M1). P3 (ciclo de 10 open/close) no está en este archivo —
 * H-07/test:leak es quien lo necesita y todavía no existe; ver
 * `07_Performance_Strategy.md` §11.4.
 *
 * Frío/caliente, dentro de la MISMA instancia de Electron (ADR-146 §4: "los
 * modelos ya cargados por un documento anterior en el mismo arranque"):
 * import 1 (frío, sin modelos) → `closeDocument` → import 2 (caliente, los
 * modelos siguen retenidos por el idle-dispose de ADR-080). M1 solo tiene
 * sentido en la corrida caliente: su definición exige una línea de base
 * "con los modelos ya cargados y sin documento abierto" (ADR-146 §1), que
 * recién existe después de haber procesado al menos un documento.
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";
import { textTenPagesFile } from "../e2e/support/fixtures.js";
import { rasterizeToScannedPdf } from "../e2e/support/scannedPdf.js";
import {
  TEXT_50P_ENTITY_PAGE_INDICES,
  generateText50p,
  generateText50pDense,
} from "../fixtures/generate.js";

import {
  peakSumBytes,
  samplesSince,
  startMemorySampling,
  type MemorySampler,
} from "./support/memorySampler.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../.measure");

test.setTimeout(300_000);

const SAMPLE_INTERVAL_MS = 150;
/** Gracia tras `PIPELINE_READY` antes de tomar el pico (ADR-146 §15.3 punto 8: el seed/precalentado de ADR-151 sigue corriendo un instante más). */
const SETTLE_GRACE_MS = 600;

declare global {
  var __anonlyMemoryRun:
    | {
        documentId?: string;
        phases: Record<string, number>;
        groupCount: number;
        entityCount: number;
        failedAt?: number;
      }
    | undefined;
}

const PHASE_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ["pipeline", "DOCUMENT_IMPORTED"],
  ["pdf", "DOCUMENT_PARSED"],
  ["ocr", "OCR_STARTED"],
  ["ocr", "OCR_FINISHED"],
  ["ner", "NER_MODEL_READY"],
  ["ner", "NER_FINISHED"],
  ["grouping", "GROUPING_FINISHED"],
  ["pipeline", "PIPELINE_READY"],
  ["pipeline", "PIPELINE_FAILED"],
];

async function installRunCollector(page: Page): Promise<void> {
  await page.evaluate((phaseEvents) => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente: ¿VITE_E2E=1 en el build?");

    const run: NonNullable<typeof globalThis.__anonlyMemoryRun> = {
      phases: {},
      groupCount: 0,
      entityCount: 0,
    };
    globalThis.__anonlyMemoryRun = run;

    for (const [channel, event] of phaseEvents) {
      core.bus.on(channel, event, (payload: unknown) => {
        if (!(event in run.phases)) run.phases[event] = performance.now();
        if (event === "DOCUMENT_IMPORTED") {
          run.documentId = (payload as { documentId: string }).documentId;
        }
        if (event === "PIPELINE_FAILED") run.failedAt = performance.now();
      });
    }
    core.bus.on("grouping", "ENTITY_GROUP_CREATED", () => {
      run.groupCount += 1;
    });
    core.bus.on("regex", "ENTITY_FOUND", () => {
      run.entityCount += 1;
    });
    core.bus.on("ner", "ENTITY_FOUND", () => {
      run.entityCount += 1;
    });
  }, PHASE_EVENTS);
}

async function waitForRunSettled(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const r = globalThis.__anonlyMemoryRun;
      return r !== undefined && ("PIPELINE_READY" in r.phases || r.failedAt !== undefined);
    },
    undefined,
    { timeout: timeoutMs },
  );
}

async function readRun(page: Page): Promise<NonNullable<typeof globalThis.__anonlyMemoryRun>> {
  return page.evaluate(() => {
    const r = globalThis.__anonlyMemoryRun;
    if (r === undefined) throw new Error("__anonlyMemoryRun ausente");
    return { ...r, phases: { ...r.phases } };
  });
}

interface RunReport {
  readonly temperature: "cold" | "hot";
  readonly baselineBytes: number;
  readonly peakSumBytes: number;
  /** `peakSumBytes - baselineBytes` — solo tiene sentido en caliente (ADR-146 §1). `null` en frío. */
  readonly m1Bytes: number | null;
  readonly phases: Readonly<Record<string, number>>;
  readonly startedAtMs: number;
  readonly readyAtMs: number | null;
  readonly totalMs: number | null;
  readonly groupCount: number;
  readonly entityCount: number;
  readonly ok: boolean;
}

/**
 * Corre un import de punta a punta (`file`, ya en memoria) y devuelve su
 * reporte. `sinceMs` acota el pico de memoria a las muestras posteriores a
 * ese punto del muestreo continuo (para no mezclar el pico de una corrida
 * fría con el de la caliente que le sigue en el mismo `MemorySampler`).
 */
async function runImport(
  page: Page,
  file: E2eFilePayload,
  sampler: MemorySampler,
  temperature: "cold" | "hot",
  baselineBytes: number,
): Promise<RunReport> {
  // Sincroniza con la fase "load" (`appPhase.ts`) antes de soltar el
  // archivo — necesario tras un `closeDocument()`, inocuo en la primera
  // corrida (ya arranca ahí).
  await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });

  await installRunCollector(page);
  const sinceMs = sampler.samples.at(-1)?.atMs ?? 0;
  const startedAtMs = Date.now();

  await page.locator('input[type="file"]').setInputFiles(file);
  await waitForRunSettled(page, 180_000);
  await page.waitForTimeout(SETTLE_GRACE_MS);
  await sampler.sampleOnce();

  const run = await readRun(page);
  const peak = peakSumBytes(samplesSince(sampler.samples, sinceMs));
  const readyAtMs = run.phases.PIPELINE_READY ?? null;
  const startedAtPerf = run.phases.DOCUMENT_IMPORTED ?? null;

  return {
    temperature,
    baselineBytes,
    peakSumBytes: peak,
    m1Bytes: temperature === "hot" ? peak - baselineBytes : null,
    phases: run.phases,
    startedAtMs,
    readyAtMs,
    totalMs: readyAtMs !== null && startedAtPerf !== null ? readyAtMs - startedAtPerf : null,
    groupCount: run.groupCount,
    entityCount: run.entityCount,
    ok: run.failedAt === undefined,
  };
}

/**
 * Cierra por la UI real, no por `core.orchestrator.closeDocument()`
 * directo: ese método solo limpia el estado del Core — ninguno de los
 * stores de React se resetea desde un bus event (`bus-bridge.ts` no tiene
 * handler de `DOCUMENT_CLOSED`, el reset lo dispara `actions.closeDocument()`
 * en la capa de React) — así que un cierre "directo" deja `document.store.id`
 * viejo y el `<input type="file">` nunca reaparece para la corrida
 * siguiente. Mismo patrón que `tests/e2e/scenario-7-open-close-cycle.spec.ts`
 * (el ciclo de H-07/leak): botón real → `ConfirmDialog` real (ADR-051 §2).
 */
async function closeDocument(page: Page): Promise<void> {
  const closeButton = page.getByRole("button", { name: "Cerrar documento" });
  const confirmDialog = page.getByRole("dialog", { name: "Cerrar documento" });
  await closeButton.waitFor({ state: "visible", timeout: 30_000 });
  await closeButton.click();
  await confirmDialog.waitFor({ state: "visible" });
  await confirmDialog.getByRole("button", { name: "Cerrar documento" }).click();
  await confirmDialog.waitFor({ state: "hidden" });
}

interface ProfileReport {
  readonly profile: string;
  readonly identity: {
    readonly commit: string | undefined;
    readonly platform: string;
    readonly arch: string;
    readonly cpuModel: string | undefined;
    readonly cpuCount: number;
    readonly totalMemBytes: number;
  };
  readonly cold: RunReport;
  readonly hot: RunReport;
  readonly capturedAt: string;
}

async function measureProfile(
  page: Page,
  electronApp: Parameters<typeof startMemorySampling>[0],
  profile: string,
  file: E2eFilePayload,
): Promise<ProfileReport> {
  const sampler = startMemorySampling(electronApp, SAMPLE_INTERVAL_MS);
  try {
    // Línea de base FRÍA: recién arrancado, sin modelos, sin documento.
    const coldBaseline = await sampler.sampleOnce();

    const cold = await runImport(page, file, sampler, "cold", coldBaseline.sumWorkingSetSizeBytes);

    await closeDocument(page);
    // Línea de base CALIENTE: los modelos que cargó la corrida fría siguen
    // retenidos (ADR-080 idle-dispose) y ya no hay documento — es la línea
    // de base que ADR-146 §1 exige para M1.
    const hotBaseline = await sampler.sampleOnce();

    const hot = await runImport(page, file, sampler, "hot", hotBaseline.sumWorkingSetSizeBytes);
    await closeDocument(page);

    return {
      profile,
      identity: {
        commit: process.env.GITHUB_SHA,
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: os.cpus()[0]?.model,
        cpuCount: os.cpus().length,
        totalMemBytes: os.totalmem(),
      },
      cold,
      hot,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    sampler.stop();
  }
}

function formatMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function printReport(report: ProfileReport): void {
  const { cold, hot } = report;
  process.stdout.write(
    `\n=== H-10 — perfil ${report.profile} (${report.identity.platform}/${report.identity.arch}, ` +
      `${report.identity.cpuCount} CPUs, ${formatMB(report.identity.totalMemBytes)} RAM) ===\n` +
      `  frío    — M2 (pico suma RSS): ${formatMB(cold.peakSumBytes)}  ` +
      `total: ${cold.totalMs?.toFixed(0) ?? "?"} ms  ok: ${cold.ok}  grupos: ${cold.groupCount}\n` +
      `  caliente — M2: ${formatMB(hot.peakSumBytes)}  ` +
      `M1 (atribuible al documento): ${hot.m1Bytes !== null ? formatMB(hot.m1Bytes) : "?"}  ` +
      `línea de base: ${formatMB(hot.baselineBytes)}  ` +
      `total: ${hot.totalMs?.toFixed(0) ?? "?"} ms  ok: ${hot.ok}  grupos: ${hot.groupCount}\n`,
  );
}

/**
 * Un archivo por corrida, no uno por perfil (ADR-146 §6: "guardar serie
 * temporal y máximos" — sobrescribir perdería las corridas anteriores bajo
 * `--repeat-each`). `runIndex` es `testInfo().repeatEachIndex`: 0, 1, 2...
 */
async function writeReport(report: ProfileReport, runIndex: number): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const outFile = resolve(OUT_DIR, `memory-${report.profile}-run${runIndex}.json`);
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Medición escrita en ${outFile}\n`);
}

test("P1 — 10 páginas de texto nativo (control)", async ({ page, electronApp }, testInfo) => {
  await openApp(page, "networkidle");
  const file = await textTenPagesFile();

  const report = await measureProfile(page, electronApp, "p1-native-10p", file);
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  // DNI 34.567.891 de la página 1 de text-10p.pdf — Regex sin depender de NER.
  expect(report.cold.groupCount).toBeGreaterThan(0);
  expect(report.hot.groupCount).toBeGreaterThan(0);
});

test("P2 — 50 páginas escaneadas (fixture de H-10)", async ({ page, electronApp }, testInfo) => {
  await openApp(page, "networkidle");
  const textSource = await generateText50p();
  // Fuera de la ventana de medición (ADR-146 §15.2 punto 4): se rasteriza
  // ANTES de instalar cualquier sampler.
  const file = await rasterizeToScannedPdf(page, new Uint8Array(textSource));

  const report = await measureProfile(page, electronApp, "p2-scanned-50p", file);
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  // 5 páginas con DNI conocido (TEXT_50P_ENTITY_PAGE_INDICES) — al menos esas
  // deberían agrupar, vía OCR real.
  expect(report.cold.groupCount).toBeGreaterThanOrEqual(TEXT_50P_ENTITY_PAGE_INDICES.length);
  expect(report.hot.groupCount).toBeGreaterThanOrEqual(TEXT_50P_ENTITY_PAGE_INDICES.length);
});

test("P2-dense — 50 páginas escaneadas, entidades en las 50 (control de densidad)", async ({
  page,
  electronApp,
}, testInfo) => {
  await openApp(page, "networkidle");
  const textSource = await generateText50pDense();
  const file = await rasterizeToScannedPdf(page, new Uint8Array(textSource));

  const report = await measureProfile(page, electronApp, "p2-scanned-50p-dense", file);
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  // Las 50 páginas llevan entidad acá (vs. 5 de 50 en p2-scanned-50p) —
  // umbral mucho más alto a propósito, para que un falso verde (0 grupos por
  // un OCR/NER roto) no pase inadvertido en el perfil que más volumen mueve.
  expect(report.cold.groupCount).toBeGreaterThan(TEXT_50P_ENTITY_PAGE_INDICES.length * 5);
  expect(report.hot.groupCount).toBeGreaterThan(TEXT_50P_ENTITY_PAGE_INDICES.length * 5);
});
