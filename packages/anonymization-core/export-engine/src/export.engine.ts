/**
 * @anonly/export-engine — `ExportEngine` (implementa `IEngine`).
 *
 * Fuente de verdad: docs/core/Export_Engine.md (v1.2.0, ADR-047).
 *
 * ADR-047 (PR16, reparto host/worker): `export()` queda entero host-side
 * (validación, loop por página, `RenderPageProvider`, retry/timeout, los
 * cuatro eventos, sanitización de `title`/`filename`, blob URL). Al
 * **ExportWorker** cruzan solo dos operaciones de pdf-lib —`append-page` y
 * `save`— a través del puerto interno `ExportJobPool` (espejo de
 * `OcrJobPool`/ADR-045 §2, `NerJobPool`/ADR-046 §2): con `pool` inyectado por
 * constructor, cada despacho corre por `WorkerPool` (Web Worker real si el
 * façade lo configuró, `ADR-036 §2`); sin `pool` (`new ExportEngine()`),
 * cae al fallback in-process trivial (`IMMEDIATE_POOL`), que invoca el mismo
 * módulo de ensamblado (`./worker/assembler.js`) directo — bit-idéntico,
 * ADR-035. El `PDFDocument` en construcción vive en `this.assemblerState`
 * cuando se usa el fallback (el worker real lo retiene del otro lado de la
 * frontera, `worker/entry.ts`).
 *
 * ADR-032 (auditoría pre-Hito 8): `RenderPageProvider.renderFull` devuelve
 * `EncodedPageImage` (bytes ya codificados PNG/JPEG); el motor no se
 * suscribe a ningún evento (`EXPORT_REQUESTED` lo escucha el Orchestrator,
 * que arma `ExportEngineInput` y llama `export()` directamente); con 0
 * grupos `enabled`, `export()` **no lanza**: loguea `ctx.logger.warn` con el
 * code `EXPORT_NO_ENABLED_GROUPS` en metadata y continúa (el export
 * resultante es idéntico al original reconstruido).
 *
 * ADR-055 (2026-07-31 — el resultado que cruza un Worker se decodifica con
 * un guard, nunca con un cast; D4 de la serie preventiva D1..D4 de
 * `roadmap/MVP.md`, ADR-055 §9 fila "3-5" — este motor NUNCA tuvo el bug de
 * ADR-055 Contexto §1, exclusivo de `ner-engine`): `ExportJobPool.dispatch`
 * deja de ser genérico (`dispatch<T>(...): Promise<T>`) y pasa a
 * `dispatch(...): Promise<unknown>`. Las DOS operaciones que cruzan el
 * puerto reciben trato distinto, decidido caso por caso (mismo criterio que
 * `render-engine`/D2 para `broadcast`, ver su comentario de cabecera
 * "Alcance de broadcast"):
 *
 * - **`append-page`** (`exportPage`/`dispatchAppendPage`, más abajo): el
 *   call site nunca liga el valor resuelto (`await withDispatchTimeout(...);
 *   return;` — sin desestructurar, sin nombrar una variable). El worker
 *   remoto postea `result: null` (`worker/entry.ts`: "Sin datos que
 *   devolver: el host solo necesita la confirmación de COMPLETED") mientras
 *   que el camino in-process resuelve `undefined` (`dispatchAppendPage`
 *   devuelve `Promise<void>`) — una asimetría real y observable entre los
 *   dos caminos, a diferencia de las operaciones de `render-engine` que sí
 *   tienen decoder. Aun así, **sin decoder**: el invariante de ADR-055 §1
 *   ("ningún valor... se consume sin decodificar") protege consumo, y acá no
 *   hay ningún campo que un guard pudiera proteger de una lectura corrupta —
 *   agregar uno validaría una forma sin consumidor, exactamente lo que el
 *   comentario de `unloadDocument`/`reprimeWorkers` en `render.engine.ts`
 *   (D2) señala como "lo opuesto al problema que ADR-055 cierra". La
 *   asimetría `null`/`undefined` no cambia esa conclusión: ninguna de las dos
 *   formas se lee jamás, así que ninguna puede producir un `TypeError` ni un
 *   resultado incorrecto silencioso — el modo de falla que motivó ADR-055
 *   (Contexto §1) requiere que el valor se toque. La confirmación de éxito
 *   de la página ya la da la resolución misma de la Promise (vs. `FAILED`/
 *   `CANCELLED`, discriminados por `worker-pool.ts`, sin relación con la
 *   forma de `result`), no un campo de su contenido.
 * - **`save`** (`saveWithRetry`/`dispatchSave`, más abajo): el call site SÍ
 *   consume el valor completo — es el `ArrayBuffer` final que `export()`
 *   devuelve al caller y que se transfiere como `blobUrl`. Una sola forma
 *   legítima, idéntica en los dos caminos (`worker/entry.ts` postea
 *   `result: buffer` pelado; `dispatchSave` resuelve el mismo `ArrayBuffer`
 *   de `savePdf()`, sin sobre en ningún lado — a diferencia de NER, no hay
 *   dos formas que reconciliar). Decoder real: `decodeSaveResult`, que exige
 *   `dispatchResult instanceof ArrayBuffer` y ante cualquier otra forma
 *   lanza `ExportFailedError` (Code_Standards.md §7: "InvalidInputError si
 *   no hay una específica" — acá SÍ la hay, y es exactamente la clase que
 *   spec §11 mapea a "error fatal durante ensamblado o serialización": un
 *   `save()` que no produjo un `ArrayBuffer` usable ES esa categoría, no un
 *   error de input del caller). Retryable, como cualquier otro
 *   `ExportFailedError` — mismo tratamiento que un `save()` que lanza de
 *   verdad: reintenta 1 vez (`saveWithRetry`), y si persiste, `EXPORT_FAILED`
 *   se emite (evento observable, `Contracts.md` §8) — ningún sobre roto se
 *   disfraza de PDF exportado con éxito. Sin la maquinaria de escalada de
 *   `ner-engine` (`NerDispatchEnvelopeError`/`NerDispatchDecodeFailure`, ADR-
 *   055 §5): a diferencia de NER, acá no hay forma de que un fallo de
 *   decodificación se disfrace de "no había nada que exportar".
 * - `withDispatchTimeout<T>` (más abajo) **sigue genérico, sin narrowing**:
 *   no es un decoder — es una carrera contra un timeout que nunca inspecciona
 *   ni afirma nada sobre la forma de lo que resuelve, solo reenvía lo que
 *   `dispatch()` produzca (mismo rol que `Promise.race` de la lib estándar).
 *   Su `T` se infiere del cierre que se le pasa (`() => this.pool.dispatch(...)`,
 *   que ahora devuelve `Promise<unknown>`), así que en los dos call sites
 *   queda instanciado en `unknown` sin ningún cambio en su propia firma —
 *   angostarlo a mano sería redundante (y menos reusable, si en el futuro
 *   envuelve algo que no sea `pool.dispatch`).
 *
 * Notas de diseño no triviales (dentro del margen que el spec deja abierto,
 * ninguna rompe un contrato público de Contracts.md/Export_Engine.md):
 *
 * 1. `Replacement.originalValue` (uno por cada `Replacement` resuelto de un
 *    grupo `enabled`, §"Flujo de export": "replacements = resolver
 *    replacements de grupos enabled para esta página") no tiene fuente propia
 *    en el modelo de datos: `EntityGroup` no guarda un valor original por
 *    `OccurrenceRef` (solo `canonicalValue` a nivel de grupo) y
 *    `OccurrenceRef` no incluye `value`. Se usa `group.canonicalValue` como
 *    `originalValue`: es el único dato semánticamente equivalente disponible,
 *    y el campo no es consumido por ninguna lógica de seguridad ni de
 *    ensamblado (`RenderEngine.paintReplacements` tampoco lo lee, solo usa
 *    `mode`/`replacementValue`) — no afecta ninguna garantía del export.
 * 2. `ExportEngineInput.rules` no se usa en `export()`: por diseño, el
 *    Grouping Engine ya resuelve `replacementMode`/`replacementValue` de cada
 *    `EntityGroup` aplicando `Rule[]` en orden de prioridad antes de que
 *    Export reciba los grupos (`Grouping_Engine.md` §2: "Resolver
 *    replacementMode y replacementValue aplicando Rule[]..."). El campo se
 *    preserva en el tipo de entrada porque así lo define §6/§9 del spec (el
 *    Orchestrator lo tiene disponible y lo pasa), pero Export no necesita
 *    reprocesarlo.
 * 3. `ExportOptions.filename` no tiene ningún punto de inserción en el PDF
 *    resultante ni en `ExportEngineOutput`/`ExportFinished` (ninguno de los
 *    dos expone un campo de nombre de archivo — spec §10, Contracts.md §8):
 *    es un dato de conveniencia para que el host arme la descarga (Hito 9/10),
 *    fuera del alcance de Export. Por construcción, ningún valor de
 *    `filename` puede afectar la estructura del PDF (nunca se interpola en
 *    el output) — la propiedad de seguridad de la §13 caso 16 ("se sanitiza
 *    para evitar PDF injection") se cumple trivialmente para `filename` sin
 *    código adicional; `title` sí se embebe (`pdfDoc.setTitle`) y por eso es
 *    el único campo que pasa por `sanitizeMetadataString` (checklist §15.8).
 */

import {
  CancelledError,
  EngineDisposedError,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EntityType,
  EventChannel,
  InvalidInputError,
  ReplacementMode,
  type EngineContext,
  type EntityGroup,
  type ExportMetadata,
  type ExportPagePayload,
  type ExportSavePayload,
  type IEngine,
  type MarkerLegendEntry,
  type MarkerLegendRow,
  type Replacement,
} from "@anonly/shared";

import { ExportFailedError, ExportTimeoutError } from "./export.errors.js";
import type {
  EncodedPageImage,
  ExportEngineInput,
  ExportEngineOutput,
  RenderPageProvider,
} from "./export.types.js";
import {
  discardState,
  EMPTY_ASSEMBLER_STATE,
  type AssemblerState,
} from "./worker/assembler-state.js";

/*
 * ADR-099: el ensamblador se importa **dinámicamente**.
 *
 * `worker/assembler.js` importa `pdf-lib` a nivel de módulo. Con un import
 * estático acá, esta clase —que el façade instancia siempre— arrastraba
 * pdf-lib entero al chunk inicial de la app, aunque nadie exportara nunca un
 * documento. El estado (`AssemblerState`/`EMPTY_ASSEMBLER_STATE`) sí se
 * importa estático: vive en `assembler-state.js`, que no tiene dependencias
 * de runtime.
 */
// El tipo del módulo sale de inferir el `import()`, no de anotarlo:
// `typeof import(...)` en posición de tipo lo prohíbe
// `@typescript-eslint/consistent-type-imports`.
function importAssembler() {
  return import("./worker/assembler.js");
}

let assemblerModule: ReturnType<typeof importAssembler> | undefined;

function loadAssembler(): ReturnType<typeof importAssembler> {
  assemblerModule ??= importAssembler();
  return assemblerModule;
}

const DEFAULT_TIMEOUT_MS = 30_000; // spec §11/§12: "default 30 s por página".
const MAX_RETRIES = 1; // spec §11: "reintentar 1 vez".
const MAX_TITLE_LENGTH = 500; // spec §13 caso 16: "título muy largo".

// ─── Puerto interno de despacho (ADR-047 §2, espejo exacto de
// OcrJobPool/OcrDispatchParams en ocr-engine/src/ocr.engine.ts y
// NerJobPool/NerDispatchParams en ner-engine/src/ner.engine.ts). No
// exportado desde index.ts — detalle de wiring interno. ───

// `dispatch` deja de ser genérico y devuelve `Promise<unknown>` (ADR-055 §2,
// ver nota de cabecera del archivo): el parámetro de tipo `<T>` que tenía
// antes era una afirmación que el compilador no podía verificar — del otro
// lado de `run()` puede haber cruzado un `postMessage` real. Con `unknown`,
// el compilador obliga a pasar por `decodeSaveResult` (más abajo) antes de
// tratar el resultado de `save` como `ArrayBuffer`; `append-page` no
// desestructura nada (ver nota de cabecera — sin consumo, sin decoder).
interface ExportDispatchParams {
  readonly run: () => Promise<unknown>;
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly payload?: unknown;
  readonly maxRetriesOverride?: number;
}

interface ExportJobPool {
  dispatch(params: ExportDispatchParams): Promise<unknown>;
}

/**
 * Fallback in-process trivial: sin `ExportPool` inyectada, ejecuta `run()`
 * directo, sin cola ni reintentos propios (los dos únicos loops de retry son
 * los de `exportPage`/`saveWithRetry`, host-side). Es el comportamiento que
 * este motor tenía antes de ADR-047 (ADR-035 §1) — el que los tests
 * existentes de este paquete ya esperan (`new ExportEngine()` sin argumento).
 * El resultado de `run()` (`undefined` para `dispatchAppendPage`, el
 * `ArrayBuffer` pelado para `dispatchSave`) pasa por el mismo call site que
 * el camino remoto — es la prueba de paridad entre los dos caminos (ADR-055
 * §2): `save` la ejercita vía `decodeSaveResult`; `append-page` no necesita
 * ejercitarla porque no hay decoder que probar (nota de cabecera).
 */
const IMMEDIATE_POOL: ExportJobPool = {
  dispatch: (params: ExportDispatchParams): Promise<unknown> => params.run(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Detalle legible de una forma no reconocida, para el `details` de
 * `ExportFailedError` — nunca contenido del documento (Code_Standards.md §9:
 * "Nunca loguear contenido del documento"), solo la forma del valor.
 */
function describeDispatchResultShape(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof ArrayBuffer) return `ArrayBuffer(byteLength=${value.byteLength})`;
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (isRecord(value)) return `object(keys=[${Object.keys(value).join(", ")}])`;
  return typeof value;
}

/**
 * Decodifica el `Promise<unknown>` que resuelve `ExportJobPool.dispatch` para
 * `save` (ADR-055 §2, nota de cabecera del archivo): la única forma legítima
 * es un `ArrayBuffer` pelado — el PDF final serializado por `savePdf()`,
 * idéntica en el camino remoto (`worker/entry.ts` postea `result: buffer` sin
 * envolver) y en el in-process (`dispatchSave` resuelve el mismo `buffer`).
 * Ante cualquier otra forma lanza `ExportFailedError` (ADR-055 §3: nunca un
 * default en silencio) — es la clase que spec §11 ya asigna a "error fatal
 * durante ensamblado o serialización", y un `save()` que no produjo un
 * `ArrayBuffer` usable ES esa categoría.
 */
function decodeSaveResult(dispatchResult: unknown, documentId: string): ArrayBuffer {
  if (dispatchResult instanceof ArrayBuffer) return dispatchResult;
  const receivedShape = describeDispatchResultShape(dispatchResult);
  throw new ExportFailedError(
    documentId,
    "ExportJobPool.dispatch() resolvió save con una forma no reconocida: se " +
      "esperaba un ArrayBuffer pelado (worker/assembler.ts#savePdf) — misma " +
      "forma en el camino remoto y en el in-process (ADR-055 §2). Devolver un " +
      `default en silencio está prohibido (ADR-055 §3). Forma recibida: ${receivedShape}.`,
    { receivedShape },
  );
}

/**
 * Corre `dispatch()` en carrera contra un timeout local: `workerPool.timeouts
 * ["export-page"]` (30 s) lo aplica el host envolviendo el despacho — el pool
 * no tiene timeout propio (ADR-047 §5). Mismo patrón que `renderPageWithTimeout`
 * más abajo, generalizado para los dos despachos nuevos (append-page/save).
 *
 * ADR-055: `<T>` acá NO es la afirmación de forma que tenía el `<T>` de
 * `ExportJobPool.dispatch` antes de angostarlo (nota de cabecera) — esta
 * función nunca inspecciona `T`, solo reenvía lo que `dispatch()` resuelva
 * (igual que `Promise.race`). Se mantiene genérica a propósito: en los dos
 * call sites, `T` queda instanciado en `unknown` por inferencia (el cierre
 * que reciben devuelve `Promise<unknown>`, ya que `ExportJobPool.dispatch` lo
 * es), así que el guard sigue siendo obligatorio en el call site — angostarla
 * a mano acá no cambiaría nada y la haría menos reusable.
 */
async function withDispatchTimeout<T>(
  dispatch: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  try {
    return await Promise.race([dispatch(), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Normaliza un error emergente del despacho a la subclase concreta que
 * corresponde por `code` (ADR-047 §5, espejo de `normalizeTimeout` de
 * ocr-engine/ADR-045 §2 y `normalizeNerError` de ner-engine/ADR-046 §2): un
 * error local (fallback in-process, lanzado por `worker/assembler.ts` o por
 * el timeout local de `withDispatchTimeout`) ya es la instancia concreta.
 * Uno que cruzó un worker remoto llega deserializado (`EngineError.deserialize`,
 * `Contracts.md` §4) como instancia genérica con el `code` correcto, que NO
 * es `instanceof ExportTimeoutError` ni `instanceof ExportFailedError` — sin
 * esta normalización, el `error.code` final emitido en `EXPORT_FAILED`
 * cambiaría de forma según haya worker real o fallback. `pageIndex` está
 * ausente para el despacho de `save` (sin página asociada): en ese caso un
 * `EXPORT_TIMEOUT` deserializado se trata como `ExportFailedError` (mismo
 * criterio que el timeout local de `saveWithRetry`, que tampoco usa
 * `ExportTimeoutError` — su mensaje es page-specific).
 */
function normalizeExportError(
  err: unknown,
  documentId: string,
  timeoutMs: number,
  pageIndex?: number,
): unknown {
  if (err instanceof ExportTimeoutError || err instanceof ExportFailedError) return err;
  if (!(err instanceof EngineError)) return err;
  if (err.code === EngineErrorCode.EXPORT_TIMEOUT && pageIndex !== undefined) {
    return new ExportTimeoutError(documentId, pageIndex, timeoutMs);
  }
  if (err.code === EngineErrorCode.EXPORT_TIMEOUT || err.code === EngineErrorCode.EXPORT_FAILED) {
    const reason = typeof err.details.reason === "string" ? err.details.reason : err.message;
    return new ExportFailedError(documentId, reason, pageIndex !== undefined ? { pageIndex } : {});
  }
  return err;
}

/**
 * Elimina caracteres de control (incluye NUL, CR, LF) y trunca a un largo
 * razonable. `pdf-lib` ya escapa paréntesis/backslashes al serializar
 * `PDFString`, pero esta capa no depende de esa garantía interna de la
 * librería (spec §13 caso 16, checklist §15.8).
 */
function sanitizeMetadataString(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) result += char;
  }
  return result.length > MAX_TITLE_LENGTH ? result.slice(0, MAX_TITLE_LENGTH) : result;
}

// Nota de implementación 1 (cabecera del archivo): originalValue = canonicalValue.
// Exportada desde index.ts por ADR-044 §4: única excepción sancionada a "index.ts
// exporta solo la clase/tipos/errores" (Export_Engine.md §15.16) — el façade
// (Orchestrator) la importa para computar los reemplazos del preview mediado
// con la MISMA semántica que el export (grupos → Replacement[] por página,
// filtrando enabled === false).
export function buildPageReplacements(
  pageIndex: number,
  groups: ReadonlyArray<EntityGroup>,
): ReadonlyArray<Replacement> {
  const replacements: Replacement[] = [];
  for (const group of groups) {
    if (!group.enabled) continue;
    for (const member of group.members) {
      if (member.pageIndex !== pageIndex) continue;
      replacements.push({
        groupId: group.id,
        occurrenceId: member.occurrenceId,
        pageIndex: member.pageIndex,
        bbox: member.bbox,
        originalValue: group.canonicalValue,
        replacementValue: group.replacementValue,
        mode: group.replacementMode,
        // ADR-074 §1/§4: copiado tal cual del member, nunca `fragments:
        // undefined` explícito (exactOptionalPropertyTypes). render-engine
        // pinta por fragments ?? [bbox], nunca la envolvente sola.
        ...(member.fragments !== undefined ? { fragments: member.fragments } : {}),
      });
    }
  }
  return replacements;
}

// ─── Leyenda de marcadores (ADR-059, Hito 10.5 PR 8) ───

// ADR-059 §2: nombre humano de cada EntityType para MarkerLegendRow.typeName,
// Título singular. NO es la "cuarta tabla" que ADR-059 §2 prohíbe -- esa
// prohibición es sobre el CONTENIDO (no inventar nombres nuevos, usar los
// mismos 13 de siempre), no sobre el mecanismo de código: la tabla de nivel 0
// de ADR-057 §2 vive privada en grouping-engine/src/labels.ts (no exportada
// desde su index.ts) y un motor no puede importar a otro (P-1/P-2). Mismo
// precedente que apps/react-client/src/components/entities/entityTypeLabels.ts
// (su propia variante plural, para su propio contexto de UI). Los 4 valores
// de Person/DNI/License/Plate son los ejemplos literales de ADR-059 §2; los 9
// restantes son presentacionales de bajo riesgo, mismo criterio que
// labels.ts usó para sus 9 no ejemplificados por ADR-012.
const MARKER_LEGEND_TYPE_NAME: Readonly<Record<EntityType, string>> = {
  [EntityType.Person]: "Persona",
  [EntityType.Organization]: "Organización",
  [EntityType.Address]: "Dirección",
  [EntityType.DNI]: "DNI",
  [EntityType.CUIT]: "CUIT",
  [EntityType.Phone]: "Teléfono",
  [EntityType.Email]: "Email",
  [EntityType.IBAN]: "IBAN",
  [EntityType.CreditCard]: "Tarjeta",
  [EntityType.Date]: "Fecha",
  [EntityType.License]: "Matrícula",
  [EntityType.Plate]: "Patente",
  [EntityType.Custom]: "Custom",
};

// ADR-057 formatea el placeholder como "[<LABEL> <NN>]" (nivel 0/1) o
// "[<CORTO>-<NN>]" (nivel 2, grouping-engine/src/labels.ts#tokenForLevel).
// La leyenda no puede importar esa tabla (P-2): el prefijo se recupera
// parseando el propio `replacementValue`, que ya viene abreviado por el
// grupo. Un valor que no matchea el formato esperado se descarta (no rompe
// el export completo por una fila de leyenda).
const PLACEHOLDER_PREFIX_PATTERN = /^\[(.+)[\s-]\d+\]$/;

function extractPlaceholderPrefix(replacementValue: string): string | undefined {
  return PLACEHOLDER_PREFIX_PATTERN.exec(replacementValue)?.[1];
}

/**
 * Proyección `EntityGroup[] → MarkerLegendEntry[]` (ADR-059 §3, checklist
 * ítem 26), en el mismo lugar donde ya se proyectan los grupos para el
 * export (`buildPageReplacements`, arriba): agrupa por `type` los grupos
 * `enabled` en modo `placeholder`, juntando los prefijos DISTINTOS de
 * `replacementValue` (ADR-057 elige el nivel por grupo; dos grupos del mismo
 * tipo pueden quedar en niveles distintos) y sumando `members.length`
 * (marcadores = ocurrencias, no grupos). Único punto de este motor que ve un
 * `EntityGroup` para la leyenda -- de acá en más solo viaja tipo/prefijos/
 * conteo (`MarkerLegendEntry`), y después solo strings (`buildMarkerLegend`).
 */
export function buildMarkerLegendEntries(
  groups: ReadonlyArray<EntityGroup>,
): ReadonlyArray<MarkerLegendEntry> {
  const prefixesByType = new Map<EntityType, Set<string>>();
  const countByType = new Map<EntityType, number>();

  for (const group of groups) {
    if (!group.enabled || group.replacementMode !== ReplacementMode.Placeholder) continue;
    const prefix = extractPlaceholderPrefix(group.replacementValue);
    if (prefix === undefined) continue;
    const prefixes = prefixesByType.get(group.type) ?? new Set<string>();
    prefixes.add(prefix);
    prefixesByType.set(group.type, prefixes);
    countByType.set(group.type, (countByType.get(group.type) ?? 0) + group.members.length);
  }

  // Orden de EntityType (ADR-059 §2 lista Persona, DNI, Matrícula, Patente --
  // el mismo orden de declaración del enum, no el de aparición en `groups`).
  const entries: MarkerLegendEntry[] = [];
  for (const type of Object.values(EntityType)) {
    const prefixes = prefixesByType.get(type);
    if (prefixes === undefined) continue;
    entries.push({ type, prefixes: [...prefixes], markerCount: countByType.get(type) ?? 0 });
  }
  return entries;
}

/**
 * ADR-059 §3: `MarkerLegendEntry[]` -> filas de strings ya compuestos, lo
 * único que cruza a Render (`RenderPageProvider.renderLegend`). Función
 * pura; exportada desde index.ts (mismo criterio que `buildPageReplacements`).
 */
export function buildMarkerLegend(
  entries: ReadonlyArray<MarkerLegendEntry>,
): ReadonlyArray<MarkerLegendRow> {
  return entries.map((entry) => ({
    prefixes: entry.prefixes.join(", "),
    typeName: MARKER_LEGEND_TYPE_NAME[entry.type],
    countLabel: `${entry.markerCount} marcador${entry.markerCount === 1 ? "" : "es"}`,
  }));
}

interface LegendPayloadFields {
  readonly legendImage: EncodedPageImage;
  readonly legendPageWidthPt: number;
  readonly legendPageHeightPt: number;
}

async function renderLegendWithTimeout(
  provider: RenderPageProvider,
  rows: ReadonlyArray<MarkerLegendRow>,
  abortSignal: AbortSignal,
  documentId: string,
  timeoutMs: number,
): Promise<EncodedPageImage> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ExportFailedError(documentId, `Timeout esperando renderLegend (${timeoutMs}ms).`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([provider.renderLegend(rows, abortSignal), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function renderPageWithTimeout(
  provider: RenderPageProvider,
  pageIndex: number,
  replacements: ReadonlyArray<Replacement>,
  abortSignal: AbortSignal,
  documentId: string,
  timeoutMs: number,
): Promise<EncodedPageImage> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ExportTimeoutError(documentId, pageIndex, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      provider.renderFull(pageIndex, replacements, abortSignal),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export class ExportEngine implements IEngine {
  readonly id = EngineId.Export;

  private readonly pool: ExportJobPool;

  private ctx: EngineContext | null = null;
  private initialized = false;
  private disposed = false;
  // El PDFDocument en construcción del fallback in-process (ADR-047 §1/§4):
  // sin uso cuando `this.pool` despacha a un worker real (ese estado vive
  // del otro lado de la frontera, `worker/entry.ts`).
  private assemblerState: AssemblerState = EMPTY_ASSEMBLER_STATE;

  /**
   * `pool` (ADR-047 §2): inyectada por el façade en `createCore`
   * (`create-core.ts`, espejo de `new OcrEngine(ocrPool)`/`new
   * NerEngine(nerPool)`, sobre un `WorkerPool` de `size: 1`). Sin argumento,
   * cae al fallback in-process trivial (`IMMEDIATE_POOL`) — el comportamiento
   * que este motor tenía antes de ADR-047, usado por sus propios tests.
   */
  constructor(pool?: ExportJobPool) {
    this.pool = pool ?? IMMEDIATE_POOL;
  }

  init(ctx: EngineContext): Promise<void> {
    // §8/ADR-032 §2: sin suscripciones a eventos. EXPORT_REQUESTED lo escucha
    // el Orchestrator, que llama export() directamente.
    this.ctx = ctx;
    this.initialized = true;
    this.disposed = false;
    ctx.logger.info("Export Engine initialized");
    return Promise.resolve();
  }

  async export(input: ExportEngineInput, ctx: EngineContext): Promise<ExportEngineOutput> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (input == null) {
      throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Export });
    }

    this.validateInput(input);

    if (ctx.abortSignal.aborted) {
      throw new CancelledError(input.documentId);
    }

    const startedAt = Date.now();
    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_STARTED, {
      documentId: input.documentId,
    });

    const enabledGroups = input.groups.filter((group) => group.enabled);
    if (enabledGroups.length === 0) {
      // ADR-032 §3: no lanza, loguea y continúa (export = original reconstruido).
      ctx.logger.warn(
        "Ningún grupo habilitado; el export será idéntico al original reconstruido.",
        { documentId: input.documentId, code: EngineErrorCode.EXPORT_NO_ENABLED_GROUPS },
      );
    }

    const totalPages = input.document.pageCount;
    const timeoutMs = ctx.config.workerPool.timeouts["export-page"] ?? DEFAULT_TIMEOUT_MS;

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(input.documentId);
      }

      await this.exportPage(input, ctx, pageIndex, timeoutMs);

      ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_PROGRESS, {
        documentId: input.documentId,
        current: pageIndex + 1,
        total: totalPages,
      });
    }

    const metadata: ExportMetadata = {
      producer: "Anonly",
      creator: "Anonly",
      creationDate: new Date(),
      ...(input.options.title !== undefined
        ? { title: sanitizeMetadataString(input.options.title) }
        : {}),
    };

    // ADR-059 §6/§8 (caso 25): la leyenda se pide ANTES de saveWithRetry --
    // si renderLegend agota reintentos, el export falla acá, nunca con un
    // save a medio camino ni un EXPORT_FINISHED sobre un PDF incompleto.
    const legend = await this.buildLegendPayload(input, ctx, timeoutMs);

    const buffer = await this.saveWithRetry(input.documentId, ctx, metadata, timeoutMs, legend);

    const durationMs = Date.now() - startedAt;
    // ADR-047 §6: el blob URL se crea siempre en host, nunca en el worker
    // (que no tiene `createObjectURL` garantizado).
    const blobUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));

    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_FINISHED, {
      documentId: input.documentId,
      blobUrl,
      sizeBytes: buffer.byteLength,
      durationMs,
    });

    return { documentId: input.documentId, buffer, sizeBytes: buffer.byteLength, durationMs };
  }

  dispose(): Promise<void> {
    // ADR-047 §1/§4: libera el ensamblador local del fallback in-process (el
    // de un worker real se libera por el DISPOSE del protocolo,
    // `worker/entry.ts`).
    this.assemblerState = discardState();
    this.ctx = null;
    this.initialized = false;
    this.disposed = true;
    return Promise.resolve();
  }

  // ─── Internos ───

  private validateInput(input: ExportEngineInput): void {
    if (input.document.pageCount <= 0) {
      // §9 restricción / §13 caso 1.
      throw new InvalidInputError("document.pageCount debe ser mayor a 0.", {
        documentId: input.documentId,
        pageCount: input.document.pageCount,
      });
    }
    if (input.renderPageProvider == null) {
      throw new InvalidInputError("renderPageProvider debe estar poblado.", {
        documentId: input.documentId,
      });
    }
    const { dpi, imageFormat, jpegQuality } = input.options;
    if (!(dpi > 0) || dpi > 600) {
      throw new InvalidInputError(`options.dpi debe estar en (0, 600]. Recibido: ${dpi}.`, {
        documentId: input.documentId,
        dpi,
      });
    }
    if (imageFormat === "jpeg" && (jpegQuality < 0.5 || jpegQuality > 1)) {
      throw new InvalidInputError(
        `options.jpegQuality debe estar en [0.5, 1] para JPEG. Recibido: ${jpegQuality}.`,
        { documentId: input.documentId, jpegQuality },
      );
    }
  }

  private async exportPage(
    input: ExportEngineInput,
    ctx: EngineContext,
    pageIndex: number,
    timeoutMs: number,
  ): Promise<void> {
    const page = input.document.pages[pageIndex];
    if (page === undefined) {
      throw new InvalidInputError(
        `document.pages[${pageIndex}] no existe (pageCount=${input.document.pageCount}).`,
        { documentId: input.documentId, pageIndex },
      );
    }

    const replacements = buildPageReplacements(pageIndex, input.groups);

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(input.documentId);
      }
      try {
        const pageImage = await renderPageWithTimeout(
          input.renderPageProvider,
          pageIndex,
          replacements,
          ctx.abortSignal,
          input.documentId,
          timeoutMs,
        );

        if (ctx.abortSignal.aborted) {
          throw new CancelledError(input.documentId);
        }

        // ADR-047 §1/§3: solo la frontera pdf-lib cruza al worker
        // (`append-page`), vía el puerto `ExportJobPool`. `maxRetriesOverride:
        // 0` — el pool nunca reintenta un `export-page`; el único loop de
        // retry es este. La idempotencia por `pageIndex` del ensamblador
        // (ADR-047 §4) reemplaza al guard `pageCountBeforeAttempt` que tenía
        // este método antes de ADR-047.
        const payload: ExportPagePayload = {
          documentId: input.documentId,
          pageIndex,
          pageImage: pageImage.bytes,
          imageFormat: pageImage.format,
          pageWidthPt: page.width,
          pageHeightPt: page.height,
        };

        // ADR-055: `dispatch()` devuelve `Promise<unknown>`, pero acá nunca se
        // liga el valor resuelto — ni `null` (remoto) ni `undefined`
        // (in-process, ver `dispatchAppendPage`) se leen jamás (nota de
        // cabecera del archivo). Sin decoder por diseño: nada que un guard
        // pudiera proteger.
        await withDispatchTimeout(
          () =>
            this.pool.dispatch({
              run: () => this.dispatchAppendPage(payload, ctx.abortSignal),
              signal: ctx.abortSignal,
              payload,
              maxRetriesOverride: 0,
            }),
          timeoutMs,
          () => new ExportTimeoutError(input.documentId, pageIndex, timeoutMs),
        );

        return;
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        lastError = normalizeExportError(err, input.documentId, timeoutMs, pageIndex);
      }
    }

    const failure = this.toExportFailure(input.documentId, pageIndex, lastError);
    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, {
      documentId: input.documentId,
      error: failure.serialize(),
    });
    throw failure;
  }

  /** `run()` del fallback in-process para `append-page`: invoca el ensamblador directo y reasigna el estado local (ADR-035, bit-idéntico). */
  private async dispatchAppendPage(
    payload: ExportPagePayload,
    abortSignal: AbortSignal,
  ): Promise<void> {
    const { appendPage } = await loadAssembler();
    this.assemblerState = await appendPage(this.assemblerState, payload, { abortSignal });
  }

  /**
   * ADR-059 §2/§3/§6, checklist ítems 26-29: `undefined` cuando el flag está
   * apagado o cuando, tras filtrar por tipo/modo, no queda ninguna fila
   * (caso 23 — warn, sin página, `renderLegend` nunca se invoca).
   */
  private async buildLegendPayload(
    input: ExportEngineInput,
    ctx: EngineContext,
    timeoutMs: number,
  ): Promise<LegendPayloadFields | undefined> {
    if (!input.options.includeMarkerLegend) return undefined;

    const entries = buildMarkerLegendEntries(input.groups);
    if (entries.length === 0) {
      ctx.logger.warn(
        "includeMarkerLegend activo pero ningún grupo placeholder habilitado; no se agrega la página de leyenda.",
        { documentId: input.documentId },
      );
      return undefined;
    }

    // document.pages[0] ya está garantizado por validateInput (pageCount > 0);
    // este guard cubre solo la inconsistencia de datos "pageCount > 0 pero
    // pages vacío", no una entrada de usuario.
    const firstPage = input.document.pages[0];
    if (firstPage === undefined) {
      throw new InvalidInputError(
        `document.pages[0] no existe pese a pageCount=${input.document.pageCount}.`,
        { documentId: input.documentId },
      );
    }

    const rows = buildMarkerLegend(entries);
    const legendImage = await this.renderLegendWithRetry(input, ctx, rows, timeoutMs);

    return {
      legendImage,
      legendPageWidthPt: firstPage.width,
      legendPageHeightPt: firstPage.height,
    };
  }

  /**
   * Mismo patrón de retry que `exportPage` (spec §14: "renderLegend failure
   * retries and then fails the export"). Sin `pageIndex`: la leyenda no es
   * una página del documento.
   */
  private async renderLegendWithRetry(
    input: ExportEngineInput,
    ctx: EngineContext,
    rows: ReadonlyArray<MarkerLegendRow>,
    timeoutMs: number,
  ): Promise<EncodedPageImage> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(input.documentId);
      }
      try {
        return await renderLegendWithTimeout(
          input.renderPageProvider,
          rows,
          ctx.abortSignal,
          input.documentId,
          timeoutMs,
        );
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        lastError = normalizeExportError(err, input.documentId, timeoutMs);
      }
    }

    const failure = this.toExportFailure(input.documentId, undefined, lastError);
    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, {
      documentId: input.documentId,
      error: failure.serialize(),
    });
    throw failure;
  }

  private async saveWithRetry(
    documentId: string,
    ctx: EngineContext,
    metadata: ExportMetadata,
    timeoutMs: number,
    legend: LegendPayloadFields | undefined,
  ): Promise<ArrayBuffer> {
    const payload: ExportSavePayload = {
      documentId,
      metadata,
      ...(legend !== undefined
        ? {
            legendImage: legend.legendImage,
            legendPageWidthPt: legend.legendPageWidthPt,
            legendPageHeightPt: legend.legendPageHeightPt,
          }
        : {}),
    };
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(documentId);
      }
      try {
        // §12: "Tamaño del PDF... mitigado con save({ useObjectStreams: true })".
        // ADR-047 §1/§3: la serialización cruza al worker vía el mismo puerto
        // (`save`), con `maxRetriesOverride: 0` — este es el único loop de retry.
        const dispatchResult = await withDispatchTimeout(
          () =>
            this.pool.dispatch({
              run: () => this.dispatchSave(payload, ctx.abortSignal),
              signal: ctx.abortSignal,
              payload,
              maxRetriesOverride: 0,
            }),
          timeoutMs,
          () =>
            new ExportFailedError(
              documentId,
              `Timeout esperando el save() del worker (${timeoutMs}ms).`,
            ),
        );
        // ADR-055 §2: `dispatchResult` es `unknown` — `decodeSaveResult` es el
        // único paso permitido antes de tratarlo como el ArrayBuffer final
        // (nunca un cast a ciegas).
        return decodeSaveResult(dispatchResult, documentId);
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        lastError = normalizeExportError(err, documentId, timeoutMs);
      }
    }

    const failure = this.toExportFailure(documentId, undefined, lastError);
    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, {
      documentId,
      error: failure.serialize(),
    });
    throw failure;
  }

  /** `run()` del fallback in-process para `save`: invoca el ensamblador directo, reasigna el estado local (vacío tras éxito, ADR-047 §4) y devuelve el `ArrayBuffer` final. */
  private async dispatchSave(
    payload: ExportSavePayload,
    abortSignal: AbortSignal,
  ): Promise<ArrayBuffer> {
    const { savePdf } = await loadAssembler();
    const { buffer, state } = await savePdf(this.assemblerState, payload, { abortSignal });
    this.assemblerState = state;
    return buffer;
  }

  private toExportFailure(
    documentId: string,
    pageIndex: number | undefined,
    err: unknown,
  ): ExportFailedError | ExportTimeoutError {
    if (err instanceof ExportTimeoutError || err instanceof ExportFailedError) return err;
    const reason = err instanceof Error ? err.message : String(err);
    return new ExportFailedError(documentId, reason, pageIndex !== undefined ? { pageIndex } : {});
  }

  private assertInitialized(): void {
    if (!this.initialized || this.ctx === null) {
      throw new EngineNotInitializedError(EngineId.Export);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineDisposedError(EngineId.Export);
    }
  }
}
