/**
 * Tests de la geometría de orientación del kernel de OCR (ADR-090 §3/§4).
 *
 * `rotateImageData` y `unrotateBbox` son inversas una de la otra, y de eso
 * depende que una palabra de un escaneo rotado quede tapada donde está
 * impresa. Se prueban acá, sobre la función pura, porque a través de
 * `processPage` los píxeles no son observables: el `OffscreenCanvas` de los
 * tests es un stub cuyo `putImageData` es un no-op (`./fixtures/test-helpers.ts`).
 * El resto del camino —que `detect` se consulte, que las cajas vuelvan al
 * espacio original, que `rotation` viaje hasta la `Word`— se prueba de punta a
 * punta en `./unit.test.ts`.
 *
 * Ninguna de las dos se exporta desde `index.ts`: son internas del paquete,
 * como todo `worker/kernel.ts`.
 */
import type { BoundingBox } from "@anonly/shared";
import { describe, it, expect } from "vitest";

import { cropImageData, rotateImageData, unrotateBbox, type Rotation } from "../worker/kernel.js";

/**
 * Imagen de `width × height` donde cada píxel lleva su índice en el canal R:
 * alcanza para seguir a dónde fue cada uno.
 */
function numberedImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = i;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height, colorSpace: "srgb" };
}

function redChannel(image: ImageData): number[] {
  const out: number[] = [];
  for (let i = 0; i < image.width * image.height; i++) out.push(image.data[i * 4] ?? -1);
  return out;
}

describe("OcrKernel — recorte de franjas (ADR-121)", () => {
  it("crops a strip of full height, keeping the right columns", () => {
    // 4 x 2 con un valor distinto por columna en el canal R: asi se puede
    // afirmar QUE columnas quedaron, no solo cuantas.
    const data = new Uint8ClampedArray(4 * 2 * 4);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) data[(y * 4 + x) * 4] = x + 1;
    }
    const source: ImageData = { data, width: 4, height: 2, colorSpace: "srgb" };

    const cropped = cropImageData(source, 2, 2);

    expect(cropped.width).toBe(2);
    expect(cropped.height).toBe(2);
    expect([cropped.data[0], cropped.data[4], cropped.data[8], cropped.data[12]]).toEqual([
      3, 4, 3, 4,
    ]);
  });

  it("does not throw on a raster whose width is not an integer", () => {
    /*
     * `viewport.width` de pdf.js es un float. Un `ImageData` de navegador trae
     * siempre dimensiones enteras, pero nada en el tipo lo garantiza, y con 4,5
     * de ancho el `set()` de la ultima fila se pasaba del buffer por medio
     * pixel: `RangeError: offset is out of bounds`. Como el recorte corria
     * FUERA del guard de la pasada rotada, eso no costaba la franja sino LA
     * PAGINA ENTERA — reproducido en `tests/integration/ocr-pdf-fusion.test.ts`,
     * donde el doble de canvas copia el ancho del viewport tal cual.
     */
    const source: ImageData = {
      data: new Uint8ClampedArray(Math.floor(4.5) * 2 * 4),
      width: 4.5,
      height: 2,
      colorSpace: "srgb",
    };

    const cropped = cropImageData(source, 3, 2);

    expect(Number.isInteger(cropped.width)).toBe(true);
    expect(cropped.data.length).toBe(cropped.width * cropped.height * 4);
  });
});

describe("OcrKernel — geometría de orientación (ADR-090 §3/§4)", () => {
  it("rotating by 0 returns the very same object", () => {
    const image = numberedImage(3, 2);
    expect(rotateImageData(image, 0)).toBe(image);
  });

  it("swaps the dimensions on 90 and 270, keeps them on 180", () => {
    const image = numberedImage(4, 2);
    expect(rotateImageData(image, 90)).toMatchObject({ width: 2, height: 4 });
    expect(rotateImageData(image, 270)).toMatchObject({ width: 2, height: 4 });
    expect(rotateImageData(image, 180)).toMatchObject({ width: 4, height: 2 });
  });

  it("rotates clockwise: the top-left pixel lands on the top-right corner", () => {
    // 3 × 2, índices:  0 1 2      Rotada 90° en horario (2 × 3):  3 0
    //                  3 4 5                                      4 1
    //                                                             5 2
    const rotated = rotateImageData(numberedImage(3, 2), 90);
    expect(redChannel(rotated)).toEqual([3, 0, 4, 1, 5, 2]);
  });

  it("four 90° turns return the original, pixel by pixel", () => {
    const original = numberedImage(5, 3);
    let image = original;
    for (let i = 0; i < 4; i++) image = rotateImageData(image, 90);

    expect(image.width).toBe(original.width);
    expect(image.height).toBe(original.height);
    expect(redChannel(image)).toEqual(redChannel(original));
  });

  it("180 is two 90° turns", () => {
    const original = numberedImage(4, 3);
    expect(redChannel(rotateImageData(original, 180))).toEqual(
      redChannel(rotateImageData(rotateImageData(original, 90), 90)),
    );
  });

  it("270 is three 90° turns", () => {
    const original = numberedImage(4, 3);
    expect(redChannel(rotateImageData(original, 270))).toEqual(
      redChannel(rotateImageData(rotateImageData(rotateImageData(original, 90), 90), 90)),
    );
  });

  it("unrotateBbox brings the box back inside the original raster, on the three angles", () => {
    // El raster original es 100 × 40. Para cada ángulo, una caja que cabe en
    // el espacio enderezado correspondiente.
    const casos: ReadonlyArray<{ readonly degrees: Rotation; readonly bbox: BoundingBox }> = [
      { degrees: 90, bbox: { x: 5, y: 20, width: 20, height: 40 } }, // enderezado 40 × 100
      { degrees: 180, bbox: { x: 10, y: 5, width: 30, height: 20 } }, // enderezado 100 × 40
      { degrees: 270, bbox: { x: 5, y: 20, width: 20, height: 40 } }, // enderezado 40 × 100
    ];

    for (const { degrees, bbox } of casos) {
      const back = unrotateBbox(bbox, degrees, 100, 40);
      // Cae dentro del raster original — lo primero que rompe un mapeo mal
      // hecho, y lo que hace que la censura tape donde no hay nada.
      expect(back.x, `${degrees}°`).toBeGreaterThanOrEqual(0);
      expect(back.y, `${degrees}°`).toBeGreaterThanOrEqual(0);
      expect(back.x + back.width, `${degrees}°`).toBeLessThanOrEqual(100);
      expect(back.y + back.height, `${degrees}°`).toBeLessThanOrEqual(40);
      // El área se conserva: una rotación recta no deforma.
      expect(back.width * back.height, `${degrees}°`).toBe(bbox.width * bbox.height);
    }
  });

  it("unrotateBbox by 0 leaves the box untouched", () => {
    const bbox: BoundingBox = { x: 7, y: 9, width: 11, height: 13 };
    expect(unrotateBbox(bbox, 0, 100, 40)).toEqual(bbox);
  });
});
