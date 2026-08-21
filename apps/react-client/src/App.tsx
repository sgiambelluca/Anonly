/**
 * App — routing de los tres momentos (ADR-087 §1, `ui/UX_Guidelines.md` §2).
 *
 * `useAppPhase()` decide cuál se monta:
 *
 * - `load` → `LoadScreen` a pantalla completa. **No monta `Toolbar`**: sin
 *   documento, sus controles no tienen sobre qué operar, y el `ImportButton`
 *   de la toolbar dejaría dos caminos de carga compitiendo con la zona de
 *   drop —que es exactamente el problema que ADR-087 Contexto §1 hallazgo 5
 *   documenta, con la zona grande inerte y el botón chico funcionando.
 * - `scan` → `ScanScreen` a pantalla completa, **tampoco con `Toolbar`**: esa
 *   pantalla ya trae estado, progreso y "Cancelar" propios, y montar la
 *   toolbar arriba dejaba dos barras de progreso del mismo pipeline y dos
 *   botones "Cancelar" en pantalla a la vez.
 * - `work` → `Toolbar` + el panel de trabajo (árbol de entidades + visores).
 *
 * El panel de Reglas se retiró del layout (ADR-087 §3): su función vive ahora
 * en los tres niveles de modo del propio árbol. Mientras esos selectores no
 * estén implementados (etapa 3 del rediseño), la barra lateral es solo el
 * árbol — que ya es lo que ADR-087 §1 especifica para `work`.
 */

import { FileTextIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { EntitiesPanel } from "./components/entities/EntitiesPanel.js";
import { hasAnyGroup } from "./components/entities/entityTree.js";
import { LoadScreen } from "./components/screens/LoadScreen.js";
import { ScanScreen } from "./components/screens/ScanScreen.js";
import { useAppPhase } from "./components/screens/useAppPhase.js";
import { Toolbar } from "./components/toolbar/Toolbar.js";
import { PdfViewer } from "./components/viewer/PdfViewer.js";
import { ViewerModeToggle } from "./components/viewer/ViewerModeToggle.js";
import { ZoomControls } from "./components/viewer/ZoomControls.js";
import { initCore } from "./core-adapter/index.js";
import { deriveEngineConfigOverrides } from "./core-adapter/settingsToEngineConfig.js";
import { useEntitiesStore } from "./store/entities.store.js";
import { useSettingsStore } from "./store/settings.store.js";

export function App() {
  useEffect(() => {
    // PR16.5 (ADR-048 §7 punto 2): hidratar los settings persistidos ANTES
    // de crear el core y derivar el EngineConfigOverrides (§3.7) para que
    // nerEnabled/ocrLanguages/performancePreset guardados en una sesión
    // previa tengan efecto real en el próximo createCore, no solo en
    // reanalyze con documento abierto.
    useSettingsStore.getState().load();
    const overrides = deriveEngineConfigOverrides(useSettingsStore.getState());
    initCore(overrides).catch((error: unknown) => {
      // console.error es la única salida disponible acá sin ocultar el fallo
      // (no-console permite warn/error en apps/, Code_Standards.md §12). No
      // hay UI dedicada para un fallo de initCore en sí (distinto de
      // PIPELINE_FAILED, que sí cubre PipelineStatus): initCore falla solo si
      // createCore() en sí lanza, un caso fuera del alcance de este PR.
      console.error("No se pudo inicializar el Core.", error);
    });
  }, []);

  const phase = useAppPhase();

  if (phase === "load") {
    return (
      <div className="h-screen overflow-hidden">
        <LoadScreen />
      </div>
    );
  }

  if (phase === "scan") {
    // Sin `Toolbar`: `ScanScreen` ya muestra estado, progreso y "Cancelar", y
    // montar la toolbar acá los duplicaba —dos barras de progreso del mismo
    // pipeline y dos botones "Cancelar" en pantalla al mismo tiempo—.
    // Verificado en el browser antes de corregirlo.
    return (
      <div className="h-screen overflow-hidden">
        <ScanScreen />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Toolbar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <LeftPanel />
        <RightPanel />
      </div>
    </div>
  );
}

function LeftPanel() {
  const hasGroups = useEntitiesStore((state) => hasAnyGroup(state.groupsByType));

  // El caso "sin documento" de `UX_Guidelines.md` §11 ya no llega acá: sin
  // documento la app está en `LoadScreen` y esta barra no se monta (ADR-087
  // §1). Lo que queda es el otro caso de esa tabla — hay documento y el
  // análisis no encontró nada — más la ventana en que el escaneo sigue
  // corriendo en segundo plano después del pase temprano (§7.2), donde el
  // árbol vacío es transitorio y el estado real lo dice la toolbar.
  return (
    <aside className="flex w-1/3 min-w-[280px] max-w-[480px] flex-col border-r border-border bg-bg-primary">
      {hasGroups ? (
        <EntitiesPanel />
      ) : (
        <>
          <PanelHeader title="Entidades" />
          <EmptyState
            icon={<FileTextIcon className="h-8 w-8" aria-hidden />}
            title="Todavía no hay datos detectados"
            description="Si el análisis ya terminó, podés agregar los que falten a mano."
          />
        </>
      )}
    </aside>
  );
}

function RightPanel() {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/*
        El toggle va centrado y el zoom a la derecha (ADR-087 §2): el toggle
        rotula qué se está mirando, así que compite mal contra el borde junto
        a controles secundarios.
      */}
      <div className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-bg-primary px-3">
        <div />
        <ViewerModeToggle />
        <div className="flex justify-end">
          <ZoomControls />
        </div>
      </div>
      <PdfViewer />
    </main>
  );
}

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="flex h-9 items-center border-b border-border bg-bg-secondary px-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{title}</h2>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="text-text-secondary opacity-40">{icon}</div>
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="text-xs text-text-secondary">{description}</p>
    </div>
  );
}
