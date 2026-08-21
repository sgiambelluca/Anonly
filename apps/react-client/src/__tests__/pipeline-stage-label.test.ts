import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  getPipelineStageLabel,
  type PipelineProgressSnapshot,
} from "../components/toolbar/pipelineStageLabel.js";

function makeSnapshot(overrides: Partial<PipelineProgressSnapshot> = {}): PipelineProgressSnapshot {
  return {
    stage: PipelineStage.Idle,
    progress: 0,
    current: 0,
    total: 0,
    modelLoading: null,
    exportProgress: null,
    ...overrides,
  };
}

describe("getPipelineStageLabel", () => {
  it("prioritizes modelLoading over the stage text", () => {
    const label = getPipelineStageLabel(
      makeSnapshot({
        stage: PipelineStage.Detecting,
        modelLoading: { modelId: "x", progress: 0.45 },
      }),
    );
    expect(label).toBe("Preparando el detector de nombres… 45%");
  });

  it("prioritizes exportProgress over the stage text", () => {
    const label = getPipelineStageLabel(
      makeSnapshot({ stage: PipelineStage.Exporting, exportProgress: { current: 7, total: 10 } }),
    );
    expect(label).toBe("Exportando página 7 de 10…");
  });

  it("shows page counts for Extracting when total is known", () => {
    const label = getPipelineStageLabel(
      makeSnapshot({ stage: PipelineStage.Extracting, current: 3, total: 10 }),
    );
    expect(label).toBe("Leyendo el texto: página 3 de 10…");
  });

  it("falls back to a generic Extracting text when total is 0", () => {
    const label = getPipelineStageLabel(makeSnapshot({ stage: PipelineStage.Extracting }));
    expect(label).toBe("Leyendo el texto…");
  });

  it("shows OCR page counts with percentage", () => {
    const label = getPipelineStageLabel(
      makeSnapshot({ stage: PipelineStage.OCRing, current: 5, total: 10, progress: 0.65 }),
    );
    expect(label).toBe("Reconociendo texto: página 5 de 10…");
  });

  it("shows Detecting page counts without percentage", () => {
    const label = getPipelineStageLabel(
      makeSnapshot({ stage: PipelineStage.Detecting, current: 4, total: 10 }),
    );
    expect(label).toBe("Buscando datos sensibles: página 4 de 10…");
  });

  it.each([
    [PipelineStage.Importing, "Abriendo el documento…"],
    [PipelineStage.Grouping, "Agrupando lo encontrado…"],
    [PipelineStage.Ready, "Listo"],
    [PipelineStage.Rendering, "Preparando la vista previa…"],
    [PipelineStage.Done, "Exportado"],
    [PipelineStage.Cancelled, "Cancelado"],
    [PipelineStage.Failed, "Error"],
    [PipelineStage.Idle, ""],
  ] as const)("maps stage %s to %s", (stage, expected) => {
    expect(getPipelineStageLabel(makeSnapshot({ stage }))).toBe(expected);
  });
});
