<!-- CONTEXT: scope=roadmap-plan | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Hilos_NER_Medicion.md,roadmap/Reconocedores_OCR_Medicion.md,roadmap/Optimizacion_De_Rendimiento.md,ui/React_Client.md,core/Contracts.md | audiencia=humanos+IA | fase=11 (revisión provisional de perfiles; curvas NER y OCR, incluidos los brazos de Bajo, medidas en macOS y Windows nativo 2026-09-23 a 2026-09-26; memoria por reconocedor y decisión humana pendientes) -->

# Perfiles de rendimiento — revisión tras las curvas macOS y Windows

## Estado de la decisión

Las curvas permiten **descartar como mejora local** fijar 6 u 8 hilos ONNX
para NER en la Mac medida, y muestran que 3/4 reconocedores OCR aceleran R2
real sin cambiar detecciones. **La repetición en Windows nativo (2026-09-25,
i5-12400 con 12 hilos visibles) cambia el primer punto**: allí 6 y 8 hilos
**aceleran** NER (R1 de 24,3 a 21,2 y 18,6 s, −24 % con 8) con calidad
idéntica, así que el efecto de los hilos depende del hardware y no admite un
valor fijo. La curva OCR va en la misma dirección que en la Mac, con más
ganancia (R2 `Ready` −26,0 % con 4). Ver
[`Hilos_NER_Medicion.md`](Hilos_NER_Medicion.md) y
[`Reconocedores_OCR_Medicion.md`](Reconocedores_OCR_Medicion.md).
Los brazos de Bajo (OCR1, NER 1/2) ya tienen curva en las dos plataformas
(Windows el 2026-09-26, al final de este documento), y en las dos el control
automático de NER resolvió **4 hilos efectivos**.
**No alcanzan para publicar perfiles nuevos**: falta una atribución
concluyente de memoria WASM/native de los brazos OCR. Las dos campañas
midieron tiempo y RSS, pero su cobertura CDP parcial no permite cuantificar
el costo incremental por reconocedor. Esta revisión propone la
forma de la decisión y explicita los huecos; no cambia settings, contratos,
presupuesto ni código de producto.

## Qué configura hoy cada preferencia

`performancePreset` persiste `auto | low | high`. La UI deriva los overrides antes
de crear el Core; un cambio que altera el override sin documento abierto recrea
el Core. `auto` no envía `workerPool` y `buildDefaultEngineConfig` decide con
`navigator.hardwareConcurrency` y `navigator.deviceMemory` cuando está
disponible. La selección `lowResource` usa menos de 4 núcleos o menos de 4 GiB.
El Core no consulta presión ni memoria libre del SO.

| preferencia actual | PDF | OCR | plazas NER | Render | hilos ONNX internos |
|---|---:|---:|---:|---:|---|
| Bajo (`low`) | 1 | 1 | 1 | 1 | selección automática del runtime |
| Alto (`high`) | 4 | 2 | 2 | 4 | selección automática del runtime |
| Automático (`auto`), equipo no `lowResource` | escala con CPU, tope del Core | 2 | 2 | escala con CPU, tope del Core | selección automática del runtime |
| Automático (`auto`), `lowResource` | 2 | 1 | 1 | 2 | selección automática del runtime |

Las **plazas NER no son workers NER ocupados**: el motor recorre páginas de forma
secuencial y el banco observó un solo job a la vez. En la Mac M1 el runtime
eligió 4 hilos internos tanto para el control como para el brazo explícito 4.
Por eso llamar «Alto» a `nerPoolSize = 2` no implica dos inferencias paralelas ni
permite atribuirle el resultado del brazo ONNX 8.

## Matriz candidata

| nivel futuro | ONNX NER | reconocedores OCR | otros pools | evidencia y decisión pendiente |
|---|---|---|---|---|
| Bajo | sin valor nuevo decidido | 1 actual | 1 actual | OCR1 y NER A/1/2 tienen curva en la Mac y en Windows: 1 o 2 hilos NER cuestan 1,5–2,9× en R1 en las dos, y OCR1 casi duplica el OCR de R2. Falta atribución de memoria OCR antes de redefinirlo. |
| Intermedio | automático del runtime | 2 | PDF/Render actuales por capacidad | Ancla existente; NER automático efectivo 4 en la Mac y en Windows, y OCR2 control. |
| Alto | Mac: 6/8 empeoran NER. Windows (12 hilos): 6/8 lo aceleran, hasta −24 % en R1. Depende del hardware | 3 o 4, candidato | sin cambio decidido | En R2, 3 bajó `Ready` 13,7 % en la Mac y 13,8 % en Windows; 4 lo bajó 21,0 % y 26,0 %. En Windows el RSS durante OCR sube con el tamaño del pool (R2 frío 1398 → 1778 MiB de 2 a 4). Falta costo WASM/native atribuible. |
| Automático | resolver a uno de los tres niveles anteriores | valor del nivel resuelto | valor del nivel resuelto | Umbrales y señales por plataforma aún sin validar; no usar cantidad de páginas como señal de carga. |

La matriz es **una propuesta de experimentación**, no valores aprobados. La
Mac sin ventilador puede perder frecuencia; los pares intercalados contienen
la deriva, pero no establecen qué hacer en Windows ni en equipos de 4/16/32
GiB. Los picos de RSS total del OCR tampoco se convierten en «MB por worker».
T-11/T-12 ya midieron **148 MB de WASM por worker** en P2 y **90 MB** en R2
con dos reconocedores (`Ciclos_Y_Documentos_Reales_Medicion.md` §5.2/§6.5).
Esa es una base útil, pero no una curva 2/3/4: no muestra el pico simultáneo
de WASM, heap y otros targets al agregar plazas, ni prueba que el tercer y
cuarto reconocedor sigan en el mismo escalón de memoria. El banco nuevo debe
medirlos por target con CDP, junto con el total de la instancia, mientras
los trabajos están activos; la cifra de 90 MB no se multiplica por cuatro
para aprobar Alto.
Un nivel Alto podría justificar más memoria por una reducción material de
tiempo, siempre que el costo medido, los presupuestos vigentes y la calidad lo
permitan. El presupuesto de imágenes vivas sigue en 128 MiB hasta una campaña
separada.

## Regla de resolución y señales necesarias

La preferencia persistida y el nivel resuelto deben ser campos distintos. Si el
usuario elige Automático, la interfaz puede mostrar «Modo automático —
consumo/rendimiento medio» **solo si** la política resolvió Intermedio y el
Core recibió su configuración efectiva. El texto no debe derivarse de un valor
solicitado que fue reducido o ignorado por el runtime. El nivel, la configuración
efectiva y las razones de resolución deben poder auditarse en tests.

Señales actuales: número lógico de CPU y RAM aproximada cuando
`navigator.deviceMemory` existe. No hay señal contractual de RAM libre, presión,
temperatura ni alimentación para el Core. Una futura resolución automática que
dependa de memoria disponible requiere un canal seguro desde el shell, sin
lecturas del SO en `packages/`, con permiso, ausencia de dato, refresco y
reserva para el SO definidos. Un valor de capacidad instalada no sustituye la
presión actual; tampoco justifica un umbral sin pares de tiempo/memoria por
plataforma. Hasta tener esa evidencia, el comportamiento conservador es el
actual `auto`, sin prometer que eligió un nivel óptimo.

Resolución propuesta al iniciar el Core, **antes** de abrir un documento. Si
cambia una señal mientras hay documento y ediciones abiertas, conservar la
configuración efectiva hasta cerrar y crear la siguiente sesión; mostrar el
nivel realmente vigente, no uno futuro. Evitar redimensionar pools en caliente
sin ADR y tests propios. Una elección manual prevalece hasta que el usuario
vuelva a Automático.

## Migración y puerta de implementación

Un `high` ya persistido significa hoy OCR2, no un futuro OCR4. Para no aumentar
su consumo en silencio, la migración propuesta es **versionada**: `low` legado
se conserva como Bajo; `high` legado se resuelve a la configuración heredada
OCR2 (candidata a Intermedio); `auto` legado conserva selección automática
heredada hasta que la política nueva esté validada. El nuevo Alto requiere
elección explícita o una resolución automática sustentada por la curva. El ADR
de UI/settings debe definir nombre de clave/versión, lectura de datos viejos,
persistencia idempotente y texto de la migración antes de codificarla.

La puerta para ese ADR y el código de producto es:

1. ~~Repetir NER A/4/6/8 y OCR 2/3/4 sobre R1/R2 en **Windows nativo ventilado**,
   con controles intercalados, densidad de caracteres, calidad y cancelación.~~
   **Hecho el 2026-09-25**: calidad exacta y cancelación de 0–1 ms en todos los
   brazos; NER en dirección contraria a la Mac, OCR en la misma.
2. Obtener memoria WASM/native por reconocedor o declarar un límite de memoria
   verificable por otra vía; decidir si 3 o 4 cumple el compromiso de memoria
   y los presupuestos. Si se quiere variar `LiveImageBudget`, hacer otra
   campaña con una variable por vez.
3. Medir las variantes de Bajo y, al menos, los rangos de capacidad entre la
   Mac de 8 GiB y Windows. Las variantes de Bajo ya tienen curva en las dos
   plataformas (2026-09-25 y 2026-09-26, abajo). Definir reserva de SO y reglas cuando falta RAM.
4. Presentar al humano la matriz final, la política automática y la migración.
   Después de su decisión, redactar ADR y actualizar `Contracts.md`, specs de
   motores/UI y tests antes de tocar implementación. ADR-168 a ADR-178 están
   ocupados por otra tarea y no se usarán.

## Cierre de evidencia macOS antes de la pausa por Windows (2026-09-25)

El humano decidió **mantener los perfiles y defaults actuales** mientras falta
Windows nativo. Esta revisión queda **pendiente**, aun si se terminan las
mediciones locales siguientes. No se agregan niveles, clave de settings,
umbrales de Automático ni canal del SO en esta etapa.

El implementador solo puede ampliar el arnés opt-in de `tests/perf/`, sin
cambiar `apps/`, `packages/`, `Contracts.md` ni los specs de producto:

1. **Costo OCR por plaza en esta Mac.** Sobre P2 y R2, medir 2/3/4
   reconocedores con la misma build de Electron y `maxLiveImageBytes=128 MiB`.
   Usar el override de ADR-155 antes del bootstrap y el instrumento CDP de
   T-11 (`support/wasmMemory.ts`), con Paso 0 de validación. Hacer tres rondas
   intercaladas por perfil, una instancia fría por corrida. Registrar por
   target memoria lineal WASM, heap JS, RSS del árbol, cantidad de workers
   OCR observados, pico simultáneo durante OCR y cobertura de targets. Una
   muestra parcial se informa como tal y no se convierte en cero. Medir tiempo
   sin sonda en un brazo control de la misma tanda o usar los pares ya válidos
   de `Reconocedores_OCR_Medicion.md`, siempre separando ambas campañas. No
   dividir un delta de RSS total por el número de workers.
2. **Variante Bajo OCR.** Añadir brazo OCR1 contra OCR2 en P2 y R2, tres
   rondas intercaladas sin sonda para OCR/`Ready`, calidad exacta y ocupación,
   y tres de memoria con el mismo instrumento para costo de WASM. Ejercitar
   cancelación con trabajo activo al menos una vez por brazo en R2. El resto
   de pools permanece igual para aislar `ocrPoolSize`; el perfil `low` completo
   se evalúa por separado y no se confunde con este brazo.
3. **Variante Bajo NER.** En R1/R2, comparar el runtime automático efectivo
   con `numThreads=1` y `2`, manteniendo un solo worker/modelo y todo lo demás
   fijo. Tres rondas intercaladas sin sonda de memoria para NER/`Ready`, y una
   sonda por brazo para hilos efectivos, WASM/heap, calidad exacta y
   cancelación durante inferencia. Reusar el mecanismo de builds experimentales
   y parches reversibles de `run-ner-threads.sh`; cada brazo se identifica por
   digest de build, el árbol de producto se restaura y las mediciones con
   sonda no se mezclan con las de tiempo.

Los PDF reales entran solo por `ANONLY_REAL_DOC_R1/R2`, con nombres neutros;
reportes y logs conservan únicamente agregados, huellas y datos de máquina,
nunca contenido, rutas ni texto. Cada runner serializa las corridas, marca
suspensión/errores como inválidos, conserva salidas parciales y restaura `dist`.
El informe debe distinguir memoria **lineal reservada** de WASM, heap JS,
RSS residente y memoria nativa no atribuible. Un costo de sonda o muestra
faltante queda declarado. La matriz se completa solo para esta Mac de 8 GiB;
rangos de 4/16/32 GiB, reserva para el SO, umbrales de Automático, migración
de settings y publicación de perfiles quedan pendientes de Windows y de una
nueva decisión humana.

### Resultado OCR local

Campaña `tests/perf/run-ocr-pool.sh` con fase `profiles-gap`, salida neutral
`.measure/ocr-pool/profiles-gap-20260925/summary.json`, mismo HEAD y tres
rondas por brazo y corpus. Fueron válidas las 56 corridas; no hubo suspensiones
ni salidas faltantes. Los cuatro brazos conservaron exactamente las huellas de
OCR/NER/Grouping en cada corpus y alcanzaron ocupación OCR de 1/2/3/4,
respectivamente. La cancelación con trabajo activo quedó dentro del SLA en
los ocho pares (0–1 ms medidos).

| corpus | OCR1 `Ready` / OCR | OCR2 | OCR3 | OCR4 |
|---|---:|---:|---:|---:|
| P2, medianas sin sonda | 32,38 / 26,73 s | 16,93 / 11,21 s | 17,00 / 11,40 s | 15,33 / 9,49 s |
| R2, medianas sin sonda | 78,60 / 62,90 s | 48,56 / 31,78 s | 42,75 / 25,56 s | 39,68 / 22,45 s |
| P2, mediana pico RSS del árbol durante OCR | 1388 MiB | 1500 MiB | 1610 MiB | 1750 MiB |
| R2, mediana pico RSS del árbol durante OCR | 1133 MiB | 1249 MiB | 1423 MiB | 1399 MiB |

Los tiempos provienen de corridas sin sonda; las filas de RSS provienen de
tres instancias frías instrumentadas por brazo. En P2, OCR4 redujo `Ready`
aproximadamente 9,4 % respecto de OCR2 de esta tanda, con unos 250 MiB más
de pico RSS total. En R2, la reducción fue 18,3 %; el RSS de OCR4 quedó por
debajo del de OCR3 en esta muestra, por lo que no se infiere una curva de
memoria monótona ni un costo por reconocedor a partir de esos deltas.

La sonda CDP obtuvo cobertura parcial de targets WASM en 23 de 24 corridas de
memoria. También observó raíces de workers con aspecto OCR sin poder
atribuirles formalmente el rol; los picos completos de WASM/heap y el costo
incremental **por reconocedor** siguen sin demostrarse. Las muestras completas
puntuales sirven como cotas observadas, no como pico real simultáneo. La
memoria nativa no atribuible tampoco se calcula restando muestras de RSS y
WASM tomadas en instantes distintos. Se conserva el resultado de tiempo y
RSS con estas limitaciones; la puerta de publicación de perfiles sigue
**pendiente de Windows nativo y de la decisión humana**.

### Resultado NER Bajo local

La fase `low` de `tests/perf/run-ner-threads.sh` completó sobre R1/R2 una
muestra CDP fría y tres corridas sin sonda por brazo A (automático), 1 y 2,
con builds separados y órdenes intercalados. Salida neutral:
`.measure/ner-threads/low-20260925-complete/`. La primera tanda
`low-20260925/` se interrumpió durante el preflight porque el modo `quality`
todavía no activaba CDP; no se mezcla con esta tanda. En la completa, los seis
preflights conservaron exactamente conteos y huellas de ocurrencias y grupos,
ninguna corrida falló o se invalidó, y las seis cancelaciones durante inferencia
activa cumplieron el SLA (0–1 ms observados).

El primer clasificador de hilos contó por error un hijo de OCR como NER en R2.
Los JSON crudos se conservan; `thread-reanalysis.json` en la misma salida
recalcula los seis valores con la regla corregida de memoria WASM compartida
observable en la raíz del worker y luego conteo de hijos de esa raíz.

| corpus | Automático `Ready` / NER | 1 hilo solicitado | 2 hilos solicitados |
|---|---:|---:|---:|
| R1, medianas sin sonda | 39,16 / 38,76 s | 113,31 / 112,91 s | 59,15 / 58,74 s |
| R2, medianas sin sonda | 49,46 / 16,41 s | 78,19 / 44,01 s | 56,19 / 24,14 s |
| Hilos ONNX identificados por CDP en la muestra fría | 4 en R1/R2 | no observable | 2 en R1/R2 |
| Memoria lineal máxima observada del target NER | 464,6 MiB | 463,8 MiB | 464,1 MiB |

La cifra WASM es **una muestra por brazo y corpus**, no un costo incremental
total de la instancia ni una curva con dispersión. El modelo ocupa
prácticamente la misma memoria lineal con los tres valores. La sonda tuvo
targets ilegibles en parte de las muestras y no permite afirmar un pico
simultáneo completo de WASM/heap/nativo. En el brazo 1 no aparecieron pthreads
que permitan confirmar el número efectivo mediante CDP, aunque la configuración
solicitada y el tiempo sí identifican el experimento. En R2 se separan los
workers Tesseract de los de ONNX al contar hilos: un hijo OCR no prueba un hilo
NER. La nueva curva local no favorece reducir los hilos internos para Bajo en
esta Mac; no fija el comportamiento de otros equipos.

**Estado del punto 4:** mediciones locales cerradas; documentación y decisión
de perfiles **pendientes de Windows nativo ventilado** y de la elección humana.
Se mantienen `auto`/`low`/`high`, sus defaults y los presupuestos vigentes.

> **Actualización (2026-09-26):** esta sección se escribió en la Mac mientras
> la repetición Windows todavía corría. Windows ya cubre NER A/4/6/8 y OCR
> 2/3/4 (punto 1 de la puerta, más arriba) y, desde el 2026-09-26, también
> los brazos de esta tanda (sección siguiente). La atribución de memoria por
> reconocedor sigue abierta en las dos plataformas, y la decisión de perfiles
> sigue siendo del humano.

## Brazos de Bajo en Windows nativo (2026-09-26)

Mismas campañas y fases que en la Mac (`run-ocr-pool.sh` con `profiles-gap`,
`run-ner-threads.sh` con `low`), corridas con puertos ad hoc de Windows, no
commiteados: se retiró el gate `Darwin` y la guarda `pgrep`, y la presión y
la detección de suspensión se reemplazaron por un snapshot de memoria y los
eventos de suspensión/reanudación del log del sistema (no hubo ninguno).
Commit `bd6bd92`, i5-12400 con 12 hilos, 16,9 GB. Salidas:
`.measure/ocr-pool/profiles-gap-20260926T045927Z-win/` y
`.measure/ner-threads/low-20260926T045927Z-win/`.

### OCR1/2/3/4

Todas las corridas válidas, sin faltantes. Huellas exactas de OCR/NER/Grouping
entre los cuatro brazos, ocupación OCR 1/2/3/4 y cancelación con trabajo
activo de 0–1 ms en los ocho pares.

| corpus | OCR1 `Ready` / OCR | OCR2 | OCR3 | OCR4 |
|---|---:|---:|---:|---:|
| P2, medianas sin sonda | 36,69 / 31,61 s | 18,69 / 13,64 s | 18,32 / 13,30 s | 16,25 / 11,16 s |
| R2, medianas sin sonda | 75,56 / 64,37 s | 43,92 / 32,68 s | 36,51 / 25,38 s | 32,07 / 21,05 s |
| P2, mediana pico RSS del árbol durante OCR | 1273 MiB | 1830 MiB | 1926 MiB | 2285 MiB |
| R2, mediana pico RSS del árbol durante OCR | 1064 MiB | 1374 MiB | 1535 MiB | 1818 MiB |

Contra OCR2, OCR1 casi duplica el OCR de R2 (1,97×, igual que en la Mac) y
OCR4 lo baja un 35,6 %. **En Windows el RSS sube de forma monótona con cada
reconocedor** en los dos corpus (R2: +310 / +161 / +283 MiB por paso); en la
Mac la curva no fue monótona. La sonda CDP volvió a tener cobertura parcial
de targets WASM (23 corridas de memoria): **el costo por reconocedor sigue sin
demostrarse** y estos deltas de RSS total no se dividen por reconocedor.

### NER Automático/1/2

Seis preflights con conteos y huellas exactas contra Automático, sin fallas
ni corridas invalidadas, y cancelación durante inferencia en 0–2 ms en los
seis brazos.

| corpus | Automático `Ready` / NER | 1 hilo solicitado | 2 hilos solicitados |
|---|---:|---:|---:|
| R1, medianas sin sonda | 24,59 / 24,10 s | 65,68 / 65,19 s | 36,93 / 36,46 s |
| R2, medianas sin sonda | 43,42 / 10,15 s | 58,57 / 25,49 s | 47,95 / 14,71 s |
| Hilos ONNX identificados por CDP | 4 en R1/R2 | no observable | 2 en R1/R2 |

Con el clasificador de hilos corregido, **Automático resolvió 4 hilos
efectivos también en Windows** (la repetición del 2026-09-25 los había dejado
«no observables»). Eso explica la curva de hilos de esta máquina: Automático
usa 4 de 12 hilos disponibles, y por eso pedir 6 u 8 acelera, cosa que en la
Mac no ocurre. Bajar a 1 o 2 hilos cuesta 2,7× y 1,5× en R1, en línea con la
Mac (2,9× y 1,5×). **La nueva curva no favorece reducir hilos para Bajo en
ninguna de las dos plataformas.**
