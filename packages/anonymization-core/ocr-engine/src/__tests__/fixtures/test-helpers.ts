/**
 * Mocks y builders compartidos por los tests de @anonly/ocr-engine.
 *
 * `vi.mock("tesseract.js", ...)` NO vive acá: por el hoisting de Vitest, cada
 * archivo de test debe declarar su propio `vi.mock` en su propio módulo
 * (mismo motivo documentado en pdf-engine/src/__tests__/fixtures/test-helpers.ts).
 * Este archivo solo unifica los helpers de construcción de mocks
 * (Code_Standards.md §10; ADR-021 §5; precedente: mockGetDocumentResult en
 * pdf-engine).
 */
import type { EngineConfig, EngineContext } from "@anonly/shared";
import { createEngineContext as sharedCreateEngineContext, createMockConfig as sharedCreateMockConfig } from "@anonly/test-utils";
import type { createWorker } from "tesseract.js";
import { vi } from "vitest";


import type { OcrPageInput } from "../../ocr.types.js";


/*
 * ADR-129: los dobles genéricos viven en `@anonly/test-utils`. Se re-exportan
 * acá para que cada suite siga importando de un solo lugar.
 */
export {
  createEngineContextWithRealBus,
  createMockBus,
  createMockCache,
  createMockLogger,
} from "@anonly/test-utils";

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

/**
 * Cast de frontera contra tesseract.js — ÚNICO lugar del paquete donde se
 * permite `as unknown as` (Code_Standards.md §10; ADR-019 nota 2026-07-09;
 * precedente `asLoadingTask`/`mockGetDocumentResult` en pdf-engine):
 * createWorker() resuelve a un Worker con decenas de miembros (recognize,
 * terminate, setParameters, load, reinitialize, detect, FS, writeText,
 * readText, removeFile, ...) que un mock estructural no puede satisfacer
 * honestamente sin implementarlos todos. `ocr.engine.ts` solo invoca
 * `recognize` y `terminate`; el mock solo provee esos dos. Los tests
 * construyen el worker mockeado vía mockTesseractWorker y nunca castean por
 * su cuenta.
 */
function asTesseractWorker(partial: Record<string, unknown>): TesseractWorker {
  return partial as unknown as TesseractWorker;
}

export type MockRecognizeWord = {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
};

/**
 * Arma la forma `data` que tesseract.js devuelve para
 * `recognize(image, {}, { blocks: true })`: jerarquía Block > Paragraph >
 * Line > Word (ver naptha/tesseract.js docs/api.md). `ocr.engine.ts` la
 * recorre con guards de runtime (no con un cast), así que este builder no
 * necesita ningún cast tampoco.
 */
export function mockRecognizeData(
  words: ReadonlyArray<MockRecognizeWord>,
  pageConfidence?: number,
): Record<string, unknown> {
  const confidence =
    pageConfidence ??
    (words.length > 0 ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length : 0);

  return {
    confidence,
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                words: words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
              },
            ],
          },
        ],
      },
    ],
  };
}

/** `recognize()` no devuelve ninguna palabra (página en blanco o solo imagen). */
export function mockEmptyRecognizeData(): Record<string, unknown> {
  return { confidence: 0, blocks: [] };
}

/** ¿El valor que recibió `recognize` tiene dimensiones legibles? */
function esRaster(value: unknown): value is { readonly width: number; readonly height: number } {
  if (typeof value !== "object" || value === null) return false;
  const { width, height } = value as { width?: unknown; height?: unknown };
  return typeof width === "number" && typeof height === "number";
}

export function mockTesseractWorker(
  // `unknown` (no Record<string, unknown>) a propósito: algunos tests de
  // resiliencia (ver unit.test.ts "Malformed tesseract.js response
  // resilience") necesitan simular respuestas de forma inesperada
  // (string, blocks/paragraphs/words con tipos incorrectos) para ejercitar
  // los guards de runtime de ocr.engine.ts. La forma real de recognizeData
  // no está fijada por ningún contrato propio (viene de una librería
  // externa), así que angostarla acá no aporta seguridad de tipos real.
  recognizeData: unknown,
  overrides?: {
    readonly recognize?: ReturnType<typeof vi.fn>;
    readonly terminate?: ReturnType<typeof vi.fn>;
    /** ADR-090 §3: OSD. Sin override, reporta página derecha. */
    readonly detect?: ReturnType<typeof vi.fn>;
    /** ADR-090 §2: `user_defined_dpi`. */
    readonly setParameters?: ReturnType<typeof vi.fn>;
  },
): TesseractWorker {
  /*
   * ADR-121: el doble devuelve los datos configurados para el PRIMER raster que
   * ve —la pasada derecha— y VACÍO para cualquier raster de otro tamaño.
   *
   * Las pasadas de franja reciben un recorte girado, o sea un raster distinto.
   * Un doble que devolviera lo mismo para todos estaría modelando que el sello
   * rotado dice exactamente lo mismo que el cuerpo, que no es un documento que
   * exista; y peor, haría que cada test de conteo de palabras midiera cinco
   * veces la misma página. Devolver vacío modela el caso MEDIDO: sobre un
   * documento sin texto rotado las cuatro pasadas de franja aportan 0 palabras.
   *
   * Un test que quiera ejercitar el hallazgo rotado pasa su propio `recognize`.
   */
  let primerRaster: string | null = null;
  const recognize =
    overrides?.recognize ??
    vi.fn((image: unknown) => {
      const size = esRaster(image) ? image.width + "x" + image.height : "?";
      primerRaster ??= size;
      const data = size === primerRaster ? recognizeData : mockEmptyRecognizeData();
      return Promise.resolve({ jobId: "mock-job", data });
    });
  const terminate = overrides?.terminate ?? vi.fn(() => Promise.resolve());
  const detect = overrides?.detect ?? vi.fn(() => Promise.resolve(mockDetectData(0)));
  const setParameters = overrides?.setParameters ?? vi.fn(() => Promise.resolve());
  return asTesseractWorker({ recognize, terminate, detect, setParameters });
}

/**
 * Forma que devuelve `worker.detect()` (ADR-090 §3). `orientation_degrees` es
 * la rotación HORARIA que hay que aplicarle al raster para enderezarlo;
 * `orientation_confidence` en la escala propia de Tesseract, que no es 0-100
 * — medido, una A4 con texto denso da ~17.
 */
export function mockDetectData(
  orientationDegrees: number | null,
  orientationConfidence = 17,
): { readonly jobId: string; readonly data: Record<string, unknown> } {
  return {
    jobId: "mock-detect-job",
    data: {
      tesseract_script_id: 1,
      script: "Latin",
      script_confidence: 20,
      orientation_degrees: orientationDegrees,
      orientation_confidence: orientationConfidence,
    },
  };
}

/**
 * `ImageData` es una interfaz estructural pura (4 campos readonly, sin
 * métodos: data/width/height/colorSpace — ver lib.dom.d.ts). No hace falta
 * ningún cast ni el `ImageData` global real (inexistente en el entorno
 * `node` de Vitest, ver vitest.config.ts `test.environment`): un literal que
 * matchea la forma alcanza.
 */
export function createImageData(width: number, height: number): ImageData {
  return {
    data: new Uint8ClampedArray(Math.max(width, 0) * Math.max(height, 0) * 4),
    width,
    height,
    colorSpace: "srgb",
  };
}

export function createValidOcrPageInput(
  documentId: string,
  pageIndex = 0,
  overrides?: Partial<OcrPageInput>,
): OcrPageInput {
  return {
    documentId,
    pageIndex,
    imageData: createImageData(100, 40),
    dpi: 300,
    languages: ["spa", "eng"],
    ...overrides,
  };
}

/**
 * Stub mínimo de `OffscreenCanvas` para el entorno `node` de Vitest (sin
 * DOM, ver vitest.config.ts `test.environment`). `ocr.engine.ts` construye
 * un `OffscreenCanvas` real para convertir `ImageData` al `ImageLike` que
 * tesseract.js realmente acepta (su `ImageLike` no incluye `ImageData`
 * directamente — ver node_modules/tesseract.js/src/index.d.ts). En un
 * navegador real `OffscreenCanvas` es global nativo; en tests, este stub se
 * instala una sola vez (no pisa un `OffscreenCanvas` real si existiera). No
 * rasteriza de verdad — `putImageData` es un no-op — porque los tests
 * mockean tesseract.js por completo y nunca inspeccionan el contenido de
 * los píxeles.
 */
let stubCanvasContextAvailable = true;

class StubOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  /*
   * ADR-119 §2: `drawImage` existe porque `scaleForOsd` reduce el raster antes
   * de detectar la orientación. Como `putImageData`, no rasteriza: los tests
   * mockean tesseract.js entero y lo único observable —y lo único que hace
   * falta observar— son las DIMENSIONES del canvas que recibe `detect`.
   */
  getContext(): { putImageData: () => void; drawImage: () => void } | null {
    if (!stubCanvasContextAvailable) return null;
    return { putImageData: () => undefined, drawImage: () => undefined };
  }
}

/**
 * Simula un entorno sin soporte de contexto 2D (edge case defensivo de
 * `toTesseractImage`, ocr.engine.ts). Referencia el stub por closure — no
 * pasa por `globalThis.OffscreenCanvas` (evita castear contra su tipo
 * ambient real de lib.dom.d.ts, que el stub no implementa por completo).
 * Los tests deben restaurar con `setStubCanvasContextAvailable(true)` en un
 * `finally`.
 */
export function setStubCanvasContextAvailable(available: boolean): void {
  stubCanvasContextAvailable = available;
}

function installOffscreenCanvasStub(): void {
  if (typeof globalThis.OffscreenCanvas !== "undefined") return;

  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: StubOffscreenCanvas,
    writable: true,
    configurable: true,
  });
}

installOffscreenCanvasStub();

// ─── Puerto interno OcrJobPool (ADR-045 §2) — fake estructural para tests ───

export interface OcrPoolDispatchParams<T> {
  readonly run: () => Promise<T>;
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly payload?: unknown;
  readonly maxRetriesOverride?: number;
}

export interface OcrDispatchCall {
  readonly payload: unknown;
  readonly maxRetriesOverride: number | undefined;
}

export interface TrackingOcrPool {
  readonly dispatch: <T>(params: OcrPoolDispatchParams<T>) => Promise<T>;
  readonly calls: OcrDispatchCall[];
}

/**
 * Pool estructural mínima (ADR-045 §2, espejo del `RenderJobPool` de
 * render-engine) que registra cada dispatch y delega en `params.run()` — usada
 * por los tests que necesitan inspeccionar los parámetros de despacho
 * (`maxRetriesOverride`, `payload`) sin depender de un `WorkerPool` real.
 * `OcrJobPool` no se exporta desde `ocr.engine.ts` (detalle de wiring
 * interno, mismo criterio que `RenderJobPool` en render-engine); esta
 * interfaz estructuralmente compatible alcanza sin importarlo — TypeScript
 * acepta pasar esta pool a `new OcrEngine(pool)` por duck typing.
 */
export function createTrackingOcrPool(): TrackingOcrPool {
  const calls: OcrDispatchCall[] = [];
  return {
    calls,
    dispatch: <T>(params: OcrPoolDispatchParams<T>): Promise<T> => {
      calls.push({ payload: params.payload, maxRetriesOverride: params.maxRetriesOverride });
      return params.run();
    },
  };
}

/**
 * Pool estructural que **ignora `params.run()`** y resuelve directo con
 * `resolvedValue` (ADR-055 §5 / Code_Standards.md §7 "Test obligatorio por
 * motor"): a diferencia de `createTrackingOcrPool` (arriba) y de todos los
 * fakes ad-hoc preexistentes de este paquete — que delegan en `run()`, o sea
 * el camino in-process, y por lo tanto **nunca cruzan el sobre**
 * `COMPLETED.result` — este es el único fake que reproduce lo que un
 * `OcrJobPool` real resolvería tras un `postMessage`. Es la pieza que faltaba
 * para poder ejercitar `decodeKernelOcrResult` de verdad (mismo precedente:
 * `createResolvedNerPool` en ner-engine).
 */
export function createResolvedOcrPool(resolvedValue: unknown): {
  readonly dispatch: (params: OcrPoolDispatchParams<unknown>) => Promise<unknown>;
} {
  return {
    dispatch: (): Promise<unknown> => Promise.resolve(resolvedValue),
  };
}

/*
 * ADR-129: el `workerPool` —idéntico en los seis motores— sale del doble
 * compartido; acá quedan **solo** los campos que este motor necesita distintos,
 * con los mismos valores que tenía su copia propia.
 */
export function createMockConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return sharedCreateMockConfig({
    ocr: { languages: ["spa", "eng"], dpi: 300 },
    ...overrides,
  });
}

/*
 * El `EngineContext` compartido arma su config internamente, así que hay que
 * pasarle la de este motor: si no, `ctx.config` sale con los defaults genéricos
 * y no con los que sus tests necesitan (ADR-129).
 */
export function createEngineContext(overrides?: Partial<EngineContext>): EngineContext {
  return sharedCreateEngineContext({ config: createMockConfig(), ...overrides });
}
