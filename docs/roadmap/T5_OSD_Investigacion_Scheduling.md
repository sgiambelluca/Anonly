<!-- CONTEXT: scope=investigacion-T5 | dependencias=adr/ADR-164-Un-OSD-Compartido-Por-Core.md,roadmap/T5_OSD_Compartido_Revision_R4.md | audiencia=planificador+implementador+humano | fase=experimental-sin-adopcion -->

# T5 — Alimentar dos reconocedores sin esperar a orientar el PDF completo

Fecha: 2026-09-14. Investigación autorizada por el humano, incluida su propuesta de orientar primero todo el PDF. No modifica producto, contratos ni la aceptación de ADR-164. Los prototipos se inyectaron únicamente en instancias Electron de prueba.

**Resultado principal:** una página adicional en preparación reduce aproximadamente un 24% la duración de OCR frente al diseño T5 compartido actual, conservando dos LSTM y un OSD. Una pasada OSD completa también es viable: permite terminar OSD antes de cargar LSTM, pero tarda más. El ahorro RSS requiere una campaña específica; estas pruebas no cierran T5.

## Decisión del humano — 2026-09-14

**Seguimiento 2026-09-15:** documentación ejecutable terminada en ADR-164 §2.3,
OCR_Engine v1.16.0 y handoff §2.0, por solicitud del humano de reanudar con el
mismo Luna. El párrafo siguiente conserva el estado de la decisión original;
ya no está pendiente especificar, sí implementar y validar el candidato final.

Se elige continuar con **dos reconocedores LSTM, un OSD compartido y una página adicional en preparación**, bajo el presupuesto de imágenes existente. La prepasada completa no es la variante elegida. Se conservan los datos de todas las alternativas. Esta selección de dirección no declara terminada la implementación: sigue pendiente convertir el prototipo en especificación ejecutable, corregir los defectos de recuperación documentados y completar aceptación funcional y A/B contra el diseño original. No se delega otra implementación en este registro.

El humano plantea si dos páginas adelantadas podrían mejorar aún más la ocupación. **Es posible como diseño, pero no fue medido ni se selecciona ahora.** Con una página extra, la ocupación agregada de los dos reconocedores ya es 90.8% en frío y 91.9% en caliente. El 87–88% citado más abajo es otra métrica: fracción del tiempo en que ambos tienen trabajo simultáneo.

Como cota idealizada, manteniendo constante la suma de duraciones de los jobs LSTM, eliminar absolutamente todos los huecos llevaría 11.62 s a 10.55 s en frío y 11.34 s a 10.42 s en caliente: **0.9–1.1 s adicionales, aproximadamente 8–9% como techo del modelo**. No es una ganancia prevista de agregar otra página: hay carga, arranque/vaciado del flujo, dependencia de OSD y contención que esa página no elimina. El servicio de OSD de unos 125 ms y dos reconocimientos de unos 400 ms permiten alimentar, en este corpus, una demanda agregada de aproximadamente una página cada 200 ms; OSD ya tiene capacidad media suficiente.

Dos páginas adicionales elevarían a cuatro las solicitudes potencialmente en vuelo. Eso puede aumentar memoria y, para imágenes grandes, el presupuesto de 128 MiB impediría admitir la cuarta. Ejemplo ilustrativo, no dimensiones afirmadas para P2: cuatro rásteres A4 de 2480×3508 RGBA representan 132.75 MiB estimados. Se mantiene la prioridad acordada: una página de adelanto, sin subir el pool LSTM ni el presupuesto por perseguir los últimos puntos de ocupación.

La intención de migrar Electron a **Tauri queda registrada para después de terminar la campaña de hardening**, como trabajo separado: [Future Ideas §2.5](Future_Ideas.md#25-migración-electron--tauri-después-del-hardening). No se contabiliza un ahorro de Tauri dentro de los resultados de T5.

## Cuánto tarda OSD

Reanalicé los eventos de los seis imports AFTER de r4. El servicio `ocr-orient` tarda, después del primer job, entre 123.6 y 126.2 ms de media por imagen. Las medianas son 120–125 ms y los percentiles 95 por sesión, 138–144 ms. El primer job tarda 527–550 ms en frío y 373–378 ms en la segunda importación. El trabajo OSD acumulado para las 50 páginas es 6.48–6.68 s.

El servicio `ocr-page` suma aproximadamente 20 s de ocupación entre ambos workers para 50 páginas: unos 400 ms por página. Son tiempos desde despacho hasta fin, incluidos transporte, preparación, franjas y carga cuando corresponde; no son CPU puro ni duración exclusiva de `TessBaseAPI::DetectOS`. No extrapolar este P2 sintético de 1038 palabras a documentos densos ni a otro hardware.

Tesseract.js 6.0.1 convierte `OffscreenCanvas` a un blob antes de enviarlo al hijo, y su `detect` carga la imagen antes de llamar a `DetectOS`. Por eso el servicio OSD incluye trabajo adicional de imagen. Fuentes primarias: [loadImage v6.0.1](https://raw.githubusercontent.com/naptha/tesseract.js/v6.0.1/src/worker/browser/loadImage.js), [detect v6.0.1](https://raw.githubusercontent.com/naptha/tesseract.js/v6.0.1/src/worker-script/index.js). Coinciden con el paquete local inspeccionado. Pasar ImageData crudo no elimina automáticamente ese costo: no es un camino RGBA directo de esta API.

## Problema de ocupación encontrado

El `ocrPoolSize: 2` determina tanto el número de workers LSTM como los dos consumidores de `processSession`. Cada consumidor conserva su cupo durante rasterización, espera OSD, orientación y reconocimiento. Si los dos LSTM reconocen, los dos consumidores están ocupados y nadie prepara la siguiente página. Al finalizar una, ese LSTM espera mientras su consumidor rasteriza y orienta la siguiente.

Los eventos r4 confirman que nunca hay un job OSD simultáneo con dos jobs LSTM. En el piloto nuevo, los dos reconocedores tienen jobs en curso solo el 44–47% del tiempo; su ocupación agregada es aproximadamente 67% de la capacidad de dos workers. No es una medición de utilización de CPU.

El prototipo de una página adicional eleva a tres el límite de consumidores, manteniendo **el pool físico LSTM en dos**. Conserva el presupuesto existente de 128 MiB de imágenes activas. Así, mientras dos páginas se reconocen, una tercera puede prepararse. No añade un modelo ni acumula el documento completo. La reserva sigue contando hasta que termina cada página; si no caben tres imágenes, el presupuesto limita la admisión.

## Experimentos

Mismo P2 congelado de 50 páginas, SHA-256 `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`, Apple M1, 8 GiB RAM. Build fresco con `VITE_E2E=1`, dos LSTM, un OSD, mismo DPI/idiomas y presupuesto activo. Sin otros tests/builds durante las mediciones.

Primero actual → una página adicional → prepasada sin cache. Después una página adicional → actual → prepasada con cache. Cada condición arrancó un Electron independiente e hizo frío/cerrar/caliente. Se repitieron las prepasadas una única vez por el fallo operativo de liberación descrito abajo, conservando todos los originales. Es un diagnóstico exploratorio, no una campaña estadística definitiva.

La prepasada sin cache rasteriza y orienta una solicitud a la vez, conserva solamente el ángulo y vuelve a rasterizar durante reconocimiento. La variante con cache conserva los PNG bajo un límite adicional explícito de 8 MiB; P2 usó **6,408,486 bytes**. No almacena el conjunto de páginas en RGBA. Ambas variantes exigen índices únicos porque este piloto solo trata P2; no son una implementación válida todavía para regiones del mismo documento.

La medición del tramo completo usa el inicio y fin del wrapper de `processSession`, incluyendo prepasada y liberación. Usar solamente los eventos OCR_STARTED→OCR_FINISHED en la prepasada excluiría sus primeros ocho segundos y daría una comparación incorrecta. RSS se calcula como máximo de la suma simultánea dentro del mismo tramo; los tiempos hasta Ready usan `totalMs`, con un único reloj.

## Resultados temporales

| Variante | Frío, etapa completa | Segunda importación, etapa completa | Muestras por temperatura |
| --- | ---: | ---: | ---: |
| T5 compartido actual | 15.31 s | 14.87 s | 2, promedio |
| Dos LSTM + una página adicional en preparación | **11.62 s** | **11.34 s** | 2, promedio |
| OSD completo, liberarlo, volver a rasterizar | 19.60 s | 19.07 s | 1, liberación verificada |
| OSD completo, cache PNG, liberarlo | 18.24 s | 17.89 s | 1, liberación verificada |

La mejora con una página adicional es **24.1% en frío y 23.7% en caliente**, respecto al diseño T5 compartido actual. Los cuatro deltas individuales mantienen la dirección: -3.91/-3.89 s en el primer par y -3.46/-3.17 s en el par de orden inverso. El tiempo total hasta Ready baja en promedio de 20.79 a 16.96 s en frío y de 18.31 a 14.82 s en caliente.

Los dos LSTM pasan a tener trabajo simultáneo aproximadamente el **87–88%** del tramo; la ocupación agregada es 91–92%. La suma de servicio LSTM cambia poco: el beneficio procede principalmente de reducir huecos entre trabajos. Los eventos muestran aproximadamente 5.8 s de OSD solapados con dos LSTM en el piloto de una página adicional, frente a cero en el actual.

La prepasada tarda por sí sola unos **7.8–8.0 s**. Con cache, el reconocimiento posterior tarda unos 10.1–10.3 s y ocupa muy bien a los dos LSTM, pero esa fase comienza después de la barrera OSD. Guardar PNG evita una segunda rasterización y recupera aproximadamente 1–1.5 s; no recupera el solapamiento perdido. Sin cache se observan 100 rasterizaciones durante el tramo, frente a 50 en los otros caminos.

## Memoria: observación y límites

| Variante | Pico del tramo frío | Pico del tramo caliente | Pico global frío / caliente |
| --- | ---: | ---: | ---: |
| Actual, media de dos | 1385.5 MB | 1524.8 MB | 1430.1 / 1524.8 MB |
| Una página adicional, media de dos | 1507.2 MB | 1545.6 MB | 1507.2 / 1545.6 MB |
| Prepasada sin cache, OSD liberado | 1168.8 MB | 1119.3 MB | 1351.3 / 1119.3 MB |
| Prepasada con cache, OSD liberado | 1368.7 MB | 1177.2 MB | 1528.5 / 1448.6 MB (*) |

(*) Los dos imports de la prepasada con cache corregida tienen `peakWithinPhases=false` para el máximo global. No aceptarlos como mediciones globales válidas ni repetir para buscar una cifra favorable. Los tiempos y el tramo explícito se conservan como observaciones diagnósticas. En el primer ensayo sin cache caliente también se registró esa limitación.

Con una página adicional, los deltas globales de memoria cambian de signo entre pares: frío +257.4 / -103.2 MB; caliente -102.1 / +143.9 MB. Sus medias (+77.1 / +20.9 MB) no prueban ahorro ni permiten fijar un costo de memoria universal. El presupuesto activo igual no implica RSS igual: más trabajo simultáneo puede elevar buffers/canvases nativos. No afirmar que la variante necesita solamente el tamaño estimado de una página extra.

La prepasada sin cache y con liberación efectiva mostró menor RSS en este ensayo, por lo que es una candidata razonable si se acepta mayor latencia para priorizar memoria. Necesita controles alternados propios: se midió una vez por temperatura después de los otros ensayos. No presentar estas cifras como ahorro causal demostrado frente al diseño original de dos OSD; ese baseline no se volvió a ejecutar aquí.

## Liberación y verificación

El primer prototipo llamaba `releaseIdleWorkers()` inmediatamente después de `await dispatch`. Esa continuación se ejecuta antes del `finally` de `WorkerPool.pump()` que baja `active`; la guarda de ociosidad devuelve sin liberar. CDP mostró el OSD vivo durante reconocimiento. Se conservan esos originales, marcados como **prepasada con liberación no efectiva**; no se usan para afirmar ahorro al terminar OSD.

El ensayo corregido espera un turno del event loop, comprueba `isIdle`, libera y exige `remoteWorkers.size === 0`. CDP confirma ausencia de solapamiento entre wrappers OSD y LSTM y máximo de dos hijos Tesseract simultáneos. En los caminos actual y una página adicional, el máximo es tres hijos (dos LSTM + un OSD). Al final desaparecen todos esos targets. Una implementación de producción necesita resolver la coordinación explícitamente, no copiar una pausa del arnés.

Los ocho tests Electron terminaron y los **16 imports** conservaron la misma huella completa de Word[] normalizadas, 1038 palabras, 11 grupos y 13 entidades. El segundo grupo y las prepasadas corregidas además lo afirman en el test. No se verificaron entidades normalizadas, documentos densos ni el E2E de giros/censura/exportación pendiente de T5.

## Recomendación de planificación

La vía principal para reducir tiempo es **separar cantidad de reconocedores de cantidad de páginas en preparación**, con un adelanto máximo de una, mismo presupuesto de imágenes y backpressure. Estos datos hacen más interesante el OSD compartido por su rendimiento, aunque no resuelven su beneficio de memoria.

La prepasada completa es una alternativa real para priorizar memoria y evitar coexistencia OSD/LSTM, con un costo temporal medido. No la elegiría para acelerar el procesamiento. Cachear todos los PNG requiere presupuesto explícito y una estrategia de fallback para PDFs que no caben; no generalizar los 6.4 MB de P2.

Antes de implementar una nueva variante: actualizar ADR-164 y los specs, que hoy prohíben adelanto/barrera global; corregir recuperación/disposición pendientes de la revisión r4; definir pruebas de regiones/cancelación/presupuesto, y completar giros/censura reales. Después comparar la candidata con el baseline original de dos OSD mediante una campaña alternada. No aumentar todavía el pool LSTM.

Otra línea para una investigación de memoria acotada es verificar la vida de los canvases de rasterización una vez obtenido el PNG. El código depende de GC para esos recursos; no se ha demostrado que sea la causa del exceso RSS ni se modificó aquí. Evitar adoptar cambios de resolución, modelos o compresión con pérdida para obtener mejoras aparentes. La guía oficial también recomienda reutilizar workers y mantener un pool acotado: [Tesseract.js performance](https://github.com/naptha/tesseract.js/blob/master/docs/performance.md).

## Artefactos

En `.measure/t5-scheduling-investigation/` se conservan plan previo y ampliaciones justificadas, JSON crudos, logs, resúmenes, fuentes del arnés por versión y manifest posmedición de hashes y chunks. `released/` contiene las únicas prepasadas con liberación comprobada. El test temporal se retira del árbol de tests al terminar; no se modificó código de producto ni se hicieron commits/push.

Typecheck del arnés pasa. Se corrigió después de la última ejecución una anotación opcional de TypeScript (`number | undefined`), sin cambiar JavaScript; se conserva también el fuente exacto ejecutado. No se ejecutaron gates globales porque este trabajo es diagnóstico, no entrega de implementación.
