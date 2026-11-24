<!-- CONTEXT: scope=roadmap-1.2 | dependencias=roadmap/Roadmap_1.x.md,roadmap/formatos/Investigacion_Librerias_2026-11-23.md,adr/ADR-004-Rendering.md,adr/ADR-009-Export-Strategy.md,adr/ADR-059-Leyenda-Opcional-De-Marcadores.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,core/Contracts.md,core/PDF_Engine.md,core/Render_Engine.md,core/Export_Engine.md,core/Orchestrator.md,architecture/03_Data_Model.md,architecture/06_Pipeline.md,architecture/08_Security_Model.md,ui/Components.md,ui/React_Client.md | audiencia=humanos+IA | fase=1.2 -->

# 1.2 — Otros formatos: plan

> Cómo se arma la 1.2: que la app tome Word, Excel, PowerPoint e imágenes
> además de PDF, que devuelva un Word anonimizado, y que el PDF exportado
> pueda llevar texto o salir como PDF/A. Es el documento de trabajo del
> planificador; las decisiones del mantenedor van con su fecha, y lo que no
> tiene fecha es propuesta.

**Estado (2026-11-23):** borrador. El mantenedor puso la 1.2 como próxima
versión (ADR-237) y tomó las decisiones de alcance (§3). Hay un
relevamiento del código y una investigación de librerías (§4 y §5).

- **ADR-238**, el contrato del formato de origen y de la salida, y
  **ADR-239**, las imágenes sueltas y el Convert Engine: aceptados por el
  mantenedor el 2026-11-23, y pasados a los contratos y los specs el mismo
  día. El spec nuevo es `core/Convert_Engine.md`. Los frentes 1 y 2 se
  pueden implementar.
- **Los spikes del conversor de Office y de imágenes**: hechos. Son el de
  ZetaOffice (§8.1), el de imágenes (§8.2) y el de compilar LibreOffice
  nosotros (§8.3). El mantenedor eligió el compilado por nosotros, con
  una comparación de calidad contra ZetaOffice antes de adoptarlo (§3).
  La comparación está hecha (§8.4), y también las pruebas de casos borde
  que pidió después (§8.5).
- **ADR-240**, el conversor de Office, y **ADR-242**, el Office con
  contraseña: aceptados por el mantenedor el 2026-11-24. Falta pasarlos a
  los contratos y los specs.
- **ADR-241**: la 1.2 sigue con `pdf-lib`. Lo aceptó el mantenedor el
  2026-11-24, como decisión reabrible en el ADR de PDF/A.
- Los demás ADR esperan sus spikes (§10).
- **El mantenedor pidió cerrar todos los puntos de la 1.2 en los docs**
  (mediciones, ADR y specs) antes de abrir el PR de docs a develop y de
  empezar a implementar.

## 1. Alcance

| Punto del roadmap (`Roadmap_1.x.md` §5) | Queda en la 1.2 |
|---|---|
| Word (`.docx`): entrada y salida | Sí. Sale el mismo Word, limpio (§3) |
| Imágenes sueltas como entrada | Sí: PNG, JPEG, WebP, GIF, BMP, TIFF y AVIF (§3) |
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
| **El conversor de Office es LibreOffice compilado por nosotros a WASM**, sin interfaz gráfica, en un Worker y sin `unsafe-eval` (§8.3). ZetaOffice no se integra. Antes de adoptarlo, se compara la calidad de su salida con la de ZetaOffice (§8). Con la comparación hecha (§8.4), el mantenedor ve mejor el nuestro y pidió más pruebas de casos borde antes de cerrarlo | 11-23 |
| **La adopción del conversor compilado por nosotros queda cerrada**, con los casos borde hechos (§8.5) | 11-24 |
| **Un Word entra a la app solo con su última versión.** Nada del historial (lo borrado, los comentarios) llega a la vista ni a ninguna salida. Nuestro código acepta los cambios y borra los comentarios antes de convertir, y LibreOffice nunca recibe el historial (§8.8, enmienda a ADR-240 §5) | 11-24 |
| **Las escrituras no latinas no son una preocupación de la 1.2**: el chino, el japonés, el coreano, el tailandés, el árabe y el hebreo quedan como limitación conocida, también en el Word limpio | 11-24 |
| **El texto del Word que LibreOffice no dibuja se muestra en la vista previa, y no se borra ni frena el Word.** Puede ser un encabezado que no se usa, el valor guardado de un campo, el texto de una forma o de un cuadro, o una nota sin referencia. La app lo suma en páginas al final del documento, así el usuario lo ve. Los detectores también buscan datos ahí y proponen taparlos, como en el resto del documento, y el usuario tapa a mano lo demás si quiere. Lo que se tapa ahí se reemplaza en su lugar del Word limpio, y lo que no se tapa queda como está. Esas páginas no salen en el PDF, porque el PDF no tiene ese texto (§6.2) | 11-24 |
| ~~Si un Word tiene marca de agua o WordArt, esas páginas pasan también por OCR~~. Reemplazada el mismo día por la fila siguiente, con la medición hecha (§8.6) | 11-24 |
| **En la 1.2, un dato en una marca de agua o un WordArt es una limitación conocida**: el conversor los dibuja como figuras y la app no los detecta; se tapan a mano. Se trabaja en una versión posterior, con las dos vías medidas en §8.6 (§11). En el Word limpio, su texto aparece en las páginas que suma la vista previa con el texto que LibreOffice no dibuja (fila de arriba, §6.2) | 11-24 |
| **El chino, el japonés y el tailandés son una limitación conocida**: el conversor no suma una fuente que los cubra, y esos caracteres no llegan al PDF (§8.4) | 11-23 |
| **Las fuentes no latinas salen del conversor** (árabe, hebreo y las demás escrituras que no son latinas), para que cada conversión arranque 0,6 s antes. Un documento escrito en esas escrituras puede convertirse mal y sus datos quedar sin detectar: es una limitación conocida, y la comparación de calidad mide qué pasa | 11-23 |
| **Las imágenes adentro de un Word o un PowerPoint pasan por OCR y sus datos se tapan.** En el Word limpio, la imagen se reemplaza por su versión tapada | 11-23 |
| **Imágenes sueltas: PNG, JPEG, WebP, GIF, BMP, TIFF y AVIF.** HEIC queda afuera: si hay riesgo de que las patentes de su códec (HEVC) terminen en un cobro, el mantenedor prefiere que el usuario pase la foto a otro formato. AVIF se suma porque Electron lo abre solo y su formato es libre de regalías | 11-23 |
| **Tope de una imagen: 50 megapíxeles**, por imagen o por página de un TIFF, medido antes de abrirla. Si se pasa, la app avisa y no la abre | 11-23 |
| **Si una detección no se puede ubicar en el XML del Word, el Word no se exporta.** La app dice qué dato no pudo ubicar y ofrece exportar en PDF. Nunca sale un Word con un dato a la vista | 11-23 |
| **Todo sale junto en una sola 1.2**, como dice el roadmap §2 | 11-23 |
| **Un Office con contraseña de apertura se trata como el PDF de hoy**: la app la pide y lo abre. El spike confirma cómo se descifra (§8) | 11-23 |
| **Los Office con macros y las plantillas no entran**: `.docm`, `.dotx`, `.xlsm`, `.xltx`, `.pptm` y `.potx`. El aviso dice que se guarde como documento normal desde Office | 11-23 |
| **En el Word limpio, los comentarios y el control de cambios se borran.** Los cambios pendientes quedan aceptados y lo borrado no viaja en el archivo | 11-23 |
| **La salida que viene elegida al exportar es el formato que entró**: un Word sale como Word limpio, y todo lo demás como PDF imagen | 11-23 |
| **En el diálogo de exportar, el nombre y la salida van en una fila**: un campo más corto con el nombre solo («anonimizado» o el que se elija), y a la derecha un desplegable con la extensión («.docx», «.pdf»…) donde se elige la salida | 11-23 |
| El acceso directo de Google tiene su propio aviso, que explica cómo descargarlo (§3.1) | 11-23 |
| **El tamaño del instalador no es un problema**: es un costo aceptado, sea cual sea | 11-23 |
| **El LibreOffice de escritorio queda descartado como conversor**: la app no depende de otro programa de escritorio | 11-23 |
| **Para redistribuir el conversor alcanza con sus licencias de código abierto** (MPL 2.0 y LGPL), cumpliendo lo que piden en el aviso de licencias de la app. No se consulta a allotropia | 11-23 |

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

**Aprobado por el mantenedor el 2026-11-23:** si el usuario suelta un
`.gdoc`, `.gsheet` o `.gslides`, la zona de carga no dice solo «formato no
admitido»: explica que se descarga desde Google como Word, Excel o
PowerPoint.

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
- El caso inverso también es un riesgo: **texto del XML que no aparece en
  las páginas**.
  - Lo que el conversor no dibuja no se detecta, y el gate de §6.3 busca
    solo los valores detectados. Pasó con una celda de texto girado y con
    el chino, el japonés y el tailandés (§8.4), y con la marca de agua y
    el WordArt, que se ven pero no son texto (§8.5).
  - ~~Propuesta: la alineación también cuenta el texto del XML que va a
    quedar en el Word limpio y no tiene par en las páginas. Si hay, el
    Word no se exporta, con la misma regla de §3.~~ Medida en §8.8, esa
    regla frenaba entre el 8,6 y el 22,4 % de los Word de prueba.
  - **Decisión del mantenedor (2026-11-24, §3):** ese texto no se borra ni
    frena el Word.
    - La alineación lo junta, y la app lo suma en páginas al final de la
      vista previa. Cada pedazo dice en qué lugar del Word está: un
      encabezado que no se usa, un campo, una forma, un cuadro, una nota.
    - Los detectores también buscan datos en esas páginas y proponen
      taparlos, como en el resto del documento. El usuario tapa a mano lo
      demás si quiere.
    - Lo que se tapa ahí se reemplaza en su lugar del XML; lo que no se
      tapa queda en el Word limpio como está.
    - Esas páginas no salen en el PDF: el PDF sale de las páginas
      convertidas, que no tienen ese texto.
  - Para el ADR del Word limpio queda:
    - Cómo se dibujan esas páginas. Propuesta: el mismo Worker convierte,
      antes de terminar, un segundo documento chico con ese texto, y sus
      páginas se suman al final. Así salen con las mismas fuentes, sin una
      dependencia nueva, y cada pedazo sabe de qué lugar del XML viene. Se
      mide cuánto suma a la conversión.
    - Qué cuenta como texto sin par. Las copias idénticas que se dibujan
      menos veces no entran, porque el reemplazo por valor en todo el XML
      ya las cubre.

### 6.3 «No recuperable» en el Word limpio

El mantenedor eligió el rearmado con una lista cerrada de partes, y que los
comentarios y el control de cambios se borren (§3). La propuesta de qué
entra y qué no:

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
primero, las imágenes adentro de un documento, los formatos de imagen, la
detección que no se ubica en el XML del Word, el aviso de Google, los
Office con contraseña, los Office con macros y las plantillas, los
comentarios y el control de cambios, la salida por defecto, el conversor
definitivo y las fuentes no latinas del conversor.

Resueltas el 2026-11-24, y pasadas a §3: la adopción del conversor, la
marca de agua y el WordArt, la última versión del Word, las escrituras no
latinas, y el texto que LibreOffice no dibuja, que se muestra en la vista
previa y donde los detectores también buscan.

Queda:

1. **El diseño del diálogo de exportar**, con un lienzo en claro y en
   oscuro. El mantenedor fijó la fila del nombre con el desplegable de la
   salida (§3). Falta:
   - cómo se nombran en el desplegable las dos salidas que terminan en
     `.pdf`, la imagen y la que lleva texto;
   - dónde se elige PDF/A;
   - qué muestra el diálogo cuando el Word limpio no se puede exportar.

Para el ADR del conversor, el planificador propone además:

- **Que el PDF intermedio salga sin etiquetas** (`UseTaggedPDF=false`).
  Las etiquetas lo multiplican por treinta en una hoja grande (§8.3),
  pierden texto en algunas hojas de cálculo (§8.4), y el visor no las usa.
- **El recorte `rec-C`**, con Lucida Console como monoespaciada (§8.5).
- **Que el PDF intermedio no lleve lo que va por fuera de la página**.
  - Son los metadatos del documento y las anotaciones con texto:
    comentarios, notas de celda, textos de ayuda y direcciones de
    enlaces.
  - Se quitan en el conversor o justo después, y el export nunca los
    copia.
  - Nada de eso se muestra ni se detecta (§8.5), así que no puede llegar a
    una salida.

## 8. Spikes y mediciones antes de los ADR

- **Conversor** (hecho, §8.1): probar ZetaOffice bajo la CSP y `app://`,
  con su peso real, el tiempo de conversión en el banco Windows y la
  fidelidad. La fidelidad se
  mide sobre un corpus sintético de Word, Excel y PowerPoint hecho con
  Office y exportado desde Google.
- **Conversor compilado por nosotros** (hecho, §8.3): compilar LibreOffice
  a WASM con la receta oficial, sin interfaz y sin código dinámico, y
  medirlo contra ZetaOffice.
- **Calidad de la salida, el nuestro contra ZetaOffice** (hecho, §8.4; lo
  pidió el mantenedor para adoptar el nuestro, §3).
  - Se convierte el mismo corpus con los dos y se compara página por
    página: cantidad y tamaño de las páginas, el texto que se extrae, la
    imagen renderizada y las fuentes que usa.
  - El nuestro va con la configuración que se adopta: sin fuentes no
    latinas y sin etiquetas.
  - El corpus suma los documentos de prueba de Word, Excel y PowerPoint
    que trae el propio código de LibreOffice, además de los sintéticos.
  - Se mide también qué pasa con un documento en escrituras no latinas.
- **Casos borde del conversor** (hecho, §8.5). El mantenedor lo pidió
  después de §8.4, antes de adoptar el nuestro.
  - Se convierte con los dos un corpus de texto girado o vertical: celdas
    de Word con dirección de texto, celdas de Excel giradas y cuadros de
    texto girados en Word y PowerPoint.
  - Se convierten también los lugares donde un dato se esconde fácil:
    - en Word: cuadros de texto, encabezados y pies distintos por página,
      notas, campos, ecuaciones, controles de contenido y objetos
      incrustados;
    - en Excel: fórmulas, celdas combinadas o con ajuste de texto, filas y
      columnas ocultas, áreas de impresión y escalado;
    - en PowerPoint: textos de patrón y diseño, formas agrupadas, tablas,
      gráficos y diapositivas ocultas.
  - El corpus de prueba de LibreOffice entra entero, sin el tope de 5 MB.
  - Se prueba la tabla de reemplazo de fuentes de LibreOffice en nuestro
    build, para que las sans que no conoce caigan en una sans.
- **OCR de la marca de agua y el WordArt** (hecho, §8.6; decisión del
  mantenedor en §3).
  - Se mide si el OCR de la app lee lo que el conversor dibuja como
    figura: marcas de agua de texto en diagonal y en horizontal, claras y
    oscuras, y WordArt con y sin efectos.
  - Se mide también cuánto tarda por página, y si el OCR confunde la marca
    de agua con el texto que tiene encima.
- **Alineación XML–página del Word** (hecho, §8.8; §6.2): sobre el mismo corpus, cuántas
  detecciones se ubican en el XML y cuáles no.
- **Office con contraseña** (hecho, §8.7): si el conversor abre un Office
  cifrado con la contraseña pasada desde memoria, y si el `.docx` se puede
  descifrar con WebCrypto sin el conversor, porque el Word limpio parte
  del `.docx`. Se midió junto con el preproceso de ADR-240 §5.
- **PDF/A**: un PDF imagen y uno con texto, armados con pdf-lib y validados
  con veraPDF. Se prueba también `convertToPDFA()` del fork
  `@cantoo/pdf-lib`, porque ADR-241 se reabre con este ADR.
- **CSP**: confirmar que ninguna librería candidata ejecuta código dinámico
  bajo la CSP sin `unsafe-eval`.
- **Imágenes** (hecho, §8.2): qué decodifica el Electron real
  (`ImageDecoder.isTypeSupported`), un TIFF de varias páginas, y HEIC con
  su WASM bajo la CSP.
- **Memoria**: el pico de un documento convertido. El conversor suma su
  propia memoria a la del pipeline, y los techos de ADR-192 son por perfil.
- **Documentos reales**: además de los sintéticos, por `ANONLY_REAL_DOC_*`.
  Cada informe dice qué sale solo de sintéticos.

### 8.1 Resultado del spike del conversor (2026-11-23)

Informe completo:
[`formatos/Spike_ZetaOffice_2026-11-23.md`](./formatos/Spike_ZetaOffice_2026-11-23.md).
Todo sale de un corpus sintético hecho con librerías, no con Office ni con
Google, y sin documentos reales.

- **Lo que funciona.**
  - Convierte Word, Excel y PowerPoint a PDF con texto real.
  - En el corpus, todo el texto visible llega al PDF, y respeta los tamaños
    Carta, A4 y Oficio, las secciones apaisadas y el área de impresión.
  - Es rápido: entre 0,05 y 0,6 s por documento, después de un arranque de
    2,6 s.
  - No hace ningún intento de red y no deja contenido del documento en
    disco.
- **Lo que choca con la app.**
  - **Necesita `unsafe-eval`**, que la CSP de la app no admite. Tampoco
    corre dentro de un Worker, porque este build necesita un documento.
  - **Usa unos 1,2 GB más de memoria**, y solo los devuelve al destruir la
    ventana. Con los techos de ADR-192 (2,0 y 3,0 GB) no puede convivir con
    el pipeline: tiene que terminar y cerrarse antes de que empiece el OCR.
  - **Pesa 250 MB instalado y unos 50 MB en el instalador.**
  - **No hay términos escritos de redistribución de los binarios.** Salen
    de LibreOffice (MPL 2.0) y Qt 5.15 (LGPL, enlazado estático).
- **No descifra un Office con contraseña**: al build le falta NSS. El
  descifrado se hace en JS antes de convertir (ECMA-376 Agile, con
  WebCrypto). Así el Word limpio también parte del archivo en claro.
- **Muestra el control de cambios**: el texto borrado sale tachado y entra
  al PDF. Con la decisión del mantenedor (§3), el conversor recibe el Word
  con los cambios aceptados y sin comentarios, para que el visor muestre lo
  mismo que va a tener el Word limpio.
- **Lo que el PDF no muestra no está en el PDF**: comentarios, notas del
  orador, texto oculto, hojas ocultas y el texto recortado de una celda. En
  las salidas PDF eso no viaja. En el Word limpio lo resuelve la lista
  cerrada de partes (§6.3).
- **Un archivo cualquiera con extensión `.docx` se abre como texto plano.**
  El reconocimiento por contenido de ADR-238 §2 va antes del conversor.

### 8.2 Resultado del spike de imágenes (2026-11-23)

Informe completo:
[`formatos/Spike_Imagenes_2026-11-23.md`](./formatos/Spike_Imagenes_2026-11-23.md).
Todo sale de un corpus sintético y de muestras de terceros, sin documentos
reales.

- **Electron abre solo, en un Worker con CSP**: PNG, JPEG (gris, CMYK y
  progresivo), WebP, GIF, BMP (todas sus variantes) y AVIF. Aplica solo la
  orientación EXIF, y de un GIF o un WebP animado toma el primer cuadro.
  No abre TIFF ni HEIC, ni un JPEG aritmético.
- **TIFF con `utif2`** (MIT, 39 KB gzip, sin `eval`): lee todas las
  compresiones probadas, varias páginas y la resolución declarada. No
  aplica la orientación TIFF, y su conversión CMYK busca `window`, que en un
  Worker no existe.
- **Armar el PDF** con el `pdf-lib` del repo da exactamente lo que pide
  ADR-163: una imagen por página, con sus píxeles nativos, cubriendo la
  página entera.
  - Un JPEG con orientación 1 pasa tal cual: unos 20 ms.
  - Lo demás se recodifica sin pérdida, y cuesta entre 1 y 3 s por página
    A4.
  - El fork `@cantoo/pdf-lib` corre con el mismo código, y es hasta 25 %
    más rápido y entre 5 y 15 % más chico.
- **Bombas**: ninguna colgó la app, pero un PNG de 400 KB ocupó 1,5 GB.
  De ahí el tope de 50 MP (§3), medido en la cabecera antes de decodificar.
- **HEIC con `libheif-js`** anduvo, pero quedó afuera (§3).

### 8.3 Resultado del spike de compilar LibreOffice (2026-11-23)

Informe completo:
[`formatos/Spike_LOWA_2026-11-23.md`](./formatos/Spike_LOWA_2026-11-23.md).
Todo sale del corpus sintético del spike de ZetaOffice, sin documentos
reales.

- **Compila sin tocar el código.**
  - Se usó la receta oficial: LibreOffice 26.8.3.1 y Emscripten 4.0.10.
  - El único cambio es una línea en el makefile de la plataforma, para
    pasarle flags al enlace.
  - En el banco Windows (WSL, 12 hilos) tarda entre 75 y 85 minutos, y el
    árbol ocupa 9,5 GB.
- **Corre sin interfaz y dentro de un Worker.** La variante sin interfaz
  gráfica (`--disable-gui`, sin Qt) convierte Word, Excel y PowerPoint en un
  Worker que no tiene `document`.
- **No necesita `unsafe-eval`.**
  - Enlazado con `-sDYNAMIC_EXECUTION=0`, corre bajo la CSP de la app sin
    violaciones, y su JS no tiene `new Function`.
  - Reenlazar cuesta 11 minutos, no una compilación entera, y no pierde
    velocidad.
- **Contra ZetaOffice**, con el mismo harness y en el mismo día:

  | | ZetaOffice | Compilado por nosotros, recortado, en Worker |
  |---|---|---|
  | CSP | necesita `unsafe-eval` | la de la app |
  | Dónde corre | una ventana aparte | un Worker |
  | Instalado / en el instalador | 262 / 52 MB | 191 / ~41 MB |
  | Arranque | 2,6 s | 2,9 s |
  | Pico de memoria de la app | 1,46–1,50 GB | 1,22–1,24 GB |
  | Memoria 10 s después de terminar | 1,15 GB | ~0,47 GB, lo que usaba antes de cargarlo |

- **Convierte igual de rápido**, salvo los archivos grandes: la hoja de 162
  páginas tarda entre 0,8 y 0,9 s, contra 0,57 s.
- **Mismas páginas y tamaños que ZetaOffice** en los 9 archivos. Hay dos
  diferencias:
  - **El PDF sale etiquetado.** LibreOffice 26.8 etiqueta el PDF por
    defecto, y la hoja de 162 páginas pasa de 334 KB a 10,1 MB. Sin
    etiquetas (`UseTaggedPDF=false`) da 346 KB. Falta confirmar que sin
    etiquetas el texto salga idéntico.
  - **Las fuentes de reemplazo cambian.** La fuente que usa en lugar de
    cada fuente de Windows sin métrica compatible no es la de ZetaOffice.
    Falta revisarlo fuente por fuente.
- **Se recorta sin recompilar.**
  - `soffice.data` baja de 97 a 36 MB y salen los mismos PDF. Se sacan la
    interfaz que sobra, los íconos y las fuentes no latinas.
  - Las escrituras no latinas (árabe, hebreo y otras) se quedan sin fuente
    propia. No se probó ningún documento en esas escrituras.
- **No descifra**: el build no trae NSS, aunque no se probó. El descifrado
  sigue en JS.
- **Mantenimiento.**
  - Cada versión de LibreOffice que se quiera seguir es una recompilación.
  - En un runner gratuito de CI de 4 núcleos se estiman entre 3 y 4 horas,
    sin probar. En uno privado de 2 núcleos no entra.
  - La alternativa es compilarlo en esta máquina y publicar los cuatro
    archivos.
- **Licencias**: sin Qt, ya no hay LGPL por Qt estático. Quedan la MPL 2.0
  de LibreOffice y las licencias de lo que trae adentro. Es conocimiento
  previo, no una consulta.
- **Sin verificar**:
  - una compilación desde cero cronometrada entera;
  - el pico de memoria del enlace;
  - la corrida en CI;
  - un Office cifrado;
  - documentos reales;
  - escrituras no latinas;
  - el arranque con la caché de disco fría.

### 8.4 Calidad de la salida, el nuestro contra ZetaOffice (2026-11-23)

Informe completo:
[`formatos/Calidad_Conversor_2026-11-23.md`](./formatos/Calidad_Conversor_2026-11-23.md).
No hay documentos reales. El corpus son los 9 sintéticos más 310
documentos de prueba del código de LibreOffice (150 Word, 80 Excel y 80
PowerPoint), elegidos por hash. Las diferencias se miden entre los dos
conversores, no contra Office. El nuestro va sin fuentes no latinas y sin
etiquetas.

- **Convierte lo mismo o más.**
  - ZetaOffice convierte 317 de 319 archivos, y el nuestro 318.
  - El que solo convierte el nuestro es un PowerPoint que hace caer a
    ZetaOffice (`memory access out of bounds`). El otro no lo abre
    ninguno.
  - El nuestro no tuvo timeouts ni caídas.
- **Las mismas páginas.** Coinciden en 315 de 317 archivos, y todas tienen
  el mismo tamaño. Las dos diferencias son:
  - un Word donde ZetaOffice repite contenido; el nuestro coincide con el
    origen;
  - un Excel roto a propósito.
- **El texto, que es lo que la app detecta.**
  - Es idéntico por palabras en 137 de 150 Word, 66 de 79 Excel, 79 de 80
    PowerPoint y los 8 sintéticos.
  - Casi todas las diferencias son de formato: puntuación pegada,
    números, los puntos guía de un índice, la numeración y los códigos de
    error de una celda.
  - En 11 Excel el nuestro tiene más texto: encabezados de tabla y de
    página que ZetaOffice no imprime.
  - **Hay un solo caso de texto perdido**: un Word con texto girado en una
    celda combinada verticalmente. El nuestro dibuja la celda vacía. Falta
    saber si pasa con todo texto girado (§8, pendiente).
- **La imagen.**
  - La mediana de píxeles distintos es de 0,01 % o menos, y el p90 está
    entre 0,6 y 2,5 %.
  - Los peores casos son tablas flotantes, alturas de fila, texturas de
    fondo y el Word donde ZetaOffice repite contenido.
- **Las etiquetas también pierden texto.**
  - Con etiquetas, el nuestro pierde texto en 5 de 87 hojas de cálculo, y
    los PDF pesan 4,6 veces más.
  - Sin etiquetas, el texto coincide con el de ZetaOffice. Es una razón
    más para la propuesta de §7.
- **Las fuentes.**
  - Las de métrica compatible caen igual que en ZetaOffice: Arial,
    Calibri, Cambria, Times New Roman y Courier New.
  - LibreOffice 26.8 reemplaza por Noto Serif, una fuente con serifa, las
    sans que no conoce. Entre ellas están Verdana, Tahoma, Segoe UI y
    Aptos, que es la fuente por defecto del Office actual.
  - Consolas ya no cae en una monoespaciada.
  - Esos dos cambios son de la versión, no del recorte. En nuestro build se
    corrigen con la tabla de reemplazos de LibreOffice, pero falta probarlo
    (§8, pendiente).
  - El recorte sacó la fuente matemática, así que `Cambria Math` y
    `Symbol` cambian de reemplazo. Propuesta: conservarla en el recorte,
    porque no es la fuente de una escritura no latina.
- **Las escrituras.**
  - Árabe, hebreo, cirílico, griego y devanagari: el texto y los glifos
    salen bien, con el recorte y sin él. Sacar las fuentes no latinas no
    cambió nada en el documento de prueba.
  - **Chino, japonés y tailandés se pierden en los dos conversores.**
    Ninguno trae una fuente que los cubra, y el texto sale sin esos
    caracteres, así que la app no puede detectar un dato en esas
    escrituras.
  - Solo en nuestro build se puede sumar una fuente que los cubra. El
    mantenedor decidió no sumarla (§3).
- **Sin medir**:
  - documentos reales;
  - la comparación contra Office;
  - el orden de lectura del árabe y el hebreo;
  - las páginas después de la octava;
  - los archivos de más de 5 MB.

### 8.5 Casos borde del conversor (2026-11-24)

Informe completo:
[`formatos/Casos_Borde_Conversor_2026-11-24.md`](./formatos/Casos_Borde_Conversor_2026-11-24.md).
No hay documentos reales. Se usaron corpus sintéticos armados para cada
caso y los 2.913 documentos de prueba de LibreOffice. El nuestro va con el
recorte `rec-C` y sin etiquetas.

- **El recorte `rec-C` corrige las fuentes sin recompilar.**
  - Suma la fuente matemática y el `fc_local.conf`, que `rec-B` había
    perdido sin querer. Sin ese archivo, un texto en la fuente `Symbol`
    salía con caracteres corruptos.
  - Sus alias de fontconfig hacen que las sans que LibreOffice no conoce
    (Verdana, Tahoma, Segoe UI, Aptos y otras) caigan en Noto Sans, y
    Consolas en DejaVu Sans Mono, como en ZetaOffice.
  - La tabla de reemplazo del registro de LibreOffice no sirvió, porque
    manda fontconfig.
  - Pesa 0,6 MB más que `rec-B`. Falta medir el arranque.
  - Lucida Console quedó como sans por un error del pedido: es
    monoespaciada y va con Consolas.
- **El corpus entero de LibreOffice, 2.913 archivos.**
  - El nuestro convierte 2.893 y ZetaOffice 2.885.
    - 2.883 los convierten los dos.
    - 10 solo el nuestro: 6 donde ZetaOffice se cuelga y 4 donde se cae o
      no carga.
    - 2 solo ZetaOffice.
    - 18 ninguno, entre ellos 4 Word cifrados.
  - El nuestro no tuvo ningún timeout, y ZetaOffice tuvo 6.
  - **El nuestro pierde contenido real en 4 archivos**, revisados con su
    imagen:
    - la celda girada de §8.4;
    - un texto condicional que sale de un campo de propiedad del
      documento;
    - el texto de ejemplo de un control de contenido;
    - un gráfico de cascada, que no soporta.
  - ZetaOffice pierde contenido real en otros 4, y le quedan 37 archivos
    sin revisar.
  - El resto de las diferencias de texto son de formato, o de archivos que
    no tienen ese texto en el origen.
- **Texto girado.**
  - De 36 casos armados desde cero, 33 salen igual en los dos, celdas
    giradas y combinadas incluidas.
  - La celda de §8.4 sigue fallando en su archivo original, sin causa
    conocida.
  - El WordArt no llega como texto en ninguno de los dos.
- **Lugares donde un dato se esconde**: 153 de 162 marcadores dan lo mismo
  en los dos conversores.
  - **Llegan como texto visible**: cuadros de texto, encabezados y pies de
    primera página y de pares e impares, notas, controles de contenido,
    formas y grupos, gráficos, tablas, patrón y diseño.
  - **Quedan afuera en los dos**: texto oculto, hojas, filas y columnas
    ocultas, lo que está fuera del área de impresión, diapositivas ocultas
    y notas del orador.
  - **Se ven pero no son texto**: la marca de agua de Word y el WordArt.
    Ahí la app no puede detectar un dato.
  - **Los valores se actualizan distinto**: los campos de Word (fecha,
    referencias, página) se recalculan, y los números en caché de Excel no.
  - **Llegan por fuera de la página**:
    - En los dos conversores: las propiedades del documento (título,
      autor) quedan en los metadatos del PDF, y las direcciones de los
      enlaces, en sus anotaciones.
    - Solo el nuestro escribe además como anotaciones los comentarios de
      Word con su autor, la nota de una celda de Excel y el texto de ayuda
      de un enlace.
- **Árabe y hebreo.**
  - El orden de lectura se respeta, igual en los dos.
  - Se pierde el espacio entre un tramo en esas escrituras y un número o
    una palabra latina.
  - Una ligadura sale invertida.
- **Documentos grandes**, sintéticos de 6 a 11 MB: convierten en los dos
  con tiempos parecidos. El Excel de 60.000 filas tarda unos 22 s en cada
  uno.

### 8.6 OCR de la marca de agua y el WordArt (2026-11-24)

Informe completo:
[`formatos/OCR_Marcas_2026-11-24.md`](./formatos/OCR_Marcas_2026-11-24.md).
No hay documentos reales. El corpus son 50 casos sintéticos armados a mano
en XML, no guardados por Word. El OCR es el de la app: Tesseract, `spa` y
`eng`, `PSM.SPARSE_TEXT`.

- **El OCR de la página entera, como lo hace hoy la app, no alcanza.**
  - Lee la marca de agua y el WordArt horizontales: 6 a 7 de 8 casos con
    los cuatro datos exactos.
  - Con la figura girada lee 0 de 8, y con la marca de agua sobre una
    página con texto, 0 de 16.
  - Además duplica el texto nativo y suma palabras basura.
- **Lo que sí lee** es el OCR de la región de la figura, enderezada por su
  ángulo, y rasterizada sin el texto nativo de la página.
  - Sobre una página vacía lee los cuatro datos en 6 a 7 de 8 casos. En
    los otros, acierta el 99 % de los caracteres.
  - Sobre una página con texto, los lee en 12 de 16 casos.
  - Lo que falla es el correo en letra chica: el `@` sale como otra letra.
  - Subir el contraste no ayuda, y el gris claro se lee igual que el
    oscuro.
- **La región se ubica desde el PDF.**
  - Se toman los trazados rellenos o con contorno de la página, con
    `getOperatorList` de pdf.js, y cubren el 100 % de la tinta en los 50
    casos.
  - El ángulo sale de la tinta con un error de 0,2 a 0,3°, y hace falta
    menos de 3°.
  - Un logo o un gráfico también son trazados: un falso positivo cuesta
    tiempo de OCR.
- **El raster sin el texto nativo** se arma reescribiendo el PDF con
  `pdf-lib` sin los bloques de texto. pdf.js no tiene una opción para eso.
- **El tiempo**: de 0,05 a 0,35 s por región, contra 0,6 a 2,6 s de una
  página entera.
- **Hay otra vía, sin OCR**: el texto de la marca de agua y del WordArt
  está escrito en el XML del archivo.
  - Se puede leer de ahí y detectar sobre ese texto exacto.
  - Si tiene un dato, se tapa la región de la figura entera.
  - El spike midió que la región del XML y la del PDF coinciden (IoU de
    0,77 a 0,998).
- **Sin medir**:
  - archivos guardados por Word;
  - WordArt deformado (en arco, en ola);
  - marcas de agua de varios renglones o de imagen;
  - páginas con logos y gráficos;
  - documentos de varias páginas;
  - los tiempos dentro de la app.

### 8.7 Preproceso del conversor y Office con contraseña (2026-11-24)

Informe completo:
[`formatos/Preproceso_Y_Cifrado_2026-11-24.md`](./formatos/Preproceso_Y_Cifrado_2026-11-24.md).
No hay documentos reales. Se usaron sintéticos y los documentos de prueba
de LibreOffice. Lo decidido está en ADR-240 §3 y §5, y en ADR-242.

- **El preproceso es obligatorio.** Sin él, el texto borrado de un Word y
  las notas visibles de un Excel salen en el PDF, aunque los `FilterData`
  pidan lo contrario.
- **Aceptar los cambios anda con el despachador** de LibreOffice, con dos
  trampas resueltas: el control de cambios protegido y el registro de
  cambios activo.
  - 113 de 113 Word del árbol quedaron sin cambios pendientes.
  - 6.000 cambios se aceptan en 0,93 s.
- **Borrar los comentarios anda** en Word, Excel y PowerPoint. Una hoja de
  Excel protegida necesita una vía aparte, también medida.
- **La limpieza del PDF intermedio anda**, si barre los objetos que quedan
  sin referencia: el texto y la imagen quedan idénticos, y no queda ningún
  metadato ni anotación.
- **El conversor abre un Office cifrado**: trae OpenSSL aunque no tenga
  NSS.
  - Pero no distingue una contraseña equivocada de un archivo que no
    puede abrir.
  - Y solo devuelve el documento guardado de nuevo, no el paquete
    original que necesita el Word limpio.
- **El descifrador propio** (OLE, ECMA-376 Agile y Standard, WebCrypto)
  abre los cuatro Word cifrados del árbol de LibreOffice.
  - Detecta siempre una contraseña equivocada antes de descifrar.
  - Deriva la clave en 0,37 s.
  - Descifra 250 MB en 0,8 s.
- **Sin probar**:
  - Excel y PowerPoint cifrados guardados por Office;
  - el cifrado Extensible, el RC4 y el IRM.

### 8.8 Word limpio: la alineación entre las páginas y el XML (2026-11-24)

Informe completo:
[`formatos/Word_Limpio_Alineacion_2026-11-24.md`](./formatos/Word_Limpio_Alineacion_2026-11-24.md).
No hay documentos reales. El corpus son 8 sintéticos con 224 datos
marcados en 56 lugares, y los 2.104 Word de prueba de LibreOffice. Ese
corpus está hecho de casos raros a propósito, así que sus porcentajes no
son los de documentos comunes.

- **Un lector y un alineador propios, sin dependencias.**
  - Son unas 800 líneas: el ZIP se lee con `DecompressionStream`, y el XML
    con un tokenizador propio, porque en un Worker no hay `DOMParser`.
  - Leer el XML tarda 1 ms de mediana, y 9 ms en el p99. Alinear el
    documento más grande del corpus tarda 50 ms.
  - Con millones de caracteres la memoria crece mucho: 8 millones piden
    unos 2 GB. Hay que alinear por tramos de páginas.
- **Página → XML: se ubica casi todo.**
  - En los sintéticos, todo dato que el XML conserva y la página dibuja se
    ubica en su lugar. Las tres excepciones tienen explicación.
  - En el corpus, el 91,3 % de las palabras se ubica en un solo lugar y el
    1,7 % en varios, porque es una copia idéntica. El 6,3 % no se ubica.
    - Lo que no se ubica es texto que el XML no tiene: los números de
      lista, el texto de las imágenes vectoriales (WMF y EMF), que
      LibreOffice dibuja como texto, y el de los gráficos y diagramas, que
      el lector todavía no lee.
  - De 254 datos con forma de DNI, CUIT o correo, 230 se ubican en un solo
    lugar, 22 en varios (copias idénticas) y ninguno queda sin ubicar.
- **XML → página: la regla propuesta en §6.2 bloquea bastante.**
  - El 4,1 % de los caracteres del XML que quedarían en el Word limpio no
    tiene par en las páginas.
  - Según cuánto se cuente, la regla bloquearía el Word en el 22,4 % de
    los documentos (cualquier carácter), el 11,3 % (alguna palabra) o el
    8,6 % (alguna palabra, sin contar los campos, los encabezados que no
    se usan, los marcadores de los controles ni las notas sin
    referencia).
  - Las causas principales son texto de cuadros y formas que LibreOffice
    no dibuja, copias que se dibujan menos veces, árabe, hebreo y
    escrituras sin fuente, campos con un valor guardado distinto del que
    dibuja LibreOffice, y encabezados de un tipo que no se usa.
  - Entre lo que no tiene par hay texto real que LibreOffice no dibuja:
    un marco recortado y la celda girada de §8.4.
- **El control de cambios no coincide siempre.**
  - En 10 de 106 Word con cambios, LibreOffice deja a la vista texto que
    el XML aceptado borra, casi siempre cuando se borró y además se cambió
    el formato. Es un 9 %, no un caso aislado como decía ADR-240 §5.
  - No es una fuga: ese texto no está en el Word limpio. Es un bloqueo de
    más.
- **Hallazgos nuevos:**
  - LibreOffice empareja las notas al pie con sus referencias por orden, no
    por identificador. Con identificadores salteados dibuja una nota que
    nadie referencia. La regla XML → página lo detecta.
  - El texto de una imagen vectorial no tiene dónde reemplazarse en el
    XML: está dentro de la imagen.
- **Sin medir**:
  - documentos reales de Word;
  - el corte automático de palabras;
  - varios casos de texto oculto por estilo de tabla o de numeración;
  - lectores de XML de terceros, para comparar.

## 9. Frentes, orden tentativo

1. **Contrato**: el formato de origen en `ImportDocumentInput`, `Document` y
   `DocumentImported`; un código de error neutro para «formato no
   admitido»; el formato de salida en `ExportOptions` y en
   `ExportFinished`. Va primero, con su ADR.
2. **Imágenes sueltas**: es el caso más barato y prueba el camino del
   formato de origen de punta a punta. Es el octavo motor (ADR-239,
   `core/Convert_Engine.md`). Al implementarlo hay que actualizar también:
   - `CLAUDE.md`, que dice «siete motores»;
   - la descripción de `.claude/agents/implementador.md`, que lista los
     motores;
   - el glob de cobertura en `vitest.config.ts` y los `paths` de `tests/`
     (ADR-033).
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
| El formato de origen y el formato de salida en el contrato: **ADR-238**, aceptado | `Contracts.md`, `03_Data_Model.md`, `PDF_Engine.md`, `Orchestrator.md`, `Export_Engine.md` |
| El conversor de Office y dónde corre, con el preproceso y el paginado de Excel y de PowerPoint: **ADR-240**, aceptado | `Contracts.md`, `Convert_Engine.md`, `Orchestrator.md`, `05_Worker_Architecture.md`, `06_Pipeline.md` |
| Office con contraseña, con el descifrado, el evento y el reintento: **ADR-242**, aceptado | `Contracts.md`, `Orchestrator.md`, `Convert_Engine.md` |
| Imágenes sueltas: qué formatos y cómo se decodifican: **ADR-239**, aceptado | `Contracts.md`, `Convert_Engine.md` (nuevo), `Orchestrator.md`, `05_Worker_Architecture.md`, `06_Pipeline.md` |
| Qué significa «no recuperable» en un Word, y su gate | ADR-009, `08_Security_Model.md` |
| El PDF con texto preservado | ADR-004, ADR-009, ADR-059 §4, `08_Security_Model.md` S-3 |
| PDF/A, con la decisión reabierta de ADR-241 | ADR-009 |
| Seguir con pdf-lib o pasar al fork: **ADR-241**, aceptado. Sigue `pdf-lib`, y se reabre en el ADR de PDF/A | — |
| La interfaz de carga y de exportar en la 1.2 | `Components.md`, `UX_Guidelines.md` |

Cada dependencia nueva lleva su ADR (R-12).

## 11. Fuera de la 1.2

- Los binarios viejos de Office y OpenDocument (§3).
- HEIC (§3).
- Detectar un dato en una marca de agua o un WordArt (§3 y §8.6). Las dos
  vías medidas son el OCR de la región, enderezada y sin el texto nativo,
  o leer el texto de la figura desde el XML y tapar la figura entera.
- Excel y PowerPoint como **salida**: solo salen como PDF.
- Abrir documentos de Google sin descargarlos (§3.1).
- La cola de varios documentos: es la 1.3.
