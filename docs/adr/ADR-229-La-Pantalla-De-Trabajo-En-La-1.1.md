<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,ui/Components.md,ui/UX_Guidelines.md,ui/React_Client.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-082-El-Usuario-Corrige-El-Tipo-De-Entidad.md,adr/ADR-125-La-Configuracion-Se-Toca-Antes-Del-Primer-Documento.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,adr/ADR-174-Un-Agregado-Manual-Que-Choca-Se-Resuelve-En-El-Momento.md,adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-222-Dos-Formatos-Que-Se-Pisan-Van-Al-Panel-De-Conflicto.md,adr/ADR-224-Lo-Que-La-1.1-Cambia-En-El-Panel-De-Entidades-Y-El-Visor.md,adr/ADR-225-Un-Tipo-Del-Documento-Se-Edita-Se-Borra-Y-Se-Guarda.md,adr/ADR-226-El-Formato-Se-Nombra-Solo-Cuando-Es-Del-Usuario.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-229 — La pantalla de trabajo en la 1.1

- **Estado**: Aceptado por el mantenedor el 2026-11-16. ADR de interfaz de la pantalla de
  trabajo, como ADR-224 pide para cada pantalla.
- **Fecha**: 2026-11-16.
- **Precisión del 2026-11-21** (mantenedor): el panel de filtros suma la
  sección «Tipos», con los tipos de base y los propios (§5).
- **Decidido por**: el mantenedor, sobre el lienzo «Anonly 1.1 — UI final»,
  página *Pantalla de trabajo* (cerrada el 2026-10-20; los selectores de
  tipo, el 2026-11-16).
- **Origen**: `Plan_1.1.md` §6, frente F7.
- **Alcance**: `react-client`. El único cambio de contrato de esta pantalla
  está en ADR-225.
- **Modifica**: ADR-224 §5 (dónde se abre la ayuda de atajos) y §6 (cómo
  ofrecen «Nuevo tipo» los selectores).
- **Relacionado con**: ADR-225 (tipos auxiliares), ADR-226 (cuándo se
  nombra el formato), ADR-169 §1 (el diseño es estable) y ADR-172 (el
  deshacer).

## Contexto

ADR-224 definió qué hace cada cambio de la 1.1 en el panel de entidades y
en el visor, y dejó el cómo para el diseño. Este ADR lo fija. Lo que toca a
los tipos auxiliares y al nombre del formato tiene su propio ADR; acá va el
resto.

Rigen las dos reglas de siempre:

- **nada desplaza el diseño**: ranuras de alto fijo y paneles flotantes
  (ADR-169 §1);
- **toda acción de un menú ⋯ y todo agregado confirman con un aviso con
  «Deshacer»** (ADR-172 §3).

## Decisión

### 1. La banda «Nuevo tipo»

- Arriba de la lista de entidades hay una banda punteada, **«+ Nuevo
  tipo»**. Tiene la forma de una banda de tipo: el rótulo a la izquierda y,
  a la derecha, un rectángulo punteado con una flecha, alineado con los
  selectores de reemplazo de las bandas de abajo. Así se ve qué se agrega.
- Abre el diálogo «Nuevo tipo»: el nombre, cómo se reemplaza y las dos
  versiones cortas, opcionales. **No pide texto del documento.** Aclara que
  el tipo es solo de este documento.
- El tipo creado aparece como banda vacía (ADR-225 §1) con la fila «Todavía
  no tiene entidades. Seleccioná el texto en el PDF o agregalo desde acá.» y
  un botón «Agregar entidad».
- **Los tipos del usuario van arriba de los del catálogo**, así el tipo
  nuevo aparece debajo de donde se hizo clic.
- La banda de un tipo auxiliar dice «solo en este documento» y tiene el
  menú ⋯ de ADR-225 §2.

### 2. Un solo selector de tipo, con «Nuevo tipo» en línea

El selector de tipo es uno solo en toda la aplicación (`EntityTypePicker`).
Se usa en cuatro lugares: la selección sobre el PDF, la lupa, «Agregar
entidad» y «Cambiar tipo».

**Qué lista:**

- **«Tipos del catálogo»**: los doce tipos base. «Otro» ya no está (ADR-224
  §6).
- **«Tus tipos»**: los concretos y los auxiliares juntos. El auxiliar lleva
  el punto punteado y, al pasar el mouse, «Solo en este documento: no se
  guarda». **Si el usuario no tiene tipos propios, este cuadro no aparece.**

**«Nuevo tipo» es una opción más del selector, sin diálogo encima:**

- con tipos propios, es **una celda punteada al final de «Tus tipos»**;
- sin tipos propios, es **una fila punteada debajo del catálogo**;
- al apretarla, se convierte en **un campo para escribir el nombre**. A su
  lado se ve cómo va a reemplazarse, por ejemplo `[NUMERO DE AFILIADO 01]`;
- **pide solo el nombre.** Las versiones cortas se arman solas (ADR-219 §2)
  y se cambian después desde el menú ⋯ del tipo (ADR-225 §2);
- el botón principal pasa a decir «Crear y agregar» o «Crear y cambiar»;
- un nombre repetido lo dice en la línea del pie y apaga el botón;
- una X descarta el tipo nuevo y vuelve a la celda.

Crear el tipo y aplicarlo es **una sola acción y una sola entrada del
deshacer** (ADR-225 §6).

Es el mismo patrón en los cuatro lugares. Cambia solo el tamaño: dos
columnas en los globos (selección sobre el PDF y lupa) y tres en los
diálogos, como ya definía ADR-169 §7.

**Cambia ADR-224 §6** en la forma: los selectores siguen ofreciendo «Nuevo
tipo», pero en línea, y no con un diálogo propio.

**El panel de conflicto no usa este selector.** Ofrece solo los tipos
candidatos de ese conflicto (ADR-083), nunca ofreció «Otro» y no lleva
«Nuevo tipo». ADR-224 §6 lo nombraba entre los selectores; al escribir los
specs, el 2026-11-16, se comprobó en `ConflictDialog` que no lo es. Quien
quiera otro tipo para esa entidad usa «Cambiar tipo».

### 3. «Cambiar tipo»

- Usa el selector de §2. El tipo actual figura como «Actual» y no se puede
  elegir.
- La caja «Cómo queda» muestra el reemplazo de antes y el de después.
- **Si el tipo elegido es propio y la entidad estaba en «Dato falso»**, la
  caja avisa que pasa a «Etiquetar»: los tipos propios no tienen dato falso
  (ADR-219 §3).

### 4. El menú de reemplazo de un tipo propio

Ofrece «Etiquetar», «Ocultar parcialmente» y «Tapar con negro», con el
resultado exacto de cada uno (ADR-169 §6). **No ofrece «Dato falso».**

### 5. Los filtros

- Un botón **«Filtros»**, junto al buscador de la lista, abre un panel
  **flotante**. No agrega una fila de fichas: no mueve la lista.
- El panel tiene cuatro secciones de casillas:
  - **«Tipos»** (precisión del mantenedor, 2026-11-21): los tipos que tienen
    entidades en el documento, los de base y los propios, en el orden de la
    lista, cada uno con su punto de color y su cantidad. En dos columnas.
    Filtrar por tipo es otra cosa que filtrar por formato: «Tus formatos»
    sigue mostrando solo los del usuario (ADR-226 §3);
  - **«Tus formatos»** (ADR-226 §3);
  - **«Modo de reemplazo»**: cada modo con una muestra de cómo queda
    (`[TIPO 01]`, `XX.XXX.XXX`, un nombre inventado, un bloque negro) y su
    cantidad. No son pastillas;
  - **«Para revisar»**: desactivadas, con conflicto, y agregadas o editadas
    a mano, cada una con una línea que dice qué es.
- Con filtros aplicados, el resumen de la lista dice «Mostrando 2 de 10 ·
  Quitar filtros», y el botón muestra cuántos hay.
- Si ninguna entidad cumple, la lista lo dice y ofrece quitar los filtros.
- **Con el filtro «con conflicto» activo**, la fila de una entidad cuyo
  conflicto nació resuelto muestra un ícono gris que abre el panel de
  conflicto. Sin el filtro, esa fila no lleva ícono, como hoy.

### 6. El panel de conflicto entre dos formatos

Es el panel de conflicto de siempre, con lo que ADR-222 suma:

- el título dice que dos formatos reconocen el mismo texto;
- cada opción nombra su tipo, su formato y de dónde sale (ADR-226 §5);
- avisa que se resolvió solo, cuál ganó y por qué, y que no frena la
  exportación (ADR-222 §3 y §4).

### 7. Formatos que no se aplicaron

`RegexFinished.skippedFormats` (ADR-220 §6) se avisa en dos lugares.

**En la barra**, en la ranura que hoy usa el aviso de análisis incompleto:

- un formato: «El formato «CBU» no se aplicó en las páginas 3 y 4. Revisalas
  antes de exportar.», con «Ir a la página 3»;
- varios: cuántos, y cada uno con sus páginas.

**En el diálogo de exportar**, debajo del nombre del documento, por si el
usuario no leyó la barra:

- una fila por formato, con sus páginas y «Ir a la página N», que cierra el
  diálogo y lleva al visor;
- un formato que falló en todo el documento dice «Todo el documento» y no
  lleva botón;
- **no bloquea la exportación**, igual que las páginas ilegibles (ADR-190).

### 8. La ayuda de atajos está en Configuración

- **No hay ícono de teclado en la barra.** Los atajos no tienen relación
  con el documento abierto.
- Configuración suma una sección, **«Atajos de teclado»**, con el botón
  «Ver atajos…». Se ve con o sin documento abierto (ADR-125 §1).
- La ayuda lista los atajos de la tabla única de ADR-224 §5, con las teclas
  de cada sistema, y al cerrarse vuelve a Configuración.
- **El resto de Configuración no cambia.**

## Lo que no cambia

- El orden del árbol, su navegación por teclado, el buscador y la lupa
  (ADR-224 §1).
- El diálogo de choque de un agregado manual (ADR-174): es el que resuelve
  un texto que ya pertenece a otra entidad. Por eso «Nuevo tipo» no pide
  texto.
- Qué entra en el deshacer y cómo se avisa (ADR-172), salvo lo que suma
  ADR-225 §6.
- El diálogo de exportar, salvo el aviso de §7.

## Consecuencias

- Crear un tipo con el PDF abierto tiene una entrada visible y, además,
  aparece donde hace falta: al elegir qué es un dato.
- El selector es igual en sus cuatro lugares.
- **La ventana de la selección crece, como mucho, una fila**: «Nuevo tipo»
  ocupa una celda del cuadro que ya existe.
- **Un tipo creado desde un selector nace sin versiones cortas propias.**
  Se corrigen después, desde el menú ⋯.
- La ayuda de atajos queda a dos clics. Es a propósito: no compite con el
  trabajo sobre el documento.

## Cómo se verifica

- Los cuatro selectores listan los mismos tipos y ofrecen «Nuevo tipo» de
  la misma forma.
- Sin tipos propios no aparece el cuadro «Tus tipos», y «Nuevo tipo» es una
  fila bajo el catálogo.
- «Crear y agregar» crea el tipo auxiliar y agrega la entidad; un deshacer
  se lleva las dos cosas.
- Un nombre que repite la etiqueta de otro tipo no deja crear.
- Ningún selector ofrece «Otro».
- Abrir el panel de filtros no cambia la posición de ninguna fila.
- Un formato salteado se avisa en la barra y en el diálogo de exportar, y
  exportar sigue habilitado.
- La barra no tiene ícono de atajos; Configuración tiene la sección.

## Documentación que cambia

- `Components.md`: `EntitiesPanel`, `EntityTypeGroup`, `EntityTypePicker`,
  `AddEntityDialog`, `ChangeTypeDialog`, `WordSelectionOverlay`,
  `DocumentSearchBox`, `ReplacementModeSelect`, `ConflictDialog`,
  `ExportDialog`, `SettingsDialog` y el aviso de la barra.
- `UX_Guidelines.md`: los filtros y la tabla de atajos de §9.
- `React_Client.md`: el estado de los filtros y el aviso de
  `skippedFormats`.
- ADR-224: nota de «modificado por ADR-229» en §5 y §6.
