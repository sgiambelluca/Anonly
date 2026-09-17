import { describe, expect, it } from "vitest";

import {
  analyzeMarginInk,
  checkMarginInkInvariants,
  computeMarginInkCorrelation,
  computeMarginInkCorrelationExact,
  computeResidualHistogram,
  fractionOfStripHeight,
  MarginInkInvariantError,
  MarginInkParseError,
  parseMarginInkStripRecord,
  summarizeSmallestZeroDilation,
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
    // M-1b: superconjunto del criterio de brillo en cada d compartido
    // (15>=10, 12>=8, 6>=4, 1>=0) y en el total (50>=40); llega a cero en
    // d=4 (índice 4 de la escalera [0,1,2,3,4,6,8]).
    inkPixelsExact: 50,
    residualExact: [15, 12, 6, 1, 0, 0, 0],
    smallestZeroDilation: 4,
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
    // M-1b: márgenes blancos — sin tinta bajo ninguno de los dos criterios.
    inkPixelsExact: 0,
    residualExact: [0, 0, 0, 0, 0, 0, 0],
    smallestZeroDilation: 0,
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

  // M-1b (Handoff §8.2)

  it("lanza si residualExact no tiene longitud 7", () => {
    const broken = { ...deepClone(buildActiveRecord()), residualExact: [0, 0, 0, 0] };
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });

  it("lanza si inkPixelsExact es negativo", () => {
    const broken = { ...deepClone(buildActiveRecord()), inkPixelsExact: -1 };
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });

  it("lanza si smallestZeroDilation no es null ni un valor de la escalera", () => {
    const broken = { ...deepClone(buildActiveRecord()), smallestZeroDilation: 5 };
    expect(() => parseMarginInkStripRecord(broken)).toThrow(MarginInkParseError);
  });

  it("acepta smallestZeroDilation null", () => {
    const record = buildActiveRecord({
      smallestZeroDilation: null,
      residualExact: [1, 1, 1, 1, 1, 1, 1],
    });
    const parsed = parseMarginInkStripRecord(deepClone(record));
    expect(parsed.smallestZeroDilation).toBeNull();
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

  // Invariante nuevo (Handoff §8.3): residualExact[d] >= residualInkPixels[d]
  // y inkPixelsExact >= inkPixels — el criterio exacto cuenta un
  // superconjunto del umbral de brillo.

  it("invariante 5a: inkPixelsExact < inkPixels dispara exactSupersetOfBrightness", () => {
    const broken = buildActiveRecord({ inkPixelsExact: 30 }); // inkPixels=40
    const violations = checkMarginInkInvariants([broken]);
    expect(violations.some((v) => v.rule === "exactSupersetOfBrightness")).toBe(true);
  });

  it("invariante 5b: residualExact[d] < residualInkPixels[d] dispara exactSupersetOfBrightness", () => {
    // residualInkPixels=[10,8,4,0]; acá residualExact[1]=5 < 8.
    const broken = buildActiveRecord({ residualExact: [15, 5, 6, 1, 0, 0, 0] });
    const violations = checkMarginInkInvariants([broken]);
    expect(violations.some((v) => v.rule === "exactSupersetOfBrightness")).toBe(true);
  });

  it("invariante 5: un registro consistente (exacto superconjunto del de brillo) NO dispara exactSupersetOfBrightness", () => {
    const violations = checkMarginInkInvariants([buildActiveRecord(), buildSkippedRecord()]);
    expect(violations.some((v) => v.rule === "exactSupersetOfBrightness")).toBe(false);
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
    // M-1b: la correlación exacta y la distribución de smallestZeroDilation
    // también se agregan, sobre el mismo lote.
    expect(result.correlationExact.cells.reduce((sum, c) => sum + c.count, 0)).toBe(2);
    expect(result.smallestZeroDilationDistribution).toEqual({ "4": 1, "0": 1 });
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

// ─── La correlación exacta y la distribución de smallestZeroDilation (M-1b, Handoff §8.4) ─

describe("computeMarginInkCorrelationExact", () => {
  it("usa residualExact[0], no residualInkPixels[0], para decidir residuo cero", () => {
    // residualInkPixels[0]=0 (residuo de brillo cero) pero residualExact[0]=3
    // (bajo el criterio exacto todavía queda tinta) — tienen que clasificar distinto.
    const record = buildActiveRecord({
      residualInkPixels: [0, 0, 0, 0],
      residualExact: [3, 2, 1, 0, 0, 0, 0],
      wordsAddedByThisStrip: 0,
      addedWordTexts: [],
    });
    const brightness = computeMarginInkCorrelation([record]);
    const exact = computeMarginInkCorrelationExact([record]);
    expect(brightness.cells.find((c) => c.residualZero && !c.wordsAdded)?.count).toBe(1);
    expect(exact.cells.find((c) => !c.residualZero && !c.wordsAdded)?.count).toBe(1);
  });

  it("una tira con residualExact[0]=0 que aportó palabras cae en disqualifyingRows bajo el criterio exacto", () => {
    const record = buildActiveRecord({
      residualInkPixels: [0, 0, 0, 0],
      residualExact: [0, 0, 0, 0, 0, 0, 0],
      wordsAddedByThisStrip: 1,
      addedWordTexts: ["FOJA"],
    });
    const exact = computeMarginInkCorrelationExact([record]);
    expect(exact.disqualifyingRows).toHaveLength(1);
  });
});

describe("summarizeSmallestZeroDilation", () => {
  it("cuenta cuántas tiras apagan el residuo exacto en cada d, y agrupa las que nunca lo apagan bajo 'null'", () => {
    const records = [
      buildActiveRecord({ smallestZeroDilation: 0 }),
      buildActiveRecord({ smallestZeroDilation: 0 }),
      buildActiveRecord({ smallestZeroDilation: 4 }),
      buildActiveRecord({ smallestZeroDilation: null, residualExact: [5, 5, 5, 5, 5, 5, 5] }),
    ];
    expect(summarizeSmallestZeroDilation(records)).toEqual({ "0": 2, "4": 1, null: 1 });
  });

  it("devuelve un objeto vacío para un lote vacío", () => {
    expect(summarizeSmallestZeroDilation([])).toEqual({});
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
