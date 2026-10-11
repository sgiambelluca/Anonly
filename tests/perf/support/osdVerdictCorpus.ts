/**
 * M-O1 (`docs/roadmap/hardening/Confianza_Cierre_2026-10-08.md`, Frente 3): el corpus de la medición del
 * veredicto de orientación equivocado. Puro: sin pdf-lib, sin Chromium, sin disco.
 *
 * Son 140 PDF escaneados sintéticos (sin capa de texto):
 *
 * - los 64 PDF con texto y los 12 controles de la campaña de recuperación de ADR-190, sin cambios (los
 *   genera `adr190Fixtures.ts`; sus hashes se comparan con los de esa campaña);
 * - 64 PDF nuevos de página escasa: las ocho geometrías N1 a N8 de la tabla del plan, en los cuatro
 *   ángulos reales (0, 90, 180 y 270) y a 150 y 300 dpi.
 *
 * El texto de todas las geometrías sale de «Juan Perez DNI 34.567.891», repartido como dice la tabla.
 * La tabla no fija todo: lo que fija y lo que se eligió acá (margen, interlineado, alineación) está en
 * `GEOMETRIES` y en los comentarios de cada una. Es dato de la medición: no se acomoda para que algo se
 * lea. Si una geometría no se puede generar tal cual, es un hallazgo.
 */

import { DENSITIES, SOURCE_DPIS } from "./adr190Dpi.js";

export const PHYSICAL_ANGLES = [0, 90, 180, 270] as const;
export type PhysicalAngle = (typeof PHYSICAL_ANGLES)[number];

/** Los dos dpi de las geometrías nuevas. */
export const SPARSE_DPIS = [150, 300] as const;

export const SPARSE_DNI = "34.567.891";

export const OLD_CONTROL_DENSITIES = ["blank", "noise", "shapes"] as const;

export type GeometryId = "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7" | "N8";

/** Margen de las alineaciones a un borde (el mismo `x = 54` de los fixtures de ADR-190). */
export const PAGE_MARGIN_PT = 54;
/** Interlineado, en múltiplos del cuerpo de letra, cuando la geometría no fija las posiciones. */
export const LINE_PITCH_FACTOR = 1.5;

export type Placement =
  /** Cada renglón centrado en horizontal; el bloque centrado en vertical. */
  | { readonly kind: "centered" }
  /** Renglones alineados a la izquierda, contra el margen, desde arriba. */
  | { readonly kind: "top-left" }
  /** Renglones alineados a la derecha, contra el margen, el último sobre el margen inferior. */
  | { readonly kind: "bottom-right" }
  /** Posiciones fijas: el `x` común y la línea de base de cada renglón (la del E2E de ADR-190). */
  | { readonly kind: "fixed"; readonly x: number; readonly baselines: ReadonlyArray<number> }
  /** Un renglón por columna: la columna `i` empieza en `i × ancho/2`, más el margen, arriba. */
  | { readonly kind: "columns" };

export interface Geometry {
  readonly id: GeometryId;
  /** Ancho y alto de la página en puntos (sin girar). */
  readonly widthPt: number;
  readonly heightPt: number;
  readonly fontSize: number;
  readonly lines: ReadonlyArray<string>;
  readonly placement: Placement;
  /** Cómo lo dice la tabla del plan. */
  readonly planRow: string;
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const TWO_LINES = ["Juan Perez", "DNI 34.567.891"] as const;

export const GEOMETRIES: ReadonlyArray<Geometry> = [
  {
    id: "N1",
    widthPt: A4_WIDTH,
    heightPt: A4_HEIGHT,
    fontSize: 12,
    lines: ["Juan Perez DNI 34.567.891"],
    placement: { kind: "centered" },
    planRow: "A4, 12 pt, un renglón, centrado",
  },
  {
    id: "N2",
    widthPt: A4_WIDTH,
    heightPt: A4_HEIGHT,
    fontSize: 9,
    lines: ["Juan Perez DNI 34.567.891"],
    placement: { kind: "top-left" },
    planRow: "A4, 9 pt, un renglón, arriba a la izquierda",
  },
  {
    id: "N3",
    widthPt: A4_WIDTH,
    heightPt: A4_HEIGHT,
    fontSize: 14,
    // Se mantiene «DNI 34.567.891» junto, como en el corpus viejo; el nombre queda en dos renglones.
    lines: ["Juan", "Perez", "DNI 34.567.891"],
    placement: { kind: "bottom-right" },
    planRow: "A4, 14 pt, tres renglones, abajo a la derecha",
  },
  {
    id: "N4",
    widthPt: A4_WIDTH,
    heightPt: A4_HEIGHT,
    fontSize: 36,
    // «Una palabra y el número»: la palabra es «DNI». El nombre no entra (hallazgo: son 2 tokens, no 4).
    lines: ["DNI 34.567.891"],
    placement: { kind: "centered" },
    planRow: "A4, 36 pt, una palabra y el número, centrados",
  },
  {
    id: "N5",
    widthPt: 612,
    heightPt: 1008,
    fontSize: 12,
    lines: TWO_LINES,
    placement: { kind: "top-left" },
    planRow: "Oficio 612 × 1008 pt, 12 pt, dos renglones, arriba",
  },
  {
    id: "N6",
    widthPt: 420,
    heightPt: 595,
    fontSize: 11,
    lines: TWO_LINES,
    placement: { kind: "centered" },
    planRow: "A5 420 × 595 pt, 11 pt, dos renglones, centrados",
  },
  {
    id: "N7",
    widthPt: 280,
    heightPt: 220,
    fontSize: 26,
    lines: TWO_LINES,
    // La geometría del E2E `adr190-two-lines-osd-recovery.spec.ts`: x = 24; líneas de base 160 y 110.
    placement: { kind: "fixed", x: 24, baselines: [160, 110] },
    planRow: "280 × 220 pt, 26 pt, dos renglones (la geometría del E2E)",
  },
  {
    id: "N8",
    widthPt: A4_WIDTH,
    heightPt: A4_HEIGHT,
    fontSize: 10,
    lines: TWO_LINES,
    placement: { kind: "columns" },
    planRow: "A4, 10 pt, dos renglones en dos columnas, uno en cada mitad",
  },
];

export interface PlacedLine {
  readonly text: string;
  readonly x: number;
  /** Línea de base, en el espacio PDF (origen abajo a la izquierda). */
  readonly y: number;
  readonly width: number;
  readonly size: number;
}

/**
 * Posición de cada renglón. `measure` da el ancho del texto en puntos a un cuerpo de letra (en la
 * generación real, la métrica de Helvetica de pdf-lib).
 */
export function layoutLines(
  geometry: Geometry,
  measure: (text: string, size: number) => number,
): ReadonlyArray<PlacedLine> {
  const { widthPt, heightPt, fontSize, lines, placement } = geometry;
  const pitch = fontSize * LINE_PITCH_FACTOR;
  const widths = lines.map((text) => measure(text, fontSize));
  const place = (index: number, x: number, y: number): PlacedLine => ({
    text: lines[index] ?? "",
    x,
    y,
    width: widths[index] ?? 0,
    size: fontSize,
  });
  const indexes = lines.map((_, index) => index);
  switch (placement.kind) {
    case "centered": {
      // El centro del bloque cae en el centro de la página; 0,3 × cuerpo compensa el alto de x.
      const first = heightPt / 2 + ((lines.length - 1) * pitch) / 2 - fontSize * 0.3;
      return indexes.map((i) => place(i, (widthPt - (widths[i] ?? 0)) / 2, first - i * pitch));
    }
    case "top-left":
      return indexes.map((i) =>
        place(i, PAGE_MARGIN_PT, heightPt - PAGE_MARGIN_PT - fontSize - i * pitch),
      );
    case "bottom-right":
      return indexes.map((i) =>
        place(
          i,
          widthPt - PAGE_MARGIN_PT - (widths[i] ?? 0),
          PAGE_MARGIN_PT + (lines.length - 1 - i) * pitch,
        ),
      );
    case "fixed":
      return indexes.map((i) => place(i, placement.x, placement.baselines[i] ?? 0));
    case "columns":
      return indexes.map((i) =>
        place(
          i,
          (i * widthPt) / lines.length + PAGE_MARGIN_PT,
          heightPt - PAGE_MARGIN_PT - fontSize,
        ),
      );
  }
}

/** Un renglón puede cortarse en el borde: la distribución debe dejar todo adentro de la página. */
export function lineFitsPage(line: PlacedLine, geometry: Geometry): boolean {
  return (
    line.x >= 0 &&
    line.x + line.width <= geometry.widthPt &&
    line.y >= 0 &&
    line.y + line.size <= geometry.heightPt
  );
}

export function expectedTextOf(geometry: Geometry): string {
  return geometry.lines.join("\n");
}

export type CorpusSet = "old-text" | "old-control" | "sparse";

export interface CorpusEntry {
  /** `<id>-<dpi>-<ángulo>`; en el corpus viejo, el `fixtureKey` de ADR-190. */
  readonly key: string;
  readonly set: CorpusSet;
  /** La densidad (corpus viejo) o la geometría (N1 a N8). */
  readonly label: string;
  readonly sourceDpi: number;
  /** Giro físico horario del escaneo. */
  readonly physicalRotation: PhysicalAngle;
  /** Ángulo de corrección que el OSD debería afirmar: `(360 − giro) mod 360`. */
  readonly correctAngle: PhysicalAngle;
  readonly geometry: Geometry | null;
}

export function correctionAngle(rotation: PhysicalAngle): PhysicalAngle {
  return ((360 - rotation) % 360) as PhysicalAngle;
}

export function entryKey(label: string, sourceDpi: number, rotation: PhysicalAngle): string {
  return `${label}-${sourceDpi}-${rotation}`;
}

function entry(
  set: CorpusSet,
  label: string,
  sourceDpi: number,
  rotation: PhysicalAngle,
  geometry: Geometry | null,
): CorpusEntry {
  return {
    key: entryKey(label, sourceDpi, rotation),
    set,
    label,
    sourceDpi,
    physicalRotation: rotation,
    correctAngle: correctionAngle(rotation),
    geometry,
  };
}

/** Los 140 PDF, en el orden de la campaña: corpus viejo con texto, controles y geometrías nuevas. */
export function corpusEntries(): ReadonlyArray<CorpusEntry> {
  const oldText = DENSITIES.flatMap((density) =>
    SOURCE_DPIS.flatMap((dpi) =>
      PHYSICAL_ANGLES.map((angle) => entry("old-text", density, dpi, angle, null)),
    ),
  );
  const controls = OLD_CONTROL_DENSITIES.flatMap((density) =>
    SOURCE_DPIS.map((dpi) => entry("old-control", density, dpi, 0, null)),
  );
  const sparse = GEOMETRIES.flatMap((geometry) =>
    SPARSE_DPIS.flatMap((dpi) =>
      PHYSICAL_ANGLES.map((angle) => entry("sparse", geometry.id, dpi, angle, geometry)),
    ),
  );
  return [...oldText, ...controls, ...sparse];
}

/** La página completa del corpus viejo es el control denso; todo lo demás con texto es escaso. */
export function isDense(candidate: Pick<CorpusEntry, "set" | "label">): boolean {
  return candidate.set === "old-text" && candidate.label === "full";
}

export function hasText(candidate: Pick<CorpusEntry, "set">): boolean {
  return candidate.set !== "old-control";
}
