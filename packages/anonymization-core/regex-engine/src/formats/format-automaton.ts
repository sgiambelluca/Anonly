/**
 * @anonly/regex-engine — Autómata de un formato del generador (ADR-220 §2).
 *
 * Fuente de verdad: docs/core/Regex_Engine.md §6, «Formatos del generador».
 * Un `FormatDefinition` no se ejecuta con `RegExp`: se compila a un autómata
 * finito no determinista (construcción de Thompson) y se recorre con una
 * simulación de estados en paralelo, sin retroceso. Cuesta
 * O(caracteres × estados) por página.
 */

import type { FormatCharClass, FormatDefinition, FormatPiece } from "@anonly/shared";

// ─── Etiquetas de las transiciones ───

export type FormatLabel =
  | { readonly kind: "class"; readonly charClass: FormatCharClass }
  | { readonly kind: "text"; readonly folded: string; readonly char: string }
  | {
      readonly kind: "separator";
      readonly codes: ReadonlySet<number>;
      /** `" "` entre los caracteres: reconoce cualquier espacio en blanco (`\s`). */
      readonly whitespace: boolean;
    };

export interface FormatMove {
  readonly label: FormatLabel;
  readonly to: number;
}

export interface CompiledFormat {
  /** Estados del autómata de Thompson (el que acota `FORMAT_MAX_STATES`). */
  readonly stateCount: number;
  readonly start: number;
  /** Transiciones por estado, ya con las ε resueltas (clausura del estado). */
  readonly moves: ReadonlyArray<ReadonlyArray<FormatMove>>;
  readonly accepting: ReadonlyArray<boolean>;
  readonly hasText: boolean;
  /** Palabras de contexto, plegadas carácter a carácter. `null` = sin contexto. */
  readonly contextWords: ReadonlyArray<ReadonlyArray<string>> | null;
}

export interface FormatSpan {
  readonly start: number;
  readonly end: number;
}

export interface ScanStats {
  /** Estados activos procesados por carácter: el costo del recorrido. */
  steps: number;
}

// ─── Clasificación de caracteres ───

const F_DIGIT = 1;
const F_LETTER = 2;
const F_UPPER = 4;
const F_LOWER = 8;
/** Letra o dígito (`[\p{L}\p{N}]`): lo que cuenta para los bordes. */
const F_BORDER = 16;
const F_SPACE = 32;

const LETTER_RE = /\p{L}/u;
const UPPER_RE = /\p{Lu}/u;
const LOWER_RE = /\p{Ll}/u;
const BORDER_RE = /[\p{L}\p{N}]/u;
const SPACE_RE = /\s/u;
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

const CACHE_LIMIT = 4096;

function computeFlags(cp: number): number {
  let flags = 0;
  if (cp >= 48 && cp <= 57) flags |= F_DIGIT;
  const ch = String.fromCodePoint(cp);
  if (LETTER_RE.test(ch)) flags |= F_LETTER;
  if (UPPER_RE.test(ch)) flags |= F_UPPER;
  if (LOWER_RE.test(ch)) flags |= F_LOWER;
  if (BORDER_RE.test(ch)) flags |= F_BORDER;
  if (SPACE_RE.test(ch)) flags |= F_SPACE;
  return flags;
}

const ASCII_FLAGS = new Uint8Array(128);
for (let cp = 0; cp < 128; cp++) ASCII_FLAGS[cp] = computeFlags(cp);
const FLAGS_CACHE = new Map<number, number>();

function classify(cp: number): number {
  if (cp < 128) return ASCII_FLAGS[cp] ?? 0;
  const cached = FLAGS_CACHE.get(cp);
  if (cached !== undefined) return cached;
  const flags = computeFlags(cp);
  if (FLAGS_CACHE.size >= CACHE_LIMIT) FLAGS_CACHE.clear();
  FLAGS_CACHE.set(cp, flags);
  return flags;
}

const FOLD_CACHE = new Map<number, string>();

/**
 * Pliegue de un carácter (ADR-220 §2, `text`): NFD, sin marcas combinantes
 * (`U+0300`–`U+036F`) y en minúsculas.
 */
export function foldCodePoint(cp: number): string {
  const cached = FOLD_CACHE.get(cp);
  if (cached !== undefined) return cached;
  const folded = String.fromCodePoint(cp)
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase();
  if (FOLD_CACHE.size >= CACHE_LIMIT) FOLD_CACHE.clear();
  FOLD_CACHE.set(cp, folded);
  return folded;
}

/** Pliega `value` carácter a carácter, tras llevarlo a NFC. */
export function foldChars(value: string): string[] {
  const folded: string[] = [];
  for (const ch of value.normalize("NFC")) {
    folded.push(foldCodePoint(ch.codePointAt(0) ?? 0));
  }
  return folded;
}

function codePointBefore(text: string, index: number): number {
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) {
      return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
    }
  }
  return low;
}

// ─── Construcción de Thompson ───

interface ThompsonState {
  readonly eps: number[];
  readonly moves: FormatMove[];
}

interface Fragment {
  readonly start: number;
  readonly end: number;
}

interface Thompson {
  readonly states: ReadonlyArray<ThompsonState>;
  readonly start: number;
  readonly accept: number;
  readonly hasText: boolean;
}

class StateLimitExceeded extends Error {}

function separatorLabel(chars: ReadonlyArray<string>): FormatLabel {
  const codes = new Set<number>();
  for (const ch of chars) codes.add(ch.codePointAt(0) ?? 0);
  return { kind: "separator", codes, whitespace: chars.includes(" ") };
}

/**
 * Construye el autómata de Thompson de `definition`. Devuelve `null` si pasa
 * de `limit` estados. La definición tiene que haber pasado las comprobaciones
 * de forma de `validateFormat` (rangos y largos acotados).
 */
function buildThompson(definition: FormatDefinition, limit: number): Thompson | null {
  const states: ThompsonState[] = [];
  let hasText = false;

  const newState = (): number => {
    if (states.length >= limit) throw new StateLimitExceeded();
    states.push({ eps: [], moves: [] });
    return states.length - 1;
  };
  const addEps = (from: number, to: number): void => {
    states[from]?.eps.push(to);
  };
  const atom = (label: FormatLabel): Fragment => {
    const start = newState();
    const end = newState();
    states[start]?.moves.push({ label, to: end });
    return { start, end };
  };
  const empty = (): Fragment => {
    const only = newState();
    return { start: only, end: only };
  };
  const concat = (first: Fragment, second: Fragment): Fragment => {
    addEps(first.end, second.start);
    return { start: first.start, end: second.end };
  };
  const concatAll = (fragments: ReadonlyArray<Fragment>): Fragment => {
    const [head, ...rest] = fragments;
    if (head === undefined) return empty();
    return rest.reduce(concat, head);
  };
  const optional = (inner: Fragment): Fragment => {
    const start = newState();
    const end = newState();
    addEps(start, inner.start);
    addEps(inner.end, end);
    addEps(start, end);
    return { start, end };
  };
  const repeat = (label: FormatLabel, min: number, max: number): Fragment => {
    const parts: Fragment[] = [];
    for (let i = 0; i < min; i++) parts.push(atom(label));
    let tail: Fragment | null = null;
    for (let remaining = max - min; remaining >= 1; remaining--) {
      const one = atom(label);
      tail = optional(tail === null ? one : concat(one, tail));
    }
    if (tail !== null) parts.push(tail);
    return concatAll(parts);
  };

  const buildPiece = (piece: FormatPiece): Fragment => {
    switch (piece.kind) {
      case "chars":
        return repeat({ kind: "class", charClass: piece.charClass }, piece.min, piece.max);
      case "text": {
        const atoms: Fragment[] = [];
        for (const ch of piece.value.normalize("NFC")) {
          hasText = true;
          atoms.push(
            atom({ kind: "text", folded: foldCodePoint(ch.codePointAt(0) ?? 0), char: ch }),
          );
        }
        return concatAll(atoms);
      }
      case "separator": {
        const one = atom(separatorLabel(piece.chars));
        return piece.optional ? optional(one) : one;
      }
      case "optional":
        return optional(concatAll(piece.pieces.map(buildPiece)));
    }
  };

  try {
    const fragments = definition.variants.map((pieces) => concatAll(pieces.map(buildPiece)));
    const start = newState();
    const accept = newState();
    for (const fragment of fragments) {
      addEps(start, fragment.start);
      addEps(fragment.end, accept);
    }
    return { states, start, accept, hasText };
  } catch (err: unknown) {
    if (err instanceof StateLimitExceeded) return null;
    throw err;
  }
}

/** `true` si el autómata de `definition` entra en `limit` estados (ADR-220 §2). */
export function fitsStateLimit(definition: FormatDefinition, limit: number): boolean {
  return buildThompson(definition, limit) !== null;
}

/** Compila `definition`, que tiene que ser válida en su forma. */
export function compileFormat(definition: FormatDefinition): CompiledFormat {
  const thompson = buildThompson(definition, Number.POSITIVE_INFINITY);
  if (thompson === null) {
    // Inalcanzable con límite infinito; se mantiene para estrechar el tipo.
    throw new StateLimitExceeded();
  }
  const { states, accept } = thompson;

  const moves: FormatMove[][] = [];
  const accepting: boolean[] = [];
  for (let origin = 0; origin < states.length; origin++) {
    const seen = new Set<number>([origin]);
    const stack = [origin];
    const collected: FormatMove[] = [];
    let reachesAccept = false;
    for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
      if (top === accept) reachesAccept = true;
      const state = states[top];
      if (state === undefined) continue;
      collected.push(...state.moves);
      for (const target of state.eps) {
        if (!seen.has(target)) {
          seen.add(target);
          stack.push(target);
        }
      }
    }
    moves.push(collected);
    accepting.push(reachesAccept);
  }

  const contextWords =
    definition.contextBefore === undefined ? null : definition.contextBefore.map(foldChars);

  return {
    stateCount: states.length,
    start: thompson.start,
    moves,
    accepting,
    hasText: thompson.hasText,
    contextWords,
  };
}

// ─── Recorrido ───

function labelMatches(label: FormatLabel, flags: number, cp: number, fold: string): boolean {
  switch (label.kind) {
    case "class":
      switch (label.charClass) {
        case "digit":
          return (flags & F_DIGIT) !== 0;
        case "letter":
          return (flags & F_LETTER) !== 0;
        case "upper":
          return (flags & F_UPPER) !== 0;
        case "lower":
          return (flags & F_LOWER) !== 0;
        case "alnum":
          return (flags & (F_LETTER | F_DIGIT)) !== 0;
      }
      return false;
    case "text":
      return fold === label.folded;
    case "separator":
      return label.codes.has(cp) || (label.whitespace && (flags & F_SPACE) !== 0);
  }
}

/** ¿La palabra (plegada) termina justo en `end` y empieza en un borde? */
function wordEndsAt(text: string, end: number, word: ReadonlyArray<string>): boolean {
  let position = end;
  for (let index = word.length - 1; index >= 0; index--) {
    if (position <= 0) return false;
    const cp = codePointBefore(text, position);
    if (foldCodePoint(cp) !== word[index]) return false;
    position -= cp > 0xffff ? 2 : 1;
  }
  if (position === 0) return true;
  return (classify(codePointBefore(text, position)) & F_BORDER) === 0;
}

/** Contexto (ADR-220 §2): `palabra\s*:?\s*` termina exactamente en `index`. */
function contextAllows(
  text: string,
  index: number,
  words: ReadonlyArray<ReadonlyArray<string>>,
): boolean {
  const ends: number[] = [];
  let end = index;
  while (end > 0 && SPACE_RE.test(text.charAt(end - 1))) end--;
  ends.push(end);
  if (end > 0 && text.charAt(end - 1) === ":") {
    let beforeColon = end - 1;
    while (beforeColon > 0 && SPACE_RE.test(text.charAt(beforeColon - 1))) beforeColon--;
    ends.push(beforeColon);
  }
  return ends.some((candidate) => words.some((word) => wordEndsAt(text, candidate, word)));
}

function startOf(starts: Int32Array, state: number): number {
  return starts[state] ?? -1;
}

/**
 * Recorre `text` y devuelve los matches del formato: la coincidencia más a la
 * izquierda y, de las que empiezan ahí, la más larga; después sigue desde su
 * final (ADR-220 §2). Los bordes y el contexto son parte del recorrido. Los
 * tramos salen tal cual los reconoce el autómata, sin recortar el espacio de
 * borde ni aplicar la guarda de corrida (eso es `detectFormatSpans`).
 *
 * Simulación de estados en paralelo (Pike): cada estado activo guarda el
 * comienzo más chico con el que se llegó a él, que domina a los demás porque
 * la continuación depende solo del estado y la posición.
 */
export function scanFormat(format: CompiledFormat, text: string, stats?: ScanStats): FormatSpan[] {
  const length = text.length;
  const spans: FormatSpan[] = [];
  let current: number[] = [];
  let following: number[] = [];
  let currentStarts = new Int32Array(format.stateCount).fill(-1);
  let followingStarts = new Int32Array(format.stateCount).fill(-1);
  let best: FormatSpan | null = null;
  let steps = 0;
  let index = 0;

  const clearCurrent = (): void => {
    for (const state of current) currentStarts[state] = -1;
    current.length = 0;
  };

  while (index <= length) {
    const cp = index < length ? (text.codePointAt(index) ?? 0) : -1;
    const flags = cp >= 0 ? classify(cp) : 0;

    // Un match empieza donde el carácter anterior no es letra ni dígito.
    const startsAtBorder = index === 0 || (classify(codePointBefore(text, index)) & F_BORDER) === 0;
    if (
      startsAtBorder &&
      startOf(currentStarts, format.start) === -1 &&
      (format.contextWords === null || contextAllows(text, index, format.contextWords))
    ) {
      current.push(format.start);
      currentStarts[format.start] = index;
    }

    // Y termina donde el siguiente no es letra ni dígito.
    if (current.length > 0 && (cp < 0 || (flags & F_BORDER) === 0)) {
      for (const state of current) {
        const start = startOf(currentStarts, state);
        if (format.accepting[state] !== true || start < 0 || start >= index) continue;
        if (best === null || start < best.start || (start === best.start && index > best.end)) {
          best = { start, end: index };
        }
      }
    }

    if (cp < 0) {
      if (best === null) break;
      spans.push(best);
      if (best.end >= length) break;
      clearCurrent();
      index = best.end;
      best = null;
      continue;
    }

    const fold = format.hasText ? foldCodePoint(cp) : "";
    for (const state of current) {
      steps++;
      const start = startOf(currentStarts, state);
      for (const move of format.moves[state] ?? []) {
        if (!labelMatches(move.label, flags, cp, fold)) continue;
        const known = startOf(followingStarts, move.to);
        if (known === -1) {
          following.push(move.to);
          followingStarts[move.to] = start;
        } else if (start < known) {
          followingStarts[move.to] = start;
        }
      }
    }
    clearCurrent();
    [current, following] = [following, current];
    [currentStarts, followingStarts] = [followingStarts, currentStarts];
    index += cp > 0xffff ? 2 : 1;

    // Con un match en mano, se cierra cuando ya no queda un candidato que
    // empiece en su comienzo o antes.
    if (best !== null) {
      let earliest = Number.POSITIVE_INFINITY;
      for (const state of current) {
        earliest = Math.min(earliest, startOf(currentStarts, state));
      }
      if (current.length === 0 || earliest > best.start) {
        spans.push(best);
        clearCurrent();
        index = best.end;
        best = null;
      }
    }
  }

  if (stats !== undefined) stats.steps += steps;
  return spans;
}
