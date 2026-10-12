import { describe, expect, it } from "vitest";

import { findEditedPreviewEvidence } from "../e2e/support/editedPreviewEvidence.js";
import type { DrawRecord } from "../e2e/support/pagePixels.js";
import type { PreviewArrivalRecord, RenderRequestRecord } from "../e2e/support/renderTap.js";

const update = { at: 10, replacementValue: "[synthetic replacement]", interactionRevision: 4 };
const request: RenderRequestRecord = {
  kind: "anonymized",
  mode: "preview",
  scale: 1,
  pageIndices: [0],
  at: 11,
};
const arrival: PreviewArrivalRecord = {
  kind: "anonymized",
  pageIndex: 0,
  blobUrl: "blob:edited",
  interactionRevision: 4,
  interactionScale: 1,
  at: 12,
};
const draw: DrawRecord = {
  label: "Página 1, anonimizado",
  width: 595,
  height: 842,
  canvasWidth: 595,
  src: "blob:edited",
  at: 13,
};

describe("findEditedPreviewEvidence", () => {
  it("requires a scale-one request after the edited group, its arrival, and the matching draw", () => {
    expect(
      findEditedPreviewEvidence([update], [request], [arrival], [draw], update.replacementValue),
    ).toEqual({ groupUpdate: update, request, arrival, draw });
  });

  it("rejects stale images, pre-edit requests, and non-scale-one renders", () => {
    expect(
      findEditedPreviewEvidence(
        [update],
        [{ ...request, at: 9 }],
        [arrival],
        [draw],
        update.replacementValue,
      ),
    ).toBeNull();
    expect(
      findEditedPreviewEvidence(
        [update],
        [{ ...request, scale: 1.3 }],
        [arrival],
        [draw],
        update.replacementValue,
      ),
    ).toBeNull();
    expect(
      findEditedPreviewEvidence(
        [update],
        [request],
        [{ ...arrival, blobUrl: "blob:old" }],
        [draw],
        update.replacementValue,
      ),
    ).toBeNull();
    expect(
      findEditedPreviewEvidence(
        [update],
        [request],
        [{ ...arrival, at: 10 }],
        [draw],
        update.replacementValue,
      ),
    ).toBeNull();
    expect(
      findEditedPreviewEvidence(
        [update],
        [request],
        [{ ...arrival, interactionRevision: 3 }],
        [draw],
        update.replacementValue,
      ),
    ).toBeNull();
    expect(
      findEditedPreviewEvidence(
        [update],
        [request],
        [arrival],
        [{ ...draw, src: "blob:old" }],
        update.replacementValue,
      ),
    ).toBeNull();
    expect(
      findEditedPreviewEvidence(
        [update],
        [request],
        [arrival],
        [{ ...draw, at: 11 }],
        update.replacementValue,
      ),
    ).toBeNull();
  });
});
