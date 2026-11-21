/**
 * `entityHighlights.ts` — el resaltado de las entidades en la vista Original
 * (`UX_Guidelines.md` §5.2, `Components.md` §5.4b).
 *
 * La imagen del original sale sin `annotations` (ADR-056 §3): el resaltado lo
 * dibuja la capa de interacción con las mismas cajas que usa el tooltip
 * (`sourceBoxes`). Así, desactivar un grupo o cambiarle el tipo se ve al
 * instante, sin pedir otra imagen.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import type { BoundingBox, EntityGroup, EntityTypeId } from "@anonly/anonymization-core";

import { typeColorChannels } from "../entities/entityTypeColors.js";

import { sourceBoxes } from "./entityHover.js";

export interface EntityHighlight {
  /** Estable entre renders: la aparición y el número de fragmento. */
  readonly key: string;
  readonly groupId: string;
  readonly type: EntityTypeId;
  readonly enabled: boolean;
  /** En coordenadas de página. */
  readonly box: BoundingBox;
}

/**
 * Las cajas a resaltar en una página: una por aparición, o una por fragmento si
 * la aparición cruza renglones. Las de grupos desactivados van primero, para que
 * una activa que se le superponga quede dibujada encima.
 */
export function entityHighlightsOnPage(
  groups: Iterable<EntityGroup>,
  pageIndex: number,
): ReadonlyArray<EntityHighlight> {
  const disabled: EntityHighlight[] = [];
  const enabled: EntityHighlight[] = [];
  for (const group of groups) {
    const target = group.enabled ? enabled : disabled;
    for (const member of group.members) {
      if (member.pageIndex !== pageIndex) continue;
      sourceBoxes(member).forEach((box, index) => {
        target.push({
          key: `${member.occurrenceId}:${index}`,
          groupId: group.id,
          type: group.type,
          enabled: group.enabled,
          box,
        });
      });
    }
  }
  return [...disabled, ...enabled];
}

/** Cuánto se agranda la caja alrededor del texto, en px de pantalla, para no pisar las letras. */
export const HIGHLIGHT_PAD_PX = { x: 1.5, y: 1 } as const;

/** Gris del borde punteado de un grupo desactivado: la página es papel blanco en los dos temas. */
const DISABLED_BORDER = "rgb(107 114 128 / 0.95)";

export interface HighlightStyle {
  readonly borderStyle: "solid" | "dashed";
  readonly borderColor: string;
  readonly backgroundColor: string;
}

/**
 * Cómo se ve cada caja. Activa: borde del color del tipo y relleno suave, más
 * fuerte bajo el tooltip. Desactivada: borde punteado gris y sin relleno, porque
 * no se va a tapar y eso tiene que notarse.
 */
export function highlightStyle(
  type: EntityTypeId,
  enabled: boolean,
  emphasized: boolean,
): HighlightStyle {
  if (!enabled) {
    return {
      borderStyle: "dashed",
      borderColor: DISABLED_BORDER,
      backgroundColor: emphasized ? "rgb(107 114 128 / 0.12)" : "transparent",
    };
  }
  const channels = typeColorChannels(type);
  return {
    borderStyle: "solid",
    borderColor: `rgb(${channels} / 0.85)`,
    backgroundColor: `rgb(${channels} / ${emphasized ? 0.3 : 0.14})`,
  };
}
