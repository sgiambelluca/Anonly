/**
 * `EntityTooltip` (`ui/Components.md` §13b.8, ADR-226 §4): el tooltip de una
 * entidad del visor. Flota sobre la página y **no mueve nada**: un ancla invisible
 * del tamaño de la entidad y un `Tooltip` de Radix en un portal, que se acomoda
 * solo arriba o abajo según el lugar.
 *
 * Es controlado: quien decide cuándo aparece (~400 ms con el mouse quieto, ni
 * durante un arrastre, un zoom, un menú o un diálogo) es `useEntityHover`. No se
 * ata al foco —las entidades del visor no lo reciben— ni recibe el puntero.
 */

import type { EntityTypeId } from "@anonly/anonymization-core";
import * as RadixTooltip from "@radix-ui/react-tooltip";

import { typeDotStyle } from "../entities/entityTypeColors.js";

import { TOOLTIP_ROW_LABEL, type EntityTooltipContent } from "./entityTooltipContent.js";
import type { ScreenRect } from "./wordSelectionRect.js";

export interface EntityTooltipProps {
  /** Dónde está la entidad, en píxeles de la capa que la contiene. */
  readonly rect: ScreenRect;
  readonly type: EntityTypeId;
  readonly content: EntityTooltipContent;
}

export function EntityTooltip({ rect, type, content }: EntityTooltipProps) {
  return (
    <RadixTooltip.Provider>
      <RadixTooltip.Root open>
        <RadixTooltip.Trigger asChild>
          <span
            aria-hidden
            className="pointer-events-none absolute"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          />
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="top"
            sideOffset={10}
            collisionPadding={8}
            className="pointer-events-none z-50 flex w-[292px] flex-col gap-2 rounded-[10px] bg-text-primary px-3.5 py-3 text-[12.5px] leading-snug text-bg-primary shadow-md"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={typeDotStyle(type)}
              />
              <b className="font-semibold">{content.typeName}</b>
              <span className="opacity-70">{content.number}</span>
            </span>
            <span className="break-words font-mono text-[13.5px] font-semibold">
              {content.value}
            </span>
            <dl className="m-0 grid grid-cols-[86px_minmax(0,1fr)] gap-y-1 border-t border-bg-primary/15 pt-2">
              <dt className="opacity-70">{TOOLTIP_ROW_LABEL.replacement}</dt>
              <dd className="m-0 font-medium">{content.replacement}</dd>
              <dt className="opacity-70">{TOOLTIP_ROW_LABEL.appearances}</dt>
              <dd className="m-0 font-medium">{content.appearances}</dd>
              {content.format !== null ? (
                <>
                  <dt className="opacity-70">{TOOLTIP_ROW_LABEL.format}</dt>
                  <dd className="m-0 font-medium">{content.format}</dd>
                </>
              ) : null}
            </dl>
            <RadixTooltip.Arrow className="fill-text-primary" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
