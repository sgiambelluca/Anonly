/**
 * Generadores de datos sintéticos con verificador calculado, para los corpus.
 * Todos los cuerpos que se pasan acá los inventé; los dígitos verificadores
 * salen de `checks.ts`.
 */

import { buildCbu, pyRucDv, rutDv, uyCiDv, uyRutDv } from "./checks.js";

const withDots = (n: number | string): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// Chile
export const rutBody = (body: number): string => String(body);
export const rutDots = (body: number): string => `${withDots(body)}-${rutDv(String(body))}`;
export const rutPlain = (body: number): string => `${body}-${rutDv(String(body))}`;
export const rutNoHyphen = (body: number): string => `${body}${rutDv(String(body))}`;
export const rutSpaceDv = (body: number): string => `${withDots(body)} ${rutDv(String(body))}`;
/** Mismo cuerpo, DV equivocado (el siguiente dígito, nunca el correcto). */
export const rutWrongDv = (body: number): string => {
  const good = rutDv(String(body));
  const bad = good === "9" ? "1" : good === "K" ? "2" : String((Number(good) + 1) % 10);
  return `${withDots(body)}-${bad}`;
};

/** Primer cuerpo desde `from` cuyo DV es `dv`. */
export function rutWithDv(dv: string, from: number): number {
  for (let b = from; b < from + 100; b++) if (rutDv(String(b)) === dv) return b;
  throw new Error(`sin cuerpo con DV ${dv} desde ${from}`);
}

// Uruguay
export const uyCiDots = (body: number): string => {
  const s = String(body);
  const dv = uyCiDv(s);
  return s.length === 7
    ? `${s[0]}.${s.slice(1, 4)}.${s.slice(4)}-${dv}`
    : `${s.slice(0, 3)}.${s.slice(3)}-${dv}`;
};
export const uyCiHyphen = (body: number): string => `${body}-${uyCiDv(String(body))}`;
export const uyCiDigits = (body: number): string => `${body}${uyCiDv(String(body))}`;
export const uyCiNoDv = (body: number): string => {
  const s = String(body);
  return s.length === 7
    ? `${s[0]}.${s.slice(1, 4)}.${s.slice(4)}`
    : `${s.slice(0, 3)}.${s.slice(3)}`;
};
export const uyCiWrongDv = (body: number): string => {
  const s = String(body);
  const dv = uyCiDv(s);
  const bad = String((Number(dv) + 3) % 10);
  return s.length === 7
    ? `${s[0]}.${s.slice(1, 4)}.${s.slice(4)}-${bad}`
    : `${s.slice(0, 3)}.${s.slice(3)}-${bad}`;
};

/** `serie` (2) + `numero` (6) + `001` + DV; `null` si el resto da 10 (no se emite). */
export function uyRutParts(serie: string, numero: string): string | null {
  const first11 = `${serie}${numero}001`;
  const dv = uyRutDv(first11);
  return dv === null ? null : `${first11}${dv}`;
}
/** Primer número de 6 dígitos desde `from` para el que el RUT se puede emitir (resto ≠ 10). */
export function uyRutNumero(serie: string, from: number): string {
  for (let k = from; k < from + 100; k++) {
    const numero = String(k).padStart(6, "0");
    if (uyRutParts(serie, numero) !== null) return numero;
  }
  throw new Error(`sin RUT emitible en la serie ${serie} desde ${from}`);
}
export const uyRutContinuous = (serie: string, numero: string): string => {
  const r = uyRutParts(serie, numero);
  if (r === null) throw new Error(`RUT sintético inválido: ${serie} ${numero}`);
  return r;
};
export const uyRutSeparated = (serie: string, numero: string, sep: string): string => {
  const r = uyRutContinuous(serie, numero);
  return `${r.slice(0, 2)}${sep}${r.slice(2, 8)}${sep}${r.slice(8, 11)}${sep}${r.slice(11)}`;
};
export const uyRutWrongDv = (serie: string, numero: string, sep: string): string => {
  const r = uyRutContinuous(serie, numero);
  const bad = String((Number(r.slice(11)) + 4) % 10);
  return `${r.slice(0, 2)}${sep}${r.slice(2, 8)}${sep}${r.slice(8, 11)}${sep}${bad}`;
};

// Paraguay
export const pyRuc = (body: number): string => `${body}-${pyRucDv(String(body))}`;
export const pyRucDots = (body: number): string => `${withDots(body)}-${pyRucDv(String(body))}`;
export const pyCiDots = (body: number): string => withDots(body);

// Argentina
/** CUIT con guiones desde `prefix` (2) y `dni` (8); el DV sale del módulo 11 de AFIP. `null` si da 10. */
export function cuitDashed(prefix: string, dni: string): string | null {
  const first10 = `${prefix}${dni}`;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(first10[i]) * (weights[i] ?? 0);
  const r = 11 - (sum % 11);
  if (r === 10) return null;
  return `${prefix}-${dni}-${r === 11 ? 0 : r}`;
}
/** `entity` (3) + `branch` (4) + cuenta de 13 dígitos → 22 dígitos con los dos DV. */
export const cbu22 = (entity: string, branch: string, account13: string): string =>
  buildCbu(`${entity}${branch}`, account13);
export const cbuGroups8x14 = (c: string): string => `${c.slice(0, 8)} ${c.slice(8)}`;
export const cbuGroups4 = (c: string): string =>
  `${c.slice(0, 4)} ${c.slice(4, 8)} ${c.slice(8, 12)} ${c.slice(12, 16)} ${c.slice(16, 20)} ${c.slice(20)}`;
export const cbuWrongDv2 = (c: string): string => `${c.slice(0, 21)}${(Number(c[21]) + 1) % 10}`;
export const cbuWrongDv1 = (c: string): string =>
  `${c.slice(0, 7)}${(Number(c[7]) + 1) % 10}${c.slice(8)}`;

export const dotted = withDots;
