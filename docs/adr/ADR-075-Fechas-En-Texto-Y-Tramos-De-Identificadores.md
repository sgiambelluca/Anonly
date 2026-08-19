<!-- CONTEXT: scope=adr | dependencias=core/Regex_Engine.md,core/Contracts.md,architecture/03_Data_Model.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md,adr/ADR-029-Occurrence-MaskFormat-Plate-Variantes.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md | audiencia=humanos+IA | fase=10.9 -->

# ADR-075 — Fechas escritas en texto, y matches que son un tramo de un identificador más largo

- **Estado**: Accepted
- **Fecha**: 2026-08-15
- **Decidido por**: El humano, al tomar los puntos 1, 2, 4, 4bis y 10 de `roadmap/Post_Hito10.8_Pendientes.md` como Hito 10.9. Los dos hallazgos salieron de la prueba manual sobre la pericia judicial real durante el Hito 10.8, y el propio reporte pide tratarlos juntos: *"Conviene revisarlo junto con el punto 4, que toca la misma tabla y ya requiere ADR"*.
- **Relacionado con**: **ADR-022** (el precedente de este ADR: corregir un patrón de `default-ar.ts` porque rompía un caso límite), ADR-012 (`maskFormat` por tipo), ADR-029 (`maskFormat` por ocurrencia, que es cómo un patrón nuevo declara el suyo), ADR-061 (el agregado manual, que es la red de contención de todo falso negativo), ADR-073 (el otro ADR del hito que toca a `Date`, por el lado de la agrupación)
- **Parte de**: Hito 10.9, PRs 12 y 13

> Convención de citas: `ADR-075 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-075, Contexto §N`.

## Contexto

### 1. Una fecha en texto no se detecta — y eso sí es una fuga

`"Quilmes, 07 de julio de 2026"` está en el content stream de la página 1 de la pericia, es texto nativo (no hace falta OCR para verlo) y **no produce ninguna ocurrencia**. El patrón `date-ar` es:

```text
/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g
```

Solo fechas numéricas. La forma escrita —que es la forma **normal** de fechar un escrito judicial argentino, en el encabezado y en el pie de firma— no está cubierta por ningún patrón, y NER no emite `Date` (`NER_Engine.md` §2: solo `Person`, `Organization`, `Address`).

Es un **falso negativo**: el dato sale del export sin tapar. No es cobertura incompleta de un caso exótico; es la fecha del documento, en el lugar donde siempre está.

### 2. Un tramo del número de expediente se detecta como teléfono

Verificado sobre la pericia real: `PP-13-00-027653-24/00` produce una ocurrencia **`[PHONE] "00-027653"`**. La cuenta, contra `phone-landline-ar` (`/\b0\d{1,4}[\s-]?\d{6,8}\b/g`):

```text
…-00-027653-…
   ^ \b entre "-" y "0"
   0        → "0"
   \d{1,4}  → "0"
   [\s-]?   → "-"
   \d{6,8}  → "027653"
   \b       → entre "3" y "-"          ⇒ match
```

Los patrones de `default-ar.ts` no tienen forma de distinguir un tramo de un número de causa de un teléfono: los dos son dígitos con guiones. El `\b` no ayuda, porque `-` no es carácter de palabra y por lo tanto **cada guion del expediente es un límite de palabra válido**.

Un número de expediente argentino no tiene un formato único (`PP-`, `IPP-`, `CUIJ`, `MPF`, variantes por jurisdicción y por fuero), así que "reconocer expedientes" no es un camino disponible.

### 3. Por qué los dos van en el mismo ADR

Porque tocan **la misma tabla**, y la cabecera de esa tabla es explícita: *"La implementación debe respetar estos patrones y checksums. Cualquier cambio requiere ADR nuevo"* (`Regex_Engine.md` §"Patrones default"). Partirlos en dos ADR obligaría a dos PRs sobre el mismo archivo, con el segundo rebaseando al primero, para dos decisiones que un implementador toma leyendo el mismo contexto.

Y hay un vínculo real: el falso positivo del §2 **ensucia la lista de fechas y teléfonos** que el §1 viene a completar. Arreglar solo el §1 agrega detecciones correctas a una lista que ya tiene ruido.

### 4. Las dos mitades tienen riesgo opuesto, y eso ordena las decisiones

- El §1 es un **falso negativo**: el dato sensible se exporta en claro. Es el modo de falla que el producto no puede tener.
- El §2 es un **falso positivo benigno**: tapa de más, no de menos. Ensucia el árbol de entidades y entrena al usuario a ignorarlo, que a la larga sí es un problema de seguridad — pero de ninguna ocurrencia concreta sale un dato.

De ahí sale el criterio con el que está escrito §2 de la Decisión: **una guarda que elimina falsos positivos no puede, ni en un caso raro, convertirse en un falso negativo.** Cualquier duda se resuelve emitiendo la ocurrencia.

## Decisión

### 1. Un patrón nuevo para la fecha escrita en texto: `date-textual-ar`

Entra a `DEFAULT_PATTERNS_AR` (`patterns/default-ar.ts`) y a la tabla de `Regex_Engine.md`:

```ts
{
  id: "date-textual-ar",
  entityType: EntityType.Date,
  pattern: /\b(\d{1,2})\s*[°º]?\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+del?\s+(\d{4})\b/gi,
  checksum: validateDateRange,
  normalizer: normalizeTextualDate,   // → "DD/MM/YYYY"
  maskFormat: "XX/XX/XXXX",
}
```

Las decisiones finas, todas verificadas contra cómo se fecha un escrito argentino:

- **`setiembre` además de `septiembre`.** Las dos son correctas en español rioplatense y las dos aparecen en documentos oficiales. Cuesta una alternativa en la lista.
- **`del` además de `de`** (`del? `): *"7 de julio del 2026"* es de uso corriente.
- **`[°º]?`** para el ordinal del día: *"1º de julio de 2026"*, *"1° de julio de 2026"*. Sin esto, el primer día de cada mes no se detecta — y el primero de mes es la fecha más frecuente en un vencimiento.
- **Flag `i`**: los encabezados van en mayúsculas más veces de las que uno esperaría (`"QUILMES, 07 DE JULIO DE 2026"`).
- **El día es obligatorio.** `"julio de 2026"` **no** se detecta. Un mes y un año solos identifican mucho menos, aparecen en frases que no son fechas (*"el balance de julio de 2026"*) y el costo de equivocarse es tapar texto corriente. Queda anotado en `Future_Ideas.md`, no acá.
- **El año es de cuatro dígitos.** `"7 de julio de 26"` no se detecta: la heurística de siglo del `normalizeDate` numérico existe porque el formato `dd/mm/yy` es común; escrito en texto no lo es, y no vale la pena.
- **`checksum: validateDateRange`** es el mismo que ya usa `date-ar`, y sirve igual: `"45 de julio de 2026"` normaliza a `45/07/2026` y se descarta por rango. El mes no hace falta validarlo — solo puede salir de la lista.

**El normalizador es la mitad importante de este patrón.** `normalizeTextualDate` produce `DD/MM/YYYY`, o sea **exactamente** el mismo `normalizedValue` que produce `normalizeDate` sobre la fecha numérica equivalente. Consecuencia buscada: `"07 de julio de 2026"` y `"7/7/2026"` caen en **el mismo `EntityGroup`** por el pase **exacto** de Grouping, sin depender del pase difuso (que ADR-073 §2 le retira a `Date` en este mismo hito). El árbol muestra una fecha con dos aliases, que es lo que el documento tiene.

`maskFormat` es el de `date-ar`, `"XX/XX/XXXX"`: un grupo que mezcle las dos formas resuelve el mismo formato por cualquiera de los dos caminos de ADR-029 §2 y no hay ambigüedad que desempatar.

### 2. La guarda: un match sin letras que vive dentro de una corrida con letras se descarta

Definición, y es la decisión entera:

> **Corrida** de un match: la extensión máxima del match, hacia los dos lados, a través de caracteres alfanuméricos y de los tres separadores **internos de número** `-`, `/`, `.`. Formalmente, el substring maximal alrededor del match que matchea `[\p{L}\p{N}]+(?:[-./][\p{L}\p{N}]+)*`.
>
> **Guarda**: si el texto del match **no contiene ninguna letra** y su corrida **sí contiene alguna**, el match se descarta. No se emite `ENTITY_FOUND`.

Sobre el caso medido:

```text
PP-13-00-027653-24/00
      └────────┘        match "00-027653"  → sin letras
└───────────────────┘   corrida completa   → contiene "PP"   ⇒ descartado
```

Las tres piezas de la definición están elegidas y cada una hace falta:

- **"El match no contiene letras"** es la condición de aplicabilidad, y hace que la guarda se aplique sola a los tipos correctos sin ninguna tabla por tipo. `License` (`MP-12345`), `Plate` (`AB 123 CD`), `IBAN` (`AR97…`) y `Email` llevan letras **en el match**, así que la guarda no los mira nunca — que es lo correcto, porque para esos tipos la mezcla de letras y dígitos es el formato. Los que quedan bajo la guarda son exactamente los seis puramente numéricos: DNI, CUIT, Phone (×2), CreditCard y Date. **No hay una lista de tipos en el código**: sale de la forma del match.
- **Los separadores son `-`, `/` y `.` y ninguno más.** Son los tres que aparecen adentro de un número escrito (`34.567.891`, `20-12345678-9`, `07/07/2026`), así que son los únicos por los que una corrida puede legítimamente continuar. Los que quedan afuera importan más que los que quedan adentro: con `:` afuera, `"Tel:0221-4567890"` corta la corrida en el `:` y el teléfono **se emite**; con `,` afuera, una lista `"0221-4567890,0221-4567891"` emite los dos.
- **Se compara la corrida, no el vecino inmediato.** `"00-027653"` tiene un guion a cada lado con dígitos del otro lado; lo que lo delata como tramo de otra cosa está tres saltos a la izquierda (`PP`). Una guarda de un carácter de vecindad no lo ve.

### 3. La guarda no reemplaza nada de lo que ya existe

- **El caso 10 (`DNI` adentro de un `CUIT`) sigue resolviéndose como hoy**, por prioridad del match más largo en el mismo span. La guarda no lo toca: `20-12345678-9` no tiene letras en su corrida, así que el `12345678` interno pasa la guarda y lo descarta la prioridad de siempre. Son dos mecanismos distintos para dos problemas distintos y ninguno cubre al otro.
- **Los checksums no cambian.** CUIT, tarjeta e IBAN siguen validando igual, y siguen siendo el primer filtro.
- **Los `\b` de los patrones no cambian.** ADR-022 los puso donde van; la guarda es una condición sobre el **contexto** del match, no sobre el patrón.

### 4. Se aplica a los patrones custom también, y a propósito

Un patrón custom del usuario que produzca un match sin letras dentro de una corrida alfanumérica se descarta igual. La guarda es una propiedad del **texto**, no del patrón: un tramo de un identificador más largo no se vuelve una entidad porque el patrón que lo encontró lo haya escrito el usuario.

Lo alternativo sería un flag de opt-out en `RegexPattern`, que es contrato público (`Regex_Engine.md` §6) y sumaría un cambio de contrato a un PR que no lo necesita. Si algún día un patrón custom real lo pide, esa es la forma; queda anotado en `Future_Ideas.md`.

### 5. El falso negativo que la guarda introduce, medido y acotado

Existe uno y hay que decirlo: **un número pegado a una palabra por un punto, sin espacio**.

```text
"Tel.0221-4567890"   → corrida "Tel.0221-4567890" → tiene letras → el teléfono se descarta
"Tel: 0221-4567890"  → corrida "0221-4567890"     → sin letras   → se emite
"Tel:0221-4567890"   → corrida "0221-4567890"     → sin letras   → se emite
"Tel. 0221-4567890"  → corrida "0221-4567890"     → sin letras   → se emite
```

> **Corrección (2026-08-18, hallazgo de la revisión del Hito 10.9)**: esta sección y §2 citaban originalmente `"4567-8900"`/`"4567-8901"`. Verificado contra los patrones reales de `default-ar.ts`: esa cadena no matchea **ningún** patrón de teléfono — `phone-landline-ar` exige un `0` inicial y `phone-mobile-ar` exige 10 dígitos en grupos 2-4-4 (8 dígitos no alcanza). O sea que un test contra ese número nunca tiene un match que la guarda pueda descartar, y pasaría igual aunque la guarda estuviera rota. El código y los tests siempre usaron el número de línea telefónica de Contexto §1/§2 de este mismo ADR (`"0221-4567890"`, que sí matchea `phone-landline-ar`); esta sección quedó desactualizada respecto de esa corrección hasta ahora.

O sea: **solo** falla la forma sin espacio y con punto. De las cuatro formas de escribir eso, tres pasan. Y la red de contención de todo falso negativo está construida y mergeada desde el Hito 10.7: el usuario selecciona el número sobre el visor o lo escribe, y `findLiteral` lo agrega (ADR-061).

Se acepta ese residuo, y se acepta explícitamente **en vez de** las guardas más agresivas que la Alternativa 2 describe: cualquier regla que exija que el match cubra la corrida entera convierte casos normales (un DNI seguido de `/2024`, dos números separados por una barra) en fugas, que es el error que §4 del Contexto prohíbe.

### 6. Alcance y tests

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 12 | Este ADR + propagación a specs | `docs/` | — |
| 13 | `date-textual-ar` (§1) y la guarda de corrida (§2, §4) | `regex-engine` | 12 |

Las dos mitades van en **un PR**: tocan el mismo archivo (`patterns/default-ar.ts` y el filtro de emisión de `regex.engine.ts`), son el mismo módulo, y partirlas obliga a que el segundo rebasee al primero sobre la misma tabla. R-1 pide un módulo por PR y `regex-engine` es un módulo.

Tests del PR 13:

Del patrón nuevo (§1):

- Unit — **el test que define esta mitad**: `"Quilmes, 07 de julio de 2026"` produce una `Occurrence` de `Date` con `normalizedValue === "07/07/2026"`. Es la línea literal de la pericia.
- Unit: la fecha textual y la numérica equivalente producen **el mismo `normalizedValue`** — la propiedad que las agrupa.
- Unit: `"1º de julio de 2026"`, `"1° de julio de 2026"` y `"1 de julio de 2026"` matchean las tres.
- Unit: `"7 de setiembre de 2026"` y `"7 de septiembre de 2026"` matchean las dos, con el mismo `normalizedValue`.
- Unit: `"7 de julio del 2026"` matchea (`del`).
- Unit: `"QUILMES, 07 DE JULIO DE 2026"` matchea (flag `i`).
- Edge: `"45 de julio de 2026"` **no** emite — lo descarta `validateDateRange`.
- Edge: `"julio de 2026"` (sin día) y `"7 de julio de 26"` (año de dos dígitos) **no** matchean. Son las dos limitaciones deliberadas de §1 y se asertan para que no se implementen por accidente ni se rompan en silencio, mismo criterio que el test de `"J. Pérez"` de ADR-061 §2.

De la guarda (§2):

- Unit — **el test que define esta mitad**: `"PP-13-00-027653-24/00"` **no** produce ninguna ocurrencia de `Phone`. Es la cadena literal de la pericia.
- Unit — **no-regresión, y es la mitad que protege contra la fuga**: un teléfono, un DNI, un CUIT, una tarjeta y una fecha, cada uno solo en su línea y cada uno con puntuación de oración alrededor (`"Tel: 0221-4567890."`), se siguen emitiendo igual que antes de este ADR.
- Unit: `"Tel:0221-4567890"` (dos puntos, sin espacio) se emite — la corrida corta en el `:` (§2).
- Unit: `"0221-4567890,0221-4567891"` emite **dos** teléfonos — la coma no extiende la corrida (§2).
- Unit: `"34.567.891/2024"` **sí** emite el DNI — la corrida no tiene letras, así que la guarda no aplica. Es el test que aserta que la guarda no se convirtió en un falso negativo (§5).
- Unit: un `License` (`"MP-12345"`) y un `Plate` no los toca la guarda, porque el match tiene letras (§2).
- Edge: el caso 10 (`DNI` dentro de `CUIT`) sigue emitiendo **solo** el CUIT, por el mecanismo de siempre (§3).
- Edge: un patrón custom sin letras dentro de una corrida con letras también se descarta (§4).
- Edge — el residuo aceptado, asertado como tal: `"Tel.0221-4567890"` **no** emite (§5). Documenta la limitación en el test, como el `"J. Pérez"` de ADR-061.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Un patrón `expediente-ar` que matchee el número de causa completo**, y dejar que la prioridad de match más largo (caso 10) descarte el tramo | El número de expediente no tiene **un** formato: cambia por jurisdicción, por fuero y por año (`PP-`, `IPP-`, `CUIJ`, `MPF`, con y sin sufijo `/00`). El patrón sería una lista de formas que se queda vieja con el primer documento de otra provincia. Y obliga a contestar de qué `EntityType` es un expediente —no es ninguno de los trece— para poder emitirlo y descartarlo. La guarda de §2 no necesita saber qué es: le alcanza con ver que hay letras en la corrida. |
| **Exigir que el match cubra la corrida entera** | Es la guarda "obvia" y es la que introduce fugas. `"34.567.891/2024"` dejaría de emitir el DNI, `"0221-4567890/1"` dejaría de emitir el teléfono: casos donde el dato sensible **está** y la corrida es más larga por una razón cualquiera. Cambia un falso positivo benigno por un falso negativo, que es exactamente lo prohibido por Contexto §4. |
| **Mirar solo el carácter vecino** (rechazar si el match limita con `-` o `/` seguido de dígito) | Tiene el mismo problema de fugas que la anterior —`"34.567.891/2024"` se cae— y además ni siquiera resuelve bien el caso reportado si el expediente empezara con dígitos. Ver más lejos y condicionar a la presencia de **letras** es lo que separa "es parte de otro identificador" de "hay otro número al lado". |
| **Filtrar por longitud de la corrida** ("si la corrida tiene más de N dígitos, no es un teléfono") | Un N inventado, con el mismo modo de falla que el umbral de ADR-073: funciona hasta el documento donde no. |
| **Dejar que el usuario deseleccione el grupo fantasma** | Es lo que hay hoy. El costo no es el click: es que el árbol de entidades de un expediente se llena de teléfonos y fechas que no existen, y un usuario que aprende a ignorar la lista es un problema de seguridad más grande que el que la lista resuelve. |
| **Un patrón de fecha textual con el mes opcional** o con el día opcional | Aumenta el recall a costa de tapar frases corrientes (*"el balance de julio de 2026"*). El día obligatorio es lo que hace que el match sea una fecha y no una referencia temporal (§1). |
| **Resolver la fecha textual en NER** | NER no emite `Date` (`NER_Engine.md` §2) y agregarle un tipo es cambiar el modelo, no el patrón. Una fecha escrita es determinística: es exactamente el trabajo de este motor. |

## Consecuencias

**Positivas**: la fecha del encabezado y del pie de firma —la forma normal de fechar un escrito judicial— deja de exportarse en claro, que es la mitad grave; agrupa sola con la fecha numérica equivalente porque comparten `normalizedValue`, sin pase difuso de por medio; el árbol de entidades de un expediente deja de llenarse de teléfonos que no existen; la guarda se aplica sola a los seis tipos correctos sin ninguna tabla por tipo, así que no hay una lista que mantener sincronizada; y ninguno de los dos cambios toca un contrato público.

**Negativas**: `DEFAULT_PATTERNS_AR` pasa de 11 a 12 patrones, con el costo lineal por página que `Regex_Engine.md` §12 ya describe (despreciable frente al pipeline); la guarda agrega un cálculo de corrida por match candidato, sobre el `Page.text` que ya está en memoria; y queda el falso negativo acotado de `"Tel.0221-4567890"` (§5), asertado por un test para que sea una limitación conocida y no una sorpresa.

**Neutras**: `Contracts.md` no se toca (no hay tipo, evento ni error code nuevo); `RegexPattern`, `EntityType` y los `maskFormat` no cambian de forma; el caso 10, los checksums y los `\b` de ADR-022 quedan intactos (§3); `findLiteral` y `searchText` no pasan por el registro de patrones ni por la guarda, así que la búsqueda literal y la lupa no se enteran; y `grouping-engine` no cambia — recibe las mismas `Occurrence` de siempre, unas cuantas más y unas cuantas menos.

## Docs actualizados por este ADR

- `core/Regex_Engine.md` → v1.6.0: §2 (la responsabilidad de descartar un match que es tramo de un identificador), §6 (la semántica de la guarda, junto a la de `findLiteral`), §13 (casos nuevos: la fecha textual, la guarda, y el residuo de §5), §14 (los tests de §6), §15 (ítem de checklist), y la tabla de §"Patrones default (especificación exacta)", que es contrato literal y donde entra la fila `date-textual-ar`.
- `roadmap/MVP.md` §4 — bloque del Hito 10.9.
- `roadmap/Post_Hito10.8_Pendientes.md` §4 y §4bis — pasan de pendientes a adoptados.
- `roadmap/Future_Ideas.md` — tres anotaciones: la fecha sin día (`"julio de 2026"`), el opt-out de la guarda por patrón custom (§4) y el mes en números romanos, que aparece en algunos sellos.

## Validación

- Los tests de §6, con los dos que definen el ADR corriendo sobre las cadenas literales de la pericia: `"Quilmes, 07 de julio de 2026"` y `"PP-13-00-027653-24/00"`.
- La no-regresión de los cinco tipos numéricos con puntuación de oración alrededor es **condición de mergeo**: si un teléfono normal deja de emitirse, la guarda se pasó de largo y este ADR produjo la fuga que vino a evitar.
- Verificación manual sobre la pericia real: la fecha del encabezado aparece en el árbol, y las ocurrencias `[PHONE]` derivadas del número de expediente desaparecen. Con ADR-073 ya mergeado, es también donde se confirma si el reporte de *"aparecen tres fechas"* era la fusión difusa, el falso positivo, o los dos.
- Las métricas de `roadmap/MVP.md` §5 para Regex (recall ≥ 90%, precision ≥ 98%) se vuelven a medir sobre el dataset de referencia: este ADR mueve las dos, y en direcciones opuestas por diseño.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `core/Regex_Engine.md` §2, §6, §12, §13 caso 10, §"Patrones default (especificación exacta)" — `core/NER_Engine.md` §2 — `core/Contracts.md` §5 (`EntityType`)
- `adr/ADR-012` — `adr/ADR-022` — `adr/ADR-029` §2 — `adr/ADR-061` §1, §2 — `adr/ADR-073` §2
- `roadmap/Post_Hito10.8_Pendientes.md` §4, §4bis (los reportes originales) — `roadmap/MVP.md` §5
- Código: `packages/anonymization-core/regex-engine/src/patterns/default-ar.ts`, `packages/anonymization-core/regex-engine/src/regex.engine.ts` (`runPattern`, `buildOccurrence`)
