import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  aggregateNerGapsReports,
  compareNerGapsPreflight,
  expectedNerGapsRunIds,
  NER_GAPS_ARMS,
} from "./nerGaps.js";
import {
  decodeNerGapsReport,
  decodeNerGapsThreadObservation,
  validateNerGapsReportConsistency,
} from "./nerGapsDecode.js";
import type { NerGapsReport } from "./nerGapsTypes.js";

async function readReport(path: string, expectedRunId: string): Promise<NerGapsReport> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const report = decodeNerGapsReport(parsed, expectedRunId);
  if (report === null)
    throw new Error(`Reporte NER gaps con esquema o identidad inválida: ${expectedRunId}`);
  return report;
}

async function readReportIfValid(
  path: string,
  label: string,
  reasons: string[],
): Promise<NerGapsReport | undefined> {
  try {
    return await readReport(path, label);
  } catch {
    reasons.push(`missing-or-invalid-report-${label}`);
    return undefined;
  }
}

async function digestText(path: string): Promise<string> {
  return (await readFile(path, "utf8")).trim();
}

async function main(): Promise<void> {
  const outputDir = resolve(process.env.ANONLY_NER_GAPS_OUTPUT_DIR ?? "");
  if (outputDir === resolve(".")) throw new Error("ANONLY_NER_GAPS_OUTPUT_DIR obligatorio.");
  const preflightIds = NER_GAPS_ARMS.flatMap((arm) => [
    `preflight-${arm}-P1`,
    `preflight-${arm}-P2`,
  ]);
  const reasons: string[] = [];
  const preflightMaybe = await Promise.all(
    preflightIds.map((id) =>
      readReportIfValid(resolve(outputDir, `ner-gaps-${id}.json`), id, reasons),
    ),
  );
  const preflight = preflightMaybe.filter(
    (report): report is NerGapsReport => report !== undefined,
  );
  const preflightValidation = compareNerGapsPreflight(preflight);
  reasons.push(...preflightValidation.reasons.map((reason) => `preflight-${reason}`));
  reasons.push(...validateNerGapsReportConsistency(preflight));
  if (process.env.ANONLY_NER_GAPS_AGGREGATE_MODE === "preflight") {
    const preflightResult = {
      schemaVersion: 1,
      valid: reasons.length === 0,
      reasons: [...new Set(reasons)],
      reportCount: preflight.length,
    };
    const target = resolve(outputDir, "ner-gaps-preflight.json");
    await writeFile(target, `${JSON.stringify(preflightResult, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${preflightResult.valid ? "VALID" : "INVALID"}: ${target}\n`);
    if (!preflightResult.valid) process.exitCode = 1;
    return;
  }
  const timingIds = expectedNerGapsRunIds();
  const timingMaybe = await Promise.all(
    timingIds.map((id) =>
      readReportIfValid(resolve(outputDir, `ner-gaps-${id}.json`), id, reasons),
    ),
  );
  const timing = timingMaybe.filter((report): report is NerGapsReport => report !== undefined);
  reasons.push(...validateNerGapsReportConsistency([...preflight, ...timing]));
  const firstControl = timing.find((report) => report.runId === "time-A-b1");
  const controlR1 = firstControl?.imports.find((item) => item.sequenceIndex === 0)?.ner.sha256;
  const controlR2 = firstControl?.imports.find((item) => item.sequenceIndex === 2)?.ner.sha256;
  const expectedFootprints: Record<string, string> = {};
  if (controlR1 !== undefined) expectedFootprints.R1 = controlR1;
  if (controlR2 !== undefined) expectedFootprints.R2 = controlR2;
  else reasons.push("missing-A-real-document-footprints");
  if (controlR1 === undefined) reasons.push("missing-A-R1-footprint");
  const timingAggregate = aggregateNerGapsReports(timing, timingIds, expectedFootprints);
  reasons.push(...timingAggregate.reasons);

  const modelHashes = new Set(
    [...preflight, ...timing].map((report) => report.product.modelSha256),
  );
  if (modelHashes.size !== 1) reasons.push("model-hash-varies-between-arms");
  const expectedModelHash = await digestText(resolve(outputDir, "model-source.sha256"));
  if (modelHashes.size === 1 && !modelHashes.has(expectedModelHash))
    reasons.push("served-model-hash-differs-from-source");

  const sourceHashesByArm = new Map<string, string>();
  for (const report of [...preflight, ...timing]) {
    if (!report.completed) reasons.push(`report-incomplete-${report.runId}`);
    if (
      (report.phase === "timing" && !timingIds.includes(report.runId)) ||
      (report.phase === "preflight" && !preflightIds.includes(report.runId))
    ) {
      reasons.push(`report-phase-or-id-mismatch-${report.runId}`);
    }
    const prior = sourceHashesByArm.get(report.arm);
    if (prior !== undefined && prior !== report.product.sourceSha256)
      reasons.push(`source-hash-changed-${report.arm}`);
    sourceHashesByArm.set(report.arm, report.product.sourceSha256);
    const expectedSource = await digestText(resolve(outputDir, `source-arm-${report.arm}.sha256`));
    if (report.product.sourceSha256 !== expectedSource)
      reasons.push(`source-hash-mismatch-${report.arm}`);
    const expectedBuild = await digestText(resolve(outputDir, `digest-${report.arm}.txt`));
    if (report.product.buildSha256 !== expectedBuild)
      reasons.push(`build-hash-mismatch-${report.arm}`);
  }

  const threadObservations = await Promise.all(
    NER_GAPS_ARMS.map(async (arm) => {
      const path = resolve(outputDir, `ner-threads-${arm}-P1-r0.json`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path, "utf8"));
      } catch {
        reasons.push(`thread-observation-report-missing-${arm}`);
        return {
          arm,
          requestedThreads: arm === "A" ? "automatic" : Number(arm),
          effectiveThreads: null,
        };
      }
      const observation = decodeNerGapsThreadObservation(parsed, arm);
      if (observation === null) {
        reasons.push(`effective-thread-count-not-observed-${arm}`);
        return {
          arm,
          requestedThreads: arm === "A" ? "automatic" : Number(arm),
          effectiveThreads: null,
        };
      }
      return observation;
    }),
  );

  for (const runId of timingIds) {
    try {
      await readFile(resolve(outputDir, `invalid-${runId}.txt`), "utf8");
      reasons.push(`invalidated-block-${runId}`);
    } catch {
      // No invalidation marker for this run.
    }
  }
  const aggregate = {
    schemaVersion: 1,
    valid: reasons.length === 0 && timingAggregate.valid,
    reasons: [...new Set(reasons)],
    preflight: { valid: preflightValidation.valid, reportCount: preflight.length },
    timing: timingAggregate,
    threadObservations,
    sourceSha256ByArm: Object.fromEntries(sourceHashesByArm),
    modelSha256: [...modelHashes][0] ?? null,
    buildSha256ByArm: Object.fromEntries(
      await Promise.all(
        NER_GAPS_ARMS.map(
          async (arm) => [arm, await digestText(resolve(outputDir, `digest-${arm}.txt`))] as const,
        ),
      ),
    ),
  };
  const target = resolve(outputDir, "ner-gaps-aggregate.json");
  await writeFile(target, `${JSON.stringify(aggregate, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${aggregate.valid ? "VALID" : "INVALID"}: ${target}\n`);
  if (!aggregate.valid) process.exitCode = 1;
}

await main();
