/**
 * `UpdateNotice` — el aviso del ciclo de una versión nueva (ADR-197 §4).
 *
 * Una tarjeta con el estilo de un toast, abajo a la derecha (ADR-197 §4), con
 * los mismos tamaños en todos los estados (UX-10): descargando, lista en modo
 * `install` y lista en modo `notify`/`off`. Los estados, los textos y la
 * decisión de instalar al abrir viven en `updateNoticeState.ts`, puro y
 * probado sin jsdom; acá solo se pinta.
 *
 * **La interfaz ya no pide la instalación por su cuenta** (ADR-197 §4). Quien
 * instala al cerrar es el contenedor, que conoce el modo por
 * `updater:set-install-on-quit` (ADR-197 §3); el aviso solo informa y ofrece
 * «Reiniciar». La única excepción es macOS (ADR-197 §6), donde la instalación
 * es al abrir y la decide `nextUpdateNotice`. La plataforma la informa el
 * contenedor (`anonlyDevice.platform`); sin ese dato, o fuera de Windows y
 * macOS, `install` se comporta como `notify`.
 *
 * El default es preguntar. Reemplazarle la aplicación en silencio a alguien
 * que está anonimizando pericias es exactamente el tipo de cosa que genera
 * desconfianza en una herramienta que se vende como local, aunque
 * técnicamente sea correcta. Quien prefiera que no le pregunten más lo
 * cambia en Configuración.
 *
 * Fuera del contenedor de escritorio no renderiza nada: no hay actualizador.
 */

import { CheckIcon, DownloadIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { readShellPlatform } from "../../core-adapter/settingsToEngineConfig.js";
import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { useSettingsStore } from "../../store/settings.store.js";
import { getShellUpdater, type ShellUpdater } from "../../updater/index.js";

import {
  describeUpdateNotice,
  dismissUpdateNotice,
  IDLE_UPDATE_NOTICE,
  isImportInProgress,
  nextUpdateNotice,
  type UpdateNoticeState,
} from "./updateNoticeState.js";

/** Alto de la tarjeta (6,5 rem + 2 px de borde) + su `bottom-5` + 0,75 rem de aire. */
const UPDATE_CARD_TOAST_OFFSET = "calc(8.5rem + 2px)";

export function UpdateNotice() {
  const updateMode = useSettingsStore((state) => state.updateMode);
  const documentOpen = useDocumentStore((state) => state.id !== null);
  const importInProgress = usePipelineStore((state) => isImportInProgress(state.stage));
  const [updater] = useState<ShellUpdater | null>(() => getShellUpdater());
  // ADR-197 §6: dato de solo lectura del contenedor; sin dato es "other" (avisa y espera).
  const [platform] = useState(() => readShellPlatform());
  const [notice, setNotice] = useState<UpdateNoticeState>(IDLE_UPDATE_NOTICE);

  /*
   * La suscripción al preload es única y sin `off` (ver abajo), así que lo que
   * cambia con el tiempo —el modo y si hubo un documento— se lee por ref en el
   * momento de cada evento y no del cierre del primer render.
   */
  const noticeRef = useRef<UpdateNoticeState>(IDLE_UPDATE_NOTICE);
  const modeRef = useRef(updateMode);
  const documentOpenRef = useRef(documentOpen);
  const documentOpenedRef = useRef(documentOpen);
  const importRef = useRef(importInProgress);
  modeRef.current = updateMode;
  documentOpenRef.current = documentOpen;
  importRef.current = importInProgress;

  // Una importación en curso cuenta como documento abierto (ADR-197 §6): el
  // `id` del document store recién se fija al terminar la carga.
  useEffect(() => {
    if (documentOpen || importInProgress) documentOpenedRef.current = true;
  }, [documentOpen, importInProgress]);

  useEffect(() => {
    if (updater === null) return;
    updater.onEvent((event) => {
      const transition = nextUpdateNotice(noticeRef.current, event, {
        platform,
        updateMode: modeRef.current,
        documentOpen: documentOpenRef.current,
        importInProgress: importRef.current,
        documentOpenedThisSession: documentOpenedRef.current,
      });
      noticeRef.current = transition.state;
      setNotice(transition.state);
      if (transition.installNow) updater.install();
    });
    /*
     * Sin cleanup: el puente del preload expone `onEvent` como suscripción
     * única para toda la vida de la ventana, no un emisor con `off`. Este
     * componente se monta una vez en la raíz de la app y no se desmonta, así
     * que no hay fuga que evitar — y agregar un `off` al preload sería ampliar
     * la superficie main↔renderer por una limpieza que nadie ejecuta.
     */
  }, [updater, platform]);

  const view = describeUpdateNotice(notice, updateMode, platform);
  const visible = updater !== null && view !== null;

  /*
   * Los toasts suben por encima de la tarjeta mientras está: el viewport de
   * `ToastHost` lee `--anonly-toast-bottom` (por defecto, su `bottom-5` de
   * siempre). La tarjeta tiene alto fijo, así que el desplazamiento es una
   * constante y no hace falta medir nada.
   */
  useEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    root.style.setProperty("--anonly-toast-bottom", UPDATE_CARD_TOAST_OFFSET);
    return () => {
      root.style.removeProperty("--anonly-toast-bottom");
    };
  }, [visible]);

  if (updater === null || view === null) return null;

  /*
   * Tarjeta con el estilo de un toast (ADR-197 §4): mismo ancho, ícono redondo,
   * título, un renglón de detalle, una acción y la X; fondo sólido
   * (`bg-bg-primary`, token existente, claro y oscuro). Abajo a la derecha,
   * debajo de los toasts (UX-10: no desplaza nada). No se cierra sola.
   *
   * Hermano de `ToastHost` y no un toast más: el host muestra uno a la vez y
   * reemplaza al anterior, y el aviso de actualización tiene que convivir con
   * los toasts sin reemplazarlos ni ser reemplazado.
   *
   * Alto fijo: la ranura de acción mide un botón (`h-8`) y en la descarga la
   * llena la barra de progreso. Título y detalle, un renglón cada uno
   * (`UPDATE_NOTICE_MAX_*_CHARS` lo fija con un test).
   *
   * Accesibilidad: `role="status"` (polite), como el viewport de los toasts.
   * Se anuncia el título, que cambia solo al cambiar de estado. El detalle de
   * la descarga —el porcentaje— y la barra van `aria-hidden`: anunciarlos en
   * cada cambio llenaría de ruido a un lector de pantalla.
   */
  return (
    <div
      role="status"
      className="anonly-toast-in fixed bottom-5 right-5 z-[100] box-border h-[calc(6.5rem+2px)] w-[23.75rem] max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-xl border border-border bg-bg-primary py-3 pl-3.5 pr-3 shadow-md"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary"
        >
          {view.progress !== null ? (
            <DownloadIcon className="h-4 w-4" />
          ) : (
            <CheckIcon className="h-4 w-4" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p
            className={`truncate text-sm font-semibold text-text-primary ${view.closable ? "pr-8" : ""}`}
          >
            {view.title}
          </p>
          <p
            aria-hidden={view.progress !== null}
            className="truncate text-sm tabular-nums text-text-secondary"
          >
            {view.detail}
          </p>
          <div className="mt-1.5 flex h-8 items-center">
            {view.progress !== null ? (
              <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${view.progress.percent ?? 0}%` }}
                />
              </div>
            ) : view.action !== null ? (
              <button
                type="button"
                onClick={() => updater.install()}
                className="inline-flex h-8 items-center rounded-md bg-accent/10 px-2.5 text-sm font-semibold text-accent hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {view.action.label}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {view.closable ? (
        <button
          type="button"
          aria-label="Cerrar aviso"
          onClick={() => {
            noticeRef.current = dismissUpdateNotice(noticeRef.current);
            setNotice(noticeRef.current);
          }}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <XIcon className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
