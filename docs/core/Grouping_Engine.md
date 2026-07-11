<!-- CONTEXT: scope=grouping-engine | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,ADR-011-Grouping-First.md,ADR-012-Replacement-Modes.md | audiencia=IA-implementador | fase=3 -->

# Grouping Engine — Spec de Motor

> Agrupa las `Occurrence` emitidas por Regex y NER en `EntityGroup` por tipo y valor canónico. Detecta conflictos. Expone grupos a la UI (la unidad de operación). Resuelve reemplazos según `ReplacementMode` y `Rule`.

**EngineId**: `grouping`
**Versión del spec**: 1.0.0
**Última actualización**: 2026-06-17

---

## 1. Objetivo

Recibir el stream de `ENTITY_FOUND` (ocurrencias crudas de Regex y NER) y producir `EntityGroup[]` con `indexInType` secuencial, `canonicalValue`, `aliases` y `members`, exponiéndolos a la UI incrementalmente. Resolver conflictos y aplicar reglas para determinar el `replacementMode` y `replacementValue` final de cada grupo.

---

## 2. Responsabilidades

- Escuchar `ENTITY_FOUND` en el canal `regex` y `ner`.
- Para cada `Occurrence`, encontrar un `EntityGroup` existente del mismo `entityType` por `normalizedValue` exacto o fuzzy (Levenshtein normalizado con umbral `GROUPING_SIMILARITY_THRESHOLD`).
- Si encuentra grupo, agregar la ocurrencia como `OccurrenceRef` (y como alias si el `value` difiere).
- Si no encuentra, crear grupo nuevo con `indexInType = nextIndex(type)`.
- Asignar `canonicalValue` (alias más frecuente; en empate, el más largo).
- Resolver `replacementMode` y `replacementValue` aplicando `Rule[]` en orden de prioridad (group > type > global > manual > default placeholder).
- Detectar conflictos (`overlap`, `disagree`, `low_confidence`, `ambiguous_canonical`) y emitir `CONFLICT_DETECTED`.
- Resolver conflictos automáticamente con política default (ver §13 de `06_Pipeline.md`).
- Procesar inputs del usuario: `GROUP_UPDATE_REQUESTED`, `GROUP_MERGE_REQUESTED`, `GROUP_SPLIT_REQUESTED`, `RULE_CREATED`, `RULE_UPDATED`, `RULE_DELETED`, `CONFLICT_RESOLVE_REQUESTED`.
- Emitir `ENTITY_GROUP_CREATED`, `ENTITY_GROUP_UPDATED`, `ENTITY_GROUP_REMOVED`, `GROUP_REPLACEMENT_CHANGED`, `GROUP_TOGGLED`, `CONFLICT_RESOLVED`, `GROUPING_FINISHED`.
- Mantener `indexInType` estable: si un grupo se elimina, su índice se saltea; si dos se fusionan, el resultante conserva el menor.

---

## 3. Fuera de alcance

- Detectar entidades (Regex/NER).
- Renderizar el PDF.
- Conocer React ni UI.
- Persistir nada.
- Hacer OCR.
- Cambiar `canonicalValue` sin intervención del usuario (excepto al crear/fusionar).

---

## 4. Dependencias permitidas

- `@anonly/shared`
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Occurrence`, `OccurrenceRef`, `EntityGroup`, `EntityType`, `ReplacementMode`, `Rule`, `Conflict`, `ConflictReason`, `Annotation`, `GroupingConfig`
- `architecture/04_Event_System.md`: todos los eventos de grouping + UI inputs
- No requiere dependencias externas: usa algoritmos propios (Levenshtein).

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor
- `pdfjs-dist`, `tesseract.js`, `@huggingface/transformers`, `onnxruntime-web`, `pdf-lib`
- Node builtins, libs de network
- Libs de fuzzy matching externas (`fuse.js`, `fast-levenshtein`) sin ADR

---

## 6. Interfaces públicas

```ts
export interface GroupingEngineConfig {
  readonly similarityThreshold: number;   // default 0.88
  readonly minAliasFrequency: number;      // default 1
}

export interface GroupingEngineInput {
  readonly documentId: string;
  // No se pasa input directo; el motor escucha ENTITY_FOUND del bus.
}

export interface GroupingEngineSnapshot {
  readonly documentId: string;
  readonly groups: ReadonlyArray<EntityGroup>;
  readonly conflicts: ReadonlyArray<Conflict>;
  readonly rules: ReadonlyArray<Rule>;
}

export class GroupingEngine implements IEngine {
  readonly id = EngineId.Grouping;
  init(ctx: EngineContext): Promise<void>;
  startSession(documentId: string): void;
  getSnapshot(documentId: string): GroupingEngineSnapshot;
  finishSession(documentId: string): Promise<void>;  // emite GROUPING_FINISHED
  applyGroupUpdate(req: GroupUpdateRequested): Promise<EntityGroup>;
  applyGroupMerge(req: GroupMergeRequested): Promise<EntityGroup>;
  applyGroupSplit(req: GroupSplitRequested): Promise<{ merged: EntityGroup; created: EntityGroup }>;
  applyRuleCreated(req: RuleCreated): Promise<void>;
  applyRuleUpdated(req: RuleUpdated): Promise<void>;
  applyRuleDeleted(req: RuleDeleted): Promise<void>;
  applyConflictResolve(req: ConflictResolveRequested): Promise<Conflict>;
  closeSession(documentId: string): Promise<void>;
  dispose(): Promise<void>;
}
```

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `ENTITY_GROUP_CREATED` | al crear un grupo nuevo | `EntityGroupCreated` | async | no |
| `ENTITY_GROUP_UPDATED` | al mutar un grupo por patch, fusión o regla | `EntityGroupUpdated` | async | sí |
| `ENTITY_GROUP_REMOVED` | al eliminar un grupo (fusión o cierre) | `EntityGroupRemoved` | async | sí |
| `GROUP_REPLACEMENT_CHANGED` | cuando `replacementMode` o `replacementValue` cambian | `GroupReplacementChanged` | async | sí |
| `GROUP_TOGGLED` | cuando `enabled` cambia | `GroupToggled` | async | sí |
| `CONFLICT_DETECTED` | al detectar un conflicto | `ConflictDetected` | async | sí |
| `CONFLICT_RESOLVED` | al resolver un conflicto (auto o manual) | `ConflictResolved` | async | sí |
| `GROUPING_FINISHED` | cuando Regex + NER terminaron y no hay más `ENTITY_FOUND` pendientes | `GroupingFinished` | async | sí |

Canal: `EventChannel.Grouping`.

---

## 8. Eventos que consume

| Evento | Cuándo | Acción |
|---|---|---|
| `ENTITY_FOUND` (canales `regex` y `ner`) | cada ocurrencia detectada | agregar a grupo existente o crear nuevo; emitir `ENTITY_GROUP_CREATED` o `ENTITY_GROUP_UPDATED` |
| `REGEX_FINISHED` (canal `regex`) | Regex terminó | marcar regex done |
| `NER_FINISHED` (canal `ner`) | NER terminó | marcar ner done; si ambos done, emitir `GROUPING_FINISHED` |
| `GROUP_UPDATE_REQUESTED` (canal `ui`) | usuario edita grupo | `applyGroupUpdate` |
| `GROUP_MERGE_REQUESTED` (canal `ui`) | usuario fusiona | `applyGroupMerge` |
| `GROUP_SPLIT_REQUESTED` (canal `ui`) | usuario divide | `applyGroupSplit` |
| `RULE_CREATED` (canal `ui`) | usuario crea regla | `applyRuleCreated` + recompute modos |
| `RULE_UPDATED` (canal `ui`) | usuario edita regla | `applyRuleUpdated` + recompute |
| `RULE_DELETED` (canal `ui`) | usuario borra regla | `applyRuleDeleted` + recompute |
| `CONFLICT_RESOLVE_REQUESTED` (canal `ui`) | usuario resuelve conflicto | `applyConflictResolve` |
| `DOCUMENT_CLOSED` (canal `ui`) | usuario cierra doc | `closeSession` |

Canales escuchados: `EventChannel.Regex`, `EventChannel.Ner`, `EventChannel.UI`.

---

## 9. Entradas

No recibe input directo en `process`. Recibe datos vía eventos del bus:

- `EntityFound.occurrence: Occurrence` (con `entityType`, `value`, `normalizedValue`, `bbox`, `pageIndex`, `source`, `confidence`).
- Inputs de UI: `GroupUpdateRequested`, `GroupMergeRequested`, etc.

**Restricciones**:
- `Occurrence.normalizedValue` debe estar poblado (lo provee Regex/NER).
- `Occurrence.entityType` debe ser válido.
- `GroupUpdateRequested.patch` no puede contener campos no permitidos (`id`, `type`, `members`, `indexInType`, `createdAt` son inmutables).

---

## 10. Salidas

No retorna output directo. Emite eventos y mantiene un snapshot consultable vía `getSnapshot`:

```ts
GroupingEngineSnapshot {
  documentId: string;
  groups: ReadonlyArray<EntityGroup>;
  conflicts: ReadonlyArray<Conflict>;
  rules: ReadonlyArray<Rule>;
}
```

Cada `EntityGroup` cumple las invariantes de `03_Data_Model.md` §9:
- `members.length >= 1`
- `indexInType` único por `(documentId, type)`
- `canonicalValue ∈ aliases` (excepto edición manual explícita)
- `replacementValue` consistente con `replacementMode`

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `GROUPING_INVALID_PATCH` | `GroupingInvalidPatchError` | `GroupUpdateRequested.patch` contiene campos inmutables o inválidos | no | rechazar el request, loguear warn |
| `GROUPING_GROUP_NOT_FOUND` | `GroupingGroupNotFoundError` | `groupId` referenciado no existe (fue eliminado o nunca existió) | no | rechazar el request, loguear warn |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | operación antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | operación tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined | no | bug del caller |

Grouping es determinista dadas las ocurrencias y reglas; sin errores de runtime esperados.

`retryable`: todos `false`.

---

## 12. Consideraciones de rendimiento

- **Corre en main thread** (no en Worker). Es ligero: < 5% del total del pipeline.
- Costo: 0.5–2 ms por `Occurrence` procesada (búsqueda en grupos del mismo tipo + fuzzy matching si no hay match exacto).
- Memoria: 1–10 MB por documento activo (grupos + refs + reglas + conflictos).
- Sin transferencia zero-copy (trabaja sobre estructuras en memoria).
- Para fuzzy matching: el algoritmo de Levenshtein se aplica solo cuando no hay match exacto. Se acota a grupos del mismo `entityType`. Para 1000 grupos del mismo tipo, costo O(1000 × len) por ocurrencia — aceptable. Si supera 5000 grupos, se optimiza con index por longitud o n-gramas (futuro).
- Cancelación: entre procesamientos de `ENTITY_FOUND`. SLA < 50 ms (no requiere Worker).
- Snapshot inmutable: `getSnapshot` retorna una copia defensiva para que la UI no mute el estado interno.

---

## 13. Casos límite

1. **Documento sin ocurrencias**: 0 grupos, `GROUPING_FINISHED` con `groupCount = 0`.
2. **Una sola ocurrencia**: un grupo con `members.length = 1`, `indexInType = 1`, `aliases = [value]`.
3. **Mismo DNI con y sin puntos (`34.567.891` y `34567891`)**: `normalizedValue` idéntico → mismo grupo, `aliases = ["34.567.891", "34567891"]`, `canonicalValue = "34.567.891"` (más frecuente o primero).
4. **"J. Pérez" y "Juan Pérez" en el mismo documento**: match exacto falla, fuzzy match con umbral 0.88 → "juan perez" vs "j. pérez" Levenshtein normalizado > 0.12 → no se agrupan automáticamente. El usuario puede fusionar manualmente con `GROUP_MERGE_REQUESTED`.
5. **Fusión manual**: dos grupos se fusionan en uno. El resultante conserva el menor `indexInType`, sus `aliases` se unen, `canonicalValue` se elige por frecuencia. El otro grupo se elimina con `ENTITY_GROUP_REMOVED`.
6. **División manual**: un grupo se divide; las ocurrencias seleccionadas van a un grupo nuevo con `indexInType = nextIndex(type)`. El grupo original conserva las demás.
7. **Conflicto `overlap`**: dos ocurrencias de distinto tipo comparten bbox. Se emite `CONFLICT_DETECTED`. Resolución default: gana el de mayor `confidence`, en empate Regex. El usuario puede overridear.
8. **Conflicto `disagree`**: Regex dice DNI, NER dice Person en el mismo span. Gana Regex. Conflicto emitido.
9. **Conflicto `low_confidence`**: NER con `confidence < 0.7`. Se descarta la ocurrencia NER (no se agrupa). Conflicto emitido para auditoría.
10. **Conflicto `ambiguous_canonical`**: dos aliases con misma frecuencia. `canonicalValue` se elige arbitrariamente (el primero encontrado) y se marca conflicto para que el usuario confirme.
11. **Edición de `replacementMode`**: `GROUP_UPDATE_REQUESTED` con `patch.replacementMode = "synthetic"`. El motor recalcula `replacementValue` con el sintetizador (seed por sesión). Emite `ENTITY_GROUP_UPDATED` + `GROUP_REPLACEMENT_CHANGED`.
12. **Regla `type` nueva**: `RULE_CREATED` con `scope = "type"`, `entityType = DNI`, `mode = "mask"`. Todos los grupos DNI sin regla `group` específica pasan a `mask`. Emite `ENTITY_GROUP_UPDATED` por cada grupo afectado.
13. **Regla `global`**: aplica a todos los grupos sin regla más específica.
14. **Regla `group` vs `type` vs `global`**: gana la más específica (group > type > global). `priority` desempata dentro del mismo scope.
15. **`indexInType` estable tras eliminar grupo**: si elimino el grupo `DNI 02`, los grupos `DNI 01` y `DNI 03` conservan sus índices. No se reasigna.
16. **`indexInType` tras fusión**: fusionar `DNI 02` en `DNI 01` → `DNI 01` conserva índice 1 y se enriquece; `DNI 02` se elimina; `DNI 03` conserva índice 3.
17. **Edición mientras NER sigue corriendo**: el usuario edita un grupo; llega un nuevo `ENTITY_FOUND`. Si matchea ese grupo, se agrega **sin perder la edición del usuario** (gana el `replacementMode` del usuario).
18. **`canonicalValue` editado manualmente**: el usuario puede setear `canonicalValue` arbitrario vía `patch.canonicalValue`. A partir de ahí, `canonicalValue ∉ aliases` es válido (es una excepción explícita).
19. **`closeSession` libera todo**: tras `DOCUMENT_CLOSED`, el motor limpia grupos, reglas, conflictos y alias de la sesión.
20. **`process` tras `dispose`**: lanza `EngineDisposedError`.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits ENTITY_GROUP_CREATED on first occurrence of a value` | `contract.test.ts` | contract | invariante |
| `emits ENTITY_GROUP_UPDATED on second occurrence of same value` | `contract.test.ts` | contract | invariante |
| `emits GROUPING_FINISHED after REGEX_FINISHED + NER_FINISHED` | `contract.test.ts` | contract | invariante |
| `indexInType unique per (document, type)` | `contract.test.ts` | contract | invariante |
| `canonicalValue ∈ aliases` | `unit.test.ts` | unit | invariante |
| `members.length ≥ 1` | `unit.test.ts` | unit | invariante |
| `DNI with and without dots groups together` | `unit.test.ts` | unit | caso 3 |
| `J. Pérez and Juan Pérez do not auto-merge` | `edge.test.ts` | edge | caso 4 |
| `manual merge preserves lower indexInType` | `edge.test.ts` | edge | caso 5/16 |
| `manual split creates new group with nextIndex` | `edge.test.ts` | edge | caso 6 |
| `overlap conflict detected` | `edge.test.ts` | edge | caso 7 |
| `disagree conflict resolved in favor of regex` | `edge.test.ts` | edge | caso 8 |
| `low_confidence occurrence discarded` | `edge.test.ts` | edge | caso 9 |
| `ambiguous_canonical conflict emitted` | `edge.test.ts` | edge | caso 10 |
| `replacementMode change recalculates replacementValue` | `edge.test.ts` | edge | caso 11 |
| `type rule overrides default mode for all groups of type` | `edge.test.ts` | edge | caso 12 |
| `global rule applies to groups without more specific rule` | `edge.test.ts` | edge | caso 13 |
| `group rule wins over type rule wins over global` | `edge.test.ts` | edge | caso 14 |
| `indexInType stable after group removal` | `edge.test.ts` | edge | caso 15 |
| `user edit preserved when new ENTITY_FOUND arrives` | `edge.test.ts` | edge | caso 17 |
| `manual canonicalValue override allowed` | `edge.test.ts` | edge | caso 18 |
| `closeSession clears state` | `contract.test.ts` | contract | caso 19 |
| `throws GroupingInvalidPatchError on immutable field patch` | `edge.test.ts` | edge | invariantes |
| `throws GroupingGroupNotFoundError on missing groupId` | `edge.test.ts` | edge | – |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 20 |
| `empty document emits GROUPING_FINISHED with 0 groups` | `edge.test.ts` | edge | caso 1 |
| `single occurrence creates group with indexInType 1` | `edge.test.ts` | edge | caso 2 |
| `cancel between ENTITY_FOUND within 50ms` | `cancel.test.ts` | cancel | SLA |
| `snapshot of groups for text-10p.pdf stable` | `snapshot.test.ts` | snapshot | fixture |

Fixtures: `tests/fixtures/text-10p.pdf` con entidades conocidas que generan grupos predecibles.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/grouping-engine/`.
- [ ] 2. Definir `types.ts` con `GroupingEngineConfig`, `GroupingEngineInput`, `GroupingEngineSnapshot`.
- [ ] 3. Definir `errors.ts` con `GroupingInvalidPatchError`, `GroupingGroupNotFoundError`.
- [ ] 4. Implementar `grouping.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. Implementar `init` (suscribirse a `ENTITY_FOUND` en `regex` y `ner`, a `REGEX_FINISHED`/`NER_FINISHED`, a eventos de UI en `ui`).
- [ ] 6. Implementar `startSession`/`closeSession` (gestión de estado por `documentId`).
- [ ] 7. Implementar algoritmo de matching: exacto por `normalizedValue`, luego fuzzy Levenshtein normalizado con umbral `similarityThreshold`.
- [ ] 8. Implementar asignación de `indexInType` secuencial y estable (no reasigna tras eliminación).
- [ ] 9. Implementar cálculo de `canonicalValue` (alias más frecuente, en empate el más largo).
- [ ] 10. Implementar detección de conflictos (`overlap`, `disagree`, `low_confidence`, `ambiguous_canonical`).
- [ ] 11. Implementar resolución default automática de conflictos (ver §13 de `06_Pipeline.md`).
- [ ] 12. Implementar resolución de `replacementMode` por `Rule[]` en orden group > type > global > manual > default.
- [ ] 13. Implementar `applyGroupUpdate`/`Merge`/`Split`/`RuleCreated`/`Updated`/`Deleted`/`ConflictResolve`.
- [ ] 14. Implementar `getSnapshot` (copia defensiva).
- [ ] 15. Implementar `dispose` (dessuscribir todos los handlers del bus).
- [ ] 16. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 17. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 18. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 19. Escribir `snapshot.test.ts` con grupos de `text-10p.pdf`.
- [ ] 20. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 21. Verificar `index.ts` exporta solo `GroupingEngine`, tipos, errores.
- [ ] 22. Verificar imports sin dependencias prohibidas.

---

## Algoritmos clave (resumen)

### Matching

```text
para cada Occurrence entrante:
  candidatos = grupos del mismo entityType
  // 1. match exacto
  for g in candidatos:
    if g.aliases contiene occurrence.normalizedValue:
      agregar a g, return
  // 2. match fuzzy
  for g in candidatos:
    for alias in g.aliases:
      sim = levenshteinNormalized(occurrence.normalizedValue, alias)
      if sim >= GROUPING_SIMILARITY_THRESHOLD:
        agregar a g como nuevo alias si value difiere, return
  // 3. crear grupo nuevo
  crear grupo con indexInType = nextIndex(entityType)
```

### Levenshtein normalizado

```text
levenshteinNormalized(a, b) = 1 - levenshtein(a, b) / max(a.length, b.length)
```

Para strings vacíos: si ambos vacíos, sim = 1.0; si uno vacío, sim = 0.0.

### `canonicalValue`

```text
frequency(alias) = count de members con normalizedValue == alias
canonicalValue = argmax_frequency(alias); en empate, argmax_length(alias)
```

### `indexInType`

```text
nextIndex(type) = (max indexInType entre grupos del tipo) + 1
si no hay grupos del tipo, nextIndex = 1
tras eliminar grupo: el índice se saltea (no se reasigna)
tras fusionar A en B: B conserva min(A.index, B.index); A se elimina
```

### Resolución de modo

```text
function resolveMode(group, rules):
  rules_group = rules.filter(r => r.scope == "group" && r.target.groupId == group.id && r.enabled)
  if rules_group.length > 0: return rules_group.sort(by priority desc)[0].mode
  rules_type = rules.filter(r => r.scope == "type" && r.target.entityType == group.type && r.enabled)
  if rules_type.length > 0: return rules_type.sort(by priority desc)[0].mode
  rules_global = rules.filter(r => r.scope == "global" && r.enabled)
  if rules_global.length > 0: return rules_global.sort(by priority desc)[0].mode
  if group.replacementMode != default: return group.replacementMode  // editado manualmente
  return ReplacementMode.Placeholder
```

### `replacementValue` por modo

| Modo | replacementValue |
|---|---|
| `placeholder` | `[<TYPE_LABEL> <NN>]` con `NN = pad2(indexInType)` |
| `mask` | formato tipo-dependiente (ver `core/Contracts.md` §6 y `adr/ADR-012-Replacement-Modes.md`) |
| `synthetic` | sintetizador determinista por seed (delegado a `shared` o `export-engine` para pool faker) |
| `redact` | `""` |

El sintetizador está en `shared/synthesizer.ts` (exportado desde `@anonly/shared`) para que Grouping y Export usen la misma implementación.

---

## Referencias

- `architecture/06_Pipeline.md` §8, §9 (etapas 6 y 7)
- `architecture/03_Data_Model.md` §9 (EntityGroup), §13 (Rule), §15 (Conflict)
- `architecture/04_Event_System.md` §6, §10
- `adr/ADR-011-Grouping-First.md`
- `adr/ADR-012-Replacement-Modes.md`
- `adr/ADR-008-Immutability.md`
