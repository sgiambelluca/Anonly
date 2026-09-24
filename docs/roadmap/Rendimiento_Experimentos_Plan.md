<!-- CONTEXT: scope=roadmap-plan | dependencias=roadmap/Optimizacion_De_Rendimiento.md,roadmap/Optimizacion_De_Memoria_Plan.md,roadmap/Ciclos_Y_Documentos_Reales_Medicion.md,roadmap/Banco_Windows_Comparativa_Medicion.md,core/NER_Engine.md,core/OCR_Engine.md,core/Regex_Engine.md,core/Grouping_Engine.md,core/Contracts.md,adr/ADR-147-Perder-Un-Identificador-Cubierto-Es-Una-Regresion.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (protocolo para la campaña de rendimiento; 2026-09-23) -->

# Campaña de rendimiento — protocolo y condiciones de avance

Este documento concreta los «Próximos objetivos» de
[`Optimizacion_De_Rendimiento.md`](Optimizacion_De_Rendimiento.md). Es un plan de
**medición**, no una autorización para cambiar defaults, presupuestos, contratos
o perfiles. Cada brazo vuelve a la configuración de producto al terminar. La
decisión de incorporar una variante corresponde al humano después de leer la
curva de tiempo, memoria y calidad. ADR-168 a ADR-172 están reservados en otra
tarea: no se usan en esta campaña.

## Orden y entregas

1. **NER: control efectivo, 4, 6 y 8 hilos.** Construir y medir un brazo por
   vez sobre un único worker/modelo NER. Cerrar un informe de curva antes de
   comenzar OCR.
2. **OCR: 2, 3 y 4 reconocedores.** Conservar un OSD compartido. Cerrar un
   informe de curva antes de revisar perfiles.
3. **Perfiles: revisión documental de 1 y 2.** Proponer la matriz y la política
   automática solo donde ambas curvas tienen evidencia. Cualquier implementación
   de settings/UI/Core requiere ADR y specs propios, con migración definida.
4. **NER: varios fragmentos por inferencia.** Primero medir factibilidad de la
   API de `@huggingface/transformers` instalada y su backend Chromium/WASM con
   entradas independientes. Si es viable, el planificador escribe ADR y actualiza
   `Contracts.md`/`NER_Engine.md` y los specs de consumidores afectados **antes**
   de encargar código de producto. Si no, registrar la incompatibilidad y cerrar
   el experimento sin alterar el motor.
5. **Regex y Grouping: casos patológicos.** Reproducir cada curva en el código
   vigente y en documentos normales. Después planificar **dos tareas y dos
   módulos separados**; cualquier algoritmo nuevo exige spec/ADR del módulo
   antes de implementarse. La revisión de perfiles no espera estos dos casos.

El orden 3 después de 1 y 2 responde a la dependencia explícita del objetivo 5
del plan original. Los objetivos 3 y 4 del plan original se mantienen tras esa
revisión. No hay dos mediciones de Electron/Playwright simultáneas.

## Reglas comunes del banco

- **Mismo código y mismos assets** entre brazos salvo la variable declarada.
  Registrar commit, árbol sucio, versión de Electron/Node, plataforma, CPU,
  RAM visible, hashes de build/asset y valor solicitado **y efectivo**. Un
  valor solicitado sin prueba de efecto no constituye un brazo medido.
- Construir cada brazo desde la misma revisión y conservar `dist` y sus hashes
  como en T-12. No usar una tanda «antes» y otra «después»: ejecutar órdenes
  alternados, por ejemplo A→B→B→A, con al menos tres pares completos por
  configuración y repetir controles. Separar frío y caliente; comparar cada
  plataforma con su propio control, nunca Mac contra Windows como A/B.
- Ejecutar en el shell Electron empaquetado, con Web Workers reales, contra P1
  (nativo), P2 (escaneado) y **también R1/R2 reales** por las variables de
  entorno y la confidencialidad de T-10. El humano ratificó el 2026-09-23 que
  la curva de producto necesita R1/R2 porque los sintéticos y reales ya dieron
  resultados distintos. No copiar PDFs reales, nombres, texto, OCR ni tokens a
  `.measure/` o al repo. Si faltan las rutas, se puede cerrar el banco de
  fixtures como control, pero **no** el objetivo ni la decisión de perfil.
- Registrar `import→Ready`, carga e inferencia NER, OCR total, preparación,
  cola, ocupación por worker y panel visible donde aplique. Registrar M1, M2,
  pico posterior a `Ready`, WASM/heap observable, RSS del árbol, presión del
  sistema y ausencia de datos; no sumar/restar estas métricas como si cerraran
  un balance. Conservar corridas individuales, deriva de controles e impacto
  del instrumento. Las corridas de tiempo sin sonda de memoria corroboran que
  el instrumento no fabricó la ganancia.
- Caracterizar **trabajo por página**, no solo cantidad de páginas: contar
  palabras del PDF (`PAGE_PARSED.wordCount`) o del OCR
  (`OCR_PAGE_FINISHED.wordCount`), **caracteres de las palabras** cuando el arnés
  pueda sumarlos en memoria sin conservar el texto, páginas sin texto, jobs de
  inferencia NER y, cuando se pueda observar sin sacar texto del renderer,
  distribución de tokens por fragmento. Registrar mediana, rango y percentiles
  altos por página con números solamente; comparar también páginas de densidad
  semejante entre brazos. No dividir el tiempo total por páginas y llamarlo
  costo del motor; declarar expresamente cualquier contador no observable.
  T-10 midió unas 300 palabras/página en R2 frente a unas 20 en P2: dos PDFs
  de 50 páginas pueden exigir tiempos muy distintos. El humano volvió a
  señalar el 2026-09-23 que la densidad de letras, no el número de páginas,
  gobierna el trabajo de estos motores. No usar páginas como único denominador
  ni llamar representativo a P2 por su longitud.
- Comparar huella exacta de detecciones y agrupaciones por documento; además,
  ejecutar el gate de calidad de ADR-147 sin promover su baseline. Cualquier
  pérdida cubierta, falso positivo nuevo, página fallada o salida vacía invalida
  la variante. Registrar cancelación ejercitada durante trabajo activo, no un
  `cancel()` después de terminar. La calidad del OCR se coteja también con el
  control escaneado del mismo corpus.
- Aplicar las cautelas operativas de `Optimizacion_De_Memoria_Plan.md` §2bis:
  verificar que no haya otro Playwright/vitest; no pisar JSON previos; declarar
  presión y límites de observación. Windows se mide **nativo**, no en WSL. Si
  esta tarea solo tiene Mac, cerrar el informe local como «macOS» y conservar
  Windows pendiente; no extrapolar una política automática entre plataformas.
  El humano confirmó el 2026-09-23 que la MacBook Air sin ventilador puede
  perder velocidad por calentamiento progresivo: informar cada corrida en
  orden cronológico, la deriva entre controles A y pares locales, y no llamar
  ganadora a una diferencia que cabe en esa deriva. **Después de la campaña
  Mac se repiten las pruebas en Windows nativo ventilado** antes de elegir una
  configuración de producto.
- Evitar reposo del equipo durante la campaña y registrar pausas/suspensiones.
  Una suspensión invalida el bloque intercalado afectado: conservar el archivo
  crudo, repetir el bloque completo en otra carpeta y excluir el anterior del
  agregado. El humano informó una suspensión durante el primer bloque de
  tiempo R2 de OCR el 2026-09-23/24; sus anomalías no se atribuyen al pool.

## 1. Brazo NER: hilos de ONNX

El control A usa la selección automática actual de ONNX, sin línea añadida en
`configureTransformersEnv` (`ner-engine/src/worker/kernel.ts`). Los brazos B/C/D
solicitan `numThreads = 4/6/8` respectivamente **solo en builds opt-in del
banco**; una única línea temporal por brazo, como el precedente T-12. No se
agrega `NerConfig` ni override de producto para esta exploración. La captura
debe confirmar el número efectivo de hilos de ONNX en el worker real (por
API/observación validada de los workers del runtime); si una solicitud se
reduce por hardware o entorno, registrar el valor efectivo y no llamar a ese
brazo «8 hilos». Confirmar `crossOriginIsolated`, `SharedArrayBuffer`, mismo
ONNX Q8 y un único worker NER. No medir 6/8 si el equipo no puede ejecutarlos;
marcarlos no aplicables.

El informe muestra por brazo y documento: hilos efectivos, carga, inferencia,
`Ready`, panel, memoria de carga/sostenida y estrés de varias importaciones.
Presenta curva de ganancia incremental frente al costo de memoria y la deriva
del control; no fija un ganador por el menor tiempo de una corrida. El brazo
del producto sigue en automático hasta decisión posterior y su ADR.

## 2. Brazo OCR: reconocedores LSTM

Usar el override de arnés de ADR-155 para cambiar **solo**
`workerPool.ocrPoolSize` entre 2/3/4. Mantener `ocr.maxLiveImageBytes = 128 MiB`,
OSD único, idiomas, 300 DPI efectivo conforme ADR-163, composición y heurísticas
de OCR. El control 2 conserva su ventana adelantada de hasta tres requests
(`OCR_Engine.md` §6, ADR-164); distinguir **requests en vuelo** de
**reconocedores vivos/ocupados**. Para cada página registrar la reserva RGBA
estimada y la espera por presupuesto **si una señal directa la expone**; si no,
declararla no observable y distinguir cualquier inferencia de cola/ocupación.
Si 3/4 slots no llegan a reconocer por
el presupuesto, la curva expresa «concurrencia limitada por 128 MiB»; una
segunda campaña que varíe el presupuesto necesita decisión y protocolo propios.

El informe entrega tiempo de etapa y `Ready`, ocupación/cola, memoria por worker
y total, calidad OCR/detección y cancelación en 2/3/4. Los tamaños de pool 3/4
son solo brazos del banco: no alterar defaults ni presets al medir.
R2 es el caso real que ejerce OCR; R1 sirve como control real nativo para detectar
un costo ajeno a la etapa OCR. No atribuir a OCR una diferencia de `Ready` en R1.
Tres rondas intercaladas de tiempo sin sonda cubren P1/P2/R1/R2; tres rondas de
memoria cubren P2/R2, que sí ocupan reconocedores. El tamaño 2 es el control si
el automático lo resuelve efectivamente así; no se repite como cuarto brazo.
La cancelación se ejercita durante OCR activo en R2 al menos una vez por brazo.

## 3. Perfiles: puerta de decisión

Con ambas curvas cerradas, el planificador documenta una propuesta Bajo,
Intermedio, Alto y Automático que separe preferencia persistida de nivel
resuelto. Debe incluir matriz por plataforma/capacidad, umbrales respaldados por
la curva, señales disponibles de CPU/RAM/presión, reserva de SO, ausencia de
datos, cuándo se recalcula, efecto con documento abierto, migración de los
settings `auto|low|high`, y texto visible del nivel resuelto. Si Windows o
documentos reales faltan, la matriz no puede llamarse validada para ellos.
Primero se presenta la propuesta y se decide el compromiso; solo entonces se
escriben ADR, contratos y specs de UI/Core para implementarla.

**Inventario actual para esa revisión:** `buildDefaultEngineConfig` solo lee
`navigator.hardwareConcurrency` y `navigator.deviceMemory` (esta última es
opcional); `settingsToEngineConfig.ts` persiste `auto|low|high` y convierte los
dos niveles manuales en tamaños de pool. El shell no entrega hoy RAM/presión al
Core como contrato de producto. El banco de memoria sí observa presión para
medir, pero eso no convierte su sonda en señal de selección automática. Si la
curva exige memoria disponible, el ADR futuro debe definir un canal seguro del
shell al cliente, con ausencia y permisos claros; no leer el SO desde el Core.

## 4. Brazo NER: lote de fragmentos independientes

Factibilidad antes de arquitectura: comprobar en la versión **instalada** de
Transformers.js el contrato de entrada/salida para una lista de strings, padding
y truncation, y medir en Chromium/WASM un lote de fragmentos de longitudes
parecidas frente a llamadas individuales. Cada fragmento conserva su propio
presupuesto de 512 tokens y sus offsets; no concatenar páginas ni mezclar
orientaciones. Comparar huella exacta, memoria temporal, latencia de lote,
`Ready` y orden de emisión a Grouping. Si el runtime no da una salida mapeable
sin pérdida a cada entrada, registrar el límite. Una implementación host/kernel
que cambie `NerPagePayload`, el protocolo o el orden de `ENTITY_FOUND` requiere
ADR, actualización de contratos/specs y tests de frontera antes de tocar código.
Separar dos oportunidades: los sublotes que ADR-098 ya corta **dentro** de un
`NerPagePayload` podrían agruparse sin cambiar la forma pública del job, mientras
agrupar fragmentos de distintos jobs/páginas cambia correlación y orden de
respuesta. Medirlas como casos distintos y no extrapolar una a la otra.

**Inspección previa, no gate superado:** la versión instalada
`@huggingface/transformers@4.2.0` contiene un
`TokenClassificationPipeline._call(texts)` que distingue `Array.isArray(texts)`,
tokeniza con `{ padding: true, truncation: true }` y devuelve un elemento de
salida por entrada. Eso solo acredita una ruta de API; **no** acredita que el
modelo fijado conserve scores ni que los offsets reconstruidos por
`positionTokens` coincidan en Chromium/WASM; la API devuelve índices de tokens,
pero no offsets de caracteres. Tampoco acredita que el padding
compense. En particular, cada entrada debe pasar el corte por tokens de
ADR-098 antes de entrar al lote: `truncation: true` por sí solo vuelve a perder
la cola silenciosamente. La prueba de factibilidad debe usar un fixture que
falle si se omite ese corte y otro con longitudes dispares que exponga el costo
del padding.

**Factibilidad factual en Chromium/WASM (2026-09-24, aún sin campaña real):**
el batch devolvió un resultado por entrada y conservó índices/spans/offsets
reconstruidos en fixtures, incluido un texto de 1.725 tokens cortado a
508/508/508/207 antes de inferir. Sin ese corte, `truncation` devolvió solo
511 tokens. Los scores sí variaron hasta 0,001486 por token y 0,000141 por
span; por tanto la huella exacta de confianza **no** pasa. Medir si alguna
variación cruza el umbral `< 0,7` que Grouping usa para `low_confidence`, sin
tratarlo como pérdida automática de ocurrencias. El padding de entradas
desparejas también fue alto (87 posiciones para la corta en un lote ancho de
93). La campaña de tiempo y memoria debe separar longitudes semejantes de
desparejas y no declarar calidad idéntica sin comparar el efecto semántico.
Para R1/R2, un arnés puede retener sublotes solo dentro del renderer al
interceptar el job normal de la app y ejecutar un worker de prueba después de
liberar el worker NER de producto; al proceso Node vuelven solo números y
huellas. Si esa contención no se demuestra, el banco real se detiene.

## 5. Brazo Regex y Grouping: reproducir, luego diseñar

Regex: barrer 2/10/20/40/80/160 KiB de texto adverso sin `@`, denso en
dígitos y guiones, junto con páginas normales; medir tiempo de cada patrón,
bloqueo del hilo principal y comportamiento de cancelación. Fijar detecciones
idénticas. Grouping: barrer 250/500/1000/2000 entidades distintas, más corpus
normal con repetición; medir pase difuso, tiempo total, agrupaciones y orden.
Describir el generador y conservar seeds sin contenido personal. Comparar
curvas, no extrapolar un O(n²) de dos puntos. Después redactar por separado
soluciones, pruebas y criterio de aceptación de cada motor. No introducir
timeouts, umbrales o heurísticas nuevos como efecto lateral del benchmark.

## Cierre de cada punto

El implementador entrega scripts/banco y resultados crudos identificables; el
planificador revisa controles, calidad, ruido y límites, escribe el informe y
decide si la documentación del punto siguiente sigue siendo suficiente. Ningún
agente hace `git commit` ni `git push` sin autorización explícita. El cierre de
un experimento no equivale a adoptar un cambio de producto.
