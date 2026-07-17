/**
 * Logger nulo por defecto del façade.
 *
 * `createCore(config?: Partial<EngineConfig>)` (Contracts.md §3.5) no recibe
 * un `ILogger` inyectable: `EngineConfig` no tiene campo `logger` (vive en
 * `EngineContext`, no en `EngineConfig`). El Orchestrator necesita construir
 * el `ILogger` que inyecta a todos los motores vía `EngineContext`, y
 * `packages/**` prohíbe `console.*` sin excepción (P-4, Code_Standards.md
 * §12). Decisión de implementación acotada por ese contrato fijo (no una
 * elección de arquitectura): un logger nulo — nunca usa `console.*`, nunca
 * pierde el `no-console` estricto — es el único default seguro disponible.
 */

import type { ILogger } from "@anonly/shared";

export function createNullLogger(): ILogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}
