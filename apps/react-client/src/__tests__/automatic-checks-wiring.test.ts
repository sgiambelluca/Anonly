/**
 * Gate barato para que borrar el cableado de ADR-188 §2 no pase
 * desapercibido: hoy nada rompe si alguien saca la llamada real a
 * `bootstrapAutomaticChecksPreference` de `App.tsx` o a
 * `syncAutomaticChecksPreference` de `SettingsDialog.tsx` — las funciones
 * puras siguen probadas por su cuenta (`app-startup.test.ts`,
 * `update-preference-sync.test.ts`), pero eso no prueba que alguien las siga
 * llamando. Mismo mecanismo que `settings-dialog-updates-section.test.ts`:
 * leer el fuente y buscar texto, con los comentarios sacados antes — un
 * comentario que mencione el nombre de la función (como el párrafo de acá
 * arriba) daría un falso positivo si se buscara sobre el texto crudo.
 *
 * No se aisló el cuerpo de `applyToStore` para el segundo caso: es una
 * función anidada dentro de un componente, con un parámetro tipado como
 * objeto en la misma firma (`next: { ... }`), y extraerla por conteo de
 * llaves —el mecanismo de `sourceText.ts` en `apps/desktop-shell`— confunde
 * la llave del tipo del parámetro con la del cuerpo. Complica la extracción
 * más de lo que vale para lo que este test verifica: alcanza con la presencia
 * de la llamada, fuera de comentarios, en todo el archivo.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP_PATH = fileURLToPath(new URL("../App.tsx", import.meta.url));
const SETTINGS_DIALOG_PATH = fileURLToPath(
  new URL("../components/toolbar/SettingsDialog.tsx", import.meta.url),
);

/** Igual que en `settings-dialog-updates-section.test.ts` (no se comparte entre paquetes). */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("cableado real de la preferencia de búsqueda automática (ADR-188 §2)", () => {
  it("App.tsx llama a bootstrapAutomaticChecksPreference", () => {
    const fuente = sinComentarios(readFileSync(APP_PATH, "utf8"));
    expect(fuente).toContain("bootstrapAutomaticChecksPreference(");
  });

  it("SettingsDialog.tsx llama a syncAutomaticChecksPreference", () => {
    const fuente = sinComentarios(readFileSync(SETTINGS_DIALOG_PATH, "utf8"));
    expect(fuente).toContain("syncAutomaticChecksPreference(");
  });
});
