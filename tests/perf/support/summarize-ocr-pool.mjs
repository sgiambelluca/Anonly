#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [outputArg, ...sourceArgs] = process.argv.slice(2);
if (outputArg === undefined || sourceArgs.length === 0) {
  throw new Error("Uso: summarize-ocr-pool.mjs <output-dir> <source-dir> [source-dir ...]");
}

const outputDir = resolve(outputArg);
const sources = sourceArgs.map((dir) => resolve(dir));
const invalidBySource = new Map(
  sources.map((dir) => {
    const file = join(dir, "validity.json");
    const invalid = existsSync(file)
      ? new Set(JSON.parse(readFileSync(file, "utf8")).affectedRunIds ?? [])
      : new Set();
    return [dir, invalid];
  }),
);

function readRun(kind, arm, profile, round) {
  const id = `${kind}-${arm}-${profile}-r${round}`;
  for (const dir of sources) {
    if (invalidBySource.get(dir)?.has(id)) continue;
    const file = join(dir, `ocr-pool-${id}.json`);
    if (existsSync(file)) {
      return { data: JSON.parse(readFileSync(file, "utf8")), source: basename(dir) };
    }
  }
  return null;
}

const arms = ["2", "3", "4"];
const profiles = ["P1", "P2", "R1", "R2"];
const summary = {
  generatedAtUtc: new Date().toISOString(),
  sources: sources.map((dir) => basename(dir)),
  time: {},
  memory: {},
  cancellation: {},
  excludedInvalidatedRunIds: [
    ...new Set([...invalidBySource.values()].flatMap((set) => [...set])),
  ].sort(),
  missingRuns: [],
};
let exact = true;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const distribution = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (percentile) =>
    sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1)]
      : null;
  return sorted.length
    ? {
        median: sorted[Math.floor(sorted.length / 2)],
        p90: at(0.9),
        p95: at(0.95),
        min: sorted[0],
        max: sorted[sorted.length - 1],
      }
    : null;
};

for (const profile of profiles) {
  const byArm = new Map();
  for (const arm of arms) {
    const runs = [0, 1, 2].map((round) => readRun("time", arm, profile, round));
    for (let round = 0; round < runs.length; round += 1) {
      if (runs[round] === null) summary.missingRuns.push(`time-${arm}-${profile}-r${round}`);
    }
    const present = runs.filter((run) => run !== null);
    byArm.set(arm, runs);
    const totals = present.map(({ data }) => data.timed?.totalMs).filter(Number.isFinite);
    const ocrTimes = present
      .map(({ data }) => data.timed?.intervalsMs?.ocrMs)
      .filter(Number.isFinite);
    summary.time[`${profile}-${arm}`] = {
      runs: present.map(({ data, source }) => ({
        runId: data.runId,
        source,
        startedAtUtc: data.startedAtUtc,
        totalMs: data.timed?.totalMs,
        ocrMs: data.timed?.intervalsMs?.ocrMs,
        ocrBusyPeak: data.probe.effectiveBusyRecognizersPeak,
        osdBusyPeak: data.probe.effectiveBusyOsdPeak,
        requestWindow: data.probe.requestedConcurrentRequestsByContract,
        ocrPages: data.probe.ocrPageCount,
        totalOcrWords: data.probe.totalOcrWords,
        totalOcrCharacters: data.probe.totalOcrCharacters,
        pageCount: data.probe.pageParsed.length,
        pagesWithoutText: data.probe.textlessPageCount,
        requiresOcrPageCount: data.probe.requiresOcrPageCount,
        pageParsedWordCount: distribution(data.probe.pageParsed.map((page) => page.wordCount)),
        ocrWordsPerPage: data.probe.ocrWordCountByPage,
        ocrCharactersPerPage: data.probe.ocrCharacterCountByPage,
        nerOccurrencesPerPage: distribution(
          data.probe.nerJobsByPage.map((page) => page.occurrenceCount),
        ),
        rgbaEstimatesObservable:
          data.probe.pageRgbaEstimates.length > 0 &&
          data.probe.pageRgbaEstimates.every((page) => Number.isFinite(page.estimatedBytes)),
        maxSinglePageRgbaEstimateBytes:
          data.probe.pageRgbaEstimates.length > 0 &&
          data.probe.pageRgbaEstimates.every((page) => Number.isFinite(page.estimatedBytes))
            ? data.probe.maxSinglePageRgbaEstimateBytes
            : null,
        rgbaWindowPeakBytes:
          data.probe.pageRgbaEstimates.length > 0 &&
          data.probe.pageRgbaEstimates.every((page) => Number.isFinite(page.estimatedBytes))
            ? data.probe.estimatedReservationWindowPeakBytes
            : null,
        configuredImageBudgetBytes: data.probe.effectiveMaxLiveImageBytes,
        budgetWaitObservable: false,
        budgetWaitObserved: null,
        workerQueueSaturationCount: data.probe.workerPoolSaturationEvents?.length,
      })),
      medianTotalMs: median(totals),
      rangeTotalMs: totals.length ? [Math.min(...totals), Math.max(...totals)] : null,
      medianOcrMs: median(ocrTimes),
    };
  }

  for (const arm of ["3", "4"]) {
    for (let round = 0; round < 3; round += 1) {
      const base = byArm.get("2")?.[round]?.data.probe;
      const candidate = byArm.get(arm)?.[round]?.data.probe;
      if (base === undefined || candidate === undefined) {
        exact = false;
        continue;
      }
      for (const key of ["ocrQualitySha256", "occurrenceSha256", "groupSha256"]) {
        if (candidate[key] !== base[key]) exact = false;
      }
    }
  }
}

for (const profile of ["P2", "R2"]) {
  const byArm = new Map();
  for (const arm of arms) {
    const runs = [0, 1, 2].map((round) => readRun("memory", arm, profile, round));
    byArm.set(arm, runs);
    for (let round = 0; round < runs.length; round += 1) {
      if (runs[round] === null) summary.missingRuns.push(`memory-${arm}-${profile}-r${round}`);
    }
    summary.memory[`${profile}-${arm}`] = runs
      .filter((run) => run !== null)
      .map(({ data, source }) => ({
        runId: data.runId,
        source,
        startedAtUtc: data.startedAtUtc,
        cold: {
          totalMs: data.report?.cold?.totalMs,
          ocrMs: data.report?.cold?.ocrDurationMs,
          phasePeakSumBytes: data.report?.cold?.peakSumBytes,
          baselineBytes: data.report?.cold?.baselineBytes,
          postReadyPeakBytes: data.report?.cold?.postReadyPeakBytes,
          rssPeakDuringOcrBytes: data.report?.cold?.rssPeakDuringOcrBytes,
          m1Bytes: data.report?.cold?.m1Bytes,
          workerPeakByType: data.report?.cold?.workerPeakByType,
          busyRecognizerPeak: data.memoryRuns.find((run) => run.temperature === "cold")?.probe
            .effectiveBusyRecognizersPeak,
        },
        hot: {
          totalMs: data.report?.hot?.totalMs,
          ocrMs: data.report?.hot?.ocrDurationMs,
          phasePeakSumBytes: data.report?.hot?.peakSumBytes,
          baselineBytes: data.report?.hot?.baselineBytes,
          postReadyPeakBytes: data.report?.hot?.postReadyPeakBytes,
          rssPeakDuringOcrBytes: data.report?.hot?.rssPeakDuringOcrBytes,
          m1Bytes: data.report?.hot?.m1Bytes,
          workerPeakByType: data.report?.hot?.workerPeakByType,
          busyRecognizerPeak: data.memoryRuns.find((run) => run.temperature === "hot")?.probe
            .effectiveBusyRecognizersPeak,
        },
      }));
  }

  for (const arm of ["3", "4"]) {
    for (let round = 0; round < 3; round += 1) {
      const base = byArm.get("2")?.[round]?.data.memoryRuns;
      const candidate = byArm.get(arm)?.[round]?.data.memoryRuns;
      if (base === undefined || candidate === undefined) {
        exact = false;
        continue;
      }
      for (const temperature of ["cold", "hot"]) {
        const baseProbe = base.find((run) => run.temperature === temperature)?.probe;
        const comparedProbe = candidate.find((run) => run.temperature === temperature)?.probe;
        for (const key of ["ocrQualitySha256", "occurrenceSha256", "groupSha256"]) {
          if (baseProbe?.[key] !== comparedProbe?.[key]) exact = false;
        }
      }
    }
  }
}

for (const profile of ["P2", "R2"]) {
  for (const arm of arms) {
    const result = readRun("cancel", arm, profile, 0);
    if (result === null) {
      summary.missingRuns.push(`cancel-${arm}-${profile}-r0`);
      continue;
    }
    summary.cancellation[`${profile}-${arm}`] = {
      runId: result.data.runId,
      source: result.source,
      activeJobsAtCancellation: result.data.probe.cancelActiveOcrJobs,
      cancelLatencyMs: result.data.probe.cancelLatencyMs,
    };
  }
}

summary.qualityExactAcrossArms = exact;
summary.complete = summary.missingRuns.length === 0 && exact;
const outputFile = join(outputDir, "summary.json");
writeFileSync(outputFile, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ summaryPath: outputFile, complete: summary.complete, missingRuns: summary.missingRuns.length, qualityExactAcrossArms: exact }, null, 2)}\n`,
);
if (!summary.complete) process.exitCode = 1;
