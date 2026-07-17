/**
 * Tests de seguridad de @anonly/export-engine (Export_Engine.md §14,
 * 08_Security_Model.md §4/§5, ADR-004, ADR-009).
 *
 * A diferencia de src/__tests__/*.test.ts (que mockean la frontera de
 * pdf-lib, Code_Standards.md §10 / ADR-021 §5), estos tests usan pdf-lib
 * REAL: validan el artefacto binario producido, no la lógica interna del
 * motor. `pnpm test:security` corre `--dir tests/security` (07_Performance_Strategy.md §11.4).
 *
 * Export no lee nunca el PDF original: recibe un `Document` ya parseado
 * (solo usa `pages[i].width/height` para dimensiones) y un
 * `RenderPageProvider` que entrega imágenes ya renderizadas. Estos tests
 * inyectan valores "sensibles" conocidos (nombre/DNI del contenido documentado
 * de `tests/fixtures/text-10p.pdf`, ver `tests/fixtures/README.md`) en el
 * `Document`/`EntityGroup[]` de entrada y verifican que ninguno sobrevive en
 * el artefacto final — la garantía estructural es que Export jamás copia
 * texto/metadata del original, sin importar qué contengan.
 */
import {
  ExportEngine,
  type EncodedPageImage,
  type ExportEngineInput,
  type RenderPageProvider,
} from "@anonly/export-engine";
import {
  DetectionSource,
  EntityType,
  ReplacementMode,
  type Document,
  type EngineConfig,
  type EngineContext,
  type EntityGroup,
  type ExportOptions,
} from "@anonly/shared";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";

// 1x1 PNG transparente, constante conocida — la única "imagen" que ve pdf-lib.
// No se deriva de ningún texto original: prueba que Export no tiene forma de
// filtrar contenido sensible a través de la imagen (nunca lo recibe).
const MINIMAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Contenido sensible conocido de tests/fixtures/text-10p.pdf (README §"Contenido
// conocido"): usado acá solo como texto de entrada sintético (Export no parsea
// PDFs), no se lee el archivo real.
const SENSITIVE_NAME = "Juan Perez";
const SENSITIVE_DNI = "34.567.891";
const ORIGINAL_TITLE = "Documento Original Confidencial de Juan Perez";

function buildSensitiveDocument(): Document {
  return {
    id: "doc-security",
    name: "text-10p.pdf",
    pageCount: 2,
    pages: [
      {
        index: 0,
        width: 200,
        height: 200,
        words: [],
        text: `${SENSITIVE_NAME} vive en Belgrano 1234, DNI ${SENSITIVE_DNI}.`,
        requiresOCR: false,
        ocrCompleted: false,
      },
      {
        index: 1,
        width: 200,
        height: 200,
        words: [],
        text: "Pagina sin datos sensibles.",
        requiresOCR: false,
        ocrCompleted: false,
      },
    ],
    metadata: {
      title: ORIGINAL_TITLE,
      producer: "Acrobat Distiller (original)",
      pdfVersion: "1.7",
      encrypted: false,
      hasForms: false,
    },
    sourceKind: "text",
    importedAt: Date.now(),
  };
}

function buildSensitiveGroups(): ReadonlyArray<EntityGroup> {
  return [
    {
      id: "group-dni",
      type: EntityType.DNI,
      canonicalValue: SENSITIVE_DNI,
      members: [
        {
          occurrenceId: "occ-dni",
          pageIndex: 0,
          bbox: { x: 10, y: 10, width: 80, height: 14 },
          source: DetectionSource.Regex,
        },
      ],
      replacementMode: ReplacementMode.Placeholder,
      replacementValue: "[DNI 01]",
      indexInType: 1,
      enabled: true,
      aliases: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: "group-person",
      type: EntityType.Person,
      canonicalValue: SENSITIVE_NAME,
      members: [
        {
          occurrenceId: "occ-person",
          pageIndex: 0,
          bbox: { x: 10, y: 30, width: 80, height: 14 },
          source: DetectionSource.NER,
        },
      ],
      replacementMode: ReplacementMode.Placeholder,
      replacementValue: "[PERSON 01]",
      indexInType: 1,
      enabled: true,
      aliases: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
}

function createRealRenderPageProvider(): RenderPageProvider {
  return {
    renderFull(_pageIndex, _replacements, _abortSignal): Promise<EncodedPageImage> {
      return Promise.resolve({
        bytes: base64ToArrayBuffer(MINIMAL_PNG_BASE64),
        format: "png",
        widthPx: 1,
        heightPx: 1,
      });
    },
  };
}

function createEngineConfig(): EngineConfig {
  return {
    workerPool: {
      pdfPoolSize: 1,
      ocrPoolSize: 1,
      nerPoolSize: 1,
      renderPoolSize: 1,
      maxQueuePerPool: 32,
      timeouts: {
        "pdf-parse": 30000,
        "ocr-page": 60000,
        "ner-page": 20000,
        "render-page": 10000,
        "export-page": 30000,
      },
      maxRetries: {
        "pdf-parse": 1,
        "ocr-page": 2,
        "ner-page": 1,
        "render-page": 1,
        "export-page": 1,
      },
      baseRetryDelayMs: 250,
      maxRetryDelayMs: 2000,
      cancelSlaMs: 200,
      idleDisposeMs: 60000,
    },
    pdf: { maxPageCount: 10000 },
    ner: {
      modelId: "test",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 1,
      enabled: false,
    },
    ocr: { languages: ["spa"], dpi: 300 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 1, fullScale: 2.08, jpegQuality: 0.85, cachePages: 16 },
    export: { defaultDpi: 150, defaultImageFormat: "jpeg", defaultJpegQuality: 0.85 },
  };
}

function createEngineContext(): EngineContext {
  return {
    bus: {
      on: () => () => undefined,
      once: () => () => undefined,
      off: () => undefined,
      emit: () => undefined,
      emitAsync: () => Promise.resolve(),
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    cache: {
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
      clear: () => undefined,
      size: 0,
      bytes: 0,
    },
    abortSignal: new AbortController().signal,
    config: createEngineConfig(),
  };
}

describe("export-engine — security", () => {
  let exportBuffer: ArrayBuffer;
  let reloaded: PDFDocument;

  beforeAll(async () => {
    const engine = new ExportEngine();
    const ctx = createEngineContext();
    await engine.init(ctx);

    const options: ExportOptions = {
      imageFormat: "png",
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false,
      filename: "anonimizado.pdf",
    };

    const input: ExportEngineInput = {
      documentId: "doc-security",
      document: buildSensitiveDocument(),
      groups: buildSensitiveGroups(),
      rules: [],
      options,
      renderPageProvider: createRealRenderPageProvider(),
    };

    const result = await engine.export(input, ctx);
    exportBuffer = result.buffer;
    // updateMetadata: false — evita que la propia carga pise producer/creator
    // con los defaults de pdf-lib (pdf-lib resetea Producer/ModificationDate
    // en el constructor de PDFDocument.load/create salvo que se lo desactive).
    reloaded = await PDFDocument.load(exportBuffer, { updateMetadata: false });
  });

  it("no original text recoverable in export", async () => {
    // Recarga y reserializa SIN compresión de object streams: la salida real
    // de Export usa useObjectStreams:true (spec §12), lo que comprime la
    // mayoría de los objetos y haría un grep binario directo poco confiable
    // (falsos negativos). Reserializar sin comprimir expone el texto plano
    // de cualquier string embebida para una búsqueda honesta.
    const uncompressed = await reloaded.save({ useObjectStreams: false });
    const asText = Buffer.from(uncompressed).toString("latin1");

    expect(asText).not.toContain(SENSITIVE_NAME);
    expect(asText).not.toContain(SENSITIVE_DNI);
    expect(asText).not.toContain(ORIGINAL_TITLE);
  });

  it("export metadata has no author/creator/title from original", () => {
    expect(reloaded.getTitle()).toBeUndefined();
    expect(reloaded.getAuthor()).toBeUndefined();
    expect(reloaded.getTitle()).not.toBe(ORIGINAL_TITLE);
    expect(reloaded.getProducer()).toBe("Anonly");
    expect(reloaded.getCreator()).toBe("Anonly");
  });

  it("export has no XMP from original", () => {
    const metadataEntry = reloaded.catalog.lookup(PDFName.of("Metadata"));
    expect(metadataEntry).toBeUndefined();
  });

  it("export has no text layer", () => {
    const pages = reloaded.getPages();
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const resources = page.node.Resources();
      const fontEntry = resources?.lookup(PDFName.of("Font"));
      const fontDict = fontEntry instanceof PDFDict ? fontEntry : undefined;
      // O no hay dict de Font, o está vacío (pdf-lib crea uno vacío como
      // efecto colateral de normalizedEntries() al dibujar la imagen). Ninguno
      // de los dos casos permite extraer texto: sin una entrada de fuente
      // real, no hay operador Tj/TJ válido posible.
      expect(fontDict === undefined || fontDict.keys().length === 0).toBe(true);
    }
  });
});
