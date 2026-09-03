<!-- CONTEXT: scope=adr | dependencias=core/Regex_Engine.md,adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md,adr/ADR-075-Fechas-En-Texto-Y-Tramos-De-Identificadores.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-093 — La característica telefónica no siempre tiene dos dígitos

- **Estado**: Accepted
- **Fecha**: 2026-08-26
- **Decidido por**: El humano, sobre el hallazgo que salió de construir el dataset de referencia.
- **Relacionado con**: ADR-022 (que fijó los `\b` de este mismo patrón y no tocó la cantidad de dígitos), ADR-075 §2 (la guarda de corrida, que sigue aplicando)
- **Parte de**: la campaña de calidad de detección abierta por `roadmap/Calidad_De_Deteccion_Informe.md`

> Convención de citas: `ADR-093 §N` refiere a **Decisión §N**.

## Contexto

### 1. Un celular de cualquier ciudad que no sea Buenos Aires sale en claro

`phone-mobile-ar` es `(?:\+?54)?[\s-]?\b\d{2}[\s-]?\d{4}[\s-]?\d{4}\b`: exige característica de **exactamente dos dígitos**. El plan de numeración argentino no funciona así — la característica tiene entre 2 y 4 dígitos, y lo que es invariante es que **característica + abonado suman 10**:

| característica | abonado | ejemplo |
|---|---|---|
| 2 (CABA) | 8 | `11 4567-8900` |
| 3 (La Plata, Rosario, Córdoba, Paraná) | 7 | `221 456-7890` |
| 4 (localidades chicas) | 6 | `2954 12-3456` |

Verificado contra los patrones reales:

```
detecta     "+54 11 4567-8900"    (CABA)
NO DETECTA  "+54 221 456-7890"    (La Plata)
NO DETECTA  "+54 341 456-7890"    (Rosario)
NO DETECTA  "+54 351 456-7890"    (Córdoba)
NO DETECTA  "+54 2954 12-3456"    (Santa Rosa)
```

`phone-landline-ar` (`\b0\d{1,4}[\s-]?\d{6,8}\b`) tampoco los toma: exige un `0` inicial, que un número escrito en formato internacional no tiene.

### 2. Cómo apareció

Construyendo el dataset de referencia. `shared/src/synthesizer.ts` sortea la característica de una lista que incluye `221`, `341`, `351`, `343` y `380`, así que **el sintetizador del propio producto genera teléfonos que el propio producto no detecta**. Lo que arrancó como una incompatibilidad entre dos piezas internas resultó ser un hueco de detección sobre documentos reales.

Vale anotarlo como argumento a favor del dataset: el hueco apareció **antes** de que el dataset llegara a correr, solo por el ejercicio de escribir el ground truth a conciencia.

## Decisión

### 1. Los tres agrupamientos, enumerados

```
(?:\+?54[\s-]?)?(?:9[\s-]?)?\b(?:\d{2}[\s-]?\d{4}[\s-]?\d{4}|\d{3}[\s-]?\d{3}[\s-]?\d{4}|\d{4}[\s-]?\d{2}[\s-]?\d{4})\b
```

Una alternancia de tres ramas, una por longitud de característica, **todas de 10 dígitos**. Se agrega además el `9` opcional del formato de móvil internacional (`+54 9 11 …`), y el separador opcional se ata al prefijo de país en vez de quedar suelto — lo que de paso corrige el residuo de la v1.6.2 en el origen y no solo en el valor emitido.

**La enumeración es el punto, no un detalle de implementación.** Medido contra ocho trampas, comparando con una alternativa laxa (`\d{2,4}[\s-]?\d{2,4}[\s-]?\d{3,4}`):

| | teléfonos detectados | falsos positivos |
|---|---|---|
| patrón de hoy | 2 de 7 | 1 de 8 |
| **enumerado (esta decisión)** | **7 de 7** | **1 de 8** |
| laxo | 7 de 7 | 4 de 8 |

El laxo agrega tres falsos positivos que el enumerado no tiene: se come tres grupos de una tarjeta (`"4532 1234 5678"`), tres de un IBAN (`"1234 5678 9012"`) y dos números sueltos adyacentes (`"expediente 1234 5678"`). La enumeración por total de 10 dígitos es lo que lo evita.

### 2. El falso positivo que queda es el que ya estaba

`"CUIT 20-12345678-9"` sigue produciendo `"20-12345678"`. **No es una regresión de este ADR**: es el falso positivo preexistente que `tests/fixtures/README.md` y `scenario-8-ner-disabled.spec.ts` ya documentan, y que la guarda de corrida de ADR-075 §2 no descarta porque la corrida no tiene letras. Este cambio no lo empeora ni lo mejora, y **no se aborda acá** — tocarlo es otra decisión, sobre otro patrón.

Es la razón por la que la tabla de §1 dice "1 de 8" en las dos filas: el patrón nuevo es estrictamente mejor, no un intercambio.

### 3. Lo que no cambia

- `phone-landline-ar` **no se toca**. Cubre el formato nacional con `0` inicial y sigue haciéndolo.
- La guarda de corrida de ADR-075 §2 sigue aplicando sin cambios: es una propiedad del contexto del match, no del patrón.
- El `normalizer` (`stripNonDigits`) y el `maskFormat` quedan igual.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Enumerar los tres agrupamientos (§1) | Rango laxo `\d{2,4}[\s-]?\d{2,4}[\s-]?\d{3,4}` | Medido: mismos 7 teléfonos, **3 falsos positivos más** — se come tramos de tarjeta, de IBAN y dos números sueltos adyacentes. El total de 10 dígitos es lo que discrimina. |
| Enumerar (§1) | Contar solo dígitos, ignorando el agrupamiento | Un patrón "10 dígitos con separadores libres" matchea cualquier tramo de un identificador largo. Es la misma clase de error que ADR-075 §2 tuvo que cerrar con la guarda de corrida. |
| Dejar el falso positivo del CUIT (§2) | Arreglarlo en el mismo cambio | Es preexistente, está documentado y tiene un test que lo fija. Mezclarlo escondería si el patrón nuevo introduce algo o no — que es justamente lo que la tabla de §1 tiene que poder afirmar. |

## Consecuencias

**Positivas**:

- Un celular de La Plata, Rosario, Córdoba, Paraná o cualquier localidad con característica de 3 o 4 dígitos deja de salir en claro. Sobre un expediente de provincia, eso es la diferencia entre detectar los teléfonos y no detectar ninguno.
- El formato `+54 9 …` (móvil internacional) pasa a cubrirse.
- `shared/src/synthesizer.ts` deja de generar valores que el motor no detecta, sin tocarlo.

**Negativas**:

- El patrón pasa de una expresión de una línea a una alternancia de tres ramas. Es más difícil de leer, y esa es la contra real. La mitiga que las tres ramas son la misma forma con la coma corrida, y que la tabla de §1 dice por qué no se puede simplificar a un rango.
- Más ramas es más trabajo por página, sobre el texto completo de cada documento. Despreciable frente a NER, pero la tabla de patrones se recorre por cada página.
- El falso positivo del CUIT sigue ahí (§2).

## Validación

- Test unit: los cinco formatos de característica de §1 (`11`, `221`, `341`, `351`, `2954`), con y sin prefijo de país, emiten `Phone`.
- Test unit: `"+54 9 11 4567-8900"` emite — el formato de móvil internacional.
- Test unit: las ocho trampas medidas —expediente, DNI, tarjeta, fecha, IBAN, paginación, dos números sueltos— **no** emiten Phone, salvo el CUIT preexistente de §2.
- Test unit: `"CUIT 20-12345678-9"` sigue produciendo el mismo falso positivo que antes del ADR — afirmado para que quede claro que no es una regresión de este cambio y que su valor no cambió.
- Test unit: `phone-landline-ar` sigue tomando `"0221-4567890"` — la no regresión del patrón que no se toca.
- Cobertura ≥ 85% líneas en `regex-engine`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `core/Regex_Engine.md` §"Patrones default (especificación exacta)", §13, §14
- `adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md` (los `\b` de este patrón)
- `adr/ADR-075-Fechas-En-Texto-Y-Tramos-De-Identificadores.md` §2 (la guarda de corrida, intacta)
- `tests/fixtures/README.md` (el falso positivo del CUIT, preexistente y documentado)
- `ai/AI_Development_Guide.md` R-2, R-13, R-18, R-21
