/**
 * Tests del kernel de inferencia NER (`../kernel.js`, ADR-046 §1/§4).
 *
 * Verifica el módulo aislado de `@huggingface/transformers`, sin pasar por
 * `NerEngine`: `kernelClassify` produce los mismos spans que el camino
 * in-process (que efectivamente invoca esta misma función, ver
 * `ner.engine.ts#runInferenceInBatches`), reporta el ciclo de vida del
 * modelo por `onProgress` (nunca por eventos de dominio: este archivo no
 * tiene bus ni logger) y aplica la política de reintento de carga de
 * NER_Engine.md §11/§13 caso 8.
 *
 * Por el hoisting de Vitest, este archivo declara su propio `vi.mock`
 * (mismo motivo documentado en `../../__tests__/fixtures/test-helpers.ts`).
 */
import {
  EntityType,
  normalizeEntityValue,
  type NerPagePayload,
  type Serializable,
} from "@anonly/shared";
import { pipeline } from "@huggingface/transformers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: {
    allowRemoteModels: true,
    localModelPath: "/models/",
    backends: { onnx: { wasm: {} } },
  },
}));

import {
  asPipelineMock,
  mockPipelineHonouringIgnoreLabels,
  mockTokenClassificationPipeline,
  nerToken,
  type MockTokenizer,
} from "../../__tests__/fixtures/test-helpers.js";
import { NerModelMissingError } from "../../ner.errors.js";
import { kernelClassify, kernelDispose } from "../kernel.js";

function basePayload(overrides?: Partial<NerPagePayload>): NerPagePayload {
  return {
    documentId: "doc-kernel",
    pageIndex: 0,
    text: "Juan Pérez",
    modelId: "test-model",
    quantization: "q8",
    ...overrides,
  };
}

describe("NerKernel — kernelClassify (ADR-046 §1/§4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await kernelDispose();
  });

  it("kernel spans match the in-process path on the shared fixture", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0), nerToken("I-PER", "Pérez", 0.9, 1)]),
      ),
    );

    const spans = await kernelClassify(basePayload(), {
      timeoutMs: 5000,
      abortSignal: new AbortController().signal,
    });

    expect(spans).toEqual([
      {
        entityType: EntityType.Person,
        value: "Juan Pérez",
        // ADR-118: la clave no lleva diacriticos — es la misma normalizacion
        // que produce la via manual. El  de arriba si los conserva.
        normalizedValue: "juan perez",
        confidence: 0.9,
        startIndex: 0,
        endIndexExclusive: 10,
      },
    ]);
  });

  it("kernel reports model-loading progress then model-ready", async () => {
    asPipelineMock(pipeline).mockImplementation((_task, _model, options) => {
      options?.progress_callback?.({ status: "initiate" });
      options?.progress_callback?.({ status: "download" });
      options?.progress_callback?.({ status: "progress", progress: 40, loaded: 40, total: 100 });
      options?.progress_callback?.({ status: "progress", progress: 100, loaded: 100, total: 100 });
      options?.progress_callback?.({ status: "done" });
      return Promise.resolve(mockTokenClassificationPipeline(() => Promise.resolve([])));
    });

    const reports: Array<{
      readonly progress: number;
      readonly partial: Serializable | undefined;
    }> = [];
    await kernelClassify(basePayload({ modelId: "test-model-progress" }), {
      timeoutMs: 5000,
      abortSignal: new AbortController().signal,
      onProgress: (progress, partial) => reports.push({ progress, partial }),
    });

    expect(reports).toEqual([
      { progress: 0.4, partial: { phase: "model-loading", modelId: "test-model-progress" } },
      { progress: 1, partial: { phase: "model-loading", modelId: "test-model-progress" } },
      { progress: 1, partial: { phase: "model-ready", modelId: "test-model-progress" } },
    ]);
  });

  it("kernel retries model load once, reports model-load-retry, then throws NerModelMissingError", async () => {
    asPipelineMock(pipeline).mockRejectedValue(new Error("modelo corrupto (checksum inválido)"));

    const phases: string[] = [];
    await expect(
      kernelClassify(basePayload({ modelId: "test-model-retry" }), {
        timeoutMs: 5000,
        abortSignal: new AbortController().signal,
        onProgress: (_progress, partial) => {
          if (
            typeof partial === "object" &&
            partial !== null &&
            !Array.isArray(partial) &&
            "phase" in partial &&
            typeof partial.phase === "string"
          ) {
            phases.push(partial.phase);
          }
        },
      }),
    ).rejects.toBeInstanceOf(NerModelMissingError);

    expect(pipeline).toHaveBeenCalledTimes(2); // intento inicial + 1 re-descarga
    expect(phases).toEqual(["model-load-retry"]);
  });

  it("reuses the loaded classifier across dispatches for the same (modelId, dtype)", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );

    await kernelClassify(basePayload({ modelId: "test-model-reuse" }), {
      timeoutMs: 5000,
      abortSignal: new AbortController().signal,
    });
    await kernelClassify(basePayload({ modelId: "test-model-reuse" }), {
      timeoutMs: 5000,
      abortSignal: new AbortController().signal,
    });

    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("reloads the classifier when (modelId, dtype) changes", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );

    await kernelClassify(basePayload({ modelId: "model-a" }), {
      timeoutMs: 5000,
      abortSignal: new AbortController().signal,
    });
    await kernelClassify(basePayload({ modelId: "model-b" }), {
      timeoutMs: 5000,
      abortSignal: new AbortController().signal,
    });

    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it("wasmPaths applied verbatim; absent falls back to /wasm/onnxruntime/ (ADR-039/ADR-046 §5)", async () => {
    const { env } = await import("@huggingface/transformers");
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );

    await kernelClassify(
      basePayload({ modelId: "model-wasm-custom", wasmPaths: "/custom/onnx/" }),
      {
        timeoutMs: 5000,
        abortSignal: new AbortController().signal,
      },
    );
    expect(env.backends.onnx.wasm?.wasmPaths).toBe("/custom/onnx/");

    await kernelDispose();
    await kernelClassify(basePayload({ modelId: "model-wasm-default" }), {
      timeoutMs: 5000,
      abortSignal: new AbortController().signal,
    });
    expect(env.backends.onnx.wasm?.wasmPaths).toBe("/wasm/onnxruntime/");
  });
  it("apaga Cache Storage: el target es escritorio y el modelo es local (ADR-132 §7)", async () => {
    const { env } = await import("@huggingface/transformers");
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );

    await kernelClassify(basePayload({ modelId: "model-no-cache" }), {
      timeoutMs: 5000,
      abortSignal: new AbortController().signal,
    });

    expect(env.useBrowserCache).toBe(false);
    // Los otros dos siguen como estaban: el modelo se sirve del origen propio
    // y nunca de HuggingFace (ADR-018).
    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
  });

  // ─── v1.3.1: un subword no puede empezar una entidad ───

  it("does not let a wordpiece continuation tagged B- split an entity in two", async () => {
    /*
     * Los tokens son los que devolvió el modelo de producción sobre
     * `qa-tables-justified.pdf`, medidos: la SEGUNDA aparición de
     * "Empresa S.A." sale con `B-ORG` en la continuación `##presa`. Creerle a
     * ese `B-` parte el span en "Em" y "presa S.A" — los dos grupos espurios
     * del hallazgo §23f del gate manual.
     */
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([
          nerToken("B-ORG", "Em", 0.962, 0),
          nerToken("B-ORG", "##presa", 0.62, 1),
          nerToken("I-ORG", "S", 0.994, 2),
          nerToken("I-ORG", ".", 0.98, 3),
          nerToken("I-ORG", "A", 0.982, 4),
        ]),
      ),
    );

    const spans = await kernelClassify(
      basePayload({ modelId: "model-wordpiece", text: "Demandada Empresa S.A. CUIT" }),
      { timeoutMs: 5000, abortSignal: new AbortController().signal },
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]?.value).toBe("Empresa S.A");
    expect(spans[0]?.entityType).toBe(EntityType.Organization);
  });

  it("still opens a new span on a B- that is not a continuation", async () => {
    // La no regresión: dos entidades pegadas siguen siendo dos.
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-PER", "Pérez", 0.9, 0), nerToken("B-PER", "Juan", 0.9, 1)]),
      ),
    );

    const spans = await kernelClassify(
      basePayload({ modelId: "model-two-spans", text: "Pérez Juan" }),
      { timeoutMs: 5000, abortSignal: new AbortController().signal },
    );

    expect(spans.map((s) => s.value)).toEqual(["Pérez", "Juan"]);
  });

  // ─── ADR-111: el token sin etiqueta, la continuación y el borde de palabra ───

  describe("ADR-111 §1 — la secuencia completa de tokens (NER_Engine.md §13 caso 23)", () => {
    it("asks the pipeline for every token, O included", async () => {
      const seen: Array<ReadonlyArray<string> | undefined> = [];
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline((_text, options) => {
          seen.push(options?.ignore_labels);
          return Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0)]);
        }),
      );

      await kernelClassify(basePayload({ modelId: "model-ignore-labels", text: "Juan" }), {
        timeoutMs: 5000,
        abortSignal: new AbortController().signal,
      });

      expect(seen).toEqual([[]]);
    });

    it("closes a span on an unlabelled token instead of swallowing the text between two entities", async () => {
      /*
       * El doble filtra como filtra la librería, así que este test FALLA si
       * el kernel deja de pedir `ignore_labels: []`: sin los `O`, el
       * agregador ve `B-PER "Juan"` seguido de `I-PER "Ana"` y emite un solo
       * span sobre "Juan vive con Ana".
       */
      asPipelineMock(pipeline).mockResolvedValue(
        mockPipelineHonouringIgnoreLabels([
          nerToken("B-PER", "Juan", 0.9, 0),
          nerToken("O", "vive", 0.99, 1),
          nerToken("O", "con", 0.99, 2),
          nerToken("I-PER", "Ana", 0.9, 3),
        ]),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-o-tokens", text: "Juan vive con Ana" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans.map((s) => s.value)).toEqual(["Juan", "Ana"]);
    });

    it("positions a short token at its real offset, not at the first match in the chunk", async () => {
      /*
       * El caso medido sobre un fallo escaneado, reducido: el `B-PER "D"` de
       * "D'Amoroso" se ubicaba en la "D" de la primera palabra —cientos de
       * caracteres antes— porque el cursor de `positionTokens` no tenía
       * ninguna ancla entre entidad y entidad. Los `O` son esa ancla.
       */
      asPipelineMock(pipeline).mockResolvedValue(
        mockPipelineHonouringIgnoreLabels([
          nerToken("O", "Dijo", 0.99, 0),
          nerToken("O", "el", 0.99, 1),
          nerToken("O", "señor", 0.99, 2),
          nerToken("B-PER", "D", 0.9, 3),
          nerToken("I-PER", "'", 0.9, 4),
          nerToken("I-PER", "Amo", 0.9, 5),
          nerToken("I-PER", "roso", 0.9, 6),
        ]),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-cursor", text: "Dijo el señor D'Amoroso" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans).toHaveLength(1);
      expect(spans[0]?.value).toBe("D'Amoroso");
      expect(spans[0]?.startIndex).toBe(14);
    });
  });

  describe("ADR-111 §2 — una continuación no abre entidad (NER_Engine.md §13 caso 24)", () => {
    it("extends the open span when a continuation carries a different label", async () => {
      /*
       * Medido sobre el fallo escaneado: `Florencio Varela` salía como
       * `Address "Floren"` + `Organization "cio Varela"`. Con la regla
       * completa, la palabra es una y el span también.
       */
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("B-LOC", "Floren", 0.78, 0),
            nerToken("I-ORG", "##cio", 0.73, 1),
            nerToken("I-LOC", "Varela", 0.9, 2),
          ]),
        ),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-continuation-label", text: "Florencio Varela" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans).toHaveLength(1);
      expect(spans[0]?.value).toBe("Florencio Varela");
      expect(spans[0]?.entityType).toBe(EntityType.Address);
    });

    it("still starts a new span when a NON-continuation changes label", async () => {
      // La no regresión de §2: dos palabras distintas siguen siendo dos entidades.
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-PER", "Ana", 0.9, 0), nerToken("I-ORG", "Acme", 0.9, 1)]),
        ),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-label-change", text: "Ana Acme" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans.map((s) => s.value)).toEqual(["Ana", "Acme"]);
    });
  });

  describe("ADR-111 §3 — el borde de un span es un borde de palabra (NER_Engine.md §13 caso 25)", () => {
    it("extends a span that starts mid-word up to the start of the word", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockPipelineHonouringIgnoreLabels([
          nerToken("O", "Ju", 0.6, 0),
          nerToken("B-ORG", "##zgado", 0.9, 1),
          nerToken("I-ORG", "Civil", 0.9, 2),
        ]),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-snap-start", text: "Juzgado Civil de Quilmes" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans).toHaveLength(1);
      expect(spans[0]?.value).toBe("Juzgado Civil");
      expect(spans[0]?.startIndex).toBe(0);
    });

    it("merges two spans of the same type that fall inside the same word", async () => {
      /*
       * Medido sobre un oficio: `Juzgado` salía `Organization "Ju"` +
       * `Organization "gado"` porque el modelo etiquetó `O` el subtoken del
       * medio. Es el modo de falla de v1.3.1 por otra puerta.
       */
      asPipelineMock(pipeline).mockResolvedValue(
        mockPipelineHonouringIgnoreLabels([
          nerToken("B-ORG", "Ju", 0.6, 0),
          nerToken("O", "##z", 0.4, 1),
          nerToken("B-ORG", "##gado", 0.91, 2),
        ]),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-coalesce", text: "Juzgado de Paz" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans).toHaveLength(1);
      expect(spans[0]?.value).toBe("Juzgado");
      // La confianza es la del trozo más largo, no el promedio: la `z` que el
      // modelo dudó no arrastra a la palabra entera.
      expect(spans[0]?.confidence).toBeCloseTo(0.91, 5);
    });

    it("does not merge two spans of the same type separated by a space", async () => {
      // La no regresión de la fusión: dos palabras pueden ser dos entidades.
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-PER", "Ana", 0.9, 0), nerToken("B-PER", "Bruno", 0.9, 1)]),
        ),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-no-coalesce", text: "Ana Bruno" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans.map((s) => s.value)).toEqual(["Ana", "Bruno"]);
    });

    it("does not invade the neighbouring span when both fall inside the same word", async () => {
      /*
       * Secuencia sintética: dos tokens NO continuación dentro de una misma
       * palabra. No es lo que produce el modelo, pero es lo único que puede
       * romper la invariante que §3 promete conservar — spans ordenados y sin
       * solaparse. Sin el clamp, los dos se extienden a "Perez" y quedan dos
       * entidades idénticas superpuestas.
       */
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-PER", "Pe", 0.9, 0), nerToken("B-ORG", "rez", 0.9, 1)]),
        ),
      );

      const spans = await kernelClassify(basePayload({ modelId: "model-clamp", text: "Perez" }), {
        timeoutMs: 5000,
        abortSignal: new AbortController().signal,
      });

      expect(spans.map((s) => s.value)).toEqual(["Pe", "rez"]);
      expect(spans[0]?.endIndexExclusive).toBe(spans[1]?.startIndex);
    });

    it("leaves a span already aligned to word boundaries untouched", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0), nerToken("I-PER", "Pérez", 0.9, 1)]),
        ),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-snap-noop", text: "Juan Pérez trabaja" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans).toHaveLength(1);
      expect(spans[0]?.value).toBe("Juan Pérez");
      expect(spans[0]?.startIndex).toBe(0);
      expect(spans[0]?.endIndexExclusive).toBe("Juan Pérez".length);
    });

    it("recomputes normalizedValue when the span grows", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockPipelineHonouringIgnoreLabels([
          nerToken("O", "Alba", 0.6, 0),
          nerToken("B-PER", "##verría,", 0.9, 1),
        ]),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-snap-normalized", text: "Echeverría, Marta" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans).toHaveLength(1);
      expect(spans[0]?.value).toBe("Echeverría,");
      expect(spans[0]?.normalizedValue).toBe("echeverria"); // ADR-118: sin diacriticos
    });
  });

  // ─── ADR-118: una sola normalizacion para la clave de agrupado ───

  describe("ADR-123 — la S de S/ no es una inicial (NER_Engine.md §13 caso 27)", () => {
    it("drops a trailing single letter that belongs to a caption separator", async () => {
      /*
       * El caso real: sobre el encabezado de un fallo escaneado el modelo
       * devuelve `"BARTOLOME ARTURO S"` — se lleva la primera letra de `S/`,
       * que separa a las partes de la carátula. Medido sobre 451 spans de
       * PERSON en 8 documentos, 4 terminan justo antes de una barra y los
       * cuatro son este defecto.
       */
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            // En Title Case: el kernel le pasa al modelo la corrida en caja
            // alta transformada (ADR-088 §2), y ahi es donde se posicionan.
            nerToken("B-PER", "Bartolome", 0.9, 0),
            nerToken("I-PER", "Arturo", 0.9, 1),
            nerToken("I-PER", "S", 0.8, 2),
          ]),
        ),
      );

      const spans = await kernelClassify(
        basePayload({
          modelId: "model-separador",
          text: "SUAREZ, BARTOLOME ARTURO S/ RECURSO DE CASACION",
        }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans.map((sp) => sp.value)).toEqual(["BARTOLOME ARTURO"]);
      // La clave es la que importa: con la `S` adentro el grupo no se une al
      // del nombre y aparece uno espurio al lado.
      expect(spans[0]?.normalizedValue).toBe("bartolome arturo");
    });

    it("keeps a real initial, which is followed by a dot and not by a slash", async () => {
      /*
       * La no regresión, y la razón de que la condición mire el carácter de
       * AFUERA: una inicial de verdad va seguida de un punto. Si la regla
       * fuera "una letra suelta al final no es parte del nombre", esta se
       * perdería.
       */
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0), nerToken("I-PER", "P", 0.9, 1)]),
        ),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-inicial", text: "Juan P. García" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans.map((sp) => sp.value)).toEqual(["Juan P"]);
    });

    it("does not touch a span that ends before a slash without a lone letter", async () => {
      // La otra mitad de la condición: la barra sola no alcanza. Sin esto, de
      // `"Quilmes/ La Plata"` saldría `"Quilme"`.
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-PER", "Quilmes", 0.9, 0)]),
        ),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-barra-sola", text: "Quilmes/ La Plata" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans.map((sp) => sp.value)).toEqual(["Quilmes"]);
    });

    it("runs after the boundary snap, so a word tail is not mistaken for a separator", async () => {
      /*
       * Lo que fija el ORDEN, y es la unica razon por la que importa.
       *
       * Una letra suelta al final de un span puede ser dos cosas distintas: la
       * particula `S/` de una caratula, o la COLA de una palabra que el modelo
       * corto por la mitad. El recorte no puede distinguirlas mirando el span,
       * porque en los dos casos ve una letra sola pegada a una barra.
       *
       * El encaje de bordes (ADR-111 §3) es lo que resuelve la ambiguedad: con
       * la palabra completa, `anterior` es la `P` de `IPS` y no un espacio, y
       * el recorte se abstiene. Si el recorte corriera ANTES, veria un span de
       * una sola letra —`end - 2` cae antes del comienzo del span— concluiria
       * que es el separador y **borraria la entidad entera**.
       *
       * Texto `"Documento IPS/ 12"`: la `S` esta en el indice 12 y la `/` en el
       * 13, asi que el span crudo (12..13) toca la barra igual que en el caso
       * de la caratula.
       */
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() => Promise.resolve([nerToken("B-PER", "S", 0.9, 0)])),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-cola-de-palabra", text: "Documento IPS/ 12" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans.map((sp) => sp.value)).toEqual(["IPS"]);
    });

    it("drops the span entirely when the separator letter was all of it", async () => {
      // Un span que se queda sin letras no nombra a nadie.
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() => Promise.resolve([nerToken("B-PER", "S", 0.9, 1)])),
      );

      const spans = await kernelClassify(
        // Un apellido que NO empiece con S:  busca el token
        //  con indexOf y se quedaria con la del apellido.
        basePayload({ modelId: "model-solo-la-s", text: "RAMIREZ S/ RECURSO" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans).toHaveLength(0);
    });
  });

  describe("ADR-118 — la clave sale de normalizeEntityValue (NER_Engine.md §13 caso 26)", () => {
    it("strips diacritics so the key matches what the manual path produces", () => {
      /*
       * El hueco medido:  no sacaba diacriticos y
       *  (la via manual) si, asi que el mismo nombre
       * daba dos claves. El pase difuso de grouping no siempre las rescata —
       *  contra  da 0,600 sobre un umbral de 0,88. Sobre 8
       * documentos, 23 de 108 ocurrencias con diacriticos se partian.
       */
      expect(normalizeEntityValue("Muñíz")).toBe("muniz");
      expect(normalizeEntityValue("MUÑÍZ,")).toBe("muniz");
      expect(normalizeEntityValue("muñíz")).toBe("muniz");
    });

    it("produces a span whose normalizedValue has no diacritics but whose value keeps them", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-PER", "Muñíz", 0.9, 0)]),
        ),
      );

      const spans = await kernelClassify(
        basePayload({ modelId: "model-118", text: "Declaró Muñíz ante el tribunal" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(spans).toHaveLength(1);
      // Lo impreso se conserva: es lo que la UI muestra como canonicalValue.
      expect(spans[0]?.value).toBe("Muñíz");
      // La clave de agrupado, no.
      expect(spans[0]?.normalizedValue).toBe("muniz");
    });
  });

  // ─── ADR-088 §2: caja alta ───

  describe("corridas en caja alta (ADR-088 §2, NER_Engine.md §13 caso 20)", () => {
    /** Texto con el que el modelo fue invocado, para ver qué vio de verdad. */
    function captureInferenceText(tokens: ReadonlyArray<ReturnType<typeof nerToken>>): {
      readonly seen: string[];
    } {
      const seen: string[] = [];
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline((text: string) => {
          seen.push(text);
          return Promise.resolve(tokens);
        }),
      );
      return { seen };
    }

    it("classifies an all-caps run in Title Case but keeps the original casing in value", async () => {
      const { seen } = captureInferenceText([
        nerToken("B-PER", "Perito", 0.99, 0),
        nerToken("I-PER", "Carlos", 0.99, 1),
        nerToken("I-PER", "Lopez", 0.99, 2),
      ]);

      const spans = await kernelClassify(
        basePayload({ modelId: "model-caps", text: "PERITO CARLOS LOPEZ" }),
        { timeoutMs: 5000, abortSignal: new AbortController().signal },
      );

      expect(seen).toEqual(["Perito Carlos Lopez"]);
      // El valor sale del texto original: es lo que el usuario ve como
      // canonicalValue del grupo y lo que "Ver ocurrencias" busca en el
      // documento.
      expect(spans[0]?.value).toBe("PERITO CARLOS LOPEZ");
      expect(spans[0]?.startIndex).toBe(0);
      expect(spans[0]?.endIndexExclusive).toBe(19);
    });

    it("never transforms an acronym next to another all-caps word, nor a lone one", async () => {
      // "S.A.," tiene punto seguido de letra ⇒ no es elegible, así que corta la
      // corrida y "CUIT" queda sola. Sin este guard la confianza de la
      // organización del cuerpo cae de 0,995 a 0,792 (ADR-088 §2).
      const { seen } = captureInferenceText([]);

      const text = "Empresa S.A., CUIT 20-12345678-9 y DNI 34.567.891";
      await kernelClassify(basePayload({ modelId: "model-acronyms", text }), {
        timeoutMs: 5000,
        abortSignal: new AbortController().signal,
      });

      expect(seen).toEqual([text]);
    });

    it("classifies text without any all-caps run verbatim", async () => {
      const { seen } = captureInferenceText([]);

      const text = "El actor, Juan Pérez, con domicilio en Belgrano 1234";
      await kernelClassify(basePayload({ modelId: "model-verbatim", text }), {
        timeoutMs: 5000,
        abortSignal: new AbortController().signal,
      });

      expect(seen).toEqual([text]);
    });

    it("leaves a word intact when its case mapping would change its length", async () => {
      // "MAİL" en Title Case da "Mai\u0307l": la "İ" (U+0130) en minúscula son
      // DOS code units, así que la palabra crecería de 4 a 5. Un solo carácter
      // de más corre todos los offsets que siguen y los spans dejarían de
      // apuntar al texto original — la premisa entera de ADR-088 §2. La palabra
      // se deja como está; su vecina se transforma igual.
      const { seen } = captureInferenceText([]);

      const text = "MAİL RESTANTE";
      await kernelClassify(basePayload({ modelId: "model-length", text }), {
        timeoutMs: 5000,
        abortSignal: new AbortController().signal,
      });

      expect(seen).toEqual(["MAİL Restante"]);
      expect(seen[0]).toHaveLength(text.length);
    });
  });

  /*
   * ADR-098: el lote se corta en PALABRAS (host) y el modelo trunca en
   * TOKENS. Sin partirlo, `truncation: true` descarta la cola sin error ni
   * log y esa parte de la página no la analiza nadie.
   *
   * El tokenizer falso usa una razón fija de 3 tokens por palabra: alcanza
   * para ejercitar el corte, y la razón real (1,42 a 6,12 según el
   * contenido) es justamente lo que ADR-098 §2 dice que NO hay que asumir
   * constante — por eso el corte se busca midiendo, no multiplicando.
   */
  describe("Presupuesto de tokens del lote (ADR-098, §13 caso 22)", () => {
    const TOKENS_POR_PALABRA = 3;
    const BUDGET = 512 - 4;

    function fakeTokenizer(): MockTokenizer {
      return {
        model_max_length: 512,
        encode: (t: string) =>
          new Array(t.split(/\s+/).filter(Boolean).length * TOKENS_POR_PALABRA).fill(0),
      };
    }

    function captureWithTokenizer(withTokenizer: boolean): { readonly seen: string[] } {
      const seen: string[] = [];
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(
          (text: string) => {
            seen.push(text);
            return Promise.resolve([]);
          },
          () => Promise.resolve(),
          withTokenizer ? fakeTokenizer() : undefined,
        ),
      );
      return { seen };
    }

    /** 300 palabras => 900 tokens con la razón de arriba; el techo es 508. */
    const LONG_TEXT = new Array(300).fill("palabra").join(" ");

    it("parte un lote que no entra en el presupuesto, en límites de palabra", async () => {
      const { seen } = captureWithTokenizer(true);

      await kernelClassify(basePayload({ modelId: "model-split", text: LONG_TEXT }), {
        timeoutMs: 5000,
        abortSignal: new AbortController().signal,
      });

      expect(seen.length).toBeGreaterThan(1);
      for (const chunk of seen) {
        const tokens = chunk.split(/\s+/).filter(Boolean).length * TOKENS_POR_PALABRA;
        expect(tokens).toBeLessThanOrEqual(BUDGET);
      }
      // Los sub-lotes son rebanadas CONTIGUAS: concatenadas sin separador
      // reconstruyen el texto exacto, sin perder ni repetir una palabra. Es
      // la garantía que el truncamiento silencioso rompía.
      expect(seen.join("")).toBe(LONG_TEXT);
    });

    it("no parte nada cuando el lote entra", async () => {
      const { seen } = captureWithTokenizer(true);
      const text = new Array(50).fill("palabra").join(" ");

      await kernelClassify(basePayload({ modelId: "model-fits", text }), {
        timeoutMs: 5000,
        abortSignal: new AbortController().signal,
      });

      expect(seen).toEqual([text]);
    });

    it("infiere de una sola pasada cuando no hay tokenizer para medir", async () => {
      // El camino de reserva: sin tokenizer no se puede medir, y no medir no
      // puede empeorar nada — es el comportamiento previo a ADR-098.
      const { seen } = captureWithTokenizer(false);

      await kernelClassify(basePayload({ modelId: "model-no-tok", text: LONG_TEXT }), {
        timeoutMs: 5000,
        abortSignal: new AbortController().signal,
      });

      expect(seen).toEqual([LONG_TEXT]);
    });
  });
});
