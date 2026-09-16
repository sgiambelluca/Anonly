<!-- CONTEXT: scope=revision-T5 | dependencias=roadmap/T5_OSD_Compartido_Handoff.md,roadmap/T5_OSD_Compartido_Resultados_Adelanto.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md | audiencia=humano+planificador+implementador | fase=11-aceptacion-pendiente -->

# T5 — Revisión independiente de la entrega con adelanto

Fecha: 2026-09-15. Revisión del planificador, con revisión independiente de
código y reproducciones puntuales en Node/Chromium. No se modificó producto
ni se repitió el benchmark. Los datos históricos se conservan intactos.

**Veredicto: REJECTED para cierre.** La entrega medida tarda más que el control
original, pero el A/B mezcla el cambio de scheduling con una corrección
funcional en imágenes rotadas. No permite atribuir la regresión al OSD
compartido ni descartar la página de adelanto como diseño. Tampoco demuestra
ahorro RSS. Persisten defectos de ciclo de vida y pruebas de aceptación
insuficientes.

## Tiempos contrastados con los datos crudos

Fuentes: `.measure/t5-osd/t5-20260915-adelanto-7c3a9d11/`, pares elegidos por
el informe: A1 before, B1 after-3, A2 before-retry, B2 after, A3 before y B3
after. OCR se recalcula como diferencia de los eventos en `phases`; Ready usa
`totalMs`, contrastado con `readyDurationMs`. Medias de tres pares por
temperatura, sin mezclar frío y caliente:

| Métrica | BEFORE | AFTER | Diferencia |
| --- | ---: | ---: | ---: |
| Tiempo OCR frío | 15.391 s | 17.419 s | +2.028 s (+13.2%) |
| Tiempo OCR caliente | 15.269 s | 17.571 s | +2.302 s (+15.1%) |
| Tiempo hasta Ready frío | 20.805 s | 22.627 s | +1.822 s (+8.8%) |
| Tiempo hasta Ready caliente | 18.935 s | 21.161 s | +2.226 s (+11.8%) |

Los seis deltas temporales son positivos. A2 frío tiene
`peakWithinPhases=false`: impide usarlo como par RSS plenamente válido; no
invalida por sí solo los timestamps de OCR/Ready. Si se restringen también
los tiempos fríos a pares 1 y 3, OCR pasa de 15.440 a 17.425 s (+12.9%): la
dirección no depende de incluir A2.

En caliente, los tres pares tienen `ok=true`, `peakWithinPhases=true` y
`hotBaselineSettled=true`. Pico RSS global medio: 1613.8 → 1846.4 MB
(+232.7 MB, +14.4%). Deltas por par: +556.9, -24.6 y +165.7 MB. La variación
entre pares impide atribuir tamaño propio al OSD; no hay ahorro demostrado.
No se calcula una media RSS fría de tres pares ignorando el fallo de A2.

Se recalcularon las huellas desde Word[] completas, ordenando páginas por
índice y conservando texto/source/confianza/bbox/rotación/orden de palabras:
las doce coinciden con
`c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`
(1038 palabras). Esto prueba igualdad de salida en P2, no igualdad de trabajo
interno ni de entidades normalizadas en el corpus girado.

## El A/B contiene otra diferencia funcional

`ocr-engine/src/worker/kernel.ts:370` agrega `createImageDataResult`. Ahora
`rotateImageData` y `cropImageData` devuelven ImageData nativo en el navegador;
el control devolvía un objeto estructural `{ data, width, height, colorSpace }`.
`toTesseractImage` llama `context.putImageData` (línea 277).

La revisión reprodujo en Chromium que `putImageData` rechaza ese objeto con
TypeError y acepta `new ImageData(...)`. En el control, el catch de
`recognizeRotatedMargins` oculta el fallo antes de invocar `recognize`. En el
AFTER, la corrección permite que esas pasadas lleguen a Tesseract. También
afecta al camino de páginas giradas completas.

Verificación del fixture por píxeles: el revisor rasterizó sus 50 páginas en
Chromium/pdfjs a escala 300/72 y aplicó el predicado exacto de ADR-162 sobre
ambas franjas del 20%. **100/100 franjas contienen píxeles visibles no blancos**.
Por ello, el cambio habilita cuatro reconocimientos de margen por página
que el control abortaba antes de reconocer. Esta cuenta proviene del flujo
del código y del contenido de las franjas; no es un contador de llamadas a
Tesseract capturado durante los benchmarks históricos.

La huella final puede permanecer igual: las candidatas adicionales se filtran
por solape/confianza. Igualdad de Word[] no demuestra que ambos builds hayan
ejecutado las mismas pasadas. La implementación nueva además copia cada
buffer de salida antes de construir ImageData; su contribución a tiempo/RSS
tampoco está aislada.

**Conclusión causal limitada:** la corrección es necesaria para que funcione
el camino rotado, pero introduce una segunda variable. Los ~2 s adicionales
son del conjunto entregado. Cuánto corresponde a corregir esas pasadas y
cuánto al diseño compartido requiere comparar ambos con la corrección.
El diagnóstico anterior (~24%) tampoco incluía esta corrección funcional.

## El adelanto sí está funcionando

Integrando `workerEvents` del AFTER en la ventana OCR:

- Ocupación agregada de los dos jobs LSTM: 94.5% en frío y 95.3% en caliente.
- Ambos jobs LSTM activos simultáneamente: 92.6% y 93.4% de la etapa.
- OSD activo mientras ambos LSTM trabajan: aproximadamente 5.88 y 6.05 s por
  import de 50 páginas.

Son métricas de ocupación de jobs, no CPU. En BEFORE, `ocr-page` incluye OSD
dentro del mismo job: no comparar directamente su ocupación como si fuera
solo reconocimiento. La suma de servicios LSTM del AFTER es ~32.9/33.5 s;
en el prototipo anterior era ~21 s. Esto es compatible con trabajo adicional,
sin cuantificar causalmente su procedencia.

## Pendientes funcionales confirmados

1. **Liberación prematura tras rechazo de una rama**: `processSessionInternal`
   espera `Promise.all` (`ocr.engine.ts:733`), mientras el finally exterior
   reduce `activeProcessSessions` al primer rechazo (línea 673). Si otro
   consumidor sigue en `produce` y aún no llegó a `processPage`, ambos
   contadores quedan en cero y `releaseIdleWorkers` libera los pools. Repro
   independiente: dos requests, segundo productor pendiente, orientación del
   primero falla con OcrModelMissingError; tras rechazar sesión, ambos métodos
   release fueron llamados mientras el productor seguía activo. Viola el caso
   37/ADR-164 §2.3. El contador debe cubrir las ramas hasta que se asienten.
2. **El E2E no acredita toda la aceptación**: corre sobre AFTER y compara su
   reanálisis; no compara BEFORE/AFTER del fixture girado. Sus asserts de
   rotación aceptan alguna palabra rotada en el conjunto, y el de censura
   acepta un cambio de píxel, no cobertura completa de cada caja conocida ni
   preservación de zonas externas. Las muestras proceden de las propias cajas
   OCR, no de ground truth independiente; tampoco selecciona Redact de forma
   explícita. Una descarga completada no prueba censura correcta en las cuatro
   orientaciones.
3. **Entidades normalizadas pendientes**: groupCount/entityCount de P2 no
   sustituyen los conjuntos normalizados exigidos por el handoff. El informe
   presenta el reanálisis como real en su texto, pero su matriz conserva una
   frase que dice que no formó parte de la campaña: corregir esa incoherencia
   sin ampliar el alcance demostrado por los asserts.
4. **Pruebas discriminantes incompletas**: el test del adelanto tiene solo
   tres requests, por lo que no comprueba que el cuarto espere. Faltan las
   verificaciones nuevas de presupuesto durante espera/retry, compatibilidad
   lowResource/fallback y cancelación del adelanto. El test unitario llamado
   reanálisis comprueba release, sin iniciar otra sesión. El E2E sí ejecuta
   reanálisis de idiomas, con las limitaciones del punto 2.

El revisor ejecutó los tests `orientation-kernel.test.ts` y
`t5-shared-osd.test.ts`: **21/21 PASS**. Esto confirma los casos presentes,
incluida recuperación de inicialización, pero no los ausentes. La prueba de
liberación prematura se ejecutó separadamente con Node/tsx, sin modificar
producto ni la suite. La revisión también contrastó que processPages delega
en processSession y adquiere su ventana, como exige el spec; la frase del
informe que afirma que conserva el límite previo debe corregirse.

No se ejecutaron gates globales para declarar la entrega lista: estos
hallazgos ya impiden aceptarla. Los PASS scoped reportados por el implementador
no reemplazan estos requisitos; la revisión final/global sigue pendiente.

## Próximo experimento recomendado

Separar la corrección ImageData como diferencia funcional identificada y
aplicarla por igual al control de diagnóstico y al candidato. Mantener el
control original y sus resultados archivados; no reescribirlo como si siempre
hubiera tenido la corrección. Comparar:

1. Dos LSTM + dos OSD, con ImageData corregido.
2. Dos LSTM + un OSD + una página de adelanto, con la misma corrección.

Antes de medir, verificar las mismas pasadas con un contador de reconocimiento
por página/franja y completar los casos de ciclo de vida y calidad. No quitar
las pasadas para recuperar una cifra favorable ni aumentar el adelanto a dos
páginas. Este documento recomienda ese control equivalente; no afirma que la
nueva campaña ya se haya ejecutado ni modifica producto.
