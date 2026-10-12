/**
 * M-O2 (`docs/roadmap/hardening/Confianza_Cierre_2026-10-08.md`, Frente 3, «M-O2 — lo que falta medir antes
 * de enmendar ADR-190»): los tres conjuntos nuevos del arnés `osd-verdict`. Puro: sin pdf-lib, sin
 * Chromium, sin disco.
 *
 * - **ruido** (Parte A): 24 hojas A4 sin texto con seis tipos de ruido de escáner, a 150 y 300 dpi, derechas
 *   y giradas 90°. Quién paga la regla RC.
 * - **margen** (Parte C): 24 PDF con un sello vertical en el margen derecho (el que leen las pasadas de
 *   ADR-121), solo (M1), con la página completa de ADR-190 (M2) o con dos renglones de cuerpo (M3), en los
 *   cuatro giros y a 150 y 300 dpi.
 * - **reales** (Parte B): hasta 81 páginas de cuatro documentos que llegan por `ANONLY_REAL_DOC_R1` a `R4`.
 *   Acá solo se sabe cuántas páginas tiene cada uno y cómo se llama cada observación (`R1-p07`); nada de su
 *   contenido ni de su ruta.
 *
 * Es dato de la medición: no se acomoda para que algo se lea o no se lea.
 */

import { PHYSICAL_ANGLES, correctionAngle, type PhysicalAngle } from "./osdVerdictCorpus.js";

export const NOISE_DPIS = [150, 300] as const;
/** Derecha y girada 90°. */
export const NOISE_ROTATIONS = [0, 90] as const;
export const MARGIN_DPIS = [150, 300] as const;
export const REAL_DPI_DIGITAL = 150;

export type NoiseId = "RU1" | "RU2" | "RU3" | "RU4" | "RU5" | "RU6";
export type MarginId = "M1" | "M2" | "M3";
export type RealDocId = "R1" | "R2" | "R3" | "R4";

/** Páginas que dice el plan de cada documento real: se comprueban antes de medir. */
export const REAL_DOC_PAGES: Readonly<Record<RealDocId, number>> = {
  R1: 20,
  R2: 5,
  R3: 5,
  R4: 51,
};
/** R1 es un escaneo (resolución nativa); R2 a R4 son digitales (se rasterizan a 150 dpi). */
export const REAL_DOC_IS_SCAN: Readonly<Record<RealDocId, boolean>> = {
  R1: true,
  R2: false,
  R3: false,
  R4: false,
};

export const PAGE_A4_WIDTH = 595.28;
export const PAGE_A4_HEIGHT = 841.89;

// ------------------------------------------------------------------ ruido

export type NoiseOp =
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      /** Nivel de gris, 0 negro a 1 blanco. */
      readonly gray: number;
    }
  | {
      readonly kind: "circle";
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly gray: number;
    };

export interface NoiseSpec {
  readonly id: NoiseId;
  readonly description: string;
  readonly ops: ReadonlyArray<NoiseOp>;
}

/** El generador congruencial de los fixtures de ADR-190 (`adr190Fixtures.ts`): mismas constantes. */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function specks(count: number, size: number, seed: number): NoiseOp[] {
  const next = lcg(seed);
  const ops: NoiseOp[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = next() * PAGE_A4_WIDTH;
    const y = next() * PAGE_A4_HEIGHT;
    ops.push({ kind: "rect", x, y, width: size, height: size, gray: 0 });
  }
  return ops;
}

/**
 * Cantidad de motas de RU5. Calibrada con dos mediciones piloto de la tinta (`inkRatio` de la app) de la hoja
 * derecha a 150 dpi: 1100 motas dieron 0,00663 y 315 dieron 0,00191. A 300 dpi la misma hoja da menos tinta
 * (0,0007 girada 90°), porque la imagen del OSD se reduce y las motas se diluyen.
 */
export const NOISE_DENSE_SPECKS = 315;
export const NOISE_DENSE_SPECK_SIZE = 0.5;
/** La tinta a la que apunta RU5: por debajo de `INK_PRESENT_RATIO` (0,002). */
export const NOISE_DENSE_TARGET_INK = 0.0019;

export const NOISE_SPECS: ReadonlyArray<NoiseSpec> = [
  {
    id: "RU1",
    description: "motas dispersas: 200 motas de 0,4 pt (el control de ruido de ADR-190)",
    ops: specks(200, 0.4, 190),
  },
  {
    id: "RU2",
    description: "una línea de sombra en el borde izquierdo: 2 pt de ancho, gris 0,4",
    ops: [{ kind: "rect", x: 0, y: 0, width: 2, height: PAGE_A4_HEIGHT, gray: 0.4 }],
  },
  {
    id: "RU3",
    description: "dos perforaciones: círculos negros de 7 pt de radio en el margen izquierdo",
    ops: [
      { kind: "circle", x: 28, y: PAGE_A4_HEIGHT * 0.3, radius: 7, gray: 0 },
      { kind: "circle", x: 28, y: PAGE_A4_HEIGHT * 0.7, radius: 7, gray: 0 },
    ],
  },
  {
    id: "RU4",
    description: "una línea de doblez: horizontal a media altura, 0,8 pt, gris 0,7",
    ops: [
      { kind: "rect", x: 0, y: PAGE_A4_HEIGHT / 2, width: PAGE_A4_WIDTH, height: 0.8, gray: 0.7 },
    ],
  },
  {
    id: "RU5",
    description: `motas más densas: ${NOISE_DENSE_SPECKS} motas de ${NOISE_DENSE_SPECK_SIZE} pt, tinta cercana a ${NOISE_DENSE_TARGET_INK}`,
    ops: specks(NOISE_DENSE_SPECKS, NOISE_DENSE_SPECK_SIZE, 505),
  },
  {
    id: "RU6",
    description:
      "motas con una sombra de borde: 200 motas de 0,4 pt y 3 pt de gris 0,8 en el borde derecho",
    ops: [
      ...specks(200, 0.4, 606),
      { kind: "rect", x: PAGE_A4_WIDTH - 3, y: 0, width: 3, height: PAGE_A4_HEIGHT, gray: 0.8 },
    ],
  },
];

// ------------------------------------------------------------------ margen

export const STAMP_TEXT = "Maria Gomez DNI 28.123.456";
export const STAMP_DNI = "28.123.456";
export const STAMP_FONT_SIZE = 11;
/** El sello va a 90°, con la base de los renglones a `PAGE_WIDTH - 40` (el de `qa-stamp.pdf`). */
export const STAMP_X_FROM_RIGHT = 40;
export const STAMP_Y = 120;
/** Las franjas de margen de ADR-121 (`MARGIN_STRIP_RATIO` de `worker/kernel.ts`). */
export const MARGIN_STRIP_RATIO = 0.2;

/** La página completa de la campaña de ADR-190 (`adr190Fixtures.ts`, densidad `full`). */
export function fullBodyLines(): ReadonlyArray<string> {
  return [
    "Documento de prueba",
    "Juan Perez",
    "DNI 34.567.891",
    ...Array.from(
      { length: 31 },
      (_, i) => `Registro ${i + 1} de lectura para comprobar la calidad del documento.`,
    ),
  ];
}

export interface MarginSpec {
  readonly id: MarginId;
  readonly description: string;
  readonly bodyLines: ReadonlyArray<string>;
}

/** El cuerpo está a la izquierda (`x = 54`, de arriba hacia abajo, a 20 pt) como en el corpus de ADR-190. */
export const MARGIN_BODY_X = 54;
export const MARGIN_BODY_TOP = 780;
export const MARGIN_BODY_PITCH = 20;
export const MARGIN_BODY_FONT_SIZE = 12;

export const MARGIN_SPECS: ReadonlyArray<MarginSpec> = [
  {
    id: "M1",
    description: "solo el sello vertical en el margen derecho, sin cuerpo",
    bodyLines: [],
  },
  {
    id: "M2",
    description: "la página completa de la campaña de ADR-190 y el sello",
    bodyLines: fullBodyLines(),
  },
  {
    id: "M3",
    description: "dos renglones de cuerpo y el sello",
    bodyLines: ["Juan Perez", "DNI 34.567.891"],
  },
];

export const MARGIN_BODY_DNI = "34.567.891";

export function marginBodyText(spec: MarginSpec): string {
  return spec.bodyLines.join("\n");
}

// ------------------------------------------------------------------ entradas

export type M2Kind = "noise" | "margin" | "real";

export interface M2Entry {
  /** `RU3-150-90`, `M2-300-180` o `R1-p07`. */
  readonly key: string;
  readonly kind: M2Kind;
  readonly label: string;
  /** `null` en R1: la resolución es la nativa de cada página. */
  readonly sourceDpi: number | null;
  readonly physicalRotation: PhysicalAngle;
  /** `null` en los reales: se desconoce el giro y el de referencia lo calcula el análisis. */
  readonly correctAngle: PhysicalAngle | null;
  readonly noise: NoiseSpec | null;
  readonly margin: MarginSpec | null;
  readonly realDoc: RealDocId | null;
  /** Desde 1. */
  readonly realPage: number | null;
}

export function pageKey(doc: RealDocId, page: number): string {
  return `${doc}-p${String(page).padStart(2, "0")}`;
}

export function noiseEntries(): ReadonlyArray<M2Entry> {
  return NOISE_SPECS.flatMap((noise) =>
    NOISE_DPIS.flatMap((dpi) =>
      NOISE_ROTATIONS.map(
        (rotation): M2Entry => ({
          key: `${noise.id}-${dpi}-${rotation}`,
          kind: "noise",
          label: noise.id,
          sourceDpi: dpi,
          physicalRotation: rotation,
          correctAngle: correctionAngle(rotation),
          noise,
          margin: null,
          realDoc: null,
          realPage: null,
        }),
      ),
    ),
  );
}

export function marginEntries(): ReadonlyArray<M2Entry> {
  return MARGIN_SPECS.flatMap((margin) =>
    MARGIN_DPIS.flatMap((dpi) =>
      PHYSICAL_ANGLES.map(
        (rotation): M2Entry => ({
          key: `${margin.id}-${dpi}-${rotation}`,
          kind: "margin",
          label: margin.id,
          sourceDpi: dpi,
          physicalRotation: rotation,
          correctAngle: correctionAngle(rotation),
          noise: null,
          margin,
          realDoc: null,
          realPage: null,
        }),
      ),
    ),
  );
}

/** Las páginas de los documentos reales que están disponibles (las variables definidas). */
export function realEntries(available: ReadonlyArray<RealDocId>): ReadonlyArray<M2Entry> {
  return available.flatMap((doc) =>
    Array.from(
      { length: REAL_DOC_PAGES[doc] },
      (_, index): M2Entry => ({
        key: pageKey(doc, index + 1),
        kind: "real",
        label: doc,
        sourceDpi: REAL_DOC_IS_SCAN[doc] ? null : REAL_DPI_DIGITAL,
        physicalRotation: 0,
        correctAngle: null,
        noise: null,
        margin: null,
        realDoc: doc,
        realPage: index + 1,
      }),
    ),
  );
}

/** Los 48 sintéticos y las páginas reales disponibles, en el orden de la campaña. */
export function corpusEntriesM2(available: ReadonlyArray<RealDocId>): ReadonlyArray<M2Entry> {
  return [...noiseEntries(), ...marginEntries(), ...realEntries(available)];
}

export const REAL_DOC_IDS: ReadonlyArray<RealDocId> = ["R1", "R2", "R3", "R4"];

export function envVarOf(doc: RealDocId): string {
  return `ANONLY_REAL_DOC_${doc}`;
}
