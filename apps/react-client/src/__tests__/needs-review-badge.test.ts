import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  buildNeedsReviewAriaLabel,
  isNeedsReviewBadgeVisible,
  NEEDS_REVIEW_TOOLTIP,
} from "../components/entities/needsReviewBadgeCopy.js";

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

// `NeedsReviewBadge` (`ui/Components.md` §3.4d) es un componente React y
// `apps/react-client` corre sus tests en Node sin jsdom (`vitest.config.ts`
// raíz) — mismo patrón que `person-gender-visibility.test.ts`: se prueba la
// lógica pura que decide qué renderiza, no el render en sí.

describe("isNeedsReviewBadgeVisible", () => {
  it("no renderiza la marca cuando needsReview es false", () => {
    expect(isNeedsReviewBadgeVisible(makeGroup({ needsReview: false }))).toBe(false);
  });

  it("renderiza la marca cuando needsReview es true", () => {
    expect(isNeedsReviewBadgeVisible(makeGroup({ needsReview: true }))).toBe(true);
  });
});

describe("buildNeedsReviewAriaLabel", () => {
  it("incluye el canonicalValue del grupo", () => {
    const group = makeGroup({ canonicalValue: "Juan Pérez", needsReview: true });
    expect(buildNeedsReviewAriaLabel(group.canonicalValue)).toContain("Juan Pérez");
  });

  // La regla que más fácil se rompe (ADR-094 §4): ni el aria-label ni el
  // tooltip pueden mostrar la confianza como número — el usuario no tiene
  // que ver "0,59", tiene que saber que la fila merece una mirada.
  it("el copy visible (tooltip + aria-label) no contiene ningún dígito", () => {
    const group = makeGroup({ canonicalValue: "Juan Pérez", needsReview: true });
    const ariaLabel = buildNeedsReviewAriaLabel(group.canonicalValue);

    expect(NEEDS_REVIEW_TOOLTIP).not.toMatch(/\d/);
    expect(ariaLabel).not.toMatch(/\d/);
  });

  it("no contiene dígitos aunque el canonicalValue sí los tenga (no debería, pero el copy alrededor tampoco debe)", () => {
    // El canonicalValue de un grupo Person no lleva dígitos en la práctica,
    // pero la aserción real es sobre el resto de la frase, no sobre el
    // valor del usuario — por eso se separa de la anterior.
    const ariaLabel = buildNeedsReviewAriaLabel("María Gómez");
    expect(ariaLabel).toBe(
      "Revisar María Gómez: el detector no está seguro de que sea un dato personal",
    );
  });
});
