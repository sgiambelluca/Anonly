<!-- CONTEXT: scope=render-engine | dependencias=core/Contracts.md,architecture/05_Worker_Architecture.md,architecture/06_Pipeline.md,ADR-004-Rendering.md,ADR-012-Replacement-Modes.md | audiencia=IA-implementador | fase=3 -->

# Render Engine — Spec de Motor

> Renderiza páginas del PDF (original o anonimado) a imágenes usando OffscreenCanvas en Web Workers. Produce highlight de grupos habilitados y aplica reemplazos visualmente según `ReplacementMode`. Soporta preview incremental y render full para export.

**EngineId**: `render`
**Versión del spec**: 1.0.0
**Última actualización**: 2026-06-17

---

## 1. Objetivo

Recibir requests de renderizado por página (`RENDER_REQUESTED` o invocación directa del Orchestrator) y producir imágenes (PNG/JPEG) de cada página, aplicando reemplazos visuales para el lado "anonimizado" o solo highlight para el lado "original".

---

## 2. Responsabilidades

- Renderizar páginas del PDF a `ImageData` o `Blob` (PNG/JPEG) usando OffscreenCanvas en `RenderPool`.
- Para `kind = "original"`: render del PDF sin reemplazos, con highlight de grupos habilitados (borde color sobre bbox).
- Para `kind = "anonymized"`: render del PDF con reemplazos aplicados visualmente según `ReplacementMode`:
  - `placeholder` → texto `[<TYPE> <NN>]` sobre bbox.
  - `synthetic` → texto sintético sobre bbox.
  - `mask` → texto censurado (`XX.XXX.XXX`) sobre bbox.
  - `redact` → fill opaco negro sobre bbox (sin texto).
- Soportar dos calidades: `preview` (escala baja, rápido) y `full` (escala alta, para export).
- Soportar delta render: re-render solo las páginas afectadas por un cambio de grupo.
- Emitir `PREVIEW_UPDATED` (por página, preview), `RENDER_FINISHED`, `RENDER_FAILED`, `PREVIEW_PAGE_FAILED`.
- Escuchar `RENDER_REQUESTED` y `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED` para delta render.
- Transferir zero-copy `ImageData`/`ArrayBuffer` de vuelta al host.

---

## 3. Fuera de alcance

- Ensamblar el PDF final (es tarea de `export-engine`).
- Detectar entidades.
- Agrupar ocurrencias.
- Conocer React ni UI.
- Persistir nada.
- Hacer OCR.
- Decidir el modo de reemplazo (lo decide Grouping; Render solo lo aplica).

---

## 4. Dependencias permitidas

- `@anonly/shared`
- `pdfjs-dist` (para render del PDF a canvas; ADR-001)
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `BoundingBox`, `EntityGroup`, `Replacement`, `ReplacementMode`, `Annotation`, `RenderConfig`, `Word`
- `architecture/04_Event_System.md`: `RENDER_REQUESTED`, `RENDER_FINISHED`, `RENDER_FAILED`, `PREVIEW_UPDATED`, `PREVIEW_PAGE_FAILED`, `GROUP_REPLACEMENT_CHANGED`, `GROUP_TOGGLED`

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor
- `tesseract.js`, `@xenova/transformers`, `onnxruntime-web`, `pdf-lib` (pdf-lib es del export-engine)
- Node builtins, libs de network

---

## 6. Interfaces públicas

```ts
export interface RenderEngineConfig {
  readonly previewScale: number;     // default 1.0 (relativo a 72 DPI)
  readonly fullScale: number;        // default 2.08 (~150 DPI)
  readonly jpegQuality: number;      // default 0.85
  readonly cachePages: number;       // default 16 (LRU)
}

export interface RenderPageInput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly mode: "preview" | "full";
  readonly replacements?: ReadonlyArray<Replacement>;  // si kind = "anonymized"
  readonly annotations?: ReadonlyArray<Annotation>;     // highlights, conflicts
  readonly scale?: number;                              // override
  readonly imageFormat?: "png" | "jpeg";               // default png preview, jpeg full
}

export interface RenderPageOutput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly imageData: ImageData;   // transferido (zero-copy) al host
  readonly durationMs: number;
}

export class RenderEngine implements IEngine {
  readonly id = EngineId.Render;
  init(ctx: EngineContext): Promise<void>;
  renderPage(input: RenderPageInput, ctx: EngineContext): Promise<RenderPageOutput>;
  renderPages(inputs: ReadonlyArray<RenderPageInput>, ctx: EngineContext): Promise<ReadonlyArray<RenderPageOutput>>;
  requestDeltaRender(documentId: string, groupIds: ReadonlyArray<string>): void;
  dispose(): Promise<void>;
}
```

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `PREVIEW_UPDATED` | al renderizar preview de una página | `PreviewUpdated` con `kind` (`"original" \| "anonymized"`, ver ADR-016) y `canvasBlobUrl` | async | sí |
| `PREVIEW_PAGE_FAILED` | al fallar preview de una página | `PreviewPageFailed` | async | sí |
| `RENDER_FINISHED` | al terminar un batch de render | `RenderFinished` | async | sí |
| `RENDER_FAILED` | al fallar un batch | `RenderFailed` | async | sí |

Canal: `EventChannel.Render`.

> Nota: `PREVIEW_UPDATED.canvasBlobUrl` es `URL.createObjectURL(blob)` creado en el host a partir del `ImageData` transferido. El motor (worker) devuelve `ImageData`; el host genera el blob URL. Esto evita `createObjectURL` en el worker (no siempre disponible).

---

## 8. Eventos que consume

| Evento | Cuándo | Acción |
|---|---|---|
| `RENDER_REQUESTED` (canal `ui`) | usuario pide preview/export | `renderPages` con los `pageIndices` indicados |
| `GROUP_REPLACEMENT_CHANGED` (canal `grouping`) | cambio de modo/valor en un grupo | `requestDeltaRender(documentId, [groupId])` |
| `GROUP_TOGGLED` (canal `grouping`) | grupo habilitado/deshabilitado | `requestDeltaRender` |

Canales escuchados: `EventChannel.UI`, `EventChannel.Grouping`.

---

## 9. Entradas

```ts
RenderPageInput {
  documentId: string;
  pageIndex: number;
  kind: "original" | "anonymized";
  mode: "preview" | "full";
  replacements?: ReadonlyArray<Replacement>;
  annotations?: ReadonlyArray<Annotation>;
  scale?: number;
  imageFormat?: "png" | "jpeg";
}
```

**Restricciones**:
- `pageIndex ∈ [0, pageCount)`.
- Si `kind = "anonymized"`, `replacements` debe estar poblado.
- `scale` si se omite usa `previewScale` o `fullScale` según `mode`.
- `imageFormat` default: `"png"` para preview (calidad), `"jpeg"` para full (tamaño).

---

## 10. Salidas

```ts
RenderPageOutput {
  documentId: string;
  pageIndex: number;
  kind: "original" | "anonymized";
  imageData: ImageData;  // transferido
  durationMs: number;
}
```

El `ImageData` se transfiere zero-copy al host. El host lo convierte a `Blob` y luego `blobUrl` para la UI.

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `RENDER_PAGE_FAILED` | `RenderPageFailedError` | error de renderizado de una página (PDF.js lanza, OOM en canvas) | sí | reintentar 1 vez, si persiste emitir `PREVIEW_PAGE_FAILED` y continuar con otras páginas |
| `RENDER_TIMEOUT` | `RenderTimeoutError` | timeout (default 10 s por página preview, 30 s full) | sí | reintentar 1 vez |
| `RENDER_FAILED` | `RenderFailedError` | error fatal en batch | no | emitir `RENDER_FAILED`, abortar batch |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `renderPage` antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `renderPage` tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined o `pageIndex` fuera de rango | no | bug del caller |

`retryable`: `RENDER_PAGE_FAILED = true`, `RENDER_TIMEOUT = true`. Resto `false`.

---

## 12. Consideraciones de rendimiento

- Corre en `RenderPool` (workers con OffscreenCanvas).
- Costo: 100–500 ms por página preview; 300–1500 ms por página full (150 DPI).
- Memoria: 40–120 MB por worker (canvas + PDF.js worker para render).
- `ImageData` se transfiere zero-copy de vuelta al host.
- Cache LRU: `cachePages = 16` páginas preview cacheadas en host. Si la página solicitada está en cache, no se re-renderiza.
- Virtualización: solo se renderizan páginas visibles + 1 antes + 1 después. El host envía `RENDER_REQUESTED` solo para visibles.
- Delta render: cuando un grupo cambia, se re-renderizan solo las páginas que tienen `members` de ese grupo. El motor mantiene un index `pageIndex → groupIds` para lookup rápido.
- Preview primero: si el usuario pide export (full), el motor prioriza preview de la página visible por encima del full de las demás.
- Cancelación: entre operaciones de Canvas (fill, drawImage, convertToBlob). SLA < 200 ms.
- Compresión: `convertToBlob({ type: "image/jpeg", quality: 0.85 })` para full; PNG para preview (sin pérdida, más rápido de comprimir en canvas chicos).

---

## 13. Casos límite

1. **Página sin entidades**: render del PDF sin reemplazos. `kind = "anonymized"` con `replacements = []` → idéntico al original (sin highlights).
2. **Grupo `enabled = false`**: las ocurrencias del grupo no se reemplazan en el render anonimizado. Aparecen como texto original.
3. **Modo `redact`**: fill opaco negro sobre bbox. El texto debajo no se incluye (se pinta antes del `convertToBlob`).
4. **Modo `mask`**: texto censurado (`XX.XXX.XXX`) centrado sobre el bbox, con fondo blanco y texto negro.
5. **Modo `placeholder`**: `[DNI 01]` centrado sobre bbox. Fuente monospace si está disponible, fallback sans-serif.
6. **Modo `synthetic`**: valor sintético (`39.123.456`) centrado sobre bbox, con la misma fuente del texto original si es accesible.
7. **Highlight en `kind = "original"`**: borde color (configurable por tipo) sobre el bbox de cada ocurrencia de grupos habilitados. Sin fill, solo borde.
8. **Conflicto**: en `kind = "original"`, marca adicional (borde rojo o icono) sobre el bbox en conflicto.
9. **Página muy grande (A3 o más)**: preview scale reduce, full scale 150 DPI. Si el canvas excede limites del navegador (área máxima), se divide en tiles y se cosen (futuro; MVP limita a A4 150 DPI).
10. **1000 páginas**: virtualización + LRU cache. Solo se renderizan visibles. Memoria pico controlada por `cachePages`.
11. **Delta render sin páginas afectadas**: si un grupo cambia pero no tiene `members` en páginas visibles, no se renderiza nada (no-op).
12. **Cancelación entre páginas**: aborta en < 200 ms. El `ImageData` parcial se descarta.
13. **`renderPage` tras `dispose`**: lanza `EngineDisposedError`.
14. **OffscreenCanvas no disponible (Safari viejo)**: fallback a canvas en main thread (más lento). Detectar con `typeof OffscreenCanvas`. v1.0 puede requerir OffscreenCanvas y mostrar warning si no está.
15. **PDF con rotate (páginas rotadas 90/180/270)**: el render respeta la rotación de la página. Los bbox están en coords de página ya rotada (lo garantiza PDF Engine).

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `renderPage returns ImageData with correct dimensions` | `contract.test.ts` | contract | invariante |
| `emits PREVIEW_UPDATED after preview render` | `contract.test.ts` | contract | invariante |
| `emits RENDER_FINISHED after batch` | `contract.test.ts` | contract | invariante |
| `original kind renders no replacements` | `unit.test.ts` | unit | caso 1/7 |
| `anonymized kind with empty replacements = original` | `edge.test.ts` | edge | caso 1 |
| `disabled group's occurrences appear as original text` | `edge.test.ts` | edge | caso 2 |
| `redact mode paints opaque black over bbox` | `edge.test.ts` | edge | caso 3 |
| `mask mode renders censored text over bbox` | `edge.test.ts` | edge | caso 4 |
| `placeholder mode renders [TYPE NN] over bbox` | `edge.test.ts` | edge | caso 5 |
| `synthetic mode renders synthetic value over bbox` | `edge.test.ts` | edge | caso 6 |
| `highlight border on original kind` | `unit.test.ts` | unit | caso 7 |
| `conflict marker on original kind` | `edge.test.ts` | edge | caso 8 |
| `delta render only re-renders affected pages` | `unit.test.ts` | unit | caso 11 |
| `cancel within 200ms` | `cancel.test.ts` | cancel | caso 12 |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 13 |
| `LRU cache evicts oldest when full` | `unit.test.ts` | unit | cache |
| `cache hit skips render` | `unit.test.ts` | unit | cache |
| `rotated page renders with correct orientation` | `edge.test.ts` | edge | caso 15 |
| `1000 pages only render visible + adjacent` | `stress.test.ts` (en `tests/stress/`) | stress | caso 10 |
| `OffscreenCanvas fallback when unavailable` | `edge.test.ts` | edge | caso 14 |

Fixtures: `tests/fixtures/text-10p.pdf`, `scanned-10p.pdf`, una página con rotación.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/render-engine/`.
- [ ] 2. Definir `types.ts` con `RenderEngineConfig`, `RenderPageInput`, `RenderPageOutput`.
- [ ] 3. Definir `errors.ts` con `RenderPageFailedError`, `RenderTimeoutError`, `RenderFailedError`.
- [ ] 4. Implementar `render.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. Implementar `init` (crear `RenderPool` con OffscreenCanvas workers, fallback a main thread si no disponible).
- [ ] 6. Implementar `renderPage` con `AbortSignal`, transferencia de `ImageData` zero-copy, `PREVIEW_UPDATED` por página.
- [ ] 7. Implementar los 4 modos de reemplazo visual (mask/synthetic/placeholder/redact).
- [ ] 8. Implementar highlight de grupos habilitados y conflicto en `kind = "original"`.
- [ ] 9. Implementar `renderPages` (paralelo, prioridad visible-first).
- [ ] 10. Implementar `requestDeltaRender` (index `pageIndex → groupIds`, lookup, re-render solo afectadas).
- [ ] 11. Implementar LRU cache en host (clave `documentId:pageIndex:kind:mode:hash(replacements)`).
- [ ] 12. Implementar `dispose` (libera OffscreenCanvas y workers inactivos).
- [ ] 13. Escuchar `RENDER_REQUESTED`, `GROUP_REPLACEMENT_CHANGED`, `GROUP_TOGGLED` del bus.
- [ ] 14. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 15. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 16. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 17. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 18. Verificar `index.ts` exporta solo `RenderEngine`, tipos, errores.
- [ ] 19. Verificar imports sin dependencias prohibidas (`grep -r 'react\|tesseract\|onnx\|transformers\|pdf-lib' src/`).
- [ ] 20. Verificar test de cancelación < 200 ms.

---

## Referencias

- `architecture/06_Pipeline.md` §10, §11 (etapas 8 y 10)
- `architecture/05_Worker_Architecture.md` §7.4 (RenderWorker)
- `architecture/07_Performance_Strategy.md` §3 (virtualización), §6 (cache), §10 (compresión)
- `adr/ADR-004-Rendering.md` (reconstrucción)
- `adr/ADR-012-Replacement-Modes.md` (modos visuales)
