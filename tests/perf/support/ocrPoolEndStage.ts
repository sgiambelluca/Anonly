/** Test-only barrier: inspect the completed OCR pool before deterministic disposal. */
import type { Page, ElectronApplication } from "@playwright/test";

import type { E2eFilePayload } from "../../e2e/support/fixtures.js";

import {
  classifyTargets,
  connectCdpTargetSnapshotter,
  type CdpTargetSnapshotter,
  type ClassifiedTargetHeapSample,
  type ClassifiedTargetWasmSample,
} from "./cdpHeap.js";
import { startMemorySampling, type MemorySample } from "./memorySampler.js";

declare global {
  var __anonlyOcrEndStage:
    | { heldAtMs: number | null; releasedAtMs: number | null; release: () => void }
    | undefined;
}

export function summarizeOcrEndStage(
  wasm: ReadonlyArray<ClassifiedTargetWasmSample>,
  heap: ReadonlyArray<ClassifiedTargetHeapSample>,
  poolSize: number,
): {
  readonly complete: boolean;
  readonly lstmBytes: ReadonlyArray<number>;
  readonly lstmTotalBytes: number;
  readonly osdBytes: number | null;
  readonly wasmTotalBytes: number | null;
  readonly heapJsUsedBytes: number | null;
} {
  const lstm = wasm.filter((target) => target.label.endsWith("/tesseract-lstm"));
  const osd = wasm.filter((target) => target.label.endsWith("/tesseract-osd"));
  const privateMemory = (target: ClassifiedTargetWasmSample): boolean =>
    target.readError === undefined &&
    target.memories?.length === 1 &&
    target.memories[0]?.shared === false &&
    target.memories[0].byteLengthBytes > 0;
  const sameTargets =
    new Set(wasm.map((target) => target.sessionId)).size === wasm.length &&
    wasm.length === heap.length &&
    wasm.every((target) => heap.some((entry) => entry.sessionId === target.sessionId));
  const complete =
    sameTargets &&
    lstm.length === poolSize &&
    osd.length === 1 &&
    [...lstm, ...osd].every(privateMemory) &&
    wasm.every((target) => target.readError === undefined && target.memories !== undefined) &&
    heap.every((target) => target.readError === undefined && target.usedSizeBytes !== undefined);
  const lstmBytes = lstm.flatMap(
    (target) => target.memories?.map((memory) => memory.byteLengthBytes) ?? [],
  );
  return {
    complete,
    lstmBytes,
    lstmTotalBytes: lstmBytes.reduce((sum, bytes) => sum + bytes, 0),
    osdBytes: complete ? (osd[0]?.memories?.[0]?.byteLengthBytes ?? null) : null,
    wasmTotalBytes: complete
      ? wasm.reduce(
          (sum, target) =>
            sum +
            (target.memories ?? []).reduce((bytes, memory) => bytes + memory.byteLengthBytes, 0),
          0,
        )
      : null,
    heapJsUsedBytes: complete
      ? heap.reduce((sum, target) => sum + (target.usedSizeBytes ?? 0), 0)
      : null,
  };
}

export async function measureOcrEndStage(
  page: Page,
  app: ElectronApplication,
  userDataDir: string,
  file: E2eFilePayload,
  poolSize: number,
): Promise<{
  readonly heldAtMs: number;
  readonly releasedAtMs: number;
  readonly snapshots: ReadonlyArray<{
    readonly startedAtMs: number;
    readonly finishedAtMs: number;
    readonly rssBefore: MemorySample;
    readonly rssAfter: MemorySample;
    readonly summary: ReturnType<typeof summarizeOcrEndStage>;
    readonly wasm: ReadonlyArray<
      Pick<ClassifiedTargetWasmSample, "label" | "workerRole" | "memories" | "readError">
    >;
    readonly heap: ReadonlyArray<
      Pick<ClassifiedTargetHeapSample, "label" | "usedSizeBytes" | "readError">
    >;
  }>;
}> {
  await page.evaluate(() => {
    const core = globalThis.__anonlyCore as typeof globalThis.__anonlyCore & {
      readonly engines?: {
        readonly ocr?: { processSession: (...args: unknown[]) => Promise<unknown> };
      };
    };
    const ocr = core?.engines?.ocr;
    if (ocr === undefined) throw new Error("OCR instance missing in E2E build");
    const original = ocr.processSession;
    let resolveGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const state = {
      heldAtMs: null as number | null,
      releasedAtMs: null as number | null,
      release: (): void => {
        ocr.processSession = original;
        state.releasedAtMs = Date.now();
        resolveGate?.();
      },
    };
    globalThis.__anonlyOcrEndStage = state;
    ocr.processSession = async (...args: unknown[]): Promise<unknown> => {
      const result = await original.apply(ocr, args);
      state.heldAtMs = Date.now();
      await gate;
      return result;
    };
  });
  const rss = startMemorySampling(app, 150);
  let connection: CdpTargetSnapshotter | undefined;
  const snapshots: Array<{
    readonly startedAtMs: number;
    readonly finishedAtMs: number;
    readonly rssBefore: MemorySample;
    readonly rssAfter: MemorySample;
    readonly summary: ReturnType<typeof summarizeOcrEndStage>;
    readonly wasm: ReadonlyArray<
      Pick<ClassifiedTargetWasmSample, "label" | "workerRole" | "memories" | "readError">
    >;
    readonly heap: ReadonlyArray<
      Pick<ClassifiedTargetHeapSample, "label" | "usedSizeBytes" | "readError">
    >;
  }> = [];
  let heldAtMs = 0;
  let releasedAtMs = 0;
  try {
    connection = await connectCdpTargetSnapshotter(userDataDir);
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.waitForFunction(
      () => typeof globalThis.__anonlyOcrEndStage?.heldAtMs === "number",
      undefined,
      {
        timeout: 600_000,
      },
    );
    heldAtMs = await page.evaluate(() => globalThis.__anonlyOcrEndStage?.heldAtMs ?? 0);
    for (let index = 0; index < 3; index += 1) {
      const startedAtMs = Date.now();
      const rssBefore = await rss.sampleOnce();
      const [rawHeap, rawWasm] = await Promise.all([
        connection.snapshotHeapByTarget(true),
        connection.snapshotWasmByTarget(),
      ]);
      const heap = classifyTargets(rawHeap);
      const wasm = classifyTargets(rawWasm);
      const rssAfter = await rss.sampleOnce();
      snapshots.push({
        startedAtMs,
        finishedAtMs: Date.now(),
        rssBefore,
        rssAfter,
        summary: summarizeOcrEndStage(wasm, heap, poolSize),
        wasm: wasm.map(({ label, workerRole, memories, readError }) => ({
          label,
          workerRole,
          memories,
          readError,
        })),
        heap: heap.map(({ label, usedSizeBytes, readError }) => ({
          label,
          usedSizeBytes,
          readError,
        })),
      });
    }
  } finally {
    connection?.close();
    rss.stop();
    releasedAtMs = await page.evaluate(() => {
      globalThis.__anonlyOcrEndStage?.release();
      return globalThis.__anonlyOcrEndStage?.releasedAtMs ?? 0;
    });
  }
  await page.waitForFunction(
    () => typeof globalThis.__anonlyOcrPoolProbe?.readyAt === "number",
    undefined,
    {
      timeout: 600_000,
    },
  );
  return { heldAtMs, releasedAtMs, snapshots };
}
