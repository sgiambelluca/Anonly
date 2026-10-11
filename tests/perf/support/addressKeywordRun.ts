/**
 * M-D2: arma el registro de una corrida (una instancia fría de Electron, el documento completo de 165
 * páginas) a partir de lo que el spec observó en la aplicación, y decide si la corrida es válida. Pura, sin
 * Electron ni disco.
 *
 * Una corrida es inválida (se escribe, se lista y no entra a ningún total; no se «arregla») si el análisis
 * no terminó, si NER no corrió, si el documento no tiene una página por entrada o si la configuración no es
 * la esperada (`observationInvalidReasons`, el mismo criterio de M-D1). Una página cuyo texto extraído
 * difiere del escrito no invalida la corrida: esa página es inválida, se cuenta aparte y no entra a los
 * totales; las demás sí.
 */

import { observationInvalidReasons, type RunObservation } from "./addressHeightRun.js";
import { classifyKeywordPage, type KeywordPageRecord } from "./addressKeywordClassify.js";
import { expectedKeywordPageText, type KeywordPage } from "./addressKeywordSentences.js";

export interface KeywordInvalidPage {
  readonly id: string;
  readonly pageIndex: number;
  readonly expected: string;
  readonly actual: string | null;
}

export interface AddressKeywordRunRecord {
  readonly schema: 1;
  readonly repetition: number;
  readonly valid: boolean;
  readonly invalidReasons: ReadonlyArray<string>;
  readonly pageCount: number;
  readonly sourceKind: string | null;
  readonly config: RunObservation["config"];
  /** Las páginas cuyo texto extraído difiere del escrito. */
  readonly invalidPages: ReadonlyArray<KeywordInvalidPage>;
  readonly occurrenceCount: number;
  readonly pages: ReadonlyArray<KeywordPageRecord>;
}

export function buildKeywordRunRecord(input: {
  readonly repetition: number;
  readonly pages: ReadonlyArray<KeywordPage>;
  readonly observation: RunObservation;
}): AddressKeywordRunRecord {
  const { repetition, pages, observation } = input;
  const reasons = observationInvalidReasons(observation, pages.length);

  const finalIds =
    observation.finalOccurrenceIds === undefined
      ? undefined
      : new Set(observation.finalOccurrenceIds);
  const invalidPages: KeywordInvalidPage[] = [];
  const records = pages.map((page, index): KeywordPageRecord => {
    const observed = observation.pages.find((candidate) => candidate.pageIndex === index);
    const record = classifyKeywordPage({
      page,
      pageText: observed?.text ?? "",
      pageWords: observed?.words ?? [],
      occurrences: observation.occurrences.filter((o) => o.pageIndex === index),
      ...(finalIds === undefined ? {} : { finalOccurrenceIds: finalIds }),
    });
    if (!record.valid) {
      invalidPages.push({
        id: page.id,
        pageIndex: index,
        expected: expectedKeywordPageText(page),
        actual: observed?.text ?? null,
      });
    }
    return record;
  });

  return {
    schema: 1,
    repetition,
    valid: reasons.length === 0,
    invalidReasons: reasons,
    pageCount: observation.pages.length,
    sourceKind: observation.sourceKind,
    config: observation.config,
    invalidPages,
    occurrenceCount: observation.occurrences.length,
    pages: records,
  };
}
