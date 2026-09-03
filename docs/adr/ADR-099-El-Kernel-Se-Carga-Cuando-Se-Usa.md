<!-- CONTEXT: scope=adr | dependencias=architecture/07_Performance_Strategy.md,core/OCR_Engine.md,core/NER_Engine.md,core/Export_Engine.md,adr/ADR-045-Ocr-Kernel-Puerto-Interno.md,adr/ADR-046-Reparto-Host-Kernel-NER.md,adr/ADR-047-Ensamblado-Incremental-Export.md,roadmap/Optimizacion_De_Rendimiento.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-099 — El kernel se carga cuando se usa

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, punto D1 del plan de `roadmap/Optimizacion_De_Rendimiento.md`.
- **Relacionado con**: ADR-045 (kernel de OCR), ADR-046 (kernel de NER), ADR-047 (ensamblador de export), `07_Performance_Strategy.md` §2.1
- **Parte de**: Hito 11, optimización

## Contexto

### 1. El arranque bajaba tres librerías que la sesión podía no usar nunca

`createCore()` instancia los siete motores en el arranque (`App.tsx` llama `initCore()` en el `useEffect` de montaje, antes de que el usuario importe nada). Cada clase de motor importaba **estáticamente** su kernel, y cada kernel importa su librería a nivel de módulo:

| motor | import estático | arrastra |
|---|---|---|
| `ocr-engine/src/ocr.engine.ts:52` | `./worker/kernel.js` | `tesseract.js` |
| `ner-engine/src/ner.engine.ts:55` | `./worker/kernel.js` | `@huggingface/transformers` + `onnxruntime-web` |
| `export-engine/src/export.engine.ts:158` | `./worker/assembler.js` | `pdf-lib` |

Esos imports existen para el **fallback in-process** (`IMMEDIATE_POOL`), que usan los tests de cada paquete cuando construyen el motor sin `workerFactory`. En la app real el trabajo lo hace el worker, que importa el kernel por su cuenta — así que la librería estaba **dos veces**: en el chunk del worker, donde se usa, y en el chunk inicial, donde no.

Un documento de puro texto no necesita Tesseract; una sesión que no exporta no necesita `pdf-lib`; y ni siquiera NER —activado por default— hace falta para pintar la primera página.

### 2. Medido sobre el build real

`pnpm --filter @anonly/react-client build`, chunk inicial (`dist/assets/index-*.js`), gzip medido a mano:

```
antes:   1 746 254 B raw   /   549 459 B gz
```

Con los símbolos internos de cada librería contados dentro de ese chunk: `AutoTokenizer`/`PreTrainedModel` **183** apariciones, `PDFDocument` 25, `createWorker` 2. No eran referencias sueltas: era el código.

`07_Performance_Strategy.md` §2.1 ya describía la carga perezosa por motor. **Era una intención, no una descripción**: se cumplía para los Web Workers (que sí se crean recién en el primer `dispatch`) pero no para el código host-side.

## Decisión

### 1. El kernel se importa con `import()` dinámico, dentro del closure que lo usa

Cada motor cachea la promesa del módulo, así que se evalúa una sola vez:

```ts
function importOcrKernel() {
  return import("./worker/kernel.js");
}

let kernelModule: ReturnType<typeof importOcrKernel> | undefined;

function loadOcrKernel(): ReturnType<typeof importOcrKernel> {
  kernelModule ??= importOcrKernel();
  return kernelModule;
}
```

El tipo del módulo sale de **inferir** el `import()` y no de anotarlo: `typeof import(...)` en posición de tipo lo prohíbe `@typescript-eslint/consistent-type-imports`, y la forma de arriba da el mismo tipo exacto sin esa sintaxis.

y el `run` del dispatch pasa a ser `async`. No hace falta tocar el contrato de la pool: `dispatch` ya devuelve `Promise<unknown>` y el fallback in-process es `dispatch: (params) => params.run()`.

### 2. `dispose()` no carga el kernel para liberarlo

```ts
if (kernelModule !== undefined) await (await kernelModule).kernelDispose();
```

Cargar el módulo para liberar algo que nunca se cargó anularía el punto de esta decisión.

### 3. El estado de export se separa de su implementación

`ExportEngine` necesita `EMPTY_ASSEMBLER_STATE` como **inicializador de campo** —un valor, no un tipo— y eso solo alcanzaba para arrastrar `pdf-lib`. `AssemblerState`, `EMPTY_ASSEMBLER_STATE` y `discardState()` se mudan a `worker/assembler-state.ts`, donde `PDFDocument` entra **solo como tipo** (`import type`, que TypeScript borra al compilar): el módulo queda sin dependencias de runtime y se puede importar estático sin costo.

`discardState()` se muda con ellos porque es puro —devuelve el estado vacío— y `dispose()` lo llama en un camino **síncrono**.

`assembler.ts` los re-exporta, así que nadie que ya los importara de ahí se entera.

### 4. Los tipos siguen importándose estáticamente

`import type { KernelOcrResult } from "./worker/kernel.js"` se borra al compilar: no crea dependencia de runtime y mantiene el tipado exacto.

### 5. Esta decisión autoriza el cambio en los tres motores

R-1 pide un módulo por PR. Acá el cambio es **el mismo patrón, tres veces**, y partirlo dejaría el build a medio migrar sin ganar revisabilidad: el diff de cada motor son cinco líneas. Este ADR fija el patrón una vez y autoriza aplicarlo a `ocr-engine`, `ner-engine` y `export-engine` en un solo cambio.

**`pdf-engine` queda fuera**, y no por olvido: no importa pdf.js desde un kernel sino **directo, para su propia lógica**, y esa misma clase corre adentro del worker (`worker/entry.ts`), por lo que los ADRs lo llaman "el único motor sin puerto interno". Separarlo pide construirle un kernel que no existe — es el punto **D2** del plan, diferido a rediscutir.

## Consecuencias

**A favor** — medido sobre el build real:

```
chunk inicial:   549 459 B gz  →  207 661 B gz     (−62 %)
```

Contra el objetivo contractual de 800 KB gz (`07_Performance_Strategy.md` §1), pasa de usar el 67 % del presupuesto a usar el 26 %. Adentro del chunk, `AutoTokenizer`/`PreTrainedModel` pasa de 183 apariciones a **0**, `createWorker` de 2 a **0** y `PDFDocument` de 25 a 2 (cadenas sueltas, ya no el código).

Sin contrato modificado, sin dependencia nueva, sin riesgo de calidad: cambia **cuándo** carga el código, no **qué** hace.

**En contra**

- La primera página que necesita OCR, NER o export paga una descarga de chunk que antes ya estaba en memoria. Contra los 5,3 s de OCR y los 5-15 s de NER por página, es ruido; para export es la primera vez que se pulsa el botón.
- Tres motores más un módulo nuevo tocados por un cambio de carga. El riesgo real no es de calidad sino de regresión en el fallback in-process que usan los tests — cubierto: **1710 tests y 302 de contrato en verde**, y el pipeline completo verificado en Chromium con `pnpm test:measure`.

**Lo que no cambia**

- El total de bytes que baja una sesión que sí usa todo. Esto saca trabajo del **camino crítico de arranque**, no de la suma.
- Los chunks duplicados entre app y workers: cada worker sigue trayendo su copia. Sacarlo pediría compartir un chunk entre el hilo principal y un worker, que es otra decisión.
