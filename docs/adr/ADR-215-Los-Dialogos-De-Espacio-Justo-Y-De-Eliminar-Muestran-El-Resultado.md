<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,ui/UX_Guidelines.md,adr/ADR-062-Veredicto-De-Degradacion-Hasta-La-UI.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-171-El-Usuario-Puede-Eliminar-Una-Entidad.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,roadmap/interaccion/Avisos_Y_Novedades_2026-10-08.md | audiencia=humanos+IA | fase=1.0.x -->

# ADR-215 — Los diálogos de espacio justo y de eliminar muestran el resultado antes de aplicar

- **Estado**: Accepted
- **Fecha**: 2026-10-08
- **Decidido por**: El humano, sobre el lienzo de diseño "Anonly — Popup de conflicto y changelog":
  opción A del aviso de espacio justo ("Elegir y aplicar") y la propuesta de "Eliminar entidad". Los
  puntos de «Lo que fijó el planificador» no estaban en el lienzo.
- **Modifica**: ADR-171 §5, solo en qué diálogo confirma la eliminación. ADR-062 no cambia: el aviso
  conserva sus tres salidas.
- **Relacionado con**: ADR-169 §1 (diseño estable) y §10 (diálogos de edición), ADR-172 (deshacer).

## Contexto

### 1. El diálogo de espacio justo explica y apila tres botones

Al hacer clic en el aviso `]↔[`, `DegradedBadge` abre un diálogo con un párrafo, la palabra "Podés:"
y tres botones grises iguales, uno debajo del otro. El humano lo describió así: "te explica un poco y
te muestra tres botones, queda feo".

- No muestra el problema. Dice que el texto "hubo que achicarlo", pero el usuario no ve cuánto.
- No muestra qué pasa con cada salida.
- "Dejarlo a la vista, sin ocultar" tiene el mismo aspecto que las otras dos y actúa con un solo
  clic, aunque es la única que deja un dato sin anonimizar.

### 2. La confirmación de eliminar es una oración gris

"Eliminar entidad" usa el `ConfirmDialog` genérico con una oración. La consecuencia que importa, que
el texto queda a la vista en el documento exportado, está en el medio de esa oración y con el color
del texto secundario.

### 3. "Dejarlo a la vista" no confirma con toast

`UX_Guidelines.md` §3.3b dice que el cambio de habilitado muestra un toast con "Deshacer". La casilla
de la fila lo cumple. La salida "Dejarlo a la vista" del aviso también deshabilita el grupo, pero no
muestra ninguno.

## Decisión

### 1. El diálogo de espacio justo: elegir, ver y aplicar

`Dialog` de tamaño `lg`. Mantiene el título *"El reemplazo puede no leerse"*. La descripción pasa a
ser *"No entraba en el lugar del original y hubo que achicarlo."*.

De arriba hacia abajo:

1. **La entidad** (`EntityLine`) con el símbolo de espacio justo a la derecha, como en
   `EditReplacementDialog`.
2. **"Así queda en el documento"**, con las páginas afectadas a la derecha en un renglón
   (*"Página 3"*, *"Páginas 3 y 7"*, *"Páginas 3, 7 y 12"*). Con más de tres páginas se listan las
   tres primeras y se cuenta el resto: *"Páginas 3, 7, 12 y 5 más"*. Debajo, una caja con dos
   renglones de la misma frase:
   - **"Hoy"**: el reemplazo vigente dibujado dentro del ancho del original, achicado.
   - **El resultado de la opción elegida**, con su rótulo (tabla de abajo).
   - Una ranura de **un renglón** para la aclaración.
3. **"¿Qué querés hacer?"**: un grupo de opciones de radio con el patrón de `ConflictDialog`. Cada
   opción lleva ícono, título y una línea de descripción.

| Opción | Descripción | Rótulo del segundo renglón | Qué dibuja | Botón |
|---|---|---|---|---|
| Usar un texto más corto | Se abre el editor, con sugerencias que sí entran. | Con un texto más corto (ejemplo) | la primera sugerencia de `replacementSuggestions` | Abrir el editor |
| Tapar con negro | Un bloque negro sobre el texto. Siempre entra. | Con el bloque negro | el bloque, del ancho del original | Aplicar |
| Dejarlo a la vista | No se oculta: el dato se va a poder leer. | Sin ocultar | el texto original, resaltado | Aplicar |

- **Preselección**: la primera opción.
- **La aclaración** dice *"El dato sigue oculto: es un problema de lectura, no de privacidad."*. Con
  "Dejarlo a la vista" elegida pasa a *"El dato va a quedar legible en el documento exportado."*, en
  `--color-warning-strong`.
- **Pie**: "Cerrar" y el botón primario, que tiene ancho mínimo fijo porque su texto cambia.
- **"Tapar con negro" no se ofrece** si el grupo ya está en `ReplacementMode.Redact`, como hoy.
- **La aparición que se muestra** es la de `tightestMember(group.members)`, la misma regla de
  `EditReplacementDialog`. Sin una aparición utilizable, la caja muestra *"No hay una aparición para
  mostrar."* y conserva su alto.
- **Sin sugerencias** (`replacementSuggestions` devuelve vacío), el rótulo es *"Con un texto más
  corto"* y el lugar del dato se dibuja vacío, con el ancho del original.
- **Diseño estable** (UX-10): elegir una opción cambia el contenido del segundo renglón, de la
  aclaración y del botón. Ningún bloque cambia de tamaño ni de lugar.

Al aplicar:

| Opción | Qué hace | Confirmación |
|---|---|---|
| Usar un texto más corto | cierra y abre `EditReplacementDialog` | la del propio editor al guardar |
| Tapar con negro | `applyGroupMode(group, ReplacementMode.Redact)` | la del cambio de modo de la fila (`Components.md` §3.11): toast con "Deshacer" **solo si** el texto estaba escrito a mano, porque se descarta |
| Dejarlo a la vista | deshabilita el grupo | el mismo toast con "Deshacer" que la casilla de la fila |

La última fila corrige el Contexto §3: `applyLeaveVisible` pasa a confirmar igual que `applyEnabled`.
El toast de "Tapar con negro" usa el mismo texto que el de la fila: *"Se descartó el texto que
habías escrito para X."*

**Color de las opciones**: la caja del grupo usa `bg-secondary`, no el `bg-tertiary` de
`ConflictDialog`. Acá cada opción lleva una descripción en texto secundario, y ese par sobre
`bg-tertiary` no llega a 4.5:1 (`UX_Guidelines.md` §9).

### 2. `RemoveEntityDialog`: la confirmación de eliminar

Reemplaza al `ConfirmDialog` genérico **solo** para "Eliminar entidad". `Dialog` de tamaño `md`:

1. **Encabezado** con un ícono de papelera sobre fondo de error atenuado, el título *"¿Eliminar esta
   entidad?"* y la descripción *"Deja de ocultarse en todo el documento."*.
2. **La entidad** (`EntityLine`).
3. **Una caja con dos renglones** de la misma frase, la de la primera aparición del grupo:
   - **"Hoy"**: lo que muestra el documento anonimizado. Es el reemplazo vigente, o el bloque en modo
     `redact`. Si el grupo ya está deshabilitado, es el texto original.
   - **"Si la eliminás"**: el texto original, resaltado en el color de error.

   Sin una aparición utilizable, la caja dice *"No hay una aparición para mostrar."* y la primera
   consecuencia no menciona la cantidad.
4. **Tres consecuencias**, en este orden. La primera va en el color del texto principal y con el
   ícono en `--color-error`; las otras dos, en texto secundario.
   - *"**Su texto queda a la vista** en el documento exportado, en las N apariciones."* Con una sola:
     *"…en su única aparición."*
   - *"Sale de la lista de entidades."*
   - *"Si un nuevo análisis la vuelve a encontrar, sigue eliminada."*
5. **Pie**: a la izquierda, *"Podés deshacerlo con Ctrl+Z"*, con la misma pista que usan los toasts
   de edición (`Components.md` §8.6). A la derecha, "Cancelar" y **"Eliminar"** (variante `danger`,
   con ícono de papelera).

Al confirmar hace exactamente lo de ADR-171 §5 (`applyRemove`) y los toasts no cambian. Las tres
oraciones conservan los tres datos de `removeConfirmMessage`, que deja de usarse.

### 3. Piezas compartidas

- `Dialog` (`Components.md` §8.2) gana una prop opcional `icon`, que se dibuja a la izquierda del
  título y de la descripción. Sin la prop, el encabezado queda como hoy.
- La vista previa de la frase, que hoy es una función interna de `EditReplacementDialog`
  (`ContextPreview`), pasa a un archivo propio y la usan los tres diálogos. Dibuja, dentro del ancho
  del original: un texto (achicado si no entra), el bloque negro o el original resaltado.

### 4. Lo que fijó el planificador

No estaba en el lienzo y el humano puede cambiarlo:

- El toast de "Dejarlo a la vista" (§1), por `UX_Guidelines.md` §3.3b, y el de "Tapar con negro"
  cuando descarta un texto escrito a mano (§1), por `Components.md` §3.11.
- Qué se dibuja cuando no hay sugerencias o no hay aparición (§1 y §2).
- El tope de tres páginas en el rótulo (§1) y el fondo `bg-secondary` de las opciones (§1). Los dos
  salieron de la revisión del lote.
- Qué muestra "Hoy" cuando el grupo ya está deshabilitado y el singular de las apariciones (§2).
- Al abrirse `RemoveEntityDialog`, el foco no cae en "Eliminar".

## Consecuencias

**A favor**

- El usuario ve el problema y el resultado de cada salida antes de aplicarla.
- Dejar un dato a la vista pide elegir y aplicar, cambia la aclaración y confirma con toast.
- La consecuencia de eliminar se lee primero, y el diálogo dice que se puede deshacer.
- Reutiliza `EntityLine`, el grupo de opciones de `ConflictDialog` y la vista previa de
  `EditReplacementDialog`. No hay patrones visuales nuevos.

**En contra**

- El aviso de espacio justo pasa de un clic a dos (elegir y aplicar).
- `ConfirmDialog` deja de ser la única forma de confirmar: eliminar tiene su diálogo.

**Lo que no toca**

- `Contracts.md`, el Core y los motores. No hay eventos, tipos ni error codes nuevos.
- El botón del aviso, su `Tooltip` y sus `aria-label`.
- De dónde sale el veredicto de degradación (ADR-062) y la regla de redacción sin jerga.
- Los demás usos de `ConfirmDialog`.
- Dependencias: ninguna nueva.

## Documentación que cambia

- `ui/Components.md` §3.3 (referencia al diálogo), §3.3b (nueva: diálogo de espacio justo), §3.5 y
  §3.5b (nueva: `RemoveEntityDialog`), §8.2 (`icon`) y §8.2b.
- `ui/UX_Guidelines.md` §3.3 (qué abre el aviso de espacio justo).
- `adr/ADR-171` (nota en el estado).

## Validación

- Lógica pura con test: las opciones según el modo del grupo, el rótulo, la aclaración y el botón por
  opción, el caso sin sugerencias, el rótulo de páginas con su tope, y la frase de apariciones en
  singular y plural.
- `applyLeaveVisible` emite el pedido y muestra el toast. `applyGroupMode` muestra el suyo solo con
  el texto escrito a mano.
- El spec E2E que cubre "Eliminar entidad" (`toast-interaction`) se corre en el mismo cambio. El
  aviso de espacio justo no tiene spec E2E: se valida con los tests de lógica y las capturas.
- Capturas de la aplicación real en claro y oscuro, a la vista del humano antes de la revisión.
- UX-10: abrir cada diálogo y recorrer las opciones sin que nada cambie de tamaño.

## Referencias

- Lienzo de diseño "Anonly — Popup de conflicto y changelog" (2026-10-08).
- `roadmap/interaccion/Avisos_Y_Novedades_2026-10-08.md`.
