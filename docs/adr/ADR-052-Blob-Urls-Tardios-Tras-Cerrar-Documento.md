<!-- CONTEXT: scope=adr | dependencias=core/Orchestrator.md,core/Render_Engine.md,architecture/07_Performance_Strategy.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-051-Cerrar-Documento-Desde-El-Toolbar.md | audiencia=humanos+IA | fase=10 -->

# ADR-052 — Ningún blob URL sobrevive al cierre del documento, ni siquiera el que llega tarde

- **Estado**: Accepted
- **Fecha**: 2026-07-30
- **Decidido por**: El planificador, sobre una hipótesis que el implementador levantó al escribir el Escenario 7 de PR17.7 y reportó **sin arreglar ad hoc**, correctamente. La hipótesis se verificó contra el código y resultó cierta — y más ancha de lo reportado.
- **Relacionado con**: ADR-034 §5 (los motores crean los blob URLs, el Orchestrator los revoca — la regla que este ADR completa), ADR-044 §3 + `Orchestrator.md` v1.5.1 (el preview mediado y su señal propia), ADR-038 §6 (`cancelReanalyze`, la razón por la que esa señal existe), ADR-043 (el reparto host/worker de Render), ADR-051 (PR17.7, que hizo observable el ciclo open/close)

> Convención de citas: `ADR-052 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-052, Contexto §N`.

## Contexto

### 1. La ventana existe por construcción

`closeDocument` (`orchestrator.ts`) hace, en este orden: `abortRegistry.abort(documentId)` → `await render.unloadDocument(documentId)` → limpieza de mapas → `blobTracker.revokeByPrefix(previewPrefixFor(documentId))` y el equivalente de export → `state.delete` → emite `DOCUMENT_CLOSED`.

`handlePreviewUpdated`, en cambio, hace `blobTracker.set(...)` **incondicionalmente**, sin mirar si el documento sigue abierto. Si un `PREVIEW_UPDATED` llega después del barrido, su blob URL queda registrado en un tracker que nadie va a volver a barrer para ese `documentId` — no hay ningún cierre futuro que lo apunte. `handleExportFinished` tiene exactamente la misma forma (registra el blob sin condición; sí chequea `state.has`, pero solo para actualizar el stage).

No hace falta reproducirlo para saber que la ventana está: se lee en el código.

### 2. El preview mediado no es la única fuente — y esto es lo que el reporte no cubría

La hipótesis apuntaba a `mediatedPreviewCtx`, que crea un `AbortController` deliberadamente huérfano (nota v1.5.1 de `Orchestrator.md`: el seed tiene que sobrevivir al `abortRegistry.abort` que `cancelReanalyze` dispara antes de `finishSession`, ADR-038 §6). Es una fuente real. Pero hay dos más:

- **La vía por evento de Render**: `handleRenderRequested` usa `this.ctx`, el contexto que el motor recibió en `init()` (`create-core.ts`), no el del documento. O sea que **ningún** render originado en `RENDER_REQUESTED` es cancelable con `abortRegistry.abort(documentId)`. El Escenario 7 emite `RENDER_REQUESTED` desde la UI en cada ciclo, así que esta vía tiene la misma ventana que el preview mediado, sin tener nada que ver con ADR-044.
- **El export**: `EXPORT_FINISHED` tardío deja su blob URL registrado igual.

Consecuencia práctica: una decisión que solo toque el `mediatedPreviewCtx` **no cierra el agujero**.

### 3. "No registrar" no es un fix

La otra opción que el reporte dejaba planteada —que `handlePreviewUpdated`/`blobTracker` se nieguen a registrar blobs de un documento ya cerrado— **empeora el problema en vez de resolverlo**. El blob URL ya fue creado por el lado host del motor emisor (ADR-034 §5: crear es del motor, rastrear y revocar es del Orchestrator). Si el Orchestrator no lo registra, nadie lo revoca **nunca**: es el mismo leak, con menos rastro para diagnosticarlo.

### 4. El flake del E2E no es la evidencia

El implementador reportó fallas intermitentes (1 blob vivo, ciclo 7 en una corrida, ciclo 3 en otra) solo con paralelismo 6, con `ENOMEM` del propio dev server en una de esas corridas, y verde en serie. `playwright.config.ts` fija `workers: 1` en CI. **La atribución del flake queda sin confirmar y no importa**: el defecto se arregla por sus méritos, y la prueba de regresión tiene que ser determinista, no un E2E en un entorno que se queda sin memoria.

## Decisión

### 1. Invariante: el cierre de un documento revoca todo blob URL suyo, llegue cuando llegue

`DOCUMENT_CLOSED` pasa a garantizar no solo "se revocan los blob URLs vigentes", sino **"después del cierre no queda vivo ningún blob URL de ese documento"**. Es la formulación que el Escenario 7 y el gate `test:leak` de Hito 11 verifican de verdad.

### 2. Guard que **revoca** en los dos puntos de registro (es el que cierra el agujero)

`handlePreviewUpdated` y `handleExportFinished`: si el `documentId` ya no está abierto (`state.has(documentId) === false`), **revocan el URL entrante en el acto** (`URL.revokeObjectURL`), loguean `warn` con `documentId`/`pageIndex`, y no lo registran. Nunca lo ignoran a secas — ver Contexto §3.

Es determinista y sin falsos negativos: entre el `revokeByPrefix` y el `state.delete` de `closeDocument` no hay ningún `await`, así que ninguna otra tarea puede interleavearse y observar un estado a medio desarmar. Un `PREVIEW_UPDATED` que llegue **durante** el `await unloadDocument` se registra normal y lo barre el `revokeByPrefix` de unas líneas después; uno que llegue **después**, lo revoca el guard.

Cubre las tres fuentes de Contexto §2 —preview mediado, vía por evento y export— sin depender de cuál las originó.

### 3. Señal de baja por documento para el preview mediado (correctitud, achica la ventana)

`mediatedPreviewCtx` deja de fabricar un `AbortController` huérfano por llamada y pasa a usar un controlador **por documento**, que `closeDocument` y `dispose` abortan y `cancelReanalyze` **no**.

Esto refina la nota v1.5.1 y ADR-044 §3 con la distinción que faltaba: el seed/flush del preview mediado es inmune a la **cancelación** del documento (ADR-038 §6 sigue intacto: `cancelReanalyze` aborta `abortRegistry` y el seed igual corre), pero **no** a la **baja** del documento. Seguir renderizando un documento cuyo proxy Render ya destruyó es trabajo tirado que termina en un `warn` de render fallido.

El controlador nuevo vive en el mismo mapa por documento que el resto del estado y se limpia en `closeDocument`/`dispose`, como todo lo demás.

### 4. Por qué las dos y no una

§2 sin §3 arregla el leak pero deja renders zombie corriendo contra un documento cerrado. §3 sin §2 **no arregla nada**: la vía por evento de Render (Contexto §2) no pasa por `mediatedPreviewCtx` y sigue pudiendo emitir tarde. §2 es la obligatoria; §3 es la que evita el trabajo inútil y deja la semántica del preview mediado bien definida en vez de "nunca se aborta".

### 5. Qué **no** cambia

`RenderEngine` no se toca: sigue creando los blob URLs y emitiendo `PREVIEW_UPDATED` igual (ADR-034 §5 intacto en su reparto). No se agrega cancelación por documento a la vía `RENDER_REQUESTED` — sería un cambio de contrato de Render por un beneficio que §2 ya da. `cancelReanalyze` conserva su orden `abort`/`finishSession` (ADR-038 §6). Ningún payload de evento cambia. `closeDocument` no espera a los renders en vuelo: los aborta y sigue.

### 6. Tests

- **Regresión determinista** (`packages/anonymization-core/src/__tests__/`): un render mediado que queda pendiente **a través** de un `closeDocument()`, resolviendo su `PREVIEW_UPDATED` **después** del cierre → `URL.revokeObjectURL` fue llamado con ese URL y `blobTracker` no lo retiene. Es el test que el E2E no puede dar de forma confiable.
- El mismo caso para `EXPORT_FINISHED` tardío.
- Que un `PREVIEW_UPDATED` llegado **durante** el `await unloadDocument` sí se registre y sí lo barra el `revokeByPrefix` (el guard no debe adelantarse).
- Que `cancelReanalyze` **siga** dejando correr el seed (test de no-regresión de la v1.5.1/ADR-038 §6 — es lo que §3 podría romper si el controlador se ata al lugar equivocado).

### 7. Alcance

Un solo PR de `packages/anonymization-core/src` (**PR 17.8**), sin tocar motores. Va después del PR 17.7 (que es el que hace observable el ciclo open/close).

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Solo atar `mediatedPreviewCtx` a una señal que `closeDocument` aborte** | Es la hipótesis original y no alcanza: la vía por evento de Render (`handleRenderRequested`, contexto de `init`) y el export tienen la misma ventana y no pasan por ahí (Contexto §2). |
| **Solo no registrar los blobs de documentos cerrados** | Garantiza el leak en vez de arreglarlo: el URL ya existe, y si el Orchestrator no lo toma, nadie lo revoca (Contexto §3). |
| **Hacer que `closeDocument` espere a los renders en vuelo** | Convierte el cierre en una operación de duración indefinida (un render puede estar encolado detrás de otros en el pool) por un beneficio que el guard ya da. `DOCUMENT_CLOSED` tiene que ser inmediato: la UI lo usa para volver al estado vacío. |
| **Cancelación por documento en la vía `RENDER_REQUESTED` de Render** | Cambio de contrato del motor (el `ctx` de `init` es de la instancia, no del documento) para un caso que el guard cubre. Si alguna vez hace falta por otro motivo, es su propio ADR. |
| **Revocar en el motor en vez del Orchestrator** | Invierte ADR-034 §5 sin necesidad: el motor no sabe si el documento sigue abierto, el Orchestrator sí. |

## Consecuencias

**Positivas**: el invariante de cierre pasa a ser verificable y verdadero; el Escenario 7 y el gate `test:leak` de Hito 11 miden algo que de verdad se cumple; queda definida la semántica del preview mediado ("inmune a la cancelación, no a la baja") en vez de "nunca se aborta", que era una propiedad accidental; se documenta que la vía por evento de Render no es cancelable por documento — un hecho que sorprendió y que conviene que esté escrito.

**Negativas**: dos guards nuevos en handlers que hoy son de una línea, y un mapa más por documento. El guard puede enmascarar un bug futuro si algo emite `PREVIEW_UPDATED` para un documento que **debería** estar abierto — por eso loguea `warn` y no en silencio.

**Neutras**: ningún contrato público ni payload de evento cambia; `render-engine` no se toca; ADR-038 §6 y ADR-034 §5 se conservan (uno intacto, el otro completado).

## Docs actualizados por este ADR

- `core/Orchestrator.md` v1.5.4: nota de versión, §13 caso 11 (el invariante de §1), §14 (cuatro tests de §6), §15 (item nuevo).
- `core/Render_Engine.md` §8: precisión de que los renders por `RENDER_REQUESTED` usan el `ctx` de `init` y por lo tanto no son cancelables por documento.
- `adr/ADR-034` §5: nota de completitud (llegadas tardías).
- `adr/ADR-044` §3: nota de amendment (inmune a la cancelación, no a la baja).
- `roadmap/MVP.md` y `adr/ADR-038` §8: PR 17.8.
- `roadmap/Hito10_Observaciones_Revision.md`: entrada del hallazgo + tarea de seguimiento.

## Validación

- Los cuatro tests de §6 verdes, en particular el de no-regresión de `cancelReanalyze`.
- Escenario 7 E2E: 0 blob URLs vivos tras cada uno de los 10 ciclos, en serie (`--workers=1`, el modo de CI). Si vuelve a fallar bajo paralelismo 6 en un entorno con `ENOMEM`, **no** es evidencia de este bug: reportarlo aparte.
- Grep de control: ningún `blobTracker.set` sin guard de documento abierto en `orchestrator.ts`.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `core/Orchestrator.md` §13 casos 11 y 26–27, nota v1.5.1 — `core/Render_Engine.md` §8/§13 caso 21 — `architecture/07_Performance_Strategy.md` §8, §11.3 item 7, §11.4 (`test:leak`)
- `adr/ADR-034` §5 — `adr/ADR-038` §6 — `adr/ADR-043` — `adr/ADR-044` §3 — `adr/ADR-051`
- Código: `packages/anonymization-core/src/orchestrator.ts` (`closeDocument`, `handlePreviewUpdated`, `handleExportFinished`, `mediatedPreviewCtx`, `renderMediatedPreview`) — `packages/anonymization-core/src/blob-tracker.ts` — `packages/anonymization-core/src/create-core.ts` (`engines.render.init(initCtx)`) — `packages/anonymization-core/render-engine/src/render.engine.ts` (`handleRenderRequested`) — `tests/e2e/scenario-7-open-close-cycle.spec.ts` — `tests/e2e/support/blobUrlTracker.ts`
