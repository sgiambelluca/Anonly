/**
 * Los tres símbolos de `PersonGenderToggle` (`ui/Components.md` §3.4b,
 * ADR-071 §3).
 *
 * **Dibujados a mano y no tomados de una librería**, por tres razones:
 * `lucide-react@0.451.0` —la versión del repo— no tiene `Venus` ni `Mars`
 * (llegaron después), así que usarlos sería un bump de dependencia (R-12)
 * por tres formas triviales; el glifo Unicode del neutro (`U+26B2`) tiene
 * cobertura de fuente irregular y su tofu caería justo en el estado por
 * defecto del control; y dibujarlos garantiza que los tres compartan grilla,
 * grosor de trazo y peso óptico, que es lo que hace que el botón no salte al
 * ciclar. Mismo criterio first-party que ADR-018.
 *
 * **El neutro es el círculo pelado, y eso es deliberado.** ♀ y ♂ son el
 * mismo círculo con un apéndice distinto; quitarle el apéndice dice "acá no
 * hay marca" con la gramática visual que los otros dos ya establecieron.
 * **No se usa ⚧ ni ningún símbolo asociado a una identidad de género**: este
 * estado significa *sin determinar* —falta el dato, o el nombre no lo
 * determina—, no una tercera categoría de persona. ADR-060 §9 ya lo fijó
 * para el valor `A` del registro ("es una propiedad del **nombre**, no un
 * atributo de quien lo lleva") y ADR-060 §"Alternativas" rechazó por escrito
 * agregar categorías.
 *
 * `currentColor` en el trazo: el color —y con él el contraste AA de
 * `UX_Guidelines.md` §9— lo decide el botón según el estado, no estos SVG.
 */

import type { PersonGenderChoice } from "@anonly/anonymization-core";

const SVG_PROPS = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "h-4 w-4",
  "aria-hidden": true,
} as const;

/** ♀ — círculo arriba, cruz abajo. */
function VenusSymbol() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="8" cy="6" r="4" />
      <path d="M8 10v5M5.5 12.75h5" />
    </svg>
  );
}

/** ♂ — círculo abajo-izquierda, flecha arriba-derecha. */
function MarsSymbol() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="6.5" cy="9.5" r="4" />
      <path d="M9.5 6.5 14 2M9.75 2H14v4.25" />
    </svg>
  );
}

/** ⚲ — el mismo círculo, sin apéndice. Sin determinar, no una identidad. */
function NeutralSymbol() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="8" cy="8" r="4" />
    </svg>
  );
}

export const PERSON_GENDER_SYMBOL: Readonly<Record<PersonGenderChoice, () => JSX.Element>> = {
  f: VenusSymbol,
  m: MarsSymbol,
  neutral: NeutralSymbol,
};
