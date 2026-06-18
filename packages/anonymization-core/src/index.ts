/**
 * @anonly/anonymization-core — API pública del Core.
 *
 * Punto único de entrada para clientes (apps/react-client, futuros Electron/RN).
 * Re-exporta shared y event-system. Los engines individuales se agregan en hitos 2-8.
 *
 * Fuente de verdad: docs/ui/React_Client.md §4 (API pública esperada).
 *
 * Hito 1: solo shared + event-system.
 * Hito 2-8: se agregan pdf-engine, ocr-engine, regex-engine, ner-engine,
 * grouping-engine, render-engine, export-engine.
 * Hito 9: se agrega createCore() que inicializa el Orchestrator.
 */

// Re-export de shared para que los clientes no necesiten importar @anonly/shared directo.
export * from "@anonly/shared";

// Re-export de event-system.
export { EventBus, createEventBus } from "@anonly/event-system";
export type { EventBusOptions } from "@anonly/event-system";

/**
 * Crea una instancia del Core con todos los motores inicializados.
 *
 * Hito 9 — NO IMPLEMENTADO todavía. En Hito 1, los clientes solo usan
 * `createEventBus()` y los tipos de `@anonly/shared` directamente.
 *
 * @param _config configuración opcional del Core (EngineConfig partial).
 * @returns Promise que resuelve a la instancia del Core lista para usar.
 */
export function createCore(_config?: unknown): Promise<unknown> {
  void _config;
  return Promise.reject(
    new Error(
      "createCore() no está implementado en Hito 1. Se implementa en Hito 9 (Orchestrator).",
    ),
  );
}
