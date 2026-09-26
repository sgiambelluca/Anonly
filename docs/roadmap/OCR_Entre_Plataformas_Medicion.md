<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/Agrupacion_Difusa_Medicion.md,roadmap/Banco_Windows_Comparativa_Medicion.md,roadmap/Ciclos_Y_Documentos_Reales_Medicion.md,adr/ADR-158-El-Raster-De-OCR-Viaja-Codificado.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,core/OCR_Engine.md,core/Render_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (investigación Windows/WSL 2026-09-25 y ampliación macOS 2026-09-26 cerradas; sin cambio de producto) -->

# El OCR de un escaneo cambia con la plataforma — medición

> Medido el 2026-09-25. Windows 11 Pro 26200 nativo e Ubuntu bajo WSL2, **sobre
> la misma máquina** (i5-12400) y el **mismo commit** (`45d07fd`; el código de
> OCR, Render y PDF es idéntico desde `bbb32b8`). Ampliación macOS M1 el
> 2026-09-26 en `bd6bd92`, con los mismos PDF sintéticos originales: ver la
> sección final. Investigación de reproducibilidad: sin cambio de producto.

## Veredicto

**La diferencia es real y nace en el rasterizado de la página, no en Tesseract
ni en el código entre commits.** El documento escaneado R2 da tres conteos
distintos según la plataforma, y cada plataforma es perfectamente determinista
consigo misma:

| plataforma | R2: ocurrencias / grupos | R1 (sin OCR) |
|---|---:|---:|
| Windows nativo | 227 / 76 | 308 / 123 |
| Linux (WSL) | 225 / 73 | 308 / 123 |
| macOS (M1, informe previo) | 223 / 72 | 308 / 123 |

Entre Windows y Linux quedó aislado el mecanismo, etapa por etapa:

1. **Los píxeles que Render entrega al OCR difieren** en las 40 imágenes de R2
   (20 de reconocimiento + 20 de orientación).
2. **Con píxeles idénticos, Tesseract devuelve lo mismo, byte a byte**:
   texto, cajas y confianzas. Probado en las dos direcciones, fijando en cada
   plataforma los PNG capturados en la otra.
3. **La diferencia de píxeles la produce la aceleración por GPU.** Windows
   rasteriza con canvas 2D por hardware; WSL, por software. Con
   `--disable-gpu`, Windows da **exactamente** los mismos píxeles y las mismas
   5.581 palabras que Linux en R2.
4. **Solo aparece cuando la imagen de página se reescala al rasterizar.** R2
   trae imágenes de 1656×2339 px (~200,3 dpi); el cap de DPI de ADR-163
   (`deriveOcrDpiCap`, `pdf.engine.ts`) redondea hacia arriba a 201 dpi y el
   ráster sale de 1662×2350 px: un reescalado de 0,36 %. Cuando el ráster cae
   1:1 con la imagen —P2 a 216 dpi, o un sintético a 300 dpi— Windows con GPU
   y Linux dan píxeles idénticos.

**macOS también quedó verificado** en la ampliación del 2026-09-26: GPU
produce un tercer raster en los sintéticos reescalados; software converge con
WSL, y Tesseract reproduce exactamente Windows/WSL cuando se fijan sus PNG.
En R2 se verificó GPU/software dentro de macOS; no se recibió el JSON de R2
de las otras plataformas para comparar sus hashes directamente.

**La premisa del pedido era incorrecta**, y se controló antes de todo lo
demás: la corrida de macOS (223) fue sobre `defa7a2` y la de Windows (227)
sobre `ee5eeba`, con 21 commits de producto en el medio (Grouping, `core`,
`shared`). Corrido en Windows sobre `defa7a2`, R2 da otra vez **227 / 76 / 83
alias / 182 miembros**, con el mismo `groupingFingerprint` que en `ee5eeba`.
Esos commits no explican la diferencia.

## Protocolo

**Instrumento**: `tests/perf/ocr-platform-probe.mjs`. Lanza el shell de
Electron empaquetado (build `VITE_E2E=1`), importa un PDF e intercepta en el
renderer cada job `ocr-page`/`ocr-orient` antes de que cruce al worker. De
cada imagen registra dimensiones, DPI, SHA-256 del PNG y SHA-256 de los
píxeles RGBA decodificados; de cada página, las palabras que dejó el OCR
reducidas a conteos y a SHA-256 de texto, cajas y confianzas. Registra
además el estado de GPU del proceso (`app.getGPUFeatureStatus()`).

- **Documento real**: solo salen hashes y conteos. La sonda se niega a
  guardar PNG o texto si el documento no se declara sintético.
- **Documento sintético**: puede guardar los PNG y **fijarlos** en otra
  corrida: reemplaza la imagen del job por la de referencia, así el OCR del
  producto corre sobre píxeles idénticos en las dos plataformas.
- **Flags de Chromium**: `ANONLY_OCR_PROBE_ELECTRON_ARGS` (por ejemplo,
  `--disable-gpu`). Es un switch del arnés, no del producto.

**Documentos sintéticos**: `tests/perf/ocr-platform-synthetic.mjs` genera
cuatro PDFs de 4 páginas A4 con texto rasterizado y binarizado, embebido como
una imagen por página: gris de 1 bit a 200 dpi (la forma de R2), gris de
8 bits a 200 dpi, RGB a 200 dpi y gris de 1 bit a 300 dpi. **Se generan una
sola vez** y el mismo archivo se usa en las dos plataformas. Regenerarlos en
otra plataforma cambia los píxeles de origen.

**Plataformas**: Windows desde el checkout nativo; Linux desde un worktree de
WSL en el mismo commit, con su propio `node_modules` y build. Cada corrida
usa una instancia nueva de Electron.

**Artefactos** (fuera de Git): `.measure/ocr-platform/20260925/`. Los
reportes de R2 no contienen texto ni imágenes, verificado.

## Resultados

### 1. Datos que ya estaban en disco

La campaña T-10 del 2026-09-19 había corrido R2 en Windows y en WSL sobre el
mismo commit (`bbb32b8`), tres rondas por plataforma, frío y caliente. Cada
plataforma repite exactamente sus conteos en las seis lecturas; entre
plataformas, R2 da **227/76 contra 225/73**. El conteo de palabras OCR
difiere en 12 de las 20 páginas, entre 1 y 4 palabras por página (**5.573
contra 5.581** en total). R1, sin OCR, da 308/123 en las dos.

### 2. P2: la diferencia anterior era del fixture, no del OCR

El fixture P2 se **genera** en cada plataforma, y sus bytes no coinciden
entre Windows y WSL. Pasado el **mismo archivo** a las dos, P2 da píxeles,
texto, cajas y confianzas idénticos: 50 páginas, 1.038 palabras. Su imagen se
rasteriza a 216 dpi, 1785×2526 px: exactamente su tamaño nativo.

### 3. R2 etapa por etapa (solo hashes)

| comparación | imágenes con píxeles distintos | páginas con texto distinto | palabras |
|---|---:|---:|---:|
| Windows (GPU) contra Windows (GPU), dos corridas | 0 / 40 | 0 / 20 | 5.573 = 5.573 |
| Windows (GPU) contra Linux | **40 / 40** | **19 / 20** | 5.573 contra 5.581 |
| Windows `--disable-gpu` contra Linux | **0 / 40** | **0 / 20** | 5.581 = 5.581 |

La única página sin diferencia de texto es la que no tiene palabras. En las
imágenes que difieren, Linux tiene ~1,4 % más píxeles oscuros.

### 4. Qué variable dispara la divergencia (sintéticos, Windows con GPU contra Linux)

| variante | ráster OCR | píxeles | salida OCR |
|---|---|---|---|
| gris 1 bit, 200 dpi | 201 dpi, 1661×2350 (reescalado) | distintos en 4/4 | cajas y confianzas distintas en 4/4 |
| gris 8 bits, 200 dpi | ídem | distintos en 4/4 | ídem |
| RGB, 200 dpi | ídem | distintos en 4/4 | ídem |
| gris 1 bit, 300 dpi | 300 dpi, 1:1 | **idénticos** | **idéntica** |

La profundidad de bits y el espacio de color no cambian nada: las tres
variantes de 200 dpi dan exactamente los mismos conteos de píxeles oscuros
por plataforma. Lo que decide es si el ráster reescala la imagen. En estos
sintéticos el texto resultó igual y difirieron cajas y confianzas; en R2,
con escaneo real, también difiere el texto.

### 5. Tesseract con píxeles fijados

Con el sintético de 1 bit a 200 dpi:

- Linux corriendo con los PNG de Windows fijados → idéntico a Windows en
  píxeles, texto, cajas y confianzas.
- Windows corriendo con los PNG de Linux fijados → idéntico a Linux.

Decodificación del PNG, detección de orientación y reconocimiento son
deterministas entre plataformas. Toda la diferencia entra antes.

### 6. El backend de raster

| corrida | `2d_canvas` | hash de píxeles, página 0 |
|---|---|---|
| Windows por defecto | `enabled` (hardware) | `7f4453d5…` |
| Linux (WSL) por defecto | `disabled_software` | `af37f856…` |
| Windows `--disable-gpu` | `unavailable_software` | `af37f856…` |
| Linux `--disable-gpu` | `disabled_software` | `af37f856…` |

**Brazo experimental** (parche local, revertido, no es un cambio propuesto):
crear el canvas de página de Render con `willReadFrequently: true`
(`render-engine/src/worker/kernel.ts`, hoy sin el flag; los canvas auxiliares
de pdf.js ya lo llevan). Con GPU activa, Windows **cambia** de resultado
pero **no converge** con el raster por software, ni en el sintético ni en R2.
El paso que depende de la GPU no es solo el canvas de página. Apagar la GPU
entera sí iguala las plataformas.

## Qué no se afirma

- La campaña original no midió macOS. La ampliación final verifica su
  divergencia de raster con GPU sobre el mismo corpus sintético y R2 local;
  no vuelve a medir las ocurrencias/grupos históricos de la tabla inicial.
- **No se identificó la operación exacta** de Skia, ANGLE o pdf.js que
  filtra distinto. Se probó qué la dispara (reescalado con GPU) y qué la
  elimina (raster por software o ráster 1:1).
- **No se afirma cuál resultado es "mejor".** Son dos resultados distintos
  del mismo documento, sin verdad de referencia en este banco.
- **WSL no representa a un Linux nativo con GPU.** Acá el canvas corre por
  software; un Linux nativo con aceleración podría comportarse como Windows,
  o no.
- **Otras GPU o drivers en Windows** podrían dar otros píxeles. Es plausible
  y no se midió: este banco tiene una sola GPU.
- El ráster 1:1 eliminó la divergencia en P2 y en el sintético de 300 dpi;
  **no se probó** forzar el 1:1 sobre R2.

## Consecuencias para las mediciones

1. **Los conteos, huellas y fingerprints de documentos escaneados no se
   comparan entre plataformas**, ni entre máquinas con distinta aceleración
   de canvas. Dentro de una misma plataforma y estado de GPU son
   deterministas y sí se comparan. Los documentos nativos (R1) no están
   afectados.
2. **Las comparaciones de tiempo entre plataformas siguen valiendo con esa
   salvedad**: el trabajo de OCR difiere en ~0,15 % de las palabras de R2.
3. **Un fixture generado por render** —como P2 (`getOrGenerateScannedFixture`)—
   difiere entre plataformas desde el origen. Para comparar plataformas hay
   que llevar el **mismo archivo**.
4. **`Agrupacion_Difusa_Medicion.md`** (Hallazgo 2 de la repetición
   Windows) comparaba commits distintos. Queda corregido y apunta a este
   informe.

## Para el planificador, sin decisión

Si hiciera falta que un escaneo dé el mismo resultado en todas las
plataformas, los datos de arriba acotan tres caminos. **Ninguno se
recomienda acá**, y cualquiera toca el contrato de Render/OCR o ADR-163, así
que requiere ADR antes de código (R-2, R-19):

- **Ráster 1:1 con la imagen nativa** cuando la página es un único escaneo:
  que el DPI elegido reproduzca el tamaño en píxeles de la imagen. Hoy
  ADR-163 §2 redondea con `ceil` a propósito, para que el redondeo nunca haga
  *downsample*, y su §3 declara `ocrDpiCap` como entero positivo del contrato
  público: un DPI no entero cambia ese contrato. Respaldado por P2 y el
  sintético de 300 dpi; no probado en R2.
- **Raster por software para las páginas que van a OCR.** `--disable-gpu`
  lo logra para toda la app, que es demasiado amplio. El flag
  `willReadFrequently` en el canvas de página **no alcanza** (brazo de §6).
- **Aceptarlo y documentarlo**: baselines de calidad por plataforma si algún
  gate llegara a usar documentos escaneados.

## Reproducir

```bash
# Una vez, en una sola plataforma: los PDF sintéticos
node tests/perf/ocr-platform-synthetic.mjs <dir>

# En cada plataforma, mismo commit, con el build VITE_E2E=1 de siempre
ANONLY_OCR_PROBE_DOC=<dir>/syn-1bpc-200dpi.pdf ANONLY_OCR_PROBE_ID=S1 \
  ANONLY_OCR_PROBE_SYNTHETIC=1 ANONLY_OCR_PROBE_SAVE_DIR=<pngs> \
  ANONLY_OCR_PROBE_OUT=<salida>.json node tests/perf/ocr-platform-probe.mjs

# Tesseract sobre los píxeles de la otra plataforma
ANONLY_OCR_PROBE_PIN_DIR=<pngs-de-la-otra> ...  (mismo comando)

# Raster por software
ANONLY_OCR_PROBE_ELECTRON_ARGS=--disable-gpu ...  (mismo comando)

# Documento real: solo hashes y conteos, sin SYNTHETIC, SAVE_DIR ni PIN_DIR
ANONLY_OCR_PROBE_DOC=/ruta/neutral/R2.pdf ANONLY_OCR_PROBE_ID=R2 \
  ANONLY_OCR_PROBE_OUT=<salida>.json node tests/perf/ocr-platform-probe.mjs
```

En WSL, además, `DISPLAY=:0` para que Electron abra ventana bajo WSLg.

## Ampliación macOS — protocolo previo (2026-09-26)

Autorizada por el humano mientras continúan las otras campañas en Windows.
Usar el instrumento existente y el mismo build macOS entre corridas, con una
instancia nueva por caso. Sobre R2 ejecutar **GPU→software→software→GPU**;
software significa únicamente `--disable-gpu` en el arnés. Comparar las 40
imágenes y las 20 páginas por índices, dimensiones, DPI, hashes y conteos,
incluyendo texto/cajas/confianzas reducidos a digestos. Un pipeline fallado,
páginas/jobs ausentes o claves duplicadas invalidan el caso. No guardar texto ni
PNG de R2; conservar los JSON crudos en una carpeta nueva bajo `.measure/`.
Registrar versiones de Electron/Chromium y estado GPU real antes de atribuir
el cambio al backend. Esta sonda intrusiva no mide rendimiento ni memoria.

La comparación entre plataformas y el ensayo de Tesseract con píxeles fijados
requieren los **PDF sintéticos originales y PNG/JSON de la campaña Windows/WSL**.
No están en Git ni en el checkout macOS al declarar este protocolo. Se pidieron
al humano; mientras no estén disponibles, el A/B de R2 puede cerrarse como
evidencia local, pero no completa la comparación causal con Windows/WSL.
Recibidos los artefactos, registrar hashes de los PDF sintéticos (permitidos),
medir sus cuatro variantes con GPU/software y fijar el sintético de 1 bit a
200 dpi con los PNG de ambas plataformas. Comparar contra la referencia,
declarando diferencias de versiones/builds si las hay. No regenerar los PDF
en macOS y presentarlos como el mismo corpus.


## Ampliación macOS — resultados (2026-09-26)

**Cerrada: 14 casos válidos, sin fallo ni suspensión.** MacBook Air M1,
8 GiB, arm64, Node 26.5.1, Electron 44.2.0, Chromium 152.0.7977.76.
Producto `bd6bd92`, sin cambios en `packages/` o `apps/`; el árbol contiene
solo documentación e instrumentos de medición. Electron/Chromium
coinciden con las referencias Windows/WSL `45d07fd`; el diff de PDF/Render/OCR,
core-adapter y lockfile entre esas revisiones está vacío. Los builds completos
no son idénticos entre plataformas; no se usa esta campaña para medir tiempo.

El humano aportó un ZIP de los cuatro PDF sintéticos originales, PNG y JSON
Windows/WSL. SHA-256 del ZIP y **68 entradas del manifiesto** verificadas antes
de usarlos. Los PDF no se regeneraron. Todos los artefactos quedan ignorados en
`.measure/ocr-platform/20260926-macos`; el contenido real no se guarda ni se
incluye en esta documentación.

### R2: GPU contra software, dos repeticiones por modo

Cada caso completó 40 jobs (20 OCR + 20 orientación) y las 20 páginas,
con las mismas dimensiones y DPI. `2d_canvas`/composición fue `enabled`
por defecto y `disabled_software` con `--disable-gpu`.

| comparación | imágenes PNG/RGBA distintas | páginas con texto distinto | cajas/confianzas distintas |
|---|---:|---:|---:|
| GPU contra GPU | 0/40 | 0/20 | 0/20 |
| software contra software | 0/40 | 0/20 | 0/20 |
| GPU contra software | **40/40** | **19/20** | **19/20** |

Ambos modos cuentan **5.581 palabras**, pero GPU suma **28.109 caracteres**
y software **28.119**. La página restante está vacía. Igualdad de conteos no
significa igualdad de salida. El raster de reconocimiento por software tiene
3.973.264 píxeles oscuros frente a 3.917.220 por GPU (**+1,43 %**).
No hay verdad de referencia para declarar uno más preciso.

### Mismos sintéticos que Windows/WSL

Cada caso sintético completó 8 jobs y 4 páginas, con 1.879 palabras.
Se ejecutaron las cuatro variantes con GPU y software, más dos corridas con
los PNG de Windows/WSL fijados.

| variante | macOS GPU contra Windows GPU y WSL | macOS software contra WSL |
|---|---|---|
| gris 1 bit, 200 dpi → 201 dpi | 8/8 raster distintos; texto igual; cajas/confianzas distintas en 4/4 | todo idéntico |
| gris 8 bits, 200 dpi → 201 dpi | 8/8 raster distintos; texto igual; cajas/confianzas distintas en 4/4 | todo idéntico |
| RGB, 200 dpi → 201 dpi | 8/8 raster distintos; texto igual; cajas/confianzas distintas en 4/4 | todo idéntico |
| gris 1 bit, 300 dpi, raster 1:1 | raster, texto, cajas y confianzas idénticos | todo idéntico |

Con el sintético de 1 bit/200 dpi y los PNG **fijados**, macOS reconoció
exactamente la salida de Windows y exactamente la de WSL, respectivamente:
8/8 jobs fijados en cada caso; cero diferencias de raster, texto, cajas y
confianzas. Esto amplía el aislamiento de la causa a macOS: la divergencia
entra al rasterizar con GPU y reescalar; no reaparece en Tesseract ante esos
mismos píxeles. El ensayo 1:1 sigue limitado a los sintéticos; no se forzó
sobre R2. No se identificó la operación concreta de Skia/ANGLE/pdf.js.

**Cierre del pendiente macOS de reproducibilidad:** completado sobre R2 local
y el mismo corpus sintético entre las tres plataformas. La comparación directa
de hashes de R2 macOS contra Windows/WSL queda sin efectuar porque el ZIP trae
solo referencias sintéticas. No hace falta otro documento real para el resultado
causal obtenido. No se cambia raster, DPI, aceleración ni defaults de producto;
una decisión futura conserva los requisitos de ADR de la sección anterior.
