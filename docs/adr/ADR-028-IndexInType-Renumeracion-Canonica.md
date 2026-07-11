<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,architecture/06_Pipeline.md,core/Contracts.md,adr/ADR-012-Replacement-Modes.md | audiencia=humanos+IA | fase=6 -->

# ADR-028 — `indexInType`: asignación provisional por llegada + renumeración canónica en `GROUPING_FINISHED`

- **Estado**: Accepted
- **Fecha**: 2026-07-11
- **Decidido por**: El humano (opción C), sobre contradicción reportada por el implementador en el Hito 6
- **Relacionado con**: ADR-011 (grouping first), ADR-012 (modos de reemplazo; placeholder usa `indexInType`)

## Contexto

El implementador del Hito 6 reportó una contradicción real: `06_Pipeline.md` §8 dice que
`indexInType` "se asigna en el orden de primera aparición (recorrido por `pageIndex` asc, luego
`bbox.y` asc, luego `bbox.x` asc)", mientras el pseudocódigo de `Grouping_Engine.md` §Algoritmos
define `nextIndex(type) = max + 1` — un contador por orden de llegada del evento, sin reordenar.
La implementación inicial siguió el pseudocódigo (orden de llegada).

El orden de llegada es un **bug latente de no-determinismo**: `ENTITY_FOUND` llega de dos motores
en paralelo y NER procesa páginas por prioridad visible (`NER_Engine.md` §15.7), así que el orden
de llegada depende del scheduling, del scroll y del timing de workers. El mismo documento procesado
dos veces podría numerar distinto — y `indexInType` no es cosmético: el modo `placeholder`
construye `replacementValue` con él (`[<TYPE_LABEL> <NN>]`, `NN = pad2(indexInType)`,
`Grouping_Engine.md` §Resolución de modo). Exports no reproducibles son inaceptables para
anonimización de documentos legales. El orden documental de `06_Pipeline.md` es la semántica
correcta de producto; pero exigirlo *en el momento de crear* cada grupo es imposible con
agrupación incremental (no se puede saber si llegará algo "anterior" en el documento).

## Decisión

`indexInType` tiene **dos fases**, y ambos docs quedan reconciliados así:

1. **Fase incremental (durante la sesión)** — como el pseudocódigo: al crear un grupo,
   `indexInType = nextIndex(type) = max + 1` en orden de llegada. Los índices son **provisionales**
   y alimentan la UI en vivo.
2. **Renumeración canónica (una sola vez, en `finishSession`)** — con `REGEX_FINISHED` +
   `NER_FINISHED` recibidos y **antes** de emitir `GROUPING_FINISHED`, el motor renumera cada
   `entityType`: ordena sus grupos por la **primera aparición documental** del grupo — el mínimo
   entre sus `members` por (`pageIndex` asc, `bbox.y` asc, `bbox.x` asc); empate imposible en la
   práctica (bbox idéntico ⇒ conflicto `overlap`), pero se desempata por `normalizedValue` asc
   para determinismo total — y asigna `1..N` contiguo. Por cada grupo cuyo índice cambió emite
   `ENTITY_GROUP_UPDATED` (`changes: ["indexInType", ...]`); si el grupo está en modo
   `placeholder`, recalcula `replacementValue` y agrega `GROUP_REPLACEMENT_CHANGED`. Export corre
   después de `GROUPING_FINISHED`, así que siempre ve índices canónicos.
3. **Después de la renumeración** rigen las reglas de estabilidad existentes sin cambios:
   eliminado → el índice se saltea; fusión → conserva el menor; división → `nextIndex(type)`.
   Las operaciones manuales del usuario *durante* la sesión (caso límite 17) también quedan
   sujetas a la renumeración final — el patch del usuario (modo, canonicalValue) se preserva; solo
   el número puede cambiar.

**Invariante nueva (contract test): mismo conjunto de `Occurrence` ⇒ mismos `indexInType` finales,
sin importar el orden de llegada de los eventos.**

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Orden de llegada (implementación inicial) | No-determinístico con motores paralelos y NER por prioridad visible: exports distintos entre corridas del mismo documento. |
| Orden documental estricto al crear | Imposible incremental sin renumerar en cada inserción. |
| Renumerar en cada inserción | Viola "estable por sesión" y spamea la UI con `ENTITY_GROUP_UPDATED`. |

## Consecuencias

**Positivas**: numeración determinística y reproducible (auditabilidad del export); UX coherente
("Persona 1" es la primera del documento); el trabajo incremental ya implementado se conserva —
el costo es un único pase de ordenamiento en `finishSession`.

**Negativas**: los índices que la UI muestra durante el procesamiento pueden cambiar una vez al
finalizar (mitigado: es un solo salto, con sus eventos de update correspondientes); el pase de
renumeración es O(G log G) por tipo — despreciable frente al pipeline.

## Referencias

- `core/Grouping_Engine.md` §2, §13 caso 21, §14, §Algoritmos (`indexInType`)
- `architecture/06_Pipeline.md` §8 — `adr/ADR-012-Replacement-Modes.md`
