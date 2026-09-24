<!-- CONTEXT: scope=adr | dependencias=roadmap/Agrupacion_Difusa_Medicion.md,roadmap/Rendimiento_Experimentos_Plan.md,core/Grouping_Engine.md,core/Contracts.md,adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md,adr/ADR-085-Un-Cambio-De-Tipo-Se-Recuerda-Por-Valor.md | audiencia=humanos+IA | fase=11 -->

# ADR-176 — Descartar distancias imposibles antes de completar Levenshtein

- **Estado**: Implementado y medido en macOS; paridad verificada, peor caso residual pendiente.
- **Fecha**: 2026-09-24.
- **Decidido por**: planificador de la campaña de rendimiento.
- **Numeración**: ADR-168 a ADR-172 están reservados en otra tarea; ADR-173/174/175 ya existen en este checkout. Resolver una eventual colisión externa antes de integrar.
- **Relacionado con**: ADR-073 (tipos elegibles), ADR-085 (correcciones de tipo) y `roadmap/Agrupacion_Difusa_Medicion.md`.

## Contexto

`findMatchingGroup` intenta primero el valor exacto y luego recorre grupos y
alias elegibles en orden de inserción hasta la **primera** similitud
Levenshtein normalizada que supera el umbral. La comparación actual construye
la matriz DP completa incluso para alias claramente distintos. Con 2.000
valores `Person` distintos de 36 caracteres, Grouping tardó una mediana de
14,53 s en la Mac; con 24 valores distintos repetidos, 74,81 ms. R1/R2
reales tardaron 8–16 ms de `processOccurrence` y no justifican atribuirles
este peor caso. `GROUPING_FINISHED.durationMs` incluye detectores y no mide
CPU del motor.

Una salida «más cercana» o una poda aproximada de candidatos puede cambiar el
grupo elegido. En particular, similitud no es transitiva: A~B y B~C no
implican A~C. La primera intervención debe reducir el costo de cada rechazo
sin modificar qué candidatos se visitan ni su orden.

## Decisión

1. Se agrega a `levenshtein.ts` un predicado interno para la pregunta exacta
   «¿`levenshteinNormalized(a,b) >= threshold`?». El cálculo vigente de
   `levenshteinNormalized` permanece disponible y sin cambio de semántica.
   `findMatchingGroup` y la búsqueda difusa de correcciones de tipo usan el
   predicado; el pase exacto, los tipos de ADR-073, el umbral configurado y el
   orden de grupos/alias permanecen iguales.
2. Solo para un umbral **finito** con `0 < threshold < 1` y strings no vacíos
   se usa DP de Levenshtein con banda y corte temprano. Sea
   `L = max(a.length,b.length)` en unidades UTF-16, como el helper actual. La
   cota conservadora `k = min(L, ceil((1-threshold)*L)+1)` admite al menos un
   entero más que el radio matemático, para no perder un match por redondeo
   IEEE-754 al calcular `1 - distance/L`. Si `k >= L`, se evalúa el helper
   vigente sin poda. Si `abs(a.length-b.length) > k`, se puede rechazar.
3. La DP evalúa solo `|i-j| <= k`, usando `k+1` como centinela fuera de la
   banda; si el mínimo de una fila ya supera `k`, rechaza temprano. **Si la
   distancia final está dentro de `k`, usa el valor entero exacto y decide con
   la misma expresión `1 - distance/L >= threshold` que hoy**, no con el
   resultado redondeado de la cota. Si queda fuera, rechaza. Esto evita falsos
   negativos cerca del umbral y conserva la semántica flotante de la ruta
   anterior.
4. Para strings vacíos, umbrales 0/1, fuera de rango, no finitos o `NaN`, el
   predicado delega al cálculo y comparación vigentes. No se agrega
   validación o clamping de `GroupingConfig.similarityThreshold` por este ADR.
5. No se indexan candidatos, no se reordenan `Map`/`Set`, no se pone tope al
   número de grupos ni se agrega un yield/timeout al handler síncrono. El
   cambio conserva todos los eventos, snapshots, cancelación entre eventos y
   contratos públicos. La cantidad de comparaciones entre grupos puede
   seguir siendo cuadrática; esta fase acota trabajo de cada descarte, no
   promete complejidad lineal respecto de entidades.

## Pruebas y medición

- Diferencial del predicado nuevo frente a
  `levenshteinNormalized(a,b) >= threshold` en corpus generado con semilla
  fija, strings de longitudes distintas, Unicode por unidades UTF-16,
  distancia exactamente en/afuera del umbral, vacíos y umbrales especiales.
  Comparar booleanos; el oráculo completo se usa en tests acotados.
- Tests de `GroupingEngine` para exacto, fuzzy sobre los tres tipos libres,
  primera coincidencia en orden, alias múltiples, corrección de tipo de
  ADR-085, y una cadena de similitud no transitiva A~B/B~C/A!~C. Comparar
  grupos, aliases, miembros, orden y eventos, no solo conteos.
- Repetir en serie el banco opt-in de 250/500/1000/2000 distintos y control
  de 24 valores repetidos, con las mismas semillas/longitudes, rondas y
  huellas. Medir proceso, lookup inclusivo y retraso del timer; conservar
  controles intercalados y excluir suspensión. Repetir R1/R2 dentro de la
  app con agregados numéricos y huellas exactas. El `durationMs` de sesión no
  se atribuye a CPU de Grouping. Windows nativo ventilado queda pendiente.

## Consecuencias

El cambio puede reducir notablemente el costo de rechazar valores lejanos sin
almacenar un índice mutable, y preserva la primera coincidencia por
construcción. Si los 2.000 distintos siguen causando bloqueo de varios
segundos, el siguiente paso será un **ADR separado** para índice de candidatos
con recall completo y mantenimiento de alias, merges, splits y cambios de
tipo. Una mejora de tiempo con diferencia de huellas o grupos se rechaza.
