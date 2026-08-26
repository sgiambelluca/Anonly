/**
 * `OcrKernel` — el kernel sin estado por documento que ADR-045 §1/§3 asigna
 * al OcrWorker (espejo de `render-engine/src/worker/kernel.ts`, ADR-043).
 * Contiene TODO lo que toca `tesseract.js`: setup first-party (ADR-018),
 * reconocimiento con timeout/abort racing, extracción defensiva de
 * palabras/confidence, conversión `ImageData` → `OffscreenCanvas`.
 *
 * Este archivo lo importan DOS consumidores (mismo código, dos fronteras):
 * - `ocr.engine.ts` (host, in-process fallback): lo invoca directo desde el
 *   `run()` que pasa a `OcrJobPool.dispatch` cuando no hay `workerFactory`
 *   real configurada (ADR-035, fallback bit-idéntico).
 * - `worker/entry.ts` (worker real): lo invoca detrás de la mensajería
 *   `postMessage` cuando SÍ hay un Worker de SO real.
 *
 * La clase `OcrEngine` (loop por página, retry/timeout, depósito en
 * `ctx.cache`, emisión de eventos) NUNCA importa `tesseract.js` fuera de este
 * archivo — es la única frontera del paquete que lo hace.
 *
 * Estado: instancia de tesseract + set de idiomas cargado, a nivel de
 * módulo. Para el worker real, es "lo que ese worker tiene cargado"; para el
 * fallback in-process, es "el único kernel virtual" (coherente con que en
 * ese modo no hay paralelismo real de todos modos).
 *
 * Idiomas (ADR-045 §3): `ensureWorkerLoaded` recibe el set de idiomas que
 * `OcrEngine` decidió (la config efectiva, con fallback a default — nunca
 * `payload.languages` crudo, que es una restricción de la página, no la
 * fuente de lo que hay que cargar). Si ese set difiere del cargado, recrea la
 * instancia — cubre `reanalyze` con `ocr.languages` (ADR-038 §5.3) sin
 * mensaje de control nuevo.
 */
import { CancelledError, type BoundingBox, type OcrPagePayload, type Word } from "@anonly/shared";
import { createWorker } from "tesseract.js";

import { OcrModelMissingError, OcrPageFailedError, OcrTimeoutError } from "../ocr.errors.js";

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

/*
 * ADR-018: assets de Tesseract servidos first-party, nunca desde CDNs de
 * terceros (jsDelivr/GitHub) en runtime. langPath = datos de idioma
 * entrenados (spa.traineddata/eng.traineddata, ~30MB); corePath/workerPath =
 * wasm + script del worker interno de tesseract.js.
 *
 * `langPath`/`corePath` SON directorios a propósito (tesseract.js resuelve
 * dentro de ellos: `<lang>.traineddata` y la variante de core SIMD/no-SIMD
 * respectivamente). `workerPath`, en cambio, tiene que ser la ruta al
 * ARCHIVO real: tesseract.js hace `importScripts(workerPath)` tal cual, sin
 * agregarle nombre de archivo — apuntar a un directorio falla en silencio
 * (errata corregida en ADR-018 §2 / OCR_Engine.md v1.2.1 §15.22, PR 17.6
 * parte a).
 */
const TESSERACT_LANG_PATH = "/models/tesseract/";
const TESSERACT_CORE_PATH = "/wasm/tesseract/";
const TESSERACT_WORKER_PATH = "/wasm/tesseract/worker.min.js";

/*
 * ADR-018 §2 (precisión 2026-07-30) / OCR_Engine.md v1.2.2, §15.22 parte b:
 * las tres rutas de arriba son root-relative ("/wasm/…"), y ese formato solo
 * resuelve bien cuando tesseract.js las absolutiza contra `window.location`
 * por su cuenta — cosa que SOLO hace si detecta el entorno `'browser'`
 * (`typeof document === 'object'`). Este kernel corre, en producción, DENTRO
 * de un Worker real (OcrWorker, ADR-045 §3, wireado sin condición desde
 * PR14): ahí `WorkerGlobalScope` existe, tesseract.js detecta el entorno
 * `'webworker'` y NO absolutiza nada. Encima, con `workerBlobURL: true`
 * (default de tesseract.js) el worker interno que crea para `workerPath`
 * corre con `self.location` = una URL `blob:<origen>/<uuid>` — y un path
 * root-relative NO resuelve contra una base `blob:`
 * (`new URL("/foo", "blob:http://origen/uuid")` lanza `Invalid URL`,
 * verificado en browser real). Por eso el fix de más arriba (archivo, no
 * directorio) alcanza para el fallback in-process (`window`/`document`
 * existen ahí, tesseract.js sí absolutiza) pero NO para el camino real de
 * producción.
 *
 * Fix: absolutizar acá, nosotros, las tres rutas contra `self.location.origin`
 * ANTES de pasarlas a `createWorker` — sigue siendo first-party (mismo
 * origen, ADR-018; lo único que cambia es la FORMA de la URL, no el
 * destino). El **único** caso en que esta función es no-op es el entorno Node
 * de los tests (`environment: "node"` de vitest, sin `self` global salvo que
 * un test lo stubee explícitamente para `worker/entry.ts` — ver
 * `__tests__/worker-entry.test.ts`), donde el path root-relative se devuelve
 * tal cual y sigue siendo válido. En el browser absolutiza **siempre**,
 * también en el fallback in-process fuera de un Worker (`ocr.engine.ts` sin
 * pool real): ahí `self === window`, que sí tiene `location`.
 *
 * Palanca de reserva, NO usada acá (documentada para no reintentarla a
 * ciegas si aparece un problema nuevo): `createWorker(..., { workerBlobURL:
 * false })` elimina el wrapper `blob:` por completo (tesseract.js hace
 * `new Worker(workerPath)` directo, `spawnWorker.js` líneas 17-19) — pero
 * cambiar ESE mecanismo es una superficie más grande que absolutizar la URL,
 * y no está confirmado que haga falta. Si tras este fix apareciera todavía
 * una resolución interna root-relative de tesseract (candidato:
 * `worker-script/browser/getCore.js`, que hace su propio
 * `global.importScripts(corePathImportFile)` una vez que `workerPath` ya
 * cargó, con el `self.location` heredado del worker que `importScripts`
 * dejó — no verificado, la ejecución hoy no llega tan lejos), ahí sí
 * correspondería agregar `workerBlobURL: false` con su propio comentario
 * justificativo.
 */
function resolveTesseractPath(path: string): string {
  if (typeof self === "undefined") return path;
  const origin = self.location?.origin;
  if (origin === undefined) return path;
  return new URL(path, origin).href;
}

/** ADR-090 §1: el modelo de orientación, cargado siempre junto a los idiomas. */
const OSD_LANGUAGE = "osd";

/*
 * ADR-090 §3: piso de `orientation_confidence` para hacerle caso a OSD. La
 * escala de Tesseract no es 0-100 y no tiene un máximo definido; medido sobre
 * una A4 a 300 DPI con texto denso da 17,1 (derecha) y 17,6 (rotada 90°), un
 * orden de magnitud sobre este piso. Debajo del piso —o si `detect` falla, o
 * devuelve `null`— no se rota nada y el camino es el de antes del ADR.
 */
const MIN_ORIENTATION_CONFIDENCE = 1;

/** Instancia de tesseract cargada, y el set de idiomas con el que se cargó. */
let worker: TesseractWorker | null = null;
let loadedLanguages: ReadonlySet<string> = new Set();
/** ADR-090 §2: último `user_defined_dpi` aplicado a la instancia vigente. */
let appliedDpi: number | null = null;

function languagesMatch(loaded: ReadonlySet<string>, requested: ReadonlyArray<string>): boolean {
  if (loaded.size !== requested.length) return false;
  return requested.every((lang) => loaded.has(lang));
}

/**
 * Garantiza que el worker de tesseract esté cargado con exactamente
 * `languages`. Si ya está cargado con ese mismo set, no-op. Si está cargado
 * con un set distinto, destruye la instancia vigente (best-effort) y crea
 * una nueva (ADR-045 §3).
 */
async function ensureWorkerLoaded(languages: ReadonlyArray<string>): Promise<void> {
  if (worker !== null && languagesMatch(loadedLanguages, languages)) return;

  if (worker !== null) {
    const previous = worker;
    worker = null;
    try {
      await previous.terminate();
    } catch {
      // best-effort: seguir cargando la instancia nueva igual.
    }
  }

  let nextWorker: TesseractWorker;
  try {
    // ADR-090 §1: `osd` va junto a los idiomas de la config y el core es el
    // COMPLETO (`legacyCore: true`). `worker.detect()` está guardado por
    // `if (lstmOnlyCore) throw` en tesseract.js: OSD es un modelo legacy, así
    // que agregar `osd.traineddata` sin cambiar el core no alcanza. El
    // reconocimiento sigue siendo LSTM; el core completo solo trae además el
    // código legacy que OSD necesita.
    nextWorker = await createWorker([...languages, OSD_LANGUAGE], undefined, {
      langPath: resolveTesseractPath(TESSERACT_LANG_PATH),
      corePath: resolveTesseractPath(TESSERACT_CORE_PATH),
      workerPath: resolveTesseractPath(TESSERACT_WORKER_PATH),
      legacyCore: true,
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new OcrModelMissingError(languages, reason);
  }

  worker = nextWorker;
  // `osd` NO entra acá: `loadedLanguages` es el set que pidió la config, y es
  // contra ese set que se decide si hay que recrear el worker (ADR-090 §1).
  loadedLanguages = new Set(languages);
  appliedDpi = null;
}

/*
 * tesseract.js no acepta `ImageData` directamente: su `ImageLike` real
 * (node_modules/tesseract.js/src/index.d.ts) es
 * `string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement |
 * CanvasRenderingContext2D | File | Blob | Buffer | OffscreenCanvas` — sin
 * `ImageData`. `OcrPageInput.imageData: ImageData` es el contrato fijo de
 * OCR_Engine.md §6/§9 (no se puede romper, R-2), así que la conversión vive
 * acá, en la frontera con tesseract.js.
 */
function toTesseractImage(
  imageData: ImageData,
  documentId: string,
  pageIndex: number,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new OcrPageFailedError(
      documentId,
      pageIndex,
      "No se pudo obtener un contexto 2D de OffscreenCanvas para convertir imageData.",
    );
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/*
 * ADR-090 §2: el raster se arma a `dpi` (el Orchestrator usa `scale = dpi/72`),
 * así que la resolución se sabe y hasta ahora no se le decía a Tesseract, que
 * la estimaba de la imagen. Se aplica cuando cambia respecto de la instancia
 * vigente: el worker vive entre páginas y el dpi viaja por payload.
 * Best-effort — un `setParameters` que rechaza no debe voltear la página.
 */
async function ensureDpiApplied(dpi: number): Promise<void> {
  if (worker === null || appliedDpi === dpi) return;
  try {
    await worker.setParameters({ user_defined_dpi: String(dpi) });
    appliedDpi = dpi;
  } catch {
    // best-effort: seguir reconociendo con la estimación de Tesseract.
  }
}

// ─── Orientación del escaneo (ADR-090 §3/§4) ───────────────────────────────

/**
 * Rotación **horaria** que hay que aplicarle al raster para enderezarlo — la
 * misma convención con la que `worker.detect()` reporta
 * `orientation_degrees`, y el mismo valor que después va a `bbox.rotation`
 * (ADR-090 §4: la correspondencia es la identidad).
 */
export type Rotation = 0 | 90 | 180 | 270;

function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/*
 * Rota `source` en HORARIO por `degrees`, por aritmética de píxeles: no hace
 * falta un canvas, y así la función es pura y testeable en el entorno `node`
 * de Vitest (`ImageData` es una interfaz estructural, ver
 * `__tests__/fixtures/test-helpers.ts`). En 90/270 las dimensiones se
 * intercambian.
 *
 * El destino se recorre en orden y la fuente se lee salteada — no al revés —
 * para escribir secuencialmente sobre el array de salida, que es el que se
 * aloca de cero.
 */
export function rotateImageData(source: ImageData, degrees: Rotation): ImageData {
  if (degrees === 0) return source;

  const { width: w, height: h, data } = source;
  const swap = degrees === 90 || degrees === 270;
  const outWidth = swap ? h : w;
  const outHeight = swap ? w : h;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      // Inversa de la rotación horaria: dónde estaba en el original el píxel
      // que ahora va en (x, y).
      let sx: number;
      let sy: number;
      if (degrees === 90) {
        sx = y;
        sy = h - 1 - x;
      } else if (degrees === 180) {
        sx = w - 1 - x;
        sy = h - 1 - y;
      } else {
        sx = w - 1 - y;
        sy = x;
      }
      const from = (sy * w + sx) * 4;
      const to = (y * outWidth + x) * 4;
      out[to] = data[from] ?? 0;
      out[to + 1] = data[from + 1] ?? 0;
      out[to + 2] = data[from + 2] ?? 0;
      out[to + 3] = data[from + 3] ?? 0;
    }
  }

  return { data: out, width: outWidth, height: outHeight, colorSpace: source.colorSpace };
}

/*
 * Lleva una caja del espacio ENDEREZADO (donde reconoció Tesseract) de vuelta
 * al espacio del raster ORIGINAL. `sourceWidth`/`sourceHeight` son los del
 * raster original; `degrees` es la rotación horaria que se le aplicó.
 * Es la inversa exacta de `rotateImageData`, con el ancho y el alto de la caja
 * intercambiados en 90/270.
 */
export function unrotateBbox(
  bbox: BoundingBox,
  degrees: Rotation,
  sourceWidth: number,
  sourceHeight: number,
): BoundingBox {
  if (degrees === 0) return bbox;
  if (degrees === 90) {
    return {
      x: bbox.y,
      y: sourceHeight - (bbox.x + bbox.width),
      width: bbox.height,
      height: bbox.width,
    };
  }
  if (degrees === 180) {
    return {
      x: sourceWidth - (bbox.x + bbox.width),
      y: sourceHeight - (bbox.y + bbox.height),
      width: bbox.width,
      height: bbox.height,
    };
  }
  return {
    x: sourceWidth - (bbox.y + bbox.height),
    y: bbox.x,
    width: bbox.height,
    height: bbox.width,
  };
}

interface DetectOrientationResult {
  readonly orientation_degrees?: number | null;
  readonly orientation_confidence?: number | null;
}

function readOrientation(data: unknown): Rotation {
  if (typeof data !== "object" || data === null) return 0;
  const { orientation_degrees: degrees, orientation_confidence: confidence } =
    data as DetectOrientationResult;
  if (typeof confidence !== "number" || confidence < MIN_ORIENTATION_CONFIDENCE) return 0;
  return isRotation(degrees) ? degrees : 0;
}

/*
 * ADR-090 §3, paso 1-2. Cualquier falla de `detect` —que el modelo `osd` no
 * esté, que `DetectOS` no concluya, que la página tenga muy poco texto— cae a
 * `0`, que es exactamente el comportamiento previo al ADR. El kernel no tiene
 * logger (ADR-045 §2), así que la degradación es silenciosa por construcción.
 */
async function detectOrientation(image: OffscreenCanvas): Promise<Rotation> {
  if (worker === null) return 0;
  try {
    const { data } = await worker.detect(image);
    return readOrientation(data);
  } catch {
    return 0;
  }
}

/*
 * Copia local del criterio de orden de lectura (OCR_Engine.md §10: "ordenadas
 * por bbox.y asc, luego bbox.x asc"), con tolerancia de 1px para "misma
 * línea" (dos palabras de Tesseract en la misma línea impresa casi nunca
 * comparten el mismo y0 en píxeles exactos).
 */
function sortWordsByReadingOrder(words: ReadonlyArray<Word>): Word[] {
  const sorted = [...words];
  sorted.sort((a, b) => {
    const dy = a.bbox.y - b.bbox.y;
    if (Math.abs(dy) > 1) return dy;
    return a.bbox.x - b.bbox.x;
  });
  return sorted;
}

// ─── Extracción defensiva del resultado de tesseract.js ───
//
// tesseract.js no tiene un tipo propio publicado en Contracts.md (regla §10:
// "ningún tipo puede referenciar tipos de librerías externas"; wrappers
// propios). En vez de castear el resultado real de recognize() contra un tipo
// local asumido, se usan guards de runtime sobre `unknown`.

interface ExtractedWord {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is ReadonlyArray<unknown> {
  return Array.isArray(value);
}

function toBboxIfValid(value: unknown): ExtractedWord["bbox"] | null {
  if (!isRecord(value)) return null;
  const { x0, y0, x1, y1 } = value;
  if (
    typeof x0 !== "number" ||
    typeof y0 !== "number" ||
    typeof x1 !== "number" ||
    typeof y1 !== "number"
  ) {
    return null;
  }
  return { x0, y0, x1, y1 };
}

function toWordIfValid(value: unknown): ExtractedWord | null {
  if (!isRecord(value)) return null;
  const { text, confidence, bbox } = value;
  const parsedBbox = toBboxIfValid(bbox);
  if (typeof text !== "string" || typeof confidence !== "number" || parsedBbox === null) {
    return null;
  }
  return { text, confidence, bbox: parsedBbox };
}

function extractTesseractWords(data: unknown): ReadonlyArray<ExtractedWord> {
  const words: ExtractedWord[] = [];
  if (!isRecord(data) || !isUnknownArray(data.blocks)) return words;

  for (const block of data.blocks) {
    if (!isRecord(block) || !isUnknownArray(block.paragraphs)) continue;
    for (const paragraph of block.paragraphs) {
      if (!isRecord(paragraph) || !isUnknownArray(paragraph.lines)) continue;
      for (const line of paragraph.lines) {
        if (!isRecord(line) || !isUnknownArray(line.words)) continue;
        for (const wordValue of line.words) {
          const word = toWordIfValid(wordValue);
          if (word !== null) words.push(word);
        }
      }
    }
  }
  return words;
}

function extractPageConfidence(data: unknown): number {
  if (isRecord(data) && typeof data.confidence === "number") {
    return data.confidence;
  }
  return 0;
}

const POINTS_PER_INCH = 72;

/*
 * ADR-064 §1: Tesseract devuelve píxeles de la imagen recibida, y esa imagen
 * viene rasterizada a `dpi` (el Orchestrator usa scale = dpi/72). El contrato
 * de 03_Data_Model.md §137 exige puntos de página. Escalado puro, sin
 * corrimiento de origen: el raster sale de getViewport({ scale }), que ya usa
 * esquina superior-izquierda con y hacia abajo — la misma convención.
 */
function toPagePoints(bbox: BoundingBox, dpi: number): BoundingBox {
  const factor = POINTS_PER_INCH / dpi;
  return {
    x: bbox.x * factor,
    y: bbox.y * factor,
    width: bbox.width * factor,
    height: bbox.height * factor,
  };
}

/*
 * ADR-064 §2: el orden se calcula en PÍXELES y la conversión va después. Si se
 * convirtiera antes, la tolerancia de 1px de sortWordsByReadingOrder pasaría a
 * valer 1 punto (≈ 4,17 px a 300 DPI) y el agrupado por línea cambiaría de
 * comportamiento como efecto colateral de un cambio de unidades. El map
 * preserva el orden, así que el array queda idéntico al de antes del ADR.
 */
function toWords(
  data: unknown,
  pageIndex: number,
  dpi: number,
  orientation: Rotation,
  sourceWidth: number,
  sourceHeight: number,
): Word[] {
  const tesseractWords = extractTesseractWords(data);
  const words: Word[] = tesseractWords.map((w) => ({
    text: w.text.normalize("NFC"),
    bbox: {
      x: w.bbox.x0,
      y: w.bbox.y0,
      width: w.bbox.x1 - w.bbox.x0,
      height: w.bbox.y1 - w.bbox.y0,
    },
    pageIndex,
    confidence: clampConfidence(w.confidence / 100),
    source: "ocr" as const,
  }));

  /*
   * ADR-090 §3: el orden se calcula sobre el espacio ENDEREZADO, que es el
   * único donde "arriba-abajo, izquierda-derecha" significa el sentido de
   * lectura; recién después las cajas vuelven al espacio del raster original
   * y se convierten a puntos. Con `orientation === 0` las dos operaciones son
   * la identidad y el resultado es idéntico al previo al ADR.
   */
  return sortWordsByReadingOrder(words).map((w) => {
    const bbox = toPagePoints(unrotateBbox(w.bbox, orientation, sourceWidth, sourceHeight), dpi);
    // ADR-090 §4: `orientation_degrees` y `bbox.rotation` coinciden. Ausente
    // ≡ 0 (`Contracts.md` §5), así que un escaneo derecho no gana el campo.
    return { ...w, bbox: orientation === 0 ? bbox : { ...bbox, rotation: orientation } };
  });
}

async function recognizeWithTimeout(
  image: OffscreenCanvas,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
  abortSignal: AbortSignal,
): Promise<unknown> {
  if (worker === null) {
    throw new OcrModelMissingError([], "El worker de Tesseract no está inicializado.");
  }
  const activeWorker = worker;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new OcrTimeoutError(documentId, pageIndex, timeoutMs));
    }, timeoutMs);
  });

  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (abortSignal.aborted) {
      reject(new CancelledError(documentId));
      return;
    }
    onAbort = (): void => reject(new CancelledError(documentId));
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    // El callback de progreso de Tesseract es el checkpoint de cancelación
    // documentado (OCR_Engine.md §12); tesseract.js no expone una API pública
    // de cancelación por-job, así que el mecanismo real de "dejar de esperar"
    // es este Promise.race contra el AbortSignal — la computación WASM en
    // curso no se interrumpe, el caller simplemente deja de esperarla.
    const result = await Promise.race([
      activeWorker.recognize(image, {}, { blocks: true }),
      timeoutPromise,
      abortPromise,
    ]);
    return result.data;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (onAbort !== undefined) abortSignal.removeEventListener("abort", onAbort);
  }
}

export interface KernelRecognizeOptions {
  readonly timeoutMs: number;
  readonly abortSignal: AbortSignal;
}

export interface KernelOcrResult {
  readonly words: ReadonlyArray<Word>;
  readonly confidence: number;
}

/**
 * Reconocimiento de una página (ADR-045 §2/§3): garantiza el idioma cargado
 * (recreando si `payload.languages` difiere del set vigente) y reconoce con
 * timeout/abort racing. `payload.languages` es la config efectiva que
 * `OcrEngine` decidió (no una restricción per-request adicional — esa
 * validación vive host-side, `OcrEngine#assertLanguagesRequestable`).
 */
export async function kernelRecognize(
  payload: OcrPagePayload,
  opts: KernelRecognizeOptions,
): Promise<KernelOcrResult> {
  const { documentId, pageIndex, imageData, languages, dpi } = payload;

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  await ensureWorkerLoaded(languages);
  await ensureDpiApplied(dpi);

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  // ADR-090 §3: detectar antes de reconocer. Con orientación 0 —el 99 % de las
  // páginas, y también cualquier falla de `detect`— `rotateImageData` devuelve
  // el mismo objeto y de acá para abajo el camino es el previo al ADR.
  const orientation = await detectOrientation(toTesseractImage(imageData, documentId, pageIndex));

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  const upright = rotateImageData(imageData, orientation);
  const data = await recognizeWithTimeout(
    toTesseractImage(upright, documentId, pageIndex),
    documentId,
    pageIndex,
    opts.timeoutMs,
    opts.abortSignal,
  );
  const words = toWords(data, pageIndex, dpi, orientation, imageData.width, imageData.height);
  const confidence = clampConfidence(extractPageConfidence(data) / 100);
  return { words, confidence };
}

/**
 * Libera la instancia de tesseract cargada por este kernel. Invocado DIRECTO
 * (sin pasar por `OcrJobPool.dispatch`, ver `ocr.engine.ts#dispose`) porque
 * `dispose()` no es la operación del puerto (ADR-045 §2, mismo criterio que
 * `kernelDisposeAll` de render-engine, ADR-043 §2); para el modo worker real,
 * la liberación server-side llega por el mensaje genérico `DISPOSE` del
 * protocolo, manejado en `worker/entry.ts`. Resiliente a que `terminate()`
 * rechace (best-effort, mismo criterio que `ocr.engine.ts` mantenía).
 */
export async function kernelDispose(): Promise<void> {
  if (worker !== null) {
    const current = worker;
    worker = null;
    try {
      await current.terminate();
    } catch {
      // best-effort: liberar igual el estado interno aunque terminate() falle.
    }
  }
  loadedLanguages = new Set();
  appliedDpi = null;
}
