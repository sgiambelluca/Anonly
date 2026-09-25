import {
  ConflictReason,
  DetectionSource,
  EngineDisposedError,
  EngineEvents,
  EntityType,
  EventChannel,
  InvalidInputError,
  MAX_EDIT_CHECKPOINTS,
  ReplacementMode,
  synthesize,
  type ConflictDetected,
  type ConflictResolved,
  type EngineContext,
  type EntityGroup,
  type EntityGroupCreated,
  type EntityGroupRemoved,
  type EntityGroupUpdated,
  type GroupingFinished,
  type GroupReplacementChanged,
  type GroupUpdateRequested,
} from "@anonly/shared";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { GroupingEngine } from "../grouping.engine.js";
import { GroupingGroupNotFoundError, GroupingInvalidPatchError } from "../grouping.errors.js";
import { buildPlaceholderValue, MASK_FORMAT_BY_TYPE } from "../labels.js";

import {
  createEngineContext,
  makeBBox,
  makeEntityGroup,
  makeOccurrence,
  makeRule,
} from "./fixtures/test-helpers.js";

function byIndex(groups: ReadonlyArray<EntityGroup>, indexInType: number): EntityGroup {
  const group = groups.find((g) => g.indexInType === indexInType);
  if (!group) throw new Error(`No hay grupo con indexInType=${indexInType}`);
  return group;
}

describe("GroupingEngine — edge cases", () => {
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

  // Caso 1 (§13)
  it("empty document emits GROUPING_FINISHED with 0 groups", () => {
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });

    const finished = busEmitSpy.mock.calls.find(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.GROUPING_FINISHED,
    );
    expect(finished).toBeDefined();
    expect((finished?.[2] as GroupingFinished).groupCount).toBe(0);
  });

  // Caso 2 (§13)
  it("single occurrence creates group with indexInType 1", () => {
    const occurrence = makeOccurrence({ value: "34.567.891", normalizedValue: "34567891" });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence,
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.indexInType).toBe(1);
    expect(groups[0]?.members).toHaveLength(1);
    expect(groups[0]?.aliases).toEqual(["34.567.891"]);
  });

  // Caso 4 (§13)
  it("J. Pérez and Juan Pérez do not auto-merge", () => {
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        value: "Juan Pérez",
        normalizedValue: "juan pérez",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        value: "J. Pérez",
        normalizedValue: "j. pérez",
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(2);
  });

  // ADR-073 §1 — Custom queda fuera de FUZZY_MATCHING_TYPES: un carácter de
  // diferencia sobre un valor de patrón custom no agrupa, aunque supere el
  // umbral (el motor no tiene base para decidir si es typo o dato distinto).
  it("Custom does not fuzzy-group", () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Custom,
        value: "EXP-2026-000123",
        normalizedValue: "exp-2026-000123",
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Custom,
        value: "EXP-2026-000124",
        normalizedValue: "exp-2026-000124",
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(2);
  });

  // ADR-073 §7 — la protección del DNI deja de depender de estar a 0.005 del
  // umbral (Contexto §2): sigue sin fusionar aunque el host baje
  // similarityThreshold a 0.80, porque DNI ya no corre el pase difuso.
  it("DNI does not fuzzy-group even with similarityThreshold at 0.80", async () => {
    await engine.dispose();
    ctx = createEngineContext({
      config: { ...ctx.config, grouping: { similarityThreshold: 0.8, minAliasFrequency: 1 } },
    });
    engine = new GroupingEngine();
    await engine.init(ctx);
    engine.startSession("doc-1");

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.DNI,
        value: "34567891",
        normalizedValue: "34567891",
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.DNI,
        value: "34567892",
        normalizedValue: "34567892",
      }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(2);
  });

  // ADR-073 §4 — la asimetría deliberada: dos CUIT que dejan de fusionarse
  // automáticamente se pueden fusionar a mano, con el resultado de siempre.
  it("two groups that no longer auto-merge can still be merged by hand", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.CUIT,
        value: "20-12345678-9",
        normalizedValue: "20123456789",
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.CUIT,
        value: "20-12345678-1",
        normalizedValue: "20123456781",
      }),
    });

    const before = engine.getSnapshot("doc-1").groups;
    expect(before.filter((g) => g.type === EntityType.CUIT)).toHaveLength(2);
    const [first, second] = before;

    const merged = await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: second!.id,
      targetGroupId: first!.id,
    });

    expect(merged.members).toHaveLength(2);
    const { groups: after } = engine.getSnapshot("doc-1");
    expect(after.filter((g) => g.type === EntityType.CUIT)).toHaveLength(1);
  });

  // Caso 5/16 (§13)
  it("manual merge preserves lower indexInType", async () => {
    for (const value of ["11111111", "22222222", "33333333"]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ value, normalizedValue: value }),
      });
    }
    const before = engine.getSnapshot("doc-1").groups;
    const g1 = byIndex(before, 1);
    const g2 = byIndex(before, 2);
    const g3 = byIndex(before, 3);

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    // Fusiona g1 (índice menor) como source dentro de g3 (índice mayor, target):
    // el sobreviviente debe bajar a min(1, 3) = 1, no quedarse en 3.
    const merged = await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: g1.id,
      targetGroupId: g3.id,
    });
    expect(merged.id).toBe(g3.id);
    expect(merged.indexInType).toBe(1);
    expect(merged.aliases).toEqual(expect.arrayContaining(["11111111", "33333333"]));

    const removedCall = busEmitSpy.mock.calls.find(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.ENTITY_GROUP_REMOVED,
    );
    expect((removedCall?.[2] as EntityGroupRemoved)?.groupId).toBe(g1.id);

    const after = engine.getSnapshot("doc-1").groups;
    expect(after).toHaveLength(2);
    expect(after.find((g) => g.id === g2.id)?.indexInType).toBe(2);
  });

  // Caso 6 (§13)
  it("manual split creates new group with nextIndex", async () => {
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
    expect(group?.members).toHaveLength(2);

    const { merged, created } = await engine.applyGroupSplit({
      documentId: "doc-1",
      groupId: group!.id,
      occurrenceIds: [occB.id],
    });

    expect(merged.indexInType).toBe(1);
    expect(merged.members).toHaveLength(1);
    expect(merged.members[0]?.occurrenceId).toBe(occA.id);

    expect(created.indexInType).toBe(2);
    expect(created.members).toHaveLength(1);
    expect(created.members[0]?.occurrenceId).toBe(occB.id);
  });

  // Caso 54 (§13, ADR-173 §1).
  it("applyGroupMerge rejects different types and self-merge without mutating", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.DNI,
        value: "11111111",
        normalizedValue: "11111111",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 1,
        value: "Juan Pérez",
        normalizedValue: "juan pérez",
      }),
    });
    const before = engine.getSnapshot("doc-1");
    const [dni] = before.groups.filter((g) => g.type === EntityType.DNI);
    const [person] = before.groups.filter((g) => g.type === EntityType.Person);

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");

    await expect(
      engine.applyGroupMerge({
        documentId: "doc-1",
        sourceGroupId: dni!.id,
        targetGroupId: person!.id,
      }),
    ).rejects.toThrow(GroupingInvalidPatchError);

    await expect(
      engine.applyGroupMerge({
        documentId: "doc-1",
        sourceGroupId: dni!.id,
        targetGroupId: dni!.id,
      }),
    ).rejects.toThrow(GroupingInvalidPatchError);

    // Ni evento ni mutación: ninguno de los dos grupos cambió.
    const groupEvents = busEmitSpy.mock.calls.filter(
      ([channel]) => channel === EventChannel.Grouping,
    );
    expect(groupEvents).toHaveLength(0);
    expect(engine.getSnapshot("doc-1")).toEqual(before);
  });

  // Caso 55 (§13, ADR-173 §2).
  it("applyGroupSplit rejects empty, foreign and all-members occurrenceIds without mutating", async () => {
    const occA = makeOccurrence({
      entityType: EntityType.DNI,
      value: "11111111",
      normalizedValue: "11111111",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occA,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.DNI,
        value: "22222222",
        normalizedValue: "22222222",
      }),
    });
    const before = engine.getSnapshot("doc-1");
    const [groupA, groupB] = before.groups;

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");

    // occurrenceIds vacío.
    await expect(
      engine.applyGroupSplit({ documentId: "doc-1", groupId: groupA!.id, occurrenceIds: [] }),
    ).rejects.toThrow(GroupingInvalidPatchError);

    // Id ajeno al grupo (member de OTRO grupo).
    await expect(
      engine.applyGroupSplit({
        documentId: "doc-1",
        groupId: groupA!.id,
        occurrenceIds: [groupB!.members[0]!.occurrenceId],
      }),
    ).rejects.toThrow(GroupingInvalidPatchError);

    // Todos los members del grupo: dejaría el original sin members.
    await expect(
      engine.applyGroupSplit({
        documentId: "doc-1",
        groupId: groupA!.id,
        occurrenceIds: groupA!.members.map((m) => m.occurrenceId),
      }),
    ).rejects.toThrow(GroupingInvalidPatchError);

    const groupEvents = busEmitSpy.mock.calls.filter(
      ([channel]) => channel === EventChannel.Grouping,
    );
    expect(groupEvents).toHaveLength(0);
    expect(engine.getSnapshot("doc-1")).toEqual(before);
    // El invariante que esto protege: ningún grupo se queda sin members.
    for (const group of engine.getSnapshot("doc-1").groups) {
      expect(group.members.length).toBeGreaterThanOrEqual(1);
    }
  });

  /*
   * ADR-107: el solapamiento se mide sobre los pedazos REALES.
   *
   * Una entidad partida por un salto de renglón (ADR-074 §1) tiene una
   * envolvente que abarca el bloque de texto entero: arranca donde empieza el
   * pedazo de la primera línea y termina donde termina el de la segunda.
   * Medida contra esa envolvente, choca con todas sus vecinas de esas dos
   * líneas aunque no las toque.
   *
   * Medido sobre una pericia real: **3 conflictos falsos** con la envolvente,
   * **0** con los fragmentos — y un conflicto falso hace que la perdedora no
   * llegue a formar grupo.
   */
  it("no levanta conflicto contra una vecina que solo toca la ENVOLVENTE", () => {
    // Termina la línea 1 en x=400..560 y sigue en la 2 en x=50..90: la
    // envolvente va de 50 a 560, toda la franja.
    const partida = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 1,
      bbox: makeBBox(50, 100, 510, 32),
      fragments: [makeBBox(400, 100, 160, 12), makeBBox(50, 120, 40, 12)],
      value: "Juan Pérez García",
      normalizedValue: "juan perez garcia",
    });
    // Cae DENTRO de la envolvente y no toca ningún pedazo real.
    const vecina = makeOccurrence({
      entityType: EntityType.Organization,
      source: DetectionSource.NER,
      confidence: 0.9,
      bbox: makeBBox(150, 100, 60, 12),
      value: "Empresa S.A.",
      normalizedValue: "empresa sa",
    });

    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: partida,
    });
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: vecina,
    });

    const conflictos = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictos).toHaveLength(0);
  });

  it("sí levanta conflicto cuando un pedazo real se solapa", () => {
    // La no-regresión del test de arriba: si la vecina cae SOBRE el pedazo de
    // la primera línea, el conflicto tiene que seguir saliendo.
    const partida = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 1,
      bbox: makeBBox(50, 100, 510, 32),
      fragments: [makeBBox(400, 100, 160, 12), makeBBox(50, 120, 40, 12)],
      value: "Juan Pérez García",
      normalizedValue: "juan perez garcia",
    });
    const encima = makeOccurrence({
      entityType: EntityType.Organization,
      source: DetectionSource.NER,
      confidence: 0.9,
      bbox: makeBBox(410, 100, 40, 12),
      value: "Empresa S.A.",
      normalizedValue: "empresa sa",
    });

    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: partida,
    });
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: encima,
    });

    const conflictos = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictos).toHaveLength(1);
  });

  // Caso 7 (§13)
  it("overlap conflict detected", () => {
    const existing = makeOccurrence({
      entityType: EntityType.CreditCard,
      source: DetectionSource.Regex,
      confidence: 0.9,
      bbox: makeBBox(0, 0, 100, 20),
      value: "4111111111111111",
      normalizedValue: "4111111111111111",
    });
    const incoming = makeOccurrence({
      entityType: EntityType.IBAN,
      source: DetectionSource.Regex,
      confidence: 0.5,
      bbox: makeBBox(0, 0, 100, 20),
      value: "ES1234",
      normalizedValue: "es1234",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: existing,
    });
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: incoming,
    });

    const conflictCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls).toHaveLength(1);
    const conflict = (conflictCalls[0]?.[2] as ConflictDetected).conflict;
    expect(conflict.reason).toBe(ConflictReason.Overlap);
    expect(conflict.candidates).toHaveLength(2);

    // El de menor confidence (IBAN) pierde: no se agrupa.
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.type === EntityType.IBAN)).toBe(false);
  });

  // Caso 8 (§13)
  it("disagree conflict resolved in favor of regex", () => {
    const existing = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 0.9,
      bbox: makeBBox(0, 0, 100, 20),
      value: "Juan Pérez",
      normalizedValue: "juan pérez",
    });
    const incoming = makeOccurrence({
      entityType: EntityType.DNI,
      source: DetectionSource.Regex,
      confidence: 0.5,
      bbox: makeBBox(0, 0, 100, 20),
      value: "34567891",
      normalizedValue: "34567891",
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: existing,
    });
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: incoming,
    });

    const conflictCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls).toHaveLength(1);
    expect((conflictCalls[0]?.[2] as ConflictDetected).conflict.reason).toBe(
      ConflictReason.Disagree,
    );

    // Regex gana pese a menor confidence: su ocurrencia sí se agrupa.
    const createdCall = busEmitSpy.mock.calls.find(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.ENTITY_GROUP_CREATED,
    );
    expect((createdCall?.[2] as EntityGroupCreated)?.group.type).toBe(EntityType.DNI);
  });

  /*
   * Caso 9 (§13), reescrito por ADR-116. Antes este test fijaba que la
   * ocurrencia se DESCARTABA. El caso medido que lo cambió: sobre un
   * expediente escaneado, el apellido del imputado quedaba a la vista en la
   * única página de veinte donde el modelo le dio 0,612 — con el sello leído
   * al 96 % y un grupo `suarez` ya abierto por las otras diecinueve.
   */
  it("low_confidence occurrence with an EXACT key joins the group, and still emits the conflict", () => {
    const first = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 0.9,
      value: "Juan Pérez",
      normalizedValue: "juan pérez",
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: first,
    });

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const lowConfidence = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 0.5, // < ner.confidenceThreshold (0.7)
      value: "Juan Pérez",
      normalizedValue: "juan pérez",
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: lowConfidence,
    });

    // El rastro de que el detector dudó no se pierde por taparlo (ADR-094).
    const conflictCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls).toHaveLength(1);
    expect((conflictCalls[0]?.[2] as ConflictDetected).conflict.reason).toBe(
      ConflictReason.LowConfidence,
    );

    // …y la ocurrencia entra igual: es el mismo valor, ya confirmado por el
    // documento en el mismo grupo.
    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(2);
  });

  /*
   * ADR-116, la puerta que queda cerrada: `findMatchingGroup` también devuelve
   * un grupo por Levenshtein ≥ 0,88, y esa vía es mucho más floja que una
   * clave idéntica. Medido sobre 8 documentos, CERO ocurrencias bajo el umbral
   * llegaban por ahí — separar las dos no le quita nada a nadie hoy.
   */
  it("low_confidence occurrence that matches only FUZZILY is still discarded", () => {
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.9,
        value: "Juan Pérez",
        normalizedValue: "juan pérez",
      }),
    });

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.5,
        value: "Juan Perez",
        // Levenshtein 0.9 contra "juan pérez": entra al pase difuso, pero la
        // clave NO es la misma.
        normalizedValue: "juan perez",
      }),
    });

    const conflictCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls).toHaveLength(1);

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(1);
  });

  /*
   * ADR-116: la regla NUNCA enciende un grupo. La promoción de ADR-094 §3 es
   * para ocurrencias por encima del umbral; una dudosa más no alcanza.
   */
  it("a low_confidence occurrence does not switch on a suggested group", () => {
    // Sin grupo candidato y siendo sugerible: nace apagado (ADR-094 §1).
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.6,
        value: "Juan Pérez",
        normalizedValue: "juan pérez",
      }),
    });
    expect(engine.getSnapshot("doc-1").groups[0]?.enabled).toBe(false);

    // Una SEGUNDA ocurrencia dudosa del mismo valor entra al grupo…
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.65,
        value: "Juan Pérez",
        normalizedValue: "juan pérez",
        bbox: { x: 10, y: 200, width: 60, height: 12 },
      }),
    });

    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.members).toHaveLength(2);
    // …pero no lo enciende: eso lo decide el usuario, o una detección sobre
    // el umbral.
    expect(group?.enabled).toBe(false);
    expect(group?.needsReview).toBe(true);
  });

  /*
   * ADR-117 — caso 72 (§13). El caso medido: agregar a mano el apellido del
   * imputado sobre un expediente escaneado sumaba 10 ocurrencias nuevas, las
   * 10 arrancadas de adentro de `Bartolomé Arturo Suarez`, `Mariela Suarez` o
   * `Leonardo Suarez` — el apellido de tres personas distintas en un mismo
   * grupo, que en el PDF exportado las tapa a las tres con el mismo token.
   */
  describe("contención del mismo tipo (ADR-117)", () => {
    /** `Leonardo Suarez`, y el `Suarez` de adentro. */
    const nombreCompleto = { x: 100, y: 200, width: 120, height: 12 };
    const apellidoAdentro = { x: 175, y: 200, width: 45, height: 12 };

    function emitir(occurrence: ReturnType<typeof makeOccurrence>): void {
      ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence,
      });
    }

    it("an occurrence fully inside another of the same type is not recorded", () => {
      emitir(
        makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.99,
          value: "Leonardo Suarez",
          normalizedValue: "leonardo suarez",
          bbox: nombreCompleto,
        }),
      );

      // El apellido suelto que el barrido literal arranca de adentro.
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.Manual,
          confidence: 1.0,
          value: "Suarez",
          normalizedValue: "suarez",
          bbox: apellidoAdentro,
        }),
      });

      const { groups } = engine.getSnapshot("doc-1");
      expect(groups).toHaveLength(1);
      expect(groups[0]?.canonicalValue).toBe("Leonardo Suarez");
      expect(groups[0]?.members).toHaveLength(1);
    });

    it("a PARTIAL overlap of the same type is still recorded", () => {
      // La contención es estricta: si asoma tinta que la otra no cubre, hay
      // entidad nueva. Medido: 0 solapamientos parciales del mismo tipo en 8
      // documentos, así que esto fija el límite, no un caso frecuente.
      emitir(
        makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.99,
          value: "Leonardo Suarez",
          normalizedValue: "leonardo suarez",
          bbox: nombreCompleto,
        }),
      );
      emitir(
        makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.98,
          value: "Suarez Pérez",
          normalizedValue: "suarez pérez",
          // Arranca adentro y termina AFUERA del nombre completo.
          bbox: { x: 175, y: 200, width: 90, height: 12 },
        }),
      );

      expect(engine.getSnapshot("doc-1").groups).toHaveLength(2);
    });

    it("containment of a DIFFERENT type still goes through the overlap conflict", () => {
      // Dos tipos sobre la misma tinta son un desacuerdo entre detectores, y
      // eso lo resuelve la regla de los casos 7-8, no ésta.
      emitir(
        makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.99,
          value: "Leonardo Suarez",
          normalizedValue: "leonardo suarez",
          bbox: nombreCompleto,
        }),
      );

      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.Organization,
          source: DetectionSource.Regex,
          confidence: 1.0,
          value: "Suarez",
          normalizedValue: "suarez",
          bbox: apellidoAdentro,
        }),
      });

      const conflictCalls = busEmitSpy.mock.calls.filter(
        ([channel, event]) =>
          channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
      );
      expect(conflictCalls).toHaveLength(1);
    });

    it("does not treat a neighbour inside the ENVELOPE of a multi-line entity as contained", () => {
      /*
       * ADR-107, aplicado a la contención: la envolvente de una entidad
       * partida por un salto de renglón abarca el bloque entero, así que
       * medir contra ella haría desaparecer a cualquier vecina de esas dos
       * líneas. Se mide contra los FRAGMENTOS.
       */
      emitir(
        makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.99,
          value: "María Fernanda\nLópez",
          normalizedValue: "maría fernanda lópez",
          bbox: { x: 100, y: 200, width: 200, height: 40 }, // envolvente de las dos líneas
          fragments: [
            { x: 240, y: 200, width: 60, height: 12 }, // final del primer renglón
            { x: 100, y: 228, width: 50, height: 12 }, // principio del segundo
          ],
        }),
      );

      // Cae dentro de la ENVOLVENTE pero no de ningún fragmento.
      emitir(
        makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.97,
          value: "Ana Ruiz",
          normalizedValue: "ana ruiz",
          bbox: { x: 110, y: 202, width: 60, height: 12 },
        }),
      );

      expect(engine.getSnapshot("doc-1").groups).toHaveLength(2);
    });

    // Caso 65 (§13, ADR-177 §1): un contenedor no vivo (grupo eliminado) no
    // tapa nada -- la contención de ADR-117 exige un contenedor VIVO.
    it("an occurrence inside a removed entity is grouped, not discarded as contained", async () => {
      emitir(
        makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.99,
          value: "Juan Perez",
          normalizedValue: "juan perez",
          bbox: nombreCompleto,
        }),
      );
      const containerGroup = engine.getSnapshot("doc-1").groups[0];
      if (!containerGroup) throw new Error("expected a group");
      await engine.applyGroupRemove({ documentId: "doc-1", groupId: containerGroup.id });
      expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);

      // Fuente Manual: manualOutcome tiene que reportar el grupo nuevo.
      const manual = makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.Manual,
        confidence: 1.0,
        value: "Perez",
        normalizedValue: "perez",
        bbox: apellidoAdentro,
      });
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: manual,
      });
      const afterManual = engine.getSnapshot("doc-1").groups;
      expect(afterManual).toHaveLength(1);
      expect(afterManual[0]?.canonicalValue).toBe("Perez");
      expect(engine.manualOutcome("doc-1", [manual.id]).groupIds).toEqual([afterManual[0]?.id]);

      // Fuente detección (NER): también se agrupa, no se descarta.
      emitir(
        makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.95,
          value: "Perez",
          normalizedValue: "perez",
          bbox: { x: 300, y: 400, width: 45, height: 12 },
        }),
      );
      expect(engine.getSnapshot("doc-1").groups).toHaveLength(1);
      expect(engine.getSnapshot("doc-1").groups[0]?.members).toHaveLength(2);
    });
  });

  // Caso 66 (§13, ADR-177 §1): un registro no vivo no puede chocar --
  // eliminado o suprimido, la superposición deja de plantear conflicto.
  describe("una entidad eliminada o suprimida no choca (ADR-177 §1)", () => {
    it("an occurrence overlapping a removed or suppressed record raises no conflict", async () => {
      // Rama 1: Email detectado y eliminado; Persona Manual superpuesta.
      const email = makeOccurrence({
        entityType: EntityType.Email,
        source: DetectionSource.Regex,
        confidence: 1.0,
        value: "juan@x.com",
        normalizedValue: "juan@x.com",
        bbox: makeBBox(100, 200, 100, 12),
      });
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: email,
      });
      const emailGroup = engine.getSnapshot("doc-1").groups[0];
      if (!emailGroup) throw new Error("expected a group");
      await engine.applyGroupRemove({ documentId: "doc-1", groupId: emailGroup.id });
      expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);

      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const overlappingManual = makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.Manual,
        confidence: 1.0,
        value: "email juan@x.com.",
        normalizedValue: "email juan@x.com.",
        bbox: makeBBox(100, 200, 100, 12), // mismo rectángulo: ratio 1 > 0.5
      });
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: overlappingManual,
      });

      const afterOverlap = engine.getSnapshot("doc-1").groups;
      expect(afterOverlap).toHaveLength(1);
      expect(afterOverlap[0]?.type).toBe(EntityType.Person);
      const conflictCalls = busEmitSpy.mock.calls.filter(
        ([channel, event]) =>
          channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
      );
      expect(conflictCalls).toHaveLength(0);
      expect(engine.getSnapshot("doc-1").conflicts.some((c) => !c.resolved)).toBe(false);

      // Rama 2: mismo caso contra un registro SUPRIMIDO (SUPPRESSED_GROUP_ID),
      // en vez de un grupo eliminado -- un DNI cuyo valor está en removedValues
      // (por la eliminación de un primer DNI del mismo valor) se registra bajo
      // SUPPRESSED_GROUP_ID al llegar por el paso 0 de Matching (ADR-171 §3).
      const firstDni = makeOccurrence({
        entityType: EntityType.DNI,
        source: DetectionSource.Regex,
        confidence: 1.0,
        value: "22222222",
        normalizedValue: "22222222",
        bbox: makeBBox(500, 600, 60, 12),
      });
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: firstDni,
      });
      const dniGroup = engine.getSnapshot("doc-1").groups.find((g) => g.type === EntityType.DNI);
      if (!dniGroup) throw new Error("expected a DNI group");
      await engine.applyGroupRemove({ documentId: "doc-1", groupId: dniGroup.id });

      // Segunda aparición del mismo valor, en OTRA posición: identidad
      // distinta, cae por el paso 0 de Matching y se registra suprimida
      // (SUPPRESSED_GROUP_ID) en ESTA posición.
      const suppressedDni = makeOccurrence({
        entityType: EntityType.DNI,
        source: DetectionSource.Regex,
        confidence: 1.0,
        value: "22222222",
        normalizedValue: "22222222",
        bbox: makeBBox(200, 300, 60, 12),
      });
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: suppressedDni,
      });
      expect(engine.getSnapshot("doc-1").groups.some((g) => g.type === EntityType.DNI)).toBe(false);

      const busEmitSpy2 = vi.spyOn(ctx.bus, "emit");
      const overlappingOnSuppressed = makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.Manual,
        confidence: 1.0,
        value: "DNI 22222222 de Juan",
        normalizedValue: "dni 22222222 de juan",
        bbox: makeBBox(200, 300, 60, 12), // mismo rectángulo que el DNI suprimido
      });
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: overlappingOnSuppressed,
      });
      const conflictCalls2 = busEmitSpy2.mock.calls.filter(
        ([channel, event]) =>
          channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
      );
      expect(conflictCalls2).toHaveLength(0);
      expect(
        engine
          .getSnapshot("doc-1")
          .groups.some((g) => g.canonicalValue === overlappingOnSuppressed.value),
      ).toBe(true);
    });
  });

  // Caso 66 (§13, ADR-177 §1): el dedup por identidad NO cambia -- sigue
  // mirando todos los registros, vivos o no.
  it("identity dedup still sees removed records without liftRemoval", async () => {
    const original = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 0.99,
      value: "Juan Perez",
      normalizedValue: "juan perez",
      bbox: makeBBox(100, 200, 120, 12),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: original,
    });
    const group = engine.getSnapshot("doc-1").groups[0];
    if (!group) throw new Error("expected a group");
    await engine.applyGroupRemove({ documentId: "doc-1", groupId: group.id });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);

    // Re-emitir la ocurrencia EXACTA eliminada, sin liftRemoval: el dedup
    // por identidad la descarta -- ningún grupo nuevo.
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: { ...original, id: "retry-exact-identity" },
    });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);
    const groupEvents = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping &&
        (event === EngineEvents.ENTITY_GROUP_CREATED ||
          event === EngineEvents.ENTITY_GROUP_UPDATED),
    );
    expect(groupEvents).toHaveLength(0);
  });

  // Caso 67 (§13, ADR-178 §4): el orden no cambia el resultado -- "agrego y
  // elimino" (guardado + re-proceso, ADR-178 §1-§2) termina igual que
  // "elimino y agrego" (ADR-177 §1, caso 65), y un re-análisis posterior
  // converge al mismo estado sin `liftRemoval`.
  it("removal order does not change what is hidden", async () => {
    const containerBbox = makeBBox(100, 200, 120, 12);
    const insideBbox = makeBBox(160, 200, 45, 12);
    const looseBbox = makeBBox(400, 200, 45, 12);

    function detectContainer(docId: string): void {
      ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
        documentId: docId,
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.99,
          value: "Juan Perez",
          normalizedValue: "juan perez",
          pageIndex: 0,
          bbox: containerBbox,
        }),
      });
    }
    function addManualPerez(docId: string, bbox: ReturnType<typeof makeBBox>): void {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: docId,
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.Manual,
          confidence: 1.0,
          value: "Perez",
          normalizedValue: "perez",
          pageIndex: 0,
          bbox,
        }),
      });
    }
    function finalMemberBboxes(docId: string): ReturnType<typeof makeBBox>[] {
      const perezGroup = engine.getSnapshot(docId).groups.find((g) => g.canonicalValue === "Perez");
      if (!perezGroup) throw new Error(`expected a Perez group in ${docId}`);
      return [...perezGroup.members.map((m) => m.bbox)].sort((a, b) => a.x - b.x);
    }

    // Orden A: agrego (contenida + suelta) y DESPUÉS elimino.
    detectContainer("doc-1");
    addManualPerez("doc-1", insideBbox);
    addManualPerez("doc-1", looseBbox);
    const containerA = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Juan Perez");
    if (!containerA) throw new Error("expected the container group (order A)");
    await engine.applyGroupRemove({ documentId: "doc-1", groupId: containerA.id });
    const membersA = finalMemberBboxes("doc-1");
    expect(membersA).toHaveLength(2);

    // Orden B: elimino y DESPUÉS agrego (ADR-177 §1, caso 65).
    engine.startSession("doc-2");
    detectContainer("doc-2");
    const containerB = engine
      .getSnapshot("doc-2")
      .groups.find((g) => g.canonicalValue === "Juan Perez");
    if (!containerB) throw new Error("expected the container group (order B)");
    await engine.applyGroupRemove({ documentId: "doc-2", groupId: containerB.id });
    addManualPerez("doc-2", insideBbox);
    addManualPerez("doc-2", looseBbox);
    const membersB = finalMemberBboxes("doc-2");

    expect(membersB).toEqual(membersA);

    // Re-análisis posterior de la página (doc-1), SIN liftRemoval: "juan
    // perez" sigue en removedValues, así que la re-detección se suprime
    // (paso 0 de Matching) en vez de revivir el contenedor, y las manuales
    // re-aplicadas se agrupan directo (ADR-177 §1, caso 66) -- mismos
    // members que antes del re-análisis.
    engine.dropOccurrences("doc-1", { pageIndices: [0] });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);
    detectContainer("doc-1");
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);
    addManualPerez("doc-1", insideBbox);
    addManualPerez("doc-1", looseBbox);
    const membersAfterReanalysis = finalMemberBboxes("doc-1");
    expect(membersAfterReanalysis).toEqual(membersA);
  });

  // Caso 67 (§13, ADR-178 §1): solo se guarda lo MANUAL -- una detección
  // contenida se sigue descartando sin guardar -- y sin duplicar por
  // identidad.
  it("a detected contained occurrence is not kept", async () => {
    const containerBbox = makeBBox(100, 200, 120, 12);
    const insideBbox = makeBBox(160, 200, 45, 12);
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.99,
        value: "Juan Perez",
        normalizedValue: "juan perez",
        bbox: containerBbox,
      }),
    });
    const container = engine.getSnapshot("doc-1").groups[0];
    if (!container) throw new Error("expected the container group");

    // Detección (NER) contenida: se descarta como siempre, SIN guardar.
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.9,
        value: "Perez",
        normalizedValue: "perez",
        bbox: insideBbox,
      }),
    });
    expect(engine["sessions"].get("doc-1")?.containedManualOccurrences.size).toBe(0);

    await engine.applyGroupRemove({ documentId: "doc-1", groupId: container.id });
    // Nada reaparece: la detección contenida se perdió, como siempre pasaba.
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);

    // --- Una Manual contenida no se guarda dos veces. ---
    const container2Bbox = makeBBox(100, 300, 120, 12);
    const inside2Bbox = makeBBox(160, 300, 45, 12);
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.99,
        value: "Ana Gomez",
        normalizedValue: "ana gomez",
        bbox: container2Bbox,
      }),
    });
    const container2 = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Ana Gomez");
    if (!container2) throw new Error("expected the second container group");
    const container2OccurrenceId = container2.members[0]?.occurrenceId;
    if (!container2OccurrenceId) throw new Error("expected the container's member occurrenceId");

    const contained = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.Manual,
      confidence: 1.0,
      value: "Gomez",
      normalizedValue: "gomez",
      bbox: inside2Bbox,
    });
    // Se re-emite la MISMA ocurrencia (misma identidad) dos veces.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: contained,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: contained,
    });
    const saved = engine["sessions"]
      .get("doc-1")
      ?.containedManualOccurrences.get(container2OccurrenceId);
    expect(saved).toHaveLength(1);

    await engine.applyGroupRemove({ documentId: "doc-1", groupId: container2.id });
    const gomezGroup = engine.getSnapshot("doc-1").groups.find((g) => g.canonicalValue === "Gomez");
    if (!gomezGroup) throw new Error("expected the Gomez group after removal");
    expect(gomezGroup.members).toHaveLength(1);
  });

  // Caso 68 (§13, ADR-178 §2-§3): vida de lo guardado frente a
  // `dropOccurrences` y a los puntos de restauración.
  it("kept contained occurrences follow dropOccurrences and checkpoints", async () => {
    // --- A: drop por página que ALCANZA a la guardada -- se descarta. ---
    const containerABbox = makeBBox(100, 200, 120, 12);
    const insideABbox = makeBBox(160, 200, 45, 12);
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.99,
        value: "Juan Perez",
        normalizedValue: "juan perez",
        pageIndex: 0,
        bbox: containerABbox,
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.Manual,
        confidence: 1.0,
        value: "Perez",
        normalizedValue: "perez",
        pageIndex: 0,
        bbox: insideABbox,
      }),
    });
    expect(engine["sessions"].get("doc-1")?.containedManualOccurrences.size).toBe(1);

    engine.dropOccurrences("doc-1", { pageIndices: [0] });
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.canonicalValue === "Perez")).toBe(
      false,
    );
    expect(engine["sessions"].get("doc-1")?.containedManualOccurrences.size).toBe(0);

    // --- B: drop por fuente NER que borra el contenedor y NO alcanza a la
    // Manual -- se re-procesa y se agrupa. ---
    const containerBBbox = makeBBox(100, 200, 120, 12);
    const insideBBbox = makeBBox(160, 200, 45, 12);
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.99,
        value: "Juan Lopez",
        normalizedValue: "juan lopez",
        pageIndex: 1,
        bbox: containerBBbox,
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.Manual,
        confidence: 1.0,
        value: "Lopez",
        normalizedValue: "lopez",
        pageIndex: 1,
        bbox: insideBBbox,
      }),
    });
    expect(engine["sessions"].get("doc-1")?.containedManualOccurrences.size).toBe(1);

    engine.dropOccurrences("doc-1", { source: DetectionSource.NER });
    const lopezGroup = engine.getSnapshot("doc-1").groups.find((g) => g.canonicalValue === "Lopez");
    if (!lopezGroup) throw new Error("expected the Lopez group after the NER drop");
    expect(lopezGroup.members).toHaveLength(1);
    expect(engine["sessions"].get("doc-1")?.containedManualOccurrences.size).toBe(0);

    // --- C: checkpoint -- eliminar -- restaurar devuelve la guardada (sin
    // agrupar, Map restaurado) -- re-eliminar la agrupa. ---
    const containerCBbox = makeBBox(100, 200, 120, 12);
    const insideCBbox = makeBBox(160, 200, 45, 12);
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.99,
        value: "Marta Diaz",
        normalizedValue: "marta diaz",
        pageIndex: 2,
        bbox: containerCBbox,
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.Manual,
        confidence: 1.0,
        value: "Diaz",
        normalizedValue: "diaz",
        pageIndex: 2,
        bbox: insideCBbox,
      }),
    });
    const containerC = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Marta Diaz");
    if (!containerC) throw new Error("expected the container group C");

    const checkpointId = engine.createCheckpoint("doc-1");
    await engine.applyGroupRemove({ documentId: "doc-1", groupId: containerC.id });
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.canonicalValue === "Diaz")).toBe(true);
    expect(engine["sessions"].get("doc-1")?.containedManualOccurrences.size).toBe(0);

    await engine.restoreCheckpoint("doc-1", checkpointId);
    // La guardada vuelve tal cual: sin agrupar, y el contenedor sigue vivo.
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.canonicalValue === "Diaz")).toBe(false);
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.canonicalValue === "Marta Diaz")).toBe(
      true,
    );
    expect(engine["sessions"].get("doc-1")?.containedManualOccurrences.size).toBe(1);

    const restoredContainer = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Marta Diaz");
    if (!restoredContainer) throw new Error("expected the restored container group");
    await engine.applyGroupRemove({ documentId: "doc-1", groupId: restoredContainer.id });
    const diazGroup = engine.getSnapshot("doc-1").groups.find((g) => g.canonicalValue === "Diaz");
    if (!diazGroup) throw new Error("expected the Diaz group after re-removal");
    expect(diazGroup.members).toHaveLength(1);

    // --- D: no sale en el snapshot; closeSession la descarta. ---
    const snapshot = engine.getSnapshot("doc-1");
    expect(Object.keys(snapshot).sort()).toEqual(
      ["conflicts", "documentId", "groups", "rules"].sort(),
    );
    await engine.closeSession("doc-1");
    expect(engine["sessions"].get("doc-1")).toBeUndefined();
  });

  // Caso 69 (§13, ADR-178 §2, O6-1 de la revisión 6): el re-proceso puede
  // chocar y perder -- lo guardado no siempre vuelve a agruparse solo, a
  // veces queda RETENIDO en un conflicto nuevo (ADR-174 §1), nunca perdido.
  it("removing a container can hold a kept occurrence in a new conflict", async () => {
    function assertHeldManualInvariant(): void {
      // Mismo chequeo del caso 61 (`no path leaves a resolved conflict with
      // heldManual`): no accesible desde acá (función local de otro `it`),
      // así que se repite inline.
      const snapshot = engine.getSnapshot("doc-1");
      for (const conflict of snapshot.conflicts) {
        if (conflict.heldManual === true) expect(conflict.resolved).toBe(false);
        if (!conflict.resolved) {
          expect(snapshot.groups.some((g) => g.id === conflict.groupId)).toBe(true);
        }
      }
      const unresolvedHeldIds = new Set(
        snapshot.conflicts.filter((c) => c.heldManual === true && !c.resolved).map((c) => c.id),
      );
      const session = engine["sessions"].get("doc-1");
      expect(new Set(session?.heldManualOccurrences.keys())).toEqual(unresolvedHeldIds);
    }

    // «Juan Perez» (Persona, NER) y «Perez SA» (Organización, Regex),
    // superpuestas en la posición de «Perez». Fuentes distintas → Disagree:
    // Perez SA (Regex) gana contra Juan Perez y forma su propio grupo
    // (caso 8) sin tocar el grupo de Juan Perez.
    const containerBbox = makeBBox(100, 200, 120, 12); // 100-220: «Juan Perez»
    const orgBbox = makeBBox(150, 200, 60, 12); // 150-210: «Perez SA»
    const manualBbox = makeBBox(160, 200, 45, 12); // 160-205: «Perez» manual

    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.99,
        value: "Juan Perez",
        normalizedValue: "juan perez",
        bbox: containerBbox,
      }),
    });
    const containerGroup = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Juan Perez");
    if (!containerGroup) throw new Error("expected the container group");

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Organization,
        source: DetectionSource.Regex,
        confidence: 1,
        value: "Perez SA",
        normalizedValue: "perez sa",
        bbox: orgBbox,
      }),
    });
    const orgGroup = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Perez SA");
    if (!orgGroup) throw new Error("expected the Perez SA group (it has to win its Disagree)");
    assertHeldManualInvariant();

    // Manual «Perez» (Persona), contenida (estricta, mismo tipo) en «Juan
    // Perez»: queda GUARDADA -- sin grupo propio, sin registrar, sin chocar
    // contra «Perez SA» todavía (ADR-178 §1, la contención se resuelve antes
    // que la superposición).
    const manual = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.Manual,
      confidence: 1,
      value: "Perez",
      normalizedValue: "perez",
      bbox: manualBbox,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.canonicalValue === "Perez")).toBe(
      false,
    );
    const containerOccurrenceId = containerGroup.members[0]?.occurrenceId;
    if (!containerOccurrenceId) throw new Error("expected the container's member occurrenceId");
    expect(
      engine["sessions"].get("doc-1")?.containedManualOccurrences.get(containerOccurrenceId),
    ).toHaveLength(1);
    assertHeldManualInvariant();

    // Punto de restauración ANTES de la eliminación.
    const checkpointId = engine.createCheckpoint("doc-1");

    // Elimino «Juan Perez»: el re-proceso de lo guardado choca contra
    // «Perez SA» (Disagree, Manual pierde) -- queda RETENIDO, no agrupado
    // ni perdido.
    await engine.applyGroupRemove({ documentId: "doc-1", groupId: containerGroup.id });
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.canonicalValue === "Perez")).toBe(
      false,
    );
    expect(engine["sessions"].get("doc-1")?.containedManualOccurrences.size).toBe(0);
    const heldConflict = engine
      .getSnapshot("doc-1")
      .conflicts.find((c) => c.heldManual === true && !c.resolved);
    if (!heldConflict) throw new Error("expected a new held conflict against Perez SA's group");
    expect(heldConflict.groupId).toBe(orgGroup.id);
    assertHeldManualInvariant();

    // restoreCheckpoint a antes de la eliminación: el conflicto nuevo deja
    // de existir y lo guardado vuelve a su contenedor.
    await engine.restoreCheckpoint("doc-1", checkpointId);
    expect(engine.getSnapshot("doc-1").conflicts.some((c) => c.id === heldConflict.id)).toBe(false);
    expect(
      engine["sessions"].get("doc-1")?.containedManualOccurrences.get(containerOccurrenceId),
    ).toHaveLength(1);
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.canonicalValue === "Juan Perez")).toBe(
      true,
    );
    assertHeldManualInvariant();

    // Re-eliminar reproduce el mismo conflicto retenido.
    await engine.applyGroupRemove({ documentId: "doc-1", groupId: containerGroup.id });
    const heldConflictAgain = engine
      .getSnapshot("doc-1")
      .conflicts.find((c) => c.heldManual === true && !c.resolved);
    if (!heldConflictAgain) throw new Error("expected the held conflict to reappear");
    expect(heldConflictAgain.groupId).toBe(orgGroup.id);
    assertHeldManualInvariant();

    // winner: "manual" lo agrupa, como en el caso 57.
    const resolved = await engine.applyConflictResolve({
      documentId: "doc-1",
      conflictId: heldConflictAgain.id,
      winner: "manual",
    });
    expect(resolved.resolved).toBe(true);
    expect(resolved.resolvedType).toBe(EntityType.Person);
    expect(resolved.heldManual).toBeUndefined();
    const perezGroup = engine.getSnapshot("doc-1").groups.find((g) => g.canonicalValue === "Perez");
    if (!perezGroup) throw new Error("expected the Perez group after winner: manual");
    expect(perezGroup.members).toHaveLength(1);
    assertHeldManualInvariant();
  });

  // Caso 10 (§13)
  it("ambiguous_canonical conflict emitted", () => {
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Maria",
        normalizedValue: "maria",
      }),
    });
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "MARIA",
        normalizedValue: "maria",
      }),
    });

    const conflictCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls).toHaveLength(1);
    expect((conflictCalls[0]?.[2] as ConflictDetected).conflict.reason).toBe(
      ConflictReason.AmbiguousCanonical,
    );
  });

  // Caso 11 (§13)
  it("replacementMode change recalculates replacementValue", async () => {
    const occurrence = makeOccurrence({ value: "34.567.891", normalizedValue: "34567891" });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence,
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    const previousValue = group?.replacementValue;

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Synthetic },
    });

    expect(updated.replacementMode).toBe(ReplacementMode.Synthetic);
    expect(updated.replacementValue).not.toBe(previousValue);
    const seed = engine["sessions"].get("doc-1")!.seed as string;
    expect(updated.replacementValue).toBe(
      synthesize({ type: EntityType.DNI, groupId: group!.id, seed, indexInType: 1 }),
    );

    const replacementChangedCall = busEmitSpy.mock.calls.find(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.GROUP_REPLACEMENT_CHANGED,
    );
    expect(replacementChangedCall).toBeDefined();
    expect((replacementChangedCall?.[2] as GroupReplacementChanged).mode).toBe(
      ReplacementMode.Synthetic,
    );
    const updatedCall = busEmitSpy.mock.calls.find(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.ENTITY_GROUP_UPDATED,
    );
    expect(updatedCall).toBeDefined();
  });

  // Caso 12 (§13)
  it("type rule overrides default mode for all groups of type", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "22222222", normalizedValue: "22222222" }),
    });

    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("type", ReplacementMode.Mask, { entityType: EntityType.DNI }),
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.replacementMode).toBe(ReplacementMode.Mask);
      expect(group.replacementValue).toBe(MASK_FORMAT_BY_TYPE[EntityType.DNI]);
    }
  });

  // Caso 13 (§13)
  it("global rule applies to groups without more specific rule", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.DNI,
        value: "11111111",
        normalizedValue: "11111111",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        value: "Juan Pérez",
        normalizedValue: "juan pérez",
        // bbox distinto al default: evita un falso conflicto "disagree" con
        // la ocurrencia DNI de arriba (mismo bbox por default, distinto tipo
        // y fuente clasificaría como disagree y descartaría esta ocurrencia).
        bbox: makeBBox(10, 300, 90, 12),
      }),
    });

    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("global", ReplacementMode.Redact),
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.replacementMode).toBe(ReplacementMode.Redact);
      expect(group.replacementValue).toBe("");
    }
  });

  // Caso 14 (§13)
  it("group rule wins over type rule wins over global", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("global", ReplacementMode.Redact),
    });
    expect(engine.getSnapshot("doc-1").groups[0]?.replacementMode).toBe(ReplacementMode.Redact);

    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("type", ReplacementMode.Mask, { entityType: EntityType.DNI }),
    });
    expect(engine.getSnapshot("doc-1").groups[0]?.replacementMode).toBe(ReplacementMode.Mask);

    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("group", ReplacementMode.Synthetic, { groupId: group!.id }),
    });
    expect(engine.getSnapshot("doc-1").groups[0]?.replacementMode).toBe(ReplacementMode.Synthetic);
  });

  // Caso 15 (§13)
  it("indexInType stable after group removal", async () => {
    for (const value of ["11111111", "22222222", "33333333"]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ value, normalizedValue: value }),
      });
    }
    const before = engine.getSnapshot("doc-1").groups;
    const g1 = byIndex(before, 1);
    const g2 = byIndex(before, 2);

    // "Elimina" DNI 02 fusionándolo (source) dentro de DNI 01 (target, índice
    // ya menor): el target no cambia de índice, DNI 03 no participa.
    await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: g2.id,
      targetGroupId: g1.id,
    });

    const after = engine.getSnapshot("doc-1").groups;
    const indices = after.map((g) => g.indexInType).sort((a, b) => a - b);
    expect(indices).toEqual([1, 3]);
  });

  // Caso 48 + caso 15 (§13, ADR-171 §2).
  it("removed group leaves an indexInType hole until the next finishSession", async () => {
    for (const value of ["11111111", "22222222", "33333333"]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ value, normalizedValue: value }),
      });
    }
    const before = engine.getSnapshot("doc-1").groups;
    const g2 = byIndex(before, 2);

    await engine.applyGroupRemove({ documentId: "doc-1", groupId: g2.id });

    const after = engine.getSnapshot("doc-1").groups;
    const indices = after.map((g) => g.indexInType).sort((a, b) => a - b);
    expect(indices).toEqual([1, 3]);

    await engine.finishSession("doc-1");
    const compacted = engine.getSnapshot("doc-1").groups.map((g) => g.indexInType);
    expect(compacted.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  // Caso 48 (§13, ADR-171 §2).
  it("applyGroupRemove on an unknown group warns and is a no-op", async () => {
    await expect(
      engine.applyGroupRemove({ documentId: "doc-1", groupId: "no-existe" }),
    ).resolves.toBeUndefined();
    expect(ctx.logger.warn).toHaveBeenCalled();
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);
  });

  // Caso 49 (§13, ADR-171 §3) — el test de que eliminar dura: sin él, un
  // re-análisis devuelve la entidad sola.
  it("a removed value is not regrouped after reopenSession + re-detection, from any source", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "Banco Nación",
        normalizedValue: "banco nacion",
        entityType: EntityType.Organization,
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupRemove({ documentId: "doc-1", groupId: group!.id });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);

    engine.reopenSession("doc-1", { expectRegex: true, expectNer: true });
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");

    // Regex vuelve a encontrarlo.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "Banco Nación",
        normalizedValue: "banco nacion",
        entityType: EntityType.Organization,
        bbox: makeBBox(0, 500, 100, 12),
      }),
    });
    // NER también lo encuentra, en otra parte de la página.
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "Banco Nación",
        normalizedValue: "banco nacion",
        entityType: EntityType.Organization,
        source: DetectionSource.NER,
        bbox: makeBBox(0, 700, 100, 12),
      }),
    });
    // Y hasta un agregado MANUAL del mismo valor (ADR-171 §3: "de cualquier
    // fuente, incluida Manual" — la re-aplicación automática de literales
    // retenidos del Orchestrator, ADR-061 §5, no llama a liftRemoval).
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "Banco Nación",
        normalizedValue: "banco nacion",
        entityType: EntityType.Organization,
        source: DetectionSource.Manual,
        bbox: makeBBox(0, 900, 100, 12),
      }),
    });

    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 2,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 1,
      durationMs: 1,
    });

    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);
    expect(
      busEmitSpy.mock.calls.some(
        ([channel, event]) =>
          channel === EventChannel.Grouping && event === EngineEvents.ENTITY_GROUP_CREATED,
      ),
    ).toBe(false);
  });

  // Caso 17 (§13)
  it("user edit preserved when new ENTITY_FOUND arrives", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "34.567.891", normalizedValue: "34567891" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Mask },
    });
    expect(engine.getSnapshot("doc-1").groups[0]?.replacementMode).toBe(ReplacementMode.Mask);

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "34567891", normalizedValue: "34567891" }),
    });

    const after = engine.getSnapshot("doc-1").groups[0];
    expect(after?.members).toHaveLength(2);
    expect(after?.replacementMode).toBe(ReplacementMode.Mask);
  });

  // Caso 18 (§13)
  it("manual canonicalValue override allowed", async () => {
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Ana",
        normalizedValue: "ana",
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { canonicalValue: "Ana María Override" },
    });
    expect(engine.getSnapshot("doc-1").groups[0]?.canonicalValue).toBe("Ana María Override");

    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Anita",
        normalizedValue: "ana",
      }),
    });

    const after = engine.getSnapshot("doc-1").groups[0];
    expect(after?.aliases).toContain("Anita");
    expect(after?.canonicalValue).toBe("Ana María Override");
  });

  it("throws GroupingInvalidPatchError on immutable field patch", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    const invalidReq = {
      documentId: "doc-1",
      groupId: group!.id,
      patch: { indexInType: 99 },
    } as unknown as GroupUpdateRequested;

    await expect(engine.applyGroupUpdate(invalidReq)).rejects.toThrow(GroupingInvalidPatchError);
  });

  it("throws GroupingInvalidPatchError when patch is null", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    const invalidReq = {
      documentId: "doc-1",
      groupId: group!.id,
      patch: null,
    } as unknown as GroupUpdateRequested;

    await expect(engine.applyGroupUpdate(invalidReq)).rejects.toThrow(GroupingInvalidPatchError);
  });

  it("throws InvalidInputError when request is null", async () => {
    await expect(engine.applyGroupUpdate(null as unknown as GroupUpdateRequested)).rejects.toThrow(
      InvalidInputError,
    );
  });

  it("throws GroupingGroupNotFoundError on missing groupId", async () => {
    await expect(
      engine.applyGroupUpdate({
        documentId: "doc-1",
        groupId: "does-not-exist",
        patch: { enabled: false },
      }),
    ).rejects.toThrow(GroupingGroupNotFoundError);
  });

  // Caso 20 (§13)
  it("throws EngineDisposedError after dispose", async () => {
    await engine.dispose();
    await expect(
      engine.applyGroupUpdate({ documentId: "doc-1", groupId: "any", patch: { enabled: false } }),
    ).rejects.toThrow(EngineDisposedError);
  });

  it("ENTITY_FOUND for a document without an active session is ignored", () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-without-session",
      occurrence: makeOccurrence(),
    });
    expect(engine.getSnapshot("doc-without-session").groups).toHaveLength(0);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it("applyGroupUpdate can set an explicit replacementValue", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementValue: "custom-value" },
    });

    expect(updated.replacementValue).toBe("custom-value");
  });

  it("applyGroupUpdate with an empty patch is a no-op", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    const before = group!.updatedAt;

    const result = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: {},
    });

    expect(result.updatedAt).toBe(before);
  });

  it("finishSession() with no active session logs a warning and no-ops", async () => {
    await expect(engine.finishSession("doc-without-session")).resolves.toBeUndefined();
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it("applyGroupMerge throws GroupingGroupNotFoundError when sourceGroupId is missing", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    await expect(
      engine.applyGroupMerge({
        documentId: "doc-1",
        sourceGroupId: "does-not-exist",
        targetGroupId: group!.id,
      }),
    ).rejects.toThrow(GroupingGroupNotFoundError);
  });

  it("applyGroupMerge throws GroupingGroupNotFoundError when targetGroupId is missing", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    await expect(
      engine.applyGroupMerge({
        documentId: "doc-1",
        sourceGroupId: group!.id,
        targetGroupId: "does-not-exist",
      }),
    ).rejects.toThrow(GroupingGroupNotFoundError);
  });

  // ADR-083 §4: resolver SIN `entityType` aplica el default (mayor confidence,
  // empate a Regex) — la rama que el `ConflictDialog` ejercita al confirmar sin
  // elegir, y que no tenía ningún test: los tres call sites existentes pasan
  // siempre el tipo explícito.
  it("applyConflictResolve sin entityType aplica el default de mayor confidence", async () => {
    const existing = makeOccurrence({
      entityType: EntityType.CreditCard,
      source: DetectionSource.NER,
      // Por ENCIMA de `ner.confidenceThreshold`: con 0.6 la ocurrencia caía
      // en el camino de baja confianza (§13 caso 9) y nunca se registraba,
      // así que no había conflicto que resolver.
      confidence: 0.95,
      bbox: makeBBox(0, 0, 100, 20),
      value: "4111111111111111",
      normalizedValue: "4111111111111111",
    });
    const incoming = makeOccurrence({
      entityType: EntityType.IBAN,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 20),
      value: "ES1234",
      normalizedValue: "es1234",
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: existing,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: incoming,
    });

    const [conflict] = engine.getSnapshot("doc-1").conflicts;
    const resolved = await engine.applyConflictResolve({
      documentId: "doc-1",
      conflictId: conflict!.id,
    });

    // Gana el candidato de mayor confidence: el de Regex (1.0) sobre el de
    // NER (0.6). Es el mismo que la resolución automática ya había aplicado,
    // así que confirmar no cambia el tipo del grupo.
    expect(resolved.resolvedType).toBe(EntityType.IBAN);
    expect(resolved.resolved).toBe(true);
  });

  it("applyConflictResolve throws GroupingGroupNotFoundError on missing conflictId", async () => {
    await expect(
      engine.applyConflictResolve({
        documentId: "doc-1",
        conflictId: "does-not-exist",
        entityType: EntityType.Person,
      }),
    ).rejects.toThrow(GroupingGroupNotFoundError);
  });

  // Caso 57 (§13, ADR-174 §3): `winner` solo aplica a un conflicto heldManual.
  it("winner on a conflict without heldManual is rejected", async () => {
    // Overlap "normal" entre dos detecciones automáticas: no hay ocurrencia
    // Manual de por medio, así que el conflicto no sale heldManual.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.CreditCard,
        source: DetectionSource.Regex,
        confidence: 0.9,
        bbox: makeBBox(0, 0, 100, 20),
        value: "4111111111111111",
        normalizedValue: "4111111111111111",
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.IBAN,
        source: DetectionSource.Regex,
        confidence: 0.5,
        bbox: makeBBox(0, 0, 100, 20),
        value: "ES1234",
        normalizedValue: "es1234",
      }),
    });
    const [conflict] = engine.getSnapshot("doc-1").conflicts;
    expect(conflict?.heldManual).toBeUndefined();

    await expect(
      engine.applyConflictResolve({
        documentId: "doc-1",
        conflictId: conflict!.id,
        winner: "manual",
      }),
    ).rejects.toThrow(GroupingInvalidPatchError);

    // El conflicto sigue exactamente como estaba (la resolución automática
    // de siempre, no la del intento rechazado).
    const [after] = engine.getSnapshot("doc-1").conflicts;
    expect(after).toEqual(conflict);
  });

  // Caso 58 (§13, ADR-174 §1/§3): la retención sobrevive y no se duplica.
  it("re-emitting a discarded held manual occurrence does not recreate the conflict", async () => {
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
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });

    const [held] = engine.getSnapshot("doc-1").conflicts;
    expect(held?.heldManual).toBe(true);

    // Re-emitir la MISMA ocurrencia manual MIENTRAS sigue sin resolver: el
    // dedup por identidad la descarta sin crear un segundo conflicto.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    expect(engine.getSnapshot("doc-1").conflicts).toHaveLength(1);

    await engine.applyConflictResolve({
      documentId: "doc-1",
      conflictId: held!.id,
      winner: "detected",
    });

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    // Re-aplicación del literal (ADR-061 §5) tras un re-análisis: misma
    // identidad, otra vez.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });

    const conflictCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls).toHaveLength(0);
    expect(engine.getSnapshot("doc-1").conflicts).toHaveLength(1);
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.type === EntityType.IBAN)).toBe(false);
  });

  // Caso 18 (§13), combinado con caso 6: split preserva un canonicalValue
  // fijado manualmente en el grupo ORIGINAL (no en el nuevo).
  it("manual split preserves a manually-overridden canonicalValue on the original group", async () => {
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

    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { canonicalValue: "Override Manual" },
    });

    const { merged } = await engine.applyGroupSplit({
      documentId: "doc-1",
      groupId: group!.id,
      occurrenceIds: [occB.id],
    });

    expect(merged.canonicalValue).toBe("Override Manual");
  });

  // Caso 9 (§13), variante: sin grupo candidato de ese entityType no hay forma
  // de construir un Conflict válido (spec §11 no define un EngineErrorCode
  // para esto). Hasta ADR-094 eso significaba un `warn` y nada más — con el
  // logger nulo de producción, la herramienta veía un nombre propio y lo
  // tiraba sin dejar rastro. Ahora lo sugiere APAGADO.
  it("low_confidence occurrence with no candidate group is suggested, not discarded", () => {
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const lowConfidence = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 0.6,
      value: "Juan Pérez",
      normalizedValue: "juan pérez",
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: lowConfidence,
    });

    // Sigue sin haber conflicto: no hay grupo contra el cual plantearlo.
    expect(
      busEmitSpy.mock.calls.some(
        ([channel, event]) =>
          channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
      ),
    ).toBe(false);

    const groups = engine.getSnapshot("doc-1").groups;
    expect(groups).toHaveLength(1);
    // Apagado: no tapa nada hasta que el usuario decida (ADR-094 §1).
    expect(groups[0]?.enabled).toBe(false);
    expect(groups[0]?.needsReview).toBe(true);
  });

  // ADR-094 §2: las tres compuertas. Sin ellas el panel se llena de ruido y la
  // marca deja de significar algo.
  it("does not suggest below the confidence floor, outside free-text types, or without a known given name", () => {
    const casos: ReadonlyArray<{
      readonly occurrence: Parameters<typeof makeOccurrence>[0];
      readonly por: string;
    }> = [
      {
        por: "debajo del piso: el modelo no duda, adivina",
        occurrence: {
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.3,
          value: "Juan Pérez",
          normalizedValue: "juan pérez",
        },
      },
      {
        por: "no es tipo de texto libre (ADR-073 §1): lo cubre Regex con 1.0",
        occurrence: {
          entityType: EntityType.Date,
          source: DetectionSource.NER,
          confidence: 0.6,
          value: "07/07/2026",
          normalizedValue: "07/07/2026",
        },
      },
      {
        por: "el primer token no es un nombre de pila conocido (ADR-091)",
        occurrence: {
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.6,
          value: "Expediente Caratulado",
          normalizedValue: "expediente caratulado",
        },
      },
    ];

    for (const { occurrence, por } of casos) {
      const doc = `doc-gate-${por.slice(0, 8)}`;
      engine.startSession(doc);
      ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
        documentId: doc,
        occurrence: makeOccurrence(occurrence),
      });
      expect(engine.getSnapshot(doc).groups, por).toHaveLength(0);
    }
  });

  // ADR-094 §4: la marca significa "nadie decidió todavía". Tildar o
  // destildar la casilla ES decidir, en los dos sentidos.
  it("clears needsReview once the user toggles the group either way", async () => {
    for (const decision of [true, false]) {
      const doc = `doc-decide-${String(decision)}`;
      engine.startSession(doc);
      ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
        documentId: doc,
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          source: DetectionSource.NER,
          confidence: 0.6,
          value: "Juan Pérez",
          normalizedValue: "juan pérez",
        }),
      });
      const groupId = engine.getSnapshot(doc).groups[0]?.id ?? "";
      expect(engine.getSnapshot(doc).groups[0]?.needsReview, String(decision)).toBe(true);

      const group = await engine.applyGroupUpdate({
        documentId: doc,
        groupId,
        patch: { enabled: decision },
      });
      expect(group?.needsReview, String(decision)).toBe(false);
      expect(group?.enabled, String(decision)).toBe(decision);
    }
  });

  // ADR-094 §3 — la parte que, omitida, deja el producto PEOR que antes.
  // `findMatchingGroup` no filtra por `enabled`, así que un grupo sugerido
  // absorbe igual una ocurrencia posterior del mismo valor: sin promoción se
  // quedaría apagado y una detección confiable pasaría a no taparse.
  it("promotes a suggested group when a confident occurrence joins it", () => {
    const suggested = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 0.6,
      value: "Juan Pérez",
      normalizedValue: "juan pérez",
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: suggested,
    });
    expect(engine.getSnapshot("doc-1").groups[0]?.enabled).toBe(false);

    const confident = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 0.99,
      value: "Juan Pérez",
      normalizedValue: "juan pérez",
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: confident,
    });

    const groups = engine.getSnapshot("doc-1").groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]?.enabled).toBe(true);
    expect(groups[0]?.needsReview).toBe(false);
  });

  // Caso 7 (§13), variante de empate: misma confidence y misma fuente ->
  // gana la ocurrencia existente (determinístico, sin preferencia por regex
  // cuando ninguna de las dos partes es regex-vs-otra-fuente).
  it("overlap conflict tie (same confidence, same source) keeps the existing occurrence's group", () => {
    const existing = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 0.9,
      bbox: makeBBox(0, 0, 100, 20),
      value: "Juan Pérez",
      normalizedValue: "juan pérez",
    });
    const incoming = makeOccurrence({
      entityType: EntityType.Organization,
      source: DetectionSource.NER,
      confidence: 0.9,
      bbox: makeBBox(0, 0, 100, 20),
      value: "Acme Corp",
      normalizedValue: "acme corp",
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: existing,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: incoming,
    });

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.type).toBe(EntityType.Person);
  });

  // Caso 21 (§13, ADR-028): las ocurrencias llegan fuera de orden documental
  // (NER procesa por prioridad visible) — los índices provisionales reflejan
  // el orden de llegada; finishSession renumera canónicamente por posición
  // documental antes de emitir GROUPING_FINISHED.
  it("canonical renumbering at finishSession emits updates and recomputes placeholders", async () => {
    // Llega primero (índice provisional 1) pero está SEGUNDO en el documento
    // (pageIndex 1).
    const occLate = makeOccurrence({
      value: "99999999",
      normalizedValue: "99999999",
      pageIndex: 1,
      bbox: makeBBox(10, 50, 60, 12),
    });
    // Llega segundo (índice provisional 2) pero está PRIMERO en el documento
    // (pageIndex 0).
    const occEarly = makeOccurrence({
      value: "11111111",
      normalizedValue: "11111111",
      pageIndex: 0,
      bbox: makeBBox(10, 50, 60, 12),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occLate,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occEarly,
    });

    const provisional = engine.getSnapshot("doc-1").groups;
    const lateGroup = provisional.find((g) => g.canonicalValue === "99999999");
    const earlyGroup = provisional.find((g) => g.canonicalValue === "11111111");
    expect(lateGroup?.indexInType).toBe(1);
    expect(earlyGroup?.indexInType).toBe(2);

    // Edición manual sobre el grupo que va a BAJAR de índice (caso 17/21: se
    // preserva, solo cambia el número; y al no ser placeholder no se
    // recalcula replacementValue en la renumeración).
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: lateGroup!.id,
      patch: { replacementMode: ReplacementMode.Mask },
    });

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 2,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });

    const final = engine.getSnapshot("doc-1").groups;
    const finalEarly = final.find((g) => g.canonicalValue === "11111111");
    const finalLate = final.find((g) => g.canonicalValue === "99999999");
    // Canónico: el de pageIndex 0 (documentalmente primero) pasa a índice 1.
    expect(finalEarly?.indexInType).toBe(1);
    expect(finalLate?.indexInType).toBe(2);
    // La edición manual se preservó: solo cambió el número.
    expect(finalLate?.replacementMode).toBe(ReplacementMode.Mask);

    const updatedCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.ENTITY_GROUP_UPDATED,
    );
    const updatedGroupIds = updatedCalls.map((c) => (c[2] as EntityGroupUpdated).group.id);
    expect(updatedGroupIds).toEqual(expect.arrayContaining([earlyGroup!.id, lateGroup!.id]));
    for (const call of updatedCalls) {
      expect((call[2] as EntityGroupUpdated).changes).toContain("indexInType");
    }

    // Solo el grupo en modo placeholder (earlyGroup) recalcula
    // replacementValue y emite GROUP_REPLACEMENT_CHANGED al renumerar.
    const replacementChangedCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.GROUP_REPLACEMENT_CHANGED,
    );
    expect(replacementChangedCalls).toHaveLength(1);
    expect((replacementChangedCalls[0]?.[2] as GroupReplacementChanged).groupId).toBe(
      earlyGroup!.id,
    );
    expect(finalEarly?.replacementValue).toBe("[DNI 01]");
  });

  // Caso 22 (§13, ADR-029): grupo "mixto" (members con distinto maskFormat)
  // — solo alcanzable por fusión manual, ya que dos variantes de patente no
  // se agrupan automáticamente (normalizedValue distinto, fuzzy < 0.88).
  it("mixed maskFormat group resolves by frequency then document order", async () => {
    // Empate 1 vs 1 en frecuencia tras la fusión: decide la primera
    // aparición documental (pageIndex, bbox.y, bbox.x — mismo comparador de
    // ADR-028). La Mercosur aparece antes en el documento (pageIndex 0).
    const occOld = makeOccurrence({
      entityType: EntityType.Plate,
      value: "ABC 123",
      normalizedValue: "platevieja",
      maskFormat: "XXX XXX",
      pageIndex: 1,
      bbox: makeBBox(10, 50, 60, 12),
    });
    const occMercosur = makeOccurrence({
      entityType: EntityType.Plate,
      value: "AB 123 CD",
      normalizedValue: "platemercosur",
      maskFormat: "XX XXX XX",
      pageIndex: 0,
      bbox: makeBBox(10, 50, 70, 12),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occOld,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occMercosur,
    });

    const groups = engine.getSnapshot("doc-1").groups;
    expect(groups).toHaveLength(2);
    const groupOld = groups.find((g) => g.canonicalValue === "ABC 123");
    const groupMercosur = groups.find((g) => g.canonicalValue === "AB 123 CD");

    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: groupOld!.id,
      patch: { replacementMode: ReplacementMode.Mask },
    });

    const merged = await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: groupMercosur!.id,
      targetGroupId: groupOld!.id,
    });

    expect(merged.replacementMode).toBe(ReplacementMode.Mask);
    expect(merged.replacementValue).toBe("XX XXX XX");
  });

  it("merge emits GROUP_REPLACEMENT_CHANGED when replacementValue changes", async () => {
    for (const value of ["11111111", "22222222"]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ value, normalizedValue: value }),
      });
    }
    const [g1, g2] = engine.getSnapshot("doc-1").groups;

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    // Fusiona g1 (índice menor) como source dentro de g2 (target, índice
    // mayor): el target baja a índice 1, su placeholder pasa de
    // "[DNI 02]" a "[DNI 01]" — replacementValue cambia de verdad.
    const merged = await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: g1!.id,
      targetGroupId: g2!.id,
    });

    expect(merged.replacementValue).toBe("[DNI 01]");
    const replacementChangedCall = busEmitSpy.mock.calls.find(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.GROUP_REPLACEMENT_CHANGED,
    );
    expect(replacementChangedCall).toBeDefined();
    const payload = replacementChangedCall?.[2] as GroupReplacementChanged;
    expect(payload.groupId).toBe(g2!.id);
    expect(payload.value).toBe("[DNI 01]");
  });

  // Extiende "mixed maskFormat group resolves by frequency then document
  // order": tras dividir un grupo mixto, AMBOS grupos resultantes deben
  // recalcular su mask según sus members finales — antes del fix, el grupo
  // "merged" (original) no recalculaba y quedaba con el valor stale del
  // grupo mixto.
  it("split recomputes mask of both resulting groups (mixed group)", async () => {
    const occOld = makeOccurrence({
      entityType: EntityType.Plate,
      value: "ABC 123",
      normalizedValue: "platevieja",
      maskFormat: "XXX XXX",
      pageIndex: 0,
      bbox: makeBBox(10, 50, 60, 12),
    });
    const occMercosur = makeOccurrence({
      entityType: EntityType.Plate,
      value: "AB 123 CD",
      normalizedValue: "platemercosur",
      maskFormat: "XX XXX XX",
      pageIndex: 1,
      bbox: makeBBox(10, 50, 70, 12),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occOld,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occMercosur,
    });

    const groups = engine.getSnapshot("doc-1").groups;
    const groupOld = groups.find((g) => g.canonicalValue === "ABC 123");
    const groupMercosur = groups.find((g) => g.canonicalValue === "AB 123 CD");

    // Regla de tipo (en vez de applyGroupUpdate sobre un solo grupo): así el
    // grupo NUEVO que cree el split también nace en modo mask.
    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("type", ReplacementMode.Mask, { entityType: EntityType.Plate }),
    });

    // Empate 1 vs 1: gana la vieja (pageIndex 0, antes que Mercosur en 1).
    const merged = await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: groupMercosur!.id,
      targetGroupId: groupOld!.id,
    });
    expect(merged.replacementMode).toBe(ReplacementMode.Mask);
    expect(merged.replacementValue).toBe("XXX XXX");

    // Divide sacando la ocurrencia vieja: el grupo remanente se queda solo
    // con la Mercosur.
    const { merged: remaining, created } = await engine.applyGroupSplit({
      documentId: "doc-1",
      groupId: merged.id,
      occurrenceIds: [occOld.id],
    });

    expect(created.replacementMode).toBe(ReplacementMode.Mask);
    expect(created.replacementValue).toBe("XXX XXX");
    expect(remaining.replacementMode).toBe(ReplacementMode.Mask);
    expect(remaining.replacementValue).toBe("XX XXX XX");
  });

  // Caso 23 (§13, ADR-038 §3): invariante PERMANENTE de dedup por identidad,
  // no exclusivo de sesiones reabiertas.
  it("duplicate ENTITY_FOUND with same identity is dropped silently", () => {
    const occurrence = makeOccurrence({ value: "34.567.891", normalizedValue: "34567891" });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence,
    });
    expect(engine.getSnapshot("doc-1").groups[0]?.members).toHaveLength(1);

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    // Misma identidad exacta (entityType, pageIndex, bbox, normalizedValue),
    // UUID de ocurrencia nuevo (como en una re-pasada de Regex tras un
    // reopenSession, o incluso dentro de la misma pasada).
    const duplicate = makeOccurrence({
      value: "34.567.891",
      normalizedValue: "34567891",
      entityType: occurrence.entityType,
      pageIndex: occurrence.pageIndex,
      bbox: occurrence.bbox,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: duplicate,
    });

    const groupingCalls = busEmitSpy.mock.calls.filter(
      ([channel]) => channel === EventChannel.Grouping,
    );
    expect(groupingCalls).toHaveLength(0);
    expect(ctx.logger.debug).toHaveBeenCalled();

    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(1);
    expect(groups[0]?.aliases).toEqual(["34.567.891"]);
  });

  // Caso 24 (§13, ADR-038 §2/§5.2): dropOccurrences({source: NER}) elimina
  // los grupos cuyos únicos members eran NER (aunque el usuario los haya
  // editado — se pierde por el invariante members.length >= 1) y conserva
  // intactas las ediciones de los grupos con members Regex.
  it("dropOccurrences by source removes NER-only groups, keeps edited Regex groups", async () => {
    const regexOcc = makeOccurrence({
      entityType: EntityType.DNI,
      source: DetectionSource.Regex,
      value: "11111111",
      normalizedValue: "11111111",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: regexOcc,
    });
    const [regexGroup] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: regexGroup!.id,
      patch: { replacementMode: ReplacementMode.Mask },
    });

    const nerOcc = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      value: "Juan Pérez",
      normalizedValue: "juan pérez",
      bbox: makeBBox(10, 300, 90, 12),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: nerOcc,
    });
    const nerGroup = engine.getSnapshot("doc-1").groups.find((g) => g.type === EntityType.Person);
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: nerGroup!.id,
      patch: { enabled: false },
    });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(2);

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    engine.dropOccurrences("doc-1", { source: DetectionSource.NER });

    const removedCall = busEmitSpy.mock.calls.find(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.ENTITY_GROUP_REMOVED,
    );
    expect((removedCall?.[2] as EntityGroupRemoved)?.groupId).toBe(nerGroup!.id);

    const remaining = engine.getSnapshot("doc-1").groups;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(regexGroup!.id);
    // La edición del usuario sobre el grupo Regex sobrevive intacta.
    expect(remaining[0]?.replacementMode).toBe(ReplacementMode.Mask);
  });

  // Caso 25 (§13, ADR-038 §5.3): dropOccurrences por pageIndices (re-OCR de
  // una página) descarta también los conflictos cuyo grupo quedó sin
  // members, emitiendo CONFLICT_RESOLVED con el modo efectivo previo.
  it("dropOccurrences by pageIndices discards stale conflicts", () => {
    const existing = makeOccurrence({
      entityType: EntityType.CreditCard,
      source: DetectionSource.Regex,
      confidence: 0.9,
      bbox: makeBBox(0, 0, 100, 20),
      pageIndex: 0,
      value: "4111111111111111",
      normalizedValue: "4111111111111111",
    });
    const overlapping = makeOccurrence({
      entityType: EntityType.IBAN,
      source: DetectionSource.Regex,
      confidence: 0.5,
      bbox: makeBBox(0, 0, 100, 20),
      pageIndex: 0,
      value: "ES1234",
      normalizedValue: "es1234",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: existing,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: overlapping,
    });

    const [conflict] = engine.getSnapshot("doc-1").conflicts;
    // Overlap/disagree se auto-resuelven al crearse (spec §13 caso 7: gana
    // mayor confidence, acá el grupo existente CreditCard) — "resolved" no
    // es la señal de staleness que dropOccurrences usa; lo es el grupo
    // eliminado.
    expect(conflict?.resolved).toBe(true);
    const resolvedTypeBefore = conflict?.resolvedType;
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(1);

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    engine.dropOccurrences("doc-1", { pageIndices: [0] });

    const removedCall = busEmitSpy.mock.calls.find(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.ENTITY_GROUP_REMOVED,
    );
    expect(removedCall).toBeDefined();

    const resolvedCall = busEmitSpy.mock.calls.find(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_RESOLVED,
    );
    expect(resolvedCall).toBeDefined();
    expect((resolvedCall?.[2] as ConflictResolved)?.conflictId).toBe(conflict!.id);
    // Tipo del grupo CreditCard antes de eliminarlo (ADR-083 §3: un conflicto
    // resuelto registra el TIPO con el que quedó clasificado el grupo).
    expect((resolvedCall?.[2] as ConflictResolved)?.entityType).toBe(resolvedTypeBefore);

    const after = engine.getSnapshot("doc-1").conflicts.find((c) => c.id === conflict!.id);
    expect(after?.resolved).toBe(true);
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);
  });

  // Caso 25 (§13): filtro sin campos es inválido.
  it("dropOccurrences with empty filter throws InvalidInputError", () => {
    expect(() => engine.dropOccurrences("doc-1", {})).toThrow(InvalidInputError);
  });

  it("reopenSession() with no active session logs a warning and no-ops", () => {
    engine.reopenSession("doc-without-session", { expectRegex: true, expectNer: true });
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it("dropOccurrences() with no active session logs a warning and no-ops", () => {
    engine.dropOccurrences("doc-without-session", { source: DetectionSource.Regex });
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  // Caso 28 (§13, ADR-057 §4): si ni el nivel 2 entra, el grupo queda en
  // nivel 2 sin error ni warning — el shrink-to-fit del render (ADR-058 §1)
  // es quien resuelve ese caso, no Grouping.
  //
  // "Andrea" (`A`/ambiguo en el registro, ADR-069 §1) a propósito: este test
  // prueba la escalera, no la inferencia de género.
  it("group where not even level 2 fits stays at level 2 without error", () => {
    expect(() => {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          value: "Andrea Perez",
          normalizedValue: "andrea perez",
          bbox: makeBBox(0, 0, 1, 1),
        }),
      });
    }).not.toThrow();

    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.replacementValue).toBe("[PRS-01]");
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  // Caso 29 (§13, ADR-057 §2): DNI/CUIT/IBAN tienen nivel 0 y 1 idénticos;
  // la selección no falla por esa igualdad (se salta sola al no entrar) y el
  // fallback a nivel 2 sigue distinguiéndose por el separador colapsado.
  it("degenerate levels (DNI/CUIT/IBAN) produce expected tokens", () => {
    const cases: ReadonlyArray<readonly [EntityType, string]> = [
      [EntityType.DNI, "DNI"],
      [EntityType.CUIT, "CUIT"],
      [EntityType.IBAN, "IBAN"],
    ];

    let seq = 0;
    for (const [type, label] of cases) {
      seq += 1;
      const wideDoc = `degenerate-wide-${seq}`;
      engine.startSession(wideDoc);
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: wideDoc,
        occurrence: makeOccurrence({
          entityType: type,
          value: `w-${seq}`,
          normalizedValue: `w-${seq}`,
          bbox: makeBBox(0, 0, 1000, 20),
        }),
      });
      expect(engine.getSnapshot(wideDoc).groups[0]?.replacementValue).toBe(`[${label} 01]`);

      const narrowDoc = `degenerate-narrow-${seq}`;
      engine.startSession(narrowDoc);
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: narrowDoc,
        occurrence: makeOccurrence({
          entityType: type,
          value: `n-${seq}`,
          normalizedValue: `n-${seq}`,
          bbox: makeBBox(0, 0, 1, 1),
        }),
      });
      // Ninguno de los tres niveles entra (misma longitud para los tres):
      // cae al fallback de nivel 2, que igual se distingue por el guion.
      expect(engine.getSnapshot(narrowDoc).groups[0]?.replacementValue).toBe(`[${label}-01]`);
    }
  });

  // Caso 30 (§13, ADR-057 §7): un replacementValue escrito a mano no lo toca
  // la escalera, ni en el momento de la edición ni en un finishSession
  // posterior — misma precedencia que ADR-028 le da a las ediciones frente a
  // la renumeración. Único grupo de su tipo: su índice no cambia en la
  // renumeración, así que ni siquiera se intenta recalcular.
  //
  // "Andrea" (`A`/ambiguo en el registro, ADR-069 §1) a propósito: este test
  // prueba la escalera, no la inferencia de género.
  // ADR-076 §Contexto 6 / Decisión §4 fila 2: corrección del test que
  // ADR-057 §Tests pedía. La versión anterior tenía un solo grupo Person, así
  // que su indexInType nunca cambiaba al renumerar — la guarda de ADR-028
  // (`newIndex === group.indexInType`) cortaba antes de llegar a la rama que
  // recalcula, y el test pasaba sin ejercitar la condición que dispara el
  // defecto real. Acá se agrega un segundo grupo Person que documentalmente
  // aparece ANTES (bbox.y menor), así que `renumberGroupsCanonically` sí
  // mueve el índice del grupo editado — de 1 a 2 — y es ahí donde antes de
  // ADR-076 se perdía la edición manual.
  it("hand-edited replacementValue survives a finishSession that DOES change indexInType", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Perez",
        normalizedValue: "andrea perez",
        bbox: makeBBox(0, 100, 150, 20),
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.replacementValue).toBe("[PERSONA 01]");

    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementValue: "[CUSTOM TEXT]" },
    });
    expect(updated.replacementValue).toBe("[CUSTOM TEXT]");

    // Member nuevo, MUY angosto, que degradaría un placeholder
    // auto-generado hasta el fallback de nivel 2 — pero agregar una
    // ocurrencia a un grupo existente nunca recalcula replacementValue
    // (spec §13 caso 17), así que ni siquiera llega a competir con la
    // edición manual.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Perez",
        normalizedValue: "andrea perez",
        bbox: makeBBox(0, 200, 1, 1),
      }),
    });

    // Segundo grupo Person, sin editar, que aparece ANTES en el documento
    // (bbox.y = 0 < 100 del grupo editado): mueve el indexInType del grupo
    // editado de 1 a 2 al renumerar.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Bruno Diaz",
        normalizedValue: "bruno diaz",
        bbox: makeBBox(0, 0, 150, 20),
      }),
    });

    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 3,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });

    const groups = engine.getSnapshot("doc-1").groups;
    const edited = groups.find((g) => g.id === group!.id);
    const other = groups.find((g) => g.id !== group!.id);
    expect(edited?.members).toHaveLength(2);
    // El índice SÍ se movió — es la condición que el test anterior no
    // ejercitaba.
    expect(edited?.indexInType).toBe(2);
    // Y el valor editado a mano sobrevive de todos modos (ADR-076 §3): el
    // corte es si el modo cambió, no si el índice se movió.
    expect(edited?.replacementValue).toBe("[CUSTOM TEXT]");
    // El grupo no editado sí se recalcula con su índice canónico nuevo.
    // "Bruno" resuelve masculino por el léxico de género (ADR-060/ADR-069).
    expect(other?.indexInType).toBe(1);
    expect(other?.replacementValue).toBe("[HOMBRE 01]");
  });

  // ─── ADR-076: la edición manual de replacementValue gana siempre ───

  // Contexto §3, el segundo camino: `inferGendersOnFinish` pisaba el valor
  // manual sin pasar por `renumberGroupsCanonically`. "Andrea" es ambiguo en
  // el léxico (ADR-069 §1); "Andres" es "m" y fuzzy-matchea contra "Andrea"
  // (`levenshteinNormalized("andrea ruiz","andres ruiz") ≈ 0.909 ≥ 0.88`,
  // verificado). El repro real de ADR-076 usa "Julia Ruiz" como segundo
  // alias — no fuzzy-matchea "Andrea Ruiz" bajo el umbral por defecto (la
  // diferencia de nombre es de varios caracteres), así que no uniría el
  // mismo grupo; "Andres Ruiz" preserva la propiedad que el repro necesita
  // (alias con género determinable, más frecuente que el original) de forma
  // verificable contra el motor real.
  it("hand-edited replacementValue survives gender inference at finishSession", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Ruiz",
        normalizedValue: "andrea ruiz",
        bbox: makeBBox(0, 0, 150, 20),
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.personGender).toBeUndefined();

    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementValue: "[P1]" },
    });
    expect(updated.replacementValue).toBe("[P1]");

    // Dos "Andres Ruiz": la primera empata en frecuencia con "Andrea Ruiz"
    // (canonicalValue no se mueve, primer-insertado gana el empate); la
    // segunda la supera y canonicalValue pasa a "Andres Ruiz" — sin pasar
    // por ninguno de los tres disparadores inmediatos de ADR-069 §6(a).
    for (let i = 0; i < 2; i++) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          value: "Andres Ruiz",
          normalizedValue: "andres ruiz",
          bbox: makeBBox(0, 40 + i * 20, 150, 20),
        }),
      });
    }
    expect(engine.getSnapshot("doc-1").groups[0]?.canonicalValue).toBe("Andres Ruiz");

    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 3,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });

    const final = engine.getSnapshot("doc-1").groups[0];
    // La inferencia SÍ corrió (prueba de que el escenario dispara lo que
    // dice disparar) — lo que no corrió es el pisado del valor.
    expect(final?.personGender).toBe("m");
    expect(final?.replacementValue).toBe("[P1]");
  });

  // Mismo repro, en modo synthetic: ADR-071 §6 hizo que un género inferido en
  // finishSession repinte también synthetic, no solo placeholder — así que
  // el flag tiene que protegerlo ahí también.
  it("hand-edited replacementValue survives inference in synthetic mode too", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Ruiz",
        normalizedValue: "andrea ruiz",
        bbox: makeBBox(0, 0, 150, 20),
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Synthetic },
    });
    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementValue: "[P1]" },
    });
    expect(updated.replacementValue).toBe("[P1]");

    for (let i = 0; i < 2; i++) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          value: "Andres Ruiz",
          normalizedValue: "andres ruiz",
          bbox: makeBBox(0, 40 + i * 20, 150, 20),
        }),
      });
    }

    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 3,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });

    const final = engine.getSnapshot("doc-1").groups[0];
    expect(final?.personGender).toBe("m");
    expect(final?.replacementMode).toBe(ReplacementMode.Synthetic);
    expect(final?.replacementValue).toBe("[P1]");
  });

  // Fusión y división: el sobreviviente/remanente conserva su identidad
  // (mismo criterio que ADR-069 §5 con personGenderUserSet, ADR-072 §1 con
  // el id) — el grupo nuevo de una división no tiene edición que preservar.
  // dropOccurrences (fila 9) y reopenSession + finishSession (que no tocan
  // session.groups en absoluto, nota 15 de cabecera) van en el mismo test:
  // ADR-076 §8 los agrupa en una sola fila de §14.
  it("hand-edited replacementValue survives merge, split, dropOccurrences and reopenSession", async () => {
    const occA = makeOccurrence({
      entityType: EntityType.Person,
      value: "Katarzyna Nowak",
      normalizedValue: "katarzyna nowak",
      bbox: makeBBox(0, 0, 200, 20),
    });
    const occB = makeOccurrence({
      entityType: EntityType.Person,
      value: "Katarzyna Nowakk",
      normalizedValue: "katarzyna nowakk",
      bbox: makeBBox(0, 20, 200, 20),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occA,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occB,
    });
    const [target] = engine.getSnapshot("doc-1").groups;
    expect(target?.members).toHaveLength(2);

    const editedTarget = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: target!.id,
      patch: { replacementValue: "[P1]" },
    });
    expect(editedTarget.replacementValue).toBe("[P1]");

    // Fusión: otro grupo se elimina DENTRO del target editado — el valor
    // manual del sobreviviente no se toca (fila 6).
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Ingrid Muller",
        normalizedValue: "ingrid muller",
        bbox: makeBBox(0, 300, 200, 20),
      }),
    });
    const source = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Ingrid Muller")!;
    const merged = await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: source.id,
      targetGroupId: target!.id,
    });
    expect(merged.id).toBe(target!.id);
    expect(merged.replacementValue).toBe("[P1]");
    expect(merged.members).toHaveLength(3);

    // División: el remanente (mismo id) conserva el valor manual (fila 8);
    // el grupo nuevo nace calculado (fila 7) — es otra entidad.
    const { merged: remnant, created } = await engine.applyGroupSplit({
      documentId: "doc-1",
      groupId: target!.id,
      occurrenceIds: [occB.id],
    });
    expect(remnant.id).toBe(target!.id);
    expect(remnant.replacementValue).toBe("[P1]");
    expect(created.replacementValue).not.toBe("[P1]");
    // nextIndex ya entregó 1 (target) y 2 (source, fusionado y eliminado);
    // el grupo nuevo de la división recibe el siguiente, 3 — el número en sí
    // no es el punto del test, sino que sea un placeholder recién calculado.
    expect(created.replacementValue).toBe("[PERSONA 03]");

    // dropOccurrences: un grupo DISTINTO (DNI, no Person) también editado a
    // mano, para no interferir con el escenario de fusión/división de arriba.
    const occKept = makeOccurrence({
      entityType: EntityType.DNI,
      value: "11111111",
      normalizedValue: "11111111",
      pageIndex: 0,
    });
    const occDropped = makeOccurrence({
      entityType: EntityType.DNI,
      value: "11111111",
      normalizedValue: "11111111",
      pageIndex: 1,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occKept,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occDropped,
    });
    const dniGroup = engine.getSnapshot("doc-1").groups.find((g) => g.type === EntityType.DNI);
    expect(dniGroup?.members).toHaveLength(2);
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: dniGroup!.id,
      patch: { replacementValue: "[P1]" },
    });

    // Re-OCR de la página 1 (ADR-038 §5.3): el grupo sobrevive con un solo
    // member, y su mask/placeholder dependería de ese member remanente si no
    // fuera por el valor manual.
    engine.dropOccurrences("doc-1", { pageIndices: [1] });
    const afterDrop = engine.getSnapshot("doc-1").groups.find((g) => g.id === dniGroup!.id);
    expect(afterDrop?.members).toHaveLength(1);
    expect(afterDrop?.replacementValue).toBe("[P1]");

    engine.reopenSession("doc-1", { expectRegex: true, expectNer: false });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 1,
      durationMs: 1,
    });
    const afterReopen = engine.getSnapshot("doc-1").groups.find((g) => g.id === dniGroup!.id);
    expect(afterReopen?.replacementValue).toBe("[P1]");
  });

  // Fila 4: la vía de vuelta al valor automático (§5) — cambiar de modo
  // reemplaza el valor manual y apaga el flag; volver al modo original da el
  // valor CALCULADO, no el manual que había antes.
  it("an explicit replacementMode change replaces the hand-edited value and clears the flag", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementValue: "[P1]" },
    });

    const asMask = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Mask },
    });
    expect(asMask.replacementValue).toBe(MASK_FORMAT_BY_TYPE[EntityType.DNI]);
    expect(asMask.replacementValue).not.toBe("[P1]");

    const backToPlaceholder = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Placeholder },
    });
    // El valor automático, no el "[P1]" que hubo antes de tocar el modo.
    expect(backToPlaceholder.replacementValue).toBe("[DNI 01]");
  });

  // Fila 11: una regla que cambia el modo EFECTIVO del grupo pisa el valor
  // manual sin que el usuario haya tocado ese grupo — correcto por §3, y es
  // el único caso listado así en Contexto §6/Decisión §6. Una regla que no
  // cambia el modo efectivo no lo toca en absoluto.
  it("a rule that changes the effective mode replaces it; one that does not, leaves it", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementValue: "[P1]" },
    });

    // Regla que NO cambia el modo efectivo (ya está en placeholder, el
    // default): recomputeAllGroupModes ni siquiera entra al bloque de
    // recálculo (`effectiveMode === before`).
    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("global", ReplacementMode.Placeholder, { priority: 5 }),
    });
    expect(engine.getSnapshot("doc-1").groups[0]?.replacementValue).toBe("[P1]");

    // Regla que SÍ cambia el modo efectivo a mask: pisa el valor manual.
    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("global", ReplacementMode.Mask, { priority: 10 }),
    });
    const afterRule = engine.getSnapshot("doc-1").groups[0];
    expect(afterRule?.replacementMode).toBe(ReplacementMode.Mask);
    expect(afterRule?.replacementValue).toBe(MASK_FORMAT_BY_TYPE[EntityType.DNI]);
    expect(afterRule?.replacementValue).not.toBe("[P1]");
  });

  // Fila 10: resolver un conflicto fija replacementMode a lo que pidió el
  // usuario — misma familia que un cambio de modo explícito (fila 4).
  // ADR-083 §2 CAMBIA lo que este test verificaba. Con `applyConflictResolve`
  // eligiendo el modo de reemplazo, la fila 10 de ADR-076 §4 decía que la
  // resolución pisaba el valor escrito a mano. Ahora la resolución elige el
  // TIPO, así que el valor manual solo se recalcula si el tipo nuevo cambia el
  // modo EFECTIVO — o sea, por la fila 4, sin regla propia. Acá el grupo no
  // tiene reglas de scope `type`, así que el modo no cambia y la edición
  // sobrevive, que es lo que ADR-076 §3 promete en general.
  it("applyConflictResolve preserves the hand-edited value when the effective mode does not change", async () => {
    const existing = makeOccurrence({
      entityType: EntityType.CreditCard,
      source: DetectionSource.Regex,
      confidence: 0.9,
      bbox: makeBBox(0, 0, 100, 20),
      value: "4111111111111111",
      normalizedValue: "4111111111111111",
    });
    const incoming = makeOccurrence({
      entityType: EntityType.IBAN,
      source: DetectionSource.Regex,
      confidence: 0.5,
      bbox: makeBBox(0, 0, 100, 20),
      value: "ES1234",
      normalizedValue: "es1234",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: existing,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: incoming,
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementValue: "[P1]" },
    });

    const [conflict] = engine.getSnapshot("doc-1").conflicts;
    const resolved = await engine.applyConflictResolve({
      documentId: "doc-1",
      conflictId: conflict!.id,
      entityType: EntityType.IBAN,
    });
    expect(resolved.resolvedType).toBe(EntityType.IBAN);

    const after = engine.getSnapshot("doc-1").groups.find((g) => g.id === group!.id);
    // El grupo se reclasificó...
    expect(after?.type).toBe(EntityType.IBAN);
    // ...y el valor escrito a mano sobrevivió (ADR-076 §3 + ADR-082 §4): el
    // modo efectivo no cambió, porque no hay regla de scope `type` para IBAN.
    expect(after?.replacementValue).toBe("[P1]");
    expect(after?.replacementValueUserSet).toBe(true);
  });

  // §2, segunda precisión: un patch con las dos claves deja el valor del
  // usuario Y el flag encendido — probado indirectamente (el flag no se
  // expone) haciendo que un evento posterior que respetaría el flag
  // preserve el valor.
  it("a patch with both replacementMode and replacementValue keeps the user's value", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Mask, replacementValue: "[P1]" },
    });
    expect(updated.replacementMode).toBe(ReplacementMode.Mask);
    expect(updated.replacementValue).toBe("[P1]");

    // El flag quedó en true (no solo el valor por casualidad): dropOccurrences
    // recalcularía el mask si no lo respetara — mismo mecanismo que la fila 9.
    const occSameGroup = makeOccurrence({
      value: "11111111",
      normalizedValue: "11111111",
      pageIndex: 1,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occSameGroup,
    });
    engine.dropOccurrences("doc-1", { pageIndices: [1] });
    expect(engine.getSnapshot("doc-1").groups[0]?.replacementValue).toBe("[P1]");
  });

  // §2, primera precisión: "" es una elección (lo que corresponde a redact),
  // no una ausencia — cuenta como edición manual igual que cualquier otro
  // valor.
  it("an empty-string replacementValue counts as a manual edit", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementValue: "" },
    });
    expect(updated.replacementValue).toBe("");

    // Mismo mecanismo de verificación que el test anterior: si "" no hubiera
    // marcado el flag, dropOccurrences recalcularía el placeholder por
    // encima de la cadena vacía.
    const occSameGroup = makeOccurrence({
      value: "11111111",
      normalizedValue: "11111111",
      pageIndex: 1,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occSameGroup,
    });
    engine.dropOccurrences("doc-1", { pageIndices: [1] });
    expect(engine.getSnapshot("doc-1").groups[0]?.replacementValue).toBe("");
  });

  // ADR-057 §6: mask/synthetic/redact no participan de la escalera — un
  // bbox tan angosto que degradaría un placeholder hasta el fallback de
  // nivel 2 no cambia el valor de ninguno de los tres modos.
  it("mask/synthetic/redact values unchanged by the abbreviation ladder", async () => {
    const tinyBbox = makeBBox(0, 0, 1, 1);

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Perez",
        normalizedValue: "juan perez",
        bbox: tinyBbox,
      }),
    });
    const maskGroup = engine.getSnapshot("doc-1").groups[0]!;
    const maskUpdated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: maskGroup.id,
      patch: { replacementMode: ReplacementMode.Mask },
    });
    expect(maskUpdated.replacementValue).toBe(MASK_FORMAT_BY_TYPE[EntityType.Person]);

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Ana Diaz",
        normalizedValue: "ana diaz",
        bbox: tinyBbox,
      }),
    });
    const synthGroup = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Ana Diaz")!;
    const synthUpdated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: synthGroup.id,
      patch: { replacementMode: ReplacementMode.Synthetic },
    });
    const seed = engine["sessions"].get("doc-1")!.seed as string;
    expect(synthUpdated.replacementValue).toBe(
      synthesize({
        type: EntityType.Person,
        groupId: synthGroup.id,
        seed,
        indexInType: synthGroup.indexInType,
        ...(synthGroup.personGender !== undefined ? { personGender: synthGroup.personGender } : {}),
      }),
    );

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Beto Ruiz",
        normalizedValue: "beto ruiz",
        bbox: tinyBbox,
      }),
    });
    const redactGroup = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Beto Ruiz")!;
    const redactUpdated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: redactGroup.id,
      patch: { replacementMode: ReplacementMode.Redact },
    });
    expect(redactUpdated.replacementValue).toBe("");
  });

  // Caso 31 (§13, ADR-057 §7): tras reopenSession + finishSession, un member
  // nuevo más angosto puede bajar el nivel del grupo (y cambiar su token)
  // respecto de lo que el usuario ya vio — aceptado por el mismo criterio
  // que el corrimiento de indexInType (caso 26).
  //
  // "Andrea"/"Maria" (ambos `A`/ambiguo en el registro, ADR-069 §1) a
  // propósito: este test prueba la escalera y la renumeración, no la
  // inferencia de género.
  it("reopenSession + finishSession with a narrower member changes the level", () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Perez",
        normalizedValue: "andrea perez",
        pageIndex: 1,
        bbox: makeBBox(10, 50, 150, 20),
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 1,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });

    const groupA = engine.getSnapshot("doc-1").groups[0];
    expect(groupA?.indexInType).toBe(1);
    expect(groupA?.replacementValue).toBe("[PERSONA 01]");

    // Segunda pasada: un grupo nuevo ("Maria Lopez"), documentalmente
    // ANTERIOR (pageIndex 0), desplaza a "Andrea Perez" de índice 1 a 2; y
    // una ocurrencia adicional de "Andrea Perez", angosta, se suma como
    // member.
    engine.reopenSession("doc-1", { expectRegex: true, expectNer: false });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Maria Lopez",
        normalizedValue: "maria lopez",
        pageIndex: 0,
        bbox: makeBBox(10, 50, 150, 20),
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Perez",
        normalizedValue: "andrea perez",
        pageIndex: 1,
        bbox: makeBBox(10, 80, 90, 20),
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 3,
      durationMs: 1,
    });

    const groups = engine.getSnapshot("doc-1").groups;
    const finalA = groups.find((g) => g.canonicalValue === "Andrea Perez");
    const finalM = groups.find((g) => g.canonicalValue === "Maria Lopez");
    // "Maria Lopez" (page 0) pasa a ser la primera del documento; "Andrea
    // Perez" (page 1) baja a índice 2 — el mismo corrimiento que el caso 26
    // acepta para indexInType.
    expect(finalM?.indexInType).toBe(1);
    expect(finalA?.indexInType).toBe(2);
    expect(finalA?.members).toHaveLength(2);
    // El member angosto (90) sumado en la segunda pasada baja el nivel de
    // TODO el grupo: lo que el usuario vio como "[PERSONA 01]" pasa a
    // "[PERS 02]" (índice Y nivel cambiaron a la vez).
    expect(finalA?.replacementValue).toBe("[PERS 02]");
    expect(finalM?.replacementValue).toBe("[PERSONA 01]");
  });

  // ─── ADR-060/ADR-069 (Hito 10.6): variantes de género del placeholder,
  // disparo de la inferencia y elección del humano ───

  // Caso 34 (§13, ADR-060 §4, ADR-069 §4/§5): un `personGender` puesto por
  // el usuario gana sobre cualquier inferencia y sobrevive a `finishSession`,
  // a `reopenSession`, a una re-inferencia posterior (disparada por editar
  // `canonicalValue`, caso 37) y a una fusión — el grupo que sobrevive
  // conserva su propia elección, no la del grupo que se elimina.
  it("user-set personGender survives finishSession, reopenSession, re-inference and merge", async () => {
    const wideBox = makeBBox(0, 500, 200, 20);

    // "Juan Perez" infiere "m" automáticamente al crear el grupo (ADR-069
    // §6a, punto "al crearlo").
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Perez",
        normalizedValue: "juan perez",
        bbox: wideBox,
      }),
    });
    const [created] = engine.getSnapshot("doc-1").groups;
    expect(created?.personGender).toBe("m");

    // El humano lo corrige a "f": gana sobre la inferencia y marca la
    // elección como suya.
    const overridden = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: created!.id,
      patch: { personGender: "f" },
    });
    expect(overridden.personGender).toBe("f");
    expect(overridden.replacementValue).toBe("[MUJER 01]");

    // Sobrevive a una re-inferencia disparada por editar canonicalValue a
    // mano (caso 37, trigger (a)): inferGenderIfDue es no-op sobre un grupo
    // con personGenderUserSet, aunque el nombre nuevo también resolvería.
    const afterCanonicalEdit = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: created!.id,
      patch: { canonicalValue: "Juan Perez (actualizado)" },
    });
    expect(afterCanonicalEdit.personGender).toBe("f");
    expect(afterCanonicalEdit.replacementValue).toBe("[MUJER 01]");

    // Sobrevive a finishSession (caso 37, trigger (b) — la red de
    // convergencia nunca pisa una elección del humano).
    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 1,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });
    expect(engine.getSnapshot("doc-1").groups[0]?.personGender).toBe("f");

    // Sobrevive a reopenSession (ADR-038 §2: no toca session.groups).
    engine.reopenSession("doc-1", { expectRegex: true, expectNer: false });
    expect(engine.getSnapshot("doc-1").groups[0]?.personGender).toBe("f");

    // Sobrevive a una fusión: "target" (el grupo con la elección) la
    // conserva — no se copia del "source", que se elimina (ADR-069 §5).
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Gomez",
        normalizedValue: "andrea gomez",
        bbox: makeBBox(0, 520, 200, 20),
      }),
    });
    const source = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Andrea Gomez")!;
    const merged = await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: source.id,
      targetGroupId: created!.id,
    });
    expect(merged.personGender).toBe("f");
    expect(merged.replacementValue).toBe("[MUJER 01]");
  });

  // Caso 34 (§13, ADR-069 §4/§5): "neutral" ES una elección — borra
  // `personGender` (el grupo vuelve al token neutro) pero queda marcado
  // `personGenderUserSet`. Sin ese flag, esta segunda pasada de
  // `finishSession` volvería a inferir "m" del mismo `canonicalValue` y
  // pisaría la elección en silencio — el escenario que ADR-069 §5 describe
  // como el que rompería la promesa de "el override del usuario es
  // permanente" (ADR-060 §4).
  it('user-set "neutral" is not overwritten by a later inference', async () => {
    const wideBox = makeBBox(0, 600, 200, 20);
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Perez",
        normalizedValue: "juan perez",
        bbox: wideBox,
      }),
    });
    const [created] = engine.getSnapshot("doc-1").groups;
    expect(created?.personGender).toBe("m");
    expect(created?.replacementValue).toBe("[HOMBRE 01]");

    const neutral = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: created!.id,
      patch: { personGender: "neutral" },
    });
    expect(neutral.personGender).toBeUndefined();
    expect(neutral.replacementValue).toBe("[PERSONA 01]");

    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 1,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });

    const final = engine.getSnapshot("doc-1").groups[0];
    expect(final?.personGender).toBeUndefined();
    expect(final?.replacementValue).toBe("[PERSONA 01]");
  });

  // Caso 37 (§13, ADR-069 §6): los dos puntos de disparo de la inferencia, y
  // nunca sobre una elección del humano.
  //   (a) Edición manual de canonicalValue: corre EN EL ACTO.
  //   (b) finishSession: red de convergencia sobre lo que NO pasó por (a) —
  //       acá, un canonicalValue que evolucionó por frecuencia de alias
  //       (addOccurrenceToGroup NO es ninguno de los tres triggers de (a)).
  //   Un grupo con elección del humano ignora ambos, aunque su
  //   canonicalValue evolucione exactamente igual que el grupo sin elección.
  it("inference runs on canonicalValue change and at finishSession, never over a user choice", async () => {
    const box = (y: number): ReturnType<typeof makeBBox> => makeBBox(0, y, 200, 20);

    // (a) Grupo A: nace sin determinar ("andrea" es `A`) y la edición manual
    // de canonicalValue infiere "m" SIN esperar finishSession.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Gomez",
        normalizedValue: "andrea gomez",
        bbox: box(1000),
      }),
    });
    const [groupA] = engine.getSnapshot("doc-1").groups;
    expect(groupA?.personGender).toBeUndefined();

    const editedA = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: groupA!.id,
      patch: { canonicalValue: "Juan Gomez" },
    });
    expect(editedA.personGender).toBe("m");
    expect(editedA.replacementValue).toBe("[HOMBRE 01]");

    // Grupo B: su canonicalValue evoluciona por FRECUENCIA de alias (dos
    // ocurrencias de "Juan Ruiz" con el mismo normalizedValue que "Andrea
    // Ruiz", forzadas a agruparse) — un camino que NO es ninguno de los tres
    // triggers de (a), así que el género queda atrasado hasta finishSession.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Ruiz",
        normalizedValue: "andrea ruiz",
        bbox: box(1010),
      }),
    });
    const groupB = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Andrea Ruiz")!;
    expect(groupB.personGender).toBeUndefined();

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Ruiz",
        normalizedValue: "andrea ruiz",
        bbox: box(1020),
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Ruiz",
        normalizedValue: "andrea ruiz",
        bbox: box(1030),
      }),
    });
    const midB = engine.getSnapshot("doc-1").groups.find((g) => g.id === groupB.id)!;
    // canonicalValue ya cambió por frecuencia (2 "Juan Ruiz" > 1 "Andrea
    // Ruiz"), pero sumar una ocurrencia nunca dispara la inferencia.
    expect(midB.canonicalValue).toBe("Juan Ruiz");
    expect(midB.personGender).toBeUndefined();
    expect(midB.replacementValue).toBe("[PERSONA 02]");

    // Grupo C: misma evolución que B, pero con "neutral" elegido ANTES —
    // nunca se pisa, ni en el acto ni en finishSession.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Diaz",
        normalizedValue: "andrea diaz",
        bbox: box(1040),
      }),
    });
    const groupC = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "Andrea Diaz")!;
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: groupC.id,
      patch: { personGender: "neutral" },
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Diaz",
        normalizedValue: "andrea diaz",
        bbox: box(1050),
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Diaz",
        normalizedValue: "andrea diaz",
        bbox: box(1060),
      }),
    });
    const midC = engine.getSnapshot("doc-1").groups.find((g) => g.id === groupC.id)!;
    expect(midC.canonicalValue).toBe("Juan Diaz"); // evolucionó igual que B

    // (b) finishSession: red de convergencia — B converge a "m"; A conserva
    // lo que ya tenía (idempotente); C, con elección del humano, ignora que
    // su canonicalValue ahora resolvería "m".
    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 6,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });

    const groups = engine.getSnapshot("doc-1").groups;
    const finalA = groups.find((g) => g.id === groupA!.id)!;
    const finalB = groups.find((g) => g.id === groupB.id)!;
    const finalC = groups.find((g) => g.id === groupC.id)!;
    expect(finalA.personGender).toBe("m");
    expect(finalA.replacementValue).toBe("[HOMBRE 01]");
    expect(finalB.personGender).toBe("m");
    expect(finalB.replacementValue).toBe("[HOMBRE 02]");
    expect(finalC.personGender).toBeUndefined();
    expect(finalC.replacementValue).toBe("[PERSONA 03]");
  });

  // Caso 34 (§13, ADR-069 §4, checklist 15g): a diferencia del test de
  // labels.ts de abajo (que fuerza `personGender` directo en un
  // `EntityGroup` sintético), este ejercita el camino real por el que un
  // patch entra al motor — `applyGroupUpdate` ignora `patch.personGender`
  // sobre un grupo que no es `Person`, con `ctx.logger.warn` y sin tocar
  // `replacementValue`.
  it("applyGroupUpdate ignores patch.personGender on a non-Person group, with a warn", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.DNI,
        value: "34.567.891",
        normalizedValue: "34567891",
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    const replacementValueBefore = group?.replacementValue;

    const updated = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { personGender: "f" },
    });

    expect(updated.personGender).toBeUndefined();
    expect(updated.replacementValue).toBe(replacementValueBefore);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("personGender"),
      expect.objectContaining({ groupId: group!.id }),
    );
  });

  // Caso 34 (§13, ADR-060 §2): sobre un grupo de type distinto de Person,
  // personGender se ignora y no altera replacementValue. EntityGroup lo
  // permite estructuralmente (el campo es válido en cualquier grupo); el
  // invariante de "solo Person" lo garantiza el resto del pipeline
  // (03_Data_Model.md §9), no resolveLabelSet — que simplemente nunca lo
  // lee fuera de Person.
  it("personGender on a non-Person group does not alter replacementValue", () => {
    const neutral = makeEntityGroup({ type: EntityType.DNI, indexInType: 1 });
    // `personGender` es un campo válido en cualquier `EntityGroup` a nivel
    // de tipos (el invariante "solo sobre Person" es semántico, de
    // 03_Data_Model.md §9, no está codificado en el tipo). Se fuerza acá a
    // propósito sobre un DNI para probar que resolveLabelSet lo ignora
    // igual, sin depender de que el resto del pipeline respete el
    // invariante para no romper el token.
    const withGender = makeEntityGroup({ type: EntityType.DNI, indexInType: 1, personGender: "f" });

    expect(buildPlaceholderValue(neutral)).toBe("[DNI 01]");
    expect(buildPlaceholderValue(withGender)).toBe("[DNI 01]");
  });

  // Caso 35 (§13, ADR-060 §7): los grupos Person comparten una sola
  // secuencia de indexInType sin importar el género — [MUJER 03] y
  // [HOMBRE 04] son la tercera y cuarta persona del documento, no la
  // primera de cada género. La secuencia en sí la garantiza nextIndex()/
  // renumberGroupsCanonically() (sin cambios en este PR); acá se confirma
  // que la capa de labels no reinterpreta ni renumera el índice que recibe.
  it("gendered groups keep the single Person indexInType sequence", () => {
    const femaleGroup = makeEntityGroup({ personGender: "f", indexInType: 3 });
    const maleGroup = makeEntityGroup({ personGender: "m", indexInType: 4 });

    expect(buildPlaceholderValue(femaleGroup)).toBe("[MUJER 03]");
    expect(buildPlaceholderValue(maleGroup)).toBe("[HOMBRE 04]");
  });

  // ADR-060 §3: las variantes de género usan la MISMA escalera de tres
  // niveles que el resto de los tipos (ADR-057 §4) — ninguna rama nueva de
  // selección de nivel. MUJER tiene nivel 0/1 degenerados (idénticos, igual
  // que DNI/CUIT/IBAN en el caso 29): un bbox que no entra ni en "[MUJER
  // 03]" ni en "[MUJER 03]" (misma longitud) cae directo a nivel 2 ("[MUJ-
  // 03]"), sin rama especial ni error.
  it("gendered labels use the same ladder, no extra branches", () => {
    const wideFemale = makeEntityGroup({
      personGender: "f",
      indexInType: 3,
      members: [
        {
          occurrenceId: "occ-wide-f",
          value: "valor",
          pageIndex: 0,
          bbox: makeBBox(0, 0, 200, 20),
          source: DetectionSource.Regex,
        },
      ],
    });
    expect(buildPlaceholderValue(wideFemale)).toBe("[MUJER 03]");

    const narrowFemale = makeEntityGroup({
      personGender: "f",
      indexInType: 3,
      members: [
        {
          occurrenceId: "occ-narrow-f",
          value: "valor",
          pageIndex: 0,
          bbox: makeBBox(0, 0, 40, 20),
          source: DetectionSource.Regex,
        },
      ],
    });
    // Ni "[MUJER 03]" (nivel 0) ni "[MUJER 03]" (nivel 1, idéntico) entran
    // en un bbox de 40 de ancho: cae a nivel 2, "[MUJ-03]".
    expect(buildPlaceholderValue(narrowFemale)).toBe("[MUJ-03]");

    const wideMale = makeEntityGroup({
      personGender: "m",
      indexInType: 4,
      members: [
        {
          occurrenceId: "occ-wide-m",
          value: "valor",
          pageIndex: 0,
          bbox: makeBBox(0, 0, 200, 20),
          source: DetectionSource.Regex,
        },
      ],
    });
    expect(buildPlaceholderValue(wideMale)).toBe("[HOMBRE 04]");
  });

  // ─── Caso 38 (§13, ADR-072 §1): el valor sintético identifica al grupo ───

  /** Pone un grupo en `synthetic` sin pasar por reglas. */
  async function setSynthetic(groupId: string): Promise<EntityGroup> {
    return engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId,
      patch: { replacementMode: ReplacementMode.Synthetic },
    });
  }

  function finish(occurrenceCount: number): void {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount,
      durationMs: 1,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });
  }

  /**
   * Dos grupos DNI cuyo ORDEN DE LLEGADA es el inverso de su orden
   * documental: la renumeración canónica de `finishSession` (ADR-028) los da
   * vuelta. Es el escenario donde el bug de ADR-072 se manifestaba.
   */
  async function twoSyntheticGroupsInReverseOrder(): Promise<{
    late: EntityGroup;
    early: EntityGroup;
  }> {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "11111111",
        normalizedValue: "11111111",
        bbox: makeBBox(0, 900, 60, 12),
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "22222222",
        normalizedValue: "22222222",
        bbox: makeBBox(0, 100, 60, 12),
      }),
    });
    const groups = engine.getSnapshot("doc-1").groups;
    const late = groups.find((g) => g.canonicalValue === "11111111")!;
    const early = groups.find((g) => g.canonicalValue === "22222222")!;
    return { late: await setSynthetic(late.id), early: await setSynthetic(early.id) };
  }

  it("synthetic value survives canonical renumbering at finishSession", async () => {
    const { late, early } = await twoSyntheticGroupsInReverseOrder();
    expect(late.indexInType).toBe(1);
    expect(early.indexInType).toBe(2);

    finish(2);

    const after = engine.getSnapshot("doc-1").groups;
    const lateAfter = after.find((g) => g.id === late.id)!;
    const earlyAfter = after.find((g) => g.id === early.id)!;

    // Los índices SÍ se dan vuelta: sin eso el test no probaría nada.
    expect(lateAfter.indexInType).toBe(2);
    expect(earlyAfter.indexInType).toBe(1);

    // Y los valores sintéticos NO se mueven. Con la semilla vieja
    // (indexInType) el grupo habría quedado con el valor de su índice
    // anterior, y cualquier recálculo posterior lo habría cambiado solo.
    expect(lateAfter.replacementValue).toBe(late.replacementValue);
    expect(earlyAfter.replacementValue).toBe(early.replacementValue);
  });

  it("a rule change that triggers recomputeAllGroupModes does not move synthetic values", async () => {
    const { late } = await twoSyntheticGroupsInReverseOrder();
    finish(2);

    const original = engine.getSnapshot("doc-1").groups.find((g) => g.id === late.id)!;
    expect(original.indexInType).toBe(2); // ya renumerado

    // Regla global a `mask` (prioridad alta): recomputeAllGroupModes cambia
    // el modo de todos y recalcula.
    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("global", ReplacementMode.Mask, { priority: 10 }),
    });
    expect(engine.getSnapshot("doc-1").groups.find((g) => g.id === late.id)!.replacementMode).toBe(
      ReplacementMode.Mask,
    );

    // Y de vuelta a `synthetic`, ahora con el índice ya corrido. El valor
    // tiene que ser EL MISMO que antes de todo el ida y vuelta: es la
    // propiedad fuerte de ADR-072 §1 — el valor guardado no está solo
    // "sin refrescar", es el correcto para este grupo.
    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("global", ReplacementMode.Synthetic, { priority: 20 }),
    });
    const back = engine.getSnapshot("doc-1").groups.find((g) => g.id === late.id)!;
    expect(back.replacementMode).toBe(ReplacementMode.Synthetic);
    expect(back.replacementValue).toBe(original.replacementValue);
  });

  it("adding a manual entity that shifts indexInType leaves synthetic values untouched", async () => {
    const { late, early } = await twoSyntheticGroupsInReverseOrder();
    finish(2);

    const before = engine.getSnapshot("doc-1").groups;
    const lateBefore = before.find((g) => g.id === late.id)!;
    const earlyBefore = before.find((g) => g.id === early.id)!;

    // ADR-061: una entidad agregada a mano que aparece ANTES en el documento
    // corre los índices de todos los grupos posteriores.
    engine.reopenSession("doc-1", { expectRegex: true, expectNer: false });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        value: "33333333",
        normalizedValue: "33333333",
        source: DetectionSource.Manual,
        bbox: makeBBox(0, 10, 60, 12),
      }),
    });
    finish(3);

    const after = engine.getSnapshot("doc-1").groups;
    const lateAfter = after.find((g) => g.id === late.id)!;
    const earlyAfter = after.find((g) => g.id === early.id)!;

    expect(earlyAfter.indexInType).toBe(lateBefore.indexInType); // 2: se corrió
    expect(lateAfter.indexInType).toBe(3);
    expect(lateAfter.replacementValue).toBe(lateBefore.replacementValue);
    expect(earlyAfter.replacementValue).toBe(earlyBefore.replacementValue);
  });

  it("merge keeps the survivor's synthetic value; split gives the new group its own", async () => {
    const occA = makeOccurrence({
      entityType: EntityType.Person,
      value: "Katarzyna Nowak",
      normalizedValue: "katarzyna nowak",
      bbox: makeBBox(0, 100, 200, 20),
    });
    const occB = makeOccurrence({
      entityType: EntityType.Person,
      value: "K. Nowak",
      normalizedValue: "katarzyna nowak",
      bbox: makeBBox(0, 200, 200, 20),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occA,
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occB,
    });
    // Segundo grupo, para fusionar dentro del primero.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Ingrid Muller",
        normalizedValue: "ingrid muller",
        bbox: makeBBox(0, 300, 200, 20),
      }),
    });

    const groups = engine.getSnapshot("doc-1").groups;
    const target = groups.find((g) => g.canonicalValue === "Katarzyna Nowak")!;
    const source = groups.find((g) => g.canonicalValue === "Ingrid Muller")!;
    const targetSynthetic = await setSynthetic(target.id);
    await setSynthetic(source.id);

    // Fusión: el sobreviviente conserva su `id`, así que conserva su nombre
    // falso — aunque su `indexInType` pueda bajar (ADR-060 §13 caso 5).
    const merged = await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: source.id,
      targetGroupId: target.id,
    });
    expect(merged.id).toBe(target.id);
    expect(merged.replacementValue).toBe(targetSynthetic.replacementValue);

    // División: el grupo nuevo hereda el modo (§13 caso 6) y su valor sale de
    // SU propio `id`, que es lo correcto — es otra entidad.
    const { merged: survivor, created } = await engine.applyGroupSplit({
      documentId: "doc-1",
      groupId: target.id,
      occurrenceIds: [occB.id],
    });
    expect(survivor.replacementValue).toBe(targetSynthetic.replacementValue);

    const seed = engine["sessions"].get("doc-1")!.seed as string;
    expect(created.replacementMode).toBe(ReplacementMode.Synthetic);
    expect(created.replacementValue).toBe(
      synthesize({
        type: EntityType.Person,
        groupId: created.id,
        seed,
        indexInType: created.indexInType,
      }),
    );
  });

  // Caso 6 (§13): el vacío de spec cerrado el 2026-08-14. Antes, un modo
  // puesto a mano se perdía al dividir —el grupo nuevo caía a `placeholder`—
  // y las dos mitades de lo que el usuario trataba como una cosa quedaban en
  // modos distintos. Las reglas sí se heredaban, y por eso el test de ADR-029
  // usa una regla de tipo: esquivaba justo este caso.
  it("split inherits the parent's replacementMode, including a manually set one", async () => {
    const occA = makeOccurrence({ value: "11111111", normalizedValue: "11111111" });
    const occB = makeOccurrence({ value: "1111111", normalizedValue: "11111111" });
    for (const occurrence of [occA, occB]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence,
      });
    }
    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.members).toHaveLength(2);

    // Modo a mano sobre ESE grupo, sin reglas de por medio: es el camino que
    // antes se perdía.
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Synthetic },
    });

    const { merged, created } = await engine.applyGroupSplit({
      documentId: "doc-1",
      groupId: group!.id,
      occurrenceIds: [occB.id],
    });

    expect(merged.replacementMode).toBe(ReplacementMode.Synthetic);
    expect(created.replacementMode).toBe(ReplacementMode.Synthetic);
    // El valor NO se copia: se computa de cero desde el `id` del grupo nuevo.
    const seed = engine["sessions"].get("doc-1")!.seed as string;
    expect(created.replacementValue).toBe(
      synthesize({
        type: EntityType.DNI,
        groupId: created.id,
        seed,
        indexInType: created.indexInType,
      }),
    );
  });

  it("a rule still wins over the mode inherited by a split", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const occB = makeOccurrence({ value: "1111111", normalizedValue: "11111111" });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occB,
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Synthetic },
    });
    await engine.applyRuleCreated({
      documentId: "doc-1",
      rule: makeRule("type", ReplacementMode.Redact, { entityType: EntityType.DNI }),
    });

    const { created } = await engine.applyGroupSplit({
      documentId: "doc-1",
      groupId: group!.id,
      occurrenceIds: [occB.id],
    });

    // La herencia es el PISO, no un bypass: `resolveMode` corre igual y la
    // regla de tipo gana, con la precedencia de siempre.
    expect(created.replacementMode).toBe(ReplacementMode.Redact);
  });

  // ─── Caso 39 (§13, ADR-071 §5/§6): género en modo `synthetic` ───

  const FEMALE_FIRST_NAMES = ["María", "Ana", "Laura", "Sofía", "Elena", "Patricia", "Claudia"];
  const MALE_FIRST_NAMES = [
    "Carlos",
    "Juan",
    "José",
    "Pedro",
    "Diego",
    "Andrés",
    "Fernando",
    "Ricardo",
  ];

  it("changing personGender in synthetic mode recomputes replacementValue and emits", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        // Ausente del registro (verificado contra la tabla real): nace sin
        // género, así que el cambio de abajo es el primero que ocurre.
        value: "Katarzyna Nowak",
        normalizedValue: "katarzyna nowak",
        bbox: makeBBox(0, 100, 200, 20),
      }),
    });
    const [created] = engine.getSnapshot("doc-1").groups;
    expect(created?.personGender).toBeUndefined();
    const synthetic = await setSynthetic(created!.id);

    // `group.id` es un `crypto.randomUUID()`, así que el nombre sorteado
    // cambia en cada corrida y NO se puede afirmar "el valor cambió" contra
    // un sorteo cualquiera: el pool sin filtrar y el filtrado pueden caer en
    // el mismo nombre por azar (~1 de cada 15 corridas), y el test sería
    // flaky. Se elige a propósito el género OPUESTO al que salió sorteado:
    // los dos pools son disjuntos, así que el cambio está garantizado.
    const beforeFirstName = synthetic.replacementValue.split(" ")[0] ?? "";
    const targetGender = FEMALE_FIRST_NAMES.includes(beforeFirstName) ? "m" : "f";
    const expectedPool = targetGender === "f" ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES;

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const gendered = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: created!.id,
      patch: { personGender: targetGender },
    });

    // Sin abrir la guarda de `placeholder` en applyGroupUpdate (ADR-071 §6),
    // personGender se guardaría y el token no cambiaría: la feature entera
    // quedaría sin efecto observable, con todos los gates en verde.
    expect(gendered.personGender).toBe(targetGender);
    expect(gendered.replacementValue).not.toBe(synthetic.replacementValue);
    expect(expectedPool).toContain(gendered.replacementValue.split(" ")[0]);

    // Y el valor es exactamente el que da el sintetizador con ese género:
    // la semilla no cambió, solo el pool del que se sortea (ADR-071 §5).
    const seed = engine["sessions"].get("doc-1")!.seed as string;
    expect(gendered.replacementValue).toBe(
      synthesize({
        type: EntityType.Person,
        groupId: created!.id,
        seed,
        indexInType: gendered.indexInType,
        personGender: targetGender,
      }),
    );

    const emitted = busEmitSpy.mock.calls.filter(([channel]) => channel === EventChannel.Grouping);
    expect(emitted.map(([, event]) => event)).toEqual(
      expect.arrayContaining([
        EngineEvents.ENTITY_GROUP_UPDATED,
        EngineEvents.GROUP_REPLACEMENT_CHANGED,
      ]),
    );
  });

  it("gender inferred at finishSession repaints the token in synthetic mode", async () => {
    // Mismo camino que el caso 37 grupo B: el canonicalValue evoluciona por
    // FRECUENCIA de alias, que no es ninguno de los triggers de inferencia
    // inmediata, así que el género queda atrasado hasta finishSession.
    const box = (y: number): ReturnType<typeof makeBBox> => makeBBox(0, y, 200, 20);
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Ruiz",
        normalizedValue: "andrea ruiz",
        bbox: box(100),
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.personGender).toBeUndefined();
    const beforeGender = await setSynthetic(group!.id);

    for (const y of [110, 120]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          value: "Julia Ruiz",
          normalizedValue: "andrea ruiz",
          bbox: box(y),
        }),
      });
    }
    const mid = engine.getSnapshot("doc-1").groups[0]!;
    expect(mid.canonicalValue).toBe("Julia Ruiz");
    expect(mid.personGender).toBeUndefined();
    expect(mid.replacementValue).toBe(beforeGender.replacementValue);

    finish(3);

    // La red de convergencia infiere "f" ("julia" es `f` en el registro,
    // verificado contra la tabla real) y, con la guarda de
    // `inferGendersOnFinish` abierta a synthetic, repinta.
    //
    // Acá el género lo fija el léxico, así que no se puede elegir el opuesto
    // como en el test de arriba: se afirma el valor EXACTO en vez de "cambió",
    // que sería flaky por la misma razón (el `id` es un UUID por corrida y
    // los dos sorteos pueden coincidir). Que el repintado ocurre de verdad lo
    // prueba de forma determinista el test anterior.
    const final = engine.getSnapshot("doc-1").groups[0]!;
    const seed = engine["sessions"].get("doc-1")!.seed as string;
    expect(final.personGender).toBe("f");
    expect(FEMALE_FIRST_NAMES).toContain(final.replacementValue.split(" ")[0]);
    expect(final.replacementValue).toBe(
      synthesize({
        type: EntityType.Person,
        groupId: final.id,
        seed,
        indexInType: final.indexInType,
        personGender: "f",
      }),
    );
    // El valor sin género seguía siendo el del pool completo antes de cerrar.
    expect(beforeGender.replacementValue).toBe(
      synthesize({
        type: EntityType.Person,
        groupId: final.id,
        seed,
        indexInType: beforeGender.indexInType,
      }),
    );
  });

  it("Person group without personGender in synthetic mode is unchanged", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Katarzyna Nowak",
        normalizedValue: "katarzyna nowak",
        bbox: makeBBox(0, 100, 200, 20),
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.personGender).toBeUndefined();
    const synthetic = await setSynthetic(group!.id);
    const seed = engine["sessions"].get("doc-1")!.seed as string;

    // No-regresión: sin género resuelto, el valor es exactamente el que da el
    // sintetizador sin el campo (ADR-071 §5).
    expect(synthetic.replacementValue).toBe(
      synthesize({
        type: EntityType.Person,
        groupId: group!.id,
        seed,
        indexInType: group!.indexInType,
      }),
    );
  });

  // Caso 46 (§13, ADR-170 §1).
  it("changing personGender updates placeholder and synthetic previews even in mask mode", async () => {
    // "P. Gómez": iniciales nunca se consultan (ADR-069 §3), así que
    // personGender arranca sin determinar y no por accidente de la
    // inferencia automática — el cambio de abajo es el único origen posible.
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "P. Gómez",
        normalizedValue: "p. gomez",
      }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.personGender).toBeUndefined();

    const masked = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { replacementMode: ReplacementMode.Mask },
    });
    expect(masked.replacementMode).toBe(ReplacementMode.Mask);
    const beforePreviews = masked.replacementPreviews;

    const gendered = await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { personGender: "f" },
    });

    // El modo vigente (mask) y su replacementValue NO se tocan — solo las
    // vistas previas de los otros modos.
    expect(gendered.replacementMode).toBe(ReplacementMode.Mask);
    expect(gendered.replacementValue).toBe(masked.replacementValue);
    expect(gendered.replacementPreviews.placeholder).not.toBe(beforePreviews.placeholder);
    expect(gendered.replacementPreviews.placeholder).toContain("MUJER");
    // El sintetizador no siembra con personGender (ADR-071 §5: solo elige de
    // qué pool sortea) — para un (groupId, seed) dado, el resultado CON
    // género puede coincidir por azar con el resultado SIN género (los pools
    // se solapan). Lo que sí es una garantía es que la vista previa usa el
    // género vigente: coincide exactamente con `synthesize` invocado con
    // `personGender: "f"`, no con una comparación de "cambió/no cambió".
    const seed = engine["sessions"].get("doc-1")!.seed as string;
    expect(gendered.replacementPreviews.synthetic).toBe(
      synthesize({
        type: EntityType.Person,
        groupId: group!.id,
        seed,
        indexInType: group!.indexInType,
        personGender: "f",
      }),
    );
  });

  // Caso 47 (§13, ADR-170 §2). Grupo inexistente / documento sin sesión.
  it("previewEdit rejects what the real request rejects", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });

    // Grupo inexistente: el pedido real (applyGroupUpdate) lanza
    // GroupingGroupNotFoundError; previewEdit lo normaliza a InvalidInputError.
    expect(() =>
      engine.previewEdit("doc-1", { kind: "type", groupId: "no-existe", type: EntityType.DNI }),
    ).toThrow(InvalidInputError);

    // Documento sin sesión de grouping.
    expect(() =>
      engine.previewEdit("doc-sin-sesion", {
        kind: "type",
        groupId: "no-existe",
        type: EntityType.DNI,
      }),
    ).toThrow(InvalidInputError);

    // El intento fallido no dejó rastro en la sesión real.
    const { groups } = engine.getSnapshot("doc-1");
    expect(groups).toHaveLength(1);
  });

  // Casos 54-55 (§13, ADR-173 §1/§2) + ADR-170 §2 — reemplaza al test que
  // solo probaba grupo inexistente: previewEdit hereda LOS MISMOS rechazos
  // que el pedido real, normalizados a InvalidInputError, y sin dejar
  // rastro en la sesión real (corre sobre una copia descartable).
  it("previewEdit rejects the invalid merges and splits the real request rejects", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.DNI,
        value: "11111111",
        normalizedValue: "11111111",
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.DNI,
        value: "22222222",
        normalizedValue: "22222222",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 1,
        value: "Juan Pérez",
        normalizedValue: "juan pérez",
      }),
    });
    const before = engine.getSnapshot("doc-1");
    const [dniA, dniB] = before.groups.filter((g) => g.type === EntityType.DNI);
    const [person] = before.groups.filter((g) => g.type === EntityType.Person);

    // Caso 54: tipos distintos.
    expect(() =>
      engine.previewEdit("doc-1", {
        kind: "merge",
        sourceGroupId: dniA!.id,
        targetGroupIds: [person!.id],
      }),
    ).toThrow(InvalidInputError);

    // Caso 54: mismo grupo.
    expect(() =>
      engine.previewEdit("doc-1", {
        kind: "merge",
        sourceGroupId: dniA!.id,
        targetGroupIds: [dniA!.id],
      }),
    ).toThrow(InvalidInputError);

    // Caso 55: occurrenceIds vacío.
    expect(() =>
      engine.previewEdit("doc-1", { kind: "split", groupId: dniA!.id, occurrenceIds: [] }),
    ).toThrow(InvalidInputError);

    // Caso 55: id ajeno al grupo.
    expect(() =>
      engine.previewEdit("doc-1", {
        kind: "split",
        groupId: dniA!.id,
        occurrenceIds: [dniB!.members[0]!.occurrenceId],
      }),
    ).toThrow(InvalidInputError);

    // Caso 55: todos los members.
    expect(() =>
      engine.previewEdit("doc-1", {
        kind: "split",
        groupId: dniA!.id,
        occurrenceIds: dniA!.members.map((m) => m.occurrenceId),
      }),
    ).toThrow(InvalidInputError);

    // Ninguno de los cinco intentos dejó rastro en la sesión real.
    expect(engine.getSnapshot("doc-1")).toEqual(before);
  });

  // Caso 51 (§13, ADR-172 §1).
  it("after restore, the next new group gets the indexInType it would have got", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const checkpointId = engine.createCheckpoint("doc-1");

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "22222222", normalizedValue: "22222222" }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "33333333", normalizedValue: "33333333" }),
    });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(3);

    await engine.restoreCheckpoint("doc-1", checkpointId);
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(1);

    // Un grupo NUEVO tiene que recibir indexInType=2 (el que le habría
    // tocado en el punto), no 4 (que sería si nextIndex hubiera quedado
    // en 3 tras las dos creaciones descartadas por el restore).
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "44444444", normalizedValue: "44444444" }),
    });
    const newGroup = engine.getSnapshot("doc-1").groups.find((g) => g.aliases.includes("44444444"));
    expect(newGroup?.indexInType).toBe(2);
  });

  // Caso 53 (§13, ADR-172 §1).
  it("checkpoint limit evicts the oldest; unknown ids throw", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });

    const ids: string[] = [];
    for (let i = 0; i < MAX_EDIT_CHECKPOINTS + 1; i++) {
      ids.push(engine.createCheckpoint("doc-1"));
    }

    const byDocument = engine["checkpoints"].get("doc-1");
    expect(byDocument?.size).toBe(MAX_EDIT_CHECKPOINTS);
    expect(byDocument?.has(ids[0]!)).toBe(false);
    expect(byDocument?.has(ids[ids.length - 1]!)).toBe(true);

    // Restaurar el descartado.
    await expect(engine.restoreCheckpoint("doc-1", ids[0]!)).rejects.toThrow(InvalidInputError);
    // Un id inventado.
    await expect(engine.restoreCheckpoint("doc-1", "no-existe")).rejects.toThrow(InvalidInputError);
    // Un id real, pero de OTRO documento (los checkpoints se guardan por
    // documento, así que esto cae en "desconocido" sin lógica extra).
    engine.startSession("doc-2");
    await expect(engine.restoreCheckpoint("doc-2", ids[ids.length - 1]!)).rejects.toThrow(
      InvalidInputError,
    );
  });

  // Caso 59 (§13, ADR-175 §1): dropOccurrences por SOURCE deja sin members
  // al grupo detectado de un conflicto heldManual, y la retenida (source:
  // Manual, no cae en el filtro de Regex) se oculta sola.
  it("dropOccurrences by source that empties the detected group groups the held occurrence", () => {
    const detected = makeOccurrence({
      entityType: EntityType.Email,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(10, 100, 100, 12),
      pageIndex: 0,
      value: "juan@x.com",
      normalizedValue: "juan@x.com",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: detected,
    });
    const manual = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(0, 100, 130, 12),
      pageIndex: 0,
      value: "email juan@x.com.",
      normalizedValue: "email juan@x.com.",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    const held = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
    if (!held) throw new Error("expected a held conflict");

    engine.dropOccurrences("doc-1", { source: DetectionSource.Regex });

    const snapshot = engine.getSnapshot("doc-1");
    const resolved = snapshot.conflicts.find((c) => c.id === held.id);
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.heldManual).toBeUndefined();
    expect(resolved?.resolvedType).toBe(EntityType.Person);
    expect(snapshot.groups.some((g) => g.type === EntityType.Person)).toBe(true);
    expect(snapshot.groups.some((g) => g.type === EntityType.Email)).toBe(false);
  });

  // Caso 60 (§13, ADR-175 §1): dropOccurrences por PÁGINAS se lleva a la
  // retenida misma — cierra el conflicto sin heldManual y sin dejar
  // identidad registrada, así que re-emitir el literal (sin la detección,
  // que se fue con la misma página) se agrupa normal.
  it("dropOccurrences by page takes the held occurrence and closes the conflict without heldManual", () => {
    const detected = makeOccurrence({
      entityType: EntityType.CreditCard,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 20),
      pageIndex: 0,
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
      pageIndex: 0,
      value: "ES1234",
      normalizedValue: "es1234",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    const held = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
    if (!held) throw new Error("expected a held conflict");

    engine.dropOccurrences("doc-1", { pageIndices: [0] });

    const afterDrop = engine.getSnapshot("doc-1").conflicts.find((c) => c.id === held.id);
    expect(afterDrop?.resolved).toBe(true);
    expect(afterDrop?.heldManual).toBeUndefined();
    expect(afterDrop?.resolvedType).toBe(EntityType.CreditCard);
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);

    // Sin la detección (se fue con la misma página) y sin identidad
    // retenida: re-emitir el mismo literal se agrupa normal, sin crear un
    // conflicto nuevo.
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    const conflictCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls).toHaveLength(0);
    expect(engine.getSnapshot("doc-1").groups.some((g) => g.type === EntityType.IBAN)).toBe(true);
  });

  // Caso 61 (§13, ADR-175 §1, ampliado por ADR-176 §2): el invariante de
  // heldManual — ningún conflicto queda resolved: true con heldManual,
  // heldManualOccurrences tiene exactamente los ids de los conflictos
  // heldManual sin resolver, y todo conflicto SIN RESOLVER apunta a un grupo
  // que existe — se sostiene después de CADA operación de la secuencia,
  // fusión y división incluidas.
  it("no path leaves a resolved conflict with heldManual", async () => {
    function assertHeldManualInvariant(): void {
      const snapshot = engine.getSnapshot("doc-1");
      for (const conflict of snapshot.conflicts) {
        if (conflict.heldManual === true) expect(conflict.resolved).toBe(false);
        // ADR-176 §2: todo conflicto SIN RESOLVER apunta a un grupo vivo —
        // la fusión y la división lo reapuntan para que esto se sostenga.
        if (!conflict.resolved) {
          expect(snapshot.groups.some((g) => g.id === conflict.groupId)).toBe(true);
        }
      }
      const unresolvedHeldIds = new Set(
        snapshot.conflicts.filter((c) => c.heldManual === true && !c.resolved).map((c) => c.id),
      );
      const session = engine["sessions"].get("doc-1");
      expect(new Set(session?.heldManualOccurrences.keys())).toEqual(unresolvedHeldIds);
    }

    function emitPair(
      detectedType: EntityType,
      manualType: EntityType,
      pageIndex: number,
      detectedValue: string,
      manualValue: string,
    ): void {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: detectedType,
          source: DetectionSource.Regex,
          confidence: 1,
          bbox: makeBBox(0, 0, 100, 20),
          pageIndex,
          value: detectedValue,
          normalizedValue: detectedValue.toLowerCase(),
        }),
      });
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: manualType,
          source: DetectionSource.Manual,
          confidence: 1,
          bbox: makeBBox(0, 0, 100, 20),
          pageIndex,
          value: manualValue,
          normalizedValue: manualValue.toLowerCase(),
        }),
      });
    }

    assertHeldManualInvariant();

    // Par 1 (página 0): reclasificar y un dropOccurrences ajeno dejan el
    // choque pendiente (caso 61, "reclasificar... deja el choque
    // pendiente"); applyGroupRemove recién lo cierra (caso 59).
    emitPair(EntityType.CreditCard, EntityType.IBAN, 0, "4111111111111111", "ES1111");
    assertHeldManualInvariant();
    const group1 = engine.getSnapshot("doc-1").groups.find((g) => g.type === EntityType.CreditCard);
    if (!group1) throw new Error("expected the detected group of pair 1");

    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group1.id,
      patch: { type: EntityType.DNI },
    });
    assertHeldManualInvariant();

    engine.dropOccurrences("doc-1", { pageIndices: [99] });
    assertHeldManualInvariant();

    await engine.applyGroupRemove({ documentId: "doc-1", groupId: group1.id });
    assertHeldManualInvariant();

    // Par 2 (página 1): resolución explícita winner: "detected".
    emitPair(EntityType.Email, EntityType.Phone, 1, "a@b.com", "5551234");
    assertHeldManualInvariant();
    const held2 = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
    if (!held2) throw new Error("expected the held conflict of pair 2");
    await engine.applyConflictResolve({
      documentId: "doc-1",
      conflictId: held2.id,
      winner: "detected",
    });
    assertHeldManualInvariant();

    // Par 3 (página 2): creado después de un checkpoint y deshecho con
    // restoreCheckpoint.
    const checkpointId = engine.createCheckpoint("doc-1");
    emitPair(EntityType.License, EntityType.Plate, 2, "AB123CD", "ZZ999YY");
    assertHeldManualInvariant();
    await engine.restoreCheckpoint("doc-1", checkpointId);
    assertHeldManualInvariant();

    // Par 4 (página 3): dropOccurrences por páginas se lleva la retenida
    // (caso 60).
    emitPair(EntityType.Date, EntityType.Custom, 3, "01/01/2026", "custom-value");
    assertHeldManualInvariant();
    engine.dropOccurrences("doc-1", { pageIndices: [3] });
    assertHeldManualInvariant();

    // Par 5 (página 4): fusionar el grupo detectado (como source) en otro
    // grupo del mismo tipo -- el conflicto sin resolver lo sigue a `target`
    // (ADR-176 §2).
    emitPair(EntityType.Address, EntityType.Person, 4, "Calle 1", "Juan Perez");
    assertHeldManualInvariant();
    const held5 = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
    if (!held5) throw new Error("expected the held conflict of pair 5");
    const sourceGroup5 = engine.getSnapshot("doc-1").groups.find((g) => g.id === held5.groupId);
    if (!sourceGroup5) throw new Error("expected the detected group of pair 5");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Address,
        source: DetectionSource.Regex,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        pageIndex: 40,
        value: "Calle 2",
        normalizedValue: "calle 2",
      }),
    });
    const targetGroup5 = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.type === EntityType.Address && g.id !== sourceGroup5.id);
    if (!targetGroup5) throw new Error("expected a second Address group to merge into");
    await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: sourceGroup5.id,
      targetGroupId: targetGroup5.id,
    });
    assertHeldManualInvariant();
    expect(engine.getSnapshot("doc-1").conflicts.find((c) => c.id === held5.id)?.groupId).toBe(
      targetGroup5.id,
    );

    // Par 6 (página 5): el grupo detectado tiene DOS members (páginas 5 y 6);
    // la retenida se superpone solo con el de la página 6. Dividir moviendo
    // ESE member a un grupo nuevo tiene que llevarse el conflicto con él
    // (ADR-176 §2, criterio de ADR-107).
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Organization,
        source: DetectionSource.Regex,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        pageIndex: 5,
        value: "Acme SA",
        normalizedValue: "acme sa",
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Organization,
        source: DetectionSource.Regex,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        pageIndex: 6,
        value: "Acme SA",
        normalizedValue: "acme sa",
      }),
    });
    const group6 = engine.getSnapshot("doc-1").groups.find((g) => g.canonicalValue === "Acme SA");
    if (!group6) throw new Error("expected the two-member Organization group of pair 6");
    expect(group6.members).toHaveLength(2);
    const memberOnPage6 = group6.members.find((m) => m.pageIndex === 6);
    if (!memberOnPage6) throw new Error("expected a member on page 6");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.Manual,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        pageIndex: 6,
        value: "Acme SA",
        normalizedValue: "acme sa",
      }),
    });
    assertHeldManualInvariant();
    const held6 = engine
      .getSnapshot("doc-1")
      .conflicts.find((c) => c.heldManual === true && c.groupId === group6.id);
    if (!held6) throw new Error("expected the held conflict of pair 6");
    const { created: created6 } = await engine.applyGroupSplit({
      documentId: "doc-1",
      groupId: group6.id,
      occurrenceIds: [memberOnPage6.occurrenceId],
    });
    assertHeldManualInvariant();
    expect(engine.getSnapshot("doc-1").conflicts.find((c) => c.id === held6.id)?.groupId).toBe(
      created6.id,
    );

    // Par 7 (página 7, ADR-177 §1, caso 66, B4-2 de la revisión 4): una
    // eliminación seguida de un agregado manual SUPERPUESTO a lo eliminado
    // no puede dejar un conflicto sin resolver apuntando a un grupo que ya
    // no existe -- el registro no vivo del Email eliminado no choca.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Email,
        source: DetectionSource.Regex,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        pageIndex: 7,
        value: "juan@x.com",
        normalizedValue: "juan@x.com",
      }),
    });
    const group7 = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.canonicalValue === "juan@x.com");
    if (!group7) throw new Error("expected the detected group of pair 7");
    await engine.applyGroupRemove({ documentId: "doc-1", groupId: group7.id });
    assertHeldManualInvariant();

    const busEmitSpy7 = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        source: DetectionSource.Manual,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20), // mismo rectángulo que el Email eliminado
        pageIndex: 7,
        value: "email juan@x.com.",
        normalizedValue: "email juan@x.com.",
      }),
    });
    assertHeldManualInvariant();
    const conflictCalls7 = busEmitSpy7.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls7).toHaveLength(0);
    expect(
      engine.getSnapshot("doc-1").groups.some((g) => g.canonicalValue === "email juan@x.com."),
    ).toBe(true);
  });

  // Caso 61 (§13, ADR-176 §2): fusión y división reapuntan un conflicto
  // heldManual sin resolver, cada una con su propio criterio (fusión: TODO
  // conflicto pendiente del source; división: el que se superpone al member
  // que se mueve, ADR-107).
  it("merge and split keep a pending conflict pointing to an existing group", async () => {
    // Fusión: el grupo detectado (source) se fusiona en otro del mismo tipo.
    const detected = makeOccurrence({
      entityType: EntityType.Email,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 20),
      pageIndex: 0,
      value: "juan@x.com",
      normalizedValue: "juan@x.com",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: detected,
    });
    const manual = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 20),
      pageIndex: 0,
      value: "email juan@x.com.",
      normalizedValue: "email juan@x.com.",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    const held = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
    if (!held) throw new Error("expected a held conflict");
    const source = engine.getSnapshot("doc-1").groups.find((g) => g.id === held.groupId);
    if (!source) throw new Error("expected the detected (source) group");

    const other = makeOccurrence({
      entityType: EntityType.Email,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(10, 300, 100, 12),
      pageIndex: 1,
      value: "otro@x.com",
      normalizedValue: "otro@x.com",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: other,
    });
    const target = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.type === EntityType.Email && g.id !== source.id);
    if (!target) throw new Error("expected a second Email group");

    await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: source.id,
      targetGroupId: target.id,
    });
    const afterMerge = engine.getSnapshot("doc-1");
    const conflictAfterMerge = afterMerge.conflicts.find((c) => c.id === held.id);
    expect(conflictAfterMerge?.resolved).toBe(false);
    expect(conflictAfterMerge?.heldManual).toBe(true);
    expect(conflictAfterMerge?.groupId).toBe(target.id);
    expect(afterMerge.groups.some((g) => g.id === conflictAfterMerge?.groupId)).toBe(true);

    // División: un grupo con dos members en páginas distintas; la retenida
    // se superpone solo con el de la segunda. Dividir moviendo ese member
    // a un grupo nuevo se lleva el conflicto con él.
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.CreditCard,
        source: DetectionSource.Regex,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        pageIndex: 2,
        value: "4111111111111111",
        normalizedValue: "4111111111111111",
      }),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.CreditCard,
        source: DetectionSource.Regex,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        pageIndex: 3,
        value: "4111111111111111",
        normalizedValue: "4111111111111111",
      }),
    });
    const ccGroup = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.type === EntityType.CreditCard);
    if (!ccGroup) throw new Error("expected the two-member CreditCard group");
    expect(ccGroup.members).toHaveLength(2);
    const memberOnPage3 = ccGroup.members.find((m) => m.pageIndex === 3);
    if (!memberOnPage3) throw new Error("expected a member on page 3");

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.IBAN,
        source: DetectionSource.Manual,
        confidence: 1,
        bbox: makeBBox(0, 0, 100, 20),
        pageIndex: 3,
        value: "ES9999",
        normalizedValue: "es9999",
      }),
    });
    const heldSplit = engine
      .getSnapshot("doc-1")
      .conflicts.find((c) => c.heldManual === true && c.groupId === ccGroup.id);
    if (!heldSplit) throw new Error("expected the held conflict on the CreditCard group");

    const { created } = await engine.applyGroupSplit({
      documentId: "doc-1",
      groupId: ccGroup.id,
      occurrenceIds: [memberOnPage3.occurrenceId],
    });
    const afterSplit = engine.getSnapshot("doc-1");
    const conflictAfterSplit = afterSplit.conflicts.find((c) => c.id === heldSplit.id);
    expect(conflictAfterSplit?.resolved).toBe(false);
    expect(conflictAfterSplit?.groupId).toBe(created.id);
    expect(afterSplit.groups.some((g) => g.id === conflictAfterSplit?.groupId)).toBe(true);
  });

  // Caso 61 (§13, ADR-176 §2): eliminar el grupo DESTINO de una fusión que
  // se llevó un conflicto heldManual pendiente -- la retenida se oculta
  // sola (caso 59), por el mismo camino que si nunca se hubiera fusionado.
  it("removing the merge target of a held conflict groups the held occurrence", async () => {
    const detected = makeOccurrence({
      entityType: EntityType.Email,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 20),
      pageIndex: 0,
      value: "juan@x.com",
      normalizedValue: "juan@x.com",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: detected,
    });
    const manual = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.Manual,
      confidence: 1,
      bbox: makeBBox(0, 0, 100, 20),
      pageIndex: 0,
      value: "email juan@x.com.",
      normalizedValue: "email juan@x.com.",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: manual,
    });
    const held = engine.getSnapshot("doc-1").conflicts.find((c) => c.heldManual === true);
    if (!held) throw new Error("expected a held conflict");
    const source = engine.getSnapshot("doc-1").groups.find((g) => g.id === held.groupId);
    if (!source) throw new Error("expected the detected (source) group");

    const other = makeOccurrence({
      entityType: EntityType.Email,
      source: DetectionSource.Regex,
      confidence: 1,
      bbox: makeBBox(10, 300, 100, 12),
      pageIndex: 1,
      value: "otro@x.com",
      normalizedValue: "otro@x.com",
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: other,
    });
    const target = engine
      .getSnapshot("doc-1")
      .groups.find((g) => g.type === EntityType.Email && g.id !== source.id);
    if (!target) throw new Error("expected a second Email group");

    await engine.applyGroupMerge({
      documentId: "doc-1",
      sourceGroupId: source.id,
      targetGroupId: target.id,
    });

    await engine.applyGroupRemove({ documentId: "doc-1", groupId: target.id });

    const snapshot = engine.getSnapshot("doc-1");
    const resolved = snapshot.conflicts.find((c) => c.id === held.id);
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.heldManual).toBeUndefined();
    expect(resolved?.resolvedType).toBe(EntityType.Person);
    expect(snapshot.groups.some((g) => g.type === EntityType.Person)).toBe(true);
    expect(snapshot.groups.some((g) => g.type === EntityType.Email)).toBe(false);
  });
});
