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

const { disposeCore, getCore, getCoreAsync, initCore, recreateCore } =
  await import("../core-adapter/index.js");

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

  it("una clave o un tipo inválido dentro de una sección descarta todo el override", async () => {
    for (const invalid of [
      { workerPool: { ocrPoolSize: 1, unknownPoolOption: 2 } },
      { workerPool: { ocrPoolSize: "1" } },
      { workerPool: { maxQueuePerPool: { pdf: 1, ocr: 1, ner: 1, render: 1, mystery: 1 } } },
      { ner: { enabled: false, quantization: "q16" } },
    ]) {
      stubLocalStorage(JSON.stringify(invalid));
      await initCore({ workerPool: { ocrPoolSize: 4 }, ner: { enabled: true } });
      const received = createCoreMock.mock.calls[0]?.[0];
      expect(received?.workerPool?.ocrPoolSize).toBe(4);
      expect(received?.ner?.enabled).toBe(true);
      await disposeCore();
      createCoreMock.mockClear();
    }
  });
});

const ALL_JOB_TYPES = [
  "pdf-parse",
  "ocr-page",
  "ocr-orient",
  "ner-page",
  "render-page",
  "export-page",
] as const;

function jobMap(value: number): Record<(typeof ALL_JOB_TYPES)[number], number> {
  return Object.fromEntries(ALL_JOB_TYPES.map((job) => [job, value])) as Record<
    (typeof ALL_JOB_TYPES)[number],
    number
  >;
}

describe("core-adapter/index — tipos y mapas completos del canal de overrides (ADR-155)", () => {
  beforeEach(() => {
    createCoreMock.mockClear();
    busOn.mockClear();
    disposeMock.mockClear();
  });

  afterEach(async () => {
    await disposeCore();
    vi.unstubAllGlobals();
  });

  it("acepta un override válido de cada tipo de valor y lo entrega tal cual", async () => {
    const override = {
      workerPool: {
        ocrPoolSize: 2,
        timeouts: jobMap(1000),
        maxRetries: jobMap(1),
        maxQueuePerPool: { pdf: 4, ocr: 4, ner: 4, render: 4 },
      },
      ocr: { languages: ["spa", "eng"], dpi: 200 },
      ner: { quantization: "q4", modelId: "m", enabled: false, wasmPaths: "/ort/" },
      export: { defaultImageFormat: "png", defaultJpegQuality: 0.9 },
    };
    stubLocalStorage(JSON.stringify(override));

    await initCore();

    const received = createCoreMock.mock.calls[0]?.[0];
    expect(received?.workerPool).toEqual(override.workerPool);
    expect(received?.ocr).toEqual(override.ocr);
    expect(received?.ner).toMatchObject({ quantization: "q4", modelId: "m", wasmPaths: "/ort/" });
    expect(received?.export).toEqual(override.export);
  });

  it("acepta ner.wasmPaths como objeto { wasm, mjs } y lo deja pisar la inyección de la app", async () => {
    stubLocalStorage(JSON.stringify({ ner: { wasmPaths: { wasm: "/a.wasm", mjs: "/a.mjs" } } }));

    await initCore();

    expect(createCoreMock.mock.calls[0]?.[0]?.ner?.wasmPaths).toEqual({
      wasm: "/a.wasm",
      mjs: "/a.mjs",
    });
  });

  it("un mapa incompleto descarta el override entero: el merge es por sección y borraría los job types que faltan", async () => {
    const withoutOne = jobMap(1000) as Partial<Record<string, number>>;
    delete withoutOne["export-page"];
    for (const invalid of [
      { workerPool: { ocrPoolSize: 1, timeouts: { "ocr-page": 1000 } } },
      { workerPool: { ocrPoolSize: 1, timeouts: withoutOne } },
      { workerPool: { ocrPoolSize: 1, maxRetries: withoutOne } },
      { workerPool: { ocrPoolSize: 1, maxQueuePerPool: { pdf: 1, ocr: 1, ner: 1 } } },
      { workerPool: { ocrPoolSize: 1, maxQueuePerPool: {} } },
    ]) {
      stubLocalStorage(JSON.stringify(invalid));
      await initCore({ workerPool: { ocrPoolSize: 4 } });
      // Ni el campo válido (ocrPoolSize: 1) ni el mapa se aplican: sigue el 4 del caller.
      expect(createCoreMock.mock.calls[0]?.[0]?.workerPool).toEqual({ ocrPoolSize: 4 });
      await disposeCore();
      createCoreMock.mockClear();
    }
  });

  it("un valor de tipo equivocado en un mapa o en cualquier campo descarta el override entero", async () => {
    for (const invalid of [
      { workerPool: { timeouts: { ...jobMap(1000), "ocr-page": "1000" } } },
      { workerPool: { timeouts: { ...jobMap(1000), "ocr-page": Number.NaN } } },
      { workerPool: { timeouts: null } },
      { workerPool: { maxQueuePerPool: [1, 2, 3, 4] } },
      { ner: { wasmPaths: 5 } },
      { ner: { wasmPaths: { wasm: "/a.wasm", other: "/x" } } },
      { ner: { wasmPaths: { wasm: 3 } } },
      { ocr: { languages: ["spa", 3] } },
      { ocr: { languages: "spa" } },
      { export: { defaultImageFormat: "webp" } },
      { ner: { modelId: 7 } },
      { ner: { enabled: "yes" } },
      { pdf: { maxPageCount: Number.POSITIVE_INFINITY } },
    ]) {
      stubLocalStorage(JSON.stringify(invalid));
      await initCore({ ocr: { dpi: 111 } });
      expect(createCoreMock.mock.calls[0]?.[0]?.ocr).toEqual({ dpi: 111 });
      await disposeCore();
      createCoreMock.mockClear();
    }
  });

  it("nombres heredados de Object.prototype no cuentan como sección ni como campo", async () => {
    for (const invalid of [
      { constructor: { x: 1 } },
      { workerPool: { constructor: 1 } },
      { ocr: { toString: "x" } },
    ]) {
      stubLocalStorage(JSON.stringify(invalid));
      await initCore({ ocr: { dpi: 111 } });
      expect(createCoreMock.mock.calls[0]?.[0]?.ocr).toEqual({ dpi: 111 });
      await disposeCore();
      createCoreMock.mockClear();
    }
  });

  it("si localStorage no está disponible, el boot sigue sin canal de test", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
      },
    });

    await expect(initCore({ ocr: { dpi: 111 } })).resolves.toBeDefined();

    expect(createCoreMock.mock.calls[0]?.[0]?.ocr).toEqual({ dpi: 111 });
  });
});

describe("core-adapter/index — ciclo de vida del Core", () => {
  beforeEach(() => {
    createCoreMock.mockClear();
    disposeMock.mockClear();
  });

  afterEach(async () => {
    await disposeCore();
    vi.unstubAllGlobals();
  });

  it("getCore lanza sin instancia y devuelve la instancia una vez inicializado", async () => {
    stubLocalStorage(undefined);
    expect(() => getCore()).toThrow("Core not initialized");

    const instance = await initCore();

    expect(getCore()).toBe(instance);
    await expect(getCoreAsync()).resolves.toBe(instance);
  });

  it("getCoreAsync espera a que alguien inicialice, sin crear el Core por su cuenta", async () => {
    stubLocalStorage(undefined);
    const pending = getCoreAsync();
    expect(createCoreMock).not.toHaveBeenCalled();

    const instance = await initCore();

    await expect(pending).resolves.toBe(instance);
  });

  it("recreateCore libera el Core actual y crea otro con el config nuevo", async () => {
    stubLocalStorage(undefined);
    await initCore({ ocr: { dpi: 100 } });

    await recreateCore({ ocr: { dpi: 200 } });

    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(createCoreMock).toHaveBeenCalledTimes(2);
    expect(createCoreMock.mock.calls[1]?.[0]?.ocr).toEqual({ dpi: 200 });
  });

  it("si createCore falla, initCore propaga el error y un nuevo intento vuelve a poder crear", async () => {
    stubLocalStorage(undefined);
    createCoreMock.mockRejectedValueOnce(new Error("boom"));
    // Quien ya esperaba la instancia recibe el mismo rechazo (`deferredCore`).
    const waiter = getCoreAsync();

    await expect(initCore()).rejects.toThrow("boom");
    await expect(waiter).rejects.toThrow("boom");
    await expect(initCore()).resolves.toBeDefined();
    expect(createCoreMock).toHaveBeenCalledTimes(2);
  });
});
