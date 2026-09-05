/** Condiciones ejecutables de ADR-137 para el cableado de electron-updater. */

import { readFile } from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as WindowsUpdateSignatureModule from "../windows-update-signature";
import { ED25519_ONLY_PUBLISHER, WINDOWS_UPDATE_PUBLIC_KEY_ID } from "../windows-update-signature";
import { startWindowsUpdater } from "../windows-updater";

import { desdeLaRaiz } from "./repoRoot";

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  verifyAuthenticode: vi.fn(
    async (_publisherNames: string[], _filePath: string): Promise<string | null> => null,
  ),
  verifyOwnSignature: vi.fn(
    async (_filePath: string, _update: unknown): Promise<string | null> => null,
  ),
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

const BUILDER = desdeLaRaiz("apps/desktop-shell/electron-builder.yml");
const FUENTE = desdeLaRaiz("apps/desktop-shell/src/windows-updater.ts");

let builder = "";
let fuente = "";

const SHA512 = `${"A".repeat(86)}==`;
const SIGNATURE = Buffer.alloc(64, 1).toString("base64");
const FILE = "Anonly-Setup-0.9.1.exe";
const VALID_UPDATE_INFO = {
  version: "0.9.1",
  files: [{ url: FILE, sha512: SHA512 }],
  anonlyEd25519: {
    schema: 1,
    keyId: WINDOWS_UPDATE_PUBLIC_KEY_ID,
    file: FILE,
    sha512: SHA512,
    signature: SIGNATURE,
  },
};

function updaterListener(event: string): (...args: unknown[]) => void {
  const listener = mocks.listeners.get(event);
  if (listener === undefined) throw new Error(`No se registró el evento ${event}`);
  return listener;
}

function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

beforeAll(async () => {
  builder = await readFile(BUILDER, "utf8");
  fuente = await readFile(FUENTE, "utf8");

  mocks.autoUpdater.verifyUpdateCodeSignature = mocks.verifyAuthenticode;
  startWindowsUpdater(vi.fn(), vi.fn());
});

beforeEach(() => {
  mocks.verifyAuthenticode.mockReset().mockResolvedValue(null);
  mocks.verifyOwnSignature.mockReset().mockResolvedValue(null);
});

describe("verificación de actualizaciones Windows (ADR-137)", () => {
  it("fuerza a NsisUpdater a entrar al callback aun sin Authenticode", () => {
    expect(builder).toContain(`publisherName: "${ED25519_ONLY_PUBLISHER}"`);
  });

  it("instala una función real de verificación, no el antiguo no-op booleano", () => {
    const codigo = sinComentarios(fuente);
    expect(codigo).toMatch(/verifyUpdateCodeSignature\s*=\s*async/);
    expect(codigo).toContain("verifyWindowsUpdateFile");
    expect(codigo).not.toMatch(/verifyUpdateCodeSignature\s*=\s*false/);
  });

  it("conserva el verificador Authenticode para componerlo con SignPath", () => {
    expect(sinComentarios(fuente)).toContain("return verifyAuthenticode(publisherNames, filePath)");
  });

  it("falla cerrado si la metadata no llegó, aun con el publisher reservado", async () => {
    updaterListener("checking-for-update")();

    await expect(
      mocks.autoUpdater.verifyUpdateCodeSignature([ED25519_ONLY_PUBLISHER], "descarga.exe"),
    ).resolves.toContain("no hay metadata");
    expect(mocks.verifyOwnSignature).not.toHaveBeenCalled();
    expect(mocks.verifyAuthenticode).not.toHaveBeenCalled();
  });

  it("acepta el modo propio solo después de verificar Ed25519", async () => {
    updaterListener("update-available")(VALID_UPDATE_INFO);

    await expect(
      mocks.autoUpdater.verifyUpdateCodeSignature([ED25519_ONLY_PUBLISHER], "descarga.exe"),
    ).resolves.toBe(null);
    expect(mocks.verifyOwnSignature).toHaveBeenCalledWith(
      "descarga.exe",
      expect.objectContaining({ version: "0.9.1", file: FILE, sha512: SHA512 }),
    );
    expect(mocks.verifyAuthenticode).not.toHaveBeenCalled();
  });

  it("con SignPath exige Ed25519 antes de delegar a Authenticode", async () => {
    updaterListener("update-available")(VALID_UPDATE_INFO);
    mocks.verifyAuthenticode.mockResolvedValue("firma Authenticode inválida");

    await expect(
      mocks.autoUpdater.verifyUpdateCodeSignature(["Anonly Publisher"], "descarga.exe"),
    ).resolves.toBe("firma Authenticode inválida");
    expect(mocks.verifyOwnSignature).toHaveBeenCalledTimes(1);
    expect(mocks.verifyAuthenticode).toHaveBeenCalledWith(["Anonly Publisher"], "descarga.exe");

    mocks.verifyOwnSignature.mockResolvedValue("firma Ed25519 inválida");
    mocks.verifyAuthenticode.mockClear();
    await expect(
      mocks.autoUpdater.verifyUpdateCodeSignature(["Anonly Publisher"], "descarga.exe"),
    ).resolves.toBe("firma Ed25519 inválida");
    expect(mocks.verifyAuthenticode).not.toHaveBeenCalled();
  });
});
