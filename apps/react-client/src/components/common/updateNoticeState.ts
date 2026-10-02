/**
 * `updateNoticeState.ts` — los estados del aviso de actualización (ADR-197 §4)
 * y qué hacer con cada evento del contenedor.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom, así
 * que el reductor, los textos y la decisión de instalar al abrir (macOS,
 * ADR-197 §6) se prueban acá y `UpdateNotice.tsx` solo los pinta.
 *
 * El aviso ocupa SIEMPRE la misma ranura (UX-10): los tres estados son el
 * mismo recuadro flotante, con un solo ancho. Nada de lo que aparece o cambia
 * acá empuja el diseño.
 *
 * Por este canal solo viaja el ciclo de vida de la actualización: versión y
 * porcentaje (ADR-131 §5). El detalle de un `error` no cruza; el aviso se
 * retira sin mensaje.
 */

import { PipelineStage } from "@anonly/anonymization-core";

import type { ShellPlatform } from "../../core-adapter/settingsToEngineConfig.js";
import type { UpdateMode } from "../../store/settings.store.js";
import type { UpdateEvent } from "../../updater/index.js";

export type { ShellPlatform };

export type UpdateNoticeState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "downloading";
      readonly version: string | null;
      /** Entero de 0 a 100; `null` mientras no llegue ningún `download-progress`. */
      readonly percent: number | null;
    }
  | { readonly kind: "ready"; readonly version: string | null; readonly dismissed: boolean };

/**
 * Largos máximos, en caracteres, del título y del detalle de la tarjeta, y de la
 * versión que lleva (UX-10, ADR-197 §4). La tarjeta mide lo que un toast
 * (`w-[23.75rem]`) y cada texto va en UN renglón: el detalle usa todo el ancho
 * de la columna de texto (~314 px, ~44 caracteres a 7 px en `text-sm`) y el
 * título, con la X a un lado, ~286 px. Un texto más largo, o una versión más
 * larga, exige revisar el ancho antes de subir estas constantes.
 */
export const UPDATE_NOTICE_MAX_TITLE_CHARS = 40;
export const UPDATE_NOTICE_MAX_DETAIL_CHARS = 44;
export const UPDATE_NOTICE_MAX_VERSION_CHARS = 16;

/** Hay una importación en curso: el pipeline ya arrancó y todavía no terminó. */
export function isImportInProgress(stage: PipelineStage): boolean {
  return (
    stage !== PipelineStage.Idle &&
    stage !== PipelineStage.Ready &&
    stage !== PipelineStage.Done &&
    stage !== PipelineStage.Failed &&
    stage !== PipelineStage.Cancelled
  );
}

export const IDLE_UPDATE_NOTICE: UpdateNoticeState = { kind: "idle" };

export interface UpdateNoticeContext {
  readonly platform: ShellPlatform;
  readonly updateMode: UpdateMode;
  /** Hay un documento abierto ahora mismo. */
  readonly documentOpen: boolean;
  /** Hay una importación en curso (`isImportInProgress`): cuenta como documento abierto. */
  readonly importInProgress: boolean;
  /** Se abrió algún documento en esta sesión, esté abierto ahora o no. */
  readonly documentOpenedThisSession: boolean;
}

export interface UpdateNoticeTransition {
  readonly state: UpdateNoticeState;
  /**
   * `true` si la interfaz tiene que pedir la instalación ahora, sin preguntar.
   * Solo en macOS (`"macos"`), con `updateMode === "install"` y antes de que se haya
   * abierto ningún documento en la sesión (ADR-197 §6): es el caso de abrir la
   * aplicación con una actualización pendiente, que se instala y reabre antes
   * de que haya trabajo que perder. En Windows nunca: instalar al cerrar lo
   * decide el contenedor (ADR-197 §3).
   */
  readonly installNow: boolean;
}

function clampPercent(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** Aplica un evento del contenedor al estado del aviso. */
export function nextUpdateNotice(
  state: UpdateNoticeState,
  event: UpdateEvent,
  context: UpdateNoticeContext,
): UpdateNoticeTransition {
  switch (event.type) {
    case "update-available":
      return {
        state: { kind: "downloading", version: event.version ?? null, percent: null },
        installNow: false,
      };
    case "download-progress": {
      // Sin `update-available` previo no hay aviso de descarga que actualizar.
      if (state.kind !== "downloading") return { state, installNow: false };
      if (typeof event.percent !== "number" || !Number.isFinite(event.percent)) {
        return { state, installNow: false };
      }
      return { state: { ...state, percent: clampPercent(event.percent) }, installNow: false };
    }
    case "update-downloaded":
      return {
        state: { kind: "ready", version: event.version ?? null, dismissed: false },
        installNow:
          context.platform === "macos" &&
          context.updateMode === "install" &&
          !context.documentOpen &&
          !context.importInProgress &&
          !context.documentOpenedThisSession,
      };
    case "update-rejected":
      // La re-verificación previa a instalar falló (ADR-197 §5.b): el archivo se
      // descartó y el aviso se retira en cualquier estado.
      return { state: IDLE_UPDATE_NOTICE, installNow: false };
    case "error":
      // Durante la descarga, el aviso se retira sin mensaje (ADR-197 §4). Con
      // la versión ya lista un error es de otra cosa (una búsqueda) y no la
      // invalida.
      return {
        state: state.kind === "downloading" ? IDLE_UPDATE_NOTICE : state,
        installNow: false,
      };
    default:
      return { state, installNow: false };
  }
}

/**
 * Fuera de Windows y macOS —o sin dato de plataforma— no hay instalación
 * automática: `install` se comporta como `notify` (ADR-197 §6).
 */
export function effectiveUpdateMode(mode: UpdateMode, platform: ShellPlatform): UpdateMode {
  return mode === "install" && platform === "other" ? "notify" : mode;
}

/** La X del aviso de versión lista. El de descarga no se cierra. */
export function dismissUpdateNotice(state: UpdateNoticeState): UpdateNoticeState {
  return state.kind === "ready" ? { ...state, dismissed: true } : state;
}

export interface UpdateNoticeView {
  readonly title: string;
  readonly detail: string;
  /** Botón de la ranura de acción; `null` en la descarga, donde esa ranura es la barra. */
  readonly action: { readonly label: string } | null;
  /** Barra de progreso en la ranura de acción (`percent` `null`: todavía sin dato). */
  readonly progress: { readonly percent: number | null } | null;
  /** Se cierra con la X. La descarga no tiene X (ADR-197 §4). */
  readonly closable: boolean;
}

/** Qué se muestra, o `null` si no hay nada que mostrar. Textos de ADR-197 §4 y §6. */
export function describeUpdateNotice(
  state: UpdateNoticeState,
  updateMode: UpdateMode,
  platform: ShellPlatform,
): UpdateNoticeView | null {
  if (state.kind === "idle") return null;
  const version = state.version === null ? "nueva" : state.version;

  if (state.kind === "downloading") {
    return {
      title: `Descargando la versión ${version}`,
      detail: state.percent === null ? "Empezando la descarga…" : `${state.percent} %`,
      action: null,
      progress: { percent: state.percent },
      closable: false,
    };
  }
  if (state.dismissed) return null;

  const title = `La versión ${version} está lista`;
  if (effectiveUpdateMode(updateMode, platform) === "install") {
    return {
      title,
      detail:
        platform === "macos"
          ? "Se instala la próxima vez que abras Anonly."
          : "Se instala al cerrar Anonly.",
      action: { label: "Reiniciar ahora" },
      progress: null,
      closable: true,
    };
  }
  return {
    title,
    detail: "Anonly se reinicia para instalarla.",
    action: { label: "Reiniciar y actualizar" },
    progress: null,
    closable: true,
  };
}
