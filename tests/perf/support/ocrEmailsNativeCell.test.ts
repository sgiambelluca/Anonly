import { describe, expect, it } from "vitest";

import type { Job } from "./adr190Dpi.js";
import { buildSyntheticSource } from "./ocrDpiDownFixtures.js";
import {
  DEFAULT_OCR_DPI,
  buildNativeCellRecord,
  pageTextsOf,
  type NativeCellObservation,
} from "./ocrEmailsNativeCell.js";
import { DEFAULT_MAX_LIVE_IMAGE_BYTES } from "./ocrPoolArms.js";

function ocrJob(dpi: number, jobId = "a"): Job {
  return {
    worker: 1,
    jobId,
    jobType: "ocr-page",
    documentId: "d",
    pageIndex: 0,
    startedAt: 1,
    finishedAt: 2,
    dpi,
    orientation: 0,
    upscale: 1,
    widthPx: 10,
    heightPx: 10,
    imageBytes: 1,
    terminal: "COMPLETED",
    result: {},
    error: null,
  };
}
const osdJob: Job = {
  ...ocrJob(0, "osd"),
  jobType: "ocr-orient",
  dpi: null,
  result: { orientation: 0, inkRatio: 0.2 },
};

const GOOD_CONFIG = {
  ocrDpi: DEFAULT_OCR_DPI,
  ocrPoolSize: 1,
  maxLiveImageBytes: DEFAULT_MAX_LIVE_IMAGE_BYTES,
  nerEnabled: true,
};

function observation(
  dispatchDpi: number,
  cap: number,
  words: NativeCellObservation["words"],
  entities: NativeCellObservation["entities"],
  patch: Partial<NativeCellObservation> = {},
): NativeCellObservation {
  return {
    ready: true,
    pipelineFailure: null,
    capture: { jobs: [osdJob, ocrJob(dispatchDpi)], issues: [] },
    caps: [{ pageIndex: 0, originalCap: cap }],
    ocrPageEvents: [],
    entities,
    words,
    nerFinished: true,
    config: GOOD_CONFIG,
    ...patch,
  };
}

const raw = (entityType: string, value: string, pageIndex = 0) => ({
  entityType,
  value,
  pageIndex,
  bbox: { x: 0, y: 0, width: 50, height: 10 },
});

describe("pageTextsOf", () => {
  it("junta las palabras de cada página, en orden, con espacios", () => {
    const texts = pageTextsOf([
      { pageIndex: 1, text: "c" },
      { pageIndex: 0, text: "a" },
      { pageIndex: 0, text: "b" },
    ]);
    expect(texts.get(0)).toBe("a b");
    expect(texts.get(1)).toBe("c");
  });
});

describe("buildNativeCellRecord", () => {
  it("clasifica el email perdido, cuenta los candidatos con forma Q y registra el DPI nativo efectivo", async () => {
    const { truth } = await buildSyntheticSource("S10");
    const emails = truth.entities.filter((entity) => entity.type === "EMAIL");
    expect(emails.length).toBeGreaterThan(0);
    const lostOne = emails[0];
    if (lostOne === undefined) throw new Error("sin emails");
    const found = truth.entities.filter((entity) => entity !== lostOne);
    const misread = lostOne.value.replace("@", "Q");
    const result = buildNativeCellRecord({
      corpus: "S10",
      sha256: "abc",
      truth,
      nativeDpi: 200,
      repetition: 1,
      observation: observation(
        200,
        200,
        [
          { pageIndex: 0, text: "Escribir" },
          { pageIndex: 0, text: misread },
          { pageIndex: 0, text: "ajenoQotro.net" },
        ],
        found.map((entity) => raw(entity.type, entity.value)),
      ),
    });
    expect(result.valid).toBe(true);
    expect(result.invalidReasons).toEqual([]);
    expect(result.emails.missed).toBe(1);
    expect(result.emails.lost).toEqual([
      { pageIndex: 0, expected: lostOne.value, reading: "at-as-q", fragment: misread },
    ]);
    expect(result.emails.readingCounts["at-as-q"]).toBe(1);
    expect(result.tolerantRule.counts).toEqual({
      total: 2,
      recoverable: 1,
      partialOfTruth: 0,
      unrelated: 1,
    });
    expect(result.nativeDpiEvidence).toEqual({
      pageCaps: [200],
      effectiveDpis: [200],
      allDispatchesAtNativeDpi: true,
    });
    expect(result.otherTypes.missed).toEqual([]);
    expect(result.observedText).toContain(misread);
  });

  it("un tipo distinto de email perdido va a `otherTypes`, no a los emails", async () => {
    const { truth } = await buildSyntheticSource("S10");
    const found = truth.entities.filter((entity) => entity.type !== "DNI");
    const result = buildNativeCellRecord({
      corpus: "S10",
      sha256: "abc",
      truth,
      nativeDpi: 300,
      repetition: 2,
      observation: observation(
        300,
        300,
        [{ pageIndex: 0, text: "x" }],
        found.map((entity) => raw(entity.type, entity.value)),
      ),
    });
    expect(result.emails.missed).toBe(0);
    expect(result.otherTypes.missed.every((entity) => entity.type === "DNI")).toBe(true);
    expect(result.otherTypes.missed.length).toBeGreaterThan(0);
    expect(result.otherTypes.byType.EMAIL).toBeUndefined();
  });

  it("un email detectado que no está en la verdad se registra como agregado (p. ej. un recorte)", async () => {
    const { truth } = await buildSyntheticSource("S10");
    const result = buildNativeCellRecord({
      corpus: "S10",
      sha256: "abc",
      truth,
      nativeDpi: 300,
      repetition: 1,
      observation: observation(
        300,
        300,
        [{ pageIndex: 0, text: "x" }],
        [raw("EMAIL", "recortado@example.com")],
      ),
    });
    expect(result.emails.added).toBe(1);
    expect(result.emails.addedValues).toEqual([{ pageIndex: 0, value: "recortado@example.com" }]);
  });

  it("un DPI efectivo distinto del nativo invalida la celda y no se arregla", async () => {
    const { truth } = await buildSyntheticSource("S10");
    const result = buildNativeCellRecord({
      corpus: "S10",
      sha256: "abc",
      truth,
      nativeDpi: 200,
      repetition: 1,
      // la página dice 300 de tope y se despachó a 300: no es un escaneo nativo de 200
      observation: observation(300, 300, [{ pageIndex: 0, text: "x" }], []),
    });
    expect(result.valid).toBe(false);
    expect(result.invalidReasons).toContain("synthetic-source-not-200-dpi");
    expect(
      result.invalidReasons.some((reason) => reason.startsWith("dispatch-dpi-not-native")),
    ).toBe(true);
    expect(result.nativeDpiEvidence.allDispatchesAtNativeDpi).toBe(false);
  });

  it("un ocr.dpi por defecto distinto de 300 invalida la celda: la premisa cambió", async () => {
    const { truth } = await buildSyntheticSource("S10");
    const result = buildNativeCellRecord({
      corpus: "S10",
      sha256: "abc",
      truth,
      nativeDpi: 300,
      repetition: 1,
      observation: observation(250, 300, [{ pageIndex: 0, text: "x" }], [], {
        config: { ...GOOD_CONFIG, ocrDpi: 250 },
      }),
    });
    expect(result.valid).toBe(false);
    expect(result.invalidReasons).toContain("default-ocr-dpi-is-not-300: 250");
  });

  it("pool, presupuesto o NER distintos de lo fijado invalidan la celda", async () => {
    const { truth } = await buildSyntheticSource("S10");
    const result = buildNativeCellRecord({
      corpus: "S10",
      sha256: "abc",
      truth,
      nativeDpi: 300,
      repetition: 1,
      observation: observation(300, 300, [{ pageIndex: 0, text: "x" }], [], {
        config: { ...GOOD_CONFIG, ocrPoolSize: 2 },
      }),
    });
    expect(result.invalidReasons).toContain("override-not-effective");
  });

  it("no ready, sin NER terminado o sin lectura del OSD invalidan la celda", async () => {
    const { truth } = await buildSyntheticSource("S10");
    const result = buildNativeCellRecord({
      corpus: "S10",
      sha256: "abc",
      truth,
      nativeDpi: 300,
      repetition: 1,
      observation: observation(300, 300, [], [], {
        ready: false,
        nerFinished: false,
        capture: { jobs: [ocrJob(300)], issues: [] },
      }),
    });
    expect(result.invalidReasons).toEqual(
      expect.arrayContaining(["not-ready", "ner-not-finished", "no-osd-reading"]),
    );
  });
});
