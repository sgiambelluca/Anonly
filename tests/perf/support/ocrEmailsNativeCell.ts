/**
 * Registro de una celda de la campaña «emails en escaneos de DPI nativo bajo» (M-E1,
 * `Confianza_1.0.x_Plan.md` Frente 2): un sintético rasterizado a su DPI nativo y leído con la
 * configuración por defecto (no se fuerza `ocr.dpi`). Puro: el spec observa y esta función arma lo
 * que se escribe. Solo sintéticos: el registro lleva valores inventados (verdad, fragmentos leídos).
 */

import { createHash } from "node:crypto";

import type { Capture } from "./adr190Dpi.js";
import { observedEntities, type RawEntity } from "./ocrDpiDownCell.js";
import {
  NATIVE_CAP_TOLERANCE_DPI,
  cellInvalidReasons,
  summarizeChain,
  summarizeDispatches,
  type ChainEvidence,
  type DispatchEvidence,
  type PageCap,
} from "./ocrDpiDownChain.js";
import { type CorpusTruth, type SyntheticCorpusId } from "./ocrDpiDownCorpus.js";
import {
  compareEntities,
  scoreTokens,
  type ObservedEntity,
  type TokenScore,
} from "./ocrDpiDownScoring.js";
import type { CountsByType, EntityCounts } from "./ocrDpiDownSummary.js";
import {
  EMAIL_READINGS,
  classifyLostEmail,
  countQCandidates,
  findQShapedCandidates,
  type EmailReading,
  type QCandidate,
  type QCandidateCounts,
} from "./ocrEmailsNativeReading.js";
import { DEFAULT_MAX_LIVE_IMAGE_BYTES } from "./ocrPoolArms.js";

/** `ocr.dpi` por defecto del Core (`packages/anonymization-core/src/config.ts`): la premisa de la campaña. */
export const DEFAULT_OCR_DPI = 300;

export interface NativeEffectiveConfig {
  readonly ocrDpi: number | null;
  readonly ocrPoolSize: number | null;
  readonly maxLiveImageBytes: number | null;
  readonly nerEnabled: boolean | null;
}

export interface ObservedWord {
  readonly pageIndex: number;
  readonly text: string;
}

export interface NativeCellObservation {
  readonly ready: boolean;
  readonly pipelineFailure: unknown;
  readonly capture: Pick<Capture, "jobs" | "issues">;
  readonly caps: ReadonlyArray<PageCap>;
  readonly ocrPageEvents: ReadonlyArray<unknown>;
  readonly entities: ReadonlyArray<RawEntity>;
  readonly words: ReadonlyArray<ObservedWord>;
  readonly nerFinished: boolean;
  readonly config: NativeEffectiveConfig;
}

/** Texto leído de cada página: las palabras de la página, en el orden del OCR, separadas por espacio. */
export function pageTextsOf(words: ReadonlyArray<ObservedWord>): ReadonlyMap<number, string> {
  const byPage = new Map<number, string[]>();
  for (const word of words) {
    const list = byPage.get(word.pageIndex);
    if (list === undefined) byPage.set(word.pageIndex, [word.text]);
    else list.push(word.text);
  }
  return new Map([...byPage.entries()].map(([pageIndex, list]) => [pageIndex, list.join(" ")]));
}

export interface LostEmailRecord {
  readonly pageIndex: number;
  readonly expected: string;
  readonly reading: EmailReading;
  readonly fragment: string | null;
}

export interface QCandidateRecord extends QCandidate {
  readonly pageIndex: number;
}

export interface NativeCellRecord {
  readonly schema: 1;
  readonly corpus: SyntheticCorpusId;
  readonly nativeDpi: number;
  readonly repetition: number;
  readonly valid: boolean;
  readonly invalidReasons: ReadonlyArray<string>;
  readonly fixtureSha256: string;
  readonly config: NativeEffectiveConfig;
  readonly dispatch: DispatchEvidence;
  readonly chain: ChainEvidence;
  readonly nativeDpiEvidence: {
    /** Tope nativo observado de cada página (ADR-163), sin repetir. */
    readonly pageCaps: ReadonlyArray<number>;
    readonly effectiveDpis: ReadonlyArray<number>;
    /** Todos los despachos `ocr-page` salieron a `nativeDpi`, con la tolerancia de redondeo del tope. */
    readonly allDispatchesAtNativeDpi: boolean;
  };
  readonly detectedByType: CountsByType;
  readonly entitiesVsTruth: EntityCounts;
  readonly emails: {
    readonly expected: number;
    readonly detected: number;
    readonly matched: number;
    readonly missed: number;
    readonly added: number;
    readonly lost: ReadonlyArray<LostEmailRecord>;
    readonly readingCounts: Readonly<Record<EmailReading, number>>;
    /** Emails detectados que no están en la verdad (p. ej. un email recortado). */
    readonly addedValues: ReadonlyArray<{ readonly pageIndex: number; readonly value: string }>;
  };
  /** Lo perdido y lo agregado de los demás tipos de entidad contra la verdad. */
  readonly otherTypes: {
    readonly byType: EntityCounts["byType"];
    readonly missed: ReadonlyArray<{
      readonly type: string;
      readonly pageIndex: number;
      readonly value: string;
    }>;
    readonly added: ReadonlyArray<{
      readonly type: string;
      readonly pageIndex: number;
      readonly value: string;
    }>;
  };
  /** Cadenas del texto leído con la forma `nombre` + `Q` + `dominio.tld` (cota de una regla tolerante). */
  readonly tolerantRule: {
    readonly counts: QCandidateCounts;
    readonly candidates: ReadonlyArray<QCandidateRecord>;
  };
  readonly tokensVsTruth: TokenScore;
  readonly pagesRead: number;
  readonly observedTextSha256: string;
  /** Texto leído, de un sintético: permite reclasificar sin volver a medir. */
  readonly observedText: string;
}

export interface NativeCellInput {
  readonly corpus: SyntheticCorpusId;
  readonly sha256: string;
  readonly truth: CorpusTruth;
  readonly nativeDpi: number;
  readonly repetition: number;
  readonly observation: NativeCellObservation;
}

const OTHER_TYPES_NOT_EMAIL = (type: string): boolean => type !== "EMAIL";

function emptyReadingCounts(): Record<EmailReading, number> {
  return Object.fromEntries(EMAIL_READINGS.map((reading) => [reading, 0])) as Record<
    EmailReading,
    number
  >;
}

function detectedCounts(entities: ReadonlyArray<ObservedEntity>): CountsByType {
  const counts: Record<string, number> = {};
  for (const entity of entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function buildNativeCellRecord(input: NativeCellInput): NativeCellRecord {
  const { observation, truth, nativeDpi } = input;
  const config = observation.config;
  const requestedDpi = config.ocrDpi ?? DEFAULT_OCR_DPI;
  const dispatch = summarizeDispatches(observation.capture.jobs, observation.caps, requestedDpi);
  const chain = summarizeChain(observation.capture.jobs, observation.ocrPageEvents);
  const invalidReasons = [
    ...cellInvalidReasons({
      ready: observation.ready,
      pipelineFailure: observation.pipelineFailure,
      captureIssues: observation.capture.issues,
      dispatch,
      chain,
      nerExpectedButNotFinished: !observation.nerFinished,
      // Pool, tope de imágenes vivas y NER fijos; el DPI NO se fuerza y se comprueba aparte.
      overrideEffective:
        config.ocrPoolSize === 1 &&
        config.maxLiveImageBytes === DEFAULT_MAX_LIVE_IMAGE_BYTES &&
        config.nerEnabled === true,
      // La fuente es de `nativeDpi`: el tope de cada página tiene que serlo.
      expectNativeCap: nativeDpi,
    }),
  ];
  if (config.ocrDpi !== DEFAULT_OCR_DPI)
    invalidReasons.push(
      `default-ocr-dpi-is-not-${DEFAULT_OCR_DPI}: ${config.ocrDpi ?? "no observable"}`,
    );
  const offNative = dispatch.dispatches.filter(
    (record) => record.dpi === null || Math.abs(record.dpi - nativeDpi) > NATIVE_CAP_TOLERANCE_DPI,
  );
  if (offNative.length > 0)
    invalidReasons.push(
      `dispatch-dpi-not-native: esperado ${nativeDpi}, observado ${[...new Set(offNative.map((record) => String(record.dpi)))].join(",")}`,
    );

  const entities = observedEntities(observation.entities);
  const truthEntities: ReadonlyArray<ObservedEntity> = truth.entities.map((entity) => ({
    type: entity.type,
    value: entity.value,
    pageIndex: entity.pageIndex,
    box: entity.box,
  }));
  const vsTruth = compareEntities(truthEntities, entities);
  const pageTexts = pageTextsOf(observation.words);

  const lost: LostEmailRecord[] = vsTruth.missed
    .filter((entity) => entity.type === "EMAIL")
    .map((entity) => {
      const reading = classifyLostEmail(entity.value, pageTexts.get(entity.pageIndex) ?? "");
      return {
        pageIndex: entity.pageIndex,
        expected: entity.value,
        reading: reading.reading,
        fragment: reading.fragment,
      };
    });
  const readingCounts = emptyReadingCounts();
  for (const record of lost) readingCounts[record.reading] += 1;
  const emailCounts = vsTruth.byType.EMAIL ?? {
    expected: 0,
    detected: 0,
    matched: 0,
    missed: 0,
    added: 0,
  };

  const truthEmailsByPage = new Map<number, string[]>();
  for (const entity of truth.entities)
    if (entity.type === "EMAIL")
      truthEmailsByPage.set(entity.pageIndex, [
        ...(truthEmailsByPage.get(entity.pageIndex) ?? []),
        entity.value,
      ]);
  const candidates: QCandidateRecord[] = [...pageTexts.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([pageIndex, text]) =>
      findQShapedCandidates(text, truthEmailsByPage.get(pageIndex) ?? []).map((candidate) => ({
        ...candidate,
        pageIndex,
      })),
    );

  const observedText = observation.words.map((word) => word.text).join(" ");
  const truthText = truth.text;
  const effectiveDpis = dispatch.effectiveDpis;
  const pageCaps = [
    ...new Set(
      observation.caps.flatMap((cap) =>
        cap.originalCap === null ? [] : [Math.round(cap.originalCap * 100) / 100],
      ),
    ),
  ].sort((a, b) => a - b);
  return {
    schema: 1,
    corpus: input.corpus,
    nativeDpi,
    repetition: input.repetition,
    valid: invalidReasons.length === 0,
    invalidReasons,
    fixtureSha256: input.sha256,
    config,
    dispatch,
    chain,
    nativeDpiEvidence: {
      pageCaps,
      effectiveDpis,
      allDispatchesAtNativeDpi: dispatch.dispatches.length > 0 && offNative.length === 0,
    },
    detectedByType: detectedCounts(entities),
    entitiesVsTruth: { byType: vsTruth.byType, totals: vsTruth.totals },
    emails: {
      expected: emailCounts.expected,
      detected: emailCounts.detected,
      matched: emailCounts.matched,
      missed: emailCounts.missed,
      added: emailCounts.added,
      lost,
      readingCounts,
      addedValues: vsTruth.added
        .filter((entity) => entity.type === "EMAIL")
        .map((entity) => ({ pageIndex: entity.pageIndex, value: entity.value })),
    },
    otherTypes: {
      byType: Object.fromEntries(
        Object.entries(vsTruth.byType).filter(([type]) => OTHER_TYPES_NOT_EMAIL(type)),
      ),
      missed: vsTruth.missed.filter((entity) => OTHER_TYPES_NOT_EMAIL(entity.type)),
      added: vsTruth.added.filter((entity) => OTHER_TYPES_NOT_EMAIL(entity.type)),
    },
    tolerantRule: { counts: countQCandidates(candidates), candidates },
    tokensVsTruth: scoreTokens(truthText, observedText),
    pagesRead: pageTexts.size,
    observedTextSha256: createHash("sha256").update(observedText).digest("hex"),
    observedText,
  };
}
