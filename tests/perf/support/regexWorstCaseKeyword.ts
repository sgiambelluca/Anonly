/**
 * Textos adversos y criterio de linealidad del caso `keyword address search stays linear on adversarial text`
 * (`docs/core/Regex_Engine.md` §14, caso 36, ADR-217 §5), que vive en `tests/perf/regex-worst-case.ts` junto
 * a los de email (ADR-181 y ADR-211). Todo puro: el script lo importa para generar los textos y para leer su
 * curva.
 *
 * El criterio es el de ADR-181, el mismo de `regexWorstCaseQ.ts`: una curva de tamaños (2 a 160 KiB), y
 * duplicar la longitud no puede cuadruplicar el trabajo. No hay gate temporal absoluto; solo un piso de
 * ruido, por debajo del cual un cociente no dice nada.
 *
 * El patrón `address-keyword-ar` empieza en una palabra clave y toma de una a seis palabras de nombre antes
 * de una altura obligatoria. Un texto adverso es el que lo hace arrancar muchas veces y fallar siempre: muchas
 * palabras clave sin altura, nombres de seis palabras o más, cadenas de conectores, y palabras muy largas.
 * Ningún cuerpo adverso lleva dígitos (ninguno puede ser una altura); al final va una única dirección real
 * para comprobar que el patrón sigue encontrándola.
 */

import {
  doublingSteps,
  medianCurve,
  type CurvePoint,
  type DoublingStep,
} from "./regexWorstCaseQ.js";

export const KEYWORD_LABELS = [
  "adversarial-keyword-street",
  "adversarial-keyword-connectors",
  "adversarial-keyword-domicile",
  "adversarial-keyword-caps",
  "adversarial-keyword-long-word",
  "adversarial-keyword-single-long-word",
] as const;
export type KeywordLabel = (typeof KEYWORD_LABELS)[number];

export function isKeywordLabel(label: string): label is KeywordLabel {
  return KEYWORD_LABELS.some((candidate) => candidate === label);
}

const NAME_WORDS = "Alfa Beta Gamma Delta Epsilon Zeta";
const VIA_WORDS = ["calle", "Av.", "avenida", "Pje.", "boulevard", "diagonal", "Bv.", "Avda."];
const CONNECTORS = "de la de los del las y e";

/** La dirección real del final: la única que el patrón tiene que encontrar. */
const TAIL = " calle Tucumán 1650";
const TAIL_CAPS = " CALLE TUCUMÁN 1650";

/** El trozo que se repite en cada etiqueta (sin la dirección del final). `index` rota la palabra de vía. */
function chunk(
  label: Exclude<KeywordLabel, "adversarial-keyword-single-long-word">,
  index: number,
): string {
  const via = VIA_WORDS[index % VIA_WORDS.length] ?? "calle";
  switch (label) {
    case "adversarial-keyword-street":
      // Una palabra de vía y seis palabras con mayúscula, sin altura: el nombre llega al tope y falla.
      return `${via} ${NAME_WORDS}`;
    case "adversarial-keyword-connectors":
      // Una palabra de vía y una cadena larga de conectores: todo parece nombre y nada es una altura.
      return `${via} ${CONNECTORS} ${CONNECTORS} ${CONNECTORS}`;
    case "adversarial-keyword-domicile":
      // Una frase de domicilio y palabras con mayúscula sin altura.
      return `${["con domicilio real en", "domiciliada en", "sito en", "domicilio legal en"][index % 4] ?? "sito en"} ${NAME_WORDS} Eta Theta`;
    case "adversarial-keyword-caps":
      // Todo en mayúsculas: cada palabra, incluida cada palabra de vía, puede ser parte de un nombre.
      return `DOMICILIADA EN CALLE AVENIDA PASAJE DIAGONAL BOULEVARD ${NAME_WORDS.toUpperCase()} ETA THETA`;
    case "adversarial-keyword-long-word":
      // Una palabra de vía y una palabra de 2000 letras con mayúscula inicial.
      return `${via} A${"a".repeat(1999)}`;
  }
}

/**
 * Texto adverso de `chars` caracteres (justos: se corta el cuerpo para que entre la dirección del final).
 * Las «palabras» se separan con un espacio, como `Page.text`.
 *
 * - `adversarial-keyword-street`: palabras de vía seguidas de seis palabras con mayúscula, sin altura.
 * - `adversarial-keyword-connectors`: palabras de vía seguidas de cadenas de conectores.
 * - `adversarial-keyword-domicile`: frases de domicilio seguidas de ocho palabras con mayúscula, sin altura.
 * - `adversarial-keyword-caps`: lo mismo en mayúsculas, con palabras de vía y de domicilio mezcladas.
 * - `adversarial-keyword-long-word`: palabras de vía seguidas de palabras de 2000 letras.
 * - `adversarial-keyword-single-long-word`: una sola palabra de vía y una única palabra con mayúscula del
 *   largo pedido.
 */
export function makeKeywordAdversarialText(chars: number, label: KeywordLabel): string {
  const tail = label === "adversarial-keyword-caps" ? TAIL_CAPS : TAIL;
  const body = Math.max(0, chars - tail.length);
  if (label === "adversarial-keyword-single-long-word")
    return `${`calle A${"a".repeat(Math.max(0, body - 7))}`.slice(0, body)}${tail}`;
  const chunks: string[] = [];
  let length = 0;
  let index = 0;
  while (length < body) {
    const next = chunk(label, index);
    chunks.push(next);
    length += next.length + 1;
    index += 1;
  }
  return `${chunks.join(" ").slice(0, body)}${tail}`;
}

/** Cuántas direcciones tiene que dar el patrón sobre el texto de cada etiqueta: la del final. */
export function expectedKeywordAddressDetections(): number {
  return 1;
}

export interface KeywordLinearityVerdict {
  readonly label: KeywordLabel;
  readonly curve: ReadonlyArray<CurvePoint>;
  readonly steps: ReadonlyArray<DoublingStep>;
  /** Hay algún paso de duplicación que cuadruplicó el tiempo por encima del ruido. */
  readonly superLinear: boolean;
  /** Pasos que se pudieron interpretar (por encima del piso de ruido). */
  readonly interpretableSteps: number;
}

export function keywordLinearityVerdict(
  label: KeywordLabel,
  samples: ReadonlyArray<CurvePoint>,
): KeywordLinearityVerdict {
  const curve = medianCurve(samples);
  const steps = doublingSteps(curve);
  return {
    label,
    curve,
    steps,
    superLinear: steps.some((step) => step.superLinear),
    interpretableSteps: steps.filter((step) => !step.belowNoiseFloor).length,
  };
}
