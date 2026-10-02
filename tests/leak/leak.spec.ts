import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile, type E2eFilePayload } from "../e2e/support/fixtures.js";
import { generateText50p } from "../fixtures/generate.js";
import {
  LEAK_CYCLE_COUNT,
  printLeakCyclesReport,
  runLeakCycles,
  writeLeakCyclesReport,
  type LeakRegime,
} from "../perf/support/leakCycles.js";
import { getOrGenerateScannedFixture } from "../perf/support/scannedFixtureCache.js";

import { leakGateFailures } from "./leakGate.js";

const REPORT_DIR = resolve(process.cwd(), ".measure/leak");
let scannedFile: E2eFilePayload;

test.beforeAll(async () => {
  await mkdir(REPORT_DIR, { recursive: true });
  // Rasterization uses its own Chromium and finishes before any measured Electron is launched.
  scannedFile = await getOrGenerateScannedFixture(
    "p2-scanned-50p",
    new Uint8Array(await generateText50p()),
  );
});

interface LeakCase {
  readonly id: "L1" | "L2" | "L3";
  readonly profile: string;
  readonly regime: LeakRegime;
  readonly file: () => Promise<E2eFilePayload>;
  readonly importTimeoutMs: number;
  readonly testTimeoutMs: number;
}

const CASES: ReadonlyArray<LeakCase> = [
  {
    id: "L1",
    profile: "p1-native-10p",
    regime: "chained",
    file: textTenPagesFile,
    importTimeoutMs: 180_000,
    testTimeoutMs: 900_000,
  },
  {
    id: "L2",
    profile: "p2-scanned-50p",
    regime: "chained",
    file: async () => scannedFile,
    importTimeoutMs: 300_000,
    testTimeoutMs: 1_800_000,
  },
  {
    id: "L3",
    profile: "p1-native-10p",
    regime: "rested",
    file: textTenPagesFile,
    importTimeoutMs: 180_000,
    testTimeoutMs: 2_100_000,
  },
];

for (const leakCase of CASES) {
  test(`${leakCase.id} — ${leakCase.profile}, ${leakCase.regime}`, async ({
    page,
    electronApp,
    electronUserDataDir,
  }) => {
    test.setTimeout(leakCase.testTimeoutMs);
    await openApp(page);
    const report = await runLeakCycles(
      page,
      electronApp,
      electronUserDataDir,
      leakCase.id,
      leakCase.profile,
      await leakCase.file(),
      leakCase.regime,
      leakCase.importTimeoutMs,
    );
    printLeakCyclesReport(report);
    await writeLeakCyclesReport(report, REPORT_DIR);

    expect(report.cycles, "Debe persistir el baseline y los diez ciclos").toHaveLength(
      LEAK_CYCLE_COUNT + 1,
    );
    expect(leakGateFailures(report, leakCase.regime)).toEqual([]);
  });
}
