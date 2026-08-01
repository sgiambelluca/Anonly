<!-- CONTEXT: scope=reglas-de-trabajo-IA | dependencias=ai/Code_Standards.md,ai/Module_Specification_Template.md | audiencia=IA+humanos | fase=0 -->

# Anonly — Guía de Desarrollo con IA

> Establece **cómo** deben trabajar los modelos de IA (y los humanos) sobre este proyecto. Es el documento que se pasa como system prompt o contexto a cualquier agente que vaya a tocar código. Las reglas son **obligatorias** y su violación justifica el rechazo de un PR.

---

## 1. Modelo de trabajo

El proyecto se desarrolla bajo un modelo **planificador + implementador**:

| Rol | Modelo | Tarea |
|---|---|---|
| Planificador / Arquitecto | modelo potente | mantiene `docs/`, escribe specs, ADRs, refactors grandes, resolución de ambigüedades. |
| Implementador | modelo económico | toma un spec de motor + `core/Contracts.md` y produce código + tests que respetan el contrato. |
| Revisor | modelo intermedio | valida PRs contra el spec y las reglas de esta guía. |

**Regla de oro**: el implementador nunca decide arquitectura. Solo traduce specs a código. Si encuentra una ambigüedad o un vacío en el spec, **detiene la tarea** y reporta el issue, sin improvisar.

---

## 2. Reglas obligatorias

### 2.1 Sobre módulos y alcance

| # | Regla |
|---|---|
| R-1 | **Un PR = un módulo.** Nunca modificar más de un motor por PR. |
| R-2 | Nunca romper **contratos públicos** definidos en `core/Contracts.md` o en la sección "Interfaces públicas" de un spec. Cambios de contrato requieren ADR + actualización de todos los specs afectados primero. |
| R-3 | **Nunca** crear dependencias entre motores. La comunicación es solo por eventos y tipos de `@anonly/shared`. |
| R-4 | **Nunca** acceder a React ni a ninguna librería de UI desde `packages/`. El Core es agnóstico de framework. |
| R-5 | Si una tarea menciona dos motores, dividir en dos tareas y dos PRs. |

### 2.2 Sobre código

| # | Regla |
|---|---|
| R-6 | Todo el código es **TypeScript estricto** según `ai/Code_Standards.md`. Sin `any`, sin `@ts-ignore` sin issue. |
| R-7 | Todo dato público del Core es **inmutable** (`readonly`, `ReadonlyArray`). |
| R-8 | Toda función pública de larga duración recibe `AbortSignal` vía `ctx`. |
| R-9 | **Prohibido** `console.*` en `packages/`. Usar `ctx.logger`. |
| R-10 | **Prohibido** network y filesystem desde el Core. |
| R-11 | Sin `export default`. Solo exports nombrados. |
| R-12 | Sin dependencias externas nuevas sin ADR. |

### 2.3 Sobre tests y PRs

| # | Regla |
|---|---|
| R-13 | **Cada PR generado por IA debe incluir tests** (contract + unit + edge según el spec). Un PR sin tests se rechaza. |
| R-14 | Cada módulo debe tener su `README.md` apuntando al spec, y el spec debe estar actualizado antes del PR. |
| R-15 | Cada cambio debe respetar las **interfaces existentes**. Si las extiende, documentarlo en el spec. |
| R-16 | Antes de marcar un PR como listo, ejecutar `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`. Verde obligatorio. |
| R-17 | El mensaje de commit sigue Conventional Commits sin scope. El PR toca un solo módulo. |

### 2.4 Sobre documentación

| # | Regla |
|---|---|
| R-18 | Toda decisión técnica no trivial va en un ADR antes de implementarse. |
| R-19 | Todo tipo/evento/error code nuevo se agrega primero a `core/Contracts.md` y `architecture/04_Event_System.md`, luego al spec del motor, luego al código. |
| R-20 | Los `<!-- CONTEXT -->` al inicio de cada `.md` deben mantenerse actualizados. |
| R-21 | Los specs de motor **nunca** se editan desde un PR de implementación; se editan desde un PR de documentación aparte. |

---

## 3. Flujo de trabajo recomendado para un implementador

```
1. Leer docs/core/<Engine>_Engine.md completo.
2. Leer docs/core/Contracts.md completo.
3. Leer docs/ai/Code_Standards.md.
4. Verificar que el paquete <engine>-engine/ existe o crearlo.
5. Implementar en el orden del Checklist de implementación del spec.
6. Para cada item del Checklist:
   - Implementar.
   - Escribir su test correspondiente.
   - Ejecutar el test aislado.
7. Al terminar el Checklist:
   - Gates **scoped al módulo tocado** (ver §4 — el implementador nunca corre el lint/test del monorepo completo): p. ej. `eslint packages/anonymization-core/<engine>-engine --max-warnings=0`, `pnpm --filter @anonly/<engine>-engine typecheck`, tests filtrados a ese paquete.
   - Si algo falla, arreglar. No commitear con rojo.
8. Generar el diff y el mensaje de commit.
9. Reportar: archivos tocados, cobertura final, tests nuevos, cualquier ambigüedad detectada.
```

**Nunca** saltar al paso 5 sin haber leído los pasos 1–3 completos.

---

## 4. Gates de calidad

Un PR se considera mergeable solo si cumple **todos** los gates.

**Gates ejecutables**: la tabla canónica (única fuente de verdad, con comandos y estado de activación) vive en `architecture/07_Performance_Strategy.md` §11.4. No se duplica acá. Comando mínimo pre-PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

**Quién corre qué alcance**: ese comando mínimo (repo completo) es responsabilidad del **revisor** — lo confirma una sola vez por PR, no en cada iteración. El **implementador**, mientras itera, corre el equivalente **scoped al módulo que está tocando** (lint/typecheck/test filtrados a su paquete) — nunca el lint/test del monorepo completo. Motivo: el lint type-aware del monorepo tarda ~10-12 min; repetirlo en cada ajuste chico durante la implementación no detecta nada que el scoped no detecte ya para ese módulo, y de todos modos el revisor hace la pasada completa sobre el diff final antes de aprobar. Si un implementador maneja varias tareas encadenadas en la misma branch, el revisor entra recién cuando **todas** están code-complete, no después de cada una.

**Ejecución de gates lentos**: siempre en modo síncrono — nunca backgrounded (`run_in_background` o equivalente). Si un comando tarda varios minutos, esperar el resultado real en la misma llamada antes de reportar. Un agente que backgroundea un gate lento y dice "voy a esperar la notificación" no se reanuda solo cuando el comando termina — a diferencia de quien lo invocó, nada lo despierta — y su reporte final queda sin confirmar. El costo de retomarlo después (pedirle que confirme, lo que le reprocesa todo el transcript previo) es mayor que el de simplemente esperar el resultado en la misma llamada desde el principio.

**Gates de revisión** (los aplica el revisor humano/IA; no son un comando):

| Gate | Cómo se valida | Falla si |
|---|---|---|
| Diff scope | revisión humana/IA | el PR toca más de un módulo o archivos fuera del módulo |
| Spec sync | revisión humana/IA | el spec del motor no refleja la implementación |
| Prohibiciones | grep sobre el diff | presencia de `any`, `console.`, `react` en `packages/` (lista completa: `ai/Code_Standards.md` §12) |

---

## 5. Detección de ambigüedad

Un implementador que detecte **cualquiera** de estas situaciones **detiene** la tarea y reporta el issue sin improvisar:

- El spec no menciona un caso que el código necesita cubrir.
- Dos specs se contradicen.
- Un tipo referenciado no existe en `core/Contracts.md` ni en el spec.
- Un evento referenciado no existe en `architecture/04_Event_System.md`.
- Un error code referenciado no existe en el enum `EngineErrorCode`.
- Un test del spec requiere un fixture que no existe ni se describe cómo construirlo.

El reporte de ambigüedad incluye: archivo, sección, cita textual, pregunta concreta.

---

## 6. Prohibiciones de uso de IA

| # | Prohibición |
|---|---|
| I-1 | No generar código fuera del módulo asignado, aunque "sea obvio" que falta. Reportarlo. |
| I-2 | No crear nuevos tipos compartidos sin actualizar `core/Contracts.md` primero. |
| I-3 | No inventar nombres de eventos. Solo los de `architecture/04_Event_System.md`. |
| I-4 | No inventar `EngineErrorCode`. Solo los de `core/Contracts.md`. |
| I-5 | No agregar dependencias externas. Si el spec las requiere, ya están listadas en "Dependencias permitidas". |
| I-6 | No modificar `tsconfig.json` base sin ADR. |
| I-7 | No desactivar reglas de ESLint localmente sin issue y justificación. |
| I-8 | No commitear secrets, tokens ni variables de entorno. |
| I-9 | No ejecutar `git push` ni `git commit` sin autorización explícita del humano. |

---

## 7. Roles de los documentos

| Documento | Quién lo escribe | Quién lo consume |
|---|---|---|
| `00_Project_Vision.md` | planificador | todos |
| `architecture/*` | planificador | planificador + implementador (referencias) |
| `adr/*` | planificador | todos |
| `core/Contracts.md` | planificador | implementador (lectura obligatoria) |
| `core/<Engine>_Engine.md` | planificador | implementador (lectura obligatoria) |
| `ai/*` | planificador | todos los agentes |
| `ui/*` | planificador + frontend | implementador UI |
| `roadmap/*` | planificador | humanos (priorización) |

---

## 8. Referencias

- `ai/Code_Standards.md` — reglas detalladas de código.
- `ai/Module_Specification_Template.md` — plantilla canónica de specs.
- `ai/Prompting_Guide.md` — prompts base para implementar, testear y revisar.
- `architecture/01_Technical_Architecture_Document.md` — arquitectura completa.
- `core/Contracts.md` — tipos y contratos base.
