<!-- CONTEXT: scope=adr | dependencias=core/Render_Engine.md,core/Orchestrator.md,core/Contracts.md,05_Worker_Architecture.md,07_Performance_Strategy.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-052-Blob-Urls-Tardios-Tras-Cerrar-Documento.md,adr/ADR-056-RenderRequested-Kind-Por-Panel.md,adr/ADR-133-Una-Cancelacion-De-Render-No-Es-Una-Falla.md | audiencia=humanos+IA | fase=11 -->

# ADR-144 — El input se registra ya; el trabajo se planifica

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El planificador, resolviendo D-08 del plan de campaña de hardening (§2, §12).
- **Relacionado con**: ADR-044 (la mediación grupos→Render y su seed), ADR-037 §4 (supersede por escala), ADR-052 §3 (blob URLs tardíos), ADR-133 (una cancelación no es una falla)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. El seed dispara todo el documento de una

`Orchestrator.seedAnonymizedPreview` recorre **todas** las páginas del
documento, y por cada una que tenga al menos un reemplazo habilitado llama a
`renderMediatedPreview`, que invoca `renderPage` **sin esperarlo**. En un
expediente de 200 páginas con nombres en la mayoría, eso son ~200 renders
lanzados en el mismo turno.

`WorkerPool.enqueue` acepta la entrada igual cuando se pasa de `maxQueue`
(`render: 32`): emite `WORKER_POOL_SATURATED` y **encola de todos modos**. El
façade manda ese evento a un logger nulo (P-4). O sea: el límite documentado
avisa, pero no limita, y el aviso no se ve.

`waitForCapacity()` existe, espera a que la cola baje del 50 % con un `sleep(10)`
y no la usa nadie en este camino. Además no reserva cupo: dos productores que
la esperen pueden pasar juntos.

### 2. Y la corrección obvia rompe otra cosa

`renderPage` no solo dibuja: **registra el input autoritativo** de la página con
`rememberInput`, y de ahí lo lee la reconstrucción de `RENDER_REQUESTED` cuando
el visor pide una página que todavía no se sembró. Postergar la llamada a
`renderPage` para acotar la cola posterga también ese registro, y entonces una
página que el usuario abre antes de que le toque el turno se dibuja **sin sus
reemplazos**: exactamente el defecto que ADR-044 vino a cerrar.

Las dos mitades de `renderPage` tienen urgencias distintas. Una es barata y no
puede esperar; la otra es cara y sí puede.

## Decisión

**El registro del input es inmediato. El trabajo pesado pasa por un
planificador acotado, en `RenderEngine`, después de `rememberInput`.**

### 1. Qué se registra y cuándo

`rememberInput` sigue corriendo **sincrónicamente al principio de
`renderPage`**, antes de cualquier espera. Ninguna página queda sin su input
autoritativo por estar esperando turno.

### 2. Qué se planifica

Solo `mode: "preview"`. **`mode: "full"` no entra al planificador**: es el
camino del export (prioridad 1000, `05_Worker_Architecture.md` §6.2), es
autoritativo y no se coalesce con nada. Un preview no puede cancelar,
sustituir ni demorar un render de export.

### 3. Clave de coalescencia

`documentId | pageIndex | kind | mode | scale | imageFormat`.

Incluye `kind` (ADR-056: los dos paneles son independientes) y `scale`
(ADR-037: dos escalas son dos trabajos distintos). **No** incluye
`replacements` ni `annotations`: son justamente lo que cambia entre una ráfaga
de ediciones sobre la misma página, y coalescerlas es el objetivo.

Por clave hay **como máximo un trabajo pendiente**. Una solicitud nueva sobre
una clave con trabajo pendiente **reemplaza** el descriptor y sube su
generación; no se agrega a la cola. La cola pendiente crece con la cantidad de
páginas × paneles × escalas, no con la cantidad de ediciones.

### 4. Lo que espera es liviano; lo que corre es acotado

- Pendiente: un **descriptor** por clave (identidad + generación). No retiene
  `ImageData`, ni resultados, ni el histórico de renders.
- En vuelo: como mucho `renderPoolSize` trabajos de preview despachados a la
  vez. El planificador no despacha el siguiente hasta que se libera un slot, y
  el cupo **se reserva antes** de despachar, no se comprueba y después se toma.

Con eso, el seed deja de poder saturar la pool por construcción, y
`WORKER_POOL_SATURATED` vuelve a significar algo cuando aparece.

### 5. El input se lee al despachar, no al encolar

Cuando le toca el turno a una clave, el trabajo se arma con el **input
autoritativo vigente** (`lastAnonymizedInputs`/`lastOriginalInputs`), no con el
snapshot que había cuando el seed lo encoló. Cada despacho lleva su generación;
un resultado que vuelve con una generación vieja **se descarta** y no emite
`PREVIEW_UPDATED`. Un render viejo no puede pisar a uno nuevo.

### 6. Qué reciben las promesas superadas

Una solicitud de preview cuya clave fue reemplazada **resuelve con la salida del
trabajo que efectivamente corrió para esa clave**. No queda colgada y no
rechaza: quien pidió "página 7, anonimizada, escala 1" recibe una página 7
anonimizada a escala 1; que incluya una edición más nueva es el resultado
correcto, no un error (ADR-133: una cancelación no es una falla, y esto ni
siquiera es una cancelación).

### 7. Prioridades: se implementa la fila que ya estaba escrita

`05_Worker_Architecture.md` §6.2 distingue `render-page` de preview **visible
(70)** de **no visible (20)**, y el código despacha 70 fijo. El planificador
implementa la distinción sin inventar contrato: el seed y el flush mediado —que
por definición barren el documento entero— entran en **20**; un
`RENDER_REQUESTED` del visor —que por construcción pide lo que está mirando—
entra en **70**. El usuario que abre la página 150 durante el seed no espera a
las 149 anteriores.

### 8. Baja del documento

En `closeDocument`/`dispose`: se abortan los trabajos en vuelo, **se vacían los
descriptores pendientes**, se invalidan las generaciones y se revocan los blob
URLs tardíos (ADR-052 §3). Se conserva la distinción entre cancelar un
reanálisis —que no toca la señal del preview mediado— y dar de baja el
documento —que sí—.

### 9. Saturación persistente

Si el planificador queda por encima de su cupo de forma sostenida, se informa
por los eventos que ya existen. **No** se agrega telemetría pública nueva ni un
`console.*` para que el aviso se vea (P-4). Una cancelación por supersede no es
un error de usuario y no se reporta como tal.

## Consecuencias

**A favor**

- El trabajo pesado en vuelo queda acotado por el tamaño de la pool, de forma
  verificable, con el fixture de 200 páginas midiendo cola máxima y latencia del
  primer preview.
- Los reemplazos no se pierden: el registro del input no depende del turno.
- Una ráfaga de ediciones sobre una página produce **un** render, el último, en
  vez de uno por tecla.

**En contra**

- **El seed completo tarda más en terminar**, porque deja de inundar la pool. Es
  el precio buscado; lo que mejora es el tiempo hasta el primer preview útil y
  el pico de memoria, no el tiempo total del barrido.
- Los mapas por página siguen creciendo con el documento (un descriptor y un
  input por página y panel). Es un costo liviano pero **no es cero**, y queda
  declarado: acotarlo también exigiría descartar inputs autoritativos, que es
  justo lo que no se puede hacer.
- El planificador es estado nuevo dentro de `RenderEngine`, con su propia
  prueba de cierre de documento. Un descriptor que sobreviva a un
  `closeDocument` es una fuga.

**Lo que no toca**: `Contracts.md` —no hay evento, tipo ni código de error
nuevo—, el camino de export, la mediación de ADR-044 del lado del Orchestrator,
ni el `WorkerPool` (que sigue con su `maxQueue`, ahora sí respetado por este
productor).
