/**
 * ADR-190 §4, anclaje del scroll (`ui/Components.md` §5.3, "Anclaje del
 * scroll"): si una página **arriba** de lo que el usuario está mirando gana o
 * pierde su franja de aviso `unreadableInk` (en la práctica, durante un
 * `reanalyze` de OCR), lo que se ve en pantalla no se mueve.
 *
 * Un `reanalyze` de OCR real no permite fijar qué página cambia de veredicto ni
 * cuándo: con texto legible ninguna página queda marcada, y hacer que una lo
 * quede exigiría degradar el ráster a propósito. Así que el cambio de marca se
 * dispara por el mismo camino por el que llega en producción — el evento
 * `OCR_PAGE_FINISHED` con `unreadableInk` por el bus del Core (expuesto por
 * `__anonlyCore` en el build `VITE_E2E`) — sobre un documento real ya cargado.
 * El cálculo del anclaje en sí está cubierto, caso por caso, por
 * `apps/react-client/src/__tests__/page-slots.test.ts`; esto solo comprueba
 * que `PageVirtualizer` lo aplica sobre el DOM real.
 *
 * Qué se mide: la posición en pantalla del canvas de una página visible antes y
 * después de que la página 0 (arriba de la vista) gane y pierda la franja, y
 * que el alto total del scroll sí cambió (72 px), o sea que el cambio de layout
 * ocurrió de verdad. Sin el anclaje, el canvas se corre esos 72 px.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { expect, openApp, test } from "./support/electronApp.js";
import { rasterizeToScannedPdf } from "./support/scannedPdf.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(300_000);

const PAGE_COUNT = 4;
const STRIP_PX = 72;
// `data-testid` del contenedor con scroll de `PageVirtualizer`: no depende de sus clases de Tailwind.
const VIEWER_TESTID = "page-virtualizer-scroll";

async function buildTextDocument(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    const page = doc.addPage([260, 180]);
    page.drawText(`Pagina de control ${index + 1}`, {
      x: 20,
      y: 80,
      size: 20,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return doc.save();
}

test("ADR-190: una franja que aparece o desaparece arriba de la vista no mueve lo que se ve", async ({
  page,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  await page.evaluate(() => {
    const scope = window as unknown as {
      __anonlyCore?: {
        bus: { on(channel: string, event: string, cb: (payload: unknown) => void): void };
      };
      __anchorDocumentId?: string;
    };
    scope.__anonlyCore?.bus.on("ocr", "OCR_PAGE_FINISHED", (payload) => {
      const id = (payload as { documentId?: unknown }).documentId;
      if (typeof id === "string") scope.__anchorDocumentId = id;
    });
  });

  const scanned = await rasterizeToScannedPdf(page, await buildTextDocument(), 150 / 72);
  await page.locator('input[type="file"]').setInputFiles(scanned);
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/no se pudo leer/i), "control: texto legible, sin aviso").toHaveCount(
    0,
  );

  // Se mira la página 3 (índice 2): las páginas 0 y 1 quedan arriba de la vista.
  const viewer = page.getByTestId(VIEWER_TESTID);
  const pageOne = page.getByRole("img", { name: /^Página 1, original/ });
  const pageTwo = page.getByRole("img", { name: /^Página 2, original/ });
  const pageThree = page.getByRole("img", { name: /^Página 3, original/ });
  // El alto de una fila (página + separador) sale del DOM, no de constantes
  // copiadas del código: es la distancia entre los canvas de dos páginas
  // consecutivas, todavía sin franjas.
  await expect(pageTwo).toBeVisible();
  const rowHeight =
    ((await pageTwo.boundingBox())?.y ?? Number.NaN) -
    ((await pageOne.boundingBox())?.y ?? Number.NaN);
  expect(rowHeight, "alto de fila derivado del DOM").toBeGreaterThan(0);
  await viewer.evaluate((node, top) => {
    node.scrollTop = top;
  }, 2 * rowHeight);
  await expect(pageThree).toBeVisible();
  const scrollHeight = (): Promise<number> => viewer.evaluate((node) => node.scrollHeight);
  const topOf = async (): Promise<number> => (await pageThree.boundingBox())?.y ?? Number.NaN;

  const baseline = await topOf();
  const baseHeight = await scrollHeight();

  const setVerdict = async (unreadableInk: boolean): Promise<void> => {
    await page.evaluate((flag) => {
      const scope = window as unknown as {
        __anonlyCore?: {
          bus: { emit(channel: string, event: string, payload: unknown): void };
        };
        __anchorDocumentId?: string;
      };
      scope.__anonlyCore?.bus.emit("ocr", "OCR_PAGE_FINISHED", {
        documentId: scope.__anchorDocumentId,
        pageIndex: 0,
        wordCount: flag ? 0 : 3,
        confidence: flag ? 0 : 0.9,
        ...(flag ? { unreadableInk: true } : {}),
      });
    }, unreadableInk);
  };

  // La página 0 gana la franja: el contenido total crece 72 px y la página 3 no se mueve.
  await setVerdict(true);
  await expect.poll(scrollHeight).toBe(baseHeight + STRIP_PX);
  expect(await topOf(), "la página visible se movió al aparecer la franja arriba").toBeCloseTo(
    baseline,
    0,
  );

  // La página 0 pierde la franja: vuelve al alto original y la página 3 sigue en su lugar.
  await setVerdict(false);
  await expect.poll(scrollHeight).toBe(baseHeight);
  expect(await topOf(), "la página visible se movió al desaparecer la franja arriba").toBeCloseTo(
    baseline,
    0,
  );
});
