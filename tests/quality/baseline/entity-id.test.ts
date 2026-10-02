/**
 * Identidad estable de entidad (ADR-147 §2), ejercitada con datos sintéticos
 * — mismo criterio que `matching.test.ts`.
 */
import { EntityType } from "@anonly/shared";
import { describe, it, expect } from "vitest";

import type { DocumentTruth, TruthEntity } from "../types.js";

import { deriveDocumentEntityIds, deriveEntityId } from "./entity-id.js";

function truth(value: string, overrides?: Partial<TruthEntity>): TruthEntity {
  return {
    entityType: EntityType.DNI,
    value,
    pageIndex: 0,
    detector: "regex",
    ...overrides,
  };
}

describe("deriveEntityId (ADR-147 §2)", () => {
  it("compone documentId:pageIndex:entityType:valorNormalizado#ordinal", () => {
    // normalizeForComparison no toca puntuación interna (ADR-115 §1: eso es
    // normalizeEntityValue, que solo recorta los BORDES) — un DNI con puntos
    // conserva sus puntos en el valor normalizado.
    const id = deriveEntityId("doc-001", truth("34.567.891"), 0);
    expect(id).toBe("doc-001:0:DNI:34.567.891#0");
  });

  it("usa la MISMA normalización que la regla de matcheo (normalizeForComparison): mayúsculas y diacríticos, no puntuación", () => {
    // normalizeForComparison normaliza case y diacríticos (NFC → lowercase →
    // NFD → strip de marcas combinantes), no puntuación — "María Pérez" y
    // "MARIA PEREZ" colapsan al mismo valor normalizado por esa vía. No es
    // un caso de `isCovered` (que matchea por CONTENCIÓN, no igualdad) sino
    // de la normalización en sí, que es lo único que deriveEntityId reusa.
    const a = deriveEntityId("doc-001", truth("María Pérez", { entityType: EntityType.Person }), 0);
    const b = deriveEntityId("doc-001", truth("MARIA PEREZ", { entityType: EntityType.Person }), 0);
    expect(a).toBe(b);
    expect(a).toBe("doc-001:0:PERSON:maria perez#0");
  });
});

describe("deriveDocumentEntityIds — ordinal por grupo (ADR-147 §2)", () => {
  it("asigna ids distintos a entidades sin repetir dentro del documento", () => {
    const doc: DocumentTruth = {
      documentId: "doc-001",
      entities: [truth("34.567.891"), truth("18.445.212"), truth("42.998.103")],
    };
    const identified = deriveDocumentEntityIds(doc);
    const ids = identified.map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([
      "doc-001:0:DNI:34.567.891#0",
      "doc-001:0:DNI:18.445.212#0",
      "doc-001:0:DNI:42.998.103#0",
    ]);
  });

  it("desempata por orden de aparición dentro del MISMO (pageIndex, entityType, valor normalizado)", () => {
    // Un DNI repetido dos veces en la misma página (formulario que reimprime
    // el dato) — sin ordinal, colisionarían en el mismo id.
    const doc: DocumentTruth = {
      documentId: "doc-002",
      entities: [truth("34.567.891"), truth("34.567.891"), truth("34.567.891")],
    };
    const identified = deriveDocumentEntityIds(doc);
    expect(identified.map((i) => i.id)).toEqual([
      "doc-002:0:DNI:34.567.891#0",
      "doc-002:0:DNI:34.567.891#1",
      "doc-002:0:DNI:34.567.891#2",
    ]);
  });

  it("no mezcla el ordinal entre grupos distintos (páginas/tipos/valores distintos)", () => {
    const doc: DocumentTruth = {
      documentId: "doc-003",
      entities: [
        truth("34.567.891"), // grupo A, ordinal 0
        truth("34.567.891", { pageIndex: 1 }), // grupo B (otra página), ordinal 0
        truth("34.567.891"), // grupo A de nuevo, ordinal 1
        truth("34.567.891", { entityType: EntityType.Phone }), // grupo C (otro tipo), ordinal 0
      ],
    };
    const identified = deriveDocumentEntityIds(doc);
    expect(identified.map((i) => i.id)).toEqual([
      "doc-003:0:DNI:34.567.891#0",
      "doc-003:1:DNI:34.567.891#0",
      "doc-003:0:DNI:34.567.891#1",
      "doc-003:0:PHONE:34.567.891#0",
    ]);
  });

  it("no toca el valor original de la entidad devuelta", () => {
    const doc: DocumentTruth = { documentId: "doc-001", entities: [truth("34.567.891")] };
    const [identified] = deriveDocumentEntityIds(doc);
    expect(identified?.entity.value).toBe("34.567.891");
  });
});
