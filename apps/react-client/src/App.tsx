/**
 * App — Esqueleto del layout de 4 paneles (Hito 1, ampliado en Hitos 10
 * PR1/PR5/PR6/PR7).
 *
 * Fuente de verdad: docs/ui/UX_Guidelines.md §2/§11 y docs/ui/Components.md §1.
 *
 * Este PR (Hito 10, PR7 "Visor") reemplaza el placeholder del área de
 * visores por `SideBySideViewer` + `ZoomControls` cuando hay un documento
 * cargado (`document.store.id !== null`); el Hero sigue siendo el estado
 * vacío sin documento (`UX_Guidelines.md` §11, fila "App recién abierta, sin
 * documento"). Los paneles de Entidades/Reglas siguen siendo el placeholder
 * de PR1: esos componentes llegan en los PRs 8-9 (fuera de alcance de este
 * PR).
 */

import {
  FileTextIcon,
  LockIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  UploadIcon,
  WifiOffIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { Toolbar } from "./components/toolbar/Toolbar.js";
import { SideBySideViewer } from "./components/viewer/SideBySideViewer.js";
import { ZoomControls } from "./components/viewer/ZoomControls.js";
import { initCore } from "./core-adapter/index.js";
import { useDocumentStore } from "./store/document.store.js";

export function App() {
  useEffect(() => {
    initCore().catch((error: unknown) => {
      // console.error es la única salida disponible acá sin ocultar el fallo
      // (no-console permite warn/error en apps/, Code_Standards.md §12). No
      // hay UI dedicada para un fallo de initCore en sí (distinto de
      // PIPELINE_FAILED, que sí cubre PipelineStatus): initCore falla solo si
      // createCore() en sí lanza, un caso fuera del alcance de este PR.
      console.error("No se pudo inicializar el Core.", error);
    });
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <LeftPanel />
        <RightPanel />
      </div>
    </div>
  );
}

function LeftPanel() {
  return (
    <aside className="flex w-1/3 min-w-[280px] max-w-[480px] flex-col border-r border-border bg-bg-primary">
      <section className="flex flex-1 flex-col overflow-hidden border-b border-border">
        <PanelHeader title="Entidades" />
        <EmptyState
          icon={<FileTextIcon className="h-8 w-8" aria-hidden />}
          title="Sin documento"
          description="Cargá un PDF para empezar a detectar entidades."
        />
      </section>
      <section className="flex flex-1 flex-col overflow-hidden">
        <PanelHeader title="Reglas" />
        <EmptyState
          icon={<FileTextIcon className="h-8 w-8" aria-hidden />}
          title="Sin reglas"
          description="Aún no hay reglas. Se crean desde el panel cuando hay grupos."
        />
      </section>
    </aside>
  );
}

function RightPanel() {
  const hasDocument = useDocumentStore((state) => state.id !== null);

  if (!hasDocument) {
    // Sin documento cargado, el área de visores muestra el Hero de bienvenida
    // (docs/ui/UX_Guidelines.md §11, fila "App recién abierta, sin documento").
    return (
      <main className="flex flex-1 flex-col overflow-hidden">
        <Hero />
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center justify-end border-b border-border bg-bg-primary px-3">
        <ZoomControls />
      </div>
      <SideBySideViewer />
    </main>
  );
}

function Hero() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto p-8 text-center">
      <div className="flex max-w-lg flex-col items-center gap-3">
        <ShieldCheckIcon className="h-10 w-10 text-accent" aria-hidden />
        <h1 className="text-xl font-semibold text-text-primary">
          Anonimizá PDFs sin que salgan de tu computadora
        </h1>
        <p className="text-sm text-text-secondary">
          Arrastrá un documento o elegilo desde tu equipo para detectar y agrupar información
          sensible antes de exportar una copia anonimizada.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border bg-bg-secondary p-8">
        <UploadIcon className="h-8 w-8 text-text-secondary" aria-hidden />
        <p className="text-sm font-medium text-text-primary">Arrastrá un PDF aquí</p>
        <p className="text-xs text-text-secondary">o</p>
        <button type="button" className="anonly-button-primary" disabled>
          Examinar archivos
        </button>
      </div>

      <dl className="grid w-full max-w-lg grid-cols-1 gap-4 sm:grid-cols-3">
        <Feature
          icon={<WifiOffIcon className="h-5 w-5" aria-hidden />}
          title="100% local"
          description="Tus documentos nunca salen del navegador."
        />
        <Feature
          icon={<ScanSearchIcon className="h-5 w-5" aria-hidden />}
          title="Detección automática"
          description="DNI, CUIT, emails, teléfonos, direcciones y más."
        />
        <Feature
          icon={<LockIcon className="h-5 w-5" aria-hidden />}
          title="Export no recuperable"
          description="El PDF final se reconstruye desde cero."
        />
      </dl>
    </div>
  );
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 text-center sm:items-start sm:text-left">
      <div className="flex items-center gap-2 text-text-primary">
        <span className="text-accent">{icon}</span>
        <dt className="text-sm font-semibold">{title}</dt>
      </div>
      <dd className="text-xs text-text-secondary">{description}</dd>
    </div>
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
