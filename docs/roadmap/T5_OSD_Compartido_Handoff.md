<!-- CONTEXT: scope=handoff-campaña | dependencias=adr/ADR-164-Un-OSD-Compartido-Por-Core.md,core/Contracts.md,core/OCR_Engine.md,core/Orchestrator.md,architecture/04_Event_System.md,architecture/05_Worker_Architecture.md,architecture/07_Performance_Strategy.md,ui/React_Client.md,roadmap/Optimizacion_De_Memoria_Plan.md,tests/perf/README.md | audiencia=implementador-Luna+planificador+revisor | fase=11 -->

# T-5 — Implementación y medición de OSD compartido

> **Historial cerrado:** T5 aceptada el 2026-09-15. Las instrucciones,
> pendientes y resultados de este documento reflejan sus etapas anteriores;
> el estado vigente está en [el cierre final](T5_OSD_Compartido_Cierre_Final.md).
> No reanudar encargos históricos ni repetir mediciones por estas notas.

## Prerrequisito de controles generales — decisión del planificador

La primera pasada global de cierre encontró que ESLint inspecciona snapshots
de `.measure/` y scripts de skills locales `.agents/skills/`, fuera de los
proyectos TypeScript de Anonly. También hay nueve archivos de configuración
enumerados en `allowDefaultProject`, frente al máximo predeterminado de ocho.
El log original queda en `.measure/t5-final-gates/lint.log`. No son motivos
para desactivar type-aware lint ni retirar reglas del código de producto.

Se autoriza como ajuste separado de infraestructura, después de estabilizar
los tests T5, ownership exclusivamente `eslint.config.js` y `.prettierignore`:

- Ignorar exactamente `.measure/**` y `.agents/skills/**` en ESLint, y los
  mismos dos directorios en Prettier: son evidencia local y herramientas
  externas, no fuentes versionadas del producto. Conservar esos archivos.
- Mantener los nueve nombres explícitos de `allowDefaultProject` y fijar
  `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 9` dentro
  de `projectService`. Es el límite acotado del inventario actual, no un glob
  nuevo ni una exclusión de configuraciones del análisis tipado.
- Mantener todas las reglas y el alcance de `apps/`, `packages/`, `tests/` y
  `scripts/`. No formatear ni modificar masivamente archivos ajenos.

El implementador comprueba sintaxis/formato de esos dos archivos y registra
el diff. El planificador/revisor vuelve a ejecutar los gates globales sobre
archivos estables. Un fallo de otro tipo se informa sin ampliar este alcance.
Este ajuste no modifica la implementación OSD ni la comparación de rendimiento.

### Determinismo del fixture de 200 páginas — prerrequisito separado

La pasada global con cobertura encontró un fallo en
`tests/fixtures/generate.test.ts`, comparación binaria de dos `generateText200p`.
El helper exclusivo `generateTextPages` deja que pdf-lib asigne CreationDate y
ModDate a la hora actual; una ejecución que cruza un segundo puede producir
bytes distintos. La versión sin cobertura pasó; no se debe repetir hasta que
casualmente coincida ni eliminar la comparación. Evidencia:
`.measure/t5-final-gates/coverage.log`, fuente local de pdf-lib
`PDFDocument.updateInfoDict`.

Decisión del planificador: para ese helper, fijar ambas fechas a
`2026-01-01T00:00:00.000Z` inmediatamente después de crear el documento. Es
metadata sintética, no fecha de expediente ni cambio de contenido/semilla.
Ownership adicional acotado: `tests/fixtures/generate.ts` y su test. Conservar
otros generadores y PDFs históricos congelados de las mediciones. El test debe
forzar dos fechas de sistema distintas, sin esperas reales y restaurando el
reloj en finally, y comprobar bytes iguales más ambas fechas fijas al cargar
con `PDFDocument.load(..., { updateMetadata: false })`. No ocultar diferencias
modificando metadata solo desde el test. Registrar que las futuras generaciones
de 200 páginas cambian de hash, sin reescribir ni repetir mediciones anteriores.

Este arreglo de infraestructura completa la precondición de gates; no es una
optimización OCR ni una nueva fase de la campaña de memoria.

**Extensión del mismo arreglo tras la ejecución scoped:** el implementador
reportó el mismo fallo binario en `generateText50pDense`. Los cuatro tests de
determinismo de PDF existentes incluyen también `generateText50p` y
`generateText50pSmallPage`; sus creadores usan la misma metadata variable.
Para evitar conservar el mismo defecto en esas variantes, aplicar las mismas
dos fechas fijas exclusivamente a esos tres generadores adicionales y forzar
2030/2040 en sus tests de igualdad, con solo Date simulado y restauración
garantizada. Mantener texto, fuentes, dimensiones, densidad y APIs; no tocar
los otros generadores. Las futuras generaciones cambian solo metadata, no
los PDFs congelados ni las condiciones de la campaña histórica. No repetir
benchmarks. Los cuatro casos deben probar el contrato de igualdad entre
fechas distintas y las fechas internas fijas, sin esperar un cruce de segundo.

> **Resolución vigente de la ambigüedad de conservación externa:**
> ADR-164 §5.1 fija render a 144 DPI, máscara de tinta, correspondencia espacial
> bidireccional de radio 1 y precisión/recall mínimos 0,95 por región, con
> controles de negro/blanco y evidencia JSON. Implementar ese criterio exacto;
> no calibrarlo ni cambiarlo por otro. Los otros cuatro pendientes están
> implementados; mantenerlos y completar solo esta prueba, sus controles y la
> actualización factual del informe. La revisión acotada OCR dio 28/28 PASS.

> **Encargo vigente al nuevo implementador Luna (2026-09-15):** la decisión
> OSD compartido + una página de adelanto está cerrada y se conserva. La
> implementación de dispose ya fue revisada y corregida. Restan únicamente
> los cinco pendientes de validación de
> `T5_OSD_Compartido_Revision_Cierre_Funcional.md`: conservación externa con
> control negativo, generaciones de reanálisis independientes, reconstrucción
> observable, aislamiento de recursos OSD y orden de resultados distinguibles.
> Esta instrucción prevalece sobre las reanudaciones históricas siguientes;
> no repetir la campaña A/B/C ni rehacer las correcciones aprobadas.
>
> Ownership del implementador: tests OCR/orientación, E2E y helpers/fixtures;
> tests del façade si hacen falta para observar reconstrucción. Solo corregir
> runtime OCR si una prueba nueva demuestra un defecto dentro de ese alcance.
> No modificar ImageData, specs, configuración, otros motores ni documentación
> de cierre del planificador. Actualizar el informe de ejecución
> `T5_OSD_Compartido_Cierre_Funcional.md` con comandos, asserts y resultados
> efectivos, incluyendo controles negativos. Ejecutar los gates scoped y E2E
> con build fresco. El planificador revisa, ejecuta gates finales y recién
> entonces cierra la documentación de T5. La evaluación y eventual
> optimización de ImageData comienza después como trabajo separado.

> **Reanudación vigente tras resultados separados:** el humano decide conservar
> OSD compartido + una página de adelanto por velocidad, sin exigir ahorro RSS
> demostrado. La campaña de §0 ya se ejecutó; no repetirla. Luna debe corregir
> dispose y completar la aceptación funcional según la revisión
> `T5_OSD_Compartido_Revision_Separados.md`. El planificador investiga ImageData
> por separado; no optimizar ni retirar ese arreglo durante esta corrección.

## Pendientes finales para Luna — posteriores a la campaña A/B/C

1. **Disposición:** la salida rápida de waitForNoActivePages y todas las vías
   que resuelven activeDrainResolvers deben requerir también cero
   activeProcessBranches. Añadir repro permanente con productor pendiente y
   otra rama fallida: releaseIdleWorkers no libera, dispose permanece pendiente
   hasta asentarse todo el trabajo real y sus reservas, sin despachar nuevo OCR
   después de dispose. Corregir cualquier vía equivalente de salida prematura
   dentro del mismo scope OCR; no introducir nuevos contratos ni timers.
2. **E2E C de aceptación:** aplicar Redact explícitamente, conservar desde la
   generación del fixture cajas ground truth independientes de OCR, verificar
   que cada región sensible esperada quede cubierta en el PDF exportado en
   0/90/180/270 y que zonas externas sigan visibles. Afirmar texto/ángulo por
   página y capturar conjuntos de entidades normalizados; no sustituirlos por
   conteos ni usar `.some` global de píxeles como cobertura. Comparación con
   expectativas sintéticas conocidas; A/B reproducen un fallo histórico y no
   son el oráculo de calidad de C. Preservar PDF/imágenes y asserts.
3. **Identidad, reconstrucción y aislamiento:** el test de reanálisis ejecuta
   realmente una segunda sesión tras liberar servicios y observa reconstrucción;
   regiones con pageIndex repetido se resuelven concurrentemente/desordenadas
   conservando identidad. Dos instancias de kernel/motor, no dos pools de
   respuestas constantes, demuestran que liberar una no afecta la otra.
4. No rehacer A/B/C ni cambiar kernel ImageData, DPI, geometría, franjas o pool.
   Ownership OCR host/tests y tests/E2E/helpers/fixtures; para verificaciones
   de wiring se permiten tests del façade. No modificar specs ni motores de
   PDF/Render/Export/NER. El planificador conserva la investigación de costos;
   coordinar antes de ejecutar procesos de medición pesados simultáneamente.
5. Gates scoped/cobertura y E2E, reporte nuevo
   `T5_OSD_Compartido_Cierre_Funcional.md` con requisito → assert → resultado
   y artefactos, incluyendo pendientes reales. No declarar T5 cerrada ni crear
   commit/push. Los gates globales y revisión final corresponden al revisor.

> **Instrucción vigente del humano, 2026-09-15, posterior a la revisión:**
> separar y medir primero el cambio OSD/adelanto, y solo después incorporar
> la corrección de imágenes rotadas/márgenes y volver a medir. **§0 prevalece
> para esta reanudación** sobre el A/B combinado de §3. La aceptación funcional
> del producto sigue requiriendo los tests de §2.0 y §3.4; una condición de
> diagnóstico que reproduce un fallo anterior no se declara versión aceptada.

## 0. Separación de cambios y medición por etapas — Luna

### Condiciones e identidad del cambio

| Condición | OSD / reconocimiento | Preparación | ImageData para rotaciones |
| --- | --- | --- | --- |
| A — control original | 2 LSTM + 2 OSD | 2 consumidores | comportamiento histórico sin corregir |
| B — solo cambio T5 | 2 LSTM + 1 OSD | hasta 3 consumidores, una página de adelanto | mismo comportamiento histórico que A |
| C — T5 + corrección rotada | igual a B | igual a B | corrección nativa actualmente presente en createImageDataResult |

“Solo OSD compartido” conserva la página de adelanto ya elegida; no volver a
la variante sin adelanto. A es el control congelado
`48961510e004c62f39669de7760a41d8361ef49f`. B conserva las correcciones propias
de OSD/ciclo de vida de T5, pero excluye el cambio de `rotateImageData` y
`cropImageData` que construye ImageData nativo. C incorpora **solo ese diff**
sobre las mismas fuentes B. Guardar el diff exacto, incluyendo la copia
`stableData` que hoy acompaña al helper: optimizar esa copia durante esta
comparación añadiría otra variable. La corrección también afecta páginas
enteras giradas; no rotularla como si únicamente afectara los márgenes.

Preservar primero una copia recuperable de todas las fuentes actuales y del
diff de ImageData. Construir condiciones mediante snapshots/checkouts
aislados o cambios reversibles de ese único diff, sin reset del árbol ni
descarte de trabajo ajeno. No flags de producto, no configurar pool físico 3,
no saltar márgenes deliberadamente con una heurística nueva. Al terminar,
restaurar el candidato C completo en el árbol de trabajo y conservar B como
artefacto de diagnóstico reproducible, sin publicar/adoptar B como solución.

### Orden obligatorio

1. Antes de congelar B, corregir el defecto de liberación de la revisión
   `T5_OSD_Compartido_Revision_Adelanto.md` punto 1 y añadir su repro permanente.
   Los contadores cubren todas las ramas hasta asentarse, aunque Promise.all
   rechace temprano. Mantener esta corrección idéntica en B y C. Completar los
   tests discriminantes de ventana/presupuesto/cancelación pendientes sin
   modificar la política de reconocimiento. No introducir fixes entre B y C.
2. Congelar instrumento, fixture P2, configuración y fuentes. Verificar en un
   diagnóstico fuera de la ventana medida cuántas llamadas efectivas a
   `recognize` corresponden a la pasada principal y a cada franja, y los
   errores previos a reconocer. Los jobs `ocr-page` no equivalen a esas
   llamadas internas. Comparar el mismo P2 y conservar la evidencia de
   ImageData estructural/nativo; no añadir logging/telemetría al producto.
3. **Etapa 1: A contra B.** Ejecutar tres pares con orden A1/B1, B2/A2, A3/B3,
   frío y caliente separados. Registrar todos los resultados y escribir la
   sección de esta etapa en `T5_OSD_Compartido_Resultados_Separados.md` **antes**
   de pasar a C. Aceptar y reportar también resultados negativos/inconclusos.
4. **Etapa 2: B contra C.** Incorporar únicamente el diff ImageData preservado
   y medir tres pares nuevos B1/C1, C2/B2, B3/C3. Los B de esta segunda etapa
   son controles contemporáneos, no sustituyen ni sobrescriben los de etapa 1.
   Esto separa el costo de corregir reconocimiento rotado de la variación entre
   momentos de ejecución. No reusar tiempos históricos como controles nuevos.
5. Completar el informe con **B−A** (OSD/adelanto), **C−B** (ImageData/rotado)
   y la descripción del conjunto C frente a A, dejando claro si esa última
   comparación usa condiciones medidas en etapas distintas. No sumar
   porcentajes de etapas ni tratar los RSS máximos como costos aditivos.

Se conservan de §3: builds frescos, hashes de fuentes/instrumento/fixture/assets,
máquina sin otra medición/build concurrente, 2 LSTM, DPI/idiomas/NER/presupuesto
idénticos, MB decimales, reloj único para cada duración y repetición máxima
por fallo operativo con todos los intentos guardados. Para reutilizar el
arnés before/after, registrar además explícitamente `stage` y `condition A/B/C`
en manifest/reporte; no inferir la condición por nombres genéricos de carpeta.

### Datos y criterio de salida

- Por par/temperatura: OCR, Ready, RSS simultáneo en OCR y global, validez,
  ocupación LSTM/solapamiento OSD, topología y liberación. No confundir la
  ocupación `ocr-page` de A (incluye OSD) con LSTM puro de B/C.
- Word[] completas normalizadas por página y conjuntos de entidades
  normalizados, además de conteos. Fuera del benchmark, distinguir qué pruebas
  de giros/márgenes fallan en A/B y qué cambia en C. No quitar esos tests ni
  cambiar sus expectativas para declarar verde la condición histórica rota.
- C conserva los requisitos de calidad/E2E de §3.4 (Redact explícito,
  ground truth independiente, cada caja/orientación y zonas externas). Un
  test que cambia algún píxel no prueba que todas las páginas estén censuradas.
- La prioridad del humano es **no hacer el producto más lento**. Si B es más
  lento que A o C aumenta el tiempo frente a B, cuantificarlo y reportarlo;
  no aceptar una compensación tiempo/memoria por cuenta del implementador,
  no aumentar adelanto/pools ni bajar DPI para obtener un resultado favorable.
- Reportar sin rodeos si compartir OSD mejora, empeora o queda inconcluso,
  y por separado el costo/beneficio funcional del arreglo rotado. Mantener T5
  pendiente de revisión; no commit/push. El informe de etapas es adicional:
  preservar intactos reportes/JSON históricos.

**Estado de este handoff (2026-09-15): listo para reanudar implementación y
medición con el mismo subagente gpt-5.6-luna.** ADR-164 §2.3 y OCR_Engine v1.16.0
formalizan una página adicional en preparación. §2.0 fija el trabajo pendiente;
§2 conserva el reparto de responsabilidad del trabajo ya implementado y §3
define el A/B final actualizado. Reusar los avances existentes, sin rehacerlos
ni descartar correcciones. Responsable de arquitectura: planificador; los
specs no se modifican desde la ejecución. T5 sigue pendiente de aceptación.

## 1. Objetivo y límites

Implementar ADR-164 y contrastar **dos LSTM + dos OSD** (control) contra
**dos LSTM + un OSD con una página de adelanto** (tratamiento), con el mismo PDF P2 de 50 páginas y OCR/NER
reales en Electron. Los resultados se entregan aunque sean inconclusos o
desfavorables. No subir el número de reconocedores, bajar DPI ni cambiar
calidad en T-5. Solo se amplía de dos a tres la ventana de requests del
tratamiento, bajo el presupuesto existente; el control conserva dos.

Lecturas obligatorias, en orden: Contracts completo, OCR_Engine completo,
Code_Standards, AI_Development_Guide; luego ADR-164, este handoff,
Worker_Architecture, Event_System y los specs de los scopes siguientes.

Campaña autorizada por el humano: ejecutar los scopes de §2 **secuencialmente**
en el mismo árbol, conservando inventario por módulo. Esto no autoriza un PR de
implementación que mezcle motores ni commits/push. No tocar PDF/Render/NER/
Grouping/Regex/Export salvo réplicas de tipos/fixtures que el nuevo contrato
obligue a actualizar, sin cambios funcionales en esos motores. No está solo en
el repo: preservar cambios ajenos, no resetear ni descartar archivos. Reportar
ambigüedades al planificador con cita antes de improvisar.

## 2. Secuencia de implementación por responsabilidad

### 2.0 Reanudación: pendientes concretos y orden de ejecución

Leer también `T5_OSD_Compartido_Revision_R4.md` y
`T5_OSD_Investigacion_Scheduling.md`. Los archivos `.measure/` son evidencia
histórica, no specs ni código para inyectar en el producto.

1. **Instrumento, tests/**: corregir `readyDurationMs` de
   `tests/perf/support/memoryProfile.ts` para usar un mismo origen de reloj.
   Añadir una prueba con orígenes desplazados que falle contra la resta
   anterior. `totalMs` era válido; no corregir los JSON históricos. Completar
   manifest con hashes de fuentes/build/instrumento/lock/assets/fixture,
   configuración efectiva y mapa de chunks CDP. Congelar el instrumento y
   copiarlo idéntico al checkout BEFORE antes de medir A1.
2. **OCR, recuperación**: resolver P1 de r4 en `orientation-kernel.ts` según
   ADR-164 §3. Convertir los repros archivados en tests permanentes, más el caso
   donde la carga vieja termina después de iniciada la nueva. Ni siguiente
   job ni dispose esperan una inicialización invalidada; sin rechazos huérfanos.
3. **OCR, adelanto**: implementar §6/casos 34–38 de OCR_Engine. Separar ventana
   de consumidores y pool físico sin mutar/clonar config para fingir un pool 3.
   Verificar límites, reservas, regiones, cancelación y liberación mientras el
   productor aún está activo. No copiar el monkeypatch del experimento.
4. **Aceptación funcional, tests/**: ejecutar E2E Electron real en ambos builds
   con el fixture de §3.4; comparar palabras y entidades normalizadas y
   comprobar censura/exportación. Acreditar aislamiento mediante instancias
   independientes del kernel/Core y reanálisis con una segunda sesión OCR;
   devolver dos ángulos constantes desde mocks de pools no prueba aislamiento.
5. **Medición final**: completar los tres pares A/B de §3 con el producto real,
   después de sus gates scoped y E2E. A1 puede medirse antes de los cambios de
   producto como en el protocolo inicial, declarando el intervalo; ningún
   AFTER definitivo se mide antes de terminar correcciones y E2E. Si cambia
   producto tras medir AFTER, el build previo deja de representar al candidato
   final: conservar sus datos y documentar qué comparaciones faltan.
6. **Reporte**: entregar `T5_OSD_Compartido_Resultados_Adelanto.md`, separado
   del informe inicial y revisiones r4. Incluir matriz requisito → test →
   resultado, comandos, cobertura, artefactos y pendientes. No marcar T5
   cerrada: el planificador revisa diff, gates globales y resultados al terminar.

**Propiedad de archivos**: producto en `ocr-engine/src/` y sus tests; instrumento,
E2E y fixtures sintéticos en `tests/` (config de tests solo si hace falta
registrar el caso, sin aflojar gates). Para tests del wiring existente puede
modificar `packages/anonymization-core/src/__tests__/`. No se prevén nuevos
cambios funcionales de shared/façade/app ni otros motores: verificar los scopes
ya ejecutados de abajo y reportar al planificador si encuentra un vacío que
los requiera. Reporte de ejecución autorizado en roadmap; ADR/specs son del
planificador. Está trabajando con otros agentes: preservar todo cambio ajeno.

### Reutilización de la primera campaña

Los scopes T5-S/F/A ya tienen implementación: comprobar su estado y corregir
solo dentro del alcance anterior. No crear de nuevo el control si existe un
checkout válido; verificar SHA y fuentes antes de reutilizarlo. Reusar el P2
congelado con SHA-256
`26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`
(1 714 563 bytes). Nuevos directorios de resultados, nunca sobrescribir r4 ni
la investigación de scheduling. Los pasos de preparación siguientes se
consideran cumplidos solo si se verifica su identidad, no por su mera existencia.

### T5-I — Instrumento y control reproducible (`tests/`)

Antes de modificar producto:

1. Crear un checkout **detached** del control
   `48961510e004c62f39669de7760a41d8361ef49f` en una ruta hermana libre. No cambiar
   la branch de trabajo actual ni crear commits. Preparar dependencias mediante
   pnpm con lock congelado; no reutilizar symlinks de paquetes workspace que
   resuelvan accidentalmente al árbol AFTER. Verificar rutas reales.
2. Preparar el arnés de §3 en `tests/perf/`, con el mismo código en ambos
   checkouts. Mantener los observadores fuera del producto. El baseline solo
   recibe cambios del instrumento, nunca implementación de OSD compartido.
3. Congelar el fixture P2 una vez y preservar su SHA-256. Añadir una entrada
   opt-in `tests/perf/osd-sharing.spec.ts` que lea ese archivo explícito, no
   regenere texto/PDF en cada corrida, y reutilice `measureProfile` y los
   samplers existentes. Variables del arnés: `ANONLY_T5_FIXTURE` (ruta absoluta),
   `ANONLY_T5_OUTPUT_DIR` (directorio absoluto único de esa corrida),
   `ANONLY_T5_CONDITION` (`before`/`after`) y `ANONLY_T5_PAIR` (1..3).
4. Añadir tests discriminantes del instrumento (ruta de salida sin pisado,
   cálculo de pico simultáneo, duración OCR, huella estable de calidad y
   reconocimiento de las dos topologías). Ejecutarlos antes de congelar el
   instrumento. Si cambia después, copiarlo a ambos y repetir controles.
5. Tomar BEFORE del primer par sobre build fresco. Guardar artefactos antes de
   modificar el candidato de esta reanudación. Los números históricos de
   T-1/T-2/r4 no reemplazan esta corrida.

### T5-S — Contrato (`shared`, réplicas obligatorias)

Traducir Contracts §3.5/§5/§6/§7.1/§7.2 a tipos y exports: nuevo job, factory,
payload/resultado/ángulo, orientación requerida en OcrPagePayload. Adaptar
fixtures y mapas exhaustivos para que el contrato compile. Config del façade:
`ocr-orient` timeout 60000 y retries 0. Los overrides existentes no cambian de
semántica; ausencia de factory mantiene fallback. Los errores son los actuales.

### T5-O — OCR (`ocr-engine`)

Implementar ADR-164 §2/§3 y OCR_Engine §15 item 32. Nuevo kernel por instancia,
entry OSD y subpath; cola local exclusiva; dos puertos en OcrEngine; orientación
antes de LSTM dentro del retry; validación de boundary; estado/limpieza seguros.
El reconocimiento conserva píxeles, parámetros, geometría y fusión existentes.
Actualizar tests antiguos para ejercer la nueva frontera sin debilitar asserts.

### T5-F — Façade (`packages/anonymization-core/src`)

Construir orientationPool size 1 en createCore e inyectarlo. Extender PoolKey y
excluir la clave del manager; disponer el pool en createCore.dispose. Las
llamadas del Orchestrator a processSession/releaseIdleWorkers no cambian.
Verificar con factories fake que ambos transportes están conectados, que un
Core independiente posee recursos independientes y que dispose limpia todo.
No reformar el transporte genérico ni arreglar otros motores en esta tarea.

### T5-A — App (`apps/react-client`)

Importar `@anonly/ocr-engine/orientation-worker?worker` y proporcionar factory
`"ocr-orientation"` junto a la de OCR existente; ajustar mocks/decls necesarios.
No cambiar presets, UI ni settings. Mantener assets first-party existentes.

### T5-V — Validación y métricas (`tests/`)

Ejecutar contract/unit/edge/snapshot scoped y typecheck/lint de cada scope;
cobertura OCR ≥85%. Ejecutar E2E real de OCR y nuevo caso de orientaciones
mezcladas. Completar §3 sin correr suites/builds/otros agentes de medición al
mismo tiempo. No ejecutar el lint/test global: el planificador/revisor realiza
la pasada global **después** de las mediciones, una vez sobre el diff final.

## 3. Protocolo A/B cerrado

### 3.1 Variables fijas y preparación

- Runtime real Electron mediante `playwright.perf.config.ts`, un worker,
  retries 0, screenshots/video/trace apagados. Misma máquina y alimentación.
- `ocrPoolSize: 2` explícito por el canal de overrides del arnés (ADR-155).
  El AFTER real usa tres consumidores por ADR-164 §2.3; BEFORE dos. No
  sobrescribir `processSession` ni inyectar su implementación desde el test.
  Fijar también el resto de los tamaños a los defaults normales actuales:
  pdf 4, ner 2, render 4; NER habilitado; idiomas spa+eng, DPI configurado 300,
  `maxLiveImageBytes = 128 * 1024 * 1024`. T-6a queda vigente en ambas condiciones.
- Perfil P2 de 50 páginas derivado del generador existente, rasterizado fuera
  del renderer medido una sola vez. Guardar PDF congelado y SHA-256, dimensiones,
  tamaño y hashes de assets/lock. No usar documentos del usuario como fixtures.
- Guardar versiones de Node/pnpm/Electron/Tesseract, SO/CPU/RAM, SHA de control,
  diff o hash de fuentes AFTER, checksum del instrumento y configuración efectiva.
- Nuevo directorio userData de Electron en cada sesión A/B. Cada sesión hace
  frío → cerrar → caliente como measureProfile. Comparar frío con frío y
  caliente con caliente; no mezclar ni afirmar que LSTM sigue vivo entre ambas:
  ADR-157 lo libera tras cada etapa OCR.
- No usar un flag de producto para elegir BEFORE/AFTER. Son checkouts/builds
  separados. Reconstruir con `VITE_E2E=1` antes de cada sesión para cumplir el
  gate de freshness. No hacer build de B mientras mide A.

Comandos por condición, desde su checkout (variables previamente definidas):

```bash
VITE_E2E=1 pnpm --filter @anonly/react-client build
pnpm --filter @anonly/desktop-shell build
pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/osd-sharing.spec.ts --workers=1 --retries=0
```

Antes de cada corrida comprobar `pgrep -f '[p]laywright test --config'` y que no
haya otra medición Electron activa. No matar procesos ajenos. Si una ejecución
propia falla, cerrarla y verificar limpieza antes de reintentar.

### 3.2 Orden y preservación

Tres pares, orden **A1/B1, B2/A2, A3/B3**, donde A=BEFORE y B=AFTER. A1 se
obtiene antes de cambiar producto. Cada sesión produce frío y caliente, para
un total de 12 imports medidos. El intervalo de implementación entre A1/B1 se
declara en el reporte; los dos pares siguientes comprueban dirección con menor
separación temporal y orden invertido. No promediar orden/temperatura juntos.

Cada directorio de corrida es nuevo; negarse a sobreescribir uno existente.
Ejemplo: `.measure/t5-osd/<identificador-campaña>/pair-1/before/`. Guardar JSON
crudo completo, stdout, manifest de identidad, configuración y resumen.
El PDF congelado y el instrumento permanecen iguales para las seis sesiones.
Copiar todas las salidas del baseline a la carpeta de campaña del árbol de
trabajo, preservando originales, para que no dependan del checkout temporal.

Si una corrida no es válida, conservarla rotulada y hacer explícita la causa.
Repetir como máximo **una vez el par afectado** para un fallo operativo o
`hotBaselineSettled=false`/`peakWithinPhases=false`; guardar ambos intentos,
sin elegir el más favorable. No repetir selectivamente por una cifra negativa.
Si persiste, reportar limitación/inconcluso con los datos disponibles.

### 3.3 Qué medir

Por frío/caliente y por par, obtener de los mismos límites OCR_STARTED y
OCR_FINISHED:

- Duración de la etapa OCR, latencia hasta Ready y páginas/segundo.
  Para OCR usar `phases.OCR_FINISHED - phases.OCR_STARTED`; para Ready usar
  `totalMs` y verificar que el campo corregido sea coherente, sin mezclar el
  reloj de página con tiempos relativos al sampler.
- **Pico de la suma simultánea de RSS** en ventana OCR y M2 global. No sumar
  picos independientes de Tab/GPU/Broker tomados en instantes distintos.
- Pico y piso RSS por proceso (Tab/GPU/Broker), con el estadístico de piso ya
  definido por ADR-159. Heap de V8/backing stores y cobertura CDP como contexto.
- Jobs LSTM concurrentes observados (`ocr-page`, esperado pico 2); para AFTER,
  orientación (`ocr-orient`, pico 1), cantidad de jobs y tiempos desde
  WORKER_JOB_DISPATCHED hasta COMPLETED. Es tiempo de servicio/transporte, **no
  tiempo de espera en cola**. No inventar esa última métrica si no se instrumenta.
  Registrar máximo de requests/imágenes admitidas y cumplimiento de presupuesto
  mediante observadores del arnés, sin añadir telemetría de producto ni contar
  bytes PNG como RGBA. Derivar por separado ocupación agregada LSTM y tiempo
  con ambos jobs activos; no son porcentaje de CPU. Probar el adelanto también
  de forma determinista: el muestreo temporal podría no verlo en un run corto.
- Instancias Tesseract realmente observadas y su liberación tras OCR, además
  del test estructural. El clasificador CDP actual supone que el primer hijo
  es LSTM y el segundo OSD; **ya no vale para AFTER**. Adaptar el instrumento
  para preservar topología cruda y evitar ese etiquetado falso. Para identidad
  inequívoca, el arnés puede leer el build fresco y mapear el chunk de cada
  factory por su contenido/import (entry OSD tiene jobType ocr-orient), guardando
  ese mapa en el manifest. Los wrappers de reconocimiento y OSD son distintos;
  sus hijos blob se atribuyen por parentSessionId. No inferir OSD por orden de
  attach ni confundir threads ONNX. Si CDP pierde targets, declarar cobertura
  insuficiente; el conteo de jobs no prueba por sí solo cuántos WASM hay.
- Fallos, timeouts, páginas completadas, entidades/grupos y una huella estable
  por página del OCR. Comparar texto, confidence, cajas/rotation y orden de
  palabras; excluir UUIDs, documentId y duraciones. Calcular/hash fuera de la
  ventana de tiempo medida a partir de datos capturados antes de closeDocument.
  Comparar conjuntos normalizados de entidades, no sus ids aleatorios.

No usar `RSS - suma(heaps)` como tamaño del OSD. No confundir el pico global
durante NER con el ahorro en la ventana OCR. El arnés de T-1 no ve WASM.

### 3.4 Calidad adicional y lectura de resultados

P2 es sintético: una coincidencia de groupCount no prueba calidad general.
Fuera de la medición de rendimiento, ejecutar ambos builds con un mismo
fixture sintético de orientaciones **0/90/180/270 intercaladas**, incluida una
página girada al final; producir los giros en píxeles embebidos, no solo /Rotate
del PDF. Comparar Word[] normalizadas, cajas y detecciones. Añadir pruebas de
regiones con pageIndex repetido y recortes; no exigir un documento privado ni
extender el corpus calibrado bloqueado de ADR-147.

**Fixture y verificación ejecutables**: generar en tests un documento de al
menos cinco páginas con giros de píxeles `0, 90, 180, 0, 270`, dimensiones
rectangulares y texto sintético suficientemente denso para OSD (varias líneas,
con DNI y nombres ficticios repetibles). Conservar el contenido y las cajas de
los campos de prueba como ground truth; embeber el PNG girado, sin `/Rotate`
como sustituto. Congelarlo una vez para ambos builds, fuera del benchmark P2.
No usar documentos personales ni valores reales. Capturar Word[] y entidades
normalizadas, incluyendo coordenadas/rotación, antes de censurar. Comparar
BEFORE/AFTER sin quitar campos que difieran, y afirmar detección de los campos
conocidos, no solo conteos ni stage Ready. Aplicar `Redact` a esos campos por
la API/flujo existente, exportar realmente y volver a renderizar ese PDF para
verificar que los píxeles de censura cubren las cajas conocidas en las cuatro
orientaciones y que zonas de control externas permanecen visibles. Conservar
imágenes y resultados de asserts. Un hash del PDF o falta de texto extraíble
en un PDF rasterizado no prueba censura. Leer specs Render/Export si necesita
sus contratos de test; no cambiar sus implementaciones para hacer pasar T5.

El reanálisis debe invocar `orchestrator.reanalyze` con cambio de idiomas
soportado y observar una segunda etapa OCR después de la liberación inicial;
no basta llamar a los métodos de limpieza. Verificar reconstrucción y salida
válida, sin exigir identidad entre idiomas diferentes. Las regiones repetidas
se cubren además con un test de sesión que conserva identidad por request.

Calcular por par `AFTER - BEFORE` en MB y ms, con porcentaje de tiempo, y
reportar los tres deltas y su dispersión. Sin tolerancia de calidad: un cambio
de palabras/cajas/confianza requiere explicar y resolver la causa, nunca bajar
el umbral. Si el orden de asignación de páginas a LSTM produce una diferencia,
investigar estado entre jobs con entradas/orden controlados; no normalizar
quitando palabras o campos que difieran.

Para rendimiento no se inventa un gate en MB o %: separar ahorro estructural
confirmado, magnitud RSS resuelta/no resuelta y costo de tiempo. Un resultado
consistentemente más lento requiere decisión del planificador (ADR-154), no
declarar T-5 optimización exitosa. Si el ruido domina, cerrar la **medición**
como inconclusa, conservando implementación pendiente de aceptación.

## 4. Entrega del implementador

Crear `docs/roadmap/T5_OSD_Compartido_Resultados.md` como **reporte de ejecución**,
sin modificar ADR/specs/handoff ni marcar el roadmap cerrado por su cuenta.
Esto autoriza escribir ese reporte, no decidir arquitectura. Debe contener:

1. Estado de cada scope, archivos y pruebas ejecutadas, cobertura OCR.
2. Identidades de fuentes, build/instrumento/fixture y comandos reproducibles.
3. Tabla por par y temperatura de memoria, tiempo, calidad y validez.
4. Conteo real de instancias, solapamiento y liberación; cobertura de observación.
5. Conclusión limitada a lo observado y rutas de todos los artefactos crudos.
6. Ambigüedades, fallos no resueltos y gates que faltan al revisor.

El planificador realiza revisión del diff y gates globales, evalúa resultados y
actualiza el estado del plan. No se pide commit/push ni se modifica el control.
