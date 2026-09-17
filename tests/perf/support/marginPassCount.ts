/**
 * `support/marginPassCount.ts` — conteo estructural de pasadas de margen
 * intentadas, para la precondición de
 * `Margenes_Menos_Pixeles_Implementacion_Handoff.md` §2: antes de medir
 * tiempo, confirmar que la compuerta de ADR-165 efectivamente dispara
 * (BEFORE `3650ce7`: 200 pasadas sobre P2; AFTER: 0).
 *
 * Instrumento MÍNIMO a propósito — no el `imageDataProfile.ts` completo de la
 * fase anterior (que cronometra por etapa, algo que esta precondición no
 * necesita): mismo concepto de "pasada" que su contador `passesExecuted`
 * ("franjas activas × 2 rotaciones", ver ese módulo), pero acá se cuenta
 * directo un solo número por página, sin desglose de intervalos. El patch
 * del kernel que produce este número (discardable, nunca commiteado) vive
 * fuera de este archivo; este módulo solo tipa, saca del worker al host
 * (mismo patrón que `installRunCollector`/`installMarginInkCollector`: evento
 * público `OCR_PAGE_FINISHED` + lectura de `ctx.cache`) y suma.
 */
import type { Page } from "@playwright/test";

export class MarginPassCountParseError extends Error {
  constructor(reason: string) {
    super(`Registro de conteo de pasadas de margen inválido: ${reason}`);
    this.name = "MarginPassCountParseError";
  }
}

/**
 * Clave del `ctx.cache` donde el `ocr.engine.ts` instrumentado deposita el
 * conteo de la página — misma correlación documentId+pageIndex que
 * `ocr-words:...`, sin canal nuevo. Duplicada LITERAL dentro de
 * `installMarginPassCountCollector` (corre vía `page.evaluate`, no puede
 * importar este módulo en runtime).
 */
export function marginPassCountCacheKey(documentId: string, pageIndex: number): string {
  return `margin-pass-count:${documentId}:${pageIndex}`;
}

declare global {
  var __anonlyMarginPassCount: unknown[] | undefined;
}

/** Instala el colector (mismo timing que `installRunCollector`: después de
 * `__anonlyCore`, antes de soltar el archivo, reinstalado por corrida). */
export async function installMarginPassCountCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente: ¿VITE_E2E=1 en el build?");
    const coreWithOcr = core as typeof core & {
      readonly engines: {
        readonly ocr: {
          readonly ctx?: {
            readonly cache?: {
              readonly get: <T>(key: string) => T | undefined;
            };
          };
        };
      };
    };

    const collected: unknown[] = [];
    globalThis.__anonlyMarginPassCount = collected;

    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const page2 = payload as { documentId?: unknown; pageIndex?: unknown };
      if (typeof page2.documentId !== "string" || typeof page2.pageIndex !== "number") return;
      const ocr = coreWithOcr.engines.ocr;
      const key = `margin-pass-count:${page2.documentId}:${page2.pageIndex}`;
      const value = ocr.ctx?.cache?.get<unknown>(key);
      if (value !== undefined) collected.push(value);
    });
  });
}

/** Lee, valida (entero >= 0, nunca un default en silencio) y suma los
 * conteos por página acumulados en la sesión. */
export async function readMarginPassCountTotal(page: Page): Promise<number> {
  const raw = await page.evaluate(() => globalThis.__anonlyMarginPassCount ?? []);
  return parseMarginPassCountEntries(raw);
}

/** Valida y suma un lote capturado; no admite defaults silenciosos. */
export function parseMarginPassCountEntries(raw: ReadonlyArray<unknown>): number {
  let total = 0;
  for (const entry of raw) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) {
      throw new MarginPassCountParseError(
        `valor no es un entero >= 0: ${typeof entry === "number" ? entry : JSON.stringify(entry)}`,
      );
    }
    total += entry;
  }
  return total;
}
