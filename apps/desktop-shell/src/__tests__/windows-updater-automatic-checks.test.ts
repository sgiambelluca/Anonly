/**
 * Pruebas exigidas por ADR-188 sobre el cableado de `startWindowsUpdater` con
 * la política de `update-check-policy.ts`. Mismo mecanismo que
 * `windows-updater.test.ts` (ADR-137): se mockea `electron-updater`, nunca
 * Electron en sí, porque `windows-updater.ts` no lo importa directo.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkWindowsUpdates, startWindowsUpdater } from "../windows-updater";

const mocks = vi.hoisted(() => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    verifyUpdateCodeSignature: vi.fn(
      async (_publisherNames: string[], _filePath: string): Promise<string | null> => null,
    ),
    on: vi.fn(),
    checkForUpdates: vi.fn(async () => null),
    quitAndInstall: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({ autoUpdater: mocks.autoUpdater }));

beforeEach(() => {
  mocks.autoUpdater.checkForUpdates.mockClear();
});

describe("startWindowsUpdater — búsqueda automática (ADR-188)", () => {
  it("no busca al iniciar: crear el actualizador no llama a checkForUpdates", () => {
    startWindowsUpdater(vi.fn(), vi.fn());
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("busca una sola vez con el primer true", () => {
    const handle = startWindowsUpdater(vi.fn(), vi.fn());

    handle.setAutomaticChecks(true);
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("no busca con false", () => {
    const handle = startWindowsUpdater(vi.fn(), vi.fn());

    handle.setAutomaticChecks(false);
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("un true después de una búsqueda ya hecha no repite", () => {
    const handle = startWindowsUpdater(vi.fn(), vi.fn());

    handle.setAutomaticChecks(true);
    handle.setAutomaticChecks(true);
    handle.setAutomaticChecks(true);
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("un payload no booleano se ignora", () => {
    const handle = startWindowsUpdater(vi.fn(), vi.fn());

    for (const impostor of [null, undefined, "true", 1, {}, []]) {
      handle.setAutomaticChecks(impostor);
    }
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();

    // Y un true real, después de los payloads inválidos, sigue disparando la
    // primera búsqueda: los inválidos no consumieron el "primer true".
    handle.setAutomaticChecks(true);
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("la búsqueda manual funciona con la preferencia apagada", () => {
    const handle = startWindowsUpdater(vi.fn(), vi.fn());

    handle.setAutomaticChecks(false);
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();

    // "Buscar actualizaciones ahora" no pasa por la política: siempre funciona.
    checkWindowsUpdates();
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
