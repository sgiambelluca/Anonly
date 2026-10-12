/**
 * `releaseNotesView.ts` — la lógica pura del menú de novedades
 * (`ui/Components.md` §2.9b, ADR-216 §2): el orden de las versiones, cuál lleva
 * "Instalada", la fecha en formato largo y las etiquetas de cada tipo.
 *
 * Vive fuera de `ReleaseNotesMenu.tsx` porque `vitest.config.ts` corre con
 * `environment: node` y no hay tests de render.
 */

import type { ReleaseNoteKind, ReleaseNotesEntry } from "./releaseNotes.js";

/** Las etiquetas se distinguen por su texto, no solo por el color (ADR-216 §2). */
export const RELEASE_NOTE_LABEL: Readonly<Record<ReleaseNoteKind, string>> = {
  new: "Nuevo",
  improvement: "Mejora",
  fix: "Arreglo",
};

const MONTHS: ReadonlyArray<string> = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * `AAAA-MM-DD` → sus partes, o `null` si no es una fecha del calendario.
 *
 * No pasa por `new Date("AAAA-MM-DD")` para formatear: eso se interpreta en UTC
 * y, mostrado en la zona del usuario, corre un día en las zonas al oeste de
 * Greenwich (Argentina incluida). `Date.UTC` solo se usa para validar que el
 * día existe (el 31 de abril no).
 */
function parseIsoDate(date: string): DateParts | null {
  const match = ISO_DATE.exec(date);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** ¿Es `AAAA-MM-DD` y una fecha que existe? */
export function isValidReleaseDate(date: string): boolean {
  return parseIsoDate(date) !== null;
}

/**
 * La fecha en formato largo: `2026-10-02` → "2 de octubre de 2026". Una fecha
 * inválida se muestra tal cual en vez de romper el menú.
 */
export function formatReleaseDate(date: string): string {
  const parts = parseIsoDate(date);
  if (parts === null) return date;
  return `${String(parts.day)} de ${MONTHS[parts.month - 1] ?? ""} de ${String(parts.year)}`;
}

/** `X.Y.Z` → `[X, Y, Z]`, o `null` si no tiene esa forma. */
export function parseVersion(version: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compara dos versiones `X.Y.Z` numéricamente: negativo si `a` es menor que
 * `b`, positivo si es mayor, 0 si son iguales. Una versión que no tiene esa
 * forma queda por debajo de las que sí.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** De la más nueva a la más vieja. No muta la lista que recibe. */
export function orderReleaseNotes(
  entries: ReadonlyArray<ReleaseNotesEntry>,
): ReadonlyArray<ReleaseNotesEntry> {
  return [...entries].sort((a, b) => compareVersions(b.version, a.version));
}

/** "Instalada" va en la versión igual a la que corre (`__ANONLY_VERSION__`). */
export function isInstalledVersion(entryVersion: string, installedVersion: string): boolean {
  return entryVersion === installedVersion;
}
