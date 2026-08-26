<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Regex_Engine.md,ui/Components.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-084-Ver-Ocurrencias-Empuja-El-Valor-Al-Buscador.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-089 — Buscar no es agregar: la comparación se afloja distinto de cada lado

- **Estado**: Accepted
- **Fecha**: 2026-08-22
- **Decidido por**: El humano, sobre el reporte de campo de `roadmap/Calidad_De_Deteccion_Informe.md` §2.3 ("Ver ocurrencias muchas veces no trae nada") y la corrección de que `addManualEntity` **barre el documento entero** (`ui/Components.md` §5.4c), que el reporte no tenía en cuenta.
- **Relacionado con**: ADR-061 §2 (la normalización compartida y las dos erratas de puntuación), ADR-061 §8 errata (`searchText` como primitiva de solo lectura), ADR-084 §2/§3 ("Ver ocurrencias" empuja el `canonicalValue` al buscador)
- **Parte de**: la campaña de calidad de detección abierta por `roadmap/Calidad_De_Deteccion_Informe.md`

> Convención de citas: `ADR-089 §N` refiere a **Decisión §N**.

## Contexto

### 1. El buscador falla donde el usuario no puede ver por qué

ADR-061 §2 dejó la comparación en "palabra entera, normalizada, con la puntuación de **borde** recortada". `Word` sale de partir por whitespace (ADR-020 §1), así que dónde queda un borde y dónde queda el interior de una palabra lo decide el espaciado del PDF, que el usuario no ve. El resultado es que la búsqueda anda o no anda por razones invisibles:

| Consulta | El documento tiene | Hoy | Por qué |
|---|---|---|---|
| `Juan Pérez` | `Juan` · `Pérez,` | encuentra | la coma está en el borde |
| `Juan Pérez` | `Juan` · `Pérez,Juan` | **falla** | sin espacio, la coma es **interna** |
| `20-12345678` | `20-12345678-9` | **falla** | palabra entera: un prefijo no matchea |
| `Juan Pérez` | `Pérez,` · `Juan` | **falla** | orden invertido |

Los dos del medio son los que aparecen en documentos reales: el segundo por espaciado apretado, el tercero porque un grupo puede tener como `canonicalValue` un tramo de un identificador más largo.

### 2. "Agregar como…" no agrega el resultado clickeado: agrega todos

El reporte de campo trató a las dos entradas como el mismo problema porque comparten la primitiva. Pero no tienen la misma consecuencia:

- **La lupa** (`searchText`) es de solo lectura: resalta y navega. Encontrar de más cuesta un resaltado que sobra.
- **"Agregar como…"** (`findLiteral` vía `addManualEntity`) **recorre el documento entero** y crea una ocurrencia por cada coincidencia — `ui/Components.md` §5.4c lo dice explícito: *"Agrega todas las apariciones del valor, no solo el resultado clickeado"*. Encontrar de más ahí no es un resaltado: es **texto tapado en el PDF que el usuario entrega**.

Con una comparación por substring pareja, agregar `Ana` como persona taparía cada `Anabella` del expediente. Eso no es un riesgo de fuga —tapa de más, no de menos— pero destruye contenido del documento sin avisar, y el usuario no eligió eso: eligió un valor, no un criterio de coincidencia.

### 3. Lo que ya está descartado

El defecto de cableado del Hito 10.10 —la búsqueda colgaba del `onChange` de un `<input>`, que no emite `change` cuando el valor llega de afuera— **ya está corregido**: `DocumentSearchBox.tsx` dispara desde la consulta. Lo que falla es la comparación, no el disparo.

## Decisión

### 1. La comparación pasa a ser por sub-token, en las dos entradas

Cada `Word` y cada palabra de la consulta se parte, después de normalizar, en **sub-tokens**: corridas maximales de `[\p{L}\p{N}]`. `"Pérez,Juan"` da `["perez", "juan"]`; `"20-12345678-9"` da `["20", "12345678", "9"]`; `"O'Brien"` da `["o", "brien"]`.

El barrido busca una corrida de sub-tokens **consecutivos en orden de documento** que coincida con los de la consulta, en orden. Puede empezar y terminar **a mitad de una palabra**, y puede cruzar el borde entre dos palabras (con la misma exigencia de banda vertical compartida que ya hay entre palabras consecutivas, `Contracts.md` §6).

Eso arregla las filas 2 y 3 de la tabla, con un solo mecanismo. **La fila 4 —el orden invertido— queda sin arreglar, a propósito**: aflojar el orden convierte la búsqueda en una bolsa de palabras y hace que `Pérez, Juan` matchee `Juan ... Pérez` a media página de distancia. Esa carátula es el hallazgo §23c y se arregla en la detección, no en el buscador.

`"O'Brien"` deja de matchearse contra la palabra entera y pasa a matchearse como `o` + `brien`: mismo resultado sobre el mismo texto, porque los dos lados se parten igual.

### 2. La lupa además matchea por prefijo en el ÚLTIMO sub-token; "Agregar como…" no

`searchText` acepta que el **último** sub-token de la consulta sea un **prefijo** del sub-token del documento. Los demás siguen exigiendo igualdad. Con eso `Ana` encuentra `Anabella`, y una consulta a medio tipear (`Juan Pére`) encuentra mientras se escribe, que es lo que cualquiera espera de una lupa.

`findLiteral` **no** lo acepta: todos sus sub-tokens exigen igualdad. Es lo que impide que agregar `Ana` tape cada `Anabella`.

El aflojamiento es asimétrico porque la consecuencia es asimétrica (Contexto §2). Es la única diferencia entre las dos: comparten la función de matcheo y se distinguen por un parámetro, no por dos implementaciones que pueden divergir.

### 3. El bbox sigue cubriendo palabras enteras

No hay geometría por glifo: `Word.bbox` es lo más fino que existe. Un match que empieza o termina a mitad de palabra produce igual un `bbox` que cubre las palabras **enteras** que toca, y un `TextMatch.text` que es el texto de esas palabras completas.

Consecuencia concreta y deliberada: agregar a mano `20-12345678` sobre un documento que dice `20-12345678-9` tapa el número **entero**. Es lo correcto para una herramienta de anonimización —tapar el tramo y dejar el dígito verificador a la vista no protege nada— y es lo que ya hacía el motor para cualquier match parcial de un patrón.

### 4. `searchText` y `findLiteral` dejan de encontrar exactamente lo mismo

`Regex_Engine.md` §13 caso 21 afirmaba que *"sobre el mismo documento y el mismo texto encuentran las mismas coincidencias"*. Pasa a ser: **sobre una consulta que coincide sub-token a sub-token, encuentran las mismas coincidencias, con los mismos `pageIndex`, `bbox` y `wordSpan`**; la lupa puede encontrar además coincidencias por prefijo. El test que fijaba la invariante se conserva —una consulta exacta— y se le agrega el que fija la diferencia.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Substring solo en la lupa (§2) | Substring en las dos | Era la preferencia inicial del humano, sobre la premisa de que "Agregar como…" agrega solo la ocurrencia elegida. `ui/Components.md` §5.4c dice lo contrario: barre el documento entero. Con la premisa corregida, agregar un nombre corto taparía cada palabra que lo contenga. |
| Substring solo en la lupa (§2) | Substring en las dos + un aviso en la UI con el conteo antes de confirmar | Cierra el hueco de raíz y probablemente valga la pena igual, pero toca `apps/react-client`: otro módulo, otro PR (R-1/R-5). No es excusa para dejar el default peligroso mientras tanto. |
| Prefijo solo en el último sub-token (§2) | `includes` en cualquier sub-token | `Ana` matchearía `Susana` y `Mariana`. El caso que el humano pidió es el prefijo (`Ana` → `Anabella`), y es también el que hace que la búsqueda incremental funcione. |
| Sub-tokens en los dos lados (§1) | Recortar solo la puntuación interna de `Word` | No alcanza para el prefijo de un identificador (`20-12345678` contra `20-12345678-9`), que es el caso que sale del propio repo. |
| Mantener el orden exigido (§1) | Orden libre dentro de la ventana | Arreglaría la carátula `Pérez, Juan`, pero al precio de que dos palabras sueltas y lejanas cuenten como una coincidencia — y esa misma primitiva crea reemplazos. La carátula es un problema de detección (§23c). |
| Ventana sobre sub-tokens | Buscar la consulta normalizada como substring del texto de página normalizado | Sería más simple de leer, pero `normalizeForComparison` **cambia la longitud** (colapsa espacios, saca marcas combinantes), así que los offsets dejan de alinearse con `Page.text` y `mapSpanToWords` no puede mapear el resultado sin un índice carácter a carácter. |

## Consecuencias

**Positivas**:

- Las dos formas de falla que aparecen en documentos reales dejan de fallar, y la lupa encuentra mientras se escribe.
- Un grupo cuyo `canonicalValue` es un tramo de un identificador más largo puede encontrarse a sí mismo desde "Ver ocurrencias" (ADR-084 §2). Junto con el recorte de espacio de `Regex_Engine.md` v1.6.2, cierra §2.3 del informe salvo el orden invertido.
- La diferencia entre buscar y agregar queda **explícita y en un parámetro**, en vez de ser una coincidencia de que las dos usan la misma función.

**Negativas**:

- La lupa puede resaltar de más: `Ana` resalta `Anabella`. Es el precio elegido, y del lado donde solo cuesta un resaltado.
- `ADR-084 §3` ya avisaba que el contador del buscador puede no coincidir con el `(N)` del grupo; ahora puede diferir **más**, y en la dirección de contar de más.
- Un match parcial tapa la palabra entera (§3). Es lo correcto, pero significa que el `value` de la ocurrencia manual puede ser más largo que lo que el usuario escribió.
- La carátula `Pérez, Juan` sigue sin encontrarse desde el buscador. Queda atada a §23c, no a este ADR.

## Validación

- Test unit: `Juan Pérez` encuentra `Juan` · `Pérez,Juan` (puntuación interna, fila 2).
- Test unit: `20-12345678` encuentra `20-12345678-9` en las **dos** entradas, con `bbox` de la palabra entera (fila 3, §3).
- Test unit: `Juan Pérez` **no** encuentra `Pérez,` · `Juan` (orden invertido, fila 4 — la limitación en un test, para que sea conocida).
- Test unit: `searchText("Ana")` encuentra `Anabella`; `findLiteral` con `"Ana"` sobre el mismo documento **no** emite ninguna ocurrencia sobre esa palabra (§2, la asimetría).
- Test unit: `searchText` y `findLiteral` encuentran lo mismo sobre una consulta exacta — el test de ADR-061 §8 errata, conservado (§4).
- Test unit: `O'Brien` sigue encontrando `O'Brien` (los dos lados se parten igual, §1).
- Test edge: consulta vacía o de solo puntuación → cero sub-tokens → cero resultados, sin recorrer el documento.
- Cobertura ≥ 85% líneas en `regex-engine`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `roadmap/Calidad_De_Deteccion_Informe.md` §2.3 (el reporte de campo y su tabla medida)
- `core/Regex_Engine.md` §6, §13 casos 20-25, §14
- `ui/Components.md` §5.4c ("Agrega todas las apariciones del valor"), §3.5 ("Ver ocurrencias")
- `adr/ADR-061-Agregado-Manual-De-Entidades.md` §2 (normalización compartida), §8 errata (`searchText`)
- `adr/ADR-084-Ver-Ocurrencias-Empuja-El-Valor-Al-Buscador.md` §2, §3
- `ai/AI_Development_Guide.md` R-1, R-2, R-13, R-18, R-21
