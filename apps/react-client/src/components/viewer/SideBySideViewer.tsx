/**
 * `SideBySideViewer` (`ui/Components.md` §5.1).
 *
 * Compone dos `PdfViewer` (original + anonimizado). El scroll vertical
 * sincronizado entre ambos (`React_Client.md` §7: "Lado a lado sincronizado:
 * scroll vertical compartido vía viewer.currentPageIndex") tiene dos mitades:
 * (1) ambos `PdfViewer` comparten `viewer.store.visibleRange`/`currentPageIndex`,
 * así que mover uno actualiza el rango que el otro monta; (2) `scrollSync.ts`
 * (usado dentro de `PageVirtualizer`) desplaza programáticamente el
 * contenedor del visor que NO originó el cambio, para que su posición de
 * scroll real siga a `currentPageIndex` — sin esto, el visor no scrolleado
 * desmontaría páginas que el usuario sigue mirando aunque el rango montado
 * fuera "correcto" (hallazgo del revisor, corregido).
 *
 * Mobile/tablet (< 1024 px, breakpoint `lg` de Tailwind): tabs en lugar de
 * lado a lado (`Components.md` §5.1). Ambos `PdfViewer` permanecen montados
 * (se ocultan con `hidden`, no se desmontan) para no perder el estado interno
 * del `IntersectionObserver` al cambiar de tab.
 *
 * Nota de ambigüedad detectada (ver reporte del PR): `viewer.store.sideBySide`
 * (`React_Client.md` §3.5) no tiene setter ni un componente que lo consuma en
 * `Components.md`/`React_Client.md` — el toggle mobile/desktop de esta
 * sección es puramente una media query CSS, no está condicionado por ese
 * campo del store. Este componente no lo lee.
 */

import { useState } from "react";

import { PdfViewer } from "./PdfViewer.js";

type MobileTab = "original" | "anonymized";

const TAB_LABEL: Readonly<Record<MobileTab, string>> = {
  original: "Original",
  anonymized: "Anonimizado",
};

export function SideBySideViewer() {
  const [mobileTab, setMobileTab] = useState<MobileTab>("original");

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
          <PdfViewer kind="original" />
        </div>
        <div className="hidden w-px shrink-0 bg-border lg:block" />
        <div className={`min-w-0 flex-1 ${mobileTab === "anonymized" ? "flex" : "hidden"} lg:flex`}>
          <PdfViewer kind="anonymized" />
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
