/**
 * Snapshot de occurrences para "text-10p.pdf" (NER_Engine.md §14).
 *
 * `tests/fixtures/text-10p.pdf` existe como PDF generado (tests/fixtures/generate.ts
 * -> generateText10p()), pero su contenido canónico (TEXT_10P_PAGES,
 * documentado en tests/fixtures/README.md "Contenido conocido") NO incluye
 * ninguna fecha (ni numérica ni escrita en palabras) — solo nombres, DNIs,
 * CUIT, teléfono, email, direcciones y una organización. NER_Engine.md §14
 * exige un snapshot con "fechas tanto numéricas como escritas en palabras",
 * y ADR-023 §2 explícitamente condiciona la cobertura de fechas en lenguaje
 * natural al dataset de referencia. Añadir fechas al fixture compartido
 * cambiaría el contenido que ya consumen pdf-engine/regex-engine/
 * grouping-engine (fuera de alcance de un PR de un solo módulo, R-1/R-5).
 *
 * regex-engine ya resolvió exactamente esta misma tensión para el mismo
 * nombre de test ("snapshot of occurrences for text-10p.pdf stable", ver
 * regex-engine/src/__tests__/snapshot.test.ts): construye un `Document`
 * equivalente en memoria con contenido conocido en vez de leer el PDF. Este
 * test sigue el mismo criterio, con contenido conocido que sí incluye
 * personas, organización, dirección y fechas (numérica y escrita en
 * palabras) — el conjunto de entidades que NER_Engine.md §14 pide cubrir.
 */
import { EngineEvents, type EngineContext, type EntityFound } from "@anonly/shared";
import { pipeline, type TokenClassificationSingle } from "@xenova/transformers";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn(),
  env: {
    allowRemoteModels: true,
    localModelPath: "/models/",
    backends: { onnx: { wasm: {} } },
  },
}));

import { NerEngine } from "../ner.engine.js";

import {
  asPipelineMock,
  createEngineContext,
  makeNerPageInput,
  mockTokenClassificationPipeline,
  nerToken,
  type PipelineCallOptions,
} from "./fixtures/test-helpers.js";

const PAGE_0_TOKENS = [
  "Juan",
  "Pérez",
  "vive",
  "en",
  "Belgrano",
  "1234",
  "desde",
  "el",
  "3",
  "de",
  "mayo",
  "de",
  "2024.",
];

const PAGE_1_TOKENS = [
  "María",
  "Gómez",
  "trabaja",
  "en",
  "Empresa",
  "S.A.",
  "con",
  "sede",
  "en",
  "Rivadavia",
  "455,",
  "vigente",
  "desde",
  "15/03/2022.",
];

function scriptedClassifier(): (text: string) => Promise<ReadonlyArray<TokenClassificationSingle>> {
  const page0Text = PAGE_0_TOKENS.join(" ");
  const page1Text = PAGE_1_TOKENS.join(" ");

  return (text: string) => {
    if (text === page0Text) {
      return Promise.resolve([
        nerToken("B-PER", "Juan", 0.98, 0),
        nerToken("I-PER", "Pérez", 0.97, 1),
        nerToken("B-LOC", "Belgrano", 0.91, 4),
        nerToken("I-LOC", "1234", 0.88, 5),
        nerToken("B-DATE", "3", 0.85, 8),
        nerToken("I-DATE", "de", 0.84, 9),
        nerToken("I-DATE", "mayo", 0.9, 10),
        nerToken("I-DATE", "de", 0.83, 11),
        nerToken("I-DATE", "2024", 0.89, 12),
      ]);
    }
    if (text === page1Text) {
      return Promise.resolve([
        nerToken("B-PER", "María", 0.96, 0),
        nerToken("I-PER", "Gómez", 0.95, 1),
        nerToken("B-ORG", "Empresa", 0.86, 4),
        nerToken("I-ORG", "S.A.", 0.82, 5),
        nerToken("B-LOC", "Rivadavia", 0.79, 9),
        nerToken("I-LOC", "455", 0.75, 10),
        nerToken("B-DATE", "15/03/2022", 0.93, 13),
      ]);
    }
    return Promise.resolve([]);
  };
}

describe("NerEngine — snapshot", () => {
  let engine: NerEngine;
  let ctx: EngineContext;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_234_567_890_000);
    asPipelineMock(pipeline).mockImplementation(
      (_task: string, _model?: string, _options?: PipelineCallOptions) =>
        Promise.resolve(mockTokenClassificationPipeline(scriptedClassifier())),
    );
    engine = new NerEngine();
    ctx = createEngineContext();
    await engine.init(ctx);
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("snapshot of occurrences for text-10p.pdf stable", async () => {
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const inputs = [
      makeNerPageInput("snapshot-doc", 0, PAGE_0_TOKENS),
      makeNerPageInput("snapshot-doc", 1, PAGE_1_TOKENS),
    ];

    const outputs = await engine.processPages(inputs, ctx);

    // `id` es un UUID v4 aleatorio (no determinista): se excluye del
    // snapshot, igual criterio que regex-engine/src/__tests__/snapshot.test.ts.
    const occurrences = busEmitSpy.mock.calls
      .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
      .map((call) => {
        const { occurrence } = call[2] as EntityFound;
        const { id: _id, ...rest } = occurrence;
        return rest;
      });

    const totalOccurrences = outputs.reduce((sum, output) => sum + output.occurrences.length, 0);
    expect(totalOccurrences).toBeGreaterThan(0);
    expect({
      outputs: outputs.map(({ documentId, pageIndex, occurrences: occ }) => ({
        documentId,
        pageIndex,
        occurrenceCount: occ.length,
      })),
      occurrences,
    }).toMatchSnapshot();
  });
});
