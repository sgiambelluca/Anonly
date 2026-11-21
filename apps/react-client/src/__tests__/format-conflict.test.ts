/**
 * El panel de conflicto entre dos formatos (ADR-222, ADR-229 §6,
 * `Components.md` §13b.8) y el tooltip del ícono gris de un conflicto resuelto
 * por defecto. Los textos salen de `Conflicto.dc.html`.
 */
import {
  ConflictReason,
  DetectionSource,
  EntityType,
  getCatalog,
  type ConflictCandidate,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  FORMAT_CONFLICT_LONGEST_WINS,
  FORMAT_CONFLICT_TITLE,
  FORMAT_CONFLICT_USER_WINS,
  FORMAT_ORIGIN_LABEL,
  formatConflictOptions,
  formatConflictResolvedNote,
  formatConflictWinner,
  isFormatConflict,
  resolvedByDefaultTooltip,
} from "../components/conflicts/formatConflict.js";
import { formatNameOf, referenceFormat } from "../components/entities/formatNames.js";

import { stateWith, userFormat, userType } from "./helpers/detectionFixtures.js";
import { makeConflict } from "./helpers/groupFixtures.js";

const catalogCuit = getCatalog("AR").find((info) => info.entityType === EntityType.CUIT);
if (catalogCuit === undefined) throw new Error("el catálogo de AR no trae un formato de CUIT");

const ownType = userType(1, "Número de cliente");
const cliente = userFormat(1, "Cliente", ownType.id);
const detection = stateWith({ userTypes: [ownType], userFormats: [cliente] });

function candidate(overrides: Partial<ConflictCandidate>): ConflictCandidate {
  return {
    source: DetectionSource.Regex,
    entityType: EntityType.CUIT,
    confidence: 1,
    value: "20-12345678-9",
    ...overrides,
  };
}

/** Lo que `Conflicto.dc.html` pone de ejemplo: un formato del usuario contra el del catálogo. */
const userVsCatalog = makeConflict({
  reason: ConflictReason.Overlap,
  resolved: true,
  resolvedType: ownType.id,
  candidates: [
    candidate({ entityType: ownType.id, formatId: cliente.id }),
    candidate({ entityType: EntityType.CUIT, formatId: catalogCuit.id }),
  ],
});

describe("referenceFormat / formatNameOf", () => {
  it("un formato propio sale de userFormats y es del usuario", () => {
    expect(referenceFormat(detection, cliente.id)).toEqual({ name: "Cliente", origin: "user" });
  });

  it("un formato base sale del catálogo del país y no es del usuario", () => {
    expect(referenceFormat(detection, catalogCuit.id)).toEqual({
      name: catalogCuit.name,
      origin: "catalog",
    });
  });

  it("también se encuentra por el id de su definición equivalente", () => {
    const definitionId = getCatalog("AR").find((info) => info.definition !== undefined)?.definition
      ?.id;
    if (definitionId === undefined) return;
    expect(formatNameOf(detection, definitionId)).toBeDefined();
  });

  it("un formato desconocido se nombra por su id: no se inventa un nombre", () => {
    expect(formatNameOf(detection, "fmt:borrado")).toBeUndefined();
    expect(referenceFormat(detection, "fmt:borrado").name).toBe("fmt:borrado");
  });
});

describe("isFormatConflict", () => {
  it("dos candidatos de un formato, con superposición", () => {
    expect(isFormatConflict(userVsCatalog)).toBe(true);
  });

  it("un formato contra el modelo (un solo candidato con formato) no lo es", () => {
    const conflict = makeConflict({
      reason: ConflictReason.Overlap,
      candidates: [
        candidate({ formatId: catalogCuit.id }),
        candidate({ source: DetectionSource.NER, entityType: EntityType.Person, confidence: 0.9 }),
      ],
    });
    expect(isFormatConflict(conflict)).toBe(false);
  });

  it("otras razones de conflicto tampoco", () => {
    expect(isFormatConflict(makeConflict({ reason: ConflictReason.Disagree }))).toBe(false);
  });
});

describe("formatConflictOptions", () => {
  it("cada opción nombra su tipo, su formato y de dónde sale", () => {
    expect(formatConflictOptions(userVsCatalog, detection)).toEqual([
      { type: ownType.id, format: { name: "Cliente", origin: "user" } },
      { type: EntityType.CUIT, format: { name: catalogCuit.name, origin: "catalog" } },
    ]);
  });

  it("el candidato que no salió de un formato queda sin formato", () => {
    const conflict = makeConflict({
      reason: ConflictReason.Overlap,
      candidates: [
        candidate({ entityType: ownType.id, formatId: cliente.id }),
        candidate({ formatId: catalogCuit.id }),
        candidate({ source: DetectionSource.NER, entityType: EntityType.Person, confidence: 0.5 }),
      ],
    });
    const person = formatConflictOptions(conflict, detection).find(
      (option) => option.type === EntityType.Person,
    );
    expect(person?.format).toBeNull();
  });

  it("los textos fijos son los del lienzo", () => {
    expect(FORMAT_CONFLICT_TITLE).toBe("Dos formatos reconocen el mismo texto");
    expect(FORMAT_ORIGIN_LABEL).toEqual({ user: "tuyo", catalog: "del catálogo" });
  });
});

describe("formatConflictWinner (ADR-222 §3)", () => {
  it("el formato del usuario gana sobre el del catálogo", () => {
    expect(formatConflictWinner(userVsCatalog, detection)?.entityType).toBe(ownType.id);
  });

  it("con el mismo origen gana el de valor más largo", () => {
    const other = userFormat(2, "Otro", EntityType.Phone);
    const state = stateWith({ userTypes: [ownType], userFormats: [cliente, other] });
    const conflict = makeConflict({
      reason: ConflictReason.Overlap,
      candidates: [
        candidate({ entityType: ownType.id, formatId: cliente.id, value: "12345" }),
        candidate({ entityType: EntityType.Phone, formatId: other.id, value: "12345678" }),
      ],
    });
    expect(formatConflictWinner(conflict, state)?.entityType).toBe(EntityType.Phone);
  });

  it("con el mismo largo gana el que ya estaba (el primero)", () => {
    const other = userFormat(2, "Otro", EntityType.Phone);
    const state = stateWith({ userTypes: [ownType], userFormats: [cliente, other] });
    const conflict = makeConflict({
      reason: ConflictReason.Overlap,
      candidates: [
        candidate({ entityType: ownType.id, formatId: cliente.id, value: "12345" }),
        candidate({ entityType: EntityType.Phone, formatId: other.id, value: "54321" }),
      ],
    });
    expect(formatConflictWinner(conflict, state)?.entityType).toBe(ownType.id);
  });

  it("sin candidatos de un formato no hay ganador", () => {
    expect(
      formatConflictWinner(makeConflict({ candidates: [candidate({})] }), detection),
    ).toBeUndefined();
  });
});

describe("formatConflictResolvedNote", () => {
  it("tu formato gana sobre el del catálogo: el texto de Conflicto.dc.html", () => {
    expect(formatConflictResolvedNote(userVsCatalog, detection)).toBe(FORMAT_CONFLICT_USER_WINS);
    expect(FORMAT_CONFLICT_USER_WINS).toBe(
      "Se resolvió solo: tu formato gana sobre el del catálogo. No frena la exportación; cambialo si corresponde.",
    );
  });

  it("entre dos formatos del mismo origen dice que gana el más largo", () => {
    const other = userFormat(2, "Otro", EntityType.Phone);
    const state = stateWith({ userTypes: [ownType], userFormats: [cliente, other] });
    const conflict = makeConflict({
      reason: ConflictReason.Overlap,
      resolved: true,
      resolvedType: EntityType.Phone,
      candidates: [
        candidate({ entityType: ownType.id, formatId: cliente.id, value: "12345" }),
        candidate({ entityType: EntityType.Phone, formatId: other.id, value: "12345678" }),
      ],
    });
    expect(formatConflictResolvedNote(conflict, state)).toBe(FORMAT_CONFLICT_LONGEST_WINS);
  });

  it("si el usuario lo resolvió al otro tipo, ya no vale: aplica «Ya revisado»", () => {
    expect(
      formatConflictResolvedNote({ ...userVsCatalog, resolvedType: EntityType.CUIT }, detection),
    ).toBeNull();
  });

  it("un conflicto sin resolver, o que no es entre formatos, no lo lleva", () => {
    expect(formatConflictResolvedNote({ ...userVsCatalog, resolved: false }, detection)).toBeNull();
    expect(formatConflictResolvedNote(makeConflict({ resolved: true }), detection)).toBeNull();
  });

  it("sin resolvedType se toma como resuelto por defecto", () => {
    const withoutType = makeConflict({
      reason: ConflictReason.Overlap,
      resolved: true,
      candidates: userVsCatalog.candidates,
    });
    expect(formatConflictResolvedNote(withoutType, detection)).toBe(FORMAT_CONFLICT_USER_WINS);
  });
});

describe("resolvedByDefaultTooltip (el ícono gris)", () => {
  it("nombra el formato del usuario que ganó", () => {
    expect(resolvedByDefaultTooltip(userVsCatalog, detection)).toEqual({
      title: "Conflicto resuelto por defecto:",
      text: "ganó tu formato «Cliente». Clic para revisar.",
    });
  });

  it("si el usuario ya lo cambió, no dice «por defecto»", () => {
    expect(
      resolvedByDefaultTooltip({ ...userVsCatalog, resolvedType: EntityType.CUIT }, detection),
    ).toBeNull();
  });

  it("si ganó un formato del catálogo no inventa un «tuyo»", () => {
    const conflict = makeConflict({
      reason: ConflictReason.Overlap,
      resolved: true,
      resolvedType: EntityType.CUIT,
      candidates: [
        candidate({ formatId: catalogCuit.id, value: "20-12345678-9" }),
        candidate({ entityType: EntityType.DNI, formatId: "dni-ar", value: "12345678" }),
      ],
    });
    expect(resolvedByDefaultTooltip(conflict, detection)).toBeNull();
  });

  it("un conflicto que no es entre formatos conserva el texto de siempre", () => {
    expect(resolvedByDefaultTooltip(makeConflict({ resolved: true }), detection)).toBeNull();
  });
});
