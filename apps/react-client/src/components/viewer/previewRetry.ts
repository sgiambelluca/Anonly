/**
 * `previewRetry.ts` — reintento del pedido de preview mientras las páginas
 * montadas siguen sin imagen.
 *
 * **El problema que resuelve.** `handleRenderRequested` del Render Engine
 * **descarta en silencio** todo `RENDER_REQUESTED` de un documento que todavía
 * no cargó (`Render_Engine.md` §8, ADR-030 §3: "sin caller al que lanzarle →
 * warn + no-op"). No hay cola, no hay reintento, y el `warn` va a un logger
 * nulo (`create-core.ts`), así que **la UI no tiene forma de enterarse de que
 * su pedido se cayó**.
 *
 * `readyRenderTrigger.ts` cubría el caso con un re-pedido único al observar
 * `Ready`. Alcanzaba mientras el visor solo se miraba después de terminar el
 * análisis. **Con el pase temprano de ADR-087 §6 dejó de alcanzar**: el
 * usuario entra al panel de trabajo a los 6 s, con el pipeline todavía en
 * `OCRing`, y en un documento de 50 páginas `Ready` llega minutos después. Se
 * le prometió una superficie de trabajo y se le entregó un visor gris —
 * medido: 3 pedidos, los tres dentro del primer segundo, los tres descartados,
 * y nada más hasta `Ready`.
 *
 * **Por qué reintentar y no arreglarlo en el motor.** Que el motor encole los
 * pedidos que no puede atender todavía sería mejor, pero cambia su contrato
 * (`Render_Engine.md` §8 documenta el descarte como comportamiento, no como
 * bug) y eso pide ADR. Esto es la mitad que la UI puede hacer sola, y es
 * **autolimitada**: apenas llegan las imágenes, deja de pedir.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

/** Cadencia del reintento. Un pedido descartado es barato; 700 ms no compite con nada. */
export const PREVIEW_RETRY_INTERVAL_MS = 700;

/**
 * Techo de intentos por conjunto montado. Existe para que un render que
 * **falla de verdad** (no que llega temprano) no deje a la UI pidiendo para
 * siempre. Con la cadencia de arriba son ~28 s, de sobra para que
 * `loadDocument` resuelva incluso en una máquina cargada; pasado eso, el
 * re-pedido de `readyRenderTrigger.ts` al llegar a `Ready` sigue estando como
 * última red.
 */
export const PREVIEW_RETRY_MAX_ATTEMPTS = 40;

export interface PreviewRetryParams {
  readonly documentId: string | null;
  /** Páginas que el virtualizador tiene montadas con contenido real. */
  readonly mountedPageIndices: ReadonlyArray<number>;
  /** `viewer.previewByPage[kind]` — las imágenes que ya llegaron. */
  readonly previewByPage: ReadonlyMap<number, string>;
  readonly attempts: number;
}

/**
 * Páginas montadas que todavía no tienen imagen. Vacío ⇒ no hay nada que
 * reintentar.
 */
export function pagesMissingPreview(params: PreviewRetryParams): ReadonlyArray<number> {
  const { documentId, mountedPageIndices, previewByPage, attempts } = params;
  if (documentId === null) return [];
  if (attempts >= PREVIEW_RETRY_MAX_ATTEMPTS) return [];
  return mountedPageIndices.filter((pageIndex) => !previewByPage.has(pageIndex));
}
