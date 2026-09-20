<!-- CONTEXT: scope=roadmap | dependencias=architecture/07_Performance_Strategy.md,core/NER_Engine.md,core/OCR_Engine.md,core/Grouping_Engine.md,roadmap/Duplicacion_De_Logica.md,roadmap/Optimizacion_De_Memoria_Plan.md,roadmap/Ciclos_Y_Documentos_Reales_Medicion.md,roadmap/Banco_Windows_Comparativa_Medicion.md,ui/React_Client.md | audiencia=humanos+IA | fase=11 (proximos objetivos acordados el 2026-09-20; sin implementar) -->

# Optimización de rendimiento — hallazgos y plan

> **Procedencia**: relevamiento del 2026-08-27 con cuatro agentes de investigación (carga/arranque, OCR por página, NER por página, duplicación+UI). **Cada número de este documento fue verificado a mano** contra el código o remedido; lo que no se pudo medir está marcado como tal.

**Estado actual (2026-09-17)**: este relevamiento conserva las mediciones originales. El multihilo interno de ONNX Runtime para NER quedó habilitado en el producto (ADR-100/130/132); la segunda instancia de worker NER se midió y se revirtió. D1 y el OCR paralelo también se implementaron. Ver el estado por intervención en «Plan acordado».

**Próximos objetivos acordados (2026-09-20)**: medir más hilos dentro del único
worker NER, más reconocedores OCR, varios fragmentos por inferencia NER y los
peores casos de Regex/Grouping. Después de las dos primeras mediciones, revisar
los perfiles de rendimiento y la selección automática según recursos del equipo.
El plan vigente está al final de este documento; las secciones previas conservan
el relevamiento histórico y sus descartes. No hay cambios de producto con esta actualización.

## Los dos focos

1. Velocidad de carga de la herramienta y de los motores.
2. Eficiencia por página **sin sacrificar calidad de la entrega final**.

Regla de trabajo fijada por el humano: **no se cambia nada sin haber medido antes y después**, tiempo y calidad. Ninguna decisión la toman los agentes ni el asistente.

---

## ~~Lo primero no es velocidad: se está perdiendo detección en silencio~~ — **CERRADO** (ADR-098, 2026-08-27)

`batchSize` corta en **256 palabras** (`config.ts:93`) pero el modelo trunca en **512 tokens** (`model_max_length: 512` y `max_position_embeddings: 512`, verificados en el `tokenizer_config.json` / `config.json` del modelo mirroreado). `computeWordChunks` (`ner.engine.ts:250`) cuenta palabras; el kernel **no chequea la longitud en tokens en ningún lado** (grep de `max_length`/`truncation` en `ner-engine/src/worker/kernel.ts`: vacío).

La razón tokens/palabra no es constante. Medido con el **tokenizer real del modelo**:

| texto | 256 palabras → tokens | ratio | |
|---|---|---|---|
| prosa natural | 364 | 1,42 | ok |
| **párrafo legal denso** (nombres + DNI + CUIT + teléfono) | **654** | 2,55 | **TRUNCA** |
| identificadores puros | 1567 | 6,12 | **TRUNCA** |

Con `truncation: true` y sin `max_length` explícito, Transformers.js **descarta la cola sin error, warning ni log**. En un párrafo legal denso se pierde ~22 % del batch. Regex sigue cubriendo esa zona para sus tipos; **Persona, Organización, Dirección y Fecha que caigan ahí no las ve nadie**.

Es el tipo de documento al que apunta el producto.

> **Cerrado el 2026-08-27 — ADR-098.** El kernel mide con el tokenizer que ya tiene cargado y parte el lote cuando no entra. Medido con el modelo real en Chromium sobre `doc-026`, el fixture que aísla el defecto: **1/3 → 3/3**. Sobre el dataset entero, el recall de NER pasa de **9/14 (64,3 %) a 12/17 (70,6 %)** sin un falso positivo nuevo, y `test:quality` no se movió.
>
> Dos cosas que costaron y conviene no repetir. El guard del camino de reserva filtraba por `typeof === "object"`, pero el tokenizer de Transformers.js es **invocable** y `typeof` da `"function"`: descartaba el tokenizer real y el lote no se partía nunca, **con los tests en verde**, porque el mock era un objeto plano — moldeado según la suposición que había que comprobar. Y la primera versión del fixture ponía un domicilio al final que no se cubría ni con el arreglo puesto (el modelo devuelve `LOC:Rivadavia` sin el número), lo que volvía ilegible el antes/después: un fixture de medición tiene que medir **una sola cosa**.

---

## Velocidad — ordenado por ganancia sobre riesgo

### A. Multihilo WASM de ONNX Runtime para NER — **IMPLEMENTADO**

**Baseline histórico del 2026-08-27**: en la web sin aislamiento, `crossOriginIsolated` era `false` y no había `SharedArrayBuffer`, por lo que `onnxruntime-web` forzaba `numThreads = 1`. El motor no configura `numThreads` (`ner-engine/src/worker/kernel.ts`, `configureTransformersEnv`): usa el valor automático de la librería.

**Producto actual**: ADR-100 declaró los headers para la variante web y ADR-130/132 fijaron el aislamiento en el contenedor de escritorio. El spike de ADR-132 («Verificado en el spike») comprobó `crossOriginIsolated === true` en renderer y workers, `SharedArrayBuffer` dentro del worker NER y la carga de `ort-wasm-simd-threaded.asyncify`. ONNX Runtime decide automáticamente cuántos hilos usa según el entorno; esa cifra efectiva no se registró en este relevamiento. Esos hilos ejecutan una inferencia **dentro de un worker NER**; `nerPoolSize` controla cuántos workers NER podrían existir y es un mecanismo distinto.

#### Medido: la inferencia baja a la mitad

Prototipo: `COOP: same-origin` + `COEP: require-corp` en el `server.headers` del dev server, y `pnpm test:measure` sobre los 26 documentos, antes y después. Verificado en la página que el aislamiento quedó activo:

```
crossOriginIsolated: true | SharedArrayBuffer: function | núcleos: 8
```

| | inferencia de NER (suma de los 26) |
|---|---|
| un hilo | 13 564 ms |
| con hilos | **6 287 ms** |
| | **−53,6 %** |

Sobre el documento denso (`doc-026`): **2986 ms → 1085 ms, −63,7 %**. La carga del modelo casi no se mueve (−10,7 %, dentro del ruido entre corridas).

**La calidad no cambió en nada**: recall de Regex 61/61, recall de NER 12/17, precisión 84/97 — idénticos a la corrida previa. Era lo esperado (esto no toca tokenización, agregación BIO ni umbral) pero se corrió igual, no se asumió.

**El prototipo de medición se revirtió entonces**; los headers para la variante web se declararon después mediante ADR-100 y el aislamiento del producto de escritorio se implementó con ADR-130/132. La reversión del prototipo no describe el estado actual.

#### Decisión de despliegue — resuelta

En el relevamiento original, la app era un **SPA estático** y faltaba decidir quién enviaría COOP/COEP en producción. Habilitarlos solo en el servidor de desarrollo habría hecho que las mediciones locales describieran otra configuración. ADR-100 dejó los headers declarados para un hosting web compatible; ADR-130/132 trasladaron el producto al contenedor de escritorio, que sirve el origen aislado.

La medición original no mostró pérdida de calidad: no cambió tokenización, agregación BIO ni umbral. La validación posterior del shell en ADR-132 comprobó que la variante multihilo carga y que el pipeline completo funciona bajo `app://`.

### B. OCR procesa de a una página aunque el pool tiene dos

`ocr.engine.ts:431` hace `for (const input of inputs) { await this.processPage(...) }`. Es **secuencial a propósito** y el comentario lo explica: el despacho paralelo al pool le tocaba al **Orchestrator** en el Hito 9. El Hito 9 cerró y el Orchestrator hace una sola llamada (`orchestrator.ts:1077`). **Es un traspaso documentado que nunca aterrizó.**

`ocrPoolSize: lowResource ? 1 : 2` (`config.ts:77`).

- **Ganancia**: hasta 2× en la etapa OCR (20 páginas escaneadas: ~106 s → ~53 s), si hay núcleos libres. En `lowResource` no cambia nada.
- **Riesgo de calidad**: **ninguno** — cada página es un job de Tesseract independiente.
- **Costo**: mediano.
- **Nota**: `render-engine` tiene el mismo patrón secuencial citando a OCR como precedente (`render.engine.ts:1177`). Si se toca uno, conviene decidir el criterio para los dos.

### C. NER igual — pero se pisa con A

`ner.engine.ts:664` (páginas) y `:793` (batches dentro de una página) esperan uno por vez. Con dispatch siempre secuencial, `assignRemoteSlot` devuelve siempre el slot 0 y **el worker del slot 1 nunca se instancia**.

**A y C son parcialmente sustitutivos, no aditivos**: A hace que la inferencia use varios núcleos dentro de un worker; C corre dos workers a la vez. Si A funciona, los dos de C compiten por los mismos núcleos. **No es 2× + 2×.**

**Plan acordado**: tres cortes de medición — antes de A, después de A y antes de C, después de los dos — y decidir con los números, incluida la opción de revertir C.

#### Resultado: C **se implementó, se midió y se revirtió**

Suma de inferencia de NER sobre los 26 documentos:

| corte | total | contra el anterior |
|---|---|---|
| antes de A | 13 564 ms | — |
| **después de A** | **6 287 ms** | **−53,6 %** |
| después de A **y** C | 6 386 ms | **+1,6 %** |

C no aporta nada sobre A: lo empeora, dentro del ruido. Y el detalle que lo confirma es dónde empeora — los documentos de **dos páginas**, los únicos donde C podía rendir, son los que más suben (`doc-001` 650 → 896 ms, `doc-024` 126 → 234 ms). Son los hilos que A le dio a ONNX compitiendo con los dos workers de C por los mismos núcleos.

La calidad no se movió en ninguno de los cortes (61/61, 12/17, 84/97), así que **el riesgo de la cadena difusa no llegó a materializarse** — pero eso ya no importa para decidir: sin ganancia, no hay nada que justificar.

**Queda revertido.** Si alguna vez A no se puede activar (ver arriba: depende del hosting), C vuelve a la mesa — y ahí sí habría que resolver primero el orden de `findMatchingGroup`.

#### El riesgo de orden es más chico de lo que parecía, y está acotado

La **numeración** es inmune al orden por diseño: ADR-028 renumera canónicamente por primera aparición documental antes de `GROUPING_FINISHED`, y el comentario de `grouping.engine.ts:1009` dice explícitamente que el orden de llegada de `ENTITY_FOUND` ya es *"no-determinístico entre corridas — motores en paralelo"*.

Lo que **sí** queda expuesto: `findMatchingGroup` (`grouping.engine.ts:1891`) devuelve el **primer** grupo cuyo alias pasa el umbral (0,88). Con tres variantes encadenadas, el resultado depende del orden:

```
A = "juan perez"  ·  B = "juan peres"  ·  C = "juan pares"
A~B = 0,90 ✓         B~C = 0,90 ✓         A~C = 0,80 ✗
```

| orden | resultado |
|---|---|
| A, B, C | A crea G1 · B matchea A y entra · C matchea **B** (ya alias de G1) → **un grupo de tres** |
| A, C, B | A crea G1 · C no matchea A → **crea G2** · B matchea A → G1 → **dos grupos** |

Verificado que **no hay fusión automática posterior** que lo repare: fusionar es `GROUP_MERGE_REQUESTED`, una acción del usuario (`grouping.engine.ts:2043`, ADR-082 §7).

**Decisión tomada: medir antes de resolver.** Requiere tres variantes encadenadas del mismo nombre con el umbral justo en el medio; puede no ocurrir nunca en un documento real. Si ocurre, las salidas son (a) desacoplar —inferencia en paralelo, Grouping consumiendo en orden documental con buffer— o (b) mejor-match en vez de primer-match, que reduce pero no elimina.

### D. El arranque baja 537 KiB gz de librerías que quizá no se usan

Medido sobre el build real:

| | raw | gz |
|---|---|---|
| chunk inicial (`index-*.js`) | 1,75 MB | **537 KiB** |
| todo el JS | 3,69 MB | 1,16 MiB |

El chunk inicial es el **46 % de todo el JS** y baja antes de abrir un documento. Contiene el código real de Transformers.js (183 apariciones de símbolos internos), ONNX, pdf-lib, pdf.js y Tesseract — y **están duplicados** en los chunks de los workers (Transformers otra vez en el de NER, pdf-lib en el de export, pdf.js en los de pdf y render). Bajo el objetivo contractual de 800 KB gz, pero con 33 % de margen.

**D1 — barato, recomendado.** Lo que arrastra las librerías es un `import` estático de kernel por motor (`ocr.engine.ts:52`, `ner.engine.ts:55`, `export.engine.ts:158`), usado solo dentro del closure que va a la pool. Y `IMMEDIATE_POOL.dispatch` ya devuelve una promesa (`dispatch: (params) => params.run()`), así que el `run` puede ser `async` sin tocar el contrato de la pool:

```ts
run: async () => (await import("./worker/kernel.js")).kernelRecognize(payload, ...)
```

Tres cambios chicos, **un motor cada uno** — encajan con R-1 sin fricción. Riesgo de calidad: ninguno (cambia *cuándo* carga, no *qué* hace). Hay que cuidar que el camino in-process que usan los tests siga funcionando.

**D2 — DIFERIDO, a rediscutir al cerrar las tareas actuales.** pdf.js no entra por un kernel: `pdf.engine.ts:20` lo importa directo para la lógica del motor, y **esa misma clase corre adentro del worker** (`worker/entry.ts`), por eso los ADRs lo llaman "el único motor sin puerto interno". Separarlo pide construirle un kernel que hoy no existe → ADR de arquitectura interna.

> **Aclaración que quedó registrada porque se prestó a confusión**: D2 **no** es la opción B del hallazgo E (ADR-097, `Post_Hito10.8_Pendientes.md` §24). Aquella reimplementaba *lo que pdf.js hace* —espacios sintetizados, `/ActualText`, normalización Unicode— y por eso nos volvía mantenedores de un componente ajeno. **D2 solo mueve dónde vive un `import`**: pdf.js sigue haciendo exactamente todo lo que hace. B cambiaba qué código corre; D2 cambia cuándo se descarga el mismo código.
>
> Se difiere igual, por dos razones propias: el costo del ADR de arquitectura, y que pdf.js se necesita apenas se importa el documento, así que rinde poco.

---

## Robustez: dos O(n²) reales — incorporados al siguiente plan el 2026-09-20

Las mediciones siguientes son las del relevamiento original. El objetivo 4 del
plan nuevo empieza por reproducirlas contra el código vigente.

- **`email`** (`default-ar.ts:284`) se cuadra sobre texto sin `@` denso en dígitos y guiones (OCR corrupto, tabla mal separada). **Remedido a mano**: 7,4 ms (2 K chars) → 161 (10 K) → 639 (20 K) → **2539 (40 K)**. A 160 KB son decenas de segundos de hilo principal bloqueado, sin cancelación (Regex corre síncrono). Los patrones default **no** tienen el timeout que `Regex_Engine.md` §12 sí prevé para los custom.
- **El pase difuso de Grouping** (`grouping.engine.ts:1895`): 2000 entidades distintas → 2,1 s. Es el peor caso adversarial; en un documento real la mayoría repite y resuelve por match exacto antes de llegar. **El caso típico no está medido.**

---

## Descartado **con medición** — no reinvestigar

- **OSD siempre**: reconfirmado. OSD cuesta ~440 ms contra ~39 s de leer mal una página rotada.
- **Core legacy de Tesseract**: ya es legacy solo para OSD y LSTM para el reconocimiento (`createWorker` deja `oem` en su default). No hay nada que separar.
- **Over-render de `EntitiesPanel`**: existe, pero recomputar el árbol cuesta 0,035 ms sobre 3000 grupos. No tocar.
- **Las 14 patrones de Regex sobre texto normal**: 3,5 ms por página densa. Irrelevante frente a NER.
- **Worker de Tesseract y modelo NER**: se cachean entre páginas, no se recrean. Correcto.
- **Blob URLs, `PDFDocumentProxy`, LRU de render**: sin fugas evidentes.
- **Adelantar la carga del modelo NER para solaparla con el OCR** (2026-09-17): tres
  rondas intercaladas `A1→B1→B2→A2` sobre P2, un solo build instrumentado. Ni el
  disparo al empezar el OCR ni el del 75 % dieron una mejora estable de
  `import→Ready`; el primero subió el pico de RSS 144–422 MB en las tres rondas.
  Lo que cierra el tema: la oportunidad entera eran **0,94 s** de `modelLoadMs`
  frío, y la deriva del banco entre dos controles idénticos de una misma ronda
  fue de **0,06, 1,83 y 2,54 s** — el premio es más chico que el error de
  medición. Cargar el modelo al abrir la aplicación está descartado aparte, sin
  medir, por `idleDisposeMs` de 60 s y memoria ocupada sin documento. Ver
  [`Precalentamiento_NER_Durante_OCR_Medicion.md`](Precalentamiento_NER_Durante_OCR_Medicion.md)
  §7 y ADR-154 §2 lever 3.

---

## La calidad del OCR, medida por primera vez

`pnpm test:measure` con `MEASURE_SCAN=1` rasteriza cada documento del dataset **dentro de la misma página** —con el helper que ya usa el escenario 2 de `tests/e2e/`— y lo pasa por el pipeline sin capa de texto. El ground truth es el del documento de texto: son el mismo documento, así que **la diferencia entre las dos corridas es la calidad del OCR**.

Se hace en el momento y no con un fixture commiteado porque rasterizar necesita un canvas de browser: un binario escaneado en el repo sería un archivo que CI no sabe regenerar.

| | vía texto | vía OCR |
|---|---|---|
| recall de Regex | 61/61 (100 %) | **56/61 (91,8 %)** |
| recall de NER | 12/17 (70,6 %) | 12/17 (70,6 %) |
| precisión | 84/97 (86,6 %) | 80/95 (84,2 %) |

Las cinco que se pierden son **emails e IBAN** — cadenas alfanuméricas largas, donde un carácter mal leído rompe el patrón entero. Los nombres sobreviven: NER no se mueve.

**Sigue sin medirse** cuánto de esto es del OCR y cuánto del rasterizado sintético: el escaneo lo produce el mismo browser a partir de un PDF limpio, así que no tiene ruido, torcido ni manchas. Un escaneo real va a ser peor.

---

## El agujero de fondo: no hay dónde apoyar el "antes y después"

**Diagnóstico histórico del 2026-08-27.** Desde entonces existen `tests/perf/`,
`tests/cancel/` y las campañas T-9..T-13; los instrumentos de memoria no equivalen
todavía a gates de presupuesto. El texto siguiente explica el punto de partida,
no el estado actual de la infraestructura.

`package.json` define `test:perf`, `test:stress`, `test:leak` y `test:cancel` (líneas 31-34) y **los cuatro directorios no existen**. Ninguna métrica contractual de `07_Performance_Strategy.md` §1 tiene medición automatizada.

Y `test:quality` corre **con NER apagado** (ADR-095 §5), así que hoy no hay forma de medir si un cambio en NER baja el recall. Cinco de los seis cambios de este plan tocan cosas cuya calidad no sabemos medir.

---

## Plan acordado

| orden | qué | por qué ahí |
|---|---|---|
| ~~**0**~~ | ~~montar la medición que falta~~ — **hecho**: `pnpm test:measure` (`tests/measure/`), con recall de NER medible por primera vez | sin esto, "no bajó la calidad" es una opinión |
| ~~**1**~~ | ~~truncamiento silencioso~~ — **hecho**: ADR-098 | el único que ya estaba costando calidad |
| ~~**2**~~ | ~~**D1**~~ — **hecho**: ADR-099, chunk inicial de 549 a 208 KB gz (−62 %) | foco declarado nº 1, riesgo cero, tres cambios chicos |
| ~~**3**~~ | ~~**A** (aislamiento para ONNX Runtime)~~ — **hecho**: ADR-100/130/132; medición inicial: −53,6 % de inferencia, calidad intacta | la ganancia más grande; verificación posterior en el shell |
| ~~**4**~~ | ~~**B** (OCR en paralelo)~~ — **hecho**: ADR-101, −22 % a −27 % en documentos de dos páginas | limpio, sin riesgo de calidad |
| ~~**5**~~ | ~~**C**~~ — **medido y REVERTIDO**: no aporta nada sobre A | tres cortes; revertir si A ya se llevó la ganancia |
| — | **D2** | **diferido** |
| — | **Los dos O(n²)** | incorporados al objetivo 4 del plan del 2026-09-20 |

La duplicación de lógica se apartó a [`Duplicacion_De_Logica.md`](./Duplicacion_De_Logica.md): no hace la herramienta más rápida y es una campaña propia.

---

## Próximos objetivos — tiempo, consumo y perfiles (2026-09-20)

**Estado: planificado, sin ejecutar.** Decisión del humano: explorar el beneficio
de hilos/workers y su costo de memoria, conservando la calidad. Un mayor consumo
puede justificar una mejora de velocidad; el resultado debe permitir elegir ese
compromiso por perfil. No se cambian presupuestos ni defaults con este plan.

Base: `Ciclos_Y_Documentos_Reales_Medicion.md` §9 y
`Banco_Windows_Comparativa_Medicion.md`. NER domina el documento nativo real;
en R2 los dos reconocedores OCR estuvieron ocupados ~98 % de su etapa, frente al
18–19 % del OSD compartido. La campaña de recursos conserva su orden propio
**2 → revisión del plan → 1 → 3** (`Optimizacion_De_Memoria_Plan.md` §2ter).

### 1. Aprovechar más hilos dentro del único worker NER

- Comparar el control efectivo actual con **4, 6 y 8 hilos de ONNX**, donde el
  hardware permita esas configuraciones. Registrar la cantidad efectiva, no solo
  el valor solicitado; mantener un único worker/modelo NER.
- Medir carga, inferencia, tiempo hasta `Ready` y panel visible, memoria y
  comportamiento bajo carga sostenida en macOS y Windows nativo.
- Verificar igualdad de detecciones; más hilos no se presupone más rápido.
  Entregar la curva tiempo/consumo y el punto donde agregar hilos deja de compensar.

### 2. Aprovechar más workers de reconocimiento OCR

- Comparar **2, 3 y 4 reconocedores LSTM**, conservando el OSD compartido,
  la configuración de 300 DPI y las reglas actuales de calidad.
- Medir ocupación efectiva, preparación/cola y tiempo total. Los 90–148 MB de
  WASM por reconocedor observados son una referencia, no su costo total ni un
  valor garantizado para todo documento.
- Mantener el presupuesto de imágenes vivas y registrar si limita la concurrencia.
  Si impide ocupar los workers adicionales, documentar y evaluar por separado ese
  cambio; no alterar a escondidas dos variables en la misma comparación.
- Entregar tiempo ganado frente a memoria adicional, calidad y capacidad de
  cancelación. La selección final será por perfil y capacidad del equipo.

### 3. Varios fragmentos independientes por inferencia NER

Evaluar soporte y costo de procesar varias entradas en un mismo lote, agrupando
longitudes similares. Preservar los límites de tokens y el contexto independiente
de cada fragmento; no concatenar páginas como una sola secuencia. Medir memoria
temporal, tiempo por lote y total, huella de detección y orden de entrega a Grouping.
Los cambios de protocolo o contrato requieren ADR y specs previos a la implementación.
No hay ganancia cuantificada todavía.

### 4. Acotar los peores casos de Regex y Grouping

Retomar los dos casos cuadráticos del relevamiento: patrón de email sobre texto
adverso y búsqueda difusa con muchas entidades distintas. Primero reproducirlos
sobre el código vigente y un rango de tamaños; luego planificar cada módulo por
separado. Comprobar tanto el caso patológico como documentos normales, preservar
detecciones/agrupaciones y medir bloqueo del hilo principal y cancelación.
Es un objetivo de robustez temporal; no se atribuye a estos casos el costo de R1/R2.

### 5. Revisar perfiles con las curvas de hilos y workers ya medidas

**Depende de los objetivos 1 y 2 y de revisar sus resultados.** Es el siguiente
paso después de esas mediciones; no necesita esperar a que terminen 3 y 4. Si
esos objetivos cambian después el costo, se vuelve a validar la matriz de perfiles.

El producto actual tiene `auto`, `low` y `high`
(`apps/react-client/src/core-adapter/settingsToEngineConfig.ts`): Bajo fija todos
los pools en 1; Alto fija PDF/Render en 4 y OCR/NER en 2; Automático no envía
override y utiliza `buildDefaultEngineConfig`. Estos valores configuran capacidad
de pools, **no los hilos internos de ONNX**. El recorrido secuencial de NER usa
un solo worker aunque el pool admita dos. El perfil futuro debe expresar el
trabajo efectivo que se midió, no equiparar plazas configuradas con workers vivos.

**Propuesta a concretar con los resultados:** Bajo, Intermedio, Alto y Automático.
Automático selecciona uno de los tres niveles según los recursos detectados del
equipo y una política derivada de las mediciones. Debe mostrar el nivel resuelto;
ejemplo de comportamiento solicitado por el humano:

> Selecciono Automático → aparece «Modo automático — consumo/rendimiento medio».

«Medio» corresponde al nivel Intermedio. Es un ejemplo de presentación futura,
no un texto ni un cuarto valor ya implementados en el producto.

Entregables de esta revisión:

- **Matriz por nivel:** hilos de ONNX, workers OCR y capacidad del resto de los
  pools, con tiempo y memoria medidos. El nivel Alto podrá consumir más memoria
  cuando la aceleración lo justifique; no se fijan cantidades ni umbrales antes
  de medir, ni se relajan automáticamente los presupuestos de ADR-146.
- **Política automática verificable:** considerar CPU/concurrencia y RAM con las
  señales realmente disponibles en cada plataforma. Evaluar si hace falta memoria
  disponible/presión del sistema además de capacidad instalada. Declarar reservas
  para el SO, límites y comportamiento conservador ante información ausente.
  Consultar hardware no demuestra por sí solo un «óptimo»: la asignación debe estar
  respaldada por la curva medida. Si necesita datos del shell, especificar el
  contrato seguro; el Core no consulta el SO directamente.
- **Preferencia y resultado separados:** persistir que el usuario eligió Automático
  y resolver su nivel para ese equipo; mostrar cuál está activo y conservar la
  elección manual. Definir cuándo se recalcula y cuándo entra en vigor un cambio,
  respetando el documento abierto y sus ediciones. No se presupone redimensionar
  pools en caliente.
- **Implementación posterior con ADR/specs:** cerrar nombres, tipos, migración de
  settings existentes, configuración de hilos y mapeo UI/Core antes de tocar
  código. Validar selección automática en equipos de distintas capacidades y
  comprobar que el nivel mostrado corresponde a la configuración efectiva.

### Método y alcance de la siguiente etapa

Para cada experimento: control y variante intercalados, misma sesión/corpus/build
identificable, una variable por vez y medición fría/caliente declarada. Usar
fixtures y documentos reales con el protocolo de confidencialidad de T-10.
Comparar cada plataforma contra su propio control y medir Windows nativo, no WSL.
Registrar ruido, presión del sistema o su falta de observación, tiempo total,
memoria por fase, M1/M2/pico posterior a `Ready`, calidad y cancelación.

No aceptar una ganancia por un porcentaje aislado ni por la cantidad nominal de
hilos/workers: entregar la curva de costo/beneficio y sus límites. Las corridas
de tiempo deben controlar el efecto de los instrumentos de memoria. La revisión
de perfiles usa esos resultados; no promete mejoras ni configura niveles nuevos
antes de conocerlos. **Los experimentos ya descartados permanecen fuera de este
plan**; sus registros anteriores se conservan como historial.
