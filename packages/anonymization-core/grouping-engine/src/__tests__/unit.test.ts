import {
  EngineEvents,
  EntityType,
  EventChannel,
  ReplacementMode,
  type EngineContext,
} from "@anonly/shared";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GroupingEngine } from "../grouping.engine.js";
import { levenshtein, levenshteinNormalized } from "../levenshtein.js";

import { createEngineContext, makeBBox, makeOccurrence } from "./fixtures/test-helpers.js";

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

  // Caso 22 (§13, ADR-029)
  it("mask uses occurrence maskFormat over type fallback", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Plate,
        value: "ABC 123",
        normalizedValue: "platevieja",
        maskFormat: "XXX XXX",
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Mask },
    });

    // El maskFormat de la Occurrence ("XXX XXX", patente vieja) gana sobre el
    // fallback de tipo (MASK_FORMAT_BY_TYPE[Plate] = "XX XXX XX", Mercosur).
    expect(updated.replacementValue).toBe("XXX XXX");
  });

  // ADR-057 §4 — no-regresión: un grupo cuyos bboxes son todos holgados
  // conserva exactamente el formato pre-ADR-057 (nivel 0, `TYPE_LABEL_ES` de
  // siempre). "El comportamiento previo a este ADR no cambia" (spec §14).
  it("group with only wide bboxes stays at level 0 (no behaviour change)", () => {
    // Dos apariciones DISTINTAS (bbox.y difiere) del mismo valor: mismo
    // grupo, dos members — bbox idéntico colisionaría con el dedup por
    // identidad de ADR-038 §3 (entityType, pageIndex, bbox, normalizedValue).
    for (const y of [0, 40]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          value: "Juan Perez",
          normalizedValue: "juan perez",
          bbox: makeBBox(0, y, 150, 20),
        }),
      });
    }

    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.members).toHaveLength(2);
    expect(group?.replacementValue).toBe("[PERSONA 01]");
  });

  // Caso 27 (§13, ADR-057 §4): sumar al grupo (acá, por fusión manual — un
  // disparador existente que YA recalcula replacementValue sin condiciones)
  // un member angosto baja el nivel de TODO el grupo, incluidos los members
  // holgados que ya tenía.
  it("one narrow member lowers the level for the whole group", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Perez",
        normalizedValue: "juan perez",
        bbox: makeBBox(0, 0, 200, 20),
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Ana Diaz",
        normalizedValue: "ana diaz",
        bbox: makeBBox(0, 0, 70, 20),
      }),
    });

    const groups = engine.getSnapshot("doc-1").groups;
    const wideGroup = groups.find((g) => g.canonicalValue === "Juan Perez");
    const narrowGroup = groups.find((g) => g.canonicalValue === "Ana Diaz");
    expect(wideGroup?.replacementValue).toBe("[PERSONA 01]");

    const merged = await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: narrowGroup!.id,
      targetGroupId: wideGroup!.id,
    });

    // El member de 70 de ancho no entra ni en nivel 0 ni en nivel 1: el
    // grupo combinado cae directo a nivel 2 aunque su otro member (200) por
    // sí solo entraba cómodo en nivel 0.
    expect(merged.replacementValue).toBe("[PRS-01]");
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
