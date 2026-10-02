/**
 * Cableado de ADR-197 en `startWindowsUpdater`: instalar al cerrar y a pedido,
 * siempre en silencio y siempre con la verificación y la marca ANTES de lanzar
 * el instalador. Se mockea `electron-updater` y el glue de disco/registro,
 * nunca Electron: `windows-updater.ts` no lo importa.
 */

import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as WindowsUpdateSignatureModule from "../windows-update-signature";
import { WINDOWS_UPDATE_PUBLIC_KEY_ID } from "../windows-update-signature";
import { startWindowsUpdater, type WindowsUpdaterHandle } from "../windows-updater";

import { desdeLaRaiz } from "./repoRoot";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  listeners: new Map<string, (...args: unknown[]) => void>(),
  verifyOwnSignature: vi.fn(
    async (_filePath: string, _update: unknown): Promise<string | null> => null,
  ),
  writeMark: vi.fn(),
  registerRunOnce: vi.fn(),
  clearRecovery: vi.fn(),
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    verifyUpdateCodeSignature: vi.fn(
      async (_publisherNames: string[], _filePath: string): Promise<string | null> => null,
    ),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      mocks.listeners.set(event, listener);
    }),
    checkForUpdates: vi.fn(async () => null),
    quitAndInstall: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({ autoUpdater: mocks.autoUpdater }));
vi.mock("../windows-update-signature", async (importOriginal) => {
  const actual = await importOriginal<typeof WindowsUpdateSignatureModule>();
  return { ...actual, verifyWindowsUpdateFile: mocks.verifyOwnSignature };
});
vi.mock("../windows-install-recovery", () => ({
  writePendingInstallMark: mocks.writeMark,
  registerRunOnceRecovery: mocks.registerRunOnce,
  clearInstallRecovery: mocks.clearRecovery,
}));

const SHA512 = `${"A".repeat(86)}==`;
const FILE = "Anonly-Setup-1.0.1.exe";
const CACHED = "C:\\cache\\pending\\Anonly-Setup-1.0.1.exe";
const UPDATE_INFO = {
  version: "1.0.1",
  files: [{ url: FILE, sha512: SHA512 }],
  anonlyEd25519: {
    schema: 1,
    keyId: WINDOWS_UPDATE_PUBLIC_KEY_ID,
    file: FILE,
    sha512: SHA512,
    signature: Buffer.alloc(64, 1).toString("base64"),
  },
};

function listener(event: string): (...args: unknown[]) => void {
  const found = mocks.listeners.get(event);
  if (found === undefined) throw new Error(`No se registró el evento ${event}`);
  return found;
}

const emit = vi.fn();
const quit = vi.fn();
let updater: WindowsUpdaterHandle;

/** Una actualización encontrada y descargada, como la entrega `electron-updater`. */
function downloaded(): void {
  listener("update-available")(UPDATE_INFO);
  listener("update-downloaded")({ ...UPDATE_INFO, downloadedFile: CACHED });
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.listeners.clear();
  mocks.verifyOwnSignature.mockReset().mockImplementation(async () => {
    mocks.calls.push("verify");
    return null;
  });
  mocks.writeMark.mockReset().mockImplementation(() => {
    mocks.calls.push("writeMark");
  });
  mocks.registerRunOnce.mockReset().mockImplementation(() => {
    mocks.calls.push("registerRunOnce");
  });
  mocks.autoUpdater.quitAndInstall.mockReset().mockImplementation(() => {
    mocks.calls.push("quitAndInstall");
  });
  mocks.clearRecovery.mockReset();
  emit.mockReset();
  quit.mockReset();
  updater = startWindowsUpdater(emit, vi.fn(), { userDataDir: "datos", quit });
});

describe("instalar al cerrar (ADR-197 §1, §2, §5)", () => {
  it("no deja que electron-updater instale por su cuenta al salir", () => {
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("cancela el cierre, verifica, deja la marca y la entrada, y recién entonces instala en silencio sin reabrir", async () => {
    updater.setInstallOnQuit(true);
    downloaded();
    const event = { preventDefault: vi.fn() };

    updater.onBeforeQuit(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalled());
    expect(mocks.calls).toEqual(["verify", "writeMark", "registerRunOnce", "quitAndInstall"]);
    expect(mocks.verifyOwnSignature).toHaveBeenCalledWith(
      CACHED,
      expect.objectContaining({ version: "1.0.1", file: FILE }),
    );
    expect(mocks.writeMark).toHaveBeenCalledWith("datos", {
      version: "1.0.1",
      installerPath: CACHED,
    });
    expect(mocks.registerRunOnce).toHaveBeenCalledWith(CACHED);
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, false);
    // El cierre se retoma y el siguiente `before-quit` pasa de largo.
    expect(quit).toHaveBeenCalledTimes(1);
    const second = { preventDefault: vi.fn() };
    updater.onBeforeQuit(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
  });

  it("sin el primer mensaje no instala al cerrar ni toca el cierre", () => {
    downloaded();
    const event = { preventDefault: vi.fn() };
    updater.onBeforeQuit(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("con false (notify u off) cerrar la aplicación no instala nada", () => {
    updater.setInstallOnQuit(false);
    downloaded();
    const event = { preventDefault: vi.fn() };
    updater.onBeforeQuit(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("un payload que no es boolean no activa la instalación al cerrar", () => {
    updater.setInstallOnQuit("true");
    updater.setInstallOnQuit(1);
    downloaded();
    const event = { preventDefault: vi.fn() };
    updater.onBeforeQuit(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("sin descarga pendiente cerrar no se frena", () => {
    updater.setInstallOnQuit(true);
    const event = { preventDefault: vi.fn() };
    updater.onBeforeQuit(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("si la verificación falla no instala, descarta, emite update-rejected y retoma el cierre", async () => {
    mocks.verifyOwnSignature.mockResolvedValue("la firma Ed25519 de la actualización es inválida");
    updater.setInstallOnQuit(true);
    downloaded();
    emit.mockClear();

    updater.onBeforeQuit({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(mocks.writeMark).not.toHaveBeenCalled();
    expect(mocks.registerRunOnce).not.toHaveBeenCalled();
    // Solo el tipo cruza: el motivo del rechazo queda en el log (ADR-131 §5).
    expect(emit).toHaveBeenCalledWith({ type: "update-rejected" });
  });
});

describe("instalar a pedido del usuario (ADR-197 §1, §2)", () => {
  it("verifica, deja la marca y la entrada, y instala en silencio reabriendo la aplicación", async () => {
    updater.setInstallOnQuit(false);
    downloaded();

    updater.installNow();

    await vi.waitFor(() => expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalled());
    expect(mocks.calls).toEqual(["verify", "writeMark", "registerRunOnce", "quitAndInstall"]);
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
    // El cierre lo hace `quitAndInstall`: acá no hay un `quit` aparte.
    expect(quit).not.toHaveBeenCalled();
  });

  it("si la verificación falla no instala y la aplicación sigue abierta", async () => {
    mocks.verifyOwnSignature.mockResolvedValue("los bytes descargados no corresponden");
    downloaded();
    emit.mockClear();

    updater.installNow();

    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith({ type: "update-rejected" }));
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it("sin descarga no hace nada", () => {
    updater.installNow();
    expect(mocks.verifyOwnSignature).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("la verificación usa la firma de la versión descargada aunque una búsqueda posterior la reinicie", async () => {
    downloaded();
    listener("checking-for-update")();

    updater.installNow();

    await vi.waitFor(() => expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalled());
    expect(mocks.verifyOwnSignature).toHaveBeenCalledWith(
      CACHED,
      expect.objectContaining({ version: "1.0.1" }),
    );
  });

  it("el payload de update-downloaded que cruza a la interfaz no lleva la ruta del archivo", () => {
    downloaded();
    expect(emit).toHaveBeenCalledWith({ type: "update-downloaded", version: "1.0.1" });
    expect(JSON.stringify(emit.mock.calls)).not.toContain("cache");
  });
});

describe("el instalador no se lanza (ADR-197 §5.c)", () => {
  it("quitAndInstall informa un error síncrono en modo quit: retira marca y entrada, retoma el cierre y no queda instalando", async () => {
    mocks.autoUpdater.quitAndInstall.mockImplementation(() => {
      listener("error")(new Error("No update filepath provided"));
    });
    updater.setInstallOnQuit(true);
    downloaded();

    updater.onBeforeQuit({ preventDefault: vi.fn() });

    await vi.waitFor(() =>
      expect(mocks.clearRecovery).toHaveBeenCalledWith("datos", expect.any(Function)),
    );
    expect(quit).toHaveBeenCalled();
    // `installing` volvió a false y la descarga se dio de baja: el próximo cierre no reintenta.
    const next = { preventDefault: vi.fn() };
    updater.onBeforeQuit(next);
    expect(next.preventDefault).not.toHaveBeenCalled();
  });

  it("el mismo error en modo restart retira la recuperación y la aplicación sigue abierta", async () => {
    mocks.autoUpdater.quitAndInstall.mockImplementation(() => {
      listener("error")(new Error("spawn EACCES"));
    });
    downloaded();

    updater.installNow();

    await vi.waitFor(() => expect(mocks.clearRecovery).toHaveBeenCalledTimes(1));
    expect(quit).not.toHaveBeenCalled();
  });

  it("si quitAndInstall tira, en modo quit el cierre se retoma igual", async () => {
    mocks.autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error("boom");
    });
    updater.setInstallOnQuit(true);
    downloaded();

    updater.onBeforeQuit({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(quit).toHaveBeenCalled());
    expect(mocks.clearRecovery).toHaveBeenCalledTimes(1);
  });

  it("si la preparación tira, en modo quit el cierre se retoma igual", async () => {
    mocks.writeMark.mockImplementation(() => {
      throw new Error("EACCES");
    });
    mocks.verifyOwnSignature.mockImplementation(async () => {
      throw new Error("EBUSY");
    });
    updater.setInstallOnQuit(true);
    downloaded();

    updater.onBeforeQuit({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(quit).toHaveBeenCalled());
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("un error de una búsqueda cualquiera, sin instalador lanzándose, no toca la recuperación", () => {
    listener("error")(new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(mocks.clearRecovery).not.toHaveBeenCalled();
  });
});

describe("la firma de una descarga en curso (ADR-197 §5.b)", () => {
  it("una búsqueda que se solapa con la descarga no pisa la firma: se verifica y se instala", async () => {
    listener("update-available")(UPDATE_INFO);
    listener("checking-for-update")();
    // La verificación de la propia descarga también la usa.
    await expect(
      mocks.autoUpdater.verifyUpdateCodeSignature(["__ANONLY_ED25519_ONLY__"], CACHED),
    ).resolves.toBe(null);
    listener("update-downloaded")({ ...UPDATE_INFO, downloadedFile: CACHED });
    emit.mockClear();

    updater.installNow();

    await vi.waitFor(() => expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalled());
    expect(mocks.verifyOwnSignature).toHaveBeenLastCalledWith(
      CACHED,
      expect.objectContaining({ version: "1.0.1" }),
    );
    expect(emit).not.toHaveBeenCalledWith({ type: "update-rejected" });
  });

  it("sin descarga en curso, una búsqueda nueva sigue reiniciando la firma (falla cerrado)", async () => {
    listener("update-available")(UPDATE_INFO);
    listener("update-downloaded")({ ...UPDATE_INFO, downloadedFile: CACHED });
    listener("checking-for-update")();
    await expect(
      mocks.autoUpdater.verifyUpdateCodeSignature(["__ANONLY_ED25519_ONLY__"], CACHED),
    ).resolves.toContain("no hay metadata");
  });
});

describe("lo verificado es lo que se lanza (ADR-197 §5.b)", () => {
  it("en electron-updater, downloadedFile, installerPath y quitAndInstall hablan del mismo archivo", async () => {
    const out = desdeLaRaiz("apps/desktop-shell/node_modules/electron-updater/out");
    const appUpdater = await readFile(`${out}/AppUpdater.js`, "utf8");
    const baseUpdater = await readFile(`${out}/BaseUpdater.js`, "utf8");
    const nsis = await readFile(`${out}/NsisUpdater.js`, "utf8");
    // El evento informa la misma ruta que se guarda como archivo descargado.
    expect(appUpdater).toMatch(/setDownloadedFile\(updateFile,/);
    expect(appUpdater).toMatch(/downloadedFile:\s*updateFile/);
    // `installerPath` es ese archivo, y es el que `install` y el instalador NSIS lanzan.
    expect(baseUpdater).toMatch(
      /get installerPath\(\)\s*\{\s*return this\.downloadedUpdateHelper == null \? null : this\.downloadedUpdateHelper\.file;/,
    );
    expect(baseUpdater).toMatch(
      /quitAndInstall\(isSilent = false, isForceRunAfter = false\)[\s\S]*this\.install\(isSilent/,
    );
    expect(nsis).toMatch(/const installerPath = this\.installerPath;/);
    expect(nsis).toMatch(/this\.spawnLog\(installerPath, args\)/);
  });
});
