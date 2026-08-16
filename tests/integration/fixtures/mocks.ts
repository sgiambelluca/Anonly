/**
 * Mocks de fronteras de librerías externas pesadas para `tests/integration/`
 * (ADR-021 §5, ADR-034 §6, Code_Standards.md §10): mismo criterio que cada
 * motor aplica en sus propios `__tests__/fixtures/` (precedentes:
 * `mockGetDocumentResult`/`createMockPdfDocument` en pdf-engine,
 * `mockTesseractWorker`/`mockRecognizeData` en ocr-engine, la instalación de
 * `OffscreenCanvas` en render-engine) — replicados acá en vez de importarlos
 * de las carpetas internas `__tests__/fixtures/` de otros paquetes (esos
 * archivos no son parte del `index.ts` público de cada motor).
 *
 * `vi.mock(...)` NO vive acá (hoisting de Vitest): cada archivo de test lo
 * declara en su propio módulo; este archivo solo unifica los builders.
 */
import type { pipeline } from "@huggingface/transformers";
import { OPS, type getDocument } from "pdfjs-dist";
import type { createWorker } from "tesseract.js";
import { vi, type Mock } from "vitest";

// ─── pdfjs-dist (PdfEngine + RenderEngine) ───

function asLoadingTask(promise: Promise<unknown>): ReturnType<typeof getDocument> {
  return { promise } as unknown as ReturnType<typeof getDocument>;
}

export function mockGetDocumentResult(doc: Record<string, unknown>): ReturnType<typeof getDocument> {
  return asLoadingTask(Promise.resolve(doc));
}

export interface MockTextItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Rectángulo de una imagen colocada en la página, en **espacio de usuario PDF**
 * (origen abajo-izquierda), que es como viaja en la CTM del operator list.
 */
export interface MockImageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Operator list mínima: `save cm paintImageXObject restore` por imagen
 * (ADR-065 §1, compuerta 1). Usa el `OPS` REAL de pdfjs-dist —los tests que
 * importan este módulo mockean `getDocument` con `importOriginal`, así que
 * `OPS` es el verdadero—: el motor bajo prueba lee esos mismos valores, y un
 * `OPS` inventado acá daría falsos positivos o negativos. Espejo del
 * `buildMockOperatorList` de `pdf-engine/src/__tests__/fixtures/`.
 */
/**
 * Run de texto de una anotación (ADR-066 §1). Se emite con el idioma **normal**
 * de PDF —`setFont` para el cuerpo y `moveText` para la posición, sin ningún
 * `setTextMatrix`— porque es el que usa el documento real; el appearance stream
 * aplanado (cuerpo metido en la escala de `Tm`) es el que produce un re-export
 * y el que escondió la mitad del contrato hasta ADR-066 §2 (corrección).
 */
export interface MockAnnotationRun {
  /** Desplazamiento sobre el eje de avance, el `Td` del run. */
  readonly offset: number;
  readonly text: string;
  /** Ancho de cada glifo en 1/1000 em (uniforme, alcanza para el prorrateo). */
  readonly glyphWidth?: number;
}

export interface MockSignatureAnnotation {
  readonly id: string;
  /** `[x0, y0, x1, y1]` en espacio PDF (origen abajo-izquierda). */
  readonly rect: readonly [number, number, number, number];
  /** Tercer argumento de `beginAnnotation`: ubica la anotación en la página. */
  readonly transform: readonly [number, number, number, number, number, number];
  /** Transform interno; `[0,1,-1,0,50,0]` es el giro a 90° de la firma medida. */
  readonly innerTransform: readonly [number, number, number, number, number, number];
  readonly fontSize: number;
  readonly runs: ReadonlyArray<MockAnnotationRun>;
}

function buildOperatorList(
  images: ReadonlyArray<MockImageRect>,
  annotations: ReadonlyArray<MockSignatureAnnotation> = [],
): {
  readonly fnArray: number[];
  readonly argsArray: unknown[];
} {
  const fnArray: number[] = [];
  const argsArray: unknown[] = [];

  for (const annotation of annotations) {
    fnArray.push(OPS.beginAnnotation);
    argsArray.push([annotation.id, annotation.rect, annotation.transform, [1, 0, 0, 1, 0, 0], false]);
    for (const run of annotation.runs) {
      fnArray.push(OPS.save);
      argsArray.push([]);
      fnArray.push(OPS.transform);
      argsArray.push(annotation.innerTransform);
      fnArray.push(OPS.beginText);
      argsArray.push([]);
      fnArray.push(OPS.setFont);
      argsArray.push(["g_d0_f4", annotation.fontSize]);
      fnArray.push(OPS.moveText);
      argsArray.push([0, run.offset]);
      fnArray.push(OPS.showText);
      argsArray.push([
        [...run.text].map((ch) => ({ unicode: ch, width: run.glyphWidth ?? 500 })),
      ]);
      fnArray.push(OPS.restore);
      argsArray.push([]);
    }
    fnArray.push(OPS.endAnnotation);
    argsArray.push([]);
  }

  for (const image of images) {
    fnArray.push(OPS.save);
    argsArray.push([]);
    fnArray.push(OPS.transform);
    argsArray.push([image.width, 0, 0, image.height, image.x, image.y]);
    fnArray.push(OPS.paintImageXObject);
    argsArray.push(["img", image.width, image.height]);
    fnArray.push(OPS.restore);
    argsArray.push([]);
  }
  return { fnArray, argsArray };
}

/**
 * Página combinada para pdfjs-dist: sirve tanto al uso de `PdfEngine`
 * (`getTextContent` + `getViewport({ scale: 1 })` + `getOperatorList()`) como
 * al de `RenderEngine` (`getViewport({ scale })` + `render(...)`).
 * `textItems` vacío ⇒ página sin texto (`requiresOCR: true`).
 * `images` vacío ⇒ página sin imágenes ⇒ sin `ocrRegions` (ADR-065 §1).
 */
export function createMockPdfPage(
  textItems: ReadonlyArray<MockTextItem>,
  images: ReadonlyArray<MockImageRect> = [],
  annotations: ReadonlyArray<MockSignatureAnnotation> = [],
): Record<string, unknown> {
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale })),
    getTextContent: vi.fn(() =>
      Promise.resolve({
        items: textItems.map((item) => ({
          str: item.str,
          transform: [1, 0, 0, 1, item.x, item.y],
          width: item.width,
          height: item.height,
        })),
      }),
    ),
    // ADR-065 §1 (compuerta 1): `parsePage` llama `getOperatorList()` en toda
    // página para detectar image XObjects. Sin esto, el mock lo deja
    // `undefined` y el parseo muere en `PdfCorruptedError`, tumbando el
    // pipeline entero.
    getOperatorList: vi.fn(() => Promise.resolve(buildOperatorList(images, annotations))),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
  };
}

export function createMockPdfDocument(pages: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  return {
    numPages: pages.length,
    getPage: vi.fn((pageNumber: number) => Promise.resolve(pages[pageNumber - 1])),
    getMetadata: vi.fn(() => Promise.resolve({ info: { Title: "Integration" }, metadata: undefined })),
    destroy: vi.fn(() => Promise.resolve()),
    _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
  };
}

// ─── OffscreenCanvas (RenderEngine.rasterizePage + OcrEngine.toTesseractImage) ───

/**
 * Un `fillRect`/`fillText` registrado (ADR-074, Hito 10.9 PR 11): el resto de
 * los tests de integración no lee `calls`, así que grabar acá no les cambia
 * nada — es lo mínimo que necesita el test de punta a punta para verificar
 * "se pintan dos rectángulos" sin duplicar el stub más rico de
 * `render-engine/src/__tests__/fixtures/test-helpers.ts` (que este archivo no
 * puede importar, ver la nota de arriba).
 */
export interface RecordedDrawCall {
  readonly op: "fillRect" | "fillText";
  readonly args: ReadonlyArray<unknown>;
}

class StubCanvasContext2D {
  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  readonly calls: RecordedDrawCall[] = [];
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ op: "fillRect", args: [x, y, w, h] });
  }
  strokeRect(): void {}
  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.calls.push({ op: "fillText", args: maxWidth === undefined ? [text, x, y] : [text, x, y, maxWidth] });
  }
  // `paintReplacements` (render-engine) llama `measureText` para el
  // shrink-to-fit (ADR-058 §1) antes de cada `fillText`. Fórmula arbitraria y
  // determinista, mismo criterio que `measureStubTextWidth` de
  // `render-engine/src/__tests__/fixtures/test-helpers.ts`: alcanza con que
  // crezca con el tamaño de fuente y el largo del texto.
  measureText(text: string): { readonly width: number } {
    const sizeMatch = /^([\d.]+)px/.exec(this.font);
    const size = sizeMatch ? Number(sizeMatch[1]) : 0;
    return { width: text.length * size * 0.6 };
  }
  drawImage(): void {}
  putImageData(): void {}
  getImageData(x: number, y: number, w: number, h: number): ImageData {
    return { data: new Uint8ClampedArray(Math.max(w, 0) * Math.max(h, 0) * 4), width: w, height: h, colorSpace: "srgb" };
  }
}

class StubOffscreenCanvas {
  width: number;
  height: number;
  readonly context = new StubCanvasContext2D();
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    createdCanvases.push(this);
  }
  getContext(id: string): StubCanvasContext2D | null {
    return id === "2d" ? this.context : null;
  }
  // ADR-034 §3: `kernelRenderPage` codifica siempre, en los dos modos
  // (`preview` y `full`) — ver el comentario de `worker/kernel.ts` junto a
  // `encodeImageData`. `multi-line-fragments.test.ts` (ADR-074, Hito 10.9 PR
  // 11) es el primer test de integración que de verdad llama `renderPage`,
  // así que necesita un blob real y no solo el `throw` de antes.
  convertToBlob(options?: { readonly type?: string }): Promise<Blob> {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    return Promise.resolve(new Blob([bytes], { type: options?.type ?? "image/png" }));
  }
}

let createdCanvases: StubOffscreenCanvas[] = [];

export function installOffscreenCanvasStub(): void {
  if (typeof globalThis.OffscreenCanvas !== "undefined") return;
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: StubOffscreenCanvas,
    writable: true,
    configurable: true,
  });
}

/** Los `calls` grabados de cada `OffscreenCanvas` creado, en orden de creación. */
export function getCreatedCanvasCalls(): ReadonlyArray<ReadonlyArray<RecordedDrawCall>> {
  return createdCanvases.map((c) => c.context.calls);
}

export function resetCreatedCanvases(): void {
  createdCanvases = [];
}

// ─── tesseract.js (OcrEngine) ───

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

function asTesseractWorker(partial: Record<string, unknown>): TesseractWorker {
  return partial as unknown as TesseractWorker;
}

export interface MockRecognizeWord {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

export function mockRecognizeData(words: ReadonlyArray<MockRecognizeWord>): Record<string, unknown> {
  const confidence = words.length > 0 ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length : 0;
  return {
    confidence,
    blocks: [
      { paragraphs: [{ lines: [{ words: words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) }] }] },
    ],
  };
}

export function mockTesseractWorker(recognizeData: unknown): TesseractWorker {
  return asTesseractWorker({
    recognize: vi.fn(() => Promise.resolve({ jobId: "mock-job", data: recognizeData })),
    terminate: vi.fn(() => Promise.resolve()),
  });
}

// ─── @huggingface/transformers (NerEngine) ───

export interface MockNerToken {
  readonly entity: string;
  readonly score: number;
  readonly index: number;
  readonly word: string;
}

type TokenClassificationPipelineType = Awaited<ReturnType<typeof pipeline<"token-classification">>>;

/**
 * Cast de frontera contra @huggingface/transformers — mismo criterio que
 * `mockTokenClassificationPipeline` en ner-engine (Code_Standards.md §10):
 * `NerEngine` solo invoca el pipeline como función callable y `.dispose()`,
 * nunca los miembros reales (`tokenizer`/`model`/`_call`) del tipo real.
 */
export function mockTokenClassificationPipeline(
  classify: (text: string) => Promise<ReadonlyArray<MockNerToken>>,
): TokenClassificationPipelineType {
  const callable = (text: string): Promise<ReadonlyArray<MockNerToken>> => classify(text);
  const withDispose = Object.assign(callable, { dispose: () => Promise.resolve() });
  return withDispose as unknown as TokenClassificationPipelineType;
}

type PipelineFactoryMock = Mock<
  (task: string, model?: string, options?: Record<string, unknown>) => Promise<TokenClassificationPipelineType>
>;

/**
 * Segundo (y último) cast de frontera contra @huggingface/transformers,
 * precedente `asPipelineMock` en ner-engine: `vi.mocked(pipeline)` tipa el
 * mock contra la unión completa de clases concretas de pipeline (genérica
 * sobre `PipelineType`), no contra `TokenClassificationPipelineType` — el
 * alias estructural que este mock realmente produce. Existe para que los
 * archivos de test llamen `.mockResolvedValue(...)` sin repetir el cast.
 */
export function asPipelineMock(fn: unknown): PipelineFactoryMock {
  return fn as unknown as PipelineFactoryMock;
}
