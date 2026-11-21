/**
 * `openDocumentLine.ts` — la línea de la barra que dice qué documento está
 * abierto (`Components.md` §2.1): `doc.pdf · 4 páginas`.
 *
 * Pura: los tests de `apps/react-client` corren en Node sin jsdom.
 */

/** `doc.pdf · 4 páginas`; sin páginas todavía, solo el nombre; sin documento, `null`. */
export function describeOpenDocument(name: string | null, pageCount: number): string | null {
  if (name === null || name.trim() === "") return null;
  if (pageCount <= 0) return name;
  return `${name} · ${pageCount} ${pageCount === 1 ? "página" : "páginas"}`;
}
