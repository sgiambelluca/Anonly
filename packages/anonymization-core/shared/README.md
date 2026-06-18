# @anonly/shared

Tipos, contratos, enums y error codes compartidos del Core de Anonly.

> Este paquete es la **única** dependencia permitida para todos los motores del Core. Define los contratos públicos que motores, orchestrator y cliente respetan.

## Documentación

- **Spec canónico**: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md)
- Modelo de datos: [`docs/architecture/03_Data_Model.md`](../../../docs/architecture/03_Data_Model.md)
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md)
- Reglas de código: [`docs/ai/Code_Standards.md`](../../../docs/ai/Code_Standards.md)

## Contenido

- `enums.ts` — `EngineId`, `EventChannel`, `EngineEvents`, `EntityType`, `ReplacementMode`, `DetectionSource`, `AnnotationKind`, `ConflictReason`, `PipelineStage`, `EngineErrorCode`, `RuleScope`, `WorkerJobType`.
- `types.ts` — `Document`, `Page`, `Word`, `BoundingBox`, `Occurrence`, `EntityGroup`, `Replacement`, `Rule`, `Annotation`, `Conflict`, `PipelineState`, `WorkerJob`, `ExportOptions`, etc.
- `interfaces.ts` — `IEngine`, `IEventBus`, `ILogger`, `ICache`, `EngineContext`, `EngineConfig`, configuraciones por motor.
- `errors.ts` — `EngineError` (abstract), `EngineNotInitializedError`, `EngineDisposedError`, `InvalidInputError`, `CancelledError`.
- `events.ts` — `EventPayloads` namespace (payloads tipados por evento).
- `transferable.ts` — `Transferable<T>` para zero-copy a Workers.
- `synthesizer.ts` — sintetizadores deterministas para modo `synthetic` (DNI, CUIT, tarjeta, etc.).

## Reglas

- Sin dependencias externas (solo TS puro).
- Sin React, sin DOM, sin network, sin Node builtins.
- Todo tipo es inmutable (`readonly`, `ReadonlyArray`).
- Sin `any`, sin `export default`.
- Sin mutar props de entrada.

## Scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc para generar dist/
```
