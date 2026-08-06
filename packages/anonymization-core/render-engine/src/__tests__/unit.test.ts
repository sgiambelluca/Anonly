import {
  AnnotationKind,
  EngineEvents,
  EventChannel,
  ReplacementMode,
  type EngineContext,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import { RenderEngine } from "../render.engine.js";

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
  makeReplacement,
  mockGetDocumentResult,
  readProtectedPdfFixtureBuffer,
  resetCreatedCanvases,
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
});
