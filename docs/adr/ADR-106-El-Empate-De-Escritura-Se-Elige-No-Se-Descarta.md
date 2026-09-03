<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,core/Grouping_Engine.md,core/Contracts.md,adr/ADR-083-El-Conflicto-Se-Resuelve-Eligiendo-El-Tipo.md,roadmap/Post_Hito10.8_Pendientes.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-106 — El empate de escritura se elige, no se descarta

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, tras encontrar el aviso al fusionar dos formas de escribir la misma entidad (`Post_Hito10.8_Pendientes.md` §27 punto 5).
- **Relacionado con**: **ADR-083 §6 (revisado)**, ADR-028 (la elección canónica que el motor hace cuando puede)
- **Parte de**: Hito 11, UX de detección

## Contexto

### 1. Un aviso que no dice qué pasa ni deja hacer nada

`AmbiguousCanonical` se levanta ante un **empate real**: dos escrituras de la misma entidad con la misma frecuencia **y** la misma longitud. El motor no tiene con qué desempatar, elige la primera insertada y avisa que adivinó (`grouping.engine.ts#raiseAmbiguousCanonicalConflict`).

En la UI eso se ve como un ⚠ rojo que abre un diálogo que dice *"El valor se escribe de varias formas"*, muestra **un solo** valor —`candidates[0]`— y ofrece un botón "Descartar".

O sea: avisa de un problema, no dice **cuáles** son las formas, y no deja resolverlo.

### 2. Aparece siempre que se fusiona a mano

Fusionar dos grupos con escrituras distintas crea justo ese empate: una aparición de cada una, misma frecuencia. Así que el aviso salta en una operación deliberada del usuario, sobre un "problema" que él mismo acaba de crear a propósito.

### 3. El dato ya está — lo que falta es mostrarlo

`raiseAmbiguousCanonicalConflict` arma **un candidato por cada forma empatada**, con su `value`. Y `GroupUpdateRequested.patch` ya acepta `canonicalValue`.

Las dos piezas existen. Lo único que falta es que el diálogo las use.

### 4. ADR-083 §6 metió este caso en la bolsa equivocada

`ui/Components.md` §6.2 lo dice explícito:

> *"**Cuando no hay elección**: si todos los candidatos comparten tipo (`low_confidence`/`ambiguous_canonical`, que no son conflictos de clasificación), el diálogo no ofrece radios y el botón dice 'Descartar'."*

El razonamiento es correcto **sobre el eje que ADR-083 miraba**: ese ADR rediseñó el diálogo para resolver conflictos de **clasificación** —¿esto es una organización o una dirección?— y sobre ese eje `ambiguous_canonical` efectivamente no ofrece nada, porque todos los candidatos comparten tipo.

Pero no comparten **valor**. Sobre el eje del valor hay una elección real y bien definida, y es exactamente la que el usuario quiere hacer.

`low_confidence` sí queda donde está: ahí hay **un** candidato por debajo del umbral, y no hay nada entre qué elegir.

## Decisión

### 1. Para `ambiguous_canonical`, el diálogo ofrece las formas empatadas

Radios con el `value` de cada candidato, con el `canonicalValue` vigente preseleccionado. La pregunta pasa a ser la que el usuario tiene: **¿cuál de estas dos escrituras usamos?**

### 2. Aplicar escribe el valor canónico y marca el conflicto resuelto

`actions.updateGroup(groupId, { canonicalValue })` seguido de `actions.resolveConflict(conflictId)`. Las dos vías ya existen; no hay contrato nuevo.

### 3. `low_confidence` no cambia

Sigue sin radios y con "Descartar". No es una omisión: con un solo candidato no hay elección que ofrecer, y ADR-094 ya le dio a ese caso su propio camino (el grupo sugerido, apagado y visible).

### 4. Esto también apaga el ruido de la fusión manual, sin apagar el aviso

El humano pidió primero que el aviso **no saltara** en fusiones manuales. Se descartó por algo mejor: si el diálogo deja elegir, el aviso deja de ser una alarma y pasa a ser la pregunta correcta — y en una fusión manual esa pregunta **sí** interesa, porque el usuario acaba de juntar dos escrituras y alguna se va a mostrar.

Apagarlo habría escondido una decisión que el motor está tomando a ciegas.

## Consecuencias

**A favor**

- Un aviso que hoy solo se puede descartar pasa a resolver lo que anuncia.
- Se muestra **qué** formas empataron, que era la mitad que faltaba: sin eso el usuario no sabe siquiera qué se le está avisando.
- Sin contrato nuevo: `canonicalValue` ya estaba en el patch y los `value` ya estaban en el conflicto.

**En contra**

- El diálogo gana una segunda forma según el `reason`. Es la complejidad de reconocer que dos conflictos distintos piden preguntas distintas — que es lo que ADR-083 ya había empezado a hacer al reemplazar el selector de modo por el de tipo.

**Lo que queda abierto**

- El empate se resuelve **por grupo**. Si el mismo par de escrituras empata en varios grupos, hay que elegir en cada uno. No se vio en un documento real todavía.
