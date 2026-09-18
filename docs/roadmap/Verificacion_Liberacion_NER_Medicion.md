<!-- CONTEXT: scope=roadmap-medicion | tarea=T-8 | dependencias=adr/ADR-166-El-Modelo-De-NER-Se-Libera-Al-Terminar-La-Deteccion.md,roadmap/AB_Intercalado_Plan.md,roadmap/Perfilado_Base_Caliente_Medicion.md,roadmap/Optimizacion_De_Memoria_Plan.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,roadmap/Instrumento_De_Memoria_Arreglo_Plan.md,tests/perf/README.md | audiencia=planificador+humano | fase=11 -->

# Verificación de ADR-166 — primera tanda, y por qué no alcanza

Ejecutada el 2026-09-18, commit `18d4442` (ADR-166 ya implementado), contra las
tandas del 2026-09-17 en commit `edd2204` (ADR-166 todavía sin implementar). Dos
campañas:

| campaña | qué mide | datos crudos |
| ------- | -------- | ------------ |
| base caliente | qué queda retenido tras cerrar **un** documento, 125 s de observación | `.measure/base-caliente/20260918T033758Z/` contra `.../20260917T215457Z/` |
| M1/M2 | picos y tiempos del **primer y segundo** documento en la misma instancia | `.measure/memory-*.json` contra `.measure/memory-archive-pre-20260918T040835Z/` |

**Es una medición, no un cambio de producto.** No se tocó `packages/` ni `apps/`
para producirla.

## 0. Veredicto, antes de los datos

**El costo está verificado. El beneficio no.**

1. **La liberación se ejecuta.** `NER_MODEL_READY` reaparece en la corrida
   caliente de los tres perfiles, donde antes estaba ausente en las nueve. El
   modelo se da de baja y se recarga, exactamente como especifica ADR-166 §1bis.
2. **El costo declarado quedó bien medido.** El segundo documento tarda **+874 a
   +1127 ms** según el perfil. Los 942,94 ms que ADR-166 §2 declaró caen en el
   medio de ese rango.
3. **El beneficio de memoria —"del orden de 1 GB", ADR-166 Consecuencias— no
   quedó demostrado ni refutado.** Esta tanda **no puede** responderlo: comparó
   dos versiones en campañas de días distintos, que es un método que este repo ya
   había retirado por escrito, con el ruido medido (~345 MB) y del tamaño de la
   diferencia que se quiso leer (~380 MB). Ver §3, que es lo más importante del
   documento.

No se propone revertir ni conservar ADR-166 sobre esta evidencia. La decisión
necesita la campaña A/B intercalada de
[`AB_Intercalado_Plan.md`](AB_Intercalado_Plan.md).

## 1. Lo que sí quedó establecido

### 1.1 El ciclo del modelo se reabre

`phases.NER_MODEL_READY` en la corrida **caliente** (el segundo documento de la
misma instancia de Electron):

| perfil | antes (3 corridas) | después (3 corridas) |
| ------ | ------------------ | -------------------- |
| P1 — 10 p nativas | ausente, ausente, ausente | 4297 / 4260 / 4093 ms |
| P2 — 50 p escaneadas | ausente, ausente, ausente | 30808 / 31054 / 31875 ms |
| P2-dense | ausente, ausente, ausente | 74958 / 77315 / 78544 ms |

Nueve ausencias contra nueve presencias. Ese evento solo se emite si el kernel
reporta `model-ready`, y el kernel hace early-return sin reportar nada cuando el
modelo ya está cargado: su reaparición prueba que hubo un worker nuevo cargando
el modelo desde cero. Es el discriminante de ADR-166 §1bis y salió positivo.

### 1.2 El costo en tiempo

Corrida **caliente**, promedio de 3:

| perfil | antes | después | cambio |
| ------ | ----: | ------: | -----: |
| P1 | 465,0 ms | 1591,7 ms | **+1126,7 ms** |
| P2 | 14 916 ms | 15 940 ms | **+1024,3 ms** |
| P2-dense | 41 736 ms | 42 611 ms | **+874,3 ms** |

Tres perfiles con pipelines de 0,5 s, 15 s y 42 s convergen en un sobrecosto de
~1 s. Eso es lo que se espera de una recarga de modelo: constante, no
proporcional al documento. La corrida **fría** no se movió o mejoró levemente
(−113 / −277 / −748 ms), que es lo correcto: en el primer documento la
liberación ocurre al final y no hay nada que recargar.

**El tiempo es mucho menos sensible a la presión de memoria que el RSS**, y los
tres perfiles coinciden. Este número se considera firme.

### 1.3 M1 se mueve de lugar, como estaba previsto

Corrida caliente de P1: M1 pasa de **6,7 MB** a **940,4 MB** de promedio. No es
una regresión: es que el modelo dejó de estar en la línea de base y pasó a
contarse como memoria atribuible al documento. Es la consecuencia aritmética
directa de ADR-166 sobre la definición de ADR-146 §1, y hay que tenerla presente
antes de comparar cualquier M1 con un presupuesto: **los M1 calientes de antes y
después de ADR-166 no son la misma métrica.**

## 2. Lo que no quedó establecido

El número en disputa es el punto de reposo: cuánta memoria retiene la aplicación
después de cerrar un documento.

P1 con NER activo, proceso Tab (renderer), por corrida:

| | al cerrar | a los 120 s | liberado en la ventana |
| --- | ---: | ---: | ---: |
| antes, run0 | 1128,4 MB | 182,3 MB | 946,0 MB |
| antes, run1 | 1188,0 MB | 322,9 MB | 865,2 MB |
| antes, run2 | 1195,4 MB | 437,4 MB | 757,9 MB |
| después, run0 | 1362,4 MB | 574,1 MB | 788,3 MB |
| después, run1 | 1680,1 MB | 762,1 MB | 918,0 MB |
| después, run2 | 1674,4 MB | 756,3 MB | 918,1 MB |

Leído de frente: **se libera lo mismo** (856,4 MB de promedio antes, 874,8
después), pero todo el brazo "después" está corrido unos 400 MB hacia arriba, en
los dos extremos de la ventana.

Eso admite dos lecturas incompatibles, y esta tanda no las separa:

- **(a)** ADR-166 empeora el punto de reposo en ~380 MB.
- **(b)** El banco del 2026-09-18 estaba en otro régimen y todo el nivel está
  corrido por eso, sin que ADR-166 tenga nada que ver.

**Y hay una tercera lectura, que es la correcta**: con este diseño la pregunta no
tiene respuesta, porque la diferencia observada es del tamaño del ruido entre
tandas que el repo ya tenía medido. Ver §3.2 antes de sacar conclusiones de los
números que siguen.

La presión del sistema al arrancar cada campaña:

| | libres | compresor | swap |
| --- | ---: | ---: | ---: |
| 2026-09-17 (antes) | 203 MB | 2264 MB | 251 MB |
| 2026-09-18 (después) | 1198 MB | 874 MB | 541 MB |

Con el compresor en un punto y con la memoria libre en otro, el mismo trabajo se
acomoda distinto y el RSS lee distinto. Es exactamente el confound que
`Instrumento_De_Memoria_Arreglo_Plan.md` §1 identificó y que ADR-146 §7ter dejó
anotado. La hipótesis (b) no se puede descartar.

### 2.1 Y la dispersión propia tampoco ayuda

Tres corridas **idénticas, del mismo commit y el mismo build**, terminaron en
182,3 / 322,9 / 437,4 MB. Un rango de **255 MB** dentro de la misma condición.

La diferencia que habría que explicar es de ~380 MB: apenas una vez y media esa
dispersión, con n=3 por lado. Aun sin el confound de presión, tres corridas no
alcanzan para sostener esa diferencia.

## 3. El error de método: la regla ya estaba escrita

Durante el análisis se argumentó que la comparación entre campañas era válida
porque **el brazo con NER apagado reproducía entre tandas dentro de 2-3 MB** en
los ocho checkpoints:

| t | 5s | 15s | 30s | 45s | 60s | 75s | 90s | 120s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| antes, NER off | 667,0 | 649,7 | 615,4 | 616,3 | 613,0 | 536,8 | 536,9 | 537,0 |
| después, NER off | 668,4 | 651,1 | 617,7 | 618,6 | 615,0 | 539,0 | 539,0 | 539,4 |

La estabilidad es real. **El argumento es inválido igual**, por dos motivos
distintos, y el segundo es peor que el primero.

### 3.1 Un control insensible al confound no es un control

El brazo con NER apagado reserva ~300 MB y nunca entra en el régimen donde el
compresor de macOS cambia de comportamiento. Que no se mueva entre tandas no dice
nada sobre un brazo que reserva 1,5 GB, que es justamente donde el régimen
importa.

> Un control solo controla una variable si es **sensible** a esa variable. Antes
> de usar uno, preguntarse si el confound que se quiere descartar lo movería. Si
> no lo movería, parece un control y no lo es.

### 3.2 Y comparar tandas separadas ya estaba retirado como método

Esto no es un aprendizaje nuevo. `tests/perf/README.md` lo tiene escrito desde la
campaña de `renderPoolSize`, con el número puesto:

> _«el ruido de M2 ya medido entre tandas (~345 MB — la dispersión pasó de 3.4 %
> a 17.6 % entre dos tandas separadas en el tiempo, con medias casi idénticas:
> variación de entorno, no del producto)»_
>
> _«Con n=3, tres de tres en una dirección ocurre una de cada cuatro veces por
> azar puro»_

Y ADR-146 §7 punto 3 reemplazó la regla al día siguiente de escribirla: la
atribución se hace **dentro** de una corrida, no restando corridas.

Poner los dos números uno al lado del otro deja el resultado de esta tanda en su
tamaño real:

| | |
| --- | ---: |
| diferencia observada entre tandas (punto de reposo, P1) | ~380 MB |
| ruido entre tandas ya documentado para M2 | ~345 MB |
| dispersión intra-condición de esta misma tanda | 255 MB |

**La diferencia que se estuvo interpretando es del tamaño del ruido conocido.**
La lectura honesta de §2 no es «puede ser (a) o (b)»: es que con este diseño
**no hay resultado**, y eso ya se sabía antes de correr.

Lo que se perdió por no releer esa página antes de medir fue una campaña de 27
minutos y un rato de análisis sobre ruido. La regla operativa quedó ahora también
en [`Optimizacion_De_Memoria_Plan.md`](Optimizacion_De_Memoria_Plan.md) §2bis
puntos 7 y 8, que es donde se busca antes de lanzar una medición.

## 4. Un dato que sí acota el problema

Se verificó que las dos campañas son comparables **en el tramo previo a la
liberación**, donde ADR-166 no puede haber actuado todavía. Pico del proceso Tab
antes de `NER_FINISHED`, primer documento de P1:

| | run0 | run1 | run2 | promedio |
| --- | ---: | ---: | ---: | ---: |
| antes | 1295,2 | 1511,8 | 1564,7 | 1457,2 MB |
| después | 1513,9 | 1511,7 | 1540,6 | 1522,1 MB |

Diferencia de 65 MB (4,5 %). Es decir: el banco **no** desplazó el nivel 400 MB
de forma general — durante la carga del modelo los dos brazos llegan al mismo
lugar. Eso debilita la hipótesis (b) pura, pero no la elimina: el régimen de
devolución de páginas puede diferir después del pico sin diferir durante.

Se deja anotado porque acota qué tiene que explicar la campaña siguiente.

## 5. Picos del segundo documento

Promedios de 3, corrida caliente. Se reportan **sin veredicto**: arrastran el
mismo confound que §2.

| perfil | métrica | antes | después | cambio |
| ------ | ------- | ----: | ------: | -----: |
| P1 | M2 pico | 1730,7 | 2746,9 | +1016,2 MB |
| P1 | pico post-Ready | 1748,4 | 2139,1 | +390,7 MB |
| P2 | M2 pico | 2362,9 | 2392,6 | +29,7 MB |
| P2 | pico post-Ready | 1624,8 | 2500,4 | +875,6 MB |
| P2-dense | M2 pico | 2108,7 | 2625,8 | +517,1 MB |
| P2-dense | pico post-Ready | 1651,5 | 2647,6 | +996,1 MB |

Hay una razón estructural para esperar que el pico del segundo documento suba, y
**ADR-166 §1 ya la anticipó sin nombrarla así**: la recarga del modelo ahora
ocurre *dentro* de la ventana del segundo documento, sumándose a lo que el
renderer ya tiene, en vez de estar pagada de antes. Si estos números se
confirman, esa es la consecuencia que ADR-166 no declaró: no solo se paga ~1 s,
también se paga pico.

La campaña A/B tiene que medir esto con el mismo rigor que el punto de reposo.

## 6. Lo que la aplicación hace, medido de cerca

Traza del proceso Tab tras cerrar el documento (P1, NER on, run2), muestreo real:

```
ANTES                          DESPUÉS
t=  0,0s  Tab= 1195,4 MB       t=  0,0s  Tab= 1674,4 MB
t=  1,2s  Tab= 1178,6 MB       t=  1,2s  Tab= 1674,7 MB
t=  1,5s       —               t=  1,5s  Tab=  875,9 MB   <- escalón de -799 MB
t= 15,6s  Tab= 1122,8 MB       t= 15,4s  Tab=  875,8 MB
t= 17,7s  Tab=  914,3 MB       t= 29,8s  Tab=  817,2 MB
t= 60,3s  Tab=  869,1 MB       t= 60,1s  Tab=  768,3 MB
t= 70,4s  Tab=  454,4 MB       t= 70,2s  Tab=  767,0 MB
t=121,0s  Tab=  437,4 MB       t=120,8s  Tab=  756,3 MB
```

Dos observaciones que sobreviven al confound porque son sobre la **forma** de la
curva, no sobre su nivel:

1. **Después de ADR-166 la liberación es un escalón único y temprano** (−799 MB
   en una sola muestra, a 1,5 s del cierre). Antes era una escalera con el paso
   grande cerca de los 60-70 s. Eso es coherente con que el temporizador de
   ADR-080 dejó de ser quien libera.
2. **La devolución no ocurre en el instante de la llamada.** ADR-166 libera al
   cerrar la detección, que en P1 es ~2 s antes del cierre del documento; el
   escalón aparece después. Entre que el código termina el worker y que el
   sistema operativo baja el RSS hay un retraso que el instrumento no explica y
   que **no hay que confundir con "no se liberó"**.

## 7. Límites de esta tanda

1. **Dos campañas separadas por horas, con el banco en estados distintos.** Es la
   causa raíz de todo §2.
2. **n=3 por condición**, contra una dispersión intra-condición de 255 MB.
3. **La primera corrida de M1/M2 se hizo con n=1** y dio números que no
   sobrevivieron a n=3 (el pico post-Ready frío parecía mejorar 450 MB; con n=3
   no mejora). Quedan en `.measure/memory-n1-post166-20260918T041223Z/` como
   registro. Ninguna cifra de este documento sale de esa corrida.
4. **La «base caliente estándar» de ADR-146 §7bis no sirve para esta pregunta.**
   Engancha en la primera meseta de 5 muestras tras el cierre, y después de
   ADR-166 la aplicación se queda quieta un momento arriba antes de liberar: dio
   1945,7 MB de promedio cuando la curva a los 5 s ya estaba en 1172 MB. La
   métrica no está mal para lo que fue diseñada; no es la adecuada acá.
5. **Solo se midió P1 con NER en el eje discriminante.** P2 arrastra el residuo
   de OCR y su diferencial NER on/off cambia de signo entre tandas.

## 8. Qué falta

La campaña A/B intercalada, especificada en
[`AB_Intercalado_Plan.md`](AB_Intercalado_Plan.md): las dos versiones del código
alternadas corrida por corrida en la misma sesión, de modo que el estado del
banco afecte por igual a las dos y la diferencia entre ellas quede limpia.

Hasta que eso corra, ADR-166 queda implementado y con su beneficio **declarado
pero no verificado** — así está anotado en el propio ADR.

> **Corrió el 2026-09-18** ([`AB_Intercalado_Medicion.md`](AB_Intercalado_Medicion.md)).
> La «regresión» de ~380 MB de §2 **no existe**: con A/B intercalado, los dos
> brazos terminan en 864,8 y 866,6 MB. Era el banco. Lo que sí apareció es lo que
> §5 anticipaba: el documento siguiente pica +485 / +636 MB más alto y tarda
> ~1,2 s más. De eso salió ADR-167.
