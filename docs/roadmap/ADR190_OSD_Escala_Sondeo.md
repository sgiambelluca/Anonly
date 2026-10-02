<!-- CONTEXT: scope=sondeo-escala-osd | dependencias=ADR190_DPI_Campana_Plan.md,mediciones/ocr/ADR190_DPI_2026-09-27.md,../adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md | audiencia=planificador+implementador+revisor | fase=11 -->

# Sondeo de escala de entrada al OSD — ADR-190

**Estado:** matriz completa ejecutada y auditada; resultados en
`mediciones/ocr/ADR190_OSD_Escala_2026-09-28.md`.
El humano decidió conservar el cap nativo de OCR de ADR-163. Este sondeo
estudia solo la copia que recibe el detector de orientación.

## Pregunta y línea de base

La reducción fija al 50 % era anterior a ADR-190. Hoy el kernel lleva el
lado largo de la imagen OSD a 1754 píxeles, con upscale máximo de 2. Para
una página A4 de esta campaña, eso equivale aproximadamente a escala 1
con origen 150 DPI, 0,75 a 200, 0,60 a 250 y 0,50 a 300. A 150 el OSD ya
ve casi el tamaño original; aun así los dos renglones no dieron veredicto.
El DPI **efectivo** del request nativo es 151/201/251/300 por la fórmula de
cap y el máximo configurado. A 150, el payload observado mide 1248×1765
píxeles y el brazo actual lo reduce levemente a 1240×1754; no se debe
declarar equivalencia exacta con el nativo.
La campaña DPI anterior midió **solo este tamaño actual**. La comparación
de escala posterior está documentada en el informe indicado arriba.

Queremos saber si una imagen OSD más cercana al ráster fuente obtiene un
veredicto correcto o una medición de tinta útil en páginas escasas, sin
regresar en páginas densas o controles sin texto, y cuánto cuesta el
detector. Conservar el cap de OCR es independiente de esta pregunta.

## Brazos y datos

Usar exactamente los **64 PDFs sintéticos y sus hashes** de la fase de
calidad ADR-190: 4 DPI de origen × 4 densidades × 4 giros. Comparar para
cada misma imagen de entrada al OSD:

| Brazo | Factor de dimensión del OSD |
|---|---|
| Mitad histórica | 0,5 de la imagen de entrada |
| Actual | `min(2, 1754 / ladoLargoPx)` |
| Nativo | 1, sin ampliación ni reducción adicional |

Los brazos pueden producir píxeles idénticos (actual/nativo a 150, mitad/
actual a 300); registrar y verificar esas equivalencias. No volver a
dibujar texto. Registrar el tamaño y DPI efectivo **reales** del ráster
que llega al OSD, no solo el DPI nominal del PDF. Generar los tres inputs
con la misma decodificación y redimensionado que `orientation-kernel.ts`.

El experimento usa el Tesseract OSD real, mismos assets, OEM, lenguaje
`osd` y runtime que la app. Una reproducción del brazo actual debe
coincidir con los 96 veredictos válidos y 32 ausencias registrados por la
campaña anterior, o explicar cada discrepancia antes de comparar variantes.
El preflight auditado de cuatro PDFs de dos renglones (150/300 DPI,
0°/180°) reprodujo las cuatro ausencias de veredicto y la tinta del brazo
actual; el nativo tampoco obtuvo veredicto en esos cuatro casos. Una
observación por brazo no alcanza para concluir sobre tiempo.
La matriz final confirmó el resultado en los 16 PDFs de dos renglones:
ningún brazo emitió ángulo y los tres quedaron bajo el umbral de tinta.
La escala nativa no cambió los veredictos del brazo actual en los 64 PDFs;
la mitad histórica empeoró 22. El costo y los denominadores constan en el
informe.
No se cambian palabras, OSD ni umbrales de producción para hacer pasar el
experimento. Una observación `orientation_degrees=null` o confianza nula
es **sin veredicto**, no acierto de 0°.

Para cada celda registrar: hash de PDF, dimensiones de origen e input OSD,
factor, píxeles, `orientation_degrees` y `orientation_confidence` crudos,
error o ausencia, ángulo esperado, acierto con el piso vigente de
confianza, `inkRatio` del mismo input y decisión frente a 0,002, duración
de `detect` separada de la inicialización del worker. La duración se
repite tres veces con órdenes intercalados, sin elegir la mejor corrida.
Registrar el costo de memoria del input (píxeles × 4) como estimación, no
atribuirlo al pico medido de la app sin una medición integrada.

Agregar controles blanco, ruido determinista y línea+elipse a cada DPI.
Estos controles no se suman al denominador de aciertos con texto: se
informan los falsos veredictos y `inkRatio` por separado. Las regiones
recortadas mantienen el contrato actual y no participan en este primer
sondeo de páginas completas.

## Ejecución y criterio

Arnés opt-in en `tests/perf/`, salida cruda bajo `.measure/`. Primero un
preflight de dos renglones a 150 y 300 DPI con giro 0° y 180°, en los tres
brazos, que demuestre Tesseract real, tamaño de input, hashes y que el
brazo actual reproduce los resultados anteriores. El revisor audita el
instrumento antes de la matriz completa. Ejecutar la matriz y los
controles de forma secuencial en Windows nativo, sin otras pruebas de
rendimiento en paralelo. El planificador publica un informe versionable
con conteos exactos y deltas pareados; los fallos no se descartan.

Si el OSD nativo mejora algún caso, eso todavía **no valida cambiar el
producto**: hay que distinguir mejora del ángulo, cruce del umbral de tinta
y calidad final de OCR, así como su costo. Si no mejora los dos renglones
a 180°, el bloqueo de ADR-190 seguirá requiriendo una estrategia de
recuperación y fiabilidad separada. La decisión de modificar el tamaño
OSD se documenta antes de editar el kernel.
