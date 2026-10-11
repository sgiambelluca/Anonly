/** Pure campaign inventory, privacy projection and paired comparison (ADR-218). */
import type { RunReport } from "./memoryProfile.js";
import type { PageSnapshot, RunSnapshot } from "./osdVerdictM3Collector.js";
import type { RcArm, RcSourceMode } from "./rcIsolatedTransform.js";
import { v1BatchSealReasons } from "./validateSampleIdentity.js";
import { safeV1ErrorName, sanitizeV1Report, V1_BATCH_PATTERN } from "./validateSamplePrivacy.js";
export interface RcId {
  readonly doc: "R1" | "P2N";
  readonly arm: RcArm;
  readonly rep: number;
}
export const rcKey = (id: RcId): string => `${id.doc}-${id.arm}-r${id.rep}`;
export const rcPlan = (): RcId[] =>
  (["R1", "P2N"] as const).flatMap((doc) =>
    [1, 2, 3].flatMap((rep) => (["A", "RC"] as const).map((arm) => ({ doc, rep, arm }))),
  );
export interface RcConflicts {
  readonly available: boolean;
  readonly counts: Readonly<
    Record<
      string,
      { readonly total: number; readonly resolved: number; readonly heldManual: number }
    >
  >;
}
export interface RcSide {
  readonly report: RunReport;
  readonly snapshot: RunSnapshot;
  readonly conflicts: RcConflicts;
}
export interface RcRun extends RcId {
  readonly schema: 1;
  readonly sourceMode: RcSourceMode;
  readonly batchId: string;
  readonly fixtureSha256: string;
  readonly buildSha256: string;
  readonly capturedAtUtc: string;
  readonly cold: RcSide | null;
  readonly hot: RcSide | null;
  readonly failure: "instrument" | "product" | null;
  readonly errorName: string | null;
  readonly productFailureObserved: ReadonlyArray<"cold" | "hot">;
  readonly pendingTemperature?: "hot" | "both" | null;
}
/** Expected control-flow stop only after a completed failed RunReport is preserved. */
export class RcProductStop extends Error {
  constructor(readonly temperature: "cold" | "hot") {
    super("RC observed pipeline failure");
    this.name = "RcProductStop";
  }
}
const ENTITY_TYPES = [
  "PERSON",
  "ORGANIZATION",
  "ADDRESS",
  "DNI",
  "CUIT",
  "PHONE",
  "EMAIL",
  "IBAN",
  "CREDIT_CARD",
  "DATE",
  "LICENSE",
  "PLATE",
  "CUSTOM",
];
const isHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const numeric = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
export function projectRcConflicts(value: RcConflicts): RcConflicts {
  if (typeof value.available !== "boolean") throw new Error("RC invalid conflict availability");
  const counts: Record<string, { total: number; resolved: number; heldManual: number }> = {};
  for (const [key, row] of Object.entries(value.counts)) {
    if (!["overlap", "disagree", "low_confidence", "ambiguous_canonical", "unknown"].includes(key))
      continue;
    if (
      !count(row.total) ||
      !count(row.resolved) ||
      !count(row.heldManual) ||
      row.resolved > row.total ||
      row.heldManual > row.total
    )
      throw new Error("RC invalid numeric conflict counts");
    counts[key] = { total: row.total, resolved: row.resolved, heldManual: row.heldManual };
  }
  return { available: value.available, counts };
}
/** Rebuild every field, then validate the complete remaining string surface. */
export function projectRcSnapshot(snapshot: RunSnapshot): RunSnapshot {
  if (typeof snapshot.observer !== "boolean" || !count(snapshot.ocrPageJobs))
    throw new Error("RC invalid snapshot counts");
  for (const p of snapshot.pages) {
    if (
      !count(p.pageIndex) ||
      typeof p.unreadableInk !== "boolean" ||
      (p.confidence !== null && !numeric(p.confidence)) ||
      Object.values(p.entityCounts).some((v) => !count(v))
    )
      throw new Error("RC invalid page counts");
    for (const o of [p.natural, p.orientation])
      if (
        o !== null &&
        ((o.orientation !== null && ![0, 90, 180, 270].includes(o.orientation)) ||
          (o.inkRatio !== null && (!numeric(o.inkRatio) || o.inkRatio > 1)) ||
          (o.osdHadVerdict !== null && typeof o.osdHadVerdict !== "boolean"))
      )
        throw new Error("RC invalid orientation metadata");
    for (const a of p.attempts)
      if (
        !count(a.order) ||
        !numeric(a.upscale) ||
        [a.dpi, a.durationMs, a.wordCount, a.reliableWordCount, a.confidence].some(
          (v) => v !== null && !numeric(v),
        ) ||
        (a.angle !== null && ![0, 90, 180, 270].includes(a.angle)) ||
        (a.terminal !== null && typeof a.terminal !== "string") ||
        (a.key !== null && typeof a.key !== "string")
      )
        throw new Error("RC invalid attempt metadata");
    if (
      p.delivered !== null &&
      (!count(p.delivered.wordCount) ||
        !count(p.delivered.reliableWordCount) ||
        typeof p.delivered.textSha256 !== "string" ||
        typeof p.delivered.key !== "string")
    )
      throw new Error("RC invalid delivered metadata");
  }
  const pages = snapshot.pages.map((p) => ({
    pageIndex: p.pageIndex,
    natural:
      p.natural === null
        ? null
        : {
            orientation: p.natural.orientation,
            osdHadVerdict: p.natural.osdHadVerdict,
            inkRatio: p.natural.inkRatio,
          },
    orientation:
      p.orientation === null
        ? null
        : {
            orientation: p.orientation.orientation,
            osdHadVerdict: p.orientation.osdHadVerdict,
            inkRatio: p.orientation.inkRatio,
          },
    attempts: p.attempts.map((a) => ({
      order: a.order,
      angle: a.angle,
      upscale: a.upscale,
      dpi: a.dpi,
      terminal: a.terminal,
      durationMs: a.durationMs,
      wordCount: a.wordCount,
      reliableWordCount: a.reliableWordCount,
      confidence: a.confidence,
      key: a.key,
    })),
    delivered:
      p.delivered === null
        ? null
        : {
            wordCount: p.delivered.wordCount,
            reliableWordCount: p.delivered.reliableWordCount,
            textSha256: p.delivered.textSha256,
            key: p.delivered.key,
          },
    confidence: p.confidence,
    unreadableInk: p.unreadableInk,
    entityCounts: Object.fromEntries(
      Object.entries(p.entityCounts).filter(([key]) => ENTITY_TYPES.includes(key)),
    ),
  }));
  const projected = { observer: snapshot.observer, pages, ocrPageJobs: snapshot.ocrPageJobs };
  const inspect = (value: unknown, key = ""): void => {
    if (typeof value === "string") {
      if (key === "terminal" && ["COMPLETED", "FAILED", "CANCELLED"].includes(value)) return;
      if (key === "key" && /^[a-f0-9]{16}$/.test(value)) return;
      if (key === "textSha256" && isHash(value)) return;
      throw new Error("RC private snapshot string refused");
    }
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("RC invalid numeric snapshot");
    if (Array.isArray(value)) value.forEach((child) => inspect(child, key));
    else if (typeof value === "object" && value !== null)
      Object.entries(value).forEach(([field, child]) => inspect(child, field));
  };
  inspect(projected);
  return projected;
}
export function projectRcRun(value: RcRun): RcRun {
  if (
    value.schema !== 1 ||
    (value.sourceMode !== "experimental" && value.sourceMode !== "adopted") ||
    !rcPlan().some((id) => rcKey(id) === rcKey(value)) ||
    !V1_BATCH_PATTERN.test(value.batchId) ||
    !isHash(value.fixtureSha256) ||
    !isHash(value.buildSha256) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.capturedAtUtc) ||
    ![null, "instrument", "product"].includes(value.failure)
  )
    throw new Error("RC invalid run identity");
  if (
    value.failure === null &&
    (value.cold === null ||
      value.hot === null ||
      value.cold.report.ok !== true ||
      value.hot.report.ok !== true)
  )
    throw new Error("RC successful record incomplete");
  const side = (s: RcSide | null): RcSide | null =>
    s === null
      ? null
      : {
          report: sanitizeV1Report(s.report),
          snapshot: projectRcSnapshot(s.snapshot),
          conflicts: projectRcConflicts(s.conflicts),
        };
  return {
    schema: 1,
    sourceMode: value.sourceMode,
    doc: value.doc,
    arm: value.arm,
    rep: value.rep,
    batchId: value.batchId,
    fixtureSha256: value.fixtureSha256,
    buildSha256: value.buildSha256,
    capturedAtUtc: value.capturedAtUtc,
    cold: side(value.cold),
    hot: side(value.hot),
    failure: value.failure,
    errorName:
      value.errorName === null
        ? null
        : safeV1ErrorName(Object.assign(new Error(), { name: value.errorName })),
    productFailureObserved: value.productFailureObserved.filter((t) => t === "cold" || t === "hot"),
    pendingTemperature: value.cold === null ? "both" : value.hot === null ? "hot" : null,
  };
}
export function rcReuseRecord(
  run: RcRun,
  id: RcId,
  buildHash: string,
  fixtureHash: string | undefined,
  seal: unknown,
  sourceMode: RcSourceMode,
): boolean {
  const projected = projectRcRun(run);
  if (
    rcKey(projected) !== rcKey(id) ||
    projected.sourceMode !== sourceMode ||
    projected.buildSha256 !== buildHash ||
    projected.fixtureSha256 !== fixtureHash
  )
    throw new Error("RC existing record identity mismatch");
  return (
    projected.failure !== "instrument" && v1BatchSealReasons(projected.batchId, seal).length === 0
  );
}
export function rcEligibility(page: PageSnapshot): { candidate: boolean; expanded: boolean } {
  const orientation = page.orientation;
  const ink = orientation?.inkRatio;
  const candidate =
    orientation?.osdHadVerdict === false &&
    page.attempts[0]?.wordCount === 0 &&
    typeof ink === "number" &&
    ink > 0;
  return { candidate, expanded: candidate && typeof ink === "number" && ink < 0.002 };
}
/** Smoke-only gate for each natural N1 case. It validates the input predicate and observed chain. */
export function rcN1SmokeIssues(snapshot: RunSnapshot): string[] {
  const issues: string[] = [];
  if (snapshot.pages.length === 0) return ["smoke-N1-page-missing"];
  for (const page of snapshot.pages) {
    const ink = page.orientation?.inkRatio;
    if (JSON.stringify(page.natural) !== JSON.stringify(page.orientation))
      issues.push("smoke-N1-natural-metadata-changed");
    if (page.orientation?.osdHadVerdict !== false || page.attempts[0]?.wordCount !== 0)
      issues.push("smoke-N1-predicate-mismatch");
    if (typeof ink !== "number" || ink <= 0 || ink >= 0.002)
      issues.push("smoke-N1-ink-out-of-range");
    if (
      JSON.stringify(page.attempts.map((attempt) => attempt.angle)) !== "[0,90,180,270]" ||
      page.attempts.some((attempt) => attempt.upscale !== 1)
    )
      issues.push("smoke-N1-chain-mismatch");
  }
  return [...new Set(issues)];
}
export function rcPair(a: Pick<RcSide, "snapshot">, rc: Pick<RcSide, "snapshot">) {
  const issues: string[] = [];
  const pages = a.snapshot.pages.map((page) => {
    const candidate = rc.snapshot.pages.find((p) => p.pageIndex === page.pageIndex);
    const eligible = rcEligibility(page);
    if (candidate === undefined) {
      issues.push("paired-page-missing");
      return null;
    }
    if (
      JSON.stringify(page.natural) !== JSON.stringify(candidate.natural) ||
      JSON.stringify(page.orientation) !== JSON.stringify(candidate.orientation)
    )
      issues.push("natural-orientation-or-ink-changed");
    const dispatch = (p: PageSnapshot) =>
      p.attempts.map((attempt) => [attempt.angle, attempt.upscale, attempt.dpi]);
    if (
      !eligible.expanded &&
      JSON.stringify(dispatch(page)) !== JSON.stringify(dispatch(candidate))
    )
      issues.push("dispatch-changed-outside-expanded-page");
    const extra = candidate.attempts.slice(page.attempts.length);
    if (
      eligible.expanded &&
      (JSON.stringify(candidate.attempts.map((t) => t.angle)) !== "[0,90,180,270]" ||
        candidate.attempts.some((t) => t.upscale !== 1))
    )
      issues.push("expanded-chain-mismatch");
    return {
      pageIndex: page.pageIndex,
      ...eligible,
      additionalDispatchesObserved: candidate.attempts.length - page.attempts.length,
      additionalDurationsMs: extra.map((t) => t.durationMs),
      wordsChanged: page.delivered?.wordCount !== candidate.delivered?.wordCount,
      textHashChanged: page.delivered?.textSha256 !== candidate.delivered?.textSha256,
      entitiesChanged: JSON.stringify(page.entityCounts) !== JSON.stringify(candidate.entityCounts),
      warningChanged: page.unreadableInk !== candidate.unreadableInk,
    };
  });
  return { pages, issues: [...new Set(issues)] };
}
