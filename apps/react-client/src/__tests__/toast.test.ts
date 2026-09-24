/**
 * `toast.ts` (`ui/Components.md` §8.6) — emisor imperativo, sin estado
 * retenido: un `showToast` solo llega a quien esté suscripto en ese momento.
 * ADR-174 §4 suma `tone: "warning"` y `persistent` (el toast de un choque
 * sin resolver no expira solo).
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
});
