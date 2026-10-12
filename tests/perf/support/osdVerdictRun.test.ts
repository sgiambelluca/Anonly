import type { Word } from "@anonly/shared";
import { describe, expect, it } from "vitest";

import type { Job } from "./adr190Dpi.js";
import type { RawOsd } from "./adr190OsdProbe.js";
import type { OcrAttempt } from "./adr190Recovery.js";
import { corpusEntries, type CorpusEntry } from "./osdVerdictCorpus.js";
import {
  buildObservation,
  countReliable,
  observationFileName,
  observationIssues,
  readOrientationView,
  type ObservationInput,
  type ObservationRecord,
} from "./osdVerdictRun.js";

const word = (text: string, confidence: number): Word => ({
  text,
  confidence,
  bbox: { x: 0, y: 0, width: 1, height: 1 },
  pageIndex: 0,
  source: "ocr",
});

const CLEAN: ReadonlyArray<Word> = [
  word("Juan", 0.95),
  word("Perez", 0.95),
  word("DNI", 0.93),
  word("34.567.891", 0.9),
];

function entryOf(key: string): CorpusEntry {
  const found = corpusEntries().find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`sin entrada ${key}`);
  return found;
}

function attempt(options: {
  jobId: string;
  startedAt: number;
  dispatched: number;
  source?: number;
  words?: ReadonlyArray<Word>;
  confidence?: number;
  durationMs?: number;
  sha?: string;
  dpi?: number;
  upscale?: number;
  terminal?: string;
}): OcrAttempt {
  const source = options.source ?? options.dispatched;
  const job: Job = {
    worker: 1,
    jobId: options.jobId,
    jobType: "ocr-page",
    documentId: "doc",
    pageIndex: 0,
    startedAt: options.startedAt,
    finishedAt: options.startedAt + (options.durationMs ?? 100),
    dpi: options.dpi ?? 150,
    orientation: source,
    dispatchedOrientation: options.dispatched,
    upscale: options.upscale ?? 1,
    widthPx: 100,
    heightPx: 200,
    imageBytes: 4,
    terminal: options.terminal ?? "COMPLETED",
    result: { words: options.words ?? [], confidence: options.confidence ?? 0 },
    error: null,
  };
  return {
    job,
    input: {
      jobId: options.jobId,
      documentId: "doc",
      pageIndex: 0,
      dpi: options.dpi ?? 150,
      sourceOrientation: source,
      dispatchedOrientation: options.dispatched,
      widthPx: 100,
      heightPx: 200,
      format: "png",
    },
    imageSha256: options.sha ?? "aa",
  };
}

function orientationJob(result: unknown, natural?: unknown): Job {
  return {
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
    ...(natural === undefined ? {} : { naturalResult: natural }),
  };
}

const RAW: RawOsd = {
  hostJobId: "orient",
  tesseractJobId: "t",
  rawOrientation: null,
  rawConfidence: null,
  error: "DetectOS returned no orientation",
  sessionId: "s",
  atMs: 1,
};

function input(overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    entry: entryOf("two-lines-150-180"),
    fixture: { hash: "ff", expectedText: "Juan Perez\nDNI 34.567.891", expectedDni: "34.567.891" },
    forcedAngle: null,
    attempts: [
      attempt({ jobId: "p1", startedAt: 10, dispatched: 0, words: CLEAN, confidence: 0.9 }),
    ],
    orientationJob: orientationJob({ orientation: 0, inkRatio: 0.001, osdHadVerdict: false }),
    rawOsd: RAW,
    run: {
      words: CLEAN,
      entities: [{ value: "34.567.891", entityType: "DNI" }],
      ocrPages: [{ pageIndex: 0, confidence: 0.9, wordCount: 4 }],
      unreadableInkEvents: [],
    },
    readyMs: 1234,
    ...overrides,
  };
}

describe("osdVerdictRun", () => {
  it("el nombre del archivo distingue producción y cada ángulo forzado", () => {
    expect(observationFileName("N7-300-90", null)).toBe("N7-300-90-production.json");
    expect(observationFileName("N7-300-90", 270)).toBe("N7-300-90-forced-270.json");
  });

  it("cuenta las palabras confiables con el umbral 0,6 inclusive", () => {
    expect(countReliable([word("a", 0.59), word("b", 0.6), word("c", 1)])).toBe(2);
  });

  it("lee la vista de orientación y no inventa lo que falta", () => {
    expect(readOrientationView({ orientation: 90, inkRatio: 0.5, osdHadVerdict: true })).toEqual({
      orientation: 90,
      osdHadVerdict: true,
      inkRatio: 0.5,
    });
    expect(readOrientationView(null)).toEqual({
      orientation: null,
      osdHadVerdict: null,
      inkRatio: null,
    });
    expect(readOrientationView({ orientation: "0", inkRatio: 1 })).toEqual({
      orientation: null,
      osdHadVerdict: null,
      inkRatio: 1,
    });
  });

  describe("producción", () => {
    it("registra el veredicto natural, el ráster, la lectura final y los datos esperados", () => {
      const record = buildObservation(input());
      expect(record.issues).toEqual([]);
      expect(record.mode).toBe("production");
      expect(record.forcedAngle).toBeNull();
      expect(record.correctAngle).toBe(180);
      expect(record.natural).toEqual({ orientation: 0, osdHadVerdict: false, inkRatio: 0.001 });
      expect(record.delivered).toEqual(record.natural);
      expect(record.rawOsd).toEqual({
        orientation: null,
        confidence: null,
        error: "DetectOS returned no orientation",
      });
      expect(record.effectiveDpi).toBe(150);
      expect(record.attempts).toHaveLength(1);
      expect(record.attempts[0]).toMatchObject({
        order: 0,
        sourceOrientation: 0,
        dispatchedOrientation: 0,
        reliableWordCount: 4,
        pageConfidence: 0.9,
        allExpectedTokens: true,
        dniTokenPresent: true,
        durationMs: 100,
        imageSha256: "aa",
      });
      expect(record.final).toMatchObject({
        wordCount: 4,
        reliableWordCount: 4,
        pageConfidence: 0.9,
        unreadableInk: false,
        dniEntity: true,
        allExpectedTokens: true,
        expectedDataPresent: true,
      });
      expect(record.totalOcrDurationMs).toBe(100);
      expect(record.readyMs).toBe(1234);
      expect(record.expectedTokens).toEqual(["juan", "perez", "dni", "34567891"]);
    });

    it("una lectura de basura confiable no tiene los datos esperados ni el aviso: es la fuga", () => {
      const garbage = [word("lit", 0.8), word("Ee", 0.7)];
      const record = buildObservation(
        input({
          attempts: [attempt({ jobId: "p1", startedAt: 10, dispatched: 0, words: garbage })],
          run: {
            words: garbage,
            entities: [],
            ocrPages: [{ pageIndex: 0, confidence: 0.75, wordCount: 2 }],
            unreadableInkEvents: [],
          },
        }),
      );
      expect(record.final).toMatchObject({
        reliableWordCount: 2,
        dniEntity: false,
        allExpectedTokens: false,
        expectedDataPresent: false,
        unreadableInk: false,
      });
    });

    it("marca unreadableInk por el evento de la página", () => {
      const record = buildObservation(
        input({
          run: {
            words: [],
            entities: [],
            ocrPages: [{ pageIndex: 0, confidence: 0, wordCount: 0, unreadableInk: true }],
            unreadableInkEvents: [{ pageIndex: 0, unreadableInk: true }],
          },
        }),
      );
      expect(record.final.unreadableInk).toBe(true);
      expect(record.final.pageConfidence).toBe(0);
      expect(record.final.expectedDataPresent).toBe(false);
    });

    it("el DNI como entidad se compara por sus dígitos y solo de tipo DNI", () => {
      const other = buildObservation(
        input({ run: { ...input().run, entities: [{ value: "34567891", entityType: "PHONE" }] } }),
      );
      expect(other.final.dniEntity).toBe(false);
      const digits = buildObservation(
        input({ run: { ...input().run, entities: [{ value: "34567891", entityType: "DNI" }] } }),
      );
      expect(digits.final.dniEntity).toBe(true);
    });

    it("un control sin texto esperado no tiene datos esperados que faltar", () => {
      const record = buildObservation(
        input({
          entry: entryOf("blank-150-0"),
          fixture: { hash: "ee", expectedText: "", expectedDni: null },
          run: { words: [], entities: [], ocrPages: [], unreadableInkEvents: [] },
        }),
      );
      expect(record.expectedTokens).toEqual([]);
      expect(record.final.dniEntity).toBeNull();
      expect(record.final.allExpectedTokens).toBeNull();
      expect(record.final.expectedDataPresent).toBeNull();
    });
  });

  describe("veredicto forzado", () => {
    const forced = (angle: 0 | 90 | 180 | 270) =>
      input({
        forcedAngle: angle,
        orientationJob: orientationJob(
          { orientation: angle, inkRatio: 0.001, osdHadVerdict: true },
          { orientation: 0, inkRatio: 0.001, osdHadVerdict: false },
        ),
        attempts: [attempt({ jobId: "p1", startedAt: 10, dispatched: angle })],
      });

    it("guarda lo que recibió el host y lo que devolvió el worker, por separado", () => {
      const record = buildObservation(forced(90));
      expect(record.issues).toEqual([]);
      expect(record.mode).toBe("forced-verdict");
      expect(record.forcedAngle).toBe(90);
      expect(record.delivered).toEqual({ orientation: 90, osdHadVerdict: true, inkRatio: 0.001 });
      expect(record.natural).toEqual({ orientation: 0, osdHadVerdict: false, inkRatio: 0.001 });
    });

    it("un veredicto forzado a 0 sobre un OSD sin veredicto llega con osdHadVerdict true", () => {
      const record = buildObservation(forced(0));
      expect(record.issues).toEqual([]);
      expect(record.delivered).toMatchObject({ orientation: 0, osdHadVerdict: true });
      expect(record.natural.osdHadVerdict).toBe(false);
    });
  });

  describe("observationIssues", () => {
    const base = (): ObservationRecord => buildObservation(input());
    const asForced = (angle: 0 | 90 | 180 | 270): ObservationRecord =>
      buildObservation({
        ...input(),
        forcedAngle: angle,
        orientationJob: orientationJob(
          { orientation: angle, inkRatio: 0.001, osdHadVerdict: true },
          { orientation: 0, inkRatio: 0.001, osdHadVerdict: false },
        ),
        attempts: [attempt({ jobId: "p1", startedAt: 10, dispatched: angle })],
      });

    it("un registro coherente no tiene issues", () => {
      expect(observationIssues(base())).toEqual([]);
      expect(observationIssues(asForced(270))).toEqual([]);
    });

    it("detecta que el host no recibió el veredicto forzado", () => {
      const record = asForced(90);
      const wrong: ObservationRecord = {
        ...record,
        delivered: { ...record.delivered, orientation: 0 },
      };
      expect(observationIssues(wrong).join("|")).toContain("el host recibió orientación 0");
      const noVerdict: ObservationRecord = {
        ...record,
        delivered: { ...record.delivered, osdHadVerdict: false },
      };
      expect(observationIssues(noVerdict).join("|")).toContain("no recibió osdHadVerdict=true");
    });

    it("detecta una producción cuyo resultado no es el natural", () => {
      const record = base();
      const changed: ObservationRecord = {
        ...record,
        delivered: { ...record.delivered, orientation: 90 },
      };
      expect(observationIssues(changed).join("|")).toContain("difiere del resultado natural");
    });

    it("detecta un primer reconocimiento que no usó el ángulo del OSD", () => {
      const record = asForced(180);
      const first = record.attempts[0];
      if (first === undefined) throw new Error("sin intento");
      const changed: ObservationRecord = {
        ...record,
        attempts: [{ ...first, sourceOrientation: 0, dispatchedOrientation: 0 }],
      };
      const text = observationIssues(changed).join("|");
      expect(text).toContain("usó 0, no el 180 del OSD");
      expect(text).toContain("no salió en el ángulo forzado");
    });

    it("detecta rásters o DPI distintos dentro de una observación", () => {
      const record = base();
      const first = record.attempts[0];
      if (first === undefined) throw new Error("sin intento");
      const changed: ObservationRecord = {
        ...record,
        attempts: [first, { ...first, order: 1, imageSha256: "bb", dpi: 300 }],
      };
      const text = observationIssues(changed).join("|");
      expect(text).toContain("mismo ráster");
      expect(text).toContain("DPI distintos");
    });

    it("detecta osdHadVerdict=false con una orientación que no es 0, inkRatio fuera de rango y sin lecturas", () => {
      const record = base();
      const changed: ObservationRecord = {
        ...record,
        natural: { orientation: 90, osdHadVerdict: false, inkRatio: 2 },
        delivered: { orientation: 90, osdHadVerdict: false, inkRatio: 2 },
        attempts: [],
      };
      const text = observationIssues(changed).join("|");
      expect(text).toContain("osdHadVerdict=false con orientación distinta de 0");
      expect(text).toContain("inkRatio fuera de [0, 1]");
      expect(text).toContain("sin ningún reconocimiento");
    });

    it("una primera lectura fallida es un issue", () => {
      const failed = buildObservation(
        input({
          attempts: [attempt({ jobId: "p1", startedAt: 10, dispatched: 0, terminal: "FAILED" })],
        }),
      );
      expect(failed.issues.join("|")).toContain("primera lectura FAILED");
    });
  });

  it("registra los reintentos de la cadena en orden, con sus tiempos y su ráster", () => {
    const record = buildObservation(
      input({
        attempts: [
          attempt({ jobId: "p1", startedAt: 10, dispatched: 0, durationMs: 300 }),
          attempt({ jobId: "p2", startedAt: 400, dispatched: 90, durationMs: 200 }),
          attempt({
            jobId: "p3",
            startedAt: 700,
            dispatched: 180,
            words: CLEAN,
            confidence: 0.95,
            durationMs: 250,
            upscale: 2,
          }),
        ],
      }),
    );
    expect(record.attempts.map((a) => [a.order, a.dispatchedOrientation, a.upscale])).toEqual([
      [0, 0, 1],
      [1, 90, 1],
      [2, 180, 2],
    ]);
    expect(record.totalOcrDurationMs).toBe(750);
    expect(record.attempts[2]?.allExpectedTokens).toBe(true);
    expect(record.attempts[0]?.allExpectedTokens).toBe(false);
  });
});
