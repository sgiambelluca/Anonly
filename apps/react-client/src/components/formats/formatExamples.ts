/**
 * `formatExamples.ts` — los ejemplos de cada fila de «Formatos de detección»
 * (ADR-227 §5). Son datos, no un componente.
 *
 * Un formato con control no tiene piezas, así que la aplicación lleva **una tabla
 * de textos de ejemplo**, uno por formato base del catálogo. Son textos de la
 * interfaz: viven acá, junto a los demás rótulos, y no en el catálogo de
 * `regex-engine`. Para un formato del generador (o una copia editada) el
 * ejemplo se arma con sus piezas (`buildFormatExample`).
 *
 * Los ejemplos son inventados, sin datos de ningún documento ni persona.
 */

import type { FormatCharClass, FormatDefinition, FormatPiece } from "@anonly/anonymization-core";

/** Un ejemplo por cada id de `getCatalog("AR")`. Un test verifica que no falte ninguno. */
export const BASE_FORMAT_EXAMPLES: Readonly<Record<string, string>> = {
  "dni-ar": "12.345.678",
  "cuit-ar": "20-12345678-9",
  "phone-mobile-ar": "+54 9 11 2345-6789",
  "phone-landline-ar": "0221 456-7890",
  email: "nombre@ejemplo.com",
  iban: "ES91 2100 0418 4502 0005 1332",
  "credit-card": "4111 1111 1111 1111",
  "date-ar": "25/03/2024",
  "date-textual-ar": "25 de marzo de 2024",
  "license-ar": "M.P. 12345",
  "plate-vieja-ar": "ABC 123",
  "plate-mercosur-ar": "AB 123 CD",
  "plate-mercosur-moto-ar": "A 123 BCD",
  "caratula-ar": "Pérez, Juan",
  "address-keyword-ar": "Calle San Martín 1234",
};

/** El ejemplo de un formato base; vacío si el catálogo suma uno sin ejemplo (el test lo detecta). */
export function baseFormatExample(catalogId: string): string {
  return BASE_FORMAT_EXAMPLES[catalogId] ?? "";
}

const SAMPLE_ALPHABET: Readonly<Record<FormatCharClass, string>> = {
  digit: "1234567890",
  letter: "AbCdEfGhIj",
  upper: "ABCDEFGHIJ",
  lower: "abcdefghij",
  alnum: "A1B2C3D4E5",
};

function sampleChars(charClass: FormatCharClass, length: number): string {
  const alphabet = SAMPLE_ALPHABET[charClass];
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += alphabet.charAt(index % alphabet.length);
  }
  return out;
}

export function pieceExample(piece: FormatPiece): string {
  switch (piece.kind) {
    case "chars":
      return sampleChars(piece.charClass, piece.min);
    case "text":
      return piece.value;
    case "separator":
      return piece.chars[0] ?? "";
    case "optional":
      return piece.pieces.map(pieceExample).join("");
  }
}

/**
 * El ejemplo de un formato del generador: la primera variante, con cada bloque
 * en su largo mínimo y la parte opcional incluida. Es un texto para mostrar,
 * no lo que el formato reconoce de más.
 */
export function buildFormatExample(definition: FormatDefinition): string {
  const first = definition.variants[0];
  return first === undefined ? "" : first.map(pieceExample).join("");
}
