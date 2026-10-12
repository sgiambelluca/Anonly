import { describe, expect, it } from "vitest";

import { makePage, makeRunReport } from "./osdVerdictM3TestSupport.js";
import {
  projectRcSnapshot,
  projectRcConflicts,
  projectRcRun,
  rcReuseRecord,
  rcEligibility,
  rcN1SmokeIssues,
  rcPair,
  rcPlan,
  rcKey,
} from "./rcIsolatedCampaign.js";
describe("RC campaign semantics", () => {
  it("reuses only identity-matched sealed product outcomes and repeats instrument-invalid rows", () => {
    const run = {
      schema: 1 as const,
      sourceMode: "adopted" as const,
      doc: "R1" as const,
      arm: "A" as const,
      rep: 1,
      batchId: "tanda-20261010T000000Z-1",
      fixtureSha256: "a".repeat(64),
      buildSha256: "b".repeat(64),
      capturedAtUtc: "2026-10-10T00:00:00.000Z",
      cold: {
        report: makeRunReport({ ok: false, phases: { DOCUMENT_IMPORTED: 1, PIPELINE_FAILED: 10 } }),
        snapshot: { observer: true, pages: [], ocrPageJobs: 0 },
        conflicts: { available: false, counts: {} },
      },
      hot: null,
      failure: "product" as const,
      errorName: null,
      productFailureObserved: ["cold" as const],
    };
    const seal = {
      schema: 1,
      batchId: run.batchId,
      state: "finished",
      detectionConfirmedAtStart: true,
      detectionConfirmedAtEnd: true,
      sleepWakeEventObserved: false,
      invalidReason: null,
    };
    expect(rcReuseRecord(run, run, run.buildSha256, run.fixtureSha256, seal, "adopted")).toBe(true);
    expect(
      rcReuseRecord(
        run,
        run,
        run.buildSha256,
        run.fixtureSha256,
        {
          ...seal,
          detectionConfirmedAtEnd: false,
        },
        "adopted",
      ),
    ).toBe(false);
    expect(
      rcReuseRecord(
        { ...run, failure: "instrument" },
        run,
        run.buildSha256,
        run.fixtureSha256,
        seal,
        "adopted",
      ),
    ).toBe(false);
    expect(() =>
      rcReuseRecord(run, { ...run, rep: 2 }, run.buildSha256, run.fixtureSha256, seal, "adopted"),
    ).toThrow("identity mismatch");
    expect(() =>
      rcReuseRecord(run, run, "c".repeat(64), run.fixtureSha256, seal, "adopted"),
    ).toThrow("identity mismatch");
    expect(() =>
      rcReuseRecord(run, run, run.buildSha256, run.fixtureSha256, seal, "experimental"),
    ).toThrow("identity mismatch");
    expect(() => projectRcRun({ ...run, rep: 4 })).toThrow("invalid run identity");
    expect(() => projectRcRun({ ...run, failure: null })).toThrow("successful record incomplete");
  });
  it("rejects private strings and impossible conflict counts on reread", () => {
    for (const field of ["total", "resolved", "heldManual"])
      expect(() =>
        projectRcConflicts({
          available: true,
          counts: {
            disagree: JSON.parse(
              JSON.stringify({ total: 3, resolved: 0, heldManual: 0, [field]: "PRIVATE-PATH" }),
            ) as { total: number; resolved: number; heldManual: number },
          },
        }),
      ).toThrow("invalid numeric conflict counts");
    expect(() =>
      projectRcConflicts({
        available: true,
        counts: { disagree: { total: 1, resolved: 2, heldManual: 0 } },
      }),
    ).toThrow();
  });
  it("keeps product failure observed without manufacturing Ready or hot costs", () => {
    const report = makeRunReport({
      ok: false,
      phases: { DOCUMENT_IMPORTED: 1, PIPELINE_FAILED: 10 },
      readyAtMs: 20,
      readyDurationMs: 19,
      totalMs: 19,
      postReadyPeakBytes: 200,
    });
    const result = projectRcRun({
      schema: 1,
      sourceMode: "adopted",
      doc: "R1",
      arm: "A",
      rep: 1,
      batchId: "tanda-20261010T000000Z-1",
      fixtureSha256: "a".repeat(64),
      buildSha256: "b".repeat(64),
      capturedAtUtc: "2026-10-10T00:00:00.000Z",
      cold: {
        report,
        snapshot: { observer: true, pages: [], ocrPageJobs: 0 },
        conflicts: { available: false, counts: {} },
      },
      hot: null,
      failure: "product",
      errorName: null,
      productFailureObserved: ["cold"],
    });
    expect(result.cold?.report.readyDurationMs).toBeNull();
    expect(result.cold?.report.postReadyPeakBytes).toBeNull();
    expect(result.hot).toBeNull();
    expect(result.productFailureObserved).toEqual(["cold"]);
  });
  it("has twelve unique interleaved repeatable IDs", () => {
    const plan = rcPlan();
    expect(new Set(plan.map(rcKey)).size).toBe(12);
    expect(plan.slice(0, 4).map(rcKey)).toEqual(["R1-A-r1", "R1-RC-r1", "R1-A-r2", "R1-RC-r2"]);
  });
  it("distinguishes all candidates from actual expansion below the existing threshold", () => {
    const page = (ink: number, words = 0) =>
      makePage("A", 0, { ink, words, naturalVerdict: false });
    expect(rcEligibility(page(0))).toEqual({ candidate: false, expanded: false });
    expect(rcEligibility(page(0.000489))).toEqual({ candidate: true, expanded: true });
    expect(rcEligibility(page(0.002))).toEqual({ candidate: true, expanded: false });
    expect(rcEligibility(page(0.000489, 1))).toEqual({ candidate: false, expanded: false });
  });
  it("requires the natural N1 predicate, ink range, and exact four-angle unit-scale chain", () => {
    const page = makePage("A", 0, {
      ink: 0.001,
      naturalVerdict: false,
      words: 0,
      angles: [0, 90, 180, 270],
    });
    const snapshot = { observer: true, pages: [page], ocrPageJobs: page.attempts.length };
    expect(rcN1SmokeIssues(snapshot)).toEqual([]);
    expect(
      rcN1SmokeIssues({
        ...snapshot,
        pages: [
          {
            ...page,
            orientation: { ...page.orientation!, inkRatio: 0.002 },
            attempts: page.attempts.map((attempt, index) => ({
              ...attempt,
              wordCount: index === 0 ? 1 : attempt.wordCount,
              upscale: index === 2 ? 2 : attempt.upscale,
            })),
          },
        ],
      }),
    ).toEqual([
      "smoke-N1-natural-metadata-changed",
      "smoke-N1-predicate-mismatch",
      "smoke-N1-ink-out-of-range",
      "smoke-N1-chain-mismatch",
    ]);
  });
  it("reports observed extra dispatches and refuses changes on ineligible pages", () => {
    const a = makePage("A", 0, { ink: 0, words: 0, naturalVerdict: false });
    const b = makePage("A", 0, { ink: 0, words: 0, naturalVerdict: false, angles: [0, 90] });
    const side = (page: typeof a) => ({
      snapshot: { observer: true, pages: [page], ocrPageJobs: page.attempts.length },
    });
    // rcPair only reads snapshots, rather than inventing dispatches from eligibility.
    const result = rcPair(side(a), side(b));
    expect(result.pages[0]?.additionalDispatchesObserved).toBe(1);
    expect(result.issues).toContain("dispatch-changed-outside-expanded-page");
  });
  it("rejects text masquerading as transport hashes and removes unrecognized fields", () => {
    const page = makePage("A", 0);
    expect(() => projectRcSnapshot({ observer: true, pages: [page], ocrPageJobs: 1 })).toThrow(
      "private snapshot",
    );
    const safe = {
      ...page,
      attempts: page.attempts.map((a) => ({ ...a, key: "a".repeat(16) })),
      delivered: { ...page.delivered!, key: "a".repeat(16), textSha256: "b".repeat(64) },
      entityCounts: { DNI: 1, "PRIVATE-FILENAME": 99 },
    };
    const result = projectRcSnapshot({
      observer: true,
      pages: [Object.assign(safe, { private: "PRIVATE-TEXT" })],
      ocrPageJobs: 1,
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});
