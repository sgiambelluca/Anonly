/**
 * Los textos y las cuentas de los tipos del documento (`Components.md` §13b.6,
 * `UX_Guidelines.md` §11b.10, §11b.15).
 */

import { DetectionSource, EntityType } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  CHANGE_TYPE_FIRST_HINT,
  createdTypeToast,
  EMPTY_TYPE_ACTION,
  EMPTY_TYPE_TEXT,
  FREED_ENTITIES_LEAD,
  FREED_ENTITIES_WARNING,
  occurrencesLabel,
  removedTypeToast,
  removeTypeConfirmLabel,
  removeTypeTitle,
  savedTypeToast,
  unresolvedConflictCount,
  unresolvedConflictsWarning,
  updatedTypeToast,
} from "../components/entities/documentTypeCopy.js";

import { userType } from "./helpers/detectionFixtures.js";
import { makeConflict, makeGroup } from "./helpers/groupFixtures.js";

const afiliado = userType(0, "Número de afiliado");

describe("textos de la confirmación de borrar (UX_Guidelines.md §11b.10)", () => {
  it("avisa que las entidades quedan libres y descubiertas, con las palabras del mantenedor", () => {
    expect(FREED_ENTITIES_LEAD).toBe("Sus entidades quedan libres y descubiertas.");
    expect(FREED_ENTITIES_WARNING).toBe(
      "Sus entidades quedan libres y descubiertas. Dejan de tener tipo y de ocultarse: se van a ver tal cual en el documento y en la copia que exportes.",
    );
    expect(CHANGE_TYPE_FIRST_HINT).toContain("cambiales el tipo antes");
  });

  it("el título nombra el tipo", () => {
    expect(removeTypeTitle("Legajo")).toBe("¿Borrar el tipo «Legajo»?");
  });

  it("el botón nombra lo que se borra: vacío, una entidad o varias", () => {
    expect(removeTypeConfirmLabel(0)).toBe("Borrar tipo");
    expect(removeTypeConfirmLabel(1)).toBe("Borrar tipo y entidad");
    expect(removeTypeConfirmLabel(3)).toBe("Borrar tipo y entidades");
  });

  it("el aviso de choques usa singular y plural, y recomienda resolverlos antes", () => {
    expect(unresolvedConflictsWarning(1)).toBe(
      "Hay 1 choque sin resolver con entidades de este tipo. Si borrás el tipo, esas entidades también se borran y sus choques se descartan: queda lo que se detectó. Conviene resolver los choques antes de borrar.",
    );
    expect(unresolvedConflictsWarning(3)).toContain("Hay 3 choques sin resolver");
  });

  it("las apariciones de la lista", () => {
    expect(occurrencesLabel(1)).toBe("1 aparición");
    expect(occurrencesLabel(4)).toBe("4 apariciones");
  });
});

describe("unresolvedConflictCount", () => {
  const own = makeGroup({ id: "own", type: afiliado.id });
  const other = makeGroup({ id: "other", type: EntityType.Person });

  it("cuenta los conflictos sin resolver de los grupos del tipo", () => {
    const conflicts = [
      makeConflict({ id: "c1", groupId: "own" }),
      makeConflict({ id: "c2", groupId: "own" }),
      makeConflict({ id: "c3", groupId: "other" }),
    ];
    expect(unresolvedConflictCount(conflicts, [own], afiliado.id)).toBe(2);
  });

  it("no cuenta los resueltos", () => {
    const conflicts = [makeConflict({ id: "c1", groupId: "own", resolved: true })];
    expect(unresolvedConflictCount(conflicts, [own], afiliado.id)).toBe(0);
  });

  it("cuenta un agregado a mano retenido con un candidato del tipo, aunque su grupo sea de otro tipo", () => {
    const held = makeConflict({
      id: "held",
      groupId: "other",
      heldManual: true,
      candidates: [
        {
          source: DetectionSource.Manual,
          entityType: afiliado.id,
          confidence: 1,
          value: "20123456",
        },
        {
          source: DetectionSource.Regex,
          entityType: EntityType.DNI,
          confidence: 1,
          value: "20123456",
        },
      ],
    });
    expect(unresolvedConflictCount([held], [own], afiliado.id)).toBe(1);
    // Sin `heldManual` el candidato no cuenta: solo cuentan los conflictos de sus grupos.
    const { heldManual: _heldManual, ...plain } = held;
    expect(unresolvedConflictCount([plain], [own], afiliado.id)).toBe(0);
  });

  it("un conflicto que cumple las dos condiciones se cuenta una sola vez", () => {
    const both = makeConflict({
      id: "both",
      groupId: "own",
      heldManual: true,
      candidates: [
        { source: DetectionSource.Manual, entityType: afiliado.id, confidence: 1, value: "x" },
      ],
    });
    expect(unresolvedConflictCount([both], [own], afiliado.id)).toBe(1);
  });

  it("sin conflictos, cero", () => {
    expect(unresolvedConflictCount([], [own, other], afiliado.id)).toBe(0);
  });
});

describe("avisos de las acciones y estado vacío", () => {
  it("nombran el tipo", () => {
    expect(createdTypeToast("Legajo")).toBe("Creaste el tipo «Legajo»");
    expect(updatedTypeToast("Legajo")).toBe("Cambiaste el tipo «Legajo»");
    expect(removedTypeToast("Legajo")).toBe("Borraste el tipo «Legajo»");
    expect(savedTypeToast("Legajo")).toBe("«Legajo» se guardó para los próximos documentos");
  });

  it("el estado vacío dice lo de UX_Guidelines.md §11b.15", () => {
    expect(EMPTY_TYPE_TEXT).toBe(
      "Todavía no tiene entidades. Seleccioná el texto en el PDF o agregalo desde acá.",
    );
    expect(EMPTY_TYPE_ACTION).toBe("Agregar entidad");
  });
});
