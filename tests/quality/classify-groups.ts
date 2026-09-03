/**
 * ADR-095 §4: solo los miembros de grupos `enabled: true` cuentan como
 * detección — la métrica mide lo que la herramienta taparía SIN intervención
 * del usuario. Un grupo sugerido por ADR-094 (`enabled: false` +
 * `needsReview: true`) no tapa nada: se cuenta aparte, como sugerencia.
 *
 * Función pura: recibe el estado final de los grupos y un índice de las
 * ocurrencias que los componen (ya resueltas desde `ENTITY_FOUND`, un grupo
 * solo guarda `OccurrenceRef.occurrenceId`, no el valor) y separa sus
 * miembros en dos listas planas de `DetectedEntity`.
 */
import type { EntityGroup, Occurrence } from "@anonly/shared";

import type { DetectedEntity } from "./types.js";

function toDetectedEntity(occurrence: Occurrence): DetectedEntity {
  return {
    entityType: occurrence.entityType,
    value: occurrence.value,
    pageIndex: occurrence.pageIndex,
    source: occurrence.source,
  };
}

export interface GroupClassification {
  readonly detections: ReadonlyArray<DetectedEntity>;
  readonly suggestions: ReadonlyArray<DetectedEntity>;
}

export function classifyGroups(
  groups: ReadonlyArray<EntityGroup>,
  occurrencesById: ReadonlyMap<string, Occurrence>,
): GroupClassification {
  const detections: DetectedEntity[] = [];
  const suggestions: DetectedEntity[] = [];

  for (const group of groups) {
    // Un grupo normal es `enabled: true`. El único otro estado que produce el
    // pipeline (sin intervención manual del usuario, que esta suite no
    // ejercita) es la sugerencia de ADR-094: `enabled: false` +
    // `needsReview: true`. Cualquier otra combinación no tapa nada y tampoco
    // es una sugerencia ofrecida, así que no entra en ninguna de las dos listas.
    const bucket = group.enabled ? detections : group.needsReview ? suggestions : undefined;
    if (bucket === undefined) continue;

    for (const member of group.members) {
      const occurrence = occurrencesById.get(member.occurrenceId);
      // No debería pasar: cada `OccurrenceRef` de un grupo nace de un
      // `ENTITY_FOUND` ya emitido (`recordOccurrence` en grouping-engine). Si
      // el índice no lo tiene, el listener del caller se perdió el evento —
      // preferible ignorar el miembro a inventarle un valor.
      if (occurrence === undefined) continue;
      bucket.push(toDetectedEntity(occurrence));
    }
  }

  return { detections, suggestions };
}
