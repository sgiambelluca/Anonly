/**
 * Las dos mitades de ADR-126 §3, que son asimétricas a propósito:
 *
 * - `persist()` **no** escribe `nerEnabled`. Desde ADR-126 la detección de
 *   nombres no es una preferencia y nada en la app la apaga, así que no hay
 *   nada que guardar. Si volviera a escribirse, un `false` que quedara en
 *   `localStorage` dejaría la app sin detección de nombres para siempre y sin
 *   ningún control con el que volver, que es exactamente el modo de falla que
 *   el ADR evita.
 * - `load()` **sí** lo lee si está presente. Es el canal de override por el
 *   que seis specs E2E arrancan sin NER (`tests/e2e/support/settingsOverride.ts`)
 *   en vez de descargar y correr el modelo en cada uno. Si esta mitad se cae,
 *   la suite sigue en verde y se vuelve mucho más lenta, sin que nada avise.
 *
 * `localStorage` se stubea porque los tests de `apps/react-client` corren en
 * Node sin jsdom (mismo criterio que el resto de este directorio).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../store/settings.store.js";

const STORAGE_KEY = "anonly:settings";

function stubLocalStorage(initial?: string): { readonly written: () => string | null } {
  let stored: string | null = initial ?? null;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => (key === STORAGE_KEY ? stored : null),
      setItem: (key: string, value: string) => {
        if (key === STORAGE_KEY) stored = value;
      },
    },
  });
  return { written: () => stored };
}

describe("settings.store persistence", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      language: "es",
      performancePreset: "auto",
      nerEnabled: true,
      ocrLanguages: ["spa", "eng"],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not write nerEnabled, so a stale false can never outlive the session", () => {
    const storage = stubLocalStorage();
    useSettingsStore.setState({ nerEnabled: false });

    useSettingsStore.getState().persist();

    const raw = storage.written();
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}")).not.toHaveProperty("nerEnabled");
  });

  it("still writes the settings that are the user's to choose", () => {
    const storage = stubLocalStorage();
    useSettingsStore.setState({ language: "en", performancePreset: "low", ocrLanguages: ["spa"] });

    useSettingsStore.getState().persist();

    expect(JSON.parse(storage.written() ?? "{}")).toMatchObject({
      language: "en",
      performancePreset: "low",
      ocrLanguages: ["spa"],
    });
  });

  it("clears a nerEnabled left over by an older version on the first persist", () => {
    const storage = stubLocalStorage(JSON.stringify({ language: "es", nerEnabled: false }));

    useSettingsStore.getState().persist();

    expect(JSON.parse(storage.written() ?? "{}")).not.toHaveProperty("nerEnabled");
  });

  it("still honours a persisted nerEnabled on load: it is the E2E override channel", () => {
    stubLocalStorage(JSON.stringify({ nerEnabled: false }));

    useSettingsStore.getState().load();

    expect(useSettingsStore.getState().nerEnabled).toBe(false);
  });

  it("leaves nerEnabled on when nothing overrode it", () => {
    stubLocalStorage(JSON.stringify({ language: "en" }));

    useSettingsStore.getState().load();

    expect(useSettingsStore.getState().nerEnabled).toBe(true);
  });
});

describe("autoUpdate", () => {
  beforeEach(() => {
    // Reconstruye el estado desde el default REAL del módulo
    // (`useSettingsStore.getInitialState()`, Zustand v5) en vez de forzar
    // `{ autoUpdate: false }` a mano: forzar el valor esperado hace que
    // "arranca en false" compare ese valor contra sí mismo y nunca pueda
    // fallar, ni siquiera si `DEFAULT_SETTINGS.autoUpdate` cambiara a `true`.
    useSettingsStore.setState(useSettingsStore.getInitialState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arranca en false: se pregunta antes de instalar", () => {
    // No es una comodidad: reemplazarle la app en silencio a alguien que está
    // anonimizando pericias es lo que erosiona la confianza en una herramienta
    // que se vende como local (ADR-131 §3). El default es preguntar.
    //
    // Contra `getInitialState()` y no contra `getState()`: con el `beforeEach`
    // de arriba dan lo mismo ACÁ, pero esta aserción sigue siendo la que
    // importa aunque alguien saque ese `beforeEach` más adelante.
    expect(useSettingsStore.getInitialState().autoUpdate).toBe(false);
  });

  it("se persiste y sobrevive a una sesión nueva", () => {
    const storage = stubLocalStorage();
    useSettingsStore.setState({ autoUpdate: true });
    useSettingsStore.getState().persist();

    expect(JSON.parse(storage.written() ?? "{}")).toHaveProperty("autoUpdate", true);

    // Simula el arranque siguiente: estado limpio, se hidrata de localStorage.
    useSettingsStore.setState(useSettingsStore.getInitialState());
    useSettingsStore.getState().load();

    expect(useSettingsStore.getState().autoUpdate).toBe(true);
  });

  it("una preferencia ausente no pisa el default", () => {
    // Alguien que actualiza desde una versión sin este setting no debería
    // encontrarse con que la app se actualiza sola sin habérselo pedido.
    // Comparado contra `getInitialState()`, no contra un `false` literal: si
    // el default cambiara, este test tiene que fallar junto con el de arriba,
    // no quedarse en verde porque el literal coincide por casualidad.
    stubLocalStorage(JSON.stringify({ language: "en" }));
    useSettingsStore.getState().load();

    expect(useSettingsStore.getState().autoUpdate).toBe(
      useSettingsStore.getInitialState().autoUpdate,
    );
  });
});

describe("checkUpdates (ADR-188)", () => {
  beforeEach(() => {
    // Mismo criterio que `autoUpdate` arriba: reconstruir desde el default
    // real, no forzar el literal que se espera.
    useSettingsStore.setState(useSettingsStore.getInitialState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arranca en true: las actualizaciones llevan correcciones", () => {
    expect(useSettingsStore.getInitialState().checkUpdates).toBe(true);
  });

  it("se persiste y sobrevive a una sesión nueva", () => {
    const storage = stubLocalStorage();
    useSettingsStore.setState({ checkUpdates: false });
    useSettingsStore.getState().persist();

    expect(JSON.parse(storage.written() ?? "{}")).toHaveProperty("checkUpdates", false);

    // Simula el arranque siguiente: estado limpio, se hidrata de localStorage.
    useSettingsStore.setState(useSettingsStore.getInitialState());
    useSettingsStore.getState().load();

    expect(useSettingsStore.getState().checkUpdates).toBe(false);
  });

  it("una configuración persistida sin la clave se lee como el default", () => {
    // Instalaciones existentes, de antes de ADR-188: tienen que seguir
    // buscando actualizaciones igual que hoy, sin que nadie se los pida. El
    // `beforeEach` reconstruye el estado desde `getInitialState()`; acá se
    // confirma que un `load()` con otras claves presentes pero sin
    // `checkUpdates` no lo mueve del default real.
    stubLocalStorage(JSON.stringify({ language: "en" }));

    useSettingsStore.getState().load();

    expect(useSettingsStore.getState().checkUpdates).toBe(
      useSettingsStore.getInitialState().checkUpdates,
    );
  });
});

describe("theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useSettingsStore.setState({ theme: "system" });
  });

  it('arranca en "system": la mayoría ya eligió una vez a nivel del sistema', () => {
    expect(useSettingsStore.getState().theme).toBe("system");
  });

  it("se persiste y sobrevive a una sesión nueva", () => {
    const storage = stubLocalStorage();
    useSettingsStore.setState({ theme: "dark" });
    useSettingsStore.getState().persist();

    expect(JSON.parse(storage.written() ?? "{}")).toHaveProperty("theme", "dark");

    useSettingsStore.setState({ theme: "light" });
    useSettingsStore.getState().load();

    expect(useSettingsStore.getState().theme).toBe("dark");
  });
});
