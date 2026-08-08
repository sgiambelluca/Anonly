import {
  DetectionSource,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EntityType,
  estimateTokenWidth,
  EventChannel,
  ReplacementMode,
  type Conflict,
  type EngineContext,
  type EntityGroupCreated,
  type EntityGroupUpdated,
  type GroupingFinished,
} from "@anonly/shared";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { GroupingEngine } from "../grouping.engine.js";

import {
  createEngineContext,
  makeBBox,
  makeOccurrence,
  makeRule,
} from "./fixtures/test-helpers.js";

describe("GroupingEngine — contract tests", () => {
  let engine: GroupingEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    engine = new GroupingEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("init() stores context and marks engine as initialized", async () => {
    await engine.init(ctx);
    expect(engine.id).toBe(EngineId.Grouping);
    expect(engine["initialized"]).toBe(true);
    expect(engine["disposed"]).toBe(false);
  });

  it("init() multiple times is safe", async () => {
    await engine.init(ctx);
    await engine.init(ctx);
    expect(engine["initialized"]).toBe(true);
  });

  it("startSession() before init() throws EngineNotInitializedError", () => {
    expect(() => engine.startSession("doc-1")).toThrow(EngineNotInitializedError);
  });

  it("startSession() after dispose() throws EngineDisposedError", async () => {
    await engine.init(ctx);
    await engine.dispose();
    expect(() => engine.startSession("doc-1")).toThrow(EngineDisposedError);
  });

  it("reopenSession() before init() throws EngineNotInitializedError", () => {
    expect(() => engine.reopenSession("doc-1", { expectRegex: true, expectNer: true })).toThrow(
      EngineNotInitializedError,
    );
  });

  it("reopenSession() after dispose() throws EngineDisposedError", async () => {
    await engine.init(ctx);
    await engine.dispose();
    expect(() => engine.reopenSession("doc-1", { expectRegex: true, expectNer: true })).toThrow(
      EngineDisposedError,
    );
  });

  it("dropOccurrences() before init() throws EngineNotInitializedError", () => {
    expect(() => engine.dropOccurrences("doc-1", { source: DetectionSource.Regex })).toThrow(
      EngineNotInitializedError,
    );
  });

  it("dropOccurrences() after dispose() throws EngineDisposedError", async () => {
    await engine.init(ctx);
    await engine.dispose();
    expect(() => engine.dropOccurrences("doc-1", { source: DetectionSource.Regex })).toThrow(
      EngineDisposedError,
    );
  });

  it("emits ENTITY_GROUP_CREATED on first occurrence of a value", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");

    const occurrence = makeOccurrence();
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence,
    });

    const createdCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.ENTITY_GROUP_CREATED,
    );
    expect(createdCalls).toHaveLength(1);
    const payload = createdCalls[0]?.[2] as EntityGroupCreated;
    expect(payload.documentId).toBe("doc-1");
    expect(payload.group.members).toHaveLength(1);
    expect(payload.group.indexInType).toBe(1);
  });

  it("emits ENTITY_GROUP_UPDATED on second occurrence of same value", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");

    const first = makeOccurrence({ value: "34.567.891", normalizedValue: "34567891" });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: first,
    });

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const second = makeOccurrence({ value: "34.567.891", normalizedValue: "34567891" });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: second,
    });

    const updatedCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.ENTITY_GROUP_UPDATED,
    );
    expect(updatedCalls).toHaveLength(1);
    const payload = updatedCalls[0]?.[2] as EntityGroupUpdated;
    expect(payload.group.members).toHaveLength(2);
    expect(payload.changes).toContain("members");

    const createdCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.ENTITY_GROUP_CREATED,
    );
    expect(createdCalls).toHaveLength(0);
  });

  it("emits GROUPING_FINISHED after REGEX_FINISHED + NER_FINISHED", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");

    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });
    expect(
      busEmitSpy.mock.calls.some(([, event]) => event === EngineEvents.GROUPING_FINISHED),
    ).toBe(false);

    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 0,
      durationMs: 1,
    });
    const finishedCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.GROUPING_FINISHED,
    );
    expect(finishedCalls).toHaveLength(1);
    const payload = finishedCalls[0]?.[2] as GroupingFinished;
    expect(payload.documentId).toBe("doc-1");
  });

  it("indexInType unique per (document, type)", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");

    for (const value of ["11111111", "22222222", "33333333"]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ value, normalizedValue: value, entityType: EntityType.DNI }),
      });
    }

    const snapshot = engine.getSnapshot("doc-1");
    const indices = snapshot.groups.map((g) => g.indexInType).sort((a, b) => a - b);
    expect(indices).toEqual([1, 2, 3]);
    expect(new Set(indices).size).toBe(3);
  });

  it("closeSession clears state", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence(),
    });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(1);

    ctx.bus.emit(EventChannel.UI, EngineEvents.DOCUMENT_CLOSED, { documentId: "doc-1" });
    await Promise.resolve();

    expect(engine.getSnapshot("doc-1")).toEqual({
      documentId: "doc-1",
      groups: [],
      conflicts: [],
      rules: [],
    });
  });

  // Grouping es el primer motor que también CONSUME requests de UI vía el
  // bus (no solo las expone como métodos públicos) — se ejercita la ruta
  // completa (`ctx.bus.emit` → handler registrado en `init()` → apply*).
  it("GROUP_UPDATE_REQUESTED via the bus applies the patch", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    ctx.bus.emit(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
      documentId: "doc-1",
      groupId: group!.id,
      patch: { enabled: false },
    });
    await Promise.resolve();

    expect(engine.getSnapshot("doc-1").groups[0]?.enabled).toBe(false);
  });

  it("GROUP_MERGE_REQUESTED via the bus merges groups", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    for (const value of ["11111111", "22222222"]) {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({ value, normalizedValue: value }),
      });
    }
    const [g1, g2] = engine.getSnapshot("doc-1").groups;

    ctx.bus.emit(EventChannel.UI, EngineEvents.GROUP_MERGE_REQUESTED, {
      documentId: "doc-1",
      sourceGroupId: g2!.id,
      targetGroupId: g1!.id,
    });
    await Promise.resolve();

    expect(engine.getSnapshot("doc-1").groups).toHaveLength(1);
  });

  it("GROUP_SPLIT_REQUESTED via the bus splits a group", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
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

    ctx.bus.emit(EventChannel.UI, EngineEvents.GROUP_SPLIT_REQUESTED, {
      documentId: "doc-1",
      groupId: group!.id,
      occurrenceIds: [occB.id],
    });
    await Promise.resolve();

    expect(engine.getSnapshot("doc-1").groups).toHaveLength(2);
  });

  it("RULE_CREATED via the bus applies the rule to matching groups", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });

    ctx.bus.emit(EventChannel.UI, EngineEvents.RULE_CREATED, {
      documentId: "doc-1",
      rule: makeRule("global", ReplacementMode.Redact),
    });
    await Promise.resolve();

    expect(engine.getSnapshot("doc-1").groups[0]?.replacementMode).toBe(ReplacementMode.Redact);
  });

  it("RULE_UPDATED changes an existing rule's mode and recomputes groups", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const rule = makeRule("global", ReplacementMode.Redact);
    await engine.applyRuleCreated({ documentId: "doc-1", rule });
    expect(engine.getSnapshot("doc-1").groups[0]?.replacementMode).toBe(ReplacementMode.Redact);

    ctx.bus.emit(EventChannel.UI, EngineEvents.RULE_UPDATED, {
      documentId: "doc-1",
      ruleId: rule.id,
      patch: { mode: ReplacementMode.Mask },
    });
    await Promise.resolve();

    expect(engine.getSnapshot("doc-1").groups[0]?.replacementMode).toBe(ReplacementMode.Mask);
    expect(engine.getSnapshot("doc-1").rules[0]?.mode).toBe(ReplacementMode.Mask);
  });

  it("RULE_UPDATED with unknown ruleId is a no-op", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    await engine.applyRuleUpdated({
      documentId: "doc-1",
      ruleId: "does-not-exist",
      patch: { mode: ReplacementMode.Mask },
    });
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it("RULE_DELETED removes a rule and recomputes groups back to default", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const rule = makeRule("global", ReplacementMode.Redact);
    await engine.applyRuleCreated({ documentId: "doc-1", rule });
    expect(engine.getSnapshot("doc-1").groups[0]?.replacementMode).toBe(ReplacementMode.Redact);

    ctx.bus.emit(EventChannel.UI, EngineEvents.RULE_DELETED, {
      documentId: "doc-1",
      ruleId: rule.id,
    });
    await Promise.resolve();

    expect(engine.getSnapshot("doc-1").rules).toHaveLength(0);
  });

  it("RULE_DELETED with unknown ruleId is a no-op", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    await engine.applyRuleDeleted({ documentId: "doc-1", ruleId: "does-not-exist" });
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it("CONFLICT_RESOLVE_REQUESTED via the bus resolves a conflict and updates the group", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    const existing = makeOccurrence({
      entityType: EntityType.CreditCard,
      source: DetectionSource.Regex,
      confidence: 0.9,
      bbox: makeBBox(0, 0, 100, 20),
      value: "4111111111111111",
      normalizedValue: "4111111111111111",
    });
    const overlapping = makeOccurrence({
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
      occurrence: overlapping,
    });
    const [conflict] = engine.getSnapshot("doc-1").conflicts;

    ctx.bus.emit(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, {
      documentId: "doc-1",
      conflictId: conflict!.id,
      mode: ReplacementMode.Mask,
    });
    await Promise.resolve();

    const resolved = engine
      .getSnapshot("doc-1")
      .conflicts.find((c) => c.id === conflict!.id) as Conflict;
    expect(resolved.resolved).toBe(true);
    expect(resolved.resolvedMode).toBe(ReplacementMode.Mask);
    expect(engine.getSnapshot("doc-1").groups[0]?.replacementMode).toBe(ReplacementMode.Mask);
  });

  // ADR-028: indexInType es provisional (orden de llegada) durante la sesión
  // y se renumera canónicamente en finishSession por posición documental —
  // el mismo conjunto de Occurrence debe terminar con los mismos índices sin
  // importar en qué orden llegaron los ENTITY_FOUND.
  it("final indexInType deterministic regardless of event arrival order", async () => {
    const occFirst = makeOccurrence({
      value: "22222222",
      normalizedValue: "22222222",
      pageIndex: 0,
      bbox: makeBBox(10, 50, 60, 12),
    });
    const occMiddle = makeOccurrence({
      value: "33333333",
      normalizedValue: "33333333",
      pageIndex: 1,
      bbox: makeBBox(10, 50, 60, 12),
    });
    const occLast = makeOccurrence({
      value: "11111111",
      normalizedValue: "11111111",
      pageIndex: 2,
      bbox: makeBBox(10, 50, 60, 12),
    });

    async function run(order: readonly [typeof occFirst, typeof occFirst, typeof occFirst]) {
      const runEngine = new GroupingEngine();
      const runCtx = createEngineContext();
      await runEngine.init(runCtx);
      runEngine.startSession("doc-1");
      for (const occurrence of order) {
        runCtx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
          documentId: "doc-1",
          occurrence,
        });
      }
      runCtx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
        documentId: "doc-1",
        occurrenceCount: order.length,
        durationMs: 1,
      });
      runCtx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
        documentId: "doc-1",
        occurrenceCount: 0,
        durationMs: 1,
      });
      const byValue = new Map(
        runEngine.getSnapshot("doc-1").groups.map((g) => [g.canonicalValue, g.indexInType]),
      );
      await runEngine.dispose();
      return byValue;
    }

    const arrivalOrderA = await run([occLast, occFirst, occMiddle]);
    const arrivalOrderB = await run([occMiddle, occLast, occFirst]);

    const expected = new Map([
      ["22222222", 1],
      ["33333333", 2],
      ["11111111", 3],
    ]);
    expect(arrivalOrderA).toEqual(expected);
    expect(arrivalOrderB).toEqual(expected);
  });

  // ADR-038 §2: reabrir una sesión NO descarta grupos/reglas/conflictos ni
  // las ediciones del usuario; una ocurrencia nueva que matchea por valor
  // hereda el grupo editado sin tocar su edición (mismo mecanismo del caso
  // 17, ahora atravesando un reopenSession).
  it("reopenSession preserves existing groups/rules/edits", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;
    await engine.applyGroupUpdate({
      documentId: "doc-1",
      groupId: group!.id,
      patch: { enabled: false },
    });
    const rule = makeRule("global", ReplacementMode.Redact);
    await engine.applyRuleCreated({ documentId: "doc-1", rule });

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

    const beforeReopen = engine.getSnapshot("doc-1");
    expect(beforeReopen.groups[0]?.enabled).toBe(false);
    expect(beforeReopen.rules).toHaveLength(1);

    engine.reopenSession("doc-1", { expectRegex: false, expectNer: true });

    // Reabrir por sí solo no dispara eventos ni cambia el estado observable.
    const afterReopen = engine.getSnapshot("doc-1");
    expect(afterReopen.groups).toEqual(beforeReopen.groups);
    expect(afterReopen.rules).toEqual(beforeReopen.rules);
    expect(afterReopen.conflicts).toEqual(beforeReopen.conflicts);

    // Segunda pasada: una ocurrencia NER nueva del mismo valor se agrega al
    // grupo existente sin reactivarlo (caso 17, ADR-038 §4: "un grupo
    // deshabilitado no se re-habilita porque lleguen members nuevos").
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        source: DetectionSource.NER,
        confidence: 0.9,
        value: "11111111",
        normalizedValue: "11111111",
      }),
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 1,
      durationMs: 1,
    });

    const final = engine.getSnapshot("doc-1").groups[0];
    expect(final?.enabled).toBe(false);
    expect(final?.replacementMode).toBe(ReplacementMode.Redact);
    expect(final?.members).toHaveLength(2);
    expect(engine.getSnapshot("doc-1").rules).toHaveLength(1);
  });

  // Caso 26 (§13, ADR-038 §2): tras un reopenSession, finishSession vuelve a
  // correr — incluida la renumeración canónica — sobre la UNIÓN de
  // ocurrencias vigentes (las de la primera pasada + las de la segunda).
  it("finishSession re-run after reopenSession renumbers over union of occurrences", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");

    const occA = makeOccurrence({
      value: "11111111",
      normalizedValue: "11111111",
      pageIndex: 0,
      bbox: makeBBox(10, 50, 60, 12),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occA,
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
    expect(engine.getSnapshot("doc-1").groups[0]?.indexInType).toBe(1);

    // Segunda pasada de Regex (ej. tras reactivar OCR con nuevo idioma):
    // trae una ocurrencia que aparece ANTES en el documento (bbox.y menor).
    engine.reopenSession("doc-1", { expectRegex: true, expectNer: false });
    const occB = makeOccurrence({
      value: "22222222",
      normalizedValue: "22222222",
      pageIndex: 0,
      bbox: makeBBox(10, 10, 60, 12),
    });
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: occB,
    });

    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "doc-1",
      occurrenceCount: 2,
      durationMs: 1,
    });

    const finishedCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.GROUPING_FINISHED,
    );
    expect(finishedCalls).toHaveLength(1);

    const groups = engine.getSnapshot("doc-1").groups;
    const gA = groups.find((g) => g.canonicalValue === "11111111");
    const gB = groups.find((g) => g.canonicalValue === "22222222");
    // occB (bbox.y=10) precede documentalmente a occA (bbox.y=50): la
    // renumeración de la SEGUNDA pasada debe reflejar la unión completa.
    expect(gB?.indexInType).toBe(1);
    expect(gA?.indexInType).toBe(2);
  });

  // ADR-057 §1-§2: la tabla canónica de la escalera de abreviaturas —
  // reproducida acá desde Grouping_Engine.md §"Escalera de abreviaturas",
  // NO desde la implementación, porque este es un test de contrato contra el
  // documento, no un espejo del código. Verifica, para los 13 EntityType,
  // que los tres niveles respetan el formato `[<LABEL> <NN>]` (0/1) /
  // `[<CORTO>-<NN>]` (2) y que `<NN>` conserva el padding a 2 dígitos.
  it("all three abbreviation levels respect their format for the 13 entity types", async () => {
    await engine.init(ctx);

    const LADDER_TABLE: ReadonlyArray<readonly [EntityType, string, string, string]> = [
      [EntityType.Person, "PERSONA", "PERS", "PRS"],
      [EntityType.Organization, "ORGANIZACION", "ORGA", "ORG"],
      [EntityType.Address, "DIRECCION", "DIRE", "DIR"],
      [EntityType.DNI, "DNI", "DNI", "DNI"],
      [EntityType.CUIT, "CUIT", "CUIT", "CUIT"],
      [EntityType.Phone, "TELEFONO", "TELE", "TEL"],
      [EntityType.Email, "EMAIL", "MAIL", "EML"],
      [EntityType.IBAN, "IBAN", "IBAN", "IBAN"],
      [EntityType.CreditCard, "TARJETA", "TARJ", "TRJ"],
      [EntityType.Date, "FECHA", "FECH", "FEC"],
      [EntityType.License, "MATRICULA", "MATR", "MAT"],
      [EntityType.Plate, "PATENTE", "PATE", "PAT"],
      [EntityType.Custom, "CUSTOM", "CUST", "CST"],
    ];

    const HEIGHT = 20;
    const WIDE_WIDTH = 100_000; // entra el token más largo de cualquier tipo.
    const TINY_WIDTH = 0.01; // no entra ni el token más corto.

    let docSeq = 0;
    function replacementValueFor(type: EntityType, width: number): string | undefined {
      docSeq += 1;
      const documentId = `ladder-doc-${docSeq}`;
      engine.startSession(documentId);
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId,
        occurrence: makeOccurrence({
          entityType: type,
          value: `v-${docSeq}`,
          normalizedValue: `v-${docSeq}`,
          bbox: makeBBox(0, 0, width, HEIGHT),
        }),
      });
      return engine.getSnapshot(documentId).groups[0]?.replacementValue;
    }

    for (const [type, label0, label1, label2] of LADDER_TABLE) {
      // Nivel 0: bbox holgado, entra el token más largo -> `<NN>` = "01".
      expect(replacementValueFor(type, WIDE_WIDTH)).toBe(`[${label0} 01]`);

      // Nivel 2: bbox tan angosto que ni el nivel 2 entra -> fallback nivel 2
      // (separador colapsado a guion, ADR-057 §1/§4).
      expect(replacementValueFor(type, TINY_WIDTH)).toBe(`[${label2}-01]`);

      // Nivel 1: bbox intermedio, solo tiene sentido para tipos NO
      // degenerados (DNI/CUIT/IBAN ya quedan cubiertos arriba: nivel 0 ==
      // nivel 1, ADR-057 §2).
      if (label0 !== label1) {
        const midWidth = estimateTokenWidth(label1.length + 5, HEIGHT) + 1;
        expect(replacementValueFor(type, midWidth)).toBe(`[${label1} 01]`);
      }
    }
  });

  // ADR-012, re-asertado por ADR-057 §4: `EntityGroup.replacementValue` es un
  // único campo por grupo (no hay forma estructural de que dos members
  // "vean" valores distintos), y ese único valor refleja el PEOR CASO de
  // TODOS los members — no el del primero, ni el de la mayoría.
  it("all members of a group share the same replacementValue", async () => {
    await engine.init(ctx);
    engine.startSession("doc-1");

    // Dos apariciones DISTINTAS (bbox.y difiere) del mismo valor: bbox
    // idéntico colisionaría con el dedup por identidad de ADR-038 §3.
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
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Ana Diaz",
        normalizedValue: "ana diaz",
        bbox: makeBBox(0, 0, 90, 20),
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

    // Un único `replacementValue` para los 3 members combinados, y refleja
    // el peor caso (90 de ancho) — no el de los dos members holgados.
    expect(merged.members).toHaveLength(3);
    expect(merged.replacementValue).toBe("[PERS 01]");
  });
});
