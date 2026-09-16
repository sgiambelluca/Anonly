/**
 * `support/imageDataProfile.ts` — tipado, colector y agregador del perfilado
 * de ImageData (`docs/roadmap/ImageData_Perfilado_Handoff.md` §2). El
 * instrumento que PRODUCE los registros crudos vive en un patch descartable
 * sobre `ocr-engine/src/worker/kernel.ts` + `ocr.engine.ts`
 * (`instrument.patch`, nunca commiteado); este módulo es la única pieza
 * ENTREGABLE del instrumento — tipa esos registros, los saca del worker al
 * host por el mismo patrón que `__anonlyMemoryRun` de `memoryProfile.ts`
 * (`installRunCollector`), y agrega por etapa.
 *
 * Un instrumento que mide mal no tira error, devuelve un número (Handoff,
 * advertencias operativas): por eso `parseImageDataProfilePageRecord` lanza
 * ante una forma no reconocida en vez de devolver un default silencioso
 * (mismo criterio que `decodeKernelOcrResult` de `ocr.engine.ts`, ADR-055
 * §3), y `aggregateImageDataProfile` lanza si los invariantes del §5 del
 * Handoff no se cumplen en vez de agregar igual sobre datos inconsistentes.
 */

import type { Page } from "@playwright/test";

// ─── Tipos del registro crudo (Handoff §2.2/§2.4) ──────────────────────────

/** Las diez etapas cronometradas por el instrumento (Handoff §2.2, tabla). */
export const IMAGE_DATA_PROFILE_STAGES = [
  "stripDecode",
  "whiteGate",
  "rotate",
  "copy",
  "canvas",
  "encode",
  "recognizeCall",
  "merge",
  "fullDecode",
  "pageRotate",
] as const;

export type ImageDataProfileStage = (typeof IMAGE_DATA_PROFILE_STAGES)[number];

const STAGE_SET: ReadonlySet<string> = new Set(IMAGE_DATA_PROFILE_STAGES);

export type ImageDataProfileStrip = "left" | "right";
export type ImageDataProfileRotation = 90 | 270;

/**
 * `main` = reconocimiento de la página completa (upright directo con blob, o
 * el camino lento con `fullDecode`+`pageRotate`+canvas+encode). `marginStrip`
 * = una de las hasta cuatro pasadas de ADR-121 sobre una franja de margen.
 */
export type ImageDataProfileScope = "main" | "marginStrip";

export interface ImageDataProfileInterval {
  readonly stage: ImageDataProfileStage;
  readonly scope: ImageDataProfileScope;
  readonly startMs: number;
  readonly endMs: number;
  /** Presente solo en intervalos de `scope: "marginStrip"`. */
  readonly strip?: ImageDataProfileStrip;
  readonly rotation?: ImageDataProfileRotation;
}

/**
 * Conteos de una pasada de margen concreta (una franja, una rotación). El
 * cuarto bucket (`discardedByEmptyText`) no está en la tabla de contadores
 * del Handoff §2.2 ("candidatas crudas, descartadas por confianza,
 * descartadas por solape, palabras añadidas") — se agrega para que la
 * contabilidad interna cierre exactamente (`candidatesRaw ===
 * discardedByConfidence + discardedByEmptyText + discardedByOverlap +
 * wordsAdded`, verificado en `imageDataProfile.test.ts`): el kernel
 * descarta también una candidata cuyo texto queda vacío tras `trim()`
 * (`kernel.ts`, `recognizeRotatedMargins`), un caso que ninguno de los otros
 * tres buckets cubre. Es un detalle de contabilidad del instrumento, no un
 * contador nuevo que el reporte de §5 tenga que exponer por separado.
 */
export interface ImageDataProfilePassCounters {
  readonly rotation: ImageDataProfileRotation;
  readonly candidatesRaw: number;
  readonly discardedByConfidence: number;
  readonly discardedByEmptyText: number;
  readonly discardedByOverlap: number;
  readonly wordsAdded: number;
}

export interface ImageDataProfileStripRecord {
  readonly strip: ImageDataProfileStrip;
  /** ADR-162: franja visualmente blanca u opaca en todo su alto — se saltea antes de cualquier rotación. */
  readonly skippedWhite: boolean;
  /** Vacío si `skippedWhite`; si no, exactamente dos entradas (90 y 270). */
  readonly passes: ReadonlyArray<ImageDataProfilePassCounters>;
}

/** Un registro por página principal (un job de `kernelRecognize`). */
export interface ImageDataProfilePageRecord {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly orientation: 0 | 90 | 180 | 270;
  readonly intervals: ReadonlyArray<ImageDataProfileInterval>;
  /** 0, 1 o 2 franjas — 0 solo si `stripWidth <= 0` (página angosta). */
  readonly strips: ReadonlyArray<ImageDataProfileStripRecord>;
}

// ─── Parseo defensivo (ADR-055 §3: nunca un default en silencio) ──────────

export class ImageDataProfileParseError extends Error {
  constructor(reason: string) {
    super(`ImageDataProfilePageRecord con forma no reconocida: ${reason}`);
    this.name = "ImageDataProfileParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertField(condition: boolean, reason: string): void {
  if (!condition) throw new ImageDataProfileParseError(reason);
}

/** Descripción legible de un valor `unknown` para un mensaje de error — nunca `String(value)` a ciegas, que para un objeto cae en `"[object Object]"`. */
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

function parseInterval(value: unknown, index: number): ImageDataProfileInterval {
  assertField(isRecord(value), `intervals[${index}] no es un objeto`);
  const record = value as Record<string, unknown>;
  assertField(
    typeof record.stage === "string" && STAGE_SET.has(record.stage),
    `intervals[${index}].stage inválido: ${describeUnknown(record.stage)}`,
  );
  assertField(
    record.scope === "main" || record.scope === "marginStrip",
    `intervals[${index}].scope inválido: ${describeUnknown(record.scope)}`,
  );
  assertField(
    typeof record.startMs === "number" && Number.isFinite(record.startMs),
    `intervals[${index}].startMs no numérico`,
  );
  assertField(
    typeof record.endMs === "number" && Number.isFinite(record.endMs),
    `intervals[${index}].endMs no numérico`,
  );
  assertField(
    (record.endMs as number) >= (record.startMs as number),
    `intervals[${index}] termina antes de empezar`,
  );
  if (record.strip !== undefined) {
    assertField(
      record.strip === "left" || record.strip === "right",
      `intervals[${index}].strip inválido: ${describeUnknown(record.strip)}`,
    );
  }
  if (record.rotation !== undefined) {
    assertField(
      record.rotation === 90 || record.rotation === 270,
      `intervals[${index}].rotation inválido: ${describeUnknown(record.rotation)}`,
    );
  }
  return {
    stage: record.stage as ImageDataProfileStage,
    scope: record.scope as ImageDataProfileScope,
    startMs: record.startMs as number,
    endMs: record.endMs as number,
    ...(record.strip !== undefined ? { strip: record.strip as ImageDataProfileStrip } : {}),
    ...(record.rotation !== undefined
      ? { rotation: record.rotation as ImageDataProfileRotation }
      : {}),
  };
}

function parsePassCounters(value: unknown, path: string): ImageDataProfilePassCounters {
  assertField(isRecord(value), `${path} no es un objeto`);
  const record = value as Record<string, unknown>;
  const numericFields = [
    "candidatesRaw",
    "discardedByConfidence",
    "discardedByEmptyText",
    "discardedByOverlap",
    "wordsAdded",
  ] as const;
  for (const field of numericFields) {
    assertField(
      typeof record[field] === "number" &&
        Number.isInteger(record[field]) &&
        (record[field] as number) >= 0,
      `${path}.${field} no es un entero >= 0`,
    );
  }
  assertField(
    record.rotation === 90 || record.rotation === 270,
    `${path}.rotation inválido: ${describeUnknown(record.rotation)}`,
  );
  const candidatesRaw = record.candidatesRaw as number;
  const accounted =
    (record.discardedByConfidence as number) +
    (record.discardedByEmptyText as number) +
    (record.discardedByOverlap as number) +
    (record.wordsAdded as number);
  assertField(
    accounted === candidatesRaw,
    `${path}: candidatesRaw (${candidatesRaw}) no cierra con los buckets de descarte (${accounted})`,
  );
  return {
    rotation: record.rotation as ImageDataProfileRotation,
    candidatesRaw,
    discardedByConfidence: record.discardedByConfidence as number,
    discardedByEmptyText: record.discardedByEmptyText as number,
    discardedByOverlap: record.discardedByOverlap as number,
    wordsAdded: record.wordsAdded as number,
  };
}

function parseStripRecord(value: unknown, index: number): ImageDataProfileStripRecord {
  assertField(isRecord(value), `strips[${index}] no es un objeto`);
  const record = value as Record<string, unknown>;
  assertField(
    record.strip === "left" || record.strip === "right",
    `strips[${index}].strip inválido: ${describeUnknown(record.strip)}`,
  );
  assertField(
    typeof record.skippedWhite === "boolean",
    `strips[${index}].skippedWhite no booleano`,
  );
  assertField(Array.isArray(record.passes), `strips[${index}].passes no es array`);
  const passesRaw = record.passes as ReadonlyArray<unknown>;
  if (record.skippedWhite) {
    assertField(
      passesRaw.length === 0,
      `strips[${index}] salteada por blanco pero tiene ${passesRaw.length} pasadas registradas`,
    );
  }
  const passes = passesRaw.map((pass, passIndex) =>
    parsePassCounters(pass, `strips[${index}].passes[${passIndex}]`),
  );
  return {
    strip: record.strip as ImageDataProfileStrip,
    skippedWhite: record.skippedWhite as boolean,
    passes,
  };
}

/**
 * Decodifica un valor `unknown` (leído de `globalThis.__anonlyImageDataProfile`
 * o de un JSON crudo de `.measure/`) a `ImageDataProfilePageRecord`. Lanza
 * `ImageDataProfileParseError` ante cualquier forma no reconocida — nunca
 * devuelve un registro vacío o parcial en silencio.
 */
export function parseImageDataProfilePageRecord(value: unknown): ImageDataProfilePageRecord {
  assertField(isRecord(value), "no es un objeto");
  const record = value as Record<string, unknown>;
  assertField(
    typeof record.documentId === "string" && record.documentId.length > 0,
    "documentId inválido",
  );
  assertField(
    typeof record.pageIndex === "number" &&
      Number.isInteger(record.pageIndex) &&
      record.pageIndex >= 0,
    "pageIndex inválido",
  );
  assertField(
    record.orientation === 0 ||
      record.orientation === 90 ||
      record.orientation === 180 ||
      record.orientation === 270,
    `orientation inválida: ${describeUnknown(record.orientation)}`,
  );
  assertField(Array.isArray(record.intervals), "intervals no es array");
  assertField(Array.isArray(record.strips), "strips no es array");

  const intervals = (record.intervals as ReadonlyArray<unknown>).map((interval, index) =>
    parseInterval(interval, index),
  );
  const strips = (record.strips as ReadonlyArray<unknown>).map((strip, index) =>
    parseStripRecord(strip, index),
  );

  return {
    documentId: record.documentId as string,
    pageIndex: record.pageIndex as number,
    orientation: record.orientation as 0 | 90 | 180 | 270,
    intervals,
    strips,
  };
}

// ─── Colector host-side (mismo patrón que `installRunCollector`) ──────────

/**
 * Clave del `ctx.cache` donde el `ocr.engine.ts` instrumentado deposita el
 * registro crudo del job, junto al depósito ya existente de
 * `ocr-words:${documentId}:${pageIndex}` (misma correlación
 * documentId+pageIndex, sin canal nuevo — Handoff §2.4). Se declara acá para
 * que quien lea este módulo vea el contrato completo, pero el string se
 * duplica LITERAL dentro de `installImageDataProfileCollector` porque
 * `page.evaluate` serializa la función y no puede importar este símbolo en
 * runtime (mismo motivo por el que `memoryProfile.ts` no importa
 * `EngineEvents`/`EventChannel` ahí adentro, solo strings).
 */
export function imageDataProfileCacheKey(documentId: string, pageIndex: number): string {
  return `imagedata-profile:${documentId}:${pageIndex}`;
}

declare global {
  // `var` es la única sintaxis válida para una ambient declaration dentro de
  // `declare global` — mismo patrón que `__anonlyMemoryRun` en memoryProfile.ts.
  var __anonlyImageDataProfile: unknown[] | undefined;
}

/**
 * Instala el colector en el renderer (Handoff §2.4): suscribe al evento
 * público existente `OCR_PAGE_FINISHED` (sin canal nuevo) y, para cada
 * página, lee el registro crudo que el `ocr.engine.ts` instrumentado dejó en
 * `ctx.cache` bajo `imageDataProfileCacheKey` — mismo mecanismo con el que
 * `memoryProfile.ts#installRunCollector` ya lee `ocr-words:...` para el Word[]
 * completo de T-5. Sin este patrón no hay forma de sacar el registro crudo
 * fuera del worker sin agregar un evento o un WorkerJobType nuevo.
 */
export async function installImageDataProfileCollector(page: Page): Promise<void> {
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

    // BUG corregido (campaña 2026-09-15, ver ImageData_Perfilado_Resultados.md
    // "corridas inválidas"): `core.bus.on` no se puede des-registrar desde
    // acá, y este colector se reinstala una vez por corrida (frío Y caliente,
    // Handoff §2.4 — mismo timing que `installRunCollector`). El handler de
    // la instalación FRÍA sigue vivo cuando la corrida CALIENTE dispara su
    // propio `OCR_PAGE_FINISHED`: si el handler leyera
    // `globalThis.__anonlyImageDataProfile` de nuevo en cada disparo, el
    // handler viejo escribiría en el array NUEVO (recién reseteado por la
    // instalación caliente) y cada página quedaría duplicada exactamente 2
    // veces en caliente. La captura por closure de `collected` —creado y
    // asignado a `globalThis` en EL MOMENTO de este `installX`, no releído
    // después— hace que el handler viejo seguía escribiendo en el array
    // VIEJO (frío), que nadie vuelve a leer: mismo patrón por el que
    // `installRunCollector` (memoryProfile.ts) no dobla su `run.ocrPages` en
    // caliente pese al mismo re-registro sin límpieza.
    const collected: unknown[] = [];
    globalThis.__anonlyImageDataProfile = collected;

    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const page2 = payload as { documentId?: unknown; pageIndex?: unknown };
      if (typeof page2.documentId !== "string" || typeof page2.pageIndex !== "number") return;
      const ocr = coreWithOcr.engines.ocr;
      // Literal duplicado de `imageDataProfileCacheKey` — ver comentario de
      // esa función sobre por qué no se puede importar acá.
      const key = `imagedata-profile:${page2.documentId}:${page2.pageIndex}`;
      const record = ocr.ctx?.cache?.get<unknown>(key);
      if (record !== undefined) {
        collected.push(record);
      }
    });
  });
}

/**
 * Lee y decodifica los registros acumulados. Cada entrada pasa por
 * `parseImageDataProfilePageRecord` — una forma no reconocida hace fallar la
 * lectura completa (Handoff: "un instrumento que mide mal no tira error").
 */
export async function readImageDataProfile(
  page: Page,
): Promise<ReadonlyArray<ImageDataProfilePageRecord>> {
  const raw = await page.evaluate(() => globalThis.__anonlyImageDataProfile ?? []);
  return raw.map((entry) => parseImageDataProfilePageRecord(entry));
}

// ─── Invariantes (Handoff §5) ──────────────────────────────────────────────

export interface ImageDataProfileViolation {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly rule:
    | "copySubsetOfRotate"
    | "noSiblingOverlap"
    | "passCountMatchesActiveStrips"
    | "uniqueRecordPerPage";
  readonly detail: string;
}

function passKey(strip: ImageDataProfileStrip, rotation: ImageDataProfileRotation): string {
  return `${strip}:${rotation}`;
}

/** `copy` ⊆ su `rotate` hermano (mismo strip+rotation, o ambos `scope: "main"` sin strip/rotation — ver nota del módulo sobre por qué `pageRotate` no lleva `copy` anidado). */
function checkCopySubsetOfRotate(
  record: ImageDataProfilePageRecord,
  violations: ImageDataProfileViolation[],
): void {
  const rotates = record.intervals.filter((i) => i.stage === "rotate");
  const copies = record.intervals.filter((i) => i.stage === "copy");
  for (const copy of copies) {
    const parent = rotates.find(
      (r) =>
        r.strip === copy.strip &&
        r.rotation === copy.rotation &&
        r.startMs <= copy.startMs &&
        r.endMs >= copy.endMs,
    );
    if (parent === undefined) {
      violations.push({
        documentId: record.documentId,
        pageIndex: record.pageIndex,
        rule: "copySubsetOfRotate",
        detail: `copy [${copy.startMs}, ${copy.endMs}] (strip=${String(copy.strip)}, rotation=${String(copy.rotation)}) no está contenido en ningún intervalo "rotate" hermano`,
      });
    }
  }
}

/** Ningún par de intervalos hermanos se solapa. "Hermanos" = todos los intervalos salvo `copy` (que anida deliberadamente dentro de su `rotate`, ver invariante anterior); el kernel es secuencial dentro de un job, así que dos intervalos no-`copy` nunca deberían superponerse. */
function checkNoSiblingOverlap(
  record: ImageDataProfilePageRecord,
  violations: ImageDataProfileViolation[],
): void {
  const siblings = [...record.intervals.filter((i) => i.stage !== "copy")].sort(
    (a, b) => a.startMs - b.startMs,
  );
  for (let i = 1; i < siblings.length; i++) {
    const prev = siblings[i - 1];
    const curr = siblings[i];
    if (prev === undefined || curr === undefined) continue;
    if (prev.endMs > curr.startMs) {
      violations.push({
        documentId: record.documentId,
        pageIndex: record.pageIndex,
        rule: "noSiblingOverlap",
        detail: `"${prev.stage}" [${prev.startMs}, ${prev.endMs}] se solapa con "${curr.stage}" [${curr.startMs}, ${curr.endMs}]`,
      });
    }
  }
}

/** Pasadas contadas = franjas activas × 2 rotaciones; franjas salteadas + activas = franjas inspeccionadas (esto último vale por construcción del tipo, se revalida igual por si el parseo dejó pasar algo raro). */
function checkPassCounts(
  record: ImageDataProfilePageRecord,
  violations: ImageDataProfileViolation[],
): void {
  const activeStrips = record.strips.filter((s) => !s.skippedWhite);
  const expectedTotalPasses = activeStrips.length * 2;
  const actualTotalPasses = activeStrips.reduce((sum, s) => sum + s.passes.length, 0);
  if (actualTotalPasses !== expectedTotalPasses) {
    violations.push({
      documentId: record.documentId,
      pageIndex: record.pageIndex,
      rule: "passCountMatchesActiveStrips",
      detail: `${activeStrips.length} franjas activas × 2 rotaciones = ${expectedTotalPasses} pasadas esperadas, pero hay ${actualTotalPasses}`,
    });
  }
  for (const strip of activeStrips) {
    const seen = new Set(strip.passes.map((p) => p.rotation));
    if (!seen.has(90) || !seen.has(270) || strip.passes.length !== 2) {
      violations.push({
        documentId: record.documentId,
        pageIndex: record.pageIndex,
        rule: "passCountMatchesActiveStrips",
        detail: `franja "${strip.strip}" activa no tiene exactamente las rotaciones {90,270}: [${strip.passes.map((p) => p.rotation).join(",")}]`,
      });
    }
  }
  // Chequeo estructural: el conjunto de pares (strip,rotation) de `passes` es
  // consistente con los intervalos "rotate" de ese mismo strip.
  const passKeys = new Set(
    activeStrips.flatMap((s) => s.passes.map((p) => passKey(s.strip, p.rotation))),
  );
  const rotateKeys = new Set(
    record.intervals
      .filter((i) => i.stage === "rotate" && i.strip !== undefined && i.rotation !== undefined)
      .map((i) =>
        passKey(i.strip as ImageDataProfileStrip, i.rotation as ImageDataProfileRotation),
      ),
  );
  if (passKeys.size !== rotateKeys.size || [...passKeys].some((k) => !rotateKeys.has(k))) {
    violations.push({
      documentId: record.documentId,
      pageIndex: record.pageIndex,
      rule: "passCountMatchesActiveStrips",
      detail: `pares (strip,rotation) de "passes" [${[...passKeys].join(";")}] no coinciden con los de intervalos "rotate" [${[...rotateKeys].join(";")}]`,
    });
  }
}

/**
 * Unicidad de registros por (documentId, pageIndex) en el LOTE agregado —
 * a diferencia de los tres invariantes anteriores, no mira adentro de un
 * registro sino a través de todos los que se están agregando juntos. Los
 * otros tres validan que cada registro sea internamente consistente, y un
 * registro DUPLICADO íntegro es internamente consistente por definición
 * (es una copia exacta de uno válido) — por eso ninguno de los tres lo
 * detecta. Ese fue exactamente el modo de falla real de la campaña
 * 2026-09-15 (`ImageData_Perfilado_Resultados.md`, "el bug del colector"):
 * `installImageDataProfileCollector` reinstalaba su listener en cada
 * corrida sin poder des-registrar el anterior, y en caliente el handler
 * viejo escribía sobre el array nuevo — cada página de esa corrida quedaba
 * duplicada exactamente 2 veces, con contenido IDÉNTICO, así que
 * `copySubsetOfRotate`/`noSiblingOverlap`/`passCountMatchesActiveStrips`
 * pasaban sin quejarse en las dos copias. `documentId` es un UUID nuevo por
 * carga de archivo (una corrida fría y su corrida caliente son cargas
 * DISTINTAS), así que ya cumple el rol de "fase" sin necesitar un campo
 * separado en el registro: agrupar por (documentId, pageIndex) sola alcanza
 * para separar frío de caliente y una sesión de la siguiente, siempre que
 * cada llamada a este chequeo reciba el lote de UNA corrida (como hace
 * `imagedata-profile-campaign.spec.ts`, que agrega frío y caliente por
 * separado) o de corridas con cargas de archivo distintas.
 */
function checkUniqueRecordsPerPage(
  records: ReadonlyArray<ImageDataProfilePageRecord>,
  violations: ImageDataProfileViolation[],
): void {
  const counts = new Map<string, { readonly record: ImageDataProfilePageRecord; count: number }>();
  for (const record of records) {
    const key = `${record.documentId}::${record.pageIndex}`;
    const existing = counts.get(key);
    counts.set(key, { record, count: (existing?.count ?? 0) + 1 });
  }
  for (const { record, count } of counts.values()) {
    if (count > 1) {
      violations.push({
        documentId: record.documentId,
        pageIndex: record.pageIndex,
        rule: "uniqueRecordPerPage",
        detail: `aparece ${count} veces en el lote agregado (esperado 1) — mismo documentId+pageIndex repetido`,
      });
    }
  }
}

export function checkImageDataProfileInvariants(
  records: ReadonlyArray<ImageDataProfilePageRecord>,
): ReadonlyArray<ImageDataProfileViolation> {
  const violations: ImageDataProfileViolation[] = [];
  checkUniqueRecordsPerPage(records, violations);
  for (const record of records) {
    checkCopySubsetOfRotate(record, violations);
    checkNoSiblingOverlap(record, violations);
    checkPassCounts(record, violations);
  }
  return violations;
}

export class ImageDataProfileInvariantError extends Error {
  constructor(public readonly violations: ReadonlyArray<ImageDataProfileViolation>) {
    super(
      `${violations.length} violación(es) de invariante en el perfil de ImageData:\n` +
        violations
          .map((v) => `  - [doc=${v.documentId} page=${v.pageIndex}] ${v.rule}: ${v.detail}`)
          .join("\n"),
    );
    this.name = "ImageDataProfileInvariantError";
  }
}

// ─── Agregación por etapa (mediana + p10/p90, nunca solo el promedio) ─────

export interface ImageDataProfileStageStats {
  readonly stage: ImageDataProfileStage;
  readonly n: number;
  readonly medianMs: number;
  readonly p10Ms: number;
  readonly p90Ms: number;
}

/** Interpolación lineal entre rangos, igual que `numpy.percentile(..., interpolation="linear")` — determinística y fácil de verificar a mano con datasets chicos. */
export function percentile(sortedAscending: ReadonlyArray<number>, p: number): number {
  if (sortedAscending.length === 0) return NaN;
  if (sortedAscending.length === 1) return sortedAscending[0] as number;
  const rank = (p / 100) * (sortedAscending.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lowerValue = sortedAscending[lower] as number;
  if (lower === upper) return lowerValue;
  const upperValue = sortedAscending[upper] as number;
  const weight = rank - lower;
  return lowerValue * (1 - weight) + upperValue * weight;
}

/**
 * Agrega duración por etapa, sumando TODAS las ocurrencias de esa etapa
 * (todas las franjas/rotaciones juntas). No devuelve una suma de etapas como
 * duración total: el Handoff §5 prohíbe presentar eso como tiempo de pared.
 */
export function aggregateStageDurations(
  records: ReadonlyArray<ImageDataProfilePageRecord>,
): ReadonlyArray<ImageDataProfileStageStats> {
  const byStage = new Map<ImageDataProfileStage, number[]>();
  for (const record of records) {
    for (const interval of record.intervals) {
      const list = byStage.get(interval.stage) ?? [];
      list.push(interval.endMs - interval.startMs);
      byStage.set(interval.stage, list);
    }
  }
  const stats: ImageDataProfileStageStats[] = [];
  for (const [stage, durations] of byStage) {
    const sorted = [...durations].sort((a, b) => a - b);
    stats.push({
      stage,
      n: sorted.length,
      medianMs: percentile(sorted, 50),
      p10Ms: percentile(sorted, 10),
      p90Ms: percentile(sorted, 90),
    });
  }
  return stats.sort((a, b) => a.stage.localeCompare(b.stage));
}

export interface ImageDataProfileCounters {
  readonly pagesObserved: number;
  readonly stripsInspected: number;
  readonly stripsSkippedWhite: number;
  readonly passesExecuted: number;
  readonly candidatesRaw: number;
  readonly discardedByConfidence: number;
  readonly discardedByEmptyText: number;
  readonly discardedByOverlap: number;
  readonly wordsAdded: number;
  /** Palabras añadidas discriminadas por franja y rotación (Handoff §2.2). */
  readonly wordsAddedByPass: Readonly<Record<string, number>>;
}

export function aggregateCounters(
  records: ReadonlyArray<ImageDataProfilePageRecord>,
): ImageDataProfileCounters {
  let stripsInspected = 0;
  let stripsSkippedWhite = 0;
  let passesExecuted = 0;
  let candidatesRaw = 0;
  let discardedByConfidence = 0;
  let discardedByEmptyText = 0;
  let discardedByOverlap = 0;
  let wordsAdded = 0;
  const wordsAddedByPass = new Map<string, number>();

  for (const record of records) {
    for (const strip of record.strips) {
      stripsInspected += 1;
      if (strip.skippedWhite) {
        stripsSkippedWhite += 1;
        continue;
      }
      for (const pass of strip.passes) {
        passesExecuted += 1;
        candidatesRaw += pass.candidatesRaw;
        discardedByConfidence += pass.discardedByConfidence;
        discardedByEmptyText += pass.discardedByEmptyText;
        discardedByOverlap += pass.discardedByOverlap;
        wordsAdded += pass.wordsAdded;
        const key = passKey(strip.strip, pass.rotation);
        wordsAddedByPass.set(key, (wordsAddedByPass.get(key) ?? 0) + pass.wordsAdded);
      }
    }
  }

  return {
    pagesObserved: records.length,
    stripsInspected,
    stripsSkippedWhite,
    passesExecuted,
    candidatesRaw,
    discardedByConfidence,
    discardedByEmptyText,
    discardedByOverlap,
    wordsAdded,
    wordsAddedByPass: Object.fromEntries(wordsAddedByPass),
  };
}

export interface ImageDataProfileAggregate {
  readonly stageStats: ReadonlyArray<ImageDataProfileStageStats>;
  readonly counters: ImageDataProfileCounters;
}

/**
 * Agrega un lote de registros crudos, exigiendo primero que cumplan los
 * invariantes del Handoff §5. Lanza `ImageDataProfileInvariantError` si no
 * — agregar igual sobre un registro inconsistente sería exactamente el modo
 * de falla silenciosa que el Handoff advierte ("un instrumento que mide mal
 * no tira error, devuelve un número").
 */
export function aggregateImageDataProfile(
  records: ReadonlyArray<ImageDataProfilePageRecord>,
): ImageDataProfileAggregate {
  const violations = checkImageDataProfileInvariants(records);
  if (violations.length > 0) throw new ImageDataProfileInvariantError(violations);
  return {
    stageStats: aggregateStageDurations(records),
    counters: aggregateCounters(records),
  };
}
