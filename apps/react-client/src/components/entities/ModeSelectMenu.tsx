/**
 * `ModeSelectMenu` — el menú de modos que comparten los tres niveles
 * (ADR-087 §3/§4; opciones exactas por ADR-169 §6 y ADR-170).
 *
 * Los tres niveles ofrecen **las mismas cuatro opciones**; lo que cambia entre
 * ellos es el tratamiento visual del disparador (§3.1) y qué barren al aplicar
 * (§3.1b), no el contenido del menú.
 *
 * Cada opción es **título + descripción fija + vista previa exacta** del
 * resultado para esa entidad (`[HOMBRE 04]`, `XXXXX XXXXX`, el dato falso
 * real, el bloque negro), de `EntityGroup.replacementPreviews`. **Elegir otra
 * opción solo mueve el tilde**: ningún texto del menú cambia — antes el modo
 * vigente mostraba el valor exacto y los otros tres una descripción
 * esquemática, y al elegir se reescribía todo y el usuario perdía la
 * referencia.
 *
 * **Nombra la entidad** (ADR-169 §2): *"Cómo reemplazar «Juan Pérez»"* — junto
 * con el resaltado de la fila que lo abrió, es la defensa contra cambiar el
 * modo de la fila equivocada. Es **flotante** (UX-10): no expande la fila.
 *
 * Es un disclosure con botones, mismo patrón y mismas razones que
 * `GroupContextMenu` (sin `role="menu"`: ese rol promete navegación por
 * flechas que no está implementada).
 */

import type { ReplacementMode, ReplacementPreviews } from "@anonly/anonymization-core";
import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  REPLACEMENT_MODE_DESCRIPTION,
  REPLACEMENT_MODE_LABEL,
  REPLACEMENT_MODE_ORDER,
  resolveModePreview,
} from "./replacementModeOptions.js";

export interface ModeSelectMenuProps {
  /** Modo vigente, o `null` en el estado mixto ("Varios"). */
  readonly current: ReplacementMode | null;
  /**
   * Las vistas previas exactas (ADR-170 §1) del grupo que ilustra el menú:
   * el de la fila, el primero del tipo, o `null` en el nivel documento, que
   * es genérico.
   */
  readonly previews: ReplacementPreviews | null;
  readonly onSelect: (mode: ReplacementMode) => void;
  /** El disparador, que cada nivel estiliza a su manera (§3.1). */
  readonly children: (props: { readonly open: boolean; readonly toggle: () => void }) => ReactNode;
  /** Qué se está reemplazando: "Juan Pérez", "Personas", "todo el documento". */
  readonly subject: string;
  /** Avisa cuándo se abre o se cierra (la fila se resalta mientras está abierto). */
  readonly onOpenChange?: (open: boolean) => void;
  readonly align?: "left" | "right";
  /** Clases del contenedor, para que el nivel decida si puede encoger. */
  readonly className?: string;
}

export function ModeSelectMenu({
  current,
  previews,
  onSelect,
  children,
  subject,
  onOpenChange,
  align = "left",
  className = "",
}: ModeSelectMenuProps) {
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
    <div ref={containerRef} className={`relative ${className}`}>
      {children({ open, toggle: () => setOpen(!open) })}
      {open ? (
        <div
          role="group"
          aria-label="Modo de reemplazo"
          className={`absolute top-full z-50 mt-1 w-[26.5rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-bg-primary p-1.5 shadow-md ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <p className="truncate px-2.5 pb-2 pt-1.5 text-sm text-text-secondary">
            Cómo reemplazar <b className="font-semibold text-text-primary">«{subject}»</b>
          </p>
          {REPLACEMENT_MODE_ORDER.map((mode) => {
            const preview = resolveModePreview(mode, previews);
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={current === mode}
                onClick={() => {
                  setOpen(false);
                  onSelect(mode);
                }}
                className={`grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  current === mode ? "bg-accent/10" : ""
                }`}
              >
                <span className="text-accent">
                  {current === mode ? <CheckIcon className="h-4 w-4" aria-hidden /> : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-text-primary">
                    {REPLACEMENT_MODE_LABEL[mode]}
                  </span>
                  <span className="truncate text-sm text-text-secondary">
                    {REPLACEMENT_MODE_DESCRIPTION[mode]}
                  </span>
                </span>
                {preview.kind === "text" ? (
                  <span
                    className="max-w-[8rem] truncate rounded-md bg-bg-tertiary px-1.5 py-0.5 font-mono text-sm text-text-primary"
                    title={preview.value}
                  >
                    {preview.value}
                  </span>
                ) : preview.kind === "bar" ? (
                  <span
                    aria-label="Bloque negro"
                    className="inline-block h-3.5 w-20 rounded-sm bg-[#111827] ring-1 ring-border"
                  />
                ) : (
                  <span />
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
