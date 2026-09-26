import { contextBridge, ipcRenderer } from "electron";

/**
 * La superficie main↔renderer, completa (ADR-132 §3).
 *
 * Volvió a existir —ADR-132 §3 anticipaba que el actualizador traería el
 * primer canal real— y es lo más chica que resuelve el caso: **tres mensajes
 * salientes y un suscriptor**. Nada de `invoke` genérico, ningún acceso a
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
});
