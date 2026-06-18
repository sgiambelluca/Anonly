<!-- CONTEXT: scope=adr | dependencias=03_Data_Model.md,06_Pipeline.md,00_Project_Vision.md | audiencia=humanos+IA | fase=2 -->

# ADR-011 — Grouping-First (operación a nivel de grupo, no ocurrencia)

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Aclaración del usuario en planificación

## Contexto

Las herramientas de anonimización tradicionales operan **ocurrencia por ocurrencia**: cada aparición de un dato sensible se trata independientemente. Esto genera problemas graves:

- **Inconsistencia**: el mismo DNI aparece como tres valores distintos en el documento anonimizado (uno sintético aquí, un placeholder allá, una censura más allá). El lector no puede correlacionar.
- **Carga cognitiva**: el usuario debe decidir el reemplazo para 14 ocurrencias del mismo DNI en vez de para 1 grupo.
- **Ineficiencia**: 14 decisiones en vez de 1.
- **Inconsistencia de placeholders**: si una persona aparece 14 veces y se reemplaza cada ocurrencia con `[PERSONA 01]`, todos los `[PERSONA 01]` quedan indistinguibles entre personas distintas.

El usuario explicitó en la planificación:

> "La idea es tratar todas las apariciones de formas agrupadas, nunca individuales. Con esto se pueden agrupar reglas según el tipo de ocurrencia que haya aparecido."

## Decisión

**Toda operación de reemplazo se define a nivel de `EntityGroup`, nunca de `Occurrence` individual.**

Reglas:

1. La UI **nunca** ve `Occurrence` cruda. Solo ve `EntityGroup` con `members: OccurrenceRef[]` (refs livianas).
2. El árbol de entidades muestra **grupos** agrupados por `EntityType`:
   ```
   ▶ Personas (3)
       ☑ Juan Pérez (14)
       ☑ María Gómez (6)
       ☑ Carlos López (2)
   ▶ DNI (3)
       ☑ 34.567.891
       ☑ 18.445.212
       ☑ 42.998.103
   ```
   El número entre paréntesis es `members.length` (ocurrencias).
3. El usuario edita el `replacementMode` y `replacementValue` **del grupo**; el cambio aplica a todas las ocurrencias del grupo automáticamente.
4. Las `Rule` operan en scopes `group | type | global`, nunca `occurrence`.
5. `ENTITY_FOUND` (ocurrencia cruda) es **interno** entre detectores y grouping. La UI se suscribe a `ENTITY_GROUP_*`.
6. El `Replacement` final referencia `groupId + occurrenceId`, pero `replacementValue` es idéntico para todas las `Replacement` del mismo `groupId`.

### `indexInType` y placeholders

- Cada grupo tiene un `indexInType` secuencial por tipo dentro de la sesión: 01, 02, 03...
- En modo `placeholder`, `replacementValue = "[<TYPE> <NN>]"` con padding a 2 dígitos. Ej: `[DNI 01]`, `[PERSONA 03]`, `[DIRECCION 02]`.
- El `indexInType` es **estable**: si un grupo se elimina, su índice se saltea (no se reasigna). Si dos grupos se fusionan, el resultante conserva el menor índice.

### Fusión y división

- El usuario puede fusionar dos grupos (`GROUP_MERGE_REQUESTED`) cuando la agrupación automática falló (ej. "J. Pérez" y "Juan Pérez" quedaron separados).
- El usuario puede dividir un grupo (`GROUP_SPLIT_REQUESTED`) seleccionando ocurrencias que van a un grupo nuevo.
- En ambos casos, `indexInType` se mantiene estable para los no afectados.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Ocurrencia por ocurrencia** | Genera inconsistencia, carga cognitiva y placeholders ambiguos. Es el problema que motivó este ADR. |
| **Grupo default pero override por ocurrencia** | Complejiza el modelo y abre la puerta a inconsistencias. Si el override es raro, no justifica el costo. |
| **Agrupación solo por tipo, no por valor** | "todas las personas → [PERSONA]" pierde la distinción entre personas. Inaceptable. |
| **Agrupación solo por valor exacto** | Pierde variantes ("J. Pérez" vs "Juan Pérez"). Necesario fuzzy. |
| **Agrupación semántica (embeddings)** | Más precisa pero pesada y no determinista. Candidato a v1.0+ con su ADR. |

## Consecuencias

**Positivas**:
- Coherencia garantizada: un mismo dato sensible tiene un mismo reemplazo en todo el documento.
- Carga cognitiva baja: el usuario decide por grupo, no por ocurrencia.
- Placeholders inequívocos: `[DNI 01]` vs `[DNI 02]` distinguen DNIs distintos.
- Reglas eficientes: una regla `type` aplica a todos los grupos del tipo.
- UI simple: árbol por tipo, checkbox por grupo, contador de ocurrencias.

**Negativas**:
- El usuario pierde control por ocurrencia. Mitigado: si realmente quiere tratar una ocurrencia distinta, puede dividir el grupo.
- Mayor complejidad en Grouping Engine (fuzzy matching, alias, canonical). Aceptable.
- `indexInType` estable requiere bookkeeping. Aceptable.

**Neutras**:
- Futuro: agrupación semántica con embeddings puede mejorar recall sin cambiar el modelo (solo el algoritmo de matching interno).

## Validación

- Test de UI: el árbol muestra grupos, no ocurrencias. Counter correcto.
- Test de coherencia: todas las `Replacement` de un mismo `groupId` tienen el mismo `replacementValue`.
- Test de fusión/división: `indexInType` estable tras operaciones.
- Test de placeholder: `[DNI 01]` se mantiene consistente en todo el documento.

## Referencias

- `00_Project_Vision.md` §8 (layout)
- `03_Data_Model.md` §9 (`EntityGroup`), §13 (`Rule`)
- `06_Pipeline.md` §8 (etapa 6, agrupación)
- `04_Event_System.md` §6 (eventos `ENTITY_GROUP_*`)
- `ADR-012-Replacement-Modes.md` (modos de reemplazo a nivel grupo)
- `core/Grouping_Engine.md` (spec)
- `ui/UX_Guidelines.md`
