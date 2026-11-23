/**
 * Recorrido de un formato armado con piezas (ADR-220), en versión de prototipo.
 *
 * Reproduce la semántica de `Regex_Engine.md` («Formatos del generador»):
 * - la coincidencia más a la izquierda y, de las que empiezan ahí, la más larga;
 * - bordes de «letra o dígito» (`[\p{L}\p{N}]`), parte del recorrido;
 * - `contextBefore`: la palabra va justo antes, con espacios y como mucho un `:`,
 *   y no forma parte del match;
 * - `text` compara por pliegue (NFD sin marcas, minúsculas); `" "` reconoce
 *   cualquier espacio en blanco.
 *
 * No es el autómata de Thompson del motor: enumera los finales posibles pieza
 * por pieza. Da los mismos tramos, y alcanza para medir.
 */

import type { Candidate, CharClass, Piece } from "./types.js";

const LETTER = /\p{L}/u;
const DIGIT = /[0-9]/;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function charOk(cls: CharClass, ch: string): boolean {
  switch (cls) {
    case "digit":
      return DIGIT.test(ch);
    case "letter":
      return LETTER.test(ch);
    case "upper":
      return UPPER.test(ch);
    case "lower":
      return LOWER.test(ch);
    case "alnum":
      return LETTER.test(ch) || DIGIT.test(ch);
  }
}

export function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function sepMatches(chars: string, ch: string): boolean {
  if (chars.includes(" ") && /\s/.test(ch)) return true;
  return chars.includes(ch);
}

function stepPiece(piece: Piece, text: string, starts: ReadonlySet<number>): Set<number> {
  const out = new Set<number>();
  for (const p of starts) {
    switch (piece.k) {
      case "chars": {
        if (piece.min === 0) out.add(p);
        let q = p;
        let n = 0;
        while (n < piece.max && q < text.length && charOk(piece.cls, text[q] ?? "")) {
          q += 1;
          n += 1;
          if (n >= piece.min) out.add(q);
        }
        break;
      }
      case "text": {
        const want = fold(piece.value);
        let q = p;
        let ok = true;
        for (const w of want) {
          const ch = text[q];
          if (ch === undefined || fold(ch) !== w) {
            ok = false;
            break;
          }
          q += 1;
        }
        if (ok) out.add(q);
        break;
      }
      case "sep": {
        const ch = text[p];
        if (ch !== undefined && sepMatches(piece.chars, ch)) out.add(p + 1);
        if (piece.optional === true) out.add(p);
        break;
      }
      case "optional": {
        out.add(p);
        for (const e of advance(piece.pieces, text, new Set([p]))) out.add(e);
        break;
      }
    }
  }
  return out;
}

function advance(
  pieces: ReadonlyArray<Piece>,
  text: string,
  starts: ReadonlySet<number>,
): Set<number> {
  let cur = new Set(starts);
  for (const piece of pieces) {
    cur = stepPiece(piece, text, cur);
    if (cur.size === 0) break;
  }
  return cur;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/** Convierte una palabra de contexto en un fragmento de RegExp que ignora tildes. */
function contextWordSource(word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(/[aeiou]/gi, (v) => {
    const map: Record<string, string> = {
      a: "[aáà]",
      e: "[eéè]",
      i: "[iíì]",
      o: "[oóò]",
      u: "[uúü]",
    };
    return map[v.toLowerCase()] ?? v;
  });
}

/** Ventana de texto que se mira hacia atrás para el contexto (con palabras de relleno, más ancha). */
export const CONTEXT_WINDOW = 120;

/**
 * `(?:^|no-alfanumérico) palabra [relleno] \s* :? \s* $`, sobre lo que precede al match.
 * `gapWords` > 0 admite hasta ese número de palabras (sin dígitos) entre la palabra
 * de contexto y el dato, en el mismo tramo de texto (el prototipo no tiene saltos de línea).
 */
export function buildContextRegex(words: ReadonlyArray<string>, gapWords = 0): RegExp {
  const alt = words.map(contextWordSource).join("|");
  const gap = gapWords > 0 ? `(?:[\\s,]+[\\p{L}.°ºª]+){0,${gapWords}}` : "";
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${alt})${gap}\\s*:?\\s*$`, "iu");
}

export interface PieceScanOptions {
  readonly contextBefore?: ReadonlyArray<string>;
  readonly contextGapWords?: number;
  /** El match no puede empezar justo después de lo que cumple esta expresión (sobre los 2 caracteres previos). */
  readonly notAfter?: RegExp;
}

export function scanPieces(
  variants: ReadonlyArray<ReadonlyArray<Piece>>,
  text: string,
  normalize: (raw: string) => string,
  control: ((normalized: string) => boolean) | undefined,
  opts: PieceScanOptions = {},
): ReadonlyArray<Candidate> {
  const ctxRe =
    opts.contextBefore === undefined
      ? null
      : buildContextRegex(opts.contextBefore, opts.contextGapWords ?? 0);
  const out: Candidate[] = [];
  let i = 0;
  while (i < text.length) {
    if (isWordChar(text[i - 1]) && i > 0) {
      i += 1;
      continue;
    }
    if (opts.notAfter !== undefined && opts.notAfter.test(text.slice(Math.max(0, i - 2), i))) {
      i += 1;
      continue;
    }
    if (ctxRe !== null && !ctxRe.test(text.slice(Math.max(0, i - CONTEXT_WINDOW), i))) {
      i += 1;
      continue;
    }
    let best = -1;
    for (const variant of variants) {
      for (const e of advance(variant, text, new Set([i]))) {
        if (e > i && !isWordChar(text[e]) && e > best) best = e;
      }
    }
    if (best > i) {
      const raw = text.slice(i, best);
      const normalized = normalize(raw);
      out.push({
        start: i,
        end: best,
        normalized,
        ok: control === undefined ? true : control(normalized),
      });
      i = best;
    } else {
      i += 1;
    }
  }
  return out;
}
