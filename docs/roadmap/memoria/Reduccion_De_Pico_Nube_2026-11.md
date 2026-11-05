<!-- CONTEXT: scope=memoria-reduccion-de-pico | dependencias=adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,adr/ADR-218-El-Costo-De-RC-Se-Mide-Sin-Forzar-Todas-Las-Paginas.md,adr/ADR-225-El-Parseo-Suelta-Las-Imagenes-De-Cada-Pagina-Al-Leerla.md,adr/ADR-226-El-Modelo-De-NER-No-Espera-Cargado-Durante-El-OCR-Del-Documento-Siguiente.md,roadmap/rendimiento/Optimizacion_De_Rendimiento.md,roadmap/memoria/H-10_Bitacora_De_Memoria.md,roadmap/mediciones/transversal/Memoria_Final_Confianza_2026-10-11.md,tests/perf/README.md | audiencia=humanos+IA | fase=1.x -->

# Reducción del pico de memoria — campaña en la nube, 2026-11

> Pedido del mantenedor (2026-11-05): bajar el pico de memoria, cuidando que
> nada de lo que se decida choque con trabajar varios documentos a la vez en
> la 1.2. Esta campaña **mide y propone**; no cambia el producto. Cada
> candidato tiene su ADR en estado Proposed y lo decide el humano.

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
- **P2 caliente supera a frío por dos razones.**
  - Sin NER, medido: el documento anterior deja unos 90 MB y 4 workers vivos en
    el renderer, y el parseo se apila encima. C-1 casi anula esta parte: con
    C-1, caliente queda a 21 MB de frío.
  - Con NER, no medible en este banco: el modelo queda cargado (15 s, ADR-167)
    mientras corre el OCR del documento siguiente.
  - Las dos juntas son del orden de los ~630 MB medidos en Windows.
- **C-2 (ADR-226): soltar el modelo de NER al empezar el OCR de un documento**,
  si está ocioso. Sin A/B: requiere el modelo de NER.
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
cada 150 ms (30 ms en P1), heap de JS por target vía CDP (ADR-159), conteo de
workers vivos por tipo desde los eventos del pool. **El RSS es diagnóstico**:
el veredicto de retención es heap + workers (ADR-185). Una fase sin muestras
se declara no medible, no se inventa.

**A/B.** Cada brazo es un renderer construido aparte con
`tests/perf/support/parseCleanupBuildCli.ts`, que aplica la transformación de
`parseCleanupTransform.ts` al fuente en memoria **solo** dentro del bundle del
worker de parseo, con una coincidencia exacta verificada (mismo método que
ADR-218). `packages/` y `apps/` no se modifican. `tests/perf/run-parse-cleanup.sh`
copia el brazo que toca a `apps/react-client/dist` antes de cada corrida, en
orden ABBA, y restaura el dist original al salir. Una instancia nueva de
Electron por corrida, seriales. Artefactos crudos en `.measure/c1-parse-cleanup/`,
fuera del repo.

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

- **Heap de JS** (usado + embebedor, todos los targets): máximo de 24–26 MB en
  P1 y de 27–29 MB en P2. **El pico no es heap de JS.** Lo que crece es memoria
  que CDP no ve como heap (búferes nativos, WASM, imágenes decodificadas):
  `memoryProfile` lo reporta como residuo no atribuido, unos 1120 MB al cerrar
  el parseo de P2 frío y unos 780 MB durante el OCR. Es una cota, no una
  medición (ADR-159 §7–§8).
- **Workers vivos** (targets `worker` vistos por CDP en cada muestra de heap):
  - P2 frío arranca con 0 workers;
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
  los targets crece unos 10 MB (de ~6 a ~16 MB al cerrar el parseo de P2), lejos
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
kernel de Render, después de `render()`, donde pdf.js ya limpia solo las
imágenes grandes (`_maybeCleanupAfterRender`). Después de `getOperatorList()`
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

## 5. Lo que no entra como candidato, y por qué

| Idea | Por qué no |
|---|---|
| Bajar `ocrPoolSize`, `renderPoolSize`, hilos de ONNX o reconocedores | ADR-154 §1: la memoria no se compra bajando paralelismo |
| Bajar el DPI del OCR | cambia la calidad del reconocimiento; ADR-154 §2 lever 6 lo deja al humano con la línea de base de ADR-147 |
| `pageProxy.cleanup()` en el kernel de Render | descartado con medición (H-10 §5.2, ADR-154 §2). C-1 explica por qué no movía nada: después de `render()` pdf.js ya limpia solo |
| Adelantar la carga de NER durante el OCR | descartado con medición (`Optimizacion_De_Rendimiento.md`, «Descartado con medición») |
| Soltar NER al terminar la detección | ADR-166, retirado por ADR-167: la recarga se apilaba sobre el documento siguiente. C-2 es otro disparador (§4) |
| Los workers de Render que siguen vivos del documento anterior | en caliente se ven 3 `render-page` vivos ya durante el parseo (en frío, 0). Sin atribución por worker, porque su heap de JS es de pocos MB y el resto no se observa por CDP. Además, sirven al preview del documento abierto: soltarlos al cerrar choca con el criterio 3 (con pestañas, el documento no se cierra). Queda como observación, no como candidato |
| El pico de la fase de OCR | con C-1, pasa a ser el pico de P2 sin NER. Lo domina memoria no atribuida al heap (WASM de Tesseract: 2 reconocedores más el OSD compartido), que solo baja con menos reconocedores (ADR-154) o menos píxeles (DPI). No hay candidato que no toque una de las dos |

## 6. Qué falta y quién lo hace

| Qué | Quién | Necesita |
|---|---|---|
| Decidir si C-1 y C-2 siguen a implementación | el humano | este informe, ADR-225 y ADR-226 |
| A/B de C-1 con NER prendido, P1/P2/P2-dense de `memory.spec.ts` | campaña siguiente | el modelo de NER: `huggingface.co` permitido en el entorno, o la máquina del mantenedor |
| A/B de C-2 | campaña siguiente | ídem |
| Veredicto contra los techos de ADR-192 | el mantenedor | Windows nativo (ADR-192 §4) |
| Corregir `core/PDF_Engine.md` §13 caso 2 («pdfjs descarta páginas procesadas») | el planificador, con ADR-225 si se acepta | — |

**Hallazgo de spec, para el planificador.** `core/PDF_Engine.md` §13 caso 2
dice: «Memoria pico gestionada por LRU del `PDFDocumentProxy` (pdfjs descarta
páginas procesadas)». En pdfjs-dist 4.10.38, `#pageCache` solo se vacía en
`destroy()` y las imágenes del operator list quedan en `pageProxy.objs`. No se
editó el spec en esta campaña: el cambio va con ADR-225, si se acepta (R-19).

## 7. Cómo repetirlo

```bash
# Desglose sin NER, P1 y P2 (opt-in)
ANONLY_MEMORY_NER_OFF=1 pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/memory-ner-off.spec.ts --workers=1 --retries=0
# A/B de C-1 (ABBA × 3) sobre P2 sin NER
ANONLY_C1_ROUNDS=3 tests/perf/run-parse-cleanup.sh
# Lo mismo sobre P1 sin NER
ANONLY_C1_SPEC=tests/perf/memory-ner-off.spec.ts ANONLY_C1_GREP="P1-ner-off" ANONLY_MEMORY_NER_OFF=1 tests/perf/run-parse-cleanup.sh
# Resumen de una campaña
pnpm exec tsx tests/perf/support/summarizeParseCleanupCli.ts .measure/c1-parse-cleanup/<carpeta>
```

En Linux sin pantalla, `run-parse-cleanup.sh` usa `xvfb-run` solo. Para
correrlo con NER, en `memory.spec.ts`: `ANONLY_C1_SPEC=tests/perf/memory.spec.ts
ANONLY_C1_GREP="P1 —|P2 —"`.
