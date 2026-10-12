import { describe, expect, it } from "vitest";

import {
  COMPARATORS,
  buildSignals,
  classifyOutcome,
  distribution,
  extraReadingSeconds,
  firstReadings,
  groupByPdf,
  productionOutcomes,
  q1WrongVerdicts,
  q2ForcedOutcomes,
  q3Signals,
  q3bisComparators,
  q4Time,
  quantile,
  readingTimes,
  subsetsOf,
  topAngles,
  warmDurationsMs,
  warmExtraSeconds,
  wrapAround,
  type FirstReading,
} from "./osdVerdictAnalysis.js";
import type { ObservationRecord } from "./osdVerdictRun.js";
import { makeObservation, makePdf } from "./osdVerdictTestSupport.js";

/*
 * Tres PDF con texto y un control, construidos a mano para que las cuentas se puedan seguir:
 *
 * - full-150-0, denso, sin giro (correcto 0). El OSD natural acierta. Forzado a un ángulo equivocado:
 *   siempre avisa.
 * - two-lines-150-180, escaso viejo (correcto 180). El OSD natural afirma 0: equivocado. Forzado a 0 es
 *   una fuga; a 90, avisa; a 270 la cadena se recupera.
 * - N7-300-90, escaso nuevo (correcto 270). Sin veredicto natural. Forzado a 0 es una fuga con el DNI
 *   tapable; a 90 y a 180, avisa.
 * - blank-150-0, control sin texto.
 */
const dense = makePdf({
  key: "full-150-0",
  verdict: { orientation: 0, had: true },
  inkRatio: 0.3,
  forced: {
    0: {
      reading: { reliable: 30, confidence: 0.9, durationMs: 1000, allTokens: true },
      final: { present: true },
    },
    90: {
      reading: { reliable: 3, confidence: 0.2, durationMs: 2000 },
      final: { unreadable: true },
    },
    180: {
      reading: { reliable: 0, confidence: 0, durationMs: 3000 },
      final: { unreadable: true },
    },
    270: {
      reading: { reliable: 2, confidence: 0.3, durationMs: 4000 },
      final: { unreadable: true },
    },
  },
});

const twoLines = makePdf({
  key: "two-lines-150-180",
  verdict: { orientation: 0, had: true },
  inkRatio: 0.001,
  forced: {
    0: {
      reading: { reliable: 1, confidence: 0.7, durationMs: 1500 },
      final: { reliable: 1, text: "lit Ee" },
    },
    90: {
      reading: { reliable: 0, confidence: 0, durationMs: 1500 },
      final: { unreadable: true },
    },
    180: {
      reading: { reliable: 4, confidence: 0.95, durationMs: 1500, allTokens: true },
      final: { present: true },
    },
    270: {
      reading: { reliable: 2, confidence: 0.5, durationMs: 1500 },
      final: { present: true },
    },
  },
});

const sparse = makePdf({
  key: "N7-300-90",
  verdict: null,
  inkRatio: 0.0035,
  forced: {
    0: {
      reading: { reliable: 6, confidence: 0.66, durationMs: 2000 },
      final: { reliable: 6, dniEntity: true, text: "Juan Pérez DNI" },
    },
    90: {
      reading: { reliable: 0, confidence: 0, durationMs: 2000 },
      final: { unreadable: true },
    },
    180: {
      reading: { reliable: 0, confidence: 0, durationMs: 2000 },
      final: { unreadable: true },
    },
    270: {
      reading: { reliable: 4, confidence: 0.9, durationMs: 2000, allTokens: true },
      final: { present: true },
    },
  },
});

const control = makePdf({
  key: "blank-150-0",
  forced: { 0: {}, 90: {}, 180: {}, 270: {} },
});

const observations: ObservationRecord[] = [dense, twoLines, sparse, control].flat();
const groups = groupByPdf(observations);

function signal(id: string) {
  const found = buildSignals().find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`sin señal ${id}`);
  return found;
}

describe("osdVerdictAnalysis", () => {
  describe("groupByPdf", () => {
    it("agrupa las cinco observaciones de cada PDF", () => {
      expect(groups.map((group) => group.key)).toEqual([
        "full-150-0",
        "two-lines-150-180",
        "N7-300-90",
        "blank-150-0",
      ]);
      const first = groups[0];
      expect(first?.production?.forcedAngle).toBeNull();
      expect([...(first?.forced.keys() ?? [])]).toEqual([0, 90, 180, 270]);
    });
  });

  describe("pregunta 1", () => {
    const q1 = q1WrongVerdicts(groups);

    it("cuenta veredictos presentes, correctos, equivocados y ausentes; el control sin texto no entra", () => {
      expect(q1.total).toEqual({ pdfs: 3, withVerdict: 2, correct: 1, wrong: 1, noVerdict: 1 });
    });

    it("separa por conjunto, geometría o densidad, dpi y giro físico", () => {
      expect(q1.bySet["old-text"]).toEqual({
        pdfs: 2,
        withVerdict: 2,
        correct: 1,
        wrong: 1,
        noVerdict: 0,
      });
      expect(q1.bySet.sparse?.noVerdict).toBe(1);
      expect(q1.byLabel["two-lines"]?.wrong).toBe(1);
      expect(q1.byLabel.N7?.wrong).toBe(0);
      expect(q1.byDpi["150"]?.pdfs).toBe(2);
      expect(q1.byDpi["300"]?.pdfs).toBe(1);
      expect(q1.byRotation["180"]?.wrong).toBe(1);
      expect(q1.byRotation["0"]?.wrong).toBe(0);
    });

    it("lista los equivocados con el ángulo que afirmaron y el correcto", () => {
      expect(q1.wrong).toEqual([
        {
          key: "two-lines-150-180",
          verdict: 0,
          correctAngle: 180,
          rawOrientation: null,
          rawConfidence: null,
          inkRatio: 0.001,
        },
      ]);
    });
  });

  describe("producción sin forzar nada", () => {
    it("clasifica lo que entrega la producción por veredicto natural y por etiqueta", () => {
      const withProduction = [dense, twoLines, sparse, control].flatMap((pdf, index) =>
        pdf.map((item) =>
          index === 1 && item.forcedAngle === null
            ? { ...item, final: { ...item.final, expectedDataPresent: true } }
            : item,
        ),
      );
      const result = productionOutcomes(groupByPdf(withProduction));
      // Denso y N7: la fábrica deja la producción sin datos ni aviso (fuga); two-lines recupera.
      expect(result.total).toMatchObject({
        observations: 3,
        recovered: 1,
        warned: 0,
        silentLeak: 2,
      });
      expect(result.byNaturalVerdict.correct).toMatchObject({ observations: 1, silentLeak: 1 });
      expect(result.byNaturalVerdict.wrong).toMatchObject({ observations: 1, recovered: 1 });
      expect(result.byNaturalVerdict.none).toMatchObject({ observations: 1, silentLeak: 1 });
      expect(result.byLabel.N7?.silentLeak).toBe(1);
      expect(result.byDpi["300"]?.observations).toBe(1);
      expect(result.notRecovered.map((item) => [item.key, item.forcedAngle])).toEqual([
        ["full-150-0", null],
        ["N7-300-90", null],
      ]);
    });
  });

  describe("pregunta 2", () => {
    const q2 = q2ForcedOutcomes(groups);

    it("clasifica lo que entrega el producto con un veredicto equivocado forzado", () => {
      expect(q2.total).toEqual({
        observations: 9,
        recovered: 1,
        warned: 6,
        silentLeak: 2,
        silentLeakWithDniEntity: 1,
      });
    });

    it("recupera, avisa o filtra según haya datos esperados y aviso", () => {
      const byKey = (key: string, angle: 0 | 90 | 180 | 270) => {
        const observation = groups.find((group) => group.key === key)?.forced.get(angle);
        if (observation === undefined) throw new Error("sin observación");
        return classifyOutcome(observation);
      };
      expect(byKey("two-lines-150-180", 0)).toBe("silent-leak");
      expect(byKey("two-lines-150-180", 90)).toBe("warned");
      expect(byKey("two-lines-150-180", 270)).toBe("recovered");
      expect(byKey("N7-300-90", 0)).toBe("silent-leak");
    });

    it("separa por conjunto, etiqueta, dpi, giro y distancia al ángulo correcto", () => {
      expect(q2.bySet.sparse?.silentLeak).toBe(1);
      expect(q2.byLabel.full?.warned).toBe(3);
      expect(q2.byDpi["300"]?.observations).toBe(3);
      expect(q2.byRotation["90"]?.silentLeak).toBe(1);
      expect(q2.byOffset["90"]).toMatchObject({ recovered: 1, warned: 1, silentLeak: 1 });
      expect(q2.byOffset["180"]).toMatchObject({ warned: 2, silentLeak: 1 });
      expect(q2.byOffset["270"]).toMatchObject({ warned: 3, silentLeak: 0 });
    });

    it("cuenta los PDF con alguna fuga y el control con el ángulo correcto", () => {
      expect(q2.pdfsWithLeak.withLeak).toBe(2);
      expect(q2.pdfsWithLeak.pdfs).toBe(3);
      expect(q2.pdfsWithLeak.byLabel.full).toEqual({ pdfs: 1, withLeak: 0 });
      expect(q2.pdfsWithLeak.byLabel.N7).toEqual({ pdfs: 1, withLeak: 1 });
      expect(q2.forcedCorrect).toMatchObject({ observations: 3, recovered: 3 });
      expect(q2.forcedCorrectNotRecovered).toEqual([]);
    });

    it("lista cada fuga con lo que leyó, su confianza y sus palabras confiables", () => {
      expect(q2.leaks.map((leak) => [leak.key, leak.forcedAngle, leak.correctAngle])).toEqual([
        ["two-lines-150-180", 0, 180],
        ["N7-300-90", 0, 270],
      ]);
      expect(q2.leaks[0]).toMatchObject({
        physicalRotation: 180,
        finalText: "lit Ee",
        finalReliableWords: 1,
        firstReadingReliableWords: 1,
        firstReadingPageConfidence: 0.7,
        dniEntity: false,
        attemptedAngles: [0],
      });
      expect(q2.leaks[1]?.dniEntity).toBe(true);
      expect(q2.nonRecovered).toHaveLength(8);
    });

    it("lista las observaciones del control que no recuperan los datos aun con el ángulo bien afirmado", () => {
      const failing = [dense, twoLines, sparse, control].flatMap((pdf) =>
        pdf.map((item) =>
          item.key === "N7-300-90" && item.forcedAngle === 270
            ? { ...item, final: { ...item.final, expectedDataPresent: false } }
            : item,
        ),
      );
      const q2Failing = q2ForcedOutcomes(groupByPdf(failing));
      expect(q2Failing.forcedCorrect).toMatchObject({
        observations: 3,
        recovered: 2,
        silentLeak: 1,
      });
      expect(
        q2Failing.forcedCorrectNotRecovered.map((item) => [item.key, item.forcedAngle]),
      ).toEqual([["N7-300-90", 270]]);
      // El control no se mezcla con los tres ángulos equivocados.
      expect(q2Failing.total.observations).toBe(9);
    });

    it("la distancia entre ángulos se mide en el sentido de la corrección", () => {
      expect(wrapAround(0, 180)).toBe(180);
      expect(wrapAround(90, 180)).toBe(270);
      expect(wrapAround(270, 180)).toBe(90);
      expect(wrapAround(0, 270)).toBe(90);
    });
  });

  describe("primeras lecturas", () => {
    it("son las cuatro del PDF, con el ángulo correcto marcado", () => {
      const readings = firstReadings(groups[1]!);
      expect(readings.map((reading) => [reading.angle, reading.isCorrect])).toEqual([
        [0, false],
        [90, false],
        [180, true],
        [270, false],
      ]);
      expect(readings[2]).toMatchObject({
        reliableWords: 4,
        pageConfidence: 0.95,
        inkRatio: 0.001,
        durationMs: 1500,
        label: "two-lines",
      });
    });

    it("los conjuntos separan el control denso del resto", () => {
      expect(subsetsOf({ set: "old-text", label: "full" })).toEqual(["dense", "label:full"]);
      expect(subsetsOf({ set: "old-text", label: "header" })).toEqual([
        "sparse",
        "old-sparse",
        "label:header",
      ]);
      expect(subsetsOf({ set: "sparse", label: "N4" })).toEqual([
        "sparse",
        "new-sparse",
        "label:N4",
      ]);
    });
  });

  describe("pregunta 3", () => {
    const results = q3Signals(groups);
    const row = (id: string) => {
      const found = results.find((candidate) => candidate.id === id);
      if (found === undefined) throw new Error(`sin fila ${id}`);
      return found;
    };

    it("define las once señales del plan", () => {
      expect(buildSignals().map((item) => item.id)).toEqual([
        "words<5",
        "words<10",
        "words<20",
        "conf<0.5",
        "conf<0.7",
        "conf<0.8",
        "ink<0.005",
        "ink<0.01",
        "ink<0.02",
        "words<10 OR conf<0.7",
        "words<10 AND conf<0.7",
      ]);
    });

    it("cuenta lecturas equivocadas disparadas, las que la cadena de hoy acepta y las fugas", () => {
      const words5 = row("words<5");
      expect(words5.wrongAngle).toEqual({ readings: 9, fired: 8 });
      expect(words5.wrongAngleAccepted).toEqual({ readings: 5, fired: 4 });
      expect(words5.silentLeaks).toEqual({ readings: 2, fired: 1 });
    });

    it("cuenta lo que dispara de más en el ángulo correcto, separando denso y escaso", () => {
      const words5 = row("words<5");
      expect(words5.correctAngle).toEqual({ readings: 3, fired: 2 });
      expect(words5.correctAngleBySubset.dense).toEqual({ readings: 1, fired: 0 });
      expect(words5.correctAngleBySubset["old-sparse"]).toEqual({ readings: 1, fired: 1 });
      expect(words5.correctAngleBySubset["new-sparse"]).toEqual({ readings: 1, fired: 1 });
      expect(words5.correctAngleBySubset.sparse).toEqual({ readings: 2, fired: 2 });
    });

    it("la señal de tinta dispara igual en las cuatro lecturas de un PDF", () => {
      const ink = row("ink<0.005");
      expect(ink.wrongAngle).toEqual({ readings: 9, fired: 6 });
      expect(ink.correctAngle).toEqual({ readings: 3, fired: 2 });
    });

    it("la unión dispara donde alguna de las dos señales, y la intersección donde las dos", () => {
      const union = row("words<10 OR conf<0.7");
      const intersection = row("words<10 AND conf<0.7");
      expect(union.wrongAngle.fired).toBe(9);
      expect(union.correctAngle.fired).toBe(2);
      expect(intersection.wrongAngle.fired).toBe(8);
      expect(intersection.correctAngle.fired).toBe(0);
      for (const id of ["words<10", "conf<0.7"]) {
        expect(row(id).wrongAngle.fired).toBeLessThanOrEqual(union.wrongAngle.fired);
        expect(row(id).wrongAngle.fired).toBeGreaterThanOrEqual(intersection.wrongAngle.fired);
      }
    });

    it("una confianza de página ausente se lee como 0", () => {
      const reading: FirstReading = {
        key: "k",
        set: "sparse",
        label: "N1",
        sourceDpi: 150,
        angle: 0,
        isCorrect: false,
        reliableWords: 50,
        wordCount: 50,
        pageConfidence: null,
        inkRatio: null,
        durationMs: 1,
      };
      expect(signal("conf<0.5").fires(reading)).toBe(true);
      expect(signal("ink<0.005").fires(reading)).toBe(false);
      expect(signal("words<20").fires(reading)).toBe(false);
    });
  });

  describe("pregunta 3 bis", () => {
    const results = q3bisComparators(groups);

    it("compara las cuatro primeras lecturas con los dos comparadores", () => {
      expect(COMPARATORS.map((item) => item.id)).toEqual([
        "page-confidence-first",
        "reliable-words-first",
      ]);
      const confidence = results.find((item) => item.id === "page-confidence-first");
      const words = results.find((item) => item.id === "reliable-words-first");
      expect(confidence?.total).toEqual({ pdfs: 3, correct: 3, tiedWithCorrect: 0, wrong: 0 });
      expect(words?.total).toEqual({ pdfs: 3, correct: 2, tiedWithCorrect: 0, wrong: 1 });
      expect(words?.bySubset["new-sparse"]).toEqual({
        pdfs: 1,
        correct: 0,
        tiedWithCorrect: 0,
        wrong: 1,
      });
      expect(words?.bySubset.dense?.correct).toBe(1);
    });

    it("un empate en el primer puesto no cuenta como acierto", () => {
      const empty = makePdf({
        key: "N1-150-0",
        forced: { 0: {}, 90: {}, 180: {}, 270: {} },
      });
      const tied = q3bisComparators(groupByPdf(empty));
      for (const item of tied)
        expect(item.total).toEqual({ pdfs: 1, correct: 0, tiedWithCorrect: 1, wrong: 0 });
    });

    it("topAngles devuelve todos los empatados en el primer puesto", () => {
      const reading = (angle: 0 | 90 | 180 | 270, reliable: number, confidence: number) =>
        ({
          angle,
          reliableWords: reliable,
          pageConfidence: confidence,
        }) as FirstReading;
      const readings = [
        reading(0, 2, 0.5),
        reading(90, 5, 0.4),
        reading(180, 5, 0.4),
        reading(270, 1, 0.9),
      ];
      expect(topAngles("reliable-words-first", readings)).toEqual([90, 180]);
      expect(topAngles("page-confidence-first", readings)).toEqual([270]);
      // Con la confianza empatada, desempata la cantidad de palabras confiables, y al revés.
      const same = [reading(0, 3, 0.8), reading(90, 4, 0.8), reading(180, 4, 0.7)];
      expect(topAngles("page-confidence-first", same)).toEqual([90]);
      const sameWords = [reading(0, 4, 0.5), reading(90, 4, 0.9), reading(180, 3, 0.99)];
      expect(topAngles("reliable-words-first", sameWords)).toEqual([90]);
    });
  });

  describe("pregunta 4", () => {
    const results = q4Time(groups);
    const words5 = results.find((item) => item.id === "words<5");

    it("suma, por lectura disparada, el tiempo de las otras tres lecturas del PDF", () => {
      const readings = firstReadings(groups[0]!);
      expect(extraReadingSeconds(readings[0]!, readings)).toBe(9);
      expect(extraReadingSeconds(readings[3]!, readings)).toBe(6);
      const unmeasured = readings.map((item, index) =>
        index === 1 ? { ...item, durationMs: null } : item,
      );
      expect(extraReadingSeconds(unmeasured[0]!, unmeasured)).toBeNull();
      expect(extraReadingSeconds(unmeasured[1]!, unmeasured)).toBe(8);
    });

    it("totaliza el costo sobre las páginas mal orientadas y sobre las bien orientadas", () => {
      // full: 90 -> 8 s, 180 -> 7 s, 270 -> 6 s; two-lines: tres de 4,5 s; N7: 90 y 180 -> 6 s cada una.
      expect(words5?.onWrongAngle.n).toBe(8);
      expect(words5?.onWrongAngle.totalSec).toBeCloseTo(46.5, 9);
      expect(words5?.onWrongAngle.maxSec).toBe(8);
      expect(words5?.onCorrectAngle.n).toBe(2);
      expect(words5?.onCorrectAngle.totalSec).toBeCloseTo(10.5, 9);
      expect(words5?.onCorrectAngle.meanSec).toBeCloseTo(5.25, 9);
      expect(words5?.meanExtraPerCorrectPageSec).toBeCloseTo(3.5, 9);
    });

    it("separa el costo sobre páginas bien orientadas entre denso y escaso", () => {
      expect(words5?.onCorrectAngleBySubset.dense).toBeUndefined();
      expect(words5?.onCorrectAngleBySubset["old-sparse"]?.totalSec).toBeCloseTo(4.5, 9);
      expect(words5?.onCorrectAngleBySubset["new-sparse"]?.totalSec).toBeCloseTo(6, 9);
      expect(words5?.onCorrectAngleBySubset.sparse?.n).toBe(2);
    });

    it("toma la muestra en caliente de los reconocimientos que no fueron el primero de su observación", () => {
      const pdf = makePdf({
        key: "N1-150-0",
        forced: {
          0: {
            attempts: [
              { angle: 0, spec: { durationMs: 900 } },
              { angle: 90, spec: { durationMs: 300 } },
              { angle: 180, spec: { durationMs: 500 } },
            ],
          },
          90: {
            attempts: [
              { angle: 90, spec: { durationMs: 800 } },
              { angle: 0, spec: { durationMs: 200 } },
            ],
          },
          180: {
            attempts: [
              { angle: 180, spec: { durationMs: 700 } },
              { angle: 90, spec: { durationMs: 100 } },
              { angle: 270, spec: { durationMs: 400 } },
            ],
          },
          270: { attempts: [{ angle: 270, spec: { durationMs: 600 } }] },
        },
      });
      const group = groupByPdf(pdf)[0]!;
      const warm = warmDurationsMs(group);
      // 0: 200; 90: mediana de 300 y 100; 180: 500; 270: 400. El primer reconocimiento nunca cuenta.
      expect([...warm.entries()].sort((a, b) => a[0] - b[0])).toEqual([
        [0, 200],
        [90, 200],
        [180, 500],
        [270, 400],
      ]);
      const reading = firstReadings(group)[0]!;
      expect(warmExtraSeconds(reading, warm)).toBeCloseTo(1.1, 9);
      expect(warmExtraSeconds(reading, new Map([[90, 100]]))).toBeNull();
    });

    it("el tiempo en caliente solo cuenta las lecturas con muestra de los otros tres ángulos", () => {
      // Los PDF armados a mano no tienen reconocimientos posteriores al primero: ninguna lectura disparada tiene muestra.
      expect(words5?.warm.withoutSample).toBe(10);
      expect(words5?.warm.onWrongAngle.n).toBe(0);
      expect(words5?.warm.meanExtraPerCorrectPageSec).toBeNull();
    });

    it("una señal que no dispara no suma tiempo", () => {
      const none = q4Time(groups, [{ id: "never", label: "nunca", fires: () => false }])[0];
      expect(none?.onWrongAngle.n).toBe(0);
      expect(none?.onWrongAngle.meanSec).toBeNull();
      expect(none?.meanExtraPerCorrectPageSec).toBe(0);
    });

    it("quantile interpola y distribution resume", () => {
      expect(quantile([], 0.5)).toBeNull();
      expect(quantile([4], 0.9)).toBe(4);
      expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
      expect(quantile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6, 9);
      expect(distribution([3, 1, 2])).toEqual({
        n: 3,
        totalSec: 6,
        meanSec: 2,
        medianSec: 2,
        p90Sec: 2.8,
        maxSec: 3,
      });
      expect(distribution([]).maxSec).toBeNull();
    });
  });

  describe("tiempos de lectura", () => {
    it("resume las primeras lecturas, por dpi, y el primer reconocimiento contra los siguientes", () => {
      const withChain = makeObservation({
        key: "two-lines-150-180",
        forcedAngle: null,
        verdict: { orientation: 0, had: false },
        attempts: [
          { angle: 0, spec: { durationMs: 3000 } },
          { angle: 90, spec: { durationMs: 1000 } },
          { angle: 180, spec: { durationMs: 2000 } },
        ],
      });
      const times = readingTimes(groups, [...observations, withChain]);
      expect(times.firstReadings.n).toBe(12);
      expect(times.firstReadings.totalSec).toBeCloseTo(24, 9);
      expect(times.firstReadingsByDpi["150"]?.n).toBe(8);
      expect(times.firstReadingsByDpi["300"]?.totalSec).toBeCloseTo(8, 9);
      // Los siguientes reconocimientos solo existen en la observación armada con tres.
      expect(times.laterAttempts.n).toBe(2);
      expect(times.laterAttempts.totalSec).toBeCloseTo(3, 9);
      // Quince observaciones con texto (tres PDF por cinco) más la armada acá; el control no cuenta.
      expect(times.firstAttempt.n).toBe(16);
    });
  });
});
