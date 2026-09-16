/**
 * `support/marginInk.ts` — tipado, colector, invariantes y agregación del
 * análisis de tinta residual de márgenes
 * (`docs/roadmap/Margenes_Menos_Pixeles_Handoff.md` §2). El instrumento que
 * PRODUCE los registros crudos vive en un patch descartable sobre
 * `ocr-engine/src/worker/kernel.ts` + `ocr.engine.ts` (`instrument.patch`,
 * nunca commiteado, revertido al terminar la campaña); este módulo es la
 * única pieza ENTREGABLE del instrumento — tipa esos registros, los saca del
 * worker al host por el mismo patrón que `__anonlyMemoryRun`
 * (`memoryProfile.ts#installRunCollector`) y
 * `__anonlyImageDataProfile` (`imageDataProfile.ts`), valida sus invariantes
 * (Handoff §2.4) y agrega la correlación que decide (Handoff §3) más el
 * histograma de residuo (Handoff §5.2/§5.3).
 *
 * Un instrumento que mide mal no tira error, devuelve un número (Handoff,
 * advertencias operativas): por eso `parseMarginInkStripRecord` lanza ante
 * una forma no reconocida en vez de devolver un default silencioso (mismo
 * criterio que `parseImageDataProfilePageRecord`), y
 * `analyzeMarginInk`/`checkMarginInkInvariants` lanzan si los invariantes del
 * §2.4 no se cumplen en vez de agregar igual sobre datos inconsistentes.
 *
 * La transformación inversa de puntos de página a píxeles de la tira (Handoff
 * §2.3, el riesgo técnico de esta fase) NO se valida acá con un test
 * sintético: se valida con el contador `projectionMismatches`, que el propio
 * instrumento del kernel calcula reproyectando cada caja hacia adelante con
 * las mismas funciones privadas (`unrotateBbox`/`toPagePoints`) que usa para
 * sus propios candidatos, y comparando contra el punto de partida (Handoff
 * §6: "no con un test en tests/"). Este módulo solo parsea y agrega ese
 * contador ya calculado.
 */

import type { Page } from "@playwright/test";

import { percentile } from "./imageDataProfile.js";

// ─── Tipos del registro crudo (Handoff §2.2/§2.4) ──────────────────────────

export type MarginInkStrip = "left" | "right";

/** Las cuatro dilataciones medidas (Handoff §2.2: "d = 0, 1, 2, 3"). Fijas
 * a propósito — el Handoff autoriza medir la curva, no elegir un `d`. */
export const MARGIN_INK_DILATIONS = [0, 1, 2, 3] as const;
export type MarginInkDilationIndex = 0 | 1 | 2 | 3;

/**
 * Caja en píxeles de la tira, formato `(x0,y0,x1,y1)` — el que pide la tabla
 * del Handoff §2.2, distinto del `{x,y,width,height}` de `BoundingBox` de
 * `@anonly/shared` porque este tipo es diagnóstico de `tests/`, no un
 * contrato público del Core.
 */
export interface MarginInkBoxPx {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Un registro por tira (una de las dos por página, izquierda/derecha).
 *
 * Campos que no están en la tabla del Handoff §2.2 y por qué se agregan:
 * - `documentId`/`pageIndex`/`orientation`: identidad, necesaria para el
 *   invariante de unicidad de §2.4 punto 3 ("Unicidad de registros por
 *   (documentId, pageIndex, stripIndex)") y para reportar página/lado en el
 *   Handoff §3 y §5.4.
 * - `stripWidth`/`stripHeight`: dimensiones en píxeles de la tira, sin las
 *   cuales el invariante de §2.4 punto 2 ("`inkBox` contenida en la tira") no
 *   es verificable — el registro no tendría con qué comparar.
 * - `addedWordTexts`: el Handoff §3 exige reportar, para una tira
 *   descalificante, "las palabras concretas que aportó" — `wordsAddedByThisStrip`
 *   solo es un conteo, así que hace falta el texto para poder citarlas.
 */
export interface MarginInkStripRecord {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly orientation: 0 | 90 | 180 | 270;
  /** Cuál de las dos tiras de la página — cumple el rol que el Handoff §2.4
   * llama "stripIndex" en la tupla de unicidad. */
  readonly strip: MarginInkStrip;
  readonly stripWidth: number;
  readonly stripHeight: number;
  readonly inkPixels: number;
  readonly inkBox: MarginInkBoxPx | null;
  readonly maskedWordBoxes: number;
  /** Índice = dilatación en píxeles (0..3), ver `MARGIN_INK_DILATIONS`. */
  readonly residualInkPixels: readonly [number, number, number, number];
  readonly residualBox: readonly [
    MarginInkBoxPx | null,
    MarginInkBoxPx | null,
    MarginInkBoxPx | null,
    MarginInkBoxPx | null,
  ];
  readonly wouldSkipByWhiteGate: boolean;
  readonly wordsAddedByThisStrip: number;
  readonly addedWordTexts: ReadonlyArray<string>;
  readonly projectionMismatches: number;
}

// ─── Parseo defensivo (mismo criterio que ADR-055 §3 / imageDataProfile.ts) ─

export class MarginInkParseError extends Error {
  constructor(reason: string) {
    super(`MarginInkStripRecord con forma no reconocida: ${reason}`);
    this.name = "MarginInkParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertField(condition: boolean, reason: string): void {
  if (!condition) throw new MarginInkParseError(reason);
}

function describeUnknown(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBoxOrNull(value: unknown, path: string): MarginInkBoxPx | null {
  if (value === null) return null;
  assertField(isRecord(value), `${path} no es ni null ni un objeto`);
  const record = value as Record<string, unknown>;
  const fields = ["x0", "y0", "x1", "y1"] as const;
  for (const field of fields) {
    assertField(isFiniteNumber(record[field]), `${path}.${field} no es numérico`);
  }
  const box = {
    x0: record.x0 as number,
    y0: record.y0 as number,
    x1: record.x1 as number,
    y1: record.y1 as number,
  };
  assertField(box.x1 >= box.x0 && box.y1 >= box.y0, `${path} tiene x1<x0 o y1<y0`);
  return box;
}

function parseResidualTuple(
  value: unknown,
  path: string,
): readonly [number, number, number, number] {
  assertField(Array.isArray(value), `${path} no es un array`);
  const arr = value as ReadonlyArray<unknown>;
  assertField(arr.length === 4, `${path} no tiene longitud 4 (tiene ${arr.length})`);
  const parsed = arr.map((entry, index) => {
    assertField(
      isFiniteNumber(entry) && Number.isInteger(entry) && entry >= 0,
      `${path}[${index}] no es un entero >= 0: ${describeUnknown(entry)}`,
    );
    return entry as number;
  });
  return [parsed[0] as number, parsed[1] as number, parsed[2] as number, parsed[3] as number];
}

function parseBoxTuple(
  value: unknown,
  path: string,
): readonly [
  MarginInkBoxPx | null,
  MarginInkBoxPx | null,
  MarginInkBoxPx | null,
  MarginInkBoxPx | null,
] {
  assertField(Array.isArray(value), `${path} no es un array`);
  const arr = value as ReadonlyArray<unknown>;
  assertField(arr.length === 4, `${path} no tiene longitud 4 (tiene ${arr.length})`);
  const parsed = arr.map((entry, index) => parseBoxOrNull(entry, `${path}[${index}]`));
  return [parsed[0] ?? null, parsed[1] ?? null, parsed[2] ?? null, parsed[3] ?? null];
}

function parseStringArray(value: unknown, path: string): ReadonlyArray<string> {
  assertField(Array.isArray(value), `${path} no es un array`);
  const arr = value as ReadonlyArray<unknown>;
  return arr.map((entry, index) => {
    assertField(
      typeof entry === "string",
      `${path}[${index}] no es string: ${describeUnknown(entry)}`,
    );
    return entry as string;
  });
}

/**
 * Decodifica un valor `unknown` (leído de `globalThis.__anonlyMarginInkAnalysis`
 * o de un JSON crudo de `.measure/`) a `MarginInkStripRecord`. Lanza
 * `MarginInkParseError` ante cualquier forma no reconocida — nunca devuelve
 * un registro vacío o parcial en silencio (Handoff: "un instrumento que mide
 * mal no tira error").
 */
export function parseMarginInkStripRecord(value: unknown): MarginInkStripRecord {
  assertField(isRecord(value), "no es un objeto");
  const record = value as Record<string, unknown>;

  assertField(
    typeof record.documentId === "string" && record.documentId.length > 0,
    "documentId inválido",
  );
  assertField(
    isFiniteNumber(record.pageIndex) && Number.isInteger(record.pageIndex) && record.pageIndex >= 0,
    "pageIndex inválido",
  );
  assertField(
    record.orientation === 0 ||
      record.orientation === 90 ||
      record.orientation === 180 ||
      record.orientation === 270,
    `orientation inválida: ${describeUnknown(record.orientation)}`,
  );
  assertField(
    record.strip === "left" || record.strip === "right",
    `strip inválido: ${describeUnknown(record.strip)}`,
  );
  assertField(isFiniteNumber(record.stripWidth) && record.stripWidth > 0, "stripWidth inválido");
  assertField(isFiniteNumber(record.stripHeight) && record.stripHeight > 0, "stripHeight inválido");
  assertField(
    isFiniteNumber(record.inkPixels) && Number.isInteger(record.inkPixels) && record.inkPixels >= 0,
    "inkPixels inválido",
  );
  const inkBox = parseBoxOrNull(record.inkBox, "inkBox");
  assertField(
    isFiniteNumber(record.maskedWordBoxes) &&
      Number.isInteger(record.maskedWordBoxes) &&
      record.maskedWordBoxes >= 0,
    "maskedWordBoxes inválido",
  );
  const residualInkPixels = parseResidualTuple(record.residualInkPixels, "residualInkPixels");
  const residualBox = parseBoxTuple(record.residualBox, "residualBox");
  assertField(typeof record.wouldSkipByWhiteGate === "boolean", "wouldSkipByWhiteGate no booleano");
  assertField(
    isFiniteNumber(record.wordsAddedByThisStrip) &&
      Number.isInteger(record.wordsAddedByThisStrip) &&
      record.wordsAddedByThisStrip >= 0,
    "wordsAddedByThisStrip inválido",
  );
  const addedWordTexts = parseStringArray(record.addedWordTexts, "addedWordTexts");
  assertField(
    addedWordTexts.length === record.wordsAddedByThisStrip,
    `addedWordTexts (${addedWordTexts.length}) no coincide con wordsAddedByThisStrip (${describeUnknown(record.wordsAddedByThisStrip)})`,
  );
  assertField(
    isFiniteNumber(record.projectionMismatches) &&
      Number.isInteger(record.projectionMismatches) &&
      record.projectionMismatches >= 0,
    "projectionMismatches inválido",
  );

  return {
    documentId: record.documentId as string,
    pageIndex: record.pageIndex as number,
    orientation: record.orientation as 0 | 90 | 180 | 270,
    strip: record.strip as MarginInkStrip,
    stripWidth: record.stripWidth as number,
    stripHeight: record.stripHeight as number,
    inkPixels: record.inkPixels as number,
    inkBox,
    maskedWordBoxes: record.maskedWordBoxes as number,
    residualInkPixels,
    residualBox,
    wouldSkipByWhiteGate: record.wouldSkipByWhiteGate as boolean,
    wordsAddedByThisStrip: record.wordsAddedByThisStrip as number,
    addedWordTexts,
    projectionMismatches: record.projectionMismatches as number,
  };
}

// ─── Colector host-side (mismo patrón que installImageDataProfileCollector) ─

/**
 * Clave del `ctx.cache` donde el `ocr.engine.ts` instrumentado deposita el
 * array de registros de la página (0, 1 o 2 tiras), junto a los depósitos ya
 * existentes de `ocr-words:...` (T-5) e `imagedata-profile:...` (fase
 * anterior) — misma correlación documentId+pageIndex, sin canal nuevo
 * (Handoff §2.1). El string se duplica LITERAL dentro de
 * `installMarginInkCollector` porque `page.evaluate` serializa la función y
 * no puede importar este símbolo en runtime (mismo motivo que
 * `imageDataProfileCacheKey`).
 */
export function marginInkCacheKey(documentId: string, pageIndex: number): string {
  return `margin-ink:${documentId}:${pageIndex}`;
}

declare global {
  // `var` es la única sintaxis válida para una ambient declaration dentro de
  // `declare global` — mismo patrón que `__anonlyMemoryRun`/`__anonlyImageDataProfile`.
  var __anonlyMarginInkAnalysis: unknown[] | undefined;
}

/**
 * Instala el colector en el renderer (Handoff §2.1: "reutilizar
 * extraCollectors/postRunCapture de memoryProfile.ts"): se pasa como
 * `extraCollectors` a `runImport`, o se llama directo para el humo/campaña
 * de este spec (igual que `installImageDataProfileCollector`). Suscribe al
 * evento público existente `OCR_PAGE_FINISHED` (sin canal nuevo) y, para cada
 * página, lee el array de registros de tira que el `ocr.engine.ts`
 * instrumentado dejó en `ctx.cache` bajo `marginInkCacheKey`, aplanándolo:
 * cada tira se empuja como una entrada independiente de
 * `globalThis.__anonlyMarginInkAnalysis` (la unidad del invariante de
 * unicidad de §2.4 es la TIRA, no la página).
 */
export async function installMarginInkCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente: ¿VITE_E2E=1 en el build?");
    const coreWithOcr = core as typeof core & {
      readonly engines: {
        readonly ocr: {
          readonly ctx?: {
            readonly cache?: {
              readonly get: <T>(key: string) => T | undefined;
            };
          };
        };
      };
    };

    // Mismo bug ya corregido en `installImageDataProfileCollector` (campaña
    // 2026-09-15): `core.bus.on` no se puede des-registrar desde acá, y este
    // colector se reinstala una vez por corrida. Capturar `collected` por
    // closure en el momento de ESTA instalación (no releer
    // `globalThis.__anonlyMarginInkAnalysis` dentro del handler) evita que un
    // handler de una instalación previa siga escribiendo sobre el array
    // nuevo y duplique cada tira.
    const collected: unknown[] = [];
    globalThis.__anonlyMarginInkAnalysis = collected;

    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const page2 = payload as { documentId?: unknown; pageIndex?: unknown };
      if (typeof page2.documentId !== "string" || typeof page2.pageIndex !== "number") return;
      const ocr = coreWithOcr.engines.ocr;
      // Literal duplicado de `marginInkCacheKey` — ver comentario de esa
      // función sobre por qué no se puede importar acá.
      const key = `margin-ink:${page2.documentId}:${page2.pageIndex}`;
      const stripsForPage = ocr.ctx?.cache?.get<unknown>(key);
      if (Array.isArray(stripsForPage)) {
        for (const stripRecord of stripsForPage) collected.push(stripRecord);
      }
    });
  });
}

/**
 * Lee y decodifica los registros acumulados. Cada entrada pasa por
 * `parseMarginInkStripRecord` — una forma no reconocida hace fallar la
 * lectura completa.
 */
export async function readMarginInkAnalysis(
  page: Page,
): Promise<ReadonlyArray<MarginInkStripRecord>> {
  const raw = await page.evaluate(() => globalThis.__anonlyMarginInkAnalysis ?? []);
  return raw.map((entry) => parseMarginInkStripRecord(entry));
}

// ─── Invariantes (Handoff §2.4) ─────────────────────────────────────────────

export interface MarginInkViolation {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly strip: MarginInkStrip;
  readonly rule:
    | "residualMonotonicNonIncreasing"
    | "residualWithinInkPixels"
    | "residualBoxWithinInkBox"
    | "inkBoxWithinStrip"
    | "uniqueRecordPerStrip"
    | "whiteGateImpliesZeroInk";
  readonly detail: string;
}

function boxWithin(inner: MarginInkBoxPx, outer: MarginInkBoxPx): boolean {
  return (
    inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1
  );
}

/** Invariante 1 (Handoff §2.4): `residualInkPixels[d] <= inkPixels` para todo
 * `d`, y monótono no creciente en `d`. */
function checkResidualMonotonic(
  record: MarginInkStripRecord,
  violations: MarginInkViolation[],
): void {
  let previous = record.inkPixels;
  for (let d = 0; d < MARGIN_INK_DILATIONS.length; d++) {
    const value = record.residualInkPixels[d] as number;
    if (value > record.inkPixels) {
      violations.push({
        documentId: record.documentId,
        pageIndex: record.pageIndex,
        strip: record.strip,
        rule: "residualWithinInkPixels",
        detail: `residualInkPixels[${d}]=${value} > inkPixels=${record.inkPixels}`,
      });
    }
    if (value > previous) {
      violations.push({
        documentId: record.documentId,
        pageIndex: record.pageIndex,
        strip: record.strip,
        rule: "residualMonotonicNonIncreasing",
        detail: `residualInkPixels[${d}]=${value} > residualInkPixels[${d - 1}]=${previous} (debería ser no creciente en d)`,
      });
    }
    previous = value;
  }
}

/** Invariante 2 (Handoff §2.4): `residualBox[d]` contenida en `inkBox`;
 * `inkBox` contenida en la tira. */
function checkBoxContainment(record: MarginInkStripRecord, violations: MarginInkViolation[]): void {
  const stripBox: MarginInkBoxPx = { x0: 0, y0: 0, x1: record.stripWidth, y1: record.stripHeight };
  if (record.inkBox !== null && !boxWithin(record.inkBox, stripBox)) {
    violations.push({
      documentId: record.documentId,
      pageIndex: record.pageIndex,
      strip: record.strip,
      rule: "inkBoxWithinStrip",
      detail: `inkBox ${JSON.stringify(record.inkBox)} no está contenida en la tira (${record.stripWidth}x${record.stripHeight})`,
    });
  }
  for (let d = 0; d < MARGIN_INK_DILATIONS.length; d++) {
    // `?? null`: indexar una tupla `readonly [...]` con una variable `number`
    // (no un literal 0|1|2|3) hace que `noUncheckedIndexedAccess` agregue
    // `| undefined` a la inferencia aunque el índice sea siempre válido —
    // colapsarlo a `null` es seguro (la tupla nunca tiene huecos) y evita un
    // `as` innecesario.
    const residualBox = record.residualBox[d] ?? null;
    if (residualBox === null) continue;
    if (record.inkBox === null) {
      violations.push({
        documentId: record.documentId,
        pageIndex: record.pageIndex,
        strip: record.strip,
        rule: "residualBoxWithinInkBox",
        detail: `residualBox[${d}] presente (${JSON.stringify(residualBox)}) pero inkBox es null`,
      });
      continue;
    }
    if (!boxWithin(residualBox, record.inkBox)) {
      violations.push({
        documentId: record.documentId,
        pageIndex: record.pageIndex,
        strip: record.strip,
        rule: "residualBoxWithinInkBox",
        detail: `residualBox[${d}] ${JSON.stringify(residualBox)} no está contenida en inkBox ${JSON.stringify(record.inkBox)}`,
      });
    }
  }
}

/**
 * Invariante 4 (Handoff §2.4): `wouldSkipByWhiteGate === true` implica
 * `inkPixels === 0`. El Handoff es explícito: si una tira real lo viola, ESO
 * es un hallazgo sobre ADR-162 que se reporta — el invariante no se afloja
 * para que pase. Por eso sigue lanzando igual que los otros tres: la
 * distinción "hallazgo vs. bug del instrumento" la hace quien lee el reporte
 * de la corrida, no este chequeo.
 */
function checkWhiteGateImpliesZeroInk(
  record: MarginInkStripRecord,
  violations: MarginInkViolation[],
): void {
  if (record.wouldSkipByWhiteGate && record.inkPixels !== 0) {
    violations.push({
      documentId: record.documentId,
      pageIndex: record.pageIndex,
      strip: record.strip,
      rule: "whiteGateImpliesZeroInk",
      detail:
        `wouldSkipByWhiteGate=true pero inkPixels=${record.inkPixels} — hallazgo sobre ADR-162 ` +
        `(Handoff §2.4 punto 4: no se ajusta el invariante para que pase).`,
    });
  }
}

/** Invariante 3 (Handoff §2.4): unicidad de registros por
 * (documentId, pageIndex, strip) — mismo motivo que
 * `checkUniqueRecordsPerPage` de `imageDataProfile.ts`: un duplicado íntegro
 * es internamente consistente y ningún chequeo por-registro lo detecta. */
function checkUniqueRecordsPerStrip(
  records: ReadonlyArray<MarginInkStripRecord>,
  violations: MarginInkViolation[],
): void {
  const counts = new Map<string, { readonly record: MarginInkStripRecord; count: number }>();
  for (const record of records) {
    const key = `${record.documentId}::${record.pageIndex}::${record.strip}`;
    const existing = counts.get(key);
    counts.set(key, { record, count: (existing?.count ?? 0) + 1 });
  }
  for (const { record, count } of counts.values()) {
    if (count > 1) {
      violations.push({
        documentId: record.documentId,
        pageIndex: record.pageIndex,
        strip: record.strip,
        rule: "uniqueRecordPerStrip",
        detail: `aparece ${count} veces en el lote agregado (esperado 1) — mismo documentId+pageIndex+strip repetido`,
      });
    }
  }
}

export function checkMarginInkInvariants(
  records: ReadonlyArray<MarginInkStripRecord>,
): ReadonlyArray<MarginInkViolation> {
  const violations: MarginInkViolation[] = [];
  checkUniqueRecordsPerStrip(records, violations);
  for (const record of records) {
    checkResidualMonotonic(record, violations);
    checkBoxContainment(record, violations);
    checkWhiteGateImpliesZeroInk(record, violations);
  }
  return violations;
}

export class MarginInkInvariantError extends Error {
  constructor(public readonly violations: ReadonlyArray<MarginInkViolation>) {
    super(
      `${violations.length} violación(es) de invariante en el análisis de tinta de márgenes:\n` +
        violations
          .map(
            (v) =>
              `  - [doc=${v.documentId} page=${v.pageIndex} strip=${v.strip}] ${v.rule}: ${v.detail}`,
          )
          .join("\n"),
    );
    this.name = "MarginInkInvariantError";
  }
}

// ─── La correlación que decide (Handoff §3) ────────────────────────────────

export interface MarginInkDisqualifyingRow {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly strip: MarginInkStrip;
  readonly wordsAddedByThisStrip: number;
  readonly addedWordTexts: ReadonlyArray<string>;
}

export interface MarginInkCorrelationCell {
  readonly residualZero: boolean;
  readonly wordsAdded: boolean;
  readonly count: number;
}

export interface MarginInkCorrelation {
  /** Las cuatro celdas de la tabla del Handoff §3, sobre `d = 0`. */
  readonly cells: ReadonlyArray<MarginInkCorrelationCell>;
  /**
   * Filas de la celda (residualZero=true, wordsAdded=true) — Handoff §3:
   * "Descalifica I-1 en su forma exacta". Una sola fila acá es un resultado
   * publicable, no un error del instrumento.
   */
  readonly disqualifyingRows: ReadonlyArray<MarginInkDisqualifyingRow>;
}

/**
 * Cruza, por cada tira, `residualInkPixels[0] === 0` contra
 * `wordsAddedByThisStrip > 0` (Handoff §3). Opera sobre `d = 0` exactamente
 * — la curva `d = 0..3` es diagnóstico aparte (Handoff §2.2), no reemplaza
 * esta tabla.
 */
export function computeMarginInkCorrelation(
  records: ReadonlyArray<MarginInkStripRecord>,
): MarginInkCorrelation {
  const cellCounts = new Map<string, number>();
  const disqualifyingRows: MarginInkDisqualifyingRow[] = [];

  for (const record of records) {
    const residualZero = (record.residualInkPixels[0] as number) === 0;
    const wordsAdded = record.wordsAddedByThisStrip > 0;
    const key = `${String(residualZero)}:${String(wordsAdded)}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
    if (residualZero && wordsAdded) {
      disqualifyingRows.push({
        documentId: record.documentId,
        pageIndex: record.pageIndex,
        strip: record.strip,
        wordsAddedByThisStrip: record.wordsAddedByThisStrip,
        addedWordTexts: record.addedWordTexts,
      });
    }
  }

  const cells: MarginInkCorrelationCell[] = [
    { residualZero: true, wordsAdded: false, count: cellCounts.get("true:false") ?? 0 },
    { residualZero: true, wordsAdded: true, count: cellCounts.get("true:true") ?? 0 },
    { residualZero: false, wordsAdded: false, count: cellCounts.get("false:false") ?? 0 },
    { residualZero: false, wordsAdded: true, count: cellCounts.get("false:true") ?? 0 },
  ];

  return { cells, disqualifyingRows };
}

// ─── Histograma de residuo (Handoff §5.2/§5.3) ─────────────────────────────

export interface MarginInkHistogramStats {
  readonly n: number;
  readonly min: number;
  readonly median: number;
  readonly p90: number;
  readonly max: number;
}

function histogramStats(values: ReadonlyArray<number>): MarginInkHistogramStats {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, min: NaN, median: NaN, p90: NaN, max: NaN };
  return {
    n: sorted.length,
    min: sorted[0] as number,
    median: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    max: sorted[sorted.length - 1] as number,
  };
}

/** Distribución de `residualInkPixels[d]` sobre el lote (Handoff §5.2: "el
 * histograma completo y los extremos, no solo la mediana"). */
export function computeResidualHistogram(
  records: ReadonlyArray<MarginInkStripRecord>,
  dilationIndex: MarginInkDilationIndex,
): MarginInkHistogramStats {
  return histogramStats(records.map((r) => r.residualInkPixels[dilationIndex] as number));
}

/** Fracción del alto de la tira que ocupa una caja — Handoff §5.3: "qué
 * fracción del alto de la tira ocupa inkBox y qué fracción ocupa
 * residualBox[0]". `null` si la caja no existe (sin tinta o sin residuo). */
export function fractionOfStripHeight(
  box: MarginInkBoxPx | null,
  stripHeight: number,
): number | null {
  if (box === null) return null;
  if (stripHeight <= 0)
    throw new MarginInkParseError(`stripHeight inválido para calcular fracción: ${stripHeight}`);
  return (box.y1 - box.y0) / stripHeight;
}

// ─── Punto de entrada agregado ──────────────────────────────────────────────

export interface MarginInkAnalysis {
  readonly correlation: MarginInkCorrelation;
  readonly residualHistogramByDilation: Readonly<
    Record<MarginInkDilationIndex, MarginInkHistogramStats>
  >;
  readonly totalProjectionMismatches: number;
}

/**
 * Valida los invariantes del Handoff §2.4 y agrega la correlación de §3 más
 * el histograma de residuo de §5.2. Lanza `MarginInkInvariantError` si algún
 * invariante no se cumple — agregar igual sobre un lote inconsistente sería
 * exactamente el modo de falla silenciosa que el Handoff advierte.
 */
export function analyzeMarginInk(records: ReadonlyArray<MarginInkStripRecord>): MarginInkAnalysis {
  const violations = checkMarginInkInvariants(records);
  if (violations.length > 0) throw new MarginInkInvariantError(violations);

  const totalProjectionMismatches = records.reduce((sum, r) => sum + r.projectionMismatches, 0);

  return {
    correlation: computeMarginInkCorrelation(records),
    residualHistogramByDilation: {
      0: computeResidualHistogram(records, 0),
      1: computeResidualHistogram(records, 1),
      2: computeResidualHistogram(records, 2),
      3: computeResidualHistogram(records, 3),
    },
    totalProjectionMismatches,
  };
}
