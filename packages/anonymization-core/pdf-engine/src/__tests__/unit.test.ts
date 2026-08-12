import {
  InvalidInputError,
  type Document,
  type EngineContext,
  type Page,
  type Word,
} from "@anonly/shared";
import { getDocument, OPS } from "pdfjs-dist";
import type * as PdfjsDist from "pdfjs-dist";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ADR-065 §1 (compuerta 1): el motor bajo prueba lee `OPS` real (save,
// restore, transform, paintImageXObject, ...); `importOriginal` lo preserva
// mientras solo `getDocument` queda mockeado.
vi.mock("pdfjs-dist", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfjsDist>();
  return { ...actual, getDocument: vi.fn() };
});

import {
  PdfEngine,
  PdfEngineCMapReaderFactory,
  PdfEngineStandardFontDataFactory,
  decodePdfEngineOutput,
  fuseOcrPage,
  fuseOcrRegion,
} from "../pdf.engine.js";
import { PdfTimeoutError } from "../pdf.errors.js";

import {
  capturedGetDocumentOptions,
  createEngineContext,
  createMockPage,
  createMockPdfDocument,
  createValidInput,
  mockGetDocumentResult,
  type MockAnnotationSpec,
} from "./fixtures/test-helpers.js";

describe("PdfEngine — unit tests", () => {
  let engine: PdfEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new PdfEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  describe("Word sorting (reading order)", () => {
    it("words sorted by y then x", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [
              { str: "Bottom", x: 10, y: 600, width: 40, height: 12 },
              { str: "Top", x: 10, y: 800, width: 30, height: 12 },
              { str: "Middle", x: 10, y: 700, width: 40, height: 12 },
              { str: "TopRight", x: 200, y: 800, width: 50, height: 12 },
            ]),
          ),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-sort");
      const output = await engine.process(input, ctx);
      const words = output.document.pages[0]!.words;

      expect(words[0]!.text).toBe("Top");
      expect(words[1]!.text).toBe("TopRight");
      expect(words[2]!.text).toBe("Middle");
      expect(words[3]!.text).toBe("Bottom");
    });

    it("on same y line, sorts by x asc", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [
              { str: "ZWord", x: 200, y: 800, width: 40, height: 12 },
              { str: "AWord", x: 10, y: 800, width: 40, height: 12 },
              { str: "BWord", x: 100, y: 800, width: 40, height: 12 },
            ]),
          ),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-same-y");
      const output = await engine.process(input, ctx);
      const words = output.document.pages[0]!.words;

      expect(words[0]!.text).toBe("AWord");
      expect(words[1]!.text).toBe("BWord");
      expect(words[2]!.text).toBe("ZWord");
    });
  });

  describe("Textless pages detection", () => {
    it("marks page with empty text content as requiresOCR=true", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
            getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-textless");
      const output = await engine.process(input, ctx);

      expect(output.document.pages[0]!.requiresOCR).toBe(true);
      expect(output.document.pages[0]!.words.length).toBe(0);
      expect(output.textlessPages).toEqual([0]);
    });

    it("marks page with text content as requiresOCR=false", async () => {
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(2)));

      await engine.init(ctx);
      const input = createValidInput("doc-text");
      const output = await engine.process(input, ctx);

      expect(output.document.pages[0]!.requiresOCR).toBe(false);
      expect(output.document.pages[0]!.words.length).toBeGreaterThan(0);
      expect(output.textlessPages).toEqual([]);
    });
  });

  describe("TextlessPages sorted asc", () => {
    it("textlessPages sorted asc", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(4, (i: number) => {
            const textless = i === 1 || i === 3;
            return textless
              ? {
                  getViewport: vi.fn(() => ({ width: 595, height: 842 })),
                  getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
                  getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
                }
              : createMockPage(i);
          }),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-textless-asc");
      const output = await engine.process(input, ctx);

      expect(output.textlessPages).toEqual([1, 3]);
    });
  });

  describe("Word splitting (ADR-020 §1)", () => {
    it("splits multi-word TextItems into individual words with prorated bboxes", async () => {
      const accentedWord = "Juan Pérez 34.567.891";

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [{ str: accentedWord, x: 50, y: 800, width: 210, height: 12 }]),
          ),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-word-split");
      const output = await engine.process(input, ctx);
      const words = output.document.pages[0]!.words;

      expect(words.length).toBe(3);
      expect(words.map((w) => w.text)).toEqual(["Juan", "Pérez", "34.567.891"]);

      // x crece monotónicamente (orden de lectura preservado)
      expect(words[0]!.bbox.x).toBeLessThan(words[1]!.bbox.x);
      expect(words[1]!.bbox.x).toBeLessThan(words[2]!.bbox.x);

      // y/height se conservan idénticos para todos los tokens del mismo TextItem
      expect(words[0]!.bbox.y).toBe(words[1]!.bbox.y);
      expect(words[1]!.bbox.y).toBe(words[2]!.bbox.y);
      expect(words[0]!.bbox.height).toBe(12);

      // Los widths prorrateados suman ≈ el width original (la diferencia es el
      // ancho atribuido a los 2 espacios, que no pertenecen a ningún token).
      const totalWidth = words.reduce((sum, w) => sum + w.bbox.width, 0);
      expect(totalWidth).toBeGreaterThan(150);
      expect(totalWidth).toBeLessThanOrEqual(210);
    });

    it("does not split a single-word TextItem (keeps original bbox, only NFC applies)", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [{ str: "SingleWord", x: 50, y: 800, width: 60, height: 12 }]),
          ),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-single-word");
      const output = await engine.process(input, ctx);
      const words = output.document.pages[0]!.words;

      expect(words.length).toBe(1);
      expect(words[0]!.text).toBe("SingleWord");
      expect(words[0]!.bbox.x).toBe(50);
      expect(words[0]!.bbox.width).toBe(60);
    });
  });

  describe("NFC normalization (ADR-020 §2)", () => {
    it("normalizes word text to NFC", async () => {
      // Construidas con escapes Unicode explícitos (fuente 100% ASCII) para
      // no depender de cómo el editor codifique un acento tipeado
      // literalmente:
      // NFD = "P" + "e" + combining acute accent (U+0301) + "rez" (6 chars).
      // NFC = "P" + "é" precompuesta (U+00E9) + "rez" (5 chars).
      const nfdPerez = "Pérez";
      const nfcPerez = "Pérez";
      expect(nfdPerez.length).toBe(6);
      expect(nfcPerez.length).toBe(5);
      expect(nfdPerez).not.toBe(nfcPerez);
      expect(nfdPerez.normalize("NFC")).toBe(nfcPerez);

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [{ str: nfdPerez, x: 50, y: 800, width: 40, height: 12 }]),
          ),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-nfc");
      const output = await engine.process(input, ctx);
      const page = output.document.pages[0]!;

      expect(page.words[0]!.text).toBe(nfcPerez);
      expect(page.words[0]!.text.length).toBe(5);
      expect(page.text).toContain(nfcPerez);
    });
  });

  // ADR-063: geometría del bbox derivada de la matriz completa [a,b,c,d,e,f],
  // no solo de la traslación. Casos 18-21 de PDF_Engine.md §13.
  describe("Rotated text bbox geometry (ADR-063)", () => {
    it("rotated 90 TextItem yields a swapped bbox", async () => {
      // Mismos números que ADR-063, Contexto §2 (sello de firma vertical
      // medido sobre una pericia real): matriz [0,16,-16,0,46,400], 19
      // caracteres sin espacios (un solo token). Geometría real esperada:
      // x=30, y=269, width=16 (=item.height), height=173 (=item.width).
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 596, height: 842 })),
            getTextContent: vi.fn(() =>
              Promise.resolve({
                items: [
                  {
                    str: "S".repeat(19),
                    transform: [0, 16, -16, 0, 46, 400],
                    width: 173,
                    height: 16,
                  },
                ],
              }),
            ),
            getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-rot-90"), ctx);
      const bbox = output.document.pages[0]!.words[0]!.bbox;

      // ADR-066 §6/§8: 90° puebla `rotation`.
      expect(bbox).toEqual({ x: 30, y: 269, width: 16, height: 173, rotation: 90 });
    });

    it("rotated 180 and 270 TextItems yield the correct envelope", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(2, (i) => {
            if (i === 0) {
              // 180°: dir=(-1,0), up=(0,-1). El texto sigue "horizontal" en
              // extensión (sin swap de width/height), origen en la esquina
              // opuesta.
              return {
                getViewport: vi.fn(() => ({ width: 595, height: 800 })),
                getTextContent: vi.fn(() =>
                  Promise.resolve({
                    items: [
                      { str: "Rot180", transform: [-1, 0, 0, -1, 100, 500], width: 50, height: 20 },
                    ],
                  }),
                ),
                getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
              };
            }
            // 270°: dir=(0,-1), up=(1,0). Swap de width/height, igual que 90°.
            return {
              getViewport: vi.fn(() => ({ width: 595, height: 800 })),
              getTextContent: vi.fn(() =>
                Promise.resolve({
                  items: [
                    { str: "Rot270", transform: [0, -1, 1, 0, 100, 200], width: 50, height: 20 },
                  ],
                }),
              ),
              getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
            };
          }),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-rot-180-270"), ctx);

      // ADR-066 §6/§8: 180°/270° también pueblan `rotation`.
      const bbox180 = output.document.pages[0]!.words[0]!.bbox;
      expect(bbox180).toEqual({ x: 50, y: 300, width: 50, height: 20, rotation: 180 });

      const bbox270 = output.document.pages[1]!.words[0]!.bbox;
      expect(bbox270).toEqual({ x: 100, y: 600, width: 20, height: 50, rotation: 270 });
    });

    it("horizontal TextItem bbox is unchanged by the matrix-aware formula", async () => {
      // Caso 21: garantía de no regresión. Escala != 1 (a=d=3) para probar
      // que dir/up se normalizan y el resultado depende solo de item.width /
      // item.height, igual que la fórmula anterior a ADR-063 (x=e,
      // y=pageHeight-f-height, width=item.width, height=item.height).
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() =>
              Promise.resolve({
                items: [
                  { str: "Horizontal", transform: [3, 0, 0, 3, 50, 800], width: 60, height: 12 },
                ],
              }),
            ),
            getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-rot-0"), ctx);
      const bbox = output.document.pages[0]!.words[0]!.bbox;

      expect(bbox).toEqual({ x: 50, y: 30, width: 60, height: 12 });
    });

    it("prorated tokens of a rotated run advance along the writing axis", async () => {
      // Run a 90° con dos tokens ("AA", "BB"; charWidth = 100/5 = 20 exacto).
      // ADR-063 §3: el desplazamiento por token corre sobre dir, no sobre x.
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 800 })),
            getTextContent: vi.fn(() =>
              Promise.resolve({
                items: [
                  { str: "AA BB", transform: [0, 16, -16, 0, 100, 200], width: 100, height: 16 },
                ],
              }),
            ),
            getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-rot-token-advance"), ctx);
      const words = output.document.pages[0]!.words;

      const wordAA = words.find((w) => w.text === "AA");
      const wordBB = words.find((w) => w.text === "BB");
      expect(wordAA).toBeDefined();
      expect(wordBB).toBeDefined();

      // x constante entre tokens del mismo run (el avance corre sobre dir=(0,1)).
      expect(wordAA!.bbox.x).toBe(wordBB!.bbox.x);
      // y decreciente token a token: "AA" antecede a "BB" en el orden de
      // escritura del run, y avanzar en ese orden hace decrecer y (coords
      // arriba-izquierda).
      expect(wordAA!.bbox.y).toBeGreaterThan(wordBB!.bbox.y);
    });

    it("arbitrary rotation yields an envelope containing all four corners", async () => {
      // 45°: ni exacto (0/90/180/270) ni degenerado. La envolvente debe
      // contener los cuatro vértices del paralelogramo (ADR-063 §2, caso 19).
      const theta = Math.PI / 4;
      const a = Math.cos(theta);
      const b = Math.sin(theta);
      const c = -Math.sin(theta);
      const d = Math.cos(theta);
      const e = 200;
      const f = 200;
      const width = 100;
      const height = 20;
      const pageHeight = 800;

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: pageHeight })),
            getTextContent: vi.fn(() =>
              Promise.resolve({
                items: [{ str: "Diagonal45", transform: [a, b, c, d, e, f], width, height }],
              }),
            ),
            getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-rot-45"), ctx);
      const bbox = output.document.pages[0]!.words[0]!.bbox;

      const corners = [
        { x: e, y: f },
        { x: e + a * width, y: f + b * width },
        { x: e + c * height, y: f + d * height },
        { x: e + a * width + c * height, y: f + b * width + d * height },
      ];

      const EPSILON = 1e-9;
      for (const corner of corners) {
        const topLeftY = pageHeight - corner.y;
        expect(corner.x).toBeGreaterThanOrEqual(bbox.x - EPSILON);
        expect(corner.x).toBeLessThanOrEqual(bbox.x + bbox.width + EPSILON);
        expect(topLeftY).toBeGreaterThanOrEqual(bbox.y - EPSILON);
        expect(topLeftY).toBeLessThanOrEqual(bbox.y + bbox.height + EPSILON);
      }
    });
  });

  // ADR-066 §6/§8: `rotation` sale del mismo versor que ya calcula la
  // envolvente. Se puebla para 90/180/270 (ya probado arriba, describe
  // "Rotated text bbox geometry") y queda AUSENTE en 0° y en cualquier
  // ángulo que no sea recto.
  describe("Rotation field on BoundingBox (ADR-066 §6/§8)", () => {
    it("bbox rotation is populated only for right angles", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() =>
              Promise.resolve({
                items: [
                  { str: "Horiz", transform: [1, 0, 0, 1, 50, 800], width: 40, height: 12 },
                  { str: "Rot90", transform: [0, 1, -1, 0, 100, 400], width: 40, height: 12 },
                  {
                    str: "Diag45",
                    transform: [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 200, 200],
                    width: 40,
                    height: 12,
                  },
                ],
              }),
            ),
            getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-rotation-field"), ctx);
      const words = output.document.pages[0]!.words;

      const horiz = words.find((w) => w.text === "Horiz");
      const rot90 = words.find((w) => w.text === "Rot90");
      const diag45 = words.find((w) => w.text === "Diag45");

      expect(horiz?.bbox.rotation).toBeUndefined();
      expect(rot90?.bbox.rotation).toBe(90);
      expect(diag45?.bbox.rotation).toBeUndefined();
    });
  });

  // ADR-066 §1-§5: texto de anotaciones. Casos 28-33 de PDF_Engine.md §13.
  // Los números de transform/rect/textMatrix del primer bloque son EXACTAMENTE
  // los medidos y verificados a mano en ADR-066, Contexto §3 (composición
  // textMatrix × transformInterno × beginAnnotation.transform × CTM =
  // [0,8,-8,0,17.34,60] — origen (17.34,60), 90°, cuerpo 8) y el `rect` real
  // medido `[10,60,60,560]`. El versor de ascenso (cuerpo 8) extiende la caja
  // del glifo 8pt hacia -x desde el origen (x=17.34-8=9.34), 0.66pt afuera del
  // `rect` — el oráculo es de SOLAPAMIENTO (≥50% del área del word), no de
  // contención estricta (ADR-066 §3, Corrección 2026-08-10): estos dos tests
  // solapan ~91.75%, muy por encima del umbral.
  describe("Annotation text (ADR-066 §1-§5)", () => {
    const MEASURED_ANNOTATION_TRANSFORM: MockAnnotationSpec["transform"] = [1, 0, 0, 1, 10, 60];
    const MEASURED_INNER_TRANSFORM: readonly [number, number, number, number, number, number] = [
      0, 1, -1, 0, 50, 0,
    ];
    const MEASURED_TEXT_MATRIX: readonly [number, number, number, number, number, number] = [
      8, 0, 0, 8, 0, 42.66,
    ];
    // El rect real medido (ADR-066, Contexto §3).
    const MEASURED_RECT: MockAnnotationSpec["rect"] = [10, 60, 60, 560];

    it("annotation text runs become words inside the annotation rect", async () => {
      const annotationSpec: MockAnnotationSpec = {
        id: "15R",
        rect: MEASURED_RECT,
        transform: MEASURED_ANNOTATION_TRANSFORM,
        innerOps: [
          { kind: "save" },
          { kind: "transform", matrix: MEASURED_INNER_TRANSFORM },
          {
            kind: "textRun",
            textMatrix: MEASURED_TEXT_MATRIX,
            glyphs: [
              { unicode: "A", width: 500 },
              { unicode: "B", width: 500 },
            ],
          },
          { kind: "restore" },
        ],
      };

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [], [], { width: 595, height: 842 }, [annotationSpec]),
          ),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-annotation-text"), ctx);
      const words = output.document.pages[0]!.words;

      expect(words).toHaveLength(1);
      const word = words[0]!;
      expect(word.text).toBe("AB");
      expect(word.source).toBe("pdf");
      // 90°: dir=(0,1) sale de [0,8,-8,0,...] — el mismo versor que ADR-066,
      // Contexto §3 verifica a mano.
      expect(word.bbox.rotation).toBe(90);
      // width/height del bbox: envolvente del paralelogramo con
      // dir/up de magnitud 8 (cuerpo 8) — width=8 (2 glifos de 500/1000em
      // cada uno, escalados por 8), height=8 (cuerpo).
      expect(word.bbox.width).toBe(8);
      expect(word.bbox.height).toBe(8);
      // Origen compuesto (17.34, 60) — el bbox lo desplaza 8pt hacia -x
      // (versor de ascenso) y lo convierte a arriba-izquierda.
      expect(word.bbox.x).toBeCloseTo(17.34 - 8, 6);
      expect(word.bbox.y).toBeCloseTo(842 - 68, 6);
    });

    it("ignoring the beginAnnotation transform pushes words out of the rect", async () => {
      // Fija el error de composición que ya ocurrió dos veces al medir
      // (ADR-066, Contexto §3): ignorar beginAnnotation.transform manda el
      // origen a (7.34, 0) en vez de (17.34, 60) — el eje Y salta del borde
      // superior del rect (60) al borde INFERIOR de la página (0), muy por
      // debajo de cualquier rect razonable. Este test prueba que, con el
      // transform aplicado, el word SÍ entra al rect (no se descarta) — la
      // prueba negativa de que la composición no cayó en esa trampa.
      const annotationSpec: MockAnnotationSpec = {
        id: "16R",
        rect: MEASURED_RECT,
        transform: MEASURED_ANNOTATION_TRANSFORM,
        innerOps: [
          { kind: "save" },
          { kind: "transform", matrix: MEASURED_INNER_TRANSFORM },
          {
            kind: "textRun",
            textMatrix: MEASURED_TEXT_MATRIX,
            glyphs: [{ unicode: "X", width: 300 }],
          },
          { kind: "restore" },
        ],
      };

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [], [], { width: 595, height: 842 }, [annotationSpec]),
          ),
        ),
      );

      await engine.init(ctx);
      const warnSpy = vi.spyOn(ctx.logger, "warn");
      const output = await engine.process(createValidInput("doc-annotation-transform-trap"), ctx);
      const words = output.document.pages[0]!.words;

      expect(words.some((w) => w.text === "X")).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("annotation stack is independent from the save/restore stack", async () => {
      // ADR-066 §2, Contexto §3 (trampa 2): un `restore` de más DENTRO de la
      // anotación no puede consumir el `save` que la página hizo ANTES de
      // entrar. Se arma a mano (no con buildMockOperatorList: necesita ops de
      // página intercaladas con dos anotaciones, algo que el DSL de
      // anotaciones no representa) una secuencia con:
      //   1. Página: transform ×2, luego transform ×3 (CTM = ×6).
      //   2. Anotación #1: SOLO un `restore` desbalanceado (sin `save` propio).
      //      Con una pila compartida, ese restore consumiría el `save` de
      //      página del paso 1.
      //   3. Página: `restore` — con pila separada, recupera CTM=×2 (el save
      //      de página); con pila compartida, ya no tendría qué desapilar y
      //      caería a identidad.
      //   4. Anotación #2: un run de texto que revela cuál CTM heredó — con
      //      la pila separada da width=1/height=2 (semilla ×2); con una
      //      compartida daría width=0,5/height=1 (semilla identidad).
      const fnArray: number[] = [];
      const argsArray: unknown[] = [];

      fnArray.push(OPS.transform);
      argsArray.push([2, 0, 0, 2, 0, 0]);
      fnArray.push(OPS.save);
      argsArray.push([]);
      fnArray.push(OPS.transform);
      argsArray.push([3, 0, 0, 3, 0, 0]);

      fnArray.push(OPS.beginAnnotation);
      argsArray.push(["1R", [0, 0, 1000, 1000], [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0], false]);
      fnArray.push(OPS.restore);
      argsArray.push([]);
      fnArray.push(OPS.endAnnotation);
      argsArray.push([]);

      fnArray.push(OPS.restore);
      argsArray.push([]);

      fnArray.push(OPS.beginAnnotation);
      argsArray.push(["2R", [0, 0, 1000, 1000], [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0], false]);
      fnArray.push(OPS.setTextMatrix);
      argsArray.push([1, 0, 0, 1, 0, 0]);
      fnArray.push(OPS.showText);
      argsArray.push([[{ unicode: "Z", width: 500 }]]);
      fnArray.push(OPS.endAnnotation);
      argsArray.push([]);

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 800, height: 800 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
            getOperatorList: vi.fn(() => Promise.resolve({ fnArray, argsArray })),
          })),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-annotation-stack"), ctx);
      const words = output.document.pages[0]!.words;

      expect(words).toHaveLength(1);
      const word = words[0]!;
      expect(word.text).toBe("Z");
      expect(word.bbox).toEqual({ x: 0, y: 798, width: 1, height: 2 });
    });

    it("image inside an annotation is placed with the annotation transform", async () => {
      const annotationSpec: MockAnnotationSpec = {
        id: "33R",
        rect: [0, 0, 200, 300],
        transform: MEASURED_ANNOTATION_TRANSFORM,
        innerOps: [{ kind: "transform", matrix: [150, 0, 0, 150, 0, 0] }, { kind: "image" }],
      };

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(
              0,
              [{ str: "Header", x: 500, y: 800, width: 50, height: 12 }],
              [],
              { width: 595, height: 842 },
              [annotationSpec],
            ),
          ),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-annotation-image"), ctx);

      expect(output.ocrRegions).toHaveLength(1);
      const region = output.ocrRegions[0]!;
      expect(region.pageIndex).toBe(0);

      // ADR-066 §5: el rect de imagen usa la CTM compuesta con
      // beginAnnotation.transform ([150,0,0,150,0,0] dentro de la anotación,
      // posicionada en (10,60) por el transform de la anotación, 842-60-150
      // =632 en coords arriba-izquierda) — sin el fix, el walker de la
      // compuerta 1 la ubicaría en (0,0) de la página (CTM de página sola,
      // sin la traslación de la anotación).
      const expectedImageBBox = { x: 10, y: 632, width: 150, height: 150 };
      const EPSILON = 1e-9;
      expect(region.bbox.x).toBeGreaterThanOrEqual(expectedImageBBox.x - EPSILON);
      expect(region.bbox.y).toBeGreaterThanOrEqual(expectedImageBBox.y - EPSILON);
      expect(region.bbox.x + region.bbox.width).toBeLessThanOrEqual(
        expectedImageBBox.x + expectedImageBBox.width + EPSILON,
      );
      expect(region.bbox.y + region.bbox.height).toBeLessThanOrEqual(
        expectedImageBBox.y + expectedImageBBox.height + EPSILON,
      );
      const regionArea = region.bbox.width * region.bbox.height;
      expect(regionArea).toBeGreaterThan(100 * 100);
    });

    // Complementario a los siete tests nombrados en PDF_Engine.md §14: un
    // `beginAnnotation` con args de forma inesperada (p. ej. sin `rect`) no
    // debe romper el resto del recorrido — se preserva la separación de
    // pilas (trampa 2) igual, pero sin rect no hay oráculo, así que la
    // anotación no aporta words. También ejercita el reset por `beginText`.
    it("beginAnnotation with malformed args is skipped without crashing", async () => {
      const fnArray: number[] = [];
      const argsArray: unknown[] = [];

      // Forma inválida: falta el `rect` (segundo argumento).
      fnArray.push(OPS.beginAnnotation);
      argsArray.push(["40R", [1, 0, 0, 1, 0, 0]]);
      fnArray.push(OPS.beginText);
      argsArray.push([]);
      fnArray.push(OPS.setTextMatrix);
      argsArray.push([1, 0, 0, 1, 0, 0]);
      fnArray.push(OPS.showText);
      argsArray.push([[{ unicode: "Y", width: 500 }]]);
      fnArray.push(OPS.endAnnotation);
      argsArray.push([]);

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
            getOperatorList: vi.fn(() => Promise.resolve({ fnArray, argsArray })),
          })),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-malformed-annotation"), ctx);

      expect(output.document.pages[0]!.words).toHaveLength(0);
      expect(output.document.pages[0]!.requiresOCR).toBe(true);
    });
  });

  describe("Timeout handling (ADR-020 §5)", () => {
    it("throws PdfTimeoutError with documentId when page parse exceeds timeout", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(getDocument).mockReturnValue(
          mockGetDocumentResult({
            numPages: 1,
            getPage: vi.fn(() =>
              Promise.resolve({
                getViewport: vi.fn(() => ({ width: 595, height: 842 })),
                getTextContent: vi.fn(() => new Promise(() => {})),
              }),
            ),
            getMetadata: vi.fn(() => Promise.resolve({ info: {}, metadata: undefined })),
            destroy: vi.fn(),
            _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
          }),
        );

        await engine.init(ctx);
        const input = createValidInput("doc-timeout");
        const resultPromise = engine.process(input, ctx);
        const caught = resultPromise.catch((err: unknown) => err);

        await vi.advanceTimersByTimeAsync(30001);

        const err = await caught;
        expect(err).toBeInstanceOf(PdfTimeoutError);
        if (!(err instanceof PdfTimeoutError)) throw new Error("expected PdfTimeoutError");
        expect(err.details.documentId).toBe("doc-timeout");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("FuseOcrPage logic", () => {
    it("fuseOcrPage updates words and marks ocrCompleted", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
            getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-fuse-unit");
      const output = await engine.process(input, ctx);

      expect(output.document.pages[0]!.requiresOCR).toBe(true);
      expect(output.document.pages[0]!.ocrCompleted).toBe(false);

      const ocrWords: Word[] = [
        {
          text: "Hello",
          bbox: { x: 50, y: 800, width: 30, height: 12 },
          pageIndex: 0,
          confidence: 0.9,
          source: "ocr",
        },
        {
          text: "World",
          bbox: { x: 90, y: 800, width: 30, height: 12 },
          pageIndex: 0,
          confidence: 0.9,
          source: "ocr",
        },
      ];

      const updatedDoc = fuseOcrPage(output.document, 0, ocrWords);

      expect(updatedDoc.pages[0]!.ocrCompleted).toBe(true);
      expect(updatedDoc.pages[0]!.words.length).toBe(2);
      expect(updatedDoc.pages[0]!.words[0]!.text).toBe("Hello");
      expect(updatedDoc.pages[0]!.words[0]!.source).toBe("ocr");
      expect(updatedDoc.pages[0]!.text).toContain("Hello");
    });

    it("fuseOcrPage returns a new Document reference (immutable)", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
            getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-immutable");
      const originalOutput = await engine.process(input, ctx);

      const words: Word[] = [
        {
          text: "New",
          bbox: { x: 10, y: 800, width: 30, height: 12 },
          pageIndex: 0,
          confidence: 0.9,
          source: "ocr",
        },
      ];

      const updatedDoc = fuseOcrPage(originalOutput.document, 0, words);

      expect(updatedDoc).not.toBe(originalOutput.document);
      expect(originalOutput.document.pages[0]!.words.length).toBe(0);
      expect(updatedDoc.pages[0]!.words.length).toBe(1);
    });
  });

  describe("fuseOcrPage — pageIndex fuera de rango (ADR-041, caso 15)", () => {
    it("fuseOcrPage on unknown pageIndex throws InvalidInputError", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument(2, { textless: true })),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-range-unit");
      const output = await engine.process(input, ctx);

      expect(() => fuseOcrPage(output.document, 99, [])).toThrow(InvalidInputError);
    });
  });

  describe("getDocument options — cMaps y standard fonts en la extracción (ADR-053 §5)", () => {
    it("pasa cMapUrl, cMapPacked, standardFontDataUrl y useWorkerFetch con el valor exacto", async () => {
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(1)));

      await engine.init(ctx);
      const input = createValidInput("doc-cmaps-options");
      await engine.process(input, ctx);

      expect(getDocument).toHaveBeenCalledTimes(1);
      const options = capturedGetDocumentOptions(vi.mocked(getDocument).mock.calls[0]?.[0]);
      expect(options.useWorkerFetch).toBe(false);
      expect(options.cMapUrl).toBe("/pdfjs/cmaps/");
      expect(options.cMapPacked).toBe(true);
      expect(options.standardFontDataUrl).toBe("/pdfjs/standard_fonts/");
    });

    it("inyecta las factories propias, no las DOM* de pdf.js", async () => {
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(1)));

      await engine.init(ctx);
      const input = createValidInput("doc-cmaps-factories");
      await engine.process(input, ctx);

      const options = capturedGetDocumentOptions(vi.mocked(getDocument).mock.calls[0]?.[0]);
      // Identidad exacta de clase (no una instancia, no un objeto estructural
      // parecido): pdf.js instancia la clase que recibe acá con `new`
      // (ADR-053 §2). Si alguna vez alguien reemplaza esto por las DOM*
      // importadas de pdfjs-dist, esta comparación por referencia lo detecta.
      expect(options.CMapReaderFactory).toBe(PdfEngineCMapReaderFactory);
      expect(options.StandardFontDataFactory).toBe(PdfEngineStandardFontDataFactory);
    });

    it("NO pasa disableFontFace (ruta de extracción, no rasteriza — ADR-053 §5)", async () => {
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(1)));

      await engine.init(ctx);
      const input = createValidInput("doc-cmaps-no-disable-font-face");
      await engine.process(input, ctx);

      const options = capturedGetDocumentOptions(vi.mocked(getDocument).mock.calls[0]?.[0]);
      expect(options.disableFontFace).toBeUndefined();
      expect("disableFontFace" in (vi.mocked(getDocument).mock.calls[0]?.[0] as object)).toBe(
        false,
      );
    });

    it("pasa data/password intactos junto con las opciones de fuentes (no las reemplaza)", async () => {
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(1)));

      await engine.init(ctx);
      const input = createValidInput("doc-cmaps-data-password", "s3cr3t");
      await engine.process(input, ctx);

      const options = capturedGetDocumentOptions(vi.mocked(getDocument).mock.calls[0]?.[0]);
      expect(options.data).toBe(input.buffer);
      expect(options.password).toBe("s3cr3t");
    });
  });

  describe("PdfEngineCMapReaderFactory (ADR-053 §2/§5)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("arma la URL baseUrl + name + .bcmap cuando isCompressed=true", async () => {
      const bytes = new Uint8Array([1, 2, 3]).buffer;
      const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const factory = new PdfEngineCMapReaderFactory({
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
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(new ArrayBuffer(0), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const factory = new PdfEngineCMapReaderFactory({
        baseUrl: "/pdfjs/cmaps/",
        isCompressed: false,
      });
      await factory.fetch({ name: "Identity-H" });

      expect(fetchMock).toHaveBeenCalledWith("/pdfjs/cmaps/Identity-H");
    });

    it("lanza si la respuesta no es ok", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
      vi.stubGlobal("fetch", fetchMock);

      const factory = new PdfEngineCMapReaderFactory({
        baseUrl: "/pdfjs/cmaps/",
        isCompressed: true,
      });

      await expect(factory.fetch({ name: "no-existe" })).rejects.toThrow();
    });

    it("no referencia `document` (corre en environment: node, donde no existe)", () => {
      expect(typeof document).toBe("undefined");
    });
  });

  // ADR-055 §10 / PDF_Engine.md §13 casos 16-17, §14. Los casos de rechazo
  // viven en edge.test.ts; acá van los dos de aceptación, y en particular el
  // de paridad, que es el que ADR-055 §5 pide por motor.
  describe("decodePdfEngineOutput (ADR-055 §10)", () => {
    it("decodePdfEngineOutput returns a valid PdfEngineOutput unchanged", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [{ str: "Hola", x: 10, y: 700, width: 30, height: 12 }]),
          ),
        ),
      );
      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-decode-identity"), ctx);

      // Identidad referencial: el decoder verifica, no copia ni normaliza.
      expect(decodePdfEngineOutput(output)).toBe(output);
    });

    it("decodePdfEngineOutput accepts the exact shape PdfWorker posts", async () => {
      // Paridad remoto/in-process (ADR-055 §5). El valor NO es un literal
      // escrito a mano: `worker/entry.ts` postea `COMPLETED.result` = lo que
      // devuelve `engine.process()`, sin envolverlo en ningún sobre, así que
      // el resultado de este `process()` ES la forma que cruza el
      // `postMessage`. Lo que este test protege es esa igualdad: el día que
      // alguien envuelva el resultado del entry-point en un `{ output }`, la
      // forma remota deja de coincidir con lo que el decoder acepta, y el
      // test de sobre del façade (Orchestrator.md §14, D3.2) se pone rojo.
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(2, (i) =>
            createMockPage(
              i,
              i === 0 ? [{ str: "Texto", x: 5, y: 700, width: 30, height: 12 }] : [],
            ),
          ),
        ),
      );
      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-decode-parity"), ctx);

      // Round-trip por una copia estructural: es lo que el structured clone
      // del `postMessage` le hace al valor (pierde prototipos y readonly,
      // conserva la forma). Si el decoder dependiera de algo que el clone no
      // preserva, este assert lo destapa.
      const cloned: unknown = structuredClone(output);
      const decoded = decodePdfEngineOutput(cloned);

      expect(decoded).toEqual(output);
      expect(decoded.sourceKind).toBe("mixed");
      expect(decoded.textlessPages).toEqual([1]);
      expect(decoded.document.pages).toHaveLength(2);
    });
  });

  // ADR-065 §1-§2: compuertas de OCR por región dentro de parsePage. Casos
  // 22-26 de PDF_Engine.md §13.
  describe("OCR region gates (ADR-065 §1-§2)", () => {
    it("page without image XObjects yields no ocr regions", async () => {
      // createMockPdfDocument(1) usa createMockPage sin `images`: operator
      // list vacía por default — la compuerta 1 termina ahí (caso 22).
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(1)));

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-no-images"), ctx);

      expect(output.ocrRegions).toEqual([]);
    });

    it("image smaller than 1 percent of the page is discarded", async () => {
      // Mismos números que ADR-065, Contexto §3 (logo 37×37 en A4, 0,27%).
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, undefined, [{ x: 10, y: 10, width: 37, height: 37 }]),
          ),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-small-logo"), ctx);

      expect(output.ocrRegions).toEqual([]);
    });

    it("full-page image covered by native text yields no region", async () => {
      // Página sintética 200×200 con una imagen a página completa y ~17
      // líneas de texto nativo espaciadas 12pt (cuerpo 10pt): la dilatación
      // vertical (0,8× = 8pt por lado) cierra el interlineado de 2pt, así
      // que la grilla queda ocupada de punta a punta — el falso positivo
      // caro que ADR-065 (Contexto §2-3) existe para rechazar (caso 24).
      const lines = Array.from({ length: 17 }, (_, i) => ({
        str: `Line${i}`,
        x: 0,
        y: 5 + i * 12,
        width: 200,
        height: 10,
      }));

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, lines, [{ x: 0, y: 0, width: 200, height: 200 }], {
              width: 200,
              height: 200,
            }),
          ),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-full-coverage"), ctx);

      expect(output.ocrRegions).toEqual([]);
    });

    it("large image with no native text yields a clamped region", async () => {
      // Imagen grande (400×600pt en página 595×842) sin ninguna palabra
      // nativa encima; la única palabra de la página queda lejos, arriba a
      // la derecha (caso 25).
      const imageRectPdfSpace = { x: 50, y: 50, width: 400, height: 600 };
      // Equivalente en coordenadas de página (origen arriba-izquierda):
      // yMax = 50+600 = 650 -> bbox.y = 842-650 = 192.
      const expectedImageBBox = { x: 50, y: 192, width: 400, height: 600 };

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(
              0,
              [{ str: "Header", x: 500, y: 800, width: 50, height: 12 }],
              [imageRectPdfSpace],
            ),
          ),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-large-empty-image"), ctx);

      expect(output.ocrRegions).toHaveLength(1);
      const region = output.ocrRegions[0]!;
      expect(region.pageIndex).toBe(0);

      // Contenido en el rect de la imagen (PDF_Engine.md §10).
      const EPSILON = 1e-9;
      expect(region.bbox.x).toBeGreaterThanOrEqual(expectedImageBBox.x - EPSILON);
      expect(region.bbox.y).toBeGreaterThanOrEqual(expectedImageBBox.y - EPSILON);
      expect(region.bbox.x + region.bbox.width).toBeLessThanOrEqual(
        expectedImageBBox.x + expectedImageBBox.width + EPSILON,
      );
      expect(region.bbox.y + region.bbox.height).toBeLessThanOrEqual(
        expectedImageBBox.y + expectedImageBBox.height + EPSILON,
      );

      const regionArea = region.bbox.width * region.bbox.height;
      const imageArea = expectedImageBBox.width * expectedImageBBox.height;
      expect(regionArea / imageArea).toBeGreaterThanOrEqual(0.4);
      expect(region.bbox.width).toBeGreaterThanOrEqual(100);
      expect(region.bbox.height).toBeGreaterThanOrEqual(100);
    });

    it("page with two candidate images yields only the largest", async () => {
      // Dos imágenes candidatas, ninguna con texto nativo encima (la única
      // palabra queda lejos de las dos): se emite solo la de mayor
      // rectángulo vacío (ADR-065 §2, caso 26). Imagen A: 250×600 = 150.000
      // pt². Imagen B: 150×150 = 22.500 pt² — su área máxima posible nunca
      // alcanza la de A, así que sirve para probar que se descartó.
      const imageA = { x: 20, y: 20, width: 250, height: 600 }; // PDF space
      const imageB = { x: 320, y: 20, width: 150, height: 150 }; // PDF space
      // Imagen A en coordenadas de página: yMax=620 -> bbox.y=842-620=222.
      const imageABBox = { x: 20, y: 222, width: 250, height: 600 };

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(
              0,
              [{ str: "Header", x: 50, y: 800, width: 50, height: 12 }],
              [imageA, imageB],
            ),
          ),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-two-candidates"), ctx);

      expect(output.ocrRegions).toHaveLength(1);
      const region = output.ocrRegions[0]!;
      expect(region.pageIndex).toBe(0);

      const EPSILON = 1e-9;
      expect(region.bbox.x).toBeGreaterThanOrEqual(imageABBox.x - EPSILON);
      expect(region.bbox.y).toBeGreaterThanOrEqual(imageABBox.y - EPSILON);
      expect(region.bbox.x + region.bbox.width).toBeLessThanOrEqual(
        imageABBox.x + imageABBox.width + EPSILON,
      );
      expect(region.bbox.y + region.bbox.height).toBeLessThanOrEqual(
        imageABBox.y + imageABBox.height + EPSILON,
      );

      // El área máxima posible de B (22.500) nunca produce esto.
      const regionArea = region.bbox.width * region.bbox.height;
      expect(regionArea).toBeGreaterThan(imageB.width * imageB.height);
    });

    // Complementario a los 8 tests nombrados en PDF_Engine.md §14: cubre el
    // catch de detectOcrRegion agregado en parsePage (mismo criterio que el
    // resto de errores de página -> PdfCorruptedError).
    it("wraps a getOperatorList failure into PdfCorruptedError", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => {
            const page = createMockPage(0);
            page.getOperatorList = vi.fn(() => Promise.reject(new Error("operator list roto")));
            return page;
          }),
        ),
      );

      await engine.init(ctx);
      await expect(
        engine.process(createValidInput("doc-operator-list-fails"), ctx),
      ).rejects.toThrow("PDF corrupto");
    });
  });

  // ADR-065 §6: fuseOcrRegion, espejo invertido de fuseOcrPage. Casos 27 de
  // PDF_Engine.md §13.
  describe("fuseOcrRegion (ADR-065 §6)", () => {
    it("fuseOcrRegion translates words by the region origin and concatenates", () => {
      const nativeWord: Word = {
        text: "Native",
        bbox: { x: 10, y: 10, width: 40, height: 12 },
        pageIndex: 0,
        confidence: 1,
        source: "pdf",
      };
      const page: Page = {
        index: 0,
        width: 595,
        height: 842,
        words: [nativeWord],
        text: "Native",
        requiresOCR: false,
        ocrCompleted: false,
      };
      const document: Document = {
        id: "doc-fuse-region",
        name: "",
        pageCount: 1,
        pages: [page],
        metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
        sourceKind: "text",
        importedAt: 0,
      };

      // ADR-064: las words de OCR llegan en puntos relativos al recorte.
      const region = { x: 100, y: 200, width: 300, height: 150 };
      const ocrWords: Word[] = [
        {
          text: "Oculto",
          bbox: { x: 5, y: 5, width: 60, height: 12 },
          pageIndex: 0,
          confidence: 0.9,
          source: "ocr",
        },
      ];

      const updated = fuseOcrRegion(document, 0, region, ocrWords);
      const updatedPage = updated.pages[0]!;

      expect(updatedPage.ocrCompleted).toBe(true);
      // ADR-065 §7: requiresOCR no cambia de significado, se mantiene en false.
      expect(updatedPage.requiresOCR).toBe(false);
      expect(updatedPage.words).toHaveLength(2);

      const translated = updatedPage.words.find((w) => w.text === "Oculto");
      expect(translated).toBeDefined();
      expect(translated!.bbox).toEqual({ x: 105, y: 205, width: 60, height: 12 });
      expect(translated!.source).toBe("ocr");

      // Se conserva la nativa (concatena, no reemplaza — ADR-065 §6.3).
      expect(updatedPage.words.some((w) => w.text === "Native")).toBe(true);
      expect(updatedPage.text).toContain("Native");
      expect(updatedPage.text).toContain("Oculto");
    });

    it("fuseOcrRegion on a textless page throws InvalidInputError", () => {
      const page: Page = {
        index: 0,
        width: 595,
        height: 842,
        words: [],
        text: "",
        requiresOCR: true,
        ocrCompleted: false,
      };
      const document: Document = {
        id: "doc-fuse-region-guard",
        name: "",
        pageCount: 1,
        pages: [page],
        metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
        sourceKind: "scanned",
        importedAt: 0,
      };

      expect(() => fuseOcrRegion(document, 0, { x: 0, y: 0, width: 10, height: 10 }, [])).toThrow(
        InvalidInputError,
      );
    });

    // Complementario: mismo criterio que "fuseOcrPage on unknown pageIndex
    // throws InvalidInputError" (ADR-041, caso 15), aplicado al espejo.
    it("fuseOcrRegion on unknown pageIndex throws InvalidInputError", () => {
      const page: Page = {
        index: 0,
        width: 595,
        height: 842,
        words: [],
        text: "",
        requiresOCR: false,
        ocrCompleted: false,
      };
      const document: Document = {
        id: "doc-fuse-region-range",
        name: "",
        pageCount: 1,
        pages: [page],
        metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
        sourceKind: "text",
        importedAt: 0,
      };

      expect(() => fuseOcrRegion(document, 99, { x: 0, y: 0, width: 10, height: 10 }, [])).toThrow(
        InvalidInputError,
      );
    });
  });

  describe("PdfEngineStandardFontDataFactory (ADR-053 §2/§5)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("arma la URL baseUrl + filename y devuelve un Uint8Array", async () => {
      const bytes = new Uint8Array([9, 8, 7, 6]).buffer;
      const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const factory = new PdfEngineStandardFontDataFactory({ baseUrl: "/pdfjs/standard_fonts/" });
      const result = await factory.fetch({ filename: "FoxitSans.pfb" });

      expect(fetchMock).toHaveBeenCalledWith("/pdfjs/standard_fonts/FoxitSans.pfb");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual([9, 8, 7, 6]);
    });

    it("lanza si la respuesta no es ok", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
      vi.stubGlobal("fetch", fetchMock);

      const factory = new PdfEngineStandardFontDataFactory({ baseUrl: "/pdfjs/standard_fonts/" });

      await expect(factory.fetch({ filename: "FoxitSans.pfb" })).rejects.toThrow();
    });

    it("no referencia `document` (corre en environment: node, donde no existe)", () => {
      expect(typeof document).toBe("undefined");
    });
  });
});
