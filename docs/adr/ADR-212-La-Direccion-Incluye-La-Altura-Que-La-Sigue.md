<!-- CONTEXT: scope=adr-aceptado | dependencias=core/NER_Engine.md,core/Contracts.md,adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md,adr/ADR-095-La-Regla-De-Matcheo-Es-La-Metrica.md,roadmap/hardening/Confianza_1.0.x_Plan.md,roadmap/Roadmap_1.x.md | audiencia=humanos+IA | fase=12 -->

# ADR-212 — La dirección incluye la altura que la sigue

- **Estado:** Aceptado por el mantenedor el 2026-10-07, **a prueba**: «probemos
  con esta regla; si vemos que todavía no es lo suficientemente estricta,
  tapamos todo», con mediciones para decidir.
- **Fecha:** 2026-10-07.
- **Alcance:** `ner-engine`, ocurrencias de tipo `Address`.

## Contexto

El modelo de nombres reconoce lugares, no domicilios (`NER_Engine.md` §14.1).
Sobre «con domicilio en Maipú 1434» marca `Maipú` y deja el número afuera.
En la línea de base de calidad hay cuatro direcciones de la forma «calle
número», y en las cuatro pasa eso: la calle sale tapada y la altura queda a
la vista.

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
el número y con «calle» no. La distinción tiene que salir de una regla
propia, que lea el contexto.

## Decisión

1. **Una dirección que el modelo marcó se extiende hasta el número que la
   sigue.** Es un paso posterior al modelo, dentro de `ner-engine`, sobre el
   texto de la página. No hay detector nuevo ni patrón de Regex.
2. **Qué es «el número que la sigue»**: de uno a cinco dígitos,
   inmediatamente después de la dirección, separados por un espacio. Entre
   la calle y el número puede haber «N°», «Nº», «nro.», «número» o «al»
   («Rivadavia al 4500»). No cuenta un número que sigue con más dígitos, una
   barra, o un punto, una coma o un guion seguidos de un dígito: eso es una
   fecha, un importe o un rango.
3. **Si el número no parece un año, se suma siempre.** «Parece un año» es un
   número de cuatro dígitos entre 1900 y 2099.
4. **Si parece un año, se suma solo si hay una palabra de dirección cerca.**
   - Antes de la dirección, o como comienzo de ella: «domicilio»,
     «domiciliado» y sus variantes, «calle», «avenida», «av.», «avda.»,
     «sito» o «sita», «vive» o «viven», «reside» o «residen».
   - Después del número: «piso», «departamento», «depto.», «dpto.», «de esta
     ciudad», «de la localidad».
   - «Cerca» es dentro de las seis palabras anteriores a la dirección y de
     las cuatro posteriores al número.
5. **Sin ninguna de esas palabras, un número con forma de año no se toca.**
   «Rosario 2019» queda como está.
6. **Si el modelo ya incluyó el número, no cambia nada.**
7. **Solo se extienden las direcciones.** Una persona o una organización
   seguida de un número no se tocan.
8. **La ocurrencia extendida es una sola**, con su valor, su caja y sus
   palabras abarcando calle y número. Conserva la confianza que le dio el
   modelo.

No cambia ningún contrato. Sin dependencias nuevas.

## Lo que queda sin cubrir

- **Una altura con forma de año en una oración sin ninguna palabra de
  dirección** («Belgrano 1950» a secas): el número sigue a la vista. Es el
  costo aceptado de no tapar años. Es lo que se mide para decidir si la regla
  alcanza.
- **Piso, departamento, código postal y localidad.** No se suman a la
  dirección. A veces el modelo marca alguno por su cuenta.
- **Una calle que el modelo no marca.** La regla extiende lo que el modelo
  encontró; no encuentra direcciones nuevas.
- **Un lugar seguido de un número que no es una altura**: «Viajó a Mendoza
  3 veces» da «Mendoza 3». Se tapa un número de más. Medido en M-D1: 6 de
  8 oraciones escritas para eso.
- **Un número que es parte de otro dato** pegado a un lugar. La regla exige
  frontera después de los dígitos, pero un caso como «Belgrano 11
  4444-5555» sumaría el «11». Si coincide con otra detección, lo resuelve el
  mecanismo de conflictos de siempre.

## La alternativa que queda en reserva: tapar siempre

Sumar el número aunque parezca un año y no haya palabra de dirección. Cierra
el primer punto de arriba y tapa de más algún año pegado a un lugar. El
mantenedor la adopta si la medición muestra que la regla por contexto deja
escapar alturas.

## Otras alternativas

| Alternativa | Por qué no |
|---|---|
| Un patrón de Regex para domicilios | Tendría que reconocer nombres de calles sin el modelo. El modelo ya encuentra la calle en los casos medidos |
| Cambiar de modelo | Otro alcance: tamaño, memoria, licencias y una línea de base nueva |
| Extender por la etiqueta de fecha del modelo | Probado: el modelo no etiqueta un año suelto como fecha |

## Cómo se decide si la regla alcanza

Una medición propia, **M-D1**, sobre oraciones sintéticas escritas para esto,
corridas por la aplicación con el modelo real. Por categoría se cuenta si el
modelo marcó el lugar y si el número quedó tapado:

| Categoría | Qué se espera de la regla |
|---|---|
| Altura que no parece año, con y sin palabra de dirección | tapada |
| Altura con forma de año y palabra de dirección antes | tapada |
| Altura con forma de año y palabra de dirección después | tapada |
| Altura con forma de año, sin palabra de dirección | **a la vista** (lo que falta cubrir) |
| Lugar y año, sin palabra de dirección | año sin tocar |
| Lugar y año con una palabra de dirección cerca por otro motivo | año tapado de más (riesgo de la regla) |
| Variantes: «N°», «nro.», «al», cinco dígitos | tapada |

El informe da, para la regla por contexto y para «tapar siempre», cuántas
alturas quedan a la vista y cuántos años quedan tapados de más. Los números
de «tapar siempre» se derivan de los mismos datos: son todos los casos en
los que la regla decidió no extender.

Además se vuelve a correr la línea de base de calidad: las cuatro
direcciones tienen que quedar cubiertas, y ningún otro tipo puede empeorar.

Con ese informe el mantenedor decide si la regla queda o si se tapa siempre.

**Medido el 2026-10-07**
(`roadmap/mediciones/ner/Altura_De_Direcciones_2026-10-07.md`). Sobre 76 oraciones, con el modelo real:

| | Regla por contexto | Tapar siempre |
|---|---:|---:|
| Alturas a la vista, de 39 con la calle marcada | 6 | 0 |
| Años tapados de más, de 9 con el lugar marcado | 4 | 9 |
| Otros números tapados de más, de 8 | 6 | 6 |

- La regla se comporta como está escrita en las 76 oraciones.
- Las 6 alturas a la vista son el primer punto de «Lo que queda sin
  cubrir».
- En 9 de 48 oraciones con un domicilio el modelo no marcó la calle. Es el
  tercer punto de «Lo que queda sin cubrir», y ninguna de las dos variantes
  lo cambia.
- La tercera fila es un costo que este ADR no había anotado: un lugar
  seguido de un número cualquiera («Viajó a Mendoza 3 veces») se extiende
  igual, con las dos variantes.
- La línea de base de calidad cubre las cuatro direcciones y no cambia en
  nada más.

La decisión del mantenedor está pendiente.

## Consecuencias

- La altura de una dirección deja de quedar a la vista en el caso común.
- Cambia la detección: por `Roadmap_1.x.md` §1 es un parche, y las notas de
  la versión dicen que el mismo documento puede dar un resultado distinto.
- La lista de entidades muestra «Maipú 1434» donde antes mostraba «Maipú».
  Dos apariciones de la misma calle con alturas distintas pasan a ser dos
  direcciones distintas.
- La regla depende de una lista de palabras en castellano. Es chica y está
  escrita en este ADR; cambiarla es cambiar este ADR.

## Plan y validación

Primero el spec: `NER_Engine.md` (nota de versión, caso límite, tests de §14
con sus nombres, §14.1 e ítem de §15). Después el código, en `ner-engine`
solo. Después la medición M-D1 y la línea de base de calidad.
