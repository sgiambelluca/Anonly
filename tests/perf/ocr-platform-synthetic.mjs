// Genera PDFs "escaneados" sintéticos y no confidenciales para
// `ocr-platform-probe.mjs`: texto rasterizado en Chromium, binarizado y
// embebido como una única imagen por página. Se genera UNA vez y el mismo
// archivo se lleva a cada plataforma; regenerarlo en otra plataforma cambia
// los píxeles de origen y anula la comparación.
//
// uso: node tests/perf/ocr-platform-synthetic.mjs <dirSalida>
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const outDir = process.argv[2];
if (!outDir) throw new Error("uso: node tests/perf/ocr-platform-synthetic.mjs <dirSalida>");
const root = process.cwd();
const { chromium } = createRequire(resolve(root, "apps/desktop-shell/package.json"))(
  "@playwright/test",
);
const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } =
  createRequire(resolve(root, "apps/react-client/package.json"))("pdf-lib");

const A4 = [595.28, 841.89];
const PAGES = 4;
const VARIANTS = [
  { name: "syn-1bpc-200dpi.pdf", dpi: 200, kind: "gray1" },
  { name: "syn-8bpc-200dpi.pdf", dpi: 200, kind: "gray8" },
  { name: "syn-rgb-200dpi.pdf", dpi: 200, kind: "rgb" },
  { name: "syn-1bpc-300dpi.pdf", dpi: 300, kind: "gray1" },
];
const vocabulary = (
  "el la los las de del que en por con para una uno sobre entre como segun cuando donde tambien " +
  "expediente resolucion articulo inciso plazo tribunal camara sala parte actora demandada recurso apelacion " +
  "sentencia fundamentos considerando resulta corresponde establecer asimismo conforme dispuesto normativa " +
  "vigente procedimiento administrativo notificacion domicilio constituido presentacion escrito agregado " +
  "fojas autos principales oportunidad procesal efectos pertinentes costas honorarios regulacion"
).split(" ");
let seed = 12345;
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pages = Array.from({ length: PAGES }, () =>
  Array.from({ length: 44 }, () => {
    const words = Array.from(
      { length: 9 + Math.floor(random() * 4) },
      () => vocabulary[Math.floor(random() * vocabulary.length)],
    );
    if (random() < 0.2) words.push(String(Math.floor(random() * 90000) + 10000));
    return words.join(" ");
  }),
);

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage();
const rasterize = (dpi, lines) =>
  tab.evaluate(
    ({ dpi, lines, A4 }) => {
      const w = Math.round((A4[0] / 72) * dpi);
      const h = Math.round((A4[1] / 72) * dpi);
      const ctx = new OffscreenCanvas(w, h).getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#000";
      const px = (11 / 72) * dpi;
      ctx.font = `${px}px "Times New Roman", serif`;
      lines.forEach((line, i) =>
        ctx.fillText(line, (60 / 72) * dpi, (70 / 72) * dpi + i * px * 1.45),
      );
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const gray = new Array(w * h);
      for (let i = 0; i < w * h; i++) gray[i] = rgba[i * 4] < 128 ? 0 : 255;
      return { w, h, gray };
    },
    { dpi, lines, A4 },
  );

for (const variant of VARIANTS) {
  const doc = await PDFDocument.create();
  for (const lines of pages) {
    const { w, h, gray } = await rasterize(variant.dpi, lines);
    let bytes;
    if (variant.kind === "gray1") {
      const rowBytes = Math.ceil(w / 8);
      bytes = new Uint8Array(rowBytes * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (gray[y * w + x] === 255) bytes[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    } else if (variant.kind === "gray8") {
      bytes = Uint8Array.from(gray);
    } else {
      bytes = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) bytes[i * 3] = bytes[i * 3 + 1] = bytes[i * 3 + 2] = gray[i];
    }
    const image = doc.context.register(
      doc.context.stream(deflateSync(bytes), {
        Type: "XObject",
        Subtype: "Image",
        Width: w,
        Height: h,
        ColorSpace: variant.kind === "rgb" ? "DeviceRGB" : "DeviceGray",
        BitsPerComponent: variant.kind === "gray1" ? 1 : 8,
        Filter: "FlateDecode",
      }),
    );
    const page = doc.addPage(A4);
    const name = page.node.newXObject("Im", image);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(A4[0], 0, 0, A4[1], 0, 0),
      drawObject(name),
      popGraphicsState(),
    );
  }
  writeFileSync(join(outDir, variant.name), await doc.save({ useObjectStreams: false }));
  process.stdout.write(`${variant.name}\n`);
}
await browser.close();
