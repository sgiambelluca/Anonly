import { describe, expect, it } from "vitest";

import type { M3Arm, M3Doc, M3Run } from "./osdVerdictM3.js";
import {
  analyzeDeliveries,
  analyzeMemory,
  analyzeRecognitions,
  analyzeTime,
  anglesRead,
  classifyAgainstNoise,
  comparePages,
  deliveredAngle,
  hasFourReadings,
  median,
  notFourReason,
  spreadOf,
  summarizeRuns,
} from "./osdVerdictM3Analysis.js";
import { makePage, makeRun, type RunSpec } from "./osdVerdictM3TestSupport.js";

function runs(
  doc: M3Doc,
  arm: M3Arm,
  peaks: ReadonlyArray<readonly [number, number]>,
  extra: Partial<RunSpec> = {},
): M3Run[] {
  return peaks.map(([cold, hot], index) =>
    makeRun({ doc, arm, rep: index + 1, coldPeakMb: cold, hotPeakMb: hot, ...extra }),
  );
}

describe("osdVerdictM3Analysis: auxiliares", () => {
  it("la mediana y el rango", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(spreadOf([5, 1, 3])).toMatchObject({ min: 1, median: 3, max: 5 });
    expect(spreadOf([])).toMatchObject({ min: null, median: null, max: null });
  });

  it("una diferencia se distingue del ruido solo si supera 345 MB y los rangos no se pisan", () => {
    const a = spreadOf([2000e6, 2050e6, 2100e6]);
    expect(classifyAgainstNoise(a, spreadOf([2100e6, 2150e6, 2200e6]))).toMatchObject({
      diff: 100e6,
      verdict: "dentro del ruido",
    });
    expect(classifyAgainstNoise(a, spreadOf([2600e6, 2650e6, 2700e6]))).toMatchObject({
      diff: 600e6,
      disjoint: true,
      verdict: "se distingue del ruido",
    });
    // Mediana 400 MB más alta pero con un rango que pisa al de A: ambiguo.
    expect(classifyAgainstNoise(a, spreadOf([2050e6, 2450e6, 2900e6]))).toMatchObject({
      diff: 400e6,
      disjoint: false,
      verdict: "ambiguo",
    });
    // Hacia abajo también.
    expect(
      classifyAgainstNoise(spreadOf([3000e6, 3100e6]), spreadOf([2000e6, 2100e6]))?.verdict,
    ).toBe("se distingue del ruido");
    expect(classifyAgainstNoise(spreadOf([]), a)).toBeNull();
  });
});

describe("analyzeMemory", () => {
  const all = [
    ...runs("P2", "A0", [
      [2790, 2810],
      [2800, 2820],
      [2810, 2830],
    ]),
    ...runs("P2", "A", [
      [2800, 2800],
      [2850, 2850],
      [2900, 2900],
    ]),
    ...runs("P2", "B", [
      [3300, 3350],
      [3400, 3500],
      [3450, 3550],
    ]),
    ...runs("R1", "A", [
      [1400, 1500],
      [1450, 1550],
      [1500, 1600],
    ]),
    ...runs("R1", "C", [
      [1400, 1500],
      [1500, 1600],
      [1600, 1700],
    ]),
  ];
  const memory = analyzeMemory(all);

  it("da por celda el pico mediano y el rango, en frío y en caliente", () => {
    const cell = memory.cells.find((c) => c.doc === "P2" && c.arm === "B");
    expect(cell).toMatchObject({ runs: 3, failedRuns: 0 });
    expect(cell?.cold).toMatchObject({ min: 3300e6, median: 3400e6, max: 3450e6 });
    expect(cell?.hot).toMatchObject({ min: 3350e6, median: 3500e6, max: 3550e6 });
  });

  it("calcula B − A y C − A contra el ruido, y A − A0 como efecto del observador", () => {
    const diff = (doc: M3Doc, arm: M3Arm, versus: M3Arm, temperature: "cold" | "hot") =>
      memory.diffs.find(
        (d) =>
          d.doc === doc && d.arm === arm && d.versus === versus && d.temperature === temperature,
      );
    expect(diff("P2", "B", "A", "cold")).toMatchObject({
      medianDiffBytes: 550e6,
      maxDiffBytes: 550e6,
      rangesDisjoint: true,
      verdict: "se distingue del ruido",
    });
    expect(diff("P2", "A", "A0", "cold")).toMatchObject({
      medianDiffBytes: 50e6,
      verdict: "dentro del ruido",
    });
    expect(diff("R1", "C", "A", "hot")).toMatchObject({
      medianDiffBytes: 50e6,
      verdict: "dentro del ruido",
    });
    // R1 no tiene brazo B ni A0 en este conjunto de prueba.
    expect(diff("R1", "B", "A", "cold")).toBeUndefined();
  });

  it("compara P2 con el techo de 3,0 GB y dice el margen", () => {
    const row = (arm: M3Arm, temperature: "cold" | "hot") =>
      memory.ceiling.find((c) => c.doc === "P2" && c.arm === arm && c.temperature === temperature);
    expect(row("A", "cold")).toMatchObject({
      maxBytes: 2900e6,
      marginBytes: 100e6,
      exceeds: false,
    });
    expect(row("B", "hot")).toMatchObject({ maxBytes: 3550e6, marginBytes: -550e6, exceeds: true });
    expect(memory.ceiling.some((c) => c.doc === "R1")).toBe(false);
  });

  it("una importación fallida cuenta como corrida fallida y no entra al pico", () => {
    const failing = [
      ...runs("P2", "B", [
        [3000, 3000],
        [3100, 3100],
      ]),
      makeRun({ doc: "P2", arm: "B", rep: 3, ok: false, coldPeakMb: 9999 }),
    ];
    const cell = analyzeMemory(failing).cells[0];
    expect(cell).toMatchObject({ runs: 3, failedRuns: 1 });
    expect(cell?.cold.max).toBe(3100e6);
  });
});

describe("analyzeTime", () => {
  const rows = analyzeTime([
    ...runs(
      "R1",
      "A",
      [
        [1, 1],
        [1, 1],
        [1, 1],
      ],
      { coldReadyMs: 20_000, hotReadyMs: 16_000 },
    ),
    ...runs(
      "R1",
      "B",
      [
        [1, 1],
        [1, 1],
        [1, 1],
      ],
      { coldReadyMs: 70_000, hotReadyMs: 64_000 },
    ),
  ]);

  it("da el tiempo hasta Ready, los segundos por página y el factor contra A", () => {
    const a = rows.find((r) => r.arm === "A");
    const b = rows.find((r) => r.arm === "B");
    expect(a).toMatchObject({ pages: 20, coldFactorVsA: null });
    expect(a?.coldSecondsPerPage).toBeCloseTo(1, 9);
    expect(b?.coldSecondsPerPage).toBeCloseTo(3.5, 9);
    expect(b?.coldFactorVsA).toBeCloseTo(3.5, 9);
    expect(b?.hotFactorVsA).toBeCloseTo(4, 9);
    // 20 páginas, cuatro lecturas cada una.
    expect(b?.recognitionsPerRunCold).toBe(80);
    expect(a?.recognitionsPerRunCold).toBe(20);
  });
});

describe("analyzeRecognitions", () => {
  it("cuenta las páginas con las cuatro lecturas y explica las que no", () => {
    // Dos páginas de R1 con tinta baja y sin palabra confiable en la primera lectura: el forzado a «sin
    // veredicto» no las manda a los cuatro ángulos.
    const blank = (index: number) =>
      index === 3 || index === 4 ? { ink: 0.001, reliableFirst: 0, angles: [0] } : {};
    const b = makeRun({ doc: "R1", arm: "B", pages: 20, pageSpec: blank });
    const [row] = analyzeRecognitions([b]);
    expect(row).toMatchObject({ doc: "R1", arm: "B", runs: 1, pagesPerRun: 20, pagesWithFour: 18 });
    expect(row?.histogram).toEqual({ "1": 2, "4": 18 });
    expect(row?.withoutFour).toEqual([
      { page: "R1-p04", reason: "sin palabra confiable y tinta debajo del umbral" },
      { page: "R1-p05", reason: "sin palabra confiable y tinta debajo del umbral" },
    ]);
  });

  it("los ángulos leídos no cuentan el reintento agrandado", () => {
    const page = makePage("B", 0, { angles: [0, 90, 180] });
    expect(anglesRead(page)).toEqual([0, 90, 180]);
    expect(hasFourReadings(page)).toBe(false);
    const withUpscale = {
      ...page,
      attempts: [...page.attempts, { ...page.attempts[0]!, order: 3, angle: 270, upscale: 2 }],
    };
    expect(hasFourReadings(withUpscale)).toBe(false);
    expect(hasFourReadings(makePage("B", 0))).toBe(true);
    expect(notFourReason(withUpscale)).toBe("otra");
    expect(notFourReason(makePage("A", 0, { angles: [0] }))).toBe("el veredicto sigue presente");
  });

  it("A no hace las cuatro lecturas en una página con veredicto, y sin observador no hay nada que contar", () => {
    const [row] = analyzeRecognitions([makeRun({ doc: "P2", arm: "A", pages: 50 })]);
    expect(row?.pagesWithFour).toBe(0);
    expect(analyzeRecognitions([makeRun({ doc: "P2", arm: "A0", pages: 50 })])).toEqual([]);
  });
});

describe("analyzeDeliveries", () => {
  it("el ángulo entregado es el del reconocimiento cuya lectura coincide con la entregada", () => {
    expect(deliveredAngle(makePage("B", 0, { deliveredAttempt: 2 }))).toBe(180);
    expect(deliveredAngle(makePage("A", 0))).toBe(0);
    const broken = makePage("B", 0);
    expect(
      deliveredAngle({ ...broken, delivered: { ...broken.delivered!, key: "otra" } }),
    ).toBeNull();
  });

  it("compara página por página el hash, las palabras, el ángulo, las entidades y el aviso, con su sentido", () => {
    const base = [makePage("A", 0), makePage("A", 1), makePage("A", 2), makePage("A", 3)];
    const other = [
      makePage("B", 0),
      makePage("B", 1, { textHash: "otro", words: 90 }),
      makePage("B", 2, { deliveredAttempt: 1, entities: { DNI: 2 } }),
      makePage("B", 3, { unreadable: true }),
    ];
    const comparison = comparePages("R1", base, other);
    expect(comparison.pages).toBe(4);
    expect(comparison.counts).toMatchObject({ any: 3, warning: 1, entities: 1 });
    // La página 1 cambia de hash y de palabras (10 menos); la 2 de ángulo, de palabras y de hash.
    expect(comparison.changed.map((c) => c.page)).toEqual(["R1-p02", "R1-p03", "R1-p04"]);
    expect(comparison.changed[0]).toMatchObject({
      textHash: true,
      words: true,
      wordsDelta: -10,
      angle: false,
    });
    expect(comparison.changed[1]).toMatchObject({ angle: true, entities: true, entitiesDelta: 2 });
    expect(comparison.changed[2]).toMatchObject({ warning: true, warningDelta: 1 });
    expect(comparison.direction).toMatchObject({
      fewerWords: 2,
      moreEntities: 1,
      warningGained: 1,
      warningLost: 0,
    });
  });

  it("las páginas idénticas no cuentan como cambio", () => {
    const pages = [makePage("A", 0), makePage("A", 1)];
    expect(comparePages("R1", pages, pages).counts.any).toBe(0);
  });

  it("mide el piso entre repeticiones de A y las páginas que cambian más allá de él", () => {
    // A es idéntico en las tres repeticiones, salvo la página 5 de la repetición 2 (ruido del OCR).
    const a = [1, 2, 3].map((rep) =>
      makeRun({
        doc: "R1",
        arm: "A",
        rep,
        pages: 20,
        pageSpec: (i) => (rep === 2 && i === 4 ? { textHash: "ruido" } : {}),
      }),
    );
    // B cambia el hash de la página 8 en las tres repeticiones y la de la 5 en una sola.
    const b = [1, 2, 3].map((rep) =>
      makeRun({
        doc: "R1",
        arm: "B",
        rep,
        pages: 20,
        pageSpec: (i) =>
          i === 7
            ? { textHash: "forzado", words: 80 }
            : rep === 1 && i === 4
              ? { textHash: "x" }
              : {},
      }),
    );
    const [result] = analyzeDeliveries([...a, ...b], "cold");
    expect(result).toMatchObject({ doc: "R1", versus: "B" });
    expect(result?.pairs).toHaveLength(3);
    expect(result?.floor).toHaveLength(3);
    // El piso: la repetición 2 difiere de la 1 y de la 3 en una página.
    expect(result?.floor.map((p) => p.counts.any)).toEqual([1, 0, 1]);
    expect(result?.beyondFloor.map((c) => c.page)).toEqual(["R1-p08"]);
  });

  it("una repetición fallida no entra a las comparaciones", () => {
    const base = [1, 2].map((rep) => makeRun({ doc: "R1", arm: "A", rep, pages: 5 }));
    const failed = makeRun({ doc: "R1", arm: "B", rep: 1, pages: 5, ok: false });
    expect(analyzeDeliveries([...base, failed], "cold")).toEqual([]);
  });

  it("resume todo junto", () => {
    const summary = summarizeRuns([
      makeRun({ doc: "R1", arm: "A" }),
      makeRun({ doc: "R1", arm: "B" }),
    ]);
    expect(summary.memory.cells).toHaveLength(2);
    expect(summary.time).toHaveLength(2);
    expect(summary.deliveries).toHaveLength(1);
    expect(summary.deliveriesHot).toHaveLength(1);
  });
});
