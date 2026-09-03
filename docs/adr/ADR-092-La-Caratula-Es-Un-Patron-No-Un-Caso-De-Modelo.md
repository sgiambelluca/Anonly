<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Regex_Engine.md,core/Grouping_Engine.md,adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md,adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md,adr/ADR-075-Fechas-En-Texto-Y-Tramos-De-Identificadores.md,adr/ADR-091-El-Lexico-De-Nombres-No-Es-De-Un-Motor.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-092 — La carátula es un patrón, no un caso de modelo

- **Estado**: Accepted
- **Fecha**: 2026-08-26
- **Decidido por**: El humano, sobre §23c del gate manual y la medición de 16 casos de Contexto §2.
- **Relacionado con**: ADR-091 §1 (el léxico promovido, que este ADR es la razón de que exista en `shared`), ADR-075 §1 (el precedente exacto de un `normalizer` que hace agrupar dos formas distintas del mismo dato), ADR-073 §1 (el pase difuso que cierra el último tramo), ADR-069 §1 (la fuente del léxico)
- **Parte de**: la campaña de calidad de detección abierta por `roadmap/Calidad_De_Deteccion_Informe.md`

> Convención de citas: `ADR-092 §N` refiere a **Decisión §N**.

## Contexto

### 1. El modelo ve la carátula y no le alcanza

`"Expediente caratulado: Pérez, Juan c/ Empresa S.A."` es la forma canónica de una carátula judicial, y sale en claro del exportado (§23c). Reproducido con el pipeline real y el modelo de producción: el modelo **sí** ve los dos tokens, y los etiqueta `Pérez` con **0,5924** y `Juan` con **0,6991** — los dos por debajo del `confidenceThreshold` de 0,7. Grouping los manda al camino de confianza baja, no encuentra grupo candidato al que parecerse, y los descarta sin emitir nada.

O sea que no es un falso negativo del modelo: es un **orden invertido** que el modelo reconoce a medias y que el umbral remata. Bajar el umbral lo arreglaría y movería la precisión de todos los documentos a la vez, sin dataset con el cual medirlo (`tests/fixtures/README.md`, "Dataset de referencia"). `Apellido, Nombre` tiene forma fija: es un patrón.

### 2. El patrón a secas es inservible; con el léxico, no

`Palabra, Palabra` matchea media Argentina. Medido sobre 16 casos —seis carátulas y diez trampas— con la compuerta del léxico de nombres de pila (ADR-091) y sin ella:

| | aciertos |
|---|---|
| solo el patrón | 7 de 10 |
| patrón + léxico | **15 de 16** |

Lo que el léxico descarta, y el patrón solo no:

```
(nada)  ← oficina de San Miguel, Tucumán
(nada)  ← domicilio en Mar del Plata, Buenos Aires
(nada)  ← conforme al Código Civil, Título III
(nada)  ← Notifíquese en La Plata, Buenos Aires
```

Y lo que encuentra:

```
[Pérez, Juan]            ← Expediente caratulado: Pérez, Juan c/ Empresa S.A.
[López, María]           ← perito a López, María Fernanda, quien acepta
[Echeverria, Marta]      ← Firmado: Echeverria, Marta de los Mercedes
```

### 3. El residuo, y por qué se acepta

El único caso que falla es `"Buenos Aires, Argentina"` → `Aires, Argentina`, porque **"Argentina" es un nombre de pila permitido** en el registro de Buenos Aires.

Probé un lookbehind que lo arregla —exigir que el apellido no venga precedido de otra palabra capitalizada— y el resultado es una permuta, no una mejora: gana `"Buenos Aires, Argentina"` y pierde `"el Doctor Pérez, Juan"`. Para una herramienta de privacidad esa permuta va en la dirección equivocada: un falso negativo es una **fuga** que rompe la promesa del producto; un falso positivo es un topónimo tapado de más que el usuario destilda con un click. No son igual de graves.

Se acepta el residuo y se documenta, con el mismo criterio con el que ADR-075 §5 aceptó `"Tel.0221-4567890"`.

## Decisión

### 1. Un patrón `caratula-ar`, con el léxico como checksum

Se agrega a `DEFAULT_PATTERNS_AR` una fila trece:

```
id:          "caratula-ar"
entityType:  Person
pattern:     /\b(\p{Lu}\p{Ll}+),\s+(\p{Lu}\p{Ll}+)\b/gu
checksum:    el primer nombre de pila está en GENDER_LEXICON
normalizer:  invierte a "Nombre Apellido" y aplica normalizeForComparison
maskFormat:  "XXXXX XXXXX"   (el mismo que MASK_FORMAT_BY_TYPE[Person])
```

**Una palabra de cada lado**, y las dos razones son distintas:

- **El apellido**, porque sin la coma como ancla un apellido compuesto no se distingue de un topónimo (`"Mar del Plata, Buenos Aires"`).
- **El nombre**, y esto lo obligó una regresión medida, no una previsión. La primera redacción permitía uno o más (`(?:\s+\p{Lu}\p{Ll}+)*`) para capturar `"López, María Fernanda"`. Un cuantificador goloso se traga **cualquier** palabra capitalizada que siga: sobre la firma de la pericia real (`tests/integration/annotation-signature.test.ts`, cuyo `Page.text` es `"Echeverria, Marta Date: 07/07/2026"`) el patrón matcheaba `"Echeverria, Marta Date"`. Esa ocurrencia **cruza al run siguiente**, su envolvente se estira sobre los dos, y Grouping descarta por solapamiento el grupo de **Fecha**. Es exactamente el mecanismo que ADR-088 §1 tuvo que cerrar en NER: una entidad que abarca dos runs no solo tapa de más — hace **desaparecer** a su vecina.

El costo es que un segundo nombre de pila queda fuera del match: `"López, María Fernanda"` produce `"López, María"`. Se acepta. El apellido y el primer nombre son la parte identificatoria, y un nombre suelto es territorio del NER — mientras que el modo de falla que evita puede borrar una entidad entera de otro tipo.

**El `checksum` es la compuerta, y usarlo así no es un abuso del campo**: `RegexPattern.checksum` es "validación adicional sobre el `normalizedValue`", y la validación adicional de una carátula es exactamente que el nombre de pila sea un nombre de pila — igual que la de un CUIT es que cierre el módulo 11. Recibe el `normalizedValue`, que tras §1 ya viene invertido, así que la clave a consultar es su **primer** token.

### 2. El `normalizer` invierte, y eso es lo que agrupa

`"Pérez, Juan"` normaliza a `"juan perez"`, que es lo que produciría `"Juan Pérez"` del cuerpo. Es el mismo mecanismo con el que ADR-075 §1 hizo que `"07 de julio de 2026"` y `"7/7/2026"` cayeran en el mismo grupo: **el normalizador lleva las dos formas al mismo `normalizedValue`**.

Con una diferencia que conviene decir: contra una ocurrencia de **NER** la unión ocurre por el **pase difuso**, no por el exacto. `normalizeNerValue` (kernel de NER) no pliega diacríticos, así que emite `"juan pérez"` mientras este patrón emite `"juan perez"`; `levenshteinNormalized` da 0,9 sobre un umbral de 0,88 y agrupan igual. Es la deuda que ADR-088 §3 ya dejó anotada, y este ADR la vuelve visible en un segundo lugar en vez de arreglarla — arreglarla es cambiar cómo se compara **todo** valor de NER, y no hay dataset para medir ese cambio.

### 3. Lo que este ADR NO hace

- **No cambia el `confidenceThreshold`.** El umbral sigue en 0,7 y la ocurrencia de NER de la carátula sigue descartándose; lo que cambia es que ahora hay una ocurrencia de **Regex**, con `confidence: 1.0`, cubriendo el mismo texto.
- **No cierra el descarte silencioso de confianza baja.** `handleLowConfidence` sigue tirando sin avisar toda ocurrencia de NER sin grupo candidato. La carátula deja de depender de eso; el resto de los nombres limítrofes, no. Es el trabajo que sigue.
- **No toca ningún contrato público.** Una fila más en una tabla de patrones; `RegexPattern` no cambia de forma.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Un patrón con léxico (§1) | Bajar el `confidenceThreshold` a ~0,55 | Una línea, y cierra §23c. Pero cambia qué se tapa en **todos** los documentos sin dataset que lo mida y sin control en la UI —el diálogo de ajustes no expone el umbral—. Queda para cuando exista el dataset de referencia. |
| Un patrón con léxico | Que `ner-engine` fusione dos spans `PER` adyacentes separados por coma | El modelo los ve, así que es tentador. Pero la confianza del span fusionado es el promedio de los dos: 0,646, **debajo del umbral igual**. No arregla nada. |
| Una palabra de cada lado (§1) | Permitir apellido compuesto (`Palabra Palabra, Nombre`) | Sin la coma como ancla, un apellido compuesto es indistinguible de un topónimo: `"Mar del Plata, Buenos Aires"` pasaría a matchear. |
| Una palabra de cada lado (§1) | Permitir varios nombres de pila (`Apellido, Nombre Nombre`) | **Era la primera redacción, y una regresión medida la revirtió**: el cuantificador goloso se traga la palabra capitalizada que siga, la ocurrencia cruza al run vecino y Grouping descarta por solapamiento el grupo de al lado. Ver §1. |
| Una palabra de cada lado (§1) | Varios nombres, pero exigiendo que **todos** estén en el léxico | El regex captura goloso y el `checksum` corre **después**: sobre `"Marta Date"` rechazaría el match **entero**, perdiendo la carátula en vez de acortarla. El motor no puede hacer backtracking sobre un callback. |
| Aceptar el residuo (§3) | Lookbehind negativo sobre el apellido | Medido: gana `"Buenos Aires, Argentina"` y pierde `"el Doctor Pérez, Juan"`. Cambia un falso positivo por un falso negativo, y en esta herramienta un falso negativo es una fuga. |
| Invertir en el `normalizer` (§2) | Dejar `normalizedValue` como `"perez, juan"` | El grupo quedaría separado del `"Juan Pérez"` del cuerpo: mismo nombre, dos tokens en el documento anonimizado. La inversión es lo que los une. |

## Consecuencias

**Positivas**:

- **§23c cierra**, y con él la última de las tres fugas de dato que el gate manual encontró en `qa-stamp.pdf`.
- La carátula se detecta con `confidence: 1.0` y `source: regex`, o sea que no depende del umbral de NER ni del modelo — sobre un documento donde el NER está apagado (`ner.enabled: false`) también funciona.
- Por el `normalizer` invertido, la carátula y el nombre del cuerpo caen en el **mismo grupo**, así que el documento anonimizado los tapa con el mismo token.
- El patrón alcanza cualquier `Apellido, Nombre`, no solo el de la primera línea: firmas, listados, tablas de partes.
- Un segundo nombre de pila (`"López, María Fernanda"` → `"López, María"`) queda fuera del match y depende del NER. Es el precio de no poder cruzar un borde de run (§1).

**Negativas**:

- **`"Buenos Aires, Argentina"` se detecta como Persona** (Contexto §3). Es sobre-tapado, no fuga, y el usuario lo destilda — pero destruye una referencia geográfica del documento si no lo hace.
- La unión con el nombre del cuerpo depende del **pase difuso** (0,9 contra un umbral de 0,88), no del exacto. El margen es de 0,02: si alguien sube `similarityThreshold`, la carátula se separa del cuerpo en silencio. La causa de fondo es la divergencia de `normalizeNerValue`, anotada en ADR-088 §3 y todavía abierta.
- El léxico son nombres **argentinos**. Una carátula con un nombre de pila extranjero que el registro de Buenos Aires no tiene no matchea. Es un límite de la fuente, no del patrón.
- Trece patrones en vez de doce, sobre el mismo texto de página. El costo por página es despreciable frente a NER, pero la tabla es lo que se recorre por cada página de cada documento.

## Validación

- Test unit: las seis carátulas de Contexto §2 se detectan como `Person` con `confidence: 1.0`.
- Test unit: las diez trampas —topónimos, `"Código Civil, Título III"`, `"El actor, Juan Pérez"` (que ya está en el orden correcto y no es una carátula)— **no** emiten.
- Test unit: `"Pérez, Juan"` y `"Juan Pérez"` en el mismo documento terminan en **un solo grupo**.
- Test unit: `"Buenos Aires, Argentina"` **sí** emite — el residuo aceptado, en un test, para que sea conocido y no una sorpresa (mismo criterio que `"Tel.0221-4567890"` de ADR-075 §5).
- Test unit: `"López, María Fernanda"` produce `"López, María"` — la limitación de §1, afirmada para que sea deliberada y no una sorpresa.
- Test unit: `"Echeverria, Marta Date: 07/07/2026"` produce **solo** `"Echeverria, Marta"` — la regresión concreta que fijó el límite.
- Test de integración (`annotation-signature.test.ts`, ya existente): la firma sigue produciendo grupo de Persona **y** de Fecha. Es el test que destapó el problema.
- Test de integración: el `it.fails` de §23c en `tests/integration/qa-stamp-detection.test.ts` pasa a `it`.
- Cobertura ≥ 85% líneas en `regex-engine`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `roadmap/Post_Hito10.8_Pendientes.md` §23c
- `core/Regex_Engine.md` §"Patrones default (especificación exacta)", §13, §14
- `adr/ADR-091-El-Lexico-De-Nombres-No-Es-De-Un-Motor.md` §1
- `adr/ADR-075-Fechas-En-Texto-Y-Tramos-De-Identificadores.md` §1 (el precedente del normalizador que agrupa), §5 (el precedente del residuo aceptado)
- `adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md` §1
- `adr/ADR-088-El-Texto-Que-Recibe-El-NER.md` §3 (la divergencia de `normalizeNerValue`, que este ADR vuelve visible)
- `ai/AI_Development_Guide.md` R-2, R-13, R-18, R-21
