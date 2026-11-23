/**
 * `validateFormatsFile` (ADR-223 §6, Contracts.md §3.5 y §5.2): valida el
 * archivo de formatos ENTERO antes de que la aplicación toque nada. Función
 * pura del façade, porque combina `validateUserEntityType` (grouping-engine) y
 * `validateFormat` (regex-engine), que no pueden importarse entre sí (P-2).
 *
 * No lanza, no loguea y no guarda nada: el texto del archivo lo escribió el
 * usuario y no sale de la llamada. Los cruces con lo que el usuario ya tiene
 * (mismo nombre, formato idéntico, formatos que comparten textos) los resuelve
 * la aplicación después, con `compareFormat`.
 */

import { validateUserEntityType } from "@anonly/grouping-engine";
import { validateFormat } from "@anonly/regex-engine";
import {
  isUserEntityType,
  type CatalogFormatRef,
  type CountryCode,
  type FormatCharClass,
  type FormatDefinition,
  type FormatPiece,
  type FormatSeparator,
  type FormatsFileIssueCode,
  type FormatsFileValidation,
  type UserEntityTypeDefinition,
} from "@anonly/shared";

type FileIssue = { readonly code: FormatsFileIssueCode; readonly path?: string };

const FORMAT_CHAR_CLASSES: ReadonlySet<string> = new Set<FormatCharClass>([
  "digit",
  "letter",
  "upper",
  "lower",
  "alnum",
]);

const FORMAT_SEPARATORS: ReadonlySet<string> = new Set<FormatSeparator>([" ", "-", ".", "/"]);

// La 1.1 sale con "AR" sola (Contracts.md §5.2, `CountryCode`): "CL" y "UY"
// entran al tipo con los demás países (sin versión, ADR-237), junto con sus catálogos.
const COUNTRY_CODES: ReadonlySet<string> = new Set<CountryCode>(["AR"]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isUserEntityTypeShape(value: unknown): value is UserEntityTypeDefinition {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string" || !value["id"].startsWith("user:")) return false;
  if (typeof value["name"] !== "string") return false;
  const shortLabels = value["shortLabels"];
  if (shortLabels === undefined) return true;
  if (!isRecord(shortLabels)) return false;
  return isOptionalString(shortLabels["level1"]) && isOptionalString(shortLabels["level2"]);
}

function isFormatPieceShape(value: unknown): value is FormatPiece {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "chars":
      return (
        typeof value["charClass"] === "string" &&
        FORMAT_CHAR_CLASSES.has(value["charClass"]) &&
        typeof value["min"] === "number" &&
        typeof value["max"] === "number"
      );
    case "text":
      return typeof value["value"] === "string";
    case "separator": {
      const chars = value["chars"];
      return (
        Array.isArray(chars) &&
        chars.every((char) => typeof char === "string" && FORMAT_SEPARATORS.has(char)) &&
        typeof value["optional"] === "boolean"
      );
    }
    case "optional": {
      const pieces = value["pieces"];
      return Array.isArray(pieces) && pieces.every(isFormatPieceShape);
    }
    default:
      return false;
  }
}

function isFormatShape(value: unknown): value is FormatDefinition {
  if (!isRecord(value)) return false;
  const variants = value["variants"];
  const contextBefore = value["contextBefore"];
  const variantNames = value["variantNames"];
  return (
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["entityType"] === "string" &&
    Array.isArray(variants) &&
    variants.every((variant) => Array.isArray(variant) && variant.every(isFormatPieceShape)) &&
    (variantNames === undefined ||
      (Array.isArray(variantNames) && variantNames.every((name) => typeof name === "string"))) &&
    (contextBefore === undefined ||
      (Array.isArray(contextBefore) && contextBefore.every((word) => typeof word === "string"))) &&
    isOptionalString(value["basedOn"]) &&
    typeof value["enabled"] === "boolean"
  );
}

/** Forma de una referencia sin mirar si el país lo conoce esta versión (ADR-223 §6). */
function isCatalogRefShape(
  value: unknown,
): value is Omit<CatalogFormatRef, "country"> & { readonly country: string } {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["country"] === "string" &&
    typeof value["catalogFormatId"] === "string" &&
    typeof value["enabled"] === "boolean"
  );
}

function isKnownCatalogRef(
  value: Omit<CatalogFormatRef, "country"> & { readonly country: string },
): value is CatalogFormatRef {
  return COUNTRY_CODES.has(value.country);
}

/** Los items de `raw` (un array) que no pasan `isShape`, como issues `schema_invalid` con su `path`. */
function shapeIssues(
  section: string,
  raw: ReadonlyArray<unknown>,
  isShape: (value: unknown) => boolean,
): FileIssue[] {
  const issues: FileIssue[] = [];
  raw.forEach((item, index) => {
    if (!isShape(item)) issues.push({ code: "schema_invalid", path: `${section}[${index}]` });
  });
  return issues;
}

function fail(issues: ReadonlyArray<FileIssue>): FormatsFileValidation {
  return { ok: false, issues };
}

export function validateFormatsFile(text: string, country: CountryCode): FormatsFileValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail([{ code: "not_json" }]);
  }

  if (!isRecord(parsed) || parsed["kind"] !== "anonly-formats") {
    return fail([{ code: "wrong_kind" }]);
  }

  const version = parsed["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return fail([{ code: "version_invalid", path: "version" }]);
  }
  if (version > 1) return fail([{ code: "version_newer", path: "version" }]);

  const rawTypes = parsed["types"];
  const rawFormats = parsed["formats"];
  const rawRefs = parsed["catalogRefs"];
  const schemaIssues: FileIssue[] = [];
  if (!Array.isArray(rawTypes)) schemaIssues.push({ code: "schema_invalid", path: "types" });
  if (!Array.isArray(rawFormats)) schemaIssues.push({ code: "schema_invalid", path: "formats" });
  if (!Array.isArray(rawRefs)) schemaIssues.push({ code: "schema_invalid", path: "catalogRefs" });
  if (!Array.isArray(rawTypes) || !Array.isArray(rawFormats) || !Array.isArray(rawRefs)) {
    return fail(schemaIssues);
  }
  schemaIssues.push(
    ...shapeIssues("types", rawTypes, isUserEntityTypeShape),
    ...shapeIssues("formats", rawFormats, isFormatShape),
    ...shapeIssues("catalogRefs", rawRefs, isCatalogRefShape),
  );
  if (schemaIssues.length > 0) return fail(schemaIssues);

  // La forma ya está verificada: de acá en adelante los items están tipados.
  const types = rawTypes.filter(isUserEntityTypeShape);
  const formats = rawFormats.filter(isFormatShape);
  const shapedRefs = rawRefs.filter(isCatalogRefShape);

  // ADR-223 §6 (precisión del 2026-11-20): una referencia a un país que esta
  // versión no conoce es un archivo de una versión más nueva.
  const newerIssues: FileIssue[] = [];
  shapedRefs.forEach((ref, index) => {
    if (!isKnownCatalogRef(ref)) {
      newerIssues.push({ code: "version_newer", path: `catalogRefs[${index}]` });
    }
  });
  if (newerIssues.length > 0) return fail(newerIssues);
  const catalogRefs = shapedRefs.filter(isKnownCatalogRef);

  const issues: FileIssue[] = [];

  // Cada tipo contra el país y los OTROS tipos del archivo.
  types.forEach((type, index) => {
    const validation = validateUserEntityType(type, {
      country,
      existing: types.filter((_other, otherIndex) => otherIndex !== index),
    });
    if (!validation.ok) issues.push({ code: "type_invalid", path: `types[${index}]` });
  });

  // Cada formato contra los tipos del archivo: un formato no apunta a un tipo
  // que no viaja con él (`format_type_missing`).
  formats.forEach((format, index) => {
    const path = `formats[${index}]`;
    const validation = validateFormat(format, {
      userTypes: types,
      // El nombre es para la interfaz: dos formatos con el mismo nombre corren
      // los dos (Regex_Engine.md), así que no se compara contra los del archivo.
      existingFormats: [],
    });
    const typeIsMissing =
      isUserEntityType(format.entityType) && !types.some((type) => type.id === format.entityType);
    if (typeIsMissing) issues.push({ code: "format_type_missing", path });
    const otherIssues = validation.issues.filter(
      (issue) => !(typeIsMissing && issue.code === "type_unknown"),
    );
    if (otherIssues.length > 0) issues.push({ code: "format_invalid", path });
  });

  if (issues.length > 0) return fail(issues);
  return { ok: true, content: { kind: "anonly-formats", version: 1, types, formats, catalogRefs } };
}
