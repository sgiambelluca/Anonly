<!-- CONTEXT: scope=roadmap-1.2-investigacion | dependencias=roadmap/Plan_1.2.md | audiencia=humanos+IA | fase=1.2 -->

# 1.2 — Investigación de librerías por formato (2026-11-23)

## Hallazgos que cambian decisiones

- **pdf-lib está abandonado.** Último release 1.17.1 (2021-11-06) y último commit del 2021-11-12 en la API de commits (https://api.github.com/repos/Hopding/pdf-lib/commits). El repo tuvo un push en 2024-07 (https://api.github.com/repos/Hopding/pdf-lib).
  - Fork activo: `@cantoo/pdf-lib` 2.11.1, MIT, publicado 2026-09-15 (https://registry.npmjs.org/@cantoo/pdf-lib). Pesa 222 KB gzip contra 177 KB de pdf-lib (https://bundlephobia.com/api/size?package=@cantoo/pdf-lib).
  - Aun así, pdf-lib 1.17.1 alcanza para PDF/A y texto invisible (puntos 6 y 7).
- **`xlsx` de npm (0.18.5) está desactualizado y tiene CVEs.**
  - SheetJS dice que la versión fija está solo en su CDN (0.20.3) y que lo de npm es un bug del registro (https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).
  - Los CVE-2023-30533 (prototype pollution, arreglado en 0.19.3) y CVE-2024-22363 (ReDoS, arreglado en 0.20.2) no están corregidos en npm (https://osv.dev/vulnerability/CVE-2023-30533, https://nvd.nist.gov/vuln/detail/CVE-2024-22363).
- **Ningún candidato de navegador corre código dinámico en el camino normal, pero varios bundles traen `new Function`/`Function("return this")`.** Hice grep en los tarballs de npm.
  - `jszip` (setImmediate polyfill), `mammoth.browser.min.js` (plantillas de underscore), `pptx-preview`, `pptxtojson` y `exceljs` los tienen.
  - Son rutas de fallback o dead code en uso normal. **[NO CONFIRMADO en runtime]**: hay que probarlos bajo la CSP sin `unsafe-eval`.
  - Sin `eval`/`new Function` en `docx-preview`, `docx`, `fflate`, `fast-xml-parser`, `@xmldom/xmldom`, `pdf-lib`, `@pdf-lib/fontkit`, `utif2` ni `libheif-js`.

## 1. Office a páginas con fidelidad de diseño

### 1a. LibreOffice headless empaquetado

- **Licencia:** MPL 2.0 en su mayoría, con componentes de terceros bajo otras licencias **[CONOCIMIENTO PREVIO]**.
- **Versión:** estable 26.8.3, subida el 2026-11-11 (https://download.documentfoundation.org/libreoffice/stable/).
- **Tamaño del instalador:**
  - Windows x64 MSI: 359 MB (https://download.documentfoundation.org/libreoffice/stable/26.8.3/win/x86_64/).
  - macOS arm64 dmg: 286 MB (https://download.documentfoundation.org/libreoffice/stable/26.8.3/mac/aarch64/).
  - macOS x64 dmg: 296 MB (https://download.documentfoundation.org/libreoffice/stable/26.8.3/mac/x86_64/).
  - El instalado ocupa bastante más. Se puede recortar a Writer/Calc/Impress, pero no medí cuánto **[NO CONFIRMADO]**.
- **Sin escribir a disco:** `soffice --convert-to` solo trabaja con archivos (entrada y salida en disco). El pipe stdin/stdout existe en `unoserver`/`unoconvert` (`-` = stdin) y exige un listener de LibreOffice corriendo (https://pypi.org/project/unoserver/1.2). Esa vía es Python, no está empaquetada con LibreOffice **[NO CONFIRMADO si se puede evitar Python]**.
  - Chocaría con "el documento vive solo en RAM": hace falta un tmpdir o un ramdisk, y el perfil de usuario de LibreOffice también escribe a disco.
- **Tiempos:** no encontré una medición confiable.
  - Hay reportes de ~2 s de arranque constante y 5–10 s la primera conversión contra <1 s la segunda (https://www.libreoffice.org/lists/users/2016/msg02900.html, https://listarchives.libreoffice.org/global/dev/2014/msg06996.html).
  - Hay reportes de regresiones de velocidad en 25.8.x (https://ask.libreoffice.org/t/headless-pdf-convertion-slows-down-significantly-between-version-25-8-2-and-25-8-4/131735). Habría que medir en el banco propio.
- **Seguridad:** LibreOffice tiene su propio historial de CVEs y modelo de macros. No lo revisé **[NO CONFIRMADO]**.
- **Ventaja:** es la única vía con fidelidad alta para docx, xlsx y pptx a PDF con texto real, y sirve a los tres formatos.
- **Mantenida:** sí.

### 1b. HTML en el navegador

**docx-preview (docxjs)**
- Apache-2.0, 0.4.1, 2026-09-21 (https://registry.npmjs.org/docx-preview/latest). Un solo dep: jszip.
- 48.7 KB gzip (https://bundlephobia.com/api/size?package=docx-preview).
- Mantenida: repo con push en 2026-09 (https://api.github.com/repos/VolodymyrBaydalka/docxjs).
- Soporta encabezados, pies, notas al pie, notas finales e imágenes. Los comentarios y el control de cambios son experimentales.
- Límites declarados (https://raw.githubusercontent.com/VolodymyrBaydalka/docxjs/master/README.md):
  - No soporta campos (la tabla de contenidos no se genera).
  - No hace paginado en tiempo real: depende de saltos manuales o de `lastRenderedPageBreak`, y `ignoreLastRenderedPageBreak` es true por defecto.
  - Está limitado por las capacidades de HTML.
- Sin eval. Sin guía de seguridad en el README.
- Para obtener palabras con caja habría que medir el DOM (`Range.getClientRects`) en la ventana. No corre en un Worker porque necesita DOM.
- Descarga ~977 KB sin comprimir.

**mammoth**
- BSD-2-Clause, 1.13.0, 2026-09-26. Dependencias: lop, jszip, argparse, base64-js, underscore, xmlbuilder, @xmldom/xmldom, dingbat-to-unicode.
- 92.5 KB gzip (https://bundlephobia.com/api/size?package=mammoth).
- Produce HTML semántico, no de diseño: ignora fuentes, tamaños, colores y bordes de tabla. Los cuadros de texto pasan a ser un párrafo aparte. Los comentarios se ignoran por defecto (https://raw.githubusercontent.com/mwilliamson/mammoth.js/master/README.md).
- No sirve para fidelidad de diseño.
- El README advierte: no sanitiza (enlaces `javascript:`), `externalFileAccess` está apagado por defecto, y un documento hostil puede consumir CPU o memoria.

**PowerPoint**
- `pptx-preview`: ISC, 1.0.7, 2025-10-17. Dependencias: jszip, lodash, tslib, uuid, echarts. 392 KB gzip (https://bundlephobia.com/api/size?package=pptx-preview).
  - Trae `new Function` en la ruta de lodash/setImmediate.
  - Mantenimiento dudoso: sin release hace ~13 meses.
- `pptxtojson`: MIT, 3.0.2, 2026-11-22 (muy activo). Dependencias: txml, jszip, tinycolor2. 124 KB gzip (https://bundlephobia.com/api/size?package=pptxtojson).
  - Sirve para extraer texto y posición (JSON con posiciones de formas), no para renderizar.
- Fidelidad relativa de estas librerías: no encontré benchmarks. **[NO CONFIRMADO]** Es esperable que sea baja en SmartArt, gráficos y efectos **[CONOCIMIENTO PREVIO]**.

**Excel a HTML**
- No encontré un renderizador de xlsx a HTML con diseño y mantenido que valga la pena. **[NO CONFIRMADO]** Lo normal sería extraer celdas (SheetJS o exceljs) y armar una tabla propia.
- Hay que decidir cómo se pagina una hoja (corte por columnas y filas): es una decisión de producto.

### 1c. Electron `webContents.printToPDF`

- Devuelve `Promise<Buffer>`, o sea, sin tocar disco (https://www.electronjs.org/docs/latest/api/web-contents).
- Opciones (https://www.electronjs.org/docs/latest/api/structures/print-to-pdf-options):
  - `pageSize` por defecto Letter, o `{width, height}` en pulgadas.
  - Márgenes por defecto ~0.4".
  - `preferCSSPageSize`: si es false, escala el contenido al papel. Con true se respeta `@page`.
  - `landscape` se ignora si la página usa `@page`.
  - `printBackground` por defecto false.
  - `generateTaggedPDF` y `generateDocumentOutline` son experimentales.
- Está alineado con `Page.printToPDF` de CDP y es headless (https://ayakael.net/mirrors/electron/commit/93b39b92b5078071f870b8e97c31e24c1974a49f).
- Electron actual: 45.4.1 (https://registry.npmjs.org/electron/latest).
- **[CONOCIMIENTO PREVIO, NO CONFIRMADO con fuente]:**
  - Chromium emite texto vectorial real (Skia PDF) con texto seleccionable.
  - Pagina HTML con el motor de impresión de Blink.
  - Funciona con ventana `show:false`.
- Límites: depende del HTML de entrada (docx-preview, no paginado en tiempo real), así que la fidelidad la limita ese paso previo.
- Es "gratis" porque Electron ya está en la app. Es la mejor vía para generar el PDF de salida con texto desde HTML, pero no para convertir Office.

### 1d. Otras vías

- **ZetaOffice / zetajs (LibreOffice en WASM).**
  - Licencia MIT para el binding (https://github.com/allotropia/zetajs). `zetajs` 1.2.0 en npm, 2025-05-30, 62 KB sin comprimir (https://registry.npmjs.org/zetajs).
  - Tamaño del WASM: ~32 MB de binario + 15 MB de datos según una charla de 2024 (https://sfscon.it/wp-content/uploads/2024/11/17307577791742024-11-08-Moritz-Duge-Allotropia-LibreOffice-JavaScript-WebWidget-SFSCON-2024.pdf). Cifra posiblemente desactualizada.
  - El README menciona una instancia headless de zetajs para conversión. Los ejemplos usan el CDN de ZetaOffice, o sea, hay que autoalojar los assets.
  - **[NO CONFIRMADO]**: requisitos de SharedArrayBuffer/COOP/COEP (puede chocar con `app://`), compatibilidad con `wasm-unsafe-eval` y CSP, y madurez. Habría que hacer un spike.
  - Si funciona, es la vía más prometedora: LibreOffice sin proceso externo ni disco.
- **OnlyOffice core / x2t.** AGPL v3 (https://github.com/onlyoffice/documentserver). No encontré un build WASM standalone. AGPL es un problema de licencia para distribuir. Descartar salvo revisión legal **[NO CONFIRMADO fuera de licencia]**.
- **`docx2pdf` en JS:** no encontré uno serio **[NO CONFIRMADO]**.

## 2. docx a nivel XML

**Bibliotecas**
- `docx` (crear desde cero): MIT, 9.16.0, 2026-11-19. Dependencias: fflate, nanoid, @types/node. 83 KB gzip, sin eval (https://registry.npmjs.org/docx/latest).
  - No sirve para editar un docx existente (solo crea).
- `jszip`: licencia `(MIT OR GPL-3.0-or-later)`, 3.10.2, 2026-09-08. 28 KB gzip. Arrastra lie, pako, setimmediate, readable-stream (https://registry.npmjs.org/jszip/latest).
- `fflate`: MIT, 0.8.3, 2026-05-16. 12 KB gzip. Sin dependencias, sin eval (https://registry.npmjs.org/fflate/latest). Es el candidato más liviano para zip.
- Parsers XML:
  - `@xmldom/xmldom` 0.9.12 (MIT, 30 KB gzip, 2026-08-21). Tiene varios CVE de inyección XML en 2026, arreglados en 0.8.13/0.9.10/0.9.12 (https://advisories.gitlab.com/npm/@xmldom/xmldom/CVE-2026-41674/). Hay que fijar >= 0.9.12. Preserva el orden y los nodos al re-serializar, útil para reescribir.
  - `fast-xml-parser` 5.12.1 (MIT, 24.7 KB gzip, 2026-11-13). Tuvo CVEs de expansión de entidades DOCTYPE en 2026 (CVE-2026-26278, CVE-2026-33036, CVE-2026-33349, CVE-2026-73569). Hay que fijar >= 5.12 y desactivar `processEntities` (https://osv.dev/vulnerability/GHSA-jmr7-xgp7-cmfj, https://www.tenable.com/cve/CVE-2026-33036).
  - `saxes` 6.0.0 (ISC, 2021): estable pero sin releases desde 2021. Un parser SAX sirve para extraer sin construir el árbol.
- Recomendación de diseño **[mi inferencia]**: `fflate` (límite de tamaño descomprimido propio contra zip bombs) + `@xmldom/xmldom` rechazando DOCTYPE, reescribiendo `document.xml` nodo por nodo.

**Seguridad del zip y del XML**
- Zip bombs, XXE y macros: no encontré una fuente que lo documente para estas librerías puntualmente. **[NO CONFIRMADO]**
  - OOXML no usa DTD en la práctica, así que se debería rechazar `<!DOCTYPE`.
  - `.docm`/`vbaProject.bin` no se interpretan si solo se lee XML. Basta con no copiarlo al docx de salida **[CONOCIMIENTO PREVIO]**.
- `jszip` 3.10.2 es posterior a los CVE históricos (prototype pollution en 3.7.0) **[CONOCIMIENTO PREVIO]**.

**Qué puede esconder datos en un .docx**
- Microsoft Document Inspector lista para Word (https://support.microsoft.com/en-us/office/remove-hidden-data-and-personal-information-by-inspecting-documents-presentations-or-workbooks-356b7b5d-77af-44fe-a07f-9aa4d085966f):
  - comentarios, marcas de revisión (control de cambios), versiones y anotaciones de tinta;
  - propiedades del documento e información personal (usuario, nombre de plantilla, etc.);
  - encabezados, pies y marcas de agua;
  - texto oculto (solo el formateado como oculto: no detecta texto blanco sobre fondo blanco);
  - Custom XML Data;
  - contenido invisible (no detecta objetos tapados por otros).
- Por diseño de OOXML, **[CONOCIMIENTO PREVIO, no encontré una fuente que lo enumere punto por punto]**, hay que revisar además:
  - `docProps/core.xml`, `app.xml` y `custom.xml`;
  - `customXml/`;
  - `comments.xml`, `commentsExtended.xml` y `people.xml`;
  - `w:ins`/`w:del` y `w:moveFrom`/`w:moveTo`;
  - `w:vanish`;
  - campos (`w:instrText`, `w:fldSimple`) con datos en la instrucción y en el resultado;
  - `footnotes.xml`, `endnotes.xml`, `header*.xml` y `footer*.xml`;
  - cuadros de texto (`w:txbxContent`, `mc:AlternateContent` duplica contenido en Choice y Fallback);
  - alt text (`wp:docPr` `descr`/`title`);
  - OLE (`embeddings/`);
  - glosario (`glossary/`);
  - imágenes en `media/` (con EXIF);
  - `w:rsid*` (revela sesiones de edición, no datos personales directos);
  - nombres en `word/settings.xml`, `fontTable` y `webSettings`;
  - hipervínculos y relaciones externas en `_rels`.
- La especificación a citar es ECMA-376 (no la fetcheé). **[NO CONFIRMADO con URL]**
- Un docx anonimizado debería re-empaquetarse sin las partes no reconocidas (lista blanca) en vez de intentar limpiar por lista negra.

## 3. Excel `.xlsx`

- **SheetJS Community Edition (`xlsx`)**
  - Apache-2.0 (https://cdn.sheetjs.com/). Última versión en CDN 0.20.3 según los docs; npm quedó en 0.18.5 (https://registry.npmjs.org/xlsx, https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).
  - Confirmado: npm quedó en 0.18.5 con marca "deprecated" (https://registry.npmjs.org/xlsx). Los docs de SheetJS llaman a eso un bug del registro. El repo de GitHub no se actualiza desde 2024-04 (https://api.github.com/repos/SheetJS/sheetjs). La distribución oficial es solo por CDN/tarball.
  - Alternativa en npm con la versión 0.20.3: `@e965/xlsx` (Apache-2.0, 2024-07-19, fork de terceros, que no es el oficial) (https://registry.npmjs.org/@e965/xlsx). Para ADR: instalar desde el tarball del CDN o mirror vendorizado.
  - Tamaño: 7.5 MB sin comprimir en npm. Min+gzip **[NO CONFIRMADO]** (bundlephobia no se consultó para xlsx).
- **exceljs**
  - MIT, 4.4.0, 2023-10-19 (sin release en 3+ años). 9 dependencias (tmp, uuid, dayjs, jszip, saxes, archiver, fast-csv, unzipper, readable-stream). 256 KB gzip. Bundle trae `new Function` en rutas de lodash/setImmediate (https://registry.npmjs.org/exceljs/latest, https://bundlephobia.com/api/size?package=exceljs).
- **`fast-xml-parser` directo** sobre `sharedStrings.xml` y `sheetN.xml`: es la opción más liviana y controlable. La asignación de estilos y fechas es manual.
- **Partes que esconden datos** (Document Inspector, mismo URL): comentarios y anotaciones, propiedades y rutas (ubicación del documento, ruta de impresora, rutas de publicación web), comentarios sobre nombres definidos y de tabla, conexiones de datos externas inactivas, filas y columnas ocultas, hojas ocultas, Custom XML, contenido invisible, encabezados y pies.
  - No detecta ni quita: vínculos externos, objetos y archivos incrustados, macros/VBA, datos en caché de BI, escenarios, filtros y nombres ocultos.
  - Las filas ocultas dentro de tablas dinámicas se muestran en lugar de quitarse.
- **[CONOCIMIENTO PREVIO]** Además: fórmulas con literales (`<f>` y `<v>` guardan texto), `pivotCacheRecords` (copia de los datos de origen), `connections.xml`, `externalLinks/`, `definedNames`, `calcChain`, hojas "very hidden".

## 4. PowerPoint `.pptx`

- Extraer texto con posición: `pptxtojson` (arriba), MIT, 3.0.2, activa. Alternativa: leer `ppt/slides/slideN.xml` directo (`a:off`/`a:ext` en EMU, 914400 EMU = 1") con fflate y un parser XML. Es más control y menos dependencias.
- Renderizar diapositivas: `pptx-preview` (ISC, 1.0.7, pesada con echarts y sin releases en ~13 meses) o LibreOffice (1a/1d) para fidelidad.
- **Partes que esconden datos** (Document Inspector, mismo URL): comentarios y anotaciones, propiedades y datos de revisión (quién editó y cuándo), contenido invisible en la diapositiva, contenido fuera de diapositiva, notas del orador, Custom XML.
  - No quita objetos incrustados ni macros.
  - Las imágenes en las notas no se pueden quitar.
  - Con animaciones, el contenido fuera de diapositiva no se detecta.
  - El inspector no lista diapositivas ocultas (`show="0"`): hay que revisarlas aparte.
- **[CONOCIMIENTO PREVIO]**: `ppt/notesSlides`, `ppt/comments` o `ppt/comments/modernComment_*.xml`, `commentAuthors.xml`, y también los datos de gráficos incrustados (`charts/*.xml` con workbook en `embeddings/`).

## 5. Imágenes sueltas

- `ImageDecoder` está disponible en Dedicated Workers y solo en contextos seguros, con soporte limitado (solo Chromium) (https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder). Se consulta con `ImageDecoder.isTypeSupported()`.
- **[CONOCIMIENTO PREVIO, no pude confirmar con fuente]**: `createImageBitmap` en Worker decodifica PNG, JPEG, WebP, GIF, BMP, AVIF e ICO. No decodifica TIFF ni HEIC. Conviene verificar con `isTypeSupported` en el Electron real.
- **TIFF**
  - `utif2` 4.1.0: MIT, 2023-05-06, 36.7 KB gzip, depende de pako, sin eval (https://registry.npmjs.org/utif2/latest, https://bundlephobia.com/api/size?package=utif2). Sin releases hace 3+ años.
  - `utif` 3.1.0 (2019) es el original. `tiff` 7.1.3 (MIT, 2025-12-18, deps fflate e iobuffer) está más activa (https://registry.npmjs.org/tiff/latest).
  - Multipágina: `utif2` y `tiff` decodifican por IFD (páginas). No lo probé **[NO CONFIRMADO]**.
- **HEIC**
  - `libheif-js` 1.23.5: LGPL-3.0, 2026-10-04, ~9 MB sin comprimir, WASM incluido, sin eval (https://registry.npmjs.org/libheif-js/latest).
  - `heic-decode` 2.1.0 (ISC) es un envoltorio fino sobre libheif-js.
  - LGPL: hay que permitir el reemplazo de la librería (link dinámico). Es compatible con una app Electron si el WASM va como archivo separado; eso lo debe revisar legal. Libheif depende de decodificadores HEVC (patentes) **[CONOCIMIENTO PREVIO]**.
  - `wasm-unsafe-eval` de la CSP lo permite **[NO CONFIRMADO en runtime]**.
- **EXIF/GPS:** al decodificar a bitmap y re-renderizar a lienzo (que es lo que hace el pipeline, PDF 100 % imagen), los metadatos no se copian.
  - Cuidar la orientación EXIF, que `createImageBitmap` aplica por defecto (`imageOrientation: "from-image"`) **[CONOCIMIENTO PREVIO]**.
  - Si algún día se incrusta el JPEG original sin recodificar, habría que quitar el EXIF a mano. Hoy no corresponde.

## 6. PDF/A con pdf-lib

- **Licencia:** MIT. 177 KB gzip. Dependencias: @pdf-lib/standard-fonts, @pdf-lib/upng, pako, tslib.
- Viabilidad: el issue #230 de pdf-lib (cerrado en 2021-09) confirma que se puede, con trabajo manual y validado con veraPDF para PDF/A-3B (https://github.com/Hopding/pdf-lib/issues/230).
  - Pasos que reportan los comentaristas: XMP en `Metadata` del catálogo con `pdfaid:part`/`conformance`; `ID` en el trailer; OutputIntent (`GTS_PDFA1`) con ICC sRGB v2 embebido; `F: 4` (Print) en anotaciones de enlace; `CIDToGIDMap: 'Identity'` en las fuentes CID.
  - En 1.17.1 ya trae `CIDToGIDMap: 'Identity'` en `CustomFontEmbedder.js` (lo vi en el tarball), así que ese bloqueo probablemente ya no aplica. **[NO CONFIRMADO con veraPDF]**
  - Sin un ejemplo completo y verificado en el hilo (los snippets son "no verificados"). Un comentario de enero de 2025 pidiendo un ejemplo no tiene respuesta visible.
- El README de pdf-lib no menciona PDF/A (https://raw.githubusercontent.com/Hopding/pdf-lib/master/README.md). La API trae `setProducer`, `setCreationDate`, etc. (en el tarball), pero no hay API de XMP ni de OutputIntent: se arma con `PDFContext`/`PDFDict` a mano.
- Para la salida actual (imagen JPEG/PNG sin transparencia, sin fuentes), PDF/A-2b es más simple que con fuentes. Con capa de texto (punto 7) se suman las reglas de fuentes: todas las fuentes embebidas (un subset está permitido) y un ToUnicode válido.
- **Perfil ICC sRGB redistribuible:**
  - Compact-ICC-Profiles: dedicados al dominio público (CC0), con variantes v2 y v4 (https://github.com/saucecontrol/Compact-ICC-Profiles). Para PDF/A-1/2 conviene v2 **[CONOCIMIENTO PREVIO; una fuente de Oracle dice versión mayor < 4]**.
  - `sRGB2014.icc` del ICC: se puede copiar, distribuir, embeber y vender sin restricciones, sin modificar la identificación (https://doc.qt.io/qt/qtgui-attribution-icc-srgb-color-profile.html, https://www.color.org/srgbprofiles.html redirige a https://registry.color.org/rgb-registry/srgbprofiles, que no pude leer).
  - Ghostscript `default_rgb.icc`: **[NO CONFIRMADO]**.
- **veraPDF:** doble licencia GPLv3+ / MPLv2+ (https://aur.archlinux.org/packages/verapdf, https://badges.mvnrepository.com/artifact/org.verapdf.apps/cli). CLI en Java, hay imagen Docker `verapdf/cli` (https://hub.docker.com/r/verapdf/cli). Corre en CI sin problema (solo en CI: es una herramienta de desarrollo, no se distribuye). Última versión estable: no la confirmé; la página es https://software.verapdf.org/ **[NO CONFIRMADO]**.

## 7. Texto preservado en PDF

- Capa de texto invisible: es la técnica estándar. OCRmyPDF la hace con render mode 3 (Tr 3) y una fuente "GlyphLessFont" embebida (https://ocrmypdf.readthedocs.io/en/v16.0.0/advanced.html, https://aiptimizer.github.io/TurboOCR-python/latest/explanation/searchable_pdf_internals/).
- pdf-lib 1.17.1 trae `setTextRenderingMode` y el enum `TextRenderingMode` (lo vi en `api/operators.d.ts` del tarball), usable con `page.pushOperators(...)`. Con eso se escribe texto en modo 3 sobre la imagen. Se puede posicionar cada palabra en su caja en puntos PDF, que es justo lo que tiene el pipeline (palabras con coordenadas).
- Unicode con acentos: las fuentes estándar solo cubren WinAnsi (218 caracteres latinos); lo demás necesita una fuente embebida (README de pdf-lib). Español y portugués con acentos entran en WinAnsi, así que para el texto invisible de estos idiomas se puede usar una fuente estándar **[mi inferencia]**; pero PDF/A exige fuentes embebidas, y las 14 estándar no lo están, por lo que hace falta embeber una (ver abajo).
  - `@pdf-lib/fontkit` 1.1.1: MIT, 2020-11-28 (sin releases en 6 años), 342 KB gzip, depende de pako, sin eval (https://registry.npmjs.org/@pdf-lib/fontkit/latest, https://bundlephobia.com/api/size?package=@pdf-lib/fontkit). Se registra con `registerFontkit` y `subset: true` reduce tamaño (puede fallar en algunas fuentes).
  - Fuente: **[NO CONFIRMADO]** qué fuente libre usar y su tamaño (candidatas habituales: Noto Sans, DejaVu o Liberation, con licencia OFL o similar **[CONOCIMIENTO PREVIO]**). Una fuente sin glifos visibles (estilo GlyphLessFont) también se puede generar, pero no encontré una versión lista en JS.
- Estado de mantenimiento: 1.17.1 (2021-11-06) es el último release. Fork mantenido: `@cantoo/pdf-lib` 2.11.1 (2026-09-15), con `fflate` en vez de `pako` (https://registry.npmjs.org/@cantoo/pdf-lib/latest). Alternativa a probar si el ADR no quiere depender de una librería sin releases.

## Tabla resumen

| Opción | Licencia | Tamaño | Corre sin red/eval | Mantenida | Riesgo principal |
|---|---|---|---|---|---|
| LibreOffice headless | MPL 2.0 (resto **[CONOCIMIENTO PREVIO]**) | 359 MB (Win MSI), 286–296 MB (mac dmg) | Sin red sí; no es JS, es un proceso externo | Sí (26.8.3, 2026-11) | Exige archivos y un perfil en disco; peso del instalador |
| ZetaOffice / zetajs | MIT (binding) | ~32 MB WASM + 15 MB datos (charla 2024) | **[NO CONFIRMADO]** (COOP/COEP, CSP) | Sí (1.2.0, 2025-05) | Madurez y requisitos de SharedArrayBuffer sin confirmar |
| OnlyOffice core/x2t | AGPL v3 | No medido | No encontré build WASM | Sí | Licencia AGPL |
| docx-preview | Apache-2.0 | 48.7 KB gzip | Sí, sin eval (necesita DOM, no Worker) | Sí (0.4.1, 2026-09) | Paginado no en tiempo real, sin campos |
| mammoth | BSD-2-Clause | 92.5 KB gzip | `new Function` en plantillas de underscore **[NO CONFIRMADO en runtime]** | Sí (1.13.0, 2026-09) | No conserva diseño; no sanitiza |
| pptx-preview | ISC | 392 KB gzip | `new Function` en lodash **[NO CONFIRMADO en runtime]** | Dudosa (2025-10) | Fidelidad desconocida, peso por echarts |
| pptxtojson | MIT | 124 KB gzip | `new Function` en setImmediate (fallback) | Sí (3.0.2, 2026-11) | Solo extrae, no renderiza |
| Electron printToPDF | MIT (Electron) | 0 (ya está) | Sí, Buffer en RAM | Sí (Electron 45.4.1) | Depende del HTML de entrada; texto vectorial **[CONOCIMIENTO PREVIO]** |
| docx (crear) | MIT | 83 KB gzip | Sí | Sí (9.16.0, 2026-11) | No edita docx existentes |
| fflate | MIT | 12 KB gzip | Sí | Sí (0.8.3, 2026-05) | Zip bombs: límites propios **[NO CONFIRMADO]** |
| jszip | MIT o GPL-3.0+ | 28 KB gzip | `new Function` solo en fallback de setImmediate | Sí (3.10.2, 2026-09) | Zip bombs; elegir licencia MIT |
| @xmldom/xmldom | MIT | 30 KB gzip | Sí | Sí (0.9.12, 2026-08) | Varios CVE de inyección XML en 2026: fijar >= 0.9.12 |
| fast-xml-parser | MIT | 24.7 KB gzip | Sí | Sí (5.12.1, 2026-11) | CVEs de expansión de entidades: fijar >= 5.12, sin DOCTYPE |
| xlsx (npm) | Apache-2.0 | 7.5 MB sin comprimir | **[NO CONFIRMADO]** | npm desactualizado (0.18.5, deprecado); 0.20.3 solo en CDN | CVE-2023-30533 y CVE-2024-22363 sin arreglo en npm |
| exceljs | MIT | 256 KB gzip | `new Function` en lodash **[NO CONFIRMADO en runtime]** | No (2023-10) | 9 dependencias, sin releases hace 3 años |
| utif2 | MIT | 36.7 KB gzip | Sí | Sin releases desde 2023-05 | Multipágina sin probar |
| tiff | MIT | 136 KB sin comprimir | Sí **[NO CONFIRMADO]** | Sí (7.1.3, 2025-12) | Sin probar |
| libheif-js | LGPL-3.0 | ~9 MB sin comprimir | Sí, sin eval (WASM) | Sí (1.23.5, 2026-10) | LGPL y patentes HEVC |
| pdf-lib | MIT | 177 KB gzip | Sí | No (último release 2021-11) | PDF/A manual y sin validar |
| @cantoo/pdf-lib (fork) | MIT | 222 KB gzip | Sí **[NO CONFIRMADO]** | Sí (2.11.1, 2026-09) | Fork de una empresa, no hay garantía de continuidad |
| @pdf-lib/fontkit | MIT | 342 KB gzip | Sí | No (2020-11) | Peso; subset puede fallar |
| ICC sRGB (Compact-ICC) | CC0 | pequeño (**[NO CONFIRMADO]** tamaño) | n/a | n/a | Elegir v2 para PDF/A |
| veraPDF | GPLv3+ / MPLv2+ | No medido | Solo CI, no se distribuye | Sí **[NO CONFIRMADO versión]** | Necesita Java en CI |

## Pendientes de verificar antes de escribir los ADR

1. Spike de ZetaOffice bajo la CSP y el protocolo `app://` (SharedArrayBuffer, `wasm-unsafe-eval`, peso real).
2. Medir tiempos de LibreOffice headless en el banco, y decidir si se tolera un tmpdir.
3. PDF/A-2b con pdf-lib: probarlo con veraPDF antes de comprometerse.
4. Confirmar bajo la CSP que los `new Function` de jszip, mammoth, pptx-preview y exceljs no se ejecutan.
5. Confirmar `isTypeSupported` y los formatos en el Electron real.
6. Citar la especificación ECMA-376 para la lista de partes que esconden datos.
7. Licencia legal de LGPL (libheif-js) y de la fuente que se embeba.
