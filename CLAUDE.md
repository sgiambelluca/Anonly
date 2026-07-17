# Anonly — Guía para agentes (Claude Code)

Plataforma de anonimización documental 100% local. Monorepo pnpm: `apps/react-client` (UI) + `packages/anonymization-core` (Core desacoplado, motores comunicados solo por eventos).

**Este archivo indexa; las reglas viven en `docs/`.** Ante cualquier duda, el doc citado gana.

## Antes de tocar código (lectura obligatoria, en orden)

1. `docs/core/Contracts.md` — tipos, eventos, error codes. Completo.
2. `docs/core/<Engine>_Engine.md` — el spec del motor asignado. Completo.
3. `docs/ai/Code_Standards.md` — estándares TS estricto.
4. `docs/ai/AI_Development_Guide.md` — reglas de trabajo R-1..R-21.

El estado de avance real (qué hito está cerrado, qué sigue) está en `docs/roadmap/MVP.md` §4.

## Reglas duras (violarlas = PR rechazado)

- **Un PR = un módulo.** Nunca tocar dos motores en el mismo cambio (R-1, R-5).
- **Nunca** romper contratos públicos de `docs/core/Contracts.md`. Cambios de contrato: primero ADR + docs, después código (R-2, R-19).
- **Nunca** importar un motor desde otro motor, ni React desde `packages/`, ni `@anonly/event-system` directo desde un motor (P-1, P-2; ESLint lo bloquea: patrón `@anonly/*-engine` y `@anonly/event-system` en `no-restricted-imports`, excepto en `__tests__` de cada paquete). El único que importa motores es el façade `packages/anonymization-core/src/`; los motores usan el `IEventBus` inyectado por `ctx`.
- Sin `any`, sin `@ts-ignore` sin issue, sin `console.*` en `packages/` (P-4; ESLint lo bloquea con `no-console` estricto, sin `allow`, en `packages/**`), sin `export default`, sin network/filesystem desde el Core, todo dato público inmutable (`readonly`) (R-6..R-11).
- Sin dependencias externas nuevas sin ADR (R-12). Los specs de motor no se editan desde un PR de implementación (R-21).
- Todo PR incluye tests: contract + unit + edge (+ snapshot si aplica), cobertura ≥ 85% líneas del módulo (R-13).
- **Nunca** `git commit` ni `git push` sin autorización explícita del humano (I-9).

## Ambigüedad: detenerse, no improvisar

Si el spec no cubre un caso, dos docs se contradicen, o un tipo/evento/error code referenciado no existe: **detener la tarea** y reportar archivo + sección + cita textual + pregunta concreta (`ai/AI_Development_Guide.md` §5). Precedentes: ADR-013, ADR-014, ADR-015.

## Gates (verdes antes de dar por lista cualquier tarea)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract
```

Ese es el subset mínimo pre-PR; la **tabla canónica completa** de gates está en `docs/architecture/07_Performance_Strategy.md` §11.4 (única fuente de verdad). La cobertura se aplica por paquete vía thresholds en `vitest.config.ts` — al implementar un motor nuevo, agregar su glob ahí en el mismo PR. Los tests globales de `tests/` resuelven motores vía `resolve.alias` en `vitest.config.ts` + `paths` espejo en `tests/tsconfig.json`: al escribir el primer test global que importe un motor, agregar ambas entradas en el mismo PR; los scripts `test:<dir>` usan filtro posicional, nunca `--dir` (ADR-033).

## Roles y agentes

Modelo de trabajo planificador/implementador/revisor (`ai/AI_Development_Guide.md` §1, ADR-017):

- `.claude/agents/implementador.md` (Sonnet) — implementa un motor desde su spec.
- `.claude/agents/revisor.md` (Opus) — valida un diff contra el spec y las reglas; veredicto APPROVED/REJECTED.

Para otras herramientas, los prompts equivalentes están en `docs/ai/Prompting_Guide.md`.

## Entorno

El desarrollo corre en **WSL Ubuntu** (node 22 vía nvm + pnpm); los binarios de `node_modules` son Linux. Desde Windows, invocar los comandos vía `wsl -d Ubuntu`.
