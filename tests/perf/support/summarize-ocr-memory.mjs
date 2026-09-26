/** Fail closed: all 36 reports and all 54 complete end-stage snapshots are required. */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("Measurement directory required");
const read = (name) => JSON.parse(readFileSync(resolve(directory, name), "utf8"));
if (existsSync(resolve(directory, "validity.json")) && read("validity.json").affectedRunIds.length)
  throw new Error("Invalid runs present");
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const stats = (values) => {
  if (!values.length || values.some((value) => !Number.isFinite(value)))
    throw new Error("Missing numeric observations");
  return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
};
const qualityKeys = ["ocrQualitySha256", "occurrenceSha256", "groupSha256"];
const result = {
  units: "bytes",
  allReports: 36,
  allSnapshots: 54,
  complete: true,
  qualityExact: true,
  corpora: {},
};
for (const profile of ["P2", "R2"]) {
  const references = [0, 1, 2].map(
    (round) => read(`ocr-pool-pool-rss-2-${profile}-r${round}.json`).probe,
  );
  const arms = {};
  for (const arm of [2, 3, 4]) {
    const natural = [];
    const snapshots = [];
    const holds = [];
    const durations = [];
    for (const round of [0, 1, 2]) {
      for (const phase of ["pool-rss", "pool-endstage"]) {
        const report = read(`ocr-pool-${phase}-${arm}-${profile}-r${round}.json`);
        if (
          report.phase !== phase ||
          report.arm !== arm ||
          report.profile !== profile ||
          report.round !== round ||
          report.probe.failed ||
          report.probe.ocrPageFailures !== 0 ||
          report.probe.missingWordCachePages !== 0 ||
          report.probe.effectiveBusyRecognizersPeak !== arm ||
          report.probe.effectiveBusyOsdPeak !== 1 ||
          report.probe.effectiveMaxLiveImageBytes !== 128 * 1024 * 1024
        )
          throw new Error("Invalid run identity or pipeline evidence");
        if (
          qualityKeys.some(
            (key) =>
              typeof report.probe[key] !== "string" || report.probe[key] !== references[round][key],
          )
        )
          throw new Error("Quality differs from paired OCR2 control");
        if (phase === "pool-rss") {
          if (!report.natural.samples.length) throw new Error("RSS series missing");
          const actualPeak = Math.max(
            ...report.natural.samples.map((sample) => sample.sumWorkingSetSizeBytes),
          );
          if (actualPeak !== report.natural.rssPeakDuringOcrBytes)
            throw new Error("RSS peak mismatch");
          natural.push(actualPeak);
          durations.push(report.probe.finishedAt - report.probe.startedAt);
        } else {
          const hold = report.endStage.releasedAtMs - report.endStage.heldAtMs;
          if (hold <= 0 || hold >= 10_000 || report.endStage.snapshots.length !== 3)
            throw new Error("Invalid barrier");
          holds.push(hold);
          for (const sample of report.endStage.snapshots) {
            if (
              !sample.summary.complete ||
              sample.summary.lstmBytes.length !== arm ||
              sample.startedAtMs < report.endStage.heldAtMs ||
              sample.finishedAtMs > report.endStage.releasedAtMs
            )
              throw new Error("Incomplete end-stage coverage");
            const lstm = sample.wasm.filter((target) => target.label.endsWith("/tesseract-lstm"));
            const osd = sample.wasm.filter((target) => target.label.endsWith("/tesseract-osd"));
            const privateMemory = (target) =>
              target.readError === undefined &&
              target.memories?.length === 1 &&
              target.memories[0].shared === false &&
              Number.isFinite(target.memories[0].byteLengthBytes) &&
              target.memories[0].byteLengthBytes > 0;
            if (
              lstm.length !== arm ||
              osd.length !== 1 ||
              ![...lstm, ...osd].every(privateMemory) ||
              sample.wasm.some(
                (target) => target.readError !== undefined || target.memories === undefined,
              ) ||
              sample.heap.some(
                (target) =>
                  target.readError !== undefined || !Number.isFinite(target.usedSizeBytes),
              )
            )
              throw new Error("Raw target evidence incomplete");
            const lstmBytes = lstm.map((target) => target.memories[0].byteLengthBytes);
            const lstmTotal = lstmBytes.reduce((sum, value) => sum + value, 0);
            const wasmTotal = sample.wasm
              .flatMap((target) => target.memories)
              .reduce((sum, memory) => sum + memory.byteLengthBytes, 0);
            const heapTotal = sample.heap.reduce((sum, target) => sum + target.usedSizeBytes, 0);
            if (
              JSON.stringify(lstmBytes) !== JSON.stringify(sample.summary.lstmBytes) ||
              lstmTotal !== sample.summary.lstmTotalBytes ||
              wasmTotal !== sample.summary.wasmTotalBytes ||
              heapTotal !== sample.summary.heapJsUsedBytes ||
              osd[0].memories[0].byteLengthBytes !== sample.summary.osdBytes
            )
              throw new Error("Summary differs from raw targets");
            snapshots.push(sample);
          }
        }
      }
    }
    arms[arm] = {
      rssPeakDuringOcrBytes: stats(natural),
      ocrNaturalDurationMs: stats(durations),
      lstmPerWorkerBytes: stats(snapshots.flatMap((sample) => sample.summary.lstmBytes)),
      lstmTotalBytes: stats(snapshots.map((sample) => sample.summary.lstmTotalBytes)),
      osdBytes: stats(snapshots.map((sample) => sample.summary.osdBytes)),
      wasmTotalBytes: stats(snapshots.map((sample) => sample.summary.wasmTotalBytes)),
      heapJsUsedBytes: stats(snapshots.map((sample) => sample.summary.heapJsUsedBytes)),
      barrierMs: stats(holds),
      snapshotDurationMs: stats(
        snapshots.map((sample) => sample.finishedAtMs - sample.startedAtMs),
      ),
      naturalRssPeaksBytes: natural,
      roundLstmTotalsBytes: [0, 1, 2].map((round) => snapshots[round * 3].summary.lstmTotalBytes),
    };
  }
  const increments = [
    arms[3].lstmTotalBytes.median - arms[2].lstmTotalBytes.median,
    arms[4].lstmTotalBytes.median - arms[3].lstmTotalBytes.median,
  ];
  result.corpora[profile] = {
    arms,
    lstmMedianIncrementsBytes: increments,
    medianIncrementExactlyConstant: increments[0] === increments[1],
  };
}
writeFileSync(resolve(directory, "summary.json"), `${JSON.stringify(result, null, 2)}\n`, {
  flag: "wx",
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
