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
  it("hand-edited replacementValue survives finishSession and level selection", async () => {
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({
        entityType: EntityType.Person,
        value: "Andrea Perez",
        normalizedValue: "andrea perez",
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
        value: "Andrea Perez",
        normalizedValue: "andrea perez",
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

    // División: el grupo nuevo nace con el modo default (`placeholder`, no
    // hereda el del padre — comportamiento previo a este ADR). Puesto en
    // `synthetic`, su valor sale de SU propio `id`, que es lo correcto: es
    // otra entidad.
    const { merged: survivor, created } = await engine.applyGroupSplit({
      documentId: "doc-1",
      groupId: target.id,
      occurrenceIds: [occB.id],
    });
    expect(survivor.replacementValue).toBe(targetSynthetic.replacementValue);

    const createdSynthetic = await setSynthetic(created.id);
    const seed = engine["sessions"].get("doc-1")!.seed as string;
    expect(createdSynthetic.replacementValue).toBe(
      synthesize({
        type: EntityType.Person,
        groupId: created.id,
        seed,
        indexInType: createdSynthetic.indexInType,
      }),
    );
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
});
