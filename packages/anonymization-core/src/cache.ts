/**
 * `ICache` LRU del host (checklist §15.2 del spec del Orchestrator).
 *
 * Fuente de verdad de la política: `07_Performance_Strategy.md` §6 ("Toda
 * LRU tiene límite por cantidad de items y por bytes, lo que se alcance
 * primero"). El spec del Orchestrator no fija un tamaño único para esta
 * caché genérica (distinta de los caches propios de cada motor, p. ej. el
 * LRU de `RenderEngine` que sí tiene `RenderConfig.cachePages`): esta caché
 * la usa el Orchestrator para su propio bookkeeping (p. ej. `ocr-words:` que
 * `PdfEngine.fuseOcrPage` consume, ADR-014). Se usa `WORDS_CACHE_PAGES = 32`
 * (Contracts.md §6, la constante nombrada más cercana en semántica: caché de
 * `Page.words`) como default de `maxItems`, con un piso de bytes generoso
 * como red de seguridad adicional — decisión de implementación acotada, no
 * un nuevo contrato público.
 */

import type { ICache } from "@anonly/shared";

const DEFAULT_MAX_ITEMS = 32; // WORDS_CACHE_PAGES (Contracts.md §6)
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024; // 64 MB, red de seguridad adicional

interface CacheEntry {
  readonly value: unknown;
  readonly bytes: number;
}

export interface LruCacheOptions {
  readonly maxItems?: number;
  readonly maxBytes?: number;
}

export class LruCache implements ICache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(options?: LruCacheOptions) {
    this.maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) return undefined;
    // Touch: re-insertar al final (más reciente) para la política LRU.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, bytes?: number): void {
    const size = bytes ?? 0;
    const existing = this.store.get(key);
    if (existing !== undefined) {
      this.totalBytes -= existing.bytes;
      this.store.delete(key);
    }
    this.store.set(key, { value, bytes: size });
    this.totalBytes += size;
    this.evictIfNeeded();
  }

  delete(key: string): void {
    const existing = this.store.get(key);
    if (existing === undefined) return;
    this.totalBytes -= existing.bytes;
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.store.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  private evictIfNeeded(): void {
    while (
      this.store.size > 0 &&
      (this.store.size > this.maxItems || this.totalBytes > this.maxBytes)
    ) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.delete(oldestKey);
    }
  }
}
