/**
 * `unreadableInkWarning.ts` — ADR-190 §4: cuándo `PageCanvas` muestra el
 * aviso de "esta página tiene contenido que no se pudo leer" (`ui/Components.md`
 * §5.4). Separado del componente por el mismo motivo que
 * `canvasDimensions.ts`: los tests de `apps/react-client` corren en Node sin
 * jsdom, así que la condición vive en una función pura testeable y no en un
 * `if` inline dentro del `.tsx`.
 */

/**
 * El aviso aparece si la página tiene `unreadableInk` y **ninguna entidad**
 * — automática o manual, habilitada o no (`pageHasEntity`, `entities.store.ts`).
 * Desaparece solo en cuanto la página recibe una entidad: no hay estado propio
 * de "descartado", la condición se re-evalúa en cada render.
 */
export function shouldShowUnreadableInkWarning(
  unreadableInk: boolean,
  hasEntity: boolean,
): boolean {
  return unreadableInk && !hasEntity;
}
