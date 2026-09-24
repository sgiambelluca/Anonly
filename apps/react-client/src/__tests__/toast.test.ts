/**
 * `toast.ts` (`ui/Components.md` §8.6) — emisor imperativo, sin estado
 * retenido: un `showToast` solo llega a quien esté suscripto en ese momento.
 * ADR-174 §4 suma `tone: "warning"` y `persistent` (el toast de un choque
 * sin resolver no expira solo). ADR-175 §3 suma `tone: "error"` (el toast de
 * "No se pudo agregar «X».") y `showToast` devuelve el `ToastMessage`
 * armado, que `ManualOverlapDialogHost` necesita para saber si el toast que
 * ve en pantalla sigue siendo el aviso que mostró (ADR-175 §5).
 */

import { describe, expect, it, vi } from "vitest";

import { dismissToast, showToast, subscribeToToasts } from "../components/common/toast.js";

describe("toast.ts", () => {
  it("showToast avisa a los suscriptores con un id monótono creciente", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToToasts(listener);

    showToast({ title: "Primero" });
    showToast({ title: "Segundo" });

    const firstId = listener.mock.calls[0]?.[0]?.id as number;
    const secondId = listener.mock.calls[1]?.[0]?.id as number;
    expect(secondId).toBeGreaterThan(firstId);
    unsubscribe();
  });

  it("dismissToast avisa null a los suscriptores", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToToasts(listener);

    dismissToast();

    expect(listener).toHaveBeenCalledWith(null);
    unsubscribe();
  });

  it("un suscriptor desuscripto no recibe más toasts", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToToasts(listener);
    unsubscribe();

    showToast({ title: "X" });

    expect(listener).not.toHaveBeenCalled();
  });

  // ADR-174 §4: el toast de un choque sin resolver.
  it("propaga tone: warning y persistent tal cual", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToToasts(listener);

    showToast({
      title: "Quedó un choque sin resolver en «X»",
      tone: "warning",
      persistent: true,
      actions: [{ label: "Resolver", run: vi.fn() }],
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "warning", persistent: true }),
    );
    unsubscribe();
  });

  it("sin persistent, el campo queda undefined (toast normal)", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToToasts(listener);

    showToast({ title: "Agregaste «X»", tone: "success" });

    expect(listener.mock.calls[0]?.[0]?.persistent).toBeUndefined();
    unsubscribe();
  });

  // ADR-175 §3: "No se pudo agregar «X»."
  it("acepta tone: error", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToToasts(listener);

    showToast({ title: "No se pudo agregar «X».", tone: "error" });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ tone: "error" }));
    unsubscribe();
  });

  // ADR-175 §5: `ManualOverlapDialogHost` necesita el `id` del toast que
  // acaba de mostrar para saber, más tarde, si sigue siendo el vigente.
  it("showToast devuelve el ToastMessage armado, con el mismo id que reciben los suscriptores", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToToasts(listener);

    const shown = showToast({ title: "X" });

    expect(shown.title).toBe("X");
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: shown.id }));
    unsubscribe();
  });
});
