import { describe, expect, it } from "vitest";

import { v1Key, v1Plan } from "./validateSampleCampaign.js";
import {
  checkV1Identity,
  inspectV1RunFiles,
  invalidV1BatchSeals,
  v1BatchSealReasons,
  V1_REQUIRED_SNAPSHOTS,
} from "./validateSampleIdentity.js";
import type { V1ManifestIdentity } from "./validateSamplePrivacy.js";

const manifest: V1ManifestIdentity = {
  createdAtUtc: "2026-10-10T00:00:00.000Z",
  buildHash: "a".repeat(64),
  docs: ["R1"],
  fixtureHashes: { R1: "b".repeat(64) },
  batches: [{ id: "tanda-20261010T000000Z-1234", pendingRuns: 6 }],
};
function snapshots(): Record<string, { first: string | null; current: string | null }> {
  return Object.fromEntries(
    V1_REQUIRED_SNAPSHOTS.map((name) => {
      const value =
        name === "tests-untracked.sha256" ? "" : "a".repeat(name === "commit.txt" ? 40 : 64) + "\n";
      return [name, { first: value, current: value }];
    }),
  );
}
describe("M-V1 required identity snapshots", () => {
  it.each([
    "R1-medium-r4.json",
    "R1-high-r1.json",
    "unknown-medium-r1.json",
    "PRIVATE-DOCUMENT-r4.json",
    "R1-medium-r1.JSON",
  ])(
    "rejects an extra or incoherent final record even beside all 36 expected records: %s",
    (extra) => {
      const files = v1Plan().map((id) => `${v1Key(id)}.json`);
      const inventory = inspectV1RunFiles([...files, extra]);
      expect(inventory.runFiles).toEqual(files);
      expect(inventory.runFiles).toHaveLength(36);
      expect(inventory.issues).toEqual(["campaign:unexpected-run-file"]);
      // The diagnostic and returned listings cannot disclose an arbitrary name.
      expect(JSON.stringify(inventory)).not.toContain(extra);
    },
  );
  it("retains recognized historical attempts and permits known auxiliary/checkpoint/atomic files", () => {
    const history = "R1-medium-r1-invalid-tanda-20261010T000000Z-1234.json";
    const inventory = inspectV1RunFiles([
      "R1-medium-r1.json",
      history,
      "R4-low-r2-failure-tanda-unknown.json",
      "manifest.json",
      "summary.json",
      "validity.json",
      "caveats.json",
      "sleep-detection.json",
      "host.json",
      "batch-tanda-20261010T000000Z-1234.json",
      "R1-medium-r1-checkpoint.json",
      "R1-medium-r1.json.tmp",
      "batch-tanda-20261010T000000Z-1234.json.tmp",
      "playwright.log",
      "first",
    ]);
    expect(inventory.runFiles).toEqual(["R1-medium-r1.json"]);
    expect(inventory.historyFiles).toEqual([history, "R4-low-r2-failure-tanda-unknown.json"]);
    expect(inventory.issues).toEqual([]);
  });
  it("permits an empty untracked manifest and absent optional clean-product identity", () => {
    expect(checkV1Identity(manifest, [], snapshots())).toEqual([]);
  });
  it("rejects a missing initial identity even when the current build snapshot exists", () => {
    const values = snapshots();
    values["shell-dist.digest"] = { first: null, current: "a".repeat(64) };
    expect(checkV1Identity(manifest, [], values)).toContain(
      "campaign: snapshot-missing-shell-dist.digest",
    );
  });
  it("rejects changed snapshots without publishing either contents", () => {
    const values = snapshots();
    values["tests-tree.diff.sha256"] = { first: "a".repeat(64), current: "b".repeat(64) };
    expect(checkV1Identity(manifest, [], values)).toEqual([
      "campaign: snapshot-mismatch-tests-tree.diff.sha256",
    ]);
  });
  it("rejects an available source absent from fixture identity", () => {
    expect(checkV1Identity({ ...manifest, fixtureHashes: {} }, [], snapshots())).toContain(
      "campaign: fixture-manifest-incomplete",
    );
  });
  it("remeasures interrupted/unsealed batches and only accepts an observed finished guard", () => {
    const id = "tanda-20261010T000000Z-1234";
    expect(invalidV1BatchSeals([id], {})).toEqual([id]);
    expect(
      invalidV1BatchSeals([id], { [id]: { schema: 1, batchId: id, state: "started" } }),
    ).toEqual([id]);
    expect(
      invalidV1BatchSeals([id], { [id]: { schema: 1, batchId: id, state: "invalid" } }),
    ).toEqual([id]);
    expect(
      invalidV1BatchSeals([id], { [id]: { schema: 1, batchId: "other", state: "finished" } }),
    ).toEqual([id]);
    // A legacy finished marker cannot establish positive detection boundaries.
    expect(
      invalidV1BatchSeals([id], { [id]: { schema: 1, batchId: id, state: "finished" } }),
    ).toEqual([id]);
    expect(
      invalidV1BatchSeals([id], {
        [id]: {
          schema: 1,
          batchId: id,
          state: "finished",
          detectionConfirmedAtStart: true,
          detectionConfirmedAtEnd: true,
          sleepWakeEventObserved: false,
          invalidReason: null,
        },
      }),
    ).toEqual([]);
  });
  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])(
    "rejects an apparently finished guard without both detection confirmations (%s/%s)",
    (start, end) => {
      const id = "tanda-20261010T000000Z-1234";
      const seal = {
        schema: 1,
        batchId: id,
        state: "finished",
        detectionConfirmedAtStart: start,
        detectionConfirmedAtEnd: end,
        sleepWakeEventObserved: false,
        invalidReason: null,
      };
      expect(v1BatchSealReasons(id, seal)).toEqual(["sleep-detection-unconfirmed"]);
      expect(invalidV1BatchSeals([id], { [id]: seal })).toEqual([id]);
    },
  );
  it("distinguishes detection uncertainty from an observed sleep event without publishing arbitrary seal fields", () => {
    const id = "tanda-20261010T000000Z-1234";
    const base = {
      schema: 1,
      batchId: id,
      state: "invalid",
      detectionConfirmedAtStart: true,
      detectionConfirmedAtEnd: true,
    };
    expect(
      v1BatchSealReasons(id, {
        ...base,
        sleepWakeEventObserved: true,
        invalidReason: "sleep-wake-event-during-run",
      }),
    ).toEqual(["sleep-wake-event-during-run"]);
    expect(
      v1BatchSealReasons(id, {
        ...base,
        detectionConfirmedAtEnd: false,
        sleepWakeEventObserved: false,
        invalidReason: "sleep-detection-unconfirmed",
        detail: "PRIVATE",
        path: "PRIVATE",
      }),
    ).toEqual(["sleep-detection-unconfirmed"]);
  });
  it("permits prevention caveats when detection confirmed no events at both boundaries", () => {
    const id = "tanda-20261010T000000Z-1234";
    expect(
      v1BatchSealReasons(id, {
        schema: 1,
        batchId: id,
        state: "finished",
        detectionConfirmedAtStart: true,
        detectionConfirmedAtEnd: true,
        sleepWakeEventObserved: false,
        invalidReason: null,
        preventionAvailable: false,
      }),
    ).toEqual([]);
  });
});
