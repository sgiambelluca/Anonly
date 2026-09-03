<!-- CONTEXT: scope=adr | dependencias=ai/AI_Development_Guide.md,ai/Code_Standards.md,adr/ADR-017-Roles-Planificador-Implementador-Revisor.md | audiencia=humanos+IA | fase=11 -->

# ADR-124 — La unidad de alcance es el commit, no el PR

- **Estado**: Accepted
- **Fecha**: 2026-09-03
- **Decidido por**: El humano, sobre el hallazgo de la revisión de la branch `fix/calidad-de-deteccion`: como PR único contra `main`, toca los siete motores y por lo tanto incumple R-1 sin lectura benigna posible.
- **Relacionado con**: **R-1/R-5, R-19 y R-21** de `ai/AI_Development_Guide.md`, ADR-017 (los tres roles)
- **Parte de**: Hito 11

## Contexto

### 1. Una campaña de calidad no tiene la forma de un PR de motor

R-1 y R-5 nacieron para el trabajo que el proyecto hacía cuando se escribieron: **implementar un motor desde su spec**. Ahí la regla es exacta y sigue siéndolo — un motor, un spec, un PR, un revisor que compara diff contra spec.

`fix/calidad-de-deteccion` no es eso. Es una campaña de **calidad de detección** guiada por mediciones sobre documentos reales: se mide un defecto, se lo persigue hasta el motor donde vive, se lo arregla, se vuelve a medir. Cuál motor toca cada arreglo **no se sabe antes de medir**. El defecto de una carátula sin detectar terminó en `regex-engine`; el de la caja que tapaba de más, en `pdf-engine`; el orden de lectura de un escaneo torcido, otra vez en `pdf-engine` pero por el camino del OCR; el grupo espurio de la `S`, en `ner-engine`. Son 99 commits y 36 ADR.

Partirla en siete PRs no la hubiera hecho más auditable: los arreglos **dependen unos de otros** —ADR-123 existe porque ADR-122 destapó el defecto que tapaba—, y siete PRs con dependencias cruzadas se revisan peor que una branch con historia legible.

### 2. Lo que la regla estaba protegiendo de verdad

Que un cambio no se cuele mezclado con otro y nadie pueda auditarlo. Eso **no lo garantiza el PR**: lo garantiza el commit. Y de hecho el commit lo garantiza mejor, porque es la unidad que el revisor puede recorrer una por una (`git show --stat`).

La prueba está en la misma revisión que originó este ADR: el revisor detectó **seis commits** que tocan dos motores o más, y ninguno de ellos era ambiguo — cinco son cambios de contrato que por naturaleza ondulan a varios motores (ADR-104, ADR-105, ADR-109), y el sexto es un scrub de datos. Los detectó recorriendo commits, no PRs.

### 3. R-21 protege de algo concreto, y no es esto

> R-21: "Los specs de motor **nunca** se editan desde un PR de implementación; se editan desde un PR de documentación aparte."

La razón real de esa regla es que **un agente implementador no reescriba el spec para que coincida con el código que acaba de escribir**. Es una regla sobre quién, no sobre cuándo: protege el spec de la mano que implementa.

En esta campaña el spec y el ADR los escribe el **planificador**, antes de decidir el cambio, y el implementador recibe el spec ya cerrado. La secuencia que R-19 pide —contrato, después spec, después código— se cumple; lo que no se puede es *auditarla por la forma del commit*, porque llegan juntos.

## Decisión

### 1. R-1 y R-5 se miden por **commit**

Un **commit** toca un módulo. Un PR puede tocar varios, siempre que cada commit toque uno.

La excepción tiene un alcance nombrado, no es una puerta abierta: vale para una **branch de campaña** —una secuencia de arreglos guiada por medición, donde el motor afectado es un resultado y no un dato de partida—. Un PR que implementa un motor desde su spec sigue siendo un PR de un módulo, y ahí R-1 se lee como siempre.

**Y la campaña se declara por adelantado**, en el documento de roadmap o en el commit que abre la branch. Sin eso, la etiqueta es una defensa que se elige después de que alguien objeta — que es exactamente como se estrenó esta: el revisor marcó el incumplimiento de R-1 sobre una branch de 99 commits y recién ahí se nombró la excepción. Declararla antes la convierte en un compromiso, y el costo es una línea.

**El commit que cambia un contrato es la excepción de la excepción**: por definición toca todos los motores que consumen ese tipo. Se acepta explícitamente, con dos condiciones — que exista el ADR que lo autoriza (R-2, que no se toca) y que el commit lleve **el cambio de tipo más la adaptación mecánica de sus consumidores, y nada más**: ningún comportamiento nuevo viaja ahí.

La segunda condición decía antes "que el commit no lleve nada más que ese cambio", y así no se podía aplicar. Los cuatro commits de contrato de esta branch, contando **solo fuente** —sin tests ni docs—:

| commit | fuente | de eso, UI |
|---|---|---|
| `9c846e7` | 2 | 0 |
| `7bb2e3a` | 7 | 1 — `SplitDialog.tsx` |
| `68eb996` | 3 | 1 — `SplitDialog.tsx` |
| `3fc3882` | 2 | 0 |

Los dos diffs de `SplitDialog.tsx` son **renderizar el campo que el contrato acaba de ganar** —`member.context` en uno, `member.value` en el otro—: ningún control nuevo, ningún estado nuevo. Eso es adaptación mecánica de consumidor, y la redacción vieja no daba forma de decir si contaba o no. Una condición que no se puede decidir no es una condición.

> **Este párrafo estuvo mal dos veces, y las dos en la misma dirección.** La primera versión decía "siete archivos uno, tres el otro… bajo lectura estricta ninguno calificaba". Los siete archivos de `3fc3882` son **todos tests**: ese commit no toca UI y es el más limpio de los cuatro. El dato salió de la revisión, se tomó de buena fe y **no se verificó** antes de escribirlo acá — el mismo modo de falla que §"En contra" documenta para el conteo de los residuales, con los roles invertidos. En un documento cuyo argumento es no maquillar la contabilidad de incumplimientos, el párrafo que la lleva es el que hay que verificar dos veces.

### 2. R-21 se aplica al **implementador**, no al planificador

El spec sigue sin poder editarse desde la mano que implementa. Cuando el ADR y el spec los escribe el planificador antes del cambio, pueden viajar en el mismo commit que el código: separarlos en dos commits sobre una branch de un solo autor no agrega auditoría, y abre una ventana donde el spec dice una cosa y el código todavía otra.

**R-19 no se afloja.** El orden contrato → spec → código sigue siendo obligatorio; lo que cambia es que se audita por el **contenido** del commit (¿está el ADR? ¿está el caso en §13 y la fila en §14?) y no por su cantidad.

### 3. Lo que sigue siendo indivisible

- **Higiene de datos en su propio commit.** Un reemplazo de nombres reales no viaja adentro de un commit funcional. Esta campaña lo violó **al menos dos veces**: `46c67cc` metió el scrub de un apellido dentro de un fix de NER, sin mención en el mensaje, y `94c96be` mezcló el scrub principal con dos motores. `542d4d2` fue un tercer arrastre, pero ése sí fue commit propio y cumple. La higiene es lo que más necesita ser trazable, y fue lo que menos lo era.
- **Un cambio de comportamiento, un commit.** La excepción es sobre *cuántos módulos*, no sobre cuántas ideas.

## Consecuencias

**A favor**

- La regla pasa a decir lo que el proyecto realmente puede cumplir, en vez de quedar como una que se incumple sistemáticamente y todos miran para otro lado. Una regla que se viola 99 veces sin consecuencia no protege nada; enseña que las reglas son decorativas.
- El revisor gana un criterio operable: recorrer commits con `git show --stat` y marcar los que tocan dos motores. Es lo que ya hizo, ahora con una regla que lo respalda.

**En contra**

- **Un PR grande es más difícil de revisar, y eso no lo arregla ningún ADR.** La revisión de esta branch tuvo que declarar qué miró a fondo y qué por encima — de 36 ADR nuevos verificó tres contra el código. Esto documenta la excepción; no la vuelve gratis.
- **"Branch de campaña" es un criterio que se puede estirar.** No hay forma de medirlo automáticamente. La declaración previa de §1 acota el peor caso —no se puede invocar la excepción *después* de que alguien objete— pero no impide declarar campaña un trabajo que no lo es. Ahí no queda otra cosa que la honestidad de quien lo invoca, y conviene que esté escrito y no supuesto.
- **De los seis commits multi-motor de esta branch, dos siguen incumpliendo la regla nueva.** Los otros cuatro son cambios de contrato y quedan cubiertos por §1. Los dos que no:

  | commit | motores | por qué no lo cubre §1 |
  |---|---|---|
  | `665527c` (ADR-099) | export, ner, ocr | carga diferida del kernel: **ninguna** superficie de contrato — no toca `Contracts.md` ni `shared/` |
  | `94c96be` | ner, regex | higiene de datos, que además viola la R-22 que este mismo ADR crea |

  Arreglarlos requeriría reescribir historia ya publicada, y la decisión fue no hacerlo.

  **`ADR-099` §5 ("Esta decisión autoriza el cambio en los tres motores") se autoconcede una excepción a R-1 para ese commit** —"acá el cambio es el mismo patrón, tres veces, y partirlo dejaría el build a medio migrar"—. Ese reclamo **no se sostiene bajo la regla nueva**: no es un cambio de contrato, y en su momento no había campaña declarada. Queda como lo que es, la autojustificación previa; la contabilidad autoritativa es esta tabla. `ADR-105` usa la misma fórmula para `7bb2e3a`, pero ahí §1 sí lo cubre — es fraseo viejo, no un reclamo pendiente.

  **La primera versión de este párrafo decía "cinco" y daba `665527c` por cubierto.** Lo encontró el revisor aplicando el test de este ADR commit por commit. El error caía a favor propio, y en el único párrafo donde el documento rinde cuentas de su propio residuo — que es donde menos se lo puede permitir, porque es el que sostiene la afirmación de honestidad del resto.

**Lo que no toca**: R-2 (contratos), R-3/R-4, P-1..P-10 salvo la aclaración de P-6, ni la cobertura de R-13.
