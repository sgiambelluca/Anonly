<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/OCR_Engine.md,core/Orchestrator.md,07_Performance_Strategy.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-065-OCR-Por-Region.md | audiencia=humanos+IA | fase=11 -->

# ADR-145 — El depósito no expulsa lo que acaba de guardar

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El planificador, resolviendo D-11 del plan de campaña de hardening (§2, §2.1, §14.2).
- **Relacionado con**: ADR-014 §1 (el depósito de palabras), ADR-045 §1 (depósito y emisión en ese orden), ADR-041 §3 (la fusión síncrona)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. La caché de palabras cuenta items pero no bytes

`LruCache.set(key, value, bytes?)` (`packages/anonymization-core/src/cache.ts`)
interpreta `bytes` ausente como **cero**. `OcrEngine` deposita las palabras de
cada página con `ctx.cache.set(cacheKey(documentId, pageIndex), words)`, sin
tercer argumento.

Consecuencia: esas entradas cuentan contra el límite de **32 items** y no
cuentan nada contra el de **64 MiB**. La política de
`07_Performance_Strategy.md` §6 —"toda LRU tiene límite por cantidad de items y
por bytes, lo que se alcance primero"— tiene, para este depósito, un solo
límite activo.

Esta es la caché de **palabras** del Orchestrator. No es la lista de `ImageData`
de H-09A ni la LRU de `RenderEngine` (que sí lleva su propia contabilidad, con
`estimateEntryBytes`). Arreglar ésta no mejora la memoria de aquéllas, y
atribuirle esa mejora sería un error de lectura de la medición.

### 2. Y el consumidor de esas palabras las pierde en silencio

`Orchestrator.handleOcrPageFinished` lee la entrada y, si no está:

```ts
this.logger.warn("OCR_PAGE_FINISHED sin ocr-words en cache; se ignora la fusión.", …);
return;
```

Con el logger nulo del façade eso es **nada**: la página queda sin palabras, sin
texto, sin detección y sin error. Es la peor forma de fuga que este sistema
puede producir, porque el documento sigue su curso hasta `Ready` como si todo
hubiera salido bien.

Hoy esa rama es prácticamente inalcanzable porque el depósito y el consumo
ocurren en el mismo turno de evento (`emit` es síncrono, ADR-041 §3). El riesgo
aparece **al empezar a contar bytes**: una entrada más grande que el máximo se
expulsaría a sí misma adentro de `set()`, antes de que se emita
`OCR_PAGE_FINISHED`.

### 3. Cuánto pesa realmente una página de palabras

Orden de magnitud, con la forma de `Word` (`text`, `bbox` de cuatro números,
`pageIndex`, `confidence`, `source`): una página densa de ~2.000 palabras
estimadas en ~200 bytes cada una son ~0,4 MB. Contra 64 MiB, el límite que ata
sigue siendo el de 32 items, no el de bytes. Contar bytes acá **no** es una
optimización de memoria: es cerrar el agujero de contabilidad y, sobre todo,
dejar de tener un límite que no mide nada.

## Decisión

### 1. La caché nunca expulsa la entrada que acaba de insertarse

`evictIfNeeded` recorre desde la más antigua y **se detiene antes de la entrada
recién insertada**. Si después de expulsar todo lo demás la entrada sigue
excediendo `maxBytes`, se queda igual y la caché queda por encima de su
presupuesto **por esa única entrada**, hasta el próximo `set`/`delete`.

Es un exceso acotado y explícito: como mucho una entrada de más. La alternativa
—expulsarla— entrega el peor resultado posible (palabras perdidas, evento ya
emitido, fusión saltada, cero señales).

Con esta regla, el `warn` del §2 pasa a ser inalcanzable por construcción en el
camino del handoff. Se conserva como guard defensivo y **se cubre con un test
que lo fuerza** inyectando una caché mínima: un guard que nunca se ejecuta en
ningún test es un guard que nadie sabe si funciona.

### 2. El estimador es serializado y se llama así

`estimateWordsBytes(words)` vive en `ocr-engine` —es el dueño del tipo que
deposita— y devuelve una **estimación serializada**, no RAM:

- `text`: 2 bytes por unidad de código UTF-16.
- Cada campo numérico (`bbox.x/y/width/height`, `pageIndex`, `confidence`, y
  `bbox.rotation` si está): 8 bytes.
- `source` y cualquier campo string corto: 2 bytes por carácter.
- Un overhead fijo y documentado por objeto, para que el estimador nunca
  devuelva cero por una entrada no vacía.

No se pretende exactitud: el tamaño real de un objeto JS no es portable ni
observable. Se pretende que **crezca cuando la entrada crece** y que nunca sea
cero para datos no vacíos, que es lo que un límite por bytes necesita para
significar algo. El nombre lo dice para que nadie lo cite después como consumo
de RAM medido.

### 3. `bytes` se valida donde se recibe

`LruCache.set` acepta `bytes` **finito y no negativo**. Un valor no finito,
negativo o `NaN` es un error de programación del call site y se trata como tal
(`InvalidInputError`), no se normaliza en silencio a cero — que es exactamente
el bug que se está cerrando.

`bytes` sigue siendo **opcional** en `ICache`. Volverlo obligatorio es un cambio
de contrato que necesitaría su propio ADR y tocaría a todos los call sites de
una; acá se corrige el call site que falta y se conserva la firma.

### 4. Orden intacto

`ctx.cache.set(key, words, estimateWordsBytes(words))` sigue estando **antes**
de `ctx.bus.emit(OCR_PAGE_FINISHED)`. El estimador no toma la palabra sobre el
orden de ADR-014/ADR-041: primero se deposita, después se anuncia.

### 5. Limpieza

La entrada de una página se borra en el cierre del documento, con el resto del
estado retenido. **No** se borra al consumirla: `fuseOcrPage`/`fuseOcrRegion` no
son necesariamente los únicos lectores de esa clave, y un borrado al primer
consumo hay que justificarlo con el inventario de lectores, no suponerlo.

## Consecuencias

**A favor**

- El límite por bytes de esta LRU pasa a existir de verdad, y su número deja de
  ser una ficción.
- El handoff OCR→fusión queda protegido por una invariante de la caché, no por
  la suerte de que el consumo sea síncrono.
- La rama silenciosa del consumidor queda cubierta por un test que la fuerza.

**En contra**

- **La caché puede superar `maxBytes` por una entrada.** Está acotado y es
  preferible a perder palabras, pero es una promesa que la implementación
  anterior daba (y no cumplía, porque contaba cero).
- Una estimación serializada **no** es RAM. Un reporte que sume estos bytes al
  consumo del proceso está mezclando unidades; H-10 los reporta por separado.
- Es un `set` con tercer argumento en un motor y una regla de expulsión en el
  façade: **dos módulos, dos commits** (R-1/R-5), y el de la caché va primero
  porque el otro depende de su garantía.

**Lo que no toca**: el orden depósito→emisión→fusión, la disjunción
páginas/regiones de ADR-065, la firma pública de `ICache`, ni los `cache.set` de
`RenderEngine`, que llevan su propia contabilidad desde ADR-037 §3.
