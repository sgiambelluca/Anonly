<!-- CONTEXT: scope=adr | dependencias=core/Orchestrator.md,core/OCR_Engine.md,05_Worker_Architecture.md,07_Performance_Strategy.md,adr/ADR-080-Idle-Dispose-En-El-Pool-No-En-El-Manager.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md | audiencia=humanos+IA | fase=11 -->

# ADR-157 — El pool de OCR se da de baja al terminar su etapa

- **Estado**: Accepted
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

### 5. Esto no espera a la medición

La medición por fase de H-10 va a decir **cuánto** rinde, y sirve. Pero retener
300 MB de un motor que ya no tiene trabajo no se justifica con ningún número:
igual que guardar píxeles que nadie lee (ADR-156), está mal por sí mismo. El
instrumento tiene ~345 MB de ruido, así que esperar a que confirme una ganancia
de ese orden sería esperar indefinidamente.

## Consecuencias

**A favor**

- Saca del pico la convivencia de los dos motores, que es el único lever con
  magnitud predicha (~300 MB) por encima del ruido del instrumento.
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

**Lo que no toca**: `idleDisposeMs` ni el mecanismo de ADR-080, el pool de NER,
`Contracts.md` —no hay tipo, evento ni error code nuevo—, ni el camino de
reanálisis, que sigue funcionando por la reconstrucción perezosa.
