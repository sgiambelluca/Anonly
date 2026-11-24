<!-- CONTEXT: scope=motor-convert | dependencias=core/Contracts.md,adr/ADR-238-El-Formato-De-Origen-Se-Reconoce-Por-El-Contenido-Y-La-Salida-Se-Elige-Al-Exportar.md,adr/ADR-239-Una-Imagen-Suelta-Entra-Como-Un-PDF-Armado-Por-Un-Motor-Nuevo.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,adr/ADR-196-Las-Licencias-Del-Software-De-Terceros-Viajan-Con-El-Instalador.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,roadmap/formatos/Spike_Imagenes_2026-11-23.md,adr/ADR-240-Word-Excel-Y-PowerPoint-Entran-Por-Un-LibreOffice-Compilado-Por-Nosotros.md,adr/ADR-242-Un-Office-Con-Contrasena-Se-Descifra-Antes-De-Convertir.md,adr/ADR-243-El-Word-Se-Limpia-Al-Entrar-Y-El-Word-Limpio-Sale-De-Ese-Paquete.md,core/OOXML.md | audiencia=IA-implementador | fase=1.2 -->

# Convert Engine — Spec

> Convierte un archivo que no es PDF en un PDF intermedio, para que el resto
> del pipeline lo lea como cualquier PDF. Desde la 1.2 convierte imágenes
> sueltas (ADR-239: PNG, JPEG, WebP, GIF, BMP, TIFF y AVIF) y Word, Excel y
> PowerPoint, con un LibreOffice compilado por nosotros (ADR-240). Descifra un
> Office con contraseña antes de convertir (ADR-242). Con un Word, además
> arma el paquete limpio y alinea su texto con el de las páginas (ADR-243),
> con el paquete puro `@anonly/ooxml` (`core/OOXML.md`).

**Paquete**: `@anonly/convert-engine`
**Ubicación**: `packages/anonymization-core/convert-engine/`
**`EngineId`**: `Convert` (`"convert"`)

---

## 1. Objetivo

- **Una imagen**: recibir sus bytes con el `sourceFormat` ya reconocido
  (ADR-238 §2) y devolver un PDF con una página por imagen, o por página de
  un TIFF. Cada página es una sola imagen con sus píxeles nativos que cubre
  la página entera, así que el PDF Engine la lee como un escaneo y el OCR no
  sube la resolución por encima de la del archivo (ADR-163).
- **Un Office**: recibir un `.docx`, `.xlsx` o `.pptx` y devolver el PDF que
  dibuja LibreOffice, limpio de lo que va por fuera de la página
  (ADR-240 §3). Con un Word, convertir el paquete limpio, no el original
  (ADR-243 §1), y devolverlo para que el Orchestrator lo retenga.
- **Un Office cifrado**: devolver el paquete en claro, o decir que falta la
  contraseña o que no es la correcta (ADR-242).
- **Un Word ya leído por el PDF Engine**: alinear su texto con el de las
  páginas, armar y convertir las páginas del texto que no se ve, y devolver
  la alineación que usa el Word limpio al exportar (ADR-243 §3, §4 y §9).

---

## 2. Responsabilidades

- Leer la cabecera de cada imagen o página **antes de decodificar**, y
  rechazar lo que pase el tope (§9).
- Decodificar con lo que trae Chromium (`createImageBitmap`) o con `utif2`
  para TIFF.
- Aplicar la orientación: la EXIF la aplica Chromium; la del TIFF, el motor.
- Calcular el tamaño de cada página desde la resolución declarada.
- Armar el PDF intermedio con `pdf-lib`: un JPEG sin rotar va tal cual, y
  todo lo demás va sin pérdida.
- Emitir `CONVERSION_PAGE_FINISHED` por página.
- Correr en un Worker propio. El Orchestrator lo termina al terminar la
  conversión.
- **Office** (§6.4 a §6.7):
  - descifrar Agile y Standard con código propio y WebCrypto, sin cargar el
    conversor (ADR-242);
  - con un Word, armar el paquete limpio con `@anonly/ooxml` antes de
    convertir (ADR-243 §1);
  - cargar LibreOffice solo cuando llega un `convert-office` o un
    `align-docx` que lo necesita, en un Worker clásico anidado (§6.4);
  - preprocesar por la API de LibreOffice, exportar con los `FilterData` de
    ADR-240 §3 y limpiar el PDF intermedio con `pdf-lib`;
  - con un Word, alinear, armar el documento chico del texto que no se ve,
    convertirlo con el mismo LibreOffice y sumarlo al PDF intermedio
    (ADR-243 §4 y §9).

---

## 3. Fuera de alcance

- Reconocer el formato: lo hace el Orchestrator (ADR-238 §2). Este motor
  confía en el `sourceFormat` que recibe, pero igual falla limpio si la
  cabecera no coincide (§11).
- Parsear el PDF que arma, hacer OCR o detectar entidades. Las palabras y
  las imágenes de cada página de un Word las lee el PDF Engine, y le llegan
  por el Orchestrator (ADR-243 §7 y §9).
- Anonimizar nada: el PDF intermedio nunca sale de la app; el export se
  rearma desde los renders (ADR-009). El Word limpio lo escribe el Export
  Engine (ADR-243 §5).
- Decidir si un Word es demasiado grande para el Word limpio: lo decide el
  Orchestrator con `docxMaxChars` (§6.7).
- Retener nada entre trabajos: lo que hace falta de un trabajo a otro viaja
  en la entrada.
- `.doc`, `.xls`, `.ppt`, OpenDocument, las variantes con macros y las
  plantillas: no llegan (ADR-238).
- HEIC: fuera de la 1.2 (ADR-238).
- Persistir algo (FS, localStorage, red).

---

## 4. Dependencias permitidas

- `@anonly/shared`: tipos, contratos y errores.
- `pdf-lib`, en la **misma versión exacta** que `export-engine`. Si un ADR
  posterior pasa al fork `@cantoo/pdf-lib`, cambian los dos motores juntos
  (ADR-239 §5).
- `utif2` **4.1.0**, versión exacta (ADR-239 §7), con su dependencia
  `pako` 1.x. Entra al aviso de licencias de terceros (ADR-196).
- Las APIs del Worker: `createImageBitmap`, `OffscreenCanvas`,
  `ImageDecoder` (solo para contar cuadros, si hace falta), `crypto.subtle`
  (ADR-242 §1) y `Worker` para el conversor anidado (§6.4).
- `@anonly/ooxml` (`core/OOXML.md`): la limpieza, la lectura, la alineación,
  el documento chico y el formato de la alineación. Es un paquete puro, no un
  motor (ADR-243 §2).
- **LibreOffice 26.8.3.1 compilado por nosotros** (ADR-240 §1): `soffice.js`,
  `soffice.wasm` y el `soffice.data` recortado con su `.metadata`. No es un
  paquete npm: entra por `assets.lock.json` (ADR-240 §6, ADR-018) y se sirve
  desde `ConvertConfig.officeAssetsBase`, same-origin. Que lo baje la propia
  librería es lo mismo que con los modelos de Tesseract: assets first-party,
  sin datos del usuario (P-7). Su MPL 2.0 y las licencias que trae adentro
  entran al aviso de licencias (ADR-196).
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `SourceFormat`,
  `ConvertConfig`, `ConversionPageFinished`, `OfficePasswordRequired`,
  `UnsupportedFormatError`, `Word`, `DrawnImage` y los códigos de §11.

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `apps/react-client`.
- Cualquier otro motor.
- `pdfjs-dist`, `tesseract.js`, `onnxruntime-web`, `@huggingface/transformers`.
- `libheif-js` o cualquier decodificador HEVC (ADR-238: HEIC queda afuera).
- Node builtins (`fs`, `http`…), red de cualquier tipo.
- Crear un `window` global en el Worker: la conversión CMYK de `utif2` que
  lo necesita no se usa (§6.3).
- **Pasarle la contraseña a LibreOffice**, o retenerla después de
  `decryptOffice` (ADR-242 §1 y §3).
- Un AES o un SHA propios: los hash y el AES son de `crypto.subtle`
  (ADR-242 §1).
- Cualquier paquete npm de ZIP, XML u Office: el ZIP y el XML son de
  `@anonly/ooxml` (ADR-243 §2).

---

## 6. Interfaces públicas

```ts
export interface ConvertImageInput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;   // los bytes de la imagen; se transfiere
  readonly sourceFormat: "png" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" | "avif";
}

export interface ConvertOutput {
  readonly pdf: ArrayBuffer;      // el PDF intermedio
  readonly pageCount: number;     // === páginas del PDF
}

// ADR-242 §1
export interface DecryptOfficeInput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;   // el contenedor OLE cifrado; se transfiere
  readonly password?: string;     // ausente en el primer intento
}

export interface DecryptOfficeOutput {
  readonly package: ArrayBuffer;  // el paquete OOXML en claro
}

// ADR-240 §2
export interface ConvertOfficeInput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;   // el paquete OOXML (en claro); se transfiere
  readonly sourceFormat: "docx" | "xlsx" | "pptx";
}

export interface ConvertOfficeOutput extends ConvertOutput {
  // Solo con sourceFormat "docx" (ADR-243 §1): el paquete limpio, que es lo
  // que convirtió LibreOffice, y el largo de su texto en caracteres, que el
  // Orchestrator compara con docxMaxChars.
  readonly cleanPackage?: ArrayBuffer;
  readonly docxTextLength?: number;
}

// ADR-243 §7 y §9
export interface AlignDocxInput {
  readonly documentId: string;
  readonly cleanPackage: ArrayBuffer;       // una copia del retenido; se transfiere
  readonly intermediatePdf: ArrayBuffer;    // una copia del retenido; se transfiere
  readonly pages: ReadonlyArray<ReadonlyArray<Word>>; // las palabras de cada página del documento, en orden
  readonly drawnImages: ReadonlyArray<DrawnImage>;
}

export interface AlignDocxOutput {
  readonly alignment: ArrayBuffer;          // formato de core/OOXML.md §6.5
  readonly extraPageCount: number;          // 0 si no hay texto que LibreOffice no dibuja
  readonly extraPdf?: ArrayBuffer;          // solo las páginas extra; presente si extraPageCount > 0
  readonly mergedPdf?: ArrayBuffer;         // el intermedio con las extra al final; presente si extraPageCount > 0
}

export class ConvertEngine implements IEngine {
  readonly id = EngineId.Convert;
  init(ctx: EngineContext): Promise<void>;
  convertImage(input: ConvertImageInput, ctx: EngineContext): Promise<ConvertOutput>;
  decryptOffice(input: DecryptOfficeInput, ctx: EngineContext): Promise<DecryptOfficeOutput>;
  convertOffice(input: ConvertOfficeInput, ctx: EngineContext): Promise<ConvertOfficeOutput>;
  alignDocx(input: AlignDocxInput, ctx: EngineContext): Promise<AlignDocxOutput>;
  dispose(): Promise<void>;       // termina también el conversor anidado (§6.4)
}

// Patrón de ADR-055: el worker corre el motor completo y el façade decodifica
// su resultado host-side. Cada una lanza InvalidInputError si `value` no
// tiene la forma de su salida, como decodePdfEngineOutput.
export function decodeConvertOutput(value: unknown): ConvertOutput;
export function decodeDecryptOfficeOutput(value: unknown): DecryptOfficeOutput;
export function decodeConvertOfficeOutput(value: unknown): ConvertOfficeOutput;
export function decodeAlignDocxOutput(value: unknown): AlignDocxOutput;
```

Cada método corre en un trabajo propio del pool `convert`: `convert-image`,
`decrypt-office`, `convert-office` y `align-docx` (`Contracts.md` §5).

### 6.1 Lectores de cabecera

Funciones puras del paquete, sin decodificar píxeles. Cada una devuelve
`{ width, height, dpiX?, dpiY?, orientation? }` por imagen, o `null` si la
cabecera no es válida:

| Formato | Qué lee |
|---|---|
| PNG | `IHDR`; `pHYs` (unidad metro) para la resolución |
| JPEG | el primer `SOFn` (y si es aritmético: `SOF9` a `SOF15` sin `SOF12`); JFIF y EXIF para la resolución; la orientación EXIF (etiqueta 274) |
| GIF | la pantalla lógica |
| BMP | el encabezado DIB; píxeles por metro para la resolución |
| WebP | `VP8`, `VP8L` o `VP8X` |
| AVIF | la caja `ispe` de la imagen primaria |
| TIFF | por cada IFD de la cadena principal: 256, 257, 282, 283, 296 y 274 |

En TIFF, las subimágenes (`SubIFDs`) y las miniaturas no son páginas.

### 6.2 Decodificación nativa

La frontera con el navegador (`createImageBitmap`, `OffscreenCanvas`) vive en
un solo módulo, `decode-native.ts`, que los tests de Node mockean, como
`pdf-engine` mockea `pdfjs-dist`. Devuelve píxeles RGBA aplanados sobre
blanco. De un GIF o un WebP animado, Chromium entrega el primer cuadro.

### 6.3 TIFF

- `UTIF.decode` y `UTIF.decodeImage` por página.
- RGB, gris y 1 bit se pasan a RGBA con `UTIF.toRGBA8`.
- **CMYK lo convierte el motor**, con la fórmula simple sin ICC
  (`R = 255 × (1 − C) × (1 − K)` y análogos). No llama a `toRGBA8`, que en
  un Worker busca `window`.
- La orientación (etiqueta 274) la aplica el motor sobre los píxeles.

### 6.4 El conversor anidado

`soffice.js` es un script clásico de Emscripten, no un módulo (ADR-240 §2).
El motor lo corre en un **Worker clásico anidado**, `office-host`, que crea
dentro del Worker del pool `convert`:

- `office-host.js` es nuestro: se compila desde este paquete como un script
  clásico y se sirve junto a los archivos del conversor, en
  `officeAssetsBase`. Hace `importScripts` de `soffice.js` y fija
  `Module.mainScriptUrlOrBlob` para los hilos de LibreOffice, que son workers
  `blob:` con `SharedArrayBuffer`, como en el spike (`Spike_LOWA` §2). La CSP
  no cambia (ADR-240 §2).
- **El motor le habla por mensajes**: le pasa los bytes al sistema de
  archivos en memoria de Emscripten y recibe el PDF. Todo lo que toca la API
  de LibreOffice (abrir, preprocesar, exportar) corre adentro del host.
- **Se crea con el primer trabajo que lo necesita** (`convert-office`, o un
  `align-docx` con páginas extra) y no lo carga una imagen ni un
  `decrypt-office` (ADR-240 §2, ADR-242 §1).
- **Se cierra solo** en estos casos, con `terminate()`:
  - al terminar `convertOffice` de un Word con `docxTextLength ≥
    docxCloseWorkerChars`, para liberar su memoria antes de alinear
    (ADR-243 §3);
  - al terminar `convertOffice` de un Excel o un PowerPoint, que no siguen
    con `align-docx`;
  - en `dispose()`, y si el host se cae (§11).

  Terminar el Worker del pool termina también el anidado.

### 6.5 `decryptOffice`

ADR-242 §1 y §2. Lector mínimo de OLE, `EncryptionInfo`, derivación de la
clave, verificador y `EncryptedPackage`, con `crypto.subtle`:

- **Agile** (SHA-1, SHA-256, SHA-384 y SHA-512): AES-CBC por segmentos de
  4096 B, con el HMAC del paquete verificado.
- **Standard**: AES-ECB, emulado sobre AES-CBC.
- **Sin contraseña**, o con un tipo que entra: `OfficePasswordRequiredError`
  con `incorrect: false`, y `OFFICE_PASSWORD_REQUIRED` en
  `EventChannel.Convert`.
- **Con una contraseña que el verificador rechaza**: lo mismo con
  `incorrect: true`. No se intenta descifrar.
- **Extensible, RC4 de CryptoAPI o IRM**: `UnsupportedFormatError` con
  `reason: "office-encryption"`, antes de pedir la contraseña.
- **OLE ilegible, `EncryptionInfo` corrupto o HMAC que no coincide**:
  `OFFICE_CONVERT_FAILED` con `phase: "decrypt"`.

La contraseña vive solo en la pila de la llamada y no se escribe en ningún
log, error ni evento.

### 6.6 `convertOffice`

ADR-240 §3 a §5 y ADR-243 §1. En orden:

1. **Con un Word, el paquete limpio**: `cleanDocx` de `@anonly/ooxml`
   (`core/OOXML.md` §6.2). Lo que convierte LibreOffice es ese paquete. Si
   falla, `OFFICE_CONVERT_FAILED` con `phase: "clean"`.
2. **Abrir** el paquete oculto desde el sistema de archivos en memoria
   (`loadComponentFromURL` con `Hidden`). Si devuelve `null`,
   `phase: "load"`.
3. **Preprocesar** por la API (ADR-240 §5):
   - primero `RecordChanges` en `false` y `RedlineProtectionKey` vacío;
   - **Word**: el paquete limpio ya no tiene cambios ni comentarios. El paso
     queda como control: si `getRedlines().hasElements()` da `true`, falla
     cerrado con `phase: "preprocess"`;
   - **Excel**: `removeByIndex` de los comentarios, con tope de vueltas; en
     una hoja protegida, vaciar el texto de la nota, ocultarla y poner
     `PrintAnnotations` en `false`;
   - **PowerPoint**: `removeAnnotation`.
4. **Exportar** con `writer_pdf_Export`, `calc_pdf_Export` o
   `impress_pdf_Export`, con `UseTaggedPDF=false`, `ExportNotes=false`,
   `ExportNotesPages=false` y `ExportNotesInMargin=false`. Si falla,
   `phase: "export"`.
5. **Limpiar el PDF intermedio** con `pdf-lib` (ADR-240 §3, paso 4): sin
   `Info` ni XMP, sin `Annots` en ninguna página, sin `Outlines`, `Names`,
   `AcroForm`, `StructTreeRoot`, `MarkInfo` ni `OpenAction`, y con un barrido
   de los objetos huérfanos antes de guardar.
6. **Devolver** el PDF y `pageCount`. Con un Word, también `cleanPackage` y
   `docxTextLength`, y el conversor queda vivo o se cierra según §6.4.

El plazo es `timeouts["convert-office"]`, por documento. Al vencer,
`CONVERT_TIMEOUT` con `details: {}`.

### 6.7 `alignDocx`

ADR-243 §3, §4 y §9. Corre después de que el PDF Engine leyó las páginas
del PDF intermedio:

1. **Ubicar las imágenes**: decodifica cada parte de `word/media` del
   paquete limpio con `decode-native.ts` (§6.2) a una miniatura de 16×16, y
   la compara con las `drawnImages` con `matchImages` de `@anonly/ooxml`,
   probando los 8 giros y espejos (`core/OOXML.md` §6.4).
2. **Alinear** el texto del paquete limpio con las palabras de `pages`, con
   `alignDocx` de `@anonly/ooxml` (`core/OOXML.md` §6.3): el cuerpo con
   patience diff y lo demás por unidad.
3. **Las páginas del texto que no se ve**: si quedaron pedazos sin par, arma
   el documento chico con `buildUnseenDocx` y lo convierte con el conversor
   anidado, que abre si estaba cerrado (§6.4). Limpia ese PDF como en §6.6,
   paso 5, y lo suma al final de una copia del intermedio con `pdf-lib`.
4. **Devolver** la alineación codificada (`encodeAlignment`), con las
   imágenes ubicadas y los pedazos con su lugar en el XML adentro, y los dos
   PDF si hay páginas extra. Las palabras de las páginas extra todavía no
   existen: las lee después el PDF Engine, y el Export Engine las ubica
   contra el texto de los pedazos (`core/OOXML.md` §6.6).

Si algo de esto falla, `OFFICE_CONVERT_FAILED` con `phase: "align"`, o
`CONVERT_TIMEOUT` al vencer `timeouts["align-docx"]`. El Orchestrator no lo
propaga: el documento sigue sin el Word limpio (ADR-243 §9, punto 5).

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Throttle |
|---|---|---|---|---|
| `CONVERSION_PAGE_FINISHED` (`EventChannel.Convert`) | al terminar de armar cada página de una imagen | `ConversionPageFinished` | async | no: una por página |
| `OFFICE_PASSWORD_REQUIRED` (`EventChannel.Convert`) | `decryptOffice` sin contraseña, o con una que el verificador rechaza | `OfficePasswordRequired` | async | no |

Los emite por su `ctx.bus`, como el PDF Engine emite `PAGE_PARSED` y
`PDF_PASSWORD_REQUIRED`. El Orchestrator traduce `CONVERSION_PAGE_FINISHED` a
`PIPELINE_PROGRESS` (`core/Orchestrator.md` §2). Un Office no emite progreso
por página: LibreOffice convierte el documento entero de una vez
(ADR-240 §7).

---

## 8. Eventos que consume

Ninguno. El Orchestrator lo invoca directamente, como al PDF Engine
(ADR-014).

---

## 9. Entradas

- `buffer.byteLength > 0`; si no, `InvalidInputError`.
- `sourceFormat` es uno de los siete de §6; si no, `InvalidInputError`.
- **El tope, antes de decodificar nada** (ADR-239 §3):
  - `width × height ≤ ctx.config.convert.maxImagePixels` (default
    50 000 000) y los dos lados `≤ ctx.config.convert.maxImageSide`
    (default 16 384), por imagen o por página;
  - en TIFF, la cantidad de páginas `≤ ctx.config.pdf.maxPageCount`, y se
    revisan **todas** las páginas antes de decodificar la primera;
  - si se pasa, `IMAGE_TOO_LARGE` (§11).
- **Office**:
  - `convertOffice`: `sourceFormat` en `"docx" | "xlsx" | "pptx"`; si no,
    `InvalidInputError`;
  - `decryptOffice`: `password`, si está, no vacío;
  - `alignDocx`: `cleanPackage` e `intermediatePdf` no vacíos, y
    `pages.length` igual a las páginas del intermedio; si no,
    `InvalidInputError`.

---

## 10. Salidas

- **Una página por imagen**, o por página de un TIFF, en orden.
- **Tamaño de página** (ADR-239 §5):
  - con una resolución declarada entre 100 y 1200 dpi en los dos ejes,
    ancho = `widthPx × 72 / dpiX` y alto = `heightPx × 72 / dpiY`, en
    puntos;
  - si la orientación rota 90° o 270°, se intercambian primero las dos
    resoluciones y las dos dimensiones;
  - sin una resolución válida, el lado largo mide **841,89 pt** y el otro
    conserva la proporción.
- **Contenido**: un único `XObject` de imagen por página, con sus píxeles
  nativos, dibujado con la matriz `[W 0 0 H 0 0]` que cubre la página
  entera, y ninguna otra operación de pintura. Es la condición de ADR-163.
- **Cómo se guarda la imagen**:
  - un JPEG con orientación 1 o sin orientación, que `createImageBitmap`
    decodificó, va **tal cual** con `embedJpg`;
  - todo lo demás va **sin pérdida**: los píxeles comprimidos con Flate,
    en `DeviceGray` si todos los píxeles son grises (R = G = B) y en
    `DeviceRGB` si no.
- **Metadatos del PDF intermedio**: `pdf-lib` por defecto. No se copian
  los metadatos de la imagen; el EXIF de un JPEG que va tal cual queda
  adentro de sus bytes, y no sale de la memoria (ADR-239, Consecuencias).
- `pageCount === ` páginas del PDF, `> 0`.

**Office** (ADR-240 §3):

- **El paginado es el de LibreOffice**: un Word con sus páginas, secciones y
  tamaños; un Excel como páginas impresas, con su área de impresión, su
  escalado y sus saltos, sin las hojas, filas y columnas ocultas; un
  PowerPoint con una página por diapositiva visible, sin las notas del orador.
- **El PDF intermedio no lleva nada por fuera de la página** (§6.6, paso 5):
  en sus bytes no quedan el título, el autor, ninguna dirección de enlace ni
  la palabra «LibreOffice».
- **`cleanPackage`** solo con un Word, y es el paquete que convirtió
  LibreOffice. El original no sale del motor.
- **`mergedPdf`** tiene las páginas del intermedio, idénticas, y después las
  extra, en el orden de `extraPdf`.

---

## 11. Errores posibles

Todos con `engineId: "convert"`, salvo `UnsupportedFormatError`, que es de
`"core"`. Terminan en `PIPELINE_FAILED` (el Orchestrator lo propaga, como
`PDF_INVALID`), con dos excepciones: `OFFICE_PASSWORD_REQUIRED` deja el
documento esperando la contraseña, y un error de `align-docx` deja el
documento sin el Word limpio (`core/Orchestrator.md` §2).

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `IMAGE_TOO_LARGE` | `ImageTooLargeError` | pasa el tope de §9. `details`: `{ reason: "pixels" \| "side" \| "pages", width?, height?, pageIndex?, pageCount? }` | no | la UI muestra el aviso de ADR-239 §6 |
| `IMAGE_DECODE_FAILED` | `ImageDecodeFailedError` | la cabecera no es válida o no coincide con `sourceFormat`; `createImageBitmap` o `utif2` fallan; un JPEG aritmético; un TIFF que `utif2` no lee. `details`: `{ pageIndex }` | no | idem |
| `CONVERT_TIMEOUT` | `ConvertTimeoutError` | una página tarda más que `workerPool.timeouts["convert-image"]` (default 30 000 ms), con `details: { pageIndex }`; o un documento pasa `timeouts["convert-office"]`, `["decrypt-office"]` o `["align-docx"]`, con `details: {}` | no | idem; en `align-docx`, el Orchestrator no lo propaga (§6.7) |
| `OFFICE_CONVERT_FAILED` | `OfficeConvertFailedError` | ADR-240 §8, ADR-242 §4 y ADR-243 §7. `details: { phase }`: `"decrypt"` (OLE, `EncryptionInfo` o HMAC), `"clean"` (§6.6, paso 1), `"load"` (`loadComponentFromURL` da `null`), `"preprocess"` (quedan cambios), `"export"` (el filtro falla), `"align"` (§6.7). Un `RuntimeError` del WebAssembly, o el host anidado que se cae, cuenta en la fase en la que estaba | no | la UI dice que el archivo no se pudo abrir, sin decir que está dañado; en `"align"`, el Orchestrator no lo propaga |
| `OFFICE_PASSWORD_REQUIRED` | `OfficePasswordRequiredError` | §6.5. `details: { incorrect }` | no lo reintenta el pool (ADR-049 §4) | el Orchestrator espera `retryWithPassword` |
| `FORMAT_UNSUPPORTED` | `UnsupportedFormatError` (de `@anonly/shared`, `engineId: "core"`) | §6.5: cifrado Extensible, RC4 o IRM. `details: { reason: "office-encryption" }` | no | la UI dice que se guarde el archivo sin contraseña desde Office |
| `INVALID_INPUT` | `InvalidInputError` | §9, o un decoder de §6 recibe algo que no tiene la forma de su salida | no | bug del caller o del transporte |
| `CANCELLED` | `CancelledError` | cancelación | — | flujo normal |

---

## 12. Consideraciones de rendimiento

Medido en el spike (`roadmap/formatos/Spike_Imagenes_2026-11-23.md`, banco
Windows, sintéticos):

- Cabecera: 5 a 15 ms, incluso con un TIFF de 10 000 páginas.
- JPEG tal cual: unos 20 ms por página.
- Sin pérdida: entre 1,2 y 2,9 s por página A4 o foto de 12 MP.
- TIFF G4, el de escáner: 0,55 s de decodificación por página A4.
- Pico de la conversión: entre 20 y 36 bytes por píxel. Con 50 MP, entre
  1,0 y 1,8 GB, que vuelven cuando el Orchestrator termina el pool, antes
  del OCR.

Una sola página decodificada vive a la vez: se decodifica, se comprime, se
agrega al PDF y se sueltan sus píxeles antes de la siguiente.

**Office**, medido en los spikes (`Plan_1.2.md` §8.3 a §8.9, banco Windows,
sintéticos y documentos de prueba de LibreOffice, sin documentos reales):

- Cargar el conversor recortado: 2,9 s. El Worker de LibreOffice ocupa unos
  600 MB, que vuelven al terminarlo.
- Descifrar: 0,37 s para derivar la clave de Office 2013; 0,8 s y 1,3 veces
  el archivo en memoria para 250 MB en Agile; Standard suma hasta 2,3 veces.
- Limpiar el Word: 3,4 ms de mediana y 43 ms en el p99.
- Esperar la aceptación de 6.000 cambios: 0,93 s. Limpiar el PDF intermedio:
  de 1 a 16 ms hasta 10 páginas y 1,25 s con 500.
- Alinear: unos 0,7 s y 240 MB por millón de caracteres, lineal. El
  alineador de la implementación tiene que ocupar menos que el del prototipo
  (ADR-243 §3).
- Convertir las páginas extra con el conversor vivo: 35 ms de mediana;
  sumarlas al PDF, 9 ms. Con el conversor cerrado, volver a abrirlo suma
  unos 2,7 s.
- El pico con el conversor vivo mientras el PDF Engine lee las páginas, y
  los dos números del Word limpio (`docxCloseWorkerChars` y
  `docxMaxChars`), los fija la medición de memoria con documentos
  convertidos (`Plan_1.2.md` §8).

---

## 13. Casos límite

1. **PNG, JPEG, WebP, GIF, BMP y AVIF**: una página cada uno.
2. **TIFF de varias páginas**: una página por IFD de la cadena principal,
   en orden; las miniaturas y las subimágenes no cuentan.
3. **GIF o WebP animado**: una página, con el primer cuadro.
4. **JPEG con orientación 2 a 8**: se decodifica (Chromium aplica la
   orientación) y va sin pérdida, con las dimensiones ya rotadas.
5. **JPEG aritmético**: `createImageBitmap` falla → `IMAGE_DECODE_FAILED`.
   No se pasa tal cual aunque `embedJpg` lo acepte.
6. **Imagen con alfa**: se aplana sobre blanco.
7. **Imagen gris**: `DeviceGray`.
8. **TIFF CMYK**: conversión propia (§6.3).
9. **TIFF con orientación**: el motor la aplica.
10. **Resolución fuera de 100 a 1200 dpi, o ausente**: lado largo de
    841,89 pt.
11. **Una página pasa el tope**: `IMAGE_TOO_LARGE` sin decodificar nada.
12. **TIFF con más páginas que `pdf.maxPageCount`**: `IMAGE_TOO_LARGE` con
    `reason: "pages"`.
13. **Cabecera que no coincide con el `sourceFormat`**:
    `IMAGE_DECODE_FAILED` con `pageIndex: 0`.
14. **Cancelación a mitad de un TIFF**: aborta, descarta el PDF parcial y
    no emite más `CONVERSION_PAGE_FINISHED`.
15. **Un Word con cambios y comentarios**: el paquete limpio no los tiene, y
    LibreOffice convierte ese paquete. El PDF no muestra lo borrado ni los
    comentarios.
16. **Un paquete que llega a LibreOffice con cambios** (falla de la
    limpieza): `OFFICE_CONVERT_FAILED` con `phase: "preprocess"`, sin PDF.
17. **Un Excel con una hoja protegida y notas**: las notas se vacían, se
    ocultan y no se imprimen.
18. **Un Excel o un PowerPoint**: sin `cleanPackage`, y el conversor se
    cierra al terminar.
19. **Un archivo que LibreOffice no abre**: `phase: "load"`.
20. **El WebAssembly se cae** a mitad: `OFFICE_CONVERT_FAILED` en la fase
    en curso; el host se termina.
21. **Un Office cifrado sin contraseña**, **con la equivocada** y **con la
    correcta** (§6.5).
22. **Un cifrado que no entra**: `UnsupportedFormatError` con
    `"office-encryption"`, sin pedir la contraseña.
23. **Un Agile con el HMAC alterado**: `phase: "decrypt"`.
24. **Un Word grande** (`docxTextLength ≥ docxCloseWorkerChars`): el
    conversor se cierra al terminar `convertOffice`, y `alignDocx` lo vuelve
    a abrir solo si hay páginas extra.
25. **Un Word sin texto que LibreOffice no dibuja**: `extraPageCount: 0`,
    sin `extraPdf` ni `mergedPdf`, y sin cargar el conversor si estaba
    cerrado.
26. **Un Word con un cuadro de texto que no se dibuja**: una página extra
    con su texto y su etiqueta; `mergedPdf` termina en esa página.
27. **Un `align-docx` que vence**: `CONVERT_TIMEOUT` con `details: {}`.
28. **Una imagen de `word/media` que ninguna página dibuja**: queda sin
    ubicar en la alineación, sin error.

---

## 14. Casos de prueba

Los tests de Node mockean `decode-native.ts` (§6.2) y el conversor anidado
por su frontera de mensajes (`office-host-port.ts`, §6.4): ningún test de
Node carga LibreOffice. Los lectores de cabecera, el tamaño de página,
`utif2`, `pdf-lib`, `@anonly/ooxml` y `crypto.subtle` corren sin mock. Los
fixtures son sintéticos, generados en el test o en `tests/fixtures/`, con
datos inventados; los Word cifrados son los cuatro del árbol de LibreOffice.

| Nombre | Archivo | Tipo | Notas |
|---|---|---|---|
| `returns one page per image and per TIFF page` | `contract.test.ts` | contract | casos 1 y 2 |
| `emits CONVERSION_PAGE_FINISHED once per page in order` | `contract.test.ts` | contract | §7 |
| `each page is a single native-size image covering the page` | `contract.test.ts` | contract | §10, ADR-163: un solo `XObject`, matriz `[W 0 0 H 0 0]`, píxeles nativos |
| `decodeConvertOutput returns a valid output as is` | `contract.test.ts` | contract | §6, patrón ADR-055 |
| `decodeConvertOutput throws InvalidInputError on a malformed value` | `edge.test.ts` | edge | §11: `null`, `{}`, sin `pdf`, `pageCount` no numérico y un resultado envuelto (`{ output: <válido> }`) |
| `reads width, height, resolution and orientation from each header` | `unit.test.ts` | unit | §6.1, un caso por formato |
| `page size follows the declared resolution` | `unit.test.ts` | unit | §10: 300 dpi da una A4 desde 2480×3508 |
| `a missing or out-of-range resolution gives an A4 long side` | `unit.test.ts` | unit | §10, caso 10: 99 y 1201 dpi caen acá |
| `a 90 degree orientation swaps resolutions and dimensions` | `unit.test.ts` | unit | §10 |
| `an unrotated JPEG is embedded as is` | `unit.test.ts` | unit | §10: los bytes del JPEG aparecen en el PDF |
| `a rotated JPEG is re-encoded without loss` | `unit.test.ts` | unit | caso 4 |
| `a gray image is stored as DeviceGray` | `unit.test.ts` | unit | caso 7 |
| `alpha is flattened on white` | `unit.test.ts` | unit | caso 6 |
| `TIFF CMYK is converted without toRGBA8` | `unit.test.ts` | unit | caso 8, §6.3: no se crea `window` |
| `TIFF orientation is applied by the engine` | `unit.test.ts` | unit | caso 9 |
| `TIFF thumbnails and sub-IFDs are not pages` | `unit.test.ts` | unit | caso 2 |
| `an image over the pixel cap throws IMAGE_TOO_LARGE before decoding` | `edge.test.ts` | edge | caso 11: el mock de `decode-native` no se llama |
| `a side over the cap throws IMAGE_TOO_LARGE` | `edge.test.ts` | edge | caso 11, `reason: "side"` |
| `a TIFF page over the cap fails before decoding the first page` | `edge.test.ts` | edge | §9 |
| `a TIFF with too many pages throws IMAGE_TOO_LARGE` | `edge.test.ts` | edge | caso 12 |
| `an arithmetic JPEG throws IMAGE_DECODE_FAILED` | `edge.test.ts` | edge | caso 5 |
| `a header that does not match the source format throws IMAGE_DECODE_FAILED` | `edge.test.ts` | edge | caso 13 |
| `a page over the timeout throws CONVERT_TIMEOUT` | `edge.test.ts` | edge | §11 |
| `cancel mid-TIFF discards the partial PDF` | `edge.test.ts` | edge | caso 14 |
| `only one decoded page is alive at a time` | `edge.test.ts` | edge | §12 |
| `una foto JPEG, un PNG, un TIFF de 3 páginas y un AVIF se importan, se anonimizan y se exportan` | `tests/e2e/image-import.spec.ts` | e2e | frente 8 de `roadmap/Plan_1.2.md`; app empaquetada, decodificación real |
| `decryptOffice opens Agile and Standard with the right password` | `contract.test.ts` | contract | §6.5, caso 21: los cuatro Word cifrados del árbol de LibreOffice (ADR-242, Consecuencias) |
| `decryptOffice without a password emits OFFICE_PASSWORD_REQUIRED with incorrect false` | `contract.test.ts` | contract | §6.5, §7 |
| `a wrong password is rejected by the verifier with incorrect true` | `unit.test.ts` | unit | §6.5, caso 21: no se llama a `decrypt` de `crypto.subtle` |
| `an unsupported encryption throws office-encryption before asking for a password` | `edge.test.ts` | edge | caso 22 |
| `a tampered Agile HMAC throws OFFICE_CONVERT_FAILED in phase decrypt` | `edge.test.ts` | edge | caso 23 |
| `the password never reaches the office host, a log or an error` | `edge.test.ts` | edge | §5, §6.5: spy sobre el puerto del host, el logger y `details` |
| `decryptOffice does not load the converter` | `unit.test.ts` | unit | §6.4: el mock del host no se crea |
| `convertOffice converts the clean package, not the original` | `contract.test.ts` | contract | §6.6, paso 1, caso 15: lo que recibe el host es la salida de `cleanDocx` |
| `convertOffice returns cleanPackage and docxTextLength only for a Word` | `contract.test.ts` | contract | §6, caso 18 |
| `the intermediate PDF has no Info, XMP, Annots or catalog extras` | `unit.test.ts` | unit | §6.6, paso 5, con `pdf-lib` real: tampoco quedan como objetos huérfanos |
| `the export filter data disables tags and notes` | `unit.test.ts` | unit | §6.6, paso 4 |
| `a package with tracked changes left fails in phase preprocess` | `edge.test.ts` | edge | caso 16 |
| `a protected sheet hides its notes instead of deleting them` | `unit.test.ts` | unit | caso 17, con tope de vueltas |
| `a null load fails in phase load and a crashed host in the current phase` | `edge.test.ts` | edge | casos 19 y 20 |
| `the converter closes after a large Word, an Excel and a PowerPoint` | `unit.test.ts` | unit | §6.4, casos 18 y 24 |
| `convertOffice over its timeout throws CONVERT_TIMEOUT with empty details` | `edge.test.ts` | edge | §6.6 |
| `alignDocx returns the alignment and no extra PDF when everything is drawn` | `contract.test.ts` | contract | caso 25: el host no se abre si estaba cerrado |
| `alignDocx appends the unseen-text pages after the intermediate ones` | `contract.test.ts` | contract | §10, caso 26: `mergedPdf` = intermedio idéntico + `extraPdf` |
| `alignDocx reopens a closed converter only for extra pages` | `unit.test.ts` | unit | caso 24 |
| `drawn images are matched to word/media parts by thumbnail` | `unit.test.ts` | unit | §6.7, paso 1, con un giro y un espejo |
| `an align failure throws OFFICE_CONVERT_FAILED in phase align` | `edge.test.ts` | edge | §6.7 y caso 27 |
| `decodeDecryptOfficeOutput, decodeConvertOfficeOutput and decodeAlignDocxOutput reject malformed values` | `edge.test.ts` | edge | §6, patrón ADR-055, los mismos casos que `decodeConvertOutput` |
| `un Word, un Excel y un PowerPoint se importan, se anonimizan y se exportan en PDF` | `tests/e2e/office-import.spec.ts` | e2e | frente 8; app empaquetada, LibreOffice real, CSP real |
| `un Word cifrado pide la contraseña, rechaza la equivocada y abre con la correcta` | `tests/e2e/office-import.spec.ts` | e2e | frente 8; ADR-242 §3 |

Cobertura ≥ 85 % de líneas del paquete (R-13), con su glob en
`vitest.config.ts` en el mismo PR.

---

## 15. Checklist de implementación

- [ ] 1. Paquete `convert-engine` con `package.json`, `tsconfig` y las
  dependencias de §4 en versión exacta.
- [ ] 2. Las clases de §11 en `convert.errors.ts`.
- [ ] 3. Lectores de cabecera (§6.1).
- [ ] 4. `decode-native.ts` (§6.2) y el camino de TIFF (§6.3).
- [ ] 5. Tamaño de página y armado con `pdf-lib` (§10).
- [ ] 6. `convertImage` con el tope, el plazo por página, la cancelación y
  `CONVERSION_PAGE_FINISHED`.
- [ ] 7. `decodeConvertOutput`.
- [ ] 8. El worker del pool `convert`.
- [ ] 9. `utif2` en el aviso de licencias de terceros (ADR-196), con su
  test.
- [ ] 10. Tests de §14 y glob de cobertura.
- [ ] 11. `decryptOffice` con el lector de OLE, Agile y Standard (§6.5).
- [ ] 12. `office-host.js` como script clásico, servido en
  `officeAssetsBase`, y `office-host-port.ts` (§6.4).
- [ ] 13. `convertOffice` con la limpieza, el preproceso, los `FilterData` y
  la limpieza del PDF (§6.6).
- [ ] 14. `alignDocx` con las imágenes, la alineación y las páginas extra
  (§6.7).
- [ ] 15. Los artefactos de LibreOffice en `assets.lock.json` y la receta en
  `tools/lowa/` (ADR-240 §1 y §6), y su aviso de licencias.

---

## Referencias

- ADR-238: el formato de origen y su reconocimiento.
- ADR-239: este motor.
- ADR-163: la condición de una página que es un único ráster.
- ADR-055: el decoder del resultado del worker.
- ADR-240: el conversor de Office. ADR-242: el Office con contraseña.
  ADR-243: el Word limpio, con sus precisiones de §9.
- `core/OOXML.md`: el paquete puro que limpia, lee y alinea el Word.
- `roadmap/formatos/Spike_Imagenes_2026-11-23.md`,
  `Spike_LOWA_2026-11-23.md`, `Casos_Borde_Conversor_2026-11-24.md`,
  `Preproceso_Y_Cifrado_2026-11-24.md` y
  `Word_Limpio_Escritura_2026-11-24.md`: las mediciones.
