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
});
