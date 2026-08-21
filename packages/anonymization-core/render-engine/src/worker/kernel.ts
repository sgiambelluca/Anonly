/**
 * `RenderKernel` — el kernel sin estado por documento que ADR-043 §1 asigna
 * al RenderWorker (salvo los `PDFDocumentProxy` cargados, únicos que
 * sobreviven entre llamadas). Contiene TODO lo que toca pdfjs-dist/canvas:
 * carga/descarga de documentos, rasterización, composición de reemplazos y
 * highlights, y codificación PNG/JPEG.
 *
 * Este archivo lo importan DOS consumidores (mismo código, dos fronteras):
 * - `render.engine.ts` (host, in-process fallback): lo invoca directo desde
 *   el `run()` que pasa a `RenderPool.dispatch` cuando no hay `workerFactory`
 *   real configurada (ADR-035, fallback bit-idéntico).
 * - `worker/entry.ts` (worker real): lo invoca detrás de la mensajería
 *   `postMessage` cuando SÍ hay un Worker de SO real.
 *
 * La clase `RenderEngine` (estado, cache, supersede, subscripciones, eventos)
 * NUNCA importa `pdfjs-dist` fuera de este archivo — es la única frontera del
 * paquete que lo hace, junto con el cast documentado de
 * `renderPageOntoContext` (ADR-031 §4, Code_Standards.md §10).
 *
 * Estado: `documents: Map<string, PDFDocumentProxy>` a nivel de módulo. Para
 * el worker real, esto es literalmente "lo que ese worker tiene cargado". Para
 * el fallback in-process, representa "el único kernel virtual" que corre en
 * el mismo proceso que el host — coherente con que en ese modo no hay
 * paralelismo real de todos modos (un solo hilo de JS).
 *
 * ADR-050 (`LoadDocumentPayload.password`): `kernelLoadDocument` lo pasa a
 * `getDocument({ data, password })` y no lo retiene en ninguna variable de
 * módulo — el único lugar de este archivo donde el password existe es el
 * scope local de esa función, durante esa única llamada. Quien lo retiene
 * para re-primear workers nuevos/reemplazados es el host (`render.engine.ts`,
 * `RetainedDocument.password`), no este kernel (`08_Security_Model.md` §6).
 */

import {
  AnnotationKind,
  CancelledError,
  DEGRADED_FONT_RATIO,
  InvalidInputError,
  REPLACEMENT_FONT_HEIGHT_RATIO,
  ReplacementMode,
  sharesVerticalBand,
  type Annotation,
  type BoundingBox,
  type EncodedPageImage,
  type LoadDocumentPayload,
  type MarkerLegendRow,
  type RasterizePagePayload,
  type RenderLegendPayload,
  type RenderPagePayload,
  type Replacement,
  type UnloadDocumentPayload,
  type Word,
} from "@anonly/shared";
import {
  getDocument,
  type PageViewport,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";

import { RenderFailedError, RenderPageFailedError, RenderTimeoutError } from "../render.errors.js";

// §13 casos 3/4/5/6/7/8: colores/estilos de cada modo (Contracts.md no expone
// `EntityType` en `Annotation`, así que el highlight usa un único color por
// `AnnotationKind` — ADR-031 §3).
const HIGHLIGHT_COLOR = "#2563eb";
const CONFLICT_COLOR = "#dc2626";
// ADR-058 §7: color de trazo propio para el aviso de degradación — ámbar, a
// propósito distinto del azul de highlight (agrupación) y el rojo de
// conflict (desacuerdo de detección): Degraded señala otra cosa (legibilidad
// del reemplazo pintado), no conviene que se confunda visualmente con esas
// dos. Decisión de estilo sin impacto de contrato (`Annotation` no expone
// color, ADR-031 §3).
const DEGRADED_COLOR = "#f59e0b";
const REDACT_FILL_COLOR = "#000000";
const REPLACEMENT_BG_COLOR = "#ffffff";
const REPLACEMENT_TEXT_COLOR = "#000000";
const ANNOTATION_LINE_WIDTH = 2;
// ADR-058 §1 (Hito 10.5, PR 1): piso del shrink-to-fit. Ya existía como el
// número mágico `8` dentro de `fontForMode` (Math.max(8, ...)); queda nombrado
// acá porque ahora es también la condición de corte del loop de encogido de
// `fitReplacementFont` — nunca se baja de acá aunque el token siga sin entrar
// (spec Render_Engine.md §13 caso 25).
const REPLACEMENT_MIN_FONT_PX = 8;

// ─── ADR-058 §2-§4, §6 (Hito 10.5, PR 5) — repintado de línea por calibración ───
//
// Las cuatro constantes de abajo son heurísticas cuyo VALOR EXACTO el spec
// (`Render_Engine.md` §6/§13 caso 26, ADR-058 §6) describe cualitativamente
// ("un hueco desproporcionado", "un umbral de error razonable", "se infiere
// de las posiciones") sin dar el número — el propio ADR-058 §6(e) lo admite
// explícitamente para el umbral de calibración ("si el spec no te da el
// valor exacto... elegí uno defendible y documentalo"). Se documentan acá
// con el mismo criterio para las otras tres, no exportadas (mismo patrón que
// `REPLACEMENT_MIN_FONT_PX`, que tampoco se exporta): son detalle interno del
// kernel, no contrato público.

/**
 * (b) — huecos plausibles. El hueco entre dos palabras consecutivas de la
 * línea (candidata + reemplazo) se compara contra la altura de la mayor de
 * las dos cajas, como proxy del tamaño de fuente: un hueco de más de 4x esa
 * altura excede por mucho el espaciado inter-palabra normal (~0.3-0.5x el
 * tamaño de fuente) y delata una fila de tabla o columnas (celdas separadas
 * por un tabulador o alineación fija), no una línea de cuerpo. El piso
 * negativo tolera el ruido de OCR/el prorrateo de ADR-020 (Contexto §6): las
 * posiciones individuales son aproximadas, así que un leve solape no debería
 * bastar para descartar la línea.
 */
const MAX_LINE_GAP_TO_HEIGHT_RATIO = 4;
const MIN_LINE_GAP_TO_HEIGHT_RATIO = -0.5;

/**
 * (c) — proxy de "alineación a la izquierda". `lineWords` (ADR-058 §5) solo
 * trae palabras a la DERECHA del reemplazo — nunca las anteriores en la
 * misma línea — así que no hay forma de medir la alineación real contra un
 * margen izquierdo conocido (eso exigiría datos que este motor no recibe:
 * `Render_Engine.md` §9 dice explícitamente "no se valida contra Page.words
 * ... el motor confía en la selección host-side"). El proxy que SÍ se puede
 * calcular con lo disponible: cuánto de la página que queda a la derecha del
 * reemplazo ocupa la fila de vecinas (`densidad = tramoUsado / tramoDisponible`,
 * ambos medidos desde `replacement.bbox.x` hasta el margen derecho FÍSICO de
 * la página — sin inventar un margen tipográfico encima). Texto de cuerpo
 * corrido (el reemplazo está en medio o al final de una oración) típicamente
 * continúa hasta cerca del margen físico; un título o valor centrado/alineado
 * a la derecha dentro de una fila corta deja mucho margen físico sin usar.
 * Es conservador por diseño (ADR-058 §6: "cualquier duda cae al fallback") —
 * cae al fallback en más casos de los estrictamente necesarios antes que
 * arriesgar un repintado sobre una línea que no es texto de cuerpo corrido.
 */
const MIN_LINE_DENSITY_RATIO = 0.3;

/**
 * (e) — umbral de error de calibración (ADR-058 §3/§6, razonamiento pedido
 * explícitamente por el spec). Error relativo = suma de |medido - real| /
 * suma de real, sobre el conjunto de palabras de la línea (Contexto §6: se
 * ajusta sobre el conjunto, no palabra por palabra). 0.15 (15%) deja pasar la
 * variación normal entre una familia genérica (`serif`/`sans-serif`/
 * `monospace`, las únicas candidatas posibles bajo `disableFontFace: true`,
 * ADR-053) y la fuente real embebida del PDF —que casi nunca coincide
 * exactamente—, pero rechaza un candidato que va claramente desencaminado
 * (p. ej. confundir una tabla con texto corrido, o una fuente condensada con
 * una expandida). Un umbral más laberíntico dejaría pasar candidatos
 * visiblemente mal calibrados —exactamente la costura que ADR-058 §3 pide
 * evitar—; uno más estricto rechazaría casi cualquier aproximación genérica,
 * vaciando de contenido la pieza de calidad de la cascada.
 */
const LINE_CALIBRATION_ERROR_THRESHOLD = 0.15;

type GenericFontFamily = "serif" | "sans-serif" | "monospace";
type CalibrationFontWeight = "normal" | "bold";
type CalibrationFontStyle = "normal" | "italic";

interface FontCandidate {
  readonly family: GenericFontFamily;
  readonly weight: CalibrationFontWeight;
  readonly style: CalibrationFontStyle;
}

// Orden deliberado (sans-serif primero): en un empate exacto de error entre
// candidatos, `calibrateLineFont` se queda con el PRIMERO iterado — sin esto
// el "candidato ganador" en un empate sería un detalle de iteración interno
// y no una elección legible. 3 familias × 2 pesos × 2 estilos = 12,
// exactamente el conjunto acotado que pide ADR-058 §3.
const FONT_CANDIDATES: ReadonlyArray<FontCandidate> = (
  ["sans-serif", "serif", "monospace"] as const
).flatMap((family) =>
  (["normal", "bold"] as const).flatMap((weight) =>
    (["normal", "italic"] as const).map((style) => ({ family, weight, style })),
  ),
);

function buildCalibratedFont(size: number, candidate: FontCandidate): string {
  const stylePart = candidate.style === "italic" ? "italic " : "";
  const weightPart = candidate.weight === "bold" ? "bold " : "";
  return `${stylePart}${weightPart}${size}px ${candidate.family}`;
}

/** Una palabra real de la línea contra la que se calibra: texto conocido + ancho real (ya escalado a espacio canvas). */
export interface CalibrationSample {
  readonly text: string;
  readonly actualWidth: number;
}

export interface CalibrationResult {
  readonly font: string;
  readonly errorRatio: number;
}

function candidateErrorRatio(
  measureWidth: (font: string, text: string) => number,
  font: string,
  samples: ReadonlyArray<CalibrationSample>,
): number {
  let totalAbsError = 0;
  let totalActual = 0;
  for (const sample of samples) {
    totalAbsError += Math.abs(measureWidth(font, sample.text) - sample.actualWidth);
    totalActual += sample.actualWidth;
  }
  return totalActual > 0 ? totalAbsError / totalActual : Number.POSITIVE_INFINITY;
}

/**
 * ADR-058 §3 — calibración inversa: prueba los `FONT_CANDIDATES` (familia
 * genérica × peso × estilo) al tamaño `sizePx` y devuelve el que minimiza el
 * error relativo agregado contra `samples` (los anchos REALES de la línea:
 * la propia palabra reemplazada más las vecinas de `lineWords`, ADR-058 §5).
 * Pura y testeable sin `OffscreenCanvas` — mismo criterio que
 * `fitReplacementFont` (`measureWidth` inyectada). Exportada solo para test
 * directo (`unit.test.ts`), no forma parte del `index.ts` público del
 * paquete (ADR-043 §2).
 */
export function calibrateLineFont(
  measureWidth: (font: string, text: string) => number,
  samples: ReadonlyArray<CalibrationSample>,
  sizePx: number,
): CalibrationResult {
  let best: CalibrationResult | undefined;
  for (const candidate of FONT_CANDIDATES) {
    const font = buildCalibratedFont(sizePx, candidate);
    const errorRatio = candidateErrorRatio(measureWidth, font, samples);
    if (best === undefined || errorRatio < best.errorRatio) {
      best = { font, errorRatio };
    }
  }
  // FONT_CANDIDATES es un literal no vacío (3×2×2): `best` siempre se asigna
  // en la primera iteración. Este fallback es puramente defensivo (evita un
  // `!` no-null) y, si alguna vez se ejecutara, produce un error "infinito"
  // que hace caer la condición (e) al fallback igual — el resultado seguro.
  return (
    best ?? {
      font: buildCalibratedFont(sizePx, {
        family: "sans-serif",
        weight: "normal",
        style: "normal",
      }),
      errorRatio: Number.POSITIVE_INFINITY,
    }
  );
}

/** Overlap 2D genérico (X e Y), no solo banda vertical. */
function overlapsBbox(a: BoundingBox, b: BoundingBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

interface LineRepaintPlan {
  readonly font: string;
  readonly delta: number;
  readonly neighbors: ReadonlyArray<Word>; // ordenadas por x, bbox SIN escalar.
  readonly lineTopPt: number; // banda vertical de la línea, SIN escalar.
  readonly lineBottomPt: number;
  readonly eraseRightPt: number; // extremo derecho a tapar, SIN escalar.
}

/**
 * ADR-058 §6 — evalúa las cinco condiciones de activación del repintado y,
 * si TODAS se cumplen, devuelve el plan geométrico (sin tocar el canvas
 * todavía: el muestreo de color y el dibujo viven en `tryRepaintLine`, que sí
 * tiene `context`). Cualquier condición que falle devuelve `undefined` —
 * "cualquier duda cae al fallback" (spec §13 caso 26).
 *
 * Todo el cálculo geométrico corre en el espacio SIN escalar de
 * `replacement.bbox`/`Word.bbox` (mismo espacio que `selectLineWords` del
 * façade) y solo se multiplica por `scale` en los puntos que lo necesitan
 * (tamaño de fuente, comparación contra `pageWidthPx`) — evita mezclar
 * unidades a mitad de camino.
 *
 * Guard adicional, no numerado en ADR-058 §6 (que describe una única
 * ocurrencia por línea): `otherReplacements` son el resto de los reemplazos
 * de esta página (todos salvo `replacement`). Dos piezas, no una:
 *
 * 1. Cualquier `lineWord` cuyo bbox se solape con el de OTRO reemplazo se
 *    excluye de las vecinas — nunca se REDIBUJA el texto ORIGINAL de otra
 *    entidad (eso deshace su anonimización si esa entidad ya se pintó).
 * 2. `nextReplacementBoundaryPt` — si otro reemplazo comparte banda vertical
 *    y está a la derecha de `replacement`, su propio `bbox.x` es un límite
 *    DURO para la selección de vecinas, la densidad (c), el margen (d) y el
 *    tapado (`eraseRightPt`): ninguno de los cuatro puede cruzar hacia su
 *    territorio, sin importar si el hueco que queda tras filtrar las
 *    palabras de esa otra entidad da "plausible" por (b) — un reemplazo
 *    corto (un DNI o teléfono enmascarado de pocos caracteres) dejaría un
 *    hueco perfectamente plausible bajo `MAX_LINE_GAP_TO_HEIGHT_RATIO`, y sin
 *    este límite el rectángulo de fondo de `replacement` se pintaría ENCIMA
 *    de lo que esa otra entidad ya dibujó, borrándolo — sin exponer su texto
 *    original (eso ya lo evita la pieza 1), pero igual destruyendo su
 *    render. Es **independiente del orden** en que `paintReplacements`
 *    procesa el array: se calcula siempre desde las posiciones de
 *    `otherReplacements`, nunca desde lo que ya esté pintado en el canvas.
 *
 * Las dos piezas son puramente conservadoras (nunca agregan repintado, solo
 * lo retiran o lo acortan) — mismo espíritu que las cinco condiciones del
 * spec: cualquier duda cae al fallback.
 */
function planLineRepaint(
  measureWidth: (font: string, text: string) => number,
  replacement: Replacement,
  scaledBbox: BoundingBox,
  lineWords: ReadonlyArray<Word>,
  otherReplacements: ReadonlyArray<Replacement>,
  scale: number,
  pageWidthPx: number,
): LineRepaintPlan | undefined {
  // Límite duro impuesto por el PRÓXIMO reemplazo a la derecha en la misma
  // banda vertical (pieza 2 de arriba). Ausente → +Infinity (no acota nada).
  const nextReplacementBoundaryPt = otherReplacements
    .filter(
      (other) =>
        sharesVerticalBand(other.bbox, replacement.bbox) &&
        other.bbox.x >= replacement.bbox.x + replacement.bbox.width,
    )
    .reduce((closest, other) => Math.min(closest, other.bbox.x), Number.POSITIVE_INFINITY);

  // (a) — al menos una palabra a la derecha del reemplazo, compartiendo banda
  // vertical, sin cruzar hacia el bbox de OTRO reemplazo (pieza 1) ni hacia
  // `nextReplacementBoundaryPt` (pieza 2). El texto rotado 90°/270° no
  // comparte banda (spec §13 caso 27) y se filtra acá mismo, sin código
  // especial.
  const neighbors = lineWords
    .filter(
      (word) =>
        sharesVerticalBand(word.bbox, replacement.bbox) &&
        word.bbox.x >= replacement.bbox.x + replacement.bbox.width &&
        word.bbox.x < nextReplacementBoundaryPt &&
        !otherReplacements.some((other) => overlapsBbox(word.bbox, other.bbox)),
    )
    .sort((wordA, wordB) => wordA.bbox.x - wordB.bbox.x);
  if (neighbors.length === 0) return undefined;

  // (b) — huecos plausibles entre palabras consecutivas (reemplazo incluido).
  let previous: BoundingBox = replacement.bbox;
  for (const neighbor of neighbors) {
    const gap = neighbor.bbox.x - (previous.x + previous.width);
    const refHeight = Math.max(previous.height, neighbor.bbox.height);
    if (
      gap > MAX_LINE_GAP_TO_HEIGHT_RATIO * refHeight ||
      gap < MIN_LINE_GAP_TO_HEIGHT_RATIO * refHeight
    ) {
      return undefined;
    }
    previous = neighbor.bbox;
  }

  const lastNeighbor = neighbors[neighbors.length - 1];
  if (lastNeighbor === undefined) return undefined; // defensivo; neighbors.length > 0 ya lo garantiza.

  // (c) — proxy de alineación izquierda (ver comentario de MIN_LINE_DENSITY_RATIO),
  // medido contra el límite derecho EFECTIVO: el menor entre el margen físico
  // de la página y `nextReplacementBoundaryPt` (pieza 2 — nunca el margen
  // físico solo, si hay otra entidad más cerca).
  const pageWidthPt = pageWidthPx / scale;
  const effectiveRightLimitPt = Math.min(pageWidthPt, nextReplacementBoundaryPt);
  const runStart = replacement.bbox.x;
  const runEnd = lastNeighbor.bbox.x + lastNeighbor.bbox.width;
  const available = effectiveRightLimitPt - runStart;
  if (available <= 0) return undefined;
  if ((runEnd - runStart) / available < MIN_LINE_DENSITY_RATIO) return undefined;

  // (e) — calibración inversa sobre el conjunto de la línea: la propia
  // palabra reemplazada (ancho real conocido: su propio bbox) más las
  // vecinas de `lineWords`.
  const size = replacementFontSize(scaledBbox.height, REPLACEMENT_MIN_FONT_PX * scale);
  const samples: ReadonlyArray<CalibrationSample> = [
    { text: replacement.originalValue, actualWidth: scaledBbox.width },
    ...neighbors.map((word) => ({ text: word.text, actualWidth: word.bbox.width * scale })),
  ];
  const calibration = calibrateLineFont(measureWidth, samples, size);
  if (calibration.errorRatio > LINE_CALIBRATION_ERROR_THRESHOLD) return undefined;

  const newTokenWidth = measureWidth(calibration.font, replacement.replacementValue);
  const delta = newTokenWidth - scaledBbox.width;

  // (d) — el desplazamiento cabe antes del límite derecho EFECTIVO (margen
  // físico de la página, o el próximo reemplazo a la derecha si está más
  // cerca — pieza 2): nunca cruza hacia el territorio de otra entidad, sin
  // importar si el hueco calculado en (b) dio "plausible".
  const newRunEndPx = runEnd * scale + delta;
  const effectiveRightLimitPx = effectiveRightLimitPt * scale;
  if (newRunEndPx > effectiveRightLimitPx) return undefined;

  const allBoxes = [replacement.bbox, ...neighbors.map((word) => word.bbox)];
  const lineTopPt = Math.min(...allBoxes.map((box) => box.y));
  const lineBottomPt = Math.max(...allBoxes.map((box) => box.y + box.height));
  // `Math.min(..., effectiveRightLimitPt)` es redundante con el chequeo de
  // (d) de arriba en el caso normal (si (d) pasó, ya está por debajo) — se
  // mantiene como defensa en profundidad explícita, mismo criterio que el
  // `maxWidth` del `fillText` del token en `tryRepaintLine`: el tapado nunca
  // puede cruzar hacia el territorio de otra entidad, ni siquiera si algún
  // cálculo de arriba tuviera un error.
  const eraseRightPt = Math.min(Math.max(runEnd, newRunEndPx / scale), effectiveRightLimitPt);

  return { font: calibration.font, delta, neighbors, lineTopPt, lineBottomPt, eraseRightPt };
}

/**
 * ADR-058 §4 — muestrea, sobre el bbox ESCALADO de la palabra original y
 * ANTES de tapar nada: la tinta (píxel más oscuro dentro de la caja) y el
 * fondo (color dominante del borde/anillo exterior de la caja). Aproximación
 * deliberada de "área del glifo" (no hay máscara de glifo disponible, solo
 * el bbox de la palabra completa) — spec Render_Engine.md §6.
 */
function sampleInkAndBackground(
  context: OffscreenCanvasRenderingContext2D,
  scaledBbox: BoundingBox,
): { readonly ink: string; readonly background: string } {
  const x = Math.max(0, Math.round(scaledBbox.x));
  const y = Math.max(0, Math.round(scaledBbox.y));
  const width = Math.max(1, Math.round(scaledBbox.width));
  const height = Math.max(1, Math.round(scaledBbox.height));
  const { data } = context.getImageData(x, y, width, height);

  let ink = { r: 0, g: 0, b: 0 };
  let darkestLuminance = Number.POSITIVE_INFINITY;
  const borderCounts = new Map<string, { count: number; r: number; g: number; b: number }>();

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const idx = (py * width + px) * 4;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance < darkestLuminance) {
        darkestLuminance = luminance;
        ink = { r, g, b };
      }
      if (px === 0 || py === 0 || px === width - 1 || py === height - 1) {
        const key = `${r},${g},${b}`;
        const entry = borderCounts.get(key);
        if (entry === undefined) borderCounts.set(key, { count: 1, r, g, b });
        else entry.count += 1;
      }
    }
  }

  let background = { r: 255, g: 255, b: 255 };
  let bestCount = -1;
  for (const entry of borderCounts.values()) {
    if (entry.count > bestCount) {
      bestCount = entry.count;
      background = { r: entry.r, g: entry.g, b: entry.b };
    }
  }

  return {
    ink: `rgb(${ink.r}, ${ink.g}, ${ink.b})`,
    background: `rgb(${background.r}, ${background.g}, ${background.b})`,
  };
}

/**
 * ADR-058 §2 — si `planLineRepaint` aprueba las cinco condiciones, ejecuta
 * el repintado: tapa desde `bbox.x` hasta el fin de línea con el color de
 * fondo muestreado, dibuja el token en `bbox.x` con la tipografía calibrada
 * y el color de tinta muestreado, y redibuja cada palabra vecina en su
 * propia x **desplazada por el mismo delta uniforme** — reposicionamiento,
 * no re-maquetado (Contexto §6: preserva el espaciado del texto justificado
 * y evita que el error de calibración se acumule). Devuelve `true` si pintó
 * (el caller no debe caer al shrink-to-fit) o `false` si alguna condición
 * falló (el caller cae al camino existente de PR1, sin error ni warning).
 */
function tryRepaintLine(
  context: OffscreenCanvasRenderingContext2D,
  measureWidth: (font: string, text: string) => number,
  replacement: Replacement,
  scaledBbox: BoundingBox,
  lineWords: ReadonlyArray<Word>,
  otherReplacements: ReadonlyArray<Replacement>,
  scale: number,
  pageWidthPx: number,
): boolean {
  const plan = planLineRepaint(
    measureWidth,
    replacement,
    scaledBbox,
    lineWords,
    otherReplacements,
    scale,
    pageWidthPx,
  );
  if (plan === undefined) return false;

  // §4: muestreo ANTES de tapar nada, una sola vez por línea repintada.
  const { ink, background } = sampleInkAndBackground(context, scaledBbox);

  const eraseX = scaledBbox.x;
  const eraseY = plan.lineTopPt * scale;
  const eraseWidth = plan.eraseRightPt * scale - eraseX;
  const eraseHeight = plan.lineBottomPt * scale - eraseY;
  context.fillStyle = background;
  context.fillRect(eraseX, eraseY, eraseWidth, eraseHeight);

  // Dibujado a la izquierda (no centrado): el spec dice "dibujar el token en
  // bbox.x" — el ancla es el borde izquierdo, no el centro de la caja.
  // `maxWidth = eraseWidth` es redundante por construcción (la condición (d)
  // ya garantizó que el token calibrado entra antes del margen) — defensa en
  // profundidad, mismo espíritu que la red de seguridad de ADR-058 §1: si
  // algún cálculo de arriba tuviera un error, esto sigue sin poder derramarse
  // más allá de la propia zona tapada.
  context.fillStyle = ink;
  context.font = plan.font;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(
    replacement.replacementValue,
    scaledBbox.x,
    scaledBbox.y + scaledBbox.height / 2,
    eraseWidth,
  );

  for (const neighbor of plan.neighbors) {
    const neighborBbox = scaleBbox(neighbor.bbox, scale);
    context.fillText(
      neighbor.text,
      neighborBbox.x + plan.delta,
      neighborBbox.y + neighborBbox.height / 2,
    );
  }

  return true;
}

/**
 * Prefijos first-party de los assets de pdfjs-dist que sirve la app bajo
 * `/pdfjs/` (ADR-053 §3/§4, copiados de `node_modules` en `predev`/`prebuild`
 * de `apps/react-client` — PR B1 de ADR-053 §9). Constantes de módulo, NO un
 * campo de `EngineConfig` (mismo patrón que `NER_LOCAL_MODEL_PATH`/
 * `NER_WASM_PATH` en `ner-engine/src/worker/kernel.ts`): `public/` se copia
 * verbatim, sin hashear, así que pdfjs-dist resuelve estos 169 archivos por
 * nombre contra un prefijo estable — no hace falta que el Core los conozca
 * por config.
 */
const RENDER_PDFJS_CMAP_URL = "/pdfjs/cmaps/";
const RENDER_PDFJS_STANDARD_FONT_DATA_URL = "/pdfjs/standard_fonts/";

/** `PDFDocumentProxy` cargados por este kernel, indexados por `documentId`. */
const documents = new Map<string, PDFDocumentProxy>();

/**
 * `CMapReaderFactory` propia para `getDocument()` (ADR-053 §2, trampa 2 de
 * Contexto §6): pdf.js instancia la CLASE que se le pasa en
 * `CMapReaderFactory` — nunca una instancia —, así que esto es exactamente lo
 * que necesita, ni más ni menos. Usa `fetch()` pelado: a diferencia de
 * `DOMCMapReaderFactory` de pdf.js (no exportada por el paquete, por eso no se
 * extiende — solo se implementa su forma), NUNCA referencia `document`, que
 * no existe dentro de un Worker. Contrato (ADR-053 §2, verificado contra
 * `pdfjs-dist@4.10.38/build/pdf.mjs` líneas 6032-6060, `BaseCMapReaderFactory`):
 * constructor `{ baseUrl, isCompressed }`, `fetch({ name })` ->
 * `{ cMapData: Uint8Array, isCompressed }`, URL = `baseUrl + name +
 * (isCompressed ? ".bcmap" : "")`.
 */
export class RenderKernelCMapReaderFactory {
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
 * `StandardFontDataFactory` propia para `getDocument()` (ADR-053 §2, misma
 * trampa 2 que la factory de arriba): reemplaza a `DOMStandardFontDataFactory`
 * de pdf.js, que toca `document.baseURI` en su primer fetch. Contrato
 * (ADR-053 §2, verificado contra `pdf.mjs` líneas 6407-6431,
 * `BaseStandardFontDataFactory`): constructor `{ baseUrl }`, `fetch({
 * filename })` -> `Uint8Array`, URL = `baseUrl + filename`.
 */
export class RenderKernelStandardFontDataFactory {
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

function scaleBbox(bbox: BoundingBox, scale: number): BoundingBox {
  return {
    x: bbox.x * scale,
    y: bbox.y * scale,
    width: bbox.width * scale,
    height: bbox.height * scale,
  };
}

/**
 * El tamaño con el que se ARRANCA a dibujar: entero (los tamaños de fuente se
 * eligen en píxeles enteros) y acotado por abajo, porque por debajo de cierto
 * tamaño el texto ya no es texto.
 *
 * `minFontPx` es parámetro y no la constante directa por ADR-086 §2(b): el
 * piso es un límite de legibilidad **en píxeles de pantalla**, así que escala
 * igual que todo lo demás que el kernel dibuja. Un preview a escala 2 que
 * frenara en los mismos 8 px que uno a escala 1 estaría aplicando dos umbrales
 * visuales distintos a la misma decisión.
 */
function replacementFontSize(boxHeight: number, minFontPx: number): number {
  return Math.max(minFontPx, Math.round(boxHeight * REPLACEMENT_FONT_HEIGHT_RATIO));
}

/**
 * El tamaño de REFERENCIA: el que la caja pediría si el ancho no fuera
 * problema. **Nunca se dibuja** — solo se mide contra él.
 *
 * Por eso no lleva piso ni redondeo (ADR-086 §2(a)), a diferencia de
 * `replacementFontSize`. El piso existe para no dibujar texto ilegible, y acá
 * no se dibuja nada; tenerlo era lo que hacía que la referencia mintiera
 * ("lo natural acá son 8 px" cuando la caja pedía 8,4) y, como el piso es
 * absoluto y `boxHeight` escala, lo que rompía la invariancia de escala que
 * ADR-058 §7 daba por sentada. Sin piso y sin `Math.round`, la referencia es
 * exactamente proporcional a la caja y el veredicto sale idéntico a cualquier
 * escala.
 */
function naturalReferenceSize(boxHeight: number): number {
  return boxHeight * REPLACEMENT_FONT_HEIGHT_RATIO;
}

function replacementFontFamily(mode: ReplacementMode): string {
  return mode === ReplacementMode.Placeholder ? "monospace, sans-serif" : "sans-serif";
}

function buildReplacementFont(size: number, family: string): string {
  return `${size}px ${family}`;
}

/**
 * ADR-058 §1 (Hito 10.5, PR 1) — la garantía dura del ADR, la única de sus
 * cuatro piezas que no es "calidad" (spec Render_Engine.md §2): `paintReplacements`
 * derivaba el tamaño de fuente solo de `bbox.height` y llamaba `fillText` sin
 * `maxWidth`, con el texto centrado — un token más ancho que su caja se
 * derramaba hacia los dos lados, encima de palabras del original dibujadas
 * debajo (ADR-058, Contexto §1). Esta función mide con `measureWidth` (que en
 * producción es `context.measureText`, ver `paintReplacements` abajo) y
 * encoge el tamaño de fuente hasta que `text` entra en `availableWidth`, sin
 * bajar nunca de `REPLACEMENT_MIN_FONT_PX`. Si el token ya entraba al tamaño
 * inicial, el loop no itera ni una vez y el resultado es exactamente el que
 * producía la fórmula anterior — no-regresión bit a bit (ADR-058 §1: "si el
 * token entra, no se toca nada").
 *
 * `measureWidth` desacopla la medición real de canvas (que exige
 * `context.font` seteado antes de medir) de esta función, que queda pura y
 * testeable con cualquier función de medición determinista, sin necesitar un
 * `OffscreenCanvas`. Exportada para test directo (`kernel.test.ts`) — no
 * forma parte del `index.ts` público del paquete, mismo patrón que el resto
 * de las funciones exportadas de este archivo (ADR-043 §2).
 */
/** Resultado de `fitReplacementFontSized`: el font string con el que se dibuja, los dos tamaños, y el veredicto de legibilidad de ADR-086. */
export interface FittedReplacementFont {
  readonly font: string;
  /** Referencia, nunca dibujada: `boxHeight × REPLACEMENT_FONT_HEIGHT_RATIO`, exacto (ADR-086 §2a). */
  readonly naturalSizePx: number;
  /** El que se dibuja: entero y acotado por el piso escalado. */
  readonly finalSizePx: number;
  /**
   * ADR-086 §1 — `anchoDisponible / anchoNatural`, acotado a 1. **Es el
   * veredicto**: se compara contra `DEGRADED_FONT_RATIO`.
   *
   * Mide la compresión TOTAL, no una tercera cosa además del encogido de
   * fuente. El producto de las dos compresiones —vertical (`final/natural`) y
   * horizontal (el aplastado de `fillText(..., maxWidth)`)— se simplifica a
   * esto, porque el tamaño final se cancela:
   *
   * ```
   * (final/natural) × (anchoDisp / (final × k)) = anchoDisp / (natural × k)
   * ```
   *
   * Con `measureText` real la cancelación es aproximada en vez de exacta (las
   * métricas no son perfectamente lineales en el tamaño, por hinting); la
   * formulación por anchos es la primaria y la del producto solo explica de
   * dónde sale.
   */
  readonly widthRatio: number;
}

/**
 * Núcleo real del shrink-to-fit, exponiendo el tamaño NATURAL (con el que
 * arrancó, `replacementFontSize(boxHeight)`) y el FINAL (el que terminó
 * usando tras encoger o no). ADR-058 §7 necesita los dos para el umbral de
 * degradación (`finalSizePx / naturalSizePx < DEGRADED_FONT_RATIO`) — una
 * razón, no un tamaño absoluto (Contracts.md §6). `fitReplacementFont` (abajo)
 * sigue devolviendo solo el string de fuente sobre el mismo cálculo: ningún
 * call site ni test de PR1 cambia.
 */
export function fitReplacementFontSized(
  measureWidth: (font: string, text: string) => number,
  text: string,
  mode: ReplacementMode,
  boxHeight: number,
  availableWidth: number,
  minFontPx: number = REPLACEMENT_MIN_FONT_PX,
): FittedReplacementFont {
  const family = replacementFontFamily(mode);

  // El veredicto se calcula sobre la REFERENCIA y es independiente de dónde
  // termine el bucle: cuánto más angosto que su ancho natural quedó el texto
  // (ADR-086 §1). Un ancho natural de 0 —texto vacío— no puede degradar nada,
  // y además haría una división por cero.
  const naturalSizePx = naturalReferenceSize(boxHeight);
  const naturalWidth = measureWidth(buildReplacementFont(naturalSizePx, family), text);
  const widthRatio = naturalWidth > 0 ? Math.min(1, availableWidth / naturalWidth) : 1;

  let size = replacementFontSize(boxHeight, minFontPx);
  let font = buildReplacementFont(size, family);

  while (measureWidth(font, text) > availableWidth && size > minFontPx) {
    size -= 1;
    font = buildReplacementFont(size, family);
  }

  return { font, naturalSizePx, finalSizePx: size, widthRatio };
}

export function fitReplacementFont(
  measureWidth: (font: string, text: string) => number,
  text: string,
  mode: ReplacementMode,
  boxHeight: number,
  availableWidth: number,
): string {
  return fitReplacementFontSized(measureWidth, text, mode, boxHeight, availableWidth).font;
}

function toPageFailure(
  documentId: string,
  pageIndex: number,
  err: unknown,
): RenderPageFailedError | RenderTimeoutError {
  if (err instanceof RenderPageFailedError || err instanceof RenderTimeoutError) return err;
  const reason = err instanceof Error ? err.message : String(err);
  return new RenderPageFailedError(documentId, pageIndex, reason);
}

/**
 * Callback de logging opcional (spec §13 caso 14: "mostrar warning" cuando
 * `OffscreenCanvas` no está disponible). El kernel no tiene acceso a
 * `ctx.logger` (no es un `EngineContext` completo, ADR-043 §2) — el host
 * (`render.engine.ts`) lo cablea a `ctx.logger.warn` para el fallback
 * in-process; el worker real (`worker/entry.ts`) no lo cablea (sin bus/logger
 * puente, ver su nota de cabecera) — gap conocido, no bloqueante: en ese modo
 * el render igual falla con `RenderPageFailedError`, solo sin el warning
 * diagnóstico adicional.
 */
export type KernelWarnLogger = (message: string, meta: Readonly<Record<string, unknown>>) => void;

function createCanvas(
  documentId: string,
  pageIndex: number,
  width: number,
  height: number,
  onWarn?: KernelWarnLogger,
): OffscreenCanvas {
  // §13 caso 14: v1.0 puede requerir OffscreenCanvas.
  if (typeof OffscreenCanvas === "undefined") {
    onWarn?.(
      "OffscreenCanvas no disponible en este entorno; Render Engine v1.0 lo requiere (spec §13 caso 14).",
      {
        documentId,
        pageIndex,
      },
    );
    throw new RenderPageFailedError(
      documentId,
      pageIndex,
      "OffscreenCanvas no disponible en este entorno.",
    );
  }
  return new OffscreenCanvas(width, height);
}

function get2dContext(
  canvas: OffscreenCanvas,
  documentId: string,
  pageIndex: number,
): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new RenderPageFailedError(
      documentId,
      pageIndex,
      "No se pudo obtener un contexto 2D de OffscreenCanvas.",
    );
  }
  return context;
}

async function renderPageOntoContext(
  pageProxy: PDFPageProxy,
  context: OffscreenCanvasRenderingContext2D,
  viewport: PageViewport,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new RenderTimeoutError(documentId, pageIndex, timeoutMs));
    }, timeoutMs);
  });

  try {
    /*
     * pdfjs-dist@4.x tipa `PDFPageProxy.render({ canvasContext })` como
     * `CanvasRenderingContext2D` (contexto de un <canvas> de DOM), pero en
     * runtime pdf.js acepta cualquier contexto de canvas 2D válido —
     * incluido `OffscreenCanvasRenderingContext2D`, exactamente lo que exige
     * Render_Engine.md §1 y 05_Worker_Architecture.md §7.4 (OffscreenCanvas +
     * pdfjs-dist; fe de erratas ADR-030 §5, antes decía "pdf-lib"). El `.d.ts`
     * de la librería no refleja ese soporte (gap de tipos conocido, no
     * corregible sin tocar el paquete). Único `as unknown as` de este
     * paquete (ADR-031 §4, Code_Standards.md §10) — relocalizado acá desde
     * `render.engine.ts` por ADR-043 (el kernel es ahora quien invoca pdfjs).
     */
    await Promise.race([
      pageProxy.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise,
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * ADR-066 §7 — ángulo de `context.rotate()` para `bbox.rotation: 90 | 270`.
 * `rotation` sale de `atan2(dir.y, dir.x)` sobre la matriz de PDF.js en
 * espacio de usuario (Y hacia arriba, CCW positivo —
 * `pdf-engine/src/pdf.engine.ts#deriveRotation`, ADR-063 §1). El canvas
 * dibuja en espacio página (Y hacia abajo, origen arriba-izquierda — el mismo
 * que `bbox.x`/`bbox.y`), donde `context.rotate()` es horario para ángulos
 * positivos. La conversión entre los dos espacios invierte la componente Y de
 * cualquier vector (la misma reflexión que ya aplica `pageHeight - yMax` al
 * bbox, `pdf.engine.ts`), lo que invierte el sentido de giro observado:
 * `rotation: 90` (el texto avanza hacia +Y en espacio PDF) resulta en un
 * avance hacia arriba en el canvas, `context.rotate(-π/2)`; `rotation: 270`
 * es el espejo, `+π/2`.
 */
const CANVAS_ROTATION_RADIANS: Readonly<Record<90 | 270, number>> = {
  90: -Math.PI / 2,
  270: Math.PI / 2,
};

/**
 * ADR-074 §4/§5 — expande un `Replacement` con `fragments` en N **unidades de
 * pintado**, cada una un `Replacement` de un solo rectángulo (`bbox` =
 * fragmento, sin `fragments`): el bucle de `paintReplacements` no se entera
 * de que existe la fragmentación, recibe exactamente lo que siempre asumió.
 *
 * Una unidad **primaria** —el fragmento más ancho, empate → el primero en
 * orden de lectura (ADR-074 §5; los fragmentos ya vienen ordenados así,
 * `mapSpanToWords`)— conserva `replacementValue` y pasa por el camino
 * completo de siempre. Las N-1 restantes son de **solo tapado**:
 * `replacementValue: ""`, la señal que `paintReplacements` usa para tapar el
 * fondo y cortar ahí mismo — sin `fillText`, sin fitting, sin veredicto de
 * degradación (no puede degradar lo que no dibuja). En `redact`, el bucle ya
 * ignora `replacementValue` (fill negro sin texto, primera rama de
 * `paintReplacements`), así que las N unidades se comportan igual sin
 * ninguna distinción primaria/secundaria.
 *
 * Sin `fragments` (el caso normal, ~99% de las ocurrencias): una sola unidad,
 * el `Replacement` original sin tocar — no-regresión bit a bit.
 */
function expandReplacementToUnits(replacement: Replacement): ReadonlyArray<Replacement> {
  const { fragments, ...withoutFragments } = replacement;
  if (fragments === undefined) return [replacement];

  let widestIndex = 0;
  for (let i = 1; i < fragments.length; i++) {
    const current = fragments[i];
    const widest = fragments[widestIndex];
    if (current !== undefined && widest !== undefined && current.width > widest.width) {
      widestIndex = i;
    }
  }

  return fragments.map((fragment, i) => ({
    ...withoutFragments,
    bbox: fragment,
    ...(i === widestIndex ? {} : { replacementValue: "" }),
  }));
}

/**
 * Pinta los reemplazos y devuelve las anotaciones `Degraded` (ADR-058 §7) que
 * detectó al hacerlo: una por cada reemplazo cuyo shrink-to-fit (§1) lo dejó
 * por debajo de `DEGRADED_FONT_RATIO`. Sintetizadas acá mismo (no en
 * `kernelRenderPage`) porque es este loop el único lugar que tiene, a la vez,
 * el `Replacement` original y el resultado del encogido — separarlo exigiría
 * repetir la misma iteración o transportar el resultado por otro lado.
 *
 * ADR-066 §7: cuando `bbox.rotation` es `90`/`270`, el eje que hace de "ancho
 * disponible" para el shrink-to-fit y el token se intercambian —mide contra
 * el lado largo (`bbox.height` en una franja vertical), el tamaño de fuente
 * sale del lado corto— y el token se dibuja rotado, centrado en la caja.
 * `180` cae al camino sin intercambiar ejes (la caja es la misma que en 0°,
 * rotarlo lo dejaría cabeza abajo). Sin `rotation`, ningún byte de este loop
 * cambia respecto de antes de ADR-066 (no-regresión).
 */
function paintReplacements(
  context: OffscreenCanvasRenderingContext2D,
  replacements: ReadonlyArray<Replacement>,
  lineWords: ReadonlyArray<Word>,
  scale: number,
  pageWidthPx: number,
  abortSignal: AbortSignal,
  documentId: string,
): ReadonlyArray<Annotation> {
  const measureWidth = (font: string, text: string): number => {
    context.font = font;
    return context.measureText(text).width;
  };
  const degraded: Annotation[] = [];
  // ADR-074 §4: unidades de pintado, no `Replacement[]` — cada fragmento de
  // cada reemplazo es un rectángulo independiente para el resto del bucle,
  // INCLUIDO `otherReplacements` más abajo (caso 33: los fragmentos vecinos,
  // propios o ajenos, se ven como reemplazos independientes).
  const units = replacements.flatMap(expandReplacementToUnits);

  for (const replacement of units) {
    if (abortSignal.aborted) throw new CancelledError(documentId);
    const bbox = scaleBbox(replacement.bbox, scale);

    if (replacement.mode === ReplacementMode.Redact) {
      // §13 caso 3: fill opaco negro, sin texto.
      context.fillStyle = REDACT_FILL_COLOR;
      context.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
      continue;
    }

    // ADR-066 §7: `90`/`270` intercambian qué eje escalado es "tamaño de
    // fuente" y cuál es "largo disponible" — `180`/ausente usan bbox.height/
    // bbox.width tal cual (no-regresión). `sidewaysRotation` (en vez de un
    // booleano) es lo que deja a TS angostar el tipo de `rotation` a `90|270`
    // dentro del branch de dibujo rotado, sin `as`.
    const rotation = replacement.bbox.rotation;
    const sidewaysRotation: 90 | 270 | undefined =
      rotation === 90 || rotation === 270 ? rotation : undefined;
    const fontSizeAxisPx = sidewaysRotation !== undefined ? bbox.width : bbox.height;
    const availableLengthPx = sidewaysRotation !== undefined ? bbox.height : bbox.width;

    // ADR-058 §2: punto de decisión. Si el token entra a su tamaño NATURAL
    // (sin ningún encogido) en el largo disponible, camino actual sin
    // cambios — ni un byte distinto de antes de este PR (no-regresión, "line
    // repaint does not trigger when the token fits"). Si no entra, se
    // intenta el repintado de línea (§2-§4, condiciones de §6); si
    // `tryRepaintLine` devuelve `false` (alguna condición no se cumple, o
    // `lineWords` vino ausente/sin vecinas útiles), se cae al shrink-to-fit
    // ya existente de PR1 — sin error, sin warning (spec §9: "ausentes nunca
    // es un error"). El repintado de línea queda **fuera de alcance para
    // texto rotado** (ADR-066 §7, caso 27 de Render_Engine.md §13 no
    // cambia): `sidewaysRotation !== undefined` salta directo al
    // shrink-to-fit, nunca llama a `tryRepaintLine`.
    const naturalFont = buildReplacementFont(
      replacementFontSize(fontSizeAxisPx, REPLACEMENT_MIN_FONT_PX * scale),
      replacementFontFamily(replacement.mode),
    );
    const fitsNaturally =
      measureWidth(naturalFont, replacement.replacementValue) <= availableLengthPx;

    if (!fitsNaturally && sidewaysRotation === undefined) {
      // Guard defensivo (ver doc de `planLineRepaint`): el resto de las
      // unidades de esta página nunca se pisan por el repintado de esta —
      // incluidos los fragmentos hermanos de este mismo Replacement (ADR-074
      // §4, caso 33), que ya vienen aparte en `units`.
      const otherReplacements = units.filter((other) => other !== replacement);
      const repainted = tryRepaintLine(
        context,
        measureWidth,
        replacement,
        bbox,
        lineWords,
        otherReplacements,
        scale,
        pageWidthPx,
      );
      if (repainted) continue;
    }

    // §13 casos 4/5/6 (mask/placeholder/synthetic): fondo + texto centrado,
    // encogido para entrar en el largo disponible (ADR-058 §1: shrink-to-fit,
    // piso REPLACEMENT_MIN_FONT_PX). `maxWidth` en `fillText` es la red de
    // seguridad final para cuando ni el piso alcanza (caso 25 del spec). Es
    // el mismo bloque de siempre: cuando `fitsNaturally` es `true`,
    // `fitReplacementFont` no itera ni una vez y produce el mismo resultado
    // de antes de ADR-058 §2-§6 (no-regresión bit a bit).
    context.fillStyle = REPLACEMENT_BG_COLOR;
    context.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);

    // ADR-074 §4: unidad de "solo tapado" — un fragmento que no es el
    // primario (`expandReplacementToUnits` le vacía `replacementValue`). El
    // fondo ya se tapó arriba; sin texto que dibujar, tampoco hay fitting ni
    // veredicto de degradación que evaluar (no puede degradar lo que no
    // dibuja), así que corta acá y nunca llega a `fillText`.
    if (replacement.replacementValue === "") continue;

    context.fillStyle = REPLACEMENT_TEXT_COLOR;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const fitted = fitReplacementFontSized(
      measureWidth,
      replacement.replacementValue,
      replacement.mode,
      fontSizeAxisPx,
      availableLengthPx,
      // ADR-086 §2(b): el piso de dibujo escala con el render.
      REPLACEMENT_MIN_FONT_PX * scale,
    );
    context.font = fitted.font;

    if (sidewaysRotation !== undefined) {
      // ADR-066 §7 (a): rota alrededor del centro de la caja y dibuja
      // centrado en (0,0) — el token queda dentro del rectángulo porque
      // `fitted`/`maxWidth` ya midieron contra `availableLengthPx` (el eje
      // largo, ahora el eje local tras la rotación); misma garantía de
      // ADR-058 §1 (caso 25), con los ejes intercambiados.
      context.save();
      context.translate(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
      context.rotate(CANVAS_ROTATION_RADIANS[sidewaysRotation]);
      context.fillText(replacement.replacementValue, 0, 0, availableLengthPx);
      context.restore();
    } else {
      context.fillText(
        replacement.replacementValue,
        bbox.x + bbox.width / 2,
        bbox.y + bbox.height / 2,
        bbox.width,
      );
    }

    // ADR-058 §7/caso 28: la razón, no el tamaño en sí. `fitted.naturalSizePx`
    // y `fitted.finalSizePx` salen los dos de este mismo `bbox` YA escalado
    // (scaleBbox más arriba) — preview y full miden el reemplazo en su propio
    // espacio de píxeles pero calculan la razón sobre magnitudes que escalan
    // igual, así que el cociente es invariante sin ningún ajuste adicional
    // (verificado por el test de invariancia de escala en unit.test.ts).
    if (fitted.widthRatio < DEGRADED_FONT_RATIO) {
      degraded.push({
        id: replacement.occurrenceId,
        groupId: replacement.groupId,
        pageIndex: replacement.pageIndex,
        bbox: replacement.bbox,
        kind: AnnotationKind.Degraded,
      });
    }
  }

  return degraded;
}

function paintAnnotations(
  context: OffscreenCanvasRenderingContext2D,
  annotations: ReadonlyArray<Annotation>,
  scale: number,
  abortSignal: AbortSignal,
  documentId: string,
): void {
  for (const annotation of annotations) {
    if (abortSignal.aborted) throw new CancelledError(documentId);
    // §2/§13 casos 7-8/28: en kind="original" pinta highlight y conflict; en
    // kind="anonymized" (ADR-058 §7) `kernelRenderPage` reusa esta misma
    // función solo para las `Degraded` que detectó `paintReplacements` — un
    // AnnotationKind sin dibujo definido acá simplemente se ignora.
    if (
      annotation.kind !== AnnotationKind.Highlight &&
      annotation.kind !== AnnotationKind.Conflict &&
      annotation.kind !== AnnotationKind.Degraded
    ) {
      continue;
    }
    const bbox = scaleBbox(annotation.bbox, scale);
    context.strokeStyle =
      annotation.kind === AnnotationKind.Conflict
        ? CONFLICT_COLOR
        : annotation.kind === AnnotationKind.Degraded
          ? DEGRADED_COLOR
          : HIGHLIGHT_COLOR;
    context.lineWidth = ANNOTATION_LINE_WIDTH;
    context.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
  }
}

/**
 * Codifica `ImageData` a PNG/JPEG vía `OffscreenCanvas.convertToBlob`
 * (ADR-034 §3): "donde vive el canvas" — un `OffscreenCanvas` temporal
 * pintado con `putImageData`.
 */
async function encodeImageData(
  imageData: ImageData,
  imageFormat: "png" | "jpeg",
  quality: number,
  documentId: string,
  pageIndex: number,
  onWarn?: KernelWarnLogger,
): Promise<EncodedPageImage> {
  const canvas = createCanvas(documentId, pageIndex, imageData.width, imageData.height, onWarn);
  const context = get2dContext(canvas, documentId, pageIndex);
  context.putImageData(imageData, 0, 0);

  let blob: Blob;
  try {
    blob = await canvas.convertToBlob({ type: `image/${imageFormat}`, quality });
  } catch (err: unknown) {
    throw toPageFailure(documentId, pageIndex, err);
  }
  const bytes = await blob.arrayBuffer();
  return { bytes, format: imageFormat, widthPx: imageData.width, heightPx: imageData.height };
}

// ─── Puerto interno (ADR-043 §2): las 4 operaciones ───

export async function kernelLoadDocument(
  payload: LoadDocumentPayload,
): Promise<{ readonly pageCount: number }> {
  // ADR-050 §1/§2: `password` opcional — se usa una única vez acá, abajo, y
  // no se guarda en ningún estado del kernel (ni en `documents`, ni en
  // ninguna otra variable de módulo). Una vez que `getDocument` resuelve el
  // `PDFDocumentProxy`, el password ya no se vuelve a necesitar.
  const { documentId, buffer, password } = payload;

  // ADR-030 §1: recarga determinística — destruye el proxy anterior si existía.
  const existing = documents.get(documentId);
  if (existing !== undefined) void existing.destroy();

  let pdfDocument: PDFDocumentProxy;
  try {
    // Regla transversal de 05_Worker_Architecture.md §7 (ADR-053): este
    // kernel corre la capa de display de pdf.js dentro de un Web Worker, sin
    // `document`. Las cinco opciones de abajo + las dos factories propias son
    // SOLIDARIAS — omitir cualquiera rompe el visor entero (ADR-053 Contexto
    // §6):
    //  - disableFontFace: dibuja los glifos como Path2D desde el programa de
    //    fuente embebido en vez de un @font-face registrado en el DOM (que no
    //    existe acá); además viaja en evaluatorOptions y es lo que hace que
    //    pdf.js construya y envíe las siluetas (trampa 3).
    //  - useSystemFonts: false evita el camino loadSystemFont, que sin Font
    //    Loading API llega a un unreachable().
    //  - useWorkerFetch: false EXPLÍCITO (trampa 1): el default de pdf.js
    //    evalúa `document.baseURI` al calcularse — con las URLs de cMap/
    //    standardFont ya pasadas, esa expresión se evalúa completa y tira
    //    ReferenceError dentro del Worker.
    //  - cMapUrl/cMapPacked + standardFontDataUrl: fuentes CID con CMap
    //    predefinido y fuentes no embebidas (standard-14/sustituciones).
    //  - CMapReaderFactory/StandardFontDataFactory propias (trampa 2): las
    //    DOM* de pdf.js tocan document.baseURI en su primer fetch; servir los
    //    assets sin esto no alcanza.
    const loadingTask = getDocument({
      data: buffer,
      password,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      cMapUrl: RENDER_PDFJS_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: RENDER_PDFJS_STANDARD_FONT_DATA_URL,
      CMapReaderFactory: RenderKernelCMapReaderFactory,
      StandardFontDataFactory: RenderKernelStandardFontDataFactory,
    });
    pdfDocument = await loadingTask.promise;
  } catch (err: unknown) {
    // ADR-030 §2: getDocument() fallando acá es excepcional (la etapa 1 ya validó el PDF).
    const reason = err instanceof Error ? err.message : String(err);
    throw new RenderFailedError(documentId, reason);
  }

  documents.set(documentId, pdfDocument);
  return { pageCount: pdfDocument.numPages };
}

export function kernelUnloadDocument(payload: UnloadDocumentPayload): Promise<void> {
  const existing = documents.get(payload.documentId);
  if (existing === undefined) return Promise.resolve(); // ADR-030 §1/§3: no-op idempotente.
  documents.delete(payload.documentId);
  void existing.destroy();
  return Promise.resolve();
}

export interface KernelRenderOptions {
  readonly jpegQuality: number;
  readonly timeoutMs: number;
  readonly abortSignal: AbortSignal;
  readonly onWarn?: KernelWarnLogger;
}

export interface KernelRenderResult {
  readonly imageData: ImageData;
  /**
   * ADR-062 §1: las anotaciones `Degraded` de ESTE render. El kernel ya las
   * calculaba para decidir si pintar el recuadro de aviso en el preview; lo
   * que faltaba era **devolverlas**, que es el único camino por el que el
   * veredicto sale de este motor.
   *
   * Siempre presente (array vacío si no hay ninguna) y siempre calculado, en
   * los dos modos: el cociente `finalSize/naturalSize` es invariante a la
   * escala por diseño (ADR-058 §7), así que preview y export coinciden
   * siempre sobre si hay que avisar. Vacío también para `kind: "original"`,
   * que no pinta reemplazos.
   */
  readonly degraded: ReadonlyArray<Annotation>;
  // Siempre presente (a diferencia de `RenderPageOutput.encoded`, público y
  // opcional según `mode` — Render_Engine.md §10): el host decide si lo
  // expone según `mode === "full"`, y reusa este mismo valor para el blob de
  // `PREVIEW_UPDATED` en `mode: "preview"` sin re-codificar ni tocar
  // OffscreenCanvas fuera del kernel (ver `render.engine.ts#emitPreviewUpdated`).
  readonly encoded: EncodedPageImage;
}

/**
 * `RenderPagePayload` construido por el host con `scale`/`imageFormat` ya
 * resueltos (nunca `undefined` en la práctica: `render.engine.ts` aplica los
 * defaults de `previewScale`/`fullScale`/formato antes de despachar) —
 * defensivamente se toleran acá también por si algún día un caller directo al
 * kernel omite alguno.
 */
export async function kernelRenderPage(
  payload: RenderPagePayload,
  opts: KernelRenderOptions,
): Promise<KernelRenderResult> {
  const { documentId, pageIndex, kind, mode } = payload;
  const pdfDocument = documents.get(documentId);
  if (pdfDocument === undefined) {
    throw new InvalidInputError(
      `Documento ${documentId} no está cargado en el kernel de Render (ADR-030).`,
      { documentId },
    );
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDocument.numPages) {
    throw new InvalidInputError(
      `pageIndex ${pageIndex} fuera de rango para documento con ${pdfDocument.numPages} páginas.`,
      { documentId, pageIndex, pageCount: pdfDocument.numPages },
    );
  }

  const replacements = payload.replacements ?? [];
  const annotations = payload.annotations ?? [];
  const scale = payload.scale ?? 1;
  const imageFormat = payload.imageFormat ?? (mode === "preview" ? "png" : "jpeg");

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  let pageProxy: PDFPageProxy;
  try {
    pageProxy = await pdfDocument.getPage(pageIndex + 1);
  } catch (err: unknown) {
    throw toPageFailure(documentId, pageIndex, err);
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  const viewport = pageProxy.getViewport({ scale });
  const canvas = createCanvas(documentId, pageIndex, viewport.width, viewport.height, opts.onWarn);
  const context2d = get2dContext(canvas, documentId, pageIndex);

  try {
    await renderPageOntoContext(
      pageProxy,
      context2d,
      viewport,
      documentId,
      pageIndex,
      opts.timeoutMs,
    );
  } catch (err: unknown) {
    throw toPageFailure(documentId, pageIndex, err);
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  let degradedVerdict: ReadonlyArray<Annotation> = [];
  if (kind === "anonymized") {
    // ADR-058 §5: `lineWords` ausente es el caso normal (página donde todo
    // entra a tamaño natural) y nunca un error — se resuelve a `[]`, que hace
    // que `tryRepaintLine` falle la condición (a) para cada reemplazo y el
    // kernel caiga al shrink-to-fit de PR1 sin tocar `getImageData` ni una vez.
    const degraded = paintReplacements(
      context2d,
      replacements,
      payload.lineWords ?? [],
      scale,
      viewport.width,
      opts.abortSignal,
      documentId,
    );
    // ADR-058 §7 + nota posterior (ver ADR-058 "Docs actualizados", entrada de
    // repintado preview-only): la anotación Degraded se pinta reutilizando
    // `paintAnnotations`, pero SOLO en `mode: "preview"`. El export es el
    // archivo que un tercero recibe; un recuadro de aviso ahí no tiene ninguna
    // afordancia que lo explique (ADR-062 dejó la marca accionable del árbol
    // fuera de este hito) y queda como ruido visual permanente en el
    // documento final. El veredicto en sí (`degraded`) se sigue calculando
    // igual en los dos modos — es invariante a la escala por diseño (§7) — solo
    // cambia si se pinta.
    if (mode === "preview" && degraded.length > 0) {
      paintAnnotations(context2d, degraded, scale, opts.abortSignal, documentId);
    }
    degradedVerdict = degraded;
  } else {
    paintAnnotations(context2d, annotations, scale, opts.abortSignal, documentId);
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  const imageData = context2d.getImageData(0, 0, viewport.width, viewport.height);

  // ADR-034 §3 + ADR-043 (relocalizado al kernel): se codifica siempre —
  // tanto `mode: "full"` (para `RenderPageOutput.encoded` público) como
  // `mode: "preview"` (para el blob de `PREVIEW_UPDATED`, que antes de
  // ADR-043 se re-codificaba por fuera, host-side; ahora lo hace el mismo
  // kernel una sola vez). El host decide qué exponer públicamente.
  const encoded = await encodeImageData(
    imageData,
    imageFormat,
    opts.jpegQuality,
    documentId,
    pageIndex,
    opts.onWarn,
  );

  return { imageData, encoded, degraded: degradedVerdict };
}

export interface KernelRasterizeOptions {
  readonly timeoutMs: number;
  readonly abortSignal: AbortSignal;
  readonly onWarn?: KernelWarnLogger;
}

/**
 * ADR-065 §5 / `Render_Engine.md` §13 caso 30 — clampea `region` (puntos de
 * página) a los límites de la página ya convertidos a píxeles por `scale`.
 * Redondea cada BORDE (no cada dimensión) para que el recorte quede alineado
 * a píxel entero sin el sesgo de redondear ancho y alto por separado. Lanza
 * `InvalidInputError` si el área resultante es cero o negativa — mismo
 * patrón que el guard existente de `scale <= 0`.
 */
function clampRegionToViewportPx(
  region: BoundingBox,
  scale: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  documentId: string,
  pageIndex: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const left = Math.round(Math.max(0, region.x * scale));
  const top = Math.round(Math.max(0, region.y * scale));
  const right = Math.round(Math.min(viewportWidthPx, (region.x + region.width) * scale));
  const bottom = Math.round(Math.min(viewportHeightPx, (region.y + region.height) * scale));
  const width = right - left;
  const height = bottom - top;

  if (!(width > 0) || !(height > 0)) {
    throw new InvalidInputError(
      "region clampeada a los límites de la página quedó con área cero o negativa (ADR-065 §5).",
      { documentId, pageIndex, region, scale, viewportWidthPx, viewportHeightPx },
    );
  }

  return { x: left, y: top, width, height };
}

/**
 * Rasterización pura sin reemplazos ni highlights (ADR-034 §1). `region`
 * opcional (ADR-065 §5): ausente reproduce el comportamiento previo bit a
 * bit (rama `else` sin tocar); presente, el kernel clampea a los límites de
 * la página ANTES de rasterizar (evita pagar el costo de
 * `renderPageOntoContext` sobre una región inválida) y devuelve únicamente el
 * recorte — es el `ImageData` que cruza el boundary del worker, nunca la
 * página entera.
 */
export async function kernelRasterizePage(
  payload: RasterizePagePayload,
  opts: KernelRasterizeOptions,
): Promise<ImageData> {
  const { documentId, pageIndex, scale, region } = payload;
  const pdfDocument = documents.get(documentId);
  if (pdfDocument === undefined) {
    throw new InvalidInputError(
      `Documento ${documentId} no está cargado en el kernel de Render (ADR-030, ADR-034 §1).`,
      { documentId },
    );
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDocument.numPages) {
    throw new InvalidInputError(
      `pageIndex ${pageIndex} fuera de rango para documento con ${pdfDocument.numPages} páginas.`,
      { documentId, pageIndex, pageCount: pdfDocument.numPages },
    );
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  let pageProxy: PDFPageProxy;
  try {
    pageProxy = await pdfDocument.getPage(pageIndex + 1);
  } catch (err: unknown) {
    throw toPageFailure(documentId, pageIndex, err);
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  const viewport = pageProxy.getViewport({ scale });
  const cropRect =
    region !== undefined
      ? clampRegionToViewportPx(
          region,
          scale,
          viewport.width,
          viewport.height,
          documentId,
          pageIndex,
        )
      : undefined;

  const canvas = createCanvas(documentId, pageIndex, viewport.width, viewport.height, opts.onWarn);
  const context2d = get2dContext(canvas, documentId, pageIndex);

  try {
    await renderPageOntoContext(
      pageProxy,
      context2d,
      viewport,
      documentId,
      pageIndex,
      opts.timeoutMs,
    );
  } catch (err: unknown) {
    throw toPageFailure(documentId, pageIndex, err);
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  return cropRect !== undefined
    ? context2d.getImageData(cropRect.x, cropRect.y, cropRect.width, cropRect.height)
    : context2d.getImageData(0, 0, viewport.width, viewport.height);
}

// ─── ADR-059 §5 (Hito 10.5, PR 7) — página de leyenda del export ───
//
// `createCanvas`/`get2dContext`/`encodeImageData`/`toPageFailure` (arriba)
// están tipados para pedir `documentId`/`pageIndex` porque el resto del
// kernel sí los tiene. `renderLegendPage` no tiene ninguno de los dos — no
// corresponde a ninguna página de ningún PDF (spec §13 caso 29) — así que se
// les pasa un rótulo sintético fijo, usado únicamente en mensajes de
// diagnóstico (nunca contenido del documento, Code_Standards.md §9). Reusar
// estos tres helpers tal cual, en vez de duplicarlos sin `documentId`/
// `pageIndex`, es lo que mantiene a esta operación con el mismo
// comportamiento de errores (OffscreenCanvas no disponible, `convertToBlob`
// falla) que el resto del kernel.
const LEGEND_DOCUMENT_LABEL = "(legend)";
const LEGEND_PAGE_LABEL = -1;

// Layout (ADR-059 §5, Render_Engine.md §6/§13 caso 29): tabla de hasta 13
// filas (cota de `EntityType`, ADR-059 §2) a `y` incremental con columnas a
// `x` fijas, **con salto de línea dentro de cada celda** y sin paginación. El
// espaciado/tipografía exactos no están en el spec ("decisión de estilo
// visual, sin spec pixel-perfect"): título en negrita, tres columnas fijas en
// el mismo orden que el ejemplo de ADR-059 §2 (prefixes, tipo, conteo),
// fuente sans-serif genérica — igual criterio que `replacementFontFamily` (el
// kernel corre con `disableFontFace: true`, ADR-053: solo hay familias
// genéricas disponibles).
//
// El salto de línea NO es cosmético (corregido 2026-08-19): la celda de
// prefijos crece con la escalera de abreviaturas (ADR-057, 3 niveles) por las
// variantes de género (ADR-060), así que un tipo `Person` puede acumular hasta
// 9 prefijos distintos — `"HOMB, PRS, MUJ, HOMBRE, HOM, MUJER"` medido en un
// export real. Escrito en una sola línea, ese texto **se superpone con la
// columna del nombre del tipo** y la referencia queda ilegible justo donde
// tiene que explicar qué significa cada marcador.
const LEGEND_MARGIN_PT = 40;
const LEGEND_TITLE_FONT = "bold 16px sans-serif";
const LEGEND_ROW_FONT = "12px sans-serif";
const LEGEND_TITLE_TO_TABLE_GAP_PT = 30;
/** Alto de línea del título, si se envuelve en una página angosta. */
const LEGEND_TITLE_LINE_HEIGHT_PT = 20;
const LEGEND_ROW_HEIGHT_PT = 20;
const LEGEND_TEXT_COLOR = "#000000";
const LEGEND_BACKGROUND_COLOR = "#ffffff";
const LEGEND_TITLE_TEXT = "Anonimizado con Anonly — Referencia de marcadores";
/**
 * Offsets de columna como **fracción del ancho útil**, no en puntos
 * absolutos. La leyenda se dibuja sobre una página del tamaño del documento
 * (`legendPageWidthPt` = ancho de la primera página), así que constantes
 * absolutas tuneadas para A4 (0/220/420 pt) ponían la tercera columna
 * **fuera de la página** en cualquier documento más angosto que ~520 pt.
 *
 * Los valores conservan el layout de A4: con 595 pt de ancho (útil 515) dan
 * 0 / 221 / 417 pt, a un punto de los offsets absolutos anteriores.
 */
const LEGEND_COLUMN_FRACTIONS: Readonly<{
  readonly prefixes: number;
  readonly typeName: number;
  readonly countLabel: number;
}> = { prefixes: 0, typeName: 0.43, countLabel: 0.81 };
/** Aire entre el final de una celda y el principio de la siguiente columna. */
const LEGEND_COLUMN_GUTTER_PT = 12;
/** Alto de cada línea DENTRO de una celda con varias líneas. */
const LEGEND_LINE_HEIGHT_PT = 15;

/**
 * Corte greedy por palabras contra el ancho disponible de la celda, midiendo
 * con `measureText` (el mismo mecanismo con el que `paintReplacements` decide
 * si un token entra en su línea, ADR-058 §1).
 *
 * Una palabra más ancha que la celda entera se deja sola en su línea y se
 * desborda: partirla por caracteres haría ilegible un prefijo, que es
 * justamente lo que la leyenda tiene que poder leerse. No ocurre con los
 * datos reales — el prefijo más largo es `"ORGANIZACION,"`, muy por debajo de
 * los 208 pt de la primera columna.
 */
function wrapCellText(
  context: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidthPt: number,
): ReadonlyArray<string> {
  const words = text.split(" ").filter((word) => word.length > 0);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (current.length > 0 && context.measureText(candidate).width > maxWidthPt) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function paintLegendTable(
  context: OffscreenCanvasRenderingContext2D,
  rows: ReadonlyArray<MarkerLegendRow>,
  pageWidthPt: number,
  pageHeightPt: number,
): void {
  context.fillStyle = LEGEND_BACKGROUND_COLOR;
  context.fillRect(0, 0, pageWidthPt, pageHeightPt);

  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillStyle = LEGEND_TEXT_COLOR;

  const usableWidthPt = Math.max(0, pageWidthPt - LEGEND_MARGIN_PT * 2);

  // El título también se envuelve: son 48 caracteres a 16 px, así que en un
  // documento más angosto que ~520 pt se salía de la página por la derecha.
  context.font = LEGEND_TITLE_FONT;
  const titleLines = wrapCellText(context, LEGEND_TITLE_TEXT, usableWidthPt);
  let titleY = LEGEND_MARGIN_PT;
  for (const line of titleLines) {
    context.fillText(line, LEGEND_MARGIN_PT, titleY);
    titleY += LEGEND_TITLE_LINE_HEIGHT_PT;
  }

  context.font = LEGEND_ROW_FONT;

  // Ancho de cada celda: hasta donde empieza la columna siguiente, menos el
  // gutter. La última llega hasta el margen derecho de la página.
  const offsets = {
    prefixes: usableWidthPt * LEGEND_COLUMN_FRACTIONS.prefixes,
    typeName: usableWidthPt * LEGEND_COLUMN_FRACTIONS.typeName,
    countLabel: usableWidthPt * LEGEND_COLUMN_FRACTIONS.countLabel,
  };
  const columnWidths = {
    prefixes: offsets.typeName - offsets.prefixes,
    typeName: offsets.countLabel - offsets.typeName,
    countLabel: usableWidthPt - offsets.countLabel,
  };

  const bottomLimitPt = pageHeightPt - LEGEND_MARGIN_PT;
  // La tabla arranca bajo la ÚLTIMA línea del título, no bajo la primera.
  let y = titleY - LEGEND_TITLE_LINE_HEIGHT_PT + LEGEND_TITLE_TO_TABLE_GAP_PT;

  for (const row of rows) {
    const cells = [
      { text: row.prefixes, offset: offsets.prefixes, width: columnWidths.prefixes },
      { text: row.typeName, offset: offsets.typeName, width: columnWidths.typeName },
      {
        text: row.countLabel,
        offset: offsets.countLabel,
        width: columnWidths.countLabel,
        // Última columna: no se le descuenta gutter — no hay columna
        // siguiente con la que chocar, el margen derecho ya es el aire.
        isLast: true,
      },
    ].map((cell) => ({
      ...cell,
      lines: wrapCellText(
        context,
        cell.text,
        Math.max(0, cell.width - ("isLast" in cell ? 0 : LEGEND_COLUMN_GUTTER_PT)),
      ),
    }));

    const rowLines = Math.max(...cells.map((cell) => cell.lines.length));
    const rowHeightPt = Math.max(LEGEND_ROW_HEIGHT_PT, rowLines * LEGEND_LINE_HEIGHT_PT);

    // Sin paginación (ADR-059 §5): si la tabla no entra, se corta acá en vez
    // de dibujar fuera de la página. Con 13 tipos (cota de ADR-059 §2) y los
    // prefijos reales no se alcanza; queda como guarda, no como camino
    // esperado.
    if (y + rowHeightPt > bottomLimitPt) break;

    for (const cell of cells) {
      let lineY = y;
      for (const line of cell.lines) {
        context.fillText(line, LEGEND_MARGIN_PT + cell.offset, lineY);
        lineY += LEGEND_LINE_HEIGHT_PT;
      }
    }
    y += rowHeightPt;
  }
}

export interface KernelRenderLegendOptions {
  readonly jpegQuality: number;
  readonly onWarn?: KernelWarnLogger;
}

/**
 * `renderLegendPage` (ADR-059 §5): dibujo puro sobre un `OffscreenCanvas` en
 * blanco del tamaño pedido — sin `pageProxy`, sin pdfjs, y por eso sin
 * `AbortSignal`/timeout en sus opciones (a diferencia de
 * `kernelRenderPage`/`kernelRasterizePage`): no hay ningún await largo
 * comparable a `pageProxy.render()` que cancelar a mitad de camino, es una
 * operación de dibujo síncrona seguida de un único `convertToBlob`
 * (`encodeImageData`, ya usado por el resto del kernel).
 */
export async function kernelRenderLegendPage(
  payload: RenderLegendPayload,
  opts: KernelRenderLegendOptions,
): Promise<EncodedPageImage> {
  const { rows, pageWidthPt, pageHeightPt } = payload;
  // Default "png" (no está en el spec, que no expone `imageFormat` en la
  // firma pública §6): es texto sobre fondo blanco, sin degradado ni foto —
  // el caso exacto para el que PNG sin pérdida es la elección barata, mismo
  // criterio que el default de "preview" en `kernelRenderPage`.
  const imageFormat = payload.imageFormat ?? "png";

  const canvas = createCanvas(
    LEGEND_DOCUMENT_LABEL,
    LEGEND_PAGE_LABEL,
    pageWidthPt,
    pageHeightPt,
    opts.onWarn,
  );
  const context = get2dContext(canvas, LEGEND_DOCUMENT_LABEL, LEGEND_PAGE_LABEL);

  paintLegendTable(context, rows, pageWidthPt, pageHeightPt);

  const imageData = context.getImageData(0, 0, pageWidthPt, pageHeightPt);
  return encodeImageData(
    imageData,
    imageFormat,
    opts.jpegQuality,
    LEGEND_DOCUMENT_LABEL,
    LEGEND_PAGE_LABEL,
    opts.onWarn,
  );
}

/**
 * Libera todos los `PDFDocumentProxy` cargados por este kernel. Invocado
 * DIRECTO (sin pasar por `RenderPool.dispatch`, ver `render.engine.ts#dispose`)
 * porque `dispose()` no es una de las 4 operaciones del puerto (ADR-043 §2) —
 * es un efecto local de teardown; para el modo worker real, la liberación
 * server-side llega por el mensaje genérico `DISPOSE` del protocolo
 * (`05_Worker_Architecture.md` §7.4), manejado en `worker/entry.ts`.
 */
export function kernelDisposeAll(): void {
  for (const doc of documents.values()) void doc.destroy();
  documents.clear();
}
