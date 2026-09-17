<!-- CONTEXT: scope=perfilado-ner-interno | dependencias=roadmap/Perfilado_Tiempo_Fuera_OCR_Plan.md,roadmap/Perfilado_Tiempo_Fuera_OCR_Medicion_M0_M1.md,core/NER_Engine.md,architecture/07_Performance_Strategy.md | audiencia=planificador+implementador+humano | fase=11 -->

# Perfilado interno de NER — plan y entrega al implementador

Estado: **campaña completa y diagnóstico cerrado** (2026-09-17). Resultados y
decisión en `Perfilado_NER_Interno_Medicion.md`; se conserva este protocolo
para reproducir la medición.
Este trabajo solo atribuye tiempo. No modifica la configuración de 300 DPI,
no propone un cambio de detección y no da por satisfecha la calidad de release.

## 1. Pregunta y evidencia de partida

La campaña de tiempo fuera de OCR ya cerró M-0..M-3. En el P2 congelado de
50 páginas escaneadas, la mediana de `NER_STARTED → PIPELINE_READY` fue
**4.439 s fría y 2.872 s caliente**. El patch M-2 midió
`runInferenceInBatches` en **4.427 s / 2.860 s**. Los handlers de Grouping
para entidades NER rondaron **1.23 / 0.54 ms**. La atribución identifica al
tramo NER como prioridad, pero el contador de M-2 incluye carga del modelo,
espera/despacho, inferencia y trabajo del host. Fuente y filas individuales:
`Perfilado_Tiempo_Fuera_OCR_Medicion_M0_M1.md` §M-1/§M-2.

La pregunta nueva es: **¿cuánto de ese tiempo es carga por worker, cuánto
corresponde al modelo por lote y cuánto a preparación, espera o mapeo?**
El modelo se carga por worker y `NER_MODEL_READY` se deduplica por instancia
del motor (`NER_Engine.md` §7/§13.17), así que ese evento público no basta
para medir cada carga. `processPages` despacha las páginas secuencialmente
(`NER_Engine.md` §12 y código actual); no se infiere paralelismo efectivo
solo por tener `nerPoolSize=2`.

## 2. Instrumento preparado

El patch **temporal**
`tests/perf/support/ner-internal-instrumentation.patch` toca solo
`ner.engine.ts` y `worker/kernel.ts`. No altera contratos públicos, la forma
de `COMPLETED { spans }`, la configuración ni las decisiones de detección.
El kernel envía por el canal interno `PROGRESS` un registro diagnóstico
`phase: "__nerProbe"` por lote, que el host consume sin traducirlo a evento
de dominio. Es una instrumentación para medición, no código de producto: el
runner la aplica y la revierte.

Cada lote registra en el **host** página, índice de lote, cantidad de palabras,
longitud del texto, `dispatchMs` y el diagnóstico del worker. El documento
acumula `chunkMs` (partición de palabras), `mappingMs` (spans→Occurrence) y
`emitMs` (emisión de entidades, incluidos listeners síncronos).

Cada lote registra en el **worker** `modelWasWarm`, `modelLoadMs`,
`textPrepMs` (Title Case), `tokenBudgetMs` (medición y corte por presupuesto
de tokens), `classifyMs` (llamada al pipeline con su tokenización interna y
ONNX), `aggregateMs`, `otherMs`, `totalMs`, cantidad de sublotes y
cortes por límite de tokens. Son duraciones locales medidas con
`performance.now()`; no se restan marcas absolutas de host y worker, que
tienen orígenes distintos. `dispatchMs - totalMs` es **espera, transporte y
scheduling juntos**, no una medición pura de cola. `classifyMs` sigue
incluyendo la tokenización interna de Transformers.js; solo si domina y hay
un candidato concreto se justifica una segunda instrumentación más profunda.

El test opt-in `tests/perf/ner-internal-profile.spec.ts` reutiliza el
colector y las huellas de `tests/perf/support/timeProfile.ts`. El runner
`tests/perf/run-ner-internal-profile.sh` construye Electron y ejecuta
**A1 sin probe → B con probe → A2 sin probe**. Cada fase hace tres sesiones
independientes por fixture; cada sesión importa frío, cierra el documento e
importa caliente en la misma instancia. P1 es el control de texto nativo; P2
es el foco. `--smoke` limita cada fase a una sesión de un fixture; usa P1
por defecto y acepta `ANONLY_NER_SMOKE_PROFILE=p2`.

## 3. Condiciones fijas y controles

- P1: `.measure/fixtures/text-10p-frozen.pdf`, SHA-256
  `b96b0c00b645bca1cd991deb248f499da132155723e96c8144f35bfd4c5a9824`.
- P2: `.measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf`,
  SHA-256 `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`.
- Configuración heredada de la serie M-2: PDF 4, OCR 2, NER 2, Render 4,
  NER activo, `spa`+`eng`, OCR configurado a 300 DPI y
  `maxLiveImageBytes=128 MiB`. Registrar cualquier diferencia efectiva antes
  de aceptar una corrida. No generar fixtures dentro de la ventana medida.
- Una sola prueba Playwright activa, `workers=1`, `retries=0`, shell Electron
  empaquetado, build fresco para cada fase. Anotar CPU/RAM/OS, commit,
  lockfile, assets, hashes de fuentes y del build.
- P1 debe mantener 14 entidades y 14 grupos. La primera corrida A1 fija
  su huella con la versión actual del colector; B y A2 deben reproducirla
  exactamente, en frío y caliente. La huella guardada en el informe M-1 se
  calculó con una versión anterior del colector y no se usa como constante.
  P2 debe mantener 13 entidades, 11 grupos, huella OCR
  `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`
  y huella de detección
  `327c988dd2622c4fd69b47a37d424b7704e2ec92449ada99834323de39abf9c8`.
  Son huellas del corpus congelado, no una prueba suficiente de recall general.
- Exigir `PIPELINE_READY`, sin `PIPELINE_FAILED`; `nerMs > 0`; con probe,
  todos los lotes deben traer duraciones del worker. Conservar también los
  conteos de sublotes para saber si cambió la carga de trabajo.

El runner no sobrescribe evidencia. Guarda JSON por sesión/temperatura,
manifiesto por fase y logs bajo `.measure/ner-internal/<timestamp>/`. Hace
snapshot de los dos fuentes, comprueba el patch antes de aplicarlo, restaura
los bytes aun ante fallo, verifica SHA-256 y reconstruye el build normal. Si
el proceso sufre una terminación no atrapable, el snapshot y los hashes
quedan en el directorio de salida para restauración manual antes de seguir.
No usar `git reset` ni `git restore` sobre el árbol completo: hay cambios
de otras tareas sin commit. No hacer commit/push sin autorización humana.

## 4. Ejecución del siguiente agente

Leer `Contracts.md`, `NER_Engine.md`, `Code_Standards.md` y
`AI_Development_Guide.md` completos, en el orden de `AGENTS.md`. Revisar
este plan y el reporte M-2. Luego:

```bash
bash tests/perf/run-ner-internal-profile.sh --smoke
ANONLY_NER_SMOKE_PROFILE=p2 bash tests/perf/run-ner-internal-profile.sh --smoke
bash tests/perf/run-ner-internal-profile.sh
```

Si falla un smoke, conservar el directorio y diagnosticar el arnés antes de
la serie completa. Las salidas A1/B/A2 son mediciones separadas; no mezclar una P1
instrumentada con una P2 sin instrumentar como si fueran una serie.

Validar primero la **identidad de calidad y de carga** en las tres fases.
Publicar todas las filas crudas, mediana/rango para frío y caliente, por P1 y
P2. Por corrida B, reconciliar:

`NER_STARTED→NER_FINISHED ≈ chunkMs + Σ(dispatchMs) + mappingMs + emitMs + resto del host`.

La igualdad es aproximada porque hay tiempo de loop, eventos de página y
trabajo entre marcas. Reportar el residuo; no renombrarlo como tiempo de
otro motor. Dentro de cada lote, `totalMs ≈ modelLoadMs + textPrepMs +
tokenBudgetMs + classifyMs + aggregateMs + otherMs` por construcción. Si
`otherMs` es negativo más allá de redondeo o falta un lote, invalidar la
corrida y revisar el probe. **No sumar tiempos inclusivos** con sus
componentes ni atribuir `dispatchMs - totalMs` enteramente a la cola.

La secuencia A1/B/A2 es el control del overhead: comparar B con el rango de
ambas A para la misma temperatura y fixture. Si el probe altera el tiempo
total de NER o de Ready en una magnitud similar al componente que se intenta
atribuir, bajar su frecuencia o usar otro instrumento y repetir. La campaña
anterior no tuvo este control A/A; por eso se incorpora acá.

### Validación inicial del arnés

Se ejecutó `--smoke` una vez con P1 y una vez con P2. Las salidas están en
`.measure/ner-internal/20260917T134731Z/` y
`.measure/ner-internal/20260917T134933Z/`. Ambos ciclos A1/B/A2 completaron
`PIPELINE_READY`, conservaron las huellas y conteos dentro de sus tres
fases, registraron métricas del worker para todos los lotes de B (10 en P1,
50 en P2), restauraron hashes de los dos archivos fuente y reconstruyeron el
build normal. P2 reprodujo además las huellas fijas de OCR y detección de M-2.

En el smoke P2 caliente, `NER_STARTED→NER_FINISHED` fue 2.514 s (A1),
3.334 s (B) y 2.665 s (A2). **Una sesión por fase no permite estimar el
overhead** ni asignar esa diferencia al patch; es justamente el motivo para
correr las tres sesiones por fase y revisar dispersión antes de decidir.
Los datos del smoke prueban el funcionamiento del arnés y quedan excluidos
de la serie completa.

## 5. Decisión después de medir

Una oportunidad pasa a propuesta de implementación solo si aparece
consistentemente en las tres sesiones de P2, representa al menos **0.5 s**
en mediana y excede claramente la variación A1/A2. Es un filtro para
investigar, no permiso para cambiar arquitectura. Casos orientativos:

| Si domina | Siguiente pregunta, sin decidir el cambio por adelantado |
| --- | --- |
| `modelLoadMs` frío | ¿Cuántos workers cargan modelo y cuánto se reutiliza en caliente? |
| `classifyMs` en ambos | ¿Qué lotes/textos lo concentran y qué costo impone el modelo? |
| `tokenBudgetMs` o muchos cortes | ¿Cuánto cuesta medir tokens para conservar cobertura completa? |
| `dispatchMs - totalMs` | ¿Es cola real, serialización o scheduling? Hace falta instrumento específico. |
| `mappingMs`/`emitMs` | ¿Qué operación del host explica el costo? Evitar atribuir listeners a NER puro. |

Una optimización futura requiere ADR y handoff de un módulo, A/B sobre los
mismos fixtures con tres pares independientes, reducción neta del tiempo de
`import→Ready` por encima de ruido/overhead y huellas de calidad idénticas
en los corpus relevantes. Si altera detección, agregar revisión de entidades
caso por caso y baseline de calidad de ADR-147. Cualquier pérdida de
detección descarta el candidato. Si no hay componente robusto, cerrar la
investigación sin cambio de producto.

**Entregable esperado del subagente:** informe con manifiestos, todas las
mediciones crudas, agregados, error de reconciliación, control A1/B/A2,
calidad, límites del instrumento, recomendación o descarte y confirmación
de hashes/restauración. No debe implementar una optimización en esta fase.
