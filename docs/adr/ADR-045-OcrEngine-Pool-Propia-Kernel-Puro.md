<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,core/Orchestrator.md,architecture/05_Worker_Architecture.md,architecture/03_Data_Model.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md | audiencia=humanos+IA | fase=10 -->

# ADR-045 — OcrEngine dueño de su pool: la clase queda host-side, el worker corre un kernel de reconocimiento sin estado (espejo de ADR-043)

- **Estado**: Accepted
- **Fecha**: 2026-07-24
- **Decidido por**: El humano (opción A del fork bloqueante de PR14), con requisito explícito: el flujo incremental por página — `OCR_PAGE_FINISHED` a medida que cada página termina, fusión inmediata, progreso visible — es **no negociable** y se preserva por construcción.
- **Relacionado con**: ADR-014 (§1: "las `Word[]` las deposita en `ctx.cache` el **lado host** del `OcrPool`" — este ADR lo restaura literalmente), ADR-021 (§2: fuente única de timeout/retries), ADR-035 (fallback in-process bit-idéntico), ADR-036 (§1: patrón "el entry-point corre el motor real" — **segunda desviación sancionada acá**, precedente ADR-043 para render), ADR-038 (§5.3: `reanalyze` con `ocr.languages` nuevos), ADR-043 (el patrón que este ADR replica)

## Contexto

PR14 completó la parte no ambigua (tests del motor, host-bridge genérico) y se detuvo en el fork: cómo hacer real el despacho a `OcrWorker`. El plan original — el Orchestrator despacha un job `ocr-page` por página y el pool hereda el retry — dejó **cuatro problemas sin resolver**, verificados contra el código:

1. **Carrera EVENT/COMPLETED (bug destapado por el implementador)**: con el motor corriendo dentro del worker (entry-point actual, patrón ADR-036 §1 literal), `processPage` deposita las `Word[]` en `ctx.cache` y emite `OCR_PAGE_FINISHED` **dentro del worker** (`ocr.engine.ts:287-294`). El evento viaja al host por el puente `EVENT` y las palabras por el mensaje `COMPLETED` — dos mensajes sin orden garantizado entre sí. Peor: la cache del worker es **local e invisible para el host** (gap ya documentado en la cabecera de `ocr-engine/src/worker/entry.ts`); el Orchestrator, al recibir `OCR_PAGE_FINISHED`, leería la cache host vacía y fusionaría una página sin texto. Esto contradice ADR-014 §1, que siempre exigió el depósito en el **lado host**.
2. **Retry duplicado**: `processPage` ya tiene su loop de reintentos (`OcrTimeoutError` × `maxRetries`, `ocr.engine.ts:258-303`); el pool tiene el suyo (`05_Worker_Architecture.md` §5). Compuestos, hasta `(maxRetries+1)²` reconocimientos por página.
3. **Ownership de eventos partido**: `OCR_STARTED`/`OCR_FINISHED` los emite `processPages` (que quedaría en el host) y `OCR_PAGE_FINISHED`/`OCR_PAGE_FAILED` saldrían del worker — el mismo motor emitiendo desde dos lados de la frontera.
4. **Cambio de contrato mayor**: resolver 1–3 dentro del plan original exigiría retirar `processPages` del motor y mover la emisión de `OCR_STARTED`/`OCR_FINISHED` al Orchestrator — nivel de cambio ADR-041, con mecanismos nuevos sin precedente en el repo.

El repo ya contiene la solución, probada con gates verdes en PR13 (ADR-043): motor host-side dueño de su pool + kernel puro en el worker. Y la arquitectura objetivo ya la describía: `05_Worker_Architecture.md` §7.2 define al OcrWorker como `RUN(ocr-page) → COMPLETED { words, confidence }` — **sin bus, sin cache, sin eventos de dominio**: un kernel.

## Decisión

### 1. Reparto: la clase `OcrEngine` queda entera host-side; el worker corre un kernel de reconocimiento

La clase conserva **todo**: el loop secuencial por página de `processPages` (checkpoint de cancelación entre páginas), el retry/timeout por página de `processPage`, la emisión de los cuatro eventos y el depósito en `ctx.cache` — que vuelve a ser host-side, como ADR-014 §1 siempre especificó. La secuencia por página es una sola ruta de código en el host: `resultado del kernel` → `ctx.cache.set` → `emit OCR_PAGE_FINISHED`; la carrera EVENT/COMPLETED deja de existir por construcción, no por parche. El worker corre un **kernel sin estado por documento**: recibe `OcrPagePayload`, reconoce con tesseract.js, devuelve `{ words, confidence }` por `COMPLETED`. Su único estado es la instancia de tesseract con su set de idiomas cargado (y el cache del modelo en IndexedDB, como hoy).

**Segunda desviación sancionada de ADR-036 §1** ("el entry-point corre el motor real"): para OCR, "el motor real" del worker es el kernel — la clase con eventos y cache no cruza la frontera. Precedente: ADR-043 §1 (render).

### 2. Puerto interno `OcrJobPool` con constructor opcional (espejo exacto de `RenderJobPool`)

`new OcrEngine(pool?)`: el façade inyecta el `OcrPool` real en `create-core.ts` (mismo wiring que `new RenderEngine(renderPool)`); sin argumento, un fallback inmediato invoca el kernel in-process — bit-idéntico ADR-035, y lo que los tests existentes del motor ya esperan. Lo único que cruza el puerto es el reconocimiento:

```ts
this.pool.dispatch({ jobType: "ocr-page", payload /* OcrPagePayload */, run: () => kernelRecognize(payload), signal, maxRetriesOverride: 0 })
```

- **`maxRetriesOverride: 0`** (ya existe en `worker-pool.ts`): el pool no reintenta; el único loop de retry es el del motor, que preserva la distinción existente entre `OcrTimeoutError` (reintenta) y el resto (corta y emite `OCR_PAGE_FAILED` tras agotamiento).
- **Normalización de timeout en el borde del puerto**: `recognizeWithTimeout` sigue envolviendo la llamada; cualquier timeout que emerja del despacho (el del propio motor o uno del pool) se normaliza a `OcrTimeoutError` antes del loop de retry, para que la política de reintentos no cambie de forma según el modo.
- La transferencia zero-copy de `imageData` (`postMessage(msg, [imageData.data.buffer])`, §2.3) la resuelve el pool en modo remoto, como hoy.

### 3. El entry-point se reescribe como el kernel de §7.2

`worker/entry.ts` (construido en la parte previa de PR14 como envoltorio del motor) se reescribe como kernel puro: `INIT`/`READY`, `RUN(ocr-page)` → `COMPLETED { words, confidence }`, `CANCEL` por `signalId` (checkpoint vía callback de progreso de tesseract), `DISPOSE`. **Sin bus puente, sin cache local** — mueren los dos gaps documentados en su cabecera actual. `PROGRESS` opcional (§7.2). Idiomas: el kernel retiene el set cargado; un payload con un set distinto re-crea la instancia de tesseract con los idiomas nuevos — cubre `reanalyze` con `ocr.languages` (ADR-038 §5.3) sin mensaje de control nuevo. La lógica de reconocimiento (`toWords`, confidence, tesseract setup first-party ADR-018) se extrae del motor al módulo del kernel; el motor in-process la invoca vía el fallback (mismo código, un solo lugar).

### 4. Eventos y semántica pública intactos

`OCR_STARTED`/`OCR_PAGE_FINISHED`/`OCR_FINISHED`/`OCR_PAGE_FAILED`: mismos payloads, mismo orden, emitidos siempre en host (ADR-013 §6 se cumple naturalmente, sin puente). `OCR_STARTED.modelLoading` (ADR-024): la señal pasa de `this.worker !== null` a un flag equivalente de la instancia host ("ningún reconocimiento completado aún"), válido en ambos modos — misma semántica per-instancia que hoy. **El flujo incremental por página no cambia en nada**: una página termina → cache → `OCR_PAGE_FINISHED` → fusión inmediata (ADR-014/041) → progreso en UI.

### 5. Qué no cambia

Interfaz pública de `OCR_Engine.md` §6 (solo se agrega el constructor opcional, igual que RenderEngine); `OcrPagePayload`/`WorkerInbound`/`WorkerOutbound` (`03_Data_Model.md` §18 ya coincide con lo que el kernel necesita); tamaños/timeouts del `OcrPool`; el loop secuencial por página (el despacho paralelo de páginas dentro del motor queda como mejora futura, no requisito); la mediación de fusión del Orchestrator (ADR-014/041) — no se entera del cambio.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Opción B — el Orchestrator despacha por página** (plan original) | Deja los 4 problemas del Contexto sin resolver; obligaría a retirar `processPages` y mover `OCR_STARTED`/`OCR_FINISHED` al Orchestrator (cambio de contrato mayor) e inventar mecanismos de ordenamiento EVENT/COMPLETED sin precedente. La carrera del punto 1 amenazaba justamente el flujo incremental por página que es requisito. |
| **Híbrido: pool como único dueño del retry** (motor sin loop propio) | Pierde la distinción `OcrTimeoutError`-reintenta / resto-no del motor (el `retryPredicate` del pool es genérico) y la emisión de `OCR_PAGE_FAILED` tras agotamiento vive en el motor — habría que duplicar esa lógica en el host-bridge. |
| **OCR in-process permanente** (no migrar a worker) | Tesseract bloquea el main thread 3–10 s por página (§12); incumple el objetivo del Hito 10 y la tabla de PRs (ADR-038 §8, PR12–16). |

## Consecuencias

**Positivas**: las cuatro preguntas del fork se resuelven con un patrón ya probado en el repo (cero mecanismos nuevos); se restaura ADR-014 §1 literal (depósito host-side); los dos gaps documentados del entry-point actual (cache local invisible, eventos por puente) desaparecen con el puente mismo; el fallback in-process queda bit-idéntico sin código condicional en el motor; el flujo incremental por página — requisito del humano — queda garantizado por una única ruta de código host-side.

**Negativas**: se reescribe `worker/entry.ts` recién construido (costo hundido de la parte previa de PR14; la lógica de mensajería `RUN`/`CANCEL`/`FAILED` se reaprovecha, cambia qué ejecuta); `ocr.engine.ts` se toca más de lo que la opción B tocaba el motor (extracción del reconocimiento al kernel + puerto) — contenido en un solo paquete, sin cambio de contrato público.

**Neutras**: memoria por worker igual (150–300 MB, el modelo); el handshake `INIT`/`READY` conserva el mismo gap conocido que Pdf/Render (el pool no envía `INIT`; el kernel se auto-inicializa con defaults) — no se resuelve acá, mismo criterio que PR12/PR13.

## Docs actualizados por este ADR

- `core/OCR_Engine.md` v1.2.0: nota de cabecera, §2, §6 (constructor `pool?`), §12, §14 (tests nuevos), §15 (items 19–21 de PR14).
- `architecture/05_Worker_Architecture.md` §7.2 (ciclo de vida reescrito como kernel) y nota del patrón de §1 en la cabecera (segunda excepción).
- `roadmap/Hito10_Observaciones_Revision.md`: entrada PR14 (fork resuelto).

## Validación

- Unit del kernel: `RUN(ocr-page)` devuelve `{ words, confidence }` idéntico al camino in-process (fixture compartida); payload con `languages` distinto re-crea la instancia tesseract.
- Contract del motor: interfaz §6 sin cambios de firma; despacho con `maxRetriesOverride: 0` (el pool nunca reintenta un `ocr-page`); `ctx.cache.set` ocurre **antes** de `OCR_PAGE_FINISHED` en el host; timeout del despacho normalizado a `OcrTimeoutError` y reintentado por el loop del motor; eventos idénticos con y sin pool (fallback ADR-035).
- Edge: `CANCEL` en vuelo → `CancelledError` sin `OCR_PAGE_FAILED`; fallo no-timeout → sin reintento + `OCR_PAGE_FAILED`; `processPages` continúa con las demás páginas (caso 6 del spec).
- Integration/E2E de PR14: pipeline con PDF escaneado real vía OcrWorker (fixture diferida de PR12, ADR-041); `OCR_PAGE_FINISHED` incremental observable en UI; gates completos verdes al cierre.

## Referencias

- `core/OCR_Engine.md` §6–§8, §12 — `architecture/05_Worker_Architecture.md` §2.3, §5, §7.2 — `architecture/03_Data_Model.md` §18 (`OcrPagePayload`)
- `adr/ADR-014` §1 — `adr/ADR-021` §2 — `adr/ADR-024` — `adr/ADR-035` — `adr/ADR-036` §1/§3 — `adr/ADR-038` §5.3 — `adr/ADR-041` §5 — `adr/ADR-043` §1–§2
- `packages/anonymization-core/ocr-engine/src/ocr.engine.ts` (loop de retry, depósito+emisión por página) — `packages/anonymization-core/ocr-engine/src/worker/entry.ts` (entry actual con los gaps documentados) — `packages/anonymization-core/render-engine/src/render.engine.ts` (`RenderJobPool`/`IMMEDIATE_POOL`, el espejo) — `packages/anonymization-core/src/worker-pool.ts` (`maxRetriesOverride`) — `packages/anonymization-core/src/create-core.ts` (wiring `new RenderEngine(renderPool)`)
