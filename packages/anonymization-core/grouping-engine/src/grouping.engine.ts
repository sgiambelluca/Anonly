/**
 * @anonly/grouping-engine — GroupingEngine.
 *
 * Fuente de verdad: docs/core/Grouping_Engine.md (spec completo).
 *
 * Primer motor del Core que CONSUME eventos del bus (además de emitir):
 * escucha `ENTITY_FOUND` en los canales `regex`/`ner`, `REGEX_FINISHED`/
 * `NER_FINISHED`, y los requests de UI en el canal `ui`
 * (`GROUP_UPDATE_REQUESTED`, `GROUP_MERGE_REQUESTED`, `GROUP_SPLIT_REQUESTED`,
 * `RULE_CREATED`, `RULE_UPDATED`, `RULE_DELETED`,
 * `CONFLICT_RESOLVE_REQUESTED`, `DOCUMENT_CLOSED`). Corre en el main thread
 * (spec §12): sin Worker, sin transferencia zero-copy.
 *
 * Notas de implementación / decisiones tomadas ante ambigüedades del spec
 * (ver también el reporte final del PR):
 *
 * 1. `startSession`/`closeSession` no están atadas a ningún evento del bus
 *    (04_Event_System.md §"Eventos que consume" de Grouping no lista ninguno
 *    que dispare `startSession`): se invocan directamente por el caller
 *    (Orchestrator en Hito 9, o el propio test), mismo patrón que
 *    `PdfEngine.process`/`RegexEngine.process` (ADR-014: "el Orchestrator lo
 *    invoca directamente").
 * 2. Agregar una `Occurrence` a un grupo EXISTENTE nunca toca
 *    `replacementMode`/`replacementValue` (spec §13 caso 17: "gana el
 *    replacementMode del usuario" cuando llega un nuevo `ENTITY_FOUND`). La
 *    resolución de modo por reglas (`resolveMode`) solo se ejecuta al CREAR
 *    un grupo, al cambiar reglas (`RULE_CREATED/UPDATED/DELETED`), al editar
 *    explícitamente (`GROUP_UPDATE_REQUESTED`) o al resolver un conflicto.
 * 3. `resolveMode` sigue литeralmente el pseudocódigo de
 *    "Algoritmos clave" > "Resolución de modo": el paso 4 ("editado
 *    manualmente") se detecta comparando `group.replacementMode` contra el
 *    default `Placeholder` — no hay un flag separado "fue editado a mano".
 *    Esto es intencional y textual, no una simplificación.
 * 4. `canonicalValue` solo se recalcula automáticamente si el valor actual
 *    sigue estando entre `aliases` (si no, fue fijado manualmente por el
 *    usuario vía `patch.canonicalValue` — spec §13 caso 18 — y se preserva).
 * 5. Fusión (`applyGroupMerge`): sigue literalmente "Algoritmos clave" >
 *    `indexInType`: "tras fusionar A en B: B conserva min(A.index, B.index);
 *    A se elimina" — A=`sourceGroupId`, B=`targetGroupId`. El grupo
 *    sobreviviente conserva su propia identidad (`id`, `replacementMode`,
 *    `enabled`), solo su `indexInType` puede bajar al del origen.
 * 6. Conflictos `overlap`/`disagree`: se detectan por intersección de bbox
 *    (> 50% del área del menor de los dos rects, misma página, distinto
 *    `entityType`) contra ocurrencias YA agrupadas. Si la ocurrencia NUEVA
 *    pierde la resolución default, se descarta (no se agrupa) y el grupo
 *    existente no se toca. Si la ocurrencia nueva GANA, prosigue el flujo de
 *    agrupación normal para ella pero el grupo del lado perdedor (ya emitido
 *    previamente) no se corrige retroactivamente — el spec no describe un
 *    mecanismo de "desagrupar" un miembro ya emitido, y ningún test de §14 lo
 *    ejercita.
 * 7. Conflicto `low_confidence`: la ocurrencia NER descartada solo genera
 *    `CONFLICT_DETECTED` cuando existe un grupo candidato (mismo
 *    `entityType`, match exacto/fuzzy) al que asociar `Conflict.groupId`
 *    (campo obligatorio, `03_Data_Model.md` §15) y del que derivar un segundo
 *    `ConflictCandidate` (invariante `candidates.length >= 2`). Si no hay
 *    grupo candidato, no existe forma de construir un `Conflict` válido sin
 *    violar esos invariantes; se registra por `ctx.logger.warn` en su lugar
 *    (ver reporte final del PR).
 * 8. `applyConflictResolve` con `conflictId` desconocido, y
 *    `applyGroupUpdate`/`applyGroupMerge`/`applyGroupSplit` con `groupId`
 *    desconocido, lanzan `GroupingGroupNotFoundError` (único error de
 *    "recurso no encontrado" del enum — spec §11 no define uno específico
 *    para `conflictId`). `applyRuleUpdated`/`applyRuleDeleted` con `ruleId`
 *    desconocido son no-op con warning (mismo patrón que
 *    `RegexEngine.removePattern` con id desconocido).
 */

import {
  CancelledError,
  ConflictReason,
  DetectionSource,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  ReplacementMode,
  synthesize,
  type BoundingBox,
  type Conflict,
  type ConflictCandidate,
  type ConflictResolveRequested,
  type DocumentClosed,
  type EngineContext,
  type EntityFound,
  type EntityGroup,
  type EntityType,
  type GroupMergeRequested,
  type GroupSplitRequested,
  type GroupUpdateRequested,
  type IEngine,
  type NerFinished,
  type Occurrence,
  type OccurrenceRef,
  type RegexFinished,
  type Rule,
  type RuleCreated,
  type RuleDeleted,
  type RuleUpdated,
  type Unsubscribe,
} from "@anonly/shared";

import { GroupingGroupNotFoundError, GroupingInvalidPatchError } from "./grouping.errors.js";
import type { GroupingEngineSnapshot } from "./grouping.types.js";
import { buildPlaceholderValue, MASK_FORMAT_BY_TYPE } from "./labels.js";
import { levenshteinNormalized } from "./levenshtein.js";

const DEFAULT_SIMILARITY_THRESHOLD = 0.88;

const PATCH_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "replacementMode",
  "replacementValue",
  "enabled",
  "canonicalValue",
]);

/** Info de "quién detectó primero" un alias — para poblar `ConflictCandidate`. */
interface AliasSourceInfo {
  readonly source: DetectionSource;
  readonly entityType: EntityType;
  readonly confidence: number;
}

/**
 * Estado mutable interno de un grupo. Solo `toPublicGroup()` produce la
 * copia inmutable expuesta (`EntityGroup`, Code_Standards.md §6 aplica a
 * datos PÚBLICOS; este tipo es privado del motor).
 */
interface InternalGroup {
  id: string;
  type: EntityType;
  canonicalValue: string;
  members: OccurrenceRef[];
  replacementMode: ReplacementMode;
  replacementValue: string;
  indexInType: number;
  enabled: boolean;
  aliases: string[];
  createdAt: number;
  updatedAt: number;
  // Bookkeeping interno (nunca expuesto):
  readonly normalizedValues: Set<string>;
  readonly aliasFrequency: Map<string, number>;
  readonly aliasFirstSeen: Map<string, AliasSourceInfo>;
}

/** Copia liviana de los campos de `Occurrence` necesarios para matching/conflictos, indexada por sesión. */
interface SessionOccurrenceRecord {
  readonly occurrenceId: string;
  readonly entityType: EntityType;
  readonly source: DetectionSource;
  readonly confidence: number;
  readonly value: string;
  readonly normalizedValue: string;
  readonly bbox: BoundingBox;
  readonly pageIndex: number;
  groupId: string;
}

interface Session {
  readonly documentId: string;
  readonly groups: Map<string, InternalGroup>;
  readonly nextIndexByType: Map<EntityType, number>;
  rules: Rule[];
  readonly conflicts: Map<string, Conflict>;
  readonly recordedOccurrences: SessionOccurrenceRecord[];
  readonly seed: string;
  readonly startedAt: number;
  regexFinished: boolean;
  nerFinished: boolean;
  finished: boolean;
}

function toPublicGroup(group: InternalGroup): EntityGroup {
  return {
    id: group.id,
    type: group.type,
    canonicalValue: group.canonicalValue,
    members: [...group.members],
    replacementMode: group.replacementMode,
    replacementValue: group.replacementValue,
    indexInType: group.indexInType,
    enabled: group.enabled,
    aliases: [...group.aliases],
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

function toOccurrenceRef(occurrence: Occurrence): OccurrenceRef {
  return {
    occurrenceId: occurrence.id,
    pageIndex: occurrence.pageIndex,
    bbox: occurrence.bbox,
    source: occurrence.source,
  };
}

function occurrenceAsCandidate(occurrence: Occurrence): ConflictCandidate {
  return {
    source: occurrence.source,
    entityType: occurrence.entityType,
    confidence: occurrence.confidence,
    value: occurrence.value,
  };
}

function groupPrimaryCandidate(group: InternalGroup): ConflictCandidate {
  const info = group.aliasFirstSeen.get(group.canonicalValue);
  return {
    source: info?.source ?? DetectionSource.Manual,
    entityType: group.type,
    confidence: info?.confidence ?? 1,
    value: group.canonicalValue,
  };
}

/**
 * Ratio de intersección de bbox relativo al área del rectángulo MÁS CHICO de
 * los dos (spec: "intersección > 50%" no especifica el denominador; se elige
 * el área menor para que una entidad pequeña contenida en una más grande
 * cuente como overlap — ver reporte del PR).
 */
function bboxIntersectionRatio(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const interArea = interW * interH;
  if (interArea === 0) return 0;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const minArea = Math.min(areaA, areaB);
  if (minArea <= 0) return 0;
  return interArea / minArea;
}

/** "Algoritmos clave" > "Resolución de modo" (literal, ver nota 3 del header). */
function resolveMode(
  group: Pick<InternalGroup, "id" | "type" | "replacementMode">,
  rules: ReadonlyArray<Rule>,
): ReplacementMode {
  const groupRules = rules.filter(
    (r) => r.enabled && r.scope === "group" && r.target.groupId === group.id,
  );
  if (groupRules.length > 0) return topPriority(groupRules).mode;

  const typeRules = rules.filter(
    (r) => r.enabled && r.scope === "type" && r.target.entityType === group.type,
  );
  if (typeRules.length > 0) return topPriority(typeRules).mode;

  const globalRules = rules.filter((r) => r.enabled && r.scope === "global");
  if (globalRules.length > 0) return topPriority(globalRules).mode;

  if (group.replacementMode !== ReplacementMode.Placeholder) return group.replacementMode;
  return ReplacementMode.Placeholder;
}

function topPriority(rules: ReadonlyArray<Rule>): Rule {
  return rules.reduce((best, r) => (r.priority > best.priority ? r : best));
}

function computeReplacementValue(
  type: EntityType,
  mode: ReplacementMode,
  indexInType: number,
  seed: string,
): string {
  switch (mode) {
    case ReplacementMode.Mask:
      return MASK_FORMAT_BY_TYPE[type];
    case ReplacementMode.Synthetic:
      return synthesize(type, indexInType, seed);
    case ReplacementMode.Placeholder:
      return buildPlaceholderValue(type, indexInType);
    case ReplacementMode.Redact:
      return "";
    default:
      return buildPlaceholderValue(type, indexInType);
  }
}

export class GroupingEngine implements IEngine {
  readonly id = EngineId.Grouping;

  private ctx: EngineContext | null = null;
  private initialized = false;
  private disposed = false;
  private unsubscribes: Unsubscribe[] = [];
  private sessions = new Map<string, Session>();

  private readonly handleEntityFound = (payload: EntityFound): void => {
    const session = this.sessions.get(payload.documentId);
    if (!session) {
      this.ctx?.logger.warn("ENTITY_FOUND sin sesión de grouping activa; se descarta.", {
        documentId: payload.documentId,
        occurrenceId: payload.occurrence.id,
      });
      return;
    }
    if (this.ctx?.abortSignal.aborted) return;
    this.processOccurrence(session, payload.occurrence);
  };

  private readonly handleRegexFinished = (payload: RegexFinished): void => {
    const session = this.sessions.get(payload.documentId);
    if (!session) return;
    session.regexFinished = true;
    this.maybeFinishSession(session);
  };

  private readonly handleNerFinished = (payload: NerFinished): void => {
    const session = this.sessions.get(payload.documentId);
    if (!session) return;
    session.nerFinished = true;
    this.maybeFinishSession(session);
  };

  private readonly handleGroupUpdateRequested = (payload: GroupUpdateRequested): void => {
    this.applyGroupUpdate(payload).catch((err: unknown) => {
      this.logUiError("GROUP_UPDATE_REQUESTED", err);
    });
  };

  private readonly handleGroupMergeRequested = (payload: GroupMergeRequested): void => {
    this.applyGroupMerge(payload).catch((err: unknown) => {
      this.logUiError("GROUP_MERGE_REQUESTED", err);
    });
  };

  private readonly handleGroupSplitRequested = (payload: GroupSplitRequested): void => {
    this.applyGroupSplit(payload).catch((err: unknown) => {
      this.logUiError("GROUP_SPLIT_REQUESTED", err);
    });
  };

  private readonly handleRuleCreated = (payload: RuleCreated): void => {
    this.applyRuleCreated(payload).catch((err: unknown) => {
      this.logUiError("RULE_CREATED", err);
    });
  };

  private readonly handleRuleUpdated = (payload: RuleUpdated): void => {
    this.applyRuleUpdated(payload).catch((err: unknown) => {
      this.logUiError("RULE_UPDATED", err);
    });
  };

  private readonly handleRuleDeleted = (payload: RuleDeleted): void => {
    this.applyRuleDeleted(payload).catch((err: unknown) => {
      this.logUiError("RULE_DELETED", err);
    });
  };

  private readonly handleConflictResolveRequested = (payload: ConflictResolveRequested): void => {
    this.applyConflictResolve(payload).catch((err: unknown) => {
      this.logUiError("CONFLICT_RESOLVE_REQUESTED", err);
    });
  };

  private readonly handleDocumentClosed = (payload: DocumentClosed): void => {
    this.closeSession(payload.documentId).catch((err: unknown) => {
      this.logUiError("DOCUMENT_CLOSED", err);
    });
  };

  init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.initialized = true;
    this.disposed = false;
    this.sessions = new Map();
    this.teardownSubscriptions();
    this.wireSubscriptions(ctx);
    ctx.logger.info("Grouping Engine initialized");
    return Promise.resolve();
  }

  startSession(documentId: string): void {
    this.assertNotDisposed();
    this.assertInitialized();
    this.sessions.set(documentId, {
      documentId,
      groups: new Map(),
      nextIndexByType: new Map(),
      rules: [],
      conflicts: new Map(),
      recordedOccurrences: [],
      seed: crypto.randomUUID(),
      startedAt: Date.now(),
      regexFinished: false,
      nerFinished: false,
      finished: false,
    });
  }

  getSnapshot(documentId: string): GroupingEngineSnapshot {
    this.assertNotDisposed();
    this.assertInitialized();
    const session = this.sessions.get(documentId);
    if (!session) {
      return { documentId, groups: [], conflicts: [], rules: [] };
    }
    return {
      documentId,
      groups: [...session.groups.values()].map(toPublicGroup),
      conflicts: [...session.conflicts.values()],
      rules: [...session.rules],
    };
  }

  finishSession(documentId: string): Promise<void> {
    this.assertNotDisposed();
    this.assertInitialized();
    const session = this.sessions.get(documentId);
    if (!session) {
      this.ctx?.logger.warn("finishSession() sin sesión activa.", { documentId });
      return Promise.resolve();
    }
    if (session.finished) return Promise.resolve();
    session.finished = true;

    const durationMs = Date.now() - session.startedAt;
    const groupCount = session.groups.size;
    const conflictCount = session.conflicts.size;
    this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.GROUPING_FINISHED, {
      documentId,
      groupCount,
      conflictCount,
      durationMs,
    });
    return Promise.resolve();
  }

  /*
   * No es `async`: todo el trabajo es cómputo síncrono en memoria. Se
   * envuelve en try/catch devolviendo Promise.resolve/reject explícitos para
   * conservar el contrato `Promise<T>` sin disparar
   * @typescript-eslint/require-await — mismo patrón que
   * `RegexEngine.process` (regex-engine/src/regex.engine.ts), necesario acá
   * porque los handlers del bus (`handleGroupUpdateRequested`, etc.) dependen
   * de que todo throw se convierta en rejection para que su `.catch(...)`
   * lo capture (una `throw` síncrona de una función no-async rompería esa
   * cadena).
   */
  applyGroupUpdate(req: GroupUpdateRequested): Promise<EntityGroup> {
    try {
      this.assertNotDisposed();
      this.assertInitialized();
      this.assertValidRequest(req);
      const { session, group } = this.requireGroup(req.documentId, req.groupId);
      this.validatePatch(req.patch);

      const { replacementMode, replacementValue, enabled, canonicalValue } = req.patch;
      const changed = new Set<keyof EntityGroup>();
      let replacementChanged = false;

      if (canonicalValue !== undefined) {
        group.canonicalValue = canonicalValue;
        changed.add("canonicalValue");
      }

      if (enabled !== undefined) {
        group.enabled = enabled;
        changed.add("enabled");
      }

      if (replacementMode !== undefined) {
        group.replacementMode = replacementMode;
        group.replacementMode = resolveMode(group, session.rules);
        changed.add("replacementMode");
        replacementChanged = true;
        if (replacementValue === undefined) {
          group.replacementValue = computeReplacementValue(
            group.type,
            group.replacementMode,
            group.indexInType,
            session.seed,
          );
          changed.add("replacementValue");
        }
      }

      if (replacementValue !== undefined) {
        group.replacementValue = replacementValue;
        changed.add("replacementValue");
        replacementChanged = true;
      }

      if (changed.size === 0) {
        return Promise.resolve(toPublicGroup(group));
      }

      group.updatedAt = Date.now();
      changed.add("updatedAt");

      this.emitGroupUpdated(session, group, [...changed]);
      if (enabled !== undefined) {
        this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_TOGGLED, {
          documentId: req.documentId,
          groupId: group.id,
          enabled: group.enabled,
        });
      }
      if (replacementChanged) {
        this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, {
          documentId: req.documentId,
          groupId: group.id,
          mode: group.replacementMode,
          value: group.replacementValue,
        });
      }

      return Promise.resolve(toPublicGroup(group));
    } catch (err: unknown) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // No `async`: ver nota en applyGroupUpdate.
  applyGroupMerge(req: GroupMergeRequested): Promise<EntityGroup> {
    try {
      this.assertNotDisposed();
      this.assertInitialized();
      this.assertValidRequest(req);
      const { documentId, sourceGroupId, targetGroupId } = req;
      const session = this.sessions.get(documentId);
      const source = session?.groups.get(sourceGroupId);
      const target = session?.groups.get(targetGroupId);
      if (!session || !source) throw new GroupingGroupNotFoundError(documentId, sourceGroupId);
      if (!target) throw new GroupingGroupNotFoundError(documentId, targetGroupId);

      // "Algoritmos clave" > indexInType: fusionar A(source) en B(target) ->
      // B conserva min(A.index, B.index); A se elimina.
      const newIndex = Math.min(source.indexInType, target.indexInType);
      const indexChanged = newIndex !== target.indexInType;
      target.indexInType = newIndex;

      for (const [value, freq] of source.aliasFrequency) {
        const current = target.aliasFrequency.get(value) ?? 0;
        if (current === 0) target.aliases.push(value);
        target.aliasFrequency.set(value, current + freq);
        if (!target.aliasFirstSeen.has(value)) {
          const info = source.aliasFirstSeen.get(value);
          if (info) target.aliasFirstSeen.set(value, info);
        }
      }
      for (const nv of source.normalizedValues) target.normalizedValues.add(nv);
      target.members.push(...source.members);

      const beforeCanonical = target.canonicalValue;
      if (target.aliases.includes(target.canonicalValue)) {
        this.recomputeCanonicalValue(session, target);
      }

      if (indexChanged) {
        target.replacementValue = computeReplacementValue(
          target.type,
          target.replacementMode,
          target.indexInType,
          session.seed,
        );
      }
      target.updatedAt = Date.now();

      for (const rec of session.recordedOccurrences) {
        if (rec.groupId === sourceGroupId) rec.groupId = targetGroupId;
      }
      session.groups.delete(sourceGroupId);

      const changed: (keyof EntityGroup)[] = ["members", "aliases", "updatedAt", "indexInType"];
      if (target.canonicalValue !== beforeCanonical) changed.push("canonicalValue");
      if (indexChanged) changed.push("replacementValue");

      this.emitGroupUpdated(session, target, changed);
      this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_REMOVED, {
        documentId,
        groupId: sourceGroupId,
      });

      return Promise.resolve(toPublicGroup(target));
    } catch (err: unknown) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // No `async`: ver nota en applyGroupUpdate.
  applyGroupSplit(
    req: GroupSplitRequested,
  ): Promise<{ merged: EntityGroup; created: EntityGroup }> {
    try {
      return Promise.resolve(this.doApplyGroupSplit(req));
    } catch (err: unknown) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private doApplyGroupSplit(req: GroupSplitRequested): {
    merged: EntityGroup;
    created: EntityGroup;
  } {
    this.assertNotDisposed();
    this.assertInitialized();
    this.assertValidRequest(req);
    const { documentId, groupId, occurrenceIds } = req;
    const { session, group } = this.requireGroup(documentId, groupId);

    const idsToMove = new Set(occurrenceIds);
    const movedMembers = group.members.filter((m) => idsToMove.has(m.occurrenceId));
    const remainingMembers = group.members.filter((m) => !idsToMove.has(m.occurrenceId));

    const recordsById = new Map(session.recordedOccurrences.map((r) => [r.occurrenceId, r]));
    const movedRecords = movedMembers
      .map((m) => recordsById.get(m.occurrenceId))
      .filter((r): r is SessionOccurrenceRecord => r !== undefined);
    const remainingRecords = remainingMembers
      .map((m) => recordsById.get(m.occurrenceId))
      .filter((r): r is SessionOccurrenceRecord => r !== undefined);

    const now = Date.now();
    const newIndex = this.nextIndex(session, group.type);
    const created: InternalGroup = {
      id: crypto.randomUUID(),
      type: group.type,
      canonicalValue: "",
      members: movedMembers,
      replacementMode: ReplacementMode.Placeholder,
      replacementValue: "",
      indexInType: newIndex,
      enabled: true,
      aliases: [],
      createdAt: now,
      updatedAt: now,
      normalizedValues: new Set(),
      aliasFrequency: new Map(),
      aliasFirstSeen: new Map(),
    };
    this.rebuildAliasBookkeeping(created, movedRecords);
    if (created.aliases.length > 0) this.recomputeCanonicalValue(session, created);
    const createdMode = resolveMode(created, session.rules);
    created.replacementMode = createdMode;
    created.replacementValue = computeReplacementValue(
      created.type,
      createdMode,
      created.indexInType,
      session.seed,
    );
    session.groups.set(created.id, created);

    // El grupo original preserva canonicalValue si fue fijado manualmente
    // (no está entre los aliases actuales, spec §13 caso 18).
    const preserveCanonical = !group.aliases.includes(group.canonicalValue);
    const previousCanonical = group.canonicalValue;
    group.members = remainingMembers;
    this.rebuildAliasBookkeeping(group, remainingRecords);
    if (preserveCanonical) {
      group.canonicalValue = previousCanonical;
    } else if (group.aliases.length > 0) {
      this.recomputeCanonicalValue(session, group);
    }
    group.updatedAt = now;

    for (const rec of session.recordedOccurrences) {
      if (idsToMove.has(rec.occurrenceId)) rec.groupId = created.id;
    }

    this.emitGroupUpdated(session, group, ["members", "aliases", "canonicalValue", "updatedAt"]);
    this.emitGroupCreated(session, created);

    return { merged: toPublicGroup(group), created: toPublicGroup(created) };
  }

  // No `async`: ver nota en applyGroupUpdate.
  applyRuleCreated(req: RuleCreated): Promise<void> {
    try {
      this.assertNotDisposed();
      this.assertInitialized();
      this.assertValidRequest(req);
      const session = this.sessions.get(req.documentId);
      if (!session) {
        this.ctx?.logger.warn("RULE_CREATED sin sesión activa.", { documentId: req.documentId });
        return Promise.resolve();
      }
      session.rules.push(req.rule);
      this.recomputeAllGroupModes(session);
      return Promise.resolve();
    } catch (err: unknown) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // No `async`: ver nota en applyGroupUpdate.
  applyRuleUpdated(req: RuleUpdated): Promise<void> {
    try {
      this.assertNotDisposed();
      this.assertInitialized();
      this.assertValidRequest(req);
      const session = this.sessions.get(req.documentId);
      if (!session) {
        this.ctx?.logger.warn("RULE_UPDATED sin sesión activa.", { documentId: req.documentId });
        return Promise.resolve();
      }
      const idx = session.rules.findIndex((r) => r.id === req.ruleId);
      const current = idx >= 0 ? session.rules[idx] : undefined;
      if (idx < 0 || !current) {
        this.ctx?.logger.warn("RULE_UPDATED con ruleId desconocido; se ignora.", {
          documentId: req.documentId,
          ruleId: req.ruleId,
        });
        return Promise.resolve();
      }
      session.rules[idx] = { ...current, ...req.patch, updatedAt: Date.now() };
      this.recomputeAllGroupModes(session);
      return Promise.resolve();
    } catch (err: unknown) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // No `async`: ver nota en applyGroupUpdate.
  applyRuleDeleted(req: RuleDeleted): Promise<void> {
    try {
      this.assertNotDisposed();
      this.assertInitialized();
      this.assertValidRequest(req);
      const session = this.sessions.get(req.documentId);
      if (!session) {
        this.ctx?.logger.warn("RULE_DELETED sin sesión activa.", { documentId: req.documentId });
        return Promise.resolve();
      }
      const before = session.rules.length;
      session.rules = session.rules.filter((r) => r.id !== req.ruleId);
      if (session.rules.length === before) {
        this.ctx?.logger.warn("RULE_DELETED con ruleId desconocido; no-op.", {
          documentId: req.documentId,
          ruleId: req.ruleId,
        });
        return Promise.resolve();
      }
      this.recomputeAllGroupModes(session);
      return Promise.resolve();
    } catch (err: unknown) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // No `async`: ver nota en applyGroupUpdate.
  applyConflictResolve(req: ConflictResolveRequested): Promise<Conflict> {
    try {
      this.assertNotDisposed();
      this.assertInitialized();
      this.assertValidRequest(req);
      const session = this.sessions.get(req.documentId);
      const conflict = session?.conflicts.get(req.conflictId);
      if (!session || !conflict) {
        // spec §11 no define un EngineErrorCode dedicado a "conflictId no
        // encontrado" — se reutiliza GroupingGroupNotFoundError (ver nota 8 del
        // header de este archivo y grouping.errors.ts).
        throw new GroupingGroupNotFoundError(req.documentId, req.conflictId, { kind: "conflict" });
      }

      const resolved: Conflict = { ...conflict, resolved: true, resolvedMode: req.mode };
      session.conflicts.set(conflict.id, resolved);

      const group = session.groups.get(conflict.groupId);
      if (group) {
        group.replacementMode = req.mode;
        group.replacementMode = resolveMode(group, session.rules);
        group.replacementValue = computeReplacementValue(
          group.type,
          group.replacementMode,
          group.indexInType,
          session.seed,
        );
        group.updatedAt = Date.now();
        this.emitGroupUpdated(session, group, ["replacementMode", "replacementValue", "updatedAt"]);
        this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, {
          documentId: req.documentId,
          groupId: group.id,
          mode: group.replacementMode,
          value: group.replacementValue,
        });
      }

      this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.CONFLICT_RESOLVED, {
        documentId: req.documentId,
        conflictId: conflict.id,
        mode: req.mode,
      });

      return Promise.resolve(resolved);
    } catch (err: unknown) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  closeSession(documentId: string): Promise<void> {
    this.assertNotDisposed();
    this.assertInitialized();
    this.sessions.delete(documentId);
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.teardownSubscriptions();
    this.sessions.clear();
    this.disposed = true;
    this.initialized = false;
    this.ctx = null;
    return Promise.resolve();
  }

  // ─── Internos: suscripción al bus ───

  private wireSubscriptions(ctx: EngineContext): void {
    const bus = ctx.bus;
    this.unsubscribes.push(
      bus.on(EventChannel.Regex, EngineEvents.ENTITY_FOUND, this.handleEntityFound),
      bus.on(EventChannel.Ner, EngineEvents.ENTITY_FOUND, this.handleEntityFound),
      bus.on(EventChannel.Regex, EngineEvents.REGEX_FINISHED, this.handleRegexFinished),
      bus.on(EventChannel.Ner, EngineEvents.NER_FINISHED, this.handleNerFinished),
      bus.on(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, this.handleGroupUpdateRequested),
      bus.on(EventChannel.UI, EngineEvents.GROUP_MERGE_REQUESTED, this.handleGroupMergeRequested),
      bus.on(EventChannel.UI, EngineEvents.GROUP_SPLIT_REQUESTED, this.handleGroupSplitRequested),
      bus.on(EventChannel.UI, EngineEvents.RULE_CREATED, this.handleRuleCreated),
      bus.on(EventChannel.UI, EngineEvents.RULE_UPDATED, this.handleRuleUpdated),
      bus.on(EventChannel.UI, EngineEvents.RULE_DELETED, this.handleRuleDeleted),
      bus.on(
        EventChannel.UI,
        EngineEvents.CONFLICT_RESOLVE_REQUESTED,
        this.handleConflictResolveRequested,
      ),
      bus.on(EventChannel.UI, EngineEvents.DOCUMENT_CLOSED, this.handleDocumentClosed),
    );
  }

  private teardownSubscriptions(): void {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
  }

  private logUiError(event: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.ctx?.logger.warn(`Fallo al procesar ${event}: ${message}`, { event });
  }

  // ─── Internos: agrupación ───

  private maybeFinishSession(session: Session): void {
    if (session.regexFinished && session.nerFinished && !session.finished) {
      this.finishSession(session.documentId).catch((err: unknown) => {
        this.logUiError("GROUPING_FINISHED (auto)", err);
      });
    }
  }

  private processOccurrence(session: Session, occurrence: Occurrence): void {
    if (!this.ctx) return;

    // Caso 9 (§13): low_confidence — solo aplica a ocurrencias NER.
    if (
      occurrence.source === DetectionSource.NER &&
      occurrence.confidence < this.ctx.config.ner.confidenceThreshold
    ) {
      this.handleLowConfidence(session, occurrence);
      return;
    }

    // Casos 7-8 (§13): overlap / disagree contra ocurrencias ya agrupadas.
    const conflictMatch = this.findOverlapConflict(session, occurrence);
    if (conflictMatch) {
      const { existing, reason } = conflictMatch;
      const newWins = this.conflictWinnerIsNew(existing, occurrence, reason);
      this.emitOverlapOrDisagreeConflict(session, existing, occurrence, reason);
      if (!newWins) return;
    }

    this.groupOccurrence(session, occurrence);
  }

  private handleLowConfidence(session: Session, occurrence: Occurrence): void {
    const candidateGroup = this.findMatchingGroup(session, occurrence);
    if (!candidateGroup) {
      this.ctx?.logger.warn(
        "Ocurrencia NER de baja confianza descartada sin grupo candidato; no se emite CONFLICT_DETECTED.",
        {
          documentId: session.documentId,
          occurrenceId: occurrence.id,
          confidence: occurrence.confidence,
        },
      );
      return;
    }
    const conflict = this.buildConflict(
      session,
      candidateGroup.id,
      ConflictReason.LowConfidence,
      [groupPrimaryCandidate(candidateGroup), occurrenceAsCandidate(occurrence)],
      true,
      candidateGroup.replacementMode,
    );
    this.emitConflictDetected(session, conflict);
  }

  private findOverlapConflict(
    session: Session,
    occurrence: Occurrence,
  ): { existing: SessionOccurrenceRecord; reason: ConflictReason } | null {
    for (const rec of session.recordedOccurrences) {
      if (rec.pageIndex !== occurrence.pageIndex) continue;
      if (rec.entityType === occurrence.entityType) continue;
      if (bboxIntersectionRatio(rec.bbox, occurrence.bbox) > 0.5) {
        const reason =
          rec.source !== occurrence.source ? ConflictReason.Disagree : ConflictReason.Overlap;
        return { existing: rec, reason };
      }
    }
    return null;
  }

  private conflictWinnerIsNew(
    existing: SessionOccurrenceRecord,
    occurrence: Occurrence,
    reason: ConflictReason,
  ): boolean {
    if (reason === ConflictReason.Disagree) {
      // Caso 8 (§13): "gana Regex" siempre, sin importar confidence.
      return occurrence.source === DetectionSource.Regex;
    }
    // Caso 7 (§13): gana mayor confidence; en empate, source: "regex".
    if (occurrence.confidence !== existing.confidence) {
      return occurrence.confidence > existing.confidence;
    }
    if (occurrence.source === existing.source) return false;
    return occurrence.source === DetectionSource.Regex;
  }

  private emitOverlapOrDisagreeConflict(
    session: Session,
    existing: SessionOccurrenceRecord,
    occurrence: Occurrence,
    reason: ConflictReason,
  ): void {
    const group = session.groups.get(existing.groupId);
    const existingCandidate: ConflictCandidate = {
      source: existing.source,
      entityType: existing.entityType,
      confidence: existing.confidence,
      value: existing.value,
    };
    const conflict = this.buildConflict(
      session,
      existing.groupId,
      reason,
      [existingCandidate, occurrenceAsCandidate(occurrence)],
      true,
      group?.replacementMode,
    );
    this.emitConflictDetected(session, conflict);
  }

  private groupOccurrence(session: Session, occurrence: Occurrence): InternalGroup {
    const match = this.findMatchingGroup(session, occurrence);
    if (match) {
      const changed = this.addOccurrenceToGroup(session, match, occurrence);
      this.recordOccurrence(session, occurrence, match.id);
      this.emitGroupUpdated(session, match, changed);
      return match;
    }
    const created = this.createGroup(session, occurrence);
    this.recordOccurrence(session, occurrence, created.id);
    this.emitGroupCreated(session, created);
    return created;
  }

  private findMatchingGroup(session: Session, occurrence: Occurrence): InternalGroup | null {
    const threshold = this.ctx?.config.grouping.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const candidates: InternalGroup[] = [];
    for (const group of session.groups.values()) {
      if (group.type === occurrence.entityType) candidates.push(group);
    }
    for (const group of candidates) {
      if (group.normalizedValues.has(occurrence.normalizedValue)) return group;
    }
    for (const group of candidates) {
      for (const normalizedAlias of group.normalizedValues) {
        if (levenshteinNormalized(occurrence.normalizedValue, normalizedAlias) >= threshold) {
          return group;
        }
      }
    }
    return null;
  }

  private createGroup(session: Session, occurrence: Occurrence): InternalGroup {
    const now = Date.now();
    const indexInType = this.nextIndex(session, occurrence.entityType);
    const group: InternalGroup = {
      id: crypto.randomUUID(),
      type: occurrence.entityType,
      canonicalValue: occurrence.value,
      members: [toOccurrenceRef(occurrence)],
      replacementMode: ReplacementMode.Placeholder,
      replacementValue: "",
      indexInType,
      enabled: true,
      aliases: [occurrence.value],
      createdAt: now,
      updatedAt: now,
      normalizedValues: new Set([occurrence.normalizedValue]),
      aliasFrequency: new Map([[occurrence.value, 1]]),
      aliasFirstSeen: new Map([
        [
          occurrence.value,
          {
            source: occurrence.source,
            entityType: occurrence.entityType,
            confidence: occurrence.confidence,
          },
        ],
      ]),
    };
    group.replacementMode = resolveMode(group, session.rules);
    group.replacementValue = computeReplacementValue(
      group.type,
      group.replacementMode,
      group.indexInType,
      session.seed,
    );
    session.groups.set(group.id, group);
    return group;
  }

  private addOccurrenceToGroup(
    session: Session,
    group: InternalGroup,
    occurrence: Occurrence,
  ): ReadonlyArray<keyof EntityGroup> {
    const changed = new Set<keyof EntityGroup>(["members", "updatedAt"]);
    group.members.push(toOccurrenceRef(occurrence));
    group.normalizedValues.add(occurrence.normalizedValue);

    const isNewAlias = !group.aliasFrequency.has(occurrence.value);
    if (isNewAlias) {
      group.aliases.push(occurrence.value);
      group.aliasFrequency.set(occurrence.value, 1);
      group.aliasFirstSeen.set(occurrence.value, {
        source: occurrence.source,
        entityType: occurrence.entityType,
        confidence: occurrence.confidence,
      });
      changed.add("aliases");
    } else {
      group.aliasFrequency.set(
        occurrence.value,
        (group.aliasFrequency.get(occurrence.value) ?? 0) + 1,
      );
    }

    // Caso 18 (§13): si canonicalValue ya no está entre los aliases, fue
    // fijado manualmente por el usuario — no se recalcula automáticamente.
    if (group.aliases.includes(group.canonicalValue)) {
      const before = group.canonicalValue;
      this.recomputeCanonicalValue(session, group);
      if (group.canonicalValue !== before) changed.add("canonicalValue");
    }

    group.updatedAt = Date.now();
    return [...changed];
  }

  private nextIndex(session: Session, type: EntityType): number {
    const current = session.nextIndexByType.get(type) ?? 0;
    const next = current + 1;
    session.nextIndexByType.set(type, next);
    return next;
  }

  private recomputeCanonicalValue(session: Session, group: InternalGroup): void {
    const entries = [...group.aliasFrequency.entries()];
    if (entries.length === 0) return;

    const maxFreq = Math.max(...entries.map(([, f]) => f));
    const topByFreq = entries.filter(([, f]) => f === maxFreq);
    if (topByFreq.length === 1) {
      group.canonicalValue = topByFreq[0]?.[0] ?? group.canonicalValue;
      return;
    }

    const maxLen = Math.max(...topByFreq.map(([v]) => v.length));
    const topByLen = topByFreq.filter(([v]) => v.length === maxLen);
    if (topByLen.length === 1) {
      group.canonicalValue = topByLen[0]?.[0] ?? group.canonicalValue;
      return;
    }

    // Empate real (misma frecuencia y misma longitud): arbitrario, el
    // primero encontrado (orden de inserción en `aliases`) — caso 10 (§13).
    const tieValues = new Set(topByLen.map(([v]) => v));
    const first = group.aliases.find((a) => tieValues.has(a));
    group.canonicalValue = first ?? topByLen[0]?.[0] ?? group.canonicalValue;
    this.raiseAmbiguousCanonicalConflict(session, group, [...tieValues]);
  }

  private raiseAmbiguousCanonicalConflict(
    session: Session,
    group: InternalGroup,
    tieValues: ReadonlyArray<string>,
  ): void {
    const candidates: ConflictCandidate[] = tieValues.map((value) => {
      const info = group.aliasFirstSeen.get(value);
      return {
        source: info?.source ?? DetectionSource.Manual,
        entityType: group.type,
        confidence: info?.confidence ?? 1,
        value,
      };
    });
    const conflict = this.buildConflict(
      session,
      group.id,
      ConflictReason.AmbiguousCanonical,
      candidates,
      false,
      undefined,
    );
    this.emitConflictDetected(session, conflict);
  }

  private rebuildAliasBookkeeping(
    group: InternalGroup,
    records: ReadonlyArray<SessionOccurrenceRecord>,
  ): void {
    group.normalizedValues.clear();
    group.aliasFrequency.clear();
    group.aliasFirstSeen.clear();
    group.aliases = [];
    for (const rec of records) {
      group.normalizedValues.add(rec.normalizedValue);
      const freq = group.aliasFrequency.get(rec.value) ?? 0;
      if (freq === 0) group.aliases.push(rec.value);
      group.aliasFrequency.set(rec.value, freq + 1);
      if (!group.aliasFirstSeen.has(rec.value)) {
        group.aliasFirstSeen.set(rec.value, {
          source: rec.source,
          entityType: rec.entityType,
          confidence: rec.confidence,
        });
      }
    }
  }

  private recomputeAllGroupModes(session: Session): void {
    for (const group of session.groups.values()) {
      const beforeMode = group.replacementMode;
      const effectiveMode = resolveMode(group, session.rules);
      if (effectiveMode === beforeMode) continue;

      group.replacementMode = effectiveMode;
      group.replacementValue = computeReplacementValue(
        group.type,
        effectiveMode,
        group.indexInType,
        session.seed,
      );
      group.updatedAt = Date.now();
      this.emitGroupUpdated(session, group, ["replacementMode", "replacementValue", "updatedAt"]);
      this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, {
        documentId: session.documentId,
        groupId: group.id,
        mode: group.replacementMode,
        value: group.replacementValue,
      });
    }
  }

  private recordOccurrence(session: Session, occurrence: Occurrence, groupId: string): void {
    session.recordedOccurrences.push({
      occurrenceId: occurrence.id,
      entityType: occurrence.entityType,
      source: occurrence.source,
      confidence: occurrence.confidence,
      value: occurrence.value,
      normalizedValue: occurrence.normalizedValue,
      bbox: occurrence.bbox,
      pageIndex: occurrence.pageIndex,
      groupId,
    });
  }

  private buildConflict(
    session: Session,
    groupId: string,
    reason: ConflictReason,
    candidates: ReadonlyArray<ConflictCandidate>,
    resolved: boolean,
    resolvedMode: ReplacementMode | undefined,
  ): Conflict {
    const conflict: Conflict =
      resolved && resolvedMode !== undefined
        ? { id: crypto.randomUUID(), groupId, reason, candidates, resolved, resolvedMode }
        : { id: crypto.randomUUID(), groupId, reason, candidates, resolved: false };
    session.conflicts.set(conflict.id, conflict);
    return conflict;
  }

  private emitConflictDetected(session: Session, conflict: Conflict): void {
    this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.CONFLICT_DETECTED, {
      documentId: session.documentId,
      conflict,
    });
  }

  private emitGroupCreated(session: Session, group: InternalGroup): void {
    this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, {
      documentId: session.documentId,
      group: toPublicGroup(group),
    });
  }

  private emitGroupUpdated(
    session: Session,
    group: InternalGroup,
    changes: ReadonlyArray<keyof EntityGroup>,
  ): void {
    if (changes.length === 0) return;
    this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, {
      documentId: session.documentId,
      group: toPublicGroup(group),
      changes,
    });
  }

  // ─── Internos: helpers de request ───

  private requireGroup(
    documentId: string,
    groupId: string,
  ): { session: Session; group: InternalGroup } {
    const session = this.sessions.get(documentId);
    const group = session?.groups.get(groupId);
    if (!session || !group) {
      throw new GroupingGroupNotFoundError(documentId, groupId);
    }
    return { session, group };
  }

  private validatePatch(patch: GroupUpdateRequested["patch"]): void {
    if (patch == null || typeof patch !== "object") {
      throw new GroupingInvalidPatchError("el patch debe ser un objeto.");
    }
    const invalidKeys = Object.keys(patch).filter((k) => !PATCH_ALLOWED_KEYS.has(k));
    if (invalidKeys.length > 0) {
      throw new GroupingInvalidPatchError(`campos no permitidos: ${invalidKeys.join(", ")}`, {
        invalidKeys,
      });
    }
  }

  private assertValidRequest(req: unknown): void {
    if (req == null) {
      throw new InvalidInputError("Request es null o undefined.", { engineId: EngineId.Grouping });
    }
    if (this.ctx?.abortSignal.aborted) {
      throw new CancelledError();
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new EngineNotInitializedError(EngineId.Grouping);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineDisposedError(EngineId.Grouping);
    }
  }
}
