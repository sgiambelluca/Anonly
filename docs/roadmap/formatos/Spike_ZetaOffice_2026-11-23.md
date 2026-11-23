# Spike ZetaOffice (LibreOffice en WASM) como conversor de Office a PDF

> Informe del implementador del spike, copiado sin cambios de
> `C:\Anonly\spikes\zetaoffice\results\INFORME.md` el 2026-11-23. Los scripts,
> el corpus y los binarios quedan fuera del repo. Qué decide el planificador
> con esto: `Plan_1.2.md` §7 y §8.

Fecha: 2026-11-23. Máquina: Windows 11 Pro, 12 hilos lógicos (`navigator.hardwareConcurrency`), Electron 44.11.5 del repo (`node_modules\.pnpm\electron@44.11.5`), `pdfjs-dist` 4.10.38 (la versión del repo).
Todo vive en `C:\Anonly\spikes\zetaoffice\` (`vendor\`, `harness\`, `corpus\`, `corpus-crypto\`, `results\`). No se tocó `C:\Anonly\Anonly`.

**Qué sale solo de sintéticos:** todos los números y la fidelidad. El corpus se generó con las librerías npm `docx`, `exceljs` y `pptxgenjs`, **no con Microsoft Office ni con Google**. No había `ANONLY_REAL_DOC_R*` definidas al correr (`env` sin ninguna), así que **no se midió ningún documento real**. El harness los acepta (`measure.mjs` y `analyze.mjs` leen `ANONLY_REAL_DOC_R1…`) y para un real solo emiten ID neutro, hash y agregados, sin ruta, nombre, contenido ni PNG.

## Veredicto por pregunta

| # | Pregunta | Veredicto |
|---|---|---|
| 1 | Licencia y distribución | **Parcial.** `zetajs` es MIT. Los assets WASM no traen ninguna licencia ni EULA propios. Se pueden autoalojar (los bajé del CDN público sin costo). Si se pueden redistribuir dentro de un instalador **no está dicho en ningún texto que encontré** **[NO CONFIRMADO]**. Existe el build upstream (MPL) y se puede compilar. |
| 2 | Assets | **Sí.** 4 archivos, 262 261 407 B en disco; 83,6 MB en gzip-9; 52,3 MB en brotli-11; 50,5 MB en LZMA2 (`xz -9`). |
| 3 | ¿Corre bajo la seguridad de la app? | **Parcial: no con la CSP actual.** Hace falta `'unsafe-eval'` en `script-src` (Embind usa `new Function`). Con `app://`, COOP/COEP y el resto de la CSP idénticos, y con `unsafe-eval` agregado, corre y `crossOriginIsolated` es `true`. Un Worker como host **no** es posible con este build (Qt exige DOM). |
| 4 | Sin red | **Sí.** 0 intentos de red en 3 lanzamientos con 9 archivos × 3 corridas (se bloqueaba todo lo que no fuera `app://`). |
| 5 | Sin disco | **Sí, con una nota.** El documento entra como bytes por IPC y el PDF sale como bytes. IndexedDB, CacheStorage, OPFS, localStorage y sessionStorage quedan vacíos. En `userData` no aparece ningún archivo con contenido del documento (búsqueda de 42 cadenas del documento en UTF-8 y UTF-16 sobre 66 archivos: 0 coincidencias; el control positivo sí detecta). |
| 6 | Tiempos | **Sí.** Arranque en frío 2,60 s (mediana). Conversión de 50 ms a 0,6 s por archivo. |
| 7 | Memoria | **Parcial.** Pico de ~1,47 GB de working set total (renderer ~1,1 GB) y ~2,35 GB de bytes privados. Vuelve a ~0,35 GB solo cuando se destruye la ventana; al destruir la página se queda en ~1,15 GB hasta que corre un GC. |
| 8 | Fidelidad | **Sí en el corpus sintético**, con diferencias que importan para anonimizar (ver notas). |
| 9 | Texto real | **Sí.** `getTextContent` devuelve el texto de todas las páginas de los 9 PDF (0 páginas sin texto). Todas las fuentes salen embebidas (subconjuntos). |
| 10 | Office cifrado | **No con este build.** Ver sección propia: ni con la contraseña correcta abre. Falta el servicio NSS. Hay que descifrar en JS antes y pasarle el archivo en claro. |

## 1. Licencia y distribución

- **`zetajs`** (el binding): MIT. https://github.com/allotropia/zetajs/blob/main/LICENSE ; npm 1.2.0, publicado 2025-05-30 (https://registry.npmjs.org/zetajs); tag v1.2.0 en GitHub, 2025-06-11. No hay releases de GitHub posteriores.
- **Assets WASM** (`soffice.wasm`, `soffice.data`, `soffice.js`, `soffice.data.js.metadata`): salen de `https://cdn.zetaoffice.net/zetaoffice_latest/` (cabeceras `Last-Modified: 2025-05-13`, abiertas, sin autenticación). **No hay archivo LICENSE ni versión en esa carpeta** (probé `LICENSE`, `LICENSE.txt`, `README.md`, `version.txt`: 404) y el paquete `soffice.data` no trae textos de licencia (busqué en su índice de 1903 archivos). La FAQ de https://zetaoffice.net dice que ZetaOffice es "open source software based on LibreOffice", que **self-hosting es posible** ("Both options are possible") y que los **paquetes pagos incluyen el uso de su CDN y soporte**. Ningún texto que encontré fija términos de redistribución de los binarios. **[NO CONFIRMADO]** si allotropia pone condiciones además de las licencias de código abierto. Conviene preguntarles por escrito.
- **Qué licencias cubren el contenido** (el README de zetajs dice que el código fuente de esos binarios es público): https://github.com/allotropia/zetajs#using-with-an-own-build → rama `distro/allotropia/zeta-24-2` de https://git.libreoffice.org/core, fork de Emscripten 3.1.65 (https://github.com/allotropia/emscripten) y Qt 5.15.2+wasm (https://github.com/allotropia/qt5, https://github.com/allotropia/qtbase). LibreOffice: **MPL 2.0** y "otras licencias de código abierto" para lo incluido (https://www.libreoffice.org/about-us/licenses/). Qt 5.15 es LGPLv3/GPL (el README de LOWA compila con `-opensource -confirm-license`): linkeado estáticamente dentro del `.wasm`, lo cual **puede traer obligaciones de LGPL** **[CONOCIMIENTO PREVIO, NO CONFIRMADO por un abogado]**. Las fuentes incluidas son libres (Liberation, Carlito, Caladea, DejaVu, Noto…, en su mayoría OFL) **[CONOCIMIENTO PREVIO]**. Versión exacta de LibreOffice dentro: no la leí; la rama dice 24.2 **[NO CONFIRMADO el punto de versión]**.
- **¿Existe un build WASM upstream que se pueda compilar por cuenta propia?** Sí: "LOWA", documentado en https://git.libreoffice.org/core/+/refs/heads/master/static/README.wasm.md (espejo legible: https://raw.githubusercontent.com/LibreOffice/core/master/static/README.wasm.md). Configuración `--with-distro=LibreOfficeWASM32`, Emscripten 4.0.10, Qt 5.15.2 con parches, y un Docker de `lode`. El resultado queda en `workdir/installation/LibreOffice/emscripten/`. Hay variante `--disable-gui` (headless, sin canvas), que sería la que permitiría un Worker. **No lo intenté compilar** (horas, y está fuera del alcance); sirve además para sacar los `new Function` (opción de Emscripten) y para incluir NSS **[NO CONFIRMADO que alcance]**.

## 2. Assets

| Archivo | Disco (B) | Como lo sirve el CDN (brotli) |
|---|---|---|
| `soffice.wasm` | 161 667 499 | 36 279 250 |
| `soffice.data` | 99 520 604 | 15 891 013 |
| `soffice.js` | 858 124 | (sin comprimir) |
| `soffice.data.js.metadata` | 215 180 | (sin comprimir) |
| **Total** | **262 261 407** (250,1 MiB) | ~53,2 MB |

Importante: **el CDN sirve `Content-Encoding: br`**, así que las cifras de la investigación previa (32 MB + 15 MB) son los pesos comprimidos; en disco el WASM pesa 161,7 MB. Hay que descomprimir al empaquetar (un `curl` sin `--compressed` guarda el brotli crudo: me pasó). Los originales comprimidos quedaron en `vendor\zetaoffice-br\`.

Crecimiento aproximado del instalador (mismos 4 archivos, `results\compresion.txt`): gzip-9 83 582 809 B; brotli-11 52 321 079 B; LZMA2 (`xz -9`, aproxima NSIS/7z) **50 516 816 B (48,2 MiB)**. 7z no está en esta máquina; `xz` es el sustituto. Versiones: zetajs 1.2.0; ZetaOffice = `zetaoffice_latest` del CDN, sha256 en `vendor\`: wasm `9ebd9a48…5bd4`, data `3dab0a54…361c`, js `5143e535…cd77` (los dos primeros descomprimidos).
Contenido de `soffice.data` (descomprimido, por índice): 55 MB de fuentes, 35 MB de `share/config` (UI), el resto registro, filtros y tipos. Se podría recortar (UI, galería, fuentes que no se usan) pero **no lo probé** **[NO CONFIRMADO]**.

## 3. Bajo la seguridad de la app

Harness: `harness\main.js` copia `CONTENT_SECURITY_POLICY` e `ISOLATION_HEADERS` de `security.ts` (CSP solo en los `.html`, COOP/COEP/CORP en todo, `immutable` en el resto), registra `app://` con los mismos privilegios de `main.ts` (`standard, secure, supportFetchAPI, corsEnabled, stream`), usa el mismo `webPreferences` (`sandbox`, `contextIsolation`, `nodeIntegration:false`), los mismos switches y `net.fetch(file://)` + `Content-Length`. Sirve los assets por `app://local/zo/…`: sin HTTP y sin CDN.

**Violaciones de CSP observadas (todas reproducidas en `results\variantes\`):**

1. **`script-src` bloquea `eval` / `new Function` → hace falta `'unsafe-eval'`.** Mensaje: `Evaluating a string as JavaScript violates … 'unsafe-eval' is not an allowed source … script-src 'self' blob: 'wasm-unsafe-eval'`. Origen exacto (traza): `craftInvokerFunction → newFunc` en `soffice.js` (Embind, al registrar las clases UNO), en el documento. Con la CSP actual `soffice.js` aborta al cargar y el arranque no llega nunca (1 violación por intento; el harness lo corta por timeout). No es un caso de `wasm-unsafe-eval` (ya está permitido y alcanza para compilar el WASM).
2. **El `threadWrapScript` de `zetaHelper.js` es una URL `data:`** que el hilo de LibreOffice carga con `importScripts`; `script-src` la bloquea (`Loading the script 'data:text/javascript…' violates … script-src`). Se resuelve **sin debilitar la CSP** sirviendo ese mismo código como archivo del mismo origen (`harness\page\thread-wrap.js`); es la única adaptación. `blob:` en `script-src` y `worker-src` ya está (LibreOffice crea sus hilos `em-pthread` desde blobs).
3. Nada más: sin violaciones de `connect-src`, `img-src`, `font-src`, `style-src` ni `frame-src`. No hizo falta tocar COOP/COEP ni la CSP del resto.

**Variante medida (no adoptada como solución):** `script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'`, **solo en el documento del harness**. Con ella todo lo demás de este informe corre. `crossOriginIsolated: true`, `SharedArrayBuffer: function`. Una forma de acotarla es que la conversión viva en su propio documento (una ventana oculta aparte con su CSP), y no en el de la app; no la medí como arquitectura.

**¿Dentro de un Worker, como el Core?** Probé alojar `soffice.js` en un Worker dedicado servido desde `app://` (`harness\page\host-worker.js`, `host=worker`). **No funciona con este build**: el build de GUI usa Qt sobre un `<canvas>` y toca `document` (`pthread_create: failed to transfer control of canvas… ReferenceError: document is not defined`; con un `OffscreenCanvas` de reemplazo sigue con `registerOrRemoveHandler: the target element … does not exist` y `Cannot read properties of undefined (reading 'baseURI')`). Hace falta un documento. Lo que sí corre en Workers es lo de adentro: **LibreOffice ya corre en hilos `em-pthread` (workers)**; el documento solo hospeda `soffice.js`, hace de puente y mueve bytes por `FS`. Un build `--disable-gui` podría cambiar esto **[NO CONFIRMADO]**. Dato lateral medido: bajo la CSP estricta, un Worker cargado desde una URL `app://` **sí puede hacer `eval`/`new Function`** (la CSP del documento no se hereda a un Worker con URL y el shell no manda CSP en archivos que no sean `.html`), mientras que un Worker `blob:` y el documento no (`results\eval-workers\`). Eso es una propiedad actual de `main.ts`/`security.ts`, no de este spike.

## 4. Red

`session.webRequest.onBeforeRequest` cancelaba y registraba todo lo que no fuera `app://` (permitiendo solo `blob:`/`data:` internos y el `net.fetch(file://)` del propio handler, igual que `main.ts`). Resultado: **0 intentos** (3 lanzamientos × 9 archivos × 3 corridas). Sin fuentes remotas, sin telemetría. 17 requests `app://` por lanzamiento. Con el CDN por defecto de `zetaHelper` habría salido a la red; por eso se usa `wasmPkg: 'url:app://local/zo/'`.

## 5. Sin disco (persistencia)

- El documento entra por IPC (`spike:file`, bytes en memoria), se escribe en el FS en memoria de Emscripten (`/tmp/input.<ext>`, MEMFS) y se borra tras convertir; el PDF se lee con `FS.readFile` y viaja como bytes. El harness guarda los PDF en `results\` solo para analizarlos: esa escritura es del harness, no de la ruta de la app.
- Tras correr: `localStorage` 0, `sessionStorage` 0, `indexedDB.databases()` `[]`, `caches.keys()` `[]`, OPFS `[]`, `navigator.storage.estimate().usage` 0.
- `userData` antes/después: la página vacía sola (baseline, `results\baseline\`) ya cambia 44 archivos de Chromium (cachés de GPU/Dawn, Local Storage, etc.). Con ZetaOffice cambian 62: los 18 extra son `GPUCache` (más grande), `Session Storage`, `WebStorage/QuotaManager` y `File System/…` (bases LevelDB de metadatos de rutas, de 0 a 300 B, **sin archivos de contenido**).
- Búsqueda de contenido: 42 cadenas tomadas del texto de los documentos, en UTF-8 y UTF-16LE, sobre `userData` y los archivos nuevos de `%TEMP%` (66 archivos, 8 MB): **0 coincidencias**. Control positivo (un archivo sembrado a propósito) **sí** se detecta.
- **[NO CONFIRMADO]**: `Code Cache/wasm` de V8 puede guardar el WASM compilado en disco (es código, no datos del usuario); en esta corrida el índice no creció. Que V8 no vuelque nada de la memoria del proceso a un archivo de paginación es del sistema operativo, no se midió.

## 6. Tiempos (esta máquina, caché de archivos del SO caliente)

Arranque en frío (proceso nuevo, cargar WASM de 162 MB + datos de 99 MB desde `app://`, inicializar LibreOffice): **2 564 / 2 604 / 2 630 ms, mediana 2 604 ms**. Desglose: `soffice.js` listo a 22 ms; hilo de LibreOffice arriba a ~2,5 s. **[NO CONFIRMADO]** con caché de disco fría (no pude vaciarla sin permisos).

Conversión, 3 lanzamientos × 3 corridas por archivo (mediana). «1.ª» es la primera conversión del proceso (incluye la inicialización perezosa de cada módulo Writer/Calc/Impress):

| Archivo | Entrada KB | 1.ª conv. ms | Tibia ms | Todas ms | PDF KB | Páginas |
|---|---|---|---|---|---|---|
| contrato_carta.docx | 30 | 527 | 106 | 118 | 50 | 2 |
| fuentes.docx | 10 | 63 | 52 | 54 | 75 | 1 |
| hoja_ancha.xlsx | 8 | 196 | 55 | 58 | 13 | 4 |
| hoja_grande.xlsx (5 000 filas) | 191 | 604 | 562 | 568 | 334 | 162 |
| informe_a4.docx | 12 | 56 | 57 | 56 | 27 | 2 |
| largo_40pag.docx | 13 | 277 | 254 | 257 | 154 | 34 |
| libro_clientes.xlsx | 9 | 160 | 92 | 97 | 18 | 3 |
| oficio.docx | 10 | 70 | 53 | 56 | 19 | 1 |
| presentacion.pptx | 88 | 301 | 120 | 121 | 41 | 3 |

Los tiempos incluyen copiar los bytes al FS y leer el PDF. Un documento de 34 páginas tarda ~0,26 s y uno de 162 páginas ~0,57 s. Sin timeouts ni errores en 81 conversiones.

## 7. Memoria

`app.getAppMetrics()` cada 250 ms, suma de todos los procesos de la app (KB convertidos a MB). Referencia: **página vacía = 303 MB working set / 140 MB privados**.

| Lanzamiento | Pico en arranque WS/priv | Pico durante conversiones WS/priv | Al terminar (+1,5 s) WS/priv | Tras destruir la página (+10 s) WS/priv | Tras forzar GC WS/priv | Ventana destruida WS/priv |
|---|---|---|---|---|---|---|
| 0 | 900/1690 | **1489/2375** | 1241/2077 | 1165/2020 | 515/465 | 359/364 |
| 1 | 902/1694 | 1468/2342 | 1239/2075 | 1161/2015 | 515/466 | 360/364 |
| 2 | 903/1687 | 1461/2337 | 1230/2066 | 1151/2006 | 502/451 | 351/354 |

En el pico el proceso del renderer (donde viven los hilos de LibreOffice) tiene ~1,1 GB y el resto (browser, GPU, red) ~0,35 GB. Es **+1,16 GB de working set y +2,2 GB de bytes privados sobre la página vacía**, y se suma a la memoria del pipeline y al modelo NER. La memoria **no baja al terminar de convertir** (el heap de WASM no se achica): baja a ~0,5 GB después de navegar a otra página **y** forzar un GC (`HeapProfiler.collectGarbage`), y a ~0,35 GB al destruir la ventana. Sin forzar GC, queda ~1,15 GB. No medí por archivo porque el heap solo crece (los máximos «por archivo» de `unsafe-eval-adapted-resumen.txt` reflejan el momento del muestreo, no el costo del archivo). Un documento mucho más grande puede subir el pico **[NO CONFIRMADO]** (el mayor probado: 162 páginas).

## 8. Fidelidad (sintético)

Compruebo que todo el texto del XML de origen (`w:t`, `a:t`, cadenas de Excel, notas, encabezados) aparezca en el texto del PDF extraído con pdf.js (`analyze.mjs`, comparación sin espacios, NFC), y reviso a ojo PNG de las páginas (`results\fidelidad\png\`).

| Archivo | Páginas y tamaño | Texto del XML presente en el PDF | Notas |
|---|---|---|---|
| contrato_carta.docx | 2: Carta vertical 612×792 y Carta apaisada 792×612 | cuerpo, encabezado/pie, notas al pie y tabla: 100 %. Campo de página («Pagina 1 de 2») correcto | Lista numerada y viñetas, tabla con celda combinada, imagen: bien. El **control de cambios aparece visible**: el texto eliminado sale tachado y de color, con su texto dentro del PDF. El **texto oculto no sale**. Los **comentarios no salen** (queda solo el rango). La imagen con texto queda como imagen (sin capa de texto: necesita OCR, como un escaneo). El texto de la tabla se parte en renglón («ejemplo.te/st») por ancho de columna: es el ajuste de Word, no un error. |
| informe_a4.docx | 2, A4 595,3×841,9 | 100 % | Encabezado, pie con número, tabla con filas y columnas combinadas, listas: bien |
| oficio.docx | 1, **612×936 (8,5×13 in)** | 100 % | Tamaño Oficio respetado |
| largo_40pag.docx | 34, A4 | 100 % | 4 102 ítems de texto, sin páginas vacías |
| fuentes.docx | 1 | 100 % | Ver sustitución de fuentes |
| libro_clientes.xlsx | 3, Carta | Hoja visible: 100 % salvo lo que queda fuera del **área de impresión** | **El área de impresión se respeta** (A1:F6; la celda combinada de A8 no sale). **La hoja oculta no sale.** Una hoja con 6 columnas se parte en 2 páginas por ancho. Fórmulas: se ven los valores calculados |
| hoja_ancha.xlsx | 4, Carta vertical | Incompleto | 30 columnas → ~10 columnas por página (3 páginas) y una cuarta con el sobrante de filas. El **texto que no cabe en su columna se recorta** («Marta Lope20.111.222…»): lo recortado **no está en el PDF** (6 nombres completos faltan). Es como lo imprime Excel, pero significa que el PDF no es una copia fiel del contenido de la celda |
| hoja_grande.xlsx | 162, Carta apaisada | Ídem recorte de columnas angostas | 5 000 filas, ajuste a 1 página de ancho; 58 187 ítems de texto |
| presentacion.pptx | 3, **una por diapositiva**, 720×405 (16:9) | Diapositivas 100 % | Tabla, imagen y cuadro de texto con ajuste: bien. **Las notas del orador no salen** por defecto. Con `FilterData: ExportNotesPages=true` (cómo pasarlo: `new zetajs.Any(zetajs.type.sequence(zetajs.type.struct(css.beans.PropertyValue)), [...])`; si no, se ignora en silencio) salen 6 páginas: las 3 diapositivas y 3 páginas de notas verticales con el texto de las notas |

Faltantes que reporta `analyze.mjs` y que **no** son defectos: números de fórmula como `217.76999999999998` (mi comparación contra el valor guardado, el PDF muestra `217,77` redondeado); texto oculto, hoja oculta, comentarios y notas, que son decisiones del filtro.

**Fuentes.** Todas las fuentes salen embebidas como subconjuntos (`pdffonts`: `emb=yes` en todas). El build trae Liberation (Sans/Serif/Mono/Narrow), Carlito, Caladea, DejaVu, Noto (Sans/Serif y varias escrituras), Linux Libertine, Gentium y alguna más; **no trae** las de Windows. Mapeo medido en `fuentes.docx`: Arial → LiberationSans; Calibri → Carlito; Times New Roman → LiberationSerif; Cambria → Caladea; Courier New → LiberationMono; Consolas → DejaVuSansMono; Georgia y Garamond → NotoSerif; Verdana, Tahoma, Segoe UI, Comic Sans MS, Aptos y Trebuchet MS → NotoSans. Las cuatro primeras son de métrica compatible (el reparto de líneas y páginas debería coincidir con Office); el resto no, así que **el salto de línea y de página puede diferir del de Office** **[NO CONFIRMADO: no hay Office en esta máquina para comparar]**.

**Texto real (9).** Los 9 PDF tienen texto (`getTextContent` con palabras, no contornos; 0 páginas sin texto; mínimo >0 caracteres por página). La verificación fue sobre `pdfjs-dist` 4.10.38 en Node (versión `legacy`), no dentro del Worker del Core.

## 10. Office cifrado (ECMA-376 Agile)

**Generación.** Con `officecrypto-tool` 0.0.19 (MIT; deps `cfb` 1.2.2 Apache-2.0, `crypto-js` 4.2.0 MIT, `xml2js` 0.6.2 MIT; en `vendor\npm-crypto\`): `.docx`, `.xlsx` y `.pptx` con contraseña inventada, más un `.docx` Standard (el antiguo), un cifrado truncado a la mitad, 4 KB de bytes aleatorios con extensión `.docx` y un `.docx` sin cifrar al que se le pasa clave. EncryptionInfo 4.4: AES-256-CBC, SHA-512, `spinCount=100000`, keyData de 16 B de sal: los parámetros del Agile de Office 2010+. **[NO CONFIRMADO]** que Word/Excel/PowerPoint abran estos archivos (no hay Office; la librería solo se probó contra sí misma). **Guardar con contraseña desde el propio ZetaOffice falla**: `component context fails to supply service com.sun.star.xml.crypto.NSSInitializer` en `storeToURL` con `Password` (`results\cifrado-lo\`).

**Resultado de ZetaOffice** (`results\cifrado\`, `cifrado-handler\`; cada caso en proceso caliente):

| Caso | Con `Password` en los argumentos de carga | Con `InteractionHandler` que responde la contraseña |
|---|---|---|
| Agile, contraseña correcta (.docx/.xlsx/.pptx) | **`null`** tras ~3,5 s | `type detection aborted`, tras 2 pedidos de contraseña (~0,3 s): **no la acepta** |
| Agile, contraseña equivocada | `IllegalArgumentException: Unsupported URL … "type detection aborted"` en 0,14–0,19 s | igual |
| Agile, sin contraseña | `IllegalArgumentException … "type detection aborted"` en 0,07 s | pide contraseña una vez (`DocumentMSPasswordRequest2`); al abortar da lo mismo |
| Standard, correcta / equivocada | `null` (0,85 s) / `type detection aborted` | `type detection aborted` en los dos |
| Cifrado truncado | `null` en 18 ms | **`BrokenPackageRequest`** (paquete roto) y `null` |
| Bytes aleatorios `.docx` | **abre como texto plano y genera un PDF de 120 KB** | igual |
| Sin cifrar, con clave | `null` si la clave no está vacía (cualquier `Password` no vacío rompe la carga de un .docx plano) | abre normal (51 KB de PDF) |

Conclusión: **con la contraseña correcta, este build no abre un Office cifrado**; la devuelve igual que la equivocada. La causa es el mismo servicio ausente: sin `com.sun.star.xml.crypto.NSSInitializer` (NSS no está compilado en el build WASM) LibreOffice no puede descifrar ni cifrar OOXML. **[NO CONFIRMADO]** que sea la única causa (no hay stderr de LibreOffice; la inferencia sale del error de `storeToURL`).

**¿Se puede distinguir equivocada/ausente de roto?** Solo con un `InteractionHandler`: el pedido `com.sun.star.task.DocumentMSPasswordRequest2` indica «archivo cifrado, hace falta contraseña»; `com.sun.star.document.BrokenPackageRequest` indica roto. Sin handler solo hay `IllegalArgumentException` («type detection aborted», que cubre cifrado con clave mala o ausente) y `null` (roto, o clave correcta en este build): no alcanza. Además **los bytes aleatorios no se rechazan** (se abren como texto): el chequeo de firma (ZIP `PK` o CFB `d0cf11e0a1b11ae1`) tiene que hacerse antes, fuera de LibreOffice.

**Tiempo.** Con la clave correcta ZetaOffice tarda ~3,5 s (Agile) y ~0,85 s (Standard) y falla; con clave mala 0,14–0,19 s.

**Vía recomendable (medida parcialmente): descifrar en JS y pasar el archivo en claro.** Con `officecrypto-tool` en Node (`results\cifrado-js-probe.txt`): Agile correcta 0,41–0,45 s; Standard 0,05 s; clave mala → `The password is incorrect` (0,34 s); sin clave → error distinto; truncado y bytes aleatorios → errores distintos (`Cannot read properties of undefined`, `Header Signature: Expected d0cf11e0a1b11ae1…`); un `.docx` plano → `isEncrypted()=false`. El archivo descifrado es idéntico al original y el PDF resulta igual que el del archivo plano.

**¿Se puede descifrar con WebCrypto propio, sin el conversor?** **Sí, según la especificación, y salvo un detalle.** (Es lectura de especificación; no lo implementé, salvo las dos comprobaciones que cito.)
- Fuente: [MS-OFFCRYPTO] Agile Encryption, https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-offcrypto/a57cb947-554f-4e5e-b150-3f2978225e92 (generación del PasswordKeyEncryptor: `spinCount`, SHA-512, `blockKey` fijos `fea7d2763b4b9e79`, `d7aa0f6d3061344e`, `146e0be7abacd0d6`, IV = sal, relleno con ceros hasta múltiplo de bloque). Leí solo esa página. La derivación (§2.3.4.11) y el IV (§2.3.4.12) los vi enlazados desde ella y **no las leí**; los pasos de abajo salen de esa página, de `ecma376_agile.js` de la librería y de conocimiento previo.
- Pasos: `H0 = SHA512(sal ‖ UTF-16LE(clave))`, luego `Hn = SHA512(contador32LE ‖ Hn-1)` por `spinCount` (100 000) vueltas, y un hash final con el `blockKey`, recortado a `keyBits`. Con esa clave se descifra con AES-CBC el `encryptedKeyValue`, el verificador (`encryptedVerifierHashInput/Value`) y después el `EncryptedPackage` en segmentos de 4096 B con IV por segmento (`SHA512(sal de keyData ‖ índice)` recortado a 16 B) **[CONOCIMIENTO PREVIO + código de la librería]**. Se lee el CFB (`EncryptionInfo`, `EncryptedPackage`) con un parser propio o `cfb`.
- **Costo:** 100 000 `digest` secuenciales de SHA-512 con `crypto.subtle` tardan **2,0 s** en Node 22 (`results\cifrado-js-probe.txt`; `digest` es asíncrono por llamada); con SHA-512 síncrono (`node:crypto`) son 0,12 s. En el Worker, un SHA-512 propio en JS/WASM síncrono es probablemente más rápido que WebCrypto, y cada intento de contraseña paga el costo completo **[NO MEDIDO en Electron]**.
- **El detalle:** AES-CBC de WebCrypto exige relleno PKCS#7 al descifrar y los datos de Office no lo llevan (https://lists.w3.org/Archives/Public/public-webcrypto-comments/2014Jun/0009.html pide justamente una opción sin relleno). Se resuelve agregando un bloque de relleno válido cifrado con IV = último bloque del texto cifrado. **Lo comprobé** con un segmento de 4096 B: idéntico al de `node:crypto` (WebCrypto de Node 22, no el de Chromium **[NO CONFIRMADO en Electron]**).
- La verificación de la contraseña (el hash del verificador) da el «clave equivocada» sin tocar el paquete. La integridad (`dataIntegrity`, HMAC) es opcional de comprobar.
- Para exportar un Word cifrado de vuelta, la librería ya genera Agile; ZetaOffice no puede (NSS).

## Notas y riesgos para el planificador

- **`unsafe-eval` es el bloqueante**: la CSP actual no lo admite y no lo adopté. Salidas posibles (no medidas): (a) conversión en una ventana oculta aparte con su propia CSP; (b) compilar un LOWA propio con `DYNAMIC_EXECUTION=0` o `--disable-gui` **[NO CONFIRMADO que sea viable]**.
- **Memoria:** ~1,2 GB de working set más que una página vacía, que no se devuelve sin destruir el contexto. Importa para los techos de ADR-192.
- **Texto que el PDF muestra y el origen también tiene (control de cambios, texto tachado)** sale en el PDF; **texto del origen que el PDF no muestra** (comentarios, notas del orador, texto oculto, hojas ocultas, celdas recortadas, fuera del área de impresión) **no está en el PDF**: para el Word y el Excel limpios hay que decidir por separado qué se hace con eso (el spike de alineación XML–página lo medirá).
- Un archivo roto o con una extensión falsa puede **abrirse como texto plano**: validar la firma antes.
- Una vez ocurrió `RuntimeError: memory access out of bounds` en un hilo de LibreOffice al final de la corrida de cifrados (tras 16 cargas, varias fallidas, y después de `done`); no se repitió en las corridas de la medición principal. **[NO CONFIRMADO]** causa.
- El formato de origen no se anonimiza acá: los datos del corpus son inventados.

## Intentos de red (detalle)

Ninguno. `results\medicion\unsafe-eval-adapted-launch*.json` → `log.netAttempts: []`.

## Versiones y licencias de lo que descargué

| Qué | Versión | Licencia | Para qué |
|---|---|---|---|
| zetajs | 1.2.0 | MIT | binding (`vendor\zetajs-pkg\`) |
| Assets ZetaOffice (`soffice.*`) | `zetaoffice_latest` (Last-Modified 2025-05-13) | sin texto propio; LibreOffice MPL 2.0 + Qt 5.15 + emscripten + fuentes (ver §1) | conversor (`vendor\zetaoffice-assets\`, `vendor\zetaoffice-br\`) |
| docx | 9.16.0 | MIT | generar corpus |
| exceljs | 4.4.0 | MIT | generar corpus |
| pptxgenjs | 4.0.1 | MIT | generar corpus |
| pdfjs-dist | 4.10.38 | Apache-2.0 | extraer texto |
| jszip | 3.10.2 | MIT OR GPL-3.0-or-later | leer los XML de origen |
| officecrypto-tool | 0.0.19 | MIT (cfb 1.2.2 Apache-2.0, crypto-js 4.2.0 MIT, xml2js 0.6.2 MIT) | generar y probar Office cifrado |
| Herramientas del sistema | poppler 25.07.0 (`pdftoppm`, `pdffonts`, `pdfinfo`) y `xz` | GPL | PNG, fuentes y compresión (ya instaladas; no se descargó nada) |

Electron no se descargó: el del repo (44.11.5). No se ejecutó ningún instalador ni `.exe` descargado.

## Cómo volver a correrlo

```
node harness\gen-corpus.cjs corpus corpus\_constancia.png        # corpus (la imagen sale de harness\make-png.js con electron)
node harness\measure.mjs --out results\medicion --dir corpus --variant unsafe-eval --mode adapted --runs 3 --launches 3
node harness\summarize.mjs results\medicion unsafe-eval-adapted
node harness\analyze.mjs --pdfs results\medicion\pdf-unsafe-eval-adapted --corpus corpus --out results\fidelidad
# cifrados:
node harness\gen-crypto.cjs corpus corpus-crypto
node harness\measure.mjs --out results\cifrado --cases corpus-crypto\cases.json --variant unsafe-eval --runs 1 --launches 1 [--interactive true]
```
Con archivos exportados desde Google: ponerlos en una carpeta y `--dir <carpeta>`. Con reales: `ANONLY_REAL_DOC_R1=<ruta>` (etc.) en el entorno; para el análisis de fidelidad pasar los mismos IDs. `--variant strict` reproduce la violación de CSP; `--mode stock` usa `zetaHelper.js` sin adaptar; `--notes true` exporta las notas del orador.
Los scripts leen solo `corpus\` y `vendor\`; `measure.mjs` pone los archivos en un `job.json` temporal (que borra) y las rutas de los reales nunca van a `results\`.
