<!-- CONTEXT: scope=performance | dependencias=05_Worker_Architecture.md,06_Pipeline.md,03_Data_Model.md | audiencia=IA+humanos | fase=1 -->

# Anonly — Estrategia de Performance (TAD bloque 10)

> Define cómo el sistema cumple los objetivos de performance de `00_Project_Vision.md` §7. Cubre: virtualización, lazy loading, carga progresiva, carga de modelos IA, pool de workers, cache, uso de memoria, liberación de memoria, cancelación, compresión. Incluye la estrategia global de testing (TAD bloque 11).

---

## 1. Objetivos (contractuales)

| Métrica | Objetivo MVP |
|---|---|
| PDF 10 páginas con texto | < 8 s end-to-end (import → ready) |
| PDF 10 páginas escaneadas (OCR) | < 60 s end-to-end |
| Pico de memoria para 50 páginas | < 512 MB |
| Bundle inicial (sin modelos IA) | < 800 KB gz |
| Cancelación efectiva | < 200 ms desde input hasta cese de CPU |
| First preview (página 1, lado original) | < 1.5 s desde import |
| Re-render delta tras editar 1 grupo | < 150 ms |

---

## 2. Bundle y carga perezosa

### 2.1 Estrategia de bundle

- `apps/react-client` se divide en chunks por route/feature. El `react-client` MVP tiene una sola route, pero los engines se cargan dinámicamente:
  - Chunk inicial: React + UI shell + Zustand + Tailwind + Radix base. **< 800 KB gz**.
  - `pdf-engine` chunk: se carga al primer `DOCUMENT_IMPORTED`.
  - `ocr-engine` chunk + Tesseract wasm + modelo `spa+eng`: se carga solo si hay páginas sin texto.
  - `ner-engine` chunk + Transformers.js + ONNX wasm + modelo Q8: se carga solo si NER está activado y hay texto.
  - `render-engine` + `export-engine` chunks: se cargan cuando hay páginas listas o el usuario pide export.

### 2.2 Carga de wasm

- `pdfjs-dist` wasm: cache HTTP (Cache-Control immutable) + integrity hash.
- `tesseract.js` wasm: cacheado en IndexedDB tras primera descarga.
- `onnxruntime-web` wasm: cacheado en Cache Storage.
- Todos con `Subresource Integrity` (SRI) para mitigar supply chain (ver `08_Security_Model.md`).

### 2.3 Carga de modelos IA

- Modelo NER: `Xenova/bert-base-NER` o equivalente multilingüe, cuantizado Q8. Tamaño ~ 50–80 MB.
- Cache en Cache Storage del navegador con versionado por `modelId`.
- Lazy: solo se descarga la primera vez que se necesita NER. En sesiones siguientes, se sirve desde cache.
- Progreso de descarga se reporta vía `NER_MODEL_LOADING`.
- Si el usuario desactiva NER en settings, no se descarga nunca.
- Estrategia "warm": al cargar la app, se **pre-fetcha** el wasm de PDF.js (probable uso). Los modelos NER/OCR **no** se prefetchan.

---

## 3. Virtualización de páginas

El visor de PDF virtualiza páginas: solo renderiza las visibles + 1 antes + 1 después.

- `PageVirtualizer` (componente UI): mantiene un pool de `<canvas>` reutilizables.
- Al hacer scroll, recicla los canvas fuera de viewport.
- El "phantom" de cada página (dimensión + placeholder gris) se renderiza siempre para mantener scroll height correcto.
- RenderEngine despacha `render-page` solo para páginas visibles, con prioridad mayor (ver `05_Worker_Architecture.md` §6.2).
- El scroll usa `IntersectionObserver` y `requestAnimationFrame` para no thrashear.

### 3.1 Lado a lado

- Original y anonimizado son dos virtualizers sincronizados: scroll vertical compartido vía estado Zustand.
- El render de "original" es más barato (sin reemplazos), se prioriza para first paint.
- El de "anonimizado" se renderiza en segundo plano con prioridad menor.

---

## 4. Carga progresiva e incremental

### 4.1 Streaming de detecciones

- `ENTITY_FOUND` se emite a medida que se detectan, no al final. La UI muestra el árbol de entidades crecer en vivo.
- `ENTITY_GROUP_CREATED` se emite incrementalmente. El usuario puede empezar a editar grupos antes de que termine todo el pipeline.

### 4.2 Preview incremental

- `PREVIEW_UPDATED` se emite por página, no en bloque. La página 1 visible se renderiza primero.
- El usuario ve el PDF original casi inmediatamente, y el anonimizado se va llenando.

### 4.3 OCR con feedback

- `OCR_STARTED` muestra "Procesando X páginas con OCR…".
- `OCR_PAGE_FINISHED` actualiza progreso y permite preview de esa página ya con texto.

---

## 5. Pool de workers

Ver `05_Worker_Architecture.md` para detalle. Resumen performance:

- Tamaños default derivan de `navigator.hardwareConcurrency`.
- Pools separados permiten no bloquear OCR (lento) contra render (rápido).
- Backpressure: si `queue.length > MAX_QUEUE_PER_POOL`, se pausa el ingreso (no se hace OOM).
- Reutilización de modelos cargados entre jobs del mismo worker (no se recarga Tesseract/ONNX por página).

### 5.1 Ajuste dinámico

- Si el dispositivo reporta `deviceMemory < 4` GB o `hardwareConcurrency < 4`, se reducen los tamaños de pool a 1 para OCR/NER y 2 para PDF/Render.
- Si el usuario activa "Modo documento grande" en settings, se reduce `renderPoolSize` a 1 y se incrementan timeouts (más cola, menos CPU concurrente).

---

## 6. Cache

| Cache | Lugar | Política | Tamaño típico |
|---|---|---|---|
| Modelo NER ONNX | Cache Storage | inmutable por `modelId` | ~ 80 MB |
| Modelo Tesseract | IndexedDB | inmutable por `modelVersion` | ~ 30 MB |
| Wasm de pdf.js / tesseract / onnx | HTTP cache + SRI | inmutable por hash | 5–20 MB |
| `Page.words` parseadas | LRU en host, por `documentId+pageIndex` | 32 páginas | 5–20 MB |
| `ImageData` de página renderizada | LRU en host | 16 páginas | 50–200 MB |
| `EntityGroup[]` por documento | en memoria, por sesión | 1 documento activo | 1–10 MB |

Toda LRU tiene límite por **cantidad de items** y por **bytes** (lo que se alcance primero). Al evictar, libera `ArrayBuffer` con `transfer` o lo abandona al GC.

---

## 7. Uso de memoria

### 7.1 Presupuesto por sesión (MVP, 50 páginas)

| Componente | Presupuesto | Notas |
|---|---|---|
| Bundle inicial + React shell | 80 MB | |
| `pdf-engine` wasm + worker | 80 MB | |
| `ocr-engine` (solo si OCR) | 300 MB | Tesseract + modelo |
| `ner-engine` (solo si NER) | 400 MB | ONNX + modelo Q8 |
| `Document` en memoria | 20 MB | 50 páginas con texto |
| Cache LRU `Page.words` | 20 MB | |
| Cache LRU `ImageData` | 200 MB | 16 páginas |
| `EntityGroup[]` + `Annotation[]` | 10 MB | |
| Render workers (x4) | 480 MB | 120 MB c/u, compartido con export |
| **Total pico (con OCR + NER)** | **~ 1.6 GB** | Bajo objetivo. Sin OCR/NER: ~ 870 MB. |

Para 50 páginas, objetivo pico < 512 MB implica que OCR + NER no pueden correr simultáneos en dispositivos chicos. Estrategia: si `deviceMemory < 4` GB, **serializar** OCR y NER (no paralelos), y reducir caches LRU a 8 páginas.

### 7.2 Monitoreo

- `performance.memory` (Chrome) se muestrea cada 5 s en dev mode.
- Si se excede 80% del budget estimado, el Orchestrator emite `WORKER_POOL_SATURATED` y pausa ingest.
- En prod, se loguea (vía `ctx.logger`) pico de memoria al cerrar documento.

---

## 8. Liberación de memoria

- `DOCUMENT_CLOSED` libera: caches LRU (`Page.words`, `ImageData`), `Document`, `EntityGroup[]`, `Rule[]`, `Annotation[]`, `Conflict[]`, `Replacement[]`.
- Workers del pool se `DISPOSE` tras 60 s idle. No antes (para no recargar modelos si el usuario abre otro PDF en seguida).
- `URL.createObjectURL` se revoca con `URL.revokeObjectURL` al cerrar o al reemplazar preview.
- `OffscreenCanvas` se destruye con `canvas.transferControlToOffscreen` + `worker.terminate` en dispose.
- `ArrayBuffer` transferidos al worker se liberan del host automáticamente (zero-copy).

### 8.1 Limpieza garantizada

- Todo `IEngine` implementa `dispose()` que **debe** liberar todo. Hay un test de leak que carga y cierra 10 documentos consecuidos y verifica que la memoria regresó al baseline.

---

## 9. Cancelación de tareas

Ver `05_Worker_Architecture.md` §3. Resumen performance:

- SLA < 200 ms desde `CANCEL_REQUESTED` hasta cese de CPU.
- Checkpoints en workers cada ≤ 50 ms de trabajo.
- El Orchestrator cancela **todos** los jobs del `documentId` y aborta el `AbortController` maestro.
- El pipeline puede reanudarse desde la última etapa completada (no desde cero) si el usuario solo pausa (no cancela totalmente). En MVP, solo soportamos cancelación total; pausa/reanudación es v1.0.

---

## 10. Compresión

| Dónde | Técnica | Razón |
|---|---|---|
| `ImageData` → PNG en worker | `OffscreenCanvas.convertToBlob({ type: "image/png" })` o JPEG con quality 0.85 | reduce tamaño de preview/export |
| `Page.words` cache | sin compresión (ya es liviano) | descompresión costaría más |
| `ArrayBuffer` entre worker y host | **sin** compresión (transfer zero-copy) | compresión mataría el beneficio |
| Export PDF final | pdf-lib + imágenes JPEG | balance tamaño/calidad |
| Comunicación bus de eventos | sin compresión | payloads chicos |

El export expone `imageQuality` y `imageFormat` en `ExportOptions` para que el usuario elija.

---

## 11. Testing (TAD bloque 11 — estrategia global)

Cada motor tiene sus tests específicos en su spec. Aquí la estrategia **global**.

### 11.1 Tipos de test

| Tipo | Herramienta | Scope | Obligatorio |
|---|---|---|---|
| Unit | Vitest | función/clase | sí, ≥ 85% líneas por motor |
| Contract | Vitest | interfaz pública vs spec | sí, 100% métodos |
| Snapshot | Vitest | `DocumentModel` de fixture estable | sí, en PDF/OCR/Grouping |
| Integration | Vitest | dos motores vía bus | sí, al menos 1 por par crítico |
| E2E | Playwright | flujo completo en navegador real | sí, escenarios críticos |
| Performance | Vitest bench + custom | métricas de `00_Project_Vision.md` §7 | sí, gate de CI |
| Stress | custom | documentos grandes | sí |
| Cancelación | custom | SLA < 200 ms | sí |
| Race conditions | custom + Playwright | edición concurrente con pipeline | sí |

### 11.2 Fixtures

`tests/fixtures/` (en raíz del repo, fuera de `docs/`):

| Fixture | Tamaño | Propósito |
|---|---|---|
| `text-10p.pdf` | ~ 100 KB | PDF con texto, 10 páginas, caso base |
| `text-50p.pdf` | ~ 500 KB | PDF con texto, 50 páginas, stress |
| `scanned-10p.pdf` | ~ 5 MB | PDF escaneado, requiere OCR |
| `corrupt.pdf` | ~ 1 KB | header inválido |
| `protected.pdf` | ~ 100 KB | protegido con password "test1234" |
| `empty.pdf` | ~ 1 KB | 0 páginas |
| `huge-1000p.pdf` | ~ 10 MB | 1000 páginas, stress extremo |
| `mixed-30p.pdf` | ~ 3 MB | 15 con texto + 15 escaneadas |

Fixtures pesados (> 5 MB) vía Git LFS o descargados en `postinstall` con hash verificado.

### 11.3 Escenarios críticos E2E

1. Cargar PDF con texto → ver grupos aparecer → editar modo de un grupo → exportar → descargar.
2. Cargar PDF escaneado → ver progreso OCR → ver grupos → exportar.
3. Cargar PDF protegido → UI pide password → reintenta → success.
4. Cargar PDF enorme → cancelar a mitad → verificar cese de CPU < 200 ms.
5. Editar grupo mientras NER sigue corriendo → verificar que no se pierden ediciones.
6. Cargar PDF corrupto → verificar error tipado y mensaje claro.
7. Abrir y cerrar 10 documentos consecutivos → verificar memoria回归 baseline.
8. Cargar PDF sin NER activado → verificar que solo Regex detecta.
9. Activar NER en runtime → verificar que se descarga modelo y reanaliza.
10. Fusionar y dividir grupos → verificar índices y reemplazos.

### 11.4 Gates de CI

| Gate | Comando | Falla si |
|---|---|---|
| Lint | `pnpm lint` | cualquier warning |
| Typecheck | `pnpm typecheck` | cualquier error |
| Unit + contract | `pnpm test` | cobertura < 85% en módulos tocados |
| Snapshot | `pnpm test:snapshot` | cualquier drift |
| E2E | `pnpm test:e2e` | cualquier escenario crítico rojo |
| Performance | `pnpm test:perf` | cualquier métrica de `00_Project_Vision.md` §7 fuera de target ± 10% |
| Leak | `pnpm test:leak` | memoria no regresa al baseline |
| Cancel | `pnpm test:cancel` | SLA > 200 ms en cualquier motor |

### 11.5 Documentos corruptos y edge

- Cada motor debe tener un test por cada "Caso límite" de su spec.
- Edge cases globales: PDF de 0 páginas, PDF de 1000 páginas, página sin texto, página solo imágenes, PDF con JavaScript embebido, PDF con forms, PDF con bookmarks, PDF con XMP sensible.

### 11.6 Race conditions

- Edición concurrente con pipeline: el usuario edita un grupo mientras `ENTITY_FOUND` sigue llegando. Grouping debe **mergear** sin perder ediciones del usuario (gana el usuario en conflictos de `replacementMode`).
- Doble export simultáneo: el segundo `EXPORT_REQUESTED` se encola, no se superpone.
- Cancelar durante export: el export se aborta, el archivo parcial se descarta.

---

## 12. Referencias

- `00_Project_Vision.md` §7 — métricas contractuales.
- `05_Worker_Architecture.md` — pools, timeouts, reintentos.
- `06_Pipeline.md` — flujo de etapas.
- `08_Security_Model.md` — SRI, CSP, sanitización.
- `ai/Code_Standards.md` §10 — obligaciones de tests por PR.
- `adr/ADR-010-Testing-Strategy.md` — decisión de Vitest + Playwright.
