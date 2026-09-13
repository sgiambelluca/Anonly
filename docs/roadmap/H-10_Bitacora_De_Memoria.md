<!-- CONTEXT: scope=roadmap-bitacora | dependencias=architecture/07_Performance_Strategy.md,00_Project_Vision.md,adr/ADR-143-Las-Imagenes-De-OCR-Se-Producen-Cuando-Hay-Lugar.md,adr/ADR-145-El-Deposito-No-Expulsa-Lo-Que-Acaba-De-Guardar.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-155-El-Arnes-De-Medicion-Configura-El-Core-Por-Un-Canal-Propio.md,adr/ADR-156-El-Preview-No-Guarda-Los-Pixeles-Que-Nadie-Lee.md,adr/ADR-157-El-Pool-De-OCR-Se-Da-De-Baja-Al-Terminar-Su-Etapa.md,adr/ADR-158-El-Raster-De-OCR-Viaja-Codificado.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-160-El-Worker-De-OCR-No-Decodifica-La-Pagina.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md,roadmap/Optimizacion_De_Memoria_Plan.md | audiencia=humanos+IA | fase=11 -->

# H-10 — Bitácora de memoria: qué se intentó, qué midió y qué se decidió

> **Por qué existe este documento.** La campaña de memoria produjo más conocimiento en mediciones y descartes que en código. Los ADR guardan las decisiones que se tomaron; esto guarda **lo que se midió para tomarlas, y lo que se descartó** — que es lo que evita repetir un intento que ya falló y lo que permite retomar sin reconstruir el razonamiento.
>
> **No cierra el trabajo de recursos.** Es el registro al momento de pausarlo, con lo que queda abierto declarado al final.
>
> **Reanudado el 2026-09-11.** Dos correcciones sobre este documento, las dos sin corridas nuevas: ADR-159 (el estadístico de §7 y el reparto Tab/GPU) y ADR-160 (el mecanismo que la objeción de §7 pedía). El plan vivo es `roadmap/Optimizacion_De_Memoria_Plan.md`; **las secciones de abajo quedan como registro histórico, con sus correcciones marcadas en línea.**
>
> **Actualizado el 2026-09-13.** El perfil de 200 páginas de T-3 ya se ejecutó.
> No reprodujo la extrapolación lineal de ADR-159 §5, pero tampoco dio una meseta
> tardía consistente: T-3 cierra **inconclusa** entre esas dos formas, con la
> extrapolación lineal descartada. Datos en §8.
>
> **T-4 cerrada, 2026-09-13.** La variante calibrada de ADR-161 no estaba
> lista: faltaban dos umbrales, el margen numérico y el corpus positivo. ADR-162
> separa una compuerta exacta —solo se saltea una franja visualmente blanca— y
> deja la heurística para fondos ruidosos como T-4b bloqueada. La compuerta
> exacta quedó implementada y verificada con 137/137 tests scoped, typecheck y
> ESLint verdes. El detalle vive en `core/OCR_Engine.md` v1.13.0 y en el plan
> vivo §T-4.

**Perfil de referencia en todo el documento**: P2 — 50 páginas escaneadas, OCR + NER reales, sobre el shell de Electron empaquetado. darwin/arm64, 8 CPUs, 8,6 GB de RAM. Salvo aclaración, los números son de corridas **calientes** (modelos ya cargados).

**Las dos métricas** (ADR-146 §1): **M2** = pico de la suma de RSS de todos los procesos, lectura directa. **M1** = M2 menos la línea de base con modelos cargados y sin documento — **cota inferior**, no medida de demanda (ADR-146 §7).

---

## 1. Estado al pausar

| | valor |
|---|---|
| Pico M2 | **1694 – 1790 MB** |
| Presupuesto de `07_Performance_Strategy.md` §7 | ~1600 MB |
| Exceso | **94 – 190 MB (6-12 %)** |
| Punto de partida de la campaña | 1918 – 2355 MB |
| Perfil de recursos bajos (pools en 1) | **355 MB de M1** — holgado |

> **Esta tabla es el estado al PAUSAR (2026-09-11), no el actual.** Después se
> tomó ADR-160, que bajó el pico de la etapa de OCR en **−234 MB de promedio**
> (Tab + GPU), medido con un control A/B de 6 corridas alternadas (§3.6). El M2
> con el cambio da **1588 / 1628 / 1300 MB** contra los ~1600 del presupuesto:
> **mejora clara, cierre no** — una de tres sigue por encima.

---

## 2. Resumen

| # | Cambio | Decisión |
|---|---|---|
| 1 | Imágenes de OCR bajo demanda (ADR-143) | **Tomado** |
| 2 | Bytes reales en la LRU de palabras (ADR-145) | **Tomado** |
| 3 | Caché de preview sin píxeles crudos (ADR-156) | **Tomado** |
| 4 | Baja del pool de OCR al terminar su etapa (ADR-157) | **Tomado** |
| 5 | Ráster de OCR codificado (ADR-158) | **Tomado** |
| 6 | Bajar `renderPoolSize` | **Descartado** — efecto bajo el ruido |
| 7 | `pageProxy.cleanup()` en el camino de OCR | **Descartado** — sin efecto, con motivo en el código |
| 8 | Escala de grises para OCR | **Descartado sin implementar** — imposible |
| 9 | Bajar `nerPoolSize` | **Descartado sin implementar** — no cuesta nada hoy |
| 10 | Bajar paralelismo en general | **Prohibido** por decisión del humano (ADR-154 §1) |
| 11 | Bajar el DPI | **Disponible, no usado** — costo de calidad |
| 12 | El worker de OCR no decodifica la página (ADR-160) | **Tomado y medido** — el de mayor efecto sobre el pico (§3.6) |
| 13 | Saltear franjas visualmente blancas (ADR-162) | **Tomado e implementado** — elimina 0/2/4 pasadas de margen; magnitud P2 pendiente |

---

## 3. Los cambios, uno por uno

### 3.1 Imágenes de OCR bajo demanda — ADR-143

**Cambio propuesto**: `runOcrStage` rasterizaba **todo** el documento antes de llamar a OCR. Pasa a producir cada imagen bajo demanda, con tantos consumidores como `ocrPoolSize`.

**Antes**: 50 páginas A4 a 300 dpi = 50 × 34,8 MB = **~1,74 GB** de `ImageData` vivos antes de que Tesseract leyera la primera página. (Aritmética, no medición: el instrumento no existía todavía.)

**Después**: como mucho `C = min(ocrPoolSize, páginas)` imágenes vivas — **2** con los defaults.

**Decisión: tomado.** Es la corrección de mayor magnitud de toda la campaña, y la única que se decidió sin instrumento: la aritmética no dejaba lugar a dudas.

### 3.2 Bytes reales en la LRU de palabras — ADR-145

**Cambio propuesto**: OCR depositaba las palabras con `cache.set(key, words)` sin tercer argumento, y la caché interpreta `bytes` ausente como cero.

**Antes**: esas entradas contaban contra el límite de 32 items y **cero** contra el de 64 MiB. La LRU nunca aplicaba su límite por bytes.

**Después**: estimador serializado documentado, y la caché **nunca expulsa la entrada que acaba de insertar** (el handoff no puede perderse antes de la fusión).

**Decisión: tomado.** No se midió en memoria y no correspondía: una página densa estimada son ~0,4 MB, así que el límite que ata sigue siendo el de 32 items. El valor del cambio es **cerrar un agujero de contabilidad**, no ahorrar bytes.

### 3.3 Caché de preview sin píxeles crudos — ADR-156

**Cambio propuesto**: cada entrada de la caché de preview retenía el `ImageData` crudo **y** los bytes codificados. Pasa a guardar solo lo codificado, y el kernel deja de transportar los píxeles en `mode: "preview"`.

**Antes**: a `MAX_RENDER_SCALE` (4), ~32 MB por página cacheada contra ~1 MB codificada, con un tope de caché de 200 MB que se llenaba de píxeles. Verificado sobre todo el repo: **ningún consumidor fuera de `render-engine` los lee** — `apps/react-client` no menciona `imageData` ni una vez, el export usa `encoded`, y `emitPreviewUpdated` arma el blob desde `encoded.bytes`.

**Después**: no medido en aislamiento (se implementó junto con ADR-157).

**Decisión: tomado.** Guardar y transportar una copia que nadie lee está mal con cualquier número. Medirlo en aislamiento habría costado una tanda para confirmar algo que la lectura del código ya demostraba.

### 3.4 Baja del pool de OCR al terminar su etapa — ADR-157

**Cambio propuesto**: Tesseract (~300 MB) y ONNX con su modelo (~400 MB) convivían durante toda la detección, con el OCR ya sin trabajo. La liberación por inactividad de ADR-080 existe pero **llega tarde para este pool**: sus 60 s de inactividad transcurren justo mientras corre la detección. Se agrega una baja explícita al terminar la etapa.

**Antes**: caída en `OCR_FINISHED` ≈ **0** (plana).

**Después**: **−702 a −1009 MB**, en 3 de 3 corridas calientes.

**Decisión: tomado.** Rindió **más del triple** de los ~300 MB estimados.

**Pero no bajó el pico**, y eso obligó a corregir lo que el propio ADR afirmaba de sí mismo: el máximo del run ocurre **dentro** de la ventana de OCR, antes de que esta baja se dispare. Lo que mejora es el nivel sostenido durante la detección y el que queda después — holgura real para el documento siguiente, no para el pico del actual.

### 3.5 Ráster de OCR codificado — ADR-158

**Cambio propuesto**: cada página viajaba como `ImageData` crudo (~35 MB) y se materializaba **cuatro** veces (canvas del kernel, `ImageData` del host, clon en el worker de OCR, y **otro** canvas que ese worker reconstruía con `putImageData`) — después de lo cual **tesseract.js la encodeaba a PNG igual**, porque su `loadImage` convierte toda entrada a bytes de imagen codificada. `rasterizePage` pasa a devolver `EncodedPageImage` (PNG, sin pérdida).

**Antes**: M2 **1918 – 2355 MB**. Δ del proceso GPU dentro de la ventana de OCR: **80 – 216 MB** (rango de 136).

**Después**: M2 **1694 – 1790 MB**. Δ de GPU: **75 – 99 MB** (rango de 24).

**Decisión: tomado.**

**Con una salvedad de atribución**: el arreglo del instrumento (§4.3) aterrizó en la misma ventana, así que **el M2 no es atribuible limpio** a este cambio. Lo que sí lo es: el **Δ de GPU**, que es una medida **intra-ventana** y no depende de dónde arrancó la corrida — bajó el techo (216 → 99) y el desparramo (136 → 24).

### 3.6 El worker de OCR no decodifica la página — ADR-160

**Cambio propuesto**: `ADR-158` sacó el ráster crudo del `postMessage`, pero su
salvedad daba por necesario que el worker decodificara igual. **No lo era.**
Verificado en la fuente de `tesseract.js@6.0.1`: su `loadImage` acepta un `Blob`
y entrega los bytes tal cual al core, que decodifica adentro del WASM. Los cuatro
canvas/`ImageData` de página completa que el kernel construía por página eran
costo íntegramente nuestro.

**Antes** (línea de base del 2026-09-12 04:43-04:45, con la versión final del
instrumento de T-1): pico dentro de `OCR_STARTED → OCR_FINISHED` — Tab
**1149,7 / 1022,6 / 1165,4 MB**; GPU **451,6 / 479,6 / 517,7 MB**.

**Después** (mismas 3 corridas, mismo instrumento, 13:34-13:37):

| | run0 | run1 | run2 |
|---|---|---|---|
| Tab | 896,7 MB (**−22,0 %**) | 880,2 (**−13,9 %**) | 1023,3 (**−12,2 %**) |
| **GPU** | 279,5 MB (**−38,1 %**) | 273,1 (**−43,1 %**) | 300,6 (**−41,9 %**) |
| combinado | **−425,0 MB** | **−348,8 MB** | **−359,2 MB** |

Promedio combinado: **−377,7 MB** sobre el pico de la etapa de OCR.

**Decisión: tomado.** Es el cambio de mayor efecto medido sobre el **pico** de
toda la campaña — ADR-143 fue mayor en magnitud absoluta, pero sobre memoria que
nunca llegó a medirse con instrumento.

**Tres cosas que lo hacen confiable, y una que no:**

1. **El GPU es la señal más fuerte, y no por ser la más grande.** Ese proceso es
   casi solo backing stores de canvas: sin modelos, sin heaps de WASM. Bajó 38-43 %
   **3 de 3**, que es difícil de explicar por otra cosa que "hay menos canvas".
2. **La predicción es anterior al dato.** ADR-160 §6 dijo *"el GPU es el que más
   tiene que moverse"* **antes** de medir, y bajó 3-4× más que Tab en términos
   relativos.
3. **Sin costo de calidad, medido**: `groupCount = 11` y `entityCount = 13` en las
   tres corridas, idénticos a la línea de base. Y el test estructural pasa con su
   discriminante (ADR-149 §2): cero canvas de página completa en el camino común,
   > 0 en el camino lento de orientación ≠ 0.

**La primera medición estaba inflada por deriva de línea de base, y el control lo
demostró.** Los −377,7 MB de arriba salían de comparar contra una tanda anterior
cuyas líneas de base se habían perdido (los JSON se sobrescriben, nombre fijo por
perfil y corrida — `Optimizacion_De_Memoria_Plan.md` §2bis punto 6). Se corrió el
control que faltaba: **6 corridas alternando condición corrida por corrida**
—BEFORE, AFTER, BEFORE, AFTER, BEFORE, AFTER, 13:52-14:01— reconstruyendo la app
en cada una y **preservando los 6 JSON**. Mismo diseño que §5.1.

| par | Δ línea de base | Δ M2 | Δ pico Tab | Δ pico GPU |
|---|---|---|---|---|
| 1 | **+648 MB** | −168,4 | −192,8 | −175,4 |
| 2 | **+564 MB** | −27,4 | −11,4 | −87,5 |
| 3 | −204 MB | −177,0 | −94,7 | −141,2 |
| **prom** | +336 MB | **−124,3** | **−99,6** | **−134,7** |
| **signo** | | **3/3** | **3/3** | **3/3** |

**El efecto es real: negativo 3 de 3 en las tres métricas.** Y la evidencia más
fuerte es la columna de la izquierda: en los pares 1 y 2 la condición AFTER
arrancó con una línea de base **648 y 564 MB más alta** que su BEFORE y **aun así
midió picos más bajos**. El confound no solo no explica el resultado: jugaba en
contra y el cambio ganó igual.

**Pero el tamaño real es ~62 % del primero**: Tab + GPU combinado da **−234,3 MB**
de promedio, no −378. La diferencia era deriva, exactamente lo que la salvedad
anterior sospechaba.

**El presupuesto sigue sin cumplirse de forma consistente.** M2 con el cambio
aplicado: **1587,7 / 1627,8 / 1299,8 MB** contra los ~1600 de
`07_Performance_Strategy.md` §7 — una de tres por encima. Sin el cambio:
1756,1 / 1655,3 / 1476,9, dos de tres por encima. **Mejora clara, cierre no.**
Y nótese cuánto se mueve M2 con la base: las mismas corridas AFTER dieron
1203-1386 MB en la tanda de las 13:34, con bases más bajas. Es la razón por la
que ADR-146 §7 lo degradó y por la que acá no se declara nada sobre M2 sin su
control.

**Sin costo de calidad, en las 6 corridas**: `groupCount = 11` en todas, las seis
válidas (`ok`, `peakWithinPhases`, `hotBaselineSettled`).

---

## 4. El instrumento: tres defectos y sus arreglos

Ninguno es un cambio de producto. Se registran porque **cada uno invalidó conclusiones anteriores**, y porque el orden en que aparecieron es la razón de que varias lecturas se corrigieran dos veces.

### 4.1 El fixture se generaba dentro del renderer medido

**Antes**: línea de base **fría** de P2 de **1223 – 1248 MB** (contra 403 – 430 de P1, que carga su PDF desde archivo), y retención **negativa** (−400 a −27 MB): la app "ocupaba menos" después de procesar que antes de abrir. Imposible, salvo que la base traiga basura de la generación.

**Después**: base fría **395,8 / 402,5 / 406,2 MB**.

**Decisión: tomado.** ADR-146 §4 ya lo pedía ("en un proceso separado que termine antes de medir"); la implementación cumplía la letra (antes del sampler) y no la cláusula.

### 4.2 La línea de base caliente era una sola muestra

**Antes**: M1 de **584,4 / 1181,5 / 534,6** MB — dispersión de 646,9.

**Después** (mínimo de una ventana de 4 s tras el cierre): **756,5 / 867,5 / 500,8** — dispersión de 366,7 (**−43 %**).

**Decisión: tomado, y con un hallazgo mayor que el arreglo.** La corrida que quedó más baja tenía la base **y** el pico más altos de las tres: no era retraso del recolector. Con memoria residente libre por dentro, el trabajo se acomoda sin pedirle nada nuevo al sistema, así que **M1 subestima la demanda**. Pasa a reportarse como **cota inferior** (ADR-146 §7): por debajo del presupuesto no demuestra que cumple; por encima sí demuestra que no.

### 4.3 La corrida caliente arrancaba sin esperar a que la instancia se asiente

**Antes**: en **2 de 3** corridas el máximo del run caliente caía **antes de `DOCUMENT_IMPORTED`** — era memoria del documento anterior sin decaer. El "pico" no tenía nada que ver con procesar el documento.

**Después**: **0 de 6** corridas inválidas.

**Decisión: tomado** (ADR-146 §7bis). Una corrida cuyo máximo caiga fuera de toda fase se reporta **inválida**, no se promedia.

---

## 5. Los descartes

### 5.1 Bajar `renderPoolSize` — descartado por medición

**Hipótesis** (mía, del planificador): con `renderPoolSize: 4`, cada worker de Render recibe el documento por un `broadcast` que no puede transferir su buffer, así que serían 4 clones del PDF.

**Medición**: `renderPoolSize` 4 contra 1, alternando condición corrida por corrida, 3 pares. Caliente: **−83 MB** de promedio. Frío: **+264 MB** — dirección opuesta, cada una consistente 3/3 consigo misma.

**Decisión: descartado, sin resultado.** Las dos están por debajo del ruido de M2 (~345 MB), y 3/3 con n=3 ocurre una de cada cuatro veces por azar.

**Y la premisa estaba mal por dos órdenes de magnitud**: el fixture de P2 pesa **1,71 MB**, así que los tres clones de más cuestan **5,1 MB**, no cientos.

### 5.2 `pageProxy.cleanup()` en el camino de OCR — descartado por medición y por código

**Hipótesis** (mía): `cleanup()` no se llama en ningún lado del kernel de Render, y los `PDFPageProxy` retendrían la imaginería decodificada de cada página — lo que explicaría los 2,4-4,2 MB por página que se acumulan en el renderer.

**Antes**: pico **1769,4 / 1694,2 / 1789,8** MB; pendiente de Tab **+2,39 / +4,22 / +2,42** MB/página.

**Después** (spike en rama descartable): pico **1805,3 / 1688,6 / 1789,1** MB; pendiente **−1,58 / +4,46 / +1,95** MB/página.

**Decisión: descartado.** El pico no se mueve (+35,9 / −5,6 / −0,7 contra ~345 de ruido) y la pendiente no se aplana de forma consistente.

**Y el código cierra la puerta para los dos lados**, lo cual importa para que nadie lo reintente: `PDFPageProxy.cleanup()` es solo del lado principal —lo del worker de pdf.js solo lo alcanza `PDFDocumentProxy.cleanup()`—, **pero del otro lado no hay nada que limpiar acá**: `GlobalImageCache` tiene `NUM_PAGES_THRESHOLD = 2` y solo cachea imágenes que aparecen en **dos o más** páginas. En un escaneado cada página trae la suya: ninguna entra.

### 5.3 Escala de grises para la entrada de OCR — descartado sin implementar

**Propuesta**: `ImageData` es RGBA (4 bytes/píxel) y Tesseract binariza igual, así que un búfer de 1 byte/píxel sería 4× menos: 34,8 → 8,7 MB por página, sin tocar resolución.

**Por qué no se puede**: **tesseract.js no acepta píxeles en ningún formato.** Su `loadImage` convierte toda entrada —canvas, blob, URL— a bytes de imagen **codificada**, y su core decodifica desde ahí. Un PNG de 8 bits en gris exigiría un encoder propio (dependencia nueva, R-12) y su ganancia queda mayormente absorbida por ADR-158, porque un escaneado comprime muchísimo sea cual sea su tipo de color.

### 5.4 Bajar `nerPoolSize` — descartado sin implementar

**Premisa de partida** (de la revisión externa, y mía al escribir ADR-154): con `nerPoolSize: 2`, cada worker carga su copia del modelo.

**Medición**: el conteo de concurrencia real dio **`ner-page: 1`** en dos documentos distintos, con `nerPoolSize: 2` configurado. `NerEngine.processPages` recorre las páginas con un `for`/`await` plano, y los workers se crean perezosamente por slot: **el segundo worker de NER nunca llega a existir.**

**Decisión: descartado — no hay nada que ahorrar.** Y el hallazgo invirtió el problema: lo que hay no es duplicación, es **paralelismo que falta**, exactamente la situación que ADR-101 encontró y cerró para OCR. H-09D1 se reformuló a partir de esto.

### 5.5 Bajar el paralelismo en general — prohibido

Con `performancePreset: low` (los cuatro pools en 1), P2 midió **355 MB** de M1, bajo el presupuesto. Era una salida de una línea.

**Decisión del humano: no** (ADR-154 §1). Recortar paralelismo paga memoria con tiempo de usuario, y el tiempo también es contractual. Lo que se duplica no es trabajo, es inventario.

### 5.6 Bajar el DPI — disponible, no usado

La memoria va con el cuadrado del DPI: 300 → 200 es **−55 %** del ráster. Es el único lever grande y predecible que queda.

**Decisión: postergado por preferencia del humano**, por ser el único de la lista con costo de calidad de reconocimiento. Si se retoma, se mide contra la baseline de ADR-147 **antes** de tocar nada.

---

## 6. Hallazgos de método

Cinco cosas que costaron rondas y conviene no volver a aprender:

1. **Restar dos corridas no resuelve levers de 50-400 MB** cuando el ruido entre corridas es de ~345 MB. Bajar el error estándar por debajo de 50 MB pediría del orden de cincuenta corridas por condición. La atribución se hace **dentro de una corrida, por fase** (ADR-146 §7).
2. **El máximo de un run no es un estadístico robusto** si la corrida puede arrancar sucia: en 2 de 3 casos cayó fuera de toda fase.
3. **Un instrumento que mide mal no da un error, da un número.** Tres defectos del instrumento invalidaron conclusiones anteriores, y ninguno se manifestó como fallo.
4. **Con un sospechoso nombrado, intervenir y volver a medir le gana a medir más fino.** El descarte de §5.2 costó un spike de una línea; construir un instrumento que separe estructuras dentro de un proceso habría costado mucho más y no era necesario.
5. **Conclusiones de una sola corrida se caen.** "El pico está dentro del OCR" salió de una corrida y se sostuvo en 1 de 3. Con n=3 y direcciones opuestas, 3/3 no es evidencia: ocurre una de cada cuatro veces por azar.

---

## 7. Lo que queda abierto

> **Corregido el 2026-09-11 por ADR-159, sin corridas nuevas.** Todo lo que
> sigue en §7 hasta §7.1 se escribió leyendo una **regresión de RSS**, y ese
> estadístico no resuelve esta pregunta. Los tres intervalos de confianza de la
> pendiente son **disjuntos** (−1,58 ±1,21 / +4,46 ±0,67 / +1,95 ±0,81 MB/pág)
> sobre una señal que oscila 430-660 MB dentro de la propia ventana, y la
> corrida con la línea de base más baja tiene el pico más alto — o sea que la
> pendiente mide la pereza del recolector tanto como lo que se retiene.
>
> **Qué sobrevive y qué no**, por el estadístico del piso (mínimo del primer
> cuarto contra mínimo del último):
>
> - **El residuo es real y el rango era correcto**: Tab sube +2,29 / +4,86 /
>   +1,53 MB/página, **positivo 3 de 3**.
> - **El reparto Tab/GPU de abajo está mal**: GPU sube **3 de 3 también**
>   (+1,15 / +3,06 / +3,13 MB/pág), tanto o más que Tab en dos corridas. El
>   "73-81 %" salió de la regresión sobre el diente de sierra y **se retira**.
> - **Consecuencia mayor**: GPU no puede ser el heap de Tesseract, que vive en
>   Tab. La hipótesis del heap de WASM explica **como mucho la mitad**; la otra
>   mitad son backing stores de canvas, y son nuestros. Ver ADR-160.
>
> El plan que reanuda esto es `roadmap/Optimizacion_De_Memoria_Plan.md`.

**El residuo no localizado**: **2,4 – 4,2 MB por página** acumulándose en el proceso del renderer durante la ventana de OCR (el renderer explica el 73-81 % de la pendiente; GPU es secundario y por debajo del ruido en 2 de 3 corridas). Tres intentos de localizarlo, tres negativos limpios. Sobre 50 páginas son **136 – 277 MB**, el mismo orden que el exceso que queda.

**La hipótesis que mejor encaja, no probada**: la marca de agua del heap de WASM de Tesseract. La memoria lineal de WASM **solo crece**; lo único que la devuelve es terminar la instancia — que es exactamente lo que hace ADR-157 al final de la etapa, y por eso libera 702-1009 MB de una. Si es correcta, es **irreducible dentro de una corrida**, y las únicas salidas serían reciclar los workers de OCR a mitad del documento (paga una recarga de modelo por reciclo) o achicar el conjunto de trabajo por página (el DPI).

**Objeción a esa hipótesis, planteada el 2026-09-13 y sin resolver**: el fixture de
P2 tiene **50 páginas casi idénticas** (45 con el mismo párrafo neutro, 5 con uno
de entidades). Una marca de agua de allocator sobre trabajo uniforme debería
**aplanarse después de las primeras páginas**, no subir en línea recta durante
las 50. Que la pendiente se mantenga lineal sobre contenido repetido es evidencia
**en contra** de la hipótesis del heap y **a favor** de que algo se **retiene**
por página. Tampoco es el ráster: ADR-158 achicó ese transporte ~30× y la
pendiente solo bajó de 2,8-5,5 a 2,4-4,2 MB/página.

> **Resuelta en parte el 2026-09-11.** La objeción tenía razón, y el mecanismo
> ya tiene nombre: el worker de OCR materializa **cuatro superficies de página
> completa** por página (ADR-160 §2 del Contexto) y sus backing stores salen por
> el proceso GPU, que acumula 3/3 por el piso. Eso no es marca de agua de
> allocator: es trabajo nuestro, y explica por qué no se aplana sobre contenido
> repetido. Lo que **sí** queda del lado del heap de WASM es que cada
> `SetImageFile` copia la página adentro (`thresholder.cpp`: `pix_ = src.copy()`),
> y hoy se llama **seis veces por página** — una de OSD, una principal y cuatro
> de las franjas de ADR-121.

**El experimento que lo decide, y que además contesta una pregunta de producto**:
correr el mismo perfil con **200 páginas** —un expediente judicial realista, y el
generador de fixtures ya existe; es cambiar el límite de un `for`—. Si el pico se
queda cerca de ~1,8 GB, la acumulación está acotada y la extrapolación es falsa;
si llega a ~2,0-2,4 GB, es retención real y crece sin techo con el largo del
documento, que importa mucho más que los 94-190 MB del presupuesto.

Extrapolación lineal, **no medición**: 200 páginas × 2,4-4,2 MB = 480-840 MB de
aporte, contra los 120-210 MB que aportan 50 — o sea un pico de **~2,0 a
~2,4 GB**.

> **Corregido por ADR-159 §5**: la extrapolación contaba solo Tab. Con Tab + GPU
> (+3,44 / +7,92 / +4,66 MB/pág por el piso) son **680 – 1580 MB** de aporte
> sobre 200 páginas. El experimento sigue siendo el mismo y sube de prioridad,
> no baja.

**El intento que cerró la búsqueda**: comparar la pendiente del renderer en la ventana de detección contra la de OCR. No localizó — sobre 17-19 muestras en 2,5-2,8 s, el R² salta de 0,000 a 0,806 entre corridas, que es la firma de ajustar ruido, no una señal débil.

### 7.1 Las tres alternativas abiertas

Anotadas para retomar. Ninguna está tomada; la decisión es del humano (ADR-154 §5).

| Alternativa | Rinde | Cuesta | Estado |
|---|---|---|---|
| **A — Actualizar el presupuesto con lo medido** | cierra la brecha por definición: reemplaza una suma de estimaciones de la fase 1 —que omitía el proceso GPU entero— por componentes medidos, y declara el perfil de 50 páginas escaneadas en ~1,8 GB | nada de código; una pasada por `07_Performance_Strategy.md` §7 y su fila de §1 | **Recomendada.** Cierra H-10 y libera al implementador |
| **B — Reciclar los workers de OCR a mitad del documento** | ~75-100 MB **si** la hipótesis de la marca de agua de Tesseract es correcta; **cero** si no lo es | una recarga de modelo por reciclo (local, ~1-3 s), y drenar el pool en un límite de página. No toca paralelismo ni DPI | Apuesta sobre una hipótesis **no probada**, y sin forma barata de probarla antes |
| **C — Bajar el DPI de 300 a 200** | **−55 %** del conjunto de trabajo por página; el único lever grande y predecible que queda | calidad de reconocimiento — hay que medir contra la baseline de ADR-147 **antes** de tocar nada, y aceptar o no esa pérdida es decisión del humano | Postergada por preferencia explícita del humano, no descartada |

Lo que **no** está entre las alternativas, y por qué: recortar paralelismo lo prohíbe ADR-154 §1; el lever del canvas que solo crece (ADR-154 §2 lever 5) apunta al proceso GPU, que aporta 75-99 MB y donde la acumulación **no** está (el renderer explica el 73-81 % de la pendiente); y el paralelismo por hilos en vez de workers no aplica acá — ver §7.2.

> **Corregido el 2026-09-11 (ADR-159 §4).** La cláusula del medio es falsa: por
> el piso, el proceso GPU acumula 3/3 y en el mismo orden que Tab. El lever del
> canvas **sí** es candidato, deja de estar postergado, y ADR-160 es la forma
> concreta que toma. Las otras dos cláusulas siguen en pie.
>
> **Y aparece una alternativa D que esta lista no tenía**: ADR-160 —que el
> worker de OCR no decodifique la página— rinde sin costo de calidad, sin tocar
> paralelismo y sin tocar el DPI. Es la que se ejecuta primero; ver
> `roadmap/Optimizacion_De_Memoria_Plan.md` §2.

### 7.2 Por qué los hilos no sirven para el OCR

La idea de paralelizar con **hilos dentro de una sesión** en vez de con **N workers** —una copia de los pesos en vez de N— aparece en ADR-154 §2 lever 1, y es tentador extenderla al OCR, que es donde está el problema. **No aplica**, por dos razones distintas:

1. **Es de NER, y ahí no ahorra memoria.** Medido: `ner-page` da **1** con `nerPoolSize: 2` configurado, porque `processPages` recorre las páginas de a una y los workers se crean por slot. El segundo worker **nunca existe**, así que no hay segunda copia del modelo que eliminar. Lo que los hilos comprarían ahí es **velocidad** —NER no tiene paralelismo por página, §5.4—, no memoria.
2. **Y no hay equivalente en OCR.** `tesseract.js-core@6.1.2` publica seis builds —`tesseract-core`, `-simd`, `-lstm`, `-simd-lstm` y sus `.wasm.js`— y **ninguno es multihilo**. A diferencia de onnxruntime-web, que sí empaqueta el build con pthreads que la app usa, Tesseract solo paraleliza por instancia. Una instancia por worker, y cada una con su heap.

**Y el peor problema sí es el de OCR**: el pico del run cae dentro de la ventana `OCR_STARTED → OCR_FINISHED`, y es ahí donde se acumulan los 2,4-4,2 MB por página que no se pudieron localizar.

**Y el presupuesto contra el que se mide**: los ~1,6 GB de `07_Performance_Strategy.md` §7 **nunca se midieron, se sumaron** — son estimaciones de componentes de la fase 1, hechas antes de que existiera casi todo. Esta campaña demostró que esa suma **omitía un proceso entero**: el GPU, que aporta 75-99 MB durante el OCR y no figura en ninguna fila. Reemplazarlo por componentes medidos no es correr el arco; es lo que ADR-146 ya hizo al separar M1 de M2. **La decisión de hacerlo, o de aceptar el exceso declarado, es del humano** (ADR-154 §5) y está pendiente.

---

## 8. Resultado de T-3 — el perfil de 200 páginas

Ejecutado el 2026-09-13 sobre un único build post-ADR-160, con el equipo inactivo
y los perfiles en serie. Tres ejecuciones de 50p y tres de 200p; cada una incluye
fría→cerrar/asentar→caliente. Las seis son válidas (`ok`, pico dentro de fases y
base caliente asentada), sin timeout ni OOM.

### 8.1 Nivel y tiempo

| run | M2 50p fría/caliente | M1 50p | M2 200p fría/caliente | M1 200p | tiempo 200p fría/caliente |
|---|---:|---:|---:|---:|---:|
| 0 | 1329,3 / 1484,4 MB | 738,0 MB | 1418,7 / 1813,6 MB | 984,4 MB | 107,7 / 108,7 s |
| 1 | 1683,2 / 1681,6 MB | 290,4 MB | 1867,7 / 1826,4 MB | 1141,7 MB | 116,5 / 116,7 s |
| 2 | 1813,4 / 1470,5 MB | 97,8 MB | 2012,7 / 1769,8 MB | 912,9 MB | 114,4 / 118,8 s |

M1 vuelve a mostrar por qué es una cota inferior: en 50p se mueve de 97,8 a
738,0 MB según la base que la corrida traía. El dato se conserva, no se usa para
atribuir crecimiento. Los 200p sí cuestan más tiempo de forma estable —~108-119
s contra ~28-31 s—, aproximadamente lo esperable por cuatro veces las páginas.

### 8.2 Piso de OCR, corrida por corrida

Los valores son `piso final − piso inicial` del primer contra el último cuarto de
`OCR_STARTED → OCR_FINISHED`, nunca promediados (ADR-159 §3):

| run | Δ 50p fría Tab/GPU/combinado | Δ 50p caliente Tab/GPU/combinado | Δ 200p fría Tab/GPU/combinado | Δ 200p caliente Tab/GPU/combinado |
|---|---:|---:|---:|---:|
| 0 | +114,4 / +94,5 / **+208,9 MB** | +124,9 / +46,4 / **+171,3 MB** | +148,7 / +163,0 / **+311,7 MB** | +136,0 / +102,3 / **+238,3 MB** |
| 1 | +230,2 / +104,8 / **+335,0 MB** | +33,5 / +39,5 / **+73,0 MB** | +33,2 / +96,1 / **+129,3 MB** | −1,3 / +119,7 / **+118,4 MB** |
| 2 | +419,4 / +136,9 / **+556,3 MB** | +126,7 / +42,0 / **+168,7 MB** | +200,4 / +75,8 / **+276,2 MB** | +12,2 / +106,0 / **+118,2 MB** |

**Resultado firme: la extrapolación lineal era falsa.** Pasar de 50 a 200
páginas no multiplicó por cuatro el delta combinado. El rango de 200p
(+118,2 a +311,7 MB) queda en el mismo orden que el de 50p (+73,0 a +556,3 MB),
y en tres de las seis comparaciones por run/temperatura es menor.

### 8.3 Por qué no se declara “acotado”

El primer-cuarto contra último-cuarto puede esconder dónde ocurrió el aumento.
Releída la serie cruda de 200p en cuatro cuartos, el delta combinado Q3→Q4 fue:

| | run0 | run1 | run2 |
|---|---:|---:|---:|
| fría | +45,4 MB | +6,4 MB | −7,8 MB |
| caliente | +67,0 MB | +88,0 MB | −60,4 MB |

Cuatro positivos y dos negativos. La mayor parte del crecimiento aparece antes
y hay señales de meseta, pero el último cuarto todavía sube en cuatro corridas.
No alcanza para afirmar que el conjunto de trabajo quedó acotado antes de 200
páginas; tampoco respalda el crecimiento lineal que motivó el experimento.

**Conclusión: T-3 cierra inconclusa entre “meseta” y “crecimiento tardío”, y
descarta la extrapolación lineal de ADR-159 §5.** No cambia el presupuesto ni
autoriza otro lever. Si distinguir las dos formas restantes se vuelve necesario,
el siguiente instrumento tiene que asociar muestras con avance de página y
calcular pisos por bloques de páginas; repetir más veces el mismo máximo RSS no
contesta esa pregunta.

Los valores completos —incluidos grupos, entidades y las doce temperaturas—
quedan en `roadmap/Optimizacion_De_Memoria_Plan.md` §3.0. Los JSON crudos viven
en `.measure/memory-p2-scanned-{50p,200p}-run{0,1,2}.json` y están gitignoreados.
