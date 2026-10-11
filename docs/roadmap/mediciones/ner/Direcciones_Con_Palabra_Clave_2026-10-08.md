<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/hardening/Confianza_Cierre_2026-10-08.md,adr/ADR-212-La-Direccion-Incluye-La-Altura-Que-La-Sigue.md,adr/ADR-214-La-Que-Pierde-Un-Conflicto-No-Se-Descarta-Si-Cubre-Mas-Texto.md,core/NER_Engine.md,core/Regex_Engine.md,roadmap/mediciones/ner/Altura_De_Direcciones_2026-10-07.md,roadmap/Roadmap_1.x.md,tests/perf/README.md | audiencia=humanos+IA | fase=12 (M-D2, Windows 2026-10-08) -->

# Direcciones con palabra clave — línea de base (M-D2)

**Estado al retomar:** este informe conserva la línea de base anterior al
patrón y registra M-D3 en «Después del cambio». El resultado posterior es
4 de 138 páginas con algo a la vista, frente a 41 en la línea de base;
cumple el criterio aceptado de ADR-217. Es provisional y espera revisión
independiente y repetición sobre el commit.

## Resultado

Con una palabra clave antes de la calle («Av.», «calle», «domicilio en»), la
aplicación de hoy deja a la vista la calle o la altura en **41 de 138
páginas** sintéticas. No depende solo de las mayúsculas: en escritura normal
son 8 de 46.

| Escritura | Páginas | Calle y altura tapadas enteras | Algo a la vista |
|---|---:|---:|---:|
| Normal | 46 | 38 | **8** |
| Mayúsculas con tildes | 46 | 30 | **16** |
| Mayúsculas sin tildes | 46 | 29 | **17** |
| Total | 138 | 97 | **41** |

«Tapadas» cuenta cualquier tipo de detección: una calle que el modelo marca
como persona queda tapada igual. En 36 de las 41 no se tapa nada del nombre
ni de la altura. En las otras 5 se tapa el nombre, o parte, y la altura queda
a la vista.

- **Lo que falla en las tres escrituras**: «pasaje Rauch 742», «diagonal
  Norte 615», «Bv. Gálvez 2150» (el nombre sale como persona y la altura
  queda a la vista), «12 de Octubre 1575» y las calles numeradas («calle 7
  número 1240», «diagonal 74 N° 1532»).
- **Lo que falla solo en mayúsculas**: una dirección con palabra de
  domicilio y sin palabra de vía. En escritura normal sale en 7 de 7; en
  mayúsculas, en 4 de 7 con tildes y en 3 de 7 sin tildes.
- **Una dirección sin altura no es el problema**: las 18 páginas de esa
  categoría quedan con la vía y el nombre tapados, en las tres escrituras.
- **Las trampas casi no se tocan**: de 27, se tapa «AVENIDA» en 2, las dos
  en mayúsculas.

No cambia producto. Es el punto de partida contra el que se mide el patrón.

## Qué se midió

- **Corpus**: 55 oraciones sintéticas en ocho categorías, cada una en tres
  escrituras: 165 páginas. Las escribió el planificador y están en el anexo
  del [plan](../../hardening/Confianza_Cierre_2026-10-08.md). Un PDF digital
  con una oración por página, entre los dos renglones de relleno de M-D1. La
  escritura se aplica a la página entera.
- **Cómo**: por la aplicación de escritorio, con el modelo real y la
  configuración por defecto. Dos corridas completas, cada una con una
  instancia fría.
- **Qué se registra por página**: para la vía, el nombre, la altura y el
  resto, si quedó tapado entero, en parte o nada por una dirección y por
  cualquier otro tipo; y todas las detecciones que tocan la oración.
- **Entorno**: Windows 11 nativo, 12 hilos, 16,9 GB de RAM. Producto de
  `develop` del 2026-10-08, sin cambios en `packages/` ni en `apps/`. Nivel
  `medium`.

**Validez.** Las dos corridas son válidas y coinciden página por página. El
texto que extrajo la aplicación es igual al escrito en las 165 páginas, con
sus tildes, la «Ñ», la diéresis, «°» y «º».

**Lo que esta medición no dice.** Cada categoría tiene entre cinco y nueve
oraciones: mide qué pasa en cada situación, no con qué frecuencia aparece en
un documento real. Las trampas se escribieron para que un patrón fallara.

## Por categoría

Páginas con la calle y la altura tapadas enteras, sobre el total. En K5 y
K6, las oraciones sin altura cuentan por el nombre.

| | Categoría | Normal | Mayúsculas con tildes | Mayúsculas sin tildes |
|---|---|---:|---:|---:|
| K1 | Palabra de vía y altura | 6 de 9 | 6 de 9 | 6 de 9 |
| K2 | Palabra de domicilio, sin palabra de vía | 7 de 7 | 4 de 7 | 3 de 7 |
| K3 | Nombre de varias palabras | 7 de 7 | 5 de 7 | 5 de 7 |
| K4 | Nombre con número o fecha | 4 de 5 | 3 de 5 | 3 de 5 |
| K5 | Calle numerada | 2 de 6 | 1 de 6 | 1 de 6 |
| K6 | Sin altura | 6 de 6 | 6 de 6 | 6 de 6 |
| K7 | Con piso o departamento después | 6 de 6 | 5 de 6 | 5 de 6 |
| | **Total** | **38 de 46** | **30 de 46** | **29 de 46** |

## Las 41 páginas con algo a la vista

| Oración | Normal | Mayúsculas con tildes | Mayúsculas sin tildes |
|---|---|---|---|
| K1-5 «pasaje Rauch 742» | nada tapado | nada | nada |
| K1-8 «Bv. Gálvez 2150» | nombre como persona, altura a la vista | igual | igual |
| K1-9 «diagonal Norte 615» | nada | nada | nada |
| K2-1 «con domicilio en Maipú 1434» | tapada | tapada | nada |
| K2-2 «domiciliada en Sarmiento 742» | tapada | nada | nada |
| K2-3 «domiciliado en Belgrano 1950» | tapada | nada | nada |
| K2-6 «sita en Alsina 455» | tapada | nada | nada |
| K3-3 «General José de San Martín 856» | tapada | parte del nombre como persona, altura a la vista | nombre como persona, altura a la vista |
| K3-5 «Doctor Luis Agote 98» | tapada | nada | nada |
| K4-1 «calle 25 de Mayo 350» | tapada | nada | nada |
| K4-4 «12 de Octubre 1575» | nada | nada | nada |
| K5-1 «calle 50 N° 889» | tapada | nada | nada |
| K5-2 «calle 7 número 1240» | nada | nada | nada |
| K5-3 «calle 13 entre 44 y 45» | nada | nada | nada |
| K5-4 «diagonal 74 N° 1532» | nada | nada | nada |
| K5-5 «ruta 205 kilómetro 54» | nada | nada | nada |
| K7-6 «Maipú 1434, torre 2, piso 8» | tapada | nada | nada |

## Lo que se ve en los datos

### La altura

- Cuando la calle sale como dirección, la altura va adentro en todos los
  casos medidos: 79 de 79. Es la regla de ADR-212.
- Las 35 alturas a la vista son de páginas donde ninguna dirección cubre la
  calle. En 30 no hay ninguna detección sobre la calle; en 5 la calle, o una
  parte, sale como persona.

### El piso, el departamento y el cruce

- Lo que sigue a la altura casi nunca queda tapado: entero en 3 de 39
  páginas y en parte en 10.
- En un cruce, las dos calles salen como direcciones separadas («Av.
  Corrientes» y «Maipú»), y la «y» o «esquina» queda a la vista. Solo en
  mayúsculas una salió entera: «CALLE LAVALLE ESQUINA CALLAO».

### Lo que el modelo tapa de más

Aparece al lado de una dirección detectada:

- en escritura normal: «calle 50 N° 889 de La Plata», que incluye «de La
  Plata»;
- en mayúsculas: «FRENTE A LA PLAZA», «CASA DEL FONDO», «LA ROTONDA»,
  «CIUDAD» y «OFICINA 14»;
- «DOMICILIO» como persona en una página en mayúsculas: el modelo marcó la
  palabra clave.

### El cruce con el patrón de patente

En «AVENIDA DEL MAR 450» la patente «MAR 450» se superpone con la dirección
y no queda nada a la vista. Es el caso que arregló ADR-214.

### Las trampas

- En escritura normal, ninguna de las 9 se toca.
- En mayúsculas, «SOBRE LA AVENIDA CIRCULABAN 2 CAMIONES» da «AVENIDA» como
  dirección, en las dos escrituras. Las otras 16 no se tocan.

## Dos variantes del patrón, evaluadas sin correr el producto

El planificador escribió dos variantes de un patrón anclado en la palabra
clave y las pasó sobre las 165 oraciones. **Es un cálculo sobre el texto, no
una medición de la aplicación**: no pasa por el agrupador ni por la
resolución de conflictos.

Las dos empiezan en una palabra de vía («calle», «avenida», «Av.», «Avda.»,
«pasaje», «Pje.», «boulevard», «Bv.», «diagonal») o justo después de una
palabra de domicilio («domicilio en», con «real», «legal», «procesal»,
«especial» o «constituido»; «domiciliado en»; «sito en»). Toman hasta seis
palabras de nombre y terminan en la altura, con la misma forma de número de
ADR-212. La palabra clave vale en mayúsculas y en minúsculas.

- **Variante 1**: cualquier palabra puede ser parte del nombre.
- **Variante 2**: cada palabra del nombre empieza con mayúscula o con un
  dígito, salvo «de», «del», «la», «las», «los», «y» y «e». En un texto todo
  en mayúsculas todas las palabras lo cumplen, así que la regla es la misma
  para las tres escrituras.

| | Variante 1 | Variante 2 |
|---|---:|---:|
| Páginas que hoy tienen algo a la vista y quedarían tapadas, de 41 | 38 | 37 |
| Trampas tapadas en escritura normal, de 9 | 6 | **0** |
| Trampas tapadas en mayúsculas, de 18 | 12 | 12 |

- **Lo que ninguna cierra**: «ruta 205 kilómetro 54», en las tres
  escrituras. La variante 2 tampoco cierra «calle 13 entre 44 y 45» en
  escritura normal.
- **Las trampas que caen en mayúsculas** son seis oraciones, las mismas en
  las dos variantes: «CALLE ESTUVO CORTADA 3», «AVENIDA RECLAMARON 15»,
  «PASAJE COSTÓ 4500», «CALLE DESDE 1998», «DIAGONAL DEL TERRENO MIDE 120» y
  «AVENIDA CIRCULABAN 2». En un texto todo en mayúsculas nada distingue un
  verbo de un nombre de calle.
- **Las trampas con «domicilio en» no caen** con ninguna variante:
  «domicilio en 2019 ni después» y «domicilio en 30 días».
- De las 97 páginas que ya estaban tapadas, 79 tienen altura, y en las 79 el
  patrón cubre la vía, el nombre y la altura. Con la variante 2 hay una
  diferencia de borde, solo en mayúsculas: en «DOMICILIO PROCESAL EN LA CALLE
  TUCUMÁN 1650» empieza en «LA».
- «ruta» no está entre las palabras de vía de estas variantes: su forma es
  otra («ruta 205 kilómetro 54»).

## Después del cambio (M-D3, 2026-10-09)

Con el patrón de ADR-217 implementado en `regex-engine`. **Provisional**:
el producto medido tenía ese cambio sin commitear (el mantenedor decidió
commitear cuando el revisor apruebe el lote), así que la corrida lleva el
aviso `product-tree-uncommitted` y se repite sobre el commit. Dos
repeticiones válidas, idénticas página por página, sin páginas inválidas.
Carpeta: `.measure/address-keyword/20261009T055803Z/`.

**El criterio de ADR-217 se cumple en los tres números, sin ninguna página
distinta de lo esperado.**

| | Línea de base | Se esperaba | Medido |
|---|---:|---:|---:|
| Páginas con algo a la vista, de 138 | 41 | 4 | **4** |
| Trampas tapadas en escritura normal, de 9 | 0 | 0 | **0** |
| Trampas tapadas en mayúsculas, de 18 | 2 | 12 | **12** |

Las 4 que quedan a la vista son las previstas: «ruta 205 kilómetro 54» en
las tres escrituras y «calle 13 entre 44 y 45» en escritura normal.

Páginas con el nombre y la altura cubiertos enteros:

| Categoría | Normal | Mayúsculas con tildes | Mayúsculas sin tildes |
|---|---:|---:|---:|
| K1 | 9 de 9 | 9 de 9 | 9 de 9 |
| K2 | 7 de 7 | 7 de 7 | 7 de 7 |
| K3 | 7 de 7 | 7 de 7 | 7 de 7 |
| K4 | 5 de 5 | 5 de 5 | 5 de 5 |
| K5 | 4 de 6 | 5 de 6 | 5 de 6 |
| K6 | 6 de 6 | 6 de 6 | 6 de 6 |
| K7 | 6 de 6 | 6 de 6 | 6 de 6 |
| **Total** | **44 de 46** | **45 de 46** | **45 de 46** |

En la línea de base eran 38, 30 y 29 de 46.

- **Contra la línea de base, página por página**: de 165, 118 iguales. En 37
  el núcleo quedó más cubierto; en ninguna, menos. Las 10 trampas nuevas son
  cinco oraciones en las dos escrituras en mayúsculas; la sexta ya la tapaba
  el modelo.
- **Quién cierra.** De las 134 páginas cerradas, el modelo ya cerraba 97 y
  el patrón suma 37. Después del agrupado, lo que se pinta es del patrón en
  114, del modelo en 18 (las 18 sin altura, que el patrón no toma) y de los
  dos en 2.
- **Dos direcciones pintadas sobre el mismo tramo** (el límite de ADR-117):
  2 páginas, en escritura normal. «calle 50 N° 889» del patrón dentro de
  «calle 50 N° 889 de La Plata» del modelo, y «calle Alvear 1920» dentro de
  «calle Alvear 1920 4° A».
- **«CALLE 13 ENTRE 44 Y 45», en mayúsculas**, queda cerrada por una lectura
  torcida: el patrón toma «CALLE 13 ENTRE 44» y deja «Y 45». En mayúsculas
  «ENTRE» pasa por nombre de calle.
- **«Bv. Gálvez 2150»**, que el modelo marcaba como persona en dos pedazos,
  queda tapada entera por el patrón en las tres escrituras.

**M-D1 (altura de las direcciones).** Corrida nueva en
`.measure/address-height/20261009T055934Z/`, dos repeticiones que coinciden.
Totales: 54 oraciones con el número dentro de la dirección, 0 alturas a la
vista, 9 años tapados de más. Son los de «tapar siempre», la regla vigente
de ADR-212. La comparación oración por oración no es limpia: la única
corrida anterior es de cuando la regla iba por contexto. De 76 oraciones, 53
son idénticas, 11 difieren por ese cambio de regla y 12 traen además la
ocurrencia del patrón sobre el mismo tramo que la del modelo.

**Calidad (ADR-147).** 26 documentos, sin regresiones: 78 entidades
cubiertas de 78, y los mismos 18 falsos positivos. Cuatro direcciones pasan
a ser del patrón en vez del modelo, con el mismo valor.

**Peores casos.** `keyword address search stays linear on adversarial text`:
seis textos adversos de 2 a 160 KiB, 144 corridas. El tiempo crece lineal en
los seis (el mayor salto al duplicar el largo es de 1,57 veces). El patrón
pesa unos 2 ms a 160 KiB.

## Cómo se repite

`./tests/perf/run-address-keyword.sh`. Detalle en `tests/perf/README.md`,
«Direcciones con palabra clave». La tabla página por página queda en la
carpeta de la corrida. Para comparar contra una corrida anterior:
`ANONLY_ADDRESS_KEYWORD_BASELINE_DIR=<carpeta>`. Se vuelve a correr sobre el
commit del patrón, y si cambia el modelo.
