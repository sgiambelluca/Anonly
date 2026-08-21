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
 *
 * "Desactivar NER y reanalizar" **también escribe `settings.store.nerEnabled`**
 * (tras el éxito del `reanalyze`): es la mitad que faltaba de esa recuperación
 * desde el PR6 del Hito 10. Sin ella el toggle de `SettingsDialog` quedaba
 * desincronizado y, desde PR16.5 —que deriva el `EngineConfig` del bootstrap
 * de `settings.store`—, la próxima carga de la pestaña reabría el Core con
 * NER activado.
 */

import { PipelineStage } from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { useSettingsStore } from "../../store/settings.store.js";
import { Banner } from "../common/Banner.js";
import { Button } from "../common/Button.js";

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
                  void actions
                    .reanalyze({ ner: { enabled: false } })
                    .then(() => {
                      // El store se sincroniza con lo que el usuario acaba de
                      // decidir, y solo si el reanalyze salió bien (mismo
                      // criterio de orden que `SettingsDialog`). Sin esto el
                      // toggle de Settings seguía mostrando NER activado, y
                      // —desde PR16.5, que cablea `settings.store` →
                      // `EngineConfig` en el bootstrap— al recargar la pestaña
                      // el Core volvía a arrancar con NER activado, o sea de
                      // vuelta al mismo `NER_MODEL_MISSING` del que el usuario
                      // acababa de salir. `React_Client.md` §3.7/§8.
                      useSettingsStore.setState({ nerEnabled: false });
                      useSettingsStore.getState().persist();
                    })
                    .catch(() => {
                      // `actions.reanalyze` propaga el rechazo del Orchestrator
                      // (p. ej. el `InvalidInputError` que ADR-081 agregó). Sin
                      // este catch terminal sería un unhandled rejection y el
                      // store quedaría sin sincronizar en silencio. El banner de
                      // error ya está en pantalla: no hay UI nueva que mostrar,
                      // lo que importa es no dejar la promesa suelta ni escribir
                      // el store como si el reanalyze hubiera funcionado.
                    });
                }}
              >
                Seguir sin detectar nombres
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
