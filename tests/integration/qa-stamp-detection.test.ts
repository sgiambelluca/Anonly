/**
 * Integración — las tres fugas de detección de `qa-stamp.pdf`
 * (`roadmap/Post_Hito10.8_Pendientes.md` §23a/§23b/§23c, análisis en
 * `roadmap/Calidad_De_Deteccion_Informe.md`).
 *
 * **Por qué este archivo existe**: el gate manual encontró que el PDF
 * exportado de este fixture sigue conteniendo nombres legibles, y ninguna
 * suite lo veía. Nació reproduciendo las tres fugas antes de tocar ningún
 * motor; §23a y §23b las cerró ADR-088 y acá quedan como no-regresión, §23c
 * sigue abierta y sigue marcada con `it.fails`.
 *
 * **Qué es real acá y qué no**. `pdfjs-dist` va **sin mockear**: el fixture se
 * lee del disco y el `Word[]` con `bbox.rotation` de los runs a 90°/270° lo
 * produce pdf.js de verdad — el resto de los tests del repo mockea
 * `getDocument`, así que ninguno había visto nunca una palabra rotada real.
 * Regex, NER y Grouping son los motores reales. Lo único replayeado es la
 * **inferencia**: `REAL_MODEL_TOKENS_BY_BATCH` son los tokens crudos que
 * devolvió el modelo de producción sobre los textos exactos que el kernel le
 * pasa. O sea que el batching, la agregación BIO, el umbral de confianza, el
 * mapeo span→`Word`, la resolución de conflictos y todo el camino hasta el
 * grupo corren de verdad.
 *
 * **Un `it.fails` es un defecto abierto**: describe lo que el producto promete
 * y hoy no cumple. Pasa mientras el defecto existe y falla el día que se
 * arregla, que es cuando hay que convertirlo en `it` normal — es lo que pasó
 * con §23a y §23b.
 *
 * **La cobertura se mide sobre los grupos, no sobre las ocurrencias emitidas**
 * (ver `isWordCovered`): NER emite `ENTITY_FOUND` también para lo que Grouping
 * después descarta, y lo que se tapa en el export son los miembros de un
 * grupo.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCore, type IAnonymizationCore } from "@anonly/anonymization-core";
import {
  EngineEvents,
  EventChannel,
  type EntityFound,
  type EntityGroup,
  type EntityGroupCreated,
  type EntityGroupUpdated,
  type Occurrence,
  type Word,
} from "@anonly/shared";
import { pipeline } from "@huggingface/transformers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `pdfjs-dist` NO se mockea acá: es el punto del test (ver cabecera).
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowRemoteModels: true, localModelPath: "/models/", backends: { onnx: { wasm: {} } } },
}));

import {
  asPipelineMock,
  installOffscreenCanvasStub,
  mockTokenClassificationPipeline,
  type MockNerToken,
} from "./fixtures/mocks.js";

/**
 * El texto de página que produce `pdf-engine` sobre `qa-stamp.pdf`: cuerpo
 * horizontal primero y los runs rotados después, en dos pasadas separadas
 * (ADR-067 §4). El sello a 90° y el folio a 270° terminan pegados uno al otro
 * en el texto corrido aunque en la página estén en márgenes opuestos.
 *
 * Ya no es lo que se le da al modelo —ADR-088 §1 lo corta en tres batches, uno
 * por orientación— pero sigue siendo `Page.text`, y sigue siendo lo que ven
 * Regex y la lupa. Se afirma acá para que un cambio en la extracción se note
 * en este archivo y no en un replay que dejó de corresponder.
 */
const EXPECTED_PAGE_TEXT =
  "Expediente caratulado: Pérez, Juan c/ Empresa S.A. s/ daños y perjuicios. " +
  "El actor, Juan Pérez, DNI 34.567.891, con domicilio en Belgrano 1234, promueve " +
  "demanda contra Empresa S.A., CUIT 20-12345678-9, con sede en Rivadavia 455. " +
  "Se designa perito a Carlos López, DNI 42.998.103, quien acepta el cargo. " +
  "Notifíquese al correo juan.perez@example.com y al teléfono +54 11 1234-5678. " +
  "FIEL COPIA Folio 214 — Juan Pérez JUZGADO CIVIL 12 — PERITO CARLOS LOPEZ — DNI 42.998.103";

/**
 * Salida cruda del modelo de producción —
 * `Xenova/bert-base-multilingual-cased-ner-hrl`, dtype `q8`, el que
 * `pnpm assets:mirror` deja en `apps/react-client/public/models/ner/` —
 * capturada el 2026-08-22, **una entrada por batch** y con el texto tal como
 * el kernel se lo pasa al modelo: los tres batches de ADR-088 §1 (cuerpo,
 * folio a 270°, sello a 90°) y con las corridas en caja alta ya pasadas a
 * Title Case por ADR-088 §2. Incluye solo los tokens etiquetados, porque
 * `token-classification` filtra los `O` por su cuenta: es literalmente lo que
 * `aggregateTokensToSpans` recibe en producción.
 *
 * Que la clave sea el texto de inferencia es a propósito. Si alguien cambia
 * cómo se corta el batch o cómo se transforma la caja, la clave deja de
 * existir y el mock **falla con un mensaje explícito** en vez de replayear
 * tokens que ya no corresponden.
 *
 * Para regenerarla: correr el pipeline de `@huggingface/transformers` con ese
 * modelo sobre cada una de las tres claves y volcar `{ word, entity, score }`.
 */
const REAL_MODEL_TOKENS_BY_BATCH: ReadonlyMap<string, ReadonlyArray<MockNerToken>> = new Map([
  [
    "Expediente caratulado: Pérez, Juan c/ Empresa S.A. s/ daños y perjuicios. " +
      "El actor, Juan Pérez, DNI 34.567.891, con domicilio en Belgrano 1234, promueve " +
      "demanda contra Empresa S.A., CUIT 20-12345678-9, con sede en Rivadavia 455. " +
      "Se designa perito a Carlos López, DNI 42.998.103, quien acepta el cargo. " +
      "Notifíquese al correo juan.perez@example.com y al teléfono +54 11 1234-5678. Fiel Copia",
    [
      // La carátula: el modelo etiqueta el apellido y el nombre como DOS
      // personas de una palabra, las dos por debajo del confidenceThreshold de
      // 0,7. Es §23c, y sigue abierta.
      { word: "Pérez", entity: "B-PER", score: 0.5924, index: 1 },
      { word: "Juan", entity: "B-PER", score: 0.6991, index: 2 },
      { word: "Em", entity: "B-ORG", score: 0.643, index: 3 },
      { word: "##presa", entity: "I-ORG", score: 0.8137, index: 4 },
      { word: "S", entity: "I-ORG", score: 0.9204, index: 5 },
      { word: ".", entity: "I-ORG", score: 0.596, index: 6 },
      { word: "A", entity: "I-ORG", score: 0.599, index: 7 },
      { word: "Juan", entity: "B-PER", score: 0.9993, index: 8 },
      { word: "Pérez", entity: "I-PER", score: 0.9983, index: 9 },
      { word: "Belgrano", entity: "B-LOC", score: 0.9992, index: 10 },
      { word: "Em", entity: "B-ORG", score: 0.9975, index: 11 },
      { word: "##presa", entity: "I-ORG", score: 0.9979, index: 12 },
      { word: "S", entity: "I-ORG", score: 0.9987, index: 13 },
      { word: ".", entity: "I-ORG", score: 0.9972, index: 14 },
      { word: "A", entity: "I-ORG", score: 0.9975, index: 15 },
      { word: ".", entity: "I-ORG", score: 0.9837, index: 16 },
      { word: "Riva", entity: "B-LOC", score: 0.9993, index: 17 },
      { word: "##da", entity: "I-LOC", score: 0.9993, index: 18 },
      { word: "##via", entity: "I-LOC", score: 0.9995, index: 19 },
      { word: "Carlos", entity: "B-PER", score: 0.9998, index: 20 },
      { word: "López", entity: "I-PER", score: 0.9991, index: 21 },
    ],
  ],
  [
    // El folio, ahora en su propio batch: sin el sello pegado atrás, el modelo
    // devuelve el nombre solo, con 0,9999. Antes de ADR-088 §1 este mismo
    // nombre salía fundido con "JUZGADO CIVIL" en una entidad de media página.
    "Folio 214 — Juan Pérez",
    [
      { word: "Juan", entity: "B-PER", score: 0.9999, index: 1 },
      { word: "Pérez", entity: "I-PER", score: 0.9997, index: 2 },
    ],
  ],
  [
    // El sello, en Title Case. En caja alta el modelo devolvía CERO tokens.
    // El `D`/`##NI` de ORG es el falso positivo que ADR-088 anotó en
    // Consecuencias: batch más corto, menos contexto.
    "Juzgado Civil 12 — Perito Carlos Lopez — DNI 42.998.103",
    [
      { word: "Ju", entity: "B-ORG", score: 0.9998, index: 1 },
      { word: "##z", entity: "I-ORG", score: 0.995, index: 2 },
      { word: "##gado", entity: "I-ORG", score: 0.9987, index: 3 },
      { word: "Civil", entity: "I-ORG", score: 0.9999, index: 4 },
      { word: "Per", entity: "B-PER", score: 0.999, index: 5 },
      { word: "##ito", entity: "I-PER", score: 0.9974, index: 6 },
      { word: "Carlos", entity: "I-PER", score: 0.9994, index: 7 },
      { word: "Lopez", entity: "I-PER", score: 0.9995, index: 8 },
      { word: "D", entity: "B-ORG", score: 0.9996, index: 9 },
      { word: "##NI", entity: "I-ORG", score: 0.9986, index: 10 },
    ],
  ],
]);

interface PipelineRun {
  readonly words: ReadonlyArray<Word>;
  readonly occurrences: ReadonlyArray<Occurrence>;
  readonly groups: ReadonlyArray<EntityGroup>;
}

/** Índice de la palabra que cumple el predicado; -1 si no está. */
function wordIndex(words: ReadonlyArray<Word>, predicate: (word: Word) => boolean): number {
  return words.findIndex(predicate);
}

/**
 * `true` si esa palabra queda cubierta por una ocurrencia **que llegó a un
 * grupo**. La distinción es el punto del archivo: NER emite `ENTITY_FOUND`
 * para todos sus spans, incluidos los que Grouping después descarta por
 * confianza baja o por conflicto de solapamiento. Lo que se tapa en el export
 * son los miembros de un grupo, no las ocurrencias emitidas — medir sobre
 * `run.occurrences` daría por cubierto un dato que sale en claro.
 */
function isWordCovered(run: PipelineRun, index: number): boolean {
  const grouped = new Set<string>();
  for (const group of run.groups) {
    for (const member of group.members) grouped.add(member.occurrenceId);
  }
  return run.occurrences.some(
    (occurrence) =>
      grouped.has(occurrence.id) &&
      occurrence.wordSpan !== undefined &&
      index >= occurrence.wordSpan.startIndex &&
      index < occurrence.wordSpan.endIndexExclusive,
  );
}

describe("integración — fugas de detección de qa-stamp.pdf (§23a/§23b/§23c)", () => {
  let core: IAnonymizationCore;
  let run: PipelineRun;

  beforeEach(async () => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();

    const bytes = await readFile(resolve(__dirname, "../fixtures/qa-stamp.pdf"));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline((text: string) => {
        const tokens = REAL_MODEL_TOKENS_BY_BATCH.get(text);
        if (tokens === undefined) {
          return Promise.reject(
            new Error(
              "Batch inesperado: REAL_MODEL_TOKENS_BY_BATCH no tiene tokens capturados para este " +
                `texto, así que el replay ya no corresponde. Recibido: ${JSON.stringify(text)}`,
            ),
          );
        }
        return Promise.resolve(tokens);
      }),
    );

    core = await createCore();

    const occurrences: Occurrence[] = [];
    // Por id y con el ÚLTIMO estado: un grupo gana miembros por
    // ENTITY_GROUP_UPDATED, así que quedarse con el payload de creación
    // contaría de menos justo en el caso que importa (el folio uniéndose al
    // grupo del cuerpo).
    const groupsById = new Map<string, EntityGroup>();
    const collect = (payload: unknown): void => {
      occurrences.push((payload as EntityFound).occurrence);
    };
    core.bus.on(EventChannel.Regex, EngineEvents.ENTITY_FOUND, collect);
    core.bus.on(EventChannel.Ner, EngineEvents.ENTITY_FOUND, collect);
    core.bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, (payload) => {
      const { group } = payload as EntityGroupCreated;
      groupsById.set(group.id, group);
    });
    core.bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, (payload) => {
      const { group } = payload as EntityGroupUpdated;
      groupsById.set(group.id, group);
    });

    await core.orchestrator.importDocument({
      documentId: "qa-stamp",
      name: "qa-stamp.pdf",
      buffer,
    });

    run = {
      words: core.orchestrator.getPageWords("qa-stamp", 0),
      occurrences,
      groups: [...groupsById.values()],
    };
  }, 60_000);

  afterEach(async () => {
    await core?.dispose();
  });

  // ─── Lo que sí funciona hoy: la no-regresión del fixture ───

  it("extrae el texto de página esperado (el replay depende de esto)", () => {
    expect(run.words.map((word) => word.text).join(" ")).toBe(EXPECTED_PAGE_TEXT);
  });

  it("extrae los runs rotados con su ángulo: el sello a 90° y el folio a 270°", () => {
    const folio = run.words.filter((word) => word.bbox.rotation === 270);
    const sello = run.words.filter((word) => word.bbox.rotation === 90);

    expect(folio.map((word) => word.text)).toEqual(["Folio", "214", "—", "Juan", "Pérez"]);
    expect(sello.map((word) => word.text)).toEqual([
      "JUZGADO",
      "CIVIL",
      "12",
      "—",
      "PERITO",
      "CARLOS",
      "LOPEZ",
      "—",
      "DNI",
      "42.998.103",
    ]);
  });

  it("agrupa el DNI del sello a 90° con el del cuerpo (lo que arregló ADR-063)", () => {
    const dniDelSello = run.occurrences.find(
      (occurrence) => occurrence.value === "42.998.103" && occurrence.bbox.rotation === 90,
    );
    expect(dniDelSello).toBeDefined();
    expect(run.groups.filter((group) => group.canonicalValue === "42.998.103")).toHaveLength(1);
  });

  it("agrupa las personas del cuerpo horizontal", () => {
    const canonicos = run.groups.map((group) => group.canonicalValue);
    expect(canonicos).toContain("Juan Pérez");
    expect(canonicos).toContain("Carlos López");
  });

  // ─── §23c: la carátula ───

  it("estado actual: de la carátula 'Pérez, Juan' no sobrevive ninguna ocurrencia", () => {
    const perezCaratula = wordIndex(run.words, (word) => word.text === "Pérez,");
    const juanCaratula = perezCaratula + 1;

    expect(run.words[perezCaratula]?.text).toBe("Pérez,");
    expect(run.words[juanCaratula]?.text).toBe("Juan");

    // El apellido no lo etiqueta el modelo; el nombre sí, pero con 0,5887 —
    // debajo del `confidenceThreshold` de 0,7, así que Grouping lo manda al
    // camino de baja confianza y no queda grupo.
    expect(isWordCovered(run, perezCaratula)).toBe(false);
    expect(run.groups.some((group) => group.canonicalValue === "Juan")).toBe(false);
  });

  it.fails("§23c: la carátula 'Pérez, Juan' se detecta como persona", () => {
    const perezCaratula = wordIndex(run.words, (word) => word.text === "Pérez,");
    expect(isWordCovered(run, perezCaratula)).toBe(true);
  });

  // ─── §23b: el sello en mayúsculas ───

  it("§23b: el nombre en mayúsculas del sello se detecta (ADR-088 §2)", () => {
    const carlos = wordIndex(
      run.words,
      (word) => word.text === "CARLOS" && word.bbox.rotation === 90,
    );
    const lopez = wordIndex(run.words, (word) => word.text === "LOPEZ");

    expect(isWordCovered(run, carlos)).toBe(true);
    expect(isWordCovered(run, lopez)).toBe(true);

    // El valor conserva la caja impresa, no la que vio el modelo: es lo que el
    // usuario ve en el panel y lo que "Ver ocurrencias" busca en el documento.
    const grupo = run.groups.find((group) => group.canonicalValue === "PERITO CARLOS LOPEZ");
    expect(grupo).toBeDefined();
  });

  it.fails("§23b: el sello y el cuerpo terminan en el MISMO grupo de persona", () => {
    // La fuga está cerrada —el nombre del sello se tapa— pero sale con un token
    // propio: "PERITO CARLOS LOPEZ" contra "Carlos López" da 0,63 de similitud,
    // debajo del umbral de 0,88. El documento anonimizado nombra a la misma
    // persona de dos maneras. Es calidad, no fuga.
    const grupo = run.groups.find((group) => group.canonicalValue === "Carlos López");
    expect(grupo?.members.length).toBeGreaterThan(1);
  });

  // ─── §23a: el folio a 270° ───

  it("ninguna ocurrencia abarca el folio y el sello a la vez (ADR-088 §1)", () => {
    // Antes de ADR-088 §1 los dos runs se clasificaban juntos y salía UNA
    // entidad `Juan Pérez JUZGADO CIVIL` de 525 × 521 pt sobre una página de
    // 595 × 842, sin `rotation` (las palabras discrepaban en el ángulo) y
    // descartada después por conflicto de solapamiento — o sea que el folio no
    // llegaba al reemplazo. Esta es la garantía que lo reemplaza.
    for (const occurrence of run.occurrences) {
      if (occurrence.wordSpan === undefined) continue;
      const covered = run.words.slice(
        occurrence.wordSpan.startIndex,
        occurrence.wordSpan.endIndexExclusive,
      );
      const angulos = new Set(covered.map((word) => word.bbox.rotation ?? 0));
      expect(angulos.size).toBe(1);
      // La consecuencia geométrica: ninguna envolvente cruza la página.
      expect(occurrence.bbox.width).toBeLessThan(300);
    }
  });

  it("§23a: el folio a 270° produce una ocurrencia propia, contenida en su run", () => {
    const juanFolio = wordIndex(
      run.words,
      (word) => word.text === "Juan" && word.bbox.rotation === 270,
    );
    expect(isWordCovered(run, juanFolio)).toBe(true);

    const delFolio = run.occurrences.find(
      (occurrence) =>
        occurrence.wordSpan !== undefined &&
        occurrence.wordSpan.startIndex <= juanFolio &&
        juanFolio < occurrence.wordSpan.endIndexExclusive,
    );
    // Un run a 270° avanza en vertical: su envolvente es angosta.
    expect(delFolio!.bbox.width).toBeLessThan(20);
    expect(delFolio!.bbox.rotation).toBe(270);
  });

  // ─── El valor con espacio adelante (informe §2.3) ───

  it("el canonicalValue de un grupo no arranca con espacio", () => {
    // `phone-mobile-ar` tiene un `[\s-]?` opcional ANTES de su `\b`
    // (ADR-022), así que sobre "CUIT 20-12345678-9" el match crudo es
    // " 20-12345678" — con el espacio adentro del valor, y de ahí al
    // canonicalValue del grupo. Un grupo así no puede encontrarse a sí mismo:
    // "Ver ocurrencias" empuja su valor al buscador y el matcheo por palabra
    // entera no lo halla. `runPattern` recorta el espacio de borde desde
    // v1.6.2 del spec de Regex.
    for (const group of run.groups) {
      expect(group.canonicalValue).toBe(group.canonicalValue.trim());
    }
    expect(run.groups.map((group) => group.canonicalValue)).toContain("20-12345678");
  });
});
