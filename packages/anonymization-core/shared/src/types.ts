/**
 * @anonly/shared — Modelos de datos del Core.
 *
 * Fuente de verdad semántica: docs/architecture/03_Data_Model.md.
 * Fuente de verdad de tipos: docs/core/Contracts.md §5.
 *
 * Todos los tipos son inmutables: `readonly` en props, `ReadonlyArray<T>` en colecciones.
 * Ver ADR-008-Immutability.md.
 */

import type {
  AnnotationKind,
  ConflictReason,
  DetectionSource,
  EntityType,
  PersonGender,
  PipelineStage,
  ReplacementMode,
  RuleScope,
  WorkerJobType,
} from "./enums.js";
// Import type-only circular con interfaces.ts (que ya importa WorkerCapabilities
// desde este archivo): ambos son `import type`, se erosionan por completo en
// runtime (verbatimModuleSyntax/isolatedModules), sin ciclo de módulos JS real.
import type { NerWasmPaths } from "./interfaces.js";

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * ADR-066 §6 (supersede ADR-063 §5): dirección en la que corre el texto que
   * ocupa esta caja. **Ausente ≡ 0**, así que todo `BoundingBox` previo sigue
   * siendo válido y se pinta igual que antes.
   *
   * NO cambia la geometría: el rectángulo sigue siendo axis-aligned y sigue
   * siendo exacto para los cuatro ángulos rectos (ADR-063 §2). Solo le dice a
   * quien dibuja adentro cómo orientar el texto — `render-engine` rota el
   * contexto en 90/270 (ADR-066 §7). Para ángulos arbitrarios el campo queda
   * ausente: ahí el rectángulo es la envolvente conservadora de ADR-063 §2, no
   * la caja real del texto (ADR-066 §8).
   *
   * Va acá y no en `Word` porque es lo que viaja por la cadena
   * `Word → Occurrence → Replacement` sin tocar tres tipos: `mapSpanToWords`
   * une bboxes y el campo viaja con ellos.
   */
  readonly rotation?: 0 | 90 | 180 | 270;
}

/**
 * ADR-091 §1 (`Contracts.md` §5) — léxico de nombres de pila. Valor por
 * nombre: determinado (`"f"`/`"m"`) o `"ambiguous"`, que es el nombre marcado
 * `A` (unisex) en el registro de Buenos Aires (ADR-069 §1).
 *
 * Las claves están **pre-normalizadas** con `normalizeForComparison`: quien
 * construye un `GenderLexicon` normaliza antes de insertar.
 *
 * Vive acá y no en un motor porque tiene dos consumidores que no pueden
 * importarse entre sí (P-1/P-2): `grouping-engine` lo usa para inferir el
 * género del reemplazo (ADR-060 §4) y `regex-engine` como compuerta de nombre
 * propio del patrón de carátula. Lo que se comparte es el **dato**; la
 * política de cómo interpretarlo (`inferPersonGender`) se queda en Grouping.
 */
export type GenderLexiconLabel = "f" | "m" | "ambiguous";
export type GenderLexicon = ReadonlyMap<string, GenderLexiconLabel>;

export interface WordSpan {
  readonly startIndex: number;
  readonly endIndexExclusive: number;
}

export interface Word {
  readonly text: string;
  readonly bbox: BoundingBox;
  readonly pageIndex: number;
  readonly confidence: number;
  readonly source: "pdf" | "ocr";
}

export interface Page {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly words: ReadonlyArray<Word>;
  readonly text: string;
  readonly requiresOCR: boolean;
  readonly ocrCompleted: boolean;
  readonly dpi?: number;
}

/**
 * Región de una página que `pdf-engine` marca para OCR **aunque la página
 * tenga texto nativo** (ADR-065 §4): una imagen cuyo interior ningún texto
 * explica. Semántica completa en `03_Data_Model.md` §4.1.
 *
 * `bbox` va en puntos de página, origen arriba-izquierda — el mismo espacio
 * que cualquier otro `BoundingBox`.
 *
 * Invariante: ningún `pageIndex` de `PdfEngineOutput.ocrRegions` aparece en
 * `PdfEngineOutput.textlessPages`. Son los dos caminos de OCR y son disjuntos:
 * la página sin texto nativo va entera, la página con texto nativo va por
 * región.
 */
export interface OcrRegion {
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
}

export interface DocumentMetadata {
  readonly title?: string;
  readonly producer?: string;
  readonly creationTool?: string;
  readonly pdfVersion: string;
  readonly encrypted: boolean;
  readonly hasForms: boolean;
}

export type DocumentSourceKind = "text" | "scanned" | "mixed";

export interface Document {
  readonly id: string;
  readonly name: string;
  readonly pageCount: number;
  readonly pages: ReadonlyArray<Page>;
  readonly metadata: DocumentMetadata;
  readonly sourceKind: DocumentSourceKind;
  readonly importedAt: number;
}

/**
 * ADR-105: la frase que rodea a una ocurrencia. La UI arma
 * `…{before}` **{value}** `{after}…` sin aritmética — el valor NO se repite
 * acá, ya viaja en `Occurrence.value` / `OccurrenceRef.value` (ADR-104).
 *
 * Dos cadenas y no una con offsets: la alternativa obliga a cada consumidor a
 * recortar bien, y un off-by-one ahí parte una palabra en pantalla.
 */
export interface OccurrenceContext {
  readonly before: string;
  readonly after: string;
}

export interface Occurrence {
  readonly id: string;
  readonly value: string;
  readonly normalizedValue: string;
  readonly bbox: BoundingBox;
  readonly pageIndex: number;
  readonly source: DetectionSource;
  readonly confidence: number;
  readonly entityType: EntityType;
  /** Formato de máscara del patrón que matcheó (Regex lo copia de `RegexPattern.maskFormat`; ausente en NER). ADR-029. */
  readonly maskFormat?: string;
  readonly wordSpan?: WordSpan;
  /**
   * ADR-074 §1: descomposición de `bbox` en un rectángulo por línea, para
   * una entidad cuyas `Word` caen en más de un renglón (un nombre partido al
   * final de una línea). `bbox` sigue siendo la envolvente y conserva todos
   * sus usos actuales — orden documental, conflictos, hit-test — sin
   * excepción. **Ausente ≡ `[bbox]`**, misma convención que `rotation`
   * (ADR-066 §6): el caso de una sola línea (la inmensa mayoría) no lleva el
   * campo. Cuando está presente, `fragments.length ≥ 2` siempre — un array
   * de un elemento sería la envolvente escrita dos veces. Invariantes:
   * `bbox` es la unión exacta de `fragments`, ninguno se solapa
   * verticalmente, y `union(fragments) ⊆ bbox` (la superficie tapada solo
   * puede achicarse). No se emite sobre texto rotado (`bbox.rotation`
   * presente/discrepante): ver `Regex_Engine.md`/`NER_Engine.md` §10.
   */
  readonly fragments?: ReadonlyArray<BoundingBox>;
  /**
   * ADR-105: la frase alrededor, para distinguir apariciones del **mismo**
   * valor. Opcional al revés que `value`: una ocurrencia puede nacer sin
   * texto alrededor (agregado manual, página de una sola palabra), y forzar
   * una cadena vacía obligaría a distinguir "no hay" de "está vacío".
   */
  readonly context?: OccurrenceContext;
}

export interface OccurrenceRef {
  readonly occurrenceId: string;
  /**
   * ADR-104: cómo aparece en el documento, **sin normalizar**. Copiado tal
   * cual de `Occurrence.value`.
   *
   * `OccurrenceRef` duplica lo que la UI necesita sin resolver
   * (`03_Data_Model.md` §8, mismo criterio que `bbox`), y esto lo necesita el
   * separador: existe para deshacer una fusión, y sin el valor no hay con qué
   * distinguir a los miembros de un grupo fusionado salvo la página.
   */
  readonly value: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly source: DetectionSource;
  /** ADR-074 §1/§2: copiado tal cual de `Occurrence.fragments` por `toOccurrenceRef`. Misma semántica: ausente ≡ `[bbox]`. */
  readonly fragments?: ReadonlyArray<BoundingBox>;
  /** ADR-105: copiado tal cual de `Occurrence.context`. */
  readonly context?: OccurrenceContext;
}

export interface EntityGroup {
  readonly id: string;
  readonly type: EntityType;
  readonly canonicalValue: string;
  readonly members: ReadonlyArray<OccurrenceRef>;
  readonly replacementMode: ReplacementMode;
  readonly replacementValue: string;
  readonly indexInType: number;
  readonly enabled: boolean;
  readonly aliases: ReadonlyArray<string>;
  /** Solo para type === Person. Ausente = sin determinar (ADR-060 §4). */
  readonly personGender?: PersonGender;
  /**
   * ADR-078 §1: `true` si el `replacementValue` de arriba lo escribió el
   * usuario, y por lo tanto ADR-076 §3 lo protege de todo recálculo
   * automático. NO opcional — no hay "sin determinar".
   *
   * De solo lectura: no entra en `GroupUpdatePatch`. Para volver al valor
   * calculado se re-aplica el mismo `replacementMode` (ADR-078 §3), que ya
   * recalcula y apaga el flag.
   *
   * Sale del motor porque su valor asociado **no delata su procedencia**:
   * `[P1]` escrito a mano y `[P1]` calculado son idénticos. Por eso
   * `personGenderUserSet` sigue siendo interno — ahí el valor sí delata
   * (quien eligió "femenino" lee `[MUJER 01]`). Regla en ADR-078 §2.
   */
  readonly replacementValueUserSet: boolean;
  /**
   * ADR-094 §4 (`Contracts.md` §5) — `true` en un grupo que el detector
   * **sugirió sin estar seguro**: una ocurrencia de NER por debajo del
   * `confidenceThreshold` que no encontró grupo candidato, y que hasta
   * ADR-094 se descartaba en silencio con un `warn` a un logger nulo.
   *
   * Nace junto con `enabled: false`, así que el grupo **no tapa nada** hasta
   * que el usuario lo habilite: esto cambia qué se le muestra, no qué se
   * anonimiza.
   *
   * Booleano y no la `confidence`, a propósito: quien revisa un expediente
   * necesita saber a qué prestarle atención, no qué tan segura estaba la red.
   *
   * Se apaga solo al **promover** (ADR-094 §3): si después entra al grupo una
   * ocurrencia que no es de baja confianza, pasa a `enabled: true` y
   * `needsReview: false`. Sin esa regla un grupo sugerido absorbería una
   * detección confiable posterior y se quedaría apagado.
   */
  readonly needsReview: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Entrada de `synthesize()` (Contracts.md §5, ADR-072 §2). Objeto y no
 * posicionales porque `groupId` y `seed` son dos `string` adyacentes: como
 * posicionales, intercambiarlos compila sin error y el resultado se imprime
 * en un documento.
 */
export interface SyntheticRequest {
  readonly type: EntityType;
  /**
   * ADR-072 §1: la SEMILLA del sorteo es la identidad del grupo
   * (`EntityGroup.id`), no su número. `indexInType` es un ordinal que la
   * renumeración canónica mueve (ADR-028), y sembrar sobre él hacía que el
   * valor sintético de un grupo cambiara por operaciones ajenas a ese grupo.
   */
  readonly groupId: string;
  /** Aleatorio por sesión, lo genera el Grouping Engine (ADR-012 §SAN, ADR-019 §5). */
  readonly seed: string;
  /**
   * ADR-072 §3: solo lo leen los tipos cuyo valor INTERPOLA el número del
   * grupo (`Custom` → `custom-3`). Los tipos que sortean no lo miran.
   */
  readonly indexInType: number;
  /**
   * ADR-071 §5: solo se consulta sobre `type === Person`. Filtra el pool de
   * nombres de pila; NO entra a la semilla, así que ausente produce el mismo
   * valor que produciría sin el campo.
   */
  readonly personGender?: PersonGender;
}

export interface Replacement {
  readonly groupId: string;
  readonly occurrenceId: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly originalValue: string;
  readonly replacementValue: string;
  readonly mode: ReplacementMode;
  /** ADR-074 §1/§4: copiado de `Occurrence.fragments` por `buildPageReplacements`. `render-engine` pinta por `fragments ?? [bbox]`, nunca la envolvente sola. */
  readonly fragments?: ReadonlyArray<BoundingBox>;
}

// Entrada de IPipelineOrchestrator.addManualEntity (ADR-061 §3/§6).
export interface ManualEntityRequest {
  readonly value: string;
  readonly entityType: EntityType;
}

// Salida de IPipelineOrchestrator.findText — misma búsqueda literal que
// ManualEntityRequest, con otra salida (ADR-061 §8).
export interface TextMatch {
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly text: string;
  readonly wordSpan: WordSpan;
}

export interface RuleTarget {
  readonly kind: RuleScope;
  readonly groupId?: string;
  readonly entityType?: EntityType;
}

export interface Rule {
  readonly id: string;
  readonly scope: RuleScope;
  readonly target: RuleTarget;
  readonly mode: ReplacementMode;
  readonly priority: number;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Annotation {
  readonly id: string;
  readonly groupId: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly kind: AnnotationKind;
}

export interface ConflictCandidate {
  readonly source: DetectionSource;
  readonly entityType: EntityType;
  readonly confidence: number;
  readonly value: string;
}

export interface Conflict {
  readonly id: string;
  readonly groupId: string;
  readonly reason: ConflictReason;
  readonly candidates: ReadonlyArray<ConflictCandidate>;
  readonly resolved: boolean;
  /**
   * ADR-083 §3: el tipo con el que el usuario resolvió el conflicto. Antes
   * era `resolvedMode?: ReplacementMode`, que registraba una elección que no
   * tenía nada que ver con el desacuerdo (el conflicto es sobre QUÉ es la
   * entidad; el modo de reemplazo se elige en la fila del grupo).
   */
  readonly resolvedType?: EntityType;
}

export interface PipelineError {
  readonly stage: PipelineStage;
  readonly code: string;
  readonly message: string;
  readonly documentId: string;
}

export interface PipelineState {
  readonly documentId: string;
  readonly stage: PipelineStage;
  readonly progress: number;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly errors: ReadonlyArray<PipelineError>;
  readonly cancelRequested: boolean;
}

export interface WorkerJob {
  readonly id: string;
  readonly type: WorkerJobType;
  readonly payload: WorkerJobPayload;
  readonly priority: number;
  readonly signalId: string;
  readonly createdAt: number;
  readonly retries: number;
  readonly maxRetries: number;
  readonly timeoutMs: number;
}

export type WorkerJobPayload =
  | PdfParsePayload
  | OcrPagePayload
  | NerPagePayload
  | RenderPagePayload
  | ExportPagePayload;

export interface PdfParsePayload {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;
  readonly password?: string;
  readonly pageRange?: ReadonlyArray<number>;
}

export interface OcrPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  // Errata corregida (ADR-036 §4): era ArrayBuffer, que no transporta
  // width/height y el OcrWorker no puede reconstruir la imagen. Coincide con
  // OcrPageInput del motor (03_Data_Model.md §18). Transferencia:
  // postMessage(msg, [imageData.data.buffer]).
  readonly imageData: ImageData;
  readonly dpi: number;
  readonly languages: ReadonlyArray<string>;
}

// ADR-046 §3/§5: `text` es el texto de UN BATCH de NerConfig.batchSize
// palabras (la partición la hace NerEngine host-side, que es quien tiene las
// Word[] para el bbox; ADR-024 §2). `quantization` y `wasmPaths` viajan en el
// job porque el kernel es quien carga el modelo y configura Transformers.js
// contra el origen propio (ADR-039), y WorkerPool todavía no transporta INIT
// con la config real.
export interface NerPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly text: string;
  readonly modelId: string;
  readonly quantization: "q8" | "q4" | "f32";
  readonly wasmPaths?: string | NerWasmPaths;
}

export interface RenderPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly mode: "preview" | "full";
  readonly replacements?: ReadonlyArray<Replacement>;
  readonly annotations?: ReadonlyArray<Annotation>;
  readonly scale?: number;
  readonly imageFormat?: "png" | "jpeg";
  // ADR-058 §5: palabras que comparten línea con algún reemplazo de esta página,
  // seleccionadas host-side por una función pura del Orchestrator desde Page.words
  // (precedente de reparto: fuseOcrPage, ADR-041). El kernel las usa para calibrar
  // la tipografía y reposicionar la línea al repintarla.
  // Se adjuntan SOLO cuando algún token podría no entrar (estimado con
  // estimateTokenWidth, ADR-057 §5, con margen conservador). Ausente es el caso
  // normal y nunca es un error: sin ellas el kernel cae al shrink-to-fit de
  // ADR-058 §1. Incluye palabras de OCR (source: "ocr") igual que las de PDF.
  readonly lineWords?: ReadonlyArray<Word>;
}

// ADR-047 §3: forma completa (reemplaza la anterior, inejecutable sin
// `imageFormat`/dimensiones en puntos PDF — el worker no podía decidir
// embedJpg vs embedPng ni crear la página). `metadata` se movió a
// `ExportSavePayload`: se aplica una sola vez, al final, no en cada página.
export interface ExportPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly pageImage: ArrayBuffer; // EncodedPageImage.bytes, transferido
  readonly imageFormat: "png" | "jpeg";
  readonly pageWidthPt: number; // document.pages[i].width
  readonly pageHeightPt: number; // document.pages[i].height
}

// Job final del ExportWorker bajo jobType "export-page" (ADR-047 §3/§4):
// aplica la metadata (ya sanitizada en host) y su COMPLETED devuelve el
// ArrayBuffer del PDF transferido; DISPOSE solo libera (05 §7.5, ADR-036
// §4). El entry-point discrimina append vs save por forma:
// `"pageImage" in payload` (ADR-047 §3) — mismo criterio que ADR-043 §4 para
// `render-page`. No agrega un `WorkerJobType` nuevo (viaja bajo
// "export-page", igual que `ExportPagePayload`).
export interface ExportSavePayload {
  readonly documentId: string;
  readonly metadata: ExportMetadata;
  // ADR-059 §6: página de leyenda YA RASTERIZADA (la produce render-engine vía
  // RenderPageProvider.renderLegend, mediado por el Orchestrator). El assembler la
  // embebe con embedPng/embedJpg + addPage + drawImage, igual que una página del
  // documento — el export sigue siendo 100% imagen, sin excepciones.
  // Ausente cuando ExportOptions.includeMarkerLegend === false, o cuando no quedó
  // ninguna fila tras el filtro de §2 (en ese caso no se agrega página).
  // Viaja en `save` y no en `append-page` porque se aplica una sola vez al final,
  // igual que la metadata (ADR-047 §3), y no tiene pageIndex del que ser idempotente.
  readonly legendImage?: EncodedPageImage;
  readonly legendPageWidthPt?: number;
  readonly legendPageHeightPt?: number;
}

// ─── Payloads del transporte real de RenderWorker (Hito 10, ADR-036 §4 /
// ADR-043 §4) que NO agregan `WorkerJobType` nuevo: viajan como `RUN` con
// `jobType: "render-page"` directo a cada worker, sin cola (por eso tienen
// `jobId`/`COMPLETED` igual que un job). El entry-point discrimina el payload
// de "render-page" por FORMA, en este orden exacto (ADR-043 §4): `"buffer" in
// payload` -> load; `"kind" in payload` -> render (`RenderPagePayload`, ya
// definido arriba); `"pageIndex" in payload` -> rasterize; si no -> unload. ───

/**
 * Mensaje de control broadcast a cada RenderWorker (no es un job encolable).
 * El `buffer` se CLONA por worker (nunca se transfiere: transferirlo vaciaría
 * el original retenido por el host — `05_Worker_Architecture.md` §2.3/§7.4,
 * ADR-030).
 *
 * `password` (ADR-050): password de un PDF protegido, opcional. El kernel lo
 * usa en `getDocument({ data, password })` y NO lo retiene — una vez abierto
 * el `PDFDocumentProxy`, no se vuelve a necesitar. El host sí lo retiene,
 * junto a `{ buffer, pageCount }`, para re-primear workers nuevos o
 * reemplazados (ADR-043 §5). Nunca en logs ni eventos (`08_Security_Model.md`
 * §6, enmendada por ADR-050 §3).
 */
export interface LoadDocumentPayload {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;
  readonly password?: string;
}

/**
 * Control broadcast simétrico a `LoadDocumentPayload` (ADR-043 §4): libera el
 * `PDFDocumentProxy` de ese documento en cada RenderWorker a mitad de sesión
 * (`DOCUMENT_CLOSED`). Idempotente, sin transfer.
 */
export interface UnloadDocumentPayload {
  readonly documentId: string;
}

/**
 * Rasterización para OCR (ADR-034 §1). Viaja bajo `jobType: "render-page"`,
 * prioridad 90/40 (espejo de `ocr-page`), timeouts/retries de `render-page`.
 */
export interface RasterizePagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly scale: number;
  // ADR-065 §5: recorte a rasterizar, en PUNTOS de página (mismo espacio que
  // cualquier BoundingBox). Ausente = página entera, que es el flujo de OCR de
  // páginas textless y no cambia. Va acá y no en un tipo local de
  // render-engine, mismo criterio que `lineWords` en RenderPagePayload
  // (ADR-058 §5): la forma que cruza el postMessage se declara en un solo
  // lugar, porque `05_Worker_Architecture.md` §7.4 documenta el wire shape de
  // `RUN(render-page)` enumerando sus campos.
  readonly region?: BoundingBox;
}

// Página de leyenda del export (ADR-059 §5). Viaja bajo jobType "render-page",
// sin WorkerJobType nuevo, y es el QUINTO caso de la discriminación por forma del
// entry-point (ADR-043 §4) — se reconoce por `"rows" in payload`.
// Es el único payload de render-page SIN documentId: no corresponde a ninguna
// página de ningún PDF, es un dibujo puro sobre un OffscreenCanvas en blanco.
// Sin pageProxy, sin pdfjs, sin cache LRU, sin supersede, sin eventos — mismo
// perfil que RasterizePagePayload (ADR-034 §1).
export interface RenderLegendPayload {
  readonly rows: ReadonlyArray<MarkerLegendRow>;
  readonly pageWidthPt: number;
  readonly pageHeightPt: number;
  readonly imageFormat?: "png" | "jpeg";
}

// ADR-059 §3: la entrada de la leyenda NO tiene ningún campo capaz de transportar
// contenido del documento — no hay canonicalValue, no hay originalValue, no hay
// Document. Filtrar un valor original a la leyenda no requiere disciplina del
// implementador: requiere cambiar este tipo. Mismo mecanismo que
// `includeOriginalMetadata: false` de ADR-009 (garantía por tipos, no por convención).
export interface MarkerLegendEntry {
  readonly type: EntityType;
  readonly prefixes: ReadonlyArray<string>; // p. ej. ["PERSONA", "PERS", "PRS"]
  readonly markerCount: number;
}

// ADR-059 §5: lo que efectivamente cruza a render-engine. Strings YA COMPUESTOS:
// el kernel dibuja texto y no ve EntityType ni EntityGroup, así que no gana ninguna
// dependencia semántica sobre el dominio de entidades. La proyección
// MarkerLegendEntry -> MarkerLegendRow vive host-side (buildMarkerLegend).
export interface MarkerLegendRow {
  readonly prefixes: string; // "PERSONA, PERS, PRS"
  readonly typeName: string; // "Persona" (label de nivel 0 de ADR-057 §2, en título)
  readonly countLabel: string; // "7 marcadores"
}

// Salida del kernel del NerWorker (COMPLETED { spans }, ADR-046 §1): spans de
// entidad ya agregados desde los tokens BIO, con offsets relativos al texto
// del batch. Sin bbox, sin wordSpan y sin id: el mapeo a Occurrence lo hace
// NerEngine en el host, que es quien tiene las Word[] de la página.
export interface NerKernelSpan {
  readonly entityType: EntityType;
  readonly value: string;
  readonly normalizedValue: string;
  readonly confidence: number;
  readonly startIndex: number;
  readonly endIndexExclusive: number;
}

// Ciclo de vida del modelo NER reportado por el kernel en PROGRESS.partial
// (ADR-046 §4): telemetría de transporte, NO eventos de dominio. El motor la
// traduce en host a NER_MODEL_LOADING / NER_MODEL_READY (uno por instancia) /
// logger.warn. El fraction de descarga viaja en PROGRESS.progress ∈ [0,1].
export type NerKernelProgress =
  | { readonly phase: "model-loading"; readonly modelId: string }
  | { readonly phase: "model-ready"; readonly modelId: string }
  | { readonly phase: "model-load-retry"; readonly modelId: string; readonly reason: string };

export interface ExportOptions {
  readonly imageFormat: "png" | "jpeg";
  readonly jpegQuality: number;
  readonly dpi: number;
  readonly includeOriginalMetadata: false;
  readonly title?: string;
  readonly filename: string;
  // ADR-059 §1: página final con la referencia `prefijo → tipo` de los marcadores
  // que ADR-057 pudo abreviar. Default false: sin el flag, el export no cambia en
  // nada. Con el flag, el PDF tiene document.pageCount + 1 páginas.
  readonly includeMarkerLegend: boolean; // default false
}

export interface ExportMetadata {
  readonly producer: "Anonly";
  readonly creator: "Anonly";
  readonly creationDate: Date;
  readonly title?: string;
}

export interface WorkerCapabilities {
  readonly maxPageBatchSize: number;
  readonly languages?: ReadonlyArray<string>;
  readonly modelVersion?: string;
}

/**
 * Imagen de página codificada (PNG/JPEG), lista para `embedPng`/`embedJpg` de
 * pdf-lib. Definida originalmente en `export-engine` (ADR-032 §1) y promovida
 * a `@anonly/shared` al aparecer el segundo consumidor: Render la produce
 * (`RenderPageOutput.encoded`), Export la consume
 * (`RenderPageProvider.renderFull`), el Orchestrator la transporta
 * (ADR-034 §3). Fuente de verdad: Contracts.md §7.
 */
export interface EncodedPageImage {
  readonly bytes: ArrayBuffer; // imagen codificada (PNG o JPEG)
  readonly format: "png" | "jpeg";
  readonly widthPx: number;
  readonly heightPx: number;
}
