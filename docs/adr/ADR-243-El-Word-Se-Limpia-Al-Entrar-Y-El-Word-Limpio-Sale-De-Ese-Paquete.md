<!-- CONTEXT: scope=adr | dependencias=roadmap/Plan_1.2.md,roadmap/formatos/Word_Limpio_Alineacion_2026-11-24.md,adr/ADR-009-Export-Strategy.md,adr/ADR-059-Leyenda-Opcional-De-Marcadores.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-238-El-Formato-De-Origen-Se-Reconoce-Por-El-Contenido-Y-La-Salida-Se-Elige-Al-Exportar.md,adr/ADR-240-Word-Excel-Y-PowerPoint-Entran-Por-Un-LibreOffice-Compilado-Por-Nosotros.md,adr/ADR-242-Un-Office-Con-Contrasena-Se-Descifra-Antes-De-Convertir.md,core/Contracts.md,core/Convert_Engine.md,core/Export_Engine.md,core/Render_Engine.md,core/Orchestrator.md,architecture/08_Security_Model.md | audiencia=humanos+IA | fase=1.2 -->

# ADR-243 — El Word se limpia al entrar, y el Word limpio sale de ese paquete

- **Estado**: Aceptado por el mantenedor el 2026-11-24, con el techo de
  tamaño de §3 por memoria en lugar de por caracteres. Pasado a los
  contratos y los specs el mismo día, con las precisiones de §9 y el spec
  nuevo `core/OOXML.md`. Los dos números de §3 esperan la medición de
  memoria.
- **Fecha**: 2026-11-24.
- **Decidido por**: el planificador, sobre las decisiones del mantenedor de
  `Plan_1.2.md` §3.
- **Origen**: `Plan_1.2.md` §6.2 y §6.3, y el mapa de ADR de §10 («Qué
  significa "no recuperable" en un Word, y su gate»).
- **Enmienda**: ADR-240 §5 (el preproceso de un Word), ADR-242 (qué bytes
  guarda la app) y ADR-009 (la garantía del export, para `output: "docx"`).

## Contexto

### 1. Lo que decidió el mantenedor

Todo está en `Plan_1.2.md` §3:

- Cuando entra un Word, sale **el mismo Word, limpio**: conserva el diseño,
  los estilos y las tablas, con los datos reemplazados. Se rearma con una
  lista cerrada de partes y se borra lo que esconde datos.
- **Un Word entra a la app solo con su última versión.** Nada del historial
  llega a la vista ni a ninguna salida. En palabras del mantenedor: el
  documento «no tiene que tener metadata del original destapado, eso es una
  de las promesas de la app».
- **Una detección que no se puede ubicar en el XML no puede quedar en
  claro**: el Word no se exporta y se ofrece el PDF.
- **El texto del Word que LibreOffice no dibuja se muestra en la vista
  previa**, en páginas al final del documento. Los detectores buscan ahí, y
  lo que se tapa se reemplaza en su lugar del Word limpio. Esas páginas no
  salen en el PDF.
- **Las imágenes adentro de un Word pasan por OCR**, y en el Word limpio se
  reemplazan por su versión tapada.

### 2. Lo que midió el spike de alineación

`formatos/Word_Limpio_Alineacion_2026-11-24.md` (`Plan_1.2.md` §8.8):

- Un lector y un alineador propios, sin dependencias, ubican en un solo
  lugar del XML el 91 % de las palabras de las páginas, y 230 de 254 datos
  con forma de DNI, CUIT o correo. Ninguno de esos datos quedó sin ubicar.
- El 4,1 % de los caracteres del XML no tiene par en las páginas. Buena
  parte es texto que **ninguna página puede mostrar**: encabezados de un
  tipo que no se usa, notas sin referencia, el valor guardado de un campo
  que LibreOffice recalcula, el `mc:Fallback`.
- Ese texto sigue adentro del `.docx`. Si el Word limpio se arma desde el
  original, viaja aunque la vista no lo muestre.

### 3. El problema de limpiar al exportar

Si la app guarda el original y lo limpia recién al exportar, la vista
previa muestra una cosa y el Word limpio lleva otra. La diferencia es todo
lo que la limpieza cambia: los campos, lo oculto, lo que no se usa. Y el
original, con su historial y sus metadatos, queda en la memoria de la app
toda la sesión.

## Decisión

### 1. El Word se limpia al entrar

Cuando entra un `.docx`, el Convert Engine arma un **paquete limpio** antes
de convertir. Ese paquete es lo que convierte LibreOffice, lo que guarda la
app y la base del Word limpio. **El original se descarta** apenas está el
paquete limpio.

Así la vista previa muestra exactamente lo que va a salir, y lo único que
cambia al exportar son los reemplazos.

La lista es cerrada: lo que no está en «queda» no entra.

**Queda:**

- `word/document.xml`, los estilos, la numeración y el tema;
- `fontTable.xml`, sin las fuentes incrustadas;
- `settings.xml` con una lista blanca de elementos;
- los encabezados y pies **que se usan**, según `headerReference`,
  `titlePg` y `evenAndOddHeaders`;
- las notas al pie y al final que alguna referencia usa;
- las imágenes ráster, **recodificadas desde los píxeles**, sin EXIF, XMP
  ni perfil de color:
  - el codificador JPEG de Chromium agrega un perfil sRGB, así que
    después de codificar se sacan los segmentos `APP1` a `APP15` y `COM`;
  - un GIF pasa a PNG con su primer cuadro;
  - una imagen con `a:srcRect` se recorta de verdad y pierde el
    `srcRect`, para que lo recortado no quede dentro del archivo;
  - un TIFF pasa a PNG con `utif2`, que el Convert Engine ya tiene
    (ADR-239 §7);
- las imágenes vectoriales (EMF, WMF, SVG) **quedan como vectoriales**,
  sin sus metadatos: en un EMF se vacía la descripción de la cabecera y se
  quitan los comentarios que no son EMF+, y en un SVG, `metadata`,
  `title`, `desc` y los comentarios. No se rasterizan, porque su texto
  dejaría de ser texto: en los documentos de prueba que tienen
  vectoriales, se perdía el 58 % de las palabras de las páginas, que solo
  vería el OCR a 96 dpi, también en el PDF (§8.9). Una tapa sobre el
  texto de una vectorial no se puede aplicar adentro del Word, así que ese
  Word no se exporta (§5). El mantenedor aceptó ese costo el 2026-11-24.
  La limpieza de los metadatos de una vectorial
  no se midió: la cubren los tests de la implementación, comparando la
  página convertida antes y después;
- los gráficos, sin su libro incrustado;
- los diagramas (SmartArt);
- `[Content_Types].xml` y las relaciones, rearmados con lo que queda.

**Se va:**

- `docProps/*`, con la miniatura;
- `customXml/*` y los `w:dataBinding` que apuntan ahí;
- los comentarios y `people.xml`;
- el glosario, las macros, los objetos incrustados (OLE) y los controles
  ActiveX. La vista previa de un objeto incrustado queda como imagen;
- `webSettings.xml` y las fuentes incrustadas;
- los encabezados y pies que no se usan, y las notas sin referencia;
- el `mc:Fallback` de cada `mc:AlternateContent`: queda el `mc:Choice`;
- los identificadores de edición: `w:rsid*`, `w14:paraId`, `w14:textId` y
  `w15:docId`;
- de `settings.xml`: `w:rsids`, `w:docVars`, `w:attachedTemplate`,
  `w:mailMerge` y la protección con su hash;
- el texto oculto, también el que se oculta por estilo;
- los destinos externos de los hipervínculos (el texto queda), como en el
  PDF, que sale sin anotaciones (ADR-240 §3);
- los marcadores, salvo los que referencia un `w:anchor`: esos quedan con
  nombres neutros (`_bm1`, `_bm2`…), para que no se pierda la navegación
  de un índice. En la medición resolvieron las 282 anclas de los 51
  documentos que tenían. Se pierden los enlaces que generaba un campo
  congelado, como el del número de página de un índice;
- el texto alternativo de las imágenes (`descr` y `title`), y el nombre
  de cada objeto, que pasa a ser «Objeto N» porque puede traer el nombre
  de un archivo;
- las partes de un tipo de relación que la lista no conoce
  (`stylesWithEffects`, por ejemplo).

**Se resuelve:**

- **los cambios se aceptan**: lo insertado entra, y lo borrado, las filas
  borradas y los cambios de formato salen;
- **los campos se congelan** a su resultado guardado, salvo `PAGE`,
  `NUMPAGES`, `SECTIONPAGES` y `SECTION`, que quedan vivos. Así
  LibreOffice dibuja el mismo valor que va a tener el Word limpio, y un
  dato en un campo (una ruta de `FILENAME`, por ejemplo) se ve y se
  detecta.

Esto reemplaza el preproceso en el XML de la enmienda a ADR-240 §5, que
pasa a ser una parte de este paso. El control por la API de LibreOffice
sigue: si el paquete que recibe el conversor todavía tiene cambios, la
conversión falla cerrada con `details.phase: "preprocess"`.

Con un Word con contraseña (ADR-242), lo que se limpia es el paquete
descifrado, y lo que la app guarda es el paquete limpio.

Lo medido (`Plan_1.2.md` §8.9):

- **La limpieza tarda 3,4 ms de mediana** y 43 ms en el p99, en un Worker
  con CSP estricta.
- **LibreOffice abre 2.089 de 2.090 paquetes limpios.** El que no abre
  tampoco abría como original.
- **Desaparece por construcción** el texto que ninguna página podía
  mostrar: los encabezados que no se usan, las notas sin referencia y el
  `mc:Fallback`.
- **También desaparecen los 10 Word** en que LibreOffice aceptaba los
  cambios distinto y dejaba a la vista texto borrado (§8.8). Ahora acepta
  nuestro código.
- **El texto que LibreOffice no dibuja de verdad se queda**: los
  caracteres sin par bajan solo del 4,1 al 3,4 %. Eso lo cubre §4.

### 2. El código vive en un paquete puro nuevo

`packages/anonymization-core/ooxml` (`@anonly/ooxml`):

- lee y escribe ZIP con `DecompressionStream` y `CompressionStream`, más un
  CRC32 propio;
- tokeniza el XML y lo edita en el lugar, sin `DOMParser`, que en un Worker
  no existe;
- arma el paquete limpio (§1);
- lee el texto del paquete con el mapa de cada carácter a su origen;
- alinea ese texto con el de las páginas (§3);
- escribe el Word limpio (§5) y lo verifica (§6).

No es un motor: no emite eventos, no recibe `ctx` y no hace E/S, como
`@anonly/shared`. Lo usan el Convert Engine al entrar y el Export Engine al
exportar. No suma dependencias externas (R-12).

### 3. La alineación

El texto de las páginas es el de las palabras del PDF Engine, el mismo que
ven los detectores. Se alinea con el texto del paquete limpio en dos
pasadas, como en el spike:

1. el cuerpo contra todas las páginas, con anclas únicas (patience diff);
2. lo que no es cuerpo (encabezados, pies, notas, cuadros) contra lo que
   quedó sin par, por unidad. Una unidad que aparece en muchas páginas,
   como un encabezado, apunta siempre al mismo lugar del XML.

Sobre el paquete limpio, el 93,9 % de las palabras de las páginas se ubica
en un solo lugar del XML (§8.9). Lo que no se puede decidir no se elige:
queda ambiguo. Una detección
ambigua entre copias idénticas se resuelve con el reemplazo por valor
(§5).

**Se alinea el documento completo de una vez.** En el Worker, alinear
tarda unos 0,7 s y ocupa unos 240 MB por millón de caracteres, y crece
lineal. Alinear por tramos de páginas no se adopta: bajaba el tiempo en
los sintéticos, pero en los documentos de prueba el orden de las páginas
no siempre sigue al del XML, y varios caían al 60 u 80 % de caracteres
bien ubicados (§8.9).

**Techo: el Word más grande que entre en el techo de memoria de la app**,
que es de 3,0 GB (perfil P2 de ADR-192). Lo decidió el mantenedor el
2026-11-24, en lugar del millón de caracteres que proponía el borrador:
un número fijo era una limitación importante.

- **Para que entre el Word más grande posible:**
  - en un Word grande, el Orchestrator cierra el Worker de LibreOffice
    antes de alinear, lo que libera unos 600 MB, y `align-docx` lo vuelve
    a abrir solo si hacen falta páginas extra (§4). Eso suma unos 2,7 s,
    solo en esos documentos;
  - el alineador de la implementación tiene que ocupar menos memoria que
    el del prototipo, que no estaba optimizado.
- **El número sale de una medición.** La medición de memoria con
  documentos convertidos (`Plan_1.2.md` §8) fija dos números, que van al
  spec:
  - a partir de qué tamaño se cierra el Worker antes de alinear;
  - cuántos caracteres entran en los 3,0 GB.
- **Es por documento.** Cada Word se alinea solo, en su Worker, que
  devuelve la memoria al terminar. Con varios documentos cuenta el más
  grande, no la suma. Los PDF no se alinean.
- **Por encima del techo**, el documento entra igual, con sus salidas de
  PDF, pero sin el Word limpio (§7).

### 4. Las páginas del texto que no se ve

Lo que queda del paquete limpio sin par en las páginas es texto que
LibreOffice no dibuja: un cuadro o una forma, un marco recortado, una celda
girada, el marcador de un control vacío.

- El Convert Engine arma un documento chico con ese texto, un párrafo por
  pedazo y una etiqueta corta de dónde viene («Cuadro de texto»,
  «Celda», «Encabezado», «Nota al pie», «Texto que no se dibujó»…).
- Lo convierte **el mismo Worker de LibreOffice** que convirtió el
  documento, que el Orchestrator deja vivo hasta este paso y termina
  después. Con un Worker nuevo, el arranque sumaría 2,7 s.
- Los resultados guardados de `PAGE`, `NUMPAGES`, `SECTIONPAGES` y
  `SECTION` no cuentan como pedazos: son números de página.
- Sus páginas se suman al final del documento, marcadas con
  `Page.origin: "unseen-text"`. Un `Page` sin `origin` es una página del
  documento, así que todo `Page` de hoy sigue valiendo.
- Los detectores corren sobre esas páginas como sobre cualquier otra.
- Cada pedazo sabe a qué lugar del XML vuelve, y ese mapa viaja con el
  paquete limpio hasta el export.
- **El PDF exportado no lleva esas páginas**: el PDF sale de las páginas
  convertidas, que no tienen ese texto.
- Cómo las distingue el visor va en el ADR de la interfaz de la 1.2.

Lo medido (`Plan_1.2.md` §8.9):

- **Tienen estas páginas el 15,9 % de los Word de prueba.** Casi siempre
  es una página, y como mucho fueron 16.
- **Con el mismo Worker vivo, convertirlas suma 35 ms** de mediana y
  85 ms en el p99, sin memoria medible. Sumarlas al PDF con `pdf-lib`
  tarda 9 ms de mediana.
- **La limpieza de metadatos del PDF intermedio (ADR-240 §3) cubre también
  esas páginas.**
- **Su texto vuelve a su lugar del XML**: de 28.561 caracteres que se
  alinean, uno solo volvió mal. Lo que no se alinea es texto en
  escrituras no latinas, que LibreOffice no dibuja ni ahí. Es la
  limitación conocida de `Plan_1.2.md` §3: un dato ahí no se detecta.

### 5. El Word limpio al exportar

Con `ExportOptions.output: "docx"` (ADR-238 §5), el Export Engine recibe
el paquete limpio, las palabras de las páginas, el mapa de §4 y los
`Replacement` del export.

1. **Cada reemplazo se ubica en el XML**, por sus palabras y la alineación.
   Los de las páginas de §4 se ubican por el mapa.
2. **Si alguno no se ubica, el Word no se exporta** (`Plan_1.2.md` §3). El
   error lleva la lista de los que no se ubicaron, con su página y su caja,
   para que la interfaz los muestre y ofrezca el PDF.
3. **Reemplazo en su lugar**: el texto del reemplazo toma el formato del
   primer run que tapa, y los demás runs del tramo pierden ese texto.
4. **Reemplazo por valor**: además, cada valor original se reemplaza en todo
   el XML que queda, con límites de palabra, incluidos los atributos que
   llevan texto (como el de un WordArt). Cubre las copias idénticas que se
   dibujan menos veces, y lo que la alineación dejó ambiguo.
5. **Imágenes**: una imagen con una tapa se reemplaza por su versión tapada.
   La dibuja el Render Engine, que ya tapa imágenes, por el mismo puerto
   por el que el Export Engine le pide las páginas (ADR-059 §5). El Export
   Engine sigue sin rasterizar nada.
   - **Cómo se ubica la imagen.** Cada imagen que dibuja el PDF se compara
     con las partes de `word/media` por una miniatura de 16×16, probando
     los 8 giros y espejos, porque LibreOffice hornea el giro y el espejo
     en los píxeles. Un giro que no es múltiplo de 90° se toma del XML.
   - La tapa se pasa a los píxeles de la parte con la transformación
     inversa. Si la misma parte se usa en dos dibujos, queda tapada en los
     dos.
   - Medido (§8.9): se ubica sin ambigüedad el 75,9 % de las imágenes
     reales. Casi todas las ambiguas son la misma imagen guardada en dos o
     tres partes iguales, y se tapan todas. En los sintéticos se taparon
     14 de 15 casos, incluidos JPEG, GIF, agrupaciones, VML y formas con
     relleno de imagen.
   - **Una imagen con una tapa que no se ubica cuenta como un reemplazo
     sin ubicar** (paso 2). En el corpus hubo alguna imagen así en el
     8,7 % de los documentos con imágenes: casi todas tienen sombra,
     mosaico o transparencia.
   - **Una tapa sobre el texto de una imagen vectorial también cuenta como
     sin ubicar**: ese texto está adentro de la imagen (§1).
6. **El texto del reemplazo** es el `replacementValue` del grupo, el mismo
   que dibuja el PDF.
   - En modo `redact` («Tapar con negro») ese valor es vacío. En el Word
     va **un bloque del largo del original**: tantos `█` (U+2588) como
     caracteres tiene el valor, espacios incluidos.
   - Lo decidió el mantenedor el 2026-11-24, para que se parezca lo más
     posible a la caja negra del PDF: un bloque de largo fijo queda muy
     corto con un dato largo y muy largo con uno corto.
   - LibreOffice dibuja el `█` como un bloque continuo, con Liberation o
     DejaVu. Como la caja del PDF, deja ver el largo del dato.
   - Un reemplazo de otro largo que el dato mueve el texto. Medido (§8.9):
     con `█`, cambia la cantidad de páginas el 3,0 % de los documentos de
     prueba con detecciones; con fichas como `[DNI-01]`, el 4,9 %.
7. **El reemplazo por valor y la verificación tienen que ser lineales**:
   cada valor se busca solo donde empieza un token igual a su primer
   token. Buscar cada valor en cada texto es cuadrático: a 2 millones de
   caracteres, la verificación tardaba casi un minuto, y con el índice,
   129 ms.

### 6. La verificación del Word limpio

Al terminar de escribir, el Export Engine **relee el Word limpio** y no lo
entrega si falla algo. Es el equivalente, en cada export, de lo que
ADR-148 verifica en los tests para el PDF:

- **Ningún valor original**: se busca cada `originalValue` de los
  reemplazos, normalizado (NFKC, minúsculas, espacios colapsados).
  - **Dónde**: en todo nodo de texto de todas las partes, salvo una lista
    cerrada de nodos que no son texto (`w:instrText`, posiciones de
    dibujo, fórmulas de gráfico); en el texto de cada párrafo, cruzando
    runs; y en los atributos que llevan texto (`v:textpath@string`,
    `w:alias`, `w:tag`, `w:lvlText`, `w:listItem`). Un nodo de texto que
    el lector no conoce cuenta igual.
  - **Qué es un hallazgo**: una coincidencia con límites. Para un valor
    con letras, que no tenga letra ni número a los costados; para uno
    numérico, se comparan solo sus dígitos y no tiene que haber otro
    dígito a los costados. Una subcadena de una
    palabra más larga no es hallazgo, y tampoco un valor de enumeración o
    el nombre de una parte.
- **Solo la lista cerrada**: ninguna parte fuera de §1, ninguna relación
  externa, ningún `w:rsid*`, `w:ins`, `w:del` ni comentario.
- **Es independiente del lector.** Recorre todas las partes con su propio
  paso por el XML, sin usar el modelo de texto del lector. En la medición,
  así encontró la única fuga real: el texto de las ecuaciones partido en
  varios runs, que el lector no leía (§8.9).

Si falla, el export falla cerrado y no se escribe ningún archivo. Además,
la suite de seguridad corre la misma verificación sobre los sintéticos,
como ADR-148 con el PDF.

Lo medido (`Plan_1.2.md` §8.9):

- **En los sintéticos desaparecen los 224 datos**, incluidos los 42 que
  ninguna página muestra.
- **En el corpus no quedó ninguna fuga.** Aplicada al paquete sin
  reemplazar, la verificación sí encuentra los datos: no es un gate
  vacío (ADR-149).
- **LibreOffice abre los 2.089 Word limpios.** El 96,6 % tiene la misma
  cantidad de páginas que el paquete limpio, y el resto cambia porque el
  reemplazo ocupa distinto que el dato.
- **El validador de Microsoft da en el Word limpio los mismos errores que
  en el paquete limpio**: el escritor no agrega ninguno. Lo que haría Word
  no se pudo probar.
- **Con esa regla pasa el 99,86 % del corpus** (2.086 de 2.089). Los 3
  que no pasan son documentos de prueba hechos de la letra `x`, y no
  tienen ningún dato. Sin reemplazar, la verificación encuentra los datos
  en 1.441 de 1.449 documentos con detecciones; los 8 restantes los tienen
  solo dentro de palabras más largas.
- **Lo que la verificación no ve**: un dato pegado adentro de un token
  más largo sin espacios, como una URL. En los documentos de prueba son
  cadenas de teclado; en documentos reales no se midió.
- **En el Worker**, escribir tarda 2,6 ms de mediana y verificar 2,0 ms,
  con el mismo `.docx` byte a byte que en Node.

### 7. Trabajos, plazos y errores

- **Al entrar**, para un Word:
  1. el trabajo `convert-office` (ADR-240 §2) limpia, convierte y
     devuelve el PDF. Con un Word, el Orchestrator **no termina el Worker**
     todavía;
  2. el PDF Engine lee las páginas, como con cualquier PDF;
  3. el trabajo nuevo `align-docx`, en el mismo Worker, recibe las
     palabras de las páginas, alinea, arma el documento chico de §4 y lo
     convierte. Devuelve el PDF de las páginas extra, si hay, y el mapa de
     §4;
  4. el PDF Engine lee esas páginas, el Orchestrator las suma al final con
     `origin: "unseen-text"` y termina el Worker.
- Con un Word grande, el Worker se cierra antes del paso 3, y
  `align-docx` lo vuelve a abrir solo si hay páginas extra (§3).
- El plazo de `align-docx`, `timeouts["align-docx"]`, es de 60.000 ms,
  con `maxRetries` 0. Alinear tarda unos 0,7 s por millón de caracteres, y
  volver a abrir el Worker, unos 2,7 s.
- **Cuando el Word limpio no se ofrece.** Si el texto del paquete pasa el
  techo de §3, o si `align-docx` falla, el documento entra igual, sin
  páginas extra, y lleva `Document.docxUnavailable: "too-large" |
  "align-failed"`.
  - Ausente, el Word limpio se ofrece como dice ADR-238 §5.
  - Presente, la salida `docx` no se ofrece, y un `ExportOptions` con
    `output: "docx"` para ese documento es un `InvalidInputError`.
  - Qué le dice la interfaz al usuario va en el ADR de la interfaz.
- Las palabras de las páginas son siempre las del PDF Engine, así que el
  Convert Engine sigue sin `pdfjs-dist` (`Convert_Engine.md` §5).
- Que el Worker de LibreOffice siga vivo mientras el PDF Engine lee las
  páginas suma memoria al pico. Lo mide la medición de memoria con
  documentos convertidos (`Plan_1.2.md` §8).
- **Al exportar**: el Word limpio es un camino nuevo del Export Engine para
  `output: "docx"`, en su mismo Worker.
- **Errores nuevos** del Export Engine:
  - `EXPORT_DOCX_UNLOCATED`: hay reemplazos que no se ubican en el XML;
    `details: { replacements: { pageIndex, bbox }[] }`.
  - `EXPORT_DOCX_VERIFY_FAILED`: la verificación de §6 encontró algo;
    `details: { check: "value" | "part" | "structure" }`, sin el valor.
- Al entrar, una falla de la limpieza es `OFFICE_CONVERT_FAILED` con
  `details.phase: "clean"`, que se suma a las fases de ADR-240 §8.

Ninguno de los nombres nuevos (`EXPORT_DOCX_UNLOCATED`,
`EXPORT_DOCX_VERIFY_FAILED`, `Page.origin`, `Document.docxUnavailable`,
`align-docx`, la fase `"clean"`) existe hoy en `Contracts.md` ni en
`shared/src`.

### 8. Lo que este ADR no decide

- Cómo muestra la interfaz las páginas de §4 y qué dice el diálogo de
  exportar cuando el Word no se puede exportar: va en el ADR de la
  interfaz.
- El Word como salida de un Excel o un PowerPoint: no existe (`Plan_1.2.md`
  §11).

### 9. Precisiones del pase a los specs (2026-11-24)

Las agregó el planificador al pasar este ADR a los specs. Fijan cómo viajan
los datos entre motores, sin cambiar nada de lo que el usuario ve.

1. **Lo que el Orchestrator retiene de un Word** son dos `ArrayBuffer`: el
   paquete limpio y la alineación. La alineación la codifica y la decodifica
   `@anonly/ooxml` (`core/OOXML.md`). El Orchestrator no la lee, y no
   retiene el original ni los bytes cifrados.
2. **El visor ve las páginas extra en el mismo PDF.** `align-docx` recibe
   también el PDF intermedio. Devuelve dos PDF: el de las páginas extra, y
   el intermedio con esas páginas sumadas al final con `pdf-lib`, que son
   los 9 ms de §4.
   - El PDF Engine lee solo el de las páginas extra, con dos campos nuevos
     de su entrada: el índice de la primera página y el origen
     `"unseen-text"`. Así emite `PAGE_PARSED` con el índice final, y no
     emite un segundo `DOCUMENT_PARSED`.
   - Lo que el Orchestrator retiene para el Render Engine es el intermedio
     con las páginas extra. Se lo pasa antes de que el Render Engine cargue
     el documento, porque `align-docx` corre en la etapa `Extracting`.
3. **Las imágenes que dibuja cada página las informa el PDF Engine**, solo
   con `sourceFormat: "docx"`. Por cada imagen da su caja, su matriz y su
   miniatura de 16×16, que el PDF Engine ya puede leer con pdfjs.
   - `align-docx` compara esas miniaturas con las de las partes de
     `word/media` (§5, paso 5). El Convert Engine decodifica imágenes desde
     ADR-239.
   - El resultado va adentro de la alineación.
4. **El Render Engine tapa una parte de imagen** con un método nuevo del
   puerto del export (ADR-059 §5). Recibe los bytes de la parte, su tipo y
   las tapas en píxeles de la parte. Las dibuja como en una página, con la
   caja y el texto del reemplazo, y devuelve la imagen codificada de nuevo.
5. **Si `align-docx` falla**, el Convert Engine lanza
   `OFFICE_CONVERT_FAILED` con `details.phase: "align"`, o
   `CONVERT_TIMEOUT`. El Orchestrator no lo propaga: el documento sigue sin
   páginas extra y con `docxUnavailable: "align-failed"`.
6. **Los dos números de §3** van en `ConvertConfig` cuando los fije la
   medición de memoria:
   - `docxCloseWorkerChars`, a partir del cual se cierra el Worker antes de
     alinear;
   - `docxMaxChars`, el techo.

   `convert-office` devuelve el largo del texto del paquete limpio.
   - El Orchestrator lo compara con `docxMaxChars`: por encima, no despacha
     `align-docx`.
   - El Convert Engine lo compara con `docxCloseWorkerChars`. LibreOffice
     corre en un Worker clásico anidado adentro del Worker del pool
     `convert`, porque `soffice.js` es un script clásico. El motor cierra
     ese Worker anidado al terminar de convertir y lo vuelve a abrir solo
     si hay páginas extra. Es «cerrar el Worker de LibreOffice» de §3, sin
     perder el resto del motor.

   Hasta la medición, el frente del Word limpio no se cierra.
7. **Una página tapada entera** (`coveredPages`, ADR-190 §5) en un Word
   limpio: cada palabra de esa página cuenta como un reemplazo en modo
   `redact`, y cada imagen que dibuja, como una tapa entera. Es lo que hace
   la página tapada en el PDF, llevado al Word. Lo que no se ubique es un
   reemplazo sin ubicar, y el Word no sale (§5, paso 2). Lo confirmó el
   mantenedor el 2026-11-24.
8. **Un Word limpio que no sale no traba el documento.** Con
   `EXPORT_DOCX_UNLOCATED` o `EXPORT_DOCX_VERIFY_FAILED`, el Orchestrator no
   emite `PIPELINE_FAILED`: el documento vuelve a la etapa en que estaba,
   para que el usuario pueda exportar en PDF, que es lo que ofrece §5,
   paso 2.

## Consecuencias

Cambian, después de que el mantenedor acepte:

- `Contracts.md` y `03_Data_Model.md`: `Page.origin`,
  `Document.docxUnavailable`, los dos errores nuevos, la fase `"clean"` y
  el plazo de `align-docx`.
- `Convert_Engine.md`: la limpieza, la alineación y el documento chico;
  `@anonly/ooxml` en sus dependencias permitidas.
- `Export_Engine.md`: el camino de `output: "docx"` y su verificación;
  `@anonly/ooxml` en sus dependencias permitidas.
- `Render_Engine.md`: tapar una imagen del Word por el puerto del export.
- `PDF_Engine.md`: las páginas extra con su índice y su origen, y las
  imágenes que dibuja cada página de un Word (§9).
- `Orchestrator.md`: guarda el paquete limpio en lugar del original, el
  trabajo nuevo al entrar y las páginas de §4 fuera del PDF.
- Un spec nuevo, `core/OOXML.md`, para el paquete puro.
- `08_Security_Model.md` y ADR-009: qué garantiza un Word limpio.
- ADR-240 §5 y ADR-242: las enmiendas de §1.
- `CLAUDE.md` y `ai/Code_Standards.md` §12, si nombran los paquetes que un
  motor puede importar.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Guardar el original y limpiar al exportar** | La vista previa y el Word limpio salen de textos distintos, y el original queda en la memoria toda la sesión (Contexto §3). |
| **Frenar el Word si hay texto sin par** | Medido en §8.8: frenaba entre el 8,6 y el 22,4 % de los Word de prueba. El mantenedor eligió mostrarlo (§3). |
| **Borrar el texto sin par y avisar** | Se pierde contenido que el usuario ve en Word. El mantenedor eligió mostrarlo (§3). |
| **Dibujar las páginas de §4 con `pdf-lib`** | Con sus fuentes de serie solo hay WinAnsi; para incrustar una fuente hace falta `@pdf-lib/fontkit`, una dependencia nueva. LibreOffice ya tiene las fuentes. |
| **Un lector de XML de terceros** (`sax`, `@xmldom/xmldom`) | Es una dependencia nueva para algo que el spike resolvió con unas 100 líneas. |
| **Rasterizar las imágenes vectoriales al entrar** | Su texto pasa a ser píxeles que solo ve el OCR, también en el PDF: se perdía el 58 % de las palabras de esos documentos. La ruta fiel de LibreOffice da 96 dpi, y las que dan más resolución no dibujan igual (§8.9). |
| **Quitar las imágenes vectoriales** | Es lo que hacía el prototipo: la vista previa y el Word quedan iguales, pero se pierde contenido que el usuario ve en Word, como un gráfico pegado desde Excel. |
| **Un techo fijo de un millón de caracteres** | Lo proponía el borrador. El mantenedor lo vio como una limitación importante, y el techo pasó a ser el de memoria (§3). |
| **Alinear por tramos de páginas** | Bajaba el tiempo y un 20 % la memoria en los sintéticos, pero en los documentos de prueba varios caían al 60 u 80 % de caracteres bien ubicados (§8.9). |
| **Reemplazar solo en el lugar, sin buscar por valor** | Deja en claro las copias idénticas que se dibujan menos veces, y lo que la alineación deja ambiguo (§8.8). |
