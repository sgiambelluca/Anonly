<!-- CONTEXT: scope=ux | dependencias=00_Project_Vision.md,ui/React_Client.md,ADR-011-Grouping-First.md,ADR-012-Replacement-Modes.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md | audiencia=IA-implementador-ui+humanos | fase=4 (§3.1 aclarado en fase 10, ADR-036 §9; §3.3/§5.4 en fase 10.5 por ADR-057 —tokens abreviados— y ADR-058 —el reemplazo no se derrama, marca de degradado—, §8.2 por ADR-059 —checkbox de referencia de marcadores—; §3.3/§5.4 en fase 10.6 por ADR-060 —género— y por ADR-071/ADR-072 —el control de género pasa a ser un botón de tres estados visible solo en `placeholder`/`synthetic`, con la marca de "sin determinar" fusionada adentro, y el sintético respeta el género y deja de cambiar solo—; §5.4b en fase 10.7 por ADR-061 —agregado manual de entidades—; §5.4 en fase 10.9 por ADR-076 —un texto de reemplazo escrito a mano se conserva, qué lo reemplaza y cómo se vuelve al automático— y ADR-074 §6 —la marca de degradado se enciende más seguido porque ahora mide contra el rectángulo real—; §1/§2/§3/§4/§5/§7/§8/§11 reescritos en el rediseño post-10.9 por **ADR-087** —tres momentos en vez de cuatro paneles: un solo visor con toggle, el modo de reemplazo en tres niveles del árbol, el panel de Reglas retirado, el export sin controles técnicos, y la pantalla de escaneo con piso y techo—) -->

# Anonly — UX Guidelines

> Patrones de UX para anonimización. Flujo en tres momentos, carga incremental, visor único con toggle Original/Anonimizado, edición de grupos, conflictos, cancelación, accesibilidad. Orienta a diseñadores e IAs que implementan la UI.

---

## 1. Principios UX

| # | Principio |
|---|---|
| UX-1 | **Transparencia radical**: el usuario siempre sabe qué está pasando (progreso, errores, qué se detectó, qué se reemplazará). |
| UX-2 | **Agrupación por defecto**: el árbol muestra grupos, nunca ocurrencias. El conteo de ocurrencias es visible pero secundario. |
| UX-3 | **Validación antes de exportar** (reescrito por ADR-087 §2): el usuario puede ver el resultado anonimizado y contrastarlo con el original antes de exportar, **alternando** entre las dos vistas en un solo visor. La versión anterior de este principio decía "lado a lado obligatorio" y exigía los dos paneles simultáneos; ADR-087 §2 lo retira: el documento necesita todo el ancho para leerse, y el trabajo real es revisar qué se detectó, no comparar píxeles de la misma línea. |
| UX-3b | **Nunca mostrar un "anonimizado" que no lo es** (ADR-087 §2): la vista anonimizada **no está disponible hasta `stage === Ready`**. Antes de eso los `replacements` no existen y el render sale idéntico al original (`core/Render_Engine.md` §13 caso 1); mostrarlo bajo ese rótulo entrena al usuario a confiar en una garantía que el sistema todavía no da. |
| UX-4 | **Edición no destructiva**: cualquier cambio es reversible hasta el export. |
| UX-5 | **Cancelación disponible mientras hay algo que cancelar** (precisado por ADR-087 §7): "Cancelar" visible durante todo el trabajo del pipeline, **incluido el escaneo en segundo plano** de §7.2 — y **no** en `Ready`, donde no hay nada que cancelar y su diálogo advertía una pérdida de datos imposible. |
| UX-6 | **Progreso incremental**: las entidades aparecen a medida que se detectan, no al final. |
| UX-7 | **Defaults seguros**: `placeholder` por defecto (más informativo), `enabled = true` por defecto. |
| UX-8 | **Sin sorpresas en el export**: pre-flight check muestra cuántos grupos se anonimizarán y cuántas páginas. (El "tamaño estimado" que pedía la redacción anterior nunca se implementó: no hay fórmula documentada para estimarlo — `core/Export_Engine.md` §12 solo da un rango para una combinación fija.) |
| UX-9 | **Accesibilidad desde el inicio**: teclado, ARIA, contraste, focus visible. |

---

## 2. Los tres momentos (ADR-087 §1)

> **Reemplaza al layout de 4 paneles.** La versión anterior de esta sección describía cuatro
> regiones simultáneas con divisores arrastrables y reparto 60/40. ADR-087 §1 la retira: la UI
> trataba "cargar", "revisar" y "exportar" como el mismo momento, así que todo competía por la
> misma pantalla y nada podía priorizarse. El §2.1 de resizing se retira entero — nunca se
> implementó, y el reparto real (50/50 fijo) le daba media región crítica a un panel vacío.

```
① Cargar  ──────►  ②a Escanear  ──────►  ②b Revisar  ──────►  ③ Exportar
  pantalla           pantalla de           la aplicación         diálogo
  completa           progreso              propiamente dicha     confirmatorio
```

**Solo ②b es una pantalla de trabajo.** ① y ②a son de paso; ③ es un diálogo. La separación no
existe para linealizar el trabajo —el usuario se queda en ②b, scrollea, edita y vuelve atrás—
sino para que los otros tres momentos dejen de robarle espacio.

### 2.1 ① Cargar

Pantalla completa. Sin panel de entidades ni de reglas montados.

- Logo y una frase de qué hace la herramienta.
- **Zona de carga funcional**: drop de archivo **y** botón. Los dos operativos.
- Tres features breves (100 % local / detección automática / export no recuperable).

> La versión anterior mostraba esta pantalla como "Hero" **dentro** del panel derecho, con el
> árbol de entidades vacío a la izquierda ocupando un tercio del ancho. Además su dropzone no
> aceptaba drops y su botón estaba deshabilitado: la afordancia visualmente dominante de la
> primera pantalla era decorativa (ADR-087 Contexto §1, hallazgo 5).

### 2.2 ②a Escanear

Pantalla de progreso. Ver §7.2 para el umbral de salida y §7.3 para qué se muestra.

### 2.3 ②b Revisar — la superficie de trabajo

```
┌──────────────────────────────────────────────────────────┐
│  Toolbar: logo · estado · [Exportar] · ⚙                 │
├──────────────────┬───────────────────────────────────────┤
│  Todo el doc ▾   │  ( Original | Anonimizado )   ⊖ 100% ⊕│
│ ─────────────────┼───────────────────────────────────────┤
│  ▾ DNI (12)  ▾   │                                       │
│    ☑ 34.567.891  │        UN SOLO VISOR                  │
│    ☑ 18.445.212  │        (todo el ancho)                │
│  ▾ Personas (3)▾ │                                       │
│    ☑ Juan Pérez  │                                       │
└──────────────────┴───────────────────────────────────────┘
```

- **Toolbar**: logo, estado del pipeline, "Exportar", settings. "Cancelar" **solo mientras el
  pipeline trabaja** (§7.4). "Cerrar documento" pasa al menú de settings.
- **Barra lateral**: el árbol de entidades **y nada más**. La franja "Todo el documento" de §3.4
  vive arriba del árbol, fuera de él.
- **Área de documento**: un solo `PdfViewer` con el toggle Original / Anonimizado (§5.1).

**Ya no hay panel de Reglas** (§4). **Ya no hay dos visores** (§5.1).

---

## 3. Árbol de entidades

```
┌────────────────────────────────────────────────────────────────┐
│  Todo el documento          [ Etiquetar                    ▾ ] │  ← §3.4 nivel documento
└────────────────────────────────────────────────────────────────┘
  ▾ ☑ Personas (3)             ( Etiquetar                   ▾ )   ← §3.4 nivel tipo
      ☑ Juan Pérez (14)   ♂      Etiquetar                         ← heredado, sin control
      ☑ María Gómez (6)   ○      Etiquetar
      ☑ Carlos López (2)  ♂      Tapar con negro             ▾     ← §3.4 nivel fila
  ▾ ☑ DNI (3)                  ( Varios                      ▾ )   ← §3.4b estado mixto
      ☑ 34.567.891               Ocultar parcialmente
      ☑ 18.445.212               Ocultar parcialmente
      ☑ 42.998.103               Tapar con negro             ▾
```

### 3.1 Elementos del árbol

- **Cabecera de tipo**: `▶ <Tipo> (<n grupos>)`. Expandible/colapsable. Click en la cabecera expande/colapsa. Un checkbox en la cabecera habilita/deshabilita todos los grupos del tipo (cascade).
- **Grupo**: `☑ <canonicalValue> (<n ocurrencias>) [modo ▾] [⋯]`.
  - Checkbox: habilita/deshabilita el grupo. La UI emite `GROUP_UPDATE_REQUESTED` con `patch.enabled` (canal `ui`); `GROUP_TOGGLED` es el evento que **Grouping** emite como respuesta (`04_Event_System.md` §6/§10 — aclaración ADR-036 §9).
  - `<canonicalValue>`: el valor representativo del grupo. Click abre un popover con aliases, ocurrencias por página y opción de editar `canonicalValue`.
  - `(<n ocurrencias>)`: badge con `members.length`. No es editable.
  - `[modo ▾]`: selector de `ReplacementMode`, con las etiquetas de §3.5. Cambio emite `GROUP_UPDATE_REQUESTED` con `patch.replacementMode`. **Presentación ghost** (ADR-087 §3.1): sin borde ni fondo hasta el hover, mostrando en gris el modo heredado del tipo. Gana borde **solo** cuando la fila fue puesta a mano — ahí el borde *es* la señal de excepción.
  - `[⋯]`: menú contextual con: Fusionar con…, Dividir, Ver ocurrencias, Editar valor canónico, Eliminar grupo.
  - **El token de reemplazo (`[PERSONA 01]`) no se muestra hasta `stage === Ready`** (ADR-087 §6.1): durante el escaneo cada entidad nueva renumera los índices, y el token sería el único lugar donde esa renumeración quedaría visible.

### 3.2 Interacciones

- **Fusionar**: el usuario selecciona 2+ grupos del mismo tipo (via checkboxes auxiliares o drag) y click "Fusionar" → `GROUP_MERGE_REQUESTED`. El resultante conserva el menor `indexInType`.
- **Dividir**: click en un grupo → "Dividir" → modal con lista de ocurrencias (con bbox y página) → selecciona un subconjunto → `GROUP_SPLIT_REQUESTED`. Las seleccionadas van a un grupo nuevo.
- **Buscar**: input de búsqueda filtra grupos por `canonicalValue` o `aliases`. Atajo `Cmd/Ctrl+F`.
- **Colapsar todo / expandir todo**: botones en la cabecera del panel.

### 3.3 Estados

- **Grupo habilitado**: checkbox marcado, texto normal.
- **Grupo deshabilitado**: checkbox desmarcado, texto atenuado.
- **Grupo con conflicto**: icono ⚠ al lado del nombre. Click abre el conflicto.
- **Grupo con el valor de reemplazo editado a mano** (ADR-078): punto azul al lado del nombre cuando `EntityGroup.replacementValueUserSet === true`, con `title` "Valor de reemplazo editado manualmente". El menú contextual del grupo ofrece **"Restaurar valor calculado"** solo en ese estado. Existe porque un `replacementValue` escrito a mano es **indistinguible** de uno calculado —`[P1]` es `[P1]`—, y desde ADR-076 sobrevive a todo recálculo automático: sin el punto, el usuario no puede revisar ni deshacer lo que editó antes de exportar. Es además el remedio que ADR-058 §4 y ADR-062 le ofrecen ante un reemplazo degradado, así que se usa de rutina.
- **Grupo con el `replacementMode` distinto del default de las reglas**: **no implementado**, y no lo estará sin un dato nuevo. Calcularlo exige `resolveMode(group, rules)`, que es la resolución de reglas de Grouping: la UI tendría que reimplementarla, que es fuera de su rol (`React_Client.md` U-3). Nota: esta señal era el paréntesis del estado "Grupo editado manualmente" en la redacción anterior, que **conflacionaba** dos cosas distintas — la de arriba (el valor lo escribió el usuario) y esta (el modo difiere del default). ADR-078 §Contexto 1 las separa. Esta es además la menos urgente de las dos: el modo ya se ve, en el `Select` de la propia fila.
- **Grupo con reemplazo degradado** (ADR-058 §7): marca al lado del nombre cuando alguna de sus ocurrencias quedó por debajo del umbral de legibilidad — el token no entraba, no se pudo repintar la línea y hubo que encogerlo. Click ofrece las tres salidas: editar el texto de reemplazo a mano, pasar el grupo a `redact` (que nunca tiene problema de espacio) o deshabilitarlo. **La marca existe para que el usuario sepa dónde mirar**: sin ella, el token quedó chico en la página 7 y solo se descubre haciendo zoom página por página. Por eso mismo tiene umbral y no aparece en cada fallback — una señal que aparece siempre no es una señal.

  > **La marca se va a encender más seguido desde ADR-074 §6**, y es correcto: hasta entonces, una entidad partida en dos líneas medía su encogido contra una envolvente del ancho de la página, así que el token "entraba" siempre y el aviso **nunca** se prendía justo en el caso peor. Ahora se mide contra el rectángulo donde el token se dibuja de verdad.

- **Un texto de reemplazo escrito a mano se conserva** (ADR-076): es la primera salida que ofrece la marca de degradado, y desde ADR-076 es confiable — no lo pisa la renumeración de los grupos al terminar el análisis, ni la inferencia de género, ni agregar entidades a mano, ni un re-análisis. **Lo único que lo reemplaza es cambiar el modo de reemplazo de ese grupo**, porque el texto que el usuario escribió lo escribió para un modo: un grupo en `mask` mostrando `[P1]` diría algo que nadie pidió. Eso incluye una **regla** de tipo o global que cambie el modo efectivo del grupo, que es el único caso en que el texto se pierde sin que el usuario haya tocado ese grupo.
  **Cómo se vuelve al texto automático**: cambiando el modo y volviendo al anterior. No hay un botón de "restaurar" y es deliberado — sería un control permanente más en la fila más común del árbol, para algo que se hace con el selector que ya está ahí (ADR-076 §5). Si el uso real muestra que hace falta, es una afordancia de UI que no toca el Core.
- **Grupo `Person` y su género** (ADR-060 §5-§6, rediseñado por ADR-071 §1-§4): un **botón chico de tres estados** —♀ / ♂ / círculo sin apéndice— que aparece **solo cuando el modo es `placeholder` o `synthetic`**, que son los únicos en los que el género cambia lo que se imprime. En `mask` y `redact` no aparece: sería una palanca sin nada del otro lado.
  - Muestra desde el arranque el género que el sistema infirió, sin que el usuario haga nada. Un click cicla al siguiente estado.
  - **El estado neutro es la marca de "género sin determinar"**, atenuado. No hay un segundo icono al lado: la marca y el control son la misma cosa, y por eso "click abre el selector" pasa a ser simplemente "click cambia el valor". **No comparte tratamiento visual con la marca de degradación**: aquélla dice "esto se ve mal", ésta dice "falta un dato y el documento se entendería mejor con él". El grupo se renderiza perfecto.
  - **El neutro no es un símbolo de identidad de género.** Significa "sin determinar" —falta el dato, o el nombre no lo determina—, que es una propiedad del nombre y no de la persona (ADR-060 §9).
  - **Por qué un botón y no un campo**: en un expediente con veinte personas, veinte selectores permanentes compiten por atención con el control que sí se usa en cada grupo, que es el modo de reemplazo. El género se toca en pocos grupos y solo cuando la inferencia falla.

---

### 3.4 El modo de reemplazo se elige en tres niveles (ADR-087 §3)

`core/Grouping_Engine.md` §13 caso 14 fija la precedencia: **gana la más específica,
`group > type > global`**; `priority` solo desempata dentro del mismo scope. La UI expone esos
tres niveles **en el árbol**, en vez de esconderlos en un panel aparte:

| Nivel | Dónde | Qué escribe | Tratamiento visual (ADR-087 §3.1) |
|---|---|---|---|
| **Documento** | Franja propia, arriba del árbol y **fuera** de él | `Rule` de scope `global` | Borde sólido + label explícito; **acento ámbar condicional** (§3.4d) |
| **Tipo** | Cabecera del tipo | `Rule` de scope `type` | Chip relleno, acento del color de categoría |
| **Fila** | La fila del grupo | `Rule` de scope **`group`** (§3.4a) | Ghost; gana borde cuando tiene decisión propia |

**Los tres tratamientos tienen que ser distinguibles de un vistazo**, porque el error a evitar es
cambiar el documento entero creyendo que se cambiaba una fila. El criterio es que **el peso visual
mapee al radio de impacto**: cuantas más filas altera un control, más deliberado tiene que verse
accionarlo. Los tres comparten familia (tipografía, ícono de caret, alturas escalonadas) y difieren
solo en relleno, borde y ubicación — distinguibles, no disruptivos.

**Fuera de la UI**: `priority`. Con tres niveles visibles y precedencia por construcción, no hay
nada que decidir. El vocabulario "regla", "scope" y "prioridad" tampoco aparece: por debajo se
escriben las mismas `Rule` de siempre.

### 3.4a La fila escribe una regla de grupo, no `group.replacementMode`

**El selector de la fila, tal como está implementado, es inerte apenas existe una regla de tipo.**
Está en `grouping.engine.ts:1150-1151`, dos líneas consecutivas:

```js
group.replacementMode = replacementMode;                    // lo que el usuario eligió
group.replacementMode = resolveMode(group, session.rules);  // y una línea después se lo pisa
```

`resolveMode` chequea **primero** las reglas y **último** `group.replacementMode`, así que
`GROUP_UPDATE_REQUESTED` con `patch.replacementMode` solo tiene efecto cuando no hay ninguna regla
aplicable. Hoy casi no se nota porque el panel de Reglas no se usa; con §3.4 volviendo rutinaria la
regla de tipo, el usuario tocaría el dropdown de una fila y no pasaría nada.

**Por eso el selector de la fila crea una `Rule` de scope `group`.** Así la fila gana sobre el
tipo, que es la precedencia que el Core ya define.

### 3.4b Gana el último que tocaste

**El modelo es temporal, no estructural**: aplicar en un nivel **barre los de abajo**.

1. **Fila** → crea/actualiza una `Rule` de scope `group`.
2. **Tipo** → **borra las reglas de grupo de ese tipo** y crea/actualiza la de tipo.
3. **Documento** → **borra las reglas de tipo y las de grupo** y crea/actualiza la global.

| Orden | Resultado |
|---|---|
| toco la fila #3, después la cabecera del tipo | La cabecera **barre** todo, incluida la #3 |
| toco la cabecera del tipo, después la fila #3 | La #3 queda distinta |

Sin esta regla, la #3 del primer caso sobreviviría al barrido —su regla de grupo le gana a la de
tipo— y el usuario no podría uniformar un tipo sin repasar fila por fila.

### 3.4c Estado mixto: "Varios"

Cuando las filas de un tipo **no comparten modo**, su cabecera muestra `Varios ▾` — no puede
mostrar un modo concreto sin mentir sobre las filas que no lo tienen. El menú es el normal: con
§3.4b regla 2, **cualquier** opción elegida ahí uniforma el tipo.

> **Por qué "Varios" y no "Personalizado"**: "Personalizado" **ya está tomado**. ADR-078 §1 lo usa
> como etiqueta del selector de la fila cuando el usuario editó a mano el `replacementValue`.
> Reusarlo acá pondría dos significados en la misma palabra, en la misma columna, a dos filas de
> distancia. Además "Personalizado" describe un *origen* (alguien lo tocó) y lo que la cabecera
> tiene que comunicar es un *estado* (hay más de un valor).

Una fila "tiene decisión propia" ⟺ **existe una `Rule` de scope `group` para ese grupo**. Es un
lookup en `rules.store`: no hace falta ningún dato nuevo en `EntityGroup` ni reimplementar
`resolveMode` en la UI.

### 3.4d La fricción escala con lo que hay en juego

**Ningún nivel pide confirmación cuando no hay nada que romper.** Aplicar "Todo el documento →
Etiquetar" sobre un documento recién abierto no destruye nada — es la primera acción razonable que
alguien hace. Un control permanentemente en alarma estaría gritando el 90 % de las veces en que la
acción es inofensiva, y ya sabemos qué pasa con eso (§3.3: *"una señal que aparece siempre no es
una señal"*).

| Nivel | Confirmación | Toast con "Deshacer" (5 s) |
|---|---|---|
| **Fila** | nunca | **solo si el grupo tenía el valor escrito a mano** |
| **Tipo** | solo si ese tipo tiene filas con decisión propia | siempre |
| **Documento** | solo si hay alguna decisión de tipo o de fila | siempre |

**La fila normalmente no lleva toast** porque es la acción más frecuente de la app y es
**autoevidente y autorreversible**: el valor nuevo se ve en el mismo control con el que se vuelve
atrás. Un toast por cada una es ruido que arrastra la credibilidad de los otros dos.

**La excepción**: cambiar el modo de un grupo con el valor escrito a mano **destruye ese texto sin
vuelta** — el motor recalcula `replacementValue` y apaga `replacementValueUserSet`, y lo que el
usuario tipeó no queda guardado en ningún lado. La vía de §3.3 ("cambiar el modo y volver al
anterior") devuelve el valor **automático**, no lo escrito. Es el único caso del nivel fila donde
se pierde algo de verdad.

**El diálogo nombra lo que va a romper**:

```
¿Cambiar el modo de todo el documento?

Vas a reemplazar los ajustes de 5 categorías
y 12 entidades que modificaste a mano.

                    [Cancelar]  [Cambiar todo]
```

**El undo lleva snapshot**: deshacer un barrido tiene que **restaurar las reglas que borró**, no
solo quitar la que creó.

**La franja de documento se enciende cuando tiene algo que destruir**:

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

El color aparece cuando significa algo, y el resumen entera del riesgo **antes** de abrir el menú.
**No se señala solo con color** (ícono + texto además del acento). **Ámbar y no rojo**: la acción
es reversible y no toca el documento, solo los ajustes; el rojo queda para errores y confirmaciones
irreversibles. Usa `--color-warning-strong` (`Components.md` §10), **no** `--color-warning`, que no
llega al contraste mínimo.

### 3.5 Cómo se nombran los modos

`ReplacementMode` **no cambia** (ADR-012 sigue vigente). Cambian las etiquetas, que pasan a nombrar
**lo que se ve en el papel** y a traer un ejemplo:

| `ReplacementMode` | Etiqueta | Ejemplo mostrado en la opción |
|---|---|---|
| `Placeholder` | **Etiquetar** | `Juan Pérez → [PERSONA 01]` |
| `Mask` | **Ocultar parcialmente** | `34.567.891 → XX.XXX.XXX` |
| `Synthetic` | **Reemplazar por dato falso** | `Juan Pérez → Diego Ramírez` |
| `Redact` | **Tapar con negro** | `Juan Pérez → ███████` |

**El ejemplo se construye con el grupo real de esa fila**, no con un valor genérico: la pregunta
que el usuario tiene es qué le va a pasar *a su dato*. En el selector de nivel tipo el ejemplo usa
el primer grupo del tipo; en el de nivel documento se omite.

---

## 4. Reglas — retirado como panel (ADR-087 §3)

> **Esta sección describía un panel que ya no existe.** El panel de Reglas listaba reglas por
> scope (Global / Por tipo / Por grupo) con un modal creador, y ocupaba **la mitad de la barra
> lateral** — medido: `sectionHeights: [423, 422]`. Con cero reglas, que es el caso normal, 422 px
> de la región crítica mostraban la frase "Aún no hay reglas" mientras el árbol de entidades
> quedaba cortado a la mitad.

**Su función completa vive ahora en §3.4**: el modo de reemplazo elegido en los tres niveles del
árbol (documento / tipo / fila), que es exactamente la precedencia `group > type > global` que el
Core ya implementa.

Qué se gana con el cambio, además del espacio:

- **Más descubrible, no menos.** Poner los 12 DNI en "Ocultar parcialmente" pasa de *"saber que
  existe un panel de reglas → abrir un modal → elegir scope → elegir tipo → elegir modo"* a un
  click en la cabecera que el usuario ya está mirando.
- **El vocabulario desaparece.** "Regla", "scope" y "prioridad" no aparecen en la interfaz. Por
  debajo se escriben las mismas `Rule` de siempre: es UI nueva sobre un contrato intacto.
- **Se elimina un camino duplicado.** El scope `group` hacía lo mismo que el selector de la fila.

**Lo que se pierde y se acepta**: no hay una lista de "reglas activas" que se pueda leer de corrido.
El estado `Varios` de §3.4b cubre la necesidad real —saber que hay filas fuera del molde— sin una
segunda superficie.

### 4.1 Resolución visible

Sigue vigente en su intención, con otra forma: en vez de un tooltip que explique *"Modo aplicado
por: Regla global 'DNI → mask'"*, la fila **muestra en gris el modo heredado** y el nivel del que
viene está a la vista, una línea más arriba, en la cabecera del tipo. La procedencia se lee en el
layout en vez de explicarse en un tooltip.

---

## 5. Visor PDF (uno solo, con toggle)

### 5.1 Layout

> **Reemplaza al lado a lado.** La versión anterior especificaba dos columnas con scroll
> sincronizado. ADR-087 §2 lo retira: el documento recibe todo el ancho, y la comparación pasa de
> yuxtaposición a **alternancia**.

- **Un solo `PdfViewer`**, ocupando todo el ancho del área de documento.
- **Toggle de dos posiciones**: `( Original | Anonimizado )`, arriba del visor.
- Al conmutar se **conserva la página y la posición de scroll**. Esa continuidad es lo que hace
  que la alternancia funcione como comparación.
- Cada página se renderiza en un `<canvas>` reciclado por el `PageVirtualizer` (sin cambios).
- Phantom de cada página (dimensiones + placeholder gris) siempre presente para scroll height
  correcto (sin cambios).
- Zoom: botones +/- y atajos `Cmd/Ctrl + +`, `Cmd/Ctrl + -`, `Cmd/Ctrl + 0` (sin cambios).

**El toggle "Anonimizado" está deshabilitado hasta `stage === Ready`** (UX-3b), con el texto
*"Disponible cuando termine el análisis"*. Antes de `Ready` los `replacements` no existen y el
render anonimizado sale **idéntico al original** (`core/Render_Engine.md` §13 caso 1): mostrarlo
bajo ese rótulo es la peor clase de defecto posible en una herramienta de privacidad.

**Retirado junto con el lado a lado**: la sincronización de scroll entre paneles y su control
(`ScrollSyncToggle`, ADR-054 §2). Con un solo panel no hay nada que sincronizar.

> **ADR-054 y ADR-056 no quedan invalidados.** Existían porque dos paneles independientes pedían
> renders que se pisaban entre sí; con un solo panel ese problema **deja de existir** en vez de
> resolverse. `RENDER_REQUESTED.kind` (ADR-056) se conserva requerido y sin cambios — lo que
> cambia es que ahora lo determina la posición del toggle, no qué panel se scrolleó.

### 5.2 Highlight en la vista Original

- Cada ocurrencia de un grupo habilitado tiene un borde color sobre el bbox.
- Color por tipo: Personas=verde, DNI=azul, Direcciones=naranja, etc. (paleta accesible, ver §9).
- Hover sobre un highlight: tooltip con tipo, valor canónico, modo de reemplazo, conteo de ocurrencias del grupo.
- Click en un highlight: selecciona el grupo correspondiente en el árbol (scroll into view + resaltado).

### 5.3 Conflicto en la vista Original

- Bordes adicionales en rojo o icono ⚠ sobre bbox en conflicto.
- Click abre el panel de conflicto (ver §6).

### 5.4 Vista Anonimizada

- Muestra el resultado con reemplazos aplicados visualmente.
- `placeholder`: texto `[DNI 01]` sobre bbox — o su forma abreviada (`[PERS 01]`, `[PRS-01]`) cuando el dato original era corto (ADR-057). Para personas con género asignado, `[MUJER 01]` / `[HOMBRE 01]` (ADR-060).
- `mask`: texto `XX.XXX.XXX` sobre bbox.
- `synthetic`: texto sintético (`39.123.456`). Para personas con género asignado, el nombre falso **es del mismo género** (ADR-071 §5): "María Gómez" ya no puede salir "Carlos Sánchez". Sin género resuelto se sortea del pool completo, que es el comportamiento de siempre — no hay nombre de pila neutro en español al cual caer. Y el nombre falso de un grupo **no cambia nunca** una vez asignado: ni al renumerarse los índices, ni al agregarse otra entidad, ni al tocarse una regla (ADR-072 §1).
- `redact`: bloque negro sólido sobre bbox.
- Hover sobre un reemplazo: tooltip con valor original y modo aplicado.
- **Ningún texto de reemplazo se sale de su espacio** (ADR-058 §1). Cuando no entra, pasan dos cosas en orden: si la línea lo permite, se **repinta** —el texto que sigue se corre a la derecha y el resultado se lee como una línea normal—; si no, el token se **encoge** hasta entrar. Este segundo caso es el que puede quedar chico, y es el que enciende la marca de §3.3 en el árbol.
- El repintado es **conservador por diseño**: no se activa sobre líneas centradas, filas de tabla, texto rotado ni renglones sin margen a la derecha. En documentos con mucha tabla se va a ver poco, y eso es lo esperado, no una falla.

### 5.4b Agregar una entidad que el detector no encontró (ADR-061)

Hay **tres vías**, y todas terminan en lo mismo — cambia de dónde sale el valor:

1. **Botón sobre el árbol de entidades**: elegís el tipo, escribís el valor.
2. **Señalar en el PDF original**: clickeás una palabra o arrastrás un recuadro sobre el panel izquierdo; aparece "Agregar entidad como…" con el selector de tipo.
3. **Desde el buscador**: cada resultado de la lupa ofrece agregarlo como entidad.

**Solo se puede señalar con el toggle en Original.** En la vista anonimizada lo que se ve puede ser un reemplazo, y señalarlo no tendría sentido: la herramienta de señalar queda deshabilitada ahí.

**La selección no es selección de texto**, aunque se sienta parecida: el visor resuelve qué palabras caen bajo el cursor o el recuadro. Es lo que hace que funcione igual en un PDF escaneado, donde no hay texto que seleccionar y es justamente donde más se necesita corregir lo que el OCR se comió.

**Qué esperar de la búsqueda, y hay que decirlo en la UI**: encuentra el valor **exacto**, sin distinguir mayúsculas ni acentos — "JOSE PEREZ" encuentra "José Pérez". **No** encuentra "J. Pérez". Si el documento nombra a la misma persona de dos formas, hay que agregar las dos; una vez agregadas, la app las agrupa sola. Decirlo por adelantado en el diálogo evita que el usuario crea que falló.

**Efecto sobre los números**: agregar una entidad recalcula el orden de los marcadores, así que los índices de los grupos ya visibles pueden correrse — `[PERSONA 03]` puede pasar a `[PERSONA 04]`. Es coherente con que los números siempre reflejen el orden de aparición en el documento. Al agregar varias seguidas conviene que la UI no llame la atención sobre cada renumeración.

### 5.5 Continuidad al conmutar (reemplaza a "Sincronización")

> La versión anterior de esta sección describía la sincronización entre los dos paneles (scroll,
> página y zoom). Con un solo visor (§5.1) no hay dos cosas que sincronizar; lo que queda es
> **continuidad al conmutar el toggle**.

- **Página y scroll**: se conservan exactamente. Conmutar no mueve el documento.
- **Zoom**: se conserva.
- La conmutación es la operación que reemplaza a la comparación simultánea, así que **cualquier
  salto de posición la rompe**: si al volver a Original el documento aparece en otro lado, el
  usuario perdió la referencia que estaba comparando.

---

## 6. Panel de conflicto

Cuando el usuario click en un conflicto (desde el árbol o desde un highlight):

```
Revisar entidad
─────────────────────────────────────────
"Fiscalía de Quilmes"
Dos detecciones se superponen

¿Con qué se identifica?
  (•) Organización
  ( ) Dirección

                        [Cerrar] [Aplicar]
```

- **El usuario elige el tipo de entidad, no el modo de reemplazo** (ADR-083 §1). Un conflicto es un desacuerdo sobre *qué es* la entidad; el modo de reemplazo se elige en el `ReplacementModeSelect` de la fila del grupo (`Components.md` §3.4).
- **No se nombra a Regex ni a NER** (ADR-083 §6), ni se muestran números de confidence: son detalles de implementación del pipeline. La confidence **ordena** las opciones —la mayor va primera y preseleccionada— pero no se imprime.
- Las opciones son los tipos **distintos** entre los candidatos del conflicto, no el catálogo completo. Corregir libremente la categoría de cualquier grupo es "Cambiar categoría" (`Components.md` §3.5), disponible con o sin conflicto.
- **Aplicar** emite `CONFLICT_RESOLVE_REQUESTED { conflictId, entityType? }`, que reclasifica el grupo y marca el conflicto resuelto. **Sin elección explícita** gana el candidato de mayor confidence — que coincide con la resolución automática ya vigente, así que confirmar no cambia datos.
- Si todos los candidatos comparten tipo (`low_confidence`/`ambiguous_canonical`, que no son conflictos de clasificación), no hay radios y el botón dice **"Descartar"**.

> **Redacción anterior (retirada por ADR-083)**: el mockup ofrecía `[Usar Regex] [Usar NER] [Personalizado ▾]` y decía que emitía el evento "con el modo elegido". Eran dos cosas incompatibles —`ReplacementMode` no tiene valores "regex"/"ner"— y lo que se implementó (elegir un `ReplacementMode`) **no resolvía el desacuerdo**: `applyConflictResolve` no tocaba el `entityType`, así que el usuario aplicaba y la discrepancia quedaba igual.

---

## 7. Pipeline y progreso

### 7.1 Estado en la toolbar (②b)

```
[● Listo]                                        [Exportar]
[⟳ Analizando…  47 de 200 páginas]   [Cancelar]  [Exportar]
```

Estados:
- `● Listo` (verde): pipeline en `Ready`, listo para editar/exportar. **Sin barra de progreso.**
- `⟳ Analizando…` (azul, animado): con `current`/`total` reales de la etapa vigente.
- `⟳ Reconociendo texto…` (azul): OCR, con `current`/`total`.
- `⟳ Preparando el detector de nombres…` (azul): carga del modelo NER, con su propio progreso de
  descarga (0..1). **Solo la primera vez** — conviene decirlo, porque es tiempo muerto sin
  entidades apareciendo.
- `● Cancelando` (amarillo): tras `CANCEL_REQUESTED`.
- `● Error` (rojo): con el mensaje y las salidas de §7.5.
- `⟳ Exportando página 7 de 10…` (azul).

> **La barra de progreso no se muestra en `Ready`.** Hasta ADR-087, `PipelineStatus` renderizaba
> la barra en todos los estados no-`Idle`, así que al llegar a `Ready` quedaba en `width: 0%` con
> el texto "Listo" al lado — el elemento más grande de la toolbar mostrando "0 %" mientras el
> texto decía "terminado" (ADR-087 Contexto §1, hallazgo 4). Una barra sin progreso que reportar
> no se dibuja.

> **El ancho del estado no puede ser fijo.** El `min-w-[220px]` anterior truncaba el texto a
> < 1100 px y a 900 px la barra quedaba tapada por el botón "Exportar".

### 7.2 La pantalla de escaneo (②a) y cuándo suelta (ADR-087 §6)

**Por qué existe.** Dos razones, y la segunda es la fuerte:

1. Acota el tiempo de espera sin nada que hacer y da **prueba de vida** — las entidades apareciendo
   distinguen "está trabajando" de "se colgó", cosa que una barra sola no logra.
2. **Protege al usuario de editar sobre datos que todavía se mueven.** Las entidades entran
   incrementalmente (UX-6) y cada una **renumera los marcadores** de todo el documento (§5.4b):
   `[PERSONA 03]` puede pasar a `[PERSONA 04]` bajo el cursor.

**Dónde se mide el umbral.** El tracker de progreso del Orchestrator **se reasigna por etapa**
(`orchestrator.ts:267`: *"OCR, luego Detecting con NER activo"*). El umbral se mide sobre
**`Detecting`**, que es la etapa larga y la que produce la mayoría de las entidades — no sobre
"% del documento", que promedia etapas de duración incomparable.

**La regla.** Se pasa de ②a a ②b cuando se cumple **la primera** de:

- `Detecting` procesó **≥ 20 %** de las páginas, o
- pasaron **6 s** desde `IMPORT_REQUESTED`;

y **nunca antes de 1,2 s** desde `IMPORT_REQUESTED`.

| Constante | Valor | Rol |
|---|---|---|
| `SCAN_ADVANCE_PAGE_RATIO` | `0.20` | Umbral de páginas analizadas en `Detecting`. |
| `SCAN_ADVANCE_MAX_MS` | `6000` | Techo. Un escaneado de 200 páginas no atrapa a nadie. |
| `SCAN_ADVANCE_MIN_MS` | `1200` | Piso. Un PDF de texto de 6 páginas no hace parpadear la pantalla. |

**Piso y techo son globales** (desde el import), no relativos a `Detecting`: la descarga del modelo
NER es tiempo muerto sin entidades, y un techo medido desde `Detecting` dejaría al usuario mirando
"preparando" sin cota. Con el techo global ese caso entra a ②b con el árbol vacío y el estado
honesto de §7.1.

### 7.3 Qué muestra la pantalla de escaneo

- Nombre del archivo y cantidad de páginas.
- Estado en lenguaje llano (los mismos textos de §7.1).
- Progreso `current`/`total` real de la etapa vigente, con porcentaje.
- **Las entidades apareciendo en vivo**, con su contador subiendo. Es el elemento que sostiene la
  paciencia del usuario, así que es el que tiene que estar visible — no un spinner.
- `Cancelar`.

**Sin skeleton del documento**: la pantalla de escaneo no promete un layout que todavía no existe.

### 7.4 Cancelación

- "Cancelar" visible siempre que `stage ∉ {Idle, Ready, Done, Failed, Cancelled}`.
  **`Ready` entra a la lista de ocultos** (ADR-087 §7): ahí el pipeline ya terminó, no hay nada que
  cancelar, y el botón aparecía con peso de secundario junto al CTA primario mientras su diálogo
  advertía que *"los cambios no guardados se perderán"* — una amenaza imposible.
- Sigue visible **durante el escaneo en segundo plano** de §7.2, que es cuando de verdad sirve.
- Click → modal de confirmación → `CANCEL_REQUESTED`.
- Tras cancelar, el documento queda en el último estado estable.

### 7.5 Error

Banner con el mensaje y las salidas disponibles ("Cerrar documento" siempre; "Desactivar NER y
reanalizar" cuando `error.code === "NER_MODEL_MISSING"`). Sin cambios respecto de la implementación
vigente.

---

## 8. Export

### 8.1 Botón "Exportar"

- Visible cuando `stage ∈ {Ready, Done}`.
- Click → diálogo de export (§8.2).

### 8.2 Diálogo de export (ADR-087 §5)

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

**Un solo control.** El criterio: **se pregunta lo que altera el documento, no lo que ajusta su
codificación.** El checkbox de referencia de marcadores sobrevive porque **suma una página**
(ADR-059 §6); los cinco campos técnicos no cambian qué dice el documento, solo cómo pesa.

Valores fijos, retirados del formulario:

| Campo | Valor fijo | Por qué |
|---|---|---|
| `imageFormat` | `"jpeg"` | Menor tamaño a fidelidad equivalente en documentos de texto (`core/Export_Engine.md` §13 caso 6). |
| `jpegQuality` | **`0.92`** | Visualmente indistinguible de `1.00` en texto; ver abajo. |
| `dpi` | `150` | Default de `ExportConfig`. |
| `title` (metadata) | `""` | `includeOriginalMetadata: false` ya protege lo que importa. |
| `filename` | `anonimizado.pdf` | El navegador ya deja renombrar al guardar. |

> **Por qué `0.92` y no `1.00`.** Se consideró `1.00` buscando "lo más cercano al original". No lo
> consigue: **el original ya se perdió al rasterizar a 150 DPI** — el export es 100 % imagen
> (`core/Export_Engine.md` §11, con test de CI). El JPEG solo decide cuánto de *esa imagen* se
> conserva, y de `0.92` a `1.00` el ojo no distingue nada en texto mientras el archivo crece ×3–4
> sobre q 0.85 (§12: ~100–300 KB/página a q 0.85 → un expediente de 100 páginas pasa de ~20 MB a
> ~80–120 MB). **La palanca de fidelidad real es el DPI**, y es la única de las cinco que valdría
> exponer bajo un `▸ Opciones avanzadas` si aparece el pedido.

**El resumen** muestra grupos habilitados / total y cantidad de páginas (`páginas + 1` con el
checkbox activo). Sin "tamaño estimado": no hay fórmula documentada para calcularlo.

### 8.3 Progreso de export

- Tras "Exportar": `EXPORT_STARTED` → barra de progreso con `EXPORT_PROGRESS`.
- Al finalizar: `EXPORT_FINISHED` → "Descargar" + "Exportar otro".

### 8.4 Pre-flight check

Si `enabledGroups = 0`: confirmación *"No hay grupos habilitados. El export será idéntico al
original. ¿Continuar?"*.

---

## 9. Accesibilidad

| Requisito | Implementación |
|---|---|
| Navegación por teclado | focus visible, tab order lógico, atajos para expandir/colapsar (arrows), seleccionar (space), abrir menú (Enter). |
| ARIA | `role="tree"` en el árbol de entidades, `role="treeitem"` por grupo, `aria-expanded` por tipo, `aria-checked` por checkbox, `aria-label` en iconos. |
| Contraste | WCAG AA mínimo (4.5:1 texto, 3:1 UI components). Paleta verificada. |
| Tamaño de texto | mínimo 14 px base, 16 px en texto de entidades. Zoom del browser respeta. |
| Focus visible | outline 2 px en accent color, nunca `outline: none` sin alternativa. |
| Reducción de movimiento | `prefers-reduced-motion` respeta; deshabilita animaciones de progreso. |
| Screen reader | el árbol anuncia tipo + count + estado; el visor anuncia "Página N de M, X grupos destacados". |
| Color blind safe | highlight de tipos también diferenciado por patrón (sólido/punteado) además de color. |

> **Deuda medida contra esta tabla** (auditoría de ADR-087, "Fuera del alcance" §1-§4). Estos
> requisitos están escritos acá desde la fase 4 y **no se cumplen** en la implementación
> vigente. Se listan para que la brecha sea explícita y no se lea esta tabla como estado real:
>
> - **Contraste**: el accent `#3b82f6` con texto blanco da **3.68:1**, bajo el 4.5:1 de esta
>   tabla. Afecta a todos los botones primarios y a los links `text-accent`.
> - **Tamaño de texto**: 12 px es el tamaño **más frecuente** de la interfaz (headers de panel,
>   links de acción, contadores, labels de formulario), contra el mínimo de 14 px de acá.
> - **Reducción de movimiento**: `prefers-reduced-motion` no aparece en el repo.
> - **Navegación por teclado**: los atajos de flechas / `Space` / `Enter` sobre el árbol y el
>   `Cmd/Ctrl+F` de la tabla de abajo no están implementados.

Atajos de teclado:

| Atajo | Acción |
|---|---|
| `Cmd/Ctrl+O` | importar PDF |
| `Cmd/Ctrl+D` | conmutar Original / Anonimizado |
| `Cmd/Ctrl+F` | buscar en entidades |
| `Cmd/Ctrl+E` | exportar |
| `Cmd/Ctrl+.` | cancelar pipeline |
| `Cmd/Ctrl++/-/0` | zoom visores |
| `↑/↓` | navegar grupos |
| `Space` | toggle grupo seleccionado |
| `Enter` | abrir menú contextual del grupo |
| `Esc` | cerrar modal/popover |

---

## 10. Performance percibida

- **First paint** (< 1.5 s desde import): mostrar la página 1 apenas PDF Engine la parsea. No esperar al pipeline completo.
- **Entidades apareciendo en vivo**: el árbol se va llenando a medida que `ENTITY_GROUP_CREATED` llega. El usuario percibe progreso.
- **Preview incremental**: con el toggle en Anonimizado (disponible desde `Ready`, §5.1), cada página aparece cuando se renderiza, no todas juntas.
- **Delta render**: al editar un grupo, solo las páginas afectadas se re-renderizan. El cambio se ve en < 150 ms.
- **Skeletons**: mientras una página se renderiza, mostrar skeleton gris con dimensión correcta (no spinner).

---

## 11. Estados vacíos

| Estado | UI |
|---|---|
| App recién abierta, sin documento | **No es un estado vacío: es el momento ① de §2.1**, pantalla completa. El panel de entidades no está montado, así que no tiene estado vacío que mostrar. |
| Escaneando, todavía sin entidades | En ②a (§7.3): el progreso real de la etapa, con el contador de entidades en 0. En ②b tras el pase temprano (§7.2): árbol vacío + el estado de la toolbar diciendo qué está pasando. **Nunca "Sin documento"**: hay documento. |
| Documento cargado, escaneo terminado, sin entidades | "No se detectaron entidades." + la salida concreta: agregar una a mano (§5.4b) o revisar la detección en Configuración. |
| Sin grupos habilitados | Confirmación al exportar (§8.4). |
| NER desactivado | Aviso en el árbol: "La detección de nombres está desactivada. Solo se detectan patrones (DNI, CUIT, emails…). [Activar]" — **sin nombrar "NER"**. |

> **"Sin reglas" se retira**: no hay panel de reglas (§4). El nivel documento y el nivel tipo de
> §3.4 son controles siempre presentes con un valor vigente, así que no tienen estado vacío.

---

## 12. Referencias

- `adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md` — reescribe §1, §2, §3, §4, §5, §7, §8 y §11
- `00_Project_Vision.md` §8 (layout — describe el layout de 4 paneles retirado por ADR-087 §1)
- `ui/React_Client.md` (UI Contract)
- `ui/Components.md` (catálogo)
- `ADR-011-Grouping-First.md`
- `ADR-012-Replacement-Modes.md`
- `07_Performance_Strategy.md` §3 (virtualización)
