/**
 * Corpus de la campaña de DPI descendente (docs/roadmap/ocr/OCR_DPI_Descendente_Campana_Plan.md §4).
 *
 * Los sintéticos se arman en Node con pdf-lib (texto vectorial, Helvetica) y llevan su verdad: el
 * texto de cada renglón y las entidades con su tipo, su valor y la caja del renglón en puntos. El
 * rasterizado a 300 dpi (y la degradación de `SD`) ocurre aparte, en un Chromium separado
 * (`scannedFixtureCache.ts`). Las cajas de la verdad son la caja aproximada del texto en la página
 * sin girar (origen arriba a la izquierda); sirven de registro, no se comparan con las del Core.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import type { ScanDegradation } from "../../e2e/support/scannedPdf.js";

export const PAGE_WIDTH_PT = 595;
export const PAGE_HEIGHT_PT = 842;
export const MARGIN_PT = 50;
export const NATIVE_DPI = 300;

export const SD_VARIANT_IDS = ["SD1", "SD2", "SD3", "SD4", "SD5"] as const;
export type SdVariantId = (typeof SD_VARIANT_IDS)[number];
export type SyntheticCorpusId = "S12" | "S10" | "S8" | "S6" | SdVariantId | "SE" | "SR";
/** Los seis de una página (o dos): comparten el conjunto de entidades de `ENTITY_SPECS`. `SR` tiene su generador. */
export type PageCorpusId = Exclude<SyntheticCorpusId, "SR">;
export type RealCorpusId = "R2" | "R3";
export type CorpusId = SyntheticCorpusId | RealCorpusId;
export const SYNTHETIC_CORPUS_IDS: ReadonlyArray<SyntheticCorpusId> = [
  "S12",
  "S10",
  "S8",
  "S6",
  ...SD_VARIANT_IDS,
  "SE",
  "SR",
];
export const REAL_CORPUS_IDS: ReadonlyArray<RealCorpusId> = ["R2", "R3"];
export const ALL_CORPUS_IDS: ReadonlyArray<CorpusId> = [
  ...SYNTHETIC_CORPUS_IDS,
  ...REAL_CORPUS_IDS,
];
/** Se informa aparte y no decide el brazo (§6). */
export const NON_DECIDING_CORPORA: ReadonlyArray<CorpusId> = ["S6"];

export function isSyntheticCorpus(id: string): id is SyntheticCorpusId {
  return SYNTHETIC_CORPUS_IDS.some((candidate) => candidate === id);
}
export function isRealCorpus(id: string): id is RealCorpusId {
  return REAL_CORPUS_IDS.some((candidate) => candidate === id);
}

export type EntityTypeName = "PERSON" | "DNI" | "CUIT" | "PHONE" | "EMAIL" | "IBAN" | "DATE";
export const ENTITY_TYPE_NAMES: ReadonlyArray<EntityTypeName> = [
  "PERSON",
  "DNI",
  "CUIT",
  "PHONE",
  "EMAIL",
  "IBAN",
  "DATE",
];

export interface TruthBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TruthEntity {
  readonly type: EntityTypeName;
  readonly value: string;
  readonly detector: "regex" | "ner";
  readonly pageIndex: number;
  readonly box: TruthBox;
}

export interface CorpusTruth {
  readonly corpus: SyntheticCorpusId;
  readonly fontSize: number;
  readonly pageCount: number;
  /** Palabras (separadas por espacios) de cada página, contadas sobre los renglones dibujados. */
  readonly wordsPerPage: ReadonlyArray<number>;
  readonly lineHeightPt: number;
  readonly marginPt: number;
  /** Semilla del generador, si el corpus usa una (solo `SR`). */
  readonly seed: string | null;
  /** Giro físico aplicado a cada página al rasterizar; `null` si ninguna se gira. */
  readonly rotations: ReadonlyArray<0 | 90 | 180 | 270> | null;
  readonly degradation: ScanDegradation | null;
  readonly lines: ReadonlyArray<{ readonly pageIndex: number; readonly text: string }>;
  readonly text: string;
  readonly entities: ReadonlyArray<TruthEntity>;
}

interface EntitySpec {
  readonly type: EntityTypeName;
  readonly detector: "regex" | "ner";
  readonly before: string;
  readonly value: string;
  readonly after: string;
}

/**
 * Receta de `SD`, fijada por su aspecto y no ajustada mirando la lectura de ningún brazo (plan §4,
 * «Por qué `SD` lleva varias semillas»). Una fotocopia legible para una persona:
 * - desenfoque gaussiano de 1,0 px a 300 dpi (0,085 mm), menos que el de un escáner de oficina;
 * - negro llevado a 40/255 y blanco a 235/255: contraste moderado de papel gris y tóner flojo, con
 *   el texto bien legible a simple vista (relación de luminancia de casi 6 a 1);
 * - ruido gaussiano de σ = 6 niveles (unos 2,4 % del rango), granulado visible pero sin comerse
 *   los trazos.
 * Las cinco variantes difieren solo en la semilla del ruido. Un cambio de cualquier parámetro o de
 * la semilla cambia la clave de cache del fixture.
 */
export const SD_SEEDS: Readonly<Record<SdVariantId, number>> = {
  SD1: 190_001,
  SD2: 190_002,
  SD3: 190_003,
  SD4: 190_004,
  SD5: 190_005,
};
export function sdDegradation(variant: SdVariantId): ScanDegradation {
  return {
    recipe: "photocopy-v2",
    seed: SD_SEEDS[variant],
    blurSigmaPx: 1,
    blackLevel: 40,
    whiteLevel: 235,
    noiseSigma: 6,
  };
}

export function isSdVariant(id: string): id is SdVariantId {
  return SD_VARIANT_IDS.some((candidate) => candidate === id);
}
/** `SD` solo duplica el brazo 300 en su primera variante (el doble control de variación). */
export const SINGLE_CONTROL_CORPORA: ReadonlyArray<CorpusId> = ["SD2", "SD3", "SD4", "SD5"];

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Dígito verificador de AFIP (módulo 11) para un CUIT de diez dígitos sin verificador. */
export function cuitCheckDigit(firstTen: string): number {
  if (!/^\d{10}$/.test(firstTen)) throw new Error("cuitCheckDigit: se esperan diez dígitos");
  let sum = 0;
  for (let index = 0; index < 10; index += 1)
    sum += Number(firstTen[index]) * (CUIT_WEIGHTS[index] ?? 0);
  const check = 11 - (sum % 11);
  if (check === 11) return 0;
  if (check === 10) throw new Error("cuitCheckDigit: dígito 10, el CUIT no existe");
  return check;
}

function cuit(prefix: string, body: string): string {
  return `${prefix}-${body}-${cuitCheckDigit(`${prefix}${body}`)}`;
}

/** Orden intercalado: los tipos no quedan agrupados y las posiciones varían a lo largo de la página. */
const ENTITY_SPECS: ReadonlyArray<EntitySpec> = [
  {
    type: "PERSON",
    detector: "ner",
    before: "El informe fue redactado por ",
    value: "Marina Suárez",
    after: ", coordinadora del área legal.",
  },
  {
    type: "DNI",
    detector: "regex",
    before: "El compareciente exhibió su DNI ",
    value: "34.567.891",
    after: " ante la mesa de entradas.",
  },
  {
    type: "EMAIL",
    detector: "regex",
    before: "Correo electrónico de contacto: ",
    value: "marina.suarez@example.com",
    after: ".",
  },
  {
    type: "DATE",
    detector: "regex",
    before: "La audiencia tuvo lugar el ",
    value: "15/03/2026",
    after: " en la sede del tribunal.",
  },
  {
    type: "IBAN",
    detector: "regex",
    before: "Cuenta de depósito IBAN ",
    value: "ES91 2100 0418 4502 0005 1332",
    after: " a nombre del actor.",
  },
  {
    type: "CUIT",
    detector: "regex",
    before: "La sociedad figura inscripta bajo el CUIT ",
    value: cuit("20", "12345678"),
    after: " en el registro.",
  },
  {
    type: "PHONE",
    detector: "regex",
    before: "Teléfono de contacto: ",
    value: "+54 11 4567-8901",
    after: ".",
  },
  {
    type: "PERSON",
    detector: "ner",
    before: "La reunión fue presidida por ",
    value: "Alberto Gutiérrez",
    after: ", director de la institución.",
  },
  {
    type: "DNI",
    detector: "regex",
    before: "La apoderada acreditó identidad con DNI ",
    value: "27.123.456",
    after: " en la audiencia.",
  },
  {
    type: "EMAIL",
    detector: "regex",
    before: "Se notificará a ",
    value: "contacto.estudio@example.org",
    after: " oportunamente.",
  },
  {
    type: "DATE",
    detector: "regex",
    before: "El escrito fue presentado el ",
    value: "7 de julio de 2026",
    after: " sin observaciones.",
  },
  {
    type: "IBAN",
    detector: "regex",
    before: "Cuenta de la contraria IBAN ",
    value: "GB82 WEST 1234 5698 7654 32",
    after: " informada en autos.",
  },
  {
    type: "CUIT",
    detector: "regex",
    before: "El profesional factura con CUIT ",
    value: cuit("27", "23456789"),
    after: " desde el año pasado.",
  },
  {
    type: "PHONE",
    detector: "regex",
    before: "Teléfono alternativo: ",
    value: "+54 11 5234-7788",
    after: ".",
  },
  {
    type: "PERSON",
    detector: "ner",
    before: "La propuesta fue presentada por ",
    value: "Lucía Fernández",
    after: ", gerente de recursos humanos.",
  },
  {
    type: "PERSON",
    detector: "ner",
    before: "El peritaje estuvo a cargo de ",
    value: "Ricardo Benítez",
    after: ", ingeniero de la planta.",
  },
];

/** Relleno neutro: sin dígitos ni mayúsculas tras una coma, para que no dispare ningún detector. */
const FILLER_SENTENCES: ReadonlyArray<string> = [
  "El presente expediente continúa su trámite ordinario sin novedades que informar en esta instancia procesal.",
  "Se adjunta constancia de notificación electrónica cursada oportunamente a las partes intervinientes en autos.",
  "Por cuerda separada tramita la incidencia conexa que no modifica el objeto principal de estas actuaciones.",
  "Corresponde el pase a despacho para la resolución de las cuestiones pendientes previa vista a las partes.",
  "La parte actora ratifica los términos de su presentación anterior y solicita se tenga presente lo manifestado.",
  "El tribunal dispone que se libren los oficios correspondientes para la producción de la prueba ofrecida.",
];

/** Entidades de las páginas de `SE`: dos renglones por página, a 0° y a 180°. */
const SPARSE_PAGES: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 1],
  [7, 8],
];

function wrapToWidth(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): ReadonlyArray<string> {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** Renglones de relleno consecutivos tomados de un ciclo fijo de oraciones. */
function fillerLines(
  count: number,
  font: PDFFont,
  size: number,
  maxWidth: number,
): ReadonlyArray<string> {
  const lines: string[] = [];
  let sentence = 0;
  while (lines.length < count) {
    lines.push(
      ...wrapToWidth(
        FILLER_SENTENCES[sentence % FILLER_SENTENCES.length] ?? "",
        font,
        size,
        maxWidth,
      ),
    );
    sentence += 1;
  }
  return lines.slice(0, count);
}

export const LINE_HEIGHT_FACTOR = 1.4;

interface CorpusShape {
  readonly fontSize: number;
  readonly degradation: ScanDegradation | null;
  readonly sparse: boolean;
}

const SHAPES: Readonly<Record<PageCorpusId, CorpusShape>> = {
  S12: { fontSize: 12, degradation: null, sparse: false },
  S10: { fontSize: 10, degradation: null, sparse: false },
  S8: { fontSize: 8, degradation: null, sparse: false },
  S6: { fontSize: 6, degradation: null, sparse: false },
  SD1: { fontSize: 10, degradation: sdDegradation("SD1"), sparse: false },
  SD2: { fontSize: 10, degradation: sdDegradation("SD2"), sparse: false },
  SD3: { fontSize: 10, degradation: sdDegradation("SD3"), sparse: false },
  SD4: { fontSize: 10, degradation: sdDegradation("SD4"), sparse: false },
  SD5: { fontSize: 10, degradation: sdDegradation("SD5"), sparse: false },
  SE: { fontSize: 10, degradation: null, sparse: true },
};

/** Cantidad de palabras de un texto, contadas como los renglones dibujados (separadas por espacios). */
export function countWords(text: string): number {
  return text.split(" ").filter((word) => word !== "").length;
}

/** Dígitos de control de un IBAN (ISO 13616, módulo 97) para un `bban` bajo `countryCode`. */
export function ibanCheckDigits(countryCode: string, bban: string): string {
  let numeric = "";
  for (const ch of `${bban}${countryCode}00`)
    numeric += ch >= "0" && ch <= "9" ? ch : (ch.charCodeAt(0) - 55).toString();
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return (98 - remainder).toString().padStart(2, "0");
}

/** Giros de `SE`: la segunda página se rasteriza a 180°. */
export const SE_ROTATIONS: ReadonlyArray<0 | 90 | 180 | 270> = [0, 180];

export function corpusShape(corpus: PageCorpusId): CorpusShape {
  return SHAPES[corpus];
}

export interface SyntheticSource {
  readonly corpus: SyntheticCorpusId;
  readonly bytes: Uint8Array;
  readonly truth: CorpusTruth;
}

/** PDF vectorial de un corpus sintético y su verdad. Determinista: mismas entradas, mismos bytes. */
export async function buildPageSource(corpus: PageCorpusId): Promise<SyntheticSource> {
  const shape = SHAPES[corpus];
  const size = shape.fontSize;
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const maxWidth = PAGE_WIDTH_PT - 2 * MARGIN_PT;
  const lineHeight = size * LINE_HEIGHT_FACTOR;
  const lines: { pageIndex: number; text: string }[] = [];
  const entities: TruthEntity[] = [];

  const pages: ReadonlyArray<ReadonlyArray<number>> = shape.sparse
    ? SPARSE_PAGES
    : [ENTITY_SPECS.map((_, index) => index)];

  for (const [pageIndex, entityIndices] of pages.entries()) {
    const page = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
    const totalLines = shape.sparse
      ? entityIndices.length
      : Math.floor((PAGE_HEIGHT_PT - 2 * MARGIN_PT) / lineHeight);
    const entityLines = entityIndices.map((specIndex) => {
      const spec = ENTITY_SPECS[specIndex];
      if (spec === undefined) throw new Error("entity spec fuera de rango");
      return spec;
    });
    // Posiciones de los renglones de entidad: repartidas parejo, una por tramo de relleno.
    const entitySlots = new Set(
      entityLines.map((_, order) =>
        shape.sparse
          ? order
          : Math.round(((order + 1) * (totalLines - 1)) / (entityLines.length + 1)),
      ),
    );
    const fillerNeeded = totalLines - entityLines.length;
    const filler = fillerLines(fillerNeeded, font, size, maxWidth);
    let fillerCursor = 0;
    let entityCursor = 0;
    for (let row = 0; row < totalLines; row += 1) {
      const baseline = PAGE_HEIGHT_PT - MARGIN_PT - size - row * lineHeight;
      let text: string;
      if (entitySlots.has(row)) {
        const spec = entityLines[entityCursor];
        entityCursor += 1;
        if (spec === undefined) throw new Error("renglón de entidad sin spec");
        text = `${spec.before}${spec.value}${spec.after}`;
        const width = font.widthOfTextAtSize(text, size);
        if (width > maxWidth)
          throw new Error(`el renglón de entidad no entra en una línea a ${size} pt: ${text}`);
        entities.push({
          type: spec.type,
          value: spec.value,
          detector: spec.detector,
          pageIndex,
          box: {
            x: MARGIN_PT + font.widthOfTextAtSize(spec.before, size),
            y: PAGE_HEIGHT_PT - baseline - size * 0.8,
            width: font.widthOfTextAtSize(spec.value, size),
            height: size,
          },
        });
      } else {
        text = filler[fillerCursor] ?? "";
        fillerCursor += 1;
      }
      page.drawText(text, { x: MARGIN_PT, y: baseline, size, font, color: rgb(0, 0, 0) });
      lines.push({ pageIndex, text });
    }
  }

  return {
    corpus,
    bytes: await doc.save(),
    truth: {
      corpus,
      fontSize: size,
      pageCount: pages.length,
      wordsPerPage: pages.map((_, pageIndex) =>
        lines
          .filter((line) => line.pageIndex === pageIndex)
          .reduce((sum, line) => sum + countWords(line.text), 0),
      ),
      lineHeightPt: lineHeight,
      marginPt: MARGIN_PT,
      seed: null,
      rotations: shape.sparse ? SE_ROTATIONS : null,
      degradation: shape.degradation,
      lines,
      text: lines.map((line) => line.text).join("\n"),
      entities,
    },
  };
}

/** Esperado por tipo, con la cantidad de entidades de cada uno. */
export function countTruthByType(
  entities: ReadonlyArray<TruthEntity>,
): Readonly<Record<EntityTypeName, number>> {
  const counts: Record<EntityTypeName, number> = {
    PERSON: 0,
    DNI: 0,
    CUIT: 0,
    PHONE: 0,
    EMAIL: 0,
    IBAN: 0,
    DATE: 0,
  };
  for (const entity of entities) counts[entity.type] += 1;
  return counts;
}
