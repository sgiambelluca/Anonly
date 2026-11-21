<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,ui/Components.md,ui/UX_Guidelines.md,ui/React_Client.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-222-Dos-Formatos-Que-Se-Pisan-Van-Al-Panel-De-Conflicto.md,adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md,adr/ADR-227-Los-Formatos-De-Deteccion-Se-Abren-Desde-Inicio-Y-Se-Guardan-A-Pedido.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-228 — El generador se arma con piezas que se arrastran

- **Estado**: Aceptado por el mantenedor el 2026-11-16. ADR de interfaz del generador de
  formatos.
- **Fecha**: 2026-11-16.
- **Precisión del 2026-11-21** (mantenedor): «Es un…» no ofrece «Nuevo
  tipo…» (§1, punto 2).
- **Precisiones del 2026-11-21, pasada de UI de la 1.1** (mantenedor, sobre
  la aplicación andando): la caja de estado va en el pie (§1, §7); cada
  variante tiene su menú ⋯ con «Duplicar variante» y «Borrar variante…»
  (§2); la flecha del final de un renglón apunta hacia adelante, un clic
  derecho sobre una pieza abre su menú y `Supr` la borra (§3); una parte
  opcional se completa con un «+» dentro de su caja y admite también «Letras
  o dígitos» (§4); «Solo si antes dice…» se pliega aunque tenga palabras, y
  las palabras van en etiquetas con borde (§5).
- **Decidido por**: el mantenedor, sobre el lienzo «Anonly 1.1 — UI final»,
  tableros *Generador de formatos* y *Generador · validación y comparación*
  (2026-11-15 y 2026-11-16).
- **Origen**: `Plan_1.1.md` §6, frente F7.
- **Alcance**: `react-client`. Sin cambio de contrato y **sin dependencias
  nuevas**: si el arrastre o el panel flotante necesitaran una, lleva su ADR
  (R-12).
- **Relacionado con**: ADR-220 (qué es un formato, sus límites y las
  funciones `validateFormat`, `testFormat` y `compareFormat`), ADR-223 §3
  (qué se guarda) y ADR-227 (desde dónde se abre).

## Contexto

ADR-220 definió el formato como una lista de variantes hechas de piezas, y
tres funciones puras para validarlo, probarlo y compararlo. Dejó al diseño
cómo se arma en pantalla.

El mantenedor revisó dos versiones. De la primera conservó la idea central
—armar el dato por bloques, con variantes— y pidió cambiar lo demás:

- **menos carga**: quien descubre la función no tiene que ver todo a la vez;
- la prueba en vivo no tiene que estar siempre a la vista;
- no se entendía la diferencia entre dígitos, letras, y letras o dígitos;
- las piezas ya creadas se tienen que poder reordenar arrastrándolas,
  también hacia adentro de una parte opcional;
- nada se puede perder sin querer: ni una variante, ni los cambios al
  cerrar;
- el estado del formato va al final del panel, destacado.

## Decisión

### 1. Un diálogo de una sola columna

De arriba abajo:

1. **Encabezado**: «Nuevo formato», o «Editar «…»», y la línea «Armá la
   forma del dato con piezas, de izquierda a derecha.». A la derecha,
   «Probar con un texto» (§6) y cerrar.
2. **Nombre del formato** y **«Es un…»**, el tipo al que pertenece. El
   selector lista los tipos del usuario y los del catálogo que admiten
   formatos (ADR-220 §5). No ofrece «Nuevo tipo…»: primero va el tipo y
   después sus formatos, así que un tipo nuevo se crea antes, con la banda
   «Nuevo tipo» de «Tus tipos» (ADR-227). Precisión del mantenedor,
   2026-11-21.
3. **Las variantes**, en pestañas (§2).
4. **La tira de piezas** de la variante elegida (§3).
5. **«Se lee»** y **«Ejemplo»**: la variante dicha en palabras, y un texto
   de ejemplo armado con sus piezas.
6. **El ajuste de la pieza elegida** (§4), en una caja que mide lo que su
   contenido (precisión del 2026-11-21).
7. **«Solo si antes dice…»**, opcional (§5).
8. **Pie**: la caja de estado (§7) a la izquierda, y «Cancelar» y el botón
   principal a la derecha, en la misma fila (precisión del 2026-11-21).

**Tres casos, el mismo diálogo:**

| Caso | Título | Botón |
|---|---|---|
| Formato nuevo | «Nuevo formato» | «Crear formato» |
| Editar uno propio | «Editar «nombre»» | «Guardar cambios» |
| Editar uno base de pura forma | «Editar «nombre»» y un aviso: se edita una copia y el original se apaga (ADR-220 §4) | «Guardar copia» |

Al editar una copia, «Es un…» está fijo.

### 2. Variantes

- Cada variante es una pestaña: «Variante 1», «Variante 2»… «+ Variante»
  suma una, con la aclaración «Otra forma de escribir el mismo dato».
- Una variante con un problema lleva un punto rojo en su pestaña.
- **La pestaña elegida tiene un menú ⋯** (precisión del 2026-11-21): con
  «Duplicar variante», que suma una copia justo después y la elige, y
  «Borrar variante…». Antes «Borrar variante» era un botón rojo en la fila
  de las pestañas, y se confundía con borrar una pieza.
- **«Borrar variante…» pide confirmación**, y dice cuántas piezas se pierden.
  Con una sola variante está apagado. «Duplicar variante» se apaga en el
  tope de variantes.
- **Una variante puede tener nombre** (ADR-233, 2026-11-21): la pestaña lo
  muestra, o «Variante N» si no tiene; el ⋯ suma «Cambiar nombre…», y
  «Duplicar variante» nombra la copia «Copia de …».
- **Los límites se muestran cuando queda poco**: el contador de variantes
  (8, `FORMAT_MAX_VARIANTS`) y el de piezas (16, `FORMAT_MAX_PIECES`)
  aparecen solo cerca del tope. Al llegar, «+ Variante» o «+ Pieza» se
  apagan.

### 3. La tira de piezas

Cada pieza es una ficha con tres renglones: qué es, cuánto o cuál, y un
texto de ejemplo. Una parte opcional es una caja punteada con sus piezas
adentro.

- **Un clic elige la pieza**; su ajuste aparece abajo (§4).
- **«+ Pieza»** abre un menú con las seis clases, cada una con una línea
  que dice qué reconoce y un ejemplo:

  | Pieza | Qué dice el menú |
  |---|---|
  | Dígitos | «Solo números, del 0 al 9. Ejemplo: 48213» |
  | Letras | «Solo letras, con o sin tilde. Ejemplo: Gómez» |
  | Letras o dígitos | «Cualquiera de los dos, mezclados. Ejemplo: A1B2C3» |
  | Separador | «Espacio, guion, punto o barra entre dos bloques» |
  | Texto fijo | «Siempre el mismo texto, como «HC-». Se tapa con el dato» |
  | Parte opcional | «Un tramo que puede estar o no» |

- **Las piezas se arrastran**:
  - para cambiarles el orden dentro de la variante;
  - para meterlas en una parte opcional, soltándolas sobre su caja;
  - para sacarlas de ella, soltándolas afuera;
  - la parte opcional entera también se arrastra;
  - una parte opcional no se puede soltar dentro de otra (ADR-220 §1).
- **Mientras se arrastra**, una marca muestra dónde va a quedar la pieza.
- **Con teclado**, la pieza elegida se mueve con los botones «Mover a la
  izquierda» y «Mover a la derecha» de su ajuste. El arrastre no es el
  único camino.
- **Cuando las piezas ocupan más de un renglón**, una flecha al final de un
  renglón y otra al principio del siguiente muestran por dónde sigue la
  lectura. La del final apunta hacia adelante y abajo (⤵), no de vuelta
  hacia la ficha; la del principio, hacia abajo y adelante (↳). Precisión
  del 2026-11-21.
- **Clic derecho sobre una pieza** abre su menú: «Mover a la izquierda»,
  «Mover a la derecha» y «Borrar pieza». Sobre una parte opcional, «Borrar
  parte opcional», que se lleva sus piezas. Con teclado, la tecla de menú o
  `Mayús`+`F10` lo abren, y `Supr` borra la pieza elegida. Precisión del
  2026-11-21.

### 4. El ajuste de la pieza elegida

Vive en una caja que mide lo que su contenido, sin scroll propio
(precisión del 2026-11-21). El alto fijo de ADR-169 §1 dejaba hueco en las
piezas cortas y, en las largas, una segunda barra de scroll por unos
píxeles. Al crecer corre solo lo que está debajo («Solo si antes dice…»),
nunca la tira ni las pestañas. Arriba dice qué pieza es y tiene «Mover», a izquierda y a derecha, y
«Borrar pieza».

**Un bloque de caracteres** se ajusta en tres pasos:

- **«Qué va»**: tres opciones con ícono, nombre y ejemplo.

  | Opción | Aclaración | `FormatCharClass` |
  |---|---|---|
  | Dígitos | «Solo números: 4821» | `digit` |
  | Letras | «Solo letras: Gómez» | `letter`, `upper` o `lower` |
  | Letras o dígitos | «Mezclados: A1B2C» | `alnum` |

- **«Cuántos»**: «Exactamente» N, o «Entre» un mínimo y un máximo, de 1 a
  64 (`FORMAT_MAX_REPEAT`).
- **«Escritas»**, solo si eligió «Letras»: «Mayúsculas o minúsculas», «Solo
  MAYÚSCULAS» o «Solo minúsculas».

**Un separador**: cuáles admite (espacio, guion, punto, barra) y una casilla
«Puede faltar».

**Un texto fijo**: el texto, de hasta 40 caracteres, con el aviso de §8.

**Una parte opcional**: cuántas piezas tiene y cómo sumarle. Se suman con
un «+» dentro de su caja, en la tira, que ofrece las cinco clases que entran
en ella: dígitos, letras, letras o dígitos, un separador o un texto fijo.
Al crearla, ese menú se abre solo. Precisión del 2026-11-21: antes eran
botones en el ajuste, y sin «Letras o dígitos».

### 5. «Solo si antes dice…»

Son las palabras de contexto de ADR-220 §2 (`contextBefore`).

- Si el formato no tiene ninguna, la sección arranca como **una sola
  fila**: «Detectarlo solo si antes dice una palabra (opcional)». Al
  apretarla se abre.
- **Se pliega y se despliega desde su encabezado**, tenga o no palabras.
  Plegada con palabras, la fila las nombra: «Solo si antes dice «legajo» o
  «leg.»». Precisión del 2026-11-21.
- Abierta, muestra las palabras, un campo para sumar otra y el contador,
  hasta 5 (`FORMAT_MAX_CONTEXT`).
- **Las palabras van en etiquetas con borde**, cada una con su X para
  sacarla. El subrayado punteado queda para el texto de prueba, donde marca
  la palabra dentro de una frase. Precisión del 2026-11-21: el subrayado
  suelto en una lista no se leía como algo que se puede sacar.
- «Se lee» las incluye: «Después de «legajo» o «leg.»: …».

### 6. «Probalo»: un panel flotante

- **Arranca cerrado.** «Probar con un texto», en el encabezado, lo abre y
  lo cierra.
- **Flota sobre la pantalla y se mueve** arrastrándolo de su encabezado.
  Tiene su propio botón de cerrar.
- Se abre a la derecha del diálogo si hay lugar; si no, encima de su borde
  derecho.
- Adentro: el texto de prueba, cuántas coincidencias hay y el texto con lo
  que se detectaría resaltado. Usa `testFormat`, así que respeta los
  bordes y el contexto (ADR-220 §3).
- **El texto de prueba no se guarda**, y el panel lo dice (ADR-223 §3).

### 7. La caja de estado

Va **en el pie, a la izquierda de los botones** (precisión del 2026-11-21;
antes iba arriba del pie, en una fila propia). Así no ocupa un renglón más
del diálogo. Mide siempre lo mismo, con lugar para tres renglones, y es
siempre una caja:

| Estado | Color | Deja crear |
|---|---|---|
| «Listo para crear» / «Listo para guardar» | Verde suave | Sí |
| Comparte textos con otro formato, con un ejemplo (`compareFormat`) | Amarillo | Sí |
| Falta el nombre | Rojo | No |
| Una variante no tiene dígitos ni letras | Rojo | No |
| Ya existe un formato igual | Rojo | No |
| Es demasiado amplio (`FORMAT_MAX_STATES`) | Rojo | No |

Los textos de cada caso están en el tablero *Generador · validación y
comparación*. Con un error, el botón principal está apagado.

### 8. Lo que se escribe queda guardado

ADR-223 §3 pide avisarlo. El aviso va **donde se escribe**, no en el pie:

- en el texto fijo: «Queda guardado en este equipo: no escribas datos de un
  caso.»;
- en las palabras de contexto: «La palabra no se tapa. Queda guardada en
  este equipo: no escribas datos de un caso.».

### 9. Cerrar con cambios pide confirmación

«Cancelar», la X y un clic fuera del diálogo hacen lo mismo:

- **sin cambios**, cierran;
- **con cambios**, preguntan «¿Cerrar sin guardar?», con «Seguir editando»
  y «Descartar cambios».

Es la misma confirmación de «Formatos de detección» (ADR-227 §3) y la misma
forma que «Borrar tipo»: ícono, título, una línea y un pie con los dos
botones.

## Lo que no cambia

- Qué es un formato, sus piezas, sus límites y cómo se recorre: ADR-220.
- Qué formatos se pueden editar: ADR-220 §4.
- Cuándo dos formatos van al panel de conflicto: ADR-222.
- Que el generador solo se abre desde la pantalla de inicio: ADR-223 §1.

## Consecuencias

- Quien abre el generador por primera vez ve una tira de piezas y poco
  más: la prueba y las palabras de contexto están a un clic.
- Las tres clases de caracteres se eligen viendo un ejemplo de cada una.
- **El arrastre y el panel que se mueve son interacciones nuevas en la
  aplicación.** Se hacen con lo que el navegador ya trae, y cada una tiene
  un camino por teclado o por botón.
- **El estado ocupa una caja siempre**, aunque diga «Listo para crear». Es
  el costo de que nada se mueva cuando aparece un error.

## Cómo se verifica

- Una pieza arrastrada queda donde mostraba la marca; soltada sobre una
  parte opcional, queda adentro; soltada afuera, sale.
- Una parte opcional no se puede soltar dentro de otra.
- Los botones «Mover» dan el mismo resultado que el arrastre.
- Con piezas en dos renglones, aparecen las dos flechas de continuación.
- «Borrar variante» y cerrar con cambios piden confirmación; cerrar sin
  cambios, no.
- El panel de prueba abre, cierra y se mueve; al reabrirlo no conserva
  nada en `anonly:detection`.
- La caja de estado no cambia de alto entre sus seis estados.
- Con un error, el botón principal está apagado; con un aviso, no.
- Todos los límites del generador coinciden con las constantes `FORMAT_*`
  de `Contracts.md` §6.

## Documentación que cambia

- `Components.md`: el generador y sus partes.
- `UX_Guidelines.md`: arrastre con alternativa por teclado, paneles
  flotantes, y avisos de guardado en el punto de escritura.
- `React_Client.md`: el estado del generador y el uso de `validateFormat`,
  `testFormat` y `compareFormat`.
