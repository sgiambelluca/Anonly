/**
 * `incomplete-analysis-notice.test.ts` — el aviso de "terminó, pero
 * incompleto". El caso que lo motivó está en `incompleteAnalysisNotice.ts`:
 * los 11 jobs de NER caídos y la app diciendo "Listo".
 */
import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { getIncompleteAnalysisNotice } from "../components/toolbar/incompleteAnalysisNotice.js";

describe("getIncompleteAnalysisNotice", () => {
  it("no avisa nada cuando no falló ningún job", () => {
    expect(getIncompleteAnalysisNotice(PipelineStage.Ready, {})).toBeNull();
  });

  it("avisa cuando NER se cayó entero, y lo marca como riesgo de detección", () => {
    // La regresión exacta del 2026-08-28: 11 jobs de `ner-page` con
    // WORKER_CRASHED y la toolbar mostrando "Listo".
    const notice = getIncompleteAnalysisNotice(PipelineStage.Ready, { "ner-page": 11 });

    expect(notice).not.toBeNull();
    expect(notice?.affectsDetection).toBe(true);
    expect(notice?.message).toMatch(/nombres/);
    expect(notice?.message).toMatch(/sin detectar/);
  });

  it("avisa cuando el OCR no pudo leer páginas escaneadas", () => {
    const notice = getIncompleteAnalysisNotice(PipelineStage.Ready, { "ocr-page": 20 });

    expect(notice?.affectsDetection).toBe(true);
    expect(notice?.message).toMatch(/escaneadas/);
  });

  it("junta las dos consecuencias en un solo aviso", () => {
    const notice = getIncompleteAnalysisNotice(PipelineStage.Ready, {
      "ner-page": 3,
      "ocr-page": 2,
    });

    expect(notice?.message).toMatch(/nombres/);
    expect(notice?.message).toMatch(/escaneadas/);
    expect(notice?.message).toMatch(/ ni /);
  });

  it("un fallo de render no se anuncia como riesgo de detección", () => {
    const notice = getIncompleteAnalysisNotice(PipelineStage.Ready, { "render-page": 4 });

    expect(notice?.affectsDetection).toBe(false);
    expect(notice?.message).toMatch(/vista previa/);
    expect(notice?.message).toMatch(/no se vio afectada/);
  });

  it("la detección le gana al render cuando fallan los dos", () => {
    const notice = getIncompleteAnalysisNotice(PipelineStage.Ready, {
      "ner-page": 1,
      "render-page": 9,
    });

    expect(notice?.affectsDetection).toBe(true);
    expect(notice?.message).toMatch(/nombres/);
  });

  it("no avisa mientras el pipeline todavía corre: el reintento puede salvarlo", () => {
    // `WorkerCrashedError` es retryable (ADR-077): avisar de algo que se va a
    // arreglar solo es ruido, y encima alarmista.
    for (const stage of [PipelineStage.Detecting, PipelineStage.Extracting, PipelineStage.Idle]) {
      expect(getIncompleteAnalysisNotice(stage, { "ner-page": 11 })).toBeNull();
    }
  });

  it("un cero explícito no es un fallo", () => {
    expect(getIncompleteAnalysisNotice(PipelineStage.Ready, { "ner-page": 0 })).toBeNull();
  });

  it("no nombra motores ni códigos internos (ADR-087 §4)", () => {
    const notice = getIncompleteAnalysisNotice(PipelineStage.Ready, {
      "ner-page": 11,
      "ocr-page": 20,
    });

    expect(notice?.message).not.toMatch(/NER|OCR|WorkerPool|worker|slot|ner-page|ocr-page/);
  });
});
