/**
 * `layoutMode.ts` — qué forma toma el panel de trabajo según el ancho de la
 * ventana (`ui/UX_Guidelines.md` §2).
 *
 * **Por qué existe.** `SideBySideViewer` cargaba la única conducta responsive
 * de la app: por debajo de `lg` alternaba los dos visores con tabs. ADR-087 §2
 * lo retiró —con razón: con un solo visor no hay dos paneles que alternar— y
 * no lo reemplazó por nada, así que el panel de trabajo quedó siendo una barra
 * lateral de ancho fijo más el visor, sin ningún breakpoint
 * (`roadmap/Post_Hito10.8_Pendientes.md` §19).
 *
 * El mecanismo del defecto es una sola regla de `App.tsx`:
 * `w-1/3 min-w-[340px]`. Por debajo de ~1020 px el tercio cae por debajo del
 * mínimo, la barra **deja de encoger** y todo lo que falta se lo come al
 * visor. Medido: a 375 px la barra ocupa 339 px y el visor queda en **35 px**.
 *
 * Tres formas, no dos, porque el problema tampoco es uno solo:
 *
 * - `wide` (≥ 1024): barra lateral y visor conviven. Es el layout para el que
 *   se diseñó ADR-087 y no cambia.
 * - `drawer` (640–1023): el visor se queda con todo el ancho y la barra
 *   lateral pasa a abrirse **encima**, a pedido. Este rango —una ventana en
 *   media pantalla de un laptop— hoy anda casi bien y lo único que lo arruina
 *   es ese mínimo que no cede; recuperarlo es barato y es uso real.
 * - `too-narrow` (< 640): ni con el visor a pantalla completa entra una fila
 *   del árbol con su nombre, su contador y su selector de modo. Acá la
 *   respuesta honesta es decirlo, no acomodar los píxeles hasta que "entre":
 *   anonimizar una pericia de 200 páginas desde un teléfono no es un caso de
 *   uso, y fingir que funciona es peor que declarar que no.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

/**
 * Piso del layout de dos columnas. Coincide con `lg` de Tailwind, que es el
 * breakpoint que usaba `SideBySideViewer` antes de retirarse — el mismo umbral
 * que la app ya había elegido para "acá dejan de caber dos cosas al lado".
 */
export const LAYOUT_WIDE_MIN_PX = 1024;

/**
 * Ancho mínimo soportado. Coincide con `sm` de Tailwind. Por debajo, la app
 * muestra un aviso en vez de un layout roto.
 */
export const LAYOUT_MIN_SUPPORTED_PX = 640;

export type LayoutMode = "wide" | "drawer" | "too-narrow";

export function resolveLayoutMode(viewportWidth: number): LayoutMode {
  if (viewportWidth >= LAYOUT_WIDE_MIN_PX) return "wide";
  if (viewportWidth >= LAYOUT_MIN_SUPPORTED_PX) return "drawer";
  return "too-narrow";
}
