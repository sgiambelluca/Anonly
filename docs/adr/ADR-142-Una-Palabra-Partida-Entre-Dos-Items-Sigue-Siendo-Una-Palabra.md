<!-- CONTEXT: scope=adr | dependencias=core/PDF_Engine.md,core/Contracts.md,adr/ADR-102-El-Flujo-De-Glifos-Es-Continuo-Por-Pagina.md,adr/ADR-097-El-Avance-Real-De-Cada-Glifo-Reemplaza-Al-Promedio.md,adr/ADR-108-El-Avance-De-Un-Espacio-Incluye-El-Word-Spacing.md,adr/ADR-109-La-Caja-De-Una-Palabra-Es-Su-Caja-De-Tinta.md,adr/ADR-113-El-Renglon-Se-Corta-Donde-Hay-Una-Columna.md,roadmap/Post_Hito10.8_Pendientes.md | audiencia=humanos+IA | fase=11 -->

# ADR-142 — Una palabra partida entre dos items sigue siendo una palabra

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El planificador, sobre el diagnóstico del implementador en H-02B (plan de campaña §4.2, paso 5: "cerrar ADR si cambia la regla de empalme o interpretación geométrica").
- **Relacionado con**: ADR-102 (el flujo de glifos, que es el instrumento que esto usa), ADR-108 §2 (los espacios del flujo que la cadena no trae — el motivo por el que la regla **no** es simétrica), ADR-113 (dos columnas en el mismo renglón), ADR-109 (caja de tinta)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. El pendiente estaba mal clasificado

`Post_Hito10.8_Pendientes.md` §24 describe ocho items de un sello de
notificación electrónica —uno con un nombre— diciendo que su "origen de texto
cae sobre el segundo glifo del run". El implementador reprodujo el caso contra
el motor real y encontró que **el origen está bien**. Lo que está mal es otra
cosa, y es una regla que el motor nunca tuvo.

### 2. Qué hace pdf.js, medido

Cinco PDFs sintéticos mínimos, escritos a mano con el operador `TJ` (sin
`pdf-lib`, que no genera esta forma), Helvetica 12 pt, leídos con el
`pdfjs-dist@4.10.38` del repo:

| contenido del `TJ` | ajuste | items que devuelve `getTextContent()` |
|---|---|---|
| `[(N) 400 (otificado a JUAN PEREZ)]` | −4,8 pt | **dos**: `"N"` y `"otificado a JUAN PEREZ"` |
| `[(N) 60 (otificado a JUAN PEREZ)]` | −0,72 pt | uno: `"Notificado a JUAN PEREZ"` |
| `[(JUAN) 400 ( PEREZ)]` | −4,8 pt | uno: **`"JUANPEREZ"`** |
| `[(JUAN) 400 (PEREZ)]` | −4,8 pt | dos: `"JUAN"` y `"PEREZ"` |
| `[(JUAN) -400 (PEREZ)]` | +4,8 pt | uno: `"JUAN PEREZ"` |

El mecanismo está en `compareWithLastPosition` del extractor de pdf.js: cuando
el avance entre dos glifos es más negativo que
`fontSize × NEGATIVE_SPACE_FACTOR` —y `NEGATIVE_SPACE_FACTOR` vale **−0,2**, o
sea −2,4 pt a 12 pt— llama a `flushTextContentItem()` y corta el item **sin
insertar ningún espacio**. Un ajuste de kerning grande, que es exactamente el
efecto tipográfico decorativo de un sello o una carátula, cae ahí.

Las dos últimas filas dicen algo que conviene tener presente: **los espacios de
`item.str` no son los espacios del documento**. Con la opción por defecto
(`keepWhiteSpace: false`), el glifo de espacio real nunca se agrega a la
cadena: solo mueve el cursor, y pdf.js después *sintetiza* un espacio a partir
del avance geométrico. Por eso un espacio real con kerning encima desaparece
(`"JUANPEREZ"`) y un hueco sin espacio aparece (`"JUAN PEREZ"`). No es un bug
de pdf.js: es un extractor que reconstruye palabras a partir de posiciones.

### 3. El motor tokeniza cada item por separado, y ahí termina

`convertTextItemsToWords` (`pdf-engine/src/pdf.engine.ts`) hace
`str.matchAll(/\S+/g)` **por item** y empuja un `Word` por token. No hay ninguna
noción de continuidad entre un item y el siguiente. Verificado por el
implementador contra `PdfEngine.process` sin mocks: el primer caso de la tabla
produce los `Word` `"N"` y `"otificado"` en vez de `"Notificado"`.

Un nombre partido así llega al detector como dos fragmentos. NER no reconoce
ninguno de los dos, Regex tampoco, y el dato queda sin tapar en el export. Es la
fuga de §24, con su causa real.

### 4. Y la información para arreglarlo ya está en el motor

ADR-102 construyó un **flujo de glifos continuo por página**, en orden de
dibujo, con la posición y el avance real de cada glifo, y sin fronteras de run
—porque las fronteras eran el problema—. Ese flujo incluye los glifos de
espacio (`appendRunGlyphs` no filtra nada; `isBlankGlyph` los reconoce). O sea:
el motor ya sabe, con exactitud y sin heurística, si entre el último glifo de un
item y el primero del siguiente hay algo.

## Decisión

**El flujo de glifos decide dónde termina una palabra; `getTextContent()` no.**

### 1. Cuándo se empalman dos items

El último token del item *A* y el primer token del item *B* (consecutivos en
`textContent.items`) forman **una sola palabra** si se cumplen **todas** estas
condiciones:

1. Los dos items **alinearon** contra el flujo (ADR-102 §2). Sin alineación no
   hay empalme: se cae al camino de reserva de ADR-020 §1, intacto.
2. El primer glifo de *B* es **exactamente el siguiente** del último glifo de
   *A* en el flujo: `índice(B₀) === índice(Aₙ) + 1`. Un glifo en el medio —de
   espacio o de cualquier otra cosa— cancela el empalme.
3. `A.str` no termina en espacio y `B.str` no empieza con espacio.
4. Mismo versor de avance y de ascenso (`dir`, `up`): un cambio de orientación
   no se empalma.
5. El desplazamiento **transversal** entre los dos glifos es ≤ 1 pt
   (`SAME_LINE_TOLERANCE`, el que ya usa el orden de lectura). Un salto de
   renglón no se empalma aunque los glifos sean contiguos.
6. El hueco **a lo largo del avance** —`B₀.x − (Aₙ.x + Aₙ.advance)`, proyectado
   sobre `dir`— es menor que `0,102 × item.height`. Es el mismo umbral con el
   que pdf.js decide que un hueco **no** es un espacio
   (`TRACKING_SPACE_FACTOR`): si el hueco fuera mayor, el propio extractor
   habría sintetizado un espacio y no estaríamos ante una palabra partida.

La regla es **transitiva**: tres items pueden formar una palabra; se pliega de a
pares hasta que una condición falla.

### 2. Qué produce el empalme

- `text`: concatenación directa de los dos fragmentos, sin separador,
  normalizada NFC **después** de concatenar (un diacrítico combinante partido
  entre items solo compone si se normaliza el resultado, no las partes).
- `bbox`: la envolvente axis-aligned de las cajas de tinta de los fragmentos
  (ADR-109). Con kerning negativo los fragmentos se superponen y la envolvente
  sigue siendo correcta.
- `confidence: 1.0`, `source: "pdf"`, `pageIndex`: sin cambios.

Los `Word` de los fragmentos no se emiten: se emite el empalmado, en la posición
que ocupaba el primero.

### 3. Detalle que hay que mirar antes de escribir el código

El camino `tokens.length <= 1` de `convertTextItemsToWords` **retorna antes** de
buscar el glifo de arranque y de alinear. Y el fragmento típico de una palabra
partida —`"N"`— es justamente un item de un solo token. Sin mover esa
alineación fuera del `if`, la regla no se dispara nunca en el caso que la
motiva.

### 4. Instrumentación

Se cuentan los empalmes por página y se loguean en `debug`, junto a los
`joinStats` de ADR-097 §5. La pregunta "¿cada cuánto pasa esto en un documento
real?" tiene que poder contestarse sin volver a instrumentar a mano.

### 5. Cierre

Los ocho items del sello se vuelven a medir por ID sintético, con la tabla
antes/después y sus unidades, más el corpus de no-regresión completo. Que
desaparezca un warning o que se mueva una caja en un snapshot no alcanza
(plan §4.2, cierre).

## Consecuencias

**A favor**

- El defecto se corrige donde está: en la frontera entre dos items, no en la
  posición de una caja. No hay corrimiento fijo a la izquierda ni cajas
  ensanchadas "por las dudas" —las dos salidas que arreglarían este sello
  rompiendo otros runs.
- Las seis condiciones son **verificables**, no estimadas: cinco salen del flujo
  de glifos que ya existe y la sexta es la constante con la que el propio
  extractor decide lo mismo.
- Cuando algo no encaja, no se empalma. El peor caso de la regla es quedarse
  como está hoy.

**En contra**

- **Dos palabras distintas pegadas por un kerning grande y sin espacio real se
  fusionan mal.** Es la cuarta fila de la tabla (`[(JUAN) 400 (PEREZ)]` →
  `"JUANPEREZ"`). Ningún dato del archivo distingue ese caso de una palabra
  partida: el productor escribió lo mismo. Se acepta porque fusionar dos
  palabras deja un `Word` más largo que **contiene** a los dos valores y cuya
  caja los cubre a los dos —el reemplazo tapa de más, no de menos—, mientras que
  partir una palabra deja un nombre sin detectar.
- **La regla no es simétrica y no debe volverse simétrica.** El caso espejo
  —dos palabras que pdf.js fusionó comiéndose el espacio real, tercera fila de
  la tabla— parece resoluble cortando donde el flujo tiene un glifo en blanco.
  No lo es: ADR-108 §1 midió un run de una pericia con **96 espacios en el
  flujo, de los cuales solo 7 llevan word spacing**, contra una cadena que trae
  muchos menos. Cortar en cada blanco del flujo haría pedazos esos tokens. El
  caso queda **abierto y documentado**, no resuelto de contrabando.
- La composición geométrica de ADR-141 mueve el flujo de glifos y los orígenes
  de los items **juntos**, así que la condición 2 sobrevive; pero las dos tareas
  tocan las mismas líneas y conviene no cruzarlas en el mismo commit.

**Lo que no toca**: `Contracts.md` —no hay tipo, evento ni código de error
nuevo—, el camino de reserva de ADR-020 §1, la alineación de ADR-102 (que se
reusa tal cual) ni ningún otro motor.
