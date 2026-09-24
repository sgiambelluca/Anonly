<!-- CONTEXT: scope=adr | dependencias=adr/ADR-176-Distancia-Acotada-Para-Grouping.md,core/Grouping_Engine.md,roadmap/Agrupacion_Difusa_Medicion.md,core/Contracts.md | audiencia=humanos+IA | fase=11 -->

# ADR-177 — Recortar afijos comunes antes de calcular la distancia acotada

- **Estado**: Implementado y medido en macOS; paridad verificada, peor caso residual pendiente.
- **Fecha**: 2026-09-24.
- **Decidido por**: planificador de la campaña de rendimiento.
- **Numeración**: ADR-168 a ADR-172 están reservados en otra tarea; ADR-173 a ADR-176 ya existen en este checkout. Resolver una eventual colisión externa antes de integrar.
- **Relacionado con**: ADR-176 y `roadmap/Agrupacion_Difusa_Medicion.md`.

## Contexto

La banda y el corte temprano de ADR-176 redujeron el caso adverso de 2.000
valores `Person` distintos de 14,53 a 3,26 s, con salidas idénticas. Ese corpus
comparte un prefijo largo; la DP sigue recorriendo caracteres que coinciden en
casi todos los candidatos. Una sonda separada recortó afijos comunes en UTF-16
sin cambiar el denominador de la similitud: pasó 16.000 pares diferenciales y
600 búsquedas con alias; en tres rondas sintéticas, la mediana del modelo de
lookup a 2.000 valores bajó de 3,47 a 1,31 s. Es factibilidad, no tiempo final
del motor ni evidencia sobre R1/R2. Un filtro por trigramas también se probó:
descartó cero pares del adverso y agregó costo; no se adopta.

## Decisión

1. En el predicado **interno** `levenshteinNormalizedAtLeast`, para strings no
   vacíos y umbral finito `0 < t < 1`, conservar la cota conservadora `k` de
   ADR-176 calculada con `L = max(a.length,b.length)` **original**. Conservar
   también su rechazo por diferencia de longitudes y la ruta completa si
   `k >= L`. No modificar `levenshtein` ni `levenshteinNormalized`.
2. Antes de la DP con banda, recortar el máximo prefijo común y luego el
   máximo sufijo común de los restos, comparando **unidades UTF-16**, como el
   cálculo actual. La distancia de edición de los restos es exactamente la de
   los originales. Si uno de los restos queda vacío, la distancia es la
   longitud del otro; si ambos quedan vacíos, es cero. La decisión final usa
   **siempre** `1 - distance / L >= t`, con el `L` original y la misma expresión
   flotante de ADR-176. No renormalizar por las longitudes recortadas.
3. La banda `|i-j| <= k`, el centinela y el corte de fila se aplican a los
   restos con el mismo radio original. Para strings vacíos, umbrales 0/1,
   fuera de rango, no finitos y `NaN`, conservar la delegación exacta al helper
   anterior. El recorte no cambia el orden de candidatos ni la primera
   coincidencia. No se añaden índices, caches persistentes ni contratos.

## Pruebas y medición

- Diferencial contra `levenshteinNormalized(a,b) >= t` con pares aleatorios,
  longitudes y afijos desiguales, sustitución/inserción/borrado, Unicode en
  unidades UTF-16, vacíos, bordes flotantes y umbrales especiales. Comparar
  también la primera coincidencia de grupos con múltiples alias y la vía de
  corrección de tipo.
- Repetir el banco del motor con 250/500/1000/2000 valores distintos y control
  repetido, tres rondas intercaladas y fingerprints/orden. Medir el bloqueo del
  event loop, no inferirlo solo de un helper. Repetir R1/R2 reales dentro del
  pipeline con agregados neutros y paridad exacta de grupos, miembros y orden;
  nunca guardar contenido o nombres en el repo ni en `.measure/`.
- Correr los gates globales. En Mac fanless, impedir suspensión y vigilar la
  deriva térmica; Windows nativo ventilado permanece pendiente.

## Consecuencias

El cambio reduce trabajo por comparación cuando hay afijos compartidos, pero
el número de candidatos sigue pudiendo ser cuadrático. Una mejora local no
demuestra que el bloqueo desapareció: informar el tiempo residual. Un índice
de candidatos con recall completo y mantenimiento de alias, merges, splits y
cambios de tipo queda para otro ADR si aún se necesita.
