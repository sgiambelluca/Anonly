/**
 * Regresión PR17.3: `initCore`/`getCoreAsync` bajo carrera de montaje.
 *
 * Bug original: `App.tsx` (con el `EngineConfigOverrides` derivado de
 * `settings.store`, PR16.5) y `PasswordDialog.tsx` (sin config, solo para
 * `core.bus`) llamaban ambos a `initCore()` desde su propio `useEffect` de
 * montaje. Como los efectos de los componentes hijos corren antes que los
 * del padre en el mismo commit (`PasswordDialog` es descendiente de `App`),
 * un fix ingenuo que solo cachea "la primera promesa que llega" deja que el
 * caller *sin* config gane la carrera y arranque `createCore()` sin los
 * overrides de `App.tsx` — reintroduciendo en silencio el bug de PR16.5.
 *
 * Este archivo prueba que, sin importar el orden de llamada, (a) `createCore`
 * se invoca una sola vez, (b) el `config` que efectivamente llega es el de
 * `initCore` (el único caller con potestad para arrancar la creación), y (c)
 * todos los consumidores terminan viendo la misma instancia.
 *
 * `@anonly/anonymization-core` se mockea parcialmente (solo `createCore`;
 * `importOriginal` preserva el resto de los exports en runtime) porque
 * `bus-bridge.ts` (código real, no mockeado acá) importa `EngineEvents`/
 * `EventChannel`/`PipelineStage` de ese mismo módulo y los usa como claves al
 * suscribir el bus — perderlos rompería `subscribe()` en runtime aunque el
 * mock nunca llegue a compararlos. El objeto `core` fake solo implementa lo
 * que el código bajo test toca de verdad (`bus.on` vía `subscribe`,
 * `dispose` vía `disposeCore`), mismo criterio que `actions.test.ts` (no
 * declara conformar `IAnonymizationCore`/`IEventBus`: `Code_Standards.md`
 * §10 prohíbe `as unknown as` contra tipos propios en tests).
 */
import type * as AnonymizationCore from "@anonly/anonymization-core";
import type { EngineConfigOverrides } from "@anonly/anonymization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { disposeCore, getCoreAsync, initCore } = await import("../core-adapter/index.js");

describe("core-adapter/index — precedencia de config bajo carrera de montaje (PR17.3)", () => {
  beforeEach(() => {
    createCoreMock.mockClear();
    busOn.mockClear();
    disposeMock.mockClear();
  });

  afterEach(async () => {
    await disposeCore();
  });

  it("un caller sin config que llama primero (simulando a PasswordDialog, hijo) no arranca la creación ni pisa el config de quien la arranca (App, padre)", async () => {
    // Orden explícito: el consumidor de solo lectura llama ANTES que el
    // consumidor con autoridad — el escenario exacto del bug (el efecto del
    // hijo corre antes que el del padre en el mismo commit de montaje).
    const readOnlyPromise = getCoreAsync();
    expect(createCoreMock).not.toHaveBeenCalled();

    const overrides: EngineConfigOverrides = { ner: { enabled: false } };
    const initPromise = initCore(overrides);

    const [readOnlyCore, initializedCore] = await Promise.all([readOnlyPromise, initPromise]);

    expect(createCoreMock).toHaveBeenCalledTimes(1);
    const receivedConfig = createCoreMock.mock.calls[0]?.[0];
    expect(receivedConfig?.ner?.enabled).toBe(false);
    // La inyección de wasmPaths (ADR-039) sigue aplicándose por debajo del
    // override del caller, sin que el merge se pierda por la carrera.
    expect(receivedConfig?.ner?.wasmPaths).toBeDefined();

    expect(readOnlyCore).toBe(initializedCore);
  });

  it("dos callers sin config que llaman antes de initCore esperan la misma instancia que initCore termina creando", async () => {
    const firstReadOnly = getCoreAsync();
    const secondReadOnly = getCoreAsync();
    expect(createCoreMock).not.toHaveBeenCalled();

    const overrides: EngineConfigOverrides = { ner: { enabled: true } };
    const initialized = await initCore(overrides);
    const [first, second] = await Promise.all([firstReadOnly, secondReadOnly]);

    expect(createCoreMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(initialized);
    expect(second).toBe(initialized);
  });

  it("getCoreAsync devuelve la instancia ya lista de inmediato una vez que initCore resolvió", async () => {
    const initialized = await initCore();

    const afterReady = await getCoreAsync();

    expect(afterReady).toBe(initialized);
    expect(createCoreMock).toHaveBeenCalledTimes(1);
  });
});
