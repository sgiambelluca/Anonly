/**
 * Lo que corre **dentro del browser** para medir un documento, y los tipos
 * que devuelve.
 *
 * Se escribe como una función que se serializa a la página (`page.evaluate`),
 * así que no puede importar nada del repo en tiempo de ejecución: los valores
 * de `EngineEvents`/`EventChannel` son strings planos del enum
 * (`shared/src/enums.ts`) y viajan como literales. Los `import type` de acá
 * se borran al compilar y solo sirven para que el tipado del lado Node
 * coincida con lo que la página realmente devuelve.
 */
import type { EntityGroup, Occurrence } from "@anonly/shared";

/**
 * La forma mínima del bus que el recolector usa dentro de la página. No se
 * importa `IEventBus`: sus firmas son genéricas sobre los enums y adentro de
 * `page.evaluate` los eventos viajan como strings planos.
 */
export interface BrowserBus {
  on(channel: string, event: string, handler: (payload: unknown) => void): unknown;
}

export interface BrowserCore {
  readonly bus: BrowserBus;
}

/** Lo que el recolector deja en `globalThis` mientras mide un documento. */
export interface BrowserCollector {
  readonly documentId: string;
  readonly startedAt: number;
  readonly timings: Map<string, { first: number; last: number; count: number }>;
  readonly occurrences: Map<string, Occurrence>;
  readonly groups: Map<string, EntityGroup>;
  isOk(): boolean;
}

declare global {
  var __anonlyCore: BrowserCore | undefined;

  var __anonlyMeasure: BrowserCollector | undefined;
}

/** Marca de tiempo de la PRIMERA y la ÚLTIMA vez que se vio cada evento. */
export interface EventTiming {
  readonly event: string;
  readonly first: number;
  readonly last: number;
  readonly count: number;
}

export interface MeasuredDocument {
  readonly documentId: string;
  /** `performance.now()` al soltar el archivo en el input. */
  readonly startedAt: number;
  /** `performance.now()` al llegar `PIPELINE_READY`. */
  readonly readyAt: number;
  readonly timings: ReadonlyArray<EventTiming>;
  readonly occurrences: ReadonlyArray<Occurrence>;
  readonly groups: ReadonlyArray<EntityGroup>;
  /** `false` si el pipeline terminó en `PIPELINE_FAILED`. */
  readonly ok: boolean;
}

/**
 * Los eventos que se cronometran, con su canal. Es la lista de hitos de
 * etapa del pipeline: de acá salen las duraciones que comparan un antes y un
 * después (`roadmap/Optimizacion_De_Rendimiento.md`).
 */
export const TIMED_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ["pdf", "PAGE_PARSED"],
  ["pdf", "DOCUMENT_PARSED"],
  ["ocr", "OCR_STARTED"],
  ["ocr", "OCR_PAGE_FINISHED"],
  ["ocr", "OCR_FINISHED"],
  ["regex", "REGEX_FINISHED"],
  ["ner", "NER_STARTED"],
  ["ner", "NER_MODEL_LOADING"],
  ["ner", "NER_MODEL_READY"],
  ["ner", "NER_PAGE_FINISHED"],
  ["ner", "NER_FINISHED"],
  ["grouping", "GROUPING_FINISHED"],
  ["render", "PREVIEW_UPDATED"],
  ["pipeline", "PIPELINE_READY"],
  ["pipeline", "PIPELINE_FAILED"],
];
