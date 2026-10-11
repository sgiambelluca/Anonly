import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  projectRcRun,
  projectRcSnapshot,
  rcKey,
  rcPair,
  rcPlan,
  rcN1SmokeIssues,
  type RcRun,
  type RcSide,
} from "./rcIsolatedCampaign.js";
import { parseRcSourceMode, type RcSourceMode } from "./rcIsolatedTransform.js";
import { v1BatchSealReasons } from "./validateSampleIdentity.js";
import { sanitizeV1Report } from "./validateSamplePrivacy.js";

const directory = process.argv[2] ?? "";
const mode = process.argv[3];
const sourceMode = parseRcSourceMode(process.argv[4]);
const parse = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(join(directory, name), "utf8")) as unknown;
function numericStats(values: ReadonlyArray<number | null>) {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const n = sorted.length;
  return {
    count: n,
    median:
      n === 0
        ? null
        : ((sorted[Math.floor((n - 1) / 2)] ?? 0) + (sorted[Math.ceil((n - 1) / 2)] ?? 0)) / 2,
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
}
try {
  const names = await readdir(directory);
  const issues: string[] = [];
  const auxiliary = new Set([
    "manifest.json",
    "build-identity.json",
    "transform-A.json",
    "transform-RC.json",
    "cleanup.json",
    "summary.json",
    "validity.json",
    "caveats.json",
    "sleep-detection.json",
    "host.json",
    "identity-integrity.json",
    "source-mode.txt",
    "normal-renderer.sha256",
  ]);
  const batch = /^batch-tanda-\d{8}T\d{6}Z-\d+\.json$/;
  const integrity = (await parse("identity-integrity.json")) as {
    confirmedAtStart: boolean;
    confirmedAtEnd: boolean;
    sourceModeAtStart: RcSourceMode;
    sourceModeAtEnd: RcSourceMode;
  };
  if (
    integrity.confirmedAtStart !== true ||
    integrity.confirmedAtEnd !== true ||
    integrity.sourceModeAtStart !== sourceMode ||
    integrity.sourceModeAtEnd !== sourceMode
  )
    issues.push("campaign-identity-changed");
  const builds = (await parse("build-identity.json")) as {
    arms: Record<"A" | "RC", string>;
    sourceMode: RcSourceMode;
  };
  const manifest = (await parse("manifest.json")) as {
    fixtureHashes: Record<string, string>;
    sourceMode: RcSourceMode;
  };
  if (builds.sourceMode !== sourceMode || manifest.sourceMode !== sourceMode)
    issues.push("source-mode-identity-mismatch");
  if ((await readFile(join(directory, "source-mode.txt"), "utf8")).trim() !== sourceMode)
    issues.push("source-mode-resume-mismatch");
  let result: unknown;
  if (mode === "smoke") {
    const expected = [
      ...([150, 300] as const).flatMap((dpi) =>
        [90, 270].map((angle) => `smoke-RC-N1-${dpi}-${angle}.json`),
      ),
      ...(["blank", "noise"] as const).flatMap((key) =>
        (["A", "RC"] as const).map((arm) => `smoke-${arm}-${key}-150-0.json`),
      ),
    ];
    const records = new Map<
      string,
      {
        batchId: string;
        sourceMode: RcSourceMode;
        issue: string | null;
        cold: RcSide;
        hot: RcSide;
        recovered: { cold: boolean; hot: boolean };
        failure?: string;
      }
    >();
    for (const name of expected) {
      if (!names.includes(name)) {
        issues.push("smoke-record-missing");
        continue;
      }
      const record = (await parse(name)) as {
        batchId: string;
        sourceMode: RcSourceMode;
        issue: string | null;
        cold: RcSide;
        hot: RcSide;
        recovered: { cold: boolean; hot: boolean };
        failure?: string;
      };
      if (record.sourceMode !== sourceMode) issues.push("smoke-source-mode-mismatch");
      if (record.failure !== undefined || record.issue !== null) {
        issues.push("smoke-record-failed");
        continue;
      }
      for (const temp of ["cold", "hot"] as const) {
        record[temp] = {
          report: sanitizeV1Report(record[temp].report),
          snapshot: projectRcSnapshot(record[temp].snapshot),
          conflicts: { available: false, counts: {} },
        };
        if (!record[temp].report.ok) issues.push("smoke-pipeline-failed");
        if (name.includes("-N1-")) issues.push(...rcN1SmokeIssues(record[temp].snapshot));
      }
      if (name.includes("-N1-") && (!record.recovered.cold || !record.recovered.hot))
        issues.push("smoke-N1-not-recovered");
      if (
        v1BatchSealReasons(record.batchId, await parse(`batch-${record.batchId}.json`)).length > 0
      )
        issues.push("smoke-guard-invalid");
      records.set(name, record);
    }
    for (const key of ["blank", "noise"]) {
      const a = records.get(`smoke-A-${key}-150-0.json`);
      const rc = records.get(`smoke-RC-${key}-150-0.json`);
      if (a && rc)
        for (const temp of ["cold", "hot"] as const) {
          const pair = rcPair(a[temp], rc[temp]);
          issues.push(...pair.issues);
          if (pair.pages.some((p) => p?.textHashChanged || p?.warningChanged || p?.wordsChanged))
            issues.push("smoke-control-output-changed");
        }
    }
    if (
      names.some(
        (name) =>
          name.endsWith(".json") &&
          !expected.includes(name) &&
          !auxiliary.has(name) &&
          !batch.test(name),
      )
    )
      issues.push("unexpected-run-file");
    result = {
      schema: 1,
      phase: "RC-isolated",
      mode,
      sourceMode,
      expected: 8,
      observed: records.size,
      complete: records.size === 8 && issues.length === 0,
      issues: [...new Set(issues)],
    };
  } else if (mode === "cost") {
    const expected = new Set(rcPlan().map((id) => rcKey(id) + ".json"));
    if (
      names.some(
        (name) =>
          name.endsWith(".json") &&
          !expected.has(name) &&
          !auxiliary.has(name) &&
          !batch.test(name) &&
          !/^history-(R1|P2N)-(A|RC)-r[123]-tanda-\d{8}T\d{6}Z-\d+\.json$/.test(name),
      )
    )
      issues.push("unexpected-run-file");
    const runs: RcRun[] = [];
    const missing: string[] = [];
    const invalid: string[] = [];
    for (const id of rcPlan()) {
      const key = rcKey(id);
      if (!names.includes(key + ".json")) {
        missing.push(key);
        continue;
      }
      const run = projectRcRun((await parse(key + ".json")) as RcRun);
      if (
        rcKey(run) !== key ||
        run.sourceMode !== sourceMode ||
        run.buildSha256 !== builds.arms[id.arm] ||
        run.fixtureSha256 !== manifest.fixtureHashes[id.doc]
      ) {
        issues.push("run-identity-mismatch");
        continue;
      }
      if (v1BatchSealReasons(run.batchId, await parse(`batch-${run.batchId}.json`)).length > 0) {
        invalid.push(key);
        continue;
      }
      runs.push(run);
      for (const side of [run.cold, run.hot])
        if (side?.report.ok === true) {
          if (
            side.report.readyDurationMs === null ||
            side.report.peakSumBytes === null ||
            side.snapshot.pages.length !== (run.doc === "R1" ? 20 : 60) ||
            !side.snapshot.observer ||
            side.snapshot.ocrPageJobs !==
              side.snapshot.pages.reduce((sum, p) => sum + p.attempts.length, 0)
          )
            issues.push("successful-import-instrument-incomplete");
          if (
            side.snapshot.pages.some(
              (p) => JSON.stringify(p.natural) !== JSON.stringify(p.orientation),
            )
          )
            issues.push("natural-orientation-or-ink-altered");
        }
    }
    const pairs = (["R1", "P2N"] as const).flatMap((doc) =>
      [1, 2, 3].flatMap((rep) => {
        const a = runs.find((r) => r.doc === doc && r.rep === rep && r.arm === "A");
        const rc = runs.find((r) => r.doc === doc && r.rep === rep && r.arm === "RC");
        return (["cold", "hot"] as const).flatMap((temp) => {
          const left = a?.[temp];
          const right = rc?.[temp];
          if (!left?.report.ok || !right?.report.ok) return [];
          const pair = rcPair(left, right);
          issues.push(...pair.issues);
          return [{ doc, rep, temperature: temp, ...pair }];
        });
      }),
    );
    const successful = runs.filter(
      (r) => r.failure === null && r.cold?.report.ok && r.hot?.report.ok,
    );
    const cells = (["R1", "P2N"] as const).flatMap((doc) =>
      (["A", "RC"] as const).flatMap((arm) =>
        (["cold", "hot"] as const).map((temp) => {
          const reports = successful
            .filter((r) => r.doc === doc && r.arm === arm)
            .map((r) => r[temp]!.report);
          return {
            doc,
            arm,
            temperature: temp,
            readyMs: numericStats(reports.map((r) => r.readyDurationMs ?? null)),
            ocrMs: numericStats(reports.map((r) => r.ocrDurationMs ?? null)),
            m2Bytes: numericStats(reports.map((r) => r.peakSumBytes)),
            postReadyBytes: numericStats(reports.map((r) => r.postReadyPeakBytes)),
            hotBaselineSettled: reports.map((r) => r.hotBaselineSettled),
          };
        }),
      ),
    );
    result = {
      schema: 1,
      phase: "RC-isolated",
      mode,
      sourceMode,
      expected: 12,
      observed: runs.length,
      successfulCostRuns: successful.length,
      productFailures: runs.filter((r) => r.failure === "product").map(rcKey),
      instrumentFailures: runs.filter((r) => r.failure === "instrument").map(rcKey),
      missing,
      invalid,
      pairs,
      cells,
      issues: [...new Set(issues)],
      complete:
        missing.length === 0 &&
        invalid.length === 0 &&
        issues.length === 0 &&
        !runs.some((r) => r.failure === "instrument"),
    };
  } else throw new Error("RC summary mode missing");
  await writeFile(join(directory, "summary.json"), JSON.stringify(result, null, 2));
  const summary = result as { complete: boolean; issues: string[] };
  console.log(`RC resumen: complete=${summary.complete}; issues=${summary.issues.length}`);
  process.exitCode = summary.complete ? 0 : 1;
} catch {
  await writeFile(
    join(directory, "summary.json"),
    JSON.stringify({
      schema: 1,
      phase: "RC-isolated",
      sourceMode,
      complete: false,
      issues: ["summary-validation-failed"],
    }),
  );
  console.error("RC resumen no validado; registros preservados.");
  process.exitCode = 2;
}
