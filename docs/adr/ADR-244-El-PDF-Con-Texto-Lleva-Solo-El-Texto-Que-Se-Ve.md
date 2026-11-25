<!-- CONTEXT: scope=adr | dependencias=roadmap/Plan_1.2.md,roadmap/formatos/Texto_Preservado_2026-11-24.md,adr/ADR-004-Rendering.md,adr/ADR-009-Export-Strategy.md,adr/ADR-059-Leyenda-Opcional-De-Marcadores.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-238-El-Formato-De-Origen-Se-Reconoce-Por-El-Contenido-Y-La-Salida-Se-Elige-Al-Exportar.md,adr/ADR-241-La-1.2-Sigue-Con-Pdf-Lib-Y-El-Fork-Se-Reabre-Con-PDF-A.md,core/Contracts.md,core/Export_Engine.md,core/Render_Engine.md,core/Orchestrator.md,architecture/08_Security_Model.md | audiencia=humanos+IA | fase=1.2 -->

# ADR-244 — El PDF con texto lleva solo el texto que se ve

- **Estado**: Borrador del planificador, 2026-11-25. Esperan dos cosas:
  - la segunda ronda del spike, que mide la verificación al exportar y los
    escaneos que ya traen una capa invisible (§4 y §7);
  - la decisión del mantenedor sobre esos escaneos (§4).
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
| Un escaneo que ya trae una capa invisible | **pendiente** (§4) |

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
- **Cuesta** un segundo dibujo por página: unos 10 ms a 150 dpi y 30 ms en
  una página densa, medido en Node.
- **Falla cerrada.** Sacar el texto del segundo dibujo exige tocar una parte
  interna de pdfjs 4.10 (`_intentStates`), que una actualización puede
  romper. Si el filtro no saca el texto, toda palabra parecería visible. Por
  eso cada página comprueba que el segundo dibujo de verdad no tiene texto,
  y si no lo puede comprobar, el export falla. **Cómo se comprueba lo fija
  la segunda ronda del spike.** Además, un test fija la versión de pdfjs: al
  actualizarla, el test tiene que pasar de nuevo.

### 4. El escaneo que ya trae una capa invisible

Muchos escáneres y apps de celular le agregan a la foto una capa de texto
invisible. Esa capa no tiene tinta propia, así que la prueba de §3 la
descarta entera. Y no se puede confiar en ella sin leer la foto: si alguien
tachó un nombre dibujando una caja negra sobre el escaneo, la capa sigue
diciendo ese nombre.

- **Cómo se reconoce la página** (lo mide la segunda ronda): la prueba
  rechaza al menos una palabra que tiene tinta debajo, y una imagen cubre al
  menos el 80 % de la página.
- **Qué texto lleva**: lo decide el mantenedor entre dos salidas seguras.
  - **OCR al exportar**, que propone el planificador: la capa sale del OCR
    de la imagen ya tapada. Solo puede leer lo que se ve después de las
    tapas. Cuesta de 1 a 2 s más por cada una de esas páginas, y el OCR se
    equivoca en algunas palabras.
  - **Sin texto**: esas páginas salen solo como imagen, como en el PDF
    imagen.

### 5. Las tapas

- **Una palabra que toca una tapa no entra**, aunque sea un poco: cualquier
  área de intersección mayor que cero con cualquier fragmento
  (`fragments ?? [bbox]`). En el spike no quedó ninguna palabra tapada en la
  capa, y se perdió el 0,12 % de las vecinas.
- **En el lugar de cada tapa va su `replacementValue`**, una sola vez, en el
  fragmento más ancho, como lo dibuja la imagen (ADR-074 §4). En el orden de
  lectura va donde estaba la primera palabra tapada.
- **`redact` no lleva texto**: en la imagen hay una caja negra sin nada.
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
  imagen en 558 de 558 páginas, y el archivo crece un 3 %.
- **Se descartó la Helvetica estándar**: no codifica el 1,7 % de las
  palabras del corpus, todas en escrituras no latinas, y `pdf-lib` corta con
  un error. Se relee peor: 0,81.

### 7. La verificación al exportar

Antes de entregar el archivo, la app relee la capa del PDF exportado y no
lo entrega si algo no da. Es independiente de quien la escribió.

- **Qué verifica**:
  - ninguna palabra releída cae sobre una tapa, salvo el texto del reemplazo
    de esa tapa;
  - el texto releído es el que se planeó.
- **Qué la lee**: el PDF Engine, que ya tiene pdfjs, por un puerto que
  implementa el Orchestrator, como `RenderPageProvider` (ADR-059 §5). El
  Export Engine sigue sin pdfjs.
- **Si falla**, el export falla con un error nuevo,
  `EXPORT_PDF_TEXT_VERIFY_FAILED`, sin el valor, y el documento vuelve a la
  etapa en que estaba, como el Word limpio (ADR-243 §9, punto 8).
- **Lo que falta**: en la primera ronda marcó de más en 23 de 279 páginas
  limpias. Las causas fueron tapas que se pisan y el texto de un reemplazo
  en una caja angosta, que pdfjs relee partido. **La regla exacta la fija la
  segunda ronda del spike**, con cero falsos positivos como condición. Para
  las páginas de §4 con OCR, la verificación es otra, y también la fija la
  ronda.

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

- **Página con texto nativo**: unos 12 ms más por página, con el segundo
  dibujo, la capa y la verificación, medido en Node.
- **Página escaneada**: casi nada.
- **Escaneo con capa invisible, con OCR al exportar**: de 1 a 2 s más por
  página.

### 10. Lo que este ADR no decide

- **PDF/A**: va en su ADR, con veraPDF. La fuente de §6 debería servir para
  PDF/A-2u, por su `ToUnicode`; no se verificó.
- **Cómo se llaman las dos salidas `.pdf` en el diálogo de exportar**: va en
  el ADR de la interfaz.
- **Que los detectores lean un escaneo con capa invisible desde esa capa.**
  Pasa desde la 1.0, también en el PDF imagen: con una capa falsa o mala, la
  app detecta sobre la capa y no sobre lo que se ve. Se anota aparte.

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
- `Orchestrator.md`: el puerto de §7 y, según §4, el OCR al exportar.
- `08_Security_Model.md` y ADR-004, ADR-009 y ADR-059 §4: la excepción de
  `pdf-text`.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Las palabras de la página tal cual | Fuga 14 de 15 palabras escondidas, incluido el texto debajo de una caja negra (§3 del Contexto) |
| El OCR de la imagen tapada para todas las páginas | No fuga, pero acierta el 82 % de las palabras y suma de 1,2 a 1,9 s por página. Se usa solo donde no hay otra fuente segura (§4) |
| Aceptar la capa invisible de un escaneo si hay tinta debajo | Deja pasar una capa falsa: el nombre tachado con una caja negra sobre el escaneo seguiría en la capa |
| Una regla más floja para las tapas (más del 10 % del área, o el centro adentro) | Deja en la capa palabras con letras tapadas: con «centro adentro», la palabra entera en 89 de 186 tapas de media palabra |
| Reemplazar el texto escondido por `[####]` de su largo | Avisa que había algo escondido y cuánto medía, y suma un texto que la imagen no muestra |
| La Helvetica estándar | No codifica el 1,7 % de las palabras y se relee peor (§6) |
| Dibujar el texto encima de la imagen, visible | La imagen ya lo muestra; el texto visible duplicaría lo que se ve y cambiaría el aspecto |
