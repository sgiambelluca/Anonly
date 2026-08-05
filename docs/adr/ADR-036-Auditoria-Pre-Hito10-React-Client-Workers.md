<!-- CONTEXT: scope=adr | dependencias=ui/React_Client.md,ui/Components.md,ui/UX_Guidelines.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,core/Contracts.md,core/Orchestrator.md,core/Export_Engine.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-015-UI-Channel-Canonical.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,adr/ADR-030-RenderEngine-LoadDocument.md,adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md | audiencia=humanos+IA | fase=10 -->

# ADR-036 — Auditoría pre-Hito 10: React Client, transporte de Web Workers reales y alcance del ExportWorker

- **Estado**: Accepted (con §5 parcialmente superseded y §6 superseded — ver abajo)
- **Fecha**: 2026-07-17
- **Decidido por**: El planificador, auditoría previa al Hito 10 (precedente ADR-032/ADR-034). Aprobado por el humano (Santino Giambelluca) el 2026-07-17, con dos excepciones: rechazó las decisiones de §5 ("recrear el core" para el toggle de NER en runtime) y §6 (zoom sin re-render), reabiertas en `adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` y `adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` respectivamente. El resto de este ADR (§1-§4, §7-§9) queda vigente sin cambios.. El 2026-07-17 el humano **aprobó la auditoría pero reabrió dos decisiones**: el zoom sin re-render de §6 (superseded por **ADR-037**: `RenderRequested.scale` + re-render real) y el bloque "cambiar settings = recrear el core" de §5 (superseded por **ADR-038**: `reanalyze` preservando ediciones del usuario)
- **Relacionado con**: ADR-013 §6 (entry-points dentro de cada motor, eventos en host), ADR-015 (canal `ui`; excepción `CANCEL_REQUESTED`), ADR-030 (`loadDocument`), ADR-032 (`EXPORT_REQUESTED` al Orchestrator, `EncodedPageImage`), ADR-034 (auditoría pre-Hito 9, blob URLs, matriz canónica), ADR-035 (pools in-process, Workers reales → Hito 10)

## Contexto

El Hito 10 tiene dos frentes: (a) la app (`apps/react-client`: scaffold, `core-adapter`, 4 paneles, E2E) y (b) la migración de los pools in-process del Hito 9 a **Web Workers de SO reales** (ADR-035 §2). Los docs de UI (`ui/React_Client.md`, `ui/Components.md`, `ui/UX_Guidelines.md`) son de fase 4 — anteriores a ADR-014/015/032/034/035 — y `05_Worker_Architecture.md` nunca definió el mecanismo por el que los hilos reales entran al Core. La auditoría encontró:

1. **"Cuatro pools" vs "cinco workers"**: `roadmap/MVP.md` §4 nombra cuatro pools en los Hitos 9 y 10 (`PdfPool`, `OcrPool`, `NerPool`, `RenderPool`), pero `05_Worker_Architecture.md` §7 documenta **cinco** workers (§7.1 PdfWorker … §7.5 ExportWorker). Además `05` §8 define un "`ExportPool` (alias de RenderPool con workers de tipo export)" que contradice el propio §1.1 ("no se mezclan tipos en un mismo pool") y la fila `RenderPool` de esa tabla lista dos job types (`render-page`, `export-page`).
2. **Nadie define cómo entran los `Worker` al Core**: el Core no usa bundler (`Code_Standards.md` §1) y `new Worker(new URL(...))`/`?worker` solo los puede resolver el Vite de `apps/react-client`; pero `createCore(config?)` no recibe nada que le permita instanciar hilos. Sin esa costura, el primer PR de worker no puede ni arrancar.
3. **Contratos de UI con referencias inexistentes o prohibidas**: `ui/React_Client.md` §8 manda a la UI reaccionar al evento `NER_PAGE_FAILED` — **que no existe** en `EngineEvents`/`04_Event_System.md` (solo existe el error code; `ner-engine` descarta la página con `logger.warn`, sin evento, `ner.engine.ts`) — y ante `PDF_PASSWORD_REQUIRED` manda "re-llama a `engines.pdf.process` con password", prohibido por `core/Orchestrator.md` §6 ("la UI no llama a los motores directamente") y superado por `retryWithPassword`. `ui/Components.md` invoca `actions.updateRule`, `actions.deleteRule` y `actions.requestRender(visibleRange, kind)` que `React_Client.md` §2.3 no define — y ese `kind` no existe en el payload `RenderRequested`.
4. **Zoom inexpresable**: `Components.md` §5.2 pide "re-render con nueva escala" al cambiar zoom, pero `RenderRequested` (`Contracts.md` §8) no transporta escala.
5. **Componentes exigidos por `MVP.md` §2.3 sin entrada en `Components.md`**: diálogo de password, settings (idioma/preset/NER/OCR languages) y confirmación de cancelación.
6. **Payloads de worker no implementables tal como están**: `OcrPagePayload.imageData: ArrayBuffer` sin dimensiones (el OcrWorker no puede reconstruir la imagen; `OcrPageInput` real usa `ImageData`); `RUN(load-document)` (`05` §7.4) no corresponde a ningún `WorkerJobType` ni payload de `03_Data_Model.md` §18; la serialización final del ExportWorker cuelga de `DISPOSE` (`05` §7.5), que no tiene mensaje de respuesta en `WorkerOutbound`.
7. **Settings ↔ `EngineConfig` sin mapeo**: el preset de rendimiento, `nerEnabled` y `ocrLanguages` del `settings.store` no tienen regla de traducción a `WorkerPoolConfig`/`NerConfig`/`OcrConfig`, y el escenario E2E 9 ("activar NER en runtime → reanaliza", `07` §11.3) no tiene flujo definido en ningún doc.

## Decisión

### 1. Cuatro pools, cinco entry-points de worker; el ExportWorker existe, el "ExportPool" no

- El número canónico de **pools es cuatro** (`PdfPool`, `OcrPool`, `NerPool`, `RenderPool`): lo fijan `05` §1.1, `WorkerPoolConfig.maxQueuePerPool` (4 claves, ADR-034 §7) y `worker-pool.ts` (`PoolKey`). `roadmap/MVP.md` **no está mal** en "los cuatro pools"; la ambigüedad era conflar pool con worker.
- El número canónico de **entry-points de worker del Hito 10 es cinco**: PdfWorker, OcrWorker, NerWorker, RenderWorker y **ExportWorker** (`05` §7.1–§7.5). ADR-035 §2 ya lo decía ("`RenderPool`/`ExportWorker` según `05` §7.4/§7.5") — esta decisión lo ratifica, no lo contradice ni escala nada.
- El **ExportWorker es un worker único dedicado, sin `WorkerPool`**: el ensamblado pdf-lib es estrictamente secuencial sobre un solo `PDFDocument` (`Export_Engine.md` §12: "pdf-lib no es thread-safe para el mismo `PDFDocument`"), así que una cola prioritaria multi-worker no aporta nada. Lo posee el lado host de `export-engine` (dueño de pdf-lib), se crea perezoso al primer `EXPORT_REQUESTED` y se dispone tras 60 s idle o `dispose()` del motor (`05` §8). La frase "`ExportPool` (alias de RenderPool con workers de tipo export)" de `05` §8 es **errata** (mezclaba tipos contra §1.1) y queda corregida; la fila `RenderPool` de §1.1 queda mono-tipo (`render-page`, que incluye la rasterización para OCR — ADR-034 §1).
- La etapa 11 (`06_Pipeline.md` §14) queda partida con precisión: el **render full por página** corre en `RenderPool` como `render-page` con prioridad 1000 (así lo implementó ya el Hito 9: `orchestrator.ts`, `makeRenderPageProvider`); el **ensamblado** corre en el ExportWorker (jobs `export-page`). `ExportEngine.export()` sigue viviendo en host (dirige el loop, emite `EXPORT_*` — ADR-013 §6); solo la frontera pdf-lib cruza al worker.
- `roadmap/MVP.md` §4 Hito 10 pasa a decir explícitamente "cuatro pools, **cinco entry-points**" para que ningún implementador lea "cuatro" como "cuatro workers" y omita el ExportWorker.

**Alternativas rechazadas**:

| Alternativa | Por qué no |
|---|---|
| Quinto pool (`ExportPool` real, clave nueva en `WorkerPoolConfig`) | Cambia un contrato público (`maxQueuePerPool`/`PoolKey` de 4 claves, ADR-034 §7) para un "pool" que por diseño tiene tamaño 1 y cola trivial; churn mecánico de fixtures en todos los paquetes sin ganancia. |
| Export inline en host también en Hito 10 (sin ExportWorker) | `save()` de pdf-lib son 500–2000 ms de main thread (`Export_Engine.md` §12) contra A-9; contradiría `05` §7.5, `06` §14 y ADR-035 §2, que ya comprometieron el worker. |

### 2. Los `Worker` reales entran por `createCore`: `CoreRuntimeOptions` con factories

`createCore` gana un segundo parámetro opcional (reflejo en `Contracts.md` §3.5; código en el PR de transporte del hito, patrón docs-primero ADR-029 §4):

```ts
export interface WorkerLike {
  postMessage(message: unknown, transfer?: ReadonlyArray<globalThis.Transferable>): void;
  addEventListener(type: "message" | "error", listener: (ev: unknown) => void): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike;
export type WorkerEntryKind = "pdf" | "ocr" | "ner" | "render" | "export";

export interface CoreRuntimeOptions {
  readonly workers?: Partial<Readonly<Record<WorkerEntryKind, WorkerFactory>>>;
}

export async function createCore(
  config?: Partial<EngineConfig>,
  runtime?: CoreRuntimeOptions
): Promise<IAnonymizationCore>;
```

- **Semántica**: si hay factory para un kind, ese pool (o el ExportWorker) despacha por `postMessage`; si no, despacha **in-process** exactamente como en el Hito 9 (ADR-035 §1). La mezcla es válida — habilita la migración motor por motor, un PR por vez (R-1) — y los tests del Core siguen corriendo en node sin `Worker`.
- Las factories van en un parámetro aparte y **no** dentro de `EngineConfig`: `EngineConfig` viaja serializado a los workers en `INIT` y las funciones no son estructured-cloneables.
- La app las provee donde Vite las puede resolver: `import PdfWorker from "@anonly/pdf-engine/worker?worker"` → `createCore(config, { workers: { pdf: () => new PdfWorker() } })`. Cada paquete de motor agrega el subpath export `"./worker"` en su propio PR.
- `WorkerLike` es estructural a propósito: los tests del transporte inyectan fakes con la misma forma sin necesitar un `Worker` de browser.

### 3. Modelo de dos mitades por motor y variante `EVENT` de `WorkerOutbound`

Cada PR de worker entrega **dos mitades dentro del mismo paquete de motor** (un dueño por librería, ADR-034 §1):

- **Entry-point** (`<engine>/src/worker/entry.ts`, bundleado por Vite): instancia el **motor real** con un `EngineContext` worker-local — bus puente (cada `emit` se serializa como mensaje `EVENT` al host), logger puente (`LOG`), cache local, `AbortSignal` derivado de los mensajes `CANCEL`. Así se cumple ADR-013 §6 ("envolver la función en un job del worker sin modificarla") sin duplicar lógica.
- **Host-bridge** (mismo paquete): traduce los mensajes del worker a efectos de host y **re-emite los eventos en el bus real** — los eventos observables se emiten siempre en host (ADR-013 §6). Es donde se completan los efectos que un worker no puede hacer: crear los blob URLs de `PREVIEW_UPDATED`/`EXPORT_FINISHED` a partir de los bytes transferidos (ADR-034 §5, `Render_Engine.md` §7 nota, `Export_Engine.md` §7 nota) y depositar las `Word[]` de OCR en `ctx.cache` (ADR-014 §1).
- `WorkerOutbound` (`05` §2.2, `shared/src/interfaces.ts`) gana la variante que este modelo necesita:

```ts
| { readonly type: "EVENT"; readonly channel: EventChannel; readonly event: EngineEvents; readonly payload: unknown }
```

  `payload` es `unknown` a nivel de transporte y lo afina el host-bridge de cada motor (mismo criterio que `INIT.config`/`RUN.payload`, ADR-019).

### 4. Transferables y payloads corregidos (sin `WorkerJobType` nuevos)

- **`OcrPagePayload.imageData` pasa de `ArrayBuffer` a `ImageData`** (errata en `03_Data_Model.md` §18 y `shared/src/types.ts`): un `ArrayBuffer` pelado no lleva `width`/`height` y el OcrWorker no puede reconstruir la imagen; `OcrPageInput` (el tipo real del motor) ya usa `ImageData`. La transferencia zero-copy se hace con `postMessage(msg, [imageData.data.buffer])` (el clon estructurado de `ImageData` referencia el buffer transferido) — aclarado en `05` §2.3. Código en el PR del OcrWorker.
- **`load-document` no es un `WorkerJobType`**: es un **mensaje de control broadcast** del host a *cada* worker del `RenderPool` (todos necesitan el `PDFDocumentProxy`; una cola que lo entregara a un solo worker idle rompería la precondición de ADR-030). El buffer se **clona** por worker — no se transfiere: transferirlo vaciaría el original retenido de la etapa 0 (`06` §3, ADR-030). Errata en `05` §7.4 ("buffer transferido" → clonado) y payload nuevo `LoadDocumentPayload` en `03` §18.
- **La rasterización para OCR viaja bajo `render-page`**: payload nuevo `RasterizePagePayload { documentId, pageIndex, scale }`, jobType `"render-page"`, prioridad 90/40 (espejo de `ocr-page`), timeouts/retries de `render-page`. Sin `WorkerJobType` nuevo: los `Readonly<Record<WorkerJobType, …>>` de `WorkerPoolConfig` son totales y agregar claves produciría churn mecánico de fixtures en todos los paquetes (lección de ADR-035 §4) sin valor semántico. Coincide con lo que el Hito 9 ya hace (`orchestrator.ts` despacha `rasterizePage` en el pool render con prioridad 90).
- **La serialización final del ExportWorker es un job, no un efecto de `DISPOSE`**: `DISPOSE` no tiene mensaje de respuesta en `WorkerOutbound`, así que colgar de él la devolución del `ArrayBuffer` final (errata de `05` §7.5) era inimplementable. Payload nuevo `ExportSavePayload { documentId }` bajo jobType `"export-page"`: su `COMPLETED` devuelve el `ArrayBuffer` transferido; `DISPOSE` solo libera.
- `WorkerJobType` queda **sin cambios**. `03` §18 gana `LoadDocumentPayload`, `RasterizePagePayload` y `ExportSavePayload`.
- Guía de implementación: en archivos de worker (lib DOM activa), el `Transferable<T>` de `@anonly/shared` **sombrea** al `Transferable` global del DOM; importarlo con alias (`import type { Transferable as TransferableBuffer }`) para no pelearse con el parámetro `transfer` de `postMessage`.

### 5. Contrato del `core-adapter` completado

> **Parcialmente superseded por ADR-038** (2026-07-17): el bloque final "**Cambiar settings de Core en runtime = recrear el core**" fue rechazado por el humano (descartaba las ediciones del usuario) y queda reemplazado por `orchestrator.reanalyze(documentId, patch)` con sesión de Grouping reabrible (ADR-038 §1–§7; `React_Client.md` §3.7 reescrito). El resto de esta sección (acciones del adapter, erratas de §8, mapeo settings→`EngineConfig`, `snapshots.ts`) **sigue vigente**. Se conserva íntegra como registro histórico.

- `ui/React_Client.md` §2.3 gana las acciones que `Components.md` ya invocaba sin definición: `updateRule(ruleId, patch)` → `RULE_UPDATED`; `deleteRule(ruleId)` → `RULE_DELETED`; `requestRender(pageIndices, mode = "preview")` → `RENDER_REQUESTED` (~~**sin `kind`**: el payload `RenderRequested` no lo tiene y Render decide solo — original primero, anonimizado después, `06` §10; errata en `Components.md` §5.2~~ — **errata ADR-056 §1**: el payload gana `kind` **requerido** y el motor renderiza solo ese lado; la firma también ganó `scale?` en ADR-037 §1); `retryWithPassword(password)` → `orchestrator.retryWithPassword(documentId, password)`.
- Erratas de `React_Client.md` §8:
  - `PDF_PASSWORD_REQUIRED`: la UI se suscribe directo al canal `pdf` (ADR-034 §4) y al submitear llama `orchestrator.retryWithPassword` — **nunca** `engines.pdf.process`.
  - La fila del evento `NER_PAGE_FAILED` **se elimina**: el evento no existe (`04_Event_System.md` §5); el fallo de página NER es degradación silenciosa con `logger.warn` y descarte de ocurrencias NER de esa página (`NER_Engine.md` §7, `ner.engine.ts`). Si v1.0 quiere el toast, el evento se crea entonces vía ADR (R-19).
  - `NER_MODEL_MISSING` no es un evento: llega como `PIPELINE_FAILED` con `error.code === "NER_MODEL_MISSING"`; la UI ofrece desactivar NER y reanalizar (flujo de abajo). El "¿Descargar (~60 MB)…?" era doblemente errata: los assets son first-party (ADR-018) y el modelo Q8 pesa ~178 MB (ADR-023).
  - `EXPORT_NO_ENABLED_GROUPS` es el **pre-flight local** del `ExportDialog` (`enabledGroups === 0` calculado del store) — no un evento recibido (el motor solo loguea warn, ADR-032 §3).
- **Mapeo settings → `EngineConfig`** (nuevo §3.7 de `React_Client.md`): `nerEnabled` → `ner.enabled`; `ocrLanguages` → `ocr.languages`; `performancePreset`: `auto` = defaults de `05` §1.1 (derivados de `hardwareConcurrency`; la serialización OCR/NER por `deviceMemory < 4` GB ya la aplica el Orchestrator), `low` = `{ pdf: 1, ocr: 1, ner: 1, render: 1 }`, `high` = `{ pdf: 4, ocr: 2, ner: 2, render: 4 }`. `language` y `defaultReplacementMode` son UI-only (el segundo se materializa como regla global default vía `RULE_CREATED`).
- **Cambiar settings de Core en runtime = recrear el core**: `EngineConfig` se fija en `createCore`. Con documento abierto, la UI confirma, hace `closeDocument` + `dispose()` + `createCore(nuevaConfig, runtime)` + re-`importDocument` del mismo `File` (la UI lo retiene). El escenario E2E 9 ("activar NER en runtime → descarga modelo y reanaliza", `07` §11.3) se cumple observablemente con este flujo; no se agrega API de re-análisis parcial al Orchestrator en MVP.
- `snapshots.ts` consume `core.engines.grouping.getSnapshot(documentId)` (U-6; ya implementado en Hito 6, lo usa el Orchestrator en `enqueueExport`): es la vía de **hidratación puntual** (p. ej. montar un panel tarde); la fuente reactiva siguen siendo los eventos del bus.

### 6. Zoom sin re-render en MVP

> **Superseded por ADR-037** (2026-07-17): el humano rechazó esta decisión y pidió re-render real. El zoom del MVP pasa a re-renderizar vía `RenderRequested.scale` (cache por escala, supersede de renders obsoletos, debounce de 150 ms en UI; el escalado CSS queda solo como estado transitorio durante el debounce). Se conserva íntegra como registro histórico.

El zoom (0.5–3, `viewer.store`) escala por **CSS/canvas el bitmap ya renderizado** a `previewScale`; no dispara `RENDER_REQUESTED` (el payload no transporta escala y agregarla tocaría `shared` + `render-engine` desde PRs de UI). Erratas: `Components.md` §5.2 ("re-render con nueva escala") y `React_Client.md` §7 ("cuando cambia `visibleRange` o `zoom`" → solo `visibleRange`). Extensión candidata a v1.0: `RenderRequested.scale?` vía ADR, con re-render debounced al soltar el gesto.

### 7. Componentes faltantes en `Components.md`

Se agregan al catálogo (huecos contra `MVP.md` §2.3 y `UX_Guidelines.md` §2/§7.3):

- `PasswordDialog` (`toolbar/`): se abre por `PDF_PASSWORD_REQUIRED` (suscripción directa al canal `pdf`, ADR-034 §4); submit → `actions.retryWithPassword`; muestra error y re-pide si vuelve a llegar el evento. El input **nunca** se loguea ni persiste (`08_Security_Model.md` §7).
- `ConfirmDialog` (`common/`): confirmación genérica (cancelar pipeline — `UX_Guidelines.md` §7.3 —, deshabilitar grupo, borrar regla). `CancelButton`, `GroupContextMenu` y `RuleItem` ya lo referenciaban sin que existiera.
- `SettingsButton` + `SettingsDialog` (`toolbar/`): idioma (es default), performance preset, NER toggle, OCR languages (`MVP.md` §2.3); persiste vía `settings.persist()`; los cambios de Core aplican con el flujo de recreación del §5.
- Errata `Components.md` §12: `ImportButton` dispara `actions.importDocument` → `orchestrator.importDocument` (el `DOCUMENT_IMPORTED` lo emite el Orchestrator, `04` §2); la mención "`pdf.process`" se elimina.

### 8. Orden de PRs del Hito 10: UI primero sobre el core in-process, migración de workers después

El orden literal del roadmap (scaffold → migrar pools → adapter → paneles → E2E) se **invierte en el medio**: los pools in-process del Hito 9 son funcionalmente completos (ADR-035 §1), así que toda la UI puede construirse y probarse contra ellos **hoy**; los workers reales, en cambio, no pueden ni bundlearse ni verificarse sin la app. Hacer la UI primero convierte a la E2E en red de seguridad de la migración (mismo output observable inline vs pool, invariante ADR-013).

| # | PR | Módulo | Contenido |
|---|---|---|---|
| 1 | Scaffold | `apps/react-client` | Vite + Tailwind + Radix + Zustand; CSP de `08` §3.2; tokens (`Components.md` §10); hero/estado vacío. Bootea sin Core. |
| 2 | `core-adapter` | `apps/react-client` | `initCore` (in-process), bus-bridge, actions completas (§5), snapshots, 6 stores. |
| 3 | Toolbar + diálogos de flujo | `apps/react-client` | `Toolbar`, `ImportButton`, `PipelineStatus`, `CancelButton` + `PasswordDialog`, `ConfirmDialog`, `SettingsDialog`. |
| 4 | Visor | `apps/react-client` | `SideBySideViewer`, `PdfViewer`, `PageVirtualizer`, `PageCanvas`, `ZoomControls` (zoom CSS, §6). |
| 5 | Panel Entidades + conflictos | `apps/react-client` | `EntitiesPanel` y sub-árbol, `MergeDialog`, `SplitDialog`, `ConflictBadge/Dialog`. |
| 6 | Panel Reglas + Export | `apps/react-client` | `RulesPanel`, `Rule*Dialog`, `ExportButton/Dialog/Progress`. |
| 7 | E2E base | `tests/e2e/` | Playwright; escenarios 1, 6, 8 de `07` §11.3 sobre core in-process; activa el gate `test:e2e` (`07` §11.4). |
| 8 | Transporte de workers | `packages/anonymization-core/src` | `CoreRuntimeOptions`/`WorkerLike` (§2), modo `postMessage` en `worker-pool.ts`, variante `EVENT` (§3), fakes estructurales en tests. |
| 9–13 | Workers, uno por PR (R-1) | `pdf-engine`, `render-engine`, `ocr-engine`, `ner-engine`, `export-engine` | Entry-point + host-bridge + subpath export `"./worker"` + wiring en la app; E2E verde tras cada uno. Orden: Pdf (más simple, `parsePage` ya aislada — ADR-013 §6), Render (desbloquea rasterización OCR y previews fuera del main thread), Ocr, Ner, Export (§1). |
| 14 | E2E completa | `tests/e2e/` | Escenarios 2, 3, 4, 5, 7, 9, 10 de `07` §11.3; fixtures pesados que falten (`07` §11.2). |

### 9. Erratas menores que acompañan

- `04_Event_System.md` §2/§4/§8: las celdas de payload `error: EngineError` pasan a `SerializedEngineError` (la forma canónica de `Contracts.md` §8; los payloads del bus nunca transportan la clase).
- `UX_Guidelines.md` §3.1: el checkbox de grupo se aclara — la UI emite `GROUP_UPDATE_REQUESTED` con `patch.enabled`; `GROUP_TOGGLED` es la respuesta de Grouping (la redacción previa invitaba a emitirlo desde la UI, contra la matriz `04` §11).
- `core/Orchestrator.md`: línea de estado "pendiente (Hito 9). El façade actual es un placeholder" → implementado (Hito 9, PR #19; pools in-process — ADR-035).
- `roadmap/MVP.md`: cabecera `<!-- CONTEXT -->` desactualizada (describía el estado de fase 5); Hito 10 reescrito según §1/§8.
- `05_Worker_Architecture.md` §8: bullet de `ExportPool` reescrito según §1.

## Consecuencias

**Positivas**: la contradicción cuatro/cinco queda cerrada con una regla memorizable (pools ≠ entry-points) y sin cambios de contrato en `WorkerPoolConfig`; el primer PR de worker tiene costura definida (`CoreRuntimeOptions`), protocolo completo (`EVENT`, payloads §4) y entorno donde verificarse (la app + E2E ya existentes por el orden §8); la migración es incremental por motor con fallback in-process permanente para tests; el `core-adapter` queda especificado sin que el implementador deba inventar acciones ni flujos (password, settings, NER toggle); la clase de ambigüedad "evento referenciado que no existe" (`NER_PAGE_FAILED`) se elimina antes de que alguien la implemente.

**Negativas**: `createCore` gana un segundo parámetro (superficie pública mayor; mitigado: opcional y aditivo — los callers del Hito 9 no cambian); el buffer del PDF se clona una vez por RenderWorker (§4; acotado por `renderPoolSize ≤ 4` y el presupuesto de memoria de `05` §7.4); el zoom del MVP pierde nitidez por encima de ~2x (aceptado; upgrade path documentado en §6); los motores siguen importando sus libs pesadas estáticamente, así que el code splitting del bundle inicial (`07` §2.1, gate < 800 KB gz) queda para los PRs de worker (import dinámico del lado host) o el Hito 11 — anotado como riesgo, no bloqueante; hasta el PR 8+ la app corre sobre el main thread (mitigación idéntica a ADR-035: es exactamente el estado aceptado del Hito 9, y la migración llega dentro del mismo hito).

## Referencias

- `roadmap/MVP.md` §4 (Hitos 9–10) — `architecture/05_Worker_Architecture.md` §1.1, §2, §6.2, §7, §8 — `architecture/06_Pipeline.md` §3, §14 — `architecture/03_Data_Model.md` §18 — `architecture/04_Event_System.md` §2, §4, §5, §8 — `architecture/07_Performance_Strategy.md` §2.1, §11.3, §11.4 — `architecture/08_Security_Model.md` §3.2, §7
- `core/Contracts.md` §3.5, §5, §7, §8 — `core/Orchestrator.md` §2, §6, §8 — `core/Export_Engine.md` §12 — `core/Render_Engine.md` §7–§9 — `core/NER_Engine.md` §7
- `ui/React_Client.md` — `ui/Components.md` — `ui/UX_Guidelines.md`
- `adr/ADR-013` §6 — `adr/ADR-014` §1 — `adr/ADR-015` — `adr/ADR-018` — `adr/ADR-021` — `adr/ADR-023` — `adr/ADR-029` §4 — `adr/ADR-030` — `adr/ADR-032` §2, §3 — `adr/ADR-034` §1, §4, §5, §7 — `adr/ADR-035` §1, §2, §4
- `packages/anonymization-core/src/worker-pool.ts`, `src/orchestrator.ts` (`makeRenderPageProvider`, `runDetectionStage`) — `shared/src/interfaces.ts` (`WorkerInbound`/`WorkerOutbound`), `shared/src/types.ts` (payloads) — `ner-engine/src/ner.engine.ts` (descarte sin evento) — `grouping-engine` (`getSnapshot`)
