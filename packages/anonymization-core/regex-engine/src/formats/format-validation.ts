/**
 * @anonly/regex-engine — validateFormat y testFormat (ADR-220 §3).
 *
 * Fuente de verdad: docs/core/Contracts.md §5.2 (semántica normativa) y
 * docs/core/Regex_Engine.md §6, «Funciones puras del generador». No reciben
 * `EngineContext`, no emiten eventos y no loguean.
 */

import {
  EntityType,
  FORMAT_ADMITTING_BASE_TYPES,
  FORMAT_MAX_CONTEXT,
  FORMAT_MAX_PIECES,
  FORMAT_MAX_REPEAT,
  FORMAT_MAX_STATES,
  FORMAT_MAX_TEXT,
  FORMAT_MAX_VARIANTS,
  isUserEntityType,
  normalizeForComparison,
  type FormatDefinition,
  type FormatIssue,
  type FormatIssueCode,
  type FormatPiece,
  type FormatTestMatch,
  type FormatValidation,
  type FormatValidationContext,
} from "@anonly/shared";

import { compileFormat, fitsStateLimit } from "./format-automaton.js";
import { detectFormatSpans } from "./format-detect.js";

const BASE_ENTITY_TYPES: ReadonlySet<string> = new Set<string>(Object.values(EntityType));
const FORMAT_ID_RE = /^fmt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Códigos que no cambian qué reconoce un formato: `testFormat` no los revisa
 * porque no recibe el contexto (Contracts.md §5.2).
 */
const CODES_OUTSIDE_THE_SHAPE: ReadonlySet<FormatIssueCode> = new Set<FormatIssueCode>([
  "name_empty",
  "name_too_long",
  "name_taken",
  "type_unknown",
  "type_not_admitted",
  "id_invalid",
  "variant_name_too_long",
  "variant_names_mismatch",
]);

/** Códigos que impiden compilar el autómata para contar sus estados. */
const CODES_THAT_BLOCK_COMPILING: ReadonlySet<FormatIssueCode> = new Set<FormatIssueCode>([
  "too_many_variants",
  "too_many_pieces",
  "chars_range_invalid",
  "chars_repeat_too_large",
  "text_too_long",
]);

function lengthInCharacters(value: string): number {
  return Array.from(value).length;
}

interface PieceWalk {
  pieceCount: number;
  hasChars: boolean;
}

/*
 * Recorre las piezas de una variante en orden, y cuenta las de adentro de un
 * `optional` a continuación de él: el `pieceIndex` de un issue es la posición
 * en ese recorrido, y la cantidad total es la que acota FORMAT_MAX_PIECES.
 */
function checkPieces(
  pieces: ReadonlyArray<FormatPiece>,
  variantIndex: number,
  insideOptional: boolean,
  walk: PieceWalk,
  issues: FormatIssue[],
): void {
  for (const piece of pieces) {
    const pieceIndex = walk.pieceCount++;
    const report = (code: FormatIssueCode): void => {
      issues.push({ code, variantIndex, pieceIndex });
    };
    switch (piece.kind) {
      case "chars": {
        walk.hasChars = true;
        const { min, max } = piece;
        if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
          report("chars_range_invalid");
        }
        if (max > FORMAT_MAX_REPEAT) report("chars_repeat_too_large");
        break;
      }
      case "text":
        if (piece.value.length === 0) report("text_empty");
        else if (lengthInCharacters(piece.value) > FORMAT_MAX_TEXT) report("text_too_long");
        break;
      case "separator":
        if (piece.chars.length === 0) report("separator_empty");
        break;
      case "optional":
        if (insideOptional) report("optional_nested");
        if (piece.pieces.length === 0) report("optional_empty");
        checkPieces(piece.pieces, variantIndex, true, walk, issues);
        break;
    }
  }
}

function checkContext(definition: FormatDefinition, issues: FormatIssue[]): void {
  const words = definition.contextBefore;
  if (words === undefined) return;
  if (words.length === 0 || words.some((word) => word.trim().length === 0)) {
    issues.push({ code: "context_empty" });
  }
  if (words.some((word) => lengthInCharacters(word) > FORMAT_MAX_TEXT)) {
    issues.push({ code: "context_too_long" });
  }
  if (words.length > FORMAT_MAX_CONTEXT) issues.push({ code: "too_many_context_words" });
}

/*
 * ADR-233: el nombre de cada variante (`Contracts.md` §5.2). Se miden solo los
 * de variantes que existen: los que sobran ya dan `variant_names_mismatch`. Un
 * nombre en blanco, de cualquier largo, es el automático y no se mide, como el
 * nombre del formato (que vacío da `name_empty` y nunca `name_too_long`).
 * Los repetidos se admiten.
 */
function checkVariantNames(definition: FormatDefinition, issues: FormatIssue[]): void {
  const names = definition.variantNames;
  if (names === undefined) return;
  if (names.length !== definition.variants.length) {
    issues.push({ code: "variant_names_mismatch" });
  }
  names.slice(0, definition.variants.length).forEach((name, variantIndex) => {
    if (name.trim() !== "" && lengthInCharacters(name) > FORMAT_MAX_TEXT) {
      issues.push({ code: "variant_name_too_long", variantIndex });
    }
  });
}

function checkType(
  definition: FormatDefinition,
  context: FormatValidationContext,
  issues: FormatIssue[],
): void {
  const type = definition.entityType;
  if (isUserEntityType(type)) {
    if (!context.userTypes.some((userType) => userType.id === type)) {
      issues.push({ code: "type_unknown" });
    }
  } else if (!BASE_ENTITY_TYPES.has(type)) {
    issues.push({ code: "type_unknown" });
  } else if (!FORMAT_ADMITTING_BASE_TYPES.has(type)) {
    issues.push({ code: "type_not_admitted" });
  }
}

/**
 * ADR-220 §3: valida un formato contra los límites de `Contracts.md` §6, la
 * forma de sus piezas, su nombre y su tipo. Devuelve cada problema con su
 * código, y `variantIndex` y `pieceIndex` cuando corresponden.
 */
export function validateFormat(
  definition: FormatDefinition,
  context: FormatValidationContext,
): FormatValidation {
  const issues: FormatIssue[] = [];

  if (definition.name.trim().length === 0) issues.push({ code: "name_empty" });
  else if (lengthInCharacters(definition.name) > FORMAT_MAX_TEXT) {
    issues.push({ code: "name_too_long" });
  }
  const nameKey = normalizeForComparison(definition.name);
  if (context.existingFormats.some((other) => normalizeForComparison(other.name) === nameKey)) {
    issues.push({ code: "name_taken" });
  }

  if (definition.variants.length === 0) issues.push({ code: "no_variants" });
  if (definition.variants.length > FORMAT_MAX_VARIANTS) issues.push({ code: "too_many_variants" });

  definition.variants.forEach((pieces, variantIndex) => {
    if (pieces.length === 0) {
      issues.push({ code: "variant_empty", variantIndex });
      return;
    }
    const walk: PieceWalk = { pieceCount: 0, hasChars: false };
    checkPieces(pieces, variantIndex, false, walk, issues);
    if (walk.pieceCount > FORMAT_MAX_PIECES) issues.push({ code: "too_many_pieces", variantIndex });
    if (!walk.hasChars) issues.push({ code: "variant_without_chars", variantIndex });
  });

  checkVariantNames(definition, issues);
  checkContext(definition, issues);

  const canCompile = !issues.some((issue) => CODES_THAT_BLOCK_COMPILING.has(issue.code));
  if (canCompile && !fitsStateLimit(definition, FORMAT_MAX_STATES)) {
    issues.push({ code: "too_many_states" });
  }

  checkType(definition, context, issues);
  if (!FORMAT_ID_RE.test(definition.id)) issues.push({ code: "id_invalid" });

  return { ok: issues.length === 0, issues };
}

/**
 * `true` si `validateFormat` daría algún código de la forma del formato, es
 * decir, alguno fuera de los que no cambian qué se reconoce (nombre, nombres de
 * variante, tipo e id).
 */
export function hasShapeIssue(definition: FormatDefinition): boolean {
  const { issues } = validateFormat(definition, { userTypes: [], existingFormats: [] });
  return issues.some((issue) => !CODES_OUTSIDE_THE_SHAPE.has(issue.code));
}

/**
 * ADR-220 §3: los tramos de `sampleText` que `process` detectaría con este
 * formato. Mismo recorrido que `process`, sobre el texto tal como llega.
 * Devuelve `[]` si el formato tiene un problema de forma.
 */
export function testFormat(
  definition: FormatDefinition,
  sampleText: string,
): ReadonlyArray<FormatTestMatch> {
  if (hasShapeIssue(definition)) return [];
  return detectFormatSpans(compileFormat(definition), sampleText).map(({ start, end }) => ({
    start,
    end,
  }));
}
