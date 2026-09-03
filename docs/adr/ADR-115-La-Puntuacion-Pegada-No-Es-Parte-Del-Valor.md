<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Regex_Engine.md,core/Grouping_Engine.md,adr/ADR-061-Entidad-Manual-Y-Busqueda-Literal.md,adr/ADR-089-Buscar-No-Es-Agregar.md,adr/ADR-060-Lexico-De-Genero.md,adr/ADR-111-El-Token-Que-No-Es-Entidad-Tambien-Entra-Al-Agregador.md,roadmap/OCR_Escaneos_Handoff.md | audiencia=humanos+IA | fase=11 -->

# ADR-115 — La puntuación pegada no es parte del valor

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, que agregó a mano el apellido del imputado desde el sello y vio aparecer **tres grupos distintos** para el mismo apellido: `SUAREZ`, `“SUAREZ,` y `Suarez.`
- **Relacionado con**: **ADR-061 §8 errata punto 3** (de dónde sale el `normalizedValue` de una ocurrencia manual), **ADR-089 §3** (un match entra con las palabras enteras), ADR-060 §4 (las claves del léxico de género), ADR-111 §3 (que ya dejó los valores del NER alineados a borde de palabra)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** El expediente sobre el que se midió es real y no se transcribe acá (`08_Security_Model.md` §10.2: nada de contenido de documento fuera de RAM, y una herramienta de anonimización no es lugar para datos de una causa penal). Los reemplazos **preservan largo y cantidad de diacríticos**, porque varias distancias citadas son Levenshtein normalizado por longitud: con otro nombre, el número dejaría de verificar. Precedente: ADR-084.

## Contexto

### 1. Un apellido, cuatro grupos

Medido sobre un expediente escaneado de 20 páginas, buscando el apellido del imputado con la vía manual —seleccionarlo en el sello y "Agregar como…"—:

```
ocurrencias, por valor impreso
   20x  [ner   ]  value=<<SUAREZ>>     normalizedValue=<<suarez>>
   19x  [manual]  value=<<SUAREZ,>>    normalizedValue=<<suarez,>>
    8x  [manual]  value=<<Suarez>>     normalizedValue=<<suarez>>
    4x  [manual]  value=<<Suarez,>>    normalizedValue=<<suarez,>>
    2x  [manual]  value=<<Suarez.>>    normalizedValue=<<suarez.>>
    1x  [manual]  value=<<“SUAREZ,>>   normalizedValue=<<“suarez,>>
```

`findMatchingGroup` agrupa por `normalizedValue` exacto y, si falla, con un pase difuso de Levenshtein sobre el umbral de `similarityThreshold` (0,88 por default). Contra `suarez`:

| clave | Levenshtein normalizado | ¿agrupa? |
|---|---|---|
| `suarez,` | **0,857** | no |
| `suarez.` | **0,857** | no |
| `“suarez,` | **0,750** | no |

Las tres quedan **por debajo del umbral por un carácter**. Resultado: cuatro grupos para un solo apellido, y el usuario tiene que fusionarlos a mano — que es exactamente el trabajo que la herramienta existe para ahorrar.

### 2. La causa: dos normalizaciones para el mismo campo del contrato

`Occurrence.normalizedValue` es la clave con la que se agrupa, y **se calcula distinto según qué detector encontró la ocurrencia**:

| productor | función | ¿recorta puntuación de borde? | ¿saca acentos? |
|---|---|---|---|
| `ner-engine` | `normalizeNerValue` (propia del kernel) | **sí** (`.,;:!?()"'«»`) | no |
| `regex-engine`, vía manual | `normalizeForComparison` (`@anonly/shared`) | **no** | sí |

Por eso las 20 ocurrencias del NER caen todas en `suarez` y las manuales se desparraman: el NER ya recortaba, la vía manual no.

Y la puntuación llega pegada **por diseño**: `Page.words` separa por whitespace (ADR-020 §1), así que `“SUAREZ,` es **una sola** `Word`; y un match manual entra con las palabras enteras (ADR-089 §3), porque `Word.bbox` es la geometría más fina que existe. `match.text` arrastra lo que la palabra tenga adentro.

### 3. Por qué el arreglo no va dentro de `normalizeForComparison`

Es tentador meterle el recorte y listo. No: `normalizeForComparison` es **también** la normalización de las claves del léxico de género, y ADR-060 §4 exige que el script de build (`scripts/build-gender-lexicon.ts`, que tiene su propia copia deliberada) y el lookup de runtime coincidan carácter a carácter. Meterle un recorte que al léxico no le sirve de nada —sus claves son nombres, sin puntuación en los bordes— haría divergir las dos definiciones por un cambio ajeno.

## Decisión

### 1. `normalizeEntityValue` en `@anonly/shared`, y es la que produce `normalizedValue`

```ts
const EDGE_NON_WORD_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function normalizeEntityValue(value: string): string {
  return normalizeForComparison(value).replace(EDGE_NON_WORD_RE, "");
}
```

`buildManualOccurrence` la usa en vez de `normalizeForComparison`. `normalizeForComparison` **no se toca**: sigue siendo la de comparación de texto libre y la del léxico.

**Solo los bordes.** La puntuación interna se conserva: `A.C.` → `a.c`, `Empresa S.A.` → `empresa s.a`, `20-12345678-9` intacto. Un abreviado y un identificador dependen de sus puntos y guiones.

**Por clase Unicode y no por una lista de caracteres.** La lista de `normalizeNerValue` (`.,;:!?()"'«»`) no incluye las comillas tipográficas `“ ” ‘ ’`, que es justo lo que trae una carátula. Enumerar signos es una lista que siempre le falta uno.

## Consecuencias

**Medido sobre el mismo expediente**, con las 60 ocurrencias de "Suarez" que produce el documento entre NER y la vía manual:

| | grupos |
|---|---|
| hoy | **7** |
| con este ADR | **4** |

Los 4 que quedan son los valores genuinamente distintos: `suarez` (58 ocurrencias), `bartolome arturo suarez`, `mariela suarez`, `leonardo suarez`.

**Que esos cuatro sigan separados es correcto, no un residuo.** `Mariela Suarez` y `Leonardo Suarez` son personas distintas del imputado, y el detector no tiene cómo saber si un `Suarez` suelto se refiere a uno o a otro. Fusionarlos —o no— es una decisión del usuario, y para eso está la fusión manual de grupos. Un motor que adivinara ahí anonimizaría a la persona equivocada.

**En contra**

- **Un valor que sea puro signo normaliza a la cadena vacía.** No se rompe nada (agruparía con otros vacíos), pero es un estado nuevo que antes no existía. Ningún detector produce un valor así hoy: los patrones exigen estructura y el NER, desde ADR-111 §3, alinea sus spans a borde de palabra.
- **Quedan dos normalizaciones para el mismo campo**, y este ADR cierra solo la mitad. Ver abajo.

### Lo que este ADR NO cierra: los acentos — **cerrado por ADR-118**

`normalizeNerValue` **no saca diacríticos** y `normalizeEntityValue` sí. O sea que el mismo nombre encontrado por los dos caminos todavía puede dar dos claves: el NER emite `maría` y un agregado manual del mismo texto emite `maria`. Para un nombre largo el pase difuso lo salva (`bartolomé`/`bartolome` da 0,889, apenas sobre el umbral); para uno corto no (`maría`/`maria` da **0,800**, y se parte).

No se arregló acá **por alcance**: tocar `normalizeNerValue` es un cambio en `ner-engine`, y R-1 prohíbe tocar dos motores en el mismo PR. Además cambia la clave de agrupado de **todas** las ocurrencias del NER de todo documento, así que pedía su propia medición. **ADR-118 lo cerró** en el PR siguiente, con el número que faltaba: de 108 ocurrencias con diacríticos **23 se partían en dos grupos**, y unificar **no colapsa nada** — 247 claves distintas antes y después, 0 colisiones nuevas.

**Lo que no toca**: `normalizeForComparison`, el léxico de género, `tokenizeLiteralValue`/`documentSubTokens` (que ya descartan todo lo no alfanumérico con `SUBTOKEN_RE`, así que el recorte ahí sería un no-op), ni ningún contrato público — `normalizedValue` sigue siendo `string`.

## Qué hay que cubrir con tests

- `SUAREZ,`, `“SUAREZ,`, `Suarez.` y `SUAREZ` dan **la misma** clave.
- La puntuación **interna** no se toca: `A.C.`, `Empresa S.A.`, un CUIT con guiones.
- Un valor sin bordes que recortar da exactamente lo mismo que `normalizeForComparison` — es lo que hace que el cambio sea aditivo.
- `normalizeForComparison` **sigue sin recortar**: la no regresión que justifica que sean dos funciones.
- De punta a punta en `regex-engine`: `findLiteral` de un apellido sobre un documento donde aparece con tres puntuaciones distintas emite tres ocurrencias con **un solo** `normalizedValue`, conservando cada `value` impreso. Falla si el call site vuelve a `normalizeForComparison`.
