/**
 * `formatConflict.ts` — el panel de conflicto **entre dos formatos** (ADR-222,
 * ADR-229 §6, `Components.md` §13b.8).
 *
 * Es el panel de conflicto de siempre (ADR-083: se elige el tipo) con tres
 * agregados: el título dice que dos formatos reconocen el mismo texto; cada
 * opción nombra su tipo, su formato y de dónde sale (ADR-226 §5); y un texto
 * avisa que **nació resuelto** —cuál ganó y por qué— y que no frena la
 * exportación (ADR-222 §3 y §4).
 *
 * Quién gana por defecto lo decide Grouping (ADR-222 §3): el formato del usuario
 * sobre el base; con el mismo origen, el de valor más largo; con el mismo largo,
 * el que ya estaba. Acá se **replica** solo para decir en el texto cuál ganó y
 * por qué; el tipo vigente sale siempre de `Conflict.resolvedType` y del grupo.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import {
  ConflictReason,
  type Conflict,
  type ConflictCandidate,
  type EntityTypeId,
} from "@anonly/anonymization-core";

import type { DetectionState } from "../../store/detectionState.js";
import { referenceFormat, type FormatReference } from "../entities/formatNames.js";

import { candidateTypes } from "./conflictResolution.js";

export const FORMAT_CONFLICT_TITLE = "Dos formatos reconocen el mismo texto";

/** Cuando el formato del usuario le ganó al del catálogo (`Conflicto.dc.html`). */
export const FORMAT_CONFLICT_USER_WINS =
  "Se resolvió solo: tu formato gana sobre el del catálogo. No frena la exportación; cambialo si corresponde.";

/** Con el mismo origen gana el que reconoce más texto (ADR-222 §3). */
export const FORMAT_CONFLICT_LONGEST_WINS =
  "Se resolvió solo: gana el formato que reconoce el texto más largo. No frena la exportación; cambialo si corresponde.";

export const FORMAT_ORIGIN_LABEL: Readonly<Record<FormatReference["origin"], string>> = {
  user: "tuyo",
  catalog: "del catálogo",
};

/** Dos o más candidatos salieron de un formato (el resto, p. ej. el modelo, no tiene `formatId`). */
export function isFormatConflict(conflict: Conflict): boolean {
  return (
    conflict.reason === ConflictReason.Overlap &&
    conflict.candidates.filter((candidate) => candidate.formatId !== undefined).length >= 2
  );
}

export interface FormatConflictOption {
  readonly type: EntityTypeId;
  /** `null` si el candidato de ese tipo no salió de un formato (lo detectó el modelo). */
  readonly format: FormatReference | null;
}

/** Una opción por tipo, en el orden de siempre del panel (`candidateTypes`). */
export function formatConflictOptions(
  conflict: Conflict,
  detection: DetectionState,
): ReadonlyArray<FormatConflictOption> {
  return candidateTypes(conflict).map((type) => {
    const candidate = conflict.candidates.find(
      (item) => item.entityType === type && item.formatId !== undefined,
    );
    return {
      type,
      format:
        candidate?.formatId !== undefined ? referenceFormat(detection, candidate.formatId) : null,
    };
  });
}

/** El candidato que gana por defecto entre los que salieron de un formato (ADR-222 §3). */
export function formatConflictWinner(
  conflict: Conflict,
  detection: DetectionState,
): ConflictCandidate | undefined {
  const fromFormat = conflict.candidates.filter((candidate) => candidate.formatId !== undefined);
  const isUser = (candidate: ConflictCandidate): boolean =>
    candidate.formatId !== undefined &&
    referenceFormat(detection, candidate.formatId).origin === "user";
  return fromFormat.reduce<ConflictCandidate | undefined>((best, candidate) => {
    if (best === undefined) return candidate;
    if (isUser(candidate) !== isUser(best)) return isUser(candidate) ? candidate : best;
    return candidate.value.length > best.value.length ? candidate : best;
  }, undefined);
}

/**
 * El texto de «nació resuelto», o `null` si ya no corresponde: el conflicto no
 * está resuelto, o el usuario lo resolvió a otro tipo (entonces vale «Ya
 * revisado»).
 */
export function formatConflictResolvedNote(
  conflict: Conflict,
  detection: DetectionState,
): string | null {
  if (!conflict.resolved || !isFormatConflict(conflict)) return null;
  const winner = formatConflictWinner(conflict, detection);
  if (winner === undefined) return null;
  if (conflict.resolvedType !== undefined && conflict.resolvedType !== winner.entityType) {
    return null;
  }
  const winnerIsUser =
    winner.formatId !== undefined && referenceFormat(detection, winner.formatId).origin === "user";
  const loserIsCatalog = conflict.candidates.some(
    (candidate) =>
      candidate.formatId !== undefined &&
      candidate.entityType !== winner.entityType &&
      referenceFormat(detection, candidate.formatId).origin === "catalog",
  );
  return winnerIsUser && loserIsCatalog ? FORMAT_CONFLICT_USER_WINS : FORMAT_CONFLICT_LONGEST_WINS;
}

/**
 * El tooltip del ícono gris de un conflicto **resuelto por defecto** a favor de
 * un formato del usuario (`ResolvedConflictBadge`, ADR-229 §5). `null` si el
 * ganador no es un formato del usuario o el conflicto ya no está en su
 * resolución por defecto: ahí vale el texto de siempre.
 */
export function resolvedByDefaultTooltip(
  conflict: Conflict,
  detection: DetectionState,
): { readonly title: string; readonly text: string } | null {
  if (formatConflictResolvedNote(conflict, detection) === null) return null;
  const winner = formatConflictWinner(conflict, detection);
  if (winner?.formatId === undefined) return null;
  const reference = referenceFormat(detection, winner.formatId);
  if (reference.origin !== "user") return null;
  return {
    title: "Conflicto resuelto por defecto:",
    text: `ganó tu formato «${reference.name}». Clic para revisar.`,
  };
}
