/**
 * Corpus `SR` (docs/roadmap/ocr/OCR_DPI_Descendente_Campana_Plan.md §4): veinte páginas A4 a 300 dpi
 * nativos con la forma de R2 (misma cantidad de palabras por página), texto inventado y
 * determinista, unas nueve entidades por página con su verdad. Copia la densidad de R2, no su
 * contenido: ningún dato sale de un documento real.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import {
  PAGE_HEIGHT_PT,
  PAGE_WIDTH_PT,
  countWords,
  cuitCheckDigit,
  ibanCheckDigits,
  type EntityTypeName,
  type SyntheticSource,
  type TruthEntity,
} from "./ocrDpiDownCorpus.js";

/** Densidad por página de R2, redondeada a 5 (agregados neutros; no se leyó ningún documento real). */
export const SR_WORDS_PER_PAGE: ReadonlyArray<number> = [
  290, 300, 335, 280, 270, 315, 340, 350, 385, 295, 360, 330, 295, 290, 305, 355, 285, 150, 60, 0,
];
export const SR_SEED = "sr-v1";
export const SR_FONT_SIZE = 12;
export const SR_LINE_SPACING = 1.5;
/** Margen en puntos; el renglón tope (385 palabras) entra con el de la mayoría de los corpus. */
export const SR_MARGIN_PT = 50;
const SR_ENTITIES_PER_PAGE = 9;

const FIRST_NAMES: ReadonlyArray<string> = [
  "Marina",
  "Alberto",
  "Lucía",
  "Ricardo",
  "Carolina",
  "Gustavo",
  "Valeria",
  "Sebastián",
  "Mariana",
  "Federico",
  "Paula",
  "Martín",
  "Claudia",
  "Andrés",
  "Silvia",
  "Javier",
  "Natalia",
  "Rodrigo",
  "Florencia",
  "Esteban",
];
const LAST_NAMES: ReadonlyArray<string> = [
  "Suárez",
  "Gutiérrez",
  "Fernández",
  "Benítez",
  "Domínguez",
  "Navarro",
  "Ibarra",
  "Cabrera",
  "Molina",
  "Quiroga",
  "Peralta",
  "Sosa",
  "Villalba",
  "Medina",
  "Acosta",
  "Romero",
  "Herrera",
  "Ledesma",
  "Maldonado",
  "Figueroa",
];
const MONTHS: ReadonlyArray<string> = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Oraciones inventadas, sin dígitos; el texto de relleno sale de recorrerlas en ciclo. */
const SR_SENTENCES: ReadonlyArray<string> = [
  "La parte actora solicita que se tenga presente lo manifestado en la presentación anterior y que se continúe con el trámite.",
  "El tribunal dispone que se libren los oficios necesarios para producir la prueba ofrecida por ambas partes.",
  "Se deja constancia de que la notificación fue cursada en el domicilio electrónico constituido en autos.",
  "Corresponde correr traslado a la contraria por el plazo legal antes de resolver la cuestión planteada.",
  "La pericia contable fue presentada dentro del término y las partes podrán formular observaciones fundadas.",
  "No se advierten defectos formales que impidan dar curso al recurso interpuesto contra la resolución apelada.",
  "El expediente se encuentra en condiciones de ser elevado a la cámara para su estudio y decisión final.",
  "Las costas del incidente se imponen en el orden causado atendiendo a la naturaleza de la controversia.",
  "Se intima a la demandada para que acompañe la documentación faltante bajo apercibimiento de ley.",
  "La audiencia de conciliación resultó fracasada por la incomparecencia de la parte requerida sin justificación.",
  "Habiendo vencido el plazo concedido, pasen los autos a despacho para dictar la sentencia definitiva.",
  "El perito designado aceptó el cargo y manifestó que presentará su informe dentro del plazo fijado.",
  "Se tiene por cumplida la carga impuesta y se ordena el archivo provisorio de las actuaciones por ahora.",
  "La sociedad acompañó el balance general y el estado de resultados correspondientes al ejercicio anterior.",
  "Del escrito de contestación se desprende que los hechos invocados fueron negados en forma general y particular.",
  "El juzgado resolvió hacer lugar a la medida cautelar solicitada y fijó la contracautela que estimó suficiente.",
  "Se ordena notificar por cédula a los herederos denunciados para que tomen intervención en el proceso sucesorio.",
  "La defensa planteó la nulidad de la diligencia por entender que no se respetaron las formas previstas.",
  "El registro de la propiedad informó que el inmueble no registra gravámenes ni inhibiciones a nombre del titular.",
  "Quedan las partes notificadas de la providencia anterior y de las que se dicten en lo sucesivo.",
];

/** mulberry32: determinista y sin dependencias. */
function prng(seed: string): () => number {
  let state = 0;
  for (const ch of seed) state = (Math.imul(state, 31) + ch.charCodeAt(0)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

interface SrEntityLine {
  readonly type: EntityTypeName;
  readonly detector: "regex" | "ner";
  readonly before: string;
  readonly value: string;
  readonly after: string;
}

/** Tipos de las nueve entidades de cada página, en el orden en que aparecen. */
const SR_ENTITY_ORDER: ReadonlyArray<EntityTypeName> = [
  "PERSON",
  "DNI",
  "EMAIL",
  "DATE",
  "IBAN",
  "CUIT",
  "PHONE",
  "PERSON",
  "DNI",
];

function digits(random: () => number, count: number): string {
  let out = "";
  for (let index = 0; index < count; index += 1) out += Math.floor(random() * 10).toString();
  return out;
}

function pick<T>(random: () => number, list: ReadonlyArray<T>): T {
  const value = list[Math.floor(random() * list.length)];
  if (value === undefined) throw new Error("lista vacía");
  return value;
}

function buildEntityLine(
  type: EntityTypeName,
  pageIndex: number,
  slot: number,
  random: () => number,
): SrEntityLine {
  switch (type) {
    case "PERSON": {
      const name = `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)}`;
      return slot === 0
        ? {
            type,
            detector: "ner",
            before: "El informe fue redactado por ",
            value: name,
            after: ".",
          }
        : { type, detector: "ner", before: "La reunión presidió ", value: name, after: "." };
    }
    case "DNI": {
      const value = `${20 + Math.floor(random() * 40)}.${digits(random, 3)}.${digits(random, 3)}`;
      return { type, detector: "regex", before: "Exhibió DNI ", value, after: " ante la mesa." };
    }
    case "EMAIL": {
      const local = `${plain(pick(random, FIRST_NAMES))}.${plain(pick(random, LAST_NAMES))}`;
      const domain = pick(random, ["example.com", "example.org", "example.net"]);
      return {
        type,
        detector: "regex",
        before: "Correo: ",
        value: `${local}@${domain}`,
        after: ".",
      };
    }
    case "DATE": {
      const day = 1 + Math.floor(random() * 28);
      const month = 1 + Math.floor(random() * 12);
      const year = 2019 + Math.floor(random() * 8);
      const value =
        pageIndex % 3 === 0
          ? `${day} de ${MONTHS[month - 1]} de ${year}`
          : `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
      return { type, detector: "regex", before: "Fecha ", value, after: "." };
    }
    case "IBAN": {
      const bban = digits(random, 20);
      const raw = `ES${ibanCheckDigits("ES", bban)}${bban}`;
      const value = raw.match(/.{1,4}/g)?.join(" ") ?? raw;
      return { type, detector: "regex", before: "Cuenta IBAN ", value, after: "." };
    }
    case "CUIT": {
      for (;;) {
        const prefix = pick(random, ["20", "23", "24", "27"]);
        const body = digits(random, 8);
        try {
          const value = `${prefix}-${body}-${cuitCheckDigit(`${prefix}${body}`)}`;
          return { type, detector: "regex", before: "CUIT ", value, after: "." };
        } catch {
          // dígito 10: ese CUIT no existe, se sortea otro.
        }
      }
    }
    case "PHONE": {
      const value = `+54 11 ${digits(random, 4)}-${digits(random, 4)}`;
      return { type, detector: "regex", before: "Teléfono: ", value, after: "." };
    }
    default:
      throw new Error(`tipo no soportado en SR: ${String(type)}`);
  }
}

function wrapWords(
  words: ReadonlyArray<string>,
  font: PDFFont,
  size: number,
  maxWidth: number,
): ReadonlyArray<string> {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** PDF vectorial de `SR` y su verdad. Determinista: la semilla y las listas fijan todos los bytes. */
export async function buildSrSource(): Promise<SyntheticSource> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const random = prng(SR_SEED);
  const size = SR_FONT_SIZE;
  const lineHeight = size * SR_LINE_SPACING;
  const maxWidth = PAGE_WIDTH_PT - 2 * SR_MARGIN_PT;
  const maxLines = Math.floor((PAGE_HEIGHT_PT - 2 * SR_MARGIN_PT) / lineHeight);
  const lines: { pageIndex: number; text: string }[] = [];
  const entities: TruthEntity[] = [];

  // Flujo de palabras de relleno: continúa de una página a la siguiente.
  const stream = SR_SENTENCES.join(" ").split(" ");
  let cursor = 0;
  const takeWords = (count: number): string[] => {
    const out: string[] = [];
    for (let index = 0; index < count; index += 1) {
      out.push(stream[cursor % stream.length] ?? "");
      cursor += 1;
    }
    return out;
  };

  for (const [pageIndex, targetWords] of SR_WORDS_PER_PAGE.entries()) {
    const page = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
    if (targetWords === 0) continue;
    const entityLines = SR_ENTITY_ORDER.slice(0, SR_ENTITIES_PER_PAGE).map((type, slot) =>
      buildEntityLine(type, pageIndex, slot, random),
    );
    const entityWords = entityLines.reduce(
      (sum, entity) => sum + countWords(`${entity.before}${entity.value}${entity.after}`),
      0,
    );
    const fillerWords = targetWords - entityWords;
    if (fillerWords < 0)
      throw new Error(
        `SR página ${pageIndex}: las entidades (${entityWords}) superan ${targetWords}`,
      );
    const groups = entityLines.length + 1;
    const rows: { text: string; entity: SrEntityLine | null }[] = [];
    for (let group = 0; group < groups; group += 1) {
      const count = Math.floor(fillerWords / groups) + (group < fillerWords % groups ? 1 : 0);
      for (const text of wrapWords(takeWords(count), font, size, maxWidth))
        rows.push({ text, entity: null });
      const entity = entityLines[group];
      if (entity !== undefined)
        rows.push({ text: `${entity.before}${entity.value}${entity.after}`, entity });
    }
    if (rows.length > maxLines)
      throw new Error(
        `SR página ${pageIndex}: ${rows.length} renglones no entran en ${maxLines} a ${size} pt`,
      );
    for (const [row, entry] of rows.entries()) {
      const baseline = PAGE_HEIGHT_PT - SR_MARGIN_PT - size - row * lineHeight;
      page.drawText(entry.text, {
        x: SR_MARGIN_PT,
        y: baseline,
        size,
        font,
        color: rgb(0, 0, 0),
      });
      lines.push({ pageIndex, text: entry.text });
      if (entry.entity !== null) {
        if (font.widthOfTextAtSize(entry.text, size) > maxWidth)
          throw new Error(`SR página ${pageIndex}: un renglón de entidad no entra en una línea`);
        entities.push({
          type: entry.entity.type,
          value: entry.entity.value,
          detector: entry.entity.detector,
          pageIndex,
          box: {
            x: SR_MARGIN_PT + font.widthOfTextAtSize(entry.entity.before, size),
            y: PAGE_HEIGHT_PT - baseline - size * 0.8,
            width: font.widthOfTextAtSize(entry.entity.value, size),
            height: size,
          },
        });
      }
    }
  }

  return {
    corpus: "SR",
    bytes: await doc.save(),
    truth: {
      corpus: "SR",
      fontSize: size,
      pageCount: SR_WORDS_PER_PAGE.length,
      wordsPerPage: SR_WORDS_PER_PAGE.map((_, pageIndex) =>
        lines
          .filter((line) => line.pageIndex === pageIndex)
          .reduce((sum, line) => sum + countWords(line.text), 0),
      ),
      lineHeightPt: lineHeight,
      marginPt: SR_MARGIN_PT,
      seed: SR_SEED,
      rotations: null,
      degradation: null,
      lines,
      text: lines.map((line) => line.text).join("\n"),
      entities,
    },
  };
}
