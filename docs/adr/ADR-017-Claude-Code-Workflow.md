<!-- CONTEXT: scope=adr | dependencias=ai/AI_Development_Guide.md,ai/Prompting_Guide.md,ai/Code_Standards.md | audiencia=humanos+IA | fase=6 -->

# ADR-017 — Flujo de desarrollo con Claude Code (CLAUDE.md + subagentes)

- **Estado**: Accepted
- **Fecha**: 2026-07-07
- **Decidido por**: Usuario + planificador

## Contexto

El modelo de trabajo del proyecto es planificador + implementador + revisor (`ai/AI_Development_Guide.md` §1), con la intención explícita de usar modelos económicos (Sonnet) como implementadores y modelos más capaces (Opus) como revisores. La `ai/Prompting_Guide.md` provee prompts autocontenidos para copiar y pegar en cualquier herramienta.

El desarrollo real ocurre con **Claude Code**, que tiene mecanismos nativos que el flujo copy-paste no aprovecha:

- `CLAUDE.md` en la raíz del repo se carga automáticamente como contexto en **toda** sesión. Sin él, cada sesión arranca "en frío" y depende de que el humano pegue el prompt correcto; una sesión rápida sin prompt formal no conoce las reglas (R-1..R-21) ni el protocolo de ambigüedad.
- Los subagentes (`.claude/agents/*.md`) permiten fijar rol, reglas **y modelo** por definición: el agente implementador corre con Sonnet y el revisor con Opus sin intervención manual, y cada uno arranca con contexto limpio (el revisor no hereda los sesgos de la sesión que implementó).

## Decisión

1. **`CLAUDE.md` en la raíz del repo** como punto de entrada obligatorio para cualquier agente: condensa el orden de lectura, los comandos de gates, las prohibiciones duras y el protocolo de ambigüedad, **referenciando** a `docs/ai/*` sin duplicar su contenido (una regla vive en un solo lugar; CLAUDE.md solo indexa).
2. **Subagentes en `.claude/agents/`**: `implementador` (model: sonnet) derivado del prompt §2 de la Prompting Guide, y `revisor` (model: opus) derivado del prompt §4. Los prompts de la guía siguen siendo la fuente de verdad del contenido; los agentes son su materialización para Claude Code.
3. **La `Prompting_Guide.md` se mantiene** para herramientas distintas de Claude Code y como fuente de verdad de los roles. Se le agrega una nota de mapeo prompt→agente.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Solo copy-paste de prompts (statu quo) | Depende de disciplina humana en cada sesión; una sesión informal sin prompt pegado opera sin reglas. CLAUDE.md elimina esa clase de error. |
| Duplicar todas las reglas dentro de CLAUDE.md | Crea una segunda fuente de verdad que va a divergir de `docs/ai/*`. CLAUDE.md referencia, no duplica. |
| Un único agente genérico sin roles | Pierde la separación implementador/revisor (contexto limpio para revisar) y el mapeo de modelo por rol, que es el objetivo económico del flujo. |
| Encodear las reglas solo en hooks/CI | CI ya existe como red final, pero actúa tarde (post-código). CLAUDE.md actúa antes de escribir la primera línea. Son complementarios. |

## Consecuencias

**Positivas**: toda sesión de Claude Code conoce las reglas sin setup manual; el mapeo rol→modelo queda versionado en el repo; menor costo por tarea (Sonnet implementa, Opus solo revisa); el revisor arranca sin contexto contaminado.

**Negativas**: un archivo más que mantener sincronizado con `docs/ai/*` (mitigado: CLAUDE.md solo contiene punteros y comandos, no reglas propias); específico de Claude Code (mitigado: la Prompting Guide sigue cubriendo otras herramientas).

**Neutras**: si se cambia de herramienta, se elimina `.claude/` y CLAUDE.md sin tocar `docs/`.

## Validación

- Toda regla citada en CLAUDE.md existe en `docs/ai/*` (revisión en PRs de docs).
- El agente revisor rechaza un PR de prueba que viole R-1 (dos motores tocados).

## Referencias

- `ai/AI_Development_Guide.md` §1 (roles), §5 (ambigüedad)
- `ai/Prompting_Guide.md` §2, §4, §12
- `ai/Code_Standards.md` §12 (prohibiciones)
- `CLAUDE.md` (raíz del repo)
- `.claude/agents/implementador.md`, `.claude/agents/revisor.md`
