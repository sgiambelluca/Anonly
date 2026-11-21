/**
 * `PieceContextMenu` — el menú del clic derecho sobre una pieza del generador
 * (`Components.md` §13b.5, ADR-228 §3, precisión del 2026-11-21).
 *
 * Flota donde se hizo el clic, sin salirse de la ventana. Mismo trato que
 * `ActionsMenu`: un panel de botones que se recorren con `Tab` (sin
 * `role="menu"`, que promete flechas), con un ícono por opción. `Esc`, un clic
 * afuera, un scroll o cambiar el tamaño de la ventana lo cierran; `Esc` no cierra
 * el generador que lo contiene.
 */

import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useEscapeClosesMenu } from "../common/useEscapeClosesMenu.js";

export interface PieceContextMenuItem {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onSelect: () => void;
  readonly danger?: boolean;
  readonly disabled?: boolean;
}

export interface PieceContextMenuProps {
  /** Dónde se pidió, en coordenadas de la ventana. */
  readonly x: number;
  readonly y: number;
  /** Nombre accesible del panel: «Acciones de la pieza Dígitos». */
  readonly label: string;
  readonly items: ReadonlyArray<PieceContextMenuItem>;
  readonly onClose: () => void;
}

const MARGIN_PX = 8;

/**
 * La esquina del menú, en coordenadas de la ventana: arranca en el punto pedido
 * y se corre para no salirse; si abajo no entra, se abre hacia arriba. Pura.
 */
export function placeContextMenu(
  point: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } {
  const left = Math.max(MARGIN_PX, Math.min(point.x, viewport.width - size.width - MARGIN_PX));
  const fitsBelow = point.y + size.height + MARGIN_PX <= viewport.height;
  const top = fitsBelow ? point.y : Math.max(MARGIN_PX, point.y - size.height);
  return { left, top };
}

export function PieceContextMenu({ x, y, label, items, onClose }: PieceContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // `fixed` adentro de un diálogo se ubica respecto del diálogo (tiene `transform`),
  // no de la ventana: se mide dónde cae el (0, 0) y se descuenta.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    const origin = menu.getBoundingClientRect();
    const target = placeContextMenu(
      { x, y },
      { width: origin.width, height: origin.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPosition({ left: target.left - origin.left, top: target.top - origin.top });
  }, [x, y]);

  // Al abrirse, el foco va a la primera opción: con la tecla de menú se sigue con `Tab`.
  useEffect(() => {
    if (position === null) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [position]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) onClose();
    }
    function handleViewportChange(): void {
      onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("blur", handleViewportChange);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("blur", handleViewportChange);
    };
  }, [onClose]);

  useEscapeClosesMenu(true, onClose);

  return (
    <div
      ref={menuRef}
      role="group"
      aria-label={label}
      data-piece-menu
      onContextMenu={(event) => event.preventDefault()}
      style={{
        left: `${position?.left ?? 0}px`,
        top: `${position?.top ?? 0}px`,
        visibility: position === null ? "hidden" : "visible",
      }}
      className="fixed z-50 w-max min-w-[13rem] rounded-xl border border-border bg-bg-primary p-1.5 shadow-md"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled === true}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${
            item.danger === true
              ? "text-error enabled:hover:bg-error/10"
              : "text-text-primary enabled:hover:bg-bg-secondary"
          }`}
        >
          <item.icon
            className={`h-4 w-4 shrink-0 ${item.danger === true ? "" : "text-text-secondary"}`}
            aria-hidden
          />
          {item.label}
        </button>
      ))}
    </div>
  );
}
