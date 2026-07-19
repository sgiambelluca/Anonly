/**
 * `GroupContextMenu` (`ui/Components.md` §3.5).
 *
 * Alcance reducido al pedido explícito de este PR (prompt del Hito 10 PR8:
 * "acceso a fusionar/dividir" en cada grupo del árbol): expone únicamente
 * "Fusionar con…" y "Dividir…". El catálogo completo de §3.5 agrega "Ver
 * ocurrencias", "Editar valor canónico" y "Eliminar grupo" — no incluidos acá
 * (ver reporte de este PR: "Ver ocurrencias" depende de un campo `value` que
 * `OccurrenceRef` no tiene, `03_Data_Model.md` §8; "Eliminar grupo" ya queda
 * cubierto funcionalmente por el checkbox de habilitar/deshabilitar del propio
 * `EntityGroupItem`; "Editar valor canónico" no está en el pedido concreto de
 * este PR).
 *
 * Sin `@radix-ui/react-dropdown-menu` en el proyecto (no está en
 * `package.json`, agregarlo requeriría ADR — `ai/Code_Standards.md` P-9): este
 * menú es un disclosure accesible hecho a mano (trigger + `role="menu"`,
 * cierre por click-fuera/Escape/selección), sin dependencias nuevas.
 */

import { MoreHorizontalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface GroupContextMenuProps {
  readonly onMerge: () => void;
  readonly onSplit: () => void;
}

export function GroupContextMenu({ onMerge, onSplit }: GroupContextMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent): void {
      // `event.target` es `EventTarget | null`; en un evento de mouse del
      // documento siempre es un `Node` real (narrowing seguro, documentado
      // aquí — `ai/Code_Standards.md` §2 "as solo para narrowing seguro").
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    }
    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Más acciones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-md p-1 text-text-secondary hover:bg-bg-tertiary"
      >
        <MoreHorizontalIcon className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Acciones del grupo"
          className="absolute right-0 z-50 mt-1 w-40 rounded-md border border-border bg-bg-primary py-1 shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onMerge();
            }}
            className="block w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary"
          >
            Fusionar con…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSplit();
            }}
            className="block w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary"
          >
            Dividir…
          </button>
        </div>
      ) : null}
    </div>
  );
}
