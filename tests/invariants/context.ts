/**
 * `EngineContext` mínimo para correr un motor suelto fuera de `createCore`.
 *
 * Existe porque los invariantes necesitan las **páginas**, y los eventos del
 * bus no las llevan (`PAGE_PARSED` trae `wordCount`, no las `Word`). La
 * alternativa era exponer el documento en `IPipelineOrchestrator`, que es un
 * cambio de contrato público para una necesidad de test.
 *
 * No usa los helpers de `packages/**\/__tests__` a propósito: esos importan
 * `vitest` y este módulo también corre desde el script de `tsx`.
 */
import { createEventBus } from "@anonly/event-system";
import type { EngineContext, ICache } from "@anonly/shared";

import { buildDefaultEngineConfig } from "../../packages/anonymization-core/src/config.js";

const silentLogger = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
};

/**
 * `ICache` sin evicción: los invariantes corren un documento por proceso, así
 * que no hay presupuesto que administrar. `bytes` cuenta solo lo que el caller
 * declara, igual que `MemoryCache` — una entrada guardada sin `bytes` pesa 0.
 */
function createCache(): ICache {
  const store = new Map<string, { value: unknown; bytes: number }>();
  return {
    get<T>(key: string): T | undefined {
      const entry = store.get(key);
      return entry === undefined ? undefined : (entry.value as T);
    },
    set<T>(key: string, value: T, bytes?: number): void {
      store.set(key, { value, bytes: bytes ?? 0 });
    },
    delete(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    get size(): number {
      return store.size;
    },
    get bytes(): number {
      let total = 0;
      for (const entry of store.values()) total += entry.bytes;
      return total;
    },
  };
}

export function createEngineContext(): EngineContext {
  return {
    bus: createEventBus({ logger: silentLogger }),
    logger: silentLogger,
    cache: createCache(),
    abortSignal: new AbortController().signal,
    config: buildDefaultEngineConfig(),
  };
}
