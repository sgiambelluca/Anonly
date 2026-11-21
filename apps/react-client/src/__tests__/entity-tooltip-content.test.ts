/**
 * Lo que dice el tooltip del visor (`Components.md` §13b.8, ADR-224 §4,
 * ADR-226 §4). Los casos son los de `Tooltips.dc.html`.
 */
import { EntityType, ReplacementMode } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  buildEntityTooltip,
  replacementText,
  TOOLTIP_DISABLED_REPLACEMENT,
  TOOLTIP_ROW_LABEL,
} from "../components/viewer/entityTooltipContent.js";

import { stateWith, userFormat, userType } from "./helpers/detectionFixtures.js";
import { makeGroup, member } from "./helpers/groupFixtures.js";

const cbuFormat = userFormat(1, "CBU", EntityType.Custom);
const hcType = userType(2, "Historia clínica");
const hcFormat = userFormat(3, "HC con prefijo", hcType.id);
const detection = stateWith({ userTypes: [hcType], userFormats: [cbuFormat, hcFormat] });

describe("replacementText", () => {
  it("etiquetar: el modo y el token", () => {
    expect(
      replacementText(
        makeGroup({
          replacementMode: ReplacementMode.Placeholder,
          replacementValue: "[TELEFONO 01]",
        }),
      ),
    ).toBe("Etiquetar · [TELEFONO 01]");
  });

  it("ocultar parcialmente: el modo y la máscara", () => {
    expect(
      replacementText(
        makeGroup({ replacementMode: ReplacementMode.Mask, replacementValue: "XX-XXXXXX" }),
      ),
    ).toBe("Ocultar parcialmente · XX-XXXXXX");
  });

  it("tapar con negro no tiene texto que agregar", () => {
    expect(
      replacementText(makeGroup({ replacementMode: ReplacementMode.Redact, replacementValue: "" })),
    ).toBe("Tapar con negro");
  });

  it("dato falso: el modo y el valor inventado", () => {
    expect(
      replacementText(
        makeGroup({ replacementMode: ReplacementMode.Synthetic, replacementValue: "Pablo Roman" }),
      ),
    ).toBe("Reemplazar por dato falso · Pablo Roman");
  });

  it("una entidad desactivada dice que queda a la vista", () => {
    expect(replacementText(makeGroup({ enabled: false }))).toBe("Desactivada: queda a la vista");
    expect(TOOLTIP_DISABLED_REPLACEMENT).toBe("Desactivada: queda a la vista");
  });
});

describe("buildEntityTooltip", () => {
  it("formato del usuario: tipo, número, valor, reemplazo, apariciones y «Formato»", () => {
    const content = buildEntityTooltip(
      makeGroup({
        type: EntityType.Custom,
        canonicalValue: "0170099420000001234567",
        indexInType: 1,
        replacementMode: ReplacementMode.Redact,
        replacementValue: "",
        members: [member({ occurrenceId: "a" }), member({ occurrenceId: "b" })],
        formatId: cbuFormat.id,
      }),
      [],
      detection,
    );
    expect(content).toMatchObject({
      number: "N.º 01",
      value: "0170099420000001234567",
      replacement: "Tapar con negro",
      appearances: 2,
      format: "CBU · tuyo",
    });
  });

  it("un tipo propio se nombra como lo escribió el usuario", () => {
    const content = buildEntityTooltip(
      makeGroup({
        type: hcType.id,
        canonicalValue: "HC-482193",
        replacementMode: ReplacementMode.Mask,
        replacementValue: "XX-XXXXXX",
        formatId: hcFormat.id,
      }),
      [hcType],
      detection,
    );
    expect(content.typeName).toBe("Historia clínica");
    expect(content.replacement).toBe("Ocultar parcialmente · XX-XXXXXX");
    expect(content.format).toBe("HC con prefijo · tuyo");
  });

  it("el formato del catálogo no se nombra (ADR-226 §4)", () => {
    const content = buildEntityTooltip(
      makeGroup({ type: EntityType.Phone, formatId: "phone-ar" }),
      [],
      detection,
    );
    expect(content.format).toBeNull();
  });

  it("sin formato (el modelo, un agregado a mano) no hay renglón «Formato»", () => {
    expect(buildEntityTooltip(makeGroup(), [], detection).format).toBeNull();
  });

  it("sin la configuración de detección tampoco", () => {
    expect(buildEntityTooltip(makeGroup({ formatId: cbuFormat.id })).format).toBeNull();
  });

  it("los rótulos de las filas", () => {
    expect(TOOLTIP_ROW_LABEL).toEqual({
      replacement: "Reemplazo",
      appearances: "Apariciones",
      format: "Formato",
    });
  });
});
