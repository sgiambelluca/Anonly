import {
  EngineEvents,
  EntityType,
  EventChannel,
  ReplacementMode,
  type EngineContext,
} from "@anonly/shared";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GENDER_LEXICON } from "../gender-lexicon.generated.js";
import type { GenderLexicon } from "../gender.js";
import { inferPersonGender } from "../gender.js";
import { GroupingEngine } from "../grouping.engine.js";
import { buildPlaceholderValue } from "../labels.js";
import { levenshtein, levenshteinNormalized } from "../levenshtein.js";

import {
  createEngineContext,
  makeBBox,
  makeEntityGroup,
  makeOccurrence,
} from "./fixtures/test-helpers.js";

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
  //
  // Nombre "Andrea" (sin apellido determinante, ADR-069 §1: `A` en el
  // registro de Buenos Aires) a propósito: este test prueba la escalera de
  // abreviaturas, no la inferencia de género (ADR-069 §7 — un nombre
  // determinado desviaría la aserción hacia MUJER/HOMBRE sin que sea lo que
  // el test verifica).
  it("group with only wide bboxes stays at level 0 (no behaviour change)", () => {
    // Dos apariciones DISTINTAS (bbox.y difiere) del mismo valor: mismo
    // grupo, dos members — bbox idéntico colisionaría con el dedup por
    // identidad de ADR-038 §3 (entityType, pageIndex, bbox, normalizedValue).
    for (const y of [0, 40]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          value: "Andrea Perez",
          normalizedValue: "andrea perez",
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
  //
  // "Andrea"/"Andrea Diaz" (ambos `A`/ambiguo en el registro, ADR-069 §1):
  // mismo motivo que el test anterior, desacoplar la escalera de la
  // inferencia de género.
  it("one narrow member lowers the level for the whole group", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Perez",
        normalizedValue: "andrea perez",
        bbox: makeBBox(0, 0, 200, 20),
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Diaz",
        normalizedValue: "andrea diaz",
        bbox: makeBBox(0, 0, 70, 20),
      }),
    });

    const groups = engine.getSnapshot("doc-1").groups;
    const wideGroup = groups.find((g) => g.canonicalValue === "Andrea Perez");
    const narrowGroup = groups.find((g) => g.canonicalValue === "Andrea Diaz");
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

/**
 * `inferPersonGender` (ADR-060 §4) es una función pura: no depende de una
 * sesión del motor, solo de `canonicalValue` + un léxico (Map). Se prueba
 * igual que `levenshtein`/`levenshteinNormalized` abajo, con fixtures
 * sintéticas que protegen el ORDEN de los pasos del algoritmo (ADR-069 §7a).
 * El artefacto real commiteado (`GENDER_LEXICON`) se prueba aparte, más
 * abajo.
 */
describe("inferPersonGender (ADR-060 §4)", () => {
  // Caso 32 (§13): nombre inequívocamente femenino/masculino.
  it("unambiguously feminine/masculine name infers personGender", () => {
    const lexicon: GenderLexicon = new Map([
      ["julia", "f"],
      ["juan", "m"],
    ]);
    expect(inferPersonGender("Julia Gomez", lexicon)).toBe("f");
    expect(inferPersonGender("Juan Perez", lexicon)).toBe("m");
  });

  // Caso 33 (§13): protege el ORDEN de los pasos de §4 — se busca primero la
  // secuencia completa de nombres de pila ("maria jose", compuesto real de
  // Buenos Aires Data) y recién si eso falla el primer token solo ("jose").
  // Comparten los mismos dos tokens en distinto orden.
  it('"José María" → m and "María José" → f', () => {
    const lexicon: GenderLexicon = new Map([
      ["jose", "m"],
      ["maria jose", "f"],
    ]);
    expect(inferPersonGender("José María Gómez", lexicon)).toBe("m");
    expect(inferPersonGender("María José Gómez", lexicon)).toBe("f");
  });

  // Caso 32 (§13, ADR-060 §4/§5, ADR-069 §1): tres caminos distintos que
  // convergen en "sin determinar" — ausencia del léxico, marca de ambiguo
  // ("A", unisex en el registro de Buenos Aires) y unas iniciales que nunca
  // están en un léxico de nombres. Nunca se elige un género dudoso.
  it(
    'name absent from lexicon, unisex name ("A") and initials → ' + "undetermined + neutral token",
    () => {
      const lexicon: GenderLexicon = new Map([["andrea", "ambiguous"]]);

      expect(inferPersonGender("Nombre Desconocido Apellido", lexicon)).toBeUndefined();
      expect(inferPersonGender("Andrea", lexicon)).toBeUndefined();
      expect(inferPersonGender("J. Pérez", lexicon)).toBeUndefined();

      // Token neutro: un grupo sin personGender resuelto sigue usando
      // PERSONA/PERS/PRS, exactamente como antes de ADR-060.
      const group = makeEntityGroup({ canonicalValue: "Andrea Fernandez", indexInType: 3 });
      expect(buildPlaceholderValue(group)).toBe("[PERSONA 03]");
    },
  );

  it("empty canonicalValue (no tokens) has nothing to look up → undetermined", () => {
    const lexicon: GenderLexicon = new Map([["julia", "f"]]);
    expect(inferPersonGender("   ", lexicon)).toBeUndefined();
  });

  // ADR-069 §7, regla permanente: las tablas sintéticas de arriba prueban el
  // ORDEN de los pasos de §4 (son el fixture del algoritmo). Todo enunciado
  // sobre qué contesta el léxico exige un test contra el ARTEFACTO
  // COMMITEADO — es la distinción que el PR 11 no hacía: sus tests pasaban
  // en verde con léxicos de dos entradas inventados a mano mientras
  // `inferPersonGender("J. Pérez", <artefacto real>)` devolvía `"m"` contra
  // la tabla real (ADR-069, Contexto §2/§3).
  describe("inferPersonGender against the REAL artifact (GENDER_LEXICON, ADR-069 §7)", () => {
    // Caso 32 (§13, ADR-069 §3/§7): el defecto que el PR 11 no vio — las 130
    // entradas basura de UCI (iniciales, letras sueltas) hacían que
    // "J. Pérez" resolviera "m" contra el artefacto real de entonces. La
    // fuente única de ADR-069 §1 ya no tiene esas entradas (el build las
    // descarta), y el guard de runtime de gender.ts (ADR-069 §3) es la
    // segunda barrera, independiente del contenido del artefacto.
    it('initials are never looked up: "J. Pérez" and "J.M. Pérez" against the REAL table', () => {
      expect(inferPersonGender("J. Pérez", GENDER_LEXICON)).toBeUndefined();
      expect(inferPersonGender("J.M. Pérez", GENDER_LEXICON)).toBeUndefined();
    });

    // Caso 32 (§13, ADR-069 §1/§7): errata de ADR-060 corregida por ADR-069
    // §8 — "Andrea" NO resuelve "f": el registro de Buenos Aires la declara
    // `A` (unisex), sin determinar. "Joan" es el ejemplo verdadero de que el
    // registro local manda sobre datos anglosajones (Joan Manuel Serrat,
    // `M` acá, mayoritariamente femenino allá).
    it('"Andrea" is undetermined and "Joan" is m, against the REAL table', () => {
      expect(inferPersonGender("Andrea", GENDER_LEXICON)).toBeUndefined();
      expect(inferPersonGender("Joan Fernandez", GENDER_LEXICON)).toBe("m");
    });

    // Caso 33 (§13, ADR-069 §7): mismo par que protege el orden de los pasos
    // de §4 arriba, pero contra la tabla real en vez de un fixture de dos
    // entradas — "maria jose" está en el registro como secuencia de pila
    // compuesta (f) y gana sobre el primer token solo ("jose" -> m).
    it('"José María"/"María José" resolve against the REAL table', () => {
      expect(inferPersonGender("José María Gómez", GENDER_LEXICON)).toBe("m");
      expect(inferPersonGender("María José Gómez", GENDER_LEXICON)).toBe("f");
    });

    // Defensa en profundidad (ADR-069 §3): el guard de runtime de gender.ts
    // es deliberadamente redundante con el filtro del build. Se prueba acá
    // con un léxico sintético "envenenado" que SÍ tiene una entrada
    // determinada para una clave de iniciales — algo que el artefacto real
    // nunca produce, pero que probaría que "J. Pérez" resuelve "m" si algún
    // día se regenera con otro criterio o se sirve un artefacto viejo. El
    // guard hace que ese escenario sea imposible independientemente del
    // contenido de la tabla.
    it('the runtime guard blocks "j"/"j."/"j.m." even if a poisoned lexicon has a determined entry', () => {
      const poisoned: GenderLexicon = new Map([
        ["j", "m"],
        ["j.", "m"],
        ["j.m.", "m"],
        ["pérez", "m"],
      ]);
      expect(inferPersonGender("J Pérez", poisoned)).toBeUndefined();
      expect(inferPersonGender("J. Pérez", poisoned)).toBeUndefined();
      expect(inferPersonGender("J.M. Pérez", poisoned)).toBeUndefined();
    });
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
