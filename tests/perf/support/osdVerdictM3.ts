/**
 * M-O3 (`docs/roadmap/hardening/Confianza_Cierre_2026-10-08.md`, Frente 3, «M-O3 — el peor caso, con documentos
 * reales»): si todas las páginas de un escaneo se leen en los cuatro ángulos, ¿cuánto suben el tiempo y el pico
 * de memoria M2, y cambia lo que se entrega? Puro: los documentos, los brazos, el plan de corridas y el
 * registro de cada corrida (con su revisión de coherencia). Sin Electron, sin disco, sin documentos.
 *
 * Una corrida es lo que hace `memory.spec.ts` (`measureProfile`): una instancia de Electron, una importación
 * en frío, `closeDocument` y una importación en caliente del mismo archivo. Su pico M2 es el de ADR-146 (suma
 * de working sets), con el mismo método.
 *
 * **Privacidad.** El registro de una corrida de un documento real no lleva texto: solo cantidades,
 * confianzas, ángulos, tiempos, hashes, tipos de entidad e identificadores neutros (`R1-p07`). Un test lo
 * comprueba.
 */

import type { ProfileReport, RunReport } from "./memoryProfile.js";
import type { NoiseId } from "./osdVerdictCorpusM2.js";
import type { PageSnapshot, RunSnapshot } from "./osdVerdictM3Collector.js";

export type M3Doc = "R1" | "R4" | "P2" | "P2N";
/**
 * - `A`: el producto tal cual, con el observador de transporte instalado y sin forzar nada;
 * - `A0`: lo mismo sin observador (solo P2, para ver si el observador mueve el número);
 * - `B`: «sin veredicto» forzado en todas las páginas, con la tinta medida;
 * - `C`: además, la tinta informada sube al umbral cuando quedó debajo.
 */
export type M3Arm = "A" | "A0" | "B" | "C";

export const M3_REPETITIONS = 3;

/** Las celdas del plan, en el orden de la campaña: los reales primero. */
export const M3_CELLS: ReadonlyArray<{ readonly doc: M3Doc; readonly arm: M3Arm }> = [
  { doc: "R1", arm: "A" },
  { doc: "R1", arm: "B" },
  { doc: "R1", arm: "C" },
  { doc: "R4", arm: "A" },
  { doc: "R4", arm: "B" },
  { doc: "P2", arm: "A0" },
  { doc: "P2", arm: "A" },
  { doc: "P2", arm: "B" },
  { doc: "P2N", arm: "A" },
  { doc: "P2N", arm: "C" },
];

export const M3_DOC_DESCRIPTION: Readonly<Record<M3Doc, string>> = {
  R1: "escaneo real de 20 páginas, a su resolución",
  R4: "digital real de 51 páginas, rasterizado a 300 dpi como un documento escaneado",
  P2: "perfil normativo de memoria: 50 páginas escaneadas sintéticas (memory.spec.ts)",
  P2N: "P2 con 10 hojas de ruido de M-O2 a 300 dpi, una cada cinco páginas",
};

export const M3_ARM_DESCRIPTION: Readonly<Record<M3Arm, string>> = {
  A: "control: el producto tal cual, con el observador instalado",
  A0: "control sin observador de transporte",
  B: "sin veredicto forzado en todas las páginas, con la tinta medida",
  C: "sin veredicto forzado y la tinta informada sube al umbral cuando quedó debajo",
};

export const M3_REAL_DOCS: ReadonlyArray<M3Doc> = ["R1", "R4"];
/** R4 se rasteriza a 300 dpi. */
export const M3_R4_DPI = 300;
/** Páginas de cada documento (R4 y R1 se comprueban contra el archivo real). */
export const M3_PAGES: Readonly<Record<M3Doc, number>> = { R1: 20, R4: 51, P2: 50, P2N: 60 };

/** Techo de M2 de P2 (ADR-192 §2): 3,0 GB decimales, para la corrida fría y la caliente. */
export const P2_CEILING_BYTES = 3_000_000_000;
/** Ruido de M2 entre corridas iguales (ADR-146 §7, ADR-192): unos 345 MB. */
export const M2_NOISE_BYTES = 345_000_000;
/** `INK_PRESENT_RATIO` de ADR-190 §3. */
export const INK_PRESENT_RATIO = 0.002;

/** Las hojas de ruido de P2N: las que hoy hacen una sola lectura. */
export const P2N_NOISE_SHEETS: ReadonlyArray<NoiseId> = [
  "RU1",
  "RU3",
  "RU4",
  "RU5",
  "RU1",
  "RU3",
  "RU4",
  "RU5",
  "RU1",
  "RU3",
];
export const P2N_NOISE_EVERY = 5;
export const P2N_NOISE_DPI = 300;

export type P2nPart =
  | { readonly kind: "p2"; readonly index: number }
  | { readonly kind: "noise"; readonly sheet: NoiseId };

/** El orden de P2N: tras cada cinco páginas de P2 va una hoja de ruido (60 páginas). */
export function p2nPlan(p2Pages = 50): ReadonlyArray<P2nPart> {
  const parts: P2nPart[] = [];
  let noise = 0;
  for (let index = 0; index < p2Pages; index += 1) {
    parts.push({ kind: "p2", index });
    if ((index + 1) % P2N_NOISE_EVERY === 0) {
      const sheet = P2N_NOISE_SHEETS[noise];
      if (sheet === undefined) throw new Error("faltan hojas de ruido para el plan de P2N");
      parts.push({ kind: "noise", sheet });
      noise += 1;
    }
  }
  return parts;
}

/** Posiciones (desde 0) de las hojas de ruido en P2N. */
export function p2nNoisePages(): ReadonlyArray<number> {
  return p2nPlan().flatMap((part, index) => (part.kind === "noise" ? [index] : []));
}

export interface M3RunId {
  readonly doc: M3Doc;
  readonly arm: M3Arm;
  readonly rep: number;
}

export const m3Key = (id: M3RunId): string => `${id.doc}-${id.arm}-r${id.rep}`;
export const m3FileName = (id: M3RunId): string => `${m3Key(id)}.json`;

/**
 * Las corridas de la campaña. Dentro de cada documento van por repetición y los brazos se intercalan
 * (A, B, C, A, B, C…) para que una deriva de la máquina no caiga toda sobre un brazo.
 */
export function m3Plan(): ReadonlyArray<M3RunId> {
  const docs = [...new Set(M3_CELLS.map((cell) => cell.doc))];
  return docs.flatMap((doc) => {
    const arms = M3_CELLS.filter((cell) => cell.doc === doc).map((cell) => cell.arm);
    return Array.from({ length: M3_REPETITIONS }, (_, index) => index + 1).flatMap((rep) =>
      arms.map((arm): M3RunId => ({ doc, arm, rep })),
    );
  });
}

// ------------------------------------------------------------------ registro de una corrida

export interface M3RunSide {
  readonly ok: boolean;
  /** Pico M2 de la corrida (ADR-146 §7ter: dentro de la ventana de fases). */
  readonly peakSumBytes: number | null;
  readonly postReadyPeakBytes: number | null;
  readonly baselineBytes: number;
  readonly rssPeakGlobalBytes: number | null;
  readonly rssPeakDuringOcrBytes: number | null;
  readonly peakPosition: string;
  readonly hotBaselineSettled: boolean | null;
  /** Desde la importación hasta `Ready`. */
  readonly readyDurationMs: number | null;
  readonly totalMs: number | null;
  readonly ocrDurationMs: number | null;
  readonly workerPeakByType: Readonly<Record<string, number>>;
  /** Despachos de `ocr-page` que vio el bus de workers del Core (con o sin observador). */
  readonly ocrPageDispatches: number;
  readonly groupCount: number;
  readonly entityCount: number;
  readonly observer: boolean;
  /** Despachos de `ocr-page` que vio el observador de transporte. */
  readonly ocrPageJobsObserved: number;
  readonly pages: ReadonlyArray<PageSnapshot>;
}

export interface M3Run {
  readonly schema: 3;
  readonly doc: M3Doc;
  readonly arm: M3Arm;
  readonly rep: number;
  readonly observerInstalled: boolean;
  readonly fixtureSha256: string;
  readonly pageCount: number;
  readonly identity: ProfileReport["identity"];
  readonly capturedAt: string;
  readonly cold: M3RunSide;
  readonly hot: M3RunSide;
  readonly issues: ReadonlyArray<string>;
}

function sideOf(report: RunReport, snapshot: RunSnapshot): M3RunSide {
  return {
    ok: report.ok,
    peakSumBytes: report.peakSumBytes,
    postReadyPeakBytes: report.postReadyPeakBytes,
    baselineBytes: report.baselineBytes,
    rssPeakGlobalBytes: report.rssPeakGlobalBytes ?? null,
    rssPeakDuringOcrBytes: report.rssPeakDuringOcrBytes ?? null,
    peakPosition: report.peakPosition,
    hotBaselineSettled: report.hotBaselineSettled,
    readyDurationMs: report.readyDurationMs ?? null,
    totalMs: report.totalMs,
    ocrDurationMs: report.ocrDurationMs ?? null,
    workerPeakByType: report.workerPeakByType,
    ocrPageDispatches: report.workerEvents.filter(
      (event) => event.type === "ocr-page" && event.delta === 1,
    ).length,
    groupCount: report.groupCount,
    entityCount: report.entityCount,
    observer: snapshot.observer,
    ocrPageJobsObserved: snapshot.ocrPageJobs,
    pages: snapshot.pages,
  };
}

export function buildM3Run(input: {
  readonly id: M3RunId;
  readonly fixtureSha256: string;
  readonly pageCount: number;
  readonly report: ProfileReport;
  readonly cold: RunSnapshot;
  readonly hot: RunSnapshot;
}): M3Run {
  const { id, report } = input;
  const run: M3Run = {
    schema: 3,
    doc: id.doc,
    arm: id.arm,
    rep: id.rep,
    observerInstalled: id.arm !== "A0",
    fixtureSha256: input.fixtureSha256,
    pageCount: input.pageCount,
    identity: report.identity,
    capturedAt: report.capturedAt,
    cold: sideOf(report.cold, input.cold),
    hot: sideOf(report.hot, input.hot),
    issues: [],
  };
  return { ...run, issues: m3RunIssues(run) };
}

const approx = (a: number, b: number): boolean => Math.abs(a - b) < 1e-12;

/** Coherencia del registro con el brazo. Una corrida que falló (`ok: false`) es un resultado, no un issue. */
export function m3RunIssues(run: M3Run): string[] {
  const issues: string[] = [];
  for (const [name, side] of [
    ["frío", run.cold],
    ["caliente", run.hot],
  ] as const) {
    if (!side.ok) continue;
    if (side.observer !== run.observerInstalled)
      issues.push(
        `${name}: el observador ${side.observer ? "está" : "no está"} y el brazo ${run.arm} dice lo contrario`,
      );
    if (side.pages.length !== run.pageCount)
      issues.push(
        `${name}: ${side.pages.length} páginas capturadas y el documento tiene ${run.pageCount}`,
      );
    if (side.observer && side.ocrPageJobsObserved !== side.ocrPageDispatches)
      issues.push(
        `${name}: el observador vio ${side.ocrPageJobsObserved} reconocimientos y el bus de workers ${side.ocrPageDispatches}`,
      );
    if (!side.observer) continue;
    for (const page of side.pages) {
      const id = `p${String(page.pageIndex + 1).padStart(2, "0")}`;
      const natural = page.natural;
      const delivered = page.orientation;
      if (natural === null || delivered === null) {
        issues.push(`${name} ${id}: sin resultado de orientación`);
        continue;
      }
      if (run.arm === "A") {
        if (
          natural.orientation !== delivered.orientation ||
          natural.osdHadVerdict !== delivered.osdHadVerdict ||
          natural.inkRatio !== delivered.inkRatio
        )
          issues.push(`${name} ${id}: brazo A con un resultado entregado distinto del natural`);
      } else {
        if (delivered.osdHadVerdict !== false || delivered.orientation !== 0)
          issues.push(`${name} ${id}: el forzado no llegó como «sin veredicto» (orientación 0)`);
        if (natural.inkRatio === null || delivered.inkRatio === null) {
          issues.push(`${name} ${id}: falta la tinta`);
          continue;
        }
        const expectedInk =
          run.arm === "C" && natural.inkRatio < INK_PRESENT_RATIO
            ? INK_PRESENT_RATIO
            : natural.inkRatio;
        if (!approx(delivered.inkRatio, expectedInk))
          issues.push(
            `${name} ${id}: tinta entregada ${delivered.inkRatio}, se esperaba ${expectedInk}`,
          );
      }
    }
  }
  return issues;
}

/** Identificador neutro de una página: `R1-p07`. */
export function m3PageId(doc: M3Doc, pageIndex: number): string {
  return `${doc}-p${String(pageIndex + 1).padStart(2, "0")}`;
}
