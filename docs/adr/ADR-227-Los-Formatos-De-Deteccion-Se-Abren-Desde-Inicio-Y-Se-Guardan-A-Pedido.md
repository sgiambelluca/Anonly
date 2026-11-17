<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,ui/UX_Guidelines.md,ui/React_Client.md,adr/ADR-125-La-Configuracion-Se-Toca-Antes-Del-Primer-Documento.md,adr/ADR-168-Pantallas-De-Carga-Y-Escaneo-Tras-Pruebas-De-Usuario.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-216-Las-Novedades-De-Cada-Version-Viajan-Con-La-Aplicacion.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-227 — Los formatos de detección se abren desde inicio y se guardan a pedido

- **Estado**: Aceptado por el mantenedor el 2026-11-16. ADR de interfaz de la pantalla de
  inicio y de «Formatos de detección», como ADR-224 pide para cada pantalla.
- **Fecha**: 2026-11-16.
- **Decidido por**: el mantenedor, sobre el lienzo «Anonly 1.1 — UI final»,
  página *Inicio y formatos* (2026-11-15 y 2026-11-16).
- **Origen**: `Plan_1.1.md` §6, frente F7.
- **Alcance**: `react-client`. Sin cambio de contrato y sin dependencias
  nuevas.
- **Modifica**: ADR-168 §1 (las tres tarjetas de la pantalla de carga).
- **Relacionado con**: ADR-223 (qué hace cada acción), ADR-220 §4 (qué
  formatos se editan), ADR-221 §7 (el selector de país), ADR-169 §1 (el
  diseño es estable) y ADR-228 (el generador).

## Contexto

ADR-223 fijó que los formatos se configuran sin documento abierto, se
guardan en el equipo y viajan en un archivo, y dejó a este ADR cómo se ve.

Al diseñarlo, el mantenedor marcó tres cosas sobre la pantalla de inicio:

- la entrada a los formatos no puede pasar desapercibida: no es una función
  chica;
- no quiere perder la información que hoy dan las tarjetas de la pantalla;
- no tiene sentido una fila con dos tarjetas que solo se leen y una que se
  usa.

Las tarjetas «Todo local» y «No se puede deshacer» nacieron con ADR-168 §1,
de las pruebas de usuario donde la pantalla «se leía vacía».

## Decisión

### 1. Inicio: una tarjeta que se abre y las garantías junto al PDF

Cambia la fila de tres tarjetas de ADR-168 §1:

- **Queda una sola tarjeta, a lo ancho: «Detección automática».** Se abre
  entera, como un botón, y lleva a «Formatos de detección». A la derecha
  dice «Ver y editar los formatos» con una flecha.
- **Su texto cuenta con qué se detecta:**
  - con formatos del usuario: «Formatos de Argentina, 4 tuyos y un modelo
    que reconoce nombres.»;
  - sin ellos: «Formatos de Argentina para DNI y CUIT, y un modelo que
    reconoce nombres.».
- **Las garantías «Todo local» y «No se puede deshacer» pasan a la caja
  principal, debajo de la zona de carga**, en versión corta: «Nunca salen
  de tu computadora.» y «No queda nada debajo para recuperar.». Quedan
  donde el usuario decide si suelta el archivo.

El resto de la pantalla no cambia: barra superior, «Cómo funciona» y pie
(ADR-168, ADR-216).

**Al guardar los formatos**, la pantalla de inicio muestra el aviso
«Formatos guardados · Se aplican al próximo documento que abras».

### 2. «Formatos de detección»: el árbol

Un diálogo grande. De arriba abajo:

**Encabezado.** El título y una línea que define los dos conceptos: «Un
tipo es qué dato es, como Teléfono o CBU. Un formato es una forma en que
ese dato aparece escrito.». A la derecha, «Importar…», «Exportar…» y
cerrar.

**Barra.** Un buscador de tipos y formatos, y el conteo de formatos
prendidos, apagados y del usuario. El buscador filtra por nombre de tipo o
de formato, sin distinguir mayúsculas ni tildes.

**Tres secciones**, cada una con una línea que dice qué es:

| Sección | Qué dice | Qué tiene |
|---|---|---|
| Tus tipos | «Los creaste vos: se pueden editar y borrar» | Los tipos concretos del usuario |
| Tipos del catálogo | «Vienen con Anonly, para Argentina: no se borran, y les podés sumar formatos tuyos» | DNI, CUIT/CUIL, Teléfono, Matrícula y Patente (ADR-220 §5) |
| Tipos fijos del catálogo | «Funcionan igual en todos lados o tienen un control propio: solo se prenden y apagan» | Los que no admiten formatos del usuario. Arranca plegada |

**La banda de cada tipo** muestra el nombre, cuántos formatos tiene y
cuántos están apagados. Se pliega y se despliega.

**Las dos formas de agregar se distinguen por lugar y por forma:**

- **«Nuevo tipo»** es una banda punteada al principio de «Tus tipos», con
  la aclaración «Para un dato que el catálogo no conoce, como un legajo o
  una historia clínica». Es el mismo patrón de la banda «Nuevo tipo» del
  panel de entidades (ADR-229).
- **«Nuevo formato»** es un botón en la banda de cada tipo que admite
  formatos. Abre el generador con ese tipo elegido (ADR-228).
- «Nuevo formato» pesa más que «Editar»: lleva borde y texto de acento;
  «Editar» va sin borde.

**Cada formato es una fila** con:

- una **casilla** para prenderlo y apagarlo. No es un interruptor
  deslizante: la aplicación ya usa casilla para habilitar una entidad;
- el nombre y, debajo, qué clase de formato es;
- un ejemplo de lo que reconoce (§5);
- una etiqueta: «Tuyo», «Editado», «Del catálogo» o «Con control»;
- «Editar», si se puede (ADR-220 §4): los propios se editan; los base de
  pura forma se editan como copia; los que tienen control, no;
- un menú ⋯ si es del usuario: «Restaurar original» en una copia editada,
  «Borrar formato» en uno propio.

**El menú ⋯ de un tipo del usuario** ofrece «Editar tipo…», «Exportar este
tipo…» y «Borrar tipo…».

**Estados vacíos:**

- sin tipos del usuario, «Tus tipos» muestra solo la banda «Nuevo tipo»;
- un tipo del usuario sin formatos muestra «Todavía no tiene formatos: no
  detecta nada solo. Igual podés usarlo al agregar una entidad a mano.»;
- una búsqueda sin resultados lo dice y ofrece borrarla.

### 3. Se guarda con un botón

- Los cambios del árbol **no se aplican al hacerlos**: se juntan y se
  guardan con «Guardar». El pie muestra cuántos cambios hay sin guardar.
- «Guardar» está apagado si no hay cambios.
- **Cerrar o cancelar con cambios sin guardar pide confirmación**: «¿Descartar
  N cambios sin guardar?», con «Seguir editando» y «Descartar cambios».
- El pie recuerda que se aplica al próximo documento y que se guarda en el
  equipo, sin cifrar (ADR-223 §3).
- Dentro del diálogo, las acciones de un menú ⋯ confirman con un aviso con
  «Deshacer» (ADR-169 §10), válido hasta guardar.

Guardar recrea el Core por el camino de ADR-125 §2, como dice ADR-223 §1.

### 4. Crear, editar y borrar un tipo guardado

- **«Nuevo tipo» y «Editar tipo…» usan el mismo formulario**: el nombre,
  cómo se reemplaza en sus tres largos (ADR-219 §2) y las dos versiones
  cortas, opcionales.
- La validación de `validateUserEntityType` se muestra en una ranura de
  alto fijo. Un nombre repetido dice con cuál choca y cómo se
  reemplazarían los dos.
- Al editar, el formulario avisa que el cambio se aplica al próximo
  documento.
- **«Borrar tipo…»** confirma listando los formatos que se borran con él
  (ADR-223 §4).

### 5. Los ejemplos de los formatos con control

Cada fila muestra un ejemplo. Para un formato del generador, el ejemplo se
arma con sus piezas. Un formato con control no tiene piezas, así que **la
aplicación lleva una tabla de textos de ejemplo**, uno por formato base del
catálogo («20-12345678-9», «Pérez, Juan», …).

Son textos de la interfaz: viven en `react-client`, junto a los demás
rótulos, y no en el catálogo de `regex-engine`.

### 6. Exportar e importar

**Exportar** abre un diálogo con dos listas (ADR-223 §5):

- «Tus tipos · viajan con todos sus formatos», con sus formatos anidados y
  casilla en cada nivel;
- «Tuyos, en tipos del catálogo · viajan solos».

Tiene «Elegir todo» y «Nada», el resumen de lo elegido y la aclaración de
que no viajan el país ni qué formatos del catálogo están prendidos. El
archivo se llama **`formatos.anonly-formatos`**.

**Importar** usa el selector de archivos y termina en uno de dos diálogos
(ADR-223 §6):

- **el resumen**, con tres grupos: «Se importó», «Se sumó a un tipo que ya
  tenías» y «No se importó», este último con el motivo de cada uno. Un
  formato que comparte textos con otro lleva su aviso;
- **el rechazo**, cuando no entra nada: archivo inválido, versión más nueva
  o un archivo que no es de Anonly. Dice el motivo y ofrece elegir otro.

### 7. El país, en la 1.1.1

En la 1.1 no se ve: hay un solo país (ADR-221 §7).

Cuando lleguen Chile y Uruguay, el selector de país va **en la barra de
«Formatos de detección»**, junto al buscador, y no en Configuración: el
país cambia la lista que el usuario está mirando.

A su lado va «Sumar un formato de otro país…» (ADR-221 §5), que trae un
formato suelto de otro catálogo sin cambiar el país activo. El rótulo de
ADR-221, «agregar desde otro país», no se entendía solo.

## Lo que no cambia

- Qué hace cada acción, qué se guarda y qué viaja: ADR-223.
- Qué formatos se editan y cuáles solo se prenden y apagan: ADR-220 §4.
- «Cómo funciona», la zona de carga, la barra superior y el pie de la
  pantalla de inicio.
- Configuración. La entrada a los formatos no pasa por ahí.

## Consecuencias

- La función nueva tiene una entrada que se ve, en el lugar de una tarjeta
  que ya hablaba de la detección.
- Cada cosa se dice una vez en la pantalla de inicio.
- **La pantalla de inicio pierde dos tarjetas.** Su contenido se conserva
  más corto, junto a la zona de carga, y siguen «Cómo funciona» y la
  tarjeta ancha: no debería volver a leerse vacía.
- **El árbol tiene un paso más que Configuración**, que guarda al cerrar.
  Es a propósito: guardar recrea el Core y aplica al próximo documento.

## Cómo se verifica

- La tarjeta «Detección automática» abre «Formatos de detección» con clic y
  con teclado.
- Su texto cambia con y sin formatos del usuario.
- Prender, apagar, editar, borrar y restaurar suman al contador, y nada
  llega a `anonly:detection` hasta «Guardar».
- Cerrar con cambios pide confirmación; sin cambios, no.
- El buscador encuentra por nombre de tipo y de formato, sin tildes.
- «Tipos fijos del catálogo» arranca plegada y no ofrece «Nuevo formato».
- Todo formato base muestra un ejemplo.
- En la 1.1 no aparecen el selector de país ni «Sumar un formato de otro
  país…».

## Documentación que cambia

- `Components.md`: `LoadScreen`, y las secciones nuevas de «Formatos de
  detección», el formulario de tipo, exportar e importar.
- `UX_Guidelines.md`: guardado a pedido, estados vacíos y la casilla como
  control de prendido y apagado.
- `React_Client.md`: el estado del árbol, el contador de cambios y la tabla
  de ejemplos.
- ADR-168: nota de «modificado por ADR-227» en §1.
