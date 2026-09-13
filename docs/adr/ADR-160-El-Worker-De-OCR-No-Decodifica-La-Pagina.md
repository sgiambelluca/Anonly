<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,core/Contracts.md,adr/ADR-158-El-Raster-De-OCR-Viaja-Codificado.md,adr/ADR-143-Las-Imagenes-De-OCR-Se-Producen-Cuando-Hay-Lugar.md,adr/ADR-090-La-Orientacion-De-Un-Escaneo-Se-Detecta.md,adr/ADR-119-La-Orientacion-Se-Detecta-Con-El-Motor-Que-La-Sabe-Leer.md,adr/ADR-120-Una-Hoja-Torcida-Se-Lee-Enderezada.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md | audiencia=humanos+IA | fase=11 -->

# ADR-160 — El worker de OCR no decodifica la página

- **Estado**: Accepted
- **Fecha**: 2026-09-11
- **Decidido por**: El planificador, sobre lectura de la fuente de `tesseract.js@6.0.1`
  y de `tesseract.js-core@6.1.2`. La premisa está verificada en código, no inferida.
- **Relacionado con**: ADR-158 (que este ADR completa, y cuya salvedad retira),
  ADR-090/119/120 (el OSD y el enderezado), ADR-121 (las franjas de margen),
  ADR-154 §2 levers 4 y 5, ADR-159 (por qué el efecto se va a leer del heap)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Lo que ADR-158 dejó abierto, y dijo que dejaba

ADR-158 sacó el ráster crudo del `postMessage`: `rasterizePage` devuelve
`EncodedPageImage` (PNG, sin pérdida) y el clon que cruza la frontera pasó de
~35 MB a unos pocos. Su salvedad, textual:

> el worker de OCR sigue necesitando un canvas para la rotación de ADR-120 y las
> franjas de margen de ADR-121, así que decodifica una vez. Lo que se ahorra es
> la copia grande cruzando la frontera, no el canvas.

Esa salvedad es correcta para el caso general y **falsa para el caso común**.

### 2. Lo que hace hoy el worker, por página

Leído de `ocr-engine/src/worker/kernel.ts`, para una A4 a 300 dpi
(2481 × 3507 px = 34,8 MB en RGBA):

| paso | materializa | MB |
|---|---|---|
| `decodeEncodedImage` | `ImageBitmap` + `OffscreenCanvas` completo + `ImageData` | 34,8 + 34,8 |
| `detectOrientation` | **otro** `OffscreenCanvas` completo, que `scaleForOsd` reduce a la mitad enseguida | 34,8 → 8,7 |
| `recognize` principal | **otro** `OffscreenCanvas` completo (`toTesseractImage`) | 34,8 |
| `recognizeRotatedMargins` | 2 recortes + 4 rotaciones + 4 canvas (franja = 20 % del ancho) | ~56 |

Son **cuatro superficies de página completa** y **seis pasadas de Tesseract**
(1 de OSD + 1 principal + 4 de franjas) por página, con dos páginas en vuelo.

### 3. tesseract.js no necesita nada de eso — verificado

`node_modules/tesseract.js/src/worker/browser/loadImage.js`:

```js
} else if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
  const blob = await image.convertToBlob();      // ← un encode PNG que hoy pagamos
  data = await readFromBlobOrFile(blob);
} else if (image instanceof File || image instanceof Blob) {
  data = await readFromBlobOrFile(image);        // ← los bytes, directo
}
return new Uint8Array(data);
```

Y del otro lado, `src/worker-script/utils/setImage.js`:

```js
TessModule.FS.writeFile('/input', image);
const res = api.SetImageFile(exif, angle);
```

**Tesseract nunca construye un canvas.** Escribe los bytes codificados en su
MEMFS y deja que Leptonica decodifique adentro del WASM. El canvas y su
`convertToBlob()` son íntegramente costo nuestro, y el PNG que producirían es el
mismo PNG que `rasterizePage` ya nos entregó desde ADR-158.

### 4. Y el `angle` no sirve para reemplazar la rotación

Se evaluó bajar la rotación de ADR-120/121 al core, ya que `SetImageFile` acepta
un `angle`. **No aplica.** En `Balearica/tesseract@5a21eeb`,
`src/ccmain/thresholder.cpp:163` (el fork pineado por `tesseract.js-core@6.1.2`):

```cpp
  src = pixRotate(temp2, angle, L_ROTATE_AREA_MAP, L_BRING_IN_WHITE, 0, 0);
```

Tres razones, cada una suficiente:

1. `L_ROTATE_AREA_MAP` es la rotación general **con interpolación**, para
   *deskew*. Para un 90° exacto remuestrea en vez de usar `pixRotateOrth`:
   cambiaríamos una transposición entera exacta por un resample con pérdida sobre
   la entrada del OCR.
2. Los dos `0, 0` finales son `width`/`height`: la salida queda **clavada al
   tamaño de la entrada**. Una franja de 496 × 3507 rotada 90° necesita salir
   3507 × 496; fijada al origen, se recorta y se pierde el texto.
3. La rotación ortogonal exacta sí existe adentro (`exif` 3..8 →
   `pixRotateOrth`), pero `exif` **no es un parámetro de la API**: tesseract.js lo
   olfatea de los bytes con `image.slice(0, 500).join(' ').match(/1 18 0 3 0 0 0 1 0 (\d)/)`.
   Usarlo exigiría emitir JPEG con un segmento EXIF fabricado — perder el PNG sin
   pérdida y quedar atados a una regex sobre bytes crudos de una dependencia.

**Queda descartado. No reintentar por esta vía.**

Lo que la misma lectura sí cierra: `pixRotate` corta al principio
(`if (L_ABS(angle) < MinAngleToRotate) return pixClone(pixs);`), así que con
`angle = 0` —nuestro caso— no hay remuestreo oculto por página. Era un riesgo que
valía descartar.

## Decisión

### 1. El reconocimiento principal recibe los bytes, no un canvas

`kernelRecognize` le pasa a `recognize()` un `Blob` construido sobre
`image.bytes` — el PNG que `rasterizePage` ya produjo. Desaparecen, en el camino
común: el `ImageData` de página completa, el canvas de `decodeEncodedImage` y el
canvas de `toTesseractImage`.

**Los píxeles son idénticos.** Hoy el recorrido es PNG → `ImageData` → canvas →
`convertToBlob()` → PNG; los dos encodes son PNG y PNG es sin pérdida, así que lo
que llega al core es bit a bit lo mismo, con un round-trip menos. **Este ADR no
tiene dimensión de calidad.**

Las dimensiones autoritativas para mapear cajas siguen siendo
`image.widthPx`/`image.heightPx` (ADR-158 §4), que es de donde ya se leían — no
de `imageData.width`.

### 2. El OSD decodifica reducido, nunca completo

`detectOrientation` deja de recibir un canvas de página completa para que
`scaleForOsd` lo achique. La imagen reducida se produce en un solo paso con
`createImageBitmap(blob, { resizeWidth, resizeHeight })`, a `OSD_SCALE`. La
página entera no se materializa en ningún momento de este camino.

`scaleForOsd` deja de tener llamadores y se retira con su constante si no queda
otro uso.

### 3. Las franjas de ADR-121 decodifican la franja, no la página

`recognizeRotatedMargins` obtiene cada franja con el recorte en la propia
decodificación —`createImageBitmap(blob, sx, sy, sw, sh)`— en vez de decodificar
la página entera y recortarla con `cropImageData`. La rotación a 90°/270° sigue
siendo nuestra y sigue siendo exacta (§4 de arriba), pero se aplica sobre el
20 % del ancho en vez de sobre una copia de la página.

`cropImageData` se retira si no queda otro llamador. **La regla de fusión de
ADR-121 no cambia**: mismo umbral de solape, misma `ROTATED_MIN_CONFIDENCE`,
mismo guard que impide que una franja fallada cueste el texto derecho.

### 4. El camino con orientación ≠ 0 se conserva tal cual

Cuando el OSD devuelve 90/180/270, ADR-120 necesita la página entera en píxeles
para enderezarla, y no hay forma de evitarlo (§4 del Contexto). Ese camino
**decodifica igual que hoy** y es explícitamente el camino lento. Es el ~1 % de
las páginas; optimizarlo no está en este ADR.

### 5. Lo que no cambia

Ni el contrato (`OcrPagePayload.image` ya es `EncodedPageImage` desde ADR-158),
ni `Contracts.md`, ni otro motor. **Un solo módulo, `ocr-engine`.** El presupuesto
de `ocr.maxLiveImageBytes` y `estimatedBytes` de ADR-143 tampoco cambian: siguen
estimando sobre la página, que es lo que Render produce.

### 6. Cómo se verifica — y por qué **no** con el piso

El estadístico que ADR-159 §3 fijó para "¿se retiene algo por página?" es el
**piso**. Para este ADR sería el estadístico equivocado, y hay que decirlo antes
de implementar nada: **lo que ADR-160 saca es transitorio.** Los canvas y el
`ImageData` de página se crean y se sueltan dentro de la misma página; nunca
llegan a la parte baja de la señal. Un costo transitorio mueve el **pico**, no el
piso.

Medido sobre la línea de base final (3 corridas calientes, 2026-09-12), la
diferencia entre los dos estadísticos dentro de la ventana de OCR es enorme:

| | run0 | run1 | run2 | dispersión |
|---|---|---|---|---|
| **Pico** Tab | 1149,7 MB | 1022,6 MB | 1165,4 MB | **±6 %** |
| **Pico** GPU | 451,6 MB | 479,6 MB | 517,7 MB | **±7 %** |
| Piso Tab | +132,3 | +146,7 | **−27,9** | cambia de signo |
| Piso GPU | +161,1 | +6,5 | +46,4 | rango de 25× |

**Los criterios de aceptación, entonces:**

1. **Pico por proceso dentro de `OCR_STARTED → OCR_FINISHED`, Tab y GPU por
   separado, corrida por corrida.** Es la comparación intra-ventana que ADR-158
   §6 ya había fijado por el mismo motivo, y la única con dispersión chica. **El
   GPU es el que más tiene que moverse**: ahí viven los backing stores de los
   canvas que este ADR elimina.
2. **Un test estructural, que no depende de ninguna medición**: el camino común
   no construye ningún `OffscreenCanvas` de página completa (§15 item 30 del
   spec). Es determinístico, no tiene ruido, y es lo que fija la propiedad aunque
   la memoria se mueva menos de lo estimado.
3. **Calidad**: el corpus de ADR-147 tiene que dar **idéntico**. PNG es sin
   pérdida y los bytes que llegan al core son los mismos, así que cualquier
   diferencia es un defecto de la conversión, no una degradación aceptable
   (mismo criterio que ADR-158 §6).

**La comparación se hace contra la línea de base del 2026-09-12 y no contra
ninguna anterior**: es la única tomada con la versión final del instrumento, y
mezclar versiones es exactamente lo que dejó el M2 de ADR-158 sin atribución
limpia.

**Lo que no se usa como criterio**: el residuo "no atribuido" (ADR-159 §8) —
es una cota con aritmética todavía sin cerrar (§8 de este ADR no depende de
ella), y M2 del run completo, cuyo máximo puede caer fuera de toda fase
(ADR-146 §7bis).

## Consecuencias

**A favor**

- Elimina las cuatro superficies de página completa del camino común. Es el lever
  más grande que queda **sin costo de calidad, sin tocar paralelismo (ADR-154 §1)
  y sin tocar el DPI**.
- Actúa **durante** la etapa de OCR, que es donde ADR-154 lever 3 dejó dicho que
  hay que actuar para mover el pico.
- Ataca la mitad del fenómeno que ADR-159 §3 le sacó a la hipótesis del heap de
  WASM: los backing stores de canvas viven en el proceso GPU, que sube 3/3 por el
  piso.
- Retira un round-trip de encode/decode por página: también es tiempo.

**En contra**

- `createImageBitmap` con rectángulo de origen **puede** decodificar la imagen
  completa internamente y recortar después, según el decodificador. Si lo hace, el
  ahorro de §3 se limita a lo que queda **retenido** en JS y no al pico
  transitorio. Es medible y hay que medirlo; no cambia §1 ni §2, que son los
  grandes.
- Deja dos caminos en `kernelRecognize` (con y sin píxeles) donde hoy hay uno.
  Es complejidad real, y la única forma de evitarla sería pagar el camino lento
  siempre.
- La premisa está verificada leyendo la fuente de una dependencia. Si
  `tesseract.js` cambia `loadImage`, el ahorro desaparece en silencio — sin romper
  nada. Un test que fije "el kernel no construye un canvas de página completa en
  el camino común" es parte del PR, no un extra.

**Lo que no toca**: la calidad de reconocimiento (§1), la regla de fusión de
ADR-121 (§3), el contrato público (§5), ni ningún otro motor.
