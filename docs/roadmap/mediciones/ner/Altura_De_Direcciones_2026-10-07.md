<!-- CONTEXT: scope=roadmap-medicion | dependencias=adr/ADR-212-La-Direccion-Incluye-La-Altura-Que-La-Sigue.md,core/NER_Engine.md,roadmap/hardening/Confianza_1.0.x_Plan.md,adr/ADR-147-Perder-Un-Identificador-Cubierto-Es-Una-Regresion.md,roadmap/Roadmap_1.x.md,tests/perf/README.md | audiencia=humanos+IA | fase=12 (M-D1, Windows 2026-10-07) -->

# La altura de las direcciones — regla por contexto contra «tapar siempre» (M-D1)

## Resultado

ADR-212 extiende una dirección hasta el número que la sigue. Si el número
parece un año, lo suma solo cuando hay una palabra de dirección cerca. La
alternativa en reserva es sumarlo siempre. Sobre 76 oraciones sintéticas,
con el modelo real:

| | Regla por contexto | Tapar siempre |
|---|---:|---:|
| Alturas que quedan a la vista, de 39 con la calle marcada | **6** | **0** |
| Años tapados de más, de 9 con el lugar marcado | **4** | **9** |
| Otros números tapados de más, de 8 | 6 | 6 |

- **La regla hace lo que ADR-212 dice**, en las 76 oraciones.
- **Las 6 alturas a la vista** son todas alturas con forma de año en una
  oración sin palabra de dirección. Es el costo que ADR-212 había aceptado a
  prueba. Tapar siempre las cierra, a cambio de 5 años más tapados de más.
- **El límite más grande no es de la regla.** En 9 de las 48 oraciones con
  un domicilio el modelo no marcó la calle. Ahí quedan a la vista la calle y
  la altura, con cualquiera de las dos variantes.
- **Línea de base de calidad**: las cuatro direcciones pasan a cubiertas, 78
  de 78 entidades contra 74 de 78, sin ningún otro cambio.

Con esto el mantenedor decide si la regla queda o si se tapa siempre.

## Qué se midió

- **Corpus**: 76 oraciones sintéticas escritas para esto, en ocho
  categorías. Un PDF digital con una oración por página, entre dos renglones
  de relleno fijos que no llevan ninguna palabra de la lista de ADR-212.
- **Cómo**: por la aplicación de escritorio, con el modelo real y la
  configuración por defecto. Dos corridas completas, cada una con una
  instancia fría.
- **Qué se registra por oración**: si el modelo marcó el lugar como
  dirección, los valores de las direcciones detectadas, y si el número quedó
  dentro de la dirección.
- **«Tapar siempre» se deriva de los mismos datos**: son las oraciones donde
  la dirección termina justo antes de un número con forma de año y la regla
  no lo sumó.
- **Entorno**: Windows 11 nativo, 12 hilos, 16 GB de RAM. Producto de la
  branch `hardening/confianza-1.0.x` del 2026-10-07, con ADR-212
  implementado.

**Validez.** Las dos corridas son válidas y coinciden oración por oración.
El texto que extrajo la aplicación es igual al escrito en las 76 páginas,
con sus tildes y con «°» y «º».

**Lo que esta medición no dice.** Cada categoría tiene unas diez oraciones:
mide qué pasa en cada situación, no con qué frecuencia aparece esa situación
en un documento real. Las oraciones de la categoría D se escribieron para
que la regla fallara.

## Por categoría

| | Categoría | Oraciones | Lugar marcado | Regla: dentro / a la vista | Tapar siempre: dentro / a la vista |
|---|---|---:|---:|---:|---:|
| A | Altura que no parece año | 10 | 8 | 8 / 0 | 8 / 0 |
| B | Altura con forma de año, palabra de dirección antes | 10 | 10 | 10 / 0 | 10 / 0 |
| C | Altura con forma de año, palabra de dirección después | 9 | 5 | 5 / 0 | 5 / 0 |
| D | Altura con forma de año, sin palabra de dirección | 9 | 6 | 0 / 6 | 6 / 0 |
| E | Lugar y año, sin palabra de dirección | 10 | 5 | 0 / 5 | 5 / 0 |
| F | Lugar y año, con una palabra de la lista por otro motivo | 10 | 4 | 4 / 0 | 4 / 0 |
| G | Variantes: «N°», «Nº», «nro.», «número», «al», cinco dígitos | 10 | 10 | 10 / 0 | 10 / 0 |
| H | Lugar y un número que no es altura ni año | 8 | 8 | 6 / 2 | 6 / 2 |
| | **Total** | **76** | **56** | **43 / 13** | **54 / 2** |

«Dentro» es bueno en A, B, C, D y G, donde el número es una altura. En E, F
y H es tapar de más.

## Lo que se ve en los datos

### Las alturas

- De 48 oraciones con un domicilio (A, B, C, D y G), la altura queda tapada
  en 33 con la regla y en 39 con tapar siempre.
- Las 9 restantes son las que el modelo no marcó: A6, A9, C2, C3, C6, C9,
  D1, D2 y D6. En dos de ellas (A6 y D1) marcó la calle como persona
  («Moreno», «Belgrano») y la altura quedó a la vista igual.
- Con palabra de dirección antes (B) el modelo marcó la calle en las 10. Con
  la palabra después y ninguna antes (C), en 5 de 9.
- Las variantes de escritura (G) salieron todas, con el conector dentro del
  valor: «Maipú N° 1434», «Rivadavia al 4500», «Urquiza N°98».

### Los años

- Sin palabra de dirección (E), la regla no tocó ningún año. Tapar siempre
  taparía los 5 en que el modelo marcó el lugar: «Rosario 2019», «Mendoza
  2005», «Salta 2012», «Buenos Aires 2020» y «Plata 1998».
- Con una palabra de la lista cerca por otro motivo (F), la regla tapó el
  año en las 4 en que el modelo marcó el lugar. Una es «En La Plata 1998
  pisó por primera vez un escenario»: «pisó», sin tilde, es «piso».
- En 11 de las 20 oraciones de lugar y año el modelo no marcó el lugar, así
  que la muestra de años es chica: 9.

### Otros números

- Un lugar seguido de un número cualquiera se tapa de más con las dos
  variantes: «Mendoza 3» en «Viajó a Mendoza 3 veces», «La Plata 3500» en
  «Pagó en La Plata 3500 pesos». Fueron 6 de 8.
- Los 2 que no se tocaron son los que la forma del número excluye: una fecha
  («Salta 12/03/2021», que además sale como fecha) y un importe con punto
  («Tucumán 1.250 hectáreas»).

### Del modelo

- En «Obtuvo el título en La Plata 1998» marcó solo «Plata». En «En La Plata
  1998 pisó…» marcó «La Plata».
- El instrumento no distingue si un número lo sumó la regla o lo incluyó el
  propio modelo, que a veces lo hace cuando la calle lleva «Av.».

## Línea de base de calidad

Con el procedimiento de ADR-147: medición con el modelo real, candidato y
comparación contra `tests/quality/baselines/reference-v1.json`.

| | Referencia | Candidato |
|---|---:|---:|
| Entidades cubiertas | 74 de 78 | **78 de 78** |
| Direcciones cubiertas | 0 de 4 | **4 de 4** |
| Los otros once tipos | 74 de 74 | 74 de 74 |

- Las cuatro direcciones salen con el valor entero: «Maipú 1434», «Belgrano
  5983», «Pueyrredón 9741» y «Pueyrredón 2584».
- Ninguna otra entidad cambia de estado. Los falsos positivos por documento
  son los mismos.
- El comparador no encuentra regresiones. Coinciden el corpus, el entorno de
  ejecución y el modelo. Difiere el perfil de rendimiento anotado (`auto` en
  la referencia, `medium` en el candidato), que es informativo.
- **El candidato no se promovió.** Promoverlo es un cambio aparte, revisado
  (ADR-147 §5), y conviene hacerlo con la regla ya decidida.

## Oración por oración

Todos los datos son sintéticos. «—» es que no hubo ninguna dirección
detectada en la página.

| Id | Oración | Dirección detectada | El número |
|---|---|---|---|
| A1 | El demandado tiene domicilio en Maipú 1434 y fue notificado por cédula. | Maipú 1434 | dentro |
| A2 | La actora vive en Sarmiento 742 desde hace diez años. | Sarmiento 742 | dentro |
| A3 | El local comercial está sito en Lavalle 385, frente a la plaza. | Lavalle 385 | dentro |
| A4 | Se constituyó domicilio procesal en la calle Tucumán 1650. | calle Tucumán 1650 | dentro |
| A5 | El testigo dijo que el hecho ocurrió frente a Viamonte 867. | Viamonte 867 | dentro |
| A6 | La notificación fue devuelta desde Moreno 2310 sin firma. | — («Moreno» como persona) | a la vista |
| A7 | El perito inspeccionó el inmueble de Alsina 455 el día martes. | Alsina 455 | dentro |
| A8 | Los vecinos de Balcarce 3120 presentaron una nota. | Balcarce 3120 | dentro |
| A9 | El oficial se presentó en Urquiza 98 a primera hora. | — | a la vista |
| A10 | La mercadería se entregó en Callao 1105 según el remito. | Callao 1105 | dentro |
| B1 | El demandado tiene domicilio en Belgrano 1950 y no contestó la demanda. | Belgrano 1950 | dentro |
| B2 | La actora vive en Rivadavia 2015 junto a sus dos hijos. | Rivadavia 2015 | dentro |
| B3 | El inmueble sito en Mitre 1985 fue embargado. | Mitre 1985 | dentro |
| B4 | Constituyó domicilio en la calle Córdoba 2040 a todos los efectos. | calle Córdoba 2040 | dentro |
| B5 | El testigo reside en Alvear 1920 hace varios años. | Alvear 1920 | dentro |
| B6 | La sociedad, domiciliada en Santa Fe 2001, fue intimada. | Santa Fe 2001 | dentro |
| B7 | El consultorio se encuentra en avenida Pueyrredón 1999. | avenida Pueyrredón 1999 | dentro |
| B8 | El imputado, domiciliado en Entre Ríos 2023, quedó detenido. | Entre Ríos 2023 | dentro |
| B9 | La oficina funciona en Av. Corrientes 1980 de lunes a viernes. | Av. Corrientes 1980 | dentro |
| B10 | Los cónyuges viven en San Martín 2010 con sus padres. | San Martín 2010 | dentro |
| C1 | La carta documento llegó a Belgrano 1950, piso 3, sin novedad. | Belgrano 1950 | dentro |
| C2 | El oficio se diligenció en Rivadavia 2015, departamento B. | — | a la vista |
| C3 | El escrito se presentó desde Mitre 1985 piso 2 por correo. | — | a la vista |
| C4 | La entrega se hizo en Córdoba 2040, depto. 4, por la tarde. | Córdoba 2040 | dentro |
| C5 | El paquete fue recibido en Alvear 1920, dpto. C, por un vecino. | Alvear 1920 | dentro |
| C6 | El contrato se firmó en Sarmiento 2001 de esta ciudad. | — | a la vista |
| C7 | La audiencia se celebró en Lavalle 1999 de la localidad de Morón. | Lavalle 1999; Morón | dentro |
| C8 | El remito indica Tucumán 2023, piso 1, como destino. | Tucumán 2023 | dentro |
| C9 | Los bienes se retiraron de Moreno 1975, departamento 6. | — | a la vista |
| D1 | La carta documento fue enviada a Belgrano 1950 y volvió sin firmar. | — («Belgrano» como persona) | a la vista |
| D2 | El testigo dijo que el choque ocurrió frente a Rivadavia 2015. | — | a la vista |
| D3 | El perito inspeccionó el inmueble de Mitre 1985 el día martes. | Mitre | **a la vista**; tapar siempre lo cubre |
| D4 | La notificación se dejó en Córdoba 2040 bajo la puerta. | Córdoba | **a la vista**; tapar siempre lo cubre |
| D5 | Los vecinos de Alvear 1920 presentaron una nota. | Alvear | **a la vista**; tapar siempre lo cubre |
| D6 | El oficial se presentó en Sarmiento 2001 a primera hora. | — | a la vista |
| D7 | La mercadería se entregó en Lavalle 1999 según el remito. | Lavalle | **a la vista**; tapar siempre lo cubre |
| D8 | El local de Tucumán 2023 permanece cerrado. | Tucumán | **a la vista**; tapar siempre lo cubre |
| D9 | El móvil policial llegó a Moreno 1975 a la medianoche. | Moreno | **a la vista**; tapar siempre lo cubre |
| E1 | El congreso se realizó en Rosario 2019 con gran asistencia. | Rosario | sin tocar; tapar siempre lo cubre |
| E2 | Se conocieron durante el torneo de Mendoza 2005. | Mendoza | sin tocar; tapar siempre lo cubre |
| E3 | La feria Córdoba 2018 reunió a cien expositores. | — | sin tocar |
| E4 | Participó de las jornadas de Salta 2012 como disertante. | Salta | sin tocar; tapar siempre lo cubre |
| E5 | El acuerdo se firmó en Buenos Aires 2020 tras meses de negociación. | Buenos Aires | sin tocar; tapar siempre lo cubre |
| E6 | Obtuvo el título en La Plata 1998 y luego se mudó. | Plata | sin tocar; tapar siempre lo cubre |
| E7 | El encuentro de Tucumán 2016 terminó sin acuerdo. | — | sin tocar |
| E8 | Viajaron a los juegos de Mar del Plata 1995 en tren. | — | sin tocar |
| E9 | La muestra Bariloche 2022 fue declarada de interés. | — | sin tocar |
| E10 | El informe compara los datos de Neuquén 2010 con los actuales. | — | sin tocar |
| F1 | Fijó domicilio tras el congreso de Rosario 2019. | Rosario 2019 | tapado de más |
| F2 | Vive allí desde el torneo de Mendoza 2005. | Mendoza 2005 | tapado de más |
| F3 | Reside en el país desde Córdoba 2018, cuando llegó a la feria. | — | sin tocar |
| F4 | La calle estuvo cortada durante Salta 2012. | — | sin tocar |
| F5 | Cambió de domicilio después de Tucumán 2016. | — | sin tocar |
| F6 | En La Plata 1998 pisó por primera vez un escenario. | La Plata 1998 | tapado de más |
| F7 | La avenida fue inaugurada para Bariloche 2022. | Bariloche 2022 | tapado de más |
| F8 | El torneo Neuquén 2010 de esta ciudad convocó a mil personas. | — | sin tocar |
| F9 | Viven juntos desde los juegos de Mar del Plata 1995. | — | sin tocar |
| F10 | Tras Rosario 2019, el departamento de cultura cerró. | — | sin tocar |
| G1 | Tiene domicilio en Maipú N° 1434 de esta ciudad. | Maipú N° 1434 | dentro |
| G2 | La actora vive en Sarmiento Nº 742. | Sarmiento Nº 742 | dentro |
| G3 | El local está sito en Lavalle nro. 385. | Lavalle nro. 385 | dentro |
| G4 | El inmueble de Viamonte número 867 fue tasado. | Viamonte número 867 | dentro |
| G5 | El hecho ocurrió en Rivadavia al 4500, cerca de la estación. | Rivadavia al 4500 | dentro |
| G6 | La planta funciona en Moreno 12450, en las afueras. | Moreno 12450 | dentro |
| G7 | El depósito queda en Balcarce No. 3120. | Balcarce No. 3120 | dentro |
| G8 | Se notificó en Alsina Nro 455 sin inconvenientes. | Alsina Nro 455 | dentro |
| G9 | La finca se ubica en Urquiza N°98 según el plano. | Urquiza N°98 | dentro |
| G10 | El galpón está en Callao al 11050. | Callao al 11050 | dentro |
| H1 | Viajó a Mendoza 3 veces durante el año. | Mendoza 3 | tapado de más |
| H2 | Permaneció en Rosario 15 días por trabajo. | Rosario 15 | tapado de más |
| H3 | La sucursal de Bariloche 2 cerró sus puertas. | Bariloche 2 | tapado de más |
| H4 | Se reunieron en Salta 12/03/2021 por la mañana. | Salta | sin tocar (sale como fecha) |
| H5 | El campo de Tucumán 1.250 hectáreas fue vendido. | Tucumán | sin tocar |
| H6 | Recorrió Neuquén 40 kilómetros a pie. | Neuquén 40 | tapado de más |
| H7 | Pagó en La Plata 3500 pesos de multa. | La Plata 3500 | tapado de más |
| H8 | Llegó a Córdoba 20 minutos después. | Córdoba 20 | tapado de más |

## Cómo se repite

`./tests/perf/run-address-height.sh`. Detalle en `tests/perf/README.md`,
«Altura de las direcciones». Se vuelve a correr si cambian la regla o el
modelo.
