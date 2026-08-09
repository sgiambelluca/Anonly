/**
 * `assembler.ts` — el ensamblador con estado de un documento a la vez que
 * ADR-047 §1/§4 asigna al ExportWorker: la frontera pdf-lib de este motor
 * (`embedJpg`/`embedPng`/`addPage`/`drawImage` para `append-page`;
 * `setProducer`/`setCreator`/`setCreationDate`/`setTitle`/`save` para
 * `save`).
 *
 * A diferencia de `ocr-engine/src/worker/kernel.ts` y
 * `ner-engine/src/worker/kernel.ts` (kernels SIN estado por documento, con
 * su estado retenido internamente a nivel de módulo): este módulo NO retiene
 * estado propio. El estado `{ documentId, pdfDoc, appendedPages }` es
 * explícito — pasado y devuelto por cada función — porque pdf-lib ensambla
 * incrementalmente y no es thread-safe sobre el mismo `PDFDocument`
 * (`Export_Engine.md` §12), así que el ENSAMBLADO en sí necesita retener el
 * documento, pero QUIÉN lo retiene queda fuera de este archivo
 * (`Export_Engine.md` §15 item 21, ADR-047 §1/§4):
 * - `worker/entry.ts` (worker real): lo retiene a nivel de módulo y lo
 *   pasa/reasigna detrás de la mensajería `postMessage`.
 * - `export.engine.ts` (host, in-process fallback, ADR-035): lo retiene en
 *   la propia instancia de `ExportEngine` cuando no hay `ExportJobPool` real
 *   configurada — fallback bit-idéntico.
 *
 * Sin bus, sin logger, sin eventos.
 *
 * Reglas de estado (ADR-047 §4):
 * - `documentId` distinto del retenido -> descarta el parcial y arranca uno
 *   nuevo (caso 19).
 * - `append-page` con un `pageIndex` ya en `appendedPages` -> no-op
 *   idempotente: no vuelve a embeber/dibujar (caso 18 — hace seguro el
 *   reintento del host cuando el worker sí terminó pero el host lo dio por
 *   perdido por timeout).
 * - Un fallo dentro de un intento de `appendPage` (embed/addPage/drawImage)
 *   revierte cualquier página agregada a mitad de ESE intento antes de
 *   relanzar — mismo criterio que el guard `pageCountBeforeAttempt` que
 *   tenía `export.engine.ts` antes de ADR-047, ahora local a esta función en
 *   vez de comparado por el host (que ya no tiene una referencia directa a
 *   `pdfDoc`).
 * - Tras un `save` exitoso, el estado devuelto es `EMPTY_ASSEMBLER_STATE`
 *   (el próximo export arranca de cero, `Export_Engine.md` §13 caso 14). Un
 *   `save` fallido retiene el `pdfDoc` sin cambios, para permitir
 *   reintentar `save()` sobre el mismo documento (mismo criterio que
 *   `saveWithRetry` tenía antes de ADR-047).
 */
import {
  CancelledError,
  type EncodedPageImage,
  type ExportMetadata,
  type ExportPagePayload,
  type ExportSavePayload,
} from "@anonly/shared";
import { PDFDocument, type PDFImage } from "pdf-lib";

import { ExportFailedError } from "../export.errors.js";

export interface AssemblerState {
  readonly documentId: string | null;
  readonly pdfDoc: PDFDocument | null;
  readonly appendedPages: ReadonlySet<number>;
}

export const EMPTY_ASSEMBLER_STATE: AssemblerState = {
  documentId: null,
  pdfDoc: null,
  appendedPages: new Set(),
};

export interface AssemblerRunOptions {
  readonly abortSignal: AbortSignal;
}

export interface SavePdfResult {
  readonly buffer: ArrayBuffer;
  readonly state: AssemblerState;
}

/**
 * Corre `work` en carrera contra `abortSignal`: si la señal se dispara antes
 * de que `work` resuelva, rechaza con `CancelledError` sin esperar a `work`
 * (el caller deja de esperarla; no hay forma de interrumpir pdf-lib a mitad
 * de una llamada). Mismo patrón que `recognizeWithTimeout`/`classifyWithTimeout`
 * en ocr-engine/ner-engine.
 */
async function raceAbort<T>(
  work: Promise<T>,
  abortSignal: AbortSignal,
  documentId: string,
): Promise<T> {
  if (abortSignal.aborted) throw new CancelledError(documentId);

  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = (): void => reject(new CancelledError(documentId));
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([work, abortPromise]);
  } finally {
    if (onAbort !== undefined) abortSignal.removeEventListener("abort", onAbort);
  }
}

async function freshStateFor(documentId: string): Promise<AssemblerState> {
  return { documentId, pdfDoc: await PDFDocument.create(), appendedPages: new Set() };
}

/**
 * `append-page` (ADR-047 §1/§4): `embedJpg`/`embedPng` según `imageFormat` +
 * `addPage([pageWidthPt, pageHeightPt])` + `drawImage`. Idempotente por
 * `pageIndex`; un `documentId` distinto del retenido descarta el parcial y
 * arranca uno nuevo.
 */
export async function appendPage(
  state: AssemblerState,
  payload: ExportPagePayload,
  opts: AssemblerRunOptions,
): Promise<AssemblerState> {
  const { documentId, pageIndex, pageImage, imageFormat, pageWidthPt, pageHeightPt } = payload;

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  // Caso 19: documentId distinto (o sin PDFDocument todavía) -> parcial nuevo.
  const current =
    state.documentId === documentId && state.pdfDoc !== null
      ? state
      : await freshStateFor(documentId);

  // Caso 18: pageIndex ya adjuntado -> no-op idempotente, no se re-embebe.
  if (current.appendedPages.has(pageIndex)) {
    return current;
  }

  const pdfDoc = current.pdfDoc;
  if (pdfDoc === null) {
    // Inalcanzable en la práctica: `current` siempre viene de `freshStateFor`
    // (pdfDoc recién creado) o de `state` bajo la guarda `state.pdfDoc !== null`
    // de arriba — TypeScript no propaga esa segunda narrowing a `current.pdfDoc`
    // porque `current` es una unión de dos orígenes distintos. Guard explícito
    // en vez de `as unknown as`/`!` (Code_Standards.md §2).
    throw new ExportFailedError(
      documentId,
      "PDFDocument no disponible tras inicializar el estado.",
    );
  }
  const pageCountBeforeAttempt = pdfDoc.getPageCount();

  try {
    const embeddedImage: PDFImage = await raceAbort(
      imageFormat === "jpeg" ? pdfDoc.embedJpg(pageImage) : pdfDoc.embedPng(pageImage),
      opts.abortSignal,
      documentId,
    );

    if (opts.abortSignal.aborted) throw new CancelledError(documentId);

    const pdfPage = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    pdfPage.drawImage(embeddedImage, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });
  } catch (err: unknown) {
    // Revierte cualquier página agregada a mitad de ESTE intento (p. ej.
    // addPage exitoso seguido de un drawImage que falla) antes de relanzar
    // — reemplaza al guard pageCountBeforeAttempt que tenía export.engine.ts
    // (Export_Engine.md §15 item 23), ahora local porque el host ya no
    // retiene una referencia directa a pdfDoc.
    while (pdfDoc.getPageCount() > pageCountBeforeAttempt) {
      pdfDoc.removePage(pdfDoc.getPageCount() - 1);
    }
    if (err instanceof CancelledError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new ExportFailedError(documentId, reason, { pageIndex });
  }

  const appendedPages = new Set(current.appendedPages);
  appendedPages.add(pageIndex);
  return { documentId, pdfDoc, appendedPages };
}

/**
 * Embebe la página de leyenda dentro de `savePdf` (ADR-059 §6): mismas
 * cuatro llamadas de pdf-lib que `appendPage` (embed + `addPage` +
 * `drawImage`), pero SIN pasar por ella -- la leyenda no tiene `pageIndex`
 * del que ser idempotente (no es una página del documento, caso 18/21).
 * Revierte cualquier página agregada a mitad de ESTE intento antes de
 * relanzar, mismo criterio que `appendPage`.
 */
async function embedLegendPage(
  pdfDoc: PDFDocument,
  legendImage: EncodedPageImage,
  pageWidthPt: number,
  pageHeightPt: number,
  abortSignal: AbortSignal,
  documentId: string,
): Promise<void> {
  const pageCountBeforeAttempt = pdfDoc.getPageCount();
  try {
    const embeddedImage: PDFImage = await raceAbort(
      legendImage.format === "jpeg"
        ? pdfDoc.embedJpg(legendImage.bytes)
        : pdfDoc.embedPng(legendImage.bytes),
      abortSignal,
      documentId,
    );

    if (abortSignal.aborted) throw new CancelledError(documentId);

    const pdfPage = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    pdfPage.drawImage(embeddedImage, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });
  } catch (err: unknown) {
    while (pdfDoc.getPageCount() > pageCountBeforeAttempt) {
      pdfDoc.removePage(pdfDoc.getPageCount() - 1);
    }
    if (err instanceof CancelledError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new ExportFailedError(documentId, reason);
  }
}

function applyMetadata(pdfDoc: PDFDocument, metadata: ExportMetadata): void {
  pdfDoc.setProducer(metadata.producer);
  pdfDoc.setCreator(metadata.creator);
  pdfDoc.setCreationDate(metadata.creationDate);
  if (metadata.title !== undefined) {
    pdfDoc.setTitle(metadata.title);
  }
}

/**
 * `save` (ADR-047 §1/§4): aplica la metadata (ya sanitizada en host) y
 * serializa con `useObjectStreams: true`. Tras éxito, el estado devuelto es
 * `EMPTY_ASSEMBLER_STATE` (`Export_Engine.md` §13 caso 14); un fallo retiene
 * el `pdfDoc` sin cambios, para permitir reintentar sobre el mismo documento.
 */
export async function savePdf(
  state: AssemblerState,
  payload: ExportSavePayload,
  opts: AssemblerRunOptions,
): Promise<SavePdfResult> {
  const { documentId, metadata, legendImage, legendPageWidthPt, legendPageHeightPt } = payload;

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  if (state.documentId !== documentId || state.pdfDoc === null) {
    throw new ExportFailedError(
      documentId,
      "save invocado sin un PDFDocument en construcción para este documentId.",
    );
  }

  const pdfDoc = state.pdfDoc;

  // ADR-059 §6: la leyenda se embebe acá, antes de la metadata. Un reintento
  // de ESTE save (saveWithRetry, host) reusa el mismo pdfDoc ya mutado si un
  // intento previo llegó a embeber la leyenda y recién falló en
  // pdfDoc.save() -- sin este guard, ese reintento la embebería dos veces.
  // `state.appendedPages.size` es el conteo de páginas "reales" del
  // documento (únicas, por pageIndex): más páginas que eso en el pdfDoc solo
  // puede ser la leyenda de un intento anterior.
  if (
    legendImage !== undefined &&
    legendPageWidthPt !== undefined &&
    legendPageHeightPt !== undefined &&
    pdfDoc.getPageCount() === state.appendedPages.size
  ) {
    await embedLegendPage(
      pdfDoc,
      legendImage,
      legendPageWidthPt,
      legendPageHeightPt,
      opts.abortSignal,
      documentId,
    );
  }

  applyMetadata(pdfDoc, metadata);

  try {
    const bytes = await raceAbort(
      pdfDoc.save({ useObjectStreams: true }),
      opts.abortSignal,
      documentId,
    );
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return { buffer, state: EMPTY_ASSEMBLER_STATE };
  } catch (err: unknown) {
    if (err instanceof CancelledError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new ExportFailedError(documentId, reason);
  }
}

/**
 * `CANCEL`/`DISPOSE` (ADR-047 §4, `05_Worker_Architecture.md` §7.5):
 * descarta el `PDFDocument` parcial. Se aplica incondicionalmente ante
 * cualquier `CANCEL` (no discrimina por `jobId`/`signalId`): el ExportWorker
 * ensambla un documento a la vez (pool de `size: 1`, sin cola prioritaria
 * multi-worker — ADR-047 §2), así que un `CANCEL` siempre corresponde al
 * único export en curso.
 */
export function discardState(): AssemblerState {
  return EMPTY_ASSEMBLER_STATE;
}
