import { contextBridge, ipcRenderer } from "electron";

/**
 * La superficie main↔renderer, completa (ADR-132 §3).
 *
 * Volvió a existir —ADR-132 §3 anticipaba que el actualizador traería el
 * primer canal real— y es lo más chica que resuelve el caso: **dos mensajes
 * salientes y un suscriptor**. Nada de `invoke` genérico, ningún acceso a
 * `ipcRenderer` crudo, ninguna capacidad de leer o escribir del sistema.
 *
 * La política de si se pregunta o se instala solo vive en el renderer, porque
 * ahí vive el setting del usuario (`settings.store.ts`, `localStorage`). El
 * main no decide: reporta lo que Sparkle informa y ejecuta lo que se le pide.
 *
 * **No hay `setAutomatic`, y sacarlo fue un arreglo.** Existió, y mapeaba a
 * `automaticallyChecksForUpdates` de Sparkle — que decide si Sparkle
 * **chequea**, no si instala sin preguntar. Con el toggle apagado, que es el
 * default, la app dejaba de buscar actualizaciones mientras la UI prometía
 * "te avisamos". El chequeo ahora es siempre; lo único que el usuario elige es
 * qué pasa cuando hay una, y eso se decide en el renderer sin cruzar el IPC.
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
});
