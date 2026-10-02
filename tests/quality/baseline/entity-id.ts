/**
 * Identidad estable de una entidad del truth (ADR-147 §2). `TruthEntity` no
 * tiene `id` y no lo gana en los fixtures — se deriva, determinística:
 *
 *   <documentId>:<pageIndex>:<entityType>:<valor normalizado>#<ordinal>
 *
 * "Valor normalizado" usa `normalizeForComparison` de `@anonly/shared`, la
 * MISMA normalización que ya usa la regla de matcheo (`matching.ts`,
 * ADR-095) — no una nueva: si la identidad normalizara distinto de como
 * matchea `isCovered`, dos entidades que la regla trata como la misma fila
 * podrían derivar ids distintos, o viceversa.
 *
 * `ordinal` desempata entidades idénticas dentro del MISMO documento — mismo
 * `(pageIndex, entityType, valor normalizado)` — por orden de aparición en
 * `truth.entities`. Sin esto, dos DNIs iguales repetidos en la misma página
 * (un caso real: un formulario que reimprime el mismo dato) colisionarían en
 * el mismo id.
 */
import { normalizeForComparison } from "@anonly/shared";

import type { DocumentTruth, TruthEntity } from "../types.js";

/** El id estable de UNA entidad, dado el `ordinalWithinKey` ya calculado (ver `deriveDocumentEntityIds`). */
export function deriveEntityId(
  documentId: string,
  entity: TruthEntity,
  ordinalWithinKey: number,
): string {
  const normalizedValue = normalizeForComparison(entity.value);
  return `${documentId}:${entity.pageIndex}:${entity.entityType}:${normalizedValue}#${ordinalWithinKey}`;
}

export interface IdentifiedTruthEntity {
  readonly id: string;
  readonly entity: TruthEntity;
}

function groupKey(entity: TruthEntity): string {
  return `${entity.pageIndex}:${entity.entityType}:${normalizeForComparison(entity.value)}`;
}

/**
 * Recorre `truth.entities` en orden y le asigna a cada una su id estable,
 * calculando el ordinal correcto: agrupa por `(pageIndex, entityType, valor
 * normalizado)` y asigna 0, 1, 2... por orden de aparición dentro de ese
 * grupo — no por índice global en el array.
 */
export function deriveDocumentEntityIds(
  truth: DocumentTruth,
): ReadonlyArray<IdentifiedTruthEntity> {
  const seenCountByKey = new Map<string, number>();

  return truth.entities.map((entity) => {
    const key = groupKey(entity);
    const ordinal = seenCountByKey.get(key) ?? 0;
    seenCountByKey.set(key, ordinal + 1);
    return { id: deriveEntityId(truth.documentId, entity, ordinal), entity };
  });
}
