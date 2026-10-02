import {
  LEAK_CYCLE_COUNT,
  TREND_FIRST_CYCLE,
  type LeakRegime,
} from "../perf/support/leakCycles.js";

interface LeakGateCycle {
  readonly cycle: number;
  readonly ok: boolean | null;
  readonly importToReadyMs: number | null;
  readonly nerModelLoaded: boolean | null;
  readonly rest: { readonly sumBytes: number } | null;
  readonly heap: {
    readonly pageUsedBytes: number | null;
    readonly workerCount: number;
    readonly unreadableCount: number;
  };
}

interface LeakGateReport {
  readonly profile: string;
  readonly regime: LeakRegime;
  readonly cycles: ReadonlyArray<LeakGateCycle>;
  readonly trends: ReadonlyArray<{
    readonly metric: string;
    readonly trend: {
      readonly n: number;
      readonly slope: number;
      readonly slopeStdErr: number | null;
    } | null;
    readonly excludedCycles: ReadonlyArray<number>;
  }>;
  readonly verdict: { readonly workersGrow: boolean; readonly heapGrows: boolean };
}

const REQUIRED_TREND_METRICS = ["workerCount", "heapPageUsedBytes"] as const;

/** Returns all fail-closed data and verdict violations for an ADR-185 run. */
export function leakGateFailures(
  report: LeakGateReport,
  expectedRegime: LeakRegime,
): ReadonlyArray<string> {
  const failures: string[] = [];
  const expectedCount = LEAK_CYCLE_COUNT + 1;
  if (report.regime !== expectedRegime) failures.push("regime mismatch");
  if (report.cycles.length !== expectedCount) failures.push("cycle count incomplete");

  for (let index = 0; index < expectedCount; index += 1) {
    const cycle = report.cycles[index];
    if (cycle === undefined || cycle.cycle !== index) {
      failures.push(`cycle ${index} missing or out of order`);
      continue;
    }
    if (!Number.isFinite(cycle.heap.workerCount) || cycle.heap.workerCount < 0) {
      failures.push(`cycle ${index} worker inventory unreadable`);
    }
    if (index === 0) {
      if (!Number.isFinite(cycle.heap.pageUsedBytes))
        failures.push("baseline main heap unreadable");
      continue;
    }
    if (cycle.ok !== true) failures.push(`cycle ${index} did not complete successfully`);
    if (!Number.isFinite(cycle.importToReadyMs) || (cycle.importToReadyMs ?? 0) <= 0) {
      failures.push(`cycle ${index} is missing a complete pipeline phase`);
    }
    if (!Number.isFinite(cycle.heap.pageUsedBytes)) {
      failures.push(`cycle ${index} main heap unreadable`);
    }
    if (cycle.rest === null || !Number.isFinite(cycle.rest.sumBytes)) {
      failures.push(`cycle ${index} rest window unreadable`);
    }
    if (!Number.isFinite(cycle.heap.unreadableCount) || cycle.heap.unreadableCount < 0) {
      failures.push(`cycle ${index} unreadable target diagnostic missing`);
    }
    if (expectedRegime === "rested" && cycle.heap.workerCount !== 0) {
      failures.push(`cycle ${index} retained workers after rest`);
    }
    if (
      expectedRegime === "chained" &&
      report.profile === "p1-native-10p" &&
      index >= 2 &&
      cycle.nerModelLoaded !== false
    ) {
      failures.push(`cycle ${index} reloaded NER model in chained regime`);
    }
  }

  for (const metric of REQUIRED_TREND_METRICS) {
    const trend = report.trends.find((entry) => entry.metric === metric);
    if (
      trend?.trend === null ||
      trend?.trend === undefined ||
      trend.trend.n !== LEAK_CYCLE_COUNT - TREND_FIRST_CYCLE + 1 ||
      !Number.isFinite(trend.trend.slope) ||
      trend.trend.slopeStdErr === null ||
      !Number.isFinite(trend.trend.slopeStdErr) ||
      trend.excludedCycles.length > 0
    ) {
      failures.push(`${metric} trend incomplete`);
    }
  }

  if (report.verdict.workersGrow) failures.push("workers grew");
  if (report.verdict.heapGrows) failures.push("main heap grew");
  return failures;
}
