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
  // ADR-073 §7: separa "los unificó el normalizer" de "los unificó el difuso".
  it("DNI with and without dots still groups by the EXACT pass", () => {
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

  // ADR-073 §7 — el test que define el ADR: dos fechas que difieren en un
  // carácter (0.900 ≥ 0.88, el caso medido sobre la pericia real) producen
  // DOS grupos, no uno.
  it("two Dates differing in one character produce two groups", () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Date,
        value: "1/7/2026",
        normalizedValue: "01/07/2026",
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Date,
        value: "7/7/2026",
        normalizedValue: "07/07/2026",
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups.filter((g) => g.type === EntityType.Date)).toHaveLength(2);
  });

  // ADR-073 §7 — un carácter de diferencia, dos grupos, para cada uno de los
  // otros cinco tipos estructurados medidos en el reporte (Contexto §2).
  it("one-character difference produces two groups for CUIT, Phone, CreditCard, IBAN and Email", () => {
    const cases: ReadonlyArray<{ entityType: EntityType; a: string; b: string }> = [
      { entityType: EntityType.CUIT, a: "20123456789", b: "20123456799" },
      { entityType: EntityType.Phone, a: "1145678900", b: "1145678901" },
      { entityType: EntityType.CreditCard, a: "4111111111111111", b: "4111111111111112" },
      {
        entityType: EntityType.IBAN,
        a: "AR9700000000000000000001",
        b: "AR9700000000000000000002",
      },
      { entityType: EntityType.Email, a: "persona@estudio.com.ar", b: "persona@estudio.com.as" },
    ];

    for (const { entityType, a, b } of cases) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ entityType, value: a, normalizedValue: a }),
      });
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ entityType, value: b, normalizedValue: b }),
      });
    }

    const { groups } = engine.getSnapshot("doc-1");
    for (const { entityType } of cases) {
      expect(groups.filter((g) => g.type === entityType)).toHaveLength(2);
    }
  });

  // ADR-073 §7 — no-regresión: si esto se cae, ADR-073 rompió lo que vino a
  // proteger. Ídem Organization y Address, mismo umbral y mismo mecanismo.
  //
  // Nota: el par que ilustra ADR-073 Contexto §3 ("Pablo Rornan" por "Pablo
  // Román", la confusión "rn"→"m") tiene distancia Levenshtein 2 contra
  // "Pablo Roman" (verificado con la implementación real), similitud 0.833 —
  // por debajo del umbral 0.88 independientemente de este ADR. No es un caso
  // que la fórmula sin cambios agrupe. Se usa acá una confusión de OCR real
  // de un solo carácter (O↔0) que sí clasifica como "un carácter distinto".
  it('"Pablo Roman" and "Pablo Rornan" still group together', () => {
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Pablo Roman",
        normalizedValue: "pablo roman",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Pablo R0man",
        normalizedValue: "pablo r0man",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Organization,
        value: "Estudio Gonzalez",
        normalizedValue: "estudio gonzalez",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Organization,
        value: "Estudio Gonzalez.",
        normalizedValue: "estudio gonzalez.",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Address,
        value: "Av. Rivadavia 1234",
        normalizedValue: "av. rivadavia 1234",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Address,
        value: "Av. Rivadavia 1235",
        normalizedValue: "av. rivadavia 1235",
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    const personGroup = groups.find((g) => g.type === EntityType.Person);
    const orgGroup = groups.find((g) => g.type === EntityType.Organization);
    const addressGroup = groups.find((g) => g.type === EntityType.Address);
    expect(personGroup?.members).toHaveLength(2);
    expect(orgGroup?.members).toHaveLength(2);
    expect(addressGroup?.members).toHaveLength(2);
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

  // Caso 43 (§13, ADR-074 §1). toOccurrenceRef propaga fragments tal cual, y
  // es público (OccurrenceRef, no bookkeeping interno como
  // replacementValueUserSet): tiene que sobrevivir hasta getSnapshot.
  it("fragments survive from Occurrence to OccurrenceRef and reach getSnapshot", () => {
    const fragments = [makeBBox(0, 0, 200, 20), makeBBox(0, 30, 70, 20)];
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Pablo Roman Fortes",
        normalizedValue: "pablo roman fortes",
        bbox: makeBBox(0, 0, 200, 50),
        fragments,
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups[0]?.members).toHaveLength(1);
    expect(groups[0]?.members[0]?.fragments).toEqual(fragments);
  });

  // Caso 43 (§13, ADR-074 §7) — sin esto la escalera mide contra la
  // envolvente (557 pt en el caso real) y nunca baja de nivel. Una sola
  // ocurrencia, bbox ancho (200, entraría cómodo en nivel 0), pero uno de
  // sus DOS fragmentos es angosto (70, el mismo umbral que el test de
  // arriba): el peor caso tiene que salir de fragments, no de bbox.
  it("a narrow fragment hidden by a wide envelope lowers the abbreviation level", () => {
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      // "Andrea" es undeterminado en el léxico (ADR-069 §7): sin esto, la
      // inferencia de género movería el label de PERSONA a MUJER/HOMBRE y el
      // test dejaría de aislar lo que quiere probar.
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Fortes",
        normalizedValue: "andrea fortes",
        bbox: makeBBox(0, 0, 200, 50),
        fragments: [makeBBox(0, 0, 200, 20), makeBBox(0, 30, 70, 20)],
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    // Mismo nivel que "one narrow member..." arriba con el mismo ancho
    // angosto (70): la escalera no puede estar midiendo la envolvente de 200.
    expect(groups[0]?.replacementValue).toBe("[PRS-01]");
  });

  // Caso 39 (§13, ADR-071 §5). "julia" es `f` en el registro — verificado
  // contra la tabla real, que es lo que ADR-069 §7 exige para cualquier
  // enunciado sobre qué contesta el léxico.
  it("Person group with personGender resolved gets a matching synthetic first name", async () => {
    const FEMALE_FIRST_NAMES = ["María", "Ana", "Laura", "Sofía", "Elena", "Patricia", "Claudia"];

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Julia Gomez",
        normalizedValue: "julia gomez",
        bbox: makeBBox(0, 100, 200, 20),
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.personGender).toBe("f");

    const synthetic = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Synthetic },
    });

    // El nombre falso es femenino: antes de ADR-071, "Julia Gomez" podía
    // salir "Carlos Sánchez" — el modo ya imprimía un género, solo que al
    // azar y a veces el contrario al del original.
    expect(FEMALE_FIRST_NAMES).toContain(synthetic.replacementValue.split(" ")[0]);
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
