/**
 * `exportProgressFormat.ts` — formateo puro de progreso/tamaño para
 * `ExportProgress` (`ui/Components.md` §7.2: "barra de progreso con
 * current/total"). Distinto del texto de `toolbar/pipelineStageLabel.ts`
 * ("Exportando página N de M…", para la Toolbar): este es el usado dentro del
 * propio modal de export.
 */

export interface ExportProgressSnapshot {
  readonly current: number;
  readonly total: number;
}

export function formatExportProgressLabel(progress: ExportProgressSnapshot | null): string {
  if (progress === null || progress.total <= 0) return "Preparando exportación…";
  return `Página ${progress.current} de ${progress.total}`;
}

export function exportProgressPercent(progress: ExportProgressSnapshot | null): number {
  if (progress === null || progress.total <= 0) return 0;
  const ratio = progress.current / progress.total;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

const BYTES_PER_KB = 1024;
const KB_PER_MB = 1024;

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  const kb = bytes / BYTES_PER_KB;
  if (kb < KB_PER_MB) return `${kb.toFixed(0)} KB`;
  const mb = kb / KB_PER_MB;
  return `${mb.toFixed(1)} MB`;
}
