<!-- CONTEXT: scope=adr | dependencias=core/Render_Engine.md,core/Contracts.md,ui/React_Client.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md | audiencia=humanos+IA | fase=11.5 -->

# ADR-133 — Una cancelación de render no es una falla

- **Estado**: Accepted
- **Fecha**: 2026-09-04
- **Decidido por**: El humano, sobre el hallazgo de la migración de los E2E al contenedor de escritorio.
- **Relacionado con**: `core/Render_Engine.md` §6/§11, `ui/React_Client.md` §580 (el aviso de `failedJobs`), ADR-130 (el contenedor)
- **Parte de**: Hito 11.5 — Escritorio

## Contexto

### 1. La app de escritorio acusaba un fallo que no existía

Al abrir un documento en el contenedor aparecía, en cada importación:

> No se pudo generar la vista previa de algunas páginas. La detección no se vio afectada.

El error real, que nadie veía porque `bus-bridge.ts` cuenta el fallo y descarta el payload:

```
RENDER_PAGE_FAILED — "Fallo al renderizar la página 0: Rendering cancelled, page 1"
retryable: true
```

`"Rendering cancelled"` lo emite **pdfjs** cuando descarta el render en vuelo de una página porque llegó otro más nuevo para esa misma página — al hacer zoom, al cambiar el tamaño de la ventana, al conmutar Original ↔ Anonimizado. **La vista previa se dibuja igual**, con el pedido nuevo. No hay nada que arreglar en el resultado.

### 2. No es un problema del contenedor, aunque ahí se vea

Se descartó por eliminación, igualando una variable por vez contra el mismo documento y el mismo código:

| Entorno | Resultado |
|---|---|
| Dev server, viewport 1280×720, DPR 1 | "Listo", cero fallos |
| Dev server, viewport 1440×900, **DPR 2** | "Listo", cero fallos |
| Build de **producción** servido por HTTP, mismo viewport y DPR | "Listo", cero fallos |
| Contenedor de escritorio | **Falla la página 0, siempre** |
| Contenedor, sin el `reload` del arnés de E2E | **Falla igual** |

O sea: no es el tamaño de ventana, ni el DPI, ni el build de producción, ni el instrumental de test.

Se descartó además la hipótesis más obvia —que el visor pidiera el render de la página 0 dos veces— instrumentando `actions.requestRender` en los dos entornos. El resultado fue el contrario del esperado:

| Entorno | Pedidos de render en 60 s | ¿Cancelación? |
|---|---|---|
| Navegador | **4** (dos en el mismo milisegundo) | **No** |
| Contenedor | **2**, separados por ~33 s | **Sí** |

El que pide más es el que **no** falla. La cancelación no viene de los pedidos del visor: tiene que originarse en el render de preview que el propio pipeline dispara durante el análisis.

**La causa exacta queda sin identificar**, y conviene decirlo en vez de fingir que se cerró. Con esta decisión el síntoma desaparece —una cancelación deja de contarse como fallo— y lo que queda es un render desperdiciado: costo de CPU, no de corrección. Cerrarlo del todo es trazar el ciclo de vida del preview del Orchestrator dentro del contenedor.

Pero eso es la causa de la *cancelación*, no del *aviso*. Y la cancelación es legítima en cualquier entorno: la web también las produce al hacer zoom, solo que ahí la carrera no se da al abrir.

### 3. El defecto está en cómo se clasifica, no en que se cancele

`toPageFailure` (`render-engine/src/worker/kernel.ts`) envolvía **cualquier** excepción en `RenderPageFailedError`. La pool lo emitía como `WORKER_JOB_FAILED`, el cliente lo sumaba a `failedJobs`, y el aviso de `React_Client.md` §580 aparecía.

Un aviso que se dispara por una operación normal enseña a ignorar los avisos. Y este dice "no se pudo generar la vista previa" sobre una vista previa que sí se generó.

## Decisión

**Una `RenderingCancelledException` de pdfjs se mapea a `CancelledError`, no a `RenderPageFailedError`.**

Se reconoce por `err.name === "RenderingCancelledException"` y **no por el texto del mensaje**: `name` es parte de la API pública de pdfjs, el mensaje puede cambiar entre versiones sin aviso. Un fallo real cuyo mensaje casualmente diga "cancelled" sigue siendo un fallo.

**No hace falta ningún código de error nuevo ni tocar el contrato de eventos.** `CancelledError` (`EngineErrorCode.CANCELLED`) ya existe en `shared`, y `worker-pool.ts` ya lo distingue: lo re-lanza **sin** emitir `WORKER_JOB_FAILED`. La cancelación deja de contarse como fallo sin que el cliente cambie una línea.

## Consecuencias

**A favor**

- El aviso vuelve a significar lo que dice. Verificado sobre el contenedor con `text-10p.pdf`: el banner pasa de "No se pudo generar la vista previa…" a **"Listo"**.
- Vale para todos los clientes, no solo el escritorio: un zoom en la web producía la misma clasificación equivocada, solo que sin la carrera de apertura era más difícil de ver.
- `RenderPageFailedError` recupera su significado: los fallos que quedan son fallos.

**En contra**

- **Una cancelación deja de dejar rastro.** Antes aparecía en `failedJobs`, mal clasificada pero visible; ahora no aparece en ningún lado. Si algún día se cancelan renders que **no** deberían cancelarse, no hay señal. `WORKER_JOB_CANCELLED` existe y nadie lo escucha: ese es el lugar natural si hiciera falta.
- **La causa raíz de la cancelación en el contenedor sigue sin identificarse** (§2). Se descartaron viewport, DPI, build y arnés de test. Este ADR arregla la clasificación, no la carrera.
- `toPageFailure` pasa a exportarse para poder testearla. Mismo criterio que `fitReplacementFontSized` y `calibrateLineFont` en el mismo archivo.

**Lo que no toca**: `Contracts.md`, los códigos de error, el contrato de eventos, ni el cliente.
