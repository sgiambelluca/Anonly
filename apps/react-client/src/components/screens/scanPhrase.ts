/**
 * `scanPhrase.ts` — los tipos de dato que la frase de `ScanScreen` va rotando.
 *
 * Módulo puro, por el mismo motivo que `scanAdvance.ts`: los tests de
 * `apps/react-client` corren en Node sin jsdom.
 *
 * **No se reusa `ENTITY_TYPE_LABEL`** aunque nombre las mismas cosas. Esas
 * etiquetas son títulos de sección del árbol ("Tarjetas de crédito",
 * "Personalizado") y acá van adentro de una oración corrida, donde la frase
 * tiene que sonar natural y corta. Además `Custom` no tiene sentido en esta
 * lista: no es un tipo que el detector busque, es el cajón de lo que el
 * usuario agrega a mano.
 */

/** En singular y sin artículo: completan "…en busca de nombres". */
export const SCAN_PHRASE_TERMS: ReadonlyArray<string> = [
  "nombres",
  "DNI",
  "CUIT",
  "direcciones",
  "teléfonos",
  "emails",
  "fechas",
  "matrículas",
  "patentes",
  "tarjetas",
  "organizaciones",
];

/** Cuánto dura cada término en pantalla, incluido su fundido. */
export const SCAN_PHRASE_INTERVAL_MS = 2400;

/**
 * Término que corresponde al tick `n`. Cicla indefinidamente mientras la
 * pantalla esté arriba — desde ADR-150 eso puede ser minutos en un
 * escaneado largo, no los 1,2-6 s de la regla anterior (ADR-087 §6,
 * superseded). La lista completa se recorre las veces que haga falta: en un
 * documento largo esta frase deja de ser el contenido principal y pasa a
 * acompañar a la etapa con contador (ADR-152 §4) — si la etapa vigente
 * afirma un número, el número manda.
 */
export function scanPhraseTermAt(tick: number): string {
  const term = SCAN_PHRASE_TERMS[tick % SCAN_PHRASE_TERMS.length];
  // `SCAN_PHRASE_TERMS` no está vacío, pero `noUncheckedIndexedAccess`
  // (Code_Standards.md §2) no lo sabe: el fallback evita un `as` innecesario.
  return term ?? SCAN_PHRASE_TERMS[0] ?? "";
}
