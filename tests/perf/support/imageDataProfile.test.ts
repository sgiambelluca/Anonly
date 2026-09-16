import { describe, expect, it } from "vitest";

import {
  aggregateCounters,
  aggregateImageDataProfile,
  aggregateStageDurations,
  checkImageDataProfileInvariants,
  ImageDataProfileInvariantError,
  ImageDataProfileParseError,
  parseImageDataProfilePageRecord,
  percentile,
  type ImageDataProfileInterval,
  type ImageDataProfilePageRecord,
} from "./imageDataProfile.js";

// ─── Fixture sintética: una página orientation=0, franja izquierda ACTIVA
// (dos pasadas, 90 y 270) y franja derecha SALTEADA por blanco (ADR-162,
// caso 4 del Handoff). Cronología estrictamente secuencial, como el kernel
// real (un solo hilo por worker) — la única superposición permitida es
// "copy" anidado dentro de su "rotate".

function interval(
  stage: ImageDataProfileInterval["stage"],
  scope: ImageDataProfileInterval["scope"],
  startMs: number,
  endMs: number,
  extra?: { readonly strip?: "left" | "right"; readonly rotation?: 90 | 270 },
): ImageDataProfileInterval {
  return { stage, scope, startMs, endMs, ...extra };
}

function buildValidRecord(): ImageDataProfilePageRecord {
  return {
    documentId: "smoke-doc",
    pageIndex: 0,
    orientation: 0,
    intervals: [
      interval("recognizeCall", "main", 0, 20),

      interval("stripDecode", "marginStrip", 20, 22, { strip: "left" }),
      interval("whiteGate", "marginStrip", 22, 23, { strip: "left" }),

      interval("rotate", "marginStrip", 23, 33, { strip: "left", rotation: 90 }),
      interval("copy", "marginStrip", 28, 29, { strip: "left", rotation: 90 }),
      interval("canvas", "marginStrip", 33, 34, { strip: "left", rotation: 90 }),
      interval("encode", "marginStrip", 34, 36, { strip: "left", rotation: 90 }),
      interval("recognizeCall", "marginStrip", 36, 60, { strip: "left", rotation: 90 }),
      interval("merge", "marginStrip", 60, 61, { strip: "left", rotation: 90 }),

      interval("rotate", "marginStrip", 61, 71, { strip: "left", rotation: 270 }),
      interval("copy", "marginStrip", 66, 67, { strip: "left", rotation: 270 }),
      interval("canvas", "marginStrip", 71, 72, { strip: "left", rotation: 270 }),
      interval("encode", "marginStrip", 72, 74, { strip: "left", rotation: 270 }),
      interval("recognizeCall", "marginStrip", 74, 98, { strip: "left", rotation: 270 }),
      interval("merge", "marginStrip", 98, 99, { strip: "left", rotation: 270 }),

      interval("stripDecode", "marginStrip", 99, 100, { strip: "right" }),
      interval("whiteGate", "marginStrip", 100, 101, { strip: "right" }),
    ],
    strips: [
      {
        strip: "left",
        skippedWhite: false,
        passes: [
          {
            rotation: 90,
            candidatesRaw: 3,
            discardedByConfidence: 1,
            discardedByEmptyText: 0,
            discardedByOverlap: 0,
            wordsAdded: 2,
          },
          {
            rotation: 270,
            candidatesRaw: 2,
            discardedByConfidence: 0,
            discardedByEmptyText: 1,
            discardedByOverlap: 0,
            wordsAdded: 1,
          },
        ],
      },
      { strip: "right", skippedWhite: true, passes: [] },
    ],
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─── percentile ─────────────────────────────────────────────────────────

describe("percentile", () => {
  it("interpola linealmente, igual que numpy percentile default", () => {
    const data = [1, 2, 3, 4, 5];
    expect(percentile(data, 50)).toBe(3);
    expect(percentile(data, 10)).toBeCloseTo(1.4, 10);
    expect(percentile(data, 90)).toBeCloseTo(4.6, 10);
  });

  it("con un solo valor devuelve ese valor para cualquier percentil", () => {
    expect(percentile([42], 10)).toBe(42);
    expect(percentile([42], 90)).toBe(42);
  });

  it("con cero valores devuelve NaN, nunca 0 disfrazado de dato", () => {
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
});

// ─── parseImageDataProfilePageRecord ───────────────────────────────────

describe("parseImageDataProfilePageRecord", () => {
  it("acepta un registro válido y lo devuelve tal cual", () => {
    const raw = buildValidRecord();
    const parsed = parseImageDataProfilePageRecord(raw);
    expect(parsed).toEqual(raw);
  });

  it("rechaza un valor que no es un objeto", () => {
    expect(() => parseImageDataProfilePageRecord("no soy un registro")).toThrow(
      ImageDataProfileParseError,
    );
    expect(() => parseImageDataProfilePageRecord(null)).toThrow(ImageDataProfileParseError);
    expect(() => parseImageDataProfilePageRecord(42)).toThrow(ImageDataProfileParseError);
  });

  it("rechaza documentId ausente o vacío", () => {
    const bad = deepClone(buildValidRecord()) as unknown as Record<string, unknown>;
    delete bad.documentId;
    expect(() => parseImageDataProfilePageRecord(bad)).toThrow(ImageDataProfileParseError);
  });

  it("rechaza pageIndex negativo", () => {
    const bad = { ...deepClone(buildValidRecord()), pageIndex: -1 };
    expect(() => parseImageDataProfilePageRecord(bad)).toThrow(ImageDataProfileParseError);
  });

  it("rechaza orientation fuera de {0,90,180,270}", () => {
    const bad = { ...deepClone(buildValidRecord()), orientation: 45 };
    expect(() => parseImageDataProfilePageRecord(bad)).toThrow(ImageDataProfileParseError);
  });

  it("rechaza un stage que no está en la lista de diez etapas del Handoff", () => {
    const bad = deepClone(buildValidRecord());
    (bad.intervals as unknown[])[0] = { ...bad.intervals[0], stage: "totallyMadeUpStage" };
    expect(() => parseImageDataProfilePageRecord(bad)).toThrow(ImageDataProfileParseError);
  });

  it("rechaza un intervalo que termina antes de empezar", () => {
    const bad = deepClone(buildValidRecord());
    (bad.intervals as unknown[])[0] = { ...bad.intervals[0], startMs: 100, endMs: 10 };
    expect(() => parseImageDataProfilePageRecord(bad)).toThrow(ImageDataProfileParseError);
  });

  it("rechaza una franja salteada por blanco que igual trae pasadas", () => {
    const bad = deepClone(buildValidRecord());
    (bad.strips as unknown[])[1] = {
      ...bad.strips[1],
      passes: [
        {
          rotation: 90,
          candidatesRaw: 0,
          discardedByConfidence: 0,
          discardedByEmptyText: 0,
          discardedByOverlap: 0,
          wordsAdded: 0,
        },
      ],
    };
    expect(() => parseImageDataProfilePageRecord(bad)).toThrow(ImageDataProfileParseError);
  });

  it("rechaza contadores de una pasada que no cierran (candidatesRaw != suma de buckets)", () => {
    const bad = JSON.parse(JSON.stringify(buildValidRecord())) as Record<string, unknown>;
    const strips = bad.strips as Array<Record<string, unknown>>;
    const leftStrip = strips[0];
    if (leftStrip === undefined) throw new Error("fixture inválida: falta strips[0]");
    const passes = leftStrip.passes as Array<Record<string, unknown>>;
    const firstPass = passes[0];
    if (firstPass === undefined) throw new Error("fixture inválida: falta strips[0].passes[0]");
    passes[0] = { ...firstPass, candidatesRaw: 99 };
    expect(() => parseImageDataProfilePageRecord(bad)).toThrow(ImageDataProfileParseError);
  });
});

// ─── checkImageDataProfileInvariants / aggregateImageDataProfile ──────────
//
// El registro válido NO debe disparar ninguna violación; cada mutación de
// abajo rompe exactamente UN invariante del Handoff §5 y debe hacer fallar
// la agregación. Si estos tests no vieran fallar el invariante correspondiente,
// el instrumento no estaría verificando nada (mismo criterio que ADR-149 §2
// le exigió al discriminante de ADR-160).

describe("checkImageDataProfileInvariants — caso válido", () => {
  it("no reporta violaciones sobre un registro consistente", () => {
    const violations = checkImageDataProfileInvariants([buildValidRecord()]);
    expect(violations).toEqual([]);
  });

  it("aggregateImageDataProfile agrega sin lanzar sobre un registro consistente", () => {
    const result = aggregateImageDataProfile([buildValidRecord()]);
    expect(result.counters.pagesObserved).toBe(1);
    expect(result.counters.passesExecuted).toBe(2);
  });
});

describe("checkImageDataProfileInvariants — copy ⊄ rotate", () => {
  it("detecta un copy que NO está contenido en su rotate hermano", () => {
    const broken = buildValidRecord();
    const intervals = broken.intervals.map((iv) =>
      iv.stage === "copy" && iv.strip === "left" && iv.rotation === 90
        ? { ...iv, startMs: 500, endMs: 501 } // fuera de cualquier "rotate" (23-33, 61-71)
        : iv,
    );
    const mutated: ImageDataProfilePageRecord = { ...broken, intervals };

    const violations = checkImageDataProfileInvariants([mutated]);
    expect(violations.some((v) => v.rule === "copySubsetOfRotate")).toBe(true);

    expect(() => aggregateImageDataProfile([mutated])).toThrow(ImageDataProfileInvariantError);
  });
});

describe("checkImageDataProfileInvariants — hermanos solapados", () => {
  it("detecta dos intervalos no-copy que se superponen", () => {
    const broken = buildValidRecord();
    const intervals = broken.intervals.map((iv) =>
      // La franja derecha (99-101) se corre para pisar el "merge" de la
      // izquierda a 270 (98-99): dos hermanos con tiempos superpuestos.
      iv.stage === "stripDecode" && iv.strip === "right"
        ? { ...iv, startMs: 98.5, endMs: 99.5 }
        : iv,
    );
    const mutated: ImageDataProfilePageRecord = { ...broken, intervals };

    const violations = checkImageDataProfileInvariants([mutated]);
    expect(violations.some((v) => v.rule === "noSiblingOverlap")).toBe(true);

    expect(() => aggregateImageDataProfile([mutated])).toThrow(ImageDataProfileInvariantError);
  });
});

describe("checkImageDataProfileInvariants — conteo de pasadas", () => {
  it("detecta que faltan pasadas frente a franjas activas × 2 rotaciones", () => {
    const broken = buildValidRecord();
    const strips = broken.strips.map((s) =>
      s.strip === "left" ? { ...s, passes: s.passes.filter((p) => p.rotation === 90) } : s,
    );
    const mutated: ImageDataProfilePageRecord = { ...broken, strips };

    const violations = checkImageDataProfileInvariants([mutated]);
    expect(violations.some((v) => v.rule === "passCountMatchesActiveStrips")).toBe(true);

    expect(() => aggregateImageDataProfile([mutated])).toThrow(ImageDataProfileInvariantError);
  });

  it("detecta una pasada de más frente a los intervalos rotate reales", () => {
    const broken = buildValidRecord();
    const strips = broken.strips.map((s) =>
      s.strip === "left"
        ? {
            ...s,
            passes: [
              ...s.passes,
              {
                rotation: 90 as const,
                candidatesRaw: 0,
                discardedByConfidence: 0,
                discardedByEmptyText: 0,
                discardedByOverlap: 0,
                wordsAdded: 0,
              },
            ],
          }
        : s,
    );
    const mutated: ImageDataProfilePageRecord = { ...broken, strips };

    const violations = checkImageDataProfileInvariants([mutated]);
    expect(violations.some((v) => v.rule === "passCountMatchesActiveStrips")).toBe(true);
  });
});

// Regresión directa del bug real de la campaña 2026-09-15
// (`ImageData_Perfilado_Resultados.md`, "el bug del colector"):
// `installImageDataProfileCollector` reinstalaba su listener en cada
// corrida sin poder des-registrar el anterior, y en caliente el handler
// viejo escribía sobre el array nuevo — cada página de la corrida caliente
// quedaba duplicada dos veces, con contenido IDÉNTICO. Los otros tres
// invariantes pasaban limpio sobre las dos copias porque cada una, por
// separado, es internamente consistente. Si este test no viera fallar el
// chequeo de unicidad, el agregador seguiría sin detectar esa clase de bug.
describe("checkImageDataProfileInvariants — registro duplicado", () => {
  it("detecta un registro repetido (mismo documentId+pageIndex) en el lote agregado", () => {
    const record = buildValidRecord();
    const duplicated = [record, structuredClone(record)];

    const violations = checkImageDataProfileInvariants(duplicated);
    expect(violations.some((v) => v.rule === "uniqueRecordPerPage")).toBe(true);

    expect(() => aggregateImageDataProfile(duplicated)).toThrow(ImageDataProfileInvariantError);
  });

  it("no reporta duplicado cuando los documentId difieren (frío y caliente son cargas distintas)", () => {
    const cold = buildValidRecord();
    const hot = { ...structuredClone(cold), documentId: "otro-doc-caliente" };

    const violations = checkImageDataProfileInvariants([cold, hot]);
    expect(violations.some((v) => v.rule === "uniqueRecordPerPage")).toBe(false);
  });
});

// ─── aggregateStageDurations ──────────────────────────────────────────────

describe("aggregateStageDurations", () => {
  it("calcula n/mediana/p10/p90 por etapa sobre duraciones conocidas", () => {
    const record: ImageDataProfilePageRecord = {
      documentId: "doc",
      pageIndex: 0,
      orientation: 0,
      intervals: [
        interval("canvas", "marginStrip", 0, 10, { strip: "left", rotation: 90 }),
        interval("canvas", "marginStrip", 20, 40, { strip: "left", rotation: 270 }),
        interval("canvas", "marginStrip", 50, 80, { strip: "right", rotation: 90 }),
      ],
      strips: [],
    };
    const stats = aggregateStageDurations([record]);
    const canvasStats = stats.find((s) => s.stage === "canvas");
    expect(canvasStats).toBeDefined();
    expect(canvasStats?.n).toBe(3);
    expect(canvasStats?.medianMs).toBe(20);
    expect(canvasStats?.p10Ms).toBeCloseTo(12, 10);
    expect(canvasStats?.p90Ms).toBeCloseTo(28, 10);
  });

  it("no incluye una etapa sin ocurrencias", () => {
    const stats = aggregateStageDurations([buildValidRecord()]);
    expect(stats.some((s) => s.stage === "fullDecode")).toBe(false);
    expect(stats.some((s) => s.stage === "pageRotate")).toBe(false);
  });
});

// ─── aggregateCounters ─────────────────────────────────────────────────

describe("aggregateCounters", () => {
  it("suma candidatas/descartes/palabras y discrimina por franja+rotación", () => {
    const counters = aggregateCounters([buildValidRecord()]);
    expect(counters.stripsInspected).toBe(2);
    expect(counters.stripsSkippedWhite).toBe(1);
    expect(counters.passesExecuted).toBe(2);
    expect(counters.candidatesRaw).toBe(5);
    expect(counters.discardedByConfidence).toBe(1);
    expect(counters.discardedByEmptyText).toBe(1);
    expect(counters.discardedByOverlap).toBe(0);
    expect(counters.wordsAdded).toBe(3);
    expect(counters.wordsAddedByPass).toEqual({ "left:90": 2, "left:270": 1 });
  });
});
