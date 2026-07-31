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
    expect(label).toBe("Cargando modelo NER… 45%");
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
    expect(label).toBe("Extrayendo página 3 de 10…");
  });

  it("falls back to a generic Extracting text when total is 0", () => {
    const label = getPipelineStageLabel(makeSnapshot({ stage: PipelineStage.Extracting }));
    expect(label).toBe("Extrayendo documento…");
  });

  it("shows OCR page counts with percentage", () => {
    const label = getPipelineStageLabel(
      makeSnapshot({ stage: PipelineStage.OCRing, current: 5, total: 10, progress: 0.65 }),
    );
    expect(label).toBe("OCR página 5 de 10… 65%");
  });

  it("shows Detecting page counts without percentage", () => {
    const label = getPipelineStageLabel(
      makeSnapshot({ stage: PipelineStage.Detecting, current: 4, total: 10 }),
    );
    expect(label).toBe("Analizando página 4 de 10…");
  });

  it.each([
    [PipelineStage.Importing, "Importando documento…"],
    [PipelineStage.Grouping, "Agrupando entidades…"],
    [PipelineStage.Ready, "Listo"],
    [PipelineStage.Rendering, "Renderizando vista previa…"],
    [PipelineStage.Done, "Exportado"],
    [PipelineStage.Cancelled, "Cancelado"],
    [PipelineStage.Failed, "Error"],
    [PipelineStage.Idle, ""],
  ] as const)("maps stage %s to %s", (stage, expected) => {
    expect(getPipelineStageLabel(makeSnapshot({ stage }))).toBe(expected);
  });
});
