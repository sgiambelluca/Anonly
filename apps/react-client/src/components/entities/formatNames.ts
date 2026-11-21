/**
 * `formatNames.ts` — el nombre de un formato a partir de su id, para los textos
 * que lo nombran: el aviso de `skippedFormats`, el panel de conflicto entre dos
 * formatos y el tooltip del visor (`React_Client.md` §3.11, ADR-226 §5,
 * ADR-229 §6 y §7).
 *
 * Un formato **del usuario** sale de `userFormats` (o de `catalogRefs`, que
 * apuntan al catálogo de otro país). Uno **base** sale del catálogo del país
 * activo, por el `id` del patrón (`Occurrence.formatId`) o por el de su
 * definición equivalente (`fmt:base:<id>`).
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import { getCatalog } from "@anonly/anonymization-core";

import { isUserFormat, type DetectionState } from "../../store/detectionState.js";

import { userFormatNameOf } from "./entityFilters.js";

/** `undefined` si el id no es de ningún formato conocido (p. ej. uno que ya se borró). */
export function formatNameOf(state: DetectionState, formatId: string): string | undefined {
  const own = userFormatNameOf(state)(formatId);
  if (own !== undefined) return own;
  return getCatalog(state.country).find(
    (info) => info.id === formatId || info.definition?.id === formatId,
  )?.name;
}

export interface FormatReference {
  readonly name: string;
  /** Del usuario (propio, copia editada o referencia de otro país) o del catálogo. */
  readonly origin: "user" | "catalog";
}

/**
 * El nombre y el origen de un formato. Sin nombre conocido, el id: es lo que ya
 * hace el árbol de entidades, y avisar con un nombre inventado sería peor.
 */
export function referenceFormat(state: DetectionState, formatId: string): FormatReference {
  return {
    name: formatNameOf(state, formatId) ?? formatId,
    origin: isUserFormat(state, formatId) ? "user" : "catalog",
  };
}
