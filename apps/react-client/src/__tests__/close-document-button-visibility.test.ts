import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  isCloseDocumentTriggerVisible,
  shouldMountCloseDocumentButton,
} from "../components/toolbar/closeDocumentButtonVisibility.js";

describe("isCloseDocumentTriggerVisible", () => {
  it.each([
    [PipelineStage.Ready, true],
    [PipelineStage.Done, true],
    [PipelineStage.Failed, true],
    [PipelineStage.Cancelled, true],
    [PipelineStage.Idle, false],
    [PipelineStage.Importing, false],
    [PipelineStage.Extracting, false],
    [PipelineStage.Detecting, false],
    [PipelineStage.Rendering, false],
    [PipelineStage.Exporting, false],
  ] as const)("con documento activo, stage %s → %s", (stage, expected) => {
    expect(isCloseDocumentTriggerVisible(stage, true)).toBe(expected);
  });

  it.each([
    PipelineStage.Ready,
    PipelineStage.Done,
    PipelineStage.Failed,
    PipelineStage.Cancelled,
    PipelineStage.Idle,
    PipelineStage.Detecting,
  ] as const)("sin documento activo, stage %s → false (ADR-051 §1)", (stage) => {
    expect(isCloseDocumentTriggerVisible(stage, false)).toBe(false);
  });
});

describe("shouldMountCloseDocumentButton", () => {
  it("mounts when the trigger is visible, dialog closed", () => {
    expect(shouldMountCloseDocumentButton(PipelineStage.Ready, true, false)).toBe(true);
  });

  it("mounts for Failed with an active document, dialog closed (coexiste con el banner, ADR-051 §3)", () => {
    expect(shouldMountCloseDocumentButton(PipelineStage.Failed, true, false)).toBe(true);
  });

  it("unmounts when the trigger is hidden (sin documento activo) and no dialog is open", () => {
    expect(shouldMountCloseDocumentButton(PipelineStage.Ready, false, false)).toBe(false);
  });

  it("unmounts when the trigger is hidden (pipeline corriendo) and no dialog is open", () => {
    expect(shouldMountCloseDocumentButton(PipelineStage.Detecting, true, false)).toBe(false);
  });

  it("regla 9 (Components.md §13): stays mounted if stage changes under an open dialog", () => {
    expect(shouldMountCloseDocumentButton(PipelineStage.Detecting, true, true)).toBe(true);
  });

  it("regla 9: stays mounted even if document.store se limpia bajo un diálogo abierto", () => {
    expect(shouldMountCloseDocumentButton(PipelineStage.Ready, false, true)).toBe(true);
  });
});
