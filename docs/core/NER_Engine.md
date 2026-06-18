<!-- CONTEXT: scope=ner-engine | dependencias=core/Contracts.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,ADR-006-NER-Local.md | audiencia=IA-implementador | fase=3 -->

# NER Engine — Spec de Motor

> Detecta personas, organizaciones y direcciones mediante un modelo NER local (Transformers.js + ONNX Runtime Web). Emite `Occurrence[]` con `source: "ner"` y `confidence` según el modelo.

**EngineId**: `ner`
**Versión del spec**: 1.0.0
**Última actualización**: 2026-06-17

---

## 1. Objetivo

Aplicar un modelo NER local sobre `Page.text` y emitir `Occurrence[]` para entidades de tipo `Person`, `Organization` y `Address`, con `bbox` mapeado desde las `Word` correspondientes.

---

## 2. Responsabilidades

- Cargar el modelo ONNX cuantizado (Q8) vía Transformers.js en cada worker del `NerPool`.
- Tokenizar e inferir sobre `Page.text` por página.
- Mapear los spans detectados a `Occurrence` con `bbox` (resolviendo offsets de tokenización a spans de `Word`).
- Emitir `NER_STARTED`, `NER_MODEL_LOADING`, `NER_MODEL_READY`, `NER_PAGE_FINISHED`, `NER_FINISHED`.
- Emitir `ENTITY_FOUND` por ocurrencia (evento interno, escuchado por Grouping).
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
- `@xenova/transformers` (ADR-001, ADR-006)
- `onnxruntime-web` (ADR-001, ADR-006)
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `Word`, `Occurrence`, `EntityType`, `DetectionSource`, `NerConfig`
- `architecture/04_Event_System.md`: `NER_STARTED`, `NER_MODEL_LOADING`, `NER_MODEL_READY`, `NER_PAGE_FINISHED`, `NER_FINISHED`, `ENTITY_FOUND`

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor
- `pdfjs-dist`, `tesseract.js`, `pdf-lib`
- Node builtins (`fs`, `http`), libs de network (la descarga del modelo la hace Transformers.js desde su origen; documentado en ADR-006)

---

## 6. Interfaces públicas

```ts
export interface NerEngineConfig {
  readonly modelId: string;                  // default "Xenova/bert-base-NER"
  readonly quantization: "q8" | "q4" | "f32"; // default "q8"
  readonly confidenceThreshold: number;       // default 0.7
  readonly batchSize: number;                 // default 256 tokens
  readonly enabled: boolean;                  // default true
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
  init(ctx: EngineContext): Promise<void>;
  processPage(input: NerPageInput, ctx: EngineContext): Promise<NerPageOutput>;
  processPages(inputs: ReadonlyArray<NerPageInput>, ctx: EngineContext): Promise<ReadonlyArray<NerPageOutput>>;
  isModelReady(): boolean;
  getModelId(): string;
  dispose(): Promise<void>;
}
```

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
- `entityType ∈ {Person, Organization, Address}` (el modelo NER solo emite estos tres)
- `confidence ∈ [0,1]` (score del modelo)
- `bbox` mapeado desde las `Word` que cubren el span detectado
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

---

## 12. Consideraciones de rendimiento

- Corre en `NerPool` (1–2 workers default).
- Costo: 5–15 s por página de texto denso.
- Memoria: 200–400 MB por worker (modelo + sesión de inferencia).
- Modelo cacheado en Cache Storage (~60 MB Q8). Lazy: solo descarga la primera vez.
- Sin transferencia zero-copy de `text` (es string, se serializa normal).
- Paralelismo: pool despacha en paralelo respetando `nerPoolSize`. Backpressure si `queue > 8`.
- Cancelación: checkpoints entre batches de inferencia (cada `batchSize` tokens). SLA < 200 ms.
- Modelo reutilizado entre jobs del mismo worker (no se recarga por página).
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
7. **Modelo no descargado (primera vez)**: `NER_STARTED` indica `modelLoading: true`. `NER_MODEL_LOADING` reporta progreso. `NER_MODEL_READY` al final. La UI muestra "Descargando modelo NER…".
8. **Modelo corrupto en cache**: `NER_MODEL_LOAD_FAILED` → re-descargar → si persiste, `NER_MODEL_MISSING`.
9. **Worker crashea (OOM)**: pool reemplaza, reintenta el job.
10. **Cancelación a mitad de página**: aborta en < 200 ms, libera sesión temporal, responde `CANCELLED`. El modelo cargado no se descarta.
11. **NER desactivado en settings**: `init` no carga modelo, `processPage` retorna con `occurrences = []` sin error. Solo Regex detecta.
12. **WebGPU disponible pero deshabilitado por config**: usa WASM. Sin error.
13. **`processPage` tras `dispose`**: lanza `EngineDisposedError`.
14. **Texto en idioma no soportado por el modelo**: el modelo multilingüe lo maneja con menor precisión. No lanza error; `confidence` será más baja.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits NER_STARTED before pages` | `contract.test.ts` | contract | invariante |
| `emits NER_MODEL_READY before first ENTITY_FOUND` | `contract.test.ts` | contract | invariante |
| `emits ENTITY_FOUND per occurrence` | `contract.test.ts` | contract | invariante |
| `emits NER_FINISHED after all pages` | `contract.test.ts` | contract | invariante |
| `occurrence.source === "ner"` | `contract.test.ts` | contract | invariante |
| `occurrence.entityType ∈ {Person, Organization, Address}` | `contract.test.ts` | contract | invariante |
| `confidence ∈ [0,1]` | `unit.test.ts` | unit | rango |
| `bbox mapped correctly to words` | `unit.test.ts` | unit | mapping |
| `empty text returns empty occurrences` | `edge.test.ts` | edge | caso 1 |
| `text without entities returns empty` | `edge.test.ts` | edge | caso 2 |
| `multi-word name produces single occurrence` | `edge.test.ts` | edge | caso 3 |
| `low confidence still emitted with real value` | `edge.test.ts` | edge | caso 5 |
| `model loading progress reported` | `edge.test.ts` | edge | caso 7 |
| `corrupt model triggers re-download` | `edge.test.ts` | edge | caso 8 |
| `OOM worker replaced and retried` | `stress.test.ts` (en `tests/stress/`) | stress | caso 9 |
| `cancel within 200ms` | `cancel.test.ts` | cancel | caso 10 |
| `disabled NER returns empty occurrences without loading model` | `edge.test.ts` | edge | caso 11 |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 13 |
| `recall ≥ 85% on reference dataset` | `perf.test.ts` (en `tests/perf/`) | perf | gate de v1.0 |
| `precision ≥ 90% on reference dataset` | `perf.test.ts` | perf | gate de v1.0 |
| `snapshot of occurrences for text-10p.pdf stable` | `snapshot.test.ts` | snapshot | fixture |

Fixtures: `tests/fixtures/text-10p.pdf` con nombres/organizaciones/direcciones conocidos, dataset de referencia para recall/precision.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/ner-engine/`.
- [ ] 2. Definir `types.ts` con `NerEngineConfig`, `NerPageInput`, `NerPageOutput`.
- [ ] 3. Definir `errors.ts` con `NerModelMissingError`, `NerModelLoadFailedError`, `NerPageFailedError`, `NerTimeoutError`.
- [ ] 4. Implementar `ner.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. Implementar `init` (crear `NerPool`, cargar Transformers.js y modelo Q8 en cada worker, cache en Cache Storage).
- [ ] 6. Implementar `processPage` con `AbortSignal`, checkpoints entre batches, emisión `ENTITY_FOUND` por ocurrencia, mapeo bbox.
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
- [ ] 19. Validar SRI/integrity del modelo al descargar (ver `08_Security_Model.md` §8.3).

---

## Referencias

- `architecture/06_Pipeline.md` §7 (etapa 5, NER)
- `architecture/05_Worker_Architecture.md` §7.3 (NerWorker)
- `architecture/07_Performance_Strategy.md` §2.3 (carga de modelos)
- `architecture/08_Security_Model.md` §8.3 (integridad de modelos)
- `adr/ADR-006-NER-Local.md` (decisión de Transformers.js + ONNX)
- `adr/ADR-002-No-Backend.md` (NER local)
