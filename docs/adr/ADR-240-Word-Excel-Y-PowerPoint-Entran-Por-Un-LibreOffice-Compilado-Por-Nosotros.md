<!-- CONTEXT: scope=adr | dependencias=roadmap/Plan_1.2.md,roadmap/formatos/Spike_ZetaOffice_2026-11-23.md,roadmap/formatos/Spike_LOWA_2026-11-23.md,roadmap/formatos/Calidad_Conversor_2026-11-23.md,roadmap/formatos/Casos_Borde_Conversor_2026-11-24.md,adr/ADR-238-El-Formato-De-Origen-Se-Reconoce-Por-El-Contenido-Y-La-Salida-Se-Elige-Al-Exportar.md,adr/ADR-239-Una-Imagen-Suelta-Entra-Como-Un-PDF-Armado-Por-Un-Motor-Nuevo.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,adr/ADR-196-Las-Licencias-Del-Software-De-Terceros-Viajan-Con-El-Instalador.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md,core/Contracts.md,core/Convert_Engine.md,core/Orchestrator.md | audiencia=humanos+IA | fase=1.2 -->

# ADR-240 — Word, Excel y PowerPoint entran por un LibreOffice compilado por nosotros

- **Estado**: Aceptado por el mantenedor el 2026-11-24, junto con
  ADR-242. El preproceso del §5 y la contraseña del §9 están medidos
  (`Plan_1.2.md` §8.7). Pasado a los contratos y los specs el mismo día
  (`core/Convert_Engine.md` §6.4 a §6.6), con la enmienda de ADR-243 §1:
  el preproceso en el XML de un Word es parte de la limpieza al entrar.
- **Fecha**: 2026-11-24.
- **Decidido por**: el planificador, sobre las decisiones del mantenedor del
  2026-11-23 y el 2026-11-24 (`Plan_1.2.md` §3): el conversor propio, las
  fuentes no latinas fuera, y el chino, el japonés, el tailandés, la marca
  de agua y el WordArt como limitaciones conocidas.
- **Origen**: `Plan_1.2.md` §9, frentes 3 y 5, y los spikes de §8.1, §8.3,
  §8.4 y §8.5.

## Contexto

La 1.2 abre Word, Excel y PowerPoint (`.docx`, `.xlsx`, `.pptx`). ADR-238
reconoce el formato por el contenido. ADR-239 arma un PDF intermedio para
las imágenes, con un motor nuevo, el Convert Engine. Este ADR hace lo mismo
para los tres formatos de Office.

Lo que midieron los spikes:

- **ZetaOffice** (§8.1), el LibreOffice en WebAssembly que publica
  allotropia, convierte bien. Pero necesita `unsafe-eval`, corre solo en
  una ventana con `document`, y retiene ~1,2 GB hasta que se destruye esa
  ventana.
- **El mismo LibreOffice compilado por nosotros** (§8.3), sin interfaz
  gráfica y enlazado sin código dinámico:
  - corre en un Worker con la CSP de la app;
  - usa menos memoria y la devuelve al terminar el Worker;
  - arranca en 2,9 s con el recorte.
- **La calidad** (§8.4 y §8.5) es igual o mejor que la de ZetaOffice:
  - sobre 2.913 documentos de prueba de LibreOffice, convierte 2.893
    contra 2.885, sin timeouts;
  - pierde contenido real en 4 archivos, los mismos que pierde ZetaOffice
    en otros 4.

El mantenedor eligió el compilado por nosotros y cerró la adopción el
2026-11-24.

## Decisión

### 1. El conversor

LibreOffice **26.8.3.1**, compilado a WebAssembly con la receta oficial
(`static/README.wasm.md` del tag) y **Emscripten 4.0.10**. La receta
exacta es la de `formatos/Spike_LOWA_2026-11-23.md` §1:

- **Sin interfaz gráfica** (`--disable-gui`, sin Qt), con los módulos
  `--with-wasm-module="calc impress writer"`.
- **Sin código dinámico**: se enlaza con `-sDYNAMIC_EXECUTION=0`, para que
  corra sin `unsafe-eval`.
- **Sin NSS, pero con OpenSSL**: el conversor podría descifrar un Office
  con contraseña (§8.7 del plan). No recibe contraseñas: descifra el
  Convert Engine antes de convertir (ADR-242).
- Sin Java, sin scripting, sin ayuda y sin diccionarios.

La receta vive en el repo, en `tools/lowa/`:

- `autogen.input`;
- el parche de una línea de `solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk`,
  que pasa los flags de enlace;
- los scripts de compilación y el del recorte (§4);
- un `README.md` con las versiones fijas (tag, commit de LibreOffice y
  versión de Emscripten).

Compilarlo es manual: la receta se corre en una máquina con WSL o Linux,
y en el banco Windows tarda entre 75 y 85 minutos. Correrlo en CI queda
fuera hasta que se mida, porque en un runner gratuito se estiman entre 3 y
4 horas, sin probar.

### 2. Dónde corre

El conversor es parte del **Convert Engine** de ADR-239, en un segundo
trabajo, `convert-office`, del mismo pool `convert` de un solo worker.

- **Lo que se aplica igual que en ADR-239 §2**:
  - el Orchestrator lo despacha todavía en `Importing`;
  - pasa el PDF intermedio al PDF Engine con el `sourceFormat` original;
  - **termina el pool al terminar la conversión**, con éxito o con error.

  En el spike, terminar el worker devolvió la memoria al nivel de antes de
  cargar el conversor (`Spike_LOWA` §4). Así, con los techos de ADR-192, la
  conversión no se suma al pico del OCR ni del NER.
- **El conversor se carga solo cuando llega un trabajo `convert-office`.**
  Una imagen no carga sus archivos.
- **Dentro del worker, LibreOffice abre sus propios hilos**, que son
  workers `blob:`. Para eso necesita `SharedArrayBuffer`, y la app ya tiene
  el aislamiento de origen (COOP y COEP). La CSP no cambia:
  `script-src 'self' blob: 'wasm-unsafe-eval'` ya cubre los hilos `blob:` y
  la compilación del WebAssembly.
- **El documento solo vive en memoria.** Entra al sistema de archivos en
  memoria de Emscripten, y el PDF sale de ahí. El spike lo verificó: ningún
  intento de red, y ningún resto del documento en `userData` ni en el
  almacenamiento.

`soffice.js` es un script clásico de Emscripten, no un módulo. Cómo lo
carga el worker lo fija `Convert_Engine.md`. El spike lo corrió en un
Worker sin `document`.

### 3. Cómo convierte

1. Abre el documento oculto (`loadComponentFromURL`, con `Hidden`) desde
   el sistema de archivos en memoria.
2. Aplica el preproceso del §5.
3. Lo exporta con el filtro de PDF de su aplicación (`writer_pdf_Export`,
   `calc_pdf_Export` o `impress_pdf_Export`), con estos `FilterData`:
   - `UseTaggedPDF=false`, porque las etiquetas pierden texto en algunas
     hojas de cálculo y multiplican el tamaño (§8.4);
   - `ExportNotes=false`, `ExportNotesPages=false` y
     `ExportNotesInMargin=false`, porque los comentarios y las notas no
     van a la página.
4. **Limpia el PDF intermedio** antes de devolverlo, con el `pdf-lib` que
   el motor ya usa (ADR-239). Lo que el PDF lleva por fuera de la página
   no se muestra ni se detecta (`Casos_Borde` §2), así que no puede llegar
   a una salida. Se quitan:
   - el diccionario `Info` y la metadata XMP del catálogo, que llevan el
     título, el autor y las palabras clave del documento;
   - las anotaciones de todas las páginas (`Annots`): enlaces con su
     dirección, comentarios, notas y textos de ayuda;
   - del catálogo, `Outlines`, `Names`, `AcroForm`, `StructTreeRoot`,
     `MarkInfo` y `OpenAction`.

   Quedan las páginas con su contenido, sus recursos y sus cajas.

   **Quitar la referencia no alcanza.** `pdf-lib` guarda igual los objetos
   que quedaron sin referencia, y con ellos la metadata y las
   anotaciones. La limpieza barre los objetos huérfanos antes de guardar.

   **Lo que midió el spike** (§8.7 del plan): el texto, la imagen, las
   páginas y las cajas quedan idénticos. En los bytes no queda el título,
   el autor, ninguna dirección ni la palabra «LibreOffice». Limpiar tarda
   de 1 a 16 ms hasta 10 páginas, y 1,25 s con 500.

El paginado es el de LibreOffice:

- **Un Word** sale con sus páginas, sus secciones y sus tamaños.
- **Un Excel** sale como páginas impresas: respeta el área de impresión,
  el escalado y los saltos del archivo. Las hojas, filas y columnas
  ocultas no salen.
- **Un PowerPoint** sale con una página por diapositiva visible, al tamaño
  de la diapositiva, sin las notas del orador y sin las diapositivas
  ocultas.

Con esto se cierra el ADR «El paginado de Excel y de PowerPoint» de
`Plan_1.2.md` §10.

Lo que el PDF no muestra no entra a la app. En las salidas PDF no viaja;
en el Word limpio lo resuelve su lista cerrada de partes (`Plan_1.2.md`
§6.3). Son el texto oculto, los comentarios, las notas del orador y las
hojas, filas y columnas ocultas.

### 4. El recorte y las fuentes

`soffice.data` se recorta sin recompilar, con el perfil `rec-C`
(`Casos_Borde` §0). Pasa de 97 a 36 MB, y el arranque baja de 3,5 a 2,9 s.

- **Se saca**:
  - la interfaz que no se usa, salvo `modules/simpress`, sin el cual
    Impress no abre;
  - los íconos y la galería;
  - las fuentes no latinas, por decisión del mantenedor (§3).
- **Se queda**:
  - Liberation, Carlito y Caladea, que tienen la métrica de Arial, Times
    New Roman, Courier New, Calibri y Cambria;
  - OpenSymbol, las DejaVu latinas, DejaVu Math TeX Gyre, y Noto Sans y
    Noto Serif;
  - el `fc_local.conf` del paquete.
- **Alias de fontconfig**, agregados al final de `fc_local.conf`:
  - Verdana, Tahoma, Segoe UI, Aptos, Calibri Light, Trebuchet MS, Century
    Gothic, Comic Sans MS e Impact van a **Noto Sans**;
  - Consolas y Lucida Console van a **DejaVu Sans Mono**.

  Sin los alias, LibreOffice 26.8 las reemplaza por una fuente con serifa.
  La tabla de reemplazo del registro de LibreOffice no sirve para esto,
  porque manda fontconfig.

**Limitaciones conocidas**, que van a la documentación del usuario:

- El chino, el japonés y el tailandés no tienen fuente: esos caracteres no
  llegan al PDF (§3 del plan).
- En el árabe y el hebreo, el texto extraído pierde el espacio entre un
  tramo en esas escrituras y un número o una palabra latina.
- La marca de agua y el WordArt se dibujan como figuras, no como texto:
  un dato escrito ahí no se detecta y se tapa a mano. El mantenedor lo
  dejó para una versión posterior (`Plan_1.2.md` §3, §8.6 y §11).

### 5. El preproceso: cambios aceptados y sin comentarios

> **Enmienda del 2026-11-24, decisión del mantenedor.** Un Word entra a la
> app **solo con su última versión**. Nuestro código acepta los cambios y
> borra los comentarios en el XML del `.docx` **antes de convertir**. Es el
> mismo código que arma el Word limpio (`Plan_1.2.md` §6.3), así que
> LibreOffice nunca recibe el historial, y la página que ve la app y el
> Word limpio salen del mismo texto.
>
> El motivo es la medición de `Plan_1.2.md` §8.8: en 10 de 106 Word con
> cambios, LibreOffice aceptaba distinto que Word y dejaba a la vista
> texto borrado.
>
> **Desde ADR-243 §1**, ese código es la limpieza al entrar: LibreOffice
> convierte el paquete limpio, que ya no tiene cambios ni comentarios.
>
> Lo que sigue en esta sección vale así:
>
> - **Para Excel y PowerPoint, sin cambios**: el conversor borra los
>   comentarios por la API.
> - **Para Word, el paso por la API queda como control**: si el documento
>   que recibe el conversor todavía tiene cambios, la conversión falla
>   cerrada con `details.phase: "preprocess"`. Las dos trampas del paso 1
>   (`RecordChanges` y `RedlineProtectionKey`) se siguen aplicando.

Antes de exportar, el conversor:

- **acepta el control de cambios**: aplica las inserciones y descarta lo
  borrado;
- **borra los comentarios**.

Así el visor muestra lo mismo que va a tener el Word limpio (`Plan_1.2.md`
§3 y §6.3). Lo borrado no entra a la app.

**El preproceso es obligatorio.** Sin él, el texto borrado de un Word y
las notas visibles de un Excel salen en el PDF aunque los `FilterData`
digan otra cosa (§8.7 del plan).

**El mecanismo es la API de LibreOffice, dentro del mismo conversor**,
medido en el build sin interfaz y en un Worker:

1. **Antes de tocar nada:**
   - `RecordChanges` en `false`; si no, borrar un comentario queda
     registrado como un cambio y el comentario sigue ahí;
   - se vacía `RedlineProtectionKey`; si no, un documento con el control
     de cambios protegido no acepta y traba la instancia.
2. **Aceptar los cambios de un Word**, con `.uno:AcceptAllTrackedChanges`
   por el despachador. Con el documento abierto oculto hay frame.
   - Es asíncrono: se espera hasta que `getRedlines().hasElements()` dé
     `false`, cediendo el bucle de eventos.
   - **Falla cerrado**: si al vencer el plazo quedan cambios, la
     conversión falla con `OFFICE_CONVERT_FAILED` y
     `details.phase: "preprocess"`.
   - La API de lectura (`XRedlinesSupplier`) no sirve para aceptar.
3. **Borrar los comentarios.**
   - **Word**: se borran los campos de anotación con `dispose()`, con sus
     respuestas.
   - **Excel**: `removeByIndex`. Los comentarios en hilo entran como
     notas, así que se borran igual.
     - En una hoja protegida con contraseña no borra nada. Ahí se vacía
       el texto de la nota, se la oculta y se pone `PrintAnnotations` en
       `false`.
     - Todo bucle de borrado tiene un tope de vueltas, porque sin tope se
       cuelga en ese caso.
   - **PowerPoint**: `removeAnnotation`. LibreOffice 26.8 no importa los
     comentarios modernos de PowerPoint, así que no llegan.

Lo medido:

- **En el árbol de LibreOffice**, 113 de 113 Word quedaron sin cambios
  pendientes.
- **Con el preproceso y los `FilterData`**, salieron correctos los 10
  sintéticos y los 189 archivos del árbol, contando la hoja protegida con
  su vía aparte.
- **En 6.000 cambios, esperar tardó 0,93 s.**

**Un caso donde LibreOffice acepta distinto que Word**
(`n830205.docx`): queda a la vista el texto de un párrafo cuya marca de
párrafo estaba borrada. Ese texto está en la página, así que se detecta y
se tapa: es una diferencia de fidelidad, no una fuga.

### 6. Distribución

Los artefactos no van al repo:

- `soffice.wasm`;
- el `soffice.data` recortado y su `.metadata`;
- `soffice.js`.

Se publican como archivos de un release del repo de Anonly, con un tag
propio, por ejemplo `lowa-26.8.3.1-1`. Se fijan en `assets.lock.json`
(URL, versión, `sha256` y tamaño), y `pnpm assets:mirror` los baja y los
verifica, como los modelos de Tesseract (ADR-018).

- **En tiempo de ejecución** se sirven desde el origen propio (`app://`),
  nunca desde un CDN.
- **Actualizar LibreOffice** es correr la receta con el tag nuevo, publicar
  un release nuevo y cambiar el pin en un PR. El PR repite las mediciones
  que cambiaron en esta versión: fidelidad y casos borde con el harness
  del spike, tamaño del PDF y mapeo de fuentes.
- **Licencias** (ADR-196): el aviso de licencias del instalador suma la MPL
  2.0 de LibreOffice, las licencias de las bibliotecas que trae adentro y
  las de las fuentes que quedan. Sin Qt, no hay LGPL por enlace estático.

### 7. Tiempo y progreso

- **Plazo**: `timeouts["convert-office"]` vale **120000** ms por documento,
  no por página. Es cinco veces lo que tardó el Excel sintético de 60.000
  filas (`Casos_Borde` §3).
- **Reintentos**: `maxRetries["convert-office"]` vale **0**, porque
  convertir es determinista.
- **Progreso**: LibreOffice convierte el documento entero de una vez, sin
  avisar por página. El Orchestrator emite `PIPELINE_PROGRESS` con
  `stage: Importing`:
  - `current: 0` y `total: 1` al despachar;
  - `current: 1` y `total: 1` al recibir el PDF.

  Cómo lo muestra la interfaz lo decide el ADR de la interfaz (§10 del
  plan).
- **No hay `CONVERSION_PAGE_FINISHED`** para Office.

### 8. Errores

- **`OFFICE_CONVERT_FAILED`**, nuevo, con `details: { phase: "load" |
  "preprocess" | "export" }`. ADR-242 le suma `"decrypt"`. Cubre estos
  casos:
  - quedan cambios sin aceptar al vencer el plazo (§5);
  - LibreOffice no abre el archivo: `loadComponentFromURL` devuelve
    `null`;
  - falla al exportar;
  - el WebAssembly se cae (`RuntimeError`).

  Termina en `PIPELINE_FAILED`. No es reintentable. La interfaz dice que
  el archivo no se pudo abrir, sin decir que está dañado: en el corpus
  hubo archivos válidos que LibreOffice no abre.
- **`CONVERT_TIMEOUT`** se reusa. Sus `details` pasan a ser opcionales:
  `{ pageIndex }` para una imagen (ADR-239) y `{}` para Office.
- **`FORMAT_UNSUPPORTED`** queda como está (ADR-238). Un Office cifrado
  lo resuelve ADR-242.

### 9. La contraseña

Lo que ADR-238 §7 le dejó al ADR del conversor, un Office con contraseña,
se decidió aparte en ADR-242, con la medición del §8.7 del plan:

- descifra el Convert Engine con código propio y WebCrypto, antes de
  convertir;
- el conversor nunca recibe la contraseña.

### 10. Lo que este ADR no decide

- **El Word limpio**, su alineación y su gate (`Plan_1.2.md` §6.2 y §6.3).
- **La interfaz** de la espera y de los errores.

## Consecuencias

- **No se integra ZetaOffice.** No hay ventana aparte ni excepción de CSP.
- **Cada versión de LibreOffice que se quiera seguir es una recompilación
  manual**, de 75 a 85 minutos, más la repetición de las mediciones.
- **Un PR de dependencia nueva**: los artefactos de LibreOffice entran por
  `assets.lock.json` (R-12, ADR-018). No hay paquete npm nuevo.
- **Contratos que cambian al pasar a los specs**:
  - `WorkerJobType` gana `convert-office`, con su plazo y sus reintentos;
  - `ErrorCode` gana `OFFICE_CONVERT_FAILED`;
  - los `details` de `CONVERT_TIMEOUT` se vuelven opcionales;
  - el Convert Engine gana `convertOffice` y su entrada, con
    `sourceFormat` en `"docx" | "xlsx" | "pptx"`, y devuelve el mismo
    `ConvertOutput` de ADR-239;
  - specs que se tocan: `Convert_Engine.md`, `Orchestrator.md`,
    `05_Worker_Architecture.md` y `06_Pipeline.md`.
- **La 1.2 trae por primera vez un componente compilado por nosotros.** Su
  receta y sus mediciones quedan en el repo y en
  `roadmap/formatos/`.
