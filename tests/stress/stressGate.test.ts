import { describe, expect, it } from "vitest";

import {
  TEXT_200P_ENTITY_PAGE_INDICES,
  TEXT_50P_ENTITY_PAGE_INDICES,
} from "../fixtures/generate.js";

import { evaluateStressGate, type StressProfileRuns } from "./stressGate.js";

const SENTINELS = {
  50: TEXT_50P_ENTITY_PAGE_INDICES,
  200: TEXT_200P_ENTITY_PAGE_INDICES,
} as const;

function profile(pages: 50 | 200, m2: number, duration: number): StressProfileRuns {
  const groups = pages === 50 ? 5 : 20;
  const run = {
    ok: true,
    totalMs: duration,
    peakSumBytes: m2,
    groupCount: groups,
    groupPageIndices: SENTINELS[pages],
    groupPageIndicesComplete: true,
    phaseSegments: [{ measurable: true }],
  };
  return {
    pages,
    identity: {
      commit: "test-build",
      platform: "darwin",
      arch: "arm64",
      cpuModel: "test-cpu",
      cpuCount: 8,
      totalMemBytes: 16_000,
    },
    cold: run,
    hot: run,
  };
}

describe("evaluateStressGate", () => {
  it("accepts scale ratios at or below both guardrails", () => {
    const result = evaluateStressGate(
      profile(50, 100, 100),
      profile(200, 300, 800),
      SENTINELS[50],
      SENTINELS[200],
    );
    expect(result.failures).toEqual([]);
    expect(result.comparisons).toEqual([
      { temperature: "cold", m2Ratio: 3, timeRatio: 8 },
      { temperature: "hot", m2Ratio: 3, timeRatio: 8 },
    ]);
  });

  it("rejects scale ratios above either guardrail", () => {
    const result = evaluateStressGate(
      profile(50, 100, 100),
      profile(200, 301, 801),
      SENTINELS[50],
      SENTINELS[200],
    );
    expect(result.failures).toContain("cold: M2 ratio exceeds 3");
    expect(result.failures).toContain("cold: import time ratio exceeds 8");
    expect(result.comparisons).toHaveLength(2);
  });

  it("fails closed when a profile is incomplete or lacks measurable phase samples", () => {
    const incomplete = profile(200, 200, 200);
    const badRun = { ...incomplete.cold, ok: false, totalMs: null, phaseSegments: [] };
    const result = evaluateStressGate(
      profile(50, 100, 100),
      {
        ...incomplete,
        cold: badRun,
      },
      SENTINELS[50],
      SENTINELS[200],
    );
    expect(result.failures).toContain("200p cold: import failed");
    expect(result.failures).toContain("200p cold: import time unreadable");
    expect(result.failures).toContain("200p cold: no measurable phase window");
    expect(result.comparisons).toEqual([]);
  });

  it("does not compare profiles from different builds or hosts", () => {
    const original = profile(200, 200, 200);
    const differentHost = {
      ...original,
      identity: { ...original.identity, cpuCount: 10 },
    };
    const result = evaluateStressGate(
      profile(50, 100, 100),
      differentHost,
      SENTINELS[50],
      SENTINELS[200],
    );
    expect(result.failures).toContain("profile identities are not comparable");
    expect(result.comparisons).toEqual([]);
  });

  it("rejects a non-finite group count instead of accepting it as sufficient", () => {
    const complete = profile(50, 100, 100);
    const malformed = { ...complete.cold, groupCount: Number.NaN };
    const result = evaluateStressGate(
      { ...complete, cold: malformed },
      profile(200, 200, 200),
      SENTINELS[50],
      SENTINELS[200],
    );
    expect(result.failures).toContain("50p cold: insufficient groups");
    expect(result.comparisons).toEqual([]);
  });

  it("fails cold or hot when the final sentinel page has no known group", () => {
    const profile200 = profile(200, 200, 200);
    const hotWithoutLastPage = {
      ...profile200.hot,
      groupPageIndices:
        profile200.hot.groupPageIndices?.filter((pageIndex) => pageIndex !== 190) ?? [],
    };
    const result = evaluateStressGate(
      profile(50, 100, 100),
      { ...profile200, hot: hotWithoutLastPage },
      SENTINELS[50],
      SENTINELS[200],
    );
    expect(result.failures).toContain("200p hot: missing sentinel pages 190");
    expect(result.comparisons).toEqual([]);
  });
});
