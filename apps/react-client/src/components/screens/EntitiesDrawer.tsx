/**
 * `EntitiesDrawer` — la barra lateral de entidades cuando no hay ancho para
 * tenerla al lado del visor (`layoutMode.ts` modo `drawer`,
 * `ui/UX_Guidelines.md` §2).
 *
 * **Por qué cajón y no tabs.** La alternativa era alternar "Entidades" y
 * "Documento" como regiones excluyentes, que es lo que hacía el
 * `SideBySideViewer` retirado. Se eligió el cajón porque el bucle de trabajo
 * es *mirar una entidad y comprobarla en el documento*: con tabs, cada
 * comprobación es un cambio de contexto completo; con el cajón, el documento
 * es lo que queda debajo y vuelve con un `Escape`.
 *
 * **Modal a propósito.** Mientras está abierto tapa el visor, así que se
 * comporta como un diálogo: `aria-modal`, foco adentro al abrir, `Escape` y
 * click en el fondo para cerrar. Anunciarlo como región no modal mentiría
 * sobre lo que hay debajo.
 */

import { XIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export interface EntitiesDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}

export function EntitiesDrawer({ open, onOpenChange, children }: EntitiesDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/*
        El fondo no lleva `role`: es superficie de cierre, no un control que
        alguien deba encontrar por teclado — para eso están `Escape` y el botón
        de cerrar del encabezado.
      */}
      <div
        className="absolute inset-0 z-40 bg-black/20"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Entidades"
        tabIndex={-1}
        className="absolute inset-y-0 left-0 z-50 flex w-[min(22rem,90vw)] flex-col border-r border-border bg-bg-primary shadow-md focus:outline-none"
      >
        {/*
          Sin título propio: `EntitiesPanel` ya renderiza su encabezado
          "ENTIDADES" justo debajo, y ponerle otro acá lo mostraba dos veces.
          Queda solo el cierre — el nombre del cajón vive en su `aria-label`,
          que es donde lo necesita un lector de pantalla.
        */}
        <div className="flex items-center justify-end px-2 pt-2">
          <button
            type="button"
            aria-label="Cerrar entidades"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {/*
          `min-h-0`: el contenido scrollea adentro del cajón. Sin esto el árbol
          empuja el alto y el scroll se va al contenedor, que en un cajón fijo
          no tiene a dónde crecer.
        */}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </>
  );
}
