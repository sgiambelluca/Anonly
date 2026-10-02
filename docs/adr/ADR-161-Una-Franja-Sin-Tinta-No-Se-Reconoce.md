<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-120-Una-Hoja-Torcida-Se-Lee-Enderezada.md,adr/ADR-147-Perder-Un-Identificador-Cubierto-Es-Una-Regresion.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-160-El-Worker-De-OCR-No-Decodifica-La-Pagina.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md | audiencia=humanos+IA | fase=11 -->

# ADR-161 — Una franja sin tinta no se reconoce

- **Estado**: Accepted, **parcialmente superseded por ADR-162**. T-4 implementa
  la compuerta exacta de blanco; la calibración de §Decisión.1–3 queda como
  T-4b, bloqueada por corpus.
- **Fecha**: 2026-09-12
- **Decidido por**: El planificador, sobre el conteo de pasadas de OCR por página
  y la lectura del fork de Tesseract que compila `tesseract.js-core`.
- **Relacionado con**: ADR-121 (las pasadas que este ADR condiciona), ADR-147
  (la baseline que decide el umbral), ADR-149 §2 (un gate necesita su
  discriminante), ADR-160 (el otro lever del mismo camino), ADR-154 §2
- **Parte de**: Hito 11 — Hardening

> **Enmienda 2026-09-13 (ADR-162).** La auditoría previa a implementación
> confirmó que este documento no fijaba el umbral de luminancia, el mínimo de
> densidad ni el “margen” bajo el piso, y que la baseline/caso positivo de
> ADR-147 todavía no existen. T-4 no inventa esos valores: saltea solo una
> franja visualmente blanca mediante el predicado exacto de ADR-162. El
> procedimiento calibrado de §Decisión.3 sobrevive con el nombre **T-4b** y no
> se implementa ahora.

## Contexto

### 1. Cuatro de cada seis pasadas son para márgenes casi siempre vacíos

`kernelRecognize` hace **seis** reconocimientos de Tesseract por página: uno de
OSD, el principal, y **cuatro de ADR-121** — franja izquierda y derecha, cada una
a 90° y a 270°. Las cuatro corren **siempre**, sin ninguna condición.

El propio ADR-121 midió lo que rinden en el caso normal:

> Sobre un documento SIN texto rotado la regla filtra todo: medido sobre
> `text-10p.pdf`, las cuatro pasadas producen 4 candidatas y entran **0**. Lo
> único que cambia ahí es el reloj.

**"Lo único que cambia es el reloj" es incorrecto, y ése es el hallazgo nuevo.**
Cada `SetImageFile` materializa una copia completa de la imagen **dentro del heap
de WASM**: en `Balearica/tesseract@5a21eeb`, `src/ccmain/thresholder.cpp:163`,
`ImageThresholder::SetImage` termina en

```cpp
  // Guarantee that we always end up with our own copy, not just a clone of the input.
  pix_ = src.copy();
```

O sea que las cuatro pasadas de margen no cuestan solo tiempo: cuestan **cuatro
ciclos de decodificar-y-copiar por página en el heap que nunca se achica**, que
es exactamente donde `H-10_Bitacora_De_Memoria.md` §7 ubicaba lo "irreducible
dentro de una corrida". No era irreducible: una parte es trabajo que se puede no
hacer.

### 2. Por qué no alcanza con ADR-160

ADR-160 saca las materializaciones de página del lado de JS y de los canvas. **No
toca el heap de WASM**, porque los bytes igual entran al core y el core igual
copia. Los dos levers actúan sobre el mismo camino y no se solapan: uno achica lo
que ponemos nosotros, el otro achica **cuántas veces** se lo damos a Tesseract.

### 3. El modo de falla es asimétrico, y eso decide la forma del gate

Las dos direcciones del error **no cuestan lo mismo**:

- **Correr las cuatro pasadas sobre un margen vacío**: se pierde tiempo y memoria.
  Molesto, reversible, invisible para el usuario.
- **Saltear un margen que sí tenía texto**: un sello de notificación, un número de
  expediente al costado o una firma lateral **no se detecta y sale sin tapar**.
  Es una fuga de datos personales en un documento que el usuario cree anonimizado.

No es una disyuntiva entre dos costos comparables. **El sello de notificación en
el margen es, además, una de las fugas que la revisión externa ya había
señalado**, así que es exactamente el dato que este motor no puede perder.

Por eso este ADR **no** trata el umbral como un parámetro a afinar por
rendimiento: lo trata como una cota de seguridad, y su valor sale de medir, no de
elegir.

## Decisión

### 1. Las pasadas de franja se condicionan a que haya tinta en la franja

Antes de las cuatro pasadas de ADR-121, cada franja se evalúa con una métrica de
tinta barata sobre sus propios píxeles —proporción de píxeles por debajo de un
umbral de luminancia, calculada en una sola pasada lineal sin canvas ni
Tesseract—. Si la franja no llega al mínimo, **sus dos pasadas se saltean**.

La evaluación es **por franja**, no por página: una página con sello a la
izquierda y margen derecho limpio corre dos pasadas en vez de cuatro.

### 2. El sesgo es explícito: ante la duda, se reconoce

El umbral se elige para que **ninguna franja con texto quede por debajo**, no
para maximizar cuántas se saltean. Una franja dudosa se reconoce. Si la métrica
falla al calcularse por cualquier motivo, **se reconoce** — mismo criterio que el
guard de ADR-121, donde un fallo de franja nunca cuesta el texto derecho.

### 3. El umbral no se fija en este ADR. Sale de este procedimiento

**El número no se elige: se mide.** Sobre el corpus de ADR-147, y **antes** de
activar el gate:

1. Para cada página del corpus, calcular la métrica de tinta de cada franja **y**
   correr las cuatro pasadas como hoy, registrando las dos cosas.
2. Separar las franjas que produjeron **al menos una palabra aceptada** (la que
   pasa la regla de fusión de ADR-121: sin solape con el texto derecho y por
   encima de `ROTATED_MIN_CONFIDENCE`) de las que produjeron cero.
3. El piso admisible es el **mínimo de la métrica entre las franjas que sí
   produjeron palabra**. El umbral se fija **por debajo de ese piso, con margen**,
   no en el piso.
4. **Criterio de aceptación, no negociable**: con el umbral elegido, el corpus
   de ADR-147 tiene que dar **exactamente las mismas ocurrencias** que sin el
   gate. Una sola palabra perdida invalida el umbral — es la regla de ADR-147, y
   acá se aplica sin excepción.

Si el corpus no tiene ninguna franja con texto rotado, **el procedimiento no se
puede completar y el gate no se activa**: no hay dato para elegir el piso, y
elegirlo igual sería inventarlo. En ese caso el trabajo previo es conseguir esos
casos, no ajustar el número.

### 4. El gate necesita su discriminante

ADR-149 §2: un test que pase porque no ejercita nada es peor que no tenerlo. Se
exigen **las dos direcciones**:

- Una franja **con** texto rotado: la métrica la deja pasar y las palabras salen
  igual que antes del ADR.
- Una franja **vacía**: la métrica la corta y las dos pasadas **no se invocan**
  (verificable contando llamadas al doble de `recognize`, no por el resultado —
  el resultado ya era vacío antes y no discrimina nada).

Sin el segundo test, el ADR no tiene evidencia de estar haciendo nada; sin el
primero, no tiene evidencia de ser seguro.

### 5. Lo que no cambia

La regla de fusión de ADR-121 —umbral de solape, `ROTATED_MIN_CONFIDENCE`, el
mapeo de cajas, el guard que impide que una franja fallada cueste el texto
derecho— queda **intacta**. Este ADR decide **si** una franja se reconoce, nunca
qué palabra entra una vez reconocida. Tampoco toca `MARGIN_STRIP_RATIO`,
`OcrConfig`, ni ningún contrato público. Un solo módulo: `ocr-engine`.

### 6. Cómo se verifica el ahorro

Mismo criterio que ADR-160 §6, y por el mismo motivo:

1. **Conteo de pasadas por página** — determinístico, sin ruido: seis en una
   página con los dos márgenes escritos, **dos** en una con los dos limpios. Es el
   criterio de más peso.
2. **Pico por proceso** dentro de `OCR_STARTED → OCR_FINISHED`, contra la línea
   de base vigente, con el instrumento de ADR-159 sin cambiar de versión entre el
   antes y el después. **Acá el que más tiene que moverse es Tab**, no GPU: lo que
   se ahorra vive en el heap de WASM, que es del renderer (al revés que ADR-160).
3. **Tiempo**: las cuatro pasadas son ~4/6 del trabajo de Tesseract por página.
   Es el único lever de la campaña que mejora el presupuesto de tiempo en vez de
   gastarlo.

## Consecuencias

**A favor**

- Ataca el heap de WASM, que es la mitad del fenómeno que ADR-159 §8 dejó fuera
  del alcance del instrumento y que §7 de la bitácora daba por irreducible.
- **Mejora memoria y tiempo a la vez.** Es el único de la lista que no paga uno
  con el otro (ADR-154 §1).
- No toca resolución, ni paralelismo, ni el contrato.

**En contra**

- **Introduce una decisión que puede perder datos**, que es lo que ninguno de los
  levers anteriores hacía. §2 y §3 existen para acotarlo, pero el riesgo residual
  no es cero: una página cuyo sello sea tenue y quede bajo el umbral se pierde en
  silencio. Por eso el criterio de §3.4 es "cero palabras perdidas", no "pérdida
  aceptable".
- **Depende de un corpus que puede no tener el caso.** Si ADR-147 no contiene
  franjas con texto rotado, este ADR queda bloqueado por falta de datos (§3), y
  eso es un resultado válido: mejor bloqueado que calibrado a ojo.
- La métrica de tinta es una heurística sobre píxeles. Un margen con ruido de
  escaneo puede pasar el umbral sin tener texto: eso **no** es un defecto (se
  reconoce de más, que es el lado barato del error), pero reduce el ahorro real
  sobre escaneos sucios respecto del estimado sobre un fixture limpio.

**Lo que no toca**: la regla de fusión de ADR-121, `MARGIN_STRIP_RATIO`, el DPI,
el paralelismo, ni ningún contrato público.
