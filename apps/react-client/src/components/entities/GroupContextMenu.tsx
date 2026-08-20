/**
 * `GroupContextMenu` (`ui/Components.md` §3.5).
 *
 * Alcance reducido al pedido explícito de este PR (prompt del Hito 10 PR8:
 * "acceso a fusionar/dividir" en cada grupo del árbol): expone "Fusionar con…"
 * y "Dividir…", "Ver ocurrencias" (ADR-084 §2, escribe el valor en el
 * buscador del visor), "Cambiar categoría" (ADR-082 §6) y "Restaurar valor
 * calculado" cuando el grupo tiene el `replacementValue` editado a mano
 * (ADR-078 §4). El catálogo completo de §3.5 agrega "Ver
 * ocurrencias", "Editar valor canónico" y "Eliminar grupo" — no incluidos acá
 * (ver reporte de este PR: "Ver ocurrencias" depende de un campo `value` que
 * `OccurrenceRef` no tiene, `03_Data_Model.md` §8; "Eliminar grupo" ya queda
 * cubierto funcionalmente por el checkbox de habilitar/deshabilitar del propio
 * `EntityGroupItem`; "Editar valor canónico" no está en el pedido concreto de
 * este PR).
 *
 * Sin `@radix-ui/react-dropdown-menu` en el proyecto (no está en
 * `package.json`, agregarlo requeriría ADR — `ai/Code_Standards.md` P-9): este
 * menú es un disclosure accesible hecho a mano (trigger + panel de botones,
 * cierre por click-fuera/Escape/selección), sin dependencias nuevas.
 *
 * **A propósito NO usa `role="menu"`/`role="menuitem"`.** Ese rol es un
 * contrato con el lector de pantalla: promete navegación por flechas,
 * Home/End y foco gestionado (un solo tab stop), y nada de eso está
 * implementado acá — los items se recorren con Tab. Un rol prometido y no
 * cumplido deja al usuario de teclado apretando flechas contra un panel que no
 * responde, que es peor que no anunciar nada: sin el rol son botones dentro de
 * un grupo etiquetado, y se comportan exactamente como el lector espera. Si
 * algún día entra `@radix-ui/react-dropdown-menu` (requiere ADR, P-9), trae el
 * rol y el manejo de foco juntos, que es la única forma correcta de tenerlos.
 */

import { MoreHorizontalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface GroupContextMenuProps {
  readonly onMerge: () => void;
  readonly onSplit: () => void;
  /** ADR-084 §2: escribe el `canonicalValue` del grupo en el buscador del visor. */
  readonly onViewOccurrences: () => void;
  /**
   * ADR-076 §2: abre el `EditReplacementDialog`. **Ausente en modo `redact`**
   * (ADR-012): ahí el valor es `""` y la censura es visual — un bloque negro
   * tiene una sola forma, así que no hay texto que elegir.
   */
  readonly onEditReplacement?: () => void;
  /** ADR-082 §6: abre el `ChangeTypeDialog` para corregir la clasificación. */
  readonly onChangeType: () => void;
  /**
   * ADR-078 §4: presente **solo** si el grupo tiene
   * `replacementValueUserSet === true`. Ausente ⇒ la entrada no se renderiza:
   * ofrecer "restaurar" sobre un valor que nadie editó no significa nada.
   */
  readonly onRestoreComputedValue?: () => void;
}

export function GroupContextMenu({
  onMerge,
  onSplit,
  onEditReplacement,
  onViewOccurrences,
  onChangeType,
  onRestoreComputedValue,
}: GroupContextMenuProps) {
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
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-md p-1 text-text-secondary hover:bg-bg-tertiary"
      >
        <MoreHorizontalIcon className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <div
          role="group"
          aria-label="Acciones del grupo"
          className="absolute right-0 z-50 mt-1 w-40 rounded-md border border-border bg-bg-primary py-1 shadow-md"
        >
          <button
            type="button"
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
            onClick={() => {
              setOpen(false);
              onSplit();
            }}
            className="block w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary"
          >
            Dividir…
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onViewOccurrences();
            }}
            className="block w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary"
          >
            Ver ocurrencias
          </button>
          {onEditReplacement !== undefined ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEditReplacement();
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary"
            >
              Editar reemplazo
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onChangeType();
            }}
            className="block w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary"
          >
            Cambiar categoría
          </button>
          {onRestoreComputedValue !== undefined ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onRestoreComputedValue();
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary"
            >
              Restaurar valor calculado
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
