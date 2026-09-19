/**
 * T-9 (`docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §2): diez open/close en
 * una sola instancia de Electron — el perfil P3 de ADR-146 §4.
 *
 * **No es el gate `test:leak`**: no afirma umbrales de memoria. Mide, escribe el
 * reporte y deja el veredicto de plan §2.5 calculado adentro, para que nadie lo
 * reinterprete mirando los números. Las aserciones solo verifican que la corrida
 * sea legible: los diez ciclos terminaron y el régimen fue el declarado.
 *
 * La corrida sale de `ANONLY_LEAK_RUN` (L1, L2 o L3, plan §2.3) y la salida de
 * `ANONLY_LEAK_OUTPUT_DIR`; las lanza `run-ciclos.sh`, en serie.
 */
import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile, type E2eFilePayload } from "../e2e/support/fixtures.js";
import { generateText50p } from "../fixtures/generate.js";

import {
  LEAK_CYCLE_COUNT,
  printLeakCyclesReport,
  runLeakCycles,
  writeLeakCyclesReport,
  type LeakRegime,
} from "./support/leakCycles.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";

interface LeakRun {
  readonly profile: string;
  readonly regime: LeakRegime;
  readonly file: () => Promise<E2eFilePayload>;
  readonly importTimeoutMs: number;
  readonly testTimeoutMs: number;
}

const RUNS: Readonly<Record<string, LeakRun>> = {
  L1: {
    profile: "p1-native-10p",
    regime: "chained",
    file: textTenPagesFile,
    importTimeoutMs: 180_000,
    testTimeoutMs: 900_000,
  },
  L2: {
    profile: "p2-scanned-50p",
    regime: "chained",
    file: async () =>
      getOrGenerateScannedFixture("p2-scanned-50p", new Uint8Array(await generateText50p())),
    importTimeoutMs: 300_000,
    testTimeoutMs: 1_800_000,
  },
  L3: {
    profile: "p1-native-10p",
    regime: "rested",
    file: textTenPagesFile,
    importTimeoutMs: 180_000,
    testTimeoutMs: 1_800_000,
  },
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} no está definido: esta spec se lanza desde run-ciclos.sh.`);
  }
  return value;
}

test("T-9 — diez open/close en una sola instancia", async ({
  page,
  electronApp,
  electronUserDataDir,
}) => {
  const runId = requireEnv("ANONLY_LEAK_RUN");
  const outputDir = requireEnv("ANONLY_LEAK_OUTPUT_DIR");
  const run = RUNS[runId];
  if (run === undefined) throw new Error(`ANONLY_LEAK_RUN desconocido: ${runId} (L1, L2 o L3).`);
  test.setTimeout(run.testTimeoutMs);

  // Fuera de la instancia medida: P2 se rasteriza en un Chromium aparte (ADR-146 §4).
  const file = await run.file();
  await openApp(page, "networkidle");

  const report = await runLeakCycles(
    page,
    electronApp,
    electronUserDataDir,
    runId,
    run.profile,
    file,
    run.regime,
    run.importTimeoutMs,
  );
  printLeakCyclesReport(report);
  await writeLeakCyclesReport(report, outputDir);

  const withDocs = report.cycles.filter((c) => c.cycle >= 1);
  expect(withDocs).toHaveLength(LEAK_CYCLE_COUNT);
  for (const c of withDocs) {
    expect(c.rest, `ciclo ${c.cycle}: ninguna muestra en la ventana de reposo`).not.toBeNull();
  }
});
