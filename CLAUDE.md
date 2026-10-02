# Anonly — Guía para agentes (Claude Code)

Aplicación de escritorio (Electron, ADR-130) de anonimización documental **100% local**. Monorepo pnpm:

- `packages/anonymization-core/`: el Core. Siete motores desacoplados que se comunican solo por eventos, más el façade/Orchestrator en `src/`.
- `apps/react-client`: la UI.
- `apps/desktop-shell`: el contenedor Electron. Tiene el protocolo `app://`, la CSP y el actualizador.

**Este archivo indexa; las reglas viven en `docs/`.** Ante cualquier duda, gana el doc citado.

## Antes de tocar código (lectura obligatoria, en orden)

1. `docs/core/Contracts.md`: tipos, eventos y error codes. Completo.
2. `docs/core/<Engine>_Engine.md`: el spec del motor asignado. Completo.
3. `docs/ai/Code_Standards.md`: estándares de TypeScript estricto.
4. `docs/ai/AI_Development_Guide.md`: reglas de trabajo R-1 a R-22.

Dónde está el estado real:

- Avance por hito: `docs/roadmap/MVP.md` §4.
- Mientras la branch `hardening/plan-2026-09` no esté en `main`, su revisión por rondas se lleva en `docs/roadmap/Revision_Por_Bloques_Hardening.md`, que es plan y registro a la vez.
- Mediciones: `docs/roadmap/mediciones/<motor>/`. Cómo correr los arneses: `tests/perf/README.md`.

## Reglas duras (violarlas = PR rechazado)

- **Un commit = un módulo.** Nunca tocar dos motores en el mismo commit (R-1, R-5).
  - Una branch de campaña puede tocar varios módulos si cada commit toca uno (ADR-124).
  - El commit que cambia un contrato es la excepción, y lleva su ADR.
  - La higiene de datos va en commit propio (R-22).
- **Nunca** romper contratos públicos de `docs/core/Contracts.md`. Un cambio de contrato va primero como ADR y docs, y después como código (R-2, R-19).
- **Nunca importar un motor desde otro motor**, ni React desde `packages/`, ni `@anonly/event-system` directo desde un motor (P-1, P-2; para `@anonly/event-system`, `ai/Code_Standards.md` §12).
  - ESLint lo bloquea con los patrones `@anonly/*-engine` y `@anonly/event-system` en `no-restricted-imports`, salvo en los `__tests__` de cada paquete.
  - Solo el façade `packages/anonymization-core/src/` importa motores. Los motores usan el `IEventBus` que reciben por `ctx`.
- **Prohibiciones de código** (R-6 a R-11):
  - sin `any`;
  - sin `@ts-ignore` que no tenga issue;
  - sin `console.*` en `packages/` (P-4; ESLint lo bloquea);
  - sin `export default`;
  - sin red ni filesystem desde el Core;
  - todo dato público es inmutable (`readonly`).
- **Dependencias y specs:** ninguna dependencia externa nueva sin ADR (R-12). Los specs de motor no se editan desde la mano que implementa (R-21).
- **Tests:** todo PR trae contract, unit y edge (y snapshot si aplica), con los **nombres exactos de §14 del spec** y cobertura ≥ 85% de líneas del módulo (R-13).
- **Commits:**
  - Conventional Commits **sin scope** (R-17).
  - Encabezado de **100 caracteres como máximo**: commitlint lo rechaza, y los archivos que quedaron en stage se cuelan en el commit siguiente.
  - `git commit` y `git push` **nunca** sin autorización explícita del humano (I-9).
- **Datos reales:** los documentos reales **solo** entran por variables de entorno (`ANONLY_REAL_DOC_*`).
  - Nunca se escriben en el repo, ni en un reporte, fixture o ZIP, sus rutas, nombres, contenido ni datos del caso.
  - Los informes llevan solo IDs neutros, hashes y agregados.

## Ambigüedad: detenerse, no improvisar

Si el spec no cubre un caso, si dos docs se contradicen, o si un tipo, evento o error code referenciado no existe:

1. **Detener la tarea.**
2. Reportar archivo, sección, cita textual y una pregunta concreta (`ai/AI_Development_Guide.md` §5).
3. No elegir entre los dos docs, aunque la contradicción parezca menor.

Antes de publicar un ADR, buscar con grep cada tipo, evento y error code que cita contra `Contracts.md` y `shared/src/enums.ts`. Precedentes: ADR-013, ADR-014 y ADR-015.

**Un test no se acomoda para esconder un defecto del producto.** Si un fixture necesita más texto, otra geometría o datos "más fáciles" para pasar, eso es un hallazgo que se reporta al planificador. Precedentes: la densidad de OSD en las rondas A y B, que terminó en ADR-190.

## Gates

**Subset mínimo antes de dar una tarea por lista** (el mismo de `07_Performance_Strategy.md` §11.4 y de R-16). CI los cubre: `format:check` dentro del job Lint, y los tests de contrato dentro de `pnpm test`.

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract && pnpm format:check
```

- La **tabla canónica completa** de gates está en `docs/architecture/07_Performance_Strategy.md` §11.4, y es la única fuente de verdad (ADR-149).
- La cobertura se aplica por paquete, con thresholds en `vitest.config.ts`. Al implementar un motor o un módulo puro nuevo, agregar su glob en el mismo PR.
- Los tests globales de `tests/` resuelven motores con `resolve.alias` en `vitest.config.ts` y `paths` espejo en `tests/tsconfig.json`. Los scripts `test:<dir>` usan filtro posicional, nunca `--dir` (ADR-033).
- **Suites pesadas:** `test:e2e`, `test:perf`, `test:leak` y `test:stress`.
  - Corren sobre la app Electron empaquetada: necesitan `pnpm assets:mirror` y el build del renderer y del shell (ver `package.json`).
  - En una revisión se corre **solo el spec afectado**, de a uno.
  - **Nunca** en paralelo con una medición: compiten por CPU y ensucian los números.
- CI (`.github/workflows/ci.yml`) corre en Linux y macOS, no en Windows. Windows se cubre con los gates locales.

## Roles y agentes

El modelo de trabajo es planificador, implementador y revisor (`ai/AI_Development_Guide.md` §1, ADR-017).

- **Planificador** (la sesión principal):
  - decide y escribe el ADR y los docs **antes** que el código;
  - audita el spec antes de cada hito;
  - es el único que edita `docs/core/*`;
  - pide al humano las decisiones de producto (umbrales, UX, costos aceptados) y no las infiere.
- **`.claude/agents/implementador.md`** (Sonnet): implementa **un** motor de `packages/` desde su spec.
- **`general-purpose` con `model: "sonnet"`**: para el trabajo que no es un solo motor, como `apps/`, `tests/`, scripts o una ronda que toca varios módulos.
  - Se le dan las reglas de `implementador.md`.
  - Cada arreglo queda confinado a su módulo, para poder partir los commits.
- **`.claude/agents/revisor.md`** (Opus): valida contra el spec y las reglas, y da el veredicto APPROVED o REJECTED. No modifica archivos.

Cómo se coordinan:

- **Un solo sub-agente activo a la vez.** El ciclo es revisor, después implementador, de nuevo revisor, y así hasta APPROVED.
- **Se retoma el mismo agente** con `SendMessage` entre rondas y tras un corte (límite de uso, fin de sesión), en vez de lanzar uno nuevo.
  - Al retomar, lo primero es `git status` y `git diff` para no rehacer trabajo.
- **El revisor se lanza por lote**: cuando todas las tareas de la ronda están listas, no después de cada tanda del implementador.
- **Los sub-agentes corren los gates en modo síncrono**, nunca en background ni con Monitor: nada los reanuda si el turno termina antes.
- **Ningún sub-agente edita `docs/` ni commitea.** Si un hallazgo pide cambiar un spec o un contrato, primero escribe el planificador y después se toca código.

Para otras herramientas, los prompts equivalentes están en `docs/ai/Prompting_Guide.md`.

## Entorno

Requiere Node ≥ 22 y pnpm ≥ 9.

- **Windows**: corre **nativo**, sin WSL.
  - Se usa Git Bash o PowerShell; los `node_modules` de la copia de Windows son binarios de Windows.
  - Los scripts que definen variables de entorno usan `cross-env` (ADR-186).
  - `.gitattributes` fija LF en la copia de trabajo aunque `core.autocrlf=true`. Si un archivo aparece con CRLF, hay que renormalizar (`tests/perf/README.md`).
  - Nota para una sesión WSL: correr los gates sobre `/mnt/c/...` es muy lento, y además los binarios de esta copia no son de Linux.
- **macOS y Linux**: corren directo en la shell nativa.
- **Hooks**: husky con lint-staged (ESLint y Prettier sobre lo que está en stage) y commitlint.
  - `git commit` corre los hooks.
  - `git push` no tiene hook.
