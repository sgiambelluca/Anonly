<!-- CONTEXT: scope=adr | dependencias=ui/React_Client.md,ui/Components.md,architecture/07_Performance_Strategy.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md | audiencia=humanos+IA | fase=10-cierre -->

# ADR-054 — Scroll independiente por panel, con sincronización opcional a nivel de píxel

- **Estado**: Accepted
- **Fecha**: 2026-07-31
- **Decidido por**: El humano, sobre tres opciones que el planificador presentó tras diagnosticar el bug de scroll que quedó abierto en el Hito 10. El humano rechazó explícitamente la opción del scroller único ("¿por qué scrollear el original tiene que bajar el anonimizado?") y pidió scrolls totalmente independientes más un control opcional de sincronización.
- **Relacionado con**: ADR-036 §7 (catálogo de componentes de UI), ADR-037 §5 (el debounce de zoom, que comparte el `PdfViewer`), `Hito10_Observaciones_Revision.md` entrada "Post-PR13" item 3 (el bug, reportado como "no confirmado" en su momento) y la entrada del cierre de Hito 10 (donde pasó a diagnosticado)

> Convención de citas: `ADR-054 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-054, Contexto §N`.

## Contexto

### 1. El síntoma, ahora con pasos exactos

Con la ventana lo bastante ancha como para mostrar los dos paneles a la vez (≥ `lg`), al cruzar de una página a otra en **cualquiera** de los dos, los dos visores saltan a la primera página y el scroll queda trabado: cada intento de bajar devuelve al usuario a donde estaba.

El síntoma se había reportado durante el Hito 10 y quedó anotado como **no confirmado**: el implementador intentó reproducirlo en Chromium vía Playwright (salto instantáneo de `scrollTop`, ráfagas de `wheel`, scroll inercial sampleado) y no lo logró, y tomó la decisión correcta de no aplicar un fix sin un test que lo justificara. Dejó `tests/e2e/viewer-scroll-jump.spec.ts` como guardia. Ese test **no cubre el caso de dos paneles**, que es precisamente la condición del bug.

### 2. No es un defecto, son tres que se componen

La hipótesis que había quedado anotada —entradas viejas en el `Set` del `IntersectionObserver`— es correcta en su intuición pero incompleta. Leídos contra el código:

1. **`currentPageIndex` se deriva del mínimo de un conjunto.** `PdfViewer.tsx:141` hace `setPage(range.start)`, y `range.start` sale de `computeVisibleRangeFromIndices` (`visibleRange.ts:23`), que es literalmente `min(set)..max(set)` sobre lo que reporta el `IntersectionObserver`. Basta con que ese `Set` contenga transitoriamente un índice viejo —esperable cuando el otro visor se desplaza miles de píxeles de golpe y las entradas de entrada y de salida caen en callbacks distintos, coalescidos por el `requestAnimationFrame` de `PageVirtualizer.tsx:108`— para que el rango colapse a `start: 0` y `setPage(0)` mande **los dos** visores al principio. `min..max` no tolera un conjunto no contiguo ni por un frame.
2. **No hay dueño del scroll.** Los dos visores son a la vez emisor y receptor. Cuando A scrollea, el efecto de `PageVirtualizer.tsx:70-82` desplaza B; B dispara su propio observer y **vuelve a escribir `currentPageIndex`**, lo que puede arrastrar a A. `computeScrollSyncTarget` (`scrollSync.ts:41`) corta la recursión infinita —compara contra el último rango que ese mismo virtualizador reportó— pero **no** impide que el seguidor mueva al líder.
3. **La sincronización es por índice de página, no por píxel.** `scrollSync.ts:49` manda al seguidor a `targetPageIndex * pageSize`: queda alineado al borde de una página mientras el líder está en un offset arbitrario. Eso ya estaba anotado como limitación aceptada ("hasta ~1 página de diferencia"), pero es también lo que convierte el defecto 2 en un ping-pong estable — y cerca del final del documento el navegador recorta el `scrollTop` del seguidor, que entonces reporta siempre una página menos que el líder. Eso es el "no me deja bajar".

Que no se reprodujera en headless es coherente: los tres dependen del timing de entrega del `IntersectionObserver`.

### 3. Lo que el estado compartido cuesta hoy, y lo que costaría desarmarlo

`viewer.store.visibleRange` y `currentPageIndex` son **globales**, no por panel (`viewer.store.ts`). Verificado contra el código: fuera del propio visor, el único consumidor externo es `SettingsDialog.tsx:159`, que lee `visibleRange` para re-pedir previews al cambiar un setting. Nada más los toca.

O sea que hacerlos por panel es un cambio contenido, no una refactorización de arrastre.

### 4. Por qué el scroller único —la opción que el planificador recomendaba primero— se descartó

El planificador propuso como opción principal un único contenedor con scroll para las dos columnas: elimina la clase entera de bugs por construcción, sin sincronización, sin loop, sin drift, y con menos código del que hay hoy.

El humano la rechazó con un argumento de producto que manda sobre el argumento técnico: **querer mirar la página 3 del anonimizado mientras se revisa la página 1 del original es un caso de uso legítimo**, y el scroller único lo prohíbe. La sincronización pasa a ser una comodidad opcional, no la premisa.

## Decisión

### 1. Los dos paneles tienen scroll independiente; el estado del visor pasa a ser por panel

`visibleRange` y `currentPageIndex` dejan de ser globales y pasan a existir **por `kind`** (`original` / `anonymized`) en `viewer.store`. Cada `PdfViewer` monta, pide renders y reporta su propio rango, sin enterarse del otro.

`SettingsDialog` (Contexto §3) pasa a usar la **unión** de los dos rangos para su re-pedido de previews: quiere refrescar lo que el usuario está viendo, y con paneles independientes eso son dos regiones, no una.

`currentPageIndex` se conserva (por panel) aunque con el control apagado no tenga consumidor: `React_Client.md` §3.5 lo declara, y es la base natural de un futuro "ir a la ocurrencia" desde el panel de Entidades.

**Los tres defectos de Contexto §2 mueren por eliminación del mecanismo, no por arreglo del mecanismo.** Nadie mueve a nadie por código, así que el defecto 2 no tiene dónde ocurrir; y el `min(Set)` del defecto 1 deja de ser peligroso porque pasa a decidir **solo qué páginas montar**, donde equivocarse significa montar una página de más — inofensivo.

### 2. El control de sincronización: dónde vive, cuándo se ve, dónde se guarda

- **Dónde**: en la **barra del visor**, la franja de 40 px que hoy contiene únicamente `ZoomControls` (`App.tsx:113-117`). No en el `Toolbar` (que es la barra de acciones sobre el *documento*: exportar, cancelar, cerrar) ni en el `SettingsDialog` (que es configuración de *procesamiento*: NER, idiomas de OCR, preset). Sincronizar el scroll es hermano del zoom: es un control del visor y va donde están los controles del visor. Además esa barra ya se monta solo cuando hay documento abierto, así que no hay condición nueva que agregar.
- **Cuándo se ve**: solo en anchos `≥ lg`. Por debajo, `SideBySideViewer` muestra pestañas y hay un solo panel visible: un control para sincronizar dos paneles que no se ven a la vez no significa nada. Se oculta con la misma media query con la que ese componente ya cambia a pestañas.
- **Qué pasa con el estado al ocultarse**: **nada**. Se oculta el control, no se apaga la preferencia. Al volver a ancho `≥ lg` reaparece con el valor que tenía y los paneles se realinean. Lo contrario —resetear al ocultarse— haría que redimensionar la ventana pise una preferencia que el usuario no tocó.
- **Dónde se guarda**: `settings.store`, persistido en `localStorage`, como el resto de ese store. No es un abuso de ese slice: `language` y `defaultReplacementMode` ya viven ahí y **no** alimentan `EngineConfig` (`settingsToEngineConfig.ts` mapea solo un subconjunto). Es exactamente el tipo de preferencia de flujo de trabajo que ese store ya guarda.
- **Default**: **apagado**. Es lo que el humano pidió como comportamiento base, y es el estado en el que la clase de bugs de Contexto §2 no existe.

### 3. Con el control prendido: sincronización a nivel de píxel, idempotente, sin temporizadores

Cuando está prendido, la sincronización **no** puede reimplementarse por número de página: eso es el defecto 3 de Contexto §2. Se sincroniza `scrollTop` contra `scrollTop`, que es exacto porque los dos paneles tienen geometría idéntica (mismo `pageSize`, mismo `pageCount`, mismo ancho de columna).

Y la convergencia sale de la **idempotencia**, no de suprimir eventos:

> Al asignar al seguidor exactamente el `scrollTop` del líder, el evento de scroll que eso genera calcula un valor **ya igual** al compartido, así que no propaga nada. El seguidor no tiene nada que decir. No hace falta ninguna bandera de "estoy sincronizando" ni ninguna ventana de tiempo.

Esto es una restricción dura del ADR, no una sugerencia de implementación. **Cualquier diseño que necesite un temporizador para saber cuándo dejar de ignorar los eventos del seguidor está prohibido**: el "¿cuántos ms?" no tiene respuesta correcta, depende de la máquina y de la carga, y reintroduce exactamente la clase de bug que este ADR cierra — uno que falla distinto en cada máquina y nunca en CI. El evento `scrollend`, que sí diría cuándo terminó, tiene soporte desparejo y obligaría a mantener un camino de respaldo con temporizador, o sea el mismo lugar con más código.

**Fuera de React**: el estado de scroll compartido no va al store de Zustand. El evento `scroll` dispara a la frecuencia del monitor; escribir el store en cada tick re-renderizaría los dos paneles en cada cuadro. Va en un módulo propio, imperativo, que solo asigna `scrollTop`. Al store llega únicamente la página actual, que cambia una vez por página y no sesenta veces por segundo.

### 4. Los dos casos límite, resueltos sin temporizadores

1. **El seguidor no puede llegar.** Si un panel tiene menos recorrido que el otro (el navegador recorta `scrollTop` contra `scrollHeight - clientHeight`; puede pasar con zoom alto, donde una barra de scroll horizontal reduce el alto útil), aterriza más arriba que el objetivo. Si entonces propagara **su** posición, arrastraría al líder hacia atrás — el "no me deja bajar" otra vez, por otro camino. Regla: **el módulo recuerda el último valor que empujó a cada panel; un evento de scroll cuyo `scrollTop` coincide (±1 px) con ese valor es un eco de sincronización y no se propaga.** Es una comparación de valor, no una ventana de tiempo. Si el usuario llega por su cuenta exactamente a esa posición y se descarta como eco, los paneles ya están alineados: no hay nada que hacer de todos modos.
2. **Panel oculto.** En modo pestañas, el panel que no se ve tiene `display: none`, alto cero y no puede seguir a nadie: se saltea. Al volverse visible (cambio de pestaña, o la ventana que se ensancha) se realinea una vez contra el panel visible, si la sincronización está prendida. Con la sincronización apagada, cada pestaña conserva su propia posición — que es lo que "independiente" significa.

### 5. La página actual se deriva de la geometría, no del observador

`currentPageIndex` de cada panel se calcula a partir de su posición de scroll (la página que ocupa el centro del viewport), no del mínimo del conjunto del `IntersectionObserver`. Es una función pura y testeable en Node, mismo criterio que `visibleRange.ts` (los tests de `apps/react-client` corren sin jsdom).

El `IntersectionObserver` se queda haciendo lo único para lo que es confiable: decidir qué páginas montar. Si `computeVisibleRangeFromIndices` se conserva para eso, hay que documentar en el propio archivo que `min..max` **solo** vale para el rango de montaje.

### 6. Qué se borra

`scrollSync.ts` (`computeScrollSyncTarget`), la prop `scrollToPageIndex` de `PageVirtualizer`, el efecto de sincronización de `PageVirtualizer.tsx:70-82` y `apps/react-client/src/__tests__/scroll-sync.test.ts`. Con el control apagado no existe el concepto de seguidor; con el control prendido, la mecánica es la de §3, que no comparte nada con esa.

### 7. Qué **no** cambia

Ningún contrato del Core, ningún evento, ningún payload. `RENDER_REQUESTED` se sigue emitiendo por panel como hoy (`PdfViewer.tsx:109-117`), y el hecho de que con paneles independientes cada uno pida su propio rango es correcto: el cache LRU por escala y el supersede por página de ADR-037 §3/§4 lo absorben igual que hoy absorben los dos pedidos idénticos.

El debounce de zoom (ADR-037 §5) no se toca. El modo pestañas de `SideBySideViewer` para `< lg` se conserva **tal cual**: es requisito explícito del humano.

`viewer.store.sideBySide` —declarado en `React_Client.md` §3.5, hoy sin setter ni consumidor, ya anotado como ambigüedad en `SideBySideViewer.tsx:20`— **no** se reutiliza para este control. Darle a un campo documentado un significado que no tiene sería peor que agregar uno propio. Sigue siendo una ambigüedad abierta, sin resolver acá.

Y una restricción de estilo que hay que dejar escrita porque es invisible y rompería §3: los contenedores con scroll **no** pueden llevar `scroll-behavior: smooth`. Haría que asignar `scrollTop` se anime en vez de ser instantáneo, y la exactitud de la que depende la idempotencia se pierde.

### 8. Tests

Unitarios puros (Node, sin jsdom):

- La derivación de la página actual por geometría, incluida la última página, donde el navegador recorta `scrollTop` y la división directa no da el índice exacto.
- El módulo de sincronización: que asignar el `scrollTop` del líder a los seguidores sea idempotente (aplicarlo dos veces da lo mismo); que un eco (§4 caso 1) no se propague; que un panel de alto cero se saltee (§4 caso 2).
- Que `computeVisibleRangeFromIndices` siga probada como lo que ahora es: entrada del rango de **montaje** únicamente.

E2E:

- `viewer-scroll-jump.spec.ts` **extendido al caso que hoy no cubre**: viewport ancho (≥ 1024 px, los dos paneles visibles), cruzar tres o cuatro bordes de página con la rueda, y assertar que el `scrollTop` nunca decrece y que ningún panel vuelve a la página 1. Con la sincronización apagada (el default) y otra vez con ella prendida.
- Que con la sincronización apagada, mover un panel **no** mueve al otro. Es la prueba del comportamiento que el humano pidió, y hoy no existe.

### 9. Verificación manual, como gate del PR

Browser real, no headless. El bug quedó abierto en el Hito 10 precisamente porque headless no lo reproducía. PDF de ~11 páginas, ventana ancha, scroll lento cruzando bordes en los dos paneles, y también cerca del final del documento; después achicar la ventana por debajo de `lg`, verificar que el control desaparece y que la preferencia sobrevive al volver a ensanchar.

### 10. Alcance

Un solo PR, `apps/react-client` (visor + `viewer.store` + `settings.store` + `SettingsDialog` por la unión de rangos) más los tests de §8. No toca `packages/` (R-1 holgado).

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Un solo contenedor con scroll para las dos columnas** | Era la recomendación inicial del planificador: mata la clase entera de bugs por construcción y con menos código. **Rechazada por el humano**: prohíbe mirar la página 3 del anonimizado contra la página 1 del original, que es un caso de uso legítimo (Contexto §4). |
| **Mantener la sincronización obligatoria y solo endurecer el `Set` del observador** | Arregla el defecto 1 y deja vivos el 2 y el 3 (Contexto §2). El síntoma volvería con otra forma. |
| **Sincronización por índice de página con una bandera `isSyncing` + timeout** | Prohibido por §3: no hay un valor correcto para el timeout; corto deja pasar el evento tardío, largo hace que el panel se sienta muerto. Cambia un bug dependiente de timing por otro. |
| **Usar el evento `scrollend` en vez de un timeout** | Soporte desparejo entre navegadores; obliga a mantener un camino de respaldo con temporizador, o sea el mismo problema con más código. |
| **Guardar el `scrollTop` compartido en `viewer.store`** | Re-renderiza los dos paneles en cada cuadro de scroll. Va en un módulo imperativo fuera de React (§3). |
| **Reutilizar `viewer.store.sideBySide` para el control** | Ese campo está declarado en el spec con otro significado y sin consumidor; reusarlo lo volvería ambiguo de verdad en vez de solo estar sin usar (§7). |
| **Guardar la preferencia en `viewer.store` (por sesión)** | Obligaría a re-elegirla en cada apertura de la app. Es una preferencia de flujo de trabajo, no de documento (§2). |
| **Mostrar el control deshabilitado en anchos chicos** | Ocupa espacio en la pantalla que menos tiene, para comunicar algo que el usuario no puede accionar. El humano eligió ocultarlo. |

## Consecuencias

**Positivas**: los tres defectos de Contexto §2 dejan de existir en el estado por defecto, y en el estado sincronizado la mecánica nueva no los reintroduce; desaparece el desfase de hasta una página entre paneles que estaba anotado como limitación aceptada, porque la sincronización pasa a ser exacta; el usuario gana la capacidad de comparar regiones distintas de los dos documentos; y el visor deja de tener lógica que dependa del timing de entrega del `IntersectionObserver`, lo que lo vuelve testeable de forma determinista.

**Negativas**: comparar la misma región de los dos documentos ahora requiere prender el control (un click, recordado entre sesiones) o alinear a mano; el estado del visor por panel duplica dos campos del store y obliga a `SettingsDialog` a unir rangos; y aparece un módulo imperativo fuera de React, que es una excepción deliberada al patrón del resto de la app y necesita el comentario que explique por qué (§3).

**Neutras**: ningún contrato del Core cambia; `RENDER_REQUESTED` y el debounce de zoom quedan igual; el modo pestañas se conserva tal cual; `viewer.store.sideBySide` sigue siendo la misma ambigüedad abierta que era.

## Docs actualizados por este ADR

- `ui/React_Client.md` §3.5 (estado del visor por panel; el flag nuevo en `settings`) y §7 (deja de decir "Lado a lado sincronizado: scroll vertical compartido vía `viewer.currentPageIndex`").
- `ui/Components.md` §5.1 (`SideBySideViewer` deja de describir "scroll sincronizado" como propiedad; el control nuevo en la barra del visor), §5.3 (`PageVirtualizer` sin `scrollToPageIndex`) y el catálogo, por el componente nuevo.
- `architecture/07_Performance_Strategy.md` §3.1 (deja de decir "dos virtualizers sincronizados vía estado Zustand").
- `roadmap/MVP.md` y `roadmap/Hito10_Observaciones_Revision.md`: el PR de §10 y el cierre de la entrada del bug.

## Validación

- Los tests de §8 verdes, en particular los dos E2E nuevos (sincronización apagada y prendida).
- Verificación manual de §9 en browser real.
- Grep de control: ninguna referencia viva a `scrollSync`, `computeScrollSyncTarget` ni `scrollToPageIndex`.
- Grep de control: ningún `setTimeout`/`setInterval` en el módulo de sincronización (§3 es una restricción dura, y así se verifica).
- Que el Escenario 11 (zoom) siga verde: comparte el `PdfViewer` y su `mountRange`.
- Gates: `pnpm lint && pnpm typecheck && pnpm test`.

## Referencias

- `ui/React_Client.md` §3.5, §7 — `ui/Components.md` §5.1, §5.3, §5.5 — `architecture/07_Performance_Strategy.md` §3.1
- `adr/ADR-036` §7 — `adr/ADR-037` §3-§5
- Código: `apps/react-client/src/components/viewer/` (`SideBySideViewer.tsx`, `PdfViewer.tsx`, `PageVirtualizer.tsx`, `scrollSync.ts`, `visibleRange.ts`, `pageLayout.ts`) — `apps/react-client/src/store/viewer.store.ts` — `apps/react-client/src/store/settings.store.ts` — `apps/react-client/src/components/toolbar/SettingsDialog.tsx:159` — `apps/react-client/src/App.tsx:113-117` — `tests/e2e/viewer-scroll-jump.spec.ts`
