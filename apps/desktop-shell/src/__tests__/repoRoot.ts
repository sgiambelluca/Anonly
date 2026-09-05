/**
 * La raíz del repo, encontrada **subiendo** desde el directorio de trabajo.
 *
 * Los tests que leen archivos del repo —el propio código del shell, la config
 * de `electron-builder`— necesitan una ruta absoluta. Tomar `process.cwd()`
 * como si fuera la raíz ataba el test al lugar desde el cual se lo invoca:
 * andaba con `pnpm test` desde la raíz y fallaba con
 * `pnpm --filter @anonly/desktop-shell test`, que corre con el cwd adentro del
 * paquete.
 *
 * Subir hasta `pnpm-workspace.yaml` funciona desde los dos lados, porque el
 * cwd siempre está adentro del repo. Se busca ese marcador y no `.git`: un
 * checkout de un submódulo o un worktree tienen `.git` y no son esta raíz.
 *
 * **No se usa `import.meta.url`**, que sería lo natural: este paquete compila
 * a CommonJS —`sandbox: true` obliga a que el preload lo sea (ADR-132 §3)— y
 * `tsc` rechaza `import.meta` bajo ese `module`, aunque vitest lo transpile
 * bien en runtime.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function buscarRaiz(desde: string): string {
  let actual = desde;
  for (;;) {
    if (existsSync(join(actual, "pnpm-workspace.yaml"))) return actual;
    const padre = dirname(actual);
    // `dirname("/")` es `"/"`: sin este corte, el bucle no termina.
    if (padre === actual) {
      throw new Error(`no se encontró pnpm-workspace.yaml subiendo desde ${desde}`);
    }
    actual = padre;
  }
}

export const RAIZ_DEL_REPO = buscarRaiz(process.cwd());

/** Una ruta absoluta a partir de un path relativo a la raíz del repo. */
export function desdeLaRaiz(...partes: string[]): string {
  return resolve(RAIZ_DEL_REPO, ...partes);
}
