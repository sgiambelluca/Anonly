<!-- CONTEXT: scope=adr | dependencias=core/NER_Engine.md,core/Orchestrator.md,core/Contracts.md,adr/ADR-157-El-Pool-De-OCR-Se-Da-De-Baja-Al-Terminar-Su-Etapa.md,adr/ADR-080-Idle-Dispose-En-El-Pool-No-En-El-Manager.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,roadmap/Perfilado_Base_Caliente_Medicion.md,roadmap/Perfilado_NER_Interno_Medicion.md | audiencia=humanos+IA | fase=11 -->

# ADR-166 — El modelo de NER se libera al terminar la detección

- **Estado**: Accepted. Sin implementar.
- **Fecha**: 2026-09-17
- **Decidido por**: El humano, sobre el resultado de T-7: _"seria mas correcto a nivel de costo/beneficio liberar la memoria del NER cuando termina y luego volver a cargarlo en caso de ser necesario. Principalmente por lo que tarda en cargar el modelo NER, que es basicamente un segundo, en contraposición a poder liberar aproximadamente 1GB de memoria ram por mas que sea por un minuto."_
- **Relacionado con**: ADR-157 (el mismo criterio, aplicado a OCR), ADR-080 (la liberación por inactividad, que acá también llega tarde), ADR-154 §2 lever 3 (bajar el sostenido baja el pico del documento siguiente), ADR-038 (el reanálisis, la excepción)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. El número, medido

T-7 (`roadmap/Perfilado_Base_Caliente_Medicion.md`) extendió la observación a
120 s después de cerrar el documento, con NER activo —el caso de uso real, no el
corte de atribución sin NER—:

| perfil | base a ≤30 s | piso a 120 s | se libera |
| ------ | -----------: | -----------: | --------: |
| P1 — 10 p de texto | 1506,0 MB | 583,9 MB | **922,1 MB** |
| P2 — 50 p escaneadas | 1393,7 MB | 366,1 MB | **1027,6 MB** |

Alrededor de **1 GB se libera solo**. El problema no es que no se libere: es
**cuándo**. `idleDisposeMs` son 60 s desde que el pool queda ocioso, y ese minuto
transcurre entero mientras el usuario revisa el documento — o abre el siguiente.

### 2. Qué vuelve a necesitar NER, verificado

Mismo ejercicio que ADR-157 §3 hizo para OCR, sobre el código actual:

- **Agregar una entidad a mano**: **no**. `addManualEntity` resuelve por
  `regex.findLiteral` sobre el `Document` ya fusionado (`orchestrator.ts`); el
  motor de NER no participa.
- **Exportar**: no. El export va por Render.
- **Reanalizar activando NER** (`ReanalyzeConfigPatch.ner.enabled: true`): **sí**,
  por `runReanalyzeNerOnFlow`.
- **Reanalizar cambiando los idiomas de OCR** (`ocr.languages`): **sí**, porque
  `runReanalyzeOcrFlow` re-detecta.

`engines.ner.processPages` tiene exactamente tres invocadores: la detección
inicial y esos dos flujos de reanálisis. Los dos son acciones explícitas del
usuario sobre un documento abierto, la misma categoría de excepción que ADR-157
aceptó para el cambio de idiomas.

### 3. En qué se parece a ADR-157, y en qué no

**Se parece** en lo esencial: un heap de WebAssembly no se puede achicar
(`WebAssembly.Memory` tiene `grow()` y no tiene contraparte), así que terminar la
instancia es la única forma de recuperar esa memoria, y la liberación por
inactividad llega tarde para el calendario real de este pool.

**No se parece** en por qué llega tarde, y conviene no copiar el argumento sin
mirarlo. En OCR, el minuto de inactividad transcurría **durante la detección**,
o sea en el momento de mayor consumo: liberar ahí bajaba el pico del documento en
curso. En NER, el minuto transcurre **después de `PIPELINE_READY`**, cuando no
hay otra etapa corriendo. **Liberar NER al terminar no baja el pico del documento
actual.**

Lo que baja es otra cosa, y ADR-154 §2 lever 3 ya la había nombrado: el nivel
sostenido mientras el usuario revisa, y con él **el punto de partida del
documento siguiente** — el "residuo del documento anterior" que ADR-146 §7bis
encontró contaminando las corridas calientes. En una sesión de trabajo real, que
es abrir varios expedientes seguidos, ese punto de partida es el que manda.

De paso, esto corrige una afirmación de ADR-157 §2: _"Para NER funciona: su etapa
termina, el usuario se queda revisando, y al minuto el pool se libera solo"_. Se
escribió sin el número de arriba. Funciona, sí, pero un minuto tarde y con ~1 GB
en juego.

### 4. Esta es la pregunta que ADR-157 §4 dejó abierta

ADR-157 no omitió a NER por descuido: lo dejó fuera **a propósito y por escrito**,
con dos argumentos.

> _"Su pool sí es liberado a tiempo por el temporizador de ADR-080 (§2), y darlo
> de baja al llegar a `Ready` cambiaría el costo del reanálisis de NER, que es la
> acción más frecuente de las dos. Es una pregunta propia y no se resuelve acá."_

El primer argumento **queda refutado** por §1: liberar "a tiempo" son 60 s tarde y
~1 GB de por medio. Ese número no existía en septiembre 11.

El segundo **sigue en pie y se acepta como costo**: reanalizar NER es, en efecto,
más frecuente que cambiar los idiomas de OCR, así que este cambio se paga más
seguido que el de ADR-157. Lo que cambió no es el argumento sino que ahora **los
dos lados tienen número**: 942,94 ms por reanálisis contra ~1 GB durante toda la
revisión. ADR-157 §4 pospuso con las dos incógnitas abiertas y dijo que era una
pregunta propia; este ADR es esa pregunta, resuelta con las dos medidas sobre la
mesa.

## Decisión

### 1. El pool de NER se da de baja al terminar la detección

`NerEngine` expone su propia baja, espejo de la de `OcrEngine` (ADR-157 §1bis):
termina los workers vivos **sin disponer el pool**, que sigue usable y se
reconstruye perezoso en el próximo `dispatch` (ADR-080). El Orchestrator la
invoca al cerrar la etapa de detección, en los caminos terminales — éxito,
cancelación y fallo — igual que ya hace con OCR.

La guarda es la misma y es innegociable: **no hace nada si el pool no está
ocioso.** Un job en vuelo no se interrumpe; en ese caso la baja es un no-op
silencioso y la memoria la libera el temporizador de ADR-080 como hasta hoy.

### 1bis. La baja reinicia el ciclo del modelo

`releaseIdleWorkers()` reinicia el flag `modelWarm`, así que `isModelReady()`
vuelve a `false` y la recarga posterior emite `NER_MODEL_LOADING` y
`NER_MODEL_READY` como cualquier primera carga.

No es un capricho: es el criterio que ADR-135 ya había fijado —*"un cliente que
recree el Core reinicia el flag, que es lo correcto: ahí el modelo sí se carga de
nuevo"*— aplicado al caso nuevo que este ADR crea, una recarga real **dentro de
la misma instancia**. Sin ese reinicio la recarga sería muda y el usuario vería
el reanálisis detenido cerca de un segundo sin ninguna señal, que es exactamente
el indicador desincronizado que ADR-135 existe para evitar.

**El reinicio es condicional a que la baja haya ocurrido de verdad.** Encontrado
al implementar, verificado en el código: `WorkerPool.releaseIdleWorkers()` tiene
su propia guarda (`if (!this.isIdle) return;`) y devolvía `void`, así que el motor
no podía distinguir "liberé" de "la guarda me frenó". Y el kernel hace
`if (classifier !== null && loadedModelKey === key) return;` **sin reportar
nada**: si el worker sobrevive con el pipeline cargado, la carga siguiente no
emite `model-loading` ni `model-ready`.

Combinando las dos, había un camino alcanzable —cancelar durante la detección y
después reanalizar— donde `modelWarm` quedaba en `false` con el modelo cargado y
sin nadie que volviera a ponerlo en `true`. Ahí `isModelReady()` y
`NerStarted.modelLoading` **mienten**, las dos señales públicas que describen
justamente eso. No rompe el indicador del cliente actual, que se maneja con el par
`LOADING`/`READY`, pero un cliente que use el contrato tal como está escrito se
rompe.

Por eso `WorkerPool.releaseIdleWorkers()` pasa a devolver `boolean` —`true` solo
si terminó workers— y `NerEngine` reinicia `modelWarm` **solo en ese caso**. La
firma pública del motor no cambia: sigue siendo `releaseIdleWorkers(): void`, el
booleano es interno. `OcrEngine` puede ignorar el retorno: sus señales son de una
sola vez y no forman un par con estado.

**Es un cambio observable y hay que decirlo**: `NER_MODEL_READY` deja de ser "una
vez por instancia del motor" y pasa a ser "una vez por ciclo de carga". Un
cliente que cuente esos eventos verá más de uno por documento si hubo
reanálisis. Para el caso que motivó ADR-135 —el segundo worker del pool
calentándose— no cambia nada: ese sigue deduplicado.

### 2. El costo, declarado

Un reanálisis posterior —activar NER, o cambiar los idiomas de OCR— paga la
recarga del modelo. Está medida: **942,94 ms en frío** (mediana de P2,
`roadmap/Perfilado_NER_Interno_Medicion.md`), contra los ~1 GB que se recuperan
durante todo el tiempo en que el usuario revisa.

Es un intercambio mejor que el que ADR-157 ya aceptó: la recarga de Tesseract es
más cara y se aceptó sin tenerla medida.

### 3. El futuro multi-documento no pide una excepción

La intención registrada de procesar varios documentos a la vez, como pestañas,
parecería un motivo para mantener el modelo vivo: el segundo documento se
ahorraría la carga.

**La guarda de §1 ya resuelve ese caso, sin cláusula especial.** Si hay otro
documento entrando a detección, el pool **no está ocioso** y la baja es un no-op:
el modelo se conserva y se reusa. La liberación solo actúa cuando no queda
trabajo, que es exactamente cuando debe actuar.

Y en ese escenario el argumento se refuerza en vez de debilitarse: con varias
pestañas abiertas la memoria es más escasa, no menos. Sostener ~1 GB de un modelo
que ningún documento está usando es peor ahí que con un documento solo.

Cuando ese trabajo llegue, la decisión que **sí** habrá que tomar es si el pool de
NER se comparte por Core —como el OSD de ADR-164— y no si se libera. Son
preguntas independientes.

## Consecuencias

**A favor**

- Recupera del orden de **1 GB** durante el tramo en que el usuario revisa el
  documento, que es cuando hoy queda retenido sin uso.
- Baja el punto de partida del documento siguiente, que es lo que ADR-154 §2
  lever 3 identificó como el pico que importa en el uso real.
- No toca paralelismo (ADR-154 §1), no toca DPI y **no tiene dimensión de
  calidad**: no cambia qué se detecta ni cómo, solo cuándo se suelta el modelo.
- Cierra la asimetría que quedó abierta: OCR se da de baja al terminar su etapa y
  NER no, sin una razón que sostenga la diferencia.

**En contra**

- **Un reanálisis paga 942,94 ms.** Es el costo declarado de §2 y se acepta a
  sabiendas.
- El beneficio depende de un patrón de uso que **no está medido**: cuánto tarda un
  usuario entre cerrar un documento y abrir el siguiente. Si siempre supera el
  minuto, el cambio no cambia nada en la práctica. El producto es 100 % local y no
  tiene telemetría — ni debe tenerla —, así que ese dato no se va a conseguir. Se
  decide sin él, con el costo acotado como argumento.
- Agrega superficie pública al motor (la baja), con su camino de cancelación y sus
  tests, igual que costó en ADR-157.

**Lo que no toca**: `idleDisposeMs` sigue en 60 s para todos los pools —esto no lo
reemplaza, actúa antes—, los presupuestos de `00_Project_Vision.md` §7, la
detección, ni el orden OCR → NER del pipeline (ADR-154 §2 lever 3, descarte del
2026-09-17).
