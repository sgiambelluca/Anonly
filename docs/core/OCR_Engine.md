<!-- CONTEXT: scope=ocr-engine | dependencias=core/Contracts.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md,adr/ADR-090-La-Orientacion-De-Un-Escaneo-Se-Detecta.md | audiencia=IA-implementador | fase=10.8 (§2/§6/§12/§15 actualizados en fase 10: clase host-side dueña de su pool + kernel de reconocimiento en el worker, ADR-045; §9/§10/§11/§13/§14 en fase 10.8: las palabras salen en puntos de página, no en píxeles del raster, ADR-064) -->

# OCR Engine — Spec de Motor

> Ejecuta OCR sobre las páginas sin texto del PDF. Solo corre si `PdfEngineOutput.textlessPages.length > 0`. Devuelve `Word[]` con `BoundingBox` y `confidence` que el PDF Engine fusiona.

**EngineId**: `ocr`
**Versión del spec**: 1.5.0
**Última actualización**: 2026-08-26

> **Nota (v1.3.1, ADR-065 §3, 2026-08-09 — `imageData` puede ser un recorte)**: el OCR por región manda a este motor el raster de **una parte** de la página. La interfaz **no cambia** (§6 intacto) y el motor sigue sin saber qué es una región: recibe una imagen y la reconoce. Lo único que se documenta es qué significan sus coordenadas de salida — puntos **relativos a la imagen recibida** (§9, §10) —, porque la traslación a coordenadas de página la hace `fuseOcrRegion` en `pdf-engine`, que es quien sabe de qué recorte vino.

> **Nota (v1.3.0, ADR-064, 2026-08-09 — las palabras salían en píxeles del raster, no en puntos de página)**: `toWords` armaba el `bbox` con los `x0/y0/x1/y1` crudos de Tesseract, que son **píxeles de la imagen recibida**, mientras `03_Data_Model.md` §137 exige puntos PDF. Como el Orchestrator rasteriza con `scale = ocr.dpi / 72` (**4,1667** con el default de 300 DPI) y no existía ninguna conversión inversa en todo el Core, las palabras entraban a `Page.words` ~4,17× de tamaño y desplazadas — y `render-engine` las **volvía a escalar** al pintar, asumiéndolas puntos. Resultado: en toda página escaneada el rectángulo de censura caía fuera de lugar, dejando el dato sensible a la vista. El kernel pasa a convertir con `pt = px · 72 / dpi` (§10), **después** de ordenar, para que la tolerancia de misma-línea siga siendo de 1px y el orden quede bit-idéntico (ADR-064 §2). `dpi` deja de ser informativo y pasa a ser precondición: debe ser el DPI con el que se rasterizó `imageData` (§9). Sin cambios de firma pública ni de `Contracts.md`.

> **Nota (v1.2.2, 2026-07-30 — las rutas de tesseract se absolutizan contra `self.location.origin`; sin ADR)**: la errata de v1.2.1 (abajo) es correcta pero **solo arregla el fallback in-process**, no el camino real de producción (OcrWorker, wireado incondicionalmente desde PR14/ADR-045). Dentro de un Worker, `tesseract.js@6` no absolutiza `langPath`/`corePath`/`workerPath` —su `resolvePaths` solo lo hace si el entorno es `'browser'`, y en un Worker es `'webworker'`— y con `workerBlobURL: true` (default) el worker interno que crea tiene `self.location = blob:<origen>/<uuid>`. Un path root-relative **no resuelve contra una base `blob:`** (`new URL("/wasm/…", "blob:…")` lanza `Invalid URL`), sea archivo o directorio. Regla: **el kernel absolutiza las tres rutas contra `self.location.origin` antes de pasarlas a `createWorker`**, con fallback a la ruta root-relative si `self.location` no existe (entorno de test en node). Sigue siendo first-party (mismo origen, ADR-018): lo que cambia es la forma de la URL, no el destino. Si tras absolutizar apareciera todavía una resolución root-relative interna de tesseract (`getCore.js` — no verificado, hoy la ejecución no llega tan lejos), la palanca de reserva documentada es `workerBlobURL: false`, que elimina la base `blob:` por completo. Fix: PR 17.6, item §15.22.

> **Nota (v1.2.1, 2026-07-30 — errata de rutas first-party; sin ADR propio, es una constante mal apuntada)**: `worker/kernel.ts` define `TESSERACT_WORKER_PATH = "/wasm/tesseract/"`, un **directorio**. tesseract.js hace `importScripts(workerPath)` sin agregarle nombre de archivo, así que la carga **falla en silencio**: un PDF escaneado recorre el pipeline entero y llega a "Listo" con 0 entidades, sin error visible ni evento de fallo. Valor correcto: **`/wasm/tesseract/worker.min.js`**, que es exactamente donde `assets.lock.json` mirrorea el archivo. `langPath` (`/models/tesseract/`) y `corePath` (`/wasm/tesseract/`) sí son directorios y están bien — de hecho el lock mirrorea las dos variantes de core justamente porque tesseract.js elige una dentro de ese directorio (en su momento `tesseract-core-lstm`/`-simd-lstm`; desde ADR-090 §1 son las **completas**, `tesseract-core`/`-simd`, que traen además el código legacy que OSD necesita). El origen de la confusión es la línea de `ADR-018` §2, que listaba las tres rutas como si las tres fueran directorios; queda anotada como errata ahí. Fix: PR 17.6 (`ocr-engine`), item §15.22.

> **Nota (ADR-045, 2026-07-24 — reparto host/worker para PR14, espejo de ADR-043)**: la clase `OcrEngine` queda **entera host-side** — el loop secuencial por página de `processPages`, el retry/timeout por página de `processPage`, la emisión de los cuatro eventos y el depósito en `ctx.cache` (que así cumple ADR-014 §1 literal: lado host). Al worker va un **kernel de reconocimiento sin estado por documento** (`05_Worker_Architecture.md` §7.2): `OcrPagePayload` → tesseract → `COMPLETED { words, confidence }`; su único estado es la instancia tesseract con su set de idiomas (payload con set distinto → re-crea la instancia; cubre `reanalyze` con `ocr.languages`, ADR-038 §5.3). El motor recibe su pool por constructor opcional (`new OcrEngine(pool?)`, inyectado por el façade en `create-core.ts`; sin argumento → fallback in-process bit-idéntico, ADR-035) y despacha el reconocimiento con `maxRetriesOverride: 0` — el único loop de retry es el del motor; cualquier timeout del despacho se normaliza a `OcrTimeoutError` en el borde del puerto. **Sin bus puente ni cache local en el worker**: la secuencia `resultado del kernel → ctx.cache.set → OCR_PAGE_FINISHED` es una sola ruta host-side, así que el orden evento/datos está garantizado y el flujo incremental por página (requisito: la UI se actualiza a medida que cada página termina) se preserva por construcción. `OCR_STARTED.modelLoading` (ADR-024): la señal pasa a un flag de la instancia host ("ningún reconocimiento completado aún"), misma semántica per-instancia. Interfaz de §6: sin cambios de firma salvo el constructor.

> **Nota (ADR-021, 2026-07-09)**: este motor se implementa **inline** en el Hito 3, sin crear `OcrPool` propio; los pools llegan con el Orchestrator (Hito 9), sin cambio de interfaz pública (precedentes ADR-013/ADR-020). Ojo: tesseract.js crea sus **propios workers internos** — eso no es el `OcrPool` y no viola el modo inline. SLA de cancelación < 200 ms se valida en Hito 9/11.

> **Nota (v1.5.0, ADR-101, 2026-08-27 — el despacho paralelo que nunca aterrizó)**: `processPages` recorría las páginas con un `for … await` estricto. No era un descuido: el checklist §15.7 lo fijó así para el Hito 3 y dejó *"el despacho paralelo al pool"* al **Orchestrator** en el Hito 9 — que cerró haciendo una sola llamada a `processPages`, sin repartir nada. Con `ocrPoolSize: 2` (default fuera de `lowResource`) el pool nunca tuvo más de un trabajo en vuelo. Ahora `processPages` reparte entre `min(ocrPoolSize, páginas)` consumidores sobre una cola por índice: el límite sale de `ocrPoolSize` **a propósito**, porque ese valor ya se adapta al equipo, así que en una máquina chica el resultado es exactamente el loop de antes. El orden de `outputs` se preserva **por índice**, no por llegada. El orden que ADR-045 garantiza —`kernel → cache.set → OCR_PAGE_FINISHED`, y el flujo incremental— es **por página** y sobrevive intacto; verificado que `handleOcrPageFinished` corre síncrono por evento y fusiona por `pageIndex`. Medido sobre los 26 documentos del dataset rasterizados: **−22 % a −27 % en los de dos páginas**, ±0 % en los de una, con la calidad idéntica. Ver §12, §13 caso 15 y §14.

> **Nota (v1.4.0, ADR-090, 2026-08-26 — la orientación de un escaneo se detecta)**: un escaneo rotado se leía en horizontal y producía basura, de la que después salían falsos positivos numéricos (informe de calidad §2.1). Reproducido: una tabla rasterizada y rotada 90° devolvía `"DD == y > $ 2% 3 2 e e 9 NN A N …"`. Tres cambios, ninguno de contrato público. **(1) Core completo y modelo `osd`** (ADR-090 §1): `worker.detect()` está guardado por `if (lstmOnlyCore) throw` — OSD es un modelo *legacy*, así que `createWorker` pasa a recibir `legacyCore: true` y `osd` junto a los idiomas, y `assets.lock.json` reemplaza los dos pines de core LSTM-only por los completos y agrega `tesseract-lang-osd` (+5,1 MB que el usuario baja una vez). `loadedLanguages` sigue siendo el set **pedido**: `osd` no participa de la comparación que decide si recrear el worker. **(2) `user_defined_dpi`** (ADR-090 §2): el raster se arma a `dpi` conocido y hasta ahora Tesseract lo estimaba; se aplica con `setParameters` cuando cambia. **Medido: no cambia nada sobre un raster limpio** (mismo tiempo, misma confianza, mismos DNIs exactos, con cuerpo de 10 pt y de 6,5 pt) — entra por determinismo, no por rendimiento, y **no** cierra el informe §2.2. **(3) Detección de orientación** (ADR-090 §3/§4): `detect()` antes de reconocer; si da 90/180/270 con confianza suficiente, se rota el `ImageData` en horario por aritmética de píxeles, se reconoce el raster enderezado, y las cajas vuelven al espacio original con la rotación inversa — el orden de lectura se calcula **en el espacio enderezado**, que es el único donde "arriba-abajo" es el sentido de lectura. Las `Word` de un escaneo rotado ganan `bbox.rotation`, con lo que **§10 deja de decir que este motor nunca lo puebla**. Cualquier falla de `detect` cae a 0 y el camino es el previo al ADR, byte a byte. Medido: una página rotada pasa de 16,7 s a 6,0 s (Tesseract deja de pelear con renglones inexistentes), y OSD cuesta 0,5-0,7 s contra los 45,4 s de probar las cuatro orientaciones. Ver §10, §12, §13 casos 12-14, §14 y §15 item 24.

---

## 1. Objetivo

Recibir `ImageData` de páginas sin texto y producir `Word[]` con posiciones y confianza, reutilizando el modelo Tesseract ya cargado (inline en Hito 3; en cada worker del `OcrPool` desde Hito 9 — ADR-021).

---

## 2. Responsabilidades

- Cargar Tesseract.js y el modelo `spa+eng` (default). Hito 3: inline; desde PR14 (ADR-045): en el kernel — cada worker del `OcrPool` carga su instancia; el fallback in-process usa el mismo módulo de kernel.
- Recibir `ImageData` por página y ejecutar OCR.
- Producir `Word[]` con `BoundingBox`, `confidence`, `source: "ocr"`.
- Cache el modelo en IndexedDB tras primera descarga.
- Emitir `OCR_STARTED`, `OCR_PAGE_FINISHED`, `OCR_FINISHED`, `OCR_PAGE_FAILED`.
- Transferir zero-copy `ImageData` al worker.
- Depositar las `Word[]` en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>` y emitir `OCR_PAGE_FINISHED`; el **Orchestrator** (no el PDF Engine) lo escucha y aplica la función pura `fuseOcrPage` de `pdf-engine` sobre su `Document` retenido (ADR-014, ADR-041).

---

## 3. Fuera de alcance

- Rasterizar el PDF a `ImageData` (es tarea del host o de un `RenderWorker` ligero).
- Detectar entidades (Regex/NER).
- Fusionar las palabras en `Page` (es tarea del PDF Engine vía `fuseOcrPage`).
- Renderizar el PDF final.
- Conocer React ni UI.
- Persistir documentos.

---

## 4. Dependencias permitidas

- `@anonly/shared`
- `tesseract.js` (justificado en ADR-001)
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Word`, `BoundingBox`, `OcrConfig`
- `architecture/04_Event_System.md`: `OCR_STARTED`, `OCR_PAGE_FINISHED`, `OCR_FINISHED`, `OCR_PAGE_FAILED`

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor
- `pdfjs-dist`, `pdf-lib`, `@huggingface/transformers`, `onnxruntime-web`
- Node builtins (`fs`, `http`), libs de network

---

## 6. Interfaces públicas

```ts
// OcrConfig se define en core/Contracts.md §6 (source of truth) y se importa de @anonly/shared.
// Solo contiene languages y dpi; el timeout y los retries por página se leen de
// ctx.config.workerPool.timeouts["ocr-page"] (default 60000) y
// ctx.config.workerPool.maxRetries["ocr-page"] (default 2) — fuente única, ver ADR-021 §2.
export interface OcrConfig {
  readonly languages: ReadonlyArray<string>; // default ["spa", "eng"]
  readonly dpi: number;                       // default 300 (calidad OCR)
}

export interface OcrPageInput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly imageData: ImageData;              // se transfiere (zero-copy)
  readonly dpi: number;
  readonly languages: ReadonlyArray<string>;
}

export interface OcrPageOutput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly words: ReadonlyArray<Word>;
  readonly confidence: number;                // promedio
  readonly durationMs: number;
}

export class OcrEngine implements IEngine {
  readonly id = EngineId.Ocr;
  // pool (ADR-045 §2): puerto interno de despacho, inyectado por el façade en
  // createCore (espejo de RenderEngine/ADR-043 §2). Sin argumento → fallback
  // in-process inmediato que invoca el mismo kernel (bit-idéntico, ADR-035);
  // es lo que los tests del motor y los helpers existentes ya esperan.
  constructor(pool?: OcrJobPool);
  init(ctx: EngineContext): Promise<void>;
  processPage(input: OcrPageInput, ctx: EngineContext): Promise<OcrPageOutput>;
  processPages(inputs: ReadonlyArray<OcrPageInput>, ctx: EngineContext): Promise<ReadonlyArray<OcrPageOutput>>;
  dispose(): Promise<void>;
}
```

Semántica del despacho (ADR-045 §2): `processPage` envía **solo el reconocimiento** por el puerto — `dispatch({ jobType: "ocr-page", payload: OcrPagePayload, run: () => kernel, signal, maxRetriesOverride: 0 })`. El retry vive únicamente en el loop del motor (la distinción `OcrTimeoutError`-reintenta / resto-no de §11 no cambia); todo timeout que emerja del despacho se normaliza a `OcrTimeoutError` antes del loop. El depósito en `ctx.cache` y la emisión de `OCR_PAGE_FINISHED` ocurren en el host, **en ese orden**, al resolver el despacho.

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `OCR_STARTED` | al iniciar el procesamiento de un set de páginas | `OcrStarted` | async | sí |
| `OCR_PAGE_FINISHED` | al finalizar una página | `OcrPageFinished` | async | sí |
| `OCR_FINISHED` | al finalizar todas las páginas del set | `OcrFinished` | async | sí |
| `OCR_PAGE_FAILED` | al fallar una página tras reintentos | `OcrPageFailed` | async | sí |

Canal: `EventChannel.Ocr`.

---

## 8. Eventos que consume

No consume eventos. Es un motor de "entrada-salida" puro; el Orchestrator lo invoca directamente vía `processPage`/`processPages`.

---

## 9. Entradas

```ts
OcrPageInput {
  documentId: string;
  pageIndex: number;
  imageData: ImageData;     // rasterización de la página; se transfiere
  dpi: number;              // default 300
  languages: ReadonlyArray<string>;  // default ["spa", "eng"]
}
```

**Restricciones**:
- `imageData.width > 0 && imageData.height > 0`. Si no, lanza `InvalidInputError`.
- `pageIndex >= 0`.
- `dpi` debe ser finito y `> 0`. Si no, lanza `InvalidInputError` (ADR-064 §4): es el divisor de la conversión a puntos de §10.
- `languages` debe contener al menos un idioma cargado en el modelo del worker.
- `imageData` se transfiere (zero-copy). El host pierde acceso tras `processPage`.

**`imageData` puede ser un recorte de la página (ADR-065 §3)**: desde el OCR por región, el caller puede pasar el raster de **una parte** de la página en vez de la página entera (`rasterizePage` con `region`, `Render_Engine.md` §6). Para este motor no cambia nada —recibe una imagen y la reconoce— pero sí cambia qué significan las coordenadas que devuelve: las `words` de §10 salen en puntos **relativos a la imagen recibida**, o sea al recorte. Llevarlas a coordenadas de página es responsabilidad del caller, que es el único que sabe de qué región vino (`fuseOcrRegion` de `pdf-engine`, `PDF_Engine.md` §6). Este motor **no** conoce el concepto de región y no debe ganarlo.

**Precondición de `dpi` (ADR-064 §3)**: `dpi` **debe ser el DPI con el que se rasterizó `imageData`**. No es un dato informativo: es el divisor con el que §10 convierte las coordenadas de Tesseract a puntos de página, así que un valor que no corresponda produce geometría mal escalada en silencio. El caller es responsable de que las dos cosas se muevan juntas — hoy el Orchestrator las deriva del mismo `ctx.config.ocr.dpi` (`scale = dpi/72` para rasterizar, `dpi` para este input; `Orchestrator.md` §2). El motor **no** lo verifica: no conoce el tamaño en puntos de la página, así que no tiene contra qué comparar.

---

## 10. Salidas

```ts
OcrPageOutput {
  documentId: string;
  pageIndex: number;
  words: ReadonlyArray<Word>; // ordenadas por bbox.y asc, luego bbox.x asc
  confidence: number;          // promedio [0,1]
  durationMs: number;
}
```

- `words[i].source === "ocr"`.
- `words[i].pageIndex === input.pageIndex`.
- `words[i].confidence ∈ [0,1]`.
- **`words[i].bbox` está en puntos**, no en píxeles del raster (ADR-064 §1) — de página cuando `imageData` es la página entera, y **relativos al recorte** cuando es una región (§9, ADR-065 §3). Tesseract devuelve píxeles de la `imageData` recibida; el kernel los convierte con `pt = px · 72 / dpi` sobre `x`, `y`, `width` y `height`. Es un escalado puro, sin corrimiento de origen: el raster de `rasterizePage` sale de `getViewport({ scale })`, cuya esquina superior-izquierda con `y` hacia abajo es **la misma convención** que exige `03_Data_Model.md` §137. Con esto, `Word.bbox` tiene un único espacio de coordenadas sea `source` `"pdf"` u `"ocr"`.
- El orden de lectura se calcula **antes** de convertir, con la tolerancia de misma-línea de 1px intacta (ADR-064 §2). El array resultante queda en el mismo orden que produciría sin la conversión: un escalado positivo uniforme no altera el orden, y la tolerancia sigue significando un píxel y no un punto.
- **`bbox.rotation` se puebla desde ADR-090 §4** — hasta la v1.3.1 este motor nunca lo hacía, y §10 lo afirmaba. Ahora lleva el mismo valor que `orientation_degrees` de OSD (ausente ≡ 0, así que un escaneo derecho sigue sin el campo y entra por la rama horizontal de siempre). La correspondencia es la identidad y está verificada contra los runs rotados que produce `pdf-engine`: `270` ⇒ el texto avanza hacia abajo en espacio de página, `90` ⇒ hacia arriba. Con esto se cumple lo que ADR-067 §5 dejó anotado: el orden por runs rotados de `pdf-engine` y el pintado rotado de ADR-066 §7 **cubren el texto de OCR sin un cambio más**.
- **El orden de lectura de un escaneo rotado se calcula en el espacio enderezado** (ADR-090 §3), antes de mapear las cajas de vuelta y antes de convertir a puntos. Es el único espacio donde la tolerancia de misma-línea significa lo que dice. Con orientación 0 el orden es idéntico al de antes del ADR.
- Las `Word[]` también se depositan en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>`; el Orchestrator las lee al recibir `OCR_PAGE_FINISHED` y aplica la función pura `fuseOcrPage` de `pdf-engine` sobre su `Document` retenido (ADR-014, ADR-041). La integración con `fuseOcrPage` se testea con llamada directa, sin bus.

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `OCR_PAGE_FAILED` | `OcrPageFailedError` | Tesseract lanza error en una página tras `maxRetries` | no | esa página queda sin OCR; las detecciones posteriores se saltan sus ocurrencias; warning al usuario |
| `OCR_TIMEOUT` | `OcrTimeoutError` | timeout por página excedido | sí | reintentar hasta `workerPool.maxRetries["ocr-page"]` (Hito 3 inline: loop del propio engine; Hito 9: el pool — ADR-021 §2), luego `OCR_PAGE_FAILED` |
| `OCR_MODEL_MISSING` | `OcrModelMissingError` | no se pudo cargar/descargar el modelo Tesseract | no | abortar OCR; el usuario debe reintentar o desactivar OCR |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `processPage` antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `processPage` tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined, `imageData` vacío, o `dpi` no finito o `≤ 0` (ADR-064 §4) | no | bug del caller |

`retryable`: `OCR_TIMEOUT = true`, resto `false`.

---

## 12. Consideraciones de rendimiento

- Hito 3: corre inline en el host (ADR-021; tesseract.js mantiene sus workers internos propios). Desde PR14 (ADR-045): la clase corre host-side y despacha el reconocimiento a `OcrPool` (1–2 workers default; 1 en móviles) vía su puerto interno; sin factory de workers, el mismo kernel corre in-process.
- Costo: 3–10 s por página A4 a 300 DPI (depende de densidad de texto).
- Memoria: 150–300 MB por worker (modelo cargado). El modelo se reutiliza entre jobs.
- `imageData` se transfiere (zero-copy).
- Paralelismo: el pool despacha en paralelo respetando `ocrPoolSize`. Backpressure si `queue > MAX_QUEUE_PER_POOL = 8`.
- Cancelación: Tesseract expone callback de progreso; el worker chequea `shouldCancel` entre líneas y aborta en < 200 ms.
- Modelo cacheado en IndexedDB tras primera descarga (~30 MB). Sesiones posteriores no descargan.
- `dpi` recomendado: 300 para OCR preciso. 200 acceptable para texto grande. 600 innecesario (más lento sin beneficio).
- Progreso: Tesseract reporta progreso 0..1 por palabra/línea; el worker emite `PROGRESS` al pool, el Orchestrator traduce a `PIPELINE_PROGRESS`.

---

## 13. Casos límite

1. **Página completamente vacía (blanca)**: `words = []`, `confidence = 0`. `OCR_PAGE_FINISHED` se emite normalmente.
2. **Página con imagen sin texto**: `words = []`, `confidence = 0`. Normal.
3. **Página con texto muy pequeño (calidad baja)**: `confidence < 0.5`. El usuario puede ver warning; las ocurrencias NER posteriores tendrán `confidence = min(ocrConf, nerConf)`.
4. **`imageData` ya transferido**: lanza `InvalidInputError`. (Hito 9; inline no hay transferencia zero-copy — ADR-021 §1, precedente ADR-020 §9.)
5. **Idioma no cargado en el modelo**: lanza `OcrModelMissingError`.
6. **Timeout por página**: reintentar 2 veces. Si persiste, `OCR_PAGE_FAILED` y se continúa con las demás páginas.
7. **`dpi = 72`**: la conversión de §10 es la identidad (factor `72/72 = 1`). Caso degenerado útil como fijación de la fórmula, no un modo de uso recomendado (§12: 300 DPI para OCR preciso).
8. **`dpi` no finito o `≤ 0`**: lanza `InvalidInputError` antes de rasterizar nada (ADR-064 §4). Antes del ADR-064 era inocuo porque el valor no se leía; ahora es una división por cero.
7. **Worker crashea (OOM)**: el pool reemplaza el worker, reintenta el job si `retryable`.
8. **Cancelación a mitad de página**: aborta en < 200 ms, libera memoria temporal, responde `CANCELLED`.
9. **100 páginas escaneadas**: se procesan en paralelo (pool size 2). Memoria pico ~600 MB (2 workers × 300 MB). El host vigila memory budget y serializa si `deviceMemory < 4` GB.
10. **Modelo no descargado todavía (primera vez)**: `OCR_STARTED` indica `modelLoading: true`, `OCR_FINISHED` al final incluye `modelDownloaded: true`. La UI muestra "Descargando modelo OCR…".
11. **`processPage` tras `dispose`**: lanza `EngineDisposedError`.
12. **Escaneo rotado 90/180/270** (ADR-090 §3/§4): `detect()` devuelve la rotación horaria que endereza el raster; se reconoce sobre el raster rotado y las cajas vuelven al espacio original, con `bbox.rotation` igual a ese ángulo. Una página derecha (`orientation_degrees: 0`) no rota nada y produce **exactamente** lo previo al ADR — sin el campo `rotation`.
13. **OSD que no concluye** (ADR-090 §3): `detect()` que lanza, que devuelve `orientation_degrees: null`, o que devuelve una `orientation_confidence` por debajo del piso ⇒ se reconoce sin rotar, sin error y sin evento. Es el mismo resultado que antes del ADR. Pasa, entre otros, en páginas con muy poco texto: OSD necesita glifos para decidir.
14. **`user_defined_dpi`** (ADR-090 §2): se aplica una vez por instancia y solo se repite si el `dpi` del payload cambió. Un `setParameters` que rechaza es best-effort: se sigue reconociendo con la estimación de Tesseract.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits OCR_STARTED before pages` | `contract.test.ts` | contract | invariante de orden |
| `emits OCR_PAGE_FINISHED per page` | `contract.test.ts` | contract | uno por página |
| `emits OCR_FINISHED after all pages` | `contract.test.ts` | contract | al final |
| `words sorted by bbox y then x` | `unit.test.ts` | unit | orden |
| `confidence in [0,1]` | `unit.test.ts` | unit | rango |
| `word.source === "ocr"` | `contract.test.ts` | contract | invariante |
| `deposits words in ctx.cache` | `contract.test.ts` | contract | integración con PDF Engine |
| `empty page returns empty words` | `edge.test.ts` | edge | caso 1 |
| `image-only page returns empty words` | `edge.test.ts` | edge | caso 2 |
| `low confidence warns` | `edge.test.ts` | edge | caso 3 |
| `throws on already-transferred imageData` | `edge.test.ts` | edge | caso 4 |
| `throws on unknown language` | `edge.test.ts` | edge | caso 5 |
| `retries on timeout up to maxRetries` | `edge.test.ts` | edge | caso 6 |
| `word bboxes are converted from raster pixels to page points` | `unit.test.ts` | unit | ADR-064 §1: bbox `(0,0)-(417,417)` px con `dpi = 300` → `{ x: 0, y: 0, width: 100.08, height: 100.08 }` pt |
| `dpi 72 makes the conversion an identity` | `unit.test.ts` | unit | caso 7 (ADR-064 §1): fija la fórmula en el factor 1 |
| `reading order is unchanged by the point conversion` | `unit.test.ts` | unit | ADR-064 §2: mismo orden que sin convertir, incluida la tolerancia de misma-línea de 1px |
| `throws InvalidInputError on non-positive or non-finite dpi` | `edge.test.ts` | edge | caso 8 (ADR-064 §4): `0`, `-1`, `NaN`, `Infinity` |
| `replaces crashed worker and retries` | `stress.test.ts` (en `tests/stress/`) | stress | caso 7 |
| `cancel within 200ms` | `cancel.test.ts` | cancel | caso 8 |
| `100 pages complete within memory budget` | `stress.test.ts` | stress | caso 9 |
| `model cached in IndexedDB after first run` | `integration.test.ts` (en `tests/integration/`) | integration | caso 10 |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 11 |
| `kernel RUN(ocr-page) returns words/confidence identical to in-process path` | `worker-entry.test.ts` | unit | ADR-045 §3 (fixture compartida, fallback bit-idéntico ADR-035) |
| `kernel recreates tesseract instance on language set change` | `worker-entry.test.ts` | unit | ADR-045 §3 (`reanalyze` con `ocr.languages`, ADR-038 §5.3) |
| `dispatch uses maxRetriesOverride 0 (pool never retries ocr-page)` | `contract.test.ts` | contract | ADR-045 §2 (retry único: el loop del motor) |
| `cache set happens before OCR_PAGE_FINISHED on host` | `contract.test.ts` | contract | ADR-045 §1/§4 (orden garantizado; mata la carrera EVENT/COMPLETED) |
| `dispatch timeout normalized to OcrTimeoutError and retried by engine loop` | `edge.test.ts` | edge | ADR-045 §2 |
| `events identical with and without pool` | `contract.test.ts` | contract | ADR-045 §5 (fallback ADR-035) |
| `configures tesseract.js first-party paths with workerPath pointing to the file, not the directory, unresolved when self.location is absent (ADR-018 §2 errata)` | `worker-entry.test.ts` | unit | PR 17.6 parte (a), §15 item 22: `TESSERACT_WORKER_PATH` apunta al archivo (`worker.min.js`), no al directorio. Desde ADR-090 §1 afirma además `legacyCore: true` y `osd` en la lista de idiomas — sin el core completo, `worker.detect()` lanza |
| `absolutizes tesseract.js first-party paths against self.location.origin when running inside a real worker (ADR-018 §2 precisión)` | `worker-entry.test.ts` | unit | PR 17.6 parte (b), §15 item 22: sin absolutizar, los paths root-relative no resuelven contra la base `blob:` del worker interno de tesseract |
| `tells Tesseract the dpi instead of letting it estimate, and only when it changes` | `unit.test.ts` | unit | caso 14 (ADR-090 §2) |
| `does not rotate anything when the page is upright (no regression)` | `unit.test.ts` | unit | caso 12 — la no regresión: sin el campo `rotation` y con las mismas coordenadas de antes del ADR |
| `recognizes the uprighted raster and brings the boxes back, with rotation` | `unit.test.ts` | unit | caso 12 — coordenadas calculadas a mano, y la caja tiene que caer DENTRO de la página |
| `falls back to the pre-ADR path when detect fails, returns null or is unsure` | `unit.test.ts` | unit | caso 13 — los tres modos de falla de OSD |
| `rotates clockwise: the top-left pixel lands on the top-right corner` | `kernel.test.ts` | unit | ADR-090 §3 — el sentido de giro; al revés daría el texto invertido |
| `four 90° turns return the original, pixel by pixel` | `kernel.test.ts` | unit | ADR-090 §3 |
| `unrotateBbox brings the box back inside the original raster, on the three angles` | `kernel.test.ts` | unit | ADR-090 §3 — que la caja no se salga de la página ni se deforme |

**Fixtures y mocks (ADR-021 §5)**: los tests **unit / contract / edge** (Hito 3) mockean la frontera `tesseract.js` — deterministas, sin wasm ni descargas; el cast de frontera va en un helper único de `__tests__/fixtures/` (Code_Standards §10, precedente `mockGetDocumentResult` del pdf-engine). Los tests **stress / cancel / integration** son Hito 11 y usan `tests/fixtures/scanned-10p.pdf` (rasterizado a `ImageData` por el host), imagen blanca e imagen con texto pequeño.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/ocr-engine/`.
- [ ] 2. Definir `types.ts` con `OcrPageInput`, `OcrPageOutput` (`OcrConfig` viene de `@anonly/shared`).
- [ ] 3. Definir `errors.ts` con `OcrPageFailedError`, `OcrTimeoutError`, `OcrModelMissingError`.
- [ ] 4. Implementar `ocr.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5a. (Hito 3) Implementar `init` inline: cargar tesseract.js con `langPath`/`corePath`/`workerPath` first-party (ADR-018) y modelo `spa+eng`; el cache en IndexedDB lo maneja tesseract.js internamente (ADR-021 §6).
- [ ] 5b. (Hito 9) Migrar a `OcrPool` cuando `WorkerPoolManager` exista. **Forma final fijada por ADR-045 (PR14)**: ver items 19–21.
- [ ] 6. Implementar `processPage` con `AbortSignal` y callback de progreso de Tesseract como checkpoint de cancelación; `OCR_PAGE_FINISHED` al completar. (Transferencia zero-copy de `ImageData`: Hito 9, ADR-021 §1.)
- [ ] 7. Implementar `processPages` (Hito 3: secuencial en el orden recibido, con checkpoint de cancelación entre páginas; la priorización por visibilidad y el despacho al pool son del Orchestrator, Hito 9).
- [ ] 8. Implementar depósito en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>`.
- [ ] 9. Implementar `dispose` (libera Tesseract workers y memoria temporal; NO descarga el modelo cacheado).
- [ ] 10. Cablear eventos emitidos contra `IEventBus`.
- [ ] 11. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 12. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 13. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 14. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 15. Verificar `index.ts` exporta solo lo público.
- [ ] 16. Verificar imports sin dependencias prohibidas (`grep -r 'react\|pdfjs\|pdf-lib\|onnx\|transformers' src/`).
- [ ] 17. Verificar `no-network-from-core` (sin `fetch`/`XMLHttpRequest` propios). Configurar Tesseract.js con `langPath`/`corePath`/`workerPath` apuntando al origen propio (`/models/tesseract/`, `/wasm/tesseract/`): los assets se sirven first-party con hash verificado según ADR-018 — nunca desde jsDelivr/GitHub en runtime.
- [ ] 18. (Hito 9/11) Verificar test de cancelación < 200 ms; en Hito 3 se valida cancelación cooperativa (checkpoint por página) sin SLA estricto (ADR-021 §1).
- [ ] 19. (Hito 10, PR14 — ADR-045) Extraer el reconocimiento (tesseract setup first-party, `toWords`, confidence) al módulo del kernel (`worker/kernel.ts` o equivalente) y reescribir `worker/entry.ts` como kernel puro de §7.2: `RUN(ocr-page)` → `COMPLETED { words, confidence }`, sin bus puente ni cache local; re-creación de la instancia ante cambio de idiomas.
- [ ] 20. (Hito 10, PR14 — ADR-045) Puerto interno `OcrJobPool` + constructor `new OcrEngine(pool?)` (espejo de `RenderJobPool`/ADR-043 §2); `processPage` despacha con `maxRetriesOverride: 0` y normaliza timeouts a `OcrTimeoutError`; wiring en `create-core.ts` (`new OcrEngine(ocrPool)`).
- [ ] 21. (Hito 10, PR14 — ADR-045) Subpath export `"./worker"` + wiring en la app; E2E: pipeline con PDF escaneado real vía OcrWorker (fixture diferida de PR12, ADR-041), `OCR_PAGE_FINISHED` incremental observable.
- [ ] 22. (Hito 10, PR 17.6 — erratas v1.2.1 y v1.2.2, sin ADR) Dos partes, las dos necesarias: (a) `TESSERACT_WORKER_PATH` → `"/wasm/tesseract/worker.min.js"` (archivo, no directorio; arregla el fallback in-process); (b) absolutizar las **tres** rutas contra `self.location.origin` antes de `createWorker`, con fallback a la ruta root-relative si `self.location` no existe (node/tests) — sin esto el camino real (OcrWorker) sigue roto, porque los paths terminan resolviéndose contra una base `blob:`. Palanca de reserva si aparece una resolución interna root-relative de tesseract: `workerBlobURL: false` (documentar el motivo si se usa). Verificar en browser real, no solo en unit tests: el mock de tesseract no ejercita la resolución de URLs. Test: el Escenario 2 E2E (PDF escaneado) debe producir entidades > 0 — hoy pasa a "Listo" con 0 y **en verde**, así que el spec tiene que afirmar el resultado del OCR, no solo el stage.
- [x] 23. (Hito 10.8, paso 0 — ADR-064) `toWords` recibe el `dpi` del payload y convierte cada `bbox` a puntos con `pt = px · 72 / dpi`, **después** de `sortWordsByReadingOrder` (la tolerancia de misma-línea sigue siendo de 1px, ADR-064 §2). Guard de `dpi` finito y `> 0` → `InvalidInputError` (§9, §11). Actualizar el fixture de `tests/integration/ocr-pdf-fusion.test.ts`, que hoy usa valores que pasan en cualquier espacio de coordenadas. Casos 7-8 de §13 y cuatro filas nuevas en §14.

- [x] 24. (ADR-090) Kernel: `createWorker` con `legacyCore: true` y `osd` junto a los idiomas (sin meter `osd` en `loadedLanguages`); `setParameters({ user_defined_dpi })` cuando cambia el dpi; `detect()` antes de reconocer, rotación del `ImageData` por aritmética de píxeles, reconocimiento sobre el raster enderezado, y mapeo inverso de las cajas antes de `toPagePoints`; `bbox.rotation` poblado con el ángulo. `assets.lock.json`: reemplazar los dos pines de core LSTM-only por los completos y agregar `tesseract-lang-osd`. **No** tocar el orden de lectura (se calcula igual, en el espacio enderezado) ni ningún contrato público. Casos 12-14 de §13, filas nuevas en §14.

---

## Referencias

- `architecture/06_Pipeline.md` §4 (etapa 2, OCR)
- `architecture/05_Worker_Architecture.md` §7.2 (OcrWorker)
- `architecture/07_Performance_Strategy.md` §2.2 (carga de wasm y modelo)
- `adr/ADR-001-Framework.md` (tesseract.js)
- `adr/ADR-003-Workers.md` (pools)
