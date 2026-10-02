import { describe, expect, it } from "vitest";

import { leakGateFailures } from "./leakGate.js";

interface MutableLeakFixture {
  profile: string;
  regime: "chained" | "rested";
  cycles: Array<{
    cycle: number;
    ok: boolean | null;
    importToReadyMs: number | null;
    nerModelLoaded: boolean | null;
    rest: { readonly sumBytes: number } | null;
    heap: { pageUsedBytes: number | null; workerCount: number; unreadableCount: number };
  }>;
  trends: Array<{
    metric: string;
    trend: { n: number; slope: number; slopeStdErr: number | null } | null;
    excludedCycles: number[];
  }>;
  verdict: { workersGrow: boolean; heapGrows: boolean };
}

function healthyReport(): MutableLeakFixture {
  const cycles: MutableLeakFixture["cycles"] = Array.from({ length: 11 }, (_, cycle) => ({
    cycle,
    ok: cycle === 0 ? null : true,
    importToReadyMs: cycle === 0 ? null : 1_000,
    nerModelLoaded: cycle === 1,
    rest: cycle === 0 ? null : { sumBytes: 100 },
    heap: { pageUsedBytes: 200, workerCount: cycle === 0 ? 0 : 3, unreadableCount: 3 },
  }));
  const trends: MutableLeakFixture["trends"] = ["workerCount", "heapPageUsedBytes"].map(
    (metric) => ({
      metric,
      trend: { n: 9, slope: 0, slopeStdErr: 0 },
      excludedCycles: [],
    }),
  );
  return {
    profile: "p1-native-10p",
    regime: "chained" as const,
    cycles,
    trends,
    verdict: { workersGrow: false, heapGrows: false },
  };
}

describe("leakGateFailures", () => {
  it("accepts complete runs with diagnostic unreadable ONNX targets and benign RSS noise", () => {
    expect(leakGateFailures(healthyReport(), "chained")).toEqual([]);
  });

  it("fails closed for a missing cycle, unreadable main heap, and incomplete trend", () => {
    const report = healthyReport();
    report.cycles.splice(5, 1);
    report.cycles[2]!.heap.pageUsedBytes = null;
    report.trends[0]!.trend = { n: 8, slope: 0, slopeStdErr: 0 };
    const failures = leakGateFailures(report, "chained");
    expect(failures).toContain("cycle count incomplete");
    expect(failures).toContain("cycle 2 main heap unreadable");
    expect(failures).toContain("workerCount trend incomplete");
  });

  it("rejects worker or heap growth and missing pipeline completion", () => {
    const report = healthyReport();
    report.cycles[4]!.importToReadyMs = null;
    report.verdict.heapGrows = true;
    report.verdict.workersGrow = true;
    const failures = leakGateFailures(report, "chained");
    expect(failures).toContain("cycle 4 is missing a complete pipeline phase");
    expect(failures).toContain("workers grew");
    expect(failures).toContain("main heap grew");
  });

  it("requires the rested regime to reach zero workers after every cycle", () => {
    const report = healthyReport();
    report.regime = "rested";
    for (const cycle of report.cycles) {
      cycle.heap.workerCount = 0;
      if (cycle.cycle > 1) cycle.nerModelLoaded = true;
    }
    expect(leakGateFailures(report, "rested")).toEqual([]);
    report.cycles[1]!.heap.workerCount = 1;
    expect(leakGateFailures(report, "rested")).toContain("cycle 1 retained workers after rest");
  });
});
