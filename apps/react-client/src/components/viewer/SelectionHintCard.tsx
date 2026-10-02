/**
 * `SelectionHintCard` — la tarjeta de descubrimiento sobre el visor
 * (ADR-169 §7, `Components.md` §5.4b).
 *
 * En las pruebas de usuario nada decía que se puede **seleccionar texto en el
 * original** para agregar una entidad. La tarjeta lo muestra con una animación
 * del gesto de clic y arrastre, *"Agregá entidades desde el documento"*, y se
 * cierra con "Entendido" para no volver (`settings.store.dismissedHints`,
 * persistido).
 *
 * **Solo en Original**: en Anonimizado no se puede señalar (UX_Guidelines
 * §5.4b). Es **flotante** sobre el visor: no empuja el documento (UX-10). La
 * animación vive detrás de `prefers-reduced-motion: no-preference`.
 */

import { dismissHint, useSettingsStore } from "../../store/settings.store.js";
import { useViewerStore } from "../../store/viewer.store.js";

export function SelectionHintCard() {
  const mode = useViewerStore((state) => state.mode);
  const dismissed = useSettingsStore((state) => state.dismissedHints.includes("selection-hint"));

  if (mode !== "original" || dismissed) return null;

  return (
    <div
      role="note"
      className="absolute left-1/2 top-4 z-20 flex w-[35rem] max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3.5 rounded-xl border border-border bg-bg-primary py-3 pl-3.5 pr-3 shadow-md"
    >
      <span
        aria-hidden
        className="relative flex h-[52px] w-[84px] shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-bg-secondary px-2.5 py-[9px]"
      >
        <span className="h-[5px] w-[58px] rounded-sm bg-border" />
        <span className="h-[5px] w-16 rounded-sm bg-border" />
        <span className="h-[5px] w-10 rounded-sm bg-border" />
        <span className="anonly-drag-rect absolute left-3 top-[19px] h-[11px] w-[52px] rounded-sm border-[1.5px] border-dashed border-accent bg-accent/10" />
        <svg
          className="anonly-drag-cursor absolute left-2 top-6"
          width="12"
          height="14"
          viewBox="0 0 12 14"
        >
          <path
            d="M1 1v11l3-3 2 4 2-1-2-4h4Z"
            className="fill-text-primary stroke-bg-primary"
            strokeWidth="1"
          />
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-text-primary">
          Agregá entidades desde el documento
        </span>
        <span className="text-sm leading-snug text-text-secondary">
          Hacé clic y arrastrá sobre el texto del PDF original para marcarlo y elegir qué es.
        </span>
      </span>
      <button
        type="button"
        onClick={() => dismissHint("selection-hint")}
        className="anonly-button-secondary h-9 shrink-0 border border-border"
      >
        Entendido
      </button>
    </div>
  );
}
