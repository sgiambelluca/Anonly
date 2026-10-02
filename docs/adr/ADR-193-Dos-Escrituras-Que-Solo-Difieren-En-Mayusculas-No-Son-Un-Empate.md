<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,ui/Components.md,ui/UX_Guidelines.md,adr/ADR-106-El-Empate-De-Escritura-Se-Elige-No-Se-Descarta.md,adr/ADR-083-El-Conflicto-Se-Resuelve-Eligiendo-El-Tipo.md | audiencia=humanos+IA | fase=11 -->

# ADR-193 — Dos escrituras que solo difieren en mayúsculas no son un empate

- **Estado**: Accepted
- **Fecha**: 2026-10-01
- **Decidido por**: El humano, al ver el aviso de conflicto sobre "Argentina" / "argentina".
- **Relacionado con**: ADR-106 (el empate de escritura se elige), ADR-083 §6
- **Parte de**: Hito 11, UX de detección

## Contexto

`ConflictReason.AmbiguousCanonical` se levanta ante un empate de escritura: dos `aliases` del mismo grupo con la misma frecuencia **y** la misma longitud (`core/Grouping_Engine.md` §13 caso 10). ADR-106 hizo que el diálogo deje elegir entre las formas empatadas.

Dos formas que solo difieren en mayúsculas y minúsculas —"Argentina" y "argentina", "Maria" y "MARIA"— tienen siempre la misma longitud, así que empatan cada vez que aparecen la misma cantidad de veces. El usuario recibe un conflicto rojo, que además bloquea la lectura de la fila, para una pregunta que no tiene: las dos formas son la misma palabra.

Hay un segundo defecto, del lado de la UI. En el caso `ambiguous_canonical` el diálogo ofrece las escrituras como opciones y al confirmar **aplica** la elegida (ADR-106 §2), pero el botón dice "Descartar". `ui/UX_Guidelines.md` §6 seguía con la redacción de ADR-083 §6 ("no hay radios y el botón dice Descartar") que ADR-106 revisó en `ui/Components.md` §6.2 y no en esa sección.

## Decisión

### 1. La diferencia de mayúsculas no cuenta como empate

Al decidir si hay empate real, el motor agrupa las formas empatadas por su versión en minúsculas (`toLowerCase()`). Si queda **una sola** forma, no hay conflicto: no se emite `CONFLICT_DETECTED`.

Solo se ignora la diferencia de mayúsculas. Una diferencia de tilde ("José" / "Jose") o de puntuación sigue siendo un empate y sigue levantando el conflicto.

### 2. El valor canónico se elige igual que antes

Sin conflicto, `canonicalValue` es la primera forma encontrada entre las empatadas (orden de inserción en `aliases`), la misma regla que el caso 10 ya aplicaba. No se agrega una preferencia por la forma capitalizada.

### 3. En un empate mixto se pregunta una vez por cada forma distinta

Si entre las formas empatadas hay diferencias reales además de las de mayúsculas ("José", "JOSÉ", "Jose"), el conflicto se emite con **un candidato por forma distinta sin contar mayúsculas**: la primera insertada de cada una. El usuario elige entre "José" y "Jose", no entre tres.

### 4. Con opciones para elegir, el botón dice "Aplicar"

En `ConflictDialog`, el botón dice "Aplicar" cuando el diálogo ofrece opciones, sean tipos o escrituras. "Descartar" queda solo para el caso sin elección (`low_confidence`, ADR-106 §3).

## Consecuencias

**A favor**

- Desaparece un conflicto que no pedía ninguna decisión.
- El botón dice lo que hace.

**En contra**

- En una fusión manual de "Argentina" con "argentina" ya no se pregunta cuál se muestra (ADR-106 §4): queda la primera encontrada. El usuario que quiera la otra no tiene el diálogo para elegirla.

**Sin contrato nuevo.** `ConflictReason`, `ConflictCandidate` y `CONFLICT_DETECTED` no cambian; cambia cuándo se emite.

## Tests

- `ambiguous_canonical conflict emitted` (existente, `edge.test.ts`): su fixture usaba "Maria" / "MARIA", que con este ADR deja de ser un empate. Pasa a usar dos formas que difieren en algo más que mayúsculas.
- `case-only spelling tie does not raise ambiguous_canonical` (nuevo, `edge.test.ts`): §1 y §2.
- `mixed spelling tie offers one candidate per case-insensitive form` (nuevo, `edge.test.ts`): §3.
