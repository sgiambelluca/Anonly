/**
 * Tests directos del kernel (`../worker/kernel.js`, ADR-053) — la parte del
 * checklist §14 que "hoy nadie assertea" (ADR-053 §7): que `getDocument()`
 * recibe las CINCO opciones exactas de la regla transversal de
 * `05_Worker_Architecture.md` §7, con las DOS factories propias inyectadas
 * (no las `DOM*` de pdf.js), y que esas factories arman la URL correcta sin
 * tocar `document` — este archivo corre en `environment: "node"`
 * (`vitest.config.ts`), donde `document` no existe: si alguna de las dos
 * clases lo referenciara, el test de fetch explotaría solo con un
 * `ReferenceError`, no con un assert manual.
 *
 * `fetch` se stubea con `vi.stubGlobal` (mismo mecanismo que `self` en
 * `worker-entry.test.ts`) y respuestas construidas con el `Response` nativo
 * de Node (disponible desde Node 18): evita cualquier cast de frontera —
 * `Response` no es una de las librerías externas mockeadas de
 * Code_Standards.md §10 (pdfjs-dist/tesseract.js/@huggingface/transformers),
 * así que no aplica esa excepción, y no hace falta ninguna.
 */
import type { LoadDocumentPayload } from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import {
  kernelLoadDocument,
  RenderKernelCMapReaderFactory,
  RenderKernelStandardFontDataFactory,
} from "../worker/kernel.js";

import {
  capturedGetDocumentOptions,
  createMockPdfDocument,
  createValidBuffer,
  mockGetDocumentResult,
} from "./fixtures/test-helpers.js";

describe("kernelLoadDocument — opciones de pdf.js dentro del Worker (ADR-053)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pasa las cinco opciones de la regla transversal con el valor exacto", async () => {
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 2 })),
    );
    const buffer = createValidBuffer();
    const payload: LoadDocumentPayload = { documentId: "doc-1", buffer };

    await kernelLoadDocument(payload);

    expect(getDocument).toHaveBeenCalledTimes(1);
    const options = capturedGetDocumentOptions(vi.mocked(getDocument).mock.calls[0]?.[0]);
    expect(options.data).toBe(buffer);
    expect(options.disableFontFace).toBe(true);
    expect(options.useSystemFonts).toBe(false);
    expect(options.useWorkerFetch).toBe(false);
    expect(options.cMapUrl).toBe("/pdfjs/cmaps/");
    expect(options.cMapPacked).toBe(true);
    expect(options.standardFontDataUrl).toBe("/pdfjs/standard_fonts/");
  });

  it("inyecta las factories propias, no las DOM* de pdf.js", async () => {
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    const payload: LoadDocumentPayload = { documentId: "doc-2", buffer: createValidBuffer() };

    await kernelLoadDocument(payload);

    const options = capturedGetDocumentOptions(vi.mocked(getDocument).mock.calls[0]?.[0]);
    // Identidad exacta de clase (no una instancia, no un objeto estructural
    // parecido): pdf.js instancia la clase que recibe acá con `new` (ADR-053
    // §2). Si alguna vez alguien reemplaza esto por las DOM* importadas de
    // pdfjs-dist, esta comparación por referencia lo detecta.
    expect(options.CMapReaderFactory).toBe(RenderKernelCMapReaderFactory);
    expect(options.StandardFontDataFactory).toBe(RenderKernelStandardFontDataFactory);
  });

  it("pasa data/password intactos junto con las opciones de fuentes (no las reemplaza)", async () => {
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    const buffer = createValidBuffer();
    const payload: LoadDocumentPayload = { documentId: "doc-3", buffer, password: "s3cr3t" };

    await kernelLoadDocument(payload);

    const options = capturedGetDocumentOptions(vi.mocked(getDocument).mock.calls[0]?.[0]);
    expect(options.data).toBe(buffer);
    expect(options.password).toBe("s3cr3t");
  });
});

describe("RenderKernelCMapReaderFactory (ADR-053 §2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arma la URL baseUrl + name + .bcmap cuando isCompressed=true", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const factory = new RenderKernelCMapReaderFactory({
      baseUrl: "/pdfjs/cmaps/",
      isCompressed: true,
    });
    const result = await factory.fetch({ name: "Adobe-Japan1-UCS2" });

    expect(fetchMock).toHaveBeenCalledWith("/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap");
    expect(result.isCompressed).toBe(true);
    expect(result.cMapData).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.cMapData)).toEqual([1, 2, 3]);
  });

  it("arma la URL sin sufijo .bcmap cuando isCompressed=false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ArrayBuffer(0), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const factory = new RenderKernelCMapReaderFactory({
      baseUrl: "/pdfjs/cmaps/",
      isCompressed: false,
    });
    await factory.fetch({ name: "Identity-H" });

    expect(fetchMock).toHaveBeenCalledWith("/pdfjs/cmaps/Identity-H");
  });

  it("lanza si la respuesta no es ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const factory = new RenderKernelCMapReaderFactory({
      baseUrl: "/pdfjs/cmaps/",
      isCompressed: true,
    });

    await expect(factory.fetch({ name: "no-existe" })).rejects.toThrow();
  });

  it("no referencia `document` (corre en environment: node, donde no existe)", () => {
    expect(typeof document).toBe("undefined");
  });
});

describe("RenderKernelStandardFontDataFactory (ADR-053 §2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arma la URL baseUrl + filename y devuelve un Uint8Array", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]).buffer;
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const factory = new RenderKernelStandardFontDataFactory({ baseUrl: "/pdfjs/standard_fonts/" });
    const result = await factory.fetch({ filename: "FoxitSans.pfb" });

    expect(fetchMock).toHaveBeenCalledWith("/pdfjs/standard_fonts/FoxitSans.pfb");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([9, 8, 7, 6]);
  });

  it("lanza si la respuesta no es ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const factory = new RenderKernelStandardFontDataFactory({ baseUrl: "/pdfjs/standard_fonts/" });

    await expect(factory.fetch({ filename: "FoxitSans.pfb" })).rejects.toThrow();
  });

  it("no referencia `document` (corre en environment: node, donde no existe)", () => {
    expect(typeof document).toBe("undefined");
  });
});
