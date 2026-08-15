import {
  CancelledError,
  DetectionSource,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  normalizeForComparison,
  sharesVerticalBand,
  type BoundingBox,
  type EngineContext,
  type EntityType,
  type IEngine,
  type ILogger,
  type Occurrence,
  type Page,
  type Word,
  type WordSpan,
} from "@anonly/shared";

import { DEFAULT_PATTERNS_AR } from "./patterns/default-ar.js";
import { RegexInvalidPatternError } from "./regex.errors.js";
import type {
  FindLiteralInput,
  RegexEngineInput,
  RegexEngineOutput,
  RegexPattern,
} from "./regex.types.js";

/* Regex_Engine.md §12: timeout de 1000ms por página por patrón custom. Solo
 * aplica a patrones custom (los default están fijados por el spec y son
 * confiables). Como JS es single-threaded, el "timeout" es best-effort: se
 * mide el tiempo transcurrido DESPUÉS de que la ejecución síncrona retorna
 * (no puede preemptarse a mitad de un backtracking catastrófico sin un
 * Worker — el spec §12 confirma que Regex corre en main thread, no en
 * Worker). Igual cumple el contrato: descarta el patrón con warning y no
 * bloquea a los demás. */
const CUSTOM_PATTERN_BUDGET_MS = 1000;

interface RawMatch {
  readonly patternId: string;
  readonly entityType: EntityType;
  readonly startIndex: number;
  readonly endIndexExclusive: number;
  readonly rawValue: string;
  readonly normalizedValue: string;
  readonly checksumPassed: boolean;
  readonly maskFormat: string;
}

interface WordMapping {
  readonly bbox: BoundingBox;
  readonly wordSpan: WordSpan;
}

function withGlobalFlag(pattern: RegExp): RegExp {
  return pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

/*
 * Recorre `text` con `pattern` y devuelve todos los matches crudos, ya con
 * normalizedValue y el resultado del checksum (si el patrón define uno). El
 * checksum recibe normalizedValue (no el valor crudo): es el formato
 * consistente que esperan los checksums de default-ar.ts (dígitos limpios).
 */
function runPattern(pattern: RegexPattern, text: string): RawMatch[] {
  const scanRegex = withGlobalFlag(pattern.pattern);
  scanRegex.lastIndex = 0;
  const results: RawMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = scanRegex.exec(text)) !== null) {
    const rawValue = match[0];
    if (rawValue.length === 0) {
      // Evita loop infinito si el patrón puede matchear string vacío.
      scanRegex.lastIndex += 1;
      continue;
    }
    const normalizedValue = pattern.normalizer(rawValue);
    const checksumPassed = pattern.checksum ? pattern.checksum(normalizedValue) : true;
    results.push({
      patternId: pattern.id,
      entityType: pattern.entityType,
      startIndex: match.index,
      endIndexExclusive: match.index + rawValue.length,
      rawValue,
      normalizedValue,
      checksumPassed,
      maskFormat: pattern.maskFormat,
    });
  }

  return results;
}

/*
 * Envuelve runPattern con try/catch (caso 8: regex inválida que lanza al
 * ejecutarse) y con el presupuesto de tiempo (caso 9: catastrophic
 * backtracking). En ambos casos se descarta el patrón para esa página con un
 * warning; no se propaga el error (§12: "Errores de un patrón custom no
 * bloquean los demás").
 */
function runCustomPatternWithBudget(
  pattern: RegexPattern,
  text: string,
  budgetMs: number,
  logger: ILogger,
): RawMatch[] {
  const startedAt = Date.now();
  try {
    const results = runPattern(pattern, text);
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > budgetMs) {
      logger.warn(
        `Patrón custom "${pattern.id}" excedió el presupuesto de ${budgetMs}ms (${elapsedMs}ms); se descarta para esta página.`,
        { patternId: pattern.id, elapsedMs, budgetMs },
      );
      return [];
    }
    return results;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`Patrón custom "${pattern.id}" es inválido y se descarta: ${reason}`, {
      patternId: pattern.id,
      reason,
    });
    return [];
  }
}

/*
 * Caso 10: overlap entre dos patrones (DNI dentro de CUIT) → gana el match
 * más largo en el mismo span. Algoritmo genérico (no hardcodea DNI/CUIT):
 * ordena por longitud de span descendente y hace un barrido greedy que
 * descarta cualquier match que se superponga con uno ya aceptado. Ante
 * empate de longitud, gana el de menor startIndex, y como último desempate
 * el orden original (estable).
 */
function resolveOverlaps(matches: ReadonlyArray<RawMatch>): RawMatch[] {
  const indexed = matches.map((m, i) => ({ m, i }));
  indexed.sort((a, b) => {
    const lenA = a.m.endIndexExclusive - a.m.startIndex;
    const lenB = b.m.endIndexExclusive - b.m.startIndex;
    if (lenA !== lenB) return lenB - lenA;
    if (a.m.startIndex !== b.m.startIndex) return a.m.startIndex - b.m.startIndex;
    return a.i - b.i;
  });

  const accepted: RawMatch[] = [];
  for (const { m } of indexed) {
    const overlaps = accepted.some(
      (a) => m.startIndex < a.endIndexExclusive && a.startIndex < m.endIndexExclusive,
    );
    if (!overlaps) accepted.push(m);
  }

  accepted.sort((a, b) => a.startIndex - b.startIndex);
  return accepted;
}

/*
 * Mapea un span de caracteres de Page.text (construido como
 * words.map(w => w.text).join(" "), ver 03_Data_Model.md §4) al rango de
 * Word[] que lo cubre, y calcula el bbox unión de esas palabras.
 */
function mapSpanToWords(
  words: ReadonlyArray<Word>,
  startIndex: number,
  endIndexExclusive: number,
): WordMapping | null {
  let offset = 0;
  let firstWordIndex = -1;
  let lastWordIndex = -1;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    const wordStart = offset;
    const wordEnd = wordStart + word.text.length;

    if (wordEnd > startIndex && wordStart < endIndexExclusive) {
      if (firstWordIndex === -1) firstWordIndex = i;
      lastWordIndex = i;
    }

    offset = wordEnd + 1; // +1 por el separador " " que usa Page.text.
  }

  if (firstWordIndex === -1 || lastWordIndex === -1) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // ADR-066 §6: `rotation` viaja por la cadena `Word → Occurrence →
  // Replacement` dentro del bbox, pero la unión de arriba construye un bbox
  // NUEVO a partir de escalares — sin esto el campo se cae en silencio y el
  // pintado rotado de §7 nunca se activa. Se propaga solo si TODAS las
  // palabras del match coinciden en el ángulo (en la práctica comparten uno:
  // son tokens del mismo run). Si discrepan, la envolvente de dos direcciones
  // de avance no tiene un ángulo que la describa, así que queda ausente
  // (≡ 0) y el reemplazo se pinta horizontal, como antes de este ADR.
  let rotation: BoundingBox["rotation"];
  let rotationAgrees = true;

  for (let i = firstWordIndex; i <= lastWordIndex; i++) {
    const word = words[i];
    if (!word) continue;
    minX = Math.min(minX, word.bbox.x);
    minY = Math.min(minY, word.bbox.y);
    maxX = Math.max(maxX, word.bbox.x + word.bbox.width);
    maxY = Math.max(maxY, word.bbox.y + word.bbox.height);

    if (i === firstWordIndex) rotation = word.bbox.rotation;
    else if (word.bbox.rotation !== rotation) rotationAgrees = false;
  }

  const bbox: BoundingBox = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    // exactOptionalPropertyTypes: spread condicional, nunca `rotation: undefined`.
    ...(rotationAgrees && rotation !== undefined ? { rotation } : {}),
  };

  return {
    bbox,
    wordSpan: { startIndex: firstWordIndex, endIndexExclusive: lastWordIndex + 1 },
  };
}

function buildOccurrence(match: RawMatch, page: Page): Occurrence {
  const wordMapping = mapSpanToWords(page.words, match.startIndex, match.endIndexExclusive);
  const base = {
    id: crypto.randomUUID(),
    value: match.rawValue,
    normalizedValue: match.normalizedValue,
    bbox: wordMapping?.bbox ?? { x: 0, y: 0, width: 0, height: 0 },
    pageIndex: page.index,
    source: DetectionSource.Regex,
    confidence: 1.0,
    entityType: match.entityType,
    // ADR-029: maskFormat se copia del RegexPattern que matcheó (vía RawMatch,
    // ver runPattern). Siempre es un string definido acá (RegexPattern.maskFormat
    // es obligatorio, regex.types.ts), así que se asigna directo — no necesita
    // el mismo condicional que wordSpan (cuyo valor sí puede estar ausente).
    maskFormat: match.maskFormat,
  };
  // exactOptionalPropertyTypes: wordSpan solo se incluye si se pudo mapear
  // (nunca se asigna explícitamente `undefined`).
  return wordMapping ? { ...base, wordSpan: wordMapping.wordSpan } : base;
}

// ─── findLiteral (ADR-061 §1/§2): búsqueda de un valor literal escrito o ───
// señalado por el usuario. No es una corrida de detección: no usa
// RegexPattern ni el registro de patrones, y no emite REGEX_FINISHED.
// La normalización (NFC + minúsculas + sin diacríticos) y el criterio de
// "misma línea" son `normalizeForComparison`/`sharesVerticalBand` de
// `@anonly/shared` (Contracts.md §6) — no se reimplementan acá (ADR-061 §2
// errata).

/*
 * Normaliza primero, tokeniza después: el colapso de espacios repetidos de
 * `normalizeForComparison` sale gratis (§13 caso 17), sin código extra acá.
 * Un valor vacío o solo espacios normaliza a "", cuyo único "token" del split
 * lo descarta el filter → cero tokens, findLiteral responde
 * occurrenceCount: 0 sin recorrer el documento (ADR-061 §6).
 */
function tokenizeLiteralValue(value: string): string[] {
  return normalizeForComparison(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

interface WordOffset {
  readonly start: number;
  readonly end: number;
}

/*
 * Offset de cada Word dentro de Page.text, con la misma acumulación que usa
 * mapSpanToWords puertas adentro (`words.map(w => w.text).join(" ")`, +1 por
 * el separador). Se recalcula acá porque el barrido de más abajo encuentra
 * rangos de ÍNDICE de palabra y mapSpanToWords espera un rango de OFFSET de
 * texto — la dirección inversa de lo que esa función ya resuelve.
 */
function computeWordOffsets(words: ReadonlyArray<Word>): WordOffset[] {
  const offsets: WordOffset[] = [];
  let offset = 0;
  for (const word of words) {
    const start = offset;
    const end = start + word.text.length;
    offsets.push({ start, end });
    offset = end + 1;
  }
  return offsets;
}

interface WordWindowMatch {
  readonly startWordIndex: number;
  readonly endWordIndexExclusive: number;
}

/*
 * Barrido por ventana deslizante de `queryTokens.length` palabras
 * consecutivas de `words` (mismo orden de lectura que Page.text). Devuelve
 * los rangos donde el texto normalizado de cada palabra coincide, en orden,
 * con `queryTokens` Y cada par consecutivo de la ventana comparte banda
 * vertical (`sharesVerticalBand`, `@anonly/shared`) — contiguas en
 * `Page.words` no alcanza: sin este chequeo, la última palabra de una línea
 * y la primera de la siguiente se leerían como una sola línea (§13 caso 16).
 * Avanza `queryTokens.length` posiciones tras un match (no reporta
 * solapados) y 1 posición si no matcheó.
 */
function slideWordWindowMatches(
  words: ReadonlyArray<Word>,
  queryTokens: ReadonlyArray<string>,
): WordWindowMatch[] {
  const matches: WordWindowMatch[] = [];
  if (queryTokens.length === 0 || words.length < queryTokens.length) return matches;

  let i = 0;
  while (i <= words.length - queryTokens.length) {
    let matched = true;
    for (let j = 0; j < queryTokens.length; j++) {
      const word = words[i + j];
      const token = queryTokens[j];
      if (!word || token === undefined || normalizeForComparison(word.text) !== token) {
        matched = false;
        break;
      }
      if (j > 0) {
        const previousWord = words[i + j - 1];
        if (!previousWord || !sharesVerticalBand(previousWord.bbox, word.bbox)) {
          matched = false;
          break;
        }
      }
    }
    if (matched) {
      matches.push({ startWordIndex: i, endWordIndexExclusive: i + queryTokens.length });
      i += queryTokens.length;
    } else {
      i += 1;
    }
  }
  return matches;
}

/*
 * Construye la Occurrence manual de un match. A diferencia de
 * buildOccurrence (patrones): sin maskFormat (no hay RegexPattern que lo
 * provea) y con normalizedValue calculado con el criterio genérico de arriba
 * en vez de un normalizer por tipo.
 */
function buildManualOccurrence(
  words: ReadonlyArray<Word>,
  startWordIndex: number,
  endWordIndexExclusive: number,
  wordMapping: WordMapping,
  page: Page,
  entityType: EntityType,
): Occurrence {
  const rawValue = words
    .slice(startWordIndex, endWordIndexExclusive)
    .map((w) => w.text)
    .join(" ");
  const base = {
    id: crypto.randomUUID(),
    value: rawValue,
    normalizedValue: normalizeForComparison(rawValue),
    bbox: wordMapping.bbox,
    pageIndex: page.index,
    source: DetectionSource.Manual,
    confidence: 1.0,
    entityType,
  };
  // exactOptionalPropertyTypes: wordSpan siempre está definido acá (viene de
  // un match real), pero se arma con spread para ser consistente con
  // buildOccurrence (nunca `wordSpan: undefined` explícito).
  return { ...base, wordSpan: wordMapping.wordSpan };
}

export class RegexEngine implements IEngine {
  readonly id = EngineId.Regex;

  private ctx: EngineContext | null = null;
  private customPatterns: ReadonlyArray<RegexPattern> = [];
  private customPatternIds: ReadonlySet<string> = new Set();
  private activePatterns: ReadonlyArray<RegexPattern> = DEFAULT_PATTERNS_AR;
  private initialized = false;
  private disposed = false;

  init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.customPatterns = [];
    this.customPatternIds = new Set();
    this.activePatterns = DEFAULT_PATTERNS_AR;
    this.initialized = true;
    this.disposed = false;
    ctx.logger.info("Regex Engine initialized");
    return Promise.resolve();
  }

  /*
   * No es `async`: no hay ninguna operación asincrónica real en el cuerpo
   * (todo el trabajo es cómputo síncrono sobre `Document` en memoria, §12).
   * Se envuelve en try/catch devolviendo Promise.resolve/reject explícitos
   * para conservar el contrato `Promise<RegexEngineOutput>` de §6 sin
   * disparar @typescript-eslint/require-await — mismo patrón que
   * `PdfEngine.fuseOcrPage` (pdf-engine/src/pdf.engine.ts).
   */
  process(input: RegexEngineInput, ctx: EngineContext): Promise<RegexEngineOutput> {
    try {
      this.assertNotDisposed();
      this.assertInitialized();

      if (input == null) {
        throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Regex });
      }

      const { document } = input;
      const startedAt = Date.now();

      // Caso 1 (§13): documento vacío → 0 ocurrencias, sin emitir nada.
      if (document.pages.length === 0) {
        return Promise.resolve({
          documentId: document.id,
          occurrenceCount: 0,
          durationMs: Date.now() - startedAt,
        });
      }

      let occurrenceCount = 0;

      for (const page of document.pages) {
        // Caso 11 (§13): cancelación entre páginas.
        if (ctx.abortSignal.aborted) {
          throw new CancelledError(document.id);
        }

        // Caso 2 (§13): página sin texto → 0 ocurrencias en esa página.
        if (page.text.trim().length === 0) {
          continue;
        }

        const rawMatches: RawMatch[] = [];
        for (const pattern of this.activePatterns) {
          const isCustom = this.customPatternIds.has(pattern.id);
          const patternMatches = isCustom
            ? runCustomPatternWithBudget(pattern, page.text, CUSTOM_PATTERN_BUDGET_MS, ctx.logger)
            : runPattern(pattern, page.text);
          rawMatches.push(...patternMatches);
        }

        // Casos 4-5 (§13): checksum inválido (CUIT, Luhn) descarta el match.
        const validMatches = rawMatches.filter((m) => m.checksumPassed);
        // Caso 10 (§13): overlap → gana el match más largo en el mismo span.
        const resolvedMatches = resolveOverlaps(validMatches);

        for (const match of resolvedMatches) {
          const occurrence = buildOccurrence(match, page);
          ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
            documentId: document.id,
            occurrence,
          });
          occurrenceCount++;
        }
      }

      const durationMs = Date.now() - startedAt;
      ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
        documentId: document.id,
        occurrenceCount,
        durationMs,
      });

      ctx.logger.info(`Regex Engine terminó documento ${document.id}`, {
        documentId: document.id,
        occurrenceCount,
        durationMs,
      });

      return Promise.resolve({ documentId: document.id, occurrenceCount, durationMs });
    } catch (err: unknown) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /*
   * ADR-061 §1/§6: búsqueda de un valor literal, no una corrida de
   * detección. No es `async` por la misma razón que `process` (todo el
   * trabajo es cómputo síncrono; ver el comentario sobre `process` más
   * arriba). Guardas (`assertNotDisposed`/`assertInitialized`) y manejo de
   * `AbortSignal` idénticos a `process`, pero **nunca** emite
   * `REGEX_FINISHED` ni llama a `recompileActivePatterns`/toca
   * `this.customPatterns` — ese registro es solo para patrones que
   * participan de corridas futuras (§1).
   */
  findLiteral(input: FindLiteralInput, ctx: EngineContext): Promise<RegexEngineOutput> {
    try {
      this.assertNotDisposed();
      this.assertInitialized();

      if (input == null) {
        throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Regex });
      }

      const { document, value, entityType } = input;
      const startedAt = Date.now();
      const queryTokens = tokenizeLiteralValue(value);

      let occurrenceCount = 0;

      if (queryTokens.length > 0) {
        for (const page of document.pages) {
          if (ctx.abortSignal.aborted) {
            throw new CancelledError(document.id);
          }

          const wordMatches = slideWordWindowMatches(page.words, queryTokens);
          if (wordMatches.length === 0) continue;

          const offsets = computeWordOffsets(page.words);
          for (const { startWordIndex, endWordIndexExclusive } of wordMatches) {
            const startOffset = offsets[startWordIndex];
            const endOffset = offsets[endWordIndexExclusive - 1];
            if (!startOffset || !endOffset) continue;

            const wordMapping = mapSpanToWords(page.words, startOffset.start, endOffset.end);
            if (!wordMapping) continue;

            const occurrence = buildManualOccurrence(
              page.words,
              startWordIndex,
              endWordIndexExclusive,
              wordMapping,
              page,
              entityType,
            );
            ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
              documentId: document.id,
              occurrence,
            });
            occurrenceCount++;
          }
        }
      }

      const durationMs = Date.now() - startedAt;

      // Sin log del `value` buscado: puede ser el dato sensible mismo que el
      // usuario está tratando de anonimizar (Contracts.md §3.3: "nunca
      // loguear contenido del documento").
      ctx.logger.info(`Regex Engine (findLiteral) terminó documento ${document.id}`, {
        documentId: document.id,
        entityType,
        occurrenceCount,
        durationMs,
      });

      return Promise.resolve({ documentId: document.id, occurrenceCount, durationMs });
    } catch (err: unknown) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /*
   * Runtime, para UI (§6). Valida el patrón con una ejecución de humo contra
   * un string vacío: si `pattern.pattern` lanza al ejecutarse, se considera
   * inválido (caso 8), se descarta y se lanza RegexInvalidPatternError para
   * que el caller lo capture. Patrones válidos se agregan (reemplazando
   * cualquier patrón custom previo con el mismo id) y se recompila la lista
   * activa (default ∪ custom).
   */
  addPattern(pattern: RegexPattern): void {
    this.assertNotDisposed();
    this.assertInitialized();

    try {
      withGlobalFlag(pattern.pattern).exec("");
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.ctx?.logger.warn(
        `Patrón custom "${pattern.id}" es inválido y fue descartado: ${reason}`,
        {
          patternId: pattern.id,
          reason,
        },
      );
      throw new RegexInvalidPatternError(pattern.id, reason);
    }

    this.customPatterns = [...this.customPatterns.filter((p) => p.id !== pattern.id), pattern];
    this.recompileActivePatterns();
  }

  removePattern(patternId: string): void {
    this.assertNotDisposed();
    this.assertInitialized();

    this.customPatterns = this.customPatterns.filter((p) => p.id !== patternId);
    this.recompileActivePatterns();
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.initialized = false;
    this.customPatterns = [];
    this.customPatternIds = new Set();
    this.activePatterns = [];
    this.ctx = null;
    return Promise.resolve();
  }

  private recompileActivePatterns(): void {
    this.activePatterns = [...DEFAULT_PATTERNS_AR, ...this.customPatterns];
    this.customPatternIds = new Set(this.customPatterns.map((p) => p.id));
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new EngineNotInitializedError(EngineId.Regex);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineDisposedError(EngineId.Regex);
    }
  }
}
