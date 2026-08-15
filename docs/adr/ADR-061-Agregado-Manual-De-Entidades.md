<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Orchestrator.md,core/Regex_Engine.md,core/Grouping_Engine.md,architecture/03_Data_Model.md,ui/Components.md,ui/UX_Guidelines.md,adr/ADR-011-Grouping-First.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md | audiencia=humanos+IA | fase=10.7 -->

# ADR-061 — Agregado manual de entidades: búsqueda literal, no re-corrida de NER

- **Estado**: Accepted
- **Fecha**: 2026-08-06
- **Decidido por**: El humano. Es el punto 1 de `Cambios para hacer.txt`, con sus dos rutas: un botón sobre las coincidencias encontradas, y selección **sobre el archivo original** en el visor. Eligió hit-test contra palabras en vez de capa de texto, búsqueda exacta en la primera vuelta, y mantener la renumeración de ADR-028 tal como está.
- **Relacionado con**: ADR-011 (Grouping-First: el grupo sigue siendo la unidad de operación), ADR-028 (renumeración canónica — **no se toca**, ver §7), ADR-038 §2-§4 (`reopenSession`/`dropOccurrences`/dedup por identidad: la maquinaria que este ADR reusa entera), ADR-041 (precedente de función pura host-side), ADR-058 §5 (agrupación de palabras por línea — primitiva compartida)
- **Parte de**: Hito 10.7

> Convención de citas: `ADR-061 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-061, Contexto §N`.

## Contexto

### 1. Hoy no hay ninguna forma de agregar lo que el detector no encontró

Si el NER no reconoce "José Pérez" —nombre poco frecuente, OCR imperfecto, apellido partido en dos líneas—, ese dato **se exporta sin anonimizar** y el usuario no tiene ninguna acción disponible. Puede fusionar, dividir, deshabilitar y editar grupos existentes; no puede crear uno.

Es un agujero de completitud del producto, no una comodidad: la promesa es que el export no tiene datos sensibles, y el recall del NER es una métrica **informativa** en MVP (`MVP.md` §5, ≥ 85% pasa a gate recién en v1.0). O sea que el propio roadmap asume que se van a escapar entidades, y no hay red de contención.

### 2. Media solución ya está construida, y bien

- **`mapSpanToWords(page.words, start, end)`** (`regex-engine/src/regex.engine.ts`) mapea un rango de texto a las palabras que lo cubren y calcula el **bbox unión**. Es la pieza difícil de "convertir un string en una ocurrencia ubicada en la página", y está hecha y testeada.
- **`RegexEngine.addPattern(pattern)`** existe y su spec lo documenta literalmente como *"runtime, para UI"*.
- **`DetectionSource.Manual`** está en el enum desde el Hito 1, y `grouping.engine.ts` ya lo usa como default en dos lugares.
- **`reopenSession` / `dropOccurrences` / dedup por identidad** (ADR-038 §2-§4) son exactamente la maquinaria de "sumar ocurrencias a una sesión cerrada sin perder las ediciones del usuario".
- **Regex corre in-process**, sin pool ni worker (`create-core.ts`). Importa: `RegexPattern` lleva funciones (`checksum`, `normalizer`) que no sobrevivirían un `postMessage`.

### 3. El visor no tiene capa de texto, y no debería tenerla

`PageCanvas` dibuja un `<img>` desde un blob URL adentro de un `<canvas>`. No hay `<span>`, no hay nada seleccionable. "Seleccionar texto sobre el archivo original" no es algo que hoy se pueda hacer, ni con un ajuste chico.

Y la solución obvia —montar la capa de texto de pdf.js— es la equivocada, por una razón que no es de costo: **en un PDF escaneado no hay texto**. Es una foto. Una capa de texto resolvería los PDFs digitales y dejaría afuera precisamente los documentos donde más falta hace corregir a mano, que son los escaneados donde el OCR se comió un nombre.

### 4. El cliente no tiene ni las palabras ni las dimensiones de página

`document.store` guarda `id`, `name`, `pageCount` y `sourceKind`. Nada más. `PageCanvas` tiene un comentario que lo reconoce: las dimensiones se estiman en `pageLayout.ts` *"porque el Core no expone dimensiones de página reales al cliente"*.

Cualquier interacción posicional sobre el visor —hit-test, resaltado de resultados de búsqueda, saltar a una ocurrencia— necesita cerrar ese hueco. No es alcance extra de este ADR: es su precondición.

### 5. A `ner-engine` no se le puede pedir que busque un valor

El planteo original decía *"se reinicia el NER y/o Regex buscando únicamente este valor"*. La limitación no es del wrapper: es de lo que envuelve. `ner-engine` expone `process(document)` sobre un **clasificador de tokens** —se le da texto y etiqueta spans— y ninguna capa por encima puede convertir eso en "buscá a José Pérez". Forzarlo significaría correr el modelo entero sobre el documento para después filtrar: caro, lento, y con el mismo recall que ya falló sobre ese nombre en la primera pasada.

Regex sí podría, sintetizando un patrón literal. Pero cuando el usuario **escribió el valor exacto** no hay nada que inferir: la operación correcta es una búsqueda literal, que es más barata, determinista y no depende de ningún modelo.

## Decisión

### 1. Una pasada literal sobre `Page.words`, no una re-corrida de detección

`RegexEngine` gana un método dedicado:

```ts
findLiteral(
  input: { readonly document: Document; readonly value: string; readonly entityType: EntityType },
  ctx: EngineContext,
): Promise<RegexEngineOutput>;
```

Busca el literal en el documento, produce `Occurrence` con `source: DetectionSource.Manual` y las emite por `ENTITY_FOUND`, igual que cualquier detección. De ahí en adelante **no hay camino nuevo**: Grouping las recibe, las agrupa o crea el grupo, y la UI se entera por los eventos de siempre.

Vive en `regex-engine` y no en un motor nuevo ni en el Orchestrator porque es exactamente su responsabilidad —encontrar cadenas en un documento y emitir `Occurrence`— y porque ahí ya está `mapSpanToWords`, que es la parte difícil (Contexto §2).

**No usa `addPattern`.** Ese registro es para patrones que participan de **todas** las corridas siguientes; un valor puntual del usuario no debería re-evaluarse contra cada documento futuro ni quedar en el registro global del motor. La durabilidad se resuelve en §5, que es donde corresponde.

### 2. Búsqueda exacta, insensible a mayúsculas y acentos

Normalización NFC + minúsculas + sin diacríticos, sobre el mismo criterio que ya usa el `normalizedValue` de `Occurrence`. Encuentra `"Jose Pérez"`, `"JOSE PEREZ"` y `"jose perez"`. **No** encuentra `"J. Pérez"` ni `"Pérez, Jose"`.

El valor puede abarcar **varias palabras**, así que el matcheo es sobre secuencias de `Word` contiguas de la misma línea — la misma agrupación por banda vertical que ADR-058 §5 introduce para el repintado. Es una primitiva compartida, no dos implementaciones.

> **Errata (2026-08-14, hallazgo del implementador del PR 2)**: el párrafo de arriba daba por sentado que esa primitiva era alcanzable desde `regex-engine`. **No lo era, y además ya estaba duplicada.** Se corrige acá; la decisión de fondo —una sola definición de "misma línea" en todo el producto— no cambia, cambia dónde vive.
>
> 1. **El diagnóstico.** `sharesVerticalBand` vivía dentro de `selectLineWords` en `packages/anonymization-core/src/line-words.ts`, o sea en el **façade**, que ningún motor puede importar (P-2; `eslint.config.js` lo bloquea con el grupo `@anonly/anonymization-core`, mensaje "dependencia circular"). Y ya existía una **segunda** copia en `render-engine/src/worker/kernel.ts`, con un comentario que admitía la duplicación por esa misma razón. `regex-engine` habría sido la tercera.
> 2. **La resolución: `sharesVerticalBand(a, b)` se promueve a `@anonly/shared`** (`Contracts.md` §6). Es exactamente la regla que ese archivo ya enuncia para `estimateTokenWidth` — dos motores no pueden importarse entre sí, pero los dos pueden importar `shared`, así que la función vive ahí y **no se duplica en ninguno**. Es la única ubicación desde la que la frase "no dos implementaciones" es cumplible: ni el façade ni un motor son alcanzables desde los tres consumidores a la vez.
> 3. **`selectLineWords` no se mueve.** Lo que se promueve es el **átomo** —el criterio geométrico de banda vertical, cualquier solapamiento en Y sin umbral de proporción—, no su envoltorio. `selectLineWords` opera sobre `Replacement[]` y selecciona vecinas **a la derecha** para el repintado: es una forma propia del façade y no es reusable desde una búsqueda literal. Lo que no puede divergir es la **definición** de misma línea, no el wrapper.
> 4. **Mismo tratamiento para la normalización** de este §2. `normalizeForComparison(value)` (NFC + minúsculas + sin diacríticos + `trim` + colapso de espacios) también se promueve a `@anonly/shared`. La única implementación existente era `normalizeForLexicon` de `grouping-engine/src/gender.ts` (ADR-060 §4) — otro motor, igual de inalcanzable. Se promueve el cuerpo **verbatim**, así que `gender.ts` la consume sin wrapper y sin cambio de comportamiento, y `regex-engine` no nace con una copia.
> 5. **Los consumidores migran en cuatro PRs**, uno por módulo porque R-1 no admite juntarlos (ver la tabla de §9): `regex-engine` (PR 2, el bloqueante — es el que no puede avanzar sin esto), el façade (PR 3, que ya toca ese módulo), y `render-engine` + `grouping-engine` (PRs 7 y 8), que son **de-dup puro, sin cambio de comportamiento**, cubiertos por los tests que ya existen y por eso diferibles. Mientras esos dos últimos no caigan, el estado es **una canónica en `shared` más una copia legacy de cada primitiva, identificadas** — documentado, no accidental. El grep de control está en Validación.
> 6. **Un hueco de tests que esto destapa.** La implementación sin banda vertical pasa los siete tests que §10 pedía: ninguno ejercitaba el corte de línea. Se agrega el test que faltaba (§10 y `Regex_Engine.md` §14): un valor cuyas palabras caen en líneas distintas **no** matchea. Sin él, el fix de arriba se puede romper en silencio.
> 7. **Residuo aceptado.** Banda vertical sola no distingue dos **columnas** en la misma línea visual: si el orden de lectura de `pdf-engine` (ADR-067) dejara adyacentes la última palabra de una columna y la primera de la otra, y su texto normalizado coincidiera con lo buscado, habría un falso positivo. Es mucho más raro que el corte de línea y cerrarlo pide geometría de layout que ningún consumidor tiene hoy. Se acepta, en la misma línea que el resto de §2.

> **Limitación conocida y aceptada, anotada como trabajo futuro** (`roadmap/Future_Ideas.md`): las variantes del mismo dato no se encuentran. Si el documento dice "José Pérez" en la página 1 y "J. Pérez" en la 7, el usuario tiene que agregar las dos. Grouping **sí** las va a fusionar en un grupo una vez agregadas (su matching fuzzy por Levenshtein ya hace eso); lo que no ocurre es que la búsqueda las encuentre sola. Se decidió arrancar exacto y medir en uso real cuántas apariciones se escapan antes de invertir en búsqueda difusa, que trae falsos positivos que alguien tiene que revisar.

### 3. Dos rutas de entrada, un solo camino interno

Las dos terminan en la misma llamada; solo cambia de dónde sale el `value`.

**Ruta A — escribir el valor.** Botón sobre el árbol de entidades → elegir `EntityType` → escribir el valor → confirmar.

**Ruta B — señalar en el original.** El usuario clickea una palabra o arrastra un recuadro sobre el canvas del panel `original`; se resuelve qué palabras caen ahí; aparece "Agregar entidad como…" con el selector de tipo. El `value` es el texto de las palabras señaladas.

La ruta B **solo aplica al panel `original`**, como pidió el humano y como corresponde: en el `anonymized` el texto que se ve puede ser un reemplazo, y señalarlo no significaría nada.

### 4. La selección es hit-test contra `Page.words`, no una capa de texto

El cliente traduce coordenadas de pantalla a coordenadas de página y resuelve qué `Word` caen en la región señalada. La geometría es una **función pura** en `@anonly/shared` (`wordsInRect(words, rect)`), sin estado y testeable en Node.

Por qué así y no con la capa de texto de pdf.js:

- **Funciona igual en escaneados** (Contexto §3). Las palabras de OCR viven en el mismo `Page.words` con sus bboxes; el hit-test no distingue el origen. Con capa de texto, los escaneados quedaban afuera por construcción.
- No mete pdf.js en el cliente — hoy solo vive en los workers de `pdf-engine` y `render-engine`.
- No deja una copia del texto del documento original en el DOM. Para una herramienta de anonimización no es un detalle: es superficie que no hace falta crear.
- El bbox de la ocurrencia sale directo de las palabras señaladas, sin pasar por `mapSpanToWords`.

**Precondición: exponer palabras y dimensiones reales al cliente** (Contexto §4). Se agregan dos accesores de solo lectura al Orchestrator:

```ts
getPageWords(documentId: string, pageIndex: number): ReadonlyArray<Word>;
getPageSize(documentId: string, pageIndex: number): { readonly width: number; readonly height: number };
```

Por página y a demanda, no volcando el `Document` entero al store. `getPageSize` además **corrige** la estimación de `pageLayout.ts`, que hoy es una aproximación reconocida en el código.

### 5. Los literales manuales son durables, y los retiene el Orchestrator

El Orchestrator retiene por documento la lista de `{ value, entityType }` agregados a mano, y **los vuelve a aplicar después de cualquier re-detección**.

Sin esto hay un modo de falla silencioso: el usuario agrega "José Pérez", después cambia el idioma de OCR y dispara un `reanalyze`; `dropOccurrences` borra las ocurrencias de las páginas re-OCR'd —incluidas las manuales— y nada las vuelve a encontrar. El dato desaparece del árbol sin que nadie avise, y se exporta sin anonimizar. Es exactamente el agujero que este ADR viene a cerrar, reabierto por la puerta de atrás.

La lista se descarta con `closeDocument`/`dispose`, como el resto del estado por documento.

### 6. El flujo completo reusa ADR-038 sin agregar nada

```
addManualEntity(documentId, { value, entityType })
  → reopenSession(documentId)                    [ADR-038 §2, preserva ediciones]
  → regex.findLiteral({ document, value, entityType })
  → ENTITY_FOUND × N  (source: Manual)           [camino de siempre]
  → Grouping agrupa o crea; dedup por identidad  [ADR-038 §3]
  → finishSession(documentId)                    [ADR-028, renumeración canónica]
```

**El dedup por identidad es lo que hace segura la repetición**: si el usuario agrega dos veces el mismo valor, o agrega uno que el detector ya había encontrado, las ocurrencias duplicadas se descartan en silencio y se fusiona en el grupo existente. No hay que escribir nada para eso — ADR-038 §3 lo declaró invariante siempre activo.

**Cero ocurrencias encontradas** (el usuario escribió un valor que no está en el documento, o con un typo): no se crea grupo, y la UI lo informa. No es un error del Core: `findLiteral` devuelve `occurrenceCount: 0` y ya.

### 7. La renumeración de ADR-028 no se toca

Agregar una entidad dispara `finishSession`, que re-corre la renumeración canónica: los índices reflejan siempre el orden de aparición documental, así que agregar una persona de la página 2 puede correr los números de todas las posteriores.

Se evaluó congelar los índices ya asignados y **se descartó** (decisión del humano): romper el invariante de ADR-028 haría que el orden de los marcadores dependa del orden en que el usuario fue agregando cosas, que es exactamente la arbitrariedad que ADR-028 vino a eliminar. El costo —ver saltar números mientras se agregan entidades— es visible pero acotado, y es el mismo que ADR-038 §5 (Q2) ya aceptó para el re-análisis.

### 8. La lupa del punto 4 es la misma primitiva

El buscador tipo Ctrl+F sobre el documento (`Cambios para hacer.txt` punto 4) es **la misma búsqueda literal de §1 y §2** con otra UI encima: en vez de emitir `ENTITY_FOUND`, devuelve los matches con sus bboxes para que el visor los resalte y navegue.

```ts
findText(documentId: string, query: string): ReadonlyArray<TextMatch>;
```

Se implementa en el mismo paso. Separarlo significaría escribir dos veces el mismo matcheo, y desde la búsqueda es natural ofrecer "agregar este resultado como entidad" — que es la tercera ruta de entrada, gratis.

### 9. Alcance: seis PRs

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 1 | `wordsInRect`, `TextMatch`, `ManualEntityRequest`; tipos de los accesores | `shared` | — |
| 1b | **Docs de la errata de §2**: esta errata, `Contracts.md` §6, `Regex_Engine.md` §6/§13/§14/§15, y los ítems de checklist de los tres consumidores que migran | — (docs) | — |
| 1c | `sharesVerticalBand` y `normalizeForComparison` (errata de §2, puntos 2 y 4) | `shared` | 1b |
| 2 | `findLiteral` + matcheo de secuencias de palabras normalizado (§1, §2), consumiendo las dos primitivas de `shared` | `regex-engine` | 1, 1c |
| 3 | `addManualEntity`, `findText`, `getPageWords`, `getPageSize`; retención de literales manuales y su re-aplicación (§4, §5, §6, §8). De paso, `line-words.ts` consume `sharesVerticalBand` de `shared` — mismo módulo, no rompe R-1 | `packages/anonymization-core/src` | 1, 1c, 2 |
| 4 | Botón + diálogo "Agregar entidad" sobre el árbol (ruta A, §3) | `apps/react-client` | 3 |
| 5 | Hit-test sobre el canvas del `original` + "Agregar entidad como…" (ruta B, §3, §4) | `apps/react-client` | 3 |
| 6 | Lupa de búsqueda con navegación y resaltado (§8) | `apps/react-client` | 3 |
| 7 | De-dup: el kernel consume `sharesVerticalBand` de `shared` y borra su copia local (errata de §2, punto 5) | `render-engine` | 1c |
| 8 | De-dup: `gender.ts` consume `normalizeForComparison` de `shared` y borra `normalizeForLexicon` (errata de §2, punto 5) | `grouping-engine` | 1c |

Los PRs 4, 5 y 6 son independientes entre sí y pueden correr en paralelo una vez mergeado el 3.

**El 1b y el 1c son precondición del 2**, y salen de la errata de §2: sin ellos `regex-engine` no tiene de dónde importar la primitiva de línea sin duplicarla. El 1b va primero por R-2/R-19 (contrato antes que código) y porque `Contracts.md` §10 regla 1 exige declarar todo tipo o función pública ahí antes que en `shared/src/`.

**El 7 y el 8 son diferibles y no bloquean el hito**: son de-dup puro, cada uno de un motor distinto (R-1 los obliga a ir separados), sin cambio de comportamiento y cubiertos por los tests que ya existen. Si se difieren, el estado queda como dice el punto 5 de la errata — una canónica más dos copias legacy identificadas — y hay que dejarlo anotado, no darlo por unificado.

### 10. Tests

`shared` (PR 1):

- Unit: `wordsInRect` es pura; devuelve las palabras cuyo bbox intersecta la región, y ninguna otra.
- Edge: región vacía, región fuera de página, región que corta una palabra por la mitad (se incluye).

`shared` (PR 1c, errata de §2):

- Unit: `sharesVerticalBand` es simétrica y da `true` ante **cualquier** solapamiento en Y, sin umbral de proporción — un solapamiento mínimo cuenta igual que uno total.
- Edge: bandas que apenas se tocan por el borde (`a.y + a.height === b.y`) dan `false` — el criterio es solapamiento **estricto**, no adyacencia.
- Unit: `normalizeForComparison` colapsa mayúsculas, diacríticos y espacios repetidos; `"  José   PÉREZ "` y `"jose perez"` dan lo mismo.
- Edge: string vacío y string de solo espacios dan `""`, sin lanzar.

`regex-engine` (PR 2):

- Contract: `findLiteral` emite `ENTITY_FOUND` con `source: DetectionSource.Manual` y bbox correcto por ocurrencia.
- Contract: **no emite `REGEX_FINISHED`** ni altera el registro de patrones — no es una corrida de detección (§1).
- Unit: matchea insensible a mayúsculas y acentos ("JOSE PEREZ" encuentra "José Pérez").
- Unit: valor multi-palabra matchea sobre `Word` contiguas de la misma línea (§2).
- Unit: **un valor multi-palabra cuyas palabras caen en líneas distintas NO matchea** — el test que la errata de §2 (punto 6) agrega. Sin él, la banda vertical se puede perder en silencio y el falso positivo vuelve.
- Unit: **"J. Pérez" NO matchea "José Pérez"** — es la limitación de §2, asertada explícitamente para que no se implemente por accidente ni se rompa en silencio.
- Edge: valor ausente del documento → `occurrenceCount: 0`, sin eventos, sin error (§6).
- Edge: funciona sobre páginas cuyas palabras vienen de OCR (`source: "ocr"`).

`packages/anonymization-core/src` (PR 3):

- Contract: `addManualEntity` produce un grupo nuevo visible en el snapshot de Grouping.
- Contract: agregar un valor **ya detectado** no duplica — se fusiona por el dedup de ADR-038 §3.
- Contract: agregar dos veces el mismo valor es idempotente.
- Unit: **tras un `reanalyze` que descarta las páginas afectadas, los literales manuales se re-aplican** (§5). Es el test del modo de falla silencioso; sin él, el bug vuelve sin que ninguna suite lo note.
- Unit: `getPageWords`/`getPageSize` sobre `documentId` o `pageIndex` inexistente → `InvalidInputError`.
- Unit: la lista de literales se descarta en `closeDocument`.

`apps/react-client` (PRs 4-6):

- Unit: el diálogo emite `addManualEntity` con el tipo y valor elegidos.
- Unit: el hit-test solo se ofrece sobre el panel `original` (§3).
- Unit: la traducción de coordenadas de pantalla a coordenadas de página usa `getPageSize` y no la estimación de `pageLayout.ts`.
- Unit: valor sin coincidencias → mensaje al usuario, sin grupo nuevo.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Re-correr el NER "buscando solo ese valor"** | El NER no admite esa forma de invocación: es un clasificador de tokens, no un buscador (Contexto §5). Forzarlo significa correr el modelo entero y filtrar después — caro, lento, y con el mismo recall que ya falló sobre ese nombre. |
| **Capa de texto de pdf.js sobre el canvas** | Selección nativa y familiar, pero **no funciona en escaneados**, que es donde más se necesita corregir (Contexto §3). Además mete pdf.js en el cliente y deja el texto original en el DOM. |
| **Sintetizar un `RegexPattern` y usar `addPattern`** | Deja el valor del usuario en el registro global del motor, re-evaluándose en toda corrida futura. La durabilidad se resuelve mejor y con menos efectos en §5. |
| **Un motor nuevo para búsqueda manual** | `regex-engine` ya es "encontrar cadenas en un documento y emitir `Occurrence`", y ya tiene `mapSpanToWords`. Un motor nuevo exige pool, spec, contratos y ADR propio para no agregar nada. |
| **Implementar el matcheo host-side en el Orchestrator** | Reimplementaría `mapSpanToWords` y la normalización que `regex-engine` ya tiene resueltas y testeadas. El precedente de ADR-041 aplica a lógica que **necesita** el `Document` completo y no tiene motor dueño; ésta sí lo tiene. |
| **Búsqueda difusa desde la primera vuelta** | Trae falsos positivos que alguien tiene que revisar, sobre una función cuyo propósito es que el usuario corrija con precisión. Decisión del humano: exacto primero, medir, después decidir (§2). |
| **Congelar los `indexInType` ya asignados al agregar** | Haría que el orden de los marcadores dependa del orden en que el usuario fue agregando entidades — la arbitrariedad que ADR-028 eliminó (§7). |
| **Volcar el `Document` completo al store del cliente** | Palabras de un documento de 50 páginas por un caso de uso puntual. Los accesores por página a demanda dan lo mismo sin duplicar el modelo en el cliente (§4). |
| **No retener los literales manuales** | Modo de falla silencioso: un `reanalyze` posterior borra las ocurrencias manuales de las páginas afectadas y el dato se exporta sin anonimizar, sin ningún aviso (§5). |

## Consecuencias

**Positivas**: se cierra un agujero de completitud del producto — hasta hoy, lo que el detector no encontraba no tenía ninguna vía de corrección, sobre un pipeline cuyo propio roadmap admite que el recall del NER no es un gate en MVP; la mayor parte del trabajo pesado ya existía (`mapSpanToWords`, `DetectionSource.Manual`, `reopenSession`, dedup por identidad), así que el código nuevo es sobre todo cableado y UI; el hit-test contra palabras funciona idéntico en PDFs digitales y escaneados, sin una sola rama; se cierra de paso el hueco de dimensiones de página estimadas que arrastraba `pageLayout.ts`; y el buscador del punto 4 sale de la misma primitiva, con la búsqueda como tercera vía de agregado.

**Negativas**: la búsqueda exacta no encuentra variantes, así que un mismo dato escrito de dos formas exige dos agregados manuales (§2) — limitación conocida, anotada en `Future_Ideas.md`; cada agregado dispara `finishSession` y puede correr los índices de los grupos que el usuario ya vio (§7), lo que se hace notorio al agregar varias entidades seguidas; el Orchestrator gana estado retenido por documento (la lista de literales), que hay que limpiar en `closeDocument`/`dispose`; y el cliente pasa a manejar coordenadas de página, con la complejidad de mapeo que eso implica en un visor con zoom.

**Neutras**: ADR-011 se respeta — el grupo sigue siendo la unidad de operación, y una entidad manual produce un grupo como cualquier otra. ADR-028 y ADR-038 no cambian: este ADR **consume** su maquinaria sin modificarla. `DetectionSource.Manual` deja de ser un valor sin productores. El modelo de seguridad no se toca: nada sale del navegador y no hay superficie nueva de red.

## Docs actualizados por este ADR

- `core/Regex_Engine.md` → v1.1.0: `findLiteral` (§6), casos límite y tests. → v1.3.0 por la errata de §2: de dónde salen las dos primitivas, caso límite 27 y su test.
- `core/Orchestrator.md` → v1.7.0: `addManualEntity`, `findText`, `getPageWords`, `getPageSize`, retención de literales manuales. Ítems 24 y 24b del checklist: las cuatro entradas nuevas, y `line-words.ts` consumiendo `sharesVerticalBand` de `shared` (errata de §2).
- `core/Contracts.md` §3.5 (`IPipelineOrchestrator`), §6 — y `architecture/03_Data_Model.md` (`TextMatch`, `ManualEntityRequest`). §6 gana además `sharesVerticalBand` y `normalizeForComparison` por la errata de §2.
- `core/Grouping_Engine.md` §13 — el caso de ocurrencia manual que se fusiona con un grupo existente. Ítem 15l: `gender.ts` consume `normalizeForComparison` (errata de §2, PR 8).
- `core/Render_Engine.md` — ítem 28: el kernel consume `sharesVerticalBand` de `shared` (errata de §2, PR 7).
- `ui/Components.md` y `ui/UX_Guidelines.md` — botón y diálogo de agregado, interacción de selección sobre el `original`, lupa de búsqueda.
- `roadmap/MVP.md` §4 — bloque del Hito 10.7; §6 — riesgo de la búsqueda exacta.
- `roadmap/Future_Ideas.md` — la búsqueda difusa de variantes como trabajo futuro (§2).

## Validación

- Los tests de §10 verdes, en particular los tres que protegen decisiones que se rompen fácil: **`"J. Pérez"` no matchea `"José Pérez"`** (§2), **un valor cuyas palabras cruzan de una línea a la siguiente no matchea** (errata de §2) y **los literales manuales sobreviven a un `reanalyze`** (§5).
- Grep de control de la errata de §2, sobre `packages/`: `function sharesVerticalBand` y `u0300` —la huella de la normalización, que es lo que hay que grepear porque la copia existente se llama distinto (`normalizeForLexicon`)— aparecen **una sola vez cada uno**, en `shared/src/`. Con los PRs 7 y 8 pendientes hay **exactamente una copia extra de cada uno** —`render-engine/src/worker/kernel.ts` y `grouping-engine/src/gender.ts`—, y ninguna otra.
- Verificación manual E2E: importar un PDF con un nombre que el NER no detecta, agregarlo por cada una de las tres vías (diálogo, selección sobre el original, resultado de búsqueda), y confirmar que aparece anonimizado en el preview y en el export.
- Repetir sobre un PDF **escaneado**: es donde el hit-test justifica su elección frente a la capa de texto.
- Grep de control: `pdfjs-dist` no aparece en `apps/react-client` (§4).
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, más `pnpm test:e2e`.

## Referencias

- `core/Regex_Engine.md` §6 — `core/Orchestrator.md` §2, §6 — `core/Grouping_Engine.md` §13 — `core/Contracts.md` §3.5, §5 — `architecture/03_Data_Model.md`
- `adr/ADR-011` — `adr/ADR-028` — `adr/ADR-038` §2-§5 — `adr/ADR-041` — `adr/ADR-058` §5
- Código: `packages/anonymization-core/regex-engine/src/regex.engine.ts` (`mapSpanToWords`, `addPattern`) — `packages/anonymization-core/src/orchestrator.ts` — `packages/anonymization-core/shared/src/enums.ts` (`DetectionSource.Manual`) — `apps/react-client/src/components/viewer/PageCanvas.tsx` — `apps/react-client/src/components/viewer/pageLayout.ts` — `apps/react-client/src/store/document.store.ts`
