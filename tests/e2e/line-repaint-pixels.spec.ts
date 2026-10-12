/**
 * ADR-210 — el repintado de línea mueve píxeles, con canvas real, en Electron
 * (`Render_Engine.md`, enmienda normativa ADR-210, último párrafo).
 *
 * Documento sintético de `pdf-lib` con Helvetica (fuente estándar: no depende de
 * nada instalado ni de documentos reales). «Zoe» es un dato de tres letras: su
 * etiqueta (`[MUJ-01]`) es más ancha que su caja, y lo siguen varias palabras.
 * El tercer renglón es el de control: «Marina Suarez» se reemplaza por una
 * etiqueta más angosta que su caja, así que no hay repintado.
 *
 * **Cómo se comparan los píxeles.** El `<canvas>` del visor re-escala la imagen
 * del preview (`PageCanvas`: 595 × zoom píxeles de imagen contra 565,7 × zoom de
 * canvas), así que sus píxeles no son los del render. `support/pagePixels.ts`
 * copia la imagen decodificada, a su tamaño natural, en el mismo `drawImage` con
 * el que el visor la pinta. La vista Original y la Anonimizada a una escala dada
 * salen del mismo render con el mismo ancho en píxeles: la comparación es
 * píxel contra píxel, sin interpolar.
 *
 * **Cómo se obtiene el desplazamiento sin adivinarlo.** Se toma la región de las
 * palabras que siguen a la etiqueta en la imagen Original y se busca, entre 0 y
 * `maxShift` píxeles, TODO corrimiento horizontal entero que la hace idéntica
 * (los cuatro canales de cada píxel) a la misma región en la Anonimizada. Debe
 * haber exactamente uno, y mayor que cero. No hay tolerancia: un candidato con
 * un solo píxel distinto no cuenta. Ese corrimiento se contrasta además con el
 * resaltado de la lupa (el mapa de ADR-204 / ADR-210 §8), que sale de otra ruta.
 */

import type { Locator, Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import {
  LINE_DOCUMENT_PAGE_HEIGHT,
  LINE_DOCUMENT_PAGE_WIDTH,
  lineDocumentFile,
  type LineGeometry,
} from "./support/fixtures.js";
import {
  compareShiftedRegion,
  findExactShift,
  installPageImageCapture,
  listPageShots,
  type PixelRect,
} from "./support/pagePixels.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(180_000);

const LINES = [
  "Declara Zoe ante el tribunal sobre la pericia contable presentada ayer",
  "El perito Zoe firma junto al secretario oficial designado para hoy",
  "Nombre Marina Suarez en el expediente del juzgado civil numero doce",
] as const;

/** Índices de las palabras del dato en cada renglón (primera y última). */
const DATA_WORDS = [
  [1, 1],
  [2, 2],
  [1, 2],
] as const;

const REPAINTED_LINES = [0, 1] as const;
const CONTROL_LINE = 2;

interface Scene {
  readonly lines: ReadonlyArray<LineGeometry>;
}

/** Abre la app, importa el documento y agrega «Zoe» (click en Original) y «Marina Suarez» (lupa). */
async function prepareScene(page: Page): Promise<Scene> {
  await installSettingsOverride(page, { nerEnabled: false });
  await installPageImageCapture(page);
  await openApp(page, "networkidle");

  const { file, lines } = await lineDocumentFile("line-repaint.pdf", LINES);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 45_000 });

  const search = page.getByRole("searchbox", { name: "Buscar en el documento" });
  const highlight = activeHighlight(page);

  // «Zoe»: lupa → click sobre la palabra en la vista Original → «Agregar».
  await search.fill("Zoe");
  await expect(highlight).toBeVisible({ timeout: 15_000 });
  const zoeBox = await highlight.boundingBox();
  expect(zoeBox).not.toBeNull();
  await page.getByRole("button", { name: "Cerrar resultados" }).click();
  await page.mouse.click(zoeBox!.x + zoeBox!.width / 2, zoeBox!.y + zoeBox!.height / 2);
  const selection = page.getByRole("dialog", { name: "Agregar la selección como entidad" });
  await expect(selection).toBeVisible();
  await expect(selection.locator("b")).toHaveText("«Zoe»");
  await selection.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(selection).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "Zoe" })).toBeVisible({ timeout: 15_000 });

  // «Marina Suarez» (dos palabras): botón «Agregar» de la lupa.
  await search.fill("Marina Suarez");
  const addFromSearch = page.getByRole("button", { name: "Agregar", exact: true });
  await expect(addFromSearch).toBeEnabled({ timeout: 15_000 });
  await addFromSearch.click();
  const popover = page.getByRole("dialog", { name: "Agregar la búsqueda como entidad" });
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(popover).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "Marina Suarez" })).toBeVisible({
    timeout: 15_000,
  });
  await search.fill("");
  const closeResults = page.getByRole("button", { name: "Cerrar resultados" });
  if (await closeResults.isVisible()) await closeResults.click();

  return { lines };
}

function activeHighlight(page: Page): Locator {
  return page.locator('[class*="border-warning-strong"][class*="bg-warning/30"]').first();
}

type ViewKind = "original" | "anonimizado";

/** Espera la copia de la página 1 de esa vista a esa escala de render y devuelve su clave. */
async function shotKey(page: Page, kind: ViewKind, scale: number): Promise<string> {
  const label = `Página 1, ${kind}@`;
  let found = "";
  await expect
    .poll(
      async () => {
        const match = (await listPageShots(page)).find(
          (shot) =>
            shot.key.startsWith(label) &&
            Math.abs(shot.width - LINE_DOCUMENT_PAGE_WIDTH * scale) <= 1,
        );
        found = match?.key ?? "";
        return found;
      },
      { message: `imagen ${kind} a escala ${scale}`, timeout: 30_000 },
    )
    .not.toBe("");
  return found;
}

async function showView(page: Page, kind: ViewKind): Promise<void> {
  const name = kind === "original" ? "Original" : "Anonimizado";
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

/**
 * Región de píxeles (imagen a escala `scale`) de las palabras `first..last` de un
 * renglón. Horizontal: de `ceil(izquierda)` a `floor(derecha) - 1`, es decir,
 * siempre dentro de lo que `ceil` deja del lado de la palabra. Vertical: de la
 * altura de las mayúsculas y ascendentes a la de las descendentes.
 */
function wordsRegion(line: LineGeometry, first: number, last: number, scale: number): PixelRect {
  const firstWord = line.words[first];
  const lastWord = line.words[last];
  if (firstWord === undefined || lastWord === undefined) throw new Error("palabra fuera de rango");
  const x = Math.ceil(firstWord.left * scale);
  const right = Math.floor(lastWord.right * scale) - 1;
  const top = Math.floor((LINE_DOCUMENT_PAGE_HEIGHT - (line.baseline + 0.8 * line.size)) * scale);
  const bottom = Math.ceil(
    (LINE_DOCUMENT_PAGE_HEIGHT - (line.baseline - 0.25 * line.size)) * scale,
  );
  return { x, y: top, width: right - x, height: bottom - top };
}

interface LineMeasure {
  /** Corrimientos exactos de las palabras que siguen, desde la segunda vecina hasta el final. */
  readonly exactShifts: ReadonlyArray<number>;
  readonly bestInexact: { readonly shift: number; readonly mismatches: number } | null;
  /** Diferencias de la primera vecina corrida el desplazamiento medido (o 0 si no hay uno). */
  readonly firstNeighborMismatches: number;
  readonly tail: PixelRect;
  readonly firstNeighbor: PixelRect;
}

/**
 * Mide un renglón a una escala. Espera a que la etiqueta esté pintada (la imagen
 * de la zona del dato cambió respecto de la Original) y recién ahí busca el
 * corrimiento: así una imagen vieja, sin la entidad, no se confunde con «no se
 * repintó».
 */
async function measureLine(
  page: Page,
  keys: { readonly original: string; readonly anonymized: string },
  line: LineGeometry,
  dataWords: readonly [number, number],
  scale: number,
): Promise<LineMeasure> {
  const [dataFirst, dataLast] = dataWords;
  const dataRegion = wordsRegion(line, dataFirst, dataLast, scale);
  await expect
    .poll(
      async () =>
        (await compareShiftedRegion(page, keys.original, keys.anonymized, dataRegion, 0))
          .mismatches,
      { message: `la etiqueta de «${line.text}» tiene que estar pintada`, timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  const firstNeighborIndex = dataLast + 1;
  const firstNeighbor = wordsRegion(line, firstNeighborIndex, firstNeighborIndex, scale);
  const tail = wordsRegion(line, firstNeighborIndex + 1, line.words.length - 1, scale);
  const search = await findExactShift(
    page,
    keys.original,
    keys.anonymized,
    tail,
    Math.ceil(120 * scale),
  );
  const shift = search.exactShifts[0] ?? 0;
  const first = await compareShiftedRegion(
    page,
    keys.original,
    keys.anonymized,
    firstNeighbor,
    shift,
  );
  return {
    exactShifts: search.exactShifts,
    bestInexact: search.bestInexact,
    firstNeighborMismatches: first.mismatches,
    tail,
    firstNeighbor,
  };
}

function describeMeasure(line: LineGeometry, measure: LineMeasure): string {
  return (
    `«${line.text}»: corrimientos exactos [${measure.exactShifts.join(",")}], mejor inexacto ` +
    `${JSON.stringify(measure.bestInexact)}, primera vecina con ` +
    `${measure.firstNeighborMismatches} píxeles distintos`
  );
}

/** El renglón se repintó y sus palabras son los píxeles originales corridos un entero. */
function expectRepaintedExactly(line: LineGeometry, measure: LineMeasure): number {
  const detail = describeMeasure(line, measure);
  // Un solo corrimiento hace idéntica la cola; el 0 (sin mover) no es uno de ellos.
  expect(measure.exactShifts.length, detail).toBe(1);
  const shift = measure.exactShifts[0] ?? 0;
  expect(shift, detail).toBeGreaterThan(0);
  expect(Number.isInteger(shift), detail).toBe(true);
  expect(measure.firstNeighborMismatches, detail).toBe(0);
  return shift;
}

/** El renglón no se repintó: la cola está donde estaba, píxel por píxel. */
function expectUntouched(line: LineGeometry, measure: LineMeasure): void {
  const detail = describeMeasure(line, measure);
  expect(measure.exactShifts, detail).toEqual([0]);
  expect(measure.firstNeighborMismatches, detail).toBe(0);
}

/** Caja CSS del resaltado de la lupa para una palabra, esperando a que sea la de esa palabra. */
async function highlightBoxOf(
  page: Page,
  term: string,
  expectedCssWidth: number,
): Promise<{
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}> {
  await page.getByRole("searchbox", { name: "Buscar en el documento" }).fill(term);
  const highlight = activeHighlight(page);
  await expect
    .poll(
      async () => {
        const box = await highlight.boundingBox();
        return box !== null && Math.abs(box.width - expectedCssWidth) < 3;
      },
      { message: `resaltado de «${term}»`, timeout: 15_000 },
    )
    .toBe(true);
  const box = await highlight.boundingBox();
  if (box === null) throw new Error(`sin resaltado para «${term}»`);
  await page.getByRole("button", { name: "Cerrar resultados" }).click();
  return box;
}

test("ADR-210: las palabras que siguen a la etiqueta son los píxeles originales, corridos un entero", async ({
  page,
}) => {
  const { lines } = await prepareScene(page);
  const [firstLine, secondLine] = [lines[0], lines[1]];
  if (firstLine === undefined || secondLine === undefined) throw new Error("fixture incompleto");

  const originalKey = await shotKey(page, "original", 1);
  await showView(page, "anonimizado");
  const anonymizedKey = await shotKey(page, "anonimizado", 1);
  const keys = { original: originalKey, anonymized: anonymizedKey };
  expect(originalKey.split("@")[1]).toBe(anonymizedKey.split("@")[1]);

  // (a) + (b): los dos renglones donde la etiqueta no entra.
  const shifts: number[] = [];
  for (const index of REPAINTED_LINES) {
    const line = lines[index];
    const dataWords = DATA_WORDS[index];
    if (line === undefined || dataWords === undefined) throw new Error("fixture incompleto");
    shifts.push(expectRepaintedExactly(line, await measureLine(page, keys, line, dataWords, 1)));
  }

  // (a) otra ruta: el resaltado de la lupa de una palabra vecina («tribunal») se corre en
  // Anonimizado exactamente lo que se corrieron sus píxeles (mapa de ADR-204, ADR-210 §8).
  const tribunal = firstLine.words[4];
  if (tribunal === undefined) throw new Error("fixture incompleto");
  const canvas = page.getByRole("img", { name: "Página 1, anonimizado" });
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  const cssPerPx = canvasBox!.width / LINE_DOCUMENT_PAGE_WIDTH;
  const cssWidth = (tribunal.right - tribunal.left) * cssPerPx;
  const anonymizedBox = await highlightBoxOf(page, "tribunal", cssWidth);
  await showView(page, "original");
  const originalBox = await highlightBoxOf(page, "tribunal", cssWidth);
  const cssShift = anonymizedBox.x - originalBox.x;
  expect(cssShift, "el resaltado de «tribunal» en Anonimizado").toBeGreaterThan(0);
  expect(Math.abs(cssShift - (shifts[0] ?? 0) * cssPerPx)).toBeLessThan(0.3);
  expect(anonymizedBox.width).toBeCloseTo(originalBox.width, 1);
});

test("ADR-210: un renglón donde la etiqueta entra no mueve a sus vecinas", async ({ page }) => {
  const { lines } = await prepareScene(page);
  const control = lines[CONTROL_LINE];
  const dataWords = DATA_WORDS[CONTROL_LINE];
  if (control === undefined || dataWords === undefined) throw new Error("fixture incompleto");

  const originalKey = await shotKey(page, "original", 1);
  await showView(page, "anonimizado");
  const anonymizedKey = await shotKey(page, "anonimizado", 1);
  const measure = await measureLine(
    page,
    { original: originalKey, anonymized: anonymizedKey },
    control,
    dataWords,
    1,
  );
  expectUntouched(control, measure);
});

test("ADR-210: la decisión de repintar no depende del zoom (100 % y 130 %)", async ({ page }) => {
  const { lines } = await prepareScene(page);

  const measureAll = async (
    scale: number,
  ): Promise<{ readonly shifts: ReadonlyArray<number>; readonly control: LineMeasure }> => {
    const originalKey = await shotKey(page, "original", scale);
    const anonymizedKey = await shotKey(page, "anonimizado", scale);
    const keys = { original: originalKey, anonymized: anonymizedKey };
    const shifts: number[] = [];
    for (const index of REPAINTED_LINES) {
      const line = lines[index];
      const dataWords = DATA_WORDS[index];
      if (line === undefined || dataWords === undefined) throw new Error("fixture incompleto");
      shifts.push(
        expectRepaintedExactly(line, await measureLine(page, keys, line, dataWords, scale)),
      );
    }
    const control = lines[CONTROL_LINE];
    const controlWords = DATA_WORDS[CONTROL_LINE];
    if (control === undefined || controlWords === undefined) throw new Error("fixture incompleto");
    const controlMeasure = await measureLine(page, keys, control, controlWords, scale);
    expectUntouched(control, controlMeasure);
    return { shifts, control: controlMeasure };
  };

  // 100 %.
  await showView(page, "original");
  await shotKey(page, "original", 1);
  await showView(page, "anonimizado");
  await shotKey(page, "anonimizado", 1);
  const at100 = await measureAll(1);

  // 130 %: control «Acercar» ×3 en la vista Anonimizado. El visor re-renderiza solo la vista
  // que está mirando; al conmutar a Original pide esa vista a la escala del zoom vigente
  // (`kindChangeRender.ts`), así que su imagen al 130 % llega sin tocar zoom ni scroll.
  const zoomControls = page.getByRole("group", { name: "Zoom del visor" });
  const zoomIn = zoomControls.getByRole("button", { name: "Acercar" });
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();
  await expect(zoomControls.getByText("130%", { exact: true })).toBeVisible();
  await shotKey(page, "anonimizado", 1.3);
  await showView(page, "original");
  await shotKey(page, "original", 1.3);
  await showView(page, "anonimizado");
  const at130 = await measureAll(1.3);

  // El mismo renglón se repinta a las dos escalas, y el corrimiento escala con el zoom
  // (una etiqueta y una caja a 1,3 × los píxeles, cada una redondeada hacia arriba).
  for (const [index, shift100] of at100.shifts.entries()) {
    const shift130 = at130.shifts[index] ?? 0;
    expect(Math.abs(shift130 - 1.3 * shift100)).toBeLessThanOrEqual(3);
  }
});
