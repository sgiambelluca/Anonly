import { describe, expect, it } from "vitest";

import {
  CP_ONLY,
  INK_PRESENT_RATIO,
  TODAY,
  compareWithMeasured,
  measuredOutcome,
  outcomeOf,
  pickCp,
  pickToday,
  readingHasData,
  referenceAngle,
  simulate,
  verdictFor,
  type Angle,
  type MeasuredRun,
  type SimPage,
  type SimReading,
} from "./osdVerdictSim.js";

/** Una lectura: palabras confiables, confianza de página y, si se pide, si trae los datos. */
function r(reliable: number, conf: number, ok: boolean | null = null): SimReading {
  return { words: reliable, reliable, conf, durationMs: 1000, ok, body: null, stamp: null };
}

function pageOf(options: {
  readonly readings: Partial<Record<Angle, SimReading>>;
  readonly ink?: number;
  readonly dpi?: number;
  readonly had?: boolean;
  readonly measured?: SimPage["measured"];
  readonly correctAngle?: Angle | null;
}): SimPage {
  return {
    key: "P-150-0",
    group: "m1-text",
    label: "P",
    sourceDpi: options.dpi ?? 300,
    effectiveDpi: options.dpi ?? 300,
    ink: options.ink ?? 0.05,
    correctAngle: options.correctAngle ?? 0,
    natural: { had: options.had ?? false, orientation: 0 },
    readings: options.readings,
    warmMs: {},
    measured: options.measured ?? {},
  };
}

const EMPTY = {
  words: 0,
  reliable: 0,
  conf: 0,
  durationMs: 1000,
  ok: null,
  body: null,
  stamp: null,
};

describe("osdVerdictSim", () => {
  describe("comparadores", () => {
    const held = (angle: Angle, reading: SimReading) => ({ angle, reading });

    it("hoy gana la lectura con más palabras confiables; CP, la de mayor confianza de página", () => {
      const garbage = held(0, r(4, 0.77));
      const correct = held(180, r(2, 0.89));
      expect(pickToday(correct, garbage).angle).toBe(0);
      expect(pickCp(correct, garbage).angle).toBe(180);
    });

    it("hoy empata por confianza de página; CP empata por palabras confiables y se queda con la actual", () => {
      expect(pickToday(held(0, r(3, 0.5)), held(90, r(3, 0.6))).angle).toBe(90);
      expect(pickToday(held(0, r(3, 0.6)), held(90, r(3, 0.6))).angle).toBe(0);
      expect(pickCp(held(0, r(3, 0.6)), held(90, r(5, 0.6))).angle).toBe(90);
      expect(pickCp(held(0, r(5, 0.6)), held(90, r(5, 0.6))).angle).toBe(0);
    });

    it("CP prefiere una lectura fiable a una que no lo es, y si ninguna lo es conserva la actual", () => {
      expect(pickCp(held(0, EMPTY), held(90, r(1, 0.1))).angle).toBe(90);
      expect(pickCp(held(0, r(1, 0.1)), held(90, EMPTY)).angle).toBe(0);
      expect(pickCp(held(0, EMPTY), held(90, { ...EMPTY, words: 3 })).angle).toBe(0);
    });
  });

  describe("sin veredicto (rama de la enmienda del 2026-09-28)", () => {
    it("con una palabra confiable en la primera lectura prueba los otros tres y elige por confianza de página", () => {
      const page = pageOf({
        readings: { 0: r(5, 0.5), 90: r(4, 0.9), 180: EMPTY, 270: EMPTY },
      });
      const result = simulate(page, page.natural, TODAY);
      expect(result.angles).toEqual([0, 90, 180, 270]);
      expect(result.finalAngle).toBe(90);
      expect(result.unreadable).toBe(false);
    });

    it("con tinta prueba aunque la primera lectura esté vacía; sin tinta suficiente no prueba nada", () => {
      const readings = { 0: EMPTY, 90: EMPTY, 180: EMPTY, 270: r(3, 0.8) };
      const withInk = simulate(
        pageOf({ readings, ink: INK_PRESENT_RATIO }),
        { had: false, orientation: 0 },
        TODAY,
      );
      expect(withInk.angles).toEqual([0, 90, 180, 270]);
      expect(withInk.finalAngle).toBe(270);
      const faint = simulate(
        pageOf({ readings, ink: 0.0015 }),
        { had: false, orientation: 0 },
        TODAY,
      );
      expect(faint.angles).toEqual([0]);
      expect(faint.unreadable).toBe(false);
      expect(outcomeOf(faint)).toBe("leak");
    });

    it("RC prueba los cuatro ángulos si la primera lectura no trae ninguna palabra y la tinta es mayor que cero", () => {
      const page = pageOf({
        readings: { 0: EMPTY, 90: EMPTY, 180: EMPTY, 270: r(3, 0.8, true) },
        ink: 0.0015,
      });
      const rc = simulate(page, page.natural, { ...TODAY, rc: true });
      expect(rc.angles).toEqual([0, 90, 180, 270]);
      expect(rc.finalAngle).toBe(270);
      expect(outcomeOf(rc)).toBe("recovered");
      // Con tinta cero RC no corre.
      const blank = simulate({ ...page, ink: 0 }, page.natural, { ...TODAY, rc: true });
      expect(blank.angles).toEqual([0]);
    });

    it("RC no cambia el aviso de ilegible: el umbral de tinta sigue siendo el de hoy", () => {
      const page = pageOf({
        readings: { 0: EMPTY, 90: EMPTY, 180: EMPTY, 270: EMPTY },
        ink: 0.0015,
      });
      const rc = simulate(page, page.natural, { ...TODAY, rc: true });
      expect(rc.angles).toHaveLength(4);
      expect(rc.unreadable).toBe(false);
      expect(outcomeOf(rc)).toBe("leak");
    });

    it("RC no corre si la primera lectura trae palabras, aunque ninguna sea confiable", () => {
      const page = pageOf({
        readings: { 0: { ...EMPTY, words: 2 }, 90: r(3, 0.9), 180: EMPTY, 270: EMPTY },
        ink: 0.0015,
      });
      expect(simulate(page, page.natural, { ...TODAY, rc: true }).angles).toEqual([0]);
    });
  });

  describe("con veredicto", () => {
    it("una lectura fiable en el ángulo del veredicto 0° corta la cadena (la fuga)", () => {
      const page = pageOf({
        readings: { 0: r(4, 0.77), 90: EMPTY, 180: r(2, 0.89, true), 270: EMPTY },
        correctAngle: 180,
      });
      const result = simulate(page, { had: true, orientation: 0 }, TODAY);
      expect(result.angles).toEqual([0]);
      expect(outcomeOf(result)).toBe("leak");
    });

    it("el paso 2 compara con 0°: hoy elige la basura con más palabras, CP la lectura correcta", () => {
      const page = pageOf({
        readings: { 0: r(4, 0.77), 90: EMPTY, 180: r(2, 0.89, true), 270: EMPTY },
        correctAngle: 180,
      });
      const verdict = { had: true, orientation: 180 };
      const today = simulate(page, verdict, TODAY);
      const cp = simulate(page, verdict, CP_ONLY);
      expect(today.angles).toEqual([180, 0]);
      expect(today.finalAngle).toBe(0);
      expect(outcomeOf(today)).toBe("leak");
      expect(cp.finalAngle).toBe(180);
      expect(outcomeOf(cp)).toBe("recovered");
    });

    it("sin lectura fiable recorre los ángulos que faltan en orden y corta al encontrar una", () => {
      const page = pageOf({
        readings: { 0: EMPTY, 90: EMPTY, 180: EMPTY, 270: r(3, 0.8) },
      });
      const result = simulate(page, { had: true, orientation: 90 }, TODAY);
      expect(result.angles).toEqual([90, 0, 180, 270]);
      expect(result.finalAngle).toBe(270);
      const early = simulate(
        pageOf({ readings: { 0: EMPTY, 90: EMPTY, 180: r(1, 0.7), 270: r(3, 0.8) } }),
        { had: true, orientation: 90 },
        TODAY,
      );
      expect(early.angles).toEqual([90, 0, 180]);
    });

    it("sin tinta suficiente no hace nada, ni siquiera el paso 2", () => {
      const page = pageOf({
        readings: { 0: r(4, 0.7), 90: EMPTY, 180: EMPTY, 270: EMPTY },
        ink: 0.001,
      });
      expect(simulate(page, { had: true, orientation: 180 }, TODAY).angles).toEqual([180]);
    });

    it("el paso 4 (agrandado) no se simula: queda marcado y ilegible si no hay lectura fiable", () => {
      const page = pageOf({
        readings: { 0: EMPTY, 90: EMPTY, 180: EMPTY, 270: EMPTY },
        dpi: 150,
      });
      const result = simulate(page, { had: true, orientation: 0 }, TODAY);
      expect(result.upscaleNeeded).toBe(true);
      expect(result.unreadable).toBe(true);
      expect(outcomeOf(result)).toBe("warned");
      const native = simulate({ ...page, effectiveDpi: 300 }, { had: true, orientation: 0 }, TODAY);
      expect(native.upscaleNeeded).toBe(false);
    });
  });

  describe("SV", () => {
    const page = pageOf({
      readings: { 0: r(3, 0.4), 90: r(5, 0.9, true), 180: EMPTY, 270: EMPTY },
      correctAngle: 90,
    });
    const verdict = { had: true, orientation: 0 };

    it("con una confianza menor que T prueba los ángulos que faltan y elige con CP", () => {
      const without = simulate(page, verdict, CP_ONLY);
      expect(without.angles).toEqual([0]);
      expect(outcomeOf(without)).toBe("leak");
      const sv = simulate(page, verdict, { ...CP_ONLY, sv: 0.5 });
      expect(sv.angles).toEqual([0, 90, 180, 270]);
      expect(sv.finalAngle).toBe(90);
      expect(outcomeOf(sv)).toBe("recovered");
    });

    it("no dispara con confianza igual o mayor que T, sin veredicto ni sin tinta", () => {
      expect(simulate(page, verdict, { ...CP_ONLY, sv: 0.4 }).angles).toEqual([0]);
      expect(simulate({ ...page, ink: 0 }, verdict, { ...CP_ONLY, sv: 0.9 }).angles).toEqual([0]);
      const noVerdict = simulate(page, { had: false, orientation: 0 }, { ...CP_ONLY, sv: 0.9 });
      expect(noVerdict.angles).toEqual([0, 90, 180, 270]);
    });
  });

  describe("resultado", () => {
    it("los datos de una lectura son los del PDF o los del cuerpo y los del sello juntos", () => {
      expect(readingHasData({ ...EMPTY, ok: true })).toBe(true);
      expect(readingHasData({ ...EMPTY, ok: false })).toBe(false);
      expect(readingHasData(EMPTY)).toBeNull();
      expect(readingHasData({ ...EMPTY, body: true, stamp: false })).toBe(false);
      expect(readingHasData({ ...EMPTY, body: null, stamp: true })).toBe(true);
    });

    it("clasifica lo medido igual que lo simulado", () => {
      const run = (overrides: Partial<MeasuredRun>): MeasuredRun => ({
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
      expect(measuredOutcome(run({ ok: true }))).toBe("recovered");
      expect(measuredOutcome(run({ unreadable: true }))).toBe("warned");
      expect(measuredOutcome(run({}))).toBe("leak");
      expect(measuredOutcome(run({ ok: null, body: true, stamp: true }))).toBe("recovered");
      expect(measuredOutcome(run({ ok: null, body: false, stamp: true }))).toBe("leak");
    });

    it("el veredicto de un escenario es el natural o uno forzado", () => {
      const page = pageOf({ readings: {}, had: true });
      expect(verdictFor(page, "natural")).toEqual({ had: true, orientation: 0 });
      expect(verdictFor(page, 270)).toEqual({ had: true, orientation: 270 });
    });
  });

  describe("compareWithMeasured", () => {
    const readings = { 0: r(5, 0.5), 90: r(4, 0.9), 180: EMPTY, 270: EMPTY };
    const measured = (overrides: Partial<MeasuredRun>): MeasuredRun => ({
      angles: [0, 90, 180, 270],
      upscaled: false,
      finalAngle: 90,
      final: { words: 4, reliable: 4, conf: 0.9 },
      unreadable: false,
      ok: null,
      body: null,
      stamp: null,
      entityCount: 0,
      ...overrides,
    });

    it("coincide cuando se leen los mismos ángulos y queda la misma lectura", () => {
      const page = pageOf({ readings, measured: { natural: measured({}) } });
      expect(compareWithMeasured(page, "natural")).toEqual({ sameAngles: true, sameFinal: true });
    });

    it("detecta ángulos o lectura final distintos, y no compara sin medición", () => {
      const different = pageOf({
        readings,
        measured: {
          natural: measured({ angles: [0], final: { words: 5, reliable: 5, conf: 0.5 } }),
        },
      });
      expect(compareWithMeasured(different, "natural")).toEqual({
        sameAngles: false,
        sameFinal: false,
      });
      expect(compareWithMeasured(pageOf({ readings }), "natural")).toBeNull();
    });

    it("no compara la lectura final si el producto corrió el agrandado, y descarta ese último despacho", () => {
      const page = pageOf({
        readings,
        measured: { natural: measured({ upscaled: true, angles: [0, 90, 180, 270, 90] }) },
      });
      expect(compareWithMeasured(page, "natural")).toEqual({ sameAngles: true, sameFinal: null });
    });
  });

  describe("referenceAngle", () => {
    it("es el que elige CP entre las cuatro primeras lecturas", () => {
      expect(
        referenceAngle(
          pageOf({ readings: { 0: r(9, 0.5), 90: r(2, 0.9), 180: EMPTY, 270: EMPTY } }),
        ),
      ).toBe(90);
    });

    it("en un empate gana el primero, y sin ninguna lectura fiable no hay referencia", () => {
      expect(
        referenceAngle(
          pageOf({ readings: { 0: r(3, 0.8), 90: r(3, 0.8), 180: EMPTY, 270: EMPTY } }),
        ),
      ).toBe(0);
      expect(
        referenceAngle(pageOf({ readings: { 0: EMPTY, 90: EMPTY, 180: EMPTY, 270: EMPTY } })),
      ).toBeNull();
    });
  });

  it("una lectura que falta es un error de la campaña, no un cero", () => {
    expect(() =>
      simulate(pageOf({ readings: { 0: r(1, 0.9) } }), { had: false, orientation: 0 }, TODAY),
    ).toThrow("falta la lectura a 90°");
  });
});
