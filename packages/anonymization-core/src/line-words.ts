/**
 * Selección host-side de las palabras de línea para el repintado por
 * calibración (ADR-058 §5, `Orchestrator.md` nota v1.6.0).
 *
 * Función **pura y síncrona**: dado el `Page.words` de una página y sus
 * `Replacement[]`, decide si algún reemplazo de esa página podría no entrar
 * en su propio bbox — estimado con `estimateTokenWidth` (ADR-057 §5) y con
 * margen conservador, ante la duda se adjunta — y, si es así, selecciona las
 * palabras que comparten banda vertical con ese reemplazo y están a su
 * derecha. El kernel de Render repinta desde `bbox.x` hasta el final de la
 * línea, nunca hacia la izquierda, así que solo hacen falta las palabras
 * siguientes de la línea, no las anteriores (ADR-058 §2).
 *
 * Mismo reparto que `fuseOcrPage` (`@anonly/pdf-engine`, ADR-041): lógica
 * pura que necesita datos retenidos por el Orchestrator (acá, `Page.words`
 * del `Document` retenido), ejecutada por el host, sin estado propio y sin
 * que ningún motor importe a otro. Vive en este façade porque el roadmap
 * (Hito 10.5, PR 4) se lo asigna explícitamente a este módulo, no a un motor
 * — a diferencia de `fuseOcrPage`, que sí vive en `pdf-engine`.
 *
 * Incluye palabras de OCR (`Word.source === "ocr"`) exactamente igual que
 * las de PDF: `Page.words` ya las mezcla sin distinción de origen en la
 * selección, que es lo que hace que el repintado funcione en documentos
 * escaneados (ADR-058 §5).
 *
 * **Sin cablear todavía**: esta función no se invoca desde
 * `renderMediatedPreview` ni desde los call sites de `buildPageReplacements`
 * ni desde `makeRenderPageProvider.renderFull` en `orchestrator.ts`.
 * `RenderPageInput` (`render-engine`) aún no tiene el campo `lineWords` —
 * solo `RenderPagePayload` (`@anonly/shared`) lo tiene desde el PR 2 de este
 * hito —, y ese campo es alcance del PR 5 (`render-engine` ya lo declara en
 * su propio spec, `Render_Engine.md` §6, y reenviarlo a `RenderPagePayload`
 * en `render.engine.ts` es indispensable para su propio kernel — no es una
 * dependencia que este PR le imponga). El cableado de los cuatro puntos de
 * enganche (incluido `renderFull`, `Orchestrator.md` v1.7.1 ítem 22b) es el
 * PR 4b (Hito 10.5, `docs/roadmap/MVP.md` §4), posterior al PR 5.
 */

import {
  estimateTokenWidth,
  ReplacementMode,
  type BoundingBox,
  type Replacement,
  type Word,
} from "@anonly/shared";

/**
 * `true` si `replacement` podría no entrar en su propio bbox.
 *
 * `redact` nunca dibuja texto — fill opaco y `continue`, sin `fillText`
 * (`render-engine/src/worker/kernel.ts`, `paintReplacements`) — así que
 * nunca puede derramarse (ADR-058, Contexto §1: "Afecta a mask, synthetic y
 * placeholder ... redact es inmune"). Se excluye siempre, sin importar la
 * longitud de `replacementValue`.
 *
 * Para los tres modos con texto, el criterio usa `>=` (no `>`) contra
 * `bbox.width`: en el borde exacto se considera que "podría no entrar" — es
 * el margen conservador que ADR-058 §5 pide explícitamente ("ante la duda,
 * se adjuntan"; adjuntar de más solo cuesta payload).
 */
function mightOverflow(replacement: Replacement): boolean {
  if (replacement.mode === ReplacementMode.Redact) return false;
  const estimatedWidth = estimateTokenWidth(
    replacement.replacementValue.length,
    replacement.bbox.height,
  );
  return estimatedWidth >= replacement.bbox.width;
}

/**
 * Dos bboxes "comparten banda vertical" cuando sus extensiones en Y se
 * solapan — el criterio geométrico estándar de overlap de intervalos, sin
 * umbral de proporción: cualquier solapamiento cuenta como misma línea.
 */
function sharesVerticalBand(a: BoundingBox, b: BoundingBox): boolean {
  return a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * `word` está a la derecha de `replacement` cuando arranca en o después del
 * borde **derecho** del bbox del reemplazo — no del borde izquierdo.
 *
 * La razón: el bbox de un reemplazo que cubre una ocurrencia de varias
 * palabras (p. ej. "Juan Pérez") ya abarca esas palabras internas. Comparar
 * contra el borde izquierdo incluiría por error la segunda palabra de la
 * propia ocurrencia reemplazada como si fuera una "vecina siguiente" de la
 * línea. Comparar contra el borde derecho selecciona únicamente las palabras
 * que quedan **después** de lo que el reemplazo ya cubre — las mismas que
 * ADR-058 §2 paso 3 describe como "cada palabra siguiente de la línea".
 */
function isLineNeighbor(word: Word, replacement: Replacement): boolean {
  if (!sharesVerticalBand(word.bbox, replacement.bbox)) return false;
  return word.bbox.x >= replacement.bbox.x + replacement.bbox.width;
}

/**
 * Selecciona, de `pageWords`, las palabras que el kernel de Render necesita
 * para repintar las líneas de `replacements` que podrían no entrar en su
 * bbox (ADR-058 §5). Pura y sin estado retenido entre llamadas: misma
 * entrada, misma salida.
 *
 * Devuelve `undefined` cuando **ningún** reemplazo de la página podría no
 * entrar — el caso normal y más común (`RenderPagePayload.lineWords` queda
 * ausente del payload, nunca un array vacío). Si al menos un reemplazo
 * podría no entrar, siempre devuelve un array (incluso vacío si esa línea no
 * tiene ninguna palabra a la derecha): la presencia del campo está regida
 * por el riesgo de derrame, no por si hay vecinas — el kernel decide caer al
 * shrink-to-fit de ADR-058 §1 cuando no encuentra vecinas utilizables
 * (ADR-058 §6, condición 1).
 */
export function selectLineWords(
  pageWords: ReadonlyArray<Word>,
  replacements: ReadonlyArray<Replacement>,
): ReadonlyArray<Word> | undefined {
  const overflowing = replacements.filter(mightOverflow);
  if (overflowing.length === 0) return undefined;

  return pageWords.filter((word) =>
    overflowing.some((replacement) => isLineNeighbor(word, replacement)),
  );
}
