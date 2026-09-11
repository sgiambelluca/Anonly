<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,00_Project_Vision.md,core/NER_Engine.md,ui/React_Client.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-143-Las-Imagenes-De-OCR-Se-Producen-Cuando-Hay-Lugar.md,adr/ADR-080-Idle-Dispose-En-El-Pool-No-En-El-Manager.md,adr/ADR-135-El-Ciclo-Del-Modelo-Se-Deduplica-Entero.md,adr/ADR-126-Detectar-Nombres-No-Es-Una-Preferencia.md | audiencia=humanos+IA | fase=11 -->

# ADR-154 — La memoria no se compra bajando el paralelismo

- **Estado**: Accepted (**§2 corregido el mismo día, sobre medición**: el segundo worker de NER **no existe** en el uso de hoy —`processPages` es secuencial y los workers se crean por slot—, así que la duplicación que el lever 1 nombraba no se está pagando. Lo que hay es paralelismo faltante, §2.1, y el sospechoso medido pasa a ser el pool de Render con sus cuatro copias del documento. La decisión de §1 no cambia)
- **Fecha**: 2026-09-10
- **Decidido por**: El humano, sobre la atribución de H-10: *"no resulta redituable el hecho de tener que bajar el rendimiento de la aplicación para poder ganar un poco de memoria… reducirlo no es lo correcto"*.
- **Relacionado con**: ADR-146 (las dos métricas y sus presupuestos), ADR-143 (las imágenes de OCR bajo demanda), ADR-080 (liberación por idle), ADR-135 (el ciclo del modelo), ADR-126 §2 (precedente: no degradar el producto para que un número cierre)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Hay un atajo, y es el equivocado

La caracterización de H-10 midió, sobre 50 páginas escaneadas, un M1 de 640-785 MB
contra el presupuesto de 512 MB de `00_Project_Vision.md` §7. Y la atribución
encontró que con `performancePreset: low` —los cuatro pools en 1— ese mismo
documento da **355 MB**, bajo el presupuesto.

De ahí sale una salida tentadora y de una línea: bajar los defaults y declarar el
presupuesto cumplido.

**Las dos cifras vienen de un instrumento con un defecto conocido** —el fixture
se rasteriza dentro del mismo renderer que después se mide, contra lo que ADR-146
§4 pide— así que no son finales. Pero la dirección es clara y la tentación
existe igual.

### 2. Por qué ese atajo no se toma

Bajar `nerPoolSize` y `ocrPoolSize` no arregla nada: **paga memoria con tiempo
del usuario**, y el tiempo del usuario también es contractual
(`00_Project_Vision.md` §7 fija 8 s y 60 s). Cerrar un presupuesto rompiendo otro
no es una optimización, es mover el problema.

Y hay una asimetría que lo decide: lo que se duplica **no es trabajo, es
inventario**. Dos workers de NER no hacen el doble de cosas con la misma
memoria: hacen el doble de cosas **y cargan dos copias de los mismos pesos**. La
segunda copia no compra velocidad — la compra el segundo hilo de ejecución, que
es otra cosa. Atacar la duplicación no cuesta throughput; recortar workers sí.

Es el mismo criterio de ADR-126 §2: no se degrada lo que el producto hace para
que un número cierre.

## Decisión

### 1. Recortar el paralelismo no es una salida aceptada

En un equipo que puede pagarlo, el presupuesto de memoria **no se cumple**
bajando `nerPoolSize`, `ocrPoolSize`, `renderPoolSize` ni `pdfPoolSize` respecto
de lo que el equipo permite. Un cambio de defaults que reduzca paralelismo
necesita su propio ADR y una razón que no sea "así entra en el presupuesto".

### 2. Los levers aceptados, en orden

1. **Duplicación que no compra nada.**

   > **Corregido el 2026-09-10, medido.** Este lever decía "dos workers de NER
   > son dos copias de los pesos". **No es lo que pasa hoy**: el conteo de
   > concurrencia real sobre dos documentos midió `ner-page` en **1**, con
   > `nerPoolSize: 2` configurado. `NerEngine.processPages` recorre las páginas
   > con un `for`/`await` plano, así que nunca hay dos jobs de NER en vuelo; y
   > como `WorkerPool` crea sus workers perezosamente por slot, **el segundo
   > worker de NER no llega a existir** y su copia del modelo no se paga. El
   > costo que `05_Worker_Architecture.md` §1.1 le atribuye a `nerPoolSize: 2`
   > es, en el uso de hoy, hipotético.
   >
   > Lo que hay no es una duplicación a eliminar: es un **paralelismo que falta**
   > (§2.1). El lever sigue existiendo, pero como condición sobre **cómo** se
   > agregue ese paralelismo, no como un ahorro disponible.

   Cuando NER se paralelice por página, se hace con **hilos dentro de una
   sesión**, no con un worker por página. El binario que se empaqueta es el
   multihilo (`ort-wasm-simd-threaded.asyncify.wasm`) y el contenedor corre
   `crossOriginIsolated` con `SharedArrayBuffer` — verificado sobre el shell
   empaquetado. Una sesión con N hilos tiene **una** copia de los pesos; N
   workers tienen N. La velocidad que se busca la da el paralelismo, no la
   segunda copia.

2. **Los workers de Render y su estado por instancia.**

   > **Corregido el 2026-09-11, medido.** Este lever decía "cuatro copias del
   > documento" y ponía ahí el grueso del costo. El fixture de P2 pesa
   > **1,71 MB**: cuatro clones son **6,9 MB**, tres de más son **5,1 MB**. La
   > premisa estaba errada por dos órdenes de magnitud, y era mía.
   >
   > La medición aislando `renderPoolSize` (4 contra 1, alternando condición
   > corrida por corrida) dio **−83 MB de promedio en caliente** y **+264 MB en
   > frío**, cada una consistente 3/3 en su propia dirección y contradictorias
   > entre sí. Las dos están **por debajo del ruido de M2 ya medido (~345 MB)**,
   > y 3/3 con n=3 ocurre una de cada cuatro veces por azar. **No hay resultado.**

   Lo que queda en pie del lever no es el archivo sino el **estado por
   instancia**: cada worker que se crea tiene su canvas y lo que su pdf.js haya
   decodificado. El orden de magnitud del delta caliente es compatible con eso,
   pero el instrumento no lo resuelve. Queda como sospechoso **de baja prioridad
   y sin confirmar**, por detrás de los levers 3 y 4.
3. **Solapamiento OCR/NER.** El pool de OCR sobrevive a su etapa por la
   liberación por idle (60 s), así que Tesseract y ONNX conviven durante toda la
   detección. Darlo de baja al terminar la etapa de OCR libera un heap entero de
   WASM —la única forma real de recuperarlo— sin quitarle un solo worker a nadie.
4. **Copias por página.** Verificado el 2026-09-11, y son **más de tres**: canvas
   del worker de Render, `ImageData` del host, clon estructurado en el worker de
   OCR, **canvas que ese worker reconstruye** (`toTesseractImage` hace
   `putImageData` sobre un `OffscreenCanvas` nuevo) y el PNG que tesseract.js
   produce de ese canvas antes de pasárselo a su core — porque **tesseract.js no
   acepta píxeles crudos**: `loadImage` convierte todo a bytes de imagen
   codificada.

   De ahí sale la forma del lever: que **Render entregue el ráster ya codificado**
   en vez de `ImageData`. El canvas ya existe de su lado, así que el `convertToBlob`
   no es trabajo nuevo — es el mismo que hoy hace tesseract.js, movido a donde no
   hay que reconstruir un canvas para hacerlo. El clon que cruza el `postMessage`
   pasa de ~35 MB a unos pocos, y el reintento retiene ese buffer chico en vez del
   crudo (ADR-079/143). PNG es **sin pérdida**: no toca calidad.

   Salvedad medida: el worker de OCR sigue necesitando un canvas para la rotación
   de ADR-120 y las franjas de margen de ADR-121, así que decodifica una vez. Lo
   que se ahorra es la copia grande cruzando la frontera, no el canvas.

5. **La caché de preview guarda cada página dos veces** (ADR-156): el `ImageData`
   crudo y el codificado, y nadie fuera del motor lee el crudo. Verificado sobre
   todo el repo. Es el lever más barato de la lista y el único ya cerrado.
6. **DPI.** La memoria va con el cuadrado del DPI: 300 → 200 es −55 %. Es el
   único lever de esta lista que **cambia calidad de reconocimiento**, así que
   no se toca sin medir contra la baseline de ADR-147 y sin decisión del humano.

### 3. La adaptación de recursos bajos se conserva

`deviceMemory < 4` o `hardwareConcurrency < 4` sigue bajando los pools
(`07_Performance_Strategy.md` §5.1). No es lo mismo: ahí se ajusta a un equipo
que **no puede** pagar el paralelismo, no se compra memoria en uno que sí puede.
El perfil `low` de la UI también se conserva como elección del usuario.

### 2.1 NER no tiene paralelismo por página, y eso es lo que hay que resolver

`NerEngine.processPages` procesa una página por vez, y su propio comentario dice
por qué: *"Secuencial a propósito (mismo criterio que `ocr-engine.processPages`,
ADR-021: la priorización por visibilidad y el despacho paralelo al pool son del
Orchestrator, Hito 9)"*. ADR-046 §8 lo dejó escrito como mejora futura.

**Es exactamente la situación que ADR-101 encontró y cerró para OCR**: el
traspaso al Orchestrator nunca aterrizó, el Hito 9 cerró, y el pool quedó "con
dos lugares y uno usado". OCR hoy corre `Promise.all` sobre `ocrPoolSize` colas;
NER quedó atrás con el mismo comentario apuntando al mismo traspaso que no pasó.

Así que la oportunidad de NER **no es de memoria, es de velocidad**, y tiene dos
formas con costos muy distintos:

| Forma | Velocidad | Memoria |
|---|---|---|
| N workers, una página cada uno (lo que haría un ADR-101 para NER) | sí | **N copias de los pesos** |
| Una sesión, N hilos | sí, si el runtime la da | **una** copia |

Por eso §2 lever 1 pasa a ser una condición sobre el cómo: se paraleliza con
hilos, y solo se recurre a workers si se mide que los hilos no rinden.

### 4. H-09D1 cambia de pregunta

Deja de ser "política de workers de NER" y pasa a ser **"cómo se paraleliza
NER"**: hoy no se paraleliza por página (§2.1), así que el spike compara el
estado actual —1 worker, 1 página por vez— contra una sesión con N hilos, y
mide **memoria y tiempo juntos**. La comparación contra "2 workers" que este ADR
proponía en su primera redacción no tiene sentido: esa configuración está
declarada pero no se ejerce. Su criterio de cierre pasa a incluir que no se
pierda throughput — y con el punto de partida corregido, lo esperable es
**ganarlo**.

### 5. Si aún así no entra

Si después de agotar los levers de §2 el presupuesto sigue sin cumplirse, la
decisión vuelve al humano: revisar el presupuesto —por perfil, como ADR-146 ya
separa métricas— o aceptar el exceso declarado. Lo que **no** se hace es cerrar
la brecha en silencio con menos paralelismo.

## Consecuencias

**A favor**

- El trabajo de memoria apunta a lo que se duplica sin comprar nada, que es
  donde están las ganancias reales y donde no hay que ceder nada a cambio.
- Cierra por escrito un atajo que cualquier agente futuro —o cualquiera de
  nosotros con prisa— habría tomado mirando el número del perfil `low`.
- Deja los dos presupuestos contractuales, el de memoria y el de tiempo, con el
  mismo rango: ninguno se cierra rompiendo el otro.

**En contra**

- **Puede terminar en que el presupuesto no se cumpla.** Si los levers de §2 no
  alcanzan, este ADR garantiza que el exceso quede visible en vez de disimulado.
  Es intencional, y §5 dice qué pasa entonces.
- Los levers aceptados son **más caros** que bajar un número de configuración:
  uno es un spike de runtime, otro toca el ciclo de vida de un pool, otro el
  transporte de un buffer. Ninguno es de una línea.
- Se decide con cifras de un instrumento que **todavía tiene un defecto conocido**
  (§1). La dirección no depende de esas cifras —es una decisión sobre qué se
  está dispuesto a ceder— pero las magnitudes sí, y hay que releerlas cuando el
  instrumento esté arreglado.

**Lo que no toca**: los presupuestos de `00_Project_Vision.md` §7, la adaptación
de recursos bajos, el perfil `low` de la UI, ni una línea de código: es una
restricción sobre qué soluciones se aceptan, no una solución.
