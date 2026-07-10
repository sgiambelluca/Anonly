/**
 * @anonly/regex-engine — Patrones default de tipos argentinos.
 *
 * Fuente de verdad (contrato público, literal): docs/core/Regex_Engine.md,
 * sección "Patrones default (especificación exacta)". Los regex, checksums y
 * normalizers de esta tabla se implementan tal cual — cualquier cambio
 * requiere un ADR nuevo (ver spec, última línea de esa sección).
 *
 * maskFormat por tipo: docs/adr/ADR-012-Replacement-Modes.md, tabla "Formato
 * por tipo para mask". Para Plate, esa tabla asigna literalmente
 * "XXX XXX" a Mercosur y "XXX XXXX" a la vieja (aunque a primera vista
 * parezca invertido respecto de la longitud real de cada formato); se
 * respeta tal cual está documentado.
 */

import { EntityType } from "@anonly/shared";

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

// ─── Patrones default AR (Regex_Engine.md, tabla "Patrones default") ───

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
     */
    id: "phone-mobile-ar",
    entityType: EntityType.Phone,
    pattern: /(?:\+?54)?[\s-]?\b\d{2}[\s-]?\d{4}[\s-]?\d{4}\b/g,
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
    maskFormat: "XXX XXXX",
  },
  {
    id: "plate-mercosur-ar",
    entityType: EntityType.Plate,
    pattern: /\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b/g,
    normalizer: normalizeUppercaseNoSpaces,
    maskFormat: "XXX XXX",
  },
];
