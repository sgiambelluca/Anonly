<!-- CONTEXT: scope=roadmap-medicion | tarea=Optimizacion_De_Memoria_Plan.md §2ter punto 2 | dependencias=adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 -->

# Atribución de recursos del renderer — medición

Fecha de la medición: 2026-09-22. Esta entrega cubre únicamente el punto 2 de
`Optimizacion_De_Memoria_Plan.md` §2ter. Se midió el build local fresco de
`hardening/plan-2026-09` en macOS ARM64, con los fixtures reproducibles P1 (10
páginas de texto) y P2 (50 páginas escaneadas). No se usaron documentos reales.

**Actualización del planificador:** la investigación posterior de
[MemoryInfra](Memory_Infra_Viabilidad.md) ya comprobó categorías de buffers y
recursos gráficos en este Electron. Esa investigación precedió a la campaña de
pipeline y al cierre del punto 2 con el alcance medido.
Los datos de este informe corresponden al piloto footprint; no se mezclan con
los controles sintéticos de MemoryInfra.

**Revisión 2026-09-23:** la campaña MemoryInfra de pipeline ya terminó: 14/14
corridas completadas. **Punto 2 cerrado con alcance medido y límites explícitos.**
La validación nativa Windows y su lector de presión quedan como seguimiento
separado, sin dar por probada esa plataforma.
Ver «Campaña de pipeline y revisión del plan» más abajo. No hay cambios de producto.

## Qué se agregó

`tests/perf/support/nativeMemory.ts` consulta `/usr/bin/footprint -f bytes PID`
por proceso. La salida se acepta solo en bytes enteros; un formato inesperado,
un PID inválido, una plataforma distinta de macOS o un proceso que ya no existe
queda como no disponible, nunca como cero. La lectura conserva la huella física,
su pico informado por macOS y las categorías `dirty`, `clean` y `reclaimable`.
`TOTAL` se excluye de las categorías para no sumar subtotales dos veces.

`nativeMemorySampler.ts` observa cada segundo los procesos `Tab` y `GPU`. Cada
muestra guarda el intervalo de pared completo, la suma de las duraciones de los
comandos hijos (que corren en paralelo), sus PID y el resultado por proceso. Las
lecturas no se solapan; el cierre espera la lectura en vuelo y conserva errores.
El sampler es opt-in y no cambia los perfiles históricos de RSS, M1 o M2.

El control sintético separa una reserva tocada de 32 MB de un control de
`canvas + ImageData` de 4096×4096. En la corrida de capacidad, la reserva movió
la huella física del Tab de 38,9 a 71,6 MB y volvió a 36,3 MB después de soltar
referencias y forzar GC. El control de `canvas + ImageData` movió el Tab de 35,9
a 170,9 MB y el GPU de 57,8 a 275,4 MB. Los umbrales del test son tolerancias
del control sintético, no un presupuesto del producto.

## Piloto opt-in

El piloto se ejecutó en serie con:

```text
ANONLY_NATIVE_MEMORY_PILOT=1 pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/renderer-resource-pilot.spec.ts
```

Cada perfil corrió frío → cierre → caliente → cierre, y luego observó 120 s de
reposo. La sonda tomó una muestra por segundo. La espera cubre los temporizadores
de baja de NER de 15 s y el de los demás pools de 60 s. Los reportes sanitizados
quedaron en `.measure/renderer-resources/`; no contienen palabras, nombres ni
rutas de documentos.

| perfil | muestras | ventana | costo medio de una muestra | M2 frío | M2 caliente | M1 caliente | pico posterior a Ready caliente |
|---|---:|---:|---:|---:|---:|---:|---:|
| P1 | 127 | 125,6 s | 145 ms de pared; 196 ms sumados por proceso | 1373 MB | 1320 MB | 6,5 MB | 1336 MB |
| P2 | 157 | 155,3 s | 186 ms de pared; 245 ms sumados por proceso | 2005 MB | 2030 MB | 215 MB | 1228 MB |

M2 y M1 son las métricas RSS definidas por ADR-146 y permanecen separadas de la
huella física. El piloto es una sola corrida por perfil: sirve para validar la
sonda y su costo, no para fijar umbrales ni afirmar diferencias entre perfiles.
El `M1` de P1 no se interpreta como ahorro; es una cota dependiente de la línea
de base y del RSS.

Los máximos físicos observados por proceso fueron, en decimal:

| perfil | Tab | GPU |
|---|---:|---:|
| P1 | 1082 MB | 185 MB |
| P2 | 1552 MB | 1177 MB |

Estos valores no se suman para representar memoria física única. Procesos,
páginas compartidas y asignadores pueden contar las mismas páginas de forma
distinta. La sonda tampoco sustituye la suma RSS de M2.

## Control A/B del overhead de observación

Después del piloto se ejecutó un control acotado con el mismo build, settings y
fixtures, en instancias Electron frescas y en serie. Cada perfil tuvo orden AB y
BA; la única diferencia fue footprint apagado o encendido a 1 s. No hubo reposo
de 120 s, por lo que este control no mide retención ni liberación.

La sesión nueva quedó en `.measure/renderer-resource-overhead/20260922182851-7d788ddb/`
con un manifest que registra el commit `16a61de08128c04d58f29d580534a7c8bb302e12`,
estado dirty, hash SHA-256 de `main.js` y de cada asset del renderer, fixture,
cadencia y relojes. Todas las corridas terminaron `ok`, mostraron el panel y
reportaron presión de sistema disponible; footprint estuvo disponible en sus
cuatro corridas activadas y no produjo errores.

| perfil | comparación | diferencia `with − without` en frío | diferencia `with − without` en caliente | lectura |
|---|---|---:|---:|---|
| P1 | AB | −95 ms; −26 MB M2 | +114 ms; −382 MB M2 | BA dio +147 ms y +11 MB en frío, +75 ms y +357 MB en caliente |
| P2 | AB | +292 ms; +420 MB M2 | +827 ms; +438 MB M2 | BA dio +212 ms y +53 MB en frío, +318 ms y −14 MB en caliente |

Las parejas se contradicen en M2 y el tiempo cambia con el orden. Con n=2 por
condición no hay resolución estadística ni base para atribuir esos deltas a la
sonda; se conservan como control de overhead y evidencia de la dispersión del
banco. La suma de duraciones de los comandos footprint no es latencia de la
muestra: los procesos se consultan en paralelo. La duración de pared de una
muestra fue aproximadamente 145–186 ms en el piloto de reposo, y el control A/B
no fija un costo de producto a partir de ella.

Los reportes del piloto anterior al sampler corregido se conservan como
preliminares y no se mezclan con esta sesión A/B. Aquellos JSON no incluían la
presión del sistema ni un manifest completo; la sesión A/B nueva sí los incluye.
Las corridas anteriores que reutilizaron los nombres `renderer-resources-p1-run0`
y `renderer-resources-p2-run0` pertenecen al mismo piloto exploratorio y no son
réplicas independientes. No se auditó si las muestras de esos archivos antiguos
tenían duplicados del sampler; un archivo sobrescrito se considera una corrida
perdida, no un registro duplicado recuperable, y no se usa como réplica.

## Lectura por fase y qué quedó observable

La sonda permite asociar una muestra a una fase solo cuando el intervalo completo
de la muestra cae dentro de los límites de fase. En el piloto P2 hubo 11 muestras
completas dentro de `OCR_STARTED → OCR_FINISHED` en frío y caliente. Hubo tres
muestras dentro de `NER_MODEL_READY → PIPELINE_READY` en frío. Las fases cortas
de P1 y las transiciones de pocos milisegundos no tuvieron muestras completas a
esta cadencia y quedan como no observables a esta resolución. Las muestras que
cruzan un límite se conservan en la serie, pero no se atribuyen a ese tramo.

La huella física es una observación del proceso que permite separar Tab y GPU y
ver la magnitud de footprint reportada por el SO y categorías del asignador. No identifica si una página
proviene de pdf.js, Tesseract, ONNX, una imagen, un canvas o el runtime de
Chromium. En particular, macOS publicó categorías como `app-specific tag 14` y
`app-specific tag 16` sin una relación documentada con un motor de Anonly.

T-11 sigue siendo la fuente para la demanda de WASM y heap por target: 148 MB por
worker Tesseract en el fixture, 487 MB de WASM de NER y 93,8 MB de heap JS de NER.
La resta histórica tras NER dio 443–626 MB, pero no demuestra una cantidad de
memoria nativa pendiente de identificar: RSS, WASM y heap no son una contabilidad
aditiva equivalente. La sonda footprint aporta otra magnitud por proceso y no
se resta contra WASM ni contra heap. Tampoco corresponde descontar de ese residuo
los ~345 MB de dispersión histórica entre tandas como si fueran un costo fijo.

El control de `canvas + ImageData` demuestra que la huella física puede ver un
backing store grande en Tab y GPU. No se tomó una lectura posterior separada
para probar su liberación, así que el control no demuestra retención ni
liberación del canvas. Es un control de capacidad, no evidencia de que el residuo
de P2 sea ese canvas. La
evidencia histórica de ADR-159 sobre el piso de GPU respalda investigar recursos
de canvas, pero no da una atribución por objeto.

## MemoryInfra: punto 1 de la viabilidad

Revisión final del planificador: control validado en
`.measure/memory-infra-control/20260922231409-413125a4`. El contador específico
`partition_alloc/partitions/array_buffer.allocated_objects_size` dio
0 → 32 → 32 → 96 → 96 → 0 MiB. No se selecciona el máximo entre categorías.
Se verificaron también timeouts, truncamiento UTF-8, limpieza y marcadores
ambiguos/ausentes. La validación sigue acotada al instrumento, no al pipeline.

Se integró una sonda opt-in en `tests/perf/support/memoryInfra.ts` y se ejecutó
el control sintético con `ANONLY_MEMORY_INFRA_CONTROL=1`. La sesión usa el mismo
CDP de la página, solicita `Tracing` con `disabled-by-default-memory-infra`,
recoge los eventos hasta `Tracing.tracingComplete` y conserva el PID del Tab.
El control final tiene seis marcas acumulativas: baseline, `ArrayBuffer` de
32 MiB, canvas 4096², `ImageData` de 64 MiB, WASM de 64 MiB y release con GC
explícito. Las referencias permanecen vivas hasta la etapa de release.

Los tests scoped de la sonda pasaron (15/15) y el control Electron pasó (1/1). El
parser conserva `size`, `effective_size` y `allocated_objects_size` por
separado, convierte solo cadenas hexadecimales con unidades `bytes`, deja
`missing`/`invalid-hex`/`unexpected-units` como no disponible y no suma padres,
hijos ni WASM a RSS. `private_footprint_bytes` se conserva como magnitud
específica de macOS y no se presenta como RSS/PSS. El correlador usa PID y las
ventanas de `clock_sync`; el GUID de la respuesta CDP queda como diagnóstico y
no se usa para casar dumps, porque no coincide con el id exportado. Cada evento
se etiqueta como fragmento de `process_totals`, grafo de allocators o mixto y
los fragmentos no se suman entre sí.

Este control demuestra sensibilidad del instrumento, no atribución de los
443–626 MB ni identificación de motor. Después se ejecutó la campaña P1/P2 y
reposo con pedidos seriales y las tres condiciones de tracing descritas más
abajo. Windows queda como seguimiento separado y la falta de atribución por
motor durante parte de NER se mantiene como límite.

## Candidatos para la revisión del plan

| candidato | evidencia disponible | beneficio esperado | costo/riesgo | decisión de esta entrega |
|---|---|---|---|---|
| Clasificar asignaciones de Chromium | MemoryInfra identifica ArrayBuffer, V8, malloc y recursos gráficos; no todo motor | Permite priorizar categorías con evidencia | Volcados no observables durante parte de NER; categorías compartidas | Investigación y campaña local completadas; no prolongar la campaña para hacer cerrar RSS |
| Revisar retención de canvas/ImageData y GPU | Control sintético sensible; GPU aparece separado | Podría bajar memoria retenida después de Ready/cierre | Puede afectar previews, scroll y calidad; el control no representa el producto | Candidato de prioridad media, sin cambio de producto |
| Cambiar empaquetado de NER | 487 MB WASM + 93,8 MB heap JS; la carga es parcial en CDP | Podría reducir copias transitorias | Requiere compatibilidad y ADR; es el punto 1, posterior a esta revisión | No iniciar todavía |

## Campaña de pipeline y revisión del plan

Medida el 2026-09-22; analizada el 2026-09-23. Artefactos:
`.measure/memory-infra-pipeline/20260922233417626-7326/`.
El manifest conserva commit/dirty, hashes de build e instrumento y hardware;
cada caso conserva runtime, hash del fixture, presión, RSS, pedidos, errores,
traza y categorías. El smoke previo `20260922233229825-7146` queda excluido de
las comparaciones: detectó timeouts y motivó limitar pedidos posteriores.

Se ejecutaron **12 corridas frías**, dos por perfil/condición, en órdenes
off → trace → dumps y dumps → trace → off, cada una en Electron nuevo.
Además hubo **dos corridas de retención**, P1 y P2, con frío → caliente →
cierre y observaciones a 0/15/60/120 s. Las 14 terminaron el pipeline y guardaron
artefactos sin truncamiento. «Pasó» no significa que todos los volcados estuvieran
disponibles: se conservaron explícitamente los fallos de observación.

Los tres brazos usan el mismo collector de eventos, polling de 250 ms, conexión
CDP y RSS a 150 ms. No usan footprint, heap sampler, `queryObjects` ni GC
solicitado por el arnés. No se ha probado ausencia de efectos internos de
MemoryInfra. `trace` no generó fragmentos de memoria automáticamente en este
binario/configuración; no se supone que será así en todas las versiones.

### Efecto del instrumento

Rangos observados, **n=2 por celda**, sin intervalo estadístico. M2 es suma RSS
solo entre import y Ready; el pico posterior se conserva por separado.

| perfil | condición | import → Ready | M2, MB decimales |
|---|---|---:|---:|
| P1 | off | 2131–2348 ms | 1531–1971 |
| P1 | trace | 2067–2117 ms | 1758–1879 |
| P1 | dumps | 2150–2207 ms | 1855–1886 |
| P2 | off | 15699–15893 ms | 1993–2140 |
| P2 | trace | 15730–15802 ms | 2104–2108 |
| P2 | dumps | 15862–15879 ms | 2204–2255 |

No se obtiene un descuento fijo de memoria ni un porcentaje robusto de overhead.
En P1 la diferencia M2 dumps−off cambia de signo según el orden; en P2 es positiva
en las dos parejas, pero de magnitud distinta (64 y 263 MB). Es una señal que
obliga a conservar separadas las corridas instrumentadas, no una calibración
general. Los tiempos tampoco justifican afirmar mejora o costo cero. Las esperas
de la sonda pueden alargar el test sin alargar import→Ready: no confundir ambos.
La presión del sistema cambió y queda registrada; estos M2 no son una regresión
demostrada contra campañas históricas en otro estado del equipo.

### Qué se pudo atribuir

En P2-retención, dos volcados quedaron completamente dentro de OCR y uno dentro
de la carga NER. El pedido etiquetado `cold:pdf` cruzó PDF → OCR (671 ms) y
**se excluye de atribución a una sola fase**. Las etiquetas del pedido no son
autoridad: `observationPhases` conserva la fase al principio y al final.

En la última lectura completa dentro de OCR, el contador
`partition_alloc/partitions/array_buffer.allocated_objects_size` dio **334,6 MB**;
en la lectura temprana de carga NER dio **556,2 MB**. Identifica capacidad de
objetos de esa partición, no residencia ni propietario de cada buffer. No permite
decir que la diferencia sea el archivo del modelo, una copia concreta o una fuga.
El WASM por worker sigue respaldado por T-11/T-12, separado de estos contadores.

Los pedidos posteriores durante NER superaron el límite de 3 s. Se dejaron de
emitir nuevos pedidos durante ese tramo y Ready/hot quedaron no observables por
esta sonda. La misma condición persistió en el intento a 15 s del cierre y la
lectura se recuperó a 60 s. La coincidencia con NER/pools activos no identifica
la causa del bloqueo de un proveedor de Chromium. Los fragmentos parciales de
pedidos fallidos permanecen en raw y no se presentan como desglose completo.

### Reposo sin GC solicitado

MB decimales; `ArrayBuffer` es `allocated_objects_size`, `malloc` y V8 son
`size`, «Tab footprint» es `private_footprint_bytes` reportado por el SO.
**Las columnas no se suman.** Cada perfil tiene una observación por instante.

| perfil / instante | ArrayBuffer | malloc | V8 | Tab footprint |
|---|---:|---:|---:|---:|
| P1 base | 0 | 23,8 | 11,1 | 39,5 |
| P1 cierre +60 s | 0 | 69,1 | 10,6 | 114,2 |
| P1 cierre +120 s | 0 | 37,7 | 10,9 | 73,0 |
| P2 base | 0 | 23,1 | 11,1 | 39,6 |
| P2 cierre +60 s | 0 | 79,7 | 12,9 | 164,0 |
| P2 cierre +120 s | 0 | 53,0 | 12,9 | 132,9 |

ArrayBuffer vuelve a cero en estas lecturas; no desaparece todo el consumo base
ni se demuestra ausencia de fugas para cualquier documento. `malloc` y footprint
siguen cayendo de 60 a 120 s; no adjudicar el remanente a objetos retenidos sin
otra evidencia. El GPU conserva recursos: su categoría `gpu.size` baja en P2 de
2103 MB en la lectura de carga NER a 96,0 MB a 120 s, cercana a 112,1 MB de base;
esa categoría incluye recursos compartidos y no es VRAM física única. Su
footprint a 60 s devolvió 0 pese a tener recursos: se registra como lectura
anómala y no se usa para afirmar liberación física completa.

La suma RSS a 120 s fue 891 MB en P1 y 797 MB en P2. Que esos valores sean mayores
que las categorías anteriores no demuestra una fuga ni valida restar contadores
incompatibles. Los conteos de salida frío/caliente permanecieron en 14 grupos/14
entidades para P1 y 11/13 para P2; eso no sustituye la guarda completa de calidad.

### Decisión del planificador

1. **Cerrar el punto 2 con la investigación y caracterización macOS**, con los
   límites anteriores. No se prolonga la búsqueda para «encontrar 443–626 MB»:
   la premisa contable no representa memoria nativa demostrada.
2. No hay base nueva para implementar limpieza de canvas, reciclado de workers
   o cambios de pools como corrección de una fuga. El comportamiento observado
   incluye buffers transitorios que desaparecen y categorías que decaen después
   del cierre. No descargar símbolos ni abrir otra campaña nativa sin una
   hipótesis más concreta que pueda cambiar una decisión de producto.
3. Mantener **2 → revisión → 1 → 3**. Esta revisión deja como siguiente intervención
   la evaluación de compatibilidad del empaquetado del mismo NER, sustentada en
   los ~580 MB WASM+JS ya conocidos, sin prometer recuperar el residuo ni atribuir
   los 556 MB de ArrayBuffer al modelo. Los puntos **1 y 3 quedan para otra sesión**;
   no se implementa empaquetado ni se amplía el banco en esta entrega.
4. **Seguimiento separado: Windows nativo.** Repetir controles/campaña en ese
   banco y completar su lector de presión. El punto 2 se cierra con evidencia
   macOS; Windows no se declara validado ni se infiere su comportamiento.
   No quedan pruebas locales adicionales necesarias para esta conclusión.

## Límites y siguiente decisión

En el piloto footprint, el sampler de heap existente fuerza GC durante el reposo
al ritmo de su lectura periódica; esa observación es intrusiva y puede afectar
RSS y tiempo. La campaña MemoryInfra posterior no usa ese sampler. La sonda
`footprint` no fuerza GC, y su duración no equivale a impacto de producto: el
control A/B pareado ya ejecutado no resolvió un overhead atribuible con n=2 por
condición. El piloto de 120 s sí mide reposo, pero no es el control A/B de
overhead.

La medición no observó documentos reales ni Windows. No leyó memoria privada/PSS
ni memoria compilada de cada motor. La sonda tomó aproximadamente 145–186 ms de
pared por muestra en este banco; esa duración describe la observación, pero no
demuestra por sí sola impacto en el producto. La cadencia de un segundo pierde
picos cortos y deja transiciones sin muestra; una cadencia más fina podría tener
riesgo de perturbar la corrida y necesita un control específico. La sesión A/B
nueva conserva presión y estado de baseline; los JSON del piloto anterior no.
El lector de presión de Windows sigue sin estar disponible.

**El punto 2 queda cerrado**, con investigación, instrumentación, campaña P1/P2 y
revisión local. La [viabilidad](Memory_Infra_Viabilidad.md) y esta campaña documentan
qué se observa y qué no. Windows y su lector de presión siguen como seguimiento
separado, sin validación nativa. Los puntos 1 y 3 quedan sin iniciar para otra
sesión; el siguiente es evaluar compatibilidad del empaquetado NER, sin atribuirle
un ahorro demostrado.

Validación final de esta entrega: 14/14 casos de campaña, control sintético
Electron 1/1, `pnpm lint`, `pnpm typecheck`, `pnpm test` (2385 tests) y
`pnpm test:contract` (313 tests), todos verdes. No se modificó código de producto,
modelos, perfiles de rendimiento ni presupuestos M1/M2. Los artefactos crudos de
medición permanecen en `.measure/`, fuera de Git; el instrumento reproducible y
los resultados/limitaciones de este informe sí se versionan.
