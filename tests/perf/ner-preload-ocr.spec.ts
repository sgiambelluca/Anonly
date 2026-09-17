import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";

import { measureProfile, type ProfileReport } from "./support/memoryProfile.js";
import {
  captureNerPreloadProbe,
  installNerPreloadProbe,
  type NerPreloadMode,
} from "./support/nerPreloadProbe.js";
import { installTimeCollector } from "./support/timeProfile.js";

type Profile = "p1" | "p2";
const FIXTURES = {
  p1: resolve(process.cwd(), ".measure/fixtures/text-10p-frozen.pdf"),
  p2: resolve(process.cwd(), ".measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf"),
} as const;
const EXPECTED = {
  p1: "b96b0c00b645bca1cd991deb248f499da132155723e96c8144f35bfd4c5a9824",
  p2: "26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f",
} as const;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
test.describe("precarga NER durante OCR, campaña opt-in", () => {
  test.skip(process.env.ANONLY_NER_PRELOAD_OCR !== "1", "campaña opt-in");

  test("frío y caliente con RSS, tiempos y calidad", async ({
    page,
    electronApp,
    electronUserDataDir,
  }, testInfo) => {
    const profile = process.env.ANONLY_NER_PRELOAD_PROFILE as Profile | undefined;
    const mode = process.env.ANONLY_NER_PRELOAD_MODE as NerPreloadMode | undefined;
    const outputRoot = process.env.ANONLY_NER_PRELOAD_OUTPUT_DIR;
    if (profile !== "p1" && profile !== "p2") throw new Error("ANONLY_NER_PRELOAD_PROFILE=p1|p2");
    if (mode !== "baseline" && mode !== "b1" && mode !== "b2")
      throw new Error("ANONLY_NER_PRELOAD_MODE=baseline|b1|b2");
    if (outputRoot === undefined) throw new Error("ANONLY_NER_PRELOAD_OUTPUT_DIR requerida");

    const index = testInfo.repeatEachIndex;
    const reportPath = resolve(outputRoot, `${profile}-${mode}-run${index}.json`);
    await requireNew(reportPath);
    const fixturePath = FIXTURES[profile];
    const bytes = await readFile(fixturePath);
    expect(digestBytes(bytes)).toBe(EXPECTED[profile]);

    await openApp(page, "networkidle");
    const file = { name: `${profile}-frozen.pdf`, mimeType: "application/pdf", buffer: bytes };
    const probePaths = {
      cold: resolve(outputRoot, `${profile}-${mode}-run${index}-cold-preload.json`),
      hot: resolve(outputRoot, `${profile}-${mode}-run${index}-hot-preload.json`),
    } as const;
    const qualityPaths = {
      cold: resolve(outputRoot, `${profile}-${mode}-run${index}-cold-quality.json`),
      hot: resolve(outputRoot, `${profile}-${mode}-run${index}-hot-quality.json`),
    } as const;
    for (const path of Object.values(probePaths)) await requireNew(path);
    for (const path of Object.values(qualityPaths)) await requireNew(path);
    const install = async (runPage: typeof page): Promise<void> =>
      installNerPreloadProbe(runPage, mode);
    const report = await measureProfile(
      page,
      electronApp,
      electronUserDataDir,
      `ner-preload-${profile}-${mode}`,
      file,
      profile === "p2" ? 1_800_000 : 180_000,
      [install, installTimeCollector],
      async (runPage, temperature) => {
        await captureNerPreloadProbe(runPage, probePaths[temperature]);
        const timeRun = await runPage.evaluate(() => {
          const root = globalThis as typeof globalThis & { __anonlyTimeRun?: unknown };
          return root.__anonlyTimeRun ?? null;
        });
        await writeFile(qualityPaths[temperature], `${JSON.stringify(timeRun, null, 2)}\n`);
      },
    );

    const quality = (run: ProfileReport["cold"]) =>
      digest({
        ocrPages: [...(run.ocrPages ?? [])].sort((a, b) => a.pageIndex - b.pageIndex),
        ocrWords: [...(run.ocrWords ?? [])]
          .sort((a, b) => a.pageIndex - b.pageIndex)
          .map((page) => ({
            pageIndex: page.pageIndex,
            words: [...page.words].map((word) => ({
              text: word.text,
              bbox: word.bbox,
              confidence: word.confidence,
            })),
          })),
        entityCount: run.entityCount,
        groupCount: run.groupCount,
      });
    const output = {
      profile,
      mode,
      fixtureSha256: digestBytes(bytes),
      capturedAt: new Date().toISOString(),
      cold: { ...report.cold, qualityFingerprint: quality(report.cold) },
      hot: { ...report.hot, qualityFingerprint: quality(report.hot) },
    };
    await mkdir(resolve(outputRoot), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`);

    expect(report.cold.ok).toBe(true);
    expect(report.hot.ok).toBe(true);
    expect(report.cold.groupCount).toBeGreaterThan(0);
    expect(report.hot.groupCount).toBeGreaterThan(0);
  });
});
