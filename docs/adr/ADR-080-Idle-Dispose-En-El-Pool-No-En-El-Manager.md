<!-- CONTEXT: scope=adr | dependencias=architecture/05_Worker_Architecture.md,architecture/07_Performance_Strategy.md,core/Contracts.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-047-ExportEngine-Ensamblador-Worker-Dedicado.md | audiencia=humanos+IA | fase=post-10.9 -->

# ADR-080 — El temporizador de idle-dispose vive en el `WorkerPool`, no en el manager

- **Estado**: Accepted
- **Fecha**: 2026-08-19
- **Decidido por**: El humano, al revisar las observaciones no bloqueantes del Hito 10 (`roadmap/Hito10_Observaciones_Plan_De_Resolucion.md` §6.3 punto J).
- **Relacionado con**: **ADR-043/045/046/047**, que sacaron los cuatro pools pesados del `WorkerPoolManager` y, sin notarlo, los dejaron sin idle-dispose. `05_Worker_Architecture.md` §8 (la regla de los 60 s), el gate **`test:leak`** del Hito 11.
- **Parte de**: cierre de las observaciones del Hito 10.

> Convención de citas: `ADR-080 §N` refiere a **Decisión §N**.

## Contexto

### 1. Cuatro de los cinco pools perdieron el idle-dispose por efecto colateral

`05_Worker_Architecture.md` §8 dice: *"Cada pool puede destruirse tras `DOCUMENT_CLOSED` + `idle` por > 60 s para liberar memoria."*

Lo implementa `WorkerPoolManager` (`worker-pool.ts:844`, `idleTimers` + `touch()`). Pero ADR-043/045/046/047 movieron los pools de `render`, `ocr`, `ner` y `export` a `create-core.ts`, que los construye e inyecta directo a cada motor. Verificado: el único `getPool(...)` vivo hoy es `getPool("pdf")` (`orchestrator.ts:879`).

O sea que el manager administra **un solo pool**, y los cuatro pesados —incluido el que carga 178 MB de modelo— **no tienen ningún mecanismo de liberación por inactividad**. Nadie lo decidió; es residuo de cuatro migraciones que tenían otro objetivo.

### 2. Qué retiene la app hoy

La creación perezosa **sí** funciona: quien nunca abre un PDF escaneado nunca instancia el OcrWorker. Pero una vez creado, el worker vive hasta que se cierra la pestaña. Cerrar el documento (`CloseDocumentButton`, ADR-051) libera el estado por documento —`unload-document`, blob URLs, snapshot— y **no** libera los workers:

- **NerWorker**: ~178 MB de modelo cuantizado, más el runtime de onnxruntime-web.
- **RenderWorker × `renderPoolSize`** (4 por defecto): cada uno con su instancia de pdf.js.
- **OcrWorker**: la instancia de tesseract con sus idiomas cargados.

Un usuario que procesa cinco pericias seguidas en una sesión no acumula documentos, pero mantiene todo eso vivo desde el primero.

### 3. Se cruza de frente con el gate `test:leak` del Hito 11

`07_Performance_Strategy.md` §11.3 item 7 y §11.4 definen `tests/leak/`: 10 ciclos abrir/cerrar documento, verificando que la memoria vuelve al baseline. Con los workers retenidos, ese gate **nace en rojo** — y por una causa que no es una fuga: es retención deliberada de un recurso caro que nadie se acordó de soltar.

### 4. Y el mecanismo que sí existe mide lo que no es

`WorkerPoolManager.touch()` reinicia el temporizador **en cada `getPool(key)`**, o sea que mide "tiempo desde el último *acceso al pool*", no "tiempo sin trabajo". Un job largo sin nuevos `getPool` intercalados puede ver su pool dispuesto por abajo. Hoy no se manifiesta —el pool de pdf recibe un `getPool` por cada dispatch, así que el timer se reinicia solo—, pero es la definición equivocada de "idle", y copiarla a los cuatro pools restantes propagaría el defecto.

Esto es lo que hace que la decisión no sea mecánica: no alcanza con "poner el timer también en los otros cuatro".

## Decisión

### 1. El temporizador vive en `WorkerPool`

`WorkerPoolOptions` gana `idleDisposeMs?: number`. El propio pool arma el temporizador, porque es el único que sabe cuándo está de verdad ocioso: ya lleva `active` (jobs corriendo), `queue` (encolados), `pendingRemoteJobs` e `inFlightBroadcasts`.

**Definición de ocioso**, las cuatro condiciones a la vez:

```
active === 0  &&  queue.length === 0  &&  pendingRemoteJobs.size === 0  &&  inFlightBroadcasts.size === 0
```

Las dos últimas no son redundantes: un job remoto en vuelo cuyo worker todavía no respondió puede tener `active` ya en 0 según el camino, y un `broadcast` de re-priming **no pasa por la cola ni por `pump()`** (`assignRemoteSlot`, ADR-043 §5), así que no se cuenta en ninguna de las dos primeras. Sin la cuarta condición, un idle-dispose podría caer justo sobre un re-priming en curso.

### 2. Qué reinicia el temporizador: terminar trabajo, no pedirlo

El timer se **rearma** cada vez que el pool pasa a ocioso (al liquidar el último job pendiente), y se **cancela** en cuanto entra un job. No se rearma "al acceder al pool": eso es lo que hace hoy el manager y es la definición equivocada (Contexto §4).

Consecuencia deseada: un pool con un job de 10 minutos no se dispone a los 60 segundos.

### 3. Qué hace el dispose, y qué NO hace

Al vencer, el pool ejecuta la parte de `dispose()` que libera **workers**: `terminate()` de cada `WorkerLike` vivo y limpieza de `remoteWorkers`. **El pool sigue usable**: el próximo `dispatch` reconstruye el worker por el camino perezoso de siempre (`workerForSlot`), y para el `RenderPool` lo re-primea con `onWorkerCreated` (ADR-043 §5) antes del primer job.

Es la diferencia central con `dispose()`, que es terminal (marca `disposed = true` y rechaza todo lo que venga). Se introduce como método separado, `releaseIdleWorkers()`, justamente para que nadie confunda "liberé los workers" con "maté el pool".

Esto además **corrige** el comportamiento del manager: hoy `touch()` llama `pool.dispose()` y borra el pool del mapa, así que el pool de pdf muere de verdad y se reconstruye entero. Pasa a usar el mismo `releaseIdleWorkers()`.

### 4. Quién lo configura

`create-core.ts` pasa `idleDisposeMs: mergedConfig.workerPool.idleDisposeMs` a los cuatro pools que construye. **El campo ya existe** en `WorkerPoolConfig` (`shared/src/interfaces.ts:110`, default 60000, `Contracts.md` §6): no hay contrato nuevo, solo un consumidor que faltaba.

`idleDisposeMs: 0` desactiva el mecanismo — necesario para los tests, que no pueden depender de temporizadores reales.

### 5. Qué NO cambia

- **La creación perezosa** (`05` §8 primera mitad) ya funcionaba y no se toca.
- **`DOCUMENT_CLOSED` no dispara nada.** El spec dice "tras `DOCUMENT_CLOSED` + idle > 60 s", pero el pool no escucha el bus (no debe: es infraestructura, no motor). La condición de ocioso de §1 es **más general** y cubre el caso: cerrar un documento deja de generar jobs, así que el pool cae en ocioso solo. Se precisa la redacción de §8 en vez de acoplar el pool a un evento.
- **Ningún evento nuevo.** La telemetría `WORKER_JOB_*` no cambia.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Copiar `idleTimers` del manager a los cuatro motores** | Multiplica por cuatro la definición equivocada de "idle" (Contexto §4) y mete lógica de infraestructura en cada motor, que es justo lo que ADR-043/045/046 sacaron de ahí. Además viola R-1: un cambio, cuatro módulos. |
| **Que `create-core.ts` orqueste el dispose** (un timer global que observe los cuatro pools) | El façade no tiene visibilidad de `active`/`queue`/`pendingRemoteJobs` sin exponerlos, y exponerlos para esto agranda la superficie de `WorkerPool` mucho más que agregarle el timer. |
| **Que el Orchestrator lo dispare en `DOCUMENT_CLOSED`** | Acopla la liberación a un evento de dominio. Un usuario que abre un documento y lo deja quieto 20 minutos sin cerrarlo no libera nada, que es un caso tan real como el otro. |
| **No hacer nada y ajustar el gate `test:leak`** | Es cambiarle la vara al gate para que pase. Los 178 MB retenidos son reales. |

## Consecuencias

**Positivas**: `05` §8 vuelve a ser cierto para los cinco pools; el gate `test:leak` del Hito 11 puede nacer en verde; el `pdf` pool deja de reconstruirse entero para liberar sus workers; la definición de "ocioso" queda escrita y en un solo lugar.

**Negativas / riesgos asumidos**:

- **El primer job después de un idle paga el arranque en frío** — para el NerWorker, volver a cargar 178 MB de modelo. Es el trade-off explícito de §8 (memoria contra latencia), y el default de 60 s es de `WorkerPoolConfig`, ajustable sin tocar código.
- Un `setTimeout` vivo por pool ocioso. Trivial, y se limpia en `dispose()`.
- El re-priming del `RenderPool` vuelve a correr tras cada idle-dispose. Es idempotente (ADR-030) y ya está documentado como redundante-pero-inofensivo.

## Validación

- Un pool con `idleDisposeMs` corto libera sus workers tras el último job, y **no** antes: con un job en vuelo, o con un `broadcast` en vuelo, el timer no vence.
- Tras el idle-dispose, un `dispatch` nuevo funciona: reconstruye el worker y, si el pool tiene `onWorkerCreated`, lo invoca **antes** del primer job.
- `idleDisposeMs: 0` (y ausente) no arma ningún temporizador.
- `dispose()` sigue siendo terminal: tras él, `dispatch` rechaza — o sea que `releaseIdleWorkers()` y `dispose()` no se confunden.
- El pool de pdf, vía el manager, sigue funcionando tras un idle (hoy se reconstruye entero; pasa a conservar la instancia).

## Documentos afectados

- `architecture/05_Worker_Architecture.md` §8 (definición de ocioso; `releaseIdleWorkers` vs. `dispose`).
- `core/Contracts.md` §6: nota de que `idleDisposeMs` pasa a tener consumidor en los cinco pools (el valor y el default no cambian).
- Código, un solo módulo: `packages/anonymization-core/src/{worker-pool.ts,create-core.ts}`.
