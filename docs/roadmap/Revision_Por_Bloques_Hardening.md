<!-- CONTEXT: scope=roadmap-revision | dependencias=roadmap/MVP.md,ai/AI_Development_Guide.md,ai/Code_Standards.md,core/Contracts.md,architecture/07_Performance_Strategy.md,roadmap/Hito12.5_Revision_R4_Handoff.md,roadmap/mediciones/README.md | audiencia=humanos+IA | fase=11 (plan de revisión escrito el 2026-09-26, antes del merge a main) -->

# Revisión de `hardening/plan-2026-09` por bloques

La branch `hardening/plan-2026-09` junta tres semanas de trabajo antes del
merge a `main`. Hasta el commit `1e32b85` son 244 commits propios (sin contar
los merges) y 556 archivos, con unas 89.000 líneas agregadas. La mayor parte
es documentación y arneses de medición. Un único revisor sobre el diff entero
no puede hacer una revisión útil, así que la branch se parte en **bloques
temáticos**. Cada bloque tiene sus commits, sus ADRs y su foco.

Este documento es el plan y también el registro: la tabla de §4 se actualiza
a medida que cada bloque se aprueba.

## 1. Cómo se revisa un bloque

El flujo es **secuencial**, con un solo sub-agente activo a la vez:

```
revisor(ronda) → implementador(ronda) → revisor(ronda) → … → APPROVED → siguiente ronda
```

Los bloques se revisan **agrupados en rondas** (§3.1). Un bloque de 17 o
300 líneas de código no justifica un revisor propio, y los bloques del mismo
tema se entienden mejor juntos. La ronda se aprueba entera: el revisor da un
veredicto por bloque, pero la ronda no pasa hasta que todos sus bloques están
APPROVED.

1. **El revisor** (`.claude/agents/revisor.md`, Opus) recibe:
   - la lista de commits de cada bloque de la ronda (apéndice);
   - los ADRs y specs contra los que revisar (§3);
   - el foco.

   Devuelve **APPROVED** o **REJECTED**, con hallazgos bloqueantes (B-n) y
   no bloqueantes (O-n). Cada hallazgo cita archivo:línea y la regla o sección
   que viola.
2. **El implementador** (Sonnet) corrige solo lo que el revisor marcó.
   - Si el bloque toca un motor en `packages/`, es `implementador`.
   - Si toca `apps/`, `tests/` o scripts, es `general-purpose` con modelo
     `sonnet`.
   - Se retoma el mismo agente entre rondas en vez de lanzar uno nuevo.
3. **Vuelve al mismo revisor**, que verifica cada hallazgo y corre los gates.
   Se repite hasta APPROVED.

Reglas que se aplican a todos los bloques:

- **Se revisa el estado final, con los commits como mapa.** Los commits del
  bloque definen el alcance, pero el código puede haber cambiado en commits
  posteriores de otro bloque. El revisor juzga el archivo como está en `HEAD`.
  Un problema de un commit viejo que otro commit ya corrigió no es hallazgo;
  el revisor lo anota como "ya resuelto en `<hash>`".
- **Los arreglos son commits nuevos arriba de la branch.** No se reescribe la
  historia. Rigen las reglas de siempre:
  - un commit, un módulo (R-1);
  - un cambio de contrato lleva su ADR;
  - la higiene de datos va en commit propio (R-22).
- **Si un hallazgo pide cambiar un spec o un contrato, primero el
  planificador.** El planificador escribe el ADR o la corrección de docs, y
  recién después el implementador toca código (R-2, R-19). El implementador
  no edita specs de motor (R-21).
- **Ambigüedad: se para y se pregunta.** Si dos docs se contradicen, el
  revisor o el implementador reporta la contradicción, con archivo, sección y
  cita, y no elige (`AI_Development_Guide.md` §5).
- **Gates por ronda**, corridos por el revisor, en Windows nativo y de forma
  síncrona:
  - `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:contract` y
    `pnpm format:check`;
  - los tests del paquete tocado;
  - cobertura ≥85% de los módulos que se corrijan.

  E2E, perf, leak y stress **no** corren en las rondas: son pesados y
  requieren la app empaquetada. Van en §5.
- **Commits.** Ningún sub-agente commitea. Al aprobarse cada bloque, el
  planificador le pide autorización al humano para commitear y pushear sus
  arreglos (I-9).

## 2. Bloques exceptuados

Ya pasaron por un revisor, con veredicto APPROVED:

| Bloque | Qué es | Aprobación |
|---|---|---|
| **E1** — Hito 12.5, rediseño desde las pruebas de usuario (ADR-168 a ADR-178) | Pantallas de carga, escaneo y trabajo; vistas previas de edición calculadas por el Core; eliminar entidad; deshacer y rehacer exactos; agregado manual que choca; bloqueo del export con choques pendientes. 56 commits, ~12.000 líneas de código | Revisión 6 APPROVED, más la O6-1 cerrada (`MVP.md`, Hito 12.5; `Hito12.5_Revision_R4_Handoff.md`) |
| **E2** — ADR-188 y la documentación de SignPath | La búsqueda de actualizaciones se puede apagar; `CODE_SIGNING.md`, `PRIVACY.md`, `SignPath_Postulacion.md`. 5 commits | Ronda 2 APPROVED (2026-09-26), con los seis gates en verde |

Que estén exceptuados no los saca del merge. Solo significa que no se vuelven
a revisar. Si otro bloque encuentra algo que los afecta, se reporta igual.

## 3. Bloques a revisar

Orden propuesto: primero el código de producto, que es lo de mayor riesgo, y
después los arneses y la documentación. Las líneas son agregadas más
borradas por commit, así que el mismo archivo tocado dos veces cuenta dos
veces.

| Ronda | Bloque | ADRs | Commits | Código | Tests | Docs |
|---|---|---|---|---|---|---|
| A | **B1** — Correcciones de base y gates de calidad | 140–145, 147–149 | 20 | 1.748 | 5.029 | 1.832 |
| A | **B2** — Pantalla de escaneo y precalentado | 150–152 | 7 | 367 | 433 | 772 |
| B | **B4** — Memoria en los motores | 154, 156–163 | 23 | 1.021 | 1.461 | 1.515 |
| B | **B5** — OCR: OSD compartido y márgenes | 164, 165 | 20 | 1.004 | 3.068 | 5.812 |
| B | **B6** — Ciclo de vida del modelo de NER | 166, 167 | 26 | 508 | 1.685 | 2.904 |
| A | **B7** — Regex y Grouping más rápidos | 181–184 | 5 | 466 | 2.925 | 801 |
| C | **B3** — Instrumento de memoria y arnés de medición (H-10) | 146, 153, 155 | 32 | 172 | 7.436 | 3.361 |
| C | **B8** — Gates de leak/stress, portabilidad e integridad | 185–187 | 11 | 152 | 732 | 444 |
| D | **B9** — Arneses de memoria, ciclos y documentos reales | — (T-7 a T-13) | 18 | 0 | 13.998 | 2.979 |
| D | **B10** — Campañas de rendimiento por motor | 179, 180 | 21 + reorganización | 17 | 8.201 | 3.274 |

### 3.1 Rondas de revisión

| Ronda | Bloques | Por qué juntos | Código de producto |
|---|---|---|---|
| **A** | B1, B2, B7 | Correcciones puntuales de motores, la pantalla de escaneo y los algoritmos de Regex y Grouping: cambios acotados, cada uno con su ADR | ~2.600 |
| **B** | B4, B5, B6 | Toda la campaña de memoria en producto: ráster y preview, OCR (OSD y márgenes) y el ciclo del modelo de NER. Comparten pools, workers y `Orchestrator` | ~2.500 |
| **C** | B3, B8 | Infraestructura de medición y gates: el canal de overrides del arnés, `test:perf`, leak/stress, CI, `cross-env`, LF e integridad | ~300 (más ~8.000 de tests) |
| **D** | B9, B10 | Solo arneses y documentación de campañas: revisión de higiene de datos y de consistencia | ~20 (más ~22.000 de tests) |

### B1 — Correcciones de base y gates de calidad

- **Qué cubre:**
  - listeners de abort que no se limpiaban en el worker pool;
  - palabra partida entre dos items de pdf.js (ADR-142);
  - página rotada con texto nativo: `PDF_PAGE_ROTATED`, contrato nuevo (ADR-140);
  - geometría compuesta con `viewport.transform` (ADR-141);
  - imágenes de OCR producidas bajo demanda: `OcrConfig.maxLiveImageBytes`, contrato (ADR-143);
  - `LruCache` que no expulsa lo recién insertado (ADR-145);
  - `PreviewRenderScheduler` (ADR-144);
  - comparador de baseline de calidad y su baseline versionada (ADR-147);
  - gate de SLA de cancelación (ADR-149).
- **Leer:**
  - `Contracts.md` (los códigos y la config nuevos);
  - `PDF_Engine.md`, `OCR_Engine.md`, `Render_Engine.md`, `Orchestrator.md`;
  - ADR-140 a ADR-145 y ADR-147 a ADR-149 (ADR-146 va en B3).
- **Foco:**
  - que los contratos nuevos estén en `Contracts.md` y `enums.ts` antes que el código;
  - que el error de página rotada llegue a la UI con su mensaje;
  - que la composición de `viewport.transform` no rompa páginas sin rotar;
  - que el gate de calidad falle ante una regresión real y no pase vacío (ADR-149).

### B2 — Pantalla de escaneo y precalentado

- **Qué cubre:**
  - la pantalla de escaneo dura lo que dura el escaneo (ADR-150);
  - la página 1 queda precalentada al llegar a Ready (ADR-151);
  - la pantalla dice en qué página va (ADR-152), con su corrección §2.
- **Leer:** ADR-150 a ADR-152; `Components.md` §2.10; `Orchestrator.md`.
- **Foco:**
  - el `stage` terminal suelta la pantalla en todos los caminos (error, cancelación, documento sin OCR);
  - el precalentado no bloquea ni duplica trabajo;
  - regla UX: el contador no desplaza el layout;
  - no hay carreras entre el precalentado y la apertura del panel.

### B4 — Memoria en los motores

- **Qué cubre:**
  - la caché de preview no guarda píxeles crudos (ADR-156);
  - el pool de OCR se da de baja al terminar su etapa, con `releaseIdleWorkers` (ADR-157);
  - **el ráster de OCR viaja codificado** (ADR-158, **cambio de contrato con `!`**: `OcrPagePayload.image`, `rasterizePage → EncodedPageImage`);
  - el worker de OCR no decodifica la página (ADR-160);
  - franjas sin tinta o visualmente blancas no se reconocen (ADR-161, ADR-162);
  - DPI de OCR con techo en el ráster fuente (ADR-163);
  - lectura de la retención desde el heap (ADR-159);
  - la memoria no se compra bajando el paralelismo (ADR-154).
- **Leer:**
  - ADR-154 y ADR-156 a ADR-163;
  - `Contracts.md` (ADR-158);
  - `OCR_Engine.md`, `Render_Engine.md`, `PDF_Engine.md`, `Orchestrator.md`;
  - `05_Worker_Architecture.md`.
- **Foco:**
  - que el contrato de ADR-158 esté completo en docs y en todos los consumidores (Core, motores, fixtures, test-utils);
  - la independencia de motores (P-1, P-2);
  - los transferables y la liberación de memoria;
  - que saltear franjas no pierda texto real (hay tests con tinta mínima);
  - que el techo de DPI no degrade el OCR de escaneos de baja resolución.

### B5 — OCR: OSD compartido y márgenes

- **Qué cubre:**
  - un único OSD por Core, con su pool de orientación y la factory en el cliente (ADR-164);
  - la réplica de `WorkerJobType` en pdf-engine y test-utils;
  - la caja de margen mapeada con el ráster original (errata);
  - una franja cuya tinta ya está explicada no se reconoce (ADR-165);
  - E2E de orientación física.
- **Leer:** ADR-164, ADR-165; `OCR_Engine.md` (contrato de orientación y errata de la franja rotada); `Contracts.md`; `05_Worker_Architecture.md`.
- **Foco:**
  - **bloqueante heredado de la ronda A:** el riesgo de fuga silenciosa del OSD en páginas escasas (`MVP.md`, Hito 11). La ronda B no cierra sin el ADR correspondiente y su implementación, o sin una decisión explícita del humano;
  - el ciclo de vida del pool de orientación (alta, baja, cancelación);
  - que las réplicas de `WorkerJobType` coincidan con la fuente;
  - el mapeo de coordenadas en páginas rotadas;
  - que la compuerta de ADR-165 no descarte texto no explicado.

### B6 — Ciclo de vida del modelo de NER

- **Qué cubre:**
  - el pool de NER se da de baja al terminar la detección (ADR-166);
  - después, a los 15 s de inactividad, con temporizador propio (`nerIdleDisposeMs`) y aviso de toda baja (ADR-167);
  - el ciclo del modelo se reinicia con cualquier baja;
  - documentación de multihilo, del paralelismo y de la precarga descartada.
- **Leer:**
  - ADR-166 y ADR-167;
  - `NER_Engine.md` (paralelismo, carga, baja y recarga);
  - `Orchestrator.md`;
  - `05_Worker_Architecture.md` (temporizador propio);
  - `Contracts.md` (`WorkerPoolConfig.nerIdleDisposeMs`).
- **Foco:**
  - carreras entre la baja por temporizador y una detección que empieza;
  - que `modelWarm` y los eventos de carga reflejen la recarga;
  - que la cancelación no deje el pool en un estado intermedio;
  - que el default de 15 s esté en un solo lugar.

### B7 — Regex y Grouping más rápidos

- **Qué cubre:**
  - escáner lineal para el email por defecto (ADR-181);
  - distancia difusa acotada (ADR-182) con recorte de afijos comunes (ADR-183);
  - índice exacto de candidatos que preserva coincidencias (ADR-184);
  - renumeraciones de ADR.
- **Leer:** ADR-181 a ADR-184; `Regex_Engine.md`; `Grouping_Engine.md`.
- **Foco:**
  - **equivalencia de resultados**: mismas coincidencias y mismos grupos que antes, con tests que lo demuestren;
  - los peores casos;
  - que las renumeraciones no dejen referencias viejas.

### B3 — Instrumento de memoria y arnés de medición (H-10)

- **Qué cubre:**
  - `test:perf` sobre el shell empaquetado (ADR-153);
  - el instrumento de memoria M1/M2 y su arreglo (ADR-146 y su enmienda);
  - la atribución por fase;
  - la base caliente;
  - fixtures de 50 páginas;
  - la bitácora de H-10;
  - **el canal de overrides del arnés en el cliente** (ADR-155), que es código de producto.
- **Leer:** ADR-146, ADR-153, ADR-155; `07_Performance_Strategy.md`; `tests/perf/README.md`; `H-10_Bitacora_De_Memoria.md`.
- **Foco:**
  - que el canal de overrides **no esté activo en el build de producción** (flag de build, validación) y no amplíe la superficie de ataque;
  - que ningún arnés escriba datos reales;
  - que `eslint.config.js` y `playwright.perf.config.ts` no aflojen reglas fuera de `tests/`.

### B8 — Gates de leak/stress, portabilidad e integridad

- **Qué cubre:**
  - gates `test:leak` y `test:stress` en Electron, con cambios en `.github/` (ADR-185);
  - `cross-env` (ADR-186);
  - LF en la copia de trabajo (`.gitattributes`);
  - integridad de assets retirada de runtime (ADR-187);
  - arreglo de CRLF en `ner-batch-real.mjs`;
  - infraestructura de mediciones en lint;
  - exclusiones de evidencia local.
- **Leer:** ADR-185 a ADR-187; `07_Performance_Strategy.md` §11.4; `08_Security_Model.md` §8.2.
- **Foco:**
  - que el workflow de CI siga funcionando;
  - que los gates nuevos fallen de verdad (ADR-149);
  - que las exclusiones de lint y Prettier no escondan código de producto;
  - que la dependencia nueva tenga su ADR (R-12).

### B9 — Arneses de memoria, ciclos y documentos reales

- **Qué cubre:**
  - instrumentación de las campañas de OSD, `ImageData`, márgenes, NER y tiempo fuera del OCR;
  - T-9 (ciclo de 10 open/close);
  - T-10 (documentos reales por ruta de entorno);
  - T-11 y T-12 (WASM por worker, opciones de sesión de NER);
  - T-13 (tiempos reales);
  - la comparativa externa;
  - la atribución de recursos del renderer;
  - PDFs pesados hasta el export.

  Todo es `tests/perf` y documentación.
- **Leer:** `tests/perf/README.md`; los planes de cada campaña en `docs/roadmap/`; los informes en `docs/roadmap/mediciones/`.
- **Foco (es un bloque de higiene y consistencia, no de producto):**
  - **ningún dato real** en el repo: rutas, nombres o contenido de documentos, que solo entran por variables de entorno;
  - los `.patch` de brazos A/B no tocan el producto en `HEAD`;
  - los tests de soporte (`support/*.test.ts`) corren en `pnpm test`;
  - las conclusiones de los informes coinciden con lo que el arnés mide.

### B10 — Campañas de rendimiento por motor

- **Qué cubre:**
  - hilos y lotes de NER;
  - reconocedores de OCR;
  - empaquetado de NER (ADR-179);
  - PDFs pesados (ADR-180);
  - sonda de reproducibilidad de OCR entre plataformas;
  - perfiles OCR y NER;
  - carga y panel de NER;
  - memoria del pool OCR en macOS;
  - los cierres en macOS y Windows;
  - retiro de rutas personales;
  - **la reorganización de `docs/roadmap/mediciones/`**, commit de este plan.
- **Leer:** ADR-179, ADR-180; `docs/roadmap/mediciones/README.md`; `Optimizacion_De_Rendimiento.md`; `Perfiles_Rendimiento_Revision.md`; `tests/perf/README.md`.
- **Foco:**
  - la misma higiene de datos que B9;
  - que la reorganización no haya roto links ni rutas;
  - que los estados "cerrado" y "pendiente" de los documentos coincidan con `MVP.md`.

## 4. Seguimiento

| Ronda | Bloques | Estado | Iteraciones revisor↔implementador | Commits de arreglo | Notas |
|---|---|---|---|---|---|
| — | E1 | Exceptuado (APPROVED en el Hito 12.5) | — | — | |
| — | E2 | Exceptuado (APPROVED 2026-09-26) | 2 | — | |
| A | B1, B2, B7 | **APPROVED** (2026-09-27) | 3 (R1 REJECTED 7 B / 6 O; R2 B2 y B7 APPROVED, B1 REJECTED por B-5; R3 APPROVED) | ver el commit de cierre de la ronda A | O-1 → ADR-189; B-4 de Performance/Leak/Stress → ronda C; riesgo de OSD en páginas escasas → bloqueante de la ronda B |
| B | B4, B5, B6 | **APPROVED** (cierre técnico R4; costo residual aceptado por el humano) | 4 (R1: B4/B5 REJECTED, B6 APPROVED; R2: B-7/B-8; R3: defectos de código anteriores cerrados; R4: ADR-190 y sondeos finales revisados) | commits de cierre de la ronda B | B-1/B-4/O-9 aprobados en calidad y cobertura. Sondeos finales nativos: +209,10 MiB de pico y +2.237 ms de tiempo mediano en 16 PDF escasos. El costo queda como posible trabajo futuro (`Future_Ideas.md` §6). No se demostró cumplimiento M2 de ADR-146, excedido históricamente en Windows. Cap nativo y OSD actual conservados |
| C | B3, B8 | Pendiente | | | |
| D | B9, B10 | Pendiente | | | |

### 4.1 Reanudación de la ronda B (2026-09-27)

El planificador recuperó el historial local de Claude Code del chat
"Mediciones de rendimiento en Windows" (sesión
`5198b340-37e5-4d79-9a6c-efc485e6b415`) y lo contrastó con la copia de
trabajo. La ronda A está cerrada en `HEAD` (`506651b`); los cambios de la
ronda B siguen sin commit. No existe todavía un PR de esta branch a `main`.

- **Informe anterior a la interrupción:** ADR-190 implementado; reportó 2.823
  tests generales, 335 de contrato, los otros gates verdes y los dos E2E
  nuevos aprobados. Son resultados históricos, no una verificación de la
  enmienda posterior.
- **Punto de interrupción:** después de ese informe, el planificador
  enmendó ADR-190 §2 y `OCR_Engine.md` casos 44/47 y §14. Una lectura con
  basura de confianza ≥ 60 no debe impedir la comparación con 0° cuando el
  OSD eligió un ángulo distinto de 0. El implementador se interrumpió por
  el límite de uso antes de aplicar la enmienda. Al recuperar la sesión,
  `ocr.engine.ts` conservaba la condición anterior y faltaba el test nuevo.
- **Implementación reanudada:** completó la comparación con 0°, la
  conservación de ángulos ya intentados (máximo cuatro reconocimientos
  adicionales) y la conservación de la mejor lectura ante un error de
  modelo en un reintento. Los tres tests nuevos fallaron contra el código
  anterior y pasaron con las correcciones. Gates scoped de OCR verdes:
  194 tests en nueve archivos, 94,19 % de cobertura de líneas, lint y
  typecheck. El planificador aclaró en el ADR y spec que la excepción para
  páginas blancas o de ruido sigue vigente. Revisión global posterior
  pendiente; estos resultados no aprueban la ronda.
- **Revisión R2 independiente:** 2.826 tests generales aprobados y uno
  omitido, 335 de contrato; lint, typecheck, formato y cobertura global
  verdes (96,23 % de líneas; OCR 93,98 %). Se resolvió la ausencia del
  Chromium requerido por Playwright y se ejecutó cobertura con dos workers
  sin ampliar timeouts. B6 conserva APPROVED; las correcciones mecánicas de
  R1 están cerradas. B4 sigue REJECTED por falta de medición y decisión.
  B5 sigue REJECTED por dos regresiones nuevas reproducidas: B-7, el
  fallback de orientación reemplaza por 1 una tinta ya medida como 0;
  B-8, el host acepta `inkRatio` negativo o mayor que 1. Vuelven al mismo
  implementador, con aclaración y filas de tests escritas por el planificador.
- **Revisión R3:** B-7/B-8 cerrados y las cuatro reproducciones
  independientes del revisor pasan. Implementación de ADR-190 revisada sin
  defectos adicionales: gates globales verdes, 2.832 tests generales y uno
  omitido, 335 de contrato; OCR 200/200 y 94,21 % de líneas de cobertura.
  La ronda no se declara APPROVED: siguen B-1, el cierre empírico de B-4 y
  O-9. Después se implementó el instrumento, se auditó su preflight y se
  midió la matriz completa.
- **Orden de continuación vigente:** el humano decidió conservar el cap
  nativo de ADR-163; el sondeo posterior de escala OSD recomienda conservar
  el lado largo de 1754 px. Preparar y validar una enmienda de ADR-190 para
  el caso escaso con OSD ausente y basura confiable; volver al revisor para
  cerrar B4/B5/B6.
  B-1 no se considera cerrado solamente por implementar los reintentos.
  Protocolo: `ADR190_DPI_Campana_Plan.md`; medición:
  `mediciones/ocr/ADR190_DPI_2026-09-27.md`.
- **Límite medido:** si el OSD no emite veredicto sobre una página escasa
  girada 180° y la lectura a 0° es basura confiable, la cadena termina sin
  probar otros ángulos. Los ocho casos de la matriz reprodujeron esto con
  el fixture de dos renglones, sin densificarlo para esconder la falla.
- **Preflight del instrumento (histórico):** las
  ocho lecturas de dos renglones girados (cuatro DPI y dos brazos) terminaron
  sin fallas del instrumento, recuperaron los cuatro tokens esperados y el
  DNI, pero todas agregaron palabras incorrectas: precisión de tokens entre
  0,50 y 0,67. En esas ocho celdas Tesseract no emitió veredicto OSD y el
  `inkRatio` observado (aproximadamente 0,0012–0,0017) quedó por debajo del
  umbral 0,002; se ejecutó un solo reconocimiento por celda. A 300 DPI,
  ambos brazos produjeron las mismas palabras. Los
  32 controles terminaron sin fallas del instrumento; las formas sin texto
  produjeron palabras confiables en ambos brazos a 150 y 200 DPI (cuatro
  casos). Los dos ensayos de cierre y reapertura liberaron y recrearon los
  workers; la región recortada se verificó por separado. Las sesiones crudas
  están en `.measure/adr190-dpi/2026-09-27T23-08-43-340Z-preflight-20288`
  y `.measure/adr190-dpi/2026-09-27T23-06-38-426Z-controls-16888`. Estos
  resultados aún no aprueban calidad ni el instrumento. La auditoría Sol
  dictó **NO-GO temporal** para la matriz: el validador admitía una captura
  sin reconocimiento y el control de DPI podía aprobar por ausencia de
  despachos; falta además el test geométrico del giro real. Las 40 celdas
  observadas sí tenían orientación y reconocimiento terminal. El
  implementador Luna corrigió el registro vacío y el control geométrico, pero
  la segunda revisión detectó un falso rechazo instrumental: una primera
  lectura válida seguida de un reintento fallido debe conservar la mejor
  lectura anterior, según ADR-190 §2. Luna corrigió ese caso y volvió al mismo
  revisor. La tercera auditoría reprodujo
  ese caso y los negativos, y dictó **GO para medir calidad, tiempo y
  memoria**. Esto aprueba el instrumento, no la calidad observada ni la ronda
  B.
- **Coordinación:** el humano autorizó continuar aquí con implementador y
  revisor, manteniendo un solo agente activo por vez. Implementación: GPT-6
  Luna; revisión: GPT-6 Sol. Las rondas C y D
  siguen pendientes; la suite pesada y el merge siguen el §5.
- **Campaña terminada; ronda B todavía abierta:** el instrumento pasó tres
  auditorías hasta GO. Calidad 128/128: 40 fallos, sin mejora de recall ni
  DNI al forzar 300 en 64 parejas; ocho casos de dos renglones a 180°
  produjeron basura confiable sin DNI en ambos brazos. Tiempo 384/384:
  mediana de diferencia pareada +722 ms para forzar 300. Memoria 128/128:
  mediana de diferencia pareada +161,4 MB de suma de working sets. Las tres
  fases tuvieron cero fallas instrumentales y el mismo build y fixtures.
  Evidencia y límites: `mediciones/ocr/ADR190_DPI_2026-09-27.md`.
  El humano conservó el cap de ADR-163, conforme a ADR-154. Falta enmendar
  ADR-190 para el caso escaso antes de aprobar B.
- **Sondeo de escala OSD terminado:** 64 PDFs sintéticos y 12 controles,
  tres tamaños y tres repeticiones: 684 detecciones, cero fallas del
  instrumento. Actual y nativo coincidieron en 48 orientaciones correctas y
  16 ausencias; el 50 % histórico empeoró 22 PDFs de bajo DPI. Las 16
  ausencias son todos los casos de dos renglones, que permanecieron bajo el
  umbral de tinta en los tres tamaños. La copia nativa agregó una mediana
  pareada de +213,5 ms de `detect` por PDF frente al tamaño actual, sin
  mejorar veredictos. Auditoría Sol apta para reporte; evidencia en
  `mediciones/ocr/ADR190_OSD_Escala_2026-09-28.md`. La enmienda de fiabilidad
  sigue pendiente. El siguiente instrumento está definido en
  `ADR190_OSD_Ausente_Recuperacion_Plan.md`: medir reconocimientos a los
  cuatro ángulos con el mismo ráster antes de fijar gatillo y ranking.
- **Recuperación con OSD ausente medida:** 380/380 observaciones con OCR real,
  64 PDFs con texto y 12 controles, cero fallas instrumentales. El ángulo
  correcto recuperó tokens y DNI sin extras en los 16 PDFs de dos renglones;
  el comparador actual elegiría una lectura contaminada en los 16 si se
  ejecutaran los cuatro ángulos. La señal `OSD sin veredicto + primera palabra
  confiable` seleccionó los 16 y ningún control en este corpus, pero también
  cuatro páginas derechas que ya estaban bien. Tres reconocimientos extra
  sumarían una mediana estimada de 3,814 s de worker por PDF seleccionado;
  falta medir el pipeline real. Dos controles de figuras siguen produciendo
  un `>` falsamente confiable en reintentos vigentes. Evidencia y límites en
  `mediciones/ocr/ADR190_OSD_Recuperacion_2026-09-28.md`. ADR-190,
  `Contracts.md` y `OCR_Engine.md` quedaron enmendados antes de tocar código;
  la revisión independiente de la campaña y el cambio de producto siguen
  pendientes. Un E2E con otra geometría añadió un segundo caso: primera
  lectura vacía, tinta presente y basura confiable en 90° que detenía la
  cadena antes del 270° correcto. El sondeo de las cuatro lecturas sobre el
  mismo ráster recuperó el DNI a 270°; la enmienda se amplió a OSD ausente
  con primera lectura confiable **o** tinta presente. Los controles de figuras
  quedan bajo esta rama y requieren verificación del aviso en el pipeline.

- **Producto medido, optimización pendiente:** la enmienda recuperó los 16/16
  PDF escasos sin tokens extra y elevó el DNI nativo de 60/64 a 64/64; los
  cuatro controles de figuras quedaron sin lectura fiable, con aviso y
  exportación censurada. Sol aprobó calidad/cobertura de B-1/B-4/O-9. En el
  pipeline completo, los 16 casos escasos nativos añadieron una mediana de
  +2.086,5 ms (TIME 384/384) y +194,44 MiB de pico de suma de working sets
  (MEMORY 128/128, 16/16 positivos), mientras los otros 48 quedaron cerca
  de cero. La memoria incluye páginas compartidas y no es RSS exclusivo del
  OCR. Sol revisó después una mitigación de canvas; QUALITY completo pasó
  128/128 con salida idéntica al build anterior. El humano detuvo la campaña
  TIME posterior en 373/384 registros y pidió no continuar las mediciones;
  no hay MEMORY completo del build final. Tiempo y memoria finales siguen sin
  validar, y no se usarán resultados parciales para aprobar la ronda. Sesiones,
  método y límites en
  `mediciones/ocr/ADR190_OSD_Recuperacion_2026-09-28.md`.
- **Dictamen técnico R4 y sondeo mínimo:** QUALITY final 128/128, cero fallas
  instrumentales y salida OCR idéntica al build anterior a la limpieza de
  canvas. Un sondeo dirigido posterior, autorizado por el humano, completó
  16 PDF escasos nativos y cuatro controles `full-0°` con el mismo build;
  hashes, calidad, trabajos y picos fueron auditados independientemente por
  Sol. Delta mediano de suma de working sets frente al baseline sin
  recuperación: **+209,10 MiB** en escasos y −15,18 MiB en controles.
  Sol dictó **APPROVED técnico** para B4, B5 y B6, y para B-1/B-4/O-9 en
  calidad/cobertura. La primera repetición de TIME quedó abortada en
  373/384, sin usarse como conclusión; un sondeo dirigido posterior del build
  final completó 60/60 observaciones (20 PDF × tres repeticiones). En los 16
  escasos nativos, el delta temporal mediano frente al baseline fue
  **+2.237 ms** (16/16 positivos); cuatro controles comunes tuvieron −210 ms
  de mediana. Sol auditó los archivos crudos y cerró la reserva temporal como
  costo caracterizado. Los sondeos no son gate M2 de ADR-146; el perfil P2
  de Windows ya superaba ~1,6 GB antes de ADR-190. La aceptación humana del
  costo residual y del pendiente M2 no se infiere del dictamen técnico. El
  humano aceptó el costo caracterizado para cerrar la ronda B y lo dejó como
  posible optimización posterior (`Future_Ideas.md` §6); esto no declara
  cumplido el presupuesto M2 de ADR-146.

## 5. Después del último bloque: el merge a `main`

1. **Suite pesada sobre la app empaquetada**, en Windows nativo, con la máquina
   sin otras mediciones: `pnpm test:e2e`, `pnpm test:perf`,
   `pnpm test:leak` y `pnpm test:stress`. Quedan abiertas las fallas E2E de
   los escenarios 2 y 5 (N-8, Hito 11). Hay que resolverlas o registrarlas
   como conocidas antes del merge.
2. **PR a `main`.** CI (`.github/workflows/ci.yml`) solo corre en push o PR
   contra `main`, así que **nunca corrió sobre esta branch**. El PR es la
   primera vez: esperar CI verde antes de mergear. CI corre en Linux y macOS, no en Windows: Windows queda cubierto por los gates locales de cada ronda y por la suite pesada del punto 1.
3. **Verificación manual de ADR-188** sobre los instaladores (E2, pendiente
   del humano).
4. Con la branch en `main`, siguen los pasos de SignPath
   (`SignPath_Postulacion.md` §2).

## 6. Residuos registrados

Hallazgos que no se pueden corregir sin reescribir la historia. Se dejan
asentados, al estilo de ADR-124, en lugar de reescribirla.

**Ronda A (O-6):**

- **Commits que tocan archivos fuera de su módulo (R-1):**
  - `cd622d4`: pdf-engine y `tests/integration/fixtures/mocks.ts`;
  - `3a4b58b`: regex-engine y cinco archivos de `tests/perf`, incluidos `.py` y `.sh`;
  - `defa7a2`: grouping-engine y cinco archivos de `tests/perf`.

  En los tres casos, lo que queda afuera es el fixture o el arnés que mide
  ese mismo cambio.
- **Scope en el mensaje del commit (R-17).** Nueve commits llevan un scope
  convencional en el mensaje, por ejemplo `fix(pdf-engine):` o
  `feat(react-client):`.
- **Plan de campaña fuera del repo.** El "plan de campaña de hardening" que
  citan ADR-140 a ADR-151 ("resolviendo D-0x…") no está en el repo. Por eso
  la declaración previa que exige ADR-124 §1 no se puede verificar desde acá.
  Las decisiones sí están completas en cada ADR.
- **R-21 no verificable.** Varios commits de implementación editan specs y
  llevan `Co-Authored-By` de un modelo implementador. El repo no permite
  saber quién editó el spec, así que R-21 no se puede verificar a posteriori.
  Los arreglos de esta revisión sí respetan el reparto: los specs los edita el
  planificador.

**Ronda B (O-10):**

- **Commits que no compilan solos.** `7f70cbc` (ADR-158, `shared`) deja Render, OCR y el Core sin compilar hasta `fde5bef`, `1a3cfa4` y `5af8d47`. `efbd0f4` (ADR-164, `shared`) deja las réplicas de `WorkerJobType` rotas hasta `67cf7b9` y `dbd5376`. Es inherente a R-1 combinado con tipos `Record` exhaustivos: el commit de contrato no puede incluir a sus consumidores. `git bisect` sobre esos tramos tiene que saltar esos commits.

## Apéndice — commits por bloque

Generado desde `git log --no-merges bbb015f..1e32b85`. Todos los commits
propios de la branch están en exactamente un bloque. Los cinco merges no se
revisan.

### B1

- `4faa87a` fix: worker-pool — listeners de abort no se limpian al asentar un job
- `f8b583b` fix: pdf-engine — una palabra partida entre dos items sigue siendo una palabra
- `82cfde9` docs: contrato — PDF_PAGE_ROTATED, nuevo código de error (ADR-140)
- `61267c8` feat: shared — EngineErrorCode.PDF_PAGE_ROTATED (ADR-140)
- `e07d980` feat: pdf-engine — rechazar páginas rotadas con texto nativo (ADR-140)
- `36b1906` test: integration — pageProxy mock declara rotate: 0 (ADR-140)
- `ae25e6c` feat: react-client — mensaje de usuario para PDF_PAGE_ROTATED (ADR-140)
- `f1d052a` fix: façade — LruCache nunca expulsa la entrada recién insertada
- `f274a36` feat: ocr-engine — estimateWordsBytes, tercer argumento del depósito
- `15e99fb` feat: contrato — OcrConfig.maxLiveImageBytes (ADR-143)
- `bf6aa7f` feat(ocr-engine): processSession pide cada imagen bajo demanda (ADR-143)
- `608dc2d` feat(anonymization-core): runOcrStage produce imágenes bajo demanda (ADR-143)
- `9172a72` docs: ADR-141 — la geometría de PDF se entrega en la página que se ve
- `eeadac8` docs: ADR-144 a ADR-149 — decisiones abiertas de la campaña de hardening
- `cd622d4` fix(pdf-engine): componer viewport.transform en toda la geometría (ADR-141)
- `7a244ed` feat(render-engine): PreviewRenderScheduler acota el trabajo de preview (ADR-144)
- `3173d38` test(quality): comparador de baseline de detección (ADR-147)
- `e3208bf` test(cancel): gate de SLA de cancelación sobre el façade real (ADR-149)
- `498ff14` test: versionar baseline sintética de calidad
- `0e9f57a` test: usar baseline versionada en gate de calidad

### B2

- `12898fa` docs: ADR-150 y ADR-151 — cuándo se abre el panel de trabajo y con qué
- `e357e2e` docs: ADR-152 y corrección del momento del precalentado (ADR-150/151)
- `d518f17` docs: ADR-152 §2 — el único total que se muestra es el del documento
- `8c9b95f` docs: anotar §32 — el salto del contador de páginas en un documento mixto
- `3da3bd0` feat(anonymization-core): precalentar la página 1 al llegar a Ready (ADR-151)
- `3422d1f` feat(react-client): la pantalla de escaneo dura lo que dura el escaneo (ADR-150)
- `61837c1` feat(react-client): la pantalla de escaneo dice en qué página va (ADR-152)

### B3

- `283dc70` docs: ADR-153 — el gate de tiempos se mide sobre el producto
- `2d85009` feat(perf): test:perf mide sobre el shell empaquetado, no un servidor HTTP (ADR-153)
- `78b8e58` test(fixtures): generateText50p/generateText50pDense — el fixture de H-10 (ADR-146)
- `5f59ec5` test(perf): instrumento de memoria M1/M2 sobre Electron (H-10, ADR-146)
- `99bca1a` test(fixtures): generateText50pSmallPage — proxy de área para atribución de H-10
- `11080e1` test(perf): atribución del exceso de M1 en P2 (H-10, a pedido del planificador)
- `58b767e` fix(perf): generar el fixture escaneado fuera del renderer medido (H-10)
- `9f123a2` docs: ADR-155 — canal de overrides del arnés de medición
- `6b1bcbb` docs: ADR-146 — M1 es una cota inferior; la atribución compara picos
- `c9a326e` fix(perf): línea de base caliente como mínimo de una ventana, no un instante (H-10)
- `a5e5e4e` feat(react-client): canal de overrides del arnés de medición (ADR-155)
- `693987e` feat(perf): contar workers vivos por pool en el pico, vía eventos públicos (H-10)
- `a74d844` docs: la atribución por resta entre corridas no tiene resolución
- `715e42f` feat(perf): valida canal de overrides; renderPoolSize sin resolución; guard de build (H-10)
- `1c23ab8` feat(perf): atribución intra-corrida por fase, reemplaza comparar M2 entre corridas (H-10)
- `a09a6c9` fix(perf): línea de base caliente asentada y concurrencia acotada por fase (H-10)
- `e7be899` docs: el pico está dentro de la etapa de OCR — medido, y reordena los levers
- `508a3e6` docs: el pico del run caliente estaba contaminado, y aparece el proceso GPU
- `31c4358` docs: bitácora de H-10 — qué se intentó, qué midió y qué se decidió
- `3bc00bb` docs: bitácora de H-10 §7.1/§7.2 — las alternativas abiertas, y por qué los hilos no aplican
- `c324c71` docs: bitácora de H-10 — la acumulación lineal contradice la hipótesis del heap
- `d1b25cc` docs: registra la campaña de optimización de memoria
- `d8b4236` test: instrumenta memoria y agrega el perfil de 200 páginas
- `245a76b` docs(adr): enmendar ADR-146 con la clasificacion por posicion del maximo
- `408e6a0` docs(roadmap): planificar el arreglo del instrumento de memoria
- `c2a94ff` docs(adr): aclarar que M1 se acota a la misma ventana que M2
- `fc6f927` test(perf): arreglar los tres defectos del instrumento de memoria
- `d74028f` docs(roadmap): cerrar el arreglo del instrumento de memoria
- `0fa5004` docs(roadmap): reapuntar la campana de memoria a la retencion post-documento
- `edd2204` docs(roadmap): planificar T-7, la atribucion de la base caliente
- `e09a83c` test(perf): construir el arnes de la base caliente
- `e177564` docs(roadmap): medir de que esta hecha la base caliente y cerrar T-7

### B4

- `99141b0` docs: ADR-154 — la memoria no se compra bajando el paralelismo
- `9e62be4` docs: ADR-154 §2 — el segundo worker de NER no existe; el de Render sí
- `82bc745` docs: ADR-156 — el preview no guarda los píxeles que nadie lee
- `a3e8cb8` docs: ADR-157 — el pool de OCR se da de baja al terminar su etapa
- `f7dab93` feat(render-engine): la caché de preview no guarda ni transporta píxeles crudos (ADR-156)
- `08b3ea0` docs: ADR-157 §1 — la baja la expone OcrEngine, no el Orchestrator
- `ab60f47` feat(ocr-engine): expone releaseIdleWorkers(), sin dar de baja el motor (ADR-157 §1bis)
- `d48cb26` feat(anonymization-core): el pool de OCR se da de baja al terminar su etapa (ADR-157)
- `6cb838f` docs: ADR-158 — el ráster de OCR viaja codificado
- `c588141` docs: contrato y specs de ADR-158 — el ráster de OCR viaja codificado
- `7f70cbc` feat(shared)!: OcrPagePayload.image reemplaza imageData (ADR-158)
- `fde5bef` feat(render-engine)!: rasterizePage devuelve EncodedPageImage (ADR-158)
- `1a3cfa4` feat(ocr-engine)!: decodifica el PNG de rasterizePage una sola vez (ADR-158)
- `5af8d47` test(anonymization-core): fixtures acompañan EncodedPageImage de rasterizePage (ADR-158)
- `fa326b7` docs: sincronizar arquitectura con ADR-158 — cuatro lugares desincronizados
- `58ea183` docs: pasada completa de ADR-158 — lo que la primera edición no bajó
- `91b2939` docs: ADR-154 — descartada la retención de pdf.js, con el motivo del código
- `db51632` feat: evita decodificar la página en el worker OCR
- `e76c622` docs(memory): cerrar especificacion de T-4
- `2f800fe` perf(ocr-engine): omitir franjas visualmente blancas
- `cb2fd1e` feat(shared): declarar limite de DPI para OCR
- `e54f8fd` perf(pdf-engine): limitar DPI al raster fuente
- `4896151` perf(orchestrator): adaptar DPI por pagina

### B5

- `be0c8d5` docs(adr): registrar un OSD compartido por Core
- `150819c` docs(core): declarar el contrato de orientacion de OCR
- `efbd0f4` feat(shared): declarar el trabajo de orientacion de OCR
- `67cf7b9` chore(pdf-engine): completar la replica de WorkerJobType
- `dbd5376` chore(test-utils): completar la replica de WorkerJobType
- `905f55a` feat(ocr-engine): compartir un unico OSD por Core
- `238f6b1` feat(core): construir el pool de orientacion
- `55cb8e7` feat(react-client): proveer la factory del worker de orientacion
- `ffeaf79` test(fixtures): fijar la metadata de los generadores deterministas
- `15707e4` test(e2e): cubrir orientacion fisica y conservacion externa
- `e1aac58` docs(roadmap): registrar las campanias de T5, ImageData y margenes
- `4d14c87` docs(core): registrar la errata de la caja de franja rotada
- `3fb8ac9` fix(ocr-engine): mapear la caja de margen con el raster original
- `3650ce7` docs(roadmap): medir la tinta de margen y aprobar I-1
- `be903f5` docs(adr): decidir que una franja ya explicada no se reconoce
- `ddfc271` docs(core): especificar la compuerta de franja explicada
- `b76d18c` perf(ocr-engine): omitir la franja cuya tinta ya esta explicada
- `0017f8c` docs(roadmap): cerrar M-1b y encuadrar la implementacion de I-1
- `c8aeab8` docs(adr): conservar I-1 tras la medicion A/B
- `34d90f4` docs(roadmap): registrar las mediciones I-1 e I-2 de margenes

### B6

- `f6c9412` docs(adr): registrar que el multihilo de NER ya esta en el producto
- `de51579` docs(adr): descartar con medicion la precarga de NER durante el OCR
- `ca74f29` docs(core): precisar el paralelismo y la carga del modelo de NER
- `9312759` docs(roadmap): registrar el perfilado interno de NER y el tiempo fuera de OCR
- `a32fcdb` docs(roadmap): cerrar la precarga de NER durante el OCR
- `1bbb219` docs(roadmap): actualizar el estado de las campanias y del multihilo
- `91ebb93` docs(roadmap): cuantificar que puede ahorrar la migracion a Tauri
- `bb389bd` docs(adr): liberar el modelo de NER al terminar la deteccion
- `d0a843a` docs(core): especificar la baja del pool de NER
- `2383805` docs(core): reabrir el ciclo del modelo con la baja del pool de NER
- `7529831` docs(core): condicionar el reinicio de modelWarm a que la baja ocurra
- `6571a2e` feat(ner-engine): dar de baja el pool al terminar la deteccion
- `18d4442` feat(core): liberar el modelo de NER al cerrar la etapa de deteccion
- `8453e1d` docs(roadmap): registrar la verificacion de ADR-166 y por que no concluye
- `b3f3ecc` docs(adr): anotar ADR-166 implementado y sin beneficio verificado
- `e2e6d3e` docs(roadmap): planificar T-8, el A/B intercalado
- `10a0bd4` test(perf): construir el arnes del A/B intercalado
- `9111cd2` docs(roadmap): medir la baja del modelo de NER con A/B intercalado y cerrar T-8
- `34f445f` docs(adr): liberar el modelo de NER a los 15 s de inactividad
- `a05940a` docs(core): especificar el temporizador propio de NER y la recarga que avisa
- `9683ebe` docs(architecture): el pool de NER tiene su propio temporizador y toda baja se notifica
- `c006059` feat(shared): WorkerPoolConfig gana nerIdleDisposeMs
- `1b09383` feat(core): NER se libera por su propio temporizador y toda baja se notifica
- `a9c0ac7` feat(ner-engine): reiniciar el ciclo del modelo con cualquier baja del pool
- `79c6ef0` docs(adr): anotar ADR-167 implementado y verificado de punta a punta
- `33631e2` docs(roadmap): registrar la verificacion de ADR-167 en la app empaquetada

### B7

- `3a4b58b` perf: acotar patrón de email del motor Regex
- `defa7a2` perf: acotar distancia difusa del motor Grouping
- `7ab21df` perf: indexar candidatos de Grouping preservando coincidencias
- `43ba0a5` docs: renumerar ADR del motor Regex a 181
- `7dea554` docs: renumerar ADR del motor Grouping a 182 y 183

### B8

- `a03b565` docs(architecture): el gate test:leak no puede apoyarse en measureUserAgentSpecificMemory
- `0ab098f` docs(architecture): el gate test:leak se apoya en workers y heap con GC
- `91c5eac` test: activar gates de leak y stress en Electron
- `374b90b` docs(adr): ADR-186, variables de entorno portables en scripts
- `bf48ca1` build: usar cross-env en los scripts que definen VITE_E2E
- `1f99058` chore: fijar finales de linea LF en la copia de trabajo
- `45d07fd` fix(perf): regex sensible a CRLF rompia el arnes de lotes NER en Windows
- `e55a86d` docs: documentar los finales de linea LF y actualizar textos viejos
- `61b554b` docs(adr): ADR-187, sin verificacion de integridad en runtime
- `dba4093` chore(lint): excluir evidencia y herramientas locales
- `5b5681f` chore: preparar infraestructura de mediciones de rendimiento

### B9

- `c85b17e` test(perf): instrumentar las campanias de OSD, ImageData y margenes
- `aaba15c` test(perf): instrumentar las campanias de margenes, NER y tiempo fuera de OCR
- `617c071` test(perf): el colector de fases puede no capturar las palabras del OCR
- `f2d5ae8` test(perf): T-9, el ciclo de 10 open/close
- `b013482` test(perf): T-10, documentos reales por ruta de entorno
- `8bd6352` docs(roadmap): cerrar T-9 y T-10, y dejar T-11 lista para implementar
- `752e4ca` test(perf): T-11 y T-12, memoria de WASM por worker y opciones de sesion de NER
- `61a3698` test(perf): T-13, tiempo real sobre documentos reales sin instrumento
- `bbb32b8` docs(roadmap): cerrar T-11 a T-13 y registrar donde esta el cuello de botella
- `e4af952` test(perf): comparativa externa contra un binario ya instalado
- `a4a6bbc` docs(roadmap): banco Windows, el hardening contra 0.9.2 y esta maquina contra el M1
- `16a61de` docs: corregir comparativa y planificar recursos, tiempos y perfiles
- `3aac21f` test: cerrar atribucion de recursos del renderer
- `ba357a0` docs: especificar banco de PDFs pesados y exportación
- `1b46917` docs: registrar medición local de PDFs pesados y exportación
- `d54001f` docs: actualizar medición de PDFs pesados con control versionado
- `8f0d7f0` test: medir memoria de PDFs pesados hasta exportación
- `06d1d6e` docs: cerrar caracterización de PDFs pesados y exportación

### B10

- `f8629df` docs: cerrar evaluación de empaquetado NER
- `da683f9` test: versionar banco de empaquetado NER
- `dacb3e7` test: medir hilos y lotes del motor NER
- `49ff6ec` test: medir reconocedores del motor OCR
- `434acdc` docs: cerrar plan y resultados de rendimiento en macOS
- `597ab07` docs: renumerar ADR de empaquetado NER a 179
- `d59e782` docs: renumerar ADR del banco de PDFs a 180
- `e20f818` docs: reservar ADR 168 a 178 en planes de rendimiento
- `149cb7b` docs: retirar rutas personales de informes
- `d096eda` docs: cerrar mediciones pendientes en Windows nativo
- `76087e8` docs: el OCR de un escaneo cambia con la plataforma
- `3c56c03` test(perf): sonda de reproducibilidad del OCR entre plataformas
- `7e0b20f` test: ampliar mediciones locales de perfiles OCR y NER
- `f10e9dd` docs: actualizar resultados y pendientes de rendimiento
- `bd6bd92` docs: incorporar resultados Windows a perfiles y plan de rendimiento
- `9d5309f` docs: cerrar en Windows ADR-184, brazos de Bajo y gates leak/stress
- `a854c1c` test: medir carga y panel NER en importaciones consecutivas
- `030029a` docs: registrar mediciones macOS de OCR y NER
- `25a4a2f` docs: cerrar en Windows la campana NER de carga, panel y secuencia
- `886d0aa` test: medir memoria incremental del pool OCR en macOS
- `ea730c2` docs: cerrar la curva de memoria OCR en macOS

### E1

- `7b8f1a6` docs(ui): ADR-168 y ADR-169, carga, escaneo y pantalla de trabajo tras las pruebas de usuario
- `cd164ef` docs(contracts): ADR-170, las vistas previas de edicion las calcula el Core
- `765353b` docs(contracts): ADR-171, el usuario puede eliminar una entidad
- `a67a1be` docs(contracts): ADR-172, deshacer y rehacer exactos
- `109213b` docs(roadmap): Hito 12.5, rediseno desde las pruebas de usuario
- `dca2260` feat(shared): ADR-170/171/172, vistas previas de edicion, eliminar entidad y checkpoints de deshacer
- `893c4fa` feat(grouping): ADR-170, replacementPreviews y previewEdit
- `5079784` feat(grouping): ADR-171, eliminar una entidad y su supresion por sesion
- `8f82315` feat(grouping): ADR-172, puntos de restauracion de la edicion
- `6800470` feat(core): facade delega previewEdit, liftRemoval y checkpoints de edicion
- `f7b1ce5` feat(ui): ADR-168, pantallas de carga y escaneo tras las pruebas de usuario
- `4864cc5` feat(ui): ADR-169, la pantalla de trabajo tras las pruebas de usuario
- `8a21c3d` feat(ui): ADR-170, selector de modo exacto y diálogos de edición con previewEdit
- `1492ccc` docs(grouping): errata del caso 53, reopenSession no descarta los puntos de restauracion
- `cd8c759` fix(grouping): reopenSession ya no descarta los puntos de restauracion
- `f6b2256` test(core): caso 39 con el GroupingEngine real, no simulado
- `bace4a6` feat(ui): ADR-171 y ADR-172, eliminar entidad y deshacer exacto
- `56ec4ba` docs(roadmap): fila 4 del Hito 12.5 cerrada con la errata del caso 53
- `f27060a` docs(adr): ADR-173 y ADR-174, cierre de los bloqueantes de la revision 1
- `029ba67` test(tests): replacementPreviews en fixtures de invariants y security
- `4bfb35c` feat(shared): tipos de ADR-174, agregado manual que choca
- `356865c` feat(grouping): ADR-173 y ADR-174, rechazos y agregado manual retenido
- `f5148c7` feat(core): heldConflictIds en addManualEntity y tope de literales
- `fbec2e4` docs(roadmap): filas 10-13 del Hito 12.5 cerradas
- `8e27858` feat(ui): ManualOverlapDialog para el choque de un agregado manual (ADR-174)
- `29c2126` test(ui): cobertura de ManualOverlapDialog y N-2 en helpers/stores de apps
- `46c2ae6` docs(ui): fila 14 del Hito 12.5 cerrada y errata de resolveConflict
- `0fbbbc2` docs(adr): ADR-175, un choque manual no queda colgado
- `f0a0db1` feat(core): ManualEntityResult.groupIds (ADR-175 fila 16)
- `cae65b2` feat(grouping): ADR-175, un choque manual no queda colgado (fila 15)
- `430764c` docs(adr): errata de ADR-175 §3, groupIds exige el tipo pedido
- `93ed554` feat(core): heldConflictIds/groupIds de addManualEntity (ADR-175 fila 17)
- `6f20e84` docs(roadmap): filas 15-17 del Hito 12.5 cerradas
- `e7380d1` feat(ui): ADR-175, un choque manual no queda colgado
- `e2c6577` test(ui): cobertura de ADR-175 (groupIds, decisión conjunta, aviso-estado)
- `4c04ae3` docs(roadmap): fila 18 del Hito 12.5 cerrada
- `6957282` docs(adr): ADR-176, un choque pendiente bloquea el export
- `80ab79e` feat(shared): EngineErrorCode.EXPORT_UNRESOLVED_CONFLICTS (ADR-176 fila 19)
- `9e1957a` feat(grouping): ADR-176, un choque pendiente bloquea el export (fila 20)
- `50f7edc` feat(core): ADR-176, manualOutcome y guard de export (fila 21)
- `57aaf5c` docs(roadmap): filas 19-21 del Hito 12.5 cerradas
- `edc223b` feat(ui): ADR-176, un choque pendiente bloquea el export
- `f9fb9c9` test(ui): cobertura del bloqueo de export (ADR-176 §1)
- `7d2ddbb` docs(roadmap): fila 22 del Hito 12.5 cerrada
- `3bbe242` docs(roadmap): handoff de la revision 4 del Hito 12.5
- `29beb86` docs(adr): ADR-177, una entidad eliminada no ocupa lugar
- `8fa1794` feat(grouping): ADR-177, una entidad eliminada no ocupa lugar (fila 23)
- `cbb466b` feat(ui): ADR-177 §4, el motivo de Exportar flota anclado a la derecha (fila 24)
- `79688a8` docs(roadmap): filas 23-24 del Hito 12.5 cerradas
- `ee85f81` docs(adr): ADR-178, lo contenido se oculta solo si su contenedor se elimina
- `17d4501` feat(grouping): ADR-178, lo contenido se oculta solo si su contenedor se elimina (fila 25)
- `8b5664d` docs(roadmap): fila 25 del Hito 12.5 cerrada
- `653fd99` docs(roadmap): revision 6 del Hito 12.5 APPROVED
- `efc5666` docs(grouping): caso 69, eliminar puede abrir un choque (O6-1)
- `8ff5bb0` test(grouping): caso 69, eliminar un contenedor puede retener lo guardado en un choque (O6-1)
- `e07174a` docs(roadmap): O6-1 del Hito 12.5 cerrada

### E2

- `c74b9eb` docs(adr): ADR-188, la busqueda de actualizaciones se puede apagar
- `d898058` docs: politica de firma de codigo y de privacidad para SignPath
- `361b291` feat(desktop-shell): la busqueda automatica de actualizaciones se puede apagar
- `5fd71a0` feat(react-client): preferencia "Buscar actualizaciones automaticamente"
- `df0c629` chore(changeset): busqueda de actualizaciones desactivable
