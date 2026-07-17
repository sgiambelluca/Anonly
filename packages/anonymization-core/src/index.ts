/**
 * @anonly/anonymization-core — API pública del Core.
 *
 * Punto único de entrada para clientes (apps/react-client, futuros Electron/RN).
 * Re-exporta shared y event-system. `createCore()` instancia el Orchestrator
 * (Hito 9) — composition root del Core: es el único paquete autorizado a
 * importar motores directamente (`ai/Code_Standards.md` §12).
 *
 * Fuente de verdad: docs/core/Contracts.md §3.5, docs/core/Orchestrator.md.
 */

// Re-export de shared para que los clientes no necesiten importar @anonly/shared directo.
export * from "@anonly/shared";

// Re-export de event-system.
export { EventBus, createEventBus } from "@anonly/event-system";
export type { EventBusOptions } from "@anonly/event-system";

// Tipos públicos del façade (Contracts.md §3.5, ADR-034 §7: se comparten con la UI).
export type {
  AnonymizationCoreEngines,
  IAnonymizationCore,
  ImportDocumentInput,
  IPipelineOrchestrator,
} from "./types.js";

// Composition root (Hito 9).
export { createCore } from "./create-core.js";
