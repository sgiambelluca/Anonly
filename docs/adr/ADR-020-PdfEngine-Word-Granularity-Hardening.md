<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/PDF_Engine.md,architecture/03_Data_Model.md,adr/ADR-013-PDF-Engine-Hito2-Inline.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,ai/Code_Standards.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=5 -->

# ADR-020 — PDF Engine: granularidad de Word, NFC y hardening post-review del Hito 2

- **Estado**: Accepted
- **Fecha**: 2026-07-09
- **Decidido por**: Code review integral del Hito 2 aprobado por el humano
- **Relacionado con**: ADR-013 (PDF Engine Hito 2: ejecución inline), ADR-014 (Fusión OCR→PDF mediada por Orchestrator), ADR-019 (Hardening del Hito 1)

## Contexto

Antes de empezar el Hito 3, se hizo un code review integral del Hito 2 (`packages/anonymization-core/pdf-engine`). El motor está bien construido (lifecycle, inmutabilidad, manejo de errores, seguridad de metadata) pero el review encontró desviaciones entre la implementación y `core/PDF_Engine.md`/ADR-013/ADR-014, un bug real (timeout con `documentId` vacío) y huecos de granularidad que van a causar problemas concretos en Hitos posteriores (mask/redact impreciso, inconsistencia con OCR). Por `R-19` (contrato antes que código), este ADR registra las decisiones **antes** de que el PR de código las implemente.

El humano aprobó todos los cambios de abajo en un único PR. Es una excepción consciente a `R-1`/`R-21` (ver sección 12).

## Decisión

### 1. Granularidad de Word: split de TextItems por whitespace

PDF.js devuelve `TextItem[]` por *run* de texto (frecuentemente líneas o frases enteras completas), no por palabra individual. El engine ahora **divide cada `TextItem.str` por whitespace** en tokens y produce un `Word` por token, prorrateando `x` y `width` proporcionalmente a la longitud de caracteres de cada token dentro del string original (aproximación lineal: se asume ancho de carácter constante dentro del run). `y` y `height` se conservan idénticos para todos los tokens de un mismo `TextItem` (el run es una sola línea de base).

Razones:
- **(a) Precisión de bbox para mask/redact**: sin el split, un `TextItem` como `"Juan Pérez 34.567.891"` produce un único `Word` cuyo bbox cubre la línea entera. Cuando Regex/NER detecten el DNI `34.567.891` dentro de ese texto y Grouping pida enmascarar/redactar esa ocurrencia, Render tendría que censurar el `Word` completo — tapando también "Juan Pérez". La única forma de censurar solo el DNI es tener bboxes a nivel de palabra.
- **(b) Consistencia con OCR**: Tesseract (`ocr-engine`, futuros hitos) devuelve cajas por palabra, no por línea. Sin este split, las páginas con texto nativo y las páginas escaneadas tendrían granularidades de `Word` distintas para el mismo tipo de dato, rompiendo cualquier lógica downstream (Grouping, Render) que asuma "un `Word` ≈ una palabra".

El prorrateo es una aproximación lineal (no tiene en cuenta kerning ni fuentes proporcionales reales); es aceptable para el propósito de bbox de censura, que no requiere precisión tipográfica exacta.

### 2. Normalización NFC de `Word.text`

`Word.text` se normaliza a NFC (`String.prototype.normalize("NFC")`) al crearse, tanto en el path de PDF.js (`convertTextItemsToWords`, ahora a nivel de módulo) como en `fuseOcrPage` (words entrantes de OCR). Esto cumple la invariante de `architecture/03_Data_Model.md` §4: *"`text` es la concatenación de `words.map(w => w.text).join(" ")` con normalización NFC"*.

Sin esta normalización, texto con acentos representados en forma descompuesta (NFD: letra base + combining accent, común en extracciones de ciertos generadores de PDF y en salida de algunos motores OCR) rompería el matching de Regex y de Grouping por comparación de string — dos apariciones semánticamente idénticas de "Pérez" (una NFC, otra NFD) se tratarían como valores distintos, produciendo falsos negativos de anonimización.

### 3. Política única de señalización de errores fatales

Se ratifica una regla uniforme: **todo error fatal de parseo emite su evento correspondiente antes de lanzar la excepción**. Específicamente:

- `PdfInvalidError` — incluye el caso de `maxPageCount` excedido y los errores **desconocidos** a nivel documento de `getDocument()` (ver punto 4) — emite `PDF_INVALID` `{ documentId, reason }` antes de lanzar.
- `PdfCorruptedError` (fallo de página interna: `getPage`/`getTextContent`) **también emite `PDF_INVALID`** con el `reason` correspondiente. No se introduce un evento `PDF_CORRUPTED` nuevo: `PDF_Engine.md` §7 ya solo documenta `PDF_INVALID` como evento de error fatal de parseo; el error de página interna sigue siendo una instancia de `PdfCorruptedError` (código `PDF_CORRUPTED`, ver §11), pero la señal en el bus es la misma `PDF_INVALID` — no hay evento `PDF_CORRUPTED` en el bus, solo la clase/código de error.
- `PdfPasswordRequiredError` sigue emitiendo `PDF_PASSWORD_REQUIRED` (comportamiento ya existente, sin cambios).
- `PdfTimeoutError` **no emite ningún evento**: la señal para el caller es el rechazo de la promesa de `process()`. Emitir un evento adicional aquí sería redundante con el mecanismo de retry que en Hito 9 vive en el `WorkerPool` (ver punto 5), que reacciona al rechazo, no a un evento de bus.

Esta unificación cierra una inconsistencia real del código de Hito 2, donde algunos paths fatales emitían antes de lanzar y otros lanzaban directamente sin emitir (en particular, el error desconocido de `getDocument()` y el de página interna).

### 4. Reclasificación de errores desconocidos a nivel de documento

Los errores **desconocidos** que devuelve `getDocument()` (es decir, que no matchean como `PasswordException`/password ni como `InvalidPDFException`/mensaje "invalid"/"corrupt") pasaban a lanzar `PdfCorruptedError`. Esto es incorrecto: `PDF_Engine.md` §11 reserva `PDF_CORRUPTED` explícitamente para *"PDF.js lanza error de parseo en una página interna"* — un fallo a nivel de documento completo (antes de tener ninguna página) no es un fallo de "página interna". Se reclasifican estos errores desconocidos de `getDocument()` a `PdfInvalidError` (con el mensaje original como `reason`), consistente con la fila `PDF_INVALID` de §11 (*"no es PDF, header inválido, corrupto"* — un documento que ni siquiera pudo abrirse cae bajo "corrupto" a nivel de documento, no de página).

`PDF_CORRUPTED` queda así reservado exclusivamente a fallos de `getPage()`/`getTextContent()` sobre un documento que sí pudo abrirse.

### 5. Retry de `PDF_TIMEOUT` diferido al `WorkerPool`

`PDF_Engine.md` §11 documenta `PDF_TIMEOUT` como `retryable: true` con acción "retry 1 vez, si persiste → `PDF_INVALID`". En Hito 2 (ejecución inline, sin `WorkerPool`, ver ADR-013) no existe la infraestructura de reintento automático; implementarla inline sería trabajo muerto que se descarta en Hito 9 cuando la migración a `PdfPool` ocurra. El retry real queda diferido a `WorkerPoolConfig.maxRetries["pdf-parse"]` (Hito 9, `architecture/05_Worker_Architecture.md` §4). En Hito 2, `PdfEngine.process()` no reintenta: un timeout de página se propaga directo como rechazo.

Adicionalmente, se corrige un bug real encontrado en el review: `PdfTimeoutError` se construía con `documentId = ""` (string vacío) en vez del `documentId` real del documento en curso — el `details.documentId` del error terminaba siendo inútil para diagnóstico. Se corrige pasando el `documentId` correcto.

### 6. `fuseOcrPage` con guard sobre `requiresOCR`

La implementación de Hito 2 fusionaba palabras OCR en cualquier página, y además **forzaba `requiresOCR: true`** en el resultado incondicionalmente. Esto tiene dos problemas: (a) si el Orchestrator (por un bug futuro, o por una carrera de eventos) invoca `fuseOcrPage` sobre una página que **ya tiene texto nativo** (`requiresOCR === false`), la implementación anterior pisaba en silencio las palabras nativas del PDF con las palabras OCR, perdiendo datos sin ningún error ni señal; (b) forzar `requiresOCR: true` sobre una página que ya era `true` es no-op, pero forzarlo sobre una página que fuera `false` sería semánticamente incorrecto (una página con texto nativo no "requiere OCR" solo porque alguien le fusionó palabras OCR por error).

Se decide: `fuseOcrPage` ahora **rechaza con `InvalidInputError`** (`details: { documentId, pageIndex }`) si `existingPage.requiresOCR !== true`. La fusión OCR solo es una operación válida sobre páginas genuinamente textless. Ya no se fuerza `requiresOCR: true` en el resultado (la página ya lo era, por precondición del guard). Las palabras OCR entrantes se normalizan a NFC (ver punto 2) antes de fusionarse.

### 7. `releaseDocument(documentId)`: evicción individual

Hasta ahora, el único mecanismo para liberar memoria del `Map` interno de `Document`s parseados era `dispose()`, que vacía **todo** el `Map` y deja el engine no-inicializado. Esto no sirve para el caso de uso de Hito 9: cuando el Orchestrator recibe `DOCUMENT_CLOSED` (el usuario cierra un documento individual sin cerrar la sesión completa), necesita liberar solo ese documento sin afectar a otros documentos activos en la misma sesión ni disponer el engine entero.

Se agrega `releaseDocument(documentId: string): void`, método público, **idempotente** (no lanza si el `documentId` no existe — es un no-op seguro), que simplemente remueve la entrada del `Map` interno. No lleva asserts de `initialized`/`disposed`: debe ser seguro invocarlo en cualquier secuencia de teardown, incluso después de `dispose()` (donde el `Map` ya está vacío y la operación es trivialmente un no-op).

### 8. `PDFDocumentProxy`: destruido al final de cada `process()`

`PDF_Engine.md` §12 (versión 1.1.1) documentaba: *"Reutiliza `PDFDocumentProxy` de PDF.js solo si el `documentId` coincide entre jobs; si cambia, lo cierra y abre uno nuevo"*. La implementación real de Hito 2 nunca implementó ese hint de reuse: cada `process()` crea su propio `PDFDocumentProxy` vía `getDocument()` y lo destruye (`pdfDocument.destroy()`) al finalizar (o al fallar) — no hay ningún cache de proxies por `documentId`.

Se decide alinear el spec al código, no al revés: el hint de reuse se **elimina** de §12. Es obsoleto en el modelo inline de Hito 2 (cada `process()` es una llamada de principio a fin sobre un buffer nuevo; no hay un escenario real donde el mismo `documentId` se reprocese con un `PDFDocumentProxy` todavía vivo) y su implementación agregaría una superficie de leak de memoria (proxies retenidos indefinidamente si el caller nunca vuelve a llamar con el mismo `documentId`) sin ningún beneficio medido. El comportamiento actual — destruir el proxy al final de cada `process()` — es la decisión que se ratifica.

### 9. Caso §13.12 (buffer ya transferido/consumido) diferido a Hito 9

El caso límite *"Buffer ya transferido (consumido): lanza `InvalidInputError` con detalles"* asume una semántica de `Transferable` (el buffer se transfiere a un Worker y el host pierde acceso) que no existe en Hito 2: ADR-013 punto 6 ya establece que en Hito 2 el `buffer` se trata como `ArrayBuffer` plano, sin lógica de `Transferable.consume()` (sería dead code inline). Un buffer "consumido" (`byteLength === 0` tras una transferencia) es, desde el punto de vista del engine inline, indistinguible de un buffer vacío genuino — ambos caen en el mismo chequeo `buffer.byteLength === 0` → `PdfInvalidError`. Se marca el caso §13.12 explícitamente como Hito 9 (cuando exista transferencia real a un Worker y valga la pena distinguir "vacío" de "consumido" en el mensaje de error).

### 10. `parsePage()` como función pura (cumplimiento de ADR-013 §6)

ADR-013 punto 6 estableció normativamente: *"el implementador de Hito 2 debe aislar `parsePage(pdfDoc, pageIndex): Page` como función pura sin supuestos host/worker"*. La implementación real de Hito 2 no siguió este mandato: la lógica de parseo por página (obtener la página, viewport, texto con timeout, conversión a `Word[]`, orden de lectura, armado del objeto `Page`) vivía inline dentro del método `process()`, entrelazada con la emisión de eventos y el manejo del `Map` de documentos.

Se corrige extrayendo `parsePage()` (y sus helpers: conversión a words, orden de lectura, timeout) a funciones de módulo (no exportadas, no métodos de clase), sin ningún supuesto sobre si corren en el host o en un Worker. La función recibe el `documentId` (para poder construir `PdfCorruptedError`/`PdfTimeoutError` con los detalles correctos) y no emite ningún evento — la emisión de `PAGE_PARSED` queda en `process()` (host), que la invoca y reacciona a su resultado. Esto dota a Hito 9 de una función lista para envolver en un job de Worker sin modificarla, tal como pedía ADR-013 desde el principio.

### 11. Nombres exactos de tests

Se ratifica la regla de disciplina de tests del revisor: el nombre literal de cada test en el código debe coincidir carácter por carácter con la columna `Test` de `PDF_Engine.md` §14. Los tests existentes de Hito 2 que divergían del nombre documentado se renombran. Los `describe` de `edge.test.ts` se renumeran para coincidir con la numeración de casos de §13 (los casos que no tienen número en §13 — p. ej. input `null`, password ausente como campo opcional — quedan sin número, agrupados temáticamente).

### 12. Excepción a R-1 / R-21 para este PR

`AI_Development_Guide.md` R-1 exige "un PR = un módulo" y R-21 prohíbe editar el spec de un motor desde un PR de implementación. Este PR toca simultáneamente `docs/core/PDF_Engine.md`, este mismo ADR y el código + tests de `packages/anonymization-core/pdf-engine/`. Es una **excepción consciente, autorizada explícitamente por el humano**: se trata de un hardening transversal (docs primero, código después, dentro del mismo PR) de un único motor, resultado de un code review integral aprobado punto por punto, previo a empezar el Hito 3 — separar la actualización del spec y la implementación en dos PRs secuenciales no aportaría aislamiento real (los cambios de código son consecuencia directa y 1:1 de las decisiones documentadas acá) y sí generaría fricción de coordinación en un proyecto de un solo desarrollador. Esta excepción no sienta precedente automático (mismo principio que ADR-019 §10): la próxima vez que una tarea requiera tocar spec + código de un motor en el mismo PR requiere la misma autorización explícita.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Split de `TextItem` por whitespace con prorrateo lineal | Mantener un `Word` por `TextItem` (granularidad de línea/frase) | Impide censura precisa por bbox (mask/redact taparía texto no sensible) y produce granularidad inconsistente frente a OCR (que sí devuelve cajas por palabra). |
| Split de `TextItem` por whitespace con prorrateo lineal | Usar la API de `pdf.js` a nivel de glyph (`TextItem` con `chars`) para bboxes exactos | No disponible de forma estable/portable en la versión de `pdfjs-dist` fijada por ADR-001; sobre-ingeniería para el propósito de censura, que tolera una aproximación lineal. |
| NFC en `Word.text` al crearse | Normalizar NFC solo en `Page.text` (concatenación) | `03_Data_Model.md` §4 exige NFC en la concatenación, pero si los `Word.text` individuales quedan sin normalizar, cualquier consumidor que lea `word.text` directamente (Regex, Grouping, Render) hereda el problema de matching descompuesto NFD. Normalizar en origen (`Word.text`) es la única forma de que la invariante se cumpla transitivamente. |
| `PDF_INVALID` como evento único para todo error fatal de parseo | Introducir un evento `PDF_CORRUPTED` en el bus, espejo del error code | `PDF_Engine.md` §7 (tabla de eventos emitidos) nunca definió `PDF_CORRUPTED` como evento — solo como error code (§11). Agregar un evento nuevo requeriría tocar `Contracts.md`/`04_Event_System.md` (R-19) sin necesidad real: el `reason` dentro del payload de `PDF_INVALID` ya distingue el motivo. |
| Reclasificar errores desconocidos de `getDocument()` a `PdfInvalidError` | Mantenerlos como `PdfCorruptedError` | Viola la definición de §11 de `PDF_CORRUPTED` ("página interna"); un fallo al abrir el documento completo es, por definición, un documento inválido/corrupto a nivel de documento, no de página. |
| Retry de `PDF_TIMEOUT` diferido a `WorkerPool` (Hito 9) | Implementar un retry inline ad-hoc en Hito 2 | Trabajo muerto: se descartaría en Hito 9 cuando `WorkerPoolManager` exista y sea la única fuente de verdad para `maxRetries`, duplicando lógica de reintento en dos lugares. |
| `fuseOcrPage` rechaza con guard sobre `requiresOCR` | Mantener el comportamiento silencioso (pisar palabras nativas, forzar `requiresOCR: true`) | Pérdida silenciosa de datos ante un bug de wiring del Orchestrator; forzar `requiresOCR: true` sobre una página con texto nativo es semánticamente falso. |
| `releaseDocument` idempotente sin asserts | Reusar `assertNotDisposed()`/`assertInitialized()` como en `process()`/`fuseOcrPage()` | El caso de uso normativo es teardown (`DOCUMENT_CLOSED` en Hito 9), donde el orden relativo con `dispose()` del engine no está garantizado; exigir que el caller lo sepa de antemano convierte una operación conceptualmente idempotente en fuente de excepciones espurias — mismo razonamiento que ADR-019 §7 para `off()` del bus. |
| Eliminar el hint de reuse de `PDFDocumentProxy` de §12 | Implementar el reuse por `documentId` tal como decía el spec original | Superficie de leak de memoria sin beneficio medido en el modelo inline de Hito 2; ningún caller real reprocesa el mismo `documentId` con un proxy todavía vivo. |
| `parsePage()` extraída como función pura de módulo | Dejarla como método privado de la clase `PdfEngine` | ADR-013 §6 exige explícitamente una función sin supuestos host/worker, envolvible en un job de Worker en Hito 9 sin modificarla; un método de instancia acopla la lógica de parseo al estado (`this.config`, `this.documents`) de la clase. |

## Consecuencias

**Positivas**:
- Las bboxes de `Word` alcanzan granularidad de palabra real, habilitando censura precisa (mask/redact) en Hitos posteriores sin rework del PDF Engine.
- Consistencia de granularidad entre páginas con texto nativo y páginas escaneadas (OCR), sin lógica condicional aguas abajo (Grouping, Render) que distinga el origen.
- Se cierra la única vía conocida de falsos negativos de anonimización por normalización Unicode inconsistente (NFC vs NFD).
- Se corrige un bug real (`PdfTimeoutError` con `documentId` vacío) que degradaba el diagnóstico de timeouts en producción.
- `fuseOcrPage` deja de tener una vía de pérdida silenciosa de datos.
- `releaseDocument` habilita el wiring de `DOCUMENT_CLOSED` en Hito 9 sin requerir cambios adicionales al engine.
- `parsePage()` puro cumple el mandato de ADR-013 §6, reduciendo el trabajo de migración a `PdfPool` en Hito 9 a "envolver, no reescribir".
- El spec (`PDF_Engine.md`) queda alineado 1:1 con el código real al cierre de este PR (mismo principio que ADR-019).

**Negativas**:
- El prorrateo lineal de `x`/`width` por longitud de caracteres es una aproximación: fuentes no monoespaciadas producen bboxes de palabra ligeramente imprecisas dentro de un mismo run. Aceptado: sigue siendo estrictamente más preciso que un bbox de línea entera, y el caso de uso (censura) tolera el margen de error.
- El caso §13.12 queda sin cobertura de test hasta Hito 9 (mismo tratamiento que los casos de stress/cancel de §13, ya diferidos). Riesgo aceptado: inline es indistinguible de buffer vacío, ya cubierto por el caso §13.1/§13.6.
- El PR es más grande de lo habitual (excepción a R-1/R-21), lo que dificulta algo la revisión en una sola pasada. Mitigado: cada decisión está aislada en su propia subsección de este ADR.

## Validación

- Tests unit nuevos: splitting de `TextItem` multi-palabra (bboxes prorrateados, orden de lectura preservado), normalización NFC de `Word.text`/`Page.text`, `PdfTimeoutError.details.documentId` correcto.
- Tests edge nuevos: `maxPageCount` excedido emite `PDF_INVALID` antes de lanzar, password vacío emite `PDF_INVALID` antes de lanzar, todo error fatal de parseo emite `PDF_INVALID` antes de lanzar.
- Test contract nuevo: `fuseOcrPage` sobre página con `requiresOCR === false` lanza `InvalidInputError`; el engine nunca se suscribe al bus (`ctx.bus.on`/`once` no invocados), ratificando ADR-014.
- Test unit nuevo: `releaseDocument` evict de un documento individual, idempotente ante `documentId` inexistente y ante doble invocación.
- Cobertura ≥ 85% líneas en `packages/anonymization-core/pdf-engine/src/**` (gate de `vitest.config.ts`).
- `pnpm lint && pnpm typecheck && pnpm test -- --coverage && pnpm test:contract && pnpm test:snapshot` verdes.

## Referencias

- `core/PDF_Engine.md` §6, §7, §11, §12, §13, §14, §15 (versión 1.2.0)
- `architecture/03_Data_Model.md` §4 (`Page`, invariante de normalización NFC)
- `adr/ADR-013-PDF-Engine-Hito2-Inline.md` (ejecución inline, `parsePage` puro, `Transferable`)
- `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md` (`fuseOcrPage`, PDF Engine no se suscribe al bus)
- `adr/ADR-019-Hito1-Hardening.md` (precedente de excepción a R-1, patrón de idempotencia post-dispose)
- `ai/Code_Standards.md` §6 (inmutabilidad), §10 (tests)
- `ai/AI_Development_Guide.md` R-1, R-19, R-21
