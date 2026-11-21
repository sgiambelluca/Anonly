/**
 * El árbol del panel con tipos propios y formatos (F7, tanda 3): el orden de los
 * tipos, el tipo del documento vacío (`React_Client.md` §3.9, `Components.md`
 * §13b.6) y el subnivel por formato del usuario (ADR-226 §2).
 */

import { EntityType } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  levelsInOrder,
  splitByFormat,
  summarizeEntities,
  visibleTypeEntries,
} from "../components/entities/entityTree.js";

import { userType } from "./helpers/detectionFixtures.js";
import { groupsMap, makeGroup } from "./helpers/groupFixtures.js";

const historia = userType(0, "Historia clínica");
const afiliado = userType(1, "Número de afiliado");

describe("visibleTypeEntries con tipos propios", () => {
  it("los tipos propios van primero y los del catálogo después", () => {
    const map = groupsMap(
      makeGroup({ id: "p1", type: EntityType.Person }),
      makeGroup({ id: "h1", type: historia.id }),
    );
    const entries = visibleTypeEntries(map, "appearance", { userTypeOrder: [historia.id] });
    expect(entries.map(([type]) => type)).toEqual([historia.id, EntityType.Person]);
  });

  it("respeta el orden de los propios (guardados y del documento) que le pasan", () => {
    const map = groupsMap(
      makeGroup({ id: "a1", type: afiliado.id }),
      makeGroup({ id: "h1", type: historia.id }),
    );
    const entries = visibleTypeEntries(map, "appearance", {
      userTypeOrder: [historia.id, afiliado.id],
    });
    expect(entries.map(([type]) => type)).toEqual([historia.id, afiliado.id]);
  });

  it("un tipo del documento sin grupos se muestra (alwaysShow); uno guardado sin grupos, no", () => {
    const map = groupsMap(makeGroup({ id: "p1", type: EntityType.Person }));
    const entries = visibleTypeEntries(map, "appearance", {
      userTypeOrder: [historia.id, afiliado.id],
      alwaysShow: new Set([afiliado.id]),
    });
    expect(entries.map(([type]) => type)).toEqual([afiliado.id, EntityType.Person]);
    expect(entries[0]?.[1]).toEqual([]);
  });

  it("un grupo de un tipo propio que la interfaz no conoce se muestra igual, al final de los propios", () => {
    const map = groupsMap(
      makeGroup({ id: "h1", type: historia.id }),
      makeGroup({ id: "a1", type: afiliado.id }),
      makeGroup({ id: "p1", type: EntityType.Person }),
    );
    const entries = visibleTypeEntries(map, "appearance", { userTypeOrder: [afiliado.id] });
    expect(entries.map(([type]) => type)).toEqual([afiliado.id, historia.id, EntityType.Person]);
  });

  it("sin opciones se comporta como antes: los tipos del catálogo con grupos", () => {
    const map = groupsMap(makeGroup({ id: "p1", type: EntityType.Person }));
    map.get(EntityType.Person);
    expect(visibleTypeEntries(map).map(([type]) => type)).toEqual([EntityType.Person]);
  });

  it("ordena las filas dentro de cada tipo propio", () => {
    const map = groupsMap(
      makeGroup({ id: "h2", type: historia.id, indexInType: 2, canonicalValue: "B" }),
      makeGroup({ id: "h1", type: historia.id, indexInType: 1, canonicalValue: "C" }),
    );
    const [entry] = visibleTypeEntries(map, "appearance", { userTypeOrder: [historia.id] });
    expect(entry?.[1].map((group) => group.id)).toEqual(["h1", "h2"]);
  });
});

describe("summarizeEntities", () => {
  it("un tipo del documento sin entidades no cuenta como tipo con entidades", () => {
    const entries = [
      [afiliado.id, []] as const,
      [EntityType.Person, [makeGroup({ id: "p1" }), makeGroup({ id: "p2" })]] as const,
    ];
    expect(summarizeEntities(entries)).toBe("2 entidades en 1 tipo");
  });
});

describe("splitByFormat (ADR-226 §2)", () => {
  const userFormats = new Set(["fmt:mio", "fmt:otro"]);
  const isUser = (formatId: string): boolean => userFormats.has(formatId);

  it("sin ningún formato del usuario no hay subnivel", () => {
    const groups = [makeGroup({ id: "g1" }), makeGroup({ id: "g2", formatId: "fmt:base:dni-ar" })];
    expect(splitByFormat(groups, isUser)).toEqual({ direct: groups, subgroups: [] });
  });

  it("un tipo cuyo contenido sale todo de un único formato del usuario no muestra el subnivel", () => {
    const groups = [
      makeGroup({ id: "g1", formatId: "fmt:mio" }),
      makeGroup({ id: "g2", formatId: "fmt:mio" }),
    ];
    expect(splitByFormat(groups, isUser)).toEqual({ direct: groups, subgroups: [] });
  });

  it("Teléfono: uno del catálogo, uno a mano y uno de tu formato → subnivel solo para el tuyo", () => {
    const catalog = makeGroup({ id: "g1", formatId: "fmt:base:phone-ar" });
    const manual = makeGroup({ id: "g2" });
    const mine = makeGroup({ id: "g3", formatId: "fmt:mio" });
    const levels = splitByFormat([catalog, manual, mine], isUser);
    expect(levels.direct).toEqual([catalog, manual]);
    expect(levels.subgroups).toEqual([{ formatId: "fmt:mio", groups: [mine] }]);
  });

  it("dos formatos del usuario → un subnivel por formato, en el orden de su primer grupo", () => {
    const a = makeGroup({ id: "g1", formatId: "fmt:otro" });
    const b = makeGroup({ id: "g2", formatId: "fmt:mio" });
    const c = makeGroup({ id: "g3", formatId: "fmt:otro" });
    const levels = splitByFormat([a, b, c], isUser);
    expect(levels.direct).toEqual([]);
    expect(levels.subgroups.map((subgroup) => subgroup.formatId)).toEqual(["fmt:otro", "fmt:mio"]);
    expect(levels.subgroups[0]?.groups).toEqual([a, c]);
  });

  it("levelsInOrder devuelve los directos primero y después cada subnivel", () => {
    const direct = makeGroup({ id: "g1" });
    const a = makeGroup({ id: "g2", formatId: "fmt:mio" });
    const b = makeGroup({ id: "g3", formatId: "fmt:otro" });
    const levels = splitByFormat([a, direct, b], isUser);
    expect(levelsInOrder(levels).map((group) => group.id)).toEqual(["g1", "g2", "g3"]);
  });
});
