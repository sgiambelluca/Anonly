<!-- CONTEXT: scope=medicion-precalentamiento-ner | dependencias=core/Contracts.md,core/NER_Engine.md,core/Orchestrator.md,roadmap/Perfilado_NER_Interno_Medicion.md,roadmap/H-10_Bitacora_De_Memoria.md,architecture/07_Performance_Strategy.md | audiencia=planificador+implementador+humano | fase=11 -->

# Cargar NER durante OCR — plan de medición y entrega

**Estado (2026-09-17): cerrado por decisión humana, sin implementación.** La campaña principal y sus filas crudas están en `Precalentamiento_NER_Durante_OCR_Medicion.md`: el ahorro frío hasta `Ready` no fue estable y B1 elevó el pico RSS 144–422 MB en las tres rondas. El costo de mantener esta concurrencia para intentar recuperar unos 0,94 s de carga no se justifica. El control largo y el smoke de cancelación quedaron sin ejecutar porque ninguna variante pasó los criterios previos; constan como límites del informe. Este documento conserva el protocolo para trazabilidad. Los 300 DPI de OCR y las reglas de detección permanecieron fijos.

**El veredicto con su justificación está en `Precalentamiento_NER_Durante_OCR_Medicion.md` §7**, y como descarte medido en el lever 3 de ADR-154 §2. Dos cosas que este plan dejaba abiertas quedan cerradas ahí: la deriva del banco entre controles idénticos (0,06–2,54 s sobre `Ready`) resultó mayor que la oportunidad entera (0,94 s), así que el resultado no depende de haber elegido bien el disparo; y la variante de cargar el modelo **al abrir la aplicación** —que nunca entró a este plan— queda descartada por decisión del humano, con el argumento de `idleDisposeMs` y memoria ocupada sin documento, no por medición (§7.4 del informe).

## 1. Pregunta y costo que se intenta ocultar

El perfilado interno de NER midió en P2 `modelLoadMs` mediano de **942,94 ms en frío** y **0,18 ms en caliente**; la clasificación tarda **3440,24 / 2839,68 ms**. La hipótesis es solapar la primera carga del modelo con trabajo de OCR y reducir el tiempo `DOCUMENT_IMPORTED → PIPELINE_READY` frío. Un ahorro en el tramo NER que solo se traslade a OCR, o que eleve demasiado el pico de memoria, no mejora el producto.

El riesgo es concreto: el OCR mantiene vivos dos workers de Tesseract y recursos de rasterizado hasta su fin. ADR-157 libera el pool de OCR al cerrar esa etapa precisamente para evitar que conviva con el modelo NER durante la detección. Precargar NER antes adelanta esa convivencia. El multihilo interno de ONNX Runtime ya está habilitado en escritorio (ADR-100/130/132); el experimento no cambia `numThreads` ni `nerPoolSize`.

## 2. Condiciones que se comparan

| Condición | Disparo de carga | Qué responde |
|---|---|---|
| **A** — actual | El primer batch NER carga el modelo después de OCR | Baseline real |
| **B1** — temprana | Tras `OCR_STARTED`, mientras OCR sigue activo | Mayor ventana de solapamiento; mayor convivencia en memoria y riesgo de caducidad por idle |
| **B2** — tardía | Al completar aproximadamente 75 % de las páginas OCR, con OCR aún activo | Menor tiempo con ambos modelos vivos; comprobar si queda suficiente OCR para ocultar la carga |

El disparo tardío se define con el total real de trabajos OCR del documento, no con un temporizador fijo; registrar el índice y la marca de tiempo exactos. Si un perfil termina OCR antes de que B2 pueda dispararse, reportar **sin oportunidad de precarga**; no convertirlo en una mejora artificial. P1, que no entra en OCR, es control negativo: ninguna condición debe crear un worker NER antes de la detección. Con NER deshabilitado, tampoco debe precargarse.

La precarga usa **el mismo pool, slot 0, modelo, cuantización y rutas WASM** que después clasificará. No clasifica texto del documento durante OCR ni emite `ENTITY_FOUND`. Debe observarse que carga una sola copia del modelo. Si al terminar OCR la carga sigue en curso, la clasificación espera esa misma promesa: dejar que el pool abra el slot 1 y cargue otro modelo invalidaría la comparación. Ese tiempo de espera cuenta en `OCR_FINISHED → PIPELINE_READY`. No se oculta ni se descarta.

El arnés usa un patch **temporal y exclusivo de medición**, aplicado a las mismas fuentes para A, B1 y B2. La diferencia entre condiciones es solo la activación del disparo; todas corren con el mismo binario instrumentado. No agregar API, evento, error code, config pública ni cambio permanente al motor. Los eventos públicos de NER deben conservar su orden normal; las marcas de precarga son diagnósticas del arnés. Si no se puede preservar esto sin ampliar contrato, parar y reportar la ambigüedad antes de medir.

## 3. Métricas obligatorias

Cada importación registra marcas con `Date.now()` en el renderer para poder alinearlas con las muestras del proceso main; para duraciones dentro de un mismo proceso puede usarse `performance.now()`. No restar relojes monotónicos de procesos distintos.

| Familia | Datos por corrida |
|---|---|
| Latencia de usuario | `DOCUMENT_IMPORTED → PIPELINE_READY` y, como contexto, selección de archivo → Ready; cold/hot separados |
| Reparto de tiempo | `OCR_STARTED → OCR_FINISHED`, `OCR_FINISHED → NER_STARTED`, `NER_STARTED → NER_FINISHED`, `OCR_FINISHED → PIPELINE_READY`; duración de precarga y espera residual al límite OCR/NER |
| Solapamiento efectivo | inicio/fin de precarga frente a `OCR_STARTED`/`OCR_FINISHED`; fracción de la carga cubierta por OCR; si el modelo seguía vivo al primer batch real; número de cargas y workers NER creados |
| OCR | duración por página o tramo de progreso, total de páginas, p50/p90 si hay suficientes páginas; verificar si compartir CPU retrasa Tesseract |
| Memoria | RSS sumado de `app.getAppMetrics()` y desglose por renderer/GPU/otros, muestreado a 150 ms; baseline anterior al import, pico en OCR, pico `import→Ready`, memoria cerca de `OCR_FINISHED` y `PIPELINE_READY`, y estado tras cerrar documento |
| Calidad y estabilidad | huellas exactas de palabras OCR y detecciones, entidades/grupos, `PIPELINE_READY` sin fallas, cancelación/cierre durante carga, ausencia de promesas rechazadas sin manejar |

RSS sumado es **suma de working sets**, no memoria física única. La comparación válida es entre condiciones medidas con el mismo instrumento y el mismo perfil; no sumar los picos separados de procesos ni llamar ahorro a una liberación de GC no controlada. El presupuesto publicado en `07_Performance_Strategy.md` §7 es ~1,6 GB para OCR+NER; reportar tanto el valor absoluto como el delta B−A, sin normalizar un exceso como si fuese ganancia.

La instrumentación debe distinguir «modelo ya cargado» de `NER_MODEL_READY` público: este último se deduplica por instancia y por sí solo no prueba que la precarga haya terminado o que el worker haya sobrevivido hasta la clasificación. Un indicador interno de carga y un contador de workers sirven para esa prueba. El timeout/idle disposal por defecto es de 60 s; una carga temprana que expire antes de NER no cuenta como ahorro.

## 4. Corpus, controles y orden de ejecución

- **P2 principal:** `.measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf`, SHA-256 `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`. Mantener PDF 4, OCR 2, NER 2, Render 4, NER activo, `spa`+`eng`, OCR a 300 DPI y `maxLiveImageBytes=128 MiB`. Si el producto aplica DPI efectivo por ráster, registrar el valor observado; no cambiarlo entre condiciones.
- **P1 control:** `.measure/fixtures/text-10p-frozen.pdf`, SHA-256 `b96b0c00b645bca1cd991deb248f499da132155723e96c8144f35bfd4c5a9824`. Verificar ausencia de precarga al no haber OCR y equivalencia de calidad.
- **Vida larga:** si B1 parece prometedora, correr un control con el P2 escaneado de 200 páginas ya disponible en `tests/perf/memory.spec.ts`, suficiente para atravesar el `idleDisposeMs` de 60 s. Comparar A y B1 al menos una vez; registrar si el worker adelantado se libera y el modelo debe recargarse. No extrapolar el resultado de 50 páginas a OCR largos sin este control.
- **Fallo/cancelación:** un smoke de cancelación o cierre durante la precarga debe verificar limpieza y que un siguiente documento se pueda procesar. No se usa para comparar tiempos.

En un solo host sin otros benchmarks activos, hacer primero smoke A/B1/B2 con P2 y control P1. Si pasan, ejecutar **tres rondas** `A1 → B1 → B2 → A2`; cada condición usa una instancia fresca de Electron y hace importación fría, cierre y una caliente dentro de esa instancia. A1/A2 acotan deriva de CPU y memoria en cada ronda. La ejecución es serial (`workers=1`, `retries=0`), sobre shell Electron empaquetado, con fixtures generados antes de abrir la ventana medida. Registrar CPU, RAM, OS, commit, lockfile, configuración efectiva y hashes del patch/build. Guardar JSON de cada corrida, logs y manifiesto bajo `.measure/ner-preload-ocr/<timestamp>/` sin sobrescribir evidencia previa.

La huella OCR esperada para P2 es `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`; la de detección es `327c988dd2622c4fd69b47a37d424b7704e2ec92449ada99834323de39abf9c8`, con 13 entidades y 11 grupos en el baseline anterior. Recalcular A1 con el estado actual y exigir identidad exacta B1/B2/A2, en frío y caliente. Esas huellas del corpus no reemplazan el gate de calidad general.

## 5. Lectura de resultados y criterio para avanzar

Publicar cada fila cruda y mediana/rango por condición y temperatura. Para cada ronda, comparar B1/B2 con A1 y A2 de esa ronda; no atribuir a la precarga una diferencia menor que la deriva de los controles. Descomponer el cambio total en carga ocultada, espera residual, cambio de tiempo OCR y resto. Si los intervalos no cierran, dejar el residuo explícito.

Una variante solo pasa a **propuesta de ADR e implementación** si cumple simultáneamente:

1. Misma calidad, mismo trabajo OCR y una sola carga efectiva del modelo NER; sin errores ni regresión de cancelación.
2. Mejora fría de `import→Ready` de al menos **0,5 s** que supere la variación A1/A2; ninguna regresión caliente consistente. Un `NER_STARTED→NER_FINISHED` menor por sí solo no alcanza.
3. El OCR no se retrasa de forma consistente más de **5 %**; si la ganancia total ya incorpora esa demora, mostrarla por separado.
4. El pico de RSS no excede el presupuesto aplicable ni muestra un incremento material y consistente frente a A. Como señal de descarte para esta campaña, **+100 MiB o más en las tres rondas** exige no recomendar la variante; si la dispersión de A1/A2 cubre ese delta, clasificar memoria como inconclusa y ampliar muestras antes de decidir.
5. B1 también sobrevive al control de OCR largo; si expira antes de NER, solo B2 puede seguir en evaluación.

Si alguna condición falla, documentar el resultado y conservar el producto actual. No decidir ni implementar la optimización en esta campaña: el informe debe separar medición, inferencia y recomendación para que el humano pueda valorar el intercambio tiempo/memoria.

## 6. Entrega al subagente implementador

Leer en orden `docs/core/Contracts.md`, `docs/core/NER_Engine.md`, `docs/core/Orchestrator.md`, `docs/ai/Code_Standards.md` y `docs/ai/AI_Development_Guide.md`, además de ADR-157, ADR-146/153 y los informes de NER y memoria citados. Crear el arnés en `tests/perf/`, ejecutar la campaña y escribir `Precalentamiento_NER_Durante_OCR_Medicion.md` con evidencia y límites.

El patch temporal solo puede modificar durante la corrida `packages/anonymization-core/src/orchestrator.ts` y `packages/anonymization-core/ner-engine/src/ner.engine.ts` (o justificar una superficie menor). Debe guardar copia y SHA-256 de cada fuente, comprobar aplicabilidad, restaurar bytes en `trap` aun si falla una prueba, verificar hashes después y reconstruir el build normal. Si el proceso termina de forma no atrapable, conservar las copias para recuperación manual. No usar `git reset`/`git restore` sobre el árbol completo: hay trabajo ajeno sin commit. No hacer commit ni push sin autorización humana.

Antes de entregar, pasar `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, más el smoke/campaña del arnés, y `git diff --check`. Si un gate falla por trabajo ajeno, aislarlo y reportarlo con evidencia; no editar archivos de otros módulos para hacerlo verde.
