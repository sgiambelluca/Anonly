/**
 * `BlobUrlTracker`: rastrea blob URLs por clave y revoca el anterior de esa
 * clave al recibir un reemplazo (ADR-034 §5, ADR-031 §5, `07_Performance_Strategy.md`
 * §8). Los motores **crean** los blob URLs en su lado host
 * (`PREVIEW_UPDATED.canvasBlobUrl`, `EXPORT_FINISHED.blobUrl`); el
 * Orchestrator solo los registra y revoca — nunca los crea.
 *
 * Claves: preview `preview:<documentId>:<pageIndex>:<kind>`; export
 * `export:<documentId>` (spec del Orchestrator §2/§8).
 */

export class BlobUrlTracker {
  private readonly urlsByKey = new Map<string, string>();

  /** Registra `url` para `key`; revoca el URL anterior de esa clave si difiere. */
  set(key: string, url: string): void {
    const previous = this.urlsByKey.get(key);
    if (previous !== undefined && previous !== url) {
      URL.revokeObjectURL(previous);
    }
    this.urlsByKey.set(key, url);
  }

  get(key: string): string | undefined {
    return this.urlsByKey.get(key);
  }

  /** Revoca todos los URLs cuya clave empieza con `prefix` (p. ej. `preview:<documentId>:`). */
  revokeByPrefix(prefix: string): void {
    for (const [key, url] of [...this.urlsByKey.entries()]) {
      if (!key.startsWith(prefix)) continue;
      URL.revokeObjectURL(url);
      this.urlsByKey.delete(key);
    }
  }

  /** Revoca todos los URLs rastreados (`dispose()` global). */
  revokeAll(): void {
    for (const url of this.urlsByKey.values()) URL.revokeObjectURL(url);
    this.urlsByKey.clear();
  }

  get size(): number {
    return this.urlsByKey.size;
  }
}

export function previewBlobKey(
  documentId: string,
  pageIndex: number,
  kind: "original" | "anonymized",
): string {
  return `preview:${documentId}:${pageIndex}:${kind}`;
}

export function exportBlobKey(documentId: string): string {
  return `export:${documentId}`;
}

export function documentPrefix(documentId: string): string {
  // documentId es UUID v4 (03_Data_Model.md §2): sin ":" propio, no colisiona
  // con otro documentId (mismo criterio que RenderEngine.clearDocumentState).
  return `${documentId}:`;
}

export function previewPrefixFor(documentId: string): string {
  return `preview:${documentPrefix(documentId)}`;
}

export function exportPrefixFor(documentId: string): string {
  return `export:${documentId}`;
}
