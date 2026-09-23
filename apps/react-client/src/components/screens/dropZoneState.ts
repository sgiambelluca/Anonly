/**
 * `dropZoneState.ts` — cuál de los cuatro estados muestra la zona de carga
 * (ADR-168 §2, `UX_Guidelines.md` §2.1).
 *
 * | Estado | Cuándo |
 * |---|---|
 * | `idle` | sin archivo |
 * | `dragging` | `dragover` |
 * | `opening` | entre el drop y `DOCUMENT_IMPORTED` |
 * | `error` | archivo rechazado o fallo de importación (ADR-168 §4) |
 *
 * Precedencia: abrir gana a todo (mientras se abre no hay otro archivo que
 * soltar); arrastrar encima gana al error (el usuario ya está corrigiendo, y
 * "soltá el archivo" es lo que tiene que leer en ese momento). El recuadro no
 * cambia de tamaño entre estados: eso lo garantiza el componente (UX-10).
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

export type DropZoneState = "idle" | "dragging" | "opening" | "error";

export function resolveDropZoneState(input: {
  readonly dragging: boolean;
  readonly opening: boolean;
  readonly hasError: boolean;
}): DropZoneState {
  if (input.opening) return "opening";
  if (input.dragging) return "dragging";
  if (input.hasError) return "error";
  return "idle";
}

export const PDF_MIME = "application/pdf";

/**
 * `type` vacío es un caso real y **no** es un rechazo: algunos navegadores no
 * resuelven el MIME de un archivo arrastrado desde ciertos orígenes. Se cae a
 * la extensión antes de rechazar; el PDF Engine valida de verdad y emite
 * `PDF_INVALID` → `PIPELINE_FAILED` si el archivo no sirve, así que este
 * chequeo solo existe para dar un mensaje inmediato en el caso obvio.
 */
export function looksLikePdf(file: { readonly type: string; readonly name: string }): boolean {
  if (file.type === PDF_MIME) return true;
  if (file.type === "") return file.name.toLowerCase().endsWith(".pdf");
  return false;
}
