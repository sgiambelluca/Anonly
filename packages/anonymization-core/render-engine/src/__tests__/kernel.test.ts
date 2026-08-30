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
import { REPLACEMENT_FONT_HEIGHT_RATIO, ReplacementMode } from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import {
  fitReplacementFont,
  fitReplacementFontSized,
  kernelLoadDocument,
  kernelRenderLegendPage,
  kernelRenderPage,
  RenderKernelCanvasFactory,
  RenderKernelCMapReaderFactory,
  RenderKernelStandardFontDataFactory,
  type KernelRenderLegendOptions,
  type KernelRenderOptions,
} from "../worker/kernel.js";

import {
  capturedGetDocumentOptions,
  createMockPage,
  createMockPdfDocument,
  createValidBuffer,
  getConvertToBlobCalls,
  getCreatedCanvases,
  getGetContextCalls,
  installOffscreenCanvasStub,
  removeOffscreenCanvasStub,
  makeMarkerLegendRow,
  makeReplacement,
  mockGetDocumentResult,
  resetConvertToBlobCalls,
  resetCreatedCanvases,
  resetGetContextCalls,
} from "./fixtures/test-helpers.js";

describe("kernelLoadDocument — opciones de pdf.js dentro del Worker (ADR-053)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pasa las opciones de la regla transversal con el valor exacto", async () => {
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

  it("inyecta también la CanvasFactory propia — la tercera de la misma familia", async () => {
    // Regresión con nombre y apellido: durante todo ADR-053 este archivo
    // afirmó "las CINCO opciones exactas" y las cinco estaban bien, mientras
    // faltaba la sexta. pdf.js caía a su `DOMCanvasFactory` para los canvas
    // auxiliares (grupos de transparencia, soft masks, patrones, Type3) y
    // hacía `document.createElement` dentro del Worker — donde `document` no
    // existe. Resultado: TODAS las páginas de cualquier PDF con imágenes
    // fallaban con `RENDER_PAGE_FAILED`, y el visor quedaba gris. Ningún
    // fixture del repo tiene una imagen, así que nada lo agarró.
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );

    await kernelLoadDocument({ documentId: "doc-canvas", buffer: createValidBuffer() });

    const options = capturedGetDocumentOptions(vi.mocked(getDocument).mock.calls[0]?.[0]);
    expect(options.CanvasFactory).toBe(RenderKernelCanvasFactory);
  });
});

describe("RenderKernelCanvasFactory — canvas auxiliares de pdf.js sin DOM", () => {
  /*
   * Este archivo corre en `environment: "node"`, donde `document` no existe:
   * si la factory lo tocara, estos tests explotarían solos con un
   * `ReferenceError` en vez de con un assert manual. Es el mismo mecanismo
   * con el que ADR-053 §7 cubrió las otras dos factories.
   */

  it("crea un canvas del tamaño pedido y devuelve su contexto 2D", () => {
    const factory = new RenderKernelCanvasFactory();

    const { canvas, context } = factory.create(120, 80);

    expect(canvas.width).toBe(120);
    expect(canvas.height).toBe(80);
    expect(context).not.toBeNull();
  });

  it("pide el contexto con willReadFrequently: pdf.js relee estos canvas para componer", () => {
    // Este test afirmaba lo mismo dentro de un `if (calls !== undefined)` sobre
    // una propiedad que el stub nunca escribía: la condición era siempre falsa
    // y el cuerpo no corría NUNCA. Ahora el stub registra los argumentos
    // (`getGetContextCalls`) y la afirmación es incondicional.
    resetGetContextCalls();
    const factory = new RenderKernelCanvasFactory();

    factory.create(10, 10);

    const calls = getGetContextCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ contextId: "2d", options: { willReadFrequently: true } });
  });

  it("rechaza tamaños inválidos en vez de devolver un canvas degenerado", () => {
    const factory = new RenderKernelCanvasFactory();

    expect(() => factory.create(0, 10)).toThrow();
    expect(() => factory.create(10, -1)).toThrow();
  });

  it("reset redimensiona el canvas existente", () => {
    const factory = new RenderKernelCanvasFactory();
    const created = factory.create(10, 10);

    factory.reset(created, 40, 30);

    expect(created.canvas.width).toBe(40);
    expect(created.canvas.height).toBe(30);
  });

  it("destroy libera el canvas y su contexto", () => {
    const factory = new RenderKernelCanvasFactory();
    const created = factory.create(10, 10);

    const holder: { canvas: unknown; context: unknown } = created;
    factory.destroy(created);

    expect(holder.canvas).toBeNull();
    expect(holder.context).toBeNull();
  });

  it("sin OffscreenCanvas falla con un mensaje que lo dice, no con un TypeError críptico", () => {
    removeOffscreenCanvasStub();
    try {
      const factory = new RenderKernelCanvasFactory();
      expect(() => factory.create(10, 10)).toThrow(/OffscreenCanvas/);
    } finally {
      installOffscreenCanvasStub();
    }
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
    // Fórmula de `fontForMode` previa a este ADR: Math.max(8, round(h*ratio)).
    // El VALOR de la razón lo fija `Contracts.md` §6 y lo pinea el contract
    // test de `shared`; acá se pinea la fórmula, que es lo que ADR-058 no
    // debe mover.
    const boxHeight = 14;
    const expectedInitialSize = Math.max(8, Math.round(boxHeight * REPLACEMENT_FONT_HEIGHT_RATIO));

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
    // Fórmula de `fontForMode` previa a ADR-058: Math.max(8, round(14*ratio)).
    const size = Math.max(8, Math.round(14 * REPLACEMENT_FONT_HEIGHT_RATIO));
    expect(fillTextCalls[0]!.font).toBe(`${String(size)}px monospace, sans-serif`);
    expect(fillTextCalls[0]!.args).toEqual(["[DNI 01]", 10 + 100 / 2, 20 + 14 / 2, 100]);
  });
});

// ─── ADR-059 §5 (Hito 10.5, PR 7): kernelRenderLegendPage en aislamiento ───
describe("kernelRenderLegendPage — página de leyenda del export (ADR-059 §5)", () => {
  const legendOpts: KernelRenderLegendOptions = { jpegQuality: 0.85 };

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
    resetCreatedCanvases();
    resetConvertToBlobCalls();
  });

  it("no toca pdfjs-dist en absoluto — no requiere documento cargado", async () => {
    await kernelRenderLegendPage(
      { rows: [makeMarkerLegendRow()], pageWidthPt: 300, pageHeightPt: 200 },
      legendOpts,
    );

    expect(getDocument).not.toHaveBeenCalled();
  });

  it("defaults to png when imageFormat is absent from the payload", async () => {
    await kernelRenderLegendPage(
      { rows: [makeMarkerLegendRow()], pageWidthPt: 300, pageHeightPt: 200 },
      legendOpts,
    );

    const [call] = getConvertToBlobCalls();
    expect(call?.type).toBe("image/png");
  });

  it("respects an explicit imageFormat and the effective jpegQuality", async () => {
    const encoded = await kernelRenderLegendPage(
      {
        rows: [makeMarkerLegendRow()],
        pageWidthPt: 300,
        pageHeightPt: 200,
        imageFormat: "jpeg",
      },
      { jpegQuality: 0.42 },
    );

    expect(encoded.format).toBe("jpeg");
    const [call] = getConvertToBlobCalls();
    expect(call?.type).toBe("image/jpeg");
    expect(call?.quality).toBe(0.42);
  });

  it("draws the table at incremental y with fixed x columns, and the encoded dimensions match the requested page size", async () => {
    const rows = [
      makeMarkerLegendRow({ prefixes: "DNI", typeName: "DNI", countLabel: "3 marcadores" }),
      makeMarkerLegendRow({
        prefixes: "MATR, MAT",
        typeName: "Matrícula",
        countLabel: "1 marcador",
      }),
    ];

    // A4 (595): ancho donde el título entra en una línea. Con 500 pt el
    // título se envuelve en dos, que es correcto pero rompe el conteo fijo
    // que este test usa para verificar la estructura de la tabla.
    const encoded = await kernelRenderLegendPage(
      { rows, pageWidthPt: 595, pageHeightPt: 400 },
      legendOpts,
    );

    expect(encoded.widthPx).toBe(595);
    expect(encoded.heightPx).toBe(400);

    const [canvas] = getCreatedCanvases();
    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    // 1 título + 3 columnas × 2 filas.
    expect(fillTextCalls).toHaveLength(1 + 2 * 3);

    const [titleCall, ...rowCalls] = fillTextCalls;
    expect(titleCall!.args[0]).toContain("Anonly");

    const [row0Prefixes, row0TypeName, row0Count, row1Prefixes, row1TypeName, row1Count] = rowCalls;
    // Misma y dentro de cada fila; y estrictamente mayor en la fila siguiente.
    expect(row0Prefixes!.args[2]).toBe(row0TypeName!.args[2]);
    expect(row0TypeName!.args[2]).toBe(row0Count!.args[2]);
    expect(row1Prefixes!.args[2]).toBeGreaterThan(row0Prefixes!.args[2] as number);
    // x fijas y crecientes entre columnas, e IGUALES entre las dos filas.
    expect(row0Prefixes!.args[1]).toBe(row1Prefixes!.args[1]);
    expect(row0TypeName!.args[1]).toBe(row1TypeName!.args[1]);
    expect(row0Count!.args[1]).toBe(row1Count!.args[1]);
    expect(row0Prefixes!.args[1] as number).toBeLessThan(row0TypeName!.args[1] as number);
    expect(row0TypeName!.args[1] as number).toBeLessThan(row0Count!.args[1] as number);

    expect(row0Prefixes!.args[0]).toBe("DNI");
    expect(row1Prefixes!.args[0]).toBe("MATR, MAT");
  });

  it("throws RenderPageFailedError (not the page-scoped constructor) when OffscreenCanvas is unavailable", async () => {
    Reflect.deleteProperty(globalThis, "OffscreenCanvas");

    await expect(
      kernelRenderLegendPage(
        { rows: [makeMarkerLegendRow()], pageWidthPt: 300, pageHeightPt: 200 },
        legendOpts,
      ),
    ).rejects.toThrow("OffscreenCanvas no disponible en este entorno.");

    installOffscreenCanvasStub();
  });
});

describe("veredicto de degradación por razón de anchos (ADR-086, tests puros)", () => {
  const TOKEN = "A".repeat(40);

  // ADR-086 §2 promete invariancia **exacta**, no aproximada, y lo respalda con
  // una tabla a seis decimales. Este es el test que la fija.
  //
  // Va acá, puro, y no sobre el evento: `PREVIEW_UPDATED.degraded` solo lleva
  // las anotaciones, así que desde el motor lo único observable es un booleano
  // —y un booleano no distingue "invariante" de "varía pero siempre cruza el
  // umbral". Revertir §2(a) (devolverle piso y redondeo a la referencia) hace
  // variar el cociente un factor 2 entre escala 0,5 y 1 dejando el booleano
  // intacto en las cuatro escalas; contra `toBeCloseTo` no sobrevive.
  it("widthRatio es idéntico a toda escala, también cuando el piso muerde", () => {
    const boxHeight = 12;
    const boxWidth = 40;
    const ratios = [0.5, 1, 2, 4].map(
      (scale) =>
        fitReplacementFontSized(
          pureStubMeasure,
          TOKEN,
          ReplacementMode.Mask,
          boxHeight * scale,
          boxWidth * scale,
          8 * scale,
        ).widthRatio,
    );

    for (const ratio of ratios) {
      expect(ratio).toBeCloseTo(ratios[0]!, 6);
    }
    // Y no es invariante por ser trivial: el cociente es un valor de verdad.
    expect(ratios[0]!).toBeGreaterThan(0);
    expect(ratios[0]!).toBeLessThan(1);
  });

  // ADR-086 §2(b) no tiene efecto sobre el veredicto —`widthRatio` no lee el
  // piso—, así que su único observable es el tamaño DIBUJADO. Sin este test, no
  // escalar el piso pasa desapercibido por completo.
  it("el piso de dibujo escala: a escala 2 el bucle frena en 16px, no en 8", () => {
    const apretado = fitReplacementFontSized(
      pureStubMeasure,
      TOKEN,
      ReplacementMode.Mask,
      12 * 2,
      40 * 2,
      8 * 2,
    );
    expect(apretado.finalSizePx).toBeGreaterThanOrEqual(16);

    // El mismo caso sin escalar el piso frena en 8: es la mitad del tamaño en
    // pantalla para la misma decisión visual.
    const pisoAbsoluto = fitReplacementFontSized(
      pureStubMeasure,
      TOKEN,
      ReplacementMode.Mask,
      12 * 2,
      40 * 2,
      8,
    );
    expect(pisoAbsoluto.finalSizePx).toBe(8);
  });

  // ADR-086 §2(a): la referencia es exactamente proporcional a la caja. Si
  // alguien le devuelve el piso o el `Math.round`, esto cae.
  it("naturalSizePx no tiene piso ni redondeo", () => {
    const chico = fitReplacementFontSized(pureStubMeasure, "A", ReplacementMode.Mask, 5, 1000);
    // Exactamente 5 × la razón: ni el piso de 8 ni el `Math.round`.
    expect(chico.naturalSizePx).toBeCloseTo(5 * REPLACEMENT_FONT_HEIGHT_RATIO, 10);
    expect(chico.naturalSizePx).toBeLessThan(8);
    expect(Number.isInteger(chico.naturalSizePx)).toBe(false);

    const fraccionario = fitReplacementFontSized(
      pureStubMeasure,
      "A",
      ReplacementMode.Mask,
      12,
      1000,
    );
    expect(fraccionario.naturalSizePx).toBeCloseTo(12 * REPLACEMENT_FONT_HEIGHT_RATIO, 10);
  });

  it("un texto que entra holgado no degrada, y el vacío tampoco", () => {
    expect(
      fitReplacementFontSized(pureStubMeasure, "AB", ReplacementMode.Mask, 12, 1000).widthRatio,
    ).toBe(1);
    // Ancho natural 0: no puede degradar lo que no ocupa espacio, y además
    // sería una división por cero.
    expect(
      fitReplacementFontSized(pureStubMeasure, "", ReplacementMode.Mask, 12, 40).widthRatio,
    ).toBe(1);
  });
});
