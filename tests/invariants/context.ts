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
import type { EngineContext } from "@anonly/shared";

import { buildDefaultEngineConfig } from "../../packages/anonymization-core/src/config.js";

const silentLogger = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
};

export function createEngineContext(): EngineContext {
  const store = new Map<string, unknown>();
  return {
    bus: createEventBus({ logger: silentLogger }),
    logger: silentLogger,
    cache: {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => void store.set(k, v),
      has: (k: string) => store.has(k),
      delete: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
    abortSignal: new AbortController().signal,
    config: buildDefaultEngineConfig(),
  } as unknown as EngineContext;
}
