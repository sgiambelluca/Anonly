/**
 * ADR-194 §9: un perfil de rendimiento elegido con un documento abierto no
 * recrea el Core; al cerrar el documento sí, con el override del perfil
 * elegido, y sin cambio de perfil no se recrea nada. Un PDF que se suelta
 * mientras se recrea espera al Core nuevo.
 *
 * `createCore` se mockea (mismo criterio que `core-adapter-init-precedence`):
 * lo que se prueba es qué config recibe y cuándo, no el Core.
 */
import type * as AnonymizationCore from "@anonly/anonymization-core";
import type { EngineConfigOverrides } from "@anonly/anonymization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MIB = 1024 ** 2;

let created = 0;
const importCalls: number[] = [];

/** Un bus mínimo que sí despacha: cada Core tiene el suyo, como el real. */
function makeFakeBus() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on: (channel: string, event: string, handler: (payload: unknown) => void) => {
      const key = `${channel}:${event}`;
      const set = handlers.get(key) ?? new Set();
      set.add(handler);
      handlers.set(key, set);
      return () => set.delete(handler);
    },
    emit: (channel: string, event: string, payload: unknown) => {
      for (const handler of handlers.get(`${channel}:${event}`) ?? []) handler(payload);
    },
    listenerCount: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

const cores: Array<{
  readonly bus: ReturnType<typeof makeFakeBus>;
  readonly dispose: ReturnType<typeof vi.fn>;
}> = [];
let disposeRejection: Error | undefined;
let creationGate: Promise<void> | undefined;

function makeFakeCore() {
  const id = ++created;
  const core = {
    id,
    bus: makeFakeBus(),
    orchestrator: {
      importDocument: vi.fn(() => {
        importCalls.push(id);
        return Promise.resolve();
      }),
    },
    dispose: vi.fn(() =>
      id === 1 && disposeRejection !== undefined
        ? Promise.reject(disposeRejection)
        : Promise.resolve(),
    ),
  };
  cores.push(core);
  return core;
}

const createCoreMock = vi.fn(async (_config?: EngineConfigOverrides) => {
  const gate = created === 1 ? creationGate : undefined;
  if (gate !== undefined) await gate;
  return makeFakeCore();
});

vi.mock("@anonly/anonymization-core", async (importOriginal) => {
  const actual = await importOriginal<typeof AnonymizationCore>();
  return {
    ...actual,
    createCore: (config?: EngineConfigOverrides) => createCoreMock(config),
  };
});

const { disposeCore, getCore, getCoreWhenReady, initCore, recreateCore, subscribeToLiveCore } =
  await import("../core-adapter/index.js");
const { subscribePasswordRequired } = await import("../core-adapter/bus-bridge.js");
const { actions } = await import("../core-adapter/actions.js");
const { deriveEngineConfigOverrides } = await import("../core-adapter/settingsToEngineConfig.js");
const { useSettingsStore } = await import("../store/settings.store.js");
const { useDocumentStore } = await import("../store/document.store.js");

async function bootWith(preset: "medium" | "high"): Promise<void> {
  useSettingsStore.setState({ performancePreset: preset });
  await initCore(deriveEngineConfigOverrides(useSettingsStore.getState(), {}));
}

function openDocument(): void {
  useDocumentStore.setState({ id: "doc-1" });
}

describe("el perfil elegido con un documento abierto rige al cerrarlo (ADR-194 §9)", () => {
  beforeEach(() => {
    created = 0;
    cores.length = 0;
    disposeRejection = undefined;
    creationGate = undefined;
    importCalls.length = 0;
    createCoreMock.mockClear();
    useSettingsStore.setState(useSettingsStore.getInitialState());
  });

  afterEach(async () => {
    await disposeCore();
    useDocumentStore.getState().reset();
  });

  it("invariante: cambiar el perfil con el documento abierto no recrea el Core (no discrimina contra el código anterior)", async () => {
    await bootWith("medium");
    openDocument();

    useSettingsStore.setState({ performancePreset: "high" });
    await getCoreWhenReady();

    expect(createCoreMock).toHaveBeenCalledTimes(1);
  });

  it("al cerrar el documento se recrea, y el Core nuevo recibe el override del perfil elegido", async () => {
    await bootWith("medium");
    openDocument();
    useSettingsStore.setState({ performancePreset: "high" });

    actions.closeDocument();
    await getCoreWhenReady();

    expect(createCoreMock).toHaveBeenCalledTimes(2);
    const config = createCoreMock.mock.calls[1]?.[0];
    expect(config?.workerPool).toEqual({ ocrPoolSize: 4, nerPoolSize: 2 });
    expect(config?.ocr?.maxLiveImageBytes).toBe(136 * MIB);
  });

  it("sin cambio de perfil, cerrar el documento no recrea nada", async () => {
    await bootWith("medium");
    openDocument();

    actions.closeDocument();
    await getCoreWhenReady();

    expect(createCoreMock).toHaveBeenCalledTimes(1);
  });

  it("volver al perfil original antes de cerrar tampoco recrea", async () => {
    await bootWith("medium");
    openDocument();
    useSettingsStore.setState({ performancePreset: "high" });
    useSettingsStore.setState({ performancePreset: "medium" });

    actions.closeDocument();
    await getCoreWhenReady();

    expect(createCoreMock).toHaveBeenCalledTimes(1);
  });

  it("un PDF soltado mientras se recrea espera al Core nuevo, no cae en uno ausente", async () => {
    await bootWith("medium");
    openDocument();
    useSettingsStore.setState({ performancePreset: "high" });

    actions.closeDocument();
    // Sin esperar: es el momento en que el Core viejo se está liberando.
    await actions.importDocument(new File(["%PDF"], "a.pdf"));

    expect(importCalls).toEqual([2]);
  });

  describe("los consumidores del bus siguen al Core vivo", () => {
    const override = (level: "high" | "ultra") =>
      deriveEngineConfigOverrides(
        { performancePreset: level, nerEnabled: true, ocrLanguages: ["spa", "eng"] },
        {},
      );

    it("tras una recreación, PDF_PASSWORD_REQUIRED del Core nuevo llega, y el del viejo ya no", async () => {
      await bootWith("medium");
      const received: string[] = [];
      const unsubscribe = subscribeToLiveCore((bus) =>
        subscribePasswordRequired(bus, (documentId) => received.push(documentId)),
      );

      await recreateCore(override("high"));

      cores[1]?.bus.emit("pdf", "PDF_PASSWORD_REQUIRED", { documentId: "nuevo" });
      cores[0]?.bus.emit("pdf", "PDF_PASSWORD_REQUIRED", { documentId: "viejo" });
      expect(received).toEqual(["nuevo"]);
      unsubscribe();
    });

    it("no duplica suscripciones ni deja la vieja colgada tras varias recreaciones", async () => {
      await bootWith("medium");
      const received: string[] = [];
      subscribeToLiveCore((bus) =>
        subscribePasswordRequired(bus, (documentId) => received.push(documentId)),
      );
      const before = cores[0]?.bus.listenerCount() ?? 0;

      await recreateCore(override("high"));
      await recreateCore(override("ultra"));

      cores[2]?.bus.emit("pdf", "PDF_PASSWORD_REQUIRED", { documentId: "x" });
      expect(received).toEqual(["x"]);
      expect(cores[0]?.bus.listenerCount()).toBe(0);
      expect(cores[1]?.bus.listenerCount()).toBe(0);
      expect(cores[2]?.bus.listenerCount()).toBe(before);
    });

    it("el que se suscribe antes de que exista el Core se conecta cuando se crea", async () => {
      const received: string[] = [];
      subscribeToLiveCore((bus) =>
        subscribePasswordRequired(bus, (documentId) => received.push(documentId)),
      );
      await bootWith("medium");

      cores[0]?.bus.emit("pdf", "PDF_PASSWORD_REQUIRED", { documentId: "a" });
      expect(received).toEqual(["a"]);
    });

    it("el que se da de baja deja de recibir del Core vivo y de los siguientes", async () => {
      await bootWith("medium");
      const received: string[] = [];
      const unsubscribe = subscribeToLiveCore((bus) =>
        subscribePasswordRequired(bus, (documentId) => received.push(documentId)),
      );
      unsubscribe();

      cores[0]?.bus.emit("pdf", "PDF_PASSWORD_REQUIRED", { documentId: "a" });
      await recreateCore(override("high"));
      cores[1]?.bus.emit("pdf", "PDF_PASSWORD_REQUIRED", { documentId: "b" });
      expect(received).toEqual([]);
    });
  });

  it("la recreación de Configuración espera a la que dejó pendiente cerrar el documento", async () => {
    await bootWith("medium");
    openDocument();
    useSettingsStore.setState({ performancePreset: "high" });
    let release: () => void = () => undefined;
    creationGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    actions.closeDocument();
    const fromDialog = recreateCore(
      deriveEngineConfigOverrides(
        { performancePreset: "ultra", nerEnabled: true, ocrLanguages: ["spa", "eng"] },
        {},
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // La del cierre sigue creando su Core: la del diálogo no arrancó.
    expect(createCoreMock).toHaveBeenCalledTimes(2);

    release();
    await fromDialog;

    expect(createCoreMock).toHaveBeenCalledTimes(3);
    expect(cores[1]?.dispose).toHaveBeenCalledTimes(1);
    expect(createCoreMock.mock.calls[2]?.[0]?.workerPool).toEqual({
      ocrPoolSize: 6,
      nerPoolSize: 2,
    });
    expect(getCore()).toBe(cores[2]);
  });

  describe("una recreación cuyo dispose falla deja el estado coherente", () => {
    it("el Core nuevo queda vivo, con su bridge y sus consumidores, y el error se registra", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      disposeRejection = new Error("dispose roto");
      await bootWith("medium");
      const received: string[] = [];
      subscribeToLiveCore((bus) =>
        subscribePasswordRequired(bus, (documentId) => received.push(documentId)),
      );

      await recreateCore(
        deriveEngineConfigOverrides(
          { performancePreset: "high", nerEnabled: true, ocrLanguages: ["spa", "eng"] },
          {},
        ),
      );

      expect(getCore()).toBe(cores[1]);
      cores[1]?.bus.emit("pdf", "PDF_PASSWORD_REQUIRED", { documentId: "n" });
      expect(received).toEqual(["n"]);
      expect(cores[1]?.bus.listenerCount()).toBeGreaterThan(1);
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    });

    it("al cerrar el documento, el Core nuevo recibe el perfil elegido aunque el dispose falle", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      disposeRejection = new Error("dispose roto");
      await bootWith("medium");
      openDocument();
      useSettingsStore.setState({ performancePreset: "high" });

      actions.closeDocument();
      const core = await getCoreWhenReady();

      expect(core).toBe(cores[1]);
      expect(createCoreMock.mock.calls[1]?.[0]?.workerPool).toEqual({
        ocrPoolSize: 4,
        nerPoolSize: 2,
      });
      logged.mockRestore();
    });
  });

  it("PasswordDialog se suscribe por subscribeToLiveCore y no por una referencia única al Core", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const fuente = await readFile(
      resolve(__dirname, "../components/toolbar/PasswordDialog.tsx"),
      "utf8",
    );
    const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(sinComentarios).toContain("subscribeToLiveCore(");
    expect(sinComentarios).not.toContain("getCoreAsync");
    expect(sinComentarios).not.toContain("getCore(");
  });
});
