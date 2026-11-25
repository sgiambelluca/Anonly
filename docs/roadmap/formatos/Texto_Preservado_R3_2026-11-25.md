> Informe del implementador del spike, ronda 3, copiado sin cambios. El resumen y lo que decide están en `Plan_1.2.md` §8.10.

# PDF con texto preservado (`pdf-text`): ronda 3

Fecha: 2026-11-25. Repo sin tocar. Código en `C:\Anonly\spikes\texto-preservado\harness\r3\` y datos en `...\results\r3\`. Reusa el arnés de las rondas 1 y 2 (`TEXTO_PRESERVADO.md`, `TEXTO_PRESERVADO_R2.md`).

**Sin documentos reales**: no había ninguna variable `ANONLY_REAL_DOC_*` definida. Todo es sintético.

## Resumen (los números que deciden)

1. **Escaneo con capa buena**: los detectores reales sobre la capa dan 677/677 datos plantados (100 %). Sobre el OCR de la imagen dan 630/677 (93,1 %). Toda la diferencia es el correo: OCR 62/107 (58 %), porque lee mal la `@` (`(V`, `(W`, `M`, `Y`). DNI 112/112, CUIT 80/81, teléfono 102/103, nombres 274/274 con OCR. Con la capa buena no se pierde nada.
2. **Capa mala**: con ≈ 5 % de caracteres con error (CER 0,047 leído por el PdfEngine) la capa detecta 526/677 (77,7 %); con ≈ 15 % (CER 0,140), 304/677 (44,9 %). El OCR de la imagen (CER 0,002 sobre este texto) detecta 93,1 % en las mismas páginas. «Detecta» = el tipo correcto cubre ≥ 50 % de la caja del dato. Con el **valor exacto**, la capa mala da 45,1 % (5 %) y 9,9 % (15 %).
3. **Solo patrones** (DNI, CUIT, correo, teléfono; 403 datos): capa buena 100 %, mala 5 % 65,3 %, mala 15 % 29,3 %, falsa 1,5 %, OCR 88,3 %. El NER (nombres, 274) aguanta mejor el ruido: 263/274 (96,0 %) con 5 % y 186/274 (67,9 %) con 15 %, pero con el valor exacto solo 121 y 29.
4. **Capa falsa**: detecta 26/677 datos reales (3,8 %, casi todo por azar de caja) y produce **627 detecciones de los tipos plantados sobre texto que no es el de la imagen** (DNI 134, correo 102, teléfono 81, CUIT 63, nombres 247). En buena y en OCR, las falsas de esos tipos son 44 (distractores numéricos y 8 nombres del NER).
5. **Costo de leer con OCR en vez de usar la capa**: 4,05 s por página (mediana 4,08; mín. 3,53; máx. 4,62; A4 a 300 dpi, ≈ 322 palabras, tesseract.js `spa+eng` en Node). Los detectores cuestan igual con cualquier fuente: patrones 0,3 ms y NER 120-195 ms por página (ONNX en Node, no WASM de la app).
6. **Palabra invisible que pisa texto visible**: V deja pasar la palabra desde un solape real de 25 %: **24/42** páginas trampa con fuga (0/18 con solape ≤ 10 %; 6/6 en cada bin ≥ 25 %, en las tres formas de invisibilidad y con fondo claro y oscuro). La regla del **área exclusiva** da 0/42 fugas con cualquier mínimo (0, 25, 50, 75, 90 %). La guarda de solape ≥ 1 % da 0/42 y la de ≥ 25 % da 6/42 (el bin de 24,7 %, un punto bajo el umbral).
7. **Palabras legítimas perdidas** (13.864 palabras de 239 páginas nativas; V conserva 13.748): guarda ≥ 1 % pierde 212 (1,53 %, 19 páginas); ≥ 25 %, 51 (0,37 %, 11 páginas); **área exclusiva > 0: 17 (0,12 %, 3 páginas)**; exclusiva ≥ 25 %: 24 (0,17 %); ≥ 50 %: 33 (0,24 %, 6 páginas); ≥ 75 %: 78 (0,56 %); ≥ 90 %: 160 (1,15 %). Las 15 palabras escondidas conocidas del corpus no pasan con ninguna regla.
8. **La palabra visible tapada por la invisible**: la guarda ≥ 1 % también tira la palabra visible con la que se solapa (42/42 páginas). La exclusiva > 0 la conserva en 42/42; con mínimo de 90 % la pierde en 18/42.

## 1. Detección sobre un escaneo con capa invisible

### Qué se armó

- **40 páginas** A4 (595 × 842 pt) a 300 dpi: texto propio dibujado con canvas palabra por palabra (verdad exacta de palabras y cajas), 5 tipografías (Arial, Times New Roman, Calibri, Verdana, Georgia; 9,5-12 pt), grises, ruido gaussiano ±12, JPEG q80. 313-351 palabras por página (sin rotación ni inclinación). Código: `gen-pages.mjs`.
- **677 datos plantados**: nombres 274 (de 2 o 3 palabras), DNI 112 (con puntos o sin ellos), CUIT 81 (con dígito verificador válido), correo 107, teléfono 103 (`11 nnnn-nnnn`, `011 …`, `+54 9 11 …`). Cada tipo tiene más de 80 datos y cada tipo de capa pasa por las 40 páginas.
- **Distractores** que existen en toda página y no son datos plantados: importes (`$ 1.250.000,00`), fechas, expedientes, lugares y organismos. Producen detecciones «de más» iguales en todas las fuentes.
- **Cuatro capas** por página (mismas imágenes), escritas con la fuente F2 de la ronda 1 (`Tr 3`) y **releídas con el PdfEngine real** (`requiresOCR = false` en las 160):
  - **buena**: el texto exacto de la imagen (CER 0,000 leído).
  - **mala 5 %**: errores por carácter (45 % de sustitución por confusión de OCR, 15 % sustitución al azar, 20 % borrado, 20 % inserción) más uniones y particiones de palabra (10 % de las ediciones cada una). Se calibró el factor hasta CER 0,047 leído (0,050 planeado).
  - **mala 15 %**: lo mismo, CER 0,140 leído (0,150 planeado). El PdfEngine devuelve 309,3 y 285,8 palabras por página, de 321,9 en la imagen.
  - **falsa**: el texto de la página siguiente (token por token) sobre las cajas de esta (CER 0,737 contra el texto de la imagen). Lleva sus propios DNI, correos y nombres.
- **OCR de la app** sobre la imagen: la página del PDF con capa buena se renderiza con pdfjs a 300 dpi y se lee con tesseract.js `spa+eng`, PSM `SPARSE_TEXT`, `user_defined_dpi` 300 (igual que el `ocr-engine` y que la ronda 1). Las palabras pasan por el `fuseOcrPage` real del PdfEngine (orden de lectura, NFC). CER del texto del OCR contra la imagen: 0,002; 323,4 palabras de 321,9.
- **Detectores reales, empaquetados con esbuild sin tocar el repo**: `regex-engine` (catálogo AR por defecto) y `ner-engine` (modelo `Xenova/bert-base-multilingual-cased-ner-hrl` cuantizado q8 que está en `apps/react-client/public/models/ner`; corre en Node con `onnxruntime-node`, sin bajar nada). El único cambio al empaquetar: la ruta de modelos del kernel NER (`/models/ner/` → ruta del disco), reescrita al cargar. Config por defecto de la app (`confidenceThreshold` 0,7, `batchSize` 256). 0 errores del NER en las 200 corridas. Código: `build-detectors.mjs`, `lib-det.mjs`, `stage-layers.mjs`, `stage-detect.mjs`.

### Criterio de acierto

- **Detectado** = alguna ocurrencia del tipo correcto cubre ≥ 50 % del área de las cajas del dato plantado (las del dibujado). Es lo que tapa el lugar correcto en la imagen.
- **Exacto** = además el valor es el plantado (sin acentos ni signos; en nombres, el valor de la ocurrencia lo contiene). Es lo que agrupa y reemplaza bien.
- **Falsa detección** = ocurrencia que no toca ninguna caja de dato plantado. Se separan los tipos plantados (DNI, CUIT, correo, teléfono, nombre) de los demás (fecha, organización, dirección).

### Recall por fuente y tipo (detectado / plantados; entre paréntesis, exacto)

| Fuente | Total | Nombre (274) | DNI (112) | CUIT (81) | Correo (107) | Teléfono (103) |
|---|---|---|---|---|---|---|
| Capa buena | **677 (99,7 % exacto)** | 274 (272) | 112 (112) | 81 (81) | 107 (107) | 103 (103) |
| Capa mala 5 % | **526 = 77,7 %** (exacto 45,1 %) | 263 (121) | 73 (64) | 40 (40) | 92 (28) | 58 (52) |
| Capa mala 15 % | **304 = 44,9 %** (exacto 9,9 %) | 186 (29) | 25 (17) | 8 (8) | 67 (0) | 18 (13) |
| Capa falsa | **26 = 3,8 %** (exacto 0 %) | 20 (0) | 1 (0) | 1 (0) | 0 (0) | 4 (0) |
| OCR de la imagen | **630 = 93,1 %** (exacto 92,3 %) | 274 (273) | 112 (112) | 80 (80) | 62 (58) | 102 (102) |

- Solo patrones (sin el NER, 403 datos): buena 403 (100 %), mala 5 % 263 (65,3 %), mala 15 % 118 (29,3 %), falsa 6 (1,5 %), OCR 356 (88,3 %). Detecciones de cualquier tipo sobre el dato (tapar el lugar aunque el tipo sea otro): buena 100 %, mala 5 % 80,5 %, mala 15 % 49,9 %, falsa 19,8 %, OCR 93,8 %.
- **Por qué el OCR pierde correos**: lee la `@` como `(V`, `(W`, `M`, `Y` o la rompe. 45 de 107 correos, por tipografía: Arial 19/20 bien, Georgia 14/21, Verdana 12/23, Calibri 10/23, Times New Roman 7/20. Es la única pérdida de importancia del OCR en estas páginas. Sin diagnosticar si cambia con otra resolución o con otro PSM.
- **Por qué la capa mala todavía detecta nombres**: el NER los reconoce aunque haya una letra mal; el valor ya no es el plantado (por eso 121/263 exactos con 5 %). Las ocurrencias de la capa mala cubren el lugar pero el texto agrupado o el reemplazo sintético parten de un valor con errores.
- **Dato que rompe la capa mala**: DNI y CUIT se pierden con un solo carácter mal (DNI 73/112 con 5 %; CUIT 40/81); correo y nombre siguen cubriendo la caja con algún carácter mal.

### Falsas detecciones (todas las ocurrencias; sin contar las que tocan un dato plantado)

| Fuente | Tipos plantados (DNI/CUIT/correo/tel./nombre) | Otras (fecha/organización/dirección) | Sobre un dato, con otro tipo | Total ocurrencias |
|---|---|---|---|---|
| Capa buena | 44 (DNI 36, nombre 8) | 419 (106/207/106) | 1 | 1.143 |
| Capa mala 5 % | 31 (DNI 24, nombre 7) | 383 (59/216/108) | 19 | 972 |
| Capa mala 15 % | 19 (DNI 10, nombre 9) | 245 (19/150/76) | 49 | 652 |
| Capa falsa | **627** (DNI 134, correo 102, tel. 81, CUIT 63, nombre 247) | 334 (83/159/92) | 141 | 1.135 |
| OCR de la imagen | 44 (DNI 36, nombre 8) | 419 (106/207/106) | 13 | 1.107 |

- Los 36 DNI «de más» en buena y OCR son, muy probablemente, los importes de los distractores (`$ 1.250.000`; no se verificó uno por uno). Los nombres «de más» son del NER (8 en 40 páginas).
- Las falsas de la capa mala bajan, probablemente porque los errores rompen también los distractores (no verificado).
- «Falsas» de la capa falsa son detecciones sobre datos que existen en la capa pero no en la imagen: tapan texto que no está donde se pone la tapa, y los datos de la imagen quedan sin tapar (recall 3,8 %).

### Tiempo

| | Por página (media) |
|---|---|
| OCR de la imagen (300 dpi, A4, ≈ 322 palabras) | **4.046 ms** (mediana 4.079; mín. 3.528; máx. 4.618) |
| Patrones (regex-engine) | 0,2-0,3 ms con cualquier fuente |
| NER (ner-engine, q8, Node) | 121 ms (buena, falsa, OCR), 166 ms (mala 5 %), 194 ms (mala 15 %) |

- El costo del OCR al importar es de ≈ 4 s por página sobre una capa que ya existe y que la app lee en milisegundos. No se midió la lectura de la capa por el PdfEngine en estas páginas (en la ronda 1, 5-14 ms por página nativa).

## 2. La palabra invisible que pisa texto visible

Código: `lib-excl.mjs` (las reglas), `overlap-traps.mjs`, `corpus-excl.mjs`.

### Las reglas

- **V** (ronda 1): visible si ≥ 2 px y ≥ 1 % del área de la caja cambia (delta de luma > 6) al sacar todo el texto, y alto ≥ 2 pt.
- **Guarda de solape** (ronda 2): V, y se descarta la palabra si `inter / min(área propia, área de otra) > umbral` con alguna otra palabra (1 % o 25 %).
- **Área exclusiva** (esta ronda): la misma comparación con y sin texto, pero solo en los píxeles de la caja que no caen en la caja (en píxeles, redondeada hacia afuera) de ninguna otra palabra. Visible si ≥ 2 px y ≥ 1 % del área exclusiva, **y** el área exclusiva es ≥ un mínimo (fracción de la caja). Se probaron mínimos de «cualquier píxel» (> 0), 25, 50, 75 y 90 %.

### Páginas trampa (42)

- Página de 460 × 90 pt. Una línea visible de texto (Helvetica 12 pt) que termina en una palabra larga (`administrativamente-correspondiente`, 197 pt). Una palabra invisible `OCULTO-ZZ-77` en Courier (9 pt, o 4-7 pt para solape de 100 %) puesta sobre esa palabra larga. Tres formas de invisibilidad: opacidad 0, `Tr 3`, color igual al fondo. Dos fondos: claro (blanco, texto negro) y oscuro (gris 0,27, texto 0,95). La invisible va antes del texto visible en el flujo (el visible queda encima).
- **Solape medido con la caja que lee el PdfEngine** (no con la métrica de la fuente): se generaron 1.512 candidatos con posiciones verticales distintas, 1.458 con la invisible leída como palabra aparte, y por cada objetivo se eligió el más cercano. Solapes reales: 1,3 %, 5,2 %, 10,2 %, 24,7 %, 49,8 %, 74,4 % y 100 %. Fracción exclusiva media de la caja de la invisible: 0,95; 0,90; 0,85; 0,70; 0,47; 0,25; 0,00. Una página por (fondo, forma, solape), 6 por bin.
- **Observación del arnés**: si la invisible queda en la misma línea que el texto visible (misma línea base, el ítem empieza antes de que termine el anterior), el PdfEngine la **funde** con la palabra visible vecina en una sola palabra (`OCULTO-ZZ-77Texto`, caja de 330-440 pt). Esos candidatos se descartaron del armado; el efecto no está medido aparte (ver «Sin medir»).

### Fugas (páginas con la palabra invisible conservada, de 6 por bin)

| Solape real | 1,3 % | 5,2 % | 10,2 % | 24,7 % | 49,8 % | 74,4 % | 100 % | Total |
|---|---|---|---|---|---|---|---|---|
| V | 0 | 0 | 0 | 6 | 6 | 6 | 6 | **24/42** |
| Guarda solape ≥ 1 % | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/42 |
| Guarda solape ≥ 25 % | 0 | 0 | 0 | 6 | 0 | 0 | 0 | 6/42 |
| Área exclusiva > 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0/42** |
| Área exclusiva ≥ 25 / 50 / 75 / 90 % | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/42 |

- Las 6 de V en cada bin ≥ 25 % son las tres formas por los dos fondos: sin diferencia entre ellas.
- V no deja pasar a ≤ 10 % porque necesita ≥ 1 % del área de la caja de diferencia, y con solape bajo la caja casi no tiene tinta al sacar el texto.
- La guarda ≥ 25 % deja pasar el bin de **24,7 %** (bajo el umbral). Con un solape ≥ 25 % cierra; el hueco son los solapes entre 1 y 25 % que V sí juzga visibles: el bin de 24,7 % lo muestra.
- El área exclusiva cierra a todos los solapes probados: con 100 % no queda ningún píxel exclusivo (la palabra no entra); con 75 % el área exclusiva (25 %) no cambia al sacar el texto; con 1-25 % lo mismo con el 75-99 %.

### La palabra visible con la que se solapa

| Regla | Palabra larga visible perdida (de 42 páginas) |
|---|---|
| Guarda solape ≥ 1 % | 42 |
| Guarda solape ≥ 25 % | 18 |
| Área exclusiva > 0, ≥ 25 %, ≥ 50 %, ≥ 75 % | 0 |
| Área exclusiva ≥ 90 % | 18 |

- Con la guarda, la regla mira el solape y tira las dos palabras. Con el área exclusiva, la palabra visible conserva su tinta en la parte que la invisible no toca.

### Palabras legítimas perdidas en el corpus (239 páginas nativas con palabras, 13.864 palabras, sin las 15 escondidas conocidas)

V conserva 13.748 (0,84 % de pérdida propia, la de la ronda 1). Por regla, palabras que V conserva y la regla descarta:

| Regla | Pierde | % de 13.864 | Páginas |
|---|---|---|---|
| V | 0 | 0 | 0 |
| Guarda solape ≥ 1 % | 212 | 1,53 | 19 |
| Guarda solape ≥ 25 % | 51 | 0,37 | 11 |
| Área exclusiva > 0 | **17** | **0,12** | **3** |
| Área exclusiva ≥ 25 % | 24 | 0,17 | 3 |
| Área exclusiva ≥ 50 % | 33 | 0,24 | 6 |
| Área exclusiva ≥ 75 % | 78 | 0,56 | 14 |
| Área exclusiva ≥ 90 % | 160 | 1,15 | 19 |

- Las pérdidas de la guarda de solape coinciden con las de la ronda 2 (212 y 51).
- Las pérdidas del área exclusiva, por tipo de documento (> 0): 7 en `lowa-borde` y 10 en `lowa-full`. Son palabras cuya caja tiene casi toda su área dentro de otras cajas (no se diagnosticó una por una).
- **Fugas en las 15 palabras escondidas conocidas del corpus** (trampas T01-T15 y `DATO-W-BLANCO-01`): 0 con las 8 reglas. Ninguna regla conserva una palabra que V descarta (`conservaYVNo` = 0 en todas).
- Costo por página (dos renders, comparación y máscara): 25,6 ms en este arnés (V solo: 9,8 ms en la ronda 1; la guarda con centinela, 16,1 ms).

## Qué quedó sin medir

- **Documentos reales**: ninguno.
- **NER en la app** (Chromium, ONNX Runtime Web con WASM): aquí es `onnxruntime-node`, mismo modelo y mismo kernel. Los tiempos del NER no son los de la app; los aciertos deberían ser los mismos, pero no se comparó.
- **OCR de la app** (orientación OSD, worker, Electron): tesseract.js en Node, sin OSD (las páginas son horizontales).
- **Escaneos reales**: las páginas son texto limpio de párrafos, sin inclinación, sombras, tablas ni sellos. El OCR rinde aquí mejor que en los escaneos de la ronda 1 (CER 0,002 contra 0,067): el 93 % de recall del OCR es una cota optimista.
- **Capas malas reales**: los errores son sintéticos (sustituciones por confusión, borrado, inserción, unión, partición) y uniformes por carácter. Un OCR real concentra errores en cifras, símbolos y tipografías raras.
- **Capa falsa con texto parecido** (por ejemplo, la misma plantilla con datos de otra persona): se usó el texto de otra página.
- **La otra mitad del NER**: nombres sin tratamiento, un solo apellido, mayúsculas y orden «Apellido, Nombre».
- **Efecto sobre grupos y reemplazos** de una detección con valor erróneo (el «exacto»): se midió el valor, no el agrupado.
- **Palabra invisible fundida con una visible** por el PdfEngine (misma línea): no se midió la fuga. Aparece cuando el invisible tiene la misma línea base que el visible.
- **Invisible sobre texto sin caja propia** (ink de imagen, vectores) y sobre texto rotado; **más de una palabra invisible** a la vez; **otras fuentes y tamaños**.
- **Tamaños de solape en x** (solape horizontal): el barrido fue vertical con la invisible dentro del ancho de la palabra visible.
- El mínimo de área exclusiva que habría que elegir: los números se dan por mínimo, no se eligió.

## Qué sale solo de sintéticos

- Todo. Las 40 páginas, los 677 datos, las capas (buena, mala, falsa), los 42 casos trampa y las tasas de error son armados por mí. Las 239 páginas del corpus de la parte 2 son las de las rondas 1 y 2 (documentos de prueba y fixtures del repo).
- El recall del OCR (93,1 %) y el de la capa mala dependen de las tipografías elegidas, del ruido y de cómo se reparten los errores.
- La fuga de V y de las reglas depende de cómo se armaron las trampas (una palabra invisible sobre una palabra visible larga, en Courier, sobre una sola línea).

## Archivos

- Informe: `C:\Anonly\spikes\texto-preservado\results\TEXTO_PRESERVADO_R3.md`.
- Código (`harness\r3\`): `build-detectors.mjs` (+ `entry.ts`), `lib-det.mjs`, `gen-pages.mjs`, `lib-layers.mjs`, `stage-layers.mjs`, `stage-detect.mjs`, `analyze-detect.mjs`, `stats.mjs`, `lib-excl.mjs`, `overlap-traps.mjs`, `corpus-excl.mjs`; `smoke.mjs`, `fonts.mjs`, `dbg-*.mjs` son de diagnóstico.
- Datos (`results\r3\`): `truth.json`, `img\`, `pdf\`, `layers.json`, `ocr.json`, `detect.json`, `analysis-detect.json`, `analysis-detect-rx.json`, `overlap-traps.pdf`, `overlap-traps.json`, `corpus-excl.json`.
- Orden: `build-detectors`, `gen-pages`, `stage-layers`, `stage-detect`, `analyze-detect` (con `REGEX_ONLY=1` para patrones solos), `stats`, `overlap-traps`, `corpus-excl`.
