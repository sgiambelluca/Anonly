import { describe, expect, it } from "vitest";

import { makeM2Page } from "./osdVerdictM2TestSupport.js";
import { simPagesFromM1, simPagesFromM2, hasAllReadings } from "./osdVerdictSimPages.js";
import { makePdf } from "./osdVerdictTestSupport.js";

describe("osdVerdictSimPages", () => {
  describe("simPagesFromM1", () => {
    const observations = makePdf({
      key: "two-lines-150-180",
      verdict: { orientation: 0, had: false },
      inkRatio: 0.001,
      forced: {
        0: {
          reading: { reliable: 1, confidence: 0.7, durationMs: 1500 },
          final: { reliable: 1, text: "lit", confidence: 0.7 },
        },
        90: { reading: { reliable: 0, confidence: 0 } },
        180: {
          // Una cadena de dos reconocimientos: el segundo es un reconocimiento en caliente a 90°.
          attempts: [
            { angle: 180, spec: { reliable: 4, confidence: 0.95, allTokens: true } },
            { angle: 90, spec: { reliable: 0, confidence: 0, durationMs: 400 } },
          ],
          final: { present: true, reliable: 4, text: "a b c d", confidence: 0.95 },
        },
        270: { reading: { reliable: 2, confidence: 0.5 } },
      },
    });
    const [page] = simPagesFromM1(observations);

    it("arma una página por PDF con sus cuatro primeras lecturas, la tinta y el veredicto natural", () => {
      expect(page?.key).toBe("two-lines-150-180");
      expect(page?.group).toBe("m1-text");
      expect(page?.label).toBe("two-lines");
      expect(page?.ink).toBe(0.001);
      expect(page?.correctAngle).toBe(180);
      expect(page?.natural).toEqual({ had: false, orientation: 0 });
      expect(page !== undefined && hasAllReadings(page)).toBe(true);
      expect(page?.readings[180]).toMatchObject({ reliable: 4, conf: 0.95, ok: true });
      expect(page?.readings[0]).toMatchObject({
        reliable: 1,
        conf: 0.7,
        ok: false,
        durationMs: 1500,
      });
    });

    it("guarda lo que midió el producto en cada observación, con el ángulo de la lectura final", () => {
      expect(page?.measured.natural?.angles).toEqual([0]);
      expect(page?.measured[180]).toMatchObject({
        angles: [180, 90],
        finalAngle: 180,
        unreadable: false,
        ok: true,
      });
      expect(page?.measured[0]?.finalAngle).toBe(0);
    });

    it("la muestra en caliente son los reconocimientos que no fueron el primero de su observación", () => {
      expect(page?.warmMs).toEqual({ 90: 400 });
    });

    it("un control sin texto queda en su propio grupo", () => {
      const control = makePdf({
        key: "blank-150-0",
        forced: { 0: {}, 90: {}, 180: {}, 270: {} },
      });
      expect(simPagesFromM1(control)[0]?.group).toBe("m1-control");
    });
  });

  describe("simPagesFromM2", () => {
    const observations = makeM2Page({
      key: "M3-150-0",
      ink: 0.003,
      production: {
        attempts: [{ angle: 0, reliable: 12, conf: 0.95 }],
        final: {
          words: 12,
          reliable: 12,
          conf: 0.95,
          entityCounts: { DNI: 2 },
          body: { allTokens: true, dniToken: true, dniEntity: true },
          stamp: { allTokens: true, dniToken: true, dniEntity: true },
        },
      },
      forced: {
        0: {
          reading: {
            reliable: 12,
            conf: 0.95,
            body: { allTokens: true, dniToken: true },
            stamp: { allTokens: true, dniToken: true },
          },
        },
        90: {
          reading: {
            reliable: 9,
            conf: 0.62,
            body: { allTokens: false, dniToken: false },
            stamp: { allTokens: true, dniToken: true },
          },
        },
        180: { reading: { reliable: 9, conf: 0.3 } },
        270: { reading: { reliable: 0, conf: 0 } },
      },
    });
    const [page] = simPagesFromM2(observations);

    it("pasa los datos del cuerpo y los del sello de cada lectura", () => {
      expect(page?.group).toBe("margin");
      expect(page?.readings[0]).toMatchObject({ ok: null, body: true, stamp: true });
      expect(page?.readings[90]).toMatchObject({ body: false, stamp: true });
      expect(page?.readings[180]).toMatchObject({ body: null, stamp: null });
    });

    it("lo medido lleva las entidades y los datos de la lectura final", () => {
      expect(page?.measured.natural).toMatchObject({
        finalAngle: 0,
        entityCount: 2,
        body: true,
        stamp: true,
        unreadable: false,
      });
    });

    it("una lectura final sin coincidencia deja el ángulo sin identificar", () => {
      const unknown = makeM2Page({
        key: "RU1-150-0",
        production: { finalAttemptOrder: null },
        forced: { 0: {}, 90: {}, 180: {}, 270: {} },
      });
      expect(simPagesFromM2(unknown)[0]?.measured.natural?.finalAngle).toBeNull();
      expect(simPagesFromM2(unknown)[0]?.group).toBe("noise");
    });
  });
});
