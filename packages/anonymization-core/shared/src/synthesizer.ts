/**
 * @anonly/shared — Sintetizadores deterministas para modo `synthetic`.
 *
 * Fuente de verdad: docs/adr/ADR-012-Replacement-Modes.md y docs/core/Grouping_Engine.md §"Algoritmos clave".
 *
 * Contrato:
 * - Determinista por (type, indexInType, seed): mismo input → mismo output.
 * - El valor sintético debe ser plausible y válido según el formato del tipo
 *   (checksum de CUIT, Luhn de tarjeta, formato de DNI, etc.).
 * - Seed default: aleatorio por sesión. Configurable por documento.
 * - Nunca exponer el seed en el PDF resultante.
 */

import { EntityType } from "./enums.js";

/**
 * Genera un valor sintético determinista para una entidad.
 *
 * @param type Tipo de entidad.
 * @param indexInType Índice secuencial del grupo dentro de su tipo (1-based).
 * @param seed Seed determinista (string). Default: "anonly-default-seed".
 * @returns Valor sintético plausible para el tipo.
 */
export function synthesize(
  type: EntityType,
  indexInType: number,
  seed: string = "anonly-default-seed",
): string {
  const rng = createSeededRng(seed, type, indexInType);
  switch (type) {
    case EntityType.DNI:
      return synthesizeDni(rng);
    case EntityType.CUIT:
      return synthesizeCuit(rng);
    case EntityType.Phone:
      return synthesizePhone(rng);
    case EntityType.Email:
      return synthesizeEmail(rng, indexInType);
    case EntityType.IBAN:
      return synthesizeIban(rng);
    case EntityType.CreditCard:
      return synthesizeCreditCard(rng);
    case EntityType.Date:
      return synthesizeDate(rng);
    case EntityType.Person:
      return synthesizePerson(rng);
    case EntityType.Organization:
      return synthesizeOrganization(rng);
    case EntityType.Address:
      return synthesizeAddress(rng);
    case EntityType.License:
      return synthesizeLicense(rng);
    case EntityType.Plate:
      return synthesizePlate(rng);
    case EntityType.Custom:
      return `custom-${indexInType}`;
    default:
      return `synthetic-${indexInType}`;
  }
}

// ─── Implementación interna ───

/**
 * PRNG determinista (mulberry32) seedado por (seed, type, indexInType).
 * No es criptográficamente seguro, pero alcanza para síntesis determinista.
 */
function createSeededRng(seed: string, type: EntityType, indexInType: number): () => number {
  const fullSeed = hashStringToInt(`${seed}|${type}|${indexInType}`);
  let state = fullSeed >>> 0;
  return function rng(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToInt(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(rng: () => number, arr: ReadonlyArray<T>): T {
  const idx = Math.floor(rng() * arr.length);
  const value = arr[idx];
  if (value === undefined) {
    throw new Error("pick: array vacío o índice fuera de rango");
  }
  return value;
}

function randomDigits(rng: () => number, count: number): string {
  let s = "";
  for (let i = 0; i < count; i++) {
    s += Math.floor(rng() * 10).toString();
  }
  return s;
}

function synthesizeDni(rng: () => number): string {
  // DNI AR: 1-2 dígitos, punto, 3 dígitos, punto, 3 dígitos (8 total).
  const n = randomDigits(rng, 8).padStart(8, "0");
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}`;
}

function synthesizeCuit(rng: () => number): string {
  // CUIT AR: XX-XXXXXXXX-X con dígito verificador válido (algoritmo módulo 11).
  const prefix = pick(rng, ["20", "23", "24", "27", "30", "33", "34"]);
  const body = randomDigits(rng, 8);
  const checksum = computeCuitChecksum(prefix, body);
  return `${prefix}-${body}-${checksum}`;
}

function computeCuitChecksum(prefix: string, body: string): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const digits = `${prefix}${body}`.split("").map((c) => parseInt(c, 10));
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits[i];
    const w = weights[i];
    if (d === undefined || w === undefined) continue;
    sum += d * w;
  }
  const mod = sum % 11;
  const checksum = 11 - mod;
  if (checksum === 11) return "0";
  if (checksum === 10) return "9";
  return checksum.toString();
}

function synthesizePhone(rng: () => number): string {
  const area = pick(rng, ["11", "221", "341", "351", "343", "380"]);
  const part1 = randomDigits(rng, 4);
  const part2 = randomDigits(rng, 4);
  return `+54 ${area} ${part1}-${part2}`;
}

function synthesizeEmail(rng: () => number, _indexInType: number): string {
  const user = `user${randomDigits(rng, 5)}`;
  const domain = pick(rng, ["example.org", "example.com", "test.net", "anon.ar"]);
  return `${user}@${domain}`;
}

function synthesizeIban(rng: () => number): string {
  // IBAN AR ficticio (AR no usa IBAN pero el tipo está definido por compatibilidad futura).
  const country = pick(rng, ["ES", "FR", "DE", "GB"]);
  const checksum = randomDigits(rng, 2).padStart(2, "0");
  const bban = randomDigits(rng, 20);
  return `${country}${checksum} ${bban.slice(0, 4)} ${bban.slice(4, 8)} ${bban.slice(8, 12)} ${bban.slice(12, 16)} ${bban.slice(16, 20)}`;
}

function synthesizeCreditCard(rng: () => number): string {
  // 16 dígitos, pasa Luhn.
  const prefix = pick(rng, ["4", "5", "51", "52", "55"]);
  const body = randomDigits(rng, 15 - prefix.length);
  const base = `${prefix}${body}`;
  const check = computeLuhnCheck(base);
  const full = `${base}${check}`;
  return `${full.slice(0, 4)} ${full.slice(4, 8)} ${full.slice(8, 12)} ${full.slice(12, 16)}`;
}

function computeLuhnCheck(base: string): string {
  let sum = 0;
  let double = true;
  for (let i = base.length - 1; i >= 0; i--) {
    let d = parseInt(base.charAt(i), 10);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  const mod = sum % 10;
  return mod === 0 ? "0" : (10 - mod).toString();
}

function synthesizeDate(rng: () => number): string {
  const day = Math.floor(rng() * 28) + 1;
  const month = Math.floor(rng() * 12) + 1;
  const year = 1960 + Math.floor(rng() * 60);
  return `${day.toString().padStart(2, "0")}/${month.toString().padStart(2, "0")}/${year}`;
}

const PERSON_FIRST_NAMES = [
  "Carlos",
  "María",
  "Juan",
  "Ana",
  "José",
  "Laura",
  "Pedro",
  "Sofía",
  "Diego",
  "Elena",
  "Andrés",
  "Patricia",
  "Fernando",
  "Claudia",
  "Ricardo",
] as const;

const PERSON_LAST_NAMES = [
  "Sánchez",
  "Gómez",
  "Fernández",
  "López",
  "Martínez",
  "Pérez",
  "Romero",
  "Torres",
  "Díaz",
  "Ruiz",
  "Acosta",
  "Vega",
  "Castro",
  "Medina",
] as const;

function synthesizePerson(rng: () => number): string {
  return `${pick(rng, PERSON_FIRST_NAMES)} ${pick(rng, PERSON_LAST_NAMES)}`;
}

const ORG_NAMES = [
  "Empresa S.A.",
  "Grupo Norte S.R.L.",
  "Inversiones Sur",
  "Comercial del Plata",
  "Tecnología Andina",
  "Soluciones Globales",
  "Estudio Central",
  "Consultora Río",
] as const;

function synthesizeOrganization(rng: () => number): string {
  return pick(rng, ORG_NAMES);
}

const STREET_NAMES = [
  "Belgrano",
  "Rivadavia",
  "San Martín",
  "Mitre",
  "Sarmiento",
  "Alvear",
  "Pueyrredón",
  "Independencia",
  "Libertador",
  "Corrientes",
  "Florida",
  "Maipú",
] as const;

function synthesizeAddress(rng: () => number): string {
  const street = pick(rng, STREET_NAMES);
  const number = Math.floor(rng() * 9999) + 100;
  return `${street} ${number}`;
}

function synthesizeLicense(rng: () => number): string {
  // Matrícula profesional AR ficticia: X-XXXX-XX.
  const letters = randomDigits(rng, 1).replace("0", "1");
  const num1 = randomDigits(rng, 4);
  const num2 = randomDigits(rng, 2);
  return `${letters}-${num1}-${num2}`;
}

function synthesizePlate(rng: () => number): string {
  // Patente AR Mercosur: AB 123 CD.
  const letters = "ABCDEFGHJKLMNPRSTVWXYZ";
  const l1 = letters.charAt(Math.floor(rng() * letters.length));
  const l2 = letters.charAt(Math.floor(rng() * letters.length));
  const num = randomDigits(rng, 3);
  const l3 = letters.charAt(Math.floor(rng() * letters.length));
  const l4 = letters.charAt(Math.floor(rng() * letters.length));
  return `${l1}${l2} ${num} ${l3}${l4}`;
}
