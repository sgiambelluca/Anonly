<!-- CONTEXT: scope=adr | dependencias=core/Regex_Engine.md,tests/fixtures/README.md,adr/ADR-029-Occurrence-MaskFormat-Plate-Variantes.md,adr/ADR-075-Fechas-En-Texto-Y-Tramos-De-Identificadores.md,adr/ADR-093-La-Caracteristica-Telefonica-No-Siempre-Tiene-Dos-Digitos.md,adr/ADR-095-La-Regla-De-Matcheo-Es-La-Metrica.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-096 — Los patrones cubren cómo se escribe el dato, no su forma canónica

- **Estado**: Accepted
- **Fecha**: 2026-08-26
- **Decidido por**: El humano, sobre los cuatro huecos que destapó la categoría `forms` del dataset de referencia, y con las formas de patente y matrícula que aportó.
- **Relacionado con**: ADR-095 §7 (la regla de provenance y la categoría `forms`, que produjeron estos hallazgos), ADR-093 (el mismo defecto en `phone-mobile-ar`, arreglado antes), ADR-029 §2 (las dos variantes de patente), ADR-075 §2 (la guarda de corrida, intacta)
- **Parte de**: la campaña de calidad de detección abierta por `roadmap/Calidad_De_Deteccion_Informe.md`

> Convención de citas: `ADR-096 §N` refiere a **Decisión §N**.

## Contexto

### 1. Cuatro huecos, un mismo defecto

Con la categoría `forms` puesta, el recall de Regex sobre el dataset de referencia cayó de un 100 % hueco a un **77 % honesto**, y los 14 faltantes salieron nombrados:

```
PHONE   "011 4567-8902"
IBAN    "ES05 7068 9876 9644 6251 9569"
PLATE   "ABC-123"  "AB-123-CD"  "A 123 BCD"  "A456EFG"
LICENSE "MN 12345" "MP 23456" "MN 45.318" "MP 9.328"
        "M.P. 34567" "M.N. 56789" "40097" "MP 61852"
```

Los cuatro son el mismo defecto: **el patrón se escribió para la forma canónica del dato, no para cómo el dato aparece escrito en un documento.** Un IBAN "es" 24 caracteres sin espacios; impreso va en grupos de cuatro. Una matrícula "es" un prefijo y un número; escrita lleva un espacio en el medio, a veces puntos en la abreviatura y a veces separador de miles.

Es exactamente el mismo diagnóstico que ADR-093 ya había cerrado para `phone-mobile-ar`, apareciendo en otros cuatro lugares. Lo que cambió es que ahora hay un instrumento que los encuentra en vez de esperar a que alguien los reporte.

### 2. El más grave: la matrícula acierta 1 de 11

`license-ar` es `\b[A-Z]{1,3}-?\d{4,8}-?\d?\b`: admite un guión opcional entre las letras y los dígitos, **pero no un espacio**. Como en la práctica siempre se escribe con espacio, sobre las once formas reales medidas acierta **una**: `MN12345`, que es la que nadie escribe.

Y el separador de miles la rompe por otro lado: `45.318` son cinco dígitos con un punto en el medio, y el patrón pide de cuatro a ocho seguidos.

## Decisión

### 1. Matrículas profesionales: se reescribe el patrón, y la alternativa vieja **se retira**

```
(?<=[Mm]atr[íi]cula\s+[Pp]rofesional\s*:?\s*)\d{3,8}\b
| \bM\.?[NP]\.?[\s-]*\d{1,3}(?:\.\d{3})+\b
| \bM\.?[NP]\.?[\s-]*\d{3,8}\b
```

Tres alternativas: el número pelado **anclado en la etiqueta**, el número con separador de miles, y el número plano. El prefijo cubre `MN`, `MP`, `M.N.`, `M.P.` y el separador admite espacio, guión o nada.

**El anclaje en la etiqueta es lo que hace posible la primera alternativa.** `"Matrícula Profesional 40097"` no tiene prefijo: el identificador es un número pelado, y sin la etiqueta como ancla el patrón matchearía todo número de cinco dígitos del expediente. El `lookbehind` es contexto que ancla; **el match es solo el valor** — taparía la palabra "Matrícula" si la incluyera, que es el mismo error de sobre-captura que ADR-092 tuvo que acotar en la carátula.

**La alternativa vieja se retira, y es una decisión, no un descuido.** Medido:

| | formas reales | falsos positivos (14 trampas) |
|---|---|---|
| patrón de hoy | 1 de 11 | **1** — `"Expediente A-12345"` → `"A-12345"` |
| nuevo, conservando la vieja | 11 de 11 | **1** — el mismo |
| **nuevo, sin la vieja** | **11 de 11** | **0** |

La alternativa vieja no aporta **ninguna** forma que las nuevas no cubran —incluidas las de guión, `MP-12345` y `M.P.-34567`— y sí aporta un falso positivo sobre números de expediente, que en un expediente están por todas partes.

**Lo que se pierde, dicho explícitamente**: formas de matrícula que no se midieron y que la alternativa vieja podría haber tomado por casualidad — un tomo/folio de abogado (`T° 123 F° 45`), un prefijo de colegio profesional. **No se inventan** (ADR-095 §7): entran al dataset el día que aparezcan en un documento, y ahí el número baja y se arregla el patrón.

### 2. Patentes: las tres estructuras, con los tres separadores

```
\b[A-Z][\s-]?\d{3}[\s-]?[A-Z]{3}\b        Mercosur moto (1+3+3)  — NUEVA
\b[A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2}\b     Mercosur auto (2+3+2)
\b[A-Z]{3}[\s-]?\d{3}\b                   vieja (3+3)
```

Dos cambios: el separador pasa de `\s?` a `[\s-]?` —el guión no está en la chapa, está en cómo se **transcribe**, y este motor lee transcripciones— y **se agrega la variante de motovehículo**, que no estaba cubierta en absoluto.

`maskFormat` por variante, como fijó ADR-029 §2: la moto lleva el suyo (`X XXX XXX`).

Medido: 8 de 8 formas, 0 falsos positivos sobre las 14 trampas.

### 3. IBAN: el formato impreso

```
\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30}\b
```

ISO 13616 recomienda imprimirlo en grupos de cuatro separados por espacios, y así aparece en un documento — y así lo tiene `text-10p.pdf`. El patrón de hoy no admite espacios internos, o sea que **detecta solo la forma que nadie escribe**.

`[A-Z]{2}\d{2}` sigue siendo contiguo, que es lo que evita que el patrón se coma texto en mayúsculas seguido de números. Y el checksum mod-97 sigue siendo la red: una secuencia con la forma pero sin el dígito verificador correcto se descarta igual.

**Corolario que corrige al propio README**: el IBAN de `text-10p.pdf` estaba documentado como "no detectado por checksum mod-97". No era el checksum — el patrón nunca llegaba a evaluarlo.

### 4. Fijo nacional: el separador adentro del abonado

```
\b0\d{1,4}[\s-]?\d{3,4}[\s-]?\d{4}\b
```

`"011 4567-8902"` no se detectaba: el patrón de hoy (`\b0\d{1,4}[\s-]?\d{6,8}\b`) exige el abonado en un solo bloque de dígitos, y en la práctica se escribe partido. Un separador más, en el mismo lugar donde `phone-mobile-ar` ya lo admite.

Este apareció **solo**, en la corrida del evaluador: no estaba en la lista de formas que se enumeró a mano. Vale como evidencia de para qué sirve el dataset.

### 5. Lo que no cambia

- **La guarda de corrida de ADR-075 §2** sigue aplicando sin cambios: es una propiedad del contexto del match, no del patrón.
- **Los `normalizer`** de los cuatro quedan igual.
- **`phone-mobile-ar`** no se toca: lo arregló ADR-093.
- **El falso positivo del CUIT** (`"CUIT 20-12345678-9"` → teléfono) sigue ahí. Es preexistente, está documentado y tiene test.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Retirar la alternativa vieja de matrícula (§1) | Conservarla junto a las nuevas | Medido: no aporta ninguna forma que las nuevas no cubran, y sí un falso positivo sobre números de expediente. Conservar por las dudas es conservar el falso positivo por las dudas. |
| Anclar el número pelado en la etiqueta (§1) | Matchear cualquier número de 3-8 dígitos como matrícula | Matchearía fojas, artículos, montos y números de expediente. La etiqueta es lo único que distingue una matrícula de un número cualquiera. |
| Anclar en la etiqueta (§1) | Incluir la etiqueta en el match | Taparía la palabra "Matrícula", que no es un dato personal — el error de sobre-captura de ADR-092. |
| `[\s-]?` en patentes (§2) | Dejar solo el espacio | El guión no está en la chapa pero sí en la transcripción, y este motor lee transcripciones, no chapas. |
| Espacios en IBAN (§3) | Normalizar el texto antes de matchear | Cambiaría `Page.text` para todos los consumidores para arreglar un patrón. El patrón es el lugar. |

## Consecuencias

**Positivas**:

- El recall de Regex sobre el dataset sube de 77 % (los cuatro huecos cerrados son 14 de las 61 entidades esperadas).
- La matrícula profesional pasa de detectarse en 1 de 11 formas a 11 de 11, y **con un falso positivo menos** que antes.
- Un IBAN impreso —la forma en que aparece en cualquier documento— deja de salir en claro.
- Los motovehículos entran al alcance del producto por primera vez.

**Negativas**:

- **Retirar la alternativa vieja de matrícula puede perder formas no medidas** (§1). Es el riesgo asumido, y el dataset es el lugar donde va a aparecer si pasa.
- El patrón de matrícula pasa de una expresión a tres alternativas con un `lookbehind`. Es más difícil de leer, y el `lookbehind` de longitud variable no está en todos los motores de regex — acá corre en V8, que lo soporta.
- Aflojar el separador de patentes admite formas que una chapa no tiene (`ABC-123`). Es deliberado: el motor lee cómo se escribió, no cómo se estampó.
- El IBAN con espacios hace el patrón más goloso. Lo acota que `[A-Z]{2}\d{2}` siga contiguo y que el checksum filtre.

## Validación

- Test unit: las **11** formas de matrícula de §1 emiten `License`; `"Expediente A-12345"` **no** emite — el falso positivo que se retira.
- Test unit: las **8** formas de patente de §2 emiten `Plate`, incluidas las dos de motovehículo.
- Test unit: el IBAN impreso con espacios emite, y uno con checksum inválido **no** — la red sigue puesta.
- Test unit: `"011 4567-8902"` emite `Phone`; `"0221-4567890"` sigue emitiendo (no regresión).
- Test unit: las 14 trampas duras —ley, artículo, expediente, código postal, resolución, foja, monto— no emiten ninguno de los cuatro tipos.
- **El evaluador sube**: `pnpm test:quality` reporta un recall de cobertura mayor que el 77 % de la línea de base, y los 14 faltantes nombrados desaparecen de la salida.
- Cobertura ≥ 85% líneas en `regex-engine`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `core/Regex_Engine.md` §"Patrones default (especificación exacta)", §13, §14
- `tests/fixtures/README.md` (la regla de provenance y la categoría `forms`)
- `adr/ADR-095-La-Regla-De-Matcheo-Es-La-Metrica.md` §7
- `adr/ADR-093-La-Caracteristica-Telefonica-No-Siempre-Tiene-Dos-Digitos.md` (el mismo defecto, antes)
- `adr/ADR-029-Occurrence-MaskFormat-Plate-Variantes.md` §2 (`maskFormat` por variante)
- `ai/AI_Development_Guide.md` R-2, R-13, R-18, R-21
