/**
 * `ViewerModeToggle` (`ui/Components.md` §5.1, ADR-087 §2).
 *
 * Reemplaza a `SideBySideViewer`: hay **un** `PdfViewer` y este toggle decide
 * qué muestra. La comparación pasa de yuxtaposición a alternancia, y a cambio
 * el documento recibe todo el ancho.
 *
 * **El gate de `Ready` no es cosmético.** Antes de `Ready` los `replacements`
 * no existen —el Orchestrator los computa desde el snapshot de Grouping
 * (ADR-044)— y `Render_Engine.md` §13 caso 1 dice que un render `anonymized`
 * con `replacements: []` es **idéntico al original**. Hasta ADR-087 el panel
 * rotulado "PDF ANONIMIZADO" mostraba, durante todo el escaneo, el documento
 * sin anonimizar: un rótulo prometiendo que no hay datos sensibles sobre un
 * render que sí los tiene. Por eso la posición "Anonimizado" está deshabilitada
 * y no simplemente vacía — la vista no existe todavía, y decirlo es la única
 * respuesta honesta.
 *
 * `role="tablist"` y no un `Switch`: son dos vistas del mismo contenido, que es
 * exactamente lo que un tab describe. Un switch anunciaría "activado/
 * desactivado", que no es lo que pasa acá.
 */

import { PipelineStage } from "@anonly/anonymization-core";
import { useEffect } from "react";

import { usePipelineStore } from "../../store/pipeline.store.js";
import { useViewerStore, type ViewerKind } from "../../store/viewer.store.js";

const LABEL: Readonly<Record<ViewerKind, string>> = {
  original: "Original",
  anonymized: "Anonimizado",
};

const DISABLED_HINT = "Disponible cuando termine el análisis";

/**
 * `Done` entra junto con `Ready`: tras exportar, el documento sigue abierto y
 * el preview sigue siendo válido (mismo criterio que `exportButtonVisibility`).
 */
function isAnonymizedAvailable(stage: PipelineStage): boolean {
  return stage === PipelineStage.Ready || stage === PipelineStage.Done;
}

export function ViewerModeToggle() {
  const mode = useViewerStore((state) => state.mode);
  const stage = usePipelineStore((state) => state.stage);
  const available = isAnonymizedAvailable(stage);

  // Un `reanalyze` vuelve de `Ready` a `Detecting` (ADR-038 §5) y los
  // `replacements` dejan de ser válidos mientras dura. Sin esto, el visor se
  // quedaría en "Anonimizado" mostrando el render viejo como si siguiera
  // vigente — la misma promesa falsa que el gate existe para impedir.
  useEffect(() => {
    if (!available && mode === "anonymized") {
      useViewerStore.getState().setMode("original");
    }
  }, [available, mode]);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "d") return;
      event.preventDefault();
      const state = useViewerStore.getState();
      if (state.mode === "anonymized") {
        state.setMode("original");
      } else if (available) {
        state.setMode("anonymized");
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [available]);

  return (
    <div
      role="tablist"
      aria-label="Vista del documento"
      className="flex items-center gap-1 rounded-md bg-bg-tertiary p-0.5"
    >
      <ModeTab kind="original" active={mode === "original"} disabled={false} />
      <ModeTab kind="anonymized" active={mode === "anonymized"} disabled={!available} />
    </div>
  );
}

function ModeTab({
  kind,
  active,
  disabled,
}: {
  readonly kind: ViewerKind;
  readonly active: boolean;
  readonly disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      title={disabled ? DISABLED_HINT : undefined}
      // El motivo va en el nombre accesible, no solo en el `title`: un lector
      // de pantalla anuncia "no disponible" sin decir hasta cuándo, y esperar
      // es justamente lo único que el usuario puede hacer al respecto.
      aria-label={disabled ? `${LABEL[kind]} — ${DISABLED_HINT}` : undefined}
      onClick={() => useViewerStore.getState().setMode(kind)}
      className={`rounded px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? "bg-bg-primary text-text-primary shadow-sm"
          : "text-text-secondary hover:text-text-primary"
      } ${disabled ? "cursor-not-allowed opacity-50 hover:text-text-secondary" : ""}`}
    >
      {LABEL[kind]}
    </button>
  );
}
