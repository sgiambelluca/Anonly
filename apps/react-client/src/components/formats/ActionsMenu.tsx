/**
 * `ActionsMenu` — el menú ⋯ de las bandas y filas de «Formatos de detección»
 * (`Components.md` §13b.2).
 *
 * Mismo disclosure hecho a mano que `GroupContextMenu` (sin
 * `@radix-ui/react-dropdown-menu`, que pediría un ADR): botón + panel de botones,
 * cierre por clic fuera, `Escape` o selección. **A propósito no usa
 * `role="menu"`**, por la misma razón que el menú de las filas: ese rol promete
 * navegación con flechas que no está implementada, y los items se recorren con
 * `Tab`.
 *
 * El panel es **flotante**: no empuja nada (`UX_Guidelines.md` §11b.7).
 */

import { MoreHorizontalIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { observeMenuLayout, type MenuLayout } from "../entities/menuPlacement.js";

export interface ActionsMenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly danger?: boolean;
}

export interface ActionsMenuProps {
  /** Nombre accesible del botón y del grupo: «Acciones del tipo Historia clínica». */
  readonly label: string;
  readonly items: ReadonlyArray<ActionsMenuItem>;
}

export function ActionsMenu({ label, items }: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<MenuLayout>({ placement: "bottom", top: 0, maxHeight: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const menu = menuRef.current;
    if (container === null || menu === null) return;
    return observeMenuLayout(container, menu, (next) => {
      setLayout((previous) =>
        previous.placement === next.placement &&
        previous.top === next.top &&
        previous.maxHeight === next.maxHeight
          ? previous
          : next,
      );
    });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent): void {
      // En un evento de mouse del documento `target` es siempre un `Node`
      // (narrowing seguro, mismo criterio que `GroupContextMenu`).
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
    <div ref={containerRef} className="relative flex justify-center">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open ? "bg-bg-tertiary text-text-primary" : ""
        }`}
      >
        <MoreHorizontalIcon className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="group"
          aria-label={label}
          data-placement={layout.placement}
          style={{ top: `${layout.top}px`, maxHeight: `${layout.maxHeight}px` }}
          className="absolute right-0 z-50 w-56 overflow-y-auto overscroll-contain rounded-xl border border-border bg-bg-primary p-1.5 shadow-md"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                item.danger === true
                  ? "text-error hover:bg-error/10"
                  : "text-text-primary hover:bg-bg-secondary"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
