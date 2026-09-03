// Hit-test contra Page.words: el visor no tiene capa de texto, ni siquiera en
// escaneados (ADR-061 §4). Solapamiento estricto: un rect sin área no matchea
// nada; un rect que corta una palabra a la mitad sí la incluye.

import { rectsOverlap } from "./rects-overlap.js";
import type { BoundingBox, Word } from "./types.js";

export function wordsInRect(words: ReadonlyArray<Word>, rect: BoundingBox): ReadonlyArray<Word> {
  // El `intersects` privado que vivía acá se promovió a `rectsOverlap`
  // (ADR-127): era la misma AABB que `render-engine` tenía escrita aparte, y
  // la única de las dos con la guarda de área cero.
  return words.filter((word) => rectsOverlap(word.bbox, rect));
}
