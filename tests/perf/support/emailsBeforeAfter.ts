/**
 * Comparación antes/después de ADR-211 (el email tolera la `@` leída como `Q` en texto de OCR), celda por
 * celda, entre una corrida de línea de base y la misma campaña con el cambio (M-E3,
 * `Confianza_1.0.x_Plan.md`). Sirve a las tres campañas: DPI descendente (fase 1), emails nativos limpios
 * (M-E1) y emails nativos degradados (M-E2). Puro: los adaptadores leen el JSON de una celda y todo lo
 * demás trabaja sobre vistas ya normalizadas. Solo sintéticos: lleva valores inventados.
 *
 * Lo que se pregunta de cada celda, sin acomodar nada a una expectativa:
 * - ¿el texto que leyó el OCR es idéntico? Si no, la comparación de la celda no es limpia.
 * - emails esperados, detectados, perdidos y agregados, antes y después;
 * - cuáles se recuperaron (con el `value` leído y el valor normalizado) y cuáles siguen perdidos;
 * - emails agregados que no están en la verdad después del cambio;
 * - cualquier otra entidad que cambie contra la verdad, de cualquier tipo.
 */

import { canonicalValue, type ObservedEntity } from "./ocrDpiDownScoring.js";
import { classifyLostEmail, type EmailReading } from "./ocrEmailsNativeReading.js";

export interface TruthItem {
  readonly type: string;
  readonly pageIndex: number;
  readonly value: string;
}

export interface LostEmail {
  readonly pageIndex: number;
  readonly expected: string;
  readonly reading: EmailReading;
  readonly fragment: string | null;
}

export interface CellView {
  readonly id: string;
  readonly valid: boolean;
  readonly invalidReasons: ReadonlyArray<string>;
  readonly effectiveDpis: ReadonlyArray<number>;
  readonly emails: {
    readonly expected: number;
    readonly detected: number;
    readonly missed: number;
    readonly added: number;
  };
  readonly lostEmails: ReadonlyArray<LostEmail>;
  readonly addedEmails: ReadonlyArray<{ readonly pageIndex: number; readonly value: string }>;
  /** Lo perdido y lo agregado contra la verdad en los tipos que no son email. */
  readonly otherMissed: ReadonlyArray<TruthItem>;
  readonly otherAdded: ReadonlyArray<TruthItem>;
  /** Todo lo detectado; `null` en las corridas que no lo guardaron. */
  readonly detected: ReadonlyArray<ObservedEntity> | null;
  readonly observedText: string;
}

interface RawCounts {
  readonly expected?: number;
  readonly detected?: number;
  readonly missed?: number;
  readonly added?: number;
}

interface RawEntityCounts {
  readonly byType?: Readonly<Record<string, RawCounts>>;
}

const emailCounts = (counts: RawEntityCounts | null | undefined): CellView["emails"] => ({
  expected: counts?.byType?.EMAIL?.expected ?? 0,
  detected: counts?.byType?.EMAIL?.detected ?? 0,
  missed: counts?.byType?.EMAIL?.missed ?? 0,
  added: counts?.byType?.EMAIL?.added ?? 0,
});

/** Celda de la fase 1 de DPI descendente (`ocr-dpi-down-cell-<corpus>-d<dpi>-rep<n>.json`). */
export interface RawDpiDownCell {
  readonly corpus: string;
  readonly dpi: number;
  readonly repetition: number;
  readonly valid: boolean;
  readonly invalidReasons?: ReadonlyArray<string>;
  readonly dispatch?: { readonly effectiveDpis?: ReadonlyArray<number> } | null;
  readonly entitiesVsTruth?: RawEntityCounts | null;
  readonly syntheticDetail?: {
    readonly missedVsTruth?: ReadonlyArray<TruthItem>;
    readonly addedVsTruth?: ReadonlyArray<TruthItem>;
    readonly detected?: ReadonlyArray<ObservedEntity>;
    readonly observedText?: string;
  } | null;
}

export function dpiDownCellId(corpus: string, dpi: number, repetition: number): string {
  return `${corpus}-d${dpi}-rep${repetition}`;
}

export function viewOfDpiDownCell(raw: RawDpiDownCell): CellView {
  const detail = raw.syntheticDetail;
  const text = detail?.observedText ?? "";
  const missed = detail?.missedVsTruth ?? [];
  return {
    id: dpiDownCellId(raw.corpus, raw.dpi, raw.repetition),
    valid: raw.valid,
    invalidReasons: raw.invalidReasons ?? [],
    effectiveDpis: raw.dispatch?.effectiveDpis ?? [],
    emails: emailCounts(raw.entitiesVsTruth),
    // La celda de DPI descendente guarda el texto entero, no por página: se clasifica sobre todo el texto.
    lostEmails: missed
      .filter((item) => item.type === "EMAIL")
      .map((item) => {
        const reading = classifyLostEmail(item.value, text);
        return {
          pageIndex: item.pageIndex,
          expected: item.value,
          reading: reading.reading,
          fragment: reading.fragment,
        };
      }),
    addedEmails: (detail?.addedVsTruth ?? [])
      .filter((item) => item.type === "EMAIL")
      .map((item) => ({ pageIndex: item.pageIndex, value: item.value })),
    otherMissed: missed.filter((item) => item.type !== "EMAIL"),
    otherAdded: (detail?.addedVsTruth ?? []).filter((item) => item.type !== "EMAIL"),
    detected: detail?.detected ?? null,
    observedText: text,
  };
}

/** Celda de emails nativos (`ocr-emails-native-cell-<corpus>-n<dpi>-r<n>.json`, M-E1 y M-E2). */
export interface RawNativeCell {
  readonly corpus: string;
  readonly nativeDpi: number;
  readonly repetition: number;
  readonly valid: boolean;
  readonly invalidReasons?: ReadonlyArray<string>;
  readonly nativeDpiEvidence?: { readonly effectiveDpis?: ReadonlyArray<number> };
  readonly emails?: CellView["emails"] & {
    readonly lost?: ReadonlyArray<LostEmail>;
    readonly addedValues?: ReadonlyArray<{ readonly pageIndex: number; readonly value: string }>;
  };
  readonly otherTypes?: {
    readonly missed?: ReadonlyArray<TruthItem>;
    readonly added?: ReadonlyArray<TruthItem>;
  };
  readonly detected?: ReadonlyArray<ObservedEntity>;
  readonly observedText?: string;
}

export function nativeCellIdOf(corpus: string, nativeDpi: number, repetition: number): string {
  return `${corpus}-n${nativeDpi}-r${repetition}`;
}

export function viewOfNativeCell(raw: RawNativeCell): CellView {
  return {
    id: nativeCellIdOf(raw.corpus, raw.nativeDpi, raw.repetition),
    valid: raw.valid,
    invalidReasons: raw.invalidReasons ?? [],
    effectiveDpis: raw.nativeDpiEvidence?.effectiveDpis ?? [],
    emails: {
      expected: raw.emails?.expected ?? 0,
      detected: raw.emails?.detected ?? 0,
      missed: raw.emails?.missed ?? 0,
      added: raw.emails?.added ?? 0,
    },
    lostEmails: raw.emails?.lost ?? [],
    addedEmails: raw.emails?.addedValues ?? [],
    otherMissed: raw.otherTypes?.missed ?? [],
    otherAdded: raw.otherTypes?.added ?? [],
    detected: raw.detected ?? null,
    observedText: raw.observedText ?? "",
  };
}

export interface RecoveredEmail {
  readonly pageIndex: number;
  readonly expected: string;
  /** Cómo lo leyó el OCR en la línea de base. */
  readonly beforeReading: EmailReading;
  readonly beforeFragment: string | null;
  /** `value` de la ocurrencia detectada después del cambio (como se leyó) y su valor normalizado. */
  readonly detectedValue: string | null;
  readonly detectedNormalizedValue: string | null;
  /** El valor normalizado es, letra por letra, el email de la verdad. `null` si no se pudo mirar. */
  readonly normalizedMatchesTruth: boolean | null;
}

export interface CellComparison {
  readonly id: string;
  readonly beforeValid: boolean;
  readonly afterValid: boolean;
  readonly invalidReasons: ReadonlyArray<string>;
  readonly effectiveDpisBefore: ReadonlyArray<number>;
  readonly effectiveDpisAfter: ReadonlyArray<number>;
  /** El texto que leyó el OCR es idéntico: si no, la comparación de la celda no es limpia. */
  readonly textIdentical: boolean;
  readonly emailsBefore: CellView["emails"];
  readonly emailsAfter: CellView["emails"];
  readonly recovered: ReadonlyArray<RecoveredEmail>;
  readonly stillLost: ReadonlyArray<LostEmail>;
  /** Perdidos después y no antes. */
  readonly newlyLost: ReadonlyArray<LostEmail>;
  /** Emails agregados después que no están en la verdad: el dato más importante de la comparación. */
  readonly addedAfter: ReadonlyArray<{ readonly pageIndex: number; readonly value: string }>;
  readonly addedBefore: ReadonlyArray<{ readonly pageIndex: number; readonly value: string }>;
  /** Agregados después que no estaban antes: lo que el cambio introdujo. */
  readonly newlyAdded: ReadonlyArray<{ readonly pageIndex: number; readonly value: string }>;
  readonly otherChanges: {
    readonly newlyMissed: ReadonlyArray<TruthItem>;
    readonly noLongerMissed: ReadonlyArray<TruthItem>;
    readonly newlyAdded: ReadonlyArray<TruthItem>;
    readonly noLongerAdded: ReadonlyArray<TruthItem>;
    /** Entidades detectadas que no son email y difieren (tipo, página o valor), si las dos corridas guardaron lo detectado. */
    readonly detectedOnlyBefore: ReadonlyArray<ObservedEntity> | null;
    readonly detectedOnlyAfter: ReadonlyArray<ObservedEntity> | null;
  };
}

const truthKey = (type: string, pageIndex: number, value: string): string =>
  `${type}|${pageIndex}|${canonicalValue(type, value)}`;

function multisetOnlyIn(
  left: ReadonlyArray<TruthItem>,
  right: ReadonlyArray<TruthItem>,
): TruthItem[] {
  const remaining = new Map<string, number>();
  for (const item of right) {
    const key = truthKey(item.type, item.pageIndex, item.value);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const only: TruthItem[] = [];
  for (const item of left) {
    const key = truthKey(item.type, item.pageIndex, item.value);
    const count = remaining.get(key) ?? 0;
    if (count > 0) remaining.set(key, count - 1);
    else only.push(item);
  }
  return only;
}

const exactKey = (entity: ObservedEntity): string =>
  `${entity.type}|${entity.pageIndex}|${entity.value}`;

function detectedOnlyIn(
  left: ReadonlyArray<ObservedEntity>,
  right: ReadonlyArray<ObservedEntity>,
): ObservedEntity[] {
  const remaining = new Map<string, number>();
  for (const entity of right.filter((item) => item.type !== "EMAIL"))
    remaining.set(exactKey(entity), (remaining.get(exactKey(entity)) ?? 0) + 1);
  const only: ObservedEntity[] = [];
  for (const entity of left.filter((item) => item.type !== "EMAIL")) {
    const count = remaining.get(exactKey(entity)) ?? 0;
    if (count > 0) remaining.set(exactKey(entity), count - 1);
    else only.push(entity);
  }
  return only;
}

const lostKey = (lost: { readonly pageIndex: number; readonly expected: string }): string =>
  truthKey("EMAIL", lost.pageIndex, lost.expected);

function lostOnlyIn(left: ReadonlyArray<LostEmail>, right: ReadonlyArray<LostEmail>): LostEmail[] {
  const remaining = new Map<string, number>();
  for (const lost of right) remaining.set(lostKey(lost), (remaining.get(lostKey(lost)) ?? 0) + 1);
  const only: LostEmail[] = [];
  for (const lost of left) {
    const count = remaining.get(lostKey(lost)) ?? 0;
    if (count > 0) remaining.set(lostKey(lost), count - 1);
    else only.push(lost);
  }
  return only;
}

function describeRecovered(lost: LostEmail, after: CellView): RecoveredEmail {
  const wanted = canonicalValue("EMAIL", lost.expected);
  const found =
    after.detected === null
      ? undefined
      : after.detected.find(
          (entity) =>
            entity.type === "EMAIL" &&
            entity.pageIndex === lost.pageIndex &&
            canonicalValue("EMAIL", entity.normalizedValue ?? entity.value) === wanted,
        );
  return {
    pageIndex: lost.pageIndex,
    expected: lost.expected,
    beforeReading: lost.reading,
    beforeFragment: lost.fragment,
    detectedValue: found?.value ?? null,
    detectedNormalizedValue: found?.normalizedValue ?? null,
    normalizedMatchesTruth:
      found === undefined || found.normalizedValue === undefined
        ? null
        : found.normalizedValue === lost.expected,
  };
}

export function compareCell(before: CellView, after: CellView): CellComparison {
  const recoveredLost = lostOnlyIn(before.lostEmails, after.lostEmails);
  // Siguen perdidos: perdidos antes y después (con la lectura de «después»).
  const stillLost = after.lostEmails.filter((lost) =>
    before.lostEmails.some((previous) => lostKey(previous) === lostKey(lost)),
  );
  const bothDetected = before.detected !== null && after.detected !== null;
  return {
    id: after.id,
    beforeValid: before.valid,
    afterValid: after.valid,
    invalidReasons: [
      ...before.invalidReasons.map((reason) => `antes: ${reason}`),
      ...after.invalidReasons.map((reason) => `después: ${reason}`),
    ],
    effectiveDpisBefore: before.effectiveDpis,
    effectiveDpisAfter: after.effectiveDpis,
    textIdentical: before.observedText === after.observedText,
    emailsBefore: before.emails,
    emailsAfter: after.emails,
    recovered: recoveredLost.map((lost) => describeRecovered(lost, after)),
    stillLost,
    newlyLost: lostOnlyIn(after.lostEmails, before.lostEmails),
    addedAfter: after.addedEmails,
    addedBefore: before.addedEmails,
    newlyAdded: after.addedEmails.filter(
      (added) =>
        !before.addedEmails.some(
          (previous) => previous.pageIndex === added.pageIndex && previous.value === added.value,
        ),
    ),
    otherChanges: {
      newlyMissed: multisetOnlyIn(after.otherMissed, before.otherMissed),
      noLongerMissed: multisetOnlyIn(before.otherMissed, after.otherMissed),
      newlyAdded: multisetOnlyIn(after.otherAdded, before.otherAdded),
      noLongerAdded: multisetOnlyIn(before.otherAdded, after.otherAdded),
      detectedOnlyBefore:
        bothDetected && before.detected !== null && after.detected !== null
          ? detectedOnlyIn(before.detected, after.detected)
          : null,
      detectedOnlyAfter:
        bothDetected && before.detected !== null && after.detected !== null
          ? detectedOnlyIn(after.detected, before.detected)
          : null,
    },
  };
}

export interface CampaignComparison {
  readonly name: string;
  readonly cells: ReadonlyArray<CellComparison>;
  /** Celdas que están en una corrida y no en la otra. */
  readonly onlyBefore: ReadonlyArray<string>;
  readonly onlyAfter: ReadonlyArray<string>;
  readonly totals: {
    readonly cellsCompared: number;
    readonly cellsValidInBoth: number;
    readonly cellsInvalid: ReadonlyArray<string>;
    readonly cellsWithDifferentText: ReadonlyArray<string>;
    readonly emailsBefore: CellView["emails"];
    readonly emailsAfter: CellView["emails"];
    readonly recovered: number;
    readonly stillLost: number;
    readonly newlyLost: number;
    readonly addedAfter: number;
    /** Agregados que el cambio introdujo (después y no antes). */
    readonly newlyAdded: number;
    readonly otherChanges: number;
  };
  readonly allRecoveredNormalizedMatchTruth: boolean | null;
}

function sumEmails(parts: ReadonlyArray<CellView["emails"]>): CellView["emails"] {
  return {
    expected: parts.reduce((sum, part) => sum + part.expected, 0),
    detected: parts.reduce((sum, part) => sum + part.detected, 0),
    missed: parts.reduce((sum, part) => sum + part.missed, 0),
    added: parts.reduce((sum, part) => sum + part.added, 0),
  };
}

export function compareCampaign(
  name: string,
  before: ReadonlyMap<string, CellView>,
  after: ReadonlyMap<string, CellView>,
): CampaignComparison {
  const ids = [...after.keys()].filter((id) => before.has(id));
  const cells = ids.map((id) => compareCell(before.get(id) as CellView, after.get(id) as CellView));
  const valid = cells.filter((cell) => cell.beforeValid && cell.afterValid);
  const recovered = valid.flatMap((cell) => cell.recovered);
  const otherCount = (cell: CellComparison): number =>
    cell.otherChanges.newlyMissed.length +
    cell.otherChanges.noLongerMissed.length +
    cell.otherChanges.newlyAdded.length +
    cell.otherChanges.noLongerAdded.length +
    (cell.otherChanges.detectedOnlyBefore?.length ?? 0) +
    (cell.otherChanges.detectedOnlyAfter?.length ?? 0);
  return {
    name,
    cells,
    onlyBefore: [...before.keys()].filter((id) => !after.has(id)),
    onlyAfter: [...after.keys()].filter((id) => !before.has(id)),
    totals: {
      cellsCompared: cells.length,
      cellsValidInBoth: valid.length,
      cellsInvalid: cells
        .filter((cell) => !cell.beforeValid || !cell.afterValid)
        .map((cell) => cell.id),
      cellsWithDifferentText: cells.filter((cell) => !cell.textIdentical).map((cell) => cell.id),
      emailsBefore: sumEmails(valid.map((cell) => cell.emailsBefore)),
      emailsAfter: sumEmails(valid.map((cell) => cell.emailsAfter)),
      recovered: recovered.length,
      stillLost: valid.reduce((sum, cell) => sum + cell.stillLost.length, 0),
      newlyLost: valid.reduce((sum, cell) => sum + cell.newlyLost.length, 0),
      addedAfter: valid.reduce((sum, cell) => sum + cell.addedAfter.length, 0),
      newlyAdded: valid.reduce((sum, cell) => sum + cell.newlyAdded.length, 0),
      otherChanges: valid.reduce((sum, cell) => sum + otherCount(cell), 0),
    },
    allRecoveredNormalizedMatchTruth:
      recovered.length === 0 || recovered.some((item) => item.normalizedMatchesTruth === null)
        ? null
        : recovered.every((item) => item.normalizedMatchesTruth === true),
  };
}

/** El informe legible de una campaña: totales, recuperados, los que siguen perdidos y todo lo inesperado. */
export function comparisonLines(comparison: CampaignComparison): string[] {
  const { totals } = comparison;
  const lines: string[] = [
    `== ${comparison.name} ==`,
    `celdas comparadas: ${totals.cellsCompared} (válidas en las dos: ${totals.cellsValidInBoth})` +
      (totals.cellsInvalid.length > 0 ? `; inválidas: ${totals.cellsInvalid.join(", ")}` : ""),
    `emails (celdas válidas en las dos): antes esperados=${totals.emailsBefore.expected} detectados=${totals.emailsBefore.detected} perdidos=${totals.emailsBefore.missed} agregados=${totals.emailsBefore.added}`,
    `                                    después esperados=${totals.emailsAfter.expected} detectados=${totals.emailsAfter.detected} perdidos=${totals.emailsAfter.missed} agregados=${totals.emailsAfter.added}`,
    `recuperados=${totals.recovered} siguen perdidos=${totals.stillLost} perdidos nuevos=${totals.newlyLost} agregados que no están en la verdad después=${totals.addedAfter} (nuevos respecto de la línea de base=${totals.newlyAdded}) otros cambios de entidades=${totals.otherChanges}`,
    `texto leído idéntico a la línea de base en todas las celdas: ${totals.cellsWithDifferentText.length === 0 ? "sí" : `NO (${totals.cellsWithDifferentText.join(", ")})`}`,
  ];
  if (comparison.onlyBefore.length > 0)
    lines.push(`celdas solo en la línea de base: ${comparison.onlyBefore.join(", ")}`);
  if (comparison.onlyAfter.length > 0)
    lines.push(`celdas solo después: ${comparison.onlyAfter.join(", ")}`);
  const withEvents = comparison.cells.filter(
    (cell) =>
      cell.recovered.length > 0 ||
      cell.stillLost.length > 0 ||
      cell.newlyLost.length > 0 ||
      cell.addedAfter.length > 0,
  );
  if (withEvents.length > 0) lines.push("", "Celdas con emails recuperados, perdidos o agregados:");
  for (const cell of withEvents) {
    lines.push(
      `  ${cell.id} (dpi efectivo ${cell.effectiveDpisAfter.join(",")}): perdidos ${cell.emailsBefore.missed} -> ${cell.emailsAfter.missed}, agregados ${cell.emailsBefore.added} -> ${cell.emailsAfter.added}${cell.textIdentical ? "" : " [TEXTO DISTINTO]"}`,
    );
    for (const item of cell.recovered)
      lines.push(
        `    recuperado p${item.pageIndex} ${item.expected}: antes ${item.beforeReading}${item.beforeFragment === null ? "" : ` [${item.beforeFragment}]`}; después value=[${item.detectedValue ?? "no observable"}] normalizado=[${item.detectedNormalizedValue ?? "no observable"}] coincide con la verdad=${item.normalizedMatchesTruth === null ? "n/d" : String(item.normalizedMatchesTruth)}`,
      );
    for (const item of cell.stillLost)
      lines.push(
        `    sigue perdido p${item.pageIndex} ${item.expected}: ${item.reading}${item.fragment === null ? "" : ` [${item.fragment}]`}`,
      );
    for (const item of cell.newlyLost)
      lines.push(`    PERDIDO NUEVO p${item.pageIndex} ${item.expected}: ${item.reading}`);
    for (const item of cell.addedAfter) {
      const isNew = cell.newlyAdded.some(
        (added) => added.pageIndex === item.pageIndex && added.value === item.value,
      );
      lines.push(
        `    AGREGADO que no está en la verdad p${item.pageIndex}: ${item.value}${isNew ? " [NUEVO]" : " [ya estaba en la línea de base]"}`,
      );
    }
  }
  const withOther = comparison.cells.filter(
    (cell) =>
      cell.otherChanges.newlyMissed.length +
        cell.otherChanges.noLongerMissed.length +
        cell.otherChanges.newlyAdded.length +
        cell.otherChanges.noLongerAdded.length +
        (cell.otherChanges.detectedOnlyBefore?.length ?? 0) +
        (cell.otherChanges.detectedOnlyAfter?.length ?? 0) >
      0,
  );
  if (withOther.length > 0) lines.push("", "Otras entidades que cambian (no emails):");
  for (const cell of withOther) {
    const describe = (
      label: string,
      items: ReadonlyArray<{ type: string; value: string }>,
    ): void => {
      for (const item of items) lines.push(`    ${label} ${item.type}: ${item.value}`);
    };
    lines.push(`  ${cell.id}:`);
    describe("perdida ahora", cell.otherChanges.newlyMissed);
    describe("ya no perdida", cell.otherChanges.noLongerMissed);
    describe("agregada ahora", cell.otherChanges.newlyAdded);
    describe("ya no agregada", cell.otherChanges.noLongerAdded);
    describe("detectada solo antes", cell.otherChanges.detectedOnlyBefore ?? []);
    describe("detectada solo después", cell.otherChanges.detectedOnlyAfter ?? []);
  }
  return lines;
}
