<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Export_Engine.md,architecture/03_Data_Model.md,architecture/08_Security_Model.md,adr/ADR-004-Rendering.md,adr/ADR-009-Export-Strategy.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-047-ExportEngine-Ensamblador-Worker-Dedicado.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md | audiencia=humanos+IA | fase=10.5 -->

# ADR-059 — Leyenda opcional de marcadores en el export

- **Estado**: Accepted
- **Fecha**: 2026-08-06
- **Decidido por**: El humano, al elegir el nivel 3 de la escalera de abreviaturas de ADR-057 y pedir que el usuario pueda decidir si la leyenda viaja o no: *"Opcional, que decida el usuario. Por más que quiero hacer más explicativa la UI, siento que esta opción agrega bastante valor"*.
- **Relacionado con**: ADR-057 (la escalera que hace necesaria la leyenda), ADR-004 y ADR-009 (las garantías del export, que este ADR **no** relaja — ver §2), ADR-012 (el modo `placeholder`), ADR-047 (el ensamblador con estado del ExportWorker, donde se inserta la página)
- **Parte de**: Hito 10.5, paso 4

> Convención de citas: `ADR-059 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-059, Contexto §N`.

## Contexto

### 1. La escalera introduce tokens que no se leen solos

Con ADR-057, un documento apretado puede exportarse con `[MAT-01]` y `[PAT-02]` en la misma página. `MAT` es matrícula y `PAT` es patente, y no hay forma de que el lector lo sepa: son dos siglas de tres letras, del mismo largo, sobre el mismo tipo de dato administrativo. Lo mismo con `ORG` y `DIR`, o `TRJ` y `TEL`.

En el nivel 0 el problema no existía (`[MATRICULA 01]` se lee solo). Es una consecuencia directa de ADR-057 y hay que hacerse cargo de ella.

### 2. Pero en documentos simples la leyenda es decoración

Un documento con dos tipos de entidad y tokens en nivel 0 no necesita ninguna referencia: `[PERSONA 01]` es autoexplicativo. Agregarle una página final es ruido, y en contextos donde la paginación importa —un expediente, un anexo numerado— es peor que ruido.

De ahí que sea opcional y no automática.

### 3. La tentación que hay que cerrar por diseño, no por disciplina

La leyenda que un usuario va a pedir tarde o temprano es la que dice `[PRS-01] = Ana Gómez`. Es la versión útil para quien tiene que trabajar con el documento anonimizado y el original a la vez.

Y es exactamente la que destruye el producto: pondría los valores originales dentro del archivo cuya razón de existir es no tenerlos, y haría fallar el test `no-recuperability` de ADR-009 en el acto.

ADR-009 ya resolvió una tentación análoga —`includeOriginalMetadata`— haciéndola imposible **por tipo**, no por convención: el campo es literalmente `false` y no se puede activar. Este ADR usa el mismo mecanismo (§4).

### 4. `export-engine` no tiene canvas

Sus dependencias permitidas son `pdf-lib` y `@anonly/shared`. No puede rasterizar nada: las imágenes de página le llegan ya codificadas desde Render vía `RenderPageProvider` (ADR-032, ADR-034 §3). Cualquier decisión sobre cómo se dibuja la leyenda tiene que resolverse dentro de esa restricción o inventar un camino nuevo entre motores.

## Decisión

### 1. `ExportOptions.includeMarkerLegend`, default `false`

```ts
export interface ExportOptions {
  // …campos actuales…
  readonly includeMarkerLegend: boolean;   // default false
}
```

Se expone como checkbox en el diálogo de export. Default apagado: el comportamiento de todos los exports existentes no cambia salvo que el usuario lo pida.

### 2. Contenido: **prefijo → tipo**, con el conteo. Nunca un valor original

Una fila por `EntityType` presente en el documento, listando los **prefijos efectivamente usados** —que pueden ser varios, porque ADR-057 elige el nivel por grupo y dos grupos del mismo tipo pueden quedar en niveles distintos— y el nombre del tipo:

```
Anonimizado con Anonly — Referencia de marcadores

  PERSONA, PERS, PRS      Persona                    7 marcadores
  DNI                     DNI                        3 marcadores
  MATR, MAT               Matrícula                  1 marcador
  PATE, PAT               Patente                    2 marcadores
```

Decisiones de forma, y por qué:

- **Se listan prefijos, no la enumeración de tokens.** Lo que el lector no puede deducir es qué significa `MAT`; el número lo tiene delante en el documento. Enumerar `[PRS-01] … [PRS-07]` alarga la página sin agregar información.
- **El nombre del tipo es el label de nivel 0 de ADR-057 §2, en capitalización de título.** No se inventa una cuarta tabla de nombres: la de nivel 0 ya es el nombre humano canónico y está ratificada.
- **Una sola página, siempre.** El número de filas está acotado por la cardinalidad de `EntityType` (13). No hay caso de leyenda multipágina y no hay que escribir paginación.
- **Solo grupos en modo `placeholder` y solo `enabled`.** Los otros modos no producen marcadores identificables: el `mask` de todos los DNI del documento es el mismo `XX.XXX.XXX`, listarlo no dice nada; `synthetic` produce valores que se leen como datos reales, y `redact` no produce nada. Si tras el filtro no queda ninguna fila, **no se agrega página** y se loguea un `warn` — no una página en blanco.

### 3. La imposibilidad de filtrar el valor original se garantiza **por tipo**

El constructor de la leyenda no recibe grupos: recibe pares tipo/índice.

```ts
/** Entrada de leyenda. NO tiene acceso a canonicalValue ni a ningún dato del documento. */
export interface MarkerLegendEntry {
  readonly type: EntityType;
  readonly prefixes: ReadonlyArray<string>;
  readonly markerCount: number;
}

export function buildMarkerLegend(
  entries: ReadonlyArray<MarkerLegendEntry>,
): ReadonlyArray<MarkerLegendRow>;
```

`MarkerLegendEntry` no tiene ningún campo capaz de transportar contenido del documento. Filtrar un valor original a la leyenda no requiere disciplina del implementador: requiere cambiar este tipo, que es un cambio de contrato con ADR propio. Mismo mecanismo que `includeOriginalMetadata: false` en ADR-009 (Contexto §3).

La proyección `EntityGroup[] → MarkerLegendEntry[]` vive host-side, en el mismo lugar donde ya se proyectan los grupos para el export.

### 4. La leyenda se **rasteriza**, como cualquier otra página

**El export sigue siendo 100% imagen, sin una sola excepción.** La leyenda se renderiza a un `EncodedPageImage` y se embebe con `embedPng`/`embedJpg` + `addPage` + `drawImage`, exactamente igual que una página del documento.

**Por qué, si dibujarla con `drawText` de pdf-lib era mucho más barato.** Porque "el export es 100% imagen" es una propiedad **auditable en un segundo**: se abre el PDF, se intenta seleccionar texto, no hay nada. Con una capa de texto —aunque su contenido sea demostrablemente seguro por §3— auditar pasa a ser "¿el texto de esa página es seguro?", que es un juicio en vez de una verificación. Para un archivo que circula fuera del control del usuario y puede terminar en manos de una contraparte legal o un auditor, esa diferencia vale más que el ahorro de implementación. Decisión explícita del humano.

Consecuencias directas y buenas de esta elección:

- **ADR-004 y ADR-009 quedan intactos, sin erratas ni precisiones.** No hace falta explicarle a nadie qué página se comporta distinto, porque ninguna se comporta distinto.
- No hay que razonar caso por caso sobre qué puede entrar en una capa de texto: no hay capa de texto.
- El test `no-recuperability` cubre el export entero con el mismo criterio de siempre.

Lo que se pierde: la tabla de referencia no se puede copiar ni buscar. Son 13 filas como máximo (§2) y el lector puede transcribirlas; se acepta.

### 5. El camino de la imagen: `RenderPageProvider`, no un canal nuevo

`export-engine` no tiene canvas (Contexto §4) y el único motor que rasteriza es `render-engine`, que además vive en otro worker. Pero **el puerto por el que Export ya le pide imágenes a Render existe**: `RenderPageProvider`, implementado por el Orchestrator, que es quien tiene permitido hablarle a los dos motores (P-1).

Se extiende ese puerto en vez de inventar un camino:

```ts
export interface RenderPageProvider {
  renderFull(pageIndex, replacements, abortSignal): Promise<EncodedPageImage>;
  // ADR-059 §5
  renderLegend(rows: ReadonlyArray<MarkerLegendRow>, abortSignal): Promise<EncodedPageImage>;
}
```

Y `RenderEngine` gana el método público que lo respalda:

```ts
renderLegendPage(
  rows: ReadonlyArray<MarkerLegendRow>,
  pageWidthPt: number,
  pageHeightPt: number,
  ctx: EngineContext,
): Promise<EncodedPageImage>;
```

Notas de forma que lo mantienen barato:

- **`MarkerLegendRow` son strings ya compuestos**, no `EntityType`. El kernel de Render dibuja texto y no sabe nada de tipos de entidad ni de grupos — la proyección y el armado de filas quedan del lado de Export/host, donde ya viven. `render-engine` no gana ninguna dependencia semántica nueva.
- **No necesita documento cargado.** Es un dibujo puro sobre un `OffscreenCanvas` en blanco: sin `pageProxy`, sin pdfjs, sin cache LRU, sin eventos — mismo perfil que `rasterizePage` (ADR-034 §1), que ya estableció el precedente de "render sin efectos".
- El layout es una tabla de hasta 13 filas a `y` incremental con columnas a `x` fijas. No hay salto de línea ni paginación (§2).
- Cruza al RenderWorker como `RenderLegendPayload` bajo `jobType: "render-page"`, **sin agregar un `WorkerJobType` nuevo** (mismo criterio que ADR-036 §4 y ADR-047 §3). El entry-point lo discrimina por forma, sumando un quinto caso al orden estricto de ADR-043 §4.

### 6. Se agrega al final, en el `save`

El `EncodedPageImage` viaja en `ExportSavePayload` y el assembler lo embebe dentro de `savePdf`, **antes** de aplicar la metadata y serializar — con las mismas cuatro llamadas de pdf-lib que usa `appendPage`.

**No pasa por `appendPage`** aunque el dibujo sea idéntico: esa función es idempotente por `pageIndex` (ADR-047 §4) y la leyenda no tiene `pageIndex` — no es una página del documento. Meterla ahí obligaría a inventarle un índice sintético y a hacerla participar de una idempotencia que no le corresponde. `save` es donde ADR-047 §3 concentró todo lo que se aplica una sola vez al final, que es exactamente lo que esto es.

Consecuencia observable: con el flag activo, el PDF resultante tiene `document.pageCount + 1` páginas.

### 7. Alcance: cuatro PRs

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 2 | `ExportOptions.includeMarkerLegend`, `MarkerLegendEntry`, `MarkerLegendRow`, `RenderLegendPayload`, `ExportSavePayload` extendido — junto con los tipos de ADR-057 §8 y ADR-058 §9 | `shared` | — |
| 7 | `renderLegendPage` + `RenderLegendPayload` en el entry-point (§5) | `render-engine` | PR 2 |
| 8 | Proyección host-side, `buildMarkerLegend`, `RenderPageProvider.renderLegend` y su mediación, embebido en `savePdf` (§5, §6) | `export-engine` + `packages/anonymization-core/src` | PR 2, PR 7 |
| 9 | Checkbox en el diálogo de export | `apps/react-client` | PR 2 |

La numeración es la del Hito 10.5 completo (`roadmap/MVP.md` §4).

**El PR 8 toca dos módulos en el mismo diff** —el motor y el façade— y es una excepción acotada a R-1 con la misma justificación de forma que ADR-056 §7: `RenderPageProvider` es un **puerto de `export-engine` implementado por el Orchestrator**, así que agregarle un método no admite un estado intermedio verde (si el motor lo exige y el façade no lo implementa, `pnpm typecheck` se cae; y al revés también). Es el mismo par que ya viajó junto cuando el puerto nació (ADR-032/ADR-034 §3).

### 8. Tests

`render-engine` (PR 7):

- Contract: `renderLegendPage` devuelve un `EncodedPageImage` con las dimensiones pedidas, **sin emitir ningún evento y sin tocar el cache LRU** — mismo perfil que `rasterizePage` (ADR-034 §1).
- Contract: `renderLegendPage` **no requiere documento cargado**: funciona sin `loadDocument` previo, a diferencia de todo el resto del motor.
- Unit: N filas se dibujan a `y` incremental, con las columnas a `x` fijas; 13 filas entran en la página.
- Unit: el entry-point discrimina `RenderLegendPayload` por forma sin colisionar con los otros cuatro payloads de `render-page` (ADR-043 §4, quinto caso).

`export-engine` + façade (PR 8):

- Contract: con `includeMarkerLegend: false`, el PDF tiene exactamente `document.pageCount` páginas y **`renderLegend` no se invoca** — no-regresión de todos los exports existentes.
- Contract: con el flag activo y grupos `placeholder`, el PDF tiene `pageCount + 1`.
- Unit: la leyenda agrupa por tipo y lista los prefijos distintos usados por los grupos de ese tipo (§2), incluido el caso de niveles mixtos dentro del mismo tipo.
- Unit: grupos `mask`/`synthetic`/`redact` y grupos `enabled: false` no producen filas (§2).
- Unit: `MarkerLegendRow` llega al motor de render como **strings ya compuestos** — el kernel nunca ve un `EntityType` ni un `EntityGroup` (§5).
- Edge: flag activo sin ningún grupo `placeholder` → **no se agrega página**, `renderLegend` no se invoca, + `warn` (§2).
- Edge: los 13 tipos presentes → una sola página (§2).
- Edge: un fallo de `renderLegend` se trata como un fallo de página (retry + `EXPORT_FAILED`), no deja el PDF a medio ensamblar.

`tests/security/` (PR 8) — **el test que no puede faltar**:

- El buffer del export con la leyenda activa no contiene **ningún** `canonicalValue` de ningún grupo, ni ningún `originalValue` de ninguna ocurrencia. Mismo criterio y mismo dataset que el `no-recuperability` de ADR-009, corrido específicamente sobre el camino con leyenda.
- **Ninguna página del export contiene objetos de texto** (§4). Es la aserción que hace auditable la propiedad "100% imagen" en vez de dejarla como convención.

`apps/react-client` (PR 9):

- Unit: el checkbox refleja y propaga `includeMarkerLegend` en las `ExportOptions` emitidas.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Leyenda con el valor original (`[PRS-01] = Ana Gómez`)** | Destruye la razón de ser del producto y hace fallar `no-recuperability` (Contexto §3). No es una opción a ofrecer ni siquiera detrás de una advertencia: el archivo exportado circula fuera del control del usuario. Cerrado por tipo en §3. |
| **Leyenda siempre presente** | En documentos simples es ruido, y altera el conteo de páginas en contextos donde la paginación importa (Contexto §2). |
| **Leyenda nunca exportada, solo visible en el árbol de entidades** | Cero superficie nueva, pero el documento anonimizado viaja solo: quien lo recibe no tiene la app. La correspondencia tiene que poder viajar con él. |
| **Archivo aparte junto al PDF** | Mantiene el documento idéntico en estructura, pero se traspapela — que es justamente el escenario en que la leyenda hacía falta. El humano eligió que decida el usuario, y el checkbox cubre el caso "no la quiero" mejor que un segundo archivo cubre el caso "la quiero". |
| **Dibujar la leyenda con `drawText` de pdf-lib** | Era **mucho** más barato: `export-engine` ya tiene pdf-lib, son ~30 líneas dentro del assembler, cero contratos nuevos, cero comunicación entre motores. Y era demostrablemente seguro: su contenido no puede venir del documento (§3), y las seis garantías de ADR-009 seguían valiendo — lo único que dejaba de valer era una *consecuencia* que ADR-004 anotaba como costo del enfoque. **Se rechaza igual**, por decisión explícita del humano y por una razón que sobrevive al análisis: "el export es 100% imagen" es auditable en un segundo —se abre el PDF, se intenta seleccionar texto, no hay nada—, mientras que con una capa de texto auditar pasa a ser "¿el texto de esa página es seguro?", un juicio en vez de una verificación. Para un archivo que circula fuera del control del usuario, esa diferencia vale más que el ahorro. El beneficio que ofrecía —una tabla copiable y buscable— es real pero chico: son 13 filas transcribibles. |
| **Rasterizar la leyenda en `apps/react-client`, que sí tiene canvas DOM** | Pondría lógica del Core en la app y rompería que el export lo dirige el Orchestrator. Además el flujo de export no pasa por el árbol de componentes: `EXPORT_REQUESTED` lo consume el Orchestrator directamente (ADR-032 §2). |
| **Un canal nuevo entre Export y Render para la imagen de la leyenda** | Innecesario: `RenderPageProvider` ya es exactamente eso —el puerto por el que Export pide imágenes, implementado por el Orchestrator, que es el único autorizado a hablarle a los dos motores—. Agregarle un método reusa el patrón; inventar un canal duplicaría la mediación (§5). |
| **Pasar `MarkerLegendEntry` (con `EntityType`) al kernel de Render** | Le daría a `render-engine` una dependencia semántica sobre tipos de entidad y labels que hoy no tiene y no necesita. Se le pasan **filas de strings ya compuestas**: el kernel dibuja texto y nada más (§5). |
| **Enumerar todos los tokens (`[PRS-01] … [PRS-07]`)** | Alarga la página sin agregar información: el número ya está a la vista en el documento; lo que no se puede deducir es el prefijo (§2). |
| **Inventar nombres largos de tipo para la leyenda** | Una cuarta tabla de labels que mantener y traducir, cuando el nivel 0 de ADR-057 §2 ya es el nombre humano canónico y quedó ratificado ahí. |
| **Agregar la leyenda vía `appendPage`** | El dibujo es idéntico, pero esa función es idempotente por `pageIndex` y la leyenda no tiene uno: habría que inventarle un índice sintético y hacerla participar de una idempotencia que no le corresponde (ADR-047 §4). `save` es donde ADR-047 §3 puso todo lo que se aplica una vez al final (§6). |

## Consecuencias

**Positivas**: los tokens abreviados de ADR-057 dejan de ser crípticos para quien recibe el documento, sin obligar a nadie que no los necesite; **el export sigue siendo 100% imagen, sin excepciones ni erratas** — ADR-004 y ADR-009 quedan literalmente intactos y no hay que explicarle a nadie qué página se comporta distinto; la imposibilidad de filtrar valores originales queda garantizada por el sistema de tipos y no por la atención del implementador (§3); y el default apagado deja todos los exports existentes bit a bit iguales.

**Negativas**: el costo de implementación es sustancialmente mayor que la alternativa con `drawText` —un método público nuevo en `render-engine`, un payload que cruza el boundary del worker, un quinto caso en la discriminación por forma de ADR-043 §4, y código de layout de tabla en el kernel—, cuatro PRs en vez de dos; el PR 8 toca dos módulos en el mismo diff (§7); la tabla de referencia no se puede copiar ni buscar; el conteo de páginas del export deja de coincidir con el del original cuando el flag está activo, lo que puede sorprender en flujos que lo asumen; y se agrega una opción más a un diálogo que el humano ya quiere hacer más explicativo y no más denso (punto 3 de `Cambios para hacer.txt`) — asumido conscientemente al decidir que la opción "agrega bastante valor".

**Neutras**: `appendPage` y su idempotencia por `pageIndex` (ADR-047 §4) no se tocan; el retry/timeout por página y los cuatro eventos `EXPORT_*` quedan idénticos; la metadata del export (`producer`/`creator`/`creationDate`/`title`) no cambia; y `renderLegendPage` no participa del cache LRU, del supersede por escala ni de la emisión de `PREVIEW_UPDATED`, igual que `rasterizePage`.

## Docs actualizados por este ADR

- `architecture/03_Data_Model.md` §18 (`ExportSavePayload` con la imagen de la leyenda, `MarkerLegendEntry`, `MarkerLegendRow`, `RenderLegendPayload`), §19 (`ExportOptions.includeMarkerLegend`).
- `core/Export_Engine.md` → v1.3.0: nota de cabecera, §6 (`RenderPageProvider.renderLegend`), §9, §13 (casos nuevos), §14, §15.
- `core/Render_Engine.md` → v1.10.0: nota de cabecera, §2, §6 (`renderLegendPage`), §13, §14, §15.
- `core/Orchestrator.md` — la mediación de `renderLegend` entre Export y Render.
- `architecture/05_Worker_Architecture.md` §7.4 — el quinto payload de `render-page` y su lugar en el orden de discriminación por forma.
- `architecture/08_Security_Model.md` §9.1 — qué divulga la leyenda y qué no.
- `ui/Components.md` y `ui/UX_Guidelines.md` — el checkbox en el diálogo de export.
- `roadmap/MVP.md` §4 — bloque del Hito 10.5, paso 4.

> **`adr/ADR-004-Rendering.md` no se toca.** Una versión anterior de este ADR dibujaba la leyenda con `drawText` y anotaba allá una errata sobre "el PDF resultante no tiene texto seleccionable". Con la leyenda rasterizada (§4), esa consecuencia **sigue valiendo tal como está escrita** y la errata se retira.

## Validación

- Los tests de §8 verdes, en particular los dos de `tests/security/`.
- Verificación de no-regresión: con el flag apagado, el export de un documento de referencia produce el mismo `sizeBytes` y el mismo conteo de páginas que antes de este ADR.
- Inspección manual del PDF con leyenda: abrir en un visor e **intentar seleccionar texto en cualquier página, incluida la leyenda — no debe seleccionarse nada**. Es la verificación de un segundo que motivó la decisión de §4.
- Grep de control: `buildMarkerLegend` y su tipo de entrada no referencian `canonicalValue`, `originalValue` ni `Document` (§3).
- Grep de control: ningún `drawText` en `export-engine` (§4).
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract && pnpm test:security`.

## Referencias

- `architecture/03_Data_Model.md` §18, §19 — `core/Export_Engine.md` §6, §9, §13 — `core/Render_Engine.md` §6, §13 — `architecture/05_Worker_Architecture.md` §7.4 — `architecture/08_Security_Model.md` §4, §9.1
- `adr/ADR-004` §"Consecuencias" — `adr/ADR-009` §"Garantías", §"Opciones al usuario" — `adr/ADR-012` — `adr/ADR-047` §3, §4 — `adr/ADR-057` §2
- Código: `packages/anonymization-core/export-engine/src/worker/assembler.ts` (`savePdf`, `applyMetadata`, `appendPage`) — `packages/anonymization-core/export-engine/src/export.engine.ts` — `packages/anonymization-core/shared/src/types.ts` (`ExportOptions`, `ExportSavePayload`) — `apps/react-client/src/components/toolbar/` (diálogo de export)
