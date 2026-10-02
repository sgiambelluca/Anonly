/**
 * Una edición nueva retira el toast de edición vigente (`UX_Guidelines.md` §3.3b, `React_Client.md` §3.6c). Si quedara, su
 * "Deshacer" desharía la última edición de la pila y no la que el toast nombra.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.hoisted(() => vi.fn<(label: string) => boolean>());

vi.mock("../core-adapter/history.js", () => ({
  useHistoryStore: { getState: () => ({ record }) },
}));

import { showToast, subscribeToToasts, type ToastMessage } from "../components/common/toast.js";
import { editToast, recordEdit } from "../components/entities/editHistory.js";

describe("recordEdit retira el toast de edición vigente (React_Client §3.6c)", () => {
  let seen: Array<ToastMessage | null>;
  let unsubscribe: () => void;

  beforeEach(() => {
    record.mockReset();
    seen = [];
    unsubscribe = subscribeToToasts((toast) => seen.push(toast));
  });

  afterEach(() => unsubscribe());

  it("an edit that enters the stack closes the previous edit toast, even without a toast of its own", () => {
    record.mockReturnValue(true);
    showToast(editToast({ title: "Cambiaste el reemplazo de «Juan»" }, true));
    expect(seen.at(-1)?.title).toBe("Cambiaste el reemplazo de «Juan»");

    // Cambio de modo de otra fila: se registra y no muestra toast.
    expect(recordEdit("«Banco» cambia de modo")).toBe(true);

    expect(seen.at(-1)).toBeNull();
  });

  it("an edit that did not enter the stack leaves the toast alone", () => {
    record.mockReturnValue(false);
    showToast(editToast({ title: "Edición A" }, true));

    expect(recordEdit("Edición B")).toBe(false);

    expect(seen.at(-1)?.title).toBe("Edición A");
  });

  it("does not close a toast that is not an edit toast (p. ej. el aviso persistente de un choque)", () => {
    record.mockReturnValue(true);
    showToast({ title: "Quedó un choque sin resolver", tone: "warning", persistent: true });

    recordEdit("Edición");

    expect(seen.at(-1)?.title).toBe("Quedó un choque sin resolver");
  });
});
