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
            className="z-50 rounded-md bg-text-primary px-2 py-1 text-sm text-white shadow-md"
          >
            {content}
            <RadixTooltip.Arrow className="fill-text-primary" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
