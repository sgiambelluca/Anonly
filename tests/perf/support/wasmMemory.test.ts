import { describe, expect, it } from "vitest";

import type {
  CdpTargetSnapshotter,
  ClassifiedTargetHeapSample,
  ClassifiedTargetWasmSample,
} from "./cdpHeap.js";
import type { MemorySample } from "./memorySampler.js";
import {
  attributeWasmMemoryByOwner,
  classifyWasmOwner,
  computeHeapGcDelta,
  computeTesseractPageTrajectory,
  computeWasmInstantPoints,
  computeWasmMemoryTotal,
  readWasmHeapSample,
  wasmHeapSampleNear,
  wasmHeapSamplesBetween,
  wasmHeapSamplesSince,
  type WasmHeapSample,
} from "./wasmMemory.js";

const MB = 1_000_000;

function wasmTarget(
  overrides: Partial<ClassifiedTargetWasmSample> &
    Pick<ClassifiedTargetWasmSample, "sessionId" | "label">,
): ClassifiedTargetWasmSample {
  return {
    parentSessionId: undefined,
    type: "worker",
    url: "app://local/assets/entry-XXXX.js",
    attachedAtMs: 0,
    memories: [],
    readError: undefined,
    note: "",
    factoryChunk: "unknown",
    workerRole: "unknown",
    ...overrides,
  };
}

function heapTarget(
  overrides: Partial<ClassifiedTargetHeapSample> &
    Pick<ClassifiedTargetHeapSample, "sessionId" | "label">,
): ClassifiedTargetHeapSample {
  return {
    parentSessionId: undefined,
    type: "worker",
    url: "app://local/assets/entry-XXXX.js",
    attachedAtMs: 0,
    usedSizeBytes: 0,
    totalSizeBytes: 0,
    embedderHeapUsedSizeBytes: 0,
    backingStorageSizeBytes: 0,
    readError: undefined,
    note: "",
    factoryChunk: "unknown",
    workerRole: "unknown",
    ...overrides,
  };
}

function sample(atMs: number, byType: Record<string, number[]>): MemorySample {
  const perProcess = Object.entries(byType).flatMap(([type, sizes]) =>
    sizes.map((bytes, i) => ({ pid: i + 1, type, workingSetSizeBytes: bytes })),
  );
  return {
    atMs,
    sumWorkingSetSizeBytes: perProcess.reduce((acc, p) => acc + p.workingSetSizeBytes, 0),
    perProcess,
  };
}

function wasmHeapSample(
  atMs: number,
  wasmTargets: ReadonlyArray<ClassifiedTargetWasmSample>,
  heapTargets: ReadonlyArray<ClassifiedTargetHeapSample> = [],
): WasmHeapSample {
  return { atMs, heapTargets, wasmTargets };
}

describe("classifyWasmOwner", () => {
  it("distingue main, los tres sabores de Tesseract, NER y los workers sin hijos", () => {
    expect(classifyWasmOwner("main")).toBe("main");
    expect(classifyWasmOwner("main-2")).toBe("main");
    expect(classifyWasmOwner("ocr-worker-1/tesseract-lstm")).toBe("tesseract-lstm");
    expect(classifyWasmOwner("ocr-worker-1/tesseract-osd")).toBe("tesseract-osd");
    expect(classifyWasmOwner("ocr-orientation-worker-1")).toBe("ocr-orientation-osd");
    expect(classifyWasmOwner("ocr-orientation-worker-1/tesseract-osd")).toBe("ocr-orientation-osd");
    expect(classifyWasmOwner("thread-pool-worker-1")).toBe("ner");
    expect(classifyWasmOwner("thread-pool-worker-1/thread-0")).toBe("ner");
    expect(classifyWasmOwner("leaf-worker-1")).toBe("leaf-worker");
    // Estructuralmente es un motor de Tesseract (hijo de url de blob
    // distinta, cdpHeap.ts) cuyo chunk no se pudo nombrar LSTM/OSD — no es
    // "other" (ver docstring de `WasmMemoryOwner`).
    expect(classifyWasmOwner("unclassified-worker-1/child-0")).toBe("ocr-worker-unclassified");
    expect(classifyWasmOwner("algo-sin-patron-conocido")).toBe("other");
  });
});

describe("computeWasmMemoryTotal — deduplicado de memoria compartida", () => {
  it("cuenta una vez una memoria shared del mismo tamaño repetida en un pool de hilos", () => {
    const targets = [
      wasmTarget({
        sessionId: "ner",
        label: "thread-pool-worker-1",
        memories: [{ byteLengthBytes: 64 * MB, shared: true }],
      }),
      wasmTarget({
        sessionId: "ner-t0",
        label: "thread-pool-worker-1/thread-0",
        memories: [{ byteLengthBytes: 64 * MB, shared: true }],
      }),
      wasmTarget({
        sessionId: "ner-t1",
        label: "thread-pool-worker-1/thread-1",
        memories: [{ byteLengthBytes: 64 * MB, shared: true }],
      }),
    ];
    const total = computeWasmMemoryTotal(targets);
    expect(total.totalBytes).toBe(64 * MB);
    expect(total.components).toHaveLength(1);
    expect(total.components[0]?.targetLabels).toEqual([
      "thread-pool-worker-1",
      "thread-pool-worker-1/thread-0",
      "thread-pool-worker-1/thread-1",
    ]);
  });

  it("nunca deduplica memorias privadas, aunque coincidan en tamaño entre LSTM y OSD", () => {
    const targets = [
      wasmTarget({
        sessionId: "lstm",
        label: "ocr-worker-1/tesseract-lstm",
        memories: [{ byteLengthBytes: 30 * MB, shared: false }],
      }),
      wasmTarget({
        sessionId: "osd",
        label: "ocr-worker-1/tesseract-osd",
        memories: [{ byteLengthBytes: 30 * MB, shared: false }],
      }),
    ];
    const total = computeWasmMemoryTotal(targets);
    expect(total.totalBytes).toBe(60 * MB);
    expect(total.components).toHaveLength(2);
  });

  it("no deduplica dos memorias shared de tamaños distintos dentro del mismo pool", () => {
    const targets = [
      wasmTarget({
        sessionId: "ner",
        label: "thread-pool-worker-1",
        memories: [
          { byteLengthBytes: 64 * MB, shared: true },
          { byteLengthBytes: 8 * MB, shared: true },
        ],
      }),
      wasmTarget({
        sessionId: "ner-t0",
        label: "thread-pool-worker-1/thread-0",
        memories: [{ byteLengthBytes: 64 * MB, shared: true }],
      }),
    ];
    const total = computeWasmMemoryTotal(targets);
    expect(total.totalBytes).toBe(72 * MB);
    expect(total.components).toHaveLength(2);
  });

  it("ignora un target con readError, sin restarlo ni contarlo en cero", () => {
    const targets = [
      wasmTarget({
        sessionId: "busy",
        label: "leaf-worker-1",
        memories: undefined,
        readError: "timeout",
      }),
      wasmTarget({
        sessionId: "ok",
        label: "leaf-worker-2",
        memories: [{ byteLengthBytes: 5 * MB, shared: false }],
      }),
    ];
    expect(computeWasmMemoryTotal(targets).totalBytes).toBe(5 * MB);
  });
});

describe("attributeWasmMemoryByOwner", () => {
  it("suma por dueño y deja fuera a los dueños con cero", () => {
    const targets = [
      wasmTarget({
        sessionId: "main",
        label: "main",
        memories: [{ byteLengthBytes: 2 * MB, shared: false }],
      }),
      wasmTarget({
        sessionId: "lstm",
        label: "ocr-worker-1/tesseract-lstm",
        memories: [{ byteLengthBytes: 30 * MB, shared: false }],
      }),
      wasmTarget({
        sessionId: "osd",
        label: "ocr-worker-1/tesseract-osd",
        memories: [{ byteLengthBytes: 4 * MB, shared: false }],
      }),
      wasmTarget({ sessionId: "leaf", label: "leaf-worker-1", memories: [] }),
    ];
    const byOwner = attributeWasmMemoryByOwner(targets);
    expect(byOwner).toEqual([
      { owner: "main", totalBytes: 2 * MB, targetLabels: ["main"] },
      {
        owner: "tesseract-lstm",
        totalBytes: 30 * MB,
        targetLabels: ["ocr-worker-1/tesseract-lstm"],
      },
      { owner: "tesseract-osd", totalBytes: 4 * MB, targetLabels: ["ocr-worker-1/tesseract-osd"] },
    ]);
  });

  it("una memoria compartida de NER aparece una sola vez bajo el dueño ner, aunque tenga varios targets", () => {
    const targets = [
      wasmTarget({
        sessionId: "ner",
        label: "thread-pool-worker-1",
        memories: [{ byteLengthBytes: 64 * MB, shared: true }],
      }),
      wasmTarget({
        sessionId: "ner-t0",
        label: "thread-pool-worker-1/thread-0",
        memories: [{ byteLengthBytes: 64 * MB, shared: true }],
      }),
    ];
    expect(attributeWasmMemoryByOwner(targets)).toEqual([
      {
        owner: "ner",
        totalBytes: 64 * MB,
        targetLabels: ["thread-pool-worker-1", "thread-pool-worker-1/thread-0"],
      },
    ]);
  });
});

describe("wasmHeapSampleNear/Between/Since", () => {
  const samples = [wasmHeapSample(0, []), wasmHeapSample(1_000, []), wasmHeapSample(2_000, [])];

  it("near devuelve la muestra mas cercana, y undefined con la serie vacia", () => {
    expect(wasmHeapSampleNear(samples, 900)?.atMs).toBe(1_000);
    expect(wasmHeapSampleNear([], 100)).toBeUndefined();
  });

  it("between es inclusivo en los dos extremos", () => {
    expect(wasmHeapSamplesBetween(samples, 1_000, 2_000)).toHaveLength(2);
  });

  it("since es estrictamente posterior", () => {
    expect(wasmHeapSamplesSince(samples, 1_000)).toEqual([wasmHeapSample(2_000, [])]);
  });
});

describe("computeTesseractPageTrajectory", () => {
  it("toma la lectura mas cercana a cada pagina y filtra a los tres dueños de Tesseract", () => {
    const wasmSamples = [
      wasmHeapSample(0, [
        wasmTarget({
          sessionId: "lstm",
          label: "ocr-worker-1/tesseract-lstm",
          memories: [{ byteLengthBytes: 10 * MB, shared: false }],
        }),
        wasmTarget({
          sessionId: "ner",
          label: "thread-pool-worker-1",
          memories: [{ byteLengthBytes: 64 * MB, shared: true }],
        }),
      ]),
      wasmHeapSample(1_000, [
        wasmTarget({
          sessionId: "lstm",
          label: "ocr-worker-1/tesseract-lstm",
          memories: [{ byteLengthBytes: 15 * MB, shared: false }],
        }),
      ]),
    ];
    const trajectory = computeTesseractPageTrajectory(
      [
        { pageIndex: 1, atMs: 900 },
        { pageIndex: 0, atMs: 50 },
      ],
      wasmSamples,
    );
    expect(trajectory.map((p) => p.pageIndex)).toEqual([0, 1]);
    expect(trajectory[0]?.byTarget).toEqual({ "ocr-worker-1/tesseract-lstm": 10 * MB });
    expect(trajectory[1]?.byTarget).toEqual({ "ocr-worker-1/tesseract-lstm": 15 * MB });
  });

  it("una pagina sin ninguna muestra de WASM cerca reporta un byTarget vacio, no un error", () => {
    const trajectory = computeTesseractPageTrajectory([{ pageIndex: 0, atMs: 0 }], []);
    expect(trajectory[0]?.byTarget).toEqual({});
    expect(trajectory[0]?.lagMs).toBeUndefined();
  });
});

describe("computeHeapGcDelta", () => {
  it("empareja por sessionId y calcula el delta despues menos antes", () => {
    const before = [
      heapTarget({
        sessionId: "a",
        label: "main",
        usedSizeBytes: 20 * MB,
        backingStorageSizeBytes: 20 * MB,
      }),
    ];
    const after = [
      heapTarget({
        sessionId: "a",
        label: "main",
        usedSizeBytes: 3 * MB,
        backingStorageSizeBytes: 0,
      }),
    ];
    const delta = computeHeapGcDelta(before, after);
    expect(delta).toEqual([
      {
        sessionId: "a",
        label: "main",
        beforeBytes: 40 * MB,
        afterBytes: 3 * MB,
        deltaBytes: -37 * MB,
      },
    ]);
  });

  it("un target con readError en cualquiera de los dos lados da bytes undefined, no cero", () => {
    const before = [heapTarget({ sessionId: "a", label: "main", readError: "ocupado" })];
    const after = [heapTarget({ sessionId: "a", label: "main", usedSizeBytes: 1 * MB })];
    const delta = computeHeapGcDelta(before, after)[0];
    expect(delta?.beforeBytes).toBeUndefined();
    expect(delta?.deltaBytes).toBeUndefined();
  });

  it("un target que solo aparece de un lado (desapareció al cerrar) se reporta igual, sin inventar el otro lado", () => {
    const before = [
      heapTarget({ sessionId: "gone", label: "ocr-worker-1", usedSizeBytes: 5 * MB }),
    ];
    const delta = computeHeapGcDelta(before, [])[0];
    expect(delta?.sessionId).toBe("gone");
    expect(delta?.afterBytes).toBeUndefined();
    expect(delta?.deltaBytes).toBeUndefined();
  });
});

describe("computeWasmInstantPoints", () => {
  const rssSamplerStartedAtMs = 1_000_000;
  const wasmSamplerStartedAtMs = 1_000_500;

  const rssSamples: ReadonlyArray<MemorySample> = [
    sample(0, { Tab: [500 * MB] }),
    sample(2_000, { Tab: [900 * MB] }),
  ];
  const wasmSamples: ReadonlyArray<WasmHeapSample> = [
    wasmHeapSample(
      1_500,
      [
        wasmTarget({
          sessionId: "lstm",
          label: "ocr-worker-1/tesseract-lstm",
          memories: [{ byteLengthBytes: 40 * MB, shared: false }],
        }),
      ],
      [heapTarget({ sessionId: "main", label: "main", usedSizeBytes: 10 * MB })],
    ),
  ];

  it("combina RSS del Tab, WASM deduplicado y heap de JS en el instante mas cercano", () => {
    const points = computeWasmInstantPoints(
      [{ event: "OCR_FINISHED", epochMs: rssSamplerStartedAtMs + 2_000 }],
      rssSamples,
      rssSamplerStartedAtMs,
      wasmSamples,
      wasmSamplerStartedAtMs,
    );
    const point = points[0];
    expect(point?.rssTabBytes).toBe(900 * MB);
    expect(point?.wasmTotalBytes).toBe(40 * MB);
    expect(point?.heapAttributedBytes).toBe(10 * MB);
    expect(point?.combinedAttributedBytes).toBe(50 * MB);
    expect(point?.stillUnattributedBytes).toBe(850 * MB);
    expect(point?.byOwner).toEqual([
      {
        owner: "tesseract-lstm",
        totalBytes: 40 * MB,
        targetLabels: ["ocr-worker-1/tesseract-lstm"],
      },
    ]);
  });

  it("ordena los instantes por epochMs, no por el orden de entrada", () => {
    const points = computeWasmInstantPoints(
      [
        { event: "SEGUNDO", epochMs: rssSamplerStartedAtMs + 2_000 },
        { event: "PRIMERO", epochMs: rssSamplerStartedAtMs },
      ],
      rssSamples,
      rssSamplerStartedAtMs,
      wasmSamples,
      wasmSamplerStartedAtMs,
    );
    expect(points.map((p) => p.event)).toEqual(["PRIMERO", "SEGUNDO"]);
  });

  it("sin ninguna muestra de WASM cerca, los campos derivados quedan undefined en vez de fabricar un cero", () => {
    const points = computeWasmInstantPoints(
      [{ event: "SOLO", epochMs: rssSamplerStartedAtMs }],
      rssSamples,
      rssSamplerStartedAtMs,
      [],
      wasmSamplerStartedAtMs,
    );
    const point = points[0];
    expect(point?.wasmTotalBytes).toBeUndefined();
    expect(point?.combinedAttributedBytes).toBeUndefined();
    expect(point?.stillUnattributedBytes).toBeUndefined();
    expect(point?.byOwner).toEqual([]);
  });

  describe("partial — targets sin lectura en el instante", () => {
    it("un hilo pthread de NER sin lectura NO vuelve parcial el punto si su padre sí se leyó", () => {
      const samplesWithUnreadableThread: ReadonlyArray<WasmHeapSample> = [
        wasmHeapSample(1_500, [
          wasmTarget({
            sessionId: "ner",
            label: "thread-pool-worker-1",
            memories: [{ byteLengthBytes: 64 * MB, shared: true }],
          }),
          wasmTarget({
            sessionId: "ner-t0",
            label: "thread-pool-worker-1/thread-0",
            memories: undefined,
            readError: "sin respuesta de CDP en 400ms",
          }),
        ]),
      ];
      const points = computeWasmInstantPoints(
        [{ event: "OCR_FINISHED", epochMs: rssSamplerStartedAtMs + 2_000 }],
        rssSamples,
        rssSamplerStartedAtMs,
        samplesWithUnreadableThread,
        wasmSamplerStartedAtMs,
      );
      expect(points[0]?.unreadableWasmTargetLabels).toEqual(["thread-pool-worker-1/thread-0"]);
      expect(points[0]?.partial).toBe(false);
    });

    it("cualquier otro target sin lectura (el propio worker de NER, no un hilo) SI vuelve parcial el punto", () => {
      const samplesWithUnreadableParent: ReadonlyArray<WasmHeapSample> = [
        wasmHeapSample(1_500, [
          wasmTarget({
            sessionId: "ner",
            label: "thread-pool-worker-1",
            memories: undefined,
            readError: "sin respuesta de CDP en 400ms",
          }),
        ]),
      ];
      const points = computeWasmInstantPoints(
        [{ event: "NER_MODEL_READY", epochMs: rssSamplerStartedAtMs + 2_000 }],
        rssSamples,
        rssSamplerStartedAtMs,
        samplesWithUnreadableParent,
        wasmSamplerStartedAtMs,
      );
      expect(points[0]?.unreadableWasmTargetLabels).toEqual(["thread-pool-worker-1"]);
      expect(points[0]?.partial).toBe(true);
    });

    it("un target de heap sin lectura tambien dispara partial, aunque WASM haya leido todo bien", () => {
      const samples: ReadonlyArray<WasmHeapSample> = [
        wasmHeapSample(
          1_500,
          [wasmTarget({ sessionId: "lstm", label: "ocr-worker-1/tesseract-lstm", memories: [] })],
          [heapTarget({ sessionId: "main", label: "main", readError: "ocupado" })],
        ),
      ];
      const points = computeWasmInstantPoints(
        [{ event: "OCR_FINISHED", epochMs: rssSamplerStartedAtMs + 2_000 }],
        rssSamples,
        rssSamplerStartedAtMs,
        samples,
        wasmSamplerStartedAtMs,
      );
      expect(points[0]?.unreadableWasmTargetLabels).toEqual([]);
      expect(points[0]?.unreadableHeapTargetLabels).toEqual(["main"]);
      expect(points[0]?.partial).toBe(true);
    });

    it("sin ningun readError, partial es false y las listas quedan vacias", () => {
      const points = computeWasmInstantPoints(
        [{ event: "OCR_FINISHED", epochMs: rssSamplerStartedAtMs + 2_000 }],
        rssSamples,
        rssSamplerStartedAtMs,
        wasmSamples,
        wasmSamplerStartedAtMs,
      );
      expect(points[0]?.partial).toBe(false);
      expect(points[0]?.unreadableWasmTargetLabels).toEqual([]);
      expect(points[0]?.unreadableHeapTargetLabels).toEqual([]);
    });
  });
});

describe("readWasmHeapSample — orden de lectura antes/despues de GC", () => {
  /** Conexión falsa que registra en qué orden empieza y termina cada lectura — para probar secuencia sin CDP real. */
  function fakeConnection(
    log: string[],
    delaysMs: { readonly heap?: number; readonly wasm?: number } = {},
  ): CdpTargetSnapshotter {
    return {
      async snapshotHeapByTarget(forceGc?: boolean) {
        log.push(`heap-start:${String(forceGc)}`);
        await new Promise((r) => setTimeout(r, delaysMs.heap ?? 0));
        log.push(`heap-end:${String(forceGc)}`);
        return [];
      },
      async snapshotWasmByTarget() {
        log.push("wasm-start");
        await new Promise((r) => setTimeout(r, delaysMs.wasm ?? 0));
        log.push("wasm-end");
        return [];
      },
      close() {
        // nada que cerrar en la conexión falsa
      },
    };
  }

  it("con forceGc=false, heap termina ANTES de que arranque la lectura de WASM — nunca en paralelo", async () => {
    const log: string[] = [];
    // La lectura de heap tarda más que la de WASM a propósito: si corrieran
    // en paralelo, "wasm-start" aparecería antes de "heap-end" en el log.
    await readWasmHeapSample(fakeConnection(log, { heap: 20, wasm: 0 }), false, 0);
    expect(log).toEqual(["heap-start:false", "heap-end:false", "wasm-start", "wasm-end"]);
  });

  it("con forceGc=true, las dos lecturas se solapan (Promise.all)", async () => {
    const log: string[] = [];
    await readWasmHeapSample(fakeConnection(log, { heap: 20, wasm: 0 }), true, 0);
    // wasm-start tiene que aparecer ANTES de heap-end: prueba que van en
    // paralelo, no una después de la otra.
    expect(log.indexOf("wasm-start")).toBeLessThan(log.indexOf("heap-end:true"));
  });
});
