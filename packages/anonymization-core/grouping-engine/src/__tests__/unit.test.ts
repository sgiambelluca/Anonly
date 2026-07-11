import { EngineEvents, EntityType, EventChannel, type EngineContext } from "@anonly/shared";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GroupingEngine } from "../grouping.engine.js";
import { levenshtein, levenshteinNormalized } from "../levenshtein.js";

import { createEngineContext, makeOccurrence } from "./fixtures/test-helpers.js";

describe("GroupingEngine — unit tests", () => {
  let engine: GroupingEngine;
  let ctx: EngineContext;

  beforeEach(async () => {
    engine = new GroupingEngine();
    ctx = createEngineContext();
    await engine.init(ctx);
    engine.startSession("doc-1");
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("canonicalValue ∈ aliases", () => {
    const values = ["11111111", "22222222", "11111111", "33333333"];
    for (const value of values) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ value, normalizedValue: value, entityType: EntityType.DNI }),
      });
    }

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.aliases).toContain(group.canonicalValue);
    }
  });

  it("members.length ≥ 1", () => {
    for (const value of ["11111111", "22222222"]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ value, normalizedValue: value, entityType: EntityType.DNI }),
      });
    }

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.members.length).toBeGreaterThanOrEqual(1);
    }
  });

  // Caso 3 (§13): "34.567.891" y "34567891" comparten normalizedValue.
  it("DNI with and without dots groups together", () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "34.567.891",
        normalizedValue: "34567891",
        entityType: EntityType.DNI,
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "34567891",
        normalizedValue: "34567891",
        entityType: EntityType.DNI,
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group?.members).toHaveLength(2);
    expect(group?.aliases).toEqual(expect.arrayContaining(["34.567.891", "34567891"]));
    // Empate de frecuencia (1 c/u): gana el alias más largo ("34.567.891").
    expect(group?.canonicalValue).toBe("34.567.891");
  });

  // "Algoritmos clave" > Matching: fuzzy match (normalizedValue distinto,
  // similitud ≥ 0.88 con el umbral default) agrupa como alias nuevo.
  it("fuzzy match merges near-duplicate values above the similarity threshold", () => {
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Maria Fernandez",
        normalizedValue: "maria fernandez",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      // Un solo carácter distinto (z→s): similitud 1 - 1/15 ≈ 0.933 ≥ 0.88.
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Maria Fernandes",
        normalizedValue: "maria fernandes",
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(2);
    expect(groups[0]?.aliases).toEqual(
      expect.arrayContaining(["Maria Fernandez", "Maria Fernandes"]),
    );
  });
});

describe("levenshtein / levenshteinNormalized", () => {
  it("identical strings have distance 0 and similarity 1", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshteinNormalized("abc", "abc")).toBe(1);
  });

  it("distance against an empty string equals the other string's length", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("levenshteinNormalized: both empty → 1.0, one empty → 0.0", () => {
    expect(levenshteinNormalized("", "")).toBe(1);
    expect(levenshteinNormalized("", "abc")).toBe(0);
    expect(levenshteinNormalized("abc", "")).toBe(0);
  });

  it("computes edit distance between differing non-empty strings", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});
