# OCR de marcas de agua y WordArt de Word, después de convertir a PDF

> Informe del implementador del spike, copiado sin cambios de
> `C:\Anonly\spikes\lowa\results\OCR_MARCAS.md` el 2026-11-24. El corpus,
> las imágenes y el código quedan fuera del repo, en
> `C:\Anonly\spikes\lowa\`. Qué decide el planificador con esto:
> `Plan_1.2.md` §8.6.

Fecha: 2026-11-24. Spike de medición: se mide y se reporta; no se fijan umbrales ni se decide arquitectura. **No hay documentos reales** (no hay `ANONLY_REAL_DOC_*` definidas): todos los datos son inventados (`Juan Pérez`, `30.123.456`, `jperez@ejemplo.com` en las marcas de agua; `María Gómez`, `27.654.321`, `mgomez@ejemplo.org` en el WordArt; el texto normal de la página trae otros datos inventados).

Conversor: el adoptado, `dynexec0` + `rec-C`, `UseTaggedPDF=false`, en un Worker con CSP estricta (`harness\batch-run.mjs`, tal cual `BORDES.md`). El repo (`C:\Anonly\Anonly`) no se tocó.

## Veredicto corto

**Sí hay una variante que lee los datos de forma confiable, con una salvedad en el correo.** Es la que hace falta combinar de tres pasos:

1. **Ubicar la región** en el PDF convertido (cajas de los trazados rellenos o trazados, sin texto). Cubrió el 100 % de la tinta de la figura en los 50 casos.
2. **Rasterizar la región sin el texto nativo** de la página (el texto nativo es negro y se cruza con la marca; con él, no hay variante que lea: 0 de 16).
3. **Enderezar la región** por el ángulo de la figura y recién entonces pasar OCR, **sin contraste**.

Resultado de esa combinación (variante **RF**, páginas con texto; o **RC**, páginas sin texto): 12 de 16 marcas con los 4 datos exactos y el 99 % de los caracteres sobre página con texto, 12 de 16 sobre página vacía (el 99 %), 7 de 8 WordArt girados (99 %). Lo que falla es casi siempre el **correo**: el `@` se lee como `d`, `Q` o `(D` en la letra chica (Times de unos 10 pt), y entonces el correo no sirve como dato. La otra falla es el WordArt DrawingML con contorno (relleno blanco): el DNI sale `27,054,321` y el correo con errores.

| Pregunta | Respuesta medida |
|---|---|
| ¿La página entera (lo que la app ya hace) lee la figura? | **Solo si está horizontal y la página está vacía**: 6 de 8 marcas horizontales sobre página vacía con los 4 datos, 7 de 8 WordArt horizontal. **En diagonal o girada: 0 de 24.** Sobre una página con texto: **0 de 16**. |
| ¿Recortar la región sola ayuda? | **No** (RB ≈ A): la región tal cual tiene el mismo problema de giro y de cruce con el texto. |
| ¿El contraste ayuda? | **No** (RD ≈ RB, 7/32 contra 6/32 en marcas). El problema no es el gris claro: el gris claro semitransparente se lee igual que el gris oscuro. |
| ¿Enderezar ayuda? | **Sí, es lo que cambia todo** en diagonal y en girado: de 0 a 6 de 8 (marcas diagonal sobre página vacía; las otras 2 leen 3 de 4) y de 0 a 7 de 8 (WordArt girado). |
| ¿Y si la marca cruza texto nativo? | Enderezar sobre el raster normal **no alcanza (RC: 0 de 16)**. Hay que sacar el texto nativo de la imagen de la región. Con el raster del PDF **sin los bloques de texto** (RF): **12 de 16, 99 % de caracteres**. Taparlo con una máscara sobre el raster normal (RG, RH) queda en **0 de 16** (83-85 % de caracteres): no es confiable. |
| ¿El OCR de página entera estropea el texto normal? | **Sí, cuando la marca es oscura y cruza el texto**: 73 palabras de 1 745 (4 %) leídas distinto del nativo, más 15 palabras basura fuera del texto, en las 8 marcas oscuras; con marca clara, 7 de 1 760 (0,4 %) y 0 basura. Además, **el OCR repite casi todas las palabras nativas** (1 714 + 1 686 de ~3 500 son idénticas a una palabra nativa) y **lee mal el mismo correo nativo** (`cmedina(Dejemplo.net`) en al menos 13 de 16 páginas: si el resultado del OCR se mezcla con el texto nativo, hay que descartar las palabras que caen sobre texto nativo. |
| ¿Y en los WordArt girados, la página entera deja basura? | **Sí**: de 5 a 10 fragmentos por página, de la figura mal leída (`Marg,`, `Come,`, `7.65,`, `4.32;`, `Map`), que no están en el texto nativo y que parecen datos a medias. En los WordArt horizontales, 0 basura salvo el DrawingML con contorno. |
| ¿Cuánto cuesta? | Página entera: **~0,6 s** con la página vacía, **~0,8 s** con 3 renglones, **~2,4-2,6 s** con una página de texto (14 párrafos). Región enderezada: **~0,1-0,3 s** si no tiene texto; hasta **1,2-1,5 s** si es grande y trae texto nativo encima. RF: **mediana 134 ms** (54-348). No hay otra pasada sobre la página completa: la región es 0,08-1,8 Mpx contra 8,7 Mpx de la página a 300 ppp. |

**Dos hechos que importan para el diseño**, sin que yo decida nada:

- **El ángulo se puede sacar sin el XML.** Los ejes principales de la tinta de la región (sin texto nativo) dan el ángulo con un error de 0,2 a 0,3° en 16 de 16 casos (`angulo.json`; medido sobre las regiones de las marcas diagonales y los WordArt girados). Con un error de ±3° se leen 2 a 4 de 4 datos (el contorno DrawingML es la excepción: 1 a 4); con ±6°, 1 a 3 de 4; con ±10°, 0 a 2 de 4. Es decir, hace falta un ángulo con menos de ~3° de error.
- **El PDF no sirve para encontrar la región si la figura es un WordArt que LibreOffice no pudo dibujar**: `wordArtVert` de PowerPoint se dibuja como líneas verticales aplastadas (la región se encuentra con IoU 0,99, pero no hay nada legible: 0 de 4, 0 de 37 caracteres). Eso es un defecto del conversor, no del OCR.

## Cómo se midió

**OCR, idéntico al de la app** (`ocr-engine/src/worker/kernel.ts`, `config.ts`, `orientation-kernel.ts`):
- `tesseract.js` 6.0.1 (el de `node_modules` del repo), `createWorker(['spa','eng'])` con OEM por defecto, `tessedit_pageseg_mode = PSM.SPARSE_TEXT`, `user_defined_dpi = 300` (`OcrConfig.dpi`), `recognize(..., { blocks: true })`.
- Modelos y núcleo: `apps/react-client/public/models/tesseract/{spa,eng,osd}.traineddata.gz` y `public/wasm/tesseract/` (los que deja `pnpm assets:mirror`; ya estaban en disco, no se descargó nada).
- Raster a **300 ppp** con `pdfjs-dist` 4.10.38 (el del repo) y `@napi-rs/canvas`.
- **OSD** como la app: página reducida a ~1 754 px de lado largo, worker aparte con `OEM.TESSERACT_ONLY` y `legacyCore`, y la rotación se aplica solo con confianza ≥ 1. **Nunca rotó una página**: en horizontal da 0° con confianza 1,8-3,1; en diagonal 0° o 90° con confianza 0,18-0,39 (rechazada).
- **No se replicaron** las pasadas rotadas sobre las franjas de margen del 20 % (ADR-121, cuatro reconocimientos extra por página). La figura en diagonal está en el centro de la página, así que casi seguro no las cambian, pero no se midió **[NO CONFIRMADO]**.
- Corrió en Node (`worker_threads`), no dentro del Worker de Electron. Equipo: i5-12400, 12 hilos, 16 GB, Node 22.23.2. **[NO CONFIRMADO]** que los tiempos coincidan con los de la app empaquetada.

**Corpus** (`corpus-ocr-marcas\`, 50 archivos + `manifest.json`; generador `harness\ocr-marcas\gen.cjs`, reusa `harness\bordes\lib.cjs`):
- **32 marcas de agua** VML de texto en el encabezado (`PowerPlusWaterMarkObject`, como Word): diagonal (rotación 315°) y horizontal × semitransparente (`silver`, `opacity .5`, el valor de Word) y gris oscuro (`#404040`) × dos tamaños (G: 430 pt de ancho, unos 19 pt de cuerpo; P: 215 pt, unos 10 pt) × Calibri y Times New Roman × página vacía y página con 14 párrafos de texto normal.
- **16 WordArt** en el cuerpo: VML `textpath` y DrawingML (`prstTxWarp textPlain`, con `w14:textFill/textOutline/shadow`) × sin efectos, relleno degradado, contorno y sombra × horizontal y girado 20°.
- **2 WordArt de PowerPoint**: horizontal y `wordArtVert`.
- **1 caso extra** con una tabla con bordes (`x-wm-diag-claro-G-cal-tabla`).
- Armados a mano en XML, **no con Word**: no hay `mc:Fallback` y los efectos son los de las especificaciones. **[NO CONFIRMADO]** que un archivo guardado por Word dé exactamente lo mismo.

**Qué cuenta como «dato leído»** (`medir.mjs`, `scoreTokens`): cada uno de 4 datos por caso (nombre, apellido, DNI, correo) se busca entre las palabras del OCR y entre 2 o 3 palabras seguidas pegadas; **exacto** = igual tras pasar a minúsculas y quitar tildes, conservando `@ . _ -`. Los caracteres acertados son la longitud menos la mejor distancia de edición. **Las tildes se pierden a veces** (`Maria`, `Perez`): en 5 de las 26 lecturas 4/4 de RB y RC falta una tilde; no cuentan como error acá. Hay un campo `exactoConAcento` en los datos.

**Variantes** (nombres de las columnas):

| Variante | Qué es |
|---|---|
| **A** | OCR de la página entera, como la app (más OSD). |
| **RB** | Región de la figura (cajas del PDF + 5 pt de margen), recortada del raster de 300 ppp, tal cual. |
| **RC** | RB girada por menos el ángulo de la figura (del XML), sobre fondo blanco. En horizontal es igual a RB. |
| **RD** | RB con contraste: todo píxel con luminancia < 248 pasa a negro, el resto a blanco. |
| **RE** | RC con ese mismo contraste. |
| **RF** | (solo páginas con texto) Región de un raster del PDF **sin los bloques `BT … ET`** de la página, girada igual que RC. |
| **RG** | (solo páginas con texto) RB con el texto nativo tapado: dentro de la caja de cada renglón nativo, los píxeles con luminancia < 48, dilatados 2 px, pasan a blanco; girada. |
| **RH** | RG más el contraste de RD. |

## Cómo se ubica la región

**Desde el PDF** (`vectorBoxes` en `medir.mjs`): con `getOperatorList()` de `pdfjs-dist` 4.10.38 se recorren los operadores siguiendo la matriz (`save/restore/transform`, `paintFormXObjectBegin`), y por cada `constructPath` seguido de relleno o trazo se toma la caja que ya trae pdf.js (tercer argumento). Se descartan las cajas de ancho o alto ≤ 0,5 pt y las que ocupan más de la mitad de la página (el recorte de la página). La región es la unión de las que quedan.
- **Cobertura de la tinta: 100 %** en los 50 casos (la tinta de la figura, fuera de las cajas del texto nativo, cae dentro de la región con 5 pt de margen).
- Cuántas cajas salen: **1** (VML sin degradado ni contorno, o DrawingML sin efectos, o la marca de agua), o **64 a 107** (degradado y contorno: LibreOffice parte la figura en trozos). La unión funciona igual.
- Comparación con la caja que sale del XML (la posición y el tamaño de la forma, girada):

| Figura | IoU PDF contra XML | Desvío del centro | Diferencia de tamaño |
|---|---|---|---|
| Marca diagonal (16) | 0,940 a 0,947 | ≤ 1 pt | PDF 3 a 11 pt más chico (la forma es el rectángulo, el PDF es la tinta) |
| Marca horizontal (16) | 0,864 a 0,964 | ≤ 0,1 pt | alto 0,4 a 3,4 pt menor, mismo ancho |
| WordArt DrawingML (8) | 0,973 a 0,998 | ≤ 0,4 pt | ≤ 4 pt |
| WordArt VML (8) | 0,765 (horizontal) y 0,940 (girado) | **3,1 a 3,2 pt en vertical** | alto 6 a 8 pt menor |
| PowerPoint (2) | 0,991 a 0,998 | ≤ 1,4 pt | ≤ 2,7 pt |

**Desde el XML**: la marca de agua del encabezado está centrada en el cuadro de márgenes (centro exacto, calculado con los márgenes de la sección; acá son simétricos) y el WordArt está en una posición absoluta contra la página; ancho, alto y rotación salen de `style` (VML) o de `a:xfrm` (DrawingML). Con esa caja (calculando la caja envolvente de la forma girada) el OCR dio lo mismo que con la del PDF: RB 63 contra 63 datos exactos (50 casos), RC 63 contra 64, RD 65 contra 66, RE 66 contra 64 (los 24 casos girados); 2 de 8 marcas diagonales sobre página vacía cambian de 3 a 4 datos o al revés. **Es una vía igual de exacta, pero necesita abrir el `.docx` y entender `mso-position-*`, `relativeFrom` y los márgenes; la del PDF no.**

**Límites de la vía PDF [NO CONFIRMADO]**: solo se probó una página con una tabla con bordes (los bordes son trazos de grosor cero y el filtro de alto > 0,5 pt los ignora; la región no cambió, IoU 0,94 igual que sin tabla). **No se probó con logos, formas, celdas sombreadas, gráficos ni imágenes vectoriales**: «un trazado relleno sin texto» también es un logo, y una unión de cajas los mezclaría. Tampoco se probó distinguir una marca de agua de otro trazado (un falso positivo solo costaría tiempo de OCR).

## Resultados por caso y por variante

Cada celda es «datos exactos de 4 · caracteres acertados / esperados». Las marcas tienen 37 caracteres esperados; los WordArt, 38 (`María Gómez` lleva 1 más). `= B`: la región es igual a RB (sin giro). `-`: no corresponde. Datos: `medicion.json`, `medicion-texto.json`; imágenes de lo que ve el OCR: `img\<caso>.<variante>.png`.


### Marcas de agua (32)

| Caso | A pág. entera | RB región | RC enderezada | RD contraste | RE ender.+contr. | región (IoU PDF/XML) |
|---|---|---|---|---|---|---|
| wm-diag-claro-G-cal-vacia | 0/4 · 5/37 | 0/4 · 5/37 | 4/4 · 37/37 | 0/4 · 5/37 | 4/4 · 37/37 | 0.94 |
| wm-diag-claro-G-cal-texto | 0/4 · 16/37 | 0/4 · 16/37 | 0/4 · 9/37 | 0/4 · 17/37 | 1/4 · 20/37 | 0.94 |
| wm-diag-claro-G-tnr-vacia | 0/4 · 6/37 | 0/4 · 6/37 | 4/4 · 37/37 | 0/4 · 5/37 | 4/4 · 37/37 | 0.946 |
| wm-diag-claro-G-tnr-texto | 0/4 · 17/37 | 0/4 · 16/37 | 0/4 · 7/37 | 0/4 · 14/37 | 1/4 · 15/37 | 0.946 |
| wm-diag-claro-P-cal-vacia | 0/4 · 4/37 | 0/4 · 4/37 | 4/4 · 37/37 | 0/4 · 5/37 | 4/4 · 37/37 | 0.941 |
| wm-diag-claro-P-cal-texto | 0/4 · 16/37 | 0/4 · 10/37 | 0/4 · 7/37 | 0/4 · 10/37 | 0/4 · 12/37 | 0.941 |
| wm-diag-claro-P-tnr-vacia | 0/4 · 4/37 | 0/4 · 4/37 | 3/4 · 36/37 | 0/4 · 5/37 | 3/4 · 36/37 | 0.947 |
| wm-diag-claro-P-tnr-texto | 0/4 · 16/37 | 0/4 · 10/37 | 0/4 · 5/37 | 0/4 · 10/37 | 0/4 · 19/37 | 0.947 |
| wm-diag-oscuro-G-cal-vacia | 0/4 · 5/37 | 0/4 · 5/37 | 4/4 · 37/37 | 0/4 · 5/37 | 4/4 · 37/37 | 0.94 |
| wm-diag-oscuro-G-cal-texto | 0/4 · 17/37 | 0/4 · 16/37 | 1/4 · 22/37 | 0/4 · 17/37 | 2/4 · 26/37 | 0.94 |
| wm-diag-oscuro-G-tnr-vacia | 0/4 · 4/37 | 0/4 · 4/37 | 4/4 · 37/37 | 0/4 · 2/37 | 4/4 · 37/37 | 0.946 |
| wm-diag-oscuro-G-tnr-texto | 0/4 · 18/37 | 0/4 · 16/37 | 2/4 · 24/37 | 0/4 · 15/37 | 2/4 · 20/37 | 0.946 |
| wm-diag-oscuro-P-cal-vacia | 0/4 · 6/37 | 0/4 · 4/37 | 4/4 · 37/37 | 0/4 · 4/37 | 4/4 · 37/37 | 0.941 |
| wm-diag-oscuro-P-cal-texto | 0/4 · 17/37 | 0/4 · 11/37 | 0/4 · 13/37 | 0/4 · 10/37 | 1/4 · 15/37 | 0.941 |
| wm-diag-oscuro-P-tnr-vacia | 0/4 · 5/37 | 0/4 · 5/37 | 3/4 · 36/37 | 0/4 · 5/37 | 4/4 · 37/37 | 0.947 |
| wm-diag-oscuro-P-tnr-texto | 0/4 · 17/37 | 0/4 · 10/37 | 0/4 · 13/37 | 0/4 · 10/37 | 0/4 · 12/37 | 0.947 |
| wm-hor-claro-G-cal-vacia | 4/4 · 37/37 | 4/4 · 37/37 | = B | 4/4 · 37/37 | - | 0.865 |
| wm-hor-claro-G-cal-texto | 0/4 · 16/37 | 0/4 · 12/37 | = B | 0/4 · 15/37 | - | 0.865 |
| wm-hor-claro-G-tnr-vacia | 4/4 · 37/37 | 4/4 · 37/37 | = B | 4/4 · 37/37 | - | 0.964 |
| wm-hor-claro-G-tnr-texto | 0/4 · 16/37 | 0/4 · 12/37 | = B | 0/4 · 24/37 | - | 0.964 |
| wm-hor-claro-P-cal-vacia | 4/4 · 37/37 | 4/4 · 37/37 | = B | 4/4 · 37/37 | - | 0.864 |
| wm-hor-claro-P-cal-texto | 0/4 · 16/37 | 0/4 · 7/37 | = B | 0/4 · 8/37 | - | 0.864 |
| wm-hor-claro-P-tnr-vacia | 3/4 · 36/37 | 3/4 · 36/37 | = B | 3/4 · 36/37 | - | 0.964 |
| wm-hor-claro-P-tnr-texto | 0/4 · 16/37 | 0/4 · 7/37 | = B | 0/4 · 6/37 | - | 0.964 |
| wm-hor-oscuro-G-cal-vacia | 4/4 · 37/37 | 4/4 · 37/37 | = B | 4/4 · 37/37 | - | 0.865 |
| wm-hor-oscuro-G-cal-texto | 0/4 · 22/37 | 0/4 · 15/37 | = B | 0/4 · 20/37 | - | 0.865 |
| wm-hor-oscuro-G-tnr-vacia | 4/4 · 37/37 | 4/4 · 37/37 | = B | 4/4 · 37/37 | - | 0.964 |
| wm-hor-oscuro-G-tnr-texto | 0/4 · 21/37 | 0/4 · 18/37 | = B | 0/4 · 24/37 | - | 0.964 |
| wm-hor-oscuro-P-cal-vacia | 4/4 · 37/37 | 4/4 · 37/37 | = B | 4/4 · 37/37 | - | 0.864 |
| wm-hor-oscuro-P-cal-texto | 0/4 · 16/37 | 0/4 · 7/37 | = B | 0/4 · 8/37 | - | 0.864 |
| wm-hor-oscuro-P-tnr-vacia | 3/4 · 36/37 | 3/4 · 36/37 | = B | 4/4 · 37/37 | - | 0.964 |
| wm-hor-oscuro-P-tnr-texto | 0/4 · 17/37 | 0/4 · 5/37 | = B | 0/4 · 11/37 | - | 0.964 |

### WordArt de Word (16)

| Caso | A pág. entera | RB región | RC enderezada | RD contraste | RE ender.+contr. | región (IoU PDF/XML) |
|---|---|---|---|---|---|---|
| wa-vml-plano-h | 4/4 · 38/38 | 4/4 · 38/38 | = B | 4/4 · 38/38 | - | 0.765 |
| wa-vml-plano-g | 0/4 · 19/38 | 0/4 · 21/38 | 4/4 · 38/38 | 0/4 · 21/38 | 4/4 · 38/38 | 0.94 |
| wa-vml-degr-h | 4/4 · 38/38 | 4/4 · 38/38 | = B | 4/4 · 38/38 | - | 0.765 |
| wa-vml-degr-g | 0/4 · 13/38 | 0/4 · 21/38 | 4/4 · 38/38 | 0/4 · 20/38 | 4/4 · 38/38 | 0.94 |
| wa-vml-cont-h | 4/4 · 38/38 | 4/4 · 38/38 | = B | 4/4 · 38/38 | - | 0.765 |
| wa-vml-cont-g | 0/4 · 15/38 | 0/4 · 12/38 | 4/4 · 38/38 | 0/4 · 13/38 | 3/4 · 37/38 | 0.94 |
| wa-vml-somb-h | 4/4 · 38/38 | 4/4 · 38/38 | = B | 4/4 · 38/38 | - | 0.765 |
| wa-vml-somb-g | 0/4 · 19/38 | 0/4 · 21/38 | 4/4 · 38/38 | 0/4 · 21/38 | 4/4 · 38/38 | 0.94 |
| wa-dml-plano-h | 4/4 · 38/38 | 4/4 · 38/38 | = B | 4/4 · 38/38 | - | 0.998 |
| wa-dml-plano-g | 0/4 · 16/38 | 0/4 · 15/38 | 4/4 · 38/38 | 0/4 · 13/38 | 4/4 · 38/38 | 0.973 |
| wa-dml-degr-h | 4/4 · 38/38 | 4/4 · 38/38 | = B | 4/4 · 38/38 | - | 0.998 |
| wa-dml-degr-g | 0/4 · 16/38 | 0/4 · 14/38 | 4/4 · 38/38 | 0/4 · 14/38 | 4/4 · 38/38 | 0.973 |
| wa-dml-cont-h | 2/4 · 34/38 | 2/4 · 34/38 | = B | 3/4 · 33/38 | - | 0.998 |
| wa-dml-cont-g | 0/4 · 11/38 | 0/4 · 10/38 | 2/4 · 34/38 | 0/4 · 11/38 | 1/4 · 27/38 | 0.973 |
| wa-dml-somb-h | 4/4 · 38/38 | 4/4 · 38/38 | = B | 4/4 · 38/38 | - | 0.998 |
| wa-dml-somb-g | 0/4 · 16/38 | 0/4 · 15/38 | 4/4 · 38/38 | 0/4 · 13/38 | 4/4 · 38/38 | 0.973 |

### WordArt de PowerPoint (2)

| Caso | A pág. entera | RB región | RC enderezada | RD contraste | RE ender.+contr. | región (IoU PDF/XML) |
|---|---|---|---|---|---|---|
| pp-wordart-horiz | 3/4 · 35/37 | 3/4 · 35/37 | = B | 3/4 · 36/37 | - | 0.998 |
| pp-wordart-vert | 0/4 · 0/37 | 0/4 · 0/37 | = B | 0/4 · 0/37 | - | 0.991 |

### Tiempos (ms por llamada de OCR)

| Caso | A | RB | RC | RD | RE | raster |
|---|---|---|---|---|---|---|
| wm-diag-claro-G-cal-vacia | 644 | 246 | 312 | 258 | 305 | 21 |
| wm-diag-claro-G-cal-texto | 2408 | 1200 | 1558 | 1295 | 1359 | 31 |
| wm-diag-claro-G-tnr-vacia | 612 | 244 | 304 | 226 | 296 | 26 |
| wm-diag-claro-G-tnr-texto | 2456 | 1343 | 1482 | 1249 | 1333 | 30 |
| wm-diag-claro-P-cal-vacia | 592 | 175 | 163 | 160 | 144 | 20 |
| wm-diag-claro-P-cal-texto | 2399 | 300 | 424 | 313 | 424 | 26 |
| wm-diag-claro-P-tnr-vacia | 587 | 127 | 98 | 135 | 97 | 10 |
| wm-diag-claro-P-tnr-texto | 2389 | 305 | 434 | 357 | 408 | 24 |
| wm-diag-oscuro-G-cal-vacia | 617 | 272 | 307 | 246 | 290 | 11 |
| wm-diag-oscuro-G-cal-texto | 2571 | 1247 | 1551 | 1292 | 1309 | 22 |
| wm-diag-oscuro-G-tnr-vacia | 599 | 243 | 316 | 216 | 298 | 5 |
| wm-diag-oscuro-G-tnr-texto | 2371 | 1303 | 1423 | 1257 | 1334 | 26 |
| wm-diag-oscuro-P-cal-vacia | 570 | 155 | 153 | 151 | 145 | 9 |
| wm-diag-oscuro-P-cal-texto | 2481 | 344 | 468 | 310 | 410 | 16 |
| wm-diag-oscuro-P-tnr-vacia | 559 | 133 | 144 | 129 | 148 | 9 |
| wm-diag-oscuro-P-tnr-texto | 2421 | 344 | 474 | 339 | 394 | 26 |
| wm-hor-claro-G-cal-vacia | 571 | 132 | - | 127 | - | 18 |
| wm-hor-claro-G-cal-texto | 2416 | 137 | - | 168 | - | 22 |
| wm-hor-claro-G-tnr-vacia | 559 | 126 | - | 125 | - | 10 |
| wm-hor-claro-G-tnr-texto | 2425 | 130 | - | 120 | - | 18 |
| wm-hor-claro-P-cal-vacia | 542 | 136 | - | 116 | - | 14 |
| wm-hor-claro-P-cal-texto | 2433 | 123 | - | 153 | - | 37 |
| wm-hor-claro-P-tnr-vacia | 507 | 54 | - | 112 | - | 13 |
| wm-hor-claro-P-tnr-texto | 2444 | 64 | - | 145 | - | 20 |
| wm-hor-oscuro-G-cal-vacia | 561 | 144 | - | 139 | - | 15 |
| wm-hor-oscuro-G-cal-texto | 2542 | 195 | - | 175 | - | 17 |
| wm-hor-oscuro-G-tnr-vacia | 564 | 136 | - | 123 | - | 7 |
| wm-hor-oscuro-G-tnr-texto | 2500 | 138 | - | 123 | - | 15 |
| wm-hor-oscuro-P-cal-vacia | 551 | 108 | - | 105 | - | 4 |
| wm-hor-oscuro-P-cal-texto | 2589 | 148 | - | 152 | - | 18 |
| wm-hor-oscuro-P-tnr-vacia | 504 | 54 | - | 95 | - | 7 |
| wm-hor-oscuro-P-tnr-texto | 2540 | 164 | - | 140 | - | 19 |
| wa-vml-plano-h | 821 | 144 | - | 140 | - | 10 |
| wa-vml-plano-g | 818 | 183 | 267 | 221 | 250 | 9 |
| wa-vml-degr-h | 826 | 146 | - | 171 | - | 17 |
| wa-vml-degr-g | 832 | 224 | 270 | 192 | 254 | 13 |
| wa-vml-cont-h | 837 | 153 | - | 134 | - | 20 |
| wa-vml-cont-g | 841 | 187 | 279 | 171 | 244 | 22 |
| wa-vml-somb-h | 817 | 144 | - | 147 | - | 18 |
| wa-vml-somb-g | 827 | 196 | 258 | 213 | 251 | 13 |
| wa-dml-plano-h | 815 | 138 | - | 131 | - | 20 |
| wa-dml-plano-g | 823 | 197 | 256 | 183 | 234 | 10 |
| wa-dml-degr-h | 817 | 136 | - | 122 | - | 14 |
| wa-dml-degr-g | 803 | 206 | 249 | 197 | 250 | 16 |
| wa-dml-cont-h | 816 | 141 | - | 106 | - | 21 |
| wa-dml-cont-g | 798 | 209 | 272 | 193 | 241 | 18 |
| wa-dml-somb-h | 800 | 127 | - | 120 | - | 14 |
| wa-dml-somb-g | 848 | 200 | 256 | 192 | 241 | 13 |
| pp-wordart-horiz | 323 | 119 | - | 157 | - | 9 |
| pp-wordart-vert | 373 | 111 | - | 62 | - | 10 |

### Resumen por grupo (casos con los 4 datos exactos / casos; caracteres acertados / esperados)

| Grupo | casos | A | RB | RC | RD | RE |
|---|---|---|---|---|---|---|
| marcas (todas) | 32 | 6/32 · 51 % | 6/32 · 44 % | 12/32 · 65 % | 7/32 · 46 % | 14/32 · 71 % |
| marcas diagonal | 16 | 0/16 · 29 % | 0/16 · 24 % | 6/16 · 67 % | 0/16 · 23 % | 7/16 · 73 % |
| marcas horizontal | 16 | 6/16 · 73 % | 6/16 · 64 % | 6/16 · 64 % | 7/16 · 69 % | 7/16 · 69 % |
| marcas claro | 16 | 3/16 · 50 % | 3/16 · 43 % | 6/16 · 61 % | 3/16 · 46 % | 6/16 · 70 % |
| marcas oscuro | 16 | 3/16 · 53 % | 3/16 · 44 % | 6/16 · 69 % | 4/16 · 47 % | 8/16 · 73 % |
| marcas G | 16 | 4/16 · 53 % | 4/16 · 49 % | 8/16 · 70 % | 4/16 · 53 % | 8/16 · 78 % |
| marcas P | 16 | 2/16 · 50 % | 2/16 · 39 % | 4/16 · 60 % | 3/16 · 40 % | 6/16 · 65 % |
| marcas Calibri | 16 | 4/16 · 51 % | 4/16 · 44 % | 8/16 · 66 % | 4/16 · 46 % | 8/16 · 71 % |
| marcas Times | 16 | 2/16 · 51 % | 2/16 · 44 % | 4/16 · 65 % | 3/16 · 47 % | 6/16 · 72 % |
| marcas sobre página vacía | 16 | 6/16 · 56 % | 6/16 · 56 % | 12/16 · 99 % | 7/16 · 56 % | 14/16 · 100 % |
| marcas sobre página con texto | 16 | 0/16 · 46 % | 0/16 · 32 % | 0/16 · 31 % | 0/16 · 37 % | 0/16 · 43 % |
| WordArt VML | 8 | 4/8 · 72 % | 4/8 · 75 % | 8/8 · 100 % | 4/8 · 75 % | 7/8 · 100 % |
| WordArt DrawingML | 8 | 3/8 · 68 % | 3/8 · 66 % | 6/8 · 97 % | 3/8 · 65 % | 6/8 · 95 % |
| WordArt horizontal | 8 | 7/8 · 99 % | 7/8 · 99 % | 7/8 · 99 % | 7/8 · 98 % | 7/8 · 98 % |
| WordArt girado | 8 | 0/8 · 41 % | 0/8 · 42 % | 7/8 · 99 % | 0/8 · 41 % | 6/8 · 96 % |
| WordArt plano | 4 | 2/4 · 73 % | 2/4 · 74 % | 4/4 · 100 % | 2/4 · 72 % | 4/4 · 100 % |
| WordArt degr | 4 | 2/4 · 69 % | 2/4 · 73 % | 4/4 · 100 % | 2/4 · 72 % | 4/4 · 100 % |
| WordArt cont | 4 | 1/4 · 64 % | 1/4 · 62 % | 2/4 · 95 % | 1/4 · 63 % | 1/4 · 89 % |
| WordArt somb | 4 | 2/4 · 73 % | 2/4 · 74 % | 4/4 · 100 % | 2/4 · 72 % | 4/4 · 100 % |
| PowerPoint | 2 | 0/2 · 47 % | 0/2 · 47 % | 0/2 · 47 % | 0/2 · 49 % | 0/2 · 49 % |

### Páginas con texto nativo: variantes que sacan el texto nativo de la región

| Caso | A pág. entera | RC enderezada | RF sin texto nativo | RG máscara de tinta oscura | RH máscara + contraste |
|---|---|---|---|---|---|
| wm-diag-claro-G-cal-texto | 0/4 · 16/37 | 0/4 · 9/37 | 4/4 · 37/37 | 2/4 · 31/37 | 2/4 · 32/37 |
| wm-diag-claro-G-tnr-texto | 0/4 · 17/37 | 0/4 · 7/37 | 4/4 · 37/37 | 3/4 · 34/37 | 2/4 · 32/37 |
| wm-diag-claro-P-cal-texto | 0/4 · 16/37 | 0/4 · 7/37 | 4/4 · 37/37 | 1/4 · 28/37 | 1/4 · 29/37 |
| wm-diag-claro-P-tnr-texto | 0/4 · 16/37 | 0/4 · 5/37 | 3/4 · 36/37 | 1/4 · 29/37 | 1/4 · 28/37 |
| wm-diag-oscuro-G-cal-texto | 0/4 · 17/37 | 1/4 · 22/37 | 4/4 · 37/37 | 2/4 · 32/37 | 2/4 · 32/37 |
| wm-diag-oscuro-G-tnr-texto | 0/4 · 18/37 | 2/4 · 24/37 | 4/4 · 37/37 | 2/4 · 32/37 | 2/4 · 32/37 |
| wm-diag-oscuro-P-cal-texto | 0/4 · 17/37 | 0/4 · 13/37 | 4/4 · 37/37 | 1/4 · 28/37 | 1/4 · 28/37 |
| wm-diag-oscuro-P-tnr-texto | 0/4 · 17/37 | 0/4 · 13/37 | 3/4 · 36/37 | 1/4 · 29/37 | 1/4 · 28/37 |
| wm-hor-claro-G-cal-texto | 0/4 · 16/37 | 0/4 · 12/37 | 4/4 · 37/37 | 1/4 · 29/37 | 2/4 · 32/37 |
| wm-hor-claro-G-tnr-texto | 0/4 · 16/37 | 0/4 · 12/37 | 4/4 · 37/37 | 2/4 · 31/37 | 2/4 · 33/37 |
| wm-hor-claro-P-cal-texto | 0/4 · 16/37 | 0/4 · 7/37 | 4/4 · 37/37 | 2/4 · 35/37 | 3/4 · 34/37 |
| wm-hor-claro-P-tnr-texto | 0/4 · 16/37 | 0/4 · 7/37 | 3/4 · 36/37 | 3/4 · 34/37 | 3/4 · 34/37 |
| wm-hor-oscuro-G-cal-texto | 0/4 · 22/37 | 0/4 · 15/37 | 4/4 · 37/37 | 1/4 · 27/37 | 1/4 · 30/37 |
| wm-hor-oscuro-G-tnr-texto | 0/4 · 21/37 | 0/4 · 18/37 | 4/4 · 37/37 | 0/4 · 22/37 | 1/4 · 28/37 |
| wm-hor-oscuro-P-cal-texto | 0/4 · 16/37 | 0/4 · 7/37 | 4/4 · 37/37 | 3/4 · 36/37 | 3/4 · 36/37 |
| wm-hor-oscuro-P-tnr-texto | 0/4 · 17/37 | 0/4 · 5/37 | 3/4 · 36/37 | 2/4 · 33/37 | 3/4 · 34/37 |

| Grupo | A | RC | RF | RG | RH |
|---|---|---|---|---|---|
| todas (16) | 0/16 · 46 % | 0/16 · 31 % | 12/16 · 99 % | 0/16 · 83 % | 0/16 · 85 % |
| diagonal (8) | 0/8 · 45 % | 0/8 · 34 % | 6/8 · 99 % | 0/8 · 82 % | 0/8 · 81 % |
| horizontal (8) | 0/8 · 47 % | 0/8 · 28 % | 6/8 · 99 % | 0/8 · 83 % | 0/8 · 88 % |
| claro (8) | 0/8 · 44 % | 0/8 · 22 % | 6/8 · 99 % | 0/8 · 85 % | 0/8 · 86 % |
| oscuro (8) | 0/8 · 49 % | 0/8 · 40 % | 6/8 · 99 % | 0/8 · 81 % | 0/8 · 84 % |
| G (8) | 0/8 · 48 % | 0/8 · 40 % | 8/8 · 100 % | 0/8 · 80 % | 0/8 · 85 % |
| P (8) | 0/8 · 44 % | 0/8 · 22 % | 4/8 · 99 % | 0/8 · 85 % | 0/8 · 85 % |

### Tiempos de OCR (ms, mediana con mín y máx)

| Grupo | A pág. entera | RB región | RC enderezada | RD contraste | RE ender.+contr. |
|---|---|---|---|---|---|
| marcas, página vacía, diagonal | 599 (mín 559, máx 644) | 243 (mín 127, máx 272) | 304 (mín 98, máx 316) | 216 (mín 129, máx 258) | 290 (mín 97, máx 305) |
| marcas, página vacía, horizontal | 559 (mín 504, máx 571) | 132 (mín 54, máx 144) | - | 123 (mín 95, máx 139) | - |
| marcas, página con texto, diagonal | 2421 (mín 2371, máx 2571) | 1200 (mín 300, máx 1343) | 1423 (mín 424, máx 1558) | 1249 (mín 310, máx 1295) | 1309 (mín 394, máx 1359) |
| marcas, página con texto, horizontal | 2500 (mín 2416, máx 2589) | 138 (mín 64, máx 195) | - | 152 (mín 120, máx 175) | - |
| WordArt (con 3 renglones de texto) | 821 (mín 798, máx 848) | 183 (mín 127, máx 224) | 267 (mín 249, máx 279) | 171 (mín 106, máx 221) | 250 (mín 234, máx 254) |
| PowerPoint (sin texto nativo) | 373 (mín 323, máx 373) | 119 (mín 111, máx 119) | - | 157 (mín 62, máx 157) | - |

RF / RG / RH (páginas con texto, 16 casos): RF 134 (mín 54, máx 348); RG 145 (mín 90, máx 302); RH 146 (mín 86, máx 298)

## Lo que deja el OCR de la página entera sobre el texto normal

Se midió en las 16 marcas sobre página con texto (14 párrafos, unas 220 palabras nativas por página). Cada palabra del OCR se clasifica por dónde cae su centro:
- **sobre texto nativo, igual** a una palabra de ese renglón: es una **duplicada** (el OCR vuelve a leer lo que ya está en el texto nativo);
- **sobre texto nativo, distinta**: es una palabra **estropeada o mezclada** con lo que el texto nativo dice distinto;
- **fuera del texto nativo y que no se parece a ninguna palabra de la figura**: **basura**.

| Marca | Páginas | Palabras de OCR | Duplicadas | Estropeadas | Basura fuera |
|---|---|---|---|---|---|
| clara (8) | 8 | 1 760 | 1 753 | 7 | 0 |
| oscura (8) | 8 | 1 745 | 1 647 | 73 | 15 |
| diagonal (8) | 8 | 1 784 | 1 714 | 45 | 15 |
| horizontal (8) | 8 | 1 721 | 1 686 | 35 | 0 |

- Con marca **clara** casi no pasa nada: 7 palabras estropeadas en 8 páginas, y casi todas son el mismo correo nativo (`cmedina@ejemplo.net` sale `cmedina(Dejemplo.net`; la misma letra `@` que falla en la figura).
- Con marca **oscura** (#404040) que cruza el texto sí hay ruido: de 5 a 16 palabras estropeadas por página (`ordinarigs`, `subsistir`, `ugilfuier`, `tenóp`, fragmentos de una letra) y, en la diagonal, de 2 a 6 palabras basura fuera del texto (`No`, `ciales`, `IN`, `Q-`). **Son palabras que caen sobre texto nativo**: si el sistema descarta lo que el OCR lee encima de una palabra nativa, desaparecen; si las mezcla, aparecen palabras que el documento no tiene.
- **Ninguna página giró por OSD**, así que el texto nativo se leyó en su orientación.
- El OCR **no leyó la marca de agua** en ninguna de estas 16 páginas (0 de 16 datos).

Páginas de WordArt (3 renglones de texto nativo y el WordArt en el medio, sin cruzarse): en horizontal, 0 palabras basura (salvo el DrawingML con contorno, 4: `27,054,321`, `mgomezQ`, `ejemplo.`, `org`, que son el WordArt mal leído). **En girado, de 5 a 10 fragmentos basura por página**, que son el WordArt leído a pedazos y deformado (`Marg,`, `Come,`, `oy`, `7.65,`, `4.32;`, `Map`, `Gr;`, `4321`): no coinciden con el dato real, pero parecen datos a medias.

## Tiempos

Tablas arriba (por caso) y abajo (por grupo). Resumen: la página entera cuesta **~0,6 s** (vacía), **~0,8 s** (3 renglones), **~2,4-2,6 s** (página de texto, 14 párrafos). La región cuesta **54-348 ms** si no trae texto (RF: mediana 134), y **hasta 1,5 s** si es grande (diagonal G) y trae texto nativo encima, porque entonces Tesseract además lee el texto. Rasterizar la página a 300 ppp con pdf.js en Node tardó 4-37 ms (las páginas casi vacías). **No se midió** el costo de producir el raster sin texto (RF) ni el de leer el operator list **[NO CONFIRMADO]**: RF se armó reescribiendo el PDF.

## Cómo se obtuvo RF (y qué significa para la app)

`pdfjs-dist` 4.10.38 **no** tiene una opción para dibujar sin las operaciones de texto (no existe `operationsFilter`; probé a mutar la lista de operadores de la página y el render la ignora, porque usa otra lista). Para el spike reescribí el PDF con `pdf-lib` 1.17.1 (está en el `node_modules` del repo) quitando los bloques `BT … ET` del flujo de contenido de la página y rasterizando ese PDF. En las páginas con 14 párrafos quitó 28 bloques de texto.
- **[NO CONFIRMADO]** si `pdf-lib` es una dependencia de la app o haría falta un ADR (R-12).
- **[NO CONFIRMADO]** que sirva con PDF de otros orígenes: no se probó con texto dentro de objetos de formulario (Form XObject) ni con PDF que no sean de LibreOffice. Aquí todo el texto estaba en el flujo de la página.
- El texto nativo del PDF ya lo conoce la app (cajas y palabras): una alternativa sin reescribir el PDF es tapar, **pixel a pixel**, solo la tinta del texto nativo. Eso es RG/RH y **no alcanza** (0 de 16 datos; 83-85 % de caracteres): la tinta del texto cruza la de la marca, los bordes suavizados quedan, y el `@` y los puntos se pierden.

## Contraste

RD (contraste sobre la región tal cual) da 7 de 32 marcas con los 4 datos contra 6 de 32 de RB. RE (enderezada con contraste) contra RC: gana un caso (marca oscura P Times diagonal, 3 a 4 de 4) y pierde dos (WordArt VML con contorno, 4 a 3 de 4; WordArt DrawingML con contorno, 2 a 1). **No es concluyente** (n pequeño) y no justifica el paso. El gris claro semitransparente se lee igual que el gris oscuro.

## Lo que quedó sin medir

- **[NO CONFIRMADO]** Archivos guardados por Word. Todo el corpus se armó a mano en XML. Falta confirmar con marcas de agua reales hechas por Word (tamaños, `mc:Fallback`, `o:gfxdata`, marcas de imagen) y con WordArt de distintas versiones.
- **[NO CONFIRMADO]** WordArt con **deformación** (`prstTxWarp` distinto de `textPlain`: ola, arco, círculo; `fitpath` curvo en VML). Solo se midió `textPlain`, que es lineal. Una línea curva rompe tanto el giro como la región rectangular.
- **[NO CONFIRMADO]** Ángulos distintos de −45° y 20° y texto vertical. El giro de 90° y `wordArtVert` de PowerPoint: este último no lo dibuja legible el conversor (0 de 37 caracteres), así que quedó fuera del problema del OCR.
- **[NO CONFIRMADO]** Marcas de agua **de imagen** (WordArt convertido a imagen, o un PNG): no son de este spike.
- **[NO CONFIRMADO]** Marca de agua de texto con **varios renglones** (una marca de Word de dos líneas), con **letras sueltas** (`C O N F I D E N C I A L`), o con texto en mayúsculas. Los datos eran una sola línea de 44 caracteres.
- **[NO CONFIRMADO]** Marcas **más chicas** que 10 pt o más grandes que 19 pt de cuerpo. La de 10 pt (Times) ya fue la que más falló en el correo.
- **[NO CONFIRMADO]** Otros contenidos vectoriales en la página (logos, formas, tablas con relleno, gráficos): la región por unión de cajas los incluiría. Solo se probó una tabla con bordes.
- **[NO CONFIRMADO]** Documentos de varias páginas: el encabezado con la marca se repite en cada página (una región por página), y el costo por página se suma. No se midió.
- **[NO CONFIRMADO]** Tiempos dentro del Worker de la app empaquetada; las cuatro pasadas rotadas de los márgenes (ADR-121) de la página entera; el costo del `pdf-lib` / lectura del operator list.
- **[NO CONFIRMADO]** Cuántos de los falsos positivos de basura pasarían el filtro de detección (el spike no corrió el detector sobre las palabras).
- **[NO CONFIRMADO]** Rotación de 180° (texto cabeza abajo): los ejes principales no distinguen 0° de 180°.
- Una sola corrida por variante y caso (los tiempos tienen el ruido de una corrida; la calidad es determinista).

## Archivos

- Código: `harness\ocr-marcas\` — `gen.cjs` (corpus), `gen-extra.cjs` (caso con tabla), `lib.mjs` (pdf.js y raster), `medir.mjs` (todas las variantes; `--extra 1` corre RF/RG/RH), `tablas.mjs` y `tablas2.mjs` (tablas), `angulo.mjs` (sensibilidad al ángulo y ángulo estimado), `ops.mjs` y `peek.mjs` (inspección).
- Corpus: `corpus-ocr-marcas\` (51 archivos y `manifest.json`, `manifest-extra.json`).
- Datos: `results\ocr-marcas\medicion.json` (A, RB, RC, RD, RE y las variantes con la región del XML, XB a XE), `medicion-texto.json` (RF, RG, RH), `medicion-extra-*.json` (caso con tabla), `angulo.json`, `tablas.md`, `tablas-texto.md`; PDF convertidos en `raw\pdf-lowa-recC\`; imágenes que ve el OCR en `img\` (`<caso>.A|RB|RC|RD|RE|RF|RG|RH|XB…XE.png`).
- Comandos:

```
node harness/ocr-marcas/gen.cjs corpus-ocr-marcas
node harness/batch-run.mjs --name lowa-recC --assets ../artefactos/rec-C --variant strict --host worker --tagged false --dir ../corpus-ocr-marcas --out ../results/ocr-marcas/raw
node harness/ocr-marcas/medir.mjs                       # medicion.json
node harness/ocr-marcas/medir.mjs --extra 1 --only "texto$"   # medicion-texto.json
node harness/ocr-marcas/angulo.mjs
```
