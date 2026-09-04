/**
 * `UpdateNotice` — el aviso de que hay una versión nueva.
 *
 * **Acá vive la política de actualización, y es a propósito.** El shell no
 * decide: reporta lo que Sparkle informa y ejecuta lo que se le pide
 * (ADR-131 §3). La preferencia del usuario —`autoUpdate`— se persiste con el
 * resto de los settings, así que el único lugar donde están juntas la
 * preferencia y el evento es el renderer.
 *
 * El default es preguntar. Reemplazarle la aplicación en silencio a alguien
 * que está anonimizando pericias es exactamente el tipo de cosa que genera
 * desconfianza en una herramienta que se vende como local, aunque
 * técnicamente sea correcta. Quien prefiera que no le pregunten más lo apaga
 * en Configuración.
 *
 * Fuera del contenedor de escritorio no renderiza nada: no hay actualizador.
 */

import { useEffect, useState } from "react";

import { useSettingsStore } from "../../store/settings.store.js";
import { getShellUpdater, type ShellUpdater } from "../../updater/index.js";

import { Banner } from "./Banner.js";
import { Button } from "./Button.js";

/** Sparkle avisa con este evento que la actualización ya está bajada y lista. */
const READY = "update-downloaded";

export function UpdateNotice() {
  const autoUpdate = useSettingsStore((state) => state.autoUpdate);
  const [updater] = useState<ShellUpdater | null>(() => getShellUpdater());
  const [readyVersion, setReadyVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (updater === null) return;
    updater.onEvent((event) => {
      if (event.type !== READY) return;
      setReadyVersion(event.version ?? "");
      setDismissed(false);
    });
    /*
     * Sin cleanup: el puente del preload expone `onEvent` como suscripción
     * única para toda la vida de la ventana, no un emisor con `off`. Este
     * componente se monta una vez en la raíz de la app y no se desmonta, así
     * que no hay fuga que evitar — y agregar un `off` al preload sería ampliar
     * la superficie main↔renderer por una limpieza que nadie ejecuta.
     */
  }, [updater]);

  /*
   * El instalar-solo va acá y no en el handler de arriba porque depende de un
   * setting que el usuario puede cambiar **después** de que la actualización
   * ya se descargó: si la prende con el aviso en pantalla, se aplica sola sin
   * que tenga que apretar nada más.
   */
  useEffect(() => {
    if (updater === null || readyVersion === null || !autoUpdate) return;
    updater.install();
  }, [updater, readyVersion, autoUpdate]);

  if (updater === null || readyVersion === null || dismissed || autoUpdate) return null;

  /*
   * Flotante y no en el flujo del layout: las tres fases de la app usan
   * `h-screen`, así que un banner en el flujo empujaría el contenido fuera de
   * la pantalla. Arriba y no abajo para no chocar con el viewport de toasts,
   * que vive en `bottom-4` con `z-[100]`.
   */
  return (
    <div className="fixed left-1/2 top-4 z-[90] w-max max-w-[90vw] -translate-x-1/2">
      <Banner
        variant="info"
        actions={
          <>
            <Button variant="secondary" onClick={() => setDismissed(true)}>
              Más tarde
            </Button>
            <Button onClick={() => updater.install()}>Instalar y reiniciar</Button>
          </>
        }
      >
        {readyVersion === ""
          ? "Hay una versión nueva de Anonly lista para instalar."
          : `La versión ${readyVersion} de Anonly está lista para instalar.`}
      </Banner>
    </div>
  );
}
