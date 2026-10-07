import { describe, expect, it } from "vitest";

import { EMAIL_READINGS, type EmailReading } from "./ocrEmailsNativeReading.js";
import {
  nativeCellFileName,
  nativeCellId,
  nativeResultLine,
  summarizeCell,
  summarizeNative,
  type NativeCellView,
} from "./ocrEmailsNativeSummary.js";

function readings(patch: Partial<Record<EmailReading, number>> = {}): Record<EmailReading, number> {
  return {
    ...(Object.fromEntries(EMAIL_READINGS.map((reading) => [reading, 0])) as Record<
      EmailReading,
      number
    >),
    ...patch,
  };
}

interface CellPatch {
  readonly valid?: boolean;
  readonly invalidReasons?: ReadonlyArray<string>;
  readonly lost?: NativeCellView["emails"]["lost"];
  readonly sha?: string;
  readonly otherMissed?: NativeCellView["otherTypes"]["missed"];
  readonly unrelated?: number;
}

function cell(
  corpus: string,
  nativeDpi: number,
  repetition: number,
  patch: CellPatch = {},
): NativeCellView {
  const lost = patch.lost ?? [];
  const counts = readings();
  for (const item of lost) counts[item.reading] += 1;
  return {
    repetition,
    valid: patch.valid ?? true,
    invalidReasons: patch.invalidReasons ?? [],
    emails: {
      expected: 4,
      detected: 4 - lost.length,
      matched: 4 - lost.length,
      missed: lost.length,
      added: 0,
      lost,
      readingCounts: counts,
      addedValues: [],
    },
    otherTypes: { byType: {}, missed: patch.otherMissed ?? [], added: [] },
    tolerantRule: {
      counts: {
        total: lost.length + (patch.unrelated ?? 0),
        recoverable: lost.length,
        partialOfTruth: 0,
        unrelated: patch.unrelated ?? 0,
      },
      candidates: [],
    },
    nativeDpiEvidence: {
      pageCaps: [nativeDpi],
      effectiveDpis: [nativeDpi],
      allDispatchesAtNativeDpi: true,
    },
    pagesRead: 1,
    observedTextSha256: patch.sha ?? "h",
  };
}

const LOST_Q = [
  {
    pageIndex: 0,
    expected: "a.b@example.org",
    reading: "at-as-q" as const,
    fragment: "a.bQexample.org",
  },
];

describe("nombres", () => {
  it("el id y el archivo de la celda llevan el DPI nativo", () => {
    expect(nativeCellId("SR", 150, 2)).toBe("SR-n150-r2");
    expect(nativeCellFileName("SR-n150-r2")).toBe("ocr-emails-native-cell-SR-n150-r2.json");
  });
});

describe("summarizeCell", () => {
  it("cuenta lo perdido por tipo y conserva el fragmento leído", () => {
    const summary = summarizeCell(
      cell("S8", 150, 1, {
        lost: LOST_Q,
        otherMissed: [
          { type: "PERSON", pageIndex: 0, value: "x" },
          { type: "PERSON", pageIndex: 0, value: "y" },
        ],
      }),
    );
    expect(summary.emails.missed).toBe(1);
    expect(summary.lost[0]?.fragment).toBe("a.bQexample.org");
    expect(summary.otherTypes.missedByType).toEqual({ PERSON: 2 });
  });
});

describe("summarizeNative", () => {
  const base = { corpora: ["S8", "S10"], dpis: [300, 150], repetitions: 2 } as const;

  it("completo y con repeticiones coincidentes: totales por DPI y tabla", () => {
    const summary = summarizeNative({
      ...base,
      readCell: (corpus, dpi, repetition) =>
        cell(corpus, dpi, repetition, dpi === 150 && corpus === "S8" ? { lost: LOST_Q } : {}),
      sleepDetection: { available: true, note: null },
    });
    expect(summary.complete).toBe(true);
    expect(summary.allRepetitionsAgree).toBe(true);
    expect(summary.groups).toHaveLength(4);
    const at150 = summary.totalsByDpi.find((total) => total.nativeDpi === 150);
    expect(at150?.byRepetition[0]?.emails).toEqual({
      expected: 8,
      detected: 7,
      missed: 1,
      added: 0,
    });
    expect(at150?.byRepetition[0]?.readingCounts["at-as-q"]).toBe(1);
    expect(summary.lostEmails).toHaveLength(2);
    expect(summary.lostEmails[0]).toMatchObject({ corpus: "S8", nativeDpi: 150, repetition: 1 });
    expect(summary.tableLines.join("\n")).toContain("a.bQexample.org");
    expect(nativeResultLine(summary)).toBe(
      "complete=true celdas=8/8 invalidas=0 repeticionesCoinciden=si salvedades=0",
    );
  });

  it("repeticiones que no coinciden se informan y no invalidan", () => {
    const summary = summarizeNative({
      ...base,
      readCell: (corpus, dpi, repetition) =>
        cell(
          corpus,
          dpi,
          repetition,
          corpus === "S8" && dpi === 150 && repetition === 2 ? { lost: LOST_Q } : {},
        ),
    });
    const group = summary.groups.find((item) => item.corpus === "S8" && item.nativeDpi === 150);
    expect(group?.repetitionsAgree).toBe(false);
    expect(group?.disagreements).toHaveLength(1);
    expect(summary.allRepetitionsAgree).toBe(false);
    expect(summary.complete).toBe(true);
  });

  it("repeticiones iguales pero con texto distinto coinciden en lo medido y no en el texto", () => {
    const summary = summarizeNative({
      ...base,
      readCell: (corpus, dpi, repetition) =>
        cell(corpus, dpi, repetition, { sha: `h${repetition}` }),
    });
    expect(summary.groups[0]?.repetitionsAgree).toBe(true);
    expect(summary.groups[0]?.observedTextIdentical).toBe(false);
  });

  it("una celda inválida se lista con su motivo y no entra a ningún total", () => {
    const summary = summarizeNative({
      ...base,
      readCell: (corpus, dpi, repetition) =>
        corpus === "S10" && dpi === 150 && repetition === 1
          ? cell(corpus, dpi, repetition, {
              valid: false,
              invalidReasons: ["dispatch-dpi-not-native: x"],
            })
          : cell(corpus, dpi, repetition),
    });
    expect(summary.complete).toBe(false);
    expect(summary.invalidCells).toEqual([
      { cellId: "S10-n150-r1", reasons: ["dispatch-dpi-not-native: x"] },
    ]);
    const group = summary.groups.find((item) => item.corpus === "S10" && item.nativeDpi === 150);
    expect(group?.cells).toHaveLength(1);
    expect(group?.repetitionsAgree).toBeNull();
    expect(summary.allRepetitionsAgree).toBeNull();
    const at150 = summary.totalsByDpi.find((total) => total.nativeDpi === 150);
    expect(at150?.byRepetition[0]?.corpora).toEqual(["S8"]);
    expect(summary.tableLines.join("\n")).toContain("S10-n150-r1: dispatch-dpi-not-native: x");
  });

  it("una celda ausente se lista y la tanda queda incompleta", () => {
    const summary = summarizeNative({
      ...base,
      readCell: (corpus, dpi, repetition) =>
        corpus === "S8" && dpi === 300 && repetition === 2 ? null : cell(corpus, dpi, repetition),
    });
    expect(summary.missingCells).toEqual(["S8-n300-r2"]);
    expect(summary.complete).toBe(false);
    expect(nativeResultLine(summary)).toContain("celdas=7/8");
  });

  it("con una sola repetición (humo) no se dice que coincidan", () => {
    const summary = summarizeNative({
      corpora: ["S10"],
      dpis: [300],
      repetitions: 1,
      smoke: true,
      readCell: (corpus, dpi, repetition) => cell(corpus, dpi, repetition),
    });
    expect(summary.complete).toBe(true);
    expect(summary.groups[0]?.repetitionsAgree).toBeNull();
    expect(nativeResultLine(summary)).toContain("(humo)");
    expect(nativeResultLine(summary)).toContain("repeticionesCoinciden=n/d");
  });

  it("suma los candidatos ajenos de la regla tolerante y las salvedades de validez", () => {
    const summary = summarizeNative({
      corpora: ["S10"],
      dpis: [300],
      repetitions: 2,
      readCell: (corpus, dpi, repetition) => cell(corpus, dpi, repetition, { unrelated: 3 }),
      caveats: [{ id: "sleep-prevention-unavailable", note: "x" }],
    });
    expect(summary.totalsByDpi[0]?.byRepetition[0]?.tolerantRule.unrelated).toBe(3);
    expect(summary.validityCaveats.map((caveat) => caveat.split(":")[0])).toEqual([
      "sleep-detection-unknown",
      "sleep-prevention-unavailable",
    ]);
  });
});
