/**
 * Mocks y builders compartidos por los tests de @anonly/regex-engine.
 *
 * Regex Engine no depende de ninguna librería externa (§4/§5 del spec: usa
 * `RegExp` nativo), así que a diferencia de pdf-engine/ocr-engine no hace
 * falta ningún cast de frontera (`as unknown as`) contra una librería de
 * terceros — no hay ninguno en este archivo.
 */
import type { Document, Page, Word } from "@anonly/shared";

/*
 * ADR-129: los dobles genéricos —logger, cache, bus, `EngineContext` y los
 * defaults de `EngineConfig`— viven en `@anonly/test-utils`. Se re-exportan acá
 * para que cada suite siga importando de un solo lugar, y para que lo propio de
 * este motor (los builders de abajo) y lo compartido se pidan igual.
 */
export {
  createEngineContext,
  createMockBus,
  createMockCache,
  createMockConfig,
  createMockLogger,
} from "@anonly/test-utils";

/**
 * Construye un `Word` sintético. `x` avanza monotónicamente entre llamadas
 * del caller (ver `makePage`) para que el orden de lectura sea estable.
 */
export function makeWord(text: string, x: number, pageIndex: number, y = 100): Word {
  return {
    text,
    bbox: { x, y, width: Math.max(text.length * 6, 1), height: 12 },
    pageIndex,
    confidence: 1.0,
    source: "pdf",
  };
}

/**
 * Variante de `makeWord` con `source: "ocr"` (ADR-061 §1: `findLiteral`
 * opera sobre `Page.words` sin distinguir origen — ver
 * "findLiteral works over OCR-sourced words" en edge.test.ts).
 */
export function makeOcrWord(text: string, x: number, pageIndex: number, y = 100): Word {
  return {
    text,
    bbox: { x, y, width: Math.max(text.length * 6, 1), height: 12 },
    pageIndex,
    confidence: 0.9,
    source: "ocr",
  };
}

/**
 * Construye una `Page` a partir de una lista de tokens (cada uno, un
 * `Word`). `text` se arma exactamente como especifica 03_Data_Model.md §4:
 * `words.map(w => w.text).join(" ")` — el mismo criterio que usa
 * `regex.engine.ts` para mapear spans de texto de vuelta a `Word[]`.
 */
export function makePage(pageIndex: number, tokens: ReadonlyArray<string>): Page {
  const words: Word[] = [];
  let x = 10;
  for (const token of tokens) {
    words.push(makeWord(token, x, pageIndex));
    x += token.length * 6 + 10;
  }
  return {
    index: pageIndex,
    width: 595,
    height: 842,
    words,
    text: tokens.map((t) => t).join(" "),
    requiresOCR: false,
    ocrCompleted: false,
  };
}

/**
 * Construye una `Page` a partir de una lista de `Word` ya armados (en vez de
 * tokens vía `makeWord`) — para tests que necesitan controlar `source`
 * (`makeOcrWord`) u otros campos del `Word` directamente.
 */
export function makePageFromWords(pageIndex: number, words: ReadonlyArray<Word>): Page {
  return {
    index: pageIndex,
    width: 595,
    height: 842,
    words,
    text: words.map((w) => w.text).join(" "),
    requiresOCR: false,
    ocrCompleted: false,
  };
}

/** Página sin texto (requiresOCR aún pendiente de fusión OCR). */
export function makeEmptyPage(pageIndex: number): Page {
  return {
    index: pageIndex,
    width: 595,
    height: 842,
    words: [],
    text: "",
    requiresOCR: true,
    ocrCompleted: false,
  };
}

export function makeDocument(id: string, pages: ReadonlyArray<Page>): Document {
  return {
    id,
    name: "test.pdf",
    pageCount: pages.length,
    pages,
    metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
    sourceKind: "text",
    importedAt: 0,
  };
}

/** Atajo: documento de una sola página con los tokens dados. */
export function makeSinglePageDocument(id: string, tokens: ReadonlyArray<string>): Document {
  return makeDocument(id, [makePage(0, tokens)]);
}
