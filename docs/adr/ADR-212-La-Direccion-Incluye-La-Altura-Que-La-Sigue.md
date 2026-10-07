<!-- CONTEXT: scope=adr-aceptado | dependencias=core/NER_Engine.md,core/Contracts.md,adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md,adr/ADR-095-La-Regla-De-Matcheo-Es-La-Metrica.md,roadmap/hardening/Confianza_1.0.x_Plan.md,roadmap/Roadmap_1.x.md,roadmap/mediciones/ner/Altura_De_Direcciones_2026-10-07.md | audiencia=humanos+IA | fase=12 -->

# ADR-212 — La dirección incluye la altura que la sigue

- **Estado:** Aceptado por el mantenedor el 2026-10-07. Ese día aceptó
  primero, a prueba, una regla que no sumaba los números con forma de año
  salvo que hubiera una palabra de dirección cerca. Con la medición M-D1 a
  la vista decidió **sumar el número siempre**. Este texto describe la regla
  final; la que se probó está en «La regla que se probó y se descartó».
- **Fecha:** 2026-10-07.
- **Alcance:** `ner-engine`, ocurrencias de tipo `Address`.

## Contexto

El modelo de nombres reconoce lugares, no domicilios (`NER_Engine.md` §14.1).
Sobre «con domicilio en Maipú 1434» marca `Maipú` y deja el número afuera.
En la línea de base de calidad hay cuatro direcciones de la forma «calle
número», y en las cuatro pasaba eso: la calle salía tapada y la altura
quedaba a la vista.

Auditado el 2026-10-07 con el modelo real, sobre oraciones sintéticas:

| Oración | Lo que marca el modelo |
|---|---|
| «con domicilio en Maipu 1434» | `Maipu` |
| «se realizó en Rosario 2019» | `Rosario` |
| «vive en Belgrano 1950, piso 3, departamento B» | `Belgrano` y `departamento B` |
| «sita en Av. Corrientes 1234» | `Av. Corrientes 1234` |
| «en la calle San Martin 850» | `calle San Martin` |
| «el torneo Mar del Plata 1995» | nada |

El modelo no distingue una altura de un año: marca el lugar igual en los dos
casos y al número no le pone etiqueta. Tampoco es parejo: con «Av.» incluyó
el número y con «calle» no.

## Decisión

1. **Una dirección que el modelo marcó se extiende hasta el número que la
   sigue.** Es un paso posterior al modelo, dentro de `ner-engine`, sobre el
   texto de la página. No hay detector nuevo ni patrón de Regex.
2. **Qué es «el número que la sigue»**: de uno a cinco dígitos,
   inmediatamente después de la dirección, separados por un espacio. Entre
   la calle y el número puede haber «N°», «Nº», «No.», «nro.», «número» o
   «al» («Rivadavia al 4500»). No cuenta un número que sigue con más
   dígitos, una barra, o un punto, una coma o un guion seguidos de un
   dígito: eso es una fecha, un importe o un rango.
3. **El número se suma siempre**, también cuando tiene forma de año. No se
   mira el contexto: «Rosario 2019» pasa a ser una sola dirección, igual que
   «Belgrano 1950».
4. **Si el modelo ya incluyó el número, no cambia nada.**
5. **Solo se extienden las direcciones.** Una persona o una organización
   seguida de un número no se tocan.
6. **La ocurrencia extendida es una sola**, con su valor, su caja y sus
   palabras abarcando calle y número. Conserva la confianza que le dio el
   modelo.
7. **No se extiende sobre una palabra de otro ángulo**: una dirección al
   final del texto horizontal no absorbe el número de un folio girado en el
   margen.

No cambia ningún contrato. Sin dependencias nuevas.

## Por qué siempre

Un año tapado de más aparece en la lista de entidades y el usuario lo
desactiva. Una altura que quedó a la vista es algo que el usuario tiene que
descubrir por su cuenta. Entre los dos errores, el producto elige el
primero.

Además, la regla que se probó no evitaba del todo el primer error: una
palabra de su lista cerca por otro motivo también tapaba un año.

## Lo que queda sin cubrir

- **Una calle que el modelo no marca.** La regla extiende lo que el modelo
  encontró; no encuentra direcciones nuevas. Medido en M-D1: 9 de 48
  oraciones con un domicilio. Ahí quedan a la vista la calle y la altura.
  Es el límite más grande de este ADR.
- **Piso, departamento, código postal y localidad.** No se suman a la
  dirección. A veces el modelo marca alguno por su cuenta.
- **Una calle que el modelo marca a medias**: sobre «La Plata» marcó a veces
  solo «Plata».

## Lo que se tapa de más

- **Un año pegado a un lugar**: «El congreso se realizó en Rosario 2019» da
  la dirección «Rosario 2019». Medido en M-D1: los 9 casos en que el modelo
  marcó el lugar, de 20 oraciones.
- **Un lugar seguido de un número que no es una altura**: «Viajó a Mendoza
  3 veces» da «Mendoza 3», y «Pagó en La Plata 3500 pesos» da «La Plata
  3500». Medido en M-D1: 6 de 8 oraciones escritas para eso. Los otros 2
  eran una fecha y un importe con punto, que la forma del número excluye.
- **Un número que es parte de otro dato** pegado a un lugar: «Belgrano 11
  4444-5555» sumaría el «11». Si coincide con otra detección, lo resuelve el
  mecanismo de conflictos de siempre.

En los tres casos el usuario ve la dirección en la lista y la puede
desactivar o corregir.

## La regla que se probó y se descartó

Un número con forma de año, de cuatro dígitos entre 1900 y 2099, se sumaba
solo si había una palabra de dirección cerca: «domicilio», «calle»,
«avenida», «vive», «reside» y otras antes de la dirección; «piso»,
«departamento», «de esta ciudad» y otras después del número. Sin ninguna, el
número no se tocaba.

Se implementó y se midió (M-D1,
`roadmap/mediciones/ner/Altura_De_Direcciones_2026-10-07.md`), sobre 76
oraciones sintéticas con el modelo real:

| | Regla por contexto | Sumar siempre |
|---|---:|---:|
| Alturas a la vista, de 39 con la calle marcada | 6 | 0 |
| Años tapados de más, de 9 con el lugar marcado | 4 | 9 |
| Otros números tapados de más, de 8 | 6 | 6 |

- La regla por contexto se comportó como estaba escrita en las 76
  oraciones.
- Las 6 alturas a la vista eran alturas con forma de año en una oración sin
  palabra de dirección.
- De los 4 años que tapó de más, uno salió de «pisó», que sin tilde es
  «piso».
- Los números de «sumar siempre» se derivaron de los mismos datos: son los
  casos en que la regla decidió no extender. El mantenedor decidió no volver
  a medir después del cambio.

La línea de base de calidad, medida con la regla por contexto, cubre las
cuatro direcciones y no cambia en nada más. Ninguna de las cuatro alturas
tiene forma de año, así que el resultado es el mismo con la regla final.

## Otras alternativas

| Alternativa | Por qué no |
|---|---|
| Un patrón de Regex para domicilios | Tendría que reconocer nombres de calles sin el modelo. El modelo ya encuentra la calle en la mayoría de los casos medidos |
| Cambiar de modelo | Otro alcance: tamaño, memoria, licencias y una línea de base nueva |
| Extender por la etiqueta de fecha del modelo | Probado: el modelo no etiqueta un año suelto como fecha |

## Consecuencias

- La altura de una dirección deja de quedar a la vista cuando el modelo
  marca la calle.
- Cambia la detección: por `Roadmap_1.x.md` §1 es un parche, y las notas de
  la versión dicen que el mismo documento puede dar un resultado distinto.
- La lista de entidades muestra «Maipú 1434» donde antes mostraba «Maipú».
  Dos apariciones de la misma calle con alturas distintas pasan a ser dos
  direcciones distintas.
- Un lugar seguido de un año aparece como una dirección con el año
  adentro.
- La regla no depende de ninguna lista de palabras.

## Plan y validación

1. El spec: `NER_Engine.md` (nota de versión, caso 34, tests de §14 con sus
   nombres, §14.1 e ítem de §15).
2. El código, en `ner-engine` solo: primero con la regla por contexto y
   después, con la decisión, sin ella.
3. El arnés de M-D1 (`tests/perf`) pasa a esperar el resultado de la regla
   final, para que una corrida futura compare contra lo vigente.
4. Promover el candidato de la línea de base de calidad es un cambio aparte
   (ADR-147 §5), y pide una medición del producto final.
