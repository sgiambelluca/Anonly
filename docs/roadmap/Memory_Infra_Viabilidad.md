<!-- CONTEXT: scope=investigacion-memoria-renderer | dependencias=roadmap/Optimizacion_De_Memoria_Plan.md,roadmap/Atribucion_Recursos_Renderer_Medicion.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md | audiencia=humanos+IA | fase=11 -->

# Viabilidad de atribución con MemoryInfra

Fecha: 2026-09-22. Investigación del planificador, cerrada con prueba local.
**Resultado: viable para clasificar asignaciones de Chromium; insuficiente para
atribuir todo el RSS a motores.** La clasificación se aplicó posteriormente al
pipeline y se revisaron sus resultados, cerrando el punto 2 con el alcance medido.
No requirió cambiar Electron, el producto ni dependencias.

**Actualización 2026-09-23:** el instrumento y la campaña definidos al final de
este documento ya se ejecutaron en macOS. El
[informe de atribución](Atribucion_Recursos_Renderer_Medicion.md) contiene las 14
corridas, las fases observables/no observables y la revisión del plan. Se cierra
el punto 2 con la caracterización local y sus límites; Windows queda como
seguimiento separado sin validar. Los puntos 1 y 3 se trabajarán en otra sesión.

## Evidencia local y reproducción

Se consultó el protocolo del binario en ejecución, no solo documentación de la
última versión. Versiones observadas: Electron **44.2.0**, Chromium
**152.0.7977.76**, V8 **15.2.124.19-electron.0**, macOS ARM64.

Artefactos locales, fuera de Git, bajo `.measure/memory-infra-feasibility/`:

- `manifest.json`: commit, estado dirty, plataforma y SHA-256 del shell,
  assets del renderer y scripts exploratorios. Se usó el build existente;
  estas pruebas no certifican frescura ni rendimiento del pipeline.
- `probe-v2.cjs` y `run-rDQXTO/`: control de categorías, `summary.json`,
  `protocol.json`, `trace.json` y extracción `attribution.json`.
- `probe-v3.cjs` y `run-pZlxHZ/`: control adicional con muestreo nativo CDP,
  más `native-profile.json`.
- `probe.cjs` y `run-ABKspo/`: exploración inicial, sustituida por v2 para
  correlación temporal. No usar el GUID devuelto como unión directa al JSON.

Reproducción local: `node .measure/memory-infra-feasibility/probe-v2.cjs`
y luego `node .measure/memory-infra-feasibility/probe-v3.cjs`.
Cada ejecución usa perfil temporal y proceso nuevos y los cierra al terminar.
Solo se crearon objetos sintéticos; no se abrió ningún documento. Los scripts
son evidencia exploratoria, todavía no un instrumento versionado ni un gate.

## Qué se probó

`Tracing.getCategories` expone `disabled-by-default-memory-infra`.
`Tracing.start` con esa categoría y `Tracing.requestMemoryDump` con
`levelOfDetail: detailed`, `deterministic: false`, produjo seis volcados
exitosos en v2. Se recuperaron eventos de memoria de renderer, GPU y otros
procesos, con `allocators`, `allocators_graph` y `process_totals`.

Los seis pedidos de v2 tardaron **42–47 ms**, incluyendo llamadas auxiliares de
correlación. Es duración de la operación en este control pequeño, **no overhead
demostrado del pipeline**. No se combinó con footprint ni con el sampler de heap.
Solo el último control llamó explícitamente a `HeapProfiler.collectGarbage`.
No se ha demostrado que los proveedores internos del dump sean no intrusivos.

El campo `allocated_objects_size`, en bytes hexadecimales, de
`partition_alloc/partitions/array_buffer` dio:

| estado acumulativo | bytes observados | interpretación permitida |
|---|---:|---|
| base | 0 | Sin asignación en esa partición en este control |
| buffer tocado de 32 MiB | 33.554.432 | Detecta exactamente el buffer conocido |
| canvas 4096 × 4096 con dibujo | 33.554.432 | Dibujar no agregó un ArrayBuffer a esa partición |
| `getImageData` de ese canvas | 100.663.296 | Agrega exactamente 64 MiB de píxeles |
| WASM de 64 MiB, tocada | 100.663.296 | Esta partición no contabiliza la memoria WASM del control |
| referencias liberadas + GC explícito | 0 | Los buffers del control desaparecen de esa partición |

En GPU, `skia.size` pasó de 6.881.699 a 74.008.995 bytes después de
`getImageData`: aumento de 64 MiB más 18.432 bytes. Aparecen también categorías
GPU, superficies y recursos con dimensiones. La ejecución gráfica puede ser
diferida: no atribuir todo el salto únicamente a la lectura de píxeles ni asumir
que cada canvas tendrá esa representación. Skia siguió alrededor de 74 MB en la
lectura inmediata posterior al GC; eso no demuestra fuga ni retención prolongada.

No apareció un nodo identificado como WASM que explicara el control de 64 MiB.
Los tamaños raíz de V8 tampoco mostraron ese incremento. Por eso se mantiene el
instrumento de WASM por target de T-11, con sus límites de GC y targets ocupados.
No se probó atribución de código compilado de ONNX/Tesseract.

## Cómo interpretar y correlacionar

MemoryInfra informa categorías del runtime: V8, Blink, PartitionAlloc, malloc,
Skia, recursos GPU y cachés. **No etiquetas `ner-engine` u `ocr-engine`.**
Identificar una categoría no identifica automáticamente su motor propietario.

La documentación diferencia `size` de `effective_size` y describe relaciones de
propiedad para evitar duplicar recursos compartidos. No sumar padres e hijos,
ni `size` de renderer y GPU, ni agregar el WASM de otra sonda a esos subtotales.
La primera implementación conservará el grafo y mostrará contadores específicos
con su definición; no intentará fabricar una suma que cierre contra RSS.
[Semántica de MemoryInfra](https://chromium.googlesource.com/chromium/src/+/main/docs/memory-infra/README.md),
[recursos gráficos compartidos](https://chromium.googlesource.com/chromium/src/+/main/docs/memory-infra/probe-gpu.md).

En el JSON exportado de este binario los IDs fueron `0x0`…`0x5`, mientras las
respuestas CDP devolvieron `0x1`…`0x6`. No aplicar un desplazamiento fijo: **esa
igualdad de IDs no es una precondición válida**. V2 insertó `clock_sync` con
etiquetas antes/después de cada pedido y registró `Performance.getMetrics`
(`Timestamp`, segundos monotónicos). Los eventos de cada dump quedaron dentro
de esa ventana, en microsegundos, y se agruparon por PID e ID exportado.
Para el pipeline habrá que verificar también el intervalo completo contra la
fase; un dump que cruza una transición no representa un instante de esa fase.

Los totales exportados en macOS incluyeron `private_footprint_bytes`; no deben
rebautizarse RSS, PSS o memoria privada de Windows. La disponibilidad y semántica
se registran por campo/plataforma; ausencia no es cero.

## Muestreo nativo: disponible, segunda opción

El protocolo local ofrece `Memory.startSampling` y `Memory.getSamplingProfile`.
V3 los ejecutó con intervalo de 32.768 bytes y devolvió 18 muestras y cuatro
módulos. Las pilas contienen direcciones hexadecimales, sin nombres de funciones;
no identificaron NER/OCR ni los buffers grandes como una contabilidad completa.
Es un muestreo, no un censo de todas las clases de memoria.

También existe `contentTracing.enableHeapProfiling` en este binario, pero no se
ejecutó en estas pruebas. Electron documenta simbolización con símbolos de su
versión. Habilitarlo no convierte automáticamente las pilas nativas en objetos
JS ni clasifica el interior de la memoria lineal WASM. No se justifica descargar
símbolos o integrar ese camino antes de ver si los contadores por categoría
resuelven las preguntas del pipeline.
[API de Electron](https://www.electronjs.org/docs/latest/api/content-tracing),
[límites del perfil de asignaciones](https://chromium.googlesource.com/chromium/src/+/main/docs/memory-infra/heap_profiler.md).

## Corrección de la premisa de 443–626 MB

T-11 obtuvo ese intervalo restando WASM y heap a RSS. **No es una masa de
memoria nativa demostrada ni un objetivo de ahorro.** Mezcla residencia del SO,
capacidades y lecturas que no forman un balance exacto. La misma tabla contiene
un residuo de −44 MB al terminar OCR, evidencia de ese límite contable.

Los ~345 MB de ruido histórico de M2 entre tandas describen dispersión; no son
un costo fijo del instrumento que se pueda restar. El A/B reciente evaluó añadir
footprint manteniendo otros observadores y fue inconcluyente. Tampoco mide el
costo total de la instrumentación. Los controles aquí prueban sensibilidad de
categorías, no separan causalmente esos 443–626 MB ni justifican descontarles un
porcentaje. Se abandona la resta como criterio de cierre de la tarea 2.

## Trabajo definido para el implementador y criterio de cierre

La investigación de viabilidad termina aquí. El encargo resultante quedó acotado a
`tests/perf/`, su README y el informe de atribución, sin tocar producto:

1. Incorporar una sonda MemoryInfra opt-in, con conexión y cierre seguros,
   límite de duración/tamaño, versión real, PID, disponibilidad, errores y
   ventanas temporales. Conservar artefactos por sesión y hashes de build.
   Probar parsing hexadecimal, ausencia de campos, IDs distintos, fronteras de
   fase, timeout y limpieza. Reproducir controles buffer/ImageData/WASM.
2. En P1/P2 observar base, OCR, carga/inferencia NER, Ready/panel y cierre a
   15/60/120 s. Serializar pedidos; no convertir un dump tardío en un pico.
   No forzar GC en la serie principal de retención. La pasada de heap/WASM que
   fuerza GC se presenta por separado como diagnóstico, con su propia identidad.
3. Comparar controles sin instrumentación adicional, tracing habilitado sin
   pedidos explícitos y tracing con dumps. Registrar cualquier dump automático;
   esa segunda condición no se presume vacía. Mantener los mismos observadores
   mínimos y alternar orden. Si la dispersión impide cuantificar overhead,
   declarar el límite; no repetir tandas indefinidamente ni fijar un umbral ficticio.
4. Entregar evolución por categoría y fase, con hipótesis comprobadas/no
   observables y prioridades. Se cierra la atribución hasta la resolución del
   instrumento cuando ese desglose permite revisar el plan; no se exige que
   sumen RSS ni explicar cada byte. Si queda un malloc dominante sin clasificar,
   justificar una prueba nativa con símbolos antes de ampliar el alcance.

**Windows:** las APIs son candidatas multiplataforma; esta investigación solo
las ejecutó en macOS. Hace falta repetir los controles sobre el binario Windows
y completar/validar el lector de presión. No se declara validado por disponer
del mismo protocolo ni se usa WSL para sustituir una medición del producto nativo.
Esa validación sigue como seguimiento separado del cierre del punto 2; el cierre
no acredita funcionamiento ni resultados en Windows.

La revisión 2 → 1 → 3 se conserva. No hay evidencia nueva que autorice presentar
el empaquetado NER como solución del supuesto residuo. No se agregan experimentos
de optimización descartados ni se cambian presupuestos M1/M2.
