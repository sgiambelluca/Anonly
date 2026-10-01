import { describe, expect, it } from "vitest";

import type { ChainEvidence } from "./ocrDpiDownChain.js";
import { SD_VARIANT_IDS, isSyntheticCorpus, type CorpusId } from "./ocrDpiDownCorpus.js";
import {
  REQUIRED_DECIDING_CORPORA,
  cellId,
  compareSdTotals,
  dpiDownResultLine,
  expectedCellKeys,
  resolveMinCoverage,
  summarizeDpiDown,
  type CellRecord,
  type DpiDownInput,
  type EntityCounts,
} from "./ocrDpiDownSummary.js";

const counts = (
  missed: number,
  expected = 16,
  added = 0,
  byType: Record<string, number> = { EMAIL: missed },
): EntityCounts => ({
  byType: Object.fromEntries(
    Object.entries(byType).map(([type, value]) => [
      type,
      { expected: 4, detected: 4 - value, matched: 4 - value, missed: value, added: 0 },
    ]),
  ),
  totals: { expected, detected: expected - missed, matched: expected - missed, missed, added },
});
const chain = (recoverySteps = 0, unreadableInkPages = 0): ChainEvidence => ({
  osd: [{ pageIndex: 0, orientation: 0, inkRatio: 0.2 }],
  recoverySteps,
  upscaledDispatches: 0,
  maxUpscale: 1,
  unreadableInkPages,
  ocrPageFailedDispatches: 0,
  issues: [],
});

interface CellPatch {
  /** Entidades que el control 300 detecta y esta celda no. */
  readonly lostVsControl?: number;
  /** Entidades de la verdad que esta celda no detecta (sintéticos). */
  readonly lostVsTruth?: number;
  readonly lostKeys?: ReadonlyArray<string>;
  /** Solo la repetición 2 del 300: entidades que difieren de la repetición 1. */
  readonly addedVsReference?: number;
  readonly coverage?: ReadonlyArray<number>;
  readonly pairsWithoutBox?: number;
  readonly recoverySteps?: number;
  readonly unreadableInk?: number;
  readonly valid?: boolean;
  readonly armEffective?: boolean;
  readonly hash?: string;
  /** DPI pedido aplicado en `effective` de `total` páginas (por defecto, todas o ninguna según armEffective). */
  readonly pages?: { readonly effective: number; readonly total: number };
}

function dispatchFor(
  dpi: number,
  pages: { effective: number; total: number },
): CellRecord["dispatch"] {
  return {
    requestedDpi: dpi,
    caps: [],
    dispatches: Array.from({ length: pages.total }, (_, pageIndex) => ({
      pageIndex,
      jobId: `j${pageIndex}`,
      dpi: pageIndex < pages.effective ? dpi : 240,
      upscale: 1,
      orientation: 0,
      widthPx: 1,
      heightPx: 1,
      terminal: "COMPLETED",
      transportRetry: false,
    })),
    expectedDpiByPage: {},
    effectiveDpis: [],
    dispatchesAtExpectedDpi: true,
    armEffective: pages.effective === pages.total,
    issues: [],
  };
}

function cell(
  corpus: CorpusId,
  dpi: number,
  repetition: number,
  patch: CellPatch = {},
): CellRecord {
  const isReference = dpi === 300 && repetition === 1;
  const synthetic = isSyntheticCorpus(corpus);
  const lostTruth = patch.lostVsTruth ?? patch.lostKeys?.length ?? 0;
  return {
    schema: 1,
    corpus,
    corpusKind: synthetic ? "synthetic" : "real",
    dpi,
    repetition,
    valid: patch.valid ?? true,
    invalidReasons: patch.valid === false ? ["not-ready"] : [],
    armEffective: patch.armEffective ?? true,
    fixtureSha256: patch.hash ?? "h",
    dispatch: patch.pages === undefined ? null : dispatchFor(dpi, patch.pages),
    chain: chain(patch.recoverySteps, patch.unreadableInk),
    detectedByType: {},
    entitiesVsTruth: synthetic ? counts(lostTruth) : null,
    truthLostKeys: synthetic
      ? (patch.lostKeys ?? Array.from({ length: lostTruth }, (_, i) => `EMAIL|0|k${i}`))
      : null,
    entitiesVsReference: isReference
      ? null
      : counts(patch.lostVsControl ?? 0, 16, patch.addedVsReference ?? 0),
    tokensVsTruth: null,
    tokensVsReference: null,
    coverageVsReference: isReference
      ? null
      : { values: patch.coverage ?? [1, 1, 0.99], pairsWithoutBox: patch.pairsWithoutBox ?? 0 },
  };
}

type Patches = Record<string, CellPatch>;
const FULL: ReadonlyArray<CorpusId> = [...REQUIRED_DECIDING_CORPORA, "S6"];
/** El 150 pierde algo en S8: el control discriminante en orden. */
const DISCRIMINATES: Patches = { "S8-d150-rep1": { lostVsControl: 1 } };

function input(
  overrides: Partial<DpiDownInput> & { patches?: Patches; absent?: string[] } = {},
): DpiDownInput {
  const { patches = DISCRIMINATES, absent = [], ...rest } = overrides;
  return {
    corpora: FULL,
    arms: [300, 250, 200, 150],
    skippedCorpora: [],
    minCoverageRaw: "0.95",
    readCell: (corpus, dpi, repetition) => {
      const id = cellId(corpus, dpi, repetition);
      return absent.includes(id) ? null : cell(corpus, dpi, repetition, patches[id] ?? {});
    },
    ...rest,
  };
}
const verdict = (summary: ReturnType<typeof summarizeDpiDown>, dpi: number) =>
  summary.arms[String(dpi)]?.verdict;

describe("expectedCellKeys", () => {
  it("el 300 se corre dos veces (control) salvo en SD2 a SD5, que lo hacen una", () => {
    expect(
      expectedCellKeys(["S12", "SD1", "SD2"], [300, 150]).map((key) =>
        cellId(key.corpus, key.dpi, key.repetition),
      ),
    ).toEqual([
      "S12-d300-rep1",
      "S12-d300-rep2",
      "S12-d150-rep1",
      "SD1-d300-rep1",
      "SD1-d300-rep2",
      "SD1-d150-rep1",
      "SD2-d300-rep1",
      "SD2-d150-rep1",
    ]);
  });
});

describe("§6.1 la matriz tiene que estar completa", () => {
  it("matriz completa, control discriminante en orden y todo cumplido: pasa", () => {
    const summary = summarizeDpiDown(input());
    expect(summary.matrix.complete).toBe(true);
    expect(verdict(summary, 250)).toBe("pasa");
    expect(verdict(summary, 200)).toBe("pasa");
    expect(verdict(summary, 150)).toBe("no-pasa");
    expect(summary.arms["300"]?.verdict).toBeNull();
    expect(summary.complete).toBe(true);
  });

  it("R2 saltado: todos los brazos salen parcial, con el motivo, aunque complete=true", () => {
    const corpora = FULL.filter((corpus) => corpus !== "R2");
    const summary = summarizeDpiDown(
      input({
        corpora,
        skippedCorpora: [{ corpus: "R2", reason: "ANONLY_REAL_DOC_R2 no definido" }],
      }),
    );
    expect(summary.complete).toBe(true);
    expect(summary.matrix.complete).toBe(false);
    expect([250, 200, 150].map((dpi) => verdict(summary, dpi))).toEqual([
      "parcial",
      "parcial",
      "parcial",
    ]);
    expect(summary.matrix.reasons.join(" ")).toContain("R2");
    expect(summary.matrix.reasons.join(" ")).toContain("ANONLY_REAL_DOC_R2 no definido");
    expect(dpiDownResultLine(summary)).toContain("PARCIAL");
  });

  it("solo dos variantes de SD: parcial", () => {
    const corpora = FULL.filter((corpus) => !["SD3", "SD4", "SD5"].includes(corpus));
    expect(verdict(summarizeDpiDown(input({ corpora })), 250)).toBe("parcial");
  });

  it("solo S6 en la matriz (ningún corpus que decide): parcial, nunca pasa", () => {
    const summary = summarizeDpiDown(input({ corpora: ["S6"] }));
    expect([250, 200, 150].map((dpi) => verdict(summary, dpi))).toEqual([
      "parcial",
      "parcial",
      "parcial",
    ]);
  });

  it("un humo nunca emite pasa, aunque la matriz tenga todo", () => {
    expect(verdict(summarizeDpiDown(input({ smoke: true })), 250)).toBe("parcial");
  });

  it("un subconjunto de corpus (p. ej. ANONLY_OCR_DPI_DOWN_CORPUS) es parcial", () => {
    expect(verdict(summarizeDpiDown(input({ corpora: ["S12", "S10"] })), 250)).toBe("parcial");
  });

  it("falta una celda de un corpus que decide: parcial; falta una de S6: no", () => {
    expect(verdict(summarizeDpiDown(input({ absent: ["S8-d250-rep1"] })), 250)).toBe("parcial");
    expect(verdict(summarizeDpiDown(input({ absent: ["S6-d250-rep1"] })), 250)).toBe("pasa");
  });

  it("sin el brazo 150 en la matriz no hay control discriminante: parcial", () => {
    expect(verdict(summarizeDpiDown(input({ arms: [300, 250, 200] })), 250)).toBe("parcial");
  });

  it("parcial manda sobre no pasa: una matriz incompleta no reprueba a nadie", () => {
    const summary = summarizeDpiDown(
      input({ smoke: true, patches: { ...DISCRIMINATES, "S12-d200-rep1": { lostVsControl: 2 } } }),
    );
    expect(verdict(summary, 200)).toBe("parcial");
  });

  it("una celda inválida deja ese corpus (y el brazo) indeterminado con su motivo, no parcial", () => {
    const summary = summarizeDpiDown(
      input({ patches: { ...DISCRIMINATES, "S10-d200-rep1": { valid: false } } }),
    );
    expect(verdict(summary, 200)).toBe("indeterminado");
    expect(summary.arms["200"]?.indeterminate[0]).toMatchObject({
      corpus: "S10",
      criterion: "celda",
    });
    expect(summary.arms["200"]?.indeterminate[0]?.detail).toContain("not-ready");
    expect(summary.invalidCells).toEqual([{ cell: "S10-d200-rep1", reasons: ["not-ready"] }]);
    expect(summary.complete).toBe(false);
    expect(verdict(summary, 250)).toBe("pasa");
  });

  it("R3 decide solo si está en la matriz", () => {
    const sin = summarizeDpiDown(input());
    expect(sin.corpora.evaluated).not.toContain("R3");
    const con = summarizeDpiDown(
      input({
        corpora: [...FULL, "R3"],
        patches: { ...DISCRIMINATES, "R3-d200-rep1": { lostVsControl: 1 } },
      }),
    );
    expect(verdict(con, 200)).toBe("no-pasa");
    expect(verdict(con, 250)).toBe("pasa");
  });
});

describe("§6.2 criterio 1 en corpus limpios y reales", () => {
  it("perder una sola entidad que 300 detecta no pasa, con el corpus que lo causa", () => {
    const summary = summarizeDpiDown(
      input({ patches: { ...DISCRIMINATES, "S12-d200-rep1": { lostVsControl: 1 } } }),
    );
    expect(verdict(summary, 200)).toBe("no-pasa");
    expect(summary.arms["200"]?.failures).toEqual([
      expect.objectContaining({
        corpus: "S12",
        criterion: 1,
        detail: expect.stringContaining("EMAILx1"),
      }),
    ]);
    expect(verdict(summary, 250)).toBe("pasa");
  });

  it("en un real (R2) la referencia es el brazo 300", () => {
    const summary = summarizeDpiDown(
      input({ patches: { ...DISCRIMINATES, "R2-d200-rep1": { lostVsControl: 2 } } }),
    );
    expect(summary.arms["200"]?.failures[0]).toMatchObject({ corpus: "R2", criterion: 1 });
  });

  it("piso del control: si las dos repeticiones de 300 no detectan lo mismo, el corpus es indeterminado", () => {
    const summary = summarizeDpiDown(
      input({ patches: { ...DISCRIMINATES, "S10-d300-rep2": { addedVsReference: 1 } } }),
    );
    expect(summary.controlFloor.S10?.ok).toBe(false);
    expect(verdict(summary, 250)).toBe("indeterminado");
    expect(summary.arms["250"]?.indeterminate[0]?.detail).toContain("no detectan las mismas");
  });

  it("piso del control: si 300 detecta menos del 90 % de la verdad, indeterminado (las dos pierden las 16 ya no es pasa)", () => {
    const patches = {
      ...DISCRIMINATES,
      "S8-d300-rep1": { lostVsTruth: 16 },
      "S8-d300-rep2": { lostVsTruth: 16 },
    };
    const summary = summarizeDpiDown(input({ patches }));
    expect(summary.controlFloor.S8?.ok).toBe(false);
    expect(verdict(summary, 250)).toBe("indeterminado");
    expect(summary.controlIncompleteCorpora.map((c) => c.corpus)).toContain("S8");
  });

  it("el 90 % exacto cumple el piso; lo que 300 ya pierde contra la verdad no se carga al brazo", () => {
    const control = { lostVsTruth: 1 }; // 15 de 16 = 93,75 %
    const summary = summarizeDpiDown(
      input({
        patches: {
          ...DISCRIMINATES,
          "S10-d300-rep1": control,
          "S10-d300-rep2": control,
          "S10-d250-rep1": control,
        },
      }),
    );
    expect(summary.controlFloor.S10?.ok).toBe(true);
    expect(verdict(summary, 250)).toBe("pasa");
    expect(summary.arms["250"]?.perCorpus.S10?.entitiesLostVsTruth).toBe(1);
  });

  it("sin la referencia (300, repetición 1) no se puede evaluar: indeterminado", () => {
    const summary = summarizeDpiDown(
      input({ patches: { ...DISCRIMINATES, "S12-d300-rep1": { valid: false } } }),
    );
    expect(verdict(summary, 250)).toBe("indeterminado");
  });

  it("muestra siempre las pérdidas contra la verdad de cada brazo, incluido 300", () => {
    const summary = summarizeDpiDown(
      input({
        patches: {
          ...DISCRIMINATES,
          "S12-d300-rep1": { lostVsTruth: 1 },
          "S12-d250-rep1": { lostVsTruth: 2 },
        },
      }),
    );
    expect(summary.arms["300"]?.perCorpus.S12?.entitiesLostVsTruth).toBe(1);
    expect(summary.arms["250"]?.perCorpus.S12?.entitiesLostVsTruth).toBe(2);
    expect(summary.arms["250"]?.perCorpus.S12?.entitiesLostVsControl).toBe(0);
  });
});

describe("§6.2 SD: cinco variantes juntas", () => {
  const sd = (overrides: Patches): Patches => ({ ...DISCRIMINATES, ...overrides });

  it("compareSdTotals: total igual o menor pasa; mayor no pasa; sin compensaciones por variante", () => {
    const v = (variant: string, lostControl: number, lostArm: number) => ({
      variant,
      expected: 16,
      lostControl,
      lostArm,
    });
    expect(compareSdTotals([v("SD1", 2, 2), v("SD2", 0, 0)]).outcome).toBe("pasa");
    expect(compareSdTotals([v("SD1", 2, 1), v("SD2", 0, 0)]).outcome).toBe("pasa");
    expect(compareSdTotals([v("SD1", 1, 2), v("SD2", 0, 0)]).outcome).toBe("no-pasa");
    // Pierde en una variante donde 300 no pierde, pero el total no supera: pasa (se comparan dos totales).
    const swap = compareSdTotals([
      { ...v("SD1", 0, 1), controlKeys: [], armKeys: ["x"] },
      { ...v("SD2", 2, 0), controlKeys: ["a", "b"], armKeys: [] },
    ]);
    expect(swap.outcome).toBe("pasa");
    expect(swap.perVariant[0]).toMatchObject({
      armLosesWhere300Detects: 1,
      armDetectsWhere300Loses: 0,
    });
  });

  it("compareSdTotals: piso del control al 90 % de la verdad (72 de 80), si no indeterminado", () => {
    const control = (lost: number) =>
      compareSdTotals(
        SD_VARIANT_IDS.map((variant, i) => ({
          variant,
          expected: 16,
          lostControl: i === 0 ? lost : 0,
          lostArm: 0,
        })),
      );
    expect(control(8).outcome).toBe("pasa"); // 72 de 80: justo el piso
    const bajo = control(9);
    expect(bajo.outcome).toBe("indeterminado");
    expect(bajo.controlDetectedFraction).toBeCloseTo(0.8875, 4);
    expect(bajo.reason).toContain("piso del control");
  });

  it("en el resumen: el total del brazo mayor que el de 300 no pasa", () => {
    const summary = summarizeDpiDown(
      input({ patches: sd({ "SD3-d200-rep1": { lostVsTruth: 1 } }) }),
    );
    expect(verdict(summary, 200)).toBe("no-pasa");
    expect(summary.arms["200"]?.failures[0]).toMatchObject({ corpus: "SD", criterion: 1 });
    expect(summary.arms["200"]?.sd?.perVariant).toHaveLength(5);
    expect(verdict(summary, 250)).toBe("pasa");
  });

  it("en el resumen: total igual o menor pasa, sin no-concluyente", () => {
    const summary = summarizeDpiDown(
      input({
        patches: sd({
          "SD2-d300-rep1": { lostKeys: ["a"] },
          "SD2-d200-rep1": { lostKeys: ["b"] }, // pierde otra distinta, mismo total
        }),
      }),
    );
    expect(summary.arms["200"]?.sd?.outcome).toBe("pasa");
    expect(verdict(summary, 200)).toBe("pasa");
    expect(JSON.stringify(summary)).not.toContain("no-concluyente");
  });

  it("en el resumen: si 300 no llega al 90 % de las 80, SD es indeterminado para todos", () => {
    const summary = summarizeDpiDown(
      input({
        patches: sd({ "SD1-d300-rep1": { lostVsTruth: 9 }, "SD1-d250-rep1": { lostVsTruth: 9 } }),
      }),
    );
    expect(summary.controlFloor.SD?.ok).toBe(false);
    expect(summary.arms["250"]?.sd?.outcome).toBe("indeterminado");
    expect(verdict(summary, 250)).toBe("indeterminado");
  });

  it("una variante inválida deja SD indeterminado, no aprobado", () => {
    const summary = summarizeDpiDown(input({ patches: sd({ "SD4-d250-rep1": { valid: false } }) }));
    expect(summary.arms["250"]?.sd?.outcome).toBe("indeterminado");
    expect(verdict(summary, 250)).toBe("indeterminado");
  });

  it("el doble control del 300 se hace solo en SD1", () => {
    const summary = summarizeDpiDown(input());
    expect(summary.missingCells).toEqual([]);
    expect(Object.keys(summary.controlVariation.perCorpus)).toContain("SD1");
    expect(Object.keys(summary.controlVariation.perCorpus)).not.toContain("SD2");
  });
});

describe("resolveMinCoverage (N-1): 0,95 es una constante del arnés", () => {
  it.each(["0,9", "abc", "NaN", "Infinity", "-0.1", "1.5", "0.9x", "1e400"])(
    "%s no es un umbral válido: se aplica 0,95 y no es oficial",
    (raw) => {
      const resolved = resolveMinCoverage(raw);
      expect(resolved).toMatchObject({ raw, effective: 0.95, official: false });
      expect(resolved.caveat).toContain("min-coverage-invalid");
    },
  );
  it.each([null, undefined, "", "  "])("%j equivale a 0,95 oficial, sin salvedad", (raw) => {
    expect(resolveMinCoverage(raw)).toMatchObject({
      effective: 0.95,
      official: true,
      caveat: null,
    });
  });
  it.each(["0", "0.5", "1", 0.9])(
    "%j es un umbral de exploración: se aplica pero no es oficial",
    (raw) => {
      const resolved = resolveMinCoverage(raw);
      expect(resolved).toMatchObject({ effective: Number(raw), official: false });
      expect(resolved.caveat).toContain("min-coverage-override");
    },
  );
  it.each(["0.95", "0.950", 0.95])("%j es el oficial explícito", (raw) => {
    expect(resolveMinCoverage(raw)).toMatchObject({
      effective: 0.95,
      official: true,
      caveat: null,
    });
  });
});

describe("§6.3 criterio 2: cobertura", () => {
  it("cobertura mínima bajo el umbral no pasa", () => {
    const summary = summarizeDpiDown(
      input({ patches: { ...DISCRIMINATES, "S8-d250-rep1": { coverage: [1, 0.9] } } }),
    );
    expect(verdict(summary, 250)).toBe("no-pasa");
    expect(summary.arms["250"]?.failures[0]).toMatchObject({ corpus: "S8", criterion: 2 });
  });

  it("sin la variable se aplica 0,95 y el brazo puede pasar; la línea final muestra el umbral", () => {
    const summary = summarizeDpiDown(input({ minCoverageRaw: null }));
    expect(verdict(summary, 250)).toBe("pasa");
    expect(summary.decisionRule).toMatchObject({
      minCoverage: 0.95,
      minCoverageOfficial: true,
      minCoverageRaw: null,
    });
    expect(dpiDownResultLine(summary)).toContain("cobertura=0.95");
    expect(dpiDownResultLine(summary)).not.toContain("EXPLORATORIO");
  });

  it("0,95 se hace cumplir: 0,94 de cobertura no pasa", () => {
    const summary = summarizeDpiDown(
      input({
        minCoverageRaw: null,
        patches: { ...DISCRIMINATES, "S8-d250-rep1": { coverage: [0.94] } },
      }),
    );
    expect(verdict(summary, 250)).toBe("no-pasa");
  });

  it.each([
    ["MIN_COVERAGE=0 (sonda del revisor: cobertura 0,1 salía pasa)", "0"],
    ["otro valor válido", "0.5"],
    ["con coma", "0,9"],
    ["fuera de rango", "1.5"],
    ["no numérico", "abc"],
  ])("%s: ningún brazo pasa, hay salvedad y la línea marca EXPLORATORIO", (_label, raw) => {
    const summary = summarizeDpiDown(
      input({
        minCoverageRaw: raw,
        patches: { ...DISCRIMINATES, "S8-d250-rep1": { coverage: [0.1] } },
      }),
    );
    expect([250, 200].map((dpi) => verdict(summary, dpi))).not.toContain("pasa");
    expect(summary.decisionRule).toMatchObject({ minCoverageRaw: raw, minCoverageOfficial: false });
    expect(summary.validityCaveats.join(" ")).toContain("min-coverage");
    expect(dpiDownResultLine(summary)).toContain("(EXPLORATORIO)");
  });

  it("un umbral de exploración sin fallos deja indeterminado, y con fallos sigue siendo no-pasa", () => {
    expect(verdict(summarizeDpiDown(input({ minCoverageRaw: "0.5" })), 200)).toBe("indeterminado");
    const summary = summarizeDpiDown(
      input({
        minCoverageRaw: "0,9",
        patches: { ...DISCRIMINATES, "S12-d200-rep1": { lostVsControl: 1 } },
      }),
    );
    expect(verdict(summary, 200)).toBe("no-pasa");
  });

  it("el summary registra el valor crudo y el efectivo", () => {
    expect(summarizeDpiDown(input({ minCoverageRaw: "0.9" })).decisionRule).toMatchObject({
      minCoverageRaw: "0.9",
      minCoverage: 0.9,
      minCoverageOfficial: false,
    });
  });

  it("una entidad presente en los dos brazos sin caja medible deja el corpus indeterminado", () => {
    const summary = summarizeDpiDown(
      input({ patches: { ...DISCRIMINATES, "SR-d250-rep1": { pairsWithoutBox: 1 } } }),
    );
    expect(verdict(summary, 250)).toBe("indeterminado");
    expect(summary.arms["250"]?.indeterminate[0]).toMatchObject({ corpus: "SR", criterion: 2 });
  });

  it("sin pares de cajas contra 300 no se da por cumplido", () => {
    const base = input();
    const summary = summarizeDpiDown({
      ...base,
      readCell: (corpus, dpi, repetition) => {
        const found = base.readCell(corpus, dpi, repetition);
        return found !== null && corpus === "S10" && dpi === 250
          ? { ...found, coverageVsReference: null }
          : found;
      },
    });
    expect(verdict(summary, 250)).toBe("indeterminado");
  });

  it("informa la cobertura entre las dos repeticiones de 300 y avisa si el umbral queda por debajo", () => {
    const patches = { ...DISCRIMINATES, "S8-d300-rep2": { coverage: [0.9, 1] } };
    const summary = summarizeDpiDown(input({ patches }));
    expect(summary.controlVariation.perCorpus.S8?.coverage).toMatchObject({ count: 2, min: 0.9 });
    expect(summary.controlVariation.overallCoverage?.min).toBe(0.9);
    expect(summary.thresholdBelowControlVariation).toBe(true);
    expect(summarizeDpiDown(input({ minCoverageRaw: null })).thresholdBelowControlVariation).toBe(
      false,
    );
  });
});

describe("§6.4 criterio 3", () => {
  it("más tinta ilegible o más pasos de recuperación que el control no pasa", () => {
    const ink = summarizeDpiDown(
      input({ patches: { ...DISCRIMINATES, "S12-d200-rep1": { unreadableInk: 1 } } }),
    );
    expect(ink.arms["200"]?.failures[0]).toMatchObject({ criterion: 3, corpus: "S12" });
    const steps = summarizeDpiDown(
      input({ patches: { ...DISCRIMINATES, "S8-d250-rep1": { recoverySteps: 2 } } }),
    );
    expect(verdict(steps, 250)).toBe("no-pasa");
  });

  it("la base es la peor de las dos repeticiones de 300", () => {
    const summary = summarizeDpiDown(
      input({
        patches: {
          ...DISCRIMINATES,
          "S8-d300-rep2": { recoverySteps: 1 },
          "S8-d250-rep1": { recoverySteps: 1 },
        },
      }),
    );
    expect(verdict(summary, 250)).toBe("pasa");
  });
});

describe("§6.1 brazo no efectivo en un corpus", () => {
  const ineffective: Patches = {
    ...DISCRIMINATES,
    "R2-d250-rep1": { armEffective: false, lostVsControl: 3 },
  };

  it("no se evalúa ahí: ni aprueba ni reprueba, y la línea final lo nombra", () => {
    const summary = summarizeDpiDown(input({ patches: ineffective }));
    expect(summary.arms["250"]?.notEvaluatedCorpora).toEqual(["R2"]);
    expect(summary.arms["250"]?.failures).toEqual([]);
    expect(verdict(summary, 250)).toBe("pasa");
    expect(dpiDownResultLine(summary)).toContain("no-evaluado=250@R2");
  });

  it("un brazo no efectivo en todos los corpus que deciden es indeterminado", () => {
    const base = input();
    const summary = summarizeDpiDown({
      ...base,
      readCell: (corpus, dpi, repetition) => {
        const found = base.readCell(corpus, dpi, repetition);
        return found !== null && dpi === 250 ? { ...found, armEffective: false } : found;
      },
    });
    expect(verdict(summary, 250)).toBe("indeterminado");
  });
});

describe("§6.5 control discriminante", () => {
  it("si 150 no pierde nada que 300 detecta: discriminantControlFailed, detener, y ningún brazo pasa", () => {
    const summary = summarizeDpiDown(input({ patches: {} }));
    expect(summary.discriminantControlFailed).toBe(true);
    expect(summary.campaignShouldStop).toBe(true);
    expect([250, 200, 150].map((dpi) => verdict(summary, dpi))).toEqual([
      "indeterminado",
      "indeterminado",
      "indeterminado",
    ]);
    const line = dpiDownResultLine(summary);
    expect(line).toContain("DETENER-CAMPANA=true");
    expect(line).toContain("discriminantControlFailed=true");
    expect(summary.discriminantControlNote).toContain("no discrimina");
  });

  it("dispara también con 150 indeterminado (sin umbral) o con 150 que falla por otro criterio", () => {
    const sinUmbral = summarizeDpiDown(input({ patches: {}, minCoverageRaw: null }));
    expect(verdict(sinUmbral, 150)).toBe("indeterminado");
    expect(sinUmbral.discriminantControlFailed).toBe(true);
    expect(sinUmbral.campaignShouldStop).toBe(true);
    const otroCriterio = summarizeDpiDown(
      input({ patches: { "S12-d150-rep1": { recoverySteps: 3 } } }),
    );
    expect(verdict(otroCriterio, 150)).toBe("no-pasa");
    expect(otroCriterio.discriminantControlFailed).toBe(true);
  });

  it("si 150 pierde solo en S6, que no decide, tampoco discrimina", () => {
    const summary = summarizeDpiDown(input({ patches: { "S6-d150-rep1": { lostVsControl: 2 } } }));
    expect(summary.discriminantControlFailed).toBe(true);
    expect(verdict(summary, 250)).toBe("indeterminado");
  });

  it("si 150 pierde en un corpus que decide, discrimina y los demás pueden pasar", () => {
    const summary = summarizeDpiDown(
      input({
        patches: { "SD2-d150-rep1": { lostVsTruth: 3 }, "SR-d150-rep1": { lostVsControl: 1 } },
      }),
    );
    expect(summary.discriminantControlFailed).toBe(false);
    expect(summary.campaignShouldStop).toBe(false);
  });

  it("celdas del 150 ausentes o inválidas: no se concluye (null) y nadie pasa", () => {
    const summary = summarizeDpiDown(
      input({ patches: { ...DISCRIMINATES, "SE-d150-rep1": { valid: false } } }),
    );
    expect(summary.discriminantControlFailed).toBeNull();
    expect(verdict(summary, 250)).toBe("indeterminado");
    expect(summary.discriminantControlNote).toContain("SE");
  });
});

describe("hash del fixture, inkRatio, salvedades", () => {
  it("si un corpus tiene hashes distintos entre sus celdas, todas quedan inválidas", () => {
    const base = input();
    const summary = summarizeDpiDown({
      ...base,
      readCell: (corpus, dpi, repetition) => {
        const found = base.readCell(corpus, dpi, repetition);
        return found !== null && corpus === "S8" && dpi === 200
          ? { ...found, fixtureSha256: "otro" }
          : found;
      },
    });
    expect(summary.fixtureHashMismatches).toEqual([{ corpus: "S8", hashes: ["h", "otro"] }]);
    expect(summary.invalidCells.filter((c) => c.cell.startsWith("S8-"))).toHaveLength(5);
    expect(summary.invalidCells[0]?.reasons).toEqual(["fixture-hash-differs-between-cells"]);
    expect(verdict(summary, 250)).toBe("indeterminado");
    expect(dpiDownResultLine(summary)).toContain("FIXTURE-REGENERADO=S8");
  });

  it("registra el inkRatio observado por corpus y la nota de SD", () => {
    const summary = summarizeDpiDown(input());
    expect(summary.corpusFacts.SD1?.inkRatio).toEqual({ min: 0.2, max: 0.2 });
    expect(summary.corpusFacts.SD1?.note).toContain("inkRatio 1");
    expect(summary.corpusFacts.S8?.note).toBeNull();
  });

  it("salvedades del runner y detección de suspensión van al resumen y a la línea", () => {
    const summary = summarizeDpiDown(
      input({
        sleepDetection: { available: false, note: "falló la consulta" },
        caveats: [{ id: "sleep-prevention-unavailable", note: "sin SetThreadExecutionState" }],
      }),
    );
    expect(summary.validityCaveats).toHaveLength(2);
    expect(dpiDownResultLine(summary)).toContain("salvedades=2");
  });

  it("una tanda anterior al campo de suspensión no se da por sin suspensión", () => {
    expect(summarizeDpiDown(input()).validityCaveats[0]).toContain("sleep-detection-unknown");
  });

  it("los reales saltados quedan dichos y no se evalúan", () => {
    const summary = summarizeDpiDown(
      input({
        corpora: FULL.filter((c) => c !== "R2"),
        skippedCorpora: [{ corpus: "R3", reason: "ANONLY_REAL_DOC_R3 no definido" }],
      }),
    );
    expect(summary.corpora.skipped).toEqual([
      { corpus: "R3", reason: "ANONLY_REAL_DOC_R3 no definido" },
    ]);
  });
});

describe("§6.1 efectividad por página (N-2 y precisiones)", () => {
  it("N-2: 150 que pierde solo donde NO fue efectivo no demuestra nada: DETENER-CAMPANA", () => {
    const summary = summarizeDpiDown(
      input({ patches: { "R2-d150-rep1": { armEffective: false, lostVsControl: 3 } } }),
    );
    expect(summary.discriminantControlFailed).toBe(true);
    expect(summary.campaignShouldStop).toBe(true);
    expect(dpiDownResultLine(summary)).toContain("DETENER-CAMPANA=true");
    // Control de fallo: la misma pérdida con 150 efectivo sí discrimina.
    const efectivo = summarizeDpiDown(input({ patches: { "R2-d150-rep1": { lostVsControl: 3 } } }));
    expect(efectivo.discriminantControlFailed).toBe(false);
  });

  it("brazo no efectivo en un real que difiere del control: control inconsistente, con salvedad y sin cambiar el veredicto", () => {
    const summary = summarizeDpiDown(
      input({
        patches: {
          ...DISCRIMINATES,
          "R2-d250-rep1": { armEffective: false, lostVsControl: 2, addedVsReference: 1 },
        },
      }),
    );
    expect(summary.controlInconsistencies).toEqual([
      { arm: 250, corpus: "R2", lostVsControl: 2, addedVsControl: 1 },
    ]);
    expect(summary.validityCaveats.join(" ")).toContain("control-inconsistente");
    expect(verdict(summary, 250)).toBe("pasa");
    expect(summary.arms["250"]?.failures).toEqual([]);
    expect(summarizeDpiDown(input()).controlInconsistencies).toEqual([]);
  });

  it("brazo parcialmente efectivo en un real: el corpus es indeterminado y dice en cuántas páginas", () => {
    const summary = summarizeDpiDown(
      input({
        patches: { ...DISCRIMINATES, "R2-d200-rep1": { pages: { effective: 7, total: 20 } } },
      }),
    );
    expect(verdict(summary, 200)).toBe("indeterminado");
    expect(summary.arms["200"]?.indeterminate[0]?.detail).toContain("7 de 20 páginas");
    expect(summary.arms["200"]?.perCorpus.R2?.effectivePages).toEqual({ effective: 7, total: 20 });
    expect(verdict(summary, 250)).toBe("pasa");
  });

  it("sonda del revisor: 250 efectivo solo en SE (no efectivo en los demás sintéticos) es indeterminado, no pasa", () => {
    const base = input({ patches: DISCRIMINATES });
    const summary = summarizeDpiDown({
      ...base,
      readCell: (corpus, dpi, repetition) => {
        const found = base.readCell(corpus, dpi, repetition);
        return found !== null && dpi === 250 && corpus !== "SE"
          ? { ...found, armEffective: false }
          : found;
      },
    });
    expect(verdict(summary, 250)).toBe("indeterminado");
    expect(summary.arms["250"]?.indeterminate.some((r) => r.detail.includes("sintético"))).toBe(
      true,
    );
  });
});

describe("S6 ausente (no bloqueante)", () => {
  it("deja la salvedad y la marca en la línea final; con S6 presente no", () => {
    const sin = summarizeDpiDown(input({ corpora: FULL.filter((c) => c !== "S6") }));
    expect(sin.validityCaveats.join(" ")).toContain("s6-ausente");
    expect(dpiDownResultLine(sin)).toContain("S6-AUSENTE");
    expect(dpiDownResultLine(summarizeDpiDown(input()))).not.toContain("S6-AUSENTE");
  });
});

describe("SD: el resumen lista qué perdió cada uno por variante (límite de totales)", () => {
  it("lostByControl y lostByArm por variante", () => {
    const summary = summarizeDpiDown(
      input({
        patches: {
          ...DISCRIMINATES,
          "SD2-d300-rep1": { lostKeys: ["a"] },
          "SD2-d200-rep1": { lostKeys: ["b"] },
        },
      }),
    );
    const sd2 = summary.arms["200"]?.sd?.perVariant.find((v) => v.variant === "SD2");
    expect(sd2).toMatchObject({
      lostByControl: ["a"],
      lostByArm: ["b"],
      armLosesWhere300Detects: 1,
    });
  });
});
