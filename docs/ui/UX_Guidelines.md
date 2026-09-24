<!-- CONTEXT: scope=ux | dependencias=00_Project_Vision.md,ui/React_Client.md,ADR-011-Grouping-First.md,ADR-012-Replacement-Modes.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-150-La-Pantalla-De-Escaneo-Dura-Lo-Que-Dura-El-Escaneo.md,adr/ADR-151-La-Primera-Pagina-Ya-Esta-Dibujada-Cuando-Se-Abre-El-Panel.md,adr/ADR-152-La-Pantalla-De-Escaneo-Dice-En-Que-Pagina-Va.md,adr/ADR-168-Pantallas-De-Carga-Y-Escaneo-Tras-Pruebas-De-Usuario.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-170-Las-Vistas-Previas-De-Edicion-Las-Calcula-El-Core.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,adr/ADR-174-Un-Agregado-Manual-Que-Choca-Se-Resuelve-En-El-Momento.md,adr/ADR-175-Un-Choque-Manual-No-Queda-Colgado.md,adr/ADR-176-Un-Choque-Pendiente-Bloquea-El-Export.md,adr/ADR-177-Una-Entidad-Eliminada-No-Ocupa-Lugar.md | audiencia=IA-implementador-ui+humanos | fase=4 (§3.1 aclarado en fase 10, ADR-036 §9; §3.3/§5.4 en fase 10.5 por ADR-057 —tokens abreviados— y ADR-058 —el reemplazo no se derrama, marca de degradado—, §8.2 por ADR-059 —checkbox de referencia de marcadores—; §3.3/§5.4 en fase 10.6 por ADR-060 —género— y por ADR-071/ADR-072 —el control de género pasa a ser un botón de tres estados visible solo en `placeholder`/`synthetic`, con la marca de "sin determinar" fusionada adentro, y el sintético respeta el género y deja de cambiar solo—; §5.4b en fase 10.7 por ADR-061 —agregado manual de entidades—; §5.4 en fase 10.9 por ADR-076 —un texto de reemplazo escrito a mano se conserva, qué lo reemplaza y cómo se vuelve al automático— y ADR-074 §6 —la marca de degradado se enciende más seguido porque ahora mide contra el rectángulo real—; §1/§2/§3/§4/§5/§7/§8/§11 reescritos en el rediseño post-10.9 por **ADR-087** —tres momentos en vez de cuatro paneles: un solo visor con toggle, el modo de reemplazo en tres niveles del árbol, el panel de Reglas retirado, el export sin controles técnicos, y la pantalla de escaneo con piso y techo—; §7.2/§7.3 en fase 11 por ADR-150/ADR-151/ADR-152 — la pantalla de escaneo pierde el techo y suelta cuando el stage es terminal, precalienta la página 1 para no entrar a un panel vacío, y muestra progreso real por etapa incluido el OCR) -->

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
| UX-10 | **Diseño estable** (ADR-169 §1): ningún texto, aviso, error, globo ni control que aparezca o desaparezca agrega alto o ancho a un campo ni empuja a sus vecinos. Los mensajes que van y vienen tienen una **ranura de alto fijo** con el espacio de su estado más largo (texto neutro o vacía cuando no hay nada que decir); menús, selectores y globos son **flotantes**; los botones cuyo texto cambia tienen **ancho mínimo fijo**; contadores y columnas de la lista tienen **ancho fijo**; un recuadro con varios estados no cambia de tamaño entre ellos. Se revisa en cada PR de `apps/react-client`. |
| UX-11 | **Toda edición se deshace** (ADR-172): cada edición de entidades entra a una pila de deshacer/rehacer exacta, recorrida con `Ctrl/Cmd+Z` y `Ctrl/Cmd+Y` (`Ctrl/Cmd+Shift+Z`). Las acciones del menú ⋯ y los agregados además confirman con un toast con **"Deshacer"**. Lleva UX-4 de "reversible" a "reversible en un paso". |

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

Pantalla completa. Sin panel de entidades ni de reglas montados. **Organizada en cajas**
(ADR-168 §1), porque sin contenedores la pantalla se leía vacía:

- **Barra superior**: logo, nombre y el acceso a Configuración (ADR-125 §1).
- **Caja principal**: una frase de qué hace la herramienta y la **zona de carga funcional**: drop de
  archivo **y** botón, los dos operativos, con cuatro estados en el mismo recuadro (ADR-168 §2):

  | Estado | Cuándo | Qué dice |
  |---|---|---|
  | Reposo | sin archivo | "Arrastrá un PDF acá" · "Elegir archivo" · "Solo archivos PDF" (borde punteado animado) |
  | Arrastrando encima | `dragover` | "Soltá el archivo para abrirlo" · "Se abre acá mismo, no se sube a ningún lado" |
  | Abriendo | entre el drop y `DOCUMENT_IMPORTED` | "Abriendo el documento…" y el nombre del archivo; "Elegir archivo" deshabilitado |
  | Error | archivo rechazado o fallo de importación (§7.5) | "No se pudo abrir el archivo", el motivo y "Elegir otro archivo" |

  El recuadro **no cambia de tamaño** entre estados (§1, diseño estable).
- **Caja "Cómo funciona"**: animación en tres fases sincronizada con tres pasos (*Cargá el PDF ·
  Revisá lo detectado · Exportá la copia*).
- **Tres tarjetas** (todo local / detección automática / no se puede deshacer). Dicen **qué
  garantiza** la herramienta; no repiten los pasos de "Cómo funciona", que dicen qué hace el usuario.
- **Pie de página**: versión y licencia, "Acerca de…" (créditos y código fuente, ADR-168 §3) y
  "Reportar un problema".

> La versión anterior mostraba esta pantalla como "Hero" **dentro** del panel derecho, con el
> árbol de entidades vacío a la izquierda ocupando un tercio del ancho. Además su dropzone no
> aceptaba drops y su botón estaba deshabilitado: la afordancia visualmente dominante de la
> primera pantalla era decorativa (ADR-087 Contexto §1, hallazgo 5).

### 2.2 ②a Escanear

Pantalla de progreso **a pantalla completa, sin toolbar**: trae logo, estado, progreso y "Cancelar"
propios, así que una toolbar arriba dejaría dos barras de progreso del mismo pipeline y dos botones
"Cancelar" a la vez. Ver §7.2 para el umbral de salida y §7.3 para qué se muestra.

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

### 2.1 Anchos: tres formas del momento ③

El layout de 4 paneles que esta sección reemplaza tenía un párrafo de mobile (tabs por debajo de
1024 px, que implementaba `SideBySideViewer`); al retirarlo, ADR-087 §2 no escribió el reemplazo, y
eso dejó una regresión medida: a 375 px la barra lateral se comía 339 de 375 px y el visor quedaba
en **35 px**. El mecanismo era una sola regla (`w-1/3 min-w-[340px]`): por debajo de ~1020 px el
tercio cae bajo el mínimo, la barra **deja de encoger** y todo lo que falta se lo come al visor.

El reemplazo son tres formas, no dos, porque el problema tampoco era uno solo
(`components/screens/layoutMode.ts`):

| Ancho | Forma | Por qué |
|---|---|---|
| **≥ 1024 px** | barra lateral + visor, como hasta ahora | es el layout para el que se diseñó ADR-087 |
| **640–1023 px** | visor a todo el ancho, la barra lateral se abre **encima** a pedido (cajón) | una ventana en media pantalla de un laptop; este rango andaba casi bien y lo único que lo arruinaba era ese mínimo que no cede |
| **< 640 px** | aviso: la ventana es muy angosta | ni con el visor a pantalla completa entra una fila del árbol con su nombre, su contador y su selector de modo |

**Cajón y no tabs**, teniendo los dos el mismo costo: el bucle de trabajo es *mirar una entidad y
comprobarla en el documento*. Con tabs, cada comprobación es un cambio de contexto completo; con el
cajón, el documento es lo que queda debajo y vuelve con un `Escape`. El cajón es **modal**
(`aria-modal`, foco adentro, `Escape` y click en el fondo para cerrar) porque tapa el visor:
anunciarlo como región no modal mentiría sobre lo que hay debajo.

**El aviso dice que no entra, en vez de acomodar los píxeles hasta que "entre".** Las alternativas
eran encoger la tipografía —contra el piso de 14 px de §9— o esconder el selector de modo, que es la
mitad del trabajo. El texto **no** dice "usá una computadora": no se sabe en qué está el usuario, y
una ventana angosta en un monitor grande es el caso más probable. La app sigue viva atrás — al
ensanchar se vuelve sola al panel de trabajo, con el documento y las ediciones intactos.

---

## 3. Árbol de entidades

```
┌────────────────────────────────────────────────────────────────────────┐
│  Todo el documento                               [ Etiquetar      ▾ ]  │  ← §3.4 nivel documento
│  ⓘ Se aplica a todas las entidades.                                    │     (segunda línea fija, §3.4d)
└────────────────────────────────────────────────────────────────────────┘
   N.º  ENTIDAD                    AVISOS  APAR.        REEMPLAZO           ← encabezado de columnas
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ▾ ☑ • PERSONAS  (5)                                     ( Etiquetar ▾ )    ← §3.4 nivel tipo (franja)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ☐ 01  Pablo Roman               [?]       3   [♂]    Etiquetar ▾   ⋯   ← sugerida, apagada
   ☑ 02  María Laura Fernández               4   [♀]    Etiquetar ▾   ⋯
   ☑ 04  Carlos Gómez              [?][]↔[]  2          Tapar negro ▾ ⋯   ← ranura de género vacía (§3.3)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ▾ ☑ • DNI  (2)                                          ( Varios    ▾ )    ← §3.4b estado mixto
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ☑ 01  30.456.789                          1          Ocultar parcial ▾ ⋯
```

> **Rediseñado por ADR-169 §2** tras las pruebas de usuario de la 0.9.2: los tipos no se distinguían
> de sus filas, las filas no se distinguían entre sí (el usuario cambiaba el modo de la fila
> equivocada) y el número de cada entidad no aparecía en ningún lado.

### 3.1 Elementos del árbol

- **Encabezado de columnas**: **N.º · Entidad · Avisos · Apar. · Reemplazo**, fijo arriba del árbol.
  Existe para que el N.º no se confunda con el contador de apariciones.
- **Orden**: control segmentado **Aparición | A–Z** junto al filtro (ADR-169 §2). Aparición =
  `indexInType` ascendente; A–Z = `canonicalValue` con `localeCompare(…, "es")`. **Solo
  presentación**: no cambia `indexInType` ni emite nada al Core.
- **Franja de tipo**: `▾ <TIPO> (<n grupos>)`. Fondo gris con apenas el color del tipo (6 % en claro,
  7 % en oscuro) y **bordes superior e inferior gruesos** (`--color-border-strong`); queda fija arriba
  mientras se recorren sus filas. Click en la franja expande/colapsa. Un checkbox en la franja
  habilita/deshabilita todos los grupos del tipo (cascade).
- **Grupo** (fila): `☑ N.º <canonicalValue> [avisos] <n> [género] [modo ▾] [⋯]`, separada de la
  siguiente por un borde fino. **Todas las columnas tienen ancho fijo** salvo el nombre (UX-10). **La
  fila con un menú abierto se resalta** con fondo y contorno de acento.
  - Checkbox: habilita/deshabilita el grupo. La UI emite `GROUP_UPDATE_REQUESTED` con `patch.enabled` (canal `ui`); `GROUP_TOGGLED` es el evento que **Grouping** emite como respuesta (`04_Event_System.md` §6/§10 — aclaración ADR-036 §9).
  - **N.º**: `indexInType` con dos dígitos (`04`), en gris chico. Es el número del token
    (`[PERSONA 04]`), así que puede cambiar cuando el Core renumera (§5.4b); se muestra el vigente.
  - `<canonicalValue>`: el valor representativo del grupo; absorbe el encogido.
  - **Avisos** (§3.3): columna de ancho fijo; dos avisos juntos entran sin correr nada.
  - `<n>`: `members.length`, alineado a la derecha. No es editable.
  - **Género** (§3.3): ranura siempre reservada; el botón aparece solo donde ADR-071 lo dice.
  - `[modo ▾]`: selector de `ReplacementMode` (§3.4, §3.5). Cada opción muestra título, una descripción fija y la **vista previa exacta** del resultado (`EntityGroup.replacementPreviews`, ADR-170); elegir otra solo mueve el tilde (ADR-169 §6). **Presentación ghost** (ADR-087 §3.1): sin borde ni fondo hasta el hover, mostrando en gris el modo heredado del tipo. Gana borde **solo** cuando la fila fue puesta a mano — ahí el borde *es* la señal de excepción.
  - `[⋯]` (ADR-169 §10): **Ver apariciones · Editar reemplazo… · Cambiar tipo… · Fusionar con… · Dividir… · (separador) · Eliminar entidad** (en rojo, ADR-171). "Restaurar valor calculado" aparece solo si `replacementValueUserSet` (ADR-078). Toda acción confirmada muestra un toast con "Deshacer" (UX-11).
  - **El token de reemplazo (`[PERSONA 01]`) y el N.º no se muestran hasta `stage === Ready`** (ADR-087 §6.1): durante el escaneo cada entidad nueva renumera los índices, y el token sería el único lugar donde esa renumeración quedaría visible.
- **Botón "Agregar entidad"**: primario, en la cabecera del panel (ADR-169 §2).
- **Nota al pie del panel**: *"¿Falta algo? Seleccioná el texto con clic y arrastre en el PDF
  original, o buscalo con la lupa"*, con **X** para cerrarla (persistido en `settings.store`).

### 3.2 Interacciones

- **Fusionar** (ADR-169 §10): ⋯ → "Fusionar con…" → diálogo con la entidad de origen, una lista de **alto fijo** con filtro y casillas para elegir **una o varias** del mismo tipo, y una caja **"Resultado"** (nombre, N.º, apariciones y token, calculados por el Core con `previewEdit`, ADR-170). Confirmar emite un `GROUP_MERGE_REQUESTED` por cada una (`mergePlan`). El resultante conserva el menor `indexInType` y el nombre más frecuente.
- **Dividir** (ADR-169 §10): ⋯ → "Dividir…" → diálogo con cada aparición (página, la frase alrededor, origen *Detectado / Agregado por vos*) → se marcan las que van a una entidad nueva → dos tarjetas "Se quedan en N.º 02" → "Pasan a una nueva: Persona N.º NN" (N.º por `previewEdit`) → `GROUP_SPLIT_REQUESTED`. Si se marcan todas, el error ocupa la ranura de la nota informativa (UX-10).
- **Editar reemplazo** y **Cambiar tipo**: ver `Components.md` §3.4e y §3.8. Todas estas acciones confirman con un toast con "Deshacer" (UX-11).
- **Filtrar**: input que filtra grupos por `canonicalValue` o `aliases`. Atajo `Cmd/Ctrl+F`. Junto a él, el orden **Aparición | A–Z** (§3.1).
- **Colapsar todo / expandir todo**: botones en la cabecera del panel.

### 3.3 Estados

- **Grupo habilitado**: checkbox marcado, texto normal.
- **Grupo deshabilitado**: checkbox desmarcado, texto atenuado.
- **Los avisos** (ADR-169 §3) van en la columna de avisos, de ancho fijo, cada uno con **forma y color propios** — antes había dos "!" que significaban cosas distintas:

  | Aviso | Forma | Color | Significado |
  |---|---|---|---|
  | Sugerida (ADR-094) | `?` | ámbar (`--color-warning-strong`) | el detector no está seguro de que sea un dato personal |
  | Conflicto | una **Y que se abre en dos** | rojo (`--color-error`) | hay dos lecturas posibles del dato |
  | Espacio justo (ADR-062) | **`]↔[`**, flecha doble contra dos paredes | naranja (`--color-space`) | el reemplazo no entra y se achicó |

  Botones de 22 px con el fondo de su color al ~12 %; "espacio justo" mide **26×22** para que la
  flecha se lea. Cada uno abre su `Tooltip` (título + frase) y, al hacer clic, su acción.
- **Grupo con conflicto**: el aviso de conflicto de la tabla. Click abre el conflicto.
- **Grupo con el valor de reemplazo editado a mano** (ADR-078): punto azul al lado del nombre cuando `EntityGroup.replacementValueUserSet === true`, con `title` "Valor de reemplazo editado manualmente". El menú contextual del grupo ofrece **"Restaurar valor calculado"** solo en ese estado. Existe porque un `replacementValue` escrito a mano es **indistinguible** de uno calculado —`[P1]` es `[P1]`—, y desde ADR-076 sobrevive a todo recálculo automático: sin el punto, el usuario no puede revisar ni deshacer lo que editó antes de exportar. Es además el remedio que ADR-058 §4 y ADR-062 le ofrecen ante un reemplazo degradado, así que se usa de rutina.
- **Grupo con el `replacementMode` distinto del default de las reglas**: **no implementado**, y no lo estará sin un dato nuevo. Calcularlo exige `resolveMode(group, rules)`, que es la resolución de reglas de Grouping: la UI tendría que reimplementarla, que es fuera de su rol (`React_Client.md` U-3). Nota: esta señal era el paréntesis del estado "Grupo editado manualmente" en la redacción anterior, que **conflacionaba** dos cosas distintas — la de arriba (el valor lo escribió el usuario) y esta (el modo difiere del default). ADR-078 §Contexto 1 las separa. Esta es además la menos urgente de las dos: el modo ya se ve, en el `Select` de la propia fila.
- **Grupo con reemplazo degradado** (ADR-058 §7): marca al lado del nombre cuando alguna de sus ocurrencias quedó por debajo del umbral de legibilidad — el token no entraba, no se pudo repintar la línea y hubo que encogerlo. Click ofrece las tres salidas: editar el texto de reemplazo a mano, pasar el grupo a `redact` (que nunca tiene problema de espacio) o deshabilitarlo. **La marca existe para que el usuario sepa dónde mirar**: sin ella, el token quedó chico en la página 7 y solo se descubre haciendo zoom página por página. Por eso mismo tiene umbral y no aparece en cada fallback — una señal que aparece siempre no es una señal.

  > **La marca se va a encender más seguido desde ADR-074 §6**, y es correcto: hasta entonces, una entidad partida en dos líneas medía su encogido contra una envolvente del ancho de la página, así que el token "entraba" siempre y el aviso **nunca** se prendía justo en el caso peor. Ahora se mide contra el rectángulo donde el token se dibuja de verdad.

- **Un texto de reemplazo escrito a mano se conserva** (ADR-076): es la primera salida que ofrece la marca de degradado, y desde ADR-076 es confiable — no lo pisa la renumeración de los grupos al terminar el análisis, ni la inferencia de género, ni agregar entidades a mano, ni un re-análisis. **Lo único que lo reemplaza es cambiar el modo de reemplazo de ese grupo**, porque el texto que el usuario escribió lo escribió para un modo: un grupo en `mask` mostrando `[P1]` diría algo que nadie pidió. Eso incluye una **regla** de tipo o global que cambie el modo efectivo del grupo, que es el único caso en que el texto se pierde sin que el usuario haya tocado ese grupo.
  **Cómo se vuelve al texto automático**: cambiando el modo y volviendo al anterior. No hay un botón de "restaurar" y es deliberado — sería un control permanente más en la fila más común del árbol, para algo que se hace con el selector que ya está ahí (ADR-076 §5). Si el uso real muestra que hace falta, es una afordancia de UI que no toca el Core.
- **Grupo `Person` y su género** (ADR-060 §5-§6, rediseñado por ADR-071 §1-§4; forma por ADR-169 §4): un **botón chico de tres estados, con borde** (punteado en el neutro), en una **ranura siempre reservada** —si el modo no lo usa, la ranura queda vacía y nada se corre— —♀ / ♂ / círculo sin apéndice— que aparece **solo cuando el modo es `placeholder` o `synthetic`**, que son los únicos en los que el género cambia lo que se imprime. En `mask` y `redact` no aparece: sería una palanca sin nada del otro lado.
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

### 3.3b Deshacer: toda edición, exacto (ADR-172)

**Toda edición de entidades se deshace**, con `Ctrl/Cmd+Z` y se rehace con `Ctrl/Cmd+Y` (o
`Ctrl/Cmd+Shift+Z`): habilitar/deshabilitar, el modo en sus tres niveles, el género, editar el valor de
reemplazo, restaurar el calculado, cambiar tipo, fusionar, dividir, eliminar, agregar (por las tres
vías) y resolver un conflicto. Una acción del usuario es **un** paso, aunque por dentro emita varios
pedidos.

**Es exacto porque no se construye con la operación contraria.** Hasta ADR-172 esta sección explicaba
por qué fusionar, dividir, reclasificar y agregar a mano no se podían deshacer: la inversa devolvía un
grupo con otro `id` y otro número, o sea algo parecido y no lo mismo, y un "Deshacer" así miente. Esa
razón sigue siendo cierta, y por eso el deshacer **no invierte operaciones**: vuelve a un **punto de
restauración** del estado que guarda el Core antes de cada edición. El grupo vuelve con el mismo `id`,
el mismo número y el mismo token.

**Toasts con "Deshacer"**: toda acción del menú ⋯ y todo agregado muestran uno, con la pista `Ctrl+Z`
(UX-11). Los barridos de modo de tipo y documento y el cambio de habilitado ya lo tenían y lo
conservan. **La fila sigue sin toast al cambiar de modo** (§3.4d: es la acción más frecuente y es
autoevidente), pero ese cambio también se deshace con `Ctrl+Z`. Hay un solo toast de edición a la vez:
el botón deshace la última edición, que es siempre la que el toast nombra.

**Qué no se deshace**: ordenar o filtrar la lista, el zoom, la vista, Configuración y exportar — no son
ediciones del documento. **La pila no cruza un re-análisis**: cambiar los idiomas de OCR con un
documento abierto la vacía, y el diálogo de re-análisis lo dice.

**La franja de documento se enciende cuando tiene algo que destruir, sin crecer** (forma
reemplazada por ADR-169 §5 — antes era un borde izquierdo de acento más una línea que aparecía, y esa
línea empujaba el árbol hacia abajo):

```
sin ajustes previos:
┌────────────────────────────────────────────────────────┐
│  Todo el documento          [ Etiquetar         ▾ ]    │
│  ⓘ Se aplica a todas las entidades.                    │
└────────────────────────────────────────────────────────┘

con ajustes propios (caja entera en ámbar):
┌────────────────────────────────────────────────────────┐
│  Todo el documento          [ Etiquetar         ▾ ]    │
│  ⚠ 12 entidades tienen modo propio: cambiar este modo  │
│    las pisa.                                           │
└────────────────────────────────────────────────────────┘
```

La segunda línea **está siempre** (UX-10) y solo cambia su texto y color. El color aparece cuando
significa algo, y el resumen entera del riesgo **antes** de abrir el menú. **No se señala solo con
color** (ícono + texto además del acento). **Ámbar y no rojo**: la acción es reversible y no toca el
documento, solo los ajustes; el rojo queda para errores y confirmaciones irreversibles. El texto usa
`--color-warning-strong` (`Components.md` §10), **no** `--color-warning`, que no llega al contraste
mínimo.

### 3.5 Cómo se nombran los modos, y el resto del vocabulario

**Regla general** (ADR-087 §4): la interfaz nombra **el efecto**, no la etapa del pipeline ni el
mecanismo. "NER", "OCR", "DPI", "scope", "prioridad", "bbox" y "detectores" no aparecen en ningún
texto visible. Alcanza a los modos (abajo), al estado del pipeline (§7.1), a los mensajes de error
(§7.5), a las etiquetas de conflicto (§6) y a Configuración.

> **`DetectionSource` colapsa a dos etiquetas y no cuatro**: "Detectado automáticamente" y
> "Agregado por vos". Al usuario le cambia algo saber si una ocurrencia la agregó él; que la haya
> encontrado un patrón, un modelo de nombres o el reconocimiento de texto no cambia ninguna decisión
> suya, y las tres son la misma respuesta a "¿de dónde salió esto?".

`ReplacementMode` **no cambia** (ADR-012 sigue vigente). Cambian las etiquetas, que pasan a nombrar
**lo que se ve en el papel** y a traer un ejemplo:

| `ReplacementMode` | Etiqueta (menú) | Forma corta (disparador) |
|---|---|---|
| `Placeholder` | **Etiquetar** | Etiquetar |
| `Mask` | **Ocultar parcialmente** | Ocultar parcial |
| `Synthetic` | **Reemplazar por dato falso** | Dato falso |
| `Redact` | **Tapar con negro** | Tapar con negro |

La tercera columna es la **forma corta del disparador**: el selector de la fila mide 11 rem y
"Ocultar parcialmente" se cortaba en "Ocultar parcialme…". El **menú** —donde el usuario lee qué
hace cada modo— y el **nombre accesible** usan siempre la forma larga.

**El ejemplo se construye con el grupo real de esa fila**, no con un valor genérico: la pregunta
que el usuario tiene es qué le va a pasar *a su dato*. En el selector de nivel tipo usa el primer
grupo del tipo; en el de nivel documento es genérico.

> **Los cuatro modos muestran su valor exacto** (ADR-170): vienen calculados por Grouping en
> `EntityGroup.replacementPreviews`, con la misma función que `replacementValue`. Hasta ADR-170 solo
> el modo vigente era exacto y los otros tres se describían de forma esquemática, porque sus formatos
> viven en un motor y la UI no puede importar motores (P-1) ni reimplementarlos (U-3): un ejemplo
> *casi* correcto es peor que ninguno — la primera implementación mostraba `[PERSONA 01]` para
> **todos** los tipos. Cada opción lleva además una descripción fija, y elegir otra solo mueve el
> tilde (ADR-169 §6).

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
- Zoom (ADR-169 §9): botones `−` / `+` con el porcentaje entre ambos, **sin botón de restablecer**;
  atajos `Cmd/Ctrl + +`, `Cmd/Ctrl + -`, `Cmd/Ctrl + 0` (este último restablece). **Pellizco del
  trackpad y `Ctrl + rueda`**: el visor escucha `wheel` con `ctrlKey` en un listener
  `{ passive: false }` y hace `preventDefault()`, así el pellizco hace zoom del documento y no de la
  ventana. No hay texto que lo explique: es un comportamiento esperado, no una función a descubrir.
- **Separador entre páginas** (ADR-169 §9): un espacio con una línea punteada y la etiqueta
  *"Página N de M"* centrada, para que se note el paso de una página a otra al hacer scroll.
- **La barra del visor no cambia al conmutar**: la lupa (§5.4b) está siempre, en las dos vistas.

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

**Cómo se ve cada vía** (ADR-169 §7):

- **Botón "Agregar entidad"** (vía 1): primario, en la cabecera del panel. Abre un diálogo en dos
  pasos: *¿Qué texto querés ocultar?* —mientras se escribe, una caja de **alto fijo** muestra dónde
  aparece (página + frase con el texto resaltado, vía `findText`) o *"No aparece en el documento"*
  **antes** de confirmar— y *¿Qué es?* —el selector de tipos (`EntityTypePicker`: los 13 tipos en una
  caja gris, con punto de color y botón de opción). El botón dice cuántas apariciones va a ocultar.
- **Selección en el original** (vía 2): el recuadro se dibuja con **borde punteado de acento animado
  y no desaparece** hasta que se agrega, se cancela, se hace otra selección, se presiona Escape, se
  conmuta a Anonimizado o se cierra el documento. El globo "Agregar «X» como…" es flotante y usa el
  mismo `EntityTypePicker`.
- **Lupa** (vía 3): **siempre visible y habilitada, en las dos vistas**. Campo *"Buscar un texto en el
  documento…"*, contador en ranura fija y un botón **"+ Agregar"** aparte, habilitado con resultados.
  Cada resultado muestra página, la frase alrededor (`getPageWords` + `wordSpan`) y su estado:
  **oculto como Persona N.º 02** (cae sobre un miembro de un grupo, comparando contra
  `fragments` cuando los hay, ADR-074) o **Sin ocultar** con "Agregar como…" en globo flotante. El
  encabezado resume "N ocultos · M sin ocultar". "Ver apariciones" del menú ⋯ abre la lupa con el valor.
- **Toast al agregar**, por cualquiera de las tres vías: *"Agregaste «X» · Persona N.º 06 · 2
  apariciones ocultas"*, con **"Ver en la lista"** (lleva la fila a la vista y la resalta) y
  **"Deshacer"** (UX-11). El N.º es el que quedó **después** de la renumeración. **Solo si lo agregado
  quedó en un grupo**: el toast no puede afirmar algo que no pasó.
- **Si lo agregado choca con un dato ya detectado** (ADR-174): se superpone con una detección de otro
  tipo y el Core no lo agrupa. En vez del toast se abre un diálogo que lo dice y obliga a elegir —
  *"Lo que marcaste se superpone con un dato ya detectado. ¿Qué querés ocultar?"*, con los dos textos
  y sus tipos: **"Ocultar lo que marqué"** o **"Dejar lo que ya estaba detectado"**—. Cerrarlo sin
  elegir deja un toast de advertencia persistente con **"Resolver"**, y el export queda bloqueado por
  el conflicto hasta que se elija. Las dos opciones se deshacen con `Ctrl+Z`.
  - **Varios lugares** (ADR-175 §4): si choca en más de un lugar, una sola pregunta —*"…se superpone
    con datos ya detectados en N lugares…"*— y la elección vale para todos, con un solo `Ctrl+Z`.
  - **El aviso vuelve** (ADR-175 §5): mientras quede un choque sin resolver y el diálogo esté cerrado, el
    aviso ocupa la ranura de toast; si otro toast lo tapa, vuelve cuando ese se va. No reserva espacio
    propio.
  - **Si la detección desaparece** (ADR-175 §1): eliminar la entidad detectada oculta lo marcado, y el
    toast de eliminar lo dice: *"Eliminaste «Y» · Lo que marcaste («X») ahora se oculta"*.
  - La pantalla nunca dice "no se encontró" sobre algo que el Core encontró: decide con
    `heldConflictIds` y `groupIds` del resultado, no buscando el grupo por su cuenta.
- **Descubrimiento**: en Original, una tarjeta sobre el visor con la animación del gesto de clic y
  arrastre — *"Agregá entidades desde el documento"* — que se cierra con "Entendido" y no vuelve
  (persistido). Se suma a la nota al pie del panel (§3.1).

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

> Durante ②a el estado no lo muestra la toolbar sino la propia pantalla de escaneo (§2.2/§7.3).
> Esta sección describe la toolbar del panel de trabajo.

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

### 7.2 La pantalla de escaneo (②a) y cuándo suelta (ADR-150, ADR-151)

**Por qué existe.** Dos razones, y la segunda es la fuerte:

1. Acota el tiempo de espera sin nada que hacer y da **prueba de vida** — las entidades apareciendo
   distinguen "está trabajando" de "se colgó", cosa que una barra sola no logra.
2. **Protege al usuario de editar sobre datos que todavía se mueven.** Las entidades entran
   incrementalmente (UX-6) y cada una **renumera los marcadores** de todo el documento (§5.4b):
   `[PERSONA 03]` puede pasar a `[PERSONA 04]` bajo el cursor.

**La regla, desde ADR-150 (antes había además un techo de 6 s y un umbral de 20 % de páginas en
`Detecting` — ver el ADR para por qué se retiraron: no hay techo que cumpla las dos razones de
arriba a la vez, porque cualquier pase antes de `Ready` es un pase sobre datos en movimiento).**
La única condición de pase es que el `stage` sea terminal:

- **`Ready`/`Done`** ⇒ se pasa cuando se cumplen las dos: pasaron **1,2 s** desde el import (el
  piso, que evita el parpadeo de un PDF chico), y la **página 1 ya está dibujada** —el precalentado
  de ADR-151— o vencieron **1 s** desde que se alcanzó `Ready` (la gracia, para que un render que
  falla o se cuelga no encierre a nadie). Vencer la gracia **no es un error**: se entra igual y el
  panel se llena como antes de ADR-151.
- **`Failed`/`Cancelled`** ⇒ se pasa **de inmediato**, sin piso y sin esperar ningún preview: no
  hay panel que llenar, y retener al usuario frente a un error sería retenerlo sobre el error.
  **Adónde** (ADR-168 §4): un `Failed` de importación —última etapa `Importing`/`Extracting`—
  vuelve a ① con el error en la zona de carga; cualquier otro `Failed` y todo `Cancelled` pasan a ②b.
- Cualquier otro stage ⇒ se queda.

| Constante | Valor | Rol |
|---|---|---|
| `SCAN_ADVANCE_MIN_MS` | `1200` | Piso desde el import. Un PDF de texto de 6 páginas no hace parpadear la pantalla. |
| `SCAN_ADVANCE_PREWARM_GRACE_MS` | `1000` | Gracia desde `Ready`/`Done` para que la página 1 precalentada (ADR-151) aparezca. |

**Sin techo.** ②a dura lo que dure el trabajo: un escaneado de 200 páginas retiene al usuario todo
el escaneo, en vez de soltarlo a los 6 s con el árbol vacío. Lo que hace tolerable la espera sin
cota es progreso real por etapa (§7.3, ADR-152) y `Cancelar` operativo (§7.4) — si una etapa deja
de reportar avance, la espera se vuelve ciega, y por eso ADR-152 es parte de esta misma decisión y
no un trabajo aparte.

**Qué encuentra el usuario al entrar**, por construcción: el árbol de entidades completo y los
marcadores quietos, el botón de exportar visible (`stage ∈ {Ready, Done}` es también su condición
de montaje) y la página 1 ya dibujada.

### 7.3 Qué muestra la pantalla de escaneo

- **La animación del documento**: una página con renglones, una lupa que la recorre de arriba abajo
  encendiendo los renglones a su paso, y la página desplazándose y difuminándose contra los bordes
  para simular que se pasan páginas. Es lo que sostiene la paciencia: dice "está recorriendo todo el
  documento" sin pedirle al usuario que lea nada.
- Nombre del archivo y cantidad de páginas.
- **Una frase que rota los tipos de dato** que se están buscando ("Buscando *nombres* → *DNI* →
  *direcciones*…"), con cada término armándose y deshaciéndose por fundido. Dice **qué** busca, y
  acompaña a la etapa vigente — **desde ADR-152 §4 deja de ser el contenido principal**: con
  `Ready` sin techo (§7.2, ADR-150) esta pantalla puede durar minutos, y una frase que cicla sin
  cambiar de estado es indistinguible de una app colgada. Si la etapa vigente tiene contador, el
  contador manda.
- Estado en lenguaje llano.
- Progreso, con un rótulo y un número por etapa (ADR-152 §1):

  | Etapa | Qué se muestra | Progreso |
  |---|---|---|
  | `Importing`/`Extracting` | "Abriendo el documento…" | indeterminado |
  | `OCRing` | "Leyendo el documento…", **página X de Y** | determinado — barra con `current`/`total` del trabajo de OCR, contador con `X` = última página leída (`OCR_PAGE_FINISHED.pageIndex + 1`) e `Y` = `pageCount` |
  | `Detecting`, modelo cargando | "Preparando el detector…" | indeterminado |
  | `Detecting`, detectando | "Escaneando el documento…", **página X de Y** | determinado — `X = current`, `Y = pageCount` |
  | `Grouping` | "Ordenando los resultados…" | indeterminado |

- `Cancelar`, visible y efectivo mientras el escaneo corre (ADR-152 §5), con el atajo `Ctrl+.`
  escrito al lado.
- **El flujo de cuatro pasos** (ADR-168 §5), en su propia caja entre la animación y el progreso.
  Es el mapa que le faltaba al usuario para no leer "Leyendo… 3 de 12" seguido de "Escaneando… 1 de
  12" como que el análisis volvió a empezar:

  | Paso | Etapas | Rótulo en curso → terminado | Qué hace |
  |---|---|---|---|
  | 1 | `Importing`, `Extracting` | Abriendo → Abierto | Carga el archivo |
  | 2 | `OCRing` | Leyendo → Leído | Saca el texto de cada página |
  | 3 | `Detecting` (incluye la carga del modelo) | Escaneando → Escaneado | Busca datos sensibles |
  | 4 | `Grouping` | Ordenando → Ordenado | Agrupa lo encontrado |

  **Los cuatro pasos están siempre.** Si el pipeline llega a `Detecting` sin pasar por `OCRing`, el
  paso 2 se muestra terminado con *"El PDF ya tenía texto"*. Nunca se muestran tres pasos: una UI
  que cambia de forma según el documento cambia mientras el usuario la mira.

La animación y el archivo van en una caja; la barra de progreso y `Cancelar`, en otra.

> **Regla dura: el total que se muestra es siempre `document.store.pageCount`**, en las dos etapas
> con contador (ADR-152 §2). En un documento mixto (20 páginas, 8 escaneadas) mostrar "3 de 8"
> sobre un documento que el usuario sabe que tiene 20 se lee como "cargué el archivo equivocado", no
> como "3 de las 8 que hay que leer" — y un usuario que ve un total que no reconoce cancela justo
> cuando la herramienta está funcionando bien. Por eso en `OCRing` el número de página **no** cuenta
> cuántas se leyeron: es **cuál** se está leyendo, numerada sobre el documento entero. La barra, en
> cambio, sí usa el tamaño real del trabajo de OCR — avanza pareja aunque los números de página
> salten.
>
> **Dos contadores, dos denominadores, y ninguno de los dos es un defecto.** `OCRing` y `Detecting`
> son trabajos distintos y cada uno lleva su rótulo; que el número vuelva a empezar al cambiar de
> etapa es correcto. Lo que se prohíbe es que retroceda **sin** cambiar de rótulo.
>
> **Pendiente de validar con usuarios**: en un documento mixto, el número de página del OCR salta
> (va por la 3 y después por la 12, porque las del medio ya tenían texto). Cada afirmación es
> cierta, pero el salto en sí no está probado — `roadmap/Post_Hito10.8_Pendientes.md` §32 tiene el
> plan y las dos salidas si molesta. En un documento enteramente escaneado, el caso frecuente, no
> hay salto.

> **Sin la lista de entidades encontradas.** Una versión anterior de esta sección las mostraba
> apareciendo en vivo acá. Se retira: **se ven mejor donde importan**, que es el árbol de ②b, donde
> llegan con su tipo, su contador y sus controles y el usuario puede actuar sobre ellas. Repetirlas
> antes, en una lista que dura tres segundos y de la que no se puede hacer nada, gasta la primera
> impresión del dato en un lugar donde no sirve.

**Sin skeleton del documento**: la pantalla de escaneo no promete un layout que todavía no existe.

**Todo el movimiento respeta `prefers-reduced-motion`** (§9): con movimiento reducido queda un
documento quieto con la lupa apoyada y la frase sin fundido, que siguen diciendo lo mismo.

### 7.4 Cancelación

- "Cancelar" visible siempre que `stage ∉ {Idle, Ready, Done, Failed, Cancelled}`.
  **`Ready` entra a la lista de ocultos** (ADR-087 §7): ahí el pipeline ya terminó, no hay nada que
  cancelar, y el botón aparecía con peso de secundario junto al CTA primario mientras su diálogo
  advertía que *"los cambios no guardados se perderán"* — una amenaza imposible.
- Sigue visible **durante el escaneo en segundo plano** de §7.2, que es cuando de verdad sirve.
- Click → modal de confirmación → `CANCEL_REQUESTED`.
- Tras cancelar, el documento queda en el último estado estable.

### 7.5 Error

**Un fallo de importación vuelve a la zona de carga** (ADR-168 §4). Si `PIPELINE_FAILED` llega
cuando la última etapa fue `Importing` o `Extracting` —el documento todavía no tiene nada que
revisar, por ejemplo `PDF_INVALID`—, la UI cierra el documento y vuelve a ①, con la zona de carga en
estado **Error**, el nombre del archivo y el motivo. Antes pasaba a ②b con un banner cuya única
salida era cerrar: dos pasos para volver al lugar donde se corrige.

Cualquier otro fallo —en `OCRing`, `Detecting` o `Grouping`, cuando ya hay documento— sigue
mostrándose en ②b:

Banner con el mensaje y las salidas disponibles: **"Cerrar documento", siempre**.

`NER_MODEL_MISSING` ofrecía además "Desactivar NER y reanalizar", y **ADR-126 §2 lo retira**. Ese
botón parecía una recuperación y era una trampa: producía un documento que llega a "Listo" y se
exporta como anonimizado con los identificadores tapados y **todos los nombres intactos**. Un
análisis al que le falta justamente la categoría más sensible no es un resultado degradado, es un
resultado equivocado con cara de éxito. La salida de ese error es reintentar, y el mensaje lo dice.

---

## 8. Export

### 8.1 Botón "Exportar"

- Visible cuando `stage ∈ {Ready, Done}`.
- Click → diálogo de export (§8.2).
- **Bloqueado con un conflicto sin resolver** (ADR-176 §1): deshabilitado, con el motivo en un globo
  flotante debajo, anclado a la derecha (ADR-177 §4) —*"Hay un choque sin resolver. Resolvelo para exportar."* y **"Resolver"**, igual al del
  aviso de ADR-175 §5—. `Cmd/Ctrl+E` tampoco abre el diálogo. El Core además rechaza el export.

### 8.2 Diálogo de export (ADR-087 §5)

```
Exportar documento anonimizado
─────────────────────────────────────────
  12 de 12 entidades serán anonimizadas
  10 páginas

  Nombre del archivo
  [ pericia-quilmes                        ]

  [ ] Agregar una página con la referencia de marcadores
      Explica qué significa cada marcador (PRS = Persona,
      MAT = Matrícula…). Solo los tipos: nunca los datos
      originales.

                          [Cancelar]  [Exportar]
```

**Dos controles.** El criterio: **se pregunta lo que altera el documento, no lo que ajusta su
codificación.** El checkbox de referencia de marcadores sobrevive porque **suma una página**
(ADR-059 §6); el nombre de archivo porque **identifica el resultado** y es una decisión del usuario.
Los cuatro campos técnicos no cambian qué dice el documento, solo cuánto pesa.

> **El nombre volvió al formulario** tras la prueba manual. La primera versión de esta sección lo
> fijaba junto con los técnicos, argumentando que "el navegador ya deja renombrar al guardar" — es
> **falso** en la configuración por defecto de Chrome, que descarga directo sin diálogo. Y no era de
> la misma clase que los otros: no ajusta la codificación.
>
> **Sin validación**: un nombre vacío cae al default y la extensión `.pdf` se completa sola. El
> campo arranca poblado, así que vaciarlo es "no me importa el nombre", no un error que merezca
> frenar el export.

Valores fijos, retirados del formulario:

| Campo | Valor fijo | Por qué |
|---|---|---|
| `imageFormat` | `"jpeg"` | Menor tamaño a fidelidad equivalente en documentos de texto (`core/Export_Engine.md` §13 caso 6). |
| `jpegQuality` | **`0.92`** | Visualmente indistinguible de `1.00` en texto; ver abajo. |
| `dpi` | `150` | Default de `ExportConfig`. |
| `title` (metadata) | `""` | `includeOriginalMetadata: false` ya protege lo que importa. |

> **Por qué `0.92` y no `1.00`.** Se consideró `1.00` buscando "lo más cercano al original". No lo
> consigue: **el original ya se perdió al rasterizar a 150 DPI** — el export es 100 % imagen
> (`core/Export_Engine.md` §11, con test de CI). El JPEG solo decide cuánto de *esa imagen* se
> conserva, y de `0.92` a `1.00` el ojo no distingue nada en texto mientras el archivo crece ×3–4
> sobre q 0.85 (§12: ~100–300 KB/página a q 0.85 → un expediente de 100 páginas pasa de ~20 MB a
> ~80–120 MB). **La palanca de fidelidad real es el DPI**, y es la única de las cinco que valdría
> exponer bajo un `▸ Opciones avanzadas` si aparece el pedido.

**El resumen** muestra entidades habilitadas / total y cantidad de páginas (`páginas + 1` con el
checkbox activo). Sin "tamaño estimado": no hay fórmula documentada para calcularlo — el tamaño
real se informa **al terminar**, en el resultado ("Exportación completa (239 KB)"), que es cuando el
dato existe de verdad.

### 8.3 Progreso de export

- Tras "Exportar": `EXPORT_STARTED` → barra de progreso con `EXPORT_PROGRESS`.
- Al finalizar: `EXPORT_FINISHED` → "Descargar" + "Exportar otro".
- **Tras apretar "Descargar"**, el panel confirma —"Se descargó *nombre*"— y ofrece las salidas:
  "Descargar de nuevo", "Abrir otro documento" (cierra el documento y vuelve a ①) y "Listo".

  > **No afirma que la descarga terminó bien**, y es deliberado: el navegador no da ninguna señal de
  > éxito ni de fallo para un `<a download>`. El panel dice lo que sí es cierto —el archivo se
  > generó y se mandó a descargar— y deja el reintento a la vista en vez de esconderlo detrás de un
  > fallo que no se puede detectar. En una herramienta cuyo resultado **es** el archivo, afirmar un
  > éxito que no se verificó es la mentira más cara posible.
- **Cerrar el diálogo no pierde el resultado**: mientras haya un `exportResult` vigente, reabrirlo
  muestra el resultado (con su "Descargar" y el nombre que se usó), no un formulario en blanco.
  Antes el `blobUrl` seguía existiendo en `pipeline.store` y la UI no tenía **ningún** camino de
  vuelta a él: la única salida era volver a exportar.

### 8.4 Pre-flight check

Si `enabledGroups = 0`: confirmación *"No hay grupos habilitados. El export será idéntico al
original. ¿Continuar?"*.

Un conflicto sin resolver **no** es una confirmación: bloquea antes de llegar acá (§8.1, ADR-176 §1).

---

## 9. Accesibilidad

| Requisito | Implementación |
|---|---|
| Navegación por teclado | focus visible, tab order lógico, atajos para expandir/colapsar (arrows), seleccionar (space), abrir menú (Enter). |
| ARIA | `role="tree"` en el árbol de entidades (**con un desvío conocido**, ver abajo), `role="treeitem"` por grupo, `aria-expanded` por tipo, `aria-checked` por checkbox, `aria-label` en iconos. |
| Contraste | WCAG AA mínimo (4.5:1 texto, 3:1 UI components). Paleta verificada. |
| Tamaño de texto | mínimo 14 px base, 16 px en texto de entidades. Zoom del browser respeta. |
| Focus visible | outline 2 px en accent color, nunca `outline: none` sin alternativa. |
| Reducción de movimiento | `prefers-reduced-motion` respeta; deshabilita animaciones de progreso. |
| Screen reader | el árbol anuncia tipo + count + estado; el visor anuncia "Página N de M, X grupos destacados". |
| Color blind safe | highlight de tipos también diferenciado por patrón (sólido/punteado) además de color. |

> **Estado contra esta tabla** (la deuda medida en la auditoría de ADR-087, "Fuera del alcance"
> §1-§4, quedó saldada; se deja el rastro porque estos requisitos estuvieron escritos acá sin
> cumplirse desde la fase 4):
>
> - **Contraste**: **cerrado**. El accent era `#3b82f6` (3.68:1 con texto blanco, bajo el 4.5:1
>   de esta tabla, y afectaba a todo botón primario y a los links `text-accent`). Ahora es
>   `#2563eb`: **5.17:1**, y sirve tanto de relleno con texto blanco encima como de texto sobre
>   `bg-primary`. El `hover` sigue siendo un paso más oscuro.
> - **Tamaño de texto**: **cerrado**. No queda ningún `text-xs` (12 px) en la interfaz; el piso
>   es 14 px. La barra lateral fue el único lugar que necesitó reacomodarse: sus tres acciones
>   pasaron a una fila propia debajo del título, porque al lado ya no entraban.
> - **Reducción de movimiento**: **cubierto desde el rediseño de estilo**. Todas las animaciones
>   (marca, landing, pantalla de escaneo) se declaran **dentro** de un `@media (prefers-reduced-motion:
>   no-preference)`, no sueltas con una excepción aparte: así el default es el estado quieto y una
>   regla nueva no puede olvidarse de la excepción.
> - **Navegación por teclado**: **cerrado, con un desvío conocido y anotado**. El árbol implementa
>   flechas verticales, `ArrowRight`/`ArrowLeft` con la semántica del patrón (abrir → primer hijo;
>   cerrar → padre), `Home`/`End`, `Space` y `Enter` (`treeNavigation.ts` decide qué hace cada
>   tecla; `EntitiesPanel` ejecuta), y `Cmd/Ctrl+F` enfoca el buscador de entidades. Antes el panel
>   declaraba `role="tree"` y no respondía a **ninguna** tecla.
>
>   **Lo que NO cumple**: el patrón WAI-ARIA de tree pide **un solo tab stop** para todo el árbol, y
>   acá hay ~5 por fila visible — el `treeitem` más su checkbox, su selector de modo, su toggle de
>   género y su menú, que son botones con tab stop propio. El rol correcto para filas con controles
>   es **`role="treegrid"`**, donde las flechas navegan filas *y* celdas y por eso nada queda
>   inalcanzable; migrar es un cambio grande y queda fuera del alcance de ADR-087. Mientras tanto el
>   `role="tree"` es **aspiracional en esa parte**, y eso está en tensión reconocida con el
>   precedente de `role="menu"` (`Components.md` §3.4). La diferencia que justifica no retirarlo —y
>   no es una diferencia cómoda— es de grado: aquel rol prometía navegación por flechas, `Home`/`End`
>   y foco gestionado, y no implementaba **nada**; éste implementa todo salvo el tab stop único, y
>   retirarlo perdería además la estructura (nivel, expandido, tamaño del conjunto) que el lector de
>   pantalla sí aprovecha. El desvío queda anotado como pendiente en
>   `roadmap/Post_Hito10.8_Pendientes.md` §22, con `treegrid` como destino.

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
