/** M-V1 memory-only export transport under the unchanged product CSP.
 * Install only after original-import sampling ended. Keep the exact PDF Blob
 * associated with its native URL, then restore before closing the original app.
 * This state must never be projected, logged, or written to an artifact.
 */
interface V1ExportBlobReader {
  readonly original: typeof URL.createObjectURL;
  readonly blobs: Map<string, Blob>;
}
declare global {
  var __anonlyV1ExportBlobReader: V1ExportBlobReader | undefined;
}

export function installV1ExportBlobReaderInPage(): void {
  if (globalThis.__anonlyV1ExportBlobReader !== undefined)
    throw new Error("M-V1 export blob reader already installed");
  const state: V1ExportBlobReader = { original: URL.createObjectURL, blobs: new Map() };
  globalThis.__anonlyV1ExportBlobReader = state;
  URL.createObjectURL = function (this: typeof URL, object: Blob | MediaSource): string {
    const url = state.original.call(this, object);
    if (object instanceof Blob && object.type === "application/pdf") state.blobs.set(url, object);
    return url;
  };
}

export async function readV1ExportBlobInPage(input: {
  readonly href: string;
  readonly expectedBytes: number;
}): Promise<string> {
  const blob = globalThis.__anonlyV1ExportBlobReader?.blobs.get(input.href);
  if (blob === undefined) throw new Error("M-V1 exact export blob reference missing");
  if (
    !Number.isSafeInteger(input.expectedBytes) ||
    input.expectedBytes <= 0 ||
    blob.size !== input.expectedBytes
  )
    throw new Error("M-V1 export blob byte length mismatch");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength !== input.expectedBytes)
    throw new Error("M-V1 export blob read length mismatch");
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return btoa(binary);
}

export function restoreV1ExportBlobReaderInPage(): void {
  const state = globalThis.__anonlyV1ExportBlobReader;
  if (state === undefined) return;
  try {
    URL.createObjectURL = state.original;
  } finally {
    state.blobs.clear();
    globalThis.__anonlyV1ExportBlobReader = undefined;
  }
}
