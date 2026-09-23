/**
 * `ModeSelectMenu` — el menú de modos que comparten los tres niveles
 * (ADR-087 §3/§4).
 *
 * Los tres niveles ofrecen **las mismas cuatro opciones**; lo que cambia entre
 * ellos es el tratamiento visual del disparador (§3.1) y qué barren al aplicar
 * (§3.1b), no el contenido del menú. Por eso el menú vive acá una sola vez:
 * tres copias se habrían desincronizado apenas cambiara una etiqueta.
 *
 * **Nombra la entidad** (ADR-169 §2): *"Cómo reemplazar «Juan Pérez»"* — junto
 * con el resaltado de la fila que lo abrió, es la defensa contra cambiar el
 * modo de la fila equivocada. Es **flotante** (UX-10): no expande la fila.
 *
 * **No usa `Select`** (el wrapper de Radix de `common/`): ese componente
 * renderiza una opción por línea de texto plano, y acá cada opción lleva más
 * de una. Es un disclosure con botones, mismo patrón y mismas razones que
 * `GroupContextMenu` (sin `role="menu"`: ese rol promete navegación por
 * flechas que no está implementada, y prometerla sin cumplirla es peor que no
 * anunciar nada).
 */

import type { ReplacementMode } from "@anonly/anonymization-core";
import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  REPLACEMENT_MODE_LABEL,
  REPLACEMENT_MODE_ORDER,
  describeModeExample,
  type ModeExampleContext,
} from "./replacementModeOptions.js";

export interface ModeSelectMenuProps {
  /** Modo vigente, o `null` en el estado mixto ("Varios"). */
  readonly current: ReplacementMode | null;
  /** Con qué se ilustra cada opción (`replacementModeOptions.ts`). */
  readonly example: ModeExampleContext;
  readonly onSelect: (mode: ReplacementMode) => void;
  /** El disparador, que cada nivel estiliza a su manera (§3.1). */
  readonly children: (props: { readonly open: boolean; readonly toggle: () => void }) => ReactNode;
  /** Qué se está reemplazando: "Juan Pérez", "las personas", "todo el documento". */
  readonly subject: string;
  /** Avisa cuándo se abre o se cierra (la fila se resalta mientras está abierto). */
  readonly onOpenChange?: (open: boolean) => void;
  readonly align?: "left" | "right";
  /** Clases del contenedor, para que el nivel decida si puede encoger. */
  readonly className?: string;
}

export function ModeSelectMenu({
  current,
  example,
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
          className={`absolute top-full z-50 mt-1 w-[23rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-bg-primary p-1.5 shadow-md ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <p className="truncate px-2.5 pb-2 pt-1.5 text-sm text-text-secondary">
            Cómo reemplazar <b className="font-semibold text-text-primary">«{subject}»</b>
          </p>
          {REPLACEMENT_MODE_ORDER.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(mode);
              }}
              className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-bg-secondary ${
                current === mode ? "bg-accent/10" : ""
              }`}
            >
              <span className="mt-0.5 w-4 shrink-0 text-accent">
                {current === mode ? <CheckIcon className="h-4 w-4" aria-hidden /> : null}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-text-primary">
                  {REPLACEMENT_MODE_LABEL[mode]}
                </span>
                <span className="truncate text-sm text-text-secondary">
                  {describeModeExample(mode, example)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
