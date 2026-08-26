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
import { EntityType, type NerPagePayload, type Serializable } from "@anonly/shared";
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
  mockTokenClassificationPipeline,
  nerToken,
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
        normalizedValue: "juan pérez",
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
});
