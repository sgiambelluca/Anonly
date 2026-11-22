import { describe, expect, it } from "vitest";

import {
  fieldBorderClass,
  joinHelp,
  lengthCounter,
  resolveFieldHint,
} from "../components/common/fieldHintText.js";

describe("fieldHint", () => {
  it("muestra la ayuda cuando no hay error", () => {
    expect(resolveFieldHint("6/40", null)).toEqual({ kind: "help", text: "6/40" });
    expect(resolveFieldHint("6/40", "")).toEqual({ kind: "help", text: "6/40" });
  });

  it("el error reemplaza a la ayuda", () => {
    expect(resolveFieldHint("6/40", "Acortalo.")).toEqual({ kind: "error", text: "Acortalo." });
  });

  it("cuenta letras sin los espacios de los bordes", () => {
    expect(lengthCounter("  Legajo ", 40)).toBe("6/40");
    expect(lengthCounter("", 40)).toBe("0/40");
  });

  it("une la ayuda salteando partes vacías", () => {
    expect(joinHelp("6/40", "", "Así se ve: [A 01]")).toBe("6/40 · Así se ve: [A 01]");
  });

  it("marca el borde en rojo solo con error", () => {
    expect(fieldBorderClass(true)).toBe("border-error");
    expect(fieldBorderClass(false)).toBe("border-border");
  });
});
