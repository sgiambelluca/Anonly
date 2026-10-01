<!-- CONTEXT: scope=roadmap-plan | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/mediciones/ner/Hilos_NER_Medicion.md,roadmap/mediciones/ocr/Reconocedores_OCR_Medicion.md,roadmap/Optimizacion_De_Rendimiento.md,ui/React_Client.md,core/Contracts.md | audiencia=humanos+IA | fase=11 (revisión provisional de perfiles; curvas NER y OCR, incluidos los brazos de Bajo, medidas en macOS y Windows nativo 2026-09-23 a 2026-09-26; curva WASM OCR 2/3/4 macOS cerrada; atribución Windows y decisión humana pendientes) -->

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
[`Hilos_NER_Medicion.md`](mediciones/ner/Hilos_NER_Medicion.md) y
[`Reconocedores_OCR_Medicion.md`](mediciones/ocr/Reconocedores_OCR_Medicion.md).
Los brazos de Bajo (OCR1, NER 1/2) ya tienen curva en las dos plataformas
(Windows el 2026-09-26, al final de este documento), y en las dos el control
automático de NER resolvió **4 hilos efectivos**.
**No alcanzan para publicar perfiles nuevos**: la atribución de memoria
en Windows mantiene seguimiento pendiente. La curva WASM OCR 2/3/4 en macOS
**cerró el 2026-09-26** con 54/54
snapshots completos: incrementos medianos de 141,125 MiB en P2 y 85,8125 MiB
en R2. El RSS total no creció linealmente; memoria nativa por worker sigue
sin atribución. Ver el cierre en `Reconocedores_OCR_Medicion.md`.
Esta revisión propone la forma de la decisión y explicita los huecos; no
cambia settings, contratos,
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
| Alto | Mac: 6/8 empeoran NER. Windows (12 hilos): 6/8 lo aceleran, hasta −24 % en R1. Depende del hardware | 3 o 4, candidato | sin cambio decidido | En R2, 3 bajó `Ready` 13,7 % en la Mac y 13,8 % en Windows; 4 lo bajó 21,0 % y 26,0 %. En Windows el RSS durante OCR sube con el tamaño del pool (R2 frío 1398 → 1778 MiB de 2 a 4). WASM macOS atribuido: incremento mediano de 85,8125 MiB por LSTM en R2. Falta completar evidencia Windows; nativo sin atribución. |
| Automático | resolver a uno de los tres niveles anteriores | valor del nivel resuelto | valor del nivel resuelto | Umbrales y señales por plataforma aún sin validar; no usar cantidad de páginas como señal de carga. |

La matriz es **una propuesta de experimentación**, no valores aprobados. La
Mac sin ventilador puede perder frecuencia; los pares intercalados contienen
la deriva, pero no establecen qué hacer en Windows ni en equipos de 4/16/32
GiB. Los picos de RSS total del OCR tampoco se convierten en «MB por worker».
T-11/T-12 ya midieron **148 MB de WASM por worker** en P2 y **90 MB** en R2
con dos reconocedores (`Ciclos_Y_Documentos_Reales_Medicion.md` §5.2/§6.5).
Esa es una base útil, pero no una curva 2/3/4: no muestra el pico simultáneo
de WASM, heap y otros targets al agregar plazas, ni prueba que el tercer y
cuarto reconocedor sigan en el mismo escalón de memoria. La tanda del
2026-09-26 completó los targets con una barrera al final de
OCR y midió RSS natural en corridas separadas (protocolo al final de este
documento). La cifra de 90 MB no se multiplica por cuatro para aprobar Alto:
es reserva lineal, no costo total residente ni memoria nativa atribuida.
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
2. WASM por reconocedor **completado en macOS el 2026-09-26**. Completar su
   evidencia Windows y decidir si 3 o 4 cumple el compromiso de memoria y los
   presupuestos. Memoria nativa por worker permanece sin atribución; una
   política necesita un límite verificable de memoria total. Si se quiere
   variar `LiveImageBudget`, hacer otra
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
incremental **por reconocedor** no quedaron demostrados en esa tanda.
La curva de reserva WASM macOS se completó el 2026-09-26 con el protocolo
adicional del final y el informe en `Reconocedores_OCR_Medicion.md`; esto
no convierte los snapshots parciales anteriores en lecturas completas.
Las muestras completas
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
> los brazos de esta tanda (sección siguiente). La curva WASM OCR 2/3/4 en
> macOS se completó el 2026-09-26 (protocolo al final e informe OCR);
> la atribución Windows y la decisión humana mantienen seguimiento pendiente.

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

## Protocolo adicional macOS — memoria OCR 2/3/4 (2026-09-26)

Antes de medir se cierra este procedimiento. La sonda periódica anterior
pierde targets ocupados y no reconoce los nombres `entry-<hash>` del build.
Se separan dos observaciones, con el mismo build y una instancia Electron
nueva por importación, P2 sintético y R2 real, tres rondas intercaladas
`2/3/4`, `4/3/2`, `2/4/3` por corpus:

1. **RSS natural**: muestreo del árbol Electron cada 150 ms, sin CDP ni
   barrera. Se informa el pico durante OCR, su serie y duración. Sigue
   siendo memoria residente total del árbol, sin atribución por worker.
2. **WASM y heap al final de OCR**: el arnés envuelve `processSession` en
   la instancia expuesta por `VITE_E2E`, espera su resolución normal y
   retiene su retorno mientras realiza tres lecturas CDP consecutivas.
   Esto impide la baja inmediata del pool y el comienzo de NER; todos los
   jobs OCR ya terminaron. Se libera en `finally` y el pipeline debe llegar
   a Ready. La barrera dura menos que el minuto de disposición por
   inactividad. Los workers conservan su memoria lineal alcanzada; no se
   presenta esta lectura como un pico activo de RSS, como tiempo natural,
   ni como memoria nativa atribuida. CDP fuerza GC y `queryObjects` también
   puede hacerlo; el heap informado es después de GC.

Los roles LSTM/OSD se vinculan a los chunks mediante los sourcemaps del build
medido, nunca por el tamaño de memoria. Cada snapshot debe observar exactamente
el número solicitado de hijos LSTM y un OSD, una memoria privada positiva por
hijo, sin errores de lectura y con heap legible para todos los targets. La
serie incompleta invalida la atribución. El paso 0 de T-11 verifica el mecanismo
antes de la campaña; un piloto comprueba la barrera y la clasificación.

Se comparan las tres rondas y la identidad de OCR, ocurrencias y grupos contra
OCR2 del mismo corpus, además de confirmar plazas ocupadas, ausencia de fallos
y presupuesto de imágenes de 128 MiB. Se informan los bytes de cada LSTM,
suma LSTM, OSD, suma WASM completa y heap; cada muestra registra principio y
fin de lectura, RSS observado a ambos lados y duración de la barrera. Un
incremento constante de la reserva lineal comprueba esa parte de la hipótesis;
no autoriza inferir linealidad de RSS, sumar heap y WASM como RSS, ni obtener
memoria nativa por resta. Las unidades publicadas serán MiB (2^20 bytes).

El runner serializa Electron, previene suspensión, conserva presión/swap,
verifica fuentes y build antes/después y restaura los dist previos por hash.
Los artefactos crudos quedan en `.measure/`; la documentación contiene solo
IDs neutros y agregados. Se deshabilita la copia automática de snapshots ARIA
ante fallos para evitar persistir contenido real. No cambia producto, defaults,
contratos ni dependencias. Windows nativo mantiene su campaña separada.

## Decisiones del humano y medición de Ultra (2026-09-30)

Con la revisión de la branch cerrada y el M2 decidido (ADR-192), el humano
retomó los perfiles. Decisiones tomadas:

| Perfil | Reconocedores OCR | PDF / Render | Hilos de NER |
|---|---:|---|---|
| Bajo | 1 | 1 / 1 | automático del runtime |
| Intermedio | 2 | según núcleos, tope del Core | automático del runtime |
| Alto | 4 | según núcleos, tope del Core | automático del runtime |
| **Ultra** (nuevo) | **6** | según núcleos, tope del Core | automático del runtime |
| Automático (por defecto) | el del nivel que resuelva | | |

- **NER queda en automático en todos los perfiles.** Bajar hilos cuesta entre
  1,5 y 2,9 veces el tiempo sin ahorrar memoria, y subirlos depende del
  equipo. No entra en esta etapa.
- **Migración:** un `high` ya guardado pasa a **Automático**, que decide el
  nivel. `low` se conserva como Bajo.
- **La regla de Automático no está decidida.** El humano pidió volver a medir
  con Ultra incluido antes de fijarla.
- **Quedan pendientes** los techos de memoria de Bajo, Alto y Ultra (ADR-192
  §5) y la fuente de la RAM real para Automático: `navigator.deviceMemory`
  no informa más de 8 GB, así que no distingue un equipo de 8 de uno de 32.

### Lo que hay que saber antes de medir Ultra

`ocr.maxLiveImageBytes` vale 128 MiB (ADR-143 §3) y la reserva se hace por
página antes de rasterizar. Una A4 a 300 dpi reserva 33,2 MiB, así que el
presupuesto admite tres o cuatro páginas vivas. **Con seis reconocedores, el
quinto y el sexto pueden quedar esperando presupuesto**, y la ocupación real
sería menor que seis. Un perfil Ultra que use los seis necesita subir ese
tope, y eso es una segunda variable: se mide por separado.

### Protocolo

Extensión de `tests/perf/run-ocr-pool.sh` con una fase nueva, `ultra`. Mismo
criterio que `profiles-gap`: una instancia fría por corrida, mismo build,
corridas en serie, sin otra medición en paralelo.

- **Brazos:** `2` (control), `4`, `6` con `maxLiveImageBytes` de 128 MiB, y
  `6b` con 200 MiB (seis A4 a 300 dpi). El resto de la configuración, igual.
- **Corpus:** P2 sintético siempre. R2 real solo si `ANONLY_REAL_DOC_R2` está
  definido; si no, se informa que falta y no se inventa.
- **Tiempo:** tres rondas intercaladas sin sonda (`2 4 6 6b`, `6b 6 4 2`,
  `4 6b 2 6`), con medianas de `Ready` y de OCR.
- **Memoria:** tres instancias frías por brazo con el muestreo de RSS del
  árbol cada 150 ms, sin CDP. Se informa el pico durante OCR.
- **Ocupación:** el máximo de trabajos `ocr-page` simultáneos por brazo. Es
  el dato que dice si `6` usó seis reconocedores o lo frenó el presupuesto.
- **Calidad:** huellas de OCR, NER y Grouping idénticas a las del brazo `2`.
- **Cancelación:** una vez por brazo con trabajo activo, dentro del SLA.
- **Validez:** suspensión del equipo, error de Playwright o salida faltante
  invalidan la corrida; no se promedia ni se convierte en cero.

**Bancos.** La Mac M1 de 8 GB tiene ocho núcleos, cuatro de ellos de
eficiencia, y poca memoria libre: su resultado para seis reconocedores es
informativo y probablemente pesimista. El banco que decide Ultra es Windows
nativo (i5-12400, 12 hilos, 16 GB), que corre el humano. Un delta de RSS
total no se divide por reconocedor, y los números de las dos plataformas no
se restan entre sí.

**Con los resultados** se presenta al humano la matriz final, los techos de
memoria por perfil y la regla de Automático. Después van el ADR, `Contracts.md`,
los specs de UI y recién entonces el código.

### Resultado en la Mac (2026-09-30)

Fase `ultra` de `tests/perf/run-ocr-pool.sh`, salida neutral
`.measure/ocr-pool/ultra-20260930-mac/summary.json`. MacBook Air M1, 8
núcleos y 8 GB, sobre `1ab2c31` más el arnés de esta fase, sin cambios de
producto. Las 56 corridas fueron válidas: ninguna fallida, faltante ni
invalidada. Las huellas de OCR, NER y Grouping fueron idénticas a las del
brazo `2` en los dos corpus, y las ocho cancelaciones con trabajo activo
quedaron en 0–1 ms.

| corpus | brazo | `Ready` (mediana) | OCR (mediana) | pico de RSS durante OCR (mediana) | ocupación pico |
|---|---|---:|---:|---:|---:|
| P2 | `2` | 18,65 s | 12,56 s | 1581 MiB | 2 |
| P2 | `4` | 18,60 s | 12,21 s | 1825 MiB | 4 |
| P2 | `6` | 17,97 s | 11,95 s | 1851 MiB | 5 |
| P2 | `6b` | 17,85 s | 11,98 s | 1821 MiB | 5 |
| R2 | `2` | 51,42 s | 33,80 s | 1328 MiB | 2 |
| R2 | `4` | 41,94 s | 23,81 s | 1548 MiB | 4 |
| R2 | `6` | 39,64 s | 20,88 s | 1610 MiB | 6 |
| R2 | `6b` | 38,67 s | 20,82 s | 1504 MiB | 6 |

Lo que se lee, solo para esta máquina:

- **R2 (real escaneado).** Contra `2`, `Ready` baja 18,4 % con `4`, 22,9 %
  con `6` y 24,8 % con `6b`. De `4` a `6` la ganancia es de 2,3 s (5,5 %),
  con rangos entre rondas de 1,3 a 1,9 s: es chica, pero las tres rondas de
  `6` quedaron por debajo de las tres de `4`.
- **P2 (sintético).** Prácticamente plano: de 18,65 a 17,85 s entre `2` y
  `6b`, con rangos de hasta 1,0 s. En esta Mac, más reconocedores no
  aceleran este fixture.
- **En estos dos documentos, `6` y `6b` no se distinguen.** Misma ocupación
  en los dos corpus, y en R2 las medianas de `Ready` difieren 1,0 s con
  rangos solapados: tres rondas no alcanzan para separarlos. En R2 los seis
  reconocedores trabajaron a la vez con 128 MiB.
- **Pero la tanda no ejercitó el caso que motivó el brazo `6b`**, así que
  **no permite decidir si Ultra necesita subir `maxLiveImageBytes`**. La
  reserva de una página dura todo su reconocimiento, de modo que una
  ocupación pico de N con 128 MiB implica páginas de 128/N MiB o menos: a lo
  sumo ~21 MiB en R2 (seis ocupados) y ~26 MiB en P2 (cinco ocupados). Es una cota inferida de la ocupación,
  no una medición. Ninguno de los dos corpus tiene páginas de 33,2 MiB (A4 a
  300 dpi), que es el tamaño con el que 128 MiB admite tres reconocedores y
  200 MiB admite seis. La variable queda abierta hasta medir un documento
  con páginas de ese tamaño.
- **El instrumento que mediría la reserva no funciona.** En los crudos,
  `pageRgbaEstimates[].estimatedBytes` es `null` y
  `estimatedReservationWindowPeakBytes` es 0 en las 24 corridas de tiempo
  (`ocr-pool.spec.ts`, el tamaño de página no es observable desde el
  arnés). Es anterior a esta fase. Mientras siga así,
  `estimatedWindowExceedsReservationBudget: false` no significa nada.
- **En P2 la ocupación quedó en 5 de 6, con los dos presupuestos.** No es el
  presupuesto, porque `6b` tampoco llegó a 6. **La causa no está
  identificada** y no se infiere de estos datos.
- **Memoria.** El pico de RSS sube 243 MiB en P2 y 220 MiB en R2 de `2` a `4`,
  y casi nada de `4` a `6`. Estas cifras tienen un problema de banco: la Mac tenía
  2,1 GB de swap en uso al terminar la tanda, y la presión de memoria baja
  el RSS por evicción (el mismo confound de las campañas anteriores). En R2
  el brazo `2` dio 1682, 1328 y 1284 MiB en sus tres rondas. **No sirven
  para fijar techos de memoria**; esos salen de Windows.

**Un defecto del instrumento que apareció al extenderlo.** El script
detectaba la suspensión del equipo con `rg`, que no está instalado en esta
Mac fuera del shell de Claude Code. El chequeo no fallaba: no hacía nada. Las
campañas anteriores de `run-ocr-pool.sh` en esta Mac que informan «sin
suspensiones» no lo verificaron de verdad. Desde esta fase usa `grep -E`, y
en esta tanda la detección sí estuvo activa. No hay indicio de que una
suspensión haya afectado los resultados anteriores, pero tampoco prueba de
lo contrario.

**Qué falta.** La misma fase en Windows nativo, que es el banco que decide
Ultra y los techos de memoria:

```bash
ANONLY_OCR_POOL_PHASE=ultra ANONLY_REAL_DOC_R2=<ruta absoluta> ./tests/perf/run-ocr-pool.sh
```

El script tiene dependencias de macOS (`caffeinate`, `pmset`, `vm_stat`); la
tanda de Windows del 2026-09-26 usó un puerto ad hoc sin commitear. Hay que
portar esta fase de la misma forma, o hacerla portable, antes de correrla.

### Por qué el presupuesto no frenó, y lo que eso implica (2026-09-30)

Al arreglar el instrumento de reserva, el arnés estimó 33,2 MiB por página
de P2 (595 × 842 pt a los 300 dpi configurados). Con eso, 128 MiB admiten
tres páginas, pero se midieron cuatro y cinco reconocedores ocupados. La
explicación está en el código, no en una medición:

- El Core no reserva con el DPI configurado sino con
  `effectiveOcrDpi = min(ocr.dpi, page.ocrDpiCap)` (`orchestrator.ts`,
  ADR-163). El tope de la página es la resolución nativa de su única imagen
  (`deriveOcrDpiCap`, `pdf.engine.ts`).
- El fixture P2 se genera con `DEFAULT_SCALE = 3` (`scannedPdf.ts`), o sea a
  216 dpi. Su reserva calculada es `1785 × 2526 × 4` = 17,2 MiB por página,
  y 128 MiB admiten siete. **El presupuesto nunca pudo frenar a seis
  reconocedores en P2.** Es un cálculo sobre el código y el fixture; el
  `ocrDpiCap` efectivo no es observable desde el arnés.
- La estimación del arnés con el DPI configurado es una **cota superior**, y
  en P2 queda al doble del valor real. Su indicador de «la ventana excede el
  presupuesto» no se puede leer como medición.
- En R2 la cota por ocupación (seis ocupados con 128 MiB) da 21,3 MiB o
  menos por página: tampoco es un escaneo A4 a 300 dpi.

**Consecuencia para los perfiles, todavía sin medir.** Ninguno de los dos
corpus ejercitó una A4 a 300 dpi, de 33,2 MiB por página. Se la toma como
caso de referencia porque 300 dpi es una resolución habitual de escaneo,
pero **su prevalencia entre los documentos de los usuarios es un supuesto,
no un dato**: el único documento real medido (R2) no lo es. Con el presupuesto actual, ese documento admite **tres** páginas
vivas. Alto (4) y Ultra (6) quedarían frenados a tres reconocedores, y Ultra
no rendiría más que Alto ni Alto mucho más que Intermedio. Si se confirma,
`maxLiveImageBytes` tiene que crecer con los reconocedores del perfil (del
orden de 34 MiB por reconocedor), y ese aumento entra en el techo de memoria
de cada perfil.

**Qué hay que medir.** Un corpus sintético a 300 dpi nativos en la fase
`ultra`, con los mismos brazos. Lo esperado por el código es ocupación 2, 3,
3 y 6 en `2`, `4`, `6` y `6b`. Si la medición da otra cosa, hay algo del
presupuesto que no se entendió. Sigue sin explicación por qué P2 llegó a
cinco y no a seis reconocedores ocupados, sin que el presupuesto lo frene.

### Resultado del corpus a 300 dpi en la Mac (2026-10-01)

Fase `ultra` con `ANONLY_OCR_POOL_ULTRA_HIDPI=1`, salida neutral
`.measure/ocr-pool/ultra-hidpi-20261001-mac/summary.json`. Misma Mac, sobre
`b936342` más el arnés de esta fase, sin cambios de producto. Corpus P2 y
`P2H`; R2 no entró en esta tanda. `P2H` son las primeras 20 páginas de P2
rasterizadas a 300 dpi nativos (33,2 MiB de reserva por página). Las 56
corridas fueron válidas, con huellas idénticas a las del brazo `2` de cada
corpus y cancelaciones de 0–1 ms.

| corpus | brazo | presupuesto | `Ready` (mediana) | OCR (mediana) | ocupación pico (mín–máx de las corridas) |
|---|---|---:|---:|---:|---:|
| P2H | `2` | 128 MiB | 15,50 s | 11,99 s | 2–2 |
| P2H | `4` | 128 MiB | 14,39 s | 10,93 s | 3–3 |
| P2H | `6` | 128 MiB | 14,78 s | 11,26 s | 3–3 |
| P2H | `6b` | 200 MiB | 12,64 s | 9,24 s | 6–6 |
| P2 | `2` | 128 MiB | 17,85 s | 12,10 s | 2–2 |
| P2 | `4` | 128 MiB | 17,31 s | 11,66 s | 4–4 |
| P2 | `6` | 128 MiB | 17,32 s | 11,53 s | 5–5 |
| P2 | `6b` | 200 MiB | 17,03 s | 11,43 s | 5–5 |

- **El presupuesto frena a Alto y a Ultra en un escaneo a 300 dpi.** Con
  128 MiB, `4` y `6` quedaron en tres reconocedores ocupados en todas las
  corridas, y no se distinguen entre sí: 14,39 y 14,78 s de `Ready`, con
  rangos de 0,2 s. La ocupación coincide con lo que predice el código (2, 3,
  3 y 6).
- **Subir el presupuesto destraba a Ultra.** `6b` llegó a seis ocupados y
  bajó `Ready` 18,4 % y el OCR 22,9 % contra `2`; contra `6` con 128 MiB,
  `Ready` bajó 14,5 %. Las tres rondas de `6b` quedaron por debajo de todas
  las de los otros brazos.
- **Alto con su presupuesto no se midió.** No hubo un brazo de cuatro
  reconocedores con presupuesto para cuatro páginas (~136 MiB). Lo medido
  para `4` es Alto frenado a tres.
- **P2 repite la tanda anterior:** casi plano, con cinco de seis ocupados y
  la estimación a 300 dpi contradicha por la ocupación en `4` y `6`, como
  corresponde a un fixture de 216 dpi.
- **Memoria: no usar.** La Mac terminó con 2,3 GB de swap en uso. Los picos
  de RSS de P2H (2088, 2179, 2319 y 2134 MiB) no ordenan los brazos y no
  sirven para fijar techos.

**Lo que queda establecido para los perfiles.** El presupuesto de imágenes
vivas tiene que acompañar a la cantidad de reconocedores: con el valor único
de hoy, Alto y Ultra rinden como tres reconocedores en un escaneo A4 a
300 dpi. Con qué frecuencia aparece ese documento no está medido. Cuánto presupuesto lleva cada perfil, y cuánta memoria cuesta, se
decide con la tanda de Windows, que además tiene que incluir un brazo de
Alto con presupuesto para cuatro páginas.

**Brazo `4b` (2026-10-01).** La fase `ultra` ganó un quinto brazo, `4b`:
cuatro reconocedores con 136 MiB, que alcanzan para cuatro A4 a 300 dpi. En
un humo de una corrida sobre P2H llegó a cuatro ocupados, contra tres del
brazo `4` con 128 MiB. Es una sola corrida: no hay comparación de tiempos
todavía. Las dos tandas de la Mac son anteriores a este brazo. Sus `summary.json` en
disco no se regeneraron y siguen diciendo `complete: true`; regenerados con
el agregador actual, lo declaran faltante (`missingArms: ["4b"]`). La tanda de Windows
mide los cinco brazos.

## Tanda de Ultra en Windows nativo (2026-10-01)

Fase `ultra` con `ANONLY_OCR_POOL_ULTRA_HIDPI=1` y R2, sobre `ebd030d`,
en el i5-12400 (6 núcleos, 12 hilos, 15,8 GB, Windows 11). La corrió un
agente que solo ejecutó y reportó; los crudos están en
`.measure/ocr-pool/20261001T054724Z/` de esa máquina y este informe se basa
en su reporte de medianas. Resumen: `complete=true salvedades=0`, sin
corridas inválidas ni faltantes, `sleepDetection.available: true`, huellas
idénticas al brazo `2` en los tres corpus y cancelaciones de 0–1 ms. La
portabilidad del script a Git Bash funcionó en su primera ejecución. Las
comprobaciones 9 y 10 del README (que la guarda de procesos y la detección
de suspensión corten de verdad) **no se ejecutaron**.

| corpus | brazo | presupuesto | `Ready` | OCR | pico de RSS durante OCR | ocupación |
|---|---|---:|---:|---:|---:|---:|
| R2 | `2` | 128 MiB | 43,41 s | 32,60 s | 1727 MiB | 2 |
| R2 | `4` | 128 MiB | 31,72 s | 20,89 s | 2248 MiB | 4 |
| R2 | `4b` | 136 MiB | 32,65 s | 21,89 s | 2244 MiB | 4 |
| R2 | `6` | 128 MiB | 27,67 s | 16,78 s | 2643 MiB | 6 |
| R2 | `6b` | 200 MiB | 27,84 s | 16,86 s | 2573 MiB | 6 |
| P2H | `2` | 128 MiB | 19,17 s | 16,01 s | 2928 MiB | 2 |
| P2H | `4` | 128 MiB | 17,28 s | 14,21 s | 3110 MiB | 3 |
| P2H | `6` | 128 MiB | 17,41 s | 14,35 s | 3032 MiB | 3 |
| P2H | `4b` | 136 MiB | 14,88 s | 11,85 s | 3682 MiB | 4 |
| P2H | `6b` | 200 MiB | 13,15 s | 10,06 s | 4139 MiB | 6 |
| P2 | `2` | 128 MiB | 19,78 s | 14,67 s | 2217 MiB | 2 |
| P2 | `4` | 128 MiB | 18,93 s | 13,84 s | 2604 MiB | 4 |
| P2 | `4b` | 136 MiB | 18,90 s | 13,77 s | 2616 MiB | 4 |
| P2 | `6` | 128 MiB | 18,58 s | 13,56 s | 2946 MiB | 5 |
| P2 | `6b` | 200 MiB | 18,63 s | 13,61 s | 2787 MiB | 5 |

Son medianas de tres corridas. El reporte no trae los valores por corrida,
así que acá no hay rangos ni máximos.

**Tiempo, contra Intermedio (`2`):**

| corpus | Alto (4 reconocedores con su presupuesto) | Ultra (6 con su presupuesto) |
|---|---:|---:|
| R2, real escaneado de 20 páginas | −24,8 % (`4b`); −26,9 % (`4`) | −35,9 % (`6b`); −36,3 % (`6`) |
| P2H, sintético a 300 dpi | −22,4 % (`4b`) | −31,4 % (`6b`) |
| P2, sintético a 216 dpi | −4,4 % (`4b`) | −5,8 % (`6b`) |

- **Ultra rinde en Windows.** En R2 baja `Ready` unos 4 s más que Alto, de
  ~32 a ~28 s. En la Mac la diferencia había sido de 2,3 s.
- **El presupuesto frena igual que en la Mac.** En P2H con 128 MiB, `4` y
  `6` quedaron en tres ocupados y rinden lo mismo (17,3 y 17,4 s). Con su
  presupuesto, `4b` llegó a cuatro y `6b` a seis.
- **En R2 el presupuesto no importa:** `4` y `4b` no se distinguen, ni `6`
  y `6b`. Sus páginas reservan menos de 22 MiB.
- **P2 sigue casi plano** y con cinco de seis ocupados, sin explicación.

**Memoria (pico de RSS del árbol durante el OCR, suma de working sets).**
Windows tuvo entre 8,7 y 9,1 GiB de RAM libre y 319–335 MB de paginación en
uso durante toda la tanda: a diferencia de la Mac, acá no hubo presión que
baje el RSS.

| | Intermedio (`2`) | Alto (`4b`) | Ultra (`6b`) |
|---|---:|---:|---:|
| R2 | 1727 MiB | 2244 MiB (+517) | 2573 MiB (+846) |
| P2H (300 dpi) | 2928 MiB | 3682 MiB (+754) | 4139 MiB (+1211) |
| P2 (216 dpi) | 2217 MiB | 2616 MiB (+399) | 2787 MiB (+570) |

- **El costo de memoria depende de la resolución del escaneo.** A 300 dpi,
  Alto usa ~3,7 GiB y Ultra ~4,1 GiB de pico; el mismo perfil sobre R2 usa
  2,2 y 2,6 GiB.
- **Intermedio a 300 dpi ya ronda los 2,9 GiB** (3,07 GB decimales), con la
  configuración por defecto de hoy. El techo de 3,0 GB de ADR-192 se midió
  sobre P2, que es un caso más liviano, y con otro instrumento.
- Un delta de RSS total no se divide por reconocedor, y estos números no se
  restan contra los de la Mac.

**Lo que falta para cerrar los perfiles.**

- El brazo de **Bajo** (un reconocedor) no entró en esta tanda. Su curva es
  la del 2026-09-26, anterior a ADR-190 y sin corpus a 300 dpi.
- Los **máximos por corrida**, para fijar techos con el criterio de ADR-146
  §6 (el máximo, no la mediana). Están en el `summary.json` de Windows.
- Las **decisiones del humano**: techos de memoria por perfil, regla de
  Automático y de dónde sale la RAM real del equipo.

### Decisiones del humano tras la tanda de Windows (2026-10-01)

- **Regla de Automático.** Menos de 8 GB de RAM o menos de 4 núcleos: Bajo.
  De 8 a 15 GB: Intermedio. 16 GB o más con 12 hilos o más: **Ultra**. 16 GB
  o más con 8 a 11 hilos: Alto. El único equipo medido con Ultra es el
  i5-12400 de 16 GB, con ~9 GiB libres durante la tanda; no hay medición con
  otras aplicaciones abiertas.
- **La RAM real la pasa el shell de Electron** al renderer al arrancar.
  `navigator.deviceMemory` no informa más de 8 GB. Es un dato nuevo que
  cruza del proceso principal al renderer: va con su ADR y con un test de
  que no pasa nada más.
- **Techos de memoria por perfil: sin decidir.** El humano pidió más
  explicación antes de fijarlos.
- **El humano preguntó por qué el pico «subió».** Con el instrumento del
  gate (`memory.spec.ts`), la misma configuración y el mismo fixture, no
  subió: P2 daba 2204 MB en frío y 2763 MB en caliente antes de ADR-190, y
  ahora da 1968–2032 MB y 2661–2894 MB. Los números más altos de esta tanda
  son de un documento más pesado (300 dpi) y de perfiles con más
  reconocedores, que antes no se medían. Queda una diferencia sin explicar:
  con `run-ocr-pool.sh`, el pico de RSS durante el OCR de P2 con dos
  reconocedores fue de 1830 MiB el 2026-09-26 y de 2217 MiB hoy, y el de R2
  pasó de 1374 a 1727 MiB. Las dos tandas no usan el mismo modo de medición
  (instancias instrumentadas con CDP entonces, RSS natural cada 150 ms
  ahora) ni el mismo commit, así que la diferencia no se puede atribuir al
  producto ni al instrumento sin medir los dos commits en la misma sesión.

