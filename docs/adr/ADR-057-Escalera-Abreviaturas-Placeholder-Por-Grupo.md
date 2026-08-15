<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,core/Render_Engine.md,architecture/03_Data_Model.md,adr/ADR-011-Grouping-First.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-029-Occurrence-MaskFormat-Plate-Variantes.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md,adr/ADR-060-Reemplazo-Por-Genero.md | audiencia=humanos+IA | fase=10.5 -->

# ADR-057 — Escalera de abreviaturas del `placeholder`, elegida por grupo

- **Estado**: Accepted
- **Fecha**: 2026-08-06
- **Decidido por**: El humano, tras reportar que el reemplazo se superpone al texto original cuando el token es más largo que el dato que tapa ("el nombre que aparece en el documento es Ana y se decide reemplazarlo con Placeholder... termina superponiéndose sobre el texto original, complicando la legibilidad"). Es el punto 5 de `Cambios para hacer.txt`.
- **Relacionado con**: ADR-012 §"Formato para `placeholder`" (**este ADR lo modifica**: `[<TYPE> <NN>]` deja de ser el único formato y pasa a ser el nivel 0 de una escalera), ADR-028 (renumeración canónica — mismo punto de recálculo), ADR-029 (resolución por grupo del formato de `mask` — precedente directo de forma), ADR-038 §2-§4 (re-análisis), ADR-058 (la cascada de render donde esta escalera es la primera pieza), ADR-060 (reemplazo por género, que depende de §3 de este ADR)
- **Parte de**: Hito 10.5, paso 2

> Convención de citas: `ADR-057 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-057, Contexto §N`.

## Contexto

### 1. El síntoma

`paintReplacements` (`render-engine/src/worker/kernel.ts`) tapa el bbox de la ocurrencia con un rectángulo blanco y escribe el `replacementValue` centrado. El tamaño de fuente sale de `fontForMode`, que lo deriva **solo de la altura** del bbox (`Math.max(8, Math.round(boxHeight * 0.7))`), y el `fillText` va **sin el parámetro `maxWidth`**. Como además `textAlign = "center"`, un token más ancho que su caja se derrama hacia los **dos** lados, más allá del rectángulo blanco, encima de palabras del documento original que siguen dibujadas debajo.

`[PERSONA 01]` sobre "Ana" es el caso canónico: 11 caracteres sobre una caja de 3.

### 2. No es exclusivo de `placeholder`

`mask` usa formatos de longitud fija por tipo (`MASK_FORMAT_BY_TYPE`, p. ej. IBAN `XX00 XXXX XXXX XXXX XXXX`, 24 caracteres) y `synthetic` genera valores que pueden exceder al original. Los tres modos con texto se derraman igual. **Este ADR no los arregla**: arregla el único que puede acortarse sin perder su semántica. Los otros dos dependen de ADR-058.

### 3. El invariante que no se puede romper

ADR-012 §"Validación" exige que las `Replacement` de un mismo `groupId` compartan `replacementValue`, y `buildPageReplacements` (`export-engine`) lo implementa copiando `group.replacementValue` a cada ocurrencia. Ese invariante es lo que hace que un documento anonimizado sea legible: "[PERSONA 03]" es la misma persona en la página 1 y en la 40.

O sea que la abreviatura **no puede elegirse por ocurrencia**. La ocurrencia apretada de la página 12 no puede aparecer como `[PRS-03]` mientras las holgadas siguen como `[PERSONA 03]`: sería el mismo dato con dos nombres, y el lector no tiene cómo saber que son el mismo.

### 4. El dato para decidir ya está en el grupo

`EntityGroup.members` es `ReadonlyArray<OccurrenceRef>` y cada `OccurrenceRef` lleva su `bbox` (`Contracts.md` §5). El grupo conoce, sin ayuda de nadie, el ancho de todas sus apariciones en el documento. No hace falta un canal nuevo, ni un evento nuevo, ni que el Render le devuelva nada.

### 5. Grouping no puede medir texto

`grouping-engine` no tiene canvas ni `measureText` — ni debe tenerlos: es un motor de datos y sus dependencias permitidas no incluyen nada de render. Cualquier criterio de "¿entra?" que se decida acá es necesariamente una **estimación**.

Eso no es un problema si se acepta explícitamente qué papel cumple cada pieza: la escalera es una **optimización** que reduce el problema, y la garantía dura de que nada se derrama vive en ADR-058 §1 (shrink-to-fit con `measureText` real, dentro del kernel). Si la estimación se equivoca, el resultado sigue siendo correcto, solo menos bonito.

### 6. Una deuda abierta que este ADR cierra

`grouping-engine/src/labels.ts` documenta una ambigüedad desde su implementación: ADR-012 §"Formato para `placeholder`" solo da **4 ejemplos** (DNI, PERSONA, DIRECCION, CUIT) de los 13 valores de `EntityType`, y no hay tabla completa en `Contracts.md`, `Grouping_Engine.md`, `03_Data_Model.md` ni `ui/Components.md`. Los 9 restantes se implementaron como traducción directa, con la nota de que "debería confirmarse formalmente (ADR o actualización de `ui/Components.md`) antes de v1.0". Este ADR es ese ADR: ratifica la tabla completa (§2).

## Decisión

### 1. Tres niveles, por longitud decreciente

```
nivel 0:  [<LABEL> <NN>]          [PERSONA 01]
nivel 1:  [<ABREV> <NN>]          [PERS 01]
nivel 2:  [<CORTO>-<NN>]          [PRS-01]
```

El nivel 2 además **colapsa el separador**: espacio → guion. Es un carácter más de ganancia y mantiene la legibilidad del token.

`<NN>` sigue siendo `pad2(indexInType)` en los tres niveles. **No se abrevia el número**: es lo que distingue dos entidades del mismo tipo, y perderlo rompe la trazabilidad que justifica el modo `placeholder`.

### 2. Tabla canónica por `EntityType` (ratifica y extiende ADR-012)

| `EntityType` | Nivel 0 (`LABEL`) | Nivel 1 (`ABREV`) | Nivel 2 (`CORTO`) |
|---|---|---|---|
| `Person` | `PERSONA` | `PERS` | `PRS` |
| `Organization` | `ORGANIZACION` | `ORGA` | `ORG` |
| `Address` | `DIRECCION` | `DIRE` | `DIR` |
| `DNI` | `DNI` | `DNI` | `DNI` |
| `CUIT` | `CUIT` | `CUIT` | `CUIT` |
| `Phone` | `TELEFONO` | `TELE` | `TEL` |
| `Email` | `EMAIL` | `MAIL` | `EML` |
| `IBAN` | `IBAN` | `IBAN` | `IBAN` |
| `CreditCard` | `TARJETA` | `TARJ` | `TRJ` |
| `Date` | `FECHA` | `FECH` | `FEC` |
| `License` | `MATRICULA` | `MATR` | `MAT` |
| `Plate` | `PATENTE` | `PATE` | `PAT` |
| `Custom` | `CUSTOM` | `CUST` | `CST` |

**Las columnas pueden repetirse y eso es correcto, no un descuido.** Para `DNI`, `CUIT` e `IBAN` el label ya es una sigla: acortarla más produciría tokens ilegibles (`[CUI-01]`) a cambio de un carácter. En esos casos los niveles 0 y 1 son idénticos y el nivel 2 aporta solo el colapso del separador. La selección de §4 elige el primero que entra, así que los niveles degenerados se saltean solos sin ninguna rama especial.

El nivel 0 es exactamente el `TYPE_LABEL_ES` que ya existe, así que **ningún documento cambia de token por este ADR salvo donde el token no entraba**.

### 3. La resolución del label pasa a ser **por grupo**, no por tipo

Hoy `TYPE_LABEL_ES` es `Readonly<Record<EntityType, string>>` y `buildPlaceholderValue(type, indexInType)` lo indexa directo. Se introduce una indirección: el label se resuelve a partir del **grupo**, y la resolución actual devuelve el del tipo.

```ts
// Reemplaza el acceso directo a TYPE_LABEL_ES desde buildPlaceholderValue.
function resolveLabelSet(group: EntityGroup): PlaceholderLabelSet;
```

Hoy esa función es un lookup por `group.type` y nada más. **La indirección no se agrega por elegancia: se agrega porque ADR-060 la necesita.** El reemplazo por género convierte el label en una propiedad del grupo (dos grupos `Person`, labels distintos: `PERSONA` / `MUJER` / `HOMBRE`), y si la escalera se implementa contra un `Record<EntityType, …>` hay que reescribirla entera tres semanas después. Cuesta lo mismo hacerlo bien ahora.

Corolario para ADR-060: las variantes de género traen sus propios tres niveles (`MUJER` / `MUJER` / `MUJ`, `HOMBRE` / `HOMB` / `HOM`) y entran como filas nuevas de la misma tabla, sin tocar §1, §4 ni §5.

### 4. El nivel se elige con la ocurrencia **más apretada** del grupo

```
nivelElegido(group) =
  el primer nivel L ∈ [0, 1, 2] tal que, para TODOS los members del grupo,
  el token del nivel L cabe estimado en member.bbox;
  si ninguno cumple, nivel 2.
```

O sea: se elige por el peor caso, y el resultado se aplica a **todas** las ocurrencias (Contexto §3). Un grupo con 40 apariciones holgadas y una apretada baja de nivel entero. Es deliberado: la alternativa es romper el invariante.

**El fallback al nivel 2 no es una garantía de que entre.** Si ni siquiera `[PRS-01]` cabe, el grupo se queda en el nivel 2 y quien resuelve es ADR-058 §1. Grouping no tiene otra carta que jugar.

### 5. La estimación de ancho vive en `@anonly/shared`

El criterio de "cabe" necesita dos constantes que hoy son números mágicos dentro de `fontForMode`:

```ts
/** Fracción de la altura del bbox que el render usa como tamaño de fuente. */
export const REPLACEMENT_FONT_HEIGHT_RATIO = 0.7;
/** Avance medio de glifo como fracción del tamaño de fuente. */
export const AVG_GLYPH_ADVANCE_RATIO = 0.6;

/** Ancho estimado de un token, sin canvas. Pura y determinista. */
export function estimateTokenWidth(charCount: number, boxHeight: number): number;
```

Van a `shared` y **no** se duplican: `grouping-engine` las usa para elegir el nivel y `render-engine` las usa como punto de partida de su medición real. Dos motores no pueden importarse entre sí (P-1), pero los dos pueden importar `shared` — es exactamente el caso para el que existe.

Propiedad que hace válida la estimación: el criterio compara `estimateTokenWidth(n, bbox.height)` contra `bbox.width`, y las dos magnitudes salen del mismo bbox. La razón `width/height` es **invariante a la escala**, así que el nivel elegido no depende de a qué zoom se renderice después. Grouping decide una vez y vale para todos los renders.

### 6. `mask`, `synthetic` y `redact` no participan

- `mask`: su formato **es** la información que transmite (`XX.XXX.XXX` dice "acá había un DNI"). Acortarlo lo convierte en otra cosa. Sigue resolviéndose por ADR-029.
- `synthetic`: un sintético abreviado deja de ser un valor plausible, que es su razón de existir.
- `redact`: `replacementValue = ""`, no hay nada que acortar.

Los tres se apoyan en ADR-058 §1 para no derramarse.

### 7. Cuándo se recalcula, y qué gana ante una edición manual

El nivel se calcula **en los mismos puntos donde ya se recalcula `replacementValue`**: no se agrega ningún disparador nuevo. En particular, en la renumeración canónica de `finishSession` (ADR-028), que ya recorre los grupos en modo `placeholder`.

**La edición manual gana siempre.** Si el usuario escribió su propio `replacementValue` (caso 17 de `Grouping_Engine.md`, `GROUP_UPDATE_REQUESTED` con `patch.replacementValue`), la escalera no lo toca — ni en ese momento ni en un `finishSession` posterior. Es la misma precedencia que ya tiene ADR-028 con `indexInType`, y es la palanca que ADR-058 §4 le ofrece al usuario cuando el aviso de degradación se enciende.

> **Enmienda (ADR-076, 2026-08-15) — esta promesa no estaba implementada.** El motor la cumplía **por accidente**: la única cosa que hacía sobrevivir una edición manual a un `finishSession` era la guarda `if (newIndex === group.indexInType) return;` de ADR-028, o sea que la edición se perdía en cuanto el índice del grupo se movía — y `inferGendersOnFinish` la pisaba por un segundo camino que este ADR no conocía. El test que esta sección pide (§9, *"un `replacementValue` editado a mano sobrevive a `finishSession`"*) pasaba **sin ejercitar la condición**, porque su escenario no mueve el índice. **ADR-076** implementa la promesa con `replacementValueUserSet` y decide la precedencia completa del campo en los once puntos de recálculo; el texto de arriba queda válido tal cual, y se le agrega la única excepción que ADR-076 §3 define: un cambio del `replacementMode` **efectivo** sí reemplaza el valor escrito a mano.

**Un re-análisis puede cambiar el nivel.** Si `reopenSession` (ADR-038) suma members y uno de ellos es más apretado, el grupo baja de nivel y su token cambia. Es el mismo tipo de cambio que ya produce la renumeración de `indexInType` sobre la unión de ocurrencias, y se acepta por la misma razón: el estado post-`finishSession` es el canónico, y es el que se exporta.

### 8. Alcance: dos PRs

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 2 | `REPLACEMENT_FONT_HEIGHT_RATIO`, `AVG_GLYPH_ADVANCE_RATIO`, `estimateTokenWidth` (§5) — más los tipos de ADR-058 §7 y ADR-059 §3, que viajan en el mismo PR de `shared` | `shared` | — |
| 3 | Tabla de §2, `resolveLabelSet` (§3), selección de nivel (§4) y su enganche en `computeReplacementValue` (§7) | `grouping-engine` | PR 2 |

La numeración es la del Hito 10.5 completo (`roadmap/MVP.md` §4); el PR 1 es ADR-058 §1 y no depende de estos.

### 9. Tests

`shared` (PR 2):

- Unit: `estimateTokenWidth` es determinista y monótona en `charCount` y en `boxHeight`.

`grouping-engine` (PR 3):

- Contract: para los 13 `EntityType`, los tres niveles respetan el formato de §1 (`[X Y]` / `[X Y]` / `[X-Y]`) y `<NN>` conserva el padding a 2 dígitos en los tres.
- Contract: **todos** los `members` de un grupo comparten `replacementValue` — el invariante de ADR-012, re-asertado ahora que hay más de un formato posible.
- Unit: un grupo cuyos bboxes son todos holgados queda en nivel 0 — o sea, **el comportamiento previo a este ADR no cambia** donde no había problema.
- Unit: agregar al grupo un member angosto baja el nivel de todo el grupo (§4).
- Unit: un grupo donde ni el nivel 2 entra se queda en nivel 2, sin error ni warning (§4).
- Edge: los tipos con niveles degenerados (`DNI`, `CUIT`, `IBAN`) producen los tokens esperados y no fallan por la igualdad de columnas (§2).
- Edge: un `replacementValue` editado a mano sobrevive a `finishSession` y a la selección de nivel (§7).
- Edge: `mask`, `synthetic` y `redact` no cambian de valor por este ADR (§6).
- Edge: tras `reopenSession` + `finishSession`, un member nuevo más angosto cambia el nivel del grupo (§7).

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Abreviatura adaptativa por ocurrencia** | Rompe el invariante de ADR-012 (Contexto §3) y, peor, rompe la legibilidad: el mismo dato aparecería con dos nombres distintos en el mismo documento y el lector no tendría cómo saber que son el mismo. Es la razón de ser del modo `placeholder`. |
| **Solo dos niveles** | El humano pidió tres explícitamente. Con dos, `[PERS 01]` sobre "Ana" o "Luz" sigue sin entrar, que es justamente el caso que motivó el reporte. |
| **Escalera continua (truncar el label al ancho disponible)** | Produce tokens arbitrarios e irreproducibles (`[PERSO 01]`, `[PER 01]`, `[PE 01]`) que el lector no puede asociar a un tipo. Tres niveles fijos son memorizables; un continuo no. |
| **Abreviar también el `<NN>`** | Es lo único que distingue dos entidades del mismo tipo. Ahorra un carácter y destruye la utilidad del modo. |
| **Medir de verdad, pasando el ancho real desde Render a Grouping** | Invierte el sentido del pipeline (Render es aguas abajo de Grouping) y ataría el cómputo de `replacementValue` a que exista un render previo — con lo que el primer render de cada documento saldría con el nivel equivocado. La estimación de §5 alcanza porque la garantía dura está en ADR-058 §1 (Contexto §5). |
| **Elegir el nivel en `render-engine`, donde sí hay `measureText`** | Rompe el invariante por construcción: el kernel ve una página por vez y no puede saber si hay una ocurrencia más apretada en la página 40. Además pondría lógica de resolución de `replacementValue` en un motor cuyo §3 dice explícitamente "no decide el modo de reemplazo". |
| **Expandir el bbox hacia el espacio en blanco vecino en vez de acortar el token** | Se evaluó y se descartó en planificación: es un caso particular de ADR-058 §2 (que corre las palabras en vez de solo comerse el hueco), y como pieza independiente obligaba a agregar un campo de layout a `Replacement` para nada. |
| **Hacer configurable el nivel desde `SettingsDialog`** | Suma superficie de configuración a un panel que el humano ya quiere hacer **más** explicativo y no más denso (punto 3 de `Cambios para hacer.txt`). La palanca fina ya existe y es mejor: editar el `replacementValue` del grupo puntual (§7). |

## Consecuencias

**Positivas**: el caso que motivó el reporte —un nombre corto reemplazado por un token largo— deja de derramarse en la mayoría de los documentos sin necesidad de repintar nada, que es la pieza cara; el modo `placeholder` sigue siendo trazable porque el token es único por grupo y conserva su `<NN>`; la UI muestra el token abreviado **sin ningún cambio en `apps/react-client`**, porque el árbol de entidades ya lee `group.replacementValue` (`ReplacementModeSelect.tsx`); y se cierra la deuda de la tabla de labels incompleta que arrastraba `labels.ts` desde su implementación (Contexto §6).

**Negativas**: se modifica un formato que ADR-012 declaraba fijo, con el churn de fixtures y snapshots que eso implica en `grouping-engine`; un grupo con una sola aparición apretada arrastra a las 40 holgadas al nivel corto, que es el precio del invariante (§4); y la estimación de §5 va a discrepar a veces de la medición real del kernel, así que habrá casos que bajen de nivel sin necesitarlo y casos que se queden cortos y terminen en el shrink-to-fit de ADR-058 §1. Ninguno de los dos produce un resultado incorrecto, solo subóptimo.

**Neutras**: `mask` conserva intacta la resolución por grupo de ADR-029; el sintetizador de `shared/synthesizer.ts` no se toca; `indexInType` y su renumeración (ADR-028) no cambian; y el contrato de `EntityGroup` no gana ningún campo — el nivel elegido no se persiste, se deriva. ADR-060 **sí** agrega un campo, pero es su decisión, no esta.

## Docs actualizados por este ADR

- `adr/ADR-012-Replacement-Modes.md` — §"Formato para `placeholder`": nota de modificación (el formato pasa a ser el nivel 0 de una escalera) y §"Validación": el test de padding se conserva y se le suma el de invariante por grupo.
- `core/Contracts.md` §6 — `REPLACEMENT_FONT_HEIGHT_RATIO`, `AVG_GLYPH_ADVANCE_RATIO`, `estimateTokenWidth`.
- `architecture/03_Data_Model.md` §9 (atributo `replacementValue` e invariante por grupo), §11 (la escalera y su selección).
- `core/Grouping_Engine.md` → v1.2.0: nota de cabecera, §"`replacementValue` por modo" (fila de `placeholder`), §13 casos nuevos, §14.
- `core/Render_Engine.md` §13 caso 5 (el placeholder ya no es un solo formato) — el resto lo actualiza ADR-058.
- `roadmap/MVP.md` §4 — bloque del Hito 10.5, paso 2.

## Validación

- Los tests de §9 verdes.
- Verificación de no-regresión: un documento cuyos tokens entraban antes produce **exactamente** los mismos `replacementValue` que antes de este ADR (§2, nivel 0 = `TYPE_LABEL_ES`).
- Grep de control: ningún acceso directo a `TYPE_LABEL_ES` fuera de `resolveLabelSet` (§3) — es lo que ADR-060 necesita que se respete.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `core/Contracts.md` §5 (`EntityGroup`, `OccurrenceRef`), §6 — `core/Grouping_Engine.md` §"`replacementValue` por modo", §13 — `core/Render_Engine.md` §13
- `adr/ADR-012` §"Formato para `placeholder`", §"Validación" — `adr/ADR-028` — `adr/ADR-029` — `adr/ADR-038` §2-§4 — `adr/ADR-058` §1, §7 — `adr/ADR-060` §2
- Código: `packages/anonymization-core/grouping-engine/src/labels.ts` (`TYPE_LABEL_ES`, `buildPlaceholderValue`, `pad2`) — `packages/anonymization-core/grouping-engine/src/grouping.engine.ts` (`computeReplacementValue`) — `packages/anonymization-core/export-engine/src/export.engine.ts` (`buildPageReplacements`) — `packages/anonymization-core/render-engine/src/worker/kernel.ts` (`fontForMode`) — `apps/react-client/src/components/entities/ReplacementModeSelect.tsx`
