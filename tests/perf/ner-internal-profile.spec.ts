import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import {
  closeTimedDocument,
  fixtureInfo,
  hostIdentity,
  runTimedImport,
  type TimeReport,
  writeTimeReport,
} from "./support/timeProfile.js";

type Profile = "p1" | "p2";
type Mode = "baseline" | "probe";

const FIXTURES = {
  p1: resolve(process.cwd(), ".measure/fixtures/text-10p-frozen.pdf"),
  p2: resolve(process.cwd(), ".measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf"),
} as const;
const EXPECTED = {
  p1: {
    fixture: "b96b0c00b645bca1cd991deb248f499da132155723e96c8144f35bfd4c5a9824",
    entities: 14,
    groups: 14,
  },
  p2: {
    fixture: "26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f",
    ocr: "c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49",
    detection: "327c988dd2622c4fd69b47a37d424b7704e2ec92449ada99834323de39abf9c8",
    entities: 13,
    groups: 11,
  },
} as const;

function isProbe(value: unknown): value is { readonly batches: ReadonlyArray<unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "batches" in value &&
    Array.isArray(value.batches)
  );
}

async function requireNew(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`No se sobrescribe evidencia: ${path}`);
}

test.setTimeout(2_100_000);
test.describe("NER interno, campaña opt-in", () => {
  test.skip(process.env.ANONLY_NER_PROFILE !== "1", "campaña opt-in");

  test("fixture congelado, frío y caliente en una sesión", async ({ page }, testInfo) => {
    const profile = process.env.ANONLY_NER_FIXTURE as Profile | undefined;
    const mode = process.env.ANONLY_NER_MODE as Mode | undefined;
    const root = process.env.ANONLY_NER_OUTPUT_DIR;
    if (profile !== "p1" && profile !== "p2") throw new Error("ANONLY_NER_FIXTURE=p1|p2");
    if (mode !== "baseline" && mode !== "probe") throw new Error("ANONLY_NER_MODE=baseline|probe");
    if (root === undefined) throw new Error("ANONLY_NER_OUTPUT_DIR requerida");

    const output = resolve(root, `${profile}-${mode}-run${testInfo.repeatEachIndex}.json`);
    await requireNew(output);
    const path = FIXTURES[profile];
    const bytes = await readFile(path);
    const info = fixtureInfo(path, bytes);
    expect(info.sha256).toBe(EXPECTED[profile].fixture);

    await installEngineOverrides(page, {
      workerPool: { pdfPoolSize: 4, ocrPoolSize: 2, nerPoolSize: 2, renderPoolSize: 4 },
    });
    await openApp(page, "networkidle");
    const file = { name: `${profile}-frozen.pdf`, mimeType: "application/pdf", buffer: bytes };
    const timeout = profile === "p2" ? 1_800_000 : 180_000;
    const cold = await runTimedImport(page, file, "cold", timeout);
    await closeTimedDocument(page);
    const hot = await runTimedImport(page, file, "hot", timeout);
    await closeTimedDocument(page);

    const report: TimeReport & { readonly mode: Mode } = {
      profile,
      mode,
      fixture: info,
      identity: hostIdentity(),
      cold,
      hot,
      capturedAt: new Date().toISOString(),
    };
    await writeTimeReport(report, output);

    for (const run of [cold, hot]) {
      expect(run.ok).toBe(true);
      expect(run.entityCount).toBe(EXPECTED[profile].entities);
      expect(run.groupCount).toBe(EXPECTED[profile].groups);
      expect(run.intervalsMs.nerMs).toBeGreaterThan(0);
      if (profile === "p2") {
        expect(run.ocrFingerprint).toBe(EXPECTED.p2.ocr);
        expect(run.detectionFingerprint).toBe(EXPECTED.p2.detection);
      }
      if (mode === "baseline") {
        expect(run.nerProbe).toBeNull();
      } else {
        expect(isProbe(run.nerProbe)).toBe(true);
        if (!isProbe(run.nerProbe)) throw new Error("Probe NER ausente");
        expect(run.nerProbe.batches.length).toBeGreaterThan(0);
        for (const batch of run.nerProbe.batches) {
          expect(batch).toMatchObject({
            dispatchMs: expect.any(Number),
            worker: {
              phase: "__nerProbe",
              modelLoadMs: expect.any(Number),
              classifyMs: expect.any(Number),
            },
          });
        }
      }
    }
    expect(cold.qualityFingerprint).toBe(hot.qualityFingerprint);
  });
});
