/**
 * Los headers con los que el shell sirve sus assets.
 *
 * Existe por un acantilado de rendimiento real: sin `Content-Length`, quien
 * consume la respuesta hace crecer su buffer a los tirones, y cargar el modelo
 * NER pasaba de 948 ms a **31 segundos**. No fallaba nada — solo tardaba
 * treinta veces más, que es la clase de defecto que nadie reporta como bug y
 * todos sufren.
 */

import { expect, openApp, test } from "./support/electronApp.js";

test.setTimeout(120_000);

const MODELO =
  "app://local/models/ner/Xenova/bert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx";

test("todo asset servido por app:// declara su tamaño", async ({ page }) => {
  await openApp(page);

  const medido = await page.evaluate(async (url) => {
    const res = await fetch(url);
    const declarado = res.headers.get("content-length");
    const real = (await res.arrayBuffer()).byteLength;
    return { declarado, real };
  }, MODELO);

  expect(
    medido.declarado,
    "sin Content-Length la carga del modelo se vuelve 33× más lenta",
  ).not.toBeNull();
  // Y que además sea el tamaño real: un valor equivocado es peor que ninguno,
  // porque el consumidor dimensiona el buffer una sola vez y con el número mal.
  expect(Number(medido.declarado)).toBe(medido.real);
});
