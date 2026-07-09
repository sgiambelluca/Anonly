<!-- CONTEXT: scope=adr | dependencias=04_Event_System.md,01_Technical_Architecture_Document.md | audiencia=humanos+IA | fase=2 -->

# ADR-007 — Event Bus Tipado Propio

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Planificación inicial

## Contexto

El principio A-5 del TAD exige que **todo se comunique mediante eventos** entre motores y entre Core y UI. Necesitamos un bus de eventos que:

- Sea **tipado** (cada evento tiene su payload tipo, no `any`).
- Sea **canalizado** (suscripciones por `EngineId` / `ui` / `pipeline`).
- Soporte **sync y async** (algunos eventos requieren espera, otros no).
- Sea **serializable-friendly** (los payloads cruzan boundaries worker↔host).
- Sea **auditable** (para tests de contrato de la matriz emisor→receptor).

## Decisión

Implementar un **Event Bus propio** en `packages/anonymization-core/event-system/`, sin dependencias externas.

Características:

- API: `IEventBus` con `on(channel, event, handler)`, `off(...)`, `emit(channel, event, payload)`, `emitAsync(channel, event, payload)`.
- Tipado: los canales y eventos están en el enum `EngineEvents` y los payloads en el namespace `EventPayloads` (`core/Contracts.md`).
- Canales: `pipeline | ui | pdf | ocr | regex | ner | grouping | render | export | workers`.
- Sin middleware complejo (no es Redux); handlers directos.
- Inmutabilidad: el payload se freeze-shallow al emitir (dev only) para detectar mutaciones.
- Sin loops: el bus no se auto-suscribe; matriz emisor→receptor validada por test de contrato.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **mitt / nanoevents / tinyemitter** | Sin tipado fuerte nativo. Habría que wrappeary pierde inferencia. Para TS estricto end-to-end, propio es más limpio. |
| **EventEmitter de Node (browserified)** | Sin tipado, sin canales, sin serialización segura. |
| **RxJS Subject** | Demasiado potente para lo que necesitamos. Bundle grande. Curva de aprendizaje. |
| **CustomEvent + dispatchEvent (DOM)** | Acoplado al DOM. El Core no debe depender del DOM (regla A-3, A-4). |
| **Zustand como bus** | Zustand es un store, no un bus. Mezcla dos responsabilidades. |
| **MessageChannel API** | Es para worker↔worker o port-based, no para bus general con suscripciones múltiples. |

## Consecuencias

**Positivas**:
- Tipado end-to-end: el TS falla si alguien emite un evento con payload incorrecto.
- Sin dependencia externa; cero bundle cost.
- Canales dan estructura clara y permiten suscripciones finas.
- Auditable: la matriz emisor→receptor se valida con un test que wrappea el bus y registra emisiones.

**Negativas**:
- Mantenemos una pieza de infra propia. Mitigado: es simple (< 200 LOC) y bien testeada.
- No hay operators como en RxJS. No los necesitamos en MVP.
- Sin time-travel debugging como Redux. Mitigado con logger middleware en dev.

## Reglas

1. Nunca importar `event-system` desde `apps/react-client` directamente; se expone via `@anonly/anonymization-core`.
2. El bus **nunca** bloquea el emisor en `emit` (async). `emitAsync` solo se usa para validaciones pre-UI (ej: `CANCEL_REQUESTED`).
3. Handlers no pueden lanzar: si lanzan, el bus loguea `error` y continúa (no rompe el pipeline).
4. El payload es inmutable desde el punto de vista del handler; mutarlo es error en dev.

## Actualización (2026-07-08)

El hardening del Hito 1 (ver `adr/ADR-019-Hito1-Hardening.md` para el detalle completo) ajusta cuatro puntos de la decisión original:

- El **freeze-shallow del payload en dev** (mencionado arriba en Decisión y Reglas #4) se descarta: la inmutabilidad se garantiza por tipos (`readonly` en todo `EventPayloadMap`) y tests, consistente con `ai/Code_Standards.md` §6 ("se prohíbe `Object.freeze` en hot paths"). No se implementa ni en dev ni en producción.
- La **matriz emisor→receptor** ("Auditable" en Consecuencias) se valida con un test de contrato del bus recién cuando existan motores reales que instanciar (Hito 9), no en el Hito 1 — hoy solo existen `shared` y `event-system`.
- `EventBusOptions.logger` pasa a ser **requerido** (se elimina el fallback a `console.error` que violaba P-4 de `ai/Code_Standards.md` §12).
- El `channel` de `IEventBus` se tipa con el enum `EventChannel` (no con un alias `string`), alineado con `core/Contracts.md` §3.2, que siempre lo definió así.

## Referencias

- `04_Event_System.md` (documento completo)
- `01_Technical_Architecture_Document.md` §2 A-5
- `ai/Code_Standards.md` §6 (inmutabilidad)
- `core/Contracts.md` (interfaces `IEventBus`, `EngineEvents`, `EventPayloadMap`)
- `adr/ADR-019-Hito1-Hardening.md` (nota de actualización 2026-07-08)
