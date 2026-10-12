/**
 * M-D1: el resumen de la medición de la regla de direcciones de ADR-212. Pura: recibe los registros de las
 * corridas (`addressHeightRun.ts`) y da, por categoría y en total, cuántos números quedan dentro de la
 * dirección y cuántos a la vista, y qué oraciones dan un resultado distinto del que la regla vigente
 * espera (el número se suma siempre, salvo que su forma lo excluya).
 *
 * Las oraciones donde el modelo no marcó el lugar se cuentan aparte: son un límite del modelo, no de la
 * regla. Esto es una medición: que el resultado no sea el esperado se informa, no es un error.
 */

import { checkExpectation, type SentenceRecord } from "./addressHeightClassify.js";
import type { AddressHeightRunRecord } from "./addressHeightRun.js";
import { ADDRESS_HEIGHT_CATEGORIES, type AddressHeightCategory } from "./addressHeightSentences.js";

/** Categorías cuyo número es una altura: lo que queda a la vista es una fuga. */
const HEIGHT_CATEGORIES: ReadonlyArray<AddressHeightCategory> = ["A", "B", "C", "D", "G"];
/** Categorías de lugar y año: lo que queda dentro es un año tapado de más. */
const YEAR_CATEGORIES: ReadonlyArray<AddressHeightCategory> = ["E", "F"];
/** Categoría de lugar y otro número: lo que queda dentro es un número tapado de más. */
const OTHER_NUMBER_CATEGORIES: ReadonlyArray<AddressHeightCategory> = ["H"];

export interface CategoryRow {
  readonly category: AddressHeightCategory | "total";
  readonly sentences: number;
  readonly placeMarked: number;
  readonly placeNotMarked: number;
  /** Números dentro de la dirección, sobre las oraciones con el lugar marcado. */
  readonly inside: number;
  /** Números a la vista, sobre las oraciones con el lugar marcado. */
  readonly visible: number;
  /** Oraciones con el lugar marcado cuyo número cubrió otro tipo de entidad (y cuál). */
  readonly numberCoveredByOther: number;
}

export interface HeadlineCounts {
  /** Oraciones de la familia con el lugar marcado. */
  readonly marked: number;
  /** De esas, las que tienen el número del lado que cuenta la familia (a la vista o dentro). */
  readonly count: number;
}

export interface UnexpectedItem {
  readonly id: string;
  readonly category: AddressHeightCategory;
  readonly addressValues: ReadonlyArray<string>;
  readonly reason: string;
}

export interface NotMarkedItem {
  readonly id: string;
  readonly category: AddressHeightCategory;
  readonly place: string;
  readonly addressValues: ReadonlyArray<string>;
}

export interface RunTable {
  readonly rows: ReadonlyArray<CategoryRow>;
  readonly total: CategoryRow;
  /** Alturas (A, B, C, D, G) que quedan a la vista. */
  readonly heightsVisible: HeadlineCounts;
  /** Años (E, F) tapados de más. */
  readonly yearsOverCovered: HeadlineCounts;
  /** Otros números (H) tapados de más. */
  readonly otherNumbersOverCovered: HeadlineCounts;
  readonly unexpected: ReadonlyArray<UnexpectedItem>;
  readonly notMarked: ReadonlyArray<NotMarkedItem>;
}

export interface RunSummary {
  readonly repetition: number;
  readonly valid: boolean;
  readonly invalidReasons: ReadonlyArray<string>;
  readonly table: RunTable | null;
}

export interface RepetitionDifference {
  readonly id: string;
  readonly first: unknown;
  readonly second: unknown;
}

export interface AddressHeightSummary {
  readonly complete: boolean;
  readonly expectedRepetitions: number;
  readonly runs: ReadonlyArray<RunSummary>;
  /** `null` si no hay dos corridas válidas que comparar. */
  readonly repetitionsAgree: boolean | null;
  readonly differences: ReadonlyArray<RepetitionDifference>;
}

export function addressHeightRunFileName(repetition: number): string {
  return `address-height-run-r${repetition}.json`;
}

function rowFor(
  category: CategoryRow["category"],
  records: ReadonlyArray<SentenceRecord>,
): CategoryRow {
  const marked = records.filter((r) => r.placeMarked);
  const inside = marked.filter((r) => r.numberInAddress).length;
  return {
    category,
    sentences: records.length,
    placeMarked: marked.length,
    placeNotMarked: records.length - marked.length,
    inside,
    visible: marked.length - inside,
    numberCoveredByOther: marked.filter((r) => r.numberCoveredByOther.length > 0).length,
  };
}

function headline(
  records: ReadonlyArray<SentenceRecord>,
  categories: ReadonlyArray<AddressHeightCategory>,
  side: "visible" | "inside",
): HeadlineCounts {
  const marked = records.filter((r) => r.placeMarked && categories.includes(r.category));
  const inside = marked.filter((r) => r.numberInAddress).length;
  return {
    marked: marked.length,
    count: side === "visible" ? marked.length - inside : inside,
  };
}

export function buildRunTable(records: ReadonlyArray<SentenceRecord>): RunTable {
  const rows = ADDRESS_HEIGHT_CATEGORIES.map((category) =>
    rowFor(
      category,
      records.filter((r) => r.category === category),
    ),
  ).filter((row) => row.sentences > 0);
  const unexpected: UnexpectedItem[] = [];
  const notMarked: NotMarkedItem[] = [];
  for (const record of records) {
    if (!record.placeMarked) {
      notMarked.push({
        id: record.id,
        category: record.category,
        place: record.place,
        addressValues: record.addressValues,
      });
      continue;
    }
    const check = checkExpectation(record);
    if (!check.asExpected && check.reason !== null) {
      unexpected.push({
        id: record.id,
        category: record.category,
        addressValues: record.addressValues,
        reason: check.reason,
      });
    }
  }
  return {
    rows,
    total: rowFor("total", records),
    heightsVisible: headline(records, HEIGHT_CATEGORIES, "visible"),
    yearsOverCovered: headline(records, YEAR_CATEGORIES, "inside"),
    otherNumbersOverCovered: headline(records, OTHER_NUMBER_CATEGORIES, "inside"),
    unexpected,
    notMarked,
  };
}

/** Lo que tiene que coincidir entre dos repeticiones, oración por oración. */
function repetitionKey(record: SentenceRecord): unknown {
  return {
    pageText: record.pageText,
    placeMarked: record.placeMarked,
    addressValues: record.addressValues,
    numberInAddress: record.numberInAddress,
    numberCoveredByOther: record.numberCoveredByOther,
    adjacent: record.adjacent,
    occurrences: record.occurrences.map((o) => [o.entityType, o.value, o.source]),
  };
}

export function compareRepetitions(
  first: AddressHeightRunRecord,
  second: AddressHeightRunRecord,
): ReadonlyArray<RepetitionDifference> {
  const differences: RepetitionDifference[] = [];
  const secondById = new Map(second.sentences.map((r) => [r.id, r]));
  for (const record of first.sentences) {
    const other = secondById.get(record.id);
    const a = repetitionKey(record);
    const b = other === undefined ? null : repetitionKey(other);
    if (JSON.stringify(a) !== JSON.stringify(b))
      differences.push({ id: record.id, first: a, second: b });
  }
  for (const record of second.sentences) {
    if (!first.sentences.some((r) => r.id === record.id))
      differences.push({ id: record.id, first: null, second: repetitionKey(record) });
  }
  return differences;
}

export function summarizeAddressHeight(input: {
  readonly expectedRepetitions: number;
  /** Los registros leídos, por repetición; `undefined` si falta el archivo. */
  readonly records: ReadonlyArray<AddressHeightRunRecord | undefined>;
}): AddressHeightSummary {
  const runs: RunSummary[] = input.records.map((record, index): RunSummary => {
    if (record === undefined) {
      return {
        repetition: index + 1,
        valid: false,
        invalidReasons: ["falta el registro de la corrida"],
        table: null,
      };
    }
    return {
      repetition: record.repetition,
      valid: record.valid,
      invalidReasons: record.invalidReasons,
      table: record.valid ? buildRunTable(record.sentences) : null,
    };
  });
  const valid = input.records.filter(
    (record): record is AddressHeightRunRecord => record !== undefined && record.valid,
  );
  const first = valid[0];
  const second = valid[1];
  const differences =
    first !== undefined && second !== undefined ? compareRepetitions(first, second) : [];
  return {
    complete: runs.length === input.expectedRepetitions && runs.every((run) => run.valid),
    expectedRepetitions: input.expectedRepetitions,
    runs,
    repetitionsAgree: first !== undefined && second !== undefined ? differences.length === 0 : null,
    differences,
  };
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function formatTable(table: RunTable): string[] {
  const lines = [
    "Cat  Oraciones  LugarMarcado  NoMarcado | Número: dentro  a la vista | Cubierto por otro tipo",
  ];
  for (const row of [...table.rows, table.total]) {
    lines.push(
      `${row.category.padEnd(5)}${pad(row.sentences, 9)}${pad(row.placeMarked, 14)}${pad(row.placeNotMarked, 11)} |` +
        `${pad(row.inside, 15)}${pad(row.visible, 12)} |${pad(row.numberCoveredByOther, 22)}`,
    );
  }
  return lines;
}

/** La tabla legible. */
export function formatSummaryTable(summary: AddressHeightSummary): string {
  const lines: string[] = [];
  for (const run of summary.runs) {
    lines.push(
      `Corrida ${run.repetition}: ${run.valid ? "válida" : `INVÁLIDA (${run.invalidReasons.join("; ")})`}`,
    );
    if (run.table === null) continue;
    lines.push(...formatTable(run.table));
    const t = run.table;
    lines.push(
      `Alturas a la vista (A, B, C, D, G; sobre ${t.heightsVisible.marked} con el lugar marcado): ${t.heightsVisible.count}`,
      `Años tapados de más (E, F; sobre ${t.yearsOverCovered.marked}): ${t.yearsOverCovered.count}`,
      `Otros números tapados de más (H; sobre ${t.otherNumbersOverCovered.marked}): ${t.otherNumbersOverCovered.count}`,
    );
    lines.push(
      `Lugar no marcado por el modelo (límite del modelo): ${t.notMarked.map((n) => n.id).join(", ") || "ninguna"}`,
    );
    if (t.unexpected.length === 0)
      lines.push("Oraciones con resultado distinto del esperado por ADR-212: ninguna");
    else {
      lines.push("Oraciones con resultado distinto del esperado por ADR-212:");
      for (const item of t.unexpected)
        lines.push(`  ${item.id}: Address=[${item.addressValues.join(" | ")}]; ${item.reason}`);
    }
    lines.push("");
  }
  lines.push(
    summary.repetitionsAgree === null
      ? "Repeticiones: no hay dos corridas válidas que comparar."
      : summary.repetitionsAgree
        ? "Repeticiones: coinciden oración por oración."
        : `Repeticiones: DIFIEREN en ${summary.differences.map((d) => d.id).join(", ")}.`,
  );
  return `${lines.join("\n")}\n`;
}

/** La última línea que imprime el agregador, para el log de la campaña. */
export function resultLine(summary: AddressHeightSummary): string {
  const first = summary.runs.find((run) => run.table !== null)?.table;
  const agree =
    summary.repetitionsAgree === null
      ? "sin comparar"
      : summary.repetitionsAgree
        ? "coinciden"
        : "difieren";
  const heights =
    first === undefined || first === null
      ? "sin datos"
      : `alturas a la vista ${first.heightsVisible.count}, años tapados de más ${first.yearsOverCovered.count}`;
  return `M-D1: ${summary.complete ? "completa" : "INCOMPLETA"}; repeticiones ${agree}; ${heights}.`;
}
