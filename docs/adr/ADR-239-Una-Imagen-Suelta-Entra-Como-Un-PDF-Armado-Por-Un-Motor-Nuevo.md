<!-- CONTEXT: scope=adr | dependencias=roadmap/Plan_1.2.md,roadmap/formatos/Spike_Imagenes_2026-11-23.md,adr/ADR-238-El-Formato-De-Origen-Se-Reconoce-Por-El-Contenido-Y-La-Salida-Se-Elige-Al-Exportar.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,adr/ADR-196-Las-Licencias-Del-Software-De-Terceros-Viajan-Con-El-Instalador.md,core/Contracts.md,core/Orchestrator.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md | audiencia=humanos+IA | fase=1.2 -->

# ADR-239 — Una imagen suelta entra como un PDF que arma un motor nuevo

- **Estado**: Aceptado por el mantenedor el 2026-11-23, junto con ADR-238,
  del que depende. Falta pasarlo a `Contracts.md` y a los specs, incluido
  el spec nuevo del Convert Engine (`Plan_1.2.md` §9, frente 2).
- **Fecha**: 2026-11-23.
- **Decidido por**: el planificador, sobre las decisiones del mantenedor del
  2026-11-23 (`Plan_1.2.md` §3: los formatos y el tope de 50 MP).
- **Origen**: `Plan_1.2.md` §9, frente 2, y el spike de imágenes
  (`formatos/Spike_Imagenes_2026-11-23.md`).
- **Modifica**:
  - `core/Contracts.md` §1 (`EngineId`), §2 (canal y evento), §4 (códigos
    de error), §5 (`WorkerJobType`), §6 (configuración y constantes) y §8
    (payload);
  - un spec nuevo, `core/Convert_Engine.md`;
  - `core/Orchestrator.md`: la etapa `Importing` y el buffer retenido;
  - `architecture/05_Worker_Architecture.md`: el pool nuevo;
  - `architecture/06_Pipeline.md`: la etapa 0.
- **Alcance**: contrato, un motor nuevo y una dependencia nueva (`utif2`).
- **Relacionado con**: ADR-009, ADR-163, ADR-192, ADR-196 y ADR-238.

## Contexto

ADR-238 hace que el Core reconozca PNG, JPEG, WebP, GIF, BMP, TIFF y AVIF.
`Plan_1.2.md` §6.1 propone que todo formato llegue al pipeline como un
documento paginado, para no reescribir los siete motores: una imagen es una
página escaneada.

El spike de imágenes midió en el Electron del repo, dentro de un Worker con
la CSP de la app:

- **Electron decodifica solo** PNG, JPEG, WebP, GIF, BMP y AVIF, aplica la
  orientación EXIF y toma el primer cuadro de un animado. No decodifica TIFF
  ni un JPEG con codificación aritmética.
- **`utif2` 4.1.0** (MIT, 39 KB gzip, sin `eval`) lee TIFF con todas las
  compresiones probadas, con varias páginas y con su resolución. No aplica
  la orientación del TIFF, y su conversión de CMYK usa `window`, que no
  existe en un Worker.
- **Un PDF armado con el `pdf-lib` del repo** queda como lo pide ADR-163:
  una sola imagen por página, con sus píxeles nativos y cubriendo la página
  entera. pdf.js lo lee como un escaneo.
- **Un JPEG con orientación 1 se puede pasar tal cual** en unos 20 ms.
  Recodificar sin pérdida cuesta entre 1 y 3 s por página A4.
- **Una imagen chica en bytes puede ser enorme en píxeles.** Un PNG de
  400 KB ocupó 1,5 GB, y la cabecera, que se lee en 5 a 15 ms, dice el
  tamaño antes de decodificar.

## Decisión

### 1. Un motor nuevo: el Convert Engine

- **`EngineId.Convert = "convert"`**, en `packages/anonymization-core/convert-engine/`.
- Es el lugar de todo formato de origen que no es PDF: recibe los bytes del
  archivo y devuelve un PDF. Este ADR le da las imágenes. Cómo le llega un
  Office lo decide el ADR del conversor.
- **Corre en un pool propio**, con un solo worker y el job
  `"convert-image"` (`WorkerJobType`).
  - El Orchestrator termina el pool al terminar la conversión, sin esperar
    los 60 s de inactividad. Así la memoria de la conversión vuelve antes
    de que empiecen el OCR y la detección, y no se suma a su pico
    (ADR-192).
- **Por qué un motor y no el PDF Engine.** El PDF Engine lee PDFs con
  pdf.js. Darle también decodificadores y `pdf-lib` mezclaría dos
  responsabilidades, y su pool tiene varios workers, cuando una conversión
  necesita uno solo.

```ts
// ADR-239 §1
export interface ConvertImageInput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;     // los bytes del archivo; se transfiere
  readonly sourceFormat: "png" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" | "avif";
}

export interface ConvertOutput {
  readonly pdf: ArrayBuffer;        // el PDF intermedio
  readonly pageCount: number;
}
```

### 2. Dónde entra en el pipeline

- En la etapa `Importing`, después del reconocimiento de ADR-238 §2.
  - Con un formato de imagen, el Orchestrator llama al Convert Engine.
  - Después pasa el PDF que recibió al PDF Engine, con el `sourceFormat`
    original (ADR-238 §3), y sigue como hoy.
- **El buffer retenido es el PDF intermedio**, no la imagen
  (Orchestrator §2). Los bytes de la imagen se sueltan al terminar la
  conversión. El export sigue rearmándose desde los renders (ADR-009), así
  que nada del PDF intermedio sale de la app.
- **Progreso.** El motor emite `CONVERSION_PAGE_FINISHED` por página, en
  `EventChannel.Convert`:

  ```ts
  // ADR-239 §2
  export interface ConversionPageFinished {
    readonly documentId: string;
    readonly pageIndex: number;
    readonly pageCount: number;
  }
  ```

  El Orchestrator lo traduce a `PIPELINE_PROGRESS` con `stage: Importing`,
  `current: pageIndex + 1` y `total: pageCount`. Cómo lo muestra la UI va
  en el frente de interfaz.

### 3. El tope, antes de decodificar

- **El motor lee primero la cabecera de cada imagen**, o de cada página de
  un TIFF, con un lector propio y sin decodificar:
  - PNG: `IHDR`;
  - JPEG: el primer `SOFn`;
  - GIF: la pantalla lógica;
  - BMP: el encabezado DIB;
  - WebP: `VP8`, `VP8L` o `VP8X`;
  - AVIF: `ispe`;
  - TIFF: las etiquetas 256 y 257 de cada IFD de la cadena principal.
- **Tope, por imagen o por página:** `IMAGE_MAX_PIXELS = 50_000_000`
  (decisión del mantenedor) e `IMAGE_MAX_SIDE = 16_384`.
  - El lado sale del límite de los canvas de Chromium: el spike midió que
    pasarlo da una página en blanco sin error.
  - La cantidad de páginas de un TIFF usa el mismo tope que un PDF
    (`PdfEngineConfig.maxPageCount`).
- **Si se pasa**, no se decodifica nada y el motor lanza `IMAGE_TOO_LARGE`
  (§6). En un TIFF se revisan todas las páginas antes de decodificar la
  primera.

### 4. Decodificar

- **PNG, JPEG, WebP, GIF, BMP y AVIF**: `createImageBitmap` del Worker.
  Chromium aplica la orientación EXIF, y de un animado se queda con el
  primer cuadro.
- **TIFF**: `utif2`, una página por IFD de la cadena principal. Las
  subimágenes y las miniaturas no son páginas.
  - **La orientación del TIFF** (etiqueta 274) la aplica el motor, porque
    `utif2` no.
  - **El CMYK lo pasa a RGB el motor**, sin la función de `utif2` que
    busca `window`. No se crea un `window` global en el Worker.
- **Una imagen que su formato reconoce pero que no se puede decodificar**
  (un JPEG aritmético, un archivo roto, una variante de TIFF que `utif2` no
  lee) lanza `IMAGE_DECODE_FAILED` (§6).

### 5. La página

- **Tamaño.** Si la imagen declara una resolución entre 100 y 1200 dpi,
  cada lado mide sus píxeles × 72 / dpi, en puntos. La resolución sale de
  `pHYs` en PNG, de JFIF o EXIF en JPEG, del encabezado en BMP y de las
  etiquetas 282, 283 y 296 en TIFF.
  - Si la orientación rota 90°, las dos resoluciones se intercambian.
  - Sin una resolución válida, el lado largo mide 841,89 pt, el de una A4,
    y el otro conserva la proporción.
- **Contenido.** Una sola imagen por página, con sus píxeles nativos,
  cubriendo la página entera y sin ninguna otra operación de pintura. Es la
  condición de ADR-163 para que el OCR no suba la resolución por encima de
  la del archivo.
- **Cómo se guarda la imagen en el PDF:**
  - **Un JPEG con orientación 1, o sin orientación, que `createImageBitmap`
    decodificó, va tal cual** (`embedJpg`). Decodificarlo antes es lo que
    descarta el JPEG aritmético, que `embedJpg` acepta y después nadie
    lee.
  - **Todo lo demás va sin pérdida**: los píxeles, aplanados sobre blanco,
    comprimidos con Flate. Van en escala de grises si la imagen es gris, y
    en RGB si no.
- **Con `pdf-lib`**, la dependencia que el repo ya tiene en el Export
  Engine, en la misma versión. Si un ADR posterior pasa a
  `@cantoo/pdf-lib`, se cambian los dos motores juntos.

### 6. Errores

En `EngineErrorCode`, con `engineId: "convert"` y `retryable: false`:

| Código | Cuándo | `details` |
|---|---|---|
| `IMAGE_TOO_LARGE` | La imagen o una página pasa el tope de §3 | `{ reason: "pixels" \| "side" \| "pages", width?, height?, pageIndex?, pageCount? }` |
| `IMAGE_DECODE_FAILED` | El formato se reconoció pero la imagen no se pudo decodificar | `{ pageIndex }` |
| `CONVERT_TIMEOUT` | Una página tarda más que `workerPool.timeouts["convert-image"]` | `{ pageIndex }` |

- Los tres terminan en `PIPELINE_FAILED`, con los recursos liberados, como
  `PDF_INVALID`.
- `CONVERT_TIMEOUT` corre por página, no por documento: un TIFF de muchas
  páginas no tiene que caber en un solo plazo. El default es 30 000 ms.

Los textos de la UI, para el frente de interfaz:

| Código | Texto |
|---|---|
| `IMAGE_TOO_LARGE` | «La imagen es demasiado grande: tiene {N} megapíxeles y Anonly abre hasta 50. Achicala y cargala de nuevo.» Para un TIFF con demasiadas páginas: «El archivo tiene demasiadas páginas.» |
| `IMAGE_DECODE_FAILED` | «No se pudo leer la imagen. Puede estar dañada o en una variante que Anonly no abre. Probá guardarla de nuevo como PNG o JPEG.» |
| `CONVERT_TIMEOUT` | «La imagen tardó demasiado en abrirse.» |

### 7. Dependencia nueva: `utif2`

- `utif2` 4.1.0, con versión exacta, licencia MIT. Trae `pako` 1.x (MIT y
  Zlib), que `pdf-lib` ya usa.
- Cumple R-12 con este ADR, y entra al aviso de licencias de terceros
  (ADR-196).
- **No usa `eval` ni `new Function`.** Corre igual cuando los workers
  reciban la CSP de la app.

## Consecuencias

- **Río abajo no cambia nada**: OCR, detección, agrupación, visor y export
  reciben un PDF escaneado como cualquier otro.
- **El pipeline tiene un motor más**, con su spec, sus tests de contrato,
  unidad y borde, y su cobertura (R-13). Es el lugar donde después entra el
  Office.
- **El pico de la conversión es antes del análisis, no encima.** Con
  50 MP, el spike midió entre 1,0 y 1,8 GB, que se devuelven al terminar el
  pool. En un equipo de 8 GB falta medirlo en la app real (frente 8).
- **Una página que no es JPEG tarda entre 1 y 3 s en entrar**: un TIFF de
  50 páginas, más de un minuto. El progreso de §2 lo hace visible. Hay
  mejoras medibles para después: pasar el CCITT G4 de un TIFF tal cual, o
  guardar 1 bit en vez de 8. Ninguna cambia este contrato.
- **Un JPEG sin rotar mantiene su EXIF dentro del PDF intermedio**: GPS,
  cámara y autor. Ese PDF no sale de la memoria, y el export se rearma
  desde los renders, así que no viaja (ADR-009). El gate de ADR-148 lo
  confirma igual que hoy.
- **AVIF entra sin dependencia.** HEIC queda afuera (ADR-238).
- **Todo lo medido sale de sintéticos y de muestras de terceros.** Antes de
  cerrar la 1.2 se mide con imágenes reales, por `ANONLY_REAL_DOC_*`, en
  particular fotos de teléfono y TIFF de escáner.
