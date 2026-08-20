/**
 * `replacementFit.ts` — ¿el texto que el usuario escribió entra en la
 * ocurrencia más apretada del grupo?
 *
 * Lógica pura y separada del componente por el mismo motivo que
 * `canvasDimensions.ts`/`exportButtonVisibility.ts`: los tests de
 * `apps/react-client` corren en Node sin jsdom (`vitest.config.ts`), así que
 * lo que se puede testear no vive dentro de un `.tsx`.
 *
 * **Por qué hace falta el aviso**: una edición manual del `replacementValue`
 * **saltea la escalera de abreviaturas** (ADR-057 §7: *"la edición manual gana
 * siempre — la escalera no lo toca"*). La escalera existe justamente para
 * elegir un token que entre en la ocurrencia más apretada; al saltearla, un
 * texto largo llega al render, que lo encoge (ADR-058) y —si baja del umbral
 * de legibilidad— lo marca como degradado (ADR-062). El usuario merece
 * enterarse ANTES de escribirlo, no después de exportar.
 *
 * La estimación es la misma que usa el motor para elegir el nivel de
 * abreviatura (`estimateTokenWidth`, `Contracts.md` §6, ADR-057 §5): sin
 * canvas, determinista. Es una **estimación**, no una garantía — quien
 * garantiza que el texto no se derrame es el render (ADR-058 §1). Por eso el
 * veredicto se comunica como aviso y nunca bloquea el guardado.
 */

import { estimateTokenWidth, type OccurrenceRef } from "@anonly/anonymization-core";

export type ReplacementFit = "fits" | "tight" | "overflows" | "unknown";

/**
 * Margen de seguridad sobre el ancho disponible. La estimación no es exacta
 * (no hay `measureText` acá), así que un token que quede entre el 90% y el
 * 100% del ancho se reporta como "justo" en vez de "entra": es la banda donde
 * la diferencia entre la estimación y la medición real del render decide.
 */
const TIGHT_RATIO = 0.9;

/**
 * El rectángulo más apretado del grupo, en el mismo sentido que ADR-057 §4: el
 * peor caso manda, porque **todas** las ocurrencias comparten el valor
 * (invariante de ADR-012). Con `fragments` (ADR-074) se evalúa cada fragmento
 * por separado y no la envolvente, que es la corrección que ADR-074 §7 aplicó
 * a la escalera: una envolvente de dos líneas es ancha y no aprieta nada.
 */
function tightestBox(
  members: ReadonlyArray<OccurrenceRef>,
): { readonly width: number; readonly height: number } | null {
  let tightest: { readonly width: number; readonly height: number } | null = null;
  for (const member of members) {
    for (const box of member.fragments ?? [member.bbox]) {
      if (box.height <= 0 || box.width <= 0) continue;
      if (tightest === null || box.width < tightest.width) {
        tightest = { width: box.width, height: box.height };
      }
    }
  }
  return tightest;
}

/**
 * `unknown` cuando el grupo no tiene ninguna caja utilizable (sin members, o
 * con geometría degenerada): no se inventa un veredicto, se calla.
 */
export function estimateReplacementFit(
  value: string,
  members: ReadonlyArray<OccurrenceRef>,
): ReplacementFit {
  const box = tightestBox(members);
  if (box === null) return "unknown";
  if (value.length === 0) return "fits";

  const estimated = estimateTokenWidth(value.length, box.height);
  if (estimated > box.width) return "overflows";
  if (estimated > box.width * TIGHT_RATIO) return "tight";
  return "fits";
}
