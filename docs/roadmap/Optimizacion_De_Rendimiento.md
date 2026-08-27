<!-- CONTEXT: scope=roadmap | dependencias=architecture/07_Performance_Strategy.md,core/NER_Engine.md,core/OCR_Engine.md,core/Grouping_Engine.md,roadmap/Duplicacion_De_Logica.md | audiencia=humanos+IA | fase=por-planificar -->

# Optimización de rendimiento — hallazgos y plan

> **Procedencia**: relevamiento del 2026-08-27 con cuatro agentes de investigación (carga/arranque, OCR por página, NER por página, duplicación+UI). **Cada número de este documento fue verificado a mano** contra el código o remedido; lo que no se pudo medir está marcado como tal.

**Estado**: relevado, plan acordado, **nada implementado**.

## Los dos focos

1. Velocidad de carga de la herramienta y de los motores.
2. Eficiencia por página **sin sacrificar calidad de la entrega final**.

Regla de trabajo fijada por el humano: **no se cambia nada sin haber medido antes y después**, tiempo y calidad. Ninguna decisión la toman los agentes ni el asistente.

---

## Lo primero no es velocidad: se está perdiendo detección en silencio

`batchSize` corta en **256 palabras** (`config.ts:93`) pero el modelo trunca en **512 tokens** (`model_max_length: 512` y `max_position_embeddings: 512`, verificados en el `tokenizer_config.json` / `config.json` del modelo mirroreado). `computeWordChunks` (`ner.engine.ts:250`) cuenta palabras; el kernel **no chequea la longitud en tokens en ningún lado** (grep de `max_length`/`truncation` en `ner-engine/src/worker/kernel.ts`: vacío).

La razón tokens/palabra no es constante. Medido con el **tokenizer real del modelo**:

| texto | 256 palabras → tokens | ratio | |
|---|---|---|---|
| prosa natural | 364 | 1,42 | ok |
| **párrafo legal denso** (nombres + DNI + CUIT + teléfono) | **654** | 2,55 | **TRUNCA** |
| identificadores puros | 1567 | 6,12 | **TRUNCA** |

Con `truncation: true` y sin `max_length` explícito, Transformers.js **descarta la cola sin error, warning ni log**. En un párrafo legal denso se pierde ~22 % del batch. Regex sigue cubriendo esa zona para sus tipos; **Persona, Organización, Dirección y Fecha que caigan ahí no las ve nadie**.

Es el tipo de documento al que apunta el producto.

---

## Velocidad — ordenado por ganancia sobre riesgo

### A. El WASM corre en un solo hilo

`crossOriginIsolated` es `false` y no hay `SharedArrayBuffer`, así que `onnxruntime-web` fuerza `numThreads = 1`. El motor nunca toca `numThreads` (`ner-engine/src/worker/kernel.ts`, `configureTransformersEnv`): queda en el default de la librería.

El propio repo ya lo admite — `07_Performance_Strategy.md` línea 232: *"`performance.measureUserAgentSpecificMemory()` exige `crossOriginIsolated` (COOP/COEP), **headers que la app de producción no lleva**"*.

- **Ganancia**: la más grande de todas si se confirma. **NO MEDIDA** — activarla exige mandar `COOP: same-origin` + `COEP: require-corp`.
- **Riesgo de calidad**: ninguno. No toca tokenización, agregación BIO ni umbral.
- **Costo**: mediano. No toca ningún paquete de `packages/`; es infraestructura de la app. Hay que auditar que no rompa la carga de recursos cross-origin.

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

## Robustez: dos O(n²) reales, fuera del plan por ahora

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

---

## El agujero de fondo: no hay dónde apoyar el "antes y después"

`package.json` define `test:perf`, `test:stress`, `test:leak` y `test:cancel` (líneas 31-34) y **los cuatro directorios no existen**. Ninguna métrica contractual de `07_Performance_Strategy.md` §1 tiene medición automatizada.

Y `test:quality` corre **con NER apagado** (ADR-095 §5), así que hoy no hay forma de medir si un cambio en NER baja el recall. Cinco de los seis cambios de este plan tocan cosas cuya calidad no sabemos medir.

---

## Plan acordado

| orden | qué | por qué ahí |
|---|---|---|
| **0** | montar la medición que falta (NER medible + línea de base de tiempos) | sin esto, "no bajó la calidad" es una opinión |
| **1** | truncamiento silencioso | el único que ya está costando calidad |
| **2** | **D1** | foco declarado nº 1, riesgo cero, tres cambios chicos |
| **3** | **A** (COOP/COEP) | la ganancia más grande; medir antes de comprometerse |
| **4** | **B** (OCR en paralelo) | limpio, sin riesgo de calidad |
| **5** | **C**, remidiendo | tres cortes; revertir si A ya se llevó la ganancia |
| — | **D2**, los dos O(n²) | **diferidos**, a rediscutir al cerrar lo anterior |

La duplicación de lógica se apartó a [`Duplicacion_De_Logica.md`](./Duplicacion_De_Logica.md): no hace la herramienta más rápida y es una campaña propia.
