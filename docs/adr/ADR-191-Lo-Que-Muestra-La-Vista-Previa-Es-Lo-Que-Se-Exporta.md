<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,ui/React_Client.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-072-Sintetico-Sembrado-Por-Identidad-De-Grupo.md,adr/ADR-170-Las-Vistas-Previas-De-Edicion-Las-Calcula-El-Core.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,adr/ADR-175-Un-Choque-Manual-No-Queda-Colgado.md,roadmap/hardening/Revision_Por_Bloques_Hardening.md | audiencia=humanos+IA | fase=11 -->

# ADR-191 — Lo que muestra la vista previa es lo que se exporta

- **Estado**: Aceptado.
- **Fecha**: 2026-09-30.
- **Decidido por**: el humano, a propuesta del planificador: «es un costo
  aceptable recalcular, en comparación con que el usuario vea una cosa
  distinta en el export que en la vista previa; eso genera desconfianza».
- **Origen**: ronda E de la revisión de `hardening/plan-2026-09`, hallazgos
  B05-F01, B05-F02, B05-F03 y B07-F01 (`Revision_Por_Bloques_Hardening.md`
  §4.3).
- **Alcance**: `grouping-engine` y el consumidor de conflictos de
  `apps/react-client`. **Sin cambio de contrato**: ningún tipo, evento ni
  error code nuevo.
- **Enmienda**: ADR-057 §«se recalcula donde ya se recalculaba» (suma un
  disparador). **Precisa**: ADR-170 §2 (cómo el simulacro de un split obtiene
  el mismo grupo que el pedido real) y ADR-172 §1 (qué diferencia de
  conflictos emite una restauración).

## Contexto

ADR-170 prometió que las vistas previas de edición las calcula el Core con
el mismo código que el pedido real, para que lo que el usuario ve antes de
confirmar sea lo que queda. La ronda E encontró tres caminos donde esa
promesa no se cumple:

1. **Un miembro angosto que entra al grupo (B05-F02).** El nivel de
   abreviatura del placeholder se elige por la caja más angosta del grupo
   (ADR-057 §4). Si entra una aparición en una caja angosta, por detección,
   reanálisis o agregado manual, `replacementPreviews.placeholder` se
   recalcula con todos los miembros (`[HOM-01]`), pero `replacementValue`
   queda en el nivel anterior (`[HOMBRE 01]`). ADR-057 decía que el nivel se
   recalcula «donde ya se recalculaba `replacementValue`, sin disparadores
   nuevos», y agregar una ocurrencia a un grupo existente nunca fue uno de
   esos lugares. La fusión, la división y `dropOccurrences` sí recalculan:
   el único hueco es la entrada de un miembro. Resultado: el diálogo muestra
   un valor y se exporta otro, contra el caso 46 del spec.
2. **El simulacro de un split (B05-F01).** El grupo nuevo de una división
   recibe `crypto.randomUUID()`. El simulacro de `previewEdit` corre el mismo
   código sobre una copia, así que sortea **otro** `id`. En modo `synthetic`
   el valor se siembra con `groupId` (ADR-072), y la vista previa muestra
   «José Medina» mientras el pedido real produce «José Castro».
3. **Restaurar un checkpoint (B05-F03 y B07-F01).** Al restaurar, la
   diferencia de conflictos compara solo `resolved` y `resolvedType`. Si un
   conflicto cambió de `groupId` (vuelve al grupo que existía en el
   checkpoint), no se emite nada y el consumidor queda apuntando a un grupo
   que ya no existe. Del otro lado, cuando sí se reemite `CONFLICT_DETECTED`
   con un `id` que la UI ya tiene, el store lo **agrega** en vez de
   reemplazarlo: quedan dos copias, una resuelta y otra pendiente, y la
   pendiente bloquea el export sin que el usuario pueda resolverla.

## Decisión

### 1. La entrada de un miembro recalcula el valor vigente

Cuando una ocurrencia entra a un grupo **existente**, por cualquier camino
(detección, reanálisis, agregado manual), y el grupo cumple las dos
condiciones:

- `replacementValueUserSet === false` (ADR-076: la edición manual gana
  siempre), y
- `replacementMode === placeholder` (es el único modo cuyo valor depende de
  los miembros: `mask` depende del formato, `synthetic` de la identidad y el
  índice, y `redact` es `""`),

entonces `replacementValue` se recalcula con la misma función que usan las
vistas previas. Si cambia, se emite `GROUP_REPLACEMENT_CHANGED` por el camino
único de siempre (`emitReplacementChangeIfNeeded`) y `replacementValue` se
suma a los `changes` del `ENTITY_GROUP_UPDATED` de esa entrada.

**Lo que ve el usuario.** El nombre de un grupo puede acortarse sin que lo
toque: `[HOMBRE 01]` pasa a `[HOM-01]` en **todas** sus apariciones a la vez
cuando aparece una nueva en una caja angosta. Es la regla de la escalera
aplicada en el momento en que corresponde. La alternativa es exportar un
valor distinto del que se mostró, y esa es la que este ADR descarta.

**Costo.** El cálculo del nivel recorre los rectángulos de todos los
miembros. Cada emisión de un grupo ya lo hace para `replacementPreviews`
(ADR-170 §1), así que este recálculo no cambia el orden del costo por
entrada. No hace falta una versión incremental.

### 2. El grupo nuevo de un split tiene un `id` reservado

Cada sesión de Grouping guarda un `id` reservado para el próximo grupo que
cree una división. La división real lo **consume** y reserva uno nuevo
(`crypto.randomUUID()`). El simulacro de `previewEdit` trabaja sobre una
copia de la sesión que lleva el mismo `id` reservado, así que el grupo que
muestra tiene la misma identidad que el que va a crear el pedido real, y el
`synthetic` sembrado por `groupId` coincide.

- Varias vistas previas seguidas sin confirmar muestran todas el mismo `id`.
- El `id` reservado es parte del estado interno de la sesión y **viaja en los
  checkpoints** (ADR-172 §1, caso 51: la restauración es exacta). Tras
  deshacer un split, rehacer la misma división da el mismo grupo. Nunca
  colisiona con un grupo vivo: la restauración que lo devuelve eliminó al
  grupo que lo había usado.
- Solo la división usa el `id` reservado. Las demás creaciones de grupo
  siguen sorteando el suyo; ninguna tiene vista previa.

### 3. Restaurar emite toda diferencia de un conflicto, y el consumidor reemplaza por `id`

- **Core.** En la diferencia de conflictos de `restoreCheckpoint` (caso 52),
  un conflicto presente antes y después **cambió** si difiere en `groupId`,
  `candidates`, `resolved`, `resolvedType` o `heldManual`, no solo en los dos
  campos de hoy. Si cambió y queda resuelto con tipo, se emite
  `CONFLICT_RESOLVED`; en cualquier otro caso, `CONFLICT_DETECTED` con el
  conflicto completo y el **mismo `id`**.
- **Consumidor.** `CONFLICT_DETECTED` con un `id` conocido **reemplaza** al
  conflicto que el consumidor tenía con ese `id`: lo actualiza en el lugar,
  nunca lo duplica (Grouping §7 ya lo declara idempotente). En
  `apps/react-client` lo aplica `entities.store`. Cuando el store marca un
  conflicto como resuelto, retira `heldManual` (ADR-175 §1: «ningún camino
  deja `resolved: true` con `heldManual`»).

## Pruebas exigidas

Cada una tiene que fallar contra el código de `768e5d3` (ADR-149 §2). Los
nombres exactos de las pruebas 1 a 4 están en Grouping §14 (casos 74 a 76);
la 5 vive en los tests de `entities.store` de `apps/react-client`, que no
fijan nombres en un spec.

1. Un grupo `Person` en placeholder `[HOMBRE 01]` recibe por detección una
   ocurrencia en una caja angosta: `replacementValue` pasa a `[HOM-01]`, es
   igual a `replacementPreviews.placeholder`, se emite
   `GROUP_REPLACEMENT_CHANGED` y el valor persiste tras `finishSession`. Con
   el valor editado a mano, nada cambia.
2. Lo mismo con un agregado manual.
3. En modo `synthetic`, cinco `previewEdit` de la misma división y después el
   pedido real dan el mismo valor; el pedido real usa el `id` reservado (la
   vista previa muestra `groupId: null`, caso 47).
4. Restaurar un checkpoint donde un conflicto retenido vuelve a otro grupo
   emite `CONFLICT_DETECTED` con el `groupId` del checkpoint.
5. En la UI, resolver un choque manual y restaurar el checkpoint previo deja
   **un** conflicto con ese `id`, pendiente y resoluble; repetirlo no
   acumula copias.

## Consecuencias

**A favor**

- Se cumple la promesa de ADR-170 en los tres caminos: lo que el usuario ve
  antes de confirmar es lo que se exporta.
- El deshacer exacto de ADR-172 también es exacto para los conflictos.

**En contra**

- Un grupo puede cambiar de nombre sin que el usuario lo edite, cuando entra
  un miembro angosto. Es un cambio visible y no pedido, aceptado por el
  humano frente a la alternativa.
- La sesión gana un campo interno (el `id` reservado). No es público.

## Alternativas descartadas

- **Relajar el invariante de ADR-170** y aceptar que la vista previa difiera
  del valor vigente. No cuesta código, pero deja en la UI un «esto vas a
  ver» que no se cumple. El humano lo descartó por la desconfianza que
  genera.
- **Ids deterministas derivados del split** (por ejemplo, un hash de la
  semilla, el grupo de origen y las ocurrencias). La misma división repetida
  después de fusionar devolvería el `id` de un grupo que ya existió, con
  riesgos sobre el historial y los stores de la UI. El `id` reservado da el
  mismo resultado sin esa colisión.
- **Recalcular solo en `finishSession`.** Durante una sesión abierta el
  diálogo de edición seguiría mostrando un valor distinto del vigente.
