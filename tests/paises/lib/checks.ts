/**
 * Verificadores y normalizadores de los prototipos de la tanda 1.
 *
 * Los algoritmos son los del informe de investigación (§1.2, §2.2, §2.3, §3.3,
 * §5.1). Los dígitos verificadores de los ejemplos del corpus se calculan acá:
 * ningún número sale de una página ni de un documento real.
 */

function digitsOf(value: string): number[] {
  return [...value].map((ch) => Number(ch));
}

// ─── Chile: RUT (módulo 11) ───

export function rutDv(body: string): string {
  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const r = 11 - (sum % 11);
  if (r === 11) return "0";
  if (r === 10) return "K";
  return String(r);
}

/** `normalized` es `cuerpo-DV`, con el DV en mayúscula. */
export function validRut(normalized: string): boolean {
  const m = /^(\d{1,9})-([\dK])$/.exec(normalized);
  if (m === null) return false;
  return rutDv(m[1] ?? "") === m[2];
}

/** Quita puntos y espacios, DV en mayúscula, y deja el guion entre cuerpo y DV. */
export function normalizeRut(raw: string): string {
  const compact = raw.replace(/[.\s-]/g, "").toUpperCase();
  return `${compact.slice(0, -1)}-${compact.slice(-1)}`;
}

// ─── Uruguay: CI (módulo 10) y RUT (módulo 11) ───

const UY_CI_WEIGHTS = [2, 9, 8, 7, 6, 3, 4] as const;

export function uyCiDv(body: string): string {
  const padded = body.padStart(7, "0");
  let sum = 0;
  digitsOf(padded).forEach((d, i) => {
    sum += d * (UY_CI_WEIGHTS[i] ?? 0);
  });
  return String((10 - (sum % 10)) % 10);
}

/** `digits` = cuerpo de 6 o 7 dígitos + DV (7 u 8 dígitos). */
export function validUyCi(digits: string): boolean {
  if (!/^\d{7,8}$/.test(digits)) return false;
  return uyCiDv(digits.slice(0, -1)) === digits.slice(-1);
}

const UY_RUT_WEIGHTS = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/** `null` si el resto da 10 (número que no se emite). */
export function uyRutDv(first11: string): string | null {
  let sum = 0;
  digitsOf(first11).forEach((d, i) => {
    sum += d * (UY_RUT_WEIGHTS[i] ?? 0);
  });
  const dv = (11 - (sum % 11)) % 11;
  return dv === 10 ? null : String(dv);
}

/** 12 dígitos: serie 01-22, tipo `001` en las posiciones 9-11, DV al final. */
export function validUyRut(digits: string): boolean {
  if (!/^\d{12}$/.test(digits)) return false;
  const serie = Number(digits.slice(0, 2));
  if (serie < 1 || serie > 22) return false;
  if (digits.slice(8, 11) !== "001") return false;
  return uyRutDv(digits.slice(0, 11)) === digits.slice(11);
}

// ─── Paraguay: RUC ───

/**
 * Pesos 2,3,4,… de derecha a izquierda; resto 0 o 1 → DV 0; si no, 11 − resto.
 * Reproduce el ejemplo del informe `80000519-8` (DNIT).
 */
export function pyRucDv(body: string): string {
  let sum = 0;
  for (let i = body.length - 1, w = 2; i >= 0; i--, w++) {
    sum += Number(body[i]) * (w > 11 ? w - 10 : w);
  }
  const r = sum % 11;
  return r <= 1 ? "0" : String(11 - r);
}

/** `cuerpo-DV` sin los puntos de la cédula (`1.234.567-9` → `1234567-9`). */
export const normalizePyRuc = (raw: string): string => raw.replace(/\./g, "");

export function validPyRuc(normalized: string): boolean {
  const m = /^(\d{5,9})-(\d)$/.exec(normalized);
  if (m === null) return false;
  return pyRucDv(m[1] ?? "") === m[2];
}

// ─── Argentina: CBU / CVU ───

const CBU_W1 = [7, 1, 3, 9, 7, 1, 3] as const;
const CBU_W2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3] as const;

function cbuDv(digits: string, weights: ReadonlyArray<number>): string {
  let sum = 0;
  digitsOf(digits).forEach((d, i) => {
    sum += d * (weights[i] ?? 0);
  });
  return String((10 - (sum % 10)) % 10);
}

export function validCbu(digits: string): boolean {
  if (!/^\d{22}$/.test(digits)) return false;
  return (
    cbuDv(digits.slice(0, 7), CBU_W1) === digits[7] &&
    cbuDv(digits.slice(8, 21), CBU_W2) === digits[21]
  );
}

/** Arma un CBU/CVU válido desde entidad(3)+sucursal(4) y cuenta(13). */
export function buildCbu(block1Seven: string, account13: string): string {
  return `${block1Seven}${cbuDv(block1Seven, CBU_W1)}${account13}${cbuDv(account13, CBU_W2)}`;
}

// ─── Lista de códigos (CL: Subtel 2006, UY: prefijos de celular, BO: extensiones) ───

export const CL_AREA_CODES: ReadonlyArray<string> = [
  "32",
  "33",
  "34",
  "35",
  "41",
  "42",
  "43",
  "45",
  "51",
  "52",
  "53",
  "55",
  "57",
  "58",
  "61",
  "63",
  "64",
  "65",
  "67",
  "71",
  "72",
  "73",
  "75",
];

// ─── Normalizadores de teléfono (reproducen la idea del informe: dígitos, con prefijo de país) ───

const onlyDigits = (value: string): string => value.replace(/\D/g, "");

export function normalizePhoneCl(raw: string): string {
  let d = onlyDigits(raw);
  // `(02) 2345 6789`: el 0 troncal de la forma antigua no es parte del número nacional.
  if (d.length === 10 && d.startsWith("0")) d = d.slice(1);
  return d.length === 9 ? `56${d}` : d;
}

export function normalizePhoneUy(raw: string): string {
  let d = onlyDigits(raw);
  if (d.startsWith("00598")) d = d.slice(2);
  if (d.startsWith("598")) {
    d = d.slice(3);
    if (d.startsWith("0")) d = d.slice(1);
    return `598${d}`;
  }
  if (d.startsWith("0")) d = d.slice(1);
  return `598${d}`;
}

export function normalizePhonePy(raw: string): string {
  let d = onlyDigits(raw);
  if (d.startsWith("00595")) d = d.slice(2);
  if (d.startsWith("595")) return d;
  if (d.startsWith("0")) d = d.slice(1);
  return `595${d}`;
}

export function normalizePhoneBo(raw: string): string {
  let d = onlyDigits(raw);
  if (d.startsWith("00591")) d = d.slice(2);
  if (d.startsWith("591")) return d;
  d = d.replace(/^0/, "");
  return `591${d}`;
}

export const normalizeUpperNoSep = (raw: string): string =>
  raw.toUpperCase().replace(/[\s.-]/g, "");

export const normalizeDigits = onlyDigits;
