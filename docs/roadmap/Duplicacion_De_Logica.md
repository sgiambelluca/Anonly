<!-- CONTEXT: scope=roadmap | dependencias=ai/AI_Development_Guide.md,ai/Code_Standards.md,core/Contracts.md,adr/ADR-088-*,adr/ADR-092-* | audiencia=humanos+IA | fase=por-planificar -->

# Duplicación de lógica — misión pendiente

> **Qué es esto**: el inventario de lógica repetida en el repo, levantado el 2026-08-27 durante la campaña de optimización. **No es parte de esa campaña**: no hace la herramienta más rápida, y tocarlo cruza cinco motores más un contrato público. Se aparta acá para retomarlo como misión propia.

**Estado**: relevado y verificado, **sin decidir**. Nada de lo de acá se implementó.

## Por qué esto no es un refactor mecánico

La regla P-1/P-2 del proyecto prohíbe que un motor importe a otro (ESLint lo bloquea). La **única salida legal** para compartir código entre motores es moverlo a `@anonly/shared`, y eso es contrato público: R-2/R-19 exigen ADR primero, docs después, código al final.

Además choca con R-1/R-5 ("un commit = un módulo" desde ADR-124 §1; antes, "un PR"): adoptar una utilidad compartida en cinco motores son cinco commits, salvo que un ADR autorice explícitamente el cambio multi-motor.

**Por eso el criterio de orden de esta lista no es cuántas líneas se ahorran, sino el riesgo de que las copias diverjan en silencio.** Dos copias idénticas y estables valen mucho menos que dos que ya se separaron.

---

## 1. El boilerplate del `entry.ts` de worker, repetido en los cinco motores — **y ya divergió**

`WORKER_ID`, `WORKER_CAPABILITIES`, `applyConfig()`, `post()`, el `Map` de `AbortController` por `signalId`, el `handleRun` que rechaza un `jobType` desconocido y el `addEventListener("message")` con INIT/RUN/CANCEL son el mismo código cinco veces. Los propios archivos lo admiten ("mismo mecanismo que Pdf/Render/OcrWorker").

**Que ya divergió no es una hipótesis** — verificado el 2026-08-27:

| motor | firma de `post()` |
|---|---|
| `pdf-engine/src/worker/entry.ts:127` | `post(message: WorkerOutbound)` |
| `ocr-engine/src/worker/entry.ts:61` | `post(message: WorkerOutbound)` |
| `ner-engine/src/worker/entry.ts:67` | `post(message: WorkerOutbound)` |
| `render-engine/src/worker/entry.ts:106` | `post(message, transfer?: ReadonlyArray<Transferable>)` |
| `export-engine/src/worker/entry.ts:64` | `post(message, transfer?: ReadonlyArray<Transferable>)` |

**Riesgo**: es el punto más sensible del transporte. Un arreglo de cancelación o de seguridad aplicado en un motor y olvidado en otro no lo agarra ningún test — cada motor tiene su propia suite y todas pasarían.

**Camino legal**: `shared` no puede importar Web Workers, pero sí exportar una factory (`createWorkerEntry(...)`) que cada `entry.ts` invoque. Contrato público nuevo → ADR, más cinco migraciones.

**Costo**: grande.

---

## 2. `normalizeNerValue` no pliega diacríticos y `normalizeForComparison` sí — **el de mayor impacto en calidad**

- `ner-engine/src/worker/kernel.ts:222`
- `shared/src/normalize-for-comparison.ts`

Ya documentado en **ADR-088 §3** y **ADR-092 §2**, que registra un caso real donde la diferencia mueve el margen del umbral de fusión difusa en 0,02.

Verificado el 2026-08-27 que **sigue siendo el único** normalizador de texto libre divergente del Core: todo el resto (`regex-engine`, `grouping-engine`) pasa por `normalizeForComparison` de `shared`.

**Riesgo**: alto, y **es el único de esta lista que afecta qué se detecta**. Los demás son mantenibilidad.

---

## 3. Overlap 2D escrito dos veces

| dónde | guarda de área cero |
|---|---|
| `shared/src/words-in-rect.ts:11` (`intersects`, privada del módulo) | **sí** (`width <= 0 \|\| height <= 0 → false`) |
| `render-engine/src/worker/kernel.ts:243` (`overlapsBbox`) | **no** |

Misma fórmula AABB con los términos reordenados. Lo que lo vuelve elocuente: **ese mismo archivo de `render-engine` ya importa `sharesVerticalBand` de `shared`** (línea 41) — el precedente de compartir geometría existe, y este overlap se reimplementó igual.

`intersects` no está exportada, así que reusarla es contrato público nuevo → ADR.

**Riesgo**: bajo hoy (los bboxes de palabras no tienen área cero en la práctica), pero es la semilla exacta de la clase de bug que motivó la errata de ADR-061 §2.

**Costo**: chico.

---

## 4. `sortWordsByReadingOrder` escrito dos veces

- `ocr-engine/src/worker/kernel.ts:358` — el comentario de la línea 353 lo dice con todas las letras: *"Copia local del criterio de orden de lectura"*.
- `pdf-engine/src/pdf.engine.ts:513` — la versión completa, que además maneja runs rotados (ADR-067).

**Riesgo**: medio. Las dos copias **ya no son equivalentes**: la de `pdf-engine` entiende `bbox.rotation` y la de `ocr-engine` no. Si mañana OCR emite palabras rotadas (ADR-090 ya puebla `bbox.rotation` desde OCR), la copia local las ordena mal.

**Costo**: mediano — no es copiar la función, es decidir si el criterio de orden es uno solo para todo el Core.

---

## 5. Siete copias de `test-helpers.ts`

`createEngineContext`, `createMockCache`, `createMockConfig` (con los pool sizes y timeouts hardcodeados) repetidos en los siete motores. **2951 líneas** entre los siete archivos.

**Riesgo**: no toca el output, pero sí la integridad de la suite. Cuando `EngineConfig` gana un campo (pasó en ADR-037, ADR-039…), hay que actualizar siete `createMockConfig` a mano; el que quede con el shape viejo **esconde** un bug detrás de un mock desactualizado en vez de fallar.

**Por qué no es trivial**: `@anonly/shared` declara "sin dependencias externas" y se bundlea a producción — meter `vi.fn()` ahí agregaría `vitest` al bundle. Hace falta un paquete o subpath de test-utils nuevo → ADR de arquitectura.

**Costo**: mediano.

---

## 6. Guarda de `OffscreenCanvas` inconsistente

`render-engine/src/worker/kernel.ts:620` verifica `typeof OffscreenCanvas === "undefined"` antes de construirlo; `ocr-engine/src/worker/kernel.ts:188` (`toTesseractImage`) lo construye directo. Mismo patrón, protección en uno solo.

**Costo**: chico.

---

## Lo que se miró y **NO hay que unificar**

Esta sección importa tanto como la de arriba: unificar una coincidencia es un error, no una mejora.

### `bboxIntersectionRatio` vs `overlapRatioWithRect` — **coincidencia, no duplicación**

- `grouping-engine/src/grouping.engine.ts:426` — denominador = **área menor** de las dos, "para que una entidad pequeña contenida en una más grande cuente como overlap".
- `pdf-engine/src/pdf.engine.ts:743` — denominador = **área del word**, siempre, porque el umbral del 50 % se calibró contra el área del word para el caso de anotaciones (el comentario cita un 91,8 % de solapamiento medido).

Comparten la aritmética de intersección de rectángulos por ser instancias del mismo cálculo geométrico trivial, pero son **dos reglas de negocio distintas**. Unificarlas haría que recalibrar el umbral de una rompa la otra en silencio.

### `clamp` inline (~10 sitios) — **coincidencia inocua**

`Math.min(max, Math.max(min, x))` suelto en cuatro kernels y cuatro archivos de `apps/react-client`. Cada uno acota un dominio distinto (confianza 0-1, zoom 0,5-3, progreso 0-100, índice de página). Tener el rango visible en el call-site es más legible que la indirección. **No tocar.**

---

## Procedencia

Relevado por un agente de investigación el 2026-08-27, dentro de la campaña de optimización. Cada ítem de este documento fue **verificado a mano** contra el código antes de escribirse: las firmas de `post()`, las dos copias de `sortWordsByReadingOrder`, las dos funciones de overlap, la guarda de `OffscreenCanvas` y el conteo de `test-helpers.ts`.
