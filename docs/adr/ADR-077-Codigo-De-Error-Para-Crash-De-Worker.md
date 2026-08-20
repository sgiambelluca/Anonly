<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/05_Worker_Architecture.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md | audiencia=humanos+IA | fase=post-10.9 -->

# ADR-077 — Un código de error propio para el crash de un Worker

- **Estado**: Accepted
- **Fecha**: 2026-08-19
- **Decidido por**: El humano, al revisar las observaciones no bloqueantes del Hito 10 (`roadmap/Hito10_Observaciones_Plan_De_Resolucion.md` §6.1 punto F).
- **Relacionado con**: **PR11 del Hito 10**, donde el revisor marcó esto como bloqueante y el humano eligió **diferirlo a los PR12-16** ("recién ahí hay un worker real contra el cual un reintento tiene sentido de verdad"). Los PR12-16 ya cerraron: los cinco workers son reales. **ADR-035 §3** (pools in-process retryables), **ADR-043 §5** (re-priming de workers nuevos), **ADR-049** (discriminación por `code`, no por subclase).
- **Parte de**: cierre de las observaciones del Hito 10.

> Convención de citas: `ADR-077 §N` refiere a **Decisión §N**.

## Contexto

### 1. El crash está a medio manejar, y la mitad que falta pierde trabajo en silencio

`05_Worker_Architecture.md` §9 especifica tres cosas ante un crash de worker: **marcar el worker muerto**, **reemplazarlo**, y **reintentar el job si es retryable**. Verificado contra `worker-pool.ts#handleWorkerTransportError`:

```ts
private handleWorkerTransportError(slot: number, _ev: unknown): void {
  this.remoteWorkers.delete(slot);
  for (const [jobId, pending] of this.pendingRemoteJobs) {
    if (pending.slotIndex !== slot) continue;
    this.pendingRemoteJobs.delete(jobId);
    pending.reject(new InvalidInputError(/* … */));
  }
}
```

Las dos primeras **sí** están: `remoteWorkers.delete(slot)` hace que el próximo `workerForSlot(slot)` construya un worker nuevo, y para el `RenderPool` ese worker nuevo se re-primea solo (`onWorkerCreated`, ADR-043 §5). La tercera **no**: los jobs en vuelo se rechazan con `InvalidInputError`, que se construye con `retryable: false` (`shared/src/errors.ts`), así que `isRetryable` da `false` y el pool no reintenta.

### 2. Por qué se eligió `InvalidInputError` y por qué esa razón caducó

No fue un descuido: **no existía ningún `EngineErrorCode` que significara "crash de transporte"**. Verificado contra `shared/src/enums.ts`: los 20 códigos son por-motor (`PDF_*`, `OCR_*`, `NER_*`, `RENDER_*`, `EXPORT_*`, `GROUPING_*`) o genéricos que no encajan (`ENGINE_NOT_INITIALIZED`, `ENGINE_DISPOSED`, `INVALID_INPUT`, `CANCELLED`). El implementador de PR11 reportó la ambigüedad en vez de inventar el código (I-4), y el humano difirió el manejo pleno a los PR12-16.

Esos PRs ya cerraron. La razón para diferir era "todavía no hay un worker real contra el cual validar un reintento"; hoy hay cinco, cada uno con su kernel y su re-priming.

### 3. Qué pierde el usuario, hoy, cuando un worker muere

El rechazo no-retryable atraviesa cada motor por su propio camino, y en los tres casos el resultado es **pérdida silenciosa de trabajo**, no un error visible:

| Worker que muere | Qué pasa | Qué ve el usuario |
|---|---|---|
| **RenderWorker** | Las páginas que estaba rasterizando rechazan. El motor no reintenta (`InvalidInputError` no es `RenderTimeoutError` ni retryable). | Esas páginas quedan **en blanco** en el visor. Sin banner: `RENDER_REQUESTED` es best-effort por diseño (`Render_Engine.md` §8). |
| **NerWorker** | El batch en vuelo rechaza. `normalizeNerError` lo deja pasar (no es timeout ni model-missing) → `NerPageFailedError` → `processPages` lo traga con `ctx.logger.warn`. | **Nada.** El logger de producción es el nulo (P-4). Esas páginas llegan a `Ready` sin entidades NER, indistinguible de "no había nada que detectar". Es exactamente la forma del bug 1 del cierre del Hito 10. |
| **OcrWorker** | Igual que NER: la página rechaza y el loop del motor no reintenta. | La página escaneada queda **sin texto** y por lo tanto sin entidades. Silencioso. |

En los tres, el **documento siguiente funciona bien** (el worker se reemplaza), lo que hace el síntoma todavía más difícil de atribuir: no es reproducible pidiéndole al usuario que reintente.

### 4. Por qué el reintento es la respuesta correcta acá y no un parche

Un crash de worker es la falla **transitoria por antonomasia**: el estado que la causó murió con el worker. El worker nuevo arranca limpio y —en el `RenderPool`— con su `load-document` ya re-enviado antes de aceptar el primer job. Reintentar el mismo payload contra ese worker nuevo es precisamente el caso de uso para el que existe el backoff del pool (`05` §9), y es lo que el spec ya manda desde el Hito 9.

## Decisión

### 1. `EngineErrorCode.WORKER_CRASHED`, genérico y retryable

Código nuevo en el bloque **Generic** de `EngineErrorCode` (`shared/src/enums.ts`), junto a `INVALID_INPUT`/`CANCELLED`:

```ts
WORKER_CRASHED = "WORKER_CRASHED",
```

Y su clase en `shared/src/errors.ts`, espejo de `InvalidInputError` salvo por el `retryable`:

```ts
export class WorkerCrashedError extends EngineError {
  readonly code = EngineErrorCode.WORKER_CRASHED;
  readonly engineId = "core" as const;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, true, details);   // retryable: el worker nuevo arranca limpio
  }
}
```

`engineId: "core"` y no el del motor dueño del pool: el crash es del **transporte**, no del dominio. Es la misma atribución que ya usan `InvalidInputError` y `CancelledError`, y la que hace que un solo código sirva para los cinco pools.

`retryable: true` es la única razón de ser de la clase. Con eso, `isRetryable` del pool (`err instanceof EngineError && err.retryable`) da `true` sin ningún caso especial, y el backoff que ya existe hace el resto.

### 2. `handleWorkerTransportError` lo usa, y nada más cambia

Un solo `throw` distinto. No se toca el orden (`remoteWorkers.delete(slot)` sigue primero, así que el reintento ya encuentra el slot vacío y construye el worker nuevo), ni `runWithRetry`, ni el backoff, ni `assignRemoteSlot`.

### 3. El límite: `maxRetriesOverride: 0` sigue ganando

Los tres motores con pool propia (`ocr`, `ner`, `export`) despachan con `maxRetriesOverride: 0` a propósito (ADR-045/046/047: retry único, el del motor). Ese override **no se toca**: para ellos, el crash sigue sin reintentarse *en el pool*.

Es deliberado y no anula esta decisión, porque lo que cambia es que el error ahora llega **clasificado** a esos motores: sus loops de retry sí lo reintentan, porque el criterio de esos loops es `isRetryable`/timeout, y hasta hoy `INVALID_INPUT` los hacía abandonar. O sea: **el pdf-pool reintenta en el pool; ocr/ner/export reintentan en el motor**. Los dos caminos quedan cubiertos por el mismo cambio de código.

### 4. Qué NO cambia

- **`deserialize()` sigue intacto** (ADR-049): `WorkerCrashedError` se instancia **en host**, del lado del `WorkerPool`, nunca cruza un `postMessage`. No hay problema de identidad de clase.
- **Ningún evento nuevo.** El crash no se observa por el bus; se observa como el fallo del job, que cada motor ya traduce a su evento de dominio.
- **La telemetría `WORKER_JOB_*`** no cambia de forma.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Dejar `InvalidInputError` y pasar `isRetryable` como override en cada dispatch** | Es el patrón que ADR-049 acaba de **retirar** del despacho de `pdf-parse`, por la misma razón: el override compensa desde afuera una clasificación que el error debería traer. Y habría que repetirlo en los cinco motores. |
| **Reutilizar un código por-motor** (`RENDER_FAILED`, `OCR_PAGE_FAILED`…) | Miente sobre la causa: el motor no falló, se murió su worker. Y obliga al pool —que es genérico— a saber qué motor lo está usando para elegir el código. |
| **Marcar `INVALID_INPUT` como retryable** | `INVALID_INPUT` significa "el input está mal": reintentarlo es garantía de volver a fallar. Cambiarlo rompería el resto de sus usos. |
| **Reintentar sin código nuevo, con un flag en `PendingRemoteJob`** | Mueve la decisión de retry fuera del error, que es justo donde `Code_Standards.md` §7 y ADR-049 la quieren. Y deja al motor sin forma de distinguir el crash de un fallo de dominio. |

## Consecuencias

**Positivas**: una clase entera de pérdida silenciosa desaparece (las tres filas de Contexto §3 pasan a recuperarse solas); la deuda que PR11 dejó registrada se cierra; `05` §9 pasa a ser cierto; el costo es un enum, una clase y un `throw`.

**Negativas / riesgos asumidos**:

- Un worker que **crashea de forma determinista** con un payload dado (no transitoria: por ejemplo un PDF que revienta el kernel) pasa de fallar una vez a fallar `maxRetries + 1` veces, cada una construyendo un worker nuevo. Acotado por `maxRetries` (2 por defecto) y por el backoff; el resultado final sigue siendo el mismo error, más tarde. Se acepta: la alternativa es no reintentar nunca el caso transitorio, que es el frecuente.
- El re-priming del `RenderPool` corre una vez por reintento. Es idempotente (`broadcast` de `load-document`, ADR-030) y ya se documenta como redundante-pero-inofensivo.

## Validación

- Un `PROGRESS`/`error` de transporte sobre un job pendiente lo rechaza con un error cuyo `code` es `WORKER_CRASHED` y cuyo `retryable` es `true`.
- Un pool **sin** `maxRetriesOverride` reintenta el job tras un crash y lo completa contra el worker nuevo (el test tiene que verificar que se construyó un worker nuevo, no solo que el job resolvió).
- Un pool **con** `maxRetriesOverride: 0` no reintenta, y el error que le llega al caller es `WORKER_CRASHED` (no `INVALID_INPUT`) — o sea que el motor puede decidir.
- El crash de un worker no afecta los jobs pendientes de **otro** slot.

## Documentos afectados

- `core/Contracts.md` §4 (tabla de `EngineErrorCode`).
- `architecture/05_Worker_Architecture.md` §9 (deja de describir un reintento que no ocurría).
- Código: `packages/anonymization-core/shared/src/{enums.ts,errors.ts,index.ts}` (**PR 1**) → `packages/anonymization-core/src/worker-pool.ts` (**PR 2**). En ese orden: el segundo importa lo que crea el primero.
