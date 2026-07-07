<!-- CONTEXT: scope=ui-contract | dependencias=01_Technical_Architecture_Document.md,03_Data_Model.md,04_Event_System.md,ADR-005-State-Management.md | audiencia=IA-implementador-ui | fase=4 -->

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
  busBridge.subscribe(core.bus, core.stores);
  return core;
}

export function getCore(): IAnonymizationCore {
  if (!core) throw new Error("Core not initialized");
  return core;
}
```

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

  unsubs.push(bus.on(EventChannel.Export, EngineEvents.EXPORT_FINISHED, (p) => {
    stores.pipeline.setState({ exportResult: { blobUrl: p.blobUrl, sizeBytes: p.sizeBytes } });
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

  requestExport(options: ExportOptions): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId, options });
  },

  cancel(): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.Pipeline, EngineEvents.CANCEL_REQUESTED, { documentId });
  },

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
interface ViewerSlice {
  readonly currentPageIndex: number;
  readonly zoom: number;          // 0.5..3
  readonly sideBySide: boolean;   // default true
  readonly previewByPage: ReadonlyMap<number, { original?: string; anonymized?: string }>;
  readonly visibleRange: { start: number; end: number };
  setPage(index: number): void;
  setZoom(z: number): void;
  setPreview(pageIndex: number, kind: "original" | "anonymized", blobUrl: string): void;
  setVisibleRange(start: number, end: number): void;
  reset(): void;
}
```

### 3.6 `settings.store.ts`

```ts
interface SettingsSlice {
  readonly language: "es" | "en";
  readonly performancePreset: "auto" | "low" | "high";
  readonly defaultReplacementMode: ReplacementMode;
  readonly nerEnabled: boolean;
  readonly ocrLanguages: ReadonlyArray<string>;
  persist(): void;   // guarda en localStorage (solo settings, nunca documentos)
  load(): void;
}
```

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

export async function createCore(config: Partial<EngineConfig>): Promise<IAnonymizationCore>;
```

El adapter **solo** usa esta API. Nunca accede a `pdf.engine.ts` ni a internals.

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
- El adapter emite `RENDER_REQUESTED` cuando cambia `visibleRange` o `zoom`.
- Los canvas reutilizables viven en el `PageVirtualizer` (componente), no en el store.
- La suscripción a `PREVIEW_UPDATED` actualiza `viewer.previewByPage` con el `blobUrl`. El componente lo pinta en el canvas reciclado.
- Lado a lado sincronizado: scroll vertical compartido vía `viewer.currentPageIndex`.

---

## 8. Manejo de errores en la UI

| Evento | Acción UI |
|---|---|
| `PDF_PASSWORD_REQUIRED` | modal pidiendo password; al submittear, re-llama a `engines.pdf.process` con password |
| `PDF_INVALID` | toast/mensaje: "El archivo no es un PDF válido" |
| `PIPELINE_FAILED` | banner con error tipado + botón "Reintentar" o "Cerrar documento" |
| `OCR_PAGE_FAILED` | toast: "No se pudo procesar la página X con OCR. Las demás continúan." |
| `NER_PAGE_FAILED` | toast: "NER falló en la página X. Solo se aplicarán detecciones Regex." |
| `NER_MODEL_MISSING` | modal: "Falta el modelo NER. ¿Descargar (~60 MB) o desactivar NER?" |
| `PREVIEW_PAGE_FAILED` | placeholder gris en la página afectada |
| `EXPORT_FAILED` | toast: "No se pudo exportar. Reintente." |
| `EXPORT_NO_ENABLED_GROUPS` | modal de confirmación: "No hay grupos habilitados. El export será idéntico al original. ¿Continuar?" |

---

## 9. Referencias

- `01_Technical_Architecture_Document.md` §3.1 (capas)
- `04_Event_System.md` §10 (eventos de UI)
- `ADR-005-State-Management.md`
- `ui/UX_Guidelines.md`
- `ui/Components.md`
- `07_Performance_Strategy.md` §3 (virtualización)
- `core/Contracts.md` (tipos consumidos)
