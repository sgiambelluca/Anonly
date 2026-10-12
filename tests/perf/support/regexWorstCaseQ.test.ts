import { describe, expect, it } from "vitest";

import {
  NOISE_FLOOR_MS,
  Q_LABELS,
  doublingSteps,
  expectedQEmailDetections,
  isQLabel,
  linearityVerdict,
  makeQAdversarialText,
  median,
  medianCurve,
  qWords,
} from "./regexWorstCaseQ.js";

/** La expresión de referencia de `Regex_Engine.md` §13 caso 35 (oráculo; sobre textos chicos). */
const REFERENCE =
  /\b(?:[a-z0-9._%+-]*[a-z0-9]\. ){0,2}[a-z0-9._%+-]*[a-z0-9]Q[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\b/g;

describe("makeQAdversarialText", () => {
  it.each(Q_LABELS)(
    "%s: largo pedido, sin arroba y con muchas Q (salvo la corrida larga)",
    (label) => {
      for (const chars of [2 * 1024, 10 * 1024]) {
        const text = makeQAdversarialText(chars, label);
        expect(text.length).toBe(chars);
        expect(text).not.toContain("@");
      }
      const text = makeQAdversarialText(10 * 1024, label);
      const qCount = [...text].filter((character) => character === "Q").length;
      if (label === "adversarial-q-long-local") expect(qCount).toBe(1);
      else expect(qCount).toBeGreaterThan(50);
    },
  );

  it("el oráculo de ADR-211 da 0, 1 y 1 emails sobre los tres textos", () => {
    for (const label of Q_LABELS) {
      const text = makeQAdversarialText(2 * 1024, label);
      expect([...text.matchAll(REFERENCE)]).toHaveLength(expectedQEmailDetections(label));
    }
  });

  it("el email del final lleva dos tramos «nombre. » y la Q", () => {
    const text = makeQAdversarialText(2 * 1024, "adversarial-q-late-domain");
    expect(text.endsWith(`${"a".repeat(40)}. ${"a".repeat(40)}Qexample.org`)).toBe(true);
    expect(text.split(" ").length).toBeGreaterThan(10);
  });

  it("la corrida larga es un solo token: un nombre de minúsculas seguido de Qexample.org", () => {
    const text = makeQAdversarialText(1024, "adversarial-q-long-local");
    expect(qWords(text)).toHaveLength(1);
    expect(text).toMatch(/^a+Qexample\.org$/);
  });

  it("el texto es determinista", () => {
    expect(makeQAdversarialText(4096, "adversarial-q")).toBe(
      makeQAdversarialText(4096, "adversarial-q"),
    );
  });
});

describe("isQLabel", () => {
  it("reconoce solo las etiquetas Q", () => {
    expect(isQLabel("adversarial-q")).toBe(true);
    expect(isQLabel("adversarial")).toBe(false);
    expect(isQLabel("normal")).toBe(false);
  });
});

describe("curva y criterio de linealidad", () => {
  it("mediana de las rondas por tamaño, en orden de tamaño", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(
      medianCurve([
        { sizeKiB: 20, ms: 4 },
        { sizeKiB: 10, ms: 9 },
        { sizeKiB: 10, ms: 1 },
        { sizeKiB: 10, ms: 2 },
      ]),
    ).toEqual([
      { sizeKiB: 10, ms: 2 },
      { sizeKiB: 20, ms: 4 },
    ]);
  });

  it("solo compara tamaños que son exactamente el doble", () => {
    const steps = doublingSteps([
      { sizeKiB: 2, ms: 10 },
      { sizeKiB: 10, ms: 20 },
      { sizeKiB: 20, ms: 40 },
      { sizeKiB: 40, ms: 80 },
    ]);
    expect(steps.map((step) => [step.fromKiB, step.toKiB])).toEqual([
      [10, 20],
      [20, 40],
    ]);
  });

  it("un tiempo que se duplica con el largo es lineal", () => {
    const verdict = linearityVerdict(
      "adversarial-q",
      [10, 20, 40, 80, 160].map((sizeKiB) => ({ sizeKiB, ms: sizeKiB * 0.5 })),
    );
    expect(verdict.superLinear).toBe(false);
    expect(verdict.interpretableSteps).toBe(4);
    expect(verdict.steps.every((step) => step.ratio === 2)).toBe(true);
  });

  it("un tiempo que se cuadruplica al duplicar el largo es cuadrático", () => {
    const verdict = linearityVerdict(
      "adversarial-q-late-domain",
      [10, 20, 40, 80, 160].map((sizeKiB) => ({ sizeKiB, ms: sizeKiB ** 2 / 10 })),
    );
    expect(verdict.superLinear).toBe(true);
    expect(verdict.steps.every((step) => step.superLinear)).toBe(true);
  });

  it("por debajo del piso de ruido el cociente no se interpreta, aunque sea 4", () => {
    const steps = doublingSteps([
      { sizeKiB: 10, ms: 0.1 },
      { sizeKiB: 20, ms: 0.5 },
    ]);
    expect(steps[0]).toMatchObject({ ratio: 5, belowNoiseFloor: true, superLinear: false });
    expect(0.5).toBeLessThan(NOISE_FLOOR_MS);
  });

  it("un tiempo de partida cero no da cociente", () => {
    const steps = doublingSteps([
      { sizeKiB: 10, ms: 0 },
      { sizeKiB: 20, ms: 10 },
    ]);
    expect(steps[0]).toMatchObject({ ratio: null, superLinear: false });
  });
});
