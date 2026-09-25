/**
 * `GroupContextMenu` — el menú ⋯ de cada fila (`ui/Components.md` §3.5,
 * orden y rótulos por ADR-169 §10).
 *
 * **Orden**: Ver apariciones · Editar reemplazo… · Cambiar tipo… · Fusionar
 * con… · Dividir… · separador · **Eliminar entidad** (en rojo, ADR-171).
 * "Restaurar valor calculado" aparece solo cuando el grupo tiene el valor
 * escrito a mano (ADR-078 §4); "Editar reemplazo…" no aparece en `redact`
 * (ADR-012: un bloque negro tiene una sola forma).
 *
 * **La fila que abrió el menú queda resaltada** mientras está abierto
 * (`onOpenChange`, ADR-169 §2) y el panel es flotante: no empuja nada (UX-10).
 *
 * Sin `@radix-ui/react-dropdown-menu` en el proyecto (agregarlo requeriría
 * ADR — `ai/Code_Standards.md` P-9): es un disclosure hecho a mano (trigger +
 * panel de botones, cierre por click-fuera/Escape/selección).
 *
 * **A propósito NO usa `role="menu"`/`role="menuitem"` ni `aria-haspopup`.**
 * Ese rol es un contrato con el lector de pantalla: promete navegación por
 * flechas, Home/End y foco gestionado, y nada de eso está implementado — los
 * items se recorren con Tab. Sin el rol son botones dentro de un grupo
 * etiquetado, y se comportan como el lector espera. `aria-haspopup="true"` es
 * sinónimo de `menu` en WAI-ARIA 1.1+, así que tampoco. **Los roles y nombres
 * de este menú son API de los E2E** (`scenario-9`, `scenario-10`): "Más
 * acciones", "Acciones del grupo", "Fusionar con…", "Dividir…".
 */

import {
  EyeIcon,
  MergeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  SplitIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface GroupContextMenuProps {
  readonly onMerge: () => void;
  readonly onSplit: () => void;
  /** ADR-084 §2: escribe el `canonicalValue` del grupo en la lupa del visor. */
  readonly onViewOccurrences: () => void;
  /** ADR-076 §2: abre el `EditReplacementDialog`. **Ausente en modo `redact`**. */
  readonly onEditReplacement?: () => void;
  /** ADR-082 §6: abre el `ChangeTypeDialog`. */
  readonly onChangeType: () => void;
  /** ADR-078 §4: presente **solo** si el grupo tiene `replacementValueUserSet === true`. */
  readonly onRestoreComputedValue?: () => void;
  /** ADR-171 §5: abre la confirmación de "Eliminar entidad". */
  readonly onRemove: () => void;
  /** ADR-169 §2: la fila se resalta mientras el menú está abierto. */
  readonly onOpenChange?: (open: boolean) => void;
}

export function GroupContextMenu({
  onMerge,
  onSplit,
  onEditReplacement,
  onViewOccurrences,
  onChangeType,
  onRestoreComputedValue,
  onRemove,
  onOpenChange,
}: GroupContextMenuProps) {
  const [open, setOpenState] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  function setOpen(next: boolean): void {
    setOpenState(next);
    onOpenChangeRef.current?.(next);
  }

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

  function run(action: () => void): () => void {
    return () => {
      setOpen(false);
      action();
    };
  }

  return (
    <div ref={containerRef} className="relative flex justify-center">
      <button
        type="button"
        aria-label="Más acciones"
        aria-expanded={open}
        // Lo busca el `Enter` del árbol (`EntitiesPanel`): abrir el menú desde
        // el panel exigiría subirle este estado al panel.
        data-tree-menu-trigger
        onClick={() => setOpen(!open)}
        className={`flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open ? "bg-bg-tertiary text-text-primary" : ""
        }`}
      >
        <MoreHorizontalIcon className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <div
          role="group"
          aria-label="Acciones del grupo"
          className="absolute right-0 top-full z-50 mt-1 w-60 rounded-xl border border-border bg-bg-primary p-1.5 shadow-md"
        >
          <MenuItem
            icon={<EyeIcon className="h-4 w-4" aria-hidden />}
            onClick={run(onViewOccurrences)}
          >
            Ver apariciones
          </MenuItem>
          {onEditReplacement !== undefined ? (
            <MenuItem
              icon={<PencilIcon className="h-4 w-4" aria-hidden />}
              onClick={run(onEditReplacement)}
            >
              Editar reemplazo…
            </MenuItem>
          ) : null}
          {onRestoreComputedValue !== undefined ? (
            <MenuItem
              icon={<RotateCcwIcon className="h-4 w-4" aria-hidden />}
              onClick={run(onRestoreComputedValue)}
            >
              Restaurar valor calculado
            </MenuItem>
          ) : null}
          <MenuItem icon={<TagIcon className="h-4 w-4" aria-hidden />} onClick={run(onChangeType)}>
            Cambiar tipo…
          </MenuItem>
          <MenuItem icon={<MergeIcon className="h-4 w-4" aria-hidden />} onClick={run(onMerge)}>
            Fusionar con…
          </MenuItem>
          <MenuItem icon={<SplitIcon className="h-4 w-4" aria-hidden />} onClick={run(onSplit)}>
            Dividir…
          </MenuItem>
          <div role="separator" className="my-1.5 h-px bg-border" />
          <MenuItem
            danger
            icon={<Trash2Icon className="h-4 w-4" aria-hidden />}
            onClick={run(onRemove)}
          >
            Eliminar entidad
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  onClick,
  children,
  danger = false,
}: {
  readonly icon: ReactNode;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        danger ? "text-error hover:bg-error/10" : "text-text-primary hover:bg-bg-secondary"
      }`}
    >
      <span className={danger ? "" : "text-text-secondary"}>{icon}</span>
      {children}
    </button>
  );
}
