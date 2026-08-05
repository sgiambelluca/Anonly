<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Render_Engine.md,architecture/04_Event_System.md,architecture/06_Pipeline.md,ui/React_Client.md,ui/Components.md,adr/ADR-016-Preview-Kind.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-052-Blob-Urls-Tardios-Tras-Cerrar-Documento.md,adr/ADR-054-Scroll-Independiente-Por-Panel.md | audiencia=humanos+IA | fase=11 -->

# ADR-056 — `RenderRequested.kind`: cada panel pide su propio render, y el canvas deja de borrarse

- **Estado**: Accepted
- **Fecha**: 2026-08-05
- **Decidido por**: El humano, tras reportar que con scroll independiente (ADR-054) y sincronización apagada, scrollear rápido un panel hace que el **otro** panel —el que no tocó— recargue su contenido constantemente. Pidió explícitamente: máxima eficiencia de costo, **sin código muerto**, y comportamiento "lazy" — que solo se refresque el PDF que está consumiendo el scroll.
- **Relacionado con**: ADR-016 (`PreviewUpdated.kind`), ADR-037 §1/§4 (`RenderRequested.scale`, supersede por página — precedente directo de forma), ADR-044 (preview mediado por invocación directa), ADR-052 (blob URLs tardíos), ADR-054 §1/§7 (scroll independiente; **este ADR corrige su §7**), `Hito10_Observaciones_Revision.md` entrada "ruido de blob URLs revocados al scrollear" (que este ADR cierra: ese ruido **sí** tenía un síntoma visible)

> Convención de citas: `ADR-056 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-056, Contexto §N`.

## Contexto

### 1. El síntoma

Ventana ancha (≥ `lg`, los dos paneles visibles), sincronización de scroll **apagada** (el default de ADR-054 §2). El usuario scrollea rápido el panel `original`. El panel `anonymized`, que no tocó, parpadea: sus páginas se vacían y se vuelven a dibujar una y otra vez.

### 2. No es un defecto, son dos que se componen

Igual que en ADR-054, la causa no es única. Leídos contra el código:

1. **El evento no dice de qué panel viene.** `RenderRequested` (`Contracts.md` §8) transporta `{ documentId, pageIndices, mode, scale? }` — no hay `kind`. Su único listener en todo el repo, `handleRenderRequested` (`render.engine.ts`), reconstruye y renderiza **los dos** `kind` por cada `pageIndex` del pedido, sin condición posible que pueda saltear uno; el propio contract test del motor assertea `>= 2` renders por evento. Un pedido de 3 páginas produce 6 renders, 3 de ellos para un panel que nadie movió.
2. **Un acierto de cache igualmente acuña un blob URL nuevo.** `emitPreviewUpdated` hace `URL.createObjectURL` en cada emisión, también cuando el render se resolvió por cache y los píxeles son idénticos (`render.engine.ts`). La UI escribe ese string nuevo en `viewer.previewByPage` (`bus-bridge.ts`), y el efecto de `PageCanvas` —que depende de `blobUrl`— se re-ejecuta y **reasigna `canvas.width`/`canvas.height`** (`PageCanvas.tsx`). Asignar `canvas.width` **borra el bitmap del canvas aunque el valor no cambie**: es comportamiento del estándar HTML, no un bug del navegador. El canvas queda gris hasta que la `Image` nueva termina de cargar.

El defecto 1 produce los eventos sobrantes; el defecto 2 convierte cada evento —sobrante o no— en un borrado visible. **Son independientes y los dos hacen falta**:

- Arreglando solo el 1, el panel que el usuario **sí** scrollea sigue parpadeando: cada cambio de rango montado re-pide **todas** las páginas montadas (`PdfViewer.tsx`), incluidas las ya dibujadas, y cada una vuelve por cache con un blob URL nuevo.
- Arreglando solo el 2, el síntoma desaparece pero queda el costo: la mitad del trabajo de render durante el scroll es para páginas que nadie mira, sobre un pipeline que después de ADR-053 es caro de verdad (los timeouts del Escenario 3 hubo que ampliarlos dos veces por eso).

### 3. Por qué era correcto antes de ADR-054, y por qué dejó de serlo

Renderizar los dos `kind` ante un solo pedido era correcto e inofensivo mientras los dos paneles mostraban siempre el mismo rango de páginas: el scroll estaba sincronizado por diseño, así que pedir el render de una página implicaba correctamente que los dos lados hacían falta. `06_Pipeline.md` §10 ("se renderiza original y luego anonimizado por página visible") describe ese mundo.

ADR-054 §7 decidió explícitamente no tocar ningún contrato del Core, y argumentó que dos pedidos por panel eran "inofensivos por diseño: el cache LRU por escala y el supersede por página lo absorben". Eso es cierto para dos pedidos **idénticos**; no es cierto para el acoplamiento implícito de que **un pedido de un panel arrastra el render del otro**. La consecuencia sobre el pipeline de render no se anticipó. Es una errata de ADR-054 §7, anotada allá.

### 4. El `original` no cambia nunca después del primer render

Verificado sobre el código, no sobre el spec: **`annotations` no lo popula nadie** en producción — el único lugar donde aparece en `apps/react-client` es un comentario de "pendiente" en `PageCanvas.tsx`, y el Orchestrator nunca las computa (los highlights por tipo dependen del panel de Entidades, que quedó fuera de alcance). El `original` se renderiza siempre con `replacements: []` y sin `annotations`.

O sea que hoy el output del `kind: "original"` es **función pura de `(documentId, pageIndex, scale)`**: una vez renderizado a una escala, no puede cambiar. Cualquier pedido posterior es un acierto de cache garantizado. Eso decide solo el caso del `SettingsDialog` (§3 más abajo) y hay que dejarlo escrito con su condición de validez: **si algún día se implementan las `annotations` del panel de Entidades, esta premisa deja de valer** y hay que revisar §3.

## Decisión

### 1. `RenderRequested` gana `kind`, **requerido**

```ts
export interface RenderRequested {
  readonly documentId: string;
  readonly pageIndices: ReadonlyArray<number>;
  readonly mode: "preview" | "full";
  readonly kind: "original" | "anonymized";
  readonly scale?: number;
}
```

El motor renderiza **solo ese lado**. Se termina la reconstrucción incondicional de los dos `RenderPageInput` por página.

**Requerido, no opcional.** El precedente de forma más cercano es `scale?` (ADR-037 §1), que sí es opcional — pero ahí "ausente" tiene un significado propio y permanente (usar la escala default de la config). Acá "ausente → los dos" sería una rama de compatibilidad **sin ningún caller**: los cuatro emisores del repo pasan a saber perfectamente de qué panel hablan (§2, §3). El humano lo pidió explícitamente: no dejar código que no se va a ejecutar nunca. Una rama muerta en el handler de un motor no es gratis — se testea, se mantiene y se lee mal en la próxima revisión.

### 2. Cada panel pide lo suyo, **sin condicional sobre el toggle de sincronización**

El pedido del humano fue "si el link de scroll está desactivado, que sea lazy y solo refresque el PDF que consume el scroll". La implementación correcta de eso **no** es un `if (scrollSyncEnabled)`: es que cada `PdfViewer` pase siempre su propio `kind`.

- Con la sincronización **apagada**, solo el panel que el usuario mueve cambia su rango montado, así que solo él emite y solo él se refresca. Es exactamente el comportamiento lazy pedido, sin ninguna rama que lo implemente.
- Con la sincronización **prendida**, los dos paneles se mueven de verdad (ADR-054 §3 mueve el `scrollTop` del seguidor), los dos detectan rango nuevo y los dos emiten su propio pedido. También es correcto, y por el mismo mecanismo.

Un condicional sobre `settings.scrollSyncEnabled` dentro del visor sería una segunda fuente de verdad sobre "quién necesita píxeles", capaz de desincronizarse del estado real del scroll. **Está prohibido**: el `kind` sale del panel que emite, nunca de la preferencia de sincronización.

Los tres emisores de `PdfViewer` (render inicial al observar `Ready`, cambio de rango montado, re-render debounced de zoom) pasan el `kind` del panel que los hospeda.

### 3. `SettingsDialog` tras un `reanalyze` pide **solo `anonymized`**

Hoy pide la unión de los rangos de los dos paneles sin `kind`, o sea refresca los dos lados. Por Contexto §4, el `original` no cambia con un reanalyze: no tiene reemplazos y no tiene annotations. Refrescarlo es trabajo garantizado-inútil.

Se conserva la **unión de rangos** de ADR-054 §1 (los dos paneles pueden estar mirando regiones distintas del documento, y las dos hay que refrescarlas), pero con `kind: "anonymized"` en un único pedido.

> Condición de validez, ligada a Contexto §4: esto vale mientras el `original` se renderice sin `annotations`. Cuando exista el highlight de entidades sobre el original, un reanalyze **sí** cambiará sus píxeles y habrá que emitir también el pedido `original`. Queda escrito acá para que no se descubra por síntoma.

### 4. El supersede se registra **solo para el `kind` pedido**

Restricción dura de implementación, no sugerencia. `registerPendingRender` (ADR-037 §4) se llama hoy para `original` **y** `anonymized` de cada página del pedido. Con `kind` en el evento debe registrarse **únicamente el kind pedido**.

Si se registraran los dos, el pedido de un panel dejaría una entrada de supersede sobre la clave `(documentId, pageIndex, kind)` del **otro** panel, y descartaría o abortaría renders en vuelo legítimos de ese otro panel en cuanto las escalas difieran — cambiando el bug de este ADR por uno peor y más difícil de ver. Es el error natural al hacer este cambio "mecánicamente".

### 5. `PageCanvas` deja de borrar el canvas cuando no cambió de tamaño

Solo asignar `canvas.width`/`canvas.height` cuando el valor calculado difiere del actual. Con eso, un `blobUrl` nuevo para píxeles idénticos ya no produce un canvas vacío: la imagen vieja sigue dibujada hasta que la nueva carga y la reemplaza.

Es el arreglo que mata el síntoma visible, y es independiente del contrato: no toca `packages/`, no depende de §1–§4 y puede mergearse antes. También cierra la entrada "ruido de `ERR_FILE_NOT_FOUND` de blob URLs revocados mientras el `<img>` anterior seguía cargando" de `Hito10_Observaciones_Revision.md`, anotada como "sin consecuencia funcional conocida; revisar si alguna vez produce un síntoma visible": este era el síntoma visible.

La comprobación se implementa como **función pura y testeable en Node** (los tests de `apps/react-client` corren sin jsdom, mismo criterio que ADR-054 §5), no como un `if` inline sin cobertura.

### 6. El blob URL **se sigue acuñando** en cada acierto de cache

La optimización aparente —guardar el blob URL en la entrada del cache LRU y re-emitir **el mismo** string en un acierto, con lo que la UI ni se enteraría del "cambio"— **se rechaza**, y conviene dejar escrito por qué, porque es la primera idea que aparece:

la clave del cache del motor **incluye la escala**; la clave del `BlobUrlTracker` del Orchestrator (`preview:<documentId>:<pageIndex>:<kind>`) **no**. Un render de la misma página a otra escala revocaría el URL que quedó guardado en la entrada vieja del LRU, y al volver a la escala original el motor re-emitiría un URL muerto: `image.onerror` → skeleton gris permanente hasta el próximo render real. Alinear las dos claves es un cambio de ADR-034 §5 / ADR-052 con blast radius propio, para ahorrar un `createObjectURL` que, con §5 aplicado, ya no tiene consecuencia observable.

### 7. Alcance: dos PRs

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 1 | `PageCanvas` no reasigna dimensiones si no cambiaron (§5) | `apps/react-client` | — |
| 2 | `RenderRequested.kind` requerido, handler por kind, supersede acotado, emisores (§1–§4) | `shared` + `render-engine` + `apps/react-client`, **atómico** | — |

El PR 1 va primero por criterio de alivio: es chico, no toca contratos y saca el síntoma visible de encima. No bloquea al 2.

**El PR 2 toca motor y app en el mismo diff, y eso es una excepción deliberada a R-1 y al gate de "diff scope"**, autorizada por el humano al elegir el camino atómico. La justificación es que un campo **requerido** no admite un estado intermedio verde: si el motor lo exige y la UI todavía no lo manda, `pnpm typecheck` del monorepo se cae, y si la UI lo manda antes de que el tipo exista, también. La alternativa —campo opcional, después la UI, después un tercer PR que lo vuelve requerido y borra la rama— respeta R-1 al precio de un PR de veinte líneas cuyo único propósito es la ceremonia, y de un estado intermedio con exactamente el código muerto que el humano pidió no tener. Se descartó (ver Alternativas).

**Este ADR y todas las actualizaciones de spec/doc se escriben directamente sobre `main`, fuera de los PRs de implementación** — decisión del humano, para poder lanzar a los implementadores con la documentación ya actualizada. Es una excepción explícita a R-21 (los specs de motor no se editan desde un PR de implementación) por el lado opuesto al habitual: no viajan **dentro** del PR de código, van **antes**. R-19 (contratos → spec → código) se respeta con más holgura que de costumbre.

### 8. Tests

`render-engine` (PR 2):

- Contract: `RENDER_REQUESTED` con `kind: "original"` produce **exactamente** los renders de ese kind — ninguno de `anonymized`. Y el simétrico. Reemplaza al test actual que assertea `>= 2` renders por evento, que pasa a ser incorrecto por contrato.
- Contract: `RENDER_REQUESTED propagates scale to renderPages` se conserva, adaptado a un solo kind.
- Unit/edge: un pedido con `kind: "original"` **no** deja entrada de supersede sobre la clave `anonymized` de esa página (§4) — el test que protege el error natural del cambio.
- Los guards existentes (documento no cargado, `scale` fuera de rango) no cambian de comportamiento.

`apps/react-client`:

- Unit (PR 1): la función pura de §5 — mismas dimensiones → no reasignar; dimensiones distintas → reasignar.
- Unit (PR 2): `actions.requestRender` incluye el `kind` recibido en el payload emitido; cada `PdfViewer` emite con su propio `kind`; el `SettingsDialog` emite `anonymized` sobre la unión de rangos.

E2E (PR 2), en `tests/e2e/`:

- Con la sincronización **apagada**, scrollear el panel `original` no produce ningún `PREVIEW_UPDATED` con `kind: "anonymized"`. Es la prueba directa del bug y hoy no existe ninguna equivalente.
- Que el Escenario 11 (zoom) siga verde: comparte el `PdfViewer`, el `mountRange` y ahora el `kind` en el pedido debounced.

### 9. Verificación manual, como gate del PR 2

Browser real, no headless, con el mismo criterio de ADR-054 §9 y ADR-053 §8: los dos defectos son de píxeles y de timing, y ninguna suite headless los reportó en su momento. PDF de ~11 páginas, ventana ancha, scroll rápido en cada panel por separado, con la sincronización apagada y después prendida. Se verifica que el panel no tocado no parpadea, y que el tocado tampoco.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **`kind?` opcional, ausente → los dos** (forma de `scale?`, ADR-037 §1) | Deja una rama del handler sin ningún caller: los cuatro emisores del repo saben de qué panel hablan. Es exactamente el código muerto que el humano pidió no tener. Su única ventaja real era permitir partir el PR 2 en dos mitades verdes, y esa ventaja se paga con el defecto que se quería evitar. |
| **Tres PRs: opcional → UI pasa `kind` → flip a requerido** | Respeta R-1 al precio de un PR de veinte líneas de pura ceremonia y de un estado intermedio con la rama muerta viva. El humano eligió el atómico. |
| **Condicionar el `kind` a `settings.scrollSyncEnabled`** | Segunda fuente de verdad sobre quién necesita píxeles, capaz de desincronizarse del estado real del scroll. El comportamiento lazy sale gratis de que cada panel hable por sí mismo (§2), sin ninguna rama. |
| **Filtrar en la UI: ignorar `PREVIEW_UPDATED` de páginas fuera del rango montado de ese panel** | Arregla el síntoma sin arreglar el costo: el motor sigue renderizando el doble. Y es frágil — una carrera entre el montaje y la llegada del evento descarta un preview legítimo y deja la página en gris. |
| **Reusar el blob URL del cache en un acierto** | La clave del cache incluye la escala y la del `BlobUrlTracker` no: se re-emitiría un URL revocado y la página quedaría gris (§6). Alinear las claves es un cambio de ADR-034 §5/ADR-052 con blast radius propio, para ahorrar un `createObjectURL` que con §5 ya no molesta. |
| **`kinds?: ReadonlyArray<"original" \| "anonymized">`** | Generalidad sin caller: nadie necesita pedir un subconjunto arbitrario. Un panel es un `kind`. |
| **Dejar el fan-out y bajar la frecuencia de pedidos (debounce del scroll)** | Ataca el volumen, no la causa: el panel no tocado se seguiría refrescando, solo que menos seguido. Y agrega latencia al panel que sí se está mirando. |
| **No tocar `PageCanvas` y confiar en que con `kind` alcanza** | El panel que el usuario scrollea sigue parpadeando: re-pide todas sus páginas montadas en cada cambio de rango y cada acierto de cache trae un blob URL nuevo (Contexto §2). |

## Consecuencias

**Positivas**: el trabajo de render durante el scroll se reduce a la mitad, que es el objetivo de costo que pidió el humano; el `SettingsDialog` deja de refrescar un lado que no puede haber cambiado; el cache LRU (16 entradas para los dos lados juntos) deja de competir consigo mismo, así que sube la tasa de aciertos y bajan los renders reales — la ganancia compuesta es mayor que la mitad nominal; el evento pasa a decir lo que realmente quiso decir siempre el emisor, cerrando el acoplamiento implícito que ADR-054 §7 dejó abierto; y desaparece el parpadeo, incluido el del panel que el usuario sí está mirando.

**Negativas**: se rompe un contrato público del Core, con el costo de churn en fixtures y tests que eso implica; el PR 2 toca dos módulos en un solo diff (§7); y en modo pestañas (`< lg`) se pierde un precalentamiento accidental — hoy el panel oculto se renderiza gratis con los pedidos del visible, así que al cambiar de pestaña el contenido ya estaba; después de este cambio, el panel que se vuelve visible emite su propio pedido al montar y puede mostrar skeletons grises un instante. Es aceptable (es el mismo costo que pagar por lo que se está mirando, que es la premisa entera del ADR) pero es un cambio de comportamiento observable y hay que reconocerlo antes de que aparezca como reporte.

**Neutras**: `PreviewUpdated.kind` (ADR-016) no cambia — ya distinguía los dos lados en el camino de vuelta; este ADR solo hace simétrico el camino de ida. El supersede por escala (ADR-037 §4), el cache por escala (§3), el debounce de zoom (§5), el preview mediado por invocación directa (ADR-044) y el tratamiento de blob URLs tardíos (ADR-052) quedan tal cual.

## Docs actualizados por este ADR

- `core/Contracts.md` §8 (`RenderRequested.kind`).
- `architecture/04_Event_System.md` §10 (fila de `RENDER_REQUESTED`).
- `core/Render_Engine.md` → v1.8.0: nota de cabecera, §2, §8, §13 (casos 23–24), §14, §15.
- `ui/React_Client.md` §2.3 (firma de `requestRender`) y §7.
- `ui/Components.md` §5.2 (`PdfViewer`) y §5.4 (`PageCanvas`).
- `adr/ADR-054` §7 — errata: sí cambia un contrato del Core.
- `roadmap/MVP.md` §4 (PRs E1/E2) y `roadmap/Hito10_Observaciones_Revision.md` (cierre de la entrada de blob URLs revocados).

## Validación

- Los tests de §8 verdes, en particular el E2E de "scroll en un panel no toca al otro".
- Verificación manual de §9 en browser real.
- Grep de control: ningún `emit(..., RENDER_REQUESTED, ...)` sin `kind` en `apps/react-client`.
- Grep de control: ninguna referencia viva a la reconstrucción de los dos kinds en `handleRenderRequested`.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, más `pnpm test:e2e` para el escenario nuevo y el 11.

## Referencias

- `core/Contracts.md` §8 — `core/Render_Engine.md` §8, §13, §14 — `architecture/04_Event_System.md` §10 — `architecture/06_Pipeline.md` §10 — `ui/React_Client.md` §2.3, §7 — `ui/Components.md` §5.2, §5.4
- `adr/ADR-016` — `adr/ADR-037` §1, §4 — `adr/ADR-044` — `adr/ADR-052` §2 — `adr/ADR-054` §1, §7
- Código: `packages/anonymization-core/shared/src/events.ts` — `packages/anonymization-core/render-engine/src/render.engine.ts` (`handleRenderRequested`, `registerPendingRender`, `emitPreviewUpdated`) — `apps/react-client/src/core-adapter/actions.ts` — `apps/react-client/src/core-adapter/bus-bridge.ts` — `apps/react-client/src/components/viewer/PdfViewer.tsx` — `apps/react-client/src/components/viewer/PageCanvas.tsx` — `apps/react-client/src/components/toolbar/SettingsDialog.tsx`
