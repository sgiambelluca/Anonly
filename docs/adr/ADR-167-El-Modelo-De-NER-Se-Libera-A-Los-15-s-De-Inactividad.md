<!-- CONTEXT: scope=adr | dependencias=adr/ADR-166-El-Modelo-De-NER-Se-Libera-Al-Terminar-La-Deteccion.md,adr/ADR-080-Idle-Dispose-En-El-Pool-No-En-El-Manager.md,adr/ADR-135-El-Ciclo-Del-Modelo-Se-Deduplica-Entero.md,adr/ADR-157-El-Pool-De-OCR-Se-Da-De-Baja-Al-Terminar-Su-Etapa.md,adr/ADR-155-El-Arnes-De-Medicion-Configura-El-Core-Por-Un-Canal-Propio.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,core/Contracts.md,core/NER_Engine.md,core/Orchestrator.md,architecture/05_Worker_Architecture.md,roadmap/AB_Intercalado_Medicion.md,roadmap/AB_Intercalado_Plan.md | audiencia=humanos+IA | fase=11 -->

# ADR-167 — El modelo de NER se libera a los 15 s de inactividad

- **Estado**: Accepted, **implementado el 2026-09-18** (`c006059` contrato, `1b09383` core,
  `a9c0ac7` ner-engine) y **verificado de punta a punta** en la app empaquetada:
  tras 20 s de revisión la recarga emite `NER_MODEL_READY` (antes era muda); con
  ~1,3 s entre documentos no recarga. Datos en `roadmap/AB_Intercalado_Medicion.md` §9.
- **Fecha**: 2026-09-18
- **Decidido por**: El humano, sobre los tres brazos de T-8: _«Sí, vamos por C»_.
- **Reemplaza**: ADR-166 §1 (la baja del pool al terminar la detección). **No
  reemplaza** ADR-166 §1bis —el ciclo del modelo se reabre con la baja—, que este
  ADR conserva y extiende al camino del temporizador (§3).
- **Relacionado con**: ADR-080 (el temporizador por pool), ADR-135 (el indicador
  del modelo), ADR-157 (la baja de OCR, que no cambia), ADR-155 (el canal por el
  que el arnés configura el Core), ADR-149 §2 (los controles discriminantes).
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Lo que ADR-166 prometió, y lo que se midió

ADR-166 decidió soltar el modelo de NER apenas termina la detección, en vez de
esperar los 60 s de `idleDisposeMs`, con dos argumentos: baja el nivel sostenido
mientras el usuario revisa, y con él «el punto de partida del documento
siguiente».

T-8 lo midió con el método que el repo exige para comparar dos versiones del
código: **alternadas corrida por corrida en la misma sesión**, con los brazos
difiriendo en una sola línea
([`roadmap/AB_Intercalado_Medicion.md`](../roadmap/AB_Intercalado_Medicion.md)).
Dos sesiones independientes, con binarios idénticos por digest, dieron lo mismo:

| | sesión 1 | sesión 2 |
| --- | ---: | ---: |
| ahorro de ADR-166 a los 5 s de cerrar | 454,1 MB (6/6) | 455,7 MB (6/6) |
| ahorro de ADR-166 entre 30 y 60 s | 397-400 MB (6/6) | 374-375 MB (6/6) |
| ahorro de ADR-166 desde los 75 s | ninguno | ninguno |

**El primer argumento se confirmó**, con una corrección de magnitud: lo que ADR-166
adelanta son **~450 MB**, no «del orden de 1 GB». El gigabyte de T-7 es todo lo que
se libera en 120 s; ADR-166 solo cambia cuándo sale la mitad.

### 2. El segundo argumento se refutó, y justo en el caso que motivó el ADR

Abrir un documento ~1,3 s después del anterior —el caso de quien procesa una
tanda de expedientes—:

| costo de ADR-166 en el 2° documento | sesión 1 | sesión 2 |
| --- | ---: | ---: |
| tiempo | +1256,2 ms (4/4) | +1177,2 ms (4/4) |
| pico M2 | +484,6 MB (4/4) | +635,5 MB (4/4) |

El documento siguiente **no arranca más abajo: pica más alto**. Al soltar el
modelo, la recarga cae dentro de la ventana del documento nuevo y se apila sobre
su propio trabajo, en vez de estar pagada de antes. Se devuelve la memoria y se la
vuelve a pedir justo cuando más se la necesita.

### 3. Un temporizador corto captura casi todo el beneficio sin ese costo

El tercer brazo de T-8 no suelta el modelo al terminar la detección: le da al
pool de NER un temporizador propio de **15 s** en vez de los 60 s compartidos.
Misma sesión que A y B:

| desde que se cierra el documento | A (baja inmediata) | B (60 s) | C (15 s) |
| --- | ---: | ---: | ---: |
| 5-15 s | 977 MB | 1432 MB | 1453 MB |
| 30-60 s | 929 MB | 1303 MB | **909 MB** |
| 75 s en adelante | 855 MB | 838 MB | 789 MB |

C retiene el modelo los primeros 15-30 s —la grilla de checkpoints no lo ubica
mejor— y desde ahí queda igual que A (diferencia pareada de −13 a −18 MB). Y al
encadenar documentos no paga nada: **+8,0 ms** contra B, sin recarga en ninguna
ronda.

### 4. La recarga que sigue a un temporizador es muda

Midiendo C apareció un defecto que no es de C: es del temporizador, y existe desde
ADR-080.

El temporizador llama a `WorkerPool.releaseIdleWorkers()` directamente. El motor
no se entera, `modelWarm` queda en `true` con los workers ya terminados, y la
recarga siguiente —el kernel sí reporta `model-loading`/`model-ready`, porque el
worker es nuevo— queda deduplicada por un flag que miente. Medido con 20 s de
revisión entre dos documentos, para que el temporizador dispare en el medio:

| 2° documento tras 20 s | tiempo | `NER_MODEL_READY` |
| --- | ---: | --- |
| A (baja inmediata, reinicia el flag) | 2130 / 2091 ms | sí |
| B (60 s, no llegó a disparar) | 470 / 471 ms | no — no hubo recarga |
| **C (15 s, disparó)** | **2065 / 1983 ms** | **no — hubo recarga, muda** |

C recarga el modelo —tarda lo mismo que A— sin emitir el evento: el cliente pasa
cerca de 1,5 s sin ninguna señal. Es el indicador desincronizado que ADR-135 existe
para evitar.

**Y no lo introdujo C.** Con el temporizador de 60 s pasaba lo mismo cada vez que
un usuario revisaba un documento más de un minuto y después reanalizaba o abría
otro. Estaba latente porque nunca se había medido una recarga posterior a una
liberación por temporizador. ADR-166 §1bis lo resolvió solo para el camino que él
agregaba; con 15 s, el camino del temporizador pasa a ser el común, y el defecto
deja de ser un rincón.

### 5. Qué opción gana depende de cómo se trabaja

El temporizador arranca cuando **termina la detección**, no cuando se cierra el
documento. Quien revisa un documento más de un minuto hace recargar el modelo en
los tres brazos; lo único que cambia entre ellos es cuánto tiempo se retuvo
memoria de más mientras revisaba.

| entre terminar un documento y abrir el siguiente | A | B | C |
| --- | --- | --- | --- |
| menos de 15 s (tanda) | recarga | no recarga | no recarga |
| entre 15 y 60 s | recarga | no recarga | recarga |
| más de 60 s (revisión) | recarga | recarga | recarga |
| memoria retenida de más mientras se revisa | nada | 60 s | 15 s |

C es la única que no tiene una fila mala en los extremos. Su punto débil es el
medio: quien abre el siguiente entre 15 y 60 s paga una recarga que B se ahorraba.

## Decisión

### 1. Se retira la baja inmediata de ADR-166

`runDetectionStage` deja de invocar la baja del pool de NER al cerrar la
detección. `NerEngine.releaseIdleWorkers()` **se elimina**, junto con los
contadores `activeProcessPages`/`activeProcessPagesBatches` que solo existían como
su guarda: sin llamador, son superficie pública muerta. Ninguna de las dos piezas
llegó a `main`.

La asimetría con OCR, que sí se da de baja al terminar su etapa (ADR-157), queda
**justificada por medición** y no por descuido: el minuto de inactividad de OCR
transcurría durante la detección, que es donde está el pico, así que soltarlo
bajaba ese pico; el de NER transcurre después de `PIPELINE_READY`, y soltarlo en
el acto le traslada el costo al documento siguiente.

### 2. El pool de NER tiene su propio temporizador

`WorkerPoolConfig` gana `nerIdleDisposeMs`, **default 15 000**. `idleDisposeMs`
sigue gobernando los demás pools —pdf, render, ocr, ocr-orientation y export— en
60 s. La forma sigue el precedente de
`maxQueuePerPool`: un valor por pool donde un escalar compartido no alcanza.

Es configuración y no una constante a propósito: el valor de 15 s lo eligió el
humano entre opciones medidas, **no sale de una optimización**, y el dato que
permitiría afinarlo —cuánto tarda un usuario real entre documentos— no se va a
conseguir en un producto 100 % local y sin telemetría (ADR-166, «En contra»). Como
campo de `EngineConfig`, cualquier otro valor se puede medir por el canal de
ADR-155 sin tocar código.

Los presets de rendimiento no lo modifican.

### 3. Una recarga nunca es muda, venga de donde venga la baja

`WorkerPool` notifica **cada baja efectiva, por cualquier camino** —temporizador o
llamada explícita— a quien se haya suscripto:

```ts
onWorkersReleased(listener: () => void): () => void; // devuelve la desuscripción
```

El puerto `NerJobPool` lo expone, `NerEngine` se suscribe al construirse y reinicia
`modelWarm` en el listener, y se desuscribe en `dispose()`. `IMMEDIATE_POOL`
(fallback in-process) lo implementa como no-op.

Es ADR-166 §1bis sin cambios de fondo —la baja reinicia el ciclo del modelo— con
una sola diferencia: el reinicio lo dispara **el pool** al liberar, no el motor al
pedir la baja. Eso lo vuelve independiente del camino, que era exactamente lo que
faltaba.

### 4. Qué significa que `releaseIdleWorkers()` devuelva `true`

ADR-166 §1bis lo definió como «terminó workers de verdad». El código devuelve
`true` también cuando el pool está ocioso y no tiene ningún worker vivo. Se
**precisa la definición** en vez de cambiar el código, porque el código hace lo
correcto: `true` significa que **la guarda no frenó la baja, y al volver ningún
worker del pool conserva estado cargado**. Con cero workers eso ya se cumplía, y
reiniciar `modelWarm` ahí es correcto: no hay ningún modelo cargado.

El listener de §3 se invoca exactamente cuando `releaseIdleWorkers()` devuelve
`true`.

### 5. Controles discriminantes

Cada uno tiene que fallar contra el código de hoy (ADR-149 §2):

1. **Baja por temporizador seguida de una carga emite el par
   `NER_MODEL_LOADING`/`NER_MODEL_READY`.** Hoy falla: es la recarga muda de
   Contexto §4.
2. **El pool de NER usa `nerIdleDisposeMs` y no `idleDisposeMs`.** Con los dos
   valores distintos, el pool de NER libera en el suyo y los demás siguen en
   `idleDisposeMs`.
3. **Un documento que llega antes del temporizador reusa el modelo**: sin
   `NER_MODEL_READY` y sin recarga.
4. **La guarda sigue en pie**: si el pool no está ocioso cuando vence el
   temporizador, no hay baja ni notificación.

## Consecuencias

**A favor**

- Libera **~390 MB** desde los 30 s de terminada la detección, prácticamente lo
  mismo que ADR-166 a partir de ahí.
- **No cobra nada al encadenar documentos** dentro de los 15 s: ni el ~1,2 s de
  recarga ni el pico de ~500-600 MB que ADR-166 le trasladaba al documento
  siguiente.
- **Arregla la recarga muda**, que existía antes de ADR-166 en el camino del
  temporizador de 60 s y que con 15 s habría pasado a ser el caso común.
- Achica superficie pública: el motor pierde un método y dos contadores.

**En contra**

- **Cede los primeros 15-30 s**: en ese tramo retiene ~450 MB que ADR-166 ya había
  soltado.
- **Quien abre el siguiente documento entre 15 y 60 s paga una recarga** que con el
  temporizador de 60 s se ahorraba. Es el punto débil declarado de esta opción.
- **Toca un contrato**: `WorkerPoolConfig` gana un campo. Es aditivo, con default,
  y no rompe a ningún consumidor.
- El valor de 15 s no está optimizado, y no hay forma de optimizarlo sin datos de
  uso que el producto no recolecta.

**Lo que no toca**: la baja de OCR al terminar su etapa (ADR-157), `idleDisposeMs`
de los demás pools, la detección, los presupuestos de `00_Project_Vision.md`
§7, y el orden OCR → NER.
