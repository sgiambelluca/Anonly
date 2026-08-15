<!-- CONTEXT: scope=export-engine | dependencias=core/Contracts.md,architecture/06_Pipeline.md,ADR-004-Rendering.md,ADR-009-Export-Strategy.md,ADR-012-Replacement-Modes.md,ADR-032-Export-EncodedPageImage-Requested-Warning.md,ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-047-ExportEngine-Ensamblador-Worker-Dedicado.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md | audiencia=IA-implementador | fase=10 (fase 10.9: `buildPageReplacements` propaga `Replacement.fragments` —ADR-074 §1, el último salto de la cadena—, §15 ítem 16b; §12 corregido en fase 10: ExportWorker único, no RenderPool — ADR-036 §1; §15.16: export de `buildPageReplacements` — ADR-044 §4; §2/§6/§12/§13/§14/§15 por ADR-047: ensamblado pdf-lib en el worker, motor host-side dueño de su despacho; §9/§10/§13/§14/§15 en fase 10.5: leyenda opcional de marcadores, ADR-059; fase 10.6: §13 caso 22 y §14 —la leyenda absorbe los prefijos de género sin tocar `buildMarkerLegend`, ADR-060 §8—, y §4 + §"Sintetizadores (referencia)" —este motor NO consume `shared/synthesizer.ts`: el valor llega resuelto en `Replacement.replacementValue`, ADR-072 §2—) -->

# Export Engine — Spec de Motor

> Construye el PDF final reconstruido desde cero, adjuntando las imágenes renderizadas (lado anonimizado) como páginas con pdf-lib. Garantiza no-recuperabilidad y metadata mínima.

**EngineId**: `export`
**Versión del spec**: 1.3.0
**Última actualización**: 2026-08-06

> **Nota (v1.3.0, ADR-059, 2026-08-06 — leyenda opcional de marcadores)**: `ExportOptions` gana `includeMarkerLegend: boolean` (default `false`). Con el flag, el `save` agrega una **página final** con la referencia `prefijo → tipo` de los marcadores que ADR-057 pudo abreviar — `MAT` y `PAT` no se leen solos, y son matrícula y patente. **Regla dura: `token → tipo`, nunca `token → valor original`**, garantizada **por tipo** y no por convención: `MarkerLegendEntry` no tiene ningún campo capaz de transportar contenido del documento, así que filtrar un dato exige cambiar el contrato (mismo mecanismo que `includeOriginalMetadata: false`). **La leyenda se rasteriza como cualquier otra página**: este motor no tiene canvas, así que la imagen se pide por `RenderPageProvider.renderLegend` —el puerto que ya existía para pedirle imágenes a Render, mediado por el Orchestrator (P-1)— y se embebe con `embedPng`/`embedJpg` + `addPage` + `drawImage`. Se evaluó dibujarla con `drawText` de pdf-lib, que era mucho más barato, y **se rechazó** para no romper que el export sea 100% imagen: esa propiedad se audita en un segundo, mientras que una sola capa de texto convierte la auditoría en un juicio sobre su contenido. Consecuencia: ADR-004 y ADR-009 quedan intactos, sin erratas ni salvedades. Va en el `save` y no en `appendPage` —se aplica una vez al final, igual que la metadata, y no tiene `pageIndex` del que ser idempotente—. Sin el flag, el export no cambia en nada. Ver §6, §9, §13 casos 21-25 y §14, incluidos los dos tests de `tests/security/`.

> **Nota (ADR-047, 2026-07-24 — reparto host/worker para PR16)**: `export()` queda **entero host-side** (validación, loop por página, `RenderPageProvider`, retry/timeout, los cuatro eventos, sanitización de `title`/`filename` y la creación del blob URL). Al ExportWorker cruzan **dos operaciones de pdf-lib**: `append-page` (`embedJpg`/`embedPng` + `addPage` + `drawImage`) y `save` (metadata + `save({ useObjectStreams: true })` → `ArrayBuffer` transferido). A diferencia de Render/Ocr/Ner, este worker **sí retiene estado**: el `PDFDocument` en construcción y el `documentId` al que pertenece — es un **ensamblador de un documento a la vez**, no un kernel puro, porque pdf-lib ensambla incrementalmente y no es thread-safe (§12). Reglas del estado: `documentId` distinto → descarta el parcial y arranca de nuevo; `append-page` con un `pageIndex` ya adjuntado → no-op idempotente (hace seguro el reintento del host y elimina el modo de falla "página duplicada" que el guard `pageCountBeforeAttempt` cubría cuando el `pdfDoc` era local); `CANCEL` descarta el parcial; tras un `save` exitoso, el estado se limpia. El transporte reusa `WorkerPool` con `size: 1` construido por el façade e inyectado por constructor (`new ExportEngine(pool?)`, sin argumento → fallback in-process bit-idéntico, ADR-035), con `maxRetriesOverride: 0` y normalización por `code` de `EXPORT_TIMEOUT`/`EXPORT_FAILED` en el borde del puerto — **matiza** ADR-036 §1 ("sin `WorkerPool`") sin revertir su sustancia: no hay quinta clave en `WorkerPoolConfig` ni cola multi-worker. Interfaz de §6: sin cambios de firma salvo el constructor.

> **Nota (ADR-044 §4, 2026-07-23)**: `buildPageReplacements` (función pura interna: grupos → `Replacement[]` de una página, filtrando `enabled === false`) pasa a exportarse desde `index.ts`: el façade la importa para computar los reemplazos del preview mediado por el Orchestrator con la misma semántica que el export. Sin ningún otro cambio en este motor (§15.16).

> **Nota (ADR-074 §1, 2026-08-15 — `buildPageReplacements` propaga `fragments`)**: `OccurrenceRef` gana `fragments`, la descomposición por línea de una ocurrencia que cruza un salto de renglón (`03_Data_Model.md` §8), y esta función es **el último salto** de la cadena `Word → Occurrence → OccurrenceRef → Replacement`: copia el campo del member al `Replacement`, y un member sin el campo produce un `Replacement` sin el campo. Es una copia de un campo más, pero **se propaga explícitamente y tiene test**, por el precedente de ADR-066 §6: un campo geométrico que "viaja solo" por esta cadena se cayó en silencio una vez y el defecto llegó a prueba manual con todos los gates en verde. Quien **pinta** por fragmento es `render-engine` (ADR-074 §4); este motor solo tiene que no perder el dato. Ningún otro cambio acá — el ensamblado pdf-lib recibe imágenes ya rasterizadas y no mira bboxes.

> **Nota (ADR-032, 2026-07-16)**: `RenderPageProvider.renderFull` devuelve `EncodedPageImage` (bytes codificados; pdf-lib no embebe `ImageData`); `EXPORT_REQUESTED` lo escucha el **Orchestrator**, que llama `export()` directamente (Export no se suscribe a eventos; patrón ADR-014); `EXPORT_NO_ENABLED_GROUPS` es `logger.warn` + continuar, la confirmación del usuario es pre-export. `ExportOptions`/`ExportMetadata` quedan formalizados en `03_Data_Model.md` §19.
>
> **Nota (ADR-034 §3, 2026-07-16)**: `EncodedPageImage` se **promueve a `@anonly/shared`** (apareció el segundo consumidor que ADR-032 anticipó: Render lo produce vía `RenderPageOutput.encoded`). La definición canónica pasa a `Contracts.md` §7 (forma intacta); la de §6 de este spec queda como réplica documental y `export-engine` re-importa el tipo desde shared — cambio de código en el PR del Hito 9 (patrón ADR-029 §4).

> **Nota (ADR-027, 2026-07-11)**: el tipo de config canónico es `ExportConfig` (Contracts.md §6); el alias `ExportEngineConfig` de §6/§15.2 queda eliminado (mismo patrón que ADR-021 §2, ADR-023 §1 y ADR-026).

> **Nota (ADR-021, 2026-07-09)**: este motor se implementa **inline** en su hito, sin crear su pool propio; `WorkerPoolManager` y los pools llegan con el Orchestrator (Hito 9), sin cambio de interfaz pública (precedentes ADR-013/ADR-020). Leer §12 y los ítems de workers/pool del §15 como Hito 9; cancelación cooperativa con checkpoints inline, el SLA < 200 ms se valida en Hito 9/11. Los tests unit/contract/edge mockean la frontera de la librería externa (Code_Standards §10, ADR-021 §5).

---

## 1. Objetivo

Ejecutar el flujo de export al ser invocado por el Orchestrator (que escucha `EXPORT_REQUESTED` y arma el `ExportEngineInput`; ADR-032 §2): coordinar el render full de las páginas anonimizadas, ensamblar un `PDFDocument` nuevo con pdf-lib y devolver un `ArrayBuffer` (transferido) que el host expone como `blobUrl` para descarga.

---

## 2. Responsabilidades

- Ejecutar `export(input)` cuando el Orchestrator lo invoca (el Orchestrator escucha `EXPORT_REQUESTED`; ADR-032 §2).
- Validar que haya al menos un grupo `enabled`; si no, loguear warning (`ctx.logger.warn` con code `EXPORT_NO_ENABLED_GROUPS` en metadata) y continuar (ADR-032 §3).
- Coordinar con `RenderEngine` el render full (`mode = "full"`, `kind = "anonymized"`) de cada página con los `Replacement[]` resueltos.
- Construir un `PDFDocument` vacío con pdf-lib. Hito 8: inline; desde PR16 (ADR-047): en el **ExportWorker** — el `PDFDocument` vive del otro lado de la frontera; el fallback in-process usa el mismo módulo de ensamblado.
- Adjuntar cada imagen renderizada como página (con dimensiones correctas según DPI), vía el mensaje `append-page` (idempotente por `pageIndex`, ADR-047 §4).
- Generar metadata mínima (`ExportMetadata`) sin copiar nada del original — se arma y sanitiza en host y viaja en `ExportSavePayload`, que es donde pdf-lib la aplica.
- Serializar el `PDFDocument` a `ArrayBuffer` y transferirlo al host.
- Emitir `EXPORT_STARTED`, `EXPORT_PROGRESS`, `EXPORT_FINISHED`, `EXPORT_FAILED`.
- Garantizar no-recuperabilidad (sin capas de texto, sin bookmarks, sin JS, sin forms, sin XMP del original).

---

## 3. Fuera de alcance

- Renderizar imágenes (es tarea de `render-engine`; Export las consume).
- Detectar entidades.
- Agrupar ocurrencias.
- Conocer React ni UI.
- Persistir nada.
- Hacer OCR.
- Conservar texto seleccionable (out of scope MVP; ver `roadmap/Version_2.0.md`).

---

## 4. Dependencias permitidas

- `@anonly/shared`
- `pdf-lib` (ADR-001, ADR-009)
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `EntityGroup`, `Replacement`, `ExportOptions`, `ExportMetadata`, `ExportConfig`, `Rule`
- `architecture/04_Event_System.md`: `EXPORT_STARTED`, `EXPORT_PROGRESS`, `EXPORT_FINISHED`, `EXPORT_FAILED` (solo emisión; Export no consume eventos — ADR-032 §2)
- ~~Sintetizadores: `shared/synthesizer.ts` para valores sintéticos deterministas por seed.~~ **Retirado por ADR-072 §2**: este motor nunca lo usó y no debe usarlo. El valor sintético llega ya resuelto en `Replacement.replacementValue`; recomputarlo acá sería una segunda fuente de verdad capaz de discrepar del preview. Ver §"Sintetizadores (referencia)".

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor (Export consume `RenderEngine` por evento/injection, no por import directo)
- `pdfjs-dist`, `tesseract.js`, `@huggingface/transformers`, `onnxruntime-web`
- Node builtins (`fs`, `http`), libs de network

> Nota: Export no importa `render-engine` directamente. Recibe las imágenes renderizadas vía un contrato con el Orchestrator (que sí conoce ambos). Ver §6.

---

## 6. Interfaces públicas

```ts
// ExportConfig es el tipo canónico de Contracts.md §6 (re-exportado por @anonly/shared);
// se reproduce aquí solo para documentar sus defaults (ADR-027).
export interface ExportConfig {
  readonly defaultDpi: number;              // default 150
  readonly defaultImageFormat: "png" | "jpeg"; // default "jpeg"
  readonly defaultJpegQuality: number;      // default 0.85
}

export interface ExportEngineInput {
  readonly documentId: string;
  readonly document: Document;              // para dimensiones de página
  readonly groups: ReadonlyArray<EntityGroup>; // grupos enabled se incluyen
  readonly rules: ReadonlyArray<Rule>;
  readonly options: ExportOptions;
  readonly renderPageProvider: RenderPageProvider; // abstraction over RenderEngine
}

export interface EncodedPageImage {
  readonly bytes: ArrayBuffer;     // imagen codificada (PNG o JPEG), lista para embedPng/embedJpg
  readonly format: "png" | "jpeg";
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface RenderPageProvider {
  renderFull(pageIndex: number, replacements: ReadonlyArray<Replacement>, abortSignal: AbortSignal): Promise<EncodedPageImage>;
  // ADR-059 §5: la leyenda se rasteriza como cualquier otra página, y este motor
  // no tiene canvas. Se extiende el puerto que ya existía en vez de inventar un
  // canal nuevo entre motores: lo implementa el Orchestrator, único autorizado a
  // hablarle a los dos (P-1). Recibe filas de strings YA COMPUESTAS — el kernel de
  // Render no ve EntityType ni EntityGroup. Solo se invoca con includeMarkerLegend.
  renderLegend(rows: ReadonlyArray<MarkerLegendRow>, abortSignal: AbortSignal): Promise<EncodedPageImage>;
}

export interface ExportEngineOutput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;    // PDF final, transferido
  readonly sizeBytes: number;
  readonly durationMs: number;
}

export class ExportEngine implements IEngine {
  readonly id = EngineId.Export;
  // pool (ADR-047 §2): puerto interno de despacho (espejo de OcrJobPool/ADR-045
  // §2), inyectado por el façade en createCore sobre un WorkerPool de size 1.
  // Sin argumento → fallback in-process que invoca el mismo ensamblador
  // (bit-idéntico, ADR-035); es lo que los tests del motor ya esperan.
  constructor(pool?: ExportJobPool);
  init(ctx: EngineContext): Promise<void>;
  export(input: ExportEngineInput, ctx: EngineContext): Promise<ExportEngineOutput>;
  dispose(): Promise<void>;
}
```

**Semántica del despacho (ADR-047 §1–§5)**: por cada página, tras obtener el `EncodedPageImage` del `renderPageProvider`, el motor despacha `append-page` (`ExportPagePayload`, `03_Data_Model.md` §18: bytes + `imageFormat` + `pageWidthPt`/`pageHeightPt`) con `maxRetriesOverride: 0`; al terminar el loop despacha `save` (`ExportSavePayload` con la `ExportMetadata` ya sanitizada) y recibe el `ArrayBuffer` transferido. Los dos loops de retry (render y `save`) y el timeout de 30 s (`workerPool.timeouts["export-page"]`) siguen siendo host-side; un `EXPORT_TIMEOUT`/`EXPORT_FAILED` que cruzó el worker llega deserializado y se re-instancia por `code` antes de decidir el reintento. El blob URL de `EXPORT_FINISHED` lo crea el motor en host, nunca el worker.

> El `RenderPageProvider` es inyectado por el Orchestrator (que conoce ambos engines). Esto evita la dependencia directa `export-engine → render-engine`, manteniendo el principio A-6 (sin dependencias entre motores).

> `renderFull` devuelve bytes **codificados** (ADR-032 §1): pdf-lib solo embebe PNG/JPEG (`embedPng`/`embedJpg`), y codificar `ImageData` requiere canvas — dominio de Render/host, no del ensamblador (coherente con `ExportPagePayload.pageImage: ArrayBuffer` y 05 §7.4/§7.5). El Orchestrator construye el provider **preconfigurado con las `ExportOptions`** del request (dpi/formato/calidad); Export solo pasa `pageIndex`/`replacements`/`abortSignal`. Las dimensiones de página en puntos PDF salen de `document.pages[i].width/height`.

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `EXPORT_STARTED` | al iniciar el export | `ExportStarted` | async | sí |
| `EXPORT_PROGRESS` | por página ensamblada | `ExportProgress` | async | sí |
| `EXPORT_FINISHED` | al serializar y transferir el PDF final | `ExportFinished` con `blobUrl` | async | sí |
| `EXPORT_FAILED` | al fallar el export | `ExportFailed` | async | sí |

Canal: `EventChannel.Export`.

> `EXPORT_FINISHED.blobUrl` (ADR-032 §4): en Hito 8 (inline) el motor lo crea él mismo con `URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }))` — blob real, a diferencia del placeholder de Render (ADR-031 §5). En Hito 9 lo arma el host a partir del `ArrayBuffer` transferido (un worker no tiene `createObjectURL` garantizado); la revocación del URL es responsabilidad del host (mismo criterio que el pendiente de Render en MVP.md §4).

---

## 8. Eventos que consume

**Ninguno** (ADR-032 §2). `EXPORT_REQUESTED` lo escucha el **Orchestrator**, que arma `ExportEngineInput` y llama `ExportEngine.export()` directamente — mismo patrón que `DOCUMENT_IMPORTED`/ADR-014. En Hito 8 (inline) el caller directo son los tests/el façade (precedente ADR-030 §1).

Tampoco escucha `RENDER_FINISHED`: las imágenes llegan vía `renderPageProvider` (síncrono desde el punto de vista del flujo de export).

---

## 9. Entradas

```ts
ExportEngineInput {
  documentId: string;
  document: Document;
  groups: ReadonlyArray<EntityGroup>;  // solo los enabled se procesan
  rules: ReadonlyArray<Rule>;
  options: ExportOptions;
  renderPageProvider: RenderPageProvider;
}

ExportOptions {
  imageFormat: "png" | "jpeg";
  jpegQuality: number;        // 0..1
  dpi: number;                // 150 default, 300 alta calidad
  includeOriginalMetadata: false;  // SIEMPRE false por tipo
  title?: string;
  filename: string;
  includeMarkerLegend: boolean;    // ADR-059 §1, default false
}
```

**Restricciones**:
- `document.pageCount > 0`. Si `pageCount = 0`, lanza `InvalidInputError`.
- `options.dpi > 0` y `≤ 600` (limit superior razonable).
- `options.jpegQuality ∈ [0.5, 1]` si `imageFormat = "jpeg"`.
- `options.includeOriginalMetadata` debe ser literalmente `false` (garantía de tipo).
- `renderPageProvider` debe estar poblado.

---

## 10. Salidas

```ts
ExportEngineOutput {
  documentId: string;
  buffer: ArrayBuffer;        // PDF final, transferido
  sizeBytes: number;
  durationMs: number;
}
```

Garantías del PDF final:
- Sin capas de texto del original. **Sin capas de texto, punto** (ADR-059 §4): ninguna página del export contiene objetos de texto, incluida la de leyenda, que se rasteriza como cualquier otra. Verificado por el test `export-has-no-text-objects` (`08_Security_Model.md` §11), que convierte "el export es 100% imagen" en una aserción de CI en vez de una convención.
- Sin bookmarks, links, JavaScript, forms del original.
- Sin XMP ni metadata sensible del original.
- Metadata propia: `producer = "Anonly"`, `creator = "Anonly"`, `creationDate = now`, `title` opcional.
- Cada página es una imagen a `options.dpi` con `options.imageFormat`.

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `EXPORT_FAILED` | `ExportFailedError` | error fatal durante ensamblado o serialización | sí | reintentar 1 vez; si persiste, `EXPORT_FAILED` |
| `EXPORT_NO_ENABLED_GROUPS` | `ExportNoEnabledGroupsError` | ningún grupo `enabled`. `export()` **no la lanza**: loguea warn con el code en metadata y continúa (ADR-032 §3). La clase es el tipo de la validación **pre-export** del Orchestrator (Hito 9), donde el usuario confirma | no | warning al usuario en el flujo pre-export; si confirma, export = original reconstruido |
| `EXPORT_TIMEOUT` | `ExportTimeoutError` | timeout (default 30 s por página) | sí | reintentar 1 vez |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `export` antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `export` tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined o `options` inválidas | no | bug del caller |

`retryable`: `EXPORT_FAILED = true`, `EXPORT_TIMEOUT = true`. Resto `false`.

---

## 12. Consideraciones de rendimiento

- El ensamblado corre en el **ExportWorker único** de este motor (jobs `export-page`; la redacción previa "corre en `RenderPool`" era errata, ADR-036 §1). `export()` sigue en host: dirige el loop, emite `EXPORT_*` (ADR-013 §6); solo la frontera pdf-lib cruza al worker. El render full por página sí corre en `RenderPool` (vía `RenderPageProvider`, prioridad 1000). Desde ADR-047 §2 el transporte es un `WorkerPool` de `size: 1` construido por el façade e inyectado al motor: un solo slot ⇒ el ensamblado sigue siendo estrictamente secuencial (pdf-lib no es thread-safe sobre el mismo `PDFDocument`) y dos exports concurrentes se serializan solos (§13 caso 14), sin cola prioritaria ni clave nueva en `WorkerPoolConfig`.
- Cada `ArrayBuffer` de página hace dos saltos zero-copy (RenderWorker → host → ExportWorker): el encode vive donde vive el canvas (ADR-034 §3) y el ensamblado donde vive pdf-lib.
- Costo: 200–800 ms por página (render full + ensamblado pdf-lib). Serialización final: 500–2000 ms.
- Memoria: 60–200 MB por worker (pdf-lib `PDFDocument` crece con cada página adjuntada).
- `ArrayBuffer` final se transfiere zero-copy al host.
- Streaming: las imágenes se ensamblan página por página; `EXPORT_PROGRESS` se emite por página.
- Cancelación: entre páginas. SLA < 200 ms. El `PDFDocument` parcial se descarta.
- Tamaño del PDF: escala con `dpi²` y `jpegQuality`. Para A4 150 DPI JPEG q 0.85: ~100–300 KB por página.
- Reintentos: si una página falla al renderizar, el `renderPageProvider` reintenta (es su contrato); Export reintenta el ensamblado solo si pdf-lib falla (raro).
- Paralelismo: el render full de las páginas se despacha en paralelo al `RenderPool`; el ensamblado en pdf-lib se hace en un solo worker (pdf-lib no es thread-safe para el mismo `PDFDocument`).

---

## 13. Casos límite

1. **Documento con 0 páginas**: lanza `InvalidInputError`.
2. **Todos los grupos `enabled = false`**: `export()` loguea warn (code `EXPORT_NO_ENABLED_GROUPS`) y continúa; el export es idéntico al original (reconstruido, sin reemplazos). La confirmación del usuario es pre-export, en el Orchestrator/UI (Hito 9/10; ADR-032 §3).
3. **Solo grupos Regex habilitados**: export normal, solo patrones determinísticos reemplazados.
4. **Solo grupos NER habilitados**: export normal, solo personas/organizaciones/direcciones reemplazadas.
5. **DPI 300 (alta calidad)**: páginas más grandes, archivo final ~4x más grande. Más lento.
6. **Formato PNG**: sin pérdida, archivo más grande. Útil para documentos con texto fino.
7. **Formato JPEG q 1.0**: máxima calidad JPEG, aún con pérdida sutil en bordes de texto.
8. **PDF original con bookmarks**: el export no los replica. Sin error.
9. **PDF original con JavaScript**: el export no lo replica. Sin error.
10. **PDF original con forms (AcroForm)**: el export no los replica. Sin error.
11. **PDF original con XMP sensible**: el export no lo replica. Test `metadata-strip` valida.
12. **PDF original con texto seleccionable**: el export no tiene texto seleccionable (es "scanned-like"). Trade-off aceptado por ADR-004. **Sin excepciones, tampoco la leyenda** (ADR-059 §4): se rasteriza como cualquier otra página, y hay un test de CI que lo verifica.
13. **Cancelación a mitad de ensamblado**: aborta en < 200 ms, `PDFDocument` parcial descartado, no se emite `EXPORT_FINISHED`.
14. **Doble export simultáneo**: el segundo `EXPORT_REQUESTED` se encola (no se superpone). El Orchestrator serializa.
15. **`export` tras `dispose`**: lanza `EngineDisposedError`.
16. **Título muy largo o caracteres especiales**: pdf-lib los maneja; se sanitiza para evitar PDF injection.
17. **1000 páginas**: memoria del `PDFDocument` puede llegar a 500 MB. Mitigado: ensamblar en chunks y usar `pdf-lib` con `save({ useObjectStreams: true })` para compresión.
18. **Reintento de una página que el worker sí adjuntó (ADR-047 §4)**: el host reintenta tras un timeout, pero el `append-page` original había terminado del otro lado. El worker ignora el `pageIndex` ya adjuntado y responde `COMPLETED`: el PDF final no tiene páginas duplicadas. Sin esta idempotencia el fallo sería silencioso (salida incorrecta, ningún error).
19. **`append-page` con un `documentId` distinto del retenido (ADR-047 §4)**: el worker descarta el `PDFDocument` parcial y arranca uno nuevo. Cubre un export abandonado por fallo o cancelación seguido de otro, sin mensaje de control nuevo.
20. **Fallback in-process (sin factory de worker, ADR-035)**: el ensamblado corre en el mismo módulo, en el host. Eventos, orden, bytes de salida y garantías de §10 idénticos; los tests del motor corren por este camino.
21. **Leyenda de marcadores activa (ADR-059 §5/§6)**: con `options.includeMarkerLegend === true`, el PDF final tiene `document.pageCount + 1` páginas. La imagen se pide por `RenderPageProvider.renderLegend` —el mismo puerto mediado por el Orchestrator que ya se usa para `renderFull`— y se embebe dentro del `save`, **antes** de aplicar la metadata y serializar, con las mismas cuatro llamadas de pdf-lib que usa `appendPage`. **No pasa por `appendPage`** aunque el dibujo sea idéntico: esa función es idempotente por `pageIndex` y la leyenda no tiene uno — no es una página del documento (caso 18). Con el flag apagado (default), `renderLegend` **no se invoca** y el export es bit a bit el mismo que antes de ADR-059.
22. **Qué puede y qué no puede contener la leyenda (ADR-059 §2/§3)**: una fila por `EntityType` presente, con los **prefijos efectivamente usados** —pueden ser varios, porque ADR-057 elige el nivel por grupo y dos grupos del mismo tipo pueden quedar en niveles distintos— y el conteo de marcadores. **Nunca un valor original.** La imposibilidad está garantizada **por tipo**: `MarkerLegendEntry` (`03_Data_Model.md` §18) no tiene ningún campo capaz de transportar contenido del documento, así que filtrar un dato no requiere disciplina del implementador sino cambiar el contrato. Mismo mecanismo que `includeOriginalMetadata: false` de ADR-009. Solo participan grupos `enabled` en modo `placeholder`: el `mask` de todos los DNI del documento es el mismo, listarlo no dice nada; `synthetic` produce valores que se leen como reales; `redact` no produce marcador. Los prefijos de género de ADR-060 (`MUJER`/`MUJ`/`HOMBRE`/`HOM`) caen bajo la fila `Person` sin cambio alguno en `buildMarkerLegend`.
23. **Flag activo sin ningún grupo `placeholder` (ADR-059 §2)**: **no se agrega página** y se loguea `warn`. Nunca una página en blanco.
24. **Cota de tamaño de la leyenda (ADR-059 §2)**: el número de filas está acotado por la cardinalidad de `EntityType` (13), así que la leyenda es **siempre una sola página**. No hay caso multipágina y no hay que escribir paginación.
25. **Fallo al renderizar la leyenda (ADR-059 §8)**: se trata como un fallo de página —retry y, si persiste, `EXPORT_FAILED`—, nunca dejando el PDF a medio ensamblar ni emitiendo `EXPORT_FINISHED` con un documento incompleto. Una leyenda que no se pudo dibujar **no** degrada a "export sin leyenda" en silencio: el usuario la pidió explícitamente.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits EXPORT_STARTED at beginning` | `contract.test.ts` | contract | invariante |
| `emits EXPORT_PROGRESS per page` | `contract.test.ts` | contract | invariante |
| `emits EXPORT_FINISHED with non-empty buffer` | `contract.test.ts` | contract | invariante |
| `output buffer is a valid PDF (%PDF- header)` | `contract.test.ts` | contract | invariante |
| `no original text recoverable in export` | `security.test.ts` (en `tests/security/`, donde corre `pnpm test:security`; ADR-032 §4) | security | no-recuperabilidad |
| `export metadata has producer = Anonly` | `contract.test.ts` | contract | invariante |
| `export metadata has no author/creator/title from original` | `security.test.ts` | security | metadata strip |
| `export has no bookmarks` | `unit.test.ts` | unit | caso 8 |
| `export has no JavaScript` | `unit.test.ts` | unit | caso 9 |
| `export has no AcroForm` | `unit.test.ts` | unit | caso 10 |
| `export has no XMP from original` | `security.test.ts` | security | caso 11 |
| `export has no text layer` | `security.test.ts` | security | caso 12 |
| `0 enabled groups logs EXPORT_NO_ENABLED_GROUPS warning and continues` | `edge.test.ts` | edge | caso 2 (ADR-032 §3) |
| `DPI 300 produces larger file than DPI 150` | `unit.test.ts` | unit | caso 5 |
| `PNG produces larger file than JPEG q 0.85` | `unit.test.ts` | unit | caso 6 |
| `cancel within 200ms` | `cancel.test.ts` | cancel | caso 13 |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 15 |
| `throws InvalidInputError on 0 pages` | `edge.test.ts` | edge | caso 1 |
| `1000 pages completes within memory budget` | `stress.test.ts` (en `src/__tests__/` hasta que exista `tests/stress/`; mismo criterio que ADR-031 §5) | stress | caso 17 |
| `filename sanitized for PDF injection` | `edge.test.ts` | edge | caso 16 |
| `re-appending the same pageIndex does not duplicate the page` | `worker/__tests__/entry.test.ts` | unit | caso 18 (ADR-047 §4) |
| `append-page with a new documentId discards the partial document` | `worker/__tests__/entry.test.ts` | unit | caso 19 |
| `entry-point discriminates append-page vs save by payload shape` | `worker/__tests__/entry.test.ts` | unit | ADR-047 §3 |
| `CANCEL discards the partial PDFDocument and answers CANCELLED` | `worker/__tests__/entry.test.ts` | unit | caso 13 |
| `every dispatch uses maxRetriesOverride: 0` | `contract.test.ts` | contract | ADR-047 §2 |
| `same events, order and output bytes with and without injected pool` | `contract.test.ts` | contract | caso 20 (fallback ADR-035) |
| `deserialized EXPORT_TIMEOUT is retried like the local one` | `unit.test.ts` | unit | ADR-047 §5 |
| `blob URL is created in host, never in the worker` | `contract.test.ts` | contract | ADR-047 §6 |
| `includeMarkerLegend: false yields exactly pageCount pages and never calls renderLegend` | `contract.test.ts` | contract | caso 21 (ADR-059) — **no-regresión de todos los exports existentes** |
| `includeMarkerLegend: true yields pageCount + 1 pages` | `contract.test.ts` | contract | caso 21 |
| `legend groups by type and lists the distinct prefixes used, including mixed levels` | `unit.test.ts` | unit | caso 22 (ADR-059 §2) |
| `mask/synthetic/redact groups and disabled groups produce no legend rows` | `unit.test.ts` | unit | caso 22 |
| `rows reaching renderLegend are composed strings, never EntityType or EntityGroup` | `unit.test.ts` | unit | ADR-059 §5 |
| `legend active with no placeholder groups adds no page, does not call renderLegend, and warns` | `edge.test.ts` | edge | caso 23 |
| `all 13 entity types still fit in a single legend page` | `edge.test.ts` | edge | caso 24 |
| `renderLegend failure retries and then fails the export; never a half-assembled PDF` | `edge.test.ts` | edge | caso 25 (ADR-059 §8) |
| `gender prefixes fall under the Person row without touching buildMarkerLegend` | `unit.test.ts` | unit | caso 22 (ADR-060 §8) |
| **`export buffer with legend contains no canonicalValue nor originalValue`** | `tests/security/` | security | caso 22 — **el test que no puede faltar**; mismo criterio y dataset que el `no-recuperability` de ADR-009, corrido específicamente sobre el camino con leyenda |
| **`no page of the export contains text objects`** | `tests/security/` | security | ADR-059 §4 — convierte "el export es 100% imagen" en una aserción de CI en vez de una convención |

Fixtures: `tests/fixtures/text-10p.pdf`, `text-50p.pdf`, `huge-1000p.pdf`.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/export-engine/`.
- [ ] 2. Definir `types.ts` con `ExportEngineInput`, `ExportEngineOutput`, `RenderPageProvider`, `EncodedPageImage` (ADR-032 §1; `ExportConfig` viene de `@anonly/shared`/Contracts.md §6; ADR-027).
- [ ] 3. Definir `errors.ts` con `ExportFailedError`, `ExportNoEnabledGroupsError`, `ExportTimeoutError`.
- [ ] 4. Implementar `export.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. Implementar `init` (sin suscripciones a eventos — ADR-032 §2; el worker de ensamblado es Hito 9/ADR-021).
- [ ] 6. Implementar `export` con `AbortSignal`, `EXPORT_STARTED`, render full por página vía `renderPageProvider` (`EncodedPageImage`; ADR-032 §1), `EXPORT_PROGRESS` por página, ensamblado pdf-lib (`embedJpg`/`embedPng` de `bytes`), `EXPORT_FINISHED` con `ArrayBuffer` transferido.
- [ ] 7. Implementar generación de metadata mínima (`ExportMetadata`).
- [ ] 8. Implementar sanitización de `title`/`filename` para PDF injection.
- [ ] 9. Implementar `dispose` (libera `PDFDocument` y worker de ensamblado).
- [ ] 10. Validar que ningún campo del original se copia al `PDFDocument` nuevo (sin `copyPages` de pdf-lib desde el original; solo `embedJpg`/`embedPng` de las imágenes renderizadas).
- [ ] 11. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 12. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 13. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 14. Escribir `security.test.ts` con `no-recuperability` y `metadata-strip`.
- [ ] 15. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 16b. (Hito 10.9, PR 8 — ADR-074 §1) `buildPageReplacements` copia `fragments` del `OccurrenceRef` al `Replacement`; sin el campo en el member, sin el campo en el reemplazo. Dos tests unitarios (con y sin), que son la red contra el modo de falla de ADR-066 §6. El PR de `shared` que declara el campo (Hito 10.9 PR 4) es precondición. Nada más de este motor se toca.
- [ ] 16. Verificar `index.ts` exporta solo `ExportEngine`, tipos, errores — y, desde ADR-044 §4, la función pura `buildPageReplacements` (grupos → `Replacement[]` por página): la importa el façade para computar los reemplazos del preview mediado con la **misma** semántica que el export (única excepción sancionada; ningún otro helper interno se exporta).
- [ ] 17. Verificar imports sin dependencias prohibidas (`grep -r 'react\|pdfjs\|tesseract\|onnx\|transformers' src/`).
- [ ] 18. Verificar `no-network-from-core`.
- [ ] 19. Verificar test de cancelación < 200 ms.
- [ ] 20. Validar gate `no-recuperability` en CI.

### PR16 — ExportWorker (ADR-047)

- [ ] 21. Extraer a `src/worker/assembler.ts` la frontera pdf-lib: `appendPage(state, payload)` (embed + `addPage` + `drawImage`, idempotente por `pageIndex`) y `savePdf(state, metadata)` (setters + `save({ useObjectStreams: true })`), sobre un estado explícito `{ documentId, pdfDoc, appendedPages }`. Sin bus, sin logger, sin eventos.
- [ ] 22. Escribir `src/worker/entry.ts`: `INIT`/`READY`, `RUN(export-page)` discriminando por forma (`"pageImage" in payload` → append; si no → save), `COMPLETED` (el `save` devuelve el `ArrayBuffer` **transferido**), `CANCEL` (descarta el parcial), `DISPOSE`. `jobType ≠ "export-page"` → `FAILED`. Agregar el subpath `"./worker"` al `package.json` del paquete.
- [ ] 23. Adaptar `export.engine.ts`: puerto `ExportJobPool` + `IMMEDIATE_POOL` + `constructor(pool?)`; despacho `append-page` por página y `save` al final con `maxRetriesOverride: 0`; normalización por `code` de `EXPORT_TIMEOUT`/`EXPORT_FAILED`; retirar el guard `pageCountBeforeAttempt` (lo reemplaza la idempotencia por índice del worker); `dispose()` libera el ensamblador local.
- [ ] 24. Costuras ajenas sancionadas por ADR-047 §2/§7: `PoolKey` gana `"export"` en `worker-pool.ts` y `WorkerPoolManager` conserva su unión de cuatro vía `ManagedPoolKey = Exclude<PoolKey, "export">`; `create-core.ts` construye el `exportPool` (`size: 1`) e inyecta `new ExportEngine(exportPool)` y lo dispone; `orchestrator.ts` **retira** `exportWorkerFactory` (campo, log y comentario); wiring de la factory `export` en `apps/react-client`.
- [ ] 25. Tests nuevos de §14 + glob de cobertura de `worker/**` en `vitest.config.ts`; `pnpm test:security` verde por el camino nuevo (no-recuperabilidad y metadata-strip no dependen de dónde corre pdf-lib). Gates completos verdes.

### Hito 10.5, PR 8 — Leyenda de marcadores (ADR-059)

- [ ] 26. Proyección host-side `EntityGroup[] → MarkerLegendEntry[]`, en el mismo lugar donde ya se proyectan los grupos para el export: solo `enabled` en modo `placeholder`, agrupados por `type`, con los prefijos distintos usados y el conteo (§13 caso 22). **La proyección es el único punto donde se ve un `EntityGroup`**; de ahí en adelante solo viajan tipo/prefijos/conteo, y después solo strings.
- [ ] 27. `buildMarkerLegend(entries) → MarkerLegendRow[]` (strings ya compuestos) y `RenderPageProvider.renderLegend` en el puerto (§6), con su implementación en el Orchestrator delegando a `RenderEngine.renderLegendPage` (ADR-059 §5). **Toca motor y façade en el mismo diff** — excepción acotada a R-1 justificada en ADR-059 §7: un método nuevo en un puerto no admite estado intermedio verde.
- [ ] 28. Embebido en `savePdf` con `embedPng`/`embedJpg` + `addPage` + `drawImage`, antes de aplicar la metadata y serializar. **No** por `appendPage` (§13 caso 21). Sin filas → no se invoca `renderLegend`, no se agrega página, `warn` (caso 23). Un fallo de `renderLegend` sigue el camino de fallo de página (caso 25).
- [ ] 29. La imagen de la leyenda en `ExportSavePayload`; `includeMarkerLegend` en la validación de `options` (§9).
- [ ] 30. Tests de §14, **incluidos los dos de `tests/security/`**. Verificación manual: abrir el PDF exportado e **intentar seleccionar texto en cualquier página, incluida la leyenda — no debe seleccionarse nada**. Es la verificación de un segundo que motivó rasterizarla (ADR-059 §4).

---

## Flujo de export (diagrama)

```text
EXPORT_REQUESTED (UI) → lo escucha el Orchestrator, que arma el input (ADR-032 §2)
        │
        ▼
ExportEngine.export(input)
        │
        ├─ validar input (pageCount > 0, options válidas)
        ├─ emit EXPORT_STARTED
        ├─ si no hay grupos enabled: logger.warn (EXPORT_NO_ENABLED_GROUPS), continuar (ADR-032 §3)
        │
        for each pageIndex:
        │   ├─ replacements = resolver replacements de grupos enabled para esta página
        │   ├─ pageImage = await renderPageProvider.renderFull(pageIndex, replacements, abortSignal)  // EncodedPageImage
        │   ├─ pdfPage = pdfDoc.addPage([width, height])  // puntos PDF, de document.pages[pageIndex]
        │   ├─ pdfPage.drawImage(embedJpg/embedPng(pageImage.bytes))
        │   ├─ emit EXPORT_PROGRESS(current, total)
        │   └─ si abortSignal.aborted: discard pdfDoc, return CANCELLED
        │
        ├─ pdfDoc.setProducer("Anonly")
        ├─ pdfDoc.setCreator("Anonly")
        ├─ pdfDoc.setCreationDate(now)
        ├─ si options.title: pdfDoc.setTitle(sanitized)
        │
        ├─ buffer = await pdfDoc.save({ useObjectStreams: true })
        ├─ emit EXPORT_FINISHED(documentId, buffer, sizeBytes, durationMs)
        └─ return { buffer (transferido), sizeBytes, durationMs }
```

---

## Sintetizadores (referencia)

Los sintetizadores para `mode = "synthetic"` viven en `shared/synthesizer.ts`. Ver `adr/ADR-012-Replacement-Modes.md` para la tabla de formatos por tipo, y `core/Contracts.md` §5-§6 para el tipo y la firma, que desde ADR-072 §2 están **declarados en el contrato**.

> **Corregido por ADR-072 §2 (2026-08-14), en tres puntos.** Esta sección decía que el sintetizador es "consumido por Grouping y por Export/Render (consistencia visual)"; **su único caller es Grouping** (`computeReplacementValue`), y este motor nunca lo llamó. Export recibe el `replacementValue` ya resuelto en `Replacement`, que es justamente lo que garantiza la consistencia visual — llamar al sintetizador desde acá sería una segunda fuente de verdad capaz de discrepar del preview. Además la firma cambió (objeto en vez de posicionales) y **la semilla dejó de ser `indexInType`**.

```ts
export function synthesize(req: SyntheticRequest): string;
```

Determinismo, con precisión: mismo `(type, groupId, seed)` → mismo valor, y **cambiar `indexInType` no cambia nada** en los tipos que sortean (ADR-072 §1). El seed es aleatorio por sesión y **no es configurable** — ADR-019 §5 lo decidió así para decorrelacionar sesiones, así que reproducir un export entre sesiones no es posible ni deseado (ADR-012 §SAN, `roadmap/Future_Ideas.md` §3.4).

---

## Referencias

- `architecture/06_Pipeline.md` §13 (etapa 11)
- `architecture/05_Worker_Architecture.md` §7.5 (ExportWorker)
- `architecture/08_Security_Model.md` §4, §5
- `adr/ADR-004-Rendering.md` (reconstrucción)
- `adr/ADR-009-Export-Strategy.md` (estrategia completa)
- `adr/ADR-012-Replacement-Modes.md` (modos y formatos)
- `adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md` (provider codificado, invocación directa, warning)
- `core/Contracts.md` §6 (ExportConfig)
- `architecture/03_Data_Model.md` §19 (ExportOptions, ExportMetadata)
