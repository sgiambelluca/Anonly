/**
 * `exportPhase.ts` — decide qué vista mostrar dentro de `ExportDialog`/
 * `ExportProgress` a partir de estado local (`submitted`) + `pipeline.store`.
 *
 * `hasError` es deliberadamente un `boolean` (no el `SerializedEngineError`
 * completo): `pipeline.store.error` (`React_Client.md` §3.4) es un campo
 * genérico compartido con `PIPELINE_FAILED` — no existe un campo dedicado a
 * `EXPORT_FAILED` (`bus-bridge.ts`, PR5). Dado que `ExportProgress` solo se
 * monta tras `submitted === true`, tratar cualquier `error` no nulo en ese
 * momento como "el export en curso falló" es la lectura razonable; ver el
 * comentario homólogo en `ExportProgress.tsx`.
 */

export type ExportPhase = "form" | "progress" | "done" | "error";

export interface ExportResultSnapshot {
  readonly blobUrl: string;
  readonly sizeBytes: number;
}

export function resolveExportPhase(
  submitted: boolean,
  exportResult: ExportResultSnapshot | null,
  hasError: boolean,
): ExportPhase {
  if (!submitted) return "form";
  // `exportResult` primero: si un reintento tuvo éxito después de un fallo
  // previo, `pipeline.store.error` puede seguir poblado con el fallo viejo
  // (nada lo limpia en éxito, bus-bridge.ts PR5) — el resultado manda.
  if (exportResult !== null) return "done";
  if (hasError) return "error";
  return "progress";
}
