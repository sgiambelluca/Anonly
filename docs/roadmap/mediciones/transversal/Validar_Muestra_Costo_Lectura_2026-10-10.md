<!-- CONTEXT: scope=medicion-validar-muestra-m-v1 | dependencias=roadmap/hardening/Confianza_Cierre_2026-10-08.md,roadmap/hardening/Validar_Muestra_Diseno_2026-10-09.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-205-El-Resultado-Exportado-Pertenece-A-Una-Revision.md | audiencia=humanos+IA | fase=12 -->

# Validar muestra — costo de leer la copia exportada

**Estado: caracterización completa y auditada, provisional; antecedente
histórico de una función retirada del roadmap el 2026-10-11.** No se
desarrolla «Validar muestra» ni quedan decisiones de flujo/comparación/costo
o mediciones de esa función pendientes. Se conservan los resultados y
limitaciones de esta campaña. M-V1 terminó en
`.measure/validate-sample/campaign-20261010-rc-v1`, con RC incorporado:
**36/36 recorridos registrados, 30 exitosos y seis lecturas parciales de R4**.
No faltan celdas, no hay duplicados, invalidaciones ni errores del instrumento.
La guarda cerró y las identidades/restauraciones coinciden. No se reutilizan
corridas de los smoke o del intento interrumpido anterior.

El escaneo real R1 se relee en medianas de 74,859 s en Bajo y 43,949 s en
Medio, con las 20 páginas terminadas. R4 alcanza Ready, pero falla OCR en
una página en Bajo y dos en Medio, consistentemente en las tres repeticiones.
Sus tiempos y picos de memoria se informan como **lectura incompleta**, no
como costo de una validación satisfactoria. El código de salida 0 del runner
y `check.complete=true` significan que la caracterización quedó registrada;
no significan que el producto leyó correctamente las 36 copias.

## Pregunta y alcance

Cuánto tarda y cuánta memoria pide leer el PDF anonimizado respecto del
análisis de su original. La aplicación exporta por la UI real; el arnés
conserva esos mismos bytes solo en memoria, cierra completamente el Electron
original y los reimporta en otra instancia fría.

La reimportación ejecuta OCR, NER, Regex y agrupación. Es una aproximación
al costo de lectura, no una medición de la función «Validar muestra», que
no se implementó y fue retirada. No mide la comparación de valores propuesta ni
el pico con la sesión original retenida. El flujo implementado deberá medirse
antes de cerrar su costo; no se suman picos de ventanas separadas para
inventar ese consumo.

La decisión SV/CP permanece [pendiente de desarrollo](../../ocr/Orientacion_SV_CP_Retoma_2026-10-10.md).
Esta campaña usa el producto con RC y no prueba la regla SV simulada.

## Matriz y procedimiento

Seis documentos, perfiles `low` y `medium`, tres repeticiones frías por
combinación: **36 corridas previstas**. Los reales se presentan primero y
separados de los sintéticos; no se recortan para igualar su cantidad de páginas.

| ID neutro | Fuente | Páginas | SHA-256 de los bytes originales |
| --- | --- | ---: | --- |
| R1 | Escaneo real | 20 | `b0fa61494c55fcfb16027d036d7b40fc36bbcc2a4924105e4236f14b29d9cc99` |
| R4 | Digital real | 51 | `6ab5cd50d44d0eab4bd45ef179860d3b3d7407506b83086934bc5489f291cdda` |
| digital10 | Digital sintético | 10 | `7e5f9301b94e6425a1cc11c854102663f5a1a3348c09152784448784bd88fde1` |
| digital50 | Digital sintético | 50 | `77d00e5a9425731c8e5545c0d3468284ff832c95902edc06cb2a8f0b157be258` |
| scan10 | Escaneo sintético, 216 dpi | 10 | `6a4a9aa4cf72245e65cdea5503ec54a02c6262fb7c391ea988700c05b2a56255` |
| scan50 | Escaneo sintético, 216 dpi | 50 | `b36a088fcf3af594ed21e3ec31bd230d5d146721524bc0adfd2f9a34ac69c9b1` |

Para estabilizar los sintéticos digital10, scan10 y scan50 se fijan
`CreationDate` y `ModDate` a `2026-01-01T00:00:00.000Z`, en memoria y antes
de medir. El texto, las imágenes y los helpers originales se conservan.
No se normalizan fuentes reales ni sus exports.

Cada recorrido registra importación hasta Ready, preparación de conflictos,
export y reimportación. La preparación confirma por UI únicamente los
defaults vigentes, después de Ready. Se informa aparte: no mide revisión
humana ni acredita que esas opciones sean correctas. Debe preservar la
semántica de grupos y conflictos, eliminar los pendientes y habilitar export.

El export usa JPEG, 150 dpi, calidad 0,92 y sin leyenda. La captura transparente
de `URL.createObjectURL` conserva el Blob que corresponde al href exacto;
comprueba tamaño, hash y páginas y libera referencias en `finally`. No cambia
la CSP, no descarga a disco y no sustituye los bytes por otro PDF.

M2 es el pico RSS observado de los procesos Electron durante cada importación;
puede contar páginas compartidas más de una vez. Los buffers que conserva
Node quedan fuera de M2: se informa el tamaño del export por separado, sin
presentarlo como pico Node medido. Las tablas finales mostrarán medianas y
rangos de tres corridas, tiempos OCR separados cuando estén disponibles y
fallas por etapa; una falla no se incluye como tiempo de éxito.

## Entorno e identidad

Windows x64, Intel Core i5-12400, 12 CPU lógicas, RAM física
16.935.129.088 bytes; Node v22.23.2. Base Git
`aceb72ef9e03f24541daad9768bf08033245672b`, con cambios sin commit: resultados
provisionales que deberán repetirse sobre el commit autorizado antes de
publicar. La identidad final y la restauración se registrarán al cerrar la
campaña, sin modificar producto ni tests durante la medición.

El hash de build del manifiesto es
`d805ff0722fb07672322bac947d43848a17d7fcea49aa31d984700c5182ac502`.
No se confunde con las identidades de árboles que serializa el runner.

La auditoría independiente del planificador a las `22:37:25 UTC` comprobó
HEAD, diff e identidad de producto, diff y archivos sin trackear del arnés,
los dos locks y la restauración del cliente/shell. Los nueve checks dieron
verdadero. El registro del implementador quedó en `audit/final.json`,
subcarpeta que no altera el inventario estricto de celdas del resumen.

| Identidad final | SHA-256 |
| --- | --- |
| Producto: diff e identidad | `6e91c9f66cfc341af8aa5137756b02c009dddfeb768371565342dc6cf018aa44` |
| Tests: diff | `4348cb659bca7996285e7fe86650d8b593f1e6d87b798cbdf5d1fa372de4a2a4` |
| Renderer, digest del runner y dist restaurado | `e67f16d7c750fb39f894d613f6120a1263654b6bf5e1d39f18f089cc765d7574` |
| Shell, digest del runner y dist restaurado | `53c068169d99947fbc329cc473bfb6a636a719f8352967820145f847fccaed96` |
| `assets.lock.json` | `70d31a6f9ff135d989833a1059f5a7b17d20acaec8472ad97eab47410ddc4b6b` |
| `pnpm-lock.yaml` | `bbe92d9721b2d9173db32775a71b55d9015b67ba8bba495e0fa048cdcbb9fd3e` |

## Validez y observabilidad

La única tanda, `tanda-20261010T214800Z-1058`, cerró con sello `finished`,
detección confirmada al inicio y al final y ningún evento de suspensión.
La única salvedad es el árbol de producto sin commit. Los seis hashes de
entrada se conservaron en las 36 celdas; las nueve identidades iniciales y
finales del runner coinciden.

Se conservaron 72 series de RSS, con **17.173 muestras** en total. La presión
del sistema fue desconocida en todos los 144 bordes de esas 72 importaciones
(`SystemMemoryPressureUnavailable`), sin campos faltantes. No se acredita
presión estable ni se reemplaza ese dato con la lectura de host de la tanda.
La guarda de suspensión tampoco demuestra presión estable.

Se pidieron 18 recorridos Bajo y 18 Medio. La configuración efectiva del pool
no quedó capturada por M-V1: los perfiles se identifican como solicitados, sin
inventar una comprobación del número efectivo de workers. Los 36 exports
conservaron las opciones declaradas, sus páginas y la captura en memoria.
No se cubrió ninguna página ni se mostraron confirmaciones de cubierta o
ausencia de grupos.

Los registros contienen IDs neutros, hashes y agregados. No se guardan nombres,
rutas, texto OCR, imágenes, PDF derivados, capturas, trazas ni videos de
documentos reales. El límite de payload de 50 MiB de Playwright es una limitación
del instrumento; no se presenta como límite del producto ni se evita mediante
una copia real en disco.

La [propuesta de diseño](../../hardening/Validar_Muestra_Diseno_2026-10-09.md)
fue retirada por decisión humana del 2026-10-11; sus consultas de interacción,
comparación y costo quedaron canceladas.
M-V1 no convierte esa propuesta en un contrato aceptado ni acredita el gate
independiente del export.

## Reales — resultados principales

Mediana (mín–máx), segundos y MB decimales. Cada celda debe tener tres corridas.

Las tablas del resumen incluyen únicamente flujos completos exitosos. Por eso
R4 figura con `n=0` y guiones, aunque original y export sí terminaron: sus
datos por etapa y lecturas parciales se informan después, separados del costo
de éxito. `—` en OCR de un original digital indica que no pasó por esa etapa,
no un tiempo OCR medido de cero.

| Doc | Páginas | Nivel | n | Original Ready s | Original OCR s | Original M2 MB | Export s | Export MB | Reimport Ready s | Reimport OCR s | Reimport M2 MB |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| R1 | 20 | low | 3 | 79.4 (79.1–79.7) | 68.0 (67.7–68.4) | 1852.9 (1805.0–1928.1) | 0.8 (0.7–0.8) | 5.2 (5.2–5.2) | 74.9 (74.7–75.2) | 63.7 (63.4–63.8) | 1804.4 (1796.7–1851.4) |
| R1 | 20 | medium | 3 | 46.5 (46.3–46.5) | 35.1 (34.9–35.1) | 2007.5 (2000.0–2018.0) | 0.9 (0.9–0.9) | 5.2 (5.2–5.2) | 43.9 (43.7–44.0) | 32.6 (32.4–32.6) | 1955.0 (1934.6–1962.3) |
| R4 | 51 | low | 0 | — | — | — | — | — | — | — | — |
| R4 | 51 | medium | 0 | — | — | — | — | — | — | — | — |

## Matriz sintética

Mediana (mín–máx), segundos y MB decimales. Cada celda debe tener tres corridas.

| Doc | Páginas | Nivel | n | Original Ready s | Original OCR s | Original M2 MB | Export s | Export MB | Reimport Ready s | Reimport OCR s | Reimport M2 MB |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| digital10 | 10 | low | 3 | 2.0 (1.9–2.0) | — | 1507.5 (1504.3–1507.8) | 0.4 (0.4–0.4) | 0.2 (0.2–0.2) | 11.4 (11.4–11.7) | 9.5 (9.5–9.8) | 1732.8 (1693.8–1767.3) |
| digital10 | 10 | medium | 3 | 1.9 (1.9–1.9) | — | 1565.6 (1532.8–1567.6) | 0.4 (0.4–0.4) | 0.2 (0.2–0.2) | 7.1 (7.1–7.2) | 5.2 (5.2–5.3) | 1805.7 (1771.9–1865.9) |
| digital50 | 50 | low | 3 | 3.6 (3.6–3.6) | — | 1551.4 (1525.2–1563.5) | 1.5 (1.5–1.5) | 1.6 (1.6–1.6) | 36.6 (36.3–36.9) | 33.1 (32.8–33.1) | 1868.6 (1813.6–1944.3) |
| digital50 | 50 | medium | 3 | 3.6 (3.6–3.6) | — | 1532.2 (1508.7–1537.2) | 1.5 (1.5–1.5) | 1.6 (1.6–1.6) | 17.4 (17.4–17.6) | 13.8 (13.8–14.0) | 1962.8 (1895.6–2001.1) |
| scan10 | 10 | low | 3 | 9.7 (9.7–9.9) | 7.6 (7.6–7.6) | 1867.9 (1851.9–1954.8) | 0.6 (0.5–0.6) | 0.2 (0.2–0.2) | 11.5 (11.4–11.6) | 9.6 (9.6–9.6) | 1699.7 (1696.0–1706.1) |
| scan10 | 10 | medium | 3 | 6.2 (6.2–6.2) | 4.1 (4.0–4.1) | 2066.3 (2051.0–2080.4) | 0.5 (0.5–0.5) | 0.2 (0.2–0.2) | 7.1 (7.1–7.2) | 5.3 (5.2–5.3) | 1807.2 (1780.8–1826.4) |
| scan50 | 50 | low | 3 | 41.1 (41.1–41.2) | 36.4 (36.3–36.5) | 1921.8 (1893.5–1946.3) | 2.4 (2.4–2.4) | 1.6 (1.6–1.6) | 36.5 (36.4–36.5) | 32.9 (32.9–32.9) | 1851.5 (1835.2–1935.7) |
| scan50 | 50 | medium | 3 | 19.7 (19.5–19.8) | 15.0 (14.9–15.0) | 2126.7 (2062.2–2234.0) | 2.5 (2.5–2.6) | 1.6 (1.6–1.6) | 17.6 (17.6–17.7) | 14.0 (13.9–14.1) | 1954.5 (1940.0–1967.4) |

## R4 — etapas terminadas y lectura parcial

En las seis corridas, el original digital se analizó sin OCR, se prepararon
los 123 grupos sin conflictos pendientes y se exportaron las 51 páginas.
El export midió 12.232.947–12.232.949 bytes y ninguna cubierta. La copia
requiere OCR en las 51 páginas; el producto alcanza Ready con solo 50 páginas
OCR terminadas en Bajo y 49 en Medio. El fallo de Bajo se repite en página 1
(índice 0); en Medio, en páginas 1 y 4 (índices 0 y 3), tres de tres cada nivel.

| Perfil solicitado | n parciales | Ready original s | Ready copia parcial s | OCR copia parcial s | M2 original MB | M2 copia parcial MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Bajo | 3 | 26,273 (26,226–26,543) | 203,583 (203,400–203,850) | 176,945 (176,502–177,187) | 1604,8 (1604,5–1622,6) | 4196,1 (4171,8–4232,7) |
| Medio | 3 | 26,150 (26,147–26,213) | 114,257 (114,195–114,673) | 87,910 (87,622–88,210) | 1648,6 (1643,9–1650,7) | 4359,4 (4347,1–4362,0) |

Los picos posteriores a Ready de la copia parcial fueron 3687,0 MB
(3671,1–3696,2) en Bajo y 3968,4 MB (3950,0–3979,1) en Medio. Son ventanas
posteriores informadas aparte, sin restarlas de M2. El tiempo Core del export
fue 1,959 s (1,937–1,959) y 2,066 s (2,046–2,117), respectivamente; el tiempo
entre pedido y evento final fue 1,963 s (1,941–1,963) y 2,069 s (2,050–2,121).
Ninguno incluye revisión humana.

Los registros guardan índices de páginas fallidas, pero no el código de
`OCR_PAGE_FAILED`; la causa específica **no está observada**. No se atribuye
a timeout, orientación, RC o presión de memoria. `report.ok=true` y
`pipelineFailed=false` solo acreditan el Ready del pipeline; no eliminan
las páginas fallidas. El contador de `unreadableInk` es cero, pero no registra
todos los avisos de error. Para la propuesta retirada se había establecido
comprobar completitud por página y presentar lectura incompleta, sin convertir
Ready en «sin coincidencias». Queda como criterio histórico, no como tarea pendiente.

R4 es una caracterización diagnóstica de 51 páginas reales. No es el fixture
normativo P2 y no se evalúa contra su techo de 3 GB. Tampoco mide la memoria
de una futura verificación con el documento original abierto.

## Diagnóstico posterior: primer observador inválido para códigos

La corrida separada `r4-diagnostic-20261010-v1` no modifica la matriz M-V1.
La auditoría encontró un defecto del instrumento: la función enviada al
navegador con `page.evaluate` usaba dos conjuntos de enums definidos en Node.
Esas variables no se transfieren. Un control offline con un payload ficticio
válido produjo `ReferenceError` para `knownCodes`, antes de registrar el fallo.
El conteo cero de errores de ese diagnóstico no acredita ausencia de eventos
`OCR_PAGE_FAILED` y no identifica la causa de las páginas faltantes.

Se preservó v1 y se preparó una única corrida de reemplazo con observador
corregido y controles sintéticos, en carpeta v2 independiente. Su resultado
válido se documenta abajo; no se atribuyen sus códigos retrospectivamente
a las seis lecturas parciales de M-V1. Producto y receta no cambiaron.

Antes de leer el documento real en v2, el control browser de la función
serializada registró cuatro fallos ficticios, validó las etiquetas fijas para
códigos/motores desconocidos y omitió campos sensibles y timeouts no permitidos.
La espera no terminó ante un fallo de página, pero sí por Ready o fallo fatal
del pipeline. El planificador revisó el spec y confirmó independientemente
esas condiciones con la función transpilada en un contexto aislado. Esta
validación del instrumento no acredita por sí sola una lectura satisfactoria.

## Diagnóstico válido v2: dos fallos de página, causa raíz no identificada

La única corrida de reemplazo en
`.measure/validate-sample/r4-diagnostic-20261010-v2` terminó y fue auditada
por el planificador. Original R4: mismo hash de M-V1, 51 páginas parseadas,
cero requieren OCR, un Ready y ningún fallo de pipeline. El export mantuvo
51 páginas, JPEG 150 dpi, calidad 0,92 y sin leyenda, 12.232.947 bytes
conservados solo en memoria. El Electron original cerró antes de abrir la copia.

La copia fría llegó a Ready con 51 páginas que requieren OCR, 49 eventos
`OCR_PAGE_FINISHED` y dos `OCR_PAGE_FAILED`:

| Página humana | Índice | Código reportado | Motor | Retryable |
| --- | --- | --- | --- | --- |
| 1 | 0 | `OCR_PAGE_FAILED` | `ocr` | `false` |
| 4 | 3 | `OCR_PAGE_FAILED` | `ocr` | `false` |

No hubo fallo fatal del pipeline. Los dos índices sin OCR terminado coinciden
con los dos fallos observados. El código es genérico: **no identifica causa
raíz**. No se guardó `details`, mensaje ni stack, y `timeoutMs` no se conserva
para ese código. No se atribuye a orientación, timeout, RC ni memoria, ni
se transfieren esos códigos a los seis registros históricos de M-V1.

Guarda positiva al inicio y cierre, sin suspensión detectada, runner exit 0;
las nueve identidades inicio/final coinciden, con diff de producto
`6e91c9f66cfc341af8aa5137756b02c009dddfeb768371565342dc6cf018aa44`.
Ambos perfiles temporales se eliminaron. La auditoría no encontró PDF,
imágenes, videos o ZIP reales, ni la ruta/nombre privados en los registros
inspeccionados. El crudo mantiene únicamente agregados y campos permitidos.
No se repitió por resultado de producto: la lectura sigue siendo parcial.
Este diagnóstico de eventos no añade una medición de costo de la futura función.

## Preparación y otros picos

R1 confirmó dos conflictos pendientes en cada una de sus seis corridas,
de dos a cero, preservando la semántica de sus 76 grupos y de los conflictos.
La preparación duró 431,482 ms (416,048–464,943) en Bajo y 475,426 ms
(466,514–486,385) en Medio. En las otras 30 corridas no hizo falta confirmar
conflictos; los 36 recorridos conservaron ambas invariantes y export habilitado.

R1 dejó picos posteriores a Ready del original de 1322,6 MB
(1314,8–1335,0) en Bajo y 1786,7 MB (1758,6–1817,3) en Medio. En la copia,
1308,5 MB (1301,0–1314,2) y 1548,8 MB (1526,1–1554,4). Los picos posteriores
de los sintéticos y las 36 preparaciones están en `summary.json` y
`summary-tables.txt`; no se mezclan con M2. El mayor post-Ready sintético
registrado fue 2090,8 MB, en el original scan10-Medio-r3.

## Cierre como antecedente histórico (2026-10-11)

La lectura aislada de R1 costó alrededor de 44–75 segundos y la de los
sintéticos de 50 páginas, 17–37 segundos, según perfil y fuente. No se extrapola
una tasa por página a otros documentos: R4 tuvo lecturas parciales de
114–204 segundos y picos superiores a 4 GB incluso con el original cerrado.
El corpus disponible no estima frecuencia de estos resultados en expedientes.

El mantenedor retiró la función del roadmap, priorizando la revisión manual
del documento y la configuración de sus entidades. M-V1 queda como
caracterización histórica; no exige implementación, aceptación de costos
ni nuevas mediciones del flujo propuesto. Los fallos y limitaciones se
conservan y el gate técnico independiente del export sigue vigente.

El único pendiente **diferido** de orientación SV/CP conserva su estado.
Memoria final, revisión y publicación siguen en el plan de cierre.
