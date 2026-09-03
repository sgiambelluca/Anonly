<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,core/Contracts.md,adr/ADR-090-La-Orientacion-De-Un-Escaneo-Se-Detecta.md,adr/ADR-112-El-Sello-No-Es-Un-Parrafo.md,adr/ADR-018-Assets-First-Party.md,roadmap/OCR_Escaneos_Handoff.md | audiencia=humanos+IA | fase=11 -->

# ADR-119 — La orientación se detecta con el motor que la sabe leer

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, que preguntó qué pasa si el escaneo entero está girado — el texto va de abajo hacia arriba y cada renglón más a la derecha.
- **Relacionado con**: **ADR-090** (que introdujo la detección de orientación y cuya premisa técnica resultó incompleta), ADR-018 (assets first-party), ADR-112 (el otro parámetro de Tesseract que se aplica por instancia de worker)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** El expediente sobre el que se midió es real y no se transcribe acá (`08_Security_Model.md` §10.2). Precedente: ADR-084.

## Contexto

### 1. La pregunta, y la respuesta medida

Si la hoja entera se escanea girada, ¿la herramienta la lee? Medido sobre una página de 268 palabras nativas:

```
1. la hoja derecha (control)                 recall: 266/268
2. la hoja ENTERA girada 90, sin enderezar   recall:   1/268
3. la misma hoja, enderezada a mano          recall: 266/268
```

**No la lee: pierde el documento entero.** Enderezarla lo recupera todo, así que el mecanismo que ADR-090 diseñó es el correcto. El problema es que **nunca se dispara**.

### 2. `detect()` necesita el motor legacy, no solo el core legacy

ADR-090 §1 razonó así: *"`worker.detect()` está guardado por `if (lstmOnlyCore) throw` en tesseract.js: OSD es un modelo legacy, así que agregar `osd.traineddata` sin cambiar el core no alcanza. El reconocimiento sigue siendo LSTM; el core completo solo trae además el código legacy que OSD necesita."*

La premisa es cierta y la conclusión no alcanza. Con `legacyCore: true` la llamada **deja de tirar**, pero eso no es lo mismo que funcionar: falta que el **OEM** sea legacy. Medido sobre dos documentos y cuatro orientaciones cada uno:

| configuración | hoja derecha | girada 90° | girada 180° | girada 270° |
|---|---|---|---|---|
| **`oem` sin especificar, `legacyCore: true` — la de producción** | 0 / **0,0** | 0 / **0,0** | 0 / **0,0** | 0 / **0,0** |
| `oem = 0` (legacy) | 0 / 13,6 | **270** / 13,5 | **180** / 14,0 | **90** / 15,6 |
| `oem = 1` (lstm) | 0 / 0,0 | 0 / 0,0 | 0 / 0,0 | 0 / 0,0 |
| `oem = 3` (default) | 0 / 0,0 | 0 / 0,0 | 0 / 0,0 | 0 / 0,0 |

*(orientación / confianza; el kernel solo hace caso si la confianza ≥ `MIN_ORIENTATION_CONFIDENCE`, que es 1)*

Con la configuración de producción OSD devuelve **siempre 0 con confianza 0**, `readOrientation` lo rechaza por el piso, y el kernel no rota nunca. **La detección de orientación de ADR-090 es código muerto desde que se escribió.**

Por qué nadie lo notó: `detectOrientation` traga cualquier fallo y cae a `0` —decisión explícita de ADR-090, y correcta como degradación—, el kernel no tiene logger por diseño (ADR-045 §2), y el corpus de prueba no tenía ninguna página torcida. Una función que solo puede fallar en silencio no avisa cuando nunca funcionó.

### 3. El mismo worker no puede hacer las dos cosas

`oem = 0` haría andar OSD, pero rompe el reconocimiento: el `traineddata` pineado es **`tessdata_best`**, que es solo LSTM, y con OEM legacy los idiomas no cargan —`Tesseract (legacy) engine requested, but components are not present in ./spa.traineddata`—. Un worker sirve para detectar o para reconocer, no para las dos.

### 4. Y OSD no necesita el raster completo

Solo tiene que elegir entre cuatro orientaciones, no leer. Medido sobre las cuatro:

| escala | píxeles | aciertos | confianza | ms/página |
|---|---|---|---|---|
| 1 | 2482 × 3509 | 4/4 | 14-16 | 690 |
| **0,5** | 1241 × 1755 | **4/4** | **12-16** | **290** |
| 0,35 | 869 × 1228 | 4/4 | **1-2** | 198 |
| 0,25 | 621 × 877 | **0/4** | 1-2 | 94 |
| 0,15 | 372 × 526 | 0/4 — *"too few characters"* | 0 | 13 |

**Por debajo de 0,5 el número deja de ser confiable antes de dejar de existir**, que es el modo de falla peligroso: a 0,25 acierta cero veces y sigue devolviendo confianza 1-2, o sea **por encima del piso**. El piso no protege de un OSD mal alimentado; el margen sí.

## Decisión

### 1. Un worker dedicado a OSD

`ensureOsdWorkerLoaded` crea un worker aparte con `["osd"]`, **`oem = 0`** y `legacyCore: true`. `detectOrientation` lo usa; el worker principal deja de cargar `osd` y deja de pedir `legacyCore`, porque ya no lo necesita.

> **Errata (2026-09-03) — sacarle `legacyCore` al worker principal cambia qué archivo pide**: `lstmOnly = [OEM.DEFAULT, OEM.LSTM_ONLY].includes(oem) && !options.legacyCore` (`tesseract.js@6.0.1/src/createWorker.js:36`), y con `lstmOnly: true` `getCore.js` importa `tesseract-core-simd-lstm.wasm.js` dentro de `corePath` — el archivo que `assets.lock.json` **dejó de mirrorear** cuando ADR-090 §1 reemplazó los pines LSTM-only por los completos. Este ADR no tocó el lock, así que dejó toda página escaneada en `importScripts` 404 → `createWorker` rechaza → `OcrModelMissingError`. El mirror pasa a llevar los **cuatro** cores: `tesseract-core[-simd]-lstm` para el worker de reconocimiento y `tesseract-core[-simd]` para el de OSD. Es la alternativa que ADR-090 descartó por *"duplica lo mirroreado sin ningún caso que lo pida"* — **este ADR es el caso**. En runtime no cambia nada: cada worker sigue bajando un core. Lo detectó el Escenario 2 E2E, el único gate que corre Tesseract de verdad.

### 2. La detección corre sobre el raster a media escala

`OSD_SCALE = 0,5`. No es una optimización oportunista: es lo que hace que el arreglo **no cueste tiempo**.

### 3. La degradación silenciosa se conserva, con una excepción

Cualquier fallo sigue cayendo a `0` (ADR-090 §3). Pero **si el worker de OSD no se puede crear**, eso no es "esta página está derecha": es que la detección no está disponible. Se propaga como `OcrModelMissingError`, igual que el worker principal, en vez de fingir que todas las páginas están derechas.

## Consecuencias

**El arreglo sale más barato que el estado actual.** Medido sobre 4 páginas de un escaneo real:

| | arranque | detect | ocr | total por página |
|---|---|---|---|---|
| **hoy** (un worker, detect roto) | 378 ms | **506 ms** | 3205 ms | 3711 ms |
| **con este ADR** (OSD aparte, media escala) | 227 + 294 ms | **290 ms** | 3256 ms | **3546 ms** |

Hoy ya se pagan 506 ms por página por una detección que devuelve `0/0` **siempre**. A media escala, una que funciona cuesta 290 ms: **−216 ms por página**.

Costo real: **+99 MB** por el worker de OSD, contra el core legacy que el worker principal deja de cargar.

Costo de mirror (errata de arriba): **+7,9 MB en disco** por los dos cores LSTM-only que vuelven al lock. No lo paga el usuario — el browser baja un core por worker, igual que antes.

**La geometría de ADR-090 era correcta y queda verificada.** OSD devuelve el ángulo de **corrección** (imagen girada 90° → informa 270), que es exactamente la convención que `rotateImageData` documenta. De punta a punta, replicando la secuencia del kernel:

| giro real | OSD informa | recall tras enderezar | cajas sobre tinta |
|---|---|---|---|
| 90° | 270 | 266/268 | **282/282 (100 %)** |
| 180° | 180 | 266/268 | **282/282 (100 %)** |
| 270° | 90 | 266/268 | **282/282 (100 %)** |

`unrotateBbox` devuelve cada caja al raster torcido y **todas caen sobre tinta**. La sospecha de que la correspondencia de ángulos pudiera estar invertida quedó descartada con número.

**En contra**

- **Dos workers de Tesseract vivos** donde había uno. Es memoria y es una instancia más que liberar en `dispose`.
- **`OSD_SCALE` es una constante nueva**, y su valor sale de un barrido sobre **un** documento. El margen elegido (0,5, con confianza 12-16 contra un piso de 1) es amplio a propósito, justamente porque abajo el error es silencioso.
- **Este ADR no cierra el caso.** Con la orientación arreglada el texto se **reconoce** (266/268) pero llega al detector **desordenado**: `bbox.rotation` manda todas las palabras por la rama de runs rotados de ADR-067, pensada para unas pocas palabras en un margen, y el orden de lectura colapsa a **132-152 de 267** pares consecutivos. El arreglo de eso es de `pdf-engine` y va en su propio PR (R-1) — prototipado y medido en **265/267**.

**Lo que no toca**: `MIN_ORIENTATION_CONFIDENCE`, `rotateImageData`, `unrotateBbox`, la propagación de `bbox.rotation` de ADR-090 §4, el modo de segmentación de ADR-112, ni ningún contrato — `OcrConfig` no cambia.

## Qué hay que cubrir con tests

- El worker de OSD se crea con `oem = 0` y solo `["osd"]`; el principal, sin `osd` y sin `legacyCore`. Es la línea que estaba mal y la que nadie miraba.
- La imagen que recibe `detect` mide la mitad que la de `recognize`.
- Una detección con confianza bajo el piso sigue cayendo a `0`.
- Un `detect` que tira sigue cayendo a `0` (la degradación de ADR-090 §3).
- Un worker de OSD que no se puede crear **lanza** `OcrModelMissingError` en vez de degradar a `0`.
- `dispose` libera los dos workers, y tolera que cualquiera de los dos falle al terminar.
- Que un PDF **escaneado real** siga produciendo entidades > 0 de punta a punta (Escenario 2 E2E). Ninguna prueba con `vi.mock("tesseract.js", …)` puede ver un core que falta: el doble no descarga nada.
