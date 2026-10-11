import type { Word } from "@anonly/shared";
import { describe, expect, it } from "vitest";

import type { Job } from "./adr190Dpi.js";
import type { RawOsd } from "./adr190OsdProbe.js";
import type { OcrAttempt } from "./adr190Recovery.js";
import {
  TEXT_FIELD_NAMES,
  buildM2Observation,
  expectedOf,
  fieldNames,
  m2FileName,
  m2ObservationIssues,
  type M2Input,
} from "./osdVerdictM2Run.js";
import { m2EntryOf } from "./osdVerdictM2TestSupport.js";

const word = (text: string, confidence: number): Word => ({
  text,
  confidence,
  bbox: { x: 0, y: 0, width: 1, height: 1 },
  pageIndex: 0,
  source: "ocr",
});

function attempt(options: {
  readonly jobId: string;
  readonly startedAt: number;
  readonly dispatched: number;
  readonly words: ReadonlyArray<Word>;
  readonly confidence?: number;
  readonly durationMs?: number;
}): OcrAttempt {
  const job: Job = {
    worker: 1,
    jobId: options.jobId,
    jobType: "ocr-page",
    documentId: "doc",
    pageIndex: 0,
    startedAt: options.startedAt,
    finishedAt: options.startedAt + (options.durationMs ?? 100),
    dpi: 150,
    orientation: options.dispatched,
    dispatchedOrientation: options.dispatched,
    upscale: 1,
    widthPx: 100,
    heightPx: 200,
    imageBytes: 4,
    terminal: "COMPLETED",
    result: { words: options.words, confidence: options.confidence ?? 0 },
    error: null,
  };
  return {
    job,
    input: {
      jobId: options.jobId,
      documentId: "doc",
      pageIndex: 0,
      dpi: 150,
      sourceOrientation: options.dispatched,
      dispatchedOrientation: options.dispatched,
      widthPx: 100,
      heightPx: 200,
      format: "png",
    },
    imageSha256: "aa",
  };
}

const orientationJob = (result: unknown): Job => ({
  worker: 2,
  jobId: "orient",
  jobType: "ocr-orient",
  documentId: "doc",
  pageIndex: 0,
  startedAt: 1,
  finishedAt: 2,
  dpi: null,
  orientation: null,
  upscale: 1,
  widthPx: 100,
  heightPx: 200,
  imageBytes: 4,
  terminal: "COMPLETED",
  result,
  error: null,
});

const RAW: RawOsd = {
  hostJobId: "orient",
  tesseractJobId: "t",
  rawOrientation: null,
  rawConfidence: null,
  error: "DetectOS returned no orientation",
  sessionId: "s",
  atMs: 1,
};

function input(key: string, overrides: Partial<M2Input> = {}): M2Input {
  const words = [
    word("Maria", 0.9),
    word("Gomez", 0.95),
    word("DNI", 0.9),
    word("28.123.456", 0.92),
  ];
  return {
    entry: m2EntryOf(key),
    fixtureSha256: "ff",
    forcedAngle: null,
    attempts: [attempt({ jobId: "p1", startedAt: 10, dispatched: 0, words, confidence: 0.8 })],
    orientationJob: orientationJob({ orientation: 0, inkRatio: 0.003, osdHadVerdict: false }),
    rawOsd: RAW,
    run: {
      words,
      entities: [{ value: "28.123.456", entityType: "DNI" }],
      ocrPages: [{ pageIndex: 0, confidence: 0.8, wordCount: 4 }],
      unreadableInkEvents: [],
    },
    readyMs: 900,
    ...overrides,
  };
}

describe("osdVerdictM2Run", () => {
  it("el nombre del archivo distingue producción y cada ángulo forzado", () => {
    expect(m2FileName("R1-p07", null)).toBe("R1-p07-production.json");
    expect(m2FileName("M1-150-90", 270)).toBe("M1-150-90-forced-270.json");
  });

  describe("margen", () => {
    it("registra por separado los datos del cuerpo y los del sello", () => {
      // Solo el sello: la lectura trae «Maria Gomez DNI 28.123.456» y nada del cuerpo.
      const record = buildM2Observation(input("M3-150-0"));
      expect(record.issues).toEqual([]);
      expect(record.kind).toBe("margin");
      expect(record.attempts[0]?.stamp).toEqual({ allTokens: true, dniToken: true });
      expect(record.attempts[0]?.body).toEqual({ allTokens: false, dniToken: false });
      expect(record.final.stamp).toEqual({ allTokens: true, dniToken: true, dniEntity: true });
      expect(record.final.body).toEqual({ allTokens: false, dniToken: false, dniEntity: false });
      expect(record.final.entityCounts).toEqual({ DNI: 1 });
    });

    it("M1 no tiene cuerpo: no hay datos del cuerpo que esperar", () => {
      expect(expectedOf(m2EntryOf("M1-150-0")).body).toBeNull();
      const record = buildM2Observation(input("M1-150-0"));
      expect(record.final.body).toBeNull();
      expect(record.attempts[0]?.body).toBeNull();
      expect(record.final.stamp?.allTokens).toBe(true);
    });

    it("el cuerpo de M3 son los dos renglones y el del sello el de siempre", () => {
      const expected = expectedOf(m2EntryOf("M3-300-0"));
      expect(expected.body?.tokens).toEqual(["juan", "perez", "dni", "34567891"]);
      expect(expected.stamp?.tokens).toEqual(["maria", "gomez", "dni", "28123456"]);
    });
  });

  describe("ruido", () => {
    it("registra las palabras y las entidades que inventó una hoja vacía", () => {
      const invented = [word("lit", 0.8), word("Ee", 0.4)];
      const record = buildM2Observation(
        input("RU5-150-0", {
          attempts: [
            attempt({
              jobId: "p1",
              startedAt: 10,
              dispatched: 0,
              words: invented,
              confidence: 0.6,
            }),
          ],
          run: {
            words: invented,
            entities: [{ value: "x", entityType: "PERSON" }],
            ocrPages: [{ pageIndex: 0, confidence: 0.6, wordCount: 2 }],
            unreadableInkEvents: [],
          },
        }),
      );
      expect(record.issues).toEqual([]);
      expect(record.attempts[0]?.reliableWordCount).toBe(1);
      expect(record.attempts[0]?.words?.map((w) => w.text)).toEqual(["lit", "Ee"]);
      expect(record.final.entities).toEqual([{ entityType: "PERSON", value: "x" }]);
      expect(record.final.body).toBeNull();
      expect(record.final.stamp).toBeNull();
    });
  });

  describe("páginas reales: sin texto", () => {
    const secretWords = [
      word("Fernandez", 0.9),
      word("Alberto", 0.8),
      word("20-30405060-7", 0.95),
      word("calle", 0.4),
    ];
    const real = buildM2Observation(
      input("R1-p07", {
        attempts: [
          attempt({
            jobId: "p1",
            startedAt: 10,
            dispatched: 0,
            words: secretWords,
            confidence: 0.77,
          }),
          attempt({ jobId: "p2", startedAt: 500, dispatched: 90, words: [word("zzz", 0.2)] }),
        ],
        run: {
          words: secretWords,
          entities: [
            { value: "20-30405060-7", entityType: "CUIT" },
            { value: "Fernandez Alberto", entityType: "PERSON" },
            { value: "Fernandez", entityType: "PERSON" },
          ],
          ocrPages: [{ pageIndex: 0, confidence: 0.77, wordCount: 4 }],
          unreadableInkEvents: [],
        },
      }),
    );

    it("guarda cantidades, confianzas, tinta, ángulos, tiempos, dimensiones y hashes", () => {
      expect(real.issues).toEqual([]);
      expect(real.kind).toBe("real");
      expect(real.attempts[0]).toMatchObject({
        wordCount: 4,
        reliableWordCount: 3,
        pageConfidence: 0.77,
        confidences: [0.9, 0.8, 0.95, 0.4],
        widthPx: 100,
        imageSha256: "aa",
        durationMs: 100,
      });
      expect(real.natural.inkRatio).toBe(0.003);
      expect(real.final.entityCounts).toEqual({ CUIT: 1, PERSON: 2 });
      expect(real.final.confidences).toEqual([0.9, 0.8, 0.95, 0.4]);
      expect(real.finalAttemptOrder).toBe(0);
    });

    it("el registro de una observación real no tiene ningún campo de texto", () => {
      const names = fieldNames(real);
      for (const forbidden of TEXT_FIELD_NAMES) expect(names.has(forbidden)).toBe(false);
      expect(names.has("words")).toBe(false);
      expect(names.has("entities")).toBe(false);
    });

    it("ni el contenido de la página ni los valores de las entidades aparecen en ningún lugar del registro", () => {
      const json = JSON.stringify(real);
      for (const secret of ["Fernandez", "Alberto", "20-30405060-7", "calle", "zzz"])
        expect(json).not.toContain(secret);
    });

    it("las únicas cadenas del registro son identificadores neutros, hashes, modos y tipos de entidad", () => {
      const strings: string[] = [];
      (function collect(value: unknown): void {
        if (typeof value === "string") strings.push(value);
        else if (Array.isArray(value)) value.forEach(collect);
        else if (typeof value === "object" && value !== null) Object.values(value).forEach(collect);
      })(real);
      for (const text of strings) expect(text).toMatch(/^[A-Za-z0-9_ -]*$/);
    });

    it("un sintético sí conserva el texto: la diferencia es del tipo de página", () => {
      const synthetic = buildM2Observation(input("M1-150-0"));
      const names = fieldNames(synthetic);
      expect(names.has("words")).toBe(true);
      expect(names.has("entities")).toBe(true);
    });
  });

  describe("lectura final", () => {
    it("reconoce la lectura que entregó la cadena aunque el documento reordene las palabras", () => {
      const first = [word("a", 0.9), word("b", 0.8)];
      const second = [word("c", 0.7), word("d", 0.9)];
      const record = buildM2Observation(
        input("M3-150-0", {
          attempts: [
            attempt({ jobId: "p1", startedAt: 10, dispatched: 0, words: first }),
            attempt({ jobId: "p2", startedAt: 20, dispatched: 90, words: second }),
          ],
          run: {
            words: [word("d", 0.9), word("c", 0.7)],
            entities: [],
            ocrPages: [{ pageIndex: 0, confidence: 0.8, wordCount: 2 }],
            unreadableInkEvents: [],
          },
        }),
      );
      expect(record.finalAttemptOrder).toBe(1);
      expect(record.issues).toEqual([]);
    });

    it("una lectura final que no coincide con ningún reconocimiento es un issue", () => {
      const record = buildM2Observation(
        input("M3-150-0", {
          run: { ...input("M3-150-0").run, words: [word("otra", 0.5)] },
        }),
      );
      expect(record.finalAttemptOrder).toBeNull();
      expect(record.issues).toContain("la lectura final no coincide con ningún reconocimiento");
    });

    it("una página sin palabras no necesita coincidir y el aviso sale del evento", () => {
      const record = buildM2Observation(
        input("RU2-150-0", {
          attempts: [attempt({ jobId: "p1", startedAt: 10, dispatched: 0, words: [] })],
          run: {
            words: [],
            entities: [],
            ocrPages: [{ pageIndex: 0, confidence: 0, wordCount: 0, unreadableInk: true }],
            unreadableInkEvents: [{ pageIndex: 0, unreadableInk: true }],
          },
        }),
      );
      expect(record.final.unreadableInk).toBe(true);
      expect(record.finalAttemptOrder).toBe(0);
      expect(record.issues).toEqual([]);
    });
  });

  describe("veredicto forzado", () => {
    it("guarda lo recibido y lo natural, y detecta un veredicto que no llegó", () => {
      const forcedJob = {
        ...orientationJob({ orientation: 180, inkRatio: 0.003, osdHadVerdict: true }),
        naturalResult: { orientation: 0, inkRatio: 0.003, osdHadVerdict: false },
      };
      const ok = buildM2Observation(
        input("M3-150-0", {
          forcedAngle: 180,
          orientationJob: forcedJob,
          attempts: [
            attempt({ jobId: "p1", startedAt: 10, dispatched: 180, words: [word("a", 0.9)] }),
          ],
          run: {
            words: [word("a", 0.9)],
            entities: [],
            ocrPages: [{ pageIndex: 0, confidence: 0.9, wordCount: 1 }],
            unreadableInkEvents: [],
          },
        }),
      );
      expect(ok.issues).toEqual([]);
      expect(ok.natural.osdHadVerdict).toBe(false);
      expect(ok.delivered).toEqual({ orientation: 180, osdHadVerdict: true, inkRatio: 0.003 });
      const broken = buildM2Observation(input("M3-150-0", { forcedAngle: 90 }));
      expect(broken.issues.join("|")).toContain("el host recibió orientación 0");
      expect(m2ObservationIssues(broken).length).toBeGreaterThan(0);
    });
  });
});
