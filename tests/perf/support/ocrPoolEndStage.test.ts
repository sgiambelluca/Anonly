import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyTargets,
  type RawTargetHeapReading,
  type RawTargetWasmReading,
} from "./cdpHeap.js";
import { summarizeOcrEndStage } from "./ocrPoolEndStage.js";

function pool(size: number): {
  readonly heap: ReadonlyArray<RawTargetHeapReading>;
  readonly wasm: ReadonlyArray<RawTargetWasmReading>;
} {
  const identities = [
    { sessionId: "page", parentSessionId: undefined, url: "app://local/index.html" },
    ...Array.from({ length: size + 1 }, (_, index) => {
      const role = index === size ? "orientation-entry" : "entry-buildhash";
      return [
        { sessionId: `parent-${index}`, parentSessionId: "page", url: `app://local/${role}.js` },
        {
          sessionId: `child-${index}`,
          parentSessionId: `parent-${index}`,
          url: `blob:app://local/${index}`,
        },
      ];
    }).flat(),
  ].map((target, index) => ({
    ...target,
    attachedAtMs: index,
    type: target.sessionId === "page" ? "page" : "worker",
  }));
  return {
    heap: identities.map((target) => ({
      ...target,
      usedSizeBytes: 100,
      totalSizeBytes: 200,
      embedderHeapUsedSizeBytes: 0,
      backingStorageSizeBytes: 0,
      readError: undefined,
    })),
    wasm: identities.map((target) => ({
      ...target,
      memories: target.sessionId.startsWith("child-")
        ? [{ byteLengthBytes: 1000, shared: false }]
        : [],
      readError: undefined,
    })),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("OCR end-stage coverage", () => {
  it("binds hashed build chunks and counts each private recognizer separately", () => {
    vi.stubEnv("ANONLY_T5_FACTORY_CHUNKS", JSON.stringify({ "entry-buildhash.js": "ocr-entry" }));
    const { heap, wasm } = pool(4);
    expect(summarizeOcrEndStage(classifyTargets(wasm), classifyTargets(heap), 4)).toEqual({
      complete: true,
      lstmBytes: [1000, 1000, 1000, 1000],
      lstmTotalBytes: 4000,
      osdBytes: 1000,
      wasmTotalBytes: 5000,
      heapJsUsedBytes: 1100,
    });
  });

  it("rejects an unbound factory instead of guessing from memory size", () => {
    const { heap, wasm } = pool(3);
    expect(summarizeOcrEndStage(classifyTargets(wasm), classifyTargets(heap), 3).complete).toBe(
      false,
    );
  });

  it("rejects missing, timed-out, duplicated and shared recognizers", () => {
    vi.stubEnv("ANONLY_T5_FACTORY_CHUNKS", JSON.stringify({ "entry-buildhash.js": "ocr-entry" }));
    const { heap, wasm } = pool(3);
    const variants = [
      wasm.slice(0, -1),
      wasm.map((target) =>
        target.sessionId === "child-1"
          ? { ...target, memories: undefined, readError: "timeout" }
          : target,
      ),
      [...wasm, wasm[2]!],
      wasm.map((target) =>
        target.sessionId === "child-1"
          ? { ...target, memories: [{ byteLengthBytes: 1000, shared: true }] }
          : target,
      ),
    ];
    for (const variant of variants) {
      const summary = summarizeOcrEndStage(classifyTargets(variant), classifyTargets(heap), 3);
      expect(summary.complete).toBe(false);
      expect(summary.wasmTotalBytes).toBeNull();
      expect(summary.heapJsUsedBytes).toBeNull();
    }
  });
});
