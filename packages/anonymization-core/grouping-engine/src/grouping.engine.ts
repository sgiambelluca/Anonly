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
 *
 * Notas de implementación agregadas en el Hito 10 (ADR-038, spec v1.1.0):
 *
 * 9. Dedup por identidad (§13 caso 23): se compara contra
 *    `session.recordedOccurrences` — ocurrencias YA agrupadas — no contra
 *    ocurrencias descartadas por `low_confidence` o por perder un conflicto
 *    `overlap`/`disagree` (esas nunca se registran, nota 6/7 arriba). Esto es
 *    literal con el texto del ADR-038 §3: "identidad ... ya registrada en la
 *    sesión". Una ocurrencia duplicada de otra ya descartada simplemente
 *    vuelve a pasar por el mismo camino (low_confidence/conflict) sin efecto
 *    observable adicional.
 * 10. `dropOccurrences` (§13 casos 24-25, ADR-038 §2): la condición del ADR
 *    "conflictos cuyos candidates referencian ocurrencias eliminadas O cuyo
 *    grupo se eliminó" se implementa como una única condición determinable:
 *    **el `groupId` del conflicto ya no existe en la sesión**. `Conflict`/
 *    `ConflictCandidate` (`03_Data_Model.md` §15) no retienen `occurrenceId`
 *    por diseño (solo `source`/`entityType`/`confidence`/`value`), así que no
 *    hay forma estructural de verificar "candidates referencian esta
 *    ocurrencia puntual" sin agregar tracking privado inventado; la condición
 *    "grupo eliminado" sí es exacta y cubre el escenario descrito en el caso
 *    25 del spec (re-OCR de una página: el grupo cuyo único member vivía ahí
 *    queda sin members y se elimina). Conflictos cuyo grupo sobrevive (con
 *    otros members) no se tocan. Ver reporte final del PR para que el revisor
 *    confirme esta lectura.
 *
 * Nota agregada en el Hito 10.5 (ADR-057, spec v1.2.0, escalera de
 * abreviaturas del `placeholder`):
 *
 * 11. `computeReplacementValue` pasó de recibir `(type, mode, indexInType,
 *    seed, maskFormat)` a recibir `(group, seed, maskFormat)`: el modo
 *    `placeholder` (ADR-057 §4) necesita además `members` para elegir el
 *    nivel de abreviatura por el peor caso de sus bbox, y en los 10 call
 *    sites reales de esta función (no 3: `dropOccurrences`,
 *    `renumberGroupsCanonically`, `applyGroupUpdate`, `applyGroupMerge`,
 *    `doApplyGroupSplit` ×2, `applyConflictResolve`, `createGroup`,
 *    `recomputeAllGroupModes`) `group.replacementMode`/`indexInType`/
 *    `members` ya reflejan el valor final deseado en el momento de llamar —
 *    pasar el grupo completo evita repetir esos tres campos sueltos.
 *    `resolveLabelSet`/`buildPlaceholderValue` (`labels.ts`) toman
 *    `EntityGroup`, no `InternalGroup`: es estructuralmente compatible
 *    (`Code_Standards.md`), sin conversión explícita.
 * 12. Ningún disparador de recálculo se agregó ni se quitó (ADR-057 §7:
 *    "se recalcula donde ya se recalculaba, sin disparadores nuevos"). En
 *    particular, `renumberGroupsCanonically` conserva intacto el
 *    `if (newIndex === group.indexInType) return;` de ADR-028: es,
 *    incidentalmente, el mismo mecanismo que hace sobrevivir una edición
 *    manual de `replacementValue` a un `finishSession` posterior (caso 30) —
 *    si el índice no cambia, ni siquiera se intenta recomputar. La
 *    contracara (caso 31: un member más angosto sumado en un
 *    `reopenSession` cambia el nivel) se cubre con un escenario donde
 *    TAMBIÉN cambia el índice (dos grupos del mismo tipo reordenados), que sí
 *    dispara el recálculo existente — no se tocó la condición de guarda. No
 *    hay tracking de "este valor fue editado a mano" más allá de ese guard
 *    heredado: si un grupo con `replacementValue` manual además cambia de
 *    índice en una renumeración, ADR-028 ya lo recomputa desde antes de este
 *    PR (comportamiento pre-existente, fuera de alcance de ADR-057 §7, que
 *    solo promete la misma precedencia que ADR-028 ya tenía).
 *
 * Notas agregadas en el Hito 10.6, PR 11c (ADR-069 §5-§7, spec v1.4.0 —
 * inferencia disparada, elección del humano recordada):
 *
 * 13. `inferGenderIfDue` (función de módulo, no método: no lee `this`) se
 *    invoca en los TRES puntos que ADR-069 §6(a) enumera de forma literal —
 *    `createGroup`, `applyGroupMerge` (sobre `target`, el grupo que
 *    sobrevive) y `applyGroupUpdate` cuando `patch.canonicalValue !==
 *    undefined` — más el `created` de `doApplyGroupSplit` (también una
 *    creación de `InternalGroup`, mismo trigger que `createGroup`). **A
 *    propósito NO** se invoca en los recálculos automáticos de
 *    `canonicalValue` que no son ninguno de esos tres (el de
 *    `addOccurrenceToGroup` cuando llega una nueva `Occurrence`, el del
 *    grupo REMANENTE — no el `created` — en `doApplyGroupSplit`, ni el de
 *    `dropOccurrences`): el spec enumera "creación, fusión, y edición manual
 *    de patch.canonicalValue" como una lista cerrada, y la red de
 *    convergencia de `finishSession` (nota siguiente) cubre cualquier
 *    `canonicalValue` que haya evolucionado por fuera de esos tres puntos
 *    durante la sesión — evita, además, recalcular en cada `ENTITY_FOUND`.
 * 14. `finishSession` llama `inferGendersOnFinish` ANTES de
 *    `renumberGroupsCanonically` (ADR-069 §6(b)): sobre todos los grupos
 *    `Person` sin `personGenderUserSet`, para que un género recién resuelto
 *    entre a la misma pasada que ya recalcula `replacementValue` de los
 *    placeholders afectados (mismo "no parpadeo" que ADR-028 le da a
 *    `indexInType`, caso 37).
 * 15. `personGenderUserSet` no tiene guard explícito en `closeSession`: vive
 *    dentro de `InternalGroup`, y `closeSession` ya borra la sesión entera
 *    (`sessions.delete`), así que se limpia solo. `reopenSession` no toca
 *    `session.groups` en absoluto, así que la elección del humano sobrevive
 *    sin código adicional — igual que el resto de las ediciones de grupo
 *    (nota de cabecera del spec, ADR-038 §2).
 */

import {
  CancelledError,
  ConflictReason,
  DetectionSource,
  GENDER_LEXICON,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EntityType,
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
  type GroupMergeRequested,
  type GroupSplitRequested,
  type GroupUpdateRequested,
  type IEngine,
  type NerFinished,
  type Occurrence,
  type OccurrenceRef,
  type PersonGender,
  type RegexFinished,
  type Rule,
  type RuleCreated,
  type RuleDeleted,
  type RuleUpdated,
  type Unsubscribe,
} from "@anonly/shared";

import { inferPersonGender } from "./gender.js";
import { GroupingGroupNotFoundError, GroupingInvalidPatchError } from "./grouping.errors.js";
import type {
  DropOccurrencesFilter,
  GroupingEngineSnapshot,
  ReopenSessionOptions,
} from "./grouping.types.js";
import { buildPlaceholderValue, MASK_FORMAT_BY_TYPE } from "./labels.js";
import { levenshteinNormalized } from "./levenshtein.js";

const DEFAULT_SIMILARITY_THRESHOLD = 0.88;

/** ADR-073 §1: los tres tipos cuyo valor es texto libre. */
const FUZZY_MATCHING_TYPES: ReadonlySet<EntityType> = new Set([
  EntityType.Person,
  EntityType.Organization,
  EntityType.Address,
]);

const PATCH_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "type", // ADR-082 §1
  "replacementMode",
  "replacementValue",
  "enabled",
  "canonicalValue",
  "personGender",
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
  /** Solo relevante para type === Person; ausente = sin determinar (ADR-060 §2). */
  personGender?: PersonGender;
  createdAt: number;
  updatedAt: number;
  // Bookkeeping interno (nunca expuesto):
  readonly normalizedValues: Set<string>;
  readonly aliasFrequency: Map<string, number>;
  readonly aliasFirstSeen: Map<string, AliasSourceInfo>;
  /**
   * ADR-069 §5: la elección del humano (incluido "neutral", que borra
   * `personGender` sin dejar rastro público) tiene que distinguirse de "todavía
   * no se infirió" para que ninguna inferencia posterior la pise. Nunca sale de
   * este motor — mismo criterio que `normalizedValues`/`aliasFrequency`.
   */
  personGenderUserSet: boolean;
  /**
   * ADR-085 §1(a): los tipos de detector que este grupo acepta. Arranca con el
   * tipo de la ocurrencia que lo creó y gana el tipo nuevo en cada
   * reclasificación, de modo que una ocurrencia futura que el detector siga
   * emitiendo con el tipo viejo **caiga igual en el grupo corregido** en vez
   * de crear uno paralelo (escenario B de ADR-082, Consecuencias).
   *
   * Bookkeeping interno, nunca expuesto — mismo criterio que
   * `normalizedValues`/`aliasFrequency`. No guarda ningún valor del documento:
   * solo tipos.
   */
  readonly absorbedTypes: Set<EntityType>;
  /**
   * ADR-076 §1: el `replacementValue` lo escribió el usuario. Ningún
   * recálculo automático lo pisa (§3) — el corte es si el `replacementMode`
   * efectivo cambió, no si el disparador fue "automático" o "manual". Mismo
   * patrón que `personGenderUserSet` y por el mismo motivo: sin este flag, un
   * valor escrito a mano es indistinguible de uno calculado. Nunca sale de
   * este motor.
   */
  replacementValueUserSet: boolean;
}

/** Copia liviana de los campos de `Occurrence` necesarios para matching/conflictos, indexada por sesión. */
interface SessionOccurrenceRecord {
  readonly occurrenceId: string;
  /**
   * El tipo que produjo el DETECTOR, no el del grupo (ADR-082 §3). Una
   * reclasificación del usuario no lo toca: este campo se compara contra lo
   * que el detector vuelve a emitir en un `reanalyze`.
   */
  readonly entityType: EntityType;
  readonly source: DetectionSource;
  readonly confidence: number;
  readonly value: string;
  readonly normalizedValue: string;
  readonly bbox: BoundingBox;
  readonly pageIndex: number;
  /** ADR-029: formato de máscara del patrón que matcheó (ausente en NER). */
  readonly maskFormat?: string;
  groupId: string;
}

/**
 * Una corrección de tipo del usuario (ADR-085). Guarda además el tipo que el
 * DETECTOR le había dado al valor: sin eso, el pase difuso del lookup corre
 * sobre todas las claves del mapa sin importar de qué tipo eran, y una
 * corrección registrada sobre un valor estructurado (un teléfono, un CUIT)
 * queda expuesta al difuso de un `Person`/`Organization`/`Address` entrante.
 * Hoy no es alcanzable con datos plausibles —un nombre no se parece a una
 * cadena de dígitos— pero el razonamiento de ADR-085 §3 asume que el guard es
 * simétrico, y sin este campo no lo era.
 */
interface TypeCorrection {
  readonly correctedType: EntityType;
  readonly detectorType: EntityType;
}

interface Session {
  readonly documentId: string;
  readonly groups: Map<string, InternalGroup>;
  readonly nextIndexByType: Map<EntityType, number>;
  rules: Rule[];
  readonly conflicts: Map<string, Conflict>;
  readonly recordedOccurrences: SessionOccurrenceRecord[];
  /**
   * ADR-085 §1(b): `normalizedValue` → tipo con el que el usuario corrigió ese
   * valor. Se consulta **solo en `createGroup`** (único call site, alcanzable
   * solo cuando `findMatchingGroup` no encontró nada), o sea una vez por grupo
   * creado y no por ocurrencia.
   *
   * Es lo único que cubre el escenario C de ADR-082: si un `reanalyze` borra
   * el grupo corregido —`dropOccurrences({ source: NER })` lo hace al apagar
   * NER—, `absorbedTypes` se va con él y esto es lo que hace que el grupo
   * recreado nazca con el tipo corregido.
   *
   * RAM y por documento: muere con la sesión (`closeSession`) y sobrevive a
   * `reopenSession`, igual que los grupos y las ediciones del usuario. **No se
   * persiste** (`08_Security_Model.md` §10.2: nunca contenido del documento
   * fuera de RAM).
   */
  readonly typeCorrections: Map<string, TypeCorrection>;
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
    // exactOptionalPropertyTypes: no asignar `undefined` explícito (mismo
    // patrón que maskFormat en recordOccurrence).
    ...(group.personGender !== undefined ? { personGender: group.personGender } : {}),
    // ADR-078 §1: el flag sale del motor porque su valor asociado NO delata
    // su procedencia — `[P1]` escrito a mano y `[P1]` calculado son
    // idénticos, así que sin esto la UI no puede pintar el indicador de
    // `UX_Guidelines.md` §3.3 ni ofrecer "restaurar valor calculado".
    // `personGenderUserSet` sigue interno por la razón inversa (ADR-078 §2).
    replacementValueUserSet: group.replacementValueUserSet,
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
    // ADR-074 §1/§2: copiado tal cual, nunca `fragments: undefined` explícito
    // (exactOptionalPropertyTypes) — mismo patrón que personGender arriba.
    ...(occurrence.fragments !== undefined ? { fragments: occurrence.fragments } : {}),
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

/** Igualdad estricta de bbox (ADR-038 §3: la identidad de una ocurrencia usa igualdad exacta, no tolerancia). */
function bboxEquals(a: BoundingBox, b: BoundingBox): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** `DropOccurrencesFilter`: al menos un campo presente, AND si ambos (ADR-038 §2). */
function matchesDropFilter(
  rec: Pick<SessionOccurrenceRecord, "source" | "pageIndex">,
  filter: DropOccurrencesFilter,
): boolean {
  if (filter.source !== undefined && rec.source !== filter.source) return false;
  if (filter.pageIndices !== undefined && !filter.pageIndices.includes(rec.pageIndex)) return false;
  return true;
}

/**
 * Posición de primera aparición documental de un grupo (ADR-028, "Algoritmos
 * clave" > `indexInType`), usada para la renumeración canónica en
 * `finishSession`.
 */
interface DocumentPosition {
  readonly pageIndex: number;
  readonly y: number;
  readonly x: number;
  readonly normalizedValue: string;
}

/** Orden lexicográfico (pageIndex, y, x, normalizedValue) — ADR-028. */
function compareDocumentPosition(a: DocumentPosition, b: DocumentPosition): number {
  if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  if (a.normalizedValue < b.normalizedValue) return -1;
  if (a.normalizedValue > b.normalizedValue) return 1;
  return 0;
}

function recordPosition(rec: SessionOccurrenceRecord): DocumentPosition {
  return {
    pageIndex: rec.pageIndex,
    y: rec.bbox.y,
    x: rec.bbox.x,
    normalizedValue: rec.normalizedValue,
  };
}

type RecordWithMaskFormat = SessionOccurrenceRecord & { readonly maskFormat: string };

/**
 * Resolución de `mask` por grupo (ADR-029 §3): si algún member lleva
 * `maskFormat`, gana el más frecuente entre los que lo llevan; empate → el
 * del member con primera aparición documental (mismo comparador que ADR-028).
 * Si ninguno lo lleva (grupo formado solo por NER), fallback
 * `MASK_FORMAT_BY_TYPE[type]`.
 */
function resolveMaskFormatFromRecords(
  records: ReadonlyArray<SessionOccurrenceRecord>,
  type: EntityType,
): string {
  const withFormat = records.filter((r): r is RecordWithMaskFormat => r.maskFormat !== undefined);
  if (withFormat.length === 0) return MASK_FORMAT_BY_TYPE[type];

  const counts = new Map<string, number>();
  for (const rec of withFormat) {
    counts.set(rec.maskFormat, (counts.get(rec.maskFormat) ?? 0) + 1);
  }
  const maxFreq = Math.max(...counts.values());
  const topCandidates = withFormat.filter((rec) => counts.get(rec.maskFormat) === maxFreq);

  const winner = topCandidates.reduce((earliest, rec) =>
    compareDocumentPosition(recordPosition(rec), recordPosition(earliest)) < 0 ? rec : earliest,
  );
  return winner.maskFormat;
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

/**
 * `group` es siempre un `InternalGroup` en runtime, estructuralmente
 * compatible con `EntityGroup` (tiene todos sus campos más bookkeeping
 * interno) — sin conversión explícita, `Code_Standards.md`. Se le pide el
 * grupo completo (no `type`/`mode`/`indexInType` sueltos) porque el modo
 * `placeholder` (ADR-057) necesita además `group.members` para elegir el
 * nivel de abreviatura por el peor caso de sus bbox; en todos los call
 * sites, `group.replacementMode`/`indexInType`/`members` ya reflejan el
 * valor final deseado en el momento de llamar.
 */
function computeReplacementValue(group: EntityGroup, seed: string, maskFormat: string): string {
  switch (group.replacementMode) {
    case ReplacementMode.Mask:
      return maskFormat;
    case ReplacementMode.Synthetic:
      // ADR-072 §1-§2: la semilla del sorteo es la identidad del grupo
      // (`group.id`), no su `indexInType`. ADR-071 §5: `personGender`
      // filtra el pool de nombres de pila y NO entra a la semilla; se omite
      // por completo cuando está ausente (exactOptionalPropertyTypes no
      // permite `personGender: undefined` explícito, mismo patrón que la
      // línea 295 de este archivo).
      return synthesize({
        type: group.type,
        groupId: group.id,
        seed,
        indexInType: group.indexInType,
        ...(group.personGender !== undefined ? { personGender: group.personGender } : {}),
      });
    case ReplacementMode.Placeholder:
      return buildPlaceholderValue(group);
    case ReplacementMode.Redact:
      return "";
    default:
      return buildPlaceholderValue(group);
  }
}

/**
 * `InternalGroup.personGender` es opcional SIN `| undefined` explícito
 * (mismo criterio que `EntityGroup.personGender` — `exactOptionalPropertyTypes`
 * exige que "ausente" y "presente con valor `undefined`" no se mezclen, así
 * que `group.personGender = undefined` no compila). `delete` es la única vía
 * válida para volver a "ausente" sobre una propiedad opcional.
 */
function setPersonGender(group: InternalGroup, value: PersonGender | undefined): void {
  if (value === undefined) {
    delete group.personGender;
  } else {
    group.personGender = value;
  }
}

/**
 * ADR-069 §6: dispara la inferencia de género sobre `group.canonicalValue`
 * en los dos puntos que el spec enumera (creación/fusión/edición manual de
 * `canonicalValue`, y la pasada de `finishSession`) — nunca sobre un tipo
 * distinto de `Person` ni sobre un grupo con elección del humano
 * (`personGenderUserSet`). Idempotente: misma tabla + mismo `canonicalValue`
 * ⇒ mismo resultado, así que llamarla de más (p. ej. en cada fusión, cambie
 * o no el `canonicalValue`) no tiene efecto observable extra. Devuelve
 * `true` solo si `personGender` cambió, para que el caller sume la clave a
 * su `changed` y decida si hace falta recalcular `replacementValue`.
 */
/**
 * Default de ADR-083 §4: el candidato de mayor `confidence`, con empate a
 * favor de `Regex`. Es la misma regla que `conflictWinnerIsNew` ya aplica al
 * crear el conflicto — y como `regex-engine` emite siempre `confidence: 1.0`,
 * coincide con la resolución automática. O sea: resolver sin elegir confirma
 * lo que el motor decidió, y no cambia ningún dato.
 */
function defaultCandidateType(conflict: Conflict): EntityType | undefined {
  let best: ConflictCandidate | undefined;
  for (const candidate of conflict.candidates) {
    if (best === undefined || candidate.confidence > best.confidence) {
      best = candidate;
      continue;
    }
    if (
      candidate.confidence === best.confidence &&
      candidate.source === DetectionSource.Regex &&
      best.source !== DetectionSource.Regex
    ) {
      best = candidate;
    }
  }
  return best?.entityType;
}

function inferGenderIfDue(group: InternalGroup): boolean {
  if (group.type !== EntityType.Person || group.personGenderUserSet) return false;
  const inferred = inferPersonGender(group.canonicalValue, GENDER_LEXICON);
  if (inferred === group.personGender) return false;
  setPersonGender(group, inferred);
  return true;
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
      typeCorrections: new Map(),
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

    // ADR-069 §6(b): red de convergencia — corre ANTES de la renumeración
    // canónica para que un género recién resuelto entre en la misma pasada
    // que ya recalcula índices y placeholders (spec §13 caso 37, mismo
    // criterio que el "no parpadeo" de ADR-028).
    this.inferGendersOnFinish(session);
    this.renumberGroupsCanonically(session);

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

  /**
   * Reabre una sesión existente (grupos/reglas/conflictos/ediciones
   * intactos) para una segunda pasada de detección (ADR-038 §2). Setea
   * `finished = false` (permite que `finishSession` vuelva a correr, incluida
   * su renumeración canónica — ADR-028 extendido) y los flags de auto-finish
   * según qué detector va a re-correr. Válido también sobre una sesión NO
   * finalizada (recuperación desde `Failed` a mitad de detección — ADR-038
   * §2, "mismo efecto sobre los flags"). Defensivo como `finishSession`:
   * sesión inexistente → warn + no-op.
   */
  reopenSession(documentId: string, options: ReopenSessionOptions): void {
    this.assertNotDisposed();
    this.assertInitialized();
    const session = this.sessions.get(documentId);
    if (!session) {
      this.ctx?.logger.warn("reopenSession() sin sesión activa.", { documentId });
      return;
    }
    session.finished = false;
    session.regexFinished = !options.expectRegex;
    session.nerFinished = !options.expectNer;
  }

  /**
   * Elimina del registro de sesión las ocurrencias que matchean `filter` y
   * sus `members` de los grupos afectados (ADR-038 §2, casos 24-25).
   * Recalcula `aliases`/frecuencias/`canonicalValue` de cada grupo afectado
   * (salvo `canonicalValue` editado manualmente, caso 18, que se conserva) y
   * `replacementValue` (depende de members vía `maskFormat`, ADR-029). Un
   * grupo que queda sin members se elimina (`ENTITY_GROUP_REMOVED`,
   * invariante `members.length >= 1`, `03_Data_Model.md` §9) aunque tuviera
   * ediciones. Conflictos cuyo grupo fue eliminado se descartan con
   * `CONFLICT_RESOLVED` (mode = modo efectivo del grupo antes de eliminarlo;
   * ver nota 10 del header sobre el alcance exacto de esta condición). No
   * renumera `indexInType` (eso ocurre en el próximo `finishSession`).
   */
  dropOccurrences(documentId: string, filter: DropOccurrencesFilter): void {
    this.assertNotDisposed();
    this.assertInitialized();
    if (filter.source === undefined && filter.pageIndices === undefined) {
      throw new InvalidInputError(
        "DropOccurrencesFilter debe especificar al menos un campo (source o pageIndices).",
        { documentId },
      );
    }
    const session = this.sessions.get(documentId);
    if (!session) {
      this.ctx?.logger.warn("dropOccurrences() sin sesión activa.", { documentId });
      return;
    }
    this.doDropOccurrences(session, filter);
  }

  private doDropOccurrences(session: Session, filter: DropOccurrencesFilter): void {
    const documentId = session.documentId;
    const toDrop = session.recordedOccurrences.filter((rec) => matchesDropFilter(rec, filter));
    if (toDrop.length === 0) return;

    const droppedIds = new Set(toDrop.map((rec) => rec.occurrenceId));
    const keptRecords = session.recordedOccurrences.filter(
      (rec) => !droppedIds.has(rec.occurrenceId),
    );
    session.recordedOccurrences.splice(0, session.recordedOccurrences.length, ...keptRecords);

    const affectedGroupIds = new Set(toDrop.map((rec) => rec.groupId));
    // Tipo del grupo antes de eliminarlo: capturado ANTES de mutar/eliminar,
    // para los conflictos que queden huérfanos. Desde ADR-083 §3 lo que
    // registra un conflicto resuelto es el TIPO con el que quedó clasificado
    // el grupo, no el modo de reemplazo.
    const typeBeforeRemoval = new Map<string, EntityType>();
    for (const groupId of affectedGroupIds) {
      const group = session.groups.get(groupId);
      if (group) typeBeforeRemoval.set(groupId, group.type);
    }

    // Grupos efectivamente eliminados EN ESTA llamada (no re-derivado de
    // "groupId ausente" en general: los conflictos overlap/disagree/
    // low_confidence nacen con resolved=true desde su creación —
    // emitOverlapOrDisagreeConflict/handleLowConfidence pasan resolved=true—,
    // así que "ya resuelto" no sirve como marca de "ya procesado por
    // dropOccurrences"; solo el conjunto preciso de grupos borrados AHORA
    // dispara CONFLICT_RESOLVED, evitando reprocesar el mismo conflicto en
    // llamadas futuras con un `mode` stale).
    const removedGroupIds = new Set<string>();

    for (const groupId of affectedGroupIds) {
      const group = session.groups.get(groupId);
      if (!group) continue;

      const remainingMembers = group.members.filter((m) => !droppedIds.has(m.occurrenceId));
      if (remainingMembers.length === 0) {
        session.groups.delete(groupId);
        removedGroupIds.add(groupId);
        this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_REMOVED, {
          documentId,
          groupId,
        });
        continue;
      }

      const remainingRecords = session.recordedOccurrences.filter((rec) => rec.groupId === groupId);
      // Caso 18 (§13): canonicalValue editado manualmente (ya no está entre
      // los aliases derivables) se conserva, igual que en doApplyGroupSplit.
      const preserveCanonical = !group.aliases.includes(group.canonicalValue);
      const previousCanonical = group.canonicalValue;
      group.members = remainingMembers;
      this.rebuildAliasBookkeeping(group, remainingRecords);
      if (preserveCanonical) {
        group.canonicalValue = previousCanonical;
      } else if (group.aliases.length > 0) {
        this.recomputeCanonicalValue(session, group);
      }

      const beforeReplacement = {
        replacementMode: group.replacementMode,
        replacementValue: group.replacementValue,
      };
      // ADR-029: el mask depende de los members remanentes, así que sin
      // edición manual se recalcula siempre (mismo criterio que
      // applyGroupMerge/doApplyGroupSplit) y emitReplacementChangeIfNeeded
      // decide si de verdad cambió. group.members ya refleja remainingMembers
      // (arriba): la escalera de ADR-057 usa el conjunto correcto. ADR-076
      // §4 fila 9: perder ocurrencias no es una decisión sobre el valor — un
      // replacementValue editado a mano se respeta igual, en los cuatro
      // modos (incluido mask: la guarda envuelve la llamada entera, sin
      // excepción por modo — ADR-076 §3).
      if (!group.replacementValueUserSet) {
        group.replacementValue = computeReplacementValue(
          group,
          session.seed,
          this.resolveMaskFormat(session, group),
        );
      }
      group.updatedAt = Date.now();

      const changed: (keyof EntityGroup)[] = ["members", "aliases", "updatedAt"];
      if (group.canonicalValue !== previousCanonical) changed.push("canonicalValue");
      changed.push(...this.emitReplacementChangeIfNeeded(session, group, beforeReplacement));
      this.emitGroupUpdated(session, group, changed);
    }

    // Nota 10 del header: un conflicto queda "stale" cuando su groupId fue
    // eliminado EN ESTA llamada (no "resolved", ver comentario arriba: los
    // conflictos overlap/disagree/low_confidence ya nacen resueltos). No hay
    // evento CONFLICT_REMOVED (ADR-038 §2): se re-emite CONFLICT_RESOLVED,
    // sobrescribiendo el `resolvedType` anterior.
    //
    // Solo se barren los conflictos cuyo GRUPO desapareció. Un conflicto cuyo
    // grupo sobrevive pero cuyos candidatos describían una ocurrencia borrada
    // NO es detectable —`ConflictCandidate` no tiene `occurrenceId` ni
    // `bbox`— y queda stale: ruido de UI inofensivo, sin corrupción ni fuga.
    // Errata de spec 2026-08-19 (`Grouping_Engine.md` §13 caso 25).
    for (const [conflictId, conflict] of session.conflicts) {
      if (!removedGroupIds.has(conflict.groupId)) continue;
      const entityType =
        typeBeforeRemoval.get(conflict.groupId) ?? conflict.candidates[0]?.entityType;
      if (entityType === undefined) continue;
      session.conflicts.set(conflictId, { ...conflict, resolved: true, resolvedType: entityType });
      this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.CONFLICT_RESOLVED, {
        documentId,
        conflictId,
        entityType,
      });
    }
  }

  /**
   * ADR-069 §6(b): sobre todos los grupos `Person` sin elección del humano,
   * re-corre la inferencia una última vez. Es la red que garantiza
   * convergencia pase lo que pase durante la sesión (fusiones, ediciones,
   * ocurrencias que llegan fuera de orden) — al cerrar, todo grupo `Person`
   * tiene el género que le corresponde según el `canonicalValue` final.
   * `inferGenderIfDue` ya filtra `type`/`personGenderUserSet`; recorrer TODOS
   * los grupos de la sesión (no solo los `Person`) es más simple que filtrar
   * dos veces y el chequeo interno es barato.
   */
  private inferGendersOnFinish(session: Session): void {
    for (const group of session.groups.values()) {
      if (!inferGenderIfDue(group)) continue;

      const beforeReplacement = {
        replacementMode: group.replacementMode,
        replacementValue: group.replacementValue,
      };
      if (
        (group.replacementMode === ReplacementMode.Placeholder ||
          group.replacementMode === ReplacementMode.Synthetic) &&
        !group.replacementValueUserSet // ADR-076 §4 fila 3
      ) {
        // ADR-071 §6: un género INFERIDO en finishSession repinta el token
        // también en modo synthetic, no solo en placeholder.
        group.replacementValue = computeReplacementValue(
          group,
          session.seed,
          this.resolveMaskFormat(session, group),
        );
      }
      group.updatedAt = Date.now();

      const changed: (keyof EntityGroup)[] = [
        "personGender",
        ...this.emitReplacementChangeIfNeeded(session, group, beforeReplacement),
        "updatedAt",
      ];
      this.emitGroupUpdated(session, group, changed);
    }
  }

  /**
   * Renumeración canónica de `indexInType` (ADR-028, una sola vez, antes de
   * `GROUPING_FINISHED`): reemplaza los índices provisionales asignados por
   * orden de llegada de `ENTITY_FOUND` (no-determinístico entre corridas —
   * motores en paralelo, NER por prioridad visible) por el orden de primera
   * aparición documental de cada grupo dentro de su `entityType`.
   */
  private renumberGroupsCanonically(session: Session): void {
    const groupsByType = new Map<EntityType, InternalGroup[]>();
    for (const group of session.groups.values()) {
      const list = groupsByType.get(group.type);
      if (list) list.push(group);
      else groupsByType.set(group.type, [group]);
    }

    for (const [type, groups] of groupsByType) {
      const ordered = groups
        .map((group) => ({ group, pos: this.firstDocumentPosition(session, group) }))
        .sort((a, b) => compareDocumentPosition(a.pos, b.pos));

      ordered.forEach(({ group }, i) => {
        const newIndex = i + 1;
        if (newIndex === group.indexInType) return;

        const beforeReplacement = {
          replacementMode: group.replacementMode,
          replacementValue: group.replacementValue,
        };
        group.indexInType = newIndex;
        // ADR-076 §4 fila 2 (el defecto que reporta este ADR): renumerar no
        // es una decisión sobre el valor. Antes de este ADR, la guarda de
        // arriba (`newIndex === group.indexInType`) era el único mecanismo
        // que hacía sobrevivir una edición manual, y solo por accidente —
        // acá se hace explícito.
        if (
          group.replacementMode === ReplacementMode.Placeholder &&
          !group.replacementValueUserSet
        ) {
          // ADR-057: la escalera usa group.members (sin cambios acá) contra
          // el indexInType YA actualizado arriba.
          group.replacementValue = computeReplacementValue(
            group,
            session.seed,
            // maskFormat no aplica: esta rama solo corre en modo placeholder.
            MASK_FORMAT_BY_TYPE[group.type],
          );
        }
        group.updatedAt = Date.now();

        const changed: (keyof EntityGroup)[] = [
          "indexInType",
          ...this.emitReplacementChangeIfNeeded(session, group, beforeReplacement),
          "updatedAt",
        ];
        this.emitGroupUpdated(session, group, changed);
      });

      // Tras la renumeración los índices del tipo son 1..N contiguos: el
      // contador de nextIndex() continúa en N (no en el máximo provisional).
      session.nextIndexByType.set(type, ordered.length);
    }
  }

  /**
   * Primera aparición documental de un grupo: mínimo entre sus ocurrencias
   * grabadas por (`pageIndex`, `bbox.y`, `bbox.x`) — desempate por
   * `normalizedValue` asc para determinismo total (ADR-028).
   */
  private firstDocumentPosition(session: Session, group: InternalGroup): DocumentPosition {
    let best: DocumentPosition | null = null;
    for (const rec of session.recordedOccurrences) {
      if (rec.groupId !== group.id) continue;
      const candidate = recordPosition(rec);
      if (!best || compareDocumentPosition(candidate, best) < 0) best = candidate;
    }
    // Invariante members.length >= 1 (Grouping_Engine.md §10): todo grupo
    // tiene al menos una ocurrencia grabada.
    return best ?? { pageIndex: 0, y: 0, x: 0, normalizedValue: group.canonicalValue };
  }

  /** ADR-029: resolución de `mask` para un grupo ya existente en la sesión. */
  private resolveMaskFormat(session: Session, group: InternalGroup): string {
    const records = session.recordedOccurrences.filter((rec) => rec.groupId === group.id);
    return resolveMaskFormatFromRecords(records, group.type);
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

      const { type, replacementMode, replacementValue, enabled, canonicalValue, personGender } =
        req.patch;
      const changed = new Set<keyof EntityGroup>();
      const beforeReplacement = {
        replacementMode: group.replacementMode,
        replacementValue: group.replacementValue,
      };

      // ADR-082 §2: va PRIMERO — el tipo gobierna el label del token, qué
      // regla de scope `type` aplica y si `personGender` tiene sentido, así
      // que las ramas de abajo tienen que ver el tipo nuevo. Un `type` igual
      // al vigente es no-op (no entra en `changed`).
      if (type !== undefined && type !== group.type) {
        for (const key of this.changeGroupType(session, group, type)) changed.add(key);
      }

      if (canonicalValue !== undefined) {
        group.canonicalValue = canonicalValue;
        changed.add("canonicalValue");
      }

      // ADR-069 §4: "f"/"m" escriben el campo, "neutral" lo borra, y los tres
      // marcan la elección como del humano. Sobre un grupo que no es Person
      // se ignora con warn y no toca replacementValue (ADR-060 §2).
      if (personGender !== undefined) {
        if (group.type !== EntityType.Person) {
          this.ctx?.logger.warn(
            "patch.personGender sobre un grupo que no es Person; se ignora (ADR-069 §4).",
            { documentId: req.documentId, groupId: group.id, type: group.type },
          );
        } else {
          const nextGender: PersonGender | undefined =
            personGender === "neutral" ? undefined : personGender;
          if (nextGender !== group.personGender) {
            setPersonGender(group, nextGender);
            changed.add("personGender");
          }
          group.personGenderUserSet = true;
        }
      }

      // ADR-069 §6(a): edición manual de canonicalValue re-infiere género en
      // un Person sin elección del humano. Si el patch.personGender de arriba
      // vino en la misma request, ya marcó personGenderUserSet=true y
      // inferGenderIfDue queda en no-op — la elección explícita siempre gana.
      if (canonicalValue !== undefined && inferGenderIfDue(group)) {
        changed.add("personGender");
      }

      if (enabled !== undefined) {
        group.enabled = enabled;
        changed.add("enabled");
      }

      if (replacementMode !== undefined) {
        group.replacementMode = replacementMode;
        group.replacementMode = resolveMode(group, session.rules);
        if (replacementValue === undefined) {
          // ADR-057 §7: solo se llega acá cuando el patch NO trae
          // replacementValue explícito — la edición manual del usuario nunca
          // pasa por la escalera. ADR-076 §3/§4 fila 4: el usuario tocó el
          // selector de modo — el valor atado al modo anterior ya no aplica,
          // así que esto recalcula y apaga el flag sin importar su estado
          // previo (es también la vía de vuelta al valor automático, §5).
          group.replacementValue = computeReplacementValue(
            group,
            session.seed,
            this.resolveMaskFormat(session, group),
          );
          group.replacementValueUserSet = false;
        }
      }

      if (replacementValue !== undefined) {
        // ADR-076 §2: el único canal por el que el usuario escribe un valor.
        // "" cuenta como edición (es lo que corresponde para redact) — no
        // hay chequeo de longitud. Si el patch también trae replacementMode,
        // la rama de arriba ya corrió y no tocó replacementValue (guardada
        // por `replacementValue === undefined`): la que gana es la que el
        // usuario escribió (§2, segunda precisión).
        group.replacementValue = replacementValue;
        group.replacementValueUserSet = true;
      } else if (
        replacementMode === undefined &&
        changed.has("personGender") &&
        !group.replacementValueUserSet && // ADR-076 §4 fila 5
        (group.replacementMode === ReplacementMode.Placeholder ||
          group.replacementMode === ReplacementMode.Synthetic)
      ) {
        // El género cambió (explícito o inferido por el trigger de arriba) y
        // ninguna otra rama recalculó replacementValue todavía: el label de
        // la escalera (labels.ts, resolveLabelSet) depende de personGender,
        // y desde ADR-071 §5/§6 el sintetizador también filtra por género —
        // atado antes solo a placeholder (ADR-071 §6).
        group.replacementValue = computeReplacementValue(
          group,
          session.seed,
          this.resolveMaskFormat(session, group),
        );
      }

      for (const key of this.emitReplacementChangeIfNeeded(session, group, beforeReplacement)) {
        changed.add(key);
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
      // ADR-085 §7: pasaron a ser un solo grupo, así que el sobreviviente
      // acepta los tipos que aceptaba cualquiera de los dos.
      for (const t of source.absorbedTypes) target.absorbedTypes.add(t);
      target.members.push(...source.members);

      // Reasignar ANTES de recalcular canonicalValue/replacementValue: ambos
      // se derivan de session.recordedOccurrences, que debe reflejar ya la
      // membresía fusionada (incluye resolveMaskFormat, ADR-029).
      for (const rec of session.recordedOccurrences) {
        if (rec.groupId === sourceGroupId) rec.groupId = targetGroupId;
      }

      const beforeCanonical = target.canonicalValue;
      if (target.aliases.includes(target.canonicalValue)) {
        this.recomputeCanonicalValue(session, target);
      }

      // ADR-069 §6(a): "al fusionar" — trigger propio, no condicionado a que
      // canonicalValue haya cambiado de verdad. `target` es el grupo que
      // sobrevive (su identidad no cambia con el merge): su personGender y
      // personGenderUserSet ya vienen de él solo — no se copian del `source`
      // que se elimina abajo (ADR-069 §5, "hereda... del grupo que sobrevive").
      const genderChanged = inferGenderIfDue(target);

      const beforeReplacement = {
        replacementMode: target.replacementMode,
        replacementValue: target.replacementValue,
      };
      // ADR-029: el replacementValue (mask, y por índice placeholder/
      // synthetic) depende de la membresía fusionada — se recalcula siempre
      // tras un merge, no solo cuando cambia el índice. target.members ya
      // incluye los de `source` (arriba): la escalera de ADR-057 ve el peor
      // caso del grupo fusionado completo, ya con el personGender resuelto
      // arriba si cambió. ADR-076 §4 fila 6: el grupo sobreviviente conserva
      // su identidad —id, modo, personGenderUserSet (ADR-069 §5)— y también
      // su replacementValueUserSet; `source` se elimina sin que su propio
      // flag importe.
      if (!target.replacementValueUserSet) {
        target.replacementValue = computeReplacementValue(
          target,
          session.seed,
          this.resolveMaskFormat(session, target),
        );
      }
      target.updatedAt = Date.now();

      session.groups.delete(sourceGroupId);

      const changed: (keyof EntityGroup)[] = ["members", "aliases", "updatedAt", "indexInType"];
      if (target.canonicalValue !== beforeCanonical) changed.push("canonicalValue");
      if (genderChanged) changed.push("personGender");
      changed.push(...this.emitReplacementChangeIfNeeded(session, target, beforeReplacement));

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
      // §13 caso 6: hereda el modo del grupo original, incluido uno puesto a
      // mano. `resolveMode` corre igual más abajo, así que una regla de
      // grupo/tipo/global sigue ganando sobre lo heredado con la precedencia
      // de siempre — lo único que cambia es el piso: antes era `placeholder`
      // fijo, y un `synthetic` elegido a mano se perdía al dividir. La
      // fusión ya preservaba el modo del sobreviviente; esto deja las dos
      // operaciones con el mismo criterio.
      replacementMode: group.replacementMode,
      replacementValue: "",
      indexInType: newIndex,
      enabled: true,
      aliases: [],
      createdAt: now,
      updatedAt: now,
      personGenderUserSet: false,
      // ADR-076 §4 fila 1/7: un grupo recién creado no tiene edición que
      // preservar.
      replacementValueUserSet: false,
      // ADR-085 §7: copia, no la misma referencia — es la misma
      // clasificación partida en dos, pero cada mitad evoluciona sola.
      absorbedTypes: new Set(group.absorbedTypes),
      normalizedValues: new Set(),
      aliasFrequency: new Map(),
      aliasFirstSeen: new Map(),
    };
    this.rebuildAliasBookkeeping(created, movedRecords);
    if (created.aliases.length > 0) this.recomputeCanonicalValue(session, created);
    // ADR-069 §6(a): "al crearlo" — un split crea un InternalGroup nuevo, sin
    // elección del humano todavía, igual que createGroup.
    inferGenderIfDue(created);
    const createdMode = resolveMode(created, session.rules);
    created.replacementMode = createdMode;
    // ADR-057: created.members ya es movedMembers (arriba) — la escalera ve
    // exactamente los members del grupo nuevo.
    created.replacementValue = computeReplacementValue(
      created,
      session.seed,
      // movedRecords, no session.recordedOccurrences: la reasignación de
      // groupId a `created.id` recién pasa más abajo.
      resolveMaskFormatFromRecords(movedRecords, created.type),
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

    const beforeReplacement = {
      replacementMode: group.replacementMode,
      replacementValue: group.replacementValue,
    };
    // ADR-029: el mask depende de los members remanentes tras la división.
    // Se usa `remainingRecords` directo (no session.recordedOccurrences): la
    // reasignación de groupId a `created.id` para los movidos pasa recién
    // abajo. group.members ya es remainingMembers (arriba): la escalera de
    // ADR-057 ve el grupo original ya reducido. ADR-076 §4 fila 8: `group`
    // es el mismo grupo de antes, con menos members — su valor manual, si
    // tiene uno, se respeta igual que el de `dropOccurrences` (fila 9).
    if (!group.replacementValueUserSet) {
      group.replacementValue = computeReplacementValue(
        group,
        session.seed,
        resolveMaskFormatFromRecords(remainingRecords, group.type),
      );
    }
    group.updatedAt = now;

    for (const rec of session.recordedOccurrences) {
      if (idsToMove.has(rec.occurrenceId)) rec.groupId = created.id;
    }

    const changed: (keyof EntityGroup)[] = [
      "members",
      "aliases",
      "canonicalValue",
      "updatedAt",
      ...this.emitReplacementChangeIfNeeded(session, group, beforeReplacement),
    ];
    this.emitGroupUpdated(session, group, changed);
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

      // ADR-083 §1/§4: el usuario elige el TIPO. Ausente = el default, que es
      // el candidato de mayor confidence (empate a favor de Regex). Como
      // `regex-engine` emite siempre `confidence: 1.0`, ese default coincide
      // con la resolución automática que el motor ya tomó al crear el
      // conflicto — o sea que resolver sin elegir es confirmar, y no cambia
      // ningún dato.
      const chosenType = req.entityType ?? defaultCandidateType(conflict);
      if (chosenType === undefined) {
        // Conflicto sin candidatos: no debería existir (siempre se construye
        // con al menos dos), pero un `resolvedType` inventado sería peor que
        // rechazar.
        throw new GroupingInvalidPatchError("El conflicto no tiene candidatos con tipo.", {
          documentId: req.documentId,
          conflictId: req.conflictId,
        });
      }
      const resolved: Conflict = { ...conflict, resolved: true, resolvedType: chosenType };
      session.conflicts.set(conflict.id, resolved);

      const group = session.groups.get(conflict.groupId);
      if (group && chosenType !== group.type) {
        // ADR-083 §2: aplicar = reclasificar por la MISMA vía que
        // `updateGroup({ type })` (ADR-082 §2), no un camino paralelo.
        const beforeReplacement = {
          replacementMode: group.replacementMode,
          replacementValue: group.replacementValue,
        };
        const typeChanges = this.changeGroupType(session, group, chosenType);
        group.updatedAt = Date.now();

        const changed: (keyof EntityGroup)[] = [
          ...typeChanges,
          ...this.emitReplacementChangeIfNeeded(session, group, beforeReplacement),
          "updatedAt",
        ];
        this.emitGroupUpdated(session, group, changed);
      }

      this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.CONFLICT_RESOLVED, {
        documentId: req.documentId,
        conflictId: conflict.id,
        entityType: chosenType,
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

    // Caso 23 (§13, ADR-038 §3): invariante permanente de dedup por
    // identidad — no exclusivo de sesiones reabiertas. Se descarta en
    // silencio (sin eventos, sin tocar frecuencias/aliases) toda ocurrencia
    // cuya (entityType, pageIndex, bbox, normalizedValue) ya está registrada.
    if (this.isDuplicateIdentity(session, occurrence)) {
      this.ctx.logger.debug(
        "ENTITY_FOUND con identidad duplicada; se descarta en silencio (ADR-038 §3).",
        {
          documentId: session.documentId,
          occurrenceId: occurrence.id,
          entityType: occurrence.entityType,
          pageIndex: occurrence.pageIndex,
        },
      );
      return;
    }

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
      candidateGroup.type,
    );
    this.emitConflictDetected(session, conflict);
  }

  /**
   * Identidad (entityType, pageIndex, bbox, normalizedValue) ya registrada en
   * la sesión (ADR-038 §3). Solo compara contra ocurrencias YA agrupadas
   * (`recordedOccurrences`); las descartadas por low_confidence o por perder
   * un conflicto overlap/disagree nunca se registran (nota 6/7 del header),
   * así que un duplicado de esas vuelve a pasar por ese mismo camino.
   */
  private isDuplicateIdentity(session: Session, occurrence: Occurrence): boolean {
    return session.recordedOccurrences.some(
      (rec) =>
        rec.entityType === occurrence.entityType &&
        rec.pageIndex === occurrence.pageIndex &&
        rec.normalizedValue === occurrence.normalizedValue &&
        bboxEquals(rec.bbox, occurrence.bbox),
    );
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
      group?.type,
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
      // ADR-085 §1(a): un grupo reclasificado sigue aceptando el tipo con el
      // que el detector lo emite — que no aprende y va a seguir diciendo el
      // original en cada `reanalyze`. Sin esto, la ocurrencia nueva del mismo
      // valor crea un grupo paralelo y el mismo texto sale del export con dos
      // tokens distintos (escenario B de ADR-082, Consecuencias).
      //
      // El `||` cortocircuita: el `Set.has` solo corre para los grupos cuyo
      // tipo no matcheó. Medido en 0,19 ms sobre 5000 ocurrencias × 50 grupos.
      if (group.type === occurrence.entityType || group.absorbedTypes.has(occurrence.entityType)) {
        candidates.push(group);
      }
    }
    for (const group of candidates) {
      if (group.normalizedValues.has(occurrence.normalizedValue)) return group;
    }
    if (!FUZZY_MATCHING_TYPES.has(occurrence.entityType)) return null;
    for (const group of candidates) {
      for (const normalizedAlias of group.normalizedValues) {
        if (levenshteinNormalized(occurrence.normalizedValue, normalizedAlias) >= threshold) {
          return group;
        }
      }
    }
    return null;
  }

  /**
   * Memoria de reclasificación (ADR-085 §3): exacto por `normalizedValue`, y
   * si falla, un pase difuso **solo** para los tipos de texto libre.
   *
   * El guard va sobre `occurrence.entityType` —lo que emite el detector— y no
   * sobre el tipo destino de la corrección: el riesgo que ADR-073 identificó
   * (dos CUIT que difieren en un dígito dan 0.909 sobre un umbral de 0.88)
   * vive en el VALOR que se compara, y ese valor es el que el detector
   * clasificó. Mismo criterio, misma constante y mismo umbral que el pase
   * difuso de `findMatchingGroup`.
   */
  private correctedTypeFor(session: Session, occurrence: Occurrence): EntityType | undefined {
    if (session.typeCorrections.size === 0) return undefined;

    const exact = session.typeCorrections.get(occurrence.normalizedValue);
    if (exact !== undefined) return exact.correctedType;

    if (!FUZZY_MATCHING_TYPES.has(occurrence.entityType)) return undefined;
    const threshold = this.ctx?.config.grouping.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    for (const [normalizedValue, correction] of session.typeCorrections) {
      // El guard es SIMÉTRICO: además del tipo entrante, el tipo con el que el
      // detector había clasificado el valor corregido tiene que tolerar el
      // difuso. Una corrección sobre un teléfono no se hereda por parecido a
      // un nombre — es la misma razón de ADR-073, aplicada a los dos lados de
      // la comparación.
      if (!FUZZY_MATCHING_TYPES.has(correction.detectorType)) continue;
      if (levenshteinNormalized(occurrence.normalizedValue, normalizedValue) >= threshold) {
        return correction.correctedType;
      }
    }
    return undefined;
  }

  private createGroup(session: Session, occurrence: Occurrence): InternalGroup {
    const now = Date.now();
    // ADR-085 §1(b)/§2: único punto donde se consulta la memoria de
    // reclasificación. Se llega acá solo si `findMatchingGroup` no encontró
    // nada, o sea una vez por grupo creado — no por ocurrencia.
    const effectiveType = this.correctedTypeFor(session, occurrence) ?? occurrence.entityType;
    const indexInType = this.nextIndex(session, effectiveType);
    const group: InternalGroup = {
      id: crypto.randomUUID(),
      type: effectiveType,
      canonicalValue: occurrence.value,
      members: [toOccurrenceRef(occurrence)],
      replacementMode: ReplacementMode.Placeholder,
      replacementValue: "",
      indexInType,
      enabled: true,
      aliases: [occurrence.value],
      createdAt: now,
      updatedAt: now,
      personGenderUserSet: false,
      // ADR-076 §4 fila 1/7: un grupo recién creado no tiene edición que
      // preservar.
      replacementValueUserSet: false,
      // ADR-085 §2: se siembra con LOS DOS tipos, así las ocurrencias 2..N del
      // mismo valor las resuelve `absorbedTypes` y el mapa no se vuelve a
      // tocar para ese valor en todo el documento.
      absorbedTypes: new Set([occurrence.entityType, effectiveType]),
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
    // ADR-069 §6(a): "al crearlo" — antes de resolver el modo/valor, para que
    // un placeholder recién creado ya nazca con el label de género correcto.
    inferGenderIfDue(group);
    group.replacementMode = resolveMode(group, session.rules);
    // ADR-057: group.members ya es [toOccurrenceRef(occurrence)] (única
    // ocurrencia del grupo recién creado) — la escalera arranca desde ahí.
    group.replacementValue = computeReplacementValue(
      group,
      session.seed,
      // Única ocurrencia en el grupo recién creado: no hace falta pasar por
      // session.recordedOccurrences (recordOccurrence() corre después).
      occurrence.maskFormat ?? MASK_FORMAT_BY_TYPE[occurrence.entityType],
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

  /**
   * Reclasificación de un grupo (ADR-082 §2). El orden importa: índice → modo
   * efectivo → **género** → valor. El género va ANTES que el valor, a
   * diferencia de lo que decía la primera redacción de ADR-082 §2: al entrar a
   * `Person`, el label del placeholder depende del género recién inferido
   * (`[MUJER 01]` vs `[PERSONA 01]`, ADR-060 §3), así que calcular el valor
   * primero lo dejaría con el género viejo. Los `recordedOccurrences` **no**
   * se tocan (§3).
   *
   * No fusiona con un grupo existente del tipo destino aunque compartan
   * `normalizedValue` (ADR-082 §7): fusionar es `GROUP_MERGE_REQUESTED`, y
   * hacerlo acá borraría un grupo sin que el usuario lo pida.
   */
  private changeGroupType(
    session: Session,
    group: InternalGroup,
    nextType: EntityType,
  ): ReadonlyArray<keyof EntityGroup> {
    const previousMode = group.replacementMode;
    const previousType = group.type;
    const previousGender = group.personGender;
    group.type = nextType;

    // ADR-085 §1(a)/§4: el grupo pasa a aceptar los dos tipos, así una
    // ocurrencia futura que el detector emita con el original cae acá.
    group.absorbedTypes.add(previousType);
    group.absorbedTypes.add(nextType);

    // ADR-085 §1(b)/§5: se registran TODOS los `normalizedValues` del grupo,
    // no solo el canónico — el grupo ES sus alias. Gana la última elección: un
    // `set` sobre una clave existente la sobrescribe, sin historial.
    for (const normalizedValue of group.normalizedValues) {
      session.typeCorrections.set(normalizedValue, {
        correctedType: nextType,
        detectorType: previousType,
      });
    }

    // Índice nuevo en la secuencia del tipo destino. El índice viejo queda
    // como hueco a propósito: compactarlo acá duplicaría
    // `renumberGroupsCanonically` (ADR-028) con otro criterio, y esa es la
    // que corre en el próximo `finishSession`.
    group.indexInType = this.nextIndex(session, nextType);

    // El tipo destino puede tener otra regla de scope `type`.
    group.replacementMode = resolveMode(group, session.rules);

    // ADR-082 §2 paso 4: el género solo existe para Person.
    if (nextType !== EntityType.Person) {
      setPersonGender(group, undefined);
      group.personGenderUserSet = false;
    } else {
      inferGenderIfDue(group);
    }

    // ADR-076 §3, ratificado por ADR-082 §4: una edición manual del valor
    // sobrevive al cambio de tipo. La salvedad sale sola — si el tipo nuevo
    // cambió el modo EFECTIVO, es la regla de ADR-076 §4 fila 4 y el valor se
    // recalcula apagando el flag, sin excepción nueva.
    const effectiveModeChanged = group.replacementMode !== previousMode;
    if (!group.replacementValueUserSet || effectiveModeChanged) {
      group.replacementValue = computeReplacementValue(
        group,
        session.seed,
        this.resolveMaskFormat(session, group),
      );
      if (effectiveModeChanged) group.replacementValueUserSet = false;
    }

    // ADR-082 §3: `SessionOccurrenceRecord.entityType` **NO** sigue al grupo.
    // Es la huella de lo que el DETECTOR produjo, y se compara contra lo que
    // el detector vuelve a emitir en un `reanalyze` — que no sabe nada de la
    // corrección del usuario. Si el registro siguiera al tipo nuevo, el dedup
    // por identidad (`isDuplicateIdentity`, que corre ANTES que la detección
    // de conflictos) dejaría de reconocer la ocurrencia re-emitida, y esta
    // caería en `findOverlapConflict` contra su propio grupo, generando un
    // conflicto espurio del grupo consigo mismo.

    // ADR-082 §5: los campos que de verdad cambiaron, para que el caller los
    // ponga en `ENTITY_GROUP_UPDATED.changes`. `personGender` es el que se
    // escapaba: `changeGroupType` lo borra al salir de Person y lo re-infiere
    // al entrar, y ningún caller lo reportaba — la UI nunca se enteraba.
    const changed: (keyof EntityGroup)[] = ["type", "indexInType"];
    if (group.replacementMode !== previousMode) changed.push("replacementMode");
    if (group.personGender !== previousGender) changed.push("personGender");
    return changed;
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
      const beforeReplacement = {
        replacementMode: group.replacementMode,
        replacementValue: group.replacementValue,
      };
      // ADR-076 §4 fila 11: ya corre solo cuando el modo EFECTIVO cambió —
      // exactamente la condición de §3 ("el corte es si el modo cambió"),
      // así que no hace falta mirar el flag para decidir si entra; solo
      // apagarlo una vez adentro. Es el único caso donde un valor manual se
      // pierde sin que el usuario haya tocado ese grupo (§6) — correcto por
      // §3, documentado porque puede sorprender.
      const effectiveMode = resolveMode(group, session.rules);
      if (effectiveMode === beforeReplacement.replacementMode) continue;

      group.replacementMode = effectiveMode;
      group.replacementValue = computeReplacementValue(
        group,
        session.seed,
        this.resolveMaskFormat(session, group),
      );
      group.replacementValueUserSet = false;
      group.updatedAt = Date.now();

      const changed: (keyof EntityGroup)[] = [
        ...this.emitReplacementChangeIfNeeded(session, group, beforeReplacement),
        "updatedAt",
      ];
      this.emitGroupUpdated(session, group, changed);
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
      // exactOptionalPropertyTypes: no asignar `undefined` explícito a un
      // campo opcional — se omite la clave si la Occurrence no trae maskFormat.
      ...(occurrence.maskFormat !== undefined ? { maskFormat: occurrence.maskFormat } : {}),
    });
  }

  private buildConflict(
    session: Session,
    groupId: string,
    reason: ConflictReason,
    candidates: ReadonlyArray<ConflictCandidate>,
    resolved: boolean,
    // ADR-083 §3: un conflicto resuelto registra el TIPO con el que quedó
    // clasificado el grupo, no el modo de reemplazo.
    resolvedType: EntityType | undefined,
  ): Conflict {
    const conflict: Conflict =
      resolved && resolvedType !== undefined
        ? { id: crypto.randomUUID(), groupId, reason, candidates, resolved, resolvedType }
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

  /**
   * Único punto de emisión de `GROUP_REPLACEMENT_CHANGED` (spec §7: "cuando
   * replacementMode o replacementValue cambian" — incondicional a la causa de
   * la mutación; Render lo consume para el delta render, `Render_Engine.md`
   * §8). Compara el estado del grupo ANTES de la mutación contra su estado
   * actual: si `replacementMode` o `replacementValue` difieren, emite el
   * evento y devuelve las claves que cambiaron, para que el caller las sume
   * al `changed` de `ENTITY_GROUP_UPDATED` que esté armando. Todos los
   * caminos de mutación (`applyGroupUpdate`, `applyGroupMerge`,
   * `doApplyGroupSplit`, recompute por reglas, renumeración de ADR-028) pasan
   * por acá — un solo punto de verdad.
   */
  private emitReplacementChangeIfNeeded(
    session: Session,
    group: InternalGroup,
    before: Pick<InternalGroup, "replacementMode" | "replacementValue">,
  ): ReadonlyArray<keyof EntityGroup> {
    const changed: (keyof EntityGroup)[] = [];
    if (group.replacementMode !== before.replacementMode) changed.push("replacementMode");
    if (group.replacementValue !== before.replacementValue) changed.push("replacementValue");
    if (changed.length === 0) return changed;

    this.ctx?.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, {
      documentId: session.documentId,
      groupId: group.id,
      mode: group.replacementMode,
      value: group.replacementValue,
    });
    return changed;
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
