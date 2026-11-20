/**
 * Caso 50 de Regex_Engine.md §13 (ADR-220 §4), parte de la línea de base de
 * calidad: las definiciones de los formatos `structure` del catálogo dan los
 * mismos tramos que su `RegExp` sobre todas las páginas de
 * `buildReferenceDocSpecs()`.
 *
 * Se compara lo que emite `process` con el formato base solo contra lo que
 * emite con su copia sola, así los dos lados pasan por la guarda de corrida y
 * el recorte. El test del paquete (`unit.test.ts`) cubre el corpus de §13 y las
 * diferencias de borde conocidas; este va aparte porque un paquete no importa
 * de `tests/`.
 */
import { BASE_CATALOG, RegexEngine } from "@anonly/regex-engine";
import {
  EngineEvents,
  type Document,
  type EngineContext,
  type EntityFound,
  type Page,
} from "@anonly/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createEngineContext,
  createMockConfig,
} from "../../packages/anonymization-core/test-utils/src/index.js";
import { buildReferenceDocSpecs } from "../fixtures/generate.js";

/** Un id válido para `validateFormat` (`fmt:` + UUID v4) para la copia del formato base. */
const COPY_ID = "fmt:00000000-0000-4000-8000-000000000001";

function buildPage(index: number, text: string): Page {
  const words = text.split(" ").map((token, i) => ({
    text: token,
    bbox: { x: i * 40, y: 10, width: Math.max(token.length * 6, 1), height: 12 },
    pageIndex: index,
    confidence: 1,
    source: "pdf" as const,
  }));
  return {
    index,
    width: 595,
    height: 842,
    words,
    text: words.map((w) => w.text).join(" "),
    requiresOCR: false,
    ocrCompleted: false,
  };
}

function buildDocument(pages: ReadonlyArray<Page>): Document {
  return {
    id: "doc-structure-equivalence",
    name: "structure-equivalence.pdf",
    pageCount: pages.length,
    pages,
    metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
    sourceKind: "text",
    importedAt: 0,
  };
}

describe("regex structure formats on the quality reference pages", () => {
  const structureFormats = BASE_CATALOG.filter(({ info }) => info.kind === "structure");
  const allBaseIds = BASE_CATALOG.map(({ info }) => info.id);
  const pages = buildReferenceDocSpecs().flatMap((spec) => spec.pages.map((page) => page.text));
  const document = buildDocument(pages.map((text, index) => buildPage(index, text)));

  /** Lo que emite `process` sobre todas las páginas, con el formato base solo o con su copia sola. */
  async function emit(
    formatId: string,
    side: "base" | "copy",
  ): Promise<ReadonlyArray<ReadonlyArray<unknown>>> {
    const definition = structureFormats.find(({ info }) => info.id === formatId)?.info.definition;
    if (definition === undefined) throw new Error(`sin definición: ${formatId}`);
    const detection =
      side === "base"
        ? {
            country: "AR" as const,
            baseFormats: allBaseIds
              .filter((id) => id !== formatId)
              .map((id) => ({ formatId: id, enabled: false })),
            userTypes: [],
            userFormats: [],
            catalogRefs: [],
          }
        : {
            country: "AR" as const,
            baseFormats: allBaseIds.map((id) => ({ formatId: id, enabled: false })),
            userTypes: [],
            userFormats: [{ ...definition, id: COPY_ID, basedOn: formatId, enabled: true }],
            catalogRefs: [],
          };
    const ctx: EngineContext = createEngineContext({ config: createMockConfig({ detection }) });
    const engine = new RegexEngine();
    await engine.init(ctx);
    const emitSpy = vi.spyOn(ctx.bus, "emit");
    await engine.process({ document }, ctx);
    await engine.dispose();
    return emitSpy.mock.calls
      .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
      .map(([, , payload]) => (payload as EntityFound).occurrence)
      .map((o) => [o.pageIndex, o.value, o.entityType, o.wordSpan, o.bbox]);
  }

  it("structure definitions match their RegExp on the quality reference pages", async () => {
    expect(pages.length).toBeGreaterThan(0);
    expect(structureFormats.map(({ info }) => info.id)).toEqual([
      "dni-ar",
      "phone-landline-ar",
      "plate-vieja-ar",
      "plate-mercosur-ar",
      "plate-mercosur-moto-ar",
    ]);

    let compared = 0;
    for (const { info } of structureFormats) {
      const fromBase = await emit(info.id, "base");
      const fromCopy = await emit(info.id, "copy");
      expect(fromCopy, info.id).toEqual(fromBase);
      compared += fromBase.length;
    }
    // Las páginas de referencia ejercitan de verdad a los formatos.
    expect(compared).toBeGreaterThan(0);
  });
});
