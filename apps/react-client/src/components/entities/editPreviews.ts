/**
 * `editPreviews.ts` — lo que muestran los diálogos de Fusionar, Dividir y
 * Cambiar tipo antes de confirmar (ADR-169 §10, ADR-170 §2).
 *
 * **Los números los calcula el Core** (`actions.previewEdit`, un simulacro
 * sobre una copia de la sesión con el mismo código que el pedido real). Acá
 * solo se arma el pedido y se da forma al texto: la UI no reimplementa el
 * `nextIndex`, la frecuencia del canónico ni el token (U-3).
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import {
  EntityType,
  ReplacementMode,
  type EditPreview,
  type EditPreviewGroup,
  type EditPreviewRequest,
  type EntityGroup,
} from "@anonly/anonymization-core";

import {
  describeEntityNumber,
  ENTITY_TYPE_LABEL,
  ENTITY_TYPE_SINGULAR,
  formatIndexInType,
} from "./entityTypeLabels.js";

function appearances(count: number): string {
  return count === 1 ? "1 aparición" : `${count} apariciones`;
}

/** "Persona N.º 03 · 2 apariciones": la línea que identifica a una entidad en los diálogos. */
export function describeEntityLine(group: {
  readonly type: EntityType;
  readonly indexInType: number;
  readonly memberCount: number;
}): string {
  return `${describeEntityNumber(group.type, group.indexInType)} · ${appearances(group.memberCount)}`;
}

/**
 * El valor de reemplazo como se muestra en una vista previa. `redact` no
 * tiene texto (su valor es `""`): se nombra el efecto.
 */
export function displayReplacement(preview: {
  readonly replacementMode: ReplacementMode;
  readonly replacementValue: string;
}): string {
  if (preview.replacementMode === ReplacementMode.Redact || preview.replacementValue === "") {
    return "Tapado con negro";
  }
  return preview.replacementValue;
}

// ─── Fusionar ───────────────────────────────────────────────────────────────

/**
 * ADR-170 §2: el sobreviviente conserva el `id` de `targetGroupIds[0]` y el
 * **menor** `indexInType` de todos. La UI pone primero al elegido de menor
 * `indexInType`, para que el `id` que queda sea el del número que queda.
 */
export function orderMergeTargets(selected: ReadonlyArray<EntityGroup>): ReadonlyArray<string> {
  return [...selected]
    .sort((a, b) => a.indexInType - b.indexInType || a.id.localeCompare(b.id))
    .map((group) => group.id);
}

export function mergePreviewRequest(
  sourceGroupId: string,
  selected: ReadonlyArray<EntityGroup>,
): EditPreviewRequest | null {
  if (selected.length === 0) return null;
  return { kind: "merge", sourceGroupId, targetGroupIds: orderMergeTargets(selected) };
}

/** El único grupo que devuelve una fusión: el que sobrevive. */
export function mergeResult(preview: EditPreview | null): EditPreviewGroup | null {
  return preview?.groups[0] ?? null;
}

/** El botón dice cuántas entidades quedan en una (ancho mínimo fijo, UX-10). */
export function mergeButtonLabel(selectedCount: number): string {
  return selectedCount === 0 ? "Fusionar" : `Fusionar ${selectedCount + 1} entidades`;
}

/** Toast de confirmación: "Fusionaste 3 entidades en «X» · Persona N.º 01 · 4 apariciones". */
export function mergeToastText(
  entityCount: number,
  result: EditPreviewGroup,
): { readonly title: string; readonly description: string } {
  return {
    title: `Fusionaste ${entityCount} entidades en «${result.canonicalValue}»`,
    description: describeEntityLine(result),
  };
}

// ─── Dividir ────────────────────────────────────────────────────────────────

export function splitPreviewRequest(
  group: EntityGroup,
  selectedOccurrenceIds: ReadonlyArray<string>,
): EditPreviewRequest | null {
  if (selectedOccurrenceIds.length === 0) return null;
  if (selectedOccurrenceIds.length >= group.members.length) return null;
  return { kind: "split", groupId: group.id, occurrenceIds: selectedOccurrenceIds };
}

export interface SplitSummary {
  /** "N.º 02": dónde se quedan las no marcadas. */
  readonly stayLabel: string;
  readonly stayCount: number;
  /** "Persona N.º 06" (del Core) o solo el tipo si todavía no hay vista previa. */
  readonly moveLabel: string;
  readonly moveCount: number;
}

/**
 * Las dos tarjetas "Se quedan en N.º 02" → "Pasan a una nueva: Persona N.º
 * NN". Los conteos salen de la selección; el número nuevo, del Core (el
 * segundo grupo de un split es el nuevo, `groupId: null`).
 */
export function summarizeSplit(
  group: EntityGroup,
  selectedCount: number,
  preview: EditPreview | null,
): SplitSummary {
  const created = preview?.groups.find((candidate) => candidate.groupId === null);
  return {
    stayLabel: `N.º ${formatIndexInType(group.indexInType)}`,
    stayCount: Math.max(0, group.members.length - selectedCount),
    moveLabel:
      created !== undefined
        ? describeEntityNumber(created.type, created.indexInType)
        : `${ENTITY_TYPE_SINGULAR[group.type]} nueva`,
    moveCount: selectedCount,
  };
}

/** La nota o el error, en la misma ranura (UX-10). */
export function splitSlotMessage(
  group: EntityGroup,
  selectedCount: number,
): { readonly kind: "note" | "error"; readonly text: string } {
  if (selectedCount > 0 && selectedCount >= group.members.length) {
    return {
      kind: "error",
      text: `Tiene que quedar al menos una aparición en N.º ${formatIndexInType(group.indexInType)}.`,
    };
  }
  return {
    kind: "note",
    text: "La entidad nueva toma el próximo número libre y mantiene el modo de reemplazo de la original.",
  };
}

/** Toast: "Dividiste «X» · 2 apariciones pasaron a Persona N.º 06". */
export function splitToastText(
  canonicalValue: string,
  movedCount: number,
  created: EditPreviewGroup | undefined,
): { readonly title: string; readonly description: string } {
  const verb = movedCount === 1 ? "pasó" : "pasaron";
  const where =
    created !== undefined
      ? describeEntityNumber(created.type, created.indexInType)
      : "una entidad nueva";
  return {
    title: `Dividiste «${canonicalValue}»`,
    description: `${appearances(movedCount)} ${verb} a ${where}`,
  };
}

// ─── Cambiar tipo ───────────────────────────────────────────────────────────

export function typePreviewRequest(
  group: EntityGroup,
  type: EntityType,
): EditPreviewRequest | null {
  if (type === group.type) return null;
  return { kind: "type", groupId: group.id, type };
}

export interface TypeChangeSummary {
  readonly before: string;
  readonly after: string;
  /** "Pasa a Organizaciones con el N.º 03, el próximo libre." */
  readonly note: string;
  /** ADR-169 §10: al dejar de ser Persona, el género se borra. */
  readonly dropsGender: boolean;
}

export function summarizeTypeChange(
  group: EntityGroup,
  preview: EditPreview | null,
): TypeChangeSummary | null {
  const next = preview?.groups[0];
  if (next === undefined) return null;
  return {
    before: displayReplacement(group),
    after: displayReplacement(next),
    note: `Pasa a ${ENTITY_TYPE_LABEL[next.type]} con el N.º ${formatIndexInType(
      next.indexInType,
    )}, el próximo libre.`,
    dropsGender: group.type === EntityType.Person && next.type !== EntityType.Person,
  };
}

/** Toast: "Cambiaste el tipo de «X» · Ahora es Organización N.º 03". */
export function typeChangeToastText(
  canonicalValue: string,
  next: EditPreviewGroup | undefined,
): { readonly title: string; readonly description?: string } {
  return {
    title: `Cambiaste el tipo de «${canonicalValue}»`,
    ...(next !== undefined
      ? { description: `Ahora es ${describeEntityNumber(next.type, next.indexInType)}` }
      : {}),
  };
}
