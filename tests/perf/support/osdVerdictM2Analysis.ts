/**
 * M-O2: las cuentas sobre las observaciones ya medidas (las de M-O1 y las de M-O2), sin volver a correr nada.
 * Puras. Tres análisis:
 *
 * 1. **RC** (`analyzeRc`): qué páginas habría mandado a los cuatro ángulos la regla del renglón de costado, qué
 *    habría entregado, cuántas lecturas de ruido traen una palabra confiable y cuánto cuestan tres lecturas más
 *    sobre una hoja casi vacía.
 * 2. **CP** (`analyzeCp`): el comparador por confianza de página en la cadena con veredicto, en tres
 *    escenarios (producción, veredicto correcto forzado, veredicto equivocado forzado): qué cambia en cada
 *    sentido.
 * 3. **SV** (`analyzeSv`): la señal con veredicto para cada umbral T, por conjunto: el costo sobre páginas
 *    bien orientadas, lo que se le escapa, y qué cierra «SV + CP».
 *
 * **Son simulaciones sobre lecturas medidas** (`osdVerdictSim.ts`), no el producto. Donde el producto de
 * hoy se midió (`MeasuredRun`) la tabla lo dice aparte, y `validateSimulation` compara la simulación de la
 * cadena de hoy con lo medido.
 */

import { distribution, quantile, type Distribution } from "./osdVerdictAnalysis.js";
import {
  ANGLES,
  CP_ONLY,
  TODAY,
  compareWithMeasured,
  measuredOutcome,
  outcomeOf,
  readingHasData,
  referenceAngle,
  simulate,
  verdictFor,
  type Angle,
  type MeasuredRun,
  type SimGroup,
  type SimOutcome,
  type SimResult,
  type SimPage,
} from "./osdVerdictSim.js";

function bump<T>(table: Record<string, T>, key: string, init: () => T, update: (cell: T) => void) {
  const cell = table[key] ?? init();
  update(cell);
  table[key] = cell;
}

export const SV_THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.85] as const;

export interface Triple {
  n: number;
  recovered: number;
  warned: number;
  leak: number;
}
const emptyTriple = (): Triple => ({ n: 0, recovered: 0, warned: 0, leak: 0 });
function countOutcome(cell: Triple, outcome: SimOutcome): void {
  cell.n += 1;
  if (outcome === "recovered") cell.recovered += 1;
  else if (outcome === "warned") cell.warned += 1;
  else cell.leak += 1;
}

const withData = (page: SimPage): boolean => page.group === "m1-text" || page.group === "margin";

// ------------------------------------------------------------------ validación

export interface SimulationValidation {
  readonly runs: number;
  readonly sameAngles: number;
  /** Comparaciones de la lectura final (sin las del paso 4). */
  readonly finalCompared: number;
  readonly sameFinal: number;
  readonly upscaleSkipped: number;
  readonly disagreements: ReadonlyArray<{
    readonly key: string;
    readonly scenario: string;
    readonly sameAngles: boolean;
    readonly sameFinal: boolean | null;
  }>;
}

/** La simulación de la cadena de hoy contra las observaciones medidas del producto. */
export function validateSimulation(pages: ReadonlyArray<SimPage>): SimulationValidation {
  let runs = 0;
  let sameAngles = 0;
  let finalCompared = 0;
  let sameFinal = 0;
  let upscaleSkipped = 0;
  const disagreements: Array<SimulationValidation["disagreements"][number]> = [];
  for (const page of pages) {
    for (const scenario of ["natural", ...ANGLES] as const) {
      const agreement = compareWithMeasured(page, scenario);
      if (agreement === null) continue;
      runs += 1;
      if (agreement.sameAngles) sameAngles += 1;
      if (agreement.sameFinal === null) upscaleSkipped += 1;
      else {
        finalCompared += 1;
        if (agreement.sameFinal) sameFinal += 1;
      }
      if (!agreement.sameAngles || agreement.sameFinal === false)
        disagreements.push({
          key: page.key,
          scenario: String(scenario),
          sameAngles: agreement.sameAngles,
          sameFinal: agreement.sameFinal,
        });
    }
  }
  return { runs, sameAngles, finalCompared, sameFinal, upscaleSkipped, disagreements };
}

// ------------------------------------------------------------------ RC

export interface RcRow {
  readonly key: string;
  readonly group: SimGroup;
  readonly label: string;
  readonly sourceDpi: number | null;
  readonly ink: number;
  /** Lecturas que hace la cadena de hoy y con RC. */
  readonly todayReadings: number;
  readonly rcReadings: number;
  /** Ángulo que entrega RC (CP entre las lecturas). */
  readonly rcAngle: Angle;
  /** `n/a` en una hoja sin datos esperados (ruido, controles): no hay qué recuperar. */
  readonly todayOutcome: SimOutcome | "n/a";
  readonly rcOutcome: SimOutcome | "n/a";
  /** Lecturas de los cuatro ángulos con alguna palabra confiable. */
  readonly reliableReadings: number;
  readonly entityCount: number;
}

export interface RcCell {
  pages: number;
  probedByRc: number;
  recoveredToday: number;
  recoveredRc: number;
  withReliableReading: number;
}

export interface NoiseReadings {
  /** Páginas de ruido por etiqueta, con sus lecturas en los cuatro ángulos. */
  readings: number;
  withWords: number;
  withReliableWord: number;
}

export interface RcTime {
  readonly pages: number;
  /** Tres lecturas más, con las primeras lecturas medidas (en frío, cota alta). */
  readonly cold: Distribution;
  /** Con los reconocimientos que no fueron el primero de su observación (en caliente, con muestra). */
  readonly warm: Distribution;
}

export interface RcResult {
  readonly pages: number;
  readonly byGroup: Record<string, RcCell>;
  readonly byLabel: Record<string, RcCell>;
  readonly rows: ReadonlyArray<RcRow>;
  readonly noiseByLabel: Record<string, NoiseReadings>;
  readonly noiseTotal: NoiseReadings;
  /** Entidades que salieron de las observaciones de ruido (producción y veredicto forzado). */
  readonly noiseEntities: {
    readonly observations: number;
    readonly withEntities: number;
    readonly total: number;
  };
  readonly time: RcTime;
}

function outcomeOrNa(result: SimResult): SimOutcome | "n/a" {
  return readingHasData(result.final) === null ? "n/a" : outcomeOf(result);
}

function totalExtraSeconds(page: SimPage, from: Angle): number | null {
  let total = 0;
  for (const angle of ANGLES) {
    if (angle === from) continue;
    const ms = page.readings[angle]?.durationMs;
    if (ms === undefined || ms === null) return null;
    total += ms;
  }
  return total / 1000;
}

function warmExtraSeconds(page: SimPage, from: Angle): number | null {
  let total = 0;
  for (const angle of ANGLES) {
    if (angle === from) continue;
    const ms = page.warmMs[angle];
    if (ms === undefined) return null;
    total += ms;
  }
  return total / 1000;
}

/**
 * RC sobre las páginas de M-O1 (con texto y controles) y el ruido, en producción (veredicto natural). Una página
 * entra a `rows` si RC le suma lecturas a las que ya hace la cadena de hoy.
 */
export function analyzeRc(pages: ReadonlyArray<SimPage>): RcResult {
  const considered = pages.filter(
    (page) => page.group === "m1-text" || page.group === "m1-control" || page.group === "noise",
  );
  const byGroup: Record<string, RcCell> = {};
  const byLabel: Record<string, RcCell> = {};
  const rows: RcRow[] = [];
  const noiseByLabel: Record<string, NoiseReadings> = {};
  const noiseTotal: NoiseReadings = { readings: 0, withWords: 0, withReliableWord: 0 };
  let noiseObservations = 0;
  let noiseWithEntities = 0;
  let noiseEntityTotal = 0;
  const cold: number[] = [];
  const warm: number[] = [];
  let timePages = 0;
  const emptyCell = (): RcCell => ({
    pages: 0,
    probedByRc: 0,
    recoveredToday: 0,
    recoveredRc: 0,
    withReliableReading: 0,
  });

  for (const page of considered) {
    const rc = { ...TODAY, rc: true };
    const today = simulate(page, page.natural, TODAY);
    const withRc = simulate(page, page.natural, rc);
    const probed = withRc.angles.length > today.angles.length;
    const reliableReadings = ANGLES.filter(
      (angle) => (page.readings[angle]?.reliable ?? 0) > 0,
    ).length;
    const todayOutcome = outcomeOrNa(today);
    const rcOutcome = outcomeOrNa(withRc);
    const add = (cell: RcCell) => {
      cell.pages += 1;
      if (probed) cell.probedByRc += 1;
      if (todayOutcome === "recovered") cell.recoveredToday += 1;
      if (rcOutcome === "recovered") cell.recoveredRc += 1;
      if (reliableReadings > 0) cell.withReliableReading += 1;
    };
    bump(byGroup, page.group, emptyCell, add);
    bump(byLabel, `${page.group}:${page.label}`, emptyCell, add);
    if (probed) {
      rows.push({
        key: page.key,
        group: page.group,
        label: page.label,
        sourceDpi: page.sourceDpi,
        ink: page.ink,
        todayReadings: today.angles.length,
        rcReadings: withRc.angles.length,
        rcAngle: withRc.finalAngle,
        todayOutcome,
        rcOutcome,
        reliableReadings,
        entityCount: Object.values(page.measured).reduce((sum, run) => sum + run.entityCount, 0),
      });
      const coldExtra = totalExtraSeconds(page, 0);
      if (coldExtra !== null) {
        cold.push(coldExtra);
        timePages += 1;
        const warmExtra = warmExtraSeconds(page, 0);
        if (warmExtra !== null) warm.push(warmExtra);
      }
    }
    if (page.group === "noise") {
      for (const angle of ANGLES) {
        const reading = page.readings[angle];
        if (reading === undefined) continue;
        const add2 = (cell: NoiseReadings) => {
          cell.readings += 1;
          if (reading.words > 0) cell.withWords += 1;
          if (reading.reliable > 0) cell.withReliableWord += 1;
        };
        add2(noiseTotal);
        bump(
          noiseByLabel,
          page.label,
          () => ({ readings: 0, withWords: 0, withReliableWord: 0 }),
          add2,
        );
      }
      for (const run of Object.values(page.measured)) {
        noiseObservations += 1;
        if (run.entityCount > 0) noiseWithEntities += 1;
        noiseEntityTotal += run.entityCount;
      }
    }
  }
  return {
    pages: considered.length,
    byGroup,
    byLabel,
    rows,
    noiseByLabel,
    noiseTotal,
    noiseEntities: {
      observations: noiseObservations,
      withEntities: noiseWithEntities,
      total: noiseEntityTotal,
    },
    time: { pages: timePages, cold: distribution(cold), warm: distribution(warm) },
  };
}

// ------------------------------------------------------------------ CP

export type Scenario = "production" | "forced-correct" | "forced-wrong";
export const SCENARIOS: ReadonlyArray<Scenario> = ["production", "forced-correct", "forced-wrong"];

export interface Change {
  readonly key: string;
  readonly scenario: Scenario;
  /** Ángulo del veredicto (`natural` en producción). */
  readonly verdict: string;
  readonly todayOutcome: SimOutcome;
  readonly cpOutcome: SimOutcome;
  readonly todayAngle: Angle;
  readonly cpAngle: Angle;
  /** El paso 4 habría corrido y no se sabe qué leería. */
  readonly upscaleUnknown: boolean;
}

export interface CpCell {
  today: Triple;
  cp: Triple;
  /** Lecturas de producción distintas entre hoy y CP (ángulos o lectura elegida). */
  changed: number;
  upscaleUnknown: number;
}

export interface CpResult {
  readonly cells: Record<string, CpCell>;
  readonly toRecovered: ReadonlyArray<Change>;
  readonly toLeak: ReadonlyArray<Change>;
  /** Entre las fugas medidas de M-O1 con veredicto equivocado forzado: cuántas cierra CP solo. */
  readonly m1Leaks: {
    readonly measuredLeaks: number;
    readonly simulatedTodayLeaks: number;
    readonly closedByCp: number;
    readonly stillLeakWithCp: number;
    readonly closedKeys: ReadonlyArray<string>;
  };
  readonly validation: SimulationValidation;
}

const scenarioVerdicts = (
  page: SimPage,
): Array<{ scenario: Scenario; verdict: "natural" | Angle }> => {
  const list: Array<{ scenario: Scenario; verdict: "natural" | Angle }> = [
    { scenario: "production", verdict: "natural" },
  ];
  for (const angle of ANGLES)
    list.push({
      scenario: page.correctAngle === angle ? "forced-correct" : "forced-wrong",
      verdict: angle,
    });
  return list;
};

export function analyzeCp(pages: ReadonlyArray<SimPage>): CpResult {
  const cells: Record<string, CpCell> = {};
  const toRecovered: Change[] = [];
  const toLeak: Change[] = [];
  const empty = (): CpCell => ({
    today: emptyTriple(),
    cp: emptyTriple(),
    changed: 0,
    upscaleUnknown: 0,
  });
  let measuredLeaks = 0;
  let simulatedTodayLeaks = 0;
  const closedKeys: string[] = [];
  let closedByCp = 0;

  for (const page of pages.filter(withData)) {
    for (const { scenario, verdict } of scenarioVerdicts(page)) {
      const v = verdictFor(page, verdict);
      const today = simulate(page, v, TODAY);
      const cp = simulate(page, v, CP_ONLY);
      const todayOutcome = outcomeOf(today);
      const cpOutcome = outcomeOf(cp);
      const unknown = today.upscaleNeeded || cp.upscaleNeeded;
      const same =
        today.finalAngle === cp.finalAngle &&
        today.angles.length === cp.angles.length &&
        today.angles.every((angle, index) => angle === cp.angles[index]);
      const add = (cell: CpCell) => {
        countOutcome(cell.today, todayOutcome);
        countOutcome(cell.cp, cpOutcome);
        if (!same) cell.changed += 1;
        if (unknown) cell.upscaleUnknown += 1;
      };
      for (const id of [`${page.group}|${scenario}`, `${page.group}:${page.label}|${scenario}`])
        bump(cells, id, empty, add);
      const change: Change = {
        key: page.key,
        scenario,
        verdict: String(verdict),
        todayOutcome,
        cpOutcome,
        todayAngle: today.finalAngle,
        cpAngle: cp.finalAngle,
        upscaleUnknown: unknown,
      };
      if (todayOutcome !== "recovered" && cpOutcome === "recovered") toRecovered.push(change);
      if (todayOutcome === "recovered" && cpOutcome !== "recovered") toLeak.push(change);

      if (page.group === "m1-text" && scenario === "forced-wrong") {
        const measured = page.measured[verdict as Angle];
        if (measured !== undefined && measuredOutcome(measured) === "leak") {
          measuredLeaks += 1;
          if (todayOutcome === "leak") simulatedTodayLeaks += 1;
          if (cpOutcome === "recovered") {
            closedByCp += 1;
            closedKeys.push(`${page.key}/${verdict}`);
          }
        }
      }
    }
  }
  return {
    cells,
    toRecovered,
    toLeak,
    m1Leaks: {
      measuredLeaks,
      simulatedTodayLeaks,
      closedByCp,
      stillLeakWithCp: measuredLeaks - closedByCp,
      closedKeys,
    },
    validation: validateSimulation(pages),
  };
}

// ------------------------------------------------------------------ SV

export type SvSet = "M-O1 sintético" | "margen" | "R1" | "R2 a R4";

export function svSetOf(page: SimPage): SvSet | null {
  if (page.group === "m1-text") return "M-O1 sintético";
  if (page.group === "margin") return "margen";
  if (page.group === "real") return page.label === "R1" ? "R1" : "R2 a R4";
  return null;
}

export interface SvCell {
  /** Páginas con ángulo correcto o de referencia. */
  pages: number;
  /** Páginas bien orientadas en las que SV dispara: el costo. */
  firesOnWellOriented: number;
  /** Lecturas en ángulo equivocado (tres por página) y las que no dispara (`conf ≥ T`). */
  wrongReadings: number;
  escapes: number;
  /** Veredicto equivocado forzado (solo sintéticos): fugas con hoy, con CP y con SV + CP. */
  forcedWrong: number;
  leaksToday: number;
  leaksCp: number;
  leaksSvCp: number;
  /** Veredicto equivocado forzado terminando en el ángulo correcto o de referencia (reales). */
  endsAtCorrectToday: number;
  endsAtCorrectCp: number;
  endsAtCorrectSvCp: number;
}

export interface SvResult {
  /** `set|T`. */
  readonly cells: Record<string, SvCell>;
}

const emptySvCell = (): SvCell => ({
  pages: 0,
  firesOnWellOriented: 0,
  wrongReadings: 0,
  escapes: 0,
  forcedWrong: 0,
  leaksToday: 0,
  leaksCp: 0,
  leaksSvCp: 0,
  endsAtCorrectToday: 0,
  endsAtCorrectCp: 0,
  endsAtCorrectSvCp: 0,
});

/** El ángulo con el que se compara una página: el correcto (sintéticos) o el de referencia (reales). */
export function targetAngle(page: SimPage): Angle | null {
  return page.group === "real" ? referenceAngle(page) : page.correctAngle;
}

export function analyzeSv(pages: ReadonlyArray<SimPage>): SvResult {
  const cells: Record<string, SvCell> = {};
  for (const page of pages) {
    const set = svSetOf(page);
    const target = targetAngle(page);
    if (set === null || target === null) continue;
    const wellOriented = simulate(page, { had: true, orientation: target }, CP_ONLY);
    for (const threshold of SV_THRESHOLDS) {
      const svRules = { ...CP_ONLY, sv: threshold };
      bump(cells, `${set}|${threshold}`, emptySvCell, (cell) => {
        cell.pages += 1;
        if (page.ink > 0 && wellOriented.final.conf < threshold) cell.firesOnWellOriented += 1;
        for (const angle of ANGLES) {
          if (angle === target) continue;
          const reading = page.readings[angle];
          if (reading === undefined) continue;
          cell.wrongReadings += 1;
          if (reading.conf >= threshold) cell.escapes += 1;
          const verdict = { had: true, orientation: angle };
          const today = simulate(page, verdict, TODAY);
          const cp = simulate(page, verdict, CP_ONLY);
          const sv = simulate(page, verdict, svRules);
          if (today.finalAngle === target) cell.endsAtCorrectToday += 1;
          if (cp.finalAngle === target) cell.endsAtCorrectCp += 1;
          if (sv.finalAngle === target) cell.endsAtCorrectSvCp += 1;
          if (withData(page)) {
            cell.forcedWrong += 1;
            if (outcomeOf(today) === "leak") cell.leaksToday += 1;
            if (outcomeOf(cp) === "leak") cell.leaksCp += 1;
            if (outcomeOf(sv) === "leak") cell.leaksSvCp += 1;
          }
        }
      });
    }
  }
  return { cells };
}

// ------------------------------------------------------------------ páginas reales

export interface Spread {
  readonly n: number;
  readonly min: number | null;
  readonly p10: number | null;
  readonly median: number | null;
  readonly p90: number | null;
  readonly max: number | null;
}

export function spread(values: ReadonlyArray<number>): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    p10: quantile(sorted, 0.1),
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    max: sorted.at(-1) ?? null,
  };
}

export interface RealSummary {
  readonly pages: number;
  /** Páginas sin lectura fiable en ningún ángulo: no tienen ángulo de referencia. */
  readonly noReference: number;
  readonly referenceConfidence: Spread;
  readonly wrongConfidence: Spread;
  /** Veredicto natural frente a la referencia (solo páginas con referencia). */
  readonly naturalAgrees: number;
  readonly naturalDisagrees: number;
  readonly noVerdict: number;
  readonly inkMin: number | null;
  readonly inkBelowThreshold: number;
  /** Con un veredicto equivocado forzado (tres por página con referencia), lo que entrega el producto de hoy. */
  readonly forcedWrong: {
    readonly observations: number;
    readonly deliversReference: number;
    readonly deliversOtherAngleWithoutWarning: number;
    readonly warned: number;
    readonly otherAngleWithWarning: number;
    readonly unknown: number;
  };
  /** Páginas con alguna entidad en la lectura final de producción, y entidades por página. */
  readonly productionEntities: { readonly pagesWithEntities: number; readonly entities: Spread };
}

export function summarizeReal(pages: ReadonlyArray<SimPage>): RealSummary {
  const referenceConfidence: number[] = [];
  const wrongConfidence: number[] = [];
  const entityCounts: number[] = [];
  let noReference = 0;
  let agrees = 0;
  let disagrees = 0;
  let noVerdict = 0;
  let inkBelow = 0;
  const forced = {
    observations: 0,
    deliversReference: 0,
    deliversOtherAngleWithoutWarning: 0,
    warned: 0,
    otherAngleWithWarning: 0,
    unknown: 0,
  };
  let pagesWithEntities = 0;
  for (const page of pages) {
    if (page.ink < 0.002) inkBelow += 1;
    const entities = page.measured.natural?.entityCount ?? 0;
    entityCounts.push(entities);
    if (entities > 0) pagesWithEntities += 1;
    const reference = referenceAngle(page);
    if (reference === null) {
      noReference += 1;
      continue;
    }
    referenceConfidence.push(page.readings[reference]?.conf ?? 0);
    if (!page.natural.had) noVerdict += 1;
    else if (page.natural.orientation === reference) agrees += 1;
    else disagrees += 1;
    for (const angle of ANGLES) {
      if (angle === reference) continue;
      const reading = page.readings[angle];
      if (reading !== undefined) wrongConfidence.push(reading.conf);
      const run: MeasuredRun | undefined = page.measured[angle];
      if (run === undefined) continue;
      forced.observations += 1;
      if (run.finalAngle === null) forced.unknown += 1;
      else if (run.finalAngle === reference) forced.deliversReference += 1;
      else if (run.unreadable) forced.otherAngleWithWarning += 1;
      else forced.deliversOtherAngleWithoutWarning += 1;
      if (run.unreadable) forced.warned += 1;
    }
  }
  const inks = pages.map((page) => page.ink);
  return {
    pages: pages.length,
    noReference,
    referenceConfidence: spread(referenceConfidence),
    wrongConfidence: spread(wrongConfidence),
    naturalAgrees: agrees,
    naturalDisagrees: disagrees,
    noVerdict,
    inkMin: inks.length === 0 ? null : Math.min(...inks),
    inkBelowThreshold: inkBelow,
    forcedWrong: forced,
    productionEntities: { pagesWithEntities, entities: spread(entityCounts) },
  };
}

// ------------------------------------------------------------------ margen

export interface PartCounts {
  n: number;
  body: number;
  stamp: number;
  both: number;
}
const emptyPart = (): PartCounts => ({ n: 0, body: 0, stamp: 0, both: 0 });

export interface MarginRow {
  /** Medido en el producto de hoy. */
  readonly measured: PartCounts;
  /** Simulación de hoy (la cadena de hoy sobre las lecturas medidas). */
  readonly simToday: PartCounts;
  /** Simulación con CP. */
  readonly simCp: PartCounts;
}

export interface MarginResult {
  /** `etiqueta|escenario`. */
  readonly rows: Record<string, MarginRow>;
}

function countParts(cell: PartCounts, body: boolean | null, stamp: boolean | null): void {
  cell.n += 1;
  if (body !== false) cell.body += 1;
  if (stamp !== false) cell.stamp += 1;
  if (body !== false && stamp !== false) cell.both += 1;
}

/**
 * Lo que entrega la cadena en las páginas de margen, separando los datos del cuerpo y los del sello. M1 no
 * tiene cuerpo (`body` cuenta como recuperado: no hay nada que perder). Un escenario por veredicto.
 */
export function analyzeMargin(pages: ReadonlyArray<SimPage>): MarginResult {
  const rows: Record<string, MarginRow> = {};
  for (const page of pages) {
    if (page.group !== "margin") continue;
    for (const { scenario, verdict } of scenarioVerdicts(page)) {
      const v = verdictFor(page, verdict);
      const today = simulate(page, v, TODAY);
      const cp = simulate(page, v, CP_ONLY);
      const measured = page.measured[verdict];
      const row = (rows[`${page.label}|${scenario}`] ??= {
        measured: emptyPart(),
        simToday: emptyPart(),
        simCp: emptyPart(),
      });
      if (measured !== undefined) countParts(row.measured, measured.body, measured.stamp);
      countParts(row.simToday, today.final.body, today.final.stamp);
      countParts(row.simCp, cp.final.body, cp.final.stamp);
    }
  }
  return { rows };
}
