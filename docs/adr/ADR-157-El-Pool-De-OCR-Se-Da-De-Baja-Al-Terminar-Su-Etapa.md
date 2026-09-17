<!-- CONTEXT: scope=adr | dependencias=core/Orchestrator.md,core/OCR_Engine.md,05_Worker_Architecture.md,07_Performance_Strategy.md,adr/ADR-080-Idle-Dispose-En-El-Pool-No-En-El-Manager.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md | audiencia=humanos+IA | fase=11 -->

# ADR-157 — El pool de OCR se da de baja al terminar su etapa

- **Estado**: Accepted (**§1 corregido el 2026-09-11**, antes de implementar: el Orchestrator **no tiene** referencia al pool de OCR desde ADR-045, así que la baja la expone `OcrEngine`. Ver §1bis)
- **Fecha**: 2026-09-11
- **Decidido por**: El humano, sobre H-09D3-c: *"no hay forma que el usuario vuelva a necesitar el OCR una vez la aplicación haya terminado de escanear"*. Casi — ver §2.
- **Relacionado con**: ADR-080 (la liberación por inactividad, que acá no alcanza), ADR-038 §1 (el reanálisis, la única excepción), ADR-154 §2 (los levers aceptados)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Dos motores conviven en memoria sin que ninguno lo necesite

Un heap de WebAssembly **no se puede achicar**: `WebAssembly.Memory` tiene
`grow()` y no tiene contraparte. Terminar la instancia es la única forma de que
el sistema recupere esa memoria.

La etapa de detección arranca inmediatamente después de que termina el OCR, así
que Tesseract —presupuestado en 300 MB por `07_Performance_Strategy.md` §7— y
ONNX con su modelo —400 MB— quedan residentes **al mismo tiempo**, durante toda
la detección, con el OCR ya sin nada que hacer. Suman 700 MB, y P2 midió un pico
de ~1,95 GB contra un presupuesto de ~1,6 GB.

### 2. La liberación por inactividad existe, y llega tarde **para este pool**

ADR-080 puso el temporizador **en cada pool**, con `idleDisposeMs` de 60 s. Para
NER funciona: su etapa termina, el usuario se queda revisando, y al minuto el
pool se libera solo.

Para OCR no, y el motivo es de calendario: **su minuto de inactividad transcurre
justo mientras la aplicación está en su momento más ocupado.** El OCR termina, el
temporizador arranca, y adentro de esos 60 s corre la detección entera — que es
donde está el pico. Para cuando el pool se libera, el pico ya pasó.

No es que el mecanismo falle: es que mide inactividad del pool, no del sistema.

### 3. Qué vuelve a necesitar OCR, verificado

- **Agregar una entidad a mano**: no. `addManualEntity` resuelve por
  `regex.findLiteral` sobre el `Document` ya fusionado; no toca OCR.
- **Exportar**: no. El export rasteriza y encodea por Render.
- **Verificar que no quedó texto sin tapar**: no existe en el producto. Esa
  comprobación es el gate de tests de ADR-148, que corre su propio OCR en
  infraestructura de prueba.
- **Reanalizar cambiando los idiomas de OCR**: **sí**. `ReanalyzeConfigPatch`
  admite `ocr.languages`, y ese camino entra por `runReanalyzeOcrFlow`, que
  vuelve a correr la etapa completa.

O sea: la premisa vale para todo salvo un cambio de idiomas de OCR con el
documento abierto, que es una acción explícita del usuario y poco frecuente.

## Decisión

### 1. Se drena y se da de baja al terminar la etapa, no por temporizador

Al final de `runOcrStage`, cuando la última fusión ya persistió (la secuencia
síncrona de ADR-014/041 garantiza que para cuando resuelve el `await` todas
corrieron), el Orchestrator **dispone el pool de OCR** antes de pasar a
`Detecting`.

**No** se baja `idleDisposeMs`: ese número gobierna los cinco pools y seguiría
siendo un temporizador: una carrera contra la duración de la detección en vez de
un orden garantizado.

### 1bis. Quién puede darlo de baja: `OcrEngine`, no el Orchestrator

§1 decía "el Orchestrator dispone el pool de OCR". **No puede**, y el
implementador lo frenó antes de escribir algo que habría compilado sin hacer
nada.

Desde ADR-045 el `OcrPool` lo construye `create-core.ts` y se **inyecta en el
constructor del motor**; el `WorkerPoolManager` que vive en el Orchestrator solo
posee el de pdf. El encabezado de `create-core.ts` lo dice literal: *"El
Orchestrator ya no sostiene ninguna referencia a un pool de render, ocr, ner o
export"*.

Y la trampa que hay que dejar escrita, porque el próximo que pase va a caer en
ella: `WorkerPoolManager.getPool("ocr")` **no falla** — crea un pool nuevo,
vacío y desconectado bajo esa clave. Llamarle `releaseIdleWorkers()` a ese objeto
compila, pasa un test superficial y no libera absolutamente nada, porque ningún
job de OCR se despachó nunca contra él.

**La baja la expone el motor**, que es su dueño:

```ts
// ocr-engine, interfaz pública
releaseIdleWorkers(): void;   // delega en su pool privado
```

Es la opción que respeta el reparto de ADR-045 en vez de esquivarlo. La
alternativa —que el façade retuviera el pool y le pasara un callback al
Orchestrator— reintroduce por la ventana la referencia que ADR-045 sacó por la
puerta, y deja al motor sin saber que alguien le está apagando los workers.

**No se agrega a `IEngine`**: NER no lo necesita (§4) y los demás tampoco. Es un
método de `OcrEngine`, y por eso va a la sección de interfaces públicas de
`core/OCR_Engine.md` **antes** del código (R-2/R-19).

**Alcance**: son dos módulos, así que **dos commits** (R-1/R-5) —
primero `ocr-engine` con el método y su línea de spec, después el façade con la
llamada—, y no uno.

### 1ter. `releaseIdleWorkers` no hace nada si el pool no está ocioso

`WorkerPool.releaseIdleWorkers()` arranca con `if (!this.isIdle) return;`, e
`isIdle` exige `active === 0`, cola vacía, sin jobs remotos pendientes y sin
broadcasts en vuelo. La guarda existe por una razón dura: `terminate()` no
dispara el evento `error`, así que matar un worker con un job en vuelo deja esa
promesa colgada **para siempre**.

Consecuencia para §3: en el camino feliz el pool está ocioso cuando
`processSession` resuelve, y la baja ocurre. En **cancelación** puede no estarlo,
y entonces la llamada es un no-op silencioso y la memoria la libera el
temporizador de ADR-080 como hasta hoy. Eso es correcto —es preferible a dejar
promesas colgadas— pero hay que **escribirlo en el test**: la prueba de la vía de
cancelación afirma que no se rompe nada, no que se liberó.

### 2. El pool queda usable, y el reanálisis paga la recarga

ADR-080 ya define que un pool dispuesto por inactividad **sigue usable**: el
siguiente `dispatch` lo reconstruye por el camino perezoso de `workerForSlot`.
Esta baja usa esa misma propiedad, así que `runReanalyzeOcrFlow` sigue
funcionando sin cambios.

Su costo, declarado: ese reanálisis vuelve a cargar el modelo de Tesseract. Los
assets son **locales** desde ADR-130 —no hay descarga de red—, así que es tiempo
de inicialización, no de transferencia, y se paga solo en una acción que el
usuario pide a propósito.

### 3. Cancelación y fallo

La baja corre en los caminos terminales de la etapa, incluidos cancelación y
fallo: un documento cancelado a mitad del OCR no tiene por qué dejar el pool
vivo esperando su minuto.

### 4. NER no entra en este ADR

Su pool sí es liberado a tiempo por el temporizador de ADR-080 (§2), y darlo de
baja al llegar a `Ready` cambiaría el costo del reanálisis de NER, que es la
acción más frecuente de las dos. Es una pregunta propia y no se resuelve acá.

> **Resuelta el 2026-09-17 por ADR-166, con medición: NER sí entra, en su propio
> ADR.** La premisa de arriba —"su pool sí es liberado a tiempo"— no se sostiene:
> T-7 midió que esa liberación llega **60 s tarde** y que vale **922 MB en P1 y
> 1027 MB en P2**. El segundo argumento, que el reanálisis de NER es más
> frecuente, sigue siendo cierto y ADR-166 lo acepta como costo declarado
> (942,94 ms), porque ahora los dos lados están medidos y cuando se escribió esto
> ninguno lo estaba.

### 5. Esto no espera a la medición

La medición por fase de H-10 va a decir **cuánto** rinde, y sirve. Pero retener
300 MB de un motor que ya no tiene trabajo no se justifica con ningún número:
igual que guardar píxeles que nadie lee (ADR-156), está mal por sí mismo. El
instrumento tiene ~345 MB de ruido, así que esperar a que confirme una ganancia
de ese orden sería esperar indefinidamente.

## Consecuencias

> **Medido el 2026-09-11, con el cambio ya implementado.** En las tres corridas
> calientes de P2 aparece, inmediatamente después de `OCR_FINISHED`, una caída de
> **702 a 1009 MB** que antes de este cambio no existía (la corrida previa daba
> ~0, plana). El mecanismo funciona, y **rinde más del triple** de los ~300 MB
> que §1 estimaba: además del heap de Tesseract se va todo lo que quedaba
> alcanzable desde sus workers.
>
> **Pero no baja M2**, y hay que corregir lo que este ADR afirmaba: el pico del
> run coincide con el pico **interno** del tramo `OCR_STARTED → OCR_FINISHED`. El
> máximo ya ocurrió cuando esta baja se dispara, así que liberar después no puede
> bajarlo. Lo que esta decisión mejora es el **nivel sostenido** durante la
> detección y el que queda después, no el pico.
>
> Consecuencia para ADR-154: la convivencia OCR/NER **nunca fue** lo que fijaba
> el pico. El lever sigue valiendo —700 a 1000 MB de holgura para que NER trabaje
> y para el que abre varios documentos seguidos— pero deja de ser el candidato a
> cerrar la brecha contra el presupuesto.

**A favor**

- Devuelve entre **702 y 1009 MB** apenas termina la etapa, medido en 3 de 3
  corridas calientes. Es holgura real para la detección y para el documento
  siguiente.
- Usa un mecanismo que ya existe y ya está probado (ADR-080), en vez de agregar
  uno nuevo.
- Da un orden garantizado en vez de una carrera contra un temporizador.

**En contra**

- **El reanálisis con cambio de idiomas de OCR se vuelve más lento**: recarga el
  modelo. Es local y es una acción deliberada, pero es una regresión de tiempo
  real en ese camino.
- Si alguna vez aparece un flujo que vuelva a necesitar OCR sin pasar por
  `reanalyze`, va a pagar la recarga sin que nadie lo haya previsto. La lista de
  §2 es de hoy y hay que revisarla si el pipeline gana etapas.
- El Orchestrator gana una responsabilidad más sobre el ciclo de vida de un pool
  que hasta ahora se gobernaba solo.

- **`ocr-engine` gana superficie pública** (§1bis). Es un método de ciclo de vida
  en un motor que hasta ahora solo exponía `init`/`process*`/`dispose`, y lo usa
  un único caller. Se acepta porque la alternativa era peor —el façade metiendo
  mano en un pool que no es suyo—, pero es superficie nueva y va documentada.

**Lo que no toca**: `idleDisposeMs` ni el mecanismo de ADR-080, el pool de NER,
`Contracts.md` —no hay tipo, evento ni error code nuevo; el método es de la
interfaz pública del motor, que vive en su spec—, ni el camino de reanálisis, que
sigue funcionando por la reconstrucción perezosa.
