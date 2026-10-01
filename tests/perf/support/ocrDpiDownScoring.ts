/**
 * Puntaje puro de la campaña de DPI descendente: comparación de entidades por tipo, solapamiento de
 * cajas (IoU) y puntaje de tokens. Sin filesystem ni navegador. En los corpus reales quien llama
 * descarta las listas con valores (`missed`, `added`) antes de escribir: aquí solo se calcula.
 */

import { tokens } from "./adr190Dpi.js";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ObservedEntity {
  readonly type: string;
  readonly value: string;
  readonly pageIndex: number;
  readonly box: Box | null;
}

/** Valor reducido a letras y dígitos sin mayúsculas ni diacríticos; el teléfono, a sus diez últimos dígitos. */
export function canonicalValue(type: string, value: string): string {
  const reduced = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (type === "PHONE") {
    const digits = reduced.replace(/\D/g, "");
    return digits.length > 10 ? digits.slice(-10) : digits;
  }
  return reduced;
}

export function entityKey(entity: ObservedEntity): string {
  return `${entity.type}|${entity.pageIndex}|${canonicalValue(entity.type, entity.value)}`;
}

export interface TypeCounts {
  readonly expected: number;
  readonly detected: number;
  readonly matched: number;
  readonly missed: number;
  readonly added: number;
}

export interface EntityComparison {
  readonly byType: Readonly<Record<string, TypeCounts>>;
  readonly totals: TypeCounts;
  readonly missed: ReadonlyArray<{
    readonly type: string;
    readonly pageIndex: number;
    readonly value: string;
  }>;
  readonly added: ReadonlyArray<{
    readonly type: string;
    readonly pageIndex: number;
    readonly value: string;
  }>;
}

function groupByKey(entities: ReadonlyArray<ObservedEntity>): Map<string, ObservedEntity[]> {
  const groups = new Map<string, ObservedEntity[]>();
  for (const entity of entities) {
    const key = entityKey(entity);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [entity]);
    else list.push(entity);
  }
  return groups;
}

/** Multiconjunto por (tipo, página, valor canónico): cuántas esperadas hay, cuántas se detectaron. */
export function compareEntities(
  reference: ReadonlyArray<ObservedEntity>,
  candidate: ReadonlyArray<ObservedEntity>,
): EntityComparison {
  const referenceGroups = groupByKey(reference);
  const candidateGroups = groupByKey(candidate);
  const counts = new Map<
    string,
    { expected: number; detected: number; matched: number; missed: number; added: number }
  >();
  const bucket = (type: string) => {
    let entry = counts.get(type);
    if (entry === undefined) {
      entry = { expected: 0, detected: 0, matched: 0, missed: 0, added: 0 };
      counts.set(type, entry);
    }
    return entry;
  };
  const missed: { type: string; pageIndex: number; value: string }[] = [];
  const added: { type: string; pageIndex: number; value: string }[] = [];
  for (const entity of reference) bucket(entity.type).expected += 1;
  for (const entity of candidate) bucket(entity.type).detected += 1;
  for (const key of new Set([...referenceGroups.keys(), ...candidateGroups.keys()])) {
    const expected = referenceGroups.get(key) ?? [];
    const detected = candidateGroups.get(key) ?? [];
    const sample = expected[0] ?? detected[0];
    if (sample === undefined) continue;
    const matched = Math.min(expected.length, detected.length);
    bucket(sample.type).matched += matched;
    for (const entity of expected.slice(matched)) {
      bucket(sample.type).missed += 1;
      missed.push({ type: entity.type, pageIndex: entity.pageIndex, value: entity.value });
    }
    for (const entity of detected.slice(matched)) {
      bucket(sample.type).added += 1;
      added.push({ type: entity.type, pageIndex: entity.pageIndex, value: entity.value });
    }
  }
  const byType: Record<string, TypeCounts> = {};
  const totals = { expected: 0, detected: 0, matched: 0, missed: 0, added: 0 };
  for (const [type, entry] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    byType[type] = entry;
    totals.expected += entry.expected;
    totals.detected += entry.detected;
    totals.matched += entry.matched;
    totals.missed += entry.missed;
    totals.added += entry.added;
  }
  return { byType, totals, missed, added };
}

/**
 * Cobertura (plan §6.3): fracción del área de la caja de referencia que queda dentro de la caja del
 * brazo. Una caja que crece no penaliza; una que se achica o se corre, sí. `null` si la referencia
 * no tiene área (no es medible).
 */
export function boxCoverage(reference: Box, arm: Box): number | null {
  const referenceArea = reference.width * reference.height;
  if (!(referenceArea > 0)) return null;
  const left = Math.max(reference.x, arm.x);
  const top = Math.max(reference.y, arm.y);
  const right = Math.min(reference.x + reference.width, arm.x + arm.width);
  const bottom = Math.min(reference.y + reference.height, arm.y + arm.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / referenceArea;
}

export interface CoveragePairing {
  /** Cobertura de cada entidad presente en los dos brazos, ordenadas de menor a mayor. */
  readonly values: ReadonlyArray<number>;
  /** Entidades presentes en los dos brazos sin caja medible en alguno: dejan el corpus indeterminado. */
  readonly pairsWithoutBox: number;
}

/**
 * Empareja, por clave, las entidades de los dos brazos (primero los pares de mayor cobertura) y
 * devuelve la cobertura de cada par. Una clave que está en uno solo no aporta: es una pérdida o un
 * agregado, ya contado en `compareEntities`.
 */
export function pairBoxCoverage(
  reference: ReadonlyArray<ObservedEntity>,
  candidate: ReadonlyArray<ObservedEntity>,
): CoveragePairing {
  const referenceGroups = groupByKey(reference);
  const candidateGroups = groupByKey(candidate);
  const values: number[] = [];
  let pairsWithoutBox = 0;
  for (const [key, expected] of referenceGroups) {
    const detected = candidateGroups.get(key);
    if (detected === undefined) continue;
    const candidates: { i: number; j: number; coverage: number }[] = [];
    for (const [i, left] of expected.entries())
      for (const [j, right] of detected.entries()) {
        if (left.box === null || right.box === null) continue;
        const coverage = boxCoverage(left.box, right.box);
        if (coverage !== null) candidates.push({ i, j, coverage });
      }
    candidates.sort((a, b) => b.coverage - a.coverage || a.i - b.i || a.j - b.j);
    const usedLeft = new Set<number>();
    const usedRight = new Set<number>();
    for (const pair of candidates) {
      if (usedLeft.has(pair.i) || usedRight.has(pair.j)) continue;
      usedLeft.add(pair.i);
      usedRight.add(pair.j);
      values.push(pair.coverage);
    }
    pairsWithoutBox += Math.min(expected.length, detected.length) - usedLeft.size;
  }
  return { values: values.sort((a, b) => a - b), pairsWithoutBox };
}

export const COVERAGE_BINS: ReadonlyArray<number> = [0.99, 0.95, 0.9, 0.75, 0.5];

export interface Distribution {
  readonly count: number;
  readonly min: number;
  readonly p05: number;
  readonly median: number;
  readonly mean: number;
  readonly max: number;
  /** Cuántos valores quedan por debajo de cada cota descriptiva; no es el umbral de decisión. */
  readonly belowBin: Readonly<Record<string, number>>;
}

function quantile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 1) return sorted[0] ?? 0;
  const position = p * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? 0;
  return lowValue + (highValue - lowValue) * (position - low);
}

/** `null` si no hay valores: una distribución vacía no se convierte en un cero. */
export function distributionOf(values: ReadonlyArray<number>): Distribution | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    p05: quantile(sorted, 0.05),
    median: quantile(sorted, 0.5),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    max: sorted[sorted.length - 1] ?? 0,
    belowBin: Object.fromEntries(
      COVERAGE_BINS.map((bin) => [String(bin), sorted.filter((value) => value < bin).length]),
    ),
  };
}

export interface TokenScore {
  readonly expectedTokens: number;
  readonly observedTokens: number;
  readonly matchedTokens: number;
  readonly recall: number | null;
  readonly precision: number | null;
}

/** Recall y precisión de tokens (multiconjunto); solo conteos, nunca los tokens. */
export function scoreTokens(referenceText: string, observedText: string): TokenScore {
  const expected = tokens(referenceText);
  const observed = tokens(observedText);
  const remaining = new Map<string, number>();
  for (const token of expected) remaining.set(token, (remaining.get(token) ?? 0) + 1);
  let matched = 0;
  for (const token of observed) {
    const left = remaining.get(token) ?? 0;
    if (left > 0) {
      matched += 1;
      remaining.set(token, left - 1);
    }
  }
  return {
    expectedTokens: expected.length,
    observedTokens: observed.length,
    matchedTokens: matched,
    recall: expected.length > 0 ? matched / expected.length : null,
    precision: observed.length > 0 ? matched / observed.length : null,
  };
}
