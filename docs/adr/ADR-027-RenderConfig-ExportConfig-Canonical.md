<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Render_Engine.md,core/Export_Engine.md,adr/ADR-026-GroupingConfig-Canonical.md | audiencia=humanos+IA | fase=6 -->

# ADR-027 — Render/Export: `RenderConfig` y `ExportConfig` son los nombres canónicos (se eliminan los alias `*EngineConfig`)

- **Estado**: Accepted
- **Fecha**: 2026-07-11
- **Decidido por**: El humano, en el repaso de consistencia documental posterior a ADR-026
- **Relacionado con**: ADR-021 §2 (OCR), ADR-023 §1 (NER), ADR-026 (Grouping) — cuarto y quinto caso del mismo defecto

## Contexto

ADR-026 dejó anotado que Render y Export podían arrastrar el mismo defecto de alias que OCR, NER y
Grouping. Verificado: `core/Contracts.md` §6 define `RenderConfig` (`previewScale`, `fullScale`,
`jpegQuality`, `cachePages`) y `ExportConfig` (`defaultDpi`, `defaultImageFormat`,
`defaultJpegQuality`), transportados por `EngineConfig.render` / `EngineConfig.export` (§3.1). Pero
`Render_Engine.md` §6/§15.2 definía `RenderEngineConfig` y `Export_Engine.md` §6/§15.2 definía
`ExportEngineConfig`, ambos con **campos idénticos** a los canónicos.

Se resuelven ambos ahora — antes de sus hitos (7 y 8) — para que ningún implementador vuelva a
frenarse por este patrón. Con esto la clase de defecto queda cerrada en todo el repo: PDF tiene su
canónico en Contracts.md por ADR-013; `RegexEngineConfig` (Regex_Engine.md §6) **no** es un caso de
este defecto — Contracts.md no define `RegexConfig` ni `EngineConfig` tiene campo `regex`, así que
es un tipo público local legítimo del motor (verificado contra `regex.types.ts` implementado).

## Decisión

- `RenderConfig` (Contracts.md §6, re-exportado por `@anonly/shared`) es el único nombre canónico
  de la config de Render. El alias `RenderEngineConfig` se elimina de `Render_Engine.md` §6 y §15.2.
- `ExportConfig` (ídem) es el único nombre canónico de la config de Export. El alias
  `ExportEngineConfig` se elimina de `Export_Engine.md` §6 y §15.2.

En ambos casos los campos ya eran idénticos: rename puro, sin migración de forma. Los defaults
(`previewScale: 1.0`, `fullScale: 2.08`, `jpegQuality: 0.85`, `cachePages: 16`; `defaultDpi: 150`,
`defaultImageFormat: "jpeg"`, `defaultJpegQuality: 0.85`) siguen documentados como comentarios en
los specs y en las constantes de defaults. Los tipos genuinamente locales de cada motor
(`RenderPageInput/Output`, `ExportEngineInput/Output`, `RenderPageProvider`) no cambian.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Mantener los alias | Duplican nombres de tipos públicos; ya rechazado tres veces (ADR-021 §2, ADR-023 §1, ADR-026). |
| Diferir cada uno al pre-trabajo de su hito | Rechazada por el humano: el defecto ya está identificado y verificado como rename puro; diferirlo solo posterga una frenada conocida. |

## Consecuencias

**Positivas**: los Hitos 7 y 8 arrancan sin la ambigüedad; la clase de defecto "alias de config"
queda erradicada del repo (auditados los 7 motores).

**Negativas**: ninguna material.

## Referencias

- `core/Contracts.md` §3.1 (`EngineConfig`), §6 (`RenderConfig`, `ExportConfig`)
- `core/Render_Engine.md` §6, §15.2 — `core/Export_Engine.md` §6, §15.2
- `adr/ADR-021` §2 — `adr/ADR-023` §1 — `adr/ADR-026`
