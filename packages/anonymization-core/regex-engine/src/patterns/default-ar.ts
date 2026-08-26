/**
 * @anonly/regex-engine — Patrones default de tipos argentinos.
 *
 * Fuente de verdad (contrato público, literal): docs/core/Regex_Engine.md,
 * sección "Patrones default (especificación exacta)". Los regex, checksums y
 * normalizers de esta tabla se implementan tal cual — cualquier cambio
 * requiere un ADR nuevo (ver spec, última línea de esa sección).
 *
 * maskFormat por tipo: docs/adr/ADR-012-Replacement-Modes.md, tabla "Formato
 * por tipo para mask". Para Plate, esa fila quedó superada por
 * docs/adr/ADR-029-Occurrence-MaskFormat-Plate-Variantes.md §2: cada variante
 * de patente lleva su propio maskFormat (plate-mercosur-ar: "XX XXX XX",
 * plate-vieja-ar: "XXX XXX").
 */

import { EntityType, GENDER_LEXICON, normalizeForComparison } from "@anonly/shared";

import type { RegexPattern } from "../regex.types.js";

// ─── Normalizers ───

function stripNonDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

function stripDots(value: string): string {
  return value.replace(/\./g, "");
}

function stripDashes(value: string): string {
  return value.replace(/-/g, "");
}

function normalizeEmail(value: string): string {
  return value.toLowerCase();
}

function normalizeUppercaseNoSpaces(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

function normalizeUppercaseNoDashes(value: string): string {
  return value.toUpperCase().replace(/-/g, "");
}

/**
 * Normaliza a "DD/MM/YYYY". Año de 2 dígitos: pivote 00-49 → 20XX, 50-99 →
 * 19XX (heurística estándar de parseo de fechas de 2 dígitos; Regex_Engine.md
 * no especifica la regla de siglo — ver nota de ambigüedad no bloqueante en
 * el reporte de PR).
 */
function normalizeDate(value: string): string {
  const parts = value.split(/[/-]/);
  const [rawDay, rawMonth, rawYear] = parts;
  if (rawDay === undefined || rawMonth === undefined || rawYear === undefined) {
    return value;
  }
  const day = rawDay.padStart(2, "0");
  const month = rawMonth.padStart(2, "0");
  let year = rawYear;
  if (year.length === 2) {
    const yy = parseInt(year, 10);
    year = yy <= 49 ? `20${year}` : `19${year}`;
  }
  return `${day}/${month}/${year}`;
}

// ─── Checksums (reciben normalizedValue) ───

/** Dígito verificador módulo 11 de AFIP para CUIT/CUIL de 11 dígitos. */
function computeCuitChecksum(normalizedValue: string): boolean {
  const digits = normalizedValue.replace(/\D+/g, "");
  if (digits.length !== 11) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = digits.charCodeAt(i) - 48;
    const w = weights[i];
    if (w === undefined) continue;
    sum += d * w;
  }
  const mod = sum % 11;
  let checkDigit = 11 - mod;
  if (checkDigit === 11) checkDigit = 0;
  if (checkDigit === 10) return false; // dv=10 no existe en un CUIT real.
  const lastDigit = digits.charCodeAt(10) - 48;
  return checkDigit === lastDigit;
}

/** Algoritmo de Luhn para tarjetas de crédito (13 a 19 dígitos). */
function computeLuhnChecksum(normalizedValue: string): boolean {
  const digits = normalizedValue.replace(/\D+/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/** Chequeo ISO 13616 (mod 97 == 1) para IBAN. */
function computeIbanChecksum(normalizedValue: string): boolean {
  const cleaned = normalizedValue.replace(/\s+/g, "").toUpperCase();
  if (cleaned.length < 4) return false;
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  let numeric = "";
  for (const ch of rearranged) {
    if (ch >= "0" && ch <= "9") {
      numeric += ch;
    } else if (ch >= "A" && ch <= "Z") {
      numeric += (ch.charCodeAt(0) - 55).toString();
    } else {
      return false;
    }
  }
  let remainder = 0;
  for (let i = 0; i < numeric.length; i++) {
    remainder = (remainder * 10 + (numeric.charCodeAt(i) - 48)) % 97;
  }
  return remainder === 1;
}

/** Validación de rango: día 1-31, mes 1-12 (sin validar días por mes/bisiestos). */
function validateDateRange(normalizedValue: string): boolean {
  const parts = normalizedValue.split(/[/-]/);
  const [rawDay, rawMonth] = parts;
  if (rawDay === undefined || rawMonth === undefined) return false;
  const day = parseInt(rawDay, 10);
  const month = parseInt(rawMonth, 10);
  if (Number.isNaN(day) || Number.isNaN(month)) return false;
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

/** ADR-075 §1: mapeo mes en texto → número. `setiembre` es tan correcto como `septiembre` en español rioplatense. */
const TEXTUAL_MONTH_NUMBERS: Readonly<Record<string, string>> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

/**
 * Re-extrae día/mes/año del valor crudo (el normalizer recibe `rawValue`, sin
 * los grupos de captura del match original) y produce "DD/MM/YYYY" —
 * exactamente el formato de `normalizeDate`, a propósito (ADR-075 §1): así
 * "07 de julio de 2026" y "7/7/2026" comparten `normalizedValue` y agrupan
 * por el pase exacto, sin depender del pase difuso.
 */
function normalizeTextualDate(value: string): string {
  const match =
    /(\d{1,2})\s*[°º]?\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+del?\s+(\d{4})/i.exec(
      value,
    );
  const rawDay = match?.[1];
  const monthName = match?.[2]?.toLowerCase();
  const year = match?.[3];
  if (rawDay === undefined || monthName === undefined || year === undefined) return value;
  const month = TEXTUAL_MONTH_NUMBERS[monthName];
  if (month === undefined) return value;
  return `${rawDay.padStart(2, "0")}/${month}/${year}`;
}

// ─── Patrones default AR (Regex_Engine.md, tabla "Patrones default") ───

// ─── Carátula judicial (ADR-092) ───

/*
 * ADR-092 §2: `"Pérez, Juan"` normaliza a `"juan perez"` — el MISMO
 * `normalizedValue` que produciría `"Juan Pérez"` del cuerpo, que es lo que
 * hace que Grouping los una. Es el mecanismo de ADR-075 §1 (la fecha textual
 * y la numérica llegando al mismo valor), aplicado al orden invertido.
 *
 * Contra una ocurrencia de NER la unión ocurre por el pase DIFUSO, no por el
 * exacto: `normalizeNerValue` no pliega diacríticos, así que emite
 * `"juan pérez"` contra este `"juan perez"` — 0,9 sobre un umbral de 0,88.
 * Es la deuda anotada en ADR-088 §3.
 */
function flipCaption(value: string): string {
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return normalizeForComparison(value);
  const surname = value.slice(0, commaIndex);
  const givenNames = value.slice(commaIndex + 1);
  return normalizeForComparison(`${givenNames} ${surname}`);
}

/*
 * ADR-092 §1: la compuerta. `RegexPattern.checksum` es "validación adicional
 * sobre el normalizedValue", y la de una carátula es que el nombre de pila
 * sea un nombre de pila — igual que la de un CUIT es que cierre el módulo 11.
 * Sin ella el patrón matchea `"Buenos Aires, Argentina"`,
 * `"San Miguel, Tucumán"` y `"Código Civil, Título III"`: medido, 7/10
 * contra 15/16.
 *
 * El valor llega YA invertido por `flipCaption`, así que el nombre de pila es
 * el PRIMER token. Las claves del léxico están pre-normalizadas con el mismo
 * criterio que `normalizeForComparison` (ADR-069 §1), así que se consultan
 * directo.
 */
function firstNameIsInLexicon(normalizedValue: string): boolean {
  const firstToken = normalizedValue.split(" ")[0];
  return firstToken !== undefined && GENDER_LEXICON.has(firstToken);
}

export const DEFAULT_PATTERNS_AR: ReadonlyArray<RegexPattern> = [
  {
    id: "dni-ar",
    entityType: EntityType.DNI,
    pattern: /\b\d{1,2}\.?\d{3}\.?\d{3}\b/g,
    normalizer: stripDots,
    maskFormat: "XX.XXX.XXX",
  },
  {
    id: "cuit-ar",
    entityType: EntityType.CUIT,
    pattern: /\b\d{2}-?\d{8}-?\d\b/g,
    checksum: computeCuitChecksum,
    normalizer: stripDashes,
    maskFormat: "XX-XXXXXXXX-X",
  },
  {
    /*
     * Límites de palabra (`\b`) en ambos extremos del grupo obligatorio de
     * dígitos, consistente con los otros 10 patrones de la tabla. Corrección
     * formalizada en Regex_Engine.md v1.0.1 — ver adr/ADR-022 para el detalle
     * del problema (el patrón original, sin `\b`, rompía el caso límite 3 del
     * spec) y la decisión.
     *
     * ADR-093 §1: la característica telefónica argentina no siempre tiene dos
     * dígitos (CABA sí, pero La Plata/Rosario/Córdoba/Paraná tienen 3 y las
     * localidades chicas 4) — lo invariante es que característica + abonado
     * suman 10 dígitos. De ahí la alternancia de tres ramas, una por longitud
     * de característica, en vez de un rango `\d{2,4}` que sería más corto y
     * más legible. **No simplificar a un rango**: medido contra ocho trampas
     * (ADR-093 §1, tabla), el rango laxo `\d{2,4}[\s-]?\d{2,4}[\s-]?\d{3,4}`
     * detecta los mismos 7 teléfonos pero agrega 3 falsos positivos que la
     * enumeración no tiene — se come tres grupos de una tarjeta
     * (`"4532 1234 5678"`), tres de un IBAN y dos números sueltos adyacentes
     * (`"expediente 1234 5678"`). Exigir el total de 10 dígitos exacto, por
     * rama, es lo que discrimina. El `9` opcional cubre el formato de móvil
     * internacional (`+54 9 11 …`); el separador opcional se ata al prefijo
     * de país (`54[\s-]?`, `9[\s-]?`) en vez de quedar suelto antes del `\b`.
     */
    id: "phone-mobile-ar",
    entityType: EntityType.Phone,
    pattern:
      /(?:\+?54[\s-]?)?(?:9[\s-]?)?\b(?:\d{2}[\s-]?\d{4}[\s-]?\d{4}|\d{3}[\s-]?\d{3}[\s-]?\d{4}|\d{4}[\s-]?\d{2}[\s-]?\d{4})\b/g,
    normalizer: stripNonDigits,
    maskFormat: "+XX XXX XXX-XXXX",
  },
  {
    id: "phone-landline-ar",
    entityType: EntityType.Phone,
    pattern: /\b0\d{1,4}[\s-]?\d{6,8}\b/g,
    normalizer: stripNonDigits,
    maskFormat: "+XX XXX XXX-XXXX",
  },
  {
    id: "email",
    entityType: EntityType.Email,
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    normalizer: normalizeEmail,
    maskFormat: "xxxx@xxxx.xx",
  },
  {
    id: "iban",
    entityType: EntityType.IBAN,
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    checksum: computeIbanChecksum,
    normalizer: normalizeUppercaseNoSpaces,
    maskFormat: "XX00 XXXX XXXX XXXX XXXX",
  },
  {
    id: "credit-card",
    entityType: EntityType.CreditCard,
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    checksum: computeLuhnChecksum,
    normalizer: stripNonDigits,
    maskFormat: "XXXX XXXX XXXX XXXX",
  },
  {
    id: "date-ar",
    entityType: EntityType.Date,
    pattern: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
    checksum: validateDateRange,
    normalizer: normalizeDate,
    maskFormat: "XX/XX/XXXX",
  },
  {
    id: "date-textual-ar",
    entityType: EntityType.Date,
    pattern:
      /\b(\d{1,2})\s*[°º]?\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+del?\s+(\d{4})\b/gi,
    checksum: validateDateRange,
    normalizer: normalizeTextualDate,
    maskFormat: "XX/XX/XXXX",
  },
  {
    id: "license-ar",
    entityType: EntityType.License,
    pattern: /\b[A-Z]{1,3}-?\d{4,8}-?\d?\b/g,
    normalizer: normalizeUppercaseNoDashes,
    maskFormat: "XX-XXXX-XX",
  },
  {
    id: "plate-vieja-ar",
    entityType: EntityType.Plate,
    pattern: /\b[A-Z]{3}\s?\d{3}\b/g,
    normalizer: normalizeUppercaseNoSpaces,
    maskFormat: "XXX XXX",
  },
  {
    id: "plate-mercosur-ar",
    entityType: EntityType.Plate,
    pattern: /\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b/g,
    normalizer: normalizeUppercaseNoSpaces,
    maskFormat: "XX XXX XX",
  },
  {
    /*
     * ADR-092 §1 — `"Apellido, Nombre"`, la forma canónica de una carátula
     * judicial. **Una palabra de cada lado**, y las dos razones son
     * distintas:
     *
     * - El apellido, porque sin la coma como ancla un apellido compuesto no
     *   se distingue de un topónimo (`"Mar del Plata, Buenos Aires"`).
     * - El nombre, porque un cuantificador goloso se traga cualquier palabra
     *   capitalizada que siga. Medido sobre la firma de la pericia
     *   (`tests/integration/annotation-signature.test.ts`): con `(?:\s+…)*`
     *   el patrón matchea `"Albarracin, Rocio Date"` sobre el texto
     *   `"Albarracin, Rocio Date: 07/07/2026"` — la ocurrencia cruza al run
     *   siguiente, su envolvente se estira sobre los dos, y Grouping descarta
     *   por solapamiento el grupo de **Fecha**. Es el mismo mecanismo que
     *   ADR-088 §1 tuvo que cerrar en NER: una entidad que abarca dos runs no
     *   solo tapa de más, hace **desaparecer** a su vecina.
     *
     * El costo es que un segundo nombre de pila (`"López, María Fernanda"`)
     * queda fuera del match. Se acepta: el apellido y el primer nombre son la
     * parte identificatoria, y el resto es territorio del NER.
     *
     * `maskFormat` es el mismo que `MASK_FORMAT_BY_TYPE[Person]` de
     * `grouping-engine`: una carátula no tiene una forma de máscara propia,
     * a diferencia de las dos variantes de patente (ADR-029 §2).
     */
    id: "caratula-ar",
    entityType: EntityType.Person,
    pattern: /\b(\p{Lu}\p{Ll}+),\s+(\p{Lu}\p{Ll}+)\b/gu,
    checksum: firstNameIsInLexicon,
    normalizer: flipCaption,
    maskFormat: "XXXXX XXXXX",
  },
];
