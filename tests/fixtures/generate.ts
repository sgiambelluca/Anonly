/**
 * Generador de fixtures (PDFs de prueba) para los tests del Core de Anonly.
 *
 * Fuente de verdad: tests/fixtures/README.md
 *
 * Uso:
 *   pnpm tsx tests/fixtures/generate.ts
 *
 * Genera:
 *   - text-10p.pdf  (10 páginas, texto con entidades conocidas para Regex/NER/Grouping)
 *   - empty.pdf     (1 página sin contenido; pdf-lib no permite 0 páginas)
 *   - corrupt.pdf   (header %PDF- válido + cuerpo no-PDF determinista)
 *
 * No genera (requieren tools externos):
 *   - protected.pdf (qpdf --encrypt; documentado en README)
 *   - scanned-10p.pdf (pdftoppm + pdf-lib; Hito 3 OCR)
 *   - text-50p.pdf, huge-1000p.pdf, mixed-30p.pdf (hitos posteriores)
 *
 * Reglas:
 *   - Sin datos personales reales. Todos los valores son sintéticos.
 *   - Reproducible: misma ejecución → mismo contenido semántico.
 *   - El contenido de text-10p.pdf coincide con la tabla de "Contenido conocido"
 *     en tests/fixtures/README.md. Si cambia el texto, actualizar el README.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

// Import relativo, no "@anonly/shared": este archivo corre por dos caminos —
// `tsx tests/fixtures/generate.ts` (pnpm fixtures:generate) y, importado,
// bajo vitest (generate.test.ts). vitest resuelve el bare specifier vía el
// alias de vitest.config.ts, pero `tsx` en ejecución directa NO: no hay
// tsconfig con "paths" para "@anonly/shared" alcanzable desde este archivo
// fuera de vitest (tests/tsconfig.json es solo para `tsc --noEmit`), y
// verificado que `tsx` no lo resuelve (ERR_MODULE_NOT_FOUND). El import
// relativo a `shared/src/index.ts` — el único `index.ts` del paquete
// (Code_Standards.md §5) — funciona en los dos caminos por igual.
import { EntityType, synthesize } from "../../packages/anonymization-core/shared/src/index.js";

/*
 * Layout de `text-10p.pdf`. Exportado porque `tests/e2e/support/fixtures.ts`
 * arma variantes del mismo documento en memoria y tiene que renderizar
 * idénticas las páginas que no toca: hasta acá replicaba estos seis valores
 * y `wrapText`, de modo que un cambio de layout podía desincronizar las
 * variantes sin que nada fallara. El borde de import entre los dos módulos
 * ya existía (ese archivo importa `TEXT_10P_PAGES` de acá).
 */
export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;
export const MARGIN_X = 50;
export const MARGIN_Y = 750;
export const FONT_SIZE = 12;
export const LINE_HEIGHT = 18;
/** Corte de línea de `text-10p.pdf`, en caracteres. */
export const WRAP_CHARS = 95;

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * Detección de entry point portable (no depende de `import.meta.main` ni
 * `isMainModule` que no está tipado en todas las versiones de @types/node).
 * Compara la URL del módulo actual con el primer argumento de process.argv.
 */
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

/**
 * Contenido de text-10p.pdf.
 * Debe coincidir con la tabla de "Contenido conocido" en tests/fixtures/README.md.
 * Fuente: docs/core/PDF_Engine.md §13 + docs/roadmap/MVP.md §11.2.
 */
export const TEXT_10P_PAGES: ReadonlyArray<string> = [
  "Juan Pérez vive en Belgrano 1234, DNI 34.567.891, CUIT 20-12345678-9, teléfono +54 11 1234-5678, email juan.perez@example.com.",
  "María Gómez, DNI 18.445.212, trabaja en Empresa S.A. con sede en Rivadavia 455.",
  "Carlos López, DNI 42.998.103, IBAN ES00 1234 5678 9012 3456 7890, tarjeta 4532 1234 5678 9901.",
  "Página 4 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 5 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 6 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 7 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 8 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 9 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 10 sin datos sensibles — texto neutro para tests de no-false-positives.",
];

export async function generateText10p(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const text of TEXT_10P_PAGES) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    // Wrap manual por línea (sin word-wrap automático de pdf-lib).
    const lines = wrapText(text, WRAP_CHARS);
    let y = MARGIN_Y;
    for (const line of lines) {
      page.drawText(line, {
        x: MARGIN_X,
        y,
        size: FONT_SIZE,
        font,
        color: rgb(0, 0, 0),
      });
      y -= LINE_HEIGHT;
    }
  }

  return doc.save();
}

/**
 * PNG mínimo **con canal alfa**, en bytes literales.
 *
 * El alfa es el punto: `pdf-lib` lo embebe como un **SMask**, y el SMask es
 * uno de los caminos por los que pdf.js pide un canvas auxiliar a su
 * `CanvasFactory`. Ese es exactamente el camino que ningún fixture del repo
 * ejercitaba, y por el que un defecto real —pdf.js tocando `document` dentro
 * de un Worker— convivió con 57 tests de unidad en verde mientras cualquier
 * PDF con imágenes fallaba entero (`roadmap/Post_Hito10.8_Pendientes.md` §21).
 *
 * Literal y no generado: son 8×8 px, y una dependencia nueva para dibujarlo
 * necesitaría ADR (R-12) por un fixture de 100 bytes.
 */
const ALPHA_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAPUlEQVR42mNkYPhfz0AEYBxVSF" +
  "+FjIwMDP+JUcjIyMjwn0iFjIyMDP+JVMjIyMjwn0iFjIyMDP+JVAgAtxwT8g8JYckAAAAASUVO" +
  "RK5CYII=";

/**
 * Fixture con **imagen con transparencia** — el camino que ningún otro
 * fixture toca (ver `ALPHA_PNG_BASE64`).
 *
 * Tres páginas, cada una ejercitando algo distinto del mismo camino:
 *
 * 1. La imagen con alfa sola (SMask).
 * 2. La imagen con alfa **más** texto encima, que es la forma en que aparece
 *    en un documento real (un logo o un sello sobre el que sigue habiendo
 *    contenido).
 * 3. Rectángulos con `opacity` superpuestos, que es el otro camino que pide
 *    canvas auxiliares.
 *
 * El texto de la página 2 lleva una entidad detectable a propósito: sirve
 * para que el fixture valga también como caso de detección sobre una página
 * con imagen, no solo de render.
 */
export async function generateImageAlpha(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(Buffer.from(ALPHA_PNG_BASE64, "base64"));

  const imageOnly = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  imageOnly.drawImage(png, { x: 200, y: 500, width: 180, height: 180 });

  const imageAndText = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  imageAndText.drawImage(png, { x: 60, y: 600, width: 120, height: 120 });
  imageAndText.drawText("Juan Perez, DNI 34.567.891, sobre una pagina con imagen.", {
    x: MARGIN_X,
    y: MARGIN_Y,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });

  const translucent = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  translucent.drawRectangle({
    x: 120,
    y: 400,
    width: 240,
    height: 200,
    color: rgb(0.2, 0.4, 0.9),
    opacity: 0.5,
  });
  translucent.drawRectangle({
    x: 220,
    y: 300,
    width: 240,
    height: 200,
    color: rgb(0.9, 0.3, 0.2),
    opacity: 0.5,
  });

  return doc.save();
}

/**
 * `qa-tables-justified.pdf` — documento de QA manual para el gate de
 * ADR-058 §11 / ADR-086 §4, fila "tablas y texto justificado".
 *
 * **Qué tiene que ejercitar y por qué esa fila existe**: el repintado de línea
 * de ADR-058 corre las palabras vecinas para tapar el hueco que deja un
 * reemplazo más corto que el original. Las dos formas donde eso se nota son
 * las cajas **apretadas** —una celda de tabla, donde no hay espacio en blanco
 * al que correrse— y el **texto justificado**, donde los espacios entre
 * palabras no son uniformes y una costura mal calculada se ve enseguida contra
 * el borde derecho, que está alineado.
 *
 * La justificación se computa acá a mano (`drawJustifiedLine`): pdf-lib no
 * justifica, pero sí mide (`font.widthOfTextAtSize`), así que repartir el
 * sobrante entre los huecos es aritmética. Es exactamente lo que hace un
 * procesador de texto y produce el mismo régimen de espaciado irregular.
 *
 * **Lo que este fixture NO reproduce**, y conviene saberlo antes de leer el
 * resultado del gate: un PDF de procesador de texto real trae `TJ` con
 * kerning por par de glifos, fuentes embebidas subseteadas y, a veces, cada
 * palabra como su propio run. Acá cada línea es un `drawText` por tramo con
 * Helvetica estándar. El gate sobre este documento dice si la costura se ve en
 * régimen justificado y en celdas apretadas; **no** sustituye correr el gate
 * sobre un expediente real el día que haya uno.
 */
export async function generateTablesJustified(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const contentWidth = PAGE_WIDTH - MARGIN_X * 2;

  page.drawText("Informe pericial — anexo de partes intervinientes", {
    x: MARGIN_X,
    y: MARGIN_Y,
    size: 14,
    font: bold,
    color: rgb(0, 0, 0),
  });

  // Párrafo justificado. La última línea NO se justifica (regla tipográfica
  // estándar): estirarla dejaría un renglón con huecos absurdos y no es lo que
  // el gate tiene que mirar.
  const paragraph =
    "Se deja constancia de que Juan Pérez, DNI 34.567.891, con domicilio en Belgrano 1234, " +
    "y María Gómez, DNI 18.445.212, con domicilio en Rivadavia 455, comparecieron ante esta " +
    "pericia y ratificaron el contenido del acta. Se consigna asimismo el CUIT 20-12345678-9 " +
    "de la firma Empresa S.A. a los efectos que pudieren corresponder.";
  const lines = wrapText(paragraph, 78);
  let y = MARGIN_Y - 34;
  for (const [index, line] of lines.entries()) {
    const isLast = index === lines.length - 1;
    drawJustifiedLine(page, line, {
      font,
      size: FONT_SIZE,
      x: MARGIN_X,
      y,
      width: contentWidth,
      justify: !isLast,
    });
    y -= LINE_HEIGHT;
  }

  // Tabla: celdas angostas a propósito. La columna del dato es de 150 pt, así
  // que un `[PERSONA 01]` ya llena la celda y el repintado no tiene margen —
  // que es el caso que esta fila del gate existe para mirar.
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["Actor", "Juan Pérez"],
    ["Documento", "34.567.891"],
    ["Demandada", "Empresa S.A."],
    ["CUIT", "20-12345678-9"],
    ["Perito", "Carlos López"],
    ["Documento", "42.998.103"],
    ["Contacto", "juan.perez@example.com"],
  ];
  const colX = [MARGIN_X, MARGIN_X + 140];
  const colWidth = [140, 150];
  const rowHeight = 22;
  y -= 24;
  const tableTop = y;

  page.drawText("Detalle", { x: MARGIN_X, y: y + 6, size: FONT_SIZE, font: bold });
  y -= rowHeight;

  for (const [label, value] of rows) {
    page.drawText(label, { x: colX[0] ?? 0, y: y + 6, size: FONT_SIZE, font });
    page.drawText(value, { x: colX[1] ?? 0, y: y + 6, size: FONT_SIZE, font });
    page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: MARGIN_X + colWidth[0]! + colWidth[1]!, y },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= rowHeight;
  }

  // Verticales de la grilla: hacen visible el borde de celda, que es contra
  // lo que se juzga si una palabra corrida se salió de su columna.
  for (const x of [MARGIN_X, MARGIN_X + colWidth[0]!, MARGIN_X + colWidth[0]! + colWidth[1]!]) {
    page.drawLine({
      start: { x, y: tableTop },
      end: { x, y: y + rowHeight },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
  }

  return doc.save();
}

/**
 * Dibuja una línea repartiendo el sobrante entre los espacios (justificado
 * real). Con `justify: false` la dibuja tal cual, alineada a la izquierda.
 */
function drawJustifiedLine(
  page: ReturnType<PDFDocument["addPage"]>,
  line: string,
  opts: {
    readonly font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
    readonly size: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly justify: boolean;
  },
): void {
  const { font, size, x, y, width, justify } = opts;
  const words = line.split(" ").filter((w) => w !== "");
  if (words.length === 0) return;
  if (!justify || words.length === 1) {
    page.drawText(line, { x, y, size, font, color: rgb(0, 0, 0) });
    return;
  }
  const wordsWidth = words.reduce((sum, w) => sum + font.widthOfTextAtSize(w, size), 0);
  const gap = (width - wordsWidth) / (words.length - 1);
  let cursor = x;
  for (const word of words) {
    page.drawText(word, { x: cursor, y, size, font, color: rgb(0, 0, 0) });
    cursor += font.widthOfTextAtSize(word, size) + gap;
  }
}

/**
 * `qa-stamp.pdf` — documento de QA manual para el gate de ADR-058 §11 /
 * ADR-086 §4, fila "sello o marca de agua".
 *
 * **Por qué esta fila estuvo bloqueada hasta ahora**: el sello es texto
 * **rotado a 90°**, y hasta ADR-063 el bbox de un run rotado se calculaba solo
 * con la traslación de la matriz, produciendo una caja horizontal donde el
 * texto real es vertical. Correr el gate antes de ese fix habría reproducido
 * un bug ya diagnosticado en vez de decir algo sobre la calidad del
 * repintado. Con ADR-063 implementado, este documento vuelve a ser
 * informativo.
 *
 * Trae las tres formas que aparecen en un expediente real y que el motor trata
 * distinto: **sello vertical** a 90° en el margen (con un dato adentro, para
 * que la detección lo alcance), **marca de agua** diagonal traslúcida sobre el
 * cuerpo, y **folio lateral** a 270°. El cuerpo lleva entidades propias, así
 * que el gate puede comparar una línea repintada bajo la marca de agua contra
 * una que no la tiene.
 *
 * **Lo que NO reproduce**: un sello escaneado es una imagen, no texto — este
 * es texto rotado, que es el caso que ADR-063 arregló y el que el motor puede
 * detectar. Un sello rasterizado no aporta texto y por definición no se
 * anonimiza; el riesgo de solapamiento que ADR-063 §6 dejó anotado (un bbox
 * correcto que tapa lo que hay debajo) sí se puede mirar acá.
 */
export async function generateStamp(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const body = [
    "Expediente caratulado: Pérez, Juan c/ Empresa S.A. s/ daños y perjuicios.",
    "El actor, Juan Pérez, DNI 34.567.891, con domicilio en Belgrano 1234, promueve",
    "demanda contra Empresa S.A., CUIT 20-12345678-9, con sede en Rivadavia 455.",
    "Se designa perito a Carlos López, DNI 42.998.103, quien acepta el cargo.",
    "Notifíquese al correo juan.perez@example.com y al teléfono +54 11 1234-5678.",
  ];
  let y = MARGIN_Y;
  for (const line of body) {
    page.drawText(line, { x: MARGIN_X, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
    y -= LINE_HEIGHT;
  }

  // Marca de agua diagonal traslúcida SOBRE el cuerpo: es la que puede tapar
  // texto si un bbox se calcula de más (ADR-063 §6).
  page.drawText("COPIA FIEL", {
    x: 120,
    y: 380,
    size: 48,
    font: bold,
    color: rgb(0.6, 0.6, 0.6),
    opacity: 0.25,
    rotate: degrees(35),
  });

  // Sello vertical en el margen derecho, a 90°, CON un dato adentro: sin un
  // dato detectable el sello no participa del repintado y la fila del gate no
  // mira nada.
  page.drawText("JUZGADO CIVIL 12 — PERITO CARLOS LOPEZ — DNI 42.998.103", {
    x: PAGE_WIDTH - 40,
    y: 120,
    size: 11,
    font: bold,
    color: rgb(0.15, 0.25, 0.6),
    rotate: degrees(90),
  });

  // Folio lateral a 270°, el otro sentido de rotación: la fórmula de ADR-063
  // §1 tiene que dar la envolvente correcta en los dos.
  page.drawText("Folio 214 — Juan Pérez", {
    x: 30,
    y: 700,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
    rotate: degrees(270),
  });

  return doc.save();
}

// ─────────────────────────────────────────────────────────────────────────
// Dataset de referencia (recall / precision) — tests/fixtures/reference/
//
// Fuente de verdad: README.md, "Dataset de referencia (recall / precision)".
//
// LA INVARIANTE CENTRAL: el PDF y su `truth.json` salen de la MISMA
// estructura en memoria, en la MISMA pasada. `ReferencePageBuilder.entity()`
// es el único punto de entrada para declarar una entidad, y hace las dos
// cosas a la vez — empuja el valor al texto de la página (lo que termina
// dibujado en el PDF) Y lo registra en la lista de entidades (lo que termina
// en el truth) — en la misma llamada. No hay un camino para escribir texto
// en el PDF sin pasar por ahí, y no hay un camino para declarar una entidad
// sin que su valor exacto termine en el texto. `renderReferenceDoc` lee
// `page.text` para dibujar y `page.entities` para el truth del mismo objeto
// `ReferencePageContent`: no son dos fuentes que puedan divergir con el
// tiempo, son la misma.
// ─────────────────────────────────────────────────────────────────────────

/** `detector` del formato de truth.json — solo estos dos valores (README). */
export type ReferenceDetector = "regex" | "ner";

/** Categoría de densidad del documento (README, "Composición inicial"). */
export type ReferenceCategory = "dense" | "sparse" | "trap" | "empty" | "forms";

export interface ReferenceTruthEntity {
  readonly entityType: EntityType;
  readonly value: string;
  readonly pageIndex: number;
  readonly detector: ReferenceDetector;
}

export interface ReferenceTruth {
  readonly documentId: string;
  readonly entities: ReadonlyArray<ReferenceTruthEntity>;
}

export interface ReferenceDocument {
  readonly documentId: string;
  readonly category: ReferenceCategory;
  readonly pdfBytes: Uint8Array;
  readonly truth: ReferenceTruth;
}

export interface ReferenceManifestEntry {
  readonly documentId: string;
  readonly pdf: string;
  readonly truth: string;
  readonly category: ReferenceCategory;
  readonly entityCount: number;
}

export interface ReferenceManifest {
  readonly documents: ReadonlyArray<ReferenceManifestEntry>;
}

interface ReferencePageEntity {
  readonly entityType: EntityType;
  readonly value: string;
  readonly detector: ReferenceDetector;
}

/** Página ya construida: el texto y las entidades vienen del mismo `.build()`. */
export interface ReferencePageContent {
  readonly text: string;
  readonly entities: ReadonlyArray<ReferencePageEntity>;
}

export interface ReferenceDocSpec {
  readonly documentId: string;
  readonly category: ReferenceCategory;
  readonly pages: ReadonlyArray<ReferencePageContent>;
}

/**
 * Junta `parts` en una sola oración, sin espacio antes de puntuación de
 * cierre (`, . ; : )`) ni después de un paréntesis de apertura. Cosmético
 * para que el PDF no muestre "Juan Pérez , con domicilio" — no afecta la
 * invariante (el valor de la entidad sigue siendo exactamente el que se
 * pasó a `.entity()`).
 */
function joinReferenceParts(parts: ReadonlyArray<string>): string {
  let out = "";
  for (const part of parts) {
    if (out.length === 0) {
      out = part;
      continue;
    }
    const noSpaceBefore = /^[,.;:)]/.test(part);
    const noSpaceAfter = out.endsWith("(");
    out += noSpaceBefore || noSpaceAfter ? part : ` ${part}`;
  }
  return out;
}

/**
 * Único punto de entrada para construir una página del dataset de
 * referencia. `entity()` es la mitad de la invariante: empuja `value` al
 * texto Y lo registra como entidad esperada, en la misma llamada.
 */
class ReferencePageBuilder {
  private readonly parts: string[] = [];
  private readonly entities: ReferencePageEntity[] = [];

  text(value: string): this {
    this.parts.push(value);
    return this;
  }

  entity(value: string, entityType: EntityType, detector: ReferenceDetector): this {
    this.parts.push(value);
    this.entities.push({ entityType, value, detector });
    return this;
  }

  build(): ReferencePageContent {
    return { text: joinReferenceParts(this.parts), entities: [...this.entities] };
  }
}

function page(build: (builder: ReferencePageBuilder) => void): ReferencePageContent {
  const builder = new ReferencePageBuilder();
  build(builder);
  return builder.build();
}

/** Semilla fija: el dataset de referencia es reproducible entre corridas. */
const REFERENCE_DATASET_SEED = "reference-dataset-v1";

/**
 * Sortea un valor sintético para `type` vía `synthesize()` (shared/synthesizer.ts).
 * `groupId` incluye el `documentId` y `indexInType` para que cada entidad de
 * cada documento tenga su propia semilla derivada — dos documentos, o dos
 * entidades del mismo tipo dentro de uno, nunca colisionan.
 */
function synth(documentId: string, type: EntityType, indexInType: number): string {
  return synthesize({
    type,
    groupId: `${documentId}-${type}-${indexInType}`,
    seed: REFERENCE_DATASET_SEED,
    indexInType,
  });
}

/**
 * `synth(..., EntityType.Phone, ...)` sortea el código de área de una lista
 * con entradas de 2 y 3 dígitos (`synthesizer.ts`: "11" | "221" | "341" |
 * "351" | "343" | "380"). El patrón real `phone-mobile-ar`
 * (`(?:\+?54)?[\s-]?\b\d{2}[\s-]?\d{4}[\s-]?\d{4}\b`, `default-ar.ts`) exige
 * EXACTAMENTE 2 dígitos ahí — verificado: con área de 3 dígitos el patrón no
 * matchea nada. Para que este dataset tenga un "camino positivo" de Phone
 * que el motor real efectivamente encuentre, se fuerza el área "11" (la
 * misma que ya usa `text-10p.pdf`) y se reusan los dígitos que sorteó
 * `synth()` para el resto del número.
 */
function syntheticMobilePhone(documentId: string, indexInType: number): string {
  const raw = synth(documentId, EntityType.Phone, indexInType);
  const digits = raw.replace(/\D/g, "").slice(-8).padStart(8, "0");
  return `+54 11 ${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
}

/**
 * ISO 13616 / mod-97-10: dígitos verificadores válidos para `bban` bajo
 * `countryCode`. Mismo algoritmo estándar que `computeIbanChecksum` de
 * `regex-engine/patterns/default-ar.ts` implementa para VALIDAR — acá se usa
 * en la dirección inversa, para CONSTRUIR un valor que ya cierre. No importa
 * nada de `regex-engine` (P-2): es aritmética de un estándar público, cada
 * lado la implementa por su cuenta, igual que `synthesizer.ts` ya implementa
 * su propio Luhn y su propio módulo 11 de CUIT sin importar `regex-engine`.
 */
function ibanCheckDigits(countryCode: string, bban: string): string {
  const rearranged = `${bban}${countryCode}00`;
  let numeric = "";
  for (const ch of rearranged) {
    numeric += ch >= "0" && ch <= "9" ? ch : (ch.charCodeAt(0) - 55).toString();
  }
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  const check = 98 - remainder;
  return check.toString().padStart(2, "0");
}

/**
 * `synth(..., EntityType.IBAN, ...)` separa los grupos con espacios (formato
 * de lectura humana, igual que el IBAN de `text-10p.pdf`). El patrón real
 * `iban` (`\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b`) NO admite espacios internos —
 * verificado corriendo el regex exacto contra el valor con espacios: cero
 * matches, ni para aceptar ni para rechazar por checksum. Es un hallazgo
 * (ver reporte final): el IBAN de `text-10p.pdf` está documentado como
 * "rechazado por checksum" y en realidad el patrón no llega a matchearlo.
 * Para que este dataset tenga un "camino positivo" de IBAN que el motor real
 * pueda encontrar, se recalcula el dígito verificador (`ibanCheckDigits`)
 * sobre los mismos dígitos que sorteó `synth()` y se arma SIN espacios.
 */
function syntheticValidIban(documentId: string, indexInType: number): string {
  const raw = synth(documentId, EntityType.IBAN, indexInType).replace(/\s+/g, "");
  const country = raw.slice(0, 2);
  const bban = raw.slice(4);
  const check = ibanCheckDigits(country, bban);
  return `${country}${check}${bban}`;
}

/**
 * `synth(..., EntityType.License, ...)` produce un valor puramente numérico
 * ("XX-XXXX-XX", comentario propio de `synthesizer.ts`: "máscara de
 * ADR-012"). El patrón real `license-ar` (`\b[A-Z]{1,3}-?\d{4,8}-?\d?\b`)
 * exige 1 a 3 LETRAS mayúsculas al principio — obligatorias, no hay forma de
 * que un valor sin letras matchee. Es el segundo hallazgo de este PR (ver
 * reporte final). Se arma un valor con la forma real del patrón —mismo
 * prefijo que el `"MP-12345"` que ADR-075 §2 ya usa como ejemplo de
 * `License` en sus propios tests— reusando los dígitos que sorteó `synth()`.
 */
const LICENSE_PREFIXES: ReadonlyArray<string> = ["MP", "CPN", "MN"];

function syntheticLicense(documentId: string, indexInType: number): string {
  const digits = synth(documentId, EntityType.License, indexInType).replace(/\D/g, "");
  const prefix = LICENSE_PREFIXES[indexInType % LICENSE_PREFIXES.length] ?? "MP";
  return `${prefix}-${digits.slice(0, 5)}`;
}

/** "Juan Pérez" → { firstName: "Juan", lastName: "Pérez" }. */
function splitFullName(fullName: string): { readonly firstName: string; readonly lastName: string } {
  const parts = fullName.split(" ");
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  if (firstName === undefined || firstName.length === 0 || lastName.length === 0) {
    throw new Error(`splitFullName: nombre sintético con forma inesperada: "${fullName}"`);
  }
  return { firstName, lastName };
}

/**
 * Agrega la oración de una entidad de tipo "documental" (detectable por
 * regex o NER, según el tipo — README, tabla de `text-10p.pdf`) a `builder`.
 * Cada `case` sortea su valor y lo pasa a `.entity()`: no hay valor que se
 * dibuje sin pasar también a la lista de entidades esperadas.
 */
function appendEntitySentence(
  builder: ReferencePageBuilder,
  documentId: string,
  type: EntityType,
  seedIndex: number,
): void {
  switch (type) {
    case EntityType.Person: {
      const name = synth(documentId, type, seedIndex);
      builder.text("Comparece").entity(name, type, "ner").text("ante esta instancia.");
      return;
    }
    case EntityType.Organization: {
      const org = synth(documentId, type, seedIndex);
      builder.text("en representación de").entity(org, type, "ner").text(".");
      return;
    }
    case EntityType.Address: {
      const address = synth(documentId, type, seedIndex);
      builder.text("con domicilio en").entity(address, type, "ner").text(".");
      return;
    }
    case EntityType.DNI: {
      const dni = synth(documentId, type, seedIndex);
      builder.text("DNI").entity(dni, type, "regex").text(".");
      return;
    }
    case EntityType.CUIT: {
      const cuit = synth(documentId, type, seedIndex);
      builder.text("CUIT").entity(cuit, type, "regex").text(".");
      return;
    }
    case EntityType.Phone: {
      const phone = syntheticMobilePhone(documentId, seedIndex);
      builder.text("Teléfono de contacto").entity(phone, type, "regex").text(".");
      return;
    }
    case EntityType.Email: {
      const email = synth(documentId, type, seedIndex);
      builder.text("correo electrónico").entity(email, type, "regex").text(".");
      return;
    }
    case EntityType.IBAN: {
      const iban = syntheticValidIban(documentId, seedIndex);
      builder.text("con cuenta IBAN").entity(iban, type, "regex").text(".");
      return;
    }
    case EntityType.CreditCard: {
      const card = synth(documentId, type, seedIndex);
      builder.text("abonado con tarjeta").entity(card, type, "regex").text(".");
      return;
    }
    case EntityType.Date: {
      const date = synth(documentId, type, seedIndex);
      builder.text("con fecha").entity(date, type, "regex").text(".");
      return;
    }
    case EntityType.License: {
      const license = syntheticLicense(documentId, seedIndex);
      builder.text("matrícula profesional").entity(license, type, "regex").text(".");
      return;
    }
    case EntityType.Plate: {
      const plate = synth(documentId, type, seedIndex);
      builder.text("con la patente").entity(plate, type, "regex").text(".");
      return;
    }
    default:
      throw new Error(
        `appendEntitySentence: tipo no soportado en el dataset de referencia: ${type as string}`,
      );
  }
}

/**
 * Agrega la carátula judicial "Apellido, Nombre" (ADR-092): un Person
 * detectado por REGEX, no por NER. Sortea un nombre completo con
 * `synth(..., EntityType.Person, ...)` y lo invierte — mismo mecanismo que
 * `flipCaption` en `default-ar.ts`, pero en la dirección de construir el
 * texto de entrada en vez de normalizarlo.
 */
function appendCaratulaSentence(
  builder: ReferencePageBuilder,
  documentId: string,
  seedIndex: number,
): void {
  const { firstName, lastName } = splitFullName(synth(documentId, EntityType.Person, seedIndex));
  const caratula = `${lastName}, ${firstName}`;
  builder.text("Expediente caratulado:").entity(caratula, EntityType.Person, "regex").text("c/ Estado s/ actuación.");
}

/**
 * Documentos "densos": varias entidades por página, cubriendo los doce tipos
 * de `EntityType` (menos `Custom`, que no tiene forma detectable) y las dos
 * variantes de `Person` (NER en orden normal, regex vía la carátula).
 *
 * doc-004 y doc-006 repiten el mismo `seedIndex` de Person para la carátula
 * y para la mención en el cuerpo A PROPÓSITO: es el escenario exacto que
 * ADR-092 §2 usa como ejemplo ("Pérez, Juan" en el encabezado + "Juan Pérez"
 * en el cuerpo, agrupados por el mismo `normalizedValue"), y vale la pena
 * que el dataset de referencia lo cubra.
 */
function buildDenseDocs(): ReadonlyArray<ReferenceDocSpec> {
  return [
    {
      documentId: "doc-001",
      category: "dense",
      pages: [
        page((b) => {
          appendEntitySentence(b, "doc-001", EntityType.Person, 0);
          appendEntitySentence(b, "doc-001", EntityType.Address, 0);
          appendEntitySentence(b, "doc-001", EntityType.DNI, 0);
        }),
        page((b) => {
          appendEntitySentence(b, "doc-001", EntityType.CUIT, 0);
          appendEntitySentence(b, "doc-001", EntityType.Phone, 0);
          appendEntitySentence(b, "doc-001", EntityType.Email, 0);
        }),
      ],
    },
    {
      documentId: "doc-002",
      category: "dense",
      pages: [
        page((b) => {
          appendEntitySentence(b, "doc-002", EntityType.Organization, 0);
          appendEntitySentence(b, "doc-002", EntityType.DNI, 0);
          appendEntitySentence(b, "doc-002", EntityType.IBAN, 0);
        }),
        page((b) => {
          appendEntitySentence(b, "doc-002", EntityType.CreditCard, 0);
          appendEntitySentence(b, "doc-002", EntityType.Date, 0);
          appendEntitySentence(b, "doc-002", EntityType.License, 0);
        }),
      ],
    },
    {
      documentId: "doc-003",
      category: "dense",
      pages: [
        page((b) => {
          appendEntitySentence(b, "doc-003", EntityType.Person, 0);
          appendEntitySentence(b, "doc-003", EntityType.Organization, 0);
          appendEntitySentence(b, "doc-003", EntityType.Address, 0);
        }),
        page((b) => {
          appendEntitySentence(b, "doc-003", EntityType.Plate, 0);
          appendEntitySentence(b, "doc-003", EntityType.Phone, 0);
          appendEntitySentence(b, "doc-003", EntityType.Email, 0);
        }),
      ],
    },
    {
      documentId: "doc-004",
      category: "dense",
      pages: [
        page((b) => {
          appendCaratulaSentence(b, "doc-004", 0);
          appendEntitySentence(b, "doc-004", EntityType.DNI, 0);
          appendEntitySentence(b, "doc-004", EntityType.CUIT, 0);
        }),
        page((b) => {
          // Mismo seedIndex 0 que la carátula de arriba: es la misma persona
          // mencionada dos veces, en dos formas (ADR-092 §2).
          appendEntitySentence(b, "doc-004", EntityType.Person, 0);
          appendEntitySentence(b, "doc-004", EntityType.Date, 0);
          appendEntitySentence(b, "doc-004", EntityType.Organization, 0);
        }),
      ],
    },
    {
      documentId: "doc-005",
      category: "dense",
      pages: [
        page((b) => {
          appendEntitySentence(b, "doc-005", EntityType.DNI, 0);
          appendEntitySentence(b, "doc-005", EntityType.CUIT, 0);
          appendEntitySentence(b, "doc-005", EntityType.Phone, 0);
          appendEntitySentence(b, "doc-005", EntityType.Email, 0);
        }),
        page((b) => {
          appendEntitySentence(b, "doc-005", EntityType.IBAN, 0);
          appendEntitySentence(b, "doc-005", EntityType.CreditCard, 0);
          appendEntitySentence(b, "doc-005", EntityType.Date, 0);
          appendEntitySentence(b, "doc-005", EntityType.License, 0);
          appendEntitySentence(b, "doc-005", EntityType.Plate, 0);
        }),
      ],
    },
    {
      documentId: "doc-006",
      category: "dense",
      pages: [
        page((b) => {
          appendEntitySentence(b, "doc-006", EntityType.Person, 0);
          appendCaratulaSentence(b, "doc-006", 0); // misma persona (ADR-092 §2)
          appendEntitySentence(b, "doc-006", EntityType.Organization, 0);
        }),
        page((b) => {
          appendEntitySentence(b, "doc-006", EntityType.Address, 0);
          appendEntitySentence(b, "doc-006", EntityType.DNI, 0);
          appendEntitySentence(b, "doc-006", EntityType.Phone, 0);
        }),
      ],
    },
  ];
}

/**
 * Documentos "ralos": 1-2 entidades en total, sobre texto neutro alrededor.
 */
function buildSparseDocs(): ReadonlyArray<ReferenceDocSpec> {
  return [
    {
      documentId: "doc-007",
      category: "sparse",
      pages: [
        page((b) => {
          b.text("Se adjunta copia del comprobante de identidad.");
          appendEntitySentence(b, "doc-007", EntityType.DNI, 0);
          b.text("Sin otras observaciones que agregar al expediente.");
        }),
      ],
    },
    {
      documentId: "doc-008",
      category: "sparse",
      pages: [
        page((b) => {
          b.text("Se deja constancia de la presencia del interesado.");
          appendEntitySentence(b, "doc-008", EntityType.Person, 0);
          b.text("El resto del acta continúa sin novedades que consignar.");
        }),
      ],
    },
    {
      documentId: "doc-009",
      category: "sparse",
      pages: [
        page((b) => {
          b.text("Ante cualquier consulta sobre el trámite, escribir a");
          appendEntitySentence(b, "doc-009", EntityType.Email, 0);
          b.text("o comunicarse al");
          appendEntitySentence(b, "doc-009", EntityType.Phone, 0);
        }),
      ],
    },
    {
      documentId: "doc-010",
      category: "sparse",
      pages: [
        page((b) => {
          b.text("El presente escrito se presenta");
          appendEntitySentence(b, "doc-010", EntityType.Organization, 0);
          b.text("y no contiene otra referencia identificatoria.");
        }),
      ],
    },
    {
      documentId: "doc-011",
      category: "sparse",
      pages: [
        page((b) => {
          b.text("La notificación se cursó");
          appendEntitySentence(b, "doc-011", EntityType.Address, 0);
          b.text("y quedó registrada");
          appendEntitySentence(b, "doc-011", EntityType.Date, 0);
        }),
      ],
    },
    {
      documentId: "doc-012",
      category: "sparse",
      pages: [
        page((b) => {
          appendCaratulaSentence(b, "doc-012", 0);
          b.text("El resto del folio no contiene otras menciones identificatorias.");
        }),
      ],
    },
  ];
}

/**
 * Documentos "trampa": cero entidades reales, pero texto que un detector
 * ingenuo podría confundir con una. Mínimo exigido por el README/tarea:
 * número de expediente, código postal, fecha fuera de rango, CUIT/IBAN/
 * tarjeta con dígito verificador inválido, y topónimos con coma (la trampa
 * del patrón `caratula-ar` de ADR-092).
 *
 * Los valores de CUIT/IBAN/tarjeta inválidos son EXACTAMENTE los literales
 * ya documentados y verificados en `text-10p.pdf`/README ("Contenido
 * conocido de text-10p.pdf", corregido 2026-08-18): reusarlos evita
 * recalcular un checksum roto a mano y respetar que "cambiar los de ese
 * fixture rompería los tests que hoy dependen del rechazo" no aplica acá —
 * es un valor nuevo, en un documento nuevo, con el mismo texto.
 */
function buildTrapDocs(): ReadonlyArray<ReferenceDocSpec> {
  return [
    {
      documentId: "doc-013",
      category: "trap",
      pages: [
        page((b) => {
          b.text(
            "En el expediente PP-13-00-027653-24/00 se solicita el traslado de las " +
              "actuaciones. La audiencia se fijó en la oficina de Mar del Plata, Buenos " +
              "Aires, a la espera de nueva notificación.",
          );
        }),
      ],
    },
    {
      documentId: "doc-014",
      category: "trap",
      pages: [
        page((b) => {
          b.text(
            "La correspondencia debe remitirse al código postal C1425AAB. La delegación " +
              "de San Miguel, Tucumán, informó que el trámite continúa en su sede local.",
          );
        }),
      ],
    },
    {
      documentId: "doc-015",
      category: "trap",
      pages: [
        page((b) => {
          b.text(
            "El escrito quedó fechado el 45 de julio de 2026, error material que consta " +
              "en el original. Se cita, conforme al Código Civil, Título III, la normativa " +
              "aplicable al caso.",
          );
        }),
      ],
    },
    {
      documentId: "doc-016",
      category: "trap",
      pages: [
        page((b) => {
          b.text(
            "Se consignó el CUIT 20-12345678-9 en un formulario anterior, con un dígito " +
              "verificador que no cierra. La cuenta bancaria informada, IBAN ES00 1234 " +
              "5678 9012 3456 7890, tampoco resulta válida.",
          );
        }),
      ],
    },
    {
      documentId: "doc-017",
      category: "trap",
      pages: [
        page((b) => {
          b.text(
            "El pago con tarjeta 4532 1234 5678 9901 fue rechazado por el emisor. El " +
              "expediente conexo IPP-08-00-045210-25/00 quedó radicado en La Plata, " +
              "Buenos Aires, a la espera de acumulación.",
          );
        }),
      ],
    },
  ];
}

/**
 * Documentos "vacíos": cero entidades, sin siquiera texto trampa — prosa
 * neutra, para medir el piso de falsos positivos.
 */
function buildEmptyDocs(): ReadonlyArray<ReferenceDocSpec> {
  return [
    {
      documentId: "doc-018",
      category: "empty",
      pages: [
        page((b) => {
          b.text(
            "El presente documento no contiene información sensible. Su único propósito " +
              "es servir de referencia para medir falsos positivos en el pipeline de " +
              "detección. El texto continúa sin mencionar personas, organismos ni " +
              "identificadores de ningún tipo.",
          );
        }),
      ],
    },
    {
      documentId: "doc-019",
      category: "empty",
      pages: [
        page((b) => {
          b.text(
            "Este anexo describe el procedimiento general de tramitación sin hacer " +
              "referencia a ningún caso concreto. No se citan partes, domicilios ni " +
              "datos de contacto de ninguna clase en ningún párrafo de este anexo.",
          );
        }),
      ],
    },
    {
      documentId: "doc-020",
      category: "empty",
      pages: [
        page((b) => {
          b.text(
            "Las siguientes páginas quedan reservadas para observaciones futuras. Al " +
              "momento de esta versión no hay contenido adicional que consignar, y no se " +
              "incluye ningún dato identificatorio.",
          );
        }),
      ],
    },
  ];
}

/**
 * Exportada para tests: permite verificar, sin pasar por pdf-lib (async, I/O
 * en memoria), que cada `page.text` contiene el `value` de cada entidad que
 * `page.entities` declara — la mitad estática de la invariante de esta
 * sección.
 */
/* ─── Cobertura de formas (categoría "forms") ─────────────────────────────
 *
 * Un documento por tipo de entidad, con **todas las formas en que ese dato
 * aparece escrito en un expediente**, esté o no soportada hoy por el motor.
 *
 * Es la mitad del dataset que lo convierte de detector de regresiones en
 * buscador de baches. Las otras categorías se construyeron mirando qué
 * encuentra el motor, y por eso dan 100 %: un dataset así no puede mostrar
 * progreso, solo pérdida. Estos documentos se construyen al revés — desde
 * cómo se escribe el dato— y por eso **se espera que bajen el recall**.
 *
 * **La regla que los gobierna**: cuando la verdad y el motor no coinciden,
 * el que está mal es el motor. Ajustar el valor para que el patrón lo tome
 * convierte al dataset en un espejo del detector, que es exactamente lo que
 * estos documentos vienen a evitar. Solo es legítimo corregir el valor
 * cuando el fixture estaba generando algo que **no es** la entidad que
 * declara — el caso de la matrícula `12-3456-78`, que no es una matrícula.
 *
 * **El `value` del truth es el identificador, no la etiqueta que lo
 * precede.** "Matrícula Profesional 12345" declara `12345`: la palabra
 * "Matrícula" no es un dato personal y taparla sería el mismo error de
 * sobre-captura que ADR-092 tuvo que acotar en la carátula.
 *
 * Formas verificadas contra los patrones reales el 2026-08-26. Las que hoy
 * NO se detectan van igual y a propósito.
 */

/** Teléfonos: la característica argentina va de 2 a 4 dígitos (ADR-093). */
function formsPhone(): ReferenceDocSpec {
  return {
    documentId: "doc-021",
    category: "forms",
    pages: [
      page((b) => {
        b.text("Teléfonos declarados en el expediente:");
        b.text("Buenos Aires").entity("+54 11 4567-8900", EntityType.Phone, "regex").text(";");
        b.text("La Plata").entity("+54 221 456-7890", EntityType.Phone, "regex").text(";");
        b.text("Rosario").entity("+54 341 456-7890", EntityType.Phone, "regex").text(";");
        b.text("Santa Rosa").entity("+54 2954 12-3456", EntityType.Phone, "regex").text(";");
        b.text("móvil").entity("+54 9 11 4567-8901", EntityType.Phone, "regex").text(";");
        b.text("nacional").entity("011 4567-8902", EntityType.Phone, "regex").text(";");
        b.text("sin país").entity("11 4567 8903", EntityType.Phone, "regex").text(".");
      }),
    ],
  };
}

/**
 * IBAN: ISO 13616 recomienda imprimirlo en grupos de cuatro separados por
 * espacios, que es como aparece en un documento — y la forma que el patrón
 * actual NO toma.
 */
function formsIban(): ReferenceDocSpec {
  return {
    documentId: "doc-022",
    category: "forms",
    pages: [
      page((b) => {
        b.text("Datos bancarios. Cuenta");
        b.entity("ES05 7068 9876 9644 6251 9569", EntityType.IBAN, "regex").text(",");
        b.text("cuenta secundaria");
        b.entity("ES9121000418450200051332", EntityType.IBAN, "regex").text(".");
      }),
    ],
  };
}

/**
 * Patentes: vieja (3+3), Mercosur auto (2+3+2) y Mercosur moto
 * (1 letra + 3 dígitos + 3 letras), cada una pegada, con espacios y con
 * guiones — el guión no está en la chapa, está en cómo se transcribe.
 */
function formsPlate(): ReferenceDocSpec {
  return {
    documentId: "doc-023",
    category: "forms",
    pages: [
      page((b) => {
        b.text("Vehículos intervinientes. Dominio");
        b.entity("ABC 123", EntityType.Plate, "regex").text(",");
        b.entity("ABC-123", EntityType.Plate, "regex").text(",");
        b.entity("AB 123 CD", EntityType.Plate, "regex").text(",");
        b.entity("AB-123-CD", EntityType.Plate, "regex").text(".");
        b.text("Motovehículo dominio");
        b.entity("A 123 BCD", EntityType.Plate, "regex").text("y");
        b.entity("A456EFG", EntityType.Plate, "regex").text(".");
      }),
    ],
  };
}

/**
 * Matrículas profesionales. `MN` es Matrícula Nacional y `MP` Provincial;
 * el punto como separador de miles es tipografía argentina normal.
 *
 * **Quedan afuera a propósito** dos formas que el humano aportó y que no se
 * pudieron confirmar contra un documento real: `MPBA 5563` y
 * `M. Prov. 1601`. Meterlas sin confirmar haría que la métrica diga que el
 * motor falla en algo que quizá no existe — y el valor de este dataset es
 * que el número sea confiable. Se agregan el día que aparezca el documento.
 */
function formsLicense(): ReferenceDocSpec {
  return {
    documentId: "doc-024",
    category: "forms",
    pages: [
      page((b) => {
        b.text("Profesionales actuantes.");
        b.text("Perito médico").entity("MN 12345", EntityType.License, "regex").text(";");
        b.text("perito de parte").entity("MP 23456", EntityType.License, "regex").text(";");
        b.text("consultor").entity("MN 45.318", EntityType.License, "regex").text(";");
        b.text("auxiliar").entity("MP 9.328", EntityType.License, "regex").text(";");
        b.text("traductora").entity("M.P. 34567", EntityType.License, "regex").text(";");
        b.text("calígrafo").entity("M.N. 56789", EntityType.License, "regex").text(".");
      }),
      // El número pelado tras la etiqueta va en su propia página: el `value`
      // es el identificador y no la etiqueta, así que conviene que ningún
      // otro valor de la página lo contenga por casualidad.
      page((b) => {
        b.text("Matrícula Profesional").entity("40097", EntityType.License, "regex").text(".");
        b.text("Matrícula profesional:").entity("MP 61852", EntityType.License, "regex").text(".");
      }),
    ],
  };
}

/** DNI y fechas: con y sin separadores, y la fecha escrita en texto (ADR-075 §1). */
function formsDniAndDate(): ReferenceDocSpec {
  return {
    documentId: "doc-025",
    category: "forms",
    pages: [
      page((b) => {
        b.text("Documento").entity("34.567.891", EntityType.DNI, "regex").text(",");
        b.text("documento").entity("18445212", EntityType.DNI, "regex").text(".");
        b.text("Fecha de la pericia").entity("07/07/2026", EntityType.Date, "regex").text(",");
        b.text("ratificada el").entity("8-7-2026", EntityType.Date, "regex").text(",");
        b.text("y notificada el").entity("09 de julio de 2026", EntityType.Date, "regex").text(".");
      }),
    ],
  };
}

/*
 * Cláusula jurídica deliberadamente densa en tokens y **vacía de entidades**.
 *
 * El truncamiento que este documento reproduce solo aparece con una razón
 * tokens/palabra alta, y lo que la sube son los dígitos. Pero rellenar con
 * DNI/CUIT/teléfonos metería decenas de entidades de Regex y movería la
 * precisión del dataset entero por un motivo que no tiene nada que ver con
 * lo que se quiere medir.
 *
 * Medido con el tokenizer real del modelo: 17 palabras → 43 tokens, razón
 * **2,53** — la misma densidad que un bloque de identificadores puros, y sin
 * que ningún patrón de `default-ar.ts` matchee nada.
 */
const TOKEN_DENSE_CLAUSE =
  "Considerando lo peticionado corresponde desestimar in limine la excepcion " +
  "de incompetencia articulada atento la inconstitucionalidad sobreviniente invocada";

/**
 * `doc-026` — el lote de NER se corta en **palabras** y el modelo trunca en
 * **tokens**.
 *
 * `computeWordChunks` corta cada lote en `batchSize` palabras (256 por
 * default) pero el modelo trunca en 512 tokens (`model_max_length`), y
 * `truncation: true` descarta la cola **sin error, warning ni log**. Con
 * texto denso la cola cae adentro del primer lote y esas entidades no las ve
 * nadie.
 *
 * Las posiciones no son al voleo: medido con el tokenizer real, a razón 2,53
 * los 512 tokens caen alrededor de la palabra **202**. `Marcelo Duarte` va al
 * principio como control —tiene que aparecer siempre— y las dos entidades
 * del final quedan pasada esa marca, que es donde el truncamiento las come.
 *
 * **Las tres son `Person` a propósito.** La primera versión ponía un
 * domicilio (`Rivadavia 4820`) al final y nunca llegaba a cubrirse ni con el
 * truncamiento arreglado: verificado con el modelo real, sobre ese texto
 * devuelve `LOC:Rivadavia` **sin el número**. Es una limitación conocida del
 * modelo —el dataset ya la registra en otros cuatro documentos— y mezclarla
 * acá volvía ilegible el antes/después: no se podía saber si una entidad
 * faltaba por el truncamiento o por eso. Este documento mide **una sola
 * cosa**.
 *
 * El documento entero mide menos de 256 palabras a propósito: así es **un
 * solo lote** y el fallo no se puede confundir con un problema de reparto
 * entre lotes.
 */
function tokenBudgetOverflow(): ReferenceDocSpec {
  return {
    documentId: "doc-026",
    category: "dense",
    pages: [
      page((b) => {
        b.text("Autos y vistos. Interviene en autos el letrado")
          .entity("Marcelo Duarte", EntityType.Person, "ner")
          .text(", conforme surge de la causa.");
        for (let i = 0; i < 12; i += 1) b.text(TOKEN_DENSE_CLAUSE);
        b.text("Finalmente se cita a")
          .entity("Rosana Ferreyra", EntityType.Person, "ner")
          .text("y a")
          .entity("Damián Sosa", EntityType.Person, "ner")
          .text(", ambos en calidad de testigos.");
      }),
    ],
  };
}

function buildFormCoverageDocs(): ReadonlyArray<ReferenceDocSpec> {
  return [formsPhone(), formsIban(), formsPlate(), formsLicense(), formsDniAndDate()];
}

export function buildReferenceDocSpecs(): ReadonlyArray<ReferenceDocSpec> {
  return [
    ...buildDenseDocs(),
    ...buildSparseDocs(),
    ...buildTrapDocs(),
    ...buildEmptyDocs(),
    ...buildFormCoverageDocs(),
    tokenBudgetOverflow(),
  ];
}

/**
 * Dibuja `spec` como PDF y deriva su `truth` — del mismo objeto, en la misma
 * pasada (ver el comentario de cabecera de esta sección). `page.text` es lo
 * único que se dibuja; `page.entities` es lo único de lo que sale el truth.
 */
async function renderReferenceDoc(
  spec: ReferenceDocSpec,
): Promise<{ readonly pdfBytes: Uint8Array; readonly truth: ReferenceTruth }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const entities: ReferenceTruthEntity[] = [];

  spec.pages.forEach((pageContent, pageIndex) => {
    const pdfPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const lines = wrapText(pageContent.text, WRAP_CHARS);
    let y = MARGIN_Y;
    for (const line of lines) {
      pdfPage.drawText(line, { x: MARGIN_X, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
      y -= LINE_HEIGHT;
    }
    for (const entity of pageContent.entities) {
      entities.push({
        entityType: entity.entityType,
        value: entity.value,
        pageIndex,
        detector: entity.detector,
      });
    }
  });

  const pdfBytes = await doc.save();
  return { pdfBytes, truth: { documentId: spec.documentId, entities } };
}

/**
 * Genera el dataset de referencia completo: ~20 PDFs sintéticos con su
 * ground truth, desde `buildReferenceDocSpecs()`. Exportada para
 * `pnpm fixtures:generate` (vía `main()`) y para `generate.test.ts`.
 */
export async function generateReferenceDataset(): Promise<ReadonlyArray<ReferenceDocument>> {
  const specs = buildReferenceDocSpecs();
  const documents: ReferenceDocument[] = [];
  for (const spec of specs) {
    const { pdfBytes, truth } = await renderReferenceDoc(spec);
    documents.push({ documentId: spec.documentId, category: spec.category, pdfBytes, truth });
  }
  return documents;
}

/** Índice documento → ground truth (README: "manifest.json"). */
export function buildReferenceManifest(documents: ReadonlyArray<ReferenceDocument>): ReferenceManifest {
  return {
    documents: documents.map((d) => ({
      documentId: d.documentId,
      pdf: `${d.documentId}.pdf`,
      truth: `${d.documentId}.truth.json`,
      category: d.category,
      entityCount: d.truth.entities.length,
    })),
  };
}

export async function generateEmpty(): Promise<Uint8Array> {
  // "empty.pdf" = PDF con 1 página sin contenido (sin texto dibujado, sin
  // /Contents). pdf-lib no permite generar PDFs con 0 páginas (doc.save()
  // falla), así que el nombre es histórico: representa una página "vacía"
  // desde el punto de vista del extractor de texto. El PDF Engine (Hito 2)
  // detectará esta página como textlessPages-compatible.
  const doc = await PDFDocument.create();
  doc.addPage();
  return doc.save();
}

export async function generateCorrupt(): Promise<Uint8Array> {
  // Header "%PDF-1.4\n" válido + cuerpo no-PDF determinista (200 bytes de 0x41).
  // Suficiente para que PDF.js detecte header pero falle al parsear.
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const body = new Uint8Array(200).fill(0x41);
  const result = new Uint8Array(header.length + body.length);
  result.set(header, 0);
  result.set(body, header.length);
  return result;
}

/**
 * Wrap manual: corta el texto en líneas de ~95 chars respetando espacios.
 * Suficiente para fixtures deterministas; no es un word-wrap real.
 *
 * Exportado por el mismo motivo que las constantes de layout de arriba.
 */
export function wrapText(text: string, maxCharsPerLine: number): ReadonlyArray<string> {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

async function main(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });

  const text10p = await generateText10p();
  await writeFile(resolve(FIXTURE_DIR, "text-10p.pdf"), text10p);

  const empty = await generateEmpty();
  await writeFile(resolve(FIXTURE_DIR, "empty.pdf"), empty);

  const imageAlpha = await generateImageAlpha();
  await writeFile(resolve(FIXTURE_DIR, "image-alpha-3p.pdf"), imageAlpha);

  const corrupt = await generateCorrupt();
  await writeFile(resolve(FIXTURE_DIR, "corrupt.pdf"), corrupt);

  // Documentos del gate manual de ADR-058 §11 / ADR-086 §4. No los consume
  // ninguna suite: existen para poder correr a mano un gate que ninguna suite
  // headless puede juzgar ("las líneas repintadas no se distinguen de las que
  // no se tocaron a tamaño de lectura").
  const tablesJustified = await generateTablesJustified();
  await writeFile(resolve(FIXTURE_DIR, "qa-tables-justified.pdf"), tablesJustified);

  const stamp = await generateStamp();
  await writeFile(resolve(FIXTURE_DIR, "qa-stamp.pdf"), stamp);

  // Dataset de referencia (recall / precision) — README.md, "Dataset de
  // referencia". ~20 PDFs sintéticos + su ground truth, en tests/fixtures/reference/.
  const REFERENCE_DIR = resolve(FIXTURE_DIR, "reference");
  await mkdir(REFERENCE_DIR, { recursive: true });
  const referenceDocs = await generateReferenceDataset();
  for (const doc of referenceDocs) {
    await writeFile(resolve(REFERENCE_DIR, `${doc.documentId}.pdf`), doc.pdfBytes);
    await writeFile(
      resolve(REFERENCE_DIR, `${doc.documentId}.truth.json`),
      `${JSON.stringify(doc.truth, null, 2)}\n`,
    );
  }
  const referenceManifest = buildReferenceManifest(referenceDocs);
  await writeFile(
    resolve(REFERENCE_DIR, "manifest.json"),
    `${JSON.stringify(referenceManifest, null, 2)}\n`,
  );
  const referenceEntityCount = referenceDocs.reduce((sum, d) => sum + d.truth.entities.length, 0);

  // Reporte por stdout (no console.error, no es un motor del Core).
  process.stdout.write(
    `Fixtures generados en ${FIXTURE_DIR}:\n` +
      `  - text-10p.pdf (${text10p.byteLength} bytes, 10 páginas)\n` +
      `  - image-alpha-3p.pdf (${imageAlpha.byteLength} bytes, 3 páginas con imagen alfa y transparencias)\n` +
      `  - empty.pdf (${empty.byteLength} bytes, 1 página sin contenido)\n` +
      `  - corrupt.pdf (${corrupt.byteLength} bytes, header %PDF- + cuerpo no-PDF)\n` +
      `  - reference/ (${referenceDocs.length} documentos, ${referenceEntityCount} entidades de ground truth)\n` +
      `\n` +
      `Pendientes (requieren tools externos):\n` +
      `  - protected.pdf: qpdf --encrypt test1234 test1234 256 -- text-10p.pdf protected.pdf\n`,
  );
}

// Solo ejecutar main() cuando se corre como script (`tsx generate.ts`),
// no cuando se importa (test). Detección: si el módulo es el entry point.
if (isMainModule()) {
  await main();
}
