<!-- CONTEXT: scope=adr | dependencias=core/Render_Engine.md,core/Orchestrator.md,architecture/03_Data_Model.md,architecture/05_Worker_Architecture.md,architecture/08_Security_Model.md,adr/ADR-030-RenderEngine-LoadDocument.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-048-Cierre-E2E-Hito10-Fixtures-Assets-Escenarios.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md | audiencia=humanos+IA | fase=10 -->

# ADR-050 — El password de un PDF protegido llega hasta `RenderEngine.loadDocument`

- **Estado**: Accepted (opción A ratificada por el humano el 2026-07-30)
- **Fecha**: 2026-07-30
- **Decidido por**: El planificador, sobre un bug real destapado por el Escenario 3 E2E **después** de que ADR-049 desbloqueara el flujo de password: el pipeline avanza más lejos y ahora muere en la carga del documento en Render. El implementador lo rastreó hasta la causa raíz y **se detuvo sin tocarlo**, correctamente: cruza el contrato público de `render-engine` y el modelo de seguridad.
- **Relacionado con**: ADR-030 (`loadDocument`/`unloadDocument` — el contrato que se amplía), ADR-043 §3/§5 (el host retiene `{ buffer, pageCount }` y re-primea workers nuevos con `load-document`), ADR-049 (el bug anterior del mismo escenario; este aparece recién al arreglar aquel), ADR-048 §7 punto 1 (`protected.pdf`), `08_Security_Model.md` §6 (la sección que este ADR **enmienda**)

> Convención de citas: `ADR-050 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-050, Contexto §N`.

## Contexto

### 1. El síntoma

Con el fix de ADR-049 en el árbol, cargar `protected.pdf` ya abre el `PasswordDialog` y la contraseña correcta completa la re-extracción. El pipeline entonces avanza a la carga del documento en Render y muere ahí: `RenderFailedError("No password given")` → `PIPELINE_FAILED` → **el mismo banner genérico de siempre, causa nueva**.

### 2. Son dos defectos, no uno

1. **`retryWithPassword` no persiste la contraseña.** `orchestrator.ts` arma `const retryInput: ImportDocumentInput = { ...retained, password }` como variable local y **nunca reescribe `this.retainedInputs`**. Verificado en el árbol post-PR17.3: el commit de PR17.2 (ADR-049) no tocó `retainedInputs`.
2. **`RenderEngine.loadDocument` no tiene por dónde recibirla.** La firma pública es `loadDocument(documentId: string, buffer: ArrayBuffer)` (`Render_Engine.md` §6), `LoadDocumentPayload` solo lleva `{ documentId, buffer }`, y el kernel hace `getDocument({ data: buffer })` a secas. Aunque (1) estuviera arreglado, el password no tendría cómo llegar.

Hacen falta los dos. El (1) es del façade y no necesita ADR por sí solo; el (2) es cambio de contrato público y de modelo de seguridad, y arrastra al (1) a la misma decisión.

### 3. No es una regresión del transporte — es un agujero abierto desde el Hito 9

A diferencia de ADR-049, esto **falla igual con pools in-process**: `ensureRenderDocumentLoaded` siempre entrega el buffer retenido (encriptado) y el kernel in-process llama al mismo `getDocument` sin password. El bug existe desde que ADR-030 introdujo `loadDocument`; nunca se ejercitó porque el Escenario 3 estuvo en `test.fixme` desde PR10.

### 4. Alcance: no es solo el preview

Los tres caminos que pasan por `ensureRenderDocumentLoaded` quedan rotos para cualquier PDF protegido: la **rasterización para OCR** (etapa 2), el **seed del preview** (ADR-044) y el **export** (`renderPage` en `mode: "full"`). Un PDF protegido y escaneado no puede completar el pipeline por dos motivos distintos a la vez.

### 5. Por qué esto no se puede resolver "a criterio del implementador"

`08_Security_Model.md` §6 es normativo y hoy dice, textualmente: el password "viaja **solo en RAM**, en el payload del `pdf-parse` job" (§6.1.3), "no se persiste en ningún lado" (§6.1.6), y §6.3 define un **grep automatizado en CI** (`grep -r "password" packages/ | grep -v "PDF_PASSWORD_REQUIRED\|errors.ts"`) que se pone rojo en cuanto `render-engine` toque la palabra. Cualquier fix amplía la superficie donde vive el secreto: hay que decidirlo y **enmendar §6 explícitamente**, no dejarlo como efecto colateral de un fix.

## Decisión

### 1. El password llega a Render por `loadDocument`, retenido **solo host-side**

```ts
loadDocument(documentId: string, buffer: ArrayBuffer, password?: string): Promise<void>;
```

Parámetro **opcional**: para PDFs no protegidos no cambia nada (ni la firma efectiva, ni el comportamiento, ni un solo call site existente). `LoadDocumentPayload` gana `readonly password?: string`.

### 2. Reparto exacto de dónde vive el secreto

| Dónde | Retiene el password | Hasta cuándo |
|---|---|---|
| Orchestrator (`retainedInputs`) | **sí** | `closeDocument`/`dispose` — el borrado ya existe (`retainedInputs.delete`/`.clear`) |
| Render host (junto a `{ buffer, pageCount }`) | **sí**, solo para re-primear (ADR-043 §5) | `unloadDocument`/`dispose` |
| RenderWorker (kernel) | **no** | lo usa en `getDocument({ data, password })` y no lo guarda: el `PDFDocumentProxy` ya queda abierto |
| Eventos del bus | **no** | invariante intacta (§6.2) |
| Logs | **no** | invariante intacta (§6.1.5, R-9) |
| Disco / storage | **no** | invariante intacta |

El worker no lo retiene porque no lo necesita: una vez abierto el proxy, el password no se vuelve a usar en ese worker. El que sí lo necesita más tarde es el **host**, para re-primear un worker nuevo o reemplazado tras crash — y sin eso el preview de un PDF protegido quedaría muerto hasta reabrir el archivo (ver alternativa C).

### 3. Enmienda de `08_Security_Model.md` §6

- §6.1.3 deja de decir "solo en el payload del `pdf-parse` job": el password viaja **en RAM**, en el payload del job `pdf-parse` **y** en el control broadcast `load-document` de los RenderWorkers. Ningún otro payload, mensaje ni evento.
- §6.1.4 se conserva literal para el OcrWorker/PdfWorker y se extiende al RenderWorker: **el worker lo usa y lo descarta de su scope**, nunca lo guarda en su estado.
- §6.1.6 "no se persiste en ningún lado" se precisa: **no se persiste fuera de RAM** (ni disco, ni IndexedDB, ni `localStorage`, ni logs, ni eventos). En RAM se retiene host-side mientras el documento esté abierto, y se borra en `DOCUMENT_CLOSED`/`dispose`.
- §6.2 (no viaja en eventos del bus) y §6.3 (grep) se conservan; el grep gana una excepción **acotada y enumerada**: `render.engine.ts`, `worker/kernel.ts` y `worker/entry.ts` de `render-engine`, más `types.ts` de `shared` (`LoadDocumentPayload`). Cualquier aparición fuera de esa lista sigue siendo un hallazgo.

### 4. El façade propaga

- `retryWithPassword` **reescribe** `retainedInputs` con el input que incluye el password, antes de re-correr el pipeline. Es el fix del defecto (1) y por sí solo no necesitaba ADR — pero viaja acá porque sin §1 no sirve de nada.
- `ensureRenderDocumentLoaded` pasa `retained.password` a `loadDocument` junto con la copia del buffer.

### 5. Qué **no** cambia

`PdfEngine` ya recibe el password por `PdfEngineInput` y no se toca. `export-engine` no ve el password: ensambla desde imágenes ya rasterizadas. `RenderPagePayload`/`RasterizePagePayload` no cambian: la precondición sigue siendo "documento cargado vía `load-document`". `unloadDocument` no cambia de firma.

### 6. Tests

- `render-engine`: `loadDocument` con password abre un PDF encriptado (fixture `protected.pdf` vía el alias de `tests/`); sin password sobre el mismo PDF → el error de pdfjs se mapea a `RenderFailedError` como hoy; el re-priming de un worker reemplazado recarga el documento protegido (ADR-043 §5).
- Façade: tras `retryWithPassword`, `retainedInputs` contiene el password y `loadDocument` lo recibe (spy); tras `closeDocument`, no queda rastro del password en el estado del Orchestrator.
- E2E Escenario 3 completo: contraseña correcta → pipeline hasta `Ready` **con preview visible**, que es justamente lo que hoy no pasa.

### 7. Dos PRs, en este orden

| # | PR | Módulo | Contenido |
|---|---|---|---|
| 17.4 | `loadDocument` con password | `render-engine` (+ `shared`: `LoadDocumentPayload.password`) | §1, §2 (filas de render host y worker), §6 primer bloque. Parámetro opcional: no rompe ningún caller. |
| 17.5 | Propagación en el façade | `packages/anonymization-core/src` | §4, §6 segundo bloque, y el cierre del Escenario 3 E2E (preview incluido). Depende de 17.4. |

El precedente de `shared` viajando con el PR que lo consume es ADR-034/ADR-047.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **C — pasar el password sin retenerlo en ningún lado** | Respeta §6 casi sin enmienda, pero rompe el re-priming de ADR-043 §5: si un RenderWorker crashea, el documento protegido no se puede recargar y el preview queda muerto —en silencio— hasta que el usuario reabra el archivo. Cambia una garantía de robustez por una diferencia de exposición nula en la práctica: el password ya está en la RAM del mismo proceso, en `retainedInputs`, mientras el documento esté abierto. |
| **B — descifrar una vez en `pdf-engine` y repartir bytes descifrados** | Dejaría §6 literal, pero (a) depende de que `PDFDocumentProxy.saveDocument()` de pdfjs devuelva efectivamente bytes descifrados — **no verificado**, requeriría un spike previo; (b) cambia el contrato de `PdfEngineOutput` con un buffer nuevo; (c) duplica en RAM el documento entero; y (d) mueve el problema en vez de resolverlo: un PDF **descifrado** en RAM del host y clonado en cada RenderWorker no es materialmente más seguro que el password en las mismas memorias. |
| **Rasterizar todo desde `pdf-engine`** (que ya tiene el documento abierto) | Duplicaría la responsabilidad de render en dos motores y violaría el reparto de ADR-030/ADR-043 por un caso de borde. |
| **Dejar el Escenario 3 en `fixme`** | Es un bug de producto: hoy un PDF protegido con la contraseña correcta llega igual al banner de error. Y arrastra OCR y export, no solo el preview. |

## Consecuencias

**Positivas**: el Escenario 3 cierra de punta a punta (extracción, OCR, preview y export sobre un PDF protegido); el parámetro opcional no toca ningún call site existente; el modelo de seguridad queda **escrito** en vez de implícito, con una tabla de dónde vive el secreto y hasta cuándo, y con el grep de CI acotado a una lista enumerada en vez de apagado.

**Negativas**: la superficie donde vive el password crece de un payload de job a dos, más dos retenciones host-side. Es una ampliación real, mitigada por (a) el worker que no retiene, (b) el borrado ya existente en `closeDocument`/`dispose`, y (c) que todo ocurre en RAM de una app 100% local sin backend (ADR-002).

**Neutras**: ningún evento del bus cambia; `export-engine`, `pdf-engine`, `ocr-engine` y `ner-engine` no se tocan; el fallback in-process y el modo worker se comportan igual (el bug estaba en los dos).

## Docs actualizados por este ADR

- `core/Render_Engine.md` v1.6.0: nota de versión, §6 (firma), §10 (semántica de `loadDocument`), §13 (caso nuevo), §14 (tests), §15 (item nuevo).
- `architecture/03_Data_Model.md` §18: `LoadDocumentPayload.password`.
- `architecture/05_Worker_Architecture.md` §7.4: `load-document` lleva el password opcional; el worker no lo retiene; nota en re-priming (§7.4/ADR-043 §5).
- `architecture/08_Security_Model.md` §6: la enmienda de §3 (§6.1.3, §6.1.4, §6.1.6, excepción enumerada del grep de §6.3).
- `core/Orchestrator.md` v1.5.3: `retryWithPassword` persiste el input con password; `ensureRenderDocumentLoaded` lo propaga (§13 caso 3, §14, §15).
- `roadmap/MVP.md` y `adr/ADR-038` §8: PRs 17.4 y 17.5.
- `roadmap/Hito10_Observaciones_Revision.md`: entrada del bug + tarea de seguimiento.

## Validación

- E2E Escenario 3: `protected.pdf` + `test1234` → `PasswordDialog`, pipeline a `Ready`, **preview renderizado**; sin banner de pipeline fallido en ningún punto.
- `render-engine`: los tests de §6 verdes, incluido el re-priming de un worker reemplazado sobre un documento protegido.
- Façade: password presente en `retainedInputs` tras el retry y ausente tras `closeDocument`.
- El grep de `08` §6.3, con la excepción enumerada de §3, no encuentra apariciones nuevas fuera de la lista.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, y `pnpm test:e2e` (con `pnpm assets:mirror` previo).

## Referencias

- `core/Render_Engine.md` §6/§10/§13 — `core/Orchestrator.md` §13 caso 3 — `architecture/08_Security_Model.md` §6 — `architecture/05_Worker_Architecture.md` §7.4 — `architecture/03_Data_Model.md` §18
- `adr/ADR-030` — `adr/ADR-043` §3/§5 — `adr/ADR-044` (seed del preview, uno de los tres caminos afectados) — `adr/ADR-048` §7 punto 1 — `adr/ADR-049`
- Código: `packages/anonymization-core/src/orchestrator.ts` (`retryWithPassword`, `ensureRenderDocumentLoaded`, `retainedInputs`) — `packages/anonymization-core/render-engine/src/render.engine.ts` (`loadDocument`, `documents`) — `packages/anonymization-core/render-engine/src/worker/kernel.ts` (`getDocument`) — `packages/anonymization-core/shared/src/types.ts` (`LoadDocumentPayload`) — `tests/e2e/scenario-3-protected-pdf.spec.ts`
