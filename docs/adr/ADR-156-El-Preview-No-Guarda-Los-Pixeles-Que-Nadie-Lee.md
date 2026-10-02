<!-- CONTEXT: scope=adr | dependencias=core/Render_Engine.md,core/Contracts.md,core/Orchestrator.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-062-Veredicto-De-Degradacion-Hasta-La-UI.md,adr/ADR-055-Decodificacion-Del-Resultado-Que-Cruza-Un-Worker.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md | audiencia=humanos+IA | fase=11 -->

# ADR-156 — El preview no guarda los píxeles que nadie lee

- **Estado**: Accepted
- **Fecha**: 2026-09-11
- **Decidido por**: El humano, sobre la verificación que pidió antes de aprobar el cambio: *"quiero que primero hagas un re-checkeo de que nadie utilice el RGBA crudo"*.
- **Relacionado con**: ADR-154 §2 (los levers de memoria aceptados), ADR-037 §3 (`PREVIEW_CACHE_MAX_BYTES`), ADR-062 (el veredicto que sí sale de la entrada cacheada), ADR-055 (la decodificación del resultado del kernel)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Cada entrada de la caché de preview se guarda dos veces

`InternalCacheEntry` retiene el `ImageData` **y** los bytes codificados, y el
propio contador lo dice:

```ts
function estimateEntryBytes(entry: InternalCacheEntry): number {
  return entry.imageData.data.byteLength + entry.encoded.bytes.byteLength;
}
```

El comentario de esa función agrega que "los píxeles RGBA crudos dominan el
costo". Una página A4 a `previewScale: 1` son ~2 MB crudos contra ~150 KB
codificados; a `MAX_RENDER_SCALE: 4` —el zoom máximo— son ~32 MB contra ~1 MB. El
tope de la caché es `PREVIEW_CACHE_MAX_BYTES` = 200 MB, y se llena de píxeles.

### 2. Nadie lee esos píxeles

Relevado sobre todo el repo, y esta es la condición que el humano puso para
aprobar el cambio:

- **`apps/react-client` no menciona `imageData` ni una vez.** El preview llega a
  la UI como `canvasBlobUrl`, y `emitPreviewUpdated` lo construye desde
  `entry.encoded.bytes` — nunca toca `entry.imageData`.
- **El façade tampoco.** La única aparición en `packages/anonymization-core/src/`
  es un comentario en `worker-pool.ts` sobre el `imageData` de **OCR**, que es
  otro camino.
- **El export usa `output.encoded`** (`orchestrator.ts`, el `RenderPageProvider`
  de `mode: "full"`), y falla ruidosamente si falta.

Dentro del motor, `entry.imageData` lo leen exactamente dos cosas: el contador de
bytes de §1 —o sea, se cuenta porque se guarda— y `toPublicOutput`, que lo copia
a un campo público que ningún consumidor lee.

El camino de OCR **no entra acá**: `rasterizePage` devuelve su `ImageData` por
fuera de la caché y de `RenderPageOutput` (el motor ya documenta ese método como
"sin cache LRU"). Este ADR no lo toca.

## Decisión

### 1. La caché guarda lo codificado; los píxeles crudos no se retienen

`InternalCacheEntry` deja de llevar `imageData`. `estimateEntryBytes` pasa a
contar solo los bytes codificados, que es lo que de verdad queda retenido, y el
tope de 200 MB pasa a acotar unas diez veces más páginas que hoy.

`emitPreviewUpdated` no cambia una línea: ya construía el blob desde `encoded`.
El veredicto de degradación de ADR-062 §2 sigue saliendo de la entrada, intacto.

### 2. El kernel deja de mandar los píxeles crudos en `mode: "preview"`

El ahorro mayor no es no guardarlos: es **no transportarlos**. `KernelRenderResult`
cruza el `postMessage` con `{ imageData, encoded, degraded }`, así que hoy el host
materializa una copia completa de cada preview solo para descartarla.

En `mode: "preview"` el kernel devuelve `encoded` y `degraded`, sin `imageData`.
El decoder de ADR-055 se ajusta para aceptar esa forma —sigue siendo un decoder
explícito, no un cast— y `mode: "full"` no cambia: el export necesita su
`encoded` y lo sigue recibiendo igual.

### 3. `RenderPageOutput.imageData` pasa a ser opcional

Es la parte de contrato y por eso este cambio necesita este ADR (R-2/R-19):
`imageData?: ImageData`, presente solo si el caller pidió `mode: "full"` o si
alguna vez hace falta reintroducirlo. Ningún consumidor de hoy se entera, porque
ninguno lo lee.

`Contracts.md` §5 y el spec de Render se actualizan **antes** que el código, con
la razón escrita: el campo existía por simetría con el kernel, no por un
consumidor.

### 4. Qué prueba que esto no rompe nada

- Los tests de `render-engine` que hoy afirman sobre `imageData` en `mode:
  "preview"` se reescriben para afirmar sobre `encoded` — son la mayoría de las
  18 apariciones de `unit.test.ts`, y su reescritura es parte del mismo commit.
- Se conserva un test que verifica que `mode: "full"` **sí** trae `encoded` y que
  el export lo consume.
- El gate de export de ADR-148 corre sobre el PDF exportado: si algo del camino
  de píxeles se rompiera, ahí se ve.

## Consecuencias

**A favor**

- Se deja de retener, y de transportar, una copia por página que ningún
  consumidor lee. En el zoom máximo son ~32 MB por página cacheada.
- El tope de 200 MB pasa a acotar lo que de verdad se conserva, en vez de
  llenarse con lo que se descarta.
- No cambia nada observable: ni el preview, ni el veredicto de degradación, ni el
  export.

**En contra**

- **Es un cambio de contrato** (`imageData` pasa a opcional), con su commit
  propio y sus specs antes que el código. El campo queda opcional "por si acaso",
  que es una forma de deuda: si en un año nadie lo pobló nunca, corresponde
  sacarlo.
- Si alguna vez hace falta el RGBA de una página cacheada, hay que **decodificar**
  el `encoded` en vez de leerlo. Es el intercambio correcto —el caso no existe
  hoy— pero deja de ser gratis.
- Los tests de Render que afirmaban sobre píxeles se reescriben. Es trabajo real
  y es donde puede colarse un error de traducción.

**Lo que no toca**: `rasterizePage` y todo el camino de OCR, el export
(`mode: "full"`), `PREVIEW_CACHE_MAX_BYTES`, ni el supersede de ADR-037 §4.
