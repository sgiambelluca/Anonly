<!-- CONTEXT: scope=ui-contract | dependencias=01_Technical_Architecture_Document.md,03_Data_Model.md,04_Event_System.md,ADR-005-State-Management.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-054-Scroll-Independiente-Por-Panel.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md | audiencia=IA-implementador-ui | fase=4 (reconciliado en fase 10 por ADR-036: acciones completas §2.3, workers §2.4, settings §3.7, zoom §7, errores §8; §2.3/§3.7/§7 reescritos por ADR-037 —zoom con re-render real— y ADR-038 —reanalyze preservando ediciones, supersede el flujo "recrear el core") -->

# Anonly — React Client (UI Contract, TAD bloque 9)

> Define cómo el cliente consume el Core. **Independiente del framework de UI**: aunque el MVP usa React, este contrato es agnóstico y podría implementarse con Vue/Svelte/Solid sin tocar el Core. El Core no conoce este documento; este documento describe cómo el cliente se acopla al Core.

---

## 1. Principios

| # | Principio |
|---|---|
| U-1 | El cliente **solo** contiene UI, estado de UI y un adapter al Core. Sin lógica de anonimización. |
| U-2 | El cliente se comunica con el Core **únicamente** por eventos del `IEventBus` y por llamadas a la API pública de `@anonly/anonymization-core`. |
| U-3 | El cliente nunca accede a internos de un motor (sin `pdf.engine.ts`, `ner.engine.ts`, etc.). Solo `index.ts` de cada paquete. |
| U-4 | El estado del cliente (Zustand) se actualiza por eventos del bus vía un adapter. El cliente nunca mutar el estado del Core. |
| U-5 | Las acciones del usuario se traducen a eventos del canal `ui` (ver `04_Event_System.md` §10). |
| U-6 | El cliente puede leer `getSnapshot()` del Grouping Engine para tener una vista consultable. |
| U-7 | El cliente maneja su propio estado de UI (selección, expansión, viewport, zoom) sin consultar al Core. |
| U-8 | El cliente implementa virtualización y lazy loading para no procesar todas las páginas de golpe (ver `07_Performance_Strategy.md` §3). |

---

## 2. Capa de adapter

`apps/react-client/src/core-adapter/` es el único punto de contacto con el Core.

```
apps/react-client/src/
├── core-adapter/
│   ├── index.ts              // inicializa el Core, expone la API
│   ├── bus-bridge.ts         // subscribe al bus, muta Zustand
│   ├── actions.ts            // acciones de UI → eventos del bus
│   └── snapshots.ts          // lee snapshots del Grouping Engine
├── store/
│   ├── document.store.ts
│   ├── entities.store.ts
│   ├── rules.store.ts
│   ├── pipeline.store.ts
│   ├── viewer.store.ts
│   └── settings.store.ts
├── components/
│   └── ...
└── App.tsx
```

### 2.1 Inicialización

```ts
// core-adapter/index.ts
import { createCore, IAnonymizationCore } from "@anonly/anonymization-core";

let core: IAnonymizationCore | undefined;

export async function initCore(): Promise<IAnonymizationCore> {
  if (core) return core;
  core = await createCore({ /* EngineConfig */ });
  // Los stores (Zustand) son del adapter, no del Core: IAnonymizationCore no
  // expone `stores` (errata corregida, ADR-034 §7). El bridge suscribe los
  // stores locales a los eventos del bus.
  busBridge.subscribe(core.bus, stores);
  return core;
}

export function getCore(): IAnonymizationCore {
  if (!core) throw new Error("Core not initialized");
  return core;
}
```

**`getCoreAsync` (PR17.3)**: además de `initCore`/`getCore`, el adapter expone `getCoreAsync(): Promise<IAnonymizationCore>` — espera la instancia ya en curso (o ya lista) **sin poder pasarle `config`**. Solo `App.tsx` llama a `initCore(overrides)` (el `EngineConfigOverrides` de §3.7); cualquier otro consumidor que solo necesite `core.bus` u otro miembro de la instancia (hoy, `PasswordDialog.tsx`, que se suscribe a `PDF_PASSWORD_REQUIRED`) debe llamar a `getCoreAsync()`, nunca a `initCore()`. Motivo: en React los efectos de los componentes hijos corren antes que los del padre en el mismo commit de montaje, así que un consumidor hijo que llamara a `initCore()` sin argumentos podría ganar la carrera de inicialización y hacer que el `config` de `App.tsx` nunca llegue a `createCore()` — `getCoreAsync` no puede arrancar la creación bajo ningún orden de montaje, así que esa carrera deja de ser posible.

### 2.2 Bus → Zustand (bridge)

```ts
// core-adapter/bus-bridge.ts
export function subscribe(bus: IEventBus, stores: Stores): Unsubscribes {
  const unsubs: Unsubscribe[] = [];

  unsubs.push(bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, (p) => {
    stores.pipeline.setState({ stage: p.stage, progress: p.progress });
  }));

  unsubs.push(bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, (p) => {
    stores.pipeline.setState({ current: p.current, total: p.total });
  }));

  unsubs.push(bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, (p) => {
    stores.pipeline.setState({ stage: PipelineStage.Ready, groupCount: p.groupCount, conflictCount: p.conflictCount });
  }));

  unsubs.push(bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, (p) => {
    stores.entities.addGroup(p.group);
  }));

  unsubs.push(bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, (p) => {
    stores.entities.updateGroup(p.group);
  }));

  unsubs.push(bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_REMOVED, (p) => {
    stores.entities.removeGroup(p.groupId);
  }));

  unsubs.push(bus.on(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, (p) => {
    stores.entities.updateReplacement(p.groupId, p.mode, p.value);
  }));

  unsubs.push(bus.on(EventChannel.Grouping, EngineEvents.CONFLICT_DETECTED, (p) => {
    stores.entities.addConflict(p.conflict);
  }));

  unsubs.push(bus.on(EventChannel.Grouping, EngineEvents.CONFLICT_RESOLVED, (p) => {
    stores.entities.resolveConflict(p.conflictId);
  }));

  unsubs.push(bus.on(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, (p) => {
    stores.viewer.setPreview(p.pageIndex, p.kind, p.canvasBlobUrl);
  }));

  unsubs.push(bus.on(EventChannel.Ner, EngineEvents.NER_MODEL_LOADING, (p) => {
    stores.pipeline.setState({ modelLoading: { modelId: p.modelId, progress: p.progress } });
  }));

  unsubs.push(bus.on(EventChannel.Export, EngineEvents.EXPORT_PROGRESS, (p) => {
    stores.pipeline.setState({ exportProgress: { current: p.current, total: p.total } });
  }));

  // EXPORT_FINISHED/EXPORT_FAILED limpian exportProgress (bug #7 del
  // Escenario 1 E2E, 2026-07-22): sin esto, PipelineStatus muestra el último
  // "Exportando página N de N…" para siempre tras terminar el export.
  unsubs.push(bus.on(EventChannel.Export, EngineEvents.EXPORT_FINISHED, (p) => {
    stores.pipeline.setState({
      exportResult: { blobUrl: p.blobUrl, sizeBytes: p.sizeBytes },
      exportProgress: null,
    });
  }));

  // ... etc

  return () => unsubs.forEach((u) => u());
}
```

### 2.3 Zustand → Bus (acciones)

```ts
// core-adapter/actions.ts
export const actions = {
  async importDocument(file: File): Promise<void> {
    const documentId = crypto.randomUUID();
    const buffer = await file.arrayBuffer();
    // DOCUMENT_IMPORTED lo emite el Orchestrator; la UI nunca invoca motores
    // directamente para el flujo del pipeline (ver core/Orchestrator.md §6).
    await getCore().orchestrator.importDocument({ documentId, name: file.name, buffer });
  },

  updateGroup(groupId: string, patch: Partial<Pick<EntityGroup, "replacementMode" | "replacementValue" | "enabled" | "canonicalValue">>): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, { documentId, groupId, patch });
  },

  mergeGroups(sourceGroupId: string, targetGroupId: string): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.GROUP_MERGE_REQUESTED, { documentId, sourceGroupId, targetGroupId });
  },

  splitGroup(groupId: string, occurrenceIds: string[]): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.GROUP_SPLIT_REQUESTED, { documentId, groupId, occurrenceIds });
  },

  createRule(rule: Rule): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RULE_CREATED, { documentId, rule });
  },

  resolveConflict(conflictId: string, mode: ReplacementMode): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, { documentId, conflictId, mode });
  },

  // Acciones agregadas por ADR-036 §5 (Components.md ya las invocaba):

  updateRule(ruleId: string, patch: Partial<Rule>): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RULE_UPDATED, { documentId, ruleId, patch });
  },

  deleteRule(ruleId: string): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RULE_DELETED, { documentId, ruleId });
  },

  // Sin parámetro `kind`: el payload RenderRequested no lo tiene; Render decide
  // solo (original primero, anonimizado después — 06_Pipeline.md §10).
  // `scale?` (ADR-037 §1, §5): ausente → previewScale/fullScale según mode;
  // ZoomControls la pasa como previewScale × zoom tras el debounce de 150 ms.
  requestRender(pageIndices: ReadonlyArray<number>, mode: "preview" | "full" = "preview", scale?: number): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, { documentId, pageIndices, mode, scale });
  },

  // Re-análisis parcial preservando ediciones (ADR-038 §1, §7). Reemplaza el
  // flujo "recrear el core" de una versión previa de este doc (ADR-036 §5,
  // superseded): con documento abierto, el SettingsDialog confirma y llama
  // esta acción en vez de closeDocument+dispose+createCore+reimport.
  async reanalyze(patch: ReanalyzeConfigPatch): Promise<void> {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    await getCore().orchestrator.reanalyze(documentId, patch);
  },

  // PDF_PASSWORD_REQUIRED → PasswordDialog → esta acción. La UI NUNCA llama a
  // engines.pdf.process (Orchestrator.md §6; errata previa corregida, ADR-036 §5).
  async retryWithPassword(password: string): Promise<void> {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    await getCore().orchestrator.retryWithPassword(documentId, password);
  },

  requestExport(options: ExportOptions): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId, options });
  },

  // CANCEL_REQUESTED viaja por el canal `pipeline` (excepción documentada de
  // ADR-015: el canal se determina por el emisor, salvo este caso histórico).
  cancel(): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.Pipeline, EngineEvents.CANCEL_REQUESTED, { documentId });
  },

  // Callers (ADR-051): CloseDocumentButton del Toolbar (con ConfirmDialog —
  // Components.md §2.8), el "Cerrar documento" del banner de Failed
  // (PipelineStatus, sin confirmación) y el cancelar de PasswordDialog.
  closeDocument(): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.DOCUMENT_CLOSED, { documentId });
    stores.document.reset();
    stores.entities.reset();
    stores.rules.reset();
    stores.viewer.reset();
    stores.pipeline.reset();
  },
};
```

### 2.4 Wiring de Web Workers reales (Hito 10, ADR-036 §2)

La app es la única con bundler: crea los `Worker` con los imports `?worker` de Vite y los inyecta a `createCore` como factories. Sin factory para un kind, ese despacho queda in-process (comportamiento del Hito 9).

```ts
// core-adapter/index.ts (wiring progresivo: un factory por PR de worker)
import PdfWorker from "@anonly/pdf-engine/worker?worker";
import RenderWorker from "@anonly/render-engine/worker?worker";
// ... ocr, ner, export a medida que llegan sus PRs

core = await createCore(buildEngineConfig(stores.settings.getState()), {
  workers: {
    pdf: () => new PdfWorker(),
    render: () => new RenderWorker(),
  },
});
```

---

## 3. Slices de Zustand

### 3.1 `document.store.ts`

```ts
interface DocumentSlice {
  readonly id: string | null;
  readonly name: string | null;
  readonly pageCount: number;
  readonly sourceKind: "text" | "scanned" | "mixed" | null;
  setPage(id: string, name: string, pageCount: number, sourceKind: ...): void;
  reset(): void;
}
```

### 3.2 `entities.store.ts`

```ts
interface EntitiesSlice {
  readonly groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>;
  readonly conflicts: ReadonlyArray<Conflict>;
  addGroup(group: EntityGroup): void;
  updateGroup(group: EntityGroup): void;
  removeGroup(groupId: string): void;
  updateReplacement(groupId: string, mode: ReplacementMode, value: string): void;
  addConflict(conflict: Conflict): void;
  resolveConflict(conflictId: string): void;
  reset(): void;
}
```

### 3.3 `rules.store.ts`

```ts
interface RulesSlice {
  readonly rules: ReadonlyArray<Rule>;
  addRule(rule: Rule): void;
  updateRule(ruleId: string, patch: Partial<Rule>): void;
  removeRule(ruleId: string): void;
  reset(): void;
}
```

### 3.4 `pipeline.store.ts`

```ts
interface PipelineSlice {
  readonly stage: PipelineStage;
  readonly progress: number;
  readonly current: number;
  readonly total: number;
  readonly groupCount: number;
  readonly conflictCount: number;
  readonly modelLoading: { modelId: string; progress: number } | null;
  readonly exportProgress: { current: number; total: number } | null;
  readonly exportResult: { blobUrl: string; sizeBytes: number } | null;
  readonly error: SerializedEngineError | null;
  setState(patch: Partial<PipelineSlice>): void;
  reset(): void;
}
```

### 3.5 `viewer.store.ts`

```ts
type ViewerKind = "original" | "anonymized";

interface ViewerSlice {
  // ADR-054 §1: por panel, no globales. Los dos PdfViewer scrollean independiente,
  // así que cada uno tiene su propia página actual y su propio rango visible.
  readonly currentPageIndex: Readonly<Record<ViewerKind, number>>;
  readonly visibleRange: Readonly<Record<ViewerKind, { start: number; end: number }>>;
  readonly zoom: number;          // 0.5..3 — sigue siendo global (los dos paneles comparten escala)
  readonly sideBySide: boolean;   // default true — declarado, hoy sin setter ni consumidor (ambigüedad abierta; ADR-054 §7 decide NO reutilizarlo)
  // Por panel, no un Map compartido: si "original" y "anonymized" comparten
  // el mismo Map, cualquier PREVIEW_UPDATED de un panel cambia la referencia
  // que el otro panel también lee, y ese PdfViewer se re-renderiza entero
  // sin necesidad (con paneles independientes cada uno pide sus propios
  // renders, ver §7). Un Map por kind evita el re-render cruzado.
  readonly previewByPage: Readonly<Record<ViewerKind, ReadonlyMap<number, string>>>;
  setPage(kind: ViewerKind, index: number): void;
  setZoom(z: number): void;
  setPreview(pageIndex: number, kind: ViewerKind, blobUrl: string): void;
  setVisibleRange(kind: ViewerKind, start: number, end: number): void;
  reset(): void;
}
```

**`currentPageIndex` se deriva de la geometría del scroll** (la página que ocupa el centro del viewport), **no** del mínimo del conjunto que reporta el `IntersectionObserver` (ADR-054 §5). El observador se queda decidiendo únicamente qué páginas montar, que es lo único para lo que es confiable: ahí `min..max` sobre un conjunto que puede quedar transitoriamente no contiguo es inofensivo (monta una página de más), mientras que usarlo para la página actual colapsaba el rango a `start: 0` y mandaba los dos visores al principio.

El flag de sincronización de scroll **no** vive acá: es una preferencia persistida, va en `settings.store` (§3.6).

### 3.6 `settings.store.ts`

```ts
interface SettingsSlice {
  readonly language: "es" | "en";
  readonly performancePreset: "auto" | "low" | "high";
  readonly defaultReplacementMode: ReplacementMode;
  readonly nerEnabled: boolean;
  readonly ocrLanguages: ReadonlyArray<string>;
  readonly scrollSyncEnabled: boolean;  // default false — ADR-054 §2
  persist(): void;   // guarda en localStorage (solo settings, nunca documentos)
  load(): void;
}
```

No todo lo de este slice alimenta `EngineConfig`: `language`, `defaultReplacementMode` y `scrollSyncEnabled` son preferencias de la app que `settingsToEngineConfig` no mapea (§3.7). `scrollSyncEnabled` vive acá —y no en `viewer.store`— porque es una preferencia de flujo de trabajo, no de documento: se recuerda entre sesiones, como el idioma (ADR-054 §2).

### 3.7 Mapeo settings → `EngineConfig` (ADR-036 §5, reescrito por ADR-038 §7)

| Setting | Destino | Regla |
|---|---|---|
| `nerEnabled` | `ner.enabled` | directo |
| `ocrLanguages` | `ocr.languages` | directo |
| `performancePreset` | `workerPool.*PoolSize` | `auto` = defaults de `05_Worker_Architecture.md` §1.1 (derivados de `hardwareConcurrency`; la serialización OCR/NER por `deviceMemory < 4` GB la aplica el Orchestrator solo); `low` = `{ pdf: 1, ocr: 1, ner: 1, render: 1 }`; `high` = `{ pdf: 4, ocr: 2, ner: 2, render: 4 }` |
| `language` | (UI-only) | i18n del cliente; el Core no lo conoce |
| `defaultReplacementMode` | (UI-only) | se materializa como regla global default vía `RULE_CREATED` |

> Sin documento abierto, el mapeo se aplica en el **bootstrap** (`initCore(overrides)`, PR16.5); con documento abierto, vía `reanalyze` — ambos casos abajo.

**Bootstrap: los settings persistidos se aplican al crear el core (PR16.5, ADR-048 §7 punto 2)**. La tabla de arriba rige en **dos** momentos, no solo con documento abierto. Al montar la app, el bootstrap carga los settings persistidos (`settings.store.load()`, que ya existe) y llama `initCore(overrides)` con el `EngineConfigOverrides` derivado de la tabla — `initCore` acepta overrides desde ADR-039. Reglas:

- `performancePreset: "auto"` ⇒ **se omite** la sección `workerPool` del override, para no pisar los defaults derivados de `hardwareConcurrency` (`05_Worker_Architecture.md` §1.1). `low`/`high` mandan los tamaños de la tabla.
- El override de `ner.wasmPaths` que `initCore` ya inyecta (ADR-039) **gana siempre**: los overrides del usuario se mergean por debajo, nunca lo sobreescriben.
- Sin este wiring —el estado hasta PR16.5— `nerEnabled: false` persistido antes de la primera importación no tenía **ningún** efecto observable: `App.tsx` llamaba `initCore()` sin argumentos una sola vez por carga de pestaña. Era la causa del Escenario 8 E2E bloqueado desde PR10 (`07_Performance_Strategy.md` §11.3).

**`nerEnabled` / `ocrLanguages` con documento abierto → `reanalyze`, no recrear el core** (ADR-038 §1, §7; reemplaza el flujo "recrear el core" de una versión previa de este doc, que descartaba las ediciones del usuario): el `SettingsDialog` muestra `ConfirmDialog` ("¿Reanalizar el documento con la nueva configuración? Tus ediciones se conservan.") → `actions.reanalyze({ ner: { enabled }, ocr: { languages } })` (patch con solo el/los campo/s que cambiaron) → `orchestrator.reanalyze(documentId, patch)`. Tras el `PIPELINE_READY` de la pasada, la UI re-emite `actions.requestRender(...)` para refrescar previews con los grupos nuevos, sobre la **unión** de los rangos visibles de los dos paneles (desde ADR-054 §1 el rango es por panel, y con scroll independiente eso son dos regiones distintas). Sin documento abierto, estos dos settings solo afectan al próximo `createCore`.

Sin documento abierto, `nerEnabled`/`ocrLanguages` se persisten y aplican al **próximo `createCore`** — que desde PR16.5 es un momento real (recarga de la pestaña), no una promesa vacía.

**`performancePreset` con documento abierto**: **no** dispara `reanalyze` (no afecta resultados de detección, solo tamaños de pool) — el cambio queda persistido (`settings.persist()`) y aplica recién al próximo documento (hint visible en el `SettingsDialog`); efecto inmediato exigiría redimensionar pools en caliente, fuera de alcance MVP (ADR-038 §7, Q3).

El escenario E2E 9 (`07_Performance_Strategy.md` §11.3: "activar NER en runtime → descarga modelo y reanaliza preservando las ediciones previas del usuario") se cumple con el flujo de `reanalyze`.

---

## 4. API pública del Core (consumida por el adapter)

El paquete `@anonly/anonymization-core` expone:

```ts
export interface IAnonymizationCore {
  readonly bus: IEventBus;
  readonly engines: {
    readonly pdf: PdfEngine;
    readonly ocr: OcrEngine;
    readonly regex: RegexEngine;
    readonly ner: NerEngine;
    readonly grouping: GroupingEngine;
    readonly render: RenderEngine;
    readonly export: ExportEngine;
  };
  readonly orchestrator: IPipelineOrchestrator;
  dispose(): Promise<void>;
}

export async function createCore(
  config?: Partial<EngineConfig>,
  runtime?: CoreRuntimeOptions   // factories de Workers reales (ADR-036 §2, Contracts.md §3.5)
): Promise<IAnonymizationCore>;
```

El adapter **solo** usa esta API. Nunca accede a `pdf.engine.ts` ni a internals. `snapshots.ts` usa `core.engines.grouping.getSnapshot(documentId)` (U-6) como **hidratación puntual** (p. ej. montar un panel tarde); la fuente reactiva son los eventos del bus.

---

## 5. Independencia del framework

Este contrato describe suscripciones al bus, mutaciones de store por eventos, acciones que emiten eventos, y snapshots. Cualquier framework con un store reactivo puede implementarlo:

- React: Zustand + hooks.
- Vue: Pinia + composables.
- Svelte: stores nativos.
- Solid: stores nativos.

El Core no cambia. Solo cambia `apps/<framework>-client/`.

---

## 6. Layout (recap de `00_Project_Vision.md` §8)

```
┌──────────────────────────────────────────────────────────┐
│  Toolbar (acciones globales, estado del pipeline, export) │
├──────────────────┬───────────────────────────────────────┤
│  Entidades       │            PDF original               │
│  ▶ Personas (3)  │   (con highlight de grupos activos)   │
│    ☑ Juan (14)   │                                       │
│    ☑ María (6)   │                                       │
│  ▶ DNI (3)       │                                       │
│    ☑ 34.567.891  ├───────────────────────────────────────┤
│  ▶ Direcciones   │          PDF anonimizado              │
│    ☑ Belgrano    │   (vista previa lado a lado)          │
├──────────────────┤                                       │
│  Reglas          │                                       │
│  (por grupo /    │                                       │
│   tipo / global) │                                       │
└──────────────────┴───────────────────────────────────────┘
```

Detalle en `ui/Components.md`.

---

## 7. Reglas de rendering

- El visor de PDF usa virtualización (ver `07_Performance_Strategy.md` §3). Solo se renderizan las páginas visibles + 1 antes + 1 después.
- El adapter emite `RENDER_REQUESTED` cuando cambia `visibleRange` o `zoom` (ADR-037, supersede ADR-036 §6). Al cambiar `zoom`, `ZoomControls` escala **por CSS/canvas el bitmap ya renderizado** de inmediato (feedback a 60 fps durante el gesto) y emite `actions.requestRender(visibleRange, "preview", previewScale × zoom)` tras `ZOOM_RERENDER_DEBOUNCE_MS = 150 ms` sin nuevos ticks; el `PREVIEW_UPDATED` resultante reemplaza el bitmap CSS por el nítido re-renderizado. Un cambio de escala en cola/en vuelo descarta/aborta el anterior de la misma página (supersede, ADR-037 §4).
- Los canvas reutilizables viven en el `PageVirtualizer` (componente), no en el store.
- La suscripción a `PREVIEW_UPDATED` actualiza `viewer.previewByPage` (por panel, §3.5) con el `blobUrl`. El componente lo pinta en el canvas reciclado.
- **Lado a lado con scroll independiente por panel (ADR-054, reemplaza "scroll vertical compartido vía `viewer.currentPageIndex`")**: cada `PdfViewer` scrollea por su cuenta, monta su propio rango y pide sus propios renders. Es lo que permite revisar la página 3 del anonimizado contra la 1 del original.
  - **Control opcional "sincronizar scroll"**, en la barra del visor junto a `ZoomControls` (no en el `Toolbar`, que son acciones sobre el documento, ni en el `SettingsDialog`, que es configuración de procesamiento). Default **apagado**; persistido en `localStorage` vía `settings.store` (§3.6).
  - Visible solo en anchos `≥ lg`. Por debajo, `SideBySideViewer` muestra pestañas y hay un solo panel visible: el control se **oculta**, pero la preferencia **no se toca** — al volver a ancho `≥ lg` reaparece con el valor que tenía y los paneles se realinean. Ocultarlo no es apagarlo.
  - Con el control prendido, la sincronización es **a nivel de píxel** (`scrollTop` contra `scrollTop`, geometría idéntica entre paneles), **nunca** por índice de página: alinear al seguidor al borde de una página mientras el líder está en un offset arbitrario es lo que producía el ping-pong. La convergencia sale de la **idempotencia** —al asignar el valor exacto, el evento de scroll del seguidor calcula un valor ya igual y no propaga nada—, así que **está prohibido cualquier diseño con bandera + temporizador** para ignorar los eventos del seguidor: no hay un valor correcto para ese timeout y reintroduce un bug dependiente de timing (ADR-054 §3). Los dos casos límite (seguidor que no puede llegar por recorte del navegador; panel oculto de alto cero) se resuelven por comparación de valor, no por ventana de tiempo (ADR-054 §4).
  - El estado de scroll compartido vive **fuera de React** (módulo imperativo): el evento `scroll` dispara a la frecuencia del monitor y escribirlo en el store re-renderizaría los dos paneles en cada cuadro. Al store solo llega la página actual, que cambia una vez por página.
  - Los contenedores con scroll **no** pueden llevar `scroll-behavior: smooth`: animaría la asignación de `scrollTop` y rompería la exactitud de la que depende la idempotencia.

---

## 8. Manejo de errores en la UI

Tabla reconciliada por ADR-036 §5 (la versión previa refería un evento inexistente y una llamada directa a motor prohibida):

| Señal | Acción UI |
|---|---|
| `PDF_PASSWORD_REQUIRED` (evento, canal `pdf`; la UI se suscribe **directo** — ADR-034 §4) | `PasswordDialog`; al submitear, `actions.retryWithPassword(password)` (**nunca** `engines.pdf.process` — Orchestrator.md §6) |
| `PDF_INVALID` (evento) | toast/mensaje: "El archivo no es un PDF válido" |
| `PIPELINE_FAILED` (evento) | banner con error tipado + botón "Reintentar" o "Cerrar documento" |
| `PIPELINE_FAILED` con `error.code === "NER_MODEL_MISSING"` | modal: el modelo NER no pudo cargarse (assets first-party, ADR-018 — no hay "descarga manual"); ofrecer "Desactivar NER y reanalizar" (flujo §3.7) o "Reintentar" |
| `OCR_PAGE_FAILED` (evento) | toast: "No se pudo procesar la página X con OCR. Las demás continúan." |
| (fallo de página NER) | **sin señal en MVP**: no existe evento `NER_PAGE_FAILED` (`04_Event_System.md` §5); el motor descarta las ocurrencias NER de esa página con `logger.warn` y continúa (`NER_Engine.md` §7). Si v1.0 quiere el toast, el evento se crea vía ADR (R-19) |
| `PREVIEW_PAGE_FAILED` (evento) | placeholder gris en la página afectada |
| `EXPORT_FAILED` (evento) | toast: "No se pudo exportar. Reintente." |
| `enabledGroups === 0` (pre-flight **local** del `ExportDialog`, calculado del store — no es un evento; el motor solo loguea warn, ADR-032 §3) | modal de confirmación: "No hay grupos habilitados. El export será idéntico al original. ¿Continuar?" |

---

## 9. Referencias

- `01_Technical_Architecture_Document.md` §3.1 (capas)
- `04_Event_System.md` §10 (eventos de UI)
- `ADR-005-State-Management.md`
- `ui/UX_Guidelines.md`
- `adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md` (workers §2.4, catálogo de acciones original §2.3)
- `adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` (zoom real §7)
- `adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` (`reanalyze` §2.3/§3.7)
- `ui/Components.md`
- `07_Performance_Strategy.md` §3 (virtualización)
- `core/Contracts.md` (tipos consumidos)
