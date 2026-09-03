<!-- CONTEXT: scope=adr | dependencias=core/Regex_Engine.md,adr/ADR-092-La-Caratula-Es-Un-Patron-No-Un-Caso-De-Modelo.md,adr/ADR-096-Los-Patrones-Cubren-Como-Se-Escribe-El-Dato.md,roadmap/Post_Hito10.8_Pendientes.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-103 — La carátula se reconoce por su contexto, no por su coma

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, tras revisar el PDF exportado de una pericia real (`Post_Hito10.8_Pendientes.md` §27 punto 4).
- **Relacionado con**: **ADR-092 (corregido en su patrón)**, ADR-096 (los patrones cubren cómo se escribe el dato)
- **Parte de**: Hito 11, calidad de detección

## Contexto

### 1. El patrón busca una coma, no una carátula

ADR-092 creó `caratula-ar` con la forma:

```
\b(\p{Lu}\p{Ll}+),\s+(\p{Lu}\p{Ll}+)\b
```

"Dos palabras capitalizadas separadas por coma". Eso **no es una carátula**: es una forma que aparece en prosa normal todo el tiempo.

### 2. Dos clases de falso positivo, y el checksum no puede con ninguna

Encontradas por el humano leyendo el PDF exportado de una pericia real:

| clase | ejemplo | por qué el checksum no ayuda |
|---|---|---|
| adverbio inicial | `Finalmente, Alejandro` | `firstNameIsInLexicon` mira el **segundo** término, y ahí sí hay un nombre real |
| **enumeración** | `Abril, Facundo` | **los dos son nombres reales** |

La segunda es la grave: son **dos personas distintas** y el patrón las emite como **una sola entidad**. Anonimizar las junta bajo un mismo token, y separarlas después es trabajo manual — con el agravante de que el separador tampoco muestra los valores (§27 punto 3).

Una lista de adverbios no alcanza: `Abril` no es un adverbio.

### 3. ADR-092 ya evaluó esta idea y la rechazó — con menos evidencia

Hay que decirlo de frente. La nota v1.8.0 de `Regex_Engine.md` dice:

> *"Residuo aceptado y con test: `"Buenos Aires, Argentina"` matchea, porque "Argentina" **es** un nombre permitido — el lookbehind que lo arregla pierde `"el Doctor Pérez, Juan"`, y cambiar un falso positivo por un falso negativo va en la dirección equivocada para esta herramienta."*

Ese razonamiento es correcto **con la evidencia que había**: un falso positivo conocido (`Buenos Aires, Argentina`) contra un falso negativo concreto. Con un caso de cada lado, preferir el ruido al hueco es la elección correcta para un anonimizador.

Lo que cambió no es el criterio, es lo que sabemos de cada lado:

1. **La clase de falso positivo es mucho más grande de lo que se creía.** No es un topónimo raro: es *cualquier* adverbio al inicio de oración y *cualquier* enumeración de dos nombres. En prosa jurídica eso aparece seguido.
2. **Uno de ellos no es un falso positivo cualquiera: corrompe un verdadero positivo.** `Abril, Facundo` no inventa una persona de la nada — **fusiona dos que existen**. Anonimizar a una arrastra a la otra, y el usuario no tiene cómo notarlo hasta leer el PDF exportado, que es exactamente como se encontró.

Un falso positivo que se ve y se apaga cuesta un clic. Uno que **junta dos personas** cuesta una fuga silenciosa. No son la misma moneda, y la regla "no cambies un FP por un FN" los trataba como si lo fueran.

De yapa, el anclaje también cierra el residuo que ADR-092 aceptó: `"Buenos Aires, Argentina"` no tiene ninguna marca de carátula cerca.

### 4. El patrón existe para un lugar concreto

ADR-092 no lo creó como detector general de personas. Lo creó porque **en la carátula el modelo de NER falla**: el orden está invertido (apellido primero) y la confianza queda por debajo del umbral. Es un parche para el único lugar donde NER no llega.

En el cuerpo del texto los nombres los detecta NER. Ahí este patrón no aporta — solo agrega ruido.

## Decisión

### 1. El match exige una marca de carátula adyacente

Una carátula judicial no aparece suelta. Va **precedida** de la palabra que la introduce, o **seguida** de las partículas que separan a las partes:

```
(?<=(?:caratulad[oa]s?|[Aa]utos|[Cc]ausa|[Ee]xpediente)\s*:?\s{0,3}) Apellido, Nombre
                                          │
Apellido, Nombre (?=\s+(?:c\/|s\/))  ─────┘
```

Cualquiera de las dos alcanza: `Autos: Pérez, Juan` (marca antes) y `Pérez, Juan c/ Empresa` (marca después) matchean por vías distintas.

### 2. Medido sobre las dos clases

| caso | hoy | anclado |
|---|---|---|
| `Expediente caratulado: Pérez, Juan c/ Empresa` | ✓ | **✓** |
| `Autos: Echeverria, Marta s/ lesiones` | ✓ | **✓** |
| `en la causa Gómez, María c/ Estado` | ✓ | **✓** |
| `Finalmente, Alejandro relata que` | ✗ falso | **—** |
| `Asimismo, Carlos manifestó` | ✗ falso | **—** |
| `se cita a Abril, Facundo y a su madre` | ✗ falso | **—** |
| `Abril, Facundo declararon` | ✗ falso | **—** |
| `Luego, Maria fue derivada` | ✗ falso | **—** |

Los tres legítimos se conservan; los cinco falsos desaparecen.

### 3. El costo, explícito

Un `Apellido, Nombre` **sin ninguna marca cerca** deja de detectarse por este patrón — incluido el `"el Doctor Pérez, Juan"` que ADR-092 usó para descartar esta idea (§Contexto 3).

Se acepta por lo dicho arriba: el falso positivo que se cambia no es del mismo tamaño ni de la misma gravedad que el falso negativo que se compra. Y el caso queda cubierto por otro lado: en el cuerpo del texto los nombres los detecta NER, que es donde `"el Doctor Pérez, Juan"` vive.

### 4. Lo que no cambia

`checksum` (`firstNameIsInLexicon`), `normalizer` (`flipCaption`), `entityType` y `maskFormat` quedan igual. La corrección es **dónde** se permite el match, no qué se hace con él.

## Consecuencias

**A favor**

- Desaparece la clase de falso positivo que **fusiona dos personas distintas**, que es la de mayor daño de todas las encontradas.
- Se cierra además el residuo que ADR-092 aceptó a sabiendas (`"Buenos Aires, Argentina"`), sin un guard aparte.
- El patrón hace lo que su nombre dice. ADR-092 se llama "la carátula es un patrón" y hasta acá buscaba una coma.

**En contra**

- Una carátula escrita sin ninguna de las marcas previstas deja de detectarse. Las marcas salen de un solo documento real más el fixture del repo: **la enumeración puede estar incompleta**, y ampliarla es agregar alternativas, no rediseñar (mismo criterio que ADR-096).

**Lo que sigue sin medirse**

- Cuántas carátulas reales quedan fuera. Haría falta un corpus de expedientes, que el repo no tiene.
