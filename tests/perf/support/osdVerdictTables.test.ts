import { describe, expect, it } from "vitest";

import { summarizeCampaign } from "./osdVerdictCampaign.js";
import { corpusEntries } from "./osdVerdictCorpus.js";
import { formatLeaks, formatSummary, renderTable, resultLine } from "./osdVerdictTables.js";
import { makePdf } from "./osdVerdictTestSupport.js";

const KEYS = ["full-150-0", "two-lines-150-180"];
const entries = corpusEntries().filter((entry) => KEYS.includes(entry.key));

const observations = [
  ...makePdf({
    key: "full-150-0",
    verdict: { orientation: 0, had: true },
    forced: {
      0: { reading: { reliable: 30, confidence: 0.9 }, final: { present: true } },
      90: { final: { unreadable: true } },
      180: { final: { unreadable: true } },
      270: { final: { unreadable: true } },
    },
  }),
  ...makePdf({
    key: "two-lines-150-180",
    verdict: { orientation: 0, had: true },
    forced: {
      0: { reading: { reliable: 1, confidence: 0.7 }, final: { reliable: 1, text: "lit Ee" } },
      90: { final: { unreadable: true } },
      180: { reading: { reliable: 4, confidence: 0.95 }, final: { present: true } },
      270: { final: { present: true } },
    },
  }),
];

describe("osdVerdictTables", () => {
  it("renderTable alinea: la primera columna a la izquierda y el resto a la derecha", () => {
    expect(
      renderTable(
        ["a", "bb"],
        [
          ["xx", "1"],
          ["y", "22"],
        ],
      ),
    ).toBe(["a   bb", "--  --", "xx   1", "y   22"].join("\n"));
  });

  it("el resumen tiene una sección por pregunta y los conteos de la campaña", () => {
    const summary = summarizeCampaign(observations, entries);
    const text = formatSummary(summary);
    for (const heading of [
      "## Campaña",
      "## P1.",
      "## P1 bis.",
      "## P2.",
      "## P3.",
      "## P3 bis.",
      "## P4.",
      "## Controles sin texto",
      "## Evidencia de rama",
    ])
      expect(text).toContain(heading);
    expect(text).toContain("observaciones esperadas 10, completas 10");
    expect(text).toContain("COMPLETA");
    expect(text).toContain("two-lines-150-180: afirmó 0, correcto 180");
    expect(text).toContain("PDF con alguna fuga: 1/2");
    expect(text).toContain("words<10 AND conf<0.7");
    expect(text).toContain("page-confidence-first");
  });

  it("la lista de fugas trae cada observación sin los datos esperados, con lo que leyó", () => {
    const text = formatLeaks(summarizeCampaign(observations, entries));
    expect(text).toContain("two-lines-150-180");
    expect(text).toContain("silent-leak");
    expect(text).toContain('"lit Ee"');
    expect(text).toContain("warned");
    expect(text).not.toContain("recovered");
  });

  it("la lista separa lo forzado a un ángulo equivocado, el control y la producción", () => {
    const text = formatLeaks(summarizeCampaign(observations, entries));
    const blocks = text.split("## ").slice(1);
    expect(blocks.map((block) => block.split("\n")[0])).toEqual([
      "Veredicto forzado a un ángulo equivocado",
      "Veredicto forzado al ángulo correcto (control)",
      "Producción, sin forzar nada",
    ]);
    // El control recupera los datos; la producción armada por la fábrica no (sin datos ni aviso).
    expect(blocks[1]).toContain("Ninguna observación");
    expect(blocks[2]).toContain("full-150-0");
    expect(blocks[2]).toContain("two-lines-150-180");
  });

  it("sin observaciones faltantes de datos, la lista lo dice", () => {
    const only = makePdf({
      key: "full-150-0",
      production: { final: { present: true } },
      forced: {
        0: { final: { present: true } },
        90: { final: { present: true } },
        180: { final: { present: true } },
        270: { final: { present: true } },
      },
    });
    const text = formatLeaks(
      summarizeCampaign(
        only,
        corpusEntries().filter((entry) => entry.key === "full-150-0"),
      ),
    );
    expect(text.match(/Ninguna observación sin los datos esperados\./g)).toHaveLength(3);
    expect(text).toContain("## Producción, sin forzar nada");
  });

  it("la lista acorta una lectura larga y deja la entera en el JSON de la observación", () => {
    const long = Array.from({ length: 60 }, (_, index) => `palabra${index}`).join(" ");
    const pdf = makePdf({
      key: "full-150-0",
      forced: {
        0: { final: { present: true } },
        90: { final: { reliable: 60, text: long } },
        180: { final: { present: true } },
        270: { final: { present: true } },
      },
    });
    const text = formatLeaks(
      summarizeCampaign(
        pdf,
        corpusEntries().filter((entry) => entry.key === "full-150-0"),
      ),
    );
    expect(text).toContain("palabra0 palabra1");
    expect(text).toContain("…");
    expect(text).not.toContain("palabra59");
  });

  it("la línea de resultado dice cuántas observaciones hay, si la campaña está completa y las fugas", () => {
    const summary = summarizeCampaign(observations, entries);
    expect(resultLine(summary)).toBe(
      "M-O1: 10/10 observaciones; completa; veredictos naturales equivocados 1/2; fugas silenciosas 1/6.",
    );
    const partial = summarizeCampaign(observations.slice(0, 7), entries);
    expect(resultLine(partial)).toContain("INCOMPLETA");
  });
});
