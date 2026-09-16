<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/OCR_Engine.md,core/Orchestrator.md,architecture/05_Worker_Architecture.md,adr/ADR-119-La-Orientacion-Se-Detecta-Con-El-Motor-Que-La-Sabe-Leer.md,adr/ADR-143-Las-Imagenes-De-OCR-Se-Producen-Cuando-Hay-Lugar.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-157-El-Pool-De-OCR-Se-Da-De-Baja-Al-Terminar-Su-Etapa.md,adr/ADR-160-El-Worker-De-OCR-No-Decodifica-La-Pagina.md,roadmap/T5_OSD_Compartido_Handoff.md | audiencia=planificador+implementador+revisor | fase=11 -->

# ADR-164 — Un OSD compartido por Core

- **Estado**: Accepted, implementado y validado; T5 cerrada el 2026-09-15. Ver `roadmap/T5_OSD_Compartido_Cierre_Final.md` para aceptación, datos y límites. ImageData se evalúa por separado.
- **Fecha**: 2026-09-13.
- **Decidido por**: el humano autoriza documentar, implementar con un subagente Luna y comparar el diseño actual con dos reconocedores que comparten OSD.
- **Parte de**: T-5, campaña de optimización de memoria. Autoriza una campaña de varios módulos, separados por responsabilidad (ADR-124); no autoriza commits ni push.
- **Control BEFORE**: `48961510e004c62f39669de7760a41d8361ef49f`, que ya incluye T-4 y T-6a. No reutilizar las cifras históricas de T-1/T-2 como control.

> **Revisión de planificación, 2026-09-15:** el humano autoriza continuar con
> el mismo implementador Luna. §2.3 formaliza la página adicional elegida el
> 2026-09-14 y sustituye el límite inicial sin adelanto. El diagnóstico de
> `roadmap/T5_OSD_Investigacion_Scheduling.md` justifica esta evolución; no es
> aceptación funcional ni demostración de ahorro RSS. El handoff incluye las
> correcciones de la revisión r4 y una nueva comparación contra el control.

> **Cierre posterior:** las notas de reanudación siguientes conservan el
> contexto de las decisiones. Dispose y los pendientes funcionales ya fueron
> resueltos; prevalece el informe de cierre final. No se afirma ahorro RSS.

## 1. Problema y decisión

**Ratificación del humano tras la campaña A/B/C, 2026-09-15:** se conserva
OSD compartido y una página de adelanto por la reducción de tiempo observada,
aun sin ahorro de memoria demostrado. Esta decisión sobre el diseño no cierra
los defectos de dispose ni las pruebas de aceptación pendientes. La corrección
ImageData se revisa como arreglo funcional separado y no condiciona volver al
OSD duplicado. No convertir RSS variable en afirmación de memoria equivalente.

Cada OcrWorker carga hoy dos instancias de Tesseract: LSTM para reconocer y
legacy con `osd` para detectar orientación. Con `ocrPoolSize: 2` son cuatro
instancias. La carga de OSD ya es perezosa; moverla a otra función no elimina
la duplicación entre entornos de Web Worker.

Se introduce un **worker de orientación único por instancia de Core**, con una
cola de concurrencia uno, que atiende todas las páginas/regiones de ese Core.
Los dos workers de reconocimiento conservan una instancia LSTM cada uno.
Producción pasa de cuatro a tres instancias Tesseract, más un wrapper ligero
propio para orientación. No se comparte memoria WASM ni se usa SharedWorker.

La orientación se determina sobre **cada imagen**, antes de reconocerla. No se
muestrea el documento, no se hereda el ángulo de otra página y no se activa OSD
según la confianza del reconocimiento. Se mantienen OEM legacy, modelo `osd`,
escala 0,5, piso de confianza y convención de ángulos de ADR-119/160.

El tamaño del pool LSTM, los presets, los idiomas, el DPI y el presupuesto de
imágenes no cambian. El objetivo de esta tarea es medir compartir OSD a igual
concurrencia; probar tres/cuatro reconocedores queda fuera de T-5.

## 2. Reparto host / workers

`OcrEngine` sigue host-side y conserva sus interfaces de procesamiento.
`processPage` realiza, dentro de su único loop de reintentos:

1. Dispatch de orientación al puerto `orientationPool`, espera y decodifica.
2. Dispatch al puerto LSTM existente, con la imagen original y el ángulo.
3. Decodifica palabras, deposita en cache y emite `OCR_PAGE_FINISHED`, como hoy.

La reserva de `processSession` cubre **ambos pasos**, incluida la espera de
orientación y de reconocimiento, hasta éxito/fallo/cancelación. La ventana de
consumidores se define en §2.3; sustituye el límite inicial de ADR-143 sin
cambiar su contabilidad por bytes. No hay barrera de orientación del documento
completo. Mientras dos LSTM reconocen, el OSD puede atender otro consumidor.
Las dos regiones de una misma página se
correlacionan por jobId, nunca solo por `(documentId, pageIndex)`.

### 2.1 Transporte

Se reutiliza `WorkerPool` y `startWorkerEntry`. Se añaden:

- `WorkerJobType`: `"ocr-orient"`.
- `WorkerEntryKind`: `"ocr-orientation"`.
- `PoolKey` del façade: `"ocr-orientation"`; se excluye de `ManagedPoolKey`,
  junto con `"export"`. No se agrega pool al WorkerPoolManager.
- Factory `runtime.workers["ocr-orientation"]`, proporcionada por la app con
  `@anonly/ocr-engine/orientation-worker?worker`.
- `orientationPool`: construido por `createCore`, `size: 1`, cola máxima
  `workerPool.maxQueuePerPool.ocr`, prioridad 90, backoff/idle de la config
  existente. Se inyecta como segundo argumento de `new OcrEngine(pool?,
  orientationPool?)`. Sin argumento se usa una cola local exclusiva.

La cola local no puede ser el `IMMEDIATE_POOL` sin exclusión: dos llamadas
simultáneas no deben entrar al mismo Tesseract. Cada `OcrEngine` sin transporte
posee su propia instancia de kernel de orientación, creada perezosamente.
No se introduce un singleton de OSD global al módulo host ni se comparte entre
dos Core independientes. El fallback de reconocimiento existente no se amplía
a un nuevo pool LSTM en esta tarea.

No se agrega una dependencia: Tesseract y la infraestructura de pools ya
existen. No se sustituye WorkerPool por el scheduler de Tesseract: conservar
el transporte actual evita un segundo sistema de correlación/cancelación.

### 2.2 Payloads y resultado

Declarados primero en Contracts.md §7.2:

```ts
export type OcrOrientation = 0 | 90 | 180 | 270;

export interface OcrOrientationPayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly image: EncodedPageImage;
  readonly languages: ReadonlyArray<string>;
  readonly timeoutMs: number;
}

export interface OcrOrientationResult {
  readonly orientation: OcrOrientation;
}
```

`languages` conserva el contexto del error de carga de ADR-119; el modelo
efectivamente cargado sigue siendo solo `osd`. `timeoutMs` es el valor efectivo
de `workerPool.timeouts["ocr-orient"]`, explícito en el payload: no depende del
INIT de config que el pool todavía no envía de forma general.

`OcrPagePayload` gana **`readonly orientation: OcrOrientation` requerido**.
Ausente/inválido se rechaza con `InvalidInputError` en el entry/kernel de
reconocimiento; nunca se reemplaza por 0 ni se crea un OSD de reserva dentro de
un LSTM. La interfaz pública `OcrPageInput` NO gana este campo: sigue pidiendo
OCR completo y es el motor quien determina la orientación.

El motor valida el resultado remoto como objeto y ángulo exacto de la unión.
Un sobre roto no equivale a una detección no concluyente. No se acepta un cast
en lugar del decoder. Mismo guard para el fallback.

Los bytes PNG se **clonan** en los dos despachos y se retienen para reintentar.
El OSD decodifica únicamente a media escala dentro de su worker. El LSTM sigue
recibiendo el PNG original y conserva íntegros los caminos de ADR-160, rotación,
franjas de ADR-121/162 y conversión px→pt. El presupuesto sigue siendo RGBA
estimado; no se cambia a bytes PNG.

### 2.3 Una página adicional en preparación (revisión 2026-09-15)

Separar el número de reconocedores del número de solicitudes en curso, sin
agregar configuración pública ni falsear `ctx.config.workerPool.ocrPoolSize`:

- Para `ocrPoolSize === 2` y un puerto de reconocimiento inyectado, permitir
  `min(3, requests.length)` consumidores en `processSession`. El pool LSTM
  mantiene su tamaño 2 y OSD su tamaño 1. La capacidad adicional es exactamente
  **un descriptor**, que puede estar produciéndose, orientándose o esperando
  reconocimiento; no promete que siempre haya una página ya orientada.
- Con `ocrPoolSize === 1` conservar un consumidor: no ampliar `lowResource`.
  Sin puerto de reconocimiento inyectado, conservar el límite previo de
  consumidores y el fallback existente. Otros tamaños explícitos conservan su
  límite previo; ampliar esas configuraciones queda fuera de esta medición.
- Cada consumidor reserva RGBA estimado **antes** de producir y conserva esa
  reserva durante OSD, espera LSTM y retries hasta asentarse. Default 128 MiB,
  sin presupuesto adicional para PNG ni cache de páginas orientadas. Si solo
  caben una o dos imágenes, esperar presupuesto; nunca subirlo ni reducir DPI.
- Usar los consumidores existentes, con la ventana separada del tamaño físico.
  No agregar una segunda cola de imágenes, una prepasada ni un tercer LSTM.
  `processPages` mantiene imágenes del caller y `estimatedBytes: 0`; conserva
  resultados y eventos, con la misma ventana acotada de `processSession`.
- Resultados por índice de request, nunca por orden de llegada ni un mapa por
  pageIndex. Regiones repetidas conservan su propio PNG, ángulo y escala. Cada
  retry vuelve a orientar su imagen; no se heredan ángulos entre requests.
- `OCR_STARTED` precede toda producción y `OCR_FINISHED` sucede después de
  completar la sesión exitosa, una vez cada uno. Conservar cache → evento por
  imagen, fallos por página y cancelación existentes. Al abortar no se admiten
  nuevos descriptores ni se reconoce la imagen adelantada todavía en espera;
  liberar sus reservas y referencias en todos los caminos.
- La guarda de `releaseIdleWorkers()` incluye solicitudes admitidas que aún
  estén produciendo/esperando presupuesto, además de `processPage`: no liberar
  entre preparar la imagen y despacharla. Contadores se liberan al asentarse
  el trabajo real, también si la promesa de sesión ya rechazó. No introducir
  timers de liberación ni dejar referencias a PNG entre sesiones.

La prueba discriminante bloquea dos reconocimientos y observa la orientación
del tercer request **antes de desbloquearlos**, sin producir el cuarto hasta
liberar un consumidor. Afirma además máximo dos reconocimientos y un detect.
Separar esta prueba del test de presupuesto: con capacidad para dos imágenes,
la tercera producción debe esperar aunque exista el consumidor adicional.

## 3. Kernel y ciclo de vida

Crear `worker/orientation-kernel.ts` con una fábrica interna de estado por
instancia, `createOrientationKernel()`, y `worker/orientation-entry.ts` con
`startWorkerEntry`, jobType `ocr-orient` y capacidad de batch 1.

Mover la carga OSD, `buildOsdImage` y la lectura de orientación desde el kernel
actual a ese módulo, conservando su comportamiento. Las rutas first-party y
su resolución se extraen a un helper interno compartido por los dos kernels;
no duplicar constantes/resolución de URLs. La geometría del reconocimiento
permanece en `worker/kernel.ts`; `Rotation` puede ser alias de `OcrOrientation`.
El kernel LSTM deja de poseer/cargar/disponer OSD y toma el ángulo del payload.

La fábrica OSD cachea la **promesa de inicialización**, no solo el worker ya
creado, y protege el estado con una generación. Una inicialización que termina
después de cancelación/disposición no puede publicar una instancia vieja:
termina ese worker en cuanto aparece. Un fallo de inicialización limpia la
promesa para que una nueva operación pueda crear una instancia válida.

**Recuperación obligatoria, precisión de la revisión r4:** invalidar una
generación desvincula también su promesa `initialization`, aunque siga
pendiente. La siguiente solicitud crea una promesa nueva sin esperar la vieja.
La finalización tardía solo limpia su propio worker, y su `finally` no borra
la inicialización nueva. `dispose()` no espera una carga invalidada que puede
no resolver nunca: mantiene su limpieza tardía registrada sin bloquear la
disposición ni producir rechazos no manejados. Probar ambos casos sin resolver
la carga vieja para hacer pasar artificialmente el test.

### 3.1 Cancelación, timeout y errores

- Default de `timeouts["ocr-orient"]`: **60 000 ms**. Default de
  `maxRetries["ocr-orient"]`: **0**. Hay que actualizar todas las réplicas
  exhaustivas de Record<WorkerJobType, number>, incluidos fixtures de tests.
- Ambos dispatch de una página pasan `maxRetriesOverride: 0`.
  `maxRetries["ocr-page"]` sigue siendo el único límite de reintentos de
  `processPage`. Un timeout OSD usa `OcrTimeoutError` y reintenta la operación
  de página (orientación y reconocimiento); no se multiplica por otro retry.
- El deadline OSD empieza cuando su job obtiene turno, y cubre carga,
  decodificación y `detect`. La espera de la cola es cancelable, tiene cola
  acotada y su predecesor tiene ese deadline; no se redefine aquí el timeout
  histórico de las pasadas de reconocimiento.
- Abort antes de obtener turno: no crear worker, no decodificar ni despachar
  LSTM. Abort en vuelo: rechazar como `CancelledError`, terminar la instancia
  Tesseract OSD en uso e invalidar su generación. El siguiente job crea otra.
  Un timeout hace lo mismo antes de permitir el siguiente trabajo.
- No basta `Promise.race` dejando la instancia en uso: Tesseract no cancela
  `detect` por job y un siguiente request podría pisar su estado. La envoltura
  propia responde a CANCEL mientras el WASM corre en su worker hijo.
- Limpiar timers/listeners y liberar ImageBitmap en todos los caminos; si una
  decodificación tarda y termina después de abort, cerrar el bitmap tardío.
  Todo trabajo tardío debe comprobar su generación antes de usar Tesseract.
- `detect()` que no concluye/rechaza conserva fallback 0 (ADR-090/119).
  Timeout y cancelación se manejan fuera de ese catch y **no** caen a 0.
  Carga imposible: `OCR_MODEL_MISSING`; decodificación imposible: fallo de
  página; crash del wrapper: `WORKER_CRASHED` del transporte, fallo de página,
  siguiente job en worker reconstruido. Nunca disfrazar esas fallas como 0.
- A través del boundary se discrimina por `EngineErrorCode`, también para
  `OCR_MODEL_MISSING` y `CANCELLED`. Corregir los instanceof concretos de los
  catch afectados que impedirían conservar esa semántica remota.

### 3.2 Liberación

`OcrEngine.releaseIdleWorkers()` cubre ambos puertos y el OSD local. No hace
nada mientras exista trabajo admitido de sesión (§2.3) o una llamada
`processPage` activa de esa instancia, incluidas espera OSD y retry. Contar
operaciones con finally, no con éxitos.
Al terminar la etapa el caller existente de ADR-157 libera ambos; no hay nuevo
caller ni timer global. La firma pública sigue siendo `void`: una limpieza
local async debe quedar registrada y el siguiente trabajo esperarla, sin
carrera ni rechazo no manejado. `dispose()` la espera y es terminal.

`createCore.dispose()` dispone los dos pools; el motor dispone su fallback.
Un reanálisis recrea perezosamente los recursos. Cerrar o cancelar no deja OSD
global residente ni mata trabajos ajenos de otro Core. La liberación ociosa
del pool existente conserva su propia guarda.

## 4. Eventos e integración

No se agrega EngineId, EventChannel, EngineEvents ni EngineErrorCode.
`ocr-orient` usa los eventos `WORKER_JOB_*` existentes en canal Workers; los
eventos de dominio siguen siendo una sesión OCR y un resultado/fallo por
página. La UI no cuenta el fallo de transporte de orientación como una
segunda página fallida: `OCR_PAGE_FAILED` sigue siendo la fuente OCR del aviso.

Actualizar la app para proporcionar las dos factories siempre, con exports
src/dist del subpath nuevo, y sus mocks de Vite. Los otros motores y el
Orchestrator no calculan ni consumen el ángulo.

## 5. Pruebas y aceptación funcional

Las filas normativas están en OCR_Engine.md §14 y el reparto por módulo en el
handoff. Se requiere además:

1. Prueba estructural discriminante: dos jobs LSTM concurrentes y varios OSD
   producen 2 workers Tesseract LSTM y 1 OSD; `maxDetectInFlight = 1` y existe
   solapamiento OSD/LSTM. El diseño BEFORE tiene 2 OSD.
2. Dos Core/fallbacks independientes no comparten ni terminan el OSD ajeno.
3. Pruebas de cola cancelada, abort/timeout en carga y detección, resultado
   tardío, fallo de carga remoto, sobre inválido, liberación activa/ociosa y
   reanálisis. Promesas asentadas y timers/listeners limpios.
4. Geometría/orden/confianza/palabras conservados con 0/90/180/270, incluyendo
   orientaciones mezcladas y regiones con pageIndex repetido. Tests del kernel
   LSTM pasan el ángulo; tests de processPage siguen ejercitando ambos pasos.
5. E2E Electron real confirma entidades y censura/geométrica de las páginas
   giradas; los mocks no verifican carga de assets ni aislamiento real.
6. Ventana de §2.3, presupuesto para una/dos/tres imágenes, fallback y
   lowResource; liberación durante producción, cancelación de imagen adelantada
   y resultados por índice aun con terminación desordenada. El reanálisis
   realmente ejecuta una segunda etapa OCR tras liberar la primera.

La cobertura de OCR permanece ≥85% y aplican todos los gates de
07_Performance_Strategy.md §11.4. Una medición favorable no reemplaza tests.

### 5.1 Conservación externa: criterio cerrado por el planificador (2026-09-15)

Esta sección resuelve la ambigüedad elevada por el nuevo implementador Luna.
Aplica exclusivamente a las cinco regiones externas del fixture sintético
T5, definidas por `t5PixelOrientationGroundTruth`. No es un criterio de calidad
OCR general, ni cambia la compuerta exacta de márgenes de ADR-162.

1. Renderizar fuente escaneada y PDF exportado con el mismo pdf.js, fondo
   blanco explícito, `scale = 2` (144 DPI), sin normalizar tamaño ni registrar
   imágenes para compensar desplazamientos. Exigir iguales dimensiones de
   página y de recorte. Para cada rectángulo en puntos: `x0=floor(2*x)`,
   `y0=floor(2*y)`, `x1=ceil(2*(x+width))`, `y1=ceil(2*(y+height))`. Usar todos
   los píxeles del recorte; rectángulos vacíos/fuera de página fallan.
2. Componer RGBA sobre blanco. Con `a=alpha/255`, definir
   `v=a*(r+g+b)/3+(1-a)*255`; la máscara de tinta es `v < 128`. Exigir tinta
   presente en fuente y exportación. Este umbral discrimina el texto negro
   sintético; no se aplica a tinta tenue de documentos reales.
3. Comparación espacial bidireccional. **Recall**: fracción de píxeles de
   tinta de la fuente que encuentran tinta exportada en el mismo píxel o en
   sus ocho vecinos (radio Chebyshev 1). **Precisión**: fracción de tinta
   exportada que encuentra tinta fuente bajo la misma regla. No envolver
   índices en los bordes; un denominador cero hace fallar el criterio.
4. Cada región debe cumplir **recall >= 0,95 y precisión >= 0,95**. No promediar
   páginas para ocultar una región fallida. Radio 1 equivale a 0,5 puntos PDF
   y admite diferencias locales del rasterizado/JPEG; el máximo 5% sin pareja
   tolera variaciones pequeñas, sin confundir presencia de negro con texto
   conservado. No se autoriza aumentar radio ni reducir mínimos para aprobar.
5. Controles con el mismo comparador: fuente contra sí misma pasa; sustituir
   la imagen candidata de cada recorte por negro opaco falla; sustituirla por
   blanco opaco también falla. Los controles actúan sobre píxeles antes de
   generar máscaras, no sobre estadísticas fabricadas. Son negativos de
   test: no modificar la exportación ni el pipeline de producto. Conservar
   además las pruebas existentes de censura por región sensible.
6. Guardar JSON del E2E con dimensiones, número de píxeles de tinta,
   precisión/recall por región y controles. Informar el PDF exacto de esa
   ejecución, no un glob ni el artefacto de una ejecución histórica.

Diagnóstico previo del planificador (fuente regenerada con el mismo generador,
exportación de Luna `orientation-1789491660334/anonymizado.pdf`, Chromium
headless): las cinco regiones dan precisión/recall 1,0; negro opaco da precisión
0,155–0,162 y falla; blanco falla sin tinta. Artefactos reproducibles en
`.measure/t5-external-review/diagnostic.ts` y `results.json`. Se fijó el criterio
antes de incorporarlo a los tests; este diagnóstico no sustituye el E2E
Electron ni mide tiempo/memoria del OCR. Una falla futura se reporta al
planificador con imágenes/estadísticas; el implementador no calibra el umbral.

## 6. Comparación autorizada y límites de la inferencia

**Ampliación autorizada por el humano tras revisión, 2026-09-15:** ejecutar
la separación por etapas de handoff §0: A original, B OSD compartido/adelanto
sin corrección ImageData, C igual a B más esa corrección. Medir/anotar A↔B
antes de incorporar C y medir B↔C. A/B son controles diagnósticos que conservan
el fallo histórico de rotaciones: esta autorización no relaja los requisitos
de calidad del producto ni adopta omitir reconocimiento para ahorrar tiempo.
La corrección nativa restituye los caminos ya exigidos por OCR §13 casos
12/16; su efecto incluye márgenes y páginas giradas completas. Preservar el
diff como cambio funcional separado del scheduling. Restaurar el candidato
completo al finalizar; aceptación y cualquier regresión temporal quedan para
el planificador/humano, no para el implementador.

Protocolo ejecutable en `roadmap/T5_OSD_Compartido_Handoff.md` §3.
BEFORE = 2 LSTM + 2 OSD y dos consumidores; AFTER = 2 LSTM + 1 OSD y hasta tres
consumidores bajo el mismo presupuesto. Un mismo fixture congelado, build
fresco por condición y versión idéntica del instrumento. La mejora diagnóstica
de ~24% compara contra el compartido sin adelanto, no contra este BEFORE.

`Runtime.getHeapUsage` no observa la memoria lineal WASM (T-1/ADR-159); la suma
de heaps no cuantifica el OSD. Comparar RSS por proceso y pico de la suma
simultánea en ventana OCR, tiempo y calidad, conservando serie cruda y
dispersión. La evidencia estructural de una instancia menos es independiente
de que el RSS permita resolver su tamaño. No atribuir aritméticamente a OSD el
residuo RSS−heaps ni prometer los 99 MB históricos de ADR-119.

Se autoriza la implementación para medir, **no se declara de antemano una
mejora de tiempo ni un ahorro mínimo de MB**. Si el ruido domina o hay pérdida
de throughput/calidad, reportar resultado inconcluso/regresión y volver al
planificador; no ajustar DPI, pools, corpus o umbrales para obtener verde.

## 7. Fuentes técnicas verificadas

- [Scheduler de Tesseract.js 6.0.1](https://github.com/naptha/tesseract.js/blob/v6.0.1/src/createScheduler.js): reutilización con un job por worker.
- [Worker de Tesseract.js 6.0.1](https://github.com/naptha/tesseract.js/blob/v6.0.1/src/worker-script/index.js): estado TessModule/API por instancia, detect sobre la imagen del job.
- [Rendimiento de Tesseract.js 6.0.1](https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/performance.md): reutilizar workers y acotar su número.

Estas fuentes respaldan viabilidad, no sustituyen la medición de Anonly.
