<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md | audiencia=humanos+IA | fase=6 -->

# ADR-026 — Grouping: `GroupingConfig` es el nombre canónico (se elimina el alias `GroupingEngineConfig`)

- **Estado**: Accepted
- **Fecha**: 2026-07-11
- **Decidido por**: Repaso de ambigüedades previo al Hito 6 (planificador)
- **Relacionado con**: ADR-021 §2 (mismo defecto en OCR), ADR-023 §1 (mismo defecto en NER)
- **Complementado por**: ADR-027 (resuelve los casos restantes de Render y Export; la revisión pendiente anotada en §Consecuencias queda cerrada)

## Contexto

Tercer caso del mismo defecto de spec: `core/Contracts.md` §6 define `GroupingConfig`
(`similarityThreshold`, `minAliasFrequency`) y `Grouping_Engine.md` §4 lo cita como dependencia
permitida, pero el propio spec §6 y su checklist §15.2 definían `GroupingEngineConfig` con **los
mismos dos campos idénticos**, como si fuera un tipo nuevo. Precedentes exactos: ADR-021 §2
(`OcrConfig` vs `OcrEngineConfig`) y ADR-023 §1 (`NerConfig` vs `NerEngineConfig`).

## Decisión

`GroupingConfig` (de `core/Contracts.md` §6, re-exportado por `@anonly/shared`) es el único nombre
canónico. El alias `GroupingEngineConfig` se **elimina** de `Grouping_Engine.md` §6 y §15.2. Los
campos ya eran idénticos: rename puro, sin migración de forma. Los defaults
(`similarityThreshold: 0.88`, `minAliasFrequency: 1`) viven en las constantes de defaults
(`GROUPING_SIMILARITY_THRESHOLD`, Contracts.md §7), no en el tipo.

Los tipos genuinamente propios del motor (`GroupingEngineInput`, `GroupingEngineSnapshot`) **no**
cambian: no duplican nada de Contracts.md.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Mantener el alias | Duplica el nombre de un tipo público; el spec se contradice consigo mismo (§4 vs §6). Ya rechazado dos veces (ADR-021 §2, ADR-023 §1). |

## Consecuencias

**Positivas**: el Hito 6 arranca sin la frenada por ambigüedad que tuvieron los Hitos 3 y 5 por
este mismo patrón; un único nombre alineado con Contracts.md y el código de `@anonly/shared`.

**Negativas**: ninguna material. Queda pendiente de fondo (fuera de este ADR) revisar si
Render/Export arrastran el mismo defecto antes de sus hitos.

## Referencias

- `core/Contracts.md` §6 (`GroupingConfig`) — `core/Grouping_Engine.md` §6, §15.2
- `adr/ADR-021-Engines-Inline-Hasta-Hito9.md` §2 — `adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md` §1
