/**
 * M-D2 (`docs/roadmap/hardening/Confianza_Cierre_2026-10-08.md`, Frente 2 y «Anexo — corpus de M-D2»): las
 * oraciones sintéticas con las que se mide qué deja a la vista la aplicación cuando una dirección viene con
 * una palabra clave antes («Av.», «calle», «domicilio en»…). Son datos: las escribió el planificador y **no
 * se cambian ni se acomodan** para que el resultado salga de una u otra manera. Si una no se puede generar
 * tal cual (un glifo que la fuente no tiene), es un hallazgo.
 *
 * Son 55 oraciones base. Cada una se mide en tres escrituras (`n`, `M`, `S`) de la **página entera**: el
 * relleno de antes, la oración y el relleno de después, los mismos rellenos de M-D1. Las partes de cada
 * oración (vía, nombre, altura, resto) se transforman igual que la oración. Son 165 páginas.
 *
 * Todo es inventado: ninguna de estas calles, números ni personas es un dato real.
 */

import { FILLER_AFTER, FILLER_BEFORE } from "./addressHeightSentences.js";

export type KeywordCategory = "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K7" | "K8";

export const KEYWORD_CATEGORIES: ReadonlyArray<KeywordCategory> = [
  "K1",
  "K2",
  "K3",
  "K4",
  "K5",
  "K6",
  "K7",
  "K8",
];

/** `n`: como está escrita; `M`: toda en mayúsculas con tildes; `S`: mayúsculas sin tildes ni diéresis. */
export type KeywordScript = "n" | "M" | "S";

export const KEYWORD_SCRIPTS: ReadonlyArray<KeywordScript> = ["n", "M", "S"];

export type KeywordPartName = "via" | "nombre" | "altura" | "resto";

/** Orden en que aparecen las partes dentro de la oración. */
export const KEYWORD_PART_NAMES: ReadonlyArray<KeywordPartName> = [
  "via",
  "nombre",
  "altura",
  "resto",
];

/** Cada parte, tal como aparece en la oración; `null` si la oración no la tiene. */
export interface KeywordParts {
  readonly via: string | null;
  readonly nombre: string | null;
  readonly altura: string | null;
  readonly resto: string | null;
}

export interface KeywordBase {
  readonly id: string;
  readonly category: KeywordCategory;
  readonly text: string;
  readonly parts: KeywordParts;
}

/** Una página del documento de prueba: una oración base en una escritura. */
export interface KeywordPage {
  /** `<id base>/<escritura>`, por ejemplo `K1-1/M`. */
  readonly id: string;
  readonly baseId: string;
  readonly category: KeywordCategory;
  readonly script: KeywordScript;
  /** La oración ya transformada a la escritura de la página. */
  readonly text: string;
  /** Las partes ya transformadas. */
  readonly parts: KeywordParts;
}

function isCategory(value: string): value is KeywordCategory {
  return (KEYWORD_CATEGORIES as ReadonlyArray<string>).includes(value);
}

function categoryOf(id: string): KeywordCategory {
  const category = id.slice(0, 2);
  if (!isCategory(category)) throw new Error(`Categoría desconocida en el id ${id}`);
  return category;
}

/** Una oración con partes. `null` es la «—» de la tabla del anexo. */
function b(
  id: string,
  text: string,
  via: string | null,
  nombre: string,
  altura: string | null,
  resto: string | null,
): KeywordBase {
  return { id, category: categoryOf(id), text, parts: { via, nombre, altura, resto } };
}

/** Una trampa de K8: sin partes. */
function trap(id: string, text: string): KeywordBase {
  return {
    id,
    category: categoryOf(id),
    text,
    parts: { via: null, nombre: null, altura: null, resto: null },
  };
}

export const ADDRESS_KEYWORD_BASES: ReadonlyArray<KeywordBase> = [
  // K1: palabra de vía y altura.
  b(
    "K1-1",
    "La oficina funciona en Av. Corrientes 1980 de lunes a viernes.",
    "Av.",
    "Corrientes",
    "1980",
    null,
  ),
  b(
    "K1-2",
    "El consultorio se encuentra en avenida Pueyrredón 1999.",
    "avenida",
    "Pueyrredón",
    "1999",
    null,
  ),
  b(
    "K1-3",
    "Se constituyó domicilio procesal en la calle Tucumán 1650.",
    "calle",
    "Tucumán",
    "1650",
    null,
  ),
  b(
    "K1-4",
    "El depósito queda sobre Avda. Rivadavia 4520, a metros de la estación.",
    "Avda.",
    "Rivadavia",
    "4520",
    null,
  ),
  b("K1-5", "La entrega se hizo en pasaje Rauch 742 por la tarde.", "pasaje", "Rauch", "742", null),
  b("K1-6", "El taller está en Pje. Güemes 315, al fondo.", "Pje.", "Güemes", "315", null),
  b(
    "K1-7",
    "El comercio abrió sus puertas en boulevard Oroño 1260.",
    "boulevard",
    "Oroño",
    "1260",
    null,
  ),
  b("K1-8", "La sucursal de Bv. Gálvez 2150 permanece cerrada.", "Bv.", "Gálvez", "2150", null),
  b(
    "K1-9",
    "El estudio atiende en diagonal Norte 615 por la mañana.",
    "diagonal",
    "Norte",
    "615",
    null,
  ),

  // K2: palabra de domicilio, sin palabra de vía.
  b(
    "K2-1",
    "El demandado, con domicilio en Maipú 1434 de esta ciudad, no contestó.",
    null,
    "Maipú",
    "1434",
    null,
  ),
  b(
    "K2-2",
    "La actora, domiciliada en Sarmiento 742, promueve demanda.",
    null,
    "Sarmiento",
    "742",
    null,
  ),
  b(
    "K2-3",
    "El imputado, domiciliado en Belgrano 1950, quedó detenido.",
    null,
    "Belgrano",
    "1950",
    null,
  ),
  b(
    "K2-4",
    "La firma, con domicilio real en Lavalle 385, fue intimada.",
    null,
    "Lavalle",
    "385",
    null,
  ),
  b("K2-5", "El inmueble sito en Mitre 1985 fue embargado.", null, "Mitre", "1985", null),
  b("K2-6", "La finca sita en Alsina 455 fue tasada por el perito.", null, "Alsina", "455", null),
  b(
    "K2-7",
    "Fija domicilio legal en Viamonte 867 para las notificaciones.",
    null,
    "Viamonte",
    "867",
    null,
  ),

  // K3: nombre de varias palabras.
  b(
    "K3-1",
    "Vive en Av. Presidente Roque Sáenz Peña 1234 desde hace años.",
    "Av.",
    "Presidente Roque Sáenz Peña",
    "1234",
    null,
  ),
  b(
    "K3-2",
    "El local está en calle Hipólito Yrigoyen 2470.",
    "calle",
    "Hipólito Yrigoyen",
    "2470",
    null,
  ),
  b(
    "K3-3",
    "Con domicilio en General José de San Martín 856 de esta ciudad.",
    null,
    "General José de San Martín",
    "856",
    null,
  ),
  b(
    "K3-4",
    "La escribanía funciona en avenida Juan Bautista Alberdi 3120.",
    "avenida",
    "Juan Bautista Alberdi",
    "3120",
    null,
  ),
  b(
    "K3-5",
    "Domiciliada en Doctor Luis Agote 98 de esta localidad.",
    null,
    "Doctor Luis Agote",
    "98",
    null,
  ),
  b(
    "K3-6",
    "El club tiene su sede en calle Fray Justo Santa María de Oro 2745.",
    "calle",
    "Fray Justo Santa María de Oro",
    "2745",
    null,
  ),
  b(
    "K3-7",
    "Con domicilio en avenida del Mar 450 de esta ciudad.",
    "avenida",
    "del Mar",
    "450",
    null,
  ),

  // K4: nombre con número o fecha.
  b("K4-1", "Constituyó domicilio en calle 25 de Mayo 350.", "calle", "25 de Mayo", "350", null),
  b(
    "K4-2",
    "El banco está en Av. 9 de Julio 1200, frente a la plaza.",
    "Av.",
    "9 de Julio",
    "1200",
    null,
  ),
  b("K4-3", "La escuela funciona en calle 1° de Mayo 480.", "calle", "1° de Mayo", "480", null),
  b(
    "K4-4",
    "Con domicilio en 12 de Octubre 1575 de esta ciudad.",
    null,
    "12 de Octubre",
    "1575",
    null,
  ),
  b(
    "K4-5",
    "El centro vecinal se reúne en avenida 2 de Abril 640.",
    "avenida",
    "2 de Abril",
    "640",
    null,
  ),

  // K5: calle numerada. El «N°», el «número» o el «Nº» que sigue al nombre no es parte.
  b("K5-1", "Reside en calle 50 N° 889 de La Plata.", "calle", "50", "889", null),
  b("K5-2", "El estudio se encuentra en calle 7 número 1240.", "calle", "7", "1240", null),
  b(
    "K5-3",
    "Con domicilio en calle 13 entre 44 y 45 de esa ciudad.",
    "calle",
    "13",
    null,
    "entre 44 y 45",
  ),
  b("K5-4", "La oficina está en diagonal 74 N° 1532.", "diagonal", "74", "1532", null),
  b(
    "K5-5",
    "El campo tiene entrada por ruta 205 kilómetro 54.",
    "ruta",
    "205",
    null,
    "kilómetro 54",
  ),
  b("K5-6", "Vive en Av. 44 Nº 2360, casa del fondo.", "Av.", "44", "2360", null),

  // K6: sin altura.
  b("K6-1", "El hecho ocurrió en Av. Corrientes y Maipú.", "Av.", "Corrientes", null, "y Maipú"),
  b(
    "K6-2",
    "El choque fue en calle Lavalle esquina Callao.",
    "calle",
    "Lavalle",
    null,
    "esquina Callao",
  ),
  b(
    "K6-3",
    "Se lo vio por última vez en avenida Santa Fe entre Uruguay y Talcahuano.",
    "avenida",
    "Santa Fe",
    null,
    "entre Uruguay y Talcahuano",
  ),
  b(
    "K6-4",
    "El demandado tiene domicilio en calle Balcarce sin número.",
    "calle",
    "Balcarce",
    null,
    "sin número",
  ),
  b("K6-5", "La parada está sobre Av. Colón al llegar a la rotonda.", "Av.", "Colón", null, null),
  b(
    "K6-6",
    "Con domicilio en calle Urquiza s/n de la localidad de Tigre.",
    "calle",
    "Urquiza",
    null,
    "s/n",
  ),

  // K7: con piso o departamento después.
  b(
    "K7-1",
    "Sito en calle Lavalle 385, piso 3, depto. B.",
    "calle",
    "Lavalle",
    "385",
    "piso 3, depto. B",
  ),
  b(
    "K7-2",
    "Con domicilio en Av. Callao 1105, 2° piso, oficina 14.",
    "Av.",
    "Callao",
    "1105",
    "2° piso, oficina 14",
  ),
  b(
    "K7-3",
    "Domiciliado en Viamonte 867 piso 4 departamento C.",
    null,
    "Viamonte",
    "867",
    "piso 4 departamento C",
  ),
  b(
    "K7-4",
    "Reside en avenida Belgrano 1950, PB, dpto. 2.",
    "avenida",
    "Belgrano",
    "1950",
    "PB, dpto. 2",
  ),
  b("K7-5", "La actora vive en calle Alvear 1920 4° A.", "calle", "Alvear", "1920", "4° A"),
  b(
    "K7-6",
    "Con domicilio en Maipú 1434, torre 2, piso 8, de esta ciudad.",
    null,
    "Maipú",
    "1434",
    "torre 2, piso 8",
  ),

  // K8: trampas. La palabra clave aparece y no hay ninguna dirección.
  trap("K8-1", "La calle estuvo cortada 3 horas por la marcha."),
  trap("K8-2", "Los vecinos de la avenida reclamaron 15 veces."),
  trap("K8-3", "El pasaje costó 4500 pesos según el recibo."),
  trap("K8-4", "La ruta quedó habilitada después de 48 horas."),
  trap("K8-5", "No se pudo establecer su domicilio en 2019 ni después."),
  trap("K8-6", "El cambio de domicilio en 30 días fue rechazado."),
  trap("K8-7", "Trabaja en la calle desde 1998 como vendedor."),
  trap("K8-8", "La diagonal del terreno mide 120 metros."),
  trap("K8-9", "Sobre la avenida circulaban 2 camiones."),
];

/** Las vocales con tilde o diéresis en mayúscula (el texto ya pasó a mayúsculas) y su letra sin ella. */
const ACCENT_FREE: Readonly<Record<string, string>> = {
  Á: "A",
  É: "E",
  Í: "I",
  Ó: "O",
  Ú: "U",
  Ü: "U",
};

/**
 * La escritura de una cadena. `M`: pasa todo a mayúsculas y conserva las tildes. `S`: además quita tildes y
 * diéresis; la «Ñ» se conserva. Los signos «°» y «º» no son tildes y quedan como están.
 */
export function applyScript(script: KeywordScript, value: string): string {
  if (script === "n") return value;
  const upper = value.toUpperCase();
  if (script === "M") return upper;
  return upper.replace(/[ÁÉÍÓÚÜ]/g, (letter) => ACCENT_FREE[letter] ?? letter);
}

function applyScriptToParts(script: KeywordScript, parts: KeywordParts): KeywordParts {
  const transform = (value: string | null): string | null =>
    value === null ? null : applyScript(script, value);
  return {
    via: transform(parts.via),
    nombre: transform(parts.nombre),
    altura: transform(parts.altura),
    resto: transform(parts.resto),
  };
}

/** Las 165 páginas, en el orden del documento: primero todas en `n`, después en `M` y al final en `S`. */
export const ADDRESS_KEYWORD_PAGES: ReadonlyArray<KeywordPage> = KEYWORD_SCRIPTS.flatMap(
  (script): ReadonlyArray<KeywordPage> =>
    ADDRESS_KEYWORD_BASES.map((base) => ({
      id: `${base.id}/${script}`,
      baseId: base.id,
      category: base.category,
      script,
      text: applyScript(script, base.text),
      parts: applyScriptToParts(script, base.parts),
    })),
);

/** Los tres párrafos de la página, en orden de lectura: relleno, oración, relleno (en la escritura de la página). */
export function keywordPageParagraphs(page: KeywordPage): ReadonlyArray<string> {
  return [
    applyScript(page.script, FILLER_BEFORE),
    page.text,
    applyScript(page.script, FILLER_AFTER),
  ];
}

/** Lo que se espera que la aplicación extraiga como texto de cada página. */
export function expectedKeywordPageText(page: KeywordPage): string {
  return keywordPageParagraphs(page).join(" ");
}

/** Las partes presentes de una página, en el orden de la oración. */
export function presentParts(
  parts: KeywordParts,
): ReadonlyArray<{ readonly name: KeywordPartName; readonly text: string }> {
  return KEYWORD_PART_NAMES.flatMap((name) => {
    const text = parts[name];
    return text === null || text === "" ? [] : [{ name, text }];
  });
}
