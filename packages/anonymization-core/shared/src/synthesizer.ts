/**
 * @anonly/shared — Sintetizadores deterministas para modo `synthetic`.
 *
 * Fuente de verdad: docs/adr/ADR-012-Replacement-Modes.md, docs/core/Contracts.md §5-§6
 * y docs/core/Grouping_Engine.md §"Algoritmos clave".
 *
 * Contrato:
 * - Determinista por (type, groupId, seed): mismo input → mismo output.
 * - **Cambiar `indexInType` no cambia el valor** en los tipos que sortean
 *   (ADR-072 §1). La semilla es la IDENTIDAD del grupo, no su número: el
 *   número lo mueve la renumeración canónica de ADR-028, y sembrar sobre él
 *   hacía que el nombre falso de una persona cambiara por una operación
 *   ajena a esa persona.
 * - El valor sintético debe ser plausible y válido según el formato del tipo
 *   (checksum de CUIT, Luhn de tarjeta, formato de DNI, etc.).
 * - El seed es obligatorio: lo provee el caller. El seed aleatorio por sesión
 *   es responsabilidad del Grouping Engine (ADR-012 §SAN, ADR-019 §5).
 * - Nunca exponer el seed en el PDF resultante.
 * - La semilla **nunca deriva del valor real** (ADR-072 §6): sembrar con el
 *   `canonicalValue` convertiría esto en un oráculo de confirmación
 *   real→falso para quien tenga el seed.
 */

import { EntityType, type PersonGender } from "./enums.js";
import type { SyntheticRequest } from "./types.js";

/**
 * Genera un valor sintético determinista para una entidad.
 *
 * @param req Ver `SyntheticRequest` en `types.ts` / `Contracts.md` §5.
 * @returns Valor sintético plausible para el tipo.
 */
export function synthesize(req: SyntheticRequest): string {
  const { type, groupId, seed, indexInType, personGender } = req;
  const rng = createSeededRng(seed, type, groupId);
  switch (type) {
    case EntityType.DNI:
      return synthesizeDni(rng);
    case EntityType.CUIT:
      return synthesizeCuit(rng);
    case EntityType.Phone:
      return synthesizePhone(rng);
    case EntityType.Email:
      return synthesizeEmail(rng);
    case EntityType.IBAN:
      return synthesizeIban(rng);
    case EntityType.CreditCard:
      return synthesizeCreditCard(rng);
    case EntityType.Date:
      return synthesizeDate(rng);
    case EntityType.Person:
      return synthesizePerson(rng, personGender);
    case EntityType.Organization:
      return synthesizeOrganization(rng);
    case EntityType.Address:
      return synthesizeAddress(rng);
    case EntityType.License:
      return synthesizeLicense(rng);
    case EntityType.Plate:
      return synthesizePlate(rng);
    // ADR-072 §3: las dos únicas ramas que INTERPOLAN el número del grupo en
    // vez de sortear. Para ellas seguir el índice es lo correcto —son tokens
    // numerados, no identidades—, con la contracara de que una renumeración
    // las deja desactualizadas (roadmap/Future_Ideas.md §5.5).
    case EntityType.Custom:
      return `custom-${indexInType}`;
    default:
      return `synthetic-${indexInType}`;
  }
}

// ─── Implementación interna ───

/**
 * PRNG determinista (mulberry32) seedado por (seed, type, groupId).
 * No es criptográficamente seguro, pero alcanza para síntesis determinista.
 */
function createSeededRng(seed: string, type: EntityType, groupId: string): () => number {
  const fullSeed = hashStringToInt(`${seed}|${type}|${groupId}`);
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
  // DNI AR de 8 dígitos en rango realista (10.000.000-99.999.999): el primer
  // dígito nunca es 0. Formato XX.XXX.XXX.
  const first = (Math.floor(rng() * 9) + 1).toString();
  const n = `${first}${randomDigits(rng, 7)}`;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}`;
}

function synthesizeCuit(rng: () => number): string {
  // CUIT AR: XX-XXXXXXXX-X con dígito verificador AFIP válido (módulo 11).
  // Si el dv daría 10 (no existe en CUITs reales), se regenera el cuerpo con el
  // mismo rng: determinista (mismo seed → mismo resultado) y siempre válido (ADR-019).
  const prefix = pick(rng, ["20", "23", "24", "27", "30", "33", "34"]);
  for (;;) {
    const body = randomDigits(rng, 8);
    const checksum = computeCuitChecksum(prefix, body);
    if (checksum !== null) {
      return `${prefix}-${body}-${checksum}`;
    }
  }
}

/**
 * Dígito verificador módulo 11 de AFIP. Devuelve null si el dv daría 10:
 * ese CUIT no existe y el caller debe regenerar el cuerpo.
 */
function computeCuitChecksum(prefix: string, body: string): string | null {
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
  if (mod === 0) return "0";
  if (mod === 1) return null;
  return (11 - mod).toString();
}

function synthesizePhone(rng: () => number): string {
  const area = pick(rng, ["11", "221", "341", "351", "343", "380"]);
  const part1 = randomDigits(rng, 4);
  const part2 = randomDigits(rng, 4);
  return `+54 ${area} ${part1}-${part2}`;
}

function synthesizeEmail(rng: () => number): string {
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

/**
 * ADR-071 §5: el pool lleva el género por entrada. **El orden es el que la
 * tabla tenía antes de llevar género**, y eso importa: con `personGender`
 * ausente se sortea sobre este array completo, así que el resultado es
 * idéntico al que daría sin el campo. El género no entra a la semilla —
 * solo elige de qué array sortea `pick`.
 */
interface FirstName {
  readonly name: string;
  readonly gender: PersonGender;
}

const PERSON_FIRST_NAMES: ReadonlyArray<FirstName> = [
  { name: "Carlos", gender: "m" },
  { name: "María", gender: "f" },
  { name: "Juan", gender: "m" },
  { name: "Ana", gender: "f" },
  { name: "José", gender: "m" },
  { name: "Laura", gender: "f" },
  { name: "Pedro", gender: "m" },
  { name: "Sofía", gender: "f" },
  { name: "Diego", gender: "m" },
  { name: "Elena", gender: "f" },
  { name: "Andrés", gender: "m" },
  { name: "Patricia", gender: "f" },
  { name: "Fernando", gender: "m" },
  { name: "Claudia", gender: "f" },
  { name: "Ricardo", gender: "m" },
];

/** Precomputado: `pick` no debe pagar un `filter` por llamada. */
const FIRST_NAMES_BY_GENDER: Readonly<Record<PersonGender, ReadonlyArray<FirstName>>> = {
  f: PERSON_FIRST_NAMES.filter((entry) => entry.gender === "f"),
  m: PERSON_FIRST_NAMES.filter((entry) => entry.gender === "m"),
};

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

/**
 * Sin género resuelto se sortea del pool completo: no hay nombre de pila
 * neutro en español al cual caer, y este modo fabrica datos falsos por
 * definición (ADR-012). El piso es exactamente el comportamiento previo a
 * ADR-071 — que ya imprimía un género, solo que al azar.
 */
function synthesizePerson(rng: () => number, personGender: PersonGender | undefined): string {
  const pool =
    personGender === undefined ? PERSON_FIRST_NAMES : FIRST_NAMES_BY_GENDER[personGender];
  return `${pick(rng, pool).name} ${pick(rng, PERSON_LAST_NAMES)}`;
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
  // Matrícula profesional AR ficticia, formato XX-XXXX-XX (máscara de ADR-012).
  const part1 = randomDigits(rng, 2);
  const part2 = randomDigits(rng, 4);
  const part3 = randomDigits(rng, 2);
  return `${part1}-${part2}-${part3}`;
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
