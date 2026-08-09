import {
  AnnotationKind,
  EngineEvents,
  EventChannel,
  ReplacementMode,
  type EngineContext,
  type LoadDocumentPayload,
  type RasterizePagePayload,
  type RenderLegendPayload,
  type RenderPagePayload,
  type UnloadDocumentPayload,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `GlobalWorkerOptions` (además de `getDocument`): el describe de ADR-059 §5
// más abajo importa dinámicamente `../worker/entry.js`, que lo toca en su
// side-effect de módulo (`GlobalWorkerOptions.workerSrc = pdfWorkerUrl`,
// mismo mock que `worker-entry.test.ts`). El resto de este archivo solo usa
// `getDocument`, así que agregarlo acá no cambia ningún test existente.
vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: "" } }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "mock-render-worker-url" }));

import { RenderEngine } from "../render.engine.js";
import { calibrateLineFont } from "../worker/kernel.js";

import {
  createEngineContext,
  createEngineContextWithRealBus,
  createMockConfig,
  createMockPage,
  createMockPdfDocument,
  createRenderPageInput,
  createResolvedRenderBroadcastPool,
  createResolvedRenderDispatchPool,
  createValidBuffer,
  getCreatedCanvases,
  installOffscreenCanvasStub,
  makeAnnotation,
  makeLineRepaintScenario,
  makeMarkerLegendRow,
  makeMarkerLegendRows,
  makeReplacement,
  mockGetDocumentResult,
  readProtectedPdfFixtureBuffer,
  resetCreatedCanvases,
  type DrawCall,
  type ResolvedRenderPool,
} from "./fixtures/test-helpers.js";

describe("RenderEngine — unit tests", () => {
  let engine: RenderEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
    resetCreatedCanvases();
    engine = new RenderEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("original kind renders no replacements", async () => {
    const docId = "doc-original-only";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, kind: "original", mode: "preview" }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    expect(canvas).toBeDefined();
    // Sin annotations: el único call registrado es getImageData (ningún fill/stroke/texto).
    const drawOps = canvas!.calls.filter((c) => c.op !== "getImageData");
    expect(drawOps).toHaveLength(0);
  });

  it("highlight border on original kind", async () => {
    const docId = "doc-highlight";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "original",
        mode: "preview",
        annotations: [
          makeAnnotation({
            kind: AnnotationKind.Highlight,
            bbox: { x: 5, y: 6, width: 40, height: 12 },
          }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const strokeCalls = canvas!.calls.filter((c) => c.op === "strokeRect");
    expect(strokeCalls).toHaveLength(1);
    expect(strokeCalls[0]!.args).toEqual([5, 6, 40, 12]);
    expect(strokeCalls[0]!.strokeStyle).toBe("#2563eb");
  });

  it("LRU cache evicts oldest when full", async () => {
    const docId = "doc-lru";
    const mockDoc = createMockPdfDocument({ pageCount: 3 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const smallCacheCtx = createEngineContext({
      config: createMockConfig({
        render: { previewScale: 1, fullScale: 2.08, jpegQuality: 0.85, cachePages: 2 },
      }),
    });
    await engine.init(smallCacheCtx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0 }),
      smallCacheCtx,
    );
    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 1 }),
      smallCacheCtx,
    );
    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 2 }),
      smallCacheCtx,
    );

    expect(engine["cache"].size).toBe(2);

    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    const callsBefore = getPageSpy.mock.calls.length;

    // La página 0 fue evictada (LRU, cachePages=2): re-renderizarla dispara un getPage nuevo.
    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0 }),
      smallCacheCtx,
    );
    expect(getPageSpy.mock.calls.length).toBe(callsBefore + 1);
  });

  it("cache hit skips render", async () => {
    const docId = "doc-cache-hit";
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const input = createRenderPageInput({ documentId: docId, pageIndex: 0 });
    const first = await engine.renderPage(input, ctx);
    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    expect(getPageSpy).toHaveBeenCalledTimes(1);

    const second = await engine.renderPage(input, ctx);
    expect(getPageSpy).toHaveBeenCalledTimes(1); // sin nueva llamada: cache hit
    // ADR-043: el cache interno guarda una entrada propia (`InternalCacheEntry`,
    // siempre con `encoded`) distinta de `RenderPageOutput` (público, `encoded`
    // opcional según `mode` — Render_Engine.md §10); un hit proyecta una copia
    // nueva (`toPublicOutput`) en cada llamada, así que ya no es la MISMA
    // referencia (antes de este PR el cache guardaba el propio
    // `RenderPageOutput` devuelto). Se verifica igualdad estructural en su
    // lugar — el invariante real de este test ("cache hit = sin re-render")
    // ya lo cubre la aserción de `getPageSpy` de arriba.
    expect(second).toStrictEqual(first);
  });

  it("cache key is sensitive to bbox: replacements equal in every field but bbox do not share a cache entry", async () => {
    const docId = "doc-cache-bbox";
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const baseInput = {
      documentId: docId,
      pageIndex: 0,
      kind: "anonymized" as const,
      mode: "preview" as const,
    };
    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;

    await engine.renderPage(
      createRenderPageInput({
        ...baseInput,
        replacements: [makeReplacement({ bbox: { x: 10, y: 20, width: 100, height: 14 } })],
      }),
      ctx,
    );
    expect(getPageSpy).toHaveBeenCalledTimes(1);

    // Mismo groupId/occurrenceId/mode/replacementValue, solo cambia bbox.width:
    // sin este fix, hashPageContent los ve como el mismo contenido y el
    // segundo render sería un cache hit que devuelve el raster del primero.
    await engine.renderPage(
      createRenderPageInput({
        ...baseInput,
        replacements: [makeReplacement({ bbox: { x: 10, y: 20, width: 200, height: 14 } })],
      }),
      ctx,
    );
    expect(getPageSpy).toHaveBeenCalledTimes(2);
    expect(engine["cache"].size).toBe(2);
  });

  it("renderPages retries a page that fails once and continues after exhausting retries", async () => {
    const docId = "doc-retry";
    const mockDoc = createMockPdfDocument({
      pageCount: 1,
      pageFactory: () => ({
        getViewport: vi.fn(() => ({ width: 100, height: 100 })),
        render: vi.fn(() => ({ promise: Promise.reject(new Error("render boom")) })),
      }),
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    const outputs = await engine.renderPages(
      [
        createRenderPageInput({
          documentId: docId,
          pageIndex: 0,
          kind: "original",
          mode: "preview",
        }),
      ],
      ctx,
    );

    expect(outputs).toHaveLength(0);
    // MAX_RETRIES=1 → 2 intentos totales.
    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    expect(getPageSpy).toHaveBeenCalledTimes(2);
    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Render,
      EngineEvents.PREVIEW_PAGE_FAILED,
      expect.objectContaining({ documentId: docId, pageIndex: 0 }),
    );
    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Render,
      EngineEvents.RENDER_FINISHED,
      expect.objectContaining({ documentId: docId, pageIndices: [] }),
    );
  });

  it("renderPage with kind=anonymized paints redact/mask/placeholder/synthetic replacements", async () => {
    const docId = "doc-modes";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [
          makeReplacement({
            groupId: "g1",
            occurrenceId: "o1",
            mode: ReplacementMode.Placeholder,
            replacementValue: "[DNI 01]",
          }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    expect(fillTextCalls).toHaveLength(1);
    expect(fillTextCalls[0]!.args[0]).toBe("[DNI 01]");
  });

  // ─── ADR-058 §1 (Hito 10.5, PR 1): shrink-to-fit ───
  //
  // Test de propiedad exigido por Render_Engine.md §14 y ADR-058 §10 — "es la
  // aserción que representa la garantía de ADR-058 §1 y no puede quedar en
  // amarillo". Cubre las dos mitades de la cascada de una sola vez: (a) el
  // shrink-to-fit reduce el tamaño de fuente cuando hace falta, y (b)
  // `fillText` recibe siempre `maxWidth = bbox.width`. `DrawCall.drawnWidth`
  // (fixtures/test-helpers.ts) modela el clamp real que el spec de Canvas 2D
  // garantiza para `fillText(..., maxWidth)` — el ancho REALMENTE dibujado
  // nunca puede superar `maxWidth`, así que esta aserción no exime ningún
  // caso (ni siquiera cuando ni el piso de 8px alcanza): si `maxWidth`
  // dejara de viajar, `drawnWidth` volvería a ser el ancho natural
  // (potencialmente mayor a `width`) y el test fallaría de verdad.
  it("replacement text never exceeds its available width", async () => {
    const docId = "doc-shrink-property";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(
        createMockPdfDocument({
          pageCount: 1,
          pageFactory: () => createMockPage({ width: 2000, height: 2000 }),
        }),
      ),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const modes = [ReplacementMode.Mask, ReplacementMode.Synthetic, ReplacementMode.Placeholder];
    const tokenLengths = [1, 2, 4, 8, 16, 32, 64];
    const boxWidths = [1, 4, 10, 25, 60, 150, 400];
    const boxHeights = [3, 6, 10, 16, 24, 40];

    let combinationsChecked = 0;
    for (const mode of modes) {
      for (const length of tokenLengths) {
        for (const width of boxWidths) {
          for (const height of boxHeights) {
            resetCreatedCanvases();
            const text = "X".repeat(length);
            // `hashPageContent` (render.engine.ts) solo hashea
            // `groupId|occurrenceId|mode|replacementValue` — NO el `bbox`.
            // Sin un id único por combinación, dos combos con el mismo
            // (mode, length) pero distinto width/height colisionarían en el
            // cache LRU y el segundo saltaría el render (canvas vacío).
            const comboId = `${String(mode)}-${length}-${width}-${height}`;

            await engine.renderPage(
              createRenderPageInput({
                documentId: docId,
                pageIndex: 0,
                kind: "anonymized",
                mode: "preview",
                replacements: [
                  makeReplacement({
                    groupId: `g-${comboId}`,
                    occurrenceId: `o-${comboId}`,
                    mode,
                    replacementValue: text,
                    bbox: { x: 0, y: 0, width, height },
                  }),
                ],
              }),
              ctx,
            );

            const [canvas] = getCreatedCanvases();
            const fillTextCall = canvas!.calls.find((c) => c.op === "fillText");
            expect(fillTextCall).toBeDefined();
            // La garantía completa: el ancho REALMENTE dibujado nunca excede
            // el disponible, sin excepción para el piso de 8px.
            expect(fillTextCall!.drawnWidth).toBeLessThanOrEqual(width);
            // Y la red de seguridad viajó con el valor correcto (si esto
            // fallara, `drawnWidth` de arriba dejaría de ser una garantía real).
            expect(fillTextCall!.args[3]).toBe(width);
            combinationsChecked += 1;
          }
        }
      }
    }

    // Guard contra un refactor que vacíe los arrays de arriba y deje esta
    // aserción pasando en verde sin haber comprobado ninguna combinación.
    expect(combinationsChecked).toBeGreaterThan(500);
  });

  // ─── Consumo de eventos del bus (checklist §15 item 14) ───
  // El bus mockeado (createEngineContext) no dispara handlers; se usa el bus
  // real (@anonly/event-system) para ejercitar la ruta de consumo end-to-end.

  it("RENDER_REQUESTED triggers a render for the requested pages", async () => {
    const docId = "doc-render-requested";
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
      kind: "original",
    });

    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => {
      expect(getPageSpy).toHaveBeenCalled();
    });
  });

  // ─── ADR-034 §3 ───

  it("preview mode output has no encoded field", async () => {
    const docId = "doc-preview-no-encoded";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const output = await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, kind: "original", mode: "preview" }),
      ctx,
    );

    expect(output.encoded).toBeUndefined();
  });

  // ─── ADR-037 §3 (Hito 10): cache por escala + límite por bytes ───

  it("cache key includes scale; different scales coexist", async () => {
    const docId = "doc-scale-cache";
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());
    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;

    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, scale: 1 }),
      ctx,
    );
    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, scale: 2 }),
      ctx,
    );

    // Misma página/kind/mode, distinta escala: dos entradas separadas del LRU
    // (ADR-037 §3), no un cache hit cruzado.
    expect(engine["cache"].size).toBe(2);
    expect(getPageSpy).toHaveBeenCalledTimes(2);

    // Re-renderizar a escala 1 es cache hit: sin nueva llamada a getPage.
    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, scale: 1 }),
      ctx,
    );
    expect(getPageSpy).toHaveBeenCalledTimes(2);
  });

  it("cache evicts by PREVIEW_CACHE_MAX_BYTES in addition to cachePages", async () => {
    const docId = "doc-cache-bytes";
    const bigDimension = 5000; // 5000*5000*4 bytes = 100.000.000 bytes (~95.4 MiB) por página.
    const mockDoc = createMockPdfDocument({
      pageCount: 3,
      pageFactory: () => createMockPage({ width: bigDimension, height: bigDimension }),
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    // cachePages generoso: el único límite que debe disparar la eviction acá
    // es PREVIEW_CACHE_MAX_BYTES (200 MiB), no el límite por items.
    const largeCachePagesCtx = createEngineContext({
      config: createMockConfig({
        render: { previewScale: 1, fullScale: 2.08, jpegQuality: 0.85, cachePages: 1000 },
      }),
    });
    await engine.init(largeCachePagesCtx);
    await engine.loadDocument(docId, createValidBuffer());
    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;

    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0 }),
      largeCachePagesCtx,
    );
    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 1 }),
      largeCachePagesCtx,
    );
    // 2 páginas ≈ 190.7 MiB acumulados: todavía por debajo del límite de 200 MiB.
    expect(engine["cache"].size).toBe(2);

    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 2 }),
      largeCachePagesCtx,
    );

    // 3 páginas ≈ 286 MiB > 200 MiB: se evictó la entrada más vieja (página 0),
    // dejando 2 páginas (~190.7 MiB), que ya no excede el límite.
    expect(engine["cache"].size).toBe(2);

    const callsBefore = getPageSpy.mock.calls.length;
    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0 }),
      largeCachePagesCtx,
    );
    // La página 0 ya no estaba cacheada (evictada por bytes): nueva llamada a getPage.
    expect(getPageSpy.mock.calls.length).toBe(callsBefore + 1);
  });

  // ─── ADR-050 §2 + ADR-043 §5 (Hito 10, PR17.4): re-priming con password ───

  it("re-primed worker reloads a password-protected document", async () => {
    // El host retiene el password junto a `{ buffer, pageCount }`
    // (`RetainedDocument`, ADR-050 §2) únicamente para re-primear workers
    // nuevos/reemplazados (`reprimeWorkers`, ADR-043 §5) — el kernel nunca lo
    // ve dos veces (solo en la carga original). Se inyecta un pool con
    // `broadcast` espiado (estructural — el tipo interno `RenderJobPool` no
    // se exporta desde este paquete, mismo patrón que `IMMEDIATE_POOL` en
    // render.engine.ts) para observar el `LoadDocumentPayload` exacto que
    // `reprimeWorkers` reenvía a un worker nuevo/reemplazado.
    const docId = "doc-reprime-password";
    const broadcastPayloads: unknown[] = [];
    const spyPool = {
      dispatch: <T>(params: { readonly run: () => Promise<T> }): Promise<T> => params.run(),
      broadcast: async <T>(payload: unknown, run: () => Promise<T>): Promise<ReadonlyArray<T>> => {
        broadcastPayloads.push(payload);
        return [await run()];
      },
    };
    const pooledEngine = new RenderEngine(spyPool);
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 10 })),
    );
    await pooledEngine.init(ctx);

    const buffer = readProtectedPdfFixtureBuffer();
    await pooledEngine.loadDocument(docId, buffer, "test1234");
    // Descarta el broadcast de la carga original: solo interesa el que
    // dispara reprimeWorkers.
    broadcastPayloads.length = 0;

    await pooledEngine.reprimeWorkers();

    expect(broadcastPayloads).toHaveLength(1);
    expect(broadcastPayloads[0]).toEqual(
      expect.objectContaining({ documentId: docId, buffer, password: "test1234" }),
    );

    await pooledEngine.dispose();
  });

  // ─── ADR-055 §5 — tests de sobre, obligatorios ───
  //
  // A diferencia de `spyPool` (arriba, que delega en `params.run()`/el `run`
  // de `broadcast()` — el camino in-process real), `createResolvedRenderDispatchPool`/
  // `createResolvedRenderBroadcastPool` (fixtures/test-helpers.ts) IGNORAN el
  // método bajo prueba y resuelven directo con el valor dado — son los
  // únicos fakes de este paquete que cruzan de verdad el sobre
  // `COMPLETED.result` (ADR-055 Contexto §2). Sin ellos, ningún test
  // ejercita `decodeKernelRenderResult`/`decodeRasterizeResult`/
  // `decodeLoadDocumentResult`.
  describe("Sobre del dispatch/broadcast (ADR-055)", () => {
    beforeEach(() => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument({ pageCount: 3 })),
      );
    });

    it("renderPage decodes the bare COMPLETED.result posted by worker/entry.ts for render-page (no envelope, ADR-055 §2)", async () => {
      // worker/entry.ts:163 postea `result` pelado (el KernelRenderResult
      // que produce kernelRenderPage tal cual, sin sobre adicional). Este
      // fake reproduce exactamente eso.
      const remoteImageData = {
        data: new Uint8ClampedArray(16),
        width: 2,
        height: 2,
        colorSpace: "srgb",
      };
      const remoteEncoded = {
        bytes: new Uint8Array([1, 2, 3]).buffer,
        format: "png",
        widthPx: 2,
        heightPx: 2,
      };
      const pool = createResolvedRenderDispatchPool({
        imageData: remoteImageData,
        encoded: remoteEncoded,
      });
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);
      await pooledEngine.loadDocument("doc-envelope-render", createValidBuffer());

      const output = await pooledEngine.renderPage(
        createRenderPageInput({ documentId: "doc-envelope-render", pageIndex: 0, mode: "full" }),
        ctx,
      );

      expect(output.imageData).toBe(remoteImageData);
      expect(output.encoded).toBe(remoteEncoded);

      await pooledEngine.dispose();
    });

    it("renderPage decodes the identical in-process shape (parity: render-page has no envelope, ADR-055 §2)", async () => {
      // En NER el sobre remoto (`{ spans }`) y la forma in-process son DOS
      // formas distintas que el decoder tiene que aceptar. En Render (como
      // en OCR) no hay tal distinción: `kernelRenderPage` (invocado directo
      // por IMMEDIATE_POOL cuando no hay pool real) y `worker/entry.ts`
      // (con pool real) producen la MISMA forma `KernelRenderResult`. Este
      // test usa el mismo fake con un valor "in-process" — bit a bit la
      // misma forma que el test de arriba — para demostrar explícitamente
      // esa paridad: el decoder no tiene (ni necesita) una rama especial
      // para un segundo caso.
      const inProcessImageData = {
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1,
        colorSpace: "srgb",
      };
      const inProcessEncoded = {
        bytes: new Uint8Array([9]).buffer,
        format: "jpeg",
        widthPx: 1,
        heightPx: 1,
      };
      const pool = createResolvedRenderDispatchPool({
        imageData: inProcessImageData,
        encoded: inProcessEncoded,
      });
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);
      await pooledEngine.loadDocument("doc-envelope-parity-render", createValidBuffer());

      const output = await pooledEngine.renderPage(
        createRenderPageInput({
          documentId: "doc-envelope-parity-render",
          pageIndex: 0,
          mode: "full",
        }),
        ctx,
      );

      expect(output.imageData).toBe(inProcessImageData);
      expect(output.encoded).toBe(inProcessEncoded);

      await pooledEngine.dispose();
    });

    it("rasterizePage decodes the bare COMPLETED.result posted by worker/entry.ts for rasterize (ImageData pelado, ADR-055 §2)", async () => {
      const remoteImageData = {
        data: new Uint8ClampedArray(8),
        width: 2,
        height: 1,
        colorSpace: "srgb",
      };
      const pool = createResolvedRenderDispatchPool(remoteImageData);
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);
      await pooledEngine.loadDocument("doc-envelope-rasterize", createValidBuffer());

      const imageData = await pooledEngine.rasterizePage("doc-envelope-rasterize", 0, 1, ctx);

      expect(imageData).toBe(remoteImageData);

      await pooledEngine.dispose();
    });

    it("rasterizePage decodes the identical in-process shape (parity, ADR-055 §2)", async () => {
      // Mismo razonamiento que el par de tests de renderPage arriba:
      // kernelRasterizePage produce la misma forma ImageData pelada en
      // ambos caminos.
      const inProcessImageData = {
        data: new Uint8ClampedArray(8),
        width: 2,
        height: 1,
        colorSpace: "srgb",
      };
      const pool = createResolvedRenderDispatchPool(inProcessImageData);
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);
      await pooledEngine.loadDocument("doc-envelope-parity-rasterize", createValidBuffer());

      const imageData = await pooledEngine.rasterizePage(
        "doc-envelope-parity-rasterize",
        0,
        1,
        ctx,
      );

      expect(imageData).toBe(inProcessImageData);

      await pooledEngine.dispose();
    });

    it("loadDocument decodes the bare COMPLETED.result posted by worker/entry.ts for load-document ({ pageCount }, ADR-055 §2)", async () => {
      // worker/entry.ts postea el `{ pageCount }` de kernelLoadDocument
      // pelado. broadcast() resuelve un array con un elemento por worker
      // "vivo" simulado — acá, uno solo.
      const pool = createResolvedRenderBroadcastPool([{ pageCount: 7 }]);
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);

      await pooledEngine.loadDocument("doc-envelope-load", createValidBuffer());

      expect(pooledEngine["documents"].get("doc-envelope-load")?.pageCount).toBe(7);

      await pooledEngine.dispose();
    });

    it("loadDocument decodes the identical in-process shape (parity, ADR-055 §2)", async () => {
      // Mismo razonamiento: kernelLoadDocument produce la misma forma
      // { pageCount } en ambos caminos — un segundo valor, misma forma.
      const pool = createResolvedRenderBroadcastPool([{ pageCount: 12 }]);
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);

      await pooledEngine.loadDocument("doc-envelope-parity-load", createValidBuffer());

      expect(pooledEngine["documents"].get("doc-envelope-parity-load")?.pageCount).toBe(12);

      await pooledEngine.dispose();
    });

    it("unloadDocument completes regardless of what broadcast resolves — the result is never consumed (ADR-055, operación 4/4)", async () => {
      // A diferencia de las tres operaciones de arriba, unloadDocument no
      // tiene decoder (ver el comentario de `unloadDocument` en
      // render.engine.ts): el `.then(() => {...})` que consume el resultado
      // de broadcast() no liga ningún parámetro, así que ninguna forma —
      // incluida basura evidente como un string suelto — puede hacerlo
      // fallar. Este pool discrimina por forma del payload (mismo criterio
      // que `worker/entry.ts#dispatchKernel`: "buffer" in payload → carga)
      // para que loadDocument, arriba en la misma prueba, siga funcionando
      // normalmente y unloadDocument reciba la basura.
      const pool: ResolvedRenderPool = {
        dispatch: (params) => params.run(),
        broadcast: (payload) => {
          const isLoad = typeof payload === "object" && payload !== null && "buffer" in payload;
          return Promise.resolve(isLoad ? [{ pageCount: 3 }] : ["basura-no-reconocida"]);
        },
      };
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);
      await pooledEngine.loadDocument("doc-unload-garbage", createValidBuffer());

      await expect(pooledEngine.unloadDocument("doc-unload-garbage")).resolves.toBeUndefined();
      expect(pooledEngine["documents"].has("doc-unload-garbage")).toBe(false);

      await pooledEngine.dispose();
    });
  });

  // ─── ADR-058 §2-§6 (Hito 10.5, PR 5): repintado de línea por calibración ───
  describe("repintado de línea por calibración (ADR-058 §2-§6)", () => {
    it("line repaint does not trigger when the token fits (current path preserved)", async () => {
      // Reemplazo con una caja ANCHA (el token entra a tamaño natural) pero
      // con `lineWords` que, si el repintado se evaluara, cumplirían las
      // cinco condiciones de activación (mismas vecinas que un escenario
      // exitoso, ver `makeLineRepaintScenario`). El punto del test: aunque
      // las condiciones estarían disponibles, el repintado NUNCA se evalúa
      // porque el token entra — "si el token entra, no se repinta nada"
      // (ADR-058 §2). El camino dibujado debe ser bit a bit el de antes de
      // este PR: rectángulo blanco fijo, texto CENTRADO al tamaño natural,
      // sin ninguna de las vecinas de `lineWords` dibujada.
      const docId = "doc-repaint-fits";
      const scenario = makeLineRepaintScenario({
        replacement: { bbox: { x: 20, y: 10, width: 300, height: 14 } },
      });
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument({
            pageCount: 1,
            pageFactory: () =>
              createMockPage({ width: scenario.pageWidth, height: scenario.pageHeight }),
          }),
        ),
      );
      await engine.init(ctx);
      await engine.loadDocument(docId, createValidBuffer());

      await engine.renderPage(
        createRenderPageInput({
          documentId: docId,
          pageIndex: 0,
          kind: "anonymized",
          mode: "preview",
          replacements: [scenario.replacement],
          lineWords: scenario.lineWords,
        }),
        ctx,
      );

      const [canvas] = getCreatedCanvases();
      const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
      // Un solo fillText (el token, centrado) — ninguna vecina se dibuja.
      expect(fillTextCalls).toHaveLength(1);
      expect(fillTextCalls[0]!.args[0]).toBe(scenario.replacement.replacementValue);
      expect(fillTextCalls[0]!.args).toEqual([
        scenario.replacement.replacementValue,
        scenario.replacement.bbox.x + scenario.replacement.bbox.width / 2,
        scenario.replacement.bbox.y + scenario.replacement.bbox.height / 2,
        scenario.replacement.bbox.width,
      ]);
      // Fondo/texto de los colores FIJOS de siempre — no los muestreados
      // (que solo entran en juego cuando el repintado sí se ejecuta).
      const fillRectCalls = canvas!.calls.filter((c) => c.op === "fillRect");
      expect(fillRectCalls).toHaveLength(1);
      expect(fillRectCalls[0]!.fillStyle).toBe("#ffffff");
      expect(fillTextCalls[0]!.fillStyle).toBe("#000000");
      // Ninguna llamada a getImageData más allá de la captura final del
      // raster: el muestreo de color de ADR-058 §4 nunca se ejecutó.
      expect(canvas!.calls.filter((c) => c.op === "getImageData")).toHaveLength(1);
    });

    it("token that does not fit with lineWords absent falls back without error", async () => {
      // Mismo espíritu que los tests de "shrink-to-fit" de ADR-058 §1 (PR1),
      // pero nombrado explícitamente por el spec (Render_Engine.md §14) para
      // documentar el contrato de ADR-058 §5: `lineWords` ausente nunca es un
      // error, el kernel cae al camino existente sin lanzar ni loguear nada
      // raro. Se verifica además que el muestreo de color de ADR-058 §4
      // jamás se dispara (cero `getImageData` extra: `tryRepaintLine` falla
      // la condición (a) antes de tocar el canvas).
      const docId = "doc-repaint-no-linewords";
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
      );
      await engine.init(ctx);
      await engine.loadDocument(docId, createValidBuffer());

      await expect(
        engine.renderPage(
          createRenderPageInput({
            documentId: docId,
            pageIndex: 0,
            kind: "anonymized",
            mode: "preview",
            replacements: [
              makeReplacement({
                mode: ReplacementMode.Placeholder,
                replacementValue: "[PERSONA MUY LARGA 01]",
                bbox: { x: 5, y: 5, width: 18, height: 14 },
              }),
            ],
            // `lineWords` deliberadamente ausente.
          }),
          ctx,
        ),
      ).resolves.toBeDefined();

      const [canvas] = getCreatedCanvases();
      const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
      expect(fillTextCalls).toHaveLength(1);
      // Camino existente de PR1: `maxWidth` = bbox.width, nunca se derrama.
      expect(fillTextCalls[0]!.args[3]).toBe(18);
      expect(fillTextCalls[0]!.drawnWidth).toBeLessThanOrEqual(18);
      // Un único getImageData (la captura final del raster) — el muestreo de
      // color de ADR-058 §4 nunca se ejecutó.
      expect(canvas!.calls.filter((c) => c.op === "getImageData")).toHaveLength(1);
    });

    it("calibration picks the lowest-error candidate over a known set of widths", () => {
      // Test puro sobre `calibrateLineFont` (exportada de `worker/kernel.js`
      // solo para test directo, mismo criterio que `fitReplacementFont` —
      // ADR-058 §3): NO pasa por `OffscreenCanvas` ni por `RenderEngine`. La
      // medición inyectada da un ancho DISTINTO por cada combinación de
      // familia/peso/estilo (a diferencia del stub de canvas compartido, que
      // ignora la familia) para probar que la búsqueda de verdad compara los
      // 12 candidatos y no solo devuelve el primero.
      const familyRatio = (font: string): number => {
        if (font.includes("monospace")) return 0.62;
        if (font.includes("sans-serif")) return 0.55;
        return 0.5; // serif
      };
      const measureByFont = (font: string, text: string): number => {
        const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(font);
        const size = sizeMatch ? Number(sizeMatch[1]) : 0;
        let ratio = familyRatio(font);
        if (font.includes("bold ")) ratio += 0.05;
        if (font.startsWith("italic ")) ratio += 0.02;
        return text.length * size * ratio;
      };

      // Candidato objetivo: monospace/bold/normal → "bold 10px monospace",
      // ratio 0.67 — no colisiona con ningún otro de los 12 (ver el detalle
      // completo del cálculo en el reporte final del PR).
      const targetFont = "bold 10px monospace";
      const samples = ["Garcia", "vive", "en"].map((text) => ({
        text,
        actualWidth: measureByFont(targetFont, text),
      }));

      const result = calibrateLineFont(measureByFont, samples, 10);

      expect(result.font).toBe(targetFont);
      expect(result.errorRatio).toBe(0);
    });

    it("shift is uniform: relative distances between repainted words are preserved", async () => {
      const docId = "doc-repaint-uniform-shift";
      const scenario = makeLineRepaintScenario();
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument({
            pageCount: 1,
            pageFactory: () =>
              createMockPage({ width: scenario.pageWidth, height: scenario.pageHeight }),
          }),
        ),
      );
      await engine.init(ctx);
      await engine.loadDocument(docId, createValidBuffer());

      await engine.renderPage(
        createRenderPageInput({
          documentId: docId,
          pageIndex: 0,
          kind: "anonymized",
          mode: "preview",
          replacements: [scenario.replacement],
          lineWords: scenario.lineWords,
        }),
        ctx,
      );

      const [canvas] = getCreatedCanvases();
      const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
      // Token + dos vecinas = 3 fillText (el repintado sí se activó).
      expect(fillTextCalls).toHaveLength(3);

      const tokenCall = fillTextCalls.find(
        (c) => c.args[0] === scenario.replacement.replacementValue,
      );
      const garciaCall = fillTextCalls.find((c) => c.args[0] === "Garcia");
      const viveCall = fillTextCalls.find((c) => c.args[0] === "vive");
      expect(tokenCall).toBeDefined();
      expect(garciaCall).toBeDefined();
      expect(viveCall).toBeDefined();

      const [garciaWord, viveWord] = scenario.lineWords;

      // El token se dibuja en bbox.x exactamente — no lleva delta, es el ancla
      // (ADR-058 §2 paso 2: "dibujar el token en bbox.x").
      expect(tokenCall!.args[1]).toBe(scenario.replacement.bbox.x);

      // El delta uniforme se observa en el desplazamiento de CUALQUIER vecina
      // respecto de su x original — acá se deriva de "Garcia" y se verifica
      // que "vive" se desplazó exactamente lo mismo (paso 3: "desplazada por
      // el delta", el mismo para todas).
      const delta = (garciaCall!.args[1] as number) - garciaWord!.bbox.x;
      expect((viveCall!.args[1] as number) - viveWord!.bbox.x).toBeCloseTo(delta, 6);

      // Las distancias RELATIVAS entre las vecinas se preservan (reposicionamiento,
      // no re-maquetado — ADR-058 §2, Contexto §6).
      const originalGap = viveWord!.bbox.x - garciaWord!.bbox.x;
      const newGap = (viveCall!.args[1] as number) - (garciaCall!.args[1] as number);
      expect(newGap).toBeCloseTo(originalGap, 6);
    });
  });

  // ─── ADR-058 §7 (Hito 10.5, PR 6): aviso de degradación ───
  describe("aviso de degradación (ADR-058 §7)", () => {
    // Dos reemplazos con el mismo bbox.height (mismo tamaño natural, 28px:
    // `replacementFontSize(40) = round(40*0.7)`), sin `lineWords` (caen
    // directo al shrink-to-fit de PR1, nunca al repintado de línea). Uno se
    // encoge apenas por encima del umbral (17/28 ≈ 0.607 ≥ 0.6) y el otro
    // bien por debajo (10/28 ≈ 0.357 < 0.6) — la única variable entre los dos
    // es el ancho disponible.
    it("Degraded annotation emitted only below DEGRADED_FONT_RATIO, not on every fallback", async () => {
      const docId = "doc-degraded-threshold";
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
      );
      await engine.init(ctx);
      await engine.loadDocument(docId, createValidBuffer());

      await engine.renderPage(
        createRenderPageInput({
          documentId: docId,
          pageIndex: 0,
          kind: "anonymized",
          mode: "preview",
          replacements: [
            makeReplacement({
              groupId: "g-mild",
              occurrenceId: "o-mild",
              mode: ReplacementMode.Mask,
              replacementValue: "AAAAA",
              bbox: { x: 0, y: 0, width: 52, height: 40 },
            }),
            makeReplacement({
              groupId: "g-severe",
              occurrenceId: "o-severe",
              mode: ReplacementMode.Mask,
              replacementValue: "AAAAA",
              bbox: { x: 100, y: 0, width: 31, height: 40 },
            }),
          ],
        }),
        ctx,
      );

      const [canvas] = getCreatedCanvases();
      // Los dos cayeron al shrink-to-fit (ninguno entraba a tamaño natural);
      // solo el severo cruzó el umbral, así que "cae al fallback" no alcanza
      // por sí solo para emitir el aviso.
      const degradedStrokes = canvas!.calls.filter(
        (c) => c.op === "strokeRect" && c.strokeStyle === "#f59e0b",
      );
      expect(degradedStrokes).toHaveLength(1);
      expect(degradedStrokes[0]!.args).toEqual([100, 0, 31, 40]);
    });

    it("same replacement yields the same degraded verdict in preview and full", async () => {
      const docId = "doc-degraded-scale-invariant";
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
      );
      await engine.init(ctx);
      await engine.loadDocument(docId, createValidBuffer());

      const degradingReplacement = makeReplacement({
        groupId: "g-scale-degraded",
        occurrenceId: "o-scale-degraded",
        mode: ReplacementMode.Mask,
        replacementValue: "AAAAA",
        bbox: { x: 0, y: 0, width: 31, height: 40 },
      });
      const mildReplacement = makeReplacement({
        groupId: "g-scale-mild",
        occurrenceId: "o-scale-mild",
        mode: ReplacementMode.Mask,
        replacementValue: "AAAAA",
        bbox: { x: 0, y: 0, width: 52, height: 40 },
      });

      const isDegraded = (calls: ReadonlyArray<DrawCall>): boolean =>
        calls.some((c) => c.op === "strokeRect" && c.strokeStyle === "#f59e0b");

      resetCreatedCanvases();
      await engine.renderPage(
        createRenderPageInput({
          documentId: docId,
          pageIndex: 0,
          kind: "anonymized",
          mode: "preview",
          replacements: [degradingReplacement],
        }),
        ctx,
      );
      const [previewDegradingCanvas] = getCreatedCanvases();

      resetCreatedCanvases();
      await engine.renderPage(
        createRenderPageInput({
          documentId: docId,
          pageIndex: 0,
          kind: "anonymized",
          mode: "full",
          replacements: [degradingReplacement],
        }),
        ctx,
      );
      const [fullDegradingCanvas] = getCreatedCanvases();

      resetCreatedCanvases();
      await engine.renderPage(
        createRenderPageInput({
          documentId: docId,
          pageIndex: 0,
          kind: "anonymized",
          mode: "preview",
          replacements: [mildReplacement],
        }),
        ctx,
      );
      const [previewMildCanvas] = getCreatedCanvases();

      resetCreatedCanvases();
      await engine.renderPage(
        createRenderPageInput({
          documentId: docId,
          pageIndex: 0,
          kind: "anonymized",
          mode: "full",
          replacements: [mildReplacement],
        }),
        ctx,
      );
      const [fullMildCanvas] = getCreatedCanvases();

      // El mismo reemplazo (bbox SIN escalar idéntico) da el mismo veredicto
      // en preview (previewScale=1) y en full (fullScale=2.08, Contracts.md
      // §6) — `kernelRenderPage` mide tamaño natural y efectivo en el mismo
      // espacio ESCALADO (`scaleBbox`), así que la razón no depende de la
      // escala aunque los píxeles absolutos sí.
      expect(isDegraded(previewDegradingCanvas!.calls)).toBe(true);
      expect(isDegraded(fullDegradingCanvas!.calls)).toBe(true);
      expect(isDegraded(previewMildCanvas!.calls)).toBe(false);
      expect(isDegraded(fullMildCanvas!.calls)).toBe(false);
    });
  });

  // ─── ADR-059 §5 (Hito 10.5, PR 7): página de leyenda del export ───
  describe("renderLegendPage — layout (ADR-059 §5)", () => {
    function fillTextArgs(calls: ReadonlyArray<DrawCall>): ReadonlyArray<[string, number, number]> {
      return calls
        .filter((c) => c.op === "fillText")
        .map((c) => c.args as [string, number, number]);
    }

    it("13 rows fit in one legend page, drawn at incremental y with fixed columns", async () => {
      const rows = makeMarkerLegendRows(13);
      await engine.init(ctx);

      const encoded = await engine.renderLegendPage(rows, 595, 842, ctx);

      expect(encoded.widthPx).toBe(595);
      expect(encoded.heightPx).toBe(842);

      const [canvas] = getCreatedCanvases();
      const textCalls = fillTextArgs(canvas!.calls);
      // 1 título + 3 columnas por fila (prefixes/typeName/countLabel) × 13 filas.
      expect(textCalls).toHaveLength(1 + 13 * 3);

      // Cada fila: misma y para las tres columnas, y a x FIJAS y crecientes.
      const rowCalls = textCalls.slice(1); // descarta el título
      for (let i = 0; i < 13; i++) {
        const [prefixesCall, typeNameCall, countLabelCall] = rowCalls.slice(i * 3, i * 3 + 3) as [
          [string, number, number],
          [string, number, number],
          [string, number, number],
        ];
        expect(prefixesCall[2]).toBe(typeNameCall[2]); // misma y dentro de la fila
        expect(typeNameCall[2]).toBe(countLabelCall[2]);
        expect(prefixesCall[1]).toBeLessThan(typeNameCall[1]); // x fijas y crecientes
        expect(typeNameCall[1]).toBeLessThan(countLabelCall[1]);
        expect(prefixesCall[0]).toBe(rows[i]!.prefixes);
        expect(typeNameCall[0]).toBe(rows[i]!.typeName);
        expect(countLabelCall[0]).toBe(rows[i]!.countLabel);
      }

      // y estrictamente incremental entre filas consecutivas, y todo el
      // contenido entra dentro de la página pedida (sin paginación).
      const rowYs = rowCalls.filter((_, idx) => idx % 3 === 0).map((c) => c[2]);
      for (let i = 1; i < rowYs.length; i++) {
        expect(rowYs[i]!).toBeGreaterThan(rowYs[i - 1]!);
      }
      expect(rowYs[rowYs.length - 1]!).toBeLessThan(842);
    });

    it("a single row still draws the title plus its three columns", async () => {
      await engine.init(ctx);
      const row = makeMarkerLegendRow({
        prefixes: "DNI",
        typeName: "DNI",
        countLabel: "3 marcadores",
      });

      await engine.renderLegendPage([row], 400, 300, ctx);

      const [canvas] = getCreatedCanvases();
      const textCalls = fillTextArgs(canvas!.calls);
      expect(textCalls).toHaveLength(4); // título + 3 columnas
      expect(textCalls.slice(1).map((c) => c[0])).toEqual(["DNI", "DNI", "3 marcadores"]);
    });

    it("an empty rows array still draws the title, without throwing", async () => {
      await engine.init(ctx);

      const encoded = await engine.renderLegendPage([], 400, 300, ctx);

      expect(encoded.widthPx).toBe(400);
      const [canvas] = getCreatedCanvases();
      expect(fillTextArgs(canvas!.calls)).toHaveLength(1); // solo el título
    });
  });

  // ─── ADR-059 §5 + ADR-043 §4 (Hito 10.5, PR 7): quinto caso de
  // discriminación por forma en el entry-point del RenderWorker. Nombre y
  // archivo EXACTOS de Render_Engine.md §14: `unit.test.ts` (no
  // `worker-entry.test.ts`, donde viven los otros cuatro casos — ADR-059 §8
  // asigna este puntualmente acá). Reproduce el mínimo de la mensajería
  // WorkerInbound/WorkerOutbound de worker-entry.test.ts (self fake +
  // pdfjs-dist mockeado, ya preparado en el mock de cabecera de este
  // archivo) para poder ejercitar `dispatchKernel` (privado, no exportado)
  // de punta a punta contra un `worker/entry.js` fresco.
  describe("worker entry-point — discriminación de RenderLegendPayload (ADR-059 §5, ADR-043 §4)", () => {
    interface FakeWorkerSelf {
      readonly postMessage: ReturnType<typeof vi.fn>;
      readonly addEventListener: ReturnType<typeof vi.fn>;
      emitMessage(message: WorkerInbound): void;
    }

    function createFakeSelf(): FakeWorkerSelf {
      let listener: ((ev: { readonly data: WorkerInbound }) => void) | undefined;
      const addEventListener = vi.fn((type: string, handler: (ev: unknown) => void) => {
        if (type === "message") {
          listener = handler as (ev: { readonly data: WorkerInbound }) => void;
        }
      });
      return {
        postMessage: vi.fn(),
        addEventListener,
        emitMessage(message: WorkerInbound): void {
          listener?.({ data: message });
        },
      };
    }

    function outboundOfType<T extends WorkerOutbound["type"]>(
      fakeSelf: FakeWorkerSelf,
      type: T,
    ): Extract<WorkerOutbound, { type: T }> | undefined {
      const call = fakeSelf.postMessage.mock.calls.find(
        (c) => (c[0] as WorkerOutbound).type === type,
      );
      return call?.[0] as Extract<WorkerOutbound, { type: T }> | undefined;
    }

    let fakeSelf: FakeWorkerSelf;

    beforeEach(async () => {
      vi.resetModules();
      fakeSelf = createFakeSelf();
      vi.stubGlobal("self", fakeSelf);
      await import("../worker/entry.js");
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("worker entry-point discriminates RenderLegendPayload without colliding with the other four render-page shapes", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument({
            pageCount: 1,
            pageFactory: () => createMockPage({ width: 50, height: 60 }),
          }),
        ),
      );

      // 1) "buffer" -> load.
      fakeSelf.emitMessage({
        type: "RUN",
        jobId: "job-load",
        signalId: "job-load",
        jobType: "render-page",
        payload: {
          documentId: "doc-legend-order",
          buffer: new Uint8Array([1]).buffer,
        } satisfies LoadDocumentPayload,
      });
      await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
      expect(outboundOfType(fakeSelf, "COMPLETED")?.result).toEqual({ pageCount: 1 });
      fakeSelf.postMessage.mockClear();

      // 2) "rows" -> legend (ADR-059 §5, quinto caso) — SIN documentId, con
      // un documento vigente ya cargado (paso 1): prueba que no se confunde
      // con ninguno de los otros cuatro payloads a pesar de haber estado del
      // kernel de por medio.
      const legendPayload: RenderLegendPayload = {
        rows: [{ prefixes: "DNI", typeName: "DNI", countLabel: "3 marcadores" }],
        pageWidthPt: 200,
        pageHeightPt: 100,
      };
      fakeSelf.emitMessage({
        type: "RUN",
        jobId: "job-legend",
        signalId: "job-legend",
        jobType: "render-page",
        payload: legendPayload,
      });
      await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
      const legendResult = outboundOfType(fakeSelf, "COMPLETED")?.result as {
        readonly bytes: ArrayBuffer;
        readonly format: string;
        readonly widthPx: number;
        readonly heightPx: number;
      };
      expect(legendResult.widthPx).toBe(200);
      expect(legendResult.heightPx).toBe(100);
      expect(legendResult.format).toBe("png");
      expect("pageCount" in legendResult).toBe(false); // no se confundió con load
      expect("imageData" in legendResult).toBe(false); // no se confundió con render/rasterize
      fakeSelf.postMessage.mockClear();

      // 3) "kind" -> render, sobre el MISMO documento cargado en 1) — prueba
      // que agregar el chequeo de "rows" (posición 2 en el orden) no rompió
      // el caso de render normal.
      const renderPayload: RenderPagePayload = {
        documentId: "doc-legend-order",
        pageIndex: 0,
        kind: "original",
        mode: "preview",
      };
      fakeSelf.emitMessage({
        type: "RUN",
        jobId: "job-render",
        signalId: "job-render",
        jobType: "render-page",
        payload: renderPayload,
      });
      await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
      const renderResult = outboundOfType(fakeSelf, "COMPLETED")?.result as {
        readonly imageData: ImageData;
      };
      expect(renderResult.imageData.width).toBe(50);
      fakeSelf.postMessage.mockClear();

      // 4) "pageIndex" (sin "buffer"/"rows"/"kind") -> rasterize.
      const rasterizePayload: RasterizePagePayload = {
        documentId: "doc-legend-order",
        pageIndex: 0,
        scale: 1,
      };
      fakeSelf.emitMessage({
        type: "RUN",
        jobId: "job-rasterize",
        signalId: "job-rasterize",
        jobType: "render-page",
        payload: rasterizePayload,
      });
      await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
      const rasterizeResult = outboundOfType(fakeSelf, "COMPLETED")?.result as ImageData;
      expect(rasterizeResult.width).toBe(50);
      fakeSelf.postMessage.mockClear();

      // 5) sin ninguno de los 4 campos -> unload (fallback, único de los 5
      // sin "rows"/"buffer"/"kind"/"pageIndex").
      fakeSelf.emitMessage({
        type: "RUN",
        jobId: "job-unload",
        signalId: "job-unload",
        jobType: "render-page",
        payload: { documentId: "doc-legend-order" } satisfies UnloadDocumentPayload,
      });
      await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
      expect(outboundOfType(fakeSelf, "COMPLETED")?.result).toBeUndefined();
    });
  });
});
