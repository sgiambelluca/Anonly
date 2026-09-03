<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,ui/React_Client.md,ui/UX_Guidelines.md,architecture/03_Data_Model.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-054-Scroll-Independiente-Por-Panel.md | audiencia=humanos+IA | fase=post-10.9 -->

# ADR-084 — "Ver ocurrencias" empuja el valor del grupo al buscador del documento

- **Estado**: Accepted
- **Fecha**: 2026-08-19
- **Decidido por**: El humano: *"que al hacer click se copie y pegue el nombre de la entidad en el buscador que está por encima del preview del PDF original. De esa forma ya podés ir alternando entre todas las ocurrencias del documento."*
- **Relacionado con**: **ADR-061 §8** (`DocumentSearchBox`, el buscador que este ADR reusa), ADR-054 (scroll independiente por panel), `Components.md` §3.5 (el ítem de menú que estaba bloqueado desde el PR8 del Hito 10).
- **Parte de**: cierre de la observación §6.1 punto B del plan del Hito 10.

> Convención de citas: `ADR-084 §N` refiere a **Decisión §N**.

## Contexto

### 1. "Ver ocurrencias" estaba bloqueado por una razón que solo cubría media función

`Components.md` §3.5 lista "Ver ocurrencias" en el menú del grupo. El PR8 del Hito 10 lo dejó sin implementar con esta razón, registrada en el propio `GroupContextMenu.tsx`:

> *"Ver ocurrencias" depende de un campo `value` que `OccurrenceRef` no tiene (`03_Data_Model.md` §8).*

Es cierto **para mostrar el texto de cada ocurrencia por separado**, y falso para todo lo demás. `OccurrenceRef` (`shared/src/types.ts:143`) trae `occurrenceId`, `pageIndex`, `bbox`, `source` y `fragments`: la posición de cada ocurrencia está toda disponible. Lo único ausente es el literal por ocurrencia — y el conjunto de literales del grupo ya está en `EntityGroup.aliases`.

O sea que la observación bloqueó, durante todo el hito, una función cuyo 90% de valor no dependía del campo faltante.

### 2. Qué le falta al usuario hoy

El árbol dice `Diego Ramos Vargas (7)`. Siete ocurrencias, y ninguna forma de saber **dónde**. En una pericia de 200 páginas, verificar que las siete son la misma persona —y no dos personas que el matching difuso fusionó (`Post_Hito10.8_Pendientes.md` §1)— obliga a scrollear el documento entero a ojo.

Es justamente la revisión que hay que poder hacer **antes de exportar**, porque un grupo mal fusionado produce un documento que afirma que dos personas distintas son la misma.

### 3. Ya existe exactamente la herramienta de navegación que hace falta

`DocumentSearchBox` (ADR-061 §8) vive sobre el panel `original` y ya resuelve el problema completo: busca con `actions.findText`, cuenta los matches, y con anterior/siguiente recorre el documento scrolleando a cada página y resaltando el bbox con el mismo overlay del hit-test.

No hace falta construir un visor de ocurrencias. Hace falta **cargarle la consulta**.

### 4. Por qué necesita ADR (aunque no cambie ningún contrato del Core)

`DocumentSearchBox` guarda su `query` en `useState` **local** (`DocumentSearchBox.tsx:37`). Para que el panel de entidades —que está en el otro extremo del árbol de React— pueda escribirla, ese estado tiene que subir a un store, y los stores de la UI están especificados en `React_Client.md` §3. No es un contrato de motor, pero sí es la clase de decisión que el repo documenta antes de implementar.

## Decisión

### 1. La consulta del buscador sube a `viewer.store`

```ts
readonly searchQuery: string;              // "" = sin búsqueda activa
setSearchQuery(query: string): void;
```

**No es por panel** (a diferencia de `currentPageIndex`/`visibleRange` desde ADR-054 §1): el buscador existe una sola vez, sobre el `original`. Hacerlo por-`kind` sería inventar una simetría que la UI no tiene.

`DocumentSearchBox` pasa a leer/escribir el store en vez de su `useState`. Lo demás de ese componente —el debounce, los matches, el `activeIndex`, el "Agregar como…"— **queda local**: son estado de trabajo del propio buscador, no algo que otro componente necesite.

### 2. "Ver ocurrencias" escribe la consulta y nada más

Entrada nueva en `GroupContextMenu`, siempre visible. Al elegirla:

```ts
useViewerStore.getState().setSearchQuery(group.canonicalValue);
```

Y ya. El `DocumentSearchBox` reacciona a la consulta nueva por el camino que ya tiene (dispara `findText`, muestra el contador, deja anterior/siguiente listos). El usuario navega las ocurrencias con los mismos controles que ya conoce.

Se usa `canonicalValue` y no un alias: es el valor representativo del grupo y el que el árbol muestra, así que es el que el usuario acaba de ver cuando abrió el menú.

### 3. Lo que el usuario encuentra no es exactamente `members`, y está bien

`findText` busca el **literal** en el texto del documento; `group.members` son las ocurrencias que el pipeline agrupó. Los dos conjuntos pueden diferir:

- Un grupo con aliases (`"Diego Ramos Vargas"` y `"P. R. Vargas"`) tiene members que la búsqueda del canónico **no** encuentra.
- La búsqueda puede encontrar apariciones que el detector **no** agrupó — texto que se le escapó a NER.

Las dos diferencias son **información útil, no un defecto**: la segunda es precisamente el recall que ADR-061 existe para cubrir, y el usuario tiene ahí mismo el "Agregar como…" de cada resultado para arreglarlo.

Por eso la entrada se llama "Ver ocurrencias" y el buscador muestra su propio contador: la UI nunca afirma que ese contador sea el `(7)` del árbol. Documentado en `Components.md` para que la diferencia no se lea como bug.

### 4. Qué NO cambia

- **`OccurrenceRef` no gana `value`.** Este ADR resuelve la navegación, que es lo que se pedía, sin tocar el contrato ni la decisión de privacidad de `08_Security_Model.md` §7 que arrastraría exponer literales por ocurrencia.
- **Ningún evento, ninguna acción nueva del Core.** `findText` ya existe (ADR-061), el scroll ya existe, el overlay ya existe.
- **El buscador sigue siendo solo del panel `original`.**

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Un submenú/popover con la lista de páginas** (`members[].pageIndex`) | Construye una segunda UI de navegación al lado de una que ya funciona mejor: el buscador ya scrollea, resalta y cuenta. Y un popover con 7 páginas no deja saltar entre ellas sin volver a abrirlo. |
| **Agregar `value` a `OccurrenceRef` y listar el texto de cada una** | Es el camino caro que la observación original suponía obligatorio: cambio de contrato + decisión de privacidad, para mostrar texto que en la enorme mayoría de los grupos es el mismo literal repetido. `aliases` ya cubre el caso de las variantes. |
| **Un estado global de "grupo enfocado"** que el visor observe | Acopla el visor al panel de entidades para un caso puntual. Escribir la consulta del buscador reusa un mecanismo que ya existe y que el usuario ya sabe manejar. |
| **Dejar la consulta en `useState` y pasarla por props desde `App`** | Atraviesa cinco niveles de componentes para un dato que dos hermanos lejanos comparten: es exactamente lo que el store existe para evitar (`React_Client.md` §3). |

## Consecuencias

**Positivas**: se cierra un ítem de `Components.md` §3.5 bloqueado desde el PR8, con un PR de UI y sin tocar el Core; el usuario puede auditar un grupo antes de exportar; el buscador gana un segundo punto de entrada sin código nuevo de navegación.

**Negativas / riesgos asumidos**:

- **El contador del buscador puede no coincidir con el `(N)` del árbol** (§3). Se acepta y se documenta; la alternativa (que coincidan) exigiría buscar por todos los aliases y aun así no cubriría los members de OCR con texto imperfecto.
- `viewer.store` gana un campo. Es el store que ADR-054 ya reorganizó; el campo es plano y no participa de la persistencia por panel.
- El foco no salta al buscador al elegir la entrada. Deliberado: mover el foco fuera del árbol interrumpe la navegación por teclado de quien está revisando la lista. El resultado es visible igual (contador + resaltado en el visor).

## Validación

- "Ver ocurrencias" sobre un grupo escribe su `canonicalValue` en `viewer.store.searchQuery`.
- `DocumentSearchBox` refleja esa consulta, dispara la búsqueda y expone el contador — sin que el usuario escriba nada.
- Anterior/siguiente siguen navegando y resaltando igual que cuando la consulta se tipea a mano (mismo camino, misma prueba).
- `setSearchQuery("")` limpia matches y resaltado (es el camino que el propio buscador ya usa al borrar el input).
- El resto del estado del buscador (matches, `activeIndex`, tipo del "Agregar como…") sigue siendo local: no aparece en `viewer.store`.

## Documentos afectados

- `ui/React_Client.md` §3.5 (`viewer.store` gana `searchQuery`/`setSearchQuery`).
- `ui/Components.md` §3.5 (la entrada de menú deja de estar bloqueada) y §5.4c (el buscador lee del store).
- Código, un solo módulo: `apps/react-client`.
