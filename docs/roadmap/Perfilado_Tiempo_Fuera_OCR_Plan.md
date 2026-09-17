<!-- CONTEXT: scope=perfilado-tiempo-fuera-ocr | dependencias=roadmap/Margenes_Menos_Pixeles_Medicion_I1.md,roadmap/Margenes_Menos_Pixeles_Medicion_I2.md,architecture/07_Performance_Strategy.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md | audiencia=planificador+humano | fase=11 -->

# Tiempo fuera de OCR — plan de medición

Estado: **planificado, sin corridas nuevas ni cambio de producto** (2026-09-17).

## 1. Decisión y pregunta

La campaña de **optimización de tiempo del OCR** queda cerrada por ahora: I-1
se conserva, I-2 se midió y se descartó, I-3 no se activa y T-6b (bajar el
DPI configurado) queda en pausa. Se conserva `ocr.dpi: 300`; el cap
conservador por resolución nativa de T-6a (ADR-163) sigue vigente. Este
cierre no sustituye las verificaciones de calidad y los gates de release
pendientes del Hito 11.

El próximo trabajo busca responder: **¿en qué tramos transcurre el tiempo de
importación a `Ready` que queda fuera de `OCR_STARTED → OCR_FINISHED`, y cuál
ofrece una mejora perceptible sin reducir detección?** No se elige una
implementación antes de tener esa atribución.

La campaña I-1 dejó, en P2 de 50 páginas escaneadas, tres sesiones con I-1:

| Condición | `DOCUMENT_IMPORTED → PIPELINE_READY` medio | OCR medio | Diferencia media |
| --- | ---: | ---: | ---: |
| Fría | 17,365 s | 11,557 s | **5,807 s** |
| Caliente | 16,264 s | 12,070 s | **4,195 s** |

Fuente: `Margenes_Menos_Pixeles_Medicion_I1.md` y las tres salidas
`after-p2-*/session.json` de
`.measure/margenes-i1-v2/20260917-reproducible/`. La diferencia es un
**residuo aritmético**, no el tiempo de un motor. Contiene trabajo anterior
y posterior al OCR. Las duraciones históricas se registraron con
`Date.now()`; la campaña nueva medirá los intervalos de tiempo con
`performance.now()` en el mismo renderer.

## 2. Alcance y orden

1. **M-0 — Reconstruir la línea base.** Fijar commit, hashes del build y de
   los fixtures, configuración y versión de assets. Registrar las seis
   corridas P2 anteriores como contexto, sin mezclarlas con la serie nueva.
2. **M-1 — Descomponer el camino completo.** Medir el timeline de eventos
   del producto actual, sin modificaciones en `packages/**`, en P2 y en el
   control de texto nativo P1. Correr tres sesiones independientes por
   fixture, cada una con importación fría → cerrar documento → importación
   caliente en la misma instancia de Electron. Agregar P2-dense si P2 deja
   incierto el costo de detección por poca densidad de entidades; usar su
   fixture congelado antes del proceso medido.
3. **M-2 — Atribuir el tramo dominante.** Solo si M-1 muestra un tramo
   estable y relevante, instrumentar temporalmente sus puntos internos.
   Preservar el patch, sus hashes y los logs; revertirlo y verificar el
   árbol al terminar. Esta medición sigue siendo diagnóstico, no una
   optimización de producto.
4. **M-3 — Elegir candidato.** Ordenar oportunidades por tiempo absoluto,
   porcentaje del total, consistencia entre frío/caliente y efecto en P1.
   Si una oportunidad justifica intervención, escribir su ADR y handoff
   por módulo, luego hacer A/B real y controles de calidad. Si ninguna
   sobresale del ruido, cerrar el perfilado sin cambiar código.

## 3. Instrumento y tramos

Reusar el shell de Electron y el ciclo de sesión de `tests/perf/`, con
`VITE_E2E=1`, un solo worker de Playwright, retries 0 y ningún test de carga
en paralelo. El colector de eventos de `tests/perf/support/memoryProfile.ts`
ya captura las marcas principales; el arnés de **tiempo** agregará
`REGEX_FINISHED` y `NER_STARTED`. Guardará por corrida las marcas crudas
de `performance.now()` en el renderer y un JSON en `.measure/`. Evitar el
muestreo continuo de RSS/heap en la serie principal de tiempo; comparar
una serie A/A con el colector mínimo frente al arnés existente para
estimar cuánto perturba la instrumentación. `Date.now()` se reserva para
alinear muestras de memoria cuando haga falta, no para restar tramos breves.

| Intervalo observable | Interpretación permitida |
| --- | --- |
| `DOCUMENT_IMPORTED → DOCUMENT_PARSED` | Importación y parseo PDF hasta el evento de finalización. |
| `DOCUMENT_PARSED → OCR_STARTED` (P2) | Preparación entre PDF y OCR; incluye cargar el documento en Render y trabajo previo al evento de inicio OCR. **No** llamarlo tiempo de PDF. |
| `OCR_STARTED → OCR_FINISHED` (P2) | OCR completo, control para reconciliar con I-1; no es objetivo de esta campaña. |
| `OCR_FINISHED → REGEX_FINISHED` (P2) | Preparación de detección y Regex, con el costo de los listeners síncronos que se disparen durante el tramo. |
| `DOCUMENT_PARSED → REGEX_FINISHED` (P1) | Render previo a detección, preparación y Regex: intervalo compuesto que M-2 separará si pesa. |
| `REGEX_FINISHED → NER_STARTED` | Construcción de insumos y transición a NER; un resultado pequeño puede caer bajo la resolución útil. |
| `NER_STARTED → PIPELINE_READY` | NER, agrupación y cierre del pipeline **en conjunto**; requiere M-2 para atribuir internamente. |

La igualdad que debe cerrar **en cada corrida P2** es:

`importado→Ready = importado→inicioOCR + inicioOCR→finOCR + finOCR→Ready`.

Reportar los tres sumandos y el error de cierre; si falta un evento o el
error excede el redondeo, la corrida es inválida. `NER_MODEL_READY` sirve
para describir la carga fría, pero se emite una sola vez por instancia y
no es un límite estable en caliente. `GROUPING_FINISHED` y
`NER_FINISHED` pueden anidarse por listeners síncronos del bus: registrar
ambos, pero **no** atribuir a Grouping su simple diferencia de marcas.
Grouping también trabaja durante los eventos `ENTITY_FOUND` de Regex y
NER. Si el tramo final domina, M-2 medirá por separado carga/inferencia
NER, tiempo acumulado de handlers de Grouping y su finalización, y trabajo
posterior hasta `PIPELINE_READY`. No se sumarán tiempos inclusivos como si
fueran exclusivos.

## 4. Fixtures y controles

- **P2, foco principal:** PDF escaneado congelado de 50 páginas, SHA-256
  `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`.
  Conservar la huella OCR `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`,
  1.038 palabras en 50 páginas. Es la referencia del residuo de §1.
- **P1, control sin OCR:** `text-10p.pdf` de `tests/perf/memory.spec.ts`,
  congelado por SHA antes de medir. Sirve también para cotejar el objetivo
  contractual de **menos de 8 s** en 10 páginas nativas. No se compararán
  directamente sus milisegundos con P2, que tiene 50 páginas y otro tipo
  de contenido.
- **P2-dense, condicional:** 50 páginas escaneadas con entidades en todas
  ellas; congelar fixture y SHA fuera del renderer medido. Ayuda a separar
  un NER liviano por el contenido de P2 de un NER realmente rápido.

Fijar `pdfPoolSize=4`, `ocrPoolSize=2`, `nerPoolSize=2`,
`renderPoolSize=4`, NER activo, `spa`+`eng`, `ocr.dpi=300` y
`maxLiveImageBytes=128 MiB`, igual que I-1. Anotar CPU/RAM/OS, commit,
lockfile, `assets.lock.json`, hashes de build, temperatura y orden de
sesiones. Usar un build fresco sobre el producto actual. La generación
de PDF y cualquier hash de fixture van fuera de la ventana medida y fuera
del renderer que importa el documento.

Todas las corridas deben terminar en `PIPELINE_READY`, sin error; comparar
conteos de entidades y grupos y una huella canónica de resultados entre
frío/caliente y sesiones. Los nombres concretos de entidades del corpus
de prueba no se vuelcan al reporte. Si una huella cambia, investigar antes
de aceptar cualquier comparación de tiempos. Para una futura modificación
de detección, usar además el baseline de calidad de ADR-147 cuando esté
disponible; un perfil temporal no lo reemplaza.

## 5. Lectura y decisión

Por fixture y temperatura, publicar las **seis filas crudas** (tres frías,
tres calientes), mediana, rango y porcentaje del tiempo total de cada
tramo; no ocultar outliers. Marcar además la diferencia entre el comienzo
de importación de la UI y `DOCUMENT_IMPORTED`, y entre `PIPELINE_READY` y
el panel visible, como controles separados del presupuesto contractual
`import → panel` de `07_Performance_Strategy.md` §1. Esos intervalos de UI
no se mezclan con la suma interna del pipeline.

M-2 se activa cuando un tramo domina en las tres sesiones de una misma
temperatura y su mediana supera **1 s en P2, 10 % del tiempo total o 0,8 s
en P1** (10 % de su presupuesto contractual); si
los intervalos se solapan con la dispersión de las corridas, repetir la
medición antes de atribuirlo. El umbral selecciona dónde investigar, **no
autoriza implementar**. Un caso extremo de Regex o Grouping se analiza
aparte si aparece como problema en P1/P2-dense o en un fixture adversarial;
no se proyecta su mejora al P2 normal sin evidencia.

Una implementación futura se conserva solo con A/B de la misma versión de
fixture, sesiones alternadas y tres pares independientes, ahorro neto
end-to-end consistente por encima de la variación observada y huellas de
calidad sin regresión. Si altera detección, verificar los casos de entidad
relevantes además del total. Ningún ahorro justifica perder una detección.

**Entregable del perfilado:** reporte con manifiestos, marcas crudas,
tabla de tramos, error de cierre, variabilidad, controles de calidad y una
recomendación concreta por módulo o cierre sin cambio. No se ejecuta
`git commit` ni `git push` sin autorización humana (I-9).
