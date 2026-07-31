<!-- CONTEXT: scope=adr | dependencias=core/Orchestrator.md,core/Render_Engine.md,core/Grouping_Engine.md,core/Export_Engine.md,architecture/04_Event_System.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-030-RenderEngine-LoadDocument.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md | audiencia=humanos+IA | fase=10 -->

# ADR-044 — Preview anonimizado: los reemplazos reales llegan a Render por mediación del Orchestrator (y el delta render por eventos de Render se retira)

- **Estado**: Accepted
- **Fecha**: 2026-07-23
- **Decidido por**: El humano (opción "Orchestrator media" del prompt del implementador, con ajustes de alcance del planificador), sobre el bug destapado en el Escenario 1 E2E post-PR13: los dos paneles del visor muestran lo mismo.
- **Relacionado con**: ADR-014 (patrón de mediación del Orchestrator), ADR-016 (dos visores por `kind`), ADR-030 (precondición `loadDocument`), ADR-037 (supersede por escala — las invocaciones directas son inmunes), ADR-038 (`reanalyze`/`GROUPING_FINISHED` repetible), ADR-043 (el Orchestrator ya invoca `renderPage` directo; toda la clase `RenderEngine` es host-side)

## Contexto

### Bug 1 — deadlock de arranque del preview anonimizado

`RENDER_REQUESTED` no transporta `replacements` (por diseño: `Contracts.md` §8, ADR-037). El handler del RenderEngine reconstruye cada `RenderPageInput` desde el último input recordado por página (`lastAnonymizedInputs`), o `replacements: []` si la página nunca se renderizó (`render.engine.ts`, nota de implementación 1). Nadie alimenta nunca ese primer input con los reemplazos reales:

- El RenderEngine se suscribe solo a `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED` (eventos de **cambio**), no a `ENTITY_GROUP_CREATED` — no se entera de que los grupos existen.
- El único lugar que hoy computa reemplazos desde los grupos es el export (`buildPageReplacements`, `export.engine.ts`) — demasiado tarde para el preview en vivo.
- Peor: el índice `pageIndex → groupIds` (`pageGroupIndex`, spec §12) solo se puebla cuando un render trae `replacements.length > 0`. Con el primer render en `[]`, queda vacío para siempre: un `GROUP_TOGGLED`/`GROUP_REPLACEMENT_CHANGED` posterior no encuentra páginas afectadas y el delta render es un no-op. Deadlock: el preview anonimizado jamás difiere del original.

### Bug 2 — el delta render actual es lossy (irrecuperable en toggle off→on)

Aun si el arranque se resolviera, el mecanismo de overrides del delta render pierde información: `requestDeltaRender` re-renderiza con `applyReplacementOverrides(...)`, que **elimina** los `Replacement` de un grupo con `enabled: false`, y ese input filtrado se convierte en el nuevo `lastAnonymizedInputs` (lo registra `rememberInput` dentro de `renderPage`). Al re-habilitar el grupo, el override `enabled: true` no tiene ningún `Replacement` que resucitar: las ocurrencias del grupo quedan sin anonimizar en el preview para siempre. La causa de fondo es la misma del bug 1: el motor intenta mantener un espejo de los grupos a partir de eventos de cambio que no traen bbox/valor (nota de implementación 2 del motor), en vez de recibir el estado real.

### Hecho que habilita la solución

En `grouping-engine`, `GROUP_TOGGLED` y `GROUP_REPLACEMENT_CHANGED` tienen **un único punto de emisión cada uno**, y ambos se emiten siempre junto a (después de) un `ENTITY_GROUP_UPDATED` que el mismo caller arma (`grouping.engine.ts`: `applyGroupUpdate` emite `ENTITY_GROUP_UPDATED` y luego `GROUP_TOGGLED` si `enabled` cambió; `emitReplacementChangeIfNeeded` devuelve las claves para que **todos** sus callers las sumen al `changes` del `ENTITY_GROUP_UPDATED` que están armando). Por lo tanto, un mediador suscripto a `ENTITY_GROUP_CREATED`/`UPDATED`/`REMOVED` observa **todas** las mutaciones que afectan al preview, sin necesitar los eventos de cambio finos.

Además, `rememberInput` corre **síncrono** al comienzo de `renderPageInternal` (antes de cualquier `await`): una invocación directa de `renderPage` con reemplazos reales puebla `lastAnonymizedInputs` en el mismo tick, y las reconstrucciones de `RENDER_REQUESTED` posteriores parten de ese input. No hace falta tocar la reconstrucción.

## Decisión

### 1. El Orchestrator media los eventos de estado de grupos hacia Render

El Orchestrator se suscribe (canal `grouping`) a `ENTITY_GROUP_CREATED`, `ENTITY_GROUP_UPDATED` y `ENTITY_GROUP_REMOVED`. Ante ellos computa los reemplazos **autoritativos** desde `grouping.getSnapshot(documentId)` — la misma fuente que ya usa el export — con `buildPageReplacements(pageIndex, snapshot.groups)`, e invoca directo (patrón ADR-014; el call site directo a `renderPage` ya existe desde ADR-043):

```ts
render.renderPage({ documentId, pageIndex, kind: "anonymized", mode: "preview", replacements }, ctx)
```

`Contracts.md` **no cambia**: ni `RenderRequested` ni las firmas de `renderPage`/eventos. Cambian la tabla de receptores de `04_Event_System.md` §6, la matriz §11 y los specs `Orchestrator.md`/`Render_Engine.md`.

### 2. El RenderEngine deja de escuchar eventos de Grouping; el delta render por overrides se retira

Se eliminan del motor: las suscripciones a `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED`, `groupOverrides` + `applyReplacementOverrides`/`applyAnnotationOverrides`, `requestDeltaRender` (API pública de §6 — sin callers externos: solo la invocaban los dos handlers eliminados) y `pageGroupIndex` (su único consumidor era `requestDeltaRender`). Se conservan `lastAnonymizedInputs`/`lastOriginalInputs` (reconstrucción de `RENDER_REQUESTED`) y todo el resto de ADR-043 (cache, supersede, kernel, pools).

Por qué retirar y no convivir: como cada `GROUP_TOGGLED`/`GROUP_REPLACEMENT_CHANGED` co-emite un `ENTITY_GROUP_UPDATED`, mantener ambos caminos produciría **dos renders por página en cada edición** — el delta (sobre datos stale/filtrados) y el mediado (autoritativo) — compitiendo en el pool sin orden de finalización garantizado: el `PREVIEW_UPDATED` stale puede llegar último y ganar. El retiro elimina la carrera, el doble costo, y de paso el bug 2 (muere con el mecanismo). La matriz §11 queda más simple: el único motor que escucha a otro motor pasa a ser Grouping.

### 3. Cuándo renderiza el mediador (seed inicial + flush post-Ready)

- **Acumulación**: los handlers de `ENTITY_GROUP_*` no renderizan en línea; marcan páginas sucias por documento. Páginas afectadas de un evento = páginas actuales de `payload.group.members` ∪ páginas **previamente conocidas** de ese `groupId` (para borrar reemplazos de páginas que el grupo abandonó por merge/split/`dropOccurrences`, y para `ENTITY_GROUP_REMOVED`, cuyo payload solo trae `groupId`). Para eso el Orchestrator mantiene por documento un mapa `groupId → Set<pageIndex>` alimentado por los mismos payloads; se limpia en `DOCUMENT_CLOSED`.
- **Seed inicial**: en el handler de `GROUPING_FINISHED` — incluida la vía del `finishSession` de una cancelación de `reanalyze`, donde se suprime `PIPELINE_READY` pero las ocurrencias mergeadas se conservan (ADR-038 §6) — se renderizan las páginas con ≥ 1 reemplazo habilitado según el snapshot. Como la cascada `GROUPING_FINISHED → Ready` es síncrona y `rememberInput` también, `lastAnonymizedInputs` queda poblado antes de que la UI (asíncrona) reaccione a `Ready` con su primer `RENDER_REQUESTED`. Esto cubre import y `reanalyze`.
- **Flush incremental**: fuera de las etapas pre-`Ready` del pipeline (`Importing`/`Extracting`/`OCRing`/`Detecting`/`Grouping`, donde el seed de `GROUPING_FINISHED` va a cubrir todo), las páginas sucias se procesan en un flush coalescido por microtask — una ráfaga (p. ej. una regla `type` que emite N `ENTITY_GROUP_UPDATED`, caso 12 de Grouping) produce un solo render por página afectada. Esto cubre ediciones en `Ready`/`Done` y también durante `Exporting` (caso 15 del Orchestrator: la edición fluye a Grouping sin pasar por el pipeline).
- Errores de estos renders: mismo tratamiento que el resto de los caminos por evento — `warn` + continuar, nunca `PIPELINE_FAILED` (el preview es best-effort; el reintento de `RENDER_PAGE_FAILED` vive dentro del motor).
- Estos renders son invocaciones directas: **inmunes al supersede** de `RENDER_REQUESTED` (`Render_Engine.md` §13 caso 21) — una entrada de escala vieja no puede descartar un seed.

> **Amendment (ADR-052 §3, 2026-07-30)**: la nota v1.5.1 de `Orchestrator.md` hizo estos renders inmunes también a la **cancelación** del documento, con un `AbortController` propio por llamada que nunca se abortaba. Eso era demasiado: quedaban corriendo incluso después de `closeDocument`, contra un documento cuyo proxy de Render ya fue destruido, y su `PREVIEW_UPDATED` tardío dejaba un blob URL que nadie revocaba. Se precisa: el seed/flush del preview mediado es inmune a la **cancelación** (`cancelReanalyze`, ADR-038 §6 — el motivo original de la señal propia) pero **no a la baja** del documento. El controlador pasa a ser por documento y lo abortan `closeDocument`/`dispose`. El resto de esta sección no cambia.

### 4. `buildPageReplacements` se comparte desde `export-engine`

La función es pura (grupos → `Replacement[]` por página, filtrando `enabled === false` — exactamente la semántica del preview: `Render_Engine.md` §13 caso 2). Se exporta desde el `index.ts` de `export-engine` y la importa el façade (único autorizado a importar motores, `Code_Standards.md` §12). No es un cambio de contrato de `Contracts.md`; el uso interno del export no cambia.

### 5. Qué no cambia

`core/Contracts.md` completo (payloads, `RenderRequested`, firmas); el flujo de `RENDER_REQUESTED` y su reconstrucción por `lastInputs`; el supersede/cache/kernel/pools de ADR-037/ADR-043; el camino del export; la UI (`apps/react-client` no se toca); los eventos que Grouping emite.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **La UI adjunta los reemplazos en `RENDER_REQUESTED`** (extender el contrato) | Cambia un payload público (R-2) y muda la corrección del Core a la UI: un consumidor headless del Core que emita `RENDER_REQUESTED` seguiría viendo el preview sin anonimizar. Duplica el cómputo UI/export. |
| **RenderEngine se suscribe a `ENTITY_GROUP_CREATED`/`UPDATED` y arma su espejo** | Agranda la dependencia motor→motor que la matriz §11 tolera como excepción, duplica el estado de Grouping dentro de Render (el espejo parcial `groupOverrides` ya demostró ser frágil — bug 2) y requiere igualmente ADR + spec. |
| **Mediación parcial conviviendo con el delta render actual** (Orchestrator solo `CREATED`/`UPDATED`/`REMOVED`; Render conserva `TOGGLED`/`REPLACEMENT_CHANGED`) | Era la forma aprobada inicialmente; se descarta al verificar la co-emisión de `ENTITY_GROUP_UPDATED`: cada edición dispararía dos renders de la misma página (stale vs. autoritativo) con carrera de finalización en el pool, y el bug 2 seguiría vivo dentro del motor. |
| **Seed perezoso sin renders (solo poblar `lastAnonymizedInputs`)** | No existe una vía pública para inyectar memoria sin renderizar y crearla sería un cambio de contrato mayor; además el seed-render tiene valor propio (calienta el cache LRU y emite los `PREVIEW_UPDATED` que pintan el panel). |

## Consecuencias

**Positivas**: el preview anonimizado funciona desde el primer render (bug 1) y el toggle off→on queda correcto por construcción (bug 2: el flush recomputa del snapshot, sin overrides lossy); desaparecen `groupOverrides`/`pageGroupIndex`/`requestDeltaRender` (menos estado en el motor, continúa la línea de ADR-041/ADR-043); la invariante de la matriz §11 queda mínima (solo Grouping escucha a otros motores); preview y export computan reemplazos con la **misma** función; merge/split/reglas — que hoy ni siquiera tenían camino hacia Render (`ENTITY_GROUP_UPDATED`/`REMOVED` no eran escuchados por nadie del Core) — actualizan el preview.

**Negativas**: un solo PR toca tres costuras — Orchestrator/façade (mediación), `render-engine` (retiros sancionados acá) y `export-engine` (una línea de export en `index.ts`) — precedente directo: PR13/ADR-043 §Consecuencias; `Render_Engine.md` pierde un método público (`requestDeltaRender`) — sin callers fuera del propio motor, verificado. El seed usa la escala default (`previewScale`): si el usuario está zoomeado durante una edición, el `PREVIEW_UPDATED` del flush puede pintar transitorio a otra escala hasta el siguiente `RENDER_REQUESTED` del debounce de zoom de la UI (mitigado: la reconstrucción de `RENDER_REQUESTED` reaplica `mode`/`scale` del payload; comportamiento igual al delta render actual, que tampoco conserva escala de zoom).

**Neutras**: el costo del seed es acotado (solo páginas con reemplazos habilitados, a escala preview, por la cola normal del `RenderPool`) y pre-calienta el cache para los `RENDER_REQUESTED` que siguen; el panel "original" (highlights por `Annotation`) no está cableado aún en la UI — cuando se implemente, seguirá este mismo camino mediado (el Orchestrator adjuntará `annotations` en el render de `kind: "original"`), no el de overrides retirado.

## Docs actualizados por este ADR

- `core/Orchestrator.md` v1.5.0: §2 (responsabilidad nueva), §8 (suscripciones `ENTITY_GROUP_*` + nota final), §13 casos 26–27, §14 (tests nuevos), §15 (item 8b).
- `core/Render_Engine.md` v1.5.0: §2, §6 (retiro de `requestDeltaRender`), §8 (solo `RENDER_REQUESTED`), §12, §13 (casos 11/16/21 ajustados), §14 (tests de delta reemplazados), §15 (items 11/14 marcados retirados).
- `architecture/04_Event_System.md`: §6 (receptores), §11 (matriz e invariante).
- `roadmap/Hito10_Observaciones_Revision.md`: entrada del bug + seguimiento.

## Validación

- Contract (Orchestrator, motores mockeados): `ENTITY_GROUP_CREATED/UPDATED/REMOVED` registrados en el bus; `GROUPING_FINISHED` dispara seed con los `replacements` del snapshot (verificar el input exacto de `renderPage`); ráfaga de `ENTITY_GROUP_UPDATED` → un solo render por página (coalescing); `ENTITY_GROUP_REMOVED` re-renderiza las páginas que el grupo ocupaba.
- Contract (Render): sin suscripciones al canal `grouping`; la matriz §11 actualizada pasa el test de contrato del bus.
- Edge (Orchestrator): toggle off→on re-renderiza con el reemplazo restaurado (bug 2); edición durante `Exporting` hace flush; seed también en la vía de `GROUPING_FINISHED` suprimida por cancelación de `reanalyze`; fallo de un seed-render → `warn`, sin `PIPELINE_FAILED`.
- E2E (Escenario 1): los dos paneles difieren tras `Ready`; toggle y cambio de modo actualizan el panel anonimizado.
- Gates completos verdes al cierre del PR.

## Referencias

- `core/Orchestrator.md` §2, §8 — `core/Render_Engine.md` §6, §8, §12–§13 — `core/Grouping_Engine.md` §7 — `architecture/04_Event_System.md` §6, §11
- `adr/ADR-014` — `adr/ADR-030` — `adr/ADR-037` §4 — `adr/ADR-038` §6 — `adr/ADR-043` §2
- `packages/anonymization-core/render-engine/src/render.engine.ts` (reconstrucción de `RENDER_REQUESTED`, `rememberInput` síncrono, overrides lossy) — `packages/anonymization-core/grouping-engine/src/grouping.engine.ts` (co-emisión y puntos únicos de emisión) — `packages/anonymization-core/export-engine/src/export.engine.ts` (`buildPageReplacements`) — `packages/anonymization-core/src/orchestrator.ts` (`getSnapshot` en export, call site directo de `renderPage`)
