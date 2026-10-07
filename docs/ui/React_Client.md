<!-- CONTEXT: scope=ui-contract | dependencias=adr/ADR-191-Lo-Que-Muestra-La-Vista-Previa-Es-Lo-Que-Se-Exporta.md,01_Technical_Architecture_Document.md,03_Data_Model.md,04_Event_System.md,ADR-005-State-Management.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-054-Scroll-Independiente-Por-Panel.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-056-RenderRequested-Kind-Por-Panel.md,adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md,adr/ADR-134-Cancelled-Es-Terminal.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md,adr/ADR-168-Pantallas-De-Carga-Y-Escaneo-Tras-Pruebas-De-Usuario.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-170-Las-Vistas-Previas-De-Edicion-Las-Calcula-El-Core.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,adr/ADR-174-Un-Agregado-Manual-Que-Choca-Se-Resuelve-En-El-Momento.md,adr/ADR-204-La-Interaccion-Anonimizada-Usa-La-Geometria-Visible.md,adr/ADR-205-El-Resultado-Exportado-Pertenece-A-Una-Revision.md,adr/ADR-206-Una-Busqueda-Omitida-No-Confirma-La-Version.md | audiencia=IA-implementador-ui | fase=4 (reconciliado en fase 10 por ADR-036: acciones completas §2.3, workers §2.4, settings §3.7, zoom §7, errores §8; §2.3/§3.7/§7 reescritos por ADR-037 —zoom con re-render real— y ADR-038 —reanalyze preservando ediciones, supersede el flujo "recrear el core"; §2.3/§7 en fase 11 por ADR-056 —requestRender con kind requerido, cada panel pide lo suyo—; §2.3 en fase 10.6 por ADR-069 §4 —`updateGroup.patch` gana `personGender?: PersonGenderChoice`, para el control de género del PR 12, que ADR-071 rebautiza `PersonGenderToggle` sin tocar este contrato—; post-Hito 10.10: §2.2 y §3.6b nuevas por ADR-062 —`degraded.store`, el séptimo slice: convierte el veredicto por página que trae `PREVIEW_UPDATED.degraded` en la marca por grupo del árbol, con sus tres reglas de consumo—; §3.5 pierde `sideBySide`, que estaba declarado sin setter ni consumidor desde PR7); §3.5/§3.6/§6 reescritos en el rediseño post-10.9 por **ADR-087** —un solo visor con toggle: `viewer.currentPageIndex`/`visibleRange` dejan de ser por `kind` y aparece `viewer.mode`; `settings.scrollSyncEnabled` se retira; el recap de layout pasa a los tres momentos—; §2.2 ignora carga NER tardía después de Cancelled por ADR-134 -->

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
│   ├── index.ts                     // inicializa el Core, expone la API
│   ├── bus-bridge.ts                // subscribe al bus, muta Zustand
│   ├── actions.ts                   // acciones de UI → eventos del bus
│   ├── settingsToEngineConfig.ts    // settings.store → EngineConfigOverrides (PR16.5)
│   └── snapshots.ts                 // lee snapshots del Grouping Engine
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
    if (p.documentId !== stores.document.getState().id) return;
    if (p.kind === "anonymized" && p.interactionGeometry !== undefined &&
        p.interactionGeometry.revision !==
          getCore().orchestrator.getPreviewInteractionRevision(p.documentId, p.pageIndex)) return;
    stores.viewer.setPreview(p.pageIndex, p.kind, p.canvasBlobUrl, p.interactionGeometry);
    // ADR-062 §3: SOLO el panel anonimizado trae veredicto. El original se
    // renderiza sin reemplazos, así que emite el array vacío por construcción
    // y borraría lo que el anonimizado había levantado.
    // ADR-062 §2 — ausente ≡ vacío: `?? []`, nunca un early-return. Tratar la
    // ausencia como "no sé" deja marcas viejas encendidas después de que el
    // usuario ya arregló el reemplazo.
    if (p.kind === "anonymized") {
      useDegradedStore.getState().setPageVerdict(p.pageIndex, p.degraded ?? []);
    }
  }));

  unsubs.push(bus.on(EventChannel.Ner, EngineEvents.NER_MODEL_LOADING, (p) => {
    // ADR-134: la carga puede avisar después de PIPELINE_CANCELLED. El texto
    // de carga tiene prioridad visual sobre el stage; Cancelled es terminal.
    if (stores.pipeline.getState().stage === PipelineStage.Cancelled) return;
    stores.pipeline.setState({ modelLoading: { modelId: p.modelId, progress: p.progress } });
  }));

  unsubs.push(bus.on(EventChannel.Export, EngineEvents.EXPORT_PROGRESS, (p) => {
    stores.pipeline.setState({ exportProgress: { current: p.current, total: p.total } });
  }));

  // EXPORT_FINISHED/EXPORT_FAILED limpian exportProgress (bug #7 del
  // Escenario 1 E2E, 2026-07-22): sin esto, PipelineStatus muestra el último
  // "Exportando página N de N…" para siempre tras terminar el export.
  unsubs.push(bus.on(EventChannel.Export, EngineEvents.EXPORT_FINISHED, (p) => {
    const pending = stores.pipeline.getState().exportingVersion;
    if (p.documentId !== stores.document.getState().id || pending === null) return;
    stores.pipeline.setState({
      exportResult: { blobUrl: p.blobUrl, sizeBytes: p.sizeBytes },
      exportProgress: null,
      exportedVersion: pending,
      exportingVersion: null,
    });
  }));

  // ... etc

  return () => unsubs.forEach((u) => u());
}
```

**Dos reglas del bridge que el código de arriba no muestra** (ronda E de la revisión de la branch):

1. **`CONFLICT_DETECTED` reemplaza por `id`** (ADR-191 §3). Grouping lo declara idempotente (`Grouping_Engine.md` §7) y lo reemite con el mismo `id` al restaurar un checkpoint (deshacer, rehacer) cuando un conflicto cambió. `entities.store.addConflict` **actualiza en el lugar** el conflicto con ese `id` y solo agrega si no existía: nunca deja dos conflictos con el mismo `id`. `resolveConflict` deja el conflicto `resolved: true` **sin** `heldManual` (ADR-175 §1). Si el store duplicara, la copia pendiente bloquearía el export (ADR-176) sin que el diálogo pudiera resolverla, porque `.find(id)` encuentra la resuelta.
2. **`PIPELINE_CANCELLED` de un reanálisis vuelve a `Ready`** (Orchestrator §13.22, ADR-038 §6). Cancelar una importación lleva a `Cancelled`, que es terminal (ADR-134). Cancelar un `reanalyze` no: el Core deja el documento en `Ready`, editable y exportable, y no emite `PIPELINE_READY` después. **El bridge distingue los dos casos por `pipeline.reanalyzeInFlight`** (§3.4), que `actions.reanalyze` enciende antes de llamar al Core y apaga en un `finally` cuando la promesa se asienta. No alcanza con saber si el documento ya llegó a `Ready`: el Core admite `reanalyze` también desde `Failed` (Orchestrator §6, ADR-040), así que un documento cuya importación falló en `OCRing` o `Detecting` puede re-analizarse y cancelarse sin haber pasado nunca por `Ready`, y el Core igual lo deja en `Ready`. Con `reanalyzeInFlight` encendido, `PIPELINE_CANCELLED` deja `stage: Ready`, limpia `modelLoading` y conserva `groupCount`/`conflictCount`; apagado, `stage: Cancelled` como siempre. Cuatro tests. En el bridge, tres: cancelar una importación, cancelar un reanálisis de un documento que llegó a `Ready`, y cancelar un reanálisis de un documento que había quedado en `Failed`. En `actions`, uno: `reanalyzeInFlight` está encendido mientras corre `orchestrator.reanalyze` y apagado cuando la promesa resuelve o rechaza; con el bridge real suscripto y un `PIPELINE_CANCELLED` emitido antes de que la promesa se asiente, la etapa termina en `Ready`. Ese test fija el orden del que depende la regla: el Core emite `PIPELINE_CANCELLED` antes de asentar la promesa de `reanalyze` (Orchestrator §13.22).

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

  updateGroup(groupId: string, patch: Partial<Pick<EntityGroup, "replacementMode" | "replacementValue" | "enabled" | "canonicalValue">> & { personGender?: PersonGenderChoice }): void {
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

  // ADR-172 §2: TODA acción de edición llama a stores.history.getState().record(label)
  // ANTES de emitir sus pedidos (un punto de restauración del estado previo). Una
  // acción del usuario = un record, aunque emita varios pedidos (mergePlan, el
  // barrido de un modo, eliminar = RULE_DELETED + GROUP_REMOVE_REQUESTED).

  // ADR-174: resolveConflict acepta { entityType?, winner? }; winner solo en
  // conflictos con heldManual (ManualOverlapDialog). addManualEntity devuelve
  // heldConflictIds: si no está vacío, el llamador abre el diálogo en vez del toast.

  // ADR-171 §5: si la fila tenía una Rule de scope group, se borra primero
  // (RULE_DELETED): una regla huérfana contaría en la franja "Todo el documento".
  // Los dos pasos entran en un mismo punto de deshacer (ADR-172).
  removeGroup(groupId: string): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    const groupRule = stores.rules.getState().rules.find((r) => r.scope === "group" && r.target.groupId === groupId);
    if (groupRule) getCore().bus.emit(EventChannel.UI, EngineEvents.RULE_DELETED, { documentId, ruleId: groupRule.id });
    getCore().bus.emit(EventChannel.UI, EngineEvents.GROUP_REMOVE_REQUESTED, { documentId, groupId });
  },

  createRule(rule: Rule): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RULE_CREATED, { documentId, rule });
  },

  // ADR-083 §1 (entityType) y ADR-174 §3 (winner). Errata 2026-09-24: el snippet
  // seguía con el `mode: ReplacementMode` anterior a ADR-083.
  resolveConflict(
    conflictId: string,
    choice: { readonly entityType?: EntityType; readonly winner?: "manual" | "detected" } = {},
  ): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, { documentId, conflictId, ...choice });
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

  // `kind` REQUERIDO (ADR-056 §1): identifica la vista que pide, y el motor
  // renderiza solo ese lado. Desde ADR-087 §2 hay un solo visor, así que el
  // `kind` es `viewer.mode` (la posición del ViewerModeToggle) — sigue siendo
  // UNA sola fuente de verdad sobre quién necesita píxeles, que es lo que
  // ADR-056 §2 protege.
  // `scale?` (ADR-037 §1, §5): ausente → previewScale/fullScale según mode;
  // ZoomControls la pasa como previewScale × zoom tras el debounce de 150 ms.
  requestRender(pageIndices: ReadonlyArray<number>, kind: ViewerKind, mode: "preview" | "full" = "preview", scale?: number): void {
    const documentId = stores.document.getState().id;
    if (!documentId) return;
    getCore().bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, { documentId, pageIndices, kind, mode, scale });
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

  requestExport(options: ExportOptions): boolean {
    const documentId = stores.document.getState().id;
    const pipeline = stores.pipeline.getState();
    if (!documentId || pipeline.exportingVersion !== null) return false;
    pipeline.setState({
      exportingVersion: pipeline.currentVersion,
      exportResult: null,
      exportProgress: null,
      error: null,
    });
    getCore().bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId, options });
    return true;
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
  /**
   * ADR-169 §2: orden de presentación de las filas. Solo UI: no cambia
   * `indexInType` ni emite nada. Vale para todos los tipos; no persiste.
   */
  readonly sortOrder: "appearance" | "alpha";
  setSortOrder(order: "appearance" | "alpha"): void;
  /** ADR-169 §7: grupo a resaltar un momento ("Ver en la lista" del toast). */
  readonly flashGroupId: string | null;
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
  readonly currentVersion: number;                    // ADR-205: inicialmente 0
  readonly exportedVersion: number | null;            // último éxito, inicialmente null
  readonly exportingVersion: number | null;           // capturada antes del pedido, inicialmente null
  readonly error: SerializedEngineError | null;
  /**
   * ADR-168 §4: la última etapa observada antes de `Failed`. `null` si no falló.
   * `Importing`/`Extracting` = fallo de importación → la UI cierra el documento
   * y vuelve a `LoadScreen` con el error en la `DropZone`.
   */
  readonly failedAtStage: PipelineStage | null;
  /** Etapas atravesadas por el pipeline en el documento vigente (para `ScanSteps`, ADR-168 §5). */
  readonly visitedStages: ReadonlySet<PipelineStage>;
  /**
   * Hay un `reanalyze` en curso: lo enciende `actions.reanalyze` antes de llamar
   * al Core y lo apaga en un `finally`. El bridge lo usa para que
   * `PIPELINE_CANCELLED` de un reanálisis deje `Ready` y no `Cancelled` (§2.2
   * regla 2, Orchestrator §13.22).
   */
  readonly reanalyzeInFlight: boolean;
  /** Jobs que fallaron sin tumbar el pipeline, por `WorkerJobType`. `{}` es el caso sano. */
  readonly failedJobs: Readonly<Partial<Record<WorkerJobType, number>>>;
  setState(patch: Partial<PipelineSlice>): void;
  reset(): void;
}
```

> **`failedJobs` (2026-08-28).** Un worker caído hace que el pool rechace su job, pero el pipeline **sigue** y llega a `Ready`: `WORKER_JOB_FAILED` no es `PIPELINE_FAILED`. Sin este campo la UI no tenía forma de distinguir "terminó" de "terminó a medias", y la toolbar mostraba **"Listo"** sobre un documento en el que no se detectó nada — medido sobre una pericia real, con los 11 jobs de `ner-page` caídos por `WORKER_CRASHED`. En una herramienta de privacidad ese modo de falla (silencioso, con cara de éxito) es el peor posible: el usuario exporta creyendo que anonimizó. El bridge lo llena desde el canal `workers` y desde `OCR_PAGE_FAILED`; `components/toolbar/incompleteAnalysisNotice.ts` lo traduce a un aviso, y se reinicia en cada `DOCUMENT_IMPORTED`.

### 3.5 `viewer.store.ts`

```ts
type ViewerKind = "original" | "anonymized";

interface ViewerSlice {
  // ADR-087 §2: hay UN solo visor con toggle, así que hay una sola página
  // actual y un solo rango visible. Deja de ser Record<ViewerKind, …>: el
  // reparto por panel de ADR-054 §1 existía porque los dos PdfViewer
  // scrolleaban independiente, y ya no hay dos.
  readonly currentPageIndex: number;
  readonly visibleRange: { start: number; end: number };
  readonly zoom: number;          // 0.5..3
  // ADR-087 §2: la posición del ViewerModeToggle. Determina el `kind` de
  // RENDER_REQUESTED (Components.md §5.2). "anonymized" es inalcanzable
  // mientras stage !== Ready (UX-3b).
  readonly mode: ViewerKind;
  setMode(mode: ViewerKind): void;
  // ADR-084 §1: la consulta del DocumentSearchBox. Sube al store para que
  // "Ver ocurrencias" (Components.md §3.5) pueda escribirla desde el panel de
  // entidades. NO es por panel: el buscador existe una sola vez, sobre el
  // `original`. El resto del estado del buscador sigue local.
  readonly searchQuery: string;
  setSearchQuery(query: string): void;
  // Por panel, no un Map compartido: si "original" y "anonymized" comparten
  // el mismo Map, cualquier PREVIEW_UPDATED de un panel cambia la referencia
  // que el otro panel también lee, y ese PdfViewer se re-renderiza entero
  // sin necesidad (con paneles independientes cada uno pide sus propios
  // renders, ver §7). Un Map por kind evita el re-render cruzado.
  readonly previewByPage: Readonly<Record<ViewerKind, ReadonlyMap<number, string>>>;
  readonly interactionGeometryByPage: ReadonlyMap<number, PreviewInteractionGeometry>;
  readonly interactionEpoch: number; // señal local de invalidación React, inicialmente 0
  setPage(index: number): void;
  setZoom(z: number): void;
  setPreview(pageIndex: number, kind: ViewerKind, blobUrl: string, geometry?: PreviewInteractionGeometry): void;
  setVisibleRange(start: number, end: number): void;
  reset(): void;
}
```

**`currentPageIndex` se deriva de la geometría del scroll** (la página que ocupa el centro del viewport), **no** del mínimo del conjunto que reporta el `IntersectionObserver` (ADR-054 §5, sigue vigente). El observador se queda decidiendo únicamente qué páginas montar, que es lo único para lo que es confiable: ahí `min..max` sobre un conjunto que puede quedar transitoriamente no contiguo es inofensivo (monta una página de más), mientras que usarlo para la página actual colapsaba el rango a `start: 0`.

**`previewByPage` sigue siendo por `kind`** aunque el visor sea uno solo: las dos vistas tienen imágenes distintas para la misma página, y conmutar el toggle tiene que poder mostrar la que ya está cacheada sin re-renderizar.

**El flag de sincronización de scroll se retira** (ADR-087 §2): con un solo panel no hay dos scrolls que sincronizar. `settings.scrollSyncEnabled` desaparece de §3.6.

### 3.6 `settings.store.ts`

```ts
interface SettingsSlice {
  readonly language: "es" | "en";
  // ADR-194 §1: cuatro niveles y `auto`, que se resuelve a uno de ellos.
  readonly performancePreset: "auto" | "low" | "medium" | "high" | "ultra";
  readonly defaultReplacementMode: ReplacementMode;
  readonly nerEnabled: boolean;
  readonly ocrLanguages: ReadonlyArray<string>;
  // `scrollSyncEnabled` retirado por ADR-087 §2: sin lado a lado no hay dos
  // scrolls que sincronizar.
  readonly theme: "system" | "light" | "dark";
  // ADR-195: una sola preferencia reemplaza a `autoUpdate` y `checkUpdates`.
  // `updateMode !== "off"` es lo que se le informa al shell (ADR-188 §2).
  readonly updateMode: "install" | "notify" | "off";
  /**
   * ADR-169 §7: avisos de descubrimiento que el usuario cerró
   * ("selection-hint" = tarjeta sobre el visor, "panel-footer-hint" = nota al
   * pie del panel). Persistido: cerrado una vez, no vuelve.
   */
  readonly dismissedHints: ReadonlyArray<"selection-hint" | "panel-footer-hint">;
  persist(): void;   // guarda en localStorage (solo settings, nunca documentos)
  load(): void;
}
```

No todo lo de este slice alimenta `EngineConfig`: `language` y `defaultReplacementMode` son preferencias de la app que `settingsToEngineConfig` no mapea (§3.7).

### 3.6c `history.store.ts` (ADR-172 §2)

```ts
interface HistoryEntry { readonly checkpointId: string; readonly label: string; }
interface HistorySlice {
  readonly past: ReadonlyArray<HistoryEntry>;     // se deshace el último
  readonly future: ReadonlyArray<HistoryEntry>;   // se rehace el último
  record(label: string): void;   // orchestrator.createEditCheckpoint ANTES de editar; vacía future
  undo(): Promise<void>;         // checkpoint del actual -> future; restore del último de past
  redo(): Promise<void>;         // simétrico
  clear(): void;                 // + orchestrator.discardEditCheckpoints
}
```

- **Qué entra**: habilitar/deshabilitar (fila y cascada), el modo en sus tres niveles, el género, editar
  el valor de reemplazo, "Restaurar valor calculado", cambiar tipo, fusionar, dividir, eliminar,
  agregar una entidad (tres vías) y resolver un conflicto. **No** entran orden, filtro, zoom, vista,
  Configuración ni exportar.
- **Después de `undo`/`redo`**: la UI rehidrata `rules.store` desde
  `grouping.getSnapshot(documentId).rules` (U-6). Grupos y conflictos llegan solos por los eventos.
- **Se vacía** (`clear`) al cerrar el documento, al importar otro y al re-analizar.
- **Atajos** (ADR-172 §3): un listener en `WorkLayout` —solo en ②b—: `Ctrl/Cmd+Z` → `undo`;
  `Ctrl/Cmd+Y` y `Ctrl/Cmd+Shift+Z` → `redo`. No actúa con el foco en `input`/`textarea`/
  `contenteditable`, con un diálogo abierto, durante una pasada de detección ni durante un export.
- **Toasts**: el "Deshacer" de todo toast de edición llama a `undo()`. Un solo toast de edición a la
  vez; una edición nueva lo reemplaza y un undo/redo por atajo lo cierra. **Toda edición que entra a
  la pila retira el toast de edición vigente, tenga o no toast propio** (decisión del humano,
  2026-09-30; `UX_Guidelines.md` §3.3b): el modo en la fila y el género no muestran toast, pero si
  dejaran el anterior a la vista, su "Deshacer" desharía la edición silenciosa y no la que nombra. El
  punto natural es `record()`: si registra una entrada, avisa al host de toasts que cierre el de
  edición. Ctrl+Z sigue deshaciendo en orden.
- **Reemplaza** al snapshot de reglas del toast de los barridos (`Components.md` §3.11) y a la
  restitución grupo por grupo de `components/entities/undoableEdits.ts`.

### 3.6b `degraded.store.ts` (ADR-062 §3)

> Numerado `3.6b` y no `3.7` a propósito: `§3.7` (el mapeo settings → `EngineConfig`) está citado por nombre desde `Components.md` y desde cuatro ADRs ya aceptados —ADR-036, ADR-038, ADR-048, ADR-081—, y correrlo dejaría veinte punteros muertos o obligaría a reescribir ADRs que no se reescriben. Es la misma convención de inserción que `Components.md` §3.4b/§5.4b y que PR16.5.

```ts
interface DegradedSlice {
  /** `pageIndex` → los `groupId` con algún reemplazo ilegible en esa página. */
  readonly byPage: ReadonlyMap<number, ReadonlySet<string>>;
  setPageVerdict(pageIndex: number, annotations: ReadonlyArray<Annotation>): void;
  reset(): void;
}
```

El veredicto de legibilidad llega **por página** (`PREVIEW_UPDATED.degraded`) y el árbol de entidades lo necesita **por grupo**. Este slice hace esa conversión y nada más; `selectGroupIsDegraded(state, groupId): boolean` y `selectDegradedPages(state, groupId): ReadonlyArray<number>` son sus dos lecturas.

Es un slice aparte y no un campo de `viewer.store` porque su ciclo de vida es otro: `viewer` guarda lo que el usuario está mirando, esto guarda un juicio del motor sobre lo que se va a exportar. `closeDocument` lo resetea — el veredicto es del documento abierto, y `08_Security_Model.md` §10.2 no lo dejaría persistir de todos modos.

**Tres reglas de ADR-062 §2/§3, las tres con test propio y las tres fáciles de romper**:

1. **Se reemplaza el veredicto de la página, no se acumula.** Cada evento trae el veredicto completo de esa página en ese render. Acumular deja encendida una marca que el usuario ya arregló, y le saca la única forma de saber si su corrección funcionó.
2. **Ausente ≡ vacío.** Las dos formas significan "esta página, ahora mismo, no tiene ningún reemplazo degradado". La ausencia nunca significa "no sé".
3. **Los eventos con `kind: "original"` se descartan** en el puente, antes de llegar acá.

Se guarda por página, y no como un `Set` plano de `groupId`, porque sin la clave de página no habría forma de reemplazar el veredicto de una sola sin perder el de las demás (regla 1).

> **Estabilidad de referencias**: `selectDegradedPages` construye un array nuevo por llamada, así que **no se usa directo dentro de `useDegradedStore(...)`** — zustand compara el snapshot con `Object.is` y eso deja la UI en un loop de render (es el bug que dejó la pantalla en blanco al cablear "Ver ocurrencias"). `DegradedBadge` subscribe a un string derivado y lo re-expande del lado del componente.

### 3.7 Mapeo settings → `EngineConfig` (ADR-036 §5, reescrito por ADR-038 §7)

| Setting | Destino | Regla |
|---|---|---|
| `nerEnabled` | `ner.enabled` | directo. **Ya no es un setting del usuario** (ADR-126): sin control en el formulario, `persist()` no lo escribe y ningún camino de producto lo apaga. `load()` lo lee si está presente, que es el canal de override de los E2E |
| `ocrLanguages` | `ocr.languages` | directo |
| `performancePreset` | `workerPool.*PoolSize`, `ocr.maxLiveImageBytes` | **ADR-194.** El override se deriva del **nivel**: `low` = `{ pdf: 1, ocr: 1, ner: 1, render: 1 }`; `medium` = `{ ocr: 2, ner: 2 }`; `high` = `{ ocr: 4, ner: 2 }` con `ocr.maxLiveImageBytes` de 136 MiB; `ultra` = `{ ocr: 6, ner: 2 }` con 200 MiB. Lo que un nivel no nombra queda en el default del Core (`05_Worker_Architecture.md` §1.1). `auto` **se resuelve a un nivel** con la regla de ADR-194 §3 (RAM instalada que informa el shell en `window.anonlyDevice.totalMemoryBytes`, y `navigator.hardwareConcurrency`) y manda el override de ese nivel |
| `language` | (UI-only) | i18n del cliente; el Core no lo conoce |
| `defaultReplacementMode` | (UI-only) | se materializa como regla global default vía `RULE_CREATED` |

> Sin documento abierto, el mapeo se aplica en el **bootstrap** (`initCore(overrides)`, PR16.5); con documento abierto, vía `reanalyze` — ambos casos abajo.

**Bootstrap: los settings persistidos se aplican al crear el core (PR16.5, ADR-048 §7 punto 2)**. La tabla de arriba rige en **dos** momentos, no solo con documento abierto. Al montar la app, el bootstrap carga los settings persistidos (`settings.store.load()`, que ya existe) y llama `initCore(overrides)` con el `EngineConfigOverrides` derivado de la tabla — `initCore` acepta overrides desde ADR-039. Reglas:

- `performancePreset: "auto"` ⇒ se resuelve a un nivel (ADR-194 §3) y manda el override de ese nivel. **Reemplaza** la regla anterior, que omitía la sección `workerPool`. La resolución es una función pura de las señales del equipo; el mismo resultado alimenta el texto de Configuración (`Components.md` §2.6). Sin `window.anonlyDevice` (fuera del shell), la regla cae en `low` o `medium`.
- **Migración (ADR-194 §5)**: `load()` lee `settingsVersion`; si falta o es menor que 2, un `performancePreset: "high"` guardado se carga como `"auto"`. Un valor desconocido se carga como `"auto"`. `persist()` escribe `settingsVersion: 2`.
- El override de `ner.wasmPaths` que `initCore` ya inyecta (ADR-039) **gana siempre**: los overrides del usuario se mergean por debajo, nunca lo sobreescriben.
- Sin este wiring —el estado hasta PR16.5— `nerEnabled: false` persistido antes de la primera importación no tenía **ningún** efecto observable: `App.tsx` llamaba `initCore()` sin argumentos una sola vez por carga de pestaña. Era la causa del Escenario 8 E2E bloqueado desde PR10 (`07_Performance_Strategy.md` §11.3).

**`ocrLanguages` con documento abierto → `reanalyze`, no recrear el core** (ADR-038 §1, §7; reemplaza el flujo "recrear el core" de una versión previa de este doc, que descartaba las ediciones del usuario): el `SettingsDialog` muestra `ConfirmDialog` ("¿Reanalizar el documento con la nueva configuración? Tus ediciones se conservan.") → `actions.reanalyze({ ner: { enabled }, ocr: { languages } })` (patch con solo el/los campo/s que cambiaron) → `orchestrator.reanalyze(documentId, patch)`. Tras el `PIPELINE_READY` de la pasada, la UI re-emite `actions.requestRender(..., "anonymized")` para refrescar previews con los grupos nuevos, sobre la **unión** de los rangos visibles de los dos paneles (desde ADR-054 §1 el rango es por panel, y con scroll independiente eso son dos regiones distintas). **Solo el `kind: "anonymized"`** (ADR-056 §3): el `original` no tiene reemplazos ni annotations, así que un reanalyze no puede cambiar sus píxeles — refrescarlo era trabajo garantizado-inútil. Sin documento abierto, estos dos settings **recrean el core al vuelo** (ADR-125 §2, que implementa lo que ADR-038 §7 ya había decidido: *"sin documento abierto, la UI recrea el core al vuelo — nada que perder"*): `disposeCore()` + `initCore(overrides)` con el override derivado de la misma tabla de arriba. Hace falta porque `initCore` es idempotente y corre **una sola vez por carga de la app**, así que persistir no alcanza — una configuración elegida en la pantalla de carga se guardaba y el análisis siguiente corría igual con la config de cuando cargó la página. Reglas:

- **Solo si el override derivado cambió** (`sameEngineConfigOverrides`): `language` es UI pura, no entra al `EngineConfig`, y cambiarlo no puede costar la recreación de cinco workers.
- **Con el diálogo todavía abierto** (ADR-125 §3): entre el `dispose` y el `init` no hay core y `getCore()` lanza. El modal es lo que garantiza que no haya dónde soltar un PDF en esa ventana; un fallo va al mensaje de error del propio diálogo.

Sin documento abierto, `nerEnabled`/`ocrLanguages` se persisten y aplican al **próximo `createCore`** — que desde PR16.5 es un momento real (recarga de la pestaña), no una promesa vacía.

**`performancePreset` con documento abierto**: **no** dispara `reanalyze` (no afecta resultados de detección, solo tamaños de pool) — el cambio queda persistido (`settings.persist()`) y aplica recién al próximo documento (hint visible en el `SettingsDialog`): al quedar la app sin documento, si el override derivado difiere del que tiene el Core vivo, el Core se recrea (ADR-194 §9; antes de ese ADR el cambio regía recién al reiniciar); efecto inmediato exigiría redimensionar pools en caliente, fuera de alcance MVP (ADR-038 §7, Q3).

El escenario E2E 9 (`07_Performance_Strategy.md` §11.3: "activar NER en runtime → descarga modelo y reanaliza preservando las ediciones previas del usuario") se cumple con el flujo de `reanalyze`.

**Canal de overrides del arnés de medición (ADR-155)**: además del override derivado de la tabla de arriba, `initCore` lee `localStorage["anonly:engine-overrides"]` y lo mergea **por encima**, sección por sección — necesario porque el único lever de tamaño de pool alcanzable desde los settings del usuario es `performancePreset`, bucketado (`low`/`high` mueven `pdfPoolSize`/`ocrPoolSize`/`nerPoolSize`/`renderPoolSize` los cuatro juntos), y H-10 necesita atribuir memoria pool por pool. No es un mapeo de settings: no hay fila en la tabla porque no es una preferencia del usuario.

- **No hay tipo nuevo**: el valor es un `EngineConfigOverrides` (ADR-039), el mismo que `createCore` ya acepta.
- **Solo bajo `import.meta.env.DEV || import.meta.env.VITE_E2E === "1"`** — la misma guarda que expone `__anonlyCore` (§4). En un build de producción el cuerpo se elimina y el canal no existe.
- **Se lee una sola vez, en el boot.** No hay setter ni suscripción — cambiarlo con la app corriendo no tiene efecto hasta el próximo `initCore`/`recreateCore`.
- **Falla cerrado y en silencio**: JSON inválido, algo que no sea un objeto plano, una clave fuera de `EngineConfig` en cualquier nivel, un valor de tipo equivocado, o un mapa incompleto (`timeouts`, `maxRetries` o `maxQueuePerPool` sin todos sus job types, porque el merge es por sección) descartan el valor **entero** (no se aplica parcialmente) y el boot sigue con los settings normales. Por ejemplo, `{ workerPool: { timeouts: { "ocr-page": 1000 } } }` se ignora completo. La validación es de tipos, no de rangos, y el Core tampoco valida rangos: un tamaño de pool 0 o negativo pasa y el pool no despacha nunca. El canal es una herramienta de medición; quien lo usa es responsable de los valores.
- **No es una preferencia**: no vive en `SettingsSlice`, la app nunca lo escribe, no tiene control de UI ni se muestra en ningún lado.

Documentado también en `tests/perf/README.md` — condición de la autorización, no un extra (`Post_Hito10.8_Pendientes.md` §30: la misma deuda que dejó `nerEnabled` vivo solo para los tests, acá escrita desde el principio en vez de encontrada después).

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

**Consultas de solo lectura del adapter** (todas en `IPipelineOrchestrator`, `Contracts.md` §3.5):
`findText`, `getPageWords`, `getPageSize` (ADR-061), **`previewEdit`** (ADR-170 §2) y los puntos de
restauración `createEditCheckpoint`/`restoreEditCheckpoint`/`discardEditCheckpoints` (ADR-172, usados
solo por `history.store`), que los
diálogos de Fusionar, Dividir y Cambiar tipo llaman al cambiar su selección (`actions.previewEdit`).
Las vistas previas del selector de modo no se piden: vienen en `EntityGroup.replacementPreviews`.

El adapter **solo** usa esta API. Nunca accede a `pdf.engine.ts` ni a internals. `snapshots.ts` usa `core.engines.grouping.getSnapshot(documentId)` (U-6) como **hidratación puntual** (p. ej. montar un panel tarde); la fuente reactiva son los eventos del bus.

---

### 4.1 Factory de orientación OCR (ADR-164, T-5)

El adapter importa `@anonly/ocr-engine/orientation-worker?worker` y entrega
`runtime.workers["ocr-orientation"]` junto con `ocr`. Mantiene ambos workers
fuera de UI y respeta el subpath público. Actualizar mocks/decls de Vite y tests
del adapter: la factory nueva existe y se inyecta; presets high/auto/low no se
modifican. No agregar settings, flags BEFORE/AFTER de producto ni una segunda
cuenta de páginas fallidas: OCR_PAGE_FAILED sigue siendo la fuente del aviso.

## 5. Independencia del framework

Este contrato describe suscripciones al bus, mutaciones de store por eventos, acciones que emiten eventos, y snapshots. Cualquier framework con un store reactivo puede implementarlo:

- React: Zustand + hooks.
- Vue: Pinia + composables.
- Svelte: stores nativos.
- Solid: stores nativos.

El Core no cambia. Solo cambia `apps/<framework>-client/`.

---

## 6. Layout (recap de `ui/UX_Guidelines.md` §2)

> **Reescrito por ADR-087 §1.** El recap anterior dibujaba el layout de cuatro paneles de
> `00_Project_Vision.md` §8 (Entidades + Reglas a la izquierda, original + anonimizado a la
> derecha). Ese layout se retira: ver `UX_Guidelines.md` §2 para el porqué.

```
① LoadScreen (document.id === null)      ②a ScanScreen        ②b Revisar
┌───────────────────────┐   ┌───────────────────────┐   ┌──────────────────┬──────────────────┐
│                       │   │  expediente.pdf       │   │ Toolbar · Exportar · ⚙              │
│      [ logo ]         │   │  Analizando 7 de 32   │   ├──────────────────┼──────────────────┤
│   Anonimizá PDFs…     │   │  ▓▓▓▓▓▓░░░░░░  22 %   │   │ Todo el doc  ▾   │ (Original|Anon.) │
│                       │   │                       │   ├──────────────────┤                  │
│  ┌─────────────────┐  │   │  12 entidades         │   │ ▾ DNI (12)   ▾   │   UN SOLO VISOR  │
│  │ Arrastrá un PDF │  │   │   Juan Pérez          │   │   ☑ 34.567.891   │   (todo el ancho)│
│  │   o [Examinar]  │  │   │   34.567.891      ⟳   │   │ ▾ Personas (3) ▾ │                  │
│  └─────────────────┘  │   │                       │   │   ☑ Juan Pérez   │                  │
│                       │   │        [Cancelar]     │   │                  │                  │
└───────────────────────┘   └───────────────────────┘   └──────────────────┴──────────────────┘
```

- **① y ②a no montan la barra lateral ni el visor**: no hay nada que mostrar todavía.
- **②b** monta el árbol (con la franja "Todo el documento" arriba, fuera de él) y **un** `PdfViewer`
  con el `ViewerModeToggle`.
- **③ Exportar** es un `Dialog`, no una región del layout.

Detalle en `ui/Components.md`; el porqué de cada decisión, en `ADR-087`.

---

## 7. Reglas de rendering

- El visor de PDF usa virtualización (ver `07_Performance_Strategy.md` §3). Solo se renderizan las páginas visibles + 1 antes + 1 después.
- El adapter emite `RENDER_REQUESTED` cuando cambia `visibleRange` o `zoom` (ADR-037, supersede ADR-036 §6). Al cambiar `zoom`, `ZoomControls` escala **por CSS/canvas el bitmap ya renderizado** de inmediato (feedback a 60 fps durante el gesto) y emite `actions.requestRender(visibleRange, kind, "preview", previewScale × zoom)` tras `ZOOM_RERENDER_DEBOUNCE_MS = 150 ms` sin nuevos ticks; el `PREVIEW_UPDATED` resultante reemplaza el bitmap CSS por el nítido re-renderizado. Un cambio de escala en cola/en vuelo descarta/aborta el anterior de la misma página (supersede, ADR-037 §4).
- **Se renderiza solo la vista que se está mirando (ADR-056 §1/§2, con un solo visor desde ADR-087 §2)**: los tres emisores de `PdfViewer` (render inicial al observar `Ready`, cambio de rango montado, re-render debounced de zoom) pasan `viewer.mode` como `kind`, y el motor renderiza únicamente ese lado. **Conmutar el toggle emite un `RENDER_REQUESTED` del nuevo `kind`** sobre el rango montado; si la página ya está en `previewByPage[kind]`, se pinta desde ahí sin esperar (§3.5).
  - **Precisión del 2026-10-07 (defecto encontrado, sin ADR: el texto de arriba ya lo exigía).** `PdfViewer` no tenía ese emisor: sus efectos se disparaban por `Ready`, por rango montado y por zoom, y ninguno por el cambio de `kind`. Con una imagen ya cacheada del otro lado, tampoco lo cubría el reintento de páginas sin imagen. Resultado: después de un zoom, al conmutar se veía la imagen vieja del otro lado estirada, hasta el próximo zoom o scroll. El emisor es el **cuarto** de `PdfViewer`: al cambiar `kind`, pide el rango montado del nuevo `kind` con `mode: "preview"` y **la escala del zoom vigente** (`computeZoomRenderScale(zoom)`), de inmediato y sin debounce. La imagen cacheada se sigue pintando al instante y el `PREVIEW_UPDATED` la reemplaza; si ya estaba a esa escala, el motor responde desde su caché. No se dispara en el montaje inicial (lo cubren los otros emisores) ni cuando no hay páginas montadas.
- **El `SettingsDialog` tras un `reanalyze` pide solo `kind: "anonymized"`** sobre el rango visible (ADR-056 §3; con un solo visor ya no hay dos rangos que unir): el `original` se renderiza sin `replacements` y —hasta que exista el highlight de entidades— sin `annotations`, así que un reanalyze no puede cambiar un solo píxel de ese lado. Cuando ese highlight exista, hay que volver a emitir también el pedido `original` (condición de validez escrita en ADR-056 §3).
- Los canvas reutilizables viven en el `PageVirtualizer` (componente), no en el store.
- La suscripción a `PREVIEW_UPDATED` actualiza `viewer.previewByPage` (por panel, §3.5) con el `blobUrl`. El componente lo pinta en el canvas reciclado. **El `blobUrl` cambia aunque los píxeles no**: el motor acuña un `URL.createObjectURL` nuevo también en aciertos de cache (ADR-056 §6, deliberado), así que `PageCanvas` no puede tratar "`blobUrl` nuevo" como "hay que reconstruir el canvas" — ver `Components.md` §5.4.
- **Un solo visor con toggle `Original | Anonimizado` (ADR-087 §2, retira el lado a lado y la sincronización de scroll)**: hay un `PdfViewer`, un `visibleRange` y un `currentPageIndex` (§3.5).
  - **Conmutar no mueve el documento**: página, scroll y zoom se conservan. La alternancia reemplaza a la comparación simultánea, y cualquier salto de posición la rompe.
  - **El toggle "Anonimizado" está deshabilitado mientras `stage !== Ready`**: antes de eso los `replacements` no existen y el render sale idéntico al original (`core/Render_Engine.md` §13 caso 1). Mostrarlo bajo ese rótulo es el defecto que ADR-087 Contexto §3 documenta.
  - **Retirados**: `SideBySideViewer`, `ScrollSyncToggle`, `scrollSyncController` y `settings.scrollSyncEnabled`. Todo el mecanismo de sincronización a nivel de píxel de ADR-054 §3/§4 queda sin caso de uso — no invalidado: con un panel el problema que resolvía deja de existir.
  - Los contenedores con scroll **siguen sin poder** llevar `scroll-behavior: smooth`: animaría la asignación de `scrollTop` y pelearía con la restauración de posición al conmutar.

---

## 8. Manejo de errores en la UI

Tabla reconciliada por ADR-036 §5 (la versión previa refería un evento inexistente y una llamada directa a motor prohibida):

| Señal | Acción UI |
|---|---|
| `PDF_PASSWORD_REQUIRED` (evento, canal `pdf`; la UI se suscribe **directo** — ADR-034 §4) | `PasswordDialog`; al submitear, `actions.retryWithPassword(password)` (**nunca** `engines.pdf.process` — Orchestrator.md §6) |
| `PDF_INVALID` (evento) | toast/mensaje: "El archivo no es un PDF válido" |
| `PIPELINE_FAILED` (evento) | banner con error tipado + botón "Reintentar" o "Cerrar documento" |
| `PIPELINE_FAILED` con `error.code === "WORKER_CRASHED"` | mensaje propio en `MESSAGE_BY_CODE` (`pipelineErrorPresentation.ts`): "Se interrumpió uno de los procesos que analizan el documento. Recargá la página y probá de nuevo." Sin esa fila, el `?? error.message` filtraba el string interno del pool a la pantalla ("WorkerPool(render): worker (slot 0) emitió un error de transporte."), contra ADR-087 §4 |
| `PIPELINE_FAILED` con `error.code === "NER_MODEL_MISSING"` | banner: el modelo no pudo cargarse (assets first-party, ADR-018 — no hay "descarga manual"). **Única salida: reintentar** (recargar), más "Cerrar documento". ADR-126 §2 retiró "Desactivar NER y reanalizar": continuar sin el detector de nombres entrega un documento que se exporta como anonimizado con todos los nombres intactos |
| `OCR_PAGE_FAILED` (evento, canal `ocr`) | suma 1 a `pipeline.failedJobs["ocr-page"]`. **No es un toast por página**: un escaneo cuyo OCR falla entero produciría 20 toasts encadenados diciendo lo mismo. Se agrega al aviso único de fin de análisis (fila de abajo). Hasta 2026-08-28 este evento **no estaba suscrito a ningún store** —gap anotado desde el PR5 del Hito 10— y un escaneo sin texto llegaba a "Listo" sin que nada lo dijera |
| `WORKER_JOB_FAILED` (evento, canal `workers`) | suma 1 a `pipeline.failedJobs[type]`, atribuyendo por el `type` del `WORKER_JOB_DISPATCHED` del mismo `jobId` (el payload del fallo no lo trae). Un fallo sin despacho previo **no se cuenta**: inventarle un motor sería peor que perderlo |
| Pipeline en `Ready`/`Done` con `failedJobs` no vacío | banner **warning** (no error: el pipeline sí terminó) con el aviso de `incompleteAnalysisNotice.ts` + botón "Recargar". Distingue lo que compromete la detección (`ner-page`, `ocr-page` → "puede haber datos sensibles sin detectar") de lo cosmético (`render-page` → "la detección no se vio afectada"), porque para esta herramienta no son el mismo problema |
| (fallo de página NER) | **sin señal en MVP**: no existe evento `NER_PAGE_FAILED` (`04_Event_System.md` §5); el motor descarta las ocurrencias NER de esa página con `logger.warn` y continúa (`NER_Engine.md` §7). Si v1.0 quiere el toast, el evento se crea vía ADR (R-19) |
| `PREVIEW_PAGE_FAILED` (evento) | aviso **en la página afectada** (`PageCanvas`): "No se pudo mostrar esta página" + "El documento no cambió: es la vista previa la que falló". Se guarda en `viewer.failedPages` (sin `kind`: el payload no lo trae) y esa página **deja de reintentarse** (`previewRetry.ts`). Un placeholder gris a secas no servía: es idéntico al de una página que todavía no renderizó |
| `EXPORT_FAILED` (evento) | toast: "No se pudo exportar. Reintente." |
| `enabledGroups === 0` (pre-flight **local** del `ExportDialog`, calculado del store — no es un evento; el motor solo loguea warn, ADR-032 §3) | modal de confirmación: "No hay grupos habilitados. El export será idéntico al original. ¿Continuar?" |

---

## Enmienda normativa ADR-204/205 — interacción y vigencia del export

Esta enmienda amplía §2.2, §2.3, §3.4, §3.5 y §7; prevalece sobre cualquier
restricción anterior que limite la selección o el resaltado a original.

### Preview e interacción (ADR-204)

`viewer.store` conserva `interactionGeometryByPage`, un mapa por página del
anonimizado con `PreviewInteractionGeometry`. `setPreview` recibe el mapa
opcional del mismo evento y actualiza URL y mapa en una sola escritura. Un
evento sin mapa elimina el mapa anterior de esa página. Reset lo vacía.
El bridge descarta eventos de documentos inactivos y mapas de revisión
obsoleta comparándolos con el getter del façade. Si el evento trae un mapa
obsoleto, descartar el evento completo: no reemplazar un raster más nuevo
por ese raster tardío ni borrar su mapa vigente. Un evento realmente sin
mapa puede mostrar raster sin interacción. No revoca URLs del Core.

`actions.getPreviewInteractionRevision(pageIndex): number | null` delega el
documento activo al getter público. No duplicar una revisión Core en un
contador React. `interactionEpoch` solo dispara refresco/limpieza de selección
ante invalidación del mapa; no identifica contenido ni sustituye la revisión
del façade. Reset la devuelve a 0. Los cambios de grupos/palabras y el comienzo de reanálisis
limpian las selecciones afectadas y disparan actualización del visor; mientras
el mapa no coincida con la revisión actual, no hay interacción anonimizada.
Las cajas están en puntos; el zoom CSS inmediato transforma raster y overlay
juntos. La escala del mapa identifica el raster del mismo evento, no exige
convertir otra vez sus cajas a píxeles. Respetar el guard de escala del motor.

La UI proyecta `Page.words` a cajas visibles por `sourceBbox`, derivando la
cobertura con `coveredRegions`. No muta palabras, no guarda un boolean
persistente, no mide fuentes ni calcula repintado. Los helpers de búsqueda
y selección comparten esta proyección. En búsqueda, usar `TextMatch.wordSpan`
para reunir cajas transformadas y zonas cubiertas; no unir todo en una caja
que resalte texto intermedio de otros renglones.

### Contador local de export (ADR-205)

`pipeline.store` incorpora `currentVersion: number` (0),
`exportedVersion: number | null` (null) y
`exportingVersion: number | null` (null), con una operación atómica para
incrementar el contador y otra para iniciar una solicitud si no hay otra.
Todas se resetean al importar/cerrar documento. No requiere eventos nuevos.

Observar cambios efectivos del documento activo en el bridge:
`ENTITY_GROUP_CREATED`, `ENTITY_GROUP_UPDATED`, `ENTITY_GROUP_REMOVED`,
`GROUP_REPLACEMENT_CHANGED` y `CONFLICT_RESOLVED`.
`GROUP_TOGGLED` cubre la habilitación por su evento existente, y
`CONFLICT_DETECTED` puede invalidar conservadoramente al crear un choque.
No-op obvio (grupo ausente,
patch sin cambios o actualización idéntica) no invalida por sí solo; no se
requiere igualdad profunda ni hashing del documento. Reglas se observan en
`createRule/updateRule/deleteRule`, incluido el borrado implícito de regla
group. `history` incrementa tras una restauración exitosa, aunque haya vuelto
al mismo contenido. Un reanálisis efectivo invalida al comenzar, pues puede
dejar cambios parciales si termina cancelado/fallido; detectar patch vacío o
idéntico con config vigente cuando está disponible. Sus eventos también
pueden incrementar. No importa cuántos incrementos tiene una acción compuesta.
Si la acción detecta el comienzo efectivo por `PIPELINE_STAGE_CHANGED`,
invalidar en esa primera transición, antes de esperar su promesa; no posponer
el incremento hasta `finally`. Limpiar también la selección/geometría de
interacción al comenzar ese reanálisis efectivo. Un cambio de documento
durante la espera no invalida el documento nuevo.

`actions.requestExport` captura `exportingVersion = currentVersion` antes
de emitir `EXPORT_REQUESTED`; impide solicitudes duplicadas.
Devuelve `boolean`: `true` si emitió una nueva solicitud, `false` si
no hay documento activo o ya hay una pendiente; el diálogo solo pasa a
`submitted` cuando se acepta. Es un resultado local del adapter, sin ampliar
el evento ni la interfaz de export del Core. Limpia resultado,
progreso y error anteriores conservando `exportedVersion`. Éxito correlacionado
del documento activo guarda resultado y `exportedVersion = exportingVersion`
y limpia `exportingVersion`. Fallo/cancelación/fallo de pipeline durante export
limpia la solicitud pendiente, sin cambiar `exportedVersion`. Ignorar éxitos
de otro documento o sin solicitud local pendiente. Una edición durante la
generación sigue pendiente. No poner el contador a 0 con el éxito.

Un resultado se reabre solo si existe y `currentVersion === exportedVersion`.
Si difieren, ExportDialog abre formulario normal con el aviso especificado
en Components bajo el nombre. Si `exportedVersion === null`, no hay aviso.
Zoom, lupa, navegación, selección y orden de lista no cambian el contador.
Ningún componente revoca blobs cuya propiedad es del Core.

Verificar bridge/actions/history y ciclo Electron: reabrir sin editar,
editar/reexportar, error y reintento, edición durante generación, cancelación,
reanálisis, undo/redo y cierre/cambio de documento con resultados tardíos.

### Búsqueda manual de actualizaciones — ADR-206

El estado local del diálogo es `idle | checking | up-to-date | unavailable`.
Al buscar pasa a checking y limpia el aviso anterior. Solo
`update-not-available` recibido durante checking confirma up-to-date.
`check-unavailable` recibido durante checking pasa a unavailable y muestra
el aviso secundario de Components; recibido durante idle no muestra nada.
`error`, `update-available` y `update-downloaded` conservan la limpieza
existente. Cerrar/reabrir el diálogo limpia el estado y la suscripción local.
El evento nuevo usa el mismo `UpdateEvent`/IPC con tipo string y sin campos
adicionales; ningún slice ni contrato del Core cambia.

La selección con inicio en blanco y la salida animada de ToastHost siguen
las enmiendas de Components y ADR-204. La vida visual de un aviso saliente
puede durar 260 ms después del dismiss lógico; no retener un segundo aviso
ni permitir que el cierre saliente afecte una instancia nueva.

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
