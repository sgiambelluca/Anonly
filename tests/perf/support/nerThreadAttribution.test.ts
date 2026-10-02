import { describe, expect, it } from "vitest";

import { observedNerThreadCount, type NerThreadSample } from "./nerThreadAttribution.js";

function sample(
  targets: ReadonlyArray<{
    readonly label: string;
    readonly url?: string;
    readonly shared?: boolean;
  }>,
): NerThreadSample {
  return {
    wasmTargets: targets.map((target) => ({
      label: target.label,
      url: target.url ?? "blob:ner-worker",
      memories: [{ shared: target.shared ?? true }],
    })),
  };
}

describe("observedNerThreadCount", () => {
  it("counts only shared-memory pthreads under a confirmed ONNX root", () => {
    const result = observedNerThreadCount([
      sample([
        { label: "thread-pool-worker-1", url: "blob:onnx" },
        { label: "thread-pool-worker-1/thread-0", url: "blob:onnx", shared: false },
        { label: "thread-pool-worker-1/thread-1", url: "blob:onnx", shared: false },
        { label: "unclassified-worker-1", url: "blob:tesseract", shared: false },
        { label: "unclassified-worker-1/child-0", url: "blob:tesseract", shared: false },
      ]),
    ]);

    expect(result).toEqual({ effectiveThreads: 3, ownerUrls: ["blob:onnx"] });
  });

  it("returns no observation for private or unreadable worker roots", () => {
    const result = observedNerThreadCount([
      sample([
        { label: "unclassified-worker-1", url: "blob:tesseract", shared: false },
        { label: "unclassified-worker-1/child-0", url: "blob:tesseract", shared: false },
        { label: "thread-pool-worker-2", url: "blob:unknown", shared: false },
        { label: "thread-pool-worker-2/thread-0", url: "blob:unknown", shared: false },
      ]),
    ]);

    expect(result).toBeNull();
  });

  it("accepts an unclassified root only when it exposes shared WASM memory", () => {
    const result = observedNerThreadCount([
      sample([
        { label: "unclassified-worker-1", url: "blob:wasm", shared: true },
        { label: "unclassified-worker-1/child-0", url: "blob:wasm", shared: false },
      ]),
    ]);

    expect(result).toEqual({ effectiveThreads: 2, ownerUrls: ["blob:wasm"] });
  });

  it("reports the maximum confirmed pool size across samples", () => {
    const result = observedNerThreadCount([
      sample([
        { label: "thread-pool-worker-1", url: "blob:onnx-a" },
        { label: "thread-pool-worker-1/thread-0", url: "blob:onnx-a" },
      ]),
      sample([
        { label: "thread-pool-worker-2", url: "blob:onnx-b" },
        { label: "thread-pool-worker-2/thread-0", url: "blob:onnx-b" },
        { label: "thread-pool-worker-2/thread-1", url: "blob:onnx-b" },
      ]),
    ]);

    expect(result).toEqual({ effectiveThreads: 3, ownerUrls: ["blob:onnx-b"] });
  });
});
