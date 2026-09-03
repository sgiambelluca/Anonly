/**
 * El estado del ensamblado, separado de `assembler.ts` **a propósito**.
 *
 * `assembler.ts` importa `pdf-lib` a nivel de módulo. `ExportEngine` necesita
 * `EMPTY_ASSEMBLER_STATE` como inicializador de campo —o sea un valor, no un
 * tipo— y eso alcanzaba para arrastrar `pdf-lib` entero al chunk inicial de la
 * app, aunque nadie exportara nunca un documento (ADR-099).
 *
 * Acá `PDFDocument` entra **solo como tipo** (`import type`, que TypeScript
 * borra al compilar), así que este módulo no tiene dependencias en tiempo de
 * ejecución y se puede importar estático sin costo.
 */
import type { PDFDocument } from "pdf-lib";

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

/**
 * `CANCEL`/`DISPOSE` (ADR-047 §4, `05_Worker_Architecture.md` §7.5):
 * descarta el `PDFDocument` parcial. Se aplica incondicionalmente ante
 * cualquier `CANCEL` (no discrimina por `jobId`/`signalId`): el ExportWorker
 * ensambla un documento a la vez (pool de `size: 1`, sin cola prioritaria
 * multi-worker — ADR-047 §2), así que un `CANCEL` siempre corresponde al
 * único export en curso.
 *
 * Vive acá y no en `assembler.ts` porque es puro —devuelve el estado vacío—
 * y `dispose()` lo llama en un camino síncrono: dejarlo del otro lado
 * obligaba a cargar `pdf-lib` para liberar algo que quizá nunca se cargó
 * (ADR-099).
 */
export function discardState(): AssemblerState {
  return EMPTY_ASSEMBLER_STATE;
}
