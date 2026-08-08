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
import type { LoadDocumentPayload, RenderPagePayload } from "@anonly/shared";
import { ReplacementMode } from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import {
  fitReplacementFont,
  kernelLoadDocument,
  kernelRenderPage,
  RenderKernelCMapReaderFactory,
  RenderKernelStandardFontDataFactory,
  type KernelRenderOptions,
} from "../worker/kernel.js";

import {
  capturedGetDocumentOptions,
  createMockPage,
  createMockPdfDocument,
  createValidBuffer,
  getCreatedCanvases,
  installOffscreenCanvasStub,
  makeReplacement,
  mockGetDocumentResult,
  resetCreatedCanvases,
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

// ─── ADR-058 §1 (Hito 10.5, PR 1) — shrink-to-fit ───
//
// `paintReplacements` derivaba el tamaño de fuente solo de `bbox.height` y
// llamaba `fillText` sin `maxWidth`, con el texto centrado: un token más
// ancho que su caja se derramaba hacia los dos lados, encima de palabras del
// original dibujadas debajo. Esta es la ÚNICA garantía dura de ADR-058 (el
// resto de sus piezas — repintado de línea, calibración, muestreo de color,
// `AnnotationKind.Degraded` — son PRs futuros del mismo hito, fuera de
// alcance acá).
//
// Los TRES tests con nombre y archivo exactos de Render_Engine.md §14
// ("replacement text never exceeds its available width" en `unit.test.ts`;
// "token much wider than its bbox is drawn at the 8px floor without
// overflow" y "all three text modes respect the fit; redact is unchanged" en
// `edge.test.ts`) viven en esos archivos, vía `RenderEngine.renderPage` —
// mismo camino que sus vecinos (casos 4/5/6, ya en `edge.test.ts:151-236`).
// Lo que sigue acá son tests COMPLEMENTARIOS sobre `fitReplacementFont` en
// aislamiento (el algoritmo puro de encogido, sin canvas): verifican la
// calidad del encogido en sí — que converge al tamaño más grande que entra,
// o al piso si ninguno entra — no la garantía de no-derrame de punta a punta
// (esa la cubre `drawnWidth` en los tests de `unit.test.ts`/`edge.test.ts`,
// que modela el clamp real de `fillText(..., maxWidth)`).

/** Recupera el tamaño en px del prefijo `"NNpx ..."` de un string de fuente. */
function parseFontSizePx(font: string): number {
  const match = /^([\d.]+)px/.exec(font);
  return match ? Number(match[1]) : 0;
}

/**
 * Función de medición determinista para ejercitar `fitReplacementFont` en
 * aislamiento, sin un `OffscreenCanvas` (la función es pura: recibe la
 * medición por parámetro — ver su doc en `../worker/kernel.js`). Mismo
 * criterio de "fórmula arbitraria pero monótona en tamaño y longitud" que
 * `measureStubTextWidth` de `./fixtures/test-helpers.js`, con una constante
 * de proporción propia (0.55) para no acoplar este test a la fórmula exacta
 * del stub de canvas que usan los tests de integración de `unit.test.ts`/
 * `edge.test.ts`.
 */
function pureStubMeasure(font: string, text: string): number {
  return text.length * parseFontSizePx(font) * 0.55;
}

describe("fitReplacementFont — shrink-to-fit puro (ADR-058 §1, Hito 10.5 PR 1, tests complementarios)", () => {
  it("converge al tamaño más grande que entra, o al piso de 8px si ninguno entra (algoritmo puro; el test de propiedad exigido por el spec vive en unit.test.ts)", () => {
    const modes = [ReplacementMode.Mask, ReplacementMode.Synthetic, ReplacementMode.Placeholder];
    const tokenLengths = [1, 2, 4, 8, 16, 32, 64];
    const boxWidths = [1, 4, 10, 25, 60, 150, 400];
    const boxHeights = [3, 6, 10, 16, 24, 40];

    let combinationsChecked = 0;
    for (const mode of modes) {
      for (const length of tokenLengths) {
        for (const width of boxWidths) {
          for (const height of boxHeights) {
            const text = "X".repeat(length);
            const font = fitReplacementFont(pureStubMeasure, text, mode, height, width);
            const finalSize = parseFontSizePx(font);
            const measuredWidth = pureStubMeasure(font, text);

            // Convergencia del algoritmo puro: entra, o se llegó al piso. La
            // garantía de no-derrame de punta a punta (con `maxWidth` como
            // red de seguridad final) la cubre el test de propiedad exigido
            // por el spec, en unit.test.ts.
            expect(measuredWidth <= width || finalSize === 8).toBe(true);
            expect(finalSize).toBeGreaterThanOrEqual(8);
            combinationsChecked += 1;
          }
        }
      }
    }

    // Guard contra un refactor que vacíe los arrays de arriba y deje esta
    // aserción pasando en verde sin haber comprobado ninguna combinación.
    expect(combinationsChecked).toBeGreaterThan(500);
  });

  it("fitReplacementFont: un token muchísimo más largo que su caja se encoge hasta el piso de 8px, sin bajar más (el equivalente end-to-end, con `maxWidth`, vive en edge.test.ts)", () => {
    const text = "X".repeat(500);
    const font = fitReplacementFont(pureStubMeasure, text, ReplacementMode.Placeholder, 14, 20);

    expect(parseFontSizePx(font)).toBe(8);
    // Ni siquiera al piso entra: es exactamente el caso que `maxWidth` en
    // `fillText` cubre como red de seguridad final (spec Render_Engine.md §13
    // caso 25) — `fitReplacementFont` en aislamiento no promete más que "no
    // bajar del piso".
    expect(pureStubMeasure(font, text)).toBeGreaterThan(20);
  });

  it("cuando el token ya entra al tamaño inicial, no encoge — mismo tamaño que antes de ADR-058 (no-regresión)", () => {
    // Fórmula de `fontForMode` previa a este ADR: Math.max(8, round(h*0.7)).
    const boxHeight = 14;
    const expectedInitialSize = Math.max(8, Math.round(boxHeight * 0.7));

    for (const mode of [
      ReplacementMode.Mask,
      ReplacementMode.Synthetic,
      ReplacementMode.Placeholder,
    ]) {
      const font = fitReplacementFont(pureStubMeasure, "AB", mode, boxHeight, 1000);
      expect(parseFontSizePx(font)).toBe(expectedInitialSize);
      const expectedFamily =
        mode === ReplacementMode.Placeholder ? "monospace, sans-serif" : "sans-serif";
      expect(font).toBe(`${expectedInitialSize}px ${expectedFamily}`);
    }
  });
});

describe("paintReplacements — no-regresión vía kernelRenderPage (ADR-058 §1)", () => {
  const renderOpts: KernelRenderOptions = {
    jpegQuality: 0.85,
    timeoutMs: 5000,
    abortSignal: new AbortController().signal,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
    resetCreatedCanvases();
  });

  it("un token que ya entra al tamaño inicial se dibuja con el mismo tamaño y posición que antes de ADR-058 (no-regresión bit a bit)", async () => {
    const docId = "doc-shrink-fits-already";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(
        createMockPdfDocument({
          pageCount: 1,
          pageFactory: () => createMockPage({ width: 300, height: 200 }),
        }),
      ),
    );
    await kernelLoadDocument({ documentId: docId, buffer: createValidBuffer() });

    const payload: RenderPagePayload = {
      documentId: docId,
      pageIndex: 0,
      kind: "anonymized",
      mode: "preview",
      replacements: [
        makeReplacement({
          mode: ReplacementMode.Placeholder,
          replacementValue: "[DNI 01]",
          bbox: { x: 10, y: 20, width: 100, height: 14 },
        }),
      ],
    };

    await kernelRenderPage(payload, renderOpts);

    const [canvas] = getCreatedCanvases();
    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    expect(fillTextCalls).toHaveLength(1);
    // Fórmula de `fontForMode` previa a ADR-058: Math.max(8, round(14*0.7)) = 10px.
    expect(fillTextCalls[0]!.font).toBe("10px monospace, sans-serif");
    expect(fillTextCalls[0]!.args).toEqual(["[DNI 01]", 10 + 100 / 2, 20 + 14 / 2, 100]);
  });
});
