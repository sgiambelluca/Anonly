/**
 * `Tooltip` — wrapper sobre Radix `Tooltip` con delay corto (`ui/Components.md`
 * §8.5). No se había creado en PRs anteriores (PR6 solo listaba Button/Dialog/
 * ConfirmDialog/Select/Checkbox/Banner) aunque `@radix-ui/react-tooltip` ya es
 * dependencia del paquete (`package.json`); lo agrega este PR porque
 * `ConflictBadge` (`ui/Components.md` §6.1: "icono ⚠ con tooltip 'Conflicto'")
 * lo necesita y no requiere ninguna dependencia nueva.
 *
 * Cada instancia envuelve su propio `Tooltip.Provider` (en vez de uno global en
 * `App.tsx`, fuera del alcance de este PR) — funcionalmente equivalente, solo
 * menos óptimo si hubiera decenas de tooltips simultáneos (no es el caso acá).
 *
 * **Colores que se invierten con el tema** (ADR-169 §3, `Components.md` §8.5):
 * fondo `text-primary`, texto `bg-primary`. Nunca `text-white`: en oscuro
 * `text-primary` es casi blanco y el texto quedaba blanco sobre blanco — lo
 * reportaron las pruebas de usuario al pasar el mouse por los avisos.
 */

import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export interface TooltipProps {
  readonly content: ReactNode;
  readonly children: ReactNode;
  readonly delayDuration?: number;
}

export function Tooltip({ content, children, delayDuration = 300 }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={4}
            className="z-50 max-w-[17rem] rounded-lg bg-text-primary px-2.5 py-2 text-sm leading-snug text-bg-primary shadow-md"
          >
            {content}
            <RadixTooltip.Arrow className="fill-text-primary" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
