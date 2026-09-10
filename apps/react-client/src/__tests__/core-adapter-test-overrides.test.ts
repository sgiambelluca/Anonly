/**
 * Canal de overrides del arnés de medición (ADR-155): `initCore` lee
 * `localStorage["anonly:engine-overrides"]` una sola vez en el boot y lo
 * mergea por encima del `EngineConfigOverrides` derivado de los settings,
 * antes de `createCore`. Mismo patrón de mock que
 * `core-adapter-init-precedence.test.ts` (`createCore` parcialmente
 * mockeado) — acá el interés es qué `config` le llega, no el wiring del
 * bus-bridge. `localStorage` se stubea vía `window` porque estos tests
 * corren en Node sin jsdom (mismo criterio que `settings-persistence.test.ts`).
 */
import type * as AnonymizationCore from "@anonly/anonymization-core";
import type { EngineConfigOverrides } from "@anonly/anonymization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "anonly:engine-overrides";

function stubLocalStorage(initial?: string): void {
  let stored: string | null = initial ?? null;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => (key === STORAGE_KEY ? stored : null),
      setItem: (key: string, value: string) => {
        if (key === STORAGE_KEY) stored = value;
      },
    },
  });
}

const busOn = vi.fn(() => vi.fn());
const disposeMock = vi.fn(() => Promise.resolve());

function makeFakeCore() {
  return {
    bus: { on: busOn },
    dispose: disposeMock,
  };
}

const createCoreMock = vi.fn((_config?: EngineConfigOverrides) => Promise.resolve(makeFakeCore()));

vi.mock("@anonly/anonymization-core", async (importOriginal) => {
  const actual = await importOriginal<typeof AnonymizationCore>();
  return {
    ...actual,
    createCore: (config?: EngineConfigOverrides) => createCoreMock(config),
  };
});

const { disposeCore, initCore } = await import("../core-adapter/index.js");

describe("core-adapter/index — canal de overrides del arnés de medición (ADR-155)", () => {
  beforeEach(() => {
    createCoreMock.mockClear();
    busOn.mockClear();
    disposeMock.mockClear();
  });

  afterEach(async () => {
    await disposeCore();
    vi.unstubAllGlobals();
  });

  it("sin la clave en localStorage, el config del caller llega sin cambios", async () => {
    stubLocalStorage(undefined);
    const settingsConfig: EngineConfigOverrides = { workerPool: { ocrPoolSize: 2 } };

    await initCore(settingsConfig);

    const received = createCoreMock.mock.calls[0]?.[0];
    expect(received?.workerPool).toEqual({ ocrPoolSize: 2 });
  });

  it("mergea por encima del config del caller, sección por sección, sin borrar campos que el canal de test no toca", async () => {
    stubLocalStorage(JSON.stringify({ workerPool: { ocrPoolSize: 1 } }));
    const settingsConfig: EngineConfigOverrides = {
      workerPool: { ocrPoolSize: 4, nerPoolSize: 2 },
    };

    await initCore(settingsConfig);

    const received = createCoreMock.mock.calls[0]?.[0];
    // ocrPoolSize: el canal de test gana. nerPoolSize: no lo toca, sobrevive.
    expect(received?.workerPool).toEqual({ ocrPoolSize: 1, nerPoolSize: 2 });
  });

  it("no pisa la inyección de ner.wasmPaths salvo que el propio canal de test la nombre", async () => {
    stubLocalStorage(JSON.stringify({ ner: { enabled: false } }));

    await initCore();

    const received = createCoreMock.mock.calls[0]?.[0];
    expect(received?.ner?.enabled).toBe(false);
    expect(received?.ner?.wasmPaths).toBeDefined();
  });

  it("JSON inválido: se ignora en silencio, el boot sigue con el config normal", async () => {
    stubLocalStorage("{not valid json");
    const settingsConfig: EngineConfigOverrides = { ner: { enabled: true } };

    await expect(initCore(settingsConfig)).resolves.toBeDefined();

    const received = createCoreMock.mock.calls[0]?.[0];
    expect(received?.ner?.enabled).toBe(true);
  });

  it("un array en vez de un objeto: se ignora entero", async () => {
    stubLocalStorage(JSON.stringify([{ workerPool: { ocrPoolSize: 1 } }]));
    const settingsConfig: EngineConfigOverrides = { workerPool: { ocrPoolSize: 4 } };

    await initCore(settingsConfig);

    const received = createCoreMock.mock.calls[0]?.[0];
    expect(received?.workerPool).toEqual({ ocrPoolSize: 4 });
  });

  it("una clave fuera de EngineConfig descarta el valor entero, no solo esa clave", async () => {
    stubLocalStorage(JSON.stringify({ workerPool: { ocrPoolSize: 1 }, notAField: true }));
    const settingsConfig: EngineConfigOverrides = { workerPool: { ocrPoolSize: 4 } };

    await initCore(settingsConfig);

    const received = createCoreMock.mock.calls[0]?.[0];
    // Si se aplicara parcialmente, ocrPoolSize sería 1. Se descarta entero: sigue en 4.
    expect(received?.workerPool).toEqual({ ocrPoolSize: 4 });
  });

  it("una sección que no es un objeto (p. ej. un string) descarta el valor entero", async () => {
    stubLocalStorage(JSON.stringify({ ocr: "spa" }));
    const settingsConfig: EngineConfigOverrides = { workerPool: { ocrPoolSize: 4 } };

    await initCore(settingsConfig);

    const received = createCoreMock.mock.calls[0]?.[0];
    expect(received?.workerPool).toEqual({ ocrPoolSize: 4 });
  });
});
