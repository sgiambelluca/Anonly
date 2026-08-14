<!-- CONTEXT: scope=adr | dependencias=03_Data_Model.md,08_Security_Model.md,ADR-011-Grouping-First.md | audiencia=humanos+IA | fase=2 -->

# ADR-012 — Modos de Reemplazo (mask / synthetic / placeholder / redact)

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Aclaración del usuario en planificación
- **Relacionado con**: ADR-011-Grouping-First
- **Complementado por**: ADR-029 (la fila `Plate` de §"Formato por tipo para mask" tenía ambos formatos incorrectos y queda **superada**: Mercosur = `XX XXX XX`, vieja = `XXX XXX`; el formato por variante viaja en `Occurrence.maskFormat`)
- **Modificado por**: ADR-057 (§"Formato para `placeholder`": `[<TYPE> <NN>]` deja de ser el único formato y pasa a ser el **nivel 0** de una escalera de tres; ADR-057 §2 ratifica además la tabla completa de los 13 tipos, de la que este ADR solo daba 4 ejemplos), ADR-060 (§"Formato para `placeholder`": para `Person`, el label depende además de `EntityGroup.personGender` — `MUJER`/`HOMBRE`; **no** se agrega un quinto `ReplacementMode`)

## Contexto

El usuario explicitó cuatro modos de reemplazo que espera poder elegir por grupo:

> "si lo reemplaza con un XXX.XXX.XXX, con 123.456.789, con un [DNI 01] o con un cuadrado negro directamente."

Esto mapea a cuatro modos distintos con semántica distinta:

1. **Censura conservando formato** (`XX.XXX.XXX`): el lector sabe que ahí había un DNI por el formato, pero no ve el valor.
2. **Sintético válido** (`123.456.789`): el lector ve un DNI plausible que no es el real. Útil para datasets de ML o demos.
3. **Placeholder tipado** (`[DNI 01]`): el lector ve explícitamente "esto era un DNI, ocurrencia 1". Útil para auditoría y revisión.
4. **Censura visual total** (cuadrado negro): el lector ni siquiera sabe qué tipo de dato era. Útil para redacción legal estricta.

## Decisión

Definir **cuatro modos de reemplazo** (`ReplacementMode`), cada uno con semántica y formato tipo-dependiente:

```ts
export enum ReplacementMode {
  Mask = "mask",
  Synthetic = "synthetic",
  Placeholder = "placeholder",
  Redact = "redact",
}
```

### Resolución de `replacementValue` por modo

| Modo | `replacementValue` | Render visual |
|---|---|---|
| `mask` | cadena con formato tipo-dependiente | texto censurado sobre bbox |
| `synthetic` | valor sintético válido, determinista por seed | texto sintético sobre bbox |
| `placeholder` | `[<TYPE> <NN>]` (padding 2) | texto placeholder sobre bbox |
| `redact` | `""` | bloque negro sólido sobre bbox |

### Default

**`placeholder`** es el modo default para grupos nuevos. Razones:
- Más informativo para el usuario que está revisando (`[DNI 01]` deja claro qué se anonimizó).
- No introduce falsos datos (como `synthetic`).
- Mantiene el documento legible (más que `redact`).
- El usuario puede cambiar a otro modo fácilmente desde el árbol de entidades.

### Formato por tipo para `mask`

| Tipo | Formato `mask` |
|---|---|
| DNI | `XX.XXX.XXX` |
| CUIT | `XX-XXXXXXXX-X` |
| Phone | `+XX XXX XXX-XXXX` |
| Email | `xxxx@xxxx.xx` |
| IBAN | `XX00 XXXX XXXX XXXX XXXX` |
| CreditCard | `XXXX XXXX XXXX XXXX` |
| Person | `XXXXX XXXXX` |
| Organization | `XXXXXXXX` |
| Address | `XXXXXX XXX` |
| Date | `XX/XX/XXXX` |
| License | `XX-XXXX-XX` |
| Plate | `XXX XXX` (AR Mercosur) / `XXX XXXX` (vieja) |
| Custom | configurable |

### Formato por tipo para `synthetic`

Síntesis **determinista por seed** (seed default: aleatorio por sesión, configurable). Para cada tipo, se genera un valor **plausible y válido** según las reglas del tipo (checksum de CUIT válido, formato de DNI válido, email plausible, etc.). La determinidad garantiza reproducibilidad de un export concreto.

> **Precisado por `ADR-072` (2026-08-14), en dos puntos.**
>
> **(1) "Configurable" nunca se implementó, y no por olvido.** `ADR-019` §5 quitó el default fijo justamente para que el seed fuera aleatorio por sesión, y hoy es un `crypto.randomUUID()` por `startSession` sin ningún campo en `GroupingConfig` que permita fijarlo. O sea que **"la determinidad garantiza reproducibilidad de un export concreto" no describe al producto**: el mismo documento abierto dos veces ya da valores distintos, que es lo que la política SAN de este mismo ADR quiere. La determinidad que sí existe, y que importa, es **dentro de una sesión**.
>
> **(2) La semilla del sorteo es la identidad del grupo, no su número** (ADR-072 §1). Era `indexInType`, un ordinal que la renumeración canónica de ADR-028 mueve, así que el valor sintético de un grupo podía cambiar por operaciones ajenas a ese grupo. Pasa a ser `EntityGroup.id`. `indexInType` sobrevive solo para los tipos cuyo valor lo **interpola** (`Custom` → `custom-3`).

| Tipo | Ejemplo `synthetic` |
|---|---|
| DNI | `39.123.456` |
| CUIT | `30-12345678-9` (con dígito verificador válido) |
| Phone | `+54 11 1234-5678` |
| Email | `user84231@example.org` |
| Person | `Carlos Sánchez` (de un pool de nombres faker; **filtrado por `EntityGroup.personGender` cuando está resuelto** — ADR-071 §5) |
| Organization | `Empresa S.A.` (pool) |
| Address | `Calle Falsa 123` (pool) |

### Formato para `placeholder`

`[<TYPE> <NN>]` donde:
- `<TYPE>` es el label del tipo en mayúsculas (internacionalizable; default español).
- `<NN>` es `indexInType` con padding a 2 dígitos.

Ejemplos: `[DNI 01]`, `[PERSONA 03]`, `[DIRECCION 02]`, `[CUIT 01]`.

> **Modificado por ADR-057 (2026-08-06)**. Este formato pasa a ser el **nivel 0** de una escalera de tres, elegida **por grupo** según el ancho disponible de su ocurrencia más apretada: `[PERSONA 01]` → `[PERS 01]` → `[PRS-01]`. Motivo: un token más largo que el dato que reemplaza se derramaba encima del texto original. Lo que **no** cambia es el invariante de §"Validación": el nivel se aplica a **todas** las ocurrencias del grupo, así que las `Replacement` de un mismo `groupId` siguen compartiendo `replacementValue`. `<NN>` no se abrevia nunca. La tabla completa de los 13 tipos —de los que acá solo hay 4 ejemplos, ambigüedad que `grouping-engine/src/labels.ts` arrastraba documentada— queda ratificada en ADR-057 §2 y replicada en `core/Grouping_Engine.md`.
>
> **Modificado por ADR-060 (2026-08-06)**. Para `EntityType.Person`, el `<TYPE>` depende además de `EntityGroup.personGender`: `MUJER`/`MUJER`/`MUJ` o `HOMBRE`/`HOMB`/`HOM`. **No es un `ReplacementMode` nuevo** — el enum de este ADR sigue teniendo cuatro valores. Ver ADR-060 §1-§3, y su análisis SAN: el token con género divulga un atributo que el neutro ocultaba.

### Formato para `redact`

`replacementValue = ""`. El render pinta el bbox de negro sólido. No se incluye texto en la imagen resultante (se pinta fill opaco antes del `convertToBlob`).

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Solo un modo (placeholder)** | Insuficiente para los 4 casos de uso del usuario. |
| **Solo `redact`** | Pierde legibilidad y contexto. Inaceptable para ML/demos. |
| **Solo `synthetic`** | Riesgo de reidentificación por patrones del sintético. No apto para legal estricto. |
| **Hash como modo** | No legible. No agrega valor sobre placeholder. |
| **Modo personalizado por ocurrencia** | Rompe ADR-011 (Grouping-First). |
| **Más modos (blurring, pixelado, etc.)** | Son variantes de `redact`. MVP no los incluye; pueden ser opciones de `redact` en v1.0. |

## Consecuencias

**Positivas**:
- Cubre los 4 casos de uso explícitos del usuario.
- Cada modo tiene semántica clara y testable.
- Default `placeholder` informativo y seguro.
- `synthetic` determinista permite reproducir exports concretos.

**Negativas**:
- 4 modos × 13 tipos × formatos = tabla grande de specs. Mitigado: está en `core/Export_Engine.md` y `shared`.
- `synthetic` requiere pools de faker y validadores de formato (checksum CUIT, Luhn tarjeta). Costo de implementación.
- `mask` puede filtrar longitud (un DNI de 7 vs 8 dígitos es distinguible). Mitigado: formato estándar AR fija la longitud.

**Neutras**:
- Modos adicionales (`blur`, `pixelate`) pueden ser sub-opciones de `redact` en v1.0 sin cambiar el enum.

## SAN y reidentificación

- `placeholder` con `indexInType` único por grupo garantiza que dos datos distintos del mismo tipo no se confundan.
- `synthetic` con seed aleatorio por sesión evita correlación entre sesiones; con seed fijo, permite reproducibilidad solo para quien conozca el seed.

  > **Precisado por `ADR-072` §5-§6 (2026-08-14)**. La rama "con seed fijo" **no existe** en el producto y no es un pendiente: `ADR-019` §5 la cerró a propósito, y hoy no hay forma de fijar el seed. Lo que este ADR llama "evita correlación entre sesiones" es, por lo tanto, incondicional.
  >
  > Y hay una segunda propiedad SAN que no estaba escrita acá y que ADR-072 §6 fija explícitamente: **la semilla del sintetizador nunca deriva del valor real**. Sembrar con el `canonicalValue` —la alternativa que da determinismo entre corridas— convertiría al sintetizador en un **oráculo de confirmación**: con el seed en mano se podría computar el valor sintético de un nombre sospechado y buscarlo en el documento anonimizado para verificar la hipótesis. La semilla es `EntityGroup.id`, un UUID sin relación con el contenido, así que el valor sintético no lleva **ninguna** información sobre el original.
- `mask` preserva formato pero no valor; el receptor puede inferir "aquí había un DNI" pero no cuál.
- `redact` no revela ni tipo ni valor; el receptor no sabe qué tipo de dato era. Útil para legal estricto.

Riesgo residual documentado en `08_Security_Model.md` §9.

## Validación

- Test por modo: para cada tipo y cada modo, el `replacementValue` respeta el formato.
- Test de coherencia: `Replacement` de un mismo `groupId` tienen el mismo `replacementValue`.
- Test de sintético determinista: mismo seed → mismo sintético.
- Test de placeholder: `[<TYPE> <NN>]` con padding correcto — extendido por ADR-057 §9 a los **tres niveles** de la escalera, más el test explícito del invariante "todos los `members` de un grupo comparten `replacementValue`", que antes estaba implícito en que había un solo formato posible.
- Test de `redact`: `replacementValue === ""` y el render pinta fill opaco.

## Referencias

- `00_Project_Vision.md` §6.1 (alcance: 4 modos)
- `03_Data_Model.md` §10, §11 (`EntityType`, `ReplacementMode`)
- `08_Security_Model.md` §9 (SAN)
- `ADR-011-Grouping-First.md`
- `core/Export_Engine.md` (spec: formatos por tipo)
- `core/Render_Engine.md` (spec: render de cada modo)
- `ui/UX_Guidelines.md` (selector de modo en el árbol)
