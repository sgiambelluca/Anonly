/**
 * `updatePreferenceSync.ts` — qué hace `SettingsDialog.applyToStore` con la
 * preferencia de búsqueda automática al guardar (ADR-188 §2).
 *
 * Separado del componente por el mismo motivo que `appStartup.ts` (probar el
 * orden sin jsdom): la propiedad a sostener es "persistir primero, y avisar
 * al shell solo si `checkUpdates` cambió, en ese punto". ADR-188 §2 dice
 * literalmente "cada vez que el usuario guarda un CAMBIO de `checkUpdates`" —
 * mandar el mensaje en cada guardado sin mirar si cambió sería inofensivo
 * para el shell (que ya lo trata como idempotente), pero no es lo que el ADR
 * pide, y en Windows reabre sin necesidad la pregunta de si ya hubo una
 * búsqueda en esta ejecución.
 */

export interface UpdatePreferenceSyncDeps {
  /** Persiste el store ya actualizado (`useSettingsStore.getState().persist`). */
  readonly persist: () => void;
  /** `sendAutomaticChecksPreference` real, o un doble en los tests. */
  readonly send: (enabled: boolean) => void;
}

/**
 * Persiste y, solo si cambió que se busque o no (`updateMode`, ADR-195), avisa
 * al shell — en ese orden ("en el mismo punto donde se persiste", ADR-188 §2).
 */
export function syncAutomaticChecksPreference(
  previousCheckUpdates: boolean,
  nextCheckUpdates: boolean,
  deps: UpdatePreferenceSyncDeps,
): void {
  deps.persist();
  if (nextCheckUpdates !== previousCheckUpdates) deps.send(nextCheckUpdates);
}
