/**
 * `WordSelectionOverlay` (ADR-114 §1): recorta la selección del arrastre al
 * **renglón dominante**.
 *
 * `wordsInRect` devuelve todo lo que el rectángulo toca, y el valor que arma
 * el overlay es `words.join(" ")`. En un sello de expediente los renglones
 * están a 4–6 pt, así que un arrastre normal roza el de arriba y el valor sale
 * con dos renglones pegados — una cadena que **no existe** en el documento:
 * `slideWordWindowMatches` exige sub-tokens consecutivos en el orden de
 * lectura y, entre palabras de renglones distintos, exige además banda
 * vertical compartida. Medido sobre 18 páginas de un fallo escaneado: con el
 * rectángulo justo, la frase se encuentra 18/18; con 4 pt de holgura, 0/18.
 *
 * El renglón no se vuelve a derivar acá: `Page.words` **ya viene agrupado por
 * renglón** (ADR-110/ADR-113), así que un renglón es una corrida de índices
 * consecutivos. Reusar eso —en vez de re-agrupar por geometría en la UI— es
 * lo que mantiene una sola definición de "misma línea" en el producto.
 *
 * Función pura y en su propio archivo: `apps/react-client` corre sus tests en
 * Node sin jsdom (mismo criterio que `manualEntityFeedback.ts`).
 */

import type { BoundingBox, Word } from "@anonly/anonymization-core";

function intersectionArea(box: BoundingBox, rect: BoundingBox): number {
  const width = Math.min(box.x + box.width, rect.x + rect.width) - Math.max(box.x, rect.x);
  const height = Math.min(box.y + box.height, rect.y + rect.height) - Math.max(box.y, rect.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

/**
 * De las palabras que el rectángulo tocó, las de un solo renglón: la corrida
 * de índices consecutivos de `pageWords` con **más área seleccionada**.
 *
 * El desempate es por área y no por cantidad de palabras a propósito: dos
 * renglones de cuatro palabras cada uno empatan en cantidad, y el que el
 * usuario quiso es el que cubrió de verdad, no el que aparece primero.
 */
export function dominantLineWords(
  pageWords: ReadonlyArray<Word>,
  selected: ReadonlyArray<Word>,
  rect: BoundingBox,
): ReadonlyArray<Word> {
  if (selected.length <= 1) return selected;

  const inSelection = new Set(selected);
  let best: Word[] = [];
  let bestArea = -1;
  let run: Word[] = [];
  let runArea = 0;

  const flush = (): void => {
    if (run.length > 0 && runArea > bestArea) {
      best = run;
      bestArea = runArea;
    }
    run = [];
    runArea = 0;
  };

  for (const word of pageWords) {
    if (!inSelection.has(word)) {
      flush();
      continue;
    }
    // Un renglón avanza hacia la derecha: que la `x` RETROCEDA es el retorno
    // de carro. Hace falta además de la contigüidad porque dos renglones
    // seguidos de una misma columna sí son contiguos en `Page.words` — es el
    // caso del sello, donde `PROVINCIA…AIRES` y `TRIBUNAL…PENAL` van pegados.
    const previous = run[run.length - 1];
    if (previous !== undefined && word.bbox.x < previous.bbox.x) flush();
    run.push(word);
    runArea += intersectionArea(word.bbox, rect);
  }
  flush();

  return best;
}
