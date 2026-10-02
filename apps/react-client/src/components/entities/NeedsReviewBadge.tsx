/**
 * `NeedsReviewBadge` (`ui/Components.md` §3.4d, ADR-094 §4).
 *
 * Marca los grupos "sugeridos": el motor los crea cuando NER detecta un
 * posible nombre propio, organización o dirección con confianza por debajo
 * del umbral de agrupado y sin ningún grupo candidato al que sumarse
 * (ADR-094 §1). Antes de ADR-094 esa ocurrencia se descartaba en silencio —
 * la herramienta veía un nombre y lo tiraba sin dejar rastro. Ahora crea su
 * grupo `enabled: false` + `needsReview: true`: a la vista, sin tapar nada,
 * hasta que el usuario decida.
 *
 * A diferencia de `DegradedBadge` (§3.3), acá **no hay diálogo**: no hay
 * nada que explicar más allá de una frase, y la acción ya existe — es la
 * casilla de la fila. Tildarla acepta la sugerencia; destildarla la
 * rechaza. Las dos limpian `needsReview` en el motor (ADR-094 §4); este
 * componente no hace nada especial para eso, solo re-renderiza cuando el
 * grupo cambia.
 *
 * **El copy no lleva jerga y no muestra el número.** El usuario no tiene que
 * ver "0,59" ni saber qué es un umbral de confianza — tiene que saber que
 * esa fila merece una mirada más que las otras. Mismo criterio que
 * `DegradedBadge` ya fija para su propio aviso.
 */

import type { EntityGroup } from "@anonly/anonymization-core";

import { Tooltip } from "../common/Tooltip.js";

import {
  buildNeedsReviewAriaLabel,
  isNeedsReviewBadgeVisible,
  WARNING_TOOLTIP,
} from "./needsReviewBadgeCopy.js";
import { REVIEW_BADGE_CLASS, ReviewSymbol, WarningTooltipText } from "./warningSymbols.js";

export interface NeedsReviewBadgeProps {
  readonly group: EntityGroup;
}

export function NeedsReviewBadge({ group }: NeedsReviewBadgeProps) {
  if (!isNeedsReviewBadgeVisible(group)) return null;

  return (
    <Tooltip content={<WarningTooltipText {...WARNING_TOOLTIP.review} />}>
      {/*
        ADR-169 §3: caja de 22 px con el `?` en ámbar fuerte. Foco propio
        (`tabIndex`) para que el tooltip también se lea con teclado; no tiene
        acción al clic —la acción ya existe: la casilla de la fila—.
      */}
      <span
        role="img"
        tabIndex={0}
        aria-label={buildNeedsReviewAriaLabel(group.canonicalValue)}
        className={REVIEW_BADGE_CLASS}
      >
        <ReviewSymbol />
      </span>
    </Tooltip>
  );
}
