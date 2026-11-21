/**
 * Los filtros del panel (`React_Client.md` §3.10, ADR-224 §3, ADR-226 §3,
 * ADR-229 §5): cómo se combinan, qué entra en cada uno y las opciones del popover.
 */

import { DetectionSource, EntityType, ReplacementMode } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  applyEntityFilters,
  describeFilteredCount,
  formatFilterOptions,
  groupIdsWithConflict,
  groupMatchesFilters,
  hasActiveFilters,
  isManualGroup,
  MODE_FILTER_ORDER,
  modeCounts,
  REVIEW_FILTER_OPTIONS,
  toggleInSet,
  typeFilterOptions,
  userFormatNameOf,
} from "../components/entities/entityFilters.js";
import { isUserFormat, DEFAULT_DETECTION_STATE } from "../store/detectionState.js";
import { NO_FILTERS, type EntityFilters } from "../store/entities.store.js";

import { stateWith, userFormat, userType, uuid } from "./helpers/detectionFixtures.js";
import { makeConflict, makeGroup, member } from "./helpers/groupFixtures.js";

function filters(patch: Partial<EntityFilters>): EntityFilters {
  return { ...NO_FILTERS, ...patch };
}

const none: ReadonlySet<string> = new Set();

describe("hasActiveFilters / activeFilterCount", () => {
  it("sin nada elegido no hay filtros", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it("cuenta las opciones marcadas de los tres conjuntos", () => {
    const active = filters({
      formatIds: new Set(["fmt:a"]),
      modes: new Set([ReplacementMode.Mask, ReplacementMode.Redact]),
      review: new Set(["manual"]),
    });
    expect(hasActiveFilters(active)).toBe(true);
    expect(activeFilterCount(active)).toBe(4);
  });
});

describe("«Para revisar»", () => {
  it("«disabled»: solo los desactivados", () => {
    const on = makeGroup({ id: "on" });
    const off = makeGroup({ id: "off", enabled: false });
    const result = applyEntityFilters([on, off], filters({ review: new Set(["disabled"]) }), none);
    expect(result).toEqual([off]);
  });

  it("«conflict»: los que tuvieron un conflicto, resuelto o no", () => {
    const resolved = makeGroup({ id: "a" });
    const open = makeGroup({ id: "b" });
    const clean = makeGroup({ id: "c" });
    const withConflict = groupIdsWithConflict([
      makeConflict({ id: "c1", groupId: "a", resolved: true }),
      makeConflict({ id: "c2", groupId: "b", resolved: false }),
    ]);
    const result = applyEntityFilters(
      [resolved, open, clean],
      filters({ review: new Set(["conflict"]) }),
      withConflict,
    );
    expect(result.map((group) => group.id)).toEqual(["a", "b"]);
  });

  it("«manual»: un miembro agregado a mano o un reemplazo escrito por el usuario", () => {
    const byMember = makeGroup({
      id: "a",
      members: [member({ source: DetectionSource.Manual })],
    });
    const byText = makeGroup({ id: "b", replacementValueUserSet: true });
    const plain = makeGroup({ id: "c" });
    expect(isManualGroup(byMember)).toBe(true);
    expect(isManualGroup(byText)).toBe(true);
    expect(isManualGroup(plain)).toBe(false);
    const result = applyEntityFilters(
      [byMember, byText, plain],
      filters({ review: new Set(["manual"]) }),
      none,
    );
    expect(result.map((group) => group.id)).toEqual(["a", "b"]);
  });

  it("dentro del conjunto alcanza con una opción", () => {
    const off = makeGroup({ id: "off", enabled: false });
    const manual = makeGroup({ id: "manual", replacementValueUserSet: true });
    const other = makeGroup({ id: "other" });
    const result = applyEntityFilters(
      [off, manual, other],
      filters({ review: new Set(["disabled", "manual"]) }),
      none,
    );
    expect(result.map((group) => group.id)).toEqual(["off", "manual"]);
  });
});

describe("combinación entre conjuntos", () => {
  it("entre conjuntos hay que cumplir todos", () => {
    const mask = makeGroup({ id: "a", replacementMode: ReplacementMode.Mask, enabled: false });
    const maskOn = makeGroup({ id: "b", replacementMode: ReplacementMode.Mask });
    const placeholderOff = makeGroup({ id: "c", enabled: false });
    const result = applyEntityFilters(
      [mask, maskOn, placeholderOff],
      filters({ modes: new Set([ReplacementMode.Mask]), review: new Set(["disabled"]) }),
      none,
    );
    expect(result.map((group) => group.id)).toEqual(["a"]);
  });

  it("«Modo de reemplazo»: dentro del conjunto alcanza con uno", () => {
    const mask = makeGroup({ id: "a", replacementMode: ReplacementMode.Mask });
    const redact = makeGroup({ id: "b", replacementMode: ReplacementMode.Redact });
    const placeholder = makeGroup({ id: "c" });
    const result = applyEntityFilters(
      [mask, redact, placeholder],
      filters({ modes: new Set([ReplacementMode.Mask, ReplacementMode.Redact]) }),
      none,
    );
    expect(result.map((group) => group.id)).toEqual(["a", "b"]);
  });

  it("«Tus formatos»: solo los grupos de ese formato; sin formato no entran", () => {
    const mine = makeGroup({ id: "a", formatId: "fmt:a" });
    const other = makeGroup({ id: "b", formatId: "fmt:b" });
    const bare = makeGroup({ id: "c" });
    const result = applyEntityFilters(
      [mine, other, bare],
      filters({ formatIds: new Set(["fmt:a"]) }),
      none,
    );
    expect(result).toEqual([mine]);
    expect(groupMatchesFilters(bare, filters({ formatIds: new Set(["fmt:a"]) }), none)).toBe(false);
  });

  it("sin filtros devuelve los mismos grupos", () => {
    const groups = [makeGroup({ id: "a" })];
    expect(applyEntityFilters(groups, NO_FILTERS, none)).toBe(groups);
  });
});

describe("opciones del popover", () => {
  const mine = userFormat(0, "Celular de Chile");
  const copy = userFormat(1, "DNI editado", undefined, { basedOn: "dni-ar" });
  const state = stateWith({ userFormats: [mine, copy] });

  it("userFormatNameOf nombra los formatos propios y las copias; un formato base no se nombra", () => {
    const nameOf = userFormatNameOf(state);
    expect(nameOf(mine.id)).toBe("Celular de Chile");
    expect(nameOf(copy.id)).toBe("DNI editado");
    expect(nameOf("fmt:base:dni-ar")).toBeUndefined();
  });

  it("userFormatNameOf nombra una referencia a otro catálogo por el nombre del catálogo", () => {
    const withRef = stateWith({
      catalogRefs: [
        { id: `ref:${uuid(2)}`, country: "AR", catalogFormatId: "dni-ar", enabled: true },
      ],
    });
    const nameOf = userFormatNameOf(withRef);
    expect(nameOf(`ref:${uuid(2)}`)).toBeTypeOf("string");
    expect(nameOf(`ref:${uuid(3)}`)).toBeUndefined();
  });

  it("isUserFormat: los propios, las copias y las referencias; los base no", () => {
    const withRef = stateWith({
      userFormats: [mine],
      catalogRefs: [
        { id: `ref:${uuid(2)}`, country: "AR", catalogFormatId: "dni-ar", enabled: true },
      ],
    });
    expect(isUserFormat(withRef, mine.id)).toBe(true);
    expect(isUserFormat(withRef, `ref:${uuid(2)}`)).toBe(true);
    expect(isUserFormat(withRef, "fmt:base:dni-ar")).toBe(false);
    expect(isUserFormat(DEFAULT_DETECTION_STATE, mine.id)).toBe(false);
  });

  it("«Tus formatos» lista solo formatos del usuario que detectaron algo, con su cantidad", () => {
    const groups = [
      makeGroup({ id: "a", formatId: mine.id }),
      makeGroup({ id: "b", formatId: mine.id }),
      makeGroup({ id: "c", formatId: "fmt:base:dni-ar" }),
      makeGroup({ id: "d" }),
    ];
    expect(formatFilterOptions(groups, userFormatNameOf(state))).toEqual([
      { formatId: mine.id, name: "Celular de Chile", count: 2 },
    ]);
  });

  it("un formato que es la única fuente de su tipo no se ofrece: daría lo mismo que «Tipos»", () => {
    // ADR-226 §3, precisión del 2026-11-21: la regla del subnivel del árbol.
    const legajo = userType(7, "legajo");
    const itba = userFormat(8, "legajo itba", legajo.id);
    const withLegajo = stateWith({ userTypes: [legajo], userFormats: [itba] });
    const groups = [
      makeGroup({ id: "a", type: legajo.id, formatId: itba.id }),
      makeGroup({ id: "b", type: EntityType.Person }),
    ];
    expect(formatFilterOptions(groups, userFormatNameOf(withLegajo))).toEqual([]);
  });

  it("dos formatos del usuario en un mismo tipo se ofrecen los dos", () => {
    const legajo = userType(7, "legajo");
    const itba = userFormat(8, "legajo itba", legajo.id);
    const uba = userFormat(9, "legajo uba", legajo.id);
    const withTwo = stateWith({ userTypes: [legajo], userFormats: [itba, uba] });
    const groups = [
      makeGroup({ id: "a", type: legajo.id, formatId: itba.id }),
      makeGroup({ id: "b", type: legajo.id, formatId: uba.id }),
      makeGroup({ id: "c", type: legajo.id, formatId: uba.id }),
    ];
    expect(formatFilterOptions(groups, userFormatNameOf(withTwo))).toEqual([
      { formatId: itba.id, name: "legajo itba", count: 1 },
      { formatId: uba.id, name: "legajo uba", count: 2 },
    ]);
  });

  it("sin ningún formato del usuario en el documento, la sección no tiene opciones", () => {
    const groups = [makeGroup({ id: "a", formatId: "fmt:base:dni-ar" }), makeGroup({ id: "b" })];
    expect(formatFilterOptions(groups, userFormatNameOf(state))).toEqual([]);
  });

  it("modeCounts cuenta los grupos por modo", () => {
    const counts = modeCounts([
      makeGroup({ id: "a" }),
      makeGroup({ id: "b", replacementMode: ReplacementMode.Mask }),
      makeGroup({ id: "c", replacementMode: ReplacementMode.Mask }),
    ]);
    expect(counts).toEqual({
      [ReplacementMode.Placeholder]: 1,
      [ReplacementMode.Mask]: 2,
      [ReplacementMode.Synthetic]: 0,
      [ReplacementMode.Redact]: 0,
    });
    expect(MODE_FILTER_ORDER).toHaveLength(4);
  });

  it("«Para revisar» ofrece las tres opciones, cada una con su línea", () => {
    expect(REVIEW_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      "disabled",
      "conflict",
      "manual",
    ]);
    expect(REVIEW_FILTER_OPTIONS.every((option) => option.description.length > 0)).toBe(true);
  });

  it("toggleInSet agrega y quita sin mutar", () => {
    const base: ReadonlySet<string> = new Set(["a"]);
    const added = toggleInSet(base, "b");
    expect([...added]).toEqual(["a", "b"]);
    expect([...toggleInSet(added, "a")]).toEqual(["b"]);
    expect([...base]).toEqual(["a"]);
  });

  it("el resumen dice cuántas se ven de cuántas", () => {
    expect(describeFilteredCount(2, 10)).toBe("Mostrando 2 de 10");
  });

  it("un tipo propio guardado no altera los nombres de formato", () => {
    expect(
      userFormatNameOf(stateWith({ userTypes: [userType(0, "Legajo")] }))(mine.id),
    ).toBeUndefined();
  });
});

describe("«Tipos» (ADR-229 §5, precisión del 2026-11-21)", () => {
  const dni = makeGroup({ id: "dni", type: EntityType.DNI });
  const person = makeGroup({ id: "person", type: EntityType.Person });

  it("deja solo los grupos de los tipos elegidos, de base o propios", () => {
    const result = applyEntityFilters(
      [dni, person],
      filters({ types: new Set([EntityType.Person]) }),
      none,
    );
    expect(result).toEqual([person]);
  });

  it("se combina con los otros filtros: hay que cumplir todos", () => {
    const off = makeGroup({ id: "off", type: EntityType.Person, enabled: false });
    const result = applyEntityFilters(
      [dni, person, off],
      filters({ types: new Set([EntityType.Person]), review: new Set(["disabled"]) }),
      none,
    );
    expect(result).toEqual([off]);
  });

  it("cuenta en el botón «Filtros»", () => {
    const active = filters({ types: new Set([EntityType.DNI, EntityType.Person]) });
    expect(hasActiveFilters(active)).toBe(true);
    expect(activeFilterCount(active)).toBe(2);
  });

  it("ofrece los tipos con entidades en el orden de la lista, y los elegidos aunque queden vacíos", () => {
    const entries = [
      [EntityType.Person, [person]],
      [EntityType.Address, []],
      [EntityType.DNI, [dni, dni]],
    ] as const;
    expect(typeFilterOptions(entries, new Set())).toEqual([
      { type: EntityType.Person, count: 1 },
      { type: EntityType.DNI, count: 2 },
    ]);
    expect(
      typeFilterOptions(entries, new Set([EntityType.Address, EntityType.Email])).map(
        (option) => option.type,
      ),
    ).toEqual([EntityType.Person, EntityType.Address, EntityType.DNI, EntityType.Email]);
  });
});
