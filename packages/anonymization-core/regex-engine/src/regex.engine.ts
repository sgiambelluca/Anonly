import {
  CancelledError,
  DetectionSource,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
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
import type { RegexEngineInput, RegexEngineOutput, RegexPattern } from "./regex.types.js";

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

  for (let i = firstWordIndex; i <= lastWordIndex; i++) {
    const word = words[i];
    if (!word) continue;
    minX = Math.min(minX, word.bbox.x);
    minY = Math.min(minY, word.bbox.y);
    maxX = Math.max(maxX, word.bbox.x + word.bbox.width);
    maxY = Math.max(maxY, word.bbox.y + word.bbox.height);
  }

  return {
    bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
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
  };
  // exactOptionalPropertyTypes: wordSpan solo se incluye si se pudo mapear
  // (nunca se asigna explícitamente `undefined`).
  return wordMapping ? { ...base, wordSpan: wordMapping.wordSpan } : base;
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
