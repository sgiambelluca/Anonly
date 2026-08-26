import {
  CancelledError,
  EngineError,
  EngineEvents,
  EntityType,
  EventChannel,
  type EngineContext,
  type EntityFound,
  type NerFinished,
  type NerKernelSpan,
  type NerModelReady,
  type NerPageFinished,
} from "@anonly/shared";
import { pipeline } from "@huggingface/transformers";
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
import { NerModelMissingError, NerPageFailedError, NerTimeoutError } from "../ner.errors.js";

import {
  asPipelineMock,
  createEngineContext,
  createMockConfig,
  createResolvedNerPool,
  makeNerPageInput,
  mockTokenClassificationPipeline,
  nerToken,
  type NerPoolDispatchParams,
} from "./fixtures/test-helpers.js";

describe("NerEngine — unit tests", () => {
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

  it("confidence ∈ [0,1] (promedio de los scores de los tokens del span)", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-PER", "Juan", 0.8, 0), nerToken("I-PER", "Pérez", 0.6, 1)]),
      ),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-confidence", 0, ["Juan", "Pérez"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    const confidence = output.occurrences[0]?.confidence ?? -1;
    expect(confidence).toBeCloseTo(0.7, 5);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("bbox mapped correctly to words (unión de las Word que componen la entidad)", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0), nerToken("I-PER", "Pérez", 0.9, 1)]),
      ),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-bbox", 0, ["Juan", "Pérez", "vive", "en", "Madrid"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    const occurrence = output.occurrences[0];
    const words = input.words;
    const wordJuan = words[0];
    const wordPerez = words[1];
    expect(wordJuan).toBeDefined();
    expect(wordPerez).toBeDefined();
    if (wordJuan === undefined || wordPerez === undefined) throw new Error("unreachable");

    const expectedX = Math.min(wordJuan.bbox.x, wordPerez.bbox.x);
    const expectedY = Math.min(wordJuan.bbox.y, wordPerez.bbox.y);
    const expectedRight = Math.max(
      wordJuan.bbox.x + wordJuan.bbox.width,
      wordPerez.bbox.x + wordPerez.bbox.width,
    );

    expect(occurrence?.bbox.x).toBe(expectedX);
    expect(occurrence?.bbox.y).toBe(expectedY);
    expect(occurrence?.bbox.width).toBe(expectedRight - expectedX);
    expect(occurrence?.wordSpan).toEqual({ startIndex: 0, endIndexExclusive: 2 });
  });

  // ADR-066 §6: la unión de bboxes arma un bbox NUEVO; sin propagación
  // explícita `rotation` se cae en silencio y el pintado rotado de §7 nunca se
  // activa. Es el camino que recorre el nombre de un firmante vertical desde
  // que ADR-067 lo dejó contiguo en `Page.text`.
  it("propagates rotation when every word of the entity agrees on the angle", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([
          nerToken("B-PER", "Albarracin,", 0.9, 0),
          nerToken("I-PER", "Rocio", 0.9, 1),
        ]),
      ),
    );
    await engine.init(ctx);
    const base = makeNerPageInput("doc-rot", 0, ["Albarracin,", "Rocio", "firmo"]);
    const input = {
      ...base,
      words: base.words.map((w) => ({ ...w, bbox: { ...w.bbox, rotation: 90 as const } })),
    };
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences[0]?.bbox.rotation).toBe(90);
  });

  // ADR-088 §1 supersede el caso que este test cubría. La regla de ADR-066 §6
  // —si las palabras del span discrepan en el ángulo, `rotation` queda
  // ausente— sigue en `mapSpanToWords` como defensa en profundidad, pero
  // `processPage` ya no puede producir un span así: un batch es de una sola
  // orientación, así que la garantía que se afirma acá es más fuerte que la
  // anterior (no se omite el ángulo: no se mezclan las palabras).
  it("never puts words that disagree on the angle in the same occurrence", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0), nerToken("I-PER", "Pérez", 0.9, 1)]),
      ),
    );
    await engine.init(ctx);
    const base = makeNerPageInput("doc-rot-mixta", 0, ["Juan", "Pérez", "vive"]);
    const input = {
      ...base,
      words: base.words.map((w, i) =>
        i === 0 ? { ...w, bbox: { ...w.bbox, rotation: 90 as const } } : w,
      ),
    };
    const output = await engine.processPage(input, ctx);

    // "Juan" está rotado y "Pérez" no: caen en batches distintos, así que
    // ninguna ocurrencia abarca a los dos y cada una conserva su propio ángulo.
    for (const occurrence of output.occurrences) {
      expect(occurrence.value).not.toContain("Juan Pérez");
    }
    const rotada = output.occurrences.find((o) => o.value === "Juan");
    expect(rotada?.bbox.rotation).toBe(90);
  });

  // ─── ADR-088 §1: el batch nunca mezcla orientaciones ───

  describe("batches por corrida rotada (ADR-088 §1, NER_Engine.md §13 caso 19)", () => {
    /** `ctx` con un `batchSize` propio, mismo patrón que el test de §12 de más abajo. */
    function ctxWithBatchSize(batchSize: number): EngineContext {
      return createEngineContext({
        config: createMockConfig({
          ner: {
            modelId: "test-model",
            quantization: "q8",
            confidenceThreshold: 0.7,
            batchSize,
            enabled: true,
          },
        }),
      });
    }

    /** Los textos con los que se invocó al modelo, en orden — un batch cada uno. */
    function captureBatchTexts(): { readonly seen: string[] } {
      const seen: string[] = [];
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline((text: string) => {
          seen.push(text);
          return Promise.resolve([]);
        }),
      );
      return { seen };
    }

    it("a page with no rotated text produces the same batches as before ADR-088", async () => {
      const { seen } = captureBatchTexts();
      await engine.init(ctx);
      const input = makeNerPageInput("doc-plano", 0, ["uno", "dos", "tres", "cuatro", "cinco"]);

      await engine.processPage(input, ctxWithBatchSize(2));

      // 5 palabras, batchSize 2 ⇒ 3 batches por batchSize, sin ningún borde de
      // corrida de por medio. Es la no regresión: sobre texto horizontal el
      // corte nuevo no existe.
      expect(seen).toEqual(["uno dos", "tres cuatro", "cinco"]);
    });

    it("a 90° run and a 270° run never share a batch", async () => {
      const { seen } = captureBatchTexts();
      await engine.init(ctx);
      const base = makeNerPageInput("doc-dos-runs", 0, [
        "cuerpo",
        "Folio",
        "Pérez",
        "JUZGADO",
        "LOPEZ",
      ]);
      const rotations = [undefined, 270, 270, 90, 90] as const;
      const input = {
        ...base,
        words: base.words.map((w, i) => {
          const rotation = rotations[i];
          return rotation === undefined ? w : { ...w, bbox: { ...w.bbox, rotation } };
        }),
      };

      await engine.processPage(input, ctxWithBatchSize(256));

      // El tercer batch llega al modelo en Title Case: los dos cambios de
      // ADR-088 componen sobre el mismo texto, y es el caso real del sello.
      expect(seen).toEqual(["cuerpo", "Folio Pérez", "Juzgado Lopez"]);
    });

    it("a rotated run longer than batchSize is still split by batchSize", async () => {
      const { seen } = captureBatchTexts();
      await engine.init(ctx);
      const base = makeNerPageInput("doc-run-largo", 0, ["a", "b", "c", "d"]);
      const input = {
        ...base,
        words: base.words.map((w) => ({ ...w, bbox: { ...w.bbox, rotation: 90 as const } })),
      };

      await engine.processPage(input, ctxWithBatchSize(3));

      // El corte por corrida AGREGA bordes, no los saca: batchSize sigue siendo
      // el máximo adentro de la corrida.
      expect(seen).toEqual(["a b c", "d"]);
    });

    it("chunk offsets still point at the same slice of Page.text", async () => {
      const { seen } = captureBatchTexts();
      await engine.init(ctx);
      const base = makeNerPageInput("doc-offsets", 0, ["cuerpo", "largo", "Folio", "Pérez"]);
      const input = {
        ...base,
        words: base.words.map((w, i) =>
          i >= 2 ? { ...w, bbox: { ...w.bbox, rotation: 270 as const } } : w,
        ),
      };

      await engine.processPage(input, ctx);

      // Cada batch tiene que ser un slice literal de Page.text: de eso depende
      // que los offsets que devuelve el kernel sigan siendo absolutos al
      // sumarles el startIndex del chunk.
      for (const text of seen) {
        expect(input.text).toContain(text);
      }
      expect(seen.join(" ")).toBe(input.text);
    });
  });

  it("leaves rotation absent for horizontal text", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0)])),
    );
    await engine.init(ctx);
    const output = await engine.processPage(
      makeNerPageInput("doc-rot-ausente", 0, ["Juan", "Pérez"]),
      ctx,
    );

    expect(output.occurrences[0]?.bbox.rotation).toBeUndefined();
  });

  // Caso 26 (§13, ADR-074 §2/§3). Espejo exacto de los tests de regex-engine
  // (P-2 prohíbe compartir código entre motores).
  describe("fragments (footprint multi-línea)", () => {
    // El test que define el ADR de este lado, y el motor donde se midió
    // (NER_Engine.md §10): "Pablo" cierra un renglón, "Román Fortes," abre
    // el siguiente. Envolvente medida sobre la pericia real: 557,2 × 18,2 pt.
    // Emite UNA Occurrence con fragments.length === 2, y bbox sigue siendo
    // la envolvente de los dos.
    it("an entity split across two lines emits one occurrence with two fragments", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("B-PER", "Pablo", 0.9, 0),
            nerToken("I-PER", "Román", 0.9, 1),
            nerToken("I-PER", "Fortes,", 0.9, 2),
          ]),
        ),
      );
      await engine.init(ctx);
      const base = makeNerPageInput("doc-two-lines", 0, ["Pablo", "Román", "Fortes,", "firmo"]);
      const input = {
        ...base,
        words: base.words.map((w, i) => (i >= 1 ? { ...w, bbox: { ...w.bbox, y: 130 } } : w)),
      };
      const output = await engine.processPage(input, ctx);

      const wordPablo = input.words[0]!;
      const wordRoman = input.words[1]!;
      const wordFortes = input.words[2]!;
      expect(output.occurrences[0]?.fragments).toEqual([
        wordPablo.bbox,
        {
          x: wordRoman.bbox.x,
          y: wordRoman.bbox.y,
          width: wordFortes.bbox.x + wordFortes.bbox.width - wordRoman.bbox.x,
          height: 12,
        },
      ]);
      expect(output.occurrences[0]?.bbox).toEqual({
        x: Math.min(wordPablo.bbox.x, wordRoman.bbox.x),
        y: Math.min(wordPablo.bbox.y, wordRoman.bbox.y),
        width:
          Math.max(
            wordPablo.bbox.x + wordPablo.bbox.width,
            wordFortes.bbox.x + wordFortes.bbox.width,
          ) - Math.min(wordPablo.bbox.x, wordRoman.bbox.x),
        height: wordRoman.bbox.y + 12 - wordPablo.bbox.y,
      });
    });

    // No-regresión: el caso normal (una sola línea) no cambia ni un byte.
    it("a single-line entity carries no fragments and its bbox is unchanged", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0), nerToken("I-PER", "Pérez", 0.9, 1)]),
        ),
      );
      await engine.init(ctx);
      const input = makeNerPageInput("doc-single-line", 0, ["Juan", "Pérez", "vive"]);
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences[0]?.fragments).toBeUndefined();
      const wordJuan = input.words[0]!;
      const wordPerez = input.words[1]!;
      expect(output.occurrences[0]?.bbox).toEqual({
        x: wordJuan.bbox.x,
        y: wordJuan.bbox.y,
        width: wordPerez.bbox.x + wordPerez.bbox.width - wordJuan.bbox.x,
        height: 12,
      });
    });

    it("three lines produce three fragments in reading order", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("B-PER", "Albarracin,", 0.9, 0),
            nerToken("I-PER", "Rocio", 0.9, 1),
            nerToken("I-PER", "Milagros", 0.9, 2),
          ]),
        ),
      );
      await engine.init(ctx);
      const base = makeNerPageInput("doc-three-lines", 0, ["Albarracin,", "Rocio", "Milagros"]);
      const input = {
        ...base,
        words: base.words.map((w, i) => ({ ...w, bbox: { ...w.bbox, y: 100 + i * 30 } })),
      };
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences[0]?.fragments).toHaveLength(3);
      expect(output.occurrences[0]?.fragments?.map((f) => f.y)).toEqual([100, 130, 160]);
    });

    // Interacción con ADR-066 §6: el texto rotado no se fragmenta aunque sus
    // palabras estén apiladas en y distintos (la geometría normal de un run
    // vertical), y conserva la rotation que ya propagaba antes de este ADR.
    it("a rotated entity carries no fragments and keeps its rotation", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("B-PER", "Albarracin,", 0.9, 0),
            nerToken("I-PER", "Rocio", 0.9, 1),
          ]),
        ),
      );
      await engine.init(ctx);
      const base = makeNerPageInput("doc-rotated-two-lines", 0, ["Albarracin,", "Rocio", "firmo"]);
      const input = {
        ...base,
        words: base.words.map((w, i) => ({
          ...w,
          bbox: { ...w.bbox, y: 100 + i * 30, rotation: 90 as const },
        })),
      };
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences[0]?.fragments).toBeUndefined();
      expect(output.occurrences[0]?.bbox.rotation).toBe(90);
    });
  });

  it("normalizedValue is lowercase and strips redundant punctuation", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([nerToken("B-ORG", "ACME,", 0.9, 0)])),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-normalize", 0, ["ACME,", "S.A."]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    expect(output.occurrences[0]?.value).toBe("ACME,");
    expect(output.occurrences[0]?.normalizedValue).toBe("acme");
  });

  it("strips wordpiece continuation markers ('##') when reconstructing offsets", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-PER", "Gonz", 0.9, 0), nerToken("I-PER", "##alez", 0.9, 1)]),
      ),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-wordpiece", 0, ["Gonzalez", "trabaja", "aqui"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    expect(output.occurrences[0]?.value).toBe("Gonzalez");
    expect(output.occurrences[0]?.entityType).toBe(EntityType.Person);
  });

  it("ignores unsupported labels (e.g. MISC) without crashing", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-MISC", "Mundial", 0.9, 0), nerToken("B-PER", "Juan", 0.9, 1)]),
      ),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-unsupported-label", 0, ["Mundial", "Juan"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    expect(output.occurrences[0]?.value).toBe("Juan");
  });

  it("discards tokens whose decoded word cannot be located in the chunk text", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([
          nerToken("B-PER", "Inexistente", 0.9, 0),
          nerToken("B-ORG", "Acme", 0.9, 1),
        ]),
      ),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-unmappable-token", 0, ["Acme"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    expect(output.occurrences[0]?.value).toBe("Acme");
  });

  it("tolerates a malformed classifier response by treating it as empty", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      // @ts-expect-error — se simula deliberadamente una respuesta con forma
      // inesperada (string en vez de array) para ejercitar el guard de
      // runtime isTokenClassificationOutput.
      mockTokenClassificationPipeline(() => Promise.resolve("not-an-array")),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-malformed-response", 0, ["Hola"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toEqual([]);
  });

  it("splits a page into multiple batches when batchSize < word count", async () => {
    const config = createMockConfig({
      ner: {
        modelId: "test-model",
        quantization: "q8",
        confidenceThreshold: 0.7,
        batchSize: 2,
        enabled: true,
      },
    });
    const batchedCtx = createEngineContext({ config });

    const classify = vi.fn((text: string) => {
      if (text === "Juan Pérez") {
        return Promise.resolve([
          nerToken("B-PER", "Juan", 0.9, 0),
          nerToken("I-PER", "Pérez", 0.9, 1),
        ]);
      }
      if (text === "trabaja en") {
        return Promise.resolve([]);
      }
      if (text === "Acme") {
        return Promise.resolve([nerToken("B-ORG", "Acme", 0.9, 0)]);
      }
      return Promise.resolve([]);
    });
    asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

    await engine.init(batchedCtx);
    const input = makeNerPageInput("doc-multi-batch", 0, [
      "Juan",
      "Pérez",
      "trabaja",
      "en",
      "Acme",
    ]);
    const output = await engine.processPage(input, batchedCtx);

    // 5 palabras, batchSize 2 -> 3 lotes ("Juan Pérez" | "trabaja en" | "Acme").
    expect(classify).toHaveBeenCalledTimes(3);
    expect(output.occurrences).toHaveLength(2);
    expect(output.occurrences.map((o) => o.value).sort()).toEqual(["Acme", "Juan Pérez"]);

    // La entidad del tercer lote ("Acme") debe mapear al Word correcto (índice
    // 4 de la página completa), no al offset relativo del lote — verifica que
    // runInferenceInBatches suma chunk.startIndex correctamente.
    const acmeOccurrence = output.occurrences.find((o) => o.value === "Acme");
    expect(acmeOccurrence?.wordSpan).toEqual({ startIndex: 4, endIndexExclusive: 5 });
  });

  it("retries once on NerTimeoutError and then throws NerPageFailedError", async () => {
    vi.useFakeTimers();
    try {
      const classify = vi.fn(() => new Promise<never>(() => {})); // nunca resuelve -> siempre timeout
      asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

      const config = createMockConfig({
        ner: {
          modelId: "test-model",
          quantization: "q8",
          confidenceThreshold: 0.7,
          batchSize: 256,
          enabled: true,
        },
      });
      const timeoutCtx = createEngineContext({ config });
      await engine.init(timeoutCtx);

      const input = makeNerPageInput("doc-timeout", 0, ["Hola", "mundo"]);
      const resultPromise = engine.processPage(input, timeoutCtx);
      const caught = resultPromise.catch((err: unknown) => err);

      // timeout default 20000ms, maxRetries default 1 -> 2 intentos totales.
      await vi.advanceTimersByTimeAsync(20001);
      await vi.advanceTimersByTimeAsync(20001);

      const err = await caught;
      expect(err).toBeInstanceOf(NerPageFailedError);
      expect(classify).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("processPages continues with remaining pages after one page fails", async () => {
    let callIndex = 0;
    const classify = vi.fn(() => {
      callIndex++;
      if (callIndex === 1) {
        return Promise.reject(new Error("fallo de inferencia"));
      }
      return Promise.resolve([nerToken("B-PER", "Ana", 0.9, 0)]);
    });
    asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const warnSpy = vi.spyOn(ctx.logger, "warn");
    const inputs = [
      makeNerPageInput("doc-partial-failure", 0, ["Hola"]),
      makeNerPageInput("doc-partial-failure", 1, ["Ana"]),
    ];

    const outputs = await engine.processPages(inputs, ctx);

    // Página 0 falló (descartada); página 1 se procesó con éxito.
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.pageIndex).toBe(1);
    expect(outputs[0]?.occurrences).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();

    const finishedCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.NER_FINISHED,
    );
    expect((finishedCall?.[2] as NerFinished).occurrenceCount).toBe(1);
  });

  it("processPages rethrows NerModelMissingError instead of continuing", async () => {
    asPipelineMock(pipeline).mockRejectedValue(new Error("modelo no disponible"));

    await engine.init(ctx);
    const inputs = [
      makeNerPageInput("doc-model-missing-batch", 0, ["Hola"]),
      makeNerPageInput("doc-model-missing-batch", 1, ["Chau"]),
    ];

    await expect(engine.processPages(inputs, ctx)).rejects.toThrow(/no se pudo cargar/i);
    // El modelo solo se intenta cargar una vez (para la primera página); la
    // segunda página nunca se procesa porque el error aborta todo el batch.
    expect(pipeline).toHaveBeenCalledTimes(2); // intento inicial + 1 re-descarga
  });

  it("processPages handles an empty inputs array", async () => {
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    await engine.init(ctx);
    const outputs = await engine.processPages([], ctx);

    expect(outputs).toEqual([]);
    expect(pipeline).not.toHaveBeenCalled();

    const startedCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.NER_STARTED,
    );
    expect(startedCall).toBeDefined();
    const finishedCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.NER_FINISHED,
    );
    expect((finishedCall?.[2] as NerFinished).occurrenceCount).toBe(0);
  });

  describe("NER_STARTED modelLoading flag (ADR-024 §1)", () => {
    it("NER_STARTED includes modelLoading=true on first run", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() => Promise.resolve([])),
      );
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.processPages([makeNerPageInput("doc-model-first", 0, ["Hola"])], ctx);

      expect(busEmitSpy).toHaveBeenCalledWith(
        EventChannel.Ner,
        EngineEvents.NER_STARTED,
        expect.objectContaining({ modelLoading: true }),
      );
    });

    it("NER_STARTED omits modelLoading once the model is already loaded", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() => Promise.resolve([])),
      );
      await engine.init(ctx);
      await engine.processPages([makeNerPageInput("doc-model-warm", 0, ["Hola"])], ctx);

      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.processPages([makeNerPageInput("doc-model-warm", 1, ["Chau"])], ctx);

      expect(busEmitSpy).not.toHaveBeenCalledWith(
        EventChannel.Ner,
        EngineEvents.NER_STARTED,
        expect.objectContaining({ modelLoading: true }),
      );
    });
  });

  it("getModelId() before init() falls back to the documented default model", () => {
    const freshEngine = new NerEngine();
    expect(freshEngine.getModelId()).toBe("Xenova/bert-base-multilingual-cased-ner-hrl");
  });

  it("non-q8 quantization is requested as unquantized (library limitation, documented)", async () => {
    const config = createMockConfig({
      ner: {
        modelId: "test-model",
        quantization: "f32",
        confidenceThreshold: 0.7,
        batchSize: 256,
        enabled: true,
      },
    });
    const f32Ctx = createEngineContext({ config });
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );

    await engine.init(f32Ctx);
    const input = makeNerPageInput("doc-f32", 0, ["Hola"]);
    await engine.processPage(input, f32Ctx);

    expect(pipeline).toHaveBeenCalledWith(
      "token-classification",
      "test-model",
      expect.objectContaining({ dtype: "fp32" }),
    );
  });

  it("cancellation during a later batch still throws CancelledError", async () => {
    const config = createMockConfig({
      ner: {
        modelId: "test-model",
        quantization: "q8",
        confidenceThreshold: 0.7,
        batchSize: 1,
        enabled: true,
      },
    });
    const abortController = new AbortController();
    const abortedCtx = createEngineContext({ abortSignal: abortController.signal, config });

    let calls = 0;
    const classify = vi.fn(() => {
      calls++;
      if (calls === 2) {
        abortController.abort();
      }
      return Promise.resolve([]);
    });
    asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

    await engine.init(abortedCtx);
    const input = makeNerPageInput("doc-cancel-later-batch", 0, ["Uno", "Dos", "Tres"]);

    await expect(engine.processPage(input, abortedCtx)).rejects.toThrow(CancelledError);
    // El tercer lote nunca se llega a clasificar: el checkpoint corta el loop
    // apenas se detecta el abort, antes de invocar el tercer batch.
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it("ENTITY_FOUND payload carries the full occurrence with expected shape", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-LOC", "Rosario", 0.77, 0)]),
      ),
    );
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const input = makeNerPageInput("doc-payload-shape", 0, ["Rosario"]);
    await engine.processPage(input, ctx);

    const entityFoundCall = busEmitSpy.mock.calls.find(
      ([channel, event]) => channel === EventChannel.Ner && event === EngineEvents.ENTITY_FOUND,
    );
    expect(entityFoundCall).toBeDefined();
    const payload = entityFoundCall?.[2] as EntityFound;
    expect(payload.documentId).toBe("doc-payload-shape");
    expect(payload.occurrence.entityType).toBe(EntityType.Address);
    expect(payload.occurrence.confidence).toBeCloseTo(0.77, 5);
    expect(typeof payload.occurrence.id).toBe("string");
    expect(payload.occurrence.id.length).toBeGreaterThan(0);
  });

  // ─── ADR-046 §4 (caso 17) / §2 (caso 18) ───

  it("NER_MODEL_READY emitted once per instance across several model-ready reports", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );
    const config = createMockConfig({
      ner: {
        modelId: "test-model-dedupe",
        quantization: "q8",
        confidenceThreshold: 0.7,
        batchSize: 1,
        enabled: true,
      },
    });
    const dedupCtx = createEngineContext({ config });

    // Simula el `model-ready` de un segundo worker (spec §13 caso 17): un
    // reporte adicional, en cada batch, que no debería producir un segundo
    // NER_MODEL_READY. Delega en `params.run()` para que el kernel real siga
    // resolviendo el resultado (sin necesidad de fabricar un valor `T`).
    const pool = {
      dispatch: <T>(params: NerPoolDispatchParams<T>): Promise<T> => {
        params.onProgress?.(1, { phase: "model-ready", modelId: "test-model-dedupe" });
        return params.run();
      },
    };
    const pooledEngine = new NerEngine(pool);
    await pooledEngine.init(dedupCtx);
    const busEmitSpy = vi.spyOn(dedupCtx.bus, "emit");
    await pooledEngine.processPage(
      makeNerPageInput("doc-dedupe-ready", 0, ["Juan", "Pérez"]),
      dedupCtx,
    );

    const readyCalls = busEmitSpy.mock.calls.filter(
      ([, event]) => event === EngineEvents.NER_MODEL_READY,
    );
    expect(readyCalls).toHaveLength(1);
    expect((readyCalls[0]?.[2] as NerModelReady).modelId).toBe("test-model-dedupe");
    expect(pooledEngine.isModelReady()).toBe(true);

    await pooledEngine.dispose();
  });

  it("deserialized NER_TIMEOUT is retried; deserialized NER_MODEL_MISSING aborts", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );

    // NER_TIMEOUT: el primer dispatch devuelve un error deserializado (no
    // `instanceof NerTimeoutError`, tal como cruzaría un worker remoto vía
    // `EngineError.deserialize`, Contracts.md §4). El motor debe reintentar
    // igual que si el timeout fuera local.
    let timeoutAttempts = 0;
    const timeoutPool = {
      dispatch: <T>(params: NerPoolDispatchParams<T>): Promise<T> => {
        timeoutAttempts++;
        if (timeoutAttempts === 1) {
          const deserialized = EngineError.deserialize(
            new NerTimeoutError("doc-deserialized-timeout", 0, 20000).serialize(),
          );
          expect(deserialized).not.toBeInstanceOf(NerTimeoutError);
          return Promise.reject(deserialized);
        }
        return params.run();
      },
    };
    const timeoutEngine = new NerEngine(timeoutPool);
    await timeoutEngine.init(ctx);
    const output = await timeoutEngine.processPage(
      makeNerPageInput("doc-deserialized-timeout", 0, ["Hola"]),
      ctx,
    );
    expect(output.occurrences).toEqual([]);
    expect(timeoutAttempts).toBe(2); // 1 timeout deserializado + 1 reintento exitoso
    await timeoutEngine.dispose();

    // NER_MODEL_MISSING: deserializado también, pero aborta sin reintentar
    // ni envolver en NerPageFailedError (ensureModelLoaded corría fuera del
    // loop de retry; el equivalente en el kernel es que este error nunca es
    // recuperable por el motor).
    const missingPool = {
      dispatch: <T>(): Promise<T> => {
        const deserialized = EngineError.deserialize(
          new NerModelMissingError("test-model", "no disponible").serialize(),
        );
        expect(deserialized).not.toBeInstanceOf(NerModelMissingError);
        return Promise.reject(deserialized);
      },
    };
    const missingEngine = new NerEngine(missingPool);
    await missingEngine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    await expect(
      missingEngine.processPage(makeNerPageInput("doc-deserialized-missing", 0, ["Hola"]), ctx),
    ).rejects.toBeInstanceOf(NerModelMissingError);
    expect(
      busEmitSpy.mock.calls.some(([, event]) => event === EngineEvents.NER_PAGE_FINISHED),
    ).toBe(false);
    await missingEngine.dispose();
  });

  // ─── ADR-055 §5 — tests de sobre, obligatorios (NER_Engine.md §14) ───
  //
  // A diferencia de `createTrackingNerPool`/los pools ad-hoc de arriba (que
  // delegan en `params.run()`, o sea el camino in-process), `createResolvedNerPool`
  // IGNORA `run()` y resuelve directo con el valor dado — es el único fake de
  // este paquete que cruza de verdad el sobre `COMPLETED.result` (ADR-055
  // Contexto §2). Sin él, ningún test ejercita `decodeKernelSpans`.

  describe("Sobre del dispatch (ADR-055)", () => {
    const span: NerKernelSpan = {
      entityType: EntityType.Person,
      value: "Juan",
      normalizedValue: "juan",
      confidence: 0.9,
      startIndex: 0,
      endIndexExclusive: 4,
    };

    it("decodes the remote envelope { spans } from NerWorker", async () => {
      const pool = createResolvedNerPool({ spans: [span] });
      const pooledEngine = new NerEngine(pool);
      await pooledEngine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const input = makeNerPageInput("doc-envelope-decode", 0, ["Juan"]);

      const output = await pooledEngine.processPage(input, ctx);

      expect(output.occurrences).toHaveLength(1);
      const entityFoundCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.ENTITY_FOUND,
      );
      expect(entityFoundCalls).toHaveLength(1);
      const pageFinishedCall = busEmitSpy.mock.calls.find(
        ([, event]) => event === EngineEvents.NER_PAGE_FINISHED,
      );
      expect(pageFinishedCall).toBeDefined();
      expect((pageFinishedCall?.[2] as NerPageFinished).occurrenceCount).toBeGreaterThan(0);

      await pooledEngine.dispose();
    });

    it("decodes the in-process bare array identically", async () => {
      const envelopePool = createResolvedNerPool({ spans: [span] });
      const envelopeEngine = new NerEngine(envelopePool);
      await envelopeEngine.init(ctx);
      const envelopeOutput = await envelopeEngine.processPage(
        makeNerPageInput("doc-envelope-parity", 0, ["Juan"]),
        ctx,
      );
      await envelopeEngine.dispose();

      const bareArrayCtx = createEngineContext();
      const bareArrayPool = createResolvedNerPool([span]);
      const bareArrayEngine = new NerEngine(bareArrayPool);
      await bareArrayEngine.init(bareArrayCtx);
      const bareArrayOutput = await bareArrayEngine.processPage(
        makeNerPageInput("doc-envelope-parity", 0, ["Juan"]),
        bareArrayCtx,
      );
      await bareArrayEngine.dispose();

      // `id` es no determinista (crypto.randomUUID() por ocurrencia);
      // `durationMs` depende de Date.now(). El resto tiene que ser idéntico
      // — la paridad remoto/in-process que exige ADR-055 §2.
      const stripNonDeterministic = (occ: (typeof envelopeOutput.occurrences)[number]) => {
        const { id: _id, ...rest } = occ;
        return rest;
      };
      expect(bareArrayOutput.occurrences).toHaveLength(1);
      expect(bareArrayOutput.occurrences.map(stripNonDeterministic)).toEqual(
        envelopeOutput.occurrences.map(stripNonDeterministic),
      );
    });

    // Test de regresión: una revisión encontró que `processPages` había
    // quedado abortando el batch entero ante CUALQUIER `InvalidInputError`,
    // no solo los de `decodeKernelSpans` — incluyendo el `InvalidInputError`
    // genérico que los guards tempranos de `processPage` (`input ==
    // null`/`pageIndex < 0`, spec §9) ya lanzaban antes de ADR-055. Antes de
    // esa regresión, ese caso caía en el warn+continue de `processPages`
    // (fallo tolerable de esa página nada más); nada lo cubría vía
    // `processPages` (solo existían tests de esos guards contra
    // `processPage` directo), así que la regresión no rompió ningún test
    // rojo. Este test cierra ese hueco.
    it(
      "processPages treats a per-page InvalidInputError (invalid pageIndex) as a " +
        "tolerable page failure, unlike a genuine envelope decode failure",
      async () => {
        asPipelineMock(pipeline).mockResolvedValue(
          mockTokenClassificationPipeline(() =>
            Promise.resolve([nerToken("B-PER", "Ana", 0.9, 0)]),
          ),
        );
        await engine.init(ctx);
        const busEmitSpy = vi.spyOn(ctx.bus, "emit");
        const inputs = [
          // pageIndex < 0: mismo guard temprano que "input == null"
          // (ner.engine.ts, ANTES del loop de retry) — un InvalidInputError
          // genérico, no un sobre roto (NerDispatchEnvelopeError). No tiene
          // que abortar processPages entero.
          makeNerPageInput("doc-invalid-page-tolerable", -1, ["Hola"]),
          makeNerPageInput("doc-invalid-page-tolerable", 0, ["Ana"]),
        ];

        const outputs = await engine.processPages(inputs, ctx);

        // La página -1 se descarta (fallo tolerable de ESA página); la
        // página 0, válida, se sigue procesando — a diferencia de una falla
        // de decodificación real ("throws on an unrecognized dispatch
        // result", edge.test.ts), que sí debe abortar todo el batch.
        expect(outputs).toHaveLength(1);
        expect(outputs[0]?.pageIndex).toBe(0);

        const finishedCall = busEmitSpy.mock.calls.find(
          ([, event]) => event === EngineEvents.NER_FINISHED,
        );
        expect(finishedCall).toBeDefined();
        expect((finishedCall?.[2] as NerFinished).occurrenceCount).toBe(1);
      },
    );
  });
});
