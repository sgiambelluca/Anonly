<!-- CONTEXT: scope=ux | dependencias=00_Project_Vision.md,ui/React_Client.md,ADR-011-Grouping-First.md,ADR-012-Replacement-Modes.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md | audiencia=IA-implementador-ui+humanos | fase=4 (§3.1 aclarado en fase 10, ADR-036 §9; §3.3/§5.4 en fase 10.5 por ADR-057 —tokens abreviados— y ADR-058 —el reemplazo no se derrama, marca de degradado—, §8.2 por ADR-059 —checkbox de referencia de marcadores—; §3.3/§5.4 en fase 10.6 por ADR-060 —género— y por ADR-071/ADR-072 —el control de género pasa a ser un botón de tres estados visible solo en `placeholder`/`synthetic`, con la marca de "sin determinar" fusionada adentro, y el sintético respeta el género y deja de cambiar solo—; §5.4b en fase 10.7 por ADR-061 —agregado manual de entidades—; §5.4 en fase 10.9 por ADR-076 —un texto de reemplazo escrito a mano se conserva, qué lo reemplaza y cómo se vuelve al automático— y ADR-074 §6 —la marca de degradado se enciende más seguido porque ahora mide contra el rectángulo real—) -->

# Anonly — UX Guidelines

> Patrones de UX para anonimización. Carga incremental, vista previa lado a lado, edición de grupos, conflictos, reglas, cancelación, accesibilidad. Orienta a diseñadores e IAs que implementan la UI.

---

## 1. Principios UX

| # | Principio |
|---|---|
| UX-1 | **Transparencia radical**: el usuario siempre sabe qué está pasando (progreso, errores, qué se detectó, qué se reemplazará). |
| UX-2 | **Agrupación por defecto**: el árbol muestra grupos, nunca ocurrencias. El conteo de ocurrencias es visible pero secundario. |
| UX-3 | **Lado a lado obligatorio**: el usuario ve original y anonimizado simultáneamente para validar antes de exportar. |
| UX-4 | **Edición no destructiva**: cualquier cambio es reversible hasta el export. |
| UX-5 | **Cancelación siempre disponible**: botón "Cancelar" visible durante todo el pipeline. |
| UX-6 | **Progreso incremental**: las entidades aparecen a medida que se detectan, no al final. |
| UX-7 | **Defaults seguros**: `placeholder` por defecto (más informativo), `enabled = true` por defecto. |
| UX-8 | **Sin sorpresas en el export**: pre-flight check muestra cuántos grupos se anonimizarán, cuántas páginas, tamaño estimado. |
| UX-9 | **Accesibilidad desde el inicio**: teclado, ARIA, contraste, focus visible. |

---

## 2. Layout 4 paneles

```
┌──────────────────────────────────────────────────────────┐
│  Toolbar (arriba)                                         │
├──────────────────┬───────────────────────────────────────┤
│  Entidades       │            PDF original               │
│  (izq-sup)       │            (der-sup)                  │
├──────────────────┼───────────────────────────────────────┤
│  Reglas          │            PDF anonimizado            │
│  (izq-inf)       │            (der-inf)                  │
└──────────────────┴───────────────────────────────────────┘
```

- **Toolbar**: logo, estado del pipeline (stage + progress bar), botón "Importar PDF", botón "Cancelar", botón "Exportar", settings.
- **Entidades**: árbol expandible por tipo, con grupos y checkboxes.
- **Reglas**: lista de reglas por scope (group/type/global) + creador de reglas.
- **PDF original**: visor virtualizado, scroll vertical, con highlight de grupos habilitados.
- **PDF anonimizado**: visor virtualizado, sincronizado verticalmente con el original, mostrando el resultado con reemplazos aplicados.

### 2.1 Resizing

- El usuario puede redimensionar el panel izquierdo (Entidades + Reglas) vs el derecho (visores). Default 30/70.
- Dentro del panel izquierdo, Entidades y Reglas se reparten 60/40 vertical, con divisor draggable.
- En mobile/tablet (< 1024 px), el layout colapsa a tabs: "Entidades | Reglas | Original | Anonimizado".

---

## 3. Árbol de entidades

```
▶ Personas (3)              [▾]
    ☑ Juan Pérez (14)        [placeholder ▾]  [⋯]
    ☑ María Gómez (6)        [placeholder ▾]  [⋯]
    ☑ Carlos López (2)       [placeholder ▾]  [⋯]
▶ DNI (3)                   [▾]
    ☑ 34.567.891             [placeholder ▾]  [⋯]
    ☑ 18.445.212             [placeholder ▾]  [⋯]
    ☑ 42.998.103             [placeholder ▾]  [⋯]
▶ Direcciones (2)           [▾]
    ☑ Belgrano 1234          [placeholder ▾]  [⋯]
    ☑ Rivadavia 455          [placeholder ▾]  [⋯]
```

### 3.1 Elementos del árbol

- **Cabecera de tipo**: `▶ <Tipo> (<n grupos>)`. Expandible/colapsable. Click en la cabecera expande/colapsa. Un checkbox en la cabecera habilita/deshabilita todos los grupos del tipo (cascade).
- **Grupo**: `☑ <canonicalValue> (<n ocurrencias>) [modo ▾] [⋯]`.
  - Checkbox: habilita/deshabilita el grupo. La UI emite `GROUP_UPDATE_REQUESTED` con `patch.enabled` (canal `ui`); `GROUP_TOGGLED` es el evento que **Grouping** emite como respuesta (`04_Event_System.md` §6/§10 — aclaración ADR-036 §9).
  - `<canonicalValue>`: el valor representativo del grupo. Click abre un popover con aliases, ocurrencias por página y opción de editar `canonicalValue`.
  - `(<n ocurrencias>)`: badge con `members.length`. No es editable.
  - `[modo ▾]`: selector de `ReplacementMode` (mask/synthetic/placeholder/redact). Cambio emite `GROUP_UPDATE_REQUESTED` con `patch.replacementMode`.
  - `[⋯]`: menú contextual con: Fusionar con…, Dividir, Ver ocurrencias, Editar valor canónico, Eliminar grupo.

### 3.2 Interacciones

- **Fusionar**: el usuario selecciona 2+ grupos del mismo tipo (via checkboxes auxiliares o drag) y click "Fusionar" → `GROUP_MERGE_REQUESTED`. El resultante conserva el menor `indexInType`.
- **Dividir**: click en un grupo → "Dividir" → modal con lista de ocurrencias (con bbox y página) → selecciona un subconjunto → `GROUP_SPLIT_REQUESTED`. Las seleccionadas van a un grupo nuevo.
- **Buscar**: input de búsqueda filtra grupos por `canonicalValue` o `aliases`. Atajo `Cmd/Ctrl+F`.
- **Colapsar todo / expandir todo**: botones en la cabecera del panel.

### 3.3 Estados

- **Grupo habilitado**: checkbox marcado, texto normal.
- **Grupo deshabilitado**: checkbox desmarcado, texto atenuado.
- **Grupo con conflicto**: icono ⚠ al lado del nombre. Click abre el conflicto.
- **Grupo editado manualmente**: punto azul al lado del nombre (indica que el `replacementMode` difiere del default de las reglas).
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

## 4. Panel de reglas

```
Reglas                                       [+ Nueva regla]
─────────────────────────────────────────────────────────
Scope: Global
  • Modo default: placeholder                [✎] [🗑]
  • DNI → mask                               [✎] [🗑]

Scope: Por tipo
  • CUIT → synthetic                         [✎] [🗑]

Scope: Por grupo
  • Juan Pérez → redact                      [✎] [🗑]
```

### 4.1 Creador de reglas (modal)

- **Scope**: radio (Global / Por tipo / Por grupo).
- **Si "Por tipo"**: select de `EntityType`.
- **Si "Por grupo"**: select de grupo (autocomplete por `canonicalValue`).
- **Modo**: select (mask/synthetic/placeholder/redact).
- **Prioridad**: input numérico 0–1000 (default 100).
- **Preview**: muestra un ejemplo del efecto de la regla sobre un grupo afectado.
- **Crear**: emite `RULE_CREATED`.

### 4.2 Resolución visible

- Al lado de cada grupo, un tooltip "Modo aplicado por: Regla global 'DNI → mask'" explica de dónde viene el modo efectivo. Hace el sistema comprensible.

---

## 5. Visores PDF (lado a lado)

### 5.1 Layout

- Dos columnas: original (izquierda) y anonimizado (derecha).
- Scroll vertical sincronizado: mover uno mueve el otro.
- Cada página se renderiza en un `<canvas>` reciclado por el `PageVirtualizer`.
- Phantom de cada página (dimensiones + placeholder gris) siempre presente para scroll height correcto.
- Zoom: botones +/- y atajos `Cmd/Ctrl + +`, `Cmd/Ctrl + -`, `Cmd/Ctrl + 0` (reset).

### 5.2 Highlight en el lado original

- Cada ocurrencia de un grupo habilitado tiene un borde color sobre el bbox.
- Color por tipo: Personas=verde, DNI=azul, Direcciones=naranja, etc. (paleta accesible, ver §9).
- Hover sobre un highlight: tooltip con tipo, valor canónico, modo de reemplazo, conteo de ocurrencias del grupo.
- Click en un highlight: selecciona el grupo correspondiente en el árbol (scroll into view + resaltado).

### 5.3 Conflicto en el lado original

- Bordes adicionales en rojo o icono ⚠ sobre bbox en conflicto.
- Click abre el panel de conflicto (ver §6).

### 5.4 Lado anonimizado

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

**Solo se puede señalar sobre el panel original.** En el anonimizado lo que se ve puede ser un reemplazo, y señalarlo no tendría sentido.

**La selección no es selección de texto**, aunque se sienta parecida: el visor resuelve qué palabras caen bajo el cursor o el recuadro. Es lo que hace que funcione igual en un PDF escaneado, donde no hay texto que seleccionar y es justamente donde más se necesita corregir lo que el OCR se comió.

**Qué esperar de la búsqueda, y hay que decirlo en la UI**: encuentra el valor **exacto**, sin distinguir mayúsculas ni acentos — "JOSE PEREZ" encuentra "José Pérez". **No** encuentra "J. Pérez". Si el documento nombra a la misma persona de dos formas, hay que agregar las dos; una vez agregadas, la app las agrupa sola. Decirlo por adelantado en el diálogo evita que el usuario crea que falló.

**Efecto sobre los números**: agregar una entidad recalcula el orden de los marcadores, así que los índices de los grupos ya visibles pueden correrse — `[PERSONA 03]` puede pasar a `[PERSONA 04]`. Es coherente con que los números siempre reflejen el orden de aparición en el documento. Al agregar varias seguidas conviene que la UI no llame la atención sobre cada renumeración.

### 5.5 Sincronización

- Scroll vertical: si el usuario mueve uno, el otro se mueve.
- Cambio de página: si el usuario salta a la página N en uno, el otro salta también.
- Zoom: compartido.

---

## 6. Panel de conflicto

Cuando el usuario click en un conflicto (desde el árbol o desde un highlight):

```
Conflicto #c-123
─────────────────────────────────────────
Tipo: Overlap (bbox compartido)
Página: 3
Candidatos:
  • Regex: DNI (confidence 1.0)  → "34.567.891"
  • NER: Person (confidence 0.65) → "34.567.891"

Resolución sugerida: Regex (mayor confidence + determinístico)

[Usar Regex] [Usar NER] [Personalizado ▾]
```

- "Usar Regex" / "Usar NER" / "Personalizado" emite `CONFLICT_RESOLVE_REQUESTED` con el modo elegido.
- "Personalizado" permite elegir un `ReplacementMode` para el grupo resultante.

---

## 7. Pipeline y progreso

### 7.1 Toolbar de pipeline

```
[● Listo]                    [Cancelar]  [Exportar]
```

Estados:
- `● Listo` (verde): pipeline en `Ready`, listo para editar/exportar.
- `● Procesando` (azul, animado): con texto "Extrayendo página 3 de 10…".
- `● OCR` (azul): "OCR página 5 de 10… 65%".
- `● NER` (azul): "Cargando modelo NER… 45%" o "Analizando página 4 de 10…".
- `● Cancelando` (amarillo): tras `CANCEL_REQUESTED`.
- `● Error` (rojo): con tooltip del error.
- `● Exportando` (azul): "Exportando página 7 de 10…".

### 7.2 Progreso granular

- Para OCR/NER/Export, mostrar `current/total` + porcentaje.
- Para carga de modelo NER, mostrar progreso de descarga (0..1).
- Si `deviceMemory < 4` y se serializa OCR/NER, indicar "Modo memoria reducida activado".

### 7.3 Cancelación

- Botón "Cancelar" visible siempre que `stage ∉ {Idle, Done, Failed, Cancelled}`.
- Click → modal de confirmación "¿Cancelar el procesamiento? Los cambios no guardados se perderán." → `CANCEL_REQUESTED`.
- Tras cancelación, el documento queda cargado en el último estado estable (páginas ya procesadas disponibles, pero el pipeline no continúa).
- El usuario puede "Reanudar" (vía re-importar en MVP; pausa/reanudación parcial es v1.0).

---

## 8. Export

### 8.1 Botón "Exportar"

- Visible siempre que `stage = Ready`.
- Click → modal de export (ver §8.2).

### 8.2 Modal de export

```
Exportar PDF anonimizado
─────────────────────────────────────────
Nombre: anonimizado.pdf              [✎]
Formato de imagen: ( ) PNG  (•) JPEG
Calidad JPEG: ─────●────── 0.85
DPI: ( ) 150 (estándar)  ( ) 300 (alta calidad)
Título (metadata): _______________

[ ] Incluir referencia de marcadores
    Agrega una página final que explica qué significa cada
    marcador (PRS = Persona, MAT = Matrícula…). Solo los
    tipos: nunca los datos originales.

Resumen:
  • 10 páginas
  • 23 grupos anonimizados (de 25 detectados)
  • 2 grupos deshabilitados
  • Tamaño estimado: ~1.2 MB

[Exportar] [Cancelar]
```

**Sobre el checkbox de referencia** (ADR-059): apagado por default. El copy tiene que decir las dos cosas que el usuario necesita para decidir — que **suma una página** al documento, y que lista **tipos y no valores originales**. Lo segundo no es una aclaración legal: es lo primero que un usuario asume que hace la opción, y no lo hace ni puede hacerlo. Con el resumen de arriba, el conteo de páginas mostrado pasa a ser `páginas + 1` cuando está activo.

### 8.3 Progreso de export

- Tras click "Exportar": `EXPORT_STARTED` → barra de progreso con `EXPORT_PROGRESS`.
- Al finalizar: `EXPORT_FINISHED` → botón "Descargar" + "Exportar otro".

### 8.4 Pre-flight check

Si `enabledGroups = 0`: modal de confirmación "No hay grupos habilitados. El export será idéntico al original. ¿Continuar?".

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

Atajos de teclado:

| Atajo | Acción |
|---|---|
| `Cmd/Ctrl+O` | importar PDF |
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

- **First paint** (< 1.5 s desde import): mostrar la página 1 del lado original apenas PDF Engine la parsea. No esperar al pipeline completo.
- **Entidades apareciendo en vivo**: el árbol se va llenando a medida que `ENTITY_GROUP_CREATED` llega. El usuario percibe progreso.
- **Preview incremental**: cada página del lado anonimizado aparece cuando se renderiza, no todas juntas.
- **Delta render**: al editar un grupo, solo las páginas afectadas se re-renderizan. El cambio se ve en < 150 ms.
- **Skeletons**: mientras una página se renderiza, mostrar skeleton gris con dimensión correcta (no spinner).

---

## 11. Estados vacíos

| Estado | UI |
|---|---|
| App recién abierta, sin documento | Hero con "Arrastra un PDF aquí o [Examinar]" + features destacadas. |
| Documento cargado, sin entidades | Mensaje: "No se detectaron entidades. Revisa los patrones en Settings." |
| Sin grupos habilitados | Banner: "No hay grupos habilitados. El export será idéntico al original." |
| Sin reglas | Placeholder en el panel de reglas: "Aún no hay reglas. Crea una con [+ Nueva regla]." |
| NER desactivado | Banner en el árbol: "NER desactivado. Solo se detectarán patrones Regex. [Activar NER]" |

---

## 12. Referencias

- `00_Project_Vision.md` §8 (layout)
- `ui/React_Client.md` (UI Contract)
- `ui/Components.md` (catálogo)
- `ADR-011-Grouping-First.md`
- `ADR-012-Replacement-Modes.md`
- `07_Performance_Strategy.md` §3 (virtualización)
