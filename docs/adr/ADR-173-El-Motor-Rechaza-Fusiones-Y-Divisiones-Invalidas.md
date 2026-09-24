<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,architecture/03_Data_Model.md,adr/ADR-170-Las-Vistas-Previas-De-Edicion-Las-Calcula-El-Core.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-173 — El motor rechaza fusiones y divisiones inválidas

- **Estado**: Accepted
- **Fecha**: 2026-09-24
- **Decidido por**: El humano, ante el hallazgo B-2 del revisor del Hito 12.5: entre corregir el texto de
  ADR-170 o que el motor valide, eligió que el motor valide.
- **Relacionado con**: ADR-170 §2 (cuya lista de errores de `previewEdit` pasa a ser verdad),
  `03_Data_Model.md` §9 (invariante `members.length ≥ 1`), `Grouping_Engine.md` §11.
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

ADR-170 §2 dice que `previewEdit` lanza error al fusionar grupos de tipos distintos, al dividir todas las
ocurrencias de un grupo o al dividir con un `occurrenceId` ajeno, "igual que el pedido real". El revisor
encontró que el pedido real **no** los rechaza: `applyGroupMerge` solo verifica que los dos grupos
existan, y `applyGroupSplit` filtra en silencio — con todas las ocurrencias deja el grupo original **sin
members**, lo que rompe el invariante `members.length ≥ 1` del modelo de datos, y con ids ajenos crea un
grupo vacío. Hoy no llega a pasar porque la UI no manda esos pedidos (solo ofrece candidatos del mismo tipo
y bloquea "dividir todas"), pero el Core no puede depender de eso.

## Decisión

1. **`applyGroupMerge`** rechaza con `GroupingInvalidPatchError` (`GROUPING_INVALID_PATCH`) cuando
   `source.type !== target.type`, o cuando `sourceGroupId === targetGroupId`.
2. **`applyGroupSplit`** rechaza con `GroupingInvalidPatchError` cuando `occurrenceIds` está vacío,
   contiene un id que no es member del grupo, o contiene **todos** los members del grupo.
3. **Mecanismo**: el mismo de §11 para `GROUPING_INVALID_PATCH` — se rechaza el pedido, se loguea `warn`
   y **no se emite ningún evento ni se muta nada**. No hay error nuevo.
4. **`previewEdit`** hereda los rechazos porque ejecuta el mismo código, y los expone como
   `InvalidInputError` (ADR-170 §2). La lista de ADR-170 §2 queda **verdadera** sin tocarla.
5. La UI **mantiene** sus validaciones (`validateMultiMerge`, `validateSplit`): siguen siendo las que
   explican el problema al usuario antes de pedir nada. Las del motor son la segunda línea.

## Consecuencias

- Se cierra el hueco del grupo sin members, que el revisor encontró y que existía antes de esta rama.
- Un pedido inválido que antes se aplicaba a medias ahora no hace nada. Ningún flujo de la app los manda.

## Documentación que cambia

- `core/Grouping_Engine.md` §11 (cuándo aplica `GROUPING_INVALID_PATCH`), §13 casos 54-55, §14, §15 (15u).
