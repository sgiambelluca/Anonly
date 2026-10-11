/**
 * M-O1: las cuentas sobre las observaciones, sin volver a correr nada. Puras. Cada pregunta del plan es una
 * función: `q1WrongVerdicts`, `q2ForcedOutcomes`, `q3Signals`, `q3bisComparators` y `q4Time`.
 *
 * Convenciones:
 *
 * - Un PDF es una `PdfGroup`: su observación de producción y las cuatro de veredicto forzado. Los controles
 *   sin texto (blanco, ruido, figuras) no tienen ángulo correcto que leer: quedan fuera de las preguntas y
 *   se informan aparte.
 * - «Ángulo correcto» es el de corrección que el OSD debería afirmar (`correctAngle`); el giro físico del
 *   escaneo es otro número (`(360 − correcto) mod 360`).
 * - La «primera lectura» de un PDF en un ángulo es el primer reconocimiento de su observación forzada a ese
 *   ángulo: mismo ráster, mismo DPI, el reconocimiento que haría el producto si el OSD afirmara ese ángulo.
 *   Su tiempo incluye el arranque en frío de la instancia de Electron que la midió.
 */

import { PHYSICAL_ANGLES, hasText, isDense, type PhysicalAngle } from "./osdVerdictCorpus.js";
import { type ObservationRecord } from "./osdVerdictRun.js";

export interface PdfGroup {
  readonly key: string;
  readonly production: ObservationRecord | null;
  readonly forced: ReadonlyMap<PhysicalAngle, ObservationRecord>;
  /** Cualquier observación del PDF, para sus datos fijos. */
  readonly any: ObservationRecord;
}

export function groupByPdf(observations: ReadonlyArray<ObservationRecord>): PdfGroup[] {
  const byKey = new Map<string, ObservationRecord[]>();
  for (const observation of observations) {
    const list = byKey.get(observation.key) ?? [];
    list.push(observation);
    byKey.set(observation.key, list);
  }
  const groups: PdfGroup[] = [];
  for (const [key, list] of byKey) {
    const any = list[0];
    if (any === undefined) continue;
    const forced = new Map<PhysicalAngle, ObservationRecord>();
    for (const observation of list)
      if (observation.forcedAngle !== null) forced.set(observation.forcedAngle, observation);
    groups.push({
      key,
      production: list.find((observation) => observation.forcedAngle === null) ?? null,
      forced,
      any,
    });
  }
  return groups;
}

/** Con texto y con las cuatro observaciones forzadas: las que entran a las preguntas 2 a 4. */
function forcedComplete(group: PdfGroup): boolean {
  return hasText(group.any) && PHYSICAL_ANGLES.every((angle) => group.forced.has(angle));
}

/** Los conjuntos a los que pertenece un PDF, para separar el control denso del resto. */
export function subsetsOf(item: Pick<ObservationRecord, "set" | "label">): string[] {
  if (isDense(item)) return ["dense", `label:${item.label}`];
  return ["sparse", item.set === "sparse" ? "new-sparse" : "old-sparse", `label:${item.label}`];
}

function bump<T>(table: Record<string, T>, key: string, init: () => T, update: (cell: T) => void) {
  const cell = table[key] ?? init();
  update(cell);
  table[key] = cell;
}

// ------------------------------------------------------------------ pregunta 1

export interface VerdictCounts {
  pdfs: number;
  withVerdict: number;
  correct: number;
  wrong: number;
  noVerdict: number;
}

export interface WrongVerdict {
  readonly key: string;
  readonly verdict: number | null;
  readonly correctAngle: number;
  readonly rawOrientation: number | null;
  readonly rawConfidence: number | null;
  readonly inkRatio: number | null;
}

export interface Q1Result {
  readonly total: VerdictCounts;
  readonly bySet: Record<string, VerdictCounts>;
  readonly byLabel: Record<string, VerdictCounts>;
  readonly byDpi: Record<string, VerdictCounts>;
  /** Por giro físico del escaneo. */
  readonly byRotation: Record<string, VerdictCounts>;
  readonly wrong: ReadonlyArray<WrongVerdict>;
}

const emptyVerdictCounts = (): VerdictCounts => ({
  pdfs: 0,
  withVerdict: 0,
  correct: 0,
  wrong: 0,
  noVerdict: 0,
});

/** Veredicto natural equivocado: el OSD afirmó un ángulo (`osdHadVerdict`) y no es el correcto. */
export function q1WrongVerdicts(groups: ReadonlyArray<PdfGroup>): Q1Result {
  const total = emptyVerdictCounts();
  const bySet: Record<string, VerdictCounts> = {};
  const byLabel: Record<string, VerdictCounts> = {};
  const byDpi: Record<string, VerdictCounts> = {};
  const byRotation: Record<string, VerdictCounts> = {};
  const wrong: WrongVerdict[] = [];
  for (const group of groups) {
    const production = group.production;
    if (production === null || !hasText(production)) continue;
    const verdict = production.delivered;
    const present = verdict.osdHadVerdict === true;
    const isWrong = present && verdict.orientation !== production.correctAngle;
    const add = (cell: VerdictCounts) => {
      cell.pdfs += 1;
      if (present) cell.withVerdict += 1;
      else cell.noVerdict += 1;
      if (present && !isWrong) cell.correct += 1;
      if (isWrong) cell.wrong += 1;
    };
    add(total);
    bump(bySet, production.set, emptyVerdictCounts, add);
    bump(byLabel, production.label, emptyVerdictCounts, add);
    bump(byDpi, String(production.sourceDpi), emptyVerdictCounts, add);
    bump(byRotation, String(production.physicalRotation), emptyVerdictCounts, add);
    if (isWrong)
      wrong.push({
        key: production.key,
        verdict: verdict.orientation,
        correctAngle: production.correctAngle,
        rawOrientation: production.rawOsd.orientation,
        rawConfidence: production.rawOsd.confidence,
        inkRatio: verdict.inkRatio,
      });
  }
  return { total, bySet, byLabel, byDpi, byRotation, wrong };
}

// ------------------------------------------------------------------ pregunta 2

/**
 * Qué entrega el producto cuando el OSD afirma un ángulo equivocado:
 *
 * - `recovered`: los datos esperados están (los tokens y el DNI como entidad), con o sin aviso;
 * - `warned`: no están y la página sale con `unreadableInk`;
 * - `silent-leak`: no están y no hay aviso. El archivo se exporta sin tapar y sin avisar.
 */
export type Outcome = "recovered" | "warned" | "silent-leak";

export function classifyOutcome(observation: ObservationRecord): Outcome {
  if (observation.final.expectedDataPresent === true) return "recovered";
  return observation.final.unreadableInk ? "warned" : "silent-leak";
}

export interface OutcomeCounts {
  observations: number;
  recovered: number;
  warned: number;
  silentLeak: number;
  /** De las fugas, las que igual tienen el DNI como entidad (lectura incompleta, DNI tapable). */
  silentLeakWithDniEntity: number;
}

const emptyOutcomeCounts = (): OutcomeCounts => ({
  observations: 0,
  recovered: 0,
  warned: 0,
  silentLeak: 0,
  silentLeakWithDniEntity: 0,
});

export interface LeakCase {
  readonly key: string;
  readonly label: string;
  readonly sourceDpi: number;
  readonly physicalRotation: number;
  readonly correctAngle: number;
  /** `null` en una observación de producción. */
  readonly forcedAngle: number | null;
  readonly outcome: Outcome;
  readonly dniEntity: boolean | null;
  readonly attemptedAngles: ReadonlyArray<number | null>;
  readonly finalText: string;
  readonly finalPageConfidence: number | null;
  readonly finalReliableWords: number;
  readonly firstReadingReliableWords: number;
  readonly firstReadingPageConfidence: number | null;
}

export interface Q2Result {
  readonly total: OutcomeCounts;
  readonly bySet: Record<string, OutcomeCounts>;
  readonly byLabel: Record<string, OutcomeCounts>;
  readonly byDpi: Record<string, OutcomeCounts>;
  readonly byRotation: Record<string, OutcomeCounts>;
  /** Cuánto se aparta el ángulo forzado del correcto: 90, 180 o 270. */
  readonly byOffset: Record<string, OutcomeCounts>;
  /** PDF con al menos una fuga entre sus tres ángulos equivocados, por conjunto y por etiqueta. */
  readonly pdfsWithLeak: {
    readonly withLeak: number;
    readonly pdfs: number;
    readonly byLabel: Record<string, { pdfs: number; withLeak: number }>;
  };
  /** El mismo conteo con el ángulo forzado al correcto: tiene que dar los datos en casi todos. */
  readonly forcedCorrect: OutcomeCounts;
  /** Las del control que no recuperaron los datos: el producto falla aun con el ángulo bien afirmado. */
  readonly forcedCorrectNotRecovered: ReadonlyArray<LeakCase>;
  readonly leaks: ReadonlyArray<LeakCase>;
  readonly nonRecovered: ReadonlyArray<LeakCase>;
}

export function wrapAround(angle: number, correct: number): number {
  return (((angle - correct) % 360) + 360) % 360;
}

function countOutcome(cell: OutcomeCounts, observation: ObservationRecord): void {
  const outcome = classifyOutcome(observation);
  cell.observations += 1;
  if (outcome === "recovered") cell.recovered += 1;
  else if (outcome === "warned") cell.warned += 1;
  else {
    cell.silentLeak += 1;
    if (observation.final.dniEntity === true) cell.silentLeakWithDniEntity += 1;
  }
}

function leakCase(observation: ObservationRecord): LeakCase {
  const first = observation.attempts[0];
  return {
    key: observation.key,
    label: observation.label,
    sourceDpi: observation.sourceDpi,
    physicalRotation: observation.physicalRotation,
    correctAngle: observation.correctAngle,
    forcedAngle: observation.forcedAngle,
    outcome: classifyOutcome(observation),
    dniEntity: observation.final.dniEntity,
    attemptedAngles: observation.attempts.map((attempt) => attempt.dispatchedOrientation),
    finalText: observation.final.words.map((word) => word.text).join(" "),
    finalPageConfidence: observation.final.pageConfidence,
    finalReliableWords: observation.final.reliableWordCount,
    firstReadingReliableWords: first?.reliableWordCount ?? 0,
    firstReadingPageConfidence: first?.pageConfidence ?? null,
  };
}

export function q2ForcedOutcomes(groups: ReadonlyArray<PdfGroup>): Q2Result {
  const total = emptyOutcomeCounts();
  const bySet: Record<string, OutcomeCounts> = {};
  const byLabel: Record<string, OutcomeCounts> = {};
  const byDpi: Record<string, OutcomeCounts> = {};
  const byRotation: Record<string, OutcomeCounts> = {};
  const byOffset: Record<string, OutcomeCounts> = {};
  const forcedCorrect = emptyOutcomeCounts();
  const pdfLabels: Record<string, { pdfs: number; withLeak: number }> = {};
  const leaks: LeakCase[] = [];
  const nonRecovered: LeakCase[] = [];
  let pdfs = 0;
  let pdfsWithLeak = 0;
  const forcedCorrectNotRecovered: LeakCase[] = [];
  const addTo = (observation: ObservationRecord) => (cell: OutcomeCounts) =>
    countOutcome(cell, observation);
  for (const group of groups) {
    if (!forcedComplete(group)) continue;
    let leakInPdf = false;
    for (const [angle, observation] of group.forced) {
      if (angle === observation.correctAngle) {
        addTo(observation)(forcedCorrect);
        if (classifyOutcome(observation) !== "recovered")
          forcedCorrectNotRecovered.push(leakCase(observation));
        continue;
      }
      const add = addTo(observation);
      add(total);
      bump(bySet, observation.set, emptyOutcomeCounts, add);
      bump(byLabel, observation.label, emptyOutcomeCounts, add);
      bump(byDpi, String(observation.sourceDpi), emptyOutcomeCounts, add);
      bump(byRotation, String(observation.physicalRotation), emptyOutcomeCounts, add);
      bump(byOffset, String(wrapAround(angle, observation.correctAngle)), emptyOutcomeCounts, add);
      const outcome = classifyOutcome(observation);
      if (outcome !== "recovered") nonRecovered.push(leakCase(observation));
      if (outcome === "silent-leak") {
        leaks.push(leakCase(observation));
        leakInPdf = true;
      }
    }
    pdfs += 1;
    if (leakInPdf) pdfsWithLeak += 1;
    bump(
      pdfLabels,
      group.any.label,
      () => ({ pdfs: 0, withLeak: 0 }),
      (cell) => {
        cell.pdfs += 1;
        if (leakInPdf) cell.withLeak += 1;
      },
    );
  }
  return {
    total,
    bySet,
    byLabel,
    byDpi,
    byRotation,
    byOffset,
    pdfsWithLeak: { withLeak: pdfsWithLeak, pdfs, byLabel: pdfLabels },
    forcedCorrect,
    forcedCorrectNotRecovered,
    leaks,
    nonRecovered,
  };
}

// ------------------------------------------------------------------ producción

export interface ProductionResult {
  readonly total: OutcomeCounts;
  readonly bySet: Record<string, OutcomeCounts>;
  readonly byLabel: Record<string, OutcomeCounts>;
  readonly byDpi: Record<string, OutcomeCounts>;
  readonly byRotation: Record<string, OutcomeCounts>;
  /** Por veredicto natural: `none` (el OSD no dio veredicto), `correct` o `wrong`. */
  readonly byNaturalVerdict: Record<string, OutcomeCounts>;
  /** Las que no recuperaron los datos esperados (avisos y fugas), sin forzar nada. */
  readonly notRecovered: ReadonlyArray<LeakCase>;
}

/** Qué entrega la producción de hoy, sin forzar nada, en los PDF con texto. */
export function productionOutcomes(groups: ReadonlyArray<PdfGroup>): ProductionResult {
  const total = emptyOutcomeCounts();
  const bySet: Record<string, OutcomeCounts> = {};
  const byLabel: Record<string, OutcomeCounts> = {};
  const byDpi: Record<string, OutcomeCounts> = {};
  const byRotation: Record<string, OutcomeCounts> = {};
  const byNaturalVerdict: Record<string, OutcomeCounts> = {};
  const notRecovered: LeakCase[] = [];
  for (const group of groups) {
    const production = group.production;
    if (production === null || !hasText(production)) continue;
    const add = (cell: OutcomeCounts) => countOutcome(cell, production);
    add(total);
    bump(bySet, production.set, emptyOutcomeCounts, add);
    bump(byLabel, production.label, emptyOutcomeCounts, add);
    bump(byDpi, String(production.sourceDpi), emptyOutcomeCounts, add);
    bump(byRotation, String(production.physicalRotation), emptyOutcomeCounts, add);
    const verdict = production.delivered;
    const kind =
      verdict.osdHadVerdict !== true
        ? "none"
        : verdict.orientation === production.correctAngle
          ? "correct"
          : "wrong";
    bump(byNaturalVerdict, kind, emptyOutcomeCounts, add);
    if (classifyOutcome(production) !== "recovered") notRecovered.push(leakCase(production));
  }
  return { total, bySet, byLabel, byDpi, byRotation, byNaturalVerdict, notRecovered };
}

// ------------------------------------------------------------------ primeras lecturas

export interface FirstReading {
  readonly key: string;
  readonly set: ObservationRecord["set"];
  readonly label: string;
  readonly sourceDpi: number;
  readonly angle: PhysicalAngle;
  readonly isCorrect: boolean;
  readonly reliableWords: number;
  readonly wordCount: number;
  /** `null` se lee como 0: una lectura sin resultado no tiene confianza. */
  readonly pageConfidence: number | null;
  readonly inkRatio: number | null;
  readonly durationMs: number | null;
}

/** Las cuatro primeras lecturas de un PDF (una por ángulo). */
export function firstReadings(group: PdfGroup): FirstReading[] {
  const readings: FirstReading[] = [];
  for (const angle of PHYSICAL_ANGLES) {
    const observation = group.forced.get(angle);
    const first = observation?.attempts[0];
    if (observation === undefined || first === undefined) continue;
    readings.push({
      key: observation.key,
      set: observation.set,
      label: observation.label,
      sourceDpi: observation.sourceDpi,
      angle,
      isCorrect: angle === observation.correctAngle,
      reliableWords: first.reliableWordCount,
      wordCount: first.wordCount,
      pageConfidence: first.pageConfidence,
      inkRatio: observation.delivered.inkRatio,
      durationMs: first.durationMs,
    });
  }
  return readings;
}

// ------------------------------------------------------------------ pregunta 3

export interface Signal {
  readonly id: string;
  readonly label: string;
  fires(reading: FirstReading): boolean;
}

export const SIGNAL_WORD_THRESHOLDS = [5, 10, 20] as const;
export const SIGNAL_CONFIDENCE_THRESHOLDS = [0.5, 0.7, 0.8] as const;
export const SIGNAL_INK_THRESHOLDS = [0.005, 0.01, 0.02] as const;
/** Los umbrales de la unión y de la intersección. */
export const COMBINED_WORDS = 10;
export const COMBINED_CONFIDENCE = 0.7;

const percent = (value: number): string => String(value).replace(".", ",");

export function buildSignals(): Signal[] {
  const signals: Signal[] = [];
  for (const n of SIGNAL_WORD_THRESHOLDS)
    signals.push({
      id: `words<${n}`,
      label: `menos de ${n} palabras con confianza ≥ 60`,
      fires: (reading) => reading.reliableWords < n,
    });
  for (const x of SIGNAL_CONFIDENCE_THRESHOLDS)
    signals.push({
      id: `conf<${x}`,
      label: `confianza de página < ${percent(x)}`,
      fires: (reading) => (reading.pageConfidence ?? 0) < x,
    });
  for (const r of SIGNAL_INK_THRESHOLDS)
    signals.push({
      id: `ink<${r}`,
      label: `inkRatio < ${percent(r)}`,
      // Sin medición no hay señal (la medición falla cerrado antes de llegar acá).
      fires: (reading) => reading.inkRatio !== null && reading.inkRatio < r,
    });
  const few = (reading: FirstReading) => reading.reliableWords < COMBINED_WORDS;
  const low = (reading: FirstReading) => (reading.pageConfidence ?? 0) < COMBINED_CONFIDENCE;
  signals.push({
    id: `words<${COMBINED_WORDS} OR conf<${COMBINED_CONFIDENCE}`,
    label: `unión: menos de ${COMBINED_WORDS} palabras confiables o confianza < ${percent(COMBINED_CONFIDENCE)}`,
    fires: (reading) => few(reading) || low(reading),
  });
  signals.push({
    id: `words<${COMBINED_WORDS} AND conf<${COMBINED_CONFIDENCE}`,
    label: `intersección: menos de ${COMBINED_WORDS} palabras confiables y confianza < ${percent(COMBINED_CONFIDENCE)}`,
    fires: (reading) => few(reading) && low(reading),
  });
  return signals;
}

export interface FiredCounts {
  readings: number;
  fired: number;
}

export interface SignalResult {
  readonly id: string;
  readonly label: string;
  /** Primeras lecturas en un ángulo equivocado (tres por PDF). */
  readonly wrongAngle: FiredCounts;
  /** De esas, las que la cadena de hoy da por fiables (alguna palabra con confianza ≥ 60). */
  readonly wrongAngleAccepted: FiredCounts;
  /** Las que terminaron en fuga silenciosa en la pregunta 2. */
  readonly silentLeaks: FiredCounts;
  /** Primeras lecturas en el ángulo correcto: dispararlas es costo de más. */
  readonly correctAngle: FiredCounts;
  readonly correctAngleBySubset: Record<string, FiredCounts>;
}

const emptyFired = (): FiredCounts => ({ readings: 0, fired: 0 });

export function q3Signals(
  groups: ReadonlyArray<PdfGroup>,
  signals: ReadonlyArray<Signal> = buildSignals(),
): SignalResult[] {
  const leakKeys = new Set(
    q2ForcedOutcomes(groups).leaks.map((leak) => `${leak.key}|${leak.forcedAngle}`),
  );
  const readings = groups.filter(forcedComplete).flatMap(firstReadings);
  return signals.map((signal) => {
    const wrongAngle = emptyFired();
    const wrongAngleAccepted = emptyFired();
    const silentLeaks = emptyFired();
    const correctAngle = emptyFired();
    const correctAngleBySubset: Record<string, FiredCounts> = {};
    for (const reading of readings) {
      const fired = signal.fires(reading);
      const count = (cell: FiredCounts) => {
        cell.readings += 1;
        if (fired) cell.fired += 1;
      };
      if (reading.isCorrect) {
        count(correctAngle);
        for (const subset of subsetsOf(reading))
          bump(correctAngleBySubset, subset, emptyFired, count);
      } else {
        count(wrongAngle);
        if (reading.reliableWords >= 1) count(wrongAngleAccepted);
        if (leakKeys.has(`${reading.key}|${reading.angle}`)) count(silentLeaks);
      }
    }
    return {
      id: signal.id,
      label: signal.label,
      wrongAngle,
      wrongAngleAccepted,
      silentLeaks,
      correctAngle,
      correctAngleBySubset,
    };
  });
}

// ------------------------------------------------------------------ pregunta 3 bis

export type ComparatorId = "page-confidence-first" | "reliable-words-first";

export const COMPARATORS: ReadonlyArray<{ readonly id: ComparatorId; readonly label: string }> = [
  { id: "page-confidence-first", label: "confianza de página y después palabras confiables" },
  { id: "reliable-words-first", label: "palabras confiables y después confianza de página" },
];

export interface ComparatorCounts {
  pdfs: number;
  /** El ángulo correcto gana solo. */
  correct: number;
  /** Empata en el primer puesto con otros ángulos (no hay forma de elegir). */
  tiedWithCorrect: number;
  /** Gana otro ángulo, o empatan otros sin el correcto. */
  wrong: number;
}

export interface ComparatorResult {
  readonly id: ComparatorId;
  readonly label: string;
  readonly total: ComparatorCounts;
  readonly bySubset: Record<string, ComparatorCounts>;
}

const emptyComparatorCounts = (): ComparatorCounts => ({
  pdfs: 0,
  correct: 0,
  tiedWithCorrect: 0,
  wrong: 0,
});

function comparatorKey(id: ComparatorId, reading: FirstReading): [number, number] {
  const confidence = reading.pageConfidence ?? -1;
  return id === "page-confidence-first"
    ? [confidence, reading.reliableWords]
    : [reading.reliableWords, confidence];
}

/** Los ángulos que quedan primeros con ese comparador (más de uno es un empate). */
export function topAngles(
  id: ComparatorId,
  readings: ReadonlyArray<FirstReading>,
): PhysicalAngle[] {
  let best: [number, number] | null = null;
  let winners: PhysicalAngle[] = [];
  for (const reading of readings) {
    const key = comparatorKey(id, reading);
    if (best === null || key[0] > best[0] || (key[0] === best[0] && key[1] > best[1])) {
      best = key;
      winners = [reading.angle];
    } else if (key[0] === best[0] && key[1] === best[1]) winners.push(reading.angle);
  }
  return winners;
}

export function q3bisComparators(groups: ReadonlyArray<PdfGroup>): ComparatorResult[] {
  return COMPARATORS.map(({ id, label }) => {
    const total = emptyComparatorCounts();
    const bySubset: Record<string, ComparatorCounts> = {};
    for (const group of groups) {
      if (!forcedComplete(group)) continue;
      const readings = firstReadings(group);
      const winners = topAngles(id, readings);
      const correct = group.any.correctAngle;
      const add = (cell: ComparatorCounts) => {
        cell.pdfs += 1;
        if (winners.length === 1 && winners[0] === correct) cell.correct += 1;
        else if (winners.length > 1 && winners.includes(correct)) cell.tiedWithCorrect += 1;
        else cell.wrong += 1;
      };
      add(total);
      for (const subset of subsetsOf(group.any)) bump(bySubset, subset, emptyComparatorCounts, add);
    }
    return { id, label, total, bySubset };
  });
}

// ------------------------------------------------------------------ pregunta 4

export interface Distribution {
  readonly n: number;
  readonly totalSec: number;
  readonly meanSec: number | null;
  readonly medianSec: number | null;
  readonly p90Sec: number | null;
  readonly maxSec: number | null;
}

/** Percentil `q` (0 a 1) por interpolación lineal; `values` ya ordenados. */
export function quantile(sorted: ReadonlyArray<number>, q: number): number | null {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? lowValue;
  return lowValue + (highValue - lowValue) * (position - low);
}

export function distribution(values: ReadonlyArray<number>): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    n: sorted.length,
    totalSec: total,
    meanSec: sorted.length === 0 ? null : total / sorted.length,
    medianSec: quantile(sorted, 0.5),
    p90Sec: quantile(sorted, 0.9),
    maxSec: sorted.at(-1) ?? null,
  };
}

export interface TimeResult {
  readonly id: string;
  readonly label: string;
  /** Segundos extra de tres lecturas más, por página en ángulo equivocado que la señal dispara. */
  readonly onWrongAngle: Distribution;
  /** Lo mismo por página en el ángulo correcto: el costo de la señal sobre páginas bien leídas. */
  readonly onCorrectAngle: Distribution;
  readonly onCorrectAngleBySubset: Record<string, Distribution>;
  /** Costo extra medio por página bien orientada, disparen o no (segundos). */
  readonly meanExtraPerCorrectPageSec: number | null;
  /**
   * Lo mismo con tiempos en caliente: los reconocimientos que no fueron el primero de su observación, que
   * ya encontraron el worker cargado, como los encontrarían tres lecturas más en el producto. Solo cuenta
   * las lecturas disparadas con una muestra en caliente de los otros tres ángulos.
   */
  readonly warm: {
    readonly onWrongAngle: Distribution;
    readonly onCorrectAngle: Distribution;
    /** Lecturas disparadas a las que les falta la muestra en caliente de algún otro ángulo. */
    readonly withoutSample: number;
    /** Costo medio por página bien orientada que tiene las tres muestras, disparen o no (segundos). */
    readonly meanExtraPerCorrectPageSec: number | null;
  };
}

/**
 * Mediana, por ángulo, de los reconocimientos en caliente de un PDF: los que no fueron el primero de su
 * observación y no se agrandaron. Salen de cualquiera de sus cinco observaciones.
 */
export function warmDurationsMs(group: PdfGroup): ReadonlyMap<number, number> {
  const samples = new Map<number, number[]>();
  const observations = [
    ...(group.production === null ? [] : [group.production]),
    ...group.forced.values(),
  ];
  for (const observation of observations)
    for (const attempt of observation.attempts.slice(1)) {
      if (attempt.upscale !== 1 || attempt.terminal !== "COMPLETED") continue;
      if (attempt.durationMs === null || attempt.dispatchedOrientation === null) continue;
      const list = samples.get(attempt.dispatchedOrientation) ?? [];
      list.push(attempt.durationMs);
      samples.set(attempt.dispatchedOrientation, list);
    }
  const medians = new Map<number, number>();
  for (const [angle, list] of samples) {
    const median = quantile(
      [...list].sort((a, b) => a - b),
      0.5,
    );
    if (median !== null) medians.set(angle, median);
  }
  return medians;
}

/** Segundos de las otras tres lecturas del PDF en caliente; `null` si falta alguna muestra. */
export function warmExtraSeconds(
  reading: FirstReading,
  warm: ReadonlyMap<number, number>,
): number | null {
  let total = 0;
  for (const angle of PHYSICAL_ANGLES) {
    if (angle === reading.angle) continue;
    const ms = warm.get(angle);
    if (ms === undefined) return null;
    total += ms;
  }
  return total / 1000;
}

/**
 * El tiempo de las otras tres lecturas del PDF, medido en las observaciones forzadas a esos ángulos. Sin
 * medición de alguna, `null`.
 */
export function extraReadingSeconds(reading: FirstReading, readings: ReadonlyArray<FirstReading>) {
  const others = readings.filter((other) => other.angle !== reading.angle);
  if (others.some((other) => other.durationMs === null)) return null;
  return others.reduce((sum, other) => sum + (other.durationMs ?? 0), 0) / 1000;
}

export function q4Time(
  groups: ReadonlyArray<PdfGroup>,
  signals: ReadonlyArray<Signal> = buildSignals(),
): TimeResult[] {
  const complete = groups.filter(forcedComplete);
  const perPdf = complete.map((group) => firstReadings(group));
  const warmPerPdf = complete.map((group) => warmDurationsMs(group));
  return signals.map((signal) => {
    const wrong: number[] = [];
    const correct: number[] = [];
    const bySubset: Record<string, number[]> = {};
    const warmWrong: number[] = [];
    const warmCorrect: number[] = [];
    let warmWithoutSample = 0;
    let warmCorrectCovered = 0;
    let correctReadings = 0;
    for (const [index, readings] of perPdf.entries()) {
      const warm = warmPerPdf[index] ?? new Map<number, number>();
      for (const reading of readings) {
        if (reading.isCorrect) correctReadings += 1;
        const warmExtra = warmExtraSeconds(reading, warm);
        if (reading.isCorrect && warmExtra !== null) warmCorrectCovered += 1;
        if (!signal.fires(reading)) continue;
        if (warmExtra === null) warmWithoutSample += 1;
        else (reading.isCorrect ? warmCorrect : warmWrong).push(warmExtra);
        const extra = extraReadingSeconds(reading, readings);
        if (extra === null) continue;
        if (reading.isCorrect) {
          correct.push(extra);
          for (const subset of subsetsOf(reading))
            bump(
              bySubset,
              subset,
              () => [],
              (c) => c.push(extra),
            );
        } else wrong.push(extra);
      }
    }
    const correctTotal = correct.reduce((sum, value) => sum + value, 0);
    return {
      id: signal.id,
      label: signal.label,
      onWrongAngle: distribution(wrong),
      onCorrectAngle: distribution(correct),
      onCorrectAngleBySubset: Object.fromEntries(
        Object.entries(bySubset).map(([subset, values]) => [subset, distribution(values)]),
      ),
      meanExtraPerCorrectPageSec: correctReadings === 0 ? null : correctTotal / correctReadings,
      warm: {
        onWrongAngle: distribution(warmWrong),
        onCorrectAngle: distribution(warmCorrect),
        withoutSample: warmWithoutSample,
        meanExtraPerCorrectPageSec:
          warmCorrectCovered === 0
            ? null
            : warmCorrect.reduce((sum, value) => sum + value, 0) / warmCorrectCovered,
      },
    };
  });
}

export interface ReadingTimes {
  /** Primeras lecturas (en frío), en segundos. */
  readonly firstReadings: Distribution;
  readonly firstReadingsByDpi: Record<string, Distribution>;
  /**
   * Diagnóstico del arranque en frío: el primer reconocimiento de cada observación contra los siguientes
   * de la misma observación (sin agrandar), en segundos.
   */
  readonly firstAttempt: Distribution;
  readonly laterAttempts: Distribution;
}

export function readingTimes(
  groups: ReadonlyArray<PdfGroup>,
  observations: ReadonlyArray<ObservationRecord>,
): ReadingTimes {
  const readings = groups.filter(forcedComplete).flatMap(firstReadings);
  const seconds = (ms: number | null): number[] => (ms === null ? [] : [ms / 1000]);
  const byDpi: Record<string, number[]> = {};
  for (const reading of readings)
    bump(
      byDpi,
      String(reading.sourceDpi),
      () => [],
      (c) => c.push(...seconds(reading.durationMs)),
    );
  const textual = observations.filter(hasText);
  return {
    firstReadings: distribution(readings.flatMap((reading) => seconds(reading.durationMs))),
    firstReadingsByDpi: Object.fromEntries(
      Object.entries(byDpi).map(([dpi, values]) => [dpi, distribution(values)]),
    ),
    firstAttempt: distribution(
      textual.flatMap((observation) => seconds(observation.attempts[0]?.durationMs ?? null)),
    ),
    laterAttempts: distribution(
      textual.flatMap((observation) =>
        observation.attempts
          .slice(1)
          .filter((attempt) => attempt.upscale === 1)
          .flatMap((attempt) => seconds(attempt.durationMs)),
      ),
    ),
  };
}
