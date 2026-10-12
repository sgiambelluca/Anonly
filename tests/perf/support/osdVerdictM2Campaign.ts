/**
 * M-O2: la campaña como un todo. Puro. Dice qué observaciones se esperan (cinco por página: producción y un
 * veredicto forzado a cada ángulo), revisa que las que hay sean coherentes entre sí (mismo PDF, mismo ráster,
 * mismo DPI, mismo veredicto natural) y arma el resumen con los tres análisis (`osdVerdictM2Analysis.ts`)
 * sobre las observaciones de M-O2 y las de M-O1 (`campana-m-o1`, que se lee y no se toca).
 *
 * Una campaña con observaciones faltantes, repetidas o con issues no se da por buena (`check.complete` es
 * falso y el runner sale con error). Que el resultado no sea el que se quería no es un fallo del instrumento.
 */

import { PHYSICAL_ANGLES, type PhysicalAngle } from "./osdVerdictCorpus.js";
import type { M2Entry } from "./osdVerdictCorpusM2.js";
import {
  analyzeCp,
  analyzeMargin,
  analyzeRc,
  analyzeSv,
  summarizeReal,
  validateSimulation,
  type CpResult,
  type MarginResult,
  type RcResult,
  type RealSummary,
  type SimulationValidation,
  type SvResult,
} from "./osdVerdictM2Analysis.js";
import { m2FileName, m2ObservationIssues, type M2Observation } from "./osdVerdictM2Run.js";
import type { ObservationRecord } from "./osdVerdictRun.js";
import { ANGLES, type Angle, type SimPage } from "./osdVerdictSim.js";
import { simPagesFromM1, simPagesFromM2 } from "./osdVerdictSimPages.js";

export const OBSERVATIONS_PER_PAGE = 1 + PHYSICAL_ANGLES.length;

export interface ExpectedM2 {
  readonly key: string;
  readonly forcedAngle: PhysicalAngle | null;
  readonly file: string;
}

export function expectedM2(entries: ReadonlyArray<M2Entry>): ReadonlyArray<ExpectedM2> {
  return entries.flatMap((entry) =>
    [null, ...PHYSICAL_ANGLES].map((forcedAngle) => ({
      key: entry.key,
      forcedAngle,
      file: m2FileName(entry.key, forcedAngle),
    })),
  );
}

const idOf = (key: string, forcedAngle: number | null): string => `${key}|${forcedAngle ?? "prod"}`;
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface M2Check {
  readonly expectedPages: number;
  readonly expectedObservations: number;
  readonly completedObservations: number;
  readonly complete: boolean;
  readonly missing: ReadonlyArray<string>;
  readonly unexpected: ReadonlyArray<string>;
  readonly duplicated: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<{ readonly id: string; readonly issue: string }>;
  readonly warnings: ReadonlyArray<{ readonly id: string; readonly warning: string }>;
}

export function checkM2(
  observations: ReadonlyArray<M2Observation>,
  entries: ReadonlyArray<M2Entry>,
  pdfHashes: Readonly<Record<string, string>> = {},
): M2Check {
  const expected = expectedM2(entries);
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
    for (const issue of m2ObservationIssues(observation))
      if (!observation.issues.includes(issue)) issues.push({ id, issue: `al revisar: ${issue}` });
    const entry = entryByKey.get(observation.key);
    if (
      entry !== undefined &&
      (entry.kind !== observation.kind ||
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

  const byPage = new Map<string, M2Observation[]>();
  for (const observation of observations) {
    const list = byPage.get(observation.key) ?? [];
    list.push(observation);
    byPage.set(observation.key, list);
  }
  for (const [key, list] of byPage) {
    const [head, ...rest] = list;
    if (head === undefined) continue;
    const headFirst = head.attempts[0];
    for (const other of rest) {
      const id = idOf(key, other.forcedAngle);
      const otherFirst = other.attempts[0];
      if (other.fixtureSha256 !== head.fixtureSha256)
        issues.push({ id, issue: "las observaciones de una página no usaron el mismo archivo" });
      if (
        headFirst !== undefined &&
        otherFirst !== undefined &&
        (headFirst.imageSha256 !== otherFirst.imageSha256 ||
          headFirst.dpi !== otherFirst.dpi ||
          headFirst.widthPx !== otherFirst.widthPx ||
          headFirst.heightPx !== otherFirst.heightPx ||
          headFirst.imageBytes !== otherFirst.imageBytes)
      )
        issues.push({
          id,
          issue: "las lecturas de una página no se hicieron sobre el mismo ráster",
        });
      if (!sameJson(head.natural, other.natural))
        warnings.push({ id, warning: "el veredicto natural del OSD cambió entre observaciones" });
      if (!sameJson(head.rawOsd, other.rawOsd))
        warnings.push({ id, warning: "el OSD crudo cambió entre observaciones" });
    }
  }
  return {
    expectedPages: entries.length,
    expectedObservations: expected.length,
    completedObservations: observations.length,
    complete:
      missing.length === 0 &&
      unexpected.length === 0 &&
      duplicated.length === 0 &&
      issues.length === 0,
    missing,
    unexpected,
    duplicated,
    issues,
    warnings,
  };
}

// ------------------------------------------------------------------ resumen

export interface NoiseRow {
  readonly key: string;
  readonly label: string;
  readonly sourceDpi: number | null;
  readonly rotation: number;
  readonly ink: number;
  /** Por ángulo: palabras, palabras confiables, confianza de página y tiempo de la primera lectura. */
  readonly readings: Readonly<
    Record<
      string,
      {
        readonly words: number;
        readonly reliable: number;
        readonly conf: number;
        readonly ms: number | null;
      }
    >
  >;
  /** Producción: lecturas que hizo, si avisó de página ilegible y qué entidades salieron. */
  readonly productionReadings: number;
  readonly productionUnreadable: boolean;
  readonly productionEntities: number;
}

export interface M2Summary {
  readonly check: M2Check;
  readonly realDocs: ReadonlyArray<string>;
  readonly validation: SimulationValidation;
  readonly noiseRows: ReadonlyArray<NoiseRow>;
  readonly rc: RcResult;
  readonly cp: CpResult;
  readonly sv: SvResult;
  readonly margin: MarginResult;
  readonly real: { readonly R1: RealSummary | null; readonly "R2 a R4": RealSummary | null };
}

function noiseRowsOf(pages: ReadonlyArray<SimPage>): NoiseRow[] {
  return pages
    .filter((page) => page.group === "noise")
    .map((page) => {
      const readings: Record<
        string,
        { words: number; reliable: number; conf: number; ms: number | null }
      > = {};
      for (const angle of ANGLES) {
        const reading = page.readings[angle];
        if (reading !== undefined)
          readings[String(angle)] = {
            words: reading.words,
            reliable: reading.reliable,
            conf: reading.conf,
            ms: reading.durationMs,
          };
      }
      const production = page.measured.natural;
      return {
        key: page.key,
        label: page.label,
        sourceDpi: page.sourceDpi,
        rotation: page.correctAngle === null ? 0 : (360 - page.correctAngle) % 360,
        ink: page.ink,
        readings,
        productionReadings: production?.angles.length ?? 0,
        productionUnreadable: production?.unreadable ?? false,
        productionEntities: production?.entityCount ?? 0,
      };
    });
}

export function summarizeM2(input: {
  readonly m1: ReadonlyArray<ObservationRecord>;
  readonly m2: ReadonlyArray<M2Observation>;
  readonly entries: ReadonlyArray<M2Entry>;
  readonly pdfHashes?: Readonly<Record<string, string>>;
}): M2Summary {
  const pages = [...simPagesFromM1(input.m1), ...simPagesFromM2(input.m2)].filter((page) =>
    ANGLES.every((angle) => page.readings[angle as Angle] !== undefined),
  );
  const realPages = (set: "R1" | "R2 a R4") =>
    pages.filter(
      (page) => page.group === "real" && (set === "R1" ? page.label === "R1" : page.label !== "R1"),
    );
  const summarizeSet = (set: "R1" | "R2 a R4"): RealSummary | null => {
    const list = realPages(set);
    return list.length === 0 ? null : summarizeReal(list);
  };
  return {
    check: checkM2(input.m2, input.entries, input.pdfHashes ?? {}),
    realDocs: [...new Set(input.entries.filter((e) => e.kind === "real").map((e) => e.label))],
    validation: validateSimulation(pages),
    noiseRows: noiseRowsOf(pages),
    rc: analyzeRc(pages),
    cp: analyzeCp(pages),
    sv: analyzeSv(pages),
    margin: analyzeMargin(pages),
    real: { R1: summarizeSet("R1"), "R2 a R4": summarizeSet("R2 a R4") },
  };
}
