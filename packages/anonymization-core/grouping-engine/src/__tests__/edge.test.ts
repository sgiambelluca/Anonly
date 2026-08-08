import {
  ConflictReason,
  DetectionSource,
  EngineDisposedError,
  EngineEvents,
  EntityType,
  EventChannel,
  InvalidInputError,
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
import { MASK_FORMAT_BY_TYPE } from "../labels.js";

import {
  createEngineContext,
  makeBBox,
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

  // Caso 9 (§13)
  it("low_confidence occurrence discarded", () => {
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

    const conflictCalls = busEmitSpy.mock.calls.filter(
      ([channel, event]) =>
        channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
    );
    expect(conflictCalls).toHaveLength(1);
    expect((conflictCalls[0]?.[2] as ConflictDetected).conflict.reason).toBe(
      ConflictReason.LowConfidence,
    );

    const [group] = engine.getSnapshot("doc-1").groups;
    expect(group?.members).toHaveLength(1);
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
    expect(updated.replacementValue).toBe(synthesize(EntityType.DNI, 1, seed));

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

  it("applyConflictResolve throws GroupingGroupNotFoundError on missing conflictId", async () => {
    await expect(
      engine.applyConflictResolve({
        documentId: "doc-1",
        conflictId: "does-not-exist",
        mode: ReplacementMode.Mask,
      }),
    ).rejects.toThrow(GroupingGroupNotFoundError);
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

  // Caso 9 (§13), variante: sin grupo candidato de ese entityType, no hay
  // forma de construir un Conflict válido (spec §11 no define un
  // EngineErrorCode para esto) — se registra por warn en su lugar.
  it("low_confidence occurrence with no candidate group logs a warning without emitting a conflict", () => {
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const lowConfidence = makeOccurrence({
      entityType: EntityType.Person,
      source: DetectionSource.NER,
      confidence: 0.5,
      value: "Juan Pérez",
      normalizedValue: "juan pérez",
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: lowConfidence,
    });

    expect(
      busEmitSpy.mock.calls.some(
        ([channel, event]) =>
          channel === EventChannel.Grouping && event === EngineEvents.CONFLICT_DETECTED,
      ),
    ).toBe(false);
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(0);
    expect(ctx.logger.warn).toHaveBeenCalled();
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
    const resolvedModeBefore = conflict?.resolvedMode;
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
    // Modo efectivo del grupo CreditCard antes de eliminarlo (placeholder,
    // sin cambios entre la creación del conflicto y la eliminación).
    expect((resolvedCall?.[2] as ConflictResolved)?.mode).toBe(resolvedModeBefore);

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
  it("group where not even level 2 fits stays at level 2 without error", () => {
    expect(() => {
      ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
        documentId: "doc-1",
        occurrence: makeOccurrence({
          entityType: EntityType.Person,
          value: "Juan Perez",
          normalizedValue: "juan perez",
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
  it("hand-edited replacementValue survives finishSession and level selection", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Perez",
        normalizedValue: "juan perez",
        bbox: makeBBox(0, 0, 150, 20),
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
        value: "Juan Perez",
        normalizedValue: "juan perez",
        bbox: makeBBox(0, 200, 1, 1),
      }),
    });

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

    const final = engine.getSnapshot("doc-1").groups[0];
    expect(final?.members).toHaveLength(2);
    // Único grupo de su tipo: su indexInType no cambia al renumerar, así que
    // finishSession ni siquiera intenta recomputar el placeholder.
    expect(final?.indexInType).toBe(1);
    expect(final?.replacementValue).toBe("[CUSTOM TEXT]");
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
      synthesize(EntityType.Person, synthGroup.indexInType, seed),
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
  it("reopenSession + finishSession with a narrower member changes the level", () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Juan Perez",
        normalizedValue: "juan perez",
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
    // ANTERIOR (pageIndex 0), desplaza a "Juan Perez" de índice 1 a 2; y una
    // ocurrencia adicional de "Juan Perez", angosta, se suma como member.
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
        value: "Juan Perez",
        normalizedValue: "juan perez",
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
    const finalA = groups.find((g) => g.canonicalValue === "Juan Perez");
    const finalM = groups.find((g) => g.canonicalValue === "Maria Lopez");
    // "Maria Lopez" (page 0) pasa a ser la primera del documento; "Juan
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
});
