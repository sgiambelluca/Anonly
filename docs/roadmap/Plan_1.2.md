<!-- CONTEXT: scope=roadmap-1.2 | dependencias=roadmap/Roadmap_1.x.md,roadmap/formatos/Investigacion_Librerias_2026-11-23.md,adr/ADR-004-Rendering.md,adr/ADR-009-Export-Strategy.md,adr/ADR-059-Leyenda-Opcional-De-Marcadores.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,core/Contracts.md,core/PDF_Engine.md,core/Render_Engine.md,core/Export_Engine.md,core/Orchestrator.md,architecture/03_Data_Model.md,architecture/06_Pipeline.md,architecture/08_Security_Model.md,ui/Components.md,ui/React_Client.md | audiencia=humanos+IA | fase=1.2 -->

# 1.2 — Otros formatos: plan

> Cómo se arma la 1.2: que la app tome Word, Excel, PowerPoint e imágenes
> además de PDF, que devuelva un Word anonimizado, y que el PDF exportado
> pueda llevar texto o salir como PDF/A. Es el documento de trabajo del
> planificador; las decisiones del mantenedor van con su fecha, y lo que no
> tiene fecha es propuesta.

**Estado (2026-11-23):** borrador. El mantenedor puso la 1.2 como próxima
versión (ADR-237) y tomó las primeras decisiones de alcance (§3). Hay un
relevamiento del código y una investigación de librerías (§4 y §5). Todavía
no hay ningún ADR de la 1.2: antes hacen falta las decisiones que quedan en
§7 y los spikes de §8. El primero es el del conversor de Office.

## 1. Alcance

| Punto del roadmap (`Roadmap_1.x.md` §5) | Queda en la 1.2 |
|---|---|
| Word (`.docx`): entrada y salida | Sí. Sale el mismo Word, limpio (§3) |
| Imágenes sueltas como entrada | Sí: PNG, JPEG, WebP, GIF, BMP, TIFF y HEIC (§3) |
| Excel (`.xlsx`) como entrada | Sí, como páginas impresas (§3) |
| PowerPoint (`.pptx`) como entrada | Sí |
| El formato de salida se elige en el diálogo de exportar | Sí |
| Export con texto preservado | Sí |
| PDF/A | Sí |

**Sale todo junto en una sola 1.2** (§3). Los frentes de §9 son el orden de
trabajo, no entregas.

## 2. Conceptos

- **Formato de origen**: el tipo de archivo que eligió el usuario: PDF,
  Word, Excel, PowerPoint o imagen.
- **Documento paginado**: lo que hoy recorre todo el pipeline. Páginas con
  ancho y alto en puntos, y palabras con su caja (`03_Data_Model.md`). La
  propuesta de §6 es que todo formato llegue a esto.
- **Conversión**: el paso que convierte un formato de origen en un documento
  paginado. Hoy no existe, porque la única entrada es PDF.
- **Salida**: el archivo que se exporta. Hoy es uno solo, un PDF 100 %
  imagen. La 1.2 suma tres:
  - **PDF imagen**: el de hoy.
  - **PDF con texto**: la misma imagen, con una capa de texto invisible
    encima que permite seleccionar y buscar.
  - **Word limpio**: el `.docx` original con los datos reemplazados y sin
    las partes que esconden datos.
  - **PDF/A** no es una salida aparte: es una variante de cualquiera de los
    dos PDF.

## 3. Decisiones del mantenedor

| Decisión | Fecha |
|---|---|
| La 1.2 es «Otros formatos» y es la próxima versión. Todo el esfuerzo va acá; los países quedan sin versión | 11-23 (ADR-237) |
| El texto preservado y PDF/A se quedan en la 1.2 | 11-23 |
| Entran los formatos actuales de Office: `.docx`, `.xlsx` y `.pptx`, más imágenes. No entran los binarios viejos (`.doc`, `.xls`, `.ppt`) ni OpenDocument (`.odt`, `.ods`, `.odp`) | 11-23 |
| Cuando entra un Word, sale **el mismo Word, limpio**: conserva el diseño, los estilos y las tablas, con los datos reemplazados. Se rearma con una lista cerrada de partes y se borra lo que esconde datos | 11-23 |
| Un Excel se ve y se exporta **como páginas impresas**, en el mismo visor | 11-23 |
| **El conversor de Office que se prueba primero es LibreOffice en WASM** (ZetaOffice), con un spike (§8). Si falla, el planificador vuelve con los números antes de elegir otro | 11-23 |
| **Las imágenes adentro de un Word o un PowerPoint pasan por OCR y sus datos se tapan.** En el Word limpio, la imagen se reemplaza por su versión tapada | 11-23 |
| **Imágenes sueltas: PNG, JPEG, WebP, GIF, BMP, TIFF y HEIC.** HEIC suma una librería LGPL que depende de un códec con patentes: su ADR revisa las dos cosas, y si no se pueden resolver sin costo, vuelve al mantenedor | 11-23 |
| **Si una detección no se puede ubicar en el XML del Word, el Word no se exporta.** La app dice qué dato no pudo ubicar y ofrece exportar en PDF. Nunca sale un Word con un dato a la vista | 11-23 |
| **Todo sale junto en una sola 1.2**, como dice el roadmap §2 | 11-23 |

### 3.1 Google Docs, Sheets y Slides

El mantenedor preguntó el 2026-11-23 si los documentos de Google cambian
algo de formato. **No son un formato nuevo**:

- Un documento de Google vive en la nube. En la computadora, Google Drive
  para escritorio lo muestra como un acceso directo (`.gdoc`, `.gsheet`,
  `.gslides`) que solo guarda el enlace, no el contenido. Leerlo exigiría
  red, y la app no la usa.
- Para trabajarlo con Anonly, el usuario lo descarga como Word, Excel o
  PowerPoint (Archivo → Descargar). Eso da un `.docx`, `.xlsx` o `.pptx`
  normal, que entra por el mismo camino que uno hecho con Office.
- Lo que sí cambia es **cómo viene escrito** ese archivo: Google exporta
  menos partes que Office, y las sugerencias pueden quedar como control de
  cambios. Por eso el corpus de prueba de cada formato lleva archivos
  exportados desde Google, además de los de Office (§8).

**Propuesta del planificador:** si el usuario suelta un `.gdoc`, `.gsheet` o
`.gslides`, la zona de carga no dice solo «formato no admitido»: explica que
se descarga desde Google como Word, Excel o PowerPoint. Pendiente de la
aprobación del mantenedor (§7).

## 4. Cómo está hoy

Relevado el 2026-11-23. Todo el producto supone que entra un PDF y sale un
PDF 100 % imagen. Los puntos que la 1.2 tiene que abrir:

- **Entrada.** La zona de carga y el botón de importar aceptan solo
  `application/pdf` (`DropZone.tsx`, `ImportButton.tsx`, `looksLikePdf` en
  `dropZoneState.ts`). Los bytes llegan al Core como un `ArrayBuffer`, sin
  ruta de disco (`core-adapter/actions.ts`, `importDocument`). La shell no
  tiene diálogo nativo ni IPC para abrir archivos.
- **Contrato.**
  - `ImportDocumentInput.buffer` está documentado como «PDF binario», y
    `DocumentImported` no lleva el formato (`Contracts.md`).
  - Todos los códigos de error de documento son de PDF: `PDF_INVALID`,
    `PDF_CORRUPTED`, `PDF_PASSWORD_REQUIRED`, `PDF_PAGE_ROTATED` y
    `PDF_TIMEOUT`. No hay uno neutro para «formato no admitido».
  - `DocumentMetadata.pdfVersion` es obligatorio, y `Word.source` es
    `"pdf" | "ocr"`.
  - `Document` no tiene un campo de formato de origen.
- **Pipeline.** El Orchestrator manda el buffer al pool `pdf` y después al
  Render Engine, que lo vuelve a abrir con pdf.js para dibujar y rasterizar
  (`orchestrator.ts`, `runPipelineFrom` y `ensureRenderDocumentLoaded`). OCR,
  Regex, NER y Grouping no tocan pdf.js: trabajan sobre palabras y páginas.
- **Modelo.** Páginas fijas, medidas en puntos PDF, con `pageCount ===
  pages.length` (`03_Data_Model.md`).
- **Visor.** El cliente nunca ve el PDF: recibe una imagen por página. El
  alto de página es un valor fijo con proporción A4 (`pageLayout.ts`); la
  selección sí usa el tamaño real. Una página apaisada o carta se dibujaría
  estirada a A4. Falta confirmarlo con la app.
- **Export.**
  - `ExportOptions` no tiene formato de salida (`shared/src/types.ts`).
  - El diálogo fija JPEG, calidad 0,92 y 150 dpi, y el nombre siempre
    termina en `.pdf` (`exportValidation.ts`).
  - pdf-lib arma el PDF imagen (`export-engine/src/worker/assembler.ts`).
- **Garantías que la 1.2 toca.**
  - ADR-004 y ADR-009: el export se reconstruye desde cero y es 100 %
    imagen.
  - ADR-059 §4: la hoja de referencia se rasteriza para sostener esa
    garantía.
  - `08_Security_Model.md` S-3 y S-5: no se recupera el original ni sus
    metadatos.
  - Los tests que lo fijan: `tests/security/security.test.ts` («export has
    no text layer») y el gate de ADR-148.
- **Memoria.** El buffer original se retiene en el Core y se copia a cada
  RenderWorker hasta cerrar el documento (`05_Worker_Architecture.md`). Los
  techos de ADR-192 se midieron con PDF.

## 5. Lo que dice la investigación de librerías

El informe completo, con la fuente de cada dato y lo que quedó sin
confirmar, está en
[`formatos/Investigacion_Librerias_2026-11-23.md`](./formatos/Investigacion_Librerias_2026-11-23.md).
Lo que más pesa:

- **No hay una vía liviana con buena fidelidad para los tres formatos de
  Office.**
  - **LibreOffice empaquetado**: alta fidelidad en Word, Excel y PowerPoint.
    Pero pesa unos 290 a 360 MB, y su conversión trabaja con archivos en
    disco. Eso choca con «el documento vive solo en RAM»
    (`08_Security_Model.md`).
  - **LibreOffice en WASM (ZetaOffice)**: la misma fidelidad, unos 50 MB,
    sin proceso externo ni disco. Sin confirmar: si corre bajo la CSP y el
    protocolo `app://`, su peso real y su madurez.
  - **Renderizadores en JavaScript**:
    - `docx-preview` da un Word razonable, pero no pagina como Word.
    - Para Excel no hay un renderizador serio.
    - Para PowerPoint hay librerías de calidad dudosa.
    - Es la vía más liviana y la de más código propio.
- **pdf-lib no tiene releases desde 2021.** Alcanza para el texto invisible
  y para PDF/A, con trabajo manual. Hay un fork mantenido
  (`@cantoo/pdf-lib`).
- **El `xlsx` de npm está desactualizado y con CVE sin corregir.** La versión
  corregida se distribuye solo fuera de npm.
- **Leer y reescribir un `.docx` es viable** con un descompresor liviano
  (`fflate`) y un parser XML que rechace `DOCTYPE`. Las versiones a fijar
  están en el informe, por CVE recientes.
- **Imágenes**: Chromium decodifica PNG, JPEG, WebP, GIF, BMP y AVIF. TIFF
  necesita una librería chica. HEIC necesita una librería LGPL que además
  depende de un códec con patentes.

## 6. Arquitectura propuesta por el planificador

Sin decidir. Cada punto termina en un ADR (§10).

### 6.1 Todo formato entra como un documento paginado

La conversión ocurre al entrar, y después el pipeline sigue igual: OCR,
detección, agrupación, visor y export trabajan sobre páginas y palabras,
como hoy. Así la 1.2 no reescribe los siete motores, y la cola de la 1.3
recibe documentos que ya son todos iguales.

- **Imágenes sueltas**: cada imagen, o cada página de un TIFF, es una página
  escaneada. El camino es el de un PDF escaneado: OCR, detección y export.
- **Word, Excel y PowerPoint**: el conversor produce un PDF con texto real.
  El pipeline actual lo lee como cualquier PDF con texto, sin OCR, salvo las
  imágenes que vengan adentro.
- El documento guarda su **formato de origen**, para que la interfaz lo
  nombre bien y el export sepa qué salidas ofrecer.

### 6.2 El Word limpio necesita una segunda fuente de texto

El visor y el PDF salen de las páginas convertidas. El Word limpio, en
cambio, sale del XML del `.docx` original. Para reemplazar un dato en el
Word hay que saber en qué pedazo del XML está cada detección.

- Propuesta: un motor nuevo lee el XML del `.docx` y arma su texto, párrafo
  por párrafo. Las detecciones de las páginas se alinean con ese texto.
- El riesgo está en lo que el XML y la página no muestran igual:
  numeraciones, campos, guiones de corte y texto oculto. La alineación se
  mide antes de adoptarla (§8).
- Una detección que no se puede ubicar en el XML **no puede quedar en
  claro**. El mantenedor decidió que en ese caso el Word no se exporta y se
  ofrece el PDF (§3).

### 6.3 «No recuperable» en el Word limpio

El mantenedor eligió el rearmado con una lista cerrada de partes (§3). La
propuesta de qué entra y qué no:

- **Entra**: el cuerpo, los estilos, la numeración, la tabla de fuentes, los
  encabezados y pies, y las notas, todo con los datos reemplazados.
- **No entra nunca**:
  - los comentarios y sus autores, y los metadatos (`docProps`);
  - `customXml`, los objetos incrustados, el glosario y los vínculos
    externos;
  - las macros;
  - los identificadores de sesión de edición (`w:rsid`).
- **Se resuelve antes de exportar**:
  - el control de cambios: se aplican las inserciones y se descartan las
    eliminaciones, para que el texto borrado no viaje;
  - el texto oculto se quita;
  - los campos se reemplazan por su resultado ya anonimizado;
  - el contenido duplicado en `mc:AlternateContent` se procesa en las dos
    versiones, o se deja una sola.
- **Imágenes adentro del Word**: pasan por OCR y se reemplazan por su
  versión tapada (§3). La imagen nueva se codifica de cero, sin los
  metadatos de la original.
- **Gate propio**, como pide el roadmap: se abre el Word exportado, se
  extrae todo su texto, incluidas las partes que no se ven, y se verifica
  que no quede ningún valor original. Es el equivalente de ADR-148 para el
  Word.

### 6.4 Texto preservado

Es la técnica de los PDF escaneados con OCR: la imagen anonimizada de
siempre y, encima, una capa de texto invisible con las palabras de la
página.

- Las palabras tapadas no van en la capa: en su lugar va el texto del
  reemplazo, en la misma caja.
- La garantía cambia: el PDF deja de ser 100 % imagen, pero su texto es
  exactamente el que se ve. Lo que la detección no encontró pasa a ser texto
  que se puede copiar, cuando hoy solo se lee en la imagen. Es el mismo
  cambio de garantía que el export a `.md` de la 1.4.
- Enmienda ADR-004, ADR-009 y ADR-059 §4, y S-3 de `08_Security_Model.md`.
  El test «export has no text layer» pasa a valer solo para el PDF imagen.

### 6.5 PDF/A

Una variante de los dos PDF: metadatos XMP con la parte y la conformidad,
un perfil de color sRGB embebido, el identificador del documento y fuentes
embebidas. Con texto, la capa invisible necesita una fuente embebida. Se
valida con veraPDF en CI, que es una herramienta de desarrollo y no viaja
con la app.

### 6.6 Qué salida corresponde a cada entrada

| Entra | Puede salir |
|---|---|
| PDF | PDF imagen, PDF con texto, cualquiera de los dos como PDF/A |
| Word | Word limpio, más las salidas de PDF |
| Excel, PowerPoint, imagen | Las salidas de PDF |

## 7. Decisiones abiertas para el mantenedor

Resueltas el 2026-11-23, y pasadas a §3: el conversor que se prueba
primero, las imágenes adentro de un documento, los formatos de imagen y la
detección que no se ubica en el XML del Word.

Quedan:

1. **El aviso de los accesos directos de Google** (§3.1).
2. **Cómo se elige la salida en el diálogo de exportar**, y si «PDF con
   texto» o «PDF imagen» es el valor por defecto. Va con un lienzo de
   diseño, en claro y en oscuro.
3. **El conversor definitivo**, con los números del spike de ZetaOffice. Si
   el spike falla, la elección entre LibreOffice empaquetado y
   renderizadores en JavaScript vuelve al mantenedor, con su peso de
   instalador y su fidelidad.

## 8. Spikes y mediciones antes de los ADR

- **Conversor**: probar ZetaOffice bajo la CSP y `app://`, con su peso real,
  el tiempo de conversión en el banco Windows y la fidelidad. La fidelidad se
  mide sobre un corpus sintético de Word, Excel y PowerPoint hecho con
  Office y exportado desde Google.
- **Alineación XML–página del Word** (§6.2): sobre el mismo corpus, cuántas
  detecciones se ubican en el XML y cuáles no.
- **PDF/A**: un PDF imagen y uno con texto, armados con pdf-lib y validados
  con veraPDF.
- **CSP**: confirmar que ninguna librería candidata ejecuta código dinámico
  bajo la CSP sin `unsafe-eval`.
- **Imágenes**: qué decodifica el Electron real (`ImageDecoder.isTypeSupported`),
  un TIFF de varias páginas, y HEIC con su WASM bajo la CSP.
- **Memoria**: el pico de un documento convertido. El conversor suma su
  propia memoria a la del pipeline, y los techos de ADR-192 son por perfil.
- **Documentos reales**: además de los sintéticos, por `ANONLY_REAL_DOC_*`.
  Cada informe dice qué sale solo de sintéticos.

## 9. Frentes, orden tentativo

1. **Contrato**: el formato de origen en `ImportDocumentInput`, `Document` y
   `DocumentImported`; un código de error neutro para «formato no
   admitido»; el formato de salida en `ExportOptions` y en
   `ExportFinished`. Va primero, con su ADR.
2. **Imágenes sueltas**: es el caso más barato y prueba el camino del
   formato de origen de punta a punta.
3. **Word**: entrada por el conversor, visor y salida PDF.
4. **Word limpio**: lectura del XML, alineación, rearmado y su gate.
5. **Excel y PowerPoint**: entrada por el conversor y paginado.
6. **Texto preservado y PDF/A**: en el Export Engine.
7. **Interfaz**: la zona de carga, los textos que hoy dicen «PDF», el
   diálogo de exportar con la salida, y el visor con páginas que no son A4.
8. **Cierre**: E2E por formato, suite pesada y memoria con documentos
   convertidos.

## 10. Mapa de ADR, tentativo

Se numeran al escribirse.

| Tema | Modifica |
|---|---|
| El formato de origen y el formato de salida en el contrato | `Contracts.md`, `03_Data_Model.md` |
| El conversor de Office y dónde corre | `05_Worker_Architecture.md`, `08_Security_Model.md` si toca disco |
| Imágenes sueltas: qué formatos y cómo se decodifican | PDF Engine o un motor nuevo |
| Qué significa «no recuperable» en un Word, y su gate | ADR-009, `08_Security_Model.md` |
| El PDF con texto preservado | ADR-004, ADR-009, ADR-059 §4, `08_Security_Model.md` S-3 |
| PDF/A | ADR-009 |
| Seguir con pdf-lib o pasar al fork mantenido | Export Engine |
| El paginado de Excel y de PowerPoint | — |
| La interfaz de carga y de exportar en la 1.2 | `Components.md`, `UX_Guidelines.md` |

Cada dependencia nueva lleva su ADR (R-12).

## 11. Fuera de la 1.2

- Los binarios viejos de Office y OpenDocument (§3).
- Excel y PowerPoint como **salida**: solo salen como PDF.
- Abrir documentos de Google sin descargarlos (§3.1).
- La cola de varios documentos: es la 1.3.
