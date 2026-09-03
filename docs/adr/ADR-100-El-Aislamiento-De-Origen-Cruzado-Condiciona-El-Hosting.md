<!-- CONTEXT: scope=adr | dependencias=architecture/07_Performance_Strategy.md,architecture/08_Security_Model.md,adr/ADR-002-No-Backend.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-039-Wasm-Paths-Inyectados.md,roadmap/Optimizacion_De_Rendimiento.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-100 — El aislamiento de origen cruzado condiciona el hosting

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, punto A del plan de `roadmap/Optimizacion_De_Rendimiento.md`, tras ver la medición.
- **Relacionado con**: ADR-002 (no hay backend; el despliegue es un CDN estático), ADR-039 (los paths de wasm inyectados), `07_Performance_Strategy.md` §1
- **Parte de**: Hito 11, optimización

## Contexto

### 1. Los hilos ya viajan en el bundle, y están dormidos

El navegador solo expone `SharedArrayBuffer` —la memoria compartida entre hilos— si la página está **aislada de origen cruzado**, y eso lo habilita el **servidor**, mandando dos headers. Sin ellos `globalThis.crossOriginIsolated` es `false`.

`onnxruntime-web` lo chequea por su cuenta y se autolimita:

```js
// ort-wasm-simd-threaded.asyncify.mjs, el archivo que YA enviamos
if (!globalThis.SharedArrayBuffer) return 6;          // no puede crear el hilo
if (numThreads > 1 && !multiThreadSupported) { flags.numThreads = numThreads = 1; }
```

O sea que no hay que agregarle hilos a la app: el archivo se llama `-threaded`, trae `spawnThread` y `Atomics.waitAsync`, y se rinde en la primera línea. El motor nunca toca `numThreads` (queda en el default de la librería), así que la decisión es enteramente del entorno.

`07_Performance_Strategy.md` línea 232 ya lo dejaba anotado al pasar: *"headers que la app de producción no lleva"*.

### 2. Medido: la inferencia baja a la mitad, y la calidad no se mueve

Prototipo con los dos headers en el dev server y `pnpm test:measure` sobre los 26 documentos del dataset, antes y después. Aislamiento verificado en la página:

```
crossOriginIsolated: true | SharedArrayBuffer: function | núcleos: 8
```

| | inferencia de NER (suma de los 26 documentos) |
|---|---|
| un hilo | 13 564 ms |
| con hilos | **6 287 ms** |
| | **−53,6 %** |

Sobre el documento denso (`doc-026`): **2986 → 1085 ms, −63,7 %**. La carga del modelo no se mueve fuera del ruido entre corridas (−10,7 %).

**La calidad quedó idéntica**: recall de Regex 61/61, recall de NER 12/17, precisión 84/97. Era lo esperado —esto no toca tokenización, agregación BIO ni umbral— pero se corrió igual en vez de asumirlo.

### 3. La app no puede dárselo a sí misma

ADR-002 fija que **no hay backend**: el despliegue es un CDN estático que sirve archivos. Un SPA estático no puede mandarse headers, así que la única forma real es que los mande el hosting.

Poner los headers **solo en el dev server** sería peor que no hacer nada: dev y producción diferirían justo en esto, y toda medición local pasaría a describir una app que no existe.

## Decisión

### 1. El repo declara los headers; el hosting los tiene que mandar

`apps/react-client/public/_headers` (Vite lo copia a `dist/` tal cual):

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### 2. Esto **condiciona la elección de CDN**, que ADR-002 dejó abierta

ADR-002 dice "un CDN estático" sin nombrar cuál. Esta decisión acota la lista:

| hosting | cómo |
|---|---|
| Netlify, Cloudflare Pages | leen `public/_headers` tal cual — nada más que hacer |
| Vercel | pide la misma regla en `vercel.json` (`headers`) |
| S3 + CloudFront | pide una *response headers policy* |
| **GitHub Pages** | **no puede mandar headers custom** — la app queda en un hilo |

**Hostear en GitHub Pages es incompatible con esta decisión.** No es un detalle de implementación: es la consecuencia práctica y por eso se escribe acá.

### 3. El dev server manda los mismos dos headers

`vite.config.ts`, `server.headers`. No es una comodidad: es lo que mantiene **dev y producción comparables**. Una medición local que no describa lo que se publica no sirve para nada, que es justo lo que este ADR viene a evitar (§Contexto 3).

### 4. Se descarta el service worker que inyecta los headers

Existe la técnica —un service worker que reescribe las respuestas para habilitar el aislamiento sin tocar el hosting— y funciona. Se descarta por dos razones:

- Mete un **service worker** en una app cuyo argumento central es que no manda nada a ningún lado. No lo haría, pero pasa a ser algo que hay que explicar, y `08_Security_Model.md` tendría que cubrirlo.
- Es **un componente más que pasamos a mantener nosotros**, para reemplazar dos líneas de configuración de hosting. Es la misma contra que hizo rechazar la opción B de ADR-097.

Queda anotada como salida si algún día el hosting no es negociable.

### 5. `require-corp`, con `credentialless` como alternativa

`COEP: require-corp` exige que todo recurso de otro origen declare que se deja embeber. La app es **100 % first-party por diseño** (ADR-002 §Consecuencias, ADR-018: modelos y wasm mirroreados al propio dominio), así que no debería molestar — y en la corrida completa no rompió nada.

Si algún día molesta, `COEP: credentialless` también aísla y es menos estricto. No se elige ahora porque `require-corp` es el más restrictivo y hoy no cuesta nada.

## Consecuencias

**A favor**

- La inferencia de NER cuesta la mitad, medido, sin tocar una línea de motor.
- Cero riesgo de calidad, verificado y no supuesto.
- Dev y producción quedan alineados, así que las mediciones de `tests/measure/` siguen valiendo.
- Habilita más adelante `performance.measureUserAgentSpecificMemory()`, que `07_Performance_Strategy.md` §11.4 daba por inalcanzable justamente por la falta de estos headers — o sea que el gate `test:leak` deja de estar bloqueado por esto.

**En contra**

- **Ata la elección de hosting**, y descarta GitHub Pages.
- `require-corp` puede romper un recurso de otro origen que se agregue en el futuro. Hoy no hay ninguno y la arquitectura dice que no debería haberlo, pero es una restricción nueva sobre lo que se puede agregar.
- El aislamiento enciende hilos reales con memoria compartida **adentro de onnxruntime**. No es código nuestro y está escrito para eso (usa `Atomics`), pero conviene tenerlo presente: nuestro código sigue sin tocar un byte compartido.

**Lo que no cambia**

- El modelo de amenaza de `08_Security_Model.md`: los headers **restringen**, no habilitan salida de datos. `COOP: same-origin` corta la relación con ventanas de otro origen y `COEP` exige permiso explícito para embeber. Los dos van en la dirección de la política que el proyecto ya tiene.
