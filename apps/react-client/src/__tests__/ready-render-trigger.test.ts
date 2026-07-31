import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { shouldTriggerReadyRender } from "../components/viewer/readyRenderTrigger.js";

describe("shouldTriggerReadyRender", () => {
  it("returns true when there is an active document, the pipeline is Ready, mountRange is non-empty, and it never fired for this document", () => {
    expect(
      shouldTriggerReadyRender({
        documentId: "doc-1",
        stage: PipelineStage.Ready,
        mountedPageIndicesCount: 3,
        triggeredForDocumentId: null,
      }),
    ).toBe(true);
  });

  it("returns false without an active document", () => {
    expect(
      shouldTriggerReadyRender({
        documentId: null,
        stage: PipelineStage.Ready,
        mountedPageIndicesCount: 3,
        triggeredForDocumentId: null,
      }),
    ).toBe(false);
  });

  it("returns false while the stage is not Ready", () => {
    for (const stage of [
      PipelineStage.Idle,
      PipelineStage.Importing,
      PipelineStage.Extracting,
      PipelineStage.OCRing,
      PipelineStage.Detecting,
      PipelineStage.Grouping,
      PipelineStage.Done,
      PipelineStage.Failed,
      PipelineStage.Cancelled,
    ]) {
      expect(
        shouldTriggerReadyRender({
          documentId: "doc-1",
          stage,
          mountedPageIndicesCount: 3,
          triggeredForDocumentId: null,
        }),
      ).toBe(false);
    }
  });

  it("returns false when mountRange is still empty (pageCount not known yet)", () => {
    expect(
      shouldTriggerReadyRender({
        documentId: "doc-1",
        stage: PipelineStage.Ready,
        mountedPageIndicesCount: 0,
        triggeredForDocumentId: null,
      }),
    ).toBe(false);
  });

  it("returns false when it already fired for this exact documentId (fires only once per document)", () => {
    expect(
      shouldTriggerReadyRender({
        documentId: "doc-1",
        stage: PipelineStage.Ready,
        mountedPageIndicesCount: 3,
        triggeredForDocumentId: "doc-1",
      }),
    ).toBe(false);
  });

  it("returns true again for a different documentId even if a previous one already fired", () => {
    expect(
      shouldTriggerReadyRender({
        documentId: "doc-2",
        stage: PipelineStage.Ready,
        mountedPageIndicesCount: 3,
        triggeredForDocumentId: "doc-1",
      }),
    ).toBe(true);
  });
});
