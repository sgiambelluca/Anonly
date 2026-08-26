<!-- CONTEXT: scope=adr | dependencias=00_Project_Vision.md,roadmap/MVP.md,core/Contracts.md,core/Regex_Engine.md,adr/ADR-094-Lo-Que-El-Detector-Duda-No-Se-Tira-En-Silencio.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-095 — La regla de matcheo es la métrica

- **Estado**: Accepted
- **Fecha**: 2026-08-26
- **Decidido por**: El humano, al aceptar el dataset de referencia en el plan y pedir que el evaluador se decida antes de escribirlo.
- **Relacionado con**: `00_Project_Vision.md` §7 (el gate que declara recall ≥ 90 % en Regex y ≥ 85 % en NER **sobre dataset de referencia**), `tests/fixtures/README.md` ("Dataset de referencia"), ADR-094 (los grupos sugeridos, que esta decisión tiene que contar aparte)
- **Parte de**: la campaña de calidad de detección abierta por `roadmap/Calidad_De_Deteccion_Informe.md`

> Convención de citas: `ADR-095 §N` refiere a **Decisión §N**.

## Contexto

### 1. El dataset ya está; falta lo que lo convierte en número

`tests/fixtures/reference/` tiene 20 documentos y 47 entidades con ground truth, ocho de ellos vacíos para medir falsos positivos. Lo que falta es el evaluador: correr el pipeline sobre cada documento y comparar contra la verdad.

**La regla de matcheo no es un detalle de implementación: es la métrica.** Decir "recall 94 %" sin decir qué cuenta como acierto no significa nada, y elegir mal la regla hace que el número mienta en la dirección que uno esperaba. Por eso se decide antes de escribir el código y no mientras se escribe.

### 2. Dos preguntas distintas que un solo número confunde

Sobre un documento que dice `"Juan Pérez"`:

- Si el motor detecta `"Juan"` y nada más, **`Pérez` sale en claro**. Contarlo como acierto porque "matcheó parcialmente" es exactamente la clase de número que tranquiliza y no protege.
- Si el motor detecta `"Belgrano 1234"` como `Organization` en vez de `Address`, **el dato está tapado**. No hay fuga; hay un token que afirma algo falso (`ADR-082`, §"Por qué existe"). Contarlo como fallo mezcla dos problemas de gravedad muy distinta.

Un solo número no puede responder las dos.

## Decisión

### 1. Una entidad esperada está detectada solo si quedó **cubierta entera**

Una entidad del ground truth cuenta como detectada cuando existe una detección **en la misma página** cuyo valor normalizado (`normalizeForComparison`, `Contracts.md` §6) **contiene entero** al valor normalizado esperado.

- truth `"Juan Pérez"` / detectado `"Juan Pérez"` → **acierto**
- truth `"Juan Pérez"` / detectado `"Juan"` → **fallo**, porque `Pérez` sale en claro
- truth `"Juan Pérez"` / detectado `"Juan Pérez, DNI"` → **acierto**: tapa de más, pero tapa

La contención y no la igualdad, porque lo que se está midiendo es **si el dato quedó cubierto**, y una detección más larga lo cubre. La igualdad estricta contaría como fallo un `"Empresa S.A"` contra un `"Empresa S.A."` esperado, que no es una fuga sino un punto.

### 2. Dos recalls, no uno

- **Recall de cobertura** (type-agnostic): ¿el dato quedó tapado? Es el que responde a la promesa del producto.
- **Recall tipado**: además del valor, ¿el `entityType` coincide? Es el que mide la calidad del documento resultante, porque el tipo gobierna el token, la numeración y de qué pool sortea el sintetizador.

El primero **nunca** puede ser menor que el segundo, y la distancia entre los dos es en sí un dato: dice cuántas entidades se tapan con la etiqueta equivocada.

El gate de `00_Project_Vision.md` §7 se mide contra el **recall de cobertura**: es el que corresponde a "el dato no sale".

### 3. La precisión castiga lo que no toca nada

Una detección es **falso positivo** cuando no se solapa con **ninguna** entidad esperada de su página — ni entera ni parcialmente.

Es deliberadamente más indulgente que la regla de recall, y la asimetría tiene razón: en una herramienta de privacidad un falso negativo es una **fuga** y un falso positivo es texto tapado de más que el usuario destilda. Medirlos con la misma vara trataría como iguales dos cosas que no lo son.

Los ocho documentos vacíos del dataset son los que hacen que este número signifique algo: ahí **toda** detección es un falso positivo, sin ambigüedad de matcheo.

### 4. Solo cuentan los grupos **habilitados**

La métrica mide lo que la herramienta taparía **sin intervención del usuario**, así que se cuentan los miembros de grupos con `enabled: true`. Un grupo sugerido por ADR-094 —apagado y marcado— **no cuenta como detección**: no tapa nada hasta que alguien lo habilite.

Se reportan aparte, como **sugerencias**, porque son una tercera categoría real: ni detectado ni perdido, sino "ofrecido al usuario". Sin esa separación, ADR-094 inflaría el recall sin haber tapado un solo dato más.

### 5. El evaluador mide **Regex** ahora, y NER cuando se pueda

`truth.json` marca cada entidad con `detector: "regex" | "ner"`, y las métricas se reportan por detector.

**El de NER queda fuera de esta entrega, por una limitación concreta y no por prioridad**: el kernel resuelve el modelo con `env.localModelPath = "/models/ner/"`, una ruta de servidor que en Node no existe, así que la suite no puede correr inferencia real (lo mismo que obligó a replayear tokens en `tests/integration/qa-stamp-detection.test.ts`). Medir NER con un modelo mockeado no mide nada.

No es una pérdida para lo que hoy se necesita: `MVP.md` §5 ya define el recall de NER como **informativo** en MVP y gate recién en v1.0, mientras que el de Regex **es gate de MVP**. El evaluador cubre exactamente el que hace falta.

### 6. Es una suite propia, y no corre con `pnpm test`

Vive en `tests/quality/`, y se parte en dos por una razón que conviene decir:

- **La corrida sobre los 20 documentos es un script** (`pnpm test:quality`, `main.ts`), no un test de vitest. Rasterizar y detectar sobre 20 PDFs es más lento que el resto de la suite junta, y el gate de calidad no tiene por qué encarecer el bucle de cada cambio.
- **La regla de matcheo sí es un test** (`matching.test.ts`) y **sí corre con `pnpm test`**. Es lo que hay que proteger de una regresión: la regla **es** la métrica, y un cambio silencioso ahí hace que todos los números futuros mientan. Cuesta milisegundos.

**Los umbrales del gate no se activan en esta entrega.** El evaluador primero tiene que reportar los números reales; recién con esos números a la vista se decide si el 90 % de `00_Project_Vision.md` §7 es alcanzable hoy o si el gate tiene que empezar más abajo y subir. Poner un umbral antes de mirar el número es elegir entre romper el build y no medir nada.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Contención (§1) | Igualdad estricta del valor normalizado | Contaría como fallo `"Empresa S.A"` contra `"Empresa S.A."`. Mide puntuación, no privacidad. |
| Contención (§1) | Substring en cualquier dirección | `"Juan"` contaría como acierto sobre `"Juan Pérez"` y el número diría que está tapado algo que sale en claro. Es la regla que más fácil infla el recall. |
| Contención (§1) | Solapamiento de `bbox` | Ata la métrica a la geometría, que es justamente lo que §23e dejó abierto (`Post_Hito10.8_Pendientes.md` §24). Una métrica de detección de texto se mide por texto. |
| Dos recalls (§2) | Un solo número, tipado | Mezcla una fuga con un token mal etiquetado. La distancia entre los dos números es información que se perdería. |
| Contar solo habilitados (§4) | Contar también los sugeridos | ADR-094 subiría el recall sin haber tapado un dato más. La métrica mediría la UI, no la anonimización. |
| Sin umbrales todavía (§6) | Activar el gate en 90 % desde el primer día | Nadie sabe todavía cuánto da. Un gate puesto a ciegas se desactiva a la semana, y un gate desactivado es peor que no tenerlo. |

## Consecuencias

**Positivas**:

- El gate de `00_Project_Vision.md` §7 pasa de estar escrito a ser ejecutable, al menos para Regex.
- Cualquier cambio de detección futuro —bajar el `confidenceThreshold`, aflojar un patrón, calibrar el piso de ADR-094 §2— pasa de ser una apuesta a ser una medición con dos números antes y después.
- La separación de §2 y §4 hace visible algo que hoy no se puede ver: cuánto se tapa con la etiqueta equivocada, y cuánto queda esperando una decisión del usuario.

**Negativas**:

- **No mide NER** (§5), que es la mitad que más se movió en esta campaña (ADR-088). Hasta que el modelo pueda correr en la suite, los cambios de NER se siguen validando caso por caso.
- Los 20 documentos son **sintéticos**. Miden regresiones y comparan alternativas entre sí; no dicen cómo se comporta sobre un expediente real. La advertencia ya está en `tests/fixtures/README.md` y este ADR no la levanta.
- Un dataset de 47 entidades tiene grano grueso: cada entidad vale más de dos puntos de recall. Sirve para detectar que algo se rompió, no para distinguir 91 % de 93 %.
- **El recall de Regex da 100 % y eso significa menos de lo que parece.** El ground truth de las entidades de Regex se construyó simulando el algoritmo real del motor para validarlo (ver `tests/fixtures/README.md`, "Hallazgos"), así que el dataset está en parte **ajustado a lo que el motor ya encuentra**. Ese 100 % dice sobre todo que el arnés funciona de punta a punta; su valor real es como **detector de regresiones** —si mañana un patrón se rompe, cae— y no como medida de qué tan bueno es el detector. Medir eso último pide entidades que nadie eligió pensando en el motor.
- El número que produzca puede ser incómodo. Es el punto.

## Validación

- Test: sobre un documento del dataset con entidades conocidas, el evaluador reporta el recall esperado calculado a mano.
- Test: la regla de §1 en sus tres casos —cubierto entero, cubierto de más, cubierto a medias— con el tercero contando como **fallo**.
- Test: un documento vacío en el que el motor detecta algo produce precisión < 1, y uno en el que no detecta nada produce precisión 1 sin dividir por cero.
- Test: un grupo `enabled: false` con `needsReview: true` **no** cuenta como detección y sí aparece en el conteo de sugerencias (§4).
- Test: el recall de cobertura es siempre ≥ el tipado (§2), sobre el dataset entero.
- `pnpm test:quality` corre y reporta; **no** entra en `pnpm test`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `00_Project_Vision.md` §7 (el gate declarado)
- `roadmap/MVP.md` §5 (recall de NER informativo en MVP, gate en v1.0)
- `tests/fixtures/README.md` ("Dataset de referencia", y la advertencia sobre lo sintético)
- `core/Contracts.md` §6 (`normalizeForComparison`)
- `adr/ADR-094-Lo-Que-El-Detector-Duda-No-Se-Tira-En-Silencio.md` §1 (los grupos sugeridos)
- `roadmap/Post_Hito10.8_Pendientes.md` §24 (por qué la métrica no se ata a la geometría)
- `ai/AI_Development_Guide.md` R-13, R-18, R-21
