/**
 * M-D1: arma el registro de una corrida (una instancia fría de Electron, el documento completo) a partir de
 * lo que el spec observó en la aplicación, y decide si la corrida es válida. Pura, sin Electron ni disco.
 *
 * Una corrida es inválida (se escribe, se lista y no entra a ningún total; no se «arregla») si el análisis
 * no terminó, si NER no corrió, si el documento no tiene una página por oración, si el texto que la app
 * extrajo de alguna página difiere de lo escrito, o si la configuración no es la esperada.
 */

import {
  classifySentence,
  type ObservedOccurrence,
  type SentenceRecord,
} from "./addressHeightClassify.js";
import { expectedPageText, type AddressHeightSentence } from "./addressHeightSentences.js";

export interface ObservedPage {
  readonly pageIndex: number;
  /** `Page.text`, tal como lo extrajo la aplicación. */
  readonly text: string;
  readonly words: ReadonlyArray<string>;
  readonly requiresOCR: boolean;
}

export interface ObservedConfig {
  readonly nerEnabled: boolean | null;
  /** `performancePreset` de los settings persistidos (los que instala la suite de medición). */
  readonly performancePreset: string | null;
  /** `true` si había un canal de overrides de motor instalado (no debería). */
  readonly engineOverridesPresent: boolean;
}

export interface RunObservation {
  readonly ready: boolean;
  readonly pipelineFailure: unknown;
  readonly nerFinished: boolean;
  readonly sourceKind: string | null;
  readonly pages: ReadonlyArray<ObservedPage>;
  readonly occurrences: ReadonlyArray<ObservedOccurrence>;
  readonly config: ObservedConfig;
}

export interface PageTextMismatch {
  readonly id: string;
  readonly pageIndex: number;
  readonly expected: string;
  readonly actual: string | null;
}

export interface AddressHeightRunRecord {
  readonly schema: 1;
  readonly repetition: number;
  readonly valid: boolean;
  readonly invalidReasons: ReadonlyArray<string>;
  readonly pageCount: number;
  readonly sourceKind: string | null;
  readonly config: ObservedConfig;
  readonly textMismatches: ReadonlyArray<PageTextMismatch>;
  readonly occurrenceCount: number;
  readonly sentences: ReadonlyArray<SentenceRecord>;
}

export function buildRunRecord(input: {
  readonly repetition: number;
  readonly sentences: ReadonlyArray<AddressHeightSentence>;
  readonly observation: RunObservation;
}): AddressHeightRunRecord {
  const { repetition, sentences, observation } = input;
  const reasons: string[] = [];
  if (!observation.ready) reasons.push("pipeline-no-llego-a-ready");
  if (observation.pipelineFailure !== null && observation.pipelineFailure !== undefined)
    reasons.push("pipeline-fallo");
  if (!observation.nerFinished) reasons.push("ner-no-termino");
  if (observation.pages.length !== sentences.length)
    reasons.push(`paginas: esperadas ${sentences.length}, leidas ${observation.pages.length}`);
  if (observation.sourceKind !== "text")
    reasons.push(`sourceKind distinto de text: ${String(observation.sourceKind)}`);
  if (observation.pages.some((page) => page.requiresOCR)) reasons.push("hay paginas que piden OCR");
  if (observation.config.nerEnabled !== true)
    reasons.push(`ner.enabled efectivo: ${String(observation.config.nerEnabled)}`);
  if (observation.config.performancePreset !== "medium")
    reasons.push(
      `performancePreset: ${String(observation.config.performancePreset)} (se esperaba medium)`,
    );
  if (observation.config.engineOverridesPresent) reasons.push("hay overrides de motor instalados");

  const textMismatches: PageTextMismatch[] = [];
  const records = sentences.map((sentence, index): SentenceRecord => {
    const page = observation.pages.find((candidate) => candidate.pageIndex === index);
    const expected = expectedPageText(sentence);
    if (page === undefined || page.text !== expected) {
      textMismatches.push({
        id: sentence.id,
        pageIndex: index,
        expected,
        actual: page?.text ?? null,
      });
    }
    return classifySentence({
      sentence,
      pageText: page?.text ?? "",
      pageWords: page?.words ?? [],
      occurrences: observation.occurrences.filter((o) => o.pageIndex === index),
    });
  });
  if (textMismatches.length > 0)
    reasons.push(`texto extraido distinto del escrito en ${textMismatches.length} pagina(s)`);

  return {
    schema: 1,
    repetition,
    valid: reasons.length === 0,
    invalidReasons: reasons,
    pageCount: observation.pages.length,
    sourceKind: observation.sourceKind,
    config: observation.config,
    textMismatches,
    occurrenceCount: observation.occurrences.length,
    sentences: records,
  };
}
