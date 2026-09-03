/**
 * `NerKernel` — el kernel de inferencia sin estado por documento que ADR-046
 * §1/§3/§5 asigna al NerWorker (espejo de `ocr-engine/src/worker/kernel.ts`,
 * ADR-045). Contiene TODO lo que toca `@huggingface/transformers`:
 * `configureTransformersEnv` (ADR-039), carga perezosa del pipeline con su
 * política de dos intentos, `classifyWithTimeout`, `positionTokens` y
 * `aggregateTokensToSpans`.
 *
 * Este archivo lo importan DOS consumidores (mismo código, dos fronteras):
 * - `ner.engine.ts` (host, in-process fallback): lo invoca directo desde el
 *   `run()` que pasa a `NerJobPool.dispatch` cuando no hay `workerFactory`
 *   real configurada (ADR-035, fallback bit-idéntico).
 * - `worker/entry.ts` (worker real): lo invoca detrás de la mensajería
 *   `postMessage` cuando SÍ hay un Worker de SO real.
 *
 * La clase `NerEngine` (loop por página, partición en batches, retry/timeout,
 * mapeo de spans a `Occurrence`, emisión de eventos) NUNCA importa
 * `@huggingface/transformers` fuera de este archivo — es la única frontera
 * del paquete que lo hace.
 *
 * Estado: el pipeline de Transformers.js cargado para un `(modelId, dtype)`
 * dado, a nivel de módulo. Para el worker real, es "lo que ese worker tiene
 * cargado"; para el fallback in-process, es "el único kernel virtual"
 * (coherente con que en ese modo no hay paralelismo real de todos modos).
 *
 * Ciclo de vida del modelo (ADR-046 §4): reportado por `onProgress` — nunca
 * por eventos de dominio ni por bus/logger (este archivo no tiene ninguno de
 * los dos, por diseño; espejo de la nota de cabecera de OCR). El kernel
 * reintenta la carga una vez (`MODEL_LOAD_MAX_ATTEMPTS`), reportando
 * `model-loading` (progreso de descarga), `model-load-retry` (fallo
 * recuperable, antes del segundo intento) y `model-ready` (éxito). Agotados
 * los intentos, lanza `NerModelMissingError` — cruza tal cual el borde del
 * puerto (ADR-046 §2), sin envolver.
 */
import {
  CancelledError,
  EntityType,
  normalizeEntityValue,
  type NerPagePayload,
  type NerKernelSpan,
  type NerWasmPaths,
  type Serializable,
} from "@anonly/shared";
import { env, pipeline, type TokenClassificationOutput } from "@huggingface/transformers";

import { NerModelMissingError, NerTimeoutError } from "../ner.errors.js";

// Intento inicial + 1 re-descarga ("re-descargar una vez", NER_Engine.md §11
// caso NER_MODEL_LOAD_FAILED / §13 caso 8).
const MODEL_LOAD_MAX_ATTEMPTS = 2;

/*
 * ADR-018 + ADR-023 §2 + ADR-025: el modelo y el runtime WASM de ONNX se
 * sirven first-party, nunca desde HuggingFace ni CDNs de terceros en
 * runtime. Por defecto, @huggingface/transformers apunta
 * env.backends.onnx.wasm.wasmPaths a jsDelivr — se sobreescribe acá.
 * env.localModelPath + modelId arman la ruta real que resuelve
 * getModelFile() de la librería; por eso el destino real de los assets del
 * modelo en assets.lock.json es apps/react-client/public/models/ner/<modelId>/...
 *
 * env.allowLocalModels default es `false` en entorno browser (`true` en
 * Node). Sin setearlo a `true` acá, con allowRemoteModels ya en `false`,
 * pipeline() rechaza sincrónicamente con "Invalid configuration detected:
 * both local and remote models are disabled" — indistinguible en la UI de un
 * modelo realmente ausente/corrupto (mismo NER_MODEL_MISSING). Hallazgo del
 * Escenario 1 E2E (Hito 10 PR10): primera vez que pipeline() corre de
 * verdad, en un browser real.
 */
const NER_LOCAL_MODEL_PATH = "/models/ner/";
const NER_WASM_PATH = "/wasm/onnxruntime/";

// Mapeo de labels del modelo (ADR-023 §2): PER→Person, ORG→Organization,
// LOC→Address (aproximación: "location" no es estrictamente "dirección
// postal"), DATE→Date. Cualquier otro label (incluyendo "O") se ignora.
const LABEL_TO_ENTITY_TYPE: Readonly<Record<string, EntityType>> = {
  PER: EntityType.Person,
  ORG: EntityType.Organization,
  LOC: EntityType.Address,
  DATE: EntityType.Date,
};

/*
 * ADR-025: @huggingface/transformers v4 no exporta un alias público para el
 * tipo del pipeline de token-classification (a diferencia de
 * @xenova/transformers v2, que exportaba TokenClassificationPipelineType) ni
 * para el elemento individual "raw" (no agrupado) de su resultado — solo
 * TokenClassificationOutput<O>, la unión array de spans "raw"/"grouped"
 * parametrizada por las opciones de la llamada. Ambos se derivan del único
 * símbolo público relevante (pipeline()) sin cast: NerClassifier via el tipo
 * de retorno de pipeline() para la task "token-classification";
 * TokenClassificationSingle aislando a nivel de tipos el shape "raw" (el
 * único que produce este kernel, que nunca pasa aggregation_strategy) — es
 * el único elemento de la unión cuyo campo `entity` tipa `string` en vez de
 * `undefined`.
 */
type NerClassifier = Awaited<ReturnType<typeof pipeline<"token-classification">>>;
type TokenClassificationSingle = Extract<TokenClassificationOutput[number], { entity: string }>;

interface PositionedToken {
  readonly entity: string;
  readonly score: number;
  readonly startIndex: number;
  readonly endIndexExclusive: number;
  /** `true` si el token es una continuación de wordpiece (venía con "##"). */
  readonly isContinuation: boolean;
}

interface OpenSpan {
  readonly label: string;
  startIndex: number;
  endIndexExclusive: number;
  scores: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTokenClassificationSingle(value: unknown): value is TokenClassificationSingle {
  if (!isRecord(value)) return false;
  const { entity, score, index, word } = value;
  return (
    typeof entity === "string" &&
    typeof score === "number" &&
    typeof index === "number" &&
    typeof word === "string"
  );
}

// @huggingface/transformers v4 tipa el resultado de un pipeline de
// token-classification como `TokenClassificationOutput<O> | TokenClassificationOutput<O>[]`
// (la unión existe porque la misma función acepta texto único o batched).
// Este kernel siempre invoca con un string único (nunca un array), así que en
// runtime la forma real siempre es la plana — pero se valida con un guard de
// runtime (no un cast) para no asumir ciegamente la forma, mismo criterio
// defensivo que ocr-engine usa con la respuesta de tesseract.js.
function isTokenClassificationOutput(
  value: unknown,
): value is ReadonlyArray<TokenClassificationSingle> {
  return Array.isArray(value) && value.every(isTokenClassificationSingle);
}

function stripContinuationMarker(word: string): string {
  return word.startsWith("##") ? word.slice(2) : word;
}

/*
 * ADR-088 §2 — el modelo default es *cased* y sobre texto todo en mayúsculas
 * devuelve CERO tokens etiquetados: medido, sobre
 * "JUZGADO CIVIL 12 — PERITO CARLOS LOPEZ" no reconoce nada, y la misma línea
 * en Title Case devuelve PER con 0,999. Los sellos, carátulas y membretes de
 * un expediente están sistemáticamente en caja alta, así que es un punto
 * ciego, no un caso de borde.
 *
 * Una **corrida en caja alta** son ≥2 palabras consecutivas que tienen letras,
 * no tienen ninguna minúscula y no tienen un punto seguido de letra. Las tres
 * condiciones están medidas:
 *
 * - El mínimo de dos palabras deja "DNI 34.567.891" intacto (el número no
 *   tiene letras, así que "DNI" queda sola y una palabra no es corrida).
 * - El guard del punto deja "Empresa S.A., CUIT 20-12345678-9" intacto: sin
 *   él, "S.A.," y "CUIT" forman corrida, se transforman en "S.a., Cuit" y la
 *   confianza de la organización del cuerpo cae de 0,995 a 0,792.
 *
 * La transformación preserva la longitud carácter a carácter — cualquier
 * palabra cuyo mapeo de caja la cambie se deja intacta, y el resultado entero
 * se descarta si aun así la longitud no coincide. De eso depende que los
 * offsets de los spans valgan sobre el texto original.
 */
const HAS_LETTER_RE = /\p{L}/u;
const DOT_BEFORE_LETTER_RE = /\.\p{L}/u;

function belongsToUppercaseRun(word: string): boolean {
  return (
    HAS_LETTER_RE.test(word) &&
    word === word.toUpperCase() &&
    word !== word.toLowerCase() &&
    !DOT_BEFORE_LETTER_RE.test(word)
  );
}

function toTitleCase(word: string): string {
  const firstLetter = HAS_LETTER_RE.exec(word);
  if (firstLetter === null) return word;
  const cut = firstLetter.index + firstLetter[0].length;
  const titled = word.slice(0, cut) + word.slice(cut).toLowerCase();
  return titled.length === word.length ? titled : word;
}

function titleCaseUppercaseRuns(text: string): string {
  const words = text.split(" ");
  let changed = false;
  let i = 0;

  while (i < words.length) {
    if (!belongsToUppercaseRun(words[i] ?? "")) {
      i += 1;
      continue;
    }
    let runEnd = i + 1;
    while (runEnd < words.length && belongsToUppercaseRun(words[runEnd] ?? "")) {
      runEnd += 1;
    }
    if (runEnd - i >= 2) {
      for (let k = i; k < runEnd; k++) {
        const word = words[k];
        if (word === undefined) continue;
        const titled = toTitleCase(word);
        if (titled !== word) {
          words[k] = titled;
          changed = true;
        }
      }
    }
    i = runEnd;
  }

  if (!changed) return text;
  const transformed = words.join(" ");
  return transformed.length === text.length ? transformed : text;
}

/*
 * ADR-118: el `normalizedValue` de una ocurrencia sale de `normalizeEntityValue`
 * (`@anonly/shared`), **la misma función que usa la vía manual** — no de una
 * copia local. Este archivo tenía la suya, `normalizeNerValue`, y difería en
 * dos cosas que costaban grupos partidos:
 *
 * - **No sacaba diacríticos.** El mismo nombre encontrado por los dos caminos
 *   daba dos claves (`muñíz` del NER contra `muniz` de un agregado manual), y
 *   el pase difuso de grouping no siempre las rescata: `muñíz`/`muniz` da
 *   **0,600** contra un umbral de 0,88. Medido sobre 8 documentos, de 108
 *   ocurrencias con diacríticos **23 se partían en dos grupos**.
 * - **Recortaba los bordes con una lista de signos** (`.,;:!?()"'«»`) que no
 *   incluía las comillas tipográficas de una carátula. La compartida recorta
 *   por clase Unicode, así que no hay lista a la que le falte uno (ADR-115 §1).
 *
 * Lo que NO cambia: `canonicalValue` y los `aliases` de un grupo salen de
 * `Occurrence.value` —el texto impreso—, no de esta clave, así que en pantalla
 * `Muñíz` sigue con su acento.
 */

/**
 * `wasmPaths` inyectado por config (ADR-039, viaja en el payload desde
 * ADR-046 §5): si está definido se asigna **tal cual** a
 * `env.backends.onnx.wasm.wasmPaths` y nunca se pisa con el default; ausente
 * → se mantiene `NER_WASM_PATH`, el comportamiento previo a ADR-039.
 */
function configureTransformersEnv(wasmPaths: string | NerWasmPaths | undefined): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = NER_LOCAL_MODEL_PATH;
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = wasmPaths ?? NER_WASM_PATH;
  }
}

/*
 * Reconstruye offsets de caracteres para cada token dentro de chunkText.
 *
 * ADR-111 §1: el cursor **depende de recibir todos los tokens**, `O`
 * incluidos. Solo avanza, así que descarta una coincidencia hacia atrás pero
 * no una hacia adelante: sin los tokens sin etiqueta entre entidad y entidad
 * no queda ninguna ancla, y un token corto se ubica en la primera aparición
 * de su texto, que puede estar cientos de caracteres antes de la real.
 * Medido: el `B-PER "D"` de `D'Amoroso` (offset 868) se ubicaba en la `D` de
 * `DE SALAI` (offset 92).
 * @huggingface/transformers v4 sigue sin exponer start/end reales para
 * token-classification: solo entrega `word` (el token decodificado, con
 * prefijo "##" para continuaciones de wordpiece en modelos BERT). Se ubica
 * cada token en el texto con un cursor que solo avanza (garantiza orden y
 * evita coincidencias espurias hacia atrás); un token que no se puede ubicar
 * se descarta de forma defensiva. Nunca se loguea el contenido de los
 * tokens (Code_Standards.md §9: nunca loguear contenido del documento) — este
 * archivo no tiene logger de todos modos.
 */
function positionTokens(
  tokens: ReadonlyArray<TokenClassificationSingle>,
  chunkText: string,
): ReadonlyArray<PositionedToken> {
  const positioned: PositionedToken[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const cleaned = stripContinuationMarker(token.word);
    if (cleaned.length === 0) continue;
    const foundAt = chunkText.indexOf(cleaned, cursor);
    if (foundAt === -1) continue;
    positioned.push({
      entity: token.entity,
      score: token.score,
      startIndex: foundAt,
      endIndexExclusive: foundAt + cleaned.length,
      isContinuation: token.word.startsWith("##"),
    });
    cursor = foundAt + cleaned.length;
  }
  return positioned;
}

/*
 * Agrega tokens BIO (B-PER/I-PER/B-ORG/...) en spans de entidad completos
 * (equivalente simplificado a aggregation_strategy="simple"). Un "B-"
 * siempre abre un span nuevo; un "I-" continúa el span abierto solo si
 * coincide el tipo; cualquier otra cosa (label no soportado, "O", o un "I-"
 * de tipo distinto al abierto) cierra el span en curso. `confidence` es el
 * promedio de los scores de los tokens que componen el span. Offsets
 * relativos al texto del batch (`NerKernelSpan`, ADR-046 §1) — el motor
 * host-side suma el offset del chunk dentro de la página.
 *
 * ADR-088 §2: los tokens se ubican contra `inferenceText` (el texto que vio
 * el modelo) y los `value` se cortan de `chunkText` (el texto como está
 * impreso). Las dos cadenas tienen la misma longitud, así que un offset vale
 * en las dos; separarlas es lo que hace que el `canonicalValue` del grupo
 * diga `PERITO CARLOS LOPEZ` y no `Perito Carlos Lopez`.
 *
 * ADR-111 §1: esta función —y `positionTokens`— asumen la secuencia COMPLETA
 * de tokens, incluidos los `O`. Es `classifyWithTimeout` quien la garantiza,
 * pidiéndole al pipeline `ignore_labels: []`; ver el comentario ahí.
 */
function aggregateTokensToSpans(
  tokens: ReadonlyArray<TokenClassificationSingle>,
  inferenceText: string,
  chunkText: string,
): ReadonlyArray<NerKernelSpan> {
  const positioned = positionTokens(tokens, inferenceText);
  const spans: NerKernelSpan[] = [];
  let open: OpenSpan | null = null;

  const flush = (): void => {
    if (open === null) return;
    const entityType = LABEL_TO_ENTITY_TYPE[open.label];
    if (entityType !== undefined) {
      const value = chunkText.slice(open.startIndex, open.endIndexExclusive);
      const confidence = open.scores.reduce((sum, s) => sum + s, 0) / open.scores.length;
      spans.push({
        entityType,
        value,
        normalizedValue: normalizeEntityValue(value),
        confidence: Math.max(0, Math.min(1, confidence)),
        startIndex: open.startIndex,
        endIndexExclusive: open.endIndexExclusive,
      });
    }
    open = null;
  };

  for (const token of positioned) {
    const taggedAsBegin = token.entity.startsWith("B-");
    const isInside = token.entity.startsWith("I-");
    const label = taggedAsBegin || isInside ? token.entity.slice(2) : null;

    /*
     * v1.3.1 — **un subword no puede EMPEZAR una entidad.** El modelo etiqueta
     * a veces una continuación de wordpiece como `B-`: medido sobre
     * `qa-tables-justified.pdf`, la segunda aparición de "Empresa S.A." sale
     * `B-ORG "Em"` + `B-ORG "##presa"`, y creerle al segundo `B-` parte el
     * span en dos grupos espurios — "Em" y "presa S.A", que es el hallazgo
     * §23f del gate manual.
     *
     * Es la corrección que le faltaba a la "equivalencia simplificada de
     * `aggregation_strategy`" de ADR-046 §1: HuggingFace agrupa los tokens en
     * PALABRAS antes de decidir la etiqueta, y por eso no cae en esto.
     *
     * El `label` se sigue derivando del prefijo crudo — si no, un `B-` de
     * continuación quedaría sin etiqueta y el token se descartaría entero.
     */
    const isBegin = taggedAsBegin && !token.isContinuation;

    if (label === null || !(label in LABEL_TO_ENTITY_TYPE)) {
      flush();
      continue;
    }

    /*
     * ADR-111 §2: la misma regla de v1.3.1, completa. Un subword no empieza
     * una entidad **ni cambiando de tipo**: si el modelo etiqueta `Floren`
     * como LOC y `##cio` como ORG, la palabra es una sola y el span también.
     * Sin esto salen dos entidades cortadas al medio —`"Floren"` y
     * `"cio Varela"`—, y tapar la primera deja la segunda a la vista.
     *
     * Con `open === null` una continuación sí abre: no hay nada que
     * extender. Ese resto lo cubre el borde de palabra de §3.
     */
    if (isBegin || open === null || (open.label !== label && !token.isContinuation)) {
      flush();
      open = {
        label,
        startIndex: token.startIndex,
        endIndexExclusive: token.endIndexExclusive,
        scores: [token.score],
      };
    } else {
      open.endIndexExclusive = token.endIndexExclusive;
      open.scores.push(token.score);
    }
  }
  flush();

  return snapSpansToWordBoundaries(spans, chunkText);
}

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/**
 * ADR-111 §3 — una entidad tapa palabras enteras.
 *
 * Cada span extiende su inicio hacia atrás y su fin hacia adelante mientras el
 * carácter contiguo sea letra o dígito. Media palabra tapada no protege nada:
 * `Echeve` tapado deja `rría` a la vista, y en la UI aparece como una entidad
 * que el usuario no reconoce.
 *
 * El vecino manda: el inicio se topa contra el fin del span anterior y el fin
 * contra el inicio del siguiente. `aggregateTokensToSpans` los emite ordenados
 * y sin solaparse (un token entra a un solo span, y los tokens vienen
 * ordenados por `positionTokens`), así que el clamp **conserva** esa
 * invariante en vez de tener que restaurarla.
 *
 * El `value` se recorta de `chunkText` —el texto como está impreso, no el de
 * inferencia (ADR-088 §2)—, igual que en `flush()`. `normalizedValue` se
 * recalcula: es función del `value`, y dejarlo sin tocar sería dejar dos
 * campos que se contradicen.
 */
/**
 * ADR-111 §3 — dos spans del **mismo tipo** dentro de **una misma palabra** son
 * la misma entidad.
 *
 * Pasa cuando el modelo etiqueta `O` un subtoken del medio: `Ju` `##z` `##gado`
 * con la `z` sin etiquetar cierra el span y abre otro, y quedan `"Ju"` y
 * `"gado"` — el mismo modo de falla que v1.3.1 cerró para el `B-` sobre
 * continuación, por otra puerta. Llevar cada uno al borde de palabra por
 * separado no alcanza: el clamp de más abajo los frena uno contra el otro, que
 * es lo correcto mientras sean entidades distintas.
 *
 * Se fusionan solo si entre los dos **no hay ningún carácter que no sea de
 * palabra**: un espacio, una coma o un guion significan dos palabras, y dos
 * palabras pueden ser dos entidades. La confianza del resultado es la del span
 * más largo, no un promedio: el trozo de una letra que el modelo dudó no tiene
 * por qué arrastrar hacia abajo la confianza de la palabra entera.
 */
function coalesceSpansInsideTheSameWord(
  spans: ReadonlyArray<NerKernelSpan>,
  chunkText: string,
): ReadonlyArray<NerKernelSpan> {
  const merged: NerKernelSpan[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    const between =
      previous === undefined
        ? undefined
        : chunkText.slice(previous.endIndexExclusive, span.startIndex);
    const sameWord =
      previous !== undefined &&
      previous.entityType === span.entityType &&
      span.startIndex >= previous.endIndexExclusive &&
      between !== undefined &&
      [...between].every((ch) => WORD_CHAR_RE.test(ch));

    if (previous === undefined || !sameWord) {
      merged.push(span);
      continue;
    }

    const value = chunkText.slice(previous.startIndex, span.endIndexExclusive);
    const longest =
      span.endIndexExclusive - span.startIndex > previous.endIndexExclusive - previous.startIndex
        ? span
        : previous;
    merged[merged.length - 1] = {
      ...previous,
      value,
      normalizedValue: normalizeEntityValue(value),
      confidence: longest.confidence,
      endIndexExclusive: span.endIndexExclusive,
    };
  }
  return merged;
}

/*
 * ADR-123: la `S` de `S/` no es una inicial.
 *
 * Sobre `"SUAREZ, BARTOLOME ARTURO S/ RECURSO DE"` el modelo devuelve
 * `"BARTOLOME ARTURO S"`: se lleva la primera letra de `S/`, que es la
 * partícula que separa a las partes de una carátula. No es una interpretación
 * discutible del nombre, es un token **cortado por la mitad** — y el `/` que
 * queda del otro lado del borde lo prueba.
 *
 * Por eso la condición mira el carácter de AFUERA y no el nombre: la última
 * letra se descarta solo si (a) pegada al final del span hay una barra, y (b)
 * esa letra es un token de una sola letra. Una inicial de verdad
 * (`"Juan P. García"`) va seguida de un punto, no de una barra, y no entra.
 *
 * Medido sobre 451 spans de PERSON en 8 documentos: **4** terminan justo antes
 * de una barra, y los cuatro son este defecto. Ninguno más se toca.
 *
 * `snapSpansToWordBoundaries` no lo arregla y no podría: `/` no es
 * `WORD_CHAR_RE`, así que para esa función `S` ya es una palabra entera. Esto
 * corre DESPUÉS, para que el ensanche no vuelva a meter la letra.
 *
 * Un span que se queda sin letras ni dígitos después del recorte (el modelo
 * etiquetó la `S` sola) desaparece: no nombra a nadie.
 */
function dropSeparatorLetterAtTheEnd(
  spans: ReadonlyArray<NerKernelSpan>,
  chunkText: string,
): ReadonlyArray<NerKernelSpan> {
  const out: NerKernelSpan[] = [];
  for (const span of spans) {
    const end = span.endIndexExclusive;
    const esBarra = chunkText[end] === "/";
    const ultima = chunkText[end - 1] ?? "";
    const anterior = chunkText[end - 2] ?? "";
    const letraSuelta =
      /\p{L}/u.test(ultima) && (end - 2 < span.startIndex || /\s/u.test(anterior));

    if (!esBarra || !letraSuelta) {
      out.push(span);
      continue;
    }

    const nuevoFin = end - 1;
    const value = chunkText.slice(span.startIndex, nuevoFin).trimEnd();
    if (!WORD_CHAR_RE.test(value)) continue;

    out.push({
      ...span,
      value,
      normalizedValue: normalizeEntityValue(value),
      endIndexExclusive: span.startIndex + value.length,
    });
  }
  return out;
}

function snapSpansToWordBoundaries(
  spans: ReadonlyArray<NerKernelSpan>,
  chunkText: string,
): ReadonlyArray<NerKernelSpan> {
  const coalesced = coalesceSpansInsideTheSameWord(spans, chunkText);
  const encajados = coalesced.map((span, i) => {
    const floor = i === 0 ? 0 : (coalesced[i - 1]?.endIndexExclusive ?? 0);
    const ceiling = coalesced[i + 1]?.startIndex ?? chunkText.length;

    let start = span.startIndex;
    while (start > floor && WORD_CHAR_RE.test(chunkText[start - 1] ?? "")) start -= 1;

    let end = span.endIndexExclusive;
    while (end < ceiling && WORD_CHAR_RE.test(chunkText[end] ?? "")) end += 1;

    if (start === span.startIndex && end === span.endIndexExclusive) return span;

    const value = chunkText.slice(start, end);
    return {
      ...span,
      value,
      normalizedValue: normalizeEntityValue(value),
      startIndex: start,
      endIndexExclusive: end,
    };
  });

  /*
   * ADR-123 corre al FINAL, y la razon no es la que este comentario decia
   * antes ("para que el ensanche no vuelva a meter la letra" — eso no puede
   * pasar: despues del recorte el borde cae sobre un espacio, y el ensanche
   * solo avanza sobre caracteres de palabra).
   *
   * La razon real es la inversa: una letra suelta pegada a una barra puede ser
   * la particula `S/` o la COLA de una palabra partida (`IPS/`), y el recorte
   * no las distingue hasta que el encaje completo la palabra. Corriendo antes,
   * veria un span de una letra y borraria la entidad entera.
   */
  return dropSeparatorLetterAtTheEnd(encajados, chunkText);
}

// ─── Estado del kernel (a nivel de módulo, ADR-046 §1) ───

let classifier: NerClassifier | null = null;
let loadedModelKey: string | null = null;

function resolveDtype(quantization: NerPagePayload["quantization"]): "q8" | "fp32" {
  // ADR-025: @huggingface/transformers v4 reemplaza `quantized: boolean` por
  // `dtype` (elige el sufijo del archivo .onnx a cargar). "q8" (default,
  // ADR-023) es el único nivel con mirror first-party en assets.lock.json
  // para este hito; "q4"/"f32" degradan a `dtype: "fp32"` (model.onnx sin
  // cuantizar) — mismo criterio de degradación que la impl. previa a ADR-046.
  return quantization === "q8" ? "q8" : "fp32";
}

/**
 * Garantiza que el pipeline de Transformers.js esté cargado para
 * `(modelId, dtype)`. Si ya está cargado con esa misma clave, no-op. Si está
 * cargado con una clave distinta, libera la instancia vigente (best-effort) y
 * carga una nueva — espejo de `ensureWorkerLoaded` en ocr-engine (recarga en
 * cambio de idiomas), aplicado acá al cambio de `(modelId, dtype)`
 * (NER_Engine.md §12: "el kernel retiene su pipeline y solo lo re-crea si
 * cambia (modelId, dtype)").
 *
 * Reporta el ciclo de vida vía `onProgress` (ADR-046 §4): `model-loading` con
 * el progreso de descarga ∈ [0,1], `model-load-retry` tras un intento
 * fallido (antes de reintentar) y `model-ready` al terminar con éxito. Tras
 * agotar `MODEL_LOAD_MAX_ATTEMPTS`, lanza `NerModelMissingError`.
 */
async function ensureClassifierLoaded(
  modelId: string,
  quantization: NerPagePayload["quantization"],
  wasmPaths: string | NerWasmPaths | undefined,
  onProgress: ((progress: number, partial?: Serializable) => void) | undefined,
): Promise<void> {
  const dtype = resolveDtype(quantization);
  const key = `${modelId}:${dtype}`;
  if (classifier !== null && loadedModelKey === key) return;

  if (classifier !== null) {
    const previous = classifier;
    classifier = null;
    loadedModelKey = null;
    try {
      await previous.dispose();
    } catch {
      // best-effort: seguir cargando la instancia nueva igual.
    }
  }

  configureTransformersEnv(wasmPaths);

  const progressHandler = (raw: unknown): void => {
    if (!isRecord(raw)) return;
    const { status, progress } = raw;
    if (status !== "progress" || typeof progress !== "number") return;
    onProgress?.(Math.max(0, Math.min(1, progress / 100)), {
      phase: "model-loading",
      modelId,
    });
  };

  let lastReason = "modelo no disponible";
  for (let attempt = 0; attempt < MODEL_LOAD_MAX_ATTEMPTS; attempt++) {
    try {
      classifier = await pipeline("token-classification", modelId, {
        dtype,
        progress_callback: progressHandler,
      });
      loadedModelKey = key;
      onProgress?.(1, { phase: "model-ready", modelId });
      return;
    } catch (err: unknown) {
      lastReason = err instanceof Error ? err.message : String(err);
      // Caso 8 (§13): "Modelo corrupto en cache: NER_MODEL_LOAD_FAILED →
      // re-descargar → si persiste, NER_MODEL_MISSING." Solo se reporta
      // `model-load-retry` cuando de verdad hay un reintento subsiguiente
      // (no en el último intento fallido, que va directo a
      // NerModelMissingError sin nada más que reintentar). No cruza como
      // error (ADR-046 §4): el host lo traduce a `ctx.logger.warn` con el
      // mensaje de `NerModelLoadFailedError`.
      if (attempt < MODEL_LOAD_MAX_ATTEMPTS - 1) {
        onProgress?.(0, { phase: "model-load-retry", modelId, reason: lastReason });
      }
    }
  }

  throw new NerModelMissingError(modelId, lastReason);
}

async function classifyWithTimeout(
  text: string,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
  abortSignal: AbortSignal,
  modelId: string,
): Promise<ReadonlyArray<TokenClassificationSingle>> {
  if (classifier === null) {
    throw new NerModelMissingError(modelId, "El clasificador NER no está inicializado.");
  }
  const activeClassifier = classifier;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new NerTimeoutError(documentId, pageIndex, timeoutMs));
    }, timeoutMs);
  });

  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (abortSignal.aborted) {
      reject(new CancelledError(documentId));
      return;
    }
    onAbort = (): void => reject(new CancelledError(documentId));
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    /*
     * Llamada opaca a la librería externa (mockeada en tests, ADR-021 §5):
     * mismo patrón de Promise.race contra timeout + AbortSignal que
     * ocr-engine (recognizeWithTimeout) usa para envolver una computación
     * WASM que no se puede preemptar desde JS sin un Worker real.
     *
     * ADR-111 §1 — `ignore_labels: []` NO es una opción de afinado: es la
     * precondición de los dos consumidores del resultado.
     * `TokenClassificationPipeline._call` default a `ignore_labels: ['O']` y
     * descarta todo token sin etiqueta; medido, devuelve 21 tokens para una
     * página de 1887 caracteres contra 466 pidiéndolos todos. Sin los `O`:
     * `aggregateTokensToSpans` nunca ejecuta su rama de cierre (`flush()` en
     * un label no soportado) y `positionTokens` se queda sin anclas entre
     * entidad y entidad. Con las dos cosas juntas, una `Person` llegó a
     * abarcar 785 caracteres —tres párrafos— sobre un fallo escaneado.
     *
     * `aggregation_strategy` se deja en su default (`"none"`) a propósito: la
     * agregación nativa de la librería devuelve solo el `word` decodificado,
     * **sin offsets de carácter** (`// TODO: Add support for start and end`
     * en `pipelines/token-classification.js`), y sin offsets no hay bbox.
     */
    const result = await Promise.race([
      activeClassifier(text, { ignore_labels: [] }),
      timeoutPromise,
      abortPromise,
    ]);
    return isTokenClassificationOutput(result) ? result : [];
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (onAbort !== undefined) abortSignal.removeEventListener("abort", onAbort);
  }
}

/*
 * ADR-098 §1: el presupuesto de tokens del lote, derivado del tokenizer ya
 * cargado. No se hardcodea 512: sale de `model_max_length` del modelo, así
 * que cambiar de modelo no deja el número viejo colgado.
 *
 * El margen cubre los tokens especiales que el encoder agrega ([CLS]/[SEP] en
 * BERT). Se resta en vez de medirse porque medirlo pediría una tokenización
 * de sonda por modelo para ahorrar dos posiciones de 512.
 */
const SPECIAL_TOKEN_MARGIN = 4;
const FALLBACK_TOKEN_BUDGET = 512;

/*
 * El tokenizer del pipeline, o `undefined` si no hay uno usable.
 *
 * `undefined` no es un error: el doble de este pipeline en las suites
 * unitarias (ADR-021 §5 mockea esta frontera) puede no traerlo, y tampoco lo
 * traería una versión futura de la librería que lo mueva de lugar. Sin
 * tokenizer no se puede medir, y **no medir no puede empeorar nada**: se
 * infiere de una sola pasada, que es el comportamiento previo a ADR-098.
 */
interface UsableTokenizer {
  readonly modelMaxLength: number;
  encode(text: string): unknown;
}

function tokenizerOf(active: NerClassifier | null): UsableTokenizer | undefined {
  if (active === null) return undefined;
  const raw = (active as { tokenizer?: unknown }).tokenizer;
  // `typeof` da "function", NO "object": el tokenizer de Transformers.js es
  // invocable (`tokenizer(textos, opts)`), o sea un objeto-función. Filtrar
  // por "object" lo descarta entero y el lote no se parte nunca.
  if ((typeof raw !== "object" && typeof raw !== "function") || raw === null) return undefined;
  const { encode, model_max_length: maxLength } = raw as {
    encode?: unknown;
    model_max_length?: unknown;
  };
  if (typeof encode !== "function") return undefined;
  return {
    modelMaxLength:
      typeof maxLength === "number" && Number.isFinite(maxLength)
        ? maxLength
        : FALLBACK_TOKEN_BUDGET,
    encode: (text: string) => (encode as (t: string) => unknown).call(raw, text),
  };
}

function tokenBudgetOf(tokenizer: UsableTokenizer): number {
  return Math.max(1, tokenizer.modelMaxLength - SPECIAL_TOKEN_MARGIN);
}

/** Longitud en tokens de `text`, o `undefined` si el tokenizer no la da. */
function tokenLengthOf(tokenizer: UsableTokenizer, text: string): number | undefined {
  const encoded = tokenizer.encode(text);
  return Array.isArray(encoded) ? encoded.length : undefined;
}

/*
 * ADR-098 §2: los índices donde el lote se puede cortar — el comienzo de cada
 * palabra. Cortar adentro de una palabra le daría al modelo un fragmento que
 * no existe en el documento.
 */
function wordStartOffsets(text: string): ReadonlyArray<number> {
  const starts: number[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    if (match.index !== undefined) starts.push(match.index);
  }
  return starts;
}

/*
 * ADR-098 §2: el corte más lejano que todavía entra en el presupuesto,
 * buscado por bisección **midiendo con el tokenizer**, nunca estimando por
 * una razón promedio: la razón tokens/palabra va de 1,42 en prosa a 6,12 en
 * identificadores puros, así que un promedio vuelve a fallar en el mismo
 * caso que este ADR arregla.
 *
 * Devuelve un offset dentro de `text`, siempre mayor que `from`: si ni la
 * primera palabra entra —una sola palabra que tokenice en más de 508 piezas,
 * que no se ha visto— se corta igual en la siguiente, para garantizar avance
 * y que el bucle no gire para siempre.
 */
function findSplitOffset(
  tokenizer: UsableTokenizer,
  text: string,
  from: number,
  starts: ReadonlyArray<number>,
  budget: number,
): number {
  const candidates = starts.filter((offset) => offset > from);
  if (candidates.length === 0) return text.length;

  let low = 0;
  let high = candidates.length - 1;
  let best = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const end = candidates[mid] ?? text.length;
    const length = tokenLengthOf(tokenizer, text.slice(from, end));
    if (length !== undefined && length <= budget) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  // `best === -1`: ni el primer corte entra. Se avanza igual (ver doc).
  return best === -1 ? (candidates[0] ?? text.length) : (candidates[best] ?? text.length);
}

export interface KernelClassifyOptions {
  readonly timeoutMs: number;
  readonly abortSignal: AbortSignal;
  readonly onProgress?: (progress: number, partial?: Serializable) => void;
}

/**
 * Clasifica el texto de UN BATCH (ADR-046 §3): carga el modelo si hace falta
 * (perezoso, clave `(modelId, dtype)`), tokeniza + infiere con timeout/abort
 * racing, y agrega los tokens BIO en spans de entidad. Offsets relativos al
 * texto del batch — el mapeo a `Occurrence` (bbox) es host-side
 * (`ner.engine.ts`), que es quien tiene las `Word[]` de la página.
 */
export async function kernelClassify(
  payload: NerPagePayload,
  opts: KernelClassifyOptions,
): Promise<ReadonlyArray<NerKernelSpan>> {
  const { documentId, pageIndex, text, modelId, quantization, wasmPaths } = payload;

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  await ensureClassifierLoaded(modelId, quantization, wasmPaths, opts.onProgress);

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  // ADR-088 §2: se infiere sobre el texto con las corridas en caja alta
  // pasadas a Title Case, y los valores se cortan del texto original.
  // `titleCaseUppercaseRuns` mapea carácter a carácter, así que
  // `inferenceText.length === text.length` y un índice de corte vale para los
  // dos (ADR-098 §3).
  const inferenceText = titleCaseUppercaseRuns(text);

  /*
   * ADR-098 §1: el lote se cortó en PALABRAS (`computeWordChunks`, host) pero
   * el modelo trunca en TOKENS, y `truncation: true` descarta la cola sin
   * error ni log. Acá —el único lugar del sistema que sabe cuántos tokens
   * tiene un texto— se mide y, si no entra, se parte.
   *
   * El camino común es el de siempre: un solo sub-lote, una sola inferencia.
   */
  const tokenizer = tokenizerOf(classifier);
  const budget = tokenizer === undefined ? 0 : tokenBudgetOf(tokenizer);
  const starts = wordStartOffsets(inferenceText);

  const spans: NerKernelSpan[] = [];
  let from = 0;
  while (from < inferenceText.length) {
    const remaining =
      tokenizer === undefined ? undefined : tokenLengthOf(tokenizer, inferenceText.slice(from));
    const to =
      tokenizer === undefined || remaining === undefined || remaining <= budget
        ? inferenceText.length
        : findSplitOffset(tokenizer, inferenceText, from, starts, budget);

    const rawTokens = await classifyWithTimeout(
      inferenceText.slice(from, to),
      documentId,
      pageIndex,
      opts.timeoutMs,
      opts.abortSignal,
      modelId,
    );
    const subSpans = aggregateTokensToSpans(
      rawTokens,
      inferenceText.slice(from, to),
      text.slice(from, to),
    );
    // ADR-098 §3: los offsets vuelven a coordenadas del LOTE, que es lo que
    // el host espera (ADR-046 §1).
    for (const span of subSpans) {
      spans.push(
        from === 0
          ? span
          : {
              ...span,
              startIndex: span.startIndex + from,
              endIndexExclusive: span.endIndexExclusive + from,
            },
      );
    }

    from = to;
  }

  return spans;
}

/**
 * Libera la instancia del pipeline cargada por este kernel. Invocado DIRECTO
 * (sin pasar por `NerJobPool.dispatch`, ver `ner.engine.ts#dispose`) porque
 * `dispose()` no es la operación del puerto (ADR-046 §2, mismo criterio que
 * `kernelDispose` de ocr-engine, ADR-045); para el modo worker real, la
 * liberación server-side llega por el mensaje genérico `DISPOSE` del
 * protocolo, manejado en `worker/entry.ts`. Resiliente a que `dispose()`
 * rechace (best-effort, mismo criterio que ocr-engine mantiene).
 */
export async function kernelDispose(): Promise<void> {
  if (classifier !== null) {
    const current = classifier;
    classifier = null;
    loadedModelKey = null;
    try {
      await current.dispose();
    } catch {
      // best-effort: liberar igual el estado interno aunque dispose() falle.
    }
  }
}
