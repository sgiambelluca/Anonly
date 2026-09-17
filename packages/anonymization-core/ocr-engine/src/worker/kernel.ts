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
import {
  CancelledError,
  InvalidInputError,
  type BoundingBox,
  type EncodedPageImage,
  type OcrPagePayload,
  type Word,
} from "@anonly/shared";
import { createWorker, PSM } from "tesseract.js";

import { OcrModelMissingError, OcrPageFailedError, OcrTimeoutError } from "../ocr.errors.js";

import {
  resolveTesseractPath,
  TESSERACT_CORE_PATH,
  TESSERACT_LANG_PATH,
  TESSERACT_WORKER_PATH,
} from "./tesseract-paths.js";

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
// Las rutas y su resolución viven en `tesseract-paths.ts`, compartidas con OSD.

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
// La orientación se detecta en `orientation-kernel.ts`, una instancia por Core.

/*
 * ADR-112 §1: modo de segmentación de página, fijo.
 *
 * Con el default (`AUTO`) el análisis de layout de Tesseract **fusiona en una
 * sola caja de línea** dos renglones impresos muy juntos, y devuelve basura
 * para la mitad izquierda de la fusión. Sobre el sello del encabezado de un
 * fallo escaneado —`IPP …` justo encima de `APELLIDO, NOMBRE S/ RECURSO DE`—
 * eso hace que el apellido del imputado se lea `casino,`, `cuerno,`, `sro,`
 * según la página, y un valor mal leído no lo detecta nadie: el dato queda a
 * la vista sin dejar rastro. Es también la explicación de las cajas con 60 %
 * de diferencia de alto que ADR-110 §5 reportó sin explicar — son cajas de
 * dos renglones.
 *
 * `SPARSE_TEXT` no asume estructura de párrafo y encuentra cada renglón por
 * su cuenta. Medido sobre 19 páginas contra la transcripción a mano del
 * sello: 57/114 ítems → 109/114, y el apellido pasa de detectarse en 9 de 19
 * páginas a 19 de 19. Sobre 7 documentos nativos rasterizados (35 páginas,
 * 11.403 palabras) el recall queda igual (96,29 % → 96,26 %) y la precisión
 * **sube** (96,02 % → 96,50 %): el modo disperso inventa menos, no más.
 *
 * No es un campo de `OcrConfig` a propósito: no es una preferencia del
 * usuario, es el modo correcto para la familia de documento del producto.
 */
const PAGE_SEG_MODE = PSM.SPARSE_TEXT;

/*
 * ADR-119 §2: la detección de orientación corre sobre el raster a MEDIA
 * escala. No es una optimización oportunista — es lo que hace que arreglar
 * OSD no cueste tiempo: 290 ms por página contra los 690 a escala completa, y
 * contra los 506 que hoy se pagan por una detección que no funciona.
 *
 * El barrido dice también por qué no bajar más. A 0,35 sigue acertando pero la
 * confianza cae a 1-2, pegada al piso; a 0,25 **acierta cero veces y sigue
 * devolviendo 1-2**, o sea por encima del piso. El modo de falla de un OSD mal
 * alimentado no es "no contesta", es "contesta mal con confianza suficiente",
 * y contra eso el piso no protege: protege el margen.
 */
/** Instancia de tesseract cargada, y el set de idiomas con el que se cargó. */
let worker: TesseractWorker | null = null;
let loadedLanguages: ReadonlySet<string> = new Set();
/** ADR-090 §2: último `user_defined_dpi` aplicado a la instancia vigente. */
let appliedDpi: number | null = null;
/** ADR-112 §1: si la instancia vigente ya tiene aplicado `PAGE_SEG_MODE`. */
let pageSegModeApplied = false;

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
    /*
     * ADR-119 §1: este worker es SOLO de reconocimiento. Ya no carga `osd` ni
     * pide `legacyCore`.
     *
     * ADR-090 §1 los ponía acá razonando que `worker.detect()` está guardado
     * por `if (lstmOnlyCore) throw` en tesseract.js y que por lo tanto hacía
     * falta el core completo. La premisa es cierta y la conclusión no
     * alcanzaba: con el core legacy la llamada deja de tirar, pero devuelve
     * `orientation_degrees: 0, orientation_confidence: 0` **siempre** —
     * medido sobre dos documentos y cuatro orientaciones cada uno—, y el piso
     * de confianza lo descarta. Para que conteste hace falta que el OEM sea
     * legacy, y eso es incompatible con reconocer: ver `ensureOsdWorkerLoaded`.
     */
    nextWorker = await createWorker([...languages], undefined, {
      langPath: resolveTesseractPath(TESSERACT_LANG_PATH),
      corePath: resolveTesseractPath(TESSERACT_CORE_PATH),
      workerPath: resolveTesseractPath(TESSERACT_WORKER_PATH),
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new OcrModelMissingError(languages, reason);
  }

  worker = nextWorker;
  loadedLanguages = new Set(languages);
  appliedDpi = null;
  // ADR-112 §1: la instancia es nueva, así que el modo hay que volver a
  // aplicarlo — mismo criterio que `appliedDpi`.
  pageSegModeApplied = false;
}

/*
 * ADR-112 §1: aplica el modo de segmentación una vez por instancia de worker.
 * A diferencia del DPI, el valor no viaja por payload —es una constante— así
 * que la condición es "esta instancia ya lo tiene", no "cambió".
 *
 * Best-effort, mismo criterio que `ensureDpiApplied`: un `setParameters` que
 * rechaza no debe voltear la página. Sin el modo aplicado se reconoce con el
 * default de Tesseract, que es exactamente el comportamiento previo al ADR.
 */
async function ensurePageSegModeApplied(): Promise<void> {
  if (worker === null || pageSegModeApplied) return;
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PAGE_SEG_MODE });
    pageSegModeApplied = true;
  } catch {
    // best-effort: seguir reconociendo con el modo default.
  }
}

/*
 * tesseract.js no acepta `ImageData` directamente: su `ImageLike` real
 * (node_modules/tesseract.js/src/index.d.ts) es
 * `string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement |
 * CanvasRenderingContext2D | File | Blob | Buffer | OffscreenCanvas` — sin
 * `ImageData`. El reconocimiento principal, el enderezado de ADR-120 y las
 * franjas de margen de ADR-121 operan todos sobre `ImageData` (rotar/recortar
 * son operaciones de píxeles), así que la conversión de vuelta a un
 * `OffscreenCanvas` que tesseract.js sí acepta vive acá, en cada pasada.
 */
function toTesseractImage(
  imageData: ImageData,
  documentId: string,
  pageIndex: number,
): OffscreenCanvas {
  /*
   * `Duplicacion_De_Logica.md` §6: `render-engine` protege sus dos
   * construcciones de `OffscreenCanvas` (`createCanvas`, y la factory que le
   * pasa a pdf.js) y acá se construía directo. Mismo patrón, protección en un
   * solo motor.
   *
   * Sin la guarda, un entorno sin `OffscreenCanvas` tira un `ReferenceError`
   * crudo desde el constructor: no es `OcrPageFailedError`, así que no llega
   * como `OCR_PAGE_FAILED` y la página se pierde sin el aviso de análisis
   * incompleto que ADR-094 existe para dar. Con ella, falla como falla
   * cualquier otra página de este motor.
   */
  if (typeof OffscreenCanvas === "undefined") {
    throw new OcrPageFailedError(
      documentId,
      pageIndex,
      "OffscreenCanvas no disponible en este entorno.",
    );
  }
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

/*
 * ADR-158 §2/§3: `OcrPagePayload.image` llega CODIFICADA (PNG) — la decodifica
 * UNA sola vez, con `createImageBitmap`, al principio de `kernelRecognize`.
 * De acá para abajo el camino es idéntico al previo al ADR: el `ImageData`
 * resultante alimenta el reconocimiento principal, el enderezado de ADR-120 y
 * las franjas de margen de ADR-121 exactamente igual que cuando llegaba cruda
 * por transporte — la salvedad declarada en el ADR es justamente esa: el
 * worker sigue materializando una página entera de píxeles, lo que
 * desaparece es la copia que cruzaba el `postMessage` y la que retenía el
 * host.
 */
async function decodeEncodedImage(
  image: EncodedPageImage,
  documentId: string,
  pageIndex: number,
): Promise<ImageData> {
  if (typeof OffscreenCanvas === "undefined") {
    throw new OcrPageFailedError(
      documentId,
      pageIndex,
      "OffscreenCanvas no disponible en este entorno.",
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([image.bytes], { type: `image/${image.format}` }));
  } catch (err: unknown) {
    throw new OcrPageFailedError(
      documentId,
      pageIndex,
      `No se pudo decodificar la imagen de la página ${pageIndex} (${image.format}): ` +
        `${err instanceof Error ? err.message : String(err)}.`,
    );
  }

  // `image.widthPx`/`heightPx` (no `bitmap.width`/`height`): son las
  // dimensiones AUTORITATIVAS que ya declaraba el productor (Render), las
  // mismas que `maxLiveImageBytes`/`estimatedBytes` usaron para presupuestar
  // (ADR-158 §4) — no hace falta releerlas del bitmap decodificado.
  const canvas = new OffscreenCanvas(image.widthPx, image.heightPx);
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    throw new OcrPageFailedError(
      documentId,
      pageIndex,
      "No se pudo obtener un contexto 2D de OffscreenCanvas para decodificar la imagen.",
    );
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, image.widthPx, image.heightPx);
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

/** Conserva la forma estructural de los tests Node y crea un ImageData nativo
 * en browser, que es necesario para `OffscreenCanvas.putImageData`. */
function createImageDataResult(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  colorSpace: PredefinedColorSpace,
): ImageData {
  const stableData = new Uint8ClampedArray(data.length);
  stableData.set(data);
  if (typeof ImageData !== "undefined") return new ImageData(stableData, width, height);
  return { data: stableData, width, height, colorSpace };
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

  return createImageDataResult(out, outWidth, outHeight, source.colorSpace);
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

/**
 * ADR-119 §1: worker dedicado a la detección de orientación.
 *
 * `oem: 0` (legacy) es el punto entero de que exista aparte. Con el OEM por
 * default —LSTM— `detect()` no tira pero devuelve `0 / 0` siempre; con legacy
 * contesta las cuatro orientaciones con confianza 13-16. Y el OEM legacy no se
 * puede usar en el worker de reconocimiento porque `tessdata_best` no trae
 * componentes legacy para `spa`/`eng`.
 *
 * A diferencia del resto de las fallas de este camino, **no crear el worker no
 * degrada a `0`** (ADR-119 §3): que la detección no esté disponible no es lo
 * mismo que "todas las páginas están derechas", y esa confusión es
 * exactamente la que dejó a ADR-090 sin funcionar sin que nadie se enterara.
 */
/*
 * ADR-160 §2: la imagen de OSD se decodifica YA reducida, en un solo paso
 * (`createImageBitmap(blob, { resizeWidth, resizeHeight })`) — la página
 * completa no se materializa en ningún momento de este camino, a diferencia
 * de `scaleForOsd` (retirada), que primero necesitaba un canvas de página
 * entera para achicarlo después.
 *
 * Falla de decodificación (`createImageBitmap` ausente o que rechaza, o sin
 * contexto 2D): `OcrPageFailedError` — caso 22 de §13, mismo tratamiento que
 * el resto de los fallos de página de este motor. A diferencia de que
 * `detect()` no concluya (degradación silenciosa, más abajo), acá no hay
 * imagen que ofrecerle a OSD: no es "no sé la orientación", es "no puedo
 * prepararle nada".
 */
/*
 * ADR-090 §3, paso 1-2. Una falla de `detect` —que `DetectOS` no concluya, que
 * la página tenga muy poco texto— cae a `0`, que es exactamente el
 * comportamiento previo al ADR. El kernel no tiene logger (ADR-045 §2), así
 * que la degradación es silenciosa por construcción.
 *
 * ADR-119 §3 le pone un límite a esa degradación: **no** cubre que el worker
 * de OSD no se pueda crear. Eso sale por `ensureOsdWorkerLoaded` como
 * `OcrModelMissingError`. ADR-160 agrega el mismo límite para la imagen
 * misma: `buildOsdImage` corre AFUERA del try — una falla de decodificación
 * no es lo mismo que una falla de `detect()`.
 */
/*
 * Orden **interno** de este motor, y no el que ve el detector (OCR_Engine.md
 * §10, ADR-110): `fuseOcrPage` re-ordena al fusionar, con el criterio de
 * renglones de `pdf-engine`, que es el autoritativo del Core. Que acá haya un
 * comparador propio no es una copia que quedó suelta: es deliberado, y el
 * spec lo fija — su tolerancia de 1px vive en el espacio de PÍXELES, antes de
 * la conversión a puntos (ADR-064 §2), que es el único donde significa lo que
 * dice.
 *
 * `Duplicacion_De_Logica.md` §4 lo listaba como duplicado de
 * `sortWordsByReadingOrder` de `pdf-engine`. Ya no lo son: aquélla creció con
 * el agrupado por renglones (ADR-110), el corte por columnas (ADR-113) y la
 * hoja torcida (ADR-120); ésta son ocho líneas que ordenan lo que este kernel
 * devuelve.
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

/*
 * ADR-121: el texto rotado DENTRO de una hoja derecha —un folio, un sello de
 * firma, un cargo— no lo lee nadie. El buscador de líneas de Tesseract busca
 * líneas de base horizontales, y una corrida vertical no es una línea. Y OSD no
 * ayuda: contesta bien, porque la orientación dominante de esa página ES 0.
 *
 * Medido sobre `qa-stamp.pdf` rasterizado: de sus 15 palabras rotadas, la
 * pasada derecha recupera 2.
 *
 * La salida es reconocer también el raster girado. Sobre la PÁGINA COMPLETA
 * cuesta +133 % de tiempo; sobre FRANJAS DE MARGEN recupera exactamente lo
 * mismo (15/15) por +70 %, porque el cuerpo no entra en el recorte y por lo
 * tanto no hay nada que Tesseract lea de costado.
 *
 * Lo que esta variante NO ve: un sello rotado en el MEDIO de la página. Es una
 * apuesta sobre dónde vive el dato —folios y sellos van al margen— y no una
 * garantía.
 */
const MARGIN_STRIP_RATIO = 0.2;

/*
 * ADR-121 §2: piso de confianza para una palabra de las pasadas rotadas.
 *
 * Las 15 palabras rotadas reales vuelven con 85-96; la basura que sobrevive al
 * descarte por solapamiento está en 62 y 76. Barrido: sin piso quedan 18
 * sobrantes, con 60 quedan 6, con 80 quedan 4 — y con 90 se pierden 2 palabras
 * reales. Se elige 60 y no 80 a propósito: el fixture es sintético y más limpio
 * que un escaneo real, así que el margen va del lado de no perder dato.
 */
const ROTATED_MIN_CONFIDENCE = 60;

/**
 * ADR-121 §1: recorta una franja vertical del raster. Aritmética de píxeles,
 * sin canvas, por la misma razón que `rotateImageData` (ADR-090 §3): la función
 * queda pura y testeable en el entorno `node` de Vitest.
 */
export function cropImageData(source: ImageData, x0: number, width: number): ImageData {
  /*
   * Las dimensiones se truncan a entero antes de indexar. El `ImageData` de un
   * navegador siempre las trae enteras, pero `viewport.width` de pdf.js NO lo
   * es: basta un doble de test que lo copie tal cual para que el `set()` de la
   * última fila se pase del buffer por medio píxel y tire "offset is out of
   * bounds". Acá eso costaba la página entera, no la franja.
   */
  const sourceWidth = Math.trunc(source.width);
  const height = Math.trunc(source.height);
  const { data } = source;
  const startX = Math.max(0, Math.min(sourceWidth, Math.round(x0)));
  const cropWidth = Math.max(0, Math.min(sourceWidth - startX, Math.round(width)));
  const out = new Uint8ClampedArray(cropWidth * height * 4);
  for (let y = 0; y < height; y++) {
    const from = (y * sourceWidth + startX) * 4;
    out.set(data.subarray(from, from + cropWidth * 4), y * cropWidth * 4);
  }
  return createImageDataResult(out, cropWidth, height, source.colorSpace);
}

/** Fracción del área del rectángulo MÁS CHICO que comparten dos cajas. */
function intersectionRatio(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller <= 0 ? 0 : ((x2 - x1) * (y2 - y1)) / smaller;
}

/*
 * ADR-165 §2.2: la única tolerancia de esta regla, y la mínima que funciona.
 * El barrido de la ADR (112 franjas, d = 0..8) toma la MISMA decisión para
 * cualquier d entre 1 y 8 — no hay un óptimo que calibrar, así que se elige
 * el mínimo, que es también el que menos expone al riesgo de §6 del ADR.
 */
const EXPLAINED_INK_DILATION_PX = 1;

/** Inversa de `toPagePoints`: puntos de página → píxeles del raster. */
function fromPagePoints(bbox: BoundingBox, dpi: number): BoundingBox {
  const factor = dpi / POINTS_PER_INCH;
  return {
    x: bbox.x * factor,
    y: bbox.y * factor,
    width: bbox.width * factor,
    height: bbox.height * factor,
  };
}

/** Expande una caja `amount` px hacia los cuatro lados. */
function dilateBox(box: BoundingBox, amount: number): BoundingBox {
  return {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}

function isFiniteBox(box: BoundingBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height)
  );
}

/**
 * ADR-165 §2 / handoff §1.1: proyecta la caja de una palabra de la pasada
 * derecha —en puntos, espacio del raster ORIGINAL, que es donde sale
 * `Word.bbox`— al espacio de píxeles de la franja (el ENDEREZADO, con el
 * `x0` de la franja ya restado), dilatada `EXPLAINED_INK_DILATION_PX`.
 *
 * Es el mapeo INVERSO del que hace `toWords`: ahí `unrotateBbox` lleva una
 * caja del enderezado al original con el ángulo de la página. Acá se va al
 * revés —original a enderezado— así que el ángulo que corresponde es el
 * COMPLEMENTARIO (`(360 - orientation) % 360`), con las dimensiones del
 * espacio AL QUE la caja va (el enderezado) — la misma regla que fija
 * v1.16.1, aplicada en el sentido contrario. `null` ante una caja no finita:
 * el caller decide qué hacer con eso (fail-open, nunca en silencio).
 */
export function projectWordBoxToStrip(
  wordBboxPoints: BoundingBox,
  dpi: number,
  orientation: Rotation,
  uprightWidth: number,
  uprightHeight: number,
  stripX0: number,
): BoundingBox | null {
  const pixelsInOriginal = fromPagePoints(wordBboxPoints, dpi);
  const complementary = ((360 - orientation) % 360) as Rotation;
  const pixelsInUpright = unrotateBbox(
    pixelsInOriginal,
    complementary,
    uprightWidth,
    uprightHeight,
  );
  const local = dilateBox(
    { ...pixelsInUpright, x: pixelsInUpright.x - stripX0 },
    EXPLAINED_INK_DILATION_PX,
  );
  return isFiniteBox(local) ? local : null;
}

/**
 * Proyecta TODAS las palabras de la pasada derecha al espacio de la franja.
 * `null` si alguna cae en una caja no finita: una sola proyección incoherente
 * basta para no confiar en el resto (ADR-165 §2.5, fail-open).
 */
function collectExplainedBoxes(
  words: ReadonlyArray<Word>,
  dpi: number,
  orientation: Rotation,
  uprightWidth: number,
  uprightHeight: number,
  stripX0: number,
): ReadonlyArray<BoundingBox> | null {
  const boxes: BoundingBox[] = [];
  for (const word of words) {
    const box = projectWordBoxToStrip(
      word.bbox,
      dpi,
      orientation,
      uprightWidth,
      uprightHeight,
      stripX0,
    );
    if (box === null) return null;
    boxes.push(box);
  }
  return boxes;
}

function isPointInsideBox(x: number, y: number, box: BoundingBox): boolean {
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
}

/**
 * ADR-165: `true` si NINGÚN píxel presente de la franja cae fuera de
 * `explainedBoxes` — la franja no puede aportar nada que `intersectionRatio`
 * no fuera a descartar de todos modos. Corta apenas encuentra uno afuera
 * (handoff §1.4): no hace falta contar el resto, y ese corte es lo que
 * mantiene barato el caso que sí se saltea. Geometría incoherente del propio
 * buffer (mismo guard que `isVisuallyWhiteStrip`): `false` — que acá también
 * significa "no está explicada", o sea que corren las pasadas.
 */
function isStripInkFullyExplained(
  strip: ImageData,
  explainedBoxes: ReadonlyArray<BoundingBox>,
): boolean {
  const { data, width, height } = strip;
  if (width <= 0 || height <= 0 || data.length === 0 || data.length !== width * height * 4) {
    return false;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (!isPixelPresent(data[index], data[index + 1], data[index + 2], data[index + 3])) {
        continue;
      }
      if (!explainedBoxes.some((box) => isPointInsideBox(x, y, box))) return false;
    }
  }
  return true;
}

/*
 * ADR-160 §1: `image` acepta también `Blob` — el camino común (orientación 0)
 * le pasa a `recognize()` el blob codificado directo, sin canvas de por
 * medio. El camino lento (orientación ≠ 0) y las franjas de margen siguen
 * pasando un `OffscreenCanvas` (`toTesseractImage`), porque necesitan la
 * rotación de píxeles que solo corre sobre `ImageData`.
 */
async function recognizeWithTimeout(
  image: OffscreenCanvas | Blob,
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

/*
 * ADR-160 §3: decodifica SOLO la franja, con el recorte en la propia
 * decodificación (`createImageBitmap(blob, sx, sy, sw, sh)`) — nunca
 * decodifica la página para recortarla después. `sy`/`sh` son `0`/`heightPx`
 * siempre: las franjas de ADR-121 son de alto completo, igual que
 * `cropImageData` (que nunca tocaba el alto, solo el ancho).
 *
 * Un fallo acá (`createImageBitmap` ausente o que rechaza, sin contexto 2D)
 * se propaga tal cual — el caller (`recognizeRotatedMargins`) ya tiene el
 * guard que lo saltea sin voltear la página (caso 16/22 de §13); no hace
 * falta duplicar ese criterio acá.
 */
async function decodeStrip(
  blob: Blob,
  x0: number,
  width: number,
  heightPx: number,
  documentId: string,
  pageIndex: number,
): Promise<ImageData> {
  if (typeof OffscreenCanvas === "undefined") {
    throw new OcrPageFailedError(
      documentId,
      pageIndex,
      "OffscreenCanvas no disponible en este entorno.",
    );
  }
  const bitmap = await createImageBitmap(blob, x0, 0, width, heightPx);
  const canvas = new OffscreenCanvas(width, heightPx);
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    throw new OcrPageFailedError(
      documentId,
      pageIndex,
      "No se pudo obtener un contexto 2D de OffscreenCanvas para la franja.",
    );
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, width, heightPx);
}

/**
 * ADR-121: las pasadas rotadas sobre las franjas de margen.
 *
 * Cuatro reconocimientos —franja izquierda y derecha, cada una a 90° y a 270°—
 * y una regla de fusión de dos partes, las dos medidas:
 *
 * 1. **Se descarta la candidata que solape una palabra ya encontrada derecha.**
 *    El umbral no hay que elegirlo: barrido a 0,01 / 0,3 / 0,5 da exactamente
 *    18 sobrantes en los tres. Una candidata rotada o pisa mucho una palabra
 *    derecha o no la pisa nada; no hay zona gris.
 * 2. **Piso de confianza** (`ROTATED_MIN_CONFIDENCE`), que lleva esos 18 a 6.
 *
 * Sobre un documento SIN texto rotado la regla filtra todo: medido sobre
 * `text-10p.pdf`, las cuatro pasadas producen 4 candidatas y entran **0**. Lo
 * único que cambia ahí es el reloj.
 *
 * Un fallo de cualquiera de las cuatro pasadas **no voltea la página**: se
 * devuelve lo que se haya podido leer. El texto derecho ya está reconocido y
 * perderlo por un extra sería peor que no tener el extra. La cancelación sí se
 * respeta, chequeando entre pasadas.
 *
 * ADR-160 §3: de dónde sale `cropped` es lo único que cambia entre el camino
 * común y el lento — la regla de fusión de acá para abajo (umbral de
 * solape, `ROTATED_MIN_CONFIDENCE`, el guard por franja) es la MISMA función,
 * sin bifurcar. `getStrip` la resuelve: `kernelRecognizeUpright` decodifica
 * la franja directo del blob (`decodeStrip`); `kernelRecognizeRotated` sigue
 * recortando el `ImageData` de página ya decodificado (`cropImageData`, sin
 * cambios). `uprightWidth` reemplaza a `upright.width` porque el camino
 * común no tiene ningún `ImageData` de página del que leerlo.
 *
 * v1.16.1: `uprightWidth` es del raster ENDEREZADO — de ahí sale la
 * geometría de la franja (`stripWidth`, el `x0` de cada lado, el recorte),
 * que es de donde se recorta de verdad; el alto no hace falta acá porque
 * cada franja es de alto completo y `getStrip` ya lo captura por closure.
 * Pero el ÚLTIMO paso del mapeo de cada caja —franja rotada → franja →
 * enderezado → raster ORIGINAL— tiene que deshacer la rotación de PÁGINA con
 * las dimensiones del raster ORIGINAL (`originalWidth`/`originalHeight`),
 * como pide la firma de `unrotateBbox`. En 90/270 el enderezado tiene el
 * ancho y el alto intercambiados respecto del original, así que reusar
 * `uprightWidth` ahí saca la caja de su lugar real. Son dos espacios
 * distintos a propósito; no se unifican.
 */
async function recognizeRotatedMargins(params: {
  readonly getStrip: (x0: number, width: number) => Promise<ImageData>;
  readonly uprightWidth: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly words: ReadonlyArray<Word>;
  readonly orientation: Rotation;
  readonly documentId: string;
  readonly pageIndex: number;
  readonly dpi: number;
  readonly opts: KernelRecognizeOptions;
}): Promise<Word[]> {
  const {
    getStrip,
    uprightWidth,
    originalWidth,
    originalHeight,
    words,
    orientation,
    documentId,
    pageIndex,
    dpi,
    opts,
  } = params;
  const stripWidth = Math.round(uprightWidth * MARGIN_STRIP_RATIO);
  if (stripWidth <= 0) return [];

  const strips: ReadonlyArray<{ readonly x0: number }> = [
    { x0: 0 },
    { x0: uprightWidth - stripWidth },
  ];
  const rotations: ReadonlyArray<Rotation> = [90, 270];
  const found: Word[] = [];

  for (const strip of strips) {
    // El recorte entra al guard igual que el reconocimiento: la pasada rotada
    // es un extra, y ninguna forma de fallar suya puede costar el texto
    // derecho que ya está leído.
    let cropped: ImageData;
    try {
      cropped = await getStrip(strip.x0, stripWidth);
    } catch {
      continue;
    }

    /*
     * ADR-162 §13 caso 23: la compuerta es deliberadamente exacta. Una franja
     * solo se considera visualmente blanca cuando cada píxel es transparente
     * o tiene sus tres canales RGB en 255. La decisión se toma una sola vez,
     * antes de las dos rotaciones; una excepción abre la compuerta (el texto
     * visible nunca debe perderse por una inspección defensiva).
     */
    let visuallyWhite = false;
    try {
      visuallyWhite = isVisuallyWhiteStrip(cropped);
    } catch {
      visuallyWhite = false;
    }
    if (visuallyWhite) continue;

    /*
     * ADR-165: si toda la tinta que queda cae dentro de una caja de la
     * pasada derecha (dilatada), esta franja no puede aportar nada nuevo —
     * `intersectionRatio` descartaría cualquier candidata de todos modos,
     * después de haber pagado el reconocimiento. Fail-open, mismo criterio
     * que la compuerta de arriba: cualquier excepción o proyección
     * incoherente dejan `fullyExplained` en `false`.
     */
    let fullyExplained = false;
    try {
      const explainedBoxes = collectExplainedBoxes(
        words,
        dpi,
        orientation,
        uprightWidth,
        cropped.height,
        strip.x0,
      );
      fullyExplained = explainedBoxes !== null && isStripInkFullyExplained(cropped, explainedBoxes);
    } catch {
      fullyExplained = false;
    }
    if (fullyExplained) continue;

    for (const rotation of rotations) {
      if (opts.abortSignal.aborted) throw new CancelledError(documentId);
      let data: unknown;
      try {
        data = await recognizeWithTimeout(
          toTesseractImage(rotateImageData(cropped, rotation), documentId, pageIndex),
          documentId,
          pageIndex,
          opts.timeoutMs,
          opts.abortSignal,
        );
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        continue;
      }

      for (const raw of extractTesseractWords(data)) {
        if (raw.confidence < ROTATED_MIN_CONFIDENCE) continue;
        const text = raw.text.normalize("NFC");
        if (text.trim().length === 0) continue;

        // rotado → franja → enderezado → raster original → puntos de página
        const inStrip = unrotateBbox(
          {
            x: raw.bbox.x0,
            y: raw.bbox.y0,
            width: raw.bbox.x1 - raw.bbox.x0,
            height: raw.bbox.y1 - raw.bbox.y0,
          },
          rotation,
          cropped.width,
          cropped.height,
        );
        const inUpright = { ...inStrip, x: inStrip.x + strip.x0 };
        // v1.16.1: dimensiones del raster ORIGINAL, no las del enderezado —
        // es la inversa de la rotación de PÁGINA, y unrotateBbox pide el
        // tamaño de a dónde vuelve, no de dónde sale.
        const bbox = toPagePoints(
          unrotateBbox(inUpright, orientation, originalWidth, originalHeight),
          dpi,
        );

        if (words.some((word) => intersectionRatio(word.bbox, bbox) > 0)) continue;

        /*
         * La rotación que el resto del sistema ve es la del raster ORIGINAL:
         * la de la franja compuesta con la de la hoja (ADR-090 §4 estampa la
         * de la hoja sobre el texto derecho, y ésta es la misma cuenta un
         * escalón más adentro).
         */
        const composed = ((rotation + orientation) % 360) as Rotation;
        found.push({
          text,
          bbox: composed === 0 ? bbox : { ...bbox, rotation: composed },
          pageIndex,
          confidence: clampConfidence(raw.confidence / 100),
          source: "ocr" as const,
        });
      }
    }
  }
  return found;
}

/**
 * ADR-162 §13 caso 23 / ADR-165 §2.1: predicado de "píxel presente",
 * reutilizado LITERAL por las dos reglas — una copia divergente mediría otra
 * cosa y ningún test lo detectaría (handoff §1.2).
 */
function isPixelPresent(
  r: number | undefined,
  g: number | undefined,
  b: number | undefined,
  alpha: number | undefined,
): boolean {
  return alpha !== 0 && (r !== 255 || g !== 255 || b !== 255);
}

/** ADR-162: predicado exacto de blanco/transparencia, sin umbrales implícitos. */
function isVisuallyWhiteStrip(image: ImageData): boolean {
  const { data } = image;
  if (
    image.width <= 0 ||
    image.height <= 0 ||
    data.length === 0 ||
    data.length !== image.width * image.height * 4
  ) {
    return false;
  }
  for (let index = 0; index < data.length; index += 4) {
    if (isPixelPresent(data[index], data[index + 1], data[index + 2], data[index + 3])) {
      return false;
    }
  }
  return true;
}

export interface KernelRecognizeOptions {
  readonly timeoutMs: number;
  readonly abortSignal: AbortSignal;
}

export interface KernelOcrResult {
  readonly words: ReadonlyArray<Word>;
  readonly confidence: number;
}

/*
 * ADR-160 §1/§3: camino común — orientación 0, ~99 % de las páginas. Nunca
 * decodifica la página: `recognize()` recibe el blob codificado directo
 * (los píxeles que llegan al core son bit a bit los mismos que produce hoy
 * `convertToBlob()`, porque PNG es sin pérdida) y las franjas de margen
 * decodifican solo su recorte (`decodeStrip`). Cero `OffscreenCanvas` de
 * página completa.
 */
async function kernelRecognizeUpright(
  blob: Blob,
  image: EncodedPageImage,
  dpi: number,
  documentId: string,
  pageIndex: number,
  opts: KernelRecognizeOptions,
): Promise<KernelOcrResult> {
  const data = await recognizeWithTimeout(
    blob,
    documentId,
    pageIndex,
    opts.timeoutMs,
    opts.abortSignal,
  );
  // ADR-160 §1: dimensiones AUTORITATIVAS del payload (ADR-158 §4) — no hay
  // ningún `ImageData` decodificado del que leerlas en este camino.
  const words = toWords(data, pageIndex, dpi, 0, image.widthPx, image.heightPx);
  const confidence = clampConfidence(extractPageConfidence(data) / 100);

  const rotated = await recognizeRotatedMargins({
    getStrip: (x0, width) => decodeStrip(blob, x0, width, image.heightPx, documentId, pageIndex),
    uprightWidth: image.widthPx,
    // Orientación 0: enderezado y original son el mismo raster.
    originalWidth: image.widthPx,
    originalHeight: image.heightPx,
    words,
    orientation: 0,
    documentId,
    pageIndex,
    dpi,
    opts,
  });

  return { words: [...words, ...rotated], confidence };
}

/*
 * ADR-160 §4: camino lento, declarado — orientación ≠ 0 necesita la página
 * entera en píxeles para el enderezado de ADR-120 (§4 del Contexto: el
 * `angle` de `SetImageFile` no sirve para esto). Decodifica completo, igual
 * que antes de ADR-160; es el ~1 % de las páginas.
 */
async function kernelRecognizeRotated(
  image: EncodedPageImage,
  orientation: Rotation,
  dpi: number,
  documentId: string,
  pageIndex: number,
  opts: KernelRecognizeOptions,
): Promise<KernelOcrResult> {
  const imageData = await decodeEncodedImage(image, documentId, pageIndex);

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  const upright = rotateImageData(imageData, orientation);
  const data = await recognizeWithTimeout(
    toTesseractImage(upright, documentId, pageIndex),
    documentId,
    pageIndex,
    opts.timeoutMs,
    opts.abortSignal,
  );
  const words = toWords(data, pageIndex, dpi, orientation, image.widthPx, image.heightPx);
  const confidence = clampConfidence(extractPageConfidence(data) / 100);

  const rotated = await recognizeRotatedMargins({
    getStrip: (x0, width) => Promise.resolve(cropImageData(upright, x0, width)),
    uprightWidth: upright.width,
    // v1.16.1: el raster ORIGINAL es `image`, no `upright` — en 90/270
    // `upright` tiene el ancho y el alto intercambiados respecto de él.
    originalWidth: image.widthPx,
    originalHeight: image.heightPx,
    words,
    orientation,
    documentId,
    pageIndex,
    dpi,
    opts,
  });

  return { words: [...words, ...rotated], confidence };
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
  const { documentId, pageIndex, image, languages, dpi, orientation } = payload;

  if (orientation !== 0 && orientation !== 90 && orientation !== 180 && orientation !== 270) {
    throw new InvalidInputError("orientation inválida en OcrPagePayload.", {
      engineId: "ocr",
      orientation,
    });
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  await ensureWorkerLoaded(languages);
  await ensureDpiApplied(dpi);
  await ensurePageSegModeApplied();

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  // ADR-160 §1: el blob codificado (ADR-158 §2) es la única forma de imagen
  // que existe hasta que el camino lento decide que hace falta más.
  const blob = new Blob([image.bytes], { type: `image/${image.format}` });

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  return orientation === 0
    ? kernelRecognizeUpright(blob, image, dpi, documentId, pageIndex, opts)
    : kernelRecognizeRotated(image, orientation, dpi, documentId, pageIndex, opts);
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
  pageSegModeApplied = false;
}
