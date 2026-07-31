import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  isExportTriggerVisible,
  shouldMountExportButton,
} from "../components/toolbar/exportButtonVisibility.js";

describe("isExportTriggerVisible", () => {
  it.each([
    [PipelineStage.Ready, true],
    [PipelineStage.Done, true],
    [PipelineStage.Idle, false],
    [PipelineStage.Detecting, false],
    [PipelineStage.Exporting, false],
    [PipelineStage.Failed, false],
  ] as const)("stage %s → %s", (stage, expected) => {
    expect(isExportTriggerVisible(stage)).toBe(expected);
  });
});

describe("shouldMountExportButton", () => {
  it("mounts when the trigger is visible, dialog closed", () => {
    expect(shouldMountExportButton(PipelineStage.Ready, false)).toBe(true);
  });

  it("mounts when Done (Ready equivalente operativo, ADR-040), dialog closed", () => {
    expect(shouldMountExportButton(PipelineStage.Done, false)).toBe(true);
  });

  it("unmounts when the trigger is hidden and no dialog is open", () => {
    expect(shouldMountExportButton(PipelineStage.Detecting, false)).toBe(false);
  });

  it("bug #7: stays mounted during Exporting while the dialog is open", () => {
    expect(shouldMountExportButton(PipelineStage.Exporting, true)).toBe(true);
  });

  it("stays mounted once Done, dialog still open, showing the export result", () => {
    expect(shouldMountExportButton(PipelineStage.Done, true)).toBe(true);
  });
});
