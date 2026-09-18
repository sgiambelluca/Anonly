<!-- CONTEXT: scope=roadmap-medicion | tarea=T-8 | dependencias=roadmap/AB_Intercalado_Plan.md,roadmap/Verificacion_Liberacion_NER_Medicion.md,roadmap/Optimizacion_De_Memoria_Plan.md,adr/ADR-166-El-Modelo-De-NER-Se-Libera-Al-Terminar-La-Deteccion.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,tests/perf/README.md | audiencia=planificador+humano | fase=11 -->

# T-8 — Medición: A/B intercalado sobre la baja del modelo de NER

Ejecutada el 2026-09-18 sobre el commit `e2e6d3e` en dos sesiones independientes,
con el protocolo de [`AB_Intercalado_Plan.md`](AB_Intercalado_Plan.md):

| sesión | brazos | datos crudos |
| ------ | ------ | ------------ |
| 1 (mañana) | A, B | `.measure/ab-intercalado/20260918T051832Z/` |
| 2 (tarde) | A, B, C | `.measure/ab-intercalado/20260918T170454Z/` |

- **A** — el código de ADR-166: el pool de NER se da de baja al cerrar la detección.
- **B** — A menos esa única línea: la memoria la libera el temporizador de 60 s,
  como antes de ADR-166.
- **C** — A sin la baja inmediata y con un temporizador propio de **15 s** para el
  pool de NER. Agregado a pedido del humano después de la sesión 1.

**Es una medición, no un cambio de producto.** Los brazos B y C son parches que se
aplican, se construyen y se revierten antes de medir; el árbol nunca quedó en otro
estado que A. La decisión que salió de acá es ADR-167.

## 0. Veredicto, antes de los datos

1. **ADR-166 cumple la mitad de lo que prometió.** Suelta **~450 MB** durante los
   primeros ~70 s después de cerrar un documento —no «del orden de 1 GB»— y después
   los dos caminos terminan en el mismo lugar. Replicado en las dos sesiones.
2. **La otra mitad sale al revés.** Al abrir otro documento enseguida, ese documento
   tarda **+1,2 s** y **pica +485 / +636 MB más alto**: la recarga del modelo cae
   dentro de su ventana. ADR-166 prometía que ese punto de partida bajaba.
3. **C se queda con casi todo el beneficio de A y con ninguno de sus costos.** Desde
   los 30 s está igual que A; al encadenar documentos no recarga (+8 ms contra B).
4. **Apareció un defecto que no es de ningún brazo**: la recarga posterior a una
   liberación **por temporizador** no emite `NER_MODEL_READY`. Existe desde ADR-080;
   con C pasaría a ser el caso común, así que ADR-167 lo arregla junto con el cambio.

## 1. Cómo se garantizó que cada brazo fuera el que decía ser

El mecanismo intercambia el `dist` ya construido entre corrida y corrida en vez de
reconstruir, y eso **anula `checkFreshBuild`** (plan §4.1). Se reemplazó por tres
verificaciones, y las tres pasaron en las dos sesiones:

1. **Digests distintos por brazo**, calculados sobre el contenido y no sobre la
   ruta (se verificó aparte que una copia da el mismo digest que el original).
   A = `5fa22c4b…`, B = `89748b7e…`, C = `480bc1e6…`. **Los de A y B fueron
   idénticos en las dos sesiones**: el build es determinista, así que se midió
   exactamente el mismo binario dos veces.
2. **El digest del `dist` activo se recalcula antes de cada corrida** y tiene que
   coincidir con el del brazo anunciado. Ninguna discrepancia en ninguna corrida de las dos sesiones.
3. **Pre-vuelo de comportamiento por brazo** (ADR-149 §2): dos documentos
   seguidos, y `NER_MODEL_READY` en el segundo tiene que **aparecer** en A (recargó)
   y **faltar** en B y C (el modelo seguía cargado). Pasó en los cinco pre-vuelos.

Además: una corrida de calentamiento por sesión, **descartada por protocolo** y no
por su resultado; el agente no analizó nada mientras corrían (plan §5), y la presión
de memoria del sistema quedó pareja entre brazos, que es lo que el intercalado
garantiza.

## 2. Paso 0 — la sonda: negativa

Pregunta (plan §2ter): ¿se puede leer el tamaño del heap de WASM sin preguntarle al
sistema operativo? ADR-159 §8 ya había cerrado la vía de `Runtime.getHeapUsage`.

**`performance.measureUserAgentSpecificMemory()` no está disponible en esta
aplicación.** `crossOriginIsolated` es `true` y la función existe, pero al llamarla
el runtime la rechaza: *«performance.measureUserAgentSpecificMemory is not
available»*. El control confirmó que la memoria de prueba (31,46 MB) estaba montada,
así que el negativo es de la API y no del montaje. La causa probable es que la app
se sirve por un protocolo propio (`app://`, ADR-130/132): **plausible, no
verificado**.

La otra vía quedó identificada pero no construida, porque excedía el tope de 20
minutos: `shared/src/worker-entry.ts` es común a todos los workers, y un parche ahí
podría envolver `WebAssembly.Memory` y registrar cada memoria lineal con su
`byteLength` exacto, sin depender de que ONNX Runtime exponga nada. Queda escrita
para quien la necesite.

Como decía el plan, la campaña corrió con RSS emparejado y la resolución declarada.

## 3. Sesión 1 — A contra B

### 3.1 Punto de reposo tras cerrar un documento (P1 con NER, 6 pares)

Ventaja de A = B − A, pareada por par:

| t | A | B | ventaja de A | signos |
| --- | ---: | ---: | ---: | --- |
| 5 s | 990,3 | 1444,4 | **+454,1 ± 30,2** | 6/6 |
| 15 s | 979,9 | 1435,8 | **+455,9 ± 31,1** | 6/6 |
| 30 s | 940,7 | 1338,3 | **+397,6 ± 38,9** | 6/6 |
| 45 s | 937,6 | 1335,0 | **+397,4 ± 38,6** | 6/6 |
| 60 s | 938,4 | 1338,0 | **+399,6 ± 38,7** | 6/6 |
| 75 s | 864,1 | 866,3 | +2,2 ± 14,4 | mixtos |
| 90 s | 864,4 | 866,4 | +2,0 ± 14,4 | mixtos |
| 120 s | 864,8 | 866,6 | +1,8 ± 14,3 | mixtos |

MB; ± es el error estándar de la diferencia pareada. Tiempo del pipeline con un solo
documento: A 2183 ms, B 2241 ms — no se movió.

**Esto refuta la «regresión» de la primera verificación**
([`Verificacion_Liberacion_NER_Medicion.md`](Verificacion_Liberacion_NER_Medicion.md)):
los dos brazos terminan en 864,8 y 866,6 MB. Aquellos ~380 MB eran el banco.

### 3.2 El documento siguiente (4 pares, ~1,3 s entre documentos)

| métrica del 2° documento | A | B | costo de A | signos |
| --- | ---: | ---: | ---: | --- |
| M2 pico | 1870,4 | 1385,9 | **+484,6 ± 117,4** | 4/4 |
| pico post-Ready | 1853,8 | 1394,2 | **+459,6 ± 129,2** | 4/4 |
| tiempo | 1765,8 ms | 509,5 ms | **+1256,2 ± 31,5 ms** | 4/4 |
| M1 | 537,3 | 7,0 | +530,3 ± 34,8 | 4/4 |

`NER_MODEL_READY`: presente en las 4 corridas de A, ausente en las 4 de B. La base
del segundo documento salió mixta (−45,8 ± 117,8), pero es la métrica del enganche
que ya se había declarado frágil (`Verificacion_Liberacion_NER_Medicion.md` §7
punto 4); acá mandan pico y tiempo, que se miden durante el pipeline.

M1 sube por definición, no por regresión: con A el modelo deja de estar en la línea
de base y pasa a contarse como memoria atribuible al documento.

## 4. Sesión 2 — A, B y C

### 4.1 Punto de reposo (6 rondas A/B/C)

Promedios por brazo, MB:

| t | A (baja inmediata) | B (60 s) | C (15 s) |
| --- | ---: | ---: | ---: |
| 5 s | 976,7 | 1432,3 | 1452,7 |
| 15 s | 965,8 | 1418,4 | 1443,4 |
| 30 s | 928,7 | 1303,2 | 915,8 |
| 45 s | 925,7 | 1299,5 | 907,6 |
| 60 s | 927,0 | 1302,2 | 909,1 |
| 75 s | 855,1 | 837,6 | 835,7 |
| 90 s | 855,1 | 837,8 | 789,1 |
| 120 s | 855,5 | 838,3 | 788,5 |

Diferencias pareadas por ronda:

| t | B − A (lo que A ahorra) | C − A (lo que C cede frente a A) | B − C (lo que C ahorra) |
| --- | ---: | ---: | ---: |
| 5 s | +455,7 ± 65,4 (6/6) | +476,0 ± 60,2 (6/6) | −20,4 ± 79,8 (mixtos) |
| 15 s | +452,6 ± 61,8 (6/6) | +477,6 ± 57,9 (6/6) | −25,0 ± 73,1 (mixtos) |
| 30 s | +374,5 ± 40,6 (6/6) | −12,8 ± 6,9 (mixtos) | **+387,4 ± 39,0 (6/6)** |
| 45 s | +373,9 ± 40,8 (6/6) | −18,1 ± 7,6 (mixtos) | **+391,9 ± 38,0 (6/6)** |
| 60 s | +375,2 ± 40,5 (6/6) | −17,8 ± 7,2 (6/6 −) | **+393,0 ± 38,0 (6/6)** |
| 75 s | −17,5 ± 22,3 (mixtos) | −19,3 ± 6,5 (6/6 −) | +1,9 ± 16,9 (mixtos) |
| 90 s | −17,3 ± 22,3 (mixtos) | −66,0 ± 46,4 (6/6 −) | +48,7 ± 53,6 (mixtos) |
| 120 s | −17,2 ± 22,4 (mixtos) | −67,0 ± 46,2 (6/6 −) | +49,8 ± 53,6 (mixtos) |

Lectura:

- **Hasta los 15 s, C se comporta como B**: retiene el modelo, porque su temporizador
  todavía no disparó.
- **Desde los 30 s, C está igual que A**, e incluso unos 13-18 MB por debajo. La
  grilla de checkpoints no permite ubicar la baja de C con más precisión que «entre
  los 15 y los 30 s».
- **A los 90-120 s, C queda ~67 MB por debajo de A** con los seis del mismo signo.
  **No se lee**: está por debajo de la resolución de ~250 MB que el plan comprometió
  de antemano (§2bis). Si alguien quisiera explorarlo, es compatible con la idea de
  que soltar el modelo con el renderer quieto devuelve páginas más limpio que
  soltarlo con el pipeline en marcha — y es exactamente el tipo de lectura que este
  informe se compromete a no hacer con este tamaño de efecto.

Tiempo del pipeline con un solo documento: A 2190, B 2204, C 2209 ms. Presión al
arrancar cada corrida, memoria libre promedio: A 542, B 369, C 254 MB.

### 4.2 El documento siguiente (4 rondas, ~1,3 s entre documentos)

| métrica del 2° documento | A | B | C | A − B | C − B |
| --- | ---: | ---: | ---: | ---: | ---: |
| M2 pico | 1976,4 | 1341,0 | 1539,8 | **+635,5 ± 78,9 (4/4)** | +198,9 ± 96,8 (mixtos) |
| pico post-Ready | 1955,6 | 1358,9 | 1552,8 | **+596,7 ± 99,7 (4/4)** | +194,0 ± 95,1 (mixtos) |
| tiempo | 1634,8 ms | 457,5 ms | 465,5 ms | **+1177,2 ± 33,3 ms (4/4)** | +8,0 ± 12,4 ms (mixtos) |

Recarga del modelo en el segundo documento: A 4/4, B 0/4, C 0/4.

**El +199 MB de C es ruido, y hay una razón fuerte para decirlo.** B y C ejecutan
**el mismo código** en esta ventana: la única diferencia entre ellos es un
temporizador de 15 s que en 1,3 s no llega a disparar. Por ronda:

| ronda | A | B | C | C − B |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1929,4 | 1249,7 | 1243,2 | −6,5 |
| 2 | 2114,7 | 1354,0 | 1814,2 | +460,1 |
| 3 | 1885,7 | 1188,7 | 1346,1 | +157,4 |
| 4 | 1975,9 | 1571,4 | 1755,9 | +184,5 |

Eso convierte a B contra C en un **control A/A involuntario**: dos brazos que
tendrían que dar igual difirieron hasta 460 MB en una ronda. Dice cuánto ruido
tiene el pico del segundo documento con cuatro rondas, y obliga a leer el costo de
A con cuidado. Se sostiene igual, por tres motivos: sale 4/4 en las dos sesiones,
su promedio (+485 / +636) está bien por encima del de la comparación nula (+199), y
tiene un mecanismo detrás —la recarga, verificada por el evento y por el tiempo—.

## 5. La recarga muda

Midiendo C había que saber qué pasa cuando el temporizador **sí** dispara entre dos
documentos, que es el uso real de quien revisa. Se agregó al pre-vuelo una espera
configurable con el primer documento todavía abierto (`ANONLY_AB_GAP_MS`), y se
corrió con 20 s:

| 2° documento tras 20 s de revisión | tiempo | `NER_MODEL_READY` |
| --- | ---: | --- |
| A, ronda 1 / 2 | 2130 / 2091 ms | sí / sí |
| B, ronda 1 / 2 | 470 / 471 ms | no / no — no hubo recarga |
| **C, ronda 1 / 2** | **2065 / 1983 ms** | **no / no — hubo recarga** |

C tarda lo mismo que A —recargó el modelo— y no emite el evento. La causa está en
el código y es directa: el temporizador de ADR-080 llama a
`WorkerPool.releaseIdleWorkers()` sin avisarle al motor, `modelWarm` queda en `true`
con los workers ya terminados, y la dedup silencia la recarga.

**No lo introdujo C.** Con 60 s pasaba lo mismo cada vez que alguien revisaba un
documento más de un minuto. Estaba latente porque nunca se había medido una recarga
posterior a una liberación por temporizador. ADR-167 §3 lo arregla.

Una salvedad del instrumento: el arnés no registra `NER_MODEL_LOADING` como fase,
así que su ausencia en esta tabla no es evidencia de nada. Todo lo que se afirma
sobre la recarga muda sale de `NER_MODEL_READY` más el tiempo.

Y una consecuencia para las etapas 2: **en B y C, la ausencia del evento no prueba
por sí sola que no hubo recarga** —podría haber sido muda—. Lo prueba el tiempo:
+8 ms contra +1177 ms de A. Con 1,3 s entre documentos, además, ningún temporizador
llega a disparar.

## 6. Qué tan firme es

**Replicación entre sesiones**, A contra B, mismo binario:

| | sesión 1 | sesión 2 |
| --- | ---: | ---: |
| ahorro de A a los 5 s | 454,1 | 455,7 |
| ahorro de A entre 30 y 60 s | 397-400 | 374-375 |
| ahorro de A desde los 75 s | ~0 | ~0 |
| recarga en el 2° documento | +1256 ms | +1177 ms |
| pico del 2° documento | +485 MB | +636 MB |

**El método funcionó como se esperaba.** La dispersión intra-brazo a los 120 s bajó
a un rango de 67-87 MB (sesión 1), contra los 182 / 323 / 437 MB que daban tres
corridas idénticas cuando se comparaba entre tandas. La sesión 2 corrió con el
banco más cargado (load 3,5 al arrancar, menos memoria libre) y los errores
estándar a los 5 s casi se duplicaron (±65 contra ±30), pero los efectos siguieron
6/6 y a más de siete errores estándar.

**La resolución comprometida se respetó.** Todo efecto que este informe afirma
supera holgadamente los ~250 MB del plan; lo que queda por debajo se reporta sin
dirección.

## 7. Límites

1. **Un solo perfil, P1** (10 páginas de texto nativo). Sin OCR de por medio es el
   discriminante limpio, pero no dice qué pasa con documentos escaneados.
2. **Una sola máquina**, M1 de 8 GB. Nada de esto se extrapola a otro hardware.
3. **La etapa 2 tiene cuatro rondas por brazo**, con una resolución peor que la de
   la etapa 1: el A/A involuntario mostró hasta 460 MB de diferencia en una ronda.
4. **El valor de 15 s de C no está optimizado.** Se midió que el mecanismo funciona
   con ese valor, no que sea el mejor.
5. **El patrón de uso real sigue sin medir**: cuánto tarda un usuario entre terminar
   un documento y abrir el siguiente. Es lo que decide qué brazo gana, y el producto
   no lo recolecta.
6. **El fixture sigue sin ser un escaneo real** (plan de campaña §4).

## 8. El arnés

Todo en `tests/perf/`, sin tocar `packages/` ni `apps/`:

| archivo | qué hace |
| ------- | -------- |
| `wasm-heap-probe.spec.ts` | Paso 0; registra el negativo con su control |
| `ab-release-curve.spec.ts` | una curva de base caliente por invocación, etiquetada por brazo |
| `ab-preflight.spec.ts` | pre-vuelo discriminante; también mide la etapa 2 y acepta una espera de revisión |
| `support/ab-sin-baja-ner.patch` | brazo B |
| `support/ab-timer-15s-ner.patch` | brazo C |
| `run-ab-intercalado.sh` | construye los brazos, verifica, pre-vuela y alterna (`ANONLY_AB_ARMS`, `ANONLY_AB_PAIRS`) |
| `run-ab-etapa2.sh` | etapa 2 sobre los `dist` ya construidos por la etapa 1 |

El script es portable a propósito (plan §8): `os.loadavg()` en vez de `sysctl`,
`shasum` o `sha256sum` según haya, sin `rsync`.

**Lo que falta del arnés, dicho de frente**: el agregador pareado que el plan §10
listaba (`support/aggregateAbReports.ts`, con sus tests) **no se construyó**. El
análisis de este informe se hizo aparte y sus cifras están transcriptas acá, que es
lo que exige el plan de campaña §2bis punto 6; pero quien vuelva a correr T-8 no
puede reproducir el análisis desde el repo. El script lo invoca solo si existe.

**Los parches de los brazos aplican sobre `e2e6d3e`** y dejan de aplicar cuando se
implemente ADR-167, que saca justo las líneas que parchean. Es lo esperable: son
artefactos de esta campaña. `git apply --check` lo detecta y el script aborta antes
de construir nada, en vez de medir un brazo equivocado.

Una lección que queda en el propio script: la primera corrida de tres brazos abortó
en el segundo 1 por una variable que quedó sin definir al generalizarlo, y `set -u`
la frenó antes de construir nada. Sin esa opción habría corrido con un parche vacío.

## 9. Verificación de ADR-167, una vez implementado

Los tests unitarios prueban las dos mitades por separado —el temporizador del
pool avisa, el motor escucha—, pero del lado del motor lo hacen con un pool falso.
La cadena entera se verificó en la app empaquetada con el mismo experimento que
destapó el defecto (`ab-preflight.spec.ts`, commit `a9c0ac7`):

| 2° documento | tiempo | `NER_MODEL_READY` |
| --- | ---: | --- |
| tras 20 s de revisión, ronda 1 / 2 | 2019 / 2026 ms — recarga | **sí / sí** |
| ~1,3 s después, ronda 1 / 2 | 472 / 442 ms — reusa el modelo | no / no |
| *brazo C antes del arreglo, tras 20 s* | *2065 / 1983 ms* | ***no / no — muda*** |

La recarga ahora avisa, y quien encadena documentos sigue sin pagarla.
