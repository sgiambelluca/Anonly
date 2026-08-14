<!-- CONTEXT: scope=grouping-engine | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,ADR-011-Grouping-First.md,ADR-012-Replacement-Modes.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md | audiencia=IA-implementador | fase=3 (§13 caso 36 en fase 10.7: ocurrencia manual, ADR-061; §2/§6/§7/§13 actualizados en fase 10: reopenSession/dropOccurrences/dedup por identidad/finishSession re-ejecutable, ADR-038 §2-§4; fase 10.5: escalera de abreviaturas del placeholder + resolveLabelSet por grupo, ADR-057; fase 10.6: personGender e inferencia por léxico, ADR-060, y §8/§13 caso 32/34/37 + §14/§15 por fuente única, canal del usuario y disparo de la inferencia, ADR-069) -->

# Grouping Engine — Spec de Motor

> Agrupa las `Occurrence` emitidas por Regex y NER en `EntityGroup` por tipo y valor canónico. Detecta conflictos. Expone grupos a la UI (la unidad de operación). Resuelve reemplazos según `ReplacementMode` y `Rule`.

**EngineId**: `grouping`
**Versión del spec**: 1.4.0
**Última actualización**: 2026-08-14

> **Nota (v1.4.0, ADR-069, 2026-08-14 — el léxico de género: fuente única, cómo viaja y cómo lo fija el usuario)**: cierra las dos ambigüedades que el PR 11 reportó y un defecto que no reportó nadie. **(1) Fuente única**: el léxico se construye solo con el registro de Buenos Aires (9.788 nombres, 129 KB / 30 KB gz); UCI sale del alcance —aportaba 3 de 24 nombres extranjeros probados y las 130 entradas basura que hacían resolver las iniciales— y queda anotada como opción futura en `roadmap/Future_Ideas.md`. **(2) Viaja dentro del bundle** como módulo generado que el motor importa: sin `fetch`, sin config nueva, sin Cache Storage. **(3) Saneamiento con dos candados**: el build descarta claves con punto o dígito (preservando compuestos como `maria de la o`), y `inferPersonGender` **nunca consulta una clave de un solo token que mida un carácter o tenga punto** (`j`, `j.`, `j.m.`) — sin esto, "J. Pérez" imprimía `[HOMBRE 03]` contra la tabla real. **(4) `GroupUpdateRequested.patch` gana `personGender`** con el tercer estado como valor explícito `"neutral"` (el almacenamiento no cambia: `"neutral"` borra el campo). **(5) El motor recuerda que la elección la hizo el humano** (`personGenderUserSet`, interno) — sin ese flag, un "neutral" elegido a mano es indistinguible de "no inferido todavía" y la próxima inferencia lo pisa. **(6) La inferencia corre** al asignar/cambiar `canonicalValue` de un grupo `Person` y en `finishSession` antes de la renumeración canónica, nunca sobre un grupo con elección del humano. **(7) Los tests le preguntan a la tabla real**, no solo a léxicos sintéticos. Supersede ADR-060 §9 y §10. Ver §13 casos 32-34, §14 y §15.
>
> **Nota (v1.3.0, ADR-060, 2026-08-06 — reemplazo por género para `Person`)**: `EntityGroup` gana `personGender?: "f" | "m"` (`03_Data_Model.md` §9), que cambia el label resuelto del `placeholder` a `MUJER`/`HOMBRE`. **No es un `ReplacementMode` nuevo**: el modo sigue siendo `placeholder` y ni el selector de modo ni las `Rule` ni su resolución por prioridad se tocan. Resuelve el problema de que el texto anonimizado pierde su coherencia referencial —"[PERSONA 03] y [PERSONA 04] arreglaron para juntarse en la casa de ella" deja de ser interpretable—. El género se infiere de un léxico first-party sobre el `canonicalValue` (secuencia completa de nombres de pila primero, primer token después) y **ante cualquier duda no se decide**: nombre ausente, ambiguo ("Andrea", "Cruz") o iniciales → sin determinar, token neutro y marca en el árbol. Sin heurística de terminación: el costo de equivocarse es imprimirlo en un documento que va a manos de un tercero. El override del usuario gana siempre y es permanente. `indexInType` **no** se segmenta por género (§13 caso 35). Se apoya en la indirección `resolveLabelSet` que ADR-057 §3 dejó puesta; sin ella habría que reescribir la escalera. Ver §"Escalera de abreviaturas", §13 casos 32-35 y §14.
>
> **Nota (v1.2.0, ADR-057, 2026-08-06 — escalera de abreviaturas del `placeholder`)**: `[<TYPE> <NN>]` deja de ser el único formato y pasa a ser el **nivel 0** de una escalera de tres (`[PERSONA 01]` → `[PERS 01]` → `[PRS-01]`). El nivel se elige **por grupo** con la ocurrencia más apretada de `members[].bbox` y se aplica a **todas** las ocurrencias, para conservar el invariante de ADR-012 (mismo grupo → mismo `replacementValue`): abreviar por ocurrencia haría que el mismo dato apareciera con dos nombres distintos en el mismo documento. La medición es necesariamente una **estimación** (este motor no tiene canvas ni debe tenerlo, `estimateTokenWidth` en `Contracts.md` §6) y por eso la escalera es una optimización, no una garantía: quien garantiza que el texto no se derrame es el render (ADR-058 §1). `<NN>` no se abrevia nunca; `mask`/`synthetic`/`redact` no participan; la edición manual gana siempre. La resolución del label pasa de ser por **tipo** a ser por **grupo** (`resolveLabelSet`), indirección que ADR-060 necesita. Cierra además la ambigüedad que `labels.ts` documentaba desde su implementación: ADR-012 solo daba 4 ejemplos de los 13 tipos y la tabla completa queda ratificada acá. Ver §"Escalera de abreviaturas", §13 casos 27-31 y §14.

> **Nota (ADR-026, 2026-07-11)**: el tipo de config canónico es `GroupingConfig` (Contracts.md §6); el alias `GroupingEngineConfig` de §6/§15.2 queda eliminado (mismo patrón que ADR-021 §2 para OCR y ADR-023 §1 para NER).
>
> **Nota (ADR-028, 2026-07-11)**: `indexInType` es **provisional durante la sesión** (orden de llegada, `nextIndex = max + 1`) y se **renumera canónicamente una sola vez en `finishSession`** por orden de primera aparición documental, antes de emitir `GROUPING_FINISHED`. Resuelve la contradicción con `06_Pipeline.md` §8. Ver §Algoritmos y caso límite 21.
>
> **Nota (ADR-029, 2026-07-11)**: el formato del modo `mask` se resuelve por grupo desde `Occurrence.maskFormat` (campo nuevo que Regex puebla desde el patrón matcheado; caso Plate vieja vs Mercosur), con fallback a `MASK_FORMAT_BY_TYPE[type]`. Ver §`replacementValue` por modo y caso límite 22.
>
> **Nota (ADR-034, 2026-07-16)**: quién invoca la sesión — `startSession(documentId)` lo llama el **Orchestrator** al iniciar la etapa de detección (antes de despachar Regex/NER). `finishSession` se dispara solo (auto-finish al recibir `REGEX_FINISHED` + `NER_FINISHED`) o lo invoca el Orchestrator tras `REGEX_FINISHED` cuando `config.ner.enabled === false` (sin ese wiring, con NER off la sesión no cerraría nunca). `finishSession` es defensivo ante sesión inexistente/ya finalizada (warn + no-op). Sin cambios de firma ni de comportamiento del motor.
>
> **Nota (ADR-038, 2026-07-17)**: soporte de re-análisis parcial (`Orchestrator.reanalyze`, `core/Orchestrator.md` §2/§6/§13.18-§13.22) sin perder ediciones del usuario. Tres piezas nuevas: `reopenSession` (reabre una sesión existente —grupos, reglas, conflictos y ediciones intactos— para una segunda pasada de detección, en vez de crear una sesión nueva); `dropOccurrences` (elimina selectivamente ocurrencias que dejaron de ser válidas, p. ej. las NER al desactivar NER); y un invariante permanente de **dedup por identidad** en el manejo de `ENTITY_FOUND` que hace real la idempotencia declarada en `04_Event_System.md` §5 (una ocurrencia con la misma identidad `(entityType, pageIndex, bbox, normalizedValue)` que ya está en la sesión se descarta en silencio). `finishSession` pasa a ser **re-ejecutable**: tras un `reopenSession`, el próximo cierre vuelve a correr la renumeración canónica de ADR-028 sobre la unión de ocurrencias. Ver §6, §13.23-§13.26.

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
- Renumerar `indexInType` canónicamente en `finishSession` (por orden de primera aparición documental) antes de emitir `GROUPING_FINISHED`, recalculando `replacementValue` de los grupos en modo `placeholder` afectados (ADR-028). `finishSession` es re-ejecutable: tras un `reopenSession`, vuelve a renumerar sobre la unión de ocurrencias (ADR-038 §2).
- Reabrir una sesión existente (`reopenSession`) para una segunda pasada de detección sin perder grupos, reglas, conflictos ni ediciones (ADR-038 §2).
- Eliminar selectivamente ocurrencias que dejaron de ser válidas (`dropOccurrences`), recalculando o eliminando los grupos afectados según corresponda (ADR-038 §2).
- Descartar en silencio, como invariante permanente, cualquier `ENTITY_FOUND` cuya identidad `(entityType, pageIndex, bbox, normalizedValue)` ya esté registrada en la sesión (dedup real de la idempotencia de `04_Event_System.md` §5, ADR-038 §3).

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
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Occurrence`, `OccurrenceRef`, `EntityGroup`, `EntityType`, `ReplacementMode`, `Rule`, `Conflict`, `ConflictReason`, `Annotation`, `GroupingConfig`, `PersonGender` (ADR-060 §2)
- De `@anonly/shared`: `estimateTokenWidth` y sus constantes `REPLACEMENT_FONT_HEIGHT_RATIO`/`AVG_GLYPH_ADVANCE_RATIO` (`Contracts.md` §6, ADR-057 §5). **Este motor no tiene canvas ni debe tenerlo**: no puede medir texto, así que la selección de nivel usa esta estimación pura. La comparte con `render-engine` a través de `shared` porque P-1 impide que un motor importe a otro — y **no se duplica**.
- `architecture/04_Event_System.md`: todos los eventos de grouping + UI inputs
- Sin dependencias externas nuevas: usa algoritmos propios (Levenshtein). El léxico de nombres de ADR-060 §9 son **datos commiteados en el repo**, no un paquete de npm — pero su procedencia y licencia son un R-12 que hay que cerrar antes de escribir el PR 10.

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
// GroupingConfig es el tipo canónico de Contracts.md §6 (re-exportado por @anonly/shared);
// se reproduce aquí solo para documentar sus defaults (ADR-026).
export interface GroupingConfig {
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

// ADR-038 §2: re-análisis parcial preservando ediciones.
export interface ReopenSessionOptions {
  readonly expectRegex: boolean;  // la pasada re-correrá Regex (esperar REGEX_FINISHED)
  readonly expectNer: boolean;    // la pasada re-correrá NER (esperar NER_FINISHED)
}

export interface DropOccurrencesFilter {
  readonly source?: DetectionSource;
  readonly pageIndices?: ReadonlyArray<number>;
  // Al menos un campo; ambos presentes = AND.
}

export class GroupingEngine implements IEngine {
  readonly id = EngineId.Grouping;
  init(ctx: EngineContext): Promise<void>;
  startSession(documentId: string): void;
  getSnapshot(documentId: string): GroupingEngineSnapshot;
  finishSession(documentId: string): Promise<void>;  // emite GROUPING_FINISHED; re-ejecutable (ADR-038 §2)
  // Reabre una sesión existente (grupos/reglas/conflictos/ediciones intactos) para
  // una segunda pasada de detección. Sesión inexistente → warn + no-op (ADR-038 §2).
  reopenSession(documentId: string, options: ReopenSessionOptions): void;
  // Elimina del registro de sesión las ocurrencias que matchean el filtro y sus
  // members de los grupos; recalcula/elimina grupos afectados (ADR-038 §2).
  // Filtro sin campos → InvalidInputError; sesión inexistente → warn + no-op.
  dropOccurrences(documentId: string, filter: DropOccurrencesFilter): void;
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
| `ENTITY_GROUP_REMOVED` | al eliminar un grupo (fusión, cierre, o `dropOccurrences` que deja un grupo sin members) | `EntityGroupRemoved` | async | sí |
| `GROUP_REPLACEMENT_CHANGED` | cuando `replacementMode` o `replacementValue` cambian | `GroupReplacementChanged` | async | sí |
| `GROUP_TOGGLED` | cuando `enabled` cambia | `GroupToggled` | async | sí |
| `CONFLICT_DETECTED` | al detectar un conflicto | `ConflictDetected` | async | sí |
| `CONFLICT_RESOLVED` | al resolver un conflicto (auto o manual) | `ConflictResolved` | async | sí |
| `GROUPING_FINISHED` | cuando Regex + NER terminaron y no hay más `ENTITY_FOUND` pendientes; puede repetirse tras un `reopenSession` (ADR-038 §2) | `GroupingFinished` | async | sí |

Canal: `EventChannel.Grouping`.

---

## 8. Eventos que consume

| Evento | Cuándo | Acción |
|---|---|---|
| `ENTITY_FOUND` (canales `regex` y `ner`) | cada ocurrencia detectada | si su identidad `(entityType, pageIndex, bbox, normalizedValue)` ya está registrada en la sesión, descartar en silencio (dedup, ADR-038 §3); si no, agregar a grupo existente o crear nuevo; emitir `ENTITY_GROUP_CREATED` o `ENTITY_GROUP_UPDATED` |
| `REGEX_FINISHED` (canal `regex`) | Regex terminó | marcar regex done |
| `NER_FINISHED` (canal `ner`) | NER terminó | marcar ner done; si ambos done, emitir `GROUPING_FINISHED` |
| `GROUP_UPDATE_REQUESTED` (canal `ui`) | usuario edita grupo | `applyGroupUpdate`. Con `patch.personGender` (ADR-069 §4): `"f"`/`"m"` escriben el campo, `"neutral"` lo borra, y en los tres casos se marca la elección como del humano para que ninguna inferencia posterior la pise (§13 caso 34). Sobre un grupo de `type` distinto de `Person`, se ignora con `warn` |
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
21. **Renumeración canónica en `finishSession` (ADR-028)**: llegan ocurrencias fuera de orden documental (NER procesa por prioridad visible). Los índices provisionales reflejan el orden de llegada; al cerrar, la renumeración deja "Persona 1" como la primera del documento (`pageIndex`/`bbox.y`/`bbox.x`), emite `ENTITY_GROUP_UPDATED` por cada índice que cambió y recalcula el `replacementValue` de los placeholders afectados. Las ediciones del usuario hechas durante la sesión (caso 17) se preservan; solo puede cambiar el número.
22. **Máscara por variante de patente (ADR-029)**: un grupo `Plate` cuyos members llevan `maskFormat: "XXX XXX"` (patente vieja `ABC 123`) enmascara `XXX XXX`; uno Mercosur (`AB 123 CD`, `maskFormat: "XX XXX XX"`) enmascara `XX XXX XX`. Grupo mixto (solo posible por fusión manual): gana el `maskFormat` más frecuente; empate → el del member con primera aparición documental. Sin `maskFormat` en ningún member: fallback `MASK_FORMAT_BY_TYPE[type]`.
23. **Dedup por identidad (ADR-038 §3)**: llega un `ENTITY_FOUND` cuya `(entityType, pageIndex, bbox, normalizedValue)` ya está registrada en la sesión (p. ej. una re-pasada de Regex tras `reopenSession`) → se descarta en silencio (`logger.debug`, sin eventos, sin tocar frecuencias ni `aliases`). No es exclusivo de sesiones reabiertas: es un invariante siempre activo.
24. **`reopenSession` sobre grupos editados**: se reabre la sesión con `dropOccurrences({ source: DetectionSource.NER })` previo (desactivar NER) → los grupos cuyos únicos members eran NER se eliminan (`members.length ≥ 1`, `03_Data_Model.md` §9) aunque el usuario los haya editado; los grupos con members Regex restantes conservan sus ediciones intactas (ADR-038 §5.2, Q1 de ADR-038).
25. **`dropOccurrences` por `pageIndices`** (re-OCR de páginas, ADR-038 §5.3): se eliminan todas las ocurrencias (Regex y NER) de esas páginas, incluidas las que un usuario ya fusionó o cuyo grupo editó; grupos que quedan sin members se eliminan con `ENTITY_GROUP_REMOVED`; conflictos cuyo grupo o candidatos referencian ocurrencias eliminadas se descartan con `CONFLICT_RESOLVED` (mode = el modo efectivo del grupo antes de eliminarlo). No renumera `indexInType`: eso ocurre en el próximo `finishSession`. `dropOccurrences` con filtro sin campos → `InvalidInputError`; sesión inexistente → warn + no-op.
26. **`finishSession` re-ejecutado tras `reopenSession`**: la renumeración canónica corre de nuevo sobre la unión de ocurrencias vigentes; el resultado final es indistinguible de una corrida fresca con la config final más las ediciones del usuario (mismo invariante de determinismo de ADR-028, extendido a múltiples pasadas). Los índices de placeholder pueden correrse respecto de lo que el usuario ya vio (aceptado, ADR-038 §5, Q2).
27. **Grupo con una sola ocurrencia apretada (ADR-057 §4)**: un grupo con 40 apariciones holgadas y una sobre un bbox angosto baja al nivel que entra en **esa**, y el token corto se aplica a las 41. Es deliberado: elegir por ocurrencia rompería el invariante de que todas las `Replacement` de un grupo comparten valor.
28. **Ni el nivel 2 entra (ADR-057 §4)**: el grupo se queda en nivel 2 sin error ni warning. Grouping no tiene otra carta; el shrink-to-fit del render (ADR-058 §1) es quien garantiza que no se derrame.
29. **Tipos con niveles degenerados (ADR-057 §2)**: `DNI`, `CUIT` e `IBAN` tienen niveles 0 y 1 idénticos, y `MUJER` tiene 0 y 1 idénticos. La selección devuelve el primero que entra, así que los niveles repetidos se saltean solos — no hay rama especial ni error por la igualdad.
30. **`replacementValue` editado a mano frente a la escalera (ADR-057 §7)**: el usuario escribe `[P1]` para un grupo; la selección de nivel no lo toca, ni en ese momento ni en un `finishSession` posterior. Misma precedencia que ADR-028 le da a las ediciones frente a la renumeración.
31. **Re-análisis que cambia el nivel (ADR-057 §7)**: tras `reopenSession` + `finishSession`, un member nuevo más angosto puede bajar el nivel del grupo y cambiar su token respecto de lo que el usuario ya vio. Aceptado por el mismo criterio que el corrimiento de `indexInType` (caso 26): el estado post-`finishSession` es el canónico.
32. **Género inferido, ambiguo y sin determinar (ADR-060 §4, ADR-069 §1/§3)**: `"Julia Gomez"` → `personGender: "f"` → `[MUJER 03]`. Caen a **sin determinar** —token neutro `[PERSONA 03]` y marca en el árbol— cuatro situaciones distintas: nombre marcado `A` en el registro (`ANDREA`, `MARIA`, `TRINIDAD`, `ROSARIO`), nombre ausente del registro (`KATARZYNA`), **iniciales** (`"J. Pérez"`, `"J.M. Pérez"`) y un `canonicalValue` sin ningún token utilizable. Nunca se elige un género dudoso: el error se imprimiría en un documento que va a manos de un tercero.
    **Las iniciales están cortadas dos veces** (ADR-069 §3): el build no deja entrar claves con punto o dígito, y `inferPersonGender` no consulta una clave de un solo token que mida un carácter o contenga un punto. La redundancia es deliberada — con una sola fuente de verdad, un artefacto regenerado con otro criterio volvería a imprimir `[HOMBRE 03]` sobre `"J. Pérez"`, que es exactamente lo que pasó en el PR 11.
    **El registro local es autoritativo** y por eso `"Joan"` resuelve `m` (Joan Manuel Serrat) aunque en datos anglosajones sea abrumadoramente femenino. **`"Andrea"` no resuelve `f`**: el registro la declara `A`. *(Este caso decía lo contrario hasta ADR-069 §8; el ejemplo estaba escrito de memoria y no contra el CSV.)*
33. **Orden de resolución del nombre de pila (ADR-060 §4)**: "José María Gómez" → `m` y "María José Gómez" → `f`. Se busca primero la secuencia completa de nombres de pila y recién después el primer token solo; si los tokens conocidos discrepan, sin determinar.
34. **`personGender` puesto por el usuario (ADR-060 §4, ADR-069 §4/§5)**: llega por `GROUP_UPDATE_REQUESTED` con `patch.personGender` ∈ `"f" | "m" | "neutral"`. Gana sobre cualquier inferencia y sobrevive a `finishSession`, a `reopenSession`, a una re-inferencia posterior y a una fusión (el grupo que sobrevive conserva su elección). Sobre un grupo de `type` distinto de `Person`, se ignora con `warn` y no altera el `replacementValue`.
    **`"neutral"` es una elección, no una ausencia**: borra `personGender` —el grupo vuelve a `[PERSONA 03]`— pero queda registrado que lo decidió el humano. Sin esa distinción, un "neutral" elegido a mano sería indistinguible de un grupo todavía no inferido y la próxima pasada lo pisaría con `[MUJER 03]`. El registro es interno (`personGenderUserSet`), no viaja en `EntityGroup` ni en ningún evento, y se limpia con la sesión en `closeSession`.
35. **Secuencia única de `Person` con género (ADR-060 §7)**: `[MUJER 03]` y `[HOMBRE 04]` son la tercera y la cuarta persona del documento. No se abren secuencias por género — coexistirían `[MUJER 01]` y `[HOMBRE 01]`, rompiendo la unicidad de `indexInType` que `08_Security_Model.md` §9 exige.
36. **Ocurrencia manual sobre un grupo existente (ADR-061 §6)**: llega un `ENTITY_FOUND` con `source: DetectionSource.Manual` cuyo valor ya tiene grupo. No hay camino nuevo: el matching de siempre lo suma como member, y si la identidad `(entityType, pageIndex, bbox, normalizedValue)` ya estaba, el dedup de ADR-038 §3 la descarta en silencio. **Es lo que hace segura la repetición**: agregar dos veces el mismo valor, o uno que el detector ya había encontrado, es idempotente sin escribir nada para eso.
37. **Cuándo corre la inferencia de género (ADR-069 §6)**: en dos puntos, y nunca sobre un grupo con elección del humano. **(a)** Al asignar o cambiar el `canonicalValue` de un grupo `Person` — creación, fusión, y edición manual de `patch.canonicalValue` (caso 18). **(b)** En `finishSession`, sobre todos los grupos `Person` sin elección del humano, **antes** de `renumberGroupsCanonically`: es la red que garantiza convergencia, y la que hace que los tokens no parpadeen durante la detección, porque `[PERSONA 03]` → `[MUJER 03]` ocurre en el mismo cierre en que ADR-028 ya podía correr los índices (caso 21). Idempotente: misma tabla + mismo `canonicalValue` ⇒ mismo resultado. Un género que cambia recalcula `replacementValue` y emite `ENTITY_GROUP_UPDATED` + `GROUP_REPLACEMENT_CHANGED`, como cualquier otra mutación de grupo.

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
| `final indexInType deterministic regardless of event arrival order` | `contract.test.ts` | contract | invariante ADR-028 |
| `mask uses occurrence maskFormat over type fallback` | `unit.test.ts` | unit | caso 22 (ADR-029) |
| `mixed maskFormat group resolves by frequency then document order` | `edge.test.ts` | edge | caso 22 (ADR-029) |
| `canonical renumbering at finishSession emits updates and recomputes placeholders` | `edge.test.ts` | edge | caso 21 |
| `cancel between ENTITY_FOUND within 50ms` | `cancel.test.ts` | cancel | SLA |
| `snapshot of groups for text-10p.pdf stable` | `snapshot.test.ts` | snapshot | fixture |
| `duplicate ENTITY_FOUND with same identity is dropped silently` | `edge.test.ts` | edge | caso 23 (ADR-038 §3) |
| `reopenSession preserves existing groups/rules/edits` | `contract.test.ts` | contract | ADR-038 §2 |
| `dropOccurrences by source removes NER-only groups, keeps edited Regex groups` | `edge.test.ts` | edge | caso 24 (ADR-038 §5.2) |
| `dropOccurrences by pageIndices discards stale conflicts` | `edge.test.ts` | edge | caso 25 (ADR-038 §5.3) |
| `dropOccurrences with empty filter throws InvalidInputError` | `edge.test.ts` | edge | caso 25 |
| `finishSession re-run after reopenSession renumbers over union of occurrences` | `contract.test.ts` | contract | caso 26 (ADR-028 extendido) |
| `all three abbreviation levels respect their format for the 13 entity types` | `contract.test.ts` | contract | ADR-057 §1-§2 |
| `all members of a group share the same replacementValue` | `contract.test.ts` | contract | invariante ADR-012, re-asertado por ADR-057 §4 |
| `group with only wide bboxes stays at level 0 (no behaviour change)` | `unit.test.ts` | unit | ADR-057 §4 — **no-regresión**: donde no había problema, el token no cambia |
| `one narrow member lowers the level for the whole group` | `unit.test.ts` | unit | caso 27 (ADR-057 §4) |
| `group where not even level 2 fits stays at level 2 without error` | `edge.test.ts` | edge | caso 28 (ADR-057 §4) |
| `degenerate levels (DNI/CUIT/IBAN) produce expected tokens` | `edge.test.ts` | edge | caso 29 (ADR-057 §2) |
| `hand-edited replacementValue survives finishSession and level selection` | `edge.test.ts` | edge | caso 30 (ADR-057 §7) |
| `mask/synthetic/redact values unchanged by the abbreviation ladder` | `edge.test.ts` | edge | ADR-057 §6 |
| `reopenSession + finishSession with a narrower member changes the level` | `edge.test.ts` | edge | caso 31 (ADR-057 §7) |
| `unambiguously feminine/masculine name infers personGender` | `unit.test.ts` | unit | caso 32 (ADR-060 §4) |
| `"José María" → m and "María José" → f` | `unit.test.ts` | unit | caso 33 (ADR-060 §4) — protege el orden de los pasos |
| `name absent from lexicon, unisex name ("A") and initials → undetermined + neutral token` | `unit.test.ts` | unit | caso 32 (ADR-060 §4/§5) |
| `initials are never looked up: "J. Pérez" and "J.M. Pérez" against the REAL table` | `unit.test.ts` | unit | caso 32 (ADR-069 §3/§7) — el que encuentra el defecto del PR 11 |
| `"Andrea" is undetermined and "Joan" is m, against the REAL table` | `unit.test.ts` | unit | caso 32 (ADR-069 §1/§7) — el registro local manda, y `A` no se resuelve |
| `"José María"/"María José" resolve against the REAL table` | `unit.test.ts` | unit | caso 33 (ADR-069 §7) — el orden de los pasos, sobre datos reales |
| `user-set personGender survives finishSession, reopenSession, re-inference and merge` | `edge.test.ts` | edge | caso 34 (ADR-060 §4, ADR-069 §5) |
| `user-set "neutral" is not overwritten by a later inference` | `edge.test.ts` | edge | caso 34 (ADR-069 §4/§5) — sin el flag interno, este test se cae |
| `inference runs on canonicalValue change and at finishSession, never over a user choice` | `edge.test.ts` | edge | caso 37 (ADR-069 §6) |
| `personGender on a non-Person group does not alter replacementValue` | `edge.test.ts` | edge | caso 34 (ADR-060 §2) |
| `gendered groups keep the single Person indexInType sequence` | `edge.test.ts` | edge | caso 35 (ADR-060 §7) |
| `gendered labels use the same ladder, no extra branches` | `edge.test.ts` | edge | ADR-060 §3 |

Fixtures: `tests/fixtures/text-10p.pdf` con entidades conocidas que generan grupos predecibles.

> **Regla de tests del léxico (ADR-069 §7)**: las tablas sintéticas armadas a mano siguen siendo válidas para probar el **orden de los pasos** de la inferencia (ADR-060 §4), donde la tabla es el fixture del algoritmo. Pero **todo enunciado sobre qué contesta el léxico** —iniciales, ambiguos, compuestos, un nombre que resuelve `f`— exige un test contra el **artefacto commiteado**, que es el único que corre en producción. La lista original de esta sección se cubría entera con léxicos de dos entradas inventados por test, y por eso el PR 11 pasó todos los gates mientras `"J. Pérez"` resolvía masculino contra la tabla real. Corolario para los docs: ningún ejemplo con nombre propio entra a un spec o a un ADR sin verificarse antes contra la fuente.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/grouping-engine/`.
- [ ] 2. Definir `types.ts` con `GroupingEngineInput`, `GroupingEngineSnapshot` (`GroupingConfig` viene de `@anonly/shared`/Contracts.md §6; ADR-026).
- [ ] 3. Definir `errors.ts` con `GroupingInvalidPatchError`, `GroupingGroupNotFoundError`.
- [ ] 4. Implementar `grouping.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. Implementar `init` (suscribirse a `ENTITY_FOUND` en `regex` y `ner`, a `REGEX_FINISHED`/`NER_FINISHED`, a eventos de UI en `ui`).
- [ ] 6. Implementar `startSession`/`closeSession` (gestión de estado por `documentId`).
- [ ] 7. Implementar algoritmo de matching: exacto por `normalizedValue`, luego fuzzy Levenshtein normalizado con umbral `similarityThreshold`.
- [ ] 8. Implementar asignación de `indexInType` secuencial y estable (no reasigna tras eliminación).
- [ ] 8b. Implementar la renumeración canónica de `indexInType` en `finishSession` (orden documental, `ENTITY_GROUP_UPDATED` por índice cambiado, recálculo de placeholders; ADR-028, §Algoritmos).
- [ ] 9. Implementar cálculo de `canonicalValue` (alias más frecuente, en empate el más largo).
- [ ] 10. Implementar detección de conflictos (`overlap`, `disagree`, `low_confidence`, `ambiguous_canonical`).
- [ ] 11. Implementar resolución default automática de conflictos (ver §13 de `06_Pipeline.md`).
- [ ] 12. Implementar resolución de `replacementMode` por `Rule[]` en orden group > type > global > manual > default.
- [ ] 13. Implementar `applyGroupUpdate`/`Merge`/`Split`/`RuleCreated`/`Updated`/`Deleted`/`ConflictResolve`.
- [ ] 14. Implementar `getSnapshot` (copia defensiva).
- [ ] 15. Implementar `dispose` (dessuscribir todos los handlers del bus).
- [ ] 15b. Implementar `reopenSession`/`dropOccurrences` y el dedup por identidad en el handler de `ENTITY_FOUND`; hacer `finishSession` re-ejecutable sobre la unión de ocurrencias (ADR-038 §2-§4, casos 23-26).
- [ ] 15c. (Hito 10.5, PR 3 — ADR-057) Tablas de los tres niveles en `labels.ts`; reemplazar el acceso directo a `TYPE_LABEL_ES` por `resolveLabelSet(group)`; selección de nivel por peor caso de `members[].bbox` con `estimateTokenWidth` de `@anonly/shared`, enganchada en `computeReplacementValue` sin agregar disparadores nuevos. La edición manual del usuario no se toca. Casos 27-31 en §13.
- [x] 15d. (Hito 10.6, PR 11b — ADR-060) `personGender` en la resolución de `resolveLabelSet`; inferencia por secuencia de nombres de pila y luego primer token, con caída a "sin determinar" ante ausencia o ambigüedad. Sin heurística de terminación. Casos 32-35 en §13. **Hecho en el PR 11**; lo que falta de género está en 15f-15h.
- [ ] 15e. (Hito 10.6, PR 11b — ADR-069 §1-§3, supersede la versión ADR-060 §9-§11 de este ítem) Script de build determinista sobre **una sola fuente**: Buenos Aires Data, recurso "Nombres Permitidos" (CC-BY-2.5-AR), que declara `F`/`M`/`A` por nombre — la `A` cae a "sin determinar". Emite un **módulo TypeScript generado** con la tabla `nombre → f | m | ambiguo` (9.788 entradas, 129 KB / 30 KB gz) que el motor **importa**: no hay carga a demanda, ni Cache Storage, ni URL configurable, ni copia a `public/`. **Saneamiento en el build**: se descartan las claves con punto o dígito (8 abreviaturas del registro), **preservando los compuestos** (`maria de la o`, `ana de las ermitas`). **Los CSV originales no entran al repo; el artefacto sí.** **Precondición que no es un detalle**: atribución CC-BY-2.5-AR visible en el producto (PR 12), más procedencia y hash auditables al estilo ADR-018 — y **retirar la atribución de UCI** al retirarse el dato.
- [ ] 15f. (Hito 10.6, PR 11a — ADR-069 §4) En `shared`: `PersonGenderChoice = PersonGender | "neutral"` y `personGender?: PersonGenderChoice` en `GroupUpdateRequested.patch` (`Contracts.md` §8, `04_Event_System.md` §10). Cambio de contrato: va en su propio PR, antes del motor y antes del PR 12.
- [ ] 15g. (Hito 10.6, PR 11c — ADR-069 §3/§5/§6) Guard de iniciales en `inferPersonGender` (una clave de un solo token que mida un carácter o contenga un punto no se consulta); `personGenderUserSet` interno en `InternalGroup` con su ciclo de vida (fusión incluida); `applyGroupUpdate` acepta `patch.personGender` con `"neutral"` borrando el campo, y lo ignora con `warn` fuera de `Person`; disparo de la inferencia en los dos puntos del caso 37.
- [ ] 15h. (Hito 10.6, PR 11c — ADR-069 §7) Tests contra el **artefacto commiteado**, no solo contra léxicos sintéticos: iniciales, `A`, compuestos y el par `Joan`/`Andrea`. Ver la regla al pie de §14.
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
// Fase incremental (durante la sesión) — índices PROVISIONALES (ADR-028):
nextIndex(type) = (max indexInType entre grupos del tipo) + 1
si no hay grupos del tipo, nextIndex = 1

// Renumeración canónica (una sola vez, en finishSession, antes de GROUPING_FINISHED):
para cada entityType:
  firstPos(g) = min sobre g.members de (pageIndex, bbox.y, bbox.x)  // lexicográfico
  ordenar grupos por firstPos asc; empate: normalizedValue asc
  asignar indexInType = 1..N contiguo
  por cada grupo cuyo índice cambió:
    emitir ENTITY_GROUP_UPDATED (changes incluye "indexInType")
    si mode = placeholder: recalcular replacementValue, emitir GROUP_REPLACEMENT_CHANGED

// Después de la renumeración (estabilidad, sin cambios):
tras eliminar grupo: el índice se saltea (no se reasigna)
tras fusionar A en B: B conserva min(A.index, B.index); A se elimina
tras dividir: el grupo nuevo recibe nextIndex(type)

// Invariante (ADR-028): mismo conjunto de Occurrence ⇒ mismos índices finales,
// sin importar el orden de llegada de los ENTITY_FOUND.
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
| `placeholder` | `[<LABEL> <NN>]` con `NN = pad2(indexInType)`, en uno de **tres niveles de abreviatura** elegidos por grupo (ADR-057; ver el bloque siguiente) |
| `mask` | resolución por grupo (ADR-029): si algún member lleva `Occurrence.maskFormat`, el más frecuente entre los que lo llevan (empate → el del member con primera aparición documental, mismo orden que ADR-028); si ninguno, fallback `MASK_FORMAT_BY_TYPE[type]` (ADR-012; `Plate` → `XX XXX XX` Mercosur) |
| `synthetic` | sintetizador determinista por seed (delegado a `shared` o `export-engine` para pool faker) |
| `redact` | `""` |

El sintetizador está en `shared/synthesizer.ts` (exportado desde `@anonly/shared`) para que Grouping y Export usen la misma implementación.

### Escalera de abreviaturas del `placeholder` (ADR-057)

Tres niveles, por longitud decreciente. El nivel 2 además colapsa el separador (espacio → guion):

```
nivel 0:  [<LABEL> <NN>]     [PERSONA 01]
nivel 1:  [<ABREV> <NN>]     [PERS 01]
nivel 2:  [<CORTO>-<NN>]     [PRS-01]
```

Tabla canónica por `EntityType` — ratifica y completa ADR-012 §"Formato para `placeholder`", que solo daba 4 ejemplos de los 13 tipos (la ambigüedad que `labels.ts` arrastraba documentada desde su implementación queda cerrada acá):

| `EntityType` | Nivel 0 | Nivel 1 | Nivel 2 |
|---|---|---|---|
| `Person` | `PERSONA` | `PERS` | `PRS` |
| `Organization` | `ORGANIZACION` | `ORGA` | `ORG` |
| `Address` | `DIRECCION` | `DIRE` | `DIR` |
| `DNI` | `DNI` | `DNI` | `DNI` |
| `CUIT` | `CUIT` | `CUIT` | `CUIT` |
| `Phone` | `TELEFONO` | `TELE` | `TEL` |
| `Email` | `EMAIL` | `MAIL` | `EML` |
| `IBAN` | `IBAN` | `IBAN` | `IBAN` |
| `CreditCard` | `TARJETA` | `TARJ` | `TRJ` |
| `Date` | `FECHA` | `FECH` | `FEC` |
| `License` | `MATRICULA` | `MATR` | `MAT` |
| `Plate` | `PATENTE` | `PATE` | `PAT` |
| `Custom` | `CUSTOM` | `CUST` | `CST` |
| `Person` + `personGender: "f"` (ADR-060 §3) | `MUJER` | `MUJER` | `MUJ` |
| `Person` + `personGender: "m"` (ADR-060 §3) | `HOMBRE` | `HOMB` | `HOM` |

**Las columnas repetidas son correctas, no un descuido.** Para `DNI`, `CUIT` e `IBAN` el label ya es una sigla y acortarla más produce tokens ilegibles a cambio de un carácter; para `MUJER` pasa lo mismo con el nivel 1. La selección elige el primero que entra, así que los niveles degenerados se saltean solos, sin ninguna rama especial.

**Selección del nivel** (ADR-057 §4):

```
nivelElegido(group) =
  el primer nivel L ∈ [0, 1, 2] tal que, para TODOS los members del grupo,
  estimateTokenWidth(len(tokenDeNivel_L), member.bbox.height) ≤ member.bbox.width;
  si ninguno cumple, nivel 2.
```

Reglas que la gobiernan:

- **Se elige por el peor caso y se aplica a todo el grupo.** Un grupo con 40 apariciones holgadas y una apretada baja de nivel entero. La alternativa —abreviar por ocurrencia— rompe el invariante de ADR-012 (todas las `Replacement` de un grupo comparten valor) y, peor, haría que el mismo dato apareciera con dos nombres distintos en el mismo documento.
- **`<NN>` no se abrevia nunca.** Es lo único que distingue dos entidades del mismo tipo.
- **El nivel 2 no garantiza que entre.** Si ni `[PRS-01]` cabe, el grupo se queda en nivel 2; quien resuelve es el render (ADR-058 §1, shrink-to-fit con `measureText` real). Esta escalera es una **optimización**, no la garantía.
- **Es una estimación, y no puede ser otra cosa**: este motor no tiene canvas ni debe tenerlo. `estimateTokenWidth` y sus constantes viven en `@anonly/shared` (`Contracts.md` §6) y las comparten Grouping y Render sin duplicarlas (P-1 impide que un motor importe a otro; los dos pueden importar `shared`).
- **Invariante a la escala**: el criterio compara dos magnitudes del mismo bbox, así que el nivel elegido no depende del zoom al que se renderice después.
- **Se recalcula donde ya se recalculaba `replacementValue`** — sin disparadores nuevos —, incluida la renumeración canónica de `finishSession` (ADR-028).
- **La edición manual gana siempre**: un `replacementValue` escrito por el usuario (caso 17) no lo toca la escalera, ni en ese momento ni en un `finishSession` posterior.
- **`mask`, `synthetic` y `redact` no participan** (ADR-057 §6): el formato de `mask` *es* la información que transmite, un `synthetic` abreviado deja de ser plausible y `redact` no tiene texto.

**La resolución del label es por grupo, no por tipo** (ADR-057 §3). El acceso directo a `TYPE_LABEL_ES` se reemplaza por `resolveLabelSet(group)`, que hoy es un lookup por `group.type` y desde ADR-060 considera además `personGender`. La indirección existe para eso: sin ella, el género obligaría a reescribir la escalera entera.

---

## Referencias

- `architecture/06_Pipeline.md` §8, §9 (etapas 6 y 7)
- `architecture/03_Data_Model.md` §9 (EntityGroup), §13 (Rule), §15 (Conflict)
- `architecture/04_Event_System.md` §6, §10
- `adr/ADR-011-Grouping-First.md`
- `adr/ADR-012-Replacement-Modes.md`
- `adr/ADR-008-Immutability.md`
- `adr/ADR-028-IndexInType-Renumeracion-Canonica.md` (renumeración canónica, extendida a re-análisis)
- `adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` (`reopenSession`/`dropOccurrences`/dedup, decisiones de la v1.1.0)
- `core/Orchestrator.md` §2, §6, §13.18-§13.22 (`reanalyze`, quién invoca estos métodos)
