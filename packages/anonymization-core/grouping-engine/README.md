# @anonly/grouping-engine

Agrupa las `Occurrence` emitidas por Regex y NER en `EntityGroup` por tipo y valor canónico (exacto, luego fuzzy Levenshtein). Detecta conflictos (`overlap`, `disagree`, `low_confidence`, `ambiguous_canonical`), resuelve `replacementMode`/`replacementValue` por `Rule[]` (group > type > global > manual > default) y expone los grupos a la UI de forma incremental.

> Hito 6 (`docs/roadmap/MVP.md` §4). Corre en el **main thread** (no en Worker; spec §12). Primer motor del Core que además de emitir eventos **consume** (`ENTITY_FOUND`, `REGEX_FINISHED`/`NER_FINISHED`, y los requests de UI del canal `ui`).

## Documentación

- **Spec canónico**: [`docs/core/Grouping_Engine.md`](../../../docs/core/Grouping_Engine.md)
- Contratos base: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md)
- Pipeline: [`docs/architecture/06_Pipeline.md`](../../../docs/architecture/06_Pipeline.md) §8-9 (etapas 6 y 7)
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md) §6, §10
- ADRs relevantes: [`ADR-011`](../../../docs/adr/ADR-011-Grouping-First.md) (grouping-first), [`ADR-012`](../../../docs/adr/ADR-012-Replacement-Modes.md) (modos de reemplazo), [`ADR-026`](../../../docs/adr/ADR-026-GroupingConfig-Canonical.md) (`GroupingConfig` canónico), [`ADR-028`](../../../docs/adr/ADR-028-IndexInType-Renumeracion-Canonica.md) (`indexInType` provisional + renumeración canónica en `finishSession`), [`ADR-029`](../../../docs/adr/ADR-029-Occurrence-MaskFormat-Plate-Variantes.md) (`Occurrence.maskFormat` + resolución de mask por grupo)

## Contenido

- `grouping.types.ts` — `GroupingEngineInput`, `GroupingEngineSnapshot` (`GroupingConfig` viene de `@anonly/shared`, ADR-026).
- `grouping.errors.ts` — `GroupingInvalidPatchError`, `GroupingGroupNotFoundError`.
- `levenshtein.ts` — Levenshtein propio (distancia + normalizado); sin dependencias externas de fuzzy matching (spec §5).
- `labels.ts` — `TYPE_LABEL_ES` (labels de `placeholder`), `MASK_FORMAT_BY_TYPE` (fallback de `mask` cuando ningún member trae `Occurrence.maskFormat`, ADR-029).
- `grouping.engine.ts` — clase `GroupingEngine` (implementa `IEngine`): `init`, `startSession`, `getSnapshot`, `finishSession`, `applyGroupUpdate`/`Merge`/`Split`, `applyRuleCreated`/`Updated`/`Deleted`, `applyConflictResolve`, `closeSession`, `dispose`.

## Reglas

- Nunca importa otro motor ni React (spec §5). Solo `@anonly/shared`; en `__tests__` sí puede importar `@anonly/event-system` directo (excepción P-2) para ejercitar la ruta de consumo de eventos con el bus real.
- `indexInType` tiene dos fases (ADR-028): **provisional** durante la sesión (orden de llegada de `ENTITY_FOUND`, no-determinístico entre corridas) y **renumeración canónica** una sola vez en `finishSession`, antes de `GROUPING_FINISHED`, por primera aparición documental (`pageIndex`, `bbox.y`, `bbox.x`). Tras eliminar un grupo el índice se saltea; tras fusionar, el sobreviviente conserva el menor; una división usa `nextIndex(type)`.
- `replacementValue` en modo `mask` se resuelve por grupo, no por tipo (ADR-029): si algún member trae `Occurrence.maskFormat` (lo puebla Regex desde el patrón que matcheó — NER nunca lo trae), gana el más frecuente entre los que lo llevan, empate por primera aparición documental; si ninguno lo trae, fallback a `MASK_FORMAT_BY_TYPE[type]`. Se recalcula en cualquier mutación que cambie la membresía del grupo (fusión, división) o su modo (edición manual, reglas, resolución de conflicto) — un solo punto de emisión de `GROUP_REPLACEMENT_CHANGED` (`emitReplacementChangeIfNeeded`) compara el valor antes/después y solo emite si cambió de verdad.
- Agregar una `Occurrence` a un grupo existente nunca toca `replacementMode`/`replacementValue` (spec §13 caso 17): la edición del usuario se preserva. `resolveMode`/recálculo de reemplazo solo corren al crear un grupo, al cambiar reglas, al editar explícitamente o al resolver un conflicto.
- Conflictos `overlap`/`disagree` se detectan por intersección de bbox (> 50% del área del rectángulo más chico, misma página, distinto `entityType`) contra ocurrencias ya agrupadas. `low_confidence` solo genera `CONFLICT_DETECTED` si existe un grupo candidato al que asociarlo (si no, se registra por `ctx.logger.warn`, spec §11 no define un error code para ese caso).
- `startSession`/`closeSession` no están atados a ningún evento del bus: los invoca directamente el caller (Orchestrator en Hito 9, o el test).

## Scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc para generar dist/
```
