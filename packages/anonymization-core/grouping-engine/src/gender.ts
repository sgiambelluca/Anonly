/**
 * Inferencia de `EntityGroup.personGender` desde `canonicalValue` (ADR-060
 * §4). Función pura, sin estado: recibe el léxico ya construido (ADR-069 §1,
 * `GENDER_LEXICON` de `gender-lexicon.generated.ts`, fuente única Buenos
 * Aires Data) como parámetro — este módulo no hace fetch, no lee filesystem
 * y no conoce la forma del artefacto commiteado (P-6/P-7). Quién la llama y
 * en qué momento del ciclo de vida del grupo es `grouping.engine.ts`
 * (`inferGenderIfDue`, ADR-069 §6).
 *
 * Orden de los pasos (ADR-060 §4), literal:
 *   1. Secuencia completa de nombres de pila (todo menos el último token,
 *      asumido apellido). Acierto → ese género.
 *   2. Si no hay acierto, primer token solo.
 *   3. Nombre ausente del léxico, o marcado ambiguo, o (tras agotar 1 y 2)
 *      sin acierto → sin determinar (`undefined`).
 * Sin heurística de terminación ("-a"/"-o"): descartada explícitamente por
 * ADR-060 Contexto §4 — el costo de una inferencia incorrecta es imprimirla
 * en un documento que va a manos de un tercero.
 */

import type { PersonGender } from "@anonly/shared";

/**
 * Valor por nombre en el léxico (ADR-069 §1): determinado (`"f"`/`"m"`) o
 * `"ambiguous"` — nombre marcado `A` (unisex) en el registro de Buenos
 * Aires. Las claves están pre-normalizadas (ver `normalizeForLexicon`):
 * quien construye un `GenderLexicon` es responsable de normalizar antes de
 * insertar.
 */
export type GenderLexiconLabel = "f" | "m" | "ambiguous";
export type GenderLexicon = ReadonlyMap<string, GenderLexiconLabel>;

/** Léxico vacío: toda inferencia resuelve "sin determinar" (peor caso = comportamiento pre-ADR-060). */
export const EMPTY_GENDER_LEXICON: GenderLexicon = new Map();

/**
 * Normalización exacta de ADR-060 §4: NFC, minúsculas, sin diacríticos. Se
 * aplica tanto al construir las claves del léxico (build script) como al
 * `canonicalValue` que se busca en runtime — ambos lados deben coincidir.
 */
// Rango Unicode "Combining Diacritical Marks" (U+0300–U+036F) en forma de
// escape explícito (no literal): un carácter combinante pegado en el código
// fuente es indistinguible a simple vista de texto normal y frágil frente a
// cualquier re-normalización del archivo por el editor/herramientas.
const COMBINING_DIACRITICS_RE = /[\u0300-\u036f]/g;

export function normalizeForLexicon(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_RE, "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * ADR-069 §3, defensa en profundidad: una clave de búsqueda de UN SOLO
 * TOKEN (sin espacios) que mide un carácter o contiene un punto no se
 * consulta nunca — "j", "j.", "j.m." caen a sin determinar sin tocar la
 * tabla. Es redundante a propósito con el filtro del build (que descarta
 * esas mismas claves del artefacto): esto es lo que mantiene "J. Pérez"
 * imposible de resolver aunque el artefacto se regenere con otro criterio o
 * se sirva uno viejo. No afecta claves multi-token ("maria de la o" se busca
 * entera, ADR-069 §3).
 */
function isBlockedInitialsKey(key: string): boolean {
  return !key.includes(" ") && (key.length === 1 || key.includes("."));
}

/** Un acierto del léxico solo cuenta si es determinado — "ambiguous" es igual a ausencia (§4 paso 3). */
function lookupDetermined(lexicon: GenderLexicon, key: string): PersonGender | undefined {
  if (isBlockedInitialsKey(key)) return undefined;
  const entry = lexicon.get(key);
  return entry === "f" || entry === "m" ? entry : undefined;
}

/**
 * Infiere `personGender` desde un `canonicalValue` (típicamente el de un
 * `EntityGroup` de `type === Person`). Devuelve `undefined` ("sin
 * determinar") ante cualquier duda — nunca elige entre dos géneros posibles.
 */
export function inferPersonGender(
  canonicalValue: string,
  lexicon: GenderLexicon,
): PersonGender | undefined {
  const tokens = normalizeForLexicon(canonicalValue)
    .split(" ")
    .filter((token) => token.length > 0);
  const first = tokens[0];
  if (first === undefined) return undefined;

  // Paso 1: con un solo token no hay "apellido" que excluir — coincide con
  // el paso 2, que queda como no-op (misma clave).
  const givenNameSequence = tokens.length > 1 ? tokens.slice(0, -1).join(" ") : first;
  const bySequence = lookupDetermined(lexicon, givenNameSequence);
  if (bySequence !== undefined) return bySequence;

  // Paso 2.
  return lookupDetermined(lexicon, first);
}
