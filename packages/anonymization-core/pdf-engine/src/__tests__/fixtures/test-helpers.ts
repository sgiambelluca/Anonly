/**
 * Mocks y builders compartidos por los tests de @anonly/pdf-engine.
 *
 * `vi.mock("pdfjs-dist", ...)` NO vive acá: por el hoisting de Vitest, cada
 * archivo de test debe declarar su propio `vi.mock` en su propio módulo. Este
 * archivo solo unifica los helpers de construcción de mocks (ADR-020, Fase 3).
 */
import { OPS, type getDocument } from "pdfjs-dist";
import { vi } from "vitest";

import type { PdfEngineInput } from "../../pdf.types.js";

/*
 * ADR-129: los dobles genéricos viven en `@anonly/test-utils`. Se re-exportan
 * acá para que cada suite siga importando de un solo lugar.
 */
export {
  createEngineContext,
  createEngineContextWithRealBus,
  createMockBus,
  createMockCache,
  createMockConfig,
  createMockLogger,
} from "@anonly/test-utils";

/**
 * Cast de frontera contra pdfjs-dist — ÚNICO lugar del paquete donde se
 * permite `as unknown as` (Code_Standards.md §10; ADR-019, nota 2026-07-09):
 * getDocument() devuelve un PDFDocumentLoadingTask, una clase con decenas de
 * miembros que un mock estructural no puede satisfacer honestamente. Los tests
 * construyen el mock vía mockGetDocumentResult / mockGetDocumentFailure y
 * nunca castean por su cuenta.
 */
function asLoadingTask(promise: Promise<unknown>): ReturnType<typeof getDocument> {
  return { promise } as unknown as ReturnType<typeof getDocument>;
}

export function mockGetDocumentResult(
  doc: Record<string, unknown>,
): ReturnType<typeof getDocument> {
  return asLoadingTask(Promise.resolve(doc));
}

export function mockGetDocumentFailure(error: Error): ReturnType<typeof getDocument> {
  return asLoadingTask(Promise.reject(error));
}

/**
 * Forma mínima que `unit.test.ts` necesita leer del objeto de opciones que
 * `PdfEngine.process()` pasa a `getDocument()` (ADR-053 §5, §7). No es
 * `DocumentInitParameters` completo: esa interfaz no la exporta pdfjs-dist
 * desde su entrypoint público (mismo motivo documentado en
 * render-engine/src/__tests__/fixtures/test-helpers.ts, ADR-053 Contexto §6).
 * `disableFontFace` se incluye para poder assertar su AUSENCIA (§5: esta ruta
 * no rasteriza, así que nunca debe pasarse).
 */
export interface CapturedGetDocumentOptions {
  readonly data?: unknown;
  readonly password?: string;
  readonly disableFontFace?: boolean;
  readonly useWorkerFetch?: boolean;
  readonly cMapUrl?: string;
  readonly cMapPacked?: boolean;
  readonly standardFontDataUrl?: string;
  readonly CMapReaderFactory?: unknown;
  readonly StandardFontDataFactory?: unknown;
}

/**
 * Cast de frontera contra pdfjs-dist, concentrado acá (Code_Standards.md
 * §10; mismo criterio que `asLoadingTask` arriba): el primer argumento de
 * `getDocument()` es la unión `string | URL | TypedArray | ArrayBuffer |
 * DocumentInitParameters`. `PdfEngine.process()` SIEMPRE llama con la forma
 * objeto — nunca con una URL o un buffer pelado, las otras variantes de esa
 * unión — así que el narrowing es seguro.
 */
export function capturedGetDocumentOptions(arg: unknown): CapturedGetDocumentOptions {
  return arg as unknown as CapturedGetDocumentOptions;
}

export function createValidInput(documentId: string, password?: string): PdfEngineInput {
  const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const body = new Uint8Array(100).fill(0x41);
  const combined = new Uint8Array(pdfHeader.length + body.length);
  combined.set(pdfHeader, 0);
  combined.set(body, pdfHeader.length);

  if (password !== undefined) {
    return { documentId, buffer: combined.buffer, password };
  }
  return { documentId, buffer: combined.buffer };
}

export type MockTextItem = {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Parte lineal `[a, b, c, d]` de la matriz (ADR-063 §1). Ausente = texto
   * horizontal, o sea la identidad, que es lo que asumían todos los mocks
   * previos a ADR-067. Solo importa la DIRECCIÓN de los versores: el tamaño
   * lo dan `width` (avance) y `height` (cuerpo).
   */
  readonly linear?: readonly [number, number, number, number];
  /**
   * Clave contra `styles` de `getTextContent()` (ADR-109 §1). Ausente = el
   * item no declara fuente, así que la caja cae a la de cuerpo — el
   * comportamiento previo a ADR-109, que es lo que asumen todos los mocks
   * anteriores.
   */
  readonly fontName?: string;
};

/**
 * Construye un `MockTextItem` rotado **describiéndolo por el bbox que debe
 * producir** (origen arriba-izquierda, el espacio de `Word.bbox`), en vez de
 * por la línea de base en espacio PDF. Los tests de ADR-067 razonan sobre
 * columnas y huecos, que son propiedades del bbox: obligarlos a despejar la
 * traslación a mano escondería lo que están fijando.
 *
 * `em` es el cuerpo del glifo (extensión transversal del bbox) y `advance` el
 * largo del texto. La inversión de cada ángulo sale de
 * `boundingBoxFromParallelogram` (ADR-063 §2).
 */
export function rotatedTextItem(
  str: string,
  spec: {
    readonly bboxX: number;
    readonly bboxY: number;
    readonly em: number;
    readonly advance: number;
    readonly rotation: 90 | 180 | 270;
    readonly pageHeight?: number;
  },
): MockTextItem {
  const pageHeight = spec.pageHeight ?? 842;
  const base = { str, width: spec.advance, height: spec.em };

  if (spec.rotation === 90) {
    return {
      ...base,
      linear: [0, 1, -1, 0],
      x: spec.bboxX + spec.em,
      y: pageHeight - spec.bboxY - spec.advance,
    };
  }
  if (spec.rotation === 270) {
    return { ...base, linear: [0, -1, 1, 0], x: spec.bboxX, y: pageHeight - spec.bboxY };
  }
  return {
    ...base,
    linear: [-1, 0, 0, -1],
    x: spec.bboxX + spec.advance,
    y: pageHeight - spec.bboxY,
  };
}

/**
 * Rectángulo de imagen en puntos de página (mismo espacio que
 * `item.transform`: origen abajo-izquierda, y-up — ver ADR-065 §1).
 */
export type MockImageRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type Matrix6 = readonly [number, number, number, number, number, number];

/**
 * Glifo mínimo que imita la forma que `pdfjs-dist` deja en `argsArray` de un
 * op `showText` ya resuelto (`Glyph.unicode`/`Glyph.width`, ver
 * `pdf.engine.ts`, `buildAnnotationTextRun`): `width` en unidades de glifo
 * (1/1000 em, la convención de PDF fuera de Type3).
 */
export interface MockGlyph {
  readonly unicode: string;
  readonly width: number;
  /**
   * ADR-108 §1: la bandera con la que pdf.js marca al espacio que lleva word
   * spacing — el código de **un byte** 32 (PDF 32000-1 §9.3.3). En una fuente
   * compuesta, el espacio de dos bytes llega con `false`. Ausente se comporta
   * como `false`, que es lo que corresponde para todo glifo que no es espacio.
   */
  readonly isSpace?: boolean;
}

/**
 * Ops internos de una anotación, en el orden en que se emiten (ADR-066 §1-
 * §2). Permite construir escenarios con `save`/`restore` desbalanceados
 * (trampa 2), texto (`textRun`, trampa 1) e imágenes (§5, caso 33) — todo
 * dentro de la MISMA pila local que `beginAnnotation` arranca.
 */
export type MockAnnotationInnerOp =
  | { readonly kind: "save" }
  | { readonly kind: "restore" }
  | { readonly kind: "transform"; readonly matrix: Matrix6 }
  | { readonly kind: "beginText" }
  | {
      readonly kind: "textRun";
      readonly textMatrix: Matrix6;
      readonly glyphs: ReadonlyArray<MockGlyph>;
    }
  // ADR-066 §2 (corrección): el idioma normal de PDF pone el cuerpo en `Tf` y
  // la posición en `Td`, sin ningún `Tm`. Estos tres ops permiten escribir esa
  // forma tal cual la emite el documento real, en vez de la aplanada.
  | { readonly kind: "setFont"; readonly size: number }
  | { readonly kind: "moveText"; readonly tx: number; readonly ty: number }
  | { readonly kind: "showText"; readonly glyphs: ReadonlyArray<MockGlyph> }
  // ADR-068: word spacing, el que desplaza el origen que reporta `getTextContent`.
  | { readonly kind: "setWordSpacing"; readonly value: number }
  | { readonly kind: "setTextMatrix"; readonly matrix: Matrix6 }
  | { readonly kind: "image" };

export interface MockAnnotationSpec {
  readonly id: string;
  // [x0, y0, x1, y1] — mismo espacio que `item.transform` (origen
  // abajo-izquierda, y-up), igual que el `rect` real de `beginAnnotation`.
  readonly rect: readonly [number, number, number, number];
  readonly transform: Matrix6;
  readonly innerOps: ReadonlyArray<MockAnnotationInnerOp>;
}

const MOCK_ANNOTATION_APPEARANCE_MATRIX: Matrix6 = [1, 0, 0, 1, 0, 0];

/**
 * Operator list que simula `save cm paintImageXObject restore` por cada
 * imagen de página (ADR-065 §1, compuerta 1) y, opcionalmente,
 * `beginAnnotation ... endAnnotation` por cada anotación (ADR-066 §1-§5).
 * Usa el `OPS` REAL de pdfjs-dist (preservado por los
 * `vi.mock("pdfjs-dist", ...)` de cada test file vía `importOriginal`): el
 * motor bajo prueba lee esos mismos valores, así que el mock no puede
 * inventar los suyos sin arriesgar un falso positivo/negativo.
 */
export function buildMockOperatorList(
  images: ReadonlyArray<MockImageRect>,
  annotations: ReadonlyArray<MockAnnotationSpec> = [],
  // ADR-068: ops de texto de PÁGINA (fuera de toda anotación). El motor no
  // extrae texto de acá —eso es `getTextContent()`—, solo la corrección de
  // origen; por eso van sueltos y no dentro de un `MockAnnotationSpec`.
  pageTextOps: ReadonlyArray<MockAnnotationInnerOp> = [],
): {
  readonly fnArray: number[];
  readonly argsArray: unknown[];
} {
  const fnArray: number[] = [];
  const argsArray: unknown[] = [];

  const emit = (op: MockAnnotationInnerOp): void => {
    if (op.kind === "save") { fnArray.push(OPS.save); argsArray.push([]); }
    else if (op.kind === "restore") { fnArray.push(OPS.restore); argsArray.push([]); }
    else if (op.kind === "transform") { fnArray.push(OPS.transform); argsArray.push(op.matrix); }
    else if (op.kind === "beginText") { fnArray.push(OPS.beginText); argsArray.push([]); }
    else if (op.kind === "setFont") { fnArray.push(OPS.setFont); argsArray.push(["g_d0_f4", op.size]); }
    else if (op.kind === "moveText") { fnArray.push(OPS.moveText); argsArray.push([op.tx, op.ty]); }
    else if (op.kind === "showText") { fnArray.push(OPS.showText); argsArray.push([op.glyphs]); }
    else if (op.kind === "setWordSpacing") { fnArray.push(OPS.setWordSpacing); argsArray.push([op.value]); }
    else if (op.kind === "setTextMatrix") { fnArray.push(OPS.setTextMatrix); argsArray.push(op.matrix); }
    else if (op.kind === "textRun") {
      fnArray.push(OPS.setTextMatrix); argsArray.push(op.textMatrix);
      fnArray.push(OPS.showText); argsArray.push([op.glyphs]);
    } else { fnArray.push(OPS.paintImageXObject); argsArray.push(["img", 1, 1]); }
  };

  for (const op of pageTextOps) emit(op);

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

  for (const annotation of annotations) {
    fnArray.push(OPS.beginAnnotation);
    argsArray.push([
      annotation.id,
      annotation.rect,
      annotation.transform,
      MOCK_ANNOTATION_APPEARANCE_MATRIX,
      false,
    ]);

    for (const op of annotation.innerOps) {
      if (op.kind === "save") {
        fnArray.push(OPS.save);
        argsArray.push([]);
      } else if (op.kind === "restore") {
        fnArray.push(OPS.restore);
        argsArray.push([]);
      } else if (op.kind === "transform") {
        fnArray.push(OPS.transform);
        argsArray.push(op.matrix);
      } else if (op.kind === "beginText") {
        fnArray.push(OPS.beginText);
        argsArray.push([]);
      } else if (op.kind === "textRun") {
        fnArray.push(OPS.setTextMatrix);
        argsArray.push(op.textMatrix);
        fnArray.push(OPS.showText);
        argsArray.push([op.glyphs]);
      } else if (op.kind === "setFont") {
        fnArray.push(OPS.setFont);
        argsArray.push(["g_d0_f4", op.size]);
      } else if (op.kind === "moveText") {
        fnArray.push(OPS.moveText);
        argsArray.push([op.tx, op.ty]);
      } else if (op.kind === "showText") {
        fnArray.push(OPS.showText);
        argsArray.push([op.glyphs]);
      } else if (op.kind === "setWordSpacing") {
        fnArray.push(OPS.setWordSpacing);
        argsArray.push([op.value]);
      } else if (op.kind === "setTextMatrix") {
        fnArray.push(OPS.setTextMatrix);
        argsArray.push(op.matrix);
      } else {
        fnArray.push(OPS.paintImageXObject);
        argsArray.push(["img", 1, 1]);
      }
    }

    fnArray.push(OPS.endAnnotation);
    argsArray.push([]);
  }

  return { fnArray, argsArray };
}

export function createMockPage(
  pageIndex: number,
  textItems?: ReadonlyArray<MockTextItem>,
  images?: ReadonlyArray<MockImageRect>,
  pageSize?: { readonly width: number; readonly height: number },
  annotations?: ReadonlyArray<MockAnnotationSpec>,
  pageTextOps?: ReadonlyArray<MockAnnotationInnerOp>,
  textStyles?: Readonly<Record<string, { readonly ascent: number; readonly descent: number }>>,
): Record<string, unknown> {
  const items = textItems ?? [
    { str: `Page${pageIndex}Word1`, x: 50, y: 800, width: 50, height: 12 },
    { str: `Page${pageIndex}Word2`, x: 110, y: 800, width: 50, height: 12 },
  ];
  const size = pageSize ?? { width: 595, height: 842 };

  return {
    getViewport: vi.fn(() => ({ width: size.width, height: size.height })),
    getTextContent: vi.fn(() =>
      Promise.resolve({
        items: items.map((item) => ({
          str: item.str,
          transform: [...(item.linear ?? [1, 0, 0, 1]), item.x, item.y],
          width: item.width,
          height: item.height,
          ...(item.fontName !== undefined ? { fontName: item.fontName } : {}),
        })),
        ...(textStyles !== undefined ? { styles: textStyles } : {}),
      }),
    ),
    // ADR-065 §1 (compuerta 1): default sin imágenes — preserva el
    // comportamiento de todos los tests que no pasan `images` explícitamente.
    // ADR-066 §1: default sin anotaciones, mismo criterio.
    getOperatorList: vi.fn(() =>
      Promise.resolve(buildMockOperatorList(images ?? [], annotations ?? [], pageTextOps ?? [])),
    ),
  };
}

export type MockDocOptions = {
  readonly metadata?: Record<string, unknown>;
  readonly hasForms?: boolean;
  readonly textless?: boolean;
  readonly throwOnGetPage?: boolean;
};

export type PageFactory = (pageIndex: number) => Record<string, unknown>;

export function createMockPdfDocument(
  pageCount: number,
  options?: MockDocOptions | PageFactory,
): Record<string, unknown> {
  const isFactory = typeof options === "function";

  if (isFactory) {
    const factory = options;
    const pages: Record<string, unknown>[] = [];
    for (let i = 0; i < pageCount; i++) {
      pages.push(factory(i));
    }
    return {
      numPages: pageCount,
      getPage: vi.fn((pageNum: number) => Promise.resolve(pages[pageNum - 1])),
      getMetadata: vi.fn(() => Promise.resolve({ info: { Title: "Test" }, metadata: undefined })),
      destroy: vi.fn(),
      _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
    };
  }

  const pages: Record<string, unknown>[] = [];
  for (let i = 0; i < pageCount; i++) {
    if (options?.throwOnGetPage) {
      pages.push({});
    } else if (options?.textless) {
      pages.push({
        getViewport: vi.fn(() => ({ width: 595, height: 842 })),
        getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
        // ADR-066 §1: parsePage llama getOperatorList() en TODA página (el
        // texto de anotaciones puede ser la única fuente de texto), no solo
        // en las que ya tienen texto nativo — a diferencia de antes de
        // ADR-066, una página textless también necesita este mock.
        getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
      });
    } else {
      pages.push(createMockPage(i));
    }
  }

  return {
    numPages: pageCount,
    getPage: vi.fn((pageNum: number) => {
      if (options?.throwOnGetPage) {
        return Promise.reject(new Error(`Error al obtener página ${pageNum}`));
      }
      return Promise.resolve(pages[pageNum - 1]);
    }),
    getMetadata: vi.fn(() =>
      Promise.resolve({
        info: {
          ...(options?.metadata ?? { Title: "Test", Producer: "TestApp" }),
          IsAcroFormPresent: options?.hasForms === true,
        },
        metadata: undefined,
      }),
    ),
    destroy: vi.fn(),
    _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
  };
}
