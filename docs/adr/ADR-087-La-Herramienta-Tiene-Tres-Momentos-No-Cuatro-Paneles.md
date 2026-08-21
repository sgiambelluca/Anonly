<!-- CONTEXT: scope=adr | dependencias=ui/UX_Guidelines.md,ui/Components.md,ui/React_Client.md,00_Project_Vision.md,core/Export_Engine.md,core/Grouping_Engine.md,core/Render_Engine.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-054-Scroll-Independiente-Por-Panel.md,adr/ADR-056-RenderRequested-Kind-Por-Panel.md,adr/ADR-059-Referencia-De-Marcadores.md,adr/ADR-078-La-Edicion-Manual-Es-Visible-En-La-UI.md | audiencia=humanos+IA | fase=post-10.9 -->

# ADR-087 — La herramienta tiene tres momentos, no cuatro paneles

- **Estado**: Accepted
- **Fecha**: 2026-08-21
- **Decidido por**: El humano, tras una auditoría de la UI contra las heurísticas de Nielsen: *"en vez de que sea todo una SPA, que sea como un wizard de algunos pasos"*, *"el panel de reglas apenas y lo uso"*, *"mostrar un solo visor con un toggle puede servir más que el modo actual"*, *"no hace falta mostrar con qué calidad exportarlo"*, *"alguien que no usó nunca la herramienta no sabe qué es placeholder o redacted"*.
- **Relacionado con**: `00_Project_Vision.md` §8 (layout), `ui/UX_Guidelines.md` §2/§3/§4/§5/§7/§8/§11, `ui/Components.md` §1/§2/§3/§4/§5/§7, ADR-012 (los cuatro modos), ADR-044 (de dónde salen los `replacements` del preview), ADR-054/ADR-056 (scroll y render por panel), ADR-059 (referencia de marcadores), ADR-078 ("Personalizado" ya está tomado; y el valor escrito a mano que §3.3 protege), `core/Grouping_Engine.md` §"Resolución de modo" (la precedencia que §3.1a/§3.1b usan).
- **Reemplaza**: el layout de cuatro paneles de `UX_Guidelines.md` §2 y el principio UX-3 ("lado a lado obligatorio"). Retira el panel de Reglas como región del layout.

> Convención de citas: `ADR-087 §N` refiere a **Decisión §N**.

---

## Contexto

### 1. La auditoría: qué se midió y qué salió

Se recorrió la app corriendo (`text-10p.pdf`, estados vacío / escaneando / `Ready`, a 1440 px y a 900 px) y se contrastó con las diez heurísticas de Nielsen. Los hallazgos que motivan este ADR son los que **no** se arreglan con un ajuste de CSS:

| # | Hallazgo | Medido |
|---|---|---|
| 1 | El panel de Reglas ocupa la mitad de la barra lateral, siempre, vacío o no | `sectionHeights: [423, 422]` — `flex-1` en las dos secciones (`App.tsx:90`) |
| 2 | A < 1024 px los nombres de las entidades se truncan a dos caracteres mientras el selector de modo conserva ancho fijo | `☑ J.. (1) ♂ [Placeholder ▾] ⋯` |
| 3 | El panel rotulado "PDF ANONIMIZADO" muestra el documento **sin anonimizar** durante todo el escaneo | Ver §3 de este contexto |
| 4 | La barra de progreso queda en `width: 0%` con el texto "Listo" al lado | `{"progressWidth":"0%","statusText":"Listo"}` |
| 5 | El dropzone del Hero no acepta drops y su botón está `disabled` | Cero handlers de drag&drop en el repo; `App.tsx:162` |
| 6 | "Cancelar" es visible en `Ready`, junto al CTA primario, con un diálogo que advierte pérdida de datos | `Ready ∉ HIDDEN_STAGES` (`CancelButton.tsx:20-27`) |
| 7 | Los cuatro modos se nombran con jerga (`Placeholder`, `Máscara`, `Sintético`, `Redactar`) sin preview | `replacementModeOptions.ts` |
| 8 | El diálogo de export expone seis controles, cinco de ellos técnicos | `ExportDialog.tsx` |

Los hallazgos 1, 2, 3 y 6 tienen la misma causa: **la UI trata "cargar", "revisar" y "exportar" como el mismo momento**, así que todo compite por la misma pantalla al mismo tiempo y nada puede priorizarse.

### 2. El layout de cuatro paneles nació de una suposición que no se sostuvo

`UX_Guidelines.md` §2 y §2.1 describen cuatro regiones con divisores arrastrables y un reparto 60/40 dentro de la barra lateral. Nada de eso se implementó: no hay resizing, y el reparto real es 50/50 fijo.

Más importante: el reparto asume que Entidades y Reglas tienen peso comparable. **No lo tienen.** El árbol de entidades es la superficie de trabajo — se usa en cada documento, en cada sesión, durante toda la revisión. Las reglas son un atajo que el propio autor del producto describe así:

> *"El panel de reglas apenas y lo uso, no deja de ser simplemente un panel de shortcut para poder poner reglas de reemplazo más rápido."*

Un atajo no merece el 50% de la región crítica.

### 3. El preview anonimizado miente durante el escaneo

Este es el hallazgo más serio de la auditoría, y es de seguridad, no de estética.

Encadenando tres hechos ya documentados:

1. Los `replacements` autoritativos del preview `anonymized` le llegan al Render Engine **por invocación directa del Orchestrator**, computados desde el snapshot de Grouping (ADR-044).
2. Todo `RENDER_REQUESTED` emitido antes de `Ready` **se descarta en silencio**: `RenderEngine.loadDocument` todavía no resolvió, y el handler lo tira con un `warn`, sin cola ni reintento (`Render_Engine.md` §8; el docstring de `readyRenderTrigger.ts` lo documenta como el origen del "visor en blanco hasta que el usuario scrollea").
3. `Render_Engine.md` §13 caso 1: **`kind = "anonymized"` con `replacements = []` → idéntico al original.**

Resultado observado en vivo: durante el escaneo, el panel rotulado "PDF ANONIMIZADO" mostraba el texto del documento **sin anonimizar**.

En una herramienta de privacidad esto es la peor clase de defecto posible. Un rótulo que promete "acá no hay datos sensibles" sobre un render que sí los tiene entrena al usuario a confiar en una garantía que el sistema no está dando todavía.

### 4. Las reglas ya son tres niveles; la UI los esconde en un cuarto lugar

`Grouping_Engine.md` §13 caso 14 fija la precedencia: **gana la más específica, `group > type > global`**, y `priority` solo desempata **dentro del mismo scope**.

O sea que el modelo del Core ya es exactamente "modo por defecto en tres niveles". Lo que hace la UI actual es sacar esos tres niveles del lugar donde el usuario los piensa (el árbol) y meterlos en un panel aparte, detrás de un modal, atrás de un vocabulario que ningún usuario del dominio tiene ("scope", "prioridad 0–1000", "regla").

El scope `group` **parece** redundante con el `Select` que ya está en la fila de ese grupo, y es el error que una redacción anterior de este ADR cometió. **No lo es**: una `Rule` de scope `group` le gana a una de tipo, y el `group.replacementMode` que escribe la fila le **pierde** (`Grouping_Engine.md` §"Resolución de modo"). Hay dos caminos para lo que parece la misma acción, con precedencias opuestas, y el que la UI expone en el lugar obvio es el débil. Ver §3.1a.

### 5. El formato de imagen del export sí importa, aunque el resultado sea un PDF

Se evaluó ocultar `imageFormat`/`dpi`/`jpegQuality` bajo la premisa de que "el resultado es un PDF, no imágenes sueltas". La premisa es falsa: `Export_Engine.md` §11 y el test de CI `export-has-no-text-objects` establecen que **ninguna página del export contiene objetos de texto** — el PDF final es un contenedor de N imágenes rasterizadas, y esos tres parámetros son su codificación.

Pero que importen no significa que el usuario tenga que elegirlos. `Export_Engine.md` §12 da la escala: a 150 DPI con JPEG q 0.85, ~100–300 KB por página. Subir a q 1.00 multiplica eso por 3–4×: un expediente de 100 páginas pasa de ~20 MB a ~80–120 MB, para una diferencia que el ojo no distingue en texto.

Y la fidelidad real no la fija la calidad JPEG sino el **DPI**: la página ya se rasterizó antes de codificarse.

### 6. Por qué esto necesita un ADR y no un PR de UI

Este rediseño **contradice specs vigentes**: el layout de `UX_Guidelines.md` §2, el principio UX-3 ("lado a lado obligatorio"), el panel de `Components.md` §4.1, y el catálogo de componentes de §1. Las reglas del repo (R-2, R-19) exigen ADR + docs antes del código. Sin este documento, el próximo agente que lea `UX_Guidelines.md` "arregla" el layout de vuelta a cuatro paneles.

---

## Decisión

### 1. El flujo tiene tres momentos, y solo el del medio es una pantalla de trabajo

```
① Cargar  ──────►  ②a Escanear  ──────►  ②b Revisar  ──────►  ③ Exportar
  pantalla           pantalla de           la aplicación         flujo
  completa           progreso              propiamente dicha     confirmatorio
```

- **① Cargar**: pantalla completa. Logo, una frase de qué hace la herramienta, y la zona de carga **funcional** (drop + botón). Sin panel de entidades ni de reglas montados.
- **②a Escanear**: pantalla de progreso, con las entidades apareciendo en vivo (§6).
- **②b Revisar**: la superficie de trabajo. **No es un paso de wizard**: el usuario se queda ahí, scrollea, edita y vuelve atrás. Lo que gana con la separación es dejar de competir por espacio con ① y ③.
- **③ Exportar**: diálogo confirmatorio corto (§5), no un panel de configuración.

**Retirado**: el layout de cuatro paneles simultáneos de `UX_Guidelines.md` §2 y su §2.1 (divisores arrastrables, reparto 60/40, tabs a < 1024 px).

### 2. Un solo visor con toggle Original / Anonimizado

Se retira `SideBySideViewer`. El área de documento muestra **un** `PdfViewer` y un toggle de dos posiciones.

**El toggle "Anonimizado" está deshabilitado hasta `stage === Ready`**, con el texto *"Disponible cuando termine el análisis"*. Esa es la corrección del defecto del Contexto §3: mientras los `replacements` no existen, el render anonimizado es idéntico al original (`Render_Engine.md` §13 caso 1) y **no se muestra bajo un rótulo que promete lo contrario**.

Consecuencias que este ADR acepta explícitamente:

- **Se retira el principio UX-3** ("lado a lado obligatorio"). La comparación pasa de yuxtaposición a **alternancia**: el usuario conmuta entre las dos vistas conservando página y scroll. A cambio, el documento recibe todo el ancho, que es lo que un documento necesita para leerse.
- **Se retira `ScrollSyncToggle`** y todo el `scrollSyncController` (ADR-054 §3). Con un solo panel no hay nada que sincronizar. `settings.scrollSyncEnabled` se retira de `settings.store`.
- **`viewer.store.visibleRange`/`currentPageIndex` dejan de ser por `kind`** (ADR-054 §1): hay un solo panel. Aparece `viewer.store.mode` (la posición del toggle). `RENDER_REQUESTED.kind` (ADR-056) **se conserva sin cambios** — sigue siendo requerido y sigue diciendo qué lado renderizar; lo que cambia es que ahora lo determina la posición del toggle, no qué panel se scrolleó.
- **`viewer.store.previewByPage` sigue siendo por `kind`**: las dos vistas tienen imágenes distintas de la misma página, y conmutar el toggle tiene que poder pintar la cacheada sin esperar un render nuevo.
- **Queda sin callers `unionVisibleRange`** (`visibleRange.ts`): existía solo para unir los rangos de los dos paneles en el pedido de render posterior a un `reanalyze` (ADR-056 §3). Se retira con sus tests en vez de dejarse como código muerto con cobertura.

> **Lo que ADR-054 y ADR-056 resolvían sigue resuelto.** Aquellos ADRs existen porque dos paneles independientes pedían renders que se pisaban entre sí. Con un solo panel el problema no se resuelve: **deja de existir**. Ninguna de sus garantías se viola; sus mecanismos quedan sin caso de uso.

### 3. El modo de reemplazo vive en los tres niveles del árbol; el panel de Reglas se retira

`RulesPanel`, `RuleItem`, `RuleCreatorDialog` y `RuleEditorDialog` se retiran del layout y del catálogo. Su función se expresa **en el lugar donde el usuario ya está mirando**:

```
┌─ franja propia, fuera del árbol ─────────────────────────┐
│  Todo el documento     [ Etiquetar               ▾ ]     │  ← scope "global"
└──────────────────────────────────────────────────────────┘

  ▾ ☑ DNI (12)              ( Ocultar parcialmente  ▾ )      ← scope "type"
      ☑ 34.567.891            Ocultar parcialmente           ← heredado
      ☑ 18.445.212            Ocultar parcialmente
      ☑ 42.998.103            Tapar con negro       ▾        ← el Select de la fila
```

- **Nivel documento** → escribe una `Rule` de scope `global`.
- **Nivel tipo** → escribe una `Rule` de scope `type`.
- **Nivel fila** → escribe una `Rule` de scope **`group`**. Ver §3.1a: **esto sí cambia** respecto de la implementación vigente, y no cambiarlo rompería el nivel de fila por completo.

**`priority` se retira de la UI.** Con tres niveles visibles y la precedencia `group > type > global` de `Grouping_Engine.md` §13 caso 14 aplicada por construcción, un entero 0–1000 no tiene nada que decidir en pantalla. Las reglas creadas desde la UI usan la prioridad default.

**El vocabulario "regla", "scope" y "prioridad" desaparece de la interfaz.** Por debajo se escriben las mismas `Rule` de siempre: esto es UI nueva sobre un contrato intacto.

#### 3.1a El selector de la fila pasa a escribir una `Rule` de scope `group`

**Hoy el selector de la fila es inerte apenas existe una regla de tipo.** No es una interpretación
del spec: está en `grouping.engine.ts:1150-1151`, dos líneas consecutivas.

```js
group.replacementMode = replacementMode;                    // lo que el usuario eligió
group.replacementMode = resolveMode(group, session.rules);  // y una línea después se lo pisa
```

`resolveMode` (`Grouping_Engine.md` §"Resolución de modo") chequea **primero** las reglas —group,
type, global— y **último** `group.replacementMode`. O sea que `GROUP_UPDATE_REQUESTED` con
`patch.replacementMode` solo tiene efecto **cuando no hay ninguna regla aplicable**.

Hoy eso casi no se nota, porque el panel de Reglas prácticamente no se usa. **Este ADR vuelve
rutinaria la creación de reglas de tipo** (§3), así que el defecto latente pasaría a ser constante:
el usuario tocaría el dropdown de una fila y no pasaría nada.

**Decisión**: el selector de la fila crea/actualiza una `Rule` de scope `group` en vez de emitir
`GROUP_UPDATE_REQUESTED` con `patch.replacementMode`. Con eso la fila gana sobre el tipo, que es la
precedencia que `Grouping_Engine.md` §13 caso 14 ya define.

> **Corrección de una afirmación anterior de este mismo ADR.** Una redacción previa de §3 decía que
> el scope `group` "se retira de la UI porque hacía lo mismo que el `Select` de la fila". **Es
> falso**: una regla de scope `group` le gana a una de tipo, y `group.replacementMode` le pierde.
> Retirar el scope `group` **y** volver rutinaria la regla de tipo era la peor combinación posible.

**Costo aceptado**: cambiar N filas deja N reglas de grupo en `rules.store`, en vez de N escrituras
sobre los grupos. No es un problema funcional —el Core las resuelve por precedencia igual— pero es
más estado del que hay hoy. **La alternativa evaluada y descartada** era subir
`group.replacementMode` por encima de las reglas de tipo en `resolveMode`: eso es cambiar la
semántica de un motor, mucho más caro e invasivo que usar el mecanismo que ya existe.

#### 3.1b Gana el último que tocaste: aplicar en un nivel barre los de abajo

**El modelo es temporal, no estructural.** Requisito explícito del humano:

> *"si yo agarro y primero edito el reemplazo de una entidad individual, y luego el del grupo,
> debería de barrer por todos los items y cambiar el estado, incluido los que antes edité a mano.
> Si la intención es la anterior, primero barro por el grupo y después modifico de forma
> individual. El orden de los factores acá sí altera el producto."*

Solo con §3.1a eso **no** se cumple: la regla de grupo le ganaría para siempre a la de tipo creada
después, y el barrido no barrería. Hace falta la otra mitad:

1. **Fila** → crea/actualiza una `Rule` de scope `group` (§3.1a).
2. **Tipo** → **borra las `Rule` de scope `group` de los grupos de ese tipo** y crea/actualiza la
   de scope `type`.
3. **Documento** → **borra las `Rule` de scope `type` y las de scope `group`** y crea/actualiza la
   de scope `global`.

Las dos órdenes salen como el usuario espera, y queda perfectamente anidado:

| Orden | Resultado |
|---|---|
| fila #3 → cabecera del tipo | La cabecera **barre** todo, incluida la #3 (regla 2 borró su regla de grupo) |
| cabecera del tipo → fila #3 | La #3 queda distinta (su regla de grupo gana, §3.1a) |

**Sin tocar ningún motor**: son `createRule` / `updateRule` / `deleteRule`, que ya existen.

**Consecuencia que simplifica §3.2**: la opción especial *"Aplicar «X» a los N"* del menú `Varios`
**se retira**. Con la regla 2, **cualquier** opción elegida en la cabecera ya barre. `Varios` pasa a
ser un estado de display puro y el menú es el normal.

**Consecuencia que cierra la ambigüedad que este ADR tenía abierta**: una fila "tiene decisión
propia" ⟺ **existe una `Rule` de scope `group` para ese grupo**. Es un lookup en `rules.store`, sin
flag nuevo en `EntityGroup` y sin reimplementar `resolveMode` en la UI. La redacción anterior de
este ADR dejaba esto como bloqueo abierto (falta de `replacementModeUserSet`); §3.1a lo disuelve.

#### 3.1 Los tres selectores tienen tratamientos visuales distintos

Requisito explícito del humano: *"si son todos iguales, capaz que termino cambiando las reglas de todo el pdf cuando quise cambiar el del primer elemento"*.

**El peso visual mapea al radio de impacto**: cuanto más filas cambia un control, más deliberado tiene que verse accionarlo. Los tres comparten familia (misma tipografía, mismo ícono de caret, alturas escalonadas) y difieren en relleno, borde y ubicación:

| Nivel | Tratamiento | Por qué |
|---|---|---|
| Documento | Borde sólido + label explícito, en **franja propia fuera del árbol**. **Acento ámbar condicional**, ver §3.3a | El de mayor alcance. No está entre las filas, así que no puede confundirse con una. |
| Tipo | **Chip relleno** sobre la cabecera del tipo, con el color de categoría como acento | Se lee como parte del encabezado, no de las filas que agrupa. |
| Fila | **Ghost**: texto gris con caret, **sin relleno**, hasta el hover | El de menor alcance. Con decisión propia —cuando **existe una `Rule` de scope `group`** para ese grupo (§3.1a/§3.1b)— gana un punto y peso de texto. |

> **Lo que separa los tres es el relleno, no el borde** (corregido tras
> verificar en el browser). Una primera implementación distinguía el chip de
> tipo y la fila con decisión propia con el mismo `ring-1`: eran
> indistinguibles, que es exactamente el error de alcance que estos
> tratamientos existen para evitar. Quedan tres rellenos: **blanco con borde**
> (documento), **gris con barra de acento de la categoría** (tipo),
> **transparente** (fila).

#### 3.2 Estado mixto: la cabecera dice "Varios"

Cuando las filas de un tipo no comparten modo, la cabecera **no puede mostrar un modo concreto** sin mentir. Muestra `Varios ▾`, con el menú normal de opciones: con el barrido de §3.1b regla 2, **cualquier** opción elegida ahí uniforma el tipo, así que no hace falta un ítem especial de "aplicar a todos". `Varios` es un estado de display puro.

**Se elige "Varios" y no "Personalizado"** por una razón dura: **"Personalizado" ya está tomado en este mismo componente**. ADR-078 §1 lo usa como etiqueta del `ReplacementModeSelect` cuando el usuario editó a mano el `replacementValue`. Reusarlo para "las filas no coinciden entre sí" pondría dos significados distintos en la misma palabra, en la misma columna, a dos filas de distancia.

Más allá de la colisión: "Personalizado" describe un **origen** (alguien lo tocó); "Varios" describe un **estado** (hay más de un valor). Una cabecera que resume doce filas necesita comunicar el estado.

#### 3.3 La fricción escala con lo que hay en juego

**Ningún nivel pide confirmación cuando no hay nada que romper.** Aplicar "Todo el documento →
Etiquetar" sobre un documento recién abierto no destruye nada: es la primera acción razonable que
alguien hace. Aplicarlo después de ajustar cinco categorías y doce filas destruye media hora de
trabajo. Un control permanentemente en alarma estaría gritando en el 90 % de los casos en que la
acción es inofensiva — y `UX_Guidelines.md` §3.3 ya lo dice sobre la marca de degradado:
**"una señal que aparece siempre no es una señal"**.

| Nivel | Confirmación | Toast con "Deshacer" (5 s) |
|---|---|---|
| **Fila** | nunca | **solo si `replacementValueUserSet === true`** (ver abajo) |
| **Tipo** | solo si ese tipo tiene filas con `Rule` de scope `group` | siempre |
| **Documento** | solo si existe alguna `Rule` de scope `type` o `group` | siempre |

**Por qué la fila normalmente no lleva toast**: es la acción más frecuente de la app —en un
expediente se tocan decenas de filas— y es **autoevidente y autorreversible**: el valor nuevo se ve
en el mismo control con el que se vuelve atrás. Un toast por cada una es ruido que se aprende a
ignorar, y arrastra consigo la credibilidad de los toasts de los otros dos niveles.

**Por qué la excepción**: cambiar el modo de un grupo con el valor escrito a mano **destruye ese
texto sin vuelta**. `grouping.engine.ts:1151-1160` recalcula `replacementValue` y apaga
`replacementValueUserSet`; el texto que el usuario tipeó **no se guarda en ningún lado**. Y la vía
documentada para "volver atrás" (`UX_Guidelines.md` §3.3: cambiar el modo y volver al anterior)
devuelve el valor **automático**, no lo que el usuario había escrito. Es el único caso del nivel
fila donde algo se pierde de verdad, así que es el único que lleva toast.

**El diálogo nombra lo que va a romper**, en vez de advertir en abstracto:

```
¿Cambiar el modo de todo el documento?

Vas a reemplazar los ajustes de 5 categorías
y 12 entidades que modificaste a mano.

                    [Cancelar]  [Cambiar todo]
```

Los conteos salen de contar `Rule` por scope en `rules.store`. Cero datos nuevos.

**El undo lleva snapshot, no un id.** Deshacer un barrido de tipo o de documento tiene que
**restaurar las `Rule` que el barrido borró** (§3.1b reglas 2 y 3), no solo borrar la regla creada.
Sigue sin necesitar infraestructura de undo general —es guardar la lista de reglas eliminadas y
recrearlas— pero el toast carga esa lista.

**Toast y no confirmación como mecanismo principal**: una confirmación por cada cambio de modo se
vuelve ruido que se aprende a saltear. La confirmación queda reservada a los dos barridos, y solo
cuando barren algo.

#### 3.3a El nivel documento se enciende cuando tiene algo que destruir

La franja de "Todo el documento" (§3.1) es **neutra por defecto** y **gana acento ámbar + un
resumen** cuando existe alguna `Rule` de scope `type` o `group`:

```
sin ajustes previos:
┌────────────────────────────────────────────────────────┐
│   Todo el documento    [ Etiquetar              ▾ ]    │
└────────────────────────────────────────────────────────┘

con ajustes propios:
┌────────────────────────────────────────────────────────┐
│ ▌ Todo el documento    [ Etiquetar              ▾ ]    │
│   ⚠ 5 categorías y 12 entidades con ajustes propios    │
└────────────────────────────────────────────────────────┘
```

**El color aparece cuando significa algo**, y el resumen te entera del riesgo **antes** de abrir el
menú, no recién en el diálogo. **No se señala solo con color** (icono + texto además del acento),
así que funciona con daltonismo y con lector de pantalla.

**Se usa ámbar y no rojo**: la acción es reversible (undo de 5 s) y no toca el documento, solo los
ajustes. El rojo queda reservado a errores y a confirmaciones irreversibles; gastarlo acá lo
devalúa donde de verdad hace falta.

**Token nuevo `--color-warning-strong` = `#b45309`** (`Components.md` §10). El `--color-warning`
vigente (`#f59e0b`) da **2.15:1** contra `--color-bg-primary` y falla incluso el 3:1 de elementos
no textuales (WCAG 1.4.11): no puede llevar un borde, un icono ni un texto que signifiquen algo.
`#b45309` da **5.03:1** y sirve para los tres.

### 4. Los modos se nombran por lo que se ve en el papel, con ejemplo

`ReplacementMode` **no cambia** (ADR-012 sigue vigente, los cuatro valores del enum son los mismos). Cambian las etiquetas de `replacementModeOptions.ts`:

| `ReplacementMode` | Etiqueta anterior | Etiqueta nueva | Ejemplo en la opción |
|---|---|---|---|
| `Placeholder` | Placeholder | **Etiquetar** | Etiquetar |
| `Mask` | Máscara | **Ocultar parcialmente** | Ocultar parcial |
| `Synthetic` | Sintético | **Reemplazar por dato falso** | Dato falso |
| `Redact` | Redactar | **Tapar con negro** | Tapar con negro |

La última columna es la **forma corta del disparador**: el selector de la fila mide 11 rem y "Ocultar parcialmente" se cortaba. El menú y el nombre accesible usan la forma larga.

**El ejemplo se construye con el grupo real de esa fila**, no con un valor genérico: el usuario ve qué le va a pasar *a su dato*, que es la pregunta que tiene.

> **Pero solo el modo vigente puede mostrar un valor exacto**, y esto se descubrió implementándolo. `EntityGroup.replacementValue` ya viene resuelto por Grouping; los otros tres modos **no se pueden calcular en la UI**: el token de `placeholder` sale de la escalera de ADR-057 y del género de ADR-060, el formato de `mask` de `MASK_FORMAT_BY_TYPE` —que vive en `grouping-engine`, y la UI **no puede importar motores** (P-1)—, y el de `synthetic` del sintetizador sembrado con el `id` (ADR-072 §1). Los otros tres se describen de forma **esquemática**. Un ejemplo *casi* correcto es peor que uno declaradamente esquemático: la primera implementación mostraba `[PERSONA 01]` para **todos** los tipos, así que un DNI previsualizaba como si fuera una persona.

### 5. El export no pregunta nada que el usuario no necesite decidir

```
Exportar documento anonimizado
─────────────────────────────────────────
  12 de 12 entidades serán anonimizadas
  10 páginas

  [ ] Agregar una página con la referencia de marcadores
      Explica qué significa cada marcador (PRS = Persona,
      MAT = Matrícula…). Solo los tipos: nunca los datos
      originales.

                          [Cancelar]  [Exportar]
```

Valores fijos, retirados del formulario:

| Campo | Valor fijo | Por qué |
|---|---|---|
| `imageFormat` | `"jpeg"` | Menor tamaño a fidelidad equivalente en documentos de texto (`Export_Engine.md` §13 caso 6). |
| `jpegQuality` | **`0.92`** | Punto visualmente indistinguible de 1.00 en texto. Ver abajo. |
| `dpi` | `150` | Default de `ExportConfig`. |
| `title` (metadata) | `""` | Nadie lo llenó nunca en las pruebas; `includeOriginalMetadata: false` ya protege lo que importa. |
| ~~`filename`~~ | — | **Revertido tras la prueba manual.** Ver la nota de abajo. |

**Sobre `jpegQuality = 0.92` y no `1.00`**: se consideró 1.00 buscando "lo más cercano al original". No lo consigue — el original ya se perdió al rasterizar a 150 DPI, y de 0.92 a 1.00 solo crece el archivo (×3–4 sobre q 0.85, Contexto §5). **La palanca de fidelidad real es el DPI**, y es la única de las cinco que valdría exponer si aparece el pedido.

> **El nombre de archivo vuelve al formulario** (corrección de este mismo §5, 2026-08-21). Se lo
> había fijado junto con los cuatro técnicos, con el argumento de que "el navegador ya deja
> renombrar al guardar": **es falso** en la configuración por defecto de Chrome, que descarga
> directo sin diálogo. Y no era de la misma clase que los otros: el criterio del recorte es "se
> pregunta lo que altera el documento", y el nombre **identifica el resultado** — no ajusta su
> codificación. Sin validación: vacío cae al default y la extensión `.pdf` se completa sola.

**El checkbox de referencia de marcadores se conserva arriba** y es el único control del diálogo, porque **cambia el documento**: suma una página (ADR-059 §6). Esa es la línea — se pregunta lo que altera el resultado, no lo que ajusta su codificación.

### 6. La pantalla de escaneo suelta temprano, con piso y techo, medida sobre `Detecting`

**Por qué existe.** Dos razones, y la segunda es la fuerte:

1. Acota el tiempo en que el usuario espera sin nada que hacer, y le da prueba de vida — las entidades aparecen en vivo, que es lo que distingue "está trabajando" de "se colgó".
2. **Protege al usuario de editar sobre datos que todavía se mueven.** Las entidades entran incrementalmente (`ENTITY_GROUP_CREATED`, UX-6) y cada una **renumera los marcadores** de todo el documento (`UX_Guidelines.md` §5.4b): `[PERSONA 03]` puede pasar a `[PERSONA 04]` bajo el cursor.

**Dónde se mide.** El tracker de progreso del Orchestrator **se reasigna por etapa** (`orchestrator.ts:267`: *"OCR, luego Detecting con NER activo"*). El umbral se mide sobre **`Detecting`**, que es la etapa larga y la que produce la mayoría de las entidades — no sobre "% del documento", que mezcla etapas de duración incomparable.

**La regla.** Se pasa de ②a a ②b cuando se cumple **la primera** de:

- `Detecting` procesó **≥ 20 %** de las páginas —denominador
  `document.store.pageCount`, y solo con `modelLoading === null`—, o
- pasaron **6 s** desde `IMPORT_REQUESTED`,

y **nunca antes de 1,2 s** desde `IMPORT_REQUESTED`.

> **Corrección de la primera implementación (medida en el browser).** La regla
> decía "20 % de las páginas" usando `pipeline.store.total` como denominador.
> Ese contador **se reasigna por etapa**, y durante la descarga del modelo NER
> vale `current/total = 1/1` **con el stage ya en `Detecting`**: razón 1.0,
> umbral satisfecho al instante, y el usuario soltado apenas terminaba el OCR —
> exactamente lo que esta pantalla existe para no hacer. Se corrige con dos
> cambios: el denominador pasa a `document.store.pageCount` (viene de
> `DOCUMENT_PARSED`, significa siempre lo mismo), y el camino del umbral exige
> `modelLoading === null`, porque mientras el modelo se descarga no se está
> detectando nada. **El techo sigue aplicando durante la descarga**: es el caso
> que el techo global acota.

| Constante | Valor | Rol |
|---|---|---|
| `SCAN_ADVANCE_PAGE_RATIO` | `0.20` | Umbral de páginas analizadas en `Detecting`. |
| `SCAN_ADVANCE_MAX_MS` | `6000` | Techo global. Un PDF escaneado de 200 páginas no atrapa a nadie. |
| `SCAN_ADVANCE_MIN_MS` | `1200` | Piso global. Un PDF de texto de 6 páginas no hace parpadear la pantalla. |

El techo y el piso son **globales** (desde el import) a propósito: la descarga del modelo NER (`modelLoading`, solo la primera vez) es tiempo muerto sin entidades, y un techo medido desde `Detecting` dejaría al usuario mirando "preparando" sin cota. Con el techo global, ese caso entra a ②b con el árbol vacío y un indicador honesto en la toolbar.

**Después del pase, el escaneo sigue en segundo plano**, con estado visible y `Cancelar` — que ahí sí tiene trabajo que hacer, a diferencia de hoy en `Ready` (Contexto §1, hallazgo 6):

```
⟳ Analizando…  47 de 200 páginas          [Cancelar]
```

#### 6.1 No hace falta congelar la numeración

Se evaluó congelar los `indexInType` hasta terminar el escaneo, para que la renumeración no ocurra bajo el usuario. **Se descarta**: con el toggle "Anonimizado" deshabilitado hasta `Ready` (§2), el único lugar donde la renumeración sería visible es el token en la fila del árbol.

Alcanza con **no mostrar el token de reemplazo hasta `Ready`**. Cero cambios en el Core, cero riesgo sobre las garantías de ADR-076.

### 7. `Cancelar` desaparece de `Ready`

`CancelButton` deja de mostrarse cuando `stage === Ready`. Hoy aparece ahí, con peso visual de botón secundario junto al CTA primario, y su `ConfirmDialog` advierte que *"los cambios no guardados se perderán"* — sobre un pipeline que ya terminó y no tiene nada que cancelar.

`Ready` se agrega a `HIDDEN_STAGES`. El botón queda visible exactamente durante el trabajo real del pipeline, incluido el escaneo en segundo plano de §6.

---

## Consecuencias

### Positivas

- La región crítica (el árbol) recupera los ~422 px verticales que ocupaba un panel vacío.
- El defecto de seguridad del Contexto §3 desaparece por construcción: no hay superficie donde mostrar un "anonimizado" que no lo es.
- El vocabulario de la interfaz deja de exigir conocimiento del pipeline: no dice "NER", "scope", "prioridad", "placeholder", "DPI" ni "calidad JPEG".
- Las reglas se vuelven **más** descubribles al dejar de ser un panel: aplicar un modo a los 12 DNI pasa de "abrir modal, elegir scope, elegir tipo, elegir modo" a un click en la cabecera que ya se está mirando.
- **El selector de modo de la fila deja de ser inerte** (§3.1a). Era un defecto latente que la implementación vigente escondía solo porque nadie usaba el panel de Reglas; este ADR lo habría vuelto constante, y en cambio lo corrige.
- El export deja de tener cinco decisiones técnicas delante de la única que altera el documento.

### Negativas, aceptadas

- **Se pierde la comparación simultánea.** UX-3 la declaraba obligatoria. La alternancia es peor para detectar una diferencia sutil entre las dos vistas de la *misma* línea; es mejor para leer cualquiera de las dos. Dado que el trabajo real es revisar qué se detectó y no comparar píxeles, el intercambio conviene.
- **Se pierde el control fino del export.** Un usuario que necesitaba PNG a 300 DPI ya no puede pedirlo. Si aparece el caso, el DPI es lo primero que vuelve, bajo un `▸ Opciones avanzadas` colapsado.
- **Trabajo muerto**: `SideBySideViewer`, `ScrollSyncToggle`, `scrollSyncController` y los cuatro componentes de `rules/` se retiran. ADR-054 y ADR-056 quedan sin caso de uso vigente (no invalidados: ver la nota de §2).
- **Más estado en `rules.store`**: cambiar N filas deja N `Rule` de scope `group`, en vez de N escrituras sobre los grupos (§3.1a). No es un problema funcional —el Core las resuelve por precedencia igual— pero es estado que antes no existía, y que los barridos de §3.1b tienen que enumerar y borrar.
- **`ReplacementModeSelect` cambia de comportamiento**: deja de emitir `GROUP_UPDATE_REQUESTED` con `patch.replacementMode`. Es el único componente ya implementado cuya semántica este ADR modifica; el resto se retira o es nuevo.
- **Un token de color nuevo**: `--color-warning-strong` (§3.3a). Chico, pero es paleta, y la paleta de `Components.md` §10 se declaraba "verificada".
- **Superficie de docs a actualizar**: `UX_Guidelines.md` §2/§3/§4/§5/§7/§8/§11, `Components.md` §1/§2/§3/§4/§5/§7/§10, `React_Client.md` §3.3/§3.5/§3.6/§6, `00_Project_Vision.md` §8.

### Fuera del alcance de este ADR

Se detectaron en la misma auditoría y **no** se deciden acá — necesitan su propio tratamiento:

1. **Contraste del CTA primario**: `#3b82f6` con texto blanco da **3.68:1**, bajo el 4.5:1 que `UX_Guidelines.md` §9 promete. Afecta a todos los botones primarios y a los links `text-accent`.
2. **Escala tipográfica**: la interfaz usa 12 px como tamaño más frecuente; §9 exige 14 px mínimo.
3. **`prefers-reduced-motion`**: exigido por §9, ausente del repo.
4. **Atajos declarados y no implementados**: `Cmd/Ctrl+F`, flechas, `Space`, `Enter` (§9).
5. **Drag & drop**: el dropzone del Hero es decorativo. §1 de este ADR lo declara funcional; la implementación es trabajo de PR.
6. **Sin deshacer general**: §3.3 cubre los dos barridos y el único caso de fila que destruye algo irrecuperable. Todo lo demás (habilitar/deshabilitar grupos, fusionar, dividir, reclasificar, agregar entidades a mano) sigue sin undo.
7. **Ruido de detección**: falsos positivos ("20-12345678" como teléfono) y errores de NER ("DNI" como Organización) se muestran con el mismo peso que los aciertos. Detalle medido y direcciones posibles en `roadmap/Post_Hito10.8_Pendientes.md` §18.
8. **Sin estrategia responsive** — y es la **única regresión** de este ADR. `SideBySideViewer` cargaba la única conducta responsive de la app (tabs por debajo de `lg`); §2 lo retira sin reemplazo, y a 375 px la barra lateral se come el ancho. Necesita una decisión de producto sobre el ancho mínimo soportado: `roadmap/Post_Hito10.8_Pendientes.md` §19.
9. **Los tokens de reemplazo se pisan entre sí en el preview anonimizado**: no es regresión de este ADR, pero §2 lo vuelve mucho más visible al darle todo el ancho al visor. `roadmap/Post_Hito10.8_Pendientes.md` §17.

---

## Referencias

- `ui/UX_Guidelines.md` — reescrito por este ADR (§2, §3, §4, §5, §7, §8, §11)
- `ui/Components.md` — catálogo, reescrito por este ADR (§1, §2, §3, §4, §5, §7)
- `core/Grouping_Engine.md` §13 caso 14 — precedencia `group > type > global`
- `core/Render_Engine.md` §13 caso 1 — `anonymized` con `replacements = []` es el original
- `core/Export_Engine.md` §11/§12/§13 caso 6 — export 100 % imagen, tamaños por formato
- ADR-012 — los cuatro `ReplacementMode` (intactos)
- ADR-044 — de dónde salen los `replacements` del preview
- ADR-054, ADR-056 — scroll y render por panel (sin caso de uso tras §2)
- ADR-059 — referencia de marcadores (el único control que sobrevive al export)
- ADR-078 §1 — "Personalizado" ya designa otra cosa (§3.2)
