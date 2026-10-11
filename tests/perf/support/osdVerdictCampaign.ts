/**
 * M-O1: la campaña como un todo. Puro. Dice qué observaciones se esperan (cinco por PDF: producción y un
 * veredicto forzado a cada ángulo), revisa que las que hay sean coherentes entre sí (mismo PDF, mismo
 * ráster, mismo DPI, mismo veredicto natural) y arma el resumen con las cinco preguntas del plan.
 *
 * Una campaña con observaciones faltantes, duplicadas o con issues no se da por buena: `check.complete`
 * es falso y el runner sale con error. Que el resultado no sea el que se quería no es un fallo del
 * instrumento.
 */

import {
  groupByPdf,
  productionOutcomes,
  q1WrongVerdicts,
  q2ForcedOutcomes,
  q3Signals,
  q3bisComparators,
  q4Time,
  readingTimes,
  type ComparatorResult,
  type ProductionResult,
  type Q1Result,
  type Q2Result,
  type ReadingTimes,
  type SignalResult,
  type TimeResult,
} from "./osdVerdictAnalysis.js";
import {
  PHYSICAL_ANGLES,
  hasText,
  type CorpusEntry,
  type PhysicalAngle,
} from "./osdVerdictCorpus.js";
import { observationFileName, observationIssues, type ObservationRecord } from "./osdVerdictRun.js";

export interface ExpectedObservation {
  readonly key: string;
  readonly forcedAngle: PhysicalAngle | null;
  readonly file: string;
}

export const OBSERVATIONS_PER_PDF = 1 + PHYSICAL_ANGLES.length;

export function expectedObservations(
  entries: ReadonlyArray<CorpusEntry>,
): ReadonlyArray<ExpectedObservation> {
  return entries.flatMap((entry) =>
    [null, ...PHYSICAL_ANGLES].map((forcedAngle) => ({
      key: entry.key,
      forcedAngle,
      file: observationFileName(entry.key, forcedAngle),
    })),
  );
}

const idOf = (key: string, forcedAngle: number | null): string => `${key}|${forcedAngle ?? "prod"}`;

export interface CampaignCheck {
  readonly expectedPdfs: number;
  readonly expectedObservations: number;
  readonly completedObservations: number;
  readonly complete: boolean;
  readonly missing: ReadonlyArray<string>;
  readonly unexpected: ReadonlyArray<string>;
  readonly duplicated: ReadonlyArray<string>;
  /** Problemas del instrumento: hacen fallar la campaña. */
  readonly issues: ReadonlyArray<{ readonly id: string; readonly issue: string }>;
  /** Diferencias entre repeticiones del mismo PDF que son un hallazgo, no un fallo. */
  readonly warnings: ReadonlyArray<{ readonly id: string; readonly warning: string }>;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function checkCampaign(
  observations: ReadonlyArray<ObservationRecord>,
  entries: ReadonlyArray<CorpusEntry>,
  pdfHashes: Readonly<Record<string, string>> = {},
): CampaignCheck {
  const expected = expectedObservations(entries);
  const expectedIds = new Set(expected.map((item) => idOf(item.key, item.forcedAngle)));
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const seen = new Map<string, number>();
  for (const observation of observations) {
    const id = idOf(observation.key, observation.forcedAngle);
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const missing = expected
    .filter((item) => !seen.has(idOf(item.key, item.forcedAngle)))
    .map((item) => idOf(item.key, item.forcedAngle));
  const unexpected = [...seen.keys()].filter((id) => !expectedIds.has(id));
  const duplicated = [...seen].filter(([, count]) => count > 1).map(([id]) => id);

  const issues: Array<{ id: string; issue: string }> = [];
  const warnings: Array<{ id: string; warning: string }> = [];
  for (const observation of observations) {
    const id = idOf(observation.key, observation.forcedAngle);
    for (const issue of observation.issues) issues.push({ id, issue });
    for (const issue of observationIssues(observation))
      if (!observation.issues.includes(issue)) issues.push({ id, issue: `al revisar: ${issue}` });
    const entry = entryByKey.get(observation.key);
    if (
      entry !== undefined &&
      (entry.set !== observation.set ||
        entry.label !== observation.label ||
        entry.sourceDpi !== observation.sourceDpi ||
        entry.physicalRotation !== observation.physicalRotation ||
        entry.correctAngle !== observation.correctAngle)
    )
      issues.push({ id, issue: "los datos del registro no son los de la entrada del corpus" });
    const expectedHash = pdfHashes[observation.key];
    if (expectedHash !== undefined && expectedHash !== observation.fixtureSha256)
      issues.push({ id, issue: "el hash del PDF difiere del manifiesto" });
  }

  const byPdf = new Map<string, ObservationRecord[]>();
  for (const observation of observations) {
    const list = byPdf.get(observation.key) ?? [];
    list.push(observation);
    byPdf.set(observation.key, list);
  }
  for (const [key, list] of byPdf) {
    const [head, ...rest] = list;
    if (head === undefined) continue;
    const headFirst = head.attempts[0];
    for (const other of rest) {
      const id = idOf(key, other.forcedAngle);
      const otherFirst = other.attempts[0];
      if (other.fixtureSha256 !== head.fixtureSha256)
        issues.push({ id, issue: "las observaciones de un PDF no usaron el mismo archivo" });
      if (
        headFirst !== undefined &&
        otherFirst !== undefined &&
        (headFirst.imageSha256 !== otherFirst.imageSha256 ||
          headFirst.dpi !== otherFirst.dpi ||
          headFirst.widthPx !== otherFirst.widthPx ||
          headFirst.heightPx !== otherFirst.heightPx ||
          headFirst.imageBytes !== otherFirst.imageBytes)
      )
        issues.push({ id, issue: "las lecturas de un PDF no se hicieron sobre el mismo ráster" });
      if (!sameJson(head.natural, other.natural))
        warnings.push({ id, warning: "el veredicto natural del OSD cambió entre observaciones" });
      if (!sameJson(head.rawOsd, other.rawOsd))
        warnings.push({ id, warning: "el OSD crudo cambió entre observaciones" });
    }
  }

  const complete =
    missing.length === 0 &&
    unexpected.length === 0 &&
    duplicated.length === 0 &&
    issues.length === 0;
  return {
    expectedPdfs: entries.length,
    expectedObservations: expected.length,
    completedObservations: observations.length,
    complete,
    missing,
    unexpected,
    duplicated,
    issues,
    warnings,
  };
}

export interface ControlSummary {
  readonly label: string;
  readonly observations: number;
  readonly withUnreadableInk: number;
  readonly withFinalReliableWords: number;
  readonly withDniEntity: number;
}

export interface BranchEvidence {
  readonly key: string;
  readonly productionAngles: ReadonlyArray<number | null>;
  readonly forcedZeroAngles: ReadonlyArray<number | null>;
}

export interface CampaignSummary {
  readonly check: CampaignCheck;
  readonly q1: Q1Result;
  /** Qué entrega la producción sin forzar nada. */
  readonly production: ProductionResult;
  readonly q2: Q2Result;
  readonly q3: ReadonlyArray<SignalResult>;
  readonly q3bis: ReadonlyArray<ComparatorResult>;
  readonly q4: ReadonlyArray<TimeResult>;
  readonly readingTimes: ReadingTimes;
  readonly controls: ReadonlyArray<ControlSummary>;
  /**
   * PDF con texto cuyo OSD natural no dio veredicto: ángulos que probó la producción y los que probó el
   * veredicto forzado a 0°. Si el host tomó el veredicto como tal, las secuencias difieren.
   */
  readonly branchEvidence: ReadonlyArray<BranchEvidence>;
}

export function summarizeCampaign(
  observations: ReadonlyArray<ObservationRecord>,
  entries: ReadonlyArray<CorpusEntry>,
  pdfHashes: Readonly<Record<string, string>> = {},
): CampaignSummary {
  const groups = groupByPdf(observations);
  const controlsByLabel = new Map<string, ControlSummary>();
  for (const observation of observations) {
    if (hasText(observation)) continue;
    const previous = controlsByLabel.get(observation.label) ?? {
      label: observation.label,
      observations: 0,
      withUnreadableInk: 0,
      withFinalReliableWords: 0,
      withDniEntity: 0,
    };
    controlsByLabel.set(observation.label, {
      ...previous,
      observations: previous.observations + 1,
      withUnreadableInk: previous.withUnreadableInk + (observation.final.unreadableInk ? 1 : 0),
      withFinalReliableWords:
        previous.withFinalReliableWords + (observation.final.reliableWordCount > 0 ? 1 : 0),
      withDniEntity: previous.withDniEntity + (observation.final.dniEntity === true ? 1 : 0),
    });
  }
  const branchEvidence: BranchEvidence[] = [];
  for (const group of groups) {
    const production = group.production;
    if (production === null || !hasText(production)) continue;
    if (production.delivered.osdHadVerdict !== false) continue;
    const forcedZero = group.forced.get(0);
    if (forcedZero === undefined) continue;
    branchEvidence.push({
      key: group.key,
      productionAngles: production.attempts.map((attempt) => attempt.dispatchedOrientation),
      forcedZeroAngles: forcedZero.attempts.map((attempt) => attempt.dispatchedOrientation),
    });
  }
  return {
    check: checkCampaign(observations, entries, pdfHashes),
    q1: q1WrongVerdicts(groups),
    production: productionOutcomes(groups),
    q2: q2ForcedOutcomes(groups),
    q3: q3Signals(groups),
    q3bis: q3bisComparators(groups),
    q4: q4Time(groups),
    readingTimes: readingTimes(groups, observations),
    controls: [...controlsByLabel.values()],
    branchEvidence,
  };
}
