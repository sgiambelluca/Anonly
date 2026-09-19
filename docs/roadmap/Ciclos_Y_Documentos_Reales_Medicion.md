<!-- CONTEXT: scope=roadmap-medicion | tarea=T-9,T-10 | dependencias=roadmap/Ciclos_Y_Documentos_Reales_Plan.md,roadmap/Optimizacion_De_Memoria_Plan.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 -->

# T-9 y T-10 — Medición: ¿hay una fuga?, y dos documentos reales

> Protocolo y criterio de lectura, fijados antes de medir:
> [`Ciclos_Y_Documentos_Reales_Plan.md`](Ciclos_Y_Documentos_Reales_Plan.md).
> Medido el 2026-09-18 sobre el commit `a03b565`, en el M1 de 8 GB, con el producto
> empaquetado.

---

## 0. Veredicto, antes de los datos

**T-9: no hay fuga.** En diez ciclos de apertura y cierre, en tres corridas, la
cantidad de workers vivos no cambió y el reposo de la app no creció. El residuo que
queda después del primer documento (~170 MB en la mediana, casi todo en el
renderer) es un costo de una sola vez: no crece con los documentos siguientes y el
sistema lo recupera cuando le falta memoria.

Dos observaciones que no llegan a ser un hallazgo según el criterio del plan, pero
quedan escritas:

1. **El heap de JS del hilo principal crece ~0,1 MB por documento**, con la misma
   pendiente en las tres corridas y siempre a más de dos errores estándar. Es real
   y chico: menos de 1 MB entre el ciclo 2 y el 10, contra el umbral de 5 MB.
2. **Seis segundos después de cerrar un documento escaneado quedan ~350 MB de
   basura sin recolectar.** Un GC forzado la libera. No es retención: a los 90 s ya
   no está.

**T-10: los documentos reales cuestan en tiempo, no en memoria.** Una página real
tiene ~15 veces más palabras que una del fixture, y eso se paga en tiempo: el OCR
tarda ~7 veces más por página y NER entre 10 y 15 veces más. El pico de memoria, en cambio,
queda donde estaba con los fixtures, dentro de la resolución de la medición. Y con
texto real, **NER pesa en tiempo tanto como el OCR**: en el documento nativo es casi
todo el tiempo de procesamiento.

Dos cosas que salen de acá y **no le corresponde decidirlas al planificador** (§2.5):

1. Con un escaneo real, el OCR dura más que los 15 s de NER (ADR-167), así que el
   modelo se libera durante el OCR y se recarga al terminar. **La corrida «caliente»
   de ADR-146 deja de tener el modelo tibio**, y su M1 (627-803 MB) queda por encima
   de los 512 MB del presupuesto con una recarga adentro. Hay que decidir si el
   presupuesto se aplica así.
2. Extrapolando por página, **diez páginas nativas reales rondarían los 8 s del
   objetivo contractual**. Es una extrapolación hecha bajo instrumento, no una
   medición.

---

## 1. T-9 — el ciclo de 10 open/close

### 1.1 El banco estaba bajo presión, y eso manda sobre el RSS

Las tres corridas arrancaron con **50-600 MB libres**, 1,9-3,7 GB en el compresor de
macOS y el swap subiendo de 272 MB a ~1,1 GB a lo largo de la sesión. En L1 y L2 el
compresor y el swap se movieron más de 500 MB entre el primer y el último ciclo, y el
instrumento marcó su RSS como **confundido**, como estaba previsto (plan §2.5). En
L3 no (compresor +122 MB, swap +100 MB): **L3 es la corrida cuyo RSS se lee**.

El heap de JS con GC forzado y el conteo de workers no dependen de la presión, y se
leen en las tres.

### 1.2 Las tres señales, por corrida

Pendientes sobre los ciclos 2 a 10, con su error estándar (plan §2.5):

| corrida | workers vivos | heap JS del hilo principal | RSS en reposo | Tab en reposo |
|---|---|---|---|---|
| **L1** — P1 encadenado | 9 en los diez ciclos | +0,104 ± 0,008 MB/ciclo | −10 ± 5 MB/ciclo (confundido) | −6 ± 4 MB/ciclo (confundido) |
| **L2** — P2 encadenado | 9 en los diez ciclos | +0,109 ± 0,011 MB/ciclo | +28 ± 18 MB/ciclo (confundido) | +19 ± 16 MB/ciclo (confundido) |
| **L3** — P1 con 90 s de reposo | 0 en los diez ciclos | +0,105 ± 0,011 MB/ciclo | **+5 ± 14 MB/ciclo** | **+12 ± 12 MB/ciclo** |

Contra el criterio escrito antes de medir:

- **Workers**: ninguna corrida terminó con más workers que en los ciclos 2 a 4. En
  el régimen encadenado quedan vivos los mismos nueve (cinco sin hijos —uno de pdf y
  cuatro de render— y el de NER con sus tres hilos); con reposo, ninguno.
- **Heap de JS**: la pendiente supera los dos errores estándar en las tres, pero el
  crecimiento entre el ciclo 2 y el 10 es de ~0,85 MB, por debajo de los 5 MB del
  umbral. **No es una fuga según el criterio; sí es una señal real** (§1.4).
- **RSS**: ninguna pendiente supera los dos errores estándar. En L3, la única
  corrida sin confundir, la pendiente es de 5 ± 14 MB por ciclo: plana a esta
  resolución.

El supuesto del régimen se cumplió: en L1 el modelo de NER se cargó solo en el
ciclo 1, así que **el mismo worker atendió los diez documentos**. En L2 y L3 se
recargó en cada ciclo, como estaba previsto.

### 1.3 El residuo de una sola vez (pregunta 1)

L3 es la única corrida que mide el reposo con todos los pools ya dados de baja:

| | total | Tab | Browser | GPU | Utility |
|---|---:|---:|---:|---:|---:|
| app recién abierta (ciclo 0) | 441 MB | 135 MB | 171 MB | 87 MB | 47 MB |
| reposo, ciclos 2-10 (mediana) | 611 MB | 427 MB | — | — | — |
| reposo, ciclos 2-10 (rango) | 428-707 MB | 248-493 MB | — | — | — |
| ciclo 10 | 611 MB | 427 MB | 104 MB | 55 MB | 25 MB |

- **El residuo es de ~170 MB en la mediana (entre −13 y +266 MB según el ciclo)**, y es todo del
  renderer: el Tab sube ~290 MB mientras los otros tres procesos bajan ~120 MB,
  achicados por el sistema.
- **No lo retienen los workers**, que están todos terminados, **ni el heap de JS**,
  que subió 2,4 MB entre el ciclo 0 y el 1. Es memoria nativa del proceso del
  renderer. Con estos instrumentos no se puede atribuir más.
- **El sistema lo recupera cuando lo necesita**: en el ciclo 7, con 41 MB libres,
  la app entera quedó en 428 MB, el mismo número que recién abierta. Son páginas
  que la app no está usando.

Esto corrige el orden de magnitud de §1 del plan: los ~370 MB venían de comparar
dos sesiones distintas. Dentro de una misma sesión, el residuo es de ~170 MB, y
no crece.

### 1.4 El heap de JS que crece 0,1 MB por documento

Tres corridas, tres regímenes distintos, la misma pendiente: +0,104, +0,109 y
+0,105 MB por ciclo. Algo en el hilo principal se queda con ~100 KB de cada
documento, aun después de un GC forzado. En la escala de una sesión real no
importa: harían falta ~50 documentos para sumar 5 MB.

**No se sabe si es de la app o del arnés.** Playwright evalúa código en la página
en cada ciclo y el colector de CDP tiene `HeapProfiler` habilitado. Para saberlo
alcanza con comparar dos heap snapshots (ciclo 2 contra ciclo 10). Es barato, pero
no se hizo en esta tanda.

### 1.5 La basura de los primeros segundos

| corrida | RSS en reposo menos RSS tras el GC forzado, por ciclo |
|---|---|
| L2 (6 s tras cerrar, P2) | 119, 270, 546, 279, 352, 416, 172, 457, 375, 353 MB |
| L1 (6 s tras cerrar, P1) | 36, 25, 61, 22, 120, 22, 3, 17, 130, 23 MB |
| L3 (90 s tras cerrar, P1) | entre −6 y +13 MB |

Seis segundos después de cerrar un documento escaneado, **unos 350 MB son basura
que el recolector todavía no pasó a buscar**. A los 90 s ya no está. No es
retención, pero si el documento siguiente se abre enseguida, convive con su pico.
El instrumento guardó el total por instante, no por target, así que **no dice en qué
worker está**.

### 1.6 Los números de L1 a L3

#### L1 — P1 encadenado (6 s entre documentos)

| ciclo | import→Ready | pico | reposo | Tab en reposo | tras GC | heap JS | workers | ¿cargó NER? |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | — | — | 420 | 134 | 419 | 4,5 | 0 | — |
| 1 | 2396 ms | 1.453 | 825 | 604 | 789 | 6,9 | 9 | sí |
| 2 | 518 ms | 806 | 683 | 441 | 658 | 7,3 | 9 | no |
| 3 | 469 ms | 669 | 569 | 344 | 508 | 7,5 | 9 | no |
| 4 | 449 ms | 519 | 550 | 340 | 528 | 7,6 | 9 | no |
| 5 | 436 ms | 544 | 568 | 356 | 448 | 7,8 | 9 | no |
| 6 | 456 ms | 512 | 566 | 354 | 544 | 7,8 | 9 | no |
| 7 | 442 ms | 559 | 534 | 329 | 531 | 7,9 | 9 | no |
| 8 | 442 ms | 543 | 543 | 336 | 526 | 7,9 | 9 | no |
| 9 | 439 ms | 541 | 563 | 351 | 433 | 8,2 | 9 | no |
| 10 | 559 ms | 484 | 545 | 349 | 522 | 8,2 | 9 | no |

#### L2 — P2 encadenado (6 s entre documentos)

| ciclo | import→Ready | pico | reposo | Tab en reposo | tras GC | heap JS | workers | ¿cargó NER? |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | — | — | 439 | 134 | 440 | 4,5 | 0 | — |
| 1 | 16222 ms | 1.561 | 1.228 | 914 | 1.109 | 7,1 | 9 | sí |
| 2 | 15534 ms | 1.865 | 1.517 | 1.239 | 1.247 | 7,5 | 9 | sí |
| 3 | 16019 ms | 1.468 | 1.319 | 1.064 | 773 | 7,8 | 9 | sí |
| 4 | 15881 ms | 1.601 | 1.373 | 1.107 | 1.094 | 7,9 | 9 | sí |
| 5 | 15808 ms | 1.566 | 1.565 | 1.285 | 1.213 | 8,1 | 9 | sí |
| 6 | 15871 ms | 1.719 | 1.572 | 1.270 | 1.156 | 8,1 | 9 | sí |
| 7 | 16105 ms | 1.573 | 1.239 | 984 | 1.067 | 8,1 | 9 | sí |
| 8 | 15722 ms | 2.019 | 1.607 | 1.270 | 1.150 | 8,2 | 9 | sí |
| 9 | 15822 ms | 1.736 | 1.677 | 1.351 | 1.302 | 8,4 | 9 | sí |
| 10 | 15693 ms | 1.850 | 1.633 | 1.307 | 1.280 | 8,5 | 9 | sí |

#### L3 — P1 con 90 s de reposo

| ciclo | import→Ready | pico | reposo | Tab en reposo | tras GC | heap JS | workers | ¿cargó NER? |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | — | — | 441 | 135 | 441 | 4,5 | 0 | — |
| 1 | 2219 ms | 1.400 | 707 | 420 | 707 | 6,9 | 0 | sí |
| 2 | 2287 ms | 1.508 | 704 | 427 | 698 | 7,4 | 0 | sí |
| 3 | 2258 ms | 1.485 | 457 | 272 | 444 | 7,7 | 0 | sí |
| 4 | 2233 ms | 1.329 | 485 | 294 | 481 | 7,8 | 0 | sí |
| 5 | 2196 ms | 1.240 | 617 | 434 | 621 | 7,9 | 0 | sí |
| 6 | 2174 ms | 1.239 | 650 | 468 | 648 | 8,0 | 0 | sí |
| 7 | 2337 ms | 1.367 | 428 | 248 | 424 | 8,0 | 0 | sí |
| 8 | 2053 ms | 1.539 | 585 | 412 | 592 | 8,0 | 0 | sí |
| 9 | 2101 ms | 1.566 | 679 | 493 | 674 | 8,3 | 0 | sí |
| 10 | 2133 ms | 1.313 | 611 | 427 | 606 | 8,3 | 0 | sí |

Memoria en MB (sumas de RSS del árbol de procesos, salvo el heap JS). «Reposo» es
la mediana de la ventana fija tras el cierre (plan §2.4); «tras GC», una lectura
después de forzar la recolección en todos los targets.

Una lectura que **no** se hace: L1 en reposo (~550 MB con el modelo cargado) queda
por debajo de L3 (~610 MB sin nada cargado). Las dos corridas no se intercalaron y
L1 tuvo mucha más presión: es el compresor, no la app (plan de campaña §2bis
punto 8).

---

## 2. T-10 — dos documentos reales

Cuatro perfiles intercalados en una sola sesión, tres rondas, orden alternado
(plan §3.4). Las doce corridas terminaron `ok`, y los conteos de páginas, entidades y
grupos fueron idénticos en las tres rondas de cada perfil. Por la regla de
confidencialidad (plan §3.1), este informe publica solo medidas de tiempo y memoria,
con los tamaños redondeados. **R1 no disparó el OCR en ninguna página**: el parser
informó texto en todas, como había anticipado el humano. R2 pasó entero por OCR.

### 2.1 El tiempo — el resultado firme

Tiempos bajo instrumento: `measureProfile` fuerza un GC por segundo en cada target
(plan §3.4). Sirven para comparar perfiles de la misma sesión, no como tiempo del
producto. La dispersión entre rondas es de pocos segundos, muy por debajo de las
diferencias entre perfiles.

| perfil | páginas | import→Ready, frío (3 rondas) | import→Ready, caliente | OCR por página | NER por página |
|---|---:|---|---|---:|---:|
| P1 (fixture nativo) | 10 | 2,3 / 2,2 / 2,4 s | 0,47 / 0,45 / 0,48 s | — | ~0,05 s |
| P2 (fixture escaneado) | 50 | 17,1 / 17,9 / 17,4 s | 15,0 / 15,5 / 15,3 s | 0,23-0,24 s | 0,05-0,08 s |
| **R1 (real nativo)** | ~50 | 34,8 / 40,9 / 40,5 s | 36,4 / 39,2 / 38,8 s | — | **0,66-0,77 s** |
| **R2 (real escaneado)** | 20 | 46,8 / 48,0 / 49,8 s | 46,6 / 46,9 / 49,1 s | **1,54-1,64 s** | **0,71-0,78 s** |

- **La diferencia es la densidad de texto, no el peso de la imagen.** El OCR
  reconoce una mediana de **~300 palabras por página en R2 y ~20 en el fixture**:
  quince veces más. Con eso el OCR tarda ~7 veces más por página, y NER, que corre
  sobre ese texto, entre 10 y 15 veces más. La confianza del OCR es parecida (0,94 contra 0,96).
- **NER cuesta ~0,7 s por página de texto real**, igual en los dos documentos. En R1
  es el 96 % del tiempo; en R2, un tercio (~15 s), con el OCR en los otros dos tercios
  (~31 s).
- **El fixture subestimaba el trabajo por página.** Todos los tiempos de la campaña
  salen de fixtures con ~20 palabras por página. Esto corrige §4 del plan de campaña,
  que buscaba la diferencia en el peso del archivo: R2 pesa ~30 KB por página, lo
  mismo que el fixture.

### 2.2 La memoria — sin diferencia resoluble

Pico de RSS dentro de las fases (M2), en MB:

| perfil | frío (3 rondas) | caliente (3 rondas) |
|---|---|---|
| P1 | 1.535 / 1.730 / 1.653 | 1.376 / 1.336 / 1.200 |
| P2 | 1.721 / 1.779 / 2.025 | 1.551 / 1.900 / 1.972 |
| R1 | 1.395 / 1.346 / 1.672 | 1.398 / 882 / 1.302 |
| R2 | 1.651 / 1.579 / 1.589 | 2.052 / 1.997 / 2.016 |

Pareado por ronda, contra la resolución de ~350 MB declarada en plan §3.5:

| comparación | frío | caliente |
|---|---|---|
| R2 − P2 | −71, −200, −436 (media −235) | +501, +97, +45 (media +214) |
| R1 − P1 | −140, −384, +20 (media −168) | +22, −454, +102 (media −110) |

Ninguna media pasa la resolución, y los signos se contradicen entre frío y caliente:
**sin diferencia resoluble**. Un documento nativo real de ~50 páginas no tiene más
pico que diez páginas sintéticas, y un escaneo real de 20 páginas no tiene más pico
que el fixture de 50. Es compatible con que el pico lo fije la concurrencia (dos
páginas de OCR a la vez, el modelo de NER) y no el largo ni el contenido.

El pico de RSS **durante el OCR**, en frío, sale más bajo en R2 que en P2 en las tres
rondas (−338, −213, −378 MB; media −310), sin llegar a la resolución. Es compatible
con un ráster más chico (ADR-163: si el escaneo tiene menos de 300 DPI, la app
rasteriza a su resolución), **plausible, no verificado**: no se abre el documento
para comprobarlo.

**Consecuencia para las palancas de memoria**: con este documento, nada de §4 del plan
de campaña cambia de prioridad. Las copias del PDF en los workers de render siguen
siendo chicas (~30 KB por página) y el OCR de páginas reales no sube el pico.

### 2.3 Con un escaneo real, el modelo de NER se recarga siempre

En las tres corridas calientes de R2 apareció `NER_MODEL_READY` (855, 844 y 854 ms de
carga); en las de P2, no. El OCR de R2 dura ~31 s, más que los 15 s de NER
(ADR-167), así que el modelo se libera en medio del OCR y se vuelve a cargar al
terminar. **Es el diseño de ADR-167 funcionando**: mientras corre el OCR, Tesseract
y el modelo no conviven, que es lo que buscaba también ADR-157. Cuesta ~0,9 s por
documento escaneado, el 2 % de su tiempo.

Pero mueve el pico. En las corridas calientes de R2, **el máximo cae en la recarga
del modelo, justo después del OCR** (tramos `OCR_FINISHED → NER_MODEL_READY` y el
siguiente: 2.052, 1.997 y 2.016 MB), no en el OCR (1.888, 1.478 y 1.670 MB). En P2,
que no recarga, el caliente tiene su máximo en el OCR y después de él baja a ~800 MB.

Y eso cambia lo que mide M1. ADR-146 define la corrida caliente como la que tiene
**los modelos ya cargados**. Con un escaneo real ya no es así, y el M1 caliente de R2
(**627, 803 y 641 MB**) incluye una carga completa del modelo. Leído como manda
ADR-146 §7 —un M1 por encima del presupuesto demuestra que no se cumple—, R2 no
cumple los 512 MB en las tres rondas. **Pero el número no mide lo que el presupuesto
supone**, así que el planificador no lo lee ni en un sentido ni en el otro:
queda como pregunta para el humano (§4).

P2, en esta misma sesión: M1 caliente 194, 380 y 314 MB.

### 2.4 El objetivo de 8 s para diez páginas nativas

`07_Performance_Strategy.md` §1 fija **< 8 s de import a Ready para 10 páginas con
texto**. P1 lo cumple con holgura (2,3 s frío), pero P1 tiene texto disperso. Con
~0,7 s de NER por página real, más ~1 s de carga del modelo en frío, diez páginas
reales darían **~8-9 s en frío y ~7-8 s en caliente**.

Es una **extrapolación lineal por página, hecha bajo un instrumento que fuerza un GC
por segundo**, no una medición: el número del producto probablemente sea algo menor.
Para saberlo hay que medir diez páginas reales con `pipeline-timing.spec.ts`, que no
fuerza GC. Lo que sí queda establecido es que **el gate de tiempos, calibrado sobre
fixtures de ~20 palabras por página, no ve el costo de NER sobre texto real**.

---

## 3. Límites

1. **Una sola máquina** (M1, 8 GB) y **bajo presión de memoria fuerte**: 50-700 MB
   libres, swap de hasta 1,1 GB. Es representativo de una notebook de 8 GB con otras
   aplicaciones abiertas, no de una máquina en reposo.
2. **Dos documentos reales**, uno de cada tipo. Otro escaneo (en color, en grises, a
   otra resolución) puede comportarse distinto.
3. **Los tiempos de T-10 son bajo instrumento** (GC forzado por segundo). Las
   proporciones entre perfiles valen; los absolutos no son los del producto.
4. **El heap de JS no ve WASM** (ADR-159 §8). T-9 descarta fugas en JS y en workers
   vivos; una fuga dentro de la memoria de WASM de un worker que sobrevive solo se
   vería en el RSS, y en L1 y L2 el RSS está confundido. L3 la descarta para el ciclo
   con reposo, no para el encadenado.
5. **El residuo de ~170 MB del renderer no está atribuido.** No es JS ni workers, y
   T-11 tampoco lo va a ver: vive en el proceso del renderer, no en un worker.

---

## 4. Lo que queda para decidir

| | qué | quién |
|---|---|---|
| 1 | **El presupuesto de 512 MB con recarga de NER** (§2.3): ¿el M1 caliente de ADR-146 se aplica a un documento cuyo OCR dura más que el temporizador de NER? Si sí, un escaneo real no cumple; si no, hay que redefinir «caliente» para ese caso. | humano; después, enmienda de ADR-146 |
| 2 | **El objetivo de 8 s con texto real** (§2.4): medirlo bien antes de discutirlo. Requiere un documento nativo real de ~10 páginas y `pipeline-timing.spec.ts`. | humano (el documento) |
| 3 | **T-11, el instrumento de WASM** (plan §4). Ahora tiene un blanco preciso: el pico que cae en la recarga de NER justo después del OCR, y los ~350 MB de basura que quedan a los 6 s de cerrar un escaneado. | humano, ya anotado como siguiente paso |
| 4 | **El tiempo de NER sobre texto real** (§2.1). Es la mayor parte del tiempo de un documento nativo, y queda fuera de una campaña de memoria. Si se ataca, necesita plan propio y la guarda de recall de ADR-147. | humano |
| 5 | **Los 0,1 MB por documento del heap de JS** (§1.4): dos heap snapshots dirían si es de la app o del arnés. Barato y de baja prioridad. | planificador, cuando haya lugar |
| 6 | **El gate `test:leak`**: T-9 da con qué construirlo. Tiene que apoyarse en **workers vivos y heap de JS con GC forzado**, que dieron señales limpias en las tres corridas. El RSS no sirve para un gate en este banco: se movió ~250 MB entre dos ciclos idénticos de L3. | planificador, al construir `tests/leak/` |
