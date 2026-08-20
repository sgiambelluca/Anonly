<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Orchestrator.md,core/Grouping_Engine.md,core/NER_Engine.md,core/Regex_Engine.md,core/PDF_Engine.md,core/OCR_Engine.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/06_Pipeline.md,architecture/07_Performance_Strategy.md,ui/React_Client.md,ui/Components.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md | audiencia=humanos+IA | fase=10 -->

# ADR-038 — Re-análisis parcial preservando ediciones: `reanalyze`, sesión de Grouping reabrible y dedup por identidad

- **Estado**: Accepted (precondición de stage de `reanalyze` amendada por ADR-040: acepta también `Done`, `stage ∈ {Ready, Done, Failed}`)
- **Fecha**: 2026-07-17
- **Decidido por**: El humano, al revisar ADR-036: aprobó la auditoría pero **rechazó la decisión "cambiar settings de Core en runtime = recrear el core" de §5** ("hay que preservar ediciones" — no alcanza con recrear el core y reimportar). Este ADR diseña la alternativa completa y **supersede ese bloque de ADR-036 §5** (el resto de §5 — acciones del adapter, erratas, mapeo de settings — sigue vigente).
- **Relacionado con**: ADR-011 (Grouping first), ADR-014 (fusión OCR→PDF mediada), ADR-020 §6 (guard de `fuseOcrPage`), ADR-023/ADR-024 (NER config/modelo), ADR-028 (renumeración canónica de `indexInType`), ADR-029 (`maskFormat`), ADR-034 §2 (sesión de Grouping, wiring NER-off), ADR-035 §3 (semántica de `retryable`), ADR-036 §5 (superseded parcial), §8 (orden de PRs — reemplazado por §8 de este ADR), ADR-037 (par de este ADR en la misma revisión del humano)

## Contexto

ADR-036 §5 resolvió el escenario E2E 9 ("activar NER en runtime → reanaliza", `07_Performance_Strategy.md` §11.3) con el flujo `closeDocument` + `dispose()` + `createCore(nuevaConfig)` + re-`importDocument`. Ese flujo **descarta todo el trabajo del usuario**: grupos fusionados/divididos, reglas creadas/editadas/borradas, grupos deshabilitados, valores canónicos editados, conflictos resueltos a mano. El humano lo rechazó explícitamente.

Auditoría de lo que **ya existe** y se puede reusar tal cual:

1. **La sesión de Grouping ya es el repositorio de las ediciones**: grupos con `enabled`/`replacementMode`/`canonicalValue` editados, `rules`, `conflicts`, y el registro interno de ocurrencias (`recordedOccurrences` con `groupId` por ocurrencia — `grouping.engine.ts`). El caso límite 17 del spec ya garantiza "gana el usuario" cuando llega un `ENTITY_FOUND` nuevo a un grupo editado.
2. **El matching por valor es el mecanismo natural de preservación**: un valor re-detectado se agrupa por `normalizedValue`/fuzzy en el grupo existente — hereda automáticamente las ediciones del grupo. No hace falta "re-aplicar" ediciones: nunca se pierden si la sesión no se destruye.
3. **El mecanismo de conflictos ya modela "detectores que se pisan"**: `overlap`/`disagree` con resolución default (mayor `confidence`, empate Regex) y override manual vía `CONFLICT_RESOLVE_REQUESTED`/`ConflictDialog` (`06_Pipeline.md` §9, `Components.md` §6). Una segunda pasada de NER que se solapa con lo existente es exactamente ese caso — reusable sin cambios.
4. **NER no necesita cambios**: `init` no carga el modelo; `processPage` lee `ctx.config.ner.enabled` **por llamada** y carga lazy (`ner.engine.ts`, caso límite 11 del spec). Basta pasarle un `EngineContext` con la config nueva. `RegexEngine.process` es invocación pura por documento. `OcrEngine.processPages` acepta subconjuntos de páginas.
5. **`fuseOcrPage` ya es re-ejecutable**: sobre una página `requiresOCR === true` **reemplaza** las `Word[]` completas (el guard de ADR-020 §6 solo excluye páginas con texto nativo; verificado en `pdf.engine.ts`). Re-OCR con otros idiomas = re-fusión idempotente, sin cambios de PDF Engine.
6. **El Orchestrator retiene todo lo necesario**: el `Document` fusionado, el buffer original, y el documento cargado en Render (`orchestrator.ts`: `documents`, `retainedInputs`, `renderLoadedDocuments`).

Los **gaps reales** son cuatro, y todos son de orquestación/sesión, no de detección:

- (a) la sesión de Grouping no es **reabrible**: `finished` es terminal hasta `closeSession`, y el auto-finish (flags `regexFinished`/`nerFinished`) no contempla una segunda pasada;
- (b) una segunda pasada re-emitiría cada ocurrencia ya agrupada (UUIDs nuevos) y **duplicaría members** — falta idempotencia real de `ENTITY_FOUND`;
- (c) no existe API del Orchestrator para re-entrar al pipeline en las etapas 2/4/5 sobre un documento ya cargado;
- (d) no hay forma de **quitar** ocurrencias que dejaron de ser válidas (las NER al desactivar NER; las de páginas re-OCR cuyo texto cambió).

## Decisión

### 1. `IPipelineOrchestrator.reanalyze(documentId, patch)` — método directo, patch estrecho

```ts
// Contracts.md §3.5 / Orchestrator.md §6 (ADR-038). Cubre exactamente los dos
// settings de UI que afectan detección (React_Client.md §3.6/§3.7). Ampliar el
// patch (p. ej. otros campos de NerConfig) requiere ADR nuevo.
export interface ReanalyzeConfigPatch {
  readonly ner?: { readonly enabled: boolean };
  readonly ocr?: { readonly languages: ReadonlyArray<string> };
}

export interface IPipelineOrchestrator {
  // ... firmas existentes ...
  reanalyze(documentId: string, patch: ReanalyzeConfigPatch): Promise<void>;
}
```

- **Método directo, no evento nuevo**: mismo precedente que `importDocument`/`retryWithPassword` (operaciones de pipeline con `Promise` que resuelve al volver a `Ready`/`Failed`/`Cancelled`). Un evento `REANALYZE_REQUESTED` tocaría enum + payload + `EventPayloadMap` + `04` §10 + matriz §11 sin ganancia.
- **Config efectiva**: el Orchestrator mantiene una `EngineConfig` efectiva por instancia (inicial = merge de `createCore`); `reanalyze` la actualiza mergeando el patch, y los `EngineContext` posteriores (incluidos los de etapas del re-análisis) la usan. Los campos **no** cubiertos por `ReanalyzeConfigPatch` siguen fijos de por vida del core (la inmutabilidad de `EngineConfig` de `Contracts.md` §3.1 se relaja únicamente por esta vía).
- **Precondiciones**: documento existente y `stage ∈ {Ready, Failed}`; si no, `InvalidInputError` (esto además hace que un segundo `reanalyze` concurrente rechace solo: el stage ya no es `Ready`). Patch vacío o con campos no soportados → `InvalidInputError`. Patch idéntico a la config efectiva → **no-op** (resuelve sin emitir eventos).

### 2. Grouping: sesión reabrible (`reopenSession`) y eliminación selectiva (`dropOccurrences`)

```ts
// Grouping_Engine.md §6 (ADR-038)
export interface ReopenSessionOptions {
  readonly expectRegex: boolean;  // la pasada re-correrá Regex (esperar REGEX_FINISHED)
  readonly expectNer: boolean;    // la pasada re-correrá NER (esperar NER_FINISHED)
}

export interface DropOccurrencesFilter {
  readonly source?: DetectionSource;
  readonly pageIndices?: ReadonlyArray<number>;
  // Al menos un campo; ambos = AND.
}

export class GroupingEngine implements IEngine {
  // ... firmas existentes ...
  reopenSession(documentId: string, options: ReopenSessionOptions): void;
  dropOccurrences(documentId: string, filter: DropOccurrencesFilter): void;
}
```

- **`reopenSession`**: sobre la sesión existente (grupos, reglas, conflictos y ediciones **intactos**) setea `finished = false`, `regexFinished = !expectRegex`, `nerFinished = !expectNer`. El auto-finish existente (ADR-034 §2) vuelve a operar: con `expectNer: true` y `expectRegex: false`, el `NER_FINISHED` de la pasada dispara solo el cierre. Defensivo como `finishSession`: sesión inexistente → `warn` + no-op. Es válido invocarlo sobre una sesión **no finalizada** (recuperación desde `Failed` a mitad de detección): mismo efecto sobre los flags.
- **`dropOccurrences`**: elimina del registro de sesión las ocurrencias que matchean el filtro y sus `members` de los grupos. Por cada grupo afectado: recalcula `aliases`/frecuencias/`canonicalValue` (salvo `canonicalValue` con edición manual — caso 18 del spec — que se conserva) y `replacementValue` si depende de members (`maskFormat` mayoritario, ADR-029); emite `ENTITY_GROUP_UPDATED` (+ `GROUP_REPLACEMENT_CHANGED` si cambió el reemplazo). Grupo que queda **sin members** → se elimina con `ENTITY_GROUP_REMOVED` (invariante `members.length ≥ 1`, `03` §9 — un grupo sin ocurrencias no tiene nada que anonimizar, aunque tuviera ediciones). Conflictos cuyo grupo se eliminó → se descartan emitiendo `CONFLICT_RESOLVED` con `mode` = modo efectivo del grupo antes de la eliminación (no hay evento `CONFLICT_REMOVED` y no se crea uno). **No renumera** `indexInType` (eso ocurre en el próximo `finishSession`; los huecos temporales son la semántica ya establecida de "el índice se saltea"). Filtro sin campos → `InvalidInputError`; sesión inexistente → `warn` + no-op.

> **Errata (2026-08-19)**: la redacción original decía "conflictos cuyos candidates referencian ocurrencias eliminadas **o** cuyo grupo se eliminó". La primera mitad es **estructuralmente imposible** con el contrato vigente —`ConflictCandidate` no tiene `occurrenceId` ni `bbox`, así que un candidato no es rastreable hasta la ocurrencia que lo originó— y describía un comportamiento que el motor nunca tuvo. Se acota a lo que sí es implementable (el conflicto del grupo eliminado); el conflicto stale que queda cuando el grupo sobrevive es ruido de UI inofensivo, documentado en `Grouping_Engine.md` §13 caso 25.
- **`finishSession` re-ejecutable**: tras un `reopenSession`, el próximo `finishSession` (auto o directo) vuelve a correr la **renumeración canónica sobre la unión** de ocurrencias y emite `GROUPING_FINISHED` de nuevo. El invariante de ADR-028 se **extiende**: mismo conjunto final de `Occurrence` ⇒ mismos índices finales, sin importar en cuántas pasadas llegaron — el estado final es indistinguible de una corrida fresca con la config final, **más** las ediciones del usuario. Como en el caso 21 del spec: las ediciones se preservan; solo puede cambiar el número (y los placeholders se recalculan con sus eventos).

### 3. Dedup por identidad — invariante permanente de la sesión

Una `Occurrence` entrante cuya **identidad** `(entityType, pageIndex, bbox, normalizedValue)` ya está registrada en la sesión se **descarta en silencio** (`logger.debug`, sin eventos, sin tocar frecuencias). No es un modo especial de las sesiones reabiertas: es un invariante **siempre activo**, que convierte en real la idempotencia que `04_Event_System.md` §5 ya declaraba para `ENTITY_FOUND` (los UUID de ocurrencia son nuevos por pasada, así que la identidad estable es el cuarteto, no el `id`). La igualdad de `bbox` es estricta: los detectores son deterministas sobre el mismo texto, y cuando el texto cambió (re-OCR) las ocurrencias de esas páginas se dropean **antes** de re-detectar — no existen "casi iguales".

Consecuencia clave: una re-pasada de Regex sobre el documento completo es **inocua** en las páginas no afectadas (todo duplicado se descarta), lo que permite reusar `RegexEngine.process(document)` tal cual, sin API por-páginas nueva.

### 4. Política de conflicto de la segunda pasada: se reusa la existente

- Ocurrencia nueva que **matchea por valor** un grupo existente (editado o no): se agrega como member; las ediciones del grupo no se tocan (caso 17: `enabled`, `replacementMode`, `canonicalValue` manual). Un grupo **deshabilitado no se re-habilita** porque lleguen members nuevos.
- Ocurrencia nueva que **se solapa** (bbox) con una existente de otro tipo: `CONFLICT_DETECTED` `overlap`/`disagree` con la resolución default de `06_Pipeline.md` §9 (gana mayor `confidence`; empate → Regex) y override manual vía `ConflictDialog` — **exactamente** el mecanismo Regex-vs-NER de una pasada única; no se crea concepto nuevo.
- Hueco cerrado con regla determinista nueva (aplica también dentro de una pasada única — era una laguna preexistente): si un alias matchea en **más de un grupo** del mismo tipo (solo posible tras un split manual), gana el grupo de menor `createdAt`; empate → menor `indexInType`. El usuario puede re-dividir.
- Ocurrencia idéntica a una que el usuario movió por split: la descarta el dedup (§3) — la adjudicación manual **persiste** porque la identidad se chequea contra el registro de sesión completo, no contra el grupo "original".

### 5. Flujos por patch (transiciones nuevas de `PipelineStage`)

Transiciones nuevas de la máquina de estados: `Ready → OCRing | Detecting | Grouping` y `Failed → Detecting | Grouping` (documentadas en `Orchestrator.md` y `06_Pipeline.md` §16). Todos los flujos reusan `PIPELINE_STAGE_CHANGED`/`PIPELINE_PROGRESS`/`PIPELINE_READY`/`PIPELINE_FAILED`/`PIPELINE_CANCELLED` y `GROUPING_FINISHED`: **cero eventos nuevos** (las notas de `04` §2/§6 aclaran que `PIPELINE_READY` y `GROUPING_FINISHED` pueden emitirse más de una vez por documento — una por pasada de análisis).

1. **`ner.enabled: false → true`**: stage → `Detecting`; `grouping.reopenSession(docId, { expectRegex: false, expectNer: true })`; NER (`processPages`) sobre las páginas con texto del `Document` retenido, con la config efectiva nueva (el motor carga el modelo lazy — `NER_STARTED`/`NER_MODEL_LOADING` fluyen como siempre); `NER_FINISHED` → auto-finish → renumeración → `GROUPING_FINISHED` → `PIPELINE_READY`. **Regex no se re-corre**: el texto no cambió y sus resultados están completos. Si el modelo falla: `PIPELINE_FAILED` con `NER_MODEL_MISSING` — y el botón "Desactivar NER y reanalizar" de `React_Client.md` §8 pasa a llamar `reanalyze({ ner: { enabled: false } })` **desde `Failed`**, que ahora sí preserva las ediciones.
2. **`ner.enabled: true → false`**: stage → `Grouping` (transitorio); `reopenSession(docId, { expectRegex: false, expectNer: false })`; `dropOccurrences(docId, { source: DetectionSource.NER })`; `finishSession(docId)` por invocación directa (espejo exacto del wiring NER-off de ADR-034 §2) → renumeración (equivalencia con corrida fresca solo-Regex) → `Ready`. Sin trabajo asíncrono: no se despacha ningún motor.
3. **`ocr.languages` (documento con páginas `requiresOCR`)**: stage → `OCRing`; `reopenSession(docId, { expectRegex: true, expectNer: <ner.enabled efectivo> })`; `dropOccurrences(docId, { pageIndices: <páginas requiresOCR> })` (su texto va a cambiar: **todas** sus ocurrencias son inválidas, incluidas las Regex); re-rasterización vía `RenderEngine.rasterizePage` + `OcrEngine.processPages` + fusión mediada `PdfEngine.fuseOcrPage` (reemplaza `Word[]`, §Contexto punto 5; ADR-014) + normalización (etapa 3) de esas páginas — el `Document` retenido se actualiza; stage → `Detecting`: `RegexEngine.process` sobre el documento **completo** (los duplicados de páginas intactas los filtra el dedup §3) y, si NER está activo, `NerEngine.processPages` **solo sobre las páginas re-OCR** (las demás conservan sus ocurrencias NER válidas); auto-finish → `Ready`. **Sin páginas OCR**: se actualiza la config efectiva y `reanalyze` resuelve como no-op (nada que re-detectar: los idiomas de OCR no afectan texto nativo).
4. ~~**Patch combinado** (`ner` + `ocr`): se ejecuta como el flujo 3 con la config NER final (el orden es OCR → detección; la unión de las reglas anteriores).~~ **RETIRADA por ADR-081 (2026-08-19)**: "la unión de las reglas anteriores" nunca se implementó — con ambos campos se entra solo por el flujo 3, que por diseño toca únicamente las páginas re-OCR, así que apagar NER dejaba sus ocurrencias vivas en el resto del documento y encenderlo solo lo corría sobre las páginas escaneadas. Los dos casos fallaban en silencio, con el pipeline llegando a `Ready`. Un patch con `ner` y `ocr` a la vez ahora **se rechaza** con `InvalidInputError`; el resultado que esta regla prometía se obtiene componiendo dos llamadas, OCR primero — que es lo que `SettingsDialog` ya hace desde el PR6.

### 6. Cancelación de un re-análisis

`CANCEL_REQUESTED` durante un re-análisis: se abortan los jobs OCR/NER en vuelo (mecanismo `05` §3, sin cambios); las ocurrencias **ya mergeadas se conservan**; el Orchestrator invoca `grouping.finishSession` (cierre determinista con renumeración) **antes** de emitir `PIPELINE_CANCELLED`, suprimiendo el `PIPELINE_READY` derivado de ese `GROUPING_FINISHED` (guard por `cancelRequested`, mismo patrón que ya usa para eventos tardíos); el stage final es **`Ready`**, no `Cancelled`. Divergencia deliberada respecto del import cancelado (que termina en `Cancelled`): en el import no hay estado editable previo al que volver; acá sí — el documento sigue cargado, editable y exportable con lo que haya.

### 7. UI: `React_Client.md` §3.7 reescrito; el flujo destructivo desaparece

- `nerEnabled` / `ocrLanguages` con documento abierto → `ConfirmDialog` ("Reanalizar el documento con la nueva configuración? Tus ediciones se conservan.") → `actions.reanalyze(patch)` → `orchestrator.reanalyze`. La acción nueva se agrega a `React_Client.md` §2.3.
- `performancePreset` **ya no recrea el core con documento abierto**: no afecta resultados de detección — sin documento abierto, la UI recrea el core al vuelo (nada que perder); con documento abierto, el cambio queda persistido y **aplica al próximo documento** (hint en el `SettingsDialog`). El flujo "closeDocument + dispose + createCore + re-importDocument" de ADR-036 §5 queda **eliminado** del contrato de UI.
- Tras el `PIPELINE_READY` de un re-análisis, la UI re-emite `RENDER_REQUESTED` del `visibleRange` (mismo camino que tras el primer `Ready`) para refrescar previews con los grupos nuevos.
- El escenario E2E 9 (`07` §11.3) se reescribe: "activar NER en runtime → descarga modelo y reanaliza **preservando las ediciones previas del usuario** (grupo deshabilitado sigue deshabilitado; regla creada sigue aplicando; merge manual persiste)".

### 8. Módulos, PRs y orden actualizado del Hito 10 (reemplaza la tabla de ADR-036 §8)

Cambios por módulo: `grouping-engine` (reopen/drop/dedup/finish re-ejecutable — spec v1.1.0) y `packages/anonymization-core/src` (Orchestrator `reanalyze`, config efectiva, transiciones — spec v1.2.0) + `shared` (`ReanalyzeConfigPatch`, viaja con el PR del Orchestrator que lo consume — precedente ADR-034). **Cero cambios** en Regex/NER/OCR/PDF/Export. Son dos módulos ⇒ **dos PRs** (R-1/R-5), Grouping primero (el Orchestrator depende de sus firmas).

Tabla canónica del orden de PRs del Hito 10 (inserciones de ADR-037 y ADR-038 en negrita; el resto es la tabla de ADR-036 §8 renumerada):

| # | PR | Módulo | Contenido |
|---|---|---|---|
| 1 | Scaffold | `apps/react-client` | Vite + Tailwind + Radix + Zustand; CSP de `08` §3.2; tokens; hero/estado vacío. Bootea sin Core. |
| **2** | **Grouping re-análisis** | **`grouping-engine`** | **`reopenSession`/`dropOccurrences`/dedup por identidad/`finishSession` re-ejecutable (ADR-038 §2–§4) + tests.** |
| **3** | **Orchestrator `reanalyze`** | **`packages/anonymization-core/src` (+ `shared`: `ReanalyzeConfigPatch`)** | **`reanalyze`, config efectiva, transiciones nuevas, cancelación §6 (ADR-038 §1, §5–§6) + tests. Depende del PR 2.** |
| **4** | **Render zoom** | **`render-engine` (+ `shared`: `RenderRequested.scale`, constantes)** | **Handler con `scale`, clave de cache por escala, límite de bytes, supersede (ADR-037) + tests. Independiente de PRs 2–3.** |
| 5 | `core-adapter` | `apps/react-client` | `initCore` (in-process), bus-bridge, actions completas (ADR-036 §5 **+ `reanalyze` + `requestRender(..., scale?)`**), snapshots, 6 stores. |
| 6 | Toolbar + diálogos de flujo | `apps/react-client` | `Toolbar`, `ImportButton`, `PipelineStatus`, `CancelButton` + `PasswordDialog`, `ConfirmDialog`, `SettingsDialog` (flujo `reanalyze`, ADR-038 §7). |
| 7 | Visor | `apps/react-client` | `SideBySideViewer`, `PdfViewer`, `PageVirtualizer`, `PageCanvas`, `ZoomControls` (CSS inmediato + re-render debounced, ADR-037 §5). |
| 8 | Panel Entidades + conflictos | `apps/react-client` | `EntitiesPanel` y sub-árbol, `MergeDialog`, `SplitDialog`, `ConflictBadge/Dialog`. |
| 9 | Panel Reglas + Export | `apps/react-client` | `RulesPanel`, `Rule*Dialog`, `ExportButton/Dialog/Progress`. |
| 10 | E2E base | `tests/e2e/` | Playwright; escenarios 1, 6, 8 de `07` §11.3 sobre core in-process; activa el gate `test:e2e`. |
| 11 | Transporte de workers | `packages/anonymization-core/src` | `CoreRuntimeOptions`/`WorkerLike`, modo `postMessage` en `worker-pool.ts`, variante `EVENT`, fakes estructurales. |
| 12–16 | Workers, uno por PR (R-1) | `pdf-engine`, `render-engine`, `ocr-engine`, `ner-engine`, `export-engine` | Entry-point + host-bridge + subpath `"./worker"` + wiring en la app; E2E verde tras cada uno. Orden: Pdf, Render, Ocr, Ner, Export (ADR-036 §1/§8). |
| 17 | E2E completa | `tests/e2e/` | Escenarios 2, 3, 4, 5, 7, 9 (preservación de ediciones, §7), 10 y **11 (zoom, ADR-037 §6)** de `07` §11.3; fixtures pesados restantes. |

Los PRs 2–4 no dependen del scaffold y pueden correr en paralelo con el PR 1; el PR 5 depende de 1–4.

> **Inserción posterior (ADR-048 §7 punto 2, ratificada por el humano el 2026-07-24)**: **PR 16.5 — bootstrap `settings.store` → `EngineConfig`** (`apps/react-client`), entre el PR 16 y el PR 17. `App.tsx` deriva `EngineConfigOverrides` de los settings persistidos y llama `initCore(overrides)` (mapeo de `ui/React_Client.md` §3.7). Cierra el bug de producto del toggle de NER sin documento abierto y desbloquea el Escenario 8 del PR 17, en `test.fixme` desde el PR 10.

> **Inserción posterior (ADR-049 §7, 2026-07-30)**: **PR 17.1 — `PdfPasswordRequiredError.retryable = false`** (`pdf-engine`) y **PR 17.2 — discriminación de errores por `code` en el Orchestrator** (`packages/anonymization-core/src`), en ese orden obligatorio. Salen de un bug real destapado por el Escenario 3 de PR17: la subclase concreta de un `EngineError` no sobrevive al `postMessage`, así que los dos `instanceof PdfPasswordRequiredError` de `orchestrator.ts` fallan con transporte real (banner de pipeline fallido en vez de `PasswordDialog`, más reintentos espurios del pool). El PR 17.1 cierra de paso el pendiente que ADR-035 §3 arrastraba desde el Hito 9; el PR 17.2 lleva el des-`fixme` de `tests/e2e/scenario-3-protected-pdf.spec.ts` como evidencia del fix, y PR17 conserva los otros siete escenarios.

> **Inserción posterior (ADR-050 §7, 2026-07-30)**: **PR 17.4 — `loadDocument` con password** (`render-engine` + `shared`) y **PR 17.5 — propagación en el façade** (`packages/anonymization-core/src`), en ese orden. Al desbloquear el flujo de password (ADR-049), el Escenario 3 avanzó hasta la carga en Render y destapó el bug siguiente: `retryWithPassword` no persiste la contraseña en `retainedInputs` y `RenderEngine.loadDocument` no tiene por dónde recibirla, así que un PDF protegido con la contraseña **correcta** muere igual en `PIPELINE_FAILED` — y con él la rasterización para OCR, el seed del preview y el export. A diferencia de ADR-049, no depende del transporte: falla igual in-process, abierto desde ADR-030. Entre medio quedaron dos PRs sin ADR: **17.3** (race en `initCore()`, `apps/react-client`, ya cerrado) y **17.6** (`ocr-engine`: `TESSERACT_WORKER_PATH` apuntaba a un directorio y tesseract fallaba en silencio — errata de `OCR_Engine.md` v1.2.1 y `ADR-018` §2).

> **Inserción posterior (ADR-051 §6, 2026-07-30)**: **PR 17.7 — `CloseDocumentButton` en el `Toolbar`** (`apps/react-client`). Un documento que llega a `Ready` no se podía cerrar desde la UI —solo el banner de `Failed` y el cancelar de `PasswordDialog` invocan `closeDocument`—, y como `validateImportInput` exige cerrar antes de importar otro, tampoco se podía abrir un segundo PDF sin recargar la pestaña. Corrige el supuesto de ADR-048 §3 y desbloquea el Escenario 7 de PR17 y el gate `test:leak` de Hito 11. Cero cambios en `packages/`.

> **Inserción posterior (ADR-052 §7, 2026-07-30)**: **PR 17.8 — blob URLs tardíos tras cerrar documento** (`packages/anonymization-core/src`), después del PR 17.7. El Escenario 7 hizo observable el ciclo open/close y con él una ventana real: `handlePreviewUpdated`/`handleExportFinished` registraban el blob URL entrante sin mirar si el documento seguía abierto, así que un render en vuelo que emitiera después del barrido de `closeDocument` dejaba un URL que ningún cierre futuro vuelve a revocar. Tres fuentes de llegada tardía, no una: el preview mediado (ADR-044 §3 + nota v1.5.1), la vía por evento de Render (usa el `ctx` de `init`, no es cancelable por documento) y el export. Fix: guard que **revoca** en los dos handlers + señal de baja por documento para el preview mediado. `cancelReanalyze` (§6 de este ADR) queda intacto.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Recrear core + reimportar (ADR-036 §5) | Rechazada por el humano: descarta merges/splits/reglas/deshabilitados/canónicos editados. |
| Serializar las ediciones, recrear el core y re-aplicarlas sobre la sesión nueva | Los `groupId`/`occurrenceId` son UUID por sesión: re-aplicar exige matching heurístico por valor — que es exactamente lo que Grouping ya hace en vivo. Sería duplicar el motor en un "replayer" frágil, con los mismos casos límite y el doble de superficie. |
| Evento `REANALYZE_REQUESTED` (canal `ui`) en lugar de método | El precedente para operaciones de pipeline con resultado awaitable es el método directo (`importDocument`, `retryWithPassword`); un evento nuevo toca enum + payload + matriz + `04` §10 sin ganancia. |
| Re-correr también Regex al activar NER | El texto no cambió y Regex ya corrió completo: solo produciría duplicados que el dedup descartaría — CPU muerta en documentos grandes. |
| Dedup por `occurrenceId` | Los UUID son nuevos en cada pasada: no dedupea nada. La identidad estable de una detección es `(entityType, pageIndex, bbox, normalizedValue)`. |
| Congelar `indexInType` en re-análisis (append-only, sin renumerar) | Rompe el invariante de determinismo de ADR-028: el resultado dependería de la historia de pasadas. La renumeración ya existe, ya emite sus eventos y ya preserva ediciones (caso 21); reusarla es menos código y más coherencia. |
| `ReanalyzeConfigPatch = Partial<EngineConfig>` completo | Obligaría a definir semántica de re-análisis para campos que no la tienen (pool sizes, cachePages…) e invitaría a patches sin sentido. MVP cubre los dos settings reales de la UI; ampliar = ADR. |
| API por-páginas en Regex (`processPages`) para evitar la re-pasada full-doc | Cambio de contrato de un motor cerrado (Hito 4) para ahorrar 5–50 ms/página en un camino frío; el dedup hace la re-pasada inocua. Si el perfil lo justifica alguna vez, ADR propio. |
| Conservar deshabilitados los grupos que quedan sin members (en vez de eliminarlos) | Viola `members.length ≥ 1` (`03` §9) y deja en el árbol entradas que no referencian nada anonimizable. Ver pregunta abierta Q1. |

## Consecuencias

**Positivas**: el escenario E2E 9 se cumple **preservando ediciones** (el pedido del humano); la recuperación de `NER_MODEL_MISSING` deja de costar el trabajo del usuario; `ENTITY_FOUND` pasa a ser idempotente de verdad (cierra una deuda latente de `04` §5); cero cambios en los motores de detección y cero eventos nuevos; el flujo destructivo de settings desaparece de la UI; la equivalencia "estado final ≡ corrida fresca con la config final + ediciones" da un oráculo de test potente (mismo fixture, dos caminos, mismo snapshot de grupos módulo ediciones).

**Negativas**: Grouping gana dos métodos públicos y un invariante (superficie y complejidad de sesión mayores); `GROUPING_FINISHED`/`PIPELINE_READY` dejan de ser únicos por documento (los consumidores actuales — Orchestrator y UI — ya son idempotentes, pero es un cambio semántico documentado en `04` §2/§6); los índices de placeholder pueden cambiar tras un re-análisis (visible para el usuario; consecuencia aceptada del determinismo de ADR-028); el flujo OCR re-corre Regex sobre el documento completo (aceptado: 5–50 ms/página, main thread); tras un `PIPELINE_FAILED` en re-análisis la sesión queda reabierta sin cerrar hasta que el usuario actúe (recuperable por `reanalyze` NER-off o `closeDocument`).

## Preguntas abiertas para el humano

- **Q1 — NER off y grupos editados que quedan vacíos**: al desactivar NER, un grupo cuyos únicos members eran NER se **elimina** aunque el usuario lo haya editado (p. ej. le cambió el modo) — decisión tomada por equivalencia con corrida fresca e invariante `members.length ≥ 1`. La alternativa (conservarlo deshabilitado como "huérfano") preserva más trabajo visible pero deja entradas muertas en el árbol. ¿Confirmás la eliminación?
- **Q2 — Índices de placeholder tras re-análisis**: con la renumeración canónica, activar NER puede correr los números (`[PERSON 03]` → `[PERSON 05]`) de grupos que el usuario ya vio. Es el costo del determinismo (ADR-028). ¿Aceptás el corrimiento visible, o preferís congelar índices en re-análisis (rompiendo la equivalencia con corrida fresca)?
- **Q3 — `performancePreset` con documento abierto**: decidí "aplica al próximo documento" (cero pérdida de datos, cero API nueva). La alternativa de efecto inmediato exige o bien recrear el core (pierde ediciones — lo que este ADR elimina) o bien redimensionado de pools en caliente (API nueva sin relación con detección). ¿Confirmás el diferimiento?

## Referencias

- `core/Contracts.md` §3.1, §3.5, §8 — `core/Orchestrator.md` §2, §6, §8, §13 — `core/Grouping_Engine.md` §2, §6, §13, §Algoritmos — `core/NER_Engine.md` §6, §13 (caso 11) — `core/Regex_Engine.md` §6 — `core/PDF_Engine.md` §6, §8, §13 (caso 14) — `core/OCR_Engine.md` §6
- `architecture/03_Data_Model.md` §7, §9, §15 — `architecture/04_Event_System.md` §2, §5, §6, §10, §11 — `architecture/06_Pipeline.md` §4–§9, §16 — `architecture/07_Performance_Strategy.md` §11.3, §11.6
- `ui/React_Client.md` §2.3, §3.6, §3.7, §8 — `ui/Components.md` §2.6, §6, §12
- `adr/ADR-014` — `adr/ADR-020` §6 — `adr/ADR-028` — `adr/ADR-029` — `adr/ADR-034` §2 — `adr/ADR-036` §5, §8 — `adr/ADR-037`
- `packages/anonymization-core/grouping-engine/src/grouping.engine.ts` (sesión, flags, renumeración, caso 17) — `packages/anonymization-core/ner-engine/src/ner.engine.ts` (lazy load, `enabled` por llamada) — `packages/anonymization-core/pdf-engine/src/pdf.engine.ts` (`fuseOcrPage` reemplaza) — `packages/anonymization-core/src/orchestrator.ts` (retención de `Document`/buffer, wiring NER-off)
