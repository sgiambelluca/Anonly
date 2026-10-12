<!-- CONTEXT: scope=adr | dependencias=core/Regex_Engine.md,core/NER_Engine.md,core/Grouping_Engine.md,core/Contracts.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-092-La-Caratula-Es-Un-Patron-No-Un-Caso-De-Modelo.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md,adr/ADR-147-Perder-Un-Identificador-Cubierto-Es-Una-Regresion.md,adr/ADR-212-La-Direccion-Incluye-La-Altura-Que-La-Sigue.md,adr/ADR-214-La-Que-Pierde-Un-Conflicto-No-Se-Descarta-Si-Cubre-Mas-Texto.md,roadmap/hardening/Confianza_Cierre_2026-10-08.md,roadmap/mediciones/ner/Direcciones_Con_Palabra_Clave_2026-10-08.md,roadmap/mediciones/ner/Altura_De_Direcciones_2026-10-07.md,roadmap/Roadmap_1.x.md | audiencia=humanos+IA | fase=12 -->

# ADR-217 — Una dirección con palabra clave es un patrón

- **Estado**: Aceptado por el mantenedor el 2026-10-08, con el detalle de las
  listas y de los límites. Implementado y medido el 2026-10-09 (M-D3): cumple
  los resultados esperados, de forma provisional sobre el árbol sin
  commitear. Faltan la revisión independiente del lote y la repetición
  sobre el commit.
- **Fecha**: 2026-10-08.
- **Decidido por**: el mantenedor, a propuesta del planificador.
- **Origen**: el límite que dejó ADR-212 («una calle que el modelo no
  marca») y la línea de base
  [M-D2](../roadmap/mediciones/ner/Direcciones_Con_Palabra_Clave_2026-10-08.md).
- **Alcance**: `regex-engine`. Sin contrato nuevo y sin dependencias nuevas.
- **Relacionado con**:
  - ADR-092: la carátula, el precedente de un patrón para un tipo que
    detecta el modelo;
  - ADR-212: la forma del número de una altura;
  - ADR-117 y ADR-214: qué pasa cuando dos detecciones se pisan.

## Contexto

La aplicación no tiene un detector de direcciones. El modelo de nombres
marca lugares, el motor los convierte en dirección y ADR-212 les suma la
altura. Si el modelo no marca la calle, calle y altura quedan a la vista.

M-D2 midió el caso en que la dirección viene con una palabra clave antes:
138 páginas sintéticas, cada oración en escritura normal, en mayúsculas con
tildes y en mayúsculas sin tildes.

- Queda algo a la vista en **41 de 138**: 8 de 46 en escritura normal, 16 en
  mayúsculas con tildes y 17 sin tildes.
- En las tres escrituras fallan «pasaje Rauch 742», «diagonal Norte 615»,
  «Bv. Gálvez 2150», «12 de Octubre 1575» y las calles numeradas.
- En mayúsculas falla además la dirección con palabra de domicilio y sin
  palabra de vía («DOMICILIADA EN SARMIENTO 742»).

Lo que sigue a «Av.» es el nombre de una calle, esté escrito como esté. Es
un formato fijo, y un formato fijo es un patrón (ADR-092).

## Lo que decidió el mantenedor (2026-10-08)

1. **Entra un patrón anclado en una palabra clave**, que valga igual en
   mayúsculas y en minúsculas. El patrón por forma, sin palabra clave («se
   presentó en Urquiza 98»), queda afuera.
2. **Una sola regla para las tres escrituras, aceptando lo que tapa de más
   en un texto todo en mayúsculas** («Lo que se tapa de más»).
3. **El detalle propuesto por el planificador, aceptado tal cual**: las
   listas de palabras clave, sin «ruta»; el tope de seis palabras para el
   nombre; el piso y el departamento afuera, como en ADR-212; y que una
   patente contenida en la dirección deje de emitirse aparte.

## Decisión

### 1. Dónde empieza: la palabra clave

La palabra clave se reconoce sin distinguir mayúsculas de minúsculas. Hay
dos clases.

- **Palabra de vía. Forma parte de la dirección**, como en lo que ya marca
  el modelo («Av. Corrientes 1980»): «calle», «avenida», «pasaje»,
  «boulevard», «diagonal», y las abreviaturas «av», «avda», «pje» y «bv»,
  con o sin punto.
- **Palabra de domicilio. No forma parte de la dirección**: la dirección
  empieza en la palabra siguiente.
  - «domicilio en», y «domicilio» seguido de «real», «legal», «procesal»,
    «especial» o «constituido» y «en»;
  - «domiciliado en» y «domiciliada en»;
  - «sito en» y «sita en».

La palabra clave empieza palabra: no vale en medio de otra.

### 2. El nombre de la calle

De una a seis palabras, separadas por uno o dos espacios. Cada una es:

- una palabra que **empieza con mayúscula**, con apóstrofo interno y punto
  final opcionales («Gálvez», «O'Higgins», «Dr.»);
- o un número de uno a cuatro dígitos, con «°» o «º» opcional («25», «1°»);
- o uno de estos conectores, en cualquier escritura: «de», «del», «la»,
  «las», «los», «y», «e».

En un texto todo en mayúsculas todas las palabras empiezan con mayúscula,
así que la regla es la misma para las tres escrituras. En escritura normal,
la mayúscula inicial es lo que distingue «calle Tucumán» de «la calle
estuvo».

El nombre toma **la menor cantidad de palabras** que llegue a una altura:
«Maipú 1434, torre 2» termina en «1434».

### 3. Dónde termina: la altura

La altura es obligatoria. Su forma es la del «número que sigue» de ADR-212,
punto 2, sin cambios: de uno a cinco dígitos, con «N°», «Nº», «No.», «nro.»,
«número» o «al» opcionales antes, y sin continuar como fecha, importe o
rango.

Una dirección sin altura no la detecta este patrón. M-D2 midió que el
modelo ya las cubre: las 18 páginas de esa categoría quedaron tapadas.

### 4. Qué se emite

- Una ocurrencia de tipo `Address`, con `source: "regex"` y
  `confidence: 1.0`, como todo patrón.
- El valor va desde la palabra de vía, o desde la primera palabra del nombre
  si la clave es de domicilio, hasta el último dígito de la altura.
- `normalizedValue` sale de `normalizeEntityValue`, la misma función que usa
  el motor de nombres. Una dirección que el modelo y el patrón marcan con el
  mismo tramo es una sola ocurrencia para el agrupador.
- `maskFormat`: el de `Address` en ADR-012, `XXXXXX XXX`.
- El resto del camino es el de cualquier match: prioridad del match más
  largo, mapeo a palabras, `fragments`, `rotation` y eventos.

### 5. Costo acotado

La búsqueda está anclada en la palabra clave y el nombre tiene un tope de
seis palabras. Sobre un texto adverso, duplicar el largo no cuadruplica el
trabajo. Lleva su prueba de peores casos, como el email (ADR-181).

### 6. El spec de Regex deja de decir que las direcciones no son suyas

`Regex_Engine.md` §3 pasa a decir que Regex no detecta direcciones **salvo
las que tienen esta forma**. El resto sigue siendo del modelo.

## Lo que queda sin cubrir

- **Una calle sin palabra clave antes**: «se presentó en Urquiza 98». Es el
  límite de ADR-212, medido en M-D1, y sigue igual.
- **Una calle numerada sin altura**: «calle 13 entre 44 y 45», en escritura
  normal.
- **Una ruta**: «ruta 205 kilómetro 54». Tiene otra forma.
- **Piso, departamento y cruce.** Lo que sigue a la altura no se suma, como
  en ADR-212. Medido en M-D2: queda tapado entero en 3 de 39 páginas.
- **Un nombre de más de seis palabras.**
- **Otras palabras de vía o de domicilio** que no están en las listas. Se
  agregan con una enmienda de este ADR.

## Lo que se tapa de más

- **En un texto todo en mayúsculas, una palabra de vía usada como palabra
  común con un número cerca.** Evaluado sobre las trampas de M-D2: caen 6 de
  9, en las dos escrituras en mayúsculas.

  | Oración | Lo que se taparía |
  |---|---|
  | LA CALLE ESTUVO CORTADA 3 HORAS POR LA MARCHA. | CALLE ESTUVO CORTADA 3 |
  | LOS VECINOS DE LA AVENIDA RECLAMARON 15 VECES. | AVENIDA RECLAMARON 15 |
  | EL PASAJE COSTÓ 4500 PESOS SEGÚN EL RECIBO. | PASAJE COSTÓ 4500 |
  | TRABAJA EN LA CALLE DESDE 1998 COMO VENDEDOR. | CALLE DESDE 1998 |
  | LA DIAGONAL DEL TERRENO MIDE 120 METROS. | DIAGONAL DEL TERRENO MIDE 120 |
  | SOBRE LA AVENIDA CIRCULABAN 2 CAMIONES. | AVENIDA CIRCULABAN 2 |

  En mayúsculas nada distingue un verbo de un nombre de calle. **El
  mantenedor aceptó este costo el 2026-10-08.** En escritura normal no cae
  ninguna de las 9.
- **Una calle numerada con cruces, en mayúsculas**: «CALLE 13 ENTRE 44 Y
  45» da «CALLE 13 ENTRE 44», porque «ENTRE» pasa por nombre. Queda «Y 45»
  sin tapar. En escritura normal el patrón no la toma (M-D3).
- **Un artículo antes de la palabra de vía, en mayúsculas**: «DOMICILIO
  PROCESAL EN LA CALLE TUCUMÁN 1650» da «LA CALLE TUCUMÁN 1650».
- **Un lugar con un número que no es una altura, después de una palabra de
  domicilio**: «fijó domicilio en Rosario 2019». Es el mismo costo de
  ADR-212, que el modelo ya produce.
- **Un año después de un nombre con forma de fecha**: «calle 9 de Julio de
  2026» da la frase entera, porque «2026» tiene forma de altura. La fecha
  deja de emitirse aparte, pero su tinta queda tapada por la dirección. Lo
  encontró el implementador el 2026-10-09; es de la misma familia que el
  caso anterior y no cambia la regla.

En todos los casos el usuario ve la dirección en la lista y la puede
desactivar. Es el criterio de ADR-212: entre tapar de más y dejar una
dirección a la vista, el producto elige lo primero.

## Cuando el patrón y otra detección se pisan

- **Con la dirección del modelo, mismo tramo**: la segunda en llegar se
  descarta por identidad. Queda una.
- **Con una dirección del modelo más corta o más larga**: si la contenida
  llega después, se descarta (ADR-117). Si llega antes, quedan las dos y las
  dos se pintan: es el límite conocido de ADR-117. Pasa, por ejemplo, con
  «calle 50 N° 889 de La Plata», que el modelo marca entera.
- **Con una persona u organización del modelo** sobre el nombre de la calle
  («Bv. Gálvez 2150», donde el modelo marca «Gálvez» como persona): gana el
  patrón, y la calle y la altura quedan tapadas (casos 7, 8 y 77 de
  `Grouping_Engine.md`).
- **Con otro patrón** contenido en la dirección («MAR 450» como patente
  dentro de «AVENIDA DEL MAR 450»): dentro de Regex se emite el match más
  largo, que es la dirección.

## Cómo se decide si alcanza

Con el patrón implementado se vuelve a correr el arnés de M-D2 y se compara
contra la línea de base.

| | Línea de base | Se espera |
|---|---:|---:|
| Páginas con algo a la vista, de 138 | 41 | 4 |
| Trampas tapadas en escritura normal, de 9 | 0 | 0 |
| Trampas tapadas en mayúsculas, de 18 | 2 | 12 |

Las 4 que quedan son «ruta 205 kilómetro 54» en las tres escrituras y
«calle 13 entre 44 y 45» en escritura normal.

Además:

**Medido el 2026-10-09 (M-D3, provisional hasta repetirlo sobre el
commit): 4, 0 y 12.** Ninguna página difiere de lo esperado
([informe](../roadmap/mediciones/ner/Direcciones_Con_Palabra_Clave_2026-10-08.md),
«Después del cambio»). M-D1 da los totales de la regla vigente, la línea de
base de calidad no pierde ninguna entidad, y el tiempo crece lineal en los
peores casos.

Además:

- el arnés de M-D1 da lo mismo que antes;
- la línea de base de calidad no pierde ninguna entidad cubierta (ADR-147);
  si cambian los falsos positivos, se informan;
- ninguna otra entidad del corpus de M-D2 queda peor.

Si un número no se cumple, vuelve al mantenedor.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Aceptar cualquier palabra como parte del nombre | Evaluada sobre M-D2: cierra una página más, y tapa 6 de 9 trampas también en escritura normal |
| En mayúsculas, solo abreviaturas y palabras de domicilio | No tapa ninguna trampa, pero deja a la vista 12 páginas más. El mantenedor eligió la regla única |
| Un patrón por forma, sin palabra clave | En un escrito judicial «palabra con mayúscula y número» está por todos lados («Ley 25326», «fojas 12»). Fuera del alcance decidido |
| Extender la regla de ADR-212 en `ner-engine` | Esa regla extiende lo que el modelo marcó. Acá el modelo no marcó nada |
| Un nomenclador de calles | Es un dato externo que no escala, y pide su propio ADR (R-12) |

## Consecuencias

- Cambia la detección: el mismo documento puede dar un resultado distinto
  que en la versión anterior. Sale como parte del bloque de Confianza y las
  notas de la versión lo dicen (`Roadmap_1.x.md` §2).
- Un documento todo en mayúsculas puede mostrar direcciones de más en la
  lista. Es el costo aceptado.
- La patente contenida en una dirección con palabra clave deja de emitirse:
  la tinta queda tapada por la dirección.

## Plan y validación

1. `Regex_Engine.md` v1.16.0: §2, §3, caso 36, §14, §15 ítem 24 y la tabla
   de patrones.
2. El implementador de `regex-engine` implementa desde el spec, con los
   nombres de test de §14.
3. En commit propio, el arnés de M-D2 pasa a esperar el resultado de la
   regla, y la prueba de peores casos.
4. Medición del después y comparación (arriba).
5. Revisor, con todo el lote.
