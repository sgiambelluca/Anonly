/**
 * `formatBuilderModel.ts` — la parte pura del generador de formatos
 * (`Components.md` §13b.5, ADR-228): el borrador que se edita, las operaciones
 * sobre la tira de piezas (agregar, borrar, mover, arrastrar), y los textos
 * «Se lee» y «Ejemplo».
 *
 * Sale del componente para probarlo sin DOM (la aplicación no tiene jsdom). Todo
 * es inmutable: cada función devuelve datos nuevos y no toca los que recibe.
 *
 * **Rutas de pieza.** Una pieza se ubica con una ruta de uno o dos números:
 * `[i]` es la pieza `i` de la variante; `[i, j]` es la pieza `j` dentro de la
 * parte opcional que está en `i`. Una parte opcional no contiene otra
 * (ADR-220 §1), así que dos niveles alcanzan.
 */

import {
  FORMAT_ADMITTING_BASE_TYPES,
  FORMAT_MAX_PIECES,
  getCatalog,
  FORMAT_MAX_TEXT,
  FORMAT_MAX_VARIANTS,
  type EntityTypeId,
  type FormatCharClass,
  type FormatDefinition,
  type FormatPiece,
  type FormatSeparator,
  type UserEntityTypeDefinition,
} from "@anonly/anonymization-core";

import type { DetectionChange, DetectionState } from "../../store/detectionState.js";
import { ENTITY_TYPE_ORDER, ENTITY_TYPE_SINGULAR } from "../entities/entityTypeLabels.js";

import { buildFormatExample, pieceExample } from "./formatExamples.js";
import { countPieces, entityTypeName } from "./formatTexts.js";

export type Pieces = ReadonlyArray<FormatPiece>;
export type PiecePath = readonly [number] | readonly [number, number];

/** Un lugar donde puede caer una pieza: `parent` es el índice de la parte opcional, o `null` para la variante. */
export interface Slot {
  readonly parent: number | null;
  readonly index: number;
}

export interface MoveResult {
  readonly variant: Pieces;
  /** Dónde quedó la pieza movida. */
  readonly path: PiecePath;
}

// ─── Lectura y escritura de una pieza por su ruta ───

export function pieceAt(variant: Pieces, path: PiecePath): FormatPiece | undefined {
  const top = variant[path[0]];
  if (path.length === 1) return top;
  return top?.kind === "optional" ? top.pieces[path[1]] : undefined;
}

export function replaceAt(variant: Pieces, path: PiecePath, piece: FormatPiece): Pieces {
  if (path.length === 1) return variant.map((current, i) => (i === path[0] ? piece : current));
  return variant.map((current, i) =>
    i === path[0] && current.kind === "optional"
      ? { ...current, pieces: current.pieces.map((inner, j) => (j === path[1] ? piece : inner)) }
      : current,
  );
}

export function removeAt(variant: Pieces, path: PiecePath): Pieces {
  if (path.length === 1) return variant.filter((_, i) => i !== path[0]);
  return variant.map((current, i) =>
    i === path[0] && current.kind === "optional"
      ? { ...current, pieces: current.pieces.filter((_, j) => j !== path[1]) }
      : current,
  );
}

function spliceIn(list: Pieces, index: number, piece: FormatPiece): Pieces {
  const at = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, at), piece, ...list.slice(at)];
}

export function insertAt(variant: Pieces, slot: Slot, piece: FormatPiece): Pieces {
  if (slot.parent === null) return spliceIn(variant, slot.index, piece);
  return variant.map((current, i) =>
    i === slot.parent && current.kind === "optional"
      ? { ...current, pieces: spliceIn(current.pieces, slot.index, piece) }
      : current,
  );
}

function pathOfSlot(slot: Slot): PiecePath {
  return slot.parent === null ? [slot.index] : [slot.parent, slot.index];
}

export function samePath(a: PiecePath | null, b: PiecePath | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a[0] === b[0] && a[1] === b[1];
}

export function sameSlot(a: Slot | null, b: Slot | null): boolean {
  if (a === null || b === null) return a === b;
  return a.parent === b.parent && a.index === b.index;
}

/** El lugar justo antes de una pieza, y justo después. */
export function slotBefore(path: PiecePath): Slot {
  return path.length === 1 ? { parent: null, index: path[0] } : { parent: path[0], index: path[1] };
}

export function slotAfter(path: PiecePath): Slot {
  const before = slotBefore(path);
  return { parent: before.parent, index: before.index + 1 };
}

// ─── Mover: arrastrar y botones ───

/**
 * Suelta la pieza de `from` en `slot` (los índices del lugar son los de la
 * variante **antes** de sacar la pieza). `null` si no se puede: una parte
 * opcional no entra en otra (ADR-220 §1).
 */
export function moveToSlot(variant: Pieces, from: PiecePath, slot: Slot): MoveResult | null {
  const piece = pieceAt(variant, from);
  if (piece === undefined) return null;
  if (piece.kind === "optional" && slot.parent !== null) return null;

  let { parent, index } = slot;
  if (from.length === 1) {
    if (parent !== null) {
      if (from[0] === parent) return null;
      if (from[0] < parent) parent -= 1;
    } else if (from[0] < index) {
      index -= 1;
    }
  } else if (parent === from[0] && from[1] < index) {
    index -= 1;
  }

  const target: Slot = { parent, index };
  return { variant: insertAt(removeAt(variant, from), target, piece), path: pathOfSlot(target) };
}

/**
 * «Mover a la izquierda» (`-1`) y «Mover a la derecha» (`1`): el mismo
 * resultado que arrastrar, un paso por vez. Una pieza que se acerca a una parte
 * opcional entra en ella; al llegar a su borde, sale del otro lado. Una parte
 * opcional salta por encima de sus vecinas. `null` si no hay más lugar.
 */
export function moveStep(variant: Pieces, path: PiecePath, direction: -1 | 1): MoveResult | null {
  const piece = pieceAt(variant, path);
  if (piece === undefined) return null;

  if (path.length === 2) {
    const [outer, inner] = path;
    const next = inner + direction;
    const container = variant[outer];
    const size = container?.kind === "optional" ? container.pieces.length : 0;
    if (next >= 0 && next < size) {
      return moveToSlot(variant, path, { parent: outer, index: direction === 1 ? next + 1 : next });
    }
    return moveToSlot(variant, path, {
      parent: null,
      index: direction === 1 ? outer + 1 : outer,
    });
  }

  const [index] = path;
  const neighbourIndex = index + direction;
  const neighbour = variant[neighbourIndex];
  if (neighbour === undefined) return null;
  if (piece.kind !== "optional" && neighbour.kind === "optional") {
    return moveToSlot(variant, path, {
      parent: neighbourIndex,
      index: direction === 1 ? 0 : neighbour.pieces.length,
    });
  }
  return moveToSlot(variant, path, {
    parent: null,
    index: direction === 1 ? neighbourIndex + 1 : neighbourIndex,
  });
}

// ─── Agregar piezas: el menú «+ Pieza» ───

export type PieceClassId = "digits" | "letters" | "alnum" | "separator" | "text" | "optional";

export interface PieceMenuEntry {
  readonly id: PieceClassId;
  readonly label: string;
  readonly description: string;
  /** La ficha monoespaciada a la izquierda de la opción del menú «+ Pieza». */
  readonly glyph: string;
}

/** Las seis clases del menú, con la línea de ADR-228 §3. */
export const PIECE_MENU: ReadonlyArray<PieceMenuEntry> = [
  {
    id: "digits",
    label: "Dígitos",
    description: "Solo números, del 0 al 9. Ejemplo: 48213",
    glyph: "0–9",
  },
  {
    id: "letters",
    label: "Letras",
    description: "Solo letras, con o sin tilde. Ejemplo: Gómez",
    glyph: "Aa",
  },
  {
    id: "alnum",
    label: "Letras o dígitos",
    description: "Cualquiera de los dos, mezclados. Ejemplo: A1B2C3",
    glyph: "A1",
  },
  {
    id: "separator",
    label: "Separador",
    description: "Espacio, guion, punto o barra entre dos bloques",
    glyph: "- /",
  },
  {
    id: "text",
    label: "Texto fijo",
    description: "Siempre el mismo texto, como «HC-». Se tapa con el dato",
    glyph: "«»",
  },
  {
    id: "optional",
    label: "Parte opcional",
    description: "Un tramo que puede estar o no",
    glyph: "( )",
  },
];

/**
 * Lo que dice el ajuste de una parte opcional: cuántas piezas tiene y cómo se le
 * suman. Se suman con el «+» de adentro de la caja, en la tira, donde se ve dónde
 * caen (pasada de UI de la 1.1, 2026-11-21).
 */
export function describeOptionalContent(count: number): string {
  if (count === 0) {
    return "Todavía está vacía. Sumale piezas con el «+» de adentro de la caja, o arrastralas hasta ella.";
  }
  const pieces = count === 1 ? "1 pieza" : `${count} piezas`;
  return `Tiene ${pieces}. Sumale más con el «+» de adentro de la caja, o arrastralas hasta ella.`;
}

/**
 * Las cinco clases que se pueden sumar adentro de una parte opcional: todas menos
 * otra parte opcional (ADR-220 §1). «Letras o dígitos» se sumó en la pasada de UI
 * de la 1.1 (ADR-228 §4, precisión del 2026-11-21): afuera estaba y adentro no.
 */
export const OPTIONAL_INNER_MENU: ReadonlyArray<PieceMenuEntry> = PIECE_MENU.filter(
  (entry) => entry.id !== "optional",
);

/** Una pieza nueva con valores de partida que el usuario ajusta después. */
export function newPiece(id: PieceClassId): FormatPiece {
  switch (id) {
    case "digits":
      return { kind: "chars", charClass: "digit", min: 1, max: 1 };
    case "letters":
      return { kind: "chars", charClass: "letter", min: 1, max: 1 };
    case "alnum":
      return { kind: "chars", charClass: "alnum", min: 1, max: 1 };
    case "separator":
      return { kind: "separator", chars: ["-"], optional: false };
    case "text":
      return { kind: "text", value: "" };
    case "optional":
      return { kind: "optional", pieces: [] };
  }
}

/** Suma una pieza al final de la variante, o al final de la parte opcional `parent`. */
export function appendPiece(
  variant: Pieces,
  piece: FormatPiece,
  parent: number | null,
): MoveResult {
  const container = parent === null ? undefined : variant[parent];
  const index =
    parent === null ? variant.length : container?.kind === "optional" ? container.pieces.length : 0;
  const slot: Slot = { parent, index };
  return { variant: insertAt(variant, slot, piece), path: pathOfSlot(slot) };
}

// ─── Ajuste de una pieza `chars` ───

export type CharsKind = "digit" | "letter" | "alnum";
export type CharsPiece = Extract<FormatPiece, { readonly kind: "chars" }>;

export function charsKindOf(charClass: FormatCharClass): CharsKind {
  if (charClass === "digit") return "digit";
  if (charClass === "alnum") return "alnum";
  return "letter";
}

/** Cambia «Qué va». Al pasar a letras queda «Mayúsculas o minúsculas». */
export function withCharsKind(piece: CharsPiece, kind: CharsKind): CharsPiece {
  if (kind === charsKindOf(piece.charClass)) return piece;
  return { ...piece, charClass: kind === "letter" ? "letter" : kind };
}

export function withCharsCase(
  piece: CharsPiece,
  charClass: "letter" | "upper" | "lower",
): CharsPiece {
  return { ...piece, charClass };
}

/** «Exactamente» N: el mínimo y el máximo valen lo mismo. */
export function withExactly(piece: CharsPiece, count: number): CharsPiece {
  return { ...piece, min: count, max: count };
}

export function withRange(piece: CharsPiece, min: number, max: number): CharsPiece {
  return { ...piece, min, max };
}

/** Pasar de «Exactamente» a «Entre»: el máximo sube uno (o el mínimo baja uno en el tope). */
export function toRangeMode(piece: CharsPiece, repeatCap: number): CharsPiece {
  if (piece.min !== piece.max) return piece;
  return piece.max < repeatCap
    ? { ...piece, max: piece.max + 1 }
    : { ...piece, min: Math.max(1, piece.min - 1) };
}

/** Pasar de «Entre» a «Exactamente»: queda el mínimo. */
export function toExactMode(piece: CharsPiece): CharsPiece {
  return piece.min === piece.max ? piece : { ...piece, max: piece.min };
}

export function isExactly(piece: CharsPiece): boolean {
  return piece.min === piece.max;
}

/**
 * Los botones −/+ del ajuste de cantidad. «Exactamente» mueve los dos extremos
 * juntos; «Entre» mueve cada uno sin cruzar al otro. Todo dentro de 1..`repeatCap`.
 */
export function stepExactly(piece: CharsPiece, delta: number, repeatCap: number): CharsPiece {
  const next = Math.min(repeatCap, Math.max(1, piece.min + delta));
  return { ...piece, min: next, max: next };
}

export function stepMin(piece: CharsPiece, delta: number): CharsPiece {
  return { ...piece, min: Math.min(piece.max, Math.max(1, piece.min + delta)) };
}

export function stepMax(piece: CharsPiece, delta: number, repeatCap: number): CharsPiece {
  return { ...piece, max: Math.min(repeatCap, Math.max(piece.min, piece.max + delta)) };
}

/** Lo que escribe el usuario en un campo numérico: sin número, 0 (el Core lo marca inválido). */
export function parseCount(text: string): number {
  const value = Number.parseInt(text, 10);
  return Number.isNaN(value) ? 0 : value;
}

// ─── Ajuste de un separador ───

/** Los cuatro separadores, en el orden canónico del contrato. */
export const SEPARATOR_OPTIONS: ReadonlyArray<{
  readonly char: FormatSeparator;
  readonly label: string;
}> = [
  { char: " ", label: "Espacio" },
  { char: "-", label: "Guion" },
  { char: ".", label: "Punto" },
  { char: "/", label: "Barra" },
];

export function toggleSeparator(
  chars: ReadonlyArray<FormatSeparator>,
  char: FormatSeparator,
): ReadonlyArray<FormatSeparator> {
  const next = chars.includes(char) ? chars.filter((c) => c !== char) : [...chars, char];
  return SEPARATOR_OPTIONS.map((option) => option.char).filter((c) => next.includes(c));
}

// ─── La ficha de una pieza ───

export interface PieceCard {
  readonly title: string;
  readonly detail: string;
  readonly example: string;
}

function charsTitle(charClass: FormatCharClass): string {
  switch (charClass) {
    case "digit":
      return "Dígitos";
    case "alnum":
      return "Letras o dígitos";
    case "letter":
    case "upper":
    case "lower":
      return "Letras";
  }
}

function countDetail(piece: CharsPiece): string {
  const count =
    piece.min === piece.max ? `Exactamente ${piece.min}` : `Entre ${piece.min} y ${piece.max}`;
  if (piece.charClass === "upper") return `${count} · MAYÚSCULAS`;
  if (piece.charClass === "lower") return `${count} · minúsculas`;
  return count;
}

function separatorExample(chars: ReadonlyArray<FormatSeparator>): string {
  return chars.map((char) => (char === " " ? "␣" : char)).join(" ");
}

/**
 * El título del ajuste: «Pieza 2 de 5 · Separador». Una pieza de adentro de una
 * parte opcional lleva su posición compuesta: «Pieza 2.1 · Dígitos».
 */
export function pieceHeading(path: PiecePath, variantLength: number, piece: FormatPiece): string {
  const [first, second] = path;
  const where =
    second === undefined
      ? `Pieza ${first + 1} de ${variantLength}`
      : `Pieza ${first + 1}.${second + 1}`;
  return `${where} · ${pieceCard(piece).title}`;
}

/** Los tres renglones de una ficha: qué es, cuánto o cuál, y un texto de ejemplo. */
export function pieceCard(piece: FormatPiece): PieceCard {
  switch (piece.kind) {
    case "chars":
      return {
        title: charsTitle(piece.charClass),
        detail: countDetail(piece),
        example: pieceExample(piece),
      };
    case "separator":
      return {
        title: "Separador",
        detail: piece.optional ? "Puede faltar" : "Siempre está",
        example: separatorExample(piece.chars),
      };
    case "text":
      return { title: "Texto fijo", detail: "Siempre igual", example: piece.value };
    case "optional":
      return { title: "Parte opcional", detail: "Puede estar o no", example: pieceExample(piece) };
  }
}

// ─── Renglones: dónde sigue la lectura ───

/**
 * Los índices de las piezas que empiezan un renglón nuevo, dado el borde
 * superior de cada una (ADR-228 §3: una flecha al final del renglón y otra al
 * principio del siguiente).
 */
export function lineStarts(tops: ReadonlyArray<number>): ReadonlyArray<number> {
  const starts: number[] = [];
  for (let i = 1; i < tops.length; i += 1) {
    const previous = tops[i - 1];
    const current = tops[i];
    if (previous !== undefined && current !== undefined && current > previous + 1) starts.push(i);
  }
  return starts;
}

// ─── Límites que se muestran cuando queda poco (ADR-228 §2) ───

/** Cuántos lugares libres quedan cuando el contador de variantes aparece. */
export const VARIANT_COUNTER_FROM = 2;
/** Lo mismo para las piezas. */
export const PIECE_COUNTER_FROM = 3;

export interface LimitCounter {
  readonly visible: boolean;
  /** «6 de 8», o vacío si no se muestra. */
  readonly text: string;
  readonly atLimit: boolean;
}

function counter(used: number, max: number, from: number, noun: string): LimitCounter {
  return {
    visible: max - used <= from,
    text: `${used} de ${max} ${noun}`,
    atLimit: used >= max,
  };
}

export function variantCounter(variants: number): LimitCounter {
  return counter(variants, FORMAT_MAX_VARIANTS, VARIANT_COUNTER_FROM, "variantes");
}

export function pieceCounter(variant: Pieces): LimitCounter {
  return counter(countPieces(variant), FORMAT_MAX_PIECES, PIECE_COUNTER_FROM, "piezas");
}

// ─── «Se lee» ───

const SEPARATOR_NAME: Readonly<Record<FormatSeparator, string>> = {
  " ": "espacio",
  "-": "guion",
  ".": "punto",
  "/": "barra",
};

function listWithOr(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} o ${items[items.length - 1] ?? ""}`;
}

function charsNoun(charClass: FormatCharClass, plural: boolean): string {
  switch (charClass) {
    case "digit":
      return plural ? "dígitos" : "dígito";
    case "alnum":
      return plural ? "letras o dígitos" : "letra o dígito";
    case "letter":
      return plural ? "letras" : "letra";
    case "upper":
      return plural ? "letras mayúsculas" : "letra mayúscula";
    case "lower":
      return plural ? "letras minúsculas" : "letra minúscula";
  }
}

function describePiece(piece: FormatPiece): string {
  switch (piece.kind) {
    case "chars":
      if (piece.min === piece.max) {
        return `${piece.min} ${charsNoun(piece.charClass, piece.min !== 1)}`;
      }
      return `de ${piece.min} a ${piece.max} ${charsNoun(piece.charClass, true)}`;
    case "separator": {
      const names = piece.chars.map((char) => SEPARATOR_NAME[char]);
      const base = names.length === 0 ? "un separador sin elegir" : `un ${listWithOr(names)}`;
      return piece.optional ? `${base} (puede faltar)` : base;
    }
    case "text":
      return `el texto «${piece.value}»`;
    case "optional":
      return piece.pieces.length === 0
        ? "una parte opcional vacía"
        : `(opcional: ${piece.pieces.map(describePiece).join(", ")})`;
  }
}

function quotedWords(words: ReadonlyArray<string>): string {
  return listWithOr(words.map((word) => `«${word}»`));
}

/** «Después de «legajo» o «leg.»: 3 a 5 dígitos, un guion…», la variante dicha en palabras. */
export function describeVariant(variant: Pieces, contextWords: ReadonlyArray<string>): string {
  const body =
    variant.length === 0 ? "todavía no tiene piezas" : variant.map(describePiece).join(", ");
  const words = contextWords.filter((word) => word.trim() !== "");
  return words.length === 0 ? `${capitalize(body)}.` : `Después de ${quotedWords(words)}: ${body}.`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ─── El borrador del generador ───

export interface BuilderDraft {
  readonly name: string;
  readonly entityType: EntityTypeId;
  readonly variants: ReadonlyArray<Pieces>;
  /**
   * ADR-233: el nombre de cada variante, con el largo de `variants`; "" = el
   * automático. Ausente si ninguna tiene nombre: así un formato sin nombres no
   * cambia de forma al abrirlo y guardarlo.
   */
  readonly variantNames?: ReadonlyArray<string>;
  readonly context: ReadonlyArray<string>;
}

export type BuilderMode = "create" | "edit" | "copy";

/** Todo lo que el pedido decide antes de que el usuario toque nada. */
export interface BuilderSetup {
  readonly mode: BuilderMode;
  readonly title: string;
  readonly submitLabel: string;
  readonly draft: BuilderDraft;
  readonly id: string;
  readonly enabled: boolean;
  readonly basedOn?: string;
  /** «Es un…» fijo: una copia editada no cambia de tipo (ADR-228 §1). */
  readonly typeLocked: boolean;
  /** El aviso de «Editar uno base de pura forma» (ADR-228 §1); `null` en los demás casos. */
  readonly notice: string | null;
}

export const BUILDER_COPY = {
  createTitle: "Nuevo formato",
  createButton: "Crear formato",
  saveButton: "Guardar cambios",
  copyButton: "Guardar copia",
  editTitle: (name: string) => `Editar «${name}»`,
  line: "Armá la forma del dato con piezas, de izquierda a derecha.",
  copyNotice: (name: string) =>
    `Vas a editar una copia de «${name}»: el original se apaga y la copia detecta en su lugar. Con «Restaurar original» volvés al de antes.`,
  readyCreate: "Listo para crear.",
  readySave: "Listo para guardar.",
  readyDetail: "No se pisa con ningún formato prendido.",
  /** Estado vacío del ajuste de pieza (`UX_Guidelines.md` §11b.15, textual). */
  noPieceSelected:
    "Elegí una pieza para ajustarla, o sumá una con «Pieza». Arrastralas para cambiarles el orden; con clic derecho, las movés o las borrás.",
  /** El rótulo del separador opcional, con los ejemplos de ese separador. */
  separatorOptional: (separator: string) =>
    `Puede faltar: «12${separator}345» y «12345» valen igual`,
} as const;

export type BuilderRequestLike =
  | { readonly kind: "create"; readonly entityType: EntityTypeId }
  | { readonly kind: "edit"; readonly formatId: string }
  | { readonly kind: "editBase"; readonly catalogId: string };

export function resolveBuilderSetup(
  request: BuilderRequestLike,
  state: DetectionState,
  newId: () => string,
): BuilderSetup | null {
  if (request.kind === "create") {
    return {
      mode: "create",
      title: BUILDER_COPY.createTitle,
      submitLabel: BUILDER_COPY.createButton,
      draft: { name: "", entityType: request.entityType, variants: [[]], context: [] },
      id: `fmt:${newId()}`,
      enabled: true,
      typeLocked: false,
      notice: null,
    };
  }
  if (request.kind === "edit") {
    const format = state.userFormats.find((candidate) => candidate.id === request.formatId);
    if (format === undefined) return null;
    return {
      mode: "edit",
      title: BUILDER_COPY.editTitle(format.name),
      submitLabel: BUILDER_COPY.saveButton,
      draft: draftOf(format, format.name),
      id: format.id,
      enabled: format.enabled,
      ...(format.basedOn !== undefined ? { basedOn: format.basedOn } : {}),
      typeLocked: format.basedOn !== undefined,
      notice: null,
    };
  }
  const info = getCatalog(state.country).find((candidate) => candidate.id === request.catalogId);
  const definition = info?.definition;
  if (info === undefined || info.kind !== "structure" || definition === undefined) return null;
  return {
    mode: "copy",
    title: BUILDER_COPY.editTitle(info.name),
    submitLabel: BUILDER_COPY.copyButton,
    draft: draftOf(definition, info.name),
    id: `fmt:${newId()}`,
    enabled: true,
    basedOn: info.id,
    typeLocked: true,
    notice: BUILDER_COPY.copyNotice(info.name),
  };
}

function draftOf(format: FormatDefinition, name: string): BuilderDraft {
  const variants = format.variants.length === 0 ? [[]] : format.variants;
  return withVariants(
    { name, entityType: format.entityType, variants, context: format.contextBefore ?? [] },
    variants,
    variants.map((_, index) => format.variantNames?.[index] ?? ""),
  );
}

/** La definición que el borrador describe: lo que se valida, se prueba y se entrega. */
export function buildDefinition(draft: BuilderDraft, setup: BuilderSetup): FormatDefinition {
  return {
    id: setup.id,
    name: draft.name.trim(),
    entityType: draft.entityType,
    variants: draft.variants,
    ...(draft.variantNames !== undefined
      ? { variantNames: draft.variantNames.map((name) => name.trim()) }
      : {}),
    ...(draft.context.length > 0 ? { contextBefore: draft.context } : {}),
    ...(setup.basedOn !== undefined ? { basedOn: setup.basedOn } : {}),
    enabled: setup.enabled,
  };
}

/** El cambio que `onSubmit` entrega, según el caso (`detectionState.ts`). */
export function submitChange(setup: BuilderSetup, definition: FormatDefinition): DetectionChange {
  switch (setup.mode) {
    case "create":
      return { kind: "createFormat", definition };
    case "edit":
      return { kind: "editFormat", definition };
    case "copy":
      return { kind: "createEditedCopy", definition };
  }
}

export function hasChanges(initial: BuilderDraft, current: BuilderDraft): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}

/** El ejemplo de una variante armado con sus piezas (sin las palabras de contexto). */
export function exampleOfVariant(variant: Pieces, definition: FormatDefinition): string {
  return buildFormatExample({ ...definition, variants: [variant] });
}

// ─── Palabras de contexto (ADR-228 §5) ───

/** Suma una palabra: recortada, no vacía, sin repetir (sin distinguir mayúsculas) y hasta el tope. */
export function addContextWord(
  words: ReadonlyArray<string>,
  raw: string,
  max: number,
): ReadonlyArray<string> {
  const word = raw.trim();
  if (word === "" || words.length >= max) return words;
  const lower = word.toLowerCase();
  if (words.some((existing) => existing.toLowerCase() === lower)) return words;
  return [...words, word];
}

export function removeContextWord(
  words: ReadonlyArray<string>,
  index: number,
): ReadonlyArray<string> {
  return words.filter((_, i) => i !== index);
}

// ─── Variantes ───

export function addVariant(variants: ReadonlyArray<Pieces>): ReadonlyArray<Pieces> {
  return [...variants, []];
}

export function removeVariant(
  variants: ReadonlyArray<Pieces>,
  index: number,
): ReadonlyArray<Pieces> {
  // Con una sola, no se borra (ADR-228 §2).
  return variants.length <= 1 ? variants : variants.filter((_, i) => i !== index);
}

/**
 * «Duplicar variante» (ADR-228 §2, precisión del 2026-11-21): una copia de la
 * variante `index` justo después de ella. En el tope de variantes no cambia nada.
 */
export function duplicateVariant(
  variants: ReadonlyArray<Pieces>,
  index: number,
): ReadonlyArray<Pieces> {
  const source = variants[index];
  if (source === undefined || variants.length >= FORMAT_MAX_VARIANTS) return variants;
  return [...variants.slice(0, index + 1), source, ...variants.slice(index + 1)];
}

// ─── Nombres de variante (ADR-233) ───

/** El nombre automático de la variante `index`, por posición. */
export function automaticVariantName(index: number): string {
  return `Variante ${index + 1}`;
}

/** El nombre que el usuario le puso a la variante `index`, recortado; "" si no tiene. */
export function variantNameAt(draft: BuilderDraft, index: number): string {
  return draft.variantNames?.[index]?.trim() ?? "";
}

/** Lo que dice la pestaña: el nombre, o «Variante N». */
export function variantLabel(draft: BuilderDraft, index: number): string {
  const name = variantNameAt(draft, index);
  return name === "" ? automaticVariantName(index) : name;
}

/** El nombre de la copia de «Duplicar variante»: «Copia de » + el que se ve, hasta el tope. */
export function copyVariantName(label: string): string {
  // Por caracteres y no por unidades de UTF-16: no parte un emoji al medio.
  return Array.from(`Copia de ${label}`).slice(0, FORMAT_MAX_TEXT).join("").trimEnd();
}

function namesOf(draft: BuilderDraft): ReadonlyArray<string> {
  return draft.variants.map((_, index) => draft.variantNames?.[index] ?? "");
}

/** El borrador con estas variantes y nombres; sin `variantNames` si ninguna tiene nombre. */
function withVariants(
  draft: BuilderDraft,
  variants: ReadonlyArray<Pieces>,
  names: ReadonlyArray<string>,
): BuilderDraft {
  const base = { name: draft.name, entityType: draft.entityType, variants, context: draft.context };
  return names.some((name) => name.trim() !== "") ? { ...base, variantNames: names } : base;
}

/** «+ Variante»: una vacía al final, sin nombre. */
export function draftWithNewVariant(draft: BuilderDraft): BuilderDraft {
  return withVariants(draft, addVariant(draft.variants), [...namesOf(draft), ""]);
}

/** «Borrar variante…» ya confirmado: se va con su nombre. Con una sola, no cambia. */
export function draftWithoutVariant(draft: BuilderDraft, index: number): BuilderDraft {
  if (draft.variants.length <= 1) return draft;
  return withVariants(
    draft,
    removeVariant(draft.variants, index),
    namesOf(draft).filter((_, i) => i !== index),
  );
}

/** «Duplicar variante»: la copia va justo después, con el nombre «Copia de …». */
export function draftWithDuplicate(draft: BuilderDraft, index: number): BuilderDraft {
  const variants = duplicateVariant(draft.variants, index);
  if (variants === draft.variants) return draft;
  const names = namesOf(draft);
  const copy = copyVariantName(variantLabel(draft, index));
  return withVariants(draft, variants, [
    ...names.slice(0, index + 1),
    copy,
    ...names.slice(index + 1),
  ]);
}

/** «Cambiar nombre…»: recortado; vacío vuelve al automático. */
export function draftWithVariantName(
  draft: BuilderDraft,
  index: number,
  name: string,
): BuilderDraft {
  const names = namesOf(draft).map((current, i) => (i === index ? name.trim() : current));
  return withVariants(draft, draft.variants, names);
}

/** La pieza cambió en la variante `index`: los nombres quedan como estaban. */
export function draftWithVariant(
  draft: BuilderDraft,
  index: number,
  variant: Pieces,
): BuilderDraft {
  return withVariants(draft, replaceVariant(draft.variants, index, variant), namesOf(draft));
}

export function replaceVariant(
  variants: ReadonlyArray<Pieces>,
  index: number,
  variant: Pieces,
): ReadonlyArray<Pieces> {
  return variants.map((current, i) => (i === index ? variant : current));
}

// ─── «Es un…» ───

export interface TypeOption {
  readonly value: string;
  readonly label: string;
  readonly type: EntityTypeId;
}

/**
 * Los tipos entre los que elige «Es un…»: los del usuario, y los base que admiten
 * formatos propios (ADR-220 §5). Si el tipo actual no está en la lista (un tipo
 * que ya no existe), se conserva para que el selector no quede vacío y el
 * estado diga por qué.
 */
export function typeOptions(
  userTypes: ReadonlyArray<UserEntityTypeDefinition>,
  current: EntityTypeId,
): ReadonlyArray<TypeOption> {
  const options: TypeOption[] = [
    ...userTypes.map((type) => ({ value: type.id as string, label: type.name, type: type.id })),
    ...ENTITY_TYPE_ORDER.filter((type) => FORMAT_ADMITTING_BASE_TYPES.has(type)).map((type) => ({
      value: type as string,
      label: ENTITY_TYPE_SINGULAR[type],
      type: type as EntityTypeId,
    })),
  ];
  if (!options.some((option) => option.type === current)) {
    options.push({ value: current, label: entityTypeName(current, userTypes), type: current });
  }
  return options;
}
