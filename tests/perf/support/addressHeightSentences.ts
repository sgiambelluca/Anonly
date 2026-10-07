/**
 * M-D1 (`docs/roadmap/hardening/Confianza_1.0.x_Plan.md`, ADR-212): las oraciones sintéticas con las
 * que se mide cuánto tapa la regla de la altura de una dirección y cuánto deja a la vista. Son datos:
 * los escribió el planificador y **no se cambian ni se acomodan** para que el resultado salga de una u
 * otra manera. Si una no se puede generar tal cual (un glifo que la fuente no tiene), es un hallazgo.
 *
 * Cada página del PDF de prueba lleva exactamente tres renglones: el relleno de antes, la oración y el
 * relleno de después. El relleno es el mismo en todas las páginas y no tiene ninguna palabra de la lista
 * de ADR-212 §4: está para que las ventanas de seis palabras antes y cuatro después de la regla no
 * lleguen a otra oración de prueba, y para que el modelo tenga algo de contexto.
 *
 * Todo es inventado: ninguna de estas calles, números ni personas es un dato real.
 */

export type AddressHeightCategory = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export const ADDRESS_HEIGHT_CATEGORIES: ReadonlyArray<AddressHeightCategory> = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
];

export interface AddressHeightSentence {
  readonly id: string;
  readonly category: AddressHeightCategory;
  readonly text: string;
  /** El nombre de calle o lugar tal como aparece en `text`. */
  readonly place: string;
  /** Los dígitos tal como aparecen en `text`: la aparición que sigue al lugar. */
  readonly number: string;
}

/** Qué se espera de la regla por contexto de ADR-212 para una oración (ver `expectedContextOutcome`). */
export type ContextOutcome = "inside" | "visible" | "untouched";

export const FILLER_BEFORE = "Se deja constancia de lo actuado en el expediente.";
export const FILLER_AFTER = "Con lo que se dio por terminado el acto.";

/** Lo que se espera que la aplicación extraiga como texto de cada página. */
export function expectedPageText(sentence: AddressHeightSentence): string {
  return `${FILLER_BEFORE} ${sentence.text} ${FILLER_AFTER}`;
}

function s(id: string, text: string, place: string, number: string): AddressHeightSentence {
  const category = id.charAt(0);
  if (!isCategory(category)) throw new Error(`Categoría desconocida en el id ${id}`);
  return { id, category, text, place, number };
}

function isCategory(value: string): value is AddressHeightCategory {
  return (ADDRESS_HEIGHT_CATEGORIES as ReadonlyArray<string>).includes(value);
}

export const ADDRESS_HEIGHT_SENTENCES: ReadonlyArray<AddressHeightSentence> = [
  // A: altura que no parece año (A1 a A4 con palabra de dirección, A5 a A10 sin).
  s(
    "A1",
    "El demandado tiene domicilio en Maipú 1434 y fue notificado por cédula.",
    "Maipú",
    "1434",
  ),
  s("A2", "La actora vive en Sarmiento 742 desde hace diez años.", "Sarmiento", "742"),
  s("A3", "El local comercial está sito en Lavalle 385, frente a la plaza.", "Lavalle", "385"),
  s("A4", "Se constituyó domicilio procesal en la calle Tucumán 1650.", "Tucumán", "1650"),
  s("A5", "El testigo dijo que el hecho ocurrió frente a Viamonte 867.", "Viamonte", "867"),
  s("A6", "La notificación fue devuelta desde Moreno 2310 sin firma.", "Moreno", "2310"),
  s("A7", "El perito inspeccionó el inmueble de Alsina 455 el día martes.", "Alsina", "455"),
  s("A8", "Los vecinos de Balcarce 3120 presentaron una nota.", "Balcarce", "3120"),
  s("A9", "El oficial se presentó en Urquiza 98 a primera hora.", "Urquiza", "98"),
  s("A10", "La mercadería se entregó en Callao 1105 según el remito.", "Callao", "1105"),

  // B: altura con forma de año y palabra de dirección antes.
  s(
    "B1",
    "El demandado tiene domicilio en Belgrano 1950 y no contestó la demanda.",
    "Belgrano",
    "1950",
  ),
  s("B2", "La actora vive en Rivadavia 2015 junto a sus dos hijos.", "Rivadavia", "2015"),
  s("B3", "El inmueble sito en Mitre 1985 fue embargado.", "Mitre", "1985"),
  s("B4", "Constituyó domicilio en la calle Córdoba 2040 a todos los efectos.", "Córdoba", "2040"),
  s("B5", "El testigo reside en Alvear 1920 hace varios años.", "Alvear", "1920"),
  s("B6", "La sociedad, domiciliada en Santa Fe 2001, fue intimada.", "Santa Fe", "2001"),
  s("B7", "El consultorio se encuentra en avenida Pueyrredón 1999.", "Pueyrredón", "1999"),
  s("B8", "El imputado, domiciliado en Entre Ríos 2023, quedó detenido.", "Entre Ríos", "2023"),
  s("B9", "La oficina funciona en Av. Corrientes 1980 de lunes a viernes.", "Corrientes", "1980"),
  s("B10", "Los cónyuges viven en San Martín 2010 con sus padres.", "San Martín", "2010"),

  // C: altura con forma de año y palabra de dirección después (ninguna antes).
  s("C1", "La carta documento llegó a Belgrano 1950, piso 3, sin novedad.", "Belgrano", "1950"),
  s("C2", "El oficio se diligenció en Rivadavia 2015, departamento B.", "Rivadavia", "2015"),
  s("C3", "El escrito se presentó desde Mitre 1985 piso 2 por correo.", "Mitre", "1985"),
  s("C4", "La entrega se hizo en Córdoba 2040, depto. 4, por la tarde.", "Córdoba", "2040"),
  s("C5", "El paquete fue recibido en Alvear 1920, dpto. C, por un vecino.", "Alvear", "1920"),
  s("C6", "El contrato se firmó en Sarmiento 2001 de esta ciudad.", "Sarmiento", "2001"),
  s("C7", "La audiencia se celebró en Lavalle 1999 de la localidad de Morón.", "Lavalle", "1999"),
  s("C8", "El remito indica Tucumán 2023, piso 1, como destino.", "Tucumán", "2023"),
  s("C9", "Los bienes se retiraron de Moreno 1975, departamento 6.", "Moreno", "1975"),

  // D: altura con forma de año, sin palabra de dirección (lo que la regla deja a la vista).
  s(
    "D1",
    "La carta documento fue enviada a Belgrano 1950 y volvió sin firmar.",
    "Belgrano",
    "1950",
  ),
  s("D2", "El testigo dijo que el choque ocurrió frente a Rivadavia 2015.", "Rivadavia", "2015"),
  s("D3", "El perito inspeccionó el inmueble de Mitre 1985 el día martes.", "Mitre", "1985"),
  s("D4", "La notificación se dejó en Córdoba 2040 bajo la puerta.", "Córdoba", "2040"),
  s("D5", "Los vecinos de Alvear 1920 presentaron una nota.", "Alvear", "1920"),
  s("D6", "El oficial se presentó en Sarmiento 2001 a primera hora.", "Sarmiento", "2001"),
  s("D7", "La mercadería se entregó en Lavalle 1999 según el remito.", "Lavalle", "1999"),
  s("D8", "El local de Tucumán 2023 permanece cerrado.", "Tucumán", "2023"),
  s("D9", "El móvil policial llegó a Moreno 1975 a la medianoche.", "Moreno", "1975"),

  // E: lugar y año, sin palabra de dirección (el año no se toca).
  s("E1", "El congreso se realizó en Rosario 2019 con gran asistencia.", "Rosario", "2019"),
  s("E2", "Se conocieron durante el torneo de Mendoza 2005.", "Mendoza", "2005"),
  s("E3", "La feria Córdoba 2018 reunió a cien expositores.", "Córdoba", "2018"),
  s("E4", "Participó de las jornadas de Salta 2012 como disertante.", "Salta", "2012"),
  s(
    "E5",
    "El acuerdo se firmó en Buenos Aires 2020 tras meses de negociación.",
    "Buenos Aires",
    "2020",
  ),
  s("E6", "Obtuvo el título en La Plata 1998 y luego se mudó.", "La Plata", "1998"),
  s("E7", "El encuentro de Tucumán 2016 terminó sin acuerdo.", "Tucumán", "2016"),
  s("E8", "Viajaron a los juegos de Mar del Plata 1995 en tren.", "Mar del Plata", "1995"),
  s("E9", "La muestra Bariloche 2022 fue declarada de interés.", "Bariloche", "2022"),
  s("E10", "El informe compara los datos de Neuquén 2010 con los actuales.", "Neuquén", "2010"),

  // F: lugar y año con una palabra de la lista cerca por otro motivo (el riesgo: año tapado de más).
  s("F1", "Fijó domicilio tras el congreso de Rosario 2019.", "Rosario", "2019"),
  s("F2", "Vive allí desde el torneo de Mendoza 2005.", "Mendoza", "2005"),
  s("F3", "Reside en el país desde Córdoba 2018, cuando llegó a la feria.", "Córdoba", "2018"),
  s("F4", "La calle estuvo cortada durante Salta 2012.", "Salta", "2012"),
  s("F5", "Cambió de domicilio después de Tucumán 2016.", "Tucumán", "2016"),
  s("F6", "En La Plata 1998 pisó por primera vez un escenario.", "La Plata", "1998"),
  s("F7", "La avenida fue inaugurada para Bariloche 2022.", "Bariloche", "2022"),
  s("F8", "El torneo Neuquén 2010 de esta ciudad convocó a mil personas.", "Neuquén", "2010"),
  s("F9", "Viven juntos desde los juegos de Mar del Plata 1995.", "Mar del Plata", "1995"),
  s("F10", "Tras Rosario 2019, el departamento de cultura cerró.", "Rosario", "2019"),

  // G: variantes de escritura de la altura. G1 lleva el signo de grado (U+00B0) y G2 el ordinal
  // masculino (U+00BA): son distintos a propósito.
  s("G1", "Tiene domicilio en Maipú N° 1434 de esta ciudad.", "Maipú", "1434"),
  s("G2", "La actora vive en Sarmiento Nº 742.", "Sarmiento", "742"),
  s("G3", "El local está sito en Lavalle nro. 385.", "Lavalle", "385"),
  s("G4", "El inmueble de Viamonte número 867 fue tasado.", "Viamonte", "867"),
  s("G5", "El hecho ocurrió en Rivadavia al 4500, cerca de la estación.", "Rivadavia", "4500"),
  s("G6", "La planta funciona en Moreno 12450, en las afueras.", "Moreno", "12450"),
  s("G7", "El depósito queda en Balcarce No. 3120.", "Balcarce", "3120"),
  s("G8", "Se notificó en Alsina Nro 455 sin inconvenientes.", "Alsina", "455"),
  s("G9", "La finca se ubica en Urquiza N°98 según el plano.", "Urquiza", "98"),
  s("G10", "El galpón está en Callao al 11050.", "Callao", "11050"),

  // H: lugar seguido de un número que no es altura ni año. H4 y H5 no deben extenderse por la forma
  // del número; el resto mide cuánto se tapa de más con cualquiera de las dos variantes.
  s("H1", "Viajó a Mendoza 3 veces durante el año.", "Mendoza", "3"),
  s("H2", "Permaneció en Rosario 15 días por trabajo.", "Rosario", "15"),
  s("H3", "La sucursal de Bariloche 2 cerró sus puertas.", "Bariloche", "2"),
  s("H4", "Se reunieron en Salta 12/03/2021 por la mañana.", "Salta", "12"),
  s("H5", "El campo de Tucumán 1.250 hectáreas fue vendido.", "Tucumán", "1"),
  s("H6", "Recorrió Neuquén 40 kilómetros a pie.", "Neuquén", "40"),
  s("H7", "Pagó en La Plata 3500 pesos de multa.", "La Plata", "3500"),
  s("H8", "Llegó a Córdoba 20 minutos después.", "Córdoba", "20"),
];

/** Las dos oraciones cuyo número no se extiende por su forma (fecha, importe): ADR-212 §2. */
const SHAPE_EXCLUDED_IDS: ReadonlySet<string> = new Set(["H4", "H5"]);

/**
 * Qué espera ADR-212 de la regla por contexto («Cómo se decide si la regla alcanza»):
 * A, B, C y G, el número queda dentro de la dirección; D, a la vista; E, sin tocar; F, dentro (tapado
 * de más); H1, H2, H3, H6, H7 y H8, dentro (tapado de más); H4 y H5, sin tocar.
 */
export function expectedContextOutcome(sentence: AddressHeightSentence): ContextOutcome {
  switch (sentence.category) {
    case "A":
    case "B":
    case "C":
    case "G":
    case "F":
      return "inside";
    case "D":
      return "visible";
    case "E":
      return "untouched";
    case "H":
      return SHAPE_EXCLUDED_IDS.has(sentence.id) ? "untouched" : "inside";
  }
}

/** «Parece un año» (ADR-212 §3): cuatro dígitos con valor entre 1900 y 2099. */
export function isYearLike(digits: string): boolean {
  if (!/^\d{4}$/.test(digits)) return false;
  const value = Number(digits);
  return value >= 1900 && value <= 2099;
}
