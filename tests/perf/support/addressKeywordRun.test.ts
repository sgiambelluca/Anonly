import { describe, expect, it } from "vitest";

import type { ObservedOccurrence } from "./addressHeightClassify.js";
import type { ObservedPage, RunObservation } from "./addressHeightRun.js";
import { buildKeywordRunRecord } from "./addressKeywordRun.js";
import {
  ADDRESS_KEYWORD_PAGES,
  expectedKeywordPageText,
  type KeywordPage,
} from "./addressKeywordSentences.js";

const PAGES: ReadonlyArray<KeywordPage> = ["K1-1/n", "K8-1/M"].map((id) => {
  const found = ADDRESS_KEYWORD_PAGES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(id);
  return found;
});

function observedPages(): ObservedPage[] {
  return PAGES.map((page, index) => {
    const text = expectedKeywordPageText(page);
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
    pages: observedPages(),
    occurrences: [occurrence(0, "Av. Corrientes 1980"), occurrence(1, "LA CALLE")],
    config: { nerEnabled: true, performancePreset: "medium", engineOverridesPresent: false },
    ...patch,
  };
}

function build(patch: Partial<RunObservation> = {}) {
  return buildKeywordRunRecord({ repetition: 1, pages: PAGES, observation: observation(patch) });
}

describe("buildKeywordRunRecord", () => {
  it("una corrida completa y con la configuración esperada es válida y clasifica cada página", () => {
    const record = build();
    expect(record.valid).toBe(true);
    expect(record.invalidReasons).toEqual([]);
    expect(record.pageCount).toBe(2);
    expect(record.occurrenceCount).toBe(2);
    expect(record.invalidPages).toEqual([]);
    expect(record.pages.map((p) => [p.id, p.valid, p.addresses.length])).toEqual([
      ["K1-1/n", true, 1],
      ["K8-1/M", true, 1],
    ]);
  });

  it("con los ids que sobreviven al agrupado marca cada ocurrencia; sin ellos, no", () => {
    const withIds = build({ finalOccurrenceIds: ["0-Av. Corrientes 1980"] });
    expect(withIds.pages[0]?.addresses.map((a) => a.survives)).toEqual([true]);
    expect(withIds.pages[1]?.addresses.map((a) => a.survives)).toEqual([false]);
    expect(build().pages[0]?.addresses.map((a) => a.survives)).toEqual([undefined]);
  });

  it("asigna a cada página solo las ocurrencias de su índice", () => {
    const record = build({ occurrences: [occurrence(1, "Av. Corrientes 1980")] });
    expect(record.pages[0]?.addresses).toHaveLength(0);
    expect(record.pages[0]?.unlocatedOccurrences).toBe(0);
  });

  it("un texto extraído distinto del escrito invalida la página, no la corrida", () => {
    const changed = observedPages();
    changed[0] = { ...changed[0]!, text: changed[0]!.text.replace("Corrientes", "Corriente") };
    const record = build({ pages: changed });
    expect(record.valid).toBe(true);
    expect(record.invalidPages.map((p) => p.id)).toEqual(["K1-1/n"]);
    expect(record.invalidPages[0]?.actual).toContain("Corriente ");
    expect(record.pages[0]?.valid).toBe(false);
    expect(record.pages[1]?.valid).toBe(true);
  });

  it("una página faltante invalida la corrida y la página", () => {
    const record = build({ pages: observedPages().slice(0, 1) });
    expect(record.valid).toBe(false);
    expect(record.invalidReasons.join(" ")).toContain("paginas: esperadas 2, leidas 1");
    expect(record.invalidPages.map((p) => p.id)).toEqual(["K8-1/M"]);
    expect(record.invalidPages[0]?.actual).toBeNull();
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
    const ocr = observedPages().map((page) => ({ ...page, requiresOCR: true }));
    expect(build({ pages: ocr }).invalidReasons).toContain("hay paginas que piden OCR");
  });
});
