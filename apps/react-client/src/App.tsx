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
 * en los tres niveles de modo del propio árbol.
 *
 * **`PasswordDialog` se monta acá, fuera de las tres fases**, y no adentro de
 * `Toolbar` como antes. Vivía ahí apoyado en que la toolbar estaba siempre en
 * pantalla —su propio comentario decía "se monta siempre acá, no depende de
 * `stage`"—, y este ADR rompió esa premisa al sacar la toolbar de `load` y de
 * `scan`. `PDF_PASSWORD_REQUIRED` llega durante `Extracting`, o sea **dentro
 * de la fase `scan`**: con el diálogo montado en la toolbar, un PDF protegido
 * dejaba de poder abrirse y la pantalla de escaneo giraba para siempre sin
 * pedir nada. Lo encontró el Escenario 3 de E2E.
 */

import type { TextMatch } from "@anonly/anonymization-core";
import { FileTextIcon, PanelLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { ToastHost } from "./components/common/ToastHost.js";
import { UpdateNotice } from "./components/common/UpdateNotice.js";
import { ManualOverlapDialogHost } from "./components/conflicts/ManualOverlapDialogHost.js";
import { EntitiesPanel } from "./components/entities/EntitiesPanel.js";
import { hasAnyGroup } from "./components/entities/entityTree.js";
import type { AppPhase } from "./components/screens/appPhase.js";
import { EntitiesDrawer } from "./components/screens/EntitiesDrawer.js";
import { LoadScreen } from "./components/screens/LoadScreen.js";
import { ScanScreen } from "./components/screens/ScanScreen.js";
import { TooNarrowScreen } from "./components/screens/TooNarrowScreen.js";
import { useAppPhase } from "./components/screens/useAppPhase.js";
import { useHistoryShortcuts } from "./components/screens/useHistoryShortcuts.js";
import { useLayoutMode } from "./components/screens/useLayoutMode.js";
import { PasswordDialog } from "./components/toolbar/PasswordDialog.js";
import { Toolbar } from "./components/toolbar/Toolbar.js";
import { DocumentSearchBox } from "./components/viewer/DocumentSearchBox.js";
import { PdfViewer } from "./components/viewer/PdfViewer.js";
import { SelectionHintCard } from "./components/viewer/SelectionHintCard.js";
import { ViewerModeToggle } from "./components/viewer/ViewerModeToggle.js";
import { ZoomControls } from "./components/viewer/ZoomControls.js";
import { initCore } from "./core-adapter/index.js";
import { deriveEngineConfigOverrides } from "./core-adapter/settingsToEngineConfig.js";
import { useEntitiesStore } from "./store/entities.store.js";
import { useSettingsStore } from "./store/settings.store.js";
import { applyTheme } from "./theme.js";

export function App() {
  useEffect(() => {
    // PR16.5 (ADR-048 §7 punto 2): hidratar los settings persistidos ANTES
    // de crear el core y derivar el EngineConfigOverrides (§3.7) para que
    // nerEnabled/ocrLanguages/performancePreset guardados en una sesión
    // previa tengan efecto real en el próximo createCore, no solo en
    // reanalyze con documento abierto.
    useSettingsStore.getState().load();
    // Después de hidratar y antes del primer render con contenido: si se
    // aplicara más tarde, la app parpadearía en claro antes de pasar a oscuro.
    applyTheme(useSettingsStore.getState().theme);
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

  return (
    <>
      {renderPhase(phase)}
      {/*
        Fuera del `switch` de fases a propósito — ver la cabecera. Se abre sola
        con `PDF_PASSWORD_REQUIRED`, que llega durante `Extracting`, y esa
        etapa cae en la fase `scan`.
      */}
      <PasswordDialog />
      {/*
        Fuera del `switch` de fases, mismo criterio que `PasswordDialog`: una
        actualización puede quedar lista mientras el usuario está en cualquier
        pantalla, incluida la de análisis. Se renderiza a sí mismo como
        flotante, así que no altera el layout de ninguna fase.
      */}
      <UpdateNotice />
    </>
  );
}

function renderPhase(phase: AppPhase): ReactNode {
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

  return <WorkLayout />;
}

/**
 * Panel de trabajo, en las tres formas que decide `layoutMode.ts` (§19 de
 * `roadmap/Post_Hito10.8_Pendientes.md` explica qué se rompió y por qué son
 * tres y no dos).
 *
 * El cajón se cierra solo al pasar a `wide`: si no, quedaría un overlay
 * abierto sobre un layout que ya tiene la barra al lado, con la lista dos
 * veces en pantalla.
 */
function WorkLayout() {
  const layout = useLayoutMode();
  // ADR-172 §3: `Ctrl/Cmd+Z` y `Ctrl/Cmd+Y` recorren la pila de deshacer.
  // Un solo listener, acá: solo existe mientras se ve la pantalla de trabajo.
  useHistoryShortcuts();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (layout !== "drawer") setDrawerOpen(false);
  }, [layout]);

  if (layout === "too-narrow") {
    return (
      <div className="h-screen overflow-hidden">
        <TooNarrowScreen />
      </div>
    );
  }

  if (layout === "drawer") {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        <Toolbar />
        {/* `relative`: es el marco de referencia del cajón y su fondo. */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center border-b border-border px-3 py-1.5">
            <button
              type="button"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-text-primary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <PanelLeftIcon className="h-4 w-4 text-text-secondary" aria-hidden />
              Entidades
            </button>
          </div>
          <RightPanel />
          <EntitiesDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SidebarContent />
          </EntitiesDrawer>
        </div>
        <ToastHost />
        <ManualOverlapDialogHost />
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
      <ToastHost />
      <ManualOverlapDialogHost />
    </div>
  );
}

function LeftPanel() {
  return (
    // `min-w` subido de 280 a 340 px (ADR-087, Contexto §1 hallazgo 2): a 280
    // no entraban a la vez el nombre de la entidad y su modo de reemplazo, y
    // el que se cortaba era el nombre — el dato con el que el usuario decide.
    // Ese mismo mínimo es lo que rompía el layout por debajo de 1024 px, y por
    // eso ahí el ancho lo resuelve el cajón en vez de esta columna.
    // ADR-169 §2: la lista pasó a tener columnas de ancho fijo (N.º, avisos,
    // apariciones, género, reemplazo, ⋯); con menos de 440 px el nombre —la
    // única columna que encoge— quedaba en unas pocas letras.
    <aside className="flex w-[38%] min-w-[440px] max-w-[520px] flex-col border-r border-border bg-bg-primary">
      <SidebarContent />
    </aside>
  );
}

/**
 * Contenido de la barra lateral, compartido por la columna (`wide`) y el
 * cajón (`drawer`) — el mismo árbol, en dos envases.
 */
function SidebarContent() {
  const hasGroups = useEntitiesStore((state) => hasAnyGroup(state.groupsByType));

  // El caso "sin documento" de `UX_Guidelines.md` §11 ya no llega acá: sin
  // documento la app está en `LoadScreen` y esta barra no se monta (ADR-087
  // §1). Lo que queda es el otro caso de esa tabla — hay documento y el
  // análisis no encontró nada — más la ventana en que el escaneo sigue
  // corriendo en segundo plano después del pase temprano (§7.2), donde el
  // árbol vacío es transitorio y el estado real lo dice la toolbar.
  if (hasGroups) return <EntitiesPanel />;
  return (
    <>
      <PanelHeader title="Entidades" />
      <EmptyState
        icon={<FileTextIcon className="h-8 w-8" aria-hidden />}
        title="Todavía no hay datos detectados"
        description="Si el análisis ya terminó, podés agregar los que falten a mano."
      />
    </>
  );
}

function RightPanel() {
  // El resultado activo de la lupa: lo elige la lupa (en la barra) y lo
  // muestra el visor (debajo). `scrollNonce` fuerza el salto aunque dos
  // resultados caigan en la misma página.
  const [activeMatch, setActiveMatch] = useState<TextMatch | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);

  function handleActiveMatchChange(match: TextMatch | null): void {
    setActiveMatch(match);
    if (match !== null) setScrollNonce((nonce) => nonce + 1);
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/*
        La lupa a la izquierda (ADR-169 §7: siempre visible, en las dos
        vistas), el toggle centrado y el zoom a la derecha (ADR-087 §2). La
        barra no cambia al conmutar.
      */}
      <div className="relative z-30 grid h-[52px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 border-b border-border bg-bg-primary px-4">
        <DocumentSearchBox onActiveMatchChange={handleActiveMatchChange} />
        <ViewerModeToggle />
        <div className="flex justify-end">
          <ZoomControls />
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <PdfViewer activeMatch={activeMatch} scrollNonce={scrollNonce} />
        <SelectionHintCard />
      </div>
    </main>
  );
}

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="flex h-9 items-center border-b border-border bg-bg-secondary px-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">{title}</h2>
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
      <p className="text-sm text-text-secondary">{description}</p>
    </div>
  );
}
