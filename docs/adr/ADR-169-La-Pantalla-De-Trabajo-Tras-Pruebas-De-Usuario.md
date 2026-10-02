<!-- CONTEXT: scope=adr | dependencias=adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-062-Veredicto-De-Degradacion-Hasta-La-UI.md,adr/ADR-071-El-Genero-Se-Muestra-Solo-Donde-Se-Usa.md,adr/ADR-078-La-Edicion-Manual-Es-Visible-En-La-UI.md,adr/ADR-094-Lo-Que-El-Detector-Duda-No-Se-Tira-En-Silencio.md,adr/ADR-168-Pantallas-De-Carga-Y-Escaneo-Tras-Pruebas-De-Usuario.md,adr/ADR-170-Las-Vistas-Previas-De-Edicion-Las-Calcula-El-Core.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,ui/UX_Guidelines.md,ui/Components.md,ui/React_Client.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-169 — La pantalla de trabajo tras las pruebas de usuario

- **Estado**: Accepted
- **Fecha**: 2026-09-23
- **Decidido por**: El humano, sobre las pruebas de usuario de la 0.9.2 y el lienzo de diseño
  "Anonly — Nueva pantalla inicial" (páginas *Pantalla de trabajo* y *Pantalla de trabajo ·
  oscuro*), iterado en varias rondas.
- **Reemplaza**: `UX_Guidelines.md` §3.4d en la forma de la franja "Todo el documento" (el borde
  izquierdo); la nota de ADR-087 sobre las descripciones **esquemáticas** del selector de modo (§6,
  ahora exactas por ADR-170); el botón de restablecer zoom de `Components.md` §5.5.
- **No reemplaza**: ADR-071 — el botón de género sigue visible solo en `placeholder`/`synthetic`.
- **Relacionado con**: ADR-168 (pantallas ① y ②a), ADR-170 (vistas previas), ADR-171 (eliminar),
  ADR-172 (deshacer), ADR-061 (las tres vías de agregado), ADR-062/ADR-094 (los avisos),
  ADR-078 (el punto de edición manual).
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

Las pruebas de usuario sobre la 0.9.2 dejaron una lista concreta sobre ②b:

1. Texto blanco sobre blanco al pasar el mouse por los avisos en **modo oscuro**: `Tooltip` pinta
   `bg-text-primary` con `text-white`, y en oscuro `text-primary` es casi blanco. `ConflictBadge`
   usa `hover:bg-red-50`, que en oscuro es un fondo claro.
2. El selector de modo de reemplazo **cambia sus textos al elegir**: el modo vigente muestra el valor
   exacto y los otros tres una descripción esquemática (ADR-087, por P-1). Al elegir otro, todo el
   menú se reescribe y el usuario pierde la referencia.
3. Agregar una entidad desde la lupa o desde la selección **no confirma nada**: el usuario no sabe si
   se agregó hasta revisar la lista.
4. "Agregar entidad" es un enlace de texto chico, casi invisible.
5. Nada dice que se puede **seleccionar texto en el original** para agregar una entidad.
6. La lista no distingue a simple vista un tipo de sus filas, ni una fila de la siguiente: el
   usuario termina cambiando el modo de la fila equivocada.
7. El número que identifica a cada entidad en el documento (`PERSONA 04`) no aparece en la lista.
8. No se puede ordenar la lista.
9. No se puede eliminar una entidad.
10. Hay dos avisos con el mismo "!" que significan cosas distintas, y un tercero ("?") que no se
    distingue del resto. Los avisos **corren** el contador de apariciones cuando aparecen.
11. El botón de restablecer zoom sobra; falta el zoom con pellizco del trackpad.
12. No se nota el paso de una página a la siguiente al hacer scroll.
13. La lupa no dice que sirve para agregar, y **aparece y desaparece** al cambiar entre Original y
    Anonimizado.
14. El diálogo "Agregar entidad" es un texto largo y dos campos, y recién al confirmar dice si el
    texto no estaba en el documento.
15. La selección sobre el PDF desaparece antes de que el usuario termine de elegir el tipo.

Y dos reglas generales que el humano fijó para toda la UI:

- **Nada desplaza el diseño** (ver §1).
- **Toda acción del menú ⋯ confirma con un toast con "Deshacer"**, y existe Ctrl+Z / Ctrl+Y
  (ADR-172).

## Decisión

### 1. Regla general: el diseño es estable

**Ningún texto, aviso, error, globo ni control que aparezca o desaparezca puede agregar alto ni ancho
a un campo ni empujar a sus vecinos.** Concretamente:

- Un mensaje que va y viene (error, aviso, ayuda) tiene una **ranura de alto fijo** reservada con el
  espacio de su estado más largo. Cuando no hay nada que decir, muestra un texto neutro o queda
  vacía, pero ocupa lo mismo. Ejemplo del humano: en Configuración, la descripción del perfil de
  rendimiento ocupa el mismo renglón para los tres perfiles.
- Selectores, menús y globos son **flotantes** (`position: absolute` o portal): nunca expanden la
  fila o la tarjeta que los abre.
- Un botón cuyo texto cambia ("Fusionar 3 entidades", "Agregar 2 apariciones") tiene **ancho mínimo
  fijo**.
- Contadores y columnas de la lista tienen **ancho fijo**: los avisos no corren a las apariciones.
- Un recuadro con varios estados (la zona de carga, la franja "Todo el documento", la caja de
  resultados de "Agregar entidad") **no cambia de tamaño** entre estados.

Va como principio en `UX_Guidelines.md` §1 y se revisa en cada PR de `apps/react-client`.

### 2. La lista de entidades se jerarquiza y se vuelve tabla

- **Franja de tipo**: fondo gris con apenas el color del tipo encima (6 % en claro, 7 % en oscuro),
  bordes superior e inferior **gruesos** (`--color-border-strong`), nombre en mayúsculas, contador en
  pastilla. **Queda fija arriba** (`sticky`) mientras se recorren sus filas.
- **Filas**: separadas por un borde fino (`--color-border`), más altas que hoy. La última fila del
  grupo no lleva borde: la franja siguiente ya separa. **La fila con un menú abierto (reemplazo o ⋯)
  se resalta** con fondo y contorno de acento, y el menú nombra la entidad ("Cómo reemplazar
  **Juan Pérez**"): es la defensa contra editar la fila equivocada.
- **Encabezado de columnas** fijo arriba del árbol: **N.º · Entidad · Avisos · Apar. · Reemplazo**.
  Así el N.º no se confunde con el contador de apariciones.
- **N.º** es `indexInType` con padding de dos dígitos (`04`), en gris chico. Es el mismo número del
  token (`[PERSONA 04]`). Sigue la regla de ADR-087 §6.1: no se muestra hasta `Ready`. **Puede
  cambiar** cuando el Core renumera (agregar a mano, re-análisis: `UX_Guidelines.md` §5.4b); la UI
  siempre muestra el vigente y no anima el cambio.
- **Orden**: control segmentado **Aparición | A–Z** junto al filtro. Aparición = `indexInType`
  ascendente; A–Z = `canonicalValue` con `localeCompare(…, "es")`. **Es solo presentación**: no
  cambia `indexInType` ni emite nada al Core. El orden elegido vale para todos los tipos y se recuerda
  mientras la app está abierta (`entities.store`, no persiste).
- **Columnas de ancho fijo**: check · N.º · nombre (el que absorbe el encogido) · avisos · apariciones
  · género · reemplazo · ⋯.
- **"Agregar entidad"** pasa a ser un **botón primario** en la cabecera del panel.

### 3. Los avisos tienen forma y color propios

| Aviso | Forma | Color | Significado |
|---|---|---|---|
| Sugerida (ADR-094) | `?` | ámbar (`--color-warning-strong`) | el detector no está seguro de que sea un dato personal |
| Conflicto | una **Y que se abre en dos** (camino que se bifurca) | rojo (`--color-error`) | hay dos lecturas posibles del dato |
| Espacio justo (ADR-062) | **`]↔[`**: flecha doble que empuja contra dos paredes | naranja (`--color-space`) | el reemplazo no entra y se achicó |

- Cada uno es un botón cuadrado de 22 px con el fondo de su color al ~12 %, **salvo "espacio justo"**,
  que mide 26×22: con 22 px de ancho la flecha no se lee. Dos avisos juntos entran en la columna de
  52 px.
- Los tres abren el mismo `Tooltip` de siempre (título + frase) y, al hacer clic, lo mismo que hoy.
- **El `Tooltip` se invierte con el tema**: fondo `--color-text-primary`, texto
  `--color-bg-primary` (no `text-white`). `ConflictBadge` deja `hover:bg-red-50` por el token de
  error con opacidad. Es el arreglo del Contexto §1.

### 4. El género mantiene ADR-071

El botón de tres estados (♀ / ♂ / neutro) sigue apareciendo **solo** cuando el modo es `placeholder` o
`synthetic` (ADR-071 §1-§3). Cambia la forma: botón con **borde** (punteado en el estado neutro) para
que se lea como botón. Su columna está **siempre reservada**: si el modo no lo usa, la ranura queda
vacía y nada se corre.

### 5. La franja "Todo el documento" avisa sin crecer

Reemplaza la forma de `UX_Guidelines.md` §3.4d (borde izquierdo de acento + una línea que aparece):

- La caja tiene **siempre dos líneas**. Sin ajustes propios, la segunda dice *"Se aplica a todas las
  entidades."* en gris. Con ajustes, la caja entera pasa a ámbar y la línea dice *"N entidades tienen
  modo propio: cambiar este modo las pisa."*, con ícono.
- Texto en `--color-warning-strong` (contraste AA). La lógica de cuándo se enciende, la confirmación
  y el toast con "Deshacer" de §3.4d **no cambian**.

### 6. El selector de modo muestra los cuatro resultados exactos, y no cambia al elegir

Cada opción tiene **título + una descripción fija + la vista previa exacta** del resultado para esa
entidad (`[HOMBRE 04]`, `XXXXX XXXXX`, el dato falso real, el bloque negro). Las vistas previas salen
de `EntityGroup.replacementPreviews` (ADR-170). **Elegir otra opción solo mueve el tilde**: ningún
texto del menú cambia. Encabezado: *"Cómo reemplazar «X»"*.

| Modo | Descripción fija |
|---|---|
| Etiquetar | Tipo y número, para seguir quién es quién |
| Ocultar parcialmente | Tapa cada letra y conserva la forma |
| Reemplazar por dato falso | Un dato inventado del mismo tipo |
| Tapar con negro | Un bloque negro sobre el texto |

### 7. Agregar entidades se ve, se confirma y se descubre

- **Selección en el original** (vía 2 de ADR-061): el recuadro que marca el usuario se dibuja con
  **borde punteado de acento animado** y **no desaparece** hasta que (a) se agrega la entidad, (b) el
  usuario cancela, (c) hace otra selección, (d) presiona Escape, o (e) cambia a Anonimizado o cierra
  el documento. El globo "Agregar «X» como…" es flotante.
- **Selector de tipo**: los **13 tipos** de `EntityType` en una caja gris, en grilla, cada uno con su
  punto de color y un botón de opción. Reemplaza al `Select` y a los chips sueltos. Es el mismo
  componente (`EntityTypePicker`) en la selección, la lupa, "Agregar entidad" y "Cambiar tipo".
- **Lupa** (vía 3): **siempre visible y habilitada, en Original y en Anonimizado** (hoy aparece y
  desaparece). Campo *"Buscar un texto en el documento…"*, un contador en ranura fija y un botón
  **"+ Agregar"** separado del texto del campo, habilitado cuando hay resultados. La lista de
  resultados muestra por cada uno: página, la frase alrededor (armada con `getPageWords` y el
  `wordSpan` del `TextMatch`), y su estado: **oculto como Persona N.º 02** (el resultado cae sobre un
  miembro de un grupo) o **Sin ocultar**, con "Agregar como…" en globo flotante. El encabezado resume
  "N ocultos · M sin ocultar".
- **Diálogo "Agregar entidad"** (vía 1), rehecho en dos pasos:
  1. *¿Qué texto querés ocultar?* — mientras se escribe, una caja de **alto fijo** muestra dónde
     aparece (página + frase con el texto resaltado, vía `findText`), o *"No aparece en el
     documento"* antes de confirmar. Desaparece el texto largo de hoy.
  2. *¿Qué es?* — `EntityTypePicker` en su caja gris.
  Debajo, en una caja azul distinta: *si el mismo dato aparece escrito de otra forma, agregalo
  también*. El botón dice cuántas apariciones va a ocultar ("Agregar 2 apariciones"), con ancho
  mínimo fijo.
- **Toast al agregar**, por cualquiera de las tres vías: *"Agregaste «X» · Persona N.º 06 · 2
  apariciones ocultas"*, con **"Ver en la lista"** (lleva la fila a la vista y la resalta) y
  **"Deshacer"** (ADR-172). El N.º es el que quedó **después** de la renumeración de `finishSession`.
- **Descubrimiento**: una tarjeta sobre el visor, solo en Original, con una animación del gesto de
  clic y arrastre: *"Agregá entidades desde el documento"*. Se cierra con "Entendido" y no vuelve
  (`settings.store`, persistido). Además, una nota al pie del panel (*"¿Falta algo? Seleccioná el
  texto… o buscalo con la lupa"*) con su **X** para cerrarla, también persistida.

### 8. Configuración

Además de lo de ADR-168 §3: **Apariencia** con tres opciones con miniatura (*Como el sistema*,
*Claro*, *Oscuro*) en vez del checkbox + dos miniaturas; el aviso de ADR-131 §5 con el texto
suavizado (`Components.md` §2.6), que **sigue diciendo** que GitHub ve la IP y la versión; y todas
las ranuras de mensajes de alto fijo (§1).

### 9. Visor

- **Zoom con pellizco**: el pellizco del trackpad llega como `wheel` con `ctrlKey`. El visor lo
  captura con un listener `{ passive: false }` y hace `preventDefault()` para que no haga zoom la
  ventana entera. `Ctrl + rueda` hace lo mismo.
- **Sin botón de restablecer zoom**: quedan `−`, el porcentaje y `+`. El atajo `Ctrl/Cmd + 0` se
  conserva.
- **Separador entre páginas**: un espacio con una línea punteada y la etiqueta *"Página N de M"*
  centrada.

### 10. Menú ⋯ y sus diálogos

Orden del menú: **Ver apariciones · Editar reemplazo… · Cambiar tipo… · Fusionar con… · Dividir… ·
(separador) · Eliminar entidad** (en rojo, ADR-171). "Restaurar valor calculado" sigue apareciendo
solo cuando `replacementValueUserSet` (ADR-078). "Ver apariciones" abre la lupa con el valor.

- **Fusionar**: la entidad de origen arriba; una lista **de alto fijo** con filtro y casillas para
  elegir **varias** de una vez; una caja **"Resultado"** de alto fijo con nombre, N.º, apariciones y
  token, que sale de `previewEdit` (ADR-170).
- **Dividir**: cada aparición con su página, la frase alrededor y su origen (*Detectado / Agregado por
  vos*); abajo, dos tarjetas **"Se quedan en N.º 02" → "Pasan a una nueva: Persona N.º NN"** con
  conteos (el N.º nuevo sale de `previewEdit`). El error "tiene que quedar al menos una" reemplaza a
  la nota informativa en la **misma ranura**.
- **Editar reemplazo**: campo con un medidor **Entra bien / Queda justo / No entra** (ancho fijo,
  `estimateReplacementFit`); sugerencias más cortas (`replacementPreviews.placeholderLadder`,
  ADR-170); vista previa de la frase del documento con el reemplazo dentro del hueco del original;
  "Volver al calculado" a la izquierda del pie.
- **Cambiar tipo**: `EntityTypePicker` con el tipo actual marcado "Actual"; vista previa
  **`[PERSONA 06]` → `[ORGANIZACION 03]`** (`previewEdit`); aclara que el género se borra al dejar de
  ser Persona.
- **Toda confirmación** cierra el diálogo y muestra un toast con **"Deshacer"** y la pista `Ctrl+Z`
  (ADR-172).

### 11. Tokens de color nuevos

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--color-border-strong` | `#374151` | `#9ca3af` | bordes de la franja de tipo |
| `--color-space` | `#c2410c` | `#fb923c` | aviso "espacio justo" (≥ 4,5:1 sobre `bg-primary` en los dos temas) |

Los fondos suaves de los avisos, la franja y la selección se hacen con los modificadores de opacidad
de Tailwind sobre tokens existentes (`bg-warning/15`, `bg-accent/10`…), que ya funcionan porque los
tokens son canales RGB (`index.css`).

## Consecuencias

**A favor**

- Cada ítem de la lista de pruebas de usuario tiene una respuesta concreta.
- La regla de diseño estable queda escrita y se puede revisar en cada PR.
- Un solo selector de tipo en cuatro lugares.

**En contra**

- `EntityGroupItem` y `EntitiesPanel` se reescriben casi enteros.
- El selector de modo exacto y los diálogos de Fusionar, Dividir y Cambiar tipo **dependen de
  ADR-170**; "Eliminar" de ADR-171; los toasts con "Deshacer" de ADR-172. Si alguno se atrasa, la UI
  no puede cerrarse sin él.
- La lupa marca "oculto / sin ocultar" comparando cajas en la UI. Es presentación, pero hay que cuidar
  el caso de una entidad partida en varias líneas (`OccurrenceRef.fragments`, ADR-074): se compara
  contra los fragmentos, no contra la envolvente.

**Lo que no toca**

- La lógica de los tres niveles de modo (§3.4 a §3.4d) salvo la forma de la franja.
- ADR-071 (visibilidad del género).
- El Core, salvo lo que piden ADR-170 a ADR-172.

## Documentación que cambia

- `ui/UX_Guidelines.md` §1 (diseño estable), §3 (dibujo del árbol), §3.1 (elementos y menú ⋯),
  §3.2, §3.3 (avisos), §3.4d (franja), §5.1 (zoom, separador), §5.4b (selección, lupa, diálogo,
  toasts, descubrimiento).
- `ui/Components.md` §3.1 a §3.9, §5.4b, §5.4c, §5.5, §8.5 (`Tooltip`), §8.6 (`Toast`), §10
  (tokens), §11 (íconos).
- `ui/React_Client.md` §3.2 (`entities.store`: orden), §3.6 (`settings.store`: avisos descartados).
