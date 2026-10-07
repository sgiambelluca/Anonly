import {
  CancelledError,
  EngineDisposedError,
  EngineEvents,
  EntityType,
  InvalidInputError,
  type EngineContext,
  type BoundingBox,
  type EntityFound,
  type NerModelLoading,
} from "@anonly/shared";
import { env, pipeline } from "@huggingface/transformers";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: {
    allowRemoteModels: true,
    localModelPath: "/models/",
    backends: { onnx: { wasm: {} } },
  },
}));

import { NerEngine } from "../ner.engine.js";
import { NerModelMissingError } from "../ner.errors.js";

import { extendedAddressText } from "./fixtures/address-helpers.js";
import {
  asPipelineMock,
  createEngineContext,
  createResolvedNerPool,
  makeNerPageInput,
  mockTokenClassificationPipeline,
  nerToken,
} from "./fixtures/test-helpers.js";

describe("NerEngine — edge case tests", () => {
  let engine: NerEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new NerEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  // Caso 1 (§13): texto vacío.
  describe("Caso 1: texto vacío", () => {
    it("empty text returns empty occurrences", async () => {
      await engine.init(ctx);
      const input = makeNerPageInput("doc-empty-text", 0, [], { text: "" });
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences).toEqual([]);
      expect(pipeline).not.toHaveBeenCalled();
    });
  });

  // Caso 2 (§13): texto sin entidades.
  describe("Caso 2: texto sin entidades", () => {
    it("text without entities returns empty", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("O", "El"),
            nerToken("O", "cielo"),
            nerToken("O", "es"),
            nerToken("O", "azul"),
          ]),
        ),
      );
      await engine.init(ctx);
      const input = makeNerPageInput("doc-no-entities", 0, ["El", "cielo", "es", "azul"]);
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences).toEqual([]);
    });
  });

  // Caso 3 (§13): nombre compuesto ("Juan Pérez García").
  describe("Caso 3: nombre compuesto", () => {
    it("multi-word name produces single occurrence", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("B-PER", "Juan", 0.95, 0),
            nerToken("I-PER", "Pérez", 0.93, 1),
            nerToken("I-PER", "García", 0.9, 2),
          ]),
        ),
      );
      await engine.init(ctx);
      const input = makeNerPageInput("doc-compound-name", 0, ["Juan", "Pérez", "García"]);
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences).toHaveLength(1);
      expect(output.occurrences[0]?.entityType).toBe(EntityType.Person);
      expect(output.occurrences[0]?.value).toBe("Juan Pérez García");
    });
  });

  // Caso 5 (§13): confidence baja (< 0.7).
  describe("Caso 5: confidence baja", () => {
    it("low confidence still emitted with real value", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-ORG", "Acme", 0.42, 0)]),
        ),
      );
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const input = makeNerPageInput("doc-low-confidence", 0, ["Acme"]);
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences).toHaveLength(1);
      const occurrence = output.occurrences[0];
      expect(occurrence?.confidence).toBeCloseTo(0.42, 5);
      expect(occurrence?.value).toBe("Acme");

      // La ocurrencia se emite igual (Grouping es quien marca low_confidence).
      const entityFoundCall = busEmitSpy.mock.calls.find(
        ([, event]) => event === EngineEvents.ENTITY_FOUND,
      );
      expect(entityFoundCall).toBeDefined();
      expect((entityFoundCall?.[2] as EntityFound).occurrence.confidence).toBeLessThan(0.7);
    });
  });

  // Caso 7 (§13): modelo no descargado (primera vez), progreso reportado.
  describe("Caso 7: modelo no descargado (primera vez)", () => {
    it("model loading progress reported", async () => {
      asPipelineMock(pipeline).mockImplementation((_task, _model, options) => {
        options?.progress_callback?.({ status: "initiate" });
        options?.progress_callback?.({ status: "download" });
        options?.progress_callback?.({ status: "progress", progress: 25, loaded: 25, total: 100 });
        options?.progress_callback?.({
          status: "progress",
          progress: 100,
          loaded: 100,
          total: 100,
        });
        options?.progress_callback?.({ status: "done" });
        return Promise.resolve(mockTokenClassificationPipeline(() => Promise.resolve([])));
      });

      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const input = makeNerPageInput("doc-loading", 0, ["Hola"]);
      await engine.processPage(input, ctx);

      const loadingCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.NER_MODEL_LOADING,
      );
      expect(loadingCalls).toHaveLength(2);
      const progresses = loadingCalls.map((call) => (call[2] as NerModelLoading).progress);
      expect(progresses).toEqual([0.25, 1]);

      const readyCall = busEmitSpy.mock.calls.find(
        ([, event]) => event === EngineEvents.NER_MODEL_READY,
      );
      expect(readyCall).toBeDefined();
    });
  });

  // Caso 8 (§13): modelo corrupto en cache.
  describe("Caso 8: modelo corrupto en cache", () => {
    it("corrupt model triggers re-download", async () => {
      const mocked = asPipelineMock(pipeline);
      mocked.mockRejectedValueOnce(new Error("modelo corrupto (checksum inválido)"));
      mocked.mockResolvedValueOnce(mockTokenClassificationPipeline(() => Promise.resolve([])));

      await engine.init(ctx);
      const input = makeNerPageInput("doc-corrupt-model", 0, ["Hola"]);
      const output = await engine.processPage(input, ctx);

      expect(pipeline).toHaveBeenCalledTimes(2);
      expect(output.occurrences).toEqual([]);
      expect(engine.isModelReady()).toBe(true);
    });

    it("persistent load failure escalates to NerModelMissingError", async () => {
      asPipelineMock(pipeline).mockRejectedValue(new Error("modelo corrupto (checksum inválido)"));

      await engine.init(ctx);
      const input = makeNerPageInput("doc-model-missing", 0, ["Hola"]);
      await expect(engine.processPage(input, ctx)).rejects.toThrow(NerModelMissingError);
      expect(pipeline).toHaveBeenCalledTimes(2);
    });
  });

  // Caso 11 (§13): NER desactivado en settings.
  describe("Caso 11: NER desactivado en settings", () => {
    it("disabled NER returns empty occurrences without loading model", async () => {
      const disabledCtx = createEngineContext({
        config: { ...ctx.config, ner: { ...ctx.config.ner, enabled: false } },
      });
      await engine.init(disabledCtx);
      const input = makeNerPageInput("doc-disabled", 0, ["Juan", "Pérez"]);
      const output = await engine.processPage(input, disabledCtx);

      expect(output.occurrences).toEqual([]);
      expect(pipeline).not.toHaveBeenCalled();
      expect(engine.isModelReady()).toBe(false);
    });
  });

  // Caso 15 (§13, ADR-023 §2): fecha escrita en palabras.
  describe("Caso 15: fecha escrita en palabras", () => {
    it("written-out date mapped to Date", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("B-DATE", "3", 0.88, 0),
            nerToken("I-DATE", "de", 0.87, 1),
            nerToken("I-DATE", "mayo", 0.9, 2),
            nerToken("I-DATE", "de", 0.86, 3),
            nerToken("I-DATE", "2024", 0.91, 4),
          ]),
        ),
      );
      await engine.init(ctx);
      const input = makeNerPageInput("doc-written-date", 0, [
        "Firmado",
        "el",
        "3",
        "de",
        "mayo",
        "de",
        "2024",
        "en",
        "Buenos",
        "Aires.",
      ]);
      const output = await engine.processPage(input, ctx);

      const dateOccurrence = output.occurrences.find((o) => o.entityType === EntityType.Date);
      expect(dateOccurrence).toBeDefined();
      expect(dateOccurrence?.value).toBe("3 de mayo de 2024");
    });
  });

  // Caso 16 (§13, ADR-039): wasmPaths inyectado por config.
  describe("Caso 16: wasmPaths inyectado por config", () => {
    it("injected wasmPaths applied verbatim, not overridden by default", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() => Promise.resolve([])),
      );

      // Forma string (prefijo de directorio).
      const stringCtx = createEngineContext({
        config: { ...ctx.config, ner: { ...ctx.config.ner, wasmPaths: "/custom/onnxruntime/" } },
      });
      await engine.init(stringCtx);
      await engine.processPage(makeNerPageInput("doc-wasm-string", 0, ["Hola"]), stringCtx);
      expect(env.backends.onnx.wasm?.wasmPaths).toBe("/custom/onnxruntime/");
      await engine.dispose();

      // Forma objeto ({ wasm?, mjs? }, URLs explícitas por archivo).
      engine = new NerEngine();
      const objectPaths = { wasm: "/assets/ort.wasm", mjs: "/assets/ort.mjs" };
      const objectCtx = createEngineContext({
        config: { ...ctx.config, ner: { ...ctx.config.ner, wasmPaths: objectPaths } },
      });
      await engine.init(objectCtx);
      await engine.processPage(makeNerPageInput("doc-wasm-object", 0, ["Hola"]), objectCtx);
      expect(env.backends.onnx.wasm?.wasmPaths).toEqual(objectPaths);
    });

    it("absent wasmPaths falls back to /wasm/onnxruntime/", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() => Promise.resolve([])),
      );

      await engine.init(ctx);
      await engine.processPage(makeNerPageInput("doc-wasm-default", 0, ["Hola"]), ctx);
      expect(env.backends.onnx.wasm?.wasmPaths).toBe("/wasm/onnxruntime/");
    });
  });

  // Caso 13 (§13): processPage tras dispose.
  describe("Caso 13: processPage tras dispose", () => {
    it("throws EngineDisposedError after dispose", async () => {
      await engine.init(ctx);
      await engine.dispose();

      const input = makeNerPageInput("doc-after-dispose", 0, ["Hola"]);
      await expect(engine.processPage(input, ctx)).rejects.toThrow(EngineDisposedError);
    });

    it("processPages also throws EngineDisposedError after dispose", async () => {
      await engine.init(ctx);
      await engine.dispose();

      const inputs = [makeNerPageInput("doc-after-dispose-2", 0, ["Hola"])];
      await expect(engine.processPages(inputs, ctx)).rejects.toThrow(EngineDisposedError);
    });
  });

  // No numerado en §13 (regla de §9 Restricciones: input null/undefined).
  describe("Null/undefined input", () => {
    it("throws InvalidInputError for null input in processPage", async () => {
      await engine.init(ctx);
      // @ts-expect-error — assert de runtime: §9 exige rechazar input inválido con InvalidInputError
      await expect(engine.processPage(null, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("throws InvalidInputError for null inputs in processPages", async () => {
      await engine.init(ctx);
      // @ts-expect-error — assert de runtime: §9 exige rechazar input inválido con InvalidInputError
      await expect(engine.processPages(null, ctx)).rejects.toThrow(InvalidInputError);
    });
  });

  // No numerado en §13 (regla de §9 Restricciones: pageIndex >= 0).
  describe("pageIndex inválido", () => {
    it("throws InvalidInputError for negative pageIndex", async () => {
      await engine.init(ctx);
      const input = makeNerPageInput("doc-neg-idx", -1, ["Hola"]);
      await expect(engine.processPage(input, ctx)).rejects.toThrow(InvalidInputError);
    });
  });

  // No numerado en §13 (cancelación cooperativa por checkpoint; el SLA
  // estricto < 200ms funcional se cubre en cancel.test.ts).
  describe("Cancelación cooperativa (checkpoint)", () => {
    it("throws CancelledError when abort is signalled before processing starts", async () => {
      const abortController = new AbortController();
      const abortedCtx = createEngineContext({ abortSignal: abortController.signal });
      abortController.abort();

      await engine.init(abortedCtx);
      const input = makeNerPageInput("doc-cancelled", 0, ["Hola"]);
      await expect(engine.processPage(input, abortedCtx)).rejects.toThrow(CancelledError);
      expect(pipeline).not.toHaveBeenCalled();
    });

    it("stops processing remaining pages once aborted mid-batch", async () => {
      const abortController = new AbortController();
      const abortedCtx = createEngineContext({ abortSignal: abortController.signal });

      // El propio classify() de la página 0 dispara el abort como efecto
      // colateral, simulando una cancelación del usuario a mitad de proceso.
      const classify = vi.fn(() => {
        abortController.abort();
        return Promise.resolve([]);
      });
      asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

      await engine.init(abortedCtx);
      const inputs = [
        makeNerPageInput("doc-cancel-mid", 0, ["Hola"]),
        makeNerPageInput("doc-cancel-mid", 1, ["Chau"]),
      ];

      await expect(engine.processPages(inputs, abortedCtx)).rejects.toThrow(CancelledError);
      expect(classify).toHaveBeenCalledTimes(1);
    });
  });

  // Sobre del dispatch, obligatorio (ADR-055 §5, NER_Engine.md §14): un
  // `NerJobPool.dispatch()` que resuelve una forma no reconocida (ni el sobre
  // remoto `{ spans }` ni el array pelado in-process) tiene que lanzar
  // `InvalidInputError` en vez de devolver un default en silencio — es
  // exactamente el modo de falla que dejó a NER sin detectar ninguna entidad
  // en producción durante semanas (nota v1.2.1, NER_Engine.md).
  describe("Sobre del dispatch: forma no reconocida (ADR-055 §5)", () => {
    it("throws on an unrecognized dispatch result", async () => {
      const garbageValues: ReadonlyArray<unknown> = [{}, null, "not-a-recognized-shape"];

      for (const garbage of garbageValues) {
        const pool = createResolvedNerPool(garbage);
        const pooledEngine = new NerEngine(pool);
        await pooledEngine.init(ctx);
        const busEmitSpy = vi.spyOn(ctx.bus, "emit");
        const inputs = [makeNerPageInput("doc-garbage-dispatch", 0, ["Juan"])];

        // processPages() — no processPage() — es el path real de producción
        // (orchestrator.ts nunca llama processPage() directo, ADR-055 §5):
        // el bug original vivía específicamente en su warn+continue
        // (ner.engine.ts, "NER de la página ... falló; se descartan..."),
        // que convertía un TypeError en NER_FINISHED con occurrenceCount: 0
        // sin dejar rastro salvo un logger.warn con el logger nulo de
        // producción. El error tiene que propagarse hacia afuera de
        // processPages(), no quedar atrapado ahí.
        await expect(pooledEngine.processPages(inputs, ctx)).rejects.toBeInstanceOf(
          InvalidInputError,
        );

        // "no se traga silenciosamente aguas arriba" (ADR-055 §5): ni la
        // página ni el documento completo se reportan como terminados — a
        // diferencia del bug original, en el que NER_FINISHED con
        // occurrenceCount: 0 pasaba sin que nada lo delatara.
        expect(
          busEmitSpy.mock.calls.some(([, event]) => event === EngineEvents.NER_PAGE_FINISHED),
        ).toBe(false);
        expect(busEmitSpy.mock.calls.some(([, event]) => event === EngineEvents.NER_FINISHED)).toBe(
          false,
        );

        await pooledEngine.dispose();
      }
    });
  });

  // ─── Caso 34 (ADR-212): la dirección incluye la altura que la sigue ───

  describe("Caso 34: extensión de Address hasta la altura", () => {
    /** Lo que abarca el span `span` en `text` tras la extensión. */
    const extended = extendedAddressText;

    it("address span keeps a year-like number out without an address cue", async () => {
      // De punta a punta: el modelo marca «Rosario» y el año queda afuera.
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-LOC", "Rosario", 0.9, 2)]),
        ),
      );
      await engine.init(ctx);
      const input = makeNerPageInput("doc-year-no-cue", 0, [
        "Se",
        "realizó",
        "Rosario",
        "2019",
        "y",
        "otra",
      ]);
      const output = await engine.processPage(input, ctx);
      expect(output.occurrences.map((o) => o.value)).toEqual(["Rosario"]);

      // Los bordes del criterio: 1900 y 2099 son años, 1899 y 2100 no.
      expect(extended("Se hizo en Rosario 1900 ya", "Rosario")).toBe("Rosario");
      expect(extended("Se hizo en Rosario 2099 ya", "Rosario")).toBe("Rosario");
      expect(extended("Se hizo en Rosario 1899 ya", "Rosario")).toBe("Rosario 1899");
      expect(extended("Se hizo en Rosario 2100 ya", "Rosario")).toBe("Rosario 2100");
      // Año es exactamente cuatro dígitos: con cinco o con cero a la izquierda no.
      expect(extended("Se hizo en Rosario 01950 ya", "Rosario")).toBe("Rosario 01950");
      expect(extended("Se hizo en Rosario 195 ya", "Rosario")).toBe("Rosario 195");
      // Una palabra de dirección fuera de la ventana no cuenta.
      expect(extended("domicilio a b c d e f Rosario 2019 ya", "Rosario")).toBe("Rosario");
      expect(extended("Rosario 2019 a b c d piso", "Rosario")).toBe("Rosario");
    });

    it("address span takes a year-like number with a cue before or after", () => {
      const cuesBefore = [
        "domicilio",
        "domiciliado",
        "domiciliada",
        "domiciliados",
        "domiciliadas",
        "calle",
        "avenida",
        "av.",
        "avda.",
        "sito",
        "sita",
        "vive",
        "viven",
        "reside",
        "residen",
      ];
      for (const cue of cuesBefore) {
        expect(extended(`Juan ${cue} Rosario 2019 fin`, "Rosario")).toBe("Rosario 2019");
      }
      // Sin distinguir mayúsculas ni tildes, y con la puntuación de los bordes recortada.
      expect(extended("DOMICILIO Rosario 2019", "Rosario")).toBe("Rosario 2019");
      expect(extended("Domicilio: Rosario 2019", "Rosario")).toBe("Rosario 2019");
      expect(extended("SÍTA Rosario 2019", "Rosario")).toBe("Rosario 2019");
      expect(extended("Av Rosario 2019", "Rosario")).toBe("Rosario 2019");
      expect(extended("(calle), Rosario 2019", "Rosario")).toBe("Rosario 2019");
      // Palabra entera: un prefijo o una palabra más larga no es la entrada.
      expect(extended("domiciliario Rosario 2019", "Rosario")).toBe("Rosario");
      expect(extended("calles Rosario 2019", "Rosario")).toBe("Rosario");

      // Ventana anterior: seis palabras sí, siete no.
      expect(extended("domicilio a b c d e Rosario 2019", "Rosario")).toBe("Rosario 2019");
      expect(extended("domicilio a b c d e f Rosario 2019", "Rosario")).toBe("Rosario");
      // Como primera palabra del propio span.
      expect(extended("Juan en calle Rosario 2019", "calle Rosario")).toBe("calle Rosario 2019");
      expect(extended("Juan en Av. Rosario 2019", "Av. Rosario")).toBe("Av. Rosario 2019");
      // El resto anterior del tramo donde empieza el span no es una palabra anterior...
      expect(extended("(Rosario 2019", "Rosario")).toBe("Rosario");
      expect(extended("domicilio(Rosario 2019", "Rosario")).toBe("Rosario");
      // ...pero la palabra anterior completa sí cuenta.
      expect(extended("domicilio (Rosario 2019", "Rosario")).toBe("Rosario 2019");

      const cuesAfter = ["piso", "departamento", "depto.", "dpto."];
      for (const cue of cuesAfter) {
        expect(extended(`Juan en Rosario 2019 ${cue} 3`, "Rosario")).toBe("Rosario 2019");
      }
      expect(extended("Rosario 2019, PISO 3", "Rosario")).toBe("Rosario 2019");
      expect(extended("Rosario 2019 Pisó", "Rosario")).toBe("Rosario 2019");
      expect(extended("Rosario 2019 Dpto, B", "Rosario")).toBe("Rosario 2019");
      expect(extended("Rosario 2019 de esta ciudad", "Rosario")).toBe("Rosario 2019");
      expect(extended("Rosario 2019, de la localidad de X", "Rosario")).toBe("Rosario 2019");
      // Ventana posterior: cuatro palabras sí, cinco no.
      expect(extended("Rosario 2019 a b c piso", "Rosario")).toBe("Rosario 2019");
      expect(extended("Rosario 2019 a b c d piso", "Rosario")).toBe("Rosario");
      // Una secuencia tiene que caber entera en la ventana.
      expect(extended("Rosario 2019 a de esta ciudad", "Rosario")).toBe("Rosario 2019");
      expect(extended("Rosario 2019 a b de esta ciudad", "Rosario")).toBe("Rosario");
      expect(extended("Rosario 2019 a de la localidad", "Rosario")).toBe("Rosario 2019");
      expect(extended("Rosario 2019 a b de la localidad", "Rosario")).toBe("Rosario");
      // Palabra entera, y la cola pegada a los dígitos no es una palabra.
      expect(extended("Rosario 2019 pisos 3", "Rosario")).toBe("Rosario");
      expect(extended("Rosario 2019piso 3", "Rosario")).toBe("Rosario");
      expect(extended("Rosario 2019 de esta", "Rosario")).toBe("Rosario");
      // Un número que no es año no necesita ninguna palabra de dirección.
      expect(extended("Rosario 3019", "Rosario")).toBe("Rosario 3019");
    });

    it("address number accepts the N°, nro, número and al connectors", async () => {
      const connectors = ["N°", "Nº", "No.", "nro", "nro.", "número", "numero", "al"];
      for (const connector of connectors) {
        for (const spaces of ["", " ", "  "]) {
          const tail = `${connector}${spaces}1434`;
          expect(extended(`Reunión en Maipú ${tail} hoy`, "Maipú")).toBe(`Maipú ${tail}`);
        }
        // Sin distinguir mayúsculas; uno o dos espacios entre la calle y el conector.
        expect(extended(`En Maipú  ${connector.toUpperCase()} 55`, "Maipú")).toBe(
          `Maipú  ${connector.toUpperCase()} 55`,
        );
        // Un conector sin dígitos después no extiende.
        expect(extended(`Reunión en Maipú ${connector} hoy`, "Maipú")).toBe("Maipú");
        expect(extended(`Reunión en Maipú ${connector}`, "Maipú")).toBe("Maipú");
        // Ni con más de dos espacios antes de los dígitos.
        expect(extended(`Reunión en Maipú ${connector}   1434`, "Maipú")).toBe("Maipú");
      }
      // Un conector que no es de la lista no es un conector.
      expect(extended("Reunión en Maipú no 1434", "Maipú")).toBe("Maipú");
      expect(extended("Reunión en Maipú alto 1434", "Maipú")).toBe("Maipú");
      // El año con conector sigue necesitando una palabra de dirección.
      expect(extended("Reunión en Rosario nro. 2019", "Rosario")).toBe("Rosario");
      expect(extended("Vive en Rosario nro. 2019", "Rosario")).toBe("Rosario nro. 2019");

      // De punta a punta: el conector queda dentro del valor y de la caja.
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-LOC", "Maipú", 0.9, 2)]),
        ),
      );
      await engine.init(ctx);
      const input = makeNerPageInput("doc-address-connector", 0, [
        "En",
        "la",
        "Maipú",
        "nro.",
        "55",
      ]);
      const output = await engine.processPage(input, ctx);
      expect(output.occurrences.map((o) => o.value)).toEqual(["Maipú nro. 55"]);
      expect(output.occurrences[0]?.wordSpan).toEqual({ startIndex: 2, endIndexExclusive: 5 });
    });

    it("address number stops at dates, decimals and ranges", () => {
      const notAnAltura = [
        "1434/2",
        "12/03/2022",
        "1434,5",
        "1434.5",
        "1.434",
        "1,434",
        "12-15",
        "12‐15",
        "12‑15",
        "12–15",
        "12—15",
        "143456",
        "1434567",
      ];
      for (const tail of notAnAltura) {
        expect(extended(`Reunión en Maipú ${tail} hoy`, "Maipú")).toBe("Maipú");
      }
      // La puntuación sola, sin un dígito después, no impide la altura.
      expect(extended("En Maipú 1434, piso 3", "Maipú")).toBe("Maipú 1434");
      expect(extended("En Maipú 1434. Luego", "Maipú")).toBe("Maipú 1434");
      expect(extended("En Maipú 1434- luego", "Maipú")).toBe("Maipú 1434");
      expect(extended("En Maipú 1434– luego", "Maipú")).toBe("Maipú 1434");
      expect(extended("En Maipú 14345 luego", "Maipú")).toBe("Maipú 14345");
      expect(extended("En Maipú 7", "Maipú")).toBe("Maipú 7");
      // Lo que sigue al span tiene que ser espacio en blanco: una coma lo corta.
      expect(extended("En Maipú, 1434", "Maipú")).toBe("Maipú");
      expect(extended("En Maipú1434", "Maipú")).toBe("Maipú");
      // Más de dos espacios, o ninguno número, tampoco.
      expect(extended("En Maipú   1434", "Maipú")).toBe("Maipú");
      expect(extended("En Maipú  1434", "Maipú")).toBe("Maipú  1434");
      expect(extended("En Maipú hoy 1434", "Maipú")).toBe("Maipú");
    });

    type Rotation = NonNullable<BoundingBox["rotation"]>;
    const ROTATED_ANGLES: ReadonlyArray<Rotation> = [90, 270];

    it("address extension does not cross into a word of a different rotation", async () => {
      // El modelo ve cada batch por separado (ADR-088 §1): marca «Maipú»
      // cuando está en el texto del batch.
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline((text: string) =>
          Promise.resolve(text.includes("Maipú") ? [nerToken("B-LOC", "Maipú", 0.9, 0)] : []),
        ),
      );
      await engine.init(ctx);

      const withRotations = (
        tokens: ReadonlyArray<string>,
        rotations: ReadonlyArray<Rotation | undefined>,
      ) => {
        const base = makeNerPageInput("doc-address-rotation", 0, tokens);
        return {
          ...base,
          words: base.words.map((word, i) => {
            const rotation = rotations[i];
            return rotation === undefined ? word : { ...word, bbox: { ...word.bbox, rotation } };
          }),
        };
      };

      // La dirección termina el texto horizontal y la sigue, en Page.text, un
      // número que pertenece a un run rotado (el folio del margen).
      for (const angle of ROTATED_ANGLES) {
        const input = withRotations(
          ["Vive", "en", "Maipú", "1434"],
          [undefined, undefined, undefined, angle],
        );
        const output = await engine.processPage(input, ctx);

        expect(output.occurrences).toHaveLength(1);
        const [occurrence] = output.occurrences;
        expect(occurrence?.value).toBe("Maipú");
        expect(occurrence?.normalizedValue).toBe("maipu");
        // Sin caja envolvente: la caja es la de la palabra «Maipú», sin ángulo.
        expect(occurrence?.bbox).toEqual(input.words[2]?.bbox);
        expect(occurrence?.bbox.rotation).toBeUndefined();
        expect(occurrence?.fragments).toBeUndefined();
        expect(occurrence?.wordSpan).toEqual({ startIndex: 2, endIndexExclusive: 3 });
      }

      // Lo mismo si lo rotado es el conector y el número (el tramo agregado).
      const connectorInput = withRotations(
        ["Vive", "en", "Maipú", "N°", "1434"],
        [undefined, undefined, undefined, 270, 270],
      );
      const connectorOutput = await engine.processPage(connectorInput, ctx);
      expect(connectorOutput.occurrences.map((o) => o.value)).toEqual(["Maipú"]);

      // Con un solo de los dos del tramo en otro ángulo alcanza para no cruzar.
      const halfRotatedInput = withRotations(
        ["Vive", "en", "Maipú", "N°", "1434"],
        [undefined, undefined, undefined, undefined, 90],
      );
      const halfRotatedOutput = await engine.processPage(halfRotatedInput, ctx);
      expect(halfRotatedOutput.occurrences.map((o) => o.value)).toEqual(["Maipú"]);

      // Con la calle y el número en el mismo ángulo sí se extiende, y la
      // ocurrencia lleva ese ángulo.
      for (const angle of ROTATED_ANGLES) {
        const input = withRotations(
          ["Vive", "en", "Maipú", "1434"],
          [undefined, undefined, angle, angle],
        );
        const output = await engine.processPage(input, ctx);

        expect(output.occurrences).toHaveLength(1);
        const [occurrence] = output.occurrences;
        expect(occurrence?.value).toBe("Maipú 1434");
        expect(occurrence?.wordSpan).toEqual({ startIndex: 2, endIndexExclusive: 4 });
        expect(occurrence?.bbox.rotation).toBe(angle);
      }

      // Y con todo el texto en el mismo ángulo (ninguno rotado) también.
      const horizontal = withRotations(["Vive", "en", "Maipú", "1434"], []);
      const horizontalOutput = await engine.processPage(horizontal, ctx);
      expect(horizontalOutput.occurrences.map((o) => o.value)).toEqual(["Maipú 1434"]);
    });
  });
});
