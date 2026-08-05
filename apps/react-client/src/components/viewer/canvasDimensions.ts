/**
 * `canvasDimensions.ts` — comprobación pura de si un `<canvas>` necesita
 * reasignar `width`/`height` (`ui/Components.md` §5.4,
 * `adr/ADR-056-RenderRequested-Kind-Por-Panel.md` §5).
 *
 * Asignar `canvas.width`/`canvas.height` **borra el bitmap del canvas aunque
 * el valor sea idéntico al que ya tenía** — comportamiento del estándar
 * HTML, no un bug del navegador. `PageCanvas` reasignaba incondicionalmente
 * en cada ejecución de su efecto; como el `blobUrl` cambia en cada
 * `PREVIEW_UPDATED` aunque los píxeles sean idénticos (el motor acuña un
 * `URL.createObjectURL` nuevo también en aciertos de cache, ADR-056 §6), el
 * canvas quedaba gris hasta que la `Image` nueva terminaba de cargar: el
 * parpadeo del visor al scrollear.
 *
 * Función pura sobre números/objetos planos (no sobre el elemento
 * `HTMLCanvasElement`) porque los tests de `apps/react-client` corren sin
 * jsdom (`environment: "node"` en `vitest.config.ts`, mismo criterio que
 * ADR-054 §5) y necesitan poder ejercitar esta comprobación sin un canvas
 * real.
 */

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/**
 * `true` cuando `next` difiere de `current` en `width` y/o `height` — el
 * único momento en el que hace falta reasignar `canvas.width`/`canvas.height`
 * (y por lo tanto el único momento en el que el bitmap se borra
 * legítimamente, porque el tamaño de verdad cambió).
 */
export function shouldReassignCanvasDimensions(current: CanvasSize, next: CanvasSize): boolean {
  return current.width !== next.width || current.height !== next.height;
}
