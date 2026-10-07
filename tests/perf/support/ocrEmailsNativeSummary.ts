/**
 * Agregador puro de la campaña «emails en escaneos de DPI nativo bajo» (M-E1): por corpus y DPI
 * nativo, las dos repeticiones, si coinciden, y una tabla legible. Sin filesystem: quien lo llama
 * inyecta la lectura de celdas. Lo ausente y lo inválido nunca se convierte en cero: una celda
 * inválida (p. ej. con un DPI efectivo distinto del nativo) se lista y no entra a ningún total.
 */

import type { NativeCellRecord } from "./ocrEmailsNativeCell.js";
import { EMAIL_READINGS, type EmailReading } from "./ocrEmailsNativeReading.js";
import {
  validityCaveatsOf,
  type UltraCaveat,
  type UltraSleepDetection,
  type UltraValidity,
} from "./ocrPoolUltraSummary.js";

export const NATIVE_CORPORA: ReadonlyArray<string> = ["SR", "S12", "S10", "S8"];
export const NATIVE_DPIS: ReadonlyArray<number> = [300, 200, 150];
export const NATIVE_REPETITIONS = 2;

const NOT_REPORTED: UltraSleepDetection = {
  available: null,
  note: "tanda anterior al campo: no se sabe si la detección de suspensión estuvo activa",
};

export function nativeCellId(corpus: string, nativeDpi: number, repetition: number): string {
  return `${corpus}-n${nativeDpi}-r${repetition}`;
}

export function nativeCellFileName(id: string): string {
  return `ocr-emails-native-cell-${id}.json`;
}

/** Lo que el agregador lee de una celda: el resto del registro no le hace falta. */
export type NativeCellView = Pick<
  NativeCellRecord,
  | "repetition"
  | "valid"
  | "invalidReasons"
  | "emails"
  | "otherTypes"
  | "tolerantRule"
  | "nativeDpiEvidence"
  | "pagesRead"
  | "observedTextSha256"
>;

export interface TolerantCounts {
  readonly total: number;
  readonly recoverable: number;
  readonly partialOfTruth: number;
  readonly unrelated: number;
}

export interface CellSummary {
  readonly repetition: number;
  readonly emails: {
    readonly expected: number;
    readonly detected: number;
    readonly missed: number;
    readonly added: number;
  };
  readonly readingCounts: Readonly<Record<EmailReading, number>>;
  readonly lost: ReadonlyArray<{
    readonly pageIndex: number;
    readonly expected: string;
    readonly reading: EmailReading;
    readonly fragment: string | null;
  }>;
  readonly addedEmails: ReadonlyArray<string>;
  readonly otherTypes: {
    readonly missed: number;
    readonly added: number;
    readonly missedByType: Readonly<Record<string, number>>;
    readonly addedByType: Readonly<Record<string, number>>;
  };
  readonly tolerantRule: TolerantCounts;
  readonly pageCaps: ReadonlyArray<number>;
  readonly effectiveDpis: ReadonlyArray<number>;
  readonly pagesRead: number;
  readonly observedTextSha256: string;
}

export interface DpiCellGroup {
  readonly corpus: string;
  readonly nativeDpi: number;
  readonly cells: ReadonlyArray<CellSummary>;
  /** `null` si no están todas las repeticiones válidas: no se puede comparar. */
  readonly repetitionsAgree: boolean | null;
  readonly disagreements: ReadonlyArray<string>;
  /** El texto leído es idéntico byte a byte entre las repeticiones (más fuerte que coincidir en lo medido). */
  readonly observedTextIdentical: boolean | null;
}

export interface DpiTotals {
  readonly nativeDpi: number;
  /** Por repetición: la suma sobre los corpus cuya celda de esa repetición es válida. */
  readonly byRepetition: ReadonlyArray<{
    readonly repetition: number;
    readonly corpora: ReadonlyArray<string>;
    readonly emails: CellSummary["emails"];
    readonly readingCounts: Readonly<Record<EmailReading, number>>;
    readonly tolerantRule: TolerantCounts;
    readonly otherTypesMissedByType: Readonly<Record<string, number>>;
  }>;
}

export interface NativeSummary {
  readonly phase: "emails-native";
  readonly smoke: boolean;
  readonly corpora: ReadonlyArray<string>;
  readonly dpis: ReadonlyArray<number>;
  readonly repetitions: number;
  readonly groups: ReadonlyArray<DpiCellGroup>;
  readonly totalsByDpi: ReadonlyArray<DpiTotals>;
  readonly lostEmails: ReadonlyArray<{
    readonly corpus: string;
    readonly nativeDpi: number;
    readonly repetition: number;
    readonly pageIndex: number;
    readonly expected: string;
    readonly reading: EmailReading;
    readonly fragment: string | null;
  }>;
  readonly invalidCells: ReadonlyArray<{
    readonly cellId: string;
    readonly reasons: ReadonlyArray<string>;
  }>;
  readonly missingCells: ReadonlyArray<string>;
  readonly allRepetitionsAgree: boolean | null;
  readonly sleepDetection: UltraSleepDetection;
  readonly validityCaveats: ReadonlyArray<string>;
  readonly excludedInvalidatedRunIds: ReadonlyArray<string>;
  readonly invalidationReasons: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly complete: boolean;
  readonly tableLines: ReadonlyArray<string>;
}

export interface NativeInput {
  readonly corpora?: ReadonlyArray<string>;
  readonly dpis?: ReadonlyArray<number>;
  readonly repetitions?: number;
  readonly smoke?: boolean;
  readonly readCell: (
    corpus: string,
    nativeDpi: number,
    repetition: number,
  ) => NativeCellView | null;
  readonly validity?: UltraValidity;
  readonly sleepDetection?: UltraSleepDetection;
  readonly caveats?: ReadonlyArray<UltraCaveat>;
}

function zeroReadings(): Record<EmailReading, number> {
  return Object.fromEntries(EMAIL_READINGS.map((reading) => [reading, 0])) as Record<
    EmailReading,
    number
  >;
}

function countBy(items: ReadonlyArray<{ readonly type: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.type] = (counts[item.type] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function sumByType(parts: ReadonlyArray<Readonly<Record<string, number>>>): Record<string, number> {
  const total: Record<string, number> = {};
  for (const part of parts)
    for (const [type, count] of Object.entries(part)) total[type] = (total[type] ?? 0) + count;
  return Object.fromEntries(Object.entries(total).sort(([a], [b]) => a.localeCompare(b)));
}

export function summarizeCell(record: NativeCellView): CellSummary {
  return {
    repetition: record.repetition,
    emails: {
      expected: record.emails.expected,
      detected: record.emails.detected,
      missed: record.emails.missed,
      added: record.emails.added,
    },
    readingCounts: record.emails.readingCounts,
    lost: record.emails.lost.map((lost) => ({
      pageIndex: lost.pageIndex,
      expected: lost.expected,
      reading: lost.reading,
      fragment: lost.fragment,
    })),
    addedEmails: record.emails.addedValues.map((added) => added.value),
    otherTypes: {
      missed: record.otherTypes.missed.length,
      added: record.otherTypes.added.length,
      missedByType: countBy(record.otherTypes.missed),
      addedByType: countBy(record.otherTypes.added),
    },
    tolerantRule: record.tolerantRule.counts,
    pageCaps: record.nativeDpiEvidence.pageCaps,
    effectiveDpis: record.nativeDpiEvidence.effectiveDpis,
    pagesRead: record.pagesRead,
    observedTextSha256: record.observedTextSha256,
  };
}

/** Lo que tiene que coincidir entre repeticiones para decir «lo medido es el mismo». */
function agreementSignature(cell: CellSummary): string {
  return JSON.stringify({
    emails: cell.emails,
    lost: [...cell.lost]
      .map((lost) => `${lost.pageIndex}|${lost.expected}|${lost.reading}|${lost.fragment ?? ""}`)
      .sort(),
    added: [...cell.addedEmails].sort(),
    otherMissed: cell.otherTypes.missedByType,
    otherAdded: cell.otherTypes.addedByType,
    tolerant: cell.tolerantRule,
    effectiveDpis: cell.effectiveDpis,
  });
}

function compareRepetitions(cells: ReadonlyArray<CellSummary>): {
  readonly agree: boolean;
  readonly disagreements: ReadonlyArray<string>;
  readonly textIdentical: boolean;
} {
  const signatures = cells.map(agreementSignature);
  const first = cells[0];
  const disagreements: string[] = [];
  if (first !== undefined)
    for (const cell of cells.slice(1))
      if (agreementSignature(cell) !== agreementSignature(first))
        disagreements.push(
          `r${cell.repetition} difiere de r${first.repetition}: perdidos ${cell.emails.missed} contra ${first.emails.missed}, agregados ${cell.emails.added} contra ${first.emails.added}`,
        );
  return {
    agree: signatures.every((signature) => signature === signatures[0]),
    disagreements,
    textIdentical: cells.every((cell) => cell.observedTextSha256 === first?.observedTextSha256),
  };
}

const READING_COLUMNS: ReadonlyArray<readonly [EmailReading, string]> = [
  ["at-as-q", "@>Q"],
  ["dot-as-space", ".>esp"],
  ["at-as-q-and-dot-as-space", "ambas"],
  ["intact-in-text", "intacto"],
  ["other-reading", "otra"],
  ["not-found", "no-hallado"],
];

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function tableOf(
  groups: ReadonlyArray<DpiCellGroup>,
  totals: ReadonlyArray<DpiTotals>,
  lostEmails: NativeSummary["lostEmails"],
  invalidCells: NativeSummary["invalidCells"],
  missingCells: ReadonlyArray<string>,
): string[] {
  const lines: string[] = [];
  const header = `${"corpus".padEnd(6)} ${pad("dpi", 4)} rep ${pad("esper", 5)} ${pad("detec", 5)} ${pad("perd", 4)} ${pad("agreg", 5)} | ${READING_COLUMNS.map(([, label]) => pad(label, 10)).join(" ")} | ${pad("Q-forma", 7)} ${pad("recup", 5)} ${pad("parc", 4)} ${pad("ajeno", 5)} | otros(perd/agr) | dpi efectivos | coincide`;
  lines.push(header, "-".repeat(header.length));
  const row = (label: string, dpi: number, cell: CellSummary, agree: string): string =>
    `${label.padEnd(6)} ${pad(dpi, 4)} ${pad(cell.repetition, 3)} ${pad(cell.emails.expected, 5)} ${pad(cell.emails.detected, 5)} ${pad(cell.emails.missed, 4)} ${pad(cell.emails.added, 5)} | ${READING_COLUMNS.map(([reading]) => pad(cell.readingCounts[reading], 10)).join(" ")} | ${pad(cell.tolerantRule.total, 7)} ${pad(cell.tolerantRule.recoverable, 5)} ${pad(cell.tolerantRule.partialOfTruth, 4)} ${pad(cell.tolerantRule.unrelated, 5)} | ${pad(`${cell.otherTypes.missed}/${cell.otherTypes.added}`, 15)} | ${cell.effectiveDpis.join(",")} | ${agree}`;
  for (const group of groups) {
    const agree = group.repetitionsAgree === null ? "n/d" : group.repetitionsAgree ? "si" : "NO";
    for (const cell of group.cells) lines.push(row(group.corpus, group.nativeDpi, cell, agree));
  }
  lines.push("", "Totales por DPI nativo (suma de los corpus con celda válida):");
  for (const total of totals)
    for (const part of total.byRepetition) {
      const readings = READING_COLUMNS.map(
        ([reading, label]) => `${label}=${part.readingCounts[reading]}`,
      ).join(" ");
      lines.push(
        `  ${pad(total.nativeDpi, 3)} dpi r${part.repetition} [${part.corpora.join(",")}]: emails esperados=${part.emails.expected} detectados=${part.emails.detected} perdidos=${part.emails.missed} agregados=${part.emails.added}; ${readings}; Q-forma total=${part.tolerantRule.total} recuperables=${part.tolerantRule.recoverable} parciales=${part.tolerantRule.partialOfTruth} ajenos=${part.tolerantRule.unrelated}; otros tipos perdidos=${JSON.stringify(part.otherTypesMissedByType)}`,
      );
    }
  if (lostEmails.length > 0) {
    lines.push("", "Emails perdidos y cómo los leyó el OCR:");
    for (const lost of lostEmails)
      lines.push(
        `  ${lost.corpus} ${lost.nativeDpi} dpi r${lost.repetition} p${lost.pageIndex}: ${lost.expected} -> ${lost.reading}${lost.fragment === null ? "" : ` [${lost.fragment}]`}`,
      );
  }
  if (invalidCells.length > 0) {
    lines.push("", "Celdas inválidas (no entran a ningún total):");
    for (const cell of invalidCells) lines.push(`  ${cell.cellId}: ${cell.reasons.join("; ")}`);
  }
  if (missingCells.length > 0) lines.push("", `Celdas ausentes: ${missingCells.join(", ")}`);
  return lines;
}

export function summarizeNative({
  corpora = NATIVE_CORPORA,
  dpis = NATIVE_DPIS,
  repetitions = NATIVE_REPETITIONS,
  smoke = false,
  readCell,
  validity = {},
  sleepDetection,
  caveats = [],
}: NativeInput): NativeSummary {
  const missingCells: string[] = [];
  const invalidCells: { cellId: string; reasons: ReadonlyArray<string> }[] = [];
  const groups: DpiCellGroup[] = [];
  const lostEmails: Array<NativeSummary["lostEmails"][number]> = [];
  for (const corpus of corpora)
    for (const nativeDpi of dpis) {
      const cells: CellSummary[] = [];
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const id = nativeCellId(corpus, nativeDpi, repetition);
        const record = readCell(corpus, nativeDpi, repetition);
        if (record === null) {
          missingCells.push(id);
          continue;
        }
        if (!record.valid) {
          invalidCells.push({ cellId: id, reasons: record.invalidReasons });
          continue;
        }
        const summary = summarizeCell(record);
        cells.push(summary);
        for (const lost of summary.lost)
          lostEmails.push({ corpus, nativeDpi, repetition, ...lost });
      }
      // Con una sola repetición (el humo) no hay nada que comparar: no se dice «coincide».
      const comparison =
        cells.length === repetitions && repetitions >= 2 ? compareRepetitions(cells) : null;
      groups.push({
        corpus,
        nativeDpi,
        cells,
        repetitionsAgree: comparison === null ? null : comparison.agree,
        disagreements: comparison?.disagreements ?? [],
        observedTextIdentical: comparison === null ? null : comparison.textIdentical,
      });
    }
  const totalsByDpi: DpiTotals[] = dpis.map((nativeDpi) => ({
    nativeDpi,
    byRepetition: Array.from({ length: repetitions }, (_, index) => {
      const repetition = index + 1;
      const parts = groups
        .filter((group) => group.nativeDpi === nativeDpi)
        .flatMap((group) =>
          group.cells
            .filter((cell) => cell.repetition === repetition)
            .map((cell) => ({ corpus: group.corpus, cell })),
        );
      const readingCounts = zeroReadings();
      for (const { cell } of parts)
        for (const reading of EMAIL_READINGS) readingCounts[reading] += cell.readingCounts[reading];
      const sum = (pick: (cell: CellSummary) => number): number =>
        parts.reduce((total, { cell }) => total + pick(cell), 0);
      return {
        repetition,
        corpora: parts.map((part) => part.corpus),
        emails: {
          expected: sum((cell) => cell.emails.expected),
          detected: sum((cell) => cell.emails.detected),
          missed: sum((cell) => cell.emails.missed),
          added: sum((cell) => cell.emails.added),
        },
        readingCounts,
        tolerantRule: {
          total: sum((cell) => cell.tolerantRule.total),
          recoverable: sum((cell) => cell.tolerantRule.recoverable),
          partialOfTruth: sum((cell) => cell.tolerantRule.partialOfTruth),
          unrelated: sum((cell) => cell.tolerantRule.unrelated),
        },
        otherTypesMissedByType: sumByType(parts.map(({ cell }) => cell.otherTypes.missedByType)),
      };
    }),
  }));
  const agreements = groups.map((group) => group.repetitionsAgree);
  const allAgree = agreements.some((value) => value === null)
    ? null
    : agreements.every((value) => value === true);
  const detection = sleepDetection ?? NOT_REPORTED;
  return {
    phase: "emails-native",
    smoke,
    corpora,
    dpis,
    repetitions,
    groups,
    totalsByDpi,
    lostEmails,
    invalidCells,
    missingCells,
    allRepetitionsAgree: allAgree,
    sleepDetection: detection,
    validityCaveats: validityCaveatsOf(detection, caveats),
    excludedInvalidatedRunIds: [...(validity.affectedRunIds ?? [])].sort(),
    invalidationReasons: validity.reasonsByRunId ?? {},
    complete:
      corpora.length > 0 &&
      dpis.length > 0 &&
      missingCells.length === 0 &&
      invalidCells.length === 0,
    tableLines: tableOf(groups, totalsByDpi, lostEmails, invalidCells, missingCells),
  };
}

/** Línea final: `complete` conserva su sentido (todas las celdas presentes y válidas). */
export function nativeResultLine(summary: NativeSummary): string {
  const codes = summary.validityCaveats.map((caveat) => caveat.split(":")[0] ?? caveat);
  const total = summary.corpora.length * summary.dpis.length * summary.repetitions;
  const agree =
    summary.allRepetitionsAgree === null ? "n/d" : summary.allRepetitionsAgree ? "si" : "no";
  return `complete=${summary.complete}${summary.smoke ? " (humo)" : ""} celdas=${total - summary.missingCells.length - summary.invalidCells.length}/${total} invalidas=${summary.invalidCells.length} repeticionesCoinciden=${agree} salvedades=${codes.length}${codes.length > 0 ? ` [${codes.join(", ")}]` : ""}`;
}
