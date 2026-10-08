<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,ui/UX_Guidelines.md,adr/ADR-070-Atribucion-Visible-En-El-Producto.md,adr/ADR-168-Pantallas-De-Carga-Y-Escaneo-Tras-Pruebas-De-Usuario.md,adr/ADR-207-Los-Menus-De-Entidades-Se-Mantienen-Dentro-Del-Area-Visible.md,roadmap/Roadmap_1.x.md,roadmap/interaccion/Avisos_Y_Novedades_2026-10-08.md | audiencia=humanos+IA | fase=1.0.x -->

# ADR-216 — Las novedades de cada versión viajan con la aplicación

- **Estado**: Accepted
- **Fecha**: 2026-10-08
- **Decidido por**: El humano, sobre el lienzo de diseño "Anonly — Popup de conflicto y changelog"
  (opción A, menú flotante) y en la conversación de ese día: archivo propio de novedades, etiquetas
  Nuevo / Mejora / Arreglo, sin enlace a GitHub y la 1.0.0 con una sola línea. Los puntos de «Lo que
  fijó el planificador» no estaban en el lienzo.
- **Modifica**: ADR-168 §1, solo el pie de `LoadScreen` (la versión pasa a ser un botón).
- **Relacionado con**: ADR-070 §3 (URLs externas), ADR-207 (menús dentro del área visible).

## Contexto

1. El pie de `LoadScreen` muestra la versión como texto: *"Anonly 1.0.1 · Software libre, licencia
   MIT"*. No hay forma de saber, desde la aplicación, qué cambió en esa versión.
2. Las notas para el usuario están solo en GitHub Releases. Los `CHANGELOG.md` de cada paquete los
   genera Changesets y son técnicos: citan ADR y nombres internos, y traen una línea por PR.
3. La aplicación se conecta a internet para una sola cosa, la consulta de actualizaciones
   (`PRIVACY.md`). Eso no puede cambiar.
4. El humano pidió que la versión del pie sea un botón que abra un menú con las mejoras de cada
   versión.

## Decisión

### 1. La versión del pie es un botón

El pie de `LoadScreen` conserva su caja. A la izquierda, en lugar del texto, va un botón con el
aspecto de los otros dos del pie: **"Anonly {versión}"**, la palabra *"Novedades"* en texto
secundario y una flecha. A su derecha sigue, como texto, *"Software libre, licencia MIT"*.

### 2. `ReleaseNotesMenu`: un panel flotante de lectura

Se abre **hacia arriba**, anclado al botón, y no desplaza nada (UX-10).

- **Tamaño**: 400 px de ancho y hasta 452 px de alto, con scroll interno. Si no entra en el área
  visible, se acota y se desplaza con la regla de ADR-207.
- **Encabezado**: *"Novedades"* y el botón de cierre.
- **Cuerpo**: las versiones, de la más nueva a la más vieja, separadas por una línea. Cada una
  muestra:
  - el número y la fecha en formato largo (*"2 de octubre de 2026"*);
  - **"Instalada"** en la versión igual a `__ANONLY_VERSION__`;
  - *"Versión preliminar"* si lo fue;
  - un resumen de una línea, si lo tiene;
  - sus novedades, cada una con una etiqueta de ancho fijo: **Nuevo**, **Mejora** o **Arreglo**.
- **Sin enlaces.** El repositorio ya se abre desde "Acerca de…".
- **Cierre**: `Escape`, clic afuera, el botón de cierre o el mismo botón de versión. El foco vuelve
  al botón de versión.
- **Accesibilidad**: disclosure hecho a mano, con el criterio de `Components.md` §3.5. El botón lleva
  `aria-expanded` y `aria-controls`; el panel es una región con nombre. No usa `role="menu"` ni
  `aria-haspopup`. Las etiquetas se distinguen por su texto y no solo por el color.

### 3. Un archivo propio, escrito para el usuario

Las novedades viven en `apps/react-client/src/components/screens/releaseNotes.ts`, como un dato
`readonly` tipado. Se compila dentro de la interfaz, igual que el número de versión
(`__ANONLY_VERSION__`).

Cada versión tiene: número, fecha (`AAAA-MM-DD`), si fue preliminar, un resumen opcional y una lista
de novedades. Cada novedad tiene un tipo y un texto.

| Tipo | Etiqueta | Cuándo |
|---|---|---|
| `new` | Nuevo | algo que antes no se podía hacer |
| `improvement` | Mejora | algo que ya existía y ahora funciona mejor |
| `fix` | Arreglo | algo que fallaba |

Reglas de redacción:

- Se escribe para quien usa la aplicación. Sin ADR, sin nombres de archivos, paquetes ni herramientas.
- Una oración por novedad, de 140 caracteres como máximo.
- Dos o tres novedades por versión alcanzan. El detalle completo sigue en GitHub Releases.
- Cuando cambia la detección, una novedad lo dice: el mismo documento puede dar otro resultado
  (`Roadmap_1.x.md` §2).

### 4. Contenido inicial

Solo las versiones publicadas. La 0.9.1 no se publicó y no figura.

| Versión | Fecha | Contenido |
|---|---|---|
| 1.0.1 | 2026-10-02 | **Mejora**: *Las actualizaciones muestran el avance de la descarga y se instalan sin asistente.* **Mejora**: *Con «Instalar automáticamente», la actualización se instala al cerrar Anonly (en macOS, al abrirlo).* **Arreglo**: *Si la instalación se corta en Windows, se vuelve a correr sola.* |
| 1.0.0 | 2026-10-02 | Resumen: *Primera versión estable.* Sin novedades listadas. |
| 0.9.2 | 2026-09-05 | Versión preliminar. **Arreglo**: *Un solo instalador de macOS, para Intel y Apple Silicon.* |

### 5. Un test frena el release sin novedades

Un test de `apps/react-client` comprueba:

1. La primera entrada tiene la versión de `apps/desktop-shell/package.json`, la misma que lee
   `readAppVersion()` en `vite.config.ts`.
2. Las versiones no se repiten y van de mayor a menor; las fechas son válidas y no crecen.
3. Cada entrada tiene un resumen o al menos una novedad.
4. Ningún texto está vacío, supera los 140 caracteres ni contiene `ADR-`.

La condición 1 es el gate: `pnpm run version` sube la versión, y `pnpm test` falla hasta que se
escribe la entrada.

### 6. El paso en el release

`RELEASING.md` suma el paso a la preparación de la versión, después de `pnpm run version`. La fecha es
la del día en que se piensa publicar; si el tag se corre, se corrige antes de tagear.

Las notas de GitHub Releases siguen siendo el lugar completo, con su sección fija de limitaciones
conocidas (`Roadmap_1.x.md` §2). El menú es un resumen y no la reemplaza.

### 7. Lo que fijó el planificador

No estaba en el lienzo y el humano puede cambiarlo:

- La ubicación y la forma del archivo (§3), el tope de 140 caracteres y las condiciones del test (§5).
- Que la 0.9.1 no figure y que la 0.9.2 se muestre como "Versión preliminar" (§4).
- Que las limitaciones conocidas queden solo en GitHub Releases (§6).
- Los atributos de accesibilidad del panel (§2).

## Alternativas consideradas

- **Generar el menú desde los changesets.** No agrega pasos, pero esas líneas son técnicas, salen una
  por PR, no distinguen Mejora de Arreglo y habría que reescribir las ya publicadas. Descartada por
  el humano.
- **Un diálogo con la lista de versiones a la izquierda** (opción B del lienzo). Descartada por el
  humano.
- **Traer las notas de GitHub al abrir el menú.** Sería una segunda conexión.
- **Un enlace "Ver todas las versiones en GitHub".** Estaba en el lienzo; el humano lo sacó porque el
  repositorio ya está en "Acerca de…".

## Consecuencias

**A favor**

- El usuario lee qué trae su versión sin salir de la aplicación ni conectarse.
- El texto lo escribe una persona, para el usuario, una vez por versión.
- El test impide publicar una versión sin novedades.

**En contra**

- Un paso manual más en cada release.
- El menú muestra hasta la versión instalada. Las novedades de una versión más nueva se ven después
  de actualizar.
- Una versión preliminar también necesita su entrada, porque el test compara la versión exacta.
- La fecha se escribe antes de publicar y puede quedar corrida si el tag se demora.

**Lo que no toca**

- La red: ninguna conexión ni URL externa nueva. `PRIVACY.md` y `connect-src 'self'` quedan igual.
- Changesets y los `CHANGELOG.md` de cada paquete, que siguen siendo el registro técnico.
- `AboutDialog`, el aviso de actualización y `SettingsDialog`.
- `Contracts.md`, el Core y los motores.
- Dependencias: ninguna nueva.

## Documentación que cambia

- `ui/Components.md` §2.9 (pie de `LoadScreen`) y §2.9b (nueva: `ReleaseNotesMenu`).
- `ui/UX_Guidelines.md` §2.1 (pie de página).
- `RELEASING.md` (paso de novedades) y `CHANGELOG.md` de la raíz ("Dónde leer qué cambió").
- `adr/ADR-168` (nota en el estado).

## Validación

- El test de §5.
- Lógica pura con test: el orden, cuál entrada lleva "Instalada" y el formato largo de la fecha.
- El panel abre, cierra por las cuatro vías y devuelve el foco. Con una ventana baja queda dentro del
  área visible y scrollea por dentro.
- Capturas de la aplicación real en claro y oscuro, a la vista del humano antes de la revisión.

## Referencias

- Lienzo de diseño "Anonly — Popup de conflicto y changelog" (2026-10-08).
- `roadmap/interaccion/Avisos_Y_Novedades_2026-10-08.md`.
