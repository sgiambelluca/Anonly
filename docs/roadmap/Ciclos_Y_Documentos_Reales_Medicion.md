<!-- CONTEXT: scope=roadmap-medicion | tarea=T-9,T-10,T-11,T-12,T-13 | dependencias=roadmap/Ciclos_Y_Documentos_Reales_Plan.md,roadmap/Optimizacion_De_Memoria_Plan.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 -->

# T-9 a T-13 — Medición: fuga, documentos reales, memoria de WASM, configuración de NER y tiempos reales

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
   medición. **T-13 (§7) lo midió sin instrumento: el resultado se sostiene.**

**T-11 (2026-09-19): la memoria de WASM, por fin medida.** Tesseract ocupa **148 MB
por worker de OCR** y llega a ese techo hacia la página 5: no crece más en 200
páginas. Cuando el modelo de NER se carga, **los workers de Tesseract ya no
existen**. Y el modelo de NER, un archivo de 178,5 MB, ocupa **487 MB de memoria de
WASM** una vez cargado, más ~100 MB de JS en su worker: **es el mayor consumidor de la
app**. Dos palancas quedan descartadas con datos (reciclar Tesseract a mitad del
documento y ordenar la baja del OCR antes de NER), y aparece una nueva: la memoria del
modelo de NER (§5.5).

**T-12 (2026-09-19): ninguna configuración de NER baja su memoria sin cambiar el
modelo.** Se probaron tres, intercaladas sobre R1: una cambia lo que detecta, otra
es un 45 % más lenta, y ninguna mueve los 487 MB. Lo único que queda sin tocar los
pesos es **reempaquetar el mismo modelo** para que no se copie dos veces al cargar
(§6.4). Y con el escaneo real, Tesseract llega a un techo más bajo que con el fixture:
**90 MB por worker** en vez de 148 (§6.5).

**T-13 (2026-09-19): los tiempos reales.** Sin ningún instrumento, R1 tarda **34-40 s**
y R2 **47-49 s** de la importación a `Ready`, casi lo mismo que T-10: el instrumento
no los inflaba. NER cuesta ~0,7 s por página de texto real, y a ese ritmo diez páginas
nativas quedan **al límite del objetivo de 8 s** (§7).

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

## 3. Límites (de T-9 y T-10)

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
| 3 | ~~T-11, el instrumento de WASM~~ — **hecho** (§5). | — |
| 4 | **El tiempo de NER sobre texto real** (§2.1). Es la mayor parte del tiempo de un documento nativo, y queda fuera de una campaña de memoria. Si se ataca, necesita plan propio y la guarda de recall de ADR-147. | humano |
| 5 | **Los 0,1 MB por documento del heap de JS** (§1.4): dos heap snapshots dirían si es de la app o del arnés. Barato y de baja prioridad. | planificador, cuando haya lugar |
| 6 | **El gate `test:leak`**: T-9 da con qué construirlo. Tiene que apoyarse en **workers vivos y heap de JS con GC forzado**, que dieron señales limpias en las tres corridas. El RSS no sirve para un gate en este banco: se movió ~250 MB entre dos ciclos idénticos de L3. | planificador, al construir `tests/leak/` |
| 7 | **La memoria del modelo de NER** (§5.5 y §6): las opciones de sesión ya se midieron y ninguna sirve. Quedan reempaquetar el mismo modelo (§6.4, sin cambiar los pesos) o cambiar de modelo, que el humano no quiere por ahora. | humano |
| 8 | ~~Confirmar el techo de Tesseract con texto real~~ — **hecho** (§6.5): 90 MB por worker. | — |

---

## 5. T-11 — la memoria de WASM por worker

Protocolo: [`Ciclos_Y_Documentos_Reales_Plan.md`](Ciclos_Y_Documentos_Reales_Plan.md)
§4. Medido el 2026-09-19 sobre `0ab098f`, con el mismo banco. Todo sobre fixtures,
sin documentos reales.

### 5.1 El instrumento, y dos sesiones descartadas

Por CDP, en cada target (incluidos los workers de Tesseract anidados y los hilos de
ONNX), `Runtime.queryObjects` sobre `WebAssembly.Memory.prototype` devuelve cada
memoria lineal con su tamaño exacto, sin tocar el producto. El Paso 0 pasó con los
números exactos: una memoria de prueba de **31.457.280 bytes** leída tal cual en el
hilo principal y en un worker anidado, una compartida de **1.048.576 bytes** marcada
como tal, y las tres desaparecen al soltarlas.

Dos cosas del Paso 0 que condicionan la lectura:

- **`queryObjects` fuerza una recolección** en el target que consulta. Con una
  lectura por segundo, toda la corrida tiene un GC forzado por segundo en cada worker,
  como `measureProfile` (ADR-159).
- **Un worker ocupado no contesta.** Cada instante del reporte dice qué targets no
  leyó y se marca **parcial** si falta alguno que no sea un hilo de ONNX, que nunca
  contesta y comparte la memoria de su padre.

La sesión válida es `.measure/wasm/20260919T043611Z/`. Hubo dos anteriores,
**descartadas por defectos del instrumento**, no por sus números: la primera
clasificaba mal a qué worker pertenecía cada memoria, y la segunda leía el heap «sin
GC» de la pregunta 4 en paralelo con una consulta que fuerza GC, con el muestreo
periódico todavía activo. El planificador encontró el segundo al revisar la entrega:
su explicación del «no atribuido» durante la carga de NER era, en realidad, el worker
de NER sin contestar.

### 5.2 Cuánto ocupa cada uno

Memoria lineal de WASM, idéntica en las cuatro corridas (tres de P2 y una de 200
páginas):

| dueño | memoria de WASM | cuándo existe |
|---|---:|---|
| Tesseract, cada worker de OCR (hay dos) | **148,0 MB** | solo durante el OCR |
| OSD de orientación (ADR-164) | 56,4-67,6 MB | solo durante el OCR |
| **NER (ONNX)** | **487,2 MB** | desde que carga el modelo hasta su baja (ADR-167) |
| pdf.js y el resto de los workers | 0 | — |

Además del WASM, el worker de NER retiene **93,8 MB de heap de JS**, vivo y no
basura. El archivo del modelo pesa **178,5 MB** (`bert-base-multilingual-cased-ner-hrl`,
`q8`): cargado, ocupa **2,7 veces** su tamaño en memoria de WASM.

Es la primera medida de la campaña que **la presión del sistema no mueve**: es el
tamaño de la memoria, no lo que el sistema tiene residente. Por eso se repite al byte
entre corridas, algo que el RSS nunca hizo.

### 5.3 Tesseract llega a un techo (pregunta 2)

Cada worker de OCR arranca en 84,7-102,7 MB, llega a **148,0 MB dentro de las primeras
cinco páginas** y **no crece más**: en P2-200p sigue en 148,0 MB en la página 199. El
OSD de orientación queda en 56,4 MB, con un único salto a 67,6 MB en dos corridas.

**Esto descarta reciclar los workers de Tesseract a mitad del documento** (alternativa
B de la bitácora, en espera desde ADR-159 §3): la memoria alcanza su techo en las
primeras páginas y reciclar solo haría pagar la carga otra vez.

**Con una salvedad**: el fixture tiene ~20 palabras por página, y una página real, ~300
(T-10 §2.1). Tesseract podría estabilizarse más arriba con texto denso. El techo existe;
su altura con documentos reales no está medida (§4, punto 8).

> **Medido después, en T-12 (§6.5)**: con el escaneo real, el techo es **más bajo**,
> 90 MB por worker, alcanzado en las primeras páginas. El descarte queda firme.

### 5.4 Qué está vivo en cada momento (preguntas 1 y 3)

> **Corrección de interpretación, 2026-09-22:** la columna histórica «sin
> atribuir» es una resta entre magnitudes diferentes, no una medición directa
> de memoria nativa. Su valor negativo en OCR muestra el límite del balance.
> Las afirmaciones de atribución del texto original debajo no deben usarse para
> prometer ahorro ni descartar efectos de medición. Se conservan datos y lectura
> histórica; el criterio vigente está en
> [MemoryInfra: corrección de la premisa](Memory_Infra_Viabilidad.md).

Memoria del proceso del renderer (Tab), contra lo que el instrumento atribuye. Una
lectura **parcial** no se usa para concluir nada:

| instante | Tab | WASM | heap de JS | sin atribuir | lectura |
|---|---:|---:|---:|---:|---|
| fin del OCR, P2 (run0 / run1) | 761 / 415 MB | 352 / 364 MB | 95 MB | 313 / −44 MB | completa |
| carga del modelo de NER (4 de 4 corridas) | 1.111-1.404 MB | — | — | — | **parcial**: el worker de NER, ocupado |
| `PIPELINE_READY` (4 de 4) | 1.109-1.251 MB | 487 MB | 138-178 MB | 443-626 MB | completa |

- **Cuando NER carga el modelo, los workers de Tesseract ya no existen**: no figuran
  entre los targets vivos, no es que no contesten. ADR-157 hace lo que promete.
  **Ordenar la baja del pool de OCR antes de la carga de NER no ahorraría nada**: ya
  pasa así.
- **El pico de P2 cae en la carga del modelo** en dos de las tres corridas, con el
  worker de NER ocupado y sin dejarse leer; en la tercera, apenas después, con los
  487 MB ya visibles. Lo que sí se sabe es lo que queda
  cuando termina de cargar (487 MB de WASM más ~100 MB de JS) y que el archivo pesa
  178,5 MB. Es **compatible** con que el pico sea el modelo más una copia transitoria
  del archivo durante la carga. **Plausible, no verificado**: ninguna lectura lo ve.
- En P2-200p el pico cae en medio del OCR, con Tesseract a pleno (148 MB por worker más
  el OSD).
- **Después de NER quedan 443-626 MB del Tab sin atribuir**, en lecturas completas. No
  son WASM ni heap de JS. Incluyen los ~135 MB del renderer recién abierto y el residuo
  de ~170 MB que T-9 encontró. El resto es memoria nativa del renderer, que ningún
  instrumento de esta campaña ve.

### 5.5 La palanca nueva: la memoria del modelo de NER

Con esto a la vista, el mayor consumidor de la app **no es Tesseract** (~350 MB, solo
durante el OCR), sino **el modelo de NER**: 487 MB de WASM y 94 MB de JS mientras está
cargado (~580 MB), y probablemente más durante la carga. ADR-167 ya acota cuánto tiempo vive.
Lo que no se miró nunca es **cuánto ocupa**.

Dos caminos, en orden de riesgo:

1. **Opciones de sesión de ONNX que no cambian la salida** (la arena de memoria de CPU,
   los patrones de memoria). Si bajan los 487 MB, es memoria gratis, sin tocar la
   calidad. **No se sabe si transformers.js las deja pasar**: es lo primero a
   verificar.
2. **Un modelo más chico o una cuantización `q4`**: cambian la salida del detector, así
   que necesitan la guarda de recall de ADR-147 y una decisión del humano.

### 5.6 La basura de después de cerrar (pregunta 4) — sin respuesta útil

Seis segundos después de cerrar, con el muestreo pausado y la lectura sin GC hecha
primero, lo que un GC forzado libera en todos los targets es poco: en P2, ~6 MB de
objetos, ~14 MB de heap comprometido y ~11 MB de *backing stores*; en P2-200p, 12, 29 y
78 MB. **No reproduce los ~350 MB de T-9**, y no puede: durante el procesamiento este
instrumento fuerza un GC por segundo, así que la basura no se acumula como en T-9.
Contestarla pide una corrida sin muestreo periódico, con una sola lectura antes y
después del GC a los 6 s. No es retención, y queda con prioridad baja.

### 5.7 Límites

1. **Solo fixtures**, con texto disperso. El techo de Tesseract y el pico de carga de NER
   con documentos reales no están medidos.
2. **Un GC forzado por segundo** durante toda la corrida (`queryObjects` lo fuerza). Los
   tamaños de WASM no dependen de eso; el RSS y los tiempos, sí.
3. **Un worker ocupado no se lee.** El instante más interesante, la carga del modelo, es
   justamente el que el instrumento no ve por dentro.
4. **El tamaño de una memoria de WASM no es memoria residente**: una página nunca tocada
   cuenta en `byteLength` y no en el RSS. Es la demanda, no la ocupación.

---

## 6. T-12 — configurar el modelo de NER sin cambiarlo

Protocolo: [`Ciclos_Y_Documentos_Reales_Plan.md`](Ciclos_Y_Documentos_Reales_Plan.md)
§4bis. Sesión `.measure/ner-opciones/20260919T051758Z/`: cuatro brazos intercalados
sobre R1, tres rondas, trece corridas `ok`, binarios distintos por digest y el árbol del
producto limpio al terminar. Mismas reglas de confidencialidad que T-10: la huella de
entidades es un hash calculado dentro de la app, y acá no se publica ni el hash ni la
cantidad.

### 6.1 Lo que se descartó leyendo el código, sin medir

- **La arena de memoria y los patrones de memoria de ONNX ya están apagados.** ONNX
  Runtime Web los pasa como `!!opción`, que da `false` si no se configuran. Apagarlos
  no ahorra nada; prenderlos no tiene por qué.
- **transformers.js no retiene el archivo del modelo en JS**: el worker de NER tiene
  24 MB de *backing stores*, no 178.

### 6.2 Los tres brazos

| brazo | cambio | memoria de NER (3 rondas) | tiempo de NER (3 rondas) | ¿detecta lo mismo? |
|---|---|---|---|---|
| **A** | ninguno (control) | 487,2 / 487,2 / 487,2 MB | 39,8 / 48,7 / 48,7 s | referencia |
| **B** | `graphOptimizationLevel: "basic"` | 487,2 / 487,2 / 487,2 MB | 43,5 / 49,6 / 47,8 s | **no**, en las tres rondas |
| **C** | sin *prepacking* | 487,2 / 487,2 / 487,2 MB | 43,0 / 44,7 / 47,4 s | sí, idéntico |
| **D** | dos hilos en vez de cuatro | 486,7 / 486,7 / 486,7 MB | **66,4 / 67,1 / 69,1 s** | sí, idéntico |

- **B cambia lo que detecta.** Encuentra la misma cantidad de entidades, pero no las
  mismas: cambian bordes o tipos, siempre igual en las tres rondas, y la suma de
  confianzas baja. **Descartado** por el criterio fijado antes de medir, y además no
  ahorra nada.
- **C no ahorra nada visible** y detecta exactamente lo mismo. Su tiempo cae dentro del
  ruido del control (39,8-48,7 s): no se reclama ni mejora ni empeoramiento.
- **D ahorra medio MB y es ~45 % más lento.** Descartado.

### 6.3 Lo que el instrumento puede y no puede ver acá

**La memoria de WASM crece por escalones del 20 %**: los tamaños sucesivos de
Tesseract en T-11 (84,7 → 102,7 → 123,3 → 148,0 MB) lo muestran exactamente. Un ahorro
más chico que el escalón no cambia el tamaño visible. Con NER en 487,2 MB, el escalón
anterior es de ~406 MB: **ningún brazo ahorró lo suficiente para bajar a ese escalón,
unos 80 MB**. Un ahorro menor, de existir, no se ve.

Lo mismo da, al revés, un dato nuevo: **la demanda real de NER está entre 406 y
487 MB**, porque cruzó el escalón anterior.

El umbral de 20 MB que fijó el plan (§4bis.4) era más fino de lo que el instrumento
resuelve. Se declara acá en vez de ajustarlo en silencio.

### 6.4 Lo que queda sin cambiar los pesos: reempaquetar el mismo modelo

ONNX Runtime Web copia el archivo entero (178,5 MB) dentro de la memoria de WASM para
crear la sesión, arma los pesos a partir de esa copia y la libera. La memoria de WASM
no devuelve lo liberado, así que su máximo carga con las dos cosas. Es compatible con
los 406-487 MB medidos. **Plausible, no verificado.**

Dos formatos del **mismo modelo, con los mismos pesos**, evitan esa doble copia:

- **Datos externos**: el grafo queda en un archivo chico y los pesos van aparte;
  ONNX los lee directo a su lugar.
- **Formato ORT**, con la opción de usar los pesos desde el propio buffer del modelo:
  es el formato que ONNX Runtime recomienda para entornos con poca memoria.

Los dos necesitan convertir el archivo con herramientas de Python fuera del repo, que
serían una dependencia nueva (R-12), y **verificar con la huella de entidades que la
salida sea idéntica**. El ahorro esperado, si la hipótesis de la doble copia es
correcta, es del orden del tamaño del archivo: 100-180 MB. **Es la única palanca de
memoria de NER que no cambia el modelo**, y la decisión es del humano.

### 6.5 T-11 sobre el escaneo real (R2)

Con el build de control, una corrida sobre R2:

| dueño | memoria de WASM | trayectoria |
|---|---:|---|
| Tesseract, cada worker de OCR | **90,0 MB** | 75 MB en las primeras páginas, 90 MB desde la tercera, plano hasta la última |
| OSD de orientación | 56,4 MB | plano |
| NER | 487,2 MB | igual que con el fixture y que con R1 |

- **El techo de Tesseract con texto real existe y es más bajo que con el fixture** (90
  contra 148 MB). Es compatible con un ráster más chico: si el escaneo tiene menos de
  300 DPI, la app rasteriza a su resolución (ADR-163), y T-10 ya había visto el pico
  del OCR de R2 más bajo que el de P2. **Plausible, no verificado**: no se abre el
  documento para comprobarlo. El descarte de reciclar Tesseract queda firme.
- **NER ocupa lo mismo con texto real denso** (R1 y R2) que con el fixture. La
  inferencia sobre páginas de ~300 palabras no hace crecer la memoria: cabe en el
  espacio que dejó libre la copia del archivo.

---

## 7. T-13 — el tiempo real del producto

Protocolo: [`Ciclos_Y_Documentos_Reales_Plan.md`](Ciclos_Y_Documentos_Reales_Plan.md)
§4ter. Sesión `.measure/tiempos-reales/20260919T054313Z/`, doce importaciones `ok`,
**sin ningún instrumento de memoria**: solo los eventos de fase de la app.

### 7.1 Los números

Segundos, de la importación a `Ready`, por ronda:

| documento | primera importación (modelo en frío) | reapertura a los 5 s |
|---|---|---|
| **R1** — nativo, ~50 páginas | 33,7 / 40,3 / 40,3 | 35,1 / 37,9 / 38,0 |
| **R2** — escaneado, 20 páginas | 46,8 / 47,8 / 49,2 | 46,5 / 46,9 / 47,9 |

Por fase, rango de las seis importaciones de cada documento:

| fase | R1 | R2 |
|---|---|---|
| lectura del PDF | 0,2-0,3 s | 0,3-0,4 s |
| OCR | — | 30,7-32,5 s (**1,5-1,6 s por página**) |
| carga del modelo de NER | 0,9-1,0 s, solo la primera vez | 0,8-0,9 s, **siempre** |
| inferencia de NER | 32,4-39,1 s (**0,64-0,77 s por página**) | 14,4-15,3 s (**0,72-0,77 s por página**) |

- **NER es casi todo el tiempo del documento nativo** (96-99 %) y un tercio del
  escaneado, donde el OCR ocupa los otros dos tercios.
- **La reapertura no ahorra casi nada.** En R1, el modelo ya está cargado, pero el
  segundo que se ahorra es chico al lado de 35-39 s de inferencia. En R2 el modelo se
  recarga igual, porque el OCR dura más que los 15 s de NER (ADR-167, T-10 §2.3).

### 7.2 El instrumento no inflaba los tiempos

Con los mismos documentos, T-10 midió 34,8-40,9 s para R1 y 46,8-49,8 s para R2 con un
GC forzado por segundo. Sin instrumento dan 33,7-40,3 s y 46,8-49,2 s: **la diferencia
cae dentro de la dispersión entre rondas**. Los tiempos de T-10 eran, en la práctica,
los del producto.

### 7.3 La primera corrida es la más rápida

En esta sesión y en T-10, la primera importación de R1 es la más rápida (33,7 y
34,8 s) y las siguientes quedan ~15-20 % más lentas. El banco es una **MacBook Air M1,
sin ventilador**, que baja la velocidad del procesador bajo carga sostenida. Es
compatible con eso. **Plausible, no verificado**: el sistema no registró avisos
térmicos. Consecuencia para leer cualquier tiempo de este banco: una corrida aislada
puede salir hasta un 20 % más rápida que en uso sostenido.

### 7.4 Contra los objetivos del producto

`07_Performance_Strategy.md` §1, extrapolando por página a partir de los tiempos
reales (es una extrapolación: ninguno de los dos documentos tiene 10 páginas):

| objetivo | a ritmo de R1 / R2 | lectura |
|---|---|---|
| 10 páginas con texto, **< 8 s** | ~7,4-9,0 s en frío, ~6,5-8,0 s reabriendo | **al límite**: con el procesador ya caliente, lo supera |
| 10 páginas escaneadas, **< 60 s** | ~23-25 s | cumple con holgura |

El objetivo de texto es el que está en riesgo, y el costo es la inferencia de NER sobre
texto real. Con los fixtures del gate (~20 palabras por página) el mismo objetivo se
cumple en 2,3 s, que es por qué nunca apareció.

---

## 8. Por qué no se midió antes sobre un documento real

Pregunta del humano del 2026-09-19. La respuesta tiene una parte de política y una
parte de error del planificador.

**La política era correcta para lo que cubre.** Los fixtures del repo son sintéticos
por regla (`tests/fixtures/README.md`: «sin datos reales», reproducibles,
commiteables). Un gate tiene que poder correr en CI y dar lo mismo en cualquier
máquina, y un documento con datos de personas no puede entrar al repo. Hasta T-10, el
arnés de medición solo sabía abrir fixtures commiteados o generados: **no había forma
de apuntarlo a un archivo privado sin copiarlo al repo**.

**Pero la brecha estaba identificada y no se empujó.** El 2026-09-13 el plan de
campaña (§4) ya decía que el fixture no era un escaneo y que hacía falta un perfil
real. Tres cosas hicieron que quedara como pendiente siete tareas seguidas:

1. **Se lo planteó como un documento *anonimizado*** que tenía que conseguir el
   humano, y anonimizar un expediente real a mano es justamente el trabajo que la app
   viene a hacer. La alternativa que se usó en T-10 —medir el documento real sin que
   salga de la máquina ni entre al repo— no se pensó hasta que el humano ofreció los
   archivos.
2. **Se buscó la diferencia en el lugar equivocado.** El plan suponía que un escaneo
   real pesaba 10-50× más que el fixture y lo trató como un problema de memoria que
   solo bloqueaba dimensionar el DPI. La diferencia real es la **densidad de texto**
   (~300 palabras por página contra ~20), y se paga en **tiempo**: nadie la estaba
   buscando, así que nada la hacía urgente.
3. **El planificador anotó el límite y siguió.** Cada tarea sobre el fixture era
   válida en sí misma, y esa es la trampa: ninguna, sola, justificaba frenar. La señal
   ya existía: un expediente real había encontrado un defecto de render que 57 tests
   en verde no vieron (`tests/fixtures/README.md`).

**Qué cambia**: queda como regla 9 del plan de campaña (§2bis): caracterizar con
documentos reales desde el principio, con el mecanismo de T-10, y dejar los fixtures
para los gates.

---

## 9. Dónde está el cuello de botella del OCR y de NER

Preguntas del humano del 2026-09-19. Se contestan con los eventos de trabajo que T-10 ya
había guardado (`WORKER_JOB_DISPATCHED` y su cierre, por tipo), sin medir nada nuevo. El
OSD tiene un solo worker, así que sus duraciones son exactas; las del reconocimiento
salen de la ocupación promedio de sus dos workers.

### 9.1 La configuración con la que se midió todo

La del producto, sin tocar: preset `auto` (`buildDefaultEngineConfig`) sobre un M1 de 8
núcleos, 4 de rendimiento y 4 de eficiencia.

| pool | tamaño efectivo | hilos adentro |
|---|---:|---|
| reconocimiento de OCR (Tesseract LSTM) | **2 workers en paralelo** | 1 cada uno (tesseract.js no usa hilos) |
| orientación (OSD, ADR-164) | 1 compartido | 1 |
| render (pdf.js) | 4 | 1 cada uno |
| NER | **1 worker** | **4 hilos de ONNX** (el worker más 3 hilos que comparten su memoria) |

### 9.2 El OSD no frena al OCR: el cuello de botella es el reconocimiento

| | OSD por página | reconocimiento por página y worker | ocupación del OSD | ocupación de los 2 reconocedores |
|---|---:|---:|---:|---:|
| P2 (fixture) | 133-142 ms | 412-441 ms | 65 % | **95-96 %** |
| **R2 (escaneo real)** | **255-274 ms** | **2.969-3.128 ms** | **18-19 %** | **98 %** |

- **El OSD es entre 3 y 11 veces más rápido que el reconocimiento**: 3× con el fixture,
  11,5× con el escaneo real.
- **Los dos reconocedores están ocupados el 98 % de la etapa**; el OSD, el 18 %. El
  OSD compartido nunca deja esperando a los reconocedores, así que **un OSD por
  reconocedor no haría el OCR más rápido**: sumaría ~56 MB de WASM y otra carga de
  Tesseract a cambio de nada. ADR-164 queda más justificado con el documento real que
  con el fixture.
- Para acortar el OCR, la palanca está en los reconocedores: más workers (cada uno
  suma 90-148 MB de WASM) o menos trabajo por página. Hoy hay CPU libre durante el OCR:
  los reconocedores ocupan dos núcleos de ocho, y el render y el OSD trabajan de a
  ratos.

### 9.3 NER: un worker, cuatro hilos, una inferencia a la vez

- **El pool de NER crea un solo worker** (bitácora §5.4): `NerEngine` recorre las
  páginas con un `for`/`await`, así que nunca hay dos trabajos de NER a la vez.
- **Adentro de ese worker sí hay paralelismo real**: ONNX Runtime corre con cuatro
  hilos (`min(4, núcleos/2)`) que reparten entre sí las multiplicaciones de matrices
  de **cada** inferencia. Son los tres `thread-pool-worker-1/thread-*` que ve CDP.
  transformers.js, además, encadena las inferencias de un mismo worker: nunca corre dos
  a la vez.
- **Los hilos trabajan**: con dos en vez de cuatro, NER tardó ~48 % más (T-12, brazo D).
  La escala no es perfecta —duplicar los hilos no duplica la velocidad—, pero es real.

Caminos para acortar NER sin cambiar el modelo, **ninguno medido todavía**:

| camino | memoria | salida | qué se espera |
|---|---|---|---|
| más hilos de ONNX (6 u 8) | +~0,5 MB | idéntica (T-12 mostró que los hilos no la cambian) | **incierto**: los 4 núcleos que se sumarían son los de eficiencia |
| varios fragmentos de texto por inferencia | similar | a verificar con la huella | mejor aprovechamiento de cada multiplicación; cambia el protocolo del worker (ADR) |
| correr NER de una página mientras el OCR procesa las siguientes | **+400-500 MB de pico** (Tesseract y ONNX a la vez) | idéntica | hasta ~15 s menos en R2 (el tiempo de NER); la precarga ya se descartó por memoria (plan de campaña §5 punto 4) |
| un segundo worker de NER | **+~580 MB** | idéntica | poco: los dos competirían por los mismos núcleos |
