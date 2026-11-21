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

import { MoreHorizontalIcon, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useEscapeClosesMenu } from "../common/useEscapeClosesMenu.js";
import { observeMenuLayout, type MenuLayout } from "../entities/menuPlacement.js";

export interface ActionsMenuItem {
  readonly label: string;
  /**
   * Obligatorio: todos los menús ⋯ de la aplicación llevan un ícono por opción,
   * como el de las entidades (`GroupContextMenu`). Pasada de UI de la 1.1.
   */
  readonly icon: LucideIcon;
  readonly onSelect: () => void;
  readonly danger?: boolean;
  /** Apagada, con su motivo en `title` (el tope de variantes, una sola variante). */
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export interface ActionsMenuProps {
  /** Nombre accesible del botón y del grupo: «Acciones del tipo Historia clínica». */
  readonly label: string;
  readonly items: ReadonlyArray<ActionsMenuItem>;
  /** Avisa cuándo se abre o se cierra: una franja `sticky` tiene que subir de capa mientras el menú está abierto. */
  readonly onOpenChange?: (open: boolean) => void;
  /**
   * Hacia dónde se abre el panel: `end` (default) lo alinea al borde derecho del
   * botón; `start`, al izquierdo, para un ⋯ que está cerca del borde izquierdo
   * (las pestañas de variante del generador).
   */
  readonly align?: "start" | "end";
  /** Un botón más chico, para ir dentro de una pestaña. */
  readonly compact?: boolean;
  /** Un ⋯ que no es el de lo elegido se ve más tenue hasta pasarle el mouse. */
  readonly muted?: boolean;
}

export function ActionsMenu({
  label,
  items,
  onOpenChange,
  align = "end",
  compact = false,
  muted = false,
}: ActionsMenuProps) {
  const [open, setOpenState] = useState(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  function setOpen(next: boolean): void {
    setOpenState(next);
    onOpenChangeRef.current?.(next);
  }
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
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // `Esc` cierra el menú y no «Formatos de detección», que lo contiene.
  const closeMenu = useCallback(() => setOpen(false), []);
  useEscapeClosesMenu(open, closeMenu);

  return (
    <div ref={containerRef} className="relative flex justify-center">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex ${compact ? "h-6 w-6" : "h-7 w-7"} items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open ? "bg-bg-tertiary text-text-primary" : muted ? "opacity-60 hover:opacity-100" : ""
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
          // `w-max` entre 14 y 20 rem: con el ícono, «Guardar para los próximos
          // documentos» ya no entraba en los 14 rem fijos de antes.
          className={`absolute ${align === "start" ? "left-0" : "right-0"} z-50 w-max min-w-[14rem] max-w-[20rem] overflow-y-auto overscroll-contain rounded-xl border border-border bg-bg-primary p-1.5 shadow-md`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled === true}
              {...(item.disabled === true && item.disabledReason !== undefined
                ? { title: item.disabledReason }
                : {})}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${
                item.danger === true
                  ? "text-error enabled:hover:bg-error/10"
                  : "text-text-primary enabled:hover:bg-bg-secondary"
              }`}
            >
              {/* Mismo trato que `GroupContextMenu`: gris, salvo en la opción de peligro. */}
              <item.icon
                className={`h-4 w-4 shrink-0 ${item.danger === true ? "" : "text-text-secondary"}`}
                aria-hidden
              />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
