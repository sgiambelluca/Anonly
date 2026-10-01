/**
 * Lectura de celdas desde varias carpetas de salida (una continuación puede traer corpus que la
 * primera tanda dejó inválidos). La invalidación es POR FUENTE: una carpeta que invalidó un corpus
 * no aporta sus celdas, pero una carpeta posterior con el corpus limpio lo recupera. Solo si
 * ninguna fuente tiene la celda y alguna invalidó el corpus, la celda sale inválida (no ausente).
 */

import type { CorpusId } from "./ocrDpiDownCorpus.js";
import { cellId, expectedCellKeys, invalidatedCell, type CellRecord } from "./ocrDpiDownSummary.js";

export interface CellSource {
  readonly name: string;
  /** Motivos por corpus con los que el runner invalidó este corpus en esta carpeta. */
  readonly invalidatedCorpora: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly readCell: (fileName: string) => CellRecord | undefined;
}

export interface ValidityLike {
  readonly affectedRunIds?: ReadonlyArray<string>;
  readonly reasonsByRunId?: Readonly<Record<string, ReadonlyArray<string>>>;
}

/** `validity.json` de una carpeta -> corpus invalidados (ids `corpus-<ID>`). */
export function invalidatedCorporaOf(
  validity: ValidityLike | undefined,
): Record<string, ReadonlyArray<string>> {
  const out: Record<string, ReadonlyArray<string>> = {};
  for (const id of validity?.affectedRunIds ?? []) {
    if (!id.startsWith("corpus-")) continue;
    out[id.slice("corpus-".length)] = validity?.reasonsByRunId?.[id] ?? [
      "invalidado por el runner",
    ];
  }
  return out;
}

/**
 * Cada corpus se toma ENTERO de una sola carpeta (§7, continuaciones): la última que lo tenga
 * completo (todas sus celdas esperadas) y sin invalidar. Si ninguna lo tiene completo, la última
 * no invalidada que tenga alguna celda (el corpus queda incompleto: las que falten son ausentes).
 * Solo si todas las que lo tienen lo invalidaron, sus celdas salen inválidas. Nunca se mezclan
 * celdas de carpetas distintas dentro de un corpus.
 */
export function createSourcedReader(
  sources: ReadonlyArray<CellSource>,
  arms: ReadonlyArray<number>,
): (corpus: CorpusId, dpi: number, repetition: number) => CellRecord | null {
  const chosen = new Map<
    string,
    { source: CellSource | null; reasons: ReadonlyArray<string> | null }
  >();
  const choose = (corpus: CorpusId) => {
    const cached = chosen.get(corpus);
    if (cached !== undefined) return cached;
    const files = expectedCellKeys([corpus], arms).map(
      (key) => `ocr-dpi-down-cell-${cellId(corpus, key.dpi, key.repetition)}.json`,
    );
    let invalidReasons: ReadonlyArray<string> | null = null;
    let partial: CellSource | null = null;
    let complete: CellSource | null = null;
    for (const source of sources) {
      const invalid = source.invalidatedCorpora[corpus];
      if (invalid !== undefined) {
        invalidReasons ??= invalid;
        continue;
      }
      const present = files.filter((file) => source.readCell(file) !== undefined).length;
      if (present === files.length) complete = source;
      if (present > 0) partial = source;
    }
    const result = { source: complete ?? partial, reasons: invalidReasons };
    chosen.set(corpus, result);
    return result;
  };
  return (corpus, dpi, repetition) => {
    const pick = choose(corpus);
    if (pick.source !== null)
      return (
        pick.source.readCell(`ocr-dpi-down-cell-${cellId(corpus, dpi, repetition)}.json`) ?? null
      );
    return pick.reasons === null ? null : invalidatedCell(corpus, dpi, repetition, pick.reasons);
  };
}
