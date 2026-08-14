/**
 * `PersonGenderUndeterminedBadge` — marca de "género sin determinar"
 * (`ui/Components.md` §3.3, `ui/UX_Guidelines.md` §3.3, ADR-060 §5).
 *
 * `EntityGroupItem` la monta cuando `isPersonGenderUndeterminedMarkVisible`
 * da `true` y le pasa el `onOpenSelect` que abre el `PersonGenderSelect`
 * vecino (mismo patrón de "badge separado que dispara una acción" que
 * `ConflictBadge`, con la diferencia de que acá no hay diálogo propio: lo
 * que abre es el selector de §3.4b).
 *
 * No comparte tratamiento visual con la marca de reemplazo degradado
 * (`AnnotationKind.Degraded`, ADR-058 §7 / ADR-062): aquélla es un veredicto
 * de render sobre píxeles que quedaron comprometidos; ésta señala un dato
 * ausente sobre un grupo que se renderiza perfecto. Por eso usa un icono y
 * un color distintos (ni rojo de error ni el mismo icono) y nunca se pinta
 * en el canvas.
 */

import { CircleHelpIcon } from "lucide-react";

import { Tooltip } from "../common/Tooltip.js";

export interface PersonGenderUndeterminedBadgeProps {
  readonly onOpenSelect: () => void;
}

export function PersonGenderUndeterminedBadge({
  onOpenSelect,
}: PersonGenderUndeterminedBadgeProps) {
  return (
    <Tooltip content="Género sin determinar">
      <button
        type="button"
        aria-label="Género sin determinar"
        onClick={onOpenSelect}
        className="rounded-md p-0.5 text-text-secondary hover:bg-bg-tertiary"
      >
        <CircleHelpIcon className="h-4 w-4" aria-hidden />
      </button>
    </Tooltip>
  );
}
