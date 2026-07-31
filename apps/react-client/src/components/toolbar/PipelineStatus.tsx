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
 * `PIPELINE_FAILED` (genérico y para `NER_MODEL_MISSING`), pero ningún doc
 * (`core/Contracts.md` `IPipelineOrchestrator`, `core/Orchestrator.md`) define
 * un método de "reintentar" genérico: `reanalyze` con el patch sin cambios es
 * no-op (ADR-038 §1) y no hay `orchestrator.retry()`. Implementar "Reintentar"
 * como un nuevo `importDocument` arriesga descartar la sesión de edición que
 * ADR-038 existe justamente para preservar. Este PR implementa solo lo
 * inequívoco: el mensaje de error + "Cerrar documento" (`actions.closeDocument`)
 * siempre, y "Desactivar NER y reanalizar" (`actions.reanalyze({ ner: {
 * enabled: false } })`) cuando `error.code === "NER_MODEL_MISSING"`.
 */

import { actions } from "../../core-adapter/actions.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { Banner } from "../common/Banner.js";
import { Button } from "../common/Button.js";

import { getPipelineErrorPresentation } from "./pipelineErrorPresentation.js";
import { getPipelineStageLabel } from "./pipelineStageLabel.js";

export function PipelineStatus() {
  const stage = usePipelineStore((state) => state.stage);
  const progress = usePipelineStore((state) => state.progress);
  const current = usePipelineStore((state) => state.current);
  const total = usePipelineStore((state) => state.total);
  const modelLoading = usePipelineStore((state) => state.modelLoading);
  const exportProgress = usePipelineStore((state) => state.exportProgress);
  const error = usePipelineStore((state) => state.error);

  const errorPresentation = getPipelineErrorPresentation(stage, error);

  if (errorPresentation) {
    return (
      <Banner
        variant="error"
        actions={
          <>
            {errorPresentation.offerDisableNerReanalyze ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void actions.reanalyze({ ner: { enabled: false } });
                }}
              >
                Desactivar NER y reanalizar
              </Button>
            ) : null}
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

  const label = getPipelineStageLabel({
    stage,
    progress,
    current,
    total,
    modelLoading,
    exportProgress,
  });
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div className="flex min-w-[220px] flex-col gap-1" role="status" aria-live="polite">
      <span className="text-xs font-medium text-text-primary">{label}</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
