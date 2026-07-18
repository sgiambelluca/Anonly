<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Render_Engine.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,architecture/07_Performance_Strategy.md,ui/React_Client.md,ui/Components.md,adr/ADR-016-Preview-Kind.md,adr/ADR-030-RenderEngine-LoadDocument.md,adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md | audiencia=humanos+IA | fase=10 -->

# ADR-037 — Zoom con re-render real: `RenderRequested.scale`, cache por escala y supersede de renders obsoletos

- **Estado**: Accepted
- **Fecha**: 2026-07-17
- **Decidido por**: El humano, al revisar ADR-036: aprobó la auditoría pero **rechazó §6** (zoom CSS/canvas sin re-render) y pidió "agregar lo que sea necesario para hacer una re-renderización en tiempo real". Este ADR diseña esa extensión y **supersede ADR-036 §6**.
- **Relacionado con**: ADR-016 (`PreviewUpdated.kind`), ADR-027 (`RenderConfig` canónico), ADR-030 (`loadDocument`), ADR-031 §2 (clave del cache LRU), ADR-034 §1/§3/§5 (`rasterizePage`, `encoded`, blob URLs), ADR-035 §4 (lección: no producir churn de fixtures por config), ADR-036 §5 (`requestRender`), §6 (superseded), §8 (orden de PRs — tabla canónica actualizada en ADR-038 §8), ADR-038 (par de este ADR en la misma revisión del humano)

## Contexto

ADR-036 §6 decidió que el zoom del MVP escalara por CSS/canvas el bitmap ya renderizado, con dos argumentos: `RenderRequested` (`Contracts.md` §8) no transporta escala, y agregarla tocaba `shared` + `render-engine` desde PRs de UI. El humano rechazó esa decisión: por encima de ~2x la pérdida de nitidez es inaceptable para un visor cuyo objetivo es verificar visualmente reemplazos sobre texto.

Inventario de lo que **ya existe** (la auditoría del propio ADR-036 lo dejó a la vista):

1. `RenderPageInput.scale?: number` es un override por invocación directa desde v1.0.0 del spec (`Render_Engine.md` §6/§9: "si se omite usa `previewScale` o `fullScale` según `mode`").
2. `RenderPagePayload.scale?` ya viaja en el job del pool (`03_Data_Model.md` §18) y `RasterizePagePayload` ya transporta `scale` (ADR-034 §1).
3. `rasterizePage(documentId, pageIndex, scale, ctx)` ya recibe escala arbitraria y el motor la honra (Hito 9, `render.engine.ts`).

Es decir: **todo el pipeline de render ya es paramétrico en escala**; la única pieza que no la transporta es el evento `RENDER_REQUESTED`. La asimetría era una omisión del contrato del evento, no una decisión de diseño.

Presupuestos relevantes (`07_Performance_Strategy.md`): no existe una métrica gate específica de zoom; los números que acotan el diseño son el costo de preview (100–500 ms por página, `Render_Engine.md` §12), el target de delta render (< 150 ms, `07` §1) y el presupuesto del cache de `ImageData` (200 MB, `07` §7.1). Un gesto de zoom (rueda/pinch) emite ticks cada ~16 ms: re-renderizar por tick encolaría 6–30 jobs muertos por página visible antes de que termine el primero — hay que desacoplar el gesto del re-render.

## Decisión

### 1. `RenderRequested` gana `scale?: number`; no hay evento nuevo

```ts
export interface RenderRequested {
  readonly documentId: string;
  readonly pageIndices: ReadonlyArray<number>;
  readonly mode: "preview" | "full";
  // ADR-037: escala absoluta pdfjs (1.0 = 72 DPI), misma semántica que
  // RenderPageInput.scale. Ausente → previewScale/fullScale según mode.
  readonly scale?: number;
}
```

- Es una **extensión aditiva** del payload existente: `RENDER_REQUESTED` ya significa "renderizá estas páginas en este modo"; la escala es un parámetro más del mismo request, no un request de otra especie. Un evento nuevo (`ZOOM_RENDER_REQUESTED` o similar) duplicaría el camino completo (enum, payload, `EventPayloadMap`, fila en `04` §10, matriz §11, handler en Render) para cero ganancia semántica.
- Semántica de `scale`: escala absoluta pdfjs, idéntica a `RenderPageInput.scale`. La UI computa `previewScale × zoom` (el zoom del `viewer.store` es un multiplicador 0.5–3 sobre la escala base).
- Orden R-19 respetado: `Contracts.md` §8 → `04_Event_System.md` §10 → `Render_Engine.md` → código.
- `RenderPagePayload` (`03` §18) **no cambia**: ya tenía `scale?`.

### 2. Validación: `MAX_RENDER_SCALE` y trato por vía

- Rango válido: `0 < scale ≤ MAX_RENDER_SCALE = 4` (constante nombrada en `Contracts.md` §6; margen sobre el zoom máximo de UI 3× y protección de límites de canvas/memoria: A4 a 4x ≈ 2380×3368 px ≈ 32 MB RGBA).
- Vía evento (`RENDER_REQUESTED`): `scale` fuera de rango o no finito → `warn` + no-op del evento — no hay caller al que lanzarle, mismo tratamiento que documento no cargado (ADR-030 §3).
- Vía invocación directa (`renderPage`/`renderPages` con `RenderPageInput.scale` inválido): `InvalidInputError` — espejo exacto del guard ya especificado para `rasterizePage` (`scale <= 0`, ADR-034 §1). Esto **endurece** una laguna previa: `RenderPageInput.scale` no declaraba validación.

### 3. Re-render siempre; cache por escala con límite de bytes

- Un cambio de escala **re-renderiza siempre** (no hay resampling del bitmap anterior en el motor). El escalado transitorio del bitmap viejo es responsabilidad de la UI (§5).
- La clave del cache LRU de previews incorpora la escala efectiva:

  ```text
  documentId:pageIndex:kind:mode:scale:hash(replacements ++ annotations)
  ```

  (extiende la clave fijada por ADR-031 §2; "escala efectiva" = `scale` del input o el default por `mode`). Sin esto, un request a otra escala haría hit sobre el bitmap viejo y el zoom no re-renderizaría nunca.
- Entradas de escalas distintas **coexisten** en el mismo LRU y compiten por los mismos slots. Además del límite por items (`cachePages = 16`), el cache gana un límite por bytes: `PREVIEW_CACHE_MAX_BYTES = 200 MB` (constante nombrada, alineada con el presupuesto de `07` §7.1 — a escala 4 una página A4 pesa ~32 MB y caben ~6; a escala 1, las 16 de siempre). Es el mismo modelo doble ítems+bytes que ya declara `ICache` (`Contracts.md` §3.4). Se define como **constante, no campo de `RenderConfig`**: agregar un campo requerido a una config total produce churn mecánico de fixtures en todos los paquetes (lección ADR-035 §4) y nadie necesita configurarlo en MVP.
- **Sin invalidación activa** al cambiar de escala: las entradas de la escala anterior se evictan naturalmente por LRU. Invalidarlas rompería el ida-y-vuelta de zoom (volver a 1x re-renderizaría todo de nuevo gratis).

### 4. Supersede de renders obsoletos (coalescing por página)

Para una clave `(documentId, pageIndex, kind)`:

- Si llega un request con **escala distinta** mientras hay un render **pendiente en cola** para esa clave, el pendiente se descarta (nunca se ejecuta).
- Si hay un render **en vuelo**, se aborta cooperativamente en su próximo checkpoint (inline Hito 9: skip entre operaciones de canvas; modo pool Hito 10: mensaje `CANCEL` del protocolo `05` §2.1 — la maquinaria ya existe, no se agrega nada al protocolo).
- **Nunca se emite `PREVIEW_UPDATED` de una escala obsoleta**: el resultado de un render superseded se descarta sin evento. Esto preserva la idempotencia y el orden por-página declarados en `04` §7.
- El supersede vive **íntegramente en `render-engine`** (dueño del handler de `RENDER_REQUESTED` y del despacho a su pool — `Orchestrator.md` §12, ADR-034 §7): el Orchestrator no se toca.
- Prioridades: **sin cambios** en `05` §6.2. El re-render por zoom es un `render-page` preview de página visible (prioridad 70) — es exactamente eso. No compite deslealmente con la rasterización para OCR (90) ni con el camino de export (1000).

### 5. UI: CSS inmediato + re-render debounced

- Al cambiar el zoom, la UI escala **por CSS/canvas inmediatamente** (feedback a 60 fps durante el gesto; el bitmap anterior actúa de placeholder) y emite `RENDER_REQUESTED` con la escala final tras `ZOOM_RERENDER_DEBOUNCE_MS = 150 ms` sin nuevos ticks (constante de UI, documentada en `React_Client.md` §7; mismo orden de magnitud que el target de delta render de `07` §1). Al llegar cada `PREVIEW_UPDATED`, el bitmap nítido reemplaza al escalado. Es el patrón estándar de visores PDF (pdf.js viewer hace exactamente esto).
- `actions.requestRender` gana el parámetro: `requestRender(pageIndices, mode = "preview", scale?)` (`React_Client.md` §2.3). `PdfViewer`/`ZoomControls` (`Components.md` §5.2) emiten con `scale = previewScale × zoom` para el `visibleRange`.
- El *scroll* con zoom activo ya está cubierto: el cambio de `visibleRange` emite `RENDER_REQUESTED` como siempre, ahora con la escala vigente.

### 6. Sin métrica gate nueva; escenario E2E nuevo

El re-render de zoom reusa el presupuesto existente de preview (100–500 ms por página). No se agrega métrica contractual a `07` §1 en MVP. Se agrega el **escenario E2E 11** a `07` §11.3: "cambiar zoom → verificar `PREVIEW_UPDATED` con nueva escala y reemplazo del bitmap" (corre en el PR de E2E completa).

### 7. Módulos y posición en el orden de PRs (R-1/R-5)

- **Un solo PR de Core**: `shared` (payload `RenderRequested.scale`, constantes `MAX_RENDER_SCALE`/`PREVIEW_CACHE_MAX_BYTES`) + `render-engine` (handler, clave de cache, límite de bytes, supersede, guard). Los cambios de `shared` viajan en el PR del motor que los consume — precedente explícito del Hito 9 (ADR-034; `roadmap/MVP.md` Hito 9).
- El **Orchestrator no se toca**: no se suscribe a `RENDER_REQUESTED` (ADR-034 §7) y la cancelación por supersede es interna del motor/pool de Render, no pasa por `CANCEL_REQUESTED` ni por el `AbortRegistry`.
- El lado UI (debounce, CSS transitorio, `requestRender` con `scale`) viaja en los PRs de UI que ya existían (core-adapter y Visor).
- Posición exacta en la secuencia del Hito 10: PR 4 de la **tabla canónica actualizada en ADR-038 §8** (que reemplaza a la de ADR-036 §8).

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Evento nuevo (`ZOOM_RENDER_REQUESTED` / `RENDER_RESCALE_REQUESTED`) | Duplica el camino completo (enum + payload + `EventPayloadMap` + fila `04` §10 + matriz §11 + handler) para lo que es el mismo request con un parámetro más; `RenderPageInput.scale` ya existía — la omisión estaba solo en el evento. |
| Zoom CSS/canvas puro (ADR-036 §6) | Rechazado por el humano: nitidez degradada por encima de ~2x en un visor cuyo objetivo es verificar texto reemplazado. Queda como **estado transitorio** durante el debounce (§5), no como estado final. |
| Re-render por tick del gesto, sin debounce | 100–500 ms por página contra ticks de ~16 ms: satura el `RenderPool` con trabajo muerto; el supersede (§4) mitiga el desperdicio pero no lo evita — el debounce lo evita en origen. |
| Invalidación activa del cache al cambiar de escala | Complejidad sin beneficio: LRU + límite de bytes ya acotan memoria, e invalidar rompería el ida-y-vuelta de zoom (volver a una escala anterior re-renderizaría gratis). |
| `scale` como campo de `RenderConfig` mutable en runtime | `EngineConfig` es inmutable por sesión (`Contracts.md` §3.1); la escala es un atributo por-request, no por-sesión. Además un campo nuevo en una config total produce churn de fixtures (ADR-035 §4). |
| Cancelar renders obsoletos vía `CANCEL_REQUESTED`/`AbortRegistry` | Ese camino es la cancelación *de usuario* del pipeline (SLA 200 ms, `05` §3) y pasa por el Orchestrator; el supersede es una optimización interna del motor que no debe tocar la máquina de estados ni emitir `PIPELINE_CANCELLED`. |

## Consecuencias

**Positivas**: nitidez real a cualquier zoom (el pedido del humano); el contrato del evento queda simétrico con `RenderPageInput`/`RenderPagePayload` (una sola semántica de `scale` en todo el sistema); cero cambios en Orchestrator, matriz de eventos y protocolo de workers; el supersede elimina una clase entera de renders muertos (también beneficia scroll rápido con render lento); el guard de `scale` cierra una laguna de validación preexistente.

**Negativas**: a escalas altas caben menos páginas en cache (~6 a 4x) — más re-renders al scrollear con zoom alto (aceptado: acotado por `PREVIEW_CACHE_MAX_BYTES`, y el usuario con zoom 3–4x está inspeccionando, no scrolleando rápido); durante los 150 ms de debounce + latencia de render se ve el bitmap CSS borroso (aceptado: patrón estándar de visores); la clave de cache con escala invalida los hits entre `preview` default y un `scale` explícito numéricamente igual — se normaliza usando siempre la escala efectiva numérica en la clave (nota en `Render_Engine.md` §12).

## Referencias

- `core/Contracts.md` §3.4, §6, §8 — `core/Render_Engine.md` §6, §8, §9, §12, §13, §15
- `architecture/03_Data_Model.md` §18 — `architecture/04_Event_System.md` §7, §10 — `architecture/05_Worker_Architecture.md` §2.1, §6.2 — `architecture/06_Pipeline.md` §10 — `architecture/07_Performance_Strategy.md` §1, §7.1, §11.3
- `ui/React_Client.md` §2.3, §3.5, §7 — `ui/Components.md` §5.2, §12
- `adr/ADR-030` §3 — `adr/ADR-031` §2 — `adr/ADR-034` §1, §7 — `adr/ADR-035` §4 — `adr/ADR-036` §5, §6, §8 — `adr/ADR-038` §8 (tabla canónica de PRs)
- `packages/anonymization-core/render-engine/src/render.engine.ts` (handler `RENDER_REQUESTED`, clave de cache, checkpoints), `shared/src/events.ts` (`RenderRequested`)
