/**
 * La regla de matcheo de ADR-095, ejercitada con datos sintéticos.
 *
 * **Este archivo sí corre con `pnpm test`**, a diferencia del script que
 * recorre los 20 PDFs (`main.ts`, `pnpm test:quality`). La separación es
 * deliberada: lo que hay que proteger de una regresión es **la regla**, porque
 * la regla ES la métrica — un cambio silencioso acá hace que todos los números
 * futuros mientan. El tiempo de rasterizado no protege nada.
 */
import { DetectionSource, EntityType } from "@anonly/shared";
import { describe, it, expect } from "vitest";

import { aggregateEvaluations, evaluateDocument } from "./evaluate.js";
import { isCovered, isFalsePositive, isTypedCovered } from "./matching.js";
import type { DetectedEntity, TruthEntity } from "./types.js";

function truth(value: string, overrides?: Partial<TruthEntity>): TruthEntity {
  return {
    entityType: EntityType.Person,
    value,
    pageIndex: 0,
    detector: "regex",
    ...overrides,
  };
}

function detected(value: string, overrides?: Partial<DetectedEntity>): DetectedEntity {
  return {
    entityType: EntityType.Person,
    value,
    pageIndex: 0,
    source: DetectionSource.Regex,
    ...overrides,
  };
}

describe("regla de matcheo (ADR-095 §1)", () => {
  // Los tres casos de ADR-095 §1, y el del medio es el que importa: contarlo
  // como acierto sería exactamente el número que tranquiliza y no protege.
  it("cuenta como cubierto solo lo que quedó tapado ENTERO", () => {
    expect(isCovered(truth("Juan Pérez"), [detected("Juan Pérez")])).toBe(true);
    expect(isCovered(truth("Juan Pérez"), [detected("Juan Pérez, DNI")])).toBe(true);
    expect(isCovered(truth("Juan Pérez"), [detected("Juan")])).toBe(false);
  });

  it("ignora las detecciones de otra página", () => {
    expect(isCovered(truth("Juan Pérez"), [detected("Juan Pérez", { pageIndex: 1 })])).toBe(false);
  });

  // La contención y no la igualdad: un punto de más no es una fuga.
  it("no castiga la puntuación de borde", () => {
    expect(isCovered(truth("Empresa S.A"), [detected("Empresa S.A.")])).toBe(true);
  });

  it("normaliza los dos lados antes de comparar", () => {
    expect(isCovered(truth("Juan Pérez"), [detected("JUAN PEREZ")])).toBe(true);
  });
});

describe("recall tipado y su invariante (ADR-095 §2)", () => {
  it("exige que el tipo coincida además del valor", () => {
    const detections = [detected("Juan Pérez", { entityType: EntityType.Organization })];
    expect(isCovered(truth("Juan Pérez"), detections)).toBe(true);
    expect(isTypedCovered(truth("Juan Pérez"), detections)).toBe(false);
  });

  // La invariante no depende de que el dataset la respete: sale de que
  // `isTypedCovered` filtra sobre el mismo conjunto que `isCovered`.
  it("cobertura ≥ tipado, por construcción", () => {
    const casos: ReadonlyArray<readonly [TruthEntity, ReadonlyArray<DetectedEntity>]> = [
      [truth("Juan Pérez"), [detected("Juan Pérez")]],
      [truth("Juan Pérez"), [detected("Juan Pérez", { entityType: EntityType.Address })]],
      [truth("Juan Pérez"), [detected("Juan")]],
      [truth("Juan Pérez"), []],
    ];
    for (const [t, d] of casos) {
      const cubierto = isCovered(t, d) ? 1 : 0;
      const tipado = isTypedCovered(t, d) ? 1 : 0;
      expect(cubierto, JSON.stringify(d)).toBeGreaterThanOrEqual(tipado);
    }
  });
});

describe("precisión (ADR-095 §3)", () => {
  // Más indulgente que el recall, a propósito: un falso negativo es una fuga
  // y un falso positivo se destilda.
  it("un solapamiento parcial no es falso positivo, aunque tampoco sea acierto de recall", () => {
    const t = [truth("Juan Pérez")];
    expect(isFalsePositive(detected("Juan"), t)).toBe(false);
    expect(isCovered(t[0]!, [detected("Juan")])).toBe(false);
  });

  it("una detección que no toca ninguna entidad esperada es falso positivo", () => {
    expect(isFalsePositive(detected("Rivadavia 455"), [truth("Juan Pérez")])).toBe(true);
  });

  it("en un documento vacío toda detección es falso positivo", () => {
    expect(isFalsePositive(detected("lo que sea"), [])).toBe(true);
  });
});

describe("agregación del reporte (ADR-095 §3/§4)", () => {
  it("un documento vacío sin detecciones da precisión 1, sin dividir por cero", () => {
    const report = aggregateEvaluations([
      evaluateDocument({ documentId: "doc-vacio", entities: [] }, [], 0),
    ]);
    expect(report.precision.precision).toBe(1);
    expect(Number.isNaN(report.precision.precision)).toBe(false);
  });

  it("un documento vacío con una detección da precisión < 1", () => {
    const report = aggregateEvaluations([
      evaluateDocument({ documentId: "doc-vacio", entities: [] }, [detected("Algo")], 0),
    ]);
    expect(report.precision.precision).toBeLessThan(1);
  });

  // ADR-095 §5: las entidades de NER no entran en el recall de Regex — si no,
  // el número saldría bajo por entidades que ningún detector activo podía
  // encontrar. Se reportan aparte para que la exclusión sea visible.
  it("las entidades de NER quedan fuera del recall de Regex y se cuentan aparte", () => {
    const report = aggregateEvaluations([
      evaluateDocument(
        {
          documentId: "doc-mixto",
          entities: [
            truth("34.567.891", { entityType: EntityType.DNI }),
            truth("Juan Pérez", { detector: "ner" }),
          ],
        },
        [detected("34.567.891", { entityType: EntityType.DNI })],
        0,
      ),
    ]);
    expect(report.regex.totalTruthEntities).toBe(1);
    expect(report.regex.coverageRecall).toBe(1);
    expect(report.nerExcludedCount).toBe(1);
  });

  // ADR-095 §4: una sugerencia no tapa nada, así que no puede subir el recall.
  it("las sugerencias se cuentan aparte y no cuentan como detección", () => {
    const report = aggregateEvaluations([
      evaluateDocument({ documentId: "doc-sug", entities: [truth("Juan Pérez")] }, [], 1),
    ]);
    expect(report.regex.coverageRecall).toBe(0);
    expect(report.suggestionCount).toBe(1);
  });
});
