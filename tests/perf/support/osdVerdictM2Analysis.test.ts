import { describe, expect, it } from "vitest";

import {
  SV_THRESHOLDS,
  analyzeCp,
  analyzeMargin,
  analyzeRc,
  analyzeSv,
  spread,
  summarizeReal,
  svSetOf,
  targetAngle,
  validateSimulation,
} from "./osdVerdictM2Analysis.js";
import { EMPTY_READING, reading, simPageOf } from "./osdVerdictM2TestSupport.js";
import type { MeasuredRun, SimPage } from "./osdVerdictSim.js";

const measuredRun = (overrides: Partial<MeasuredRun>): MeasuredRun => ({
  angles: [0],
  upscaled: false,
  finalAngle: 0,
  final: { words: 0, reliable: 0, conf: 0 },
  unreadable: false,
  ok: false,
  body: null,
  stamp: null,
  entityCount: 0,
  ...overrides,
});

const NO_DATA = reading(0, 0, { ok: false });

/*
 * Páginas hechas a mano para poder seguir las cuentas:
 *
 * - A, denso, con veredicto natural correcto: se recupera siempre.
 * - B, escaso: sin veredicto, primera lectura con basura fiable; tinta debajo del umbral.
 * - C, un renglón de costado (N1): sin veredicto, primera lectura vacía, tinta 0,0015.
 * - D, control de ruido (corpus viejo); E, hoja de ruido de M-O2 que a 90° inventa 8 palabras.
 * - F, margen M1 (solo sello).
 * - G, como N4: la lectura correcta tiene 2 palabras y la basura de 0° tiene 4.
 * - H, el paso 2 elige por palabras: el ángulo equivocado tiene 5 palabras de basura y el correcto 2.
 */
const A = simPageOf({
  key: "full-150-0",
  label: "full",
  had: true,
  orientation: 0,
  ink: 0.13,
  correctAngle: 0,
  readings: {
    0: reading(30, 0.9, { ok: true }),
    90: reading(3, 0.2, { ok: false }),
    180: NO_DATA,
    270: reading(2, 0.3, { ok: false }),
  },
});
const B = simPageOf({
  key: "two-lines-150-180",
  label: "two-lines",
  dpi: 150,
  ink: 0.001,
  correctAngle: 180,
  readings: {
    0: reading(1, 0.7, { ok: false }),
    90: NO_DATA,
    180: reading(4, 0.95, { ok: true }),
    270: reading(2, 0.5, { ok: false }),
  },
  measured: {
    0: measuredRun({}),
    90: measuredRun({}),
    270: measuredRun({}),
  },
});
const C = simPageOf({
  key: "N1-300-90",
  label: "N1",
  ink: 0.0015,
  correctAngle: 270,
  readings: { 0: NO_DATA, 90: NO_DATA, 180: NO_DATA, 270: reading(3, 0.8, { ok: true }) },
  measured: { 0: measuredRun({}), 90: measuredRun({}), 180: measuredRun({}) },
});
const D = simPageOf({
  key: "noise-150-0",
  group: "m1-control",
  label: "noise",
  ink: 0.0011,
  dpi: 150,
  readings: { 0: EMPTY_READING, 90: EMPTY_READING, 180: EMPTY_READING, 270: EMPTY_READING },
});
const E = simPageOf({
  key: "RU5-150-0",
  group: "noise",
  label: "RU5",
  ink: 0.0019,
  dpi: 150,
  readings: {
    0: EMPTY_READING,
    90: reading(8, 0.7),
    180: EMPTY_READING,
    270: EMPTY_READING,
  },
  warmMs: { 0: 200, 90: 300, 180: 400, 270: 500 },
  measured: { natural: measuredRun({ entityCount: 2 }) },
});
const F = simPageOf({
  key: "M1-150-0",
  group: "margin",
  label: "M1",
  dpi: 150,
  ink: 0.0021,
  correctAngle: 0,
  readings: {
    0: reading(5, 0.69, { stamp: false }),
    90: reading(4, 0.96, { stamp: true }),
    180: reading(4, 0.53, { stamp: false }),
    270: reading(2, 0.42, { stamp: false }),
  },
  measured: { natural: measuredRun({ ok: null, body: null, stamp: true }) },
});
const G = simPageOf({
  key: "header-150-180",
  label: "header",
  had: true,
  orientation: 180,
  correctAngle: 180,
  readings: {
    0: reading(4, 0.77, { ok: false }),
    90: NO_DATA,
    180: reading(2, 0.89, { ok: true }),
    270: NO_DATA,
  },
});
const H = simPageOf({
  key: "signature-150-0",
  label: "signature",
  correctAngle: 0,
  readings: {
    0: reading(2, 0.9, { ok: true }),
    90: reading(5, 0.4, { ok: false }),
    180: NO_DATA,
    270: NO_DATA,
  },
  measured: { 90: measuredRun({}) },
});
const pages: SimPage[] = [A, B, C, D, E, F, G, H];

describe("osdVerdictM2Analysis", () => {
  describe("analyzeRc", () => {
    const rc = analyzeRc(pages);

    it("considera el corpus de M-O1 (con texto y controles) y el ruido, y no el margen", () => {
      expect(rc.pages).toBe(7);
      expect(rc.byGroup["m1-text"]?.pages).toBe(5);
      expect(rc.byGroup["m1-control"]?.pages).toBe(1);
      expect(rc.byGroup.noise?.pages).toBe(1);
      expect(rc.byGroup.margin).toBeUndefined();
    });

    it("lista las páginas que RC suma a los cuatro ángulos, con lo que habría entregado", () => {
      expect(rc.rows.map((row) => row.key)).toEqual(["N1-300-90", "noise-150-0", "RU5-150-0"]);
      const [c, d, e] = rc.rows;
      expect(c).toMatchObject({
        todayReadings: 1,
        rcReadings: 4,
        rcAngle: 270,
        todayOutcome: "leak",
        rcOutcome: "recovered",
        reliableReadings: 1,
      });
      // Las hojas sin datos esperados no tienen qué recuperar.
      expect(d).toMatchObject({ todayOutcome: "n/a", rcOutcome: "n/a", reliableReadings: 0 });
      expect(e).toMatchObject({ rcAngle: 90, reliableReadings: 1, entityCount: 2 });
    });

    it("cuenta por conjunto cuántas manda RC y cuántas recuperan hoy y con RC", () => {
      expect(rc.byGroup["m1-text"]).toEqual({
        pages: 5,
        probedByRc: 1,
        recoveredToday: 3,
        recoveredRc: 4,
        withReliableReading: 5,
      });
      expect(rc.byGroup.noise).toMatchObject({ pages: 1, probedByRc: 1, recoveredToday: 0 });
      expect(rc.byLabel["m1-text:N1"]).toMatchObject({ pages: 1, probedByRc: 1, recoveredRc: 1 });
    });

    it("cuenta las lecturas de ruido con palabras y con una palabra confiable, y las entidades", () => {
      expect(rc.noiseTotal).toEqual({ readings: 4, withWords: 1, withReliableWord: 1 });
      expect(rc.noiseByLabel.RU5).toEqual({ readings: 4, withWords: 1, withReliableWord: 1 });
      expect(rc.noiseEntities).toEqual({ observations: 1, withEntities: 1, total: 2 });
    });

    it("mide tres lecturas más en frío y, con muestra, en caliente", () => {
      expect(rc.time.pages).toBe(3);
      expect(rc.time.cold.n).toBe(3);
      expect(rc.time.cold.medianSec).toBe(3);
      expect(rc.time.warm.n).toBe(1);
      expect(rc.time.warm.medianSec).toBeCloseTo(1.2, 9);
    });
  });

  describe("analyzeCp", () => {
    const cp = analyzeCp(pages);

    it("en producción CP solo cambia las páginas que reciben veredicto natural", () => {
      const cell = cp.cells["m1-text|production"];
      // G recibe el veredicto correcto y hoy pierde contra la basura de 0°; las demás no reciben veredicto.
      expect(cell?.today).toEqual({ n: 5, recovered: 3, warned: 0, leak: 2 });
      expect(cell?.cp).toEqual({ n: 5, recovered: 4, warned: 0, leak: 1 });
      expect(cell?.changed).toBe(1);
      expect(cp.toRecovered.filter((c) => c.scenario === "production").map((c) => c.key)).toEqual([
        "header-150-180",
      ]);
    });

    it("con el veredicto correcto forzado, CP recupera la lectura que hoy pisa la basura con más palabras", () => {
      const cell = cp.cells["m1-text|forced-correct"];
      expect(cell?.today.n).toBe(5);
      expect(cell?.today.recovered).toBe(4);
      expect(cell?.cp.recovered).toBe(5);
      expect(
        cp.toRecovered.filter((c) => c.scenario === "forced-correct").map((c) => c.key),
      ).toContain("header-150-180");
    });

    it("con el veredicto equivocado forzado, CP cierra solo lo que el paso 2 puede cerrar", () => {
      const cell = cp.cells["m1-text|forced-wrong"];
      expect(cell?.today.n).toBe(15);
      // A siempre se recupera; B, C y G se pierden; H se pierde solo con el ángulo con basura de 5 palabras.
      expect(cell?.today).toMatchObject({ recovered: 5, leak: 10 });
      expect(cell?.cp).toMatchObject({ recovered: 6, leak: 9 });
      expect(cp.toRecovered.map((c) => `${c.key}/${c.verdict}`)).toContain("signature-150-0/90");
    });

    it("lista de recuperada a fuga lo que CP rompe (nada en este conjunto) y marca el agrandado sin simular", () => {
      expect(cp.toLeak).toEqual([]);
      expect(cp.cells["m1-text|forced-wrong"]?.upscaleUnknown).toBe(0);
    });

    it("entre las fugas medidas de M-O1, cuántas cierra CP solo", () => {
      expect(cp.m1Leaks).toEqual({
        measuredLeaks: 7,
        simulatedTodayLeaks: 7,
        closedByCp: 1,
        stillLeakWithCp: 6,
        closedKeys: ["signature-150-0/90"],
      });
    });

    it("el margen M1 cuenta aparte: CP elige la lectura del sello con mayor confianza de página", () => {
      const wrong = cp.cells["margin|forced-wrong"];
      expect(wrong?.today).toMatchObject({ n: 3, recovered: 0, leak: 3 });
      expect(wrong?.cp).toMatchObject({ recovered: 1, leak: 2 });
      expect(cp.toRecovered.find((c) => c.key === "M1-150-0")).toMatchObject({
        scenario: "forced-wrong",
        verdict: "90",
        todayAngle: 0,
        cpAngle: 90,
      });
    });

    it("valida la simulación contra lo medido", () => {
      expect(cp.validation.runs).toBe(0 + validateSimulation(pages).runs);
    });
  });

  describe("analyzeSv", () => {
    const sv = analyzeSv(pages);
    const cell = (set: string, threshold: number) => {
      const found = sv.cells[`${set}|${threshold}`];
      if (found === undefined) throw new Error(`sin celda ${set}|${threshold}`);
      return found;
    };

    it("barre los cinco umbrales por conjunto y deja afuera el ruido y los controles", () => {
      expect(Object.keys(sv.cells).filter((id) => id.startsWith("M-O1 sintético|"))).toHaveLength(
        SV_THRESHOLDS.length,
      );
      expect(Object.keys(sv.cells).some((id) => id.startsWith("R1|"))).toBe(false);
      expect(cell("M-O1 sintético", 0.5).pages).toBe(5);
      expect(cell("margen", 0.5).pages).toBe(1);
    });

    it("el costo: páginas bien orientadas en las que dispara", () => {
      expect(cell("M-O1 sintético", 0.5).firesOnWellOriented).toBe(0);
      // Solo C (confianza 0,8) queda debajo de 0,85.
      expect(cell("M-O1 sintético", 0.85).firesOnWellOriented).toBe(1);
    });

    it("lo que se le escapa: lecturas equivocadas con confianza de página mayor o igual que T", () => {
      expect(cell("M-O1 sintético", 0.5)).toMatchObject({ wrongReadings: 15, escapes: 3 });
      expect(cell("M-O1 sintético", 0.8).escapes).toBe(0);
    });

    it("con un veredicto equivocado forzado: fugas con hoy, con CP y con SV + CP", () => {
      const low = cell("M-O1 sintético", 0.5);
      expect(low).toMatchObject({ forcedWrong: 15, leaksToday: 10, leaksCp: 9, leaksSvCp: 5 });
      expect(cell("M-O1 sintético", 0.85).leaksSvCp).toBe(0);
      const leaks = SV_THRESHOLDS.map((t) => cell("M-O1 sintético", t).leaksSvCp);
      for (let i = 1; i < leaks.length; i += 1)
        expect(leaks[i] ?? 0).toBeLessThanOrEqual(leaks[i - 1] ?? 0);
    });

    it("el ángulo objetivo es el correcto en los sintéticos y la referencia en los reales", () => {
      expect(targetAngle(B)).toBe(180);
      const real = simPageOf({
        key: "R1-p01",
        group: "real",
        label: "R1",
        correctAngle: null,
        readings: { 0: NO_DATA, 90: reading(3, 0.9), 180: NO_DATA, 270: NO_DATA },
      });
      expect(targetAngle(real)).toBe(90);
      expect(svSetOf(real)).toBe("R1");
      expect(svSetOf({ ...real, label: "R4" })).toBe("R2 a R4");
      expect(svSetOf(E)).toBeNull();
      expect(svSetOf(D)).toBeNull();
    });

    it("una página real sin lectura fiable en ningún ángulo no entra", () => {
      const none = simPageOf({
        key: "R2-p01",
        group: "real",
        label: "R2",
        correctAngle: null,
        readings: { 0: NO_DATA, 90: NO_DATA, 180: NO_DATA, 270: NO_DATA },
      });
      expect(Object.keys(analyzeSv([none]).cells)).toEqual([]);
    });
  });

  describe("páginas reales", () => {
    const real = simPageOf({
      key: "R1-p01",
      group: "real",
      label: "R1",
      correctAngle: null,
      had: true,
      orientation: 0,
      ink: 0.05,
      readings: {
        0: reading(10, 0.9),
        90: reading(5, 0.4),
        180: EMPTY_READING,
        270: reading(3, 0.2),
      },
      measured: {
        natural: measuredRun({ entityCount: 2 }),
        90: measuredRun({ finalAngle: 90 }),
        180: measuredRun({ finalAngle: 0 }),
        270: measuredRun({ finalAngle: 270, unreadable: true }),
      },
    });
    const dark = simPageOf({
      key: "R1-p02",
      group: "real",
      label: "R1",
      correctAngle: null,
      ink: 0.001,
      readings: { 0: EMPTY_READING, 90: EMPTY_READING, 180: EMPTY_READING, 270: EMPTY_READING },
    });

    it("resume la confianza de referencia y de las lecturas equivocadas", () => {
      const summary = summarizeReal([real]);
      expect(summary.pages).toBe(1);
      expect(summary.noReference).toBe(0);
      expect(summary.referenceConfidence).toMatchObject({ n: 1, min: 0.9, median: 0.9, max: 0.9 });
      expect(summary.wrongConfidence).toMatchObject({ n: 3, min: 0, max: 0.4 });
      expect(summary.naturalAgrees).toBe(1);
      expect(summary.inkMin).toBe(0.05);
      expect(summary.productionEntities.pagesWithEntities).toBe(1);
    });

    it("con un veredicto equivocado forzado cuenta qué ángulo entrega el producto de hoy y si avisa", () => {
      expect(summarizeReal([real]).forcedWrong).toEqual({
        observations: 3,
        deliversReference: 1,
        deliversOtherAngleWithoutWarning: 1,
        warned: 1,
        otherAngleWithWarning: 1,
        unknown: 0,
      });
    });

    it("una página sin lectura fiable no tiene referencia, y la tinta baja se cuenta", () => {
      const summary = summarizeReal([real, dark]);
      expect(summary.pages).toBe(2);
      expect(summary.noReference).toBe(1);
      expect(summary.inkMin).toBe(0.001);
      expect(summary.inkBelowThreshold).toBe(1);
      expect(summary.referenceConfidence.n).toBe(1);
    });

    it("distingue veredicto que coincide, que no coincide y ausente", () => {
      const disagree = { ...real, key: "R1-p03", natural: { had: true, orientation: 180 } };
      const none = { ...real, key: "R1-p04", natural: { had: false, orientation: 0 } };
      const summary = summarizeReal([real, disagree, none]);
      expect([summary.naturalAgrees, summary.naturalDisagrees, summary.noVerdict]).toEqual([
        1, 1, 1,
      ]);
    });
  });

  describe("analyzeMargin", () => {
    it("cuenta por separado cuerpo y sello, en lo medido y en las dos simulaciones", () => {
      const margin = analyzeMargin(pages);
      const production = margin.rows["M1|production"];
      expect(production?.measured).toEqual({ n: 1, body: 1, stamp: 1, both: 1 });
      expect(production?.simToday.stamp).toBe(1);
      const wrong = margin.rows["M1|forced-wrong"];
      expect(wrong?.simToday).toEqual({ n: 3, body: 3, stamp: 0, both: 0 });
      expect(wrong?.simCp).toEqual({ n: 3, body: 3, stamp: 1, both: 1 });
      expect(wrong?.measured.n).toBe(0);
    });
  });

  describe("auxiliares", () => {
    it("spread da mínimo, p10, mediana, p90 y máximo", () => {
      expect(spread([5, 1, 3, 2, 4])).toEqual({
        n: 5,
        min: 1,
        p10: 1.4,
        median: 3,
        p90: 4.6,
        max: 5,
      });
      expect(spread([])).toEqual({
        n: 0,
        min: null,
        p10: null,
        median: null,
        p90: null,
        max: null,
      });
    });

    it("validateSimulation cuenta los acuerdos y lista los desacuerdos", () => {
      const agree = simPageOf({
        key: "P-150-0",
        had: false,
        readings: {
          0: reading(5, 0.5),
          90: reading(4, 0.9),
          180: EMPTY_READING,
          270: EMPTY_READING,
        },
        measured: {
          natural: measuredRun({
            angles: [0, 90, 180, 270],
            final: { words: 4, reliable: 4, conf: 0.9 },
          }),
          90: measuredRun({ angles: [0], final: { words: 4, reliable: 4, conf: 0.9 } }),
        },
      });
      const validation = validateSimulation([agree]);
      expect(validation.runs).toBe(2);
      expect(validation.sameAngles).toBe(1);
      expect(validation.disagreements.map((d) => d.scenario)).toEqual(["90"]);
    });
  });
});
