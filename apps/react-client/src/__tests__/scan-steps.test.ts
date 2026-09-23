import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { READ_SKIPPED_DESCRIPTION, resolveScanSteps } from "../components/screens/scanStepFlow.js";

// ADR-168 §5: cuatro pasos fijos, derivados solo de PipelineStage.

function statuses(stage: PipelineStage, visited: ReadonlyArray<PipelineStage>): string[] {
  return resolveScanSteps(stage, new Set(visited)).map((step) => step.status);
}

describe("resolveScanSteps", () => {
  it("siempre son cuatro pasos, en el mismo orden", () => {
    for (const stage of Object.values(PipelineStage)) {
      const steps = resolveScanSteps(stage, new Set());
      expect(steps.map((step) => step.id)).toEqual(["open", "read", "scan", "group"]);
    }
  });

  it("Importing/Extracting: Abrir en curso, el resto pendiente", () => {
    expect(statuses(PipelineStage.Importing, [PipelineStage.Importing])).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
    ]);
    expect(statuses(PipelineStage.Extracting, [PipelineStage.Importing])).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("OCRing: Abierto, Leer en curso", () => {
    const steps = resolveScanSteps(
      PipelineStage.OCRing,
      new Set([PipelineStage.Extracting, PipelineStage.OCRing]),
    );
    expect(steps.map((step) => step.status)).toEqual(["done", "active", "pending", "pending"]);
    expect(steps.map((step) => step.label)).toEqual([
      "Abierto",
      "Leyendo",
      "Escaneando",
      "Ordenando",
    ]);
    expect(steps[1]?.description).toBe("Saca el texto de cada página");
  });

  it("Detecting sin OCR: el paso Leer queda terminado con la aclaración", () => {
    const steps = resolveScanSteps(
      PipelineStage.Detecting,
      new Set([PipelineStage.Importing, PipelineStage.Extracting, PipelineStage.Detecting]),
    );
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "active", "pending"]);
    expect(steps[1]?.label).toBe("Leído");
    expect(steps[1]?.description).toBe(READ_SKIPPED_DESCRIPTION);
  });

  it("Detecting después de OCR: Leer terminado con su descripción normal", () => {
    const steps = resolveScanSteps(
      PipelineStage.Detecting,
      new Set([PipelineStage.Extracting, PipelineStage.OCRing, PipelineStage.Detecting]),
    );
    expect(steps[1]?.description).toBe("Saca el texto de cada página");
  });

  it("Grouping: Ordenar en curso", () => {
    expect(statuses(PipelineStage.Grouping, [PipelineStage.Detecting])).toEqual([
      "done",
      "done",
      "done",
      "active",
    ]);
  });

  it("Ready/Done: todos terminados, con participio", () => {
    const steps = resolveScanSteps(PipelineStage.Ready, new Set([PipelineStage.Grouping]));
    expect(steps.every((step) => step.status === "done")).toBe(true);
    expect(steps.map((step) => step.label)).toEqual(["Abierto", "Leído", "Escaneado", "Ordenado"]);
    expect(statuses(PipelineStage.Done, [])).toEqual(["done", "done", "done", "done"]);
  });

  it("Failed/Cancelled: queda en curso el paso más avanzado por el que se pasó", () => {
    expect(
      statuses(PipelineStage.Failed, [PipelineStage.Importing, PipelineStage.Extracting]),
    ).toEqual(["active", "pending", "pending", "pending"]);
    expect(
      statuses(PipelineStage.Cancelled, [PipelineStage.Extracting, PipelineStage.OCRing]),
    ).toEqual(["done", "active", "pending", "pending"]);
  });

  it("cada paso dice qué hace", () => {
    const descriptions = resolveScanSteps(PipelineStage.Importing, new Set()).map(
      (step) => step.description,
    );
    expect(descriptions).toEqual([
      "Carga el archivo",
      "Saca el texto de cada página",
      "Busca datos sensibles",
      "Agrupa lo encontrado",
    ]);
  });
});
