/**
 * @anonly/regex-engine — compareFormat (ADR-220 §3).
 *
 * Fuente de verdad: docs/core/Regex_Engine.md §6, «Funciones puras del
 * generador», y docs/core/Contracts.md §5.2. Responde dos preguntas: si un
 * formato es idéntico a otro (misma forma canónica) y con cuáles comparte
 * algún texto (producto de autómatas contra los de autómata, ejemplos contra
 * los `control`). No recibe `EngineContext`, no emite y no loguea.
 */

import type {
  CatalogFormatRef,
  FormatCharClass,
  FormatComparison,
  FormatComparisonInput,
  FormatDefinition,
  FormatPiece,
} from "@anonly/shared";

import { BASE_CATALOG } from "../patterns/catalog.js";
import type { RegexPattern } from "../regex.types.js";
import { passesRunGuard } from "../run-guard.js";

import {
  compileFormat,
  foldChars,
  type CompiledFormat,
  type FormatLabel,
} from "./format-automaton.js";
import { hasShapeIssue } from "./format-validation.js";

// ─── Forma canónica ───

function canonicalPiece(piece: FormatPiece): string {
  switch (piece.kind) {
    case "chars":
      return JSON.stringify(["c", piece.charClass, piece.min, piece.max]);
    case "text":
      return JSON.stringify(["t", foldChars(piece.value).join("")]);
    case "separator":
      return JSON.stringify(["s", [...new Set(piece.chars)].sort(), piece.optional]);
    case "optional":
      return JSON.stringify(["o", piece.pieces.map(canonicalPiece)]);
  }
}

/**
 * Ordena y deduplica los `chars` de cada `separator`, pliega los `text` y las
 * palabras de contexto, ordena y deduplica las palabras de contexto y ordena
 * las variantes. No entran `id`, `name`, `entityType`, `basedOn` ni `enabled`.
 */
export function canonicalForm(definition: FormatDefinition): string {
  const variants = definition.variants
    .map((pieces) => JSON.stringify(pieces.map(canonicalPiece)))
    .sort();
  const context = [
    ...new Set((definition.contextBefore ?? []).map((word) => foldChars(word).join(""))),
  ].sort();
  return JSON.stringify([variants, context]);
}

// ─── Producto de autómatas ───

const CLASS_PATTERNS: Readonly<Record<FormatCharClass, RegExp>> = {
  digit: /^[0-9]$/,
  letter: /^\p{L}$/u,
  upper: /^\p{Lu}$/u,
  lower: /^\p{Ll}$/u,
  alnum: /^[\p{L}0-9]$/u,
};
const WHITESPACE_RE = /^\s$/u;
const SEPARATOR_CANDIDATES: ReadonlyArray<string> = [" ", "-", ".", "/"];

function charInClass(charClass: FormatCharClass, ch: string): boolean {
  return CLASS_PATTERNS[charClass].test(ch);
}

/** La clase que reconoce justo lo que reconocen las dos, o `null` si no comparten ninguna. */
function sharedClass(a: FormatCharClass, b: FormatCharClass): FormatCharClass | null {
  if (a === b) return a;
  if (a === "alnum") return b;
  if (b === "alnum") return a;
  if (a === "letter" && (b === "upper" || b === "lower")) return b;
  if (b === "letter" && (a === "upper" || a === "lower")) return a;
  return null;
}

/** Representante de una clase: `1` para digit, `a` para lower, `A` para las demás. */
function classRepresentative(charClass: FormatCharClass): string {
  if (charClass === "digit") return "1";
  if (charClass === "lower") return "a";
  return "A";
}

function separatorAccepts(label: Extract<FormatLabel, { kind: "separator" }>, ch: string): boolean {
  return label.codes.has(ch.codePointAt(0) ?? -1) || (label.whitespace && WHITESPACE_RE.test(ch));
}

function textCandidates(label: Extract<FormatLabel, { kind: "text" }>): string[] {
  return [label.char, label.folded, label.char.toUpperCase(), label.char.toLowerCase()].filter(
    (candidate) => Array.from(candidate).length === 1,
  );
}

/**
 * El carácter con el que dos transiciones avanzan juntas, o `null` si no
 * comparten ninguno. Un `text` aporta su carácter; si no, el representante de
 * la clase que comparten; un `separator`, el menor carácter que comparten.
 */
function sharedChar(a: FormatLabel, b: FormatLabel): string | null {
  if (a.kind === "class" && b.kind === "class") {
    const shared = sharedClass(a.charClass, b.charClass);
    return shared === null ? null : classRepresentative(shared);
  }
  if (a.kind === "text" && b.kind === "text") {
    if (a.folded !== b.folded) return null;
    return a.char <= b.char ? a.char : b.char;
  }
  if (a.kind === "separator" && b.kind === "separator") {
    return (
      SEPARATOR_CANDIDATES.find(
        (candidate) => separatorAccepts(a, candidate) && separatorAccepts(b, candidate),
      ) ?? null
    );
  }
  if (a.kind === "text") return sharedWithText(a, b);
  if (b.kind === "text") return sharedWithText(b, a);
  return null;
}

function sharedWithText(
  text: Extract<FormatLabel, { kind: "text" }>,
  other: FormatLabel,
): string | null {
  if (other.kind === "text") return null;
  const candidates = textCandidates(text);
  if (other.kind === "class") {
    const { charClass } = other;
    return candidates.find((candidate) => charInClass(charClass, candidate)) ?? null;
  }
  return candidates.find((candidate) => separatorAccepts(other, candidate)) ?? null;
}

/**
 * El texto más corto que reconocen los dos autómatas, sin bordes ni contexto:
 * búsqueda en anchura sobre el producto. Entre los más cortos gana el menor en
 * orden de code units, así que el ejemplo es determinista.
 */
export function shortestSharedText(a: CompiledFormat, b: CompiledFormat): string | null {
  const width = b.stateCount;
  let layer = new Map<number, string>([[a.start * width + b.start, ""]]);
  const visited = new Set<number>(layer.keys());

  while (layer.size > 0) {
    let accepted: string | null = null;
    const next = new Map<number, string>();
    for (const [key, text] of layer) {
      const stateA = Math.floor(key / width);
      const stateB = key % width;
      if (text.length > 0 && a.accepting[stateA] === true && b.accepting[stateB] === true) {
        if (accepted === null || text < accepted) accepted = text;
      }
      if (accepted !== null) continue;
      for (const moveA of a.moves[stateA] ?? []) {
        for (const moveB of b.moves[stateB] ?? []) {
          const ch = sharedChar(moveA.label, moveB.label);
          if (ch === null) continue;
          const nextKey = moveA.to * width + moveB.to;
          if (visited.has(nextKey)) continue;
          const candidate = text + ch;
          const known = next.get(nextKey);
          if (known === undefined || candidate < known) next.set(nextKey, candidate);
        }
      }
    }
    if (accepted !== null) return accepted;
    for (const key of next.keys()) visited.add(key);
    layer = next;
  }
  return null;
}

// ─── Ejemplos contra un formato `control` ───

function countOptionalUnits(pieces: ReadonlyArray<FormatPiece>): number {
  let count = 0;
  for (const piece of pieces) {
    if (piece.kind === "separator" && piece.optional) count++;
    if (piece.kind === "optional") count += 1 + countOptionalUnits(piece.pieces);
  }
  return count;
}

/*
 * Arma un texto de la variante: `digit` con `1`, `letter` y `alnum` con `A`
 * (`a` si es `lower`), cada `separator` con su primer carácter. `isOn` decide,
 * por número de unidad opcional (un `optional` o un `separator` opcional, en
 * el orden del recorrido), si esa parte entra.
 */
function renderVariant(
  pieces: ReadonlyArray<FormatPiece>,
  longest: boolean,
  isOn: (unit: number) => boolean,
): string {
  let unit = 0;
  const render = (list: ReadonlyArray<FormatPiece>): string => {
    let out = "";
    for (const piece of list) {
      switch (piece.kind) {
        case "chars":
          out += classRepresentative(piece.charClass).repeat(longest ? piece.max : piece.min);
          break;
        case "text":
          out += piece.value;
          break;
        case "separator": {
          const included = !piece.optional || isOn(unit++);
          if (included) out += piece.chars[0] ?? "";
          break;
        }
        case "optional": {
          const included = isOn(unit++);
          const inner = render(piece.pieces);
          if (included) out += inner;
          break;
        }
      }
    }
    return out;
  };
  return render(pieces);
}

/**
 * Para cada variante, el ejemplo más corto y el más largo, con y sin cada
 * `optional`: todo apagado, todo prendido, y cada unidad opcional sola
 * prendida y sola apagada.
 */
function generateExamples(definition: FormatDefinition): string[] {
  const examples = new Set<string>();
  for (const pieces of definition.variants) {
    const units = countOptionalUnits(pieces);
    const switches: Array<(unit: number) => boolean> = [() => false, () => true];
    for (let only = 0; only < units; only++) {
      switches.push(
        (unit) => unit === only,
        (unit) => unit !== only,
      );
    }
    for (const longest of [false, true]) {
      for (const isOn of switches) examples.add(renderVariant(pieces, longest, isOn));
    }
  }
  examples.delete("");
  return [...examples];
}

/** ¿El `RegExp` del formato, con su checksum y su guarda, reconoce `example` entero? */
function controlRecognizes(pattern: RegexPattern, example: string): boolean {
  const flags = pattern.pattern.flags.includes("g")
    ? pattern.pattern.flags
    : `${pattern.pattern.flags}g`;
  const scan = new RegExp(pattern.pattern.source, flags);
  for (let found = scan.exec(example); found !== null; found = scan.exec(example)) {
    const value = found[0];
    if (value.length === 0) {
      scan.lastIndex += 1;
      continue;
    }
    if (found.index !== 0 || value.length !== example.length) continue;
    if (pattern.checksum !== undefined && !pattern.checksum(pattern.normalizer(value))) continue;
    if (!passesRunGuard(example, 0, example.length, value)) continue;
    return true;
  }
  return false;
}

function shortestControlOverlap(
  definition: FormatDefinition,
  pattern: RegexPattern,
): string | null {
  const recognized = generateExamples(definition).filter((example) =>
    controlRecognizes(pattern, example),
  );
  recognized.sort((x, y) => x.length - y.length || (x < y ? -1 : x > y ? 1 : 0));
  return recognized[0] ?? null;
}

// ─── Candidatos ───

type Candidate =
  /** Con autómata: un formato propio o un `structure` del catálogo. */
  | { readonly kind: "automaton"; readonly id: string; readonly definition: FormatDefinition }
  /** `control`: lo que corre es su `RegExp`. */
  | { readonly kind: "control"; readonly id: string; readonly pattern: RegexPattern };

type CatalogEntry = (typeof BASE_CATALOG)[number];

function catalogCandidate(id: string, entry: CatalogEntry): Candidate {
  const { definition } = entry.info;
  return definition === undefined
    ? { kind: "control", id, pattern: entry.pattern }
    : { kind: "automaton", id, definition };
}

function resolveReference(reference: CatalogFormatRef): CatalogEntry | undefined {
  return BASE_CATALOG.find(
    ({ info }) =>
      info.id === reference.catalogFormatId &&
      (info.country === reference.country || info.country === "universal"),
  );
}

function candidatesOf(definition: FormatDefinition, others: FormatComparisonInput): Candidate[] {
  const candidates: Candidate[] = [];

  // Los formatos base del país que corren (prendidos y sin copia prendida).
  for (const entry of BASE_CATALOG) {
    const { info } = entry;
    if (info.country !== others.country && info.country !== "universal") continue;
    const setting = others.baseFormats.find((item) => item.formatId === info.id);
    if (setting?.enabled === false) continue;
    if (others.userFormats.some((copy) => copy.enabled && copy.basedOn === info.id)) continue;
    candidates.push(catalogCandidate(info.id, entry));
  }

  // Todos los propios, prendidos o apagados.
  for (const userFormat of others.userFormats) {
    if (userFormat.id === definition.id || hasShapeIssue(userFormat)) continue;
    candidates.push({ kind: "automaton", id: userFormat.id, definition: userFormat });
  }

  // Todas las referencias, prendidas o apagadas.
  for (const reference of others.catalogRefs) {
    const target = resolveReference(reference);
    if (target !== undefined) candidates.push(catalogCandidate(reference.id, target));
  }
  return candidates;
}

const compiledBaseCache = new Map<string, CompiledFormat>();

/** Los `structure` del catálogo son constantes: se compilan una sola vez. */
function compiledOf(definition: FormatDefinition): CompiledFormat {
  if (!definition.id.startsWith("fmt:base:")) return compileFormat(definition);
  const cached = compiledBaseCache.get(definition.id);
  if (cached !== undefined) return cached;
  const compiled = compileFormat(definition);
  compiledBaseCache.set(definition.id, compiled);
  return compiled;
}

/**
 * ADR-220 §3: compara `definition` con los formatos que corren de base de
 * `others.country`, y con todos los propios y las referencias, prendidos o
 * apagados. Un formato idéntico figura solo en `identicalTo`.
 */
export function compareFormat(
  definition: FormatDefinition,
  others: FormatComparisonInput,
): FormatComparison {
  if (hasShapeIssue(definition)) return { identicalTo: null, overlaps: [] };

  const canonical = canonicalForm(definition);
  const own = compileFormat(definition);
  let identicalTo: string | null = null;
  const overlaps: Array<{ readonly formatId: string; readonly example: string }> = [];

  for (const candidate of candidatesOf(definition, others)) {
    if (candidate.kind === "control") {
      const example = shortestControlOverlap(definition, candidate.pattern);
      if (example !== null) overlaps.push({ formatId: candidate.id, example });
      continue;
    }
    if (canonicalForm(candidate.definition) === canonical) {
      identicalTo ??= candidate.id;
      continue;
    }
    const example = shortestSharedText(own, compiledOf(candidate.definition));
    if (example !== null) overlaps.push({ formatId: candidate.id, example });
  }
  return { identicalTo, overlaps };
}
