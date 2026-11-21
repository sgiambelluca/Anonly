/**
 * `formatTexts.ts` — la tabla de textos de falla de tipos y formatos
 * (`UX_Guidelines.md` §11b.16, decisión del mantenedor del 2026-11-20).
 *
 * **Todo código de falla que llega a la interfaz tiene un texto**, y está
 * acá: `UserEntityTypeIssueCode`, `FormatIssueCode` y `FormatsFileIssueCode`.
 * Los componentes no escriben textos de falla en línea. Cada `Record` está
 * indexado por la unión completa, así que un código nuevo en el Core no
 * compila hasta que se le escribe su texto.
 *
 * Cada texto dice dos cosas: **por qué** no se puede, con el dato concreto que
 * choca (`why`), y **qué hacer** (`todo`). Nunca muestra el código ni un
 * mensaje técnico. Se guardan por separado porque el motivo de un elemento de
 * un archivo importado reusa solo el «por qué» (§11b.16, `{MOTIVO}`).
 *
 * Los números son los límites de `Contracts.md` §6 y salen de sus constantes.
 * Las llaves `{…}` del documento son los parámetros de cada función.
 */

import {
  FORMAT_ADMITTING_BASE_TYPES,
  FORMAT_MAX_CONTEXT,
  FORMAT_MAX_PIECES,
  FORMAT_MAX_REPEAT,
  FORMAT_MAX_TEXT,
  FORMAT_MAX_VARIANTS,
  isUserEntityType,
  USER_TYPE_NAME_MAX,
  USER_TYPE_SHORT_LABEL_MAX,
  userTypeLabel,
  validateFormat,
  validateUserEntityType,
  type CountryCode,
  type EntityTypeId,
  type FormatDefinition,
  type FormatIssue,
  type FormatIssueCode,
  type FormatPiece,
  type FormatsFileIssueCode,
  type UserEntityTypeDefinition,
  type UserEntityTypeIssueCode,
} from "@anonly/anonymization-core";

import { ENTITY_TYPE_ORDER, ENTITY_TYPE_SINGULAR } from "../entities/entityTypeLabels.js";

/** Un texto de falla: el porqué (sin punto final) y qué hacer. */
interface IssueText<Params> {
  readonly why: (params: Params) => string;
  readonly todo: string;
}

function compose(text: { readonly why: string; readonly todo: string }): string {
  return `${text.why}. ${text.todo}`;
}

/** Cuántos caracteres de un valor escrito por el usuario entran entre « » en un mensaje de falla. */
export const QUOTED_VALUE_MAX = 10;

/**
 * Acorta un valor que escribió el usuario para meterlo entre «» en una línea de
 * ayuda de una sola línea: hasta `max` caracteres y «…». Lo que se corta es el
 * valor, no la explicación que lo rodea.
 */
export function shortenQuoted(value: string, max: number = QUOTED_VALUE_MAX): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max).join("")}…`;
}

/** «el nombre…» a partir de «El nombre…»: el motivo de §11b.16, en minúscula y sin el «qué hacer». */
function asReason(why: string): string {
  return why.charAt(0).toLowerCase() + why.slice(1);
}

// ─── Tipos propios (UserEntityTypeIssueCode, ranura del formulario) ───

export interface TypeIssueParams {
  readonly name: string;
  readonly level1: string | undefined;
  readonly level2: string | undefined;
}

const NAME_ALLOWED = /^[\p{L}\p{N} -]$/u;
const SHORT_LABEL_ALLOWED = new RegExp(`^[\\p{L}\\p{N}]{1,${USER_TYPE_SHORT_LABEL_MAX}}$`, "u");

/** El primer carácter del nombre que no es letra, número, espacio ni guion. */
function firstInvalidChar(name: string): string {
  for (const char of name) {
    if (!NAME_ALLOWED.test(char)) return char;
  }
  return "";
}

/** La primera versión corta escrita que no cumple (§11b.16, `{TEXTO}`). */
function firstInvalidShortLabel(params: TypeIssueParams): string {
  for (const label of [params.level1, params.level2]) {
    if (label !== undefined && label !== "" && !SHORT_LABEL_ALLOWED.test(label)) return label;
  }
  return "";
}

const TYPE_ISSUE_TEXTS: Readonly<Record<UserEntityTypeIssueCode, IssueText<TypeIssueParams>>> = {
  name_empty: {
    why: () => "El tipo necesita un nombre",
    todo: "Escribí cómo querés llamarlo, por ejemplo «Historia clínica».",
  },
  name_too_long: {
    why: ({ name }) =>
      `El nombre tiene ${name.length} caracteres y el máximo es ${USER_TYPE_NAME_MAX}`,
    todo: "Acortalo.",
  },
  name_invalid_chars: {
    why: ({ name }) =>
      `El nombre tiene «${firstInvalidChar(name)}», y solo se admiten letras, números, espacios y guiones`,
    todo: "Sacalo o cambialo.",
  },
  name_without_letter: {
    why: () =>
      "El nombre necesita al menos una letra: con solo números o guiones no se entiende en el documento",
    todo: "Sumá una palabra.",
  },
  short_label_invalid: {
    why: (params) =>
      `La versión corta «${shortenQuoted(firstInvalidShortLabel(params))}» tiene que tener de 1 a ${USER_TYPE_SHORT_LABEL_MAX} letras o números, sin espacios ni signos`,
    todo: "Corregila, o dejala vacía para usar la automática.",
  },
  label_taken: {
    why: ({ name }) =>
      `Ya hay un tipo que se reemplaza como ${userTypeLabel(name)}, y en el documento no se distinguirían`,
    todo: "Elegí otro nombre.",
  },
  id_invalid: {
    why: () => "Este tipo quedó dañado y no se puede guardar",
    todo: "Crealo de nuevo.",
  },
  id_taken: {
    why: () => "Este tipo choca con otro guardado y no se puede guardar",
    todo: "Crealo de nuevo.",
  },
};

function typeParams(definition: UserEntityTypeDefinition): TypeIssueParams {
  return {
    name: definition.name,
    level1: definition.shortLabels?.level1,
    level2: definition.shortLabels?.level2,
  };
}

/** El texto completo de un código de falla de tipo, para la ranura del formulario. */
export function userTypeIssueText(
  code: UserEntityTypeIssueCode,
  definition: UserEntityTypeDefinition,
): string {
  const text = TYPE_ISSUE_TEXTS[code];
  return compose({ why: text.why(typeParams(definition)), todo: text.todo });
}

/** Solo el «por qué», en minúscula: el `{MOTIVO}` de un tipo de un archivo importado. */
export function userTypeIssueReason(
  code: UserEntityTypeIssueCode,
  definition: UserEntityTypeDefinition,
): string {
  return asReason(TYPE_ISSUE_TEXTS[code].why(typeParams(definition)));
}

// ─── Formatos (FormatIssueCode, caja de estado del generador) ───

/** Cuántas piezas cuenta `pieceIndex`: el `optional` y las de adentro (`Contracts.md` §5.2). */
export function countPieces(pieces: ReadonlyArray<FormatPiece>): number {
  return pieces.reduce(
    (total, piece) => total + 1 + (piece.kind === "optional" ? countPieces(piece.pieces) : 0),
    0,
  );
}

/** La pieza con ese índice en preorden dentro de la variante, o `undefined`. */
export function pieceAtPreorder(
  variant: ReadonlyArray<FormatPiece>,
  index: number,
): FormatPiece | undefined {
  let position = 0;
  function walk(pieces: ReadonlyArray<FormatPiece>): FormatPiece | undefined {
    for (const piece of pieces) {
      if (position === index) return piece;
      position += 1;
      if (piece.kind === "optional") {
        const found = walk(piece.pieces);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }
  return walk(variant);
}

/** El nombre que la interfaz muestra para un tipo (de un formato). */
export function entityTypeName(
  type: EntityTypeId,
  userTypes: ReadonlyArray<UserEntityTypeDefinition>,
): string {
  if (isUserEntityType(type)) {
    return userTypes.find((candidate) => candidate.id === type)?.name ?? "sin nombre";
  }
  return ENTITY_TYPE_SINGULAR[type];
}

/** `{TIPOS ADMITIDOS}`: de `FORMAT_ADMITTING_BASE_TYPES`, con los nombres de la interfaz y en su orden. */
export function admittedTypesList(): string {
  return ENTITY_TYPE_ORDER.filter((type) => FORMAT_ADMITTING_BASE_TYPES.has(type))
    .map((type) => ENTITY_TYPE_SINGULAR[type])
    .join(", ");
}

export interface FormatIssueParams {
  /** `variantIndex` del issue, contado desde 1 (`{N}`); 0 si el problema es del formato entero. */
  readonly variant: number;
  /**
   * Cómo se nombra esa variante en el texto (`{N}`): su nombre entre comillas si
   * tiene uno (ADR-233), o su número.
   */
  readonly variantRef: string;
  /** `pieceIndex` del issue, contado desde 1 (`{P}`). */
  readonly piece: number;
  readonly definition: FormatDefinition;
  readonly userTypes: ReadonlyArray<UserEntityTypeDefinition>;
}

function pieceOf(params: FormatIssueParams): FormatPiece | undefined {
  const variant = params.definition.variants[params.variant - 1];
  return variant === undefined ? undefined : pieceAtPreorder(variant, params.piece - 1);
}

function variantPieceCount(params: FormatIssueParams): number {
  const variant = params.definition.variants[params.variant - 1];
  return variant === undefined ? 0 : countPieces(variant);
}

function variantNameLength(params: FormatIssueParams): number {
  return (params.definition.variantNames?.[params.variant - 1] ?? "").length;
}

/**
 * Cómo se nombra la variante `index` en un texto: «Con guiones» si tiene nombre
 * (ADR-233), o su número. `{N}` de `UX_Guidelines.md` §11b.16.
 */
export function variantReference(definition: FormatDefinition, index: number): string {
  const name = definition.variantNames?.[index]?.trim() ?? "";
  return name === "" ? String(index + 1) : `«${shortenQuoted(name)}»`;
}

function charsOf(params: FormatIssueParams): { readonly min: number; readonly max: number } {
  const piece = pieceOf(params);
  return piece?.kind === "chars" ? { min: piece.min, max: piece.max } : { min: 0, max: 0 };
}

function textLengthOf(params: FormatIssueParams): number {
  const piece = pieceOf(params);
  return piece?.kind === "text" ? piece.value.length : 0;
}

/** La primera palabra de contexto que no cumple (§11b.16, `{PALABRA}`). */
function longContextWord(params: FormatIssueParams): string {
  return (
    (params.definition.contextBefore ?? []).find((word) => word.length > FORMAT_MAX_TEXT) ?? ""
  );
}

const FORMAT_ISSUE_TEXTS: Readonly<Record<FormatIssueCode, IssueText<FormatIssueParams>>> = {
  name_empty: {
    why: () => "El formato necesita un nombre",
    todo: "Escribí uno que te ayude a reconocerlo en la lista.",
  },
  name_too_long: {
    why: ({ definition }) =>
      `El nombre tiene ${definition.name.length} caracteres y el máximo es ${FORMAT_MAX_TEXT}`,
    todo: "Acortalo.",
  },
  name_taken: {
    why: ({ definition }) => `Ya tenés un formato llamado «${shortenQuoted(definition.name)}»`,
    todo: "Elegí otro nombre para distinguirlos en la lista.",
  },
  no_variants: {
    why: () => "El formato no tiene ninguna variante",
    todo: "Sumá una con «+ Variante».",
  },
  // ADR-233: {N} es el número, porque lo que falla es el nombre.
  variant_name_too_long: {
    why: (params) =>
      `El nombre de la variante ${params.variant} tiene ${variantNameLength(params)} caracteres y el máximo es ${FORMAT_MAX_TEXT}`,
    todo: "Acortalo.",
  },
  variant_names_mismatch: {
    why: () => "Los nombres de las variantes de este formato quedaron dañados",
    todo: "Crealo de nuevo.",
  },
  too_many_variants: {
    why: ({ definition }) =>
      `Un formato admite hasta ${FORMAT_MAX_VARIANTS} variantes y este tiene ${definition.variants.length}`,
    todo: "Borrá alguna o creá otro formato.",
  },
  variant_empty: {
    why: ({ variantRef }) => `La variante ${variantRef} no tiene piezas`,
    todo: "Sumá una con «+ Pieza» o borrá la variante.",
  },
  variant_without_chars: {
    why: ({ variantRef }) =>
      `La variante ${variantRef} tiene solo textos fijos y separadores, y así no reconoce ningún dato`,
    todo: "Sumale un bloque de letras o números.",
  },
  too_many_pieces: {
    why: (params) =>
      `La variante ${params.variantRef} tiene ${variantPieceCount(params)} piezas y el máximo es ${FORMAT_MAX_PIECES}, contando las de las partes opcionales`,
    todo: "Juntá bloques o borrá alguna.",
  },
  chars_range_invalid: {
    why: (params) => {
      const { min, max } = charsOf(params);
      return `En la pieza ${params.piece} de la variante ${params.variantRef}, «Cuántos» va de ${min} a ${max}: el mínimo tiene que ser 1 o más y no pasar del máximo`;
    },
    todo: "Corregí los números.",
  },
  chars_repeat_too_large: {
    why: (params) =>
      `En la pieza ${params.piece} de la variante ${params.variantRef}, el máximo es ${charsOf(params).max} y un bloque admite hasta ${FORMAT_MAX_REPEAT}`,
    todo: "Bajalo o partí el dato en dos bloques.",
  },
  text_empty: {
    why: ({ piece, variantRef }) =>
      `El texto fijo de la pieza ${piece} (variante ${variantRef}) está vacío`,
    todo: "Escribilo o borrá la pieza.",
  },
  text_too_long: {
    why: (params) =>
      `El texto fijo de la pieza ${params.piece} (variante ${params.variantRef}) tiene ${textLengthOf(params)} caracteres y el máximo es ${FORMAT_MAX_TEXT}`,
    todo: "Acortalo.",
  },
  separator_empty: {
    why: ({ piece, variantRef }) =>
      `El separador de la pieza ${piece} (variante ${variantRef}) no tiene ningún carácter elegido`,
    todo: "Elegí al menos uno o borrá la pieza.",
  },
  optional_empty: {
    why: ({ variantRef }) => `Hay una parte opcional vacía en la variante ${variantRef}`,
    todo: "Arrastrale una pieza o borrala.",
  },
  optional_nested: {
    why: ({ variantRef }) =>
      `Una parte opcional no puede ir dentro de otra (variante ${variantRef})`,
    todo: "Sacala afuera.",
  },
  context_empty: {
    why: () => "Hay una palabra de contexto vacía",
    todo: "Escribila o sacala.",
  },
  context_too_long: {
    why: (params) => {
      const word = longContextWord(params);
      return `La palabra de contexto «${shortenQuoted(word)}» tiene ${word.length} caracteres y el máximo es ${FORMAT_MAX_TEXT}`;
    },
    todo: "Acortala.",
  },
  too_many_context_words: {
    why: ({ definition }) =>
      `Un formato admite hasta ${FORMAT_MAX_CONTEXT} palabras de contexto y este tiene ${(definition.contextBefore ?? []).length}`,
    todo: "Sacá alguna.",
  },
  too_many_states: {
    why: () => "El formato es demasiado complejo para revisarlo rápido en cada página",
    todo: "Achicá los rangos de «Cuántos», sacá partes opcionales o partilo en dos formatos.",
  },
  type_unknown: {
    why: ({ definition, userTypes }) =>
      `El tipo «${shortenQuoted(entityTypeName(definition.entityType, userTypes))}» ya no existe`,
    todo: "Elegí otro en «Es un…».",
  },
  type_not_admitted: {
    why: ({ definition, userTypes }) =>
      `A «${shortenQuoted(entityTypeName(definition.entityType, userTypes))}» no se le pueden sumar formatos propios`,
    // El resto de la oración lleva `{TIPOS ADMITIDOS}`: se arma en `formatIssueTodo`.
    todo: "",
  },
  id_invalid: {
    why: () => "Este formato quedó dañado y no se puede guardar",
    todo: "Crealo de nuevo.",
  },
};

function formatParams(
  issue: FormatIssue,
  definition: FormatDefinition,
  userTypes: ReadonlyArray<UserEntityTypeDefinition>,
): FormatIssueParams {
  return {
    variant: issue.variantIndex === undefined ? 0 : issue.variantIndex + 1,
    variantRef:
      issue.variantIndex === undefined ? "" : variantReference(definition, issue.variantIndex),
    piece: issue.pieceIndex === undefined ? 0 : issue.pieceIndex + 1,
    definition,
    userTypes,
  };
}

function formatIssueTodo(code: FormatIssueCode): string {
  if (code === "type_not_admitted") {
    return `En «Es un…» elegí ${admittedTypesList()} o uno de tus tipos.`;
  }
  return FORMAT_ISSUE_TEXTS[code].todo;
}

/** El texto completo de un issue de formato, para la caja de estado del generador. */
export function formatIssueText(
  issue: FormatIssue,
  definition: FormatDefinition,
  userTypes: ReadonlyArray<UserEntityTypeDefinition>,
): string {
  const why = FORMAT_ISSUE_TEXTS[issue.code].why(formatParams(issue, definition, userTypes));
  return `${why}. ${formatIssueTodo(issue.code)}`;
}

/** Solo el «por qué», en minúscula: el `{MOTIVO}` de un formato de un archivo importado. */
export function formatIssueReason(
  issue: FormatIssue,
  definition: FormatDefinition,
  userTypes: ReadonlyArray<UserEntityTypeDefinition>,
): string {
  return asReason(FORMAT_ISSUE_TEXTS[issue.code].why(formatParams(issue, definition, userTypes)));
}

// ─── Importar un archivo (FormatsFileIssueCode, diálogo «No se importó nada») ───

export interface FileIssueParams {
  /** `{UBICACIÓN}`: el elemento en palabras, nunca el `path` crudo. */
  readonly location: string;
  /** `{NOMBRE}` del tipo o del formato del archivo. */
  readonly name: string;
  /** `{MOTIVO}`: el «por qué» del primer código de validación del elemento. */
  readonly reason: string;
}

const FILE_ISSUE_TEXTS: Readonly<
  Record<FormatsFileIssueCode, (params: FileIssueParams) => string>
> = {
  not_json: () =>
    "No se pudo leer el archivo: está dañado o no es un archivo de formatos. Elegí otro archivo.",
  wrong_kind: () =>
    "El archivo no es de formatos de Anonly. Elegí uno exportado desde «Exportar formatos».",
  version_invalid: () =>
    "El archivo no dice de qué versión es, así que no se puede leer con seguridad. Exportalo de nuevo desde Anonly.",
  version_newer: () =>
    "El archivo es de una versión más nueva de Anonly o trae formatos de un país que esta versión no tiene. Actualizá Anonly y volvé a importarlo.",
  schema_invalid: ({ location }) =>
    `El archivo está incompleto o se modificó a mano: ${location} no tiene la forma esperada. Exportalo de nuevo desde Anonly.`,
  type_invalid: ({ name, reason }) =>
    `El tipo «${name}» del archivo no se puede crear: ${reason}. Corregilo donde se creó y exportalo de nuevo.`,
  format_invalid: ({ name, reason }) =>
    `El formato «${name}» del archivo tiene un problema: ${reason}. Corregilo donde se creó y exportalo de nuevo.`,
  format_type_missing: ({ name }) =>
    `El formato «${name}» es de un tipo que no viene en el archivo. Exportalo de nuevo junto con su tipo.`,
};

/** `{UBICACIÓN}`: el elemento en palabras («el tipo 2», «el formato 3»). */
export function describeFilePath(path: string | undefined): string {
  const match =
    path === undefined ? null : /^(types|formats|catalogRefs)(?:\[(\d+)\])?$/.exec(path);
  if (match === null) return "el archivo";
  const section = match[1];
  const position = match[2] === undefined ? undefined : Number(match[2]) + 1;
  if (section === "types")
    return position === undefined ? "la lista de tipos" : `el tipo ${position}`;
  if (section === "formats") {
    return position === undefined ? "la lista de formatos" : `el formato ${position}`;
  }
  return position === undefined ? "la lista de referencias" : `la referencia ${position}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFileSections(text: string): {
  readonly types: ReadonlyArray<unknown>;
  readonly formats: ReadonlyArray<unknown>;
} {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return { types: [], formats: [] };
    const types = parsed["types"];
    const formats = parsed["formats"];
    return {
      types: Array.isArray(types) ? types : [],
      formats: Array.isArray(formats) ? formats : [],
    };
  } catch {
    return { types: [], formats: [] };
  }
}

function indexOfPath(path: string | undefined): number {
  const match = path === undefined ? null : /\[(\d+)\]$/.exec(path);
  return match === null || match[1] === undefined ? -1 : Number(match[1]);
}

function nameOf(item: unknown): string {
  return isRecord(item) && typeof item["name"] === "string" ? item["name"] : "sin nombre";
}

/**
 * Los textos de un archivo rechazado, uno por issue de `validateFormatsFile`.
 * El issue dice solo qué elemento falló (`path`), no por qué: `{MOTIVO}` sale de
 * volver a validar ese tipo o formato con el mismo contexto que el façade
 * (§11b.16). `text` es el contenido del archivo; sale de esta función solo como
 * texto de interfaz y nunca se guarda ni se loguea.
 */
export function describeFormatsFileIssues(
  text: string,
  issues: ReadonlyArray<{ readonly code: FormatsFileIssueCode; readonly path?: string }>,
  country: CountryCode,
): ReadonlyArray<string> {
  const { types, formats } = parseFileSections(text);
  // La forma ya la validó el façade antes de llegar a `type_invalid`/`format_invalid`.
  const typeDefinitions = types as ReadonlyArray<UserEntityTypeDefinition>;
  const formatDefinitions = formats as ReadonlyArray<FormatDefinition>;

  return issues.map((issue) => {
    const index = indexOfPath(issue.path);
    const location = describeFilePath(issue.path);
    if (issue.code === "type_invalid") {
      const definition = typeDefinitions[index];
      const first =
        definition === undefined
          ? undefined
          : validateUserEntityType(definition, {
              country,
              existing: typeDefinitions.filter((_other, otherIndex) => otherIndex !== index),
            }).issues[0];
      return FILE_ISSUE_TEXTS.type_invalid({
        location,
        name: nameOf(definition),
        reason:
          definition === undefined || first === undefined
            ? "no cumple lo que pide un tipo"
            : userTypeIssueReason(first.code, definition),
      });
    }
    if (issue.code === "format_invalid" || issue.code === "format_type_missing") {
      const definition = formatDefinitions[index];
      const name = nameOf(definition);
      if (issue.code === "format_type_missing") {
        return FILE_ISSUE_TEXTS.format_type_missing({ location, name, reason: "" });
      }
      const typeIsMissing =
        definition !== undefined &&
        isUserEntityType(definition.entityType) &&
        !typeDefinitions.some((type) => type.id === definition.entityType);
      const first =
        definition === undefined
          ? undefined
          : validateFormat(definition, {
              userTypes: typeDefinitions,
              existingFormats: [],
            }).issues.find((candidate) => !(typeIsMissing && candidate.code === "type_unknown"));
      return FILE_ISSUE_TEXTS.format_invalid({
        location,
        name,
        reason:
          definition === undefined || first === undefined
            ? "no cumple lo que pide un formato"
            : formatIssueReason(first, definition, typeDefinitions),
      });
    }
    return FILE_ISSUE_TEXTS[issue.code]({ location, name: "", reason: "" });
  });
}

/** Los textos de una falla de forma `FormatsFileIssueCode` sin elemento (`not_json`, `wrong_kind`, …). */
export function formatsFileIssueText(code: FormatsFileIssueCode, location = "el archivo"): string {
  return FILE_ISSUE_TEXTS[code]({ location, name: "", reason: "" });
}

// ─── Formatos que comparten textos (aviso amarillo) ───

/** Un formato con el que otro comparte textos, y el texto más corto que los dos reconocen (si se conoce). */
export interface OverlapTarget {
  readonly name: string;
  readonly example?: string;
}

/** Cuántos nombres lista el aviso antes de resumir el resto. */
const OVERLAP_NAMES_SHOWN = 3;

function listOverlapNames(names: ReadonlyArray<string>): string {
  const quoted = names.map((name) => `«${name}»`);
  if (quoted.length <= OVERLAP_NAMES_SHOWN) {
    if (quoted.length <= 1) return quoted.join("");
    return `${quoted.slice(0, -1).join(", ")} y ${quoted[quoted.length - 1] ?? ""}`;
  }
  const hidden = quoted.length - 2;
  return `${quoted.slice(0, 2).join(", ")} y ${hidden} más`;
}

const OVERLAP_RESOLVE = "Si se pisan en un documento, elegís en el panel de conflicto.";

/** El aviso amarillo del generador, en dos tramos: el titular (en negrita) y el detalle. */
export interface OverlapParts {
  readonly headline: string;
  readonly detail: string;
}

/**
 * El aviso amarillo de un formato que comparte textos con otros (ADR-220 §3,
 * ADR-228 §7), para la caja de estado del generador: titular y detalle.
 */
export function describeOverlapParts(others: ReadonlyArray<OverlapTarget>): OverlapParts {
  const first = others.find((other) => other.example !== undefined && other.example !== "");
  const who =
    others.length > 1 && first !== undefined ? `«${first.name}» y este formato` : "Los dos";
  const example =
    first?.example === undefined ? "" : `${who} reconocen, por ejemplo, ${first.example}. `;
  return {
    headline: `Comparte textos con ${listOverlapNames(others.map((other) => other.name))}.`,
    detail: `${example}${OVERLAP_RESOLVE}`,
  };
}

/**
 * El mismo aviso en una sola oración, para el resumen de importar un archivo.
 * `subject` es el nombre del formato; sin nombre, «Este formato».
 */
export function describeOverlap(
  subject: string | null,
  others: ReadonlyArray<OverlapTarget>,
): string {
  const who = subject === null || subject.trim() === "" ? "Este formato" : `«${subject}»`;
  const first = others.find((other) => other.example !== undefined && other.example !== "");
  const example = first?.example === undefined ? "" : `, por ejemplo ${first.example}`;
  return `${who} comparte textos con ${listOverlapNames(others.map((other) => other.name))}${example}. ${OVERLAP_RESOLVE}`;
}

// ─── Textos de «Formatos de detección» (lista, filas, avisos; pasada de textos F7) ───

/** La etiqueta de un formato base de pura forma: se edita como copia. */
export const BASE_STRUCTURE_LABEL = "Del catálogo · se edita como copia";
/** La etiqueta de un formato base con verificación (el catálogo no dice qué control lleva). */
export const BASE_CONTROL_LABEL = "Con verificación";

/** La aclaración de cada sección del árbol. */
export const SECTION_HINTS = {
  own: "Los creaste vos: se pueden editar y borrar",
  catalog: "Vienen con Anonly, para Argentina: no se borran, y les podés sumar formatos tuyos",
} as const;

/** El tooltip del ejemplo de una fila. */
export const FORMAT_EXAMPLE_TOOLTIP = "Ejemplo de lo que reconoce";
/** El tooltip de «Editar» de un formato base (se edita una copia) y de uno propio. */
export const EDIT_BASE_TOOLTIP = "Editar: se edita una copia; el original queda guardado";
export const EDIT_OWN_TOOLTIP = "Editar el formato";

/** El contador del pie sin cambios pendientes. */
export const NO_PENDING_CHANGES = "Sin cambios";

/** Los avisos de restaurar el original y de borrar un formato (título y subtítulo). */
export function restoredFormatToast(originalName: string): {
  readonly title: string;
  readonly description: string;
} {
  return {
    title: `Volvió el formato original «${originalName}»`,
    description: "Se borró tu copia editada.",
  };
}

export function deletedFormatToast(name: string): {
  readonly title: string;
  readonly description: string;
} {
  return { title: `Se borró el formato «${name}»`, description: "Se aplica cuando guardes." };
}

/** El aviso de borrar un tipo propio guardado, con sus formatos. */
export function deletedSavedTypeToast(
  name: string,
  formatCount: number,
): { readonly title: string; readonly description: string } {
  const withFormats =
    formatCount === 0
      ? ""
      : `${formatCount === 1 ? "Con su formato" : `Con sus ${formatCount} formatos`}. `;
  return { title: `Se borró «${name}»`, description: `${withFormats}Se aplica cuando guardes.` };
}

// ─── Exportar ───

/** La nota de un tipo que se exporta en parte: «Va con 2 de 3». */
export function partialTypeNote(chosen: number, total: number): string {
  return `Va con ${chosen} de ${total}`;
}

// ─── Importar: resumen y rechazo ───

/** La línea bajo el título del resumen: «De {archivo}. Todo llega prendido…». */
export function importSummaryLead(fileName: string): string {
  return `De ${fileName}. Todo llega prendido y se aplica cuando guardes.`;
}

/** El pie del resumen. */
export const IMPORT_SUMMARY_FOOTNOTE = "Cada formato se puede apagar o borrar desde la lista.";

/** El detalle de un tipo nuevo: «tipo nuevo · 2 formatos». */
export function importedTypeDetail(formatCount: number): string {
  if (formatCount === 0) return "tipo nuevo";
  return `tipo nuevo · ${formatCount === 1 ? "1 formato" : `${formatCount} formatos`}`;
}

/** El detalle de un tipo que ya tenías y al que se suma un formato: «suma «HC de guardia»». */
export function mergedFormatDetail(formatName: string): string {
  return `suma «${formatName}»`;
}

/** La línea gris bajo el motivo de un rechazo, según qué falló en el archivo. */
export const IMPORT_REJECTION_HINTS = {
  invalid:
    "El archivo se revisa entero antes de importar: si algo falla, no entra nada. Pedile a quien lo armó que lo corrija.",
  notAnonly:
    "Los formatos se exportan desde Anonly con «Exportar…» y terminan en .anonly-formatos.",
} as const;

/** Qué línea gris acompaña a un rechazo: `null` si ninguna (por ejemplo, una versión más nueva). */
export function importRejectionHint(codes: ReadonlyArray<FormatsFileIssueCode>): string | null {
  if (codes.some((code) => code === "not_json" || code === "wrong_kind")) {
    return IMPORT_REJECTION_HINTS.notAnonly;
  }
  if (codes.every((code) => code === "version_newer")) return null;
  return IMPORT_REJECTION_HINTS.invalid;
}
