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
  ManualEntityResult,
} from "./types.js";

// Composition root (Hito 9).
export { createCore } from "./create-core.js";

// Funciones puras de tipos propios y formatos (1.1, Contracts.md §3.5), sin
// Core ni documento (ADR-223 §1). `isUserEntityType` ya sale de `@anonly/shared`
// por el `export *` de arriba.
// Dueño de las etiquetas (ADR-219 §2):
export { userTypeLabel, validateUserEntityType } from "@anonly/grouping-engine";
// Dueño del generador y del catálogo (ADR-220 §3, ADR-221 §2):
export { compareFormat, getCatalog, testFormat, validateFormat } from "@anonly/regex-engine";
// Del façade, porque combina las dos anteriores (ADR-223 §6):
export { validateFormatsFile } from "./formats-file.js";
