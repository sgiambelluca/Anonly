<!-- CONTEXT: scope=adr | dependencias=roadmap/Plan_1.2.md,core/Contracts.md,architecture/03_Data_Model.md,core/PDF_Engine.md,core/Orchestrator.md,core/Export_Engine.md,adr/ADR-009-Export-Strategy.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md | audiencia=humanos+IA | fase=1.2 -->

# ADR-238 — El formato de origen se reconoce por el contenido y la salida se elige al exportar

- **Estado**: Aceptado por el mantenedor el 2026-11-23. Pasado a
  `Contracts.md` y a los specs el mismo día; implementación pendiente
  (`Plan_1.2.md` §9, frente 1).
- **Fecha**: 2026-11-23.
- **Decidido por**: el planificador, sobre las decisiones del mantenedor del
  2026-11-23 (`Plan_1.2.md` §3).
- **Origen**: `Plan_1.2.md` §9, frente 1.
- **Modifica**:
  - `core/Contracts.md` §3.5 (`ImportDocumentInput.buffer`), §4
    (`FORMAT_UNSUPPORTED`), §5 (tipos y funciones nuevas) y §8
    (`DocumentParsed`, `ExportFinished`);
  - `architecture/03_Data_Model.md` §2, §3 y §19;
  - `core/PDF_Engine.md` §6 (`PdfEngineInput`);
  - `core/Orchestrator.md` §9, §11 y §13;
  - `core/Export_Engine.md`: la validación de `ExportOptions`.
- **Alcance**: contrato. Sin dependencias nuevas.
- **Relacionado con**: ADR-009, ADR-020 §4, ADR-049 y ADR-237.

## Contexto

Hasta la 1.1 todo el producto supone que entra un PDF y sale un PDF 100 %
imagen (`Plan_1.2.md` §4):

- `ImportDocumentInput.buffer` está documentado como «PDF binario».
- `Document` no dice de qué formato vino.
- `DocumentMetadata.pdfVersion` es obligatorio.
- Todos los códigos de error de documento son de PDF. Un archivo que no es PDF
  termina en `PDF_INVALID`, y la UI dice «El archivo no es un PDF válido».
- `ExportOptions` no tiene formato de salida.

El 2026-11-23 el mantenedor decidió qué entra en la 1.2 y cómo sale
(`Plan_1.2.md` §3):

- Entran `.docx`, `.xlsx`, `.pptx` e imágenes PNG, JPEG, WebP, GIF, BMP,
  TIFF y AVIF.
- No entran los binarios viejos de Office, OpenDocument, ni los Office con
  macros o las plantillas. Tampoco HEIC, por el riesgo de que las patentes
  de su códec terminen en un cobro (`Plan_1.2.md` §3).
- Un acceso directo de Google tiene su propio aviso.
- Un Office con contraseña se trata como el PDF de hoy.
- La salida que viene elegida al exportar es el formato que entró.

Este ADR fija la parte del contrato que no depende del conversor de Office.
Lo que sí depende va en §8.

## Decisión

### 1. El formato de origen

```ts
// @anonly/shared — ADR-238 §1
export type SourceFormat =
  | "pdf"
  | "docx" | "xlsx" | "pptx"
  | "png" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" | "avif";
```

Es el formato del archivo que eligió el usuario, no el del documento
intermedio que recorre el pipeline. Un `.docx` convertido sigue siendo
`"docx"` aunque el PDF Engine lea un PDF.

### 2. El Core reconoce el formato por el contenido

**Quien llama no declara el formato.** `ImportDocumentInput` no cambia de
forma; el comentario de `buffer` pasa de «PDF binario» a «los bytes del
archivo». El nombre y la extensión no deciden nada en el Core: un `.docx` que
por dentro es un PDF entra como PDF.

**Dónde.** Un módulo puro del façade (`packages/anonymization-core/src/`),
no público. El Orchestrator lo llama en la etapa `Importing`, después de
emitir `DOCUMENT_IMPORTED` y antes de pasar a `Extracting`. Así el orden de
eventos es el de hoy, y un formato no admitido termina igual que
`PDF_INVALID` (Orchestrator §13 caso 4).

**Reglas, en este orden.** La primera que reconoce el archivo decide.

| Firma | Resultado |
|---|---|
| `89 50 4E 47 0D 0A 1A 0A` en el byte 0 | `png` |
| `FF D8 FF` en el byte 0 | `jpeg` |
| `GIF87a` o `GIF89a` en el byte 0 | `gif` |
| `RIFF` en el byte 0 y `WEBP` en el byte 8 | `webp` |
| `BM` en el byte 0, y el entero de 32 bits *little-endian* del byte 14 vale 12, 40, 52, 56, 108 o 124 (el tamaño de un encabezado DIB) | `bmp` |
| `49 49 2A 00` o `4D 4D 00 2A` en el byte 0 | `tiff` |
| `ftyp` en el byte 4, y la marca principal o una compatible es `avif` o `avis` | `avif` |
| `ftyp` en el byte 4, y la marca principal o una compatible es `heic`, `heix`, `heim`, `heis`, `hevc`, `hevx`, `hevm` o `hevs` | no admitido, `heic` |
| `PK\x03\x04` en el byte 0: un ZIP | lo que diga §2.1 |
| `D0 CF 11 E0 A1 B1 1A E1` en el byte 0: un contenedor OLE | lo que diga §2.2 |
| `%PDF-` en los primeros 1024 bytes | `pdf` |
| Texto JSON de hasta 64 KiB, con o sin BOM, cuyo objeto raíz tiene una clave `doc_id` de tipo texto | no admitido, `google-shortcut` |
| Cualquier otra cosa | no admitido, `unknown` |

Las firmas que empiezan en el byte 0 van antes que la del PDF, porque `%PDF-`
se busca en un rango y no en una posición fija.

#### 2.1 Un ZIP

- Se lee el directorio central del ZIP (el registro final, `PK\x05\x06`, en
  los últimos 65 557 bytes).
- Un ZIP64, un directorio ilegible o un ZIP truncado: no admitido,
  `unknown`.
- Si tiene `[Content_Types].xml`, se descomprime con
  `DecompressionStream("deflate-raw")`, que ya trae la plataforma. Tope:
  1 MiB descomprimido. Pasarlo es no admitido, `unknown`.
- El formato sale del `ContentType` de la parte principal, con comillas
  simples o dobles:

| `ContentType` | Resultado |
|---|---|
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml` | `docx` |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml` | `xlsx` |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml` | `pptx` |
| Las variantes con macros, las plantillas, el libro binario de Excel y la presentación de diapositivas: `…wordprocessingml.template.main+xml`, `application/vnd.ms-word.document.macroEnabled.main+xml`, `application/vnd.ms-word.template.macroEnabledTemplate.main+xml`, `…spreadsheetml.template.main+xml`, `application/vnd.ms-excel.sheet.macroEnabled.main+xml`, `application/vnd.ms-excel.template.macroEnabled.main+xml`, `application/vnd.ms-excel.sheet.binary.macroEnabled.main`, `…presentationml.template.main+xml`, `…presentationml.slideshow.main+xml`, `application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml`, `application/vnd.ms-powerpoint.template.macroEnabled.main+xml`, `application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml` | no admitido, `office-variant` |

- Si no tiene `[Content_Types].xml` y su primera entrada es `mimetype` sin
  comprimir, con un contenido que empieza con
  `application/vnd.oasis.opendocument.`: no admitido, `opendocument`.
- Cualquier otro ZIP: no admitido, `unknown`.

#### 2.2 Un contenedor OLE

Se lee el directorio completo siguiendo la FAT (MS-CFB §2.6), con un tope de
4096 entradas:

- **Con las secuencias `EncryptionInfo` y `EncryptedPackage` en la raíz**: es
  un Office cifrado (ECMA-376, parte 2). No se sabe si es Word, Excel o
  PowerPoint hasta descifrarlo. Sigue el camino de la contraseña (§7).
- **Con `WordDocument`, `Workbook`, `Book` o `PowerPoint Document` en la
  raíz**: no admitido, `office-legacy`.
- **Cualquier otro**: no admitido, `unknown`.

#### 2.3 Lo que la UI filtra antes

La UI deja pasar al Core los archivos con estas extensiones, sin importar
mayúsculas:

- **Las que entran**: `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.png`, `.jpg`,
  `.jpeg`, `.jpe`, `.webp`, `.gif`, `.bmp`, `.tif`, `.tiff` y `.avif`.
- **Las que el Core reconoce para dar su aviso**:
  - de Office: `.doc`, `.xls`, `.ppt`, `.docm`, `.dotx`, `.dotm`, `.xlsm`,
    `.xltx`, `.xltm`, `.xlsb`, `.pptm`, `.potx`, `.potm`, `.ppsx` y
    `.ppsm`;
  - de OpenDocument: `.odt`, `.ods` y `.odp`;
  - de Google: `.gdoc`, `.gsheet` y `.gslides`;
  - de HEIC: `.heic` y `.heif`.

También pasa un archivo de tipo MIME `application/pdf`, como hoy. El resto lo
rechaza la UI sin leerlo, con el texto de `unknown` (§4). Así un archivo
grande que no tiene nada que ver no se carga en memoria.

### 3. Dónde viaja el formato

- **`PdfEngineInput.sourceFormat: SourceFormat`**, obligatorio. Lo pasa el
  Orchestrator. El PDF Engine lo copia al `Document` y no decide nada con él,
  salvo los metadatos de abajo.
- **`Document.sourceFormat: SourceFormat`**, obligatorio.
- **`DocumentParsed.sourceFormat: SourceFormat`**, obligatorio. La UI lo lee
  de ahí, como lee `pageCount` y `sourceKind`.
- **`DocumentMetadata.pdfVersion` pasa a ser opcional.**
  - Con `sourceFormat: "pdf"` está siempre, como hoy.
  - Con cualquier otro formato, el PDF Engine deja afuera `pdfVersion`,
    `title`, `producer` y `creationTool`, porque son del PDF intermedio y no
    del archivo del usuario.
  - `encrypted` y `hasForms` siguen siendo obligatorios; con un formato que
    no es PDF valen `false`.
- **`Word.source` no cambia.** Las palabras que salen del PDF intermedio son
  `"pdf"`, y las del OCR son `"ocr"`.
- **`sourceKind` no cambia de significado.** Una imagen suelta es
  `"scanned"`; un Office es lo que resulte de su PDF intermedio.

### 4. El error neutro: `FORMAT_UNSUPPORTED`

```ts
// @anonly/shared — ADR-238 §4
// EngineErrorCode.FORMAT_UNSUPPORTED = "FORMAT_UNSUPPORTED"
export type UnsupportedFormatReason =
  | "unknown"
  | "office-legacy"
  | "office-variant"
  | "opendocument"
  | "google-shortcut"
  | "heic";
```

- **La clase es `UnsupportedFormatError`**, en `shared/src/errors.ts`.
  - Tiene `engineId: "core"` y `retryable: false`.
  - Sus `details` son `{ reason: UnsupportedFormatReason }`.
  - Se discrimina por `code` (ADR-049). La UI lee `details.reason` con un
    guard propio, porque `details` cruza el worker sin tipo.
- **El flujo es el de `PDF_INVALID`**: `PIPELINE_FAILED` inmediato, con el
  error serializado, y los recursos de la importación liberados.
- **Es el primer código propio del Orchestrator.** Orchestrator §11 pasa a
  decir que el Orchestrator define solo este.
- **Cambia un comportamiento.**
  - Un archivo que hoy termina en `PDF_INVALID` porque no es un PDF pasa a
    terminar en `FORMAT_UNSUPPORTED`.
  - `PDF_INVALID` y `PDF_CORRUPTED` quedan para lo que el detector reconoce
    como PDF y pdf.js no puede abrir.

Los textos de la UI, para que el frente de interfaz los pase a
`UX_Guidelines.md`:

| `reason` | Texto |
|---|---|
| `unknown` | «Anonly no puede abrir este archivo. Acepta PDF, Word, Excel, PowerPoint e imágenes.» |
| `office-legacy` | «Es un archivo de una versión vieja de Office. Abrilo en Office y guardalo como .docx, .xlsx o .pptx.» |
| `office-variant` | «Este archivo de Office tiene macros o es una plantilla. Abrilo en Office y guardalo como documento normal: .docx, .xlsx o .pptx.» |
| `opendocument` | «Anonly no abre archivos de OpenDocument. Guardalo como .docx, .xlsx o .pptx y cargalo de nuevo.» |
| `google-shortcut` | «Es un acceso directo de Google, no el documento. Abrilo en Google, descargalo con Archivo → Descargar como Word, Excel o PowerPoint, y cargá ese archivo.» |
| `heic` | «Anonly no abre fotos HEIC, el formato del iPhone. Pasala a JPEG o PNG y cargala de nuevo. Para que el iPhone saque las fotos en JPEG: Ajustes → Cámara → Formatos → Más compatible.» |

### 5. La salida se elige al exportar

```ts
// @anonly/shared — ADR-238 §5
export type ExportOutput = "pdf-image" | "pdf-text" | "docx";

export interface ExportOptions {
  // … los campos de hoy (03_Data_Model.md §19) …
  readonly output: ExportOutput;   // ADR-238 §5
  readonly pdfA: boolean;          // ADR-238 §5; solo con salidas PDF
}

export interface ExportFinished {
  // … los campos de hoy …
  readonly output: ExportOutput;
  readonly pdfA: boolean;
}
```

- **`output` y `pdfA` son obligatorios.** Quien arma un `ExportOptions` dice
  qué quiere; no hay un valor por defecto escondido en el Core.
- **El Export Engine rechaza con `InvalidInputError`**, sin exportar:
  - un `output` que no está en `exportOutputsFor(document.sourceFormat)`;
  - `pdfA: true` con `output: "docx"`;
  - un `filename` que no termina en `exportExtension(output)`, sin importar
    mayúsculas.
- **Qué significa cada salida lo fija su propio ADR.**
  - `pdf-image` es el export de hoy (ADR-009), sin cambios.
  - `pdf-text` va en el ADR del texto preservado.
  - `docx` va en el ADR del Word limpio.
  - `pdfA` va en el ADR de PDF/A.

  Hasta que cada uno exista, el Export Engine rechaza esa opción con
  `InvalidInputError`: `pdf-text`, `docx` y `pdfA: true`. Ningún build
  publicado pasa por ese estado, porque la 1.2 sale junta (§6).
- **`filename` sigue siendo el nombre completo.** La UI lo arma con el campo
  del nombre y el desplegable de la extensión, como decidió el mantenedor
  (`Plan_1.2.md` §3). El diseño del diálogo va aparte.

### 6. Funciones puras y la regla de transición

En `@anonly/shared`:

```ts
// ADR-238 §6. La tabla de Plan_1.2.md §6.6.
export function exportOutputsFor(format: SourceFormat): ReadonlyArray<ExportOutput>;
// "docx" → ["docx", "pdf-image", "pdf-text"]; cualquier otro → ["pdf-image", "pdf-text"]

export function defaultExportOutput(format: SourceFormat): ExportOutput;
// "docx" → "docx"; cualquier otro → "pdf-image" (decisión del mantenedor, 2026-11-23)

export function exportExtension(output: ExportOutput): ".pdf" | ".docx";
```

**Regla de transición.** Mientras un formato admitido no tenga su camino de
entrada (frentes 2 a 5 de `Plan_1.2.md` §9), el Orchestrator lo rechaza con
`FORMAT_UNSUPPORTED` y `reason: "unknown"`. Lo mismo vale para un Office
cifrado hasta que exista el ADR de §7. Es un estado de la branch de trabajo,
no de una versión.

### 7. Office con contraseña

El detector lo reconoce (§2.2). El mantenedor decidió que se trate como el
PDF de hoy: la app pide la contraseña y lo abre. El evento que la pide, el
reintento y el error de contraseña equivocada los fija el ADR del conversor,
porque dependen de quién descifra: el conversor o un descifrado propio con
WebCrypto. El spike lo mide (`Plan_1.2.md` §8).

`PDF_PASSWORD_REQUIRED` no se reutiliza para un Office: su nombre y su canal
son del PDF Engine.

### 8. Lo que este ADR no fija

- **Cómo y dónde se convierte un Office**: la etapa, sus eventos, su
  progreso y sus errores, como un Office roto o una conversión que vence. Va
  en el ADR del conversor, con los números del spike.
- **Cómo se decodifica una imagen suelta y cómo se vuelve página**: va en
  ADR-239.
- **Qué significan `pdf-text`, `docx` y `pdfA`** (§5).
- **El diálogo de exportar** (`Plan_1.2.md` §7).

## Consecuencias

- **La UI deja de decir «no es un PDF válido» de cualquier cosa.** Cada
  archivo que no entra recibe un aviso que dice qué hacer.
- **El Core es la única autoridad sobre el formato.** La extensión solo
  filtra en la UI, para no leer archivos ajenos.
- **El detector no suma dependencias.** El ZIP y el contenedor OLE se leen
  con código propio, y el único `deflate` es el de la plataforma
  (`DecompressionStream`, que existe en Electron y en Node ≥ 22).
- **Cambios que rompen, todos internos:**
  - `DocumentMetadata.pdfVersion` opcional: cada lector lo trata como
    ausente;
  - `ExportOptions.output` y `pdfA` obligatorios: la UI, sus tests y los
    fixtures que arman opciones de export los agregan;
  - `PdfEngineInput.sourceFormat` y `Document.sourceFormat` obligatorios:
    los fixtures de `Document` los agregan.
- **Tests que cambian por decisión, no para esconder un defecto:**
  - un test que pasa bytes que no son PDF y espera `PDF_INVALID` pasa a
    esperar `FORMAT_UNSUPPORTED`;
  - el que quiera seguir probando `PDF_INVALID` usa un archivo que empiece
    con `%PDF-` y esté roto.
- **Un PDF sin el encabezado `%PDF-` en sus primeros 1024 bytes deja de
  abrirse.** Hoy pdf.js a veces lo repara. Es raro, y el costo se acepta a
  cambio de que el detector sea exacto.
- **Un Office truncado, por ejemplo una descarga incompleta, recibe el aviso
  de `unknown`.** El ADR del conversor puede afinarlo si el spike muestra
  que es frecuente.
- **La regla de `google-shortcut` (`doc_id`) se confirma con un acceso
  directo real** antes de implementarla. Si el formato del archivo es otro,
  se corrige este ADR, no el test.
