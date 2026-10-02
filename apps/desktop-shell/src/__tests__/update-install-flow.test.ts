/**
 * ADR-197 §5.b y §5.c: el orden previo al instalador. Se prueba con las
 * dependencias inyectadas: nada de disco, registro ni Electron.
 */

import { describe, expect, it, vi } from "vitest";

import { prepareVerifiedInstall, type InstallPreparationDeps } from "../update-install-flow";

const UPDATE = { version: "1.0.1", file: "C:\\cache\\Anonly-Setup-1.0.1.exe" };

function deps(overrides: Partial<InstallPreparationDeps> = {}): {
  readonly calls: string[];
  readonly deps: InstallPreparationDeps;
} {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      verify: vi.fn(async () => {
        calls.push("verify");
        return null;
      }),
      writeMark: vi.fn(() => {
        calls.push("writeMark");
      }),
      registerRecovery: vi.fn(() => {
        calls.push("registerRecovery");
      }),
      discardDownload: vi.fn(async () => {
        calls.push("discard");
      }),
      log: vi.fn(),
      ...overrides,
    },
  };
}

describe("prepareVerifiedInstall", () => {
  it("verifica, deja la marca y registra la recuperación, en ese orden", async () => {
    const { calls, deps: d } = deps();
    await expect(prepareVerifiedInstall(d, UPDATE)).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["verify", "writeMark", "registerRecovery"]);
    expect(d.verify).toHaveBeenCalledWith(UPDATE.file);
    expect(d.writeMark).toHaveBeenCalledWith({ version: "1.0.1", installerPath: UPDATE.file });
    expect(d.registerRecovery).toHaveBeenCalledWith(UPDATE.file);
  });

  it("si la verificación falla: no registra nada, descarta la descarga y lo registra en el log", async () => {
    const { calls, deps: d } = deps({
      verify: vi.fn(async () => "los bytes descargados no corresponden a la actualización firmada"),
    });
    const result = await prepareVerifiedInstall(d, UPDATE);
    expect(result).toEqual({
      ok: false,
      reason: "los bytes descargados no corresponden a la actualización firmada",
    });
    expect(calls).toEqual(["discard"]);
    expect(d.discardDownload).toHaveBeenCalledWith(UPDATE.file);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("no corresponden"));
  });

  it("si la verificación tira, también es un rechazo", async () => {
    const { deps: d } = deps({
      verify: vi.fn(async () => {
        throw new Error("EBUSY");
      }),
    });
    const result = await prepareVerifiedInstall(d, UPDATE);
    expect(result.ok).toBe(false);
    expect(d.writeMark).not.toHaveBeenCalled();
    expect(d.discardDownload).toHaveBeenCalledTimes(1);
  });

  it("si descartar falla, igual no se instala", async () => {
    const { deps: d } = deps({
      verify: vi.fn(async () => "firma inválida"),
      discardDownload: vi.fn(async () => {
        throw new Error("EPERM");
      }),
    });
    await expect(prepareVerifiedInstall(d, UPDATE)).resolves.toEqual({
      ok: false,
      reason: "firma inválida",
    });
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("no se pudo descartar"));
  });

  it("sin archivo informado no se instala ni se verifica", async () => {
    const { deps: d } = deps();
    const result = await prepareVerifiedInstall(d, { version: "1.0.1", file: null });
    expect(result.ok).toBe(false);
    expect(d.verify).not.toHaveBeenCalled();
    expect(d.writeMark).not.toHaveBeenCalled();
  });

  it("si la marca no se puede escribir, la instalación sigue y no se registra la entrada", async () => {
    const { deps: d } = deps({
      writeMark: vi.fn(() => {
        throw new Error("EACCES");
      }),
    });
    await expect(prepareVerifiedInstall(d, UPDATE)).resolves.toEqual({ ok: true });
    expect(d.registerRecovery).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("marca"));
  });

  it("si registrar la entrada falla, la instalación sigue", async () => {
    const { deps: d } = deps({
      registerRecovery: vi.fn(() => {
        throw new Error("reg.exe falló");
      }),
    });
    await expect(prepareVerifiedInstall(d, UPDATE)).resolves.toEqual({ ok: true });
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("recuperación"));
  });
});
