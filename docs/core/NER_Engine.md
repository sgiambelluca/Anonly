<!-- CONTEXT: scope=ner-engine | dependencias=core/Contracts.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,ADR-006-NER-Local.md,adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-055-Decodificacion-Del-Resultado-Que-Cruza-Un-Worker.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-088-El-Texto-Que-Recibe-El-NER.md,adr/ADR-111-El-Token-Que-No-Es-Entidad-Tambien-Entra-Al-Agregador.md,adr/ADR-118-La-Clave-De-Agrupado-Tiene-Una-Sola-Definicion.md | audiencia=IA-implementador | fase=11 (§13/§14/§15 en fase 11 por ADR-111: el pipeline entrega todos los tokens, la continuación no abre entidad y el borde de un span es un borde de palabra; §12/§13/§14/§15 en fase 11 por ADR-088: los batches se cortan por corrida rotada y las corridas en caja alta se clasifican en Title Case; §10/§14/§15 en fase 10.9: `mapSpanToWords` emite `fragments` por línea —ADR-074 §2, y el caso medido es de este motor—; §2/§6/§7/§11/§12/§13/§14/§15 actualizados en fase 10: clase host-side dueña de su pool + kernel de inferencia en el worker, ADR-046; decodificación del sobre { spans } y tests de sobre en §14 por ADR-055, cierre de fase 10; §10/§14/§15 en fase 10.8: mapSpanToWords propaga bbox.rotation solo si todas las palabras del span coinciden en el ángulo, ADR-066 §6) -->

# NER Engine — Spec de Motor

> Detecta personas, organizaciones, direcciones y fechas mediante un modelo NER local (Transformers.js + ONNX Runtime Web). Emite `Occurrence[]` con `source: "ner"` y `confidence` según el modelo.

**EngineId**: `ner`
**Versión del spec**: 1.6.0
**Última actualización**: 2026-09-02

> **Nota (v1.6.0, ADR-118, 2026-09-02 — la clave de agrupado tiene una sola definición)**: el kernel tenía su propia `normalizeNerValue` y difería de `normalizeEntityValue` (la que produce el `normalizedValue` de la vía manual, ADR-115 §1) en dos cosas: **no sacaba diacríticos** y recortaba los bordes con una **lista** de signos en vez de por clase Unicode. Como `normalizedValue` es la clave con la que agrupa `grouping-engine`, el mismo nombre encontrado por los dos caminos daba dos grupos, y el pase difuso no siempre lo rescata: `muñíz` contra `muniz` da **0,600** sobre un umbral de 0,88. Medido sobre 8 documentos / 683 ocurrencias: de **108** con diacríticos, 85 las rescataba el difuso y **23 se partían**. La pregunta inversa también se midió — unificar **no colapsa nada**: 247 claves distintas antes y después, 0 colisiones nuevas. El kernel pasa a usar `normalizeEntityValue` de `@anonly/shared`: no se le agrega un paso, las dos pasan a ser **la misma función**. `Occurrence.value` no se toca, así que `canonicalValue` y los `aliases` siguen mostrando `Muñíz` con su acento. Ver §13 caso 26 y §14.

> **Nota (v1.5.0, ADR-111, 2026-09-02 — el token que no es entidad también entra al agregador)**: una `Person` de **785 caracteres** —tres párrafos de un fallo escaneado en una sola fila del árbol— tiene una causa que no está en la detección: `TokenClassificationPipeline._call` de @huggingface/transformers default a **`ignore_labels: ['O']`** y este kernel nunca le pasó opciones, así que trabajaba con el 4,5 % de los tokens (medido: **21 de 466** en una página). Los dos consumidores del resultado asumen la secuencia completa — `aggregateTokensToSpans` cierra el span abierto justo en la rama del label no soportado, y el cursor de `positionTokens` usa los `O` como anclas. Sin ellos, el `B-PER "D"` de `D'Amoroso` se ubicó **776 caracteres antes** de su posición real y nada cerró el span. **§1** pide `ignore_labels: []` (`aggregation_strategy` se deja en `"none"`: la agregación nativa no devuelve offsets de carácter). **§2** completa la regla de v1.3.1 — una continuación de wordpiece no abre entidad **ni cambiando de etiqueta**: `Florencio Varela` salía `Address "Floren"` + `Organization "cio Varela"`. **§3** lleva el borde de cada span al borde de palabra, sin pisar al vecino. Medido sobre 8 documentos / 115 páginas: spans de más de 40 caracteres **19 → 3** (los 3 restantes son nombres largos legítimos de organismos), spans cortados a mitad de palabra **48 → 0**, sin costo de tiempo medible. No toca ningún contrato: todo el cambio vive en `worker/kernel.ts`. Ver §13 casos 23-25, §14 y §15 items 29-31.

> **Nota (v1.4.0, ADR-098, 2026-08-27 — el lote se corta en palabras y el modelo trunca en tokens)**: `computeWordChunks` corta cada lote en `batchSize` **palabras** (256 por default) pero el modelo trunca en 512 **tokens** (`model_max_length`), y el pipeline de Transformers.js tokeniza con `truncation: true` **sin `max_length`**, así que **descarta la cola sin error, sin warning y sin log**. La razón tokens/palabra no es constante: medida con el tokenizer real sobre 256 palabras da **1,42 en prosa, 2,55 en un párrafo legal denso y 6,12 en identificadores puros** — o sea que el "proxy de tokens" que ADR-024 §2 eligió a sabiendas **queda superseded en su premisa**, y el caso que lo rompe es justo el documento al que apunta el producto. Reproducido de punta a punta con el modelo real sobre `doc-026` del dataset de referencia: **recall 1/3**, con las dos entidades posteriores al corte perdidas. `kernelClassify` pasa a medir el `inferenceText` con el tokenizer del pipeline ya cargado y, si excede el presupuesto, lo **parte en sub-lotes por límite de palabra** —buscando el corte por bisección con el tokenizer, nunca estimando por una razón promedio— infiere cada uno y **devuelve los spans a coordenadas del lote**. No cambia ningún contrato: ni `NerConfig`, ni `NerKernelSpan`, ni el reparto host/kernel de ADR-046 §1. Ver §13 caso 22 y §14.

> **Nota (v1.3.1, 2026-08-26 — un subword no puede empezar una entidad; sin ADR propio, es una errata de la agregación)**: hallazgo §23f del gate manual, reproducido con el modelo real sobre `qa-tables-justified.pdf`. La segunda aparición de `"Empresa S.A."` salía como **dos** grupos espurios, `"Em"` y `"presa S.A"`. Los tokens crudos dicen por qué: el modelo etiqueta `B-ORG "Em"` y después **`B-ORG "##presa"`** — un `B-` sobre una **continuación de wordpiece**. `aggregateTokensToSpans` le creía y abría un span nuevo. Un subword no puede *empezar* una entidad: es la corrección que le faltaba a la "equivalencia simplificada de `aggregation_strategy`" que ADR-046 §1 declara, porque HuggingFace agrupa los tokens en **palabras** antes de decidir la etiqueta y por eso no cae en esto. `PositionedToken` gana `isContinuation` y el "begin" pasa a ser `taggedAsBegin && !isContinuation`; el `label` se sigue derivando del prefijo **crudo**, porque si no un `B-` de continuación quedaría sin etiqueta y el token se descartaría entero. Medido con el modelo real: los dos spans espurios pasan a ser uno solo, `"Empresa S.A"` con 0,908, que además agrupa con la otra aparición del mismo nombre. **El hallazgo §23f no era de la costura del repintado** —el informe lo atribuía al texto justificado— sino de este motor. Ver §13 caso 21 y §14.

> **Nota (v1.3.0, ADR-088, 2026-08-22 — el texto que se le da al modelo tiene que ser texto que exista)**: dos fugas de dato del gate manual (`roadmap/Post_Hito10.8_Pendientes.md` §23a y §23b), reproducidas con el pipeline real en `tests/integration/qa-stamp-detection.test.ts`, tienen la misma causa y ninguna estaba en la detección propiamente dicha. **(1) Un batch nunca mezcla orientaciones** (ADR-088 §1): ADR-067 §4 emite los runs rotados al final de `Page.text`, contiguos —lo correcto— pero eso deja dos runs de márgenes opuestos **pegados uno al otro**, y el modelo los lee como una oración. Medido: el folio a 270° y el sello a 90° salían en **una sola** `Occurrence` de `Person`, con bbox de 525 × 521 pt sobre una página de 595 × 842, sin `rotation` (las palabras discrepan en el ángulo, §10) y descartada después por conflicto de solapamiento — o sea, el folio nunca llegaba al reemplazo. `computeWordChunks` pasa a cortar también en todo cambio de `bbox.rotation`; `batchSize` sigue siendo el máximo y una página sin texto rotado produce los mismos batches, palabra por palabra. **(2) Las corridas en caja alta se clasifican en Title Case** (ADR-088 §2): el modelo es *cased* y sobre `JUZGADO CIVIL 12 — PERITO CARLOS LOPEZ` devuelve **cero** tokens etiquetados; la misma línea en Title Case devuelve `PER` con 0,999. El kernel transforma el texto **solo para inferir** y corta los `value` del texto **original**, así que el `canonicalValue` del grupo conserva la caja impresa. Ninguno de los dos toca contratos públicos ni el orden de lectura. Ver §12, §13 casos 19-20, §14 y §15 items 27-28.

> **Nota (v1.2.1, ADR-055, 2026-07-31 — el sobre `{ spans }` se decodifica, no se castea)**: con `NerPool` real este motor **no detectaba ninguna entidad**, en silencio. El worker postea `COMPLETED { spans }` —que es lo correcto, ADR-046 §1— pero el host tipaba el despacho como `ReadonlyArray<NerKernelSpan>` e iteraba el resultado directo, y `WorkerPool.dispatch` resuelve con un cast a ciegas sobre un valor que acaba de cruzar un `postMessage`. En modo remoto llegaba el objeto → `for...of` sobre algo no iterable → `TypeError` → `NerPageFailedError` → tragado por el `ctx.logger.warn` de `processPages`, con el logger nulo de producción. Once páginas fallando sin dejar rastro y `NER_FINISHED` con `occurrenceCount: 0`.
>
> Fix: **`NerJobPool` deja de ser genérico y devuelve `Promise<unknown>`**, con lo que el compilador obliga a decodificar (ADR-055 §2). El decoder acepta `{ spans: [...] }` (camino remoto) y `[...]` (camino in-process, que es la prueba de paridad entre los dos), y ante cualquier otra forma **lanza** — devolver `[]` o un default en silencio está prohibido (ADR-055 §3): es literalmente el modo de falla que se está cerrando. **El worker no se toca**: `{ spans }` es el contrato y R-21 prohíbe editarlo desde un PR de implementación. `worker-pool.ts` tampoco: es transporte, y el transporte no conoce el contrato del payload de cada motor.

> **Nota (ADR-046, 2026-07-24 — reparto host/worker para PR15, tercer espejo de ADR-043/ADR-045)**: la clase `NerEngine` queda **entera host-side** — el loop secuencial por página de `processPages`, el retry/timeout por página de `processPage`, la partición en batches (ADR-024 §2), el mapeo de spans a `Occurrence` (bbox/`wordSpan`) y la emisión de los **seis** eventos. Al worker va un **kernel de inferencia sin estado por documento** (`05_Worker_Architecture.md` §7.3): `NerPagePayload` (el texto de **un batch**) → tokenización + inferencia + agregación BIO → `COMPLETED { spans }`; su único estado es el pipeline de `@huggingface/transformers` cargado para un `(modelId, dtype)` dado. El motor recibe su pool por constructor opcional (`new NerEngine(pool?)`, inyectado por el façade en `create-core.ts`; sin argumento → fallback in-process bit-idéntico, ADR-035) y despacha con `maxRetriesOverride: 0` — el único loop de retry es el del motor; los errores que cruzan un worker remoto llegan deserializados y se re-instancian por `code` (`NER_TIMEOUT`, `NER_MODEL_MISSING`) en el borde del puerto. **Sin bus puente en el worker**: `ENTITY_FOUND` y `NER_PAGE_FINISHED` salen de una sola ruta host-side, así que el orden evento/datos está garantizado y `grouping-engine` recibe el mismo stream de siempre. El **ciclo de vida del modelo** (que sí ocurre dentro del worker) cruza por el canal `PROGRESS` del transporte —no por eventos de dominio— y el motor lo traduce en host a `NER_MODEL_LOADING`/`NER_MODEL_READY` (este último, una vez por instancia). `isModelReady()` y `NerStarted.modelLoading` pasan a un flag host-side de la instancia, con la misma semántica per-instancia. Interfaz de §6: sin cambios de firma salvo el constructor.

> **Nota (ADR-021, 2026-07-09)**: este motor se implementa **inline** en su hito, sin crear su pool propio; `WorkerPoolManager` y los pools llegan con el Orchestrator (Hito 9), sin cambio de interfaz pública (precedentes ADR-013/ADR-020). Leer §12 y los ítems de workers/pool del §15 como Hito 9; cancelación cooperativa con checkpoints inline, el SLA < 200 ms se valida en Hito 9/11. Los tests unit/contract/edge mockean la frontera de la librería externa (Code_Standards §10, ADR-021 §5).
>
> **Nota (ADR-023, 2026-07-10)**: el tipo de config canónico es `NerConfig` (Contracts.md §6); el alias `NerEngineConfig` de §6/§15.2 queda eliminado. El `modelId` default es `Xenova/bert-base-multilingual-cased-ner-hrl` (multilingüe, conversión ONNX oficial), Q8 ~150–180 MB — corrige las estimaciones de ~50–80 MB de §12. El pin (URL + hash) se agrega a `assets.lock.json` en el paso de mirror del Hito 5; el mapeo de labels es `PER→Person`, `ORG→Organization`, `LOC→Address`, `DATE→Date` (contrato de salida ampliado a cuatro tipos, ver §10 y ADR-023 §2).
>
> **Nota (ADR-024, 2026-07-11)**: `NerStarted` gana `modelLoading?: boolean` (espejo de ADR-021 §3 para OCR; habilita el caso límite 7). `batchSize` se interpreta en **palabras** en la implementación inline (proxy de tokens; el tokenizer real vive tras la frontera de Transformers.js).
>
> **Nota (ADR-025, 2026-07-11)**: la librería es `@huggingface/transformers` (v4, sucesora de la deprecada `@xenova/transformers` v2). Cuantización vía `dtype: "q8"`; los wasm de su `onnxruntime-web` bundleado se sirven first-party desde `/wasm/onnxruntime/` con pin en `assets.lock.json`. Los assets del modelo (ADR-023) no cambian.
>
> **Nota (ADR-039, 2026-07-22)**: `NerConfig` gana `wasmPaths?: string | NerWasmPaths` (Contracts.md §6). Si está definido, `configureTransformersEnv()` lo asigna **tal cual** a `env.backends.onnx.wasm.wasmPaths` y no lo pisa nunca; ausente → default `/wasm/onnxruntime/` (comportamiento previo, tests sin cambio). Motivo: `onnxruntime-web` hace `import()` dinámico ESM de su glue `.mjs` y Vite prohíbe importar desde `public/` — la app (única capa con bundler) importa los archivos vía `?url` y los inyecta por config, mismo patrón que `GlobalWorkerOptions.workerSrc` de pdfjs-dist. El destino de esos dos assets en `assets.lock.json` pasa a `apps/react-client/src/assets/onnxruntime/` (supersede el destino de ADR-025 punto 3); `env.allowLocalModels = true` es obligatorio en browser (default `false`, hallazgo E2E del Hito 10 PR10). `env.localModelPath` y los assets del modelo no cambian.

---

## 1. Objetivo

Aplicar un modelo NER local sobre `Page.text` y emitir `Occurrence[]` para entidades de tipo `Person`, `Organization`, `Address` y `Date`, con `bbox` mapeado desde las `Word` correspondientes.

---

## 2. Responsabilidades

- Cargar el modelo ONNX cuantizado (Q8) vía Transformers.js. Hito 3: inline; desde PR15 (ADR-046): en el **kernel** — cada worker del `NerPool` carga su instancia; el fallback in-process usa el mismo módulo de kernel.
- Tokenizar e inferir sobre `Page.text` por página, en batches de `NerConfig.batchSize` palabras (ADR-024 §2). La partición la hace el motor host-side; cada batch es un despacho al kernel (ADR-046 §3).
- Mapear los spans detectados a `Occurrence` con `bbox` (resolviendo offsets de tokenización a spans de `Word`) — **host-side**: el kernel devuelve spans con offsets relativos al texto del batch y no conoce las `Word[]`.
- Emitir `NER_STARTED`, `NER_MODEL_LOADING`, `NER_MODEL_READY`, `NER_PAGE_FINISHED`, `NER_FINISHED`.
- Emitir `ENTITY_FOUND` por ocurrencia (evento interno, escuchado por Grouping).
- Traducir el ciclo de vida del modelo reportado por el kernel (`PROGRESS.partial.phase`, ADR-046 §4) a `NER_MODEL_LOADING`/`NER_MODEL_READY`, deduplicando `NER_MODEL_READY` a uno por instancia del motor.
- Marcar ocurrencias con `confidence < NER_CONFIDENCE_THRESHOLD` para que Grouping las marque conflicto `low_confidence`.
- Cache del modelo en Cache Storage del navegador, versionado por `modelId`.
- Lazy loading: solo se carga si NER está activado y hay texto.

---

## 3. Fuera de alcance

- Detectar patrones determinísticos (es tarea de Regex).
- Agrupar ocurrencias (Grouping).
- Renderizar el PDF.
- Conocer React ni UI.
- Persistir documentos.
- Hacer OCR.
- Entrenar o fine-tunear modelos (vía `roadmap/Future_Ideas.md`).

---

## 4. Dependencias permitidas

- `@anonly/shared`
- `@huggingface/transformers` (ADR-001, ADR-006, ADR-025 — bundlea su propio `onnxruntime-web`; el motor no depende de ort directamente, accede al backend vía `env.backends.onnx`)
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `Word`, `Occurrence`, `EntityType`, `DetectionSource`, `NerConfig`
- `architecture/04_Event_System.md`: `NER_STARTED`, `NER_MODEL_LOADING`, `NER_MODEL_READY`, `NER_PAGE_FINISHED`, `NER_FINISHED`, `ENTITY_FOUND`

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor
- `pdfjs-dist`, `tesseract.js`, `pdf-lib`
- `onnxruntime-web` como import directo (el bundleado por `@huggingface/transformers` se configura vía `env.backends.onnx`, ADR-025)
- Node builtins (`fs`, `http`), libs de network (la descarga del modelo la hace Transformers.js configurado contra el **origen propio** — `env.allowRemoteModels = false` + `env.localModelPath`; mirror first-party según ADR-018, nunca HuggingFace en runtime)

---

## 6. Interfaces públicas

```ts
// NerConfig es el tipo canónico de Contracts.md §6 (re-exportado por @anonly/shared);
// se reproduce aquí solo para documentar sus defaults (ADR-023).
export interface NerConfig {
  readonly modelId: string;                  // default "Xenova/bert-base-multilingual-cased-ner-hrl" (ADR-023)
  readonly quantization: "q8" | "q4" | "f32"; // default "q8"
  readonly confidenceThreshold: number;       // default 0.7
  readonly batchSize: number;                 // default 256 palabras (proxy de tokens en la impl. inline, ADR-024 §2)
  readonly enabled: boolean;                  // default true
  readonly wasmPaths?: string | NerWasmPaths; // default ausente → "/wasm/onnxruntime/" (ADR-039; NerWasmPaths en Contracts.md §6)
}

export interface NerPageInput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly text: string;                      // Page.text
  readonly words: ReadonlyArray<Word>;        // Page.words, para mapear bbox
}

export interface NerPageOutput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly occurrences: ReadonlyArray<Occurrence>;
  readonly durationMs: number;
}

export class NerEngine implements IEngine {
  readonly id = EngineId.Ner;
  // pool (ADR-046 §2): puerto interno de despacho, inyectado por el façade en
  // createCore (espejo de OcrEngine/ADR-045 §2 y RenderEngine/ADR-043 §2). Sin
  // argumento → fallback in-process inmediato que invoca el mismo kernel
  // (bit-idéntico, ADR-035); es lo que los tests del motor ya esperan.
  constructor(pool?: NerJobPool);
  init(ctx: EngineContext): Promise<void>;
  processPage(input: NerPageInput, ctx: EngineContext): Promise<NerPageOutput>;
  processPages(inputs: ReadonlyArray<NerPageInput>, ctx: EngineContext): Promise<ReadonlyArray<NerPageOutput>>;
  isModelReady(): boolean;
  getModelId(): string;
  dispose(): Promise<void>;
}
```

**Semántica del despacho (ADR-046 §2–§4)**: `processPage` particiona la página en batches de `NerConfig.batchSize` palabras y envía **solo la inferencia** por el puerto, un despacho por batch — `dispatch({ jobType: "ner-page", payload: NerPagePayload, run: () => kernel, signal, priority: 80, maxRetriesOverride: 0, onProgress })`. El retry vive únicamente en el loop del motor (la política de §11 no cambia); antes de decidir si reintenta, el motor re-instancia por `code` los errores que cruzaron un worker remoto (`NER_TIMEOUT` → `NerTimeoutError`, reintenta; `NER_MODEL_MISSING` → `NerModelMissingError`, aborta NER sin envolver en `NerPageFailedError`), porque `EngineError.deserialize` devuelve una instancia genérica que falla el `instanceof`. El mapeo span→`Occurrence` (bbox, `wordSpan`, id), la emisión de `ENTITY_FOUND` por ocurrencia y la de `NER_PAGE_FINISHED` ocurren en el host, **en ese orden**, al resolver los batches de la página.

`isModelReady()` devuelve el flag host-side de la instancia (`true` desde el primer `model-ready` reportado por un kernel), no la existencia de un clasificador local; `getModelId()` sigue saliendo de la config. Ambos válidos en modo pool y en fallback.

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `NER_STARTED` | al iniciar el procesamiento de un set de páginas | `NerStarted` | async | sí |
| `NER_MODEL_LOADING` | progreso de descarga/carga del modelo | `NerModelLoading` con `progress ∈ [0,1]` | async | sí |
| `NER_MODEL_READY` | modelo cargado y listo | `NerModelReady` | async | sí |
| `NER_PAGE_FINISHED` | al finalizar una página | `NerPageFinished` | async | sí |
| `NER_FINISHED` | al finalizar todas las páginas | `NerFinished` | async | sí |
| `ENTITY_FOUND` | por cada ocurrencia detectada | `EntityFound` con `occurrence.source = "ner"` | async | sí |

Canal: `EventChannel.Ner`.

**Dónde se emite cada uno (ADR-046 §1/§4/§6)**: los seis se emiten **siempre en host** (ADR-013 §6), desde la clase `NerEngine`; el kernel del worker no emite ningún evento de dominio ni tiene bus puente. `NER_MODEL_LOADING`/`NER_MODEL_READY` se derivan de los reportes `PROGRESS` del kernel (`NerKernelProgress`, `03_Data_Model.md` §18): `phase: "model-loading"` → un `NER_MODEL_LOADING` con `progress`; `phase: "model-ready"` → `NER_MODEL_READY` **una sola vez por instancia del motor** (con `nerPoolSize: 2`, el segundo worker carga su propio modelo y reporta un `model-ready` que no es un cambio de estado observable); `phase: "model-load-retry"` no es un evento: es un `logger.warn` con el mensaje de `NerModelLoadFailedError`. Orden garantizado por construcción: `NER_MODEL_READY` precede al primer `ENTITY_FOUND` porque ambos salen del mismo hilo host, en la misma ruta de código.

---

## 8. Eventos que consume

No consume eventos.

---

## 9. Entradas

```ts
NerPageInput {
  documentId: string;
  pageIndex: number;
  text: string;        // Page.text normalizado
  words: ReadonlyArray<Word>;  // para mapear bbox
}
```

**Restricciones**:
- `text.length > 0`. Si `text === ""`, retorna con `occurrences = []` sin error.
- `words` debe estar ordenado por `bbox.y` asc, luego `bbox.x` asc (lo garantiza PDF Engine).
- `pageIndex >= 0`.

---

## 10. Salidas

```ts
NerPageOutput {
  documentId: string;
  pageIndex: number;
  occurrences: ReadonlyArray<Occurrence>;
  durationMs: number;
}
```

Cada `Occurrence`:
- `source: DetectionSource.NER`
- `entityType ∈ {Person, Organization, Address, Date}` (mapeo de los labels `PER`/`ORG`/`LOC`/`DATE` del modelo, ADR-023 §2)
- `confidence ∈ [0,1]` (score del modelo)
- `bbox` mapeado desde las `Word` que cubren el span detectado. **Invariante de `bbox.rotation` (ADR-066 §6)**: la unión de bboxes construye un `BoundingBox` **nuevo**, así que `rotation` se propaga explícitamente y **solo si todas las palabras del span coinciden en el ángulo**; si discrepan queda **ausente** (≡ 0, `Contracts.md` §5). Sin esa propagación el campo se cae en silencio y el pintado rotado de ADR-066 §7 nunca se activa. Mismo defecto y mismo criterio que en `Regex_Engine.md` §10, del que esta función es adaptación (P-2 prohíbe importarla).
- `fragments?: ReadonlyArray<BoundingBox>` — **la descomposición por línea del span (ADR-074 §2)**, y acá pega más fuerte que en Regex: **el caso medido es de este motor**. Sobre la pericia real, `Pablo Román Fortes` (`Person`) tiene `Pablo` al final de un renglón y `Román Fortes,` al principio del siguiente, y la envolvente da **557,2 × 18,2 pt** — casi el ancho útil de la página, dos líneas de alto, todo tapado. El span se parte en corridas de la misma línea con `sharesVerticalBand` de `@anonly/shared` (§4) y se emite un rectángulo por corrida, en orden de lectura; con **una sola** corrida el campo queda **ausente** (≡ `[bbox]`) y la ocurrencia es idéntica a la previa. `bbox` sigue siendo la envolvente y no cambia de valor ni de usos. **El span rotado no se fragmenta** (ADR-074 §3): con `rotation` presente en alguna palabra, un run vertical daría un fragmento por palabra y su envolvente ya es apretada. Mismo criterio y misma función que `Regex_Engine.md` §10, de la que ésta es adaptación.
- `normalizedValue` lowercase, sin puntuación redundante
- `wordSpan: WordSpan` referenciando las `Word` que componen la entidad

Las `Occurrence` también se emiten vía `ENTITY_FOUND` (incremental).

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `NER_MODEL_MISSING` | `NerModelMissingError` | el modelo no está cacheado y no se pudo descargar | no | abortar NER, ofrecer descargar manual o desactivar NER |
| `NER_MODEL_LOAD_FAILED` | `NerModelLoadFailedError` | el modelo descargado no carga (corrupto, incompatible) | sí | re-descargar una vez, si persiste abortar |
| `NER_PAGE_FAILED` | `NerPageFailedError` | error de inferencia en una página | sí | reintentar 1 vez; si persiste, descartar ocurrencias NER de esa página (las Regex se mantienen) |
| `NER_TIMEOUT` | `NerTimeoutError` | timeout por página (default 20 s) | sí | reintentar 1 vez, luego `NER_PAGE_FAILED` |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `processPage` antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `processPage` tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined | no | bug del caller |

`retryable`: `NER_MODEL_LOAD_FAILED = true`, `NER_PAGE_FAILED = true`, `NER_TIMEOUT = true`. Resto `false`.

**Dónde se originan y cómo cruzan (ADR-046 §2/§4)**: `NER_MODEL_MISSING`, `NER_MODEL_LOAD_FAILED` y `NER_TIMEOUT` nacen en el **kernel** (es donde corren `pipeline()` y la inferencia). `NER_MODEL_LOAD_FAILED` no cruza como error: el kernel lo reporta como `phase: "model-load-retry"` y reintenta una vez (§13 caso 8), y el host lo registra como `warn` — sin puente `LOG` en el worker. Los otros dos cruzan como `FAILED` y el motor los re-instancia por `code` antes de aplicar su política de reintento: `NER_TIMEOUT` reintenta dentro del loop; `NER_MODEL_MISSING` aborta NER y se propaga tal cual (no se envuelve en `NerPageFailedError`), como cuando `ensureModelLoaded` corría fuera del loop. `NER_PAGE_FAILED`, `ENGINE_NOT_INITIALIZED`, `ENGINE_DISPOSED` e `INVALID_INPUT` son host-side puros.

---

## 12. Consideraciones de rendimiento

- Corre en `NerPool` (1–2 workers default), propiedad del propio motor desde ADR-046 §2/§7: la pool la construye el façade en `create-core.ts` y se inyecta por constructor; el Orchestrator ya no envuelve `processPages` en `pool.dispatch`. Un despacho por batch (`ceil(words / batchSize)` por página, típicamente 1–3 con el default de 256): el costo de mensajería es despreciable frente a la inferencia. **Desde ADR-088 §1 los batches se cortan además en cada cambio de `bbox.rotation`**, así que una página con runs rotados hace más despachos —uno por run, cada uno más corto— y una página sin texto rotado hace exactamente los mismos que antes.
- Costo: 5–15 s por página de texto denso.
- Memoria: 200–400 MB por worker (modelo + sesión de inferencia).
- Modelo cacheado en Cache Storage (~150–180 MB Q8 para mBERT, ADR-023). Lazy: solo descarga la primera vez.
- Sin transferencia zero-copy de `text` (es string, se serializa normal).
- Paralelismo: pool despacha en paralelo respetando `nerPoolSize`. Backpressure si `queue > 8`.
- Cancelación: checkpoints entre batches de inferencia (cada `batchSize` palabras — proxy de tokens, ADR-024 §2, o antes si cambia la orientación, ADR-088 §1: los bordes de corrida solo **agregan** checkpoints), en el **loop host-side** del motor, más el mensaje `CANCEL` del protocolo para el batch en vuelo (ADR-046 §3). SLA < 200 ms.
- Modelo reutilizado entre jobs del mismo worker (no se recarga por página): el kernel retiene su pipeline y solo lo re-crea si cambia `(modelId, dtype)`.
- Si `deviceMemory < 4` GB, el Orchestrator serializa NER con OCR (no paralelos) para no exceder memoria.
- WebGPU: si está disponible y el modelo lo soporta, se puede usar como backend faster (v1.0+). MVP usa WASM.

---

## 13. Casos límite

1. **Texto vacío**: `occurrences = []` sin error.
2. **Texto sin entidades**: `occurrences = []`.
3. **Nombre compuesto (`Juan Pérez García`)**: el modelo debe detectar el span completo; el motor lo mapea a las `Word` correspondientes y produce una sola `Occurrence`.
4. **Múltiples entidades en la misma página**: una `Occurrence` por entidad detectada.
5. **Confidence baja (`< 0.7`)**: la `Occurrence` se emite con `confidence` real; Grouping la marca como conflicto `low_confidence`.
6. **Overlap con Regex (un DNI también matcheado como Organization por error del NER)**: Grouping resuelve con conflicto `disagree`; gana Regex (determinístico).
7. **Modelo no descargado (primera vez)**: `NER_STARTED` indica `modelLoading: true` (campo opcional de `NerStarted`, ADR-024 §1; omitido si el modelo ya está cacheado). `NER_MODEL_LOADING` reporta progreso. `NER_MODEL_READY` al final. La UI muestra "Descargando modelo NER…".
8. **Modelo corrupto en cache**: `NER_MODEL_LOAD_FAILED` → re-descargar → si persiste, `NER_MODEL_MISSING`.
9. **Worker crashea (OOM)**: pool reemplaza, reintenta el job.
10. **Cancelación a mitad de página**: aborta en < 200 ms, libera sesión temporal, responde `CANCELLED`. El modelo cargado no se descarta.
11. **NER desactivado en settings**: `init` no carga modelo, `processPage` retorna con `occurrences = []` sin error. Solo Regex detecta.
12. **WebGPU disponible pero deshabilitado por config**: usa WASM. Sin error.
13. **`processPage` tras `dispose`**: lanza `EngineDisposedError`.
14. **Texto en idioma no soportado por el modelo**: el modelo multilingüe lo maneja con menor precisión. No lanza error; `confidence` será más baja.
15. **Fecha escrita en palabras ("3 de mayo de 2024")**: el modelo la emite como `Date`. Si la misma fecha en formato numérico también la detecta Regex, la deduplicación no es responsabilidad de NER: Grouping resuelve por overlap (gana mayor `confidence`; Regex emite 1.0 y siempre gana). Ver ADR-023 §2.
16. **`wasmPaths` inyectado por config (ADR-039)**: `configureTransformersEnv()` asigna el valor recibido tal cual a `env.backends.onnx.wasm.wasmPaths` (string u objeto `{wasm?, mjs?}`) y no lo sobreescribe con el default. Ausente → default `/wasm/onnxruntime/` (comportamiento previo). Desde ADR-046 §5 esa función vive en el **kernel** (es donde se carga el modelo) y el valor viaja en `NerPagePayload.wasmPaths` — no en `INIT`, que `WorkerPool` todavía no transporta con la config real (gap conocido, compartido con Pdf/Render/Ocr). Semántica sin cambios; lo que cambia es dónde se verifica.
17. **Segundo worker del pool cargando su propio modelo**: cada worker carga el modelo en su primer job y reporta su propio `model-ready`. El motor emite `NER_MODEL_READY` **una sola vez por instancia** (el primero); los siguientes no producen evento. `NER_MODEL_LOADING` sí se emite por cada reporte de progreso recibido (la segunda carga suele ser un hit de Cache Storage, rápida).
19. **Dos runs rotados de márgenes opuestos** (ADR-088 §1): el folio a 270° del margen izquierdo y el sello a 90° del derecho quedan contiguos en `Page.text` (ADR-067 §4), pero se clasifican en **batches distintos**: ninguna `Occurrence` puede abarcar palabras de los dos. Sin esa separación el modelo los lee como una oración y produce una entidad de media página que Grouping después descarta por solapamiento — el caso medido de §23a. Una página sin texto rotado produce los mismos batches que antes del ADR. **Consecuencia sobre §10**: la regla de ADR-066 §6 —si las palabras del span discrepan en el ángulo, `rotation` queda ausente— sigue vigente en `mapSpanToWords` como defensa en profundidad, pero ninguna ruta de `processPage` puede producir un span así; lo que se afirma en §14 es la garantía más fuerte que la reemplaza.
20. **Texto en caja alta** (ADR-088 §2): una corrida de dos o más palabras consecutivas sin minúsculas y sin punto-seguido-de-letra se clasifica en Title Case; el `value` del span sale con la **caja original**. `PERITO CARLOS LOPEZ` pasa de no detectarse a `Person` con 0,999. **No** se transforman, y es deliberado: `DNI 34.567.891` (el número no tiene letras, así que `DNI` queda sola y una palabra no es corrida) ni `S.A., CUIT` (`S.A.,` tiene punto seguido de letra, corta la corrida) — sin ese guard, medido, la organización del cuerpo caía de 0,995 a 0,792 de confianza. Una palabra cuya transformación cambiaría de longitud se deja intacta.
21. **Un `B-` sobre una continuación de wordpiece** (v1.3.1): el modelo etiqueta a veces `##presa` como `B-ORG` después de `Em`. No abre un span nuevo — un subword no puede empezar una entidad. Medido sobre `qa-tables-justified.pdf`: sin esta regla, `"Empresa S.A."` produce **dos** grupos espurios (`"Em"` y `"presa S.A"`), que es el hallazgo §23f del gate manual. Un `B-` que **no** es continuación sigue abriendo span: dos entidades pegadas siguen siendo dos.
22. **Un lote que excede el presupuesto de tokens del modelo** (v1.4.0, ADR-098): se parte en sub-lotes por límite de palabra antes de inferir, y los spans vuelven a coordenadas del lote. Sin esto, `truncation: true` descarta la cola **en silencio**: medido sobre `doc-026` del dataset de referencia, las dos entidades posteriores al corte de 512 tokens no las ve nadie (recall 1/3). El corte se busca con el tokenizer, no estimando por una razón promedio — la razón va de 1,42 en prosa a 6,12 en identificadores puros.
23. **El pipeline descarta los tokens `O`** (ADR-111 §1): `TokenClassificationPipeline._call` de @huggingface/transformers default a `ignore_labels: ['O']`. Medido: **21 tokens para una página de 1887 caracteres**, contra 466 pidiéndolos todos. `aggregateTokensToSpans` cierra el span abierto justo en esa rama (`flush()` ante un label no soportado) y `positionTokens` usa los `O` como anclas de su cursor; sin ellos, un `B-PER "D"` se ubicó **776 caracteres antes** de su posición real y nada cerró el span — una `Person` de **785 caracteres**, tres párrafos. El kernel pide `ignore_labels: []`. `aggregation_strategy` se deja en `"none"`: la agregación nativa no devuelve offsets de carácter, y sin offsets no hay bbox.
24. **Una continuación de wordpiece con etiqueta distinta a la del span abierto** (ADR-111 §2): lo **extiende**, no abre uno nuevo. Es la regla del caso 21 completa — un subword no empieza una entidad, ni con `B-` ni cambiando de tipo. Medido: `Florencio Varela` salía `Address "Floren"` + `Organization "cio Varela"`; `CARRAL`, en cuatro entidades. Con `open === null` una continuación sí abre: ahí no hay nada que extender, y ese resto lo cubre el caso 25.
25. **Un span que empieza o termina a mitad de palabra** (ADR-111 §3): primero, dos spans del **mismo tipo** dentro de una **misma palabra** se fusionan (entre los dos no hay ningún carácter que no sea de palabra; la confianza es la del trozo más largo) — el caso `Ju` + `gado` que abre el `O` restituido por §1. Después, cada span se extiende hasta el borde de palabra (`\p{L}`/`\p{N}`) **sin pisar al vecino**: el inicio se topa contra el fin del anterior y el fin contra el inicio del siguiente, así que dos spans de **tipos distintos** en una misma palabra quedan separados. Una entidad tapa palabras enteras: `Echeve` tapado deja `rría` a la vista. El `value` se recorta de `chunkText` (el texto impreso, caso 20) y `normalizedValue` se recalcula. Sobre 8 documentos: 48 spans mal cortados → 0.
26. **La clave de agrupado no lleva diacríticos** (ADR-118): `normalizedValue` sale de `normalizeEntityValue` (`@anonly/shared`), **la misma función que usa la vía manual** — no de una copia local del kernel. `Muñíz`, `MUÑÍZ,` y `muñíz` dan `muniz`. El `value` conserva lo impreso, así que en pantalla el acento sigue estando. Costo aceptado: dos apellidos que difieren solo en un diacrítico (`Peña`/`Pena`) pasan a ser un grupo — el producto ya lo aceptaba para la vía manual y para el léxico de género (ADR-061 §2), y sobre un escaneo perder el acento en el OCR es más frecuente que la homonimia por acento.
18. **Error de inferencia originado en un worker remoto**: llega deserializado (instancia genérica con el `code` correcto, `Contracts.md` §4). El motor lo re-instancia por `code` antes de decidir: `NER_TIMEOUT` se reintenta igual que el local; `NER_MODEL_MISSING` aborta NER; cualquier otro corta el loop y produce `NerPageFailedError` para esa página. La política observable es idéntica con pool real y con fallback in-process (ADR-035).

---

## 14. Casos de prueba

**Tests de sobre, obligatorios (ADR-055 §5)** — son los que no existían y por los que el bug de la nota v1.2.1 pasó los 911 tests, los 203 de contrato y los 12 escenarios E2E. Los fakes de pool preexistentes **ejecutan `run()`**, o sea el camino in-process: ninguno cruza la frontera del worker.

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `decodes the remote envelope { spans } from NerWorker` | `unit.test.ts` | unit | pool fake que **ignora `run()`** y resuelve exactamente lo que postea `worker/entry.ts`; se emiten `ENTITY_FOUND × N` y `NER_PAGE_FINISHED` con `occurrenceCount > 0` |
| `decodes the in-process bare array identically` | `unit.test.ts` | unit | mismo fake resolviendo `[...]`; resultado idéntico al de arriba (paridad remoto/in-process) |
| `throws on an unrecognized dispatch result` | `edge.test.ts` | edge | el fake resuelve `{}` / `null` / un string → `InvalidInputError`, y el error **no** se traga silenciosamente aguas arriba |

Verificación del propio test: revirtiendo el decoder, el primero de los tres tiene que fallar. Si no falla, no está probando lo que dice.

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits NER_STARTED before pages` | `contract.test.ts` | contract | invariante |
| `emits NER_MODEL_READY before first ENTITY_FOUND` | `contract.test.ts` | contract | invariante |
| `emits ENTITY_FOUND per occurrence` | `contract.test.ts` | contract | invariante |
| `emits NER_FINISHED after all pages` | `contract.test.ts` | contract | invariante |
| `occurrence.source === "ner"` | `contract.test.ts` | contract | invariante |
| `occurrence.entityType ∈ {Person, Organization, Address, Date}` | `contract.test.ts` | contract | invariante |
| `confidence ∈ [0,1]` | `unit.test.ts` | unit | rango |
| `bbox mapped correctly to words` | `unit.test.ts` | unit | mapping |
| `propagates rotation when every word of the entity agrees on the angle` | `unit.test.ts` | unit | ADR-066 §6: `mapSpanToWords` arma un bbox nuevo y el campo se caía en silencio |
| `omits rotation when the words of the entity disagree on the angle` | `unit.test.ts` | unit | ADR-066 §6: la envolvente de dos avances no tiene ángulo que la describa |
| `leaves rotation absent for horizontal text` | `unit.test.ts` | unit | ADR-066 §6: no regresión (ausente ≡ 0) |
| **`an entity split across two lines emits one occurrence with two fragments`** | `unit.test.ts` | unit | ADR-074 §2 — **el test que define el ADR** de este lado, y el motor donde se midió: `Pablo` / `Román Fortes` en renglones distintos |
| `a single-line entity carries no fragments and its bbox is unchanged` | `unit.test.ts` | unit | ADR-074 §1 — **no-regresión** del caso normal |
| `three lines produce three fragments in reading order` | `unit.test.ts` | unit | ADR-074 §2 |
| `a rotated entity carries no fragments and keeps its rotation` | `unit.test.ts` | unit | ADR-074 §3 — la interacción con las tres filas de arriba |
| `bbox is the exact envelope of fragments, which never overlap` | `contract.test.ts` | contract | ADR-074 §1 — el invariante que aserta que fragmentar no puede filtrar nada |
| `empty text returns empty occurrences` | `edge.test.ts` | edge | caso 1 |
| `text without entities returns empty` | `edge.test.ts` | edge | caso 2 |
| `multi-word name produces single occurrence` | `edge.test.ts` | edge | caso 3 |
| `low confidence still emitted with real value` | `edge.test.ts` | edge | caso 5 |
| `model loading progress reported` | `edge.test.ts` | edge | caso 7 |
| `corrupt model triggers re-download` | `edge.test.ts` | edge | caso 8 |
| `OOM worker replaced and retried` | `stress.test.ts` (en `tests/stress/`) | stress | caso 9 |
| `cancel within 200ms` | `cancel.test.ts` | cancel | caso 10 |
| `disabled NER returns empty occurrences without loading model` | `edge.test.ts` | edge | caso 11 |
| `written-out date mapped to Date` | `edge.test.ts` | edge | caso 15 |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 13 |
| `injected wasmPaths applied verbatim, not overridden by default` | `edge.test.ts` | edge | caso 16 (ADR-039; cubre string y objeto; desde ADR-046 se verifica en el kernel) |
| `absent wasmPaths falls back to /wasm/onnxruntime/` | `edge.test.ts` | edge | caso 16 (ADR-039) |
| `kernel spans match the in-process path on the shared fixture` | `worker/__tests__/kernel.test.ts` | unit | ADR-046 §1 |
| `kernel reports model-loading progress then model-ready` | `worker/__tests__/kernel.test.ts` | unit | ADR-046 §4 |
| `kernel retries model load once, reports model-load-retry, then throws NerModelMissingError` | `worker/__tests__/kernel.test.ts` | unit | ADR-046 §4 (caso 8) |
| `entry-point rejects a jobType other than ner-page` | `worker/__tests__/entry.test.ts` | unit | ADR-046 §Validación |
| `entry-point CANCEL aborts the in-flight batch and answers CANCELLED` | `worker/__tests__/entry.test.ts` | unit | caso 10 |
| `every dispatch uses maxRetriesOverride: 0` | `contract.test.ts` | contract | ADR-046 §2 |
| `same six events, payloads and order with and without injected pool` | `contract.test.ts` | contract | fallback ADR-035 |
| `NER_MODEL_READY emitted once per instance across several model-ready reports` | `unit.test.ts` | unit | caso 17 |
| `deserialized NER_TIMEOUT is retried; deserialized NER_MODEL_MISSING aborts` | `unit.test.ts` | unit | caso 18 |
| `never puts words that disagree on the angle in the same occurrence` | `unit.test.ts` | unit | caso 19 — **reemplaza** a `omits rotation when the words of the entity disagree on the angle`: con el batch por corrida esa situación ya no se puede producir |
| `a page with no rotated text produces the same chunks as before ADR-088` | `unit.test.ts` | unit | caso 19 — la no regresión de §1; sin esto el corte por corrida puede cambiar el batching de todo documento sin que nadie lo note |
| `a 90° run and a 270° run never share a batch` | `unit.test.ts` | unit | caso 19 |
| `a rotated run longer than batchSize is still split by batchSize` | `unit.test.ts` | unit | caso 19 — el corte por corrida agrega bordes, no los saca |
| `chunk offsets still point at the same slice of Page.text` | `unit.test.ts` | unit | caso 19 — el invariante que hace que los offsets de los spans sigan siendo absolutos |
| `does not let a wordpiece continuation tagged B- split an entity in two` | `worker/__tests__/kernel.test.ts` | unit | caso 21 — los tokens son los medidos sobre `qa-tables-justified.pdf` |
| `still opens a new span on a B- that is not a continuation` | `worker/__tests__/kernel.test.ts` | unit | caso 21 — la no regresión: dos entidades pegadas siguen siendo dos |
| `asks the pipeline for every token, O included` | `worker/__tests__/kernel.test.ts` | unit | caso 23 — el default `ignore_labels: ['O']` de la librería es lo que rompe a los dos consumidores |
| `closes a span on an unlabelled token instead of swallowing the text between two entities` | `worker/__tests__/kernel.test.ts` | unit | caso 23 — el doble **filtra como la librería**, así que este test falla si el kernel deja de pedir todos los tokens |
| `positions a short token at its real offset, not at the first match in the chunk` | `worker/__tests__/kernel.test.ts` | unit | caso 23 — el caso `D'Amoroso` medido, reducido |
| `extends the open span when a continuation carries a different label` | `worker/__tests__/kernel.test.ts` | unit | caso 24 — `Florencio Varela` medido sobre el fallo escaneado |
| `still starts a new span when a NON-continuation changes label` | `worker/__tests__/kernel.test.ts` | unit | caso 24 — la no regresión: la regla es sobre subwords, no sobre cambios de tipo |
| `extends a span that starts mid-word up to the start of the word` | `worker/__tests__/kernel.test.ts` | unit | caso 25 |
| `does not invade the neighbouring span when both fall inside the same word` | `worker/__tests__/kernel.test.ts` | unit | caso 25 — el clamp; sin él quedan dos entidades idénticas superpuestas |
| `merges two spans of the same type that fall inside the same word` | `worker/__tests__/kernel.test.ts` | unit | caso 25 — `Juzgado` partido por un `O` a mitad de palabra, medido sobre un oficio real |
| `does not merge two spans of the same type separated by a space` | `worker/__tests__/kernel.test.ts` | unit | caso 25 — la no regresión de la fusión: dos palabras pueden ser dos entidades |
| `leaves a span already aligned to word boundaries untouched` | `worker/__tests__/kernel.test.ts` | unit | caso 25 — §3 es no-op en el caso común |
| `recomputes normalizedValue when the span grows` | `worker/__tests__/kernel.test.ts` | unit | caso 25 — `normalizedValue` es función de `value`; dejarlo viejo son dos campos que se contradicen |
| `strips diacritics so the key matches what the manual path produces` | `worker/__tests__/kernel.test.ts` | unit | caso 26 (ADR-118) — `muñíz`/`muniz` daban 0,600 y se partían |
| `produces a span whose normalizedValue has no diacritics but whose value keeps them` | `worker/__tests__/kernel.test.ts` | unit | caso 26 (ADR-118) — la distinción que hace que la UI no cambie |
| `an all-caps run is classified in Title Case and keeps its original casing in value` | `worker/__tests__/kernel.test.ts` | unit | caso 20 |
| `"S.A., CUIT" and "DNI 34.567.891" are never transformed` | `worker/__tests__/kernel.test.ts` | unit | caso 20 — el guard de acrónimos y el mínimo de dos palabras |
| `text without any all-caps run is classified verbatim` | `worker/__tests__/kernel.test.ts` | unit | caso 20 — la no regresión de §2 |
| `a word whose case mapping changes length is left intact` | `worker/__tests__/kernel.test.ts` | edge | caso 20 |
| `recall ≥ 85% on reference dataset` | `perf.test.ts` (en `tests/perf/`) | perf | gate de v1.0 |
| `precision ≥ 90% on reference dataset` | `perf.test.ts` | perf | gate de v1.0 |
| `snapshot of occurrences for text-10p.pdf stable` | `snapshot.test.ts` | snapshot | fixture |

Fixtures: `tests/fixtures/text-10p.pdf` con nombres/organizaciones/direcciones/fechas conocidos (fechas tanto numéricas como escritas en palabras), dataset de referencia para recall/precision.

---

## 14.1. Limitaciones medidas del modelo

> Medidas el 2026-08-27 con el **modelo real** (`Xenova/bert-base-multilingual-cased-ner-hrl`, q8) corriendo en Chromium sobre el dataset de referencia, vía `pnpm test:measure` (`tests/measure/`). Son del **modelo**, no del código: no se arreglan con un cambio de motor, y esta sección existe para que no se vuelvan a diagnosticar como un defecto de implementación.

### Direcciones: reconoce ciudades, se pierde domicilios

El concepto de `ADDRESS` del modelo **no es el del dominio**. Sobre `"con domicilio en Rivadavia 4820"` devuelve `B-LOC:Riva I-LOC:##da I-LOC:##via` — la calle **sin el número**.

Medido sobre el dataset de referencia, las direcciones que **no** se cubren son todas de calle + número:

```
ADDRESS "Maipú 1434"       ADDRESS "Belgrano 5983"
ADDRESS "Pueyrredón 9741"  ADDRESS "Pueyrredón 2584"
```

Y en el otro sentido, el modelo emite topónimos que el ground truth no enumera —`"Buenos Aires"`, `"La Plata"`, `"Tucumán"`, `"Mar del Plata"`— que son correctos pero **no son un domicilio**.

Es la misma limitación vista desde los dos lados: el modelo resuelve **lugares**, y lo que el producto necesita tapar es un **domicilio postal**. Un domicilio anonimizado a medias —con el número a la vista— no cumple el propósito de censura.

**Implicancia para el gate de v1.0** (`MVP.md` §5, recall de NER ≥ 85 %): el recall de `ADDRESS` no lo va a alcanzar con este modelo solo. Las salidas plausibles, ninguna decidida: extender el span del modelo hasta el número contiguo con una regla de post-proceso, cubrir el domicilio con un patrón de `regex-engine` (precedente: ADR-092, la carátula que el modelo veía por debajo del umbral y terminó siendo un patrón), o cambiar de modelo. **Ninguna de las tres está evaluada.**

### Ruido de bajo valor semántico

El modelo tipa como `ORGANIZATION` cosas que no lo son: la sigla `"DNI"` suelta, `"Estado"`, `"San Miguel"` (un lugar), y una vez el fragmento `"fono de contacto"` — que **arranca a mitad de palabra**, y ese sí puede ser un defecto de offsets del motor y no del modelo; no está diagnosticado.

También aparece `PERSON "I"`, una sola letra.

Nada de esto lo frena hoy el umbral de sugerencia de ADR-094 (`MIN_SUGGESTION_CONFIDENCE = 0.5`, que el propio ADR marca como **no medido**): en la corrida del dataset, las sugerencias dieron **0**. Ahora hay con qué calibrarlo.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/ner-engine/`.
- [ ] 2. Definir `types.ts` con `NerPageInput`, `NerPageOutput` (`NerConfig` viene de `@anonly/shared`/Contracts.md §6; ADR-023).
- [ ] 3. Definir `errors.ts` con `NerModelMissingError`, `NerModelLoadFailedError`, `NerPageFailedError`, `NerTimeoutError`.
- [ ] 4. Implementar `ner.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. ~~Implementar `init` (crear `NerPool`, …)~~ **Superseded por ADR-046 §2**: el motor no crea su pool — la recibe por constructor (`new NerEngine(pool?)`); la carga del modelo Q8 y el cache en Cache Storage viven en el kernel, perezosos en su primer job.
- [ ] 6. Implementar `processPage` con `AbortSignal`, checkpoints entre batches, emisión `ENTITY_FOUND` por ocurrencia, mapeo bbox (todo host-side desde ADR-046 §1).
- [ ] 7. Implementar `processPages` (ordena por prioridad visible, despacha al pool, backpressure).
- [ ] 8. Implementar `isModelReady`/`getModelId` para que la UI consulte estado.
- [ ] 9. Implementar `dispose` (libera sesión de ONNX y memoria temporal; NO descarga el modelo cacheado).
- [ ] 10. Cablear eventos emitidos contra `IEventBus`.
- [ ] 11. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 12. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 13. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 14. Escribir `snapshot.test.ts` con occurrences de `text-10p.pdf`.
- [ ] 15. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 16. Verificar `index.ts` exporta solo `NerEngine`, tipos, errores.
- [ ] 17. Verificar imports sin dependencias prohibidas (`grep -r 'react\|pdfjs\|pdf-lib\|tesseract' src/`).
- [ ] 18. Verificar test de cancelación < 200 ms.
- [ ] 19. Validar integrity del modelo al cargar (hash de `assets.lock.json`, ver `08_Security_Model.md` §8.3 y ADR-018) y configurar Transformers.js/onnxruntime-web contra el origen propio (`env.localModelPath`, `env.wasm.wasmPaths`).

### PR15 — NerWorker (ADR-046)

- [ ] 20. Extraer a `src/worker/kernel.ts` la inferencia y todo lo acoplado a la librería: `configureTransformersEnv` (ADR-039/§5 del ADR), carga perezosa del pipeline con su política de dos intentos, `classifyWithTimeout`, `positionTokens` y `aggregateTokensToSpans`. Exporta `kernelClassify(payload, { timeoutMs, abortSignal, onProgress })` → `ReadonlyArray<NerKernelSpan>` y `kernelDispose()`. Sin bus, sin logger, sin cache: no emite eventos ni loguea (espejo de `ocr-engine/src/worker/kernel.ts`).
- [ ] 21. Escribir `src/worker/entry.ts` como kernel puro (espejo de `ocr-engine/src/worker/entry.ts`): `INIT`/`READY`, `RUN(ner-page)` → `COMPLETED { spans }`, `PROGRESS` con `NerKernelProgress` en `partial`, `CANCEL` por `signalId`, `DISPOSE`. `jobType` distinto de `ner-page` → `FAILED`. Agregar el subpath `"./worker"` al `package.json` del paquete.
- [ ] 22. Reescribir `ner.engine.ts` como clase host-side: puerto interno `NerJobPool` + `IMMEDIATE_POOL` + `constructor(pool?)`; despacho por batch con `maxRetriesOverride: 0` y `priority: 80`; normalización por `code` de `NER_TIMEOUT`/`NER_MODEL_MISSING` en el borde del puerto; traducción de `onProgress` a `NER_MODEL_LOADING`/`NER_MODEL_READY` (dedup por instancia) y a `logger.warn` para `model-load-retry`; flag `modelWarm` para `isModelReady()`/`NerStarted.modelLoading`; `dispose()` invoca `kernelDispose()` directo (no por el puerto).
- [ ] 23. Costuras ajenas sancionadas por ADR-046 §4/§7: `DispatchParams.onProgress` en `worker-pool.ts` (enrutar `PROGRESS` por `jobId` al job pendiente en vez de descartarlo); `create-core.ts` construye el `NerPool` (sin `onWorkerCreated`) e inyecta `new NerEngine(nerPool)` y lo dispone; `orchestrator.ts` deja de envolver `processPages` en `pools.getPool("ner").dispatch(...)` en `runDetectionStage` **y** en `runReanalyzeNerOnFlow`; wiring de la factory `ner` en la app (`apps/react-client`).
- [ ] 24. Tests nuevos de §14 (kernel, entry-point, contract del despacho, dedup de `NER_MODEL_READY`, normalización por `code`) + glob de cobertura de `worker/**` del paquete en `vitest.config.ts`. Gates completos verdes.
- [x] 25. (Hito 10.8 — ADR-066 §6) `mapSpanToWords`: propagar `bbox.rotation` a la `Occurrence`, solo si **todas** las palabras del span coinciden en el ángulo; si discrepan, ausente (§10). **No** tocar la geometría de la unión. Tres filas nuevas en §14. Espejo del item 19 de `Regex_Engine.md`.
- [x] 26. (Hito 10.9, PR 6 — ADR-074 §2/§3) `mapSpanToWords`: partir las `Word` del span en corridas de la misma línea con `sharesVerticalBand` de `@anonly/shared` (§4) y emitir un rectángulo por corrida en `Occurrence.fragments`; con una sola corrida, o con `rotation` presente, **no emitir el campo** (§10). **No** tocar `bbox`, `wordSpan` ni la propagación de `rotation` del item 25. Espejo exacto del item 20 de `Regex_Engine.md` — y es este motor el que produjo el caso medido. Cinco filas nuevas en §14.

- [ ] 27. (ADR-088 §1) `computeWordChunks`: cortar también en cada cambio de `bbox.rotation` entre palabras consecutivas (ausente ≡ `0`, `Contracts.md` §5), conservando `batchSize` como máximo **dentro** de cada corrida y el cálculo de offsets tal cual. **No** tocar el orden de lectura de `pdf-engine` ni la forma de `NerPagePayload`. Cuatro filas nuevas en §14, caso 19 de §13.
- [ ] 28. (ADR-088 §2) Kernel: transformar a Title Case las corridas en caja alta del texto del batch **solo para la inferencia**, posicionar los tokens contra el texto transformado y cortar los `value` de `NerKernelSpan` del texto **original**. La corrida son ≥2 palabras consecutivas con letras, sin minúsculas y sin `/\.\p{L}/u`; una palabra cuya transformación cambia de longitud se deja intacta. **No** tocar `aggregateTokensToSpans` ni la forma de `NerKernelSpan`. Cuatro filas nuevas en §14, caso 20 de §13.

- [x] 29. (ADR-111 §1) `classifyWithTimeout`: invocar el pipeline con `{ ignore_labels: [] }`. **No** pasar `aggregation_strategy` — la agregación nativa de la librería no devuelve offsets de carácter y sin offsets no hay bbox. El doble de los tests tiene que **filtrar como filtra la librería** (`mockPipelineHonouringIgnoreLabels`), o ningún test puede notar una regresión acá. Tres filas nuevas en §14, caso 23 de §13.
- [x] 30. (ADR-111 §2) `aggregateTokensToSpans`: una continuación de wordpiece con etiqueta distinta **extiende** el span abierto en vez de abrir uno nuevo (`open.label !== label && !token.isContinuation`). Con `open === null` sigue abriendo. **No** tocar la regla del `B-` de v1.3.1 ni el derivado del `label` crudo. Dos filas nuevas en §14, caso 24 de §13.
- [x] 31. (ADR-111 §3) `aggregateTokensToSpans`: pasar los spans por `snapSpansToWordBoundaries` antes de devolverlos. Primero `coalesceSpansInsideTheSameWord` (mismo `entityType` y nada entre medio que no sea carácter de palabra → un solo span, con la confianza del trozo más largo); después el inicio se extiende hacia atrás y el fin hacia adelante mientras el carácter contiguo sea `\p{L}`/`\p{N}`, con el inicio topado contra el fin del span anterior y el fin contra el inicio del siguiente. `value` se recorta de `chunkText` y `normalizedValue` se recalcula. **No** tocar la forma de `NerKernelSpan` ni el orden de los spans. Seis filas nuevas en §14, caso 25 de §13.

---

## Referencias

- `architecture/06_Pipeline.md` §7 (etapa 5, NER)
- `architecture/05_Worker_Architecture.md` §7.3 (NerWorker)
- `architecture/07_Performance_Strategy.md` §2.3 (carga de modelos)
- `architecture/08_Security_Model.md` §8.3 (integridad de modelos)
- `adr/ADR-006-NER-Local.md` (decisión de Transformers.js + ONNX)
- `adr/ADR-002-No-Backend.md` (NER local)
- `adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md` (reparto host/worker de PR15; espejo de ADR-043/ADR-045)
- `adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md` §4 (los runs contiguos al final de `Page.text` — la entrada que ADR-088 §1 corta por corrida)
- `adr/ADR-088-El-Texto-Que-Recibe-El-NER.md` §1 (batch por corrida rotada), §2 (Title Case solo para inferir)
