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
  type TextMatch,
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
  RegexSearchInput,
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
  readonly fragments?: ReadonlyArray<BoundingBox>;
}

/*
 * ADR-074 §2: parte `words[firstWordIndex..lastWordIndex]` en corridas de la
 * misma línea (`sharesVerticalBand`, comparando contra la última palabra de
 * la corrida actual — que, al recorrer en orden, es siempre la palabra
 * anterior). Una sola corrida ⇒ caso normal, sin fragments. Devuelve los
 * rectángulos ordenados por (y asc, x asc), como pide la Decisión.
 */
function fragmentWordsByLine(
  words: ReadonlyArray<Word>,
  firstWordIndex: number,
  lastWordIndex: number,
): ReadonlyArray<BoundingBox> | undefined {
  const runs: Word[][] = [];
  let currentRun: Word[] = [];

  for (let i = firstWordIndex; i <= lastWordIndex; i++) {
    const word = words[i];
    if (!word) continue;
    const lastOfRun = currentRun[currentRun.length - 1];
    if (lastOfRun && !sharesVerticalBand(lastOfRun.bbox, word.bbox)) {
      runs.push(currentRun);
      currentRun = [];
    }
    currentRun.push(word);
  }
  if (currentRun.length > 0) runs.push(currentRun);

  if (runs.length <= 1) return undefined;

  const fragments = runs.map((run): BoundingBox => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const word of run) {
      minX = Math.min(minX, word.bbox.x);
      minY = Math.min(minY, word.bbox.y);
      maxX = Math.max(maxX, word.bbox.x + word.bbox.width);
      maxY = Math.max(maxY, word.bbox.y + word.bbox.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  });

  fragments.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
  return fragments;
}

function withGlobalFlag(pattern: RegExp): RegExp {
  return pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

const RUN_ALNUM_RE = /[\p{L}\p{N}]/u;
const RUN_SEPARATOR_RE = /[-./]/;
const HAS_LETTER_RE = /\p{L}/u;

function isRunChar(ch: string | undefined): boolean {
  return ch !== undefined && RUN_ALNUM_RE.test(ch);
}

/*
 * ADR-075 §2: extiende [startIndex, endIndexExclusive) hacia los dos lados,
 * a través de [\p{L}\p{N}] y de los tres separadores internos de número -, /
 * y . — un separador solo extiende la corrida si el carácter que sigue del
 * lado hacia el que se expande es alfanumérico (si no, es un borde de
 * puntuación de oración, no una continuación del identificador). Nunca mira
 * dentro de [startIndex, endIndexExclusive): un match con espacios internos
 * (phone-mobile-ar, "11 4567 8900") sigue expandiéndose solo desde sus bordes.
 */
function computeRunBounds(
  text: string,
  startIndex: number,
  endIndexExclusive: number,
): { readonly start: number; readonly end: number } {
  let start = startIndex;
  for (;;) {
    if (isRunChar(text[start - 1])) {
      start -= 1;
      continue;
    }
    if (RUN_SEPARATOR_RE.test(text[start - 1] ?? "") && isRunChar(text[start - 2])) {
      start -= 1;
      continue;
    }
    break;
  }

  let end = endIndexExclusive;
  for (;;) {
    if (isRunChar(text[end])) {
      end += 1;
      continue;
    }
    if (RUN_SEPARATOR_RE.test(text[end] ?? "") && isRunChar(text[end + 1])) {
      end += 1;
      continue;
    }
    break;
  }

  return { start, end };
}

/*
 * ADR-075 §2/§4: `true` si el match hay que conservarlo. Se descarta cuando
 * el match no tiene ninguna letra pero su corrida sí — es un tramo de un
 * identificador más largo (número de expediente, folio, etc.), no la entidad
 * que su tipo declara. La condición de aplicabilidad ("el match no tiene
 * letras") hace que la guarda se ignore sola en License/Plate/IBAN/Email —
 * esos matches siempre llevan letras — sin ninguna lista de tipos en el
 * código. Se aplica también a patrones custom (§4): es una propiedad del
 * texto, no del patrón que lo encontró.
 *
 * Se recorta el espacio de borde del propio match antes de medir (hallazgo
 * post-mergeo, Hito 10.9, escenario 8 de E2E): `phone-mobile-ar` tiene un
 * `[\s-]?` opcional ANTES de su `\b`, así que sobre "CUIT 20-12345678-9" el
 * match crudo es `" 20-12345678"`, con el espacio adentro. Sin este recorte,
 * `computeRunBounds` mide adyacencia contra `text[match.startIndex - 1]` —
 * que ahí es la "T" de "CUIT", el carácter que está ANTES del espacio, no
 * después — y la corrida se extiende por error hasta "CUIT", con letras, y
 * la guarda descarta un teléfono real. Un espacio nunca es un separador
 * válido de corrida (§2): recortarlo no cambia qué corridas con guion/punto/
 * barra se detectan, solo evita que un espacio *adentro* del match crudo se
 * lea como si no existiera.
 */
function passesRunGuard(text: string, match: RawMatch): boolean {
  if (HAS_LETTER_RE.test(match.rawValue)) return true;
  const trimmedLeft = match.rawValue.length - match.rawValue.trimStart().length;
  const trimmedRight = match.rawValue.length - match.rawValue.trimEnd().length;
  const { start, end } = computeRunBounds(
    text,
    match.startIndex + trimmedLeft,
    match.endIndexExclusive - trimmedRight,
  );
  return !HAS_LETTER_RE.test(text.slice(start, end));
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

  // ADR-074 §3: el texto rotado no se fragmenta. Si alguna Word del match
  // declara `rotation` distinta de ausente/0, la envolvente ya es ajustada
  // (el run vertical está apilado en una columna) y partir por banda vertical
  // haría lo contrario de lo que hace falta.
  const hasRotatedWord = (() => {
    for (let i = firstWordIndex; i <= lastWordIndex; i++) {
      const r = words[i]?.bbox.rotation;
      if (r !== undefined && r !== 0) return true;
    }
    return false;
  })();
  const fragments = hasRotatedWord
    ? undefined
    : fragmentWordsByLine(words, firstWordIndex, lastWordIndex);

  return {
    bbox,
    wordSpan: { startIndex: firstWordIndex, endIndexExclusive: lastWordIndex + 1 },
    // exactOptionalPropertyTypes: spread condicional, nunca `fragments: undefined`.
    ...(fragments ? { fragments } : {}),
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
  // exactOptionalPropertyTypes: wordSpan y fragments solo se incluyen si
  // existen (nunca se asigna explícitamente `undefined`).
  const withWordSpan = wordMapping ? { ...base, wordSpan: wordMapping.wordSpan } : base;
  return wordMapping?.fragments
    ? { ...withWordSpan, fragments: wordMapping.fragments }
    : withWordSpan;
}

// ─── Matcheo de texto literal (ADR-061 §1/§2, errata §8) ───────────────────
// Primitiva compartida por `searchText` y `findLiteral`: no es una corrida de
// detección, no usa `RegexPattern` ni el registro de patrones. La
// normalización (NFC + minúsculas + sin diacríticos) y el criterio de "misma
// línea" son `normalizeForComparison`/`sharesVerticalBand` de `@anonly/shared`
// (Contracts.md §6) — no se reimplementan acá (ADR-061 §2 errata).

/*
 * `Word` sale de partir el texto por whitespace (ADR-020 §1, pdf-engine y
 * ocr-engine por igual), así que un nombre pegado a puntuación sin espacio
 * ("Gorrister,") vive en un solo `Word.text = "Gorrister,"`.
 * `normalizeForComparison` no la saca (solo mayúsculas/diacríticos/espacios),
 * así que sin este recorte esas ocurrencias nunca matcheaban una búsqueda de
 * "Gorrister" limpio (ADR-061 §2, segunda errata). Se recorta solo el
 * **borde**: la puntuación interna ("O'Brien") no se toca. Se aplica a los
 * dos lados de la comparación (acá y en `slideWordWindowMatches`), no solo a
 * `Word` — si no, un resultado con puntuación pegada (p. ej. "Gorrister," en
 * un `TextMatch.text`) no se podría volver a encontrar por su propio texto
 * vía "Agregar como…" (`ui/Components.md` §5.4c).
 */
const EDGE_PUNCTUATION_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function stripEdgePunctuation(value: string): string {
  return value.replace(EDGE_PUNCTUATION_RE, "");
}

/*
 * Normaliza primero, tokeniza después: el colapso de espacios repetidos de
 * `normalizeForComparison` sale gratis (§13 caso 17), sin código extra acá.
 * Un valor vacío o solo espacios normaliza a "", cuyo único "token" del split
 * lo descarta el filter → cero tokens, sin recorrer el documento (ADR-061
 * §6/§8).
 */
function tokenizeLiteralValue(value: string): string[] {
  return normalizeForComparison(value)
    .split(" ")
    .map(stripEdgePunctuation)
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
      if (
        !word ||
        token === undefined ||
        stripEdgePunctuation(normalizeForComparison(word.text)) !== token
      ) {
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
 * La primitiva por página (checklist §15 item 10c). `searchText` y
 * `findLiteral` arman su propio recorrido de páginas alrededor de esta
 * función: así `findLiteral` conserva su chequeo de `abortSignal` **entre**
 * páginas — un núcleo por documento lo borraría en silencio (ADR-061 §8
 * errata, punto 6).
 */
function collectPageTextMatches(page: Page, queryTokens: ReadonlyArray<string>): TextMatch[] {
  const wordMatches = slideWordWindowMatches(page.words, queryTokens);
  if (wordMatches.length === 0) return [];

  const offsets = computeWordOffsets(page.words);
  const matches: TextMatch[] = [];

  for (const { startWordIndex, endWordIndexExclusive } of wordMatches) {
    const startOffset = offsets[startWordIndex];
    const endOffset = offsets[endWordIndexExclusive - 1];
    if (!startOffset || !endOffset) continue;

    const wordMapping = mapSpanToWords(page.words, startOffset.start, endOffset.end);
    if (!wordMapping) continue;

    const text = page.words
      .slice(startWordIndex, endWordIndexExclusive)
      .map((w) => w.text)
      .join(" ");

    matches.push({
      pageIndex: page.index,
      bbox: wordMapping.bbox,
      text,
      wordSpan: wordMapping.wordSpan,
    });
  }

  return matches;
}

/*
 * Agrega a un TextMatch lo que el matcheo no trae: `id`, `source: Manual`,
 * `confidence: 1.0`, el `entityType` del input y `normalizedValue` derivado
 * de `match.text` (ADR-061 §8 errata, punto 3).
 */
function buildManualOccurrence(match: TextMatch, entityType: EntityType): Occurrence {
  return {
    id: crypto.randomUUID(),
    value: match.text,
    normalizedValue: normalizeForComparison(match.text),
    bbox: match.bbox,
    pageIndex: match.pageIndex,
    source: DetectionSource.Manual,
    confidence: 1.0,
    entityType,
    wordSpan: match.wordSpan,
  };
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
        // ADR-075 §2/§4: un match sin letras dentro de una corrida con letras
        // es un tramo de un identificador más largo, no la entidad de su tipo.
        const validMatches = rawMatches.filter(
          (m) => m.checksumPassed && passesRunGuard(page.text, m),
        );
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

          for (const match of collectPageTextMatches(page, queryTokens)) {
            const occurrence = buildManualOccurrence(match, entityType);
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
   * ADR-061 §8 errata: la primitiva de solo lectura detrás de la lupa del
   * visor. Sincrónica (Contracts.md §3.5: `IPipelineOrchestrator.findText`
   * está declarado sin `Promise`) y sin `EngineContext` — no emite, no
   * cancela (una llamada sincrónica no tiene nada que cancelar), no loguea
   * la `query` (mismo criterio que el `value` de `findLiteral`, Contracts.md
   * §3.3: es texto que el usuario busca en un documento sensible). Las
   * guardas de ciclo de vida sí se conservan y, al no estar en un
   * try/Promise.reject, lanzan sincrónicamente.
   */
  searchText(input: RegexSearchInput): ReadonlyArray<TextMatch> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (input == null) {
      throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Regex });
    }

    const { document, query } = input;
    const queryTokens = tokenizeLiteralValue(query);
    if (queryTokens.length === 0) return [];

    const matches: TextMatch[] = [];
    for (const page of document.pages) {
      matches.push(...collectPageTextMatches(page, queryTokens));
    }
    return matches;
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
