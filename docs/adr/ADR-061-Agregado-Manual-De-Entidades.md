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

> **Errata (2026-08-14, hallazgo del implementador del PR 4)**: "la UI lo informa" no era implementable. `addManualEntity` devolvía `Promise<void>`, y el `occurrenceCount` de `findLiteral` moría adentro del Orchestrator: ni retorno, ni evento, ni estado en el store le decían al diálogo si se agregó algo o no. El test que §10 pide para el PR 4 —"valor sin coincidencias → mensaje al usuario"— no se podía escribir. La decisión de §6 no cambia (cero no es un error); faltaba el canal.
>
> 1. **`addManualEntity` devuelve `Promise<ManualEntityResult>`**, con `ManualEntityResult = { readonly occurrenceCount: number }` (`Contracts.md` §3.5). Es lo único que el caller no puede deducir solo: si un grupo se creó o se fusionó lo ve por los eventos de siempre, pero "no había nada que agregar" no emite absolutamente nada, y esa ausencia es indistinguible de un evento todavía no llegado.
> 2. **Es un cambio aditivo, no una ruptura.** `await orchestrator.addManualEntity(...)` sin usar el resultado sigue compilando igual, así que el PR 3 ya mergeado y sus tests no necesitan migración. Por eso no hace falta un ADR nuevo ni una ventana de deprecación: es ensanchar el retorno, no cambiarlo.
> 3. **Qué cuenta exactamente `occurrenceCount`**: las apariciones del valor **en el documento**, tal como las emitió `findLiteral` — **antes** del dedup de Grouping. No es "cuántos grupos se crearon" ni "cuántas ocurrencias se sumaron". Un valor que el detector ya había encontrado devuelve N > 0 aunque todas se fusionen y el árbol no cambie: es correcto, porque para el usuario la entidad **quedó cubierta**. La única lectura que la UI debe hacer es `0` vs `> 0`; leerlo como "se agregaron N" haría que el copy mienta en el caso de fusión.
> 4. **Cero no lanza.** Sigue sin ser un error del Core: el usuario escribiendo algo que no está es un resultado, no un fallo. Lanzar obligaría a la UI a usar `try/catch` para un camino esperado y confundiría este caso con `InvalidInputError` (documento inexistente, stage inválido), que sí son errores.
> 5. **El tipo vive en el façade, no en `shared`.** Ningún motor lo produce ni lo consume: es el retorno de un método de `IPipelineOrchestrator`. Mismo lugar y mismo criterio que `ImportDocumentInput` —declarado en `Contracts.md` §3.5 y en `packages/anonymization-core/src/types.ts`, sin presencia en `shared`—, a diferencia de `ManualEntityRequest` y `TextMatch`, que sí son del modelo de datos y viajan a los motores. Consecuencia práctica: **no hace falta un PR de `shared`**.
> 6. **El literal se retiene aunque encuentre cero, y eso queda decidido acá.** El PR 3 lo implementó así con buen criterio y conviene que esté en el spec y no solo en un comentario: la durabilidad de §5 no depende de que la búsqueda encuentre algo *hoy*. El caso que lo justifica es justamente el que motiva un `reanalyze` — el usuario cambia el idioma de OCR **porque** el texto no se estaba leyendo bien, y el valor aparece recién en la página re-OCR-eada. El costo aceptado es que un typo queda retenido hasta `closeDocument`, re-aplicándose sin encontrar nada. Es barato y acotado por documento; la alternativa —descartar lo que hoy da cero— rompería el caso que hace útil la retención.

### 7. La renumeración de ADR-028 no se toca

Agregar una entidad dispara `finishSession`, que re-corre la renumeración canónica: los índices reflejan siempre el orden de aparición documental, así que agregar una persona de la página 2 puede correr los números de todas las posteriores.

Se evaluó congelar los índices ya asignados y **se descartó** (decisión del humano): romper el invariante de ADR-028 haría que el orden de los marcadores dependa del orden en que el usuario fue agregando cosas, que es exactamente la arbitrariedad que ADR-028 vino a eliminar. El costo —ver saltar números mientras se agregan entidades— es visible pero acotado, y es el mismo que ADR-038 §5 (Q2) ya aceptó para el re-análisis.

### 8. La lupa del punto 4 es la misma primitiva

El buscador tipo Ctrl+F sobre el documento (`Cambios para hacer.txt` punto 4) es **la misma búsqueda literal de §1 y §2** con otra UI encima: en vez de emitir `ENTITY_FOUND`, devuelve los matches con sus bboxes para que el visor los resalte y navegue.

```ts
findText(documentId: string, query: string): ReadonlyArray<TextMatch>;
```

Se implementa en el mismo paso. Separarlo significaría escribir dos veces el mismo matcheo, y desde la búsqueda es natural ofrecer "agregar este resultado como entidad" — que es la tercera ruta de entrada, gratis.

> **Errata (2026-08-14, hallazgo del implementador del PR 3)**: "en vez de emitir `ENTITY_FOUND`, devuelve los matches" describía un motor que no existía. `findLiteral` —el único método que hace este matcheo— **no tiene esa segunda forma**: expone su resultado únicamente emitiendo sobre `ctx.bus`, y exige un `entityType` que una búsqueda de texto no tiene. La decisión de §8 no cambia (un solo matcher, dos salidas); lo que faltaba era la salida de solo-lectura.
>
> 1. **Por qué no se podía cablear igual.** Llamar a `findLiteral` desde `findText` sobre el bus real haría que **buscar texto mute la sesión**: cada coincidencia entra a Grouping como `ENTITY_FOUND` y crea o fusiona grupos. Un usuario tipeando en la lupa anonimizaría el documento sin pedirlo. No es un problema de estilo — es el peor modo de falla posible en esta herramienta, y por eso el PR 3 dejó `findText` fuera de `IPipelineOrchestrator` en vez de improvisar.
> 2. **La resolución: `regex-engine` gana `searchText(input): ReadonlyArray<TextMatch>`**, de solo lectura — sin `entityType`, sin `ctx`, sin tocar el bus ni el registro de patrones, sin mutar nada. Es la primitiva; `findLiteral` pasa a **construirse encima de ella** (mapea cada `TextMatch` a `Occurrence` y emite). Recién con eso "es la misma búsqueda literal con otra UI encima" describe el código: un matcher, dos envoltorios.
> 3. **`TextMatch` ya alcanza para las dos salidas.** `{ pageIndex, bbox, text, wordSpan }` cubre todo lo que `Occurrence` toma del match; lo que falta lo pone `findLiteral` y no depende del matcheo — el `id` que genera, `source: Manual` y `confidence: 1.0` que son constantes del agregado manual, el `entityType` que viene del usuario, y el `normalizedValue` que sale de `text`. Por eso la primitiva devuelve `TextMatch` y no un tipo intermedio nuevo: el que **agrega** información es `findLiteral`, no al revés.
> 4. **Sincrónica, y eso importa.** `Contracts.md` §3.5 declara `findText(documentId, query): ReadonlyArray<TextMatch>` **sin `Promise`**, y el matcheo es cómputo sincrónico sobre el `Document` en memoria —`findLiteral` ya lo documenta así—. `searchText` es sincrónica para que ese contrato se pueda cumplir tal como está escrito. `findLiteral` **conserva su `Promise<RegexEngineOutput>`**: es contrato público ya mergeado y R-2 no admite romperlo por prolijidad.
> 5. **Sin `ctx`, con guardas.** No lleva `EngineContext` porque no tiene qué hacer con sus tres piezas: `bus` es justamente lo que no debe tocar, `abortSignal` no significa nada en una llamada sincrónica, y **no debe loguear**: la query es texto que el usuario está buscando en un documento sensible, mismo criterio que ADR-061 §1 aplica al `value` de `findLiteral` (`Contracts.md` §3.3). Sí conserva las guardas de ciclo de vida (`dispose`/`init`), que lanzan **sincrónicamente**, a diferencia de `findLiteral` que rechaza la promesa.
> 6. **La cancelación por página se queda donde estaba.** La primitiva compartida es **por página** (`collectPageTextMatches`), no por documento: cada llamador arma su propio recorrido. `findLiteral` conserva su chequeo de `abortSignal` entre páginas; `searchText` no lo necesita. Extraer un núcleo por documento habría borrado ese chequeo en silencio.
> 7. **La tercera vía de agregado no estrena API.** "Agregar este resultado como entidad" es `addManualEntity(documentId, { value: match.text, entityType })` — el camino de §6, sin nada nuevo. Y **agrega todas las apariciones del valor, no solo la que el usuario clickeó**, porque `findLiteral` vuelve a recorrer el documento entero: es el comportamiento correcto (una entidad manual se anonimiza en todo el documento) y conviene que la UI lo diga.

### 9. Alcance: seis PRs

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 1 | `wordsInRect`, `TextMatch`, `ManualEntityRequest`; tipos de los accesores | `shared` | — |
| 1b | **Docs de la errata de §2**: esta errata, `Contracts.md` §6, `Regex_Engine.md` §6/§13/§14/§15, y los ítems de checklist de los tres consumidores que migran | — (docs) | — |
| 1c | `sharesVerticalBand` y `normalizeForComparison` (errata de §2, puntos 2 y 4) | `shared` | 1b |
| 2 | `findLiteral` + matcheo de secuencias de palabras normalizado (§1, §2), consumiendo las dos primitivas de `shared` | `regex-engine` | 1, 1c |
| 3 | `addManualEntity`, `getPageWords`, `getPageSize`; retención de literales manuales y su re-aplicación (§4, §5, §6). De paso, `line-words.ts` consume `sharesVerticalBand` de `shared` — mismo módulo, no rompe R-1. **`findText` no entró**: ver la errata de §8 | `packages/anonymization-core/src` | 1, 1c, 2 |
| 3b | **Docs de la errata de §8**: esta errata, `Regex_Engine.md` §6/§12/§13/§14/§15 y el ítem 24c del Orchestrator | — (docs) | — |
| 3c | `searchText` de solo lectura, y `findLiteral` reconstruido encima de la misma primitiva por página (errata de §8) | `regex-engine` | 3b |
| 3d | `findText` entra a `IPipelineOrchestrator` sobre `searchText`; se borra la nota de ausencia de `types.ts` | `packages/anonymization-core/src` | 3c |
| 4 | Botón + diálogo "Agregar entidad" sobre el árbol (ruta A, §3). **Mergeó parcial**: sin el feedback de "no se encontró", que no era implementable — ver la errata de §6 | `apps/react-client` | 3 |
| 4b | **Docs de la errata de §6**: esta errata, `Contracts.md` §3.5 (`ManualEntityResult`), el ítem 24d del Orchestrator y `Components.md` §3.4c | — (docs) | — |
| 4c | `addManualEntity` devuelve `ManualEntityResult` (errata de §6) | `packages/anonymization-core/src` | 4b |
| 4d | Cierra el PR 4: el diálogo lee `occurrenceCount` e informa "no se encontró", con el test que §10 pide | `apps/react-client` | 4c |
| 5 | Hit-test sobre el canvas del `original` + "Agregar entidad como…" (ruta B, §3, §4) | `apps/react-client` | 3 |
| 6 | Lupa de búsqueda con navegación y resaltado (§8) | `apps/react-client` | 3d |
| 7 | De-dup: el kernel consume `sharesVerticalBand` de `shared` y borra su copia local (errata de §2, punto 5) | `render-engine` | 1c |
| 8 | De-dup: `gender.ts` consume `normalizeForComparison` de `shared` y borra `normalizeForLexicon` (errata de §2, punto 5) | `grouping-engine` | 1c |

Los PRs 4, 5 y 6 dejaron de ser los tres paralelos que este ADR planeaba: cada uno destapó una entrada del Core que faltaba, y cada una se resolvió en la errata de su sección.

- **El 5 sí es libre** una vez mergeado el 3: el hit-test sobre el `original` ya tiene todo lo que necesita (`getPageWords`/`getPageSize`).
- **El 4 mergeó parcial y lo cierra el 4d** (errata de §6): el botón y el diálogo están, pero sin el retorno de `addManualEntity` no podían informar "no se encontró", que es un test obligatorio de §10. Hasta que el 4d caiga, **el hito no está cerrado aunque la UI se vea completa**: un valor mal escrito no dice nada y el usuario se queda creyendo que agregó algo.
- **El 6 espera al 3d** (errata de §8): la lupa necesita `findText`, que necesita `searchText`.

El 4c y el 3d son independientes entre sí, así que las dos cadenas pueden correr en paralelo.

**El 1b y el 1c son precondición del 2**, y salen de la errata de §2: sin ellos `regex-engine` no tiene de dónde importar la primitiva de línea sin duplicarla. El 1b va primero por R-2/R-19 (contrato antes que código) y porque `Contracts.md` §10 regla 1 exige declarar todo tipo o función pública ahí antes que en `shared/src/`.

**El 4b y el 4c salen de la errata de §6**, y son la única vía al PR 4. El 4b va primero por R-2/R-19: cambiar el retorno de `addManualEntity` es contrato de `IPipelineOrchestrator`, y no se toca desde un PR de UI. El 4c **no** necesita un PR de `shared`: `ManualEntityResult` vive en el façade (punto 5 de la errata).

**El 3b, 3c y 3d salen de la errata de §8** y son la única vía al PR 6. El 3b va primero por R-2/R-19: `searchText` es entrada pública nueva de `regex-engine`, y el spec del motor no se edita desde un PR de implementación (R-21). El 3c y el 3d van separados porque son módulos distintos (R-1).

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

`regex-engine` (PR 3c, errata de §8):

- Contract: `searchText` **no emite ningún evento** — con un bus espía, cero emisiones para una query que sí tiene coincidencias. Es el test del modo de falla que la errata evita: si `searchText` emitiera, buscar texto anonimizaría el documento.
- Contract: `searchText` no toca el registro de patrones ni ningún estado del motor; llamarla dos veces con el mismo input da el mismo resultado (es pura salvo por las guardas).
- Unit: `searchText` y `findLiteral` encuentran **exactamente las mismas coincidencias** sobre el mismo documento y valor — mismos `pageIndex`, `bbox` y `wordSpan`. Es lo que aserta que hay **un solo matcher** y no dos que pueden divergir (§8).
- Unit: los `TextMatch` vienen en orden documental (página ascendente, y dentro de la página en orden de lectura).
- Edge: query vacía o de solo espacios → array vacío, sin error.
- Edge: `searchText` tras `dispose` lanza **sincrónicamente** `EngineDisposedError` (no devuelve una promesa rechazada, a diferencia de `findLiteral`).

`packages/anonymization-core/src` (PR 3):

- Contract: `addManualEntity` produce un grupo nuevo visible en el snapshot de Grouping.
- Contract: agregar un valor **ya detectado** no duplica — se fusiona por el dedup de ADR-038 §3.
- Contract: agregar dos veces el mismo valor es idempotente.
- Unit: **tras un `reanalyze` que descarta las páginas afectadas, los literales manuales se re-aplican** (§5). Es el test del modo de falla silencioso; sin él, el bug vuelve sin que ninguna suite lo note.
- Unit: `getPageWords`/`getPageSize` sobre `documentId` o `pageIndex` inexistente → `InvalidInputError`.
- Unit: la lista de literales se descarta en `closeDocument`.

`packages/anonymization-core/src` (PR 4c, errata de §6):

- Contract: `addManualEntity` con un valor **ausente** del documento devuelve `occurrenceCount: 0`, **sin lanzar** y sin crear grupo. Es el test que hace implementable el mensaje "no se encontró".
- Contract: con un valor **presente N veces** devuelve `occurrenceCount: N`, contando las apariciones en el documento — también cuando todas se fusionan por dedup en un grupo existente y el árbol no cambia (punto 3 de la errata).
- Unit: el literal se retiene **también** cuando devolvió `0`, y un `reanalyze` posterior que lo hace aparecer lo encuentra (punto 6 de la errata). Es el test de la decisión de retener antes de buscar.

`packages/anonymization-core/src` (PR 3d, errata de §8):

- Contract: **`findText` no altera el snapshot de Grouping** — se toma el snapshot, se buscan varias queries con coincidencias, se vuelve a tomar y es idéntico. Es el test de que buscar no anonimiza; sin él, la regresión que la errata de §8 describe vuelve sin que nada la note.
- Unit: `findText` devuelve los mismos matches que `regex.searchText` sobre el documento retenido, incluidas páginas con palabras de OCR.
- Unit: `findText` sobre un `documentId` inexistente → `InvalidInputError`, igual que `getPageWords`/`getPageSize`.

`apps/react-client` (PRs 4-6):

- Unit: el diálogo emite `addManualEntity` con el tipo y valor elegidos.
- Unit: el hit-test solo se ofrece sobre el panel `original` (§3).
- Unit: la traducción de coordenadas de pantalla a coordenadas de página usa `getPageSize` y no la estimación de `pageLayout.ts`.
- Unit: valor sin coincidencias → mensaje al usuario, sin grupo nuevo. Se apoya en el `occurrenceCount: 0` del retorno (errata de §6); el diálogo lee `0` vs `> 0` y nada más.

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
| **`findLiteral` con un flag `emit: false`** (errata de §8) | Un parámetro que apaga el efecto principal del método deja una firma que miente: el nombre dice "encontrá y reportá" y la mitad de las llamadas no reportan. Y arrastra el `entityType` obligatorio a un caller que no tiene ninguno, obligando a inventar un valor de relleno que después viaja adentro de `Occurrence`. La separación en dos entradas —una que devuelve, otra que emite— cuesta lo mismo y no miente. |
| **Capturar los `ENTITY_FOUND` con un bus efímero** (errata de §8) | "Llamar a `findLiteral` con un bus descartable y leer lo emitido" evita el efecto sobre Grouping, pero convierte una consulta en una corrida de motor con un bus falso: hay que construir un `EngineContext` completo por búsqueda, y el resultado depende de que ningún otro suscriptor esté enganchado a ese bus. Ningún doc especifica esa maniobra, y sería el único lugar del Core donde un valor de retorno se obtiene escuchándose a sí mismo. |
| **Lanzar cuando no hay coincidencias** (errata de §6) | Convierte un resultado esperado en una excepción: la UI necesitaría `try/catch` para el camino normal de "escribiste algo que no está", y ese error quedaría mezclado con los `InvalidInputError` de documento inexistente o stage inválido, que sí son fallos. §6 ya había decidido que cero no es un error; esto lo contradecía. |
| **Un evento `MANUAL_ENTITY_ADDED` en vez de un retorno** (errata de §6) | El único interesado es quien llamó. Un evento obliga al diálogo a suscribirse, correlacionar por `documentId` y decidir cuánto esperar antes de asumir que no llegó — porque el caso de cero coincidencias es precisamente el que **no** produce ningún otro evento. Un retorno no tiene ni correlación ni timeout. Los eventos del Core son para difundir cambios de estado a varios oyentes; éste es el resultado de una llamada. |
| **Que la UI lo infiera del árbol de grupos** (errata de §6) | "Si no apareció un grupo nuevo, no se encontró" es falso por el dedup de ADR-038 §3 —un valor ya detectado se fusiona sin crear nada— y además es una carrera contra la llegada de los eventos de Grouping. Daría "no se encontró" sobre entidades que sí están cubiertas. |
| **Implementar `findText` host-side sobre `Page.words`** (errata de §8) | Es la misma alternativa que la fila de arriba sobre el matcheo host-side, y se rechaza por lo mismo, agravado: además de reimplementar la normalización y el criterio de línea, produciría **dos matchers que pueden divergir** — la lupa encontraría cosas que el agregado manual no, sobre la misma query. La promesa de §8 es exactamente que sea un solo matcher. |
| **No retener los literales manuales** | Modo de falla silencioso: un `reanalyze` posterior borra las ocurrencias manuales de las páginas afectadas y el dato se exporta sin anonimizar, sin ningún aviso (§5). |

## Consecuencias

**Positivas**: se cierra un agujero de completitud del producto — hasta hoy, lo que el detector no encontraba no tenía ninguna vía de corrección, sobre un pipeline cuyo propio roadmap admite que el recall del NER no es un gate en MVP; la mayor parte del trabajo pesado ya existía (`mapSpanToWords`, `DetectionSource.Manual`, `reopenSession`, dedup por identidad), así que el código nuevo es sobre todo cableado y UI; el hit-test contra palabras funciona idéntico en PDFs digitales y escaneados, sin una sola rama; se cierra de paso el hueco de dimensiones de página estimadas que arrastraba `pageLayout.ts`; y el buscador del punto 4 sale de la misma primitiva, con la búsqueda como tercera vía de agregado.

**Negativas**: la búsqueda exacta no encuentra variantes, así que un mismo dato escrito de dos formas exige dos agregados manuales (§2) — limitación conocida, anotada en `Future_Ideas.md`; cada agregado dispara `finishSession` y puede correr los índices de los grupos que el usuario ya vio (§7), lo que se hace notorio al agregar varias entidades seguidas; el Orchestrator gana estado retenido por documento (la lista de literales), que hay que limpiar en `closeDocument`/`dispose`; y el cliente pasa a manejar coordenadas de página, con la complejidad de mapeo que eso implica en un visor con zoom.

**Neutras**: ADR-011 se respeta — el grupo sigue siendo la unidad de operación, y una entidad manual produce un grupo como cualquier otra. ADR-028 y ADR-038 no cambian: este ADR **consume** su maquinaria sin modificarla. `DetectionSource.Manual` deja de ser un valor sin productores. El modelo de seguridad no se toca: nada sale del navegador y no hay superficie nueva de red.

## Docs actualizados por este ADR

- `core/Regex_Engine.md` → v1.1.0: `findLiteral` (§6), casos límite y tests. → v1.3.0 por la errata de §2: de dónde salen las dos primitivas, caso límite 16 y su test. → v1.4.0 por la errata de §8: `searchText` (§6, §7), su costo interactivo (§12), casos 20-24 y el ítem 10c.
- `core/Orchestrator.md` → v1.7.0: `addManualEntity`, `findText`, `getPageWords`, `getPageSize`, retención de literales manuales. Ítems 24, 24b y 24c del checklist: las tres entradas del PR 3, `line-words.ts` consumiendo `sharesVerticalBand` (errata de §2), y `findText` sobre `searchText` en el PR 3d (errata de §8).
- `core/Contracts.md` §3.5 (`IPipelineOrchestrator`), §6 — y `architecture/03_Data_Model.md` (`TextMatch`, `ManualEntityRequest`). §6 gana además `sharesVerticalBand` y `normalizeForComparison` por la errata de §2; §3.5 gana `ManualEntityResult` y el retorno de `addManualEntity` por la errata de §6.
- `core/Grouping_Engine.md` §13 — el caso de ocurrencia manual que se fusiona con un grupo existente. Ítem 15l: `gender.ts` consume `normalizeForComparison` (errata de §2, PR 8).
- `core/Render_Engine.md` — ítem 28: el kernel consume `sharesVerticalBand` de `shared` (errata de §2, PR 7).
- `ui/Components.md` y `ui/UX_Guidelines.md` — botón y diálogo de agregado, interacción de selección sobre el `original`, lupa de búsqueda. §5.4c gana el debounce de la caja de búsqueda y el copy de que agregar desde un resultado alcanza a todas las apariciones (errata de §8); §3.4c, cómo el diálogo lee `occurrenceCount` y qué significa el número (errata de §6).
- `roadmap/MVP.md` §4 — bloque del Hito 10.7; §6 — riesgo de la búsqueda exacta.
- `roadmap/Future_Ideas.md` — la búsqueda difusa de variantes como trabajo futuro (§2).

## Validación

- Los tests de §10 verdes, en particular los tres que protegen decisiones que se rompen fácil: **`"J. Pérez"` no matchea `"José Pérez"`** (§2), **un valor cuyas palabras cruzan de una línea a la siguiente no matchea** (errata de §2) y **los literales manuales sobreviven a un `reanalyze`** (§5).
- El test de que **buscar no anonimiza**: `searchText` no emite nada, y `findText` deja el snapshot de Grouping idéntico (errata de §8, §10). Es el par que protege contra la regresión más cara de este ADR — un usuario tipeando en la lupa no puede modificar el documento.
- Grep de control de la errata de §2, sobre `packages/`: `function sharesVerticalBand` y `u0300` —la huella de la normalización, que es lo que hay que grepear porque la copia existente se llama distinto (`normalizeForLexicon`)— aparecen **una sola vez cada uno**, en `shared/src/`. Con los PRs 7 y 8 pendientes hay **exactamente una copia extra de cada uno** —`render-engine/src/worker/kernel.ts` y `grouping-engine/src/gender.ts`—, y ninguna otra.
- Verificación manual E2E: importar un PDF con un nombre que el NER no detecta, agregarlo por cada una de las tres vías (diálogo, selección sobre el original, resultado de búsqueda), y confirmar que aparece anonimizado en el preview y en el export.
- Repetir sobre un PDF **escaneado**: es donde el hit-test justifica su elección frente a la capa de texto.
- Grep de control: `pdfjs-dist` no aparece en `apps/react-client` (§4).
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, más `pnpm test:e2e`.

## Referencias

- `core/Regex_Engine.md` §6 — `core/Orchestrator.md` §2, §6 — `core/Grouping_Engine.md` §13 — `core/Contracts.md` §3.5, §5 — `architecture/03_Data_Model.md`
- `adr/ADR-011` — `adr/ADR-028` — `adr/ADR-038` §2-§5 — `adr/ADR-041` — `adr/ADR-058` §5
- Código: `packages/anonymization-core/regex-engine/src/regex.engine.ts` (`mapSpanToWords`, `addPattern`) — `packages/anonymization-core/src/orchestrator.ts` — `packages/anonymization-core/shared/src/enums.ts` (`DetectionSource.Manual`) — `apps/react-client/src/components/viewer/PageCanvas.tsx` — `apps/react-client/src/components/viewer/pageLayout.ts` — `apps/react-client/src/store/document.store.ts`
