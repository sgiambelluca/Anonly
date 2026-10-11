/**
 * M-D3: la comparación de una corrida de M-D2 contra el criterio de ADR-217 («Cómo se decide si alcanza»).
 * Pura, sin Electron ni disco: recibe los registros de página de una corrida (`addressKeywordClassify.ts`)
 * y dice si la corrida cumple. Es una comparación, no un gate: si un número no da, la corrida no se
 * «arregla», se informa.
 *
 * El criterio:
 *
 * - **A la vista.** Una página de K1 a K7 tiene algo a la vista si su núcleo (el nombre y, si la hay, la
 *   altura) no quedó cubierto entero por la unión de las ocurrencias de cualquier tipo. Se esperan 4 de 138:
 *   «ruta 205 kilómetro 54» (K5-5) en las tres escrituras y «calle 13 entre 44 y 45» (K5-3) en escritura
 *   normal. Se informa también el recuento con solo las de tipo dirección.
 * - **Trampas (K8).** Una trampa está tapada si alguna ocurrencia, de cualquier tipo, toca la oración. Se
 *   esperan 0 de 9 en escritura normal y 12 de 18 en las dos escrituras en mayúsculas: las seis oraciones
 *   de la tabla de «Lo que se tapa de más» (K8-1, K8-2, K8-3, K8-7, K8-8 y K8-9), en `M` y en `S`.
 * - **Quién cerró.** Para cada página de K1 a K7 con el núcleo cubierto entero, si lo cerró el patrón
 *   (`source` `regex`) solo, el modelo solo, los dos por separado, o hizo falta la unión de ambos.
 * - **Dos direcciones sobre el mismo tramo** (límite de ADR-117): las páginas con dos ocurrencias de tipo
 *   dirección que se superponen sin ser el mismo tramo.
 *
 * Además, `compareWithBaseline` compara página por página contra otra corrida (la línea de base de M-D2).
 */

import {
  combineCoverage,
  coreParts,
  coverageOf,
  type Coverage,
  type KeywordPageRecord,
  type Range,
  type TouchingOccurrence,
} from "./addressKeywordClassify.js";
import type { KeywordScript } from "./addressKeywordSentences.js";

/** Las páginas con algo a la vista que ADR-217 espera: la ruta, en las tres escrituras, y la calle numerada sin altura. */
export const ADR217_EXPECTED_VISIBLE: ReadonlyArray<string> = [
  "K5-3/n",
  "K5-5/n",
  "K5-5/M",
  "K5-5/S",
];

/** Las trampas que ADR-217 espera tapadas, solo en las dos escrituras en mayúsculas. */
export const ADR217_EXPECTED_COVERED_TRAPS: ReadonlyArray<string> = [
  "K8-1",
  "K8-2",
  "K8-3",
  "K8-7",
  "K8-8",
  "K8-9",
];

const REGEX_SOURCE = "regex";

export interface ExpectedCount {
  readonly expected: number;
  readonly observed: number;
  readonly of: number;
  readonly matches: boolean;
}

export type MismatchKind =
  | "debia-cerrar-y-no-cerro"
  | "debia-quedar-a-la-vista-y-se-cerro"
  | "debia-taparse-y-no-se-tapo"
  | "no-debia-taparse-y-se-tapo";

export interface Mismatch {
  readonly id: string;
  readonly kind: MismatchKind;
  /** Lo que la aplicación hizo en la página, para leer sin abrir el registro. */
  readonly detail: string;
}

/** Quién cerró el núcleo de una página. */
export type ClosedBy = "regex" | "modelo" | "ambos" | "union";

export interface ClosedPage {
  readonly id: string;
  readonly script: KeywordScript;
  readonly closedBy: ClosedBy;
}

export interface OverlapPair {
  readonly first: { readonly value: string; readonly source: string };
  readonly second: { readonly value: string; readonly source: string };
  readonly relation: "igual" | "contenida" | "cruzada";
}

export interface DoublePaintedPage {
  readonly id: string;
  readonly pairs: ReadonlyArray<OverlapPair>;
}

export interface KeywordExpectationReport {
  /** Páginas de K1 a K7 con el núcleo no cubierto entero por ningún tipo. */
  readonly visible: ExpectedCount & { readonly pages: ReadonlyArray<string> };
  /** Lo mismo, contando solo las ocurrencias de tipo dirección (informativo). */
  readonly visibleAddressOnly: { readonly observed: number; readonly pages: ReadonlyArray<string> };
  /** Trampas tapadas en escritura normal. */
  readonly trapsNormal: ExpectedCount & { readonly pages: ReadonlyArray<string> };
  /** Trampas tapadas en las dos escrituras en mayúsculas. */
  readonly trapsUpper: ExpectedCount & { readonly pages: ReadonlyArray<string> };
  readonly mismatches: ReadonlyArray<Mismatch>;
  /** Páginas de K1 a K7 con el núcleo cubierto entero, y quién las cerró. */
  readonly closed: ReadonlyArray<ClosedPage>;
  readonly closedByCounts: Readonly<Record<ClosedBy, number>>;
  readonly doublePainted: ReadonlyArray<DoublePaintedPage>;
  /** Páginas inválidas (texto extraído distinto del escrito): no entran a nada de lo anterior. */
  readonly invalidPages: ReadonlyArray<string>;
  /** Todo el criterio se cumple: los tres números coinciden y no hay páginas que difieran de lo esperado. */
  readonly meetsCriterion: boolean;
}

function occurrenceRange(occurrence: TouchingOccurrence): Range {
  return { start: occurrence.start, end: occurrence.end };
}

function touchingOf(record: KeywordPageRecord): ReadonlyArray<TouchingOccurrence> {
  return [...record.addresses, ...record.others];
}

/** Cobertura del núcleo de una página por las ocurrencias que cumplen `keep`. */
function coreCoverage(
  record: KeywordPageRecord,
  keep: (occurrence: TouchingOccurrence) => boolean,
): Coverage {
  const ranges = touchingOf(record).filter(keep).map(occurrenceRange);
  return combineCoverage(
    coreParts(record).map((part) => coverageOf(ranges, record.pageText, part.start, part.end)),
  );
}

function describeOccurrences(record: KeywordPageRecord): string {
  const items = touchingOf(record);
  if (items.length === 0) return "nada";
  return items.map((o) => `"${o.value}" ${o.entityType} (${o.source})`).join("; ");
}

function relationOf(a: TouchingOccurrence, b: TouchingOccurrence): OverlapPair["relation"] {
  if (a.start === b.start && a.end === b.end) return "igual";
  const aInB = b.start <= a.start && a.end <= b.end;
  const bInA = a.start <= b.start && b.end <= a.end;
  return aInB || bInA ? "contenida" : "cruzada";
}

/** Los pares de ocurrencias de tipo dirección que se superponen (mismo tramo, contenida o cruzada). */
export function overlappingAddresses(record: KeywordPageRecord): ReadonlyArray<OverlapPair> {
  const pairs: OverlapPair[] = [];
  const addresses = record.addresses;
  for (let i = 0; i < addresses.length; i += 1) {
    for (let j = i + 1; j < addresses.length; j += 1) {
      const a = addresses[i];
      const b = addresses[j];
      if (a === undefined || b === undefined) continue;
      if (a.start < b.end && b.start < a.end) {
        pairs.push({
          first: { value: a.value, source: a.source },
          second: { value: b.value, source: b.source },
          relation: relationOf(a, b),
        });
      }
    }
  }
  return pairs;
}

function closedBy(record: KeywordPageRecord): ClosedBy {
  const regexFull = coreCoverage(record, (o) => o.source === REGEX_SOURCE) === "full";
  const modelFull = coreCoverage(record, (o) => o.source !== REGEX_SOURCE) === "full";
  if (regexFull && modelFull) return "ambos";
  if (regexFull) return "regex";
  if (modelFull) return "modelo";
  return "union";
}

function expectedCount(expected: number, observed: number, of: number): ExpectedCount {
  return { expected, observed, of, matches: expected === observed };
}

/** La corrida observó qué ocurrencias sobreviven al agrupado (alguna ocurrencia trae `survives`). */
export function hasSurvivalInfo(records: ReadonlyArray<KeywordPageRecord>): boolean {
  return records.some((record) =>
    [...record.addresses, ...record.others].some((o) => o.survives !== undefined),
  );
}

/**
 * Las mismas páginas sin las ocurrencias que el agrupador descartó: lo que queda y se pinta. Sobre ellas, las
 * coberturas son las de la tinta, y dos direcciones superpuestas son dos direcciones pintadas.
 */
export function survivorsOnly(
  records: ReadonlyArray<KeywordPageRecord>,
): ReadonlyArray<KeywordPageRecord> {
  return records.map((record) => ({
    ...record,
    addresses: record.addresses.filter((o) => o.survives !== false),
    others: record.others.filter((o) => o.survives !== false),
  }));
}

/** Compara las páginas de una corrida contra el criterio de ADR-217. */
export function evaluateAdr217(
  records: ReadonlyArray<KeywordPageRecord>,
): KeywordExpectationReport {
  const valid = records.filter((record) => record.valid);
  const keyword = valid.filter((record) => record.category !== "K8");
  const traps = valid.filter((record) => record.category === "K8");
  const mismatches: Mismatch[] = [];

  const visible: string[] = [];
  const visibleAddressOnly: string[] = [];
  const closed: ClosedPage[] = [];
  for (const record of keyword) {
    const isVisible = coreCoverage(record, () => true) !== "full";
    if (isVisible) visible.push(record.id);
    if (coreCoverage(record, (o) => o.entityType === "ADDRESS") !== "full")
      visibleAddressOnly.push(record.id);
    if (!isVisible)
      closed.push({ id: record.id, script: record.script, closedBy: closedBy(record) });
    const expectedVisible = ADR217_EXPECTED_VISIBLE.includes(record.id);
    if (expectedVisible && !isVisible)
      mismatches.push({
        id: record.id,
        kind: "debia-quedar-a-la-vista-y-se-cerro",
        detail: describeOccurrences(record),
      });
    if (!expectedVisible && isVisible)
      mismatches.push({
        id: record.id,
        kind: "debia-cerrar-y-no-cerro",
        detail: describeOccurrences(record),
      });
  }

  const covered = (record: KeywordPageRecord): boolean => touchingOf(record).length > 0;
  const trapsNormal = traps.filter((record) => record.script === "n" && covered(record));
  const trapsUpper = traps.filter((record) => record.script !== "n" && covered(record));
  for (const record of traps) {
    const expectedCovered =
      record.script !== "n" && ADR217_EXPECTED_COVERED_TRAPS.includes(record.baseId);
    if (expectedCovered && !covered(record))
      mismatches.push({ id: record.id, kind: "debia-taparse-y-no-se-tapo", detail: "nada" });
    if (!expectedCovered && covered(record))
      mismatches.push({
        id: record.id,
        kind: "no-debia-taparse-y-se-tapo",
        detail: describeOccurrences(record),
      });
  }

  const visibleReport = {
    ...expectedCount(ADR217_EXPECTED_VISIBLE.length, visible.length, keyword.length),
    pages: visible,
  };
  const normalReport = {
    ...expectedCount(0, trapsNormal.length, traps.filter((r) => r.script === "n").length),
    pages: trapsNormal.map((r) => r.id),
  };
  const upperReport = {
    ...expectedCount(
      ADR217_EXPECTED_COVERED_TRAPS.length * 2,
      trapsUpper.length,
      traps.filter((r) => r.script !== "n").length,
    ),
    pages: trapsUpper.map((r) => r.id),
  };
  const closedByCounts: Record<ClosedBy, number> = { regex: 0, modelo: 0, ambos: 0, union: 0 };
  for (const page of closed) closedByCounts[page.closedBy] += 1;
  const doublePainted = valid.flatMap((record): DoublePaintedPage[] => {
    const pairs = overlappingAddresses(record);
    return pairs.length === 0 ? [] : [{ id: record.id, pairs }];
  });

  return {
    visible: visibleReport,
    visibleAddressOnly: { observed: visibleAddressOnly.length, pages: visibleAddressOnly },
    trapsNormal: normalReport,
    trapsUpper: upperReport,
    mismatches,
    closed,
    closedByCounts,
    doublePainted,
    invalidPages: records.filter((record) => !record.valid).map((record) => record.id),
    meetsCriterion:
      visibleReport.matches &&
      normalReport.matches &&
      upperReport.matches &&
      mismatches.length === 0,
  };
}

export interface PageChange {
  readonly id: string;
  readonly before: string;
  readonly after: string;
}

export interface BaselineComparison {
  readonly pages: number;
  /** K1 a K7: el núcleo queda más cubierto que en la línea de base. */
  readonly improved: ReadonlyArray<PageChange>;
  /** K1 a K7: el núcleo queda menos cubierto (una entidad que estaba cubierta y ya no lo está). */
  readonly worse: ReadonlyArray<PageChange>;
  /** K8: una trampa que no se tapaba y ahora se tapa (un costo, no una ganancia). */
  readonly trapsNewlyCovered: ReadonlyArray<PageChange>;
  /** K8: una trampa que se tapaba y ya no. */
  readonly trapsNoLongerCovered: ReadonlyArray<PageChange>;
  readonly same: number;
  /** Páginas que no están en las dos corridas o que son inválidas en alguna. */
  readonly notComparable: ReadonlyArray<string>;
}

const RANK: Readonly<Record<Coverage, number>> = { none: 0, partial: 1, full: 2 };

/**
 * Compara página por página contra otra corrida (la línea de base de M-D2). En K1 a K7 una página mejora si
 * su núcleo queda más cubierto (por cualquier tipo) y empeora si queda menos. En K8 se lista aparte lo que
 * antes no se tapaba y ahora sí, y al revés.
 */
export function compareWithBaseline(
  current: ReadonlyArray<KeywordPageRecord>,
  baseline: ReadonlyArray<KeywordPageRecord>,
): BaselineComparison {
  const baselineById = new Map(baseline.map((record) => [record.id, record]));
  const improved: PageChange[] = [];
  const worse: PageChange[] = [];
  const trapsNewlyCovered: PageChange[] = [];
  const trapsNoLongerCovered: PageChange[] = [];
  const notComparable: string[] = [];
  let same = 0;
  for (const record of current) {
    const before = baselineById.get(record.id);
    if (before === undefined || !before.valid || !record.valid) {
      notComparable.push(record.id);
      continue;
    }
    if (record.category === "K8") {
      const was = touchingOf(before).length > 0;
      const is = touchingOf(record).length > 0;
      if (was === is) same += 1;
      else
        (is ? trapsNewlyCovered : trapsNoLongerCovered).push({
          id: record.id,
          before: describeOccurrences(before),
          after: describeOccurrences(record),
        });
      continue;
    }
    const a = coreCoverage(before, () => true);
    const b = coreCoverage(record, () => true);
    if (a === b) {
      same += 1;
      continue;
    }
    (RANK[b] > RANK[a] ? improved : worse).push({
      id: record.id,
      before: `núcleo ${a}`,
      after: `núcleo ${b}`,
    });
  }
  return {
    pages: current.length,
    improved,
    worse,
    trapsNewlyCovered,
    trapsNoLongerCovered,
    same,
    notComparable,
  };
}
