<!-- CONTEXT: scope=medicion-ocr-rc | dependencias=adr/ADR-218-El-Costo-De-RC-Se-Mide-Sin-Forzar-Todas-Las-Paginas.md,roadmap/ocr/Costo_RC_Aislado_Protocolo_2026-10-10.md,roadmap/mediciones/ocr/Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md | audiencia=humanos+IA | fase=12 -->

# RC — costo aislado de recuperar páginas vacías con tinta

La confirmación sobre el producto incorporado terminó también 12/12 válida;
se registra al final, separada de la campaña experimental. En esa nueva
campaña R1 agregó 1,185/0,952 s y P2N 19,452/18,713 s hasta Ready
(frío/caliente). Sigue siendo provisional por el árbol sin commitear.

**Decisión humana posterior:** cerrar esta actualización con RC y diferir
SV/CP hasta disponer de más documentos/escaneos; el riesgo residual se
acepta como conocido y queda como único pendiente diferido del lote.
Ver [evidencia y retoma](../../ocr/Orientacion_SV_CP_Retoma_2026-10-10.md).

**Campaña experimental provisional, 2026-10-10: 12/12 corridas válidas.** En el escaneo
real R1 de 20 páginas, una página recibió tres lecturas adicionales. La
mediana del tiempo total aumentó 0,394 s en frío y 1,022 s en caliente
(0,8% y 2,2%). En P2N, con diez hojas sintéticas de ruido, aumentó 19,884 s
y 19,112 s (70,4% y 69,6%). El costo depende de cuántas páginas activa la
regla; estas observaciones no estiman su frecuencia en documentos reales.

El candidato recuperó previamente los cuatro fallos naturales N1 en el
smoke. En esta campaña de costo no cambiaron los hashes de texto, las
cantidades de palabras y entidades por tipo ni los avisos. Después de estos resultados, el mantenedor aceptó RC el
2026-10-10 y dejó SV/CP pendiente. Esta campaña midió el candidato en build,
sin modificar fuentes OCR; la implementación adoptada debe confirmar el
costo en una campaña nueva antes de cerrar el punto.

## Instrumento e identidad

Se aplicó el [protocolo RC aislado](../../ocr/Costo_RC_Aislado_Protocolo_2026-10-10.md)
y [ADR-218](../../../adr/ADR-218-El-Costo-De-RC-Se-Mide-Sin-Forzar-Todas-Las-Paginas.md):
dos builds A/RC congelados, observador idéntico, orientación y tinta
naturales, `medium`, NER activo, tres repeticiones intercaladas por documento
y brazo. Cada corrida incluyó importación fría y caliente. M2 es la suma de
RSS de procesos Electron, con muestreo cada 150 ms. MB es decimal.

RC agrega `reading.words.length === 0 && inkRatio > 0` únicamente al
predicado de recuperación de páginas enteras sin veredicto OSD. La
ampliación efectiva es `0 < inkRatio < 0,002`: con tinta de 0,002 o más el
control ya prueba los otros ángulos. Se reutiliza el comparador vigente,
el mismo ráster/DPI y los giros 90/180/270, sin upscale. No se activa SV ni
se cambia CP fuera de esa rama, la tinta ni el criterio de aviso.

- Carpeta local ignorada: `.measure/rc-isolated/campaign-20261010-rc`.
- Tanda: `tanda-20261010T160645Z-809`, sello `finished`, detección de
  suspensión confirmada al inicio y cierre, sin evento de reanudación.
- Resumen: `complete=true`, esperadas/observadas/exitosas 12/12/12;
  faltantes, inválidas, incidencias y fallas de producto/instrumento: cero.
- Identidad del árbol confirmada al inicio y cierre. El control A fue
  idéntico byte por byte; RC tuvo una coincidencia exacta del transformador.
  Se verificaron los builds congelados y ambos dist originales restaurados.
- Base Git: `aceb72ef9e03f24541daad9768bf08033245672b`, con cambios de
  producto sin commitear expresamente permitidos y capturados. Por ello,
  y por tratarse de un candidato experimental, el resultado es provisional.
  La regla que se adopte debe volver a medirse sobre la implementación real
  y después sobre el commit, antes de dar el costo por definitivo.
- Windows x64, Intel i5-12400, 12 CPU lógicas, RAM 16.935.129.088 bytes,
  Node 22.23.2. Sin otra campaña o suite pesada simultánea.

Los insumos coinciden byte por byte con M-O3:

| Insumo | SHA-256 |
| --- | --- |
| R1, escaneo real nativo de 20 páginas | `b0fa61494c55fcfb16027d036d7b40fc36bbcc2a4924105e4236f14b29d9cc99` |
| P2N, P2 más diez hojas de ruido, 60 páginas | `93920b91b0185778cf4e97883709361f34a4eb9b45e8510fad5cfdc87bfeedfd` |

P2N es diagnóstico, no el perfil normativo P2. No se le aplica el techo de
3.000 MB ni se usa este ensayo para acreditar el presupuesto P2.

## Tiempos observados

Segundos, mediana (mínimo–máximo), tres corridas por fila. Ready comprende
la importación completa; OCR es la fase observada, no la suma de duración
de cada despacho. Las restas comparan medianas, no una predicción precisa
para otro documento o equipo.

| Documento | Brazo | Temperatura | Hasta Ready | OCR |
| --- | --- | --- | ---: | ---: |
| R1 | A | fría | 46,741 (44,507–46,807) | 34,810 (33,411–34,880) |
| R1 | RC | fría | 47,135 (46,197–47,889) | 35,622 (35,172–36,034) |
| R1 | A | caliente | 45,475 (43,839–46,325) | 34,131 (32,933–34,828) |
| R1 | RC | caliente | 46,497 (44,612–46,538) | 35,071 (34,636–35,367) |
| P2N | A | fría | 28,233 (28,034–28,964) | 22,766 (22,630–23,495) |
| P2N | RC | fría | 48,117 (46,780–48,362) | 42,400 (41,533–42,717) |
| P2N | A | caliente | 27,445 (27,156–27,888) | 22,830 (22,507–22,971) |
| P2N | RC | caliente | 46,557 (45,191–46,941) | 41,776 (40,451–42,164) |

El aumento mediano de OCR de R1 es 0,812/0,940 s, 2,3%/2,8% en frío/caliente.
El de P2N es 19,634/18,946 s, 86,2%/83,0%. En R1 los rangos de Ready se
superponen; en P2N quedan separados. El aumento de ruido sí es apreciable,
pero está lejos del factor 3,4–4,4 de M-O3, que forzó todos los ángulos
también en páginas con texto. Aquella campaña no aislaba RC.

## Memoria y asentamiento

MB decimales, mediana (mínimo–máximo). El pico posterior a Ready tiene su
propia ventana y no sustituye al pico M2 de la importación.

| Documento | Brazo | Temperatura | M2 | Pico posterior a Ready |
| --- | --- | --- | ---: | ---: |
| R1 | A | fría | 2094,2 (2052,4–2229,3) | 1816,2 (1778,2–1911,8) |
| R1 | RC | fría | 2113,9 (2016,3–2175,1) | 1785,0 (1776,6–1788,4) |
| R1 | A | caliente | 2327,8 (2309,1–2494,5) | 1832,4 (1727,6–1889,5) |
| R1 | RC | caliente | 2281,2 (2249,4–2328,7) | 1773,7 (1763,7–1793,0) |
| P2N | A | fría | 2408,8 (2342,6–2416,4) | 2171,6 (2128,0–2231,8) |
| P2N | RC | fría | 2864,7 (2846,3–2918,5) | 2178,6 (2161,4–2206,5) |
| P2N | A | caliente | 3106,5 (3097,0–3362,3) | 2280,1 (2259,8–2313,9) |
| P2N | RC | caliente | 3511,3 (3472,0–3580,6) | 2334,6 (2304,4–2357,7) |

R1 cambia +19,7 MB en frío y −46,6 MB en caliente: rangos superpuestos y
diferencias inferiores al ruido de referencia de 345 MB. No hay evidencia
de un aumento de memoria distinguible en ese documento, ni de una mejora.
P2N cambia +455,9/+404,8 MB, por encima de esa referencia y con rangos
separados en ambas temperaturas. Es un aumento observado que merece
considerarse al aceptar el costo; no se atribuye con precisión causal
perfecta sin presión del sistema disponible ni más repeticiones.

Los doce asentamientos calientes dieron `hotBaselineSettled=true`. Todos
los crudos conservan las series RSS (184–320 muestras por importación),
heap, fases y posición del pico. **La presión de memoria del sistema no
estuvo disponible**: los campos por importación informan
`SystemMemoryPressureUnavailable`. Eso no significa presión cero ni
constante y limita la atribución del aumento. No se reemplazan estos campos
con la presión de otra campaña ni con los extremos de una tanda.

## Alcance efectivo y entregas

| Documento | Páginas ampliadas por importación | Observaciones ampliadas, tres repeticiones × frío/caliente | Despachos adicionales | Mediana de duración por despacho adicional |
| --- | ---: | ---: | ---: | ---: |
| R1 | 1 de 20 | 6 | 18 | 613 ms |
| P2N | 10 de 60 | 60 | 180 | 1467 ms |

No hubo despachos nuevos fuera de las páginas ampliadas. No hubo cambios
por página de hash de texto, cantidad de palabras, conteos de entidades por tipo o avisos, ni
incoherencias de las parejas A/RC. Orientación y tinta naturales coincidieron
con las entregadas al producto. En R1 la página casi vacía sigue sin lectura
fiable: este corpus de costo no añade un caso de recuperación. El beneficio
se acredita por los cuatro N1 del smoke y por la caracterización M-O2,
separadamente del costo.

El indicador de entidades compara conteos por tipo; no conserva ni compara
valores o cajas de cada entidad. Este ensayo de importación tampoco lee
un PDF exportado. La cobertura del DNI N1 en el export corresponde al E2E
separado, no se deduce de esos conteos.

## Respuesta a la pregunta del mantenedor y siguiente decisión

Una página casi vacía puede agregar trabajo aunque sea solo ruido: este
escaneo lo mostró una vez en 20 páginas. Diez hojas de ruido agregaron
unos veinte segundos y alrededor de 0,4–0,5 GB al pico mediano. Una hoja
completamente blanca, con tinta cero, queda fuera de RC.

No se conoce la probabilidad de que un expediente real active este trabajo.
Hay un único escaneo real de buena calidad y digitales rasterizados limpios;
no representan documentos degradados. El 1/20 describe ese documento,
no una tasa general. Para medir frecuencia hacen falta más escaneos reales,
con calidad diversa, bajo las mismas reglas de privacidad.

**Recomendación del planificador, aceptada el 2026-10-10:** adoptar RC
para cerrar los cuatro fallos naturales del renglón girado, aceptando el
costo medido y su limitación ante muchas hojas de ruido; mantener SV/CP
como decisión separada. La frecuencia de activación y el costo habitual de
SV no se deducen de esta campaña. CP solo ya fue refutado por M-O2.
ADR-190 y el spec OCR se enmendaron antes del código. RC ya está implementado,
con E2E N1, regresiones, calidad normativa y costo adoptado verificados;
falta completar la caracterización M-O1. No se declara cerrado el
riesgo de los veredictos equivocados ni la revisión del lote.

## Confirmación sobre RC incorporado (2026-10-10)

**12/12 corridas válidas, provisional.** Carpeta nueva
`.measure/rc-isolated/campaign-20261010-adopted-v1`, modo explícito
`adopted`. No se combinan sus medianas con las anteriores. Mantiene los
insumos, equipo, configuración, instrumento y orden A/RC del protocolo.
El smoke previo adoptado fue válido 8/8 en
`.measure/rc-isolated/smoke-20261010-adopted-v1`.

- Sello `tanda-20261010T173950Z-1069`: `finished`, detección de suspensión
  confirmada al inicio/cierre, sin evento de reanudación. Sin corridas
  faltantes, inválidas, fallas de producto/instrumento ni incidencias.
- Identidad confirmada en ambos extremos, modo `adopted` persistido y
  los dos dist anteriores restaurados/verificados. Árbol de producto
  `6e91c9f66cfc341af8aa5137756b02c009dddfeb768371565342dc6cf018aa44`.
  La salvedad de producto sin commitear permanece; repetir sobre el commit.
- Fuente OCR RC idéntica byte por byte:
  `fce7cd304847b0dc964f95ab99be58e60487a538e4b14799e920871d116174f7`.
  La transformación A quitó exclusivamente la cláusula RC, con una coincidencia.
- Renderer normal = RC:
  `bb2c7281e486e67596662eecabe9528bb5505d20175f4878bd2396eaeef4a88e`;
  A: `1b54da7cd5a6129fc1855172cbe067d377f89358ad09068b51e5749e0cb64649`;
  shell: `37019a291b47c65bd9546903837e47ca360dee541573970924f6d4c3672eae54`.
- Los hashes R1 y P2N coinciden con los insumos experimentales y M-O3
  indicados arriba. No hubo datos o derivados reales en los informes.

Segundos, mediana (mínimo–máximo), tres corridas por fila:

| Documento | Brazo | Temperatura | Hasta Ready | OCR |
| --- | --- | --- | ---: | ---: |
| R1 | A | fría | 44,663 (44,305–46,044) | 33,361 (33,102–34,593) |
| R1 | RC | fría | 45,848 (44,388–46,012) | 34,611 (34,444–34,909) |
| R1 | A | caliente | 44,184 (44,068–44,841) | 33,162 (33,026–33,717) |
| R1 | RC | caliente | 45,136 (42,215–45,859) | 34,263 (32,850–34,770) |
| P2N | A | fría | 27,944 (27,835–27,947) | 22,472 (22,458–22,496) |
| P2N | RC | fría | 47,396 (46,185–52,509) | 41,896 (40,752–46,482) |
| P2N | A | caliente | 26,703 (26,436–26,805) | 22,151 (21,839–22,222) |
| P2N | RC | caliente | 45,416 (44,719–45,874) | 40,752 (40,388–41,195) |

Ready aumentó en R1 1,185/0,952 s (2,7%/2,2%) y en P2N
19,452/18,713 s (69,6%/70,1%). OCR aumentó 1,250/1,101 s y
19,424/18,601 s, respectivamente. Los rangos Ready de R1 se superponen;
los de P2N quedan separados. Las restas comparan medianas y no predicen
otro documento/equipo.

MB decimales, mediana (mínimo–máximo). El máximo está al final del rango:

| Documento | Brazo | Temperatura | M2 | Pico posterior a Ready |
| --- | --- | --- | ---: | ---: |
| R1 | A | fría | 2158,3 (2076,5–2215,7) | 1796,8 (1750,6–1798,6) |
| R1 | RC | fría | 2124,3 (2047,9–2174,0) | 1814,2 (1779,8–1815,9) |
| R1 | A | caliente | 2306,3 (2294,2–2311,1) | 1776,6 (1754,4–1778,4) |
| R1 | RC | caliente | 2295,2 (2248,2–2343,5) | 1786,1 (1779,2–1818,1) |
| P2N | A | fría | 2375,2 (2354,2–2638,4) | 2301,3 (2277,7–2405,1) |
| P2N | RC | fría | 2846,0 (2829,6–2879,5) | 2241,4 (2209,1–2264,5) |
| P2N | A | caliente | 3107,0 (3098,8–3398,7) | 2395,0 (2251,2–2549,9) |
| P2N | RC | caliente | 3458,5 (3344,9–3536,9) | 2245,8 (2240,2–2385,0) |

En R1, M2 difiere −34,0/−11,2 MB, con rangos superpuestos y dentro del
ruido de 345 MB: no acredita reducción de consumo. En P2N frío, +470,8 MB
supera ese ruido y los rangos quedan separados. En caliente, +351,5 MB
apenas supera la referencia y los rangos se superponen: no se afirma un
aumento caliente distinguible. P2N sigue siendo diagnóstico, sin techo
normativo; estas filas no acreditan el presupuesto P2.

Los tres asentamientos calientes de cada celda fueron positivos. Se
preservaron series RSS (180–347 muestras por importación), fases y heaps.
**Presión por importación no disponible** en las 24 ventanas, antes y
después: `SystemMemoryPressureUnavailable`. Los extremos de presión de
la tanda están disponibles y preservados, pero no sustituyen esas ventanas
ni acreditan estabilidad durante cada importación. Esto limita atribuir
causalmente las diferencias M2 a RC.

La expansión efectiva fue 1/20 páginas en R1 y 10/60 en P2N por importación:
18 y 180 despachos adicionales en seis importaciones por documento. La
mediana de duración por despacho adicional fue 591,5 y 1440 ms, respectivamente.
No hubo despachos nuevos fuera de las páginas elegibles ni cambios de
hashes de texto, cantidad de palabras, conteos de entidades por tipo o avisos.
La limitación de valores/cajas y la separación del export indicadas arriba
se mantienen. R1 conserva su página sin lectura fiable; los cuatro N1
recuperados se acreditan separadamente en el smoke y E2E real.

La confirmación conserva la conclusión práctica del experimento: alrededor
de un segundo extra en este escaneo y unos diecinueve segundos con diez
hojas de ruido. No aporta una frecuencia poblacional ni cierra SV/CP.
M-O1 terminó después 700/700 sin cambios inesperados en la proyección
registrada; la revisión del lote sigue pendiente.
