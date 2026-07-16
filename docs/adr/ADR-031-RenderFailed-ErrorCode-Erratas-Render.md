<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Render_Engine.md,ai/Code_Standards.md,adr/ADR-030-RenderEngine-LoadDocument.md | audiencia=humanos+IA | fase=7 -->

# ADR-031 — `EngineErrorCode.RENDER_FAILED` + fe de erratas del spec de Render (cache key, highlight, cast de frontera pdfjs)

- **Estado**: Accepted
- **Fecha**: 2026-07-16
- **Decidido por**: El humano, sobre ambigüedad reportada por el implementador en el Hito 7 (segunda detención del hito)
- **Relacionado con**: ADR-029 §4 (precedente: cambio habilitante en `@anonly/shared` viaja en el PR del motor, docs primero), ADR-030 (cuya §2 asumió que el code existía), ADR-019 (casts de frontera en tests)

## Contexto

`Render_Engine.md` §11 lista desde v1.0.0 el error `RENDER_FAILED` / `RenderFailedError`
("error fatal en batch"), pero `Contracts.md` §4 y `shared/src/enums.ts` nunca definieron
`EngineErrorCode.RENDER_FAILED` — para Render solo existen `RENDER_PAGE_FAILED` y
`RENDER_TIMEOUT`. `RENDER_FAILED` existe únicamente como **evento** (`EngineEvents`), que es un
enum distinto. Efecto: `render.errors.ts` no compila (TS2339), único fallo de typecheck del
monorepo. ADR-030 §2 agravó la contradicción al reutilizar ese code para el fallo de
`getDocument()` afirmando "sin tocar la tabla de error codes de Contracts.md" — la fila de §11
nunca tuvo respaldo en Contracts.

El implementador además señaló tres puntos donde el spec y la realidad implementable divergen
(cache key, color de highlight, tipado de pdfjs), documentados abajo como erratas/excepciones.

## Decisión

### 1. `RENDER_FAILED` se agrega a `EngineErrorCode`

En `Contracts.md` §4 y `shared/src/enums.ts`, sección Render:

```ts
RENDER_FAILED = "RENDER_FAILED", // fatal de batch (ADR-031)
```

- **Precedente directo**: `EXPORT_FAILED` ya existe con el mismo nombre en ambos enums
  (`EngineEvents` y `EngineErrorCode`); Export es el motor simétrico (fallo fatal de batch).
  La ausencia en Render era omisión, no diseño.
- **Alternativa rechazada** — reutilizar `RENDER_PAGE_FAILED` para el fallo de batch: miente en
  la semántica (`RENDER_PAGE_FAILED` es por página y `retryable: true`; el de batch es fatal y
  no recuperable).
- La línea en `enums.ts` viaja en el **PR del Hito 7** (precedente ADR-029 §4: el cambio
  habilitante en `@anonly/shared` acompaña al PR del motor, con los docs actualizados primero —
  este ADR y `Contracts.md` son ese "primero").
- La afirmación de ADR-030 §2 ("sin tocar la tabla de error codes") queda **superada** por este
  ADR; el mapeo de errores de ADR-030 §2 no cambia.

### 2. Errata: la clave del cache LRU incluye `annotations`

`Render_Engine.md` §15 (checklist, ítem 12) decía `documentId:pageIndex:kind:mode:hash(replacements)`.
Con esa clave, dos renders `kind: "original"` de la misma página con distintos highlights
(`annotations` distintas, `replacements` ausentes) **colisionarían**. Clave corregida:

```
documentId:pageIndex:kind:mode:hash(replacements ++ annotations)
```

### 3. Errata: highlight por `AnnotationKind`, no "por tipo"

`Render_Engine.md` §13.7 decía "borde color (configurable por tipo)". `Annotation`
(03_Data_Model.md) no transporta `EntityType` (solo `kind`, `groupId`, `bbox`), y resolver
`groupId → EntityType` exigiría que Render conozca grupos (fuera de alcance, §3 del spec).
El color se asigna por `AnnotationKind`. Si la UI necesitara color por tipo de entidad, será
`Annotation` quien lo transporte (decisión futura, con su propio ADR).

### 4. Excepción: cast de frontera pdfjs ↔ OffscreenCanvas en producción

`pdfjs-dist@4.x` tipa `PDFPageProxy.render({ canvasContext })` como `CanvasRenderingContext2D`
(DOM); el spec exige `OffscreenCanvas`. Verificado: no hay overlap suficiente para un `as`
simple (TS2352) y los tipos re-exportados por pdfjs son alias (no admiten module augmentation).
Se permite `as unknown as CanvasRenderingContext2D` **solo** en esa frontera, **en un único
punto** del motor, con comentario justificativo adyacente que cite este ADR. `Code_Standards.md`
§10 gana la nota correspondiente (hasta ahora solo exceptuaba casts de frontera en helpers de
test). No es licencia general: para tipos propios sigue prohibido.

### 5. Notas no normativas (shortcuts inline aceptados, revisar en Hito 9)

- **`PREVIEW_UPDATED.canvasBlobUrl` inline**: en Hito 7 el motor envuelve los bytes crudos del
  `ImageData` en un `Blob` sin codificación real de imagen (no es un PNG/JPEG decodificable).
  Aceptado como placeholder: el spec §7 ya asigna la creación real del blob al **host**
  (`convertToBlob`), que llega con el Orchestrator (Hito 9). Ítem a verificar en ese hito.
- **`stress.test.ts` en `src/__tests__/`**: `tests/stress/` no existe aún en el repo y hoistear
  `pdfjs-dist` a la raíz excede el alcance del PR. Se mueve cuando exista la infra (Hito 9/11),
  igual que los stress pendientes de NER.

## Consecuencias

**Positivas**: el monorepo vuelve a compilar con el spec cumplible al pie de la letra; la
asimetría Render/Export en error codes queda cerrada; el revisor tiene regla citable para el
único `as unknown as` de producción en vez de rechazarlo por P-3/§10; dos erratas del spec
(cache key, highlight) quedan corregidas antes de fosilizarse.

**Negativas**: un cast de frontera vive en código de producción (acotado a un punto, documentado,
revisable cuando pdfjs corrija sus tipos); dos ítems quedan diferidos a Hito 9 (blob real,
ubicación del stress test) y deben rastrearse en el roadmap.

## Referencias

- `core/Contracts.md` §4 — `core/Render_Engine.md` §11, §13.7, §14, §15
- `ai/Code_Standards.md` §10 — `packages/anonymization-core/shared/src/enums.ts`
- `adr/ADR-029-Occurrence-MaskFormat-Plate-Variantes.md` §4 — `adr/ADR-030-RenderEngine-LoadDocument.md` §2
