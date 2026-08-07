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
| 2 | `findLiteral` + matcheo de secuencias de palabras normalizado (§1, §2) | `regex-engine` | 1 |
| 3 | `addManualEntity`, `findText`, `getPageWords`, `getPageSize`; retención de literales manuales y su re-aplicación (§4, §5, §6, §8) | `packages/anonymization-core/src` | 1, 2 |
| 4 | Botón + diálogo "Agregar entidad" sobre el árbol (ruta A, §3) | `apps/react-client` | 3 |
| 5 | Hit-test sobre el canvas del `original` + "Agregar entidad como…" (ruta B, §3, §4) | `apps/react-client` | 3 |
| 6 | Lupa de búsqueda con navegación y resaltado (§8) | `apps/react-client` | 3 |

Los PRs 4, 5 y 6 son independientes entre sí y pueden correr en paralelo una vez mergeado el 3.

### 10. Tests

`shared` (PR 1):

- Unit: `wordsInRect` es pura; devuelve las palabras cuyo bbox intersecta la región, y ninguna otra.
- Edge: región vacía, región fuera de página, región que corta una palabra por la mitad (se incluye).

`regex-engine` (PR 2):

- Contract: `findLiteral` emite `ENTITY_FOUND` con `source: DetectionSource.Manual` y bbox correcto por ocurrencia.
- Contract: **no emite `REGEX_FINISHED`** ni altera el registro de patrones — no es una corrida de detección (§1).
- Unit: matchea insensible a mayúsculas y acentos ("JOSE PEREZ" encuentra "José Pérez").
- Unit: valor multi-palabra matchea sobre `Word` contiguas de la misma línea (§2).
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

- `core/Regex_Engine.md` → v1.1.0: `findLiteral` (§6), casos límite y tests.
- `core/Orchestrator.md` → v1.7.0: `addManualEntity`, `findText`, `getPageWords`, `getPageSize`, retención de literales manuales.
- `core/Contracts.md` §3.5 (`IPipelineOrchestrator`), §6 — y `architecture/03_Data_Model.md` (`TextMatch`, `ManualEntityRequest`).
- `core/Grouping_Engine.md` §13 — el caso de ocurrencia manual que se fusiona con un grupo existente.
- `ui/Components.md` y `ui/UX_Guidelines.md` — botón y diálogo de agregado, interacción de selección sobre el `original`, lupa de búsqueda.
- `roadmap/MVP.md` §4 — bloque del Hito 10.7; §6 — riesgo de la búsqueda exacta.
- `roadmap/Future_Ideas.md` — la búsqueda difusa de variantes como trabajo futuro (§2).

## Validación

- Los tests de §10 verdes, en particular los dos que protegen decisiones que se rompen fácil: **`"J. Pérez"` no matchea `"José Pérez"`** (§2) y **los literales manuales sobreviven a un `reanalyze`** (§5).
- Verificación manual E2E: importar un PDF con un nombre que el NER no detecta, agregarlo por cada una de las tres vías (diálogo, selección sobre el original, resultado de búsqueda), y confirmar que aparece anonimizado en el preview y en el export.
- Repetir sobre un PDF **escaneado**: es donde el hit-test justifica su elección frente a la capa de texto.
- Grep de control: `pdfjs-dist` no aparece en `apps/react-client` (§4).
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, más `pnpm test:e2e`.

## Referencias

- `core/Regex_Engine.md` §6 — `core/Orchestrator.md` §2, §6 — `core/Grouping_Engine.md` §13 — `core/Contracts.md` §3.5, §5 — `architecture/03_Data_Model.md`
- `adr/ADR-011` — `adr/ADR-028` — `adr/ADR-038` §2-§5 — `adr/ADR-041` — `adr/ADR-058` §5
- Código: `packages/anonymization-core/regex-engine/src/regex.engine.ts` (`mapSpanToWords`, `addPattern`) — `packages/anonymization-core/src/orchestrator.ts` — `packages/anonymization-core/shared/src/enums.ts` (`DetectionSource.Manual`) — `apps/react-client/src/components/viewer/PageCanvas.tsx` — `apps/react-client/src/components/viewer/pageLayout.ts` — `apps/react-client/src/store/document.store.ts`
