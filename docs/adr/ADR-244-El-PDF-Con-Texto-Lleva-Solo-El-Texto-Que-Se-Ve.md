<!-- CONTEXT: scope=adr | dependencias=roadmap/Plan_1.2.md,roadmap/formatos/Texto_Preservado_2026-11-24.md,adr/ADR-004-Rendering.md,adr/ADR-009-Export-Strategy.md,adr/ADR-059-Leyenda-Opcional-De-Marcadores.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-238-El-Formato-De-Origen-Se-Reconoce-Por-El-Contenido-Y-La-Salida-Se-Elige-Al-Exportar.md,adr/ADR-241-La-1.2-Sigue-Con-Pdf-Lib-Y-El-Fork-Se-Reabre-Con-PDF-A.md,core/Contracts.md,core/Export_Engine.md,core/Render_Engine.md,core/Orchestrator.md,architecture/08_Security_Model.md | audiencia=humanos+IA | fase=1.2 -->

# ADR-244 — El PDF con texto lleva solo el texto que se ve

- **Estado**: Borrador del planificador, 2026-11-25, con las rondas 1 a 4
  del spike, y la decisión del mantenedor sobre los escaneos con capa
  invisible (§4). Espera que el mantenedor lo acepte.
- **Fecha**: 2026-11-25.
- **Decidido por**: el planificador, sobre la decisión del mantenedor del
  2026-11-23 de que el texto preservado entra en la 1.2 (`Plan_1.2.md` §3).
- **Origen**: `Plan_1.2.md` §6.4 y §8.10, y la salida `pdf-text` que ADR-238
  §5 dejó para este ADR.
- **Enmienda**: ADR-004, ADR-009 y ADR-059 §4, para la salida `pdf-text`,
  y S-3 de `08_Security_Model.md`. El PDF imagen no cambia.

## Contexto

### 1. Lo que pide el producto

El PDF que exporta la app es una imagen de cada página (ADR-004). Se lee,
pero no se puede seleccionar, copiar ni buscar, y un lector de pantalla no
lee nada. El mantenedor decidió que la 1.2 ofrezca además un **PDF con
texto**: la misma imagen, con una capa de texto invisible encima, como un
PDF escaneado con OCR.

ADR-238 ya fijó el contrato: la salida `pdf-text` existe en `ExportOutput`,
se ofrece para cualquier formato de origen, y la salida que viene elegida
sigue siendo la del formato que entró, `pdf-image` salvo para un Word.

### 2. El riesgo

Las palabras de una página con texto nativo (`Word` de `source: "pdf"`)
incluyen texto que no se ve. Hoy no sale, porque el export es una imagen.
Si la capa se arma con esas palabras tal cual, vuelve a poder copiarse:

- el texto debajo de una caja negra dibujada encima, que es la tachadura mal
  hecha clásica (ADR-004, Contexto);
- el texto blanco sobre blanco, el del color del fondo, el de opacidad 0;
- el texto debajo de una imagen, de un rectángulo o de una anotación;
- el texto invisible (`Tr 3`), recortado, de 0,1 pt o en una capa opcional
  apagada.

### 3. Lo que midió el spike

`Plan_1.2.md` §8.10, `formatos/Texto_Preservado_2026-11-24.md`. Sin
documentos reales: 279 páginas, 15.927 palabras y 647 tapas, con 18 páginas
trampa.

- **Con las palabras tal cual**, 14 de las 15 palabras escondidas que lee el
  PDF Engine llegan a la capa.
- **Con una prueba de visibilidad** no llega ninguna, y se pierde el 0,67 %
  de las palabras, casi todas sin tinta de verdad.
- **El OCR de la imagen ya tapada** no fuga, pero acierta el 82 % de las
  palabras y tarda de 1,2 a 1,9 s por página.
- **En una página escaneada**, el OCR que la app ya hizo sale de la tinta:
  no fuga y no cuesta nada.
- **Un escaneo que ya trae una capa invisible** no se puede resolver sin
  OCR: la prueba de visibilidad la descarta, y aceptarla deja pasar una capa
  falsa.

## Decisión

### 1. Qué es el PDF con texto

`pdf-text` es el PDF de `pdf-image`, con la misma imagen por página, y una
capa de texto invisible encima de cada página.

**La regla que manda todo lo demás: el texto de la capa es el que se ve en
la imagen, ni más ni menos.** Lo que no se ve no entra, lo tapado no entra,
y en el lugar de cada tapa va lo que la imagen muestra ahí.

- **No entra a la capa**:
  - las páginas de `coveredPages` (ADR-190 §5), que salen negras;
  - las páginas de `origin: "unseen-text"` de un Word, que no salen en
    ningún PDF (ADR-243 §4);
  - la hoja de referencia de marcadores (ADR-059), que sigue siendo solo
    imagen.
- **El PDF imagen no cambia**: sigue siendo 100 % imagen, sin una sola capa
  de texto, y sigue siendo la salida que viene elegida (ADR-238 §5).

### 2. De dónde sale el texto de cada página

| Página | Texto de la capa |
|---|---|
| Con texto nativo (PDF digital, Word, Excel, PowerPoint) | las palabras de `source: "pdf"` que pasan la prueba de visibilidad (§3) |
| Escaneada, o una región que pasó por OCR (ADR-065) | las palabras de `source: "ocr"` que la app ya tiene: salen de la tinta y no necesitan la prueba |
| Un escaneo que ya trae una capa invisible | **ninguno en la 1.2**: la página sale solo como imagen (§4) |

Una imagen suelta es una página escaneada (ADR-239).

### 3. La prueba de visibilidad

Una palabra nativa entra solo si su tinta cambia la imagen de la página.

- **Cómo**: el Render Engine dibuja la página dos veces, con el texto y sin
  las operaciones de texto, y compara las dos imágenes adentro de la caja de
  cada palabra.
- **Visible**: al menos 2 px y al menos el 1 % del área de la caja cambian,
  con una diferencia de luma mayor que 6, y la caja mide al menos 2 pt de
  alto. Con un umbral de luma de 32 se perdía una marca de agua pálida.
- **Dónde**: en el mismo trabajo `render-page` del export, a la escala del
  export. No es un trabajo nuevo.
- **Cuesta** un segundo dibujo por página, con las comprobaciones, el área
  propia y los tramos de abajo: unos 30 ms a 150 dpi, medido en Node.
- **El orden importa.** Sacar el texto del segundo dibujo deja la página de
  pdfjs sin texto hasta que se limpia (`cleanup()`). El dibujo de la imagen
  del export va antes, o con otra página; si no, la imagen sale sin texto,
  que es lo que le pasó al arnés de la primera ronda.
- **Falla cerrada.** Sacar el texto exige tocar una parte interna de pdfjs
  4.10 (`_intentStates`), que una actualización puede romper. Cada página
  comprueba cuatro cosas, medidas en la segunda ronda:
  1. la lista filtrada no tiene operaciones de texto;
  2. se sacaron tantas operaciones de texto como cuenta la API pública
     `getOperatorList()`;
  3. las demás operaciones no cambiaron;
  4. un cuadradito testigo, agregado a la lista filtrada, aparece en el
     segundo dibujo y no en el primero: prueba que ese dibujo salió de la
     lista que se filtró.

  Si una falla, o si la parte interna no existe, el export con texto falla
  con el error de §7, y se puede exportar el PDF imagen. En el corpus no
  dispararon nunca, y dispararon en todas las fallas simuladas: el filtro
  que no se aplica, los códigos corridos, el campo que desaparece, otra
  lista, y el filtro que saca de más, que es el que sí fugaría. Además, un
  test fija la versión de pdfjs: al actualizarla, tiene que pasar de nuevo.
- **Una palabra que pisa a otra: se mira solo su área propia.** Una palabra
  invisible cuya caja pisa texto visible pasaba la prueba, porque al sacar
  todo el texto su caja cambia igual. En la tercera ronda fugaba desde un
  solape del 25 %, en 24 de 42 páginas trampa.
  - **La regla**: la comparación se hace solo en los píxeles de la caja que
    no caen en la caja de ninguna otra palabra. Las cajas de las otras se
    ensanchan 2 px a 150 dpi, cerca de 1 pt, y se redondean hacia afuera.
    Los umbrales son los de arriba, medidos sobre esa área. Si a la palabra
    no le queda ningún píxel propio, no entra.
  - **Por qué el margen**: con Courier y Times, a 12 y 24 pt, la tinta de
    una letra visible se sale un poco de su caja y cae en el área propia de
    la invisible. Sin margen fugaba en 48 de 144 páginas de la cuarta ronda;
    con 2 px, en ninguna.
  - **Lo medido**: cierra las 42 trampas de la tercera ronda, de 1 a 100 %
    de solape, con tres formas de invisibilidad y fondo claro y oscuro. En
    la cuarta cierra también el solape de costado, dos o tres invisibles
    apiladas, el texto girado 90, 180 y 270°, y la invisible sobre una
    imagen o un dibujo. La palabra visible de abajo se conserva. No deja
    pasar ninguna palabra que la prueba sola descarta.
  - **Por qué sin un mínimo de área propia**: pedir el 25 % o más no cierra
    ninguna trampa más y pierde más palabras, del 0,17 al 1,15 %.
- **Una palabra con texto escondido adentro: se mira cada letra.** Si un
  texto invisible está pegado a uno visible en la misma línea, el PDF Engine
  los funde en una sola palabra, y la prueba y el área propia la dejaban
  pasar entera: 72 de 72 páginas trampa en la cuarta ronda.
  - **La regla**: la caja de la palabra se parte a lo largo en un tramo por
    carácter, todos del mismo ancho. Cada tramo tiene que pasar los mismos
    umbrales que la palabra. Si uno no pasa, la palabra entera no entra,
    también su parte visible.
  - **Lo medido**: 0 de 72. Con tramos de 2 caracteres también, pero un
    tramo de 3 ya deja pasar 3 letras escondidas en el medio de una palabra,
    así que con tramos de 2 podría pasar una sola. Se usa el de 1.
  - **Lo que no se midió**: el ancho real de cada glifo, que haría exacto
    el tramo; una sola letra escondida; glifos vacíos dentro de un mismo
    operador de texto; y el texto escondido por recorte, máscara o capa
    opcional pegado a uno visible. Los tests de la implementación suman
    esas páginas trampa.
- **Lo que pierden las dos reglas juntas**: 52 de 13.864 palabras
  legítimas, el 0,38 %, en 16 páginas. Son renglones con interlineado más
  chico que la caja, un texto con sombra dibujado dos veces, y las
  etiquetas del eje de un gráfico. Siguen en la imagen; solo no se pueden
  copiar.
- **Lo que una prueba de píxeles no puede cerrar, y no tiene que**: el
  texto del color del fondo sobre una imagen o un dibujo se ve, porque se
  le nota el contorno. Es tinta, y entra.

### 4. El escaneo que ya trae una capa invisible

Muchos escáneres y apps de celular le agregan a la foto una capa de texto
invisible. Esa capa no tiene tinta propia, así que la prueba de §3 la
descarta entera. Y no se puede confiar en ella sin leer la foto: si alguien
tachó un nombre dibujando una caja negra sobre el escaneo, la capa sigue
diciendo ese nombre.

- **Cómo se reconoce la página**: la prueba rechaza al menos una palabra que
  tiene tinta debajo, y una imagen cubre al menos el 80 % de la página. En
  la segunda ronda cayeron las 2 páginas trampa y las 8 armadas para esto, y
  ninguna otra. Equivocarse nunca fuga: una página que no cae pierde su
  capa por la prueba de §3, y una que cae de más sale con OCR.
- **Decisión del mantenedor para la 1.2 (2026-11-25): esas páginas salen
  sin texto.** Van solo como imagen, aunque se elija el PDF con texto. Es
  más peligroso arriesgar que un dato se filtre por una capa invisible que
  no poder buscar o copiar en esas páginas. Pasan a llevar texto solo si se
  demuestra que una vía con OCR es segura del todo.
  - **No necesita OCR al exportar**: la prueba de §3 ya descarta esa capa,
    porque no tiene tinta propia. La regla de abajo, la que reconoce estas
    páginas, sirve para que el diálogo de exportar avise cuántas páginas
    salen sin texto. Cómo lo dice va en el ADR de la interfaz.
  - **Se sigue buscando una vía mejor.** La que más promete es leer esas
    páginas con OCR al importar, como un escaneo sin capa: tendrían texto
    con las mismas garantías y la misma verificación que cualquier escaneo,
    y los detectores leerían lo que se ve.
  - **Lo que midió la tercera ronda**, con 40 páginas sintéticas y 677
    datos plantados: leyendo la capa buena, los detectores encuentran el
    100 % de los datos; leyendo el OCR de la imagen, el 93,1 %, y casi
    todo lo que pierde son correos, porque el OCR lee mal la `@`. Leyendo
    una capa con el 5 % de letras mal encuentran el 77,7 %; con el 15 %, el
    44,9 %; con una capa falsa, el 3,8 %, y tapan 627 datos que no están en
    la imagen. El OCR cuesta unos 4 s por página a 300 dpi.
  - **Lo que midió la cuarta ronda**: detectando con la capa y con el OCR a
    la vez, la app encuentra el 100 % con la capa buena, el 98,1 % y el
    94,1 % con las malas, y el 92,6 % con la falsa. Con la falsa tapa el
    4,55 % de la hoja donde no hay dato, contra el 1,83 % del OCR solo.
    Comparar el texto de la capa con el del OCR separa la capa buena de las
    demás en estas páginas, pero con escaneos reales ese corte se movería.
- **Cómo se siguió midiendo** (mantenedor, 2026-11-25): las dos salidas se
  miden en tiempo, memoria y calidad de detección (`Plan_1.2.md` §8).
- **Es una decisión reabrible.** Se revisa al diseñar los varios documentos
  de la 1.3: con varios documentos en memoria, volver a cargar el OCR al
  exportar puede no ser eficiente (`Roadmap_1.x.md` §6). El ADR de la 1.3
  que la revise enmienda este punto.
- **Las dos salidas que se compararon**:
  - **OCR al exportar**: la capa sale del OCR de la imagen ya tapada. En la
    segunda ronda no fugó nada, tampoco de las capas falsas. Cuesta de 0,3
    a 4,4 s por página a 150 dpi, según cuántas palabras tenga, y acierta
    el 80 % de las palabras de una capa buena. Su verificación es más débil
    que la del resto (§7): solo compara con lo planeado. Por eso no entra en
    la 1.2.
  - **Sin texto**: la que eligió el mantenedor.

### 5. Las tapas

- **Una palabra que toca una tapa no entra**, aunque sea un poco: cualquier
  área de intersección mayor que cero con cualquier fragmento
  (`fragments ?? [bbox]`). En el spike no quedó ninguna palabra tapada en la
  capa, y se perdió el 0,12 % de las vecinas.
- **En el lugar de cada tapa va su `replacementValue`**, una sola vez, en el
  fragmento más ancho, como lo dibuja la imagen (ADR-074 §4). En el orden de
  lectura va donde estaba la primera palabra tapada.
- **`redact` no lleva texto**: en la imagen hay una caja negra sin nada.
- **Cada caja se recorta a la página.** pdfjs descarta el texto que cae
  fuera de la hoja, así que un reemplazo que se sale perdería letras al
  releerlo (segunda ronda).
- **El texto escondido no deja marca.** Una palabra que no pasa la prueba de
  §3 no se reemplaza por nada, ni por `[####]`: una marca avisaría que ahí
  había algo escondido, y cuánto medía, y sumaría a la capa un texto que la
  imagen no muestra.

### 6. Cómo se escribe la capa

Con `pdf-lib` 1.17.1, sin dependencias nuevas (ADR-241):

- **Una fuente propia sin glifos**: un TrueType mínimo de 412 bytes, con dos
  glifos vacíos, como Type0 y `CIDFontType2`, `Identity-H`, todos los CID al
  glifo vacío y un `ToUnicode` por documento. Sirve para cualquier
  escritura.
- **Una palabra por objeto de texto**, en modo de render 3 (invisible), con
  el cuerpo de su caja, `Tz` para que el ancho coincida con la caja, y `Tm`
  para los giros de 90, 180 y 270°. Un espacio entre palabras, en el orden
  de lectura de la página (`03_Data_Model.md` §4).
- **Contenido comprimido.**
- **Lo medido**: la capa se relee en su lugar, con una coincidencia de cajas
  de 0,99; la leen pdfjs y poppler; la imagen queda idéntica a la del PDF
  imagen en 558 de 558 páginas, y el archivo crece un 1,2 %.
- **Se descartó la Helvetica estándar**: no codifica el 1,7 % de las
  palabras del corpus, todas en escrituras no latinas, y `pdf-lib` corta con
  un error. Se relee peor: 0,81.

### 7. La verificación al exportar

Antes de entregar el archivo, la app relee la capa del PDF exportado y no
lo entrega si algo no da. Es independiente de quien la escribió.

- **Qué verifica**, con las reglas que midió la segunda ronda:
  - **Ninguna palabra del original queda bajo una tapa.** Una palabra
    releída que cae sobre una o más tapas pasa solo si es el reemplazo de
    alguna de ellas, un pedazo contiguo de ese reemplazo (pdfjs relee
    partido el texto de una caja angosta), o una palabra planeada vecina que
    pdfjs le pegó al reemplazo. En `redact`, ninguna.
  - **El texto releído es el planeado**, comparado como bolsa de
    caracteres: pdfjs pega palabras y reordena el texto bidireccional, así
    que una comparación exacta marca de más.
  - **Lo medido**: cero falsas alarmas en las 279 páginas limpias, también
    con tapas que se pisan, y las 100 páginas malas marcadas, incluida una
    palabra del original pegada al reemplazo.
  - **Una capa hecha con OCR de la imagen ya tapada**, la vía que no entra
    en la 1.2 (§4), solo se podría verificar con la comparación con lo
    planeado: el OCR no relee el reemplazo exacto, así que la regla de las
    tapas marcaría casi todo.
- **Qué la lee**: el PDF Engine, que ya tiene pdfjs, por un puerto que
  implementa el Orchestrator, como `RenderPageProvider` (ADR-059 §5). El
  Export Engine sigue sin pdfjs.
- **Si falla**, el export falla con un error nuevo,
  `EXPORT_PDF_TEXT_VERIFY_FAILED`, sin el valor, y el documento vuelve a la
  etapa en que estaba, como el Word limpio (ADR-243 §9, punto 8).
- **Lo que no ve**: una palabra del original que además es un pedazo del
  texto del reemplazo. Pasó en 1 de 461 tapas, con un nombre inventado que
  repetía un apellido; esa palabra ya está a la vista en el reemplazo.

### 8. La garantía

- **Lo que no cambia**: nada que estaba escondido o tapado vuelve. Lo
  sostienen §3, §5 y §7, y para el texto de las páginas escaneadas, que sale
  del OCR de la tinta.
- **Lo que cambia, y es un costo aceptado al elegir `pdf-text`**: un dato
  que la detección no encontró y que está a la vista pasa a poder copiarse y
  buscarse. En el PDF imagen solo se lee en la imagen. No se recupera nada
  oculto.
- **`08_Security_Model.md`**: S-3 sigue valiendo entera para `pdf-image`, y
  se suma una promesa para `pdf-text`: el texto del PDF con texto es solo el
  que se ve en su imagen. Los tests `no-recuperability` y
  `export-has-no-text-objects` siguen para `pdf-image`, y `pdf-text` suma
  los suyos sobre las páginas trampa del spike.

### 9. Costo

Solo al exportar, y solo con `pdf-text`. La importación, el análisis, la
vista previa y el PDF imagen no cambian.

- **Página con texto nativo**: unos 65 ms más por página, medido en Node.
  Son 30 ms del segundo dibujo con sus comprobaciones, el área propia y los
  tramos,
  menos de 1 ms de la capa, y 35 ms de releer la página con el PDF Engine,
  que da las cajas por palabra que necesita §7. El dibujo y el JPEG de la
  imagen ya cuestan unos 43 ms, así que el export con texto tarda unas dos
  veces y media por página.
- **Página escaneada**: casi nada.
- **Escaneo con capa invisible**: nada más que la prueba de §3, porque sale
  sin texto (§4).

### 10. Lo que este ADR no decide

- **PDF/A**: va en su ADR, con veraPDF. La fuente de §6 debería servir para
  PDF/A-2u, por su `ToUnicode`; no se verificó.
- **Cómo se llaman las dos salidas `.pdf` en el diálogo de exportar**: va en
  el ADR de la interfaz.
- **Que los detectores lean un escaneo con capa invisible desde esa capa.**
  Pasa desde la 1.0, también en el PDF imagen: con una capa falsa o mala, la
  app detecta sobre la capa y no sobre lo que se ve. Se anota aparte. La
  tercera ronda le puso números (§4): con una capa falsa la app encuentra el
  3,8 % de los datos de la imagen.

## Consecuencias

Cambian, después de que el mantenedor acepte:

- `Contracts.md`: el código `EXPORT_PDF_TEXT_VERIFY_FAILED`; lo que el
  Render Engine devuelve de la prueba de §3 en el render del export; y el
  puerto de §7.
- `Render_Engine.md`: el segundo dibujo y la prueba de §3 en el render del
  export.
- `Export_Engine.md`: el camino de `output: "pdf-text"`, la capa de §6 y la
  verificación de §7. Se retira `pdf-text` de la regla de transición de
  ADR-238 §6.
- `PDF_Engine.md`: la relectura del PDF exportado para §7.
- `Orchestrator.md`: el puerto de §7.
- `08_Security_Model.md` y ADR-004, ADR-009 y ADR-059 §4: la excepción de
  `pdf-text`.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Las palabras de la página tal cual | Fuga 14 de 15 palabras escondidas, incluido el texto debajo de una caja negra (§3 del Contexto) |
| El OCR de la imagen tapada para todas las páginas | No fuga, pero acierta el 82 % de las palabras, suma de 1,2 a 1,9 s por página, y su verificación es más débil (§7) |
| El OCR de la imagen tapada en los escaneos con capa invisible | El mantenedor prefirió que esas páginas salgan sin texto en la 1.2, hasta demostrar que una vía con OCR es segura del todo (§4) |
| Descartar toda palabra cuya caja se pisa con otra | Pierde el 1,5 % de las palabras, y también la palabra visible de abajo; el área propia cierra las mismas trampas perdiendo el 0,17 % (§3) |
| Tramos de 2 a 4 caracteres dentro de la palabra | Pierden menos palabras, pero un tramo que mezcla letras visibles y escondidas tiene tinta y pasa: con 3, fugaban 12 de 72 trampas (§3) |
| Aceptar la capa invisible de un escaneo si hay tinta debajo | Deja pasar una capa falsa: el nombre tachado con una caja negra sobre el escaneo seguiría en la capa |
| Una regla más floja para las tapas (más del 10 % del área, o el centro adentro) | Deja en la capa palabras con letras tapadas: con «centro adentro», la palabra entera en 89 de 186 tapas de media palabra |
| Reemplazar el texto escondido por `[####]` de su largo | Avisa que había algo escondido y cuánto medía, y suma un texto que la imagen no muestra |
| La Helvetica estándar | No codifica el 1,7 % de las palabras y se relee peor (§6) |
| Dibujar el texto encima de la imagen, visible | La imagen ya lo muestra; el texto visible duplicaría lo que se ve y cambiaría el aspecto |
