<!-- CONTEXT: scope=adr | dependencias=03_Data_Model.md,08_Security_Model.md,ADR-011-Grouping-First.md | audiencia=humanos+IA | fase=2 -->

# ADR-012 — Modos de Reemplazo (mask / synthetic / placeholder / redact)

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Aclaración del usuario en planificación
- **Relacionado con**: ADR-011-Grouping-First
- **Complementado por**: ADR-029 (la fila `Plate` de §"Formato por tipo para mask" tenía ambos formatos incorrectos y queda **superada**: Mercosur = `XX XXX XX`, vieja = `XXX XXX`; el formato por variante viaja en `Occurrence.maskFormat`)

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

| Tipo | Ejemplo `synthetic` |
|---|---|
| DNI | `39.123.456` |
| CUIT | `30-12345678-9` (con dígito verificador válido) |
| Phone | `+54 11 1234-5678` |
| Email | `user84231@example.org` |
| Person | `Carlos Sánchez` (de un pool de nombres faker) |
| Organization | `Empresa S.A.` (pool) |
| Address | `Calle Falsa 123` (pool) |

### Formato para `placeholder`

`[<TYPE> <NN>]` donde:
- `<TYPE>` es el label del tipo en mayúsculas (internacionalizable; default español).
- `<NN>` es `indexInType` con padding a 2 dígitos.

Ejemplos: `[DNI 01]`, `[PERSONA 03]`, `[DIRECCION 02]`, `[CUIT 01]`.

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
- `mask` preserva formato pero no valor; el receptor puede inferir "aquí había un DNI" pero no cuál.
- `redact` no revela ni tipo ni valor; el receptor no sabe qué tipo de dato era. Útil para legal estricto.

Riesgo residual documentado en `08_Security_Model.md` §9.

## Validación

- Test por modo: para cada tipo y cada modo, el `replacementValue` respeta el formato.
- Test de coherencia: `Replacement` de un mismo `groupId` tienen el mismo `replacementValue`.
- Test de sintético determinista: mismo seed → mismo sintético.
- Test de placeholder: `[<TYPE> <NN>]` con padding correcto.
- Test de `redact`: `replacementValue === ""` y el render pinta fill opaco.

## Referencias

- `00_Project_Vision.md` §6.1 (alcance: 4 modos)
- `03_Data_Model.md` §10, §11 (`EntityType`, `ReplacementMode`)
- `08_Security_Model.md` §9 (SAN)
- `ADR-011-Grouping-First.md`
- `core/Export_Engine.md` (spec: formatos por tipo)
- `core/Render_Engine.md` (spec: render de cada modo)
- `ui/UX_Guidelines.md` (selector de modo en el árbol)
