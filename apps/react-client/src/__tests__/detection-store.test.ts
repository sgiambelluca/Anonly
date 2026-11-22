/**
 * `detection.store` (`React_Client.md` §3.8, ADR-227 §3): el borrador, el
 * contador de cambios, «Deshacer», `commit()` con la recreación del Core y la
 * persistencia en `localStorage["anonly:detection"]`.
 *
 * `recreateCore` se mockea: `core-adapter/index.ts` importa los workers
 * (`?worker`) y no corre en node. `localStorage` se stubea por la misma razón
 * que en `settings-persistence.test.ts` (node sin jsdom).
 */

import type { EngineConfigOverrides } from "@anonly/anonymization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recreateCore } from "../core-adapter/index.js";
import { useDetectionStore } from "../store/detection.store.js";
import { DEFAULT_DETECTION_STATE, DETECTION_STORAGE_KEY } from "../store/detectionState.js";

import { userFormat, userType } from "./helpers/detectionFixtures.js";

vi.mock("../core-adapter/index.js", () => ({ recreateCore: vi.fn() }));

function stubLocalStorage(initial?: string): { readonly written: () => string | null } {
  let stored: string | null = initial ?? null;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => (key === DETECTION_STORAGE_KEY ? stored : null),
      setItem: (key: string, value: string) => {
        if (key === DETECTION_STORAGE_KEY) stored = value;
      },
    },
  });
  return { written: () => stored };
}

const store = () => useDetectionStore.getState();

describe("detection.store", () => {
  beforeEach(() => {
    useDetectionStore.setState({
      saved: DEFAULT_DETECTION_STATE,
      draft: null,
      draftHistory: [],
      pendingChanges: 0,
    });
    vi.mocked(recreateCore).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("openDraft copia lo guardado y sin cambios no hay nada pendiente", () => {
    store().openDraft();
    expect(store().draft).toEqual(DEFAULT_DETECTION_STATE);
    expect(store().pendingChanges).toBe(0);
  });

  it("applyToDraft cuenta un cambio por acción y no toca lo guardado", () => {
    store().openDraft();
    store().applyToDraft({ kind: "createType", definition: userType(0, "Legajo") });
    store().applyToDraft({ kind: "setBaseFormatEnabled", formatId: "dni-ar", enabled: false });
    expect(store().pendingChanges).toBe(2);
    expect(store().draft?.userTypes).toHaveLength(1);
    expect(store().saved).toEqual(DEFAULT_DETECTION_STATE);
  });

  it("una importación entera cuenta como un solo cambio", () => {
    store().openDraft();
    const type = userType(0, "Legajo");
    store().applyToDraft({
      kind: "importFile",
      types: [type],
      formats: [userFormat(1, "Legajo largo", type.id), userFormat(2, "Interno")],
      catalogRefs: [],
    });
    expect(store().pendingChanges).toBe(1);
    expect(store().draft?.userFormats).toHaveLength(2);
  });

  it("applyToDraft sin borrador abierto no hace nada", () => {
    store().applyToDraft({ kind: "createType", definition: userType(0, "Legajo") });
    expect(store().draft).toBeNull();
    expect(store().pendingChanges).toBe(0);
  });

  it("un cambio rechazado deja el borrador como estaba, sin contar y sin loguear su contenido", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    store().openDraft();
    store().applyToDraft({ kind: "createType", definition: userType(0, "") });
    expect(store().pendingChanges).toBe(0);
    expect(store().draft).toEqual(DEFAULT_DETECTION_STATE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("user:");
  });

  it("undoLastDraftChange deshace de a un cambio y no pasa de cero", () => {
    store().openDraft();
    store().applyToDraft({ kind: "createType", definition: userType(0, "Legajo") });
    store().applyToDraft({ kind: "createType", definition: userType(1, "Expediente") });

    store().undoLastDraftChange();
    expect(store().draft?.userTypes.map((type) => type.name)).toEqual(["Legajo"]);
    expect(store().pendingChanges).toBe(1);

    store().undoLastDraftChange();
    expect(store().draft).toEqual(DEFAULT_DETECTION_STATE);
    expect(store().pendingChanges).toBe(0);

    store().undoLastDraftChange();
    expect(store().pendingChanges).toBe(0);
  });

  it("discardDraft cierra el borrador sin guardar nada", () => {
    const storage = stubLocalStorage();
    store().openDraft();
    store().applyToDraft({ kind: "createType", definition: userType(0, "Legajo") });
    store().discardDraft();
    expect(store().draft).toBeNull();
    expect(store().pendingChanges).toBe(0);
    expect(store().saved).toEqual(DEFAULT_DETECTION_STATE);
    expect(storage.written()).toBeNull();
  });

  it("nada del borrador llega a localStorage antes de commit()", () => {
    const storage = stubLocalStorage();
    store().openDraft();
    store().applyToDraft({ kind: "createType", definition: userType(0, "Legajo") });
    expect(storage.written()).toBeNull();
  });

  it("commit() persiste, recrea el Core con la sección `detection` y cierra el borrador", async () => {
    const storage = stubLocalStorage();
    store().openDraft();
    store().applyToDraft({ kind: "createType", definition: userType(0, "Legajo") });
    store().applyToDraft({ kind: "setBaseFormatEnabled", formatId: "dni-ar", enabled: false });

    await store().commit();

    expect(recreateCore).toHaveBeenCalledTimes(1);
    const override: EngineConfigOverrides | undefined = vi.mocked(recreateCore).mock.calls[0]?.[0];
    expect(override?.detection?.baseFormats).toEqual([{ formatId: "dni-ar", enabled: false }]);
    expect(override?.detection?.userTypes?.map((type) => type.name)).toEqual(["Legajo"]);
    expect(store().draft).toBeNull();
    expect(store().pendingChanges).toBe(0);
    expect(store().saved.userTypes).toHaveLength(1);
    expect(JSON.parse(storage.written() ?? "{}")).toMatchObject({ version: 1, country: "AR" });
  });

  it("commit() no recrea el Core si el override derivado no cambió", async () => {
    stubLocalStorage();
    store().openDraft();
    store().applyToDraft({ kind: "setBaseFormatEnabled", formatId: "dni-ar", enabled: false });
    store().applyToDraft({ kind: "setBaseFormatEnabled", formatId: "dni-ar", enabled: true });

    await store().commit();

    expect(recreateCore).not.toHaveBeenCalled();
    expect(store().draft).toBeNull();
  });

  it("si recrear el Core falla, commit() rechaza y deja el borrador y lo guardado intactos", async () => {
    const storage = stubLocalStorage();
    vi.mocked(recreateCore).mockRejectedValue(new Error("falló"));
    store().openDraft();
    store().applyToDraft({ kind: "createType", definition: userType(0, "Legajo") });

    await expect(store().commit()).rejects.toThrow("falló");

    expect(store().draft?.userTypes).toHaveLength(1);
    expect(store().pendingChanges).toBe(1);
    expect(store().saved).toEqual(DEFAULT_DETECTION_STATE);
    expect(storage.written()).toBeNull();
  });

  it("commit() sin borrador no hace nada", async () => {
    await store().commit();
    expect(recreateCore).not.toHaveBeenCalled();
  });

  it("saveDocumentType guarda el tipo para los próximos documentos y unsaveDocumentType lo deshace", () => {
    const storage = stubLocalStorage();
    const type = userType(0, "Legajo");

    store().saveDocumentType(type);
    expect(store().saved.userTypes).toEqual([type]);
    expect(JSON.parse(storage.written() ?? "{}").userTypes).toEqual([type]);
    // No recrea el Core: hay un documento abierto (ADR-225 §5).
    expect(recreateCore).not.toHaveBeenCalled();

    store().saveDocumentType(type);
    expect(store().saved.userTypes).toHaveLength(1);

    store().unsaveDocumentType(type.id);
    expect(store().saved.userTypes).toEqual([]);
    store().unsaveDocumentType(type.id);
    expect(store().saved.userTypes).toEqual([]);
  });

  it("saveDocumentType ignora, sin loguear su contenido, un tipo que no valida", () => {
    stubLocalStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    store().saveDocumentType(userType(0, ""));
    expect(store().saved.userTypes).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("load() lee lo persistido y descarta lo que ya no valida", () => {
    const type = userType(0, "Legajo");
    stubLocalStorage(
      JSON.stringify({
        ...DEFAULT_DETECTION_STATE,
        userTypes: [type, { id: "user:roto", name: "" }],
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    store().load();

    expect(store().saved.userTypes).toEqual([type]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("1");
  });

  it("load() sin nada guardado, o con algo ilegible, deja los defaults", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubLocalStorage();
    store().load();
    expect(store().saved).toEqual(DEFAULT_DETECTION_STATE);

    stubLocalStorage("{roto");
    store().load();
    expect(store().saved).toEqual(DEFAULT_DETECTION_STATE);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("persist y load sobreviven a un localStorage que lanza", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("bloqueado");
        },
        setItem: () => {
          throw new Error("cuota");
        },
      },
    });
    expect(() => store().persist()).not.toThrow();
    expect(() => store().load()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
