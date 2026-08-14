/**
 * `thirdPartyCredits.ts` — atribución de datos de terceros, como datos (no
 * JSX) para la sección "Acerca de" de `SettingsDialog` (`ui/Components.md`
 * §2.6, ADR-070 §2).
 *
 * Separar los datos del componente es lo que permite testear el contenido
 * sin renderizar nada (`apps/react-client` corre sin jsdom) y lo que deja
 * sumar una licencia nueva (Contexto §4 del ADR) como una fila más de este
 * array.
 */

export interface ThirdPartyCredit {
  readonly id: string;
  /** Título de la obra, como lo nombra la fuente. */
  readonly title: string;
  /** Titular de los derechos, como pide CC-BY. */
  readonly holder: string;
  /** Nombre legible de la licencia, p. ej. "CC-BY-2.5-AR". */
  readonly license: string;
  readonly licenseUrl: string;
  readonly sourceUrl: string;
  /** Indicación de cambios: CC-BY la exige cuando la obra se modificó. */
  readonly changes: string;
  /** Para qué lo usa Anonly, en una línea. */
  readonly usedFor: string;
}

export const THIRD_PARTY_CREDITS: ReadonlyArray<ThirdPartyCredit> = [
  {
    id: "buenos-aires-nombres-permitidos",
    title: 'Nombres — recurso "Nombres Permitidos"',
    holder: "Gobierno de la Ciudad de Buenos Aires — Buenos Aires Data",
    license: "CC-BY-2.5-AR",
    licenseUrl: "https://creativecommons.org/licenses/by/2.5/ar/",
    sourceUrl: "https://data.buenosaires.gob.ar/dataset/nombres",
    changes:
      "Datos modificados: se conservan solo el nombre y el sexo declarado, normalizados; se descartan origen y significado.",
    usedFor: "Sugerir el género de los reemplazos de personas.",
  },
];
