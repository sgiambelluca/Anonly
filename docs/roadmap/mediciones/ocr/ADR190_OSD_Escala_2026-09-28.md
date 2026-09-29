<!-- CONTEXT: scope=sondeo-escala-osd | dependencias=../../ADR190_OSD_Escala_Sondeo.md,ADR190_DPI_2026-09-27.md,../../../adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md | audiencia=humanos+IA | fase=11 -->

# ADR-190 — Tamaño de la copia enviada al OSD

**Estado:** matriz ejecutada en Windows y resultados auditados independientemente.
El cap nativo de OCR de ADR-163 permanece según la decisión humana. Este
ensayo varía únicamente la copia que recibe el detector de orientación.

## Diseño y control de validez

Se reutilizaron los 64 PDFs sintéticos de QUALITY de la campaña DPI:
4 DPI de origen (150, 200, 250 y 300) × 4 densidades (página completa,
encabezado, dos renglones y firma) × 4 giros. Sobre el mismo ráster que la
aplicación entrega a `ocr-orient`, se compararon tres copias:

| Brazo | Tamaño de la copia OSD |
|---|---|
| Mitad histórica | 50 % del ancho y alto de entrada |
| Actual | Lado largo de 1754 px, factor limitado a 2 |
| Nativo | Tamaño íntegro de entrada |

Cada copia se detectó tres veces, con orden intercalado. Hubo además
12 controles independientes: blanco, ruido determinista y línea con elipse,
a los cuatro DPI. El ensayo utilizó el bundle de Tesseract, OEM y assets
de la aplicación. Midió `detect` aparte de la inicialización del worker y
la preparación de imagen; por lo tanto estos tiempos **no son tiempo total
de OCR ni de documento**. La tinta se calculó sobre los mismos píxeles que
vio cada brazo OSD, con el predicado de ADR-162. Un ángulo o confianza nulos
no cuentan como acierto de 0°.

**Sesión:** `.measure/adr190-osd-scale/2026-09-28T04-34-57-137Z-campaign-26388/`.
El build conservó el SHA-256
`548d5c0b12cf9cc598be7f0273288052326d3b91903f5722825a0104a454bd17`
de QUALITY. Coincidieron los 64 hashes de PDF, los DPI efectivos
151/201/251/300, las dimensiones de entrada y la reproducción del brazo
actual contra los 48 veredictos y 16 ausencias de QUALITY. Se completaron
**76/76 fixtures, 576/576 detecciones con texto y 108/108 controles**,
sin fallas instrumentales, discrepancias de baseline, repeticiones faltantes
o duplicadas. Los estados de orientación fueron iguales en las tres
repeticiones de cada fixture y brazo.

## Calidad del OSD y tinta

Los conteos siguientes usan **64 PDFs únicos**, no triplican el denominador
por las tres repeticiones. Un acierto requiere confianza OSD ≥ 1 y ángulo
de corrección correcto.

| Brazo | Correctos | Ángulo incorrecto | Confianza < 1 | Sin veredicto |
|---|---:|---:|---:|---:|
| Mitad histórica | 26 | 6 | 4 | 28 |
| Actual, 1754 px | 48 | 0 | 0 | 16 |
| Nativo | 48 | 0 | 0 | 16 |

El brazo actual y el nativo devolvieron el **mismo ángulo crudo o ausencia
en los 64 PDFs**. La confianza numérica sí varió en los 48 veredictos,
pero no cruzó el piso de 1. Sus 16 ausencias son todos los casos de dos
renglones: cuatro DPI × cuatro giros. En los tres brazos y en todas sus
repeticiones, Tesseract no emitió ángulo para esos casos. Esto incluye los
cuatro casos de dos renglones a 180° que en la campaña DPI devolvieron
basura confiable sin DNI con ambos DPI de OCR. Cambiar solo el tamaño OSD
no corrige esa falla de la cadena.

La mitad histórica dio seis ángulos erróneos en páginas completas a 150/200
DPI, cuatro veredictos de confianza insuficiente en encabezado/firma a
200 DPI y 12 ausencias adicionales en encabezado/firma a 150/200 DPI. A
250 y 300 DPI sus estados coincidieron con el brazo actual; a 300 ambos
brazos producen exactamente 1240×1754 px para estas páginas. El 50 %
histórico sobre entrada de 150 DPI produjo unos 624×883 px, mientras el
brazo actual produjo 1240×1754 px. El origen de 150 DPI llegó al OSD como
1248×1765 px; el brazo actual ya conserva casi toda su resolución.

El umbral de tinta 0,002 clasificó igual en los tres brazos: los 48 PDFs
de dos renglones medidos (16 únicos × 3 repeticiones) quedaron **por debajo**,
y las otras tres densidades quedaron **por encima**. En dos renglones, incluso
el máximo `inkRatio` nativo fue 0,001496; el máximo actual fue 0,001743.
Escalar a nativo no dispara el reintento ni el aviso `unreadableInk` de
ADR-190 para esos PDFs. Entre los controles, los 12 blancos y 12 de ruido
quedaron sin tinta; los 12 de figuras dieron tinta, pero **ninguno de los
108 intentos de OSD sobre controles produjo un veredicto falso**. Esos
controles no se incluyen en los aciertos con texto.

## Costo aislado del detector

La mediana de `detect` entre las 192 observaciones con texto por brazo fue
165,2 ms a la mitad histórica, 222,7 ms con el tamaño actual y 487,6 ms
en nativo. La diferencia **pareada por PDF y repetición**, nativo menos
actual, tuvo mediana **+218,7 ms**; nativo tardó más en 162/192 parejas.
Para usar los PDFs como unidades independientes, se tomó la mediana de las
tres **diferencias pareadas** de cada PDF y luego la mediana de esos
64 valores: **+213,5 ms**. Nativo tardó más en **53/64 PDFs**.
Las diferencias pareadas por DPI de origen fueron:

| Origen | Nativo menos actual: mediana de `detect` | Píxeles actuales / nativos |
|---:|---:|---:|
| 150 DPI | −2,0 ms | 2,175 / 2,203 MP |
| 200 DPI | +130,6 ms | 2,175 / 3,903 MP |
| 250 DPI | +294,8 ms | 2,175 / 6,088 MP |
| 300 DPI | +486,4 ms | 2,175 / 8,697 MP |

La tabla usa las 48 parejas PDF×repetición por DPI. Con la mediana de las
tres diferencias pareadas de cada PDF, el delta a 300 DPI fue +487,9 ms y
nativo tardó más en 16/16 PDFs.

A 300 DPI la copia nativa cuadruplica los píxeles del brazo actual: unos
34,8 MB frente a 8,7 MB si se cuentan cuatro bytes por píxel. Esta es una
**estimación de tamaño del input**, no un pico de memoria medido de Electron
ni el presupuesto RSS de ADR-146. Las tres repeticiones intercaladas
muestran la diferencia aislada de `detect`; no extrapolamos directamente
ese delta al tiempo total de OCR o export.

## Lectura y próximo paso

El tamaño fijo actual evita las regresiones de orientación que causa la
reducción histórica al 50 % en origen de DPI bajo. Entregar al OSD una copia
nativa mayor no mejoró ningún ángulo ni cambió la clasificación de tinta en
este corpus, y agregó costo de detección a 200–300 DPI. Por estos datos,
**se recomienda conservar los 1754 px actuales para OSD y el cap nativo de
OCR de ADR-163**. No se modifica el kernel a partir de este sondeo.

El bloqueo de la ronda B permanece: dos renglones a 180° pueden producir
basura confiable mientras OSD no da veredicto y la tinta queda por debajo
de 0,002. El siguiente cambio debe evaluar la fiabilidad de esa lectura y
la decisión de probar ángulos/advertir al usuario, con controles que eviten
reintentos indiscriminados en páginas blancas, ruido y figuras. Este
experimento usa PDFs sintéticos y no demuestra la misma tasa en escaneos
reales, manuscritos ni regiones recortadas.

Los datos crudos `runs.json`, cada celda, `summary.json`, `manifest.json`
y el análisis reproducible están en la sesión ignorada por Git indicada
arriba. Este informe conserva los resultados necesarios para revisar la
decisión sin depender de archivos temporales.
