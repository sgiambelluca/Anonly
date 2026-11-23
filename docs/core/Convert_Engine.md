<!-- CONTEXT: scope=motor-convert | dependencias=core/Contracts.md,adr/ADR-238-El-Formato-De-Origen-Se-Reconoce-Por-El-Contenido-Y-La-Salida-Se-Elige-Al-Exportar.md,adr/ADR-239-Una-Imagen-Suelta-Entra-Como-Un-PDF-Armado-Por-Un-Motor-Nuevo.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,adr/ADR-196-Las-Licencias-Del-Software-De-Terceros-Viajan-Con-El-Instalador.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,roadmap/formatos/Spike_Imagenes_2026-11-23.md | audiencia=IA-implementador | fase=1.2 -->

# Convert Engine — Spec

> Convierte un archivo que no es PDF en un PDF intermedio, para que el resto
> del pipeline lo lea como cualquier PDF. Desde la 1.2 (ADR-239) convierte
> imágenes sueltas: PNG, JPEG, WebP, GIF, BMP, TIFF y AVIF. Cómo le llega un
> Office lo decide el ADR del conversor, y se suma a este spec.

**Paquete**: `@anonly/convert-engine`
**Ubicación**: `packages/anonymization-core/convert-engine/`
**`EngineId`**: `Convert` (`"convert"`)

---

## 1. Objetivo

Recibir los bytes de una imagen con su `sourceFormat` ya reconocido
(ADR-238 §2) y devolver un PDF con una página por imagen, o por página de
un TIFF. Cada página es una sola imagen con sus píxeles nativos que cubre
la página entera, así que el PDF Engine la lee como un escaneo y el OCR no
sube la resolución por encima de la del archivo (ADR-163).

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

---

## 3. Fuera de alcance

- Reconocer el formato: lo hace el Orchestrator (ADR-238 §2). Este motor
  confía en el `sourceFormat` que recibe, pero igual falla limpio si la
  cabecera no coincide (§11).
- Parsear el PDF que arma, hacer OCR o detectar entidades.
- Anonimizar nada: el PDF intermedio nunca sale de la app; el export se
  rearma desde los renders (ADR-009).
- Convertir Office: va en el ADR del conversor.
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
  `ImageDecoder` (solo para contar cuadros, si hace falta).
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `SourceFormat`,
  `ConvertConfig`, `ConversionPageFinished` y los códigos de §11.

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `apps/react-client`.
- Cualquier otro motor.
- `pdfjs-dist`, `tesseract.js`, `onnxruntime-web`, `@huggingface/transformers`.
- `libheif-js` o cualquier decodificador HEVC (ADR-238: HEIC queda afuera).
- Node builtins (`fs`, `http`…), red de cualquier tipo.
- Crear un `window` global en el Worker: la conversión CMYK de `utif2` que
  lo necesita no se usa (§6.3).

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

export class ConvertEngine implements IEngine {
  readonly id = EngineId.Convert;
  init(ctx: EngineContext): Promise<void>;
  convertImage(input: ConvertImageInput, ctx: EngineContext): Promise<ConvertOutput>;
  dispose(): Promise<void>;
}

// Patrón de ADR-055: el worker corre el motor completo y el façade decodifica
// su resultado host-side. Lanza InvalidInputError si `value` no tiene la
// forma de ConvertOutput, como decodePdfEngineOutput.
export function decodeConvertOutput(value: unknown): ConvertOutput;
```

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

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Throttle |
|---|---|---|---|---|
| `CONVERSION_PAGE_FINISHED` (`EventChannel.Convert`) | al terminar de armar cada página | `ConversionPageFinished` | async | no: una por página |

Lo emite por su `ctx.bus`, como el PDF Engine emite `PAGE_PARSED`. El
Orchestrator lo traduce a `PIPELINE_PROGRESS` (`core/Orchestrator.md` §2).

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

---

## 11. Errores posibles

Todos con `engineId: "convert"`. Terminan en `PIPELINE_FAILED` (el
Orchestrator lo propaga, como `PDF_INVALID`).

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `IMAGE_TOO_LARGE` | `ImageTooLargeError` | pasa el tope de §9. `details`: `{ reason: "pixels" \| "side" \| "pages", width?, height?, pageIndex?, pageCount? }` | no | la UI muestra el aviso de ADR-239 §6 |
| `IMAGE_DECODE_FAILED` | `ImageDecodeFailedError` | la cabecera no es válida o no coincide con `sourceFormat`; `createImageBitmap` o `utif2` fallan; un JPEG aritmético; un TIFF que `utif2` no lee. `details`: `{ pageIndex }` | no | idem |
| `CONVERT_TIMEOUT` | `ConvertTimeoutError` | una página tarda más que `workerPool.timeouts["convert-image"]` (default 30 000 ms). `details`: `{ pageIndex }` | no | idem |
| `INVALID_INPUT` | `InvalidInputError` | §9, o `decodeConvertOutput` recibe algo que no es un `ConvertOutput` | no | bug del caller o del transporte |
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

---

## 14. Casos de prueba

Los tests de Node mockean `decode-native.ts` (§6.2). Los lectores de
cabecera, el tamaño de página, `utif2` y `pdf-lib` corren sin mock. Los
fixtures son sintéticos, generados en el test o en `tests/fixtures/`, con
datos inventados.

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

---

## Referencias

- ADR-238: el formato de origen y su reconocimiento.
- ADR-239: este motor.
- ADR-163: la condición de una página que es un único ráster.
- ADR-055: el decoder del resultado del worker.
- `roadmap/formatos/Spike_Imagenes_2026-11-23.md`: las mediciones.
