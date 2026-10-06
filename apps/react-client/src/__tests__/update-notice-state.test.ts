/**
 * Los estados del aviso de actualización (ADR-197 §4) y la instalación al abrir
 * de macOS (ADR-197 §6), sobre las funciones puras: el cliente corre Vitest sin
 * jsdom.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PipelineStage } from "@anonly/anonymization-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOAST_DURATION_MS } from "../components/common/toast.js";
import {
  describeUpdateNotice,
  dismissUpdateNotice,
  IDLE_UPDATE_NOTICE,
  isImportInProgress,
  nextUpdateNotice,
  UPDATE_NOTICE_MAX_DETAIL_CHARS,
  UPDATE_NOTICE_MAX_TITLE_CHARS,
  UPDATE_NOTICE_MAX_VERSION_CHARS,
  type UpdateNoticeContext,
  type UpdateNoticeState,
} from "../components/common/updateNoticeState.js";
import {
  UPDATE_INSTALL_DESCRIPTION_MAC,
  UPDATE_MODE_DESCRIPTION,
  updateModeDescription,
} from "../components/toolbar/settingsCopy.js";
import { readShellPlatform } from "../core-adapter/settingsToEngineConfig.js";

const WINDOWS: UpdateNoticeContext = {
  platform: "windows",
  updateMode: "install",
  documentOpen: false,
  importInProgress: false,
  documentOpenedThisSession: false,
};
const MAC: UpdateNoticeContext = { ...WINDOWS, platform: "macos" };

const DOWNLOADING: UpdateNoticeState = { kind: "downloading", version: "1.0.1", percent: null };
const READY: UpdateNoticeState = { kind: "ready", version: "1.0.1", dismissed: false };

describe("descargando (ADR-197 §4)", () => {
  it("empieza con update-available, sin porcentaje", () => {
    const { state, installNow } = nextUpdateNotice(
      IDLE_UPDATE_NOTICE,
      { type: "update-available", version: "1.0.1" },
      WINDOWS,
    );
    expect(state).toEqual(DOWNLOADING);
    expect(installNow).toBe(false);
    expect(describeUpdateNotice(state, "notify", "windows")).toEqual({
      title: "Descargando la versión 1.0.1",
      detail: "Empezando la descarga…",
      action: null,
      progress: { percent: null },
      closable: false,
    });
  });

  it("muestra el porcentaje como entero cuando llega download-progress", () => {
    const { state } = nextUpdateNotice(
      DOWNLOADING,
      { type: "download-progress", percent: 41.6 },
      WINDOWS,
    );
    expect(state).toEqual({ ...DOWNLOADING, percent: 42 });
    expect(describeUpdateNotice(state, "notify", "windows")).toMatchObject({
      title: "Descargando la versión 1.0.1",
      detail: "42 %",
      progress: { percent: 42 },
    });
  });

  it("acota el porcentaje a 0-100 e ignora un valor que no es número", () => {
    const over = nextUpdateNotice(
      DOWNLOADING,
      { type: "download-progress", percent: 140 },
      WINDOWS,
    );
    expect(over.state).toMatchObject({ percent: 100 });
    const under = nextUpdateNotice(
      DOWNLOADING,
      { type: "download-progress", percent: -3 },
      WINDOWS,
    );
    expect(under.state).toMatchObject({ percent: 0 });
    for (const percent of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        nextUpdateNotice(DOWNLOADING, { type: "download-progress", percent }, WINDOWS).state,
      ).toBe(DOWNLOADING);
    }
    expect(nextUpdateNotice(DOWNLOADING, { type: "download-progress" }, WINDOWS).state).toBe(
      DOWNLOADING,
    );
  });

  it("un download-progress sin descarga en curso no abre ningún aviso", () => {
    const { state } = nextUpdateNotice(
      IDLE_UPDATE_NOTICE,
      { type: "download-progress", percent: 10 },
      WINDOWS,
    );
    expect(state).toBe(IDLE_UPDATE_NOTICE);
  });

  it("sin botones y no se puede descartar", () => {
    expect(dismissUpdateNotice(DOWNLOADING)).toBe(DOWNLOADING);
    expect(describeUpdateNotice(DOWNLOADING, "install", "windows")).toMatchObject({
      action: null,
      closable: false,
    });
  });

  it("si llega error durante la descarga, el aviso se retira sin mensaje", () => {
    const { state } = nextUpdateNotice({ ...DOWNLOADING, percent: 30 }, { type: "error" }, WINDOWS);
    expect(state).toEqual(IDLE_UPDATE_NOTICE);
    expect(describeUpdateNotice(state, "install", "windows")).toBeNull();
  });

  it("sin versión conocida, el texto no inventa una", () => {
    expect(
      describeUpdateNotice({ kind: "downloading", version: null, percent: 7 }, "notify", "windows")
        ?.title,
    ).toBe("Descargando la versión nueva");
  });
});

describe("lista (ADR-197 §4)", () => {
  it("modo install en Windows: se instala al cerrar, con «Reiniciar ahora»", () => {
    expect(describeUpdateNotice(READY, "install", "windows")).toEqual({
      title: "La versión 1.0.1 está lista",
      detail: "Se instala al cerrar Anonly.",
      action: { label: "Reiniciar ahora" },
      progress: null,
      closable: true,
    });
  });

  it.each(["notify", "off"] as const)(
    "modo %s: está lista, con «Reiniciar y actualizar»",
    (mode) => {
      expect(describeUpdateNotice(READY, mode, "windows")).toEqual({
        title: "La versión 1.0.1 está lista",
        detail: "Anonly se reinicia para instalarla.",
        action: { label: "Reiniciar y actualizar" },
        progress: null,
        closable: true,
      });
    },
  );

  it("update-downloaded pasa de descargando a lista, sin pedir instalar en Windows", () => {
    const { state, installNow } = nextUpdateNotice(
      { ...DOWNLOADING, percent: 99 },
      { type: "update-downloaded", version: "1.0.1" },
      WINDOWS,
    );
    expect(state).toEqual(READY);
    expect(installNow).toBe(false);
  });

  it("en Windows la interfaz nunca pide instalar sola, con ningún modo ni documento", () => {
    for (const updateMode of ["install", "notify", "off"] as const) {
      for (const documentOpenedThisSession of [false, true]) {
        const { installNow } = nextUpdateNotice(
          DOWNLOADING,
          { type: "update-downloaded", version: "1.0.1" },
          { ...WINDOWS, updateMode, documentOpenedThisSession },
        );
        expect(installNow).toBe(false);
      }
    }
  });

  it("La X la cierra; una descarga nueva la vuelve a mostrar", () => {
    const dismissed = dismissUpdateNotice(READY);
    expect(dismissed).toEqual({ ...READY, dismissed: true });
    expect(describeUpdateNotice(dismissed, "install", "windows")).toBeNull();
    const again = nextUpdateNotice(
      dismissed,
      { type: "update-downloaded", version: "1.0.2" },
      WINDOWS,
    );
    expect(describeUpdateNotice(again.state, "install", "windows")).not.toBeNull();
  });

  it("un error con la versión ya lista no retira el aviso", () => {
    expect(nextUpdateNotice(READY, { type: "error" }, WINDOWS).state).toBe(READY);
  });

  it("checking y update-not-available no tocan el estado", () => {
    for (const type of ["checking", "update-not-available", "otro"]) {
      expect(nextUpdateNotice(READY, { type }, WINDOWS).state).toBe(READY);
      expect(nextUpdateNotice(IDLE_UPDATE_NOTICE, { type }, WINDOWS).state).toBe(
        IDLE_UPDATE_NOTICE,
      );
    }
  });
});

describe("macOS: se instala al abrir (ADR-197 §6)", () => {
  const downloaded = { type: "update-downloaded", version: "1.0.1" };

  it("antes de abrir ningún documento y en modo install, pide instalar sin preguntar", () => {
    expect(nextUpdateNotice(IDLE_UPDATE_NOTICE, downloaded, MAC).installNow).toBe(true);
  });

  it("con un documento abierto no instala", () => {
    const { installNow } = nextUpdateNotice(IDLE_UPDATE_NOTICE, downloaded, {
      ...MAC,
      documentOpen: true,
      documentOpenedThisSession: true,
    });
    expect(installNow).toBe(false);
  });

  it("después de haber abierto alguno, aunque ya esté cerrado, no instala", () => {
    const { installNow } = nextUpdateNotice(IDLE_UPDATE_NOTICE, downloaded, {
      ...MAC,
      documentOpenedThisSession: true,
    });
    expect(installNow).toBe(false);
  });

  it("en notify y off no instala nunca solo", () => {
    for (const updateMode of ["notify", "off"] as const) {
      expect(
        nextUpdateNotice(IDLE_UPDATE_NOTICE, downloaded, { ...MAC, updateMode }).installNow,
      ).toBe(false);
    }
  });

  it("el aviso dice que se instala la próxima vez que se abra, con «Reiniciar ahora»", () => {
    expect(describeUpdateNotice(READY, "install", "macos")).toEqual({
      title: "La versión 1.0.1 está lista",
      detail: "Se instala la próxima vez que abras Anonly.",
      action: { label: "Reiniciar ahora" },
      progress: null,
      closable: true,
    });
  });

  it("en notify y off el aviso es el mismo que en Windows", () => {
    expect(describeUpdateNotice(READY, "notify", "macos")).toEqual(
      describeUpdateNotice(READY, "notify", "windows"),
    );
  });
});

describe("textos de Configuración (ADR-197 §4, §6)", () => {
  it("Windows: instalar al cerrar y avisar cuando están listas", () => {
    expect(UPDATE_MODE_DESCRIPTION.install).toBe(
      "Busca versiones nuevas y las instala al cerrar Anonly.",
    );
    expect(UPDATE_MODE_DESCRIPTION.notify).toBe(
      "Busca versiones nuevas y te avisa cuando están listas.",
    );
    expect(UPDATE_MODE_DESCRIPTION.off).toBe(
      "No se conecta a internet. Podés buscar con el botón de abajo.",
    );
  });

  it("macOS: instalar al abrir", () => {
    expect(UPDATE_INSTALL_DESCRIPTION_MAC).toBe(
      "Busca versiones nuevas y las instala al abrir Anonly.",
    );
  });
});

describe("UpdateNotice.tsx (ADR-197 §4)", () => {
  const fuente = readFileSync(
    fileURLToPath(new URL("../components/common/UpdateNotice.tsx", import.meta.url)),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("ya no pide la instalación en un efecto: solo a pedido del usuario o por la decisión pura", () => {
    // El `useEffect` retirado llamaba a `updater.install()` apenas había versión lista.
    expect(fuente).not.toMatch(/installsWithoutAsking/);
    const llamadas = fuente.match(/updater\.install\(\)/g) ?? [];
    expect(llamadas).toHaveLength(2);
    expect(fuente).toContain("if (transition.installNow) updater.install()");
    expect(fuente).toContain("onClick={() => updater.install()}");
  });
});

describe("plataforma (ADR-197 §6)", () => {
  const OTHER: UpdateNoticeContext = { ...WINDOWS, platform: "other" };
  const downloaded = { type: "update-downloaded", version: "1.0.1" };

  it("other, o el dato ausente, con install: avisa y espera, nunca instala sola", () => {
    for (const documentOpenedThisSession of [false, true]) {
      expect(
        nextUpdateNotice(IDLE_UPDATE_NOTICE, downloaded, { ...OTHER, documentOpenedThisSession })
          .installNow,
      ).toBe(false);
    }
  });

  it("other con install: textos y botón de notify", () => {
    expect(describeUpdateNotice(READY, "install", "other")).toEqual(
      describeUpdateNotice(READY, "notify", "other"),
    );
    expect(describeUpdateNotice(READY, "install", "other")?.detail).toBe(
      "Anonly se reinicia para instalarla.",
    );
  });

  it("windows y macos con install siguen distinguiéndose", () => {
    expect(describeUpdateNotice(READY, "install", "windows")?.detail).toContain("al cerrar");
    expect(describeUpdateNotice(READY, "install", "macos")?.detail).toContain("próxima vez");
  });

  it("la descripción de Configuración sigue a la plataforma", () => {
    expect(updateModeDescription("install", "windows")).toBe(UPDATE_MODE_DESCRIPTION.install);
    expect(updateModeDescription("install", "macos")).toBe(UPDATE_INSTALL_DESCRIPTION_MAC);
    expect(updateModeDescription("install", "other")).toBe(UPDATE_MODE_DESCRIPTION.notify);
    for (const platform of ["windows", "macos", "other"] as const) {
      expect(updateModeDescription("notify", platform)).toBe(UPDATE_MODE_DESCRIPTION.notify);
      expect(updateModeDescription("off", platform)).toBe(UPDATE_MODE_DESCRIPTION.off);
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["windows", "macos", "other"] as const)(
    "readShellPlatform lee %s del contenedor",
    (platform) => {
      vi.stubGlobal("window", { anonlyDevice: { platform } });
      expect(readShellPlatform()).toBe(platform);
    },
  );

  it("readShellPlatform: sin dato, o con un valor inválido, es other", () => {
    vi.stubGlobal("window", {});
    expect(readShellPlatform()).toBe("other");
    for (const impostor of ["linux", "win32", "darwin", "MACOS", 1, null, {}]) {
      vi.stubGlobal("window", { anonlyDevice: { platform: impostor } });
      expect(readShellPlatform()).toBe("other");
    }
    vi.stubGlobal("window", { anonlyDevice: null });
    expect(readShellPlatform()).toBe("other");
    vi.unstubAllGlobals();
    expect(readShellPlatform()).toBe("other");
  });

  it("no se lee navigator.userAgent para decidirlo", () => {
    const leer = (ruta: string): string =>
      readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
    for (const ruta of [
      "../components/common/updateNoticeState.ts",
      "../components/common/UpdateNotice.tsx",
    ]) {
      expect(leer(ruta)).not.toMatch(/userAgent|navigator\.platform/);
    }
  });
});

describe("update-rejected (ADR-197 §4, §5.b)", () => {
  it("retira el aviso en cualquier estado", () => {
    for (const state of [DOWNLOADING, { ...DOWNLOADING, percent: 50 }, READY]) {
      const transition = nextUpdateNotice(state, { type: "update-rejected" }, WINDOWS);
      expect(transition).toEqual({ state: IDLE_UPDATE_NOTICE, installNow: false });
    }
    expect(
      nextUpdateNotice(IDLE_UPDATE_NOTICE, { type: "update-rejected" }, WINDOWS).state,
    ).toEqual(IDLE_UPDATE_NOTICE);
    const dismissed = dismissUpdateNotice(READY);
    expect(nextUpdateNotice(dismissed, { type: "update-rejected" }, WINDOWS).state).toEqual(
      IDLE_UPDATE_NOTICE,
    );
  });

  it("no pide instalar, ni siquiera en macOS antes de abrir un documento", () => {
    expect(nextUpdateNotice(READY, { type: "update-rejected" }, MAC).installNow).toBe(false);
  });
});

describe("importación en curso (ADR-197 §6)", () => {
  const downloaded = { type: "update-downloaded", version: "1.0.1" };

  it("en macOS, con una importación en curso no instala sola", () => {
    expect(
      nextUpdateNotice(IDLE_UPDATE_NOTICE, downloaded, { ...MAC, importInProgress: true })
        .installNow,
    ).toBe(false);
  });

  it("isImportInProgress: del arranque del pipeline a su fin, sin contar reposo ni terminales", () => {
    const enCurso = (Object.values(PipelineStage) as PipelineStage[]).filter(isImportInProgress);
    expect(enCurso.length).toBeGreaterThan(0);
    for (const stage of [
      PipelineStage.Idle,
      PipelineStage.Ready,
      PipelineStage.Done,
      PipelineStage.Failed,
      PipelineStage.Cancelled,
    ]) {
      expect(isImportInProgress(stage), stage).toBe(false);
    }
    expect(isImportInProgress(PipelineStage.Extracting)).toBe(true);
  });
});

describe("tarjeta estable (UX-10, ADR-197 §4)", () => {
  it("ningún título ni detalle, en ningún estado, modo ni plataforma, pasa del largo máximo con la versión más larga", () => {
    const version = "9".repeat(UPDATE_NOTICE_MAX_VERSION_CHARS);
    const estados: UpdateNoticeState[] = [
      { kind: "downloading", version, percent: null },
      { kind: "downloading", version, percent: 100 },
      { kind: "downloading", version: null, percent: 100 },
      { kind: "ready", version, dismissed: false },
      { kind: "ready", version: null, dismissed: false },
    ];
    let titulo = 0;
    let detalle = 0;
    for (const state of estados) {
      for (const mode of ["install", "notify", "off"] as const) {
        for (const platform of ["windows", "macos", "other"] as const) {
          const view = describeUpdateNotice(state, mode, platform);
          if (view === null) throw new Error("sin vista");
          titulo = Math.max(titulo, view.title.length);
          detalle = Math.max(detalle, view.detail.length);
          expect(view.title, view.title).toHaveLength(
            Math.min(view.title.length, UPDATE_NOTICE_MAX_TITLE_CHARS),
          );
          expect(view.detail, view.detail).toHaveLength(
            Math.min(view.detail.length, UPDATE_NOTICE_MAX_DETAIL_CHARS),
          );
          // La ranura de acción siempre está ocupada: un botón o la barra.
          expect((view.action === null) !== (view.progress === null)).toBe(true);
        }
      }
    }
    // Las constantes no quedan holgadas de más.
    expect(titulo).toBeGreaterThan(UPDATE_NOTICE_MAX_TITLE_CHARS - 5);
    expect(detalle).toBeGreaterThan(UPDATE_NOTICE_MAX_DETAIL_CHARS - 5);
  });

  it("la tarjeta mide lo que un toast, con alto fijo, y los textos no pasan a dos renglones", () => {
    const leer = (ruta: string): string =>
      readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
    const tarjeta = leer("../components/common/UpdateNotice.tsx");
    const toast = leer("../components/common/ToastHost.tsx");
    expect(toast).toContain("w-[23.75rem]");
    expect(tarjeta).toContain("w-[23.75rem]");
    expect(tarjeta).toContain("h-[calc(6.5rem+2px)]");
    expect(tarjeta).toContain("bg-bg-primary");
    expect(tarjeta.match(/truncate/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("el porcentaje y la barra no se anuncian a un lector de pantalla", () => {
    const tarjeta = readFileSync(
      fileURLToPath(new URL("../components/common/UpdateNotice.tsx", import.meta.url)),
      "utf8",
    );
    expect(tarjeta).toContain('role="status"');
    expect(tarjeta).toContain("aria-hidden={view.progress !== null}");
  });

  it("los toasts siguen igual por defecto y suben solo mientras está la tarjeta", () => {
    expect(TOAST_DURATION_MS).toBe(3000);
  });

  it("un aviso descartado vuelve a mostrarse con un update-available posterior", () => {
    const descartado = dismissUpdateNotice(READY);
    const { state } = nextUpdateNotice(
      descartado,
      { type: "update-available", version: "1.0.2" },
      WINDOWS,
    );
    expect(describeUpdateNotice(state, "notify", "windows")).not.toBeNull();
  });
});
