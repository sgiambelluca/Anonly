import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { buildTreeItemAriaLabel, isRowDimmed } from "../components/entities/needsReviewRow.js";

function makeGroup(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "group-1",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSONA 01]",
    indexInType: 1,
    enabled: true,
    aliases: ["Juan Pérez"],
    replacementValueUserSet: false,
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// `apps/react-client` corre sus tests en Node sin jsdom (`vitest.config.ts`
// raíz), así que `NeedsReviewBadge` — que sí necesita render — no se prueba
// acá. Lo que se prueba es la lógica pura que extrae `EntityGroupItem`:
// `ui/Components.md` §3.4d, mismo patrón que `personGenderVisibility.ts` y
// `entityTree.ts`.

describe("isRowDimmed", () => {
  it("no atenúa un grupo habilitado", () => {
    expect(isRowDimmed(makeGroup({ enabled: true, needsReview: false }))).toBe(false);
  });

  // La regla central de ADR-094 §4: una sugerencia pendiente (deshabilitada
  // por diseño) no se ve como una que el usuario ya descartó.
  it("no atenúa una sugerencia pendiente (!enabled && needsReview)", () => {
    expect(isRowDimmed(makeGroup({ enabled: false, needsReview: true }))).toBe(false);
  });

  it("atenúa un grupo deshabilitado que no es una sugerencia (!enabled && !needsReview)", () => {
    expect(isRowDimmed(makeGroup({ enabled: false, needsReview: false }))).toBe(true);
  });

  it("no atenúa un grupo habilitado aunque needsReview sea true (caso imposible en la práctica, pero la función no debe fallar)", () => {
    expect(isRowDimmed(makeGroup({ enabled: true, needsReview: true }))).toBe(false);
  });
});

describe("buildTreeItemAriaLabel", () => {
  it("arma la enumeración habitual sin needsReview", () => {
    expect(buildTreeItemAriaLabel(makeGroup({ canonicalValue: "Juan Pérez", enabled: true }))).toBe(
      "Juan Pérez, 0 ocurrencias, habilitado",
    );
  });

  it("suma ', a revisar' cuando needsReview es true", () => {
    expect(
      buildTreeItemAriaLabel(
        makeGroup({ canonicalValue: "Juan Pérez", enabled: false, needsReview: true }),
      ),
    ).toBe("Juan Pérez, 0 ocurrencias, deshabilitado, a revisar");
  });

  it("no agrega el sufijo cuando needsReview es false", () => {
    expect(
      buildTreeItemAriaLabel(
        makeGroup({ canonicalValue: "María Gómez", enabled: false, needsReview: false }),
      ),
    ).toBe("María Gómez, 0 ocurrencias, deshabilitado");
  });
});
