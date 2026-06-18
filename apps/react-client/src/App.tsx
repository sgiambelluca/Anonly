/**
 * App — Esqueleto del layout de 4 paneles (Hito 1).
 *
 * Fuente de verdad: docs/ui/UX_Guidelines.md §2 y docs/ui/Components.md §1.
 *
 * En Hito 1 esto es un placeholder sin lógica: muestra el layout correcto
 * con estados vacíos definidos en docs/ui/UX_Guidelines.md §11.
 * La lógica real (core-adapter, stores, componentes) se implementa en Hito 10.
 */

import { UploadIcon, FileTextIcon, ShieldIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";

export function App() {
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

function Toolbar() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-bg-primary px-4">
      <div className="flex items-center gap-3">
        <ShieldIcon className="h-6 w-6 text-accent" aria-hidden />
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Anonly</span>
          <span className="text-xs text-text-secondary">Anonimización documental local</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="anonly-button-primary" disabled>
          <UploadIcon className="h-4 w-4" aria-hidden />
          Importar PDF
        </button>
        <button type="button" className="anonly-button-ghost" disabled aria-label="Configuración">
          <SettingsIcon className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </header>
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
  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <section className="flex flex-1 flex-col overflow-hidden border-b border-border">
        <PanelHeader title="PDF original" />
        <EmptyState
          icon={<FileTextIcon className="h-8 w-8" aria-hidden />}
          title="Sin documento cargado"
          description="El PDF original aparecerá acá con highlights de grupos habilitados."
        />
      </section>
      <section className="flex flex-1 flex-col overflow-hidden">
        <PanelHeader title="PDF anonimizado" />
        <EmptyState
          icon={<FileTextIcon className="h-8 w-8" aria-hidden />}
          title="Sin documento cargado"
          description="La vista previa lado a lado aparecerá acá."
        />
      </section>
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
