import {
  EngineEvents,
  EntityType,
  EventChannel,
  GENDER_LEXICON,
  ReplacementMode,
  type EngineContext,
  type GenderLexicon,
} from "@anonly/shared";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
  it('"Pablo Roman" and "Pablo R0man" still group together', () => {
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
describe("GroupingEngine — cambio de tipo del grupo (ADR-082)", () => {
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

  function seedGroup(entityType: EntityType, value: string) {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value, normalizedValue: value, entityType }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    return group!;
  }

  it("cambia el tipo, toma índice del tipo nuevo y recalcula el token", async () => {
    // Dos grupos Organization primero, para que la secuencia de ese tipo ya
    // vaya por 2: así el índice del reclasificado solo puede salir de la
    // secuencia NUEVA (3) y no de conservar la vieja (1). Sin este seed, la
    // aserción pasaba igual con el recálculo de índice removido.
    seedGroup(EntityType.Organization, "Empresa Uno S.A.");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "Empresa Dos S.A.",
        normalizedValue: "empresa dos s.a.",
        entityType: EntityType.Organization,
      }),
    });

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "Fiscalía de Quilmes",
        normalizedValue: "fiscalia de quilmes",
        entityType: EntityType.Address,
      }),
    });
    const group = engine.getSnapshot("doc-1").groups.find((g) => g.type === EntityType.Address)!;
    expect(group.indexInType).toBe(1);

    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group.id,
      patch: { type: EntityType.Organization },
    });

    expect(updated.type).toBe(EntityType.Organization);
    // Índice de la secuencia del tipo DESTINO, no el que traía.
    expect(updated.indexInType).toBe(3);
    // El label del token sigue al tipo (ADR-057 + ADR-082 §2 paso 3).
    expect(updated.replacementValue).not.toBe(group.replacementValue);
    // El nivel de abreviatura lo elige la escalera de ADR-057 según el ancho
    // del bbox, así que se afirma la familia del label, no el literal.
    expect(updated.replacementValue).toMatch(/ORG/);
  });

  it("un patch con el tipo vigente es no-op: no emite ENTITY_GROUP_UPDATED", async () => {
    const group = seedGroup(EntityType.DNI, "34567891");
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group.id,
      patch: { type: EntityType.DNI },
    });

    const updates = emitSpy.mock.calls.filter(
      ([, event]) => event === EngineEvents.ENTITY_GROUP_UPDATED,
    );
    expect(updates).toHaveLength(0);
  });

  it("salir de Person borra personGender; volver a Person lo re-infiere", async () => {
    // "Julia Ruiz" y NO "Andrea Ruiz": el léxico declara `Andrea` **ambiguo**
    // (`A`, ADR-069 §1), así que su `personGender` es `undefined` SIEMPRE — y
    // con ese nombre las dos aserciones de este test pasaban vacuamente,
    // incluso borrando la rama que dicen probar.
    const group = seedGroup(EntityType.Person, "Julia Ruiz");
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group.id,
      patch: { canonicalValue: "Julia Ruiz" },
    });

    // Precondición explícita: sin esto, las dos aserciones de abajo pasan
    // vacuamente si la inferencia dejara de resolver "Andrea Ruiz".
    const before = engine.getSnapshot("doc-1").groups.find((g) => g.id === group.id);
    expect(before?.personGender).toBe("f");

    const asOrg = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group.id,
      patch: { type: EntityType.Organization },
    });
    expect(asOrg.personGender).toBeUndefined();

    const backToPerson = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group.id,
      patch: { type: EntityType.Person },
    });
    // La mitad "lo re-infiere" del título: es lo que el test NO verificaba,
    // así que borrar la rama `inferGenderIfDue` de `changeGroupType` lo dejaba
    // en verde.
    expect(backToPerson.type).toBe(EntityType.Person);
    expect(backToPerson.personGender).toBe("f");
  });

  // ADR-082 §5: `personGender` tiene que llegar en `changes`, o la UI no se
  // entera de que el campo se borró al reclasificar.
  it("un cambio de tipo que borra personGender lo reporta en changes", async () => {
    const group = seedGroup(EntityType.Person, "Julia Ruiz");
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group.id,
      patch: { canonicalValue: "Julia Ruiz" },
    });

    const emitSpy = vi.spyOn(ctx.bus, "emit");
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group.id,
      patch: { type: EntityType.Organization },
    });

    const updated = emitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.ENTITY_GROUP_UPDATED,
    );
    const changes = (updated?.[2] as { readonly changes: ReadonlyArray<string> }).changes;
    expect(changes).toContain("type");
    expect(changes).toContain("indexInType");
    expect(changes).toContain("personGender");
  });

  // ADR-078 §1: la fila que `Grouping_Engine.md` §14 lista y que no existía.
  it("a group starts with replacementValueUserSet false and turns true after a manual replacementValue edit", async () => {
    const group = seedGroup(EntityType.Person, "Andrea Ruiz");
    expect(group.replacementValueUserSet).toBe(false);

    const edited = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group.id,
      patch: { replacementValue: "[P1]" },
    });
    expect(edited.replacementValueUserSet).toBe(true);
    expect(edited.replacementValue).toBe("[P1]");
  });

  it("una edición manual del replacementValue sobrevive al cambio de tipo (ADR-082 §4)", async () => {
    const group = seedGroup(EntityType.Address, "Fiscalía de Quilmes");
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group.id,
      patch: { replacementValue: "[FQ]" },
    });

    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group.id,
      patch: { type: EntityType.Organization },
    });

    expect(updated.type).toBe(EntityType.Organization);
    expect(updated.replacementValue).toBe("[FQ]");
    expect(updated.replacementValueUserSet).toBe(true);
  });

  // ADR-082 §3 — la parte no obvia, y la que este test fijó al escribirse:
  // los registros de sesión conservan el tipo del DETECTOR. Si siguieran al
  // grupo reclasificado, el dedup por identidad (que corre ANTES que la
  // detección de conflictos) dejaría de reconocer la ocurrencia re-emitida en
  // un reanalyze, y esta caería en `findOverlapConflict` contra su propio
  // grupo → conflicto espurio del grupo consigo mismo.
  // ─── ADR-085: memoria de reclasificación por documento ───

  async function reclassify(
    from: EntityType,
    to: EntityType,
    value = "Fiscalía de Quilmes",
    normalizedValue = "fiscalia de quilmes",
  ) {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value, normalizedValue, entityType: from, pageIndex: 0 }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { type: to },
    });
    return group!;
  }

  // Escenario B de ADR-082 (Consecuencias): una ocurrencia NUEVA del mismo
  // valor creaba un grupo paralelo del tipo del detector, y el mismo texto
  // salía del export con dos tokens distintos.
  it("una ocurrencia nueva del mismo valor cae en el grupo reclasificado, sin crear uno paralelo", async () => {
    await reclassify(EntityType.Address, EntityType.Organization);

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "Fiscalía de Quilmes",
        normalizedValue: "fiscalia de quilmes",
        entityType: EntityType.Address,
        pageIndex: 7,
        bbox: makeBBox(10, 10, 80, 12),
      }),
    });

    const snapshot = engine.getSnapshot("doc-1");
    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]?.type).toBe(EntityType.Organization);
    expect(snapshot.groups[0]?.members).toHaveLength(2);
  });

  // Escenario C: `dropOccurrences({ source: NER })` —lo que corre al APAGAR
  // NER— borra el grupo corregido, y la re-detección lo recreaba con el tipo
  // del detector. Es lo único que `absorbedTypes` no puede cubrir: se fue con
  // el grupo.
  it("un grupo recreado tras borrarse nace con el tipo corregido", async () => {
    await reclassify(EntityType.Address, EntityType.Organization);

    engine.dropOccurrences("doc-1", { pageIndices: [0] });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "Fiscalía de Quilmes",
        normalizedValue: "fiscalia de quilmes",
        entityType: EntityType.Address,
        pageIndex: 0,
      }),
    });

    const snapshot = engine.getSnapshot("doc-1");
    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]?.type).toBe(EntityType.Organization);
  });

  // ADR-085 §3: el guard difuso va sobre el tipo que emite el DETECTOR.
  it("el difuso hereda la corrección en un tipo de texto libre", async () => {
    await reclassify(EntityType.Address, EntityType.Organization);
    engine.dropOccurrences("doc-1", { pageIndices: [0] });

    // Distancia 1 sobre 19 caracteres: 0.947, por encima del umbral 0.88.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "Fiscalia de Quilmez",
        normalizedValue: "fiscalia de quilmez",
        entityType: EntityType.Address,
        pageIndex: 0,
      }),
    });

    expect(engine.getSnapshot("doc-1").groups[0]?.type).toBe(EntityType.Organization);
  });

  it("el difuso NO hereda la corrección en un tipo estructurado (ADR-073)", async () => {
    // Un falso positivo de teléfono corregido a Custom.
    //
    // Los valores tienen 10 dígitos normalizados A PROPÓSITO: a distancia 1
    // dan 0.900, por ENCIMA del umbral 0.88, así que el difuso sí los
    // fusionaría si corriera. Con 8 dígitos darían 0.875 y el test pasaría
    // por casualidad, sin ejercitar el guard — que es como estaba escrito
    // antes de verificarlo falseando la implementación. Es la misma tabla de
    // `Post_Hito10.8_Pendientes.md` §1: el DNI se salva por 0,005 y el
    // teléfono no.
    await reclassify(EntityType.Phone, EntityType.Custom, "20-12345678", "2012345678");
    engine.dropOccurrences("doc-1", { pageIndices: [0] });

    // Otro teléfono a distancia 1: NO debe heredar — es otra entidad.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "20-12345679",
        normalizedValue: "2012345679",
        entityType: EntityType.Phone,
        pageIndex: 0,
      }),
    });

    expect(engine.getSnapshot("doc-1").groups[0]?.type).toBe(EntityType.Phone);
  });

  it("ni absorbedTypes ni typeCorrections salen en el snapshot", async () => {
    await reclassify(EntityType.Address, EntityType.Organization);
    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group).not.toHaveProperty("absorbedTypes");
    expect(group).not.toHaveProperty("typeCorrections");
  });

  it("re-emitir la misma ocurrencia tras un cambio de tipo no duplica ni crea conflicto", async () => {
    const occurrence = makeOccurrence({
      value: "Fiscalía de Quilmes",
      normalizedValue: "fiscalia de quilmes",
      entityType: EntityType.Address,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence,
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { type: EntityType.Organization },
    });

    // Misma ocurrencia, con el entityType con el que la detectó el motor.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence,
    });

    const snapshot = engine.getSnapshot("doc-1");
    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]?.members).toHaveLength(1);
    expect(snapshot.conflicts).toHaveLength(0);
  });

  it("tras un cambio de tipo, finishSession renumera sin colisiones de (type, indexInType)", async () => {
    for (const value of ["11111111", "22222222", "33333333"]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ value, normalizedValue: value, entityType: EntityType.DNI }),
      });
    }
    const [first] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: first!.id,
      patch: { type: EntityType.CUIT },
    });

    await engine.finishSession("doc-1");

    const keys = engine
      .getSnapshot("doc-1")
      .groups.map((g) => `${g.type}#${String(g.indexInType)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

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
