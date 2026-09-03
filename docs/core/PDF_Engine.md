<!-- CONTEXT: scope=pdf-engine | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md,adr/ADR-053-Pdfjs-Dentro-De-Un-Worker-Fuentes-Y-Cmaps.md,adr/ADR-055-Decodificacion-Del-Resultado-Que-Cruza-Un-Worker.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-068-Origen-De-Run-Corrido-Por-Word-Spacing.md,adr/ADR-097-El-Avance-Real-De-Cada-Glifo-Reemplaza-Al-Promedio.md,adr/ADR-102-El-Flujo-De-Glifos-Es-Continuo-Por-Pagina.md,adr/ADR-108-El-Avance-De-Un-Espacio-Incluye-El-Word-Spacing.md,adr/ADR-109-La-Caja-De-Una-Palabra-Es-Su-Caja-De-Tinta.md,adr/ADR-110-El-Renglon-Es-Un-Grupo-No-Una-Coordenada.md,adr/ADR-113-El-Renglon-Se-Corta-Donde-Hay-Una-Columna.md,adr/ADR-120-Una-Hoja-Torcida-Se-Lee-Enderezada.md | audiencia=IA-implementador | fase=11 (Hito 2 cerrado, hardening ADR-020; fuseOcrPage función pura y motor sin estado por documento vía ADR-041 — PR12 del Hito 10; `PdfPasswordRequiredError.retryable = false` vía ADR-049 §4 — PR 17.1; CMaps y standard fonts en getDocument vía ADR-053 §5 — cierre de fase 10; `decodePdfEngineOutput` vía ADR-055 §10 — D3.1; bbox derivado de la matriz completa vía ADR-063 — Hito 10.8 paso 1; OCR por región (`ocrRegions`, `fuseOcrRegion`) vía ADR-065 — paso 2; texto de anotaciones y `BoundingBox.rotation` vía ADR-066 — paso 3; orden de lectura por runs rotados vía ADR-067 — paso 4; origen de run corrido por word-spacing vía ADR-068 — paso 5, cierre del hito; avance real por glifo vía ADR-097 — Hito 11, calidad de detección; flujo continuo de glifos por página vía ADR-102 — Hito 11; `Tw` en el avance de los espacios vía ADR-108 y caja de tinta + clave de orden en la línea de base vía ADR-109 — Hito 11, ítems 27 y 28 de §15; el orden de lectura del texto horizontal pasa a agrupar renglones y desaparece el comparador con tolerancia vía ADR-110 — Hito 11, ítem 30 de §15, supersede ADR-109 §3; el renglón se corta por hueco de columna y se reúne por adyacencia vía ADR-113 — Hito 11, ítem 31 de §15; pendientes: items §15 diferidos a Hito 11) -->

# PDF Engine — Spec de Motor

> Extrae texto y posiciones de cada página del PDF. Marca las páginas sin texto para que OCR las procese. Descarta metadata sensible.

**EngineId**: `pdf` (valor del enum `EngineId`)
**Versión del spec**: 1.14.0
**Última actualización**: 2026-09-02

> **Nota (v1.14.0, ADR-120, 2026-09-02 — una hoja torcida se lee enderezada)**: con la orientación arreglada (ADR-119), el texto de una hoja escaneada de costado se **reconoce** —266 de 268 palabras— pero llegaba al detector **revuelto**: ADR-090 §4 le estampa la misma `bbox.rotation` a cada palabra de la página, y `sortWordsByReadingOrder` las mandaba todas por la rama de runs rotados de ADR-067, pensada para un sello o un folio en un margen y sin nada equivalente al agrupado por renglón de ADR-110 ni a la adyacencia horizontal de ADR-113. Medido: **138, 152 y 132 de 267** pares consecutivos preservados a 90°, 180° y 270°. Ahora, cuando **todas** las palabras comparten una rotación **y todas vienen de OCR**, se ordenan copias con la caja llevada al marco enderezado —la inversa de `unrotateBbox`— con el algoritmo que ya funciona, y se emiten los `Word` originales: la geometría no se toca, solo el orden. Las tres rotaciones pasan a **265/267**, que es lo mismo que da el control derecho. La condición sobre `source` es el discriminador contra una página **nativa** cuyo único contenido son runs rotados (caso 36 de ADR-067), que se ve igual en la geometría y tiene que seguir por la rama de runs. Ver §13 y §14.

> **Nota (v1.13.0, ADR-113, 2026-09-02 — el renglón se corta donde hay una columna)**: el acumulado por banda de ADR-110 solo mira el **último** renglón abierto y su banda sale de la mediana de altos de ese renglón. Sobre el sello de un fallo escaneado —dos columnas con cuerpos distintos, 8,6 pt a la izquierda y 6,0 a la derecha, separadas por un hueco de **113,5 pt**— la banda de la columna alta llega a la baja y se lleva sus primeras palabras: el detector recibía  y emitía una  llamada **"ARTURO RECURSO DE SUAREZ"**, con el apellido real sin tapar. La decisión que lo produce queda a 4,08 pt de una banda de 4,32 y la siguiente a 4,32 exactos: **la toma el redondeo binario**, por eso fallaba en una página de 19. Ninguna medida vertical más fina sirve —un escaneo tiene desviación, y dos formulaciones alternativas medidas rompen el cuerpo en palabras de caja chica (, , , el guion de una firma)—, así que se usa el **hueco horizontal**, que en ese renglón separa 113,5 pt contra 2,4–13 entre palabras de una misma frase. Cada renglón se corta donde el hueco supera 3 cuerpos, y después dos trozos **pegados** que comparten banda se vuelven a unir (por adyacencia, no por solapamiento: los dos trozos de la carátula se tocan, no se solapan). Medido: pares preservados contra Tesseract 96,9 % → **97,3 %** (solo el cuerpo, 99,6 % → **99,8 %**), sello entero 16/19 → **17/19**, y texto nativo **idéntico** en 110 páginas / 30.959 palabras. Cierra el riesgo que ADR-110 §3 dejó anotado al descartar la segmentación por columnas. Ver §13 casos 55-57, §14 y §15 ítem 31.

> **Nota (v1.12.0, ADR-110, 2026-08-30 — el renglón es un grupo, no una coordenada)**: `sortWordsByReadingOrder` ordenaba el texto horizontal con un comparador de una coordenada **con tolerancia**, y eso no es una relación de orden: `a ≈ b` y `b ≈ c` no implican `a ≈ c`, así que `Array.sort` devolvía un resultado dependiente de su secuencia interna de comparaciones. En un PDF de texto nativo de una columna nunca se notó; sobre un **escaneo** rompe **uno de cada tres pares de palabras consecutivos** (47,9 %–67,5 % de pares preservados según la página, contra el recorrido `bloque → párrafo → línea` de Tesseract). El síntoma que lo destapó: en el encabezado a dos columnas de un fallo, el reemplazo del nombre del imputado —que está a la derecha— se pintaba sobre el escudo de la izquierda; y el cuerpo, que "se veía bien", llegaba a NER como `integrada los por señores jueces doctores Juez Uno Juez y Dos 451 del (art. …`. **No era la geometría**: las cajas del OCR coinciden con la tinta al sub-punto. El texto horizontal pasa a **agruparse en renglones** —pre-orden total por centro vertical, banda de `0,5 × la mediana de los altos del renglón`— y a ordenarse por `x` dentro de cada uno; el comparador con tolerancia desaparece. Medido **antes de implementar**: escaneo 47,9–67,5 % → **96,9–100 %**; texto nativo **idéntico byte a byte** en 109 páginas y 30.886 palabras, fixtures incluidos. La segmentación en columnas se prototipó y se **descartó por medición** (efecto exactamente cero). Supersede ADR-109 §3. Ver §9, §12, §13 casos 52-54, §14, §15 ítem 30.

> **Nota (v1.11.0, ADR-109, 2026-08-30 — la caja de una palabra es su caja de tinta)**: `boundingBoxFromParallelogram` armaba el rectángulo desde la **línea de base hacia arriba** por un cuerpo entero, así que por debajo no cubría nada: las colas de `g`, `j`, `p`, `q`, `y`, la `Q` y las comas quedaban afuera en **una de cada tres palabras** (31,8 % en una pericia, 29,9 % en un fallo de la SCBA, 30,1 % en una apelación, medido contra la tinta renderizada). Del otro lado sobraba: ninguna fuente del corpus declara un ascenso de un cuerpo entero. La caja pasa a ir **del descenso al ascenso** —`base − |descent|·cuerpo` … `base + ascent·cuerpo`—, con `ascent`/`descent` de `styles[item.fontName]`, que `getTextContent()` **ya devuelve** en la misma llamada: sin API nueva, sin dependencia nueva, sin un segundo recorrido. **Bajar solo el piso no servía**: medido sobre 752 pares de renglones consecutivos, conservar el techo y extender hacia abajo fusiona el **75,8 %** de los pares de un documento con interlineado 1,15 cuerpos, y `sharesVerticalBand` es la definición de "misma línea" de tres motores. La caja de tinta completa no solapa en ningún par en el que hoy no solape ya. Dos consecuencias que viajan con el cambio: el orden de lectura del texto horizontal pasa a comparar la **línea de base** (`bbox.y + bbox.height`, hoy un no-op demostrable) porque `bbox.y` pasa a depender del ascenso de cada fuente; y `REPLACEMENT_FONT_HEIGHT_RATIO` baja de 0,7 a 0,64 para que el token se siga dibujando igual. Ver §9, §10, §12, §13 casos 47-50, §14.

> **Nota (v1.10.0, ADR-108, 2026-08-30 — el avance de un espacio incluye el word spacing)**: `appendRunGlyphs` sumaba ancho de glifo y `charSpacing` y **omitía `wordSpacing`**, por decisión explícita de ADR-097 §4 apoyada en ADR-068. En documentos con `Tw` negativo eso corre el flujo **~1,2 pt por espacio, acumulativo dentro del run**: medido contra la tinta, la séptima palabra de un renglón caía 9,0 pt a la derecha. No era el residuo del prorrateo — el renglón de al lado **empalma** y drifta igual—: eran **965 de 1560 palabras** de una pericia con tinta fuera de su caja por izquierda, más **13 cajas que no tocaban tinta alguna**. `Tw` pasa a entrar en el avance de los glifos que lo llevan, y **quién lo lleva lo dice `glyph.isSpace`**: PDF 32000-1 §9.3.3 lo restringe al código de un byte 32, así que un espacio de fuente compuesta no lo lleva — es la misma bandera con la que decide el renderer de pdf.js. Medido, el run de la fecha tiene 96 espacios y solo 7 con `isSpace`; tratarlos por igual dejaba la caja del topónimo y la de la fecha 58,3 pt a la izquierda, sobre papel en blanco. Se suman dos piezas: la alineación pasa a saltear también los espacios **del flujo** que la cadena no trae, y el origen se busca primero por el reportado y después por el corregido de ADR-068. Resultado: fuga por izquierda **965 → 7**, **1591 → 23**, **749 → 0**; cajas fuera de toda tinta **13 → 2**, **38 → 0**; y **ni una coordenada** cambia en los documentos sin `Tw`, fixtures incluidos. Ver §10, §12, §13 casos 47-48 y 51, §14.

> **Nota (v1.9.0, ADR-102, 2026-08-27 — el flujo de glifos es continuo por página)**: el empalme de ADR-097 §2 exigía que la cadena de un `TextItem` fuera **igual** a la de un run de `showText`. Medido sobre documentos reales, eso casi nunca pasa: **0,2 % en un cuento, 2,9 % en un fallo de 51 páginas, 27,4 % en una pericia**, contra 100 % en los fixtures — que salen de `pdf-lib` y escriben una operación por línea. La causa es que `getTextContent()` **re-segmenta el texto en fronteras propias**, distintas de las de dibujo, en una relación de muchos a muchos. Y el defecto seguía vivo: el gate visual sobre el PDF exportado de un expediente real mostró **cinco fugas en una sola página**, de uno a tres caracteres del original a la izquierda del token (`roadmap/Post_Hito10.8_Pendientes.md` §24). **El recorrido pasa a emitir una sola secuencia de glifos por página** —posición absoluta y avance de cada carácter, sin fronteras de run, porque las fronteras eran el problema— y `convertTextItemsToWords` ubica el item por su origen (0,05 pt, la tolerancia de ADR-068) y **alinea carácter a carácter**, salteando del lado de la cadena los espacios que pdf.js sintetiza. **La alineación es el guard**: medido, aflojar la tolerancia del origen no aumenta los empalmes, solo convierte "sin origen" en "no alinea" — el buscador encuentra el glifo equivocado y la alineación lo rechaza. Sin alineación queda el prorrateo de ADR-020 §1, intacto. Resultado: **89,3 % a 100 % en documentos reales**, 100 % en los fixtures. Ver §12, §13 casos 42-46, §14.

> **Nota (v1.8.0, ADR-097, 2026-08-27 — el avance de cada glifo reemplaza al ancho promedio)**: el prorrateo de ADR-020 §1 repartía un **ancho de glifo promedio uniforme** sobre una fuente proporcional, y el error se acumulaba a lo largo del `TextItem`: en `qa-stamp.pdf` la caja de `Juan` caía 8,25 pt a la derecha del primer glifo —que mide 6,0 pt— y el PDF exportado mostraba `Ju[HOMBRE 01]`. **La premisa de ADR-020 §1 queda superseded** (*"aceptable para el propósito de bbox de censura"*): una caja corrida 8 pt no tapa el dato. El mismo recorrido del operator list que ya piden ADR-065 §1 y ADR-066 §1 emite ahora una **tabla de avances acumulados por run de página**, y `convertTextItemsToWords` la usa cuando puede casar el item con su run **por cadena exacta + origen** (nunca posicional: `getTextContent()` intercala items sintéticos que no salen de ningún `showText`). Sin empalme, el prorrateo de ADR-020 §1 / ADR-063 §3 queda **intacto como camino de reserva**, así que el peor caso es el comportamiento de hoy. El camino de anotaciones no cambia. Medido: empalme 100 % sobre los 28 fixtures del repo y error de posición **cero** contra las métricas AFM de la fuente. Ver §12, §13 casos 42-45, §14.

> **Nota (v1.7.0, ADR-066, 2026-08-10 — el texto de las anotaciones se lee)**: `getTextContent()` extrae **solo el content stream**; el texto de una anotación vive en su *appearance stream* y era invisible para el motor. Pero `render-engine` **sí lo dibuja** (pdf.js lo hace por default) y el export es raster (ADR-009), así que el nombre y la fecha de una firma digital salían en claro en el PDF anonimizado. `parsePage` pasa a extraer los runs de texto entre `beginAnnotation`/`endAnnotation` del **mismo** operator list que ya pide la compuerta 1 de ADR-065 (costo nulo: `getOperatorList()` ya incluye anotaciones por default — 197 ops contra 103 con `DISABLE` en el documento medido). **Sin OCR**: es texto nativo y exacto. Tres trampas que el spec fija en §12: la transformación que ubica la anotación viaja en el **tercer argumento de `beginAnnotation`**, no como op `transform`; su pila debe ser **separada** de la de `save`/`restore` (no están balanceadas entre sí); y todo word extraído se **valida contra el `rect`** de la anotación, descartando con `warn` lo que caiga afuera. `BoundingBox` gana `rotation` (ADR-066 §6, supersede ADR-063 §5) y el motor la puebla — el ángulo ya lo derivaba ADR-063 §1 y lo descartaba. Ver §6, §12, §13 casos 28-33, §14, §15 ítem 24.

> **Nota (v1.6.0, ADR-065, 2026-08-09 — OCR de páginas con texto nativo parcial)**: `requiresOCR = words.length === 0` dejaba fuera de OCR a cualquier página con **una sola** palabra nativa. En un documento real, un sello de firma digital aportaba esa palabra y una imagen del 55% de la página —con el nombre de una persona adentro— nunca se escaneó: el dato se exportó sin anonimizar. El motor gana **dos compuertas** en `parsePage` (§12) que producen `PdfEngineOutput.ocrRegions`: la primera descarta con `getOperatorList()` toda página sin image XObjects (**3,7 ms**, el único costo que paga un documento de puro texto); la segunda mide el **mayor rectángulo vacío inscrito en cada imagen, normalizado por el área de esa imagen**, que es lo que separa un escaneo ya buscable (11-20%) de una imagen con texto oculto (102%). Se OCR-ea **la región, no la página**, y por construcción esa región no tiene texto nativo encima, así que la fusión (`fuseOcrRegion`, §6) concatena sin dedupe. `requiresOCR`, `textlessPages` y `sourceKind` **no cambian de semántica**. Ver §6, §10, §12, §13 casos 22-26, §14, §15 ítem 24.
**Estado de implementación**: Hito 2 cerrado (PRs #6, #7); hardening post-review vía ADR-020 (word-splitting, NFC, política de eventos, guard de `fuseOcrPage`, `parsePage` puro); migración a `PdfPool` cerrada en Hito 9 (ADR-035). Pendiente: PdfWorker real (PR12, Hito 10 — incluye la extracción de `fuseOcrPage` a función pura, ADR-041) y tests stress/cancel/perf en Hito 11.

> **Nota (ADR-063, 2026-08-09)**: la geometría de `Word` deja de derivarse solo de la traslación de la matriz (`transform[4]`/`[5]`) y pasa a usar la **matriz completa**. De `[a, b, c, d]` salen los versores de avance y de ascenso; el `BoundingBox` es la envolvente axis-aligned del paralelogramo del run, y el prorrateo por token de ADR-020 §1 se desplaza sobre el eje de avance en vez de sobre `x`. Motivo: un sello de firma vertical (matriz `[0, 16, -16, 0]`) producía una caja de 173×16 pt horizontal donde el texto real ocupa 16×173 pt vertical — cajas que no se solapan. **Para 0° la definición nueva se reduce exactamente a la anterior**, así que el texto horizontal no cambia de bbox y los snapshots no se regeneran. `BoundingBox` **no** cambia (sigue sin campo de rotación) y el orden de lectura `y`→`x` se conserva. Ver §12, §13 casos 18-21, §14.

> **Nota (ADR-055 §10, 2026-08-05)**: el paquete gana un segundo export puro, `decodePdfEngineOutput(value: unknown): PdfEngineOutput` (§6), y su error dedicado (§11). Motivo: `pdf-engine` es el único motor sin puerto interno de despacho —el `PdfWorker` corre el motor real completo (ADR-036 §3), no un kernel— así que el consumidor de su `COMPLETED.result` es el façade. El decoder lo escribe y exporta **este** motor, que es el que conoce el contrato de su worker (ADR-055 §8); el façade lo invoca host-side sobre un `dispatch<unknown>`, misma forma que `fuseOcrPage` (ADR-041). El motor, el worker y `PdfEngineOutput` **no cambian**: `process()` sigue devolviendo el tipo concreto y nadie lo decodifica en el camino in-process del propio motor.

> **Nota (ADR-041, 2026-07-22)**: `fuseOcrPage` deja de ser método de la clase y pasa a **función pura** exportada por el paquete — `(document, pageIndex, words) → Document`, síncrona, ejecutada host-side por el Orchestrator con su copia retenida. El motor **no retiene documentos** (se elimina el `Map` interno) y `releaseDocument` desaparece de la interfaz pública (ADR-020 §7 superseded). El guard de `requiresOCR` (ADR-020 §6) y la normalización NFC (ADR-020 §2) se preservan en la función.

---

## 1. Objetivo

Recibir un `ArrayBuffer` con un PDF binario y producir un `DocumentModel` con páginas, palabras y bounding boxes, identificando qué páginas carecen de texto y requieren OCR.

---

## 2. Responsabilidades

- Parsear el PDF con PDF.js en un Web Worker.
- Extraer `Word[]` (texto + `BoundingBox` + `confidence`) por página.
- Detectar páginas sin texto (`requiresOCR = true`).
- Fusionar palabras OCR que llegan vía `OCR_PAGE_FINISHED` en las páginas correspondientes.
- Extraer `DocumentMetadata` no sensible.
- Emitir `PAGE_PARSED` por página y `DOCUMENT_PARSED` al finalizar.
- Manejar PDFs protegidos pidiendo password vía `PDF_PASSWORD_REQUIRED`.
- Transferir zero-copy el `ArrayBuffer` del host al worker.

---

## 3. Fuera de alcance

- Hacer OCR (es tarea de `ocr-engine`).
- Detectar entidades (Regex/NER).
- Renderizar el PDF (es tarea de `render-engine`).
- Conocer React ni ningún framework de UI.
- Persistir el documento (FS, localStorage, network).
- Conservar metadata sensible (author, creator personal, XMP sensible).

---

## 4. Dependencias permitidas

- `@anonly/shared` (tipos, contratos, error codes)
- `pdfjs-dist` (justificado en ADR-001)
  - **Configuración de `getDocument()` (ADR-053 §5)**: además de `data`, `password` y el `useWorkerFetch: false` que ya lleva, la llamada configura `cMapUrl: "/pdfjs/cmaps/"` + `cMapPacked: true`, `standardFontDataUrl: "/pdfjs/standard_fonts/"` y **factories propias** de CMap y de standard fonts (las `DOM*` de pdf.js tocan `document.baseURI` en su primer fetch, y este motor corre dentro de un Worker). Motivo: sin CMaps, un PDF con fuentes CID de CMap predefinido se **extrae** con unicode incorrecto, y ese texto es la entrada de `regex-engine` y `ner-engine` — o sea que degrada la detección de entidades, no solo el dibujo. **No** lleva `disableFontFace`: esta ruta no rasteriza nada, así que el registro del `@font-face` le es indiferente (a diferencia de `render-engine`, ver la regla transversal de `05_Worker_Architecture.md` §7). Los dos prefijos son constantes nombradas del módulo, no config.
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `Word`, `BoundingBox`, `DocumentMetadata`
- `architecture/04_Event_System.md`: `PAGE_PARSED`, `DOCUMENT_PARSED`, `PDF_PASSWORD_REQUIRED`, `PDF_INVALID`, `OCR_PAGE_FINISHED` (escucha)

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor (`ocr-engine`, `regex-engine`, etc.)
- `tesseract.js`, `@huggingface/transformers`, `onnxruntime-web`, `pdf-lib`
- Node builtins (`fs`, `http`, etc.)
- Cualquier lib de network (`axios`, `fetch` wrapper, etc.)

---

## 6. Interfaces públicas

```ts
// PdfEngineConfig se define en core/Contracts.md §6 (source of truth) y se importa de @anonly/shared.
// Solo contiene maxPageCount; el timeout por página se lee de ctx.config.workerPool.timeouts["pdf-parse"]
// (default 30000, single source of truth, ver ADR-013).
export interface PdfEngineConfig {
  readonly maxPageCount: number;        // default 10000
}

export interface PdfEngineInput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;         // PDF binario, se transfiere (zero-copy) — en Hito 2 se trata como ArrayBuffer plano (ver §12)
  readonly password?: string;           // si el PDF está protegido
}

export interface PdfEngineOutput {
  readonly document: Document;
  readonly pageCount: number;
  readonly textlessPages: ReadonlyArray<number>; // índices que requieren OCR de página entera
  readonly sourceKind: "text" | "scanned" | "mixed";
  // ADR-065 §4: regiones a OCR-ear en páginas que SÍ tienen texto nativo (una
  // imagen cuyo interior ningún texto explica). Disjunto de textlessPages:
  // ningún pageIndex aparece en los dos. Como máximo una región por página
  // (ADR-065 §2). Vacío es el caso normal.
  readonly ocrRegions: ReadonlyArray<OcrRegion>;
}

export class PdfEngine implements IEngine {
  readonly id = EngineId.Pdf;
  init(ctx: EngineContext): Promise<void>;
  process(input: PdfEngineInput, ctx: EngineContext): Promise<PdfEngineOutput>;
  dispose(): Promise<void>;
}

// ADR-041: función pura y síncrona, sin instancia ni estado retenido. El caller
// (Orchestrator) provee el Document que él mismo retiene y persiste el resultado
// como copia canónica. Reemplaza al método PdfEngine.fuseOcrPage; releaseDocument
// desaparece con el Map interno (ADR-020 §7 superseded: sin retención no hay nada
// que evictar). Lanza InvalidInputError si pageIndex no existe o si la página
// tiene requiresOCR === false (guard ADR-020 §6).
// ADR-064: las `words` entrantes deben venir en PUNTOS DE PÁGINA, igual que
// las nativas (03_Data_Model.md §137). Esta función no reescala nada — no
// conoce el DPI del raster ni tiene por qué; la conversión px→pt es
// responsabilidad de `ocr-engine` (OCR_Engine.md §10).
export function fuseOcrPage(
  document: Document,
  pageIndex: number,
  words: ReadonlyArray<Word>,
): Document;

// ADR-065 §6: espejo INVERTIDO de fuseOcrPage, para el otro camino de OCR.
// Mismo perfil (pura, síncrona, host-side, el caller provee y persiste el
// Document), tres diferencias deliberadas:
//   1. Guard invertido: exige requiresOCR === false. Una página textless va
//      por fuseOcrPage; invocar la equivocada es un bug de wiring y lanza
//      InvalidInputError (mismo criterio que ADR-020 §6, al revés).
//   2. TRASLADA: las words llegan en puntos relativos al RECORTE (ADR-064
//      convierte px->pt, pero el origen sigue siendo el del recorte). Se les
//      suma region.x/region.y para llevarlas a coordenadas de página. Es el
//      único lugar que conoce esa traslación — por eso recibe `region`.
//   3. CONCATENA en vez de reemplazar: las palabras nativas se conservan, las
//      de OCR se suman, y se reordena por orden de lectura recalculando
//      Page.text. Seguro sin dedupe: la región es, por construcción de la
//      compuerta 2 (§12), área sin una sola palabra nativa encima.
// Marca ocrCompleted = true dejando requiresOCR intacto en false (ADR-065 §7:
// el invariante de 03_Data_Model.md §4 se relajó para admitir este caso).
export function fuseOcrRegion(
  document: Document,
  pageIndex: number,
  region: BoundingBox,
  words: ReadonlyArray<Word>,
): Document;

// ADR-055 §10: función pura, sin instancia ni estado. Verifica en RUNTIME que un
// valor que cruzó el PdfWorker tenga la forma de PdfEngineOutput, y lo devuelve
// tipado. La escribe este motor (es el que conoce el contrato de su worker,
// ADR-055 §8) y la invoca el façade, que es el único consumidor de ese resultado
// remoto — pdf-engine no tiene puerto interno de despacho que angostar.
// Verificación superficial y deliberada (§13 caso 17): los CINCO campos de
// PdfEngineOutput —incluido `ocrRegions` (ADR-065 §4)—, más que `document`
// tenga `id: string` y `pages: Array`. NO recorre words/bboxes de las páginas:
// correría por cada import sobre documentos de miles de páginas, y una
// corrupción parcial de ese nivel no es el modo de falla que ADR-055 cierra
// (un sobre con forma distinta lo es). `ocrRegions` SÍ se recorre elemento a
// elemento, igual que `textlessPages`: tiene a lo sumo una entrada por página
// (ADR-065 §2), o sea la misma clase de costo — la línea que traza ADR-055 es
// contra los datos no acotados por página, no contra los arrays en general.
// Ante cualquier otra forma LANZA InvalidInputError con details.receivedShape
// (§11). Devolver un default en silencio está prohibido (ADR-055 §3).
export function decodePdfEngineOutput(value: unknown): PdfEngineOutput;
```

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `PAGE_PARSED` | al finalizar parseo de una página | `PageParsed` | async | sí |
| `DOCUMENT_PARSED` | al finalizar todas las páginas | `DocumentParsed` | async | sí |
| `PDF_PASSWORD_REQUIRED` | PDF protegido sin password o password incorrecto | `PdfPasswordRequired` | async | sí |
| `PDF_INVALID` | no es un PDF válido o corrupto | `PdfInvalid` | async | sí |

Canal: `EventChannel.Pdf`.

**Política de señalización (ADR-020)**: todo error fatal de parseo emite su evento antes de lanzar. Los fallos de página interna (`PdfCorruptedError`) emiten `PDF_INVALID` con `reason` (no existe un evento `PDF_CORRUPTED` en el bus; el código de error sí distingue el caso, ver §11).

---

## 8. Eventos que consume

**El PDF Engine no se suscribe a ningún evento del bus** (preserva la invariante de `04_Event_System.md` §11; ver ADR-014). La fusión de palabras OCR es **mediada por el Orchestrator**:

1. `ocr-engine` emite `OCR_PAGE_FINISHED` (canal `ocr`); el `OcrPool` deposita las `Word[]` en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>`.
2. El **Orchestrator** (no el PDF Engine) escucha `OCR_PAGE_FINISHED`, lee las `Word[]` de `ctx.cache` e invoca la función pura `fuseOcrPage(document, pageIndex, words)` con el `Document` que él mismo retiene (ADR-041).
3. `fuseOcrPage` fusiona y devuelve un nuevo `Document` inmutable; el Orchestrator lo persiste como copia canónica. La ejecución es síncrona y host-side: no pasa por `PdfPool` ni por ningún worker (ADR-041 §3).

El PDF Engine **sólo emite** eventos (ver §7); no consume ninguno del bus. `fuseOcrPage` se testea con llamada directa (sin bus ni instancia del motor).

---

## 9. Entradas

```ts
PdfEngineInput {
  documentId: string;            // UUID v4, ya generado por el Orchestrator
  buffer: ArrayBuffer;           // PDF binario completo; se transfiere al worker
  password?: string;             // optional; si el PDF está protegido
}
```

**Restricciones**:
- `buffer.byteLength > 0`. Si `byteLength === 0`, lanza `PdfInvalidError`.
- `buffer` debe comenzar con `%PDF-`. Si no, lanza `PdfInvalidError`.
- `password` si se provee debe ser string no vacío.
- `documentId` debe ser único en la sesión.

**Si input es `null`/`undefined`**: lanza `InvalidInputError` (genérico).

---

## 10. Salidas

```ts
PdfEngineOutput {
  document: Document;            // inmutable, todas las props readonly
  pageCount: number;             // === document.pages.length
  textlessPages: ReadonlyArray<number>; // índices con requiresOCR = true
  sourceKind: "text" | "scanned" | "mixed";
}
```

- `document.pages[i].index === i` para todo `i`.
- `document.pages[i].words` está **agrupado en renglones** y, dentro de cada renglón, ordenado por `bbox.x` asc (ADR-110 §1). No hay una clave escalar de orden: el renglón es un grupo, no una coordenada.
- `textlessPages` está ordenado asc.
- `sourceKind === "scanned"` si todas las páginas son `requiresOCR`, `"text"` si ninguna, `"mixed"` si hay mix. **No lo afectan las `ocrRegions`** (ADR-065 §10): una página con texto nativo y una imagen con texto oculto *tiene* texto nativo, y `sourceKind` describe de dónde sale el texto de las páginas, no cuánto OCR se va a correr.
- `ocrRegions` está ordenado asc por `pageIndex`, tiene como máximo una entrada por página (ADR-065 §2) y **ningún `pageIndex` suyo aparece en `textlessPages`** (ADR-065 §4). Cada `bbox` está contenido en el rectángulo de la imagen que lo originó.

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `PDF_PASSWORD_REQUIRED` | `PdfPasswordRequiredError` | PDF protegido sin password o password incorrecto | sí | UI pide password, reintentar con `password` |
| `PDF_INVALID` | `PdfInvalidError` | no es PDF, header inválido, corrupto a nivel de documento (incl. `maxPageCount` excedido y errores desconocidos de `getDocument()`, ver ADR-020 §4) | no | abortar pipeline, informar al usuario |
| `PDF_CORRUPTED` | `PdfCorruptedError` | PDF.js lanza error de parseo en una página interna (`getPage`/`getTextContent`); aplica solo a este caso, nunca a fallos a nivel de documento (ADR-020 §4) | no | abortar pipeline |
| `PDF_TIMEOUT` | `PdfTimeoutError` | timeout por página excedido | sí (reintentar) | Hito 2 (inline): no reintenta, se propaga directo. Hito 9: retry es responsabilidad del `WorkerPool` (`maxRetries["pdf-parse"]`, ADR-020 §5); si persiste → `PDF_INVALID` |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `process` llamado antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `process` llamado tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined, buffer vacío, o `fuseOcrPage` sobre página con `requiresOCR === false` (ADR-020 §6) o con `pageIndex` inexistente (ADR-041), o `decodePdfEngineOutput` sobre una forma que no es `PdfEngineOutput` (ADR-055 §3/§10) | no | bug del caller; en el caso del decoder, un desajuste entre el `PdfWorker` y su consumidor → `failPipeline` |

**Sobre el error del decoder (ADR-055 §10)**: es `InvalidInputError` a secas —sin clase ni `EngineErrorCode` nuevos— por dos motivos. `PdfInvalidError`/`PDF_INVALID` sería **mentirle al usuario**: significa "tu archivo no es un PDF válido", cuando el archivo puede estar perfecto y lo roto ser el sobre del worker. Y a diferencia de `ner-engine` —que sí necesitó una subclase interna para distinguir "el sobre está roto, es sistémico" de un fallo tolerable de página— acá ningún caller discrimina: el façade manda todo lo que no es `PDF_PASSWORD_REQUIRED` ni cancelación a `failPipeline`, que es exactamente el fallo ruidoso que ADR-055 §3 pide. El `details` lleva `receivedShape` con la **forma** del valor (claves y tipos), nunca su contenido (`Code_Standards.md` §9: no loguear contenido del documento).

`retryable`: `PDF_TIMEOUT = true`, resto `false` — incluido `PDF_PASSWORD_REQUIRED` (errata ADR-035 §3: `retryable` significa auto-reintentable por el pool sin intervención del usuario; la recuperación por password es del flujo UI → `retryWithPassword`, no del flag). El fix del flag en `pdf.errors.ts` (`super(..., true, ...)` → `false`) es el **PR 17.1** de ADR-049 §4/§7: dejó de ser cosmético al llegar el transporte real de workers — el override `isRetryable` con el que el Orchestrator lo compensaba se apoyaba en un `instanceof` que no sobrevive al boundary, así que el pool reintentaba el PDF protegido (ADR-049, Contexto §3). El flag **sí** sobrevive; por eso corregirlo permite retirar el override.

---

## 12. Consideraciones de rendimiento

- **Hito 2**: corre inline en el host thread (sin `PdfPool`); cancelación vía `AbortSignal` con checkpoint por página.
- **Hito 9**: migra a `PdfPool` in-process (cola de concurrencia del `WorkerPoolManager`, ADR-035 §1); el despacho a Web Workers dedicados llega en el Hito 10 (ADR-035 §2). La interfaz pública (§6) no cambia entre los tres modos (ver ADR-013).
- Costo: 0.5–3 s por página con texto; 0.1–0.5 s por página vacía/escaneada.
- Memoria típica: 20–80 MB por PDF activo.
- `buffer` se **transfiere** al worker (zero-copy). El host pierde acceso al buffer. En Hito 2 (inline) el `buffer` se trata como `ArrayBuffer` plano; no implementar lógica de `Transferable.consume()` hasta Hito 9 (sería dead code inline).
- Streaming: `PAGE_PARSED` se emite por página, no al final. La UI puede mostrar páginas a medida que se parsean.
- Tamaño de lote recomendado: 1 página por job (granularidad de cancelación óptima). El pool despacha en paralelo respetando `pdfPoolSize` (aplica desde Hito 9; en Hito 2 el procesamiento es secuencial por página con checkpoint).
- El `PDFDocumentProxy` se destruye al finalizar cada `process()` (ADR-020 §8; reemplaza el hint de reuse por `documentId` que documentaba esta sección — obsoleto en el modelo inline, nunca implementado, y descartado por riesgo de leak sin beneficio).
- Los `TextItem` que devuelve PDF.js se dividen por whitespace en `Word`s individuales. El desplazamiento y el ancho de cada token salen del **flujo continuo de glifos de la página** (ADR-102 §1), alineado carácter a carácter contra `item.str` desde el glifo que coincide con el origen reportado (ADR-102 §2). Cuando la alineación no llega hasta el final, el avance se **prorratea linealmente** por longitud de caracteres respecto del `TextItem` original (ADR-020 §1, camino de reserva de ADR-102 §4). En los dos casos el desplazamiento corre sobre el **eje de avance** del run, no sobre `x` (ADR-063 §3): para texto horizontal las dos formulaciones son idénticas.
- **Avance de un glifo del flujo (ADR-097 §1, `Tw` por ADR-108 §1)**: `((ancho/1000)·Tfs + Tc + (glyph.isSpace ? Tw : 0))·Th`, con `Tfs`/`Tc`/`Tw`/`Th` el estado gráfico vigente y el resultado escalado a unidades de página por la matriz compuesta. En un documento con `Tw = 0` el término vale cero y no cambia una sola coordenada, que es lo que hace seguro el cambio para todo lo que ya estaba bien.
  - **Quién lleva `Tw` lo decide `glyph.isSpace`, no `unicode === " "`.** PDF 32000-1 §9.3.3 lo restringe al código de **un byte** 32: en una fuente compuesta, el espacio de dos bytes no lo lleva. pdf.js ya resuelve esa distinción y **su propio renderer decide con esa bandera** (`(glyph.isSpace ? wordSpacing : 0) + charSpacing`), así que espejarla es usar la misma línea que dibuja la tinta contra la que se mide. Medido: el run de la fecha de la pericia tiene **96 espacios y solo 7 con `isSpace`**; tratarlos por igual corría la caja **58,3 pt** y la dejaba sobre papel en blanco, con el dato entero a la vista (ADR-108 §3).
  - Omitir `Tw` del todo corría el flujo **~1,2 pt por espacio, acumulativo dentro del run y reseteado en el run siguiente**: sobre el encabezado de una pericia, la primera palabra caía +0,9 pt y la séptima +9,0. **ADR-097 §4 queda superseded**; su §1 (esta aritmética), §3 (el prorrateo como reserva) y §5 (la instrumentación del empalme) siguen.
  - Nunca se aplica al espacio que pdf.js **sintetiza** cuando el productor separa palabras moviendo el cursor: ese no es un glifo del flujo. Es correcto por definición, y significa que dos documentos con el mismo texto y distinta técnica de separación no comparten camino.
- **Alineación tolerante a los espacios (ADR-102 §2, simetría por ADR-108 §2)**: un espacio de la cadena que el flujo no tiene se saltea **del lado de la cadena** (el que pdf.js sintetizó, caso 46); un espacio del flujo que la cadena no tiene se saltea **del lado del flujo** (caso 48). Si tras saltear tampoco casa, el cursor vuelve a donde estaba y rige la regla de siempre. El salteo no imputa el avance del espacio a ningún token. **No debilita el guard**: todo carácter visible sigue exigiendo su glifo exacto en orden, y lo único que se vuelve tolerante es la cantidad de espacios, que es justamente donde las dos segmentaciones no coinciden.
- **Geometría del bbox (ADR-063 §1-§2, extensión vertical por ADR-109 §1)**: se deriva de la matriz completa `[a, b, c, d, e, f]` de PDF.js, no solo de la traslación. `dir = (a, b)/|(a, b)|` es el versor de avance y `up = (c, d)/|(c, d)|` el de ascenso; `item.width` es el avance total del run y `item.height` el cuerpo, **medidos sobre esos ejes**. El `BoundingBox` es la envolvente axis-aligned del paralelogramo `(e, f) − up·|descent|·cuerpo → +dir·width → +up·(ascent + |descent|)·cuerpo`, convertida a origen arriba-izquierda con `y = pageHeight - yMax`. Es **exacta** para 0°/90°/180°/270° y **conservadora** (cubre de más) para ángulos arbitrarios.
  - `ascent` y `descent` salen de `styles[item.fontName]` de la misma llamada a `getTextContent()`. **Sin métricas utilizables** —item sin `fontName`, `fontName` ausente de `styles`, o métricas degeneradas (`ascent ≤ 0` o `descent ≥ 0`)— la caja se arma como antes de ADR-109: `(e, f) → +dir·width → +up·cuerpo`. Es el mismo criterio de reserva que el prorrateo de ADR-102 §4: el peor caso es el statu quo. Relevado sobre 10 documentos (4266 items), la reserva aplica a **2** — la fuente del código de barras de la carátula de dos pericias.
  - El camino de anotaciones (ADR-066 §1) reconstruye sus runs del operator list y **no tiene `styles`**, así que cae siempre en la reserva y conserva su geometría. Su oráculo de solapamiento contra el `rect` (ADR-066 §3) queda intacto por construcción.
- El texto rotado no es un caso exótico: los sellos de firma digital, marcas de agua y folios laterales de expedientes judiciales se dibujan a 90° sobre el margen, y aparecen en **todas** las páginas del documento (ADR-063, Contexto §3). El `BoundingBox` de esos words lleva `rotation` (ADR-066 §6): el ángulo sale de los mismos versores que ya calcula la geometría, y solo se puebla para 0/90/180/270 — en un ángulo arbitrario queda ausente y el pintado es horizontal (ADR-066 §8).
- **Texto de anotaciones (ADR-066 §1-§4)**, del mismo operator list de la compuerta 1:
  - Se extraen los runs `showText`/`showSpacedText` que caen entre `beginAnnotation` y `endAnnotation`, reconstruyendo el string desde el campo `unicode` de cada glifo. Los `Word` llevan `source: "pdf"` (es texto nativo) y se suman a los de `getTextContent()`. **No hay duplicado**: `getTextContent()` no lee appearance streams, así que las dos fuentes son disjuntas por construcción.
  - **La cadena de composición es `textMatrix × transformInterno × beginAnnotation.transform × CTM`.** El tercer argumento de `beginAnnotation` es la transformación que ubica la anotación en la página y **no** llega como op `transform`; ignorarla manda todo el texto al origen de la página (verificado: los cinco runs de la firma medida caen en `y = 0` en vez de dentro de su rect).
  - **`textMatrix` NO se puebla solo desde `setTextMatrix`** (ADR-066 §2, corrección). La regla completa es `Trm = [Tfs·Th, 0, 0, Tfs, 0, Ts] × Tm × CTM` (PDF 32000-1 §9.4.4): `Tm` se mantiene desde `setTextMatrix` **y** desde los operadores de posicionamiento (`Td`, `TD`, `T*` con su interlineado `TL`), y el cuerpo (`Tfs`, de `Tf`) y el escalado horizontal (`Th`, de `Tz`) se aplican como factores sobre las magnitudes. `Tfs`/`Th` son estado gráfico: `save`/`restore` los preservan. Un appearance stream **aplanado** trae el cuerpo en la escala de `Tm` (`setTextMatrix [8,0,0,8,…]` + `setFont [f,1]`); el idioma **normal** lo trae en `Tf` y la posición en `Td` (`setFont [f,8]` + `moveText [0,42.66]`, sin ningún `Tm`). Soportar solo la primera forma deja al documento real con cuerpo 1, avances 8 veces cortos y todos los runs apilados en el mismo origen — medido: los 26 words de la firma en `x = 59,0` con 1 pt de ancho, contra `x = 9,3…48,4` con cuerpo 8.
  - **La pila de `beginAnnotation` es independiente de la de `save`/`restore`.** Las dos anidaciones no están balanceadas entre sí; compartir una sola pila desincroniza el CTM (verificado: produce `x = -679`, fuera de la página).
  - **El `rect` del segundo argumento de `beginAnnotation` es el oráculo**, y la prueba es de **solapamiento, no de contención estricta**: la intersección del bbox del word con el `rect` debe ser **≥ 50% del área del word**. El que no llega, se **descarta con `warn`** — si la composición falló, la posición no es confiable, y una caja negra mal puesta destruye contenido y esconde el error (ADR-066 §3). **La contención estricta NO sirve**: el versor de ascenso extiende la caja del glifo más allá de la línea de base, y el `rect` está ajustado a la tinta visible, así que un word legítimo se sale una fracción de punto (medido: 0,66 pt sobre la firma real, que con contención estricta se descartaba entera). El word real solapa 91,8%; los dos modos de falla de composición dan 0% o marginal.
  - Se leen todas las anotaciones con texto **salvo** las marcadas `Hidden`/`NoView`: lo que no se dibuja no puede filtrarse por el export. **No** se filtra por `subtype` (ADR-066 §4). *Nota de implementación*: el motor **no** tiene código propio para ese filtro — lo hereda de `pdf.js`, que no emite `beginAnnotation` para una anotación no visible (`annotation.mustBeViewed(...)` aguas arriba de `getOperatorList()`). El invariante se cumple, pero por composición y no por un guard local; el test de `edge.test.ts` lo fija.
  - El walker de imágenes de la compuerta 1 aplica **el mismo** `transform` de `beginAnnotation` (ADR-066 §5): sin eso, una imagen dentro de una anotación se ubica mal.
- **Corrección del origen por word spacing (ADR-068; alcance acotado por ADR-108 §3)**: `getTextContent()` aplica el word spacing (`Tw`) a los espacios que después **descarta** del `str`. Para un run con espacios iniciales y `Tw ≠ 0` el `transform` reportado queda a la izquierda del glifo real — medido sobre la pericia: `190,20` reportado contra `248,5` de tinta, **58,3 pt**. El `width` sí es correcto. Del mismo recorrido del operator list sale, por cada `showText`/`showSpacedText` **de página**, el par `from` (origen que reportará `getTextContent()`, avance **con** `Tw`) y `to` (el que dibuja el renderer, **sin** `Tw`); `convertTextItemsToWords` corrige un item **solo si** su origen coincide con un `from` dentro de 0,05 pt. Sin coincidencia el item queda intacto: un documento sin `Tw` no cambia en nada, y si pdf.js arregla el defecto la corrección se desactiva sola. De este recorrido no sale ni una palabra — el texto sigue viniendo de `getTextContent()`.
  - **No toca la búsqueda del origen**: `findGlyphAt` usa el origen **reportado**, no el corregido (ADR-102 §2), y tiene que seguir así — el flujo aplica `Tw` a los espacios iniciales igual que `getTextContent`, así que los dos coinciden y por eso el item se ubica.
  - **Desde ADR-108 §4 es también el segundo intento de la búsqueda**: `start = findGlyphAt(reportado) ?? findGlyphAt(corregido)`. `getTextContent` aplica `Tw` a **todo** espacio y el flujo solo a los que lo llevan, así que en un run con espacios iniciales de fuente compuesta el origen reportado no cae sobre ningún glifo — y el corregido sí, porque es justamente "dónde dibuja el renderer". Para que caiga **exacto**, la rama "sin word spacing" de `leadingAdvance` usa la misma regla de `isSpace` que el flujo, en vez de restarle `Tw` a todo espacio.
- **Orden de lectura (ADR-110 §1, runs rotados por ADR-067)**, en `sortWordsByReadingOrder` — la única función que fija el orden de `Page.words` y, con él, el de `Page.text`:
  - Los `Word` con `bbox.rotation` **ausente o `0`** se **agrupan en renglones**, y dentro de cada renglón se ordenan por `bbox.x` asc. El agrupado recorre los words pre-ordenados por **centro vertical** (y `x` como desempate) y va acumulando: un word entra al renglón vigente si `|centro(w) − medianaCentro(renglón)| < LINE_BAND_RATIO × medianaAlto(renglón)`; si no, abre uno nuevo. **`LINE_BAND_RATIO = 0,5`**, barrido contra siete configuraciones (ADR-110 §2): es el único valor que reproduce exacto el orden de lectura del OCR, y el óptimo no es el intuitivo — a 0,6 el `TRIBUNAL` de la columna izquierda se mete dentro de `PROVINCIA DE BUENOS AIRES`.
  - **Una página sin texto rotado produce el array idéntico palabra por palabra** al previo a ADR-110, así que el snapshot no se regenera. Verificado antes de implementar sobre 109 páginas y 30.886 palabras de diez documentos, fixtures del repo incluidos (§13 caso 54); si cambia, el cambio rompió texto horizontal.
  - **No hay comparador con tolerancia.** El pre-orden por centro vertical es un orden **total** —sin tolerancia, por lo tanto transitivo— y el agrupado es un recorrido codicioso determinista. Esa era la causa estructural del defecto: `a ≈ b` y `b ≈ c` no implican `a ≈ c`, así que `Array.sort` con un comparador con tolerancia devolvía un resultado dependiente de su secuencia interna de comparaciones (ADR-067 §4 lo documentó para los runs rotados; ADR-110 §4 lo mide para el caso general).
  - **La mediana del renglón, no su envolvente ni el promedio.** Una caja de OCR ruidosa —medido: 22,1 pt contra 13,9 pt del mismo renglón impreso— ensancharía la banda y se tragaría el renglón siguiente. La mediana la absorbe.
  - **No se segmenta en columnas.** Se prototipó y se descartó por medición (ADR-110 §3): con la banda en 0,5 las columnas caen en renglones distintos, así que el corte por hueco horizontal nunca se dispara — barrido de 0,8 a 4,0 cuerpos y también desactivado, los resultados son idénticos.
  - El orden **entre runs rotados** no cambia: sigue comparando el ancla por `bbox.y` con `compareByReadingOrder` (ADR-067 §3), y los runs siguen emitiéndose en una pasada aparte después de todo el texto horizontal.
  - Los words con `rotation` 90/180/270 se agrupan en **runs**: misma coordenada transversal —`bbox.x` para 90/270, `bbox.y` para 180— con tolerancia 1, **y** contiguos sobre el eje de avance con hueco ≤ **2 cuerpos** (`bbox.width` para 90/270, `bbox.height` para 180). Los dos criterios hacen falta: en la firma medida, la marca de agua y el run `Date:` comparten columna con 1,1 pt de diferencia y solo el corte por hueco (30 cuerpos contra los 0,44-0,58 de un espacio real) los separa.
  - Dentro de un run el orden es el del **avance**: `y` descendente en 90 (el texto sube en pantalla), `y` ascendente en 270, `x` descendente en 180. Ordenar por `y` ascendente invierte el run — es el defecto que ADR-067 corrige.
  - Los runs se emiten en una **pasada aparte, después de todo el texto horizontal**: `Page.words` es `[…horizontal…, …runs…]`, con dos `sort` independientes (los runs entre sí, por el bbox de su primera palabra en orden de lectura). La contigüidad del run es lo que necesita el detector: sin ella, `Echeverria, Marta de los Mercedes` llegaba a NER como `… Mercedes … los … de … Marta … Echeverria,` intercalado con los otros cuatro runs de la firma.
  - **Un run NUNCA se intercala en el texto horizontal.** Ubicarlo por su ancla dentro del mismo `sort` parte una línea al medio: el comparador tiene tolerancia 1 y no es transitivo, así que un ancla que cae dentro de la tolerancia de una palabra de la línea pero fuera de la de otra se encaja entre las dos. Como `mapSpanToWords` une el rango de índices completo de un match, el bbox de la entidad partida se traga el run entero — medido sobre la pericia de 5 páginas: una ocurrencia en `x = 250` salía en `x = 10`. Con las pasadas separadas, el orden del texto horizontal es **idéntico** al previo a ADR-067 en cualquier página, tenga o no texto rotado.
  - `ocr-engine` **no** se toca: sus words nunca llevan `rotation` (`OCR_Engine.md` §10), así que la rama nueva no los alcanza.
- `Word.text` y, por lo tanto, `Page.text`, se normalizan a NFC (invariante `03_Data_Model.md` §4; ADR-020 §2).
- **Compuertas de OCR por región (ADR-065 §1)**, dentro de `parsePage`, después de construir las `Word`:
  - **Compuerta 1 — ¿hay imágenes?** De `page.getOperatorList()` se toman los ops `paintImageXObject`, `paintImageMaskXObject` y `paintInlineImageXObject`; simulando `save`/`restore`/`transform` se compone la CTM vigente en cada uno, y aplicándola al cuadrado unidad sale el rectángulo de esa imagen en puntos de página. **`paintJpegXObject` no existe** en `pdfjs-dist` 4.10.38 (las JPEG salen por `paintImageXObject`); las variantes agrupadas y repetidas del optimizador de pdf.js —`paintImageXObjectRepeat`, `paintImageMaskXObjectGroup`, `paintImageMaskXObjectRepeat`, `paintInlineImageXObjectGroup`, `paintSolidColorImageMask`— quedan **fuera de alcance** por decisión explícita: su modo de falla es un falso negativo idéntico al comportamiento previo a ADR-065 (ver la errata de ADR-065 §1). Una página sin ninguno de esos ops **termina acá**, sin rasterizar ni cargar Tesseract. Costo medido: **3,7 ms de media** en páginas sin imágenes (`pdfjs-dist` 4.10.38) → ~0,7 s en 200 páginas, contra los 160 s del presupuesto de `07_Performance_Strategy.md` §1.
  - **Filtro por rectángulo**: se descarta toda imagen de área **< 1% de la página**, aplicado **por rectángulo y nunca sobre el agregado**, para que varios logos chicos no sumen hasta cruzar el umbral.
  - **Compuerta 2 — ¿esa imagen tiene texto encima?** Sobre una grilla de 64×64 celdas se marcan las celdas de la imagen y las de los `bbox` de las palabras nativas **dilatados** 0,5× del cuerpo del glifo en horizontal y 0,8× en vertical (la dilatación evita que el interlineado cuente como hueco). Dentro de cada imagen se busca el **mayor rectángulo vacío axis-aligned** (histograma + pila, O(GRID²)). Es región candidata si su área es **≥ 40% del área de esa imagen** y sus **dos lados miden ≥ 100 pt**.
  - El rectángulo se **clampea al rect de la imagen** antes de emitirse: la cuantización de la grilla lo hace desbordar (102-103% en la calibración).
  - Si una página tiene más de una candidata se emite **solo la mayor** (ADR-065 §2).
  - La métrica está normalizada **por el área de la imagen, no de la página**: es lo que separa un escaneo con capa OCR previa (11-20%) de una imagen con texto oculto (102%). Dos métricas más simples —área de imagen sin texto, y mayor región contigua— se probaron primero y **fallan** sobre el escaneo ya buscable (ADR-065, Contexto §2).
- **Preparación para Hito 9 (normativa)**: `parsePage(pdfDoc, documentId, pageIndex, timeoutMs)` es una función pura a nivel de módulo, sin supuestos host/worker. Devuelve `ParsePageResult { page: Page; ocrRegionBbox?: BoundingBox }` desde ADR-065: las compuertas corren adentro (necesitan el `pageProxy` que la función ya obtuvo **y** las `Word` que acaba de construir, así que separarlas en un helper obligaría a exponer el proxy o a pagar un `getPage` de más). **`ParsePageResult` es interno**: no se exporta ni aparece en §6 — la superficie pública que este spec fija es la de esa sección, y ahí `PdfEngineOutput` es lo que cambia. Lo que el mandato de ADR-013 §6 exige de `parsePage` es pureza y portabilidad host/worker, no un tipo de retorno literal; las dos se conservan (Hito 9 la envuelve en un job del worker sin modificarla). La emisión de eventos (`PAGE_PARSED`, `DOCUMENT_PARSED`) queda en el engine (host), no en el worker. No buildar lógica de `Transferable.consume()` en Hito 2.

---

## 13. Casos límite

1. **PDF vacío (0 páginas)**: `process` retorna con `pageCount = 0`, `textlessPages = []`, `sourceKind = "text"`. Emite `DOCUMENT_PARSED` con `pageCount = 0`.
2. **PDF con 1000 páginas**: procesa en paralelo (respetando pool size). Emite 1000 `PAGE_PARSED`. Memoria pico gestionada por LRU del `PDFDocumentProxy` (pdfjs descarta páginas procesadas).
3. **PDF protegido con password correcto**: parseo normal.
4. **PDF protegido con password incorrecto**: lanza `PdfPasswordRequiredError`. El caller reintenta con password correcto.
5. **Página sin texto**: `requiresOCR = true`, `words = []`, `text = ""`. Se agrega a `textlessPages`.
6. **PDF corrupto (header inválido)**: lanza `PdfInvalidError` sin parsear nada.
7. **PDF corrupto (página interna inválida)**: lanza `PdfCorruptedError` indicando `pageIndex`.
8. **PDF con metadata sensible (author, XMP)**: se extrae solo `DocumentMetadata` no sensible; el resto se descarta.
9. **PDF con forms (AcroForm)**: `metadata.hasForms = true`. Forms no se parsean a `Word[]` (se ignoran; el export no los replica).
10. **PDF con JavaScript embebido**: `process` lo ignora. No se ejecuta. No se replica en export.
11. **PDF con 100 páginas todas escaneadas**: `sourceKind = "scanned"`, `textlessPages = [0..99]`.
12. **Buffer ya transferido (consumido)**: lanza `InvalidInputError` con detalles (Hito 9; inline es indistinguible de buffer vacío → `PdfInvalidError`).
13. **`process` llamado tras `dispose`**: lanza `EngineDisposedError`.
14. **`fuseOcrPage` sobre página con texto nativo** (`requiresOCR === false`): lanza `InvalidInputError`; la fusión OCR solo aplica a páginas textless (ADR-020 §6; función pura desde ADR-041 — el caso "documento no encontrado" desapareció, el caller provee el `Document`).
15. **`fuseOcrPage` con `pageIndex` fuera de rango**: lanza `InvalidInputError` con `details: { pageIndex }` (ADR-041).
16. **`decodePdfEngineOutput` sobre un `PdfEngineOutput` válido** (la forma que postea `worker/entry.ts` y la que devuelve `process()` in-process — son la **misma**, este motor no envuelve el resultado en ningún sobre): lo devuelve tal cual, sin copiarlo ni normalizarlo.
17. **`decodePdfEngineOutput` sobre cualquier otra forma** (`null`, `undefined`, un string, `[]`, `{}`, un objeto al que le falta un campo o le sobra con el tipo equivocado, o un `{ output: {...} }` que envuelva el resultado): lanza `InvalidInputError` con `details.receivedShape`. La verificación es superficial por diseño (§6): valida los **cinco** campos de `PdfEngineOutput` —incluido `ocrRegions`, recorrido elemento a elemento (`pageIndex: number` y un `bbox` de cuatro números), igual que `textlessPages` y por el mismo motivo: está acotado a una entrada por página (ADR-065 §2)— y que `document` tenga `id: string` y `pages: Array`, pero **no** recorre `words`/`bbox` de las páginas — un `document.pages` con elementos corruptos adentro pasa el decoder. Es deliberado: el modo de falla que ADR-055 cierra es el sobre de forma distinta, no la corrupción campo a campo, y un walk profundo correría por cada import sobre documentos de miles de páginas (§12).
18. **`TextItem` rotado 90°/180°/270°** (matriz del tipo `[0, s, -s, 0, e, f]`): el bbox tiene `width` y `height` intercambiados respecto de `item.width`/`item.height`, con el origen en la envolvente del paralelogramo (ADR-063 §2). Los tokens de un run multi-palabra se desplazan sobre el eje de avance, no sobre `x` (ADR-063 §3).
19. **`TextItem` con rotación arbitraria** (p. ej. 45°, marca de agua diagonal): el bbox es la envolvente axis-aligned de los cuatro vértices — cubre **más** área que los glifos. Deliberado: para censura, cubrir de más nunca deja un dato expuesto (ADR-063 §2).
20. **`TextItem` con matriz degenerada** (`a = b = 0`, o `c = d = 0`): no se divide por cero; el versor correspondiente cae al comportamiento horizontal (`dir = (1, 0)` / `up = (0, 1)`).
21. **`TextItem` horizontal** (matriz `[s, 0, 0, s, e, f]`): el bbox es **idéntico** al que producía la fórmula previa a ADR-063. Es la garantía de no regresión del cambio, no un caso nuevo de comportamiento (ADR-063 §2).
22. **Página sin ningún image XObject**: `ocrRegions` no gana entradas y la compuerta 2 no corre. Es el caso de toda página born-digital y el que mantiene el costo del OCR por región en 3,7 ms (ADR-065 §1).
23. **Página con un logo o membrete chico** (< 1% del área de página): descartado por el filtro de tamaño antes de medir nada. El logo de 37×37 pt de la calibración da 0,27%.
24. **Página escaneada con capa OCR previa** (imagen a página completa + texto nativo distribuido encima): **no** produce región. Es el falso positivo caro —dispararlo metería un OCR de página entera en cada página de un expediente escaneado— y la calibración lo deja en 11% (márgenes normales) y 20% (márgenes anchos), contra un umbral de 40% (ADR-065, Contexto §3).
25. **Página con texto nativo y una imagen grande sin texto encima**: produce una región, clampeada al rect de la imagen. Es el caso que motivó ADR-065: 102% de la imagen en el documento real.
26. **Página con dos imágenes candidatas**: se emite **solo la de mayor rectángulo vacío** (ADR-065 §2). La segunda queda sin escanear — fuga conocida y aceptada, no una regresión: antes de ADR-065 no se escaneaba ninguna.
27. **`fuseOcrRegion` sobre página con `requiresOCR === true`**: lanza `InvalidInputError`. Esa página va por `fuseOcrPage` (página entera); invocar la función equivocada es un bug de wiring (ADR-065 §6, espejo del caso 14).
28. **Anotación con texto** (p. ej. un `Widget`/`Sig` de firma digital): produce `Word`s con `source: "pdf"`, sumados a los de `getTextContent()` sin duplicarse. Es el caso que motivó ADR-066: el nombre y la fecha del firmante salían en claro en el export.
29. **Anotación cuyo `transform` de `beginAnnotation` se ignora**: los words caen en el origen de la página, fuera del `rect`, y el guard del caso 31 los descarta. Es el modo de falla que ADR-066, Contexto §3 documenta como ya ocurrido dos veces al medir.
30. **Anotación con `save`/`restore` desbalanceados respecto de `beginAnnotation`/`endAnnotation`**: no corrompe el CTM del resto de la página — las dos pilas son independientes (ADR-066 §2).
31. **Word extraído cuyo solapamiento con el `rect` es < 50% de su área**: se descarta con `warn`; no entra en `Page.words` y no se recorta al rect (ADR-066 §3). **Un word que se sale una fracción de punto NO se descarta**: la caja del glifo se extiende desde la línea de base por el ascenso y el `rect` está ajustado a la tinta, así que el texto real de la firma medida se sale 0,66 pt y solapa 91,8% — con contención estricta se perdían los cinco runs.
32. **Anotación con flag `Hidden` o `NoView`**: no produce words. Lo que no se dibuja no puede filtrarse por el export (ADR-066 §4).
33. **Imagen dentro de una anotación**: la compuerta 1 la ubica aplicando el `transform` de `beginAnnotation` (ADR-066 §5). Sin eso quedaría en coordenadas de página y la compuerta 2 la evaluaría contra el área equivocada.
34. **Página sin ningún word rotado**: el orden de lectura es literalmente el previo a ADR-067, palabra por palabra. Es la garantía de no regresión que fija el snapshot.
35. **Varios runs rotados paralelos y solapados en `y`** (los cinco de una firma digital): cada uno sale íntegro y contiguo en `Page.text`, no intercalado (ADR-067 §2, §4). Es el caso que motivó el ADR: sin esto el nombre del firmante no produce grupo de Persona.
36. **Dos runs rotados en la misma columna, separados por un hueco > 2 cuerpos** (marca de agua arriba, firma abajo): quedan como dos runs. Con la tolerancia transversal sola se fusionarían — están a 1,1 pt (ADR-067 §2).
37. **Run rotado de un solo word**: es un run válido de un elemento y, como cualquier run, sale después del texto horizontal — nunca en el medio de una línea.
41. **Run de página con espacios iniciales y `setWordSpacing` distinto de cero**: el `Word` se ubica en el origen que dibuja el renderer, no en el que reporta `getTextContent()` (ADR-068). Sin `Tw`, o si el origen reportado no coincide con ninguna corrección, el item queda intacto.
40. **Anotación cuyo appearance stream posiciona con `Tf` + `Td` en vez de `Tm`** (el idioma normal de PDF, y el que usa el documento original): produce los mismos `Word` que la forma aplanada. Soportar solo `Tm` deja cuerpo 1, avances 8 veces cortos y todos los runs en el mismo origen (ADR-066 §2, corrección).
39. **Run rotado cuya ancla cae entre dos palabras de la misma línea horizontal** (la marca de agua del margen y una línea del cuerpo, a menos de 1 pt de diferencia en `y`): el run **no** parte la línea. Es la regresión medida sobre la pericia de 5 páginas — con el run intercalado, el bbox de `La Plata` arrancaba 240 pt a la izquierda de donde está el texto (ADR-067 §4, corrección).
38. **Word con `rotation: 0` explícito**: se ordena por la rama horizontal, junto a los que no tienen el campo (`Contracts.md` §5, ausente ≡ 0).
42. **Item multi-palabra alineado con el flujo de glifos**: el origen y el ancho de cada token salen de los glifos reales (ADR-102 §2). Es el caso que motivó todo esto: con el prorrateo, `Juan` caía 8,25 pt a la derecha de su primer glifo y el export mostraba `Ju[HOMBRE 01]`.
43. **Item cuya cadena no alinea con el flujo** (`/ActualText`, normalización agresiva) **o cuyo origen no se ubica**: **no** se empalma y el item usa el prorrateo de ADR-020 §1. El bbox es el de siempre; la divergencia se cuenta en el log de empalme (ADR-097 §5), no como error.
46. **Item con espacios que pdf.js SINTETIZÓ** (el productor separó palabras moviendo el cursor, sin dibujar un glifo de espacio): la alineación los saltea **del lado de la cadena** y sigue. Es el caso mayoritario en documentos reales — el que hacía fallar al empalme por cadena exacta de ADR-097 §2, y con él al 97 % de los items de un fallo judicial.
44. **Item de una sola palabra**: no pasa por el reparto —ni por avances ni por prorrateo— porque su envolvente es el run entero. Era ya exacto antes de ADR-097 y sigue igual.
45. **Run con una ligadura** (un glifo cuyo `.unicode` tiene más de un carácter): el avance completo se imputa al **primer** carácter y los siguientes repiten el acumulado, de modo que `advances.length === str.length + 1` y ningún token arranca dentro de la ligadura (ADR-097 §1).
47. **Run con `setWordSpacing` distinto de cero** (ADR-108 §1): cada glifo de espacio del flujo avanza `Tw × Th` de más respecto de la aritmética previa, y como el flujo acumula posiciones desde el origen del run, la corrección crece con cada espacio. Sobre el encabezado de una pericia con `Tw` negativo eso son ~1,2 pt por espacio: la primera palabra corregía 0,9 pt y la séptima 9,0. **Con `Tw = 0` no cambia ninguna coordenada** — es la garantía de no regresión del caso.
48. **Item cuya cadena tiene MENOS espacios que el flujo** (el productor dibujó dos espacios donde pdf.js reporta uno): la alineación los saltea **del lado del flujo** y sigue (ADR-108 §2). Es el espejo del caso 46, y era el modo de falla del 100 % de los items que no alineaban después de ADR-102 — `«de julio»` cortando en la `j`, con un espacio de más en el flujo.
51. **Run cuyos espacios iniciales son de fuente compuesta** (una línea centrada con espacios, `isSpace: false`): esos espacios **no** llevan `Tw` aunque `Tw ≠ 0`, y el item se ubica por el origen corregido de ADR-068 porque el reportado —que sí se los aplica— no cae sobre ningún glifo. Medido sobre la pericia: 96 espacios en el run, 7 con `isSpace`, **58,3 pt** de diferencia; tratándolos por igual la caja del topónimo y la de la fecha caen sobre papel en blanco (ADR-108 §1/§3/§4).
49. **Item con métricas de fuente utilizables** (ADR-109 §1): la caja va de `base − |descent|·cuerpo` a `base + ascent·cuerpo`. Es el caso normal: 4264 de 4266 items relevados sobre 10 documentos. Antes de ADR-109 la caja arrancaba en la línea de base y las descendentes quedaban afuera en **una de cada tres palabras**.
50. **Item sin métricas utilizables** (sin `fontName`, `fontName` ausente de `styles`, o `ascent ≤ 0` / `descent ≥ 0`): la caja es la previa a ADR-109, `base` … `base + cuerpo`. Relevado: 2 items de 4266, los dos la fuente del código de barras de una carátula. El camino de anotaciones (ADR-066 §1) cae siempre acá, porque reconstruye sus runs del operator list y no tiene `styles` que consultar.
52. **Dos columnas cuyos renglones se intercalan en vertical** (el encabezado de un fallo escaneado: la línea de la derecha abarca en `y` a las dos de la izquierda): cada frase sale **contigua** en `Page.text`, porque el agrupado por banda las separa en renglones distintos (ADR-110 §1). Con el comparador previo salían intercaladas —`PROVINCIA DE AIRES BUENOS Y RECURSO APELLIDO, DE TRIBUNAL…`— y la envolvente de la entidad cubría las dos columnas.
53. **Una palabra con la caja mucho más alta que sus vecinas de renglón** (ruido de OCR: 22,1 pt contra 13,9 pt en el mismo renglón impreso): **no** ensancha la banda ni se traga el renglón siguiente, porque la banda usa la **mediana** de los altos del renglón y no su envolvente (ADR-110 §1).
54. **Página de texto nativo de una sola columna**: el orden es **idéntico** al previo a ADR-110, palabra por palabra — incluida una línea con dos cuerpos distintos. Es la garantía de no regresión del cambio, medida sobre 109 páginas y 30.886 palabras antes de implementarlo.
55. **Dos columnas separadas por un hueco horizontal grande** (ADR-113 §1): el renglón se **corta** donde la separación con la palabra anterior supera 3 cuerpos. Sobre el sello medido, los huecos entre palabras de una frase van de 2,4 a 13 pt y el que separa las columnas es de 113,5 — un orden de magnitud, a diferencia de la banda vertical, que en ese mismo encabezado se decide por centésimas. El umbral está barrido: de 2 a 10 cuerpos el resultado es el mismo.
56. **Un renglón que el acumulado repartió entre dos** (ADR-113 §2): dos trozos **pegados en ** (hueco menor a 3 cuerpos) que comparten banda vuelven a ser un renglón, y el unido se emite en la posición del más temprano. La adyacencia es la condición, no el solapamiento:  termina en 339,2 y  empieza en 343,2 — se tocan, no se solapan, y una versión que fusionaba por solapamiento no arreglaba nada.
57. **Un renglón con un hueco grande entre dos palabras** que no son columnas distintas: se corta igual, y los trozos se emiten de izquierda a derecha porque conservan la posición del renglón que los contenía. Es la no regresión del corte.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Hito | Descripción |
|---|---|---|---|---|
| `emits PAGE_PARSED for each page` | `contract.test.ts` | contract | 2 | valida un `PAGE_PARSED` por página |
| `emits DOCUMENT_PARSED after all pages` | `contract.test.ts` | contract | 2 | valida `DOCUMENT_PARSED` al final |
| `output has pageCount === pages.length` | `contract.test.ts` | contract | 2 | invariante |
| `pages[i].index === i` | `contract.test.ts` | contract | 2 | invariante |
| `words sorted by y then x` | `unit.test.ts` | unit | 2 | orden de lectura |
| `reading order is unchanged for a page without rotated text` | `unit.test.ts` | unit | 10.8 | ADR-067 §1: no regresión, caso 34 |
| `a 90° run comes out in advance order, not reversed` | `unit.test.ts` | unit | 10.8 | ADR-067 §3 |
| `parallel rotated runs stay contiguous in Page.text` | `unit.test.ts` | unit | 10.8 | ADR-067 §2/§4, caso 35 |
| `two runs in the same column split on the advance gap` | `unit.test.ts` | unit | 10.8 | ADR-067 §2, caso 36 |
| `rotation 270 orders by y asc and 180 by x desc` | `unit.test.ts` | unit | 10.8 | ADR-067 §3 |
| `moves the word to the origin the renderer draws, not the reported one` | `unit.test.ts` | unit | 10.8 | ADR-068 §1/§2, caso 41 |
| `leaves the origin untouched when there is no word spacing` | `unit.test.ts` | unit | 10.8 | ADR-068 §2: no regresión |
| `leaves an item untouched when its origin matches no correction` | `unit.test.ts` | unit | 10.8 | ADR-068 §2: el guard |
| `places a mid-item token at its real advance, not the prorated one` | `unit.test.ts` | unit | 11 | ADR-097 §1/§2, caso 42 |
| `falls back to the prorated advance when the item string differs` | `unit.test.ts` | edge | 11 | ADR-097 §3, caso 43: el guard |
| `falls back when the item origin matches no run` | `unit.test.ts` | edge | 11 | ADR-097 §2, caso 43 |
| `imputes a ligature's full advance to its first character` | `unit.test.ts` | edge | 11 | ADR-097 §1, caso 45 |
| `leaves a single-word item on the run envelope` | `unit.test.ts` | unit | 11 | ADR-097, caso 44: no regresión |
| `ubica cada palabra de la línea en su posición AFM exacta` | `advances-real-pdf.test.ts` | integración | 11 | ADR-097: `pdfjs-dist` sin mockear, oráculo AFM |
| `cubre el primer glifo de \`Juan\`, que es lo que se veía en el export` | `advances-real-pdf.test.ts` | integración | 11 | ADR-097: la fuga de §23e |
| `a space glyph advances by Tw on top of its own width` | `unit.test.ts` | unit | 11 | ADR-108 §1, caso 47 |
| `the drift accumulates across spaces, not across glyphs` | `unit.test.ts` | unit | 11 | ADR-108 §1: el mecanismo, con dos espacios y tres tokens |
| `a run with Tw = 0 yields byte-identical bboxes` | `unit.test.ts` | unit | 11 | ADR-108 §1: la garantía de no regresión, caso 47 |
| `Tw applies to the leading spaces of a run too` | `unit.test.ts` | unit | 11 | ADR-108 §1: la variante que las exceptúa mide diez veces peor |
| `aligns an item whose string has fewer spaces than the flow` | `unit.test.ts` | unit | 11 | ADR-108 §2, caso 48 |
| `still rejects an item whose visible characters do not match` | `unit.test.ts` | edge | 11 | ADR-108 §2: el guard no se debilita |
| `un espacio de fuente compuesta no lleva Tw` | `unit.test.ts` | unit | 11 | ADR-108 §1/§4, caso 51 |
| `un espacio de fuente simple sí lo lleva, en la misma posición` | `unit.test.ts` | unit | 11 | ADR-108 §1: el contraste que fija la regla |
| `the box spans from the font descent to its ascent` | `unit.test.ts` | unit | 11 | ADR-109 §1, caso 49 |
| `falls back to the em box when the font metrics are degenerate` | `unit.test.ts` | edge | 11 | ADR-109 §2, caso 50 |
| `an annotation run keeps the em box` | `unit.test.ts` | edge | 11 | ADR-109 §2: el camino de ADR-066 §1 no tiene `styles` |
| `two interleaved columns keep each phrase contiguous` | `unit.test.ts` | unit | 11 | ADR-110 §1, caso 52 |
| `a much taller box does not swallow the next line` | `unit.test.ts` | unit | 11 | ADR-110 §1, caso 53: la mediana, no la envolvente |
| `single-column native text keeps its previous order` | `unit.test.ts` | unit | 11 | ADR-110, caso 54: no regresión, con dos cuerpos en la misma línea |
| `the grouping is deterministic regardless of input order` | `unit.test.ts` | unit | 11 | ADR-110 §1: el pre-orden es total, no un comparador con tolerancia |
| `rotated runs keep ordering by the anchor's y` | `unit.test.ts` | unit | 11 | ADR-110 §4: ADR-067 §3 no se toca |
| `a column gap keeps the two columns of a stamp apart` | `unit.test.ts` | unit | 11 | ADR-113 §1, caso 55 — con la geometría real del sello medida sobre el escaneo |
| `a line the accumulator split in two is put back together` | `unit.test.ts` | unit | 11 | ADR-113 §2, caso 56 — falla si la reunión se hace por solapamiento en vez de por adyacencia |
| `two words separated by a wide gap on the same line stay in reading order` | `unit.test.ts` | unit | 11 | ADR-113 §1, caso 57 — la no regresión del corte |
| `a run positioned with Tf + Td yields the same bbox as the flattened Tm form` | `unit.test.ts` | unit | 10.8 | ADR-066 §2 (corrección), caso 40 |
| `two runs positioned with Td land at different origins` | `unit.test.ts` | unit | 10.8 | ADR-066 §2 (corrección): sin `Td` se apilaban en el mismo origen |
| `a rotated run never splits a horizontal line` | `unit.test.ts` | unit | 10.8 | ADR-067 §4 (corrección), caso 39 — la regresión de `La Plata` |
| `horizontal order is identical with and without rotated text` | `unit.test.ts` | unit | 10.8 | ADR-067 §4 (corrección): garantía de no regresión del texto horizontal |
| `emits the runs after all horizontal text, ordered among themselves` | `unit.test.ts` | unit | 10.8 | ADR-067 §4 (corrección) |
| `explicit rotation 0 sorts with the horizontal branch` | `edge.test.ts` | edge | 10.8 | ADR-067 §1, caso 38 |
| `single-word rotated run` | `edge.test.ts` | edge | 10.8 | ADR-067, caso 37 |
| `fuseOcrRegion preserves native rotated runs` | `unit.test.ts` | unit | 10.8 | ADR-067 §6 |
| `textlessPages sorted asc` | `unit.test.ts` | unit | 2 | invariante |
| `sourceKind = scanned when all textless` | `edge.test.ts` | edge | 2 | caso límite 11 |
| `sourceKind = text when none textless` | `edge.test.ts` | edge | 2 | caso base |
| `sourceKind = mixed` | `edge.test.ts` | edge | 2 | mixto |
| `throws PdfPasswordRequiredError on protected without password` | `edge.test.ts` | edge | 2 | caso 4 (requiere `protected.pdf`, ver §15) |
| `throws PdfPasswordRequiredError on wrong password` | `edge.test.ts` | edge | 2 | caso 4 (requiere `protected.pdf`, ver §15) |
| `PdfPasswordRequiredError is not retryable` | `edge.test.ts` | edge | 2 | ADR-049 §4 (`retryable === false`; el flag es lo único que el pool ve tras el boundary) |
| `parses protected pdf with correct password` | `edge.test.ts` | edge | 2 | caso 3 (requiere `protected.pdf`, ver §15) |
| `throws PdfInvalidError on empty buffer` | `edge.test.ts` | edge | 2 | buffer vacío |
| `throws PdfInvalidError on non-pdf buffer` | `edge.test.ts` | edge | 2 | header inválido |
| `throws PdfInvalidError on corrupt header` | `edge.test.ts` | edge | 2 | caso 6 |
| `throws PdfCorruptedError on internal page corruption` | `edge.test.ts` | edge | 2 | caso 7 |
| `metadata excludes author and XMP sensitive` | `edge.test.ts` | edge | 2 | caso 8 |
| `hasForms = true for AcroForm pdf` | `edge.test.ts` | edge | 2 | caso 9 |
| `ignores embedded JavaScript` | `edge.test.ts` | edge | 2 | caso 10 |
| `0 pages document returns cleanly` | `edge.test.ts` | edge | 2 | caso 1 |
| `fuseOcrPage merges words correctly` | `contract.test.ts` | contract | 2 | integración con OCR (llamada directa, sin bus; función pura desde ADR-041) |
| `dispose releases PDFDocumentProxy` | `contract.test.ts` | contract | 2 | limpieza |
| `process after dispose throws` | `edge.test.ts` | edge | 2 | caso 13 |
| `DocumentModel snapshot stable (3-page deterministic in-memory fixture, 1 textless)` | `snapshot.test.ts` | snapshot | 2 | fixture estable, sin binario |
| `splits multi-word TextItems into individual words with prorated bboxes` | `unit.test.ts` | unit | 2 | ADR-020 §1 |
| `normalizes word text to NFC` | `unit.test.ts` | unit | 2 | ADR-020 §2 |
| `throws PdfTimeoutError with documentId when page parse exceeds timeout` | `unit.test.ts` | unit | 2 | ADR-020 §5 (bug de `documentId` vacío) |
| `throws PdfInvalidError when page count exceeds maxPageCount` | `edge.test.ts` | edge | 2 | ADR-020 §3 |
| `throws PdfInvalidError on empty password string` | `edge.test.ts` | edge | 2 | ADR-020 §3 |
| `emits PDF_INVALID before throwing on fatal parse errors` | `edge.test.ts` | edge | 2 | ADR-020 §3, §4 |
| `fuseOcrPage on non-OCR page throws InvalidInputError` | `contract.test.ts` | contract | 2 | caso 14; ADR-020 §6 (función pura desde ADR-041) |
| `engine never subscribes to the bus (ADR-014)` | `contract.test.ts` | contract | 2 | ratifica ADR-014 |
| `fuseOcrPage on unknown pageIndex throws InvalidInputError` | `unit.test.ts` | unit | 10 | caso 15 (ADR-041; reemplaza al test de `releaseDocument`, eliminado con el método — ADR-020 §7 superseded) |
| `decodePdfEngineOutput returns a valid PdfEngineOutput unchanged` | `unit.test.ts` | unit | 10 | caso 16 (ADR-055 §10); identidad referencial, no copia |
| `decodePdfEngineOutput accepts the exact shape PdfWorker posts` | `unit.test.ts` | unit | 10 | ADR-055 §5 (paridad remoto/in-process): el valor lo produce el mismo helper que arma el `COMPLETED.result` del entry-point, no un literal escrito a mano. Es el test que se pondría rojo el día que alguien envuelva el resultado en un sobre |
| `decodePdfEngineOutput throws InvalidInputError on garbage` | `edge.test.ts` | edge | 10 | caso 17 (ADR-055 §3): `null`, `undefined`, `"x"`, `42`, `[]`, `{}` |
| `decodePdfEngineOutput throws on missing or mistyped fields` | `edge.test.ts` | edge | 10 | caso 17: falta `document`/`pageCount`/`textlessPages`/`sourceKind`, `sourceKind` fuera del union, `pages` no-array, `document.id` no-string |
| `decodePdfEngineOutput throws on an enveloped result` | `edge.test.ts` | edge | 10 | caso 17: `{ output: <válido> }` — la regresión concreta de ADR-055 (Contexto §1) trasladada a PDF |
| `decodePdfEngineOutput error details carry shape, never content` | `edge.test.ts` | edge | 10 | `Code_Standards.md` §9: `receivedShape` lista claves y tipos, nunca texto del documento |
| `rotated 90 TextItem yields a swapped bbox` | `unit.test.ts` | unit | 10.8 | caso 18 (ADR-063 §2): matriz `[0, s, -s, 0, e, f]` → `width = item.height`, `height = item.width`, origen en la envolvente |
| `rotated 180 and 270 TextItems yield the correct envelope` | `unit.test.ts` | unit | 10.8 | caso 18 (ADR-063 §2) |
| `horizontal TextItem bbox is unchanged by the matrix-aware formula` | `unit.test.ts` | unit | 10.8 | caso 21 (ADR-063 §2): garantía de no regresión — el test que se pone rojo si el cambio tocó texto horizontal |
| `prorated tokens of a rotated run advance along the writing axis` | `unit.test.ts` | unit | 10.8 | caso 18 (ADR-063 §3): en un run a 90°, `x` constante y `y` decreciente token a token |
| `arbitrary rotation yields an envelope containing all four corners` | `unit.test.ts` | unit | 10.8 | caso 19 (ADR-063 §2): 45°, envolvente conservadora |
| `degenerate transform matrix does not divide by zero` | `edge.test.ts` | edge | 10.8 | caso 20 |
| `page without image XObjects yields no ocr regions` | `unit.test.ts` | unit | 10.8 | caso 22 (ADR-065 §1): la compuerta 2 no corre |
| `image smaller than 1 percent of the page is discarded` | `unit.test.ts` | unit | 10.8 | caso 23 (ADR-065 §1): filtro por rectángulo, no sobre el agregado |
| `full-page image covered by native text yields no region` | `unit.test.ts` | unit | 10.8 | caso 24 (ADR-065, Contexto §3): el falso positivo caro |
| `large image with no native text yields a clamped region` | `unit.test.ts` | unit | 10.8 | caso 25 (ADR-065 §1): región contenida en el rect de la imagen |
| `page with two candidate images yields only the largest` | `unit.test.ts` | unit | 10.8 | caso 26 (ADR-065 §2) |
| `ocrRegions and textlessPages are disjoint` | `contract.test.ts` | contract | 10.8 | invariante de ADR-065 §4 |
| `fuseOcrRegion translates words by the region origin and concatenates` | `unit.test.ts` | unit | 10.8 | ADR-065 §6: suma `region.x`/`region.y`, conserva las nativas, reordena |
| `fuseOcrRegion on a textless page throws InvalidInputError` | `unit.test.ts` | unit | 10.8 | caso 27 (ADR-065 §6): guard invertido |
| `decodePdfEngineOutput throws on a malformed ocrRegions` | `edge.test.ts` | edge | 10.8 | caso 17 (ADR-065 §4): falta el campo, no es array, un elemento sin `pageIndex: number`, o con `bbox` incompleto/no-numérico |
| `annotation text runs become words inside the annotation rect` | `unit.test.ts` | unit | 10.8 | caso 28 (ADR-066 §1-§2): con el `transform` medido, origen (17.34, 60) y `rotation: 90` |
| `ignoring the beginAnnotation transform pushes words out of the rect` | `unit.test.ts` | unit | 10.8 | caso 29 (ADR-066 §2): fija el error de composición que ya ocurrió al medir |
| `annotation stack is independent from the save/restore stack` | `unit.test.ts` | unit | 10.8 | caso 30 (ADR-066 §2) |
| `words outside the annotation rect are dropped with a warning` | `edge.test.ts` | edge | 10.8 | caso 31 (ADR-066 §3): solapamiento < 50% del área del word; no se recortan al rect |
| `a word overhanging the rect by a fraction of a point is kept` | `edge.test.ts` | edge | 10.8 | caso 31: el `rect` real `[10,60,60,560]` con el run medido — se sale 0,66 pt y solapa 91,8%. Es el test que se pone rojo si alguien vuelve a la contención estricta |
| `hidden annotations produce no words` | `edge.test.ts` | edge | 10.8 | caso 32 (ADR-066 §4) |
| `image inside an annotation is placed with the annotation transform` | `unit.test.ts` | unit | 10.8 | caso 33 (ADR-066 §5) |
| `bbox rotation is populated only for right angles` | `unit.test.ts` | unit | 10.8 | ADR-066 §6/§8: ausente en horizontal, `90` a 90°, ausente en un ángulo arbitrario |
| `1000 pages document completes within memory budget` | `stress.test.ts` (en `tests/stress/`) | stress | 11 | caso 2; pendiente, requiere `huge-1000p.pdf` (LFS) |
| `cancel aborts within 200ms` | `cancel.test.ts` (en `tests/cancel/`) | cancel | 11 | SLA; pendiente, requiere `PdfPool` + `AbortRegistry` (Hito 9) |

**Fixtures**: los binarios `.pdf` siguen el patrón definido en `tests/fixtures/README.md` (source of truth: PDFs < 5 MB commiteados en `tests/fixtures/`, ≥ 5 MB a Git LFS en Hito 11; `generate.ts` ya commiteado en Hito 1). Estado actual en Hito 2: commiteados `text-10p.pdf`, `empty.pdf`, `corrupt.pdf` (generados por `generate.ts`); `protected.pdf` pendiente (Hito 2b, requiere `qpdf`); `huge-1000p.pdf` y resto pendientes Hito 11. Los tests **unit / contract / edge / snapshot** (Hito 2) mockean la frontera `pdfjs-dist` (deterministas, sin wasm, sin dependencia de binarios físicos — consistente con `tests/fixtures/README.md`). Los tests **stress / cancel / perf** (Hito 11) usarán PDFs reales generados por `generate.ts`. `generate.ts` debe saber producir: `text-10p`, `scanned-10p`, `protected` (password "test1234"), `corrupt`, `empty`, `text-50p`, `huge-1000p`, `mixed-30p`.

---

## 15. Checklist de implementación

> **Estado Hito 2 (cerrado en PRs #6, #7)**: items 1–4, 5a, 6, 7 (con mediación de Orchestrator, ver ADR-014), 8, 9 (sólo emisión; suscripción consumida por Orchestrator), 10–17.
>
> **Pendiente**: item 18 (cancelación con SLA estricto → Hito 11); item 20 (ADR-041 → PR12, Hito 10). El item 7 originalmente describía `fuseOcrPage` como escucha del bus; el wiring quedó en el Orchestrator (ver ADR-014 y §8), y desde ADR-041 la firma es la función pura de §6 (los items 7, 8 y 19 describen el estado histórico previo).

- [x] 1. Crear paquete `packages/anonymization-core/pdf-engine/` con `package.json` y `tsconfig.json` extends base.
- [x] 2. Definir `types.ts` con `PdfEngineConfig`, `PdfEngineInput`, `PdfEngineOutput`.
- [x] 3. Definir `errors.ts` con `PdfPasswordRequiredError`, `PdfInvalidError`, `PdfCorruptedError`, `PdfTimeoutError`.
- [x] 4. Implementar `pdf.engine.ts` respetando `IEngine` y la firma pública de §6.
- [x] 5a. (Hito 2) Implementar `init` (cargar pdfjs-dist inline en host, sin `PdfPool`).
- [x] 5b. (Hito 9) Migrar `init` a `PdfPool` cuando `WorkerPoolManager` exista. **Cerrado en Hito 9** (pools in-process, ADR-035; MVP.md §4). El despacho a Web Worker real llega en PR12 (ADR-036, ADR-041).
- [x] 6. Implementar `process` con `AbortSignal`, `PAGE_PARSED` por página, `DOCUMENT_PARSED` al final. En Hito 2 el `buffer` se trata como `ArrayBuffer` plano (sin transferencia zero-copy; ver §12 y ADR-013).
- [x] 7. Implementar `fuseOcrPage` (firma intacta de §6; la escucha de `OCR_PAGE_FINISHED` y la lectura de `ctx.cache` quedan en el Orchestrator — ver ADR-014 y §8).
- [x] 8. Implementar `dispose` (libera `PDFDocumentProxy` y limpia el cache interno de documentos).
- [x] 9. Cablear eventos **emitidos** contra `IEventBus` (`PAGE_PARSED`, `DOCUMENT_PARSED`, `PDF_PASSWORD_REQUIRED`, `PDF_INVALID`). PDF Engine no se suscribe a ningún evento del bus (§8).
- [x] 10. Escribir `contract.test.ts` con los tests contractuales de §14 correspondientes a Hito 2.
- [x] 11. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [x] 12. Escribir `edge.test.ts` con los casos límite de §13 correspondientes a Hito 2.
- [x] 13. Escribir `snapshot.test.ts` con `DocumentModel` de fixture determinista en memoria (3 páginas, 1 textless).
- [x] 14. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` y verificar verde.
- [x] 15. Verificar que `index.ts` exporta solo `PdfEngine`, `PdfEngineConfig`, `PdfEngineInput`, `PdfEngineOutput` y los errores.
- [x] 16. Verificar que ninguna dependencia prohibida aparece en imports (`grep -r 'react\|tesseract\|onnx\|pdf-lib' src/`).
- [x] 17. Verificar `no-network-from-core`: ningún `fetch`/`XMLHttpRequest`/`WebSocket` en `src/`, salvo el `fetch()` same-origin de las factories de CMap/standard-fonts (`/pdfjs/cmaps/`, `/pdfjs/standard_fonts/`), sancionado por ADR-053 §2.
- [ ] 18. (Hito 9/11) Verificar test de cancelación < 200 ms — requiere `PdfPool` + `AbortRegistry`. En Hito 2 se valida cancelación cooperativa inline (checkpoint por página) sin SLA estricto.
- [x] 19. Hardening post-review (ADR-020): word-splitting, NFC, política de eventos, guard de `fuseOcrPage`, `releaseDocument`, `parsePage` puro.
- [x] 20. (Hito 10, PR12 — ADR-041) Extraer `fuseOcrPage` a función pura exportada (§6: sin `Map` interno, sin asserts de instancia, síncrona; conserva guard ADR-020 §6, validación de `pageIndex` y NFC); eliminar `releaseDocument` y el estado por documento del engine; adaptar los tests de fusión (casos 14–15 de §13, filas de §14) y `tests/integration/ocr-pdf-fusion.test.ts`.
- [x] 21. (Hito 10, PR 17.1 — ADR-049 §4) `PdfPasswordRequiredError`: segundo argumento del `super(...)`, `true` → `false` (§11). Fila nueva en §14. Debe mergearse **antes** del PR 17.2 del façade, que retira el override `isRetryable` que hoy lo compensa.
- [x] 22. (Hito 10.8, paso 1 — ADR-063) `convertTextItemsToWords`: derivar la geometría de la matriz completa (§12). Versores de avance/ascenso desde `[a, b, c, d]`, bbox como envolvente axis-aligned del paralelogramo, prorrateo del token sobre el eje de avance. **No** tocar `BoundingBox` (sin campo de rotación, ADR-063 §5), **no** tocar el orden de lectura (ADR-063 §4) y **no** regenerar el snapshot de `snapshot.test.ts`: si cambia, el cambio rompió texto horizontal. Casos 18-21 de §13 y seis filas nuevas en §14.
- [x] 23. (Hito 10.8, paso 2 — ADR-065) Compuertas 1 y 2 en `parsePage` (§12) produciendo `PdfEngineOutput.ocrRegions` (§6, §10), y `fuseOcrRegion` como export puro nuevo (§6). **No** tocar `requiresOCR`, `textlessPages` ni `sourceKind` (ADR-065 §10). El `OcrRegion` de `@anonly/shared` es precondición (`Contracts.md` §5). Casos 22-27 de §13 y ocho filas nuevas en §14.
- [x] 24. (Hito 10.8, paso 3 — ADR-066) Lectura del texto de anotaciones en `parsePage` (§12): runs entre `beginAnnotation`/`endAnnotation`, composición `textMatrix × transformInterno × beginAnnotation.transform × CTM`, **pila de anotación separada** de la de `save`/`restore`, validación contra el `rect` descartando con `warn`, exclusión de `Hidden`/`NoView`. Poblar `bbox.rotation` (solo 0/90/180/270). Corregir el walker de la compuerta 1 para que aplique el mismo `transform` (§5). El `BoundingBox.rotation` de `@anonly/shared` es precondición (`Contracts.md` §5). Casos 28-33 de §13 y siete filas nuevas en §14.

- [x] 25. (Hito 10.8, paso 4 — ADR-067) `sortWordsByReadingOrder`: agrupar los words con `bbox.rotation` 90/180/270 en runs (columna con tolerancia 1 **y** hueco de avance ≤ 2 cuerpos), ordenarlos en su dirección de avance y emitirlos en una **pasada aparte, después de todo el texto horizontal** — nunca intercalados (§12, ADR-067 §4 y su corrección). La rama sin rotación **no cambia** y el snapshot de `snapshot.test.ts` **no se regenera**. **No** tocar `ocr-engine` (ADR-067 §5) ni `fuseOcrPage`/`fuseOcrRegion`, que heredan el orden sin cambios (§6). Casos 34-39 de §13 y once filas nuevas en §14.

- [x] 26. (Hito 10.8, paso 5 — ADR-068) En el mismo recorrido del operator list, emitir por cada `showText`/`showSpacedText` **de página** el par `from`/`to` del origen cuando `Tw ≠ 0` y el run tiene espacios iniciales; `convertTextItemsToWords` corrige un item solo si su origen coincide con un `from` (§12). **No** tocar `item.width` ni el prorrateo de ADR-020 §1. El snapshot **no se regenera**. Caso 41 de §13 y tres filas nuevas en §14.

- [ ] 27. (Hito 11 — ADR-108) `appendRunGlyphs`: sumar `text.wordSpacing` al avance de los glifos con **`glyph.isSpace === true`**, no de todo `unicode === " "` (§12, ADR-108 §1). `alignToGlyphs`: saltear del lado del flujo los glifos de espacio que la cadena no trae, devolviendo el cursor si aun así no casa (ADR-108 §2). `leadingAdvance`: su rama "sin word spacing" usa la misma regla de `isSpace`, para que `to` caiga sobre el glifo. Y buscar el origen **primero por el reportado y después por el corregido** (ADR-108 §4). **No** ampliar la tolerancia de 0,05 pt de `findGlyphAt`: quedó **descartado por medición** (ADR-108 §3). El snapshot **no se regenera**: ningún fixture del repo usa `Tw`. Casos 47-48 y 51 de §13 y ocho filas nuevas en §14.
- [ ] 28. (Hito 11 — ADR-109) La caja de una palabra pasa a ir del descenso al ascenso de su fuente, con `ascent`/`descent` de `styles[item.fontName]` y reserva a la caja previa cuando las métricas no sirven (§12, ADR-109 §1/§2). Va **después** del ítem 27: sin él el corrimiento horizontal tapa el defecto vertical y el gate visual no distingue cuál de los dos se arregló. En dos pasos verificables por separado dentro del mismo PR: **(a)** el texto horizontal pasa a ordenarse por `bbox.y + bbox.height` —no-op demostrable sobre la geometría de hoy—; **(b)** la caja nueva. `REPLACEMENT_FONT_HEIGHT_RATIO` baja a 0,64 en `shared` en el mismo cambio (`Contracts.md` §6, ADR-109 §4). **No** tocar el orden entre runs rotados (ADR-067 §3), ni el camino de anotaciones, ni `ocr-engine`. Casos 49-50 de §13 y seis filas nuevas en §14. **El snapshot no se mueve**, y no porque el cambio sea inocuo: su fixture en memoria no declara `styles` y cae en la reserva de ADR-109 §2 — ver el ítem 29.
- [x] 31. (Hito 11 — ADR-113) `groupIntoLines`: después del acumulado por banda —que **no se toca**— cortar cada renglón donde el hueco horizontal supere `COLUMN_GAP_RATIO = 3` cuerpos, y después volver a unir los trozos **pegados** (hueco menor a ese mismo umbral) cuyo centro caiga dentro de la banda del otro, midiendo las dos cosas contra el **menor** de los dos altos medianos. La reunión es por **adyacencia**, no por solapamiento. **No** tocar la rama rotada de ADR-067, ni `ocr-engine`, ni `fuseOcrPage`/`fuseOcrRegion`. El snapshot **no se regenera**: el texto nativo es idéntico, verificado sobre 110 páginas y 30.959 palabras antes de implementar. Casos 55-57 de §13 y tres filas nuevas en §14.

- [ ] 30. (Hito 11 — ADR-110) `sortWordsByReadingOrder`: la rama **horizontal** deja de ordenarse con un comparador y pasa a agrupar en renglones (pre-orden total por centro vertical, banda `|centro − medianaCentro| < LINE_BAND_RATIO × medianaAlto`) y a ordenar por `x` dentro de cada renglón. `compareByBaseline` **desaparece** con el mecanismo (ADR-109 §3 superseded); `compareByReadingOrder` **se conserva** para el ancla de los runs rotados. **No** segmentar en columnas: descartado por medición (ADR-110 §3). **No** tocar la rama rotada de ADR-067, ni `ocr-engine`, ni `fuseOcrPage`/`fuseOcrRegion`. El snapshot **no se regenera**: el orden del texto nativo es idéntico, verificado sobre 109 páginas antes de implementar. Casos 52-54 de §13 y cinco filas nuevas en §14.
- [ ] 29. (Hito 11 — ADR-109, hueco de cobertura) El fixture de `snapshot.test.ts` no declara `styles`, así que el camino de la caja de tinta no queda cubierto por ninguna snapshot. Hacer que lo declare y regenerar. **Va en su propio PR**: mezclar el rediseño del fixture con el cambio que se está verificando deja sin oráculo a los dos.

---

## Referencias

- `architecture/06_Pipeline.md` §3 (etapa 1, extracción)
- `architecture/05_Worker_Architecture.md` §7.1 (PdfWorker)
- `architecture/08_Security_Model.md` §5 (strip metadata)
- `adr/ADR-001-Framework.md` (pdfjs-dist)
- `adr/ADR-003-Workers.md` (pools)
- `adr/ADR-013-PDF-Engine-Hito2-Inline.md` (ejecución inline, `parsePage` puro)
- `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md` (`fuseOcrPage`, PDF Engine no se suscribe al bus)
- `adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md` (word-splitting, NFC, política de eventos, guard `fuseOcrPage`, `releaseDocument`, `parsePage` puro)
- `adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md` (orden de lectura con runs rotados; supersede ADR-063 §4)
- `adr/ADR-068-Origen-De-Run-Corrido-Por-Word-Spacing.md` (corrección del origen que reporta `getTextContent()`)
- `adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md` (`fuseOcrPage` función pura host-side, motor sin estado por documento, `releaseDocument` eliminado)
- `adr/ADR-063-Bbox-De-Texto-Rotado.md` (geometría del bbox desde la matriz completa; riesgo latente de solapamiento en §6; discrepancia abierta de rotación de página en §7)
- `adr/ADR-064-Palabras-De-OCR-En-Puntos.md` (precondición de espacio de coordenadas de las `words` que entran a `fuseOcrPage`/`fuseOcrRegion`)
- `adr/ADR-065-OCR-Por-Region.md` (compuertas de OCR por región, `ocrRegions`, `fuseOcrRegion`)
- `adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md` (lectura del texto de anotaciones, `bbox.rotation`; supersede ADR-063 §5)
- `adr/ADR-102-El-Flujo-De-Glifos-Es-Continuo-Por-Pagina.md` (flujo continuo por página y alineación carácter a carácter; supersede el mecanismo de ADR-097 §1/§2)
- `adr/ADR-108-El-Avance-De-Un-Espacio-Incluye-El-Word-Spacing.md` (`Tw` en el avance de los glifos de espacio; supersede ADR-097 §4 y acota ADR-068)
- `adr/ADR-109-La-Caja-De-Una-Palabra-Es-Su-Caja-De-Tinta.md` (la caja va del descenso al ascenso; su §3, la clave de orden, queda superseded por ADR-110)
- `adr/ADR-110-El-Renglon-Es-Un-Grupo-No-Una-Coordenada.md` (el texto horizontal se agrupa en renglones; desaparece el comparador con tolerancia)
