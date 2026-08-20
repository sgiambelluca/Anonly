<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Render_Engine.md,core/Orchestrator.md,architecture/04_Event_System.md,ui/Components.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md,adr/ADR-060-Reemplazo-Por-Genero.md | audiencia=humanos+IA | fase=10.5 -->

# ADR-062 — El veredicto de degradación llega a la UI por `PREVIEW_UPDATED`

- **Estado**: Accepted
- **Fecha**: 2026-08-09
- **Decidido por**: El humano, al rechazar la estimación cliente-side que proponía el implementador y pedir el ADR antes de darle cualquier instrucción — *"primero realiza vos el ADR necesario y después le notifico al implementador"*. El hallazgo es del implementador, al planificar el PR 9 del Hito 10.5: la marca de "reemplazo degradado" en el árbol necesita un veredicto que ningún canal de este hito transporta.
- **Relacionado con**: ADR-058 §7 (la anotación `Degraded` y su umbral, que este ADR **no** modifica), ADR-044 (la mediación grupos→Render del preview, cuyo seed es lo que hace que la cobertura ya sea completa), ADR-060 §5 (la otra marca del árbol, que deliberadamente **no** usa este canal), ADR-057 (la escalera que hizo aparecer el problema de espacio)
- **Parte de**: Hito 10.5, paso 4 — recorta el PR 9 y define lo que queda afuera

> Convención de citas: `ADR-062 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-062, Contexto §N`.

## Contexto

### 1. El veredicto ya existe, con el `groupId` puesto, y se descarta

`paintReplacements` construye una `Annotation` completa por cada reemplazo cuyo encogido cayó bajo `DEGRADED_FONT_RATIO` (`kernel.ts`, ADR-058 §7):

```ts
degraded.push({ id: replacement.occurrenceId, groupId: replacement.groupId, pageIndex, bbox, kind: AnnotationKind.Degraded });
```

Ese array vuelve a `kernelRenderPage`, que lo pasa a `paintAnnotations` para dibujar el recuadro **y ahí termina**: `KernelRenderResult` expone `imageData` y `encoded`, y `RenderPageOutput` expone `imageData`, `encoded` y `durationMs`. Ninguno de los dos lleva anotaciones.

El dato que el árbol necesita no hay que calcularlo: hay que devolverlo. **Es un problema de transporte, no de diseño de la señal.**

### 2. El veredicto es por página renderizada; la marca es por grupo

`Degraded` se emite por ocurrencia, dentro del render de una página. La marca del árbol es por grupo (`ui/Components.md` §3.3, `EntityGroupItem`). Entre las dos hay una agregación —"algún miembro de este grupo degradó"— que hoy no tiene dónde vivir.

Y hay una pregunta que la agregación arrastra: **qué dice el árbol sobre las páginas que todavía no se renderizaron**. Es la pregunta que hace tentadora la estimación cliente-side, y la que hay que responder antes de elegir cualquier canal.

### 3. La cobertura ya es completa, por el seed de ADR-044

`seedAnonymizedPreview` (`orchestrator.ts`) recorre **todas** las páginas del documento en `GROUPING_FINISHED` y siembra el preview anonimizado de cada una que tenga al menos un reemplazo habilitado. Las que salta son las de `replacements.length === 0`, que por construcción **no pueden degradar**: no hay token que encoger.

O sea: para cuando el pipeline llega a `Ready`, el kernel ya emitió su veredicto sobre el conjunto completo de páginas que pueden tener uno. La pregunta de Contexto §2 no necesita una respuesta de diseño — ya está respondida por una decisión que se tomó por otro motivo.

Con un matiz que hay que declarar: el seed es **best-effort** (ADR-044 §3), un render que falla se loguea y no interrumpe. Una página cuyo preview falló no tiene veredicto — y tampoco tiene preview, así que el usuario ya está viendo que algo no salió.

### 4. `EntityGroup` no puede ser el portador

La tentación inmediata es un `EntityGroup.degraded` que el árbol lea junto al resto del grupo. No se puede: `EntityGroup` lo produce `grouping-engine`, que no sabe nada de canvas, de escalas ni de `measureText`. Escribirle un veredicto de render obligaría a que el Orchestrator mutara grupos con información de otro motor, o a que Grouping dependiera de Render — las dos cosas rompen P-1.

La marca es **estado de UI derivado de un veredicto de Render**, no un atributo del grupo. Ese es el reparto que este ADR fija.

## Decisión

### 1. El canal es `PREVIEW_UPDATED`, no un evento nuevo

`PreviewUpdated` gana un campo:

```ts
export interface PreviewUpdated {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly canvasBlobUrl: string;
  // ADR-062 §1: las `Degraded` (ADR-058 §7) que el kernel detectó en ESTE
  // render. Ausente ≡ vacío (§2). En `kind: "original"` es siempre vacío.
  readonly degraded?: ReadonlyArray<Annotation>;
}
```

Por qué este evento y no uno propio:

- **Ya tiene exactamente la granularidad del veredicto**: `(documentId, pageIndex, kind)` es la unidad en la que el kernel produce `Degraded`, y es la unidad en la que hay que reemplazarlo (§3).
- **La UI ya lo escucha** (`core-adapter/bus-bridge.ts`), y ya mantiene estado por página con él. No hay suscripción nueva, ni un segundo camino que pueda desincronizarse del preview que el usuario está mirando.
- **Se emite en el mismo momento en que la marca se vuelve verdadera**: la página que el usuario ve y el veredicto sobre esa página viajan juntos, en un solo evento. Un evento aparte podría llegar antes o después del blob, y el árbol y el canvas discreparían por un instante.

Se reutiliza `Annotation` tal cual, sin inventar un tipo más chico: es lo que el kernel ya construye, y llevar `occurrenceId` y `bbox` deja abierta la afordancia de "llevame a esa ocurrencia" sin otro cambio de contrato.

### 2. El campo es opcional, y su ausencia significa vacío

`degraded?` opcional, con la regla dura de que **ausente y `[]` significan lo mismo**: "esta página, ahora mismo, no tiene ningún reemplazo degradado". El consumidor lee `payload.degraded ?? []` y no distingue los dos casos nunca.

Es deliberado y tiene dos motivos:

- **Ordenamiento de los PRs.** Un campo requerido en `shared` rompe la compilación de `render-engine` —su literal de `bus.emit` no lo tendría— y arreglarlo en el mismo commit mezclaría dos módulos (R-1). Es exactamente la trampa que `RenderPageInput.lineWords` produjo en este mismo hito (`Orchestrator.md` v1.7.1): el campo opcional deja que `shared` → `render-engine` → `apps/react-client` caigan en ese orden, con los gates verdes en cada escalón.
- **Precedente**: `lineWords?` (ADR-058 §5) ya establece la forma "opcional con significado definido para la ausencia" en este mismo hito.

Lo que **no** se acepta es que la ausencia signifique "no sé": eso deja marcas viejas pegadas y es el modo de falla que §3 existe para cerrar.

### 3. Reemplazo por página, nunca acumulación

El consumidor mantiene un mapa `pageIndex → ReadonlyArray<Annotation>` por documento, y cada `PREVIEW_UPDATED` **reemplaza** la entrada de su página. No se acumula.

Es la regla que hace que la marca desaparezca cuando el usuario arregla el grupo: editar el `replacementValue` invalida el cache (la clave ya incluye `hash(replacements ++ annotations)`, ADR-058 §"Consecuencias"), re-renderiza la página, y el nuevo evento llega con `degraded` vacío. Sin reemplazo, la marca quedaría encendida para siempre y el usuario no tendría forma de saber que su corrección funcionó.

**Solo se consumen los eventos con `kind === "anonymized"`.** Un render del panel `original` no pinta reemplazos y emite el array vacío por construcción; si el consumidor no filtrara por `kind`, ese vacío borraría el veredicto legítimo del panel anonimizado de la misma página. Es el error fácil de cometer acá y va escrito.

### 4. El cache LRU tiene que guardar el veredicto

`InternalCacheEntry` gana `degraded`, y `emitPreviewUpdated` lo emite desde la entrada — no desde la corrida del kernel.

Sin esto el sistema tiene un bug silencioso y muy visible: en un **cache hit** (el usuario vuelve a una página que ya vio, o cambia el zoom a una escala cacheada) `kernelRenderPage` no corre, y el evento saldría con `degraded` vacío. Combinado con §3, la marca del árbol se apagaría sola al scrollear de vuelta — y volvería a aparecer al invalidar el cache. Intermitencia sin causa aparente.

`KernelRenderResult` gana el mismo campo para que el veredicto cruce del worker al host; son objetos planos, estructurados-clonables, sin nada que preparar en el transporte.

### 5. La agregación por grupo vive en la UI, y `EntityGroup` no se toca

Del mapa por página de §3, el cliente deriva el conjunto de `groupId` con al menos una ocurrencia degradada, y el árbol marca esos grupos. Es estado derivado: no se persiste, no se emite, no vuelve al Core.

Consecuencia deliberada: **ningún motor cambia de responsabilidad**. `grouping-engine` no se entera, `EntityGroup` queda igual, y `render-engine` sigue siendo el único que juzga legibilidad. Es también lo que mantiene esta marca separada de la de género de ADR-060 §5, que es una afordancia sobre información faltante y no sobre píxeles: comparten el lugar en el árbol y no comparten ni el dato ni el camino.

### 6. El export no emite veredicto, y no hace falta

`renderFull` (`mode: "full"`) no emite `PREVIEW_UPDATED` y este ADR no se lo agrega. No es una laguna: por la invariancia de escala de ADR-058 §7 —el umbral es una razón, no un piso en píxeles, precisamente para que preview y export nunca discrepen sobre el mismo reemplazo— el veredicto del preview **es** el del export. Duplicarlo por el camino del export daría siempre lo mismo y abriría la posibilidad de que difirieran por un bug.

La marca del árbol le está diciendo al usuario, correctamente, lo que va a pasar en el PDF que descargue.

### 7. Alcance: tres PRs, un módulo cada uno

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 1 | `PreviewUpdated.degraded?` (§1, §2) | `shared` | — |
| 2 | `KernelRenderResult.degraded`, `InternalCacheEntry.degraded`, emisión desde `emitPreviewUpdated` (§4) | `render-engine` | 1 |
| 3 | Mapa por página, agregación por grupo, marca en el árbol con sus tres salidas (§3, §5) | `apps/react-client` | 2 |

El orden es forzoso y el campo opcional de §2 es lo que lo hace posible sin ningún commit de dos módulos.

**El PR 9 del Hito 10.5 se recorta**: entrega el checkbox de leyenda, que sí tiene su dato (`ExportOptions.includeMarkerLegend`), y **no** la marca de degradación. Los tres PRs de acá arriba son trabajo posterior al hito. Mientras tanto la señal no desaparece: PR 6 ya pinta el recuadro `Degraded` sobre el canvas del preview, así que lo que falta es la afordancia accionable del árbol, no el aviso.

### 8. Tests

`shared`, PR 1:

- Contract: `PreviewUpdated` acepta el campo ausente y el campo poblado; el tipo del elemento es `Annotation`.

`render-engine`, PR 2:

- Unit: un render con un reemplazo bajo el umbral emite `PREVIEW_UPDATED` con esa `Degraded` en `degraded`, con su `groupId` y su `occurrenceId`.
- Unit: un render sin degradación emite el array vacío (no ausente por accidente, no poblado).
- **Unit, el test del bug de §4: un cache hit emite el mismo `degraded` que el miss que lo pobló.** Es la aserción que representa esta decisión; si algún otro test de este ADR falla, éste tiene que seguir valiendo.
- Unit: un render con `kind: "original"` emite `degraded` vacío.

`apps/react-client`, PR 3:

- Unit: dos páginas con degradación en el mismo grupo lo marcan una sola vez.
- Unit: un `PREVIEW_UPDATED` posterior con `degraded` vacío **borra** la marca de esa página (§3), y el grupo se desmarca si no le quedan otras.
- Unit: un `PREVIEW_UPDATED` con `kind: "original"` **no** toca el mapa (§3).
- Edge: `degraded` ausente se trata igual que vacío (§2).

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Estimar en el cliente con `estimateTokenWidth`** | Es la que propuso el implementador y la que hay que cerrar explícitamente. Crea una **tercera** fuente de verdad sobre "esto degradó", junto al preview y el export, sin `measureText`, sin saber a qué escala se rindió y sin poder simular el repintado de línea de ADR-058 §2-§6 —que hace que un reemplazo que "no entra" termine dibujado a tamaño natural, sin degradación alguna—. ADR-058 §7 eligió una razón en vez de un piso en píxeles con el único fin de que preview y export no discrepen; un estimador en la UI reintroduce esa discrepancia en el lugar más visible. Y el falso positivo no es barato: la marca es accionable, manda al usuario a arreglar un grupo que se renderiza bien, y §7 ya advierte que una señal que aparece de más deja de ser señal. |
| **`EntityGroup.degraded`, escrito por el Orchestrator** | Contexto §4: obliga a mutar grupos con información de otro motor o a que Grouping dependa de Render (P-1). Además convierte un veredicto volátil —cambia con cada re-render— en un atributo del modelo de dominio, con todo el problema de invalidación que eso arrastra. |
| **Un evento propio, `REPLACEMENT_DEGRADED`** | Suscripción nueva y un segundo camino que puede llegar desfasado del `PREVIEW_UPDATED` de la misma página: durante ese hueco el canvas y el árbol dicen cosas distintas sobre el mismo reemplazo. La granularidad que necesitaría es idéntica a la que `PREVIEW_UPDATED` ya tiene. |
| **Devolverlo en `RenderPageOutput` y que el Orchestrator lo re-emita** | El preview mediado es fire-and-forget (`renderPage(...).catch(...)`, ADR-044 §3) y la vía por `RENDER_REQUESTED` no devuelve nada al Orchestrator: habría que cambiar los dos caminos para recuperar un dato que el evento ya podía llevar. Más piezas, mismo resultado. |
| **Barrer todas las páginas al abrir el documento para tener el veredicto completo** | Contradice el render perezoso y el presupuesto de `07_Performance_Strategy.md`. Y es innecesario: el seed de ADR-044 ya renderiza todas las páginas que pueden degradar (Contexto §3). |
| **Dejar la marca afuera sin ADR, como "pendiente documentado"** | Es lo que quedaría si no se escribe esto. El costo no es el ADR: es que la próxima persona que lo retome vuelve a descubrir el cache de §4 y el filtro por `kind` de §3 desde cero, o los omite y produce una marca que parpadea. |

## Consecuencias

**Positivas**: la marca del árbol muestra el veredicto **real** del motor, el mismo que el canvas y el mismo que el export, sin ninguna estimación paralela que pueda discrepar; la cobertura es completa desde `Ready` sin renderizar nada de más, aprovechando el seed que ADR-044 ya hacía por otro motivo; ningún motor cambia de responsabilidad y `EntityGroup` queda intacto; y la marca se apaga sola cuando el usuario corrige el grupo, que es lo que la vuelve una señal confiable en vez de una etiqueta pegada.

**Negativas**: sale del Hito 10.5 — el hito cierra con la marca pintada en el canvas pero sin la afordancia accionable del árbol, que era parte de la justificación de ADR-058 §7; son tres PRs más en tres módulos; `PREVIEW_UPDATED` engorda con un array que la mayoría de los renders va a llevar vacío; y el veredicto depende del preview, así que una página cuyo seed falló no tiene marca (Contexto §3) — best-effort heredado, no introducido acá.

**Neutras**: ADR-058 §7 no se toca —ni el umbral, ni la anotación, ni el dibujo—; el cache LRU conserva su clave y su política, solo guarda un campo más por entrada; el reparto host/worker de ADR-043 queda igual (el kernel sigue sin estado y solo devuelve un dato más); y la marca de género de ADR-060 §5 sigue por su propio camino, como ese ADR ya había decidido.

## Docs actualizados por este ADR

- `core/Contracts.md` §8 (`PreviewUpdated.degraded`) y `architecture/04_Event_System.md` (payload del evento).
- `core/Render_Engine.md` — §7 (el payload de `PREVIEW_UPDATED` que emite), §12 (el cache LRU guarda el veredicto, §4), §14 (los cuatro tests de §8), §15 (ítem del PR 2).
- `ui/Components.md` §3.3 — la marca de degradación deja de ser "alguna ocurrencia recibió `AnnotationKind.Degraded`" a secas y pasa a citar este canal, con la regla de reemplazo por página.
- `roadmap/MVP.md` §4 — el alcance recortado del PR 9 del Hito 10.5 y las tres filas nuevas como trabajo posterior.

> **`adr/ADR-058` no se toca.** Su §7 define el veredicto y su umbral, y los dos quedan literalmente como están: este ADR resuelve por dónde viaja el resultado, no cómo se decide.

## Validación

- Los tests de §8 verdes, en particular el de cache hit.
- Verificación manual: abrir un documento con un grupo que degrade, confirmar que el árbol lo marca; editar el `replacementValue` a algo más corto y confirmar que la marca **desaparece** sin recargar; scrollear fuera y volver a la página y confirmar que **no** parpadea (el caso del cache de §4).
- Verificación manual del filtro de §3: alternar el panel `original` de una página con marca y confirmar que la marca sobrevive.
- Grep de control: ningún `estimateTokenWidth` en `apps/react-client/` (§"Alternativas").
- Grep de control: ninguna escritura a `EntityGroup` con información de render en `packages/anonymization-core/src/` (§5).
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `core/Contracts.md` §5 (`AnnotationKind`), §8 (`PreviewUpdated`) — `core/Render_Engine.md` §7, §10, §13 caso 28 — `core/Orchestrator.md` §2 (seed del preview mediado) — `ui/Components.md` §3.4
- `adr/ADR-044` §3 (seed y flush best-effort) — `adr/ADR-058` §1, §2-§6, §7 — `adr/ADR-060` §5 (la otra marca del árbol)
- Código: `packages/anonymization-core/render-engine/src/worker/kernel.ts` (`paintReplacements`, `kernelRenderPage`, `KernelRenderResult`) — `packages/anonymization-core/render-engine/src/render.engine.ts` (`InternalCacheEntry`, `emitPreviewUpdated`) — `packages/anonymization-core/src/orchestrator.ts` (`seedAnonymizedPreview`) — `packages/anonymization-core/shared/src/events.ts` (`PreviewUpdated`) — `apps/react-client/src/core-adapter/bus-bridge.ts`

---

> **Errata (2026-08-20, ADR-086)**: la sección que justifica **no** emitir el veredicto por el camino del export se apoya en que *"por la invariancia de escala de ADR-058 §7 … el veredicto del preview **es** el del export"*. Esa premisa **no se cumplía**: `REPLACEMENT_MIN_FONT_PX` es una constante absoluta y `boxHeight` escala, así que cuando el bucle de ajuste terminaba por el piso el cociente derivaba con el zoom — la misma ocurrencia daba sana a escala 1 y degradada a escala 2.
>
> **La decisión de este ADR no cambia**: el veredicto sigue saliendo solo por el preview, y duplicarlo por el export seguiría dando lo mismo y abriendo la puerta a que difirieran por un bug. Lo que cambia es que la premisa recién se vuelve verdadera con ADR-086 §2 aplicado, que consigue invariancia **exacta** (verificada a seis decimales sobre seis escalas). Hasta entonces la conclusión era correcta por accidente.
>
> El transporte que este ADR especifica —el campo opcional, el veredicto guardado en la entrada de cache, las tres reglas de consumo, la marca del árbol— **no se toca**: está implementado, tiene tests y funciona. Lo que ADR-086 arregla es la señal que le entra.
