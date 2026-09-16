import { describe, expect, it } from "vitest";

import {
  analyzeMarginInk,
  checkMarginInkInvariants,
  computeMarginInkCorrelation,
  computeResidualHistogram,
  fractionOfStripHeight,
  MarginInkInvariantError,
  MarginInkParseError,
  parseMarginInkStripRecord,
  type MarginInkBoxPx,
  type MarginInkStripRecord,
} from "./marginInk.js";

// ─── Fixture sintética: una tira con tinta parcialmente explicada por una
// palabra proyectada, y una segunda tira sin tinta salteada por blanco.

function box(x0: number, y0: number, x1: number, y1: number): MarginInkBoxPx {
  return { x0, y0, x1, y1 };
}

function buildActiveRecord(overrides: Partial<MarginInkStripRecord> = {}): MarginInkStripRecord {
  return {
    documentId: "doc-1",
    pageIndex: 0,
    orientation: 0,
    strip: "left",
    stripWidth: 100,
    stripHeight: 200,
    inkPixels: 40,
    inkBox: box(10, 10, 50, 50),
    maskedWordBoxes: 1,
    residualInkPixels: [10, 8, 4, 0],
    residualBox: [box(20, 20, 30, 30), box(20, 20, 29, 29), box(21, 21, 28, 28), null],
    wouldSkipByWhiteGate: false,
    wordsAddedByThisStrip: 0,
    addedWordTexts: [],
    projectionMismatches: 0,
    ...overrides,
  };
}

function buildSkippedRecord(overrides: Partial<MarginInkStripRecord> = {}): MarginInkStripRecord {
  return {
    documentId: "doc-1",
    pageIndex: 0,
    orientation: 0,
    strip: "right",
    stripWidth: 100,
    stripHeight: 200,
    inkPixels: 0,
    inkBox: null,
    maskedWordBoxes: 0,
    residualInkPixels: [0, 0, 0, 0],
    residualBox: [null, null, null, null],
    wouldSkipByWhiteGate: true,
    wordsAddedByThisStrip: 0,
    addedWordTexts: [],
    projectionMismatches: 0,
    ...overrides,
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─── parseMarginInkStripRecord ──────────────────────────────────────────────

describe("parseMarginInkStripRecord", () => {
  it("acepta un registro válido serializado (roundtrip JSON, como cruza page.evaluate)", () => {
    const record = buildActiveRecord();
    const parsed = parseMarginInkStripRecord(deepClone(record));
    expect(parsed).toEqual(record);
  });

  it("acepta un registro salteado por blanco con inkBox/residualBox null", () => {
    const record = buildSkippedRecord();
    const parsed = parseMarginInkStripRecord(deepClone(record));
    expect(parsed).toEqual(record);
  });

  it("lanza MarginInkParseError si el valor no es un objeto", () => {
    expect(() => parseMarginInkStripRecord("no soy un objeto")).toThrow(MarginInkParseError);
    expect(() => parseMarginInkStripRecord(null)).toThrow(MarginInkParseError);
    expect(() => parseMarginInkStripRecord(undefined)).toThrow(MarginInkParseError);
  });

  it("lanza si falta documentId", () => {
    // `JSON.parse` devuelve `any` sin anotar — a diferencia de `deepClone<T>`,
    // que preserva `T` y no admite borrar una propiedad `readonly` sin cast.
    const broken: Record<string, unknown> = JSON.parse(JSON.stringify(buildActiveRecord()));
    delete broken.documentId;
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });

  it("lanza si strip no es 'left' ni 'right'", () => {
    const broken = { ...deepClone(buildActiveRecord()), strip: "middle" };
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });

  it("lanza si residualInkPixels no tiene longitud 4", () => {
    const broken = { ...deepClone(buildActiveRecord()), residualInkPixels: [1, 2, 3] };
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });

  it("lanza si residualBox no tiene longitud 4", () => {
    const broken = { ...deepClone(buildActiveRecord()), residualBox: [null, null] };
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });

  it("lanza si una caja tiene x1 < x0", () => {
    const broken = { ...deepClone(buildActiveRecord()), inkBox: box(50, 10, 10, 50) };
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });

  it("lanza si addedWordTexts no coincide en longitud con wordsAddedByThisStrip", () => {
    const broken = {
      ...deepClone(buildActiveRecord()),
      wordsAddedByThisStrip: 2,
      addedWordTexts: ["SOLO-UNA"],
    };
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });

  it("lanza si projectionMismatches es negativo", () => {
    const broken = { ...deepClone(buildActiveRecord()), projectionMismatches: -1 };
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });

  it("lanza si inkPixels no es entero", () => {
    const broken = { ...deepClone(buildActiveRecord()), inkPixels: 1.5 };
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });
});

// ─── Invariantes (Handoff §2.4) ─────────────────────────────────────────────

describe("checkMarginInkInvariants", () => {
  it("no reporta violaciones sobre un lote consistente", () => {
    const violations = checkMarginInkInvariants([buildActiveRecord(), buildSkippedRecord()]);
    expect(violations).toEqual([]);
  });

  it("invariante 1a: residualInkPixels[d] > inkPixels dispara residualWithinInkPixels", () => {
    const broken = buildActiveRecord({ residualInkPixels: [50, 8, 4, 0] });
    const violations = checkMarginInkInvariants([broken]);
    expect(violations.some((v) => v.rule === "residualWithinInkPixels")).toBe(true);
  });

  it("invariante 1b: residualInkPixels no monótono no creciente dispara residualMonotonicNonIncreasing", () => {
    const broken = buildActiveRecord({ residualInkPixels: [10, 15, 4, 0] });
    const violations = checkMarginInkInvariants([broken]);
    expect(violations.some((v) => v.rule === "residualMonotonicNonIncreasing")).toBe(true);
  });

  it("invariante 2a: inkBox fuera de la tira dispara inkBoxWithinStrip", () => {
    // stripWidth=100, stripHeight=200 — esta caja se pasa del ancho.
    const broken = buildActiveRecord({ inkBox: box(90, 10, 150, 50) });
    const violations = checkMarginInkInvariants([broken]);
    expect(violations.some((v) => v.rule === "inkBoxWithinStrip")).toBe(true);
  });

  it("invariante 2b: residualBox[d] fuera de inkBox dispara residualBoxWithinInkBox", () => {
    // inkBox es (10,10,50,50); este residualBox[0] se sale por la derecha.
    const broken = buildActiveRecord({ residualBox: [box(40, 20, 60, 30), null, null, null] });
    const violations = checkMarginInkInvariants([broken]);
    expect(violations.some((v) => v.rule === "residualBoxWithinInkBox")).toBe(true);
  });

  it("invariante 2c: residualBox[d] presente con inkBox null dispara residualBoxWithinInkBox", () => {
    const broken = buildActiveRecord({
      inkBox: null,
      inkPixels: 0,
      residualInkPixels: [0, 0, 0, 0],
    });
    const withStrayResidual: MarginInkStripRecord = {
      ...broken,
      residualBox: [box(1, 1, 2, 2), null, null, null],
    };
    const violations = checkMarginInkInvariants([withStrayResidual]);
    expect(violations.some((v) => v.rule === "residualBoxWithinInkBox")).toBe(true);
  });

  it("invariante 3: dos registros con el mismo (documentId, pageIndex, strip) disparan uniqueRecordPerStrip", () => {
    const record = buildActiveRecord();
    const violations = checkMarginInkInvariants([record, deepClone(record)]);
    expect(violations.some((v) => v.rule === "uniqueRecordPerStrip")).toBe(true);
  });

  it("invariante 3: el mismo documentId+pageIndex con strip distinto NO dispara uniqueRecordPerStrip", () => {
    const violations = checkMarginInkInvariants([buildActiveRecord(), buildSkippedRecord()]);
    expect(violations.some((v) => v.rule === "uniqueRecordPerStrip")).toBe(false);
  });

  it("invariante 4: wouldSkipByWhiteGate=true con inkPixels>0 dispara whiteGateImpliesZeroInk (hallazgo, no se afloja)", () => {
    const broken = buildSkippedRecord({ inkPixels: 5, inkBox: box(0, 0, 5, 1) });
    const violations = checkMarginInkInvariants([broken]);
    expect(violations.some((v) => v.rule === "whiteGateImpliesZeroInk")).toBe(true);
  });

  it("invariante 4: wouldSkipByWhiteGate=false con inkPixels>0 NO dispara whiteGateImpliesZeroInk", () => {
    const violations = checkMarginInkInvariants([buildActiveRecord()]);
    expect(violations.some((v) => v.rule === "whiteGateImpliesZeroInk")).toBe(false);
  });
});

// ─── analyzeMarginInk: lanza sobre lote inconsistente, agrega sobre uno sano ─

describe("analyzeMarginInk", () => {
  it("lanza MarginInkInvariantError si hay violaciones", () => {
    const broken = buildActiveRecord({ residualInkPixels: [999, 8, 4, 0] });
    expect(() => analyzeMarginInk([broken])).toThrow(MarginInkInvariantError);
  });

  it("agrega correlación e histograma sobre un lote sano", () => {
    const result = analyzeMarginInk([buildActiveRecord(), buildSkippedRecord()]);
    expect(result.totalProjectionMismatches).toBe(0);
    expect(result.residualHistogramByDilation[0].n).toBe(2);
    expect(result.correlation.cells.reduce((sum, c) => sum + c.count, 0)).toBe(2);
  });
});

// ─── La correlación que decide (Handoff §3) ────────────────────────────────

describe("computeMarginInkCorrelation", () => {
  it("clasifica residuo=0 y sin palabras aportadas en la celda (true,false)", () => {
    const record = buildActiveRecord({
      residualInkPixels: [0, 0, 0, 0],
      wordsAddedByThisStrip: 0,
      addedWordTexts: [],
    });
    const correlation = computeMarginInkCorrelation([record]);
    const cell = correlation.cells.find((c) => c.residualZero && !c.wordsAdded);
    expect(cell?.count).toBe(1);
    expect(correlation.disqualifyingRows).toEqual([]);
  });

  it("una tira con residuo=0 que SÍ aportó palabras cae en disqualifyingRows con las palabras concretas", () => {
    const record = buildActiveRecord({
      pageIndex: 7,
      strip: "right",
      residualInkPixels: [0, 0, 0, 0],
      wordsAddedByThisStrip: 2,
      addedWordTexts: ["FOJA", "123"],
    });
    const correlation = computeMarginInkCorrelation([record]);
    expect(correlation.disqualifyingRows).toEqual([
      {
        documentId: record.documentId,
        pageIndex: 7,
        strip: "right",
        wordsAddedByThisStrip: 2,
        addedWordTexts: ["FOJA", "123"],
      },
    ]);
  });

  it("residuo>0 con palabras aportadas cae en (false,true) y no en disqualifyingRows", () => {
    const record = buildActiveRecord({ wordsAddedByThisStrip: 3, addedWordTexts: ["A", "B", "C"] });
    const correlation = computeMarginInkCorrelation([record]);
    const cell = correlation.cells.find((c) => !c.residualZero && c.wordsAdded);
    expect(cell?.count).toBe(1);
    expect(correlation.disqualifyingRows).toEqual([]);
  });
});

// ─── Histograma y fracción de caja ──────────────────────────────────────────

describe("computeResidualHistogram", () => {
  it("calcula n/min/median/p90/max sobre residualInkPixels[d]", () => {
    const records = [0, 10, 20, 30, 100].map((residual) =>
      buildActiveRecord({ residualInkPixels: [residual, residual, residual, residual] }),
    );
    const stats = computeResidualHistogram(records, 0);
    expect(stats).toEqual({ n: 5, min: 0, median: 20, p90: 72, max: 100 });
  });

  it("devuelve NaN en todos los campos salvo n=0 para un lote vacío", () => {
    const stats = computeResidualHistogram([], 0);
    expect(stats.n).toBe(0);
    expect(Number.isNaN(stats.median)).toBe(true);
  });
});

describe("fractionOfStripHeight", () => {
  it("devuelve la fracción del alto que ocupa la caja", () => {
    expect(fractionOfStripHeight(box(0, 50, 10, 150), 200)).toBeCloseTo(0.5, 10);
  });

  it("devuelve null si la caja es null (sin tinta o sin residuo)", () => {
    expect(fractionOfStripHeight(null, 200)).toBeNull();
  });

  it("lanza si stripHeight es <= 0", () => {
    expect(() => fractionOfStripHeight(box(0, 0, 1, 1), 0)).toThrow(MarginInkParseError);
  });
});
