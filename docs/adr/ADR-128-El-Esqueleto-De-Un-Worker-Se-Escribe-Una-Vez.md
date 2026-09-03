<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/05_Worker_Architecture.md,roadmap/Duplicacion_De_Logica.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-127-El-Solapamiento-De-Dos-Rectangulos-Se-Escribe-Una-Vez.md | audiencia=humanos+IA | fase=11 -->

# ADR-128 — El esqueleto de un worker se escribe una vez

- **Estado**: Accepted
- **Fecha**: 2026-09-03
- **Decidido por**: El humano, que pidió eliminar código y lógica repetida a partir del inventario de `roadmap/Duplicacion_De_Logica.md`, priorizando por riesgo.
- **Relacionado con**: `Duplicacion_De_Logica.md` §1 (el ítem de mayor riesgo de la lista), ADR-036 §2 (transporte de workers reales), ADR-127 (el precedente inmediato: una primitiva duplicada se promueve a `shared`)
- **Parte de**: Hito 11

## Contexto

### 1. El mismo esqueleto, cinco veces

`pdf-engine`, `ocr-engine`, `ner-engine`, `render-engine` y `export-engine` tienen cada uno su `worker/entry.ts`, y los cinco repiten la misma máquina:

- `WORKER_ID` con sufijo aleatorio y `WORKER_CAPABILITIES`.
- Un `post()` alrededor de `self.postMessage`.
- Un `Map<signalId, AbortController>` con un controller por job.
- Un `handleRun` que rechaza el `jobType` desconocido con `InvalidInputError`, crea el controller, corre, y mapea el resultado a `COMPLETED` o el error a `CANCELLED` / `FAILED(err.serialize())` / `FAILED(InvalidInputError(mensaje))`, borrando la entrada del `Map` en el `finally`.
- Un `handleCancel` que aborta por `signalId`.
- El `addEventListener("message")` con el switch `INIT` / `RUN` / `CANCEL` / `DISPOSE`.
- El `READY` eager del final.

Los propios archivos lo admiten: *"mismo mecanismo que PdfWorker/RenderWorker"*, *"mismo patrón que `render-engine/src/worker/entry.ts`"*, *"mismo criterio que `render-engine`"*.

### 2. Que ya divergió no es una hipótesis

Verificado sobre el árbol: la firma de `post()` **no es la misma en los cinco**.

| motor | firma de `post()` |
|---|---|
| `pdf-engine` | `post(message: WorkerOutbound)` |
| `ocr-engine` | `post(message: WorkerOutbound)` |
| `ner-engine` | `post(message: WorkerOutbound)` |
| `render-engine` | `post(message, transfer?: ReadonlyArray<Transferable>)` |
| `export-engine` | `post(message, transfer?: ReadonlyArray<Transferable>)` |

Los dos que transfieren llevan además un comentario sobre `StructuredSerializeOptions` que los otros tres no tienen, porque no lo necesitaron.

### 3. Por qué esto encabeza la lista por riesgo, y no por líneas

Es **el punto más sensible del transporte**: el mapeo de errores que cruzan la frontera, la cancelación por `signalId` y la limpieza del `Map`. Un arreglo de cancelación o de serialización de errores aplicado en un motor y olvidado en otro **no lo agarra ningún test**: cada motor tiene su propia suite, con su propio doble, y las cinco pasan.

Y hay una asimetría que lo empeora: los `entry.ts` son de los pocos archivos del repo que **no corren en ninguna suite unitaria** — solo se ejercitan de verdad en los escenarios E2E, que levantan la app con workers reales.

### 4. Lo que **no** es común, y por qué el esqueleto igual existe

Los cinco divergen en **seis** puntos, todos legítimos. El inventario había listado cinco; el sexto —el `CANCEL` de `export`— apareció migrando, y es exactamente el tipo de detalle que una migración mecánica pierde en silencio:

| Punto de variación | Quién lo usa |
|---|---|
| Qué campos de `EngineConfig` lee, y si el `READY` es inmediato o diferido | `pdf` difiere el `READY` hasta que `engine.init()` resuelve; los otros cuatro lo postean al aplicar la config |
| Qué hace el job | los cinco |
| Qué libera en `DISPOSE` | los cinco |
| Qué transferir en `COMPLETED` | `render` (el `bytes` del resultado) y `export` (el buffer, que **es** el resultado) |
| Mensajes fuera del ciclo RUN | `ner` postea `PROGRESS` desde el kernel; `pdf` postea `EVENT` y `LOG`, porque corre el motor real y ese motor emite y loguea |
| Trabajo extra al recibir `CANCEL` | `export` descarta ahí su `PDFDocument` parcial (ADR-047 §4) |

Ninguno de esos cinco toca el mapeo de errores, la cancelación ni la limpieza — que es exactamente lo que hay que dejar de copiar.

## Decisión

### 1. `startWorkerEntry` se promueve a `@anonly/shared`

Una factory que instala el ciclo de vida completo del entry-point y recibe, por definición, los cinco puntos de variación:

```ts
startWorkerEntry({
  workerId,          // prefijo; la factory le agrega el sufijo aleatorio
  jobType,           // el único que este worker acepta
  capabilities,
  applyConfig?,      // void | Promise<void>; el READY se postea cuando resuelve
  run,               // (payload, ctx) => Promise<unknown>
  dispose?,
  transferablesOf?,  // (result) => Transferable[]
});
```

`ctx` le da al job lo único que necesita del transporte: su `abortSignal`, su `jobId` y un `progress()` para el caso de `ner`.

`onCancel` es el sexto punto: trabajo extra al recibir `CANCEL`, **además** de abortar el signal. Se invoca aunque el `signalId` no corresponda a ningún job en vuelo, que es el comportamiento que `export` ya tenía.

**`applyConfig` puede devolver una promesa** y el `READY` se postea recién cuando resuelve. Eso absorbe la única divergencia de ciclo de vida real —la de `pdf`, que espera a `engine.init()`— sin un caso especial.

### 2. `postWorkerMessage` se exporta al lado

Es la válvula para lo que vive **fuera** del ciclo de un job: el puente de `EVENT`/`LOG` de `pdf`, que se arma una vez en `INIT` y no pertenece a ningún `RUN`. Exportarla es reconocer que ese puente existe, en vez de forzarlo dentro de un `run` al que no pertenece.

### 3. `shared` no importa nada de Web Workers

No hay `import` nuevo ni dependencia nueva: la factory referencia `self` **dentro del cuerpo de la función**, no en el módulo. Un consumidor que importe `@anonly/shared` desde el hilo principal —la app, los tests, cualquier motor— no ejecuta nada de esto y no paga nada. Es la razón por la que la primitiva puede vivir en un paquete que se bundlea a producción.

### 4. Los cinco motores migran, uno por commit

R-1: el commit que cambia el contrato (`shared` + `Contracts.md` + la factory) va solo; después, un commit por motor. No es una branch de campaña: es un contrato nuevo y cinco adopciones mecánicas, cada una verificable por separado.

## Consecuencias

- Una sola definición del mapeo de errores, la cancelación por `signalId` y la limpieza del `Map`. Un arreglo ahí llega a los cinco workers **por construcción**, que es lo que hoy no pasa.
- La divergencia de `post()` desaparece: la transferencia pasa a declararse por `transferablesOf`, que es una decisión del motor sobre **su** resultado, no una firma distinta del transporte.
- Un `entry.ts` nuevo deja de ser copiar 150 líneas y revisar cuáles aplicaban.

**En contra**

- **Un símbolo más en la superficie pública de `@anonly/shared`**, y uno que solo tiene sentido dentro de un Worker. Es el costo que ADR-127 y ADR-061 §2 ya aceptaron por el mismo motivo, con la diferencia de que éste no es una función pura.
- **`postWorkerMessage` es una válvula**, y las válvulas se usan de más. Su único caller legítimo hoy es el puente de `EVENT`/`LOG` de `pdf`; cualquier otro uso hay que mirarlo con desconfianza.
- **La migración no la cubre ninguna suite unitaria.** El gate real es E2E, y hay que correrlo completo después de cada motor migrado, no al final.

**Lo que no toca**: el protocolo `WorkerInbound`/`WorkerOutbound` (`Contracts.md`), `WorkerPool`, `WorkerPoolManager`, el reparto host/worker de cada motor, ni qué corre del otro lado (el motor completo en `pdf`, un kernel en los otros cuatro).

## Qué hay que cubrir con tests

La factory es la que gana los tests que hoy no tiene nadie, porque son los del transporte y no los de un motor:

- Un `jobType` que este worker no acepta → `FAILED` con `InvalidInputError`, y **sin** crear controller.
- Un `run` que resuelve → `COMPLETED` con el resultado, y la entrada del `Map` borrada.
- Un `run` que lanza `CancelledError` → `CANCELLED` con su `signalId` (no `FAILED`).
- Un `run` que lanza un `EngineError` → `FAILED` con `error.serialize()`.
- Un `run` que lanza algo que **no** es `EngineError` → `FAILED` con un `InvalidInputError` que conserva el mensaje.
- `CANCEL` con el `signalId` de un job en vuelo → su `abortSignal` se aborta; con un `signalId` desconocido → no lanza.
- `CANCEL` invoca `onCancel` **además** de abortar, incluso sin job en vuelo (el descarte del PDF parcial de `export`).
- `INIT` con `applyConfig` asíncrono → el `READY` se postea **después** de que resuelve.
- `transferablesOf` → lo que devuelve viaja en la transfer list; si devuelve vacío, `postMessage` se llama sin opciones.
- El `Map` queda vacío después de un job que falla, uno que se cancela y uno que sale bien.
