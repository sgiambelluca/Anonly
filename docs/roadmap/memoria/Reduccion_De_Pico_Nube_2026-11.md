<!-- CONTEXT: scope=memoria-reduccion-de-pico | dependencias=adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,adr/ADR-218-El-Costo-De-RC-Se-Mide-Sin-Forzar-Todas-Las-Paginas.md,adr/ADR-225-El-Parseo-Suelta-Las-Imagenes-De-Cada-Pagina-Al-Leerla.md,adr/ADR-226-El-Modelo-De-NER-No-Espera-Cargado-Durante-El-OCR-Del-Documento-Siguiente.md,roadmap/rendimiento/Optimizacion_De_Rendimiento.md,roadmap/memoria/H-10_Bitacora_De_Memoria.md,roadmap/mediciones/transversal/Memoria_Final_Confianza_2026-10-11.md,tests/perf/README.md | audiencia=humanos+IA | fase=1.x -->

# Reducción del pico de memoria — campaña en la nube, 2026-11

> Pedido del mantenedor (2026-11-05): bajar el pico de memoria, cuidando que
> nada de lo que se decida choque con trabajar varios documentos a la vez en
> la 1.2. La campaña midió y propuso dos candidatos, cada uno con su ADR.
> **El humano aceptó los dos el 2026-11-05** y quedaron implementados en
> `perf/pico-memoria` (§6). Falta la medición con NER y el veredicto en
> Windows nativo (§7).

## 0. Resumen

- **En un escaneo, el pico no cae en el OCR: cae al final del parseo.** En P2
  sin NER, el árbol de procesos sube de ~684 a ~1629 MB durante los ~3 s del
  parseo, todo en el proceso del renderer (Tab), y baja al emitirse
  `DOCUMENT_PARSED`. Los 24 s de OCR pican menos (~1528 MB).
- **La causa es de pdf.js.** `parsePage` pide `getOperatorList()` de cada
  página. En una página escaneada, eso decodifica la imagen, que queda en
  `pageProxy.objs` hasta que se destruye el documento. `core/PDF_Engine.md`
  §13 caso 2 supone lo contrario, y es incorrecto.
- **C-1 (ADR-225): llamar a `pageProxy.cleanup()` al recibir el operator
  list.** A/B intercalado ABBA × 3:
  - el pico del parseo baja unos 620 MB;
  - el pico total baja ≈ 100 MB en frío y ≈ 160 MB en caliente, sin solaparse
    los rangos;
  - el tiempo no se mueve;
  - el texto de OCR y los grupos son idénticos;
  - en P1 (texto nativo) no hay efecto.
- **P2 caliente supera a frío por dos razones** (la primera medida, la
  segunda inferida).
  - Sin NER, medido: el documento anterior deja unos 90 MB y 4 workers vivos en
    el renderer, y el parseo se apila encima. C-1 casi anula esta parte: con
    C-1, caliente queda a 21 MB de frío.
  - Con NER, inferencia no medible en este banco: el modelo queda cargado (15 s, ADR-167)
    mientras corre el OCR del documento siguiente.
  - Las dos juntas son del orden de los ~630 MB medidos en Windows, cruzando
    mediciones de distintos equipos (§3.2).
- **C-2 (ADR-226): soltar el modelo de NER al empezar el OCR de un documento**,
  si está ocioso. Implementado; su A/B requiere el modelo de NER (§7).
- **Después de implementar C-1 y C-2 se midieron dos candidatos más** (§4.4 y
  §5):
  - **C-4 (ADR-227, Accepted con la opción 2: solo OCR y export)**: el render
    suelta las imágenes de cada página.
    A 144 dpi baja el pico unos 360 MB y la memoria después de `Ready` unos
    390 MB; a 216 dpi, entre 114 y 238 MB y entre 184 y 274 MB. Reabre un descarte de
    septiembre.
  - **C-3, descartado con medición**: dar de baja el worker de parseo da unos
    −20 MB en frío y nada en caliente, con los rangos solapados.
- **Lo que este banco no puede decir**: nada con NER prendido, y ningún
  veredicto contra los techos de ADR-192, que se juzgan en Windows nativo.

## 1. Banco y método

**Banco.** Contenedor Linux de la nube: x86_64, 4 CPU, 16 GB de RAM, kernel
6.18, Electron 44.2.0 empaquetado con el arnés de `tests/e2e/support/electronApp.ts`
sobre `xvfb`. No es el hardware de referencia de ADR-192 (Windows nativo):
**ningún número de este informe juzga un techo**. Sirven para comparar dos
brazos intercalados en el mismo banco y para ubicar en qué fase y en qué
proceso está el pico.

**Lo que este banco no tiene: el modelo de NER.** La red del contenedor
rechaza `huggingface.co` y `cdn.jsdelivr.net`. Los assets de Tesseract se
tomaron de los paquetes de npm y los de ONNX Runtime de `node_modules`, con el
sha256 idéntico al de `assets.lock.json` en los diez casos. El modelo de NER no
está en ningún espejo permitido, así que **todo lo medido acá es con NER
apagado** (`installSettingsOverride({ nerEnabled: false })`, el mismo canal de
«P2-attrib — NER apagado»). P1 y P2 llevan NER por definición (ADR-146 §4):
lo que depende de NER queda marcado como no medible en este banco.

**Otra diferencia con el banco de referencia.** El generador de fixtures
escaneados lanza un Chromium aparte (`scannedFixtureCache.ts`). El Playwright
del repo pedía la revisión 1228 del headless shell y el contenedor trae la
1243: se apuntó la ruta esperada a la instalada, fuera del repo. Solo afecta a
la generación del PDF escaneado, que ocurre antes de abrir el Electron medido.

**Instrumento.** `measureProfile` de `tests/perf/support/memoryProfile.ts`, sin
cambios: corrida fría → cierre por la UI → espera de la línea de base caliente
(ADR-146 §7bis) → corrida caliente, en la misma instancia. RSS por proceso
cada 150 ms (30 ms en P1). **Heap de JS por target vía CDP con GC forzado**
(ADR-159 §2): cada 1000 ms, `cdpHeap.ts` ejecuta `HeapProfiler.collectGarbage`
en cada target vivo antes de leer su heap (`snapshotHeapByTarget(forceGc = true)`,
el default del sampler periódico). Los **workers vivos** se cuentan como los
targets `worker` que CDP ve en esas mismas muestras, y los jobs concurrentes
por tipo salen de los eventos del pool. **El RSS es diagnóstico**:
el veredicto de retención es heap + workers (ADR-185). Una fase sin muestras
se declara no medible, no se inventa.

**A/B.** Cada brazo es un renderer construido aparte, con una transformación
del fuente en memoria verificada por coincidencia exacta (mismo método que
ADR-218). `packages/` y `apps/` no se modifican. La campaña de C-1 de este
informe, anterior a implementarlo, usó la primera versión del arnés
(`run-parse-cleanup.sh`, commit `36e92e3`): el brazo B **agregaba** el cleanup,
solo en el bundle del worker de parseo. Desde que C-1 y C-2 están implementados,
el arnés es `tests/perf/run-peak-ab.sh`, que arma los brazos `base`, `c1`, `c2`
y `head` **quitando** los cambios (`tests/perf/README.md`). El runner copia el brazo que toca a `apps/react-client/dist` antes de cada corrida, en
orden ABBA, y restaura el dist original al salir. Una instancia nueva de
Electron por corrida, seriales. Artefactos crudos en `.measure/c1-parse-cleanup/`,
fuera del repo.

**La identidad es más débil que la de ADR-218, y alcanza para un A/B
provisional.** El digest del `dist` de cada brazo se registra al construirlo,
pero no se vuelve a verificar en cada corrida. `apps/desktop-shell/dist` no se
congela, y el resumen no cruza el `exit=` del manifest. Las 24 corridas de esta
campaña terminaron con `exit=0` y escribieron su JSON, y la revisión comprobó
que el dist del producto quedó restaurado. Si el instrumento se reusa para
adoptar, hay que endurecerlo (`tests/perf/README.md`).

## 2. Desglose del pico

Producto actual (brazo A de las dos campañas): 6 corridas por perfil, cada
una con importación fría y caliente. MB decimales, medianas. NER apagado
(§1).

### 2.1 Por proceso, en la muestra del pico total

| Perfil | Browser | GPU | Utility | Tab | Total |
|---|---:|---:|---:|---:|---:|
| P1 frío | 209 | 167 | 90 | 259 | 647 |
| P1 caliente | 199 | 175 | 90 | 284 | 715 |
| P2 frío | 198 | 164 | 91 | **1176** | **1629** |
| P2 caliente | 201 | 170 | 91 | **1258** | **1716** |

Primera muestra de cada corrida (línea de base de la importación):

| Perfil | Tab | Total |
|---|---:|---:|
| P1 / P2 frío | 157 | 596 |
| P1 caliente | 247 | 704 |
| P2 caliente | 239 | 699 |

**Todo lo que crece está en el proceso Tab**: el renderer y sus workers, donde
corren pdf.js, Tesseract y Render. Browser, GPU y Utility no se mueven más de
unos 15 MB. El proceso de la GPU no explica nada del pico en este banco, que
usa SwiftShader, y no hay que extrapolarlo a Windows.

### 2.2 Por fase

| Perfil y fase | Duración | RSS al entrar | Pico en la fase | Jobs concurrentes |
|---|---:|---:|---:|---|
| P1 frío, parseo | 166 ms | 606 | 626 | 1 `pdf-parse` |
| P1 frío, detección → `Ready` | 132 ms | 628 | 647 | — |
| P1 caliente, parseo | 26 ms | 711 | 713 | 1 `pdf-parse` |
| P2 frío, **parseo** | 3140 ms | 684 | **1629** | 1 `pdf-parse` |
| P2 frío, OCR | 24 351 ms | 987 | 1528 | 2 `ocr-page`, 1 `ocr-orient`, 3 `render-page` |
| P2 caliente, **parseo** | 3025 ms | 758 | **1716** | 1 `pdf-parse` |
| P2 caliente, OCR | 23 024 ms | 1011 | 1551 | ídem |

Las fases posteriores al OCR duran milisegundos y no tienen muestras propias:
el instrumento las declara no medibles. Los jobs concurrentes son los de
`workerPeakByType` y cuentan trabajos en vuelo, no workers vivos (§2.3).

**El pico global de P2 cae al final del parseo en las 12 importaciones del
brazo A.** Es la causa que ataca C-1 (§4.1).

### 2.3 Heap de JS y workers vivos (CDP, ADR-159 y ADR-185)

- **Heap de JS con GC forzado** (usado + embebedor, todos los targets): máximo de 24–26 MB en
  P1 y de 27–29 MB en P2. **El pico no es heap de JS.** Lo que crece es memoria
  que CDP no ve como heap (búferes nativos, WASM, imágenes decodificadas):
  `memoryProfile` lo reporta como residuo no atribuido, unos 1120 MB al cerrar
  el parseo de P2 frío y unos 780 MB durante el OCR. Es una cota, no una
  medición (ADR-159 §7–§8).
- **Workers vivos** (targets `worker` vistos por CDP en cada muestra de heap):
  - P2 frío arranca sin workers según los eventos del pool; la primera muestra
    de CDP, a ~1,4 s y ya dentro del parseo, ve 1 (el de parseo);
  - P2 caliente arranca con **4**, que quedan vivos del documento anterior por
    el `idleDisposeMs` de 60 s (ADR-080);
  - los dos llegan a 10 durante el OCR y terminan con 4.
  - P1 tiene 4 desde la primera muestra de heap en las dos temperaturas,
    porque su pipeline es más corto que la cadencia del sampler.
  - El brazo B da los mismos conteos: C-1 no cambia cuántos workers hay.
- **RSS**: se usa como diagnóstico de dónde está el pico, como pide ADR-185. La
  retención entre documentos se lee en los workers vivos y en el heap; el heap
  crece unos 10 MB entre documentos (§3).

## 3. Por qué P2 caliente supera a P2 frío

En Windows, con NER, P2 caliente supera a frío en unos 630 MB de máximo
(2820 contra 2190, `Memoria_Final_Confianza_2026-10-11.md`). Ese exceso es el
que deja a P2 a 180 MB de su techo. Tiene dos partes.

### 3.1 Lo que deja el documento anterior — medido, sin NER

- La línea de base caliente es ~100 MB más alta que la fría: 699 contra 596
  en P2, y 704 contra 596 en P1, todo en el proceso Tab (239–247 contra
  157 MB).
- Coincide con los **4 workers que siguen vivos** después de cerrar el primer
  documento (§2.3), retenidos 60 s por `idleDisposeMs`. El heap de JS de todos
  los targets crece unos 10 MB (de ~7 a ~18 MB al cerrar el parseo de P2, usado más embebedor, el mismo
  criterio que §2.3), lejos
  de los ~100 MB: lo retenido es memoria que CDP no ve como heap. Lo probable
  es el runtime de esos workers (pdf.js, WASM); no se pudo atribuir por worker.
- **El parseo de P2 se apila encima**: el pico caliente es 1716 contra 1629
  frío (+87 MB de mediana), con el mismo patrón en las 6 corridas.
- Con C-1 el parseo deja de ser el pico, y la diferencia caliente − frío baja
  a **21 MB** (1553 contra 1532). En la fase de OCR, que pasa a ser el pico,
  caliente y frío ya estaban cerca en el brazo A (1551 contra 1528): durante el
  OCR los workers de Render están vivos en las dos temperaturas.

### 3.2 El modelo de NER durante el OCR — no medible en este banco

- **En frío**, el OCR termina y su pool se da de baja (ADR-157) antes de que la
  detección cargue NER: el pico es el mayor de los dos, no la suma.
- **En caliente**, el modelo del documento anterior sigue cargado 15 s
  (ADR-167). En este banco, la importación caliente de P2 arrancó unos 3 s
  después del `Ready` frío; un usuario que encadena expedientes tampoco espera
  15 s. **El OCR del documento nuevo corre con el modelo residente.**
- ADR-167 §1 midió que el modelo residente pesa unos 450 MB en el árbol (en la
  Mac). 450 + 90 ≈ 540 MB, del mismo orden que los ~630 MB de Windows. **Es una
  inferencia que cruza mediciones de distintos equipos**: la confirma o la
  refuta el A/B de C-2 (ADR-226 §5), que necesita el modelo.
- En P1 no pasa: no hay OCR con el que apilarse, y caliente pica menos que frío
  porque no paga la carga del modelo. Es lo que se ve en Windows.

## 4. Candidatos

Ningún candidato baja paralelismo (ADR-154 §1), ni toca el DPI, ni repite un
descartado de `Optimizacion_De_Rendimiento.md` o de la bitácora H-10.

### 4.1 C-1 — el parseo suelta las imágenes de cada página (ADR-225)

**Qué**: en `parsePage` (`pdf-engine/src/pdf.engine.ts`), llamar a
`pageProxy.cleanup()` apenas llega el operator list. El recorrido posterior no
usa `pageProxy.objs`.

**Por qué no repite el descarte de H-10 §5.2.** Aquel `cleanup()` era en el
kernel de Render, después de `render()`, en otra fase. Por qué no movió nada
entonces queda sin explicar del todo; C-4 (§4.4) reabrió ese descarte. Después de `getOperatorList()`
no hay limpieza automática, y `#pageCache` conserva cada página hasta
`destroy()` (pdfjs-dist 4.10.38, leído en el código).

**A/B** (`.measure/c1-parse-cleanup/p2-neroff-v1/` y `p1-neroff-v1/`), ABBA × 3,
NER apagado. MB, medianas; entre paréntesis, mínimo y máximo:

| | A | B | B − A por ronda |
|---|---:|---:|---:|
| P2 pico total, frío | 1629 (1599–1691) | 1532 (1503–1543) | −90 / −122 / −97 |
| P2 pico total, caliente | 1716 (1664–1726) | 1553 (1531–1570) | −147 / −161 / −163 |
| P2 pico del parseo, frío / caliente | 1629 / 1716 | 1014 / 1090 | — |
| P2 después de `Ready`, frío / caliente | 1169 / 1211 | 1156 / 1157 | — |
| P2 `import → Ready`, frío | 27,7 s | 27,3 s | −0,7 / −0,2 / −0,6 s |
| P2 `import → Ready`, caliente | 26,2 s | 26,4 s | −0,1 / +0,6 / −0,3 s |
| P1 pico total, frío / caliente | 647 / 715 | 643 / 713 | −1 a −5 |

- **Memoria**: el parseo baja ~620 MB. El pico total baja menos porque el pico
  pasa al OCR. Los rangos de A y B no se solapan.
- **Tiempo**: sin cambio más allá del ruido.
- **Calidad**: texto de OCR (hash de las palabras de las 50 páginas) idéntico en
  las 24 importaciones de P2, y los mismos grupos en P1 y P2. La salida del
  parseo nativo la cubren los tests del PDF Engine en la implementación.
- **Identidad de los builds**: un solo `pdf.engine.ts` transformado (sha256 del
  fuente `b6d7ebdb…`, transformado `c377a9a2…`). Solo difiere el chunk del
  worker de parseo, que en B contiene `getOperatorList()` seguido de
  `.cleanup()`. Digest del `dist` de cada brazo en `<carpeta>/{A,B}/dist.sha256`.
- **Requiere Windows nativo** para el veredicto contra ADR-192, y el modelo de
  NER para medir P1/P2 tal como los define ADR-146.

| Criterio de multidocumento | Cumple |
|---|---|
| 1. No cambia pico por retención | sí: la memoria después de `Ready` no sube |
| 2. Nada que suponga un solo documento | sí: actúa por página de cada `PDFDocumentProxy` |
| 3. Liberar al terminar cada etapa, no al cerrar | sí, más fino: por página, dentro del parseo |
| 4. Medido frío y caliente | sí |

### 4.2 C-2 — el modelo de NER no espera cargado durante el OCR (ADR-226)

**Qué**: al empezar `runOcrStage`, si el pool de NER está ocioso, darle de baja
los workers, con la misma guarda de ADR-157 §1ter. La recarga cae en la
detección, cuando el pool de OCR ya se dio de baja, como en frío.

**Por qué no repite ADR-166.** ADR-166 soltaba el modelo al terminar la
detección, y la recarga se apilaba sobre todo el documento siguiente, incluido
uno sin OCR (ADR-167 §2). C-2 solo actúa si el documento nuevo hace OCR, y la
recarga cae después del OCR.

**A/B**: no medible en este banco, porque no está el modelo de NER. ADR-226 §5
fija el protocolo: ABBA × 3 sobre P1 y P2 de `memory.spec.ts`, frío y
caliente. **Requiere el modelo de NER** (habilitar `huggingface.co` en el
entorno, o la máquina del mantenedor) **y Windows nativo** para el veredicto.

- **Costo esperado**: unos 1–2 s de recarga del modelo en el segundo documento
  escaneado (ADR-167 §4). Calidad: ninguna, por construcción.
- **Contrato**: necesita volver a exponer una baja de NER, que ADR-167 §1 había
  quitado por no tener llamador. Va con su cambio de `Contracts.md` y de
  `NER_Engine.md` antes del código.

| Criterio de multidocumento | Cumple |
|---|---|
| 1. No cambia pico por retención | sí: baja retención |
| 2. Nada que suponga un solo documento | sí: actúa sobre el pool compartido del Core |
| 3. Liberar al terminar cada etapa, no al cerrar | sí: se dispara al empezar la etapa de OCR del documento que llega |
| 4. Medido frío y caliente | pendiente: el protocolo lo exige |

### 4.3 Cómo se combinan

C-1 y C-2 atacan los dos sumandos de §3. Con NER prendido, en caliente el
modelo residente se suma tanto al parseo como al OCR del documento siguiente.
Lo esperable es que C-1 pese más con NER que sin él, y que C-2 baje el pico del
OCR caliente. **Las dos cosas son predicciones**, y el A/B con NER las mide por
separado y juntas.

### 4.4 C-4 — el render suelta las imágenes de la página (ADR-227, Accepted, opción 2)

Medido el 2026-11-05 a pedido del humano, después de implementar C-1 y C-2.

**Qué**: `pageProxy.cleanup()` al terminar de dibujar una página en el kernel
de Render. Después de `render()`, pdf.js 4.10.38 solo programa una limpieza, con
5 s de retardo y cancelable si la página se vuelve a dibujar, y solo para las
páginas con imágenes de más de 10e6 bytes. Las más chicas quedan hasta cerrar
el documento.

**Reabre un descarte**: H-10 §5.2 y ADR-154 §2. ADR-227 §2 explica qué midió
distinto esta campaña (sin NER, con imágenes a los dos lados del umbral) y qué
queda sin explicar.

**A/B** (`.measure/peak-ab/c4-neroff-head-c4/`): `head` contra `c4`, ABBA × 3,
sin NER, P2 a 144 dpi (perfil nuevo `P2-144dpi-ner-off`, imágenes de ~7,8 MB) y
a 216 dpi (P2 de siempre, ~17 MB). Medianas, y entre paréntesis mínimo y máximo:

| | `head` | `c4` | por ronda |
|---|---:|---:|---:|
| 144 dpi, pico frío / caliente | 1423 / 1423 | 1062 / 1052 | −345 a −379 |
| 144 dpi, después de `Ready` | 1139 / 1149 | 751 / 744 | — |
| 216 dpi, pico frío / caliente | 1487 / 1474 | 1268 / 1298 | −114 a −238 |
| 216 dpi, después de `Ready` | 1081 / 1128 | 897 / 854 | — |
| `import → Ready`, 144 dpi | 20,6 / 20,1 s | 20,4 / 20,1 s | −0,6 a +0,4 s |
| `import → Ready`, 216 dpi | 26,5 / 25,3 s | 27,0 / 26,2 s | +0,3 a +1,1 s |

- Los rangos no se solapan. El texto de OCR y los grupos son idénticos.
- Es el candidato con más efecto de la campaña. También es el que más baja la
  memoria después de `Ready`, la que cuenta por pestaña en la 1.2.
- Una corrida de 24 falló al arrancar la app, antes de importar (ADR-227).
- **Alcance a decidir** (ADR-227): limpiar en todos los renders, que es lo
  medido, o solo en el OCR y el export, que es la recomendación y necesita su
  propio A/B, porque en el preview un zoom volvería a decodificar la imagen.

**Opción 2 medida y aceptada (2026-11-05)** (`.measure/peak-ab/c4r-neroff-head-c4r/`,
12/12 válidas): cleanup solo en `kernelRasterizePage` y en `kernelRenderPage` con
`mode: "full"`. Conserva la ganancia: a 144 dpi, −328 a −383 MB de pico y 1155 →
786 MB después de `Ready`; a 216 dpi, −178 a −232 MB y 1080 → 920 MB. Texto de
OCR y grupos idénticos. A 216 dpi, ~1,1 s más de mediana sobre ~26 s (+0,5 a
+2,7 s por ronda). El humano la había aceptado condicionada a que se confirmara;
detalle en ADR-227.

| Criterio de multidocumento | Cumple |
|---|---|
| 1. No cambia pico por retención | sí: la retención después de `Ready` baja entre 184 y 405 MB |
| 2. Nada que suponga un solo documento | sí: por página de cada documento en cada worker |
| 3. Liberar al terminar cada etapa, no al cerrar | sí: por página, al terminar de dibujarla |
| 4. Medido frío y caliente | sí |

## 5. Lo que no entra como candidato, y por qué

| Idea | Por qué no |
|---|---|
| C-3: dar de baja el pool de `pdf-parse` al terminar el parseo | **descartado con medición** (2026-11-05, `.measure/peak-ab/c3-neroff-head-c3/`): `head` contra `c3`, ABBA × 3, sin NER. P2: −27 a +2 MB, con los rangos solapados (frío 1488–1521 contra 1455–1506). P1: −3 a +10 MB, sin costo de tiempo. Ese worker no es el que pesa en el OCR |
| Bajar `ocrPoolSize`, `renderPoolSize`, hilos de ONNX o reconocedores | ADR-154 §1: la memoria no se compra bajando paralelismo |
| Bajar el DPI del OCR | cambia la calidad del reconocimiento; ADR-154 §2 lever 6 lo deja al humano con la línea de base de ADR-147 |
| `pageProxy.cleanup()` en el kernel de Render | descartado en septiembre (H-10 §5.2, ADR-154 §2), **reabierto por C-4** (§4.4, ADR-227): sin NER el efecto sí aparece, a 144 dpi (imágenes que pdf.js no limpia nunca) y a 216 dpi (que limpia con 5 s de retardo) |
| Adelantar la carga de NER durante el OCR | descartado con medición (`Optimizacion_De_Rendimiento.md`, «Descartado con medición») |
| Soltar NER al terminar la detección | ADR-166, retirado por ADR-167: la recarga se apilaba sobre el documento siguiente. C-2 es otro disparador (§4) |
| Los workers de Render que siguen vivos del documento anterior | en caliente se ven 3 `render-page` vivos ya durante el parseo (en frío, 0). Sin atribución por worker, porque su heap de JS es de pocos MB y el resto no se observa por CDP. Además, sirven al preview del documento abierto: soltarlos al cerrar choca con el criterio 3 (con pestañas, el documento no se cierra). Queda como observación, no como candidato |
| El resto del pico de la fase de OCR | con C-1, pasa a ser el pico de P2 sin NER. Una parte eran las imágenes que retienen los workers de Render (C-4, §4.4). Lo que queda es memoria no atribuida al heap (WASM de Tesseract: 2 reconocedores más el OSD compartido), que solo baja con menos reconocedores (ADR-154) o menos píxeles (DPI) |

## 6. Implementación y validación (2026-11-05)

El humano aceptó ADR-225 y ADR-226 el 2026-11-05. Están implementados en
`perf/pico-memoria`, un commit por módulo, con los tests de §14 de cada spec
y el revisor en APPROVED:

| Commit | Módulo | Qué |
|---|---|---|
| `e2e7634` | docs | ADR aceptados; PDF Engine v1.21.0, NER Engine v1.13.0, Orchestrator v1.16.0 |
| `e8f7443` | tests | `cleanup` en los dobles de `PDFPageProxy` de integración y cancelación |
| `9ead600` | pdf-engine | C-1: `pageProxy.cleanup()` al recibir el operator list |
| `7c8a571` | ner-engine | C-2: `NerEngine.releaseIdleWorkers()` con guarda de trabajo en curso |
| `f5ac19a` | façade | C-2: `runOcrStage` da de baja el pool ocioso de NER antes del OCR |
| `a849279` | ner-engine | el test de contrato exige el puerto con el compilador (rechazo de la primera revisión) |

El caso 2 de §13 de `core/PDF_Engine.md` quedó corregido con la v1.21.0.

**Validación sobre el código implementado**: `run-peak-ab.sh`, brazo `base`
(sin ninguno de los dos cambios) contra `head` (el producto), ABBA × 3, P2 sin
NER, mismo banco (`.measure/peak-ab/impl-p2-neroff-base-head/`). Cada build
transformó `pdf.engine.ts` en los dos bundles y `orchestrator.ts` en el
principal. Con NER apagado, C-2 no tiene modelo que soltar: esta tanda mide C-1
tal como quedó implementado. MB, medianas, y entre paréntesis mínimo y máximo:

| | `base` | `head` | `head` − `base` por ronda |
|---|---:|---:|---:|
| Pico total, frío | 1588 (1565–1652) | 1492 (1474–1506) | −90 / −110 / −110 |
| Pico total, caliente | 1666 (1630–1714) | 1479 (1459–1524) | −169 / −163 / −221 |
| Pico del parseo, frío / caliente | 1588 / 1666 | 932 / 1025 | — |
| Después de `Ready`, frío / caliente | 1063 / 1109 | 1093 / 1117 | — |
| `import → Ready`, frío | 26,5 s | 26,1 s | −1,0 / +0,0 / −0,0 s |
| `import → Ready`, caliente | 26,0 s | 25,8 s | −0,3 / −0,3 / −0,3 s |

- **Reproduce la campaña previa a implementar** (§4.1): los rangos no se
  solapan y las tres rondas van en el mismo sentido.
- **El texto de OCR y los grupos son idénticos** en las 24 importaciones.
- **La memoria después de `Ready` no muestra un cambio consistente**: +30 MB
  en frío y +8 en caliente acá, −13 y −54 en la campaña de §4.1. Es ruido entre
  corridas, no retención nueva (criterio 1).

## 7. Qué falta y quién lo hace

| Qué | Quién | Necesita |
|---|---|---|
| A/B con NER prendido: `base` contra `head`, y `base` contra `c2` para aislar C-2 | el mantenedor, en Windows (o este banco si se permite `*.hf.co`) | el modelo de NER |
| Veredicto contra los techos de ADR-192 (M2 de P1 y P2, tres corridas frías y tres calientes) | el mantenedor | Windows nativo (ADR-192 §4) |
| Decidir si el costo de tiempo de C-2 es aceptable (recarga del modelo en el segundo escaneo) | el humano | el A/B con NER |
| ~~Decidir C-4 (ADR-227) y su alcance~~: aceptado con la opción 2 (solo OCR y export) el 2026-11-05 | — | — |
| **Pendiente a futuro, en Windows**: hilos de NER en los perfiles Alto y Ultra (subirlos, nunca bajarlos). En septiembre, 6 hilos bajaron un 30 % el tiempo de NER en R1 en el Windows del mantenedor y empeoraron en la Mac (`mediciones/ner/Hilos_NER_Medicion.md`); ADR-194 dejó los hilos en automático | el mantenedor, con el arnés portado a Windows | `tests/perf/run-ner-threads.sh` solo corre en macOS y el puerto de septiembre no se commiteó: hay que portarlo. Este banco no sirve (4 CPU y sin el modelo de NER) |
| **Pendiente a futuro, en Windows**: repetir el empaquetado del modelo de NER con datos externos (ADR-179) con R1. En septiembre bajó la memoria WASM de NER sin superar el ruido del RSS | el mantenedor | el modelo de NER (o `*.hf.co` permitido en este banco) |
| Validar C-1, C-2 y C-4 con los documentos reales R1 y R2 antes de mergear a `develop` | el mantenedor, en Windows | `ANONLY_REAL_DOC_*`; los fixtures sintéticos subestiman el trabajo por página |
| **Pendiente a futuro**: casos peores con fixtures realistas. Fixtures sintéticos con densidad de palabras por hoja parecida a la de un documento real (unas 300 palabras por página contra 20 en P2, `mediciones/transversal/Ciclos_Y_Documentos_Reales_Medicion.md` §2.1), y PDFs pesados (ADR-180) para medir C-4 en el render completo y el export | el planificador, cuando el mantenedor consiga documentos reales o se acuerde la densidad | decisión del mantenedor sobre la densidad objetivo |

**Por qué este banco no midió con NER.** `huggingface.co` quedó permitido, y
bajaron los cinco archivos chicos del modelo con su sha256. El ONNX de 178 MB
redirige a un CDN (`us.aws.cdn.hf.co`) que la política de red del entorno sigue
rechazando. Con `*.hf.co` permitido, el mismo A/B corre en este banco.

### 7.1 Cómo probarlo en Windows

Desde Git Bash, en la raíz del repo, con la máquina sin otra carga y sin que
entre en suspensión:

```bash
git fetch origin perf/pico-memoria && git checkout perf/pico-memoria && git pull
pnpm install
pnpm assets:mirror
pnpm exec cross-env VITE_E2E=1 pnpm --filter @anonly/react-client build
pnpm --filter @anonly/desktop-shell build
```

1. **Los dos cambios contra ninguno, con NER** (12 corridas de P1 y P2, frío y
   caliente):

   ```bash
   ANONLY_AB_GREP="P1 —|P2 —" tests/perf/run-peak-ab.sh
   ```

2. **C-2 solo**, para ver cuánto aporta y cuánto tiempo cuesta:

   ```bash
   ANONLY_AB_CANDIDATE=c2 tests/perf/run-peak-ab.sh
   ```

3. **Resumen de cada carpeta** que imprimen los dos comandos:

   ```bash
   pnpm exec tsx tests/perf/support/summarizePeakArmsCli.ts .measure/peak-ab/<carpeta> base head
   pnpm exec tsx tests/perf/support/summarizePeakArmsCli.ts .measure/peak-ab/<carpeta> base c2
   ```

4. **Techos de ADR-192** sobre el producto (`head`), con el dist recién
   construido:

   ```bash
   pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/memory.spec.ts --repeat-each=3 --grep "P1 —|P2 —" --workers=1 --retries=0
   ```

**Qué mirar**: que el pico caliente de P2 baje más que el ruido (~345 MB entre
tandas, ADR-146 §7) en las tres rondas; que P1 no se mueva; cuánto sube
`import → Ready` caliente de P2 con C-2; y que P1 y P2 queden debajo de 2,0 y
3,0 GB en el paso 4. Los `.measure/` no se commitean: compartí los
`summary.json` o los números.

## 8. Cómo repetirlo

```bash
# Desglose sin NER: P2 salió de «P2-attrib — NER apagado»; P1 de memory-ner-off.spec.ts
pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/memory-attribution.spec.ts --grep "NER apagado" --workers=1 --retries=0
ANONLY_MEMORY_NER_OFF=1 pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/memory-ner-off.spec.ts --grep "P1-ner-off" --workers=1 --retries=0
# A/B con el arnés actual: sin ninguno de los dos cambios contra el producto
ANONLY_AB_GREP="P1 —|P2 —" tests/perf/run-peak-ab.sh
# Solo C-1 sobre P2 sin NER (equivalente a la campaña de este informe)
ANONLY_AB_CANDIDATE=c1 ANONLY_AB_SPEC=tests/perf/memory-attribution.spec.ts ANONLY_AB_GREP="NER apagado" tests/perf/run-peak-ab.sh
# Resumen de una campaña
pnpm exec tsx tests/perf/support/summarizePeakArmsCli.ts .measure/peak-ab/<carpeta> base head
```

En Linux sin pantalla, `run-peak-ab.sh` usa `xvfb-run` solo.
