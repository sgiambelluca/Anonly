# Calidad de la salida: nuestro LibreOffice 26.8.3.1 contra ZetaOffice 24.2

> Informe del implementador del spike, copiado sin cambios de
> `C:\Anonly\spikes\lowa\results\CALIDAD.md` el 2026-11-23. El corpus,
> los PDF, las imágenes y el código de la comparación quedan fuera del repo,
> en `C:\Anonly\spikes\lowa\`. Qué decide el planificador con esto:
> `Plan_1.2.md` §8.4.

Fecha: 2026-11-23. Mismo equipo y mismo harness que `INFORME.md` (ese archivo no se tocó). No hay `ANONLY_REAL_DOC_*` definidas: **no hay documentos reales en esta comparación**. Todo son sintéticos del spike y archivos de prueba del código de LibreOffice (`sw/qa`, `sc/qa`, `sd/qa`). No se fijan umbrales de aprobado o rechazado.

## Qué se comparó

| | Nuestro | ZetaOffice |
|---|---|---|
| Build | `dynexec0` con el recorte `rec-B` (sin fuentes no latinas) | assets de allotropia, `zetaoffice_latest` |
| Dónde corre | Worker, CSP estricta (`script-src 'self' blob: 'wasm-unsafe-eval'`) | ventana con `unsafe-eval`, como en su spike |
| PDF | `FilterData UseTaggedPDF=false` | por defecto (con etiquetas) |

Además se corrió nuestro build **con** etiquetas (por defecto) sobre los mismos archivos, para la pregunta de las etiquetas.

**Corpus (319 archivos):**
- 9 sintéticos del spike (en las tablas, `presentacion.pptx` cuenta dentro de pptx y los otros 8 como «sintéticos»).
- 150 `.docx` de `sw/qa/**/data/`, 80 `.xlsx` de `sc/qa/**/data/` y 80 `.pptx` de `sd/qa/**/data/` del árbol clonado (`~/lowa/core`, tag `libreoffice-26.8.3.1`). Hay más: 2 104 docx, 383 xlsx y 427 pptx en el árbol. Se tomaron los de menos de 5 MB, sin contenido repetido, ordenados por sha256 del contenido y se tomaron los primeros N (150, 80 y 80). Los identificadores neutros `w001`, `x001`, `p001`… y su ruta relativa están en `C:\Anonly\spikes\lowa\corpus-lo\MAP.tsv`. La muestra no se eligió mirando resultados.
- Tiempo de máquina: cada pasada completa (319 archivos) tardó ~90 s por configuración; el total quedó muy por debajo de las 2 h, así que **no se achicó la muestra**.
- Cada archivo con timeout de 60 s; el conversor se reinicia tras un timeout, un crash o un `RuntimeError`. En las 3 configuraciones hubo **0 timeouts**. El único crash fue de ZetaOffice (`p060`). Quedan pocos archivos rotos de verdad en esta muestra (ver estados).

**Métricas** (`harness\compare.mjs`): texto con `pdfjs-dist` 4.10.38 (la versión del repo, build `legacy` en Node), normalización NFC y espacios; las palabras se comparan como multiconjunto en las dos direcciones; los caracteres sin espacios también. Imagen: `pdftoppm` a 36 ppp en gris, hasta las 8 primeras páginas; píxel «distinto» si difiere más de 40 de 255; la métrica es la fracción de píxeles distintos de la página (media sobre las páginas comparadas; también la peor página). Si el tamaño de página difiere, vale 100 %. Los percentiles son por rango más cercano. Datos por archivo: `results\calidad\cmp-zeta-vs-lowa.json`.

## Estado de conversión

| Estado | ZetaOffice | Nuestro (sin etiquetas) | Nuestro (con etiquetas) |
|---|---|---|---|
| ok | 317 | 318 | 318 |
| falla | 2 | 1 | 1 |
| timeout | 0 | 0 | 0 |
| crash | 0 | 0 | 0 |

- `x025` (`sc/qa/unit/data/xlsx/tdf76115.xlsx`): **falla en los dos** con `loadComponentFromURL devolvió null` (archivo que LibreOffice no abre).
- `p060` (`sd/qa/unit/data/pptx/pass/tdf173266.pptx`): **ZetaOffice falla** con `RuntimeError: memory access out of bounds` (obligó a reiniciar el conversor); **nuestro convierte** (PDF de 6,4 KB). Es el único archivo que convierte uno solo.
- Sin ningún intento de red en las tres configuraciones.

## Tablas por formato (ZetaOffice contra nuestro sin etiquetas)

| | docx (150) | xlsx (80) | pptx (80 + `presentacion`) | sintéticos (8) |
|---|---|---|---|---|
| Convierte Zeta / nuestro | 150 / 150 | 79 / 79 | 80 / 81 | 8 / 8 |
| Solo uno convierte | 0 | 0 | 1 (solo nuestro) | 0 |
| Ninguno convierte | 0 | 1 | 0 | 0 |
| Páginas iguales / distintas | 149 / 1 (`w084`) | 78 / 1 (`x055`) | 80 / 0 | 8 / 0 |
| Con alguna página de otro tamaño | 0 | 0 | 0 | 0 |
| Texto idéntico por palabras (de los comparables) | 137 / 150 | 66 / 79 | 79 / 80 | 8 / 8 |
| Texto idéntico por caracteres | 139 / 150 | 66 / 79 | 80 / 80 | 8 / 8 |
| Archivos donde nuestro pierde palabras que Zeta tiene | 12 | 8 | 1 | 0 |
| Archivos donde nuestro tiene palabras que Zeta no | 12 | 11 | 1 | 0 |
| Diferencia de texto, % de palabras (mediana / p90 / máx.) | 0 / 0 / 80,4 | 0 / 2,38 / 100 | 0 / 0 / 0,71 | 0 / 0 / 0 |
| Palabras solo en Zeta (mediana / p90 / máx.) | 0 / 0 / 4 103 | 0 / 0 / 4 061 | 0 / 0 / 2 | 0 / 0 / 0 |
| Palabras solo en el nuestro (mediana / p90 / máx.) | 0 / 0 / 14 | 0 / 1 / 876 | 0 / 0 / 4 | 0 / 0 / 0 |
| Píxeles distintos, % media de páginas (mediana / p90 / máx.) | 0,01 / 2,53 / 29,84 | 0 / 0,58 / 9,96 | 0,01 / 1,07 / 16,51 | 0,11 / 0,19 / 3,27 |
| Píxeles distintos, % de la peor página (mediana / p90 / máx.) | 0,01 / 3,09 / 32,56 | 0 / 0,82 / 18,22 | 0,01 / 1,07 / 16,51 | 0,15 / 0,22 / 3,27 |
| Tamaño del PDF, mediana B/A | 1,31 | 1,45 | 1,44 | 1,03 |

Los máximos de texto en docx (`w084`) y xlsx (`x055`) son casos donde **Zeta** es el que se aparta del archivo de origen o el archivo es malformado (ver abajo); sin esos dos, el máximo de palabras solo en Zeta es 14 (docx) y 15 (xlsx).

Tamaño total de los 318 PDF: Zeta 8,0 MB; nuestro sin etiquetas 8,3 MB; nuestro con etiquetas 38,4 MB. Tiempo de conversión por archivo: mediana 68 ms Zeta, 75 ms nuestro, 77 ms con etiquetas; p90 285 / 323 / 326 ms; máximo 4 175 / 1 933 / 1 951 ms.

## ¿El texto sale idéntico sin etiquetas? Respuesta: no del todo

Nuestro con etiquetas contra nuestro sin etiquetas, los mismos 319 archivos:

| Formato | Archivos | Texto idéntico | Difieren |
|---|---|---|---|
| docx | 150 | 150 | 0 |
| pptx (con `presentacion`) | 81 | 81 | 0 |
| xlsx | 79 | 75 | 4 |
| sintéticos | 8 | 7 | 1 (`hoja_ancha.xlsx`: 4 palabras) |

En los 5 que difieren, **con etiquetas faltan palabras que sin etiquetas aparecen** (nunca al revés), y las palabras que aparecen sin etiquetas son las que ZetaOffice también tiene:

| Archivo | Palabras que faltan con etiquetas |
|---|---|
| `sc/qa/unit/data/xlsx/pivottable_long_text.xlsx` (`x009`) | 35 (el texto largo de celdas) |
| `sc/qa/unit/data/xlsx/column-style-autofilter.xlsx` (`x016`) | 47 |
| `sc/qa/unit/data/xlsx/value-in-column-2000.xlsx` (`x040`) | 9 |
| `sc/qa/unit/data/xlsx/new_cond_format_test_export.xlsx` (`x076`) | 2 |
| `hoja_ancha.xlsx` (sintético) | 4 |

Es decir: **el texto no es idéntico con y sin etiquetas** (queda descartada la hipótesis de que lo fuera). En hojas de cálculo, el PDF etiquetado de 26.8 pierde texto en 5 de 87 archivos; sin etiquetas coincide con lo que da ZetaOffice en esos casos. En Word y PowerPoint no hay diferencia de texto en los 231 archivos comparados. **[NO CONFIRMADO]** la causa exacta de la pérdida con etiquetas (no se investigó en el código de LibreOffice). Además, los PDF con etiquetas pesan 38,4 MB contra 8,3 MB (ver `INFORME.md` §4 para `hoja_grande.xlsx`).

## Diferencias relevantes, clasificadas

**Contenido que falta en el nuestro (texto que ZetaOffice extrae y el nuestro no)**
- `sw/qa/extras/layout/data/tdf127118.docx` (`w060`): una celda con texto girado (`textDirection btLr`) y celdas combinadas verticalmente. Zeta pone el texto («Lorem consectetur adipiscing elit. Vestibulum…») y el nuestro dibuja la celda vacía: faltan 43 de 80 caracteres. Es el único caso de pérdida real de contenido que se confirmó con el origen y con la imagen (PNG en `results\calidad\otros\w060.png`). No se miró si es un defecto de LibreOffice 26.8.3.1 o de este build.
- Los otros archivos con «palabras solo en Zeta» son de formato, no de contenido (ver más abajo): `x016` (15 palabras con diferencias de puntuación pegada, «computers?» contra «computers»), `x013` (formato de números), `w001` (números de página), `w146` (puntos guía de índice: faltan en un lado y sobran en el otro).
- Si se mira solo qué lado tiene más texto, **el nuestro tiene más en 11 xlsx**: `x006`, `x038`, `x046`, `x050` (encabezados de tabla y de página que Zeta no imprime: «Sheet1», «Page 1», «Column1»…) y otros.

**Contenido donde Zeta se aparta del archivo de origen**
- `sw/qa/extras/ooxmlexport/data/tdf163894.docx` (`w084`): el XML tiene 504 palabras; nuestro produce 508 en 4 páginas y Zeta produce 4 603 en 11 páginas (repite contenido). Es la diferencia de páginas del docx y el máximo de píxeles (29,8 %). Nuestro coincide con el origen.
- `sc/qa/unit/data/xlsx/pass/CVE-2017-0199-2.xlsx` (`x055`): archivo malformado a propósito (prueba de seguridad). Zeta lo abre como hoja de 2 páginas con 4 072 palabras de basura y nuestro como 50 páginas con 887; es la diferencia de páginas del xlsx. No es una diferencia de calidad.

**Saltos de línea, de página y métricas**
- Todas las páginas tienen el mismo tamaño en los 318 PDF comparables. La cantidad de páginas coincide en 315 de 317 (las dos excepciones de arriba).
- `sw/qa/extras/tiledrendering/data/comments-on-load.docx` (`w081`, 13,4 % de píxeles): los mismos renglones, con un desplazamiento horizontal pequeño del texto (la tinta no coincide al píxel). `w074`/`w014`/`w001` (`floattable-*`): alturas de fila y posición de tablas flotantes que difieren unos píxeles; un título con salto de línea distinto. `p072`: un enlace que cambia de corte entre renglones.
- `sw/qa/extras/ooxmlexport/data/tdf104061_tableSectionColumns.docx` (`w118`, 11,2 %): Zeta recorta el título («ry Club of C…») y nuestro lo muestra entero.

**Fuentes y estilos**
- `sc/qa/unit/data/xlsx/Book1_custom.xlsx` (`x005`, 6,2 %): nuestro dibuja los estilos de tabla (colores de encabezado y filas) que Zeta no dibuja.
- `sd/qa/unit/data/pptx/page_transparent_bitmap.pptx` (`p027`, 16,5 %) y `sd/qa/unit/data/pptx/effectOrder.pptx` (`p013`, 5,6 %): fondos con textura o imágenes remuestreadas de otra forma; el texto no cambia.

**Crash**
- Zeta: `p060` (`memory access out of bounds`). Nuestro: ninguno en las tres pasadas de 319 archivos.

### Los 10 peores casos por píxeles (nuestro sin etiquetas contra Zeta, media de páginas)

PNG lado a lado (Zeta a la izquierda, nuestro a la derecha, página 1) en `results\calidad\peores\<id>.png`.

| # | Id | Ruta relativa en el árbol de LibreOffice | Píxeles | Clasificación |
|---|---|---|---|---|
| 1 | `w084` | `sw/qa/extras/ooxmlexport/data/tdf163894.docx` | 29,8 % | Zeta duplica contenido (11 páginas contra 4) |
| 2 | `p027` | `sd/qa/unit/data/pptx/page_transparent_bitmap.pptx` | 16,5 % | textura de fondo remuestreada |
| 3 | `w081` | `sw/qa/extras/tiledrendering/data/comments-on-load.docx` | 13,4 % | métrica de texto (desplazamiento) |
| 4 | `w118` | `sw/qa/extras/ooxmlexport/data/tdf104061_tableSectionColumns.docx` | 11,2 % | Zeta recorta el título |
| 5 | `x055` | `sc/qa/unit/data/xlsx/pass/CVE-2017-0199-2.xlsx` | 10,0 % | archivo malformado |
| 6 | `w074` | `sw/qa/core/text/data/floattable-wrap-empty-para-legacy.docx` | 8,8 % | altura de filas |
| 7 | `w014` | `sw/qa/core/layout/data/floattable-del-empty.docx` | 6,4 % | tabla flotante (diferencia de layout) |
| 8 | `x005` | `sc/qa/unit/data/xlsx/Book1_custom.xlsx` | 6,2 % | nuestro dibuja estilos de tabla que Zeta no |
| 9 | `w001` | `sw/qa/core/text/data/floattable-heading-split-hyphen.docx` | 5,9 % | salto de línea y números de página |
| 10 | `p013` | `sd/qa/unit/data/pptx/effectOrder.pptx` | 5,6 % | imagen remuestreada |

`w014` y `p013` se clasificaron por la métrica de texto (idéntico) y por el tipo de archivo, sin mirar su PNG; de `p027` se miró el PNG (la textura de ladrillo se ve igual a simple vista y los píxeles difieren por el remuestreo). **[NO CONFIRMADO]** la causa exacta de `w014`, `p013` y `p027`.

Archivos con más diferencia de **texto** (palabras): `w084`, `x055` (arriba), `x016` (15 y 16 palabras por puntuación pegada), `w146` (14 y 14, puntos guía), `x013` (12 y 7, números con separadores), `w001` (7 y 2), `w060` (6 y 0, la celda girada), `w064`/`x068`/`p072` (4 y 4, numeración, códigos `Err:508` contra `Err:509`, enlace cortado).

## Fuentes

**Reemplazo de cada fuente de Windows** (un `.docx` sintético por fuente, `results\calidad\fuentes\mapa.txt`; PDF de ZetaOffice contra el nuestro con `rec-B`; y con `rec-A` en los casos marcados):

| Fuente pedida | Zeta | Nuestro (`rec-B`) | Nuestro con fuentes completas (`rec-A`) |
|---|---|---|---|
| Arial | Liberation Sans | Liberation Sans | igual |
| Arial Narrow | Liberation Sans Narrow | Liberation Sans Narrow | igual |
| Calibri | Carlito | Carlito | igual |
| Cambria | Caladea | Caladea | igual |
| Times New Roman | Liberation Serif | Liberation Serif | igual |
| Courier New | Liberation Mono | Liberation Mono | igual |
| Georgia, Garamond, Palatino Linotype | Noto Serif | Noto Serif | igual |
| Consolas | DejaVu Sans Mono | **Noto Serif** | Noto Serif |
| Verdana, Tahoma, Segoe UI, Comic Sans MS, Trebuchet MS, Century Gothic, Impact, Lucida Console, Aptos, Calibri Light, Book Antiqua, Wingdings | Noto Sans | **Noto Serif** | Noto Serif |
| Cambria Math | DejaVu Math TeX Gyre | **Noto Serif** | DejaVu Math TeX Gyre |
| Symbol | OpenSymbol | **Noto Serif** | OpenSymbol |

Lo que cambia, medido:
1. **LibreOffice 26.8 reemplaza las fuentes sans que no conoce por Noto Serif (con serifa) y no por Noto Sans**, y Consolas deja de caer en una monoespaciada. Pasa igual con las fuentes completas (`rec-A`), así que es el comportamiento de la versión, no del recorte. Las fuentes de métrica compatible (Arial, Calibri, Times New Roman, Cambria, Courier New) caen igual que en Zeta.
2. **El recorte `rec-B` agrega dos cambios**: `Cambria Math` y `Symbol` pasan a Noto Serif (con `rec-A` van a DejaVu Math TeX Gyre y OpenSymbol), porque `rec-B` quitó `DejaVuMathTeXGyre.ttf`. **[NO CONFIRMADO]** el efecto sobre el texto extraído de un documento con símbolos de la fuente Symbol (no se probó).
3. En el corpus de LibreOffice, 134 PDF de Zeta usan Carlito y 133 los nuestros; solo en Zeta aparecen DejaVu Math TeX Gyre, DejaVu Serif, Gentium Basic, Linux Libertine, Noto Kufi Arabic, Noto Sans Georgian, Lao y Lisu, David CLM (archivos con esas escrituras); solo en el nuestro, Noto Serif Italic.
4. Todas las fuentes salen embebidas como subconjuntos (como en el spike anterior). El texto de los 8 sintéticos que usan fuentes de métrica compatible coincide.

## Escrituras no latinas

Un `.docx` sintético (`corpus-escrituras\nolatinas.docx`, datos inventados) con una línea y una celda por escritura, convertido con ZetaOffice, con `rec-A` (fuentes completas) y con `rec-B`. Las páginas renderizadas están en `results\calidad\escrituras\img-*.png`.

| Escritura | Texto extraído conserva el Unicode (Zeta / `rec-A` / `rec-B`) | Glifos visibles (Zeta / `rec-A` / `rec-B`) |
|---|---|---|
| Árabe | sí, 61/61 caracteres (los tres iguales) | se ven y con la forma conectada correcta (los tres) |
| Hebreo | sí, 52/52 | se ven (los tres) |
| Cirílico | sí, 57/57 | se ven (los tres) |
| Griego | sí, 66/66 | se ven (los tres) |
| Devanagari | sí, 55/55 | se ven (los tres) |
| Chino | **no**: 23/45 (solo cifras y signos latinos) | Zeta: **cuadritos**; `rec-A` y `rec-B`: **en blanco** (no dibujan nada) |
| Japonés | **no**: 2/46 | igual que el chino |
| Tailandés | **no**: 17/64 | igual que el chino |

- Las salidas de `rec-A` y `rec-B` son **idénticas** (misma imagen, mismo PDF de 53 111 B): quitar las fuentes de árabe, hebreo, etc. no cambia nada en este documento, porque esas escrituras caen en DejaVu Sans y Noto Sans, que se conservaron.
- **Chino, japonés y tailandés fallan en las tres configuraciones**: ningún build trae una fuente que los cubra, y el texto sale sin sus caracteres (el PDF no tiene el Unicode). Eso significa que la app **no podría detectar** un dato en esas escrituras, ni con ZetaOffice ni con nuestro build. No es consecuencia del recorte.
- **[NO CONFIRMADO]**: el orden de lectura del texto en árabe y hebreo (se contó presencia de caracteres, no el orden). El conteo de palabras de Devanagari y Hebreo en el script es bajo (3/12, 11/12) porque `pdfjs` parte los grupos de signos combinados; por caracteres están completos.

## No medido

- Documentos reales (no hay).
- Fidelidad contra Microsoft Office (no hay Office aquí): las diferencias se miden entre los dos conversores, no contra una referencia de Office.
- Píxeles más allá de las 8 primeras páginas de cada archivo, y a una resolución de 36 ppp (sirve para diseño y no para detalles finos de tipografía).
- La causa de la pérdida de texto con etiquetas en 5 hojas de cálculo, y la de la celda girada de `w060`.
- La causa de las diferencias de `w014`, `p013` y `p027` (por texto son idénticas).
- Archivos con más de 5 MB.

## Archivos

- Informe: `C:\Anonly\spikes\lowa\results\CALIDAD.md`.
- Datos: `results\calidad\cmp-zeta-vs-lowa.json`, `cmp-tag-vs-notag.json`, `cmp-zeta-vs-lowatag.json`; salidas crudas y PDF en `results\calidad\raw\`.
- PNG de los 10 peores: `results\calidad\peores\`; otros: `results\calidad\otros\`.
- Escrituras: `results\calidad\escrituras\`; fuentes: `results\calidad\fuentes\`.
- Código: `harness\batch-main.js`, `batch-run.mjs`, `compare.mjs`, `sidebyside.mjs`, `summ.mjs`, `fonts-map.mjs`, `escrituras-check.mjs`, `gen-escrituras.cjs`, `gen-fuentes.cjs`, `run-quality.sh`; corpus en `corpus-lo\`.
