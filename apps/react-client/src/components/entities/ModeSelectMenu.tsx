/**
 * `ModeSelectMenu` — el menú de modos que comparten los tres niveles
 * (ADR-087 §3/§4).
 *
 * Los tres niveles ofrecen **las mismas cuatro opciones con el mismo ejemplo**;
 * lo que cambia entre ellos es el tratamiento visual del disparador
 * (§3.1) y qué barren al aplicar (§3.1b), no el contenido del menú. Por eso el
 * menú vive acá una sola vez: tres copias se habrían desincronizado apenas
 * cambiara una etiqueta.
 *
 * **No usa `Select`** (el wrapper de Radix de `common/`): ese componente
 * renderiza una opción por línea de texto plano, y acá cada opción lleva dos
 * líneas —etiqueta y ejemplo—. Es un disclosure con botones, mismo patrón y
 * mismas razones que `GroupContextMenu` (sin `role="menu"`: ese rol promete
 * navegación por flechas que no está implementada, y prometerla sin cumplirla
 * es peor que no anunciar nada).
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
  readonly align?: "left" | "right";
  /** Clases del contenedor, para que el nivel decida si puede encoger. */
  readonly className?: string;
}

export function ModeSelectMenu({
  current,
  example,
  onSelect,
  children,
  align = "left",
  className = "",
}: ModeSelectMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
      {children({ open, toggle: () => setOpen((prev) => !prev) })}
      {open ? (
        <div
          role="group"
          aria-label="Modo de reemplazo"
          className={`absolute z-50 mt-1 w-72 rounded-md border border-border bg-bg-primary py-1 shadow-md ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {REPLACEMENT_MODE_ORDER.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(mode);
              }}
              className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-bg-tertiary"
            >
              <span className="mt-0.5 w-4 shrink-0 text-accent">
                {current === mode ? <CheckIcon className="h-4 w-4" aria-hidden /> : null}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm text-text-primary">{REPLACEMENT_MODE_LABEL[mode]}</span>
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
