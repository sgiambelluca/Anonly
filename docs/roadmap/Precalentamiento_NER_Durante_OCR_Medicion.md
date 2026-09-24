<!-- CONTEXT: scope=medicion-precalentamiento-ner | plan=Precalentamiento_NER_Durante_OCR_Plan.md | veredicto=§7 | dependencias=adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-157-El-Pool-De-OCR-Se-Da-De-Baja-Al-Terminar-Su-Etapa.md,adr/ADR-080-Idle-Dispose-En-El-Pool-No-En-El-Manager.md,core/NER_Engine.md,roadmap/Perfilado_NER_Interno_Medicion.md | evidencia-principal=.measure/ner-preload-ocr/20260917T163638Z -->

# Medición de precarga NER durante OCR

**Fecha:** 2026-09-17. **Decisión humana:** **descartado; no implementar la precarga NER durante OCR**. El producto conserva el orden OCR → NER. La campaña principal es **v2**; la primera campaña se conserva como preliminar por diferencias de build y orden de ejecución (§6).

La oportunidad inicial era ocultar unos **0,94 s de carga fría** del modelo. En la campaña válida, B1 no produjo una mejora estable del tiempo total hasta `Ready` (deltas pareados de **+3,03 s, −2,82 s y −0,36 s**), mientras elevó el pico RSS **144–422 MB** en las tres rondas y demoró materialmente el OCR en dos. B2 empeoró `Ready` y OCR en las tres rondas. Mantener esta concurrencia y sus riesgos de memoria, ciclo de vida y cancelación para intentar recuperar aproximadamente un segundo no compensa. Los datos completos y sus límites están abajo; no se abre una tarea de implementación ni un ADR de cambio de producto. **El veredicto razonado, con los criterios del plan uno por uno y la variante de arranque, está en §7**; queda anotado como descarte medido en el lever 3 de ADR-154 §2, que es donde un lector busca el solapamiento OCR/NER.

## 1. Qué se comparó

- **A1/A2:** comportamiento actual; el primer batch NER carga el modelo después del OCR.
- **B1:** carga del modelo NER al comenzar OCR.
- **B2:** carga al completar el 75 % de los trabajos OCR.

El arnés llamó `kernelClassify` con texto vacío en el mismo pool y slot NER que después atendió los batches reales. Esperó cualquier precarga pendiente antes de clasificar, y liberó el pool OCR al terminar su etapa. No clasificó texto del documento durante OCR ni emitió eventos públicos de NER desde la precarga. El patch fue temporal; la selección entre A/B1/B2 no cambió el build.

La v2 ejecutó tres rondas seriales `A1 → B1 → B2 → A2`, cada condición en una instancia nueva de Electron. Cada instancia importó el mismo PDF en frío y luego en caliente. Se usó un único build instrumentado para las 12 condiciones. P2 fue el PDF escaneado congelado de 50 páginas (`p2-scanned-50p-351fc4d31cd80ce0.pdf`, SHA-256 `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`), con OCR a 300 DPI, pools OCR 2/NER 2 y NER activo. P1, texto nativo, fue el control sin OCR.

El RSS se muestreó cada 150 ms mediante `app.getAppMetrics()` y se informa como **suma de working sets**, no como memoria física única. Todos los valores MB de las tablas son decimales. El arnés no midió uso de CPU directamente; el cambio de tiempo OCR muestra el efecto observable sobre esa etapa, sin probar por sí solo su causa.

## 2. Filas crudas de la campaña principal (P2, v2)

`Ready` es `DOCUMENT_IMPORTED → PIPELINE_READY`; `OCR` es `OCR_STARTED → OCR_FINISHED`. La duración de precarga incluye despacho y carga, y no equivale al `modelLoadMs` interno del perfilado anterior.

| ronda | condición | Ready frío ms | Ready caliente ms | OCR frío ms | OCR caliente ms | pico RSS frío MB | pico RSS caliente MB | precarga fría ms |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | A1 | 19123 | 17348 | 13120 | 12966 | 1312,3 | 1277,6 | — |
| 0 | B1 | 22181 | 19515 | 15978 | 14640 | 1481,3 | 1148,7 | 2251 |
| 0 | B2 | 20295 | 18815 | 14912 | 14509 | 1321,9 | 1273,0 | 2125 |
| 0 | A2 | 19179 | 18668 | 12537 | 13572 | 1361,9 | 1219,1 | — |
| 1 | A1 | 21588 | 17139 | 13623 | 12883 | 1259,1 | 1223,6 | — |
| 1 | B1 | 17854 | 18591 | 13120 | 13858 | 1792,7 | 1178,3 | 1530 |
| 1 | B2 | 20908 | 21902 | 15438 | 13864 | 1268,0 | 1268,0 | 2755 |
| 1 | A2 | 19756 | 19293 | 12440 | 13691 | 1482,8 | 1264,1 | — |
| 2 | A1 | 20422 | 17720 | 13810 | 12934 | 1317,5 | 1272,5 | — |
| 2 | B1 | 18798 | 16135 | 14535 | 12243 | 1593,6 | 1512,7 | 1781 |
| 2 | B2 | 25850 | 17617 | 19181 | 13165 | 1263,9 | 1217,7 | 4368 |
| 2 | A2 | 17887 | 16077 | 11895 | 12014 | 1409,6 | 1536,9 | — |

Las 12 condiciones llegaron a `PIPELINE_READY`. En cada una se observó un máximo de **un worker NER**; el arnés no abrió un segundo worker para clasificar. En P1 no hubo OCR ni precarga en ninguna condición.

## 3. Comparación dentro de cada ronda

Cada delta es `B − promedio(A1, A2)` de la misma ronda. Un valor negativo de `Ready` es mejora; uno positivo de OCR o RSS es costo.

| variante | ronda | Δ Ready frío ms | Δ OCR frío ms | Δ pico RSS frío MB |
|---|---:|---:|---:|---:|
| B1 temprana | 0 | +3030 | +3149,5 | +144,2 |
| B1 temprana | 1 | −2818 | +88,5 | +421,8 |
| B1 temprana | 2 | −356,5 | +1682,5 | +230,0 |
| **B1 mediana** | | **−356,5** | **+1682,5** | **+230,0** |
| B2 tardía | 0 | +1144 | +2083,5 | −15,2 |
| B2 tardía | 1 | +236 | +2406,5 | −102,9 |
| B2 tardía | 2 | +6695,5 | +6328,5 | −99,6 |
| **B2 mediana** | | **+1144** | **+2406,5** | **−99,6** |

**B1:** el efecto en `Ready` cambia de signo entre rondas y su mejora mediana de 0,36 s queda por debajo del mínimo de 0,5 s del plan. El OCR se retrasó materialmente en dos de tres rondas y casi no cambió en la otra; el pico RSS subió **en las tres** entre 144 y 422 MB. Es consistente con convivencia costosa de OCR y NER, pero sin una medición directa de CPU no se atribuye todo el retraso al uso de núcleos.

**B2:** `Ready` empeoró en las tres rondas y OCR se retrasó entre 2,08 y 6,33 s. El pico RSS no mostró un aumento consistente. El disparo tardío tampoco produce un ahorro útil.

En caliente el modelo ya estaba cargado por la importación fría de la misma instancia. Las medianas de delta `Ready` caliente fueron **+375 ms para B1** y **+807 ms para B2**, con dispersión; no se observó un beneficio caliente reproducible.

## 4. Calidad y validez

El collector v2 registró por separado las palabras OCR y la secuencia de detecciones, antes de cada importación. En las 12 condiciones de P2, tanto frías como calientes, coincidieron exactamente:

- Huella OCR: `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49` (50 páginas, 1038 palabras).
- Huella de detección: `327c988dd2622c4fd69b47a37d424b7704e2ec92449ada99834323de39abf9c8` (13 entidades, 11 grupos).

Las huellas del corpus congelado demuestran igualdad entre condiciones medidas; no reemplazan una evaluación general de recall. El control largo de 200 páginas no se ejecutó porque B1 ya falló el criterio de memoria y el de mejora estable. Tampoco se ejecutó el smoke de cancelación durante precarga; ese camino requeriría validación antes de cualquier implementación futura. Estos límites no cambian el descarte por los resultados de P2.

## 5. Evidencia, restauración y gates

La evidencia principal está en `.measure/ner-preload-ocr/20260917T163638Z/`: `summary.json`, `quality-summary.json`, JSON crudos por fase/temperatura, muestras RSS, logs, hashes y manifiesto del build. El smoke v2 está en `.measure/ner-preload-ocr/20260917T163243Z/`. El [runner](../../tests/perf/run-ner-preload-ocr.sh) y el [patch temporal](../../tests/perf/support/ner-preload-ocr.patch) reproducen el instrumento.

El runner guardó `orchestrator.ts` y `ner.engine.ts`, comprobó aplicabilidad del patch y restauró ambos byte a byte. `source-before.sha256` y `source-restored.sha256` son idénticos; el build normal se reconstruyó después. No quedan cambios de producto por este experimento.

Con fuentes restauradas pasaron `pnpm lint`, `pnpm typecheck`, `pnpm test` (140 archivos, 2272 tests), `pnpm test:contract` (10 archivos, 312 tests), Prettier para estos archivos y `git diff --check`.

## 6. Campaña preliminar

La primera campaña (`.measure/ner-preload-ocr/20260917T150022Z/`, smoke en `20260917T145445Z/`) usó builds distintos entre controles y variantes y ejecutó repeticiones por fase en lugar de intercalar condiciones. Sus datos se conservan como preliminares y **no** fundamentan la conclusión. Esa serie sugería un ahorro frío para B1, pero también mayor RSS y OCR más lento; la v2 corrigió la comparación y encontró que el ahorro de `Ready` no era estable.

## 7. Veredicto

**Rechazado.** El producto conserva el orden OCR → NER: el modelo se carga dentro del primer batch de NER, ya terminado el escaneo del documento, y no antes. No se implementa B1 ni B2, no se abre tarea ni ADR de cambio de producto, y el lever 3 de ADR-154 §2 queda anotado con este descarte para que la idea no se reintente sin leer estos datos.

### 7.1 Por qué, contra los criterios que el plan fijó antes de medir

El plan exigía cinco condiciones simultáneas (§5). Ninguna variante pasa, y falla lo que primero se quería ganar.

| Criterio del plan | B1 temprana | B2 tardía |
|---|---|---|
| 1. Calidad y una sola carga | **cumple** — huellas idénticas, un worker NER | **cumple** |
| 2. Mejora fría ≥ 0,5 s, estable | **falla** — mediana −0,36 s y cambia de signo (+3,03 / −2,82 / −0,36 s) | **falla** — `Ready` empeora en las tres rondas |
| 3. OCR no se retrasa > 5 % | **falla** — +3,15 s y +1,68 s en dos rondas sobre ~13 s de OCR | **falla** — +2,08 a +6,33 s |
| 4. Pico de RSS sin aumento material | **falla** — +144 / +422 / +230 MB, las tres | inconcluso, sin aumento consistente |
| 5. Sobrevive al OCR largo | no evaluado: ya había fallado 2, 3 y 4 | no evaluado |

El criterio 4 pedía además distinguir un aumento real de la dispersión del banco: **en cada ronda el delta de B1 supera la diferencia entre sus propios controles** (+144 contra 50 MB, +422 contra 224, +230 contra 92). El aumento de memoria no es ruido.

### 7.2 El argumento que decide, y que no depende de B1 ni de B2

La diferencia entre los dos controles de una misma ronda —A1 y A2, el **mismo código** medido dos veces con una instancia fresca cada uno— fue de **0,06 s, 1,83 s y 2,54 s** sobre `Ready` en frío. La oportunidad completa que esta campaña perseguía es **0,94 s**: los 942,94 ms de `modelLoadMs` en frío que midió `Perfilado_NER_Interno_Medicion.md`.

En dos de las tres rondas, la deriva del banco entre dos corridas idénticas **duplica o triplica el techo teórico de la optimización**. Aun con un arnés que hiciera la precarga gratis —sin retrasar el OCR y sin costo de memoria— la ganancia quedaría por debajo de lo que el instrumento puede resolver. No se podría verificar al implementarla, ni defenderla después frente a una sospecha de regresión, ni notarla un usuario.

Esa es la razón de fondo para no seguir: el problema no es que estas dos variantes hayan salido mal, es que **el premio es más chico que el error de medición**. Reintentar la idea con otro disparo o mejor ingeniería no cambia esa relación; solo la cambiaría un `modelLoadMs` mucho mayor o un banco mucho más estable.

### 7.3 Lo que además se paga y no se veía en la propuesta

La duración de la precarga de B1 fue de **1,53 a 2,25 s**, contra los 0,94 s que tarda la misma carga cuando corre sola. Las dos cifras no son estrictamente comparables —la de B1 incluye el despacho al worker y la de `modelLoadMs` no— pero la dirección es consistente con lo que muestran los tiempos de OCR: **adelantar la carga no la hace gratis, la hace competir**. No se midió CPU directamente, así que la contención queda como lectura coherente con los datos, no como causa probada.

A eso se suma superficie que hoy no existe: un disparo de carga fuera del flujo de detección, una promesa pendiente que el primer batch tiene que esperar sin abrir un segundo slot, y un camino de cancelación y cierre durante esa carga. El smoke de cancelación no llegó a ejecutarse (§4); sería obligatorio antes de cualquier implementación futura. Todo eso para ocultar un segundo que no se distingue del ruido, y en contra de la dirección de ADR-157, que da de baja el pool de OCR justamente para que Tesseract y ONNX **no** convivan.

### 7.4 Cargar el modelo al abrir la aplicación: descartado, y por eso no se midió

La propuesta original incluía una tercera variante —cargar el modelo al iniciar la aplicación, antes de que haya documento— que nunca entró al plan de medición. **Queda descartada por decisión del humano**, con un argumento de código y de producto, no de banco:

1. **El pool libera el worker a los 60 s de inactividad** (`idleDisposeMs`, ADR-080). En cualquier sesión donde el usuario tarde más de un minuto en importar —abrir la app, buscar el archivo, atender otra cosa— el modelo ya se descargó y hay que cargarlo igual. El ahorro no está garantizado justo en el caso normal.
2. **Ocupa 200–400 MB sin documento abierto** (`core/NER_Engine.md` §12), en una aplicación que el usuario puede abrir sin analizar nada.
3. Es el mismo criterio que ADR-151 ya aplicó al precalentado de la página 1: se precalienta **cuando no hay con qué competir y el trabajo no se puede desperdiciar**. Al arranque no se cumple ninguna de las dos.

Anonly es 100 % local: el modelo viaja dentro del instalador (ADR-130) y se lee del disco. No hay descarga que adelantar.

### 7.5 Qué reabriría la discusión

Nada de lo medido acá se reabre por opinión. Sí la reabriría un cambio de las condiciones: un `modelLoadMs` que crezca de forma material —otro modelo, otra cuantización, otro backend— o un banco de medición cuya deriva entre controles idénticos baje al orden de los 100 ms. Mientras el techo de la idea siga siendo ~1 s y la deriva siga en el orden de los segundos, esta campaña ya respondió la pregunta.
