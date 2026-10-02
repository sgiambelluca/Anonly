/**
 * Instrumento **externo**: mide tiempo y memoria sin tocar la app.
 *
 * Por qué existe además de `real-docs-timing.spec.ts` (T-13): aquel necesita
 * `globalThis.__anonlyCore`, que solo existe con `VITE_E2E=1`. La versión
 * anterior al hardening está instalada como producto empaquetado de
 * producción (`Anonly.exe` 0.9.2 = commit `19b4d13`), sin ese hook: medirla
 * con el colector de fases es imposible. Este spec usa solo lo que cualquier
 * app de Electron expone:
 *
 * - **tiempo**: el texto del `[role="status"]` de la toolbar
 *   (`pipelineStageLabel.ts`), que es **idéntico byte a byte entre `19b4d13` y
 *   la punta de la rama de hardening** — verificado con `git diff` sobre
 *   `components/toolbar/`, que entre esos dos commits solo cambia en
 *   `pipelineErrorPresentation.ts`. La misma vara mide las dos versiones.
 * - **memoria**: `app.getAppMetrics()` vía `startMemorySampling`, el mismo
 *   sampler de H-10 (ADR-146 §3), que lee desde el arnés y no desde la app.
 *
 * Las fases salen de un `MutationObserver` sobre ese texto, con los números
 * normalizados ("página 3 de 51" → "página N de N") para que cada etapa
 * quede una sola vez y no una por página.
 *
 * Confidencialidad, igual que T-10/T-13 (`Ciclos_Y_Documentos_Reales_Plan.md`
 * §3.1): las rutas de R1/R2 llegan por entorno, el documento se importa con
 * un nombre neutro y del contenido no sale nada al reporte.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { peakSumBytes, startMemorySampling, type MemorySample } from "./support/memorySampler.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHELL_DIR = resolve(ROOT, "apps/desktop-shell");
const REPO_ELECTRON_BIN =
  process.platform === "win32"
    ? resolve(SHELL_DIR, "node_modules/electron/dist/electron.exe")
    : resolve(SHELL_DIR, "node_modules/.bin/electron");

/** Gracia tras "Listo" antes de cerrar la ventana del pico — la misma de `memoryProfile.ts`. */
const SETTLE_GRACE_MS = 600;
/** Reposo antes de leer la línea de base, con la app abierta y sin documento. */
const BASELINE_SETTLE_MS = 2_000;
/** Igual que T-13: el mismo documento reabierto a los 5 s de cerrarlo. */
const REOPEN_GAP_MS = 5_000;
const IMPORT_TIMEOUT_MS = 900_000;

interface StageMark {
  readonly text: string;
  readonly at: number;
}

interface ImportMeasurement {
  readonly ok: boolean;
  readonly importStartedAtMs: number;
  readonly readyAtMs: number;
  readonly wallClockMs: number;
  readonly stages: ReadonlyArray<StageMark>;
  readonly peakBytes: number;
  readonly peakPerProcess: ReadonlyArray<{
    readonly type: string;
    readonly bytes: number;
  }>;
  readonly baselineBytes: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} no está definido: este spec se lanza desde el runner de la campaña.`);
  }
  return value;
}

/**
 * Registra cada cambio de etapa leyendo el `[role="status"]`. Los dígitos se
 * normalizan para que "página 3 de 51" y "página 4 de 51" sean la misma
 * etapa: sin eso, un documento de 51 páginas deja 51 marcas de la misma cosa.
 */
async function installStageObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as unknown as {
      __extStages?: Array<{ text: string; at: number }>;
      __extObserver?: MutationObserver;
    };
    w.__extStages = [];
    const record = (): void => {
      const el = document.querySelector('[role="status"]');
      const raw = el?.textContent?.trim() ?? "";
      if (raw === "") return;
      const text = raw.replace(/\d+/g, "N");
      const marks = w.__extStages;
      if (marks === undefined) return;
      const last = marks[marks.length - 1];
      if (last !== undefined && last.text === text) return;
      marks.push({ text, at: Date.now() });
    };
    w.__extObserver?.disconnect();
    const observer = new MutationObserver(record);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    w.__extObserver = observer;
    record();
  });
}

async function readStages(page: Page): Promise<ReadonlyArray<StageMark>> {
  return page.evaluate(() => {
    const w = globalThis as unknown as { __extStages?: Array<{ text: string; at: number }> };
    return (w.__extStages ?? []).slice();
  });
}

function windowPeak(
  samples: ReadonlyArray<MemorySample>,
  samplerStartedAtMs: number,
  fromEpochMs: number,
  toEpochMs: number,
): { peak: number; perProcess: ReadonlyArray<{ type: string; bytes: number }> } {
  const inWindow = samples.filter((s) => {
    const epoch = samplerStartedAtMs + s.atMs;
    return epoch >= fromEpochMs && epoch <= toEpochMs;
  });
  const peak = peakSumBytes(inWindow);
  const at = inWindow.find((s) => s.sumWorkingSetSizeBytes === peak);
  const byType = new Map<string, number>();
  for (const p of at?.perProcess ?? []) {
    byType.set(p.type, (byType.get(p.type) ?? 0) + p.workingSetSizeBytes);
  }
  return {
    peak,
    perProcess: [...byType.entries()]
      .map(([type, bytes]) => ({ type, bytes }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

async function measureImport(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
  sampler: ReturnType<typeof startMemorySampling>,
): Promise<ImportMeasurement> {
  await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
  await page.waitForTimeout(BASELINE_SETTLE_MS);
  const baseline = await sampler.sampleOnce();
  await installStageObserver(page);

  const importStartedAtMs = Date.now();
  await page.locator('input[type="file"]').first().setInputFiles(file);

  const status = page.locator('[role="status"]');
  let ok = true;
  try {
    await status
      .filter({ hasText: /^Listo$/ })
      .first()
      .waitFor({
        state: "visible",
        timeout: IMPORT_TIMEOUT_MS,
      });
  } catch {
    ok = false;
  }
  const readyAtMs = Date.now();

  await page.waitForTimeout(SETTLE_GRACE_MS);
  await sampler.sampleOnce();
  const { peak, perProcess } = windowPeak(
    sampler.samples,
    sampler.startedAtMs,
    importStartedAtMs,
    Date.now(),
  );

  return {
    ok,
    importStartedAtMs,
    readyAtMs,
    wallClockMs: readyAtMs - importStartedAtMs,
    stages: await readStages(page),
    peakBytes: peak,
    peakPerProcess: perProcess,
    baselineBytes: baseline.sumWorkingSetSizeBytes,
  };
}

/** El mismo flujo de cierre que `memoryProfile.closeDocument` — botón + confirmación, sin hooks. */
async function closeDocument(page: Page): Promise<void> {
  const closeButton = page.getByRole("button", { name: "Cerrar documento" });
  const confirmDialog = page.getByRole("dialog", { name: "Cerrar documento" });
  await closeButton.waitFor({ state: "visible", timeout: 30_000 });
  await closeButton.click();
  await confirmDialog.waitFor({ state: "visible" });
  await confirmDialog.getByRole("button", { name: "Cerrar documento" }).click();
  await confirmDialog.waitFor({ state: "hidden" });
}

test("externo — tiempo y memoria sobre un documento real", async () => {
  test.setTimeout(2_400_000);

  const target = requireEnv("ANONLY_EXT_TARGET"); // "repo" | "installed"
  const docKey = requireEnv("ANONLY_EXT_DOC"); // "R1" | "R2"
  const round = requireEnv("ANONLY_EXT_ROUND");
  const outputDir = requireEnv("ANONLY_EXT_OUTPUT_DIR");
  const docPath = requireEnv(docKey === "R1" ? "ANONLY_REAL_DOC_R1" : "ANONLY_REAL_DOC_R2");

  const file = {
    name: docKey === "R1" ? "r1.pdf" : "r2.pdf",
    mimeType: "application/pdf",
    buffer: await readFile(docPath),
  };

  const userDataDir = await mkdtemp(join(tmpdir(), "anonly-ext-"));
  const launchStartedAtMs = Date.now();
  let app: ElectronApplication;
  if (target === "installed") {
    app = await electron.launch({
      executablePath: requireEnv("ANONLY_EXT_EXE"),
      args: [`--user-data-dir=${userDataDir}`],
    });
  } else {
    app = await electron.launch({
      executablePath: REPO_ELECTRON_BIN,
      args: [SHELL_DIR, `--user-data-dir=${userDataDir}`],
    });
  }

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
    const appReadyMs = Date.now() - launchStartedAtMs;

    const sampler = startMemorySampling(app, 150);
    try {
      const first = await measureImport(page, file, sampler);
      await closeDocument(page);
      await page.waitForTimeout(REOPEN_GAP_MS);
      const reopened = await measureImport(page, file, sampler);

      await mkdir(outputDir, { recursive: true });
      await writeFile(
        resolve(outputDir, `ext-${target}-${docKey}-round${round}.json`),
        `${JSON.stringify(
          {
            target,
            docKey,
            round: Number(round),
            platform: process.platform,
            appReadyMs,
            reopenGapMs: REOPEN_GAP_MS,
            first,
            reopened,
          },
          null,
          2,
        )}\n`,
      );

      expect(first.ok, "la primera importación no llegó a Listo").toBe(true);
      expect(reopened.ok, "la reapertura no llegó a Listo").toBe(true);
    } finally {
      sampler.stop();
    }
  } finally {
    await app.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
