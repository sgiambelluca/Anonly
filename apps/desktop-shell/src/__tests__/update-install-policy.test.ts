/**
 * Pruebas exigidas por ADR-197 §3 sobre la política pura de instalación:
 * payload inválido, antes del primer mensaje y cambios de modo. Sin Electron.
 */

import { describe, expect, it } from "vitest";

import { createInstallPolicy, type DownloadedUpdate } from "../update-install-policy";

const UPDATE: DownloadedUpdate = { version: "1.0.1", file: "C:\\cache\\Anonly-Setup-1.0.1.exe" };

describe("createInstallPolicy: instalar al cerrar (ADR-197 §3)", () => {
  it("antes del primer mensaje no instala al cerrar, aunque haya descarga", () => {
    const policy = createInstallPolicy();
    policy.onUpdateDownloaded(UPDATE);
    expect(policy.onQuit()).toEqual({ kind: "none" });
  });

  it("con true y una descarga pendiente pide instalar con esa descarga", () => {
    const policy = createInstallPolicy();
    policy.onPreference(true);
    policy.onUpdateDownloaded(UPDATE);
    expect(policy.onQuit()).toEqual({ kind: "install", update: UPDATE });
  });

  it("con true pero sin descarga no hay nada que instalar", () => {
    const policy = createInstallPolicy();
    policy.onPreference(true);
    expect(policy.onQuit()).toEqual({ kind: "none" });
  });

  it("un payload que no es boolean se ignora sin cambiar nada", () => {
    const policy = createInstallPolicy();
    policy.onUpdateDownloaded(UPDATE);
    for (const impostor of [null, undefined, "true", 1, {}, []]) policy.onPreference(impostor);
    expect(policy.onQuit()).toEqual({ kind: "none" });

    policy.onPreference(true);
    for (const impostor of [null, undefined, "false", 0, {}, []]) policy.onPreference(impostor);
    expect(policy.onQuit()).toEqual({ kind: "install", update: UPDATE });
  });

  it("un cambio de modo posterior se respeta en cualquiera de los dos sentidos", () => {
    const policy = createInstallPolicy();
    policy.onUpdateDownloaded(UPDATE);
    policy.onPreference(true);
    policy.onPreference(false);
    expect(policy.onQuit()).toEqual({ kind: "none" });
    policy.onPreference(true);
    expect(policy.onQuit()).toEqual({ kind: "install", update: UPDATE });
  });

  it("pide instalar una sola vez: el cierre que sigue pasa de largo", () => {
    const policy = createInstallPolicy();
    policy.onPreference(true);
    policy.onUpdateDownloaded(UPDATE);
    expect(policy.onQuit().kind).toBe("install");
    expect(policy.onQuit()).toEqual({ kind: "none" });
  });

  it("si la instalación falló, el cierre siguiente no vuelve a intentarla", () => {
    const policy = createInstallPolicy();
    policy.onPreference(true);
    policy.onUpdateDownloaded(UPDATE);
    expect(policy.onQuit().kind).toBe("install");
    policy.onInstallFailed();
    expect(policy.onQuit()).toEqual({ kind: "none" });
  });
});

describe("createInstallPolicy: pedido del usuario (ADR-197 §1)", () => {
  it("instala aunque el modo no sea «instalar al cerrar» (notify y off)", () => {
    const policy = createInstallPolicy();
    policy.onPreference(false);
    policy.onUpdateDownloaded(UPDATE);
    expect(policy.onUserRequest()).toEqual({ kind: "install", update: UPDATE });
  });

  it("sin descarga no hace nada", () => {
    expect(createInstallPolicy().onUserRequest()).toEqual({ kind: "none" });
  });

  it("un segundo pedido mientras instala se ignora", () => {
    const policy = createInstallPolicy();
    policy.onUpdateDownloaded(UPDATE);
    expect(policy.onUserRequest().kind).toBe("install");
    expect(policy.onUserRequest()).toEqual({ kind: "none" });
  });

  it("instalar a pedido deja pasar el cierre que el propio instalador provoca", () => {
    const policy = createInstallPolicy();
    policy.onPreference(true);
    policy.onUpdateDownloaded(UPDATE);
    expect(policy.onUserRequest().kind).toBe("install");
    expect(policy.onQuit()).toEqual({ kind: "none" });
  });

  it("tras un fallo la descarga se descartó: no se puede reintentar sobre ella", () => {
    const policy = createInstallPolicy();
    policy.onUpdateDownloaded(UPDATE);
    expect(policy.onUserRequest().kind).toBe("install");
    policy.onInstallFailed();
    expect(policy.onUserRequest()).toEqual({ kind: "none" });
    // Una descarga nueva vuelve a habilitar la instalación.
    policy.onUpdateDownloaded(UPDATE);
    expect(policy.onUserRequest().kind).toBe("install");
  });
});
