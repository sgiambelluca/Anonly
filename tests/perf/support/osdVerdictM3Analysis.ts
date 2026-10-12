/**
 * M-O3: las cuentas sobre las corridas ya medidas, sin volver a correr nada. Puras. Cuatro análisis:
 *
 * 1. **Memoria** (`analyzeMemory`): pico M2 máximo y mediano, en frío y en caliente, por documento y brazo; la
 *    diferencia B − A y C − A (y A − A0, el efecto del observador) contra el ruido de M2 (~345 MB) mirando los
 *    rangos de las repeticiones, no solo la mediana; y P2 contra el techo de 3,0 GB.
 * 2. **Tiempo** (`analyzeTime`): hasta `Ready`, por brazo, factor contra A y segundos por página.
 * 3. **Reconocimientos** (`analyzeRecognitions`): cuántas páginas hicieron las cuatro lecturas, y por qué las
 *    que no.
 * 4. **Entregas** (`analyzeDeliveries`): de A a B y de A a C, cuántas páginas cambian el hash del texto, la
 *    cantidad de palabras, el ángulo entregado, las entidades por tipo o el aviso, y en qué sentido; y el piso:
 *    cuántas cambian entre dos repeticiones del mismo brazo A.
 */

import {
  M2_NOISE_BYTES,
  M3_CELLS,
  P2_CEILING_BYTES,
  m3PageId,
  type M3Arm,
  type M3Doc,
  type M3Run,
  type M3RunSide,
} from "./osdVerdictM3.js";
import type { PageSnapshot } from "./osdVerdictM3Collector.js";

export type Temperature = "cold" | "hot";
const TEMPERATURES: ReadonlyArray<Temperature> = ["cold", "hot"];
const DOCS: ReadonlyArray<M3Doc> = ["R1", "R4", "P2", "P2N"];

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  const lower = sorted[mid - 1] ?? upper;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
}

export interface Spread {
  readonly values: ReadonlyArray<number>;
  readonly min: number | null;
  readonly median: number | null;
  readonly max: number | null;
}

export function spreadOf(values: ReadonlyArray<number>): Spread {
  return {
    values,
    min: values.length === 0 ? null : Math.min(...values),
    median: median(values),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

const sideOf = (run: M3Run, temperature: Temperature): M3RunSide =>
  temperature === "cold" ? run.cold : run.hot;

function runsOf(runs: ReadonlyArray<M3Run>, doc: M3Doc, arm: M3Arm): M3Run[] {
  return runs.filter((run) => run.doc === doc && run.arm === arm).sort((a, b) => a.rep - b.rep);
}

// ------------------------------------------------------------------ memoria

export interface MemoryCell {
  readonly doc: M3Doc;
  readonly arm: M3Arm;
  readonly runs: number;
  /** Corridas en las que la importación terminó en `PIPELINE_FAILED` (un resultado, no un descarte). */
  readonly failedRuns: number;
  readonly cold: Spread;
  readonly hot: Spread;
}

export type NoiseVerdict = "se distingue del ruido" | "dentro del ruido" | "ambiguo";

export interface MemoryDiff {
  readonly doc: M3Doc;
  /** El brazo medido y contra cuál se compara: `B − A`, `C − A` o `A − A0` (el efecto del observador). */
  readonly arm: M3Arm;
  readonly versus: M3Arm;
  readonly temperature: Temperature;
  readonly medianDiffBytes: number | null;
  readonly maxDiffBytes: number | null;
  /** Los rangos de las repeticiones no se pisan. */
  readonly rangesDisjoint: boolean | null;
  readonly verdict: NoiseVerdict | null;
}

export interface CeilingRow {
  readonly doc: M3Doc;
  readonly arm: M3Arm;
  readonly temperature: Temperature;
  readonly maxBytes: number | null;
  readonly ceilingBytes: number;
  /** `techo − máximo`; negativo si lo supera. */
  readonly marginBytes: number | null;
  readonly exceeds: boolean | null;
}

export interface MemoryResult {
  readonly cells: ReadonlyArray<MemoryCell>;
  readonly diffs: ReadonlyArray<MemoryDiff>;
  readonly ceiling: ReadonlyArray<CeilingRow>;
}

function peaks(runs: ReadonlyArray<M3Run>, temperature: Temperature): number[] {
  return runs.flatMap((run) => {
    const side = sideOf(run, temperature);
    return side.ok && side.peakSumBytes !== null ? [side.peakSumBytes] : [];
  });
}

/**
 * Una diferencia de picos se distingue del ruido de M2 si la diferencia de medianas supera el ruido Y los
 * rangos de las repeticiones no se pisan. Dentro del ruido: la diferencia de medianas es menor. Entre los dos:
 * ambiguo.
 */
export function classifyAgainstNoise(
  a: Spread,
  b: Spread,
  noiseBytes = M2_NOISE_BYTES,
): { diff: number; disjoint: boolean; verdict: NoiseVerdict } | null {
  if (a.median === null || b.median === null || a.min === null || a.max === null) return null;
  if (b.min === null || b.max === null) return null;
  const diff = b.median - a.median;
  const disjoint = b.min > a.max || b.max < a.min;
  const verdict: NoiseVerdict =
    Math.abs(diff) < noiseBytes
      ? "dentro del ruido"
      : disjoint
        ? "se distingue del ruido"
        : "ambiguo";
  return { diff, disjoint, verdict };
}

export function analyzeMemory(runs: ReadonlyArray<M3Run>): MemoryResult {
  const cells: MemoryCell[] = M3_CELLS.map(({ doc, arm }) => {
    const list = runsOf(runs, doc, arm);
    return {
      doc,
      arm,
      runs: list.length,
      failedRuns: list.filter((run) => !run.cold.ok || !run.hot.ok).length,
      cold: spreadOf(peaks(list, "cold")),
      hot: spreadOf(peaks(list, "hot")),
    };
  }).filter((cell) => cell.runs > 0);
  const cell = (doc: M3Doc, arm: M3Arm): MemoryCell | undefined =>
    cells.find((candidate) => candidate.doc === doc && candidate.arm === arm);

  const diffs: MemoryDiff[] = [];
  const pairs: ReadonlyArray<readonly [M3Arm, M3Arm]> = [
    ["B", "A"],
    ["C", "A"],
    ["A", "A0"],
  ];
  for (const doc of DOCS)
    for (const [arm, versus] of pairs) {
      const left = cell(doc, arm);
      const right = cell(doc, versus);
      if (left === undefined || right === undefined) continue;
      for (const temperature of TEMPERATURES) {
        const a = temperature === "cold" ? right.cold : right.hot;
        const b = temperature === "cold" ? left.cold : left.hot;
        const result = classifyAgainstNoise(a, b);
        diffs.push({
          doc,
          arm,
          versus,
          temperature,
          medianDiffBytes: result?.diff ?? null,
          maxDiffBytes: a.max === null || b.max === null ? null : b.max - a.max,
          rangesDisjoint: result?.disjoint ?? null,
          verdict: result?.verdict ?? null,
        });
      }
    }

  const ceiling: CeilingRow[] = [];
  for (const entry of cells)
    if (entry.doc === "P2" || entry.doc === "P2N")
      for (const temperature of TEMPERATURES) {
        const max = (temperature === "cold" ? entry.cold : entry.hot).max;
        ceiling.push({
          doc: entry.doc,
          arm: entry.arm,
          temperature,
          maxBytes: max,
          ceilingBytes: P2_CEILING_BYTES,
          marginBytes: max === null ? null : P2_CEILING_BYTES - max,
          exceeds: max === null ? null : max > P2_CEILING_BYTES,
        });
      }
  return { cells, diffs, ceiling };
}

// ------------------------------------------------------------------ tiempo

export interface TimeRow {
  readonly doc: M3Doc;
  readonly arm: M3Arm;
  readonly pages: number;
  readonly cold: Spread;
  readonly hot: Spread;
  /** Mediana de los segundos por página (hasta `Ready`). */
  readonly coldSecondsPerPage: number | null;
  readonly hotSecondsPerPage: number | null;
  /** Mediana de `arm` sobre mediana de `A` (null si no hay A, o este es A). */
  readonly coldFactorVsA: number | null;
  readonly hotFactorVsA: number | null;
  /** Total de reconocimientos por corrida (mediana), en frío. */
  readonly recognitionsPerRunCold: number | null;
}

function readyTimes(runs: ReadonlyArray<M3Run>, temperature: Temperature): number[] {
  return runs.flatMap((run) => {
    const side = sideOf(run, temperature);
    return side.ok && side.readyDurationMs !== null ? [side.readyDurationMs] : [];
  });
}

export function analyzeTime(runs: ReadonlyArray<M3Run>): ReadonlyArray<TimeRow> {
  const rows: TimeRow[] = [];
  for (const { doc, arm } of M3_CELLS) {
    const list = runsOf(runs, doc, arm);
    if (list.length === 0) continue;
    const pages = list[0]?.pageCount ?? 0;
    const cold = spreadOf(readyTimes(list, "cold"));
    const hot = spreadOf(readyTimes(list, "hot"));
    const baseline = runsOf(runs, doc, "A");
    const coldBase = median(readyTimes(baseline, "cold"));
    const hotBase = median(readyTimes(baseline, "hot"));
    const factor = (value: number | null, base: number | null) =>
      arm === "A" || value === null || base === null || base === 0 ? null : value / base;
    rows.push({
      doc,
      arm,
      pages,
      cold,
      hot,
      coldSecondsPerPage: cold.median === null || pages === 0 ? null : cold.median / 1000 / pages,
      hotSecondsPerPage: hot.median === null || pages === 0 ? null : hot.median / 1000 / pages,
      coldFactorVsA: factor(cold.median, coldBase),
      hotFactorVsA: factor(hot.median, hotBase),
      recognitionsPerRunCold: median(
        list.filter((run) => run.cold.ok).map((run) => run.cold.ocrPageDispatches),
      ),
    });
  }
  return rows;
}

// ------------------------------------------------------------------ reconocimientos

const FOUR_ANGLES = [0, 90, 180, 270];

/** Ángulos distintos leídos en una página, sin contar el reintento agrandado. */
export function anglesRead(page: PageSnapshot): number[] {
  return [
    ...new Set(
      page.attempts.flatMap((attempt) =>
        attempt.upscale === 1 && attempt.angle !== null ? [attempt.angle] : [],
      ),
    ),
  ].sort((a, b) => a - b);
}

export function hasFourReadings(page: PageSnapshot): boolean {
  const read = anglesRead(page);
  return FOUR_ANGLES.every((angle) => read.includes(angle));
}

/** Por qué una página no hizo las cuatro lecturas. */
export function notFourReason(page: PageSnapshot): string {
  const first = page.attempts[0];
  const ink = page.orientation?.inkRatio ?? null;
  if (page.orientation?.osdHadVerdict !== false) return "el veredicto sigue presente";
  if (first !== undefined && first.reliableWordCount === 0 && ink !== null && ink < 0.002)
    return "sin palabra confiable y tinta debajo del umbral";
  return "otra";
}

export interface RecognitionRow {
  readonly doc: M3Doc;
  readonly arm: M3Arm;
  readonly runs: number;
  readonly pagesPerRun: number;
  /** Páginas con las cuatro lecturas, por corrida (la mediana de las corridas, en frío). */
  readonly pagesWithFour: number | null;
  /** Reconocimientos por página: cuántas páginas hicieron 1, 2, 3… (corrida en frío, la primera). */
  readonly histogram: Readonly<Record<string, number>>;
  /** Páginas (ids neutros) que en alguna corrida no hicieron las cuatro lecturas, con el motivo. */
  readonly withoutFour: ReadonlyArray<{ readonly page: string; readonly reason: string }>;
}

export function analyzeRecognitions(runs: ReadonlyArray<M3Run>): ReadonlyArray<RecognitionRow> {
  const rows: RecognitionRow[] = [];
  for (const { doc, arm } of M3_CELLS) {
    const list = runsOf(runs, doc, arm).filter((run) => run.cold.ok && run.cold.observer);
    if (list.length === 0) continue;
    const counts = list.map((run) => run.cold.pages.filter(hasFourReadings).length);
    const histogram: Record<string, number> = {};
    for (const page of list[0]?.cold.pages ?? [])
      histogram[String(page.attempts.length)] = (histogram[String(page.attempts.length)] ?? 0) + 1;
    const without = new Map<string, string>();
    for (const run of list)
      for (const page of run.cold.pages)
        if (!hasFourReadings(page)) without.set(m3PageId(doc, page.pageIndex), notFourReason(page));
    rows.push({
      doc,
      arm,
      runs: list.length,
      pagesPerRun: list[0]?.pageCount ?? 0,
      pagesWithFour: median(counts),
      histogram,
      withoutFour: [...without].map(([page, reason]) => ({ page, reason })),
    });
  }
  return rows;
}

// ------------------------------------------------------------------ entregas

/** El ángulo de la lectura que entregó la cadena: el del reconocimiento cuya lectura coincide con la entregada. */
export function deliveredAngle(page: PageSnapshot): number | null {
  const key = page.delivered?.key;
  if (key === undefined) return null;
  return page.attempts.find((attempt) => attempt.key === key)?.angle ?? null;
}

const entityTotal = (page: PageSnapshot): number =>
  Object.values(page.entityCounts).reduce((sum, count) => sum + count, 0);

const sameEntities = (a: PageSnapshot, b: PageSnapshot): boolean => {
  const types = new Set([...Object.keys(a.entityCounts), ...Object.keys(b.entityCounts)]);
  return [...types].every((type) => (a.entityCounts[type] ?? 0) === (b.entityCounts[type] ?? 0));
};

export interface PageChange {
  readonly page: string;
  readonly textHash: boolean;
  readonly words: boolean;
  readonly angle: boolean;
  readonly entities: boolean;
  readonly warning: boolean;
  readonly wordsDelta: number;
  readonly entitiesDelta: number;
  /** +1 si la segunda corrida avisa y la primera no; −1 al revés. */
  readonly warningDelta: -1 | 0 | 1;
  readonly any: boolean;
}

export interface PairComparison {
  readonly pages: number;
  readonly changed: PageChange[];
  readonly counts: {
    readonly textHash: number;
    readonly words: number;
    readonly angle: number;
    readonly entities: number;
    readonly warning: number;
    readonly any: number;
  };
  readonly direction: {
    readonly moreWords: number;
    readonly fewerWords: number;
    readonly moreEntities: number;
    readonly fewerEntities: number;
    readonly warningGained: number;
    readonly warningLost: number;
  };
}

/** Compara página por página lo que entregaron dos corridas (la primera es la base). */
export function comparePages(
  doc: M3Doc,
  base: ReadonlyArray<PageSnapshot>,
  other: ReadonlyArray<PageSnapshot>,
): PairComparison {
  const changed: PageChange[] = [];
  const counts = { textHash: 0, words: 0, angle: 0, entities: 0, warning: 0, any: 0 };
  const direction = {
    moreWords: 0,
    fewerWords: 0,
    moreEntities: 0,
    fewerEntities: 0,
    warningGained: 0,
    warningLost: 0,
  };
  const size = Math.min(base.length, other.length);
  for (let index = 0; index < size; index += 1) {
    const a = base[index];
    const b = other[index];
    if (a === undefined || b === undefined) continue;
    const wordsDelta = (b.delivered?.wordCount ?? 0) - (a.delivered?.wordCount ?? 0);
    const entitiesDelta = entityTotal(b) - entityTotal(a);
    const warningDelta = (b.unreadableInk ? 1 : 0) - (a.unreadableInk ? 1 : 0);
    const change: PageChange = {
      page: m3PageId(doc, a.pageIndex),
      textHash: a.delivered?.textSha256 !== b.delivered?.textSha256,
      words: wordsDelta !== 0,
      angle: deliveredAngle(a) !== deliveredAngle(b),
      entities: !sameEntities(a, b),
      warning: warningDelta !== 0,
      wordsDelta,
      entitiesDelta,
      warningDelta: warningDelta as -1 | 0 | 1,
      any: false,
    };
    const any =
      change.textHash || change.words || change.angle || change.entities || change.warning;
    if (change.textHash) counts.textHash += 1;
    if (change.words) counts.words += 1;
    if (change.angle) counts.angle += 1;
    if (change.entities) counts.entities += 1;
    if (change.warning) counts.warning += 1;
    if (wordsDelta > 0) direction.moreWords += 1;
    if (wordsDelta < 0) direction.fewerWords += 1;
    if (entitiesDelta > 0) direction.moreEntities += 1;
    if (entitiesDelta < 0) direction.fewerEntities += 1;
    if (warningDelta > 0) direction.warningGained += 1;
    if (warningDelta < 0) direction.warningLost += 1;
    if (any) {
      counts.any += 1;
      changed.push({ ...change, any: true });
    }
  }
  return { pages: size, changed, counts, direction };
}

export interface DeliveryResult {
  readonly doc: M3Doc;
  readonly versus: M3Arm;
  readonly temperature: Temperature;
  /** Una comparación por repetición: `A rep k` contra `versus rep k`. */
  readonly pairs: ReadonlyArray<PairComparison>;
  /** El piso: `A rep i` contra `A rep j`, para cada par de repeticiones. */
  readonly floor: ReadonlyArray<PairComparison>;
  /** Páginas que cambian en todos los pares contra A y en ningún par del piso. */
  readonly beyondFloor: ReadonlyArray<PageChange>;
}

function side(run: M3Run, temperature: Temperature): ReadonlyArray<PageSnapshot> {
  return sideOf(run, temperature).pages;
}

export function analyzeDeliveries(
  runs: ReadonlyArray<M3Run>,
  temperature: Temperature = "cold",
): ReadonlyArray<DeliveryResult> {
  const results: DeliveryResult[] = [];
  for (const doc of DOCS) {
    const baseRuns = runsOf(runs, doc, "A").filter((run) => sideOf(run, temperature).ok);
    if (baseRuns.length === 0) continue;
    const floor: PairComparison[] = [];
    for (let i = 0; i < baseRuns.length; i += 1)
      for (let j = i + 1; j < baseRuns.length; j += 1) {
        const a = baseRuns[i];
        const b = baseRuns[j];
        if (a !== undefined && b !== undefined)
          floor.push(comparePages(doc, side(a, temperature), side(b, temperature)));
      }
    for (const versus of ["B", "C"] as const) {
      const others = runsOf(runs, doc, versus).filter((run) => sideOf(run, temperature).ok);
      if (others.length === 0) continue;
      const pairs: PairComparison[] = [];
      for (const other of others) {
        const base = baseRuns.find((run) => run.rep === other.rep) ?? baseRuns[0];
        if (base !== undefined)
          pairs.push(comparePages(doc, side(base, temperature), side(other, temperature)));
      }
      const inAll = pairs[0]?.changed.filter((change) =>
        pairs.every((pair) => pair.changed.some((c) => c.page === change.page)),
      );
      const beyondFloor = (inAll ?? []).filter(
        (change) => !floor.some((pair) => pair.changed.some((c) => c.page === change.page)),
      );
      results.push({ doc, versus, temperature, pairs, floor, beyondFloor });
    }
  }
  return results;
}

export interface M3Summary {
  readonly memory: MemoryResult;
  readonly time: ReadonlyArray<TimeRow>;
  readonly recognitions: ReadonlyArray<RecognitionRow>;
  readonly deliveries: ReadonlyArray<DeliveryResult>;
  readonly deliveriesHot: ReadonlyArray<DeliveryResult>;
}

export function summarizeRuns(runs: ReadonlyArray<M3Run>): M3Summary {
  return {
    memory: analyzeMemory(runs),
    time: analyzeTime(runs),
    recognitions: analyzeRecognitions(runs),
    deliveries: analyzeDeliveries(runs, "cold"),
    deliveriesHot: analyzeDeliveries(runs, "hot"),
  };
}
