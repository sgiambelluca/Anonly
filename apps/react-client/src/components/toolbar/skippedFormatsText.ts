/**
 * `skippedFormatsText.ts` — los textos del aviso de formatos que no se
 * aplicaron (`React_Client.md` §3.11, `Components.md` §13b.8, ADR-220 §6,
 * ADR-229 §7).
 *
 * `REGEX_FINISHED.skippedFormats` dice qué formato **del usuario** no corrió en
 * qué páginas (`regex-engine` solo lo informa para formatos propios y
 * referencias). Un formato que no pudo ni armarse figura con **todas** las
 * páginas: se dice «Todo el documento» y no se ofrece ir a ninguna. El aviso no
 * bloquea la exportación (igual que las páginas ilegibles, ADR-190).
 *
 * Una lista vacía de páginas no debería llegar. Si llega se trata como el
 * documento entero: es el lado seguro, porque avisar de más cuesta un renglón y
 * callar deja un dato con esa forma a la vista.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

/** Lo que `REGEX_FINISHED.skippedFormats` trae por formato. Páginas desde 0. */
export interface SkippedFormat {
  readonly formatId: string;
  readonly pageIndices: ReadonlyArray<number>;
}

export interface SkippedFormatEntry {
  readonly formatId: string;
  readonly name: string;
  /** Páginas desde 0, sin repetir y en orden. Vacío si falló en todo el documento. */
  readonly pages: ReadonlyArray<number>;
  readonly wholeDocument: boolean;
}

/** El aviso ya armado: el texto de la barra y a dónde lleva el botón. */
export interface SkippedFormatsNotice {
  readonly entries: ReadonlyArray<SkippedFormatEntry>;
  readonly message: string;
  /** Primera página (desde 0) de la que ofrece ir «Ir a la página N»; `null` si no hay ninguna. */
  readonly goToPage: number | null;
}

export const SKIPPED_FORMATS_WHOLE_DOCUMENT = "Todo el documento";

/** «Ir a la página 3» (`pageIndex` desde 0). */
export function goToPageLabel(pageIndex: number): string {
  return `Ir a la página ${pageIndex + 1}`;
}

/**
 * Las entradas listas para mostrar. `nameOf` resuelve el nombre del formato.
 * Los números de página se normalizan: sin repetir, en orden, dentro del
 * documento cuando se conoce su tamaño (`pageCount > 0`).
 */
export function buildSkippedEntries(
  skipped: ReadonlyArray<SkippedFormat>,
  pageCount: number,
  nameOf: (formatId: string) => string,
): ReadonlyArray<SkippedFormatEntry> {
  return skipped.map((item) => {
    const pages = [...new Set(item.pageIndices)]
      .filter((page) => Number.isInteger(page) && page >= 0 && (pageCount <= 0 || page < pageCount))
      .sort((a, b) => a - b);
    const wholeDocument = pages.length === 0 || (pageCount > 0 && pages.length >= pageCount);
    return {
      formatId: item.formatId,
      name: nameOf(item.formatId),
      pages: wholeDocument ? [] : pages,
      wholeDocument,
    };
  });
}

/**
 * Números de página (desde 0) como los lee una persona: «3», «3 y 4»,
 * «3, 4 y 7». Una corrida de tres o más seguidas se resume: «3 a 6».
 */
export function formatPageList(pages: ReadonlyArray<number>): string {
  const parts: string[] = [];
  let index = 0;
  while (index < pages.length) {
    let end = index;
    while (end + 1 < pages.length && (pages[end + 1] ?? 0) === (pages[end] ?? 0) + 1) end += 1;
    const first = (pages[index] ?? 0) + 1;
    const last = (pages[end] ?? 0) + 1;
    if (end - index >= 2) {
      parts.push(`${first} a ${last}`);
    } else {
      for (let page = index; page <= end; page += 1) parts.push(String((pages[page] ?? 0) + 1));
    }
    index = end + 1;
  }
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

function pagesPhrase(pages: ReadonlyArray<number>): string {
  return pages.length === 1
    ? `la página ${formatPageList(pages)}`
    : `las páginas ${formatPageList(pages)}`;
}

/** La primera página de la que se puede ir: la primera del primer formato que no falló entero. */
export function firstGoToPage(entries: ReadonlyArray<SkippedFormatEntry>): number | null {
  for (const entry of entries) {
    const first = entry.pages[0];
    if (!entry.wholeDocument && first !== undefined) return first;
  }
  return null;
}

/** `null` si no hay nada que avisar. El texto de la barra (ADR-229 §7). */
export function buildSkippedFormatsNotice(
  entries: ReadonlyArray<SkippedFormatEntry>,
): SkippedFormatsNotice | null {
  const [only, ...rest] = entries;
  if (only === undefined) return null;

  let message: string;
  if (rest.length === 0) {
    if (only.wholeDocument) {
      message = `El formato «${only.name}» no se aplicó en todo el documento. Revisalo antes de exportar.`;
    } else {
      const single = only.pages.length === 1;
      message = `El formato «${only.name}» no se aplicó en ${pagesPhrase(only.pages)}. ${
        single ? "Revisala" : "Revisalas"
      } antes de exportar.`;
    }
  } else {
    const items = entries.map(
      (entry) =>
        `«${entry.name}» (${entry.wholeDocument ? "todo el documento" : formatPageList(entry.pages)})`,
    );
    const list = `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
    message = `${entries.length} formatos tuyos no se aplicaron en algunas páginas: ${list}.`;
  }

  return { entries, message, goToPage: firstGoToPage(entries) };
}

/** El encabezado del aviso en el diálogo de exportar (`ExportarDocumento.dc.html`). */
export function exportNoticeTitle(entries: ReadonlyArray<SkippedFormatEntry>): string {
  const [only, ...rest] = entries;
  if (only === undefined) return "";
  if (rest.length > 0) {
    return `${entries.length} formatos tuyos no se aplicaron en parte del documento`;
  }
  if (only.wholeDocument) return `El formato «${only.name}» no se aplicó en todo el documento`;
  return `El formato «${only.name}» no se aplicó en ${
    only.pages.length === 1 ? "1 página" : `${only.pages.length} páginas`
  }`;
}

/** Lo que dice el diálogo de exportar debajo del encabezado, igual para uno o varios formatos. */
export const EXPORT_NOTICE_BODY =
  "Donde no se aplicó, un dato con esa forma puede quedar a la vista. Revisá esas páginas o exportá igual.";

/** «Páginas 3 y 4», «Página 7» o «Todo el documento»: la columna de páginas de una fila. */
export function exportRowPages(entry: SkippedFormatEntry): string {
  if (entry.wholeDocument) return SKIPPED_FORMATS_WHOLE_DOCUMENT;
  return entry.pages.length === 1
    ? `Página ${formatPageList(entry.pages)}`
    : `Páginas ${formatPageList(entry.pages)}`;
}

/** El botón de una fila: `null` si falló en todo el documento (no hay a dónde ir). */
export function exportRowGoTo(entry: SkippedFormatEntry): number | null {
  return entry.wholeDocument ? null : (entry.pages[0] ?? null);
}
