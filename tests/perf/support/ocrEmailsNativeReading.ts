/**
 * Cómo leyó el OCR un email que el arnés no detectó (M-E1, `Confianza_1.0.x_Plan.md` Frente 2), y
 * cuántas cadenas del texto leído tienen la forma de un email con la `@` leída como `Q`. Todo puro:
 * trabaja sobre el texto que leyó el OCR de una página y sobre la verdad del sintético, nunca sobre
 * un documento real. Los fragmentos que devuelve son sintéticos.
 *
 * Definiciones (fijadas antes de medir):
 *
 * - **`@` como `Q`**: en el texto aparece `local` + `Q` + `dominio`, con el resto de la dirección
 *   intacto. Se compara sin distinguir mayúsculas.
 * - **Punto del nombre como espacio**: cada punto de la parte local (antes de la `@`) aparece como
 *   un espacio (`marina suarez@example.com`) o como el punto seguido de un espacio
 *   (`contacto. estudio@example.org`). Los puntos del dominio no cuentan: si cambian, la lectura es
 *   «otra».
 * - **Las dos cosas**: las dos lecturas anteriores a la vez.
 * - **Intacto en el texto**: la dirección está escrita tal cual en el texto leído; si no se detectó,
 *   la causa no es la lectura del OCR sino lo que viene después. Se separa para no mezclarlo.
 * - **Otra lectura**: ninguna de las anteriores. Se guarda el fragmento del texto más parecido
 *   (distancia de edición acotada), o `not-found` si no hay nada que se le parezca.
 * - **Forma Q**: una cadena del texto, delimitada por espacios y sin puntuación en los bordes, que
 *   cumple `^[A-Za-z0-9][A-Za-z0-9._%+-]*Q(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}$`. La `Q` es mayúscula
 *   (la que escribe el OCR en lugar de la `@`); si hay más de una, se toma la última cuya derecha
 *   es un dominio válido. Es la cota de lo que una regla tolerante a ese cambio tendría que mirar.
 */

import { canonicalValue } from "./ocrDpiDownScoring.js";

export type EmailReading =
  | "at-as-q"
  | "dot-as-space"
  | "at-as-q-and-dot-as-space"
  | "intact-in-text"
  | "other-reading"
  | "not-found";

export const EMAIL_READINGS: ReadonlyArray<EmailReading> = [
  "at-as-q",
  "dot-as-space",
  "at-as-q-and-dot-as-space",
  "intact-in-text",
  "other-reading",
  "not-found",
];

export interface LostEmailReading {
  readonly expected: string;
  readonly reading: EmailReading;
  /** Lo que el OCR escribió en lugar del email; `null` si no se encontró nada parecido. */
  readonly fragment: string | null;
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Distancia de edición (Levenshtein) entre dos cadenas cortas. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(substitution, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

const LEFT_BOUNDARY = "(?<![A-Za-z0-9._%+-])";
const RIGHT_BOUNDARY = "(?![A-Za-z0-9-])";

function variantRegex(local: string, domain: string, atAsQ: boolean, dotAsSpace: boolean): RegExp {
  const dot = dotAsSpace ? "(?:\\.\\s+|\\s+)" : "\\.";
  const localSource = local.split(".").map(escapeRegex).join(dot);
  const at = atAsQ ? "Q" : "@";
  return new RegExp(
    `${LEFT_BOUNDARY}${localSource}${at}${escapeRegex(domain)}${RIGHT_BOUNDARY}`,
    "i",
  );
}

/** El fragmento del texto más parecido al email esperado, o `null` si no hay nada que se le parezca. */
export function nearestFragment(expected: string, text: string): string | null {
  const lowerExpected = expected.toLowerCase();
  const lowerText = text.toLowerCase();
  const at = lowerExpected.indexOf("@");
  const local = at < 0 ? lowerExpected : lowerExpected.slice(0, at);
  const runs = lowerExpected.match(/[a-z0-9]{3,}/g) ?? [];
  // El ancla es el tramo alfanumérico más largo de la parte local (o, si no hay, de todo el email).
  const localRuns = local.match(/[a-z0-9]{3,}/g) ?? runs;
  const anchor = [...localRuns].sort((a, b) => b.length - a.length)[0];
  if (anchor === undefined) return null;
  const offset = lowerExpected.indexOf(anchor);
  let best: { readonly distance: number; readonly fragment: string } | null = null;
  let from = lowerText.indexOf(anchor);
  while (from >= 0) {
    const start = Math.max(0, from - offset);
    for (let length = expected.length - 3; length <= expected.length + 4; length += 1) {
      if (length <= 0) continue;
      const candidate = text.slice(start, start + length);
      const distance = editDistance(lowerExpected, candidate.toLowerCase());
      if (best === null || distance < best.distance)
        best = { distance, fragment: candidate.trim() };
    }
    from = lowerText.indexOf(anchor, from + 1);
  }
  if (best === null || best.distance > Math.ceil(expected.length * 0.4)) return null;
  return best.fragment;
}

/** Clasifica cómo quedó escrito en `pageText` el email `expected` que no se detectó. */
export function classifyLostEmail(expected: string, pageText: string): LostEmailReading {
  const at = expected.lastIndexOf("@");
  if (at <= 0 || at === expected.length - 1)
    return { expected, reading: "not-found", fragment: null };
  const local = expected.slice(0, at);
  const domain = expected.slice(at + 1);
  const hasDots = local.includes(".");
  const variants: ReadonlyArray<{
    readonly reading: EmailReading;
    readonly atAsQ: boolean;
    readonly dotAsSpace: boolean;
  }> = [
    { reading: "intact-in-text", atAsQ: false, dotAsSpace: false },
    { reading: "at-as-q", atAsQ: true, dotAsSpace: false },
    ...(hasDots
      ? ([
          { reading: "dot-as-space", atAsQ: false, dotAsSpace: true },
          { reading: "at-as-q-and-dot-as-space", atAsQ: true, dotAsSpace: true },
        ] as const)
      : []),
  ];
  for (const variant of variants) {
    const found = variantRegex(local, domain, variant.atAsQ, variant.dotAsSpace).exec(pageText);
    if (found !== null) return { expected, reading: variant.reading, fragment: found[0] };
  }
  const fragment = nearestFragment(expected, pageText);
  return fragment === null
    ? { expected, reading: "not-found", fragment: null }
    : { expected, reading: "other-reading", fragment };
}

const QSHAPE = /^([A-Za-z0-9][A-Za-z0-9._%+-]*)Q((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})$/;

export type QCandidateRelation = "recoverable" | "partial-of-truth" | "unrelated";

export interface QCandidate {
  readonly token: string;
  /** La cadena con la `Q` cambiada por `@`: lo que una regla tolerante reconocería. */
  readonly reconstructed: string;
  readonly relation: QCandidateRelation;
}

/**
 * Cadenas de `pageText` con la forma `nombre` + `Q` + `dominio.tld`, y su relación con los emails
 * de la verdad de esa página: `recoverable` si la reconstrucción es exactamente un email de la
 * verdad, `partial-of-truth` si es el final de uno (el nombre perdió un tramo por un espacio), y
 * `unrelated` si no corresponde a ninguno (la cota de falsos positivos).
 */
export function findQShapedCandidates(
  pageText: string,
  truthEmails: ReadonlyArray<string>,
): ReadonlyArray<QCandidate> {
  const truthKeys = truthEmails.map((email) => canonicalValue("EMAIL", email));
  const candidates: QCandidate[] = [];
  for (const raw of pageText.split(/\s+/)) {
    const token = raw.replace(/^[([{"']+/, "").replace(/[.,;:)\]}"']+$/, "");
    const match = QSHAPE.exec(token);
    if (match === null) continue;
    const reconstructed = `${match[1] ?? ""}@${match[2] ?? ""}`;
    const key = canonicalValue("EMAIL", reconstructed);
    const relation: QCandidateRelation = truthKeys.includes(key)
      ? "recoverable"
      : truthKeys.some((truthKey) => truthKey.length > key.length && truthKey.endsWith(key))
        ? "partial-of-truth"
        : "unrelated";
    candidates.push({ token, reconstructed, relation });
  }
  return candidates;
}

export interface QCandidateCounts {
  readonly total: number;
  readonly recoverable: number;
  readonly partialOfTruth: number;
  /** Cota de falsos positivos de una regla tolerante: cadenas con forma Q que no son ningún email de la verdad. */
  readonly unrelated: number;
}

export function countQCandidates(candidates: ReadonlyArray<QCandidate>): QCandidateCounts {
  const count = (relation: QCandidateRelation): number =>
    candidates.filter((candidate) => candidate.relation === relation).length;
  return {
    total: candidates.length,
    recoverable: count("recoverable"),
    partialOfTruth: count("partial-of-truth"),
    unrelated: count("unrelated"),
  };
}
