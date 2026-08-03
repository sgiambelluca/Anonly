<!-- CONTEXT: scope=adr | dependencias=core/Render_Engine.md,core/PDF_Engine.md,architecture/05_Worker_Architecture.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-030-RenderEngine-LoadDocument.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-039-NerConfig-WasmPaths-Overrides-Parciales.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-050-Password-Del-PDF-Protegido-Hasta-RenderEngine.md | audiencia=humanos+IA | fase=10-cierre -->

# ADR-053 — La capa de display de pdf.js dentro de un Worker: glifos por `Path2D` y assets first-party propios

- **Estado**: Accepted
- **Fecha**: 2026-07-31
- **Decidido por**: El planificador, sobre un síntoma que el humano reportó probando la app con una pericia legal real y que el planificador diagnosticó contra el código de `pdfjs-dist@4.10.38` publicado en `node_modules`. La primera hipótesis del planificador (faltaban assets) resultó **falsa** y quedó descartada por evidencia antes de escribir este ADR — ver Contexto §2.
- **Relacionado con**: ADR-043 (el reparto host/worker que puso la capa de display de pdf.js adentro de un Worker), ADR-036 §2 (transporte de workers reales), ADR-018 (assets first-party, nunca CDN en runtime), ADR-039 (precedente exacto: rutas de assets que el Core no puede resolver por sí mismo), ADR-030/ADR-050 (`kernelLoadDocument`, el único call site de `getDocument` de Render)

> Convención de citas: `ADR-053 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-053, Contexto §N`.

## Contexto

### 1. El síntoma

En una pericia legal real (texto embebido, 20+ páginas), **todos** los caracteres se rasterizan como cuadrados de borde negro y relleno blanco — el glifo `.notdef` del navegador. Ocurre en el panel original, en el anonimizado y en el PDF exportado, que compone el mismo raster. El único workaround que el humano encontró era pasar el PDF por un conversor a `.docx` y de vuelta a PDF, que lo re-emite con fuentes de encoding simple.

Otros documentos (un cuento de 11 páginas) se ven perfectos. O sea: es por-documento, no global.

### 2. Lo que la evidencia descartó, antes de decidir nada

Dos hechos, los dos del humano probando la app:

- **La misma pericia se renderiza perfecta en Firefox**, que usa pdf.js como visor nativo con toda su configuración por defecto. El PDF está sano; el problema es de configuración nuestra.
- **La consola de la app, con el documento cargado, no emite ni un warning de fuentes**: ni `Ensure that the standardFontDataUrl API parameter is provided`, ni `Unknown CMap name`, ni `Cannot load system font`. pdf.js grita fuerte cuando le faltan esos assets. No gritó.

Eso **descarta** la hipótesis inicial (que faltaran `cmaps`/`standard_fonts`): las fuentes de ese documento están embebidas y no falta ningún asset. Queda como causa la única de las tres candidatas que falla **en silencio**, que es la de abajo.

### 3. La causa: el `@font-face` no se puede registrar dentro de un Worker, y pdf.js no se entera

Desde ADR-043, `kernelLoadDocument`/`kernelRenderPage` corren dentro del `RenderWorker`. Ahí `globalThis.document` no existe. La cadena, leída en `pdfjs-dist@4.10.38/build/pdf.mjs`:

1. `FontLoader.isFontLoadingAPISupported` es `!!this._document?.fonts` (línea 5391) y `_document` sale de `ownerDocument = globalThis.document` (línea 5291) → `false`.
2. Sin Font Loading API, `bind()` cae a `insertRule`, que hace `this._document.createElement("style")` (línea 5310) → **`TypeError`**.
3. Ese error lo captura un `.catch()` del handler del commonobj `"Font"` que **no loguea nada** y dispara el fallback interno. De ahí el log limpio de Contexto §2.
4. Del lado del canvas, `disableFontFace` sigue en `false`: solo se auto-activa bajo Node (línea 11376, `isNodeJS`), nunca en un Worker de browser. Así que pdf.js dibuja con `ctx.fillText()` pasando el `fontChar` del glifo — que para fuentes embebidas subseteadas es un **codepoint del área de uso privado**, y solo significa algo si el `@font-face` se registró.

Como no se registró, el navegador no tiene glifo para esos codepoints: cuadrados. Para fuentes cuyo `fontChar` coincide con el Unicode real (encoding simple, no subseteado), `fillText` contra la fuente de fallback del sistema dibuja el carácter correcto — **se ve bien de casualidad**. Eso explica por qué unos documentos sí y otros no, y por qué el round-trip por `.docx` "arregla" el PDF.

### 4. Dos anomalías del mismo documento que se explican con un solo dato

El humano observó que en la pericia la página 1 se reconstruye bien, con "otra fuente y otro tamaño" que el resto, y que el nombre del fiscal —que está en el título de esa página— es la única entidad que la app no detecta.

La página 1 **es una imagen escaneada** (no permite seleccionar texto; las páginas 2+ sí). Las dos anomalías caen de ahí: una imagen no tiene fuentes que registrar, así que se dibuja como bitmap y se ve bien; y `getTextContent()` no devuelve nada para esa página, así que ni Regex ni NER pueden ver ese nombre. Lo segundo **no lo arregla este ADR** — ese nombre solo es alcanzable por OCR, y por qué OCR no cubrió esa página es un hallazgo aparte, con causa sin cerrar, anotado en `Hito10_Observaciones_Revision.md`.

### 5. Las fuentes no embebidas sí necesitan assets, y hoy no hay ninguno

Que la pericia no los necesite no significa que nadie los necesite. Un PDF cuyas fuentes **no** están embebidas (las standard-14, o una sustitución) o que use CID con CMap predefinido necesita que pdf.js pueda construir una fuente sustituta o resolver una tabla de mapeo. `cMapUrl` y `standardFontDataUrl` son `null` por defecto (líneas 11365/11368) y `apps/react-client/public/` solo tiene `models/` y `wasm/`: los directorios `cmaps/` (169 archivos, 1.5 MB) y `standard_fonts/` (804 KB) que `pdfjs-dist` trae en `node_modules` no se sirven en ninguna parte.

Es un agujero real, hoy latente. El humano decidió cerrarlo ahora en vez de esperar al primer documento que lo destape.

### 6. Tres trampas de pdf.js que hacen que la solución obvia no funcione

Esto es lo que convierte este ADR en algo más que "pasale dos opciones más a `getDocument`". Las tres se leen en el código publicado y ninguna da un error comprensible:

1. **`useWorkerFetch` toca `document` al evaluar su propio default.** Línea 11389: el default es una cadena `&&` que termina en `isValidFetchUrl(cMapUrl, document.baseURI)`. Hoy no explota **solo porque `cMapUrl` es `null`** y la cadena corta antes. En el momento en que se pasan `cMapUrl` y `standardFontDataUrl` sin fijar `useWorkerFetch`, esa expresión se evalúa completa y tira `ReferenceError: document is not defined` dentro del Worker. En `kernelLoadDocument` eso cae en el `catch` que lo reclasifica como `RenderFailedError`: **todo `loadDocument` fallaría**, el visor quedaría muerto, y el mensaje no diría nada sobre fuentes.
2. **Las factories por defecto también tocan `document`.** `DOMCMapReaderFactory._fetch` y `DOMStandardFontDataFactory._fetch` delegan en `fetchData` (línea 852), cuya primera línea es `isValidFetchUrl(url, document.baseURI)` (línea 853). Mismo `ReferenceError`, esta vez al pedir el primer `.bcmap` o `.pfb`. O sea: **servir los assets no alcanza si quien los pide no puede pedirlos.**
3. **`disableFontFace: true` no es solo un flag de display**: viaja al hilo de pdf.js dentro de `evaluatorOptions` (línea 11427) y es lo que hace que el worker de pdf.js construya y envíe las siluetas de glifo (`pdf.worker.mjs` línea 30963, commonobjs `${loadedName}_path_${fontChar}`). Sin él, no hay siluetas que dibujar.

`pdf-engine` ya pasa `useWorkerFetch: false` en su `getDocument` (`pdf.engine.ts`), lo que lo protege de la trampa 1 por accidente. `render-engine` no lo pasa.

## Decisión

### 1. Invariante: pdf.js hospedado en un Worker no usa la Font Loading API

Todo kernel que corra la capa de display de `pdfjs-dist` **dentro de un Web Worker** configura `disableFontFace: true`. pdf.js pasa a dibujar cada glifo como `Path2D` a partir del programa de fuente embebido, sin tocar el DOM: es lo único correcto **por construcción** en ese entorno, no un workaround.

Corolario que hay que escribir porque es contraintuitivo: `disableFontFace` no "desactiva las fuentes", las dibuja por otro camino. La regla vale para cualquier motor futuro que meta pdf.js en un worker, no solo para Render.

### 2. `cMapUrl` + `standardFontDataUrl` first-party, con factories propias

Se sirven `cmaps/` y `standard_fonts/` de `pdfjs-dist` bajo `/pdfjs/` y se pasan `cMapUrl: "/pdfjs/cmaps/"`, `cMapPacked: true` y `standardFontDataUrl: "/pdfjs/standard_fonts/"`.

Para que eso funcione dentro de un Worker hacen falta **las dos mitades** de Contexto §6:

- `useWorkerFetch: false` **explícito** (trampa 1). No se puede omitir confiando en el default.
- `CMapReaderFactory` y `StandardFontDataFactory` **propias**, inyectadas por `getDocument` (`src.CMapReaderFactory`/`src.StandardFontDataFactory`, líneas 11367/11369), que usen `fetch()` pelado sin tocar `document` (trampa 2).

El contrato de esas factories es mínimo y estable, y pdf.js las instancia él (se le pasa la **clase**, no una instancia):

| Factory | Constructor | Método | Devuelve |
|---|---|---|---|
| CMap | `{ baseUrl, isCompressed }` | `async fetch({ name })` | `{ cMapData: Uint8Array, isCompressed: boolean }` |
| Standard font | `{ baseUrl }` | `async fetch({ filename })` | `Uint8Array` |

`BaseCMapReaderFactory`/`BaseStandardFontDataFactory` **no** están exportadas por el paquete (no figuran en la lista de exports de `pdf.mjs`), así que no se extienden: se implementa la forma de arriba. La API las tipa como `Object` (`types/src/display/api.d.ts` líneas 86/106), así que no hace falta ningún `any` (R-6).

Nota de orden de evaluación, para que nadie "simplifique" esto después: inyectar las factories **por sí solo** ya evita la trampa 1, porque la cadena `&&` de la línea 11389 corta en `CMapReaderFactory === DOMCMapReaderFactory` antes de llegar a `document.baseURI`. Igual se exige `useWorkerFetch: false` explícito: depender de un cortocircuito para no tocar un global inexistente es una bomba de tiempo, no un diseño.

### 3. Rutas como constantes del kernel, sin campo nuevo de config

Los dos prefijos van como constantes nombradas a nivel de módulo en cada kernel, con comentario a este ADR — mismo patrón exacto que `NER_LOCAL_MODEL_PATH`/`NER_WASM_PATH` en `ner-engine/src/worker/kernel.ts`.

**No** se agrega un campo a `EngineConfig`, y esto es deliberado a pesar del precedente de ADR-039. La razón por la que `NerConfig.wasmPaths` existe es que Vite **hashea** los nombres de los assets que procesa como módulo (`import ?url`), así que el Core no puede saberlos. Acá es al revés: `public/` se copia verbatim, sin hashear, y son 169 archivos que pdf.js resuelve **por nombre** contra un prefijo — el prefijo estable es exactamente la forma correcta. Agregar un campo de config sería cambiar `Contracts.md`, `LoadDocumentPayload` y tres motores para expresar una constante.

Si algún día hace falta configurarlo (otro origen, otra versión), es su propio ADR y el precedente de ADR-039 está ahí.

### 4. Los assets se copian de `node_modules`, no se mirrorean ni se commitean

Los bytes salen de `pdfjs-dist`, una dependencia ya pinneada por `pnpm-lock.yaml`. Por lo tanto:

- **No** van a `assets.lock.json`. Ese archivo es para mirrors de URLs de terceros con `sha256` pinneado (ADR-018): son 169 entradas que no se descargan de ningún CDN y cuya integridad ya cubre el lockfile. Meterlas ahí sería ruido, no garantía.
- **No** se commitean. Se copian en un paso de build (`predev`/`prebuild` de `apps/react-client`), y `apps/react-client/public/pdfjs/` va al `.gitignore` junto a `public/wasm/` y `public/models/`, con el mismo criterio ya establecido ahí.
- El origen se resuelve con `createRequire`/`import.meta.resolve` sobre `"pdfjs-dist/package.json"`, **nunca** con una ruta literal a `node_modules/.pnpm/...` (pnpm usa un store con hash en el path).

ADR-018 se cumple igual: los assets se sirven first-party, no hay ninguna request a un CDN de terceros en runtime.

### 5. `pdf-engine` también, pero solo la mitad de cMaps

`pdf.engine.ts` (extracción de texto) recibe `cMapUrl`/`cMapPacked`/`standardFontDataUrl` y las factories propias por la misma razón de Contexto §5: sin cMaps, un PDF con CMap predefinido se **extrae mal**, y ese texto es la entrada de `regex-engine` y `ner-engine` — o sea que degrada la detección de entidades, no solo el dibujo.

**No** lleva `disableFontFace`: esa ruta no rasteriza nada, el registro de `@font-face` le es indiferente. Conserva su `useWorkerFetch: false` actual.

### 6. Qué **no** cambia

Ningún contrato público, ningún payload de evento, ninguna clave de `EngineConfig`. `LoadDocumentPayload` no gana campos. El reparto host/worker de ADR-043 queda intacto. No se toca `worker-pool.ts` ni el façade. `ocr-engine`, `grouping-engine` y `export-engine` no se tocan.

**Explícitamente fuera de alcance**: que pdf.js degrade a "fake worker" dentro de todo Web Worker porque su `PDFWorker._initialize()` referencia `window` (`pdf.mjs` línea 12309). Es un hallazgo real del mismo diagnóstico, de **rendimiento y no de correctitud** (el parser corre en el hilo del RenderWorker en vez de en uno propio), y su workaround —definir un `window` mínimo en el scope global del worker— es un monkey-patch sobre una librería de terceros que necesita su propio ADR. Queda anotado en `Hito10_Observaciones_Revision.md`.

### 7. Tests

- **`render-engine`**: unit sobre `kernelLoadDocument` con `getDocument` mockeado, verificando que llegan **las cinco** opciones con el valor exacto (`disableFontFace: true`, `useSystemFonts: false`, `useWorkerFetch: false`, `cMapUrl`+`cMapPacked`, `standardFontDataUrl`) y que las dos factories inyectadas son las propias, no las de pdf.js. Es exactamente lo que hoy nadie asserta.
- **Las factories propias**: unit con `fetch` mockeado — arman la URL como `baseUrl + name + ".bcmap"` y `baseUrl + filename`, devuelven la forma que pdf.js espera, y **no referencian `document`** (el test corre en `environment: "node"` de `vitest.config.ts`, donde `document` no existe: si alguien lo toca, el test explota solo).
- **`pdf-engine`**: unit equivalente para las opciones de §5, verificando además que `disableFontFace` **no** se pasa.
- No hace falta snapshot de píxeles.

### 8. Verificación manual, como gate del PR de `render-engine`

El PR de `render-engine` no se da por cerrado sin abrir la pericia real del humano en `pnpm dev` y mostrar el antes/después, más la consola del RenderWorker sin warnings de fuentes ni CMaps. Ningún test unitario puede sustituir esto: la causa vivió tres semanas justamente porque todos los tests mockean la frontera de `pdfjs-dist` (ADR-021 §5).

### 9. Alcance: tres PRs, en este orden

| # | PR | Módulo |
|---|---|---|
| 1 | Copia de `cmaps`/`standard_fonts` a `public/pdfjs/` + `predev`/`prebuild` + `.gitignore` | `apps/react-client` |
| 2 | `disableFontFace` + assets + factories propias en `kernelLoadDocument` | `render-engine` |
| 3 | cMaps + standard fonts + factories propias en la extracción | `pdf-engine` |

El 1 va primero: sin assets servidos, el 2 y el 3 apuntan a un 404. El 2 y el 3 son independientes entre sí. Tocan dos motores, así que van separados por R-1/R-5.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Solo servir `cmaps`/`standard_fonts`** (la hipótesis inicial del planificador) | No arregla el síntoma reportado: las fuentes de la pericia están embebidas y no falta ningún asset (Contexto §2). Habría sido trabajo real que no movía la aguja. |
| **Solo `disableFontFace: true`** | Arregla el síntoma de hoy y deja abierto el de mañana: las fuentes **no** embebidas siguen sin poder construirse (Contexto §5). El humano eligió cerrar las dos mitades ahora. |
| **Inyectar las rutas por `EngineConfig`** (patrón ADR-039) | El motivo que justifica ADR-039 —Vite hashea los nombres— no aplica: `public/` se copia verbatim y pdf.js resuelve 169 archivos por nombre contra un prefijo (§3). Sería cambiar `Contracts.md` y `LoadDocumentPayload` para expresar una constante. |
| **Mirrorear los assets vía `assets.lock.json`** | 169 entradas con `sha256` para bytes que no vienen de ningún CDN y cuya integridad ya cubre `pnpm-lock.yaml`. ADR-018 se cumple igual sirviéndolos first-party (§4). |
| **Commitear los assets** | 2.3 MB de binarios en el repo, contra el criterio ya establecido en `.gitignore` para `public/wasm/` y `public/models/`. |
| **Confiar en el default de `useWorkerFetch`** | Tira `ReferenceError` dentro del Worker en cuanto se pasan las URLs, reclasificado como `RenderFailedError`: el visor entero muere con un mensaje que no menciona fuentes (Contexto §6 trampa 1). |
| **Usar las factories `DOM*` de pdf.js** | Tocan `document.baseURI` al primer fetch (Contexto §6 trampa 2). Servir los assets sin factories propias no sirve de nada. |
| **Sacar pdf.js del Worker y volver a rasterizar en el hilo principal** | Revierte ADR-043 y devuelve el jank de rasterización a la UI, para evitar configurar dos opciones. |

## Consecuencias

**Positivas**: los PDFs con fuentes embebidas subseteadas —que es el caso normal de un documento legal real— se rasterizan bien en preview y en export; las fuentes no embebidas y los CMaps predefinidos quedan cubiertos antes de que aparezca el documento que los pida; la extracción de texto mejora para CID con CMap predefinido, lo que beneficia directo a la detección de entidades; y queda escrita una regla reusable para cualquier motor futuro que hospede pdf.js en un worker, con sus tres trampas documentadas.

**Negativas**: dibujar por silueta es más lento que `ctx.fillText` — hay que **medirlo y reportarlo** en el PR de `render-engine`, no optimizarlo ahí. El build gana un paso de copia: si alguien clona el repo y corre `pnpm dev` sin que ese paso haya corrido, vuelve el bug de las fuentes no embebidas (por eso va cableado como `predev`/`prebuild`, no manual). Y aparecen dos clases nuevas por kernel que existen solo para esquivar una limitación de terceros: van con comentario a este ADR para que nadie las "limpie" sin entender por qué están.

**Neutras**: ningún contrato público ni payload cambia; los assets siguen siendo first-party (ADR-018 intacto); el reparto host/worker de ADR-043 no se toca; el hallazgo del "fake worker" queda anotado y sin resolver, por decisión explícita (§6).

## Docs actualizados por este ADR

- `core/Render_Engine.md`: nota de versión + sección de `kernelLoadDocument` con las cinco opciones y el porqué de las factories propias.
- `core/PDF_Engine.md`: las opciones de §5 en el `getDocument` de extracción, con la nota de que `disableFontFace` no aplica ahí; y el ítem 17 de su checklist §15, para que siga siendo verdad tras las factories propias.
- `architecture/05_Worker_Architecture.md`: la regla de §1 como invariante de cualquier kernel que hospede pdf.js.
- `adr/ADR-018`: nota de que un asset que viene de una dependencia npm pinneada se sirve first-party sin pasar por `assets.lock.json`.
- `ai/Code_Standards.md`: excepción a P-7 con la misma forma que la de P-6/ADR-021 §6, para las factories de CMap/standard-fonts same-origin.
- `architecture/08_Security_Model.md`: nota en el gate `no-network-from-core` para las mismas factories.
- `roadmap/MVP.md` y `roadmap/Hito10_Observaciones_Revision.md`: los tres PRs de §9.

## Validación

- Los tests de §7 verdes.
- Verificación manual de §8 sobre la pericia real: sin cuadrados, sin warnings de fuentes en la consola del RenderWorker.
- Regresión de lo que ya andaba: el cuento de 11 páginas y los fixtures de E2E siguen renderizando igual.
- Que el Escenario 2 (PDF escaneado + OCR) y el 3 (protegido) sigan verdes: el 3 ejercita `kernelLoadDocument` con `password`, que es el mismo call site que este ADR toca (ADR-050).
- Comprobación de red: con un PDF de fuentes no embebidas, se ven requests `200` a `/pdfjs/standard_fonts/...`; con la pericia (embebidas), no se pide ninguna.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `core/Render_Engine.md` §8 — `core/PDF_Engine.md` — `architecture/05_Worker_Architecture.md` §7.4
- `adr/ADR-018` — `adr/ADR-030` — `adr/ADR-036` §2 — `adr/ADR-039` §3 — `adr/ADR-043` — `adr/ADR-050`
- Código: `packages/anonymization-core/render-engine/src/worker/kernel.ts` (`kernelLoadDocument`) — `packages/anonymization-core/pdf-engine/src/pdf.engine.ts` — `packages/anonymization-core/ner-engine/src/worker/kernel.ts` (precedente de constantes de ruta) — `apps/react-client/vite.config.ts` — `.gitignore`
- `pdfjs-dist@4.10.38`, `build/pdf.mjs`: líneas 852-853 (`fetchData`), 5291/5310/5391 (`FontLoader`), 6032-6070 y 6407-6440 (factories y su contrato), 11365-11389 (defaults de `cMapUrl`/`standardFontDataUrl`/`disableFontFace`/`useWorkerFetch`), 11401-11406 (instanciación de factories), 11427-11438 (`evaluatorOptions`), 12309 (`window` en `_initialize`); `build/pdf.worker.mjs` línea 30963 (`buildFontPaths`)
