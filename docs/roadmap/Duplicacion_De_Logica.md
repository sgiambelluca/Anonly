<!-- CONTEXT: scope=roadmap | dependencias=ai/AI_Development_Guide.md,ai/Code_Standards.md,core/Contracts.md,adr/ADR-088-*,adr/ADR-092-*,adr/ADR-127-*,adr/ADR-128-*,adr/ADR-129-* | audiencia=humanos+IA | fase=por-planificar -->

# Duplicación de lógica — misión pendiente

> **Qué es esto**: el inventario de lógica repetida en el repo, levantado el 2026-08-27 durante la campaña de optimización. **No es parte de esa campaña**: no hace la herramienta más rápida, y tocarlo cruza cinco motores más un contrato público. Se aparta acá para retomarlo como misión propia.

**Estado**: relevado y verificado. **§1, §3, §4, §5 y §6 cerrados**. Queda abierto **solo §2**, y no por costo: es el único que cambia *qué se detecta* y sigue sin haber forma de medirlo.

## Por qué esto no es un refactor mecánico

La regla P-1/P-2 del proyecto prohíbe que un motor importe a otro (ESLint lo bloquea). La **única salida legal** para compartir código entre motores es moverlo a `@anonly/shared`, y eso es contrato público: R-2/R-19 exigen ADR primero, docs después, código al final.

Además choca con R-1/R-5 ("un commit = un módulo" desde ADR-124 §1; antes, "un PR"): adoptar una utilidad compartida en cinco motores son cinco commits, salvo que un ADR autorice explícitamente el cambio multi-motor.

**Por eso el criterio de orden de esta lista no es cuántas líneas se ahorran, sino el riesgo de que las copias diverjan en silencio.** Dos copias idénticas y estables valen mucho menos que dos que ya se separaron.

---

## 1. ~~El boilerplate del `entry.ts` de worker, repetido en los cinco motores~~ — **CERRADO el 2026-09-03 (ADR-128)**

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

> **Cerrado por ADR-128**: `startWorkerEntry` en `@anonly/shared` (`Contracts.md` §6) y los cinco motores migrados, un commit cada uno. Las líneas de los cinco `entry.ts` pasan de **1033 a 712**, y la divergencia de `post()` desaparece: la transfer list se declara con `transferablesOf`, que es una decisión del motor sobre su resultado y no una firma distinta del transporte.
>
> **Dos hallazgos de la implementación, que el relevamiento no tenía.** Los puntos de variación no eran cinco sino **siete**: el `CANCEL` de `export` descarta además el `PDFDocument` parcial (ADR-047 §4), y el `READY` eager de `pdf` espera a `engine.init()`. Los dos se habrían perdido en silencio en una migración mecánica, y ninguno lo agarraba un test — aparecieron comparando cada archivo contra su original. Es la evidencia más directa de por qué este ítem encabezaba la lista por riesgo.
>
> La factory se lleva además **19 tests** del transporte: el mapeo de errores que cruzan la frontera, la cancelación por `signalId` y la limpieza del `Map`. Los gates de la migración fueron los `worker-entry.test.ts` de `pdf`, `ocr` y `render` —11 cada uno, que importan el `entry.ts` real y pasaron sin tocarse— y `pnpm test:e2e` (17/17), que es lo único que ejercita los de `ner` y `export`.

---

## 2. `normalizeNerValue` no pliega diacríticos y `normalizeForComparison` sí — **el de mayor impacto en calidad**

- `ner-engine/src/worker/kernel.ts:222`
- `shared/src/normalize-for-comparison.ts`

Ya documentado en **ADR-088 §3** y **ADR-092 §2**, que registra un caso real donde la diferencia mueve el margen del umbral de fusión difusa en 0,02.

Verificado el 2026-08-27 que **sigue siendo el único** normalizador de texto libre divergente del Core: todo el resto (`regex-engine`, `grouping-engine`) pasa por `normalizeForComparison` de `shared`.

**Riesgo**: alto, y **es el único de esta lista que afecta qué se detecta**. Los demás son mantenibilidad.

> **Sigue abierto al 2026-09-03, por el mismo motivo de siempre.** ADR-092 lo dejó anotado porque *"no hay dataset para medir ese cambio"*, y la campaña posterior agregó uno (`tests/fixtures/reference/`, 26 documentos con ground truth) — pero **no alcanza para éste**: el evaluador corre con **NER apagado** a propósito (ADR-095 §5) y excluye del recall las 17 entidades de tipo `ner`. Medir este cambio pide que el evaluador corra el modelo, que es una decisión propia (tiempo de corrida, determinismo del modelo cuantizado) y no un efecto colateral de tener el dataset. Hasta entonces, tocarlo sería mover cómo se compara **todo** valor de NER sin evidencia que lo pida — exactamente lo que ADR-088 §3 se negó a hacer.

---

## 3. ~~Overlap 2D escrito dos veces~~ — **CERRADO el 2026-09-03 (ADR-127)**

| dónde | guarda de área cero |
|---|---|
| `shared/src/words-in-rect.ts:11` (`intersects`, privada del módulo) | **sí** (`width <= 0 \|\| height <= 0 → false`) |
| `render-engine/src/worker/kernel.ts:243` (`overlapsBbox`) | **no** |

Misma fórmula AABB con los términos reordenados. Lo que lo vuelve elocuente: **ese mismo archivo de `render-engine` ya importa `sharesVerticalBand` de `shared`** (línea 41) — el precedente de compartir geometría existe, y este overlap se reimplementó igual.

`intersects` no está exportada, así que reusarla es contrato público nuevo → ADR.

**Riesgo**: bajo hoy (los bboxes de palabras no tienen área cero en la práctica), pero es la semilla exacta de la clase de bug que motivó la errata de ADR-061 §2.

**Costo**: chico.

> **Cerrado por ADR-127**: `rectsOverlap` en `@anonly/shared` (`Contracts.md` §6), con la semántica de la copia que estaba bien —estricto, y un rectángulo sin área no se solapa con nada—; `wordsInRect` y el kernel de `render-engine` la usan, y `overlapsBbox` desaparece. Hallazgo de la implementación: `Render_Engine.md` §15 item 28 **ya había decidido no promoverlo**, por "es otra pregunta" (cierto, y el ADR lo sostiene: no reemplaza a `sharesVerticalBand`) y por "tiene un solo consumidor" (falso — `shared` ya tenía la misma AABB en privado). El ADR supersede esa media línea.

---

## 4. ~~`sortWordsByReadingOrder` escrito dos veces~~ — **CERRADO el 2026-09-03: no era duplicación**

- `ocr-engine/src/worker/kernel.ts:358` — el comentario de la línea 353 lo dice con todas las letras: *"Copia local del criterio de orden de lectura"*.
- `pdf-engine/src/pdf.engine.ts:513` — la versión completa, que además maneja runs rotados (ADR-067).

**Riesgo**: medio. Las dos copias **ya no son equivalentes**: la de `pdf-engine` entiende `bbox.rotation` y la de `ocr-engine` no. Si mañana OCR emite palabras rotadas (ADR-090 ya puebla `bbox.rotation` desde OCR), la copia local las ordena mal.

**Costo**: mediano — no es copiar la función, es decidir si el criterio de orden es uno solo para todo el Core.

> **Cerrado, y la conclusión es que el ítem estaba mal encuadrado.** Verificado sobre el árbol, en este orden:
>
> 1. **La decisión ya estaba tomada y escrita.** `OCR_Engine.md` §10 dice, textual: *"Este orden es interno de este motor y no es el que ve el detector (ADR-110). `fuseOcrPage`/`fuseOcrRegion` re-ordenan las palabras al fusionarlas… Este motor **no cambia**"*. El relevamiento no vio esa línea.
> 2. **Y el riesgo que el ítem describía no existe.** *"Si mañana OCR emite palabras rotadas, la copia local las ordena mal"* — `fuseOcrPage` (`pdf.engine.ts`) **re-ordena** las palabras del OCR con la versión completa, la que sí entiende `bbox.rotation`. El orden que llega al detector sale siempre de ahí. Riesgo real: **bajo**, no medio.
> 3. **Ya no son dos copias de lo mismo.** La de `pdf-engine` creció con el agrupado por renglones (ADR-110), el corte por columnas (ADR-113) y la hoja torcida (ADR-120): ~40 líneas. La de `ocr-engine` son ocho que ordenan lo que su kernel devuelve, en el espacio de **píxeles** donde su tolerancia de 1 px significa lo que dice (ADR-064 §2). Unificarlas ataría la tolerancia del kernel a un cambio de otro motor.
>
> **Lo que sí estaba mal, y se arregló**: el comentario inline de `OcrPageOutput.words` prometía *"ordenadas por `bbox.y` asc, luego `bbox.x` asc"*, y desde **ADR-121** eso ya no describe el array — las palabras de las franjas de margen rotadas se concatenan **después** del sort, sin re-ordenar. La promesa estaba desactualizada, no el código. Corregida en el spec, y el comentario del kernel pasa a decir que su orden es deliberadamente local en vez de leerse como una copia que quedó suelta.

---

## 5. ~~Siete copias de `test-helpers.ts`~~ — **CERRADO el 2026-09-03 (ADR-129)**

`createEngineContext`, `createMockCache`, `createMockConfig` (con los pool sizes y timeouts hardcodeados) repetidos en los siete motores. **2951 líneas** entre los siete archivos.

**Riesgo**: no toca el output, pero sí la integridad de la suite. Cuando `EngineConfig` gana un campo (pasó en ADR-037, ADR-039…), hay que actualizar siete `createMockConfig` a mano; el que quede con el shape viejo **esconde** un bug detrás de un mock desactualizado en vez de fallar.

**Por qué no es trivial**: `@anonly/shared` declara "sin dependencias externas" y se bundlea a producción — meter `vi.fn()` ahí agregaría `vitest` al bundle. Hace falta un paquete o subpath de test-utils nuevo → ADR de arquitectura.

**Costo**: mediano.

> **Cerrado por ADR-129**: `@anonly/test-utils`, paquete de workspace privado y solo `devDependency`. Los siete `test-helpers.ts` de motor pasan de **3067 a 2601 líneas**, y lo que se mudó es lo que era idéntico: `createMockLogger` y `createMockCache` lo eran **byte a byte en los seis**, `createMockBus` en los cinco que lo tenían, y el bloque `workerPool` de `createMockConfig` en las seis versiones.
>
> **Dos cosas que la migración enseñó**, las dos por romper tests antes de arreglarlos: (1) los campos **propios** de cada motor en `createMockConfig` —los idiomas de OCR, el `modelId` de NER— son load-bearing, así que cada motor conserva un wrapper delgado sobre el `workerPool` compartido; (2) `createEngineContext` arma su config adentro, así que heredarlo sin pasarle la del motor deja `ctx.config` con los defaults genéricos. Las dos fallas fueron ruidosas —123 tests en rojo—, que es lo contrario del riesgo que este ítem describía.
>
> El gate fue **el conteo**: 1894 tests antes y 1894 después. Un test perdido habría significado un doble que cambió de comportamiento.

---

## 6. ~~Guarda de `OffscreenCanvas` inconsistente~~ — **CERRADO el 2026-09-03**

`render-engine/src/worker/kernel.ts:620` verifica `typeof OffscreenCanvas === "undefined"` antes de construirlo; `ocr-engine/src/worker/kernel.ts:188` (`toTesseractImage`) lo construye directo. Mismo patrón, protección en uno solo.

**Costo**: chico.

> **Cerrado** (`OCR_Engine.md` §15 item 28, sin ADR: no toca contratos). Lo que cambia no es que falle —el constructor ya fallaba— sino **cómo**: un `ReferenceError` crudo no es `OcrPageFailedError`, así que no llegaba como `OCR_PAGE_FAILED` y la página se perdía sin el aviso de análisis incompleto de ADR-094.

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
