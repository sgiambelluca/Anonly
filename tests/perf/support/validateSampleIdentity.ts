/** Snapshot comparison emits fixed issue codes, never paths or snapshot contents. */
import type { V1Run } from "./validateSampleCampaign.js";
import { V1_DOCS, v1Key, v1Plan } from "./validateSampleCampaign.js";
import type { V1ManifestIdentity } from "./validateSamplePrivacy.js";

export const V1_REQUIRED_SNAPSHOTS = [
  "commit.txt",
  "product-tree.diff.sha256",
  "tests-tree.diff.sha256",
  "tests-untracked.sha256",
  "client-dist.digest",
  "shell-dist.digest",
  "assets-lock.sha256",
  "pnpm-lock.sha256",
] as const;
export const V1_OPTIONAL_SNAPSHOTS = ["product-tree.identity.sha256"] as const;
/** The campaign root has an explicit JSON inventory. Unknown final JSON files
 * are instrument inconsistencies, even if 36 expected records also exist.
 * Only recognized neutral filenames are returned; arbitrary names never become
 * an issue string, an archive listing, or a persisted diagnostic.
 */
export function inspectV1RunFiles(names: ReadonlyArray<string>): {
  readonly runFiles: ReadonlyArray<string>;
  readonly historyFiles: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<string>;
} {
  const keys = v1Plan().map(v1Key);
  const expected = new Set(keys.map((key) => `${key}.json`));
  const checkpoints = new Set(keys.map((key) => `${key}-checkpoint.json`));
  const auxiliary = new Set([
    "manifest.json",
    "summary.json",
    "validity.json",
    "caveats.json",
    "sleep-detection.json",
    "host.json",
  ]);
  const archived = new RegExp(
    `^(?:${keys.join("|")})-(?:invalid|failure)-tanda-(?:\\d{8}T\\d{6}Z(?:-\\d+)?|unknown)\\.json$`,
  );
  const batch = /^batch-tanda-\d{8}T\d{6}Z(?:-\d+)?\.json$/;
  const runFiles: string[] = [];
  const historyFiles: string[] = [];
  let unexpected = false;
  for (const name of names) {
    if (!/\.json$/i.test(name)) continue; // Non-final atomic writes are not records.
    if (expected.has(name)) runFiles.push(name);
    else if (archived.test(name)) historyFiles.push(name);
    else if (!checkpoints.has(name) && !auxiliary.has(name) && !batch.test(name)) unexpected = true;
  }
  return { runFiles, historyFiles, issues: unexpected ? ["campaign:unexpected-run-file"] : [] };
}
/** Explicit confirmation is required even when a legacy/common guard returned 0.
 * Reasons are fixed tokens, never arbitrary seal contents. Prevention caveats
 * do not invalidate a batch whose actual detection confirmed no events.
 */
export function v1BatchSealReasons(batchId: string, seal: unknown): ReadonlyArray<string> {
  if (
    typeof seal !== "object" ||
    seal === null ||
    !("schema" in seal) ||
    seal.schema !== 1 ||
    !("batchId" in seal) ||
    seal.batchId !== batchId ||
    !("state" in seal) ||
    (seal.state !== "finished" && seal.state !== "invalid")
  )
    return ["batch-guard-not-sealed"];
  const reasons: string[] = [];
  if (
    !("detectionConfirmedAtStart" in seal) ||
    seal.detectionConfirmedAtStart !== true ||
    !("detectionConfirmedAtEnd" in seal) ||
    seal.detectionConfirmedAtEnd !== true ||
    ("invalidReason" in seal && seal.invalidReason === "sleep-detection-unconfirmed")
  )
    reasons.push("sleep-detection-unconfirmed");
  if (
    ("sleepWakeEventObserved" in seal && seal.sleepWakeEventObserved === true) ||
    ("invalidReason" in seal && seal.invalidReason === "sleep-wake-event-during-run")
  )
    reasons.push("sleep-wake-event-during-run");
  if (
    reasons.length === 0 &&
    (seal.state !== "finished" ||
      !("sleepWakeEventObserved" in seal) ||
      seal.sleepWakeEventObserved !== false ||
      !("invalidReason" in seal) ||
      seal.invalidReason !== null)
  )
    reasons.push("batch-guard-not-sealed");
  return reasons;
}
export function invalidV1BatchSeals(
  batchIds: ReadonlyArray<string>,
  seals: Readonly<Record<string, unknown>>,
): string[] {
  return [...new Set(batchIds)].filter((id) => v1BatchSealReasons(id, seals[id]).length > 0);
}
export function checkV1Identity(
  manifest: V1ManifestIdentity,
  runs: ReadonlyArray<V1Run>,
  snapshots: Readonly<
    Record<string, { readonly first: string | null; readonly current: string | null }>
  >,
): string[] {
  const issues: string[] = [];
  for (const name of [...V1_REQUIRED_SNAPSHOTS, ...V1_OPTIONAL_SNAPSHOTS]) {
    const value = snapshots[name];
    const required = V1_REQUIRED_SNAPSHOTS.some((known) => known === name);
    if (value === undefined || value.first === null || value.current === null) {
      if (required || (value !== undefined && (value.first !== null || value.current !== null)))
        issues.push(`campaign: snapshot-missing-${name}`);
      continue;
    }
    if (value.first !== value.current) issues.push(`campaign: snapshot-mismatch-${name}`);
    if (name !== "tests-untracked.sha256") {
      const format = name === "commit.txt" ? /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/ : /^[a-f0-9]{64}$/;
      if (!format.test(value.first.trim()) || !format.test(value.current.trim()))
        issues.push(`campaign: snapshot-invalid-${name}`);
    }
  }
  for (const doc of manifest.docs) {
    if (!V1_DOCS.includes(doc) || manifest.fixtureHashes[doc] === undefined)
      issues.push("campaign: fixture-manifest-incomplete");
  }
  for (const run of runs) {
    if (!manifest.docs.includes(run.doc) || manifest.fixtureHashes[run.doc] !== run.fixtureSha256)
      issues.push("campaign: fixture-manifest-mismatch");
    if (!manifest.batches.some((batch) => batch.id === run.batchId))
      issues.push("campaign: run-batch-unidentified");
  }
  return [...new Set(issues)];
}
