/**
 * @anonly/regex-engine — Catálogo de formatos base (ADR-221 §2, ADR-220 §4).
 *
 * Fuente de verdad: docs/core/Regex_Engine.md, «Catálogo» y «Definiciones
 * equivalentes de los formatos `structure`». Es solo dato: envuelve cada
 * `RegexPattern` de `DEFAULT_PATTERNS_AR`, en su orden, con su
 * `CatalogFormatInfo`. Lo que corre de base no cambia.
 */

import type {
  CatalogFormatInfo,
  CatalogFormatKind,
  CountryCode,
  EntityType,
  FormatDefinition,
  FormatPiece,
} from "@anonly/shared";

import type { CatalogFormat, RegexPattern } from "../regex.types.js";

import { DEFAULT_PATTERNS_AR } from "./default-ar.js";

interface CatalogEntry {
  readonly country: CountryCode | "universal";
  readonly name: string;
  readonly kind: CatalogFormatKind;
  /** Solo `structure`: las piezas de su única variante. */
  readonly pieces?: ReadonlyArray<FormatPiece>;
}

const digits = (min: number, max: number): FormatPiece => ({
  kind: "chars",
  charClass: "digit",
  min,
  max,
});
const upper = (min: number, max: number): FormatPiece => ({
  kind: "chars",
  charClass: "upper",
  min,
  max,
});
const dot: FormatPiece = { kind: "separator", chars: ["."], optional: true };
const spaceOrDash: FormatPiece = { kind: "separator", chars: [" ", "-"], optional: true };

const CATALOG_ENTRIES: Readonly<Record<string, CatalogEntry>> = {
  "dni-ar": {
    country: "AR",
    name: "DNI",
    kind: "structure",
    pieces: [digits(1, 2), dot, digits(3, 3), dot, digits(3, 3)],
  },
  "cuit-ar": { country: "AR", name: "CUIT/CUIL", kind: "control" },
  "phone-mobile-ar": { country: "AR", name: "Celular", kind: "control" },
  "phone-landline-ar": {
    country: "AR",
    name: "Teléfono fijo",
    kind: "structure",
    pieces: [
      { kind: "text", value: "0" },
      digits(1, 4),
      spaceOrDash,
      digits(3, 4),
      spaceOrDash,
      digits(4, 4),
    ],
  },
  email: { country: "universal", name: "Email", kind: "control" },
  iban: { country: "universal", name: "IBAN", kind: "control" },
  "credit-card": { country: "universal", name: "Tarjeta", kind: "control" },
  "date-ar": { country: "universal", name: "Fecha", kind: "control" },
  "date-textual-ar": { country: "universal", name: "Fecha en texto", kind: "control" },
  "license-ar": { country: "AR", name: "Matrícula profesional", kind: "control" },
  "plate-vieja-ar": {
    country: "AR",
    name: "Patente (formato anterior)",
    kind: "structure",
    pieces: [upper(3, 3), spaceOrDash, digits(3, 3)],
  },
  "plate-mercosur-ar": {
    country: "AR",
    name: "Patente Mercosur",
    kind: "structure",
    pieces: [upper(2, 2), spaceOrDash, digits(3, 3), spaceOrDash, upper(2, 2)],
  },
  "plate-mercosur-moto-ar": {
    country: "AR",
    name: "Patente Mercosur de moto",
    kind: "structure",
    pieces: [upper(1, 1), spaceOrDash, digits(3, 3), spaceOrDash, upper(3, 3)],
  },
  "caratula-ar": {
    country: "universal",
    name: "Carátula (Apellido, Nombre)",
    kind: "control",
  },
  "address-keyword-ar": {
    country: "universal",
    name: "Dirección con palabra clave",
    kind: "control",
  },
};

function buildDefinition(
  id: string,
  name: string,
  entityType: EntityType,
  pieces: ReadonlyArray<FormatPiece>,
): FormatDefinition {
  return { id: `fmt:base:${id}`, name, entityType, variants: [pieces], enabled: true };
}

function buildCatalogFormat(pattern: RegexPattern): CatalogFormat {
  const entry: CatalogEntry = CATALOG_ENTRIES[pattern.id] ?? {
    country: "universal",
    name: pattern.id,
    kind: "control",
  };
  const info: CatalogFormatInfo = {
    id: pattern.id,
    country: entry.country,
    name: entry.name,
    entityType: pattern.entityType,
    kind: entry.kind,
    ...(entry.kind === "structure" && entry.pieces !== undefined
      ? { definition: buildDefinition(pattern.id, entry.name, pattern.entityType, entry.pieces) }
      : {}),
  };
  return { info, pattern };
}

/** Los formatos base con su `CatalogFormatInfo`, en el orden de `DEFAULT_PATTERNS_AR` (ADR-221 §2). */
export const BASE_CATALOG: ReadonlyArray<CatalogFormat> =
  DEFAULT_PATTERNS_AR.map(buildCatalogFormat);

/**
 * ADR-221 §2: los formatos base de `country` más los universales, en el orden
 * en que corren.
 */
export function getCatalog(country: CountryCode): ReadonlyArray<CatalogFormatInfo> {
  return BASE_CATALOG.filter(
    ({ info }) => info.country === country || info.country === "universal",
  ).map(({ info }) => info);
}
