/**
 * Integración — B-5 / ADR-140 §2: "la tarea de implementación debe incluir
 * el fixture de hoja escaneada rotada y verificar el export. Si ese test
 * sale rojo, el guard se ensancha a toda página rotada."
 *
 * `PdfEngine` rechaza (`PdfPageRotatedError`) una página con `/Rotate` que
 * produce texto NATIVO (`page-rotation-guard.test.ts`, ya cubierto) — pero
 * una página ESCANEADA (sin texto nativo, `/Rotate 90`) no pasa por ese
 * guard: va entera por OCR. ADR-140 §3 afirma que ese camino es consistente
 * porque `rasterizePage`/`RenderEngine` también usan `getViewport({ scale })`
 * (que YA aplicó la rotación), así que el ráster que ve Tesseract, las
 * palabras que produce la fusión y el render `mode: "full"` (el que
 * `ExportEngine` usa por página) viven todos en el mismo marco
 * (`Page.width`/`Page.height`, ya intercambiados a 90°). Esa afirmación
 * está escrita como lectura de código, no medida — ESTE test la mide para
 * la FUSIÓN OCR y el render `full`, de punta a punta: `createCore()` real
 * (los 7 motores reales), fronteras pesadas mockeadas (`pdfjs-dist`,
 * `tesseract.js`, `@huggingface/transformers`,
 * `OffscreenCanvas`/`createImageBitmap`), mismo criterio que
 * `ocr-pdf-fusion.test.ts`.
 *
 * Lo que este test NO verifica: el PDF exportado de verdad (bytes,
 * `pdf-lib`, píxeles sobre la tinta) — el `OffscreenCanvas` de este
 * directorio no produce un PNG real, así que `ExportEngine` (que reempaqueta
 * con `pdf-lib`, que sí valida el PNG) no puede correr acá. Esa verificación
 * es el E2E de `PDF_Engine.md` §15 ítem 35
 * (`tests/e2e/scanned-rotated-export.spec.ts`), con el producto real en
 * Electron.
 *
 * Página SIN rotar: 200×300 pt (mismas dimensiones que el fixture de
 * ADR-140, Contexto §1). Con `/Rotate 90`, el viewport (y por lo tanto
 * `Page.width`/`Page.height`) se intercambia a 300×200 — si la fusión OCR o
 * el render `full` usaran el marco SIN rotar por error, o el bbox cayera
 * fuera de página, este test lo detecta (B-5a, revisión ronda B: el bbox
 * tiene que estar posicionado de forma que solo quepa en el marco rotado,
 * no en los dos — ver el comentario junto al mock de `recognize` más abajo).
 */
import { createCore, type IAnonymizationCore } from "@anonly/anonymization-core";
import { buildPageReplacements } from "@anonly/export-engine";
import {
  EngineEvents,
  EventChannel,
  PipelineStage,
  type EngineContext,
  type EntityFound,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import type * as PdfjsDist from "pdfjs-dist";
import { createWorker } from "tesseract.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  createMockPdfDocument,
  createMockPdfPage,
  getCreatedCanvasCalls,
  installCreateImageBitmapStub,
  installOffscreenCanvasStub,
  mockGetDocumentResult,
  mockRecognizeData,
  mockTesseractWorker,
  resetCreatedCanvases,
  type RecordedDrawCall,
} from "./fixtures/mocks.js";

function pdfBufferWithHeader(): ArrayBuffer {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
  const body = new Uint8Array(64).fill(0x41);
  const combined = new Uint8Array(header.length + body.length);
  combined.set(header, 0);
  combined.set(body, header.length);
  return combined.buffer;
}

// Página sin rotar 200×300 pt (fixture de ADR-140, Contexto §1). Con
// `/Rotate 90` el viewport queda 300×200.
const UNROTATED_WIDTH = 200;
const UNROTATED_HEIGHT = 300;
const ROTATED_WIDTH = UNROTATED_HEIGHT; // 300
const ROTATED_HEIGHT = UNROTATED_WIDTH; // 200

describe("integración B-5 (ADR-140 §2) — hoja escaneada con /Rotate 90, de la detección al export", () => {
  let core: IAnonymizationCore;

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
    installCreateImageBitmapStub();
    resetCreatedCanvases();
  });

  afterEach(async () => {
    await core?.dispose();
  });

  it(
    "el bbox fusionado por OCR cae dentro del marco rotado (300×200), y el render full dibuja el reemplazo en ese mismo marco",
    { timeout: 60_000 },
    async () => {
      // Página escaneada: sin texto nativo y sin imágenes — va entera por
      // `textlessPages` (ADR-034 §1), no por `ocrRegions` (mismo criterio
      // que `ocr-pdf-fusion.test.ts`: un `ocrRegion` es un camino de OCR
      // distinto — por recorte, no por página completa — y no es lo que
      // ADR-140 §3 describe).
      const scannedPage = createMockPdfPage([], [], [], 90, {
        width: UNROTATED_WIDTH,
        height: UNROTATED_HEIGHT,
      });
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument([scannedPage])),
      );

      // B-5a (revisión ronda B): el bbox de raster NO puede ser uno chico y
      // centrado — a (10,10)-(100,30) px (factor 72/300 dpi = 0.24: bbox
      // punto (2.4, 2.4, 21.6, 4.8)) entra CÓMODO tanto en el marco rotado
      // (300×200) como en el sin rotar (200×300), así que la aserción de
      // "cae dentro del marco correcto" de abajo no podía fallar aunque el
      // resto del test confundiera los dos anchos — no discriminaba nada.
      // x0=850 px -> punto x=850*0.24=204 pt: entra en el ROTADO (300 de
      // ancho) pero se pasa del SIN ROTAR (200) — si este test, o el código
      // bajo prueba, usaran el marco equivocado en cualquier punto de la
      // cadena, la aserción de rango de abajo (contra `ROTATED_WIDTH`) lo
      // detecta. Verificado a mano: con `ROTATED_WIDTH`/`ROTATED_HEIGHT`
      // temporalmente intercambiados por `UNROTATED_WIDTH`/`UNROTATED_HEIGHT`
      // en esa aserción, este test SÍ se pone rojo (204+12=216 > 200); con
      // el bbox chico original no se ponía rojo ni intercambiando las
      // constantes — ahí estaba el problema que B-5a señaló.
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData([
            { text: "34.567.891", confidence: 92, bbox: { x0: 850, y0: 10, x1: 900, y1: 30 } },
          ]),
        ),
      );

      core = await createCore({
        ner: {
          modelId: "x",
          quantization: "q8",
          confidenceThreshold: 0.7,
          batchSize: 1,
          enabled: false,
        },
      });

      const entityFoundSpy = vi.fn();
      core.bus.on(EventChannel.Regex, EngineEvents.ENTITY_FOUND, entityFoundSpy);

      await core.orchestrator.importDocument({
        documentId: "doc-scanned-rotated",
        name: "scanned-rotated.pdf",
        buffer: pdfBufferWithHeader(),
      });

      expect(core.orchestrator.getState("doc-scanned-rotated").stage).toBe(PipelineStage.Ready);

      // `Page.width`/`Page.height` (via `getPageSize`) tienen que venir
      // INTERCAMBIADOS — es la propiedad que ADR-140 §2/ADR-141 §2 exige:
      // el marco que ve el resto del pipeline es el que YA aplicó /Rotate.
      const pageSize = core.orchestrator.getPageSize("doc-scanned-rotated", 0);
      expect(pageSize).toEqual({ width: ROTATED_WIDTH, height: ROTATED_HEIGHT });

      expect(entityFoundSpy).toHaveBeenCalled();
      const found = entityFoundSpy.mock.calls
        .map(([payload]) => payload as EntityFound)
        .find((p) => p.occurrence.value === "34.567.891");
      expect(found).toBeDefined();
      const bbox = found!.occurrence.bbox;

      // El bbox fusionado, en el marco ROTADO (300×200): tiene que caer
      // ADENTRO de la página, no en el marco sin rotar (200×300) ni fuera de
      // los dos (el modo de falla que ADR-140, Contexto §1 mide: "cae fuera
      // de la página, y no se ve raro: no se ve"). Con `x≈204`, esta
      // aserción SÍ discrimina: contra `ROTATED_WIDTH` (300) pasa; contra
      // `UNROTATED_WIDTH` (200) falla (204+12=216 > 200) — verificado a mano
      // (B-5a).
      expect(bbox.x).toBeGreaterThanOrEqual(0);
      expect(bbox.y).toBeGreaterThanOrEqual(0);
      expect(bbox.x + bbox.width).toBeLessThanOrEqual(ROTATED_WIDTH);
      expect(bbox.y + bbox.height).toBeLessThanOrEqual(ROTATED_HEIGHT);
      // Factor 72/300 dpi = 0.24, escalar puro (mismo criterio que
      // `ocr-pdf-fusion.test.ts`): x0=850,y0=10,x1=900,y1=30 px ->
      // (204, 2.4, 12, 4.8) pt. Confirma que la fusión no le agregó ninguna
      // corrección de marco propia — el marco correcto ya lo trae el ráster.
      expect(bbox.x).toBeCloseTo(204, 5);
      expect(bbox.y).toBeCloseTo(2.4, 5);
      expect(bbox.width).toBeCloseTo(12, 5);
      expect(bbox.height).toBeCloseTo(4.8, 5);

      // ─── "Export": el mismo bbox, ahora pintado por RenderEngine en
      // mode:"full" (el render que ExportEngine usa para cada página, ver
      // `Orchestrator.makeRenderPageProvider.renderFull`) ───
      //
      // Llamada DIRECTA a `RenderEngine.renderPage` (mismo criterio que
      // `multi-line-fragments.test.ts`, el otro test de integración de
      // punta a punta que llega hasta el canvas) en vez de disparar
      // `EXPORT_REQUESTED` y esperar el PDF final empaquetado: el
      // `StubOffscreenCanvas.convertToBlob` de este archivo devuelve un PNG
      // de 4 bytes (solo la firma) — suficiente para el decoder de
      // `render-engine` (ADR-055 §2, que no valida contenido), pero
      // `ExportEngine` reempaqueta esos bytes con `pdf-lib`, que SÍ
      // requiere un PNG real y falla con "The input is not a PNG file!".
      // Es una limitación del stub de este archivo, no del motor bajo
      // prueba — `RenderEngine.renderPage(mode:"full")` es exactamente la
      // pieza que ADR-140 §3 necesita medir (el mismo raster que el export
      // empaqueta), así que sigue siendo la propiedad real.
      const groups = core.engines.grouping.getSnapshot("doc-scanned-rotated").groups;
      const replacements = buildPageReplacements(0, groups);
      expect(replacements.length).toBeGreaterThan(0);

      const fullScale = 2.08;
      const renderCtx: EngineContext = {
        bus: core.bus,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        cache: {
          get: <T>() => undefined as T | undefined,
          set: () => {},
          delete: () => {},
          clear: () => {},
          size: 0,
          bytes: 0,
        },
        abortSignal: new AbortController().signal,
        config: {
          workerPool: {
            pdfPoolSize: 2,
            ocrPoolSize: 1,
            nerPoolSize: 1,
            renderPoolSize: 2,
            maxQueuePerPool: { pdf: 32, ocr: 8, ner: 8, render: 32 },
            timeouts: {
              "pdf-parse": 30000,
              "ocr-page": 60000,
              "ocr-orient": 60000,
              "ner-page": 20000,
              "render-page": 10000,
              "export-page": 30000,
            },
            maxRetries: {
              "pdf-parse": 1,
              "ocr-page": 2,
              "ocr-orient": 0,
              "ner-page": 1,
              "render-page": 1,
              "export-page": 1,
            },
            baseRetryDelayMs: 250,
            maxRetryDelayMs: 2000,
            cancelSlaMs: 200,
            idleDisposeMs: 60000,
            nerIdleDisposeMs: 15000,
          },
          pdf: { maxPageCount: 10000 },
          ner: {
            modelId: "x",
            quantization: "q8",
            confidenceThreshold: 0.7,
            batchSize: 1,
            enabled: false,
          },
          ocr: { languages: ["spa", "eng"], dpi: 300, maxLiveImageBytes: 128 * 1024 * 1024 },
          grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
          render: { previewScale: 1, fullScale, jpegQuality: 0.85, cachePages: 16 },
          export: { defaultDpi: 150, defaultImageFormat: "jpeg", defaultJpegQuality: 0.85 },
        },
      };

      resetCreatedCanvases();
      await core.engines.render.renderPage(
        {
          documentId: "doc-scanned-rotated",
          pageIndex: 0,
          kind: "anonymized",
          mode: "full",
          replacements,
          imageFormat: "png",
        },
        renderCtx,
      );

      // El render crea más de un `OffscreenCanvas` (fragmentos rotados 90/270
      // de `expandReplacementToUnits` usan canvases propios para dibujar y
      // componer el token girado) — el que importa es el de la página, el
      // único con `fillRect`/`fillText`; los demás quedan vacíos.
      const calls = getCreatedCanvasCalls().find((c) => c.some((call) => call.op === "fillRect"));
      expect(calls).toBeDefined();
      const fillRects = (calls ?? []).filter(
        (c): c is RecordedDrawCall & { readonly op: "fillRect" } => c.op === "fillRect",
      );
      expect(fillRects.length).toBeGreaterThan(0);

      // El primer fillRect es el fondo del reemplazo SIN rotación —el mismo
      // `replacements[0]`, que coincide con el `bbox` detectado arriba— los
      // otros cuatro son los fragmentos rotados 90/270 que Grouping fusionó
      // en el mismo grupo (mismo valor detectado, más de una vez).
      const [x, y, width, height] = fillRects[0]!.args as [number, number, number, number];
      // El rectángulo pintado tiene que caer DENTRO del canvas de la página
      // rotada a escala (300×2.08, 200×2.08) — si el export hubiera usado el
      // marco sin rotar, o si la composición de escala/rotación fuera
      // distinta entre el detector y el pintor, este rectángulo se saldría
      // del canvas o aparecería en otro cuadrante. Con `x≈424,32`
      // (204×2,08), esta aserción también discrimina: contra el ancho
      // rotado × escala (624) pasa; contra el sin rotar × escala (416)
      // falla (449,28 > 416).
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(ROTATED_WIDTH * fullScale + 1e-6);
      expect(y + height).toBeLessThanOrEqual(ROTATED_HEIGHT * fullScale + 1e-6);
      // Mismo origen que el bbox detectado (204, 2.4 pt), escalado por
      // `fullScale` — la propiedad de punta a punta que ESTE test mide: la
      // fusión OCR y el render `full` (`RenderEngine.renderPage`) usan el
      // mismo marco rotado. El PDF exportado de verdad —bytes, `pdf-lib`,
      // píxeles sobre la tinta— lo verifica el E2E de
      // `PDF_Engine.md` §15 ítem 35 (`tests/e2e/scanned-rotated-export.spec.ts`),
      // no este test: acá `convertToBlob` devuelve un PNG de 4 bytes (ver
      // el comentario más arriba), insuficiente para `pdf-lib`.
      expect(x).toBeCloseTo(bbox.x * fullScale, 1);
      expect(y).toBeCloseTo(bbox.y * fullScale, 1);
    },
  );
});
