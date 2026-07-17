/**
 * `AbortRegistry`: `Map<signalId, AbortController>` (`05_Worker_Architecture.md`
 * §1.2). El Orchestrator crea un `AbortController` maestro por documento
 * (`signalId === documentId`, MVP: cancelación total de todo el pipeline del
 * documento, no granular por job — `07_Performance_Strategy.md` §9) y lo usa
 * para derivar el `AbortSignal` que viaja en cada `EngineContext` de las
 * invocaciones de ese documento.
 */

export class AbortRegistry {
  private readonly controllers = new Map<string, AbortController>();

  /** Crea (o reutiliza) el `AbortController` de `signalId`. */
  create(signalId: string): AbortController {
    const existing = this.controllers.get(signalId);
    if (existing !== undefined) return existing;
    const controller = new AbortController();
    this.controllers.set(signalId, controller);
    return controller;
  }

  get(signalId: string): AbortController | undefined {
    return this.controllers.get(signalId);
  }

  /** Aborta el controller de `signalId`, si existe. No-op si no existe. */
  abort(signalId: string): void {
    this.controllers.get(signalId)?.abort();
  }

  /** Libera la entrada de `signalId` (no aborta). */
  release(signalId: string): void {
    this.controllers.delete(signalId);
  }

  has(signalId: string): boolean {
    return this.controllers.has(signalId);
  }

  /** Aborta y libera todas las entradas (`dispose()` global). */
  clear(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}
