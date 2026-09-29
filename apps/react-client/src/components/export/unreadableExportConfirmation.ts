/**
 * `unreadableExportConfirmation.ts` — ADR-190 §4: qué páginas quedan
 * pendientes al pedir el export (`unreadableInk` y ninguna entidad, misma
 * regla que el aviso de `PageCanvas`, `ui/Components.md` §5.4/§7.1), y cómo
 * se arma `ExportOptions.coveredPages` a partir de esa lista + lo que el
 * usuario destildó en la confirmación.
 *
 * Funciones puras y testeables en Node: los tests de `apps/react-client`
 * corren sin jsdom (mismo criterio que `canvasDimensions.ts`,
 * `exportPreflight.ts`).
 */

import type { EntityGroup, EntityType } from "@anonly/anonymization-core";

import { pageHasEntity } from "../../store/entities.store.js";

/**
 * Las páginas pendientes: tienen `unreadableInk` y ninguna entidad. El orden
 * de salida es ascendente — es el orden en el que se listan las filas de la
 * confirmación y en el que tiene sentido revisarlas.
 */
export function computePendingPages(
  unreadableInkPages: ReadonlySet<number>,
  groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>,
): ReadonlyArray<number> {
  const pending: number[] = [];
  for (const pageIndex of unreadableInkPages) {
    if (!pageHasEntity(groupsByType, pageIndex)) pending.push(pageIndex);
  }
  return pending.sort((a, b) => a - b);
}

/** La confirmación se abre solo si hay algo que confirmar. */
export function shouldConfirmPendingPages(pendingPages: ReadonlyArray<number>): boolean {
  return pendingPages.length > 0;
}

/**
 * `coveredPages` a partir de la lista de pendientes y las filas que el
 * usuario destildó (`uncheckedPages`). "Tapar página entera" viene **marcado
 * por defecto** (`ui/Components.md` §7.1): una página pendiente entra en
 * `coveredPages` salvo que su fila se haya destildado a mano.
 */
export function buildCoveredPages(
  pendingPages: ReadonlyArray<number>,
  uncheckedPages: ReadonlySet<number>,
): ReadonlyArray<number> {
  return pendingPages.filter((pageIndex) => !uncheckedPages.has(pageIndex));
}
