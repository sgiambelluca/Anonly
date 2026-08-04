/**
 * `SideBySideViewer` (`ui/Components.md` §5.1, reescrito por
 * `adr/ADR-054-Scroll-Independiente-Por-Panel.md` §1/§2/§3).
 *
 * Compone dos `PdfViewer` (original + anonimizado) con **scroll totalmente
 * independiente por panel**: cada uno tiene su propio `visibleRange`/
 * `currentPageIndex` en `viewer.store` (por `kind`, ADR-054 §1) y monta/pide
 * renders por su cuenta. Mover uno no mueve al otro por defecto.
 *
 * **Sincronización opcional** (`settings.scrollSyncEnabled`, default
 * apagado): cuando está prendida, un módulo imperativo fuera de
 * React/Zustand (`scrollSyncController.ts`, ADR-054 §3) sincroniza
 * `scrollTop` a nivel de píxel entre los dos paneles, sin temporizadores — la
 * convergencia sale de la idempotencia. Ese controller se crea **una sola
 * vez acá** (no en cada `PdfViewer`: tiene que ser el mismo objeto para que
 * los dos paneles se registren en él) y se pasa como prop a cada `PdfViewer`.
 * El control que prende/apaga la sincronización (`ScrollSyncToggle`) vive en
 * la barra del visor (`App.tsx`), no acá — este componente solo lee
 * `settings.scrollSyncEnabled` para propagarlo al controller.
 *
 * Mobile/tablet (< 1024 px, breakpoint `lg` de Tailwind): tabs en lugar de
 * lado a lado (`Components.md` §5.1). Ambos `PdfViewer` permanecen montados
 * (se ocultan con `hidden`, no se desmontan) para no perder el estado interno
 * del `IntersectionObserver` al cambiar de tab. Con la sincronización
 * prendida, el panel que se vuelve visible (cambio de tab, o la ventana que
 * ensancha a `≥ lg`) se realinea una vez contra el otro — lo resuelve el
 * `ResizeObserver` de `PageVirtualizer` sobre la transición de alto 0 a
 * alto > 0, sin código acá.
 *
 * Nota de ambigüedad detectada (ver reporte del PR): `viewer.store.sideBySide`
 * (`React_Client.md` §3.5) no tiene setter ni un componente que lo consuma en
 * `Components.md`/`React_Client.md` — el toggle mobile/desktop de esta
 * sección es puramente una media query CSS, no está condicionado por ese
 * campo del store. ADR-054 §7 decide explícitamente no reutilizarlo para el
 * control de sincronización de scroll. Este componente no lo lee.
 */

import { useEffect, useRef, useState } from "react";

import { useSettingsStore } from "../../store/settings.store.js";

import { PdfViewer } from "./PdfViewer.js";
import { createScrollSyncController, type ScrollSyncController } from "./scrollSyncController.js";

type MobileTab = "original" | "anonymized";

const TAB_LABEL: Readonly<Record<MobileTab, string>> = {
  original: "Original",
  anonymized: "Anonimizado",
};

export function SideBySideViewer() {
  const [mobileTab, setMobileTab] = useState<MobileTab>("original");
  const scrollSyncEnabled = useSettingsStore((state) => state.scrollSyncEnabled);

  // Un único controller para los dos PdfViewer de este componente (ADR-054
  // §3): tiene que ser el mismo objeto para que ambos paneles se registren
  // entre sí. Creado perezosamente una sola vez, sobrevive a los re-renders.
  const scrollSyncRef = useRef<ScrollSyncController | null>(null);
  if (scrollSyncRef.current === null) {
    scrollSyncRef.current = createScrollSyncController();
  }
  const scrollSync = scrollSyncRef.current;

  useEffect(() => {
    scrollSync.setEnabled(scrollSyncEnabled);
  }, [scrollSync, scrollSyncEnabled]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="flex shrink-0 border-b border-border lg:hidden"
        role="tablist"
        aria-label="Vista del documento"
      >
        <MobileTabButton tab="original" active={mobileTab === "original"} onSelect={setMobileTab} />
        <MobileTabButton
          tab="anonymized"
          active={mobileTab === "anonymized"}
          onSelect={setMobileTab}
        />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`min-w-0 flex-1 ${mobileTab === "original" ? "flex" : "hidden"} lg:flex`}>
          <PdfViewer kind="original" scrollSync={scrollSync} />
        </div>
        <div className="hidden w-px shrink-0 bg-border lg:block" />
        <div className={`min-w-0 flex-1 ${mobileTab === "anonymized" ? "flex" : "hidden"} lg:flex`}>
          <PdfViewer kind="anonymized" scrollSync={scrollSync} />
        </div>
      </div>
    </div>
  );
}

function MobileTabButton({
  tab,
  active,
  onSelect,
}: {
  readonly tab: MobileTab;
  readonly active: boolean;
  readonly onSelect: (tab: MobileTab) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`flex-1 border-b-2 px-3 py-2 text-xs font-medium ${
        active
          ? "border-accent text-accent"
          : "border-transparent text-text-secondary hover:text-text-primary"
      }`}
      onClick={() => onSelect(tab)}
    >
      {TAB_LABEL[tab]}
    </button>
  );
}
