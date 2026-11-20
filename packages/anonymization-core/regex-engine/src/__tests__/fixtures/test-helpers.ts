/**
 * Mocks y builders compartidos por los tests de @anonly/regex-engine.
 *
 * Regex Engine no depende de ninguna librería externa (§4/§5 del spec: usa
 * `RegExp` nativo), así que a diferencia de pdf-engine/ocr-engine no hace
 * falta ningún cast de frontera (`as unknown as`) contra una librería de
 * terceros — no hay ninguno en este archivo.
 */
import {
  DEFAULT_DETECTION_CONFIG,
  EngineEvents,
  EntityType,
  type DetectionConfig,
  type Document,
  type EngineContext,
  type EntityFound,
  type EntityTypeId,
  type FormatDefinition,
  type FormatPiece,
  type Occurrence,
  type Page,
  type UserEntityTypeDefinition,
  type Word,
} from "@anonly/shared";
import { createEngineContext, createMockConfig } from "@anonly/test-utils";
import { vi } from "vitest";

import { RegexEngine } from "../../regex.engine.js";

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

/**
 * Variante de `makePageFromWords` donde cada token es una palabra con el
 * `source` indicado (`"ocr"` por defecto; `"pdf"` para mezclar orígenes), con
 * la misma geometría que `makePage`. Para el caso 35 (ADR-211), que depende
 * del origen de las palabras del span.
 */
export function makeSourcedPage(
  pageIndex: number,
  tokens: ReadonlyArray<string | { readonly text: string; readonly source: "pdf" | "ocr" }>,
): Page {
  const words: Word[] = [];
  let x = 10;
  for (const token of tokens) {
    const { text, source } =
      typeof token === "string" ? { text: token, source: "ocr" as const } : token;
    words.push(
      source === "ocr" ? makeOcrWord(text, x, pageIndex) : makeWord(text, x, pageIndex),
    );
    x += text.length * 6 + 10;
  }
  return makePageFromWords(pageIndex, words);
}

/**
 * Corre `process` sobre un documento de una sola página y devuelve las
 * `Occurrence` de `ENTITY_FOUND` en el orden en que se emitieron.
 */
export async function processPage(
  engine: RegexEngine,
  ctx: EngineContext,
  page: Page,
): Promise<ReadonlyArray<Occurrence>> {
  const busEmitSpy = vi.spyOn(ctx.bus, "emit");
  // Vitest 4 reutiliza un mock existente, con sus llamadas anteriores.
  busEmitSpy.mockClear();
  await engine.process({ document: makeDocument(`doc-${Math.random()}`, [page]) }, ctx);
  return busEmitSpy.mock.calls
    .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
    .map(([, , payload]) => (payload as EntityFound).occurrence);
}

/**
 * Corre `process` sobre una oración (un token por palabra separada por un
 * espacio, como `Page.text`) y devuelve el `value` de cada `Address` emitida,
 * en el orden en que se emitieron. Para el caso 36 (ADR-217).
 */
export async function addressValuesOf(
  engine: RegexEngine,
  ctx: EngineContext,
  sentence: string,
): Promise<ReadonlyArray<string>> {
  const occurrences = await processPage(engine, ctx, makePage(0, sentence.split(" ")));
  return occurrences.filter((o) => o.entityType === EntityType.Address).map((o) => o.value);
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

// ─── Formatos del generador (1.1, ADR-220) ───

/** Un tipo propio de prueba. */
export const CBU_TYPE: UserEntityTypeDefinition = {
  id: "user:5b6f0f2e-6d0e-4c3b-8f4a-2f6a1c9d7e01",
  name: "CBU",
};

export const LEGAJO_TYPE: UserEntityTypeDefinition = {
  id: "user:5b6f0f2e-6d0e-4c3b-8f4a-2f6a1c9d7e02",
  name: "Legajo",
};

/** `fmt:` + UUID v4 determinista, para que `validateFormat` lo acepte. */
export function formatIdOf(n: number): string {
  return `fmt:00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

export const digits = (min: number, max = min): FormatPiece => ({
  kind: "chars",
  charClass: "digit",
  min,
  max,
});
export const letters = (min: number, max = min): FormatPiece => ({
  kind: "chars",
  charClass: "letter",
  min,
  max,
});
export const fixedText = (value: string): FormatPiece => ({ kind: "text", value });
export const separator = (
  chars: ReadonlyArray<" " | "-" | "." | "/">,
  optional = false,
): FormatPiece => ({ kind: "separator", chars, optional });
export const optionalOf = (...pieces: ReadonlyArray<FormatPiece>): FormatPiece => ({
  kind: "optional",
  pieces,
});

/** Un `FormatDefinition` válido de una sola variante, prendido y bajo el tipo dado. */
export function makeFormat(
  n: number,
  entityType: EntityTypeId,
  pieces: ReadonlyArray<FormatPiece>,
  overrides: Partial<FormatDefinition> = {},
): FormatDefinition {
  return {
    id: formatIdOf(n),
    name: `Formato ${n}`,
    entityType,
    variants: [pieces],
    enabled: true,
    ...overrides,
  };
}

/**
 * Corre `process` sobre una página con los formatos dados (más los base de
 * siempre) y devuelve solo las ocurrencias que salieron de un formato propio.
 * `text` se parte por espacios, como `Page.text`.
 */
export async function userFormatOccurrences(
  formats: ReadonlyArray<FormatDefinition>,
  text: string,
  userTypes: ReadonlyArray<UserEntityTypeDefinition> = [CBU_TYPE, LEGAJO_TYPE],
): Promise<ReadonlyArray<Occurrence>> {
  const engine = new RegexEngine();
  const ctx = createDetectionContext({ userTypes, userFormats: formats });
  await engine.init(ctx);
  const occurrences = await processPage(engine, ctx, makePage(0, text.split(" ")));
  await engine.dispose();
  return occurrences.filter((occurrence) => occurrence.formatOrigin === "user");
}

/** `EngineContext` con `config.detection` armada a partir de `DEFAULT_DETECTION_CONFIG`. */
export function createDetectionContext(
  detection: Partial<DetectionConfig>,
  overrides?: Partial<EngineContext>,
): EngineContext {
  return createEngineContext({
    config: createMockConfig({ detection: { ...DEFAULT_DETECTION_CONFIG, ...detection } }),
    ...overrides,
  });
}
