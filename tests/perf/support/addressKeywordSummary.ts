/**
 * M-D2: el resumen de la medición de las direcciones con palabra clave. Pura: recibe los registros de las
 * corridas (`addressKeywordRun.ts`) y da, por categoría y por escritura, cuántas páginas hay y cuántas
 * quedaron con el nombre y la altura (el «núcleo») cubiertos enteros, en parte o nada, por una ocurrencia
 * de tipo dirección y por cualquier tipo; lo mismo para el nombre solo y para cada parte; qué se tapó en
 * las trampas de K8; y si las dos repeticiones coinciden página por página.
 *
 * El núcleo de una página es su nombre y, si la tiene, su altura: queda cubierto entero si lo están todas
 * las partes que lo forman, en nada si ninguna lo está, y en parte en cualquier otro caso. Las páginas
 * inválidas (texto extraído distinto del escrito) se cuentan aparte y no entran a ningún total.
 *
 * Esto es una medición: que el resultado no guste no es un error del instrumento.
 */

import {
  combineCoverage,
  coreParts,
  partOf,
  type Coverage,
  type KeywordPageRecord,
  type TouchingOccurrence,
} from "./addressKeywordClassify.js";
import {
  evaluateAdr217,
  hasSurvivalInfo,
  survivorsOnly,
  type BaselineComparison,
  type KeywordExpectationReport,
} from "./addressKeywordExpectation.js";
import type { AddressKeywordRunRecord } from "./addressKeywordRun.js";
import {
  KEYWORD_CATEGORIES,
  KEYWORD_PART_NAMES,
  KEYWORD_SCRIPTS,
  type KeywordCategory,
  type KeywordPartName,
  type KeywordScript,
} from "./addressKeywordSentences.js";

export interface CoverageCounts {
  readonly full: number;
  readonly partial: number;
  readonly none: number;
}

export interface PairCounts {
  /** Cubierto por ocurrencias de tipo dirección. */
  readonly address: CoverageCounts;
  /** Cubierto por la unión de ocurrencias de cualquier tipo. */
  readonly any: CoverageCounts;
}

export interface PartCounts extends PairCounts {
  /** Páginas que tienen esta parte. */
  readonly pages: number;
  /** De esas, las que tienen la parte tocada por una ocurrencia de otro tipo. */
  readonly withOtherType: number;
}

export interface GroupRow {
  readonly category: KeywordCategory | "K1-K7";
  readonly script: KeywordScript | "all";
  /** Páginas válidas del grupo. */
  readonly pages: number;
  /** Páginas inválidas del grupo (no entran a los demás conteos). */
  readonly invalidPages: number;
  /** Nombre y altura (si la hay). Sin datos en K8, que no tiene partes. */
  readonly core: PairCounts;
  readonly parts: Readonly<Record<KeywordPartName, PartCounts>>;
  /** Páginas con alguna parte tocada por una ocurrencia de otro tipo. */
  readonly pagesWithOtherType: number;
  /** Páginas donde alguna ocurrencia (de cualquier tipo) toca la oración. */
  readonly pagesTouched: number;
}

export interface TrapItem {
  readonly id: string;
  readonly valid: boolean;
  readonly covered: ReadonlyArray<{
    readonly entityType: string;
    readonly value: string;
    readonly source: string;
  }>;
}

export interface InvalidPageItem {
  readonly id: string;
  readonly reason: string;
}

export interface RunTable {
  /** Una fila por categoría y escritura (K1 a K8 por n, M y S). */
  readonly rows: ReadonlyArray<GroupRow>;
  /** Una fila por escritura sobre K1 a K7, y una sobre todo. */
  readonly totals: ReadonlyArray<GroupRow>;
  readonly traps: ReadonlyArray<TrapItem>;
  readonly invalidPages: ReadonlyArray<InvalidPageItem>;
  /** Ocurrencias que no se pudieron ubicar en el texto, sumadas en todas las páginas. */
  readonly unlocatedOccurrences: number;
  /** Ocurrencias ubicadas por un valor que se repite en la oración (la posición puede no ser la suya). */
  readonly ambiguousOccurrences: number;
}

export interface RunSummary {
  readonly repetition: number;
  readonly valid: boolean;
  readonly invalidReasons: ReadonlyArray<string>;
  readonly table: RunTable | null;
  /** La comparación contra el criterio de ADR-217 (M-D3). `null` si la corrida no es válida. */
  readonly expectation: KeywordExpectationReport | null;
  /**
   * Lo mismo sobre lo que sobrevive al agrupado, o sea lo que se pinta (M-D3). `null` si la corrida no es válida
   * o no observó el agrupado (los registros anteriores).
   */
  readonly expectationFinal: KeywordExpectationReport | null;
}

export interface RepetitionDifference {
  readonly id: string;
  readonly first: unknown;
  readonly second: unknown;
}

export interface AddressKeywordSummary {
  readonly complete: boolean;
  readonly expectedRepetitions: number;
  readonly runs: ReadonlyArray<RunSummary>;
  /** `null` si no hay dos corridas válidas que comparar. */
  readonly repetitionsAgree: boolean | null;
  readonly differences: ReadonlyArray<RepetitionDifference>;
}

export function addressKeywordRunFileName(repetition: number): string {
  return `address-keyword-run-r${repetition}.json`;
}

function counts(values: ReadonlyArray<Coverage>): CoverageCounts {
  return {
    full: values.filter((value) => value === "full").length,
    partial: values.filter((value) => value === "partial").length,
    none: values.filter((value) => value === "none").length,
  };
}

function partCounts(records: ReadonlyArray<KeywordPageRecord>, name: KeywordPartName): PartCounts {
  const parts = records.flatMap((record) => partOf(record, name) ?? []);
  return {
    pages: parts.length,
    address: counts(parts.map((part) => part.address)),
    any: counts(parts.map((part) => part.any)),
    withOtherType: parts.filter((part) => part.otherTypes.length > 0).length,
  };
}

function rowFor(
  category: GroupRow["category"],
  script: GroupRow["script"],
  all: ReadonlyArray<KeywordPageRecord>,
): GroupRow {
  const records = all.filter((record) => record.valid);
  const withCore = records.filter((record) => coreParts(record).length > 0);
  return {
    category,
    script,
    pages: records.length,
    invalidPages: all.length - records.length,
    core: {
      address: counts(
        withCore.map((record) => combineCoverage(coreParts(record).map((part) => part.address))),
      ),
      any: counts(
        withCore.map((record) => combineCoverage(coreParts(record).map((part) => part.any))),
      ),
    },
    parts: {
      via: partCounts(records, "via"),
      nombre: partCounts(records, "nombre"),
      altura: partCounts(records, "altura"),
      resto: partCounts(records, "resto"),
    },
    pagesWithOtherType: records.filter((record) =>
      record.parts.some((part) => part.otherTypes.length > 0),
    ).length,
    pagesTouched: records.filter((record) => record.addresses.length + record.others.length > 0)
      .length,
  };
}

function covered(record: KeywordPageRecord): TrapItem["covered"] {
  const all: ReadonlyArray<TouchingOccurrence> = [...record.addresses, ...record.others];
  return [...all]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((o) => ({ entityType: o.entityType, value: o.value, source: o.source }));
}

export function buildRunTable(records: ReadonlyArray<KeywordPageRecord>): RunTable {
  const rows = KEYWORD_CATEGORIES.flatMap((category) =>
    KEYWORD_SCRIPTS.map((script) =>
      rowFor(
        category,
        script,
        records.filter((record) => record.category === category && record.script === script),
      ),
    ),
  ).filter((row) => row.pages + row.invalidPages > 0);
  const keyword = records.filter((record) => record.category !== "K8");
  const totals = KEYWORD_SCRIPTS.map((script) =>
    rowFor(
      "K1-K7",
      script,
      keyword.filter((record) => record.script === script),
    ),
  );
  totals.push(rowFor("K1-K7", "all", keyword));
  return {
    rows,
    totals,
    traps: records
      .filter((record) => record.category === "K8")
      .map((record) => ({ id: record.id, valid: record.valid, covered: covered(record) })),
    invalidPages: records
      .filter((record) => !record.valid)
      .map((record) => ({ id: record.id, reason: record.invalidReason ?? "sin motivo" })),
    unlocatedOccurrences: records.reduce((sum, record) => sum + record.unlocatedOccurrences, 0),
    ambiguousOccurrences: records.reduce(
      (sum, record) =>
        sum + [...record.addresses, ...record.others].filter((o) => o.ambiguous).length,
      0,
    ),
  };
}

/** Lo que tiene que coincidir entre dos repeticiones, página por página. */
function repetitionKey(record: KeywordPageRecord): unknown {
  return {
    valid: record.valid,
    pageText: record.pageText,
    parts: record.parts.map((part) => [
      part.part,
      part.address,
      part.other,
      part.otherTypes,
      part.any,
    ]),
    addresses: record.addresses.map((o) => [o.value, o.source]),
    others: record.others.map((o) => [o.entityType, o.value, o.source]),
  };
}

export function compareRepetitions(
  first: AddressKeywordRunRecord,
  second: AddressKeywordRunRecord,
): ReadonlyArray<RepetitionDifference> {
  const differences: RepetitionDifference[] = [];
  const secondById = new Map(second.pages.map((r) => [r.id, r]));
  for (const record of first.pages) {
    const other = secondById.get(record.id);
    const a = repetitionKey(record);
    const b = other === undefined ? null : repetitionKey(other);
    if (JSON.stringify(a) !== JSON.stringify(b))
      differences.push({ id: record.id, first: a, second: b });
  }
  for (const record of second.pages) {
    if (!first.pages.some((r) => r.id === record.id))
      differences.push({ id: record.id, first: null, second: repetitionKey(record) });
  }
  return differences;
}

export function summarizeAddressKeyword(input: {
  readonly expectedRepetitions: number;
  /** Los registros leídos, por repetición; `undefined` si falta el archivo. */
  readonly records: ReadonlyArray<AddressKeywordRunRecord | undefined>;
}): AddressKeywordSummary {
  const runs: RunSummary[] = input.records.map((record, index): RunSummary => {
    if (record === undefined) {
      return {
        repetition: index + 1,
        valid: false,
        invalidReasons: ["falta el registro de la corrida"],
        table: null,
        expectation: null,
        expectationFinal: null,
      };
    }
    return {
      repetition: record.repetition,
      valid: record.valid,
      invalidReasons: record.invalidReasons,
      table: record.valid ? buildRunTable(record.pages) : null,
      expectation: record.valid ? evaluateAdr217(record.pages) : null,
      expectationFinal:
        record.valid && hasSurvivalInfo(record.pages)
          ? evaluateAdr217(survivorsOnly(record.pages))
          : null,
    };
  });
  const valid = input.records.filter(
    (record): record is AddressKeywordRunRecord => record !== undefined && record.valid,
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

const COVERAGE_CODE: Readonly<Record<Coverage, string>> = { full: "E", partial: "P", none: "N" };

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function triple(value: CoverageCounts): string {
  return `${pad(value.full, 3)}${pad(value.partial, 3)}${pad(value.none, 3)}`;
}

function formatRows(rows: ReadonlyArray<GroupRow>): string[] {
  const lines = [
    "Cat    Esc  Págs Inv | Núcleo dir E  P  N | Núcleo cualq E  P  N | Nombre dir E  P  N | Nombre cualq E  P  N | Con otro tipo",
  ];
  for (const row of rows) {
    lines.push(
      `${row.category.padEnd(7)}${row.script.padEnd(5)}${pad(row.pages, 4)}${pad(row.invalidPages, 4)} |` +
        `${pad("", 13)}${triple(row.core.address)} |${pad("", 14)}${triple(row.core.any)} |` +
        `${pad("", 13)}${triple(row.parts.nombre.address)} |${pad("", 14)}${triple(row.parts.nombre.any)} |` +
        `${pad(row.pagesWithOtherType, 14)}`,
    );
  }
  return lines;
}

function formatPartTable(totals: ReadonlyArray<GroupRow>): string[] {
  const lines = [
    "Por parte, sobre K1 a K7 (E entera, P en parte, N nada)",
    "Esc   Parte   Págs | Dirección E  P  N | Cualquier tipo E  P  N | Tocadas por otro tipo",
  ];
  for (const row of totals) {
    for (const name of KEYWORD_PART_NAMES) {
      const part = row.parts[name];
      lines.push(
        `${row.script.padEnd(6)}${name.padEnd(8)}${pad(part.pages, 3)} |${pad("", 12)}${triple(part.address)} |` +
          `${pad("", 15)}${triple(part.any)} |${pad(part.withOtherType, 22)}`,
      );
    }
  }
  return lines;
}

function formatTraps(traps: ReadonlyArray<TrapItem>): string[] {
  const lines = ["K8, trampas: qué se tapó en la oración"];
  for (const trap of traps) {
    const covered =
      trap.covered.length === 0
        ? "nada"
        : trap.covered.map((o) => `"${o.value}" ${o.entityType} (${o.source})`).join("; ");
    lines.push(`  ${trap.id}${trap.valid ? "" : " [INVÁLIDA]"}: ${covered}`);
  }
  return lines;
}

function sourceOf(occurrence: TouchingOccurrence): string {
  return occurrence.ambiguous ? `${occurrence.source}; ubicación ambigua` : occurrence.source;
}

/** Una línea por página: direcciones detectadas, otras ocurrencias y el estado de cada parte. */
export function formatPageLine(record: KeywordPageRecord): string {
  if (!record.valid) return `${record.id} | INVÁLIDA: ${record.invalidReason ?? "sin motivo"}`;
  const addresses =
    record.addresses.length === 0
      ? "—"
      : record.addresses.map((o) => `"${o.value}" (${sourceOf(o)})`).join("; ");
  const others =
    record.others.length === 0
      ? "—"
      : record.others.map((o) => `"${o.value}" ${o.entityType} (${sourceOf(o)})`).join("; ");
  const parts =
    record.parts.length === 0
      ? "sin partes"
      : record.parts
          .map((part) => {
            const other =
              part.otherTypes.length === 0
                ? ""
                : `[otro ${part.otherTypes.join(",")} ${COVERAGE_CODE[part.other]}; cualq ${COVERAGE_CODE[part.any]}]`;
            return `${part.part}=${COVERAGE_CODE[part.address]}${other}`;
          })
          .join(" ");
  return `${record.id} | dirección: ${addresses} | otras: ${others} | ${parts}`;
}

/** La tabla página por página de una corrida. */
export function formatPagesTable(records: ReadonlyArray<KeywordPageRecord>): string {
  return `${records.map(formatPageLine).join("\n")}\n`;
}

function countLine(
  label: string,
  count: {
    readonly expected: number;
    readonly observed: number;
    readonly of: number;
    readonly matches: boolean;
  },
): string {
  return `  ${label}: ${count.observed} de ${count.of} (se esperan ${count.expected}) -> ${count.matches ? "coincide" : "NO COINCIDE"}`;
}

/** El bloque «contra ADR-217» de una corrida. */
export function formatExpectation(
  report: KeywordExpectationReport,
  options: {
    readonly title?: string;
    readonly listOverlaps?: boolean;
    readonly overlapLabel?: string | undefined;
  } = {},
): string[] {
  const lines = [
    options.title ?? "Contra el criterio de ADR-217 (comparación, no gate)",
    countLine("Páginas con algo a la vista (K1 a K7)", report.visible),
    `    cuáles: ${report.visible.pages.join(", ") || "ninguna"}`,
    `    contando solo ocurrencias de tipo dirección: ${report.visibleAddressOnly.observed}`,
    countLine("Trampas tapadas en escritura normal", report.trapsNormal),
    `    cuáles: ${report.trapsNormal.pages.join(", ") || "ninguna"}`,
    countLine("Trampas tapadas en mayúsculas (M y S)", report.trapsUpper),
    `    cuáles: ${report.trapsUpper.pages.join(", ") || "ninguna"}`,
    "Páginas que no coinciden con lo esperado:",
  ];
  if (report.mismatches.length === 0) lines.push("  ninguna");
  for (const item of report.mismatches) lines.push(`  ${item.id}: ${item.kind}; ${item.detail}`);
  const counts = report.closedByCounts;
  lines.push(
    `Quién cerró el núcleo de las ${report.closed.length} páginas cerradas de K1 a K7: solo el patrón (regex) ${counts.regex}, solo el modelo ${counts.modelo}, los dos por separado ${counts.ambos}, hizo falta la unión ${counts.union}`,
  );
  lines.push(
    `${options.overlapLabel ?? "Páginas con dos direcciones pintadas que se superponen"}: ${report.doublePainted.length}`,
  );
  for (const page of options.listOverlaps === false ? [] : report.doublePainted)
    lines.push(
      `  ${page.id}: ${page.pairs
        .map(
          (pair) =>
            `"${pair.first.value}" (${pair.first.source}) y "${pair.second.value}" (${pair.second.source}), ${pair.relation}`,
        )
        .join("; ")}`,
    );
  lines.push(
    `Criterio: ${report.meetsCriterion ? "SE CUMPLE" : "NO SE CUMPLE"}${report.invalidPages.length > 0 ? `; páginas inválidas: ${report.invalidPages.join(", ")}` : ""}`,
  );
  return lines;
}

/** El bloque de comparación página por página contra otra corrida. */
export function formatBaselineComparison(comparison: BaselineComparison): string[] {
  const list = (
    items: ReadonlyArray<{ readonly id: string; readonly before: string; readonly after: string }>,
  ) =>
    items.length === 0 ? ["  ninguna"] : items.map((i) => `  ${i.id}: ${i.before} -> ${i.after}`);
  return [
    "Contra la línea de base",
    `  Páginas iguales: ${comparison.same} de ${comparison.pages}; no comparables: ${comparison.notComparable.join(", ") || "ninguna"}`,
    "  Núcleo menos cubierto que en la línea de base (K1 a K7):",
    ...list(comparison.worse),
    `  Núcleo más cubierto que en la línea de base (K1 a K7): ${comparison.improved.length}`,
    "  Trampas que antes no se tapaban y ahora sí:",
    ...list(comparison.trapsNewlyCovered),
    "  Trampas que se tapaban y ya no:",
    ...list(comparison.trapsNoLongerCovered),
  ];
}

/** La tabla legible. */
export function formatSummaryTable(summary: AddressKeywordSummary): string {
  const lines: string[] = [];
  for (const run of summary.runs) {
    lines.push(
      `Corrida ${run.repetition}: ${run.valid ? "válida" : `INVÁLIDA (${run.invalidReasons.join("; ")})`}`,
    );
    const table = run.table;
    if (table === null) continue;
    lines.push(
      "E entera, P en parte, N nada. Núcleo: nombre y, si la hay, altura. Dir: ocurrencias de tipo dirección. Cualq: la unión de todas.",
    );
    lines.push(...formatRows([...table.rows, ...table.totals]));
    lines.push("", ...formatPartTable(table.totals), "", ...formatTraps(table.traps));
    lines.push(
      "",
      `Páginas inválidas (texto extraído distinto del escrito): ${table.invalidPages.map((p) => p.id).join(", ") || "ninguna"}`,
      `Ocurrencias sin ubicar en el texto: ${table.unlocatedOccurrences}`,
      `Ocurrencias ubicadas por un valor que se repite en la oración: ${table.ambiguousOccurrences}`,
      "",
    );
    if (run.expectation !== null)
      lines.push(
        ...formatExpectation(run.expectation, {
          title: `Contra el criterio de ADR-217 (comparación, no gate)${run.expectationFinal === null ? "" : "; sobre los eventos de detección"}`,
          listOverlaps: run.expectationFinal === null,
          overlapLabel:
            run.expectationFinal === null
              ? undefined
              : "Páginas con dos direcciones que se superponen en los eventos de detección (antes del agrupado)",
        }),
        "",
      );
    if (run.expectationFinal !== null)
      lines.push(
        ...formatExpectation(run.expectationFinal, {
          title:
            "Contra el criterio de ADR-217, sobre lo que sobrevive al agrupado (lo que se pinta)",
        }),
        "",
      );
  }
  lines.push(
    summary.repetitionsAgree === null
      ? "Repeticiones: no hay dos corridas válidas que comparar."
      : summary.repetitionsAgree
        ? "Repeticiones: coinciden página por página."
        : `Repeticiones: DIFIEREN en ${summary.differences.map((d) => d.id).join(", ")}.`,
  );
  return `${lines.join("\n")}\n`;
}

/** La última línea que imprime el agregador, para el log de la campaña. */
export function resultLine(summary: AddressKeywordSummary): string {
  const first = summary.runs.find((run) => run.table !== null)?.table;
  const agree =
    summary.repetitionsAgree === null
      ? "sin comparar"
      : summary.repetitionsAgree
        ? "coinciden"
        : "difieren";
  const all = first?.totals.find((row) => row.script === "all");
  const headline =
    first === undefined || first === null || all === undefined
      ? "sin datos"
      : `núcleo cubierto entero como dirección en ${all.core.address.full} de ${all.pages} páginas de K1 a K7, páginas inválidas ${first.invalidPages.length}`;
  const expectation = summary.runs.find((run) => run.expectation !== null)?.expectation ?? null;
  const rule =
    expectation === null
      ? ""
      : `; ADR-217 ${expectation.meetsCriterion ? "se cumple" : "NO se cumple"}: a la vista ${expectation.visible.observed} (se esperan ${expectation.visible.expected}), trampas tapadas ${expectation.trapsNormal.observed} en normal (${expectation.trapsNormal.expected}) y ${expectation.trapsUpper.observed} en mayúsculas (${expectation.trapsUpper.expected}), páginas que no coinciden ${expectation.mismatches.length}`;
  return `M-D2: ${summary.complete ? "completa" : "INCOMPLETA"}; repeticiones ${agree}; ${headline}${rule}.`;
}
