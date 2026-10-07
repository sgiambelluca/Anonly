import { describe, expect, it } from "vitest";

import type { ObservedOccurrence } from "./addressHeightClassify.js";
import { buildRunRecord, type ObservedPage, type RunObservation } from "./addressHeightRun.js";
import { expectedPageText, type AddressHeightSentence } from "./addressHeightSentences.js";

const SENTENCES: ReadonlyArray<AddressHeightSentence> = [
  {
    id: "A1",
    category: "A",
    text: "El demandado tiene domicilio en Maipú 1434 y fue notificado por cédula.",
    place: "Maipú",
    number: "1434",
  },
  {
    id: "E1",
    category: "E",
    text: "El congreso se realizó en Rosario 2019 con gran asistencia.",
    place: "Rosario",
    number: "2019",
  },
];

function pages(): ObservedPage[] {
  return SENTENCES.map((sentence, index) => {
    const text = expectedPageText(sentence);
    return { pageIndex: index, text, words: text.split(" "), requiresOCR: false };
  });
}

function occurrence(pageIndex: number, value: string, entityType = "ADDRESS"): ObservedOccurrence {
  return {
    id: `${pageIndex}-${value}`,
    entityType,
    value,
    normalizedValue: null,
    source: "ner",
    confidence: 0.9,
    pageIndex,
    wordSpan: null,
  };
}

function observation(patch: Partial<RunObservation> = {}): RunObservation {
  return {
    ready: true,
    pipelineFailure: null,
    nerFinished: true,
    sourceKind: "text",
    pages: pages(),
    occurrences: [occurrence(0, "Maipú 1434"), occurrence(1, "Rosario")],
    config: { nerEnabled: true, performancePreset: "medium", engineOverridesPresent: false },
    ...patch,
  };
}

function build(patch: Partial<RunObservation> = {}) {
  return buildRunRecord({ repetition: 1, sentences: SENTENCES, observation: observation(patch) });
}

describe("buildRunRecord", () => {
  it("una corrida completa y con la configuración esperada es válida y clasifica cada página", () => {
    const record = build();
    expect(record.valid).toBe(true);
    expect(record.invalidReasons).toEqual([]);
    expect(record.pageCount).toBe(2);
    expect(record.occurrenceCount).toBe(2);
    expect(record.sentences.map((s) => [s.id, s.placeMarked, s.numberInAddress])).toEqual([
      ["A1", true, true],
      ["E1", true, false],
    ]);
  });

  it("asigna a cada oración solo las ocurrencias de su página", () => {
    const record = build({ occurrences: [occurrence(1, "Maipú 1434")] });
    expect(record.sentences[0]?.occurrences).toHaveLength(0);
    expect(record.sentences[1]?.occurrences).toHaveLength(1);
  });

  it("un texto extraído distinto del escrito invalida la corrida", () => {
    const changed = pages();
    changed[0] = { ...changed[0]!, text: changed[0]!.text.replace("Maipú", "Maipu") };
    const record = build({ pages: changed });
    expect(record.valid).toBe(false);
    expect(record.textMismatches.map((m) => m.id)).toEqual(["A1"]);
    expect(record.invalidReasons.join(" ")).toContain("texto extraido distinto");
  });

  it("una página faltante invalida la corrida", () => {
    const record = build({ pages: pages().slice(0, 1) });
    expect(record.valid).toBe(false);
    expect(record.invalidReasons.join(" ")).toContain("paginas: esperadas 2, leidas 1");
    expect(record.textMismatches.map((m) => m.id)).toEqual(["E1"]);
  });

  it("el análisis que no termina, un fallo de pipeline o NER sin terminar invalidan", () => {
    expect(build({ ready: false }).invalidReasons).toContain("pipeline-no-llego-a-ready");
    expect(build({ pipelineFailure: { code: "X" } }).invalidReasons).toContain("pipeline-fallo");
    expect(build({ nerFinished: false }).invalidReasons).toContain("ner-no-termino");
  });

  it("una configuración que no es la esperada invalida", () => {
    expect(
      build({
        config: { nerEnabled: false, performancePreset: "medium", engineOverridesPresent: false },
      }).invalidReasons.join(" "),
    ).toContain("ner.enabled efectivo: false");
    expect(
      build({
        config: { nerEnabled: true, performancePreset: "auto", engineOverridesPresent: false },
      }).invalidReasons.join(" "),
    ).toContain("performancePreset: auto");
    expect(
      build({
        config: { nerEnabled: true, performancePreset: "medium", engineOverridesPresent: true },
      }).invalidReasons,
    ).toContain("hay overrides de motor instalados");
  });

  it("un documento que no es de texto o con páginas que piden OCR invalida", () => {
    expect(build({ sourceKind: "scanned" }).invalidReasons.join(" ")).toContain("sourceKind");
    const ocr = pages().map((page) => ({ ...page, requiresOCR: true }));
    expect(build({ pages: ocr }).invalidReasons).toContain("hay paginas que piden OCR");
  });
});
