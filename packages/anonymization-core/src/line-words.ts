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
 * **Cableada** (Hito 10.5, PR 4b, `Orchestrator.md` v1.7.1 ítem 22b) en los
 * cuatro puntos que construyen un `RenderPageInput` con `kind: "anonymized"`
 * en `orchestrator.ts`: `renderMediatedPreview` (de donde lo heredan sus dos
 * únicos call sites, `flushDirtyPages` y `seedAnonymizedPreview`) y
 * `makeRenderPageProvider.renderFull`, que repite el mismo cálculo en vez de
 * compartirlo — es el del export, y es el punto que hace que el repintado de
 * línea también exista en el PDF final, no solo en el preview.
 */

import {
  estimateTokenWidth,
  ReplacementMode,
  sharesVerticalBand,
  type BoundingBox,
  type Replacement,
  type Word,
} from "@anonly/shared";

/**
 * `true` si `replacement` podría no entrar en `fragmentBbox` — un elemento de
 * `replacement.fragments ?? [replacement.bbox]` (ADR-074 §8): sin `fragments`
 * es el bbox de siempre; con ellos, cada rectángulo de línea se evalúa por
 * separado, porque es contra ESO que el kernel mide (ADR-074 §5-§6), no
 * contra la envolvente.
 *
 * `redact` nunca dibuja texto — fill opaco y `continue`, sin `fillText`
 * (`render-engine/src/worker/kernel.ts`, `paintReplacements`) — así que
 * nunca puede derramarse (ADR-058, Contexto §1: "Afecta a mask, synthetic y
 * placeholder ... redact es inmune"). Se excluye siempre, sin importar la
 * longitud de `replacementValue`.
 *
 * Para los tres modos con texto, el criterio usa `>=` (no `>`) contra
 * `fragmentBbox.width`: en el borde exacto se considera que "podría no
 * entrar" — es el margen conservador que ADR-058 §5 pide explícitamente
 * ("ante la duda, se adjuntan"; adjuntar de más solo cuesta payload).
 */
function mightOverflow(replacement: Replacement, fragmentBbox: BoundingBox): boolean {
  if (replacement.mode === ReplacementMode.Redact) return false;
  const estimatedWidth = estimateTokenWidth(
    replacement.replacementValue.length,
    fragmentBbox.height,
  );
  return estimatedWidth >= fragmentBbox.width;
}

/**
 * `word` está a la derecha de `fragmentBbox` cuando arranca en o después de
 * su borde **derecho** — no del borde izquierdo.
 *
 * La razón: el bbox de un fragmento que cubre una ocurrencia de varias
 * palabras (p. ej. "Juan Pérez") ya abarca esas palabras internas. Comparar
 * contra el borde izquierdo incluiría por error la segunda palabra de la
 * propia ocurrencia reemplazada como si fuera una "vecina siguiente" de la
 * línea. Comparar contra el borde derecho selecciona únicamente las palabras
 * que quedan **después** de lo que el fragmento ya cubre — las mismas que
 * ADR-058 §2 paso 3 describe como "cada palabra siguiente de la línea".
 *
 * `sharesVerticalBand` es la de `@anonly/shared` (ADR-061 §2, errata): este
 * archivo tenía su propia copia porque no había un lugar común desde el que
 * los tres consumidores (este façade, `render-engine` y `regex-engine`)
 * pudieran importarla sin que dos motores se importen entre sí (P-1). El
 * criterio no cambió — de-dup puro (`Contracts.md` §6).
 */
function isLineNeighbor(word: Word, fragmentBbox: BoundingBox): boolean {
  if (!sharesVerticalBand(word.bbox, fragmentBbox)) return false;
  return word.bbox.x >= fragmentBbox.x + fragmentBbox.width;
}

/**
 * Selecciona, de `pageWords`, las palabras que el kernel de Render necesita
 * para repintar las líneas de `replacements` que podrían no entrar en su
 * bbox (ADR-058 §5). Pura y sin estado retenido entre llamadas: misma
 * entrada, misma salida.
 *
 * ADR-074 §8: los dos criterios se evalúan **por fragmento**
 * (`replacement.fragments ?? [replacement.bbox]`) — con un solo rectángulo
 * es exactamente el mismo array de un elemento que antes, byte a byte. Con
 * varios, cada fragmento es la línea que de verdad importa: la envolvente de
 * una entidad partida nunca "desborda" (es demasiado ancha) y deja fuera a
 * las vecinas reales de cada renglón (ver Contexto §8 del ADR).
 *
 * Devuelve `undefined` cuando **ningún** fragmento de la página podría no
 * entrar — el caso normal y más común (`RenderPagePayload.lineWords` queda
 * ausente del payload, nunca un array vacío). Si al menos uno podría no
 * entrar, siempre devuelve un array (incluso vacío si esa línea no tiene
 * ninguna palabra a la derecha): la presencia del campo está regida por el
 * riesgo de derrame, no por si hay vecinas — el kernel decide caer al
 * shrink-to-fit de ADR-058 §1 cuando no encuentra vecinas utilizables
 * (ADR-058 §6, condición 1).
 */
export function selectLineWords(
  pageWords: ReadonlyArray<Word>,
  replacements: ReadonlyArray<Replacement>,
): ReadonlyArray<Word> | undefined {
  const overflowingFragments = replacements.flatMap((replacement) =>
    (replacement.fragments ?? [replacement.bbox]).filter((fragment) =>
      mightOverflow(replacement, fragment),
    ),
  );
  if (overflowingFragments.length === 0) return undefined;

  return pageWords.filter((word) =>
    overflowingFragments.some((fragment) => isLineNeighbor(word, fragment)),
  );
}
