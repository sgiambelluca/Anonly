/**
 * `warningSymbols.tsx` — los glifos de los tres avisos de la fila
 * (ADR-169 §3, `UX_Guidelines.md` §3.3, `Components.md` §11).
 *
 * Antes había dos "!" que significaban cosas distintas y un "?" que no se
 * distinguía del resto. Cada aviso tiene ahora **forma y color propios**:
 *
 * | Aviso | Forma | Color |
 * |---|---|---|
 * | Sugerida (ADR-094) | `?` | ámbar (`warning-strong`) |
 * | Conflicto | una **Y que se abre en dos**, con puntas de flecha | rojo (`error`) |
 * | Espacio justo (ADR-062) | **`]↔[`**, flecha doble contra dos paredes | naranja (`space`) |
 *
 * **SVG first-party** para conflicto y espacio justo: `lucide-react@0.451.0`
 * no tiene esos glifos, o no se leen a este tamaño (mismo criterio que los
 * símbolos de género, `personGenderSymbols.tsx`). La flecha doble se aprieta
 * y se suelta (`anonly-squeeze`) solo con `prefers-reduced-motion:
 * no-preference`.
 *
 * `BADGE_CLASS` es la caja común: 22 px cuadrados con el fondo del color al
 * ~12 %; "espacio justo" mide 26×22 porque con 22 de ancho la flecha no se
 * lee. Dos avisos juntos entran en la columna de 52 px.
 */

/** Caja común de los avisos (22 × 22). */
export const BADGE_BASE_CLASS =
  "inline-flex h-[22px] shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export const REVIEW_BADGE_CLASS = `${BADGE_BASE_CLASS} w-[22px] bg-warning/15 text-warning-strong hover:bg-warning/25`;
export const CONFLICT_BADGE_CLASS = `${BADGE_BASE_CLASS} w-[22px] bg-error/10 text-error hover:bg-error/20`;
export const TIGHT_SPACE_BADGE_CLASS = `${BADGE_BASE_CLASS} w-[26px] bg-space/10 text-space hover:bg-space/20`;

/** Sugerida: un signo de pregunta grueso. */
export function ReviewSymbol() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Conflicto: un camino que se bifurca — dos lecturas posibles del dato. */
export function ConflictSymbol() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 14.5V9" />
      <path d="M8 9 3.5 4" />
      <path d="M8 9l4.5-5" />
      <path d="M3 7.2V3.5h3.7" />
      <path d="M9.3 3.5H13v3.7" />
    </svg>
  );
}

/** Espacio justo: `]↔[` — una flecha doble que empuja contra dos paredes. */
export function TightSpaceSymbol() {
  return (
    <svg
      width="22"
      height="16"
      viewBox="0 0 22 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.5 2.5H2v11h1.5" />
      <path d="M18.5 2.5H20v11h-1.5" />
      <g className="anonly-squeeze">
        <path d="M5.5 8h11" />
        <path d="M8.3 5.2 5.5 8l2.8 2.8" />
        <path d="M13.7 5.2 16.5 8l-2.8 2.8" />
      </g>
    </svg>
  );
}

/** Contenido del `Tooltip` de un aviso: título en negrita + la frase. */
export function WarningTooltipText({
  title,
  text,
}: {
  readonly title: string;
  readonly text: string;
}) {
  return (
    <span>
      <b className="font-semibold">{title}</b> {text}
    </span>
  );
}
