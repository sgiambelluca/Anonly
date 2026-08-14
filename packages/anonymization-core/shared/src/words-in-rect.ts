// Hit-test contra Page.words: el visor no tiene capa de texto, ni siquiera en
// escaneados (ADR-061 §4). Solapamiento estricto: un rect sin área no matchea
// nada; un rect que corta una palabra a la mitad sí la incluye.

import type { BoundingBox, Word } from "./types.js";

export function wordsInRect(words: ReadonlyArray<Word>, rect: BoundingBox): ReadonlyArray<Word> {
  return words.filter((word) => intersects(word.bbox, rect));
}

function intersects(a: BoundingBox, b: BoundingBox): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return false;
  }
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
