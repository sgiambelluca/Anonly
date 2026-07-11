<!-- CONTEXT: scope=adr | dependencias=architecture/03_Data_Model.md,core/Regex_Engine.md,core/Grouping_Engine.md,adr/ADR-012-Replacement-Modes.md | audiencia=humanos+IA | fase=6 -->

# ADR-029 — `Occurrence.maskFormat?`: el formato de máscara viaja con la ocurrencia (caso Plate vieja vs Mercosur)

- **Estado**: Accepted
- **Fecha**: 2026-07-11
- **Decidido por**: El humano (soportar ambas variantes de patente), sobre ambigüedad reportada por el implementador en el Hito 6
- **Relacionado con**: ADR-012 (modos de reemplazo; su fila `Plate` queda superada), ADR-022 (patrones Regex), ADR-028 (orden documental usado como desempate)

## Contexto

El implementador del Hito 6 reportó que `MASK_FORMAT_BY_TYPE[Plate]` no es decidible: Regex tiene
dos sub-patrones (`plate-vieja-ar`: `ABC 123`; `plate-mercosur-ar`: `AB 123 CD`) que colapsan al
mismo `EntityType.Plate`, y `Occurrence` (03_Data_Model.md §8) no transporta qué patrón matcheó.
Grouping opera a nivel de `EntityType`, así que **falta un dato en el modelo**, no una aclaración
de docs. El propósito del modo `mask` (ADR-012: "el lector sabe qué tipo de dato había por el
formato") exige fidelidad a la variante real.

Agravante encontrado al verificar: la fila `Plate` de ADR-012 §"Formato por tipo para mask" tiene
**ambos valores incorrectos** — asigna `XXX XXX` a Mercosur (esa es la forma de la vieja) y
`XXX XXXX` a la vieja (no corresponde a ningún formato AR). El código del Hito 4
(`default-ar.ts`) copió esos valores fielmente, dejando comentada la sospecha de inversión.

Decisión de producto del humano: soportar **ambas** variantes con su máscara correcta, no elegir
una.

## Decisión

### 1. `Occurrence` gana `readonly maskFormat?: string`

En `03_Data_Model.md` §8. Lo puebla **el detector que conoce el patrón**: Regex lo copia del
`RegexPattern.maskFormat` que matcheó; las ocurrencias NER no lo llevan (sus tipos enmascaran por
tipo). Campo opcional: no rompe consumidores existentes.

### 2. Formatos de máscara correctos por variante de patente

| Patrón | Ejemplo real | `maskFormat` |
|---|---|---|
| `plate-mercosur-ar` (`AB 123 CD`) | Mercosur, vigente desde 2016 | `XX XXX XX` |
| `plate-vieja-ar` (`ABC 123`) | AR vieja, aún circulante | `XXX XXX` |

La fila `Plate` de ADR-012 queda **superada** por esta tabla (pointer en su cabecera). Los valores
de `default-ar.ts` se corrigen en consecuencia.

### 3. Resolución del formato de máscara en Grouping

Para un grupo en modo `mask`:

1. Si algún `member` lleva `maskFormat`: usar el **más frecuente** entre los members que lo llevan;
   empate → el del member con primera aparición documental (mismo orden de ADR-028:
   `pageIndex`, `bbox.y`, `bbox.x`). Determinístico.
2. Si ninguno lo lleva (ocurrencias NER): fallback a `MASK_FORMAT_BY_TYPE[type]` como hasta ahora.
   El fallback de `Plate` es `XX XXX XX` (Mercosur, formato vigente) — solo alcanzable si una
   patente llegara sin `maskFormat`, cosa que con Regex como única fuente de `Plate` no ocurre.

Nota: dos variantes de patente no se agrupan automáticamente (sus `normalizedValue` difieren en
forma; el fuzzy 0.88 no las une), así que el caso "grupo mixto" solo aparece por fusión manual —
y la regla 1 lo resuelve determinísticamente.

### 4. Implementación en dos PRs (R-1: un PR = un módulo)

- **PR del Hito 6 (grouping)**: el campo en `03_Data_Model`/`@anonly/shared` + la resolución del
  §3 en Grouping + fallback corregido en `labels.ts`. Funciona standalone (campo opcional).
- **PR chico de regex (post-Hito 6)**: poblar `occurrence.maskFormat` desde el patrón matcheado y
  corregir los dos `maskFormat` de `default-ar.ts` según §2. Hasta ese PR, las patentes enmascaran
  con el fallback Mercosur — mismo comportamiento que hoy, sin regresión.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Elegir un solo formato para `Plate` | Rechazada por el humano: ambas variantes circulan en AR y el propósito de `mask` es reflejar el dato real. |
| `patternId` en `Occurrence` + mapa en Grouping | Duplica en Grouping conocimiento del catálogo de patrones de Regex (acoplamiento); `maskFormat` directo es autosuficiente y sirve para patrones custom futuros. |
| Inferir la variante en Grouping desde el valor | Grouping re-detectando formas es Regex mal ubicado (violación de responsabilidades, §3 del spec). |
| Campo en `EntityGroup` | Innecesario: se deriva de los members al calcular `replacementValue`. |

## Consecuencias

**Positivas**: el modo `mask` refleja la variante real de patente; el mecanismo sirve gratis para
los patrones custom del usuario (v1.0), que ya definen su propio `maskFormat`; se corrige un dato
erróneo de ADR-012 antes de que llegue a la UI.

**Negativas**: `Occurrence` gana un campo opcional más (costo de serialización despreciable);
la corrección completa queda repartida en dos PRs — entre ambos, el comportamiento es el actual
(fallback), nunca peor.

## Referencias

- `architecture/03_Data_Model.md` §8 (`Occurrence`) — `core/Regex_Engine.md` §6/§10 —
  `core/Grouping_Engine.md` §Resolución de modo
- `adr/ADR-012-Replacement-Modes.md` (fila Plate superada) — `adr/ADR-028` (orden documental)
- `packages/anonymization-core/regex-engine/src/patterns/default-ar.ts` (`plate-vieja-ar`,
  `plate-mercosur-ar`)
