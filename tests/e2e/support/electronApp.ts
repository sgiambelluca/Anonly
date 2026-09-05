/**
 * `support/electronApp.ts` — el `test` de los E2E, apuntado al shell.
 *
 * Desde ADR-130 el producto **es** la app de escritorio: correr los escenarios
 * contra un navegador probaría un target que ya no se publica, y dejaría sin
 * cubrir justo lo que el contenedor cambia — el protocolo `app://`, el
 * aislamiento de origen que sirve el propio shell, y los cinco workers de
 * motor cargando bajo ese esquema.
 *
 * Los specs siguen escribiéndose igual: reciben `page` y hacen
 * `page.goto("/")`. Lo único que cambia es de dónde sale esa `page` y a qué
 * resuelve `/` — el `baseURL` de `playwright.electron.config.ts` es
 * `app://local`. Por eso este módulo re-exporta `expect`: así un spec importa
 * todo de un solo lugar y no queda mitad de acá y mitad de `@playwright/test`.
 *
 * Una instancia de Electron por test, no una compartida: los escenarios tocan
 * `localStorage` y el estado del pipeline, y compartir el proceso los volvería
 * dependientes del orden en que corren.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SHELL_DIR = resolve(ROOT, "apps/desktop-shell");
const ELECTRON_BIN = resolve(SHELL_DIR, "node_modules/.bin/electron");

export interface ElectronFixtures {
  readonly electronApp: ElectronApplication;
}

export const test = base.extend<ElectronFixtures>({
  // eslint-disable-next-line no-empty-pattern -- la firma de fixture de Playwright exige el patrón, no hay dependencias que desestructurar
  electronApp: async ({}, use) => {
    /*
     * **Un directorio de datos por test.** Sin esto todas las instancias
     * comparten el perfil por defecto de la app, y con él el `localStorage`:
     * los settings que un spec escribe sobreviven al siguiente.
     *
     * No es teórico. `scenario-8` apaga la detección de nombres con
     * `settingsOverride`, y eso se filtraba a `scenario-5`, que necesita que
     * NER corra: el pipeline pasaba de "Leyendo el texto…" a "Listo" sin
     * detectar nada, y el spec fallaba **solo cuando corría después** de
     * scenario-8 — pasaba perfecto si se lo corría solo.
     *
     * Contra el navegador esto no existía: cada test de Playwright arranca con
     * almacenamiento limpio. Es aislamiento que el target de escritorio no
     * regala y hay que construir.
     */
    const userDataDir = await mkdtemp(join(tmpdir(), "anonly-e2e-"));
    const app = await electron.launch({
      args: [SHELL_DIR, `--user-data-dir=${userDataDir}`],
      executablePath: ELECTRON_BIN,
    });
    await use(app);
    await app.close();
    await rm(userDataDir, { recursive: true, force: true });
  },

  /*
   * Se pisa el fixture `page` de Playwright en vez de agregar uno nuevo para
   * que los specs no cambien: siguen recibiendo `page` y no necesitan saber
   * que del otro lado hay un proceso de Electron y no un navegador.
   */
  page: async ({ electronApp }, use) => {
    const window: Page = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await use(window);
  },
});

/**
 * Espera a que la app esté lista. **Reemplaza al `page.goto("/")`** que los
 * specs hacían contra el navegador.
 *
 * No hay a dónde navegar: el shell abre la ventana ya cargada en
 * `app://local/index.html`, y un `goto` explícito choca contra esa navegación
 * inicial —Playwright falla con "interrupted by another navigation"—. Cada
 * test recibe además su propia instancia de Electron, así que no hay estado
 * de un test anterior del que haya que recargar para escapar.
 */
export async function openApp(
  page: Page,
  waitUntil: "domcontentloaded" | "networkidle" = "domcontentloaded",
): Promise<void> {
  /*
   * `networkidle` se traduce a `load`. **No es aflojar la espera: es que bajo
   * `app://` ese criterio no existe.** "Red ociosa" se define como 500 ms sin
   * requests en vuelo, y acá no hay red — el protocolo sirve archivos locales
   * del propio paquete. Medido: seis specs fallaban con
   * `net::ERR_ABORTED; maybe frame was detached?` esperando algo que nunca
   * iba a llegar. `load` sí significa lo mismo en los dos targets: el
   * documento y sus subrecursos terminaron de cargar.
   */
  const criterion = waitUntil === "networkidle" ? "load" : waitUntil;

  /*
   * **Esperar la carga inicial ANTES de recargar.** El shell empieza a cargar
   * la app apenas abre la ventana, sin que el test participe; recargar con esa
   * navegación todavía en vuelo hace que las dos se cancelen entre sí, y cuál
   * gana depende de milisegundos. Medido: `net::ERR_ABORTED; maybe frame was
   * detached?` y `Target page, context or browser has been closed`, en specs
   * distintos en cada corrida.
   *
   * Es la diferencia de fondo con el target web: ahí Playwright abre una
   * pestaña vacía y la carga la dispara el test con `goto`. Acá la dispara la
   * aplicación, y el test llega después.
   */
  await page.waitForLoadState("load");
  /*
   * `reload` y no solo `waitForLoadState`: seis specs registran un
   * `addInitScript` —`support/settingsOverride.ts`— que tiene que correr
   * **antes** del bootstrap para que `initCore()` lea la config de prueba. Con
   * la ventana ya cargada, un script registrado después no corre nunca.
   * Recargar restituye exactamente la semántica que tenía `page.goto("/")`
   * contra el navegador: carga limpia, con los init scripts puestos.
   */
  await page.reload({ waitUntil: criterion });
}

/**
 * Espera una descarga y devuelve el nombre de archivo propuesto.
 *
 * **`page.waitForEvent("download")` no sirve en este target.** En un navegador
 * la descarga la maneja el contexto que Playwright controla; en Electron la
 * maneja la **sesión del proceso main**, así que el evento nunca llega al
 * `page` y el test se queda esperando 30 s. Verificado con una descarga
 * sintética: `will-download` sí dispara en main, con el nombre correcto.
 *
 * Esto no es una concesión del test: es dónde ocurre la descarga de verdad en
 * la app empaquetada. La cancela (`item.cancel()`) porque el objetivo es
 * afirmar que la exportación llega a producir un archivo con el nombre
 * pedido, no dejar PDFs sueltos en la carpeta de Descargas de quien corra la
 * suite.
 */
export async function expectDownloadFilename(
  electronApp: ElectronApplication,
  trigger: () => Promise<void>,
  timeoutMs = 30_000,
): Promise<string> {
  const filename = electronApp.evaluate(
    async ({ session }, timeout) =>
      await new Promise<string>((resolve) => {
        session.defaultSession.once("will-download", (_event, item) => {
          item.cancel();
          resolve(item.getFilename());
        });
        setTimeout(() => resolve("__sin-descarga__"), timeout);
      }),
    timeoutMs,
  );
  await trigger();
  return await filename;
}

export { expect } from "@playwright/test";
