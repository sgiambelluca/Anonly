import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { isAnonymizedAvailable } from "../components/viewer/anonymizedAvailability.js";
import { kindsToRenderOnZoom } from "../components/viewer/zoomRenderKinds.js";

// ADR-213 §1: el emisor debounced de zoom pide primero el lado que se mira y
// después el otro.

describe("kindsToRenderOnZoom", () => {
  it("asks the viewed original first and then the anonymized side", () => {
    expect(kindsToRenderOnZoom({ viewing: "original", anonymizedAvailable: true })).toEqual([
      "original",
      "anonymized",
    ]);
  });

  it("asks the viewed anonymized first and then the original side", () => {
    expect(kindsToRenderOnZoom({ viewing: "anonymized", anonymizedAvailable: true })).toEqual([
      "anonymized",
      "original",
    ]);
  });

  it("does not ask the anonymized side while the toggle still disables it", () => {
    expect(kindsToRenderOnZoom({ viewing: "original", anonymizedAvailable: false })).toEqual([
      "original",
    ]);
  });

  it("always asks the original side, whatever the availability", () => {
    expect(kindsToRenderOnZoom({ viewing: "anonymized", anonymizedAvailable: false })).toEqual([
      "anonymized",
      "original",
    ]);
  });
});

describe("isAnonymizedAvailable", () => {
  it("is true from Ready on, including Done after an export", () => {
    expect(isAnonymizedAvailable(PipelineStage.Ready)).toBe(true);
    expect(isAnonymizedAvailable(PipelineStage.Done)).toBe(true);
  });

  it("is false before Ready and when the pipeline did not finish", () => {
    for (const stage of [
      PipelineStage.Idle,
      PipelineStage.Importing,
      PipelineStage.Extracting,
      PipelineStage.OCRing,
      PipelineStage.Detecting,
      PipelineStage.Grouping,
      PipelineStage.Failed,
      PipelineStage.Cancelled,
    ]) {
      expect(isAnonymizedAvailable(stage)).toBe(false);
    }
  });
});
