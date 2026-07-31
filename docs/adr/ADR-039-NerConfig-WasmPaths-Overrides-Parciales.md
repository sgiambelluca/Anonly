<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/NER_Engine.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-025-Migracion-Huggingface-Transformers.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md | audiencia=humanos+IA | fase=10 -->

# ADR-039 — `NerConfig.wasmPaths` inyectable, overrides parciales de `createCore` y reubicación de los wasm de ort

- **Estado**: Accepted
- **Fecha**: 2026-07-22
- **Decidido por**: El planificador, a partir del diagnóstico del bug #3 del Escenario 1 E2E (Hito 10 PR10, `roadmap/Hito10_Observaciones_Revision.md` entrada "PR10")
- **Relacionado con**: ADR-018 (assets first-party), ADR-025 (migración a `@huggingface/transformers`, destino de los wasm), ADR-036 §2 (patrón de inyección desde la app: la app es la única capa con bundler)

## Contexto

El Escenario 1 E2E (primera vez que `@huggingface/transformers`/`onnxruntime-web` corren en un
browser real; todos los tests previos mockean esa frontera, ADR-021 §5) destapó que el runtime
WASM de ONNX no puede cargar bajo Vite: `onnxruntime-web` hace un **`import()` dinámico ESM** del
glue `ort-wasm-simd-threaded.asyncify.mjs`, y ese archivo vive en
`apps/react-client/public/wasm/onnxruntime/` (destino fijado por ADR-025 punto 3). Vite **rechaza
por diseño** importar módulos desde `public/` ("This file is in /public and will be copied as-is
during build without going through the plugin transforms, and therefore should not be imported
from source code"). Descartados empíricamente: headers COOP/COEP (el fallo ocurre antes de
necesitar `SharedArrayBuffer`) y `optimizeDeps.exclude` (el `import()` problemático no depende del
pre-bundling). Diagnóstico completo en `roadmap/Hito10_Observaciones_Revision.md`.

El fix requiere que la app importe esos archivos vía `?url` (mismo patrón que el fix de
`GlobalWorkerOptions.workerSrc` de pdfjs-dist) y le pase las URLs resultantes al motor. Pero hoy
`ner.engine.ts` (`configureTransformersEnv()`) **pisa incondicionalmente**
`env.backends.onnx.wasm.wasmPaths` con la constante `/wasm/onnxruntime/`: cualquier valor que la
app configure antes se pierde. No existe costura para inyectarlo — es un cambio de contrato
(R-2/R-19), de ahí este ADR.

Problema acoplado: aunque `NerConfig` ganara el campo, la app no puede pasarlo limpiamente.
`createCore(config?: Partial<EngineConfig>)` tipa un partial **shallow**: proveer `ner` exige un
`NerConfig` completo (y `workerPool`, 11 campos) — gap ya documentado en la entrada "PR5" de
`Hito10_Observaciones_Revision.md`, que hoy fuerza a la app a replicar defaults del Core.
`mergeEngineConfig()` (`packages/anonymization-core/src/config.ts`) ya hace merge por sub-objeto
(`{ ...base.ner, ...overrides.ner }`): el runtime **ya soporta** parciales por sección; solo el
tipo lo prohíbe.

## Decisión

### 1. `NerConfig.wasmPaths` (cambio de `Contracts.md` §6)

```ts
// Rutas del runtime WASM de onnxruntime-web, inyectadas por el host (la app,
// única capa con bundler — ADR-036 §2, ADR-039). Solo strings (serializable:
// EngineConfig viaja al worker en INIT). Forma objeto: URLs explícitas por
// archivo (necesario con bundlers que hashean nombres); forma string: prefijo
// de directorio. Ausente → el motor usa su default "/wasm/onnxruntime/".
export interface NerWasmPaths {
  readonly wasm?: string;
  readonly mjs?: string;
}

export interface NerConfig {
  readonly modelId: string;
  readonly quantization: "q8" | "q4" | "f32";
  readonly confidenceThreshold: number;
  readonly batchSize: number;
  readonly enabled: boolean;
  readonly wasmPaths?: string | NerWasmPaths; // ADR-039
}
```

Semántica en el motor (`configureTransformersEnv`): si `ctx.config.ner.wasmPaths` está definido,
se asigna **tal cual** a `env.backends.onnx.wasm.wasmPaths` (la forma `string | {wasm?, mjs?}` es
exactamente la que acepta `onnxruntime-common` — verificado empíricamente); si está ausente, se
mantiene el default actual (`NER_WASM_PATH = "/wasm/onnxruntime/"`), preservando el
comportamiento de hosts sin bundler y de todos los tests existentes. El motor **nunca** vuelve a
pisar un valor inyectado. La inyección es por config explícita, no por detección de estado global
previo (frágil e intesteable). `env.localModelPath` **no** cambia: los assets del modelo se
`fetch()`ean por URL (nunca `import()`), `public/models/ner/` sigue siendo válido.

### 2. `createCore` acepta overrides parciales por sección (cambio de `Contracts.md` §3.5)

```ts
// Overrides parciales de dos niveles: cada sección de EngineConfig admite un
// subconjunto de campos; lo ausente cae al default de config.ts (ADR-039).
export type EngineConfigOverrides = {
  readonly [K in keyof EngineConfig]?: Partial<EngineConfig[K]>;
};

export async function createCore(
  config?: EngineConfigOverrides,
  runtime?: CoreRuntimeOptions
): Promise<IAnonymizationCore>;
```

Es un **ensanchamiento puro de tipo**: `mergeEngineConfig()` ya implementa exactamente esta
semántica en runtime (spread por sub-objeto, sin deep-merge recursivo — cada sección es plana).
Todo llamador existente sigue compilando (`Partial<EngineConfig>` es asignable a
`EngineConfigOverrides`). Esto elimina la raíz del gap "PR5" (la app podrá cablear
`nerEnabled`/`ocrLanguages`/`performancePreset` sin replicar defaults) y habilita el uso previsto
acá: `initCore({ ner: { wasmPaths: { wasm, mjs } } })`. `core-adapter/index.ts` (`initCore`)
actualiza su tipo passthrough en el mismo cambio.

### 3. Reubicación de los wasm de ort (supersede el **destino** de ADR-025 punto 3)

Los dos assets de `onnxruntime-web` en `assets.lock.json` (`ort-wasm-simd-threaded.asyncify.mjs`
y `.wasm`) cambian su `destination` de `apps/react-client/public/wasm/onnxruntime/` a
**`apps/react-client/src/assets/onnxruntime/`** (carpeta que Vite sí procesa como módulos;
`?url` devuelve la URL final hasheada en build y la directa en dev). `.gitignore` se actualiza en
consecuencia (la entrada `apps/react-client/public/wasm/` sigue vigente para tesseract). URLs,
`revision`, `sha256` y `sizeBytes` del lock **no cambian** — mismo binario, otro destino; el flujo
`pnpm assets:mirror` (ADR-018) tampoco cambia. La app importa ambos con `?url` y los inyecta vía
el punto 2. Los assets de tesseract y de los modelos (NER + traineddata) **no se mueven**: se
sirven por URL/`fetch()`, nunca se importan como módulos, y `public/` es el lugar correcto para
ellos. La invariante de ADR-018 (todo asset servido first-party desde el origen propio, nunca CDN
en runtime) queda intacta: los archivos entran al pipeline de build de Vite y se sirven
content-hasheados desde el propio origen.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Que el motor no toque `wasmPaths` si "alguien" ya lo seteó (detección de estado global) | Acoplamiento implícito por orden de ejecución; imposible de testear de forma determinista; rompe si la app inicializa después del primer `pipeline()`. |
| Campo en `CoreRuntimeOptions` en vez de `NerConfig` | `CoreRuntimeOptions` existe para lo **no serializable** (factories de Worker, ADR-036 §2); `wasmPaths` son strings y deben viajar al worker en `INIT` dentro de `EngineConfig` — es config, no runtime. |
| Servir el `.mjs` con un middleware/plugin de Vite que permita importarlo desde `public/` | Pelea contra una decisión de diseño explícita de Vite; frágil ante upgrades; no funciona en `vite build` sin más hacks. |
| Solo agregar `wasmPaths` sin ensanchar `createCore` | Obliga a la app a replicar los 5 campos de `NerConfig` (y sus defaults) para poder pasar uno — exactamente el anti-patrón documentado en el gap "PR5". El ensanchamiento es gratis (el merge ya lo implementa). |

## Consecuencias

**Positivas**: desbloquea el Escenario 1 E2E y el commit del PR10; la costura sigue el mismo
patrón ya aceptado para `workerSrc` de pdfjs-dist y las factories de ADR-036; el gap "PR5" queda
resuelto de raíz; sin cambio de comportamiento para tests ni hosts existentes.

**Negativas**: `NerConfig` gana un campo opcional cuyo tipo refleja una API de terceros
(`onnxruntime-common`) — si ort cambiara la forma aceptada, habría que versionar el campo (riesgo
acotado: strings planos). Dos assets del lock viven fuera de `public/`, rompiendo la uniformidad
"todo asset mirrorado va a `public/`" — el criterio pasa a ser "se `import()`a → `src/assets/`;
se `fetch()`ea → `public/`".

## Referencias

- `core/Contracts.md` §3.5, §6 — `core/NER_Engine.md` §6, notas de cabecera
- `roadmap/Hito10_Observaciones_Revision.md` — entradas "PR10" (diagnóstico completo) y "PR5" (gap de `initCore`)
- `adr/ADR-018-First-Party-Assets.md` — `adr/ADR-025-Migracion-Huggingface-Transformers.md` punto 3 — `adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md` §2
- Issue [#3](https://github.com/sgiambelluca/Anonly/issues/3) — commits `779b2f1` (bugs #1/#2), `dbe533c` (diagnóstico)
