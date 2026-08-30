import {
  CancelledError,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  type BoundingBox,
  type Document,
  type DocumentMetadata,
  type EngineContext,
  type IEngine,
  type ILogger,
  type OcrRegion,
  type Page,
  type PdfEngineConfig,
  type Word,
} from "@anonly/shared";
import { getDocument, OPS, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";

import {
  PdfCorruptedError,
  PdfInvalidError,
  PdfPasswordRequiredError,
  PdfTimeoutError,
} from "./pdf.errors.js";
import type { PdfEngineInput, PdfEngineOutput } from "./pdf.types.js";

const DEFAULT_MAX_PAGE_COUNT = 10_000;
const DEFAULT_TIMEOUT_MS_PER_PAGE = 30_000;

/**
 * Prefijos first-party de los assets de pdfjs-dist que sirve la app bajo
 * `/pdfjs/` (ADR-053 §3/§4/§5, copiados de `node_modules` en `predev`/
 * `prebuild` de `apps/react-client` — PR B1 de ADR-053 §9). Constantes de
 * módulo, NO un campo de `EngineConfig` (mismo patrón que
 * `NER_LOCAL_MODEL_PATH`/`NER_WASM_PATH` en `ner-engine/src/worker/kernel.ts`
 * y que `RENDER_PDFJS_CMAP_URL`/`RENDER_PDFJS_STANDARD_FONT_DATA_URL` en
 * `render-engine/src/worker/kernel.ts`): `public/` se copia verbatim, sin
 * hashear, así que pdfjs-dist resuelve estos 169 archivos por nombre contra
 * un prefijo estable — no hace falta que el Core los conozca por config.
 */
const PDF_ENGINE_PDFJS_CMAP_URL = "/pdfjs/cmaps/";
const PDF_ENGINE_PDFJS_STANDARD_FONT_DATA_URL = "/pdfjs/standard_fonts/";

/**
 * `CMapReaderFactory` propia para `getDocument()` (ADR-053 §2/§5, trampa 2 de
 * Contexto §6): pdf.js instancia la CLASE que se le pasa en
 * `CMapReaderFactory` — nunca una instancia —, así que esto es exactamente lo
 * que necesita, ni más ni menos. Usa `fetch()` pelado: a diferencia de
 * `DOMCMapReaderFactory` de pdf.js (no exportada por el paquete, por eso no se
 * extiende — solo se implementa su forma), NUNCA referencia `document`, que no
 * existe dentro del `PdfWorker` (ADR-036 §2/`05_Worker_Architecture.md` §7.1).
 * Contrato (ADR-053 §2, verificado contra `pdfjs-dist@4.10.38/build/pdf.mjs`
 * líneas 6032-6060, `BaseCMapReaderFactory`): constructor
 * `{ baseUrl, isCompressed }`, `fetch({ name })` ->
 * `{ cMapData: Uint8Array, isCompressed }`, URL = `baseUrl + name +
 * (isCompressed ? ".bcmap" : "")`. Duplicada intencionalmente respecto de la
 * homónima de `render-engine` (no se importa de ahí: P-2 lo prohíbe).
 */
export class PdfEngineCMapReaderFactory {
  private readonly baseUrl: string;
  private readonly isCompressed: boolean;

  constructor(params: { readonly baseUrl: string; readonly isCompressed: boolean }) {
    this.baseUrl = params.baseUrl;
    this.isCompressed = params.isCompressed;
  }

  async fetch(params: {
    readonly name: string;
  }): Promise<{ readonly cMapData: Uint8Array; readonly isCompressed: boolean }> {
    const url = `${this.baseUrl}${params.name}${this.isCompressed ? ".bcmap" : ""}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`No se pudo cargar el CMap en ${url} (status ${response.status}).`);
    }
    const buffer = await response.arrayBuffer();
    return { cMapData: new Uint8Array(buffer), isCompressed: this.isCompressed };
  }
}

/**
 * `StandardFontDataFactory` propia para `getDocument()` (ADR-053 §2/§5, misma
 * trampa 2 que la factory de arriba): reemplaza a `DOMStandardFontDataFactory`
 * de pdf.js, que toca `document.baseURI` en su primer fetch. Contrato
 * (ADR-053 §2, verificado contra `pdf.mjs` líneas 6407-6431,
 * `BaseStandardFontDataFactory`): constructor `{ baseUrl }`, `fetch({
 * filename })` -> `Uint8Array`, URL = `baseUrl + filename`. Duplicada
 * intencionalmente respecto de la homónima de `render-engine` (P-2).
 */
export class PdfEngineStandardFontDataFactory {
  private readonly baseUrl: string;

  constructor(params: { readonly baseUrl: string }) {
    this.baseUrl = params.baseUrl;
  }

  async fetch(params: { readonly filename: string }): Promise<Uint8Array> {
    const url = `${this.baseUrl}${params.filename}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `No se pudo cargar la fuente estándar en ${url} (status ${response.status}).`,
      );
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }
}

/* TextContent from pdfjs-dist has items: Array<TextItem | TextMarkedContent>.
 * TextMarkedContent (type/id only) is filtered out in convertTextItemsToWords.
 * The `as` cast at the call site is valid because the structural subset
 * (optional str/transform/width/height) is compatible with both TextItem and
 * TextMarkedContent shapes. */
type TextContentLike = {
  items: ReadonlyArray<{
    str?: string;
    transform?: readonly number[];
    width?: number;
    height?: number;
    fontName?: string;
  }>;
  /* ADR-109 §1: `TextStyle` de pdfjs-dist, indexado por `item.fontName`.
   * Opcional porque el camino de anotaciones (ADR-066 §1) arma su propio
   * `TextContentLike` a mano y no tiene de dónde sacarlo. */
  styles?: Readonly<Record<string, { ascent?: number; descent?: number }>>;
};

/*
 * Funciones de módulo (ADR-013 §6, ADR-020 §10): parsePage() y sus helpers no
 * asumen host ni worker — Hito 9 las envuelve en un job del worker sin
 * modificarlas. No emiten eventos: la emisión queda en process() (host).
 */

async function parsePageTextWithTimeout(
  pageProxy: PDFPageProxy,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
): Promise<TextContentLike> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new PdfTimeoutError(documentId, pageIndex, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([pageProxy.getTextContent(), timeoutPromise]);
    return result as TextContentLike;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

interface Vector2 {
  readonly x: number;
  readonly y: number;
}

/*
 * ADR-063 §1: versores de avance (dir) y ascenso (up) desde la parte lineal
 * [a, b, c, d] de la matriz de PDF.js. Degenerado (magnitud 0, §13 caso 20):
 * cae al comportamiento horizontal en vez de dividir por cero.
 */
function unitVectorOrDefault(x: number, y: number, fallback: Vector2): Vector2 {
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) return fallback;
  return { x: x / magnitude, y: y / magnitude };
}

/*
 * ADR-066 §6/§8: `rotation` sale del mismo versor de avance (`dir`) que la
 * envolvente ya calcula — no es un cálculo nuevo, es exponer uno que hoy se
 * descarta. Se puebla SOLO para 90/180/270: en 0° queda AUSENTE a propósito
 * (ausente ≡ 0, Contracts.md §5) — así ningún bbox horizontal existente
 * cambia de forma y el snapshot de `snapshot.test.ts` no se mueve (ADR-066
 * Validación: "rotation ausente en texto horizontal"). Fuera de los tres
 * ángulos rectos no nulos (con una tolerancia chica para ruido de punto
 * flotante) también queda ausente — es la envolvente conservadora de
 * ADR-063 §2, no la caja real, así que no hay ángulo confiable que reportar.
 */
const RIGHT_ANGLE_TOLERANCE_DEG = 1e-6;
const POPULATED_ROTATIONS: readonly (90 | 180 | 270)[] = [90, 180, 270];

function deriveRotation(dir: Vector2): 90 | 180 | 270 | undefined {
  const angleDeg = ((Math.atan2(dir.y, dir.x) * 180) / Math.PI + 360) % 360;
  for (const candidate of POPULATED_ROTATIONS) {
    if (Math.abs(angleDeg - candidate) < RIGHT_ANGLE_TOLERANCE_DEG) return candidate;
  }
  return undefined;
}

/*
 * ADR-063 §2: el bbox de un run/token es la envolvente axis-aligned del
 * paralelogramo origin -> +dir·width -> +up·height, convertida a origen
 * arriba-izquierda (y = pageHeight - yMax). Con dir=(1,0)/up=(0,1) (0°) se
 * reduce carácter por carácter a la fórmula anterior a ADR-063 (§13 caso 21):
 * no hay regresión para texto horizontal.
 */
function boundingBoxFromParallelogram(
  origin: Vector2,
  dir: Vector2,
  up: Vector2,
  width: number,
  height: number,
  pageHeight: number,
): BoundingBox {
  const corners: readonly Vector2[] = [
    origin,
    { x: origin.x + dir.x * width, y: origin.y + dir.y * width },
    { x: origin.x + up.x * height, y: origin.y + up.y * height },
    {
      x: origin.x + dir.x * width + up.x * height,
      y: origin.y + dir.y * width + up.y * height,
    },
  ];

  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const rotation = deriveRotation(dir);
  return {
    x: xMin,
    y: pageHeight - yMax,
    width: xMax - xMin,
    height: yMax - yMin,
    ...(rotation !== undefined ? { rotation } : {}),
  };
}

/*
 * ADR-109 §1: cuánto sube y cuánto baja la tinta de una fuente respecto de su
 * línea de base, en fracciones de cuerpo. `descent` se normaliza a positivo
 * (pdf.js lo reporta negativo, hacia abajo).
 */
interface FontExtents {
  readonly ascent: number;
  readonly descent: number;
}

/*
 * ADR-109 §2: métricas utilizables, o `undefined` si el productor no las
 * declara de forma aprovechable. Relevado sobre 10 documentos (4266 items),
 * `undefined` aplica a 2 — la fuente del código de barras de una carátula.
 */
function fontExtentsOf(
  styles: TextContentLike["styles"],
  fontName: string | undefined,
): FontExtents | undefined {
  if (styles === undefined || fontName === undefined) return undefined;
  const style = styles[fontName];
  if (style === undefined) return undefined;
  const { ascent, descent } = style;
  if (typeof ascent !== "number" || typeof descent !== "number") return undefined;
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return undefined;
  if (ascent <= 0 || descent >= 0) return undefined;
  return { ascent, descent: -descent };
}

/*
 * ADR-109 §1: la caja de tinta de un token — el mismo paralelogramo de
 * ADR-063 §2, pero arrancando un descenso por debajo de la línea de base y
 * llegando hasta el ascenso en vez de hasta un cuerpo entero.
 *
 * Sin métricas cae a la caja previa a ADR-109. Bajar solo el piso, dejando el
 * techo en un cuerpo, NO es alternativa: medido sobre 752 pares de renglones
 * consecutivos, fusiona el 75,8 % de los pares de un documento con
 * interlineado de 1,15 cuerpos, y `sharesVerticalBand` es la definición de
 * "misma línea" de tres motores.
 */
function inkBoxFromParallelogram(
  origin: Vector2,
  dir: Vector2,
  up: Vector2,
  width: number,
  height: number,
  pageHeight: number,
  extents: FontExtents | undefined,
): BoundingBox {
  if (extents === undefined) {
    return boundingBoxFromParallelogram(origin, dir, up, width, height, pageHeight);
  }
  const drop = extents.descent * height;
  const baseline: Vector2 = { x: origin.x - up.x * drop, y: origin.y - up.y * drop };
  const inkHeight = (extents.ascent + extents.descent) * height;
  return boundingBoxFromParallelogram(baseline, dir, up, width, inkHeight, pageHeight);
}

/*
 * ADR-020 §1: PDF.js devuelve un TextItem por run (frecuentemente línea/frase
 * entera), no por palabra. Se divide str por whitespace en Words individuales,
 * prorrateando el avance linealmente por longitud de caracteres (aproximación:
 * asume ancho de carácter constante dentro del run). Con un solo token, se
 * conserva el bbox del item completo (comportamiento previo) y solo se aplica
 * normalización NFC (ADR-020 §2). ADR-063 §3: el prorrateo corre sobre el eje
 * de avance (dir), no sobre x — para dir=(1,0) las dos expresiones coinciden.
 */
/** ADR-102 §2: ancho de un token = suma de los avances de sus glifos. */
function sumGlyphAdvances(
  glyphs: ReadonlyArray<PageGlyph>,
  mapping: ReadonlyArray<number>,
  from: number,
  to: number,
): number {
  let total = 0;
  for (let i = from; i < to; i += 1) {
    const glyph = glyphs[mapping[i] ?? -1];
    if (glyph !== undefined) total += glyph.advance;
  }
  return total;
}

/*
 * ADR-097 §5: cuántos items multi-palabra encontraron su lugar en el flujo. Solo esos
 * consultan la tabla, así que solo esos aportan a la pregunta que decide si
 * alguna vez conviene la opción B de `Post_Hito10.8_Pendientes.md` §24.
 */
interface TextRunJoinStats {
  readonly eligible: number;
  readonly joined: number;
}

interface ConvertedTextItems {
  readonly words: ReadonlyArray<Word>;
  readonly joinStats: TextRunJoinStats;
}

function convertTextItemsToWords(
  textContent: TextContentLike,
  pageIndex: number,
  pageHeight: number,
  originCorrections: ReadonlyArray<TextOriginCorrection> = [],
  glyphs: ReadonlyArray<PageGlyph> = [],
  glyphIndex: GlyphIndex = new Map(),
): ConvertedTextItems {
  const words: Word[] = [];
  let eligible = 0;
  let joined = 0;

  for (const item of textContent.items) {
    if (!item.str || item.str.trim().length === 0 || !item.transform) continue;

    const str = item.str;
    const reportedX = item.transform[4] ?? 0;
    const reportedY = item.transform[5] ?? 0;
    // ADR-068: si el origen reportado coincide con uno que se sabe desplazado
    // por el word spacing, se usa el que dibuja el renderer. Sin coincidencia
    // —el caso de todo documento sin `Tw`— el item queda intacto.
    const correction = originCorrections.find(
      (c) =>
        Math.abs(c.from.x - reportedX) <= ORIGIN_CORRECTION_EPSILON &&
        Math.abs(c.from.y - reportedY) <= ORIGIN_CORRECTION_EPSILON,
    );
    const originX = correction?.to.x ?? reportedX;
    const originY = correction?.to.y ?? reportedY;
    const width = item.width ?? 0;
    const height = item.height ?? 12;
    const dir = unitVectorOrDefault(item.transform[0] ?? 0, item.transform[1] ?? 0, {
      x: 1,
      y: 0,
    });
    const up = unitVectorOrDefault(item.transform[2] ?? 0, item.transform[3] ?? 0, {
      x: 0,
      y: 1,
    });

    const extents = fontExtentsOf(textContent.styles, item.fontName);
    const tokens = [...str.matchAll(/\S+/g)];

    if (tokens.length <= 1) {
      const text = (tokens[0]?.[0] ?? str).normalize("NFC");
      const bbox = inkBoxFromParallelogram(
        { x: originX, y: originY },
        dir,
        up,
        width,
        height,
        pageHeight,
        extents,
      );
      words.push({ text, bbox, pageIndex, confidence: 1.0, source: "pdf" });
      continue;
    }

    /*
     * ADR-102 §2: se ubica el arranque del item en el flujo de glifos y se
     * alinea carácter a carácter. Si alinea, el origen y el ancho de cada
     * token salen de los glifos reales; si no, queda el ancho promedio de
     * ADR-020 §1 — el camino de reserva, intacto (ADR-102 §4).
     */
    eligible++;
    /*
     * ADR-108 §4: `getTextContent` aplica `Tw` a todo espacio y el flujo solo a
     * los que lo llevan (§1), así que en un run con espacios iniciales de
     * fuente compuesta los dos orígenes difieren — 58,3 pt en la línea de la
     * fecha de la pericia. Ese es exactamente el par que mide ADR-068: el
     * reportado es `from` y el que dibuja el renderer es `to`. Se busca por el
     * reportado y, si no cae en ningún glifo, por el corregido.
     */
    const reportedStart = findGlyphAt(glyphs, glyphIndex, reportedX, reportedY);
    const start =
      reportedStart >= 0 || correction === undefined
        ? reportedStart
        : findGlyphAt(glyphs, glyphIndex, originX, originY);
    const mapping = start < 0 ? undefined : alignToGlyphs(glyphs, str, start);
    if (mapping !== undefined) joined++;
    const charWidth = str.length > 0 ? width / str.length : 0;
    for (const token of tokens) {
      const tokenText = token[0];
      if (tokenText === undefined) continue;
      const offset = token.index ?? 0;
      const end = offset + tokenText.length;
      const anchor = mapping === undefined ? undefined : glyphs[mapping[offset] ?? -1];
      const advance = charWidth * offset;
      const tokenWidth =
        mapping === undefined
          ? charWidth * tokenText.length
          : sumGlyphAdvances(glyphs, mapping, offset, end);
      const tokenOrigin: Vector2 =
        anchor !== undefined
          ? { x: anchor.x, y: anchor.y }
          : { x: originX + dir.x * advance, y: originY + dir.y * advance };
      const bbox = inkBoxFromParallelogram(
        tokenOrigin,
        dir,
        up,
        tokenWidth,
        height,
        pageHeight,
        extents,
      );
      words.push({
        text: tokenText.normalize("NFC"),
        bbox,
        pageIndex,
        confidence: 1.0,
        source: "pdf",
      });
    }
  }

  return { words, joinStats: { eligible, joined } };
}

/*
 * ADR-067 §1: tolerancia de "misma línea" del orden de lectura, y —espejada
 * sobre el eje transversal— de "misma columna" para un run rotado.
 */
const SAME_LINE_TOLERANCE = 1;

/*
 * ADR-067 §2: hueco máximo, en cuerpos del glifo, entre dos palabras
 * consecutivas de un mismo run rotado. Medido sobre la firma de la pericia:
 * los huecos reales de un espacio van de 0,44 a 0,58 cuerpos, y el que separa
 * la marca de agua del run `Date:` —que comparten columna por 1,1 pt— es de
 * 30. Dos órdenes de margen para los dos lados.
 */
const ROTATED_RUN_GAP_IN_EMS = 2;

type Rotation = NonNullable<BoundingBox["rotation"]>;

/** Comparador de los runs rotados (`y` asc con tolerancia, luego `x` asc). */
function compareByReadingOrder(a: BoundingBox, b: BoundingBox): number {
  const dy = a.y - b.y;
  if (Math.abs(dy) > SAME_LINE_TOLERANCE) return dy;
  return a.x - b.x;
}

/*
 * ADR-109 §3: el texto horizontal se ordena por línea de base, no por el techo
 * de la caja. Con la caja de tinta el techo depende del ascenso de cada
 * fuente: en una pericia conviven ascensos 0,688 y 0,905, que sobre un cuerpo
 * de 8,09 pt son 1,76 pt de diferencia EN LA MISMA LÍNEA — por encima de la
 * tolerancia, así que el comparador partiría la línea al medio.
 *
 * Sobre la caja previa a ADR-109 `y + height` era exactamente la línea de
 * base, así que este comparador da el mismo orden que el anterior.
 */
function compareByBaseline(a: BoundingBox, b: BoundingBox): number {
  const dy = a.y + a.height - (b.y + b.height);
  if (Math.abs(dy) > SAME_LINE_TOLERANCE) return dy;
  return a.x - b.x;
}

/*
 * ADR-067 §2: eje perpendicular al avance — el que identifica la columna de un
 * run. Para 90/270 el texto corre sobre `y`, así que la columna es `x`; para
 * 180 corre sobre `x` y la "columna" es la línea `y`.
 */
function crossAxisOf(bbox: BoundingBox, rotation: Rotation): number {
  return rotation === 180 ? bbox.y : bbox.x;
}

/** Cuerpo del glifo: la extensión del bbox sobre el eje transversal. */
function emSizeOf(bbox: BoundingBox, rotation: Rotation): number {
  return rotation === 180 ? bbox.height : bbox.width;
}

/*
 * Coordenadas del bbox sobre el eje de avance, en el sentido en que se lee:
 * un run a 90° avanza hacia arriba en pantalla (`y` decreciente), así que
 * "empieza" en el borde inferior y "termina" en el superior.
 */
function advanceStartOf(bbox: BoundingBox, rotation: Rotation): number {
  if (rotation === 90) return bbox.y + bbox.height;
  if (rotation === 270) return bbox.y;
  return bbox.x + bbox.width;
}

function advanceEndOf(bbox: BoundingBox, rotation: Rotation): number {
  if (rotation === 90) return bbox.y;
  if (rotation === 270) return bbox.y + bbox.height;
  return bbox.x;
}

/** ADR-067 §3: orden dentro de un run, en su dirección de avance. */
function compareAlongAdvance(a: BoundingBox, b: BoundingBox, rotation: Rotation): number {
  if (rotation === 90) return b.y - a.y;
  if (rotation === 270) return a.y - b.y;
  return b.x - a.x;
}

/*
 * ADR-067 §2: parte una columna ya ordenada por avance allí donde el hueco
 * entre dos palabras consecutivas supera `ROTATED_RUN_GAP_IN_EMS` cuerpos.
 * Es el criterio que separa dos runs independientes que comparten columna —
 * sin él el resultado dependería de la tolerancia transversal, o sea de 0,1 pt
 * sobre el documento medido.
 */
function splitColumnOnAdvanceGap(column: ReadonlyArray<Word>, rotation: Rotation): Word[][] {
  const runs: Word[][] = [];
  let current: Word[] = [];

  for (const word of column) {
    const previous = current[current.length - 1];
    if (previous !== undefined) {
      const gap = Math.abs(
        advanceStartOf(word.bbox, rotation) - advanceEndOf(previous.bbox, rotation),
      );
      if (gap > ROTATED_RUN_GAP_IN_EMS * emSizeOf(previous.bbox, rotation)) {
        runs.push(current);
        current = [];
      }
    }
    current.push(word);
  }

  if (current.length > 0) runs.push(current);
  return runs;
}

/*
 * ADR-067 §2: agrupa los words rotados en runs. Primero por ángulo (dos
 * rotaciones distintas nunca son el mismo run), después por columna
 * —coordenada transversal con la misma tolerancia que usa la rama
 * horizontal— y por último por contigüidad sobre el eje de avance.
 */
function buildRotatedRuns(words: ReadonlyArray<Word>): Word[][] {
  const byRotation = new Map<Rotation, Word[]>();
  for (const word of words) {
    const rotation = word.bbox.rotation;
    if (rotation === undefined || rotation === 0) continue;
    const bucket = byRotation.get(rotation);
    if (bucket === undefined) byRotation.set(rotation, [word]);
    else bucket.push(word);
  }

  const runs: Word[][] = [];
  for (const [rotation, bucket] of byRotation) {
    const byColumn = [...bucket].sort(
      (a, b) => crossAxisOf(a.bbox, rotation) - crossAxisOf(b.bbox, rotation),
    );

    let column: Word[] = [];
    let previousCross: number | undefined;
    const flushColumn = (): void => {
      if (column.length === 0) return;
      column.sort((a, b) => compareAlongAdvance(a.bbox, b.bbox, rotation));
      runs.push(...splitColumnOnAdvanceGap(column, rotation));
      column = [];
    };

    for (const word of byColumn) {
      const cross = crossAxisOf(word.bbox, rotation);
      if (previousCross !== undefined && Math.abs(cross - previousCross) > SAME_LINE_TOLERANCE) {
        flushColumn();
      }
      column.push(word);
      previousCross = cross;
    }
    flushColumn();
  }

  return runs;
}

/*
 * ADR-067: el orden se ramifica por `bbox.rotation`. Sin rotación (ausente o
 * `0`, `Contracts.md` §5) es exactamente el orden histórico. Con rotación, los
 * words se agrupan en runs (§2) y se ordenan en su dirección de avance (§3).
 *
 * ADR-067 §4 (corrección 2026-08-13): los runs se emiten DESPUÉS de todo el
 * texto horizontal, en dos pasadas separadas — nunca intercalados. La primera
 * redacción los ubicaba por el ancla, dentro del mismo `sort` que las palabras
 * horizontales, y eso podía **partir una línea horizontal al medio**: el
 * comparador tiene tolerancia de 1 y por lo tanto no es transitivo, así que un
 * ancla que cae dentro de la tolerancia de una palabra de la línea pero fuera
 * de la de otra se encaja entre las dos. `mapSpanToWords` une todo el rango de
 * índices de un match, con lo que el bbox de una entidad partida se tragaba el
 * run entero — verificado: una ocurrencia en `x = 250` salía en `x = 10`, 240
 * pt corrida hacia el margen izquierdo.
 *
 * Separar las pasadas hace que el orden relativo del texto horizontal sea
 * IDÉNTICO al previo a ADR-067 en cualquier página, tenga o no texto rotado
 * —ningún ancla ajena participa de su `sort`—, que es una garantía de no
 * regresión más fuerte que la que daba la versión anterior. De paso elimina el
 * mismo riesgo que ya existía ANTES del ADR, cuando cada word rotado se
 * ordenaba suelto entre las líneas horizontales.
 */
function sortWordsByReadingOrder(words: ReadonlyArray<Word>): Word[] {
  const horizontal = words.filter(
    (word) => word.bbox.rotation === undefined || word.bbox.rotation === 0,
  );
  horizontal.sort((a, b) => compareByBaseline(a.bbox, b.bbox));

  if (horizontal.length === words.length) return horizontal;

  // Los runs se ordenan entre sí por el bbox de su primera palabra en orden de
  // lectura (la de más abajo en un run a 90°), con el mismo comparador.
  const runs = buildRotatedRuns(words);
  // `as Word` es narrowing seguro (Code_Standards.md §2): `splitColumnOnAdvanceGap`
  // solo empuja arrays con al menos un elemento —nunca `push` de un `current`
  // vacío—, así que `[0]` de un run siempre existe.
  runs.sort((a, b) => compareByReadingOrder((a[0] as Word).bbox, (b[0] as Word).bbox));

  return [...horizontal, ...runs.flat()];
}

// ─── Compuertas de OCR por región (ADR-065 §1, PDF_Engine.md §12) ───

const OCR_REGION_MIN_IMAGE_AREA_RATIO = 0.01; // filtro por rectángulo, nunca sobre el agregado
const OCR_REGION_GRID_SIZE = 64;
const OCR_REGION_WORD_DILATION_HORIZONTAL = 0.5; // × altura del glifo, por lado
const OCR_REGION_WORD_DILATION_VERTICAL = 0.8; // × altura del glifo, por lado
const OCR_REGION_MIN_EMPTY_AREA_RATIO = 0.4; // del área de la imagen, no de la página
const OCR_REGION_MIN_SIDE_PT = 100;

type Matrix2D = readonly [number, number, number, number, number, number];
const IDENTITY_MATRIX_2D: Matrix2D = [1, 0, 0, 1, 0, 0];

/*
 * Composición de matrices PDF [a,b,c,d,e,f] (misma convención que
 * `Util.transform` de pdfjs-dist): aplicar el resultado a un punto equivale a
 * aplicar `inner` y después `outer`. Usada para mantener la CTM vigente
 * mientras se recorre el operator list simulando save/restore/transform.
 */
function composeMatrix(outer: Matrix2D, inner: Matrix2D): Matrix2D {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

function applyMatrix(m: Matrix2D, x: number, y: number): Vector2 {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/*
 * ADR-065 §1: "aplicándola [la CTM] al cuadrado unidad sale el rectángulo de
 * esa imagen en puntos de página". Envolvente axis-aligned de los cuatro
 * vértices, convertida a origen arriba-izquierda (mismo patrón que
 * `boundingBoxFromParallelogram`, ADR-063 §2).
 */
function imageRectFromCTM(ctm: Matrix2D, pageHeight: number): BoundingBox {
  const corners: readonly Vector2[] = [
    applyMatrix(ctm, 0, 0),
    applyMatrix(ctm, 1, 0),
    applyMatrix(ctm, 0, 1),
    applyMatrix(ctm, 1, 1),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  return { x: xMin, y: pageHeight - yMax, width: xMax - xMin, height: yMax - yMin };
}

/*
 * Forma mínima de `PDFOperatorList` (pdfjs-dist tipa `argsArray` como
 * `Array<any>` — este tipo local evita propagar `any`, mismo criterio que
 * `TextContentLike` arriba).
 */
type OperatorListLike = {
  readonly fnArray: ReadonlyArray<number>;
  readonly argsArray: ReadonlyArray<unknown>;
};

/*
 * ADR-065 §1: ops de pintado de imagen. `OPS.paintJpegXObject`, nombrado en
 * PDF_Engine.md §12/ADR-065 §1, NO existe en `pdfjs-dist@4.10.38` (la misma
 * versión que cita el ADR): no está en el namespace `OPS` exportado
 * (`types/src/shared/util.d.ts`) ni se emite nunca en el operator-list
 * builder (`build/pdf.worker.mjs`) — cada rama de imagen usa
 * `paintImageXObject`/`paintImageMaskXObject`/`paintInlineImageXObject`,
 * nunca un cuarto op; el valor histórico 82 está salteado en la numeración
 * actual (entre `endAnnotation`=81 y `paintImageMaskXObject`=83). Las
 * imágenes JPEG comparten `paintImageXObject` con el resto. Documentado acá
 * para quien audite contra el spec, que sí lo nombra — ver informe del PR.
 */
const IMAGE_PAINT_OPS: ReadonlySet<number> = new Set([
  OPS.paintImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintInlineImageXObject,
]);

function isNumberArray(value: unknown): value is ReadonlyArray<number> {
  return Array.isArray(value) && value.every((v) => typeof v === "number");
}

function toMatrix2D(args: ReadonlyArray<number>): Matrix2D {
  return [args[0] ?? 1, args[1] ?? 0, args[2] ?? 0, args[3] ?? 1, args[4] ?? 0, args[5] ?? 0];
}

/*
 * ADR-066 §2/§5: rastrea la CTM vigente mientras se recorre el operator list,
 * con DOS pilas independientes — la trampa 2 de ADR-066, Contexto §3. Fuera
 * de una anotación, `current` es la CTM de página de siempre (compuerta 1,
 * ADR-065 §1, sin cambios de comportamiento). Dentro de
 * beginAnnotation/endAnnotation, `current` es
 * `beginAnnotation.transform × CTM_de_página` compuesta con los
 * transform/save/restore internos de la anotación: esa pila NUNCA toca la de
 * página, porque las dos anidaciones no están balanceadas entre sí (una
 * anotación puede tener más `restore` que `save`, o viceversa, sin que eso
 * desincronice el resto de la página).
 */
class CtmTracker {
  private pageCurrent: Matrix2D = IDENTITY_MATRIX_2D;
  private readonly pageStack: Matrix2D[] = [];

  private insideAnnotationFlag = false;
  private annotationCurrent: Matrix2D = IDENTITY_MATRIX_2D;
  private readonly annotationStack: Matrix2D[] = [];

  get current(): Matrix2D {
    return this.insideAnnotationFlag ? this.annotationCurrent : this.pageCurrent;
  }

  get isInsideAnnotation(): boolean {
    return this.insideAnnotationFlag;
  }

  save(): void {
    if (this.insideAnnotationFlag) {
      this.annotationStack.push(this.annotationCurrent);
    } else {
      this.pageStack.push(this.pageCurrent);
    }
  }

  restore(): void {
    if (this.insideAnnotationFlag) {
      this.annotationCurrent = this.annotationStack.pop() ?? IDENTITY_MATRIX_2D;
    } else {
      this.pageCurrent = this.pageStack.pop() ?? IDENTITY_MATRIX_2D;
    }
  }

  transform(m: Matrix2D): void {
    if (this.insideAnnotationFlag) {
      this.annotationCurrent = composeMatrix(this.annotationCurrent, m);
    } else {
      this.pageCurrent = composeMatrix(this.pageCurrent, m);
    }
  }

  // ADR-066 §2: beginAnnotation.transform × CTM (CTM = la de página vigente
  // en este punto del recorrido lineal). El resultado queda seedeado en la
  // pila de anotación, que arranca vacía e independiente.
  beginAnnotation(transform: Matrix2D): void {
    this.insideAnnotationFlag = true;
    this.annotationCurrent = composeMatrix(this.pageCurrent, transform);
    this.annotationStack.length = 0;
  }

  endAnnotation(): void {
    this.insideAnnotationFlag = false;
    this.annotationCurrent = IDENTITY_MATRIX_2D;
    this.annotationStack.length = 0;
  }
}

// ADR-066 §2, Contexto §3: forma de los argumentos de `beginAnnotation`
// ([id, rect, transform, matrix, isUsingOwnCanvas]) — solo se usan los tres
// primeros; `matrix` (Matrix de la appearance stream) y `isUsingOwnCanvas` no
// participan de la cadena de composición que este ADR fija.
interface BeginAnnotationArgs {
  readonly id: string;
  readonly rect: readonly [number, number, number, number];
  readonly transform: Matrix2D;
}

function parseBeginAnnotationArgs(args: unknown): BeginAnnotationArgs | undefined {
  if (!Array.isArray(args) || args.length < 3) return undefined;
  const [id, rect, transform] = args as ReadonlyArray<unknown>;
  if (typeof id !== "string") return undefined;
  if (!isNumberArray(rect) || rect.length < 4) return undefined;
  if (!isNumberArray(transform) || transform.length < 6) return undefined;
  return {
    id,
    rect: [rect[0] ?? 0, rect[1] ?? 0, rect[2] ?? 0, rect[3] ?? 0],
    transform: toMatrix2D(transform),
  };
}

// El `rect` de beginAnnotation viaja en el mismo espacio que `item.transform`
// (origen abajo-izquierda, y-up); se convierte a origen arriba-izquierda con
// el mismo patrón que el resto del módulo (ADR-066 §3, el oráculo).
function annotationRectToBoundingBox(
  rect: readonly [number, number, number, number],
  pageHeight: number,
): BoundingBox {
  const [x0, y0, x1, y1] = rect;
  const xMin = Math.min(x0, x1);
  const xMax = Math.max(x0, x1);
  const yMin = Math.min(y0, y1);
  const yMax = Math.max(y0, y1);
  return { x: xMin, y: pageHeight - yMax, width: xMax - xMin, height: yMax - yMin };
}

/*
 * ADR-066 §3 (Corrección 2026-08-10): el oráculo es de SOLAPAMIENTO, no de
 * contención estricta. El versor de ascenso extiende la caja del glifo más
 * allá de la línea de base, y el `rect` de una anotación está ajustado a la
 * tinta visible — un word legítimo puede salirse una fracción de punto (0,66
 * pt medido sobre la firma real, que con contención estricta se descartaba
 * entera). El umbral (intersección ≥ 50% del área del word) separa ese caso
 * (91,8% de solapamiento) de los dos modos de falla de composición medidos
 * en Contexto §3 (0% con `x = -679`, fuera de la página; solapamiento
 * marginal con `y = 0`, borde inferior) — casi dos órdenes de margen para
 * los dos lados.
 */
const ANNOTATION_RECT_OVERLAP_RATIO = 0.5;

function overlapRatioWithRect(word: BoundingBox, rect: BoundingBox): number {
  const overlapWidth = Math.max(
    0,
    Math.min(word.x + word.width, rect.x + rect.width) - Math.max(word.x, rect.x),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(word.y + word.height, rect.y + rect.height) - Math.max(word.y, rect.y),
  );
  const wordArea = word.width * word.height;
  if (wordArea <= 0) return 0;
  return (overlapWidth * overlapHeight) / wordArea;
}

function overlapsAnnotationRectEnough(word: BoundingBox, rect: BoundingBox): boolean {
  return overlapRatioWithRect(word, rect) >= ANNOTATION_RECT_OVERLAP_RATIO;
}

interface AnnotationTextRun {
  readonly str: string;
  readonly transform: Matrix2D;
  readonly width: number;
  readonly height: number;
}

/*
 * ADR-066 §2 (corrección 2026-08-13): estado de texto de una anotación.
 *
 * La primera redacción componía `textMatrix × transformInterno ×
 * beginAnnotation.transform × CTM` y solo poblaba `textMatrix` desde
 * `setTextMatrix` (Tm). Eso alcanza para un appearance stream **aplanado**,
 * donde el cuerpo del glifo va metido en la escala de `Tm`; no alcanza para el
 * idioma normal de PDF, que pone el cuerpo en `Tf` y la posición en `Td`.
 *
 * El mismo documento en sus dos versiones lo muestra:
 *
 *   aplanado:  setTextMatrix [8,0,0,8,0,42.66] + setFont [f, 1]
 *   original:  setFont [f, 8]                  + moveText [0, 42.66]
 *
 * Con solo `Tm`, el original sale con cuerpo 1 en vez de 8, avances 8 veces
 * cortos y los cinco runs apilados en el mismo origen — cajas de 1 pt de ancho
 * en el lugar equivocado.
 *
 * La regla de PDF 32000-1 §9.4.4 es
 * `Trm = [Tfs·Th, 0, 0, Tfs, 0, Ts] × Tm × CTM`, y es la que se implementa:
 * `Tm` sigue viniendo de `setTextMatrix`/`moveText`/`nextLine`, y el cuerpo
 * (`Tfs`) y el escalado horizontal (`Th`) se aplican como factores. Las dos
 * formas quedan cubiertas por la misma fórmula.
 */
class TextState {
  private matrix: Matrix2D = IDENTITY_MATRIX_2D;
  private lineMatrix: Matrix2D = IDENTITY_MATRIX_2D;
  fontSize = 1; // Tfs
  horizontalScale = 1; // Th (Tz/100)
  charSpacing = 0; // Tc
  wordSpacing = 0; // Tw
  private leading = 0; // TL

  get textMatrix(): Matrix2D {
    return this.matrix;
  }

  /** BT: Tm y Tlm vuelven a la identidad. El cuerpo NO se resetea (Tf sobrevive a BT/ET). */
  beginText(): void {
    this.matrix = IDENTITY_MATRIX_2D;
    this.lineMatrix = IDENTITY_MATRIX_2D;
  }

  /** Tm: fija las dos matrices. */
  setMatrix(m: Matrix2D): void {
    this.matrix = m;
    this.lineMatrix = m;
  }

  /** Td: Tlm = translate(tx, ty) × Tlm; Tm = Tlm. */
  moveText(tx: number, ty: number): void {
    this.lineMatrix = composeMatrix(this.lineMatrix, [1, 0, 0, 1, tx, ty]);
    this.matrix = this.lineMatrix;
  }

  /** TD: como Td, y además fija el interlineado en -ty. */
  moveTextSetLeading(tx: number, ty: number): void {
    this.leading = -ty;
    this.moveText(tx, ty);
  }

  setLeading(value: number): void {
    this.leading = value;
  }

  /** T*: Td(0, -TL). */
  nextLine(): void {
    this.moveText(0, -this.leading);
  }

  /** Estado que `save`/`restore` preservan (el resto es por bloque BT/ET). */
  snapshotGraphicsState(): TextGraphicsState {
    return {
      fontSize: this.fontSize,
      horizontalScale: this.horizontalScale,
      charSpacing: this.charSpacing,
      wordSpacing: this.wordSpacing,
    };
  }

  restoreGraphicsState(s: TextGraphicsState): void {
    this.fontSize = s.fontSize;
    this.horizontalScale = s.horizontalScale;
    this.charSpacing = s.charSpacing;
    this.wordSpacing = s.wordSpacing;
  }
}

interface TextGraphicsState {
  readonly fontSize: number;
  readonly horizontalScale: number;
  readonly charSpacing: number;
  readonly wordSpacing: number;
}

/*
 * ADR-068: corrección del origen que reporta `getTextContent`.
 *
 * `getTextContent()` aplica el word spacing (`Tw`) a los espacios que después
 * DESCARTA del `str`, y el renderer no lo aplica: para un run con espacios
 * iniciales y `Tw ≠ 0`, el `transform` del item queda a la izquierda de donde
 * el glifo se dibuja de verdad. Medido sobre la pericia: 90 espacios con
 * `Tw = -0,505618` desplazan el origen 58,3 pt — el reemplazo cae fuera del
 * texto.
 *
 * La corrección se expresa como un par de puntos: `from` es el origen que
 * `getTextContent` va a reportar (se reproduce exacto: 190,20 contra 190,20
 * medido) y `to` el que dibuja el renderer (248,93 contra 248,5 de tinta
 * real). `convertTextItemsToWords` solo corrige un item cuando su origen
 * coincide con un `from` — si la reproducción no acierta, el item queda
 * intacto y el comportamiento es el de siempre.
 */
interface TextOriginCorrection {
  readonly from: Vector2;
  readonly to: Vector2;
}

/** Tolerancia del match contra el origen reportado por `getTextContent`. */
const ORIGIN_CORRECTION_EPSILON = 0.05;

/*
 * ADR-102 §1: el flujo CONTINUO de glifos de una página, en orden de dibujo.
 *
 * Sin fronteras de run a propósito: las fronteras eran el problema.
 * `getTextContent()` re-segmenta el texto en fronteras propias, distintas de
 * las de dibujo, en una relación de muchos a muchos — medido, exigir que
 * coincidan (ADR-097 §2) acierta en el 0,2 % de los items de un cuento y en
 * el 2,9 % de los de un fallo judicial.
 */
interface PageGlyph {
  readonly unicode: string; // exactamente un carácter
  readonly x: number; // posición absoluta, espacio de página
  readonly y: number;
  readonly advance: number; // su propio avance, en unidades de página
}

/*
 * Índice por posición cuantizada, para no pagar O(items × glifos) en una
 * página densa. El bucket es de 0,1 pt y la tolerancia de 0,05, así que un
 * candidato válido cae en el bucket propio o en uno adyacente.
 */
const GLYPH_BUCKET = 10;

type GlyphIndex = ReadonlyMap<string, ReadonlyArray<number>>;

function indexGlyphs(glyphs: ReadonlyArray<PageGlyph>): GlyphIndex {
  const index = new Map<string, number[]>();
  for (let i = 0; i < glyphs.length; i += 1) {
    const glyph = glyphs[i];
    if (glyph === undefined) continue;
    const key = `${Math.round(glyph.x * GLYPH_BUCKET)}|${Math.round(glyph.y * GLYPH_BUCKET)}`;
    const bucket = index.get(key);
    if (bucket === undefined) index.set(key, [i]);
    else bucket.push(i);
  }
  return index;
}

/** Primer glifo cuya posición coincide con `(x, y)`, o `-1`. */
function findGlyphAt(
  glyphs: ReadonlyArray<PageGlyph>,
  index: GlyphIndex,
  x: number,
  y: number,
): number {
  const baseX = Math.round(x * GLYPH_BUCKET);
  const baseY = Math.round(y * GLYPH_BUCKET);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = index.get(`${baseX + dx}|${baseY + dy}`);
      if (bucket === undefined) continue;
      for (const i of bucket) {
        const glyph = glyphs[i];
        if (
          glyph !== undefined &&
          Math.abs(glyph.x - x) <= ORIGIN_CORRECTION_EPSILON &&
          Math.abs(glyph.y - y) <= ORIGIN_CORRECTION_EPSILON
        ) {
          return i;
        }
      }
    }
  }
  return -1;
}

/*
 * ADR-102 §2: alinea `str` con el flujo a partir de `from`, devolviendo el
 * índice de glifo de cada carácter (`-1` para los que no tienen glifo), o
 * `undefined` si la alineación no llega hasta el final.
 *
 * Las dos segmentaciones no coinciden en cuántos espacios ven, y la tolerancia
 * va para los dos lados:
 *
 * - un espacio de la CADENA sin glifo detrás es uno que pdf.js sintetizó
 *   porque el productor separó las palabras moviendo el cursor (ADR-102 §2);
 * - un espacio del FLUJO que la cadena no trae es uno que pdf.js colapsó
 *   (ADR-108 §2). Se saltea la corrida entera de espacios y se reintenta.
 *
 * ADR-102 §3: esta alineación **es** el guard, y sigue siéndolo — todo
 * carácter visible exige su glifo exacto en orden. Lo único tolerante es la
 * cantidad de espacios, que es justo donde las segmentaciones difieren.
 */
function isBlankGlyph(glyph: PageGlyph | undefined): boolean {
  return glyph !== undefined && glyph.unicode.trim().length === 0;
}

function alignToGlyphs(
  glyphs: ReadonlyArray<PageGlyph>,
  str: string,
  from: number,
): ReadonlyArray<number> | undefined {
  const mapping: number[] = [];
  let cursor = from;
  for (const char of str) {
    if (glyphs[cursor]?.unicode === char) {
      mapping.push(cursor);
      cursor += 1;
      continue;
    }

    let ahead = cursor;
    while (isBlankGlyph(glyphs[ahead])) ahead += 1;
    if (ahead > cursor && glyphs[ahead]?.unicode === char) {
      mapping.push(ahead);
      cursor = ahead + 1;
      continue;
    }

    if (char === " ") {
      mapping.push(-1);
      continue;
    }
    return undefined;
  }
  return mapping;
}

/*
 * ADR-102 §1: agrega al flujo los glifos de un run de página, con su posición
 * absoluta y su avance ya en unidades de página.
 *
 * El avance por glifo es el de ADR-097 §1, verificado contra las métricas AFM
 * de Helvetica, MÁS el word spacing de ADR-108 §1. Que `Tw` faltara corría el
 * flujo ~1,2 pt por espacio, acumulativo dentro del run: sobre el encabezado
 * de una pericia la séptima palabra caía 9,0 pt a la derecha de su tinta, y
 * eso afectaba por igual a los items que empalmaban y a los que no. ADR-097 §4
 * queda superseded; su aritmética (§1), el prorrateo de reserva (§3) y la
 * instrumentación del empalme (§5) siguen.
 */
function appendRunGlyphs(into: PageGlyph[], args: unknown, text: TextState, ctm: Matrix2D): void {
  if (!Array.isArray(args) || args.length === 0) return;
  const glyphs: unknown = args[0];
  if (!Array.isArray(glyphs)) return;

  const composed = composeMatrix(ctm, text.textMatrix);
  const scale = Math.hypot(composed[0], composed[1]);
  const dirX = scale === 0 ? 1 : composed[0] / scale;
  const dirY = scale === 0 ? 0 : composed[1] / scale;

  let accumulated = 0;
  for (const glyph of glyphs as ReadonlyArray<unknown>) {
    if (typeof glyph === "number") {
      // Ajuste de kerning de un TJ: avanza sin aportar carácter.
      accumulated += (-glyph / 1000) * text.fontSize * text.horizontalScale;
      continue;
    }
    if (!isRecord(glyph) || typeof glyph.unicode !== "string") continue;
    const width = typeof glyph.width === "number" ? glyph.width : 0;
    const wordSpacing = glyphTakesWordSpacing(glyph) ? text.wordSpacing : 0;
    const step =
      ((width / 1000) * text.fontSize + text.charSpacing + wordSpacing) * text.horizontalScale;
    const x = composed[4] + dirX * accumulated * scale;
    const y = composed[5] + dirY * accumulated * scale;
    // Una ligadura aporta su avance completo en el PRIMER carácter; los
    // siguientes quedan en la misma posición con avance 0, así que ningún
    // token arranca adentro de la ligadura.
    let first = true;
    for (const char of glyph.unicode) {
      into.push({ unicode: char, x, y, advance: first ? step * scale : 0 });
      first = false;
    }
    accumulated += step;
  }
}

function isWhitespaceGlyph(glyph: unknown): boolean {
  if (!isRecord(glyph)) return false;
  return typeof glyph.unicode === "string" && glyph.unicode.trim().length === 0;
}

/*
 * ADR-108 §1: a qué glifo le toca el word spacing. PDF 32000-1 §9.3.3 lo
 * restringe al código de **un byte** 32: en una fuente compuesta el espacio de
 * dos bytes NO lo lleva. pdf.js ya resuelve eso y lo deja en `glyph.isSpace`,
 * y su propio renderer decide con esa misma bandera
 * (`(glyph.isSpace ? wordSpacing : 0) + charSpacing`). Espejarla es lo que
 * pone al flujo de acuerdo con la tinta, y no es una heurística: es la misma
 * línea que dibuja.
 *
 * Medido sobre la pericia: el run de la fecha tiene 96 espacios y solo 7 con
 * `isSpace`. Tratarlos a todos por igual corría la caja 58,3 pt.
 */
function glyphTakesWordSpacing(glyph: Record<string, unknown>): boolean {
  return glyph["isSpace"] === true;
}

/*
 * ADR-068: avance, en espacio de texto, de los glifos que preceden al primer
 * glifo visible de un run. Devuelve los dos totales —con y sin aplicar `Tw`—
 * porque la diferencia entre ambos ES el error de `getTextContent`.
 */
function leadingAdvance(
  glyphs: ReadonlyArray<unknown>,
  text: TextState,
): { readonly withWordSpacing: number; readonly withoutWordSpacing: number } {
  let withWordSpacing = 0;
  let withoutWordSpacing = 0;

  for (const glyph of glyphs) {
    if (typeof glyph === "number") {
      // Ajuste de kerning de un TJ: desplaza igual en los dos escenarios.
      const kerning = (-glyph / 1000) * text.fontSize * text.horizontalScale;
      withWordSpacing += kerning;
      withoutWordSpacing += kerning;
      continue;
    }
    if (!isWhitespaceGlyph(glyph)) break; // primer glifo visible: se corta
    const width = isRecord(glyph) && typeof glyph.width === "number" ? glyph.width : 0;
    const base = ((width / 1000) * text.fontSize + text.charSpacing) * text.horizontalScale;
    // `to` tiene que quedar donde el flujo pone el primer glifo visible, así que
    // usa la misma regla de `Tw` que él (ADR-108 §1); `from` reproduce lo que
    // reporta `getTextContent`, que lo aplica a todo espacio.
    const drawn = isRecord(glyph) && glyphTakesWordSpacing(glyph);
    withoutWordSpacing += base + (drawn ? text.wordSpacing * text.horizontalScale : 0);
    withWordSpacing += base + text.wordSpacing * text.horizontalScale;
  }

  return { withWordSpacing, withoutWordSpacing };
}

/*
 * ADR-068: par `from`/`to` para un run de página, o `undefined` si no hay nada
 * que corregir (sin `Tw`, sin espacios iniciales, o diferencia despreciable).
 */
function buildOriginCorrection(
  args: unknown,
  text: TextState,
  ctm: Matrix2D,
): TextOriginCorrection | undefined {
  if (text.wordSpacing === 0) return undefined;
  if (!Array.isArray(args) || args.length === 0) return undefined;
  const glyphs: unknown = args[0];
  if (!Array.isArray(glyphs)) return undefined;

  const advance = leadingAdvance(glyphs as ReadonlyArray<unknown>, text);
  const delta = advance.withoutWordSpacing - advance.withWordSpacing;
  if (Math.abs(delta) < ORIGIN_CORRECTION_EPSILON) return undefined;

  const composed = composeMatrix(ctm, text.textMatrix);
  const origin: Vector2 = { x: composed[4], y: composed[5] };
  const displace = (amount: number): Vector2 => ({
    x: origin.x + composed[0] * amount,
    y: origin.y + composed[1] * amount,
  });

  return { from: displace(advance.withWordSpacing), to: displace(advance.withoutWordSpacing) };
}

/*
 * ADR-066 §1, Contexto §2: reconstruye un run de `showText`/`showSpacedText`
 * dentro de una anotación. `args[0]` es el array de glifos que pdf.js ya
 * resolvió (cada uno con `.unicode`/`.width`; los números sueltos son
 * ajustes de kerning de un TJ y se ignoran — no aportan texto y su aporte al
 * avance es marginal frente a la aproximación de ancho uniforme que ADR-020
 * §1 ya acepta para el resto del módulo).
 *
 * `width`/`height` no vienen dados (a diferencia de `getTextContent()`, este
 * operator list no trae `item.width`/`item.height`): se derivan igual que el
 * resto de la geometría del módulo, de la matriz compuesta. `height` es la
 * magnitud del versor de ascenso (el mismo "cuerpo" que ADR-066, Contexto §3
 * verifica a mano: cuerpo 8 para `[0,8,-8,0,...]`). `width` suma el `.width`
 * de cada glifo —unidades de glifo, 1/1000 em, la convención universal de PDF
 * fuera de fuentes Type3 (PDF 32000-1 §9.2.4)— escalado por la magnitud del
 * versor de avance, que ya incluye cualquier escala de `Tm`/CTM acumulada.
 */
function buildAnnotationTextRun(
  args: unknown,
  text: TextState,
  ctm: Matrix2D,
): AnnotationTextRun | undefined {
  if (!Array.isArray(args) || args.length === 0) return undefined;
  const glyphs: unknown = args[0];
  if (!Array.isArray(glyphs)) return undefined;

  let str = "";
  let totalGlyphWidth = 0;
  for (const glyph of glyphs as ReadonlyArray<unknown>) {
    if (typeof glyph === "number") continue; // ajuste de kerning (TJ), ver comentario arriba
    if (!isRecord(glyph)) continue;
    if (typeof glyph.unicode === "string") str += glyph.unicode;
    if (typeof glyph.width === "number") totalGlyphWidth += glyph.width;
  }
  if (str.trim().length === 0) return undefined;

  // ADR-066 §2 (corrección): Trm = [Tfs·Th, 0, 0, Tfs, 0, Ts] × Tm × CTM. El
  // cuerpo y el escalado horizontal entran como factores sobre las magnitudes
  // de `Tm × CTM`, así que cubren tanto el appearance stream aplanado (cuerpo
  // en la escala de Tm, Tfs = 1) como el idioma normal (Tfs = cuerpo, Tm de
  // Td). Ver el doc de `TextState`.
  const composed = composeMatrix(ctm, text.textMatrix);
  const dirMagnitude = Math.hypot(composed[0], composed[1]) * text.fontSize * text.horizontalScale;
  const upMagnitude = Math.hypot(composed[2], composed[3]) * text.fontSize;

  return {
    str,
    transform: composed,
    width: (totalGlyphWidth / 1000) * dirMagnitude,
    height: upMagnitude,
  };
}

interface AnnotationsAndImages {
  readonly imageRects: ReadonlyArray<BoundingBox>;
  readonly annotationWords: ReadonlyArray<Word>;
  // ADR-068: origen real de los runs de PÁGINA cuyo `transform` de
  // `getTextContent` viene desplazado por el word spacing.
  readonly originCorrections: ReadonlyArray<TextOriginCorrection>;
  // ADR-102 §1: flujo continuo de glifos de la página, en orden de dibujo.
  readonly pageGlyphs: ReadonlyArray<PageGlyph>;
}

/*
 * Pasada única sobre el operator list que ya pide la compuerta 1 (ADR-065
 * §1): compone la CTM con la pila dual de CtmTracker y produce, a la vez,
 * (a) el texto de las anotaciones (ADR-066 §1-§4) y (c) los rectángulos de
 * imagen de la compuerta 1, corregidos para aplicar el `transform` de
 * `beginAnnotation` cuando la imagen está dentro de una anotación (ADR-066
 * §5). No hay una segunda llamada a `getOperatorList()` ni una pila
 * compartida entre página y anotación (ADR-066 §2).
 */
function walkOperatorListForAnnotationsAndImages(
  operatorList: OperatorListLike,
  pageIndex: number,
  pageHeight: number,
  documentId: string,
  logger: ILogger,
): AnnotationsAndImages {
  const ctm = new CtmTracker();
  const imageRects: BoundingBox[] = [];
  const annotationWords: Word[] = [];
  const originCorrections: TextOriginCorrection[] = [];
  const pageGlyphs: PageGlyph[] = [];

  const text = new TextState();
  // El cuerpo y el escalado horizontal son estado gráfico: `save`/`restore` los
  // preservan (ADR-066 §2, corrección). El appearance stream real envuelve cada
  // run en su propio `save`/`restore`.
  const textStateStack: ReturnType<TextState["snapshotGraphicsState"]>[] = [];
  let currentAnnotationRect: BoundingBox | undefined;
  let currentAnnotationId = "";

  const { fnArray, argsArray } = operatorList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === OPS.save) {
      ctm.save();
      textStateStack.push(text.snapshotGraphicsState());
    } else if (fn === OPS.restore) {
      ctm.restore();
      const restored = textStateStack.pop();
      if (restored !== undefined) text.restoreGraphicsState(restored);
    } else if (fn === OPS.transform) {
      if (isNumberArray(args) && args.length >= 6) {
        ctm.transform(toMatrix2D(args));
      }
    } else if (fn === OPS.beginAnnotation) {
      const parsed = parseBeginAnnotationArgs(args);
      if (parsed !== undefined) {
        ctm.beginAnnotation(parsed.transform);
        currentAnnotationRect = annotationRectToBoundingBox(parsed.rect, pageHeight);
        currentAnnotationId = parsed.id;
      } else {
        // Forma inesperada de beginAnnotation: se preserva la separación de
        // pilas (trampa 2) igual, pero sin rect no hay oráculo contra el que
        // validar (ADR-066 §3), así que no se extrae texto de esta anotación.
        ctm.beginAnnotation(IDENTITY_MATRIX_2D);
        currentAnnotationRect = undefined;
        currentAnnotationId = "";
      }
      text.beginText();
      text.fontSize = 1;
      text.horizontalScale = 1;
      textStateStack.length = 0;
    } else if (fn === OPS.endAnnotation) {
      ctm.endAnnotation();
      currentAnnotationRect = undefined;
      currentAnnotationId = "";
      text.beginText();
      textStateStack.length = 0;
    } else if (fn === OPS.beginText) {
      text.beginText();
    } else if (fn === OPS.setTextMatrix) {
      if (isNumberArray(args) && args.length >= 6) {
        text.setMatrix(toMatrix2D(args));
      }
    } else if (fn === OPS.setFont) {
      // args = [nombre, tamaño]; el tamaño es Tfs (ADR-066 §2, corrección).
      const size = Array.isArray(args) ? (args as ReadonlyArray<unknown>)[1] : undefined;
      if (typeof size === "number" && Number.isFinite(size)) text.fontSize = size;
    } else if (fn === OPS.setHScale) {
      const scale = Array.isArray(args) ? (args as ReadonlyArray<unknown>)[0] : undefined;
      if (typeof scale === "number" && Number.isFinite(scale)) text.horizontalScale = scale / 100;
    } else if (fn === OPS.setCharSpacing) {
      const value = Array.isArray(args) ? (args as ReadonlyArray<unknown>)[0] : undefined;
      if (typeof value === "number" && Number.isFinite(value)) text.charSpacing = value;
    } else if (fn === OPS.setWordSpacing) {
      const value = Array.isArray(args) ? (args as ReadonlyArray<unknown>)[0] : undefined;
      if (typeof value === "number" && Number.isFinite(value)) text.wordSpacing = value;
    } else if (fn === OPS.moveText) {
      if (isNumberArray(args) && args.length >= 2) text.moveText(args[0] ?? 0, args[1] ?? 0);
    } else if (fn === OPS.setLeadingMoveText) {
      if (isNumberArray(args) && args.length >= 2)
        text.moveTextSetLeading(args[0] ?? 0, args[1] ?? 0);
    } else if (fn === OPS.setLeading) {
      const leading = Array.isArray(args) ? (args as ReadonlyArray<unknown>)[0] : undefined;
      if (typeof leading === "number" && Number.isFinite(leading)) text.setLeading(leading);
    } else if (fn === OPS.nextLine) {
      text.nextLine();
    } else if (ctm.isInsideAnnotation && (fn === OPS.showText || fn === OPS.showSpacedText)) {
      const run = buildAnnotationTextRun(args, text, ctm.current);
      if (run !== undefined) {
        // ADR-097 §3: el camino de anotaciones NO usa la tabla de avances —
        // acá la cadena y la geometría salen de la misma fuente, así que no
        // hay dos fuentes que empalmar.
        const { words } = convertTextItemsToWords(
          {
            items: [
              { str: run.str, transform: run.transform, width: run.width, height: run.height },
            ],
          },
          pageIndex,
          pageHeight,
        );
        for (const word of words) {
          if (currentAnnotationRect === undefined) continue;
          if (overlapsAnnotationRectEnough(word.bbox, currentAnnotationRect)) {
            annotationWords.push(word);
          } else {
            // ADR-066 §3: si la composición falló, la posición no es
            // confiable — se descarta en vez de recortar al rect.
            logger.warn("Word de anotación fuera del rect: se descarta (ADR-066 §3).", {
              documentId,
              pageIndex,
              annotationId: currentAnnotationId,
            });
          }
        }
      }
    } else if (!ctm.isInsideAnnotation && (fn === OPS.showText || fn === OPS.showSpacedText)) {
      // ADR-068: el texto de página lo extrae `getTextContent()`; de este
      // recorrido salen la corrección del origen (ver `buildOriginCorrection`)
      // y —ADR-102 §1— los glifos del run, al flujo continuo de la página.
      const correction = buildOriginCorrection(args, text, ctm.current);
      if (correction !== undefined) originCorrections.push(correction);
      appendRunGlyphs(pageGlyphs, args, text, ctm.current);
    } else if (fn !== undefined && IMAGE_PAINT_OPS.has(fn)) {
      // ADR-066 §5: `ctm.current` ya aplica beginAnnotation.transform cuando
      // la imagen está dentro de una anotación — corrige el defecto latente
      // de ADR-065, Contexto §4.
      imageRects.push(imageRectFromCTM(ctm.current, pageHeight));
    }
  }

  return { imageRects, annotationWords, originCorrections, pageGlyphs };
}

// Filtro por rectángulo (ADR-065 §1): descarta imágenes < 1% del área de
// página, evaluado por rectángulo individual — nunca sobre el agregado.
function isLargeEnoughImage(rect: BoundingBox, pageWidth: number, pageHeight: number): boolean {
  const pageArea = pageWidth * pageHeight;
  if (pageArea <= 0) return false;
  const rectArea = Math.max(0, rect.width) * Math.max(0, rect.height);
  return rectArea / pageArea >= OCR_REGION_MIN_IMAGE_AREA_RATIO;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/*
 * Dilatación de un bbox nativo (ADR-065 §1): 0,5× el cuerpo del glifo
 * (bbox.height) por lado en horizontal, 0,8× por lado en vertical — evita que
 * el interlineado cuente como hueco.
 */
function dilatedWordBBox(bbox: BoundingBox): BoundingBox {
  const dx = bbox.height * OCR_REGION_WORD_DILATION_HORIZONTAL;
  const dy = bbox.height * OCR_REGION_WORD_DILATION_VERTICAL;
  return {
    x: bbox.x - dx,
    y: bbox.y - dy,
    width: bbox.width + 2 * dx,
    height: bbox.height + 2 * dy,
  };
}

interface CellRect {
  readonly rowStart: number;
  readonly rowEnd: number; // inclusive
  readonly colStart: number;
  readonly colEnd: number; // inclusive
}

// Grilla de 64×64 celdas de LA PÁGINA (ADR-065 §1): true = celda cubierta por
// el bbox dilatado de alguna palabra nativa.
function buildOccupancyGrid(
  words: ReadonlyArray<Word>,
  pageWidth: number,
  pageHeight: number,
): boolean[][] {
  const grid: boolean[][] = Array.from({ length: OCR_REGION_GRID_SIZE }, () =>
    new Array<boolean>(OCR_REGION_GRID_SIZE).fill(false),
  );
  if (pageWidth <= 0 || pageHeight <= 0) return grid;

  const cellWidth = pageWidth / OCR_REGION_GRID_SIZE;
  const cellHeight = pageHeight / OCR_REGION_GRID_SIZE;

  for (const word of words) {
    const dilated = dilatedWordBBox(word.bbox);
    const range = cellRangeOf(dilated, cellWidth, cellHeight);

    for (let row = range.rowStart; row <= range.rowEnd; row++) {
      const gridRow = grid[row];
      if (gridRow === undefined) continue;
      for (let col = range.colStart; col <= range.colEnd; col++) {
        gridRow[col] = true;
      }
    }
  }

  return grid;
}

function cellRangeOf(rect: BoundingBox, cellWidth: number, cellHeight: number): CellRect {
  const colStart = clamp(Math.floor(rect.x / cellWidth), 0, OCR_REGION_GRID_SIZE - 1);
  const colEnd = clamp(
    Math.ceil((rect.x + rect.width) / cellWidth) - 1,
    0,
    OCR_REGION_GRID_SIZE - 1,
  );
  const rowStart = clamp(Math.floor(rect.y / cellHeight), 0, OCR_REGION_GRID_SIZE - 1);
  const rowEnd = clamp(
    Math.ceil((rect.y + rect.height) / cellHeight) - 1,
    0,
    OCR_REGION_GRID_SIZE - 1,
  );
  return { rowStart, rowEnd, colStart, colEnd };
}

function imageCellRange(image: BoundingBox, pageWidth: number, pageHeight: number): CellRect {
  return cellRangeOf(image, pageWidth / OCR_REGION_GRID_SIZE, pageHeight / OCR_REGION_GRID_SIZE);
}

function cellRectToBoundingBox(rect: CellRect, pageWidth: number, pageHeight: number): BoundingBox {
  const cellWidth = pageWidth / OCR_REGION_GRID_SIZE;
  const cellHeight = pageHeight / OCR_REGION_GRID_SIZE;
  return {
    x: rect.colStart * cellWidth,
    y: rect.rowStart * cellHeight,
    width: (rect.colEnd - rect.colStart + 1) * cellWidth,
    height: (rect.rowEnd - rect.rowStart + 1) * cellHeight,
  };
}

// El rectángulo se clampea al rect de la imagen antes de emitirse (ADR-065
// §1): la cuantización de la grilla lo hace desbordar.
function clampRectToImage(rect: BoundingBox, image: BoundingBox): BoundingBox {
  const x = Math.max(rect.x, image.x);
  const y = Math.max(rect.y, image.y);
  const right = Math.min(rect.x + rect.width, image.x + image.width);
  const bottom = Math.min(rect.y + rect.height, image.y + image.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

interface HistogramRect {
  readonly area: number;
  readonly left: number; // índice inclusive
  readonly right: number; // índice inclusive
  readonly height: number;
}

// Mayor rectángulo en un histograma (pila monótona), O(n) por fila — la mitad
// del algoritmo de "mayor rectángulo vacío en matriz binaria" (ADR-065 §1).
function largestRectInHistogram(heights: ReadonlyArray<number>): HistogramRect | undefined {
  const stack: number[] = [];
  let best: HistogramRect | undefined;

  for (let i = 0; i <= heights.length; i++) {
    const currentHeight = i < heights.length ? (heights[i] ?? 0) : 0;
    while (stack.length > 0) {
      const topIndex = stack[stack.length - 1];
      if (topIndex === undefined) break;
      const topHeight = heights[topIndex] ?? 0;
      if (currentHeight >= topHeight) break;
      stack.pop();
      const leftNeighbor = stack.length === 0 ? undefined : stack[stack.length - 1];
      const left = leftNeighbor === undefined ? 0 : leftNeighbor + 1;
      const area = topHeight * (i - left);
      if (topHeight > 0 && (best === undefined || area > best.area)) {
        best = { area, left, right: i - 1, height: topHeight };
      }
    }
    stack.push(i);
  }

  return best;
}

interface CellRectResult extends CellRect {
  readonly areaCells: number;
}

/*
 * Mayor rectángulo axis-aligned de celdas NO ocupadas, restringido al rango
 * de celdas de una imagen (ADR-065 §1: "dentro de cada imagen se busca el
 * mayor rectángulo vacío axis-aligned"). `undefined` si no hay ninguna celda
 * vacía en ese rango.
 */
function largestEmptyCellRect(
  grid: ReadonlyArray<ReadonlyArray<boolean>>,
  range: CellRect,
): CellRectResult | undefined {
  const width = range.colEnd - range.colStart + 1;
  if (width <= 0 || range.rowEnd - range.rowStart + 1 <= 0) return undefined;

  const heights = new Array<number>(width).fill(0);
  let best: CellRectResult | undefined;

  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    const gridRow = grid[row];
    for (let col = 0; col < width; col++) {
      const occupied = gridRow?.[range.colStart + col] ?? true;
      heights[col] = occupied ? 0 : (heights[col] ?? 0) + 1;
    }

    const rowBest = largestRectInHistogram(heights);
    if (rowBest !== undefined && (best === undefined || rowBest.area > best.areaCells)) {
      best = {
        rowStart: row - rowBest.height + 1,
        rowEnd: row,
        colStart: range.colStart + rowBest.left,
        colEnd: range.colStart + rowBest.right,
        areaCells: rowBest.area,
      };
    }
  }

  return best;
}

interface OcrRegionCandidate {
  readonly bbox: BoundingBox; // clampeado al rect de la imagen
  readonly emptyAreaPt2: number; // área del bbox clampeado, en pt² — para comparar candidatas
}

/*
 * Compuerta 2 para UNA imagen candidata (ADR-065 §1): mayor rectángulo vacío
 * inscrito, normalizado por el área de esa imagen. Candidata válida si su
 * área es ≥40% del área de la imagen y sus dos lados miden ≥100pt.
 */
function evaluateImageCandidate(
  imageRect: BoundingBox,
  grid: ReadonlyArray<ReadonlyArray<boolean>>,
  pageWidth: number,
  pageHeight: number,
): OcrRegionCandidate | undefined {
  const imageArea = imageRect.width * imageRect.height;
  if (imageArea <= 0) return undefined;

  const cellRange = imageCellRange(imageRect, pageWidth, pageHeight);
  const emptyCellRect = largestEmptyCellRect(grid, cellRange);
  if (emptyCellRect === undefined) return undefined;

  const rawBbox = cellRectToBoundingBox(emptyCellRect, pageWidth, pageHeight);
  const clampedBbox = clampRectToImage(rawBbox, imageRect);
  const clampedArea = clampedBbox.width * clampedBbox.height;

  const passesArea = clampedArea / imageArea >= OCR_REGION_MIN_EMPTY_AREA_RATIO;
  const passesSides =
    clampedBbox.width >= OCR_REGION_MIN_SIDE_PT && clampedBbox.height >= OCR_REGION_MIN_SIDE_PT;
  if (!passesArea || !passesSides) return undefined;

  return { bbox: clampedBbox, emptyAreaPt2: clampedArea };
}

/*
 * Compuertas 1+2 completas para una página (ADR-065 §1-§2), a partir de los
 * `imageRects` que `walkOperatorListForAnnotationsAndImages` ya recolectó
 * (mismo operator list, sin una segunda llamada a `getOperatorList()`).
 * Devuelve `undefined` si no hay ninguna región candidata; si hay más de una,
 * solo la de mayor rectángulo vacío (ADR-065 §2, caso 26).
 */
function detectOcrRegionFromImageRects(
  imageRects: ReadonlyArray<BoundingBox>,
  pageWidth: number,
  pageHeight: number,
  nativeWords: ReadonlyArray<Word>,
): BoundingBox | undefined {
  const largeEnoughRects = imageRects.filter((rect) =>
    isLargeEnoughImage(rect, pageWidth, pageHeight),
  );
  if (largeEnoughRects.length === 0) return undefined; // Compuerta 1: sin imágenes candidatas, compuerta 2 no corre.

  const grid = buildOccupancyGrid(nativeWords, pageWidth, pageHeight);

  let best: OcrRegionCandidate | undefined;
  for (const imageRect of largeEnoughRects) {
    const candidate = evaluateImageCandidate(imageRect, grid, pageWidth, pageHeight);
    if (
      candidate !== undefined &&
      (best === undefined || candidate.emptyAreaPt2 > best.emptyAreaPt2)
    ) {
      best = candidate;
    }
  }

  return best?.bbox;
}

interface ParsePageResult {
  readonly page: Page;
  readonly ocrRegionBbox?: BoundingBox;
}

/*
 * ADR-020 §10: parsePage() puro — obtiene la página, viewport y texto (con
 * timeout), convierte a Words y arma la Page. Lanza PdfCorruptedError /
 * PdfTimeoutError con el documentId correcto (ADR-020 §5). No emite eventos.
 *
 * ADR-066 §1: el mismo `getOperatorList()` que ya pedía la compuerta 1
 * (ADR-065 §1) se adelanta a ANTES de decidir `requiresOCR`, porque el texto
 * de una anotación puede ser la única fuente de texto de la página — no hay
 * una segunda llamada, solo un reordenamiento de la que ya existía.
 */
async function parsePage(
  pdfDocument: PDFDocumentProxy,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
  logger: ILogger,
): Promise<ParsePageResult> {
  const pageNum = pageIndex + 1;

  let pageProxy: PDFPageProxy;
  try {
    pageProxy = await pdfDocument.getPage(pageNum);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PdfCorruptedError(documentId, message, pageIndex);
  }

  const viewport = pageProxy.getViewport({ scale: 1 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  let textContent: TextContentLike;
  let operatorList: OperatorListLike;
  try {
    textContent = await parsePageTextWithTimeout(pageProxy, documentId, pageIndex, timeoutMs);
    // Cast de frontera contra pdfjs-dist (Code_Standards.md §2/§10, mismo
    // criterio que `TextContentLike` arriba): `PDFOperatorList.argsArray`
    // tipa `Array<any>`; narrowing a la forma local evita propagar `any`.
    operatorList = (await pageProxy.getOperatorList()) as OperatorListLike;
  } catch (err: unknown) {
    if (err instanceof PdfTimeoutError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new PdfCorruptedError(documentId, message, pageIndex);
  }

  // ADR-068: el recorrido del operator list precede a la conversión de items
  // porque produce la corrección de origen que ésta consume.
  const { imageRects, annotationWords, originCorrections, pageGlyphs } =
    walkOperatorListForAnnotationsAndImages(
      operatorList,
      pageIndex,
      pageHeight,
      documentId,
      logger,
    );

  const { words: contentWords, joinStats } = convertTextItemsToWords(
    textContent,
    pageIndex,
    pageHeight,
    originCorrections,
    pageGlyphs,
    indexGlyphs(pageGlyphs),
  );

  // ADR-097 §5: sin esta cuenta, "¿cada cuánto falla el empalme en un
  // documento real?" —la pregunta que decide si alguna vez conviene la
  // opción B de `Post_Hito10.8_Pendientes.md` §24— no tiene cómo
  // contestarse. Es `debug`: un empalme que no ocurre no es un error, es el
  // camino de reserva funcionando.
  if (joinStats.eligible > 0) {
    logger.debug("Empalme de avances por glifo (ADR-097 §5).", {
      documentId,
      pageIndex,
      joined: joinStats.joined,
      eligible: joinStats.eligible,
    });
  }

  // ADR-066 §1: el texto de anotaciones se suma al del content stream — las
  // dos fuentes son disjuntas por construcción (getTextContent() no lee
  // appearance streams).
  const sortedWords = sortWordsByReadingOrder([...contentWords, ...annotationWords]);
  const text = sortedWords.map((w) => w.text).join(" ");
  const requiresOCR = sortedWords.length === 0;

  const page: Page = {
    index: pageIndex,
    width: pageWidth,
    height: pageHeight,
    words: sortedWords,
    text,
    requiresOCR,
    ocrCompleted: false,
  };

  // ADR-065 §1/§4: las compuertas de OCR por región solo corren para páginas
  // que SÍ tienen texto nativo (ahora incluyendo el de anotaciones). Una
  // página textless va entera por fuseOcrPage; correr las compuertas ahí
  // violaría trivialmente el invariante de disjunción con textlessPages
  // (grilla de palabras vacía = "toda la imagen es hueco", falso positivo
  // garantizado).
  if (requiresOCR) {
    return { page };
  }

  const ocrRegionBbox = detectOcrRegionFromImageRects(
    imageRects,
    pageWidth,
    pageHeight,
    sortedWords,
  );

  return ocrRegionBbox !== undefined ? { page, ocrRegionBbox } : { page };
}

// EngineError.details es Readonly<Record<string, unknown>>; `reason` es un
// string en PdfCorruptedError, pero el tipo no lo garantiza estáticamente.
function reasonFromCorruptedError(err: PdfCorruptedError): string {
  const { reason } = err.details;
  return typeof reason === "string" ? reason : err.message;
}

/*
 * ADR-041: fuseOcrPage es una función pura y síncrona, sin instancia ni
 * estado retenido. El caller (Orchestrator) provee el Document que él mismo
 * retiene como copia canónica y persiste el resultado — no hay lookup por
 * documentId ni asserts de initialized/disposed (no hay instancia). Preserva
 * el guard de ADR-020 §6 (requiresOCR) y la normalización NFC (ADR-020 §2).
 * Reemplaza al método PdfEngine.fuseOcrPage; el caso "documento no
 * encontrado" desaparece porque el caller siempre provee el Document.
 */
export function fuseOcrPage(
  document: Document,
  pageIndex: number,
  words: ReadonlyArray<Word>,
): Document {
  const existingPage = document.pages[pageIndex];
  if (pageIndex < 0 || pageIndex >= document.pageCount || existingPage === undefined) {
    throw new InvalidInputError(
      `pageIndex ${pageIndex} fuera de rango para documento con ${document.pageCount} páginas.`,
      { pageIndex },
    );
  }

  // ADR-020 §6: fuseOcrPage solo aplica a páginas genuinamente textless.
  if (existingPage.requiresOCR !== true) {
    throw new InvalidInputError(
      `La página ${pageIndex} del documento ${document.id} no requiere OCR (requiresOCR=false); ` +
        "fuseOcrPage solo aplica a páginas sin texto nativo.",
      { documentId: document.id, pageIndex },
    );
  }

  const normalizedWords: Word[] = words.map((w) => ({
    text: w.text.normalize("NFC"),
    bbox: w.bbox,
    pageIndex,
    confidence: w.confidence,
    source: "ocr" as const,
  }));

  const sortedWords = sortWordsByReadingOrder(normalizedWords);
  const mergedText = sortedWords.map((w) => w.text).join(" ");

  // requiresOCR ya es true (precondición del guard); no se fuerza, se
  // hereda del spread de existingPage.
  const updatedPage: Page = {
    ...existingPage,
    words: sortedWords,
    text: mergedText,
    ocrCompleted: true,
  };

  const updatedPages = document.pages.map((p) => (p.index === pageIndex ? updatedPage : p));

  return {
    ...document,
    pages: updatedPages,
  };
}

/*
 * ADR-065 §6: espejo INVERTIDO de fuseOcrPage, para el camino de OCR por
 * región. Mismo perfil (pura, síncrona, host-side, el caller provee y
 * persiste el Document). Tres diferencias deliberadas frente a fuseOcrPage:
 *   1. Guard invertido: exige requiresOCR === false. Una página textless va
 *      por fuseOcrPage; invocar ésta es un bug de wiring (§13 caso 27).
 *   2. Traslada: las `words` llegan en puntos relativos al RECORTE (ADR-064
 *      convierte px->pt, el origen sigue siendo el del recorte) — se les suma
 *      region.x/region.y para llevarlas a coordenadas de página.
 *   3. Concatena en vez de reemplazar: la región es, por construcción de la
 *      compuerta 2 (§12), área sin una sola palabra nativa encima — seguro
 *      sin dedupe (ADR-065 §3).
 * Marca ocrCompleted = true dejando requiresOCR intacto en false (ADR-065 §7:
 * el invariante de 03_Data_Model.md §4 se relaja para admitir este caso).
 */
export function fuseOcrRegion(
  document: Document,
  pageIndex: number,
  region: BoundingBox,
  words: ReadonlyArray<Word>,
): Document {
  const existingPage = document.pages[pageIndex];
  if (pageIndex < 0 || pageIndex >= document.pageCount || existingPage === undefined) {
    throw new InvalidInputError(
      `pageIndex ${pageIndex} fuera de rango para documento con ${document.pageCount} páginas.`,
      { pageIndex },
    );
  }

  // ADR-065 §6: guard invertido — fuseOcrRegion solo aplica a páginas CON
  // texto nativo. Una página textless (requiresOCR=true) va por fuseOcrPage.
  if (existingPage.requiresOCR !== false) {
    throw new InvalidInputError(
      `La página ${pageIndex} del documento ${document.id} requiere OCR de página completa ` +
        "(requiresOCR=true); fuseOcrRegion solo aplica a páginas con texto nativo.",
      { documentId: document.id, pageIndex },
    );
  }

  const translatedWords: Word[] = words.map((w) => ({
    text: w.text.normalize("NFC"),
    // El spread preserva cualquier campo del bbox que esta traslación no
    // toque. Hoy solo puede ser `rotation`, y `ocr-engine` nunca lo puebla
    // (`OCR_Engine.md` §10), así que es inerte — pero reconstruir el bbox
    // campo a campo es exactamente la forma de caída silenciosa que ADR-066 §6
    // costó dos sesiones detectar en `mapSpanToWords`. No se repite.
    bbox: {
      ...w.bbox,
      x: w.bbox.x + region.x,
      y: w.bbox.y + region.y,
    },
    pageIndex,
    confidence: w.confidence,
    source: "ocr" as const,
  }));

  // ADR-065 §3: concatena — las nativas se conservan, las de OCR se suman,
  // se reordena por orden de lectura y se recalcula Page.text.
  const mergedWords = sortWordsByReadingOrder([...existingPage.words, ...translatedWords]);
  const mergedText = mergedWords.map((w) => w.text).join(" ");

  const updatedPage: Page = {
    ...existingPage,
    words: mergedWords,
    text: mergedText,
    ocrCompleted: true,
  };

  const updatedPages = document.pages.map((p) => (p.index === pageIndex ? updatedPage : p));

  return {
    ...document,
    pages: updatedPages,
  };
}

// ─── Decoder del `COMPLETED.result` del PdfWorker (ADR-055 §10, nota v1.4.0
// de PDF_Engine.md) ───
//
// A diferencia de los otros cuatro motores, `pdf-engine` NO tiene puerto
// interno de despacho que angostar a `Promise<unknown>` (ADR-055 §2): nunca se
// partió en mitad host + kernel (ADR-043/045/046/047), su entry-point corre el
// motor real completo (ADR-036 §3) y por lo tanto el único consumidor de un
// resultado suyo que cruzó un `postMessage` vive en el façade
// (`orchestrator.ts`, stage de extracción). El guard lo escribe igual ESTE
// motor —es el que conoce el contrato de su propio worker, ADR-055 §8— y se
// exporta para que el façade lo invoque host-side sobre un `dispatch<unknown>`.
// Misma forma que `fuseOcrPage` (ADR-041): función pura de este paquete,
// ejecutada por el façade, que como façade sí puede importar de un motor (P-1).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PDF_SOURCE_KINDS: ReadonlySet<string> = new Set(["text", "scanned", "mixed"]);

/**
 * Detalle legible de una forma no reconocida, para el `details` del
 * `InvalidInputError`. Reporta SOLO la forma —claves y tipos—, nunca el
 * contenido del valor (`Code_Standards.md` §9: nunca loguear contenido del
 * documento; acá el valor sospechoso puede contener el texto extraído entero).
 */
function describeDispatchResultShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (isRecord(value)) return `object(keys=[${Object.keys(value).join(", ")}])`;
  return typeof value;
}

/**
 * Type predicate, no un `as`: es lo que permite que `decodePdfEngineOutput`
 * devuelva `PdfEngineOutput` sin un solo cast sobre el valor que cruzó la
 * frontera (ADR-055, Validación: "ningún `as` sobre el resultado de un
 * `dispatch`"). Lo que el guard no chequea —el interior de `pages`— queda
 * cubierto por el contrato del propio motor, que es quien produjo ese array:
 * la duda que ADR-055 cierra es si el valor viene del `PdfEngine` o de otra
 * cosa, no si `PdfEngine` construyó mal sus propias páginas.
 */
/*
 * ADR-065 §4: `ocrRegions` se recorre elemento a elemento, igual que
 * `textlessPages` y por el mismo motivo — está acotado a una entrada por
 * página (ADR-065 §2), o sea la misma clase de costo. Lo que ADR-055 excluye
 * del walk son los datos NO acotados por página (`words`/`bbox` de las
 * páginas), no los arrays en general.
 */
function isOcrRegion(value: unknown): boolean {
  if (!isRecord(value) || typeof value.pageIndex !== "number") return false;
  const { bbox } = value;
  return (
    isRecord(bbox) &&
    typeof bbox.x === "number" &&
    typeof bbox.y === "number" &&
    typeof bbox.width === "number" &&
    typeof bbox.height === "number"
  );
}

function isPdfEngineOutput(value: unknown): value is PdfEngineOutput {
  return (
    isRecord(value) &&
    isRecord(value.document) &&
    typeof value.document.id === "string" &&
    Array.isArray(value.document.pages) &&
    typeof value.pageCount === "number" &&
    Array.isArray(value.textlessPages) &&
    value.textlessPages.every((p): boolean => typeof p === "number") &&
    Array.isArray(value.ocrRegions) &&
    value.ocrRegions.every((r): boolean => isOcrRegion(r)) &&
    typeof value.sourceKind === "string" &&
    PDF_SOURCE_KINDS.has(value.sourceKind)
  );
}

/**
 * Decodifica un valor que cruzó la frontera del `PdfWorker` y lo devuelve
 * tipado como `PdfEngineOutput` (ADR-055 §1: verificar la forma en runtime, no
 * afirmarla con un `dispatch<T>` que el compilador no puede verificar).
 *
 * Este motor NO envuelve su resultado en ningún sobre: `worker/entry.ts` postea
 * `result` = lo que devolvió `engine.process()`, así que el camino remoto y el
 * in-process resuelven exactamente la misma forma. Esa es la única válida
 * (PDF_Engine.md §13 casos 16-17); cualquier otra —incluido un `{ output }` que
 * envuelva un resultado por lo demás correcto— **lanza**. Devolver un default
 * en silencio está prohibido (ADR-055 §3): que falle ruidosamente es el punto.
 *
 * Verificación superficial y deliberada: los cuatro campos de `PdfEngineOutput`
 * más `document.id`/`document.pages`, sin recorrer `words`/`bbox`. Corre una
 * vez por import sobre documentos de hasta 10.000 páginas, y una corrupción
 * campo a campo no es el modo de falla que ADR-055 cierra (el sobre de forma
 * distinta sí lo es).
 */
export function decodePdfEngineOutput(value: unknown): PdfEngineOutput {
  if (isPdfEngineOutput(value)) return value;

  throw new InvalidInputError(
    "El resultado del despacho de pdf-parse no tiene la forma de PdfEngineOutput: " +
      "se esperaba { document: { id, pages }, pageCount, textlessPages, ocrRegions, sourceKind } " +
      "(la misma forma en el camino remoto y en el in-process — este motor no envuelve " +
      "su resultado, PDF_Engine.md §13 caso 16). Devolver un default en silencio está " +
      "prohibido (ADR-055 §3).",
    { engineId: EngineId.Pdf, receivedShape: describeDispatchResultShape(value) },
  );
}

/*
 * `_pdfInfo` es una propiedad pública en la clase PDFDocumentProxy
 * (tipo `any`), usada para acceder a isEncrypted y pdfVersion que no
 * están en la interfaz pública de TypeScript.
 */
export class PdfEngine implements IEngine {
  readonly id = EngineId.Pdf;

  private ctx: EngineContext | null = null;
  private config: PdfEngineConfig = {
    maxPageCount: DEFAULT_MAX_PAGE_COUNT,
  };
  private initialized = false;
  private disposed = false;

  init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.config = {
      maxPageCount: ctx.config.pdf.maxPageCount ?? DEFAULT_MAX_PAGE_COUNT,
    };
    this.initialized = true;
    this.disposed = false;
    ctx.logger.info("PDF Engine initialized");
    return Promise.resolve();
  }

  async process(input: PdfEngineInput, operationCtx: EngineContext): Promise<PdfEngineOutput> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (input == null) {
      throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Pdf });
    }

    const { documentId, buffer, password } = input;

    if (buffer.byteLength === 0) {
      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
        documentId,
        reason: "Buffer vacío.",
      });
      throw new PdfInvalidError(documentId, "Buffer vacío.");
    }

    if (password !== undefined && password.length === 0) {
      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
        documentId,
        reason: "Password vacío no permitido.",
      });
      throw new PdfInvalidError(documentId, "Password vacío no permitido.");
    }

    if (operationCtx.abortSignal.aborted) {
      throw new CancelledError(documentId);
    }

    const header = new Uint8Array(buffer, 0, 5);
    const headerStr = new TextDecoder().decode(header);
    if (headerStr !== "%PDF-") {
      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
        documentId,
        reason: "No es un PDF válido: header no comienza con %PDF-.",
      });
      throw new PdfInvalidError(documentId, "No es un PDF válido: header no comienza con %PDF-.");
    }

    let pdfDocument: PDFDocumentProxy;
    try {
      // ADR-053 §5: extracción de texto, no rasterización — por eso NO lleva
      // disableFontFace (esta ruta nunca dibuja glifos como Path2D; agregarlo
      // solo haría que pdf.js construya siluetas que nadie va a pintar, ver
      // `05_Worker_Architecture.md` §7.1). Las opciones de abajo son la mitad
      // de la regla transversal de §7 que SÍ aplica acá:
      //  - useWorkerFetch: false EXPLÍCITO (trampa 1 de ADR-053 Contexto §6):
      //    ya estaba puesto y es lo que protege esta llamada de que el default
      //    de pdf.js evalúe `document.baseURI` dentro del PdfWorker en cuanto
      //    se pasan cMapUrl/standardFontDataUrl. No se toca.
      //  - cMapUrl/cMapPacked + standardFontDataUrl: sin esto, un PDF con
      //    fuentes CID de CMap predefinido se EXTRAE con unicode incorrecto —
      //    degrada regex-engine/ner-engine, no solo el dibujo (ADR-053 §5).
      //  - CMapReaderFactory/StandardFontDataFactory propias (trampa 2): las
      //    DOM* de pdf.js tocan document.baseURI en su primer fetch; servir
      //    los assets sin esto no alcanza.
      const loadingTask = getDocument({
        data: buffer,
        password,
        useWorkerFetch: false,
        cMapUrl: PDF_ENGINE_PDFJS_CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: PDF_ENGINE_PDFJS_STANDARD_FONT_DATA_URL,
        CMapReaderFactory: PdfEngineCMapReaderFactory,
        StandardFontDataFactory: PdfEngineStandardFontDataFactory,
      });
      pdfDocument = await loadingTask.promise;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "";

      if (
        name === "PasswordException" ||
        message.toLowerCase().includes("password") ||
        message.includes("NeedsPwd") ||
        message.includes("IncorrectPassword")
      ) {
        operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED, { documentId });
        throw new PdfPasswordRequiredError(documentId);
      }
      // ADR-020 §4: cualquier error a nivel de documento (matcheado por "invalid"/
      // "corrupt" o desconocido) se reclasifica como PdfInvalidError. PDF_CORRUPTED
      // queda reservado a fallos de página interna (getPage/getTextContent).
      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
        documentId,
        reason: message,
      });
      throw new PdfInvalidError(documentId, message);
    }

    if (operationCtx.abortSignal.aborted) {
      void pdfDocument.destroy();
      throw new CancelledError(documentId);
    }

    const pageCount = pdfDocument.numPages;

    if (pageCount > this.config.maxPageCount) {
      void pdfDocument.destroy();
      const reason = `El documento supera el límite de ${this.config.maxPageCount} páginas.`;
      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, { documentId, reason });
      throw new PdfInvalidError(documentId, reason);
    }

    const pages: Page[] = [];
    const textlessPages: number[] = [];
    const ocrRegions: OcrRegion[] = [];
    const timeoutMs =
      operationCtx.config.workerPool.timeouts["pdf-parse"] ?? DEFAULT_TIMEOUT_MS_PER_PAGE;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      if (operationCtx.abortSignal.aborted) {
        void pdfDocument.destroy();
        throw new CancelledError(documentId);
      }

      let parsed: ParsePageResult;
      try {
        parsed = await parsePage(
          pdfDocument,
          documentId,
          pageIndex,
          timeoutMs,
          operationCtx.logger,
        );
      } catch (err: unknown) {
        void pdfDocument.destroy();
        // ADR-020 §3: todo error fatal de parseo emite su evento antes de lanzar.
        // PdfTimeoutError no emite (la señal es el rechazo de la promesa; el
        // retry queda diferido al WorkerPool en Hito 9, ver ADR-020 §5).
        if (err instanceof PdfCorruptedError) {
          operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
            documentId,
            reason: reasonFromCorruptedError(err),
          });
        }
        throw err;
      }

      const { page, ocrRegionBbox } = parsed;

      if (page.requiresOCR) {
        textlessPages.push(page.index);
      }
      pages.push(page);

      if (ocrRegionBbox !== undefined) {
        ocrRegions.push({ pageIndex: page.index, bbox: ocrRegionBbox });
      }

      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId,
        pageIndex: page.index,
        wordCount: page.words.length,
        requiresOCR: page.requiresOCR,
      });
    }

    textlessPages.sort((a, b) => a - b);
    ocrRegions.sort((a, b) => a.pageIndex - b.pageIndex);
    const sourceKind = this.determineSourceKind(textlessPages, pageCount);

    const metadata = await this.extractMetadata(pdfDocument);
    void pdfDocument.destroy();

    const document: Document = {
      id: documentId,
      name: "",
      pageCount,
      pages,
      metadata,
      sourceKind,
      importedAt: Date.now(),
    };

    operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.DOCUMENT_PARSED, {
      documentId,
      pageCount,
      textlessPages,
      sourceKind,
    });

    operationCtx.logger.info(`Documento parseado: ${documentId}`, {
      pageCount,
      textlessPagesCount: textlessPages.length,
      sourceKind,
    });

    const output: PdfEngineOutput = {
      document,
      pageCount,
      textlessPages,
      sourceKind,
      ocrRegions,
    };

    return output;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.ctx = null;
    this.initialized = false;
    return Promise.resolve();
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new EngineNotInitializedError(EngineId.Pdf);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineDisposedError(EngineId.Pdf);
    }
  }

  private determineSourceKind(
    textlessPages: ReadonlyArray<number>,
    pageCount: number,
  ): "text" | "scanned" | "mixed" {
    if (textlessPages.length === 0) return "text";
    if (textlessPages.length === pageCount) return "scanned";
    return "mixed";
  }

  private async extractMetadata(pdfDocument: PDFDocumentProxy): Promise<DocumentMetadata> {
    let title: string | undefined;
    let producer: string | undefined;
    let creationTool: string | undefined;
    let pdfVersion = "1.4";
    let encrypted = false;
    let hasForms = false;

    try {
      const result = await pdfDocument.getMetadata();
      const info = result.info as Record<string, unknown> | undefined;
      if (info) {
        if (typeof info.Title === "string") title = info.Title;
        if (typeof info.Producer === "string") producer = info.Producer;
        if (typeof info.Creator === "string") creationTool = info.Creator;
        hasForms = info.IsAcroFormPresent === true;
        if (typeof info.PDFVersion === "string") {
          pdfVersion = info.PDFVersion;
        }
      }
    } catch {
      // metadata no disponible — valores por defecto
    }

    try {
      const pdfInfo = pdfDocument._pdfInfo as
        | { encrypted?: boolean; pdfVersion?: string }
        | undefined;
      encrypted = pdfInfo?.encrypted === true;
      if (typeof pdfInfo?.pdfVersion === "string") {
        pdfVersion = pdfInfo.pdfVersion;
      }
    } catch {
      // no se pudo determinar isEncrypted ni pdfVersion
    }

    const md: DocumentMetadata = {
      pdfVersion,
      encrypted,
      hasForms,
      ...(title !== undefined ? { title } : {}),
      ...(producer !== undefined ? { producer } : {}),
      ...(creationTool !== undefined ? { creationTool } : {}),
    };
    return md;
  }
}
