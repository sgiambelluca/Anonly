<!-- CONTEXT: scope=adr-aceptado | dependencias=adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md,adr/ADR-086-El-Detector-De-Degradacion-Mide-El-Ancho.md,adr/ADR-109-La-Caja-De-Una-Palabra-Es-Su-Caja-De-Tinta.md,adr/ADR-204-La-Interaccion-Anonimizada-Usa-La-Geometria-Visible.md,core/Render_Engine.md,core/Contracts.md,roadmap/interaccion/Revision_ADR204_2026-10-07.md,roadmap/hardening/Confianza_1.0.x_Plan.md | audiencia=humanos+IA | fase=12 -->

# ADR-210 — El repintado de línea desplaza los píxeles del renglón

- **Estado:** Aceptado por el mantenedor el 2026-10-07, sobre una propuesta
  del planificador y una maqueta del antes y el después.
- **Fecha:** 2026-10-07.
- **Alcance:** `render-engine`, repintado de línea (ADR-058 §2, §3 y §6).
- **Reemplaza:** ADR-058 §3 (calibración inversa de la tipografía) y la
  condición (e) de §6. El resto de ADR-058 sigue vigente.

## Contexto

Cuando una etiqueta no entra en la caja del dato, ADR-058 §2 corre el resto
del renglón: lo tapa, dibuja la etiqueta, y **vuelve a escribir** cada
palabra siguiente con una tipografía deducida por calibración (§3).

Medido el 2026-10-07 en la aplicación de escritorio
(`roadmap/interaccion/Revision_ADR204_2026-10-07.md`):

1. La calibración prueba doce tipografías genéricas a un tamaño de
   `0,64 × alto de la caja`. Ese es el tamaño de la etiqueta, no el del texto.
   Cuando el error pasa el umbral, el ganador es `monospace` a unos 0,6 o 0,7
   cuerpos: el resto del renglón queda con otra letra, a la mitad de alto, y
   con palabras pegadas. Visto con Times New Roman, Arial y Calibri.
2. Que la condición pase depende de la escala de render. El mismo renglón se
   repinta al 100 % de zoom y no al 130 %, y nada garantiza que el export
   coincida con el preview.
3. Con las fuentes de los fixtures del repo la condición no pasa nunca, así
   que ningún gate ejercita el repintado.

Calibrar también el tamaño no alcanza. Una sonda del mismo día ajustó el
tamaño de cada candidato a los anchos reales, sobre catorce tipografías
instaladas: el error de anchos baja a alrededor de 5 % o menos, pero el ancho no
distingue peso ni estilo. Calibri sale como `bold sans-serif` a 0,86
cuerpos, Cambria como `bold sans-serif` a 0,91 y Georgia como
`italic bold serif`. El renglón seguiría quedando con otra letra.

La causa de fondo es que el kernel no puede dibujar la tipografía del
documento: corre sin Font Loading API (ADR-053), y en un escaneo ni siquiera
hay tipografía que extraer.

## Decisión

1. **Las palabras que siguen a la etiqueta no se vuelven a escribir: se
   mueven sus píxeles.** El kernel copia el rectángulo que va desde el borde
   izquierdo de la primera palabra vecina hasta el final de la corrida, sobre
   la banda vertical del renglón, y lo pega desplazado por el delta. Las
   palabras conservan su letra, su peso, su color y su suavizado, porque son
   los mismos píxeles. En un escaneo pasa lo mismo.
2. **La calibración de tipografía se elimina**: los doce candidatos, el
   umbral de error y la condición (e) de ADR-058 §6. Las condiciones (a) a
   (d) no cambian.
3. **La etiqueta se dibuja como en el resto del documento**: con la familia
   del modo de reemplazo y el tamaño que le corresponde a su caja, alineada a
   la izquierda en `bbox.x`. Su color y el del fondo se siguen muestreando del
   canvas (ADR-058 §4). En este camino el tamaño no se redondea a píxeles
   enteros: no hay bucle de encogido que lo necesite.
4. **El delta es el ancho de la etiqueta menos el ancho de la caja**, como
   hoy. El hueco que había entre el dato y la primera palabra vecina se
   conserva. El desplazamiento se redondea hacia arriba a píxeles enteros:
   pegar en una posición fraccionaria interpolaría los píxeles, y dejarían de
   ser los originales.
5. **Lo que hay entre el dato y la primera palabra vecina se tapa, no se
   mueve.** Es lo que pasa hoy. Así ningún píxel del dato original viaja con
   el renglón. El recorte nunca empieza a la izquierda del borde derecho de
   la caja del dato. Una palabra del renglón cuya caja se superpone con la
   del dato no cuenta como vecina (condición (a) de ADR-058 §6, sin cambios):
   no se mueve, y lo que de ella quede en la zona tapada se borra, como hoy.
6. **Orden de las operaciones**: leer los píxeles a mover y muestrear los
   colores; tapar desde `bbox.x` hasta el final de la zona, con el fondo
   muestreado; pegar los píxeles desplazados; dibujar la etiqueta. La lectura
   va antes de tapar.
7. **La decisión de repintar no depende de la escala.** Las condiciones se
   evalúan en puntos de página, con el ancho de la etiqueta medido a su
   tamaño sin redondear. El redondeo a píxeles enteros queda solo para
   dibujar, con `maxWidth` como red de seguridad. Es el mismo criterio de
   ADR-086 §2 para el veredicto de degradación.
8. **El mapa de interacción de ADR-204 queda exacto**: cada palabra movida
   conserva su tamaño y se corre el mismo delta que sus píxeles.

No cambia ningún contrato. `RenderPagePayload.lineWords` se sigue usando para
decidir qué se mueve. No hay dependencias nuevas, y el export sigue siendo una
imagen (ADR-004, ADR-009).

## Límites conocidos

- **Todo lo que esté en la banda se mueve con el texto**: un subrayado, un
  resaltado, o tinta de otro renglón que invada la banda. Hoy esa tinta se
  borra; con este cambio se corre. Las condiciones (b) y (c) ya dejan afuera
  las tablas y los renglones que no son texto corrido.
- **Esa tinta nunca es la de otro dato tapado** (enmienda del 2026-10-07).
  La banda es tan alta como la palabra más alta del renglón. Con
  interlineado muy apretado o un escaneo torcido podía alcanzar filas de un
  dato tapado en otro renglón, y esas filas se corrían fuera de la caja que
  las tapa. Lo encontró el revisor leyendo el código, antes de que se viera
  en un documento. Desde la enmienda, si la zona que el repintado borra y
  pega cruza la caja de otro reemplazo, no se repinta: la etiqueta se achica
  como antes de este ADR. Queda, por redondeo a píxeles enteros, como mucho
  una fila en el borde de dos cajas que se tocan.
- **La zona tapada queda de un solo color**, el fondo muestreado, igual que
  hoy. Sobre un escaneo con grano, la etiqueta queda sobre un parche liso.
- **El texto girado sigue sin repintado** (ADR-066 §7). Sin cambios.
- **El tamaño de la etiqueta no se decide acá.** Sigue saliendo más chica
  que el texto que la rodea (`Post_Hito10.8_Pendientes.md` §25, abierto).

## Alternativas

| Alternativa | Por qué no |
|---|---|
| Calibrar también el tamaño | Medido: acierta el ancho y no la letra. El renglón queda en otra tipografía, a veces en negrita o cursiva. Conserva la dependencia de un umbral |
| Extraer la fuente y el cuerpo del PDF (ADR-058 §11) | El kernel no puede cargar la fuente embebida (ADR-053), y deja afuera a los escaneos |
| Apagar el repintado y dejar solo el encogido de ADR-058 §1 | Descartada por el mantenedor el 2026-10-07. La etiqueta queda ilegible sobre datos cortos |
| Dejarlo como está | Es el defecto medido |

## Consecuencias

- El renglón repintado conserva la apariencia del documento. Desaparece la
  costura que ADR-058 §3 quería evitar.
- El kernel pierde la calibración, que era su parte más compleja, y gana una
  copia de píxeles.
- El repintado se va a activar más seguido que hoy: ya no hay un umbral de
  error que lo frene. En los documentos donde hoy cae al encogido, la
  etiqueta va a salir a su tamaño y el renglón corrido.
- Cambia el PDF exportado. Por `Roadmap_1.x.md` §1 es un parche, y las notas
  de la versión lo dicen.
- La lectura del canvas crece: de la caja de una palabra a la banda del
  renglón, solo en los renglones que se repintan.

## Plan y validación

Primero los documentos: `Render_Engine.md` §6, §9, §13 (caso 26) y §14,
la nota de reemplazo en ADR-058, y `UX_Guidelines.md` donde describe el
repintado. Después el código, en `render-engine` solo.

Pruebas:

- con canvas simulado: geometría del rectángulo de origen y de destino, orden
  de las operaciones, que no se lee ni se mueve ningún píxel de la caja del
  dato, límite ante otro reemplazo en el mismo renglón, y el mapa de ADR-204;
- **con canvas real, en Electron**: los píxeles movidos son idénticos a los
  originales, y el renglón se repinta igual al 100 % y al 130 % de zoom. Con
  este cambio el repintado se activa también con las fuentes de los fixtures,
  así que el gate deja de depender de tipografías que el repo no tiene;
- el gate de export de ADR-148 en verde, sin valores originales legibles;
- no regresión: una página donde todas las etiquetas entran produce el mismo
  raster que antes.

Antes del revisor, el mantenedor ve capturas del preview y del PDF exportado
sobre texto digital y sobre un escaneo.
