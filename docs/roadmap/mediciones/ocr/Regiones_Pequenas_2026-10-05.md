<!-- CONTEXT: scope=medicion-ocr | dependencias=roadmap/ocr/Regiones_Pequenas_Investigacion_Plan.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-180-Los-PDFs-Pesados-Se-Miden-Hasta-El-Archivo-Exportado.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,core/PDF_Engine.md,core/OCR_Engine.md,core/Regex_Engine.md,core/NER_Engine.md | audiencia=humanos+IA | fase=12 -->

# Regiones pequeñas — investigación del 2026-10-05

**Estado: caracterización limitada y arnés APPROVED por Sol 6.1,
2026-10-05. ADR-148 global REJECTED.** Este registro contiene la auditoría
y la síntesis del planificador. El candidato de 25 pt es una hipótesis
experimental; el humano autorizó después su investigación local y el
planificador escribió [ADR-202](../../../adr/ADR-202-El-Minimo-De-Region-OCR-Se-Prueba-A-25pt-Antes-De-Adoptarlo.md)
y [el plan de piloto](../../ocr/Regiones_Pequenas_25pt_Experimento_Plan.md).
La adopción definitiva y el costo del pipeline candidato siguen pendientes.

## Auditoría del filtro vigente

Fuente: `packages/anonymization-core/pdf-engine/src/pdf.engine.ts`,
constantes y funciones `isLargeEnoughImage`, `buildOccupancyGrid`,
`evaluateImageCandidate` y `detectOcrRegionFromImageRects`; contrastadas
con ADR-065 §1–§2 y `PDF_Engine.md` §12.

| Etapa | Regla vigente | Consecuencia para la investigación |
| --- | --- | --- |
| Caminos de OCR | Sin palabras nativas: página completa; con palabras: posible región | Mantener texto nativo en los casos mixtos para ejercitar admisión por región |
| Operadores de imagen | `paintImageXObject`, `paintImageMaskXObject`, `paintInlineImageXObject` | Variantes agrupadas/repetidas quedan fuera de alcance; no atribuir su omisión al mínimo por lado |
| Área de imagen | Cada rectángulo ocupa al menos 1% de la página | Varias imágenes pequeñas no suman su área para superar el filtro |
| Ocupación nativa | Grilla de página 64 × 64; bbox dilatado 0,5 veces su altura por lado horizontal y 0,8 vertical | Medir posición, cuantización y capa nativa; no basta la altura nominal de la imagen |
| Región candidata | Mayor rectángulo vacío, restringido al rango de celdas de la imagen y luego clampeado a su rectángulo | Evaluar geometría resultante, no solo la del fixture |
| Admisión | Área clampeada ≥40% del área de imagen y ambos lados ≥100 pt | Un lado de 56 pt queda excluido aunque contenga texto legible |
| Selección por página | Una sola candidata: mayor área clampeada; empates conservan la primera | Separar series con una imagen por página de controles con varias imágenes en una misma página |

El caso de ADR-148 mide 300 × 56 pt en A4 de 595 × 842 pt: ocupa
aproximadamente **3,353%** de la página, por encima del filtro de 1%.
El clampeo impide que la altura de la región supere 56 pt; por eso no puede
cumplir el mínimo por lado. Esta conclusión sobre la política no prueba
que bajar ese mínimo resuelva los demás casos del corpus.

El arnés observa regiones **retenidas**, `requiresOCR`, palabras y eventos
del documento real. El motor no expone la candidata descartada ni su
etapa de rechazo. Las causas por caso se infieren de la geometría del
fixture: un lado menor a 100 pt impide cumplir el mínimo después de
clamp, aunque la ocupación pueda haber descartado la región antes.
`proposedRegionPresented` en las series históricas es la caja de imagen
presentada para el experimento, no el resultado interno de la grilla.
No afirmar que se observaron candidatas descartadas ni causas únicas de
rechazo para casos ambiguos.

## Protocolo y separación de resultados

El plan de investigación fija corpus sintético, calidad y series de costo.
Registrar por separado admisión del producto, OCR explícito experimental
y verificación independiente del archivo exportado. El OCR forzado no
es un cambio de admisión y no convierte un E2E rojo en verde.

Windows nativo, preset Intermedio verificado, motores y assets reales,
tres repeticiones intercaladas como mínimo y ciclos frío/caliente.
Importación, render, exportación y reposo son ventanas distintas. La
validación independiente queda fuera de las ventanas de memoria del
producto. Las rutas de evidencia y los hashes identifican cada serie.

## Calidad observada

Primera tanda completada:
`.measure/ocr-small-regions/2026-10-05T15-00-14-842Z-23704/`.
Para agregados, usar `quality-baseline-forced-corrected.json`; el original
`quality-baseline-forced.json` se conserva. El arnés también fue corregido
para excluir los admitidos sin OCR forzado de sus denominadores, con
regresión que sí cuenta un miss de una operación realmente ejecutada.
175 páginas, corpus v2 con SHA-256
`e491289bae6b3953505fe04cd0bed3091a3156de23b97fe67270a8d59d0fae7c`.
Build SHA-256
`a907f264f159a4dad886f3dd3a887f5decd300b15f9c5b2472fc7fd4705f0469`.
Windows, i5-12400, 12 hilos, 16.935.129.088 bytes de RAM; Intermedio,
OCR 300 dpi, pools OCR/NER de 2, NER habilitado.

La app admitió 48 regiones. Una sesión experimental posterior a Ready
procesó las 127 restantes, sin fusionarlas al documento del producto.

- Las 30 bandas sensibles con lado menor a 100 pt devolvieron el valor
  esperado desde OCR experimental (recall bruto 30/30). El verificador
  independiente del original confirmó 17 de esos 30 controles: los otros
  13 quedan sin legibilidad independiente confirmada, no como éxitos
  definitivos. En las 42 bandas sensibles completas confirmó 20; 22 no
  cumplieron el control de lectura (15 verticales y 7 horizontales).
- Los 30 controles sin texto procesados experimentalmente produjeron
  texto espurio. Esto mide falsas lecturas de texto; no demuestra por sí
  solo falsas entidades personales.
- El fixture mixed original de ADR-148 se ejecutó sin modificar sus
  datos ni geometría: el original permite leer ambos DNI, el producto
  detecta un grupo, no admite regiones OCR y la descarga conserva el DNI
  `62.938.475` de la imagen. El DNI nativo queda sustituido.
- Los controles v2 llamados `native-duplicate` usan fuentes, cuerpos y
  orientaciones distintos entre bitmap y capa nativa. Se deben interpretar
  como capas desalineadas; no acreditan la exclusión de imágenes cuyo
  texto ya está explicado correctamente. Se añadieron controles alineados
  separados, descritos abajo.

El muestreo de heap de esta tanda forzó GC a 250 ms. Sus tiempos y memoria
se conservan como observaciones exploratorias con esa instrumentación;
no se mezclan con las series de costo a 1000 ms. La lectura independiente
de los originales queda fuera de las ventanas de memoria del producto.
La cadencia de GC no altera la distinción entre admisión real y OCR forzado.

Entre los pequeños con original confirmado, seis tienen lado de 25 pt,
seis de 50 pt, tres de 56 pt y dos de 99 pt; ninguno de 75 pt quedó
confirmado por este verificador. Eso no constituye una curva de precisión
por tamaño: fuente, cuerpo, orientación y lectura independiente varían
entre casos. Sí muestra que elegir 50 pt dejaría fuera seis controles
legibles recuperados a 25 pt, y elegir 56 pt dejaría fuera también los
seis de 50 pt. La evidencia por debajo de 25 pt es inexistente.

Auditoría adicional de originales, sin repetir pipeline ni sesión forzada:
`.measure/ocr-small-regions/2026-10-05T15-44-49-501Z-3368/`.
La unión conserva el hash de corpus anterior y usa `caseId` + hash de
imagen. Cubre 91 celdas (49 sensibles y 42 neutrales); confirma lectura
en 33 y marca 58 como inconclusas. En las 49 sensibles confirma 22,
incluidos los 17 controles pequeños ya señalados. Los cuatro valores
sensibles ausentes en regiones admitidas se registran por separado:
`h125-vertical-d150-sensitive`, `area-1.00`, `area-1.01`, `rotation-180`.
Su falta de lectura no se atribuye al filtro de 100 pt; la confirmación
del original y las limitaciones del verificador se evalúan antes de
clasificarlos como pérdidas válidas. La ausencia de confirmación no
demuestra que una imagen sea ilegible para una persona.

Derivado corregido sin volver a ejecutar OCR:
`.measure/ocr-small-regions/2026-10-05T16-22-12-844Z-20180/joined-prior-quality-source-legibility-corrected.json`.
La unión histórica etiquetaba como `CONFIRMED_SOURCE_FORCED_MISS` tres
bandas admitidas y dos controles de grilla: no habían tenido OCR forzado
y el texto del producto sí contenía el DNI. El derivado conserva el
original y separa `NOT_FORCED_PRODUCT_ADMITTED`, campos forzados `null`
y lectura del producto. Hay 31 casos sensibles efectivamente forzados;
ningún miss forzado con original confirmado. Los cuatro valores ausentes
en salida admitida se conservan como observaciones del pipeline actual.
No usar el campo histórico `falsePositive` de `scoreOcrText` como una
métrica de entidades: con truth numérico vacío solo indica texto no
vacío, incluso en entradas neutrales cuyo texto era esperado.

## Controles alineados adicionales

Tanda independiente de 12 páginas:
`.measure/ocr-small-regions/2026-10-05T15-40-35-559Z-22228/`.
Generador `aligned-pdf-text-raster-controls-v1`, SHA-256
`a4074d8d23f45f5ecd198484c05274df8ca5072d293642cce23f2cce28259d0c`.
Bandas de 56/125 pt, horizontales/verticales y fuentes de 150/200/300 dpi.
La imagen se rasteriza desde un PDF de texto y la capa nativa invisible
repite el mismo recurso de fuente, cuerpo, origen y comando de rotación.

El reporte confirma extracción de las 12 capas, lectura independiente
del valor y lectura OCR experimental de los 12 DNI. Con la política
vigente, el producto llega a Ready con 0 regiones, 0 eventos OCR y 1 grupo
para el mismo DNI repetido. Esto verifica el control bajo la política
actual; no prueba aún la exclusión bajo un mínimo por lado distinto.

Se conservan los intentos fallidos del instrumento: un control inicialmente
blanco por recurso de fuente de otro documento y un argumento no
serializado hacia `page.evaluate`. No son corridas válidas de producto.
El campo histórico `h125NoRegionPageIndexes` de esta evidencia tiene
nombre incorrecto: calcula páginas de 125 pt **con** región, por eso vale
`[]`. Los campos globales `ocrRegions=[]` y `ocrEvents=[]` acreditan la
ausencia de OCR en esta tanda.

## Control dirigido de entidades con motores reales

Evidencia:
`.measure/ocr-small-regions/2026-10-05T16-37-17-016Z-25608/isolated-regex-ner-audit-corrected.json`.
El original `isolated-regex-ner-audit.json` se conserva; el derivado
renombra el supuesto «patrón activo» como coincidencia Regex observada
y separa texto esperado del neutral de texto espurio del blanco.
Corpus adicional de tres controles de 300 × 56 pt a 300 dpi, SHA-256
`9102a784d16826f4d6ca267ccf2dcdaf21c6218a5700b92c4230b8d487f1c314`.
Una prueba dirigida pasó, gate de 10,8 s. El formato histórico conserva
texto y conteos, no las `Word[]` completas: por eso este control ejecuta
OCR dirigido y conserva palabras exactas y geometría antes de llamar
Regex/NER reales inicializados por la app.

Intermedio, NER habilitado, modelo
`Xenova/bert-base-multilingual-cased-ner-hrl`, cuantización q8 y batch 256.
Cada entrada usa ID experimental que no existe en el Orchestrator. Los
documentos del producto permanecen 1 → 1; las palabras y ocurrencias
experimentales no se fusionan al pipeline ni se exportan.

| Entrada OCR dirigida | Regex | NER | Lectura del resultado |
| --- | --- | --- | --- |
| `DNI 34567891` | 1 DNI esperado, 0 falsos positivos | 0 ocurrencias | El DNI llega a una entidad real en este control aislado |
| `REGION PUBLICA` | 0 ocurrencias | 1 ADDRESS espuria, confianza 0,999192 | Hay riesgo de sustitución innecesaria aunque el OCR lea las palabras correctas |
| Blanco con formas, 51 palabras OCR espurias | 0 ocurrencias | 0 ocurrencias | Texto espurio no implica necesariamente entidad espuria |

Los originales de estos tres controles **no tuvieron verificación
independiente de legibilidad**; se registran como inconclusos para una
afirmación de recuperación desde el original. La tabla mide la respuesta
de los detectores a las palabras exactas del OCR dirigido; no es recall
de detección validado sobre todo el corpus, ni evidencia de export bajo
una política nueva. No extrapolar la ausencia de entidades espurias del
blanco a los otros 30 blancos históricos. La falsa entidad del neutral
sí requiere un control explícito en el prototipo.

## Resultados de costo y decisión

Campaña canónica de costo:
`.measure/ocr-small-regions/2026-10-05T16-05-42-838Z-7312/`, resumen
corregido `memory-campaign-summary-corrected.json` y 12 series
`memory-round-*.json`. El original `memory-campaign-summary.json`
se conserva sin modificar.
Las 12 pasaron; duración del gate 14,3 minutos. Los timestamps crudos
confirman **nueve series intercaladas de 1/10/50 bandas, seguidas por tres
series consecutivas de 50 imágenes en una página**. El resumen histórico
`interleavedOrder` declara otro orden: no debe usarse como orden observado.
Los tres casos de una sola página son observaciones adicionales en bloque;
no cumplen el requisito de intercalado entre las cuatro distribuciones.
El build antes citado y el hash de fixture se mantienen en las tres
repeticiones de cada perfil. Cada serie
abre la app, importa, renderiza todas las páginas anonimizadas, descarga
un export y cierra el documento; repite la operación con la app abierta.
Los 12 baselines verifican Intermedio, NER habilitado, 0 regiones y 0
eventos OCR. El evento real `EXPORT_REQUESTED` confirma JPEG, calidad
0,92 y 150 dpi. No son baselines de una política modificada.

La revisión detectó ese error de cronología. El derivado ordena por
`productBaseline.cold.phases.import.startEpochMs` de cada archivo crudo,
con rank y referencia al raw. No repara retrospectivamente el diseño
del bloque final. El scheduler de **futuras** campañas fue corregido
para intercalar los cuatro perfiles en cada una de tres rondas; una
regresión sin Electron verifica los 12 casos únicos y sus ranks.

Después del baseline, cada serie ejecuta dos sesiones experimentales de
OCR sobre las imágenes excluidas, sin fusionar sus palabras al producto.
Los workers OCR se liberan después de **cada** sesión: la reapertura
caliente conserva la app, pero vuelve a cargar el motor; no significa
modelo OCR residente. Son 24 sesiones experimentales independientes.

Valores en **MB decimales** (1 MB = 1.000.000 bytes), mediana y rango
mínimo–máximo entre tres repeticiones. RSS representa la suma del working
set del árbol Electron; no equivale a heap JS ni memoria privada.

| Perfil | Píxeles por sesión forzada | Ready frío/caliente, mediana ms | Pico baseline, MB | OCR forzado frío, ms | OCR forzado caliente, ms | Pico forzado frío, MB | Pico forzado caliente, MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 banda, 1 página | 291.250 | 1.491 / 1.246 | 1.704 (1.606–1.719) | 995 (916–996) | 748 (704–749) | 870 (855–906) | 852 (847–858) |
| 10 bandas, 10 páginas | 2.912.500 | 1.832 / 1.616 | 1.885 (1.783–2.030) | 1.467 (1.433–1.656) | 1.158 (1.134–1.361) | 1.195 (1.077–1.254) | 1.182 (1.058–1.206) |
| 50 bandas, 50 páginas | 14.562.500 | 2.562 / 2.235 | 1.887 (1.874–1.896) | 3.359 (3.206–3.822) | 2.880 (2.872–3.000) | 1.263 (1.247–1.268) | 1.226 (1.185–1.233) |
| 50 imágenes, 1 página | 868.400 | 1.472 / 1.241 | 1.701 (1.636–1.845) | 1.605 (1.595–1.625) | 1.389 (1.347–1.393) | 993 (982–1.110) | 945 (932–1.067) |

Las bandas de una por página miden 300 × 56 pt. Las 50 imágenes de una
sola página miden 40 × 25 pt cada una: ocupan aproximadamente 0,200% de
A4, por debajo del filtro de área del 1%. Esa última serie ejercita costo
experimental y distribución, pero no modela candidatos admitidos por
una reducción exclusiva del mínimo por lado. Tampoco procesa la misma
cantidad de píxeles que las 50 bandas. No atribuir su exclusión solo al
mínimo ni deducir escalamiento por cantidad sin considerar la geometría.

Los picos de las ventanas del **producto actual**, en MB, quedan
separados de los del experimento. Aquí se muestran medianas; hay tres
observaciones por celda salvo el render caliente de una banda (solo una).

| Perfil | Import frío/caliente | Render frío/caliente | Export frío/caliente | Reposo frío/caliente |
| --- | ---: | ---: | ---: | ---: |
| 1 banda | 1.511 / 1.704 | 1.390 / 1.560 (n=1) | 1.563 / 1.638 | 1.481 / 1.567 |
| 10 bandas | 1.519 / 1.851 | 1.719 / 1.885 | 1.694 / 1.875 | 1.578 / 1.740 |
| 50 bandas | 1.572 / 1.887 | 1.675 / 1.759 | 1.666 / 1.735 | 1.574 / 1.580 |
| 50 imágenes en 1 página | 1.541 / 1.701 | 1.448 / 1.576 | 1.526 / 1.636 | 1.487 / 1.569 |

No hay una fase máxima universal. En 10 bandas, ronda 3, el pico global
es render caliente: 1.884.954.624 bytes frente a 1.850.945.536 de import.
En una banda, ronda 2, el pico global es export caliente:
1.605.844.992 bytes frente a 1.589.780.480 de import. Otras series sí
tienen el mayor pico en importación. Estos casos refutan la suposición
de que el máximo siempre ocurre al cargar, sin predecir otros documentos.

### Límites del instrumento y de la conclusión

- RSS se muestrea a 150 ms. Dos ventanas de render caliente no contienen
  muestras y conservan `null` con causa; no son cero. Los máximos breves
  entre muestras pueden quedar sin observar.
- Heap se muestrea a 1.000 ms mediante CDP con GC forzado. Esto puede
  afectar tiempos y memoria; las series son comparables entre sí bajo
  ese instrumento, no mediciones sin perturbación. Las etiquetas de
  workers tienen los límites de atribución del helper de ADR-146.
- Windows no dispone de lector de presión implementado: 12/12 reportan
  indisponibilidad. `os.freemem()` al inicio y al final es una observación
  del host; no demuestra ausencia de presión ni atribuye cambios a OCR.
- El pico forzado se mide después de Ready y del baseline. **No es un
  delta sumable al baseline**, ni el pico futuro de un pipeline que
  admita esas imágenes. Que sea menor tampoco acredita ahorro.
- Se conserva el intento dirigido fallido por el backdrop del diálogo
  tras descargar; se corrigió su cierre con «Listo». La corrida dirigida
  posterior pasó antes de lanzar la campaña canónica. Los intentos
  fallidos no se mezclan con las tres repeticiones válidas.
- El corpus es sintético, Windows y un equipo. No acredita macOS,
  documentos reales, límites de perfiles P1/P2 ni un cambio de runtime.
- Las tres series de 50 imágenes en una página se ejecutaron juntas al
  final. Su mediana/rango describen ese bloque; no controlan deriva
  temporal frente a los otros perfiles. La futura campaña del prototipo
  debe intercalar efectivamente todas las distribuciones y generar el
  resumen desde timestamps observados.
- La presencia del DNI en texto OCR forzado del corpus de 175 páginas no
  acredita detección final Regex/NER ni sustitución en un export
  modificado. El control dirigido de tres entradas mide detectores, pero
  no completa recall/precisión de entidades en el corpus completo. Las
  falsas lecturas de texto no equivalen a falsas entidades personales.

## Alternativas para la política

| Alternativa | Evidencia favorable | Qué falta antes de implementarla |
| --- | --- | --- |
| Mantener 100 pt | Evita costo de las regiones descartadas y conserva el control nativo alineado | Aceptar explícitamente la fuga conocida; ADR-148 mixed seguiría rechazado |
| Reducir mínimo por lado, conservando los otros filtros | 17/17 originales pequeños confirmados recuperan el DNI en OCR forzado; incluye la banda mixed | Definir candidato experimental, comprobar admisión real, entidades, blancos y capas alineadas bajo ese candidato; medir el pipeline completo |
| Agregar criterio de contenido además de geometría | Los 30 blancos producen texto espurio y muestran la necesidad de evaluar precisión | Diseñar y medir la regla sin descartar texto sensible ni convertir una heurística de calidad en falsa garantía |

La recomendación del planificador es avanzar con un **prototipo acotado
de admisión por geometría**, sin quitar filtros de área/ocupación, sin
ampliar a múltiples regiones por página ni cambiar DPI o pools. Los
puntos 25/50/56/75/99 pt fueron mediciones: todavía no justifican elegir
un umbral definitivo. Como candidato experimental propongo **25 pt por
lado**, el menor punto medido con originales sensibles confirmados;
permite contrastar los seis controles de 25 pt que un candidato de 50 pt
seguiría excluyendo. Esto es una hipótesis a probar, no una aceptación
de costo ni un umbral para publicar. El primer control obligatorio es que el candidato
admita la región mixed de 56 pt y preserve la exclusión de las capas
alineadas. Después debe demostrar entidades y export real, y pasar una
comparación intercalada del pipeline completo con los presupuestos
vigentes. Los casos de 0,2% y los operadores agrupados siguen fuera de
ese alcance.

La revisión independiente distingue aprobación de estas
observaciones de aprobación de una política o del PR ADR-148. El humano
decide el costo y riesgo aceptados; el planificador escribe el ADR
experimental y las specs antes de delegar código de producto. ADR-148
continúa rechazado mientras su export mixed conserve el DNI de imagen.

## Cierre de revisión Sol 6.1

Primera revisión de investigación: REJECTED por dos P2 del arnés,
denominador de OCR forzado que incluía operaciones ausentes y resumen
que declaraba una cronología distinta de los raws. Luna corrigió ambos,
añadió regresiones pequeñas y conservó originales; no repitió campañas.

Revisión final: **caracterización limitada y arnés APPROVED**, sin nuevos
hallazgos. Sol verificó los 12 timestamps contra raws, orden ascendente
y las tres same-page al final. El derivado de calidad mantiene intactos
build/corpus/baseline/OCR/raster/heap/windows y coincide con la unión:
17 intentos confirmados, 17 recuperaciones, cinco admitidos sin OCR
forzado. El scheduler futuro intercala los cuatro perfiles; no repara
el intercalado histórico. Checks propios de Sol: Prettier, ESLint scoped,
TypeScript, 6/6 unit tests y `git diff --check`, verdes.

**ADR-148 global sigue REJECTED por P1 mixed.** No se repitieron Electron,
las 21 filas ni R-16 global en esta revisión. No hay aprobación de merge,
de política nueva ni del costo del pipeline futuro. Sol consideró 25 pt
defendible únicamente como hipótesis experimental, con los límites de
fuente, entidades, redundancia y memoria documentados arriba.
