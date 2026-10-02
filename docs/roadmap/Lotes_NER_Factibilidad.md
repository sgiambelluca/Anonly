<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Optimizacion_De_Rendimiento.md,core/NER_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (punto 3, factibilidad macOS 2026-09-24 y Windows nativo 2026-09-25; adopción bloqueada en ambas) -->

# Lotes de fragmentos NER — factibilidad en macOS y Windows nativo

## Resultado

**No adoptar el procesamiento por lotes medido.** En R1 y R2 reales aparecieron
diferencias de etiquetas de tokens, geometría de entidades y cruces del umbral
de confianza 0,7 entre inferencias individuales y por lote. Además, el lote de
cuatro fragmentos no fue más rápido en la mediana de ninguno de los dos
documentos. El lote con longitudes dispares fue mucho más lento por padding.
La factibilidad de API quedó acreditada, pero la equivalencia de salida y la
ganancia en estos documentos no.

La medición compara **muestras de fragmentos**, no una importación completa
con Grouping: no mide `Ready` ni el orden efectivo de eventos al cambiar el
motor. No se modificó el producto. El resultado bloquea la propuesta actual;
cualquier variante futura necesita explicar y superar primero las diferencias
de calidad, además de medir memoria temporal y el recorrido completo.

## Banco

Se probó la versión instalada de Transformers.js en Electron/Chromium/WASM
con el mismo modelo ONNX del producto. El banco interceptó los jobs NER de la
importación normal dentro del renderer, liberó el worker de producto y comparó
llamadas individuales y en lote sin escribir texto al disco. R1/R2 se pasaron
mediante `ANONLY_REAL_DOC_R1/R2`; a Node salieron solo contadores, tiempos y
métricas de comparación. Los artefactos ignorados por Git están en
`.measure/ner-batch/synthetic-final/synthetic.json` y
`.measure/ner-batch/real-20260924T-final/real.json`. Los scripts reproducibles
están en `tests/perf/`.

La muestra por documento tiene cuatro escenarios: dos o cuatro fragmentos con
longitudes más cercanas disponibles y dos o cuatro de longitudes dispares.
Cada escenario alternó el orden individual/lote en tres rondas. Los tiempos
son de inferencia de **esa muestra** con modelo ya cargado, en ms; no deben
sumarse ni extrapolarse directamente al total de NER. La sonda registró heap JS
antes/después, pero no el pico temporal WASM de cada lote.

| Documento | Jobs NER | Caracteres totales / mediana por job | Palabras totales / mediana por job | Tokens mediana / máximo | Jobs fuera de 508 tokens |
|---|---:|---:|---:|---:|---:|
| R1 real nativo | 87 | 83.686 / 1.316 | 14.287 / 249 | 374 / 503 | 0 |
| R2 real escaneado | 36 | 33.654 / 743 | 5.581 / 127 | 198 / 426 | 0 |

Los jobs no equivalen a páginas: el producto partió el texto de R1 en 87 jobs
y el de R2 en 36. Esta tabla muestra carga textual efectiva, que pesa más que
comparar solo 50 frente a 20 páginas. Ningún job real sobrepasó el límite, por
lo que el caso de sublotes internos por ADR-098 solo pudo probarse con un texto
sintético de 1.725 tokens: cortarlo a 508/508/508/207 conservó la cola; pasar
el texto entero con `truncation` la perdió tras 511 tokens.

## Tiempo de las muestras reales

Mediana de tres rondas; `Δ` es lote frente a individual. «Cercanos» significa
la mejor selección disponible en el documento: en R2 los cuatro elegidos aún
abarcaron **153–375 tokens** y requirieron 471 posiciones de padding, de modo
que ese escenario no demuestra el efecto de cuatro longitudes homogéneas.

| Documento y muestra | Individual | Lote | Δ |
|---|---:|---:|---:|
| R1, 4 cercanos (368–402 tokens) | 2.080 ms | 2.160 ms | +3,8 % |
| R1, 4 dispares (3–433) | 1.274 ms | 2.461 ms | +93,2 % |
| R1, 2 cercanos (392–402) | 1.170 ms | 1.168 ms | −0,2 % |
| R1, 2 dispares (3–433) | 654 ms | 1.288 ms | +96,9 % |
| R2, 4 más cercanos (153–375) | 1.413 ms | 2.569 ms | +81,8 % |
| R2, 4 dispares (24–426) | 1.669 ms | 2.543 ms | +52,4 % |
| R2, 2 cercanos (153–198) | 503 ms | 571 ms | +13,5 % |
| R2, 2 dispares (24–416) | 681 ms | 1.262 ms | +85,2 % |

La primera ronda tiene costo de calentamiento visible en varios escenarios;
la mediana reduce ese efecto, pero solo hay tres rondas por muestra. La MacBook
Air no tiene ventilador ni sensor térmico en el banco. Se usó `caffeinate` y
no se observó suspensión en esta tanda; el margen de memoria libre bajó de
aproximadamente 78 % a 73 %.

**Repetido en Windows nativo el 2026-09-25 — ver sección al final del
documento.** Mismo bloqueo de adopción, con diferencias de mismatch por
documento.

## Calidad y alcance

La API devolvió un elemento por fragmento. Los fixtures sintéticos conservaron
los spans geométricos y no cruzaron 0,7, aunque las puntuaciones variaron; R1 y
R2 mostraron diferencias que el fixture no anticipó:

- R1, cuatro fragmentos más cercanos: **2 etiquetas de token diferentes**, **1
  diferencia geométrica de span** y **1 cruce de 0,7**. Los escenarios dispares
  también tuvieron una diferencia geométrica y un cruce.
- R2, cuatro fragmentos más cercanos: **12 etiquetas de token diferentes**, **9
  diferencias geométricas de span** y **1 cruce de 0,7**. Cuatro dispares
  tuvieron una etiqueta y un span diferentes.

Estas cifras son por escenario y pueden involucrar fragmentos repetidos entre
escenarios; no son un recuento de entidades únicas perdidas en el documento.
No se inyectó la salida experimental a Grouping, así que tampoco se afirma
equivalencia de agrupaciones. La comparación no incluyó un control de
variabilidad individual contra individual: el banco establece **diferencias
observadas**, sin atribuir todavía su causa al padding, runtime o numerics del
modelo. Esta limitación no reduce el bloqueo de adopción: la equivalencia
exigida no quedó demostrada.

## Próximo paso si se reconsidera

Primero aislar la variabilidad de inferencia con controles repetidos y estudiar
por qué cambian las etiquetas y los spans bajo batch. Solo si se conserva la
salida semántica, diseñar el batching de sublotes de un mismo job y medir
`Ready`, orden hacia Grouping, cancelación y memoria temporal. Agrupar jobs de
distintas páginas exigiría antes un ADR, contrato y spec de protocolo. Los ADR
168–178 están reservados por otra tarea y no se usarán aquí.

---

## Repetición Windows nativo (2026-09-25)

> Commit `ee5eeba` (`hardening/plan-2026-09`), Windows 11 Pro build 26200,
> i5-12400, 16,9 GB RAM, nativo (Git Bash, no WSL). Mismo protocolo y misma
> app instrumentada (`tests/perf/ner-batch-real.mjs`, `NO_BUILD=1` sobre el
> `dist` ya construido para la campaña de hilos NER de este equipo).

### Resultado — mismo bloqueo, mismas señales de mismatch

**Confirma el veredicto de macOS: no adoptar.** En los dos documentos reales
aparecieron diferencias de etiqueta de token, geometría de span y cruces del
umbral 0,7 entre inferencia individual y por lote — igual que en la Mac,
aunque con magnitudes distintas. El lote de cuatro fragmentos tampoco fue más
rápido en la mediana de ningún escenario, y los lotes con longitudes dispares
sufrieron el mismo costo de padding.

### Bug de portabilidad encontrado y corregido

`tests/perf/ner-batch-real.mjs:20` usa `` source.match(/const probe = `([\s\S]*?)`;\nconst build/) ``
para extraer un fragmento de `ner-batch-feasibility.mjs`. Ese archivo está
commiteado con **CRLF** (`core.autocrlf=true` en esta copia Windows), así que
el `\n` literal del regex no matcheaba `\r\n` y la campaña fallaba de
inmediato con «Synthetic browser probe source not found», antes de abrir
Electron. Se corrigió a `` \r?\n `` — inocuo en Unix, donde `\r?` matchea
cero apariciones. El fix entró en `45d07fd`, y desde el 2026-09-26
`.gitattributes` fija `eol=lf`, así que la copia de Windows tampoco escribe
CRLF.

### Datos de entrada (idénticos en carga a los de macOS)

| Documento | Jobs NER | Caracteres totales / mediana por job | Palabras totales / mediana por job | Tokens mediana / máximo | Jobs fuera de 508 |
|---|---:|---:|---:|---:|---:|
| R1 real nativo | 87 | 83.686 / 1.316 | 14.287 / 249 | 374 / 503 | 0 |
| R2 real escaneado | 36 | 33.638 / 738 | 5.573 / 127 | 196 / 426 | 0 |

Prácticamente igual a macOS (83.686/1.316 y 33.654/743) — mismo texto
extraído del mismo PDF, jobs NER coinciden 87/36. Ningún job real cruzó 508
tokens; el caso de sublote interno por ADR-098 sigue sin ejercitarse con
datos reales en ninguna de las dos plataformas.

### Tiempo de las muestras reales (mediana de 3 rondas)

| Documento y muestra | Individual | Lote | Δ | Δ macOS (referencia) |
|---|---:|---:|---:|---:|
| R1, 4 cercanos (368–402 tokens) | 1.574 ms | 1.589 ms | +0,9 % | +3,8 % |
| R1, 4 dispares (3–433) | 930 ms | 1.765 ms | +89,8 % | +93,2 % |
| R1, 2 cercanos (392–402) | 817 ms | 824 ms | +0,9 % | −0,2 % |
| R1, 2 dispares (3–433) | 450 ms | 876 ms | +94,5 % | +96,9 % |
| R2, 4 más cercanos (154–377) | 1.069 ms | 1.492 ms | +39,6 % | +81,8 % |
| R2, 4 dispares (24–426) | 1.011 ms | 1.695 ms | +67,5 % | +52,4 % |
| R2, 2 cercanos (154–196) | 349 ms | 350 ms | +0,0 % | +13,5 % |
| R2, 2 dispares (24–416) | 481 ms | 835 ms | +73,6 % | +85,2 % |

La CPU de escritorio es más rápida en términos absolutos (todos los tiempos
individuales quedan por debajo de los de la Mac), pero la **dirección** es
igual: los escenarios dispares castigan mucho más que los cercanos por
padding, y ningún escenario de cuatro fragmentos ganó tiempo con lote. Los
porcentajes no coinciden exactamente entre plataformas — es un modelo ONNX
corriendo sobre WASM con runtimes/threading distintos — pero ninguna
plataforma muestra una ganancia de lote que justifique adoptarlo.

### Calidad — mismatches por escenario (Windows)

- R1, cuatro fragmentos más cercanos: **2 etiquetas de token diferentes**, **1
  diferencia geométrica de span**, **1 cruce de 0,7** (macOS: 2/1/1 — igual).
- R1, cuatro dispares: **1 etiqueta**, **1 span**, **1 cruce** (macOS: sin
  desglose separado, reportó geometría+cruce presentes — consistente).
- R2, cuatro fragmentos más cercanos: **10 etiquetas de token diferentes**,
  **3 diferencias geométricas de span**, **2 cruces de 0,7** (macOS: 12/9/1 —
  mismo orden de magnitud, no idéntico).
- R2, cuatro dispares: **2 etiquetas**, **2 spans**, **1 cruce** (macOS: 1/1/0
  aproximado).

Las cifras exactas difieren entre plataformas — esperable, dado que son
numerics de punto flotante bajo WASM con paths de ejecución distintos — pero
**la conclusión no cambia en ninguno de los dos documentos ni en ninguna de
las dos máquinas**: hay mismatches reales de etiqueta, geometría y umbral de
confianza entre individual y lote. El bloqueo de adopción queda confirmado
de forma independiente en una segunda plataforma.
