/**
 * Métricas de la medición: compara lo que emiten los formatos contra la
 * verdad anotada del corpus.
 *
 * Clasificación de cada match emitido (`Hit`) contra las verdades del documento:
 * - `tp`: mismo tramo y mismo tipo que una verdad;
 * - `partial`: solapa una verdad del mismo tipo con otro tramo (más corto o más largo);
 * - `other`: solapa una verdad de otro tipo y de ninguno del mismo;
 * - `fp-neg`: no solapa ninguna verdad y sí un negativo anotado;
 * - `fp-text`: no solapa ninguna verdad ni negativo (texto corriente).
 * Un match puede ser `fp` aunque el formato sea «correcto»: la verdad manda.
 */

import { runFormats } from "./engine.js";
import type { CorpusDoc, Hit, ProtoFormat, Truth } from "./types.js";

export type HitKind = "tp" | "partial" | "other" | "fp-neg" | "fp-text";
export type TruthStatus = "exact" | "partial" | "other" | "miss";

export interface ClassifiedHit {
  readonly hit: Hit;
  readonly doc: CorpusDoc;
  readonly kind: HitKind;
  readonly truth: Truth | null;
}

export interface TruthResult {
  readonly truth: Truth;
  readonly doc: CorpusDoc;
  readonly status: TruthStatus;
  /** Forma del match que cubre (exacto o parcial), si la hay. */
  readonly byForm: string | null;
  readonly hit: Hit | null;
}

export interface RunResult {
  readonly hits: ReadonlyArray<ClassifiedHit>;
  readonly truths: ReadonlyArray<TruthResult>;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean =>
  a.start < b.end && b.start < a.end;

export function evaluate(
  formats: ReadonlyArray<ProtoFormat>,
  docs: ReadonlyArray<CorpusDoc>,
): RunResult {
  const hits: ClassifiedHit[] = [];
  const truths: TruthResult[] = [];
  for (const doc of docs) {
    const raw = runFormats(formats, doc.text);
    for (const hit of raw) {
      const touching = doc.truths.filter((t) => overlaps(hit, t));
      const exact = touching.find(
        (t) => t.start === hit.start && t.end === hit.end && t.entityType === hit.entityType,
      );
      if (exact !== undefined) {
        hits.push({ hit, doc, kind: "tp", truth: exact });
        continue;
      }
      const same = touching.find((t) => t.entityType === hit.entityType);
      if (same !== undefined) {
        hits.push({ hit, doc, kind: "partial", truth: same });
        continue;
      }
      const other = touching[0];
      if (other !== undefined) {
        hits.push({ hit, doc, kind: "other", truth: other });
        continue;
      }
      const neg = doc.negs.some((nn) => overlaps(hit, nn));
      hits.push({ hit, doc, kind: neg ? "fp-neg" : "fp-text", truth: null });
    }
    for (const truth of doc.truths) {
      const touching = raw.filter((h) => overlaps(h, truth));
      const exact = touching.find(
        (h) => h.start === truth.start && h.end === truth.end && h.entityType === truth.entityType,
      );
      if (exact !== undefined) {
        truths.push({ truth, doc, status: "exact", byForm: exact.formId, hit: exact });
        continue;
      }
      const same = touching.find((h) => h.entityType === truth.entityType);
      if (same !== undefined) {
        truths.push({ truth, doc, status: "partial", byForm: same.formId, hit: same });
        continue;
      }
      const other = touching[0];
      if (other !== undefined) {
        truths.push({ truth, doc, status: "other", byForm: other.formId, hit: other });
        continue;
      }
      truths.push({ truth, doc, status: "miss", byForm: null, hit: null });
    }
  }
  return { hits, truths };
}

export interface Tally {
  expected: number;
  exact: number;
  partial: number;
  other: number;
  miss: number;
}

export function tally(results: ReadonlyArray<TruthResult>): Tally {
  const t: Tally = { expected: 0, exact: 0, partial: 0, other: 0, miss: 0 };
  for (const r of results) {
    t.expected += 1;
    if (r.status === "exact") t.exact += 1;
    else if (r.status === "partial") t.partial += 1;
    else if (r.status === "other") t.other += 1;
    else t.miss += 1;
  }
  return t;
}

export const pct = (num: number, den: number): string =>
  den === 0 ? "n/a" : `${((100 * num) / den).toFixed(1)} %`;

/** Cuenta de matches por clase. */
export function hitCounts(hits: ReadonlyArray<ClassifiedHit>): Record<HitKind, number> {
  const c: Record<HitKind, number> = { tp: 0, partial: 0, other: 0, "fp-neg": 0, "fp-text": 0 };
  for (const h of hits) c[h.kind] += 1;
  return c;
}

/** Verdades esperadas de una forma (incluye lo que cubre una forma que la reemplaza). */
export function expectedFor(form: ProtoFormat, truths: ReadonlyArray<TruthResult>): TruthResult[] {
  return truths.filter(
    (r) =>
      r.truth.kind === "P" && (r.truth.form === form.id || r.truth.form === (form.replaces ?? "")),
  );
}
