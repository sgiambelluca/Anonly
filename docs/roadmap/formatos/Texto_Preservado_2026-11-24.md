> Informe del implementador del spike, copiado sin cambios. El resumen y lo que decide están en `Plan_1.2.md` §8.10.

# PDF con texto preservado (`pdf-text`): mediciones del spike

Fecha: 2026-11-24. Branch del repo: `docs/1.2-formatos` (sin tocar). Todo el código está en `C:\Anonly\spikes\texto-preservado\harness\` y los datos en `...\results\`.

**Sin documentos reales**: no había ninguna variable `ANONLY_REAL_DOC_*` definida. Todo el corpus es sintético o de fixtures del repo.

## Resumen (los números que deciden)

1. **Fuga con `Page.words` tal cual (N)**: de 15 palabras escondidas que el PdfEngine entrega (14 trampas + `DATO-W-BLANCO-01` de un Word convertido), N deja pasar 14 a la capa. La 15.ª quedó bajo una tapa por casualidad. Las trampas de texto fuera de página (4 tokens) y fuera del CropBox (1) **no** llegan a `Page.words`: el motor ya las descarta (5 de 5).
2. **Prueba de visibilidad (V)**: bloquea 15 de 15 palabras escondidas en el corpus (13 tipos de trampa + el blanco sobre blanco del Word + la capa falsa). Detecta que la palabra no tiene tinta propia con dos renders (con y sin las operaciones de texto). Pierde 106 palabras de 15.927 (0,67 %): 89 sin ninguna tinta en su caja (texto recortado, apilado fuera de la hoja, glifos en blanco), 13 de un escaneo con capa OCR previa (las otras 10 de esa página estaban bajo tapas) y 4 con tinta (no diagnosticadas).
3. **El escaneo con OCR previo es el punto débil de V**: V estricto tira la capa legítima entera (23 de 23 palabras de la trampa T16). La variante V+ (acepta una palabra invisible si hay tinta debajo y una imagen cubre ≥ 80 % de la página) la conserva, pero también deja pasar la capa falsa (T17: Tr 3 con otro texto alineado con la tinta). Ninguna prueba sin OCR puede distinguir las dos.
4. **OCR de la imagen ya tapada (O)**: 0 fugas de texto escondido (0 de 19 tokens, a 150 y a 300 dpi), pero la fidelidad es la peor de las tres. En el subconjunto latino horizontal (58 páginas) la F1 de palabras fuera de las tapas manuales es 0,82 a 150 y a 300 dpi. El texto del reemplazo se lee exacto solo en 87/171 (150 dpi) y 95/171 (300 dpi). Tiempo por página: 1,2 s a 150 y 1,9 s a 300 (media; 4-5 s en páginas densas).
5. **Para páginas escaneadas, N sobre el OCR del original (lo que la app ya tiene como `source: "ocr"`) no tiene fuga por construcción** y rinde mejor que O en los 12 escaneos sintéticos: CER 0,067 y F1 0,845 contra CER 0,120 y F1 0,80 (O a 300 dpi). Costo adicional: 0.
6. **Regla de las tapas**, sobre 15.912 palabras y 647 tapas: «toca cualquier área» deja 0 palabras tapadas en la capa y pierde 19 vecinas legítimas (0,12 %; 0,07 por tapa automática). «> 10 % del área»: 60 palabras quedan con 0-10 % de su caja tapada, 4 vecinas perdidas. «Centro adentro»: deja la palabra completa en la capa en **89 de 186** tapas de media palabra (48 %) y 278 palabras pisadas por una tapa quedan en el texto (211 con más de 25 % tapado). Con 1 pt de margen en las tapas, «cualquier área» pierde 94 vecinas (0,34 por tapa) y con 2 pt, 123.
7. **Escritura, F1 contra F2** (pdf-lib 1.17.1, sin dependencias nuevas). F2 (fuente sin glifos) es mejor en todo lo medido: IoU medio de la caja de las palabras releídas por el PdfEngine de la app 0,986 contra 0,808; texto igual al planeado en pdfjs en 242/279 páginas contra 215/279; poppler `-raw` 241/279 contra 167/279; rotaciones 90/180/270 IoU 0,99/0,92/1,00 contra 0,66/0,64/0,66. F1 no codifica el 1,70 % de las palabras del corpus (270/15.926; 0 % en las fuentes en español; CJK, hebreo, árabe) y pdf-lib **lanza** `WinAnsi cannot encode` en vez de degradar.
8. **La capa no dibuja nada**: el render de poppler (`pdftoppm`, 72 dpi) de `pdf-text` es idéntico byte a byte al de `pdf-image` en 558 de 558 páginas (F1 y F2).
9. **Tamaño y tiempo de armado** (279 páginas de ≈ 29 KB de JPEG q85 a 150 dpi, 57 palabras por página): con la capa comprimida, +2,3 % (F1) y +3,0 % (F2) sobre el PDF de solo imagen (≈ 0,68 y 0,86 KB por página); sin comprimir, +15,4 % y +18,3 %. Armado por página (sin rasterizar): 1,03 ms imagen, 1,45 ms F1, 1,38 ms F2. La rasterización (≈ 19 ms de render con pintado + ≈ 18 ms de JPEG a 150 dpi en este arnés) domina.
10. **Costo de V en producción**: un segundo render por página sin texto (9,8 ms por página los dos renders a 150 dpi en este arnés; 30 ms en páginas densas). Funciona mutando la lista de operaciones que pdfjs 4.10.38 guarda en `page._intentStates` (privado). `operationsFilter` no existe en 4.10.38. Es frágil ante una actualización de pdfjs.
11. **Control en tiempo de ejecución (E)**: detecta 80 de 80 páginas armadas a propósito con palabras bajo las tapas. Falsos positivos sobre capas limpias, con la lectura por el PdfEngine: 23/279 páginas en F1 y 23/279 en F2 (tolerancia 20 % del área de la palabra), 57 y 31 con área estricta. De los 502 casos sin tapas superpuestas quedan 36 estrictos y 9 con tolerancia; los 5 que se diagnosticaron (F2) son el PdfEngine leyendo mal el texto del reemplazo en una caja angosta («[MANUAL» por «[MANUAL-02]»). Los otros 4 (F1) no se diagnosticaron. Lectura del PDF exportado: 1,9 ms por página con pdfjs, 35 ms con el PdfEngine; la comprobación en sí, 0,05 ms.
12. **Observación**: la combinación que mejor cierra los números es V (con la fuente F2) para el texto nativo, N sobre el OCR del original para los escaneados, y tratar aparte las páginas «nativas» con una sola imagen grande y capa invisible (la app las lee hoy como texto nativo, no se OCR-ean, y V+ no las protege de una capa falsa; ahí solo O da la garantía).

## Qué se midió y cómo

### Entorno del arnés

- Node 22.23.2, sin Electron: pdfjs-dist **4.10.38** (la que está instalada en el repo; el `package.json` pide `^4.0.379`), `@napi-rs/canvas` 0.1.100 para renderizar, pdf-lib 1.17.1, tesseract.js 6.0.1 con los `traineddata` `spa` y `eng` del `public/models/tesseract` del repo (sin bajar nada).
- **Las palabras salen del PdfEngine real**: se empaquetó `packages/anonymization-core/pdf-engine/src` con esbuild a un archivo en el spike (`engine-pdf.bundle.mjs`) y se corrió en Node con `fetch` parcheado para `/pdfjs/`. No se copió su lógica.
- OCR: PSM `SPARSE_TEXT`, `spa+eng`, `user_defined_dpi` igual al de la imagen, como `ocr-engine/worker/kernel.ts`. La detección de orientación de la app (OSD) se sustituyó por probar las 4 rotaciones solo en los escaneos (ver «Sin medir»).
- Pintado de tapas: **reimplementación mía** de `render-engine/worker/kernel.ts` (caja negra en `redact`; en los demás modos caja blanca y el texto una sola vez en el fragmento más ancho, fuente 0,64 × alto, mínimo 8 px, `maxWidth`; `monospace` solo en placeholder; texto rotado en 90/270). Sin el repintado de línea. Imagen exportada: JPEG q85 a 150 dpi.

### A. Corpus (279 páginas, 15.927 palabras, 647 tapas)

| Tipo | Páginas | Palabras |
|---|---|---|
| Trampas (generadas con pdf-lib) | 18 | 1.108 |
| Fixtures del repo con texto (text-10p, qa-stamp, qa-tables-justified, image-alpha-3p, reference/doc-001..026) | 48 | 1.155 |
| LibreOffice, casos borde (`raw-b/pdf-recC`, incluye `l-w-otros` con `DATO-W-BLANCO-01`) | 70 | 1.077 |
| LibreOffice, sintéticos (`raw/pdf-sint-recC`, hasta 4 páginas por documento) | 24 | 7.550 |
| LibreOffice, muestra al azar de `raw-full/pdf-lowa-recC` (semilla fija) | 100 | 2.989 |
| Escaneados del repo (`tests/fixtures/adr190`: 3 con formas, 3 con 2 renglones girados 90/180/270, 1 más) | 7 | 16 (OCR) |
| Escaneos sintéticos (12 páginas nativas a 300 dpi, grises, ruido gaussiano, JPEG q80) | 12 | 2.032 (OCR) |

- **Trampas**, una página cada una con un token único `OCULTO-Txx-xxxx` y texto visible alrededor: T01 blanco sobre blanco; T02 bajo imagen opaca plana; T03 bajo imagen con otro texto; T04 bajo rectángulo negro; T05 Tr 3; T06 recortado por clip; T07 fuera de la página (4 tokens); T08 fuera del CropBox; T09 de 0,1 pt; T10 del color de un rectángulo de fondo; T11 bajo rectángulo blanco; T12 en una capa opcional (OCG) apagada; T13 bajo la apariencia de una anotación; T14 con opacidad 0; T15 con trazo blanco (Tr 1); T16 escaneo legítimo con capa OCR previa (Tr 3 alineado, token legítimo `LEGIT-T16-5H8D`); T17 capa OCR falsa (Tr 3 con otro texto, alineado con la tinta de la imagen de página completa); T00 control sin trampa.
- **Tapas** (todas con datos conocidos del corpus): 275 automáticas (palabras únicas en la página: DNI, mails, nombres de 1 o 2 palabras), 186 «media palabra» (se tapa el 55 % o el 45 % de la caja de una palabra, es decir, con el centro adentro o afuera) y 186 sobre una región arbitraria (70-140 pt de ancho). Modos: redact 167, placeholder 152, mask 165, synthetic 163. Con varios fragmentos solo 4.
- **Límite del corpus**: algunas tapas manuales se superponen entre sí. Eso distorsiona el control E (ver §E).
- **Verdad de referencia**: en las páginas nativas sin trampas la verdad es el propio `Page.words` (más las trampas conocidas excluidas). Por eso la fidelidad de N sobre el corpus limpio es 0 por construcción y no prueba nada. La verdad independiente existe solo en las trampas (texto conocido) y en los escaneos sintéticos (el texto nativo de la página de origen).

### B. Fuente del texto de la capa

**Fugas (tokens y palabras escondidas que aparecen en la capa)**

| Trampa | Palabras en `Page.words` | N | V | V+ |
|---|---|---|---|---|
| T01 blanco/blanco | sí | fuga | no | no |
| T02 bajo imagen plana | sí | fuga | no | no |
| T03 bajo imagen con texto | sí | fuga | no | no |
| T04 bajo rectángulo negro | sí | fuga | no | no |
| T05 Tr 3 | sí | fuga | no | no |
| T06 clip | sí | fuga | no | no |
| T07 fuera de página (4) | no (lo descarta el motor) | 0/4 | 0/4 | 0/4 |
| T08 fuera del CropBox | no (lo descarta el motor; la página mide 595 × 642) | 0 | 0 | 0 |
| T09 0,1 pt | sí | fuga | no (regla: alto < 2 pt no es legible) | no |
| T10 color del fondo | sí | fuga | no | no |
| T11 bajo blanco | sí | fuga | no | no |
| T12 OCG apagada | sí (el motor no mira OCG) | fuga | no | no |
| T13 bajo anotación | sí | fuga | no | no |
| T14 opacidad 0 | sí | fuga | no | no |
| T15 trazo blanco | sí | fuga | no | no |
| T16 escaneo legítimo | 23 (capa OCR previa) | conserva 23 | conserva 0 de 23 | conserva 23 |
| T17 capa OCR falsa | 1 (el token; `requiresOCR = false`) | fuga | no | **fuga** |
| `DATO-W-BLANCO-01` (Word convertido) | sí | (quedó bajo una tapa por azar) | no | no |

- **O**: 0 fugas de tokens escondidos en las 18 páginas de trampas, a 150 y a 300 dpi.
- **Datos tapados que reaparecen**: en O, 8 de 211 palabras únicas tapadas aparecen otra vez en el texto del OCR, en las dos resoluciones (2 se explican porque la palabra está en el texto de un reemplazo, por ejemplo un nombre sintético que repite una palabra del original). Las otras 6 **no se diagnosticaron**: lo más probable es la misma palabra en otro lugar de la página (figuras o imágenes que el motor no lee), pero no se verificó una por una. En N y V con la regla «cualquier área» hay 0.
- **V, la prueba**: se renderiza la página a 150 dpi dos veces (con el texto y con las operaciones `showText`/`showSpacedText`/`nextLineShowText`/`nextLineSetSpacingShowText` reemplazadas por `dependency([])`, mutando `page._intentStates.*.operatorList`). Una palabra es visible si ≥ 2 px y ≥ 1 % del área de su caja cambia (delta de luma > 6) y su alto es ≥ 2 pt. Con un umbral de luma de 32 se perdía además la marca de agua pálida «FIEL COPIA» de `qa-stamp`. Con 6 se conserva.
- **V+** (la variante para el escaneo con capa previa): V, o bien palabra de alto ≥ 2 pt con ≥ 5 % de tinta oscura y desvío estándar de luma ≥ 30 en la caja, en una página donde una imagen cubre ≥ 80 %.
- **Lo que V pierde (106 palabras)**: 89 sin tinta, 13 de T16, 4 con tinta. Entre las «sin tinta» están texto apilado desbordado de una forma de LibreOffice (`g-x-apilada*`), celdas de Excel recortadas (`x0364`), glifos CJK en blanco en el propio PDF de origen (`w0477`, `w1870`) y la caja de una celda `rot90`. Las 4 «con tinta» están en `l-x-ajuste.pdf` (3) y `l-w-otros.pdf` (1, una palabra de texto minúsculo, < 2 pt, que la regla de legibilidad descarta aunque se vea algo).
- **Fidelidad** (CER, WER y F1 de bolsa de palabras contra el texto visible esperado con las tapas aplicadas):
  - Trampas, N: CER 0,086, F1 0,939 (sube por el texto escondido). V: CER 0,100, F1 0,913 (T16 tirada). V+: CER 0,058, F1 0,944.
  - Escaneos sintéticos, N sobre el OCR del original: CER 0,067, WER 0,221, F1 0,845.
  - O, por tipo de página (fuera de las tapas manuales, «limpio»; entre paréntesis, sin limpiar), F1 a 150/300 dpi: trampas 0,95/0,95 (0,92/0,93); fixtures 0,86/0,79 (0,76/0,72); LibreOffice sintéticos 0,89/0,88 (0,86/0,86); escaneos sintéticos 0,82/0,82 (0,79/0,80). Las muestras de LibreOffice de casos borde y de `raw-full` dan 0,44/0,55 y 0,55/0,55: contienen texto girado (sin OSD en mi arnés), alfabetos que `spa+eng` no lee (alemán con figuras, CJK) y páginas de 2-8 palabras, así que no son una medida del OCR sobre texto latino normal.
  - Subconjunto latino horizontal (58 páginas, sin texto girado, ≥ 5 palabras): F1 limpia 0,823 (150 dpi) y 0,825 (300 dpi); recall 0,837 y 0,839.
- **Efecto de las tapas en el OCR**: lee lo que queda visible. De una palabra tapada al 45-55 % deja un resto («baja», «culo»), que no está en el texto esperado. Y lee mal o une el texto del reemplazo en cajas angostas («[NOVBRE-03]», «Diegosoria»). Exacto sobre las 180 tapas con texto: 91 a 150 dpi y 98 a 300 dpi; en las trampas a 300 dpi, placeholder 10/21, mask 8/21, synthetic 15/22.
- **Tiempo por página** (Node, wasm de una sola instancia): N, el PdfEngine: 5,5 ms en páginas nativas pequeñas, 14 ms en las densas, 17,7 ms de media del corpus (incluye 267 ms en los escaneos sintéticos, que son imágenes de 300 dpi). V: 9,8 ms de media (30 ms en páginas densas). O: 1,24 s (150 dpi) y 1,88 s (300 dpi) de media sobre 76 páginas; 4,1 s y 5,4 s en las páginas densas de LibreOffice; 2,8 s y 4,0 s en los escaneos sintéticos.

### C. La regla de las tapas (geometría con las cajas de tinta reales; 15.912 palabras de la verdad visible, 647 tapas)

| Regla / margen | Vecinas legítimas perdidas (palabras tocadas que no eran el objetivo de una tapa automática) | Palabra objetivo que sigue en la capa | Palabras pisadas por una tapa que siguen en la capa (> 25 % tapado) |
|---|---|---|---|
| cualquier área > 0, 0 pt | 19 | 0 de 497 | 0 |
| cualquier área > 0, 1 pt | 94 | 0 | 0 |
| cualquier área > 0, 2 pt | 123 | 0 | 0 |
| > 10 % del área, 0 pt | 4 | 0 | 60 (0) |
| > 10 % del área, 1 pt | 5 | 0 | 41 (0) |
| > 10 % del área, 2 pt | 36 | 0 | 22 (0) |
| centro adentro, 0 pt | 2 | **89** de 497 (media palabra: 89 de 186) | 278 (211) |
| centro adentro, 1 pt | 3 | 89 | 262 (195) |
| centro adentro, 2 pt | 4 | 44 | 201 (135) |

- Las tapas sobre una región arbitraria tocan más palabras (483 con «cualquier área»): es lo esperado y no cuenta como pérdida.
- «Cualquier área» elimina de la capa toda palabra que una tapa pisa. Las otras dos reglas dejan en el texto palabras con caracteres tapados.
- El texto del reemplazo va una vez, en el fragmento más ancho, en el lugar de la primera palabra tapada (si ninguna palabra toca la tapa, se inserta por posición). `redact` no lleva texto. Los 4 casos con varios fragmentos (pocos) se verificaron por el lado del control E.
- «Pérdida de vecinas» depende del margen real de las cajas de las tapas en el export. Aquí las tapas son la caja de tinta sin margen.

### D. Escritura de la capa

- **Cómo se armó**: un `BT … ET` por palabra con `Tr 3`, `Tf`, `Tz` (el ancho de la caja), `Tm` (rotación 0/90/180/270) y un espacio como parte de la cadena entre palabras (el salto de renglón es el cambio de renglón en el orden de lectura). Tamaño de fuente = grosor de la caja / 0,925 (F1) o / 1,0 (F2). El contenido va con `flateStream`.
- **F1**: `StandardFonts.Helvetica` sin embeber, WinAnsi. pdf-lib lanza `WinAnsi cannot encode "第" (0x7b2c)`; el arnés degradó el carácter a `?`. Palabras con al menos un carácter no codificable: **270 de 15.926 (1,70 %)**, todas en las muestras de LibreOffice de casos borde (123 de 1.077) y `raw-full` (147 de 2.989), 0 en el resto. Caracteres: き (U+304D, 110), 今 (U+4ECA, 90), letras hebreas y árabes. Los textos de los reemplazos (480) se codifican todos.
- **F2**: TrueType mínimo armado en JS (412 bytes: `cmap`, `glyf`, `head`, `hhea`, `hmtx`, `loca`, `maxp`, `name`, `post`; 2 glifos vacíos), Type0/CIDFontType2, Identity-H, `DW 1000`, `CIDToGIDMap` por flujo (todos los CID al glifo vacío), ToUnicode por documento (bloques de 100 `bfchar`, pares sustitutos para fuera del BMP). `pdffonts` lo lista como `CID TrueType`, Identity-H, `emb yes`, `uni yes`. Lo leen pdfjs 4.10.38, el PdfEngine y poppler 25.07. **Pares sustitutos para fuera del BMP: construidos pero sin caso en el corpus; sin verificar.**

| | F1 | F2 |
|---|---|---|
| Páginas con texto de pdfjs (default, items combinados) = planeado | 215/279 | 242/279 |
| ídem ignorando espacios | 268/279 | 272/279 |
| Orden de palabras igual (pdfjs, flujo de contenido) | 215/279 | 242/279 |
| poppler `pdftotext` (orden geométrico propio) texto igual | 152/279 | 172/279 |
| poppler `-raw` (orden del flujo) texto igual | 167/279 | 241/279 |
| Recall/precisión de palabras (pdfjs) | 0,976 / 0,983 | 0,984 / 0,989 |
| Recall/precisión de palabras (poppler `-raw`) | 0,914 / 0,951 | 0,986 / 0,989 |
| IoU medio de las palabras releídas por el **PdfEngine** | 0,808 | 0,986 |
| ídem, palabras con IoU ≥ 0,5 / ≥ 0,8 (de 15.287) | 14.973 / 14.650 | 15.073 / 15.067 |
| IoU medio con poppler `-bbox` | 0,976 | 0,994 |
| IoU PdfEngine por rotación 0 / 90 / 180 / 270 (n = 15.093 / 83 / 13 / 98) | 0,81 / 0,66 / 0,64 / 0,66 | 0,99 / 0,99 / 0,92 / 1,00 |
| IoU poppler por rotación 0 / 90 / 180 / 270 | 0,98 / 0,79 / 0,92 / 0,79 | 0,99 / 0,99 / 0,92 / 1,00 |
| Páginas en las que el PdfEngine devuelve la misma cantidad de palabras | 186/279 | 206/279 |
| Imagen igual a `pdf-image` (poppler 72 dpi, SHA-256 por página) | 279/279 | 279/279 |
| Tamaño total, 279 páginas (comprimido): `pdf-image` 8.114.918 B | 8.303.899 (+2,33 %) | 8.355.866 (+2,97 %) |
| Tamaño total sin comprimir la capa | 9.362.989 (+15,4 %) | 9.599.530 (+18,3 %) |
| Armado por página (mediana de 3 corridas, sin rasterizar) | 1,45 ms | 1,38 ms (imagen sola: 1,03 ms) |

- **Por qué no es 100 %**:
  - pdfjs 4.10 junta palabras contiguas en un solo ítem y, según lo observado, **descarta el espacio final** cuando el siguiente ítem arranca antes de que termine el anterior (cajas que se solapan: versales, superíndices, tapas superpuestas, texto girado 45°). Sale «ejemplo[MANUAL-02]» en vez de «ejemplo [MANUAL-02]». La causa exacta dentro de pdfjs no se revisó en su código. En F2: de las 37 páginas distintas, 34 son palabras que se pegan y 3 tienen otra cantidad de palabras.
  - poppler (orden por defecto) reordena por su análisis geométrico; con `-raw` sigue el flujo. En F1 poppler `-raw` además pierde el espacio dentro de una cadena con `Tz` apretado («DiegoSoria»), cosa que no le pasa a F2 (110 páginas en F1).
  - `disableCombineTextItems` no existe en `getTextContent` de pdfjs 4.10 (sin efecto), así que con pdfjs no se pueden leer posiciones por palabra. Para la posición se usó el PdfEngine y poppler `-bbox`.
- **IoU de F1**: la caja que el PdfEngine deduce de las métricas de Helvetica no coincide con la de la palabra (0,81 de media aunque el 98 % supera 0,5). Ajustar el tamaño por 0,925 y el descenso por 0,2238 lo dejó así; no se afinó más.

### E. Control de verificación en tiempo de ejecución (prototipo)

- **Qué hace**: lee el PDF exportado con el PdfEngine (palabras con caja) y falla si (1) una palabra cae sobre una tapa y no es el texto del reemplazo de esa tapa en su fragmento más ancho (en `redact`, ninguna palabra), o (2) el texto extraído por pdfjs no es igual al planeado (normalizando espacios).
- **Positivos**: 80 páginas armadas con la regla «ninguna» (la capa lleva las palabras bajo las tapas): lo detecta en 80/80 (área estricta) y 80/80 (tolerancia 20 % del área de la palabra).
- **Falsos positivos sobre capas limpias** (279 páginas × F1 y F2): control (1) 57 (F1) y 31 (F2) estricto; 23 y 23 con tolerancia. Hay 56 páginas-variante con tapas superpuestas (artefacto del corpus: dos tapas manuales que se pisan pintan una encima de la otra) y de las 502 restantes quedan 36 estrictos y 9 con tolerancia. Diagnóstico de los de F2: 5, todos el PdfEngine leyendo el texto de un reemplazo en una caja angosta como un fragmento («[MANUAL» por «[MANUAL-02]»). No se diagnosticaron los otros 4 (F1).
- **Control (2)**: marca 101 de 558 páginas por texto distinto (64 en F1 y 37 en F2). Sin tener en cuenta los espacios son 18 (11 y 7). La diferencia son los espacios que pdfjs descarta (ver §D) y, en F1, los `?` por caracteres no codificables. Ese control le avisa al producto de los dos.
- **Sobre una capa hecha con O** (OCR de la imagen tapada): el control (1) marca 59/76 páginas a 150 dpi y 62/76 a 300 dpi, porque el OCR rara vez devuelve el texto exacto del reemplazo. El control, tal como está, no sirve para la fuente O.
- **Lo que no puede ver**: no sabe nada del texto escondido (T01-T17); solo protege las tapas y la igualdad con el plan. Eso lo cubre la fuente de texto (V, O).
- **Tiempo por página**: lectura con el PdfEngine 35 ms, con pdfjs 1,9 ms; la comprobación (geometría) 0,05 ms.

### F. Nota para PDF/A (sin verificar: no hay veraPDF)

- **F1** (Helvetica estándar sin embeber): PDF/A exige fuentes embebidas; recuerdo que PDF/A-2 exceptúa las fuentes usadas solo en modo de render 3, pero no lo verifiqué. Sin verificar.
- **F2** (TrueType embebido, Identity-H, `CIDToGIDMap`, `CIDSystemInfo`, `FontDescriptor` con `FontFile2`, ancho `DW` igual al `hmtx`): debería cumplir las reglas de fuentes de PDF/A-2b. El **ToUnicode por documento** es lo que pide PDF/A-2u (y 1a). Riesgos: el TrueType armado a mano (tablas obligatorias, sumas de verificación, glifos vacíos) y los pares sustitutos de ToUnicode. Sin verificar.
- pdf-lib guarda con flujos de objetos (PDF 1.5+; no válidos en PDF/A-1) y no escribe XMP ni `OutputIntent`. Eso es independiente de la capa de texto y no se probó.

## Qué quedó sin medir

- **Documentos reales**: ninguno (sin `ANONLY_REAL_DOC_*`).
- **Render y canvas reales de la app** (Electron/Chromium): se usó `@napi-rs/canvas` con pdfjs en Node. Los tiempos de render, de JPEG y las fuentes del pintado de reemplazos no son los de producción. Los tiempos de OCR son de tesseract.js en Node, no del worker de la app.
- **OSD** en páginas nativas giradas: no se corrió. Los escaneos del repo con texto girado sí (probando las 4 rotaciones). El OCR de la muestra de casos borde con texto girado está subestimado por eso.
- **Repintado de línea** (`tryRepaintLine`) del render: no se reprodujo.
- **Lectores**: solo pdfjs 4.10.38, el PdfEngine y poppler 25.07. Sin Acrobat, Chrome, Edge ni el visor de la app (selección y copia de texto, búsqueda).
- **Fidelidad del texto nativo sobre verdad independiente**: no existe en el corpus real más que en las trampas; en el resto, N es la verdad por definición.
- **Transparencias parciales, modos de mezcla, texto bajo una imagen semitransparente, patrones, Type3 recortado**: no se probaron (solo alfa 0 y los casos de la lista).
- **Exportación a 300 dpi**, memoria, lotes grandes: no medidos.
- **PDF/A**: sin verificar.
- **Cobertura chica**: 4 tapas con varios fragmentos; 13 palabras con rotación 180; 5 PDF de escaneo con formas (el OCR devuelve basura sin texto real).

## Qué sale solo de sintéticos

- Todo. Las trampas, los escaneos y las tapas son generados por mí; los PDF de LibreOffice vienen de los spikes previos (documentos de prueba, no reales); los fixtures son los del repo.
- Las cifras de fuga de N/V/V+/O, el control E y los falsos positivos dependen de cómo armé las trampas y de las tapas aleatorias (con superposiciones).
- «Palabras legítimas perdidas» por V usa como verdad «todo lo que no es una trampa conocida». Por eso mezcla pérdidas verdaderas con palabras que de verdad no se ven (sin tinta).
- La fidelidad de O sobre LibreOffice y `raw-full` incluye páginas con alfabetos que el motor no soporta y con texto girado.

## Archivos

- Informe: `C:\Anonly\spikes\texto-preservado\results\TEXTO_PRESERVADO.md`.
- Resultados: `results\stage1.json` (palabras, visibilidad, tapas por página), `results\analysis-sources.json` (B y C), `results\analysis-write.json` (D y E), `results\ocr-anon.json`, `results\ocr-orig.json`, `results\summary.json`, `results\units.json`.
- Código: `harness\` (`gen-traps.mjs`, `gen-scans.mjs`, `corpus.mjs`, `stage1.mjs`, `stage-ocr-orig.mjs`, `stage-ocr.mjs`, `analyze-sources.mjs`, `stage-write.mjs`, `summary.mjs`, `lib-*.mjs`; el PDF de las trampas en `corpus\traps\traps.pdf`). Orden: `build-engine.mjs`, `gen-traps.mjs`, `corpus.mjs`, `gen-scans.mjs`, `stage-ocr-orig.mjs`, `stage1.mjs`, `stage-ocr.mjs`, `analyze-sources.mjs`, `stage-write.mjs`, `summary.mjs`.
