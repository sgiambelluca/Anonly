/**
 * `PipelineStatus` (`ui/Components.md` §2.3).
 *
 * Lee `pipeline.store` (sin props) y muestra icono + texto según `stage`
 * (`ui/UX_Guidelines.md` §7.1), delegando el texto a `pipelineStageLabel.ts`.
 *
 * Decisión de estructura (indicada por el planificador para este PR): el
 * banner de `stage === Failed` que `ui/Components.md` §2.1 dibuja a nivel
 * `Toolbar` se implementa **acá adentro** en vez de en `Toolbar.tsx` — mismo
 * resultado visual (`Toolbar` solo renderiza `<PipelineStatus />` cuando
 * `stage !== Idle` y delega, sin lógica propia, `ui/Components.md` §2.1
 * "Acciones: ninguna directa; delega en hijos"). El mapeo de errores usa
 * `pipelineErrorPresentation.ts` (ver ese archivo para el porqué de un único
 * banner en vez de banner+toasts separados).
 *
 * Ambigüedad reportada (no implementada): `ui/React_Client.md` §8 y
 * `ui/Components.md` §2.1/§7.3 mencionan un botón "Reintentar" para
 * `PIPELINE_FAILED`, pero ningún doc (`core/Contracts.md`
 * `IPipelineOrchestrator`, `core/Orchestrator.md`) define un método de
 * "reintentar" genérico: `reanalyze` con el patch sin cambios es no-op
 * (ADR-038 §1) y no hay `orchestrator.retry()`. Implementar "Reintentar" como
 * un nuevo `importDocument` arriesga descartar la sesión de edición que
 * ADR-038 existe justamente para preservar. Se implementa solo lo inequívoco:
 * el mensaje de error + "Cerrar documento" (`actions.closeDocument`).
 *
 * **`NER_MODEL_MISSING` ya no ofrece continuar** (ADR-126 §2). Hasta acá el
 * banner traía "Seguir sin detectar nombres", que reanalizaba con NER apagado
 * y escribía `settings.store.nerEnabled`. Lo que producía ese botón es lo peor
 * que esta herramienta puede producir: un documento que llega a "Listo", se
 * exporta como anonimizado, y tiene los DNI y los emails tapados con **todos
 * los nombres intactos**. Que el detector más importante no cargue es un
 * fallo, y la salida de un fallo es reintentar — el mensaje lo dice
 * (`pipelineErrorPresentation.ts`).
 */

import { PipelineStage } from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { Banner } from "../common/Banner.js";
import { Button } from "../common/Button.js";

import { getIncompleteAnalysisNotice } from "./incompleteAnalysisNotice.js";
import { getPipelineErrorPresentation } from "./pipelineErrorPresentation.js";
import { getPipelineStageLabel } from "./pipelineStageLabel.js";

/** Stages en los que el pipeline ya no reporta progreso (ADR-087 §7.1). */
const TERMINAL_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Ready,
  PipelineStage.Done,
  PipelineStage.Cancelled,
]);

export function PipelineStatus() {
  const stage = usePipelineStore((state) => state.stage);
  const progress = usePipelineStore((state) => state.progress);
  const current = usePipelineStore((state) => state.current);
  const total = usePipelineStore((state) => state.total);
  const modelLoading = usePipelineStore((state) => state.modelLoading);
  const exportProgress = usePipelineStore((state) => state.exportProgress);
  const error = usePipelineStore((state) => state.error);
  const failedJobs = usePipelineStore((state) => state.failedJobs);

  const errorPresentation = getPipelineErrorPresentation(stage, error);

  if (errorPresentation) {
    return (
      <Banner
        variant="error"
        actions={
          <>
            <Button variant="danger" size="sm" onClick={() => actions.closeDocument()}>
              Cerrar documento
            </Button>
          </>
        }
      >
        {errorPresentation.message}
      </Banner>
    );
  }

  /*
   * "Terminó, pero incompleto". No es un `PIPELINE_FAILED` —el pipeline llegó
   * a `Ready` de verdad—, así que no pasa por `errorPresentation`; es un
   * estado propio que antes de este cambio no se mostraba en ningún lado.
   * Ver `incompleteAnalysisNotice.ts` para el caso que lo motivó.
   */
  const incomplete = getIncompleteAnalysisNotice(stage, failedJobs);
  if (incomplete) {
    return (
      <Banner
        variant="warning"
        actions={
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            Recargar
          </Button>
        }
      >
        {incomplete.message}
      </Banner>
    );
  }

  const label = getPipelineStageLabel({
    stage,
    progress,
    current,
    total,
    modelLoading,
    exportProgress,
  });
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  // ADR-087, Contexto §1 hallazgo 4: hasta acá la barra se renderizaba en todo
  // stage no-`Idle`, así que en `Ready` quedaba en `width: 0%` con el texto
  // "Listo" al lado — el elemento más grande de la toolbar mostrando "0 %"
  // mientras el texto decía "terminado". Una barra sin progreso que reportar
  // no se dibuja.
  const showProgressBar = !TERMINAL_STAGES.has(stage);

  return (
    // Sin `min-w` fijo (ADR-087 §7.1): los 220 px anteriores truncaban el
    // texto por debajo de ~1100 px de ventana y a 900 px la barra quedaba
    // tapada por el botón "Exportar".
    <div className="flex min-w-0 flex-col gap-1" role="status" aria-live="polite">
      <span className="truncate text-sm font-medium text-text-primary">{label}</span>
      {showProgressBar ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
