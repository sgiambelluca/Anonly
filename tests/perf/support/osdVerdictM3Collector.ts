/**
 * M-O3: lo que se lee de cada página dentro de la aplicación, sin sacar nunca su texto. Se usa como
 * `extraCollectors` y `postRunCapture` de `measureProfile` (`memoryProfile.ts`), así que corre en cada
 * importación (fría y caliente) con el mismo timing que el colector de memoria de H-10.
 *
 * Las dos funciones de adentro (`installInPage`, `captureInPage`) se serializan y corren en el renderer: no
 * pueden usar nada del módulo. Por eso son funciones sueltas, sin cierres, y los tests las ejecutan tal cual
 * con un `globalThis` simulado.
 *
 * **Privacidad.** Lo que sale de la página son cantidades, confianzas, ángulos, tiempos, hashes y tipos de
 * entidad. El texto de cada página entregada sale como SHA-256; nunca como palabras. Los valores de las
 * entidades no se leen.
 */

import type { Page } from "@playwright/test";

export interface OrientationSnapshot {
  readonly orientation: number | null;
  readonly osdHadVerdict: boolean | null;
  readonly inkRatio: number | null;
}

export interface AttemptSnapshot {
  readonly order: number;
  /** Ángulo con el que se despachó el reconocimiento (`null` si no se capturó). */
  readonly angle: number | null;
  readonly upscale: number;
  readonly dpi: number | null;
  readonly terminal: string | null;
  readonly durationMs: number | null;
  readonly wordCount: number | null;
  readonly reliableWordCount: number | null;
  readonly confidence: number | null;
  /** Hash de las palabras de la lectura (no criptográfico, sin importar el orden). */
  readonly key: string | null;
}

export interface DeliveredSnapshot {
  readonly wordCount: number;
  readonly reliableWordCount: number;
  /** SHA-256 del texto entregado. */
  readonly textSha256: string;
  /** El mismo hash que `AttemptSnapshot.key`, para emparejar la lectura entregada con su reconocimiento. */
  readonly key: string;
}

export interface PageSnapshot {
  readonly pageIndex: number;
  readonly natural: OrientationSnapshot | null;
  readonly orientation: OrientationSnapshot | null;
  readonly attempts: ReadonlyArray<AttemptSnapshot>;
  readonly delivered: DeliveredSnapshot | null;
  /** Confianza de página de `OCR_PAGE_FINISHED`. */
  readonly confidence: number | null;
  readonly unreadableInk: boolean;
  /** Cantidad de entidades por tipo, sin valores. */
  readonly entityCounts: Readonly<Record<string, number>>;
}

export interface RunSnapshot {
  readonly observer: boolean;
  readonly pages: ReadonlyArray<PageSnapshot>;
  /** Despachos de `ocr-page` que vio el observador (0 si no hay observador). */
  readonly ocrPageJobs: number;
}

interface M3CollectorState {
  installed: boolean;
  confidence: Record<number, number | null>;
  unreadable: Record<number, boolean>;
  entities: Record<number, Record<string, number>>;
}
interface M3DocumentView {
  readonly pages: ReadonlyArray<{
    readonly index: number;
    readonly words: ReadonlyArray<{ readonly text: string; readonly confidence: number }>;
  }>;
}
interface M3JobView {
  readonly jobId: string;
  readonly jobType: string;
  readonly documentId: string;
  readonly pageIndex: number;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly dpi: number | null;
  readonly dispatchedOrientation?: number | null;
  readonly orientation: number | null;
  readonly upscale: number;
  readonly terminal: string | null;
  readonly result: unknown;
  readonly naturalResult?: unknown;
}
type M3Scope = typeof globalThis & {
  __anonlyCore?: {
    bus: { on(channel: string, event: string, handler: (payload: unknown) => void): unknown };
    orchestrator: { documents: ReadonlyMap<string, M3DocumentView> };
  };
  __anonlyMemoryRun?: { documentId?: string };
  __anonlyM3?: M3CollectorState;
  __adr190?: { capture: { jobs: ReadonlyArray<M3JobView> } };
};

/** Corre en el renderer. Instala los oyentes una sola vez y reinicia el estado en cada importación. */
export function installInPage(): void {
  const scope = globalThis as M3Scope;
  const core = scope.__anonlyCore;
  if (core === undefined) throw new Error("__anonlyCore ausente: ¿VITE_E2E=1 en el build?");
  const previous = scope.__anonlyM3;
  const state: M3CollectorState = { installed: true, confidence: {}, unreadable: {}, entities: {} };
  scope.__anonlyM3 = state;
  if (previous?.installed === true) return;
  // Los oyentes escriben siempre en el estado vigente: reinstalar el colector no los duplica.
  core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload) => {
    const event = payload as { pageIndex?: unknown; confidence?: unknown; unreadableInk?: unknown };
    if (typeof event.pageIndex !== "number") return;
    const current = scope.__anonlyM3;
    if (current === undefined) return;
    current.confidence[event.pageIndex] =
      typeof event.confidence === "number" ? event.confidence : null;
    if (event.unreadableInk === true) current.unreadable[event.pageIndex] = true;
  });
  for (const channel of ["regex", "ner"]) {
    core.bus.on(channel, "ENTITY_FOUND", (payload) => {
      const occurrence = (payload as { occurrence?: { entityType?: unknown; pageIndex?: unknown } })
        .occurrence;
      if (typeof occurrence?.pageIndex !== "number" || typeof occurrence.entityType !== "string")
        return;
      const current = scope.__anonlyM3;
      if (current === undefined) return;
      const page = (current.entities[occurrence.pageIndex] ??= {});
      page[occurrence.entityType] = (page[occurrence.entityType] ?? 0) + 1;
    });
  }
}

/**
 * Corre en el renderer, después de que la importación se asentó: junta, por página, lo observado y el texto
 * entregado (solo su hash).
 */
export async function captureInPage(): Promise<RunSnapshot> {
  const scope = globalThis as M3Scope;
  const documentId = scope.__anonlyMemoryRun?.documentId;
  const state = scope.__anonlyM3;
  const document =
    documentId === undefined
      ? undefined
      : scope.__anonlyCore?.orchestrator.documents.get(documentId);
  if (documentId === undefined || state === undefined || document === undefined)
    throw new Error("M-O3: el documento de la corrida no está disponible");

  // El mismo hash de palabras que usa el observador de transporte (`adr190Browser.ts`).
  const wordsKey = (words: ReadonlyArray<{ text: string; confidence: number }>): string => {
    const keys = words.map((word) => `${word.confidence}|${word.text}`).sort();
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (const key of keys) {
      for (let i = 0; i < key.length; i += 1) {
        const code = key.charCodeAt(i);
        a = Math.imul(a ^ code, 0x01000193) >>> 0;
        b = Math.imul(b + code + 0x9e3779b9, 0x85ebca6b) >>> 0;
      }
      a = Math.imul(a ^ 10, 0x01000193) >>> 0;
    }
    return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
  };
  const sha256 = async (text: string): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const orientation = (value: unknown) => {
    if (typeof value !== "object" || value === null) return null;
    const record = value as { orientation?: unknown; osdHadVerdict?: unknown; inkRatio?: unknown };
    return {
      orientation: typeof record.orientation === "number" ? record.orientation : null,
      osdHadVerdict: typeof record.osdHadVerdict === "boolean" ? record.osdHadVerdict : null,
      inkRatio: typeof record.inkRatio === "number" ? record.inkRatio : null,
    };
  };

  const jobs = (scope.__adr190?.capture.jobs ?? []).filter((job) => job.documentId === documentId);
  const pages: PageSnapshot[] = [];
  for (const page of document.pages) {
    const pageJobs = jobs.filter((job) => job.pageIndex === page.index);
    const orient = pageJobs
      .filter((job) => job.jobType === "ocr-orient")
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    const attempts = pageJobs
      .filter((job) => job.jobType === "ocr-page")
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((job, order) => {
        const result =
          typeof job.result === "object" && job.result !== null
            ? (job.result as {
                wordCount?: unknown;
                reliableWordCount?: unknown;
                confidence?: unknown;
                key?: unknown;
              })
            : {};
        return {
          order,
          angle: job.dispatchedOrientation ?? job.orientation,
          upscale: job.upscale,
          dpi: job.dpi,
          terminal: job.terminal,
          durationMs: job.finishedAt === null ? null : job.finishedAt - job.startedAt,
          wordCount: typeof result.wordCount === "number" ? result.wordCount : null,
          reliableWordCount:
            typeof result.reliableWordCount === "number" ? result.reliableWordCount : null,
          confidence: typeof result.confidence === "number" ? result.confidence : null,
          key: typeof result.key === "string" ? result.key : null,
        };
      });
    pages.push({
      pageIndex: page.index,
      natural: orient === undefined ? null : orientation(orient.naturalResult ?? orient.result),
      orientation: orient === undefined ? null : orientation(orient.result),
      attempts,
      delivered: {
        wordCount: page.words.length,
        reliableWordCount: page.words.filter((word) => word.confidence >= 0.6).length,
        textSha256: await sha256(page.words.map((word) => word.text).join("\n")),
        key: wordsKey(page.words),
      },
      confidence: state.confidence[page.index] ?? null,
      unreadableInk: state.unreadable[page.index] === true,
      entityCounts: { ...state.entities[page.index] },
    });
  }
  return {
    observer: scope.__adr190 !== undefined,
    pages,
    ocrPageJobs: jobs.filter((job) => job.jobType === "ocr-page").length,
  };
}

export async function installM3Collector(page: Page): Promise<void> {
  await page.evaluate(installInPage);
}

export async function captureM3Run(page: Page): Promise<RunSnapshot> {
  return page.evaluate(captureInPage);
}
