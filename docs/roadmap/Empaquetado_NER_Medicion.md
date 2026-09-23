<!-- CONTEXT: scope=roadmap-medicion | tarea=punto-1-memoria | dependencias=roadmap/Optimizacion_De_Memoria_Plan.md,adr/ADR-173-El-Empaquetado-De-NER-Se-Evalua-Sin-Cambiar-El-Modelo.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-147-Perder-Un-Identificador-Cubierto-Es-Una-Regresion.md,tests/perf/README.md | audiencia=planificador+humano | fase=11 -->

# Punto 1 de memoria — evaluación del empaquetado de NER

Ejecutada el 2026-09-23 sobre el commit `3aac21fa609fe7cdb4dcdf35eea6e1d78ffc51ea`.
El brazo A sirvió el ONNX Q8 fijado; B sirvió el mismo grafo y pesos con datos
externos según ADR-173. El parche de carga de B se aplicó solo al build
experimental y se revirtió; el producto y `assets.lock.json` permanecen en A.

Datos crudos de la tanda decisiva: `.measure/ner-packaging-adr173/runs/20260923T150732Z/`.
La tanda anterior, `.measure/ner-packaging-adr173/runs/20260923T052601Z/`,
respalda la repetición de WASM y del pico frío. Su antiguo campo `m1Bytes`
restaba el pico de una base fría y **no es M1** de ADR-146; solo se usa como
delta frío. La tanda decisiva agregó `measureProfile` con base caliente y M1
oficial.

## Decisión

**Se conserva A.** B redujo la memoria lineal WASM observada del pool NER en
los tres pares, pero no demostró una reducción de RSS mayor que la deriva de
los controles A repetidos. El M1 caliente cambió de signo entre parejas y el
pico posterior a `Ready` fue mayor en B en las tres. ADR-173 §5 exige una señal
consistente y mayor que la dispersión antes de adoptar el candidato. El banco
queda disponible para repetir la evaluación bajo menor presión de memoria y
con R1 si se dispone de él; esa repetición sería una nueva decisión, no una
adopción implícita.

## Compatibilidad y calidad

- A y B cargaron en el shell Electron con assets `app://`, Chromium/WASM y
  workers reales. Los dos completaron 26/26 documentos del corpus de referencia
  con `Ready` y sin requests externos. B emitió `NER_MODEL_READY`.
- A pasó la baseline versionada de ADR-147. En ambos brazos hubo 78 entidades
  esperadas, 74 cubiertas y 18 falsos positivos. B no perdió cobertura ni
  añadió falsos positivos. Las ocurrencias NER coincidieron exactamente por
  documento en página, tipo, valor, normalización, confidence y geometría.
- La baseline A se promovió manualmente tras dos candidatos idénticos byte por
  byte; el comparador oficial aceptó la segunda. Su 74/78 es un control de no
  regresión, **no** equivale a alcanzar los objetivos absolutos del MVP.

## Medición intercalada

Tres parejas P2 de 50 páginas escaneadas, en orden A/B, B/A, A/B. Todas
terminaron con 11 grupos y 13 entidades en el perfil medido. MB decimales
(1 MB = 1.000.000 bytes); el archivo crudo conserva bytes y series temporales.
En las columnas de diferencia, **A − B positivo** indica menos memoria en B.

| Par | WASM NER cargado A / B | M1 caliente A / B (A − B) | M2 caliente A / B (A − B) | Pico post-Ready A / B (A − B) |
| --- | ---: | ---: | ---: | ---: |
| 1 A/B | 487 / 233 | 171,3 / 235,7 (**−64,4**) | 2402,9 / 2280,2 (+122,6) | 1685,1 / 1704,9 (**−19,8**) |
| 2 B/A | 487 / 233 | 429,9 / 281,3 (+148,6) | 2169,1 / 2085,3 (+83,8) | 1619,8 / 1678,3 (**−58,4**) |
| 3 A/B | 487 / 233 | 451,3 / 307,9 (+143,4) | 2190,5 / 2130,6 (+59,8) | 1311,4 / 1621,3 (**−309,8**) |

La lectura WASM observó 487.194.624 bytes con A y 232.652.800 bytes con B:
**254.541.824 bytes menos**, reproducidos en 3/3 pares. Es memoria lineal de
WASM del target NER observado; no se resta de RSS ni se interpreta como ahorro
total del árbol. Las lecturas de heap de tres pthreads estuvieron ocupadas en
el punto sostenido de cada corrida; el target padre con `WebAssembly.Memory`
sí respondió. Las series y los errores de lectura quedaron en los JSON.

Los controles A idénticos dieron M2 caliente de 2402,9, 2169,1 y 2190,5 MB:
**233,8 MB de rango**, mayor que la ventaja pareada de B (59,8–122,6 MB).
La memoria libre al inicio del perfil caliente osciló y había entre 2,5 y
2,8 GB de swap usado. El costo mediano de cada sonda WASM/heap fue
aproximadamente 0,35 s, frente a 0,004–0,005 s para RSS; ambos brazos usaron
el mismo instrumento. Esta presión y la deriva limitan la atribución de RSS.

La duración `NER_MODEL_LOADING→NER_MODEL_READY` fue A/B 914/855, 885/1007 y
872/879 ms; `import→Ready` fue 17.683/18.104, 18.135/18.331 y
18.109/18.085 ms. No hay una mejora temporal uniforme. La tanda guardó
también el nivel sostenido con modelo cargado y después de la ventana de baja
por inactividad de 15 s; esas muestras no se suman a la diferencia WASM.

## Alcance

R1 no estaba disponible en este entorno. La prueba de calidad usa el corpus
sintético completo; la medición de recursos usa P2. No se declara una señal
representativa de documentos reales ni de Windows. Ningún cambio de assets o
del kernel normal se autoriza a partir de este informe.
