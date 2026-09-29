<!-- CONTEXT: scope=medicion-ocr-osd-ausente | dependencias=../../ADR190_OSD_Ausente_Recuperacion_Plan.md,ADR190_DPI_2026-09-27.md,ADR190_OSD_Escala_2026-09-28.md | audiencia=planificador+implementador+revisor | fase=11 -->

# ADR-190: lectura real cuando el OSD no da veredicto (Windows)

**Estado:** campaña completa, implementación y evidencia final revisadas por
Sol. El humano aceptó el costo residual para cerrar la ronda B y registró su
optimización como posible trabajo posterior (`../../Future_Ideas.md` §6).

## Método y validez

Se ejecutó `ANONLY_ADR190_OSD_RECOVERY_CAMPAIGN=1` en Windows con
`tests/perf/adr190-osd-recovery-campaign.spec.ts`: **380/380 observaciones**,
64 PDFs sintéticos con texto y 12 controles, cada uno en producción y con la
primera lectura OCR forzada a 0°, 90°, 180° o 270°. El override vive solo en
el transporte del arnés; no cambia la imagen, el DPI ni los reintentos
posteriores. Se usaron el worker y los modelos reales.

Sesión cruda: `.measure/adr190-osd-recovery/2026-09-28T05-33-21-860Z-campaign-20508/`.
`manifest.json`, `summary.json`, `observations.json` y las 380 observaciones
individuales están allí. El build SHA-256 coincide con QUALITY:
`548d5c0b12cf9cc598be7f0273288052326d3b91903f5722825a0104a454bd17`.
Los 64 hashes de PDF y los metadatos del ráster OCR coinciden con QUALITY;
las primeras lecturas de producción son idénticas en palabras, OSD crudo,
ángulo e `inkRatio` (64/64). El hash de imagen OCR es igual entre las cinco
lecturas de cada PDF (76/76). QUALITY no guardó el hash OCR, por lo que no se
afirma identidad retrospectiva de bytes con esa campaña. El resumen registra
**cero fallas instrumentales**. Los 12 controles no entran en el denominador
de acierto con texto.

## Resultado sobre 16 PDFs de dos renglones

El OSD actual devolvió `null` en los 16. La primera lectura de producción
usó 0°; cuatro páginas derechas produjeron los cuatro tokens esperados sin
extras, cuatro invertidas (180° físico) produjeron cero tokens verdaderos y
**ningún DNI**, y ocho laterales (90°/270° físicos) incluyeron el DNI pero
también palabras falsas. Las cuatro invertidas acabaron sin `unreadableInk`:
la basura contiene palabras con confianza ≥ 0,60. Las 16 quedaron debajo de
`INK_PRESENT_RATIO=0.002`, de modo que el camino actual no ensaya otros
ángulos.

Forzar el ángulo correcto produjo `Juan Perez DNI 34.567.891`, con recall y
precisión de tokens **1,00** y confianza de página **0,95** en 16/16. Por lo
tanto, el reconocimiento puede recuperar este corpus sin cambiar el DPI ni
la escala OSD. En los ángulos incorrectos 90°/270° aparecen entre 6 y 8
palabras individualmente confiables, más que las cuatro limpias; su
`pageConfidence` es 0 porque el reconocimiento principal de página quedó
vacío y las palabras provienen de las pasadas de margen de ADR-121.

El comparador actual (`cantidad de palabras ≥ 0,60`, luego confianza de
página) escogería el ángulo correcto en **0/16** si se compararan las cuatro
primeras lecturas. Un comparador experimental que prioriza la confianza de
página lo escoge en **16/16**. Sobre los 64 PDFs con texto, este último
seleccionó el ángulo esperado en 64/64, frente a 32/64 del comparador actual
si se lo aplica fuera de línea a *todos* los ángulos; esto **no es** una mejora
medida del pipeline, que normalmente no ejecuta esa matriz. El hallazgo
impide añadir reintentos manteniendo el ranking actual.

Un gatillo experimental `OSD sin veredicto && al menos una palabra confiable
en la primera lectura` selecciona **16/64** PDFs con texto (exactamente los
de dos renglones) y **0/12** controles en esta muestra. No depende del
`inkRatio`, cuyo umbral actual excluye los 16 casos. No se debe interpretar
esta separación del corpus sintético como sensibilidad/especificidad en
documentos reales. En particular, las cuatro páginas derechas ya estaban
bien leídas y también entrarían al gatillo.

Un E2E posterior, generado con otra geometría (280×220 pt, letra 26),
descubrió un segundo camino: a 90° físico el OSD devolvió `null`, la primera
lectura a 0° quedó vacía y `inkRatio=0,03489`. La cadena vigente probó 90°,
obtuvo basura con confianza de página 0,66 y se detuvo antes del ángulo
correcto. Un sondeo de las cuatro primeras lecturas sobre el **mismo** ráster
OCR (SHA-256 `e0151d268bc9662c25d785d41ab1da1d3bcc6efce139dcb62683ba533fce58eb`)
dio: 0° vacío/confianza 0, 90° basura/0,66, 180° vacío/0, 270°
`Juan Perez DNI 34.567.891`/0,90 y entidad Regex DNI. La evidencia está en
`.measure/adr190-e2e/forced-first-read-{0,90,180,270}-*.json`. Este fixture
**no** pertenece a los 64 de QUALITY y su salida no se agrega a aquellos
denominadores. Demuestra que el gatillo limitado a primera lectura confiable
es insuficiente. La enmienda usa `OSD sin veredicto && (primera lectura
confiable || inkRatio≥0,002)` para páginas enteras: alcanza el nuevo caso y
mantiene blanco/ruido fuera.

## Controles, costo y límites

Blanco y ruido: 8/8 controles sin palabra confiable ni reintentos. Figuras:
4/4 tienen tinta y la primera lectura no tiene palabra confiable, por lo que
el primer gatillo no los seleccionaría. El gatillo ampliado sí selecciona
los cuatro; en las primeras lecturas forzadas 0°/90°/180°/270° ninguno dio
una palabra confiable. La cadena vigente
hace 4–5 intentos y en dos controles (150 y 200 DPI) acaba con el carácter
falso `>` a confianza 0,68/0,72 y sin aviso. Esto es un riesgo independiente
del OSD ausente: el criterio global de una palabra ≥ 0,60 no basta para
declarar que una página con figuras se leyó. La rama ampliada evitaría el
upscale que produjo ese falso positivo y debería marcar las cuatro figuras
como ilegibles; **falta confirmarlo en el pipeline modificado**.

El costo medido de las **tres primeras lecturas extra por separado** en los
16 PDFs de dos renglones tiene mediana de suma **3.814 ms** por PDF
(150/200/250/300 DPI: 2.484/3.453/4.213/5.548 ms). Es una estimación de
tiempo de worker a partir de ejecuciones independientes, **no** una medición
pareada del pipeline completo ni de memoria. Falta medir la implementación
real, incluyendo OSD, encadenamiento, NER/export y memoria. No se cambió el
cap nativo de ADR-163 ni el lado largo OSD de 1754 px: la campaña DPI y el
sondeo de escala ya descartaron esos cambios para este caso.

## Consecuencia para la ronda B

Antes de editar producto, enmendar ADR-190 y `OCR_Engine.md` con una señal
explícita de si el OSD emitió veredicto (el ángulo 0° solo no lo revela), un
camino acotado para OSD ausente con primera lectura confiable o tinta presente,
y selección
que no prefiera las palabras de margen espurias frente a la lectura limpia.
Conservar el comportamiento actual cuando sí hubo veredicto hasta medir una
regresión. La solución deberá pasar E2E de DNI y export a 180°/90°/270°,
controles negativos y nuevas campañas de calidad, tiempo y memoria. El falso
`>` en figuras requiere prueba del producto corregido dentro de B-1/B-4;
el reporte de 16/16 no lo cierra.

## Medición del producto con la enmienda implementada (intermedia)

El build de las tres fases fue
`9561c266d083897bc8b5b0f6fff3698411355648b9bf1f05fcde503f1b02cb4e`.
Se comparó contra el build anterior
`548d5c0b12cf9cc598be7f0273288052326d3b91903f5722825a0104a454bd17`.
Los 64 hashes de PDF coinciden entre las fases QUALITY anteriores y nuevas.
Cada fase tuvo cero fallas instrumentales. Las sesiones crudas y los análisis
reproducibles están en `.measure/adr190-dpi/` y
`.measure/adr190-osd-recovery/` (ignorados por Git).

- QUALITY: `2026-09-28T14-53-31-865Z-quality-24220`, 128/128. En el brazo
  nativo, el DNI de los 64 PDFs con texto pasó de 60/64 a 64/64. Los 16 casos
  de dos renglones terminaron con recall y precisión de tokens 1,00, sin
  palabras extra; cada uno despachó exactamente tres `ocr-page` adicionales.
  Los otros 48 no añadieron trabajos. Los cuatro controles de figuras
  (150/200/250/300 DPI) quedaron sin palabra fiable ni entidad, con
  `unreadableInk`; el E2E verificó la advertencia y la exportación censurada.
  El resumen conserva 16 fallos de calidad en páginas tipo `header` por
  tokens de margen falsos ya presentes antes; no son regresión de esta
  enmienda ni se cuentan como aciertos.
  Sol aprobó calidad y cobertura de B-1/B-4/O-9, pero dejó tiempo y memoria
  pendientes.
- TIME: `2026-09-28T15-08-31-909Z-time-8424`, 384/384, tres repeticiones
  por PDF. La mediana de las diferencias entre medianas de importación hasta
  listo, con NER desactivado, fue **+2.086,5 ms** en los 16 casos nativos de
  dos renglones (16/16 más lentos; rango +896 a +3.882 ms). Por DPI 150/200/
  250/300, las medianas fueron +965/+1.563/+2.604,5/+3.614,5 ms. En los otros
  48 casos nativos fue −37,5 ms. El brazo forzado a 300 marcó +3.630,5 ms
  en dos renglones y −54 ms en los demás. Son sesiones separadas en el tiempo,
  no corridas simultáneas; los controles cercanos a cero acotan la deriva.
- MEMORY: `2026-09-28T15-46-43-916Z-memory-19232`, 128/128, muestreo cada
  150 ms. La mediana de diferencias del pico de **suma de working sets** fue
  **+194,44 MiB** en los 16 casos nativos de dos renglones (16/16 positivos;
  rango +45,94 a +484,27 MiB), frente a −7,95 MiB en los otros 48. Con 300
  forzado fueron +362,34 MiB en dos renglones y −1,49 MiB en los demás. La
  suma cuenta páginas compartidas más de una vez y no atribuye memoria
  privada al OCR. En un caso nativo de 300 DPI, el pico pasó de 1.240 a
  1.725 MiB; la mayor variación ocurrió en Tab y GPU, mientras Browser y
  Utility permanecieron casi estables. Las muestras de la corrida nueva
  muestran crecimiento escalonado durante los reintentos.

Este build intermedio quedó **sin aprobación de tiempo y memoria**. Su costo
material motivó la mitigación posterior descrita abajo. La decisión humana
de conservar el cap nativo de ADR-163 y el tamaño OSD actual no cambió.

## Detención de campañas posteriores

Tras una mitigación de memoria del kernel revisada por Sol, el build
`35849cc6ef1b26d915d5ff9e7c7d64e2bb81c8e57f90628c596a977a371608bc`
completó QUALITY 128/128, con cero fallas instrumentales y las mismas
palabras, calidad, orientación y eventos OCR que el build intermedio en
128/128 celdas (ignorando identificadores nuevos de cada corrida). La
comparación con el baseline original volvió a dar DNI 64/64 en el brazo
nativo y precisión/recall completos en los 16 PDF escasos.

El humano pidió **detener las mediciones** mientras corría TIME. La sesión
`2026-09-28T21-34-46-736Z-time-21784` quedó interrumpida con 373/384
registros y sin `summary.json`; no se usa para concluir sobre latencia.
No se inició MEMORY completo de este build. Un sondeo previo de ocho celdas
(build `f2977830849654d3baeacf509493510f412670ee2240d32aba2fae266e9453dd`)
mostró la misma calidad y una reducción de pico de 46–247 MiB en cuatro
casos de 300 DPI, sin ahorro consistente en cuatro de 150 DPI. Ese sondeo no
reemplaza una campaña completa ni permite atribución causal definitiva.
El bloque B conserva la aprobación de calidad/cobertura de Sol; su costo
final de tiempo y memoria no está validado. No se ejecutarán más campañas
por iniciativa del equipo.

## Sondeo dirigido de memoria del build final

Después, el humano autorizó continuar la revisión y medir solamente lo
indispensable. Sol delimitó un sondeo de la rama afectada con el arnés
existente: los 16 PDF `two-lines` nativos (cuatro DPI × cuatro ángulos) y
cuatro `full-0°` nativos como controles de deriva, uno por DPI. La sesión
`.measure/adr190-dpi/2026-09-28T23-14-15-642Z-memory-30092` completó
**20/20 celdas seleccionadas**, sin falla instrumental ni OOM; el `128`
de `summary.expectedCells` corresponde a la matriz completa del arnés,
filtrada con `--grep` en esta ejecución. El build SHA-256 coincide con QUALITY
final (`35849cc6...`). Los hashes de PDF coinciden con las sesiones anterior,
intermedia y QUALITY final. Palabras, calidad y secuencia de trabajos OCR
coinciden con QUALITY final en las 20 celdas.

| Grupo | n | Pico final mediano | Δ frente al baseline sin recuperación | Δ frente al build antes de liberar canvas |
|---|---:|---:|---:|---:|
| Dos renglones nativos | 16 | 1241,76 MiB | **+209,10 MiB** (rango +41,22 a +414,07) | −7,88 MiB (−210,78 a +63,46) |
| `full-0°` nativo, control | 4 | 1069,88 MiB | −15,18 MiB (−39,09 a +10,30) | −3,65 MiB (−32,11 a +8,73) |

Por DPI, la mediana de delta frente al baseline en los dos renglones fue
+96,44 / +149,21 / +244,01 / aproximadamente +297,3 MiB a
150/200/250/300 DPI. Tres de
los cuatro casos de 300 DPI superaron 1,6 GB decimales de suma de working
sets en este perfil de una página, con NER desactivado. **No se compara ese
número directamente con el presupuesto M2 de ADR-146**, que define otro
perfil (50 páginas, OCR y NER, frío/caliente). Las sesiones de comparación
separadas en el tiempo no aíslan causalidad al nivel de cada celda; los
controles cercanos a cero ayudan a interpretar la deriva. El sondeo confirma
un costo residual de memoria en la rama escasa y no demuestra un ahorro
global por liberar canvas. Los resultados por celda y el análisis reproducible
están en `targeted-final-memory-comparison.json` de la sesión y en
`.measure/adr190-osd-recovery/analyze_targeted_final_memory.py`.

Al cerrar este sondeo de memoria, TIME final aún no se había repetido: la
campaña completa anterior cuantificó +2.086,5 ms de mediana en los 16 casos
escasos del build previo a la limpieza de canvas. La salida y la cantidad de
trabajos del build final son idénticas; su latencia se midió después en el
sondeo dirigido siguiente. El perfil normativo M2 de ADR-146 ya superaba
la referencia de ~1,6 GB en Windows antes de esta enmienda (P2 frío 2204 MB,
caliente 2763 MB); repetirlo no resolvería por sí solo la decisión pendiente
sobre ese presupuesto. Este sondeo informa el riesgo incremental de ADR-190,
no valida M2 ni toda la ronda B.

## Sondeo dirigido de tiempo del build final

El humano pidió medir la latencia que faltaba sin seguimiento periódico. El
primer lanzador en segundo plano falló durante el build por tratar un aviso
no fatal de Vite en `stderr` como error de PowerShell; no produjo ninguna
observación. Tras corregirlo, la sesión
`.measure/adr190-dpi/2026-09-29T01-50-32-933Z-time-10488` terminó con
**60/60 observaciones seleccionadas**: los mismos 16 PDF escasos nativos y
cuatro `full-0°` nativos de control, cada uno con tres repeticiones. El
`384` de `summary.expectedCells` corresponde a la matriz general filtrada
con `--grep`. Build SHA-256 idéntico a QUALITY y MEMORY finales
(`35849cc6...`); cero fallas instrumentales o de calidad. Sol verificó los
hashes SHA-256 de los 20 PDF contra sus bytes, las palabras, la calidad y
la secuencia de trabajos OCR contra QUALITY final en 60/60. No hubo CDP
de OSD en la ventana temporal. El tiempo es importación hasta `Ready`, con
NER desactivado, y cada PDF se representa por la mediana de sus tres tiempos.

| Grupo nativo | PDF | Δ mediano frente al baseline sin recuperación | Rango | Δ mediano frente al build previo al cleanup |
|---|---:|---:|---:|---:|
| Dos renglones | 16 | **+2.237 ms** | +1.075 a +3.461 ms (16/16 positivos) | +127 ms (−421 a +286) |
| `full-0°`, control | 4 | −210 ms | −525 a −32 ms (4/4 negativos) | −151,5 ms (−192 a −94) |

Por DPI, el delta mediano de los dos renglones frente al baseline fue
+1.184,5 / +1.745,5 / +2.731 / +3.374,5 ms a 150/200/250/300 DPI. La
comparación entre sesiones separadas no permite atribuir finamente los
+127 ms frente al build previo a la limpieza de canvas. Sí deja cuantificado
el costo diferencial de la recuperación: subió en los 16 casos escasos,
creció con DPI y los controles comunes no subieron. Los datos por PDF y el
análisis reproducible están en `targeted-final-time-comparison.json` de la
sesión y en `.measure/adr190-osd-recovery/analyze_targeted_final_time.py`.
Sol cerró la reserva de **medición temporal**; esto caracteriza el costo, no
aprueba un presupuesto de latencia ni el M2 de ADR-146. No hace falta otra
medición para decidir sobre el costo residual del bloque B.
El humano decidió avanzar con ese costo caracterizado. El presupuesto M2 de
ADR-146 sigue sin validarse; esta decisión no convierte el sondeo dirigido en
el gate normativo.
