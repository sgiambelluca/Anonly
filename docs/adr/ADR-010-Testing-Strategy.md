<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,ai/Code_Standards.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=2 -->

# ADR-010 — Estrategia de Testing

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Planificación inicial

## Contexto

El proyecto se desarrolla con IA (modelos económicos implementando specs). Sin testing robusto, los modelos pueden generar código que "parece funcionar" pero rompe contratos, pierde casos límite o introduce regresiones silenciosas. Los gates de CI son la red de seguridad.

## Decisión

### Stack de testing

| Tipo | Herramienta | Dónde |
|---|---|---|
| Unit | **Vitest** | `<engine>/src/__tests__/unit.test.ts` |
| Contract | **Vitest** | `<engine>/src/__tests__/contract.test.ts` |
| Snapshot | **Vitest** (snapshot de `DocumentModel`/`EntityGroup[]`) | `<engine>/src/__tests__/snapshot.test.ts` |
| Edge | **Vitest** | `<engine>/src/__tests__/edge.test.ts` |
| Integration (bus entre motores) | **Vitest** | `tests/integration/` |
| E2E (navegador real) | **Playwright** | `tests/e2e/` |
| Performance | **Vitest bench** + custom | `tests/perf/` |
| Stress | custom | `tests/stress/` |
| Leak (memoria) | custom + `performance.memory` | `tests/leak/` |
| Cancelación (SLA < 200 ms) | custom | `tests/cancel/` |

### Distribución por motor

Cada motor tiene su spec con sección "Casos de prueba" obligatoria (ver `ai/Module_Specification_Template.md` sección 14). Los tests viven junto al código del motor.

Tests globales (integration, e2e, perf, stress, leak, cancel) viven en `tests/` en la raíz del monorepo.

### Cobertura

- **Mínimo 85% líneas** por motor en unit tests.
- **100% métodos** de interfaces públicas en contract tests.
- **Todos los casos límite** del spec en edge tests.
- **Snapshot estable** del `DocumentModel` para PDF/OCR/Grouping (valida regresiones de parseo/agrupación).

### Gates de CI (obligatorios para merge)

Este ADR decide **que** existen gates bloqueantes por tipo de test; la **lista canónica** de gates (comandos, condiciones de fallo y estado de activación) vive en `architecture/07_Performance_Strategy.md` §11.4 y no se duplica acá — mantener dos copias generaba drift (actualización 2026-07-07, junto con la unificación de las listas de gates en todos los docs).

### Reglas de IA (reflejan `ai/AI_Development_Guide.md`)

- Todo PR generado por IA **debe** incluir tests. Sin tests, rechazo.
- Los tests de contract validan que la implementación cumple el spec, no solo que "pasa".
- Si un test del spec falta, el PR se rechaza hasta completarlo.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Jest** | No es ESM nativo. Configuración complicada con Vite. Vitest tiene mejor DX y reutiliza config de Vite. |
| **Cypress** | Más lento, menos estable en CI, peor soporte multi-navegador. |
| **Playwright + Unit con Node test runner** | Vitest tiene mejor API para snapshots y bench. |
| **Solo unit tests** | Insuficiente para un proyecto con IA: los contract tests son la garantía de que se respeta el spec. |
| **Cobertura 100% obligatoria** | 100% es vanity metric. 85% + 100% contract + 100% edge es más eficaz. |
| **Sin tests de perf/cancel/leak** | Las métricas de `00_Project_Vision.md` §7 son contractuales; sin tests de perf, se degradan silenciosamente. |

## Consecuencias

**Positivas**:
- IA económica no puede "approbar" código sin validar contratos.
- Regresiones se detectan en CI, no en manos del usuario.
- Métricas contractuales se monitorean continuamente.
- Seguridad se valida automáticamente (no-recuperabilidad, metadata strip, no-network).

**Negativas**:
- CI lento: E2E + perf + cancel + leak pueden sumar minutos. Mitigado con sharding y parallelización.
- Mantenimiento de fixtures (PDFs de prueba, modelos). Mitigado con LFS o descarga con hash.
- Snapshot drift requiere actualizar conscientemente (no es auto-fix).

## Referencias

- `07_Performance_Strategy.md` §11 (estrategia global de testing)
- `ai/Code_Standards.md` §10 (obligaciones por PR)
- `ai/AI_Development_Guide.md` §2.3 (reglas R-13 a R-16)
- `ai/Module_Specification_Template.md` sección 14 (Casos de prueba)
- `08_Security_Model.md` §11 (tests de seguridad)
