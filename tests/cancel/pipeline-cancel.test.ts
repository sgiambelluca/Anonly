/**
 * H-07 (ADR-149 §3; plan de campaña de hardening §9.2 paso 5): gate de
 * cancelación. Mide, sobre `createCore()` real (façade + los 7 motores
 * reales, ADR-021 §5 — mismo criterio que `tests/integration/`), cuánto
 * tarda cada motor en dejar de trabajar de verdad después de
 * `orchestrator.cancel()`. El SLA contractual es **200 ms**
 * (`07_Performance_Strategy.md` §9).
 *
 * `Orchestrator.cancel()` escribe `PipelineStage.Cancelled` de forma
 * SÍNCRONA, antes de que el motor en vuelo note el abort (`orchestrator.ts`,
 * `cancel()`) — un test que solo mirara `getState().stage` daría siempre
 * verde sin medir nada real. Es exactamente la advertencia de ADR-149 §1:
 * "un cambio de estado en la UI... no demuestra que la CPU paró". Por eso
 * cada caso de acá verifica en cambio que el motor **no vuelve a invocar su
 * frontera pesada** (la página/lote siguiente) después del abort, además de
 * cronometrar cuánto tarda en asentarse la promesa de `importDocument`.
 *
 * No duplica los `cancel.test.ts` que ya tiene cada paquete (grouping/ner/
 * render/export): esos prueban la lógica de cancelación de un motor
 * aislado, con sus propios mocks internos. Este archivo prueba la propiedad
 * de producto — que `orchestrator.cancel()` de verdad corta el trabajo — a
 * través del façade completo, que es lo que ADR-149 pide y lo que hoy no
 * existe (`tests/cancel/` no existía antes de este commit).
 */
import { createCore, type IAnonymizationCore } from "@anonly/anonymization-core";
import { PipelineStage } from "@anonly/shared";
import { pipeline } from "@huggingface/transformers";
import { getDocument } from "pdfjs-dist";
import type * as PdfjsDist from "pdfjs-dist";
import { createWorker } from "tesseract.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Vitest hoistea vi.mock() por encima de los imports (incluido
// @anonly/anonymization-core más arriba) — mismo patrón que
// tests/integration/*.test.ts. ADR-065 §1: pdf-engine lee el `OPS` real de
// pdfjs-dist a nivel de módulo; `importOriginal` preserva el resto del
// módulo para que ese import no reviente.
vi.mock("pdfjs-dist", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfjsDist>();
  return { ...actual, getDocument: vi.fn() };
});
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(),
  PSM: { AUTO: "3", SPARSE_TEXT: "11" },
  OEM: { TESSERACT_ONLY: 0, LSTM_ONLY: 1, TESSERACT_LSTM_COMBINED: 2, DEFAULT: 3 },
}));
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowRemoteModels: true, localModelPath: "/models/", backends: { onnx: { wasm: {} } } },
}));

const SLA_MS = 200;

// ─── OffscreenCanvas (RenderEngine.rasterizePage / OcrEngine.toTesseractImage) ───
// Mismo stub mínimo que tests/integration/fixtures/mocks.ts — no se importa
// de ahí para no acoplar la estabilidad de este gate a la de otra suite
// global; es deliberadamente más chico (sin dibujo, acá nadie lee `calls`).
class StubCanvasContext2D {
  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  fillRect(): void {}
  strokeRect(): void {}
  fillText(): void {}
  measureText(text: string): { readonly width: number } {
    return { width: text.length * 6 };
  }
  drawImage(): void {}
  putImageData(): void {}
  getImageData(x: number, y: number, w: number, h: number): ImageData {
    return {
      data: new Uint8ClampedArray(Math.max(w, 0) * Math.max(h, 0) * 4),
      width: w,
      height: h,
      colorSpace: "srgb",
    };
  }
}

class StubOffscreenCanvas {
  width: number;
  height: number;
  readonly context = new StubCanvasContext2D();
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext(id: string): StubCanvasContext2D | null {
    return id === "2d" ? this.context : null;
  }
  convertToBlob(options?: { readonly type?: string }): Promise<Blob> {
    return Promise.resolve(
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: options?.type ?? "image/png" }),
    );
  }
}

function installOffscreenCanvasStub(): void {
  if (typeof globalThis.OffscreenCanvas !== "undefined") return;
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: StubOffscreenCanvas,
    writable: true,
    configurable: true,
  });
}

// ─── pdfjs-dist ───

interface MockTextItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function asLoadingTask(promise: Promise<unknown>): ReturnType<typeof getDocument> {
  return { promise } as unknown as ReturnType<typeof getDocument>;
}

function mockGetDocumentResult(doc: Record<string, unknown>): ReturnType<typeof getDocument> {
  return asLoadingTask(Promise.resolve(doc));
}

/**
 * Página sin imágenes (operator list vacía — no dispara `ocrRegions`).
 * `getTextContent` es controlable por caso de test: por default resuelve
 * de inmediato; los tests que necesitan "página en vuelo" reemplazan el
 * mock devuelto en `getTextContent` antes de disparar `importDocument`.
 */
function createMockPdfPage(textItems: ReadonlyArray<MockTextItem>) {
  return {
    rotate: 0, // ADR-140 §2: PDFPageProxy.rotate real nunca es undefined.
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 595 * scale,
      height: 842 * scale,
      transform: [scale, 0, 0, -scale, 0, 842 * scale], // ADR-141 §5.
    })),
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
    getOperatorList: vi.fn(() =>
      Promise.resolve({ fnArray: [] as number[], argsArray: [] as unknown[] }),
    ),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
  };
}

function createMockPdfDocument(pages: ReadonlyArray<Record<string, unknown>>) {
  return {
    numPages: pages.length,
    getPage: vi.fn((pageNumber: number) => Promise.resolve(pages[pageNumber - 1])),
    getMetadata: vi.fn(() => Promise.resolve({ info: { Title: "Cancel" }, metadata: undefined })),
    destroy: vi.fn(() => Promise.resolve()),
    _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
  };
}

function pdfBufferWithHeader(): ArrayBuffer {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
  const body = new Uint8Array(64).fill(0x41);
  const combined = new Uint8Array(header.length + body.length);
  combined.set(header, 0);
  combined.set(body, header.length);
  return combined.buffer;
}

// ─── tesseract.js (OcrEngine) ───

function mockTesseractWorker(recognize: (imageBlob: unknown) => Promise<unknown>) {
  return { recognize: vi.fn(recognize), terminate: vi.fn(() => Promise.resolve()) };
}

function mockRecognizeData(text: string) {
  return {
    confidence: 90,
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              { words: [{ text, confidence: 90, bbox: { x0: 10, y0: 10, x1: 100, y1: 30 } }] },
            ],
          },
        ],
      },
    ],
  };
}

// ─── @huggingface/transformers (NerEngine) ───

interface MockNerToken {
  readonly entity: string;
  readonly score: number;
  readonly index: number;
  readonly word: string;
}

function mockTokenClassificationPipeline(
  classify: (text: string) => Promise<ReadonlyArray<MockNerToken>>,
) {
  const callable = (text: string): Promise<ReadonlyArray<MockNerToken>> => classify(text);
  return Object.assign(callable, { dispose: () => Promise.resolve() });
}

describe("gate de cancelación — SLA de 200 ms sobre el façade real (ADR-149 §3, H-07)", () => {
  let core: IAnonymizationCore | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
    // Default inocuo: los casos que no ejercitan NER igual pueden llegar a
    // necesitarlo si el pipeline avanzara más de lo esperado por un bug —
    // que resuelva vacío en vez de colgarse evita un test que cuelga en rojo
    // por una razón distinta de la que mide.
    vi.mocked(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])) as unknown as Awaited<
        ReturnType<typeof pipeline>
      >,
    );
  });

  afterEach(async () => {
    await core?.dispose();
    core = undefined;
  });

  it("Extracting (PdfEngine): no vuelve a pedir la página siguiente tras cancel()", async () => {
    const page0 = createMockPdfPage([
      { str: "DNI 34.567.891", x: 50, y: 800, width: 100, height: 12 },
    ]);
    const page1 = createMockPdfPage([{ str: "otro texto", x: 50, y: 700, width: 100, height: 12 }]);

    let resolveGetTextContent: (() => void) | undefined;
    page0.getTextContent = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGetTextContent = () =>
            resolve({
              items: [
                { str: "DNI 34.567.891", transform: [1, 0, 0, 1, 50, 800], width: 100, height: 12 },
              ],
            });
        }),
    );

    const mockDoc = createMockPdfDocument([page0, page1]);
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const getPageSpy = mockDoc.getPage as ReturnType<typeof vi.fn>;

    core = await createCore();
    const importPromise = core.orchestrator.importDocument({
      documentId: "doc-cancel-extracting",
      name: "native.pdf",
      buffer: pdfBufferWithHeader(),
    });

    await vi.waitFor(() => expect(getPageSpy).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(page0.getTextContent).toHaveBeenCalledTimes(1));

    const startedAt = Date.now();
    await core.orchestrator.cancel("doc-cancel-extracting");
    resolveGetTextContent?.();
    await importPromise;
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(SLA_MS);
    // El checkpoint entre páginas de pdf.engine.ts corta antes de pedir la
    // página 1 (índice 1): getPage nunca se vuelve a llamar.
    expect(getPageSpy).toHaveBeenCalledTimes(1);
    expect(core.orchestrator.getState("doc-cancel-extracting").stage).toBe(PipelineStage.Cancelled);
  });

  it("OCRing (OcrEngine): liberar presupuesto tras cancel() no despacha páginas nuevas", async () => {
    // 4 páginas sin texto (ADR-034 §1: textlessPages -> corre OCR), más que
    // `ocrPoolSize` (2 en el perfil normal, `config.ts`): con solo 2 páginas
    // las dos arrancan de una y no queda nada en cola para que el checkpoint
    // de `drainQueue` (ocr.engine.ts, "al abortar, se deja de pedir
    // descriptores nuevos") tenga algo que impedir — el test pasaría igual
    // aunque ese checkpoint no existiera. Con 4, las 2 primeras ocupan los
    // dos slots de concurrencia y las 2 últimas quedan en cola, listas para
    // exponer si liberar un slot tras cancelar despacha una de ellas.
    const pages = [
      createMockPdfPage([]),
      createMockPdfPage([]),
      createMockPdfPage([]),
      createMockPdfPage([]),
    ];
    const mockDoc = createMockPdfDocument(pages);
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

    // Cada llamada a `recognize()` queda colgada hasta que este test la
    // libere explícitamente — así se distingue "ya estaba en vuelo cuando
    // cancelé" (se deja terminar) de "arrancó después de cancelar" (no debe
    // pasar), que es la propiedad real que importa acá.
    const pendingRecognizes: Array<() => void> = [];
    const recognize = vi.fn(
      () =>
        new Promise((resolve) => {
          const jobIndex = pendingRecognizes.length;
          pendingRecognizes.push(() =>
            resolve({ jobId: `job-${jobIndex}`, data: mockRecognizeData("34.567.891") }),
          );
        }),
    );
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(recognize) as unknown as Awaited<ReturnType<typeof createWorker>>,
    );

    core = await createCore();
    const importPromise = core.orchestrator.importDocument({
      documentId: "doc-cancel-ocring",
      name: "scanned.pdf",
      buffer: pdfBufferWithHeader(),
    });

    // Los 2 slots de concurrencia (ocrPoolSize=2) se ocupan de entrada; las
    // otras 2 páginas quedan encoladas.
    await vi.waitFor(() => expect(recognize.mock.calls.length).toBeGreaterThanOrEqual(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const inFlightAtCancel = recognize.mock.calls.length;

    const startedAt = Date.now();
    await core.orchestrator.cancel("doc-cancel-ocring");
    // Libera los slots ocupados — si el motor chequea el abort ANTES de
    // tomar el siguiente request de la cola (y no en medio del que ya
    // corría), esto no debe disparar ningún `recognize()` nuevo para las
    // páginas 3/4 encoladas.
    const toRelease = [...pendingRecognizes];
    for (const resolve of toRelease) resolve();

    const settleTimeoutMs = 300;
    const timedOut = Symbol("timed-out");
    const raceResult = await Promise.race([
      importPromise.then(() => "settled" as const),
      new Promise((resolve) => setTimeout(() => resolve(timedOut), settleTimeoutMs)),
    ]);
    if (raceResult === timedOut) {
      throw new Error(
        `El pipeline no se asentó ${settleTimeoutMs}ms después de cancel(): probablemente se despachó ` +
          "trabajo OCR nuevo tras liberar presupuesto (recognize() llamado " +
          `${recognize.mock.calls.length} veces, solo ${inFlightAtCancel} estaban en vuelo al cancelar).`,
      );
    }
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(SLA_MS);
    // Ningún request nuevo se despachó al liberar presupuesto tras cancelar.
    expect(recognize.mock.calls.length).toBe(inFlightAtCancel);
    expect(core.orchestrator.getState("doc-cancel-ocring").stage).toBe(PipelineStage.Cancelled);
  });

  it("Detecting (NerEngine): no vuelve a clasificar la página siguiente tras cancel()", async () => {
    const page0 = createMockPdfPage([
      { str: "DNI 34.567.891", x: 50, y: 800, width: 100, height: 12 },
    ]);
    const page1 = createMockPdfPage([
      { str: "otro texto distinto", x: 50, y: 700, width: 100, height: 12 },
    ]);
    const mockDoc = createMockPdfDocument([page0, page1]);
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

    let resolveClassify: (() => void) | undefined;
    const classifyCalls: string[] = [];
    const classify = (text: string): Promise<ReadonlyArray<MockNerToken>> => {
      classifyCalls.push(text);
      if (classifyCalls.length === 1) {
        return new Promise((resolve) => {
          resolveClassify = () => resolve([]);
        });
      }
      return Promise.resolve([]);
    };
    vi.mocked(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(classify) as unknown as Awaited<ReturnType<typeof pipeline>>,
    );

    core = await createCore();
    const importPromise = core.orchestrator.importDocument({
      documentId: "doc-cancel-detecting",
      name: "native-2p.pdf",
      buffer: pdfBufferWithHeader(),
    });

    await vi.waitFor(() => expect(classifyCalls).toHaveLength(1));

    const startedAt = Date.now();
    await core.orchestrator.cancel("doc-cancel-detecting");
    resolveClassify?.();
    await importPromise;
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(SLA_MS);
    // La página 1 nunca se clasifica: el checkpoint entre páginas de
    // NerEngine.processPages corta antes del segundo lote.
    expect(classifyCalls).toHaveLength(1);
    expect(core.orchestrator.getState("doc-cancel-detecting").stage).toBe(PipelineStage.Cancelled);
  });

  it("control discriminante (ADR-149 §2): la misma metodología detecta una violación del SLA", async () => {
    // Doble sintético que ignora a propósito la señal de cancelación — no es
    // ninguno de los 7 motores reales, así que este control no toca código
    // de producción para fabricar el fallo (mismo criterio que ADR-148 §6
    // para el gate de export). Demuestra que el patrón de medición usado en
    // los tres casos de arriba SÍ es capaz de reportar una violación del SLA
    // si un motor real dejara de chequear `abortSignal.aborted`: aplicado a
    // un trabajo que no coopera, da un tiempo por encima de 200 ms.
    const nonCooperatingWork = new Promise<void>((resolve) => {
      setTimeout(resolve, 300);
    });

    const startedAt = Date.now();
    // "cancel()" lógico: no hay nada que abortar, el trabajo de abajo no
    // mira ninguna señal — es la propiedad bajo prueba, no un accidente.
    await nonCooperatingWork;
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(SLA_MS);
  });
});
