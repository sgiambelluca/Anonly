import { contextBridge, ipcRenderer } from "electron";

/**
 * La superficie main↔renderer, completa (ADR-132 §3): `anonlyUpdater` y, desde
 * ADR-194, `anonlyDevice`, un dato de solo lectura (más abajo).
 *
 * Volvió a existir —ADR-132 §3 anticipaba que el actualizador traería el
 * primer canal real— y es lo más chica que resuelve el caso: **cuatro mensajes
 * salientes (el cuarto, `setInstallOnQuit`, lo agregó ADR-197) y un suscriptor**. Nada de `invoke` genérico, ningún acceso a
 * `ipcRenderer` crudo, ninguna capacidad de leer o escribir del sistema.
 *
 * La política de si se pregunta o se instala solo vive en el renderer, porque
 * ahí vive el setting del usuario (`settings.store.ts`, `localStorage`). El
 * main no decide: reporta lo que Sparkle informa y ejecuta lo que se le pide.
 *
 * **`setAutomaticChecks` (ADR-188) no es el `setAutomatic` que existió y se
 * retiró.** Aquel mapeaba a `automaticallyChecksForUpdates` de Sparkle
 * —decide si Sparkle **busca**, no si instala sin preguntar— pero colgaba del
 * toggle de instalar, "Actualizar automáticamente". Con el toggle apagado,
 * que es el default, la app dejaba de buscar actualizaciones mientras la UI
 * prometía "te avisamos": el arreglo de entonces fue sacar el mensaje y
 * buscar siempre. Eso corrigió la confusión entre buscar e instalar, pero se
 * llevó también la posibilidad de no buscar, que ADR-131 §5 sí exige. Este
 * mensaje cuelga de una preferencia propia, «Buscar actualizaciones
 * automáticamente» (`checkUpdates`), que significa exactamente lo que
 * significa la propiedad de Sparkle: buscar, no instalar.
 */
contextBridge.exposeInMainWorld("anonlyUpdater", {
  /** Se suscribe al ciclo de vida de la actualización. Nunca lleva contenido de un documento. */
  onEvent(listener: (event: { type: string; version?: string; percent?: number }) => void): void {
    ipcRenderer.on("updater:event", (_event, payload) => {
      listener(payload as { type: string; version?: string; percent?: number });
    });
  },
  /** Pide chequear ahora (el botón "Buscar actualizaciones"). */
  check(): void {
    ipcRenderer.send("updater:check");
  },
  /** Aplica la actualización ya descargada y reinicia. */
  install(): void {
    ipcRenderer.send("updater:install");
  },
  /**
   * Informa si el usuario quiere que la app busque actualizaciones por su
   * cuenta (ADR-188 §2). El main no consulta nada hasta que este mensaje
   * llega la primera vez.
   */
  setAutomaticChecks(enabled: boolean): void {
    ipcRenderer.send("updater:set-automatic-checks", enabled);
  },
  /**
   * Informa si el usuario quiere que la actualización se instale al cerrar la
   * aplicación (ADR-197 §3): `true` solo con `updateMode === "install"`. Hasta
   * que llega, el contenedor no instala al cerrar. Un valor que no sea
   * `boolean` se ignora. En macOS se recibe y no tiene efecto.
   */
  setInstallOnQuit(enabled: boolean): void {
    ipcRenderer.send("updater:set-install-on-quit", enabled);
  },
});

/*
 * `anonlyDevice` (ADR-194 §4): la RAM instalada, que el main pasa como
 * argumento (`--anonly-total-memory-bytes=<entero>`) y no por IPC. Se expone
 * solo si es un entero positivo; si no, el objeto no existe y el renderer cae
 * en la rama «sin el dato». Es el único campo del sistema que cruza.
 */
const TOTAL_MEMORY_ARG = "--anonly-total-memory-bytes=";

function readTotalMemoryBytes(argv: ReadonlyArray<string>): number | null {
  const arg = argv.find((entry) => entry.startsWith(TOTAL_MEMORY_ARG));
  if (arg === undefined) return null;
  const raw = arg.slice(TOTAL_MEMORY_ARG.length);
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/*
 * `platform` (ADR-197 §6): `"windows"`, `"macos"` u `"other"`, por el mismo
 * camino (`--anonly-platform=<valor>`). Cualquier otro valor se descarta. El
 * preload sandboxeado no puede importar `device-platform.ts`, así que la lista
 * se repite acá.
 */
const PLATFORM_ARG = "--anonly-platform=";

function readPlatform(argv: ReadonlyArray<string>): "windows" | "macos" | "other" | null {
  const arg = argv.find((entry) => entry.startsWith(PLATFORM_ARG));
  if (arg === undefined) return null;
  const raw = arg.slice(PLATFORM_ARG.length);
  return raw === "windows" || raw === "macos" || raw === "other" ? raw : null;
}

const totalMemoryBytes = readTotalMemoryBytes(process.argv);
const platform = readPlatform(process.argv);
if (totalMemoryBytes !== null || platform !== null) {
  contextBridge.exposeInMainWorld("anonlyDevice", {
    ...(totalMemoryBytes === null ? {} : { totalMemoryBytes }),
    ...(platform === null ? {} : { platform }),
  });
}
