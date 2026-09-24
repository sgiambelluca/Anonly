import {
  DetectionSource,
  EngineEvents,
  EntityType,
  EventChannel,
  GENDER_LEXICON,
  ReplacementMode,
  type ConflictDetected,
  type EngineContext,
  type EntityGroupCreated,
  type EntityGroupRemoved,
  type EntityGroupUpdated,
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
  // Nota: el par que ilustra ADR-073 Contexto §3 ("Diego Rarnos" por "Diego
  // Ramos", la confusión "rn"→"m") tiene distancia Levenshtein 2 contra
  // "Diego Ramos" (verificado con la implementación real), similitud 0.833 —
  // por debajo del umbral 0.88 independientemente de este ADR. No es un caso
  // que la fórmula sin cambios agrupe. Se usa acá una confusión de OCR real
  // de un solo carácter (O↔0) que sí clasifica como "un carácter distinto".
  it('"Diego Ramos" and "Diego Ram0s" still group together', () => {
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Diego Ramos",
        normalizedValue: "diego ramos",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Diego Ram0s",
        normalizedValue: "diego ram0s",
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
        // ADR-117: en su propio renglon. Lo que este test mide son los ANCHOS
        // (200 contra 65); apilar dos personas DISTINTAS en el mismo origen es
        // una geometria que ningun documento produce, y desde ADR-117 la
        // contenida se descarta.
        bbox: makeBBox(0, 40, 65, 20),
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

    // El member de 65 de ancho no entra ni en nivel 0 ni en nivel 1: el
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
        value: "Diego Ramos Vargas",
        normalizedValue: "diego ramos vargas",
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
        value: "Andrea Vargas",
        normalizedValue: "andrea vargas",
        bbox: makeBBox(0, 0, 200, 50),
        fragments: [makeBBox(0, 0, 200, 20), makeBBox(0, 30, 65, 20)],
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    // Mismo nivel que "one narrow member..." arriba con el mismo ancho
    // angosto (65): la escalera no puede estar midiendo la envolvente de 200.
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

describe("GroupingEngine — replacementPreviews (ADR-170 §1)", () => {
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

  // Caso 46 (§13).
  it("replacementPreviews ignore replacementValueUserSet", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    const computedPlaceholder = group!.replacementPreviews.placeholder;

    const edited = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementValue: "[P1]" },
    });
    expect(edited.replacementValueUserSet).toBe(true);
    expect(edited.replacementValue).toBe("[P1]");
    // La vista previa sigue mostrando lo que valdría CALCULADO, no lo que el
    // usuario escribió a mano — es "lo que quedaría al cambiar de modo".
    expect(edited.replacementPreviews.placeholder).toBe(computedPlaceholder);
    expect(edited.replacementPreviews.placeholder).not.toBe(edited.replacementValue);
  });

  // Caso 46 (§13, ADR-057).
  it("placeholderLadder lists distinct ladder tokens, longest first, including placeholder", () => {
    // Organization (no Person: sin inferencia de género que confunda el
    // ejemplo) — ORGANIZACION(12) > ORGA(4) > ORG(3), los tres niveles
    // distintos.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Organization,
        value: "Empresa S.A.",
        normalizedValue: "empresa s.a.",
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    const ladder = group!.replacementPreviews.placeholderLadder;

    expect(ladder).toEqual([
      `[ORGANIZACION ${String(group!.indexInType).padStart(2, "0")}]`,
      `[ORGA ${String(group!.indexInType).padStart(2, "0")}]`,
      `[ORG-${String(group!.indexInType).padStart(2, "0")}]`,
    ]);
    expect(ladder).toContain(group!.replacementPreviews.placeholder);
    // Sin repetidos.
    expect(new Set(ladder).size).toBe(ladder.length);
  });

  describe("previewEdit reuses the real request (ADR-170 §2)", () => {
    // Caso 47 (§13) — un test por kind.
    it("previewEdit(type) equals the group emitted by the real request", async () => {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
      });
      const [group] = engine.getSnapshot("doc-1").groups;

      const preview = engine.previewEdit("doc-1", {
        kind: "type",
        groupId: group!.id,
        type: EntityType.CUIT,
      });
      expect(preview.groups).toHaveLength(1);

      const real = await engine.applyGroupUpdate({
        documentId: "doc-1",
        groupId: group!.id,
        patch: { type: EntityType.CUIT },
      });

      expect(preview.groups[0]).toEqual({
        groupId: real.id,
        type: real.type,
        indexInType: real.indexInType,
        canonicalValue: real.canonicalValue,
        memberCount: real.members.length,
        replacementMode: real.replacementMode,
        replacementValue: real.replacementValue,
      });
    });

    it("previewEdit(merge) equals the group emitted by the real request", async () => {
      for (const value of ["11111111", "22222222", "33333333"]) {
        ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
          documentId: "doc-1",
          occurrence: makeOccurrence({ value, normalizedValue: value }),
        });
      }
      const before = engine.getSnapshot("doc-1").groups;
      const [g1, g2, g3] = before;

      // Fusión múltiple: source -> targetGroupIds[0], después
      // targetGroupIds[1] -> targetGroupIds[0] (ADR-170 §2).
      const preview = engine.previewEdit("doc-1", {
        kind: "merge",
        sourceGroupId: g1!.id,
        targetGroupIds: [g2!.id, g3!.id],
      });
      expect(preview.groups).toHaveLength(1);

      const step1 = await engine.applyGroupMerge({
        documentId: "doc-1",
        sourceGroupId: g1!.id,
        targetGroupId: g2!.id,
      });
      const step2 = await engine.applyGroupMerge({
        documentId: "doc-1",
        sourceGroupId: g3!.id,
        targetGroupId: g2!.id,
      });

      expect(step1.id).toBe(g2!.id);
      expect(preview.groups[0]).toEqual({
        groupId: step2.id,
        type: step2.type,
        indexInType: step2.indexInType,
        canonicalValue: step2.canonicalValue,
        memberCount: step2.members.length,
        replacementMode: step2.replacementMode,
        replacementValue: step2.replacementValue,
      });
    });

    it("previewEdit(split) equals the group emitted by the real request", async () => {
      const occA = makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Pérez",
        normalizedValue: "juan perez",
      });
      const occB = makeOccurrence({
        entityType: EntityType.Person,
        value: "J. Pérez",
        normalizedValue: "juan perez",
      });
      ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: occA,
      });
      ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: occB,
      });
      const [group] = engine.getSnapshot("doc-1").groups;

      const preview = engine.previewEdit("doc-1", {
        kind: "split",
        groupId: group!.id,
        occurrenceIds: [occB.id],
      });
      expect(preview.groups).toHaveLength(2);
      expect(preview.groups[0]?.groupId).toBe(group!.id);
      expect(preview.groups[1]?.groupId).toBeNull();

      const { merged, created } = await engine.applyGroupSplit({
        documentId: "doc-1",
        groupId: group!.id,
        occurrenceIds: [occB.id],
      });

      expect(preview.groups[0]).toEqual({
        groupId: merged.id,
        type: merged.type,
        indexInType: merged.indexInType,
        canonicalValue: merged.canonicalValue,
        memberCount: merged.members.length,
        replacementMode: merged.replacementMode,
        replacementValue: merged.replacementValue,
      });
      expect(preview.groups[1]).toEqual({
        groupId: null,
        type: created.type,
        indexInType: created.indexInType,
        canonicalValue: created.canonicalValue,
        memberCount: created.members.length,
        replacementMode: created.replacementMode,
        replacementValue: created.replacementValue,
      });
    });
  });
});

describe("GroupingEngine — eliminar una entidad (ADR-171)", () => {
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

  // Caso 49 (§13).
  it("merge and dropOccurrences do not register suppression", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "22222222", normalizedValue: "22222222" }),
    });
    const [g1, g2] = engine.getSnapshot("doc-1").groups;

    await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: g1!.id,
      targetGroupId: g2!.id,
    });
    const afterMerge = engine["sessions"].get("doc-1");
    expect(afterMerge?.removedValues.size).toBe(0);

    engine.dropOccurrences("doc-1", { source: DetectionSource.Regex });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);
    const afterDrop = engine["sessions"].get("doc-1");
    expect(afterDrop?.removedValues.size).toBe(0);
  });

  // Caso 49 (§13, ADR-085 §8: mismo criterio que typeCorrections).
  it("removedValues is not in the snapshot and dies on closeSession", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupRemove({ documentId: "doc-1", groupId: group!.id });

    const snapshot = engine.getSnapshot("doc-1");
    expect(snapshot).not.toHaveProperty("removedValues");
    expect(Object.keys(snapshot)).toEqual(["documentId", "groups", "conflicts", "rules"]);

    const sessionBeforeClose = engine["sessions"].get("doc-1");
    expect(sessionBeforeClose?.removedValues.has("11111111")).toBe(true);

    await engine.closeSession("doc-1");
    expect(engine["sessions"].get("doc-1")).toBeUndefined();
  });

  // Caso 50 (§13, ADR-171 §4).
  it("liftRemoval lets the next manual occurrence of that value group normally", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupRemove({ documentId: "doc-1", groupId: group!.id });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);

    engine.liftRemoval("doc-1", "11111111");

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "11111111",
        normalizedValue: "11111111",
        source: DetectionSource.Manual,
        bbox: makeBBox(0, 500, 60, 12),
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.aliases).toContain("11111111");
  });
});

describe("GroupingEngine — puntos de restauración (ADR-172)", () => {
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

  // Caso 52 (§13).
  it("restoreCheckpoint emits only the diff", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "22222222", normalizedValue: "22222222" }),
    });
    const [g1, g2] = engine.getSnapshot("doc-1").groups;
    const checkpointId = engine.createCheckpoint("doc-1");

    // g1 no se toca. g2 se edita (UPDATED al restaurar). Un g3 nuevo aparece
    // después del checkpoint (REMOVED al restaurar, porque ahí no existía).
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: g2!.id,
      patch: { replacementMode: ReplacementMode.Mask },
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "33333333", normalizedValue: "33333333" }),
    });
    const g3 = engine.getSnapshot("doc-1").groups.find((g) => g.aliases.includes("33333333"));

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    await engine.restoreCheckpoint("doc-1", checkpointId);

    const groupEvents = busEmitSpy.mock.calls.filter(
      ([channel]) => channel === EventChannel.Grouping,
    );

    // g1 idéntico: ni CREATED ni UPDATED ni REMOVED para su id.
    expect(
      groupEvents.some(([, event, payload]) => {
        if (event === EngineEvents.ENTITY_GROUP_REMOVED) {
          return (payload as EntityGroupRemoved).groupId === g1!.id;
        }
        if (
          event === EngineEvents.ENTITY_GROUP_UPDATED ||
          event === EngineEvents.ENTITY_GROUP_CREATED
        ) {
          return (payload as EntityGroupUpdated | EntityGroupCreated).group.id === g1!.id;
        }
        return false;
      }),
    ).toBe(false);

    // g2 cambió: UPDATED con "replacementMode" en changes exacto.
    const g2Updated = groupEvents.find(
      ([, event, payload]) =>
        event === EngineEvents.ENTITY_GROUP_UPDATED &&
        (payload as EntityGroupUpdated).group.id === g2!.id,
    );
    expect(g2Updated).toBeDefined();
    expect((g2Updated?.[2] as EntityGroupUpdated).changes).toContain("replacementMode");

    // g3 sobra: REMOVED.
    expect(
      groupEvents.some(
        ([, event, payload]) =>
          event === EngineEvents.ENTITY_GROUP_REMOVED &&
          (payload as EntityGroupRemoved).groupId === g3!.id,
      ),
    ).toBe(true);
  });

  // Caso 53 (§13). Errata (2026-09-23): la redacción original decía que
  // reopenSession también descartaba los puntos, contradiciendo ADR-172 —
  // el descarte por re-análisis lo hace el Orchestrator en `reanalyze`,
  // antes de llamar a `reopenSession` (Orchestrator.md §6). Este test
  // reemplaza al que afirmaba lo contrario.
  it("closeSession discards all checkpoints; reopenSession keeps them", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const checkpointId = engine.createCheckpoint("doc-1");
    const savedInternal = engine["checkpoints"].get("doc-1")?.get(checkpointId);
    expect(engine["checkpoints"].get("doc-1")?.size).toBe(1);

    // reopenSession NO descarta: el mismo escenario que addManualEntity
    // (ADR-061 §6) — reabrir la sesión, agregar una ocurrencia nueva y
    // volver a cerrar con finishSession no debe tirar el punto.
    engine.reopenSession("doc-1", { expectRegex: true, expectNer: false });
    expect(engine["checkpoints"].get("doc-1")?.size).toBe(1);

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "22222222", normalizedValue: "22222222" }),
    });
    await engine.finishSession("doc-1");
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(2);

    // El punto sigue restaurando la sesión exacta de antes del reopen: la
    // ocurrencia nueva desaparece.
    await engine.restoreCheckpoint("doc-1", checkpointId);
    const restoredInternal = engine["sessions"].get("doc-1");
    expect(restoredInternal?.groups).toEqual(savedInternal?.groups);
    expect(restoredInternal?.nextIndexByType).toEqual(savedInternal?.nextIndexByType);

    const restored = engine.getSnapshot("doc-1").groups;
    expect(restored).toHaveLength(1);
    expect(restored[0]?.aliases).toContain("11111111");
    expect(restored.some((g) => g.aliases.includes("22222222"))).toBe(false);

    // restoreCheckpoint no toca el registro de puntos: el original sigue
    // ahí, y uno nuevo se suma.
    expect(engine["checkpoints"].get("doc-1")?.size).toBe(1);
    engine.createCheckpoint("doc-1");
    expect(engine["checkpoints"].get("doc-1")?.size).toBe(2);

    // Ahora sí: closeSession descarta todo.
    await engine.closeSession("doc-1");
    expect(engine["checkpoints"].has("doc-1")).toBe(false);
  });
});

describe("GroupingEngine — agregado manual que choca (ADR-174)", () => {
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

  // Caso 56 (§13, ADR-174 §1).
  it("a losing manual occurrence is held, not grouped, and marks the conflict heldManual", () => {
    const detected = makeOccurrence({
      entityType: EntityType.CreditCard,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 20),
      value: "4111111111111111",
      normalizedValue: "4111111111111111",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: detected,
    });
    const manual = makeOccurrence({
      entityType: EntityType.IBAN,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 20),
      value: "ES1234",
      normalizedValue: "es1234",
    });

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });

    // Se emite el conflicto, pero NINGÚN evento de grupo para el IBAN: no se
    // agrupa ni se descarta en silencio.
    const conflictCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls).toHaveLength(1);
    const conflict = (conflictCalls[0]?.[2] as ConflictDetected).conflict;
    expect(conflict.heldManual).toBe(true);
    expect(conflict.resolved).toBe(false);
    expect(conflict.resolvedType).toBeUndefined();

    const groupEvents = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping &&
        (event === EngineEvents.ENTITY_GROUP_CREATED ||
          event === EngineEvents.ENTITY_GROUP_UPDATED),
    );
    expect(groupEvents).toHaveLength(0);

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups.some((g) => g.type === EntityType.IBAN)).toBe(false);
    // La detección que ya estaba no se toca.
    const creditCardGroup = groups.find((g) => g.type === EntityType.CreditCard);
    expect(creditCardGroup?.members).toHaveLength(1);
  });

  // Caso 57 (§13, ADR-174 §3).
  it("resolve winner manual groups the held occurrence; detected discards it", async () => {
    function buildHeldConflict(ibanValue: string, ibanNormalized: string) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.CreditCard,
          source: DetectionSource.Regex,
          confidence: 1,
          bbox: makeBBox(0, 0, 100, 20),
          value: "4111111111111111",
          normalizedValue: "4111111111111111",
        }),
      });
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.IBAN,
          source: DetectionSource.Manual,
          confidence: 1,
          bbox: makeBBox(0, 0, 100, 20),
          value: ibanValue,
          normalizedValue: ibanNormalized,
        }),
      });
      // El snapshot acumula conflictos de llamadas anteriores (ya resueltos,
      // sin heldManual): el nuevo retenido es el que todavía lo tiene.
      const conflict = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
      if (!conflict) throw new Error("expected a held conflict");
      return conflict;
    }

    // winner: "manual" agrupa la retenida, sin tocar la detección existente.
    const heldA = buildHeldConflict("ES1111", "es1111");
    const resolvedManual = await engine.applyConflictResolve({
      documentId: "doc-1",
      conflictId: heldA.id,
      winner: "manual",
    });
    expect(resolvedManual.resolved).toBe(true);
    expect(resolvedManual.resolvedType).toBe(EntityType.IBAN);
    expect(resolvedManual.heldManual).toBeUndefined();
    const afterManual = engine.getSnapshot("doc-1").groups;
    expect(afterManual.some((g) => g.type === EntityType.IBAN)).toBe(true);
    expect(afterManual.find((g) => g.type === EntityType.CreditCard)?.members).toHaveLength(1);

    // winner: "detected" descarta la retenida — se resuelve por el tipo YA
    // vigente de la detección, que este camino no toca.
    const heldB = buildHeldConflict("ES2222", "es2222");
    const resolvedDetected = await engine.applyConflictResolve({
      documentId: "doc-1",
      conflictId: heldB.id,
      winner: "detected",
    });
    expect(resolvedDetected.resolved).toBe(true);
    expect(resolvedDetected.resolvedType).toBe(EntityType.CreditCard);
    expect(resolvedDetected.heldManual).toBeUndefined();
    const afterDetected = engine.getSnapshot("doc-1").groups;
    expect(afterDetected.filter((g) => g.type === EntityType.IBAN)).toHaveLength(1); // solo la de heldA
  });
});

describe("GroupingEngine — un choque manual no queda colgado (ADR-175)", () => {
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

  // Caso 58, segunda cláusula (§13, ADR-172 + ADR-174 §3): un punto de
  // restauración tomado ANTES de resolver un heldManual trae de vuelta la
  // retención, y winner: "manual" sigue funcionando sobre el conflicto
  // restaurado.
  it("restoring a checkpoint brings back the held manual occurrence and winner manual groups it", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.CreditCard,
        source: DetectionSource.Regex,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        value: "4111111111111111",
        normalizedValue: "4111111111111111",
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.IBAN,
        source: DetectionSource.Manual,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        value: "ES1234",
        normalizedValue: "es1234",
      }),
    });
    const held = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
    if (!held) throw new Error("expected a held conflict");

    const checkpointId = engine.createCheckpoint("doc-1");

    await engine.applyConflictResolve({
      documentId: "doc-1",
      conflictId: held.id,
      winner: "detected",
    });
    const afterDetected = engine.getSnapshot("doc-1").conflicts.find((c) => c.id === held.id);
    expect(afterDetected?.resolved).toBe(true);
    expect(afterDetected?.heldManual).toBeUndefined();

    await engine.restoreCheckpoint("doc-1", checkpointId);
    const restored = engine.getSnapshot("doc-1").conflicts.find((c) => c.id === held.id);
    expect(restored?.resolved).toBe(false);
    expect(restored?.heldManual).toBe(true);

    const resolvedManual = await engine.applyConflictResolve({
      documentId: "doc-1",
      conflictId: held.id,
      winner: "manual",
    });
    expect(resolvedManual.resolvedType).toBe(EntityType.IBAN);
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.type === EntityType.IBAN)).toBe(true);
  });

  // Caso 59 (§13, ADR-175 §1): applyGroupRemove del grupo detectado oculta
  // sola la retenida — se agrupa por el camino de winner: "manual" y, si su
  // valor normalizado coincidía con un alias del grupo eliminado, la
  // supresión que ese mismo pedido acaba de agregar se revierte para ese
  // valor.
  it("removing the detected group of a held conflict groups the held occurrence", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Email,
        source: DetectionSource.Regex,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        value: "34567891",
        normalizedValue: "34567891",
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Phone,
        source: DetectionSource.Manual,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        value: "34567891",
        normalizedValue: "34567891",
      }),
    });
    const held = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
    if (!held) throw new Error("expected a held conflict");
    const detectedGroup = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.type === EntityType.Email);
    if (!detectedGroup) throw new Error("expected the detected group");

    await engine.applyGroupRemove({ documentId: "doc-1", groupId: detectedGroup.id });

    const snapshot = engine.getSnapshot("doc-1");
    const resolved = snapshot.conflicts.find((c) => c.id === held.id);
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.heldManual).toBeUndefined();
    expect(resolved?.resolvedType).toBe(EntityType.Phone);

    const phoneGroup = snapshot.groups.find((g) => g.type === EntityType.Phone);
    expect(phoneGroup?.members).toHaveLength(1);
    expect(snapshot.groups.some((g) => g.type === EntityType.Email)).toBe(false);

    // El valor normalizado ("34567891") es el mismo en los dos candidatos:
    // applyGroupRemove lo agrega a removedValues al barrer los aliases del
    // grupo Email eliminado, y el camino de arriba lo tiene que revertir —
    // lo que el usuario marcó a mano gana sobre esa supresión.
    expect(engine["sessions"].get("doc-1")?.removedValues.has("34567891")).toBe(false);
  });

  // Caso 62 (§13, ADR-175 §2): un agregado nuevo reabre una decisión
  // "detected" anterior — liftRemoval olvida la identidad suprimida y una
  // re-emisión del mismo literal vuelve a crear un conflicto heldManual.
  it("liftRemoval reopens a choice resolved as detected", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.CreditCard,
        source: DetectionSource.Regex,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        value: "4111111111111111",
        normalizedValue: "4111111111111111",
      }),
    });
    const manual = makeOccurrence({
      entityType: EntityType.IBAN,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 20),
      value: "ES1234",
      normalizedValue: "es1234",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    const held = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
    if (!held) throw new Error("expected a held conflict");

    await engine.applyConflictResolve({
      documentId: "doc-1",
      conflictId: held.id,
      winner: "detected",
    });

    // Re-emitir la misma ocurrencia manual TODAVÍA suprimida: el dedup por
    // identidad la descarta, sin conflicto nuevo (caso 58).
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    expect(engine.getSnapshot("doc-1").conflicts.filter((c) => c.heldManual === true)).toHaveLength(
      0,
    );

    engine.liftRemoval("doc-1", "ES1234");

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    const conflictCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls).toHaveLength(1);
    const reopened = (conflictCalls[0]?.[2] as ConflictDetected).conflict;
    expect(reopened.heldManual).toBe(true);
    expect(reopened.resolved).toBe(false);
  });
});

describe("GroupingEngine — un choque pendiente bloquea el export (ADR-176)", () => {
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

  // Caso 63 (§13, ADR-176 §3): manualOutcome resuelve los cuatro desenlaces
  // de una ocurrencia Manual -- agrupada, deduplicada contra un registro
  // existente, contenida (ADR-117) y retenida (ADR-174) -- sin comparar
  // ningún valor: solo lee la anotación que dejó processOccurrence.
  it("manualOutcome reports grouped, deduped, contained and held occurrences", () => {
    // (1) Agrupada: valor nuevo, sin choque -- crea grupo, su propio registro.
    const grouped = makeOccurrence({
      entityType: EntityType.DNI,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(0, 0, 60, 12),
      pageIndex: 0,
      value: "11111111",
      normalizedValue: "11111111",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: grouped,
    });
    const groupedGroup = engine.getSnapshot("doc-1").groups.find((g) => g.type === EntityType.DNI);
    if (!groupedGroup) throw new Error("expected the group created for 'grouped'");

    // (2) Deduplicada: MISMA identidad que una detección Regex ya registrada.
    const detected = makeOccurrence({
      entityType: EntityType.DNI,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(0, 0, 60, 12),
      pageIndex: 1,
      value: "22222222",
      normalizedValue: "22222222",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: detected,
    });
    const deduped = makeOccurrence({
      id: "man-dedup",
      entityType: EntityType.DNI,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(0, 0, 60, 12), // misma bbox que `detected`
      pageIndex: 1, // misma página que `detected`
      value: "22222222",
      normalizedValue: "22222222",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: deduped,
    });
    const dedupedGroup = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "22222222");
    if (!dedupedGroup) throw new Error("expected the group of the deduped-against record");

    // (3) Contenida (ADR-117): entera adentro de una detección del mismo tipo.
    const container = makeOccurrence({
      entityType: EntityType.Phone,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 12),
      pageIndex: 2,
      value: "11 4567-8901",
      normalizedValue: "11 4567-8901",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: container,
    });
    const contained = makeOccurrence({
      id: "man-contained",
      entityType: EntityType.Phone,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(20, 0, 40, 12), // estrictamente adentro de `container`
      pageIndex: 2,
      value: "4567-8901",
      normalizedValue: "4567-8901",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: contained,
    });
    const containerGroup = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.type === EntityType.Phone);
    if (!containerGroup) throw new Error("expected the container's group");

    // (4) Retenida (ADR-174): pierde una superposición contra otro tipo.
    const heldDetected = makeOccurrence({
      entityType: EntityType.Email,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 12),
      pageIndex: 3,
      value: "a@b.com",
      normalizedValue: "a@b.com",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: heldDetected,
    });
    const held = makeOccurrence({
      id: "man-held",
      entityType: EntityType.Person,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 12),
      pageIndex: 3,
      value: "email a@b.com.",
      normalizedValue: "email a@b.com.",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: held,
    });
    const heldConflict = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
    if (!heldConflict) throw new Error("expected a held conflict");

    const outcome = engine.manualOutcome("doc-1", [grouped.id, deduped.id, contained.id, held.id]);

    expect(new Set(outcome.groupIds)).toEqual(
      new Set([groupedGroup.id, dedupedGroup.id, containerGroup.id]),
    );
    expect(outcome.heldConflictIds).toEqual([heldConflict.id]);
  });

  // Caso 63 (§13, ADR-176 §3): manualOutcome se vacía en reopenSession y
  // nunca sale por getSnapshot.
  it("manualOutcome is cleared on reopenSession and absent from the snapshot", () => {
    const manual = makeOccurrence({
      entityType: EntityType.DNI,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(0, 0, 60, 12),
      pageIndex: 0,
      value: "11111111",
      normalizedValue: "11111111",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    expect(engine.manualOutcome("doc-1", [manual.id]).groupIds).toHaveLength(1);

    // No sale en getSnapshot: GroupingEngineSnapshot no tiene ningún campo
    // que lo exponga (chequeo estructural: las claves conocidas y nada más).
    const snapshot = engine.getSnapshot("doc-1");
    expect(Object.keys(snapshot).sort()).toEqual(
      ["conflicts", "documentId", "groups", "rules"].sort(),
    );

    engine.reopenSession("doc-1", { expectRegex: true, expectNer: false });
    expect(engine.manualOutcome("doc-1", [manual.id]).groupIds).toEqual([]);
  });

  // Caso 64 (§13, ADR-176 §4): liftRemoval olvida TODA identidad suprimida
  // con ese valor -- también la que dejó una eliminación (ADR-171 §2), no
  // solo la de un winner: "detected" (ADR-175 §2, caso 62).
  it("liftRemoval forgets removal-suppressed identities of the value", async () => {
    const original = makeOccurrence({
      entityType: EntityType.DNI,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(0, 0, 60, 12),
      pageIndex: 0,
      value: "11111111",
      normalizedValue: "11111111",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: original,
    });
    const group = engine.getSnapshot("doc-1").groups[0];
    if (!group) throw new Error("expected a group");

    await engine.applyGroupRemove({ documentId: "doc-1", groupId: group.id });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);

    // Una ocurrencia NUEVA (identidad distinta: otra página/bbox) del mismo
    // valor cae en el paso 0 de Matching y queda registrada como suprimida.
    const newPosition = makeOccurrence({
      entityType: EntityType.DNI,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(0, 100, 60, 12),
      pageIndex: 1,
      value: "11111111",
      normalizedValue: "11111111",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: newPosition,
    });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);

    // Sin liftRemoval, re-emitirla otra vez no crea grupo: el dedup por
    // identidad la sigue descartando contra el registro suprimido.
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: { ...newPosition, id: "retry-still-suppressed" },
    });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);
    const groupEventsBeforeLift = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping &&
        (event === EngineEvents.ENTITY_GROUP_CREATED ||
          event === EngineEvents.ENTITY_GROUP_UPDATED),
    );
    expect(groupEventsBeforeLift).toHaveLength(0);

    engine.liftRemoval("doc-1", "11111111");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: { ...newPosition, id: "retry-after-lift" },
    });
    const afterLift = engine.getSnapshot("doc-1").groups;
    expect(afterLift).toHaveLength(1);
    expect(afterLift[0]?.type).toBe(EntityType.DNI);
  });
});
