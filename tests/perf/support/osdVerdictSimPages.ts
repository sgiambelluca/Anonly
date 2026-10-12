/**
 * M-O2: pasa los registros medidos (los de M-O1 y los de M-O2) a las páginas que simula
 * `osdVerdictSim.ts`. Pura. Una página tiene sus cuatro primeras lecturas (el primer reconocimiento de cada
 * observación forzada), la tinta, el veredicto natural y lo que midió el producto en cada observación.
 */

import { quantile } from "./osdVerdictAnalysis.js";
import type { M2Attempt, M2Observation } from "./osdVerdictM2Run.js";
import type { AttemptRecord, ObservationRecord } from "./osdVerdictRun.js";
import {
  ANGLES,
  type Angle,
  type MeasuredRun,
  type SimGroup,
  type SimPage,
  type SimReading,
} from "./osdVerdictSim.js";

const isAngle = (value: number | null): value is Angle =>
  value === 0 || value === 90 || value === 180 || value === 270;

/** Lo que los dos tipos de registro tienen en común para armar una página. */
interface CommonAttempt {
  readonly dispatchedOrientation: number | null;
  readonly upscale: number;
  readonly terminal: string | null;
  readonly durationMs: number | null;
  readonly pageConfidence: number | null;
  readonly wordCount: number;
  readonly reliableWordCount: number;
}

function warmMedians(
  observations: ReadonlyArray<{ readonly attempts: ReadonlyArray<CommonAttempt> }>,
): Partial<Record<Angle, number>> {
  const samples = new Map<Angle, number[]>();
  for (const observation of observations)
    for (const attempt of observation.attempts.slice(1)) {
      const angle = attempt.dispatchedOrientation;
      if (!isAngle(angle) || attempt.upscale !== 1 || attempt.terminal !== "COMPLETED") continue;
      if (attempt.durationMs === null) continue;
      const list = samples.get(angle) ?? [];
      list.push(attempt.durationMs);
      samples.set(angle, list);
    }
  const medians: Partial<Record<Angle, number>> = {};
  for (const [angle, list] of samples) {
    const median = quantile(
      [...list].sort((a, b) => a - b),
      0.5,
    );
    if (median !== null) medians[angle] = median;
  }
  return medians;
}

/** La posición del reconocimiento cuya lectura coincide con la final (palabras, confiables y confianza). */
function finalIndexByTriple(
  attempts: ReadonlyArray<CommonAttempt>,
  final: { wordCount: number; reliableWordCount: number; pageConfidence: number | null },
): number | null {
  const index = attempts.findIndex(
    (attempt) =>
      attempt.wordCount === final.wordCount &&
      attempt.reliableWordCount === final.reliableWordCount &&
      (attempt.pageConfidence ?? 0) === (final.pageConfidence ?? 0),
  );
  return index < 0 ? null : index;
}

function measuredAngles(attempts: ReadonlyArray<CommonAttempt>) {
  return attempts.map((attempt) => attempt.dispatchedOrientation);
}

// ------------------------------------------------------------------ M-O1

function m1Reading(attempt: AttemptRecord): SimReading {
  return {
    words: attempt.wordCount,
    reliable: attempt.reliableWordCount,
    conf: attempt.pageConfidence ?? 0,
    durationMs: attempt.durationMs,
    ok:
      attempt.allExpectedTokens === null
        ? null
        : attempt.allExpectedTokens && attempt.dniTokenPresent === true,
    body: null,
    stamp: null,
  };
}

function m1Measured(observation: ObservationRecord): MeasuredRun {
  const index = finalIndexByTriple(observation.attempts, observation.final);
  const finalAngle =
    index === null ? null : (observation.attempts[index]?.dispatchedOrientation ?? null);
  return {
    angles: measuredAngles(observation.attempts),
    upscaled: observation.attempts.some((attempt) => attempt.upscale > 1),
    finalAngle,
    final: {
      words: observation.final.wordCount,
      reliable: observation.final.reliableWordCount,
      conf: observation.final.pageConfidence ?? 0,
    },
    unreadable: observation.final.unreadableInk,
    ok: observation.final.expectedDataPresent,
    body: null,
    stamp: null,
    entityCount: 0,
  };
}

/** Las páginas de M-O1: una por PDF, a partir de sus cinco observaciones. */
export function simPagesFromM1(observations: ReadonlyArray<ObservationRecord>): SimPage[] {
  const byKey = new Map<string, ObservationRecord[]>();
  for (const observation of observations) {
    const list = byKey.get(observation.key) ?? [];
    list.push(observation);
    byKey.set(observation.key, list);
  }
  const pages: SimPage[] = [];
  for (const [key, list] of byKey) {
    const head = list[0];
    if (head === undefined) continue;
    const readings: Partial<Record<Angle, SimReading>> = {};
    const measured: Partial<Record<"natural" | Angle, MeasuredRun>> = {};
    for (const observation of list) {
      if (observation.forcedAngle === null) measured.natural = m1Measured(observation);
      else {
        measured[observation.forcedAngle] = m1Measured(observation);
        const first = observation.attempts[0];
        if (first !== undefined) readings[observation.forcedAngle] = m1Reading(first);
      }
    }
    const group: SimGroup = head.set === "old-control" ? "m1-control" : "m1-text";
    pages.push({
      key,
      group,
      label: head.label,
      sourceDpi: head.sourceDpi,
      effectiveDpi: head.effectiveDpi,
      ink: head.natural.inkRatio ?? 0,
      correctAngle: head.correctAngle,
      natural: {
        had: head.natural.osdHadVerdict === true,
        orientation: head.natural.orientation ?? 0,
      },
      readings,
      warmMs: warmMedians(list),
      measured,
    });
  }
  return pages;
}

// ------------------------------------------------------------------ M-O2

function partOk(part: { allTokens: boolean; dniToken: boolean } | null): boolean | null {
  return part === null ? null : part.allTokens && part.dniToken;
}

function m2Reading(attempt: M2Attempt): SimReading {
  return {
    words: attempt.wordCount,
    reliable: attempt.reliableWordCount,
    conf: attempt.pageConfidence ?? 0,
    durationMs: attempt.durationMs,
    ok: null,
    body: partOk(attempt.body),
    stamp: partOk(attempt.stamp),
  };
}

function m2Measured(observation: M2Observation): MeasuredRun {
  const index = observation.finalAttemptOrder;
  const finalAngle =
    index === null ? null : (observation.attempts[index]?.dispatchedOrientation ?? null);
  const entityCount = Object.values(observation.final.entityCounts).reduce((a, b) => a + b, 0);
  const finalPart = (part: { allTokens: boolean; dniEntity: boolean } | null) =>
    part === null ? null : part.allTokens && part.dniEntity;
  return {
    angles: measuredAngles(observation.attempts),
    upscaled: observation.attempts.some((attempt) => attempt.upscale > 1),
    finalAngle,
    final: {
      words: observation.final.wordCount,
      reliable: observation.final.reliableWordCount,
      conf: observation.final.pageConfidence ?? 0,
    },
    unreadable: observation.final.unreadableInk,
    ok: null,
    body: finalPart(observation.final.body),
    stamp: finalPart(observation.final.stamp),
    entityCount,
  };
}

/** Las páginas de M-O2 (ruido, margen y reales). */
export function simPagesFromM2(observations: ReadonlyArray<M2Observation>): SimPage[] {
  const byKey = new Map<string, M2Observation[]>();
  for (const observation of observations) {
    const list = byKey.get(observation.key) ?? [];
    list.push(observation);
    byKey.set(observation.key, list);
  }
  const pages: SimPage[] = [];
  for (const [key, list] of byKey) {
    const head = list[0];
    if (head === undefined) continue;
    const readings: Partial<Record<Angle, SimReading>> = {};
    const measured: Partial<Record<"natural" | Angle, MeasuredRun>> = {};
    for (const observation of list) {
      if (observation.forcedAngle === null) measured.natural = m2Measured(observation);
      else {
        measured[observation.forcedAngle] = m2Measured(observation);
        const first = observation.attempts[0];
        if (first !== undefined) readings[observation.forcedAngle] = m2Reading(first);
      }
    }
    pages.push({
      key,
      group: head.kind,
      label: head.label,
      sourceDpi: head.sourceDpi,
      effectiveDpi: head.effectiveDpi,
      ink: head.natural.inkRatio ?? 0,
      correctAngle: head.correctAngle,
      natural: {
        had: head.natural.osdHadVerdict === true,
        orientation: head.natural.orientation ?? 0,
      },
      readings,
      warmMs: warmMedians(list),
      measured,
    });
  }
  return pages;
}

/** Una página con las cuatro lecturas medidas. */
export function hasAllReadings(page: SimPage): boolean {
  return ANGLES.every((angle) => page.readings[angle] !== undefined);
}
