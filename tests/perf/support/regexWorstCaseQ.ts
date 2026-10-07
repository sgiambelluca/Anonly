/**
 * Textos adversos y criterio de linealidad del caso `Q email search stays linear on adversarial text`
 * (`docs/core/Regex_Engine.md` §14, caso 35, ADR-211), que vive en `tests/perf/regex-worst-case.ts` junto
 * al de ADR-181. Todo puro: el script lo importa para generar los textos y para leer su curva.
 *
 * El criterio es el de ADR-181: una curva de tamaños (2 a 160 KiB), y duplicar la longitud no puede
 * cuadruplicar el trabajo. No hay gate temporal absoluto; solo un piso de ruido, por debajo del cual un
 * cociente no dice nada.
 */

export const Q_LABELS = [
  "adversarial-q",
  "adversarial-q-late-domain",
  "adversarial-q-long-local",
] as const;
export type QLabel = (typeof Q_LABELS)[number];

export function isQLabel(label: string): label is QLabel {
  return Q_LABELS.some((candidate) => candidate === label);
}

/**
 * Un tramo adverso: muchas `Q`, tramos de nombre largos en minúsculas con dos «punto, espacio» (el grupo
 * inicial de la forma), y una cola de dominio que NO termina en dos letras (`b.c.d...j`): ninguna `Q` de
 * estos tramos forma un email, así que una búsqueda que reintente desde cada carácter del prefijo o que
 * retroceda en el dominio paga caro, y una anclada en la `Q` no.
 */
const CHUNK = `${"a".repeat(40)}. ${"a".repeat(40)}. ${"a".repeat(40)}Qb.c.d.e.f.g.h.i.j`;
const DOMAIN_TAIL = "Qexample.org";

/**
 * Texto adverso de `chars` caracteres (justos o por defecto de unos pocos más: se corta al largo
 * pedido). Las «palabras» se separan con un espacio, como `Page.text`.
 *
 * - `adversarial-q`: solo tramos adversos; ningún email con `Q`.
 * - `adversarial-q-late-domain`: tramos adversos y, al final, un único email con `Q` y dos tramos de
 *   nombre («aaa. aaaQexample.org»).
 * - `adversarial-q-long-local`: una sola corrida de minúsculas del largo pedido seguida de
 *   `Qexample.org`: el nombre más largo posible y un único email con `Q`.
 */
export function makeQAdversarialText(chars: number, label: QLabel): string {
  if (label === "adversarial-q-long-local")
    return `${"a".repeat(Math.max(0, chars - DOMAIN_TAIL.length))}${DOMAIN_TAIL}`;
  const tail =
    label === "adversarial-q-late-domain"
      ? ` ${"a".repeat(40)}. ${"a".repeat(40)}${DOMAIN_TAIL}`
      : "";
  const body = Math.max(0, chars - tail.length);
  const chunks: string[] = [];
  let length = 0;
  while (length < body) {
    chunks.push(CHUNK);
    length += CHUNK.length + 1;
  }
  return `${chunks.join(" ").slice(0, body)}${tail}`;
}

/** Cuántas ocurrencias de email con `Q` tiene que dar el motor sobre el texto de cada etiqueta. */
export function expectedQEmailDetections(label: QLabel): number {
  return label === "adversarial-q" ? 0 : 1;
}

/** Las palabras del texto (separadas por un espacio), todas con `source: "ocr"` en la campaña. */
export function qWords(text: string): ReadonlyArray<string> {
  return text.split(" ");
}

export interface CurvePoint {
  readonly sizeKiB: number;
  readonly ms: number;
}

export interface DoublingStep {
  readonly fromKiB: number;
  readonly toKiB: number;
  readonly fromMs: number;
  readonly toMs: number;
  /** `toMs / fromMs`; `null` si el tiempo de partida es cero. */
  readonly ratio: number | null;
  /** Alguno de los dos tiempos está por debajo del piso de ruido: el cociente no se interpreta. */
  readonly belowNoiseFloor: boolean;
  /** Duplicar el largo multiplicó el tiempo por `quadraticRatio` o más, por encima del ruido. */
  readonly superLinear: boolean;
}

export const NOISE_FLOOR_MS = 2;
export const QUADRATIC_RATIO = 4;

export function median(values: ReadonlyArray<number>): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const upper = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[sorted.length / 2 - 1] ?? 0) + upper) / 2;
}

/** Mediana de las rondas por tamaño, ordenada por tamaño. */
export function medianCurve(samples: ReadonlyArray<CurvePoint>): ReadonlyArray<CurvePoint> {
  const sizes = [...new Set(samples.map((sample) => sample.sizeKiB))].sort((a, b) => a - b);
  return sizes.flatMap((sizeKiB) => {
    const ms = median(samples.filter((sample) => sample.sizeKiB === sizeKiB).map((s) => s.ms));
    return ms === null ? [] : [{ sizeKiB, ms }];
  });
}

/** Los pasos entre tamaños que son exactamente el doble uno del otro (10→20→40→80→160 KiB). */
export function doublingSteps(
  curve: ReadonlyArray<CurvePoint>,
  options: { readonly noiseFloorMs?: number; readonly quadraticRatio?: number } = {},
): ReadonlyArray<DoublingStep> {
  const noiseFloorMs = options.noiseFloorMs ?? NOISE_FLOOR_MS;
  const quadraticRatio = options.quadraticRatio ?? QUADRATIC_RATIO;
  const steps: DoublingStep[] = [];
  for (const from of curve) {
    const to = curve.find((point) => point.sizeKiB === from.sizeKiB * 2);
    if (to === undefined) continue;
    const ratio = from.ms > 0 ? to.ms / from.ms : null;
    const belowNoiseFloor = from.ms < noiseFloorMs || to.ms < noiseFloorMs;
    steps.push({
      fromKiB: from.sizeKiB,
      toKiB: to.sizeKiB,
      fromMs: from.ms,
      toMs: to.ms,
      ratio,
      belowNoiseFloor,
      superLinear: !belowNoiseFloor && ratio !== null && ratio >= quadraticRatio,
    });
  }
  return steps;
}

export interface LinearityVerdict {
  readonly label: QLabel;
  readonly curve: ReadonlyArray<CurvePoint>;
  readonly steps: ReadonlyArray<DoublingStep>;
  /** Hay algún paso de duplicación que cuadruplicó el tiempo por encima del ruido. */
  readonly superLinear: boolean;
  /** Pasos que se pudieron interpretar (por encima del piso de ruido). */
  readonly interpretableSteps: number;
}

export function linearityVerdict(
  label: QLabel,
  samples: ReadonlyArray<CurvePoint>,
): LinearityVerdict {
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
