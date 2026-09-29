/**
 * `UnreadablePageStrip` — la franja de aviso de una página con contenido que
 * no se pudo leer (ADR-190 §4, `ui/Components.md` §5.4).
 *
 * Va **justo arriba de la imagen de la página, fuera de ella** (decisión del
 * humano, 2026-09-29): antes era una barra superpuesta a la parte inferior de
 * la imagen y tapaba exactamente el contenido que pide revisar.
 *
 * `PdfViewer` monta esta franja en **toda página marcada con `unreadableInk`**
 * y `pageSlots.ts` le reserva `UNREADABLE_STRIP_PX` de alto en la geometría del
 * visor. El alto es fijo y no depende de nada más: cuando la página recibe una
 * entidad el texto desaparece, pero la franja sigue ocupando su lugar, así que
 * agregar o quitar entidades no desplaza el layout (UX-10). La condición de
 * cuándo se ve el texto sigue viviendo en `unreadableInkWarning.ts`.
 */

import { AlertTriangleIcon } from "lucide-react";
import { memo } from "react";

import { pageHasEntity, useEntitiesStore } from "../../store/entities.store.js";

import { UNREADABLE_STRIP_PX } from "./pageSlots.js";
import { shouldShowUnreadableInkWarning } from "./unreadableInkWarning.js";

export interface UnreadablePageStripProps {
  readonly pageIndex: number;
  /** Ancho de la página (CSS px): la franja mide lo mismo que la imagen que tiene debajo. */
  readonly width: number;
}

function UnreadablePageStripImpl({ pageIndex, width }: UnreadablePageStripProps) {
  const hasEntity = useEntitiesStore((state) => pageHasEntity(state.groupsByType, pageIndex));
  // La franja solo se monta en páginas con `unreadableInk`, así que la marca
  // es siempre `true` acá; lo que cambia es si hay entidad.
  const showWarning = shouldShowUnreadableInkWarning(true, hasEntity);

  return (
    <div className="shrink-0" style={{ width, height: UNREADABLE_STRIP_PX }}>
      {showWarning ? (
        <div
          role="status"
          className="flex h-full w-full items-start gap-2 overflow-hidden border border-warning-strong/40 bg-warning/90 px-3 py-2 text-xs text-text-primary"
        >
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" aria-hidden />
          <span>
            Esta página tiene contenido que no se pudo leer. Revisala: si tiene datos sensibles, no
            se van a tapar solos.
          </span>
        </div>
      ) : null}
    </div>
  );
}

export const UnreadablePageStrip = memo(UnreadablePageStripImpl);
