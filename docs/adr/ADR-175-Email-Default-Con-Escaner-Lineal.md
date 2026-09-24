<!-- CONTEXT: scope=adr | dependencias=roadmap/Patron_Email_Regex_Medicion.md,roadmap/Rendimiento_Experimentos_Plan.md,core/Regex_Engine.md,core/Contracts.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-175 — El email default se busca con un escáner lineal

- **Estado**: Accepted; implementación y benchmark macOS completados el 2026-09-24, repetición en Windows nativo pendiente.
- **Fecha**: 2026-09-24.
- **Decidido por**: planificador de la campaña de rendimiento.
- **Numeración**: ADR-168 a ADR-172 están reservados en otra tarea. ADR-173/174 ya existen en este checkout; se usa 175 sin ocupar aquel rango. Resolver una eventual colisión de otra máquina antes de integrar.
- **Relacionado con**: `Regex_Engine.md` §§6, 12–15 y `roadmap/Patron_Email_Regex_Medicion.md`.

## Contexto

El default `/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g`
intenta sucesivos inicios sobre una secuencia larga de caracteres locales sin
`@`. En la Mac medida, 20/40/80/160 KiB adversos tardaron 0,67/2,66/10,62/
42,53 s. `RegexEngine.process` corre en el hilo principal y solo consulta
`abortSignal` entre páginas; la búsqueda bloqueó también la cancelación.
R1/R2 reales fueron rápidos, pero no contienen evidencia de que el peor caso
sea imposible. El timeout posterior de patrones **custom** no protege este
default ni puede preemptar un `exec` síncrono.

El valor del email, sus spans, orden y normalización son datos observables.
Cambiar la expresión por una más corta, cortar la página o saltar todas las
páginas sin `@` como único arreglo dejaría casos sin resolver o podría alterar
detecciones. Esta decisión cambia el algoritmo interno del patrón default,
sin añadir contrato público, dependencia, evento ni error code.

## Decisión

1. Se especializa **solo el objeto del patrón email default**. Los patrones
   custom recorren el camino existente aunque usen el id `email`; los demás
   defaults también. La expresión actual permanece como referencia de
   semántica y como oráculo de tests, pero no se ejecuta sobre la página en
   el camino productivo del email default.
2. El escáner recorre el texto en unidades UTF-16, en orden de `@`, y limita
   cada intento al tramo contiguo previo de `[A-Za-z0-9._%+-]` y al tramo
   posterior de `[A-Za-z0-9.-]`. Esos tramos quedan separados por `@`, por lo
   que pueden recorrerse con índices monótonos y costo **O(n + m)** para
   `n = text.length`, `m = cantidad de matches emitidos`. No se reinicia una
   búsqueda desde cada carácter del prefijo adverso.
3. Para un `@` candidato, el inicio es la **primera** posición válida a partir
   del fin del match anterior (`lastIndex` global) dentro del tramo local:
   carácter permitido y transición de palabra/no palabra en ese índice.
   `\b` conserva la definición ASCII de esta regex sin flags `u`/`i`:
   `[A-Za-z0-9_]` frente al carácter anterior. También puede empezar sobre
   puntuación después de una palabra cuando el `lastIndex` de un match previo
   cayó dentro de un tramo local; no asumir que empieza siempre en letra.
4. A la derecha se preserva el significado de
   `[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`: debe haber al menos un carácter del
   primer tramo antes del punto separador, dos letras ASCII o más en el TLD,
   y frontera de palabra al terminar. Entre terminaciones válidas, se elige
   la de **mayor índice final** que escogería el `RegExp` codicioso; el
   recorrido no vuelve a escanear un tramo por cada punto. Si no existe,
   ese `@` no produce match. `@` tardía, puntos múltiples, guiones, sufijos
   inválidos y otros `@` deben mantener exactamente el comportamiento JS.
5. El resultado del escáner entra en la **misma** construcción de `RawMatch`,
   normalizador, checksum, guarda de corrida, resolución de overlaps,
   mapeo a palabras y eventos que los demás patrones. Se preservan spans
   `[startIndex, endIndexExclusive)`, `rawValue`, `normalizedValue`, tipo,
   orden y ocurrencias; la forma pública de `RegexEngine` no cambia.
6. No se añade timeout a defaults ni se cambia la cancelación contractual
   entre páginas. La menor latencia resulta de completar el trabajo acotado;
   un watchdog del banco sigue siendo externo al producto.

## Prueba obligatoria

- Diferencial exacto entre el escáner y la regex anterior sobre textos
  generados con semilla fija y casos manuales: sin `@`, `@` tardía, muchos
  `@`, local largo, dominio largo, puntos repetidos, TLD válido/inválido,
  dígitos y `_` después del TLD, guiones, espacios, saltos de línea,
  puntuación adyacente, vecinos Unicode y dos emails con un tramo continuo
  alrededor del límite de `lastIndex`. Comparar **lista ordenada de spans y
  valores**, no solo cantidad. El oráculo usa el patrón anterior en tamaños
  acotados para que el test no bloquee el gate.
- Tests del motor sobre `Occurrence` y eventos para normalización, bbox,
  overlapping y patrón custom llamado `email`. La ruta custom debe conservar
  su semántica y presupuesto. Sin cambios en contratos.
- Repetir el banco opt-in adverso 2/10/20/40/80/160 KiB más caso de `@`
  tardía, con controles normales intercalados y mismas detecciones. Mostrar
  pendiente de la curva y retraso de cancelación, evitando un umbral absoluto
  frágil como gate. Repetir R1/R2 reales con los mismos agregados y huellas;
  invalidar cualquier tanda suspendida. Windows nativo ventilado seguirá
  pendiente hasta tener ese equipo.

## Consecuencias

La complejidad del email default deja de depender del número de inicios
fallidos en una corrida larga. El código específico del escáner aumenta la
superficie de tests, por eso la regex anterior queda como oráculo de paridad.
Una discrepancia diferencial detiene la adopción; no se acepta una mejora de
tiempo a costa de cambiar entidades o spans. Los patrones custom y su timeout
best-effort permanecen fuera de esta decisión.
