interface StressRunMeasurement {
  readonly ok: boolean;
  readonly totalMs: number | null;
  readonly peakSumBytes: number;
  readonly groupCount: number;
  readonly groupPageIndices?: ReadonlyArray<number>;
  readonly groupPageIndicesComplete?: boolean;
  readonly phaseSegments: ReadonlyArray<{ readonly measurable: boolean }>;
}

export interface StressIdentity {
  readonly commit: string | undefined;
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string | undefined;
  readonly cpuCount: number;
  readonly totalMemBytes: number;
}

export interface StressProfileRuns {
  readonly pages: 50 | 200;
  readonly identity: StressIdentity;
  readonly cold: StressRunMeasurement;
  readonly hot: StressRunMeasurement;
}

export interface StressComparison {
  readonly temperature: "cold" | "hot";
  readonly m2Ratio: number;
  readonly timeRatio: number;
}

export interface StressGateResult {
  readonly failures: ReadonlyArray<string>;
  readonly comparisons: ReadonlyArray<StressComparison>;
}

function runFailures(
  run: StressRunMeasurement,
  pages: 50 | 200,
  temperature: string,
  sentinelPageIndices: ReadonlyArray<number>,
): string[] {
  const failures: string[] = [];
  const label = `${pages}p ${temperature}`;
  const minimumGroups = pages === 50 ? 5 : 20;
  if (!run.ok) failures.push(`${label}: import failed`);
  if (typeof run.totalMs !== "number" || !Number.isFinite(run.totalMs) || run.totalMs <= 0) {
    failures.push(`${label}: import time unreadable`);
  }
  if (!Number.isFinite(run.peakSumBytes) || run.peakSumBytes <= 0) {
    failures.push(`${label}: M2 unreadable`);
  }
  if (!Number.isFinite(run.groupCount) || run.groupCount < minimumGroups) {
    failures.push(`${label}: insufficient groups`);
  }
  if (run.groupPageIndicesComplete !== true || run.groupPageIndices === undefined) {
    failures.push(`${label}: group page coverage unreadable`);
  } else if (
    !run.groupPageIndices.every(
      (pageIndex) => Number.isInteger(pageIndex) && Number.isFinite(pageIndex) && pageIndex >= 0,
    )
  ) {
    failures.push(`${label}: group page coverage unreadable`);
  } else {
    const pagesWithGroups = new Set(run.groupPageIndices);
    const missingPages = sentinelPageIndices.filter((pageIndex) => !pagesWithGroups.has(pageIndex));
    if (missingPages.length > 0) {
      failures.push(`${label}: missing sentinel pages ${missingPages.join(",")}`);
    }
  }
  if (run.phaseSegments.length === 0 || !run.phaseSegments.some((segment) => segment.measurable)) {
    failures.push(`${label}: no measurable phase window`);
  }
  return failures;
}

/** Evaluates the four completed cold/hot profile runs and their relative guards. */
export function evaluateStressGate(
  profile50: StressProfileRuns,
  profile200: StressProfileRuns,
  sentinelPages50: ReadonlyArray<number>,
  sentinelPages200: ReadonlyArray<number>,
): StressGateResult {
  const identityFields: ReadonlyArray<keyof StressIdentity> = [
    "commit",
    "platform",
    "arch",
    "cpuModel",
    "cpuCount",
    "totalMemBytes",
  ];
  if (
    profile50.pages !== 50 ||
    profile200.pages !== 200 ||
    identityFields.some((field) => profile50.identity[field] !== profile200.identity[field])
  ) {
    return { failures: ["profile identities are not comparable"], comparisons: [] };
  }
  const failures = [
    ...runFailures(profile50.cold, 50, "cold", sentinelPages50),
    ...runFailures(profile50.hot, 50, "hot", sentinelPages50),
    ...runFailures(profile200.cold, 200, "cold", sentinelPages200),
    ...runFailures(profile200.hot, 200, "hot", sentinelPages200),
  ];
  if (failures.length > 0) return { failures, comparisons: [] };
  const comparisons: StressComparison[] = [];
  for (const temperature of ["cold", "hot"] as const) {
    const base = profile50[temperature];
    const scaled = profile200[temperature];
    const m2Ratio = scaled.peakSumBytes / base.peakSumBytes;
    const timeRatio = (scaled.totalMs ?? Number.NaN) / (base.totalMs ?? Number.NaN);
    comparisons.push({ temperature, m2Ratio, timeRatio });
    if (!Number.isFinite(m2Ratio) || m2Ratio > 3)
      failures.push(`${temperature}: M2 ratio exceeds 3`);
    if (!Number.isFinite(timeRatio) || timeRatio > 8) {
      failures.push(`${temperature}: import time ratio exceeds 8`);
    }
  }
  return { failures, comparisons };
}
