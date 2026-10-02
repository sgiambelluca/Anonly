/**
 * Agregador puro de la fase 1 (calidad) de la campaña de DPI descendente y su regla de decisión
 * (docs/roadmap/ocr/OCR_DPI_Descendente_Campana_Plan.md §6, reescrita tras la revisión). Sin
 * filesystem: quien lo llama inyecta la lectura de celdas.
 *
 * Principio: el arnés solo dice «pasa» cuando midió todo lo que la regla exige. Lo ausente, lo
 * inválido y lo indeterminado nunca cuentan a favor ni se convierten en cero.
 */

import type { ChainEvidence, DispatchEvidence } from "./ocrDpiDownChain.js";
import {
  NON_DECIDING_CORPORA,
  SD_VARIANT_IDS,
  SINGLE_CONTROL_CORPORA,
  isSdVariant,
  isSyntheticCorpus,
  type CorpusId,
} from "./ocrDpiDownCorpus.js";
import {
  distributionOf,
  type Distribution,
  type EntityComparison,
  type TokenScore,
} from "./ocrDpiDownScoring.js";
import {
  validityCaveatsOf,
  type UltraCaveat,
  type UltraSleepDetection,
} from "./ocrPoolUltraSummary.js";

export const CONTROL_DPI = 300;
export const CONTROL_REPETITIONS = 2;
export const DEFAULT_ARM_DPIS: ReadonlyArray<number> = [300, 250, 200, 150];
export const DISCRIMINANT_DPI = 150;
/** §6.2: el control tiene que detectar al menos esta fracción de la verdad. */
export const CONTROL_TRUTH_FLOOR = 0.9;
/** §6.1: corpus que deciden. `R3` decide solo si está en la matriz; `S6` nunca. */
export const REQUIRED_DECIDING_CORPORA: ReadonlyArray<CorpusId> = [
  "S12",
  "S10",
  "S8",
  "SE",
  "SR",
  "R2",
  ...SD_VARIANT_IDS,
];

export type CountsByType = Readonly<Record<string, number>>;
export type EntityCounts = Pick<EntityComparison, "byType" | "totals">;

/** Lo que escribe el spec por celda. En los reales no hay valores de entidades ni texto. */
export interface CellRecord {
  readonly schema: 1;
  readonly corpus: CorpusId;
  readonly corpusKind: "synthetic" | "real";
  readonly dpi: number;
  readonly repetition: number;
  readonly valid: boolean;
  readonly invalidReasons: ReadonlyArray<string>;
  /** Todos los despachos salieron al DPI pedido; `false` = brazo no efectivo en este corpus (tope de la fuente). */
  readonly armEffective: boolean;
  readonly fixtureSha256: string | null;
  readonly dispatch: DispatchEvidence | null;
  readonly chain: ChainEvidence | null;
  readonly detectedByType: CountsByType;
  readonly entitiesVsTruth: EntityCounts | null;
  readonly entitiesVsReference: EntityCounts | null;
  /** Claves (tipo, página, valor canónico) de las entidades de la verdad que este brazo no detectó; solo sintéticos. */
  readonly truthLostKeys: ReadonlyArray<string> | null;
  readonly tokensVsTruth: TokenScore | null;
  readonly tokensVsReference: TokenScore | null;
  /** Cobertura de la caja de referencia (la de 300, repetición 1) por entidad común. */
  readonly coverageVsReference: {
    readonly values: ReadonlyArray<number>;
    readonly pairsWithoutBox: number;
  } | null;
}

export function cellId(corpus: string, dpi: number, repetition: number): string {
  return `${corpus}-d${dpi}-rep${repetition}`;
}

export function expectedCellKeys(
  corpora: ReadonlyArray<CorpusId>,
  arms: ReadonlyArray<number>,
): ReadonlyArray<{ corpus: CorpusId; dpi: number; repetition: number }> {
  const keys: { corpus: CorpusId; dpi: number; repetition: number }[] = [];
  for (const corpus of corpora)
    for (const dpi of arms) {
      const repetitions =
        dpi === CONTROL_DPI && !SINGLE_CONTROL_CORPORA.includes(corpus) ? CONTROL_REPETITIONS : 1;
      for (let repetition = 1; repetition <= repetitions; repetition += 1)
        keys.push({ corpus, dpi, repetition });
    }
  return keys;
}

/** Celda inválida que reemplaza a las de un corpus que el runner invalidó (p. ej. una suspensión). */
export function invalidatedCell(
  corpus: CorpusId,
  dpi: number,
  repetition: number,
  reasons: ReadonlyArray<string>,
): CellRecord {
  return {
    schema: 1,
    corpus,
    corpusKind: isSyntheticCorpus(corpus) ? "synthetic" : "real",
    dpi,
    repetition,
    valid: false,
    invalidReasons: reasons,
    armEffective: false,
    fixtureSha256: null,
    dispatch: null,
    chain: null,
    detectedByType: {},
    entitiesVsTruth: null,
    truthLostKeys: null,
    entitiesVsReference: null,
    tokensVsTruth: null,
    tokensVsReference: null,
    coverageVsReference: null,
  };
}

/** §6.3: umbral oficial de cobertura (decisión del humano, 2026-10-01). Constante del arnés. */
export const OFFICIAL_MIN_COVERAGE = 0.95;

export interface MinCoverageResolution {
  /** Lo que llegó, sin tocar; `null` si no llegó nada. */
  readonly raw: string | null;
  /** El umbral que se aplica para detectar fallos (siempre un número en [0, 1]). */
  readonly effective: number;
  /** `false`: se pidió otro valor para explorar (o uno inválido); ningún brazo puede salir «pasa». */
  readonly official: boolean;
  readonly caveat: string | null;
}

/**
 * Sin valor se aplica 0,95. Otro valor se acepta solo para explorar: ningún brazo sale «pasa» y
 * queda una salvedad. Un valor que no es un número finito en [0, 1] se trata igual (con 0,95).
 */
export function resolveMinCoverage(raw: string | number | null | undefined): MinCoverageResolution {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === ""))
    return { raw: null, effective: OFFICIAL_MIN_COVERAGE, official: true, caveat: null };
  const text = String(raw);
  const value =
    typeof raw === "number" ? raw : /^\s*[0-9.]+\s*$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > 1)
    return {
      raw: text,
      effective: OFFICIAL_MIN_COVERAGE,
      official: false,
      caveat: `min-coverage-invalid: el valor recibido ${JSON.stringify(text)} no es un número finito entre 0 y 1; se aplica ${OFFICIAL_MIN_COVERAGE} y ningún brazo puede pasar`,
    };
  if (value === OFFICIAL_MIN_COVERAGE)
    return { raw: text, effective: value, official: true, caveat: null };
  return {
    raw: text,
    effective: value,
    official: false,
    caveat: `min-coverage-override: umbral de exploración ${value} distinto del oficial ${OFFICIAL_MIN_COVERAGE}; ningún brazo puede pasar`,
  };
}

/** Cuántas páginas con despacho salieron al DPI pedido (el DPI efectivo es por página). */
export interface Effectiveness {
  readonly kind: "all" | "none" | "partial";
  readonly effectivePages: number;
  readonly totalPages: number;
}

export function cellEffectiveness(cell: CellRecord): Effectiveness {
  const dispatch = cell.dispatch;
  if (dispatch !== null && dispatch.dispatches.length > 0) {
    const pages = new Map<number, boolean>();
    for (const item of dispatch.dispatches)
      pages.set(
        item.pageIndex,
        (pages.get(item.pageIndex) ?? true) && item.dpi === dispatch.requestedDpi,
      );
    const effectivePages = [...pages.values()].filter(Boolean).length;
    return {
      kind: effectivePages === pages.size ? "all" : effectivePages === 0 ? "none" : "partial",
      effectivePages,
      totalPages: pages.size,
    };
  }
  return { kind: cell.armEffective ? "all" : "none", effectivePages: 0, totalPages: 0 };
}

export interface DpiDownInput {
  readonly readCell: (corpus: CorpusId, dpi: number, repetition: number) => CellRecord | null;
  readonly corpora: ReadonlyArray<CorpusId>;
  readonly skippedCorpora: ReadonlyArray<{ readonly corpus: CorpusId; readonly reason: string }>;
  readonly arms: ReadonlyArray<number>;
  /** Un humo nunca emite «pasa». */
  readonly smoke?: boolean;
  /** Umbral de cobertura tal como llegó: lo fija el humano antes de la matriz. Se valida acá. */
  readonly minCoverageRaw?: string | number | null;
  readonly sleepDetection?: UltraSleepDetection;
  readonly caveats?: ReadonlyArray<UltraCaveat>;
}

export type Verdict = "pasa" | "no-pasa" | "indeterminado" | "parcial";
export interface Reason {
  readonly corpus: string;
  readonly criterion: 1 | 2 | 3 | "celda" | "matriz" | "control";
  readonly detail: string;
}

export interface CorpusArmResult {
  readonly cellStatus: "valida" | "invalida" | "ausente";
  readonly armEffective: boolean | null;
  /** Páginas con despacho al DPI pedido sobre el total de páginas con despacho. */
  readonly effectivePages: { readonly effective: number; readonly total: number } | null;
  /** Entidades que el control 300 (repetición 1) detectó y este brazo no; `null` en el propio control. */
  readonly entitiesLostVsControl: number | null;
  readonly entitiesLostVsControlByType: CountsByType | null;
  /** Contra la verdad (solo sintéticos): incluye lo que el control ya perdía. Se informa siempre. */
  readonly entitiesLostVsTruth: number | null;
  readonly entitiesLostVsTruthByType: CountsByType | null;
  readonly entitiesAddedVsTruth: number | null;
  readonly coverage: Distribution | null;
  readonly coveragePairsWithoutBox: number | null;
  readonly unreadableInkPages: number | null;
  readonly recoverySteps: number | null;
  readonly upscaledDispatches: number | null;
  readonly tokenRecall: number | null;
  readonly tokenPrecision: number | null;
}

export interface SdVariantDetail {
  readonly variant: string;
  readonly expected: number;
  readonly lostControl: number;
  readonly lostArm: number;
  /** Detalle informativo (no decide): entidades que el brazo pierde y 300 detecta, y al revés. */
  readonly armLosesWhere300Detects: number | null;
  readonly armDetectsWhere300Loses: number | null;
  /** Claves de la verdad que cada uno no detectó (solo sintéticos, valores inventados): para que el humano vea qué perdió cada uno. */
  readonly lostByControl: ReadonlyArray<string> | null;
  readonly lostByArm: ReadonlyArray<string> | null;
}
export interface SdOutcome {
  readonly outcome: "pasa" | "no-pasa" | "indeterminado";
  readonly perVariant: ReadonlyArray<SdVariantDetail>;
  readonly totalExpected: number;
  readonly totalLostControl: number;
  readonly totalLostArm: number;
  readonly controlDetectedFraction: number | null;
  readonly reason: string;
}

function multisetExcess(left: ReadonlyArray<string>, right: ReadonlyArray<string>): number {
  const available = new Map<string, number>();
  for (const key of right) available.set(key, (available.get(key) ?? 0) + 1);
  let excess = 0;
  for (const key of left) {
    const remaining = available.get(key) ?? 0;
    if (remaining > 0) available.set(key, remaining - 1);
    else excess += 1;
  }
  return excess;
}

/**
 * `SD` (§6.2): sobre las cinco variantes juntas. Piso del control: 300 detecta al menos el 90 % de
 * la verdad, si no el corpus es indeterminado. El brazo no pasa si su total de pérdidas contra la
 * verdad supera al de 300; con un total igual o menor, pasa. El detalle por variante no decide.
 */
export function compareSdTotals(
  variants: ReadonlyArray<{
    readonly variant: string;
    readonly expected: number;
    readonly lostControl: number;
    readonly lostArm: number;
    readonly controlKeys?: ReadonlyArray<string> | null;
    readonly armKeys?: ReadonlyArray<string> | null;
  }>,
): SdOutcome {
  const perVariant: SdVariantDetail[] = variants.map((v) => ({
    variant: v.variant,
    expected: v.expected,
    lostControl: v.lostControl,
    lostArm: v.lostArm,
    armLosesWhere300Detects:
      v.controlKeys && v.armKeys ? multisetExcess(v.armKeys, v.controlKeys) : null,
    armDetectsWhere300Loses:
      v.controlKeys && v.armKeys ? multisetExcess(v.controlKeys, v.armKeys) : null,
    lostByControl: v.controlKeys ?? null,
    lostByArm: v.armKeys ?? null,
  }));
  const totalExpected = perVariant.reduce((sum, v) => sum + v.expected, 0);
  const totalLostControl = perVariant.reduce((sum, v) => sum + v.lostControl, 0);
  const totalLostArm = perVariant.reduce((sum, v) => sum + v.lostArm, 0);
  const base = { perVariant, totalExpected, totalLostControl, totalLostArm };
  if (totalExpected === 0)
    return {
      ...base,
      outcome: "indeterminado",
      controlDetectedFraction: null,
      reason: "SD sin entidades esperadas",
    };
  const fraction = (totalExpected - totalLostControl) / totalExpected;
  if (fraction < CONTROL_TRUTH_FLOOR)
    return {
      ...base,
      outcome: "indeterminado",
      controlDetectedFraction: fraction,
      reason: `piso del control: 300 detecta ${totalExpected - totalLostControl} de ${totalExpected} (${(fraction * 100).toFixed(1)} %), menos del ${CONTROL_TRUTH_FLOOR * 100} %`,
    };
  if (totalLostArm > totalLostControl)
    return {
      ...base,
      outcome: "no-pasa",
      controlDetectedFraction: fraction,
      reason: `el brazo pierde ${totalLostArm} contra la verdad y 300 pierde ${totalLostControl}`,
    };
  return {
    ...base,
    outcome: "pasa",
    controlDetectedFraction: fraction,
    reason: `el brazo pierde ${totalLostArm} y 300 pierde ${totalLostControl}`,
  };
}

export interface ArmSummary {
  readonly dpi: number;
  readonly role: "control" | "candidato" | "control-discriminante";
  readonly verdict: Verdict | null;
  readonly failures: ReadonlyArray<Reason>;
  readonly indeterminate: ReadonlyArray<Reason>;
  /** Corpus donde el DPI efectivo no es el pedido: el brazo no se evalúa ahí (ni aprueba ni reprueba). */
  readonly notEvaluatedCorpora: ReadonlyArray<string>;
  /** Resultado de `SD` sobre sus variantes juntas (criterio 1); `null` si `SD` no está en la matriz. */
  readonly sd: SdOutcome | null;
  readonly perCorpus: Readonly<Record<string, CorpusArmResult>>;
}

export interface ControlVariation {
  readonly perCorpus: Readonly<
    Record<
      string,
      {
        readonly coverage: Distribution | null;
        readonly entityCountsIdenticalToRep1: boolean | null;
        readonly chainIdenticalToRep1: boolean | null;
      }
    >
  >;
  readonly overallCoverage: Distribution | null;
  readonly note: string;
}

export interface ControlFloor {
  /** `true`: sirve de referencia; `false`: el corpus queda indeterminado; `null`: no se pudo medir. */
  readonly ok: boolean | null;
  readonly reasons: ReadonlyArray<string>;
}

export interface DpiDownSummary {
  readonly phase: "dpi-down-quality";
  readonly decisionRule: {
    readonly source: string;
    readonly minCoverageRaw: string | null;
    readonly minCoverage: number;
    /** `false`: umbral de exploración; ningún brazo puede pasar. */
    readonly minCoverageOfficial: boolean;
    readonly minCoverageNote: string;
  };
  readonly matrix: {
    readonly complete: boolean;
    readonly reasons: ReadonlyArray<string>;
    readonly missingCorpora: ReadonlyArray<string>;
  };
  readonly corpora: {
    readonly evaluated: ReadonlyArray<string>;
    readonly nonDeciding: ReadonlyArray<string>;
    readonly skipped: ReadonlyArray<{ readonly corpus: string; readonly reason: string }>;
  };
  readonly controlVariation: ControlVariation;
  readonly controlFloor: Readonly<Record<string, ControlFloor>>;
  /** Corpus donde el control 300 no leyó todas las entidades de la verdad: hallazgo, no un brazo. */
  readonly controlIncompleteCorpora: ReadonlyArray<{
    readonly corpus: string;
    readonly lostByType: CountsByType;
  }>;
  readonly thresholdBelowControlVariation: boolean | null;
  /** Brazo no efectivo en un real que aun así difiere del control: el control es inconsistente (salvedad). */
  readonly controlInconsistencies: ReadonlyArray<{
    readonly arm: number;
    readonly corpus: string;
    readonly lostVsControl: number;
    readonly addedVsControl: number;
  }>;
  readonly arms: Readonly<Record<string, ArmSummary>>;
  /** El brazo 150 no perdió ninguna entidad que 300 detecta en un corpus que decide: la campaña se detiene. */
  readonly discriminantControlFailed: boolean | null;
  readonly discriminantControlNote: string | null;
  readonly campaignShouldStop: boolean;
  readonly nonDecidingCorpusReport: Readonly<
    Record<string, Readonly<Record<string, CorpusArmResult>>>
  >;
  /** Corpus cuyo fixture salió con hashes distintos entre celdas: todas sus celdas quedan inválidas. */
  readonly fixtureHashMismatches: ReadonlyArray<{
    readonly corpus: string;
    readonly hashes: ReadonlyArray<string>;
  }>;
  /** Datos observados por corpus (p. ej. el `inkRatio` del OSD) y notas fijas. */
  readonly corpusFacts: Readonly<
    Record<
      string,
      {
        readonly inkRatio: { readonly min: number; readonly max: number } | null;
        readonly note: string | null;
      }
    >
  >;
  readonly invalidCells: ReadonlyArray<{
    readonly cell: string;
    readonly reasons: ReadonlyArray<string>;
  }>;
  readonly missingCells: ReadonlyArray<string>;
  readonly sleepDetection: UltraSleepDetection;
  readonly validityCaveats: ReadonlyArray<string>;
  /** Todas las celdas esperadas existen y son válidas (no implica que la matriz decida: ver `matrix`). */
  readonly complete: boolean;
}

const SLEEP_NOT_REPORTED: UltraSleepDetection = {
  available: null,
  note: "tanda anterior al campo: no se sabe si la detección de suspensión estuvo activa",
};

const SD_INK_NOTE =
  "inkRatio 1 por construcción: el ruido deja sin píxeles de blanco puro y el predicado de ADR-190 cuenta como tinta cualquier píxel que no lo sea; ADR-190 nunca considera escasa esta página";

function lostByType(counts: EntityCounts | null): CountsByType | null {
  if (counts === null) return null;
  return Object.fromEntries(
    Object.entries(counts.byType)
      .filter(([, value]) => value.missed > 0)
      .map(([type, value]) => [type, value.missed]),
  );
}

function describeLost(byType: CountsByType): string {
  return Object.entries(byType)
    .map(([type, count]) => `${type}x${count}`)
    .join(", ");
}

const EMPTY_RESULT = {
  armEffective: null,
  effectivePages: null,
  entitiesLostVsControl: null,
  entitiesLostVsControlByType: null,
  entitiesLostVsTruth: null,
  entitiesLostVsTruthByType: null,
  entitiesAddedVsTruth: null,
  coverage: null,
  coveragePairsWithoutBox: null,
  unreadableInkPages: null,
  recoverySteps: null,
  upscaledDispatches: null,
  tokenRecall: null,
  tokenPrecision: null,
} as const;

function corpusResult(cell: CellRecord | null): CorpusArmResult {
  if (cell === null) return { cellStatus: "ausente", ...EMPTY_RESULT };
  if (!cell.valid)
    return { cellStatus: "invalida", ...EMPTY_RESULT, armEffective: cell.armEffective };
  const tokens = isSyntheticCorpus(cell.corpus) ? cell.tokensVsTruth : cell.tokensVsReference;
  return {
    cellStatus: "valida",
    armEffective: cell.armEffective,
    effectivePages: (() => {
      const eff = cellEffectiveness(cell);
      return eff.totalPages === 0 ? null : { effective: eff.effectivePages, total: eff.totalPages };
    })(),
    entitiesLostVsControl: cell.entitiesVsReference?.totals.missed ?? null,
    entitiesLostVsControlByType: lostByType(cell.entitiesVsReference),
    entitiesLostVsTruth: cell.entitiesVsTruth?.totals.missed ?? null,
    entitiesLostVsTruthByType: lostByType(cell.entitiesVsTruth),
    entitiesAddedVsTruth: cell.entitiesVsTruth?.totals.added ?? null,
    coverage:
      cell.coverageVsReference === null ? null : distributionOf(cell.coverageVsReference.values),
    coveragePairsWithoutBox: cell.coverageVsReference?.pairsWithoutBox ?? null,
    unreadableInkPages: cell.chain?.unreadableInkPages ?? null,
    recoverySteps: cell.chain?.recoverySteps ?? null,
    upscaledDispatches: cell.chain?.upscaledDispatches ?? null,
    tokenRecall: tokens?.recall ?? null,
    tokenPrecision: tokens?.precision ?? null,
  };
}

function sameChain(a: ChainEvidence | null, b: ChainEvidence | null): boolean | null {
  if (a === null || b === null) return null;
  return (
    a.recoverySteps === b.recoverySteps &&
    a.unreadableInkPages === b.unreadableInkPages &&
    a.upscaledDispatches === b.upscaledDispatches &&
    JSON.stringify(a.osd) === JSON.stringify(b.osd)
  );
}

export function summarizeDpiDown(input: DpiDownInput): DpiDownSummary {
  const { corpora, arms } = input;
  const threshold = resolveMinCoverage(input.minCoverageRaw);
  const minCoverage = threshold.effective;
  const controlInconsistencies: {
    arm: number;
    corpus: string;
    lostVsControl: number;
    addedVsControl: number;
  }[] = [];

  // El fixture de un corpus tiene que ser el mismo en todas sus celdas: si se regeneró distinto a
  // mitad de campaña, todas sus celdas quedan inválidas.
  const fixtureHashMismatches: { corpus: string; hashes: string[] }[] = [];
  const hashInvalid = new Set<string>();
  for (const corpus of corpora) {
    const hashes = new Set<string>();
    for (const key of expectedCellKeys([corpus], arms)) {
      const hash = input.readCell(corpus, key.dpi, key.repetition)?.fixtureSha256;
      if (hash !== null && hash !== undefined) hashes.add(hash);
    }
    if (hashes.size > 1) {
      fixtureHashMismatches.push({ corpus, hashes: [...hashes].sort() });
      hashInvalid.add(corpus);
    }
  }
  const cache = new Map<string, CellRecord | null>();
  const read = (corpus: CorpusId, dpi: number, repetition: number): CellRecord | null => {
    const id = cellId(corpus, dpi, repetition);
    if (cache.has(id)) return cache.get(id) ?? null;
    const cell = hashInvalid.has(corpus)
      ? invalidatedCell(corpus, dpi, repetition, ["fixture-hash-differs-between-cells"])
      : input.readCell(corpus, dpi, repetition);
    cache.set(id, cell);
    return cell;
  };

  const missingCells: string[] = [];
  const invalidCells: { cell: string; reasons: ReadonlyArray<string> }[] = [];
  for (const key of expectedCellKeys(corpora, arms)) {
    const id = cellId(key.corpus, key.dpi, key.repetition);
    const cell = read(key.corpus, key.dpi, key.repetition);
    if (cell === null) missingCells.push(id);
    else if (!cell.valid) invalidCells.push({ cell: id, reasons: cell.invalidReasons });
  }

  const nonDeciding = corpora.filter((corpus) => NON_DECIDING_CORPORA.includes(corpus));
  const deciding = corpora.filter((corpus) => !NON_DECIDING_CORPORA.includes(corpus));
  const sdVariants = deciding.filter((corpus) => isSdVariant(corpus));

  // §6.1: la matriz tiene que estar completa para que algún brazo pueda pasar.
  const matrixReasons: string[] = [];
  const missingCorpora = REQUIRED_DECIDING_CORPORA.filter((corpus) => !corpora.includes(corpus));
  for (const corpus of missingCorpora) {
    const skipped = input.skippedCorpora.find((item) => item.corpus === corpus);
    matrixReasons.push(
      `falta el corpus que decide ${corpus}${skipped ? ` (${skipped.reason})` : ""}`,
    );
  }
  if (input.smoke === true) matrixReasons.push("es un humo: nunca emite «pasa»");
  if (!arms.includes(CONTROL_DPI)) matrixReasons.push("la matriz no incluye el brazo 300");
  if (!arms.includes(DISCRIMINANT_DPI))
    matrixReasons.push("la matriz no incluye el control discriminante (150)");
  const decidingMissing = missingCells.filter((id) => {
    const corpus = corpora.find((candidate) => id.startsWith(`${candidate}-d`));
    return corpus !== undefined && !NON_DECIDING_CORPORA.includes(corpus);
  });
  if (decidingMissing.length > 0)
    matrixReasons.push(`faltan celdas de corpus que deciden: ${decidingMissing.join(", ")}`);
  const matrixComplete = matrixReasons.length === 0;

  // §6.2: piso del control, por corpus.
  const controlFloor: Record<string, ControlFloor> = {};
  const controlIncomplete: { corpus: string; lostByType: CountsByType }[] = [];
  const variationPerCorpus: Record<
    string,
    {
      coverage: Distribution | null;
      entityCountsIdenticalToRep1: boolean | null;
      chainIdenticalToRep1: boolean | null;
    }
  > = {};
  const controlCoverageValues: number[] = [];
  for (const corpus of corpora) {
    const rep1 = read(corpus, CONTROL_DPI, 1);
    if (rep1 !== null && rep1.valid && isSyntheticCorpus(corpus)) {
      const lost = lostByType(rep1.entitiesVsTruth);
      if (lost !== null && Object.keys(lost).length > 0)
        controlIncomplete.push({ corpus, lostByType: lost });
    }
    if (SINGLE_CONTROL_CORPORA.includes(corpus)) continue;
    const rep2 = read(corpus, CONTROL_DPI, CONTROL_REPETITIONS);
    const usable = rep1 !== null && rep1.valid && rep2 !== null && rep2.valid;
    const values =
      usable && rep2.coverageVsReference !== null ? rep2.coverageVsReference.values : [];
    controlCoverageValues.push(...values);
    const identical = usable
      ? rep2.entitiesVsReference === null
        ? null
        : rep2.entitiesVsReference.totals.missed === 0 &&
          rep2.entitiesVsReference.totals.added === 0
      : null;
    variationPerCorpus[corpus] = {
      coverage: distributionOf(values),
      entityCountsIdenticalToRep1: identical,
      chainIdenticalToRep1: usable ? sameChain(rep1.chain, rep2.chain) : null,
    };
    if (isSdVariant(corpus)) continue;
    // Corpus limpios y reales: las dos repeticiones detectan lo mismo; en sintéticos, además, el
    // control detecta al menos el 90 % de la verdad.
    const reasons: string[] = [];
    let ok: boolean | null = true;
    if (!usable) {
      ok = null;
      reasons.push("control 300 ausente o inválido");
    } else {
      if (identical === null) {
        ok = null;
        reasons.push("sin comparación entre las dos repeticiones del control");
      } else if (!identical) {
        ok = false;
        reasons.push("las dos repeticiones de 300 no detectan las mismas entidades");
      }
      if (isSyntheticCorpus(corpus)) {
        for (const rep of [rep1, rep2]) {
          const truth = rep.entitiesVsTruth;
          if (truth === null || truth.totals.expected === 0) {
            ok = ok === false ? false : null;
            reasons.push("sin verdad medida en el control");
          } else {
            const fraction = (truth.totals.expected - truth.totals.missed) / truth.totals.expected;
            if (fraction < CONTROL_TRUTH_FLOOR) {
              ok = false;
              reasons.push(
                `piso del control: 300 detecta ${(fraction * 100).toFixed(1)} % de la verdad, menos del ${CONTROL_TRUTH_FLOOR * 100} %`,
              );
              break;
            }
          }
        }
      }
    }
    controlFloor[corpus] = { ok, reasons };
  }
  if (sdVariants.length > 0) {
    const cells = sdVariants.map((variant) => read(variant, CONTROL_DPI, 1));
    if (cells.some((cell) => cell === null || !cell.valid))
      controlFloor.SD = {
        ok: null,
        reasons: ["control 300 ausente o inválido en alguna variante"],
      };
    else {
      const outcome = compareSdTotals(
        sdVariants.map((variant, index) => ({
          variant,
          expected: cells[index]?.entitiesVsTruth?.totals.expected ?? 0,
          lostControl: cells[index]?.entitiesVsTruth?.totals.missed ?? 0,
          lostArm: 0,
        })),
      );
      const floorFailed = outcome.outcome === "indeterminado";
      controlFloor.SD = { ok: !floorFailed, reasons: floorFailed ? [outcome.reason] : [] };
    }
  }
  const overallControlCoverage = distributionOf(controlCoverageValues);

  const armSummaries: Record<string, ArmSummary> = {};
  const nonDecidingReport: Record<string, Record<string, CorpusArmResult>> = {};
  for (const dpi of arms) {
    const role: ArmSummary["role"] =
      dpi === CONTROL_DPI
        ? "control"
        : dpi === DISCRIMINANT_DPI
          ? "control-discriminante"
          : "candidato";
    const failures: Reason[] = [];
    const indeterminate: Reason[] = [];
    const notEvaluated: string[] = [];
    const perCorpus: Record<string, CorpusArmResult> = {};
    let evaluatedCorpora = 0;
    for (const corpus of corpora) {
      const cell = read(corpus, dpi, 1);
      const result = corpusResult(cell);
      perCorpus[corpus] = result;
      if (nonDeciding.includes(corpus)) {
        nonDecidingReport[corpus] = { ...(nonDecidingReport[corpus] ?? {}), [String(dpi)]: result };
        continue;
      }
      if (role === "control") continue;
      if (cell === null) continue; // la matriz lo declara parcial
      if (!cell.valid) {
        indeterminate.push({
          corpus,
          criterion: "celda",
          detail: `celda inválida: ${cell.invalidReasons.join("; ")}`,
        });
        continue;
      }
      const reference = read(corpus, CONTROL_DPI, 1);
      if (reference === null || !reference.valid) {
        indeterminate.push({
          corpus,
          criterion: "celda",
          detail: "la referencia (brazo 300, repetición 1) falta o es inválida",
        });
        continue;
      }
      // §6.1: un brazo cuyo DPI efectivo no es el pedido no se evalúa en ese corpus; uno efectivo
      // solo en parte de las páginas deja el corpus indeterminado; en un sintético que decide, un
      // brazo no evaluado deja al brazo indeterminado.
      const effectiveness = cellEffectiveness(cell);
      if (effectiveness.kind === "none") {
        notEvaluated.push(corpus);
        if (isSyntheticCorpus(corpus))
          indeterminate.push({
            corpus,
            criterion: "celda",
            detail:
              "el brazo no es efectivo en un sintético (son de 300 dpi nativos): no se evaluó en todo lo que decide",
          });
        else if (
          (cell.entitiesVsReference?.totals.missed ?? 0) > 0 ||
          (cell.entitiesVsReference?.totals.added ?? 0) > 0
        )
          controlInconsistencies.push({
            arm: dpi,
            corpus,
            lostVsControl: cell.entitiesVsReference?.totals.missed ?? 0,
            addedVsControl: cell.entitiesVsReference?.totals.added ?? 0,
          });
        continue;
      }
      if (effectiveness.kind === "partial") {
        indeterminate.push({
          corpus,
          criterion: "celda",
          detail: `el DPI pedido fue efectivo en ${effectiveness.effectivePages} de ${effectiveness.totalPages} páginas`,
        });
        continue;
      }
      evaluatedCorpora += 1;

      // Criterio 1 (corpus limpios y reales; SD se evalúa junto, más abajo).
      if (!isSdVariant(corpus)) {
        const floor = controlFloor[corpus];
        if (floor === undefined || floor.ok !== true)
          indeterminate.push({
            corpus,
            criterion: 1,
            detail: `el control 300 no sirve de referencia: ${(floor?.reasons ?? ["sin piso medido"]).join("; ")}`,
          });
        else if (result.entitiesLostVsControl === null)
          indeterminate.push({
            corpus,
            criterion: 1,
            detail: "sin comparación de entidades contra el control 300",
          });
        else if (result.entitiesLostVsControl > 0)
          failures.push({
            corpus,
            criterion: 1,
            detail: `pierde ${result.entitiesLostVsControl} (${describeLost(result.entitiesLostVsControlByType ?? {})}) que el control 300 detecta`,
          });
      }

      // Criterio 2: cobertura de las cajas de referencia.
      if (result.coveragePairsWithoutBox !== null && result.coveragePairsWithoutBox > 0)
        indeterminate.push({
          corpus,
          criterion: 2,
          detail: `${result.coveragePairsWithoutBox} entidades presentes en los dos brazos sin caja medible`,
        });
      else if (result.coverage === null)
        indeterminate.push({
          corpus,
          criterion: 2,
          detail: "sin pares de cajas contra el brazo 300",
        });
      else if (result.coverage.min < minCoverage)
        failures.push({
          corpus,
          criterion: 2,
          detail: `cobertura mínima ${result.coverage.min.toFixed(4)} bajo el umbral ${minCoverage}`,
        });

      // Criterio 3: la cadena de ADR-190 contra la peor de las repeticiones del control.
      const controls = [read(corpus, CONTROL_DPI, 1), read(corpus, CONTROL_DPI, 2)].filter(
        (candidate): candidate is CellRecord => candidate !== null && candidate.valid,
      );
      const baselineInk = Math.max(0, ...controls.map((c) => c.chain?.unreadableInkPages ?? 0));
      const baselineSteps = Math.max(0, ...controls.map((c) => c.chain?.recoverySteps ?? 0));
      if (result.unreadableInkPages === null || result.recoverySteps === null)
        indeterminate.push({ corpus, criterion: 3, detail: "sin cadena de ADR-190" });
      else {
        if (result.unreadableInkPages > baselineInk)
          failures.push({
            corpus,
            criterion: 3,
            detail: `páginas con tinta ilegible ${result.unreadableInkPages} > ${baselineInk} del control`,
          });
        if (result.recoverySteps > baselineSteps)
          failures.push({
            corpus,
            criterion: 3,
            detail: `pasos de recuperación ${result.recoverySteps} > ${baselineSteps} del control`,
          });
      }
    }

    // Criterio 1 de SD: cinco variantes juntas, totales contra la verdad.
    let sd: SdOutcome | null = null;
    if (role !== "control" && sdVariants.length > 0) {
      const pairs: Parameters<typeof compareSdTotals>[0][number][] = [];
      let problem: string | null = null;
      let ineffective = 0;
      for (const variant of sdVariants) {
        const control = read(variant, CONTROL_DPI, 1);
        const arm = read(variant, dpi, 1);
        if (arm === null) {
          problem = `variante ${variant}: celda del brazo ausente`;
          continue;
        }
        if (control === null || !control.valid || !arm.valid) {
          problem = `variante ${variant}: celda del brazo o del control 300 ausente o inválida`;
          continue;
        }
        const armEffectiveness = cellEffectiveness(arm);
        if (armEffectiveness.kind !== "all") {
          ineffective += 1;
          continue;
        }
        if (arm.entitiesVsTruth === null || control.entitiesVsTruth === null) {
          problem = `variante ${variant}: sin la verdad medida`;
          continue;
        }
        pairs.push({
          variant,
          expected: control.entitiesVsTruth.totals.expected,
          lostControl: control.entitiesVsTruth.totals.missed,
          lostArm: arm.entitiesVsTruth.totals.missed,
          controlKeys: control.truthLostKeys,
          armKeys: arm.truthLostKeys,
        });
      }
      if (ineffective > 0 && problem === null)
        problem = `${ineffective} variantes de SD sin el DPI pedido efectivo`;
      if (problem !== null || pairs.length !== sdVariants.length) {
        sd = {
          ...compareSdTotals(pairs),
          outcome: "indeterminado",
          reason: problem ?? "faltan variantes de SD",
        };
        indeterminate.push({ corpus: "SD", criterion: 1, detail: sd.reason });
      } else {
        sd = compareSdTotals(pairs);
        if (sd.outcome === "no-pasa")
          failures.push({ corpus: "SD", criterion: 1, detail: sd.reason });
        else if (sd.outcome === "indeterminado")
          indeterminate.push({ corpus: "SD", criterion: 1, detail: sd.reason });
      }
    }
    if (role !== "control" && !threshold.official)
      indeterminate.push({
        corpus: "*",
        criterion: 2,
        detail: threshold.caveat ?? "umbral de cobertura no oficial",
      });
    if (role !== "control" && deciding.length > 0 && evaluatedCorpora === 0)
      indeterminate.push({
        corpus: "*",
        criterion: "celda",
        detail: "el brazo no es efectivo en ningún corpus que decide",
      });
    armSummaries[String(dpi)] = {
      dpi,
      role,
      verdict: null,
      failures,
      indeterminate,
      notEvaluatedCorpora: notEvaluated,
      sd,
      perCorpus,
    };
  }

  // §6.5: el brazo 150 tiene que perder algo que 300 detecta en un corpus que decide.
  let discriminantControlFailed: boolean | null = null;
  let discriminantNote: string | null = null;
  if (!arms.includes(DISCRIMINANT_DPI)) discriminantNote = "el brazo 150 no está en la matriz";
  else {
    const allCells = deciding.map((corpus) => ({
      corpus,
      cell: read(corpus, DISCRIMINANT_DPI, 1),
    }));
    // Solo cuentan los corpus donde 150 fue efectivo: donde no se despachó a 150 dpi, no demuestra nada.
    const cells = allCells.filter(
      ({ cell }) => cell === null || !cell.valid || cellEffectiveness(cell).kind === "all",
    );
    const incomplete = cells.filter(({ cell }) => cell === null || !cell.valid);
    if (allCells.length === 0) discriminantNote = "no hay corpus que decida en la matriz";
    else if (cells.length === 0)
      discriminantNote = "ningún corpus que decide tiene 150 efectivo: no se puede concluir";
    else if (incomplete.length > 0)
      discriminantNote = `no se puede concluir: celdas del brazo 150 ausentes o inválidas (${incomplete
        .map(({ corpus }) => corpus)
        .join(", ")})`;
    else if (cells.some(({ cell }) => cell !== null && cell.entitiesVsReference === null))
      discriminantNote = "falta la comparación de entidades en alguna celda del brazo 150";
    else {
      const anyLoss = cells.some(
        ({ cell }) => cell !== null && (cell.entitiesVsReference?.totals.missed ?? 0) > 0,
      );
      discriminantControlFailed = !anyLoss;
      discriminantNote = anyLoss
        ? null
        : "el brazo 150 no perdió ninguna entidad que el control 300 detecta en ningún corpus que decide: la métrica de calidad no discrimina; la campaña se detiene y se revisa el instrumento";
    }
  }
  const discriminantOk = discriminantControlFailed === false;

  // §6.6: veredicto de cada brazo.
  for (const arm of Object.values(armSummaries)) {
    if (arm.role === "control") continue;
    let verdict: Verdict;
    if (!matrixComplete) verdict = "parcial";
    else if (arm.failures.length > 0) verdict = "no-pasa";
    else if (arm.indeterminate.length > 0) verdict = "indeterminado";
    else if (!discriminantOk) verdict = "indeterminado";
    else verdict = "pasa";
    const extra: Reason[] = [];
    if (matrixComplete && verdict === "indeterminado" && arm.indeterminate.length === 0)
      extra.push({
        corpus: "*",
        criterion: "control",
        detail: discriminantNote ?? "el control discriminante no está en orden",
      });
    if (!matrixComplete)
      for (const reason of matrixReasons)
        extra.push({ corpus: "*", criterion: "matriz", detail: reason });
    armSummaries[String(arm.dpi)] = {
      ...arm,
      verdict,
      indeterminate: [...arm.indeterminate, ...extra],
    };
  }

  const corpusFacts: Record<
    string,
    { inkRatio: { min: number; max: number } | null; note: string | null }
  > = {};
  for (const corpus of corpora) {
    const ratios: number[] = [];
    for (const key of expectedCellKeys([corpus], arms)) {
      const cell = read(key.corpus, key.dpi, key.repetition);
      if (cell !== null && cell.valid)
        for (const osd of cell.chain?.osd ?? []) ratios.push(osd.inkRatio);
    }
    corpusFacts[corpus] = {
      inkRatio: ratios.length === 0 ? null : { min: Math.min(...ratios), max: Math.max(...ratios) },
      note: isSdVariant(corpus) ? SD_INK_NOTE : null,
    };
  }

  const sleepDetection = input.sleepDetection ?? SLEEP_NOT_REPORTED;
  const caveats = [
    ...(threshold.caveat === null
      ? []
      : [{ id: threshold.caveat.split(":")[0] ?? "min-coverage", note: threshold.caveat }]),
    ...(controlInconsistencies.length === 0
      ? []
      : [
          {
            id: "control-inconsistente",
            note: `brazo no efectivo (mismo despacho que 300) que difiere del control en entidades: ${controlInconsistencies.map((c) => `${c.arm}@${c.corpus}`).join(", ")}`,
          },
        ]),
    ...(corpora.includes("S6")
      ? []
      : [
          {
            id: "s6-ausente",
            note: "S6 no está en la matriz: no se informa dónde está el límite de la letra chica",
          },
        ]),
    ...(input.caveats ?? []),
  ];
  return {
    phase: "dpi-down-quality",
    decisionRule: {
      source: "docs/roadmap/ocr/OCR_DPI_Descendente_Campana_Plan.md §6",
      minCoverageRaw: threshold.raw,
      minCoverage,
      minCoverageOfficial: threshold.official,
      minCoverageNote: threshold.official
        ? `umbral oficial ${OFFICIAL_MIN_COVERAGE} (decisión del humano, 2026-10-01)`
        : "umbral de exploración: ningún brazo puede pasar",
    },
    matrix: { complete: matrixComplete, reasons: matrixReasons, missingCorpora },
    corpora: { evaluated: deciding, nonDeciding, skipped: input.skippedCorpora },
    controlVariation: {
      perCorpus: variationPerCorpus,
      overallCoverage: overallControlCoverage,
      note: "Cobertura de las cajas de la repetición 2 del brazo 300 sobre las de la repetición 1 (dos corridas idénticas). Es la referencia de cuánto varía el propio control.",
    },
    controlFloor,
    controlIncompleteCorpora: controlIncomplete,
    controlInconsistencies,
    thresholdBelowControlVariation:
      overallControlCoverage === null ? null : overallControlCoverage.min < minCoverage,
    arms: armSummaries,
    discriminantControlFailed,
    discriminantControlNote: discriminantNote,
    campaignShouldStop: discriminantControlFailed === true,
    nonDecidingCorpusReport: nonDecidingReport,
    fixtureHashMismatches,
    corpusFacts,
    invalidCells,
    missingCells,
    sleepDetection,
    validityCaveats: validityCaveatsOf(sleepDetection, caveats),
    complete: corpora.length > 0 && missingCells.length === 0 && invalidCells.length === 0,
  };
}

/** Línea final: veredictos, matriz, control discriminante, brazos no evaluados y salvedades. */
export function dpiDownResultLine(summary: DpiDownSummary): string {
  const verdicts = Object.values(summary.arms)
    .filter((arm) => arm.verdict !== null)
    .map((arm) => `${arm.dpi}=${arm.verdict}`)
    .join(" ");
  const codes = summary.validityCaveats.map((caveat) => caveat.split(":")[0] ?? caveat);
  const notEvaluated = Object.values(summary.arms)
    .flatMap((arm) => arm.notEvaluatedCorpora.map((corpus) => `${arm.dpi}@${corpus}`))
    .join(",");
  const parts = [
    `complete=${summary.complete}`,
    `matriz=${summary.matrix.complete ? "completa" : `PARCIAL(${summary.matrix.reasons.length})`}`,
    verdicts,
    `cobertura=${summary.decisionRule.minCoverage}${summary.decisionRule.minCoverageOfficial ? "" : "(EXPLORATORIO)"}`,
    `discriminantControlFailed=${String(summary.discriminantControlFailed)}`,
    summary.campaignShouldStop ? "DETENER-CAMPANA=true" : "",
    summary.fixtureHashMismatches.length > 0
      ? `FIXTURE-REGENERADO=${summary.fixtureHashMismatches.map((m) => m.corpus).join(",")}`
      : "",
    notEvaluated === "" ? "" : `no-evaluado=${notEvaluated}`,
    summary.validityCaveats.some((c) => c.startsWith("s6-ausente")) ? "S6-AUSENTE" : "",
    `salvedades=${codes.length}${codes.length > 0 ? ` [${codes.join(", ")}]` : ""}`,
  ];
  return parts.filter((part) => part !== "").join(" ");
}
